// Favorite/URL opening: focus a tab that already shows the target, else open it
// (joining the active group when one is given). This module also mirrors the set
// favorites onto pinned tabs: every favorite is kept open as a pinned tab, in
// favorite-slot order, and any other pinned tab is unpinned so the pinned strip
// matches the favorites exactly.
import { STORAGE_KEY } from "../shared/constants";
import { parseUrl, tabMatchesFavorite, canon } from "../shared/url";
import { openManagedTab } from "./groups";

// If a tab already shows the favorite (exact URL preferred, else same-host
// prefix), focus it (and its window); otherwise open the URL in a new tab
// (added to the active group when one is given).
export function focusOrCreateTab(url: string, groupId?: number) {
  const fav = parseUrl(url);
  chrome.tabs.query({}, (tabs) => {
    const parsed = tabs
      .filter((t) => t.url)
      .map((t) => ({ tab: t, u: parseUrl(t.url) }))
      .filter((x) => tabMatchesFavorite(fav, x.u));
    // Prefer an exact path+query match, otherwise the first host/prefix match.
    const exact = parsed.find(
      (x) => fav && x.u.path === fav.path && x.u.search === fav.search
    );
    const match = (exact || parsed[0]) && (exact || parsed[0]).tab;
    if (match && match.id != null) {
      chrome.tabs.update(match.id, { active: true });
      if (match.windowId != null) {
        chrome.windows.update(match.windowId, { focused: true });
      }
    } else {
      // Managed create: exempt from the external-open grouper, placed in the
      // bar's chosen group (or the default space when none).
      openManagedTab({ url }, groupId);
    }
  });
}

// ---- Favorite ↔ pinned-tab mirroring --------------------------------------

// Minimal tab shape the pin planners reason about.
export interface PinTab {
  id?: number;
  url?: string;
  pendingUrl?: string;
  pinned?: boolean;
  windowId?: number;
}

type Favorite = string | null;

// The canonical (dedup) key for a tab's address, tolerating a not-yet-loaded tab.
function tabCanon(t: PinTab): string {
  return canon(t.url || t.pendingUrl || "");
}

// Distinct favorite URLs in slot order (first occurrence wins), with their canon.
function desiredFavorites(favorites: Favorite[]): { canon: string; url: string }[] {
  const out: { canon: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const f of favorites) {
    if (!f) continue;
    const c = canon(f);
    if (!seen.has(c)) {
      seen.add(c);
      out.push({ canon: c, url: f });
    }
  }
  return out;
}

// Pure: the membership changes needed so the pinned tabs are exactly the set
// favorites — pin an existing matching tab or create one for each favorite, and
// Pure: the changes needed so the pinned tabs are exactly the set favorites —
// pin an existing matching tab or create one for each favorite, and CLOSE every
// other pinned tab (extras or removed/non-favorites) so no leftover tabs pile up.
export function planFavoritePins(
  favorites: Favorite[],
  tabs: PinTab[]
): { pin: number[]; close: number[]; create: string[] } {
  const desired = desiredFavorites(favorites);
  const desiredSet = new Set(desired.map((d) => d.canon));
  const satisfied = new Set<string>();
  const pin: number[] = [];
  const close: number[] = [];
  const create: string[] = [];

  // Pass 1: keep one pinned tab per favorite; close the rest (a removed favorite,
  // a duplicate, or a stray pin) so unpinned leftovers don't accumulate.
  for (const t of tabs) {
    if (!t.pinned || t.id == null) continue;
    const c = tabCanon(t);
    if (desiredSet.has(c) && !satisfied.has(c)) satisfied.add(c);
    else close.push(t.id);
  }
  // Pass 2: pin an existing tab for each still-unsatisfied favorite, else open one.
  for (const d of desired) {
    if (satisfied.has(d.canon)) continue;
    const match = tabs.find(
      (t) => t.id != null && !t.pinned && tabCanon(t) === d.canon
    );
    if (match && match.id != null) {
      pin.push(match.id);
    } else {
      create.push(d.url);
    }
    satisfied.add(d.canon);
  }
  return { pin, close, create };
}

// Pure: per-window tab moves that order the (favorite) pinned tabs by favorite
// slot. Assumes non-favorite pins were already removed, so every pinned tab that
// maps to a favorite is placed at its slot rank within its window.
export function planPinnedOrder(
  favorites: Favorite[],
  tabs: PinTab[]
): { id: number; windowId: number; index: number }[] {
  const rank = new Map<string, number>();
  favorites.forEach((f, i) => {
    if (!f) return;
    const c = canon(f);
    if (!rank.has(c)) rank.set(c, i);
  });
  const byWindow = new Map<number, { id: number; rank: number }[]>();
  for (const t of tabs) {
    if (!t.pinned || t.id == null) continue;
    const c = tabCanon(t);
    if (!rank.has(c)) continue;
    const w = t.windowId ?? -1;
    const arr = byWindow.get(w) || [];
    arr.push({ id: t.id, rank: rank.get(c) as number });
    byWindow.set(w, arr);
  }
  const moves: { id: number; windowId: number; index: number }[] = [];
  for (const [windowId, arr] of byWindow) {
    arr.sort((a, b) => a.rank - b.rank);
    arr.forEach((x, index) => moves.push({ id: x.id, windowId, index }));
  }
  return moves;
}

function queryAllTabs(): Promise<chrome.tabs.Tab[]> {
  return new Promise((resolve) =>
    chrome.tabs.query({}, (t) => {
      void chrome.runtime.lastError;
      resolve(t || []);
    })
  );
}

function updateTab(id: number, props: chrome.tabs.UpdateProperties): Promise<void> {
  return new Promise((resolve) =>
    chrome.tabs.update(id, props, () => {
      void chrome.runtime.lastError;
      resolve();
    })
  );
}

function moveTab(id: number, index: number): Promise<void> {
  return new Promise((resolve) =>
    chrome.tabs.move(id, { index }, () => {
      void chrome.runtime.lastError;
      resolve();
    })
  );
}

function createPinnedTab(url: string): Promise<void> {
  return new Promise((resolve) =>
    // active:false so favorites don't steal focus; inactive => the external-open
    // grouper ignores it (and pinned tabs can't be grouped anyway).
    chrome.tabs.create({ url, pinned: true, active: false }, () => {
      void chrome.runtime.lastError;
      resolve();
    })
  );
}

function removeTab(id: number): Promise<void> {
  return new Promise((resolve) =>
    chrome.tabs.remove(id, () => {
      void chrome.runtime.lastError;
      resolve();
    })
  );
}

let syncing = false;
let resyncQueued = false;

// Reconciles pinned tabs to the set favorites (membership + order). Serialized so
// overlapping storage changes don't race; a change during a run triggers one more.
export async function syncFavoritePins(favorites: Favorite[]): Promise<void> {
  if (syncing) {
    resyncQueued = true;
    return;
  }
  syncing = true;
  try {
    let tabs = (await queryAllTabs()) as PinTab[];
    const { pin, close, create } = planFavoritePins(favorites, tabs);
    // Tabs per window (snapshot) so we never close a window's only tab.
    const perWindow: Record<number, number> = {};
    for (const t of tabs) {
      const w = t.windowId ?? -1;
      perWindow[w] = (perWindow[w] || 0) + 1;
    }
    const byId = new Map(tabs.map((t) => [t.id, t] as const));
    for (const id of close) {
      const t = byId.get(id);
      const w = t && t.windowId != null ? t.windowId : -1;
      if ((perWindow[w] || 0) <= 1) {
        // Closing would leave an empty window — just unpin instead.
        await updateTab(id, { pinned: false });
      } else {
        await removeTab(id);
        perWindow[w] -= 1;
      }
    }
    for (const id of pin) await updateTab(id, { pinned: true });
    for (const url of create) await createPinnedTab(url);
    // Re-read (created/pinned tabs now exist) and order the pinned strip.
    tabs = (await queryAllTabs()) as PinTab[];
    for (const m of planPinnedOrder(favorites, tabs)) await moveTab(m.id, m.index);
  } finally {
    syncing = false;
    if (resyncQueued) {
      resyncQueued = false;
      void syncFavoritePins(favorites);
    }
  }
}

// storage.onChanged handler: any favorites change (add/update/remove/import)
// re-syncs the pinned tabs.
export function onFavoritesChanged(
  changes: { [key: string]: chrome.storage.StorageChange },
  area: string
) {
  if (area !== "local" || !changes[STORAGE_KEY]) return;
  const favs = changes[STORAGE_KEY].newValue;
  void syncFavoritePins(Array.isArray(favs) ? (favs as Favorite[]) : []);
}
