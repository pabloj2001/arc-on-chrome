// Groups: the bar's view over Chrome tab groups. The switcher simply mirrors the
// tab groups you have open; "active group" is where new bar-opened tabs land.
// This module also owns per-tab inactivity expiry — ungrouped tabs expire sooner
// than grouped ones, and Chrome auto-removes a group once its last tab closes.
import {
  ACTIVE_GROUP_KEY, GROUP_ALARM, GROUP_COLORS,
  UNGROUPED_EXPIRY_MS, GROUPED_EXPIRY_MS, WEB_URL,
} from "../shared/constants";
import { getSettings } from "../shared/settings";

export type GroupColor = `${chrome.tabGroups.Color}`;

// The display slice sent to the bar.
export interface GroupInfo {
  groupId: number;
  name: string;
  color: GroupColor;
}

export interface GroupState {
  activeGroup: GroupInfo | null;
  groups: GroupInfo[];
}

type Responder = ((response?: unknown) => void) | undefined;

export const TAB_GROUP_ID_NONE = -1;

// ---- Storage ---------------------------------------------------------------

export function getActiveGroupId(): Promise<number | null> {
  return new Promise((resolve) =>
    chrome.storage.local.get(ACTIVE_GROUP_KEY, (r) =>
      resolve(r[ACTIVE_GROUP_KEY] != null ? (r[ACTIVE_GROUP_KEY] as number) : null)
    )
  );
}
export function setActiveGroupId(id: number | null): Promise<void> {
  return new Promise((resolve) =>
    chrome.storage.local.set({ [ACTIVE_GROUP_KEY]: id }, () => resolve())
  );
}

// ---- External-open adopt hint (storage.session) ---------------------------
// When the browser regains focus (an OS-level "open link" brings it forward),
// we snapshot the group of the tab that was active at that instant. An external
// tab created just afterward adopts that group. Ctrl+T / Ctrl+Shift+T happen
// while the browser is already focused, so they leave no fresh hint and are not
// moved. Stored in storage.session so it survives a worker restart but clears on
// browser restart.
const ADOPT_HINT_KEY = "arcExternalAdopt";
export const ADOPT_WINDOW_MS = 1500;

export interface AdoptHint {
  groupId: number | null; // the focused tab's group, or null for the default space
  at: number;
}

export function getAdoptHint(): Promise<AdoptHint | null> {
  return new Promise((resolve) =>
    chrome.storage.session.get(ADOPT_HINT_KEY, (r) => {
      void chrome.runtime.lastError;
      resolve((r && (r[ADOPT_HINT_KEY] as AdoptHint)) || null);
    })
  );
}
export function setAdoptHint(hint: AdoptHint): Promise<void> {
  return new Promise((resolve) =>
    chrome.storage.session.set({ [ADOPT_HINT_KEY]: hint }, () => {
      void chrome.runtime.lastError;
      resolve();
    })
  );
}

// ---- Group queries ---------------------------------------------------------

function toInfo(g: chrome.tabGroups.TabGroup): GroupInfo {
  return { groupId: g.id, name: g.title || "Untitled", color: g.color };
}

// All open tab groups, ordered by id for a stable numbered row.
export function queryGroups(): Promise<chrome.tabGroups.TabGroup[]> {
  return new Promise((resolve) =>
    chrome.tabGroups.query({}, (groups) => {
      void chrome.runtime.lastError;
      const list = (groups || []).slice().sort((a, b) => a.id - b.id);
      resolve(list);
    })
  );
}

// Resolves the active group plus the full open-groups list (for the numbered
// row in the bar). Clears a stale active id if that group no longer exists.
export async function getGroupState(cb: (state: GroupState) => void) {
  const groups = await queryGroups();
  const activeId = await getActiveGroupId();
  const active = groups.find((g) => g.id === activeId) || null;
  if (activeId != null && !active) await setActiveGroupId(null);
  cb({
    activeGroup: active ? toInfo(active) : null,
    groups: groups.map(toInfo),
  });
}

// ---- Lifecycle -------------------------------------------------------------

// Groups the sender's current tab into a new tab group, titles it, and makes it
// the active group. Mirrors a real Chrome tab group (no private tracking).
export async function createGroup(
  sender: chrome.runtime.MessageSender,
  name: string,
  sendResponse?: Responder
) {
  const cleanName = String(name || "").trim();
  if (!cleanName) return clearActiveGroup(sendResponse);
  const existing = await queryGroups();
  const color = GROUP_COLORS[existing.length % GROUP_COLORS.length];
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || tab.id == null) return sendResponse && sendResponse({ ok: false });
    chrome.tabs.group({ tabIds: [tab.id] }, async (groupId) => {
      if (chrome.runtime.lastError || groupId == null) {
        return sendResponse && sendResponse({ ok: false });
      }
      chrome.tabGroups.update(groupId, { title: cleanName, color });
      await setActiveGroupId(groupId);
      ensureAlarm();
      sendResponse && sendResponse({ ok: true, groupId, name: cleanName, color });
    });
  });
}

export async function clearActiveGroup(sendResponse?: Responder) {
  await setActiveGroupId(null);
  sendResponse && sendResponse({ ok: true });
}

// Make an open group the active one (where new bar-opened tabs go). Does not
// jump to its tabs — the bar stays where it is.
export async function switchGroup(groupId: number, sendResponse?: Responder) {
  const groups = await queryGroups();
  const g = groups.find((x) => x.id === groupId);
  if (!g) return sendResponse && sendResponse({ ok: false });
  await setActiveGroupId(groupId);
  sendResponse && sendResponse({ ok: true, activeGroup: toInfo(g) });
}

// Delete a group by name: close its tabs (Chrome removes the now-empty group).
export async function deleteGroup(name: string, sendResponse?: Responder) {
  const clean = String(name || "").trim().toLowerCase();
  const groups = await queryGroups();
  const g = groups.find((x) => (x.title || "").trim().toLowerCase() === clean);
  if (!g) return sendResponse && sendResponse({ ok: false, reason: "notfound" });
  const activeId = await getActiveGroupId();
  if (activeId === g.id) await setActiveGroupId(null);
  await closeGroupTabs(g.id);
  sendResponse && sendResponse({ ok: true, name: g.title || "" });
}

// Adds a freshly-created tab to a group (guarding against a group that no longer
// exists).
export function addTabToGroup(tab: chrome.tabs.Tab | undefined, groupId: number | undefined) {
  if (!tab || tab.id == null || groupId == null) return;
  chrome.tabs.group({ tabIds: [tab.id], groupId }, () => {
    void chrome.runtime.lastError; // group may have been deleted
  });
}

// ---- Extension-created tab tracking ---------------------------------------
// Tabs the extension itself opens (bar submit, favorite open) must be exempt
// from the external-open auto-grouper below — the bar already decided their
// group (or intentionally left them in the default space). onCreated fires
// before chrome.tabs.create's callback runs, so we guard with BOTH a short time
// window (covers that race) and an id set (covers the rest of the worker's life).
const SELF_CREATED = new Set<number>();
let selfCreateGuardUntil = 0;

function markSelfCreated(id: number) {
  SELF_CREATED.add(id);
  setTimeout(() => SELF_CREATED.delete(id), 5000);
}
function isSelfCreated(id: number): boolean {
  return SELF_CREATED.has(id) || Date.now() < selfCreateGuardUntil;
}

// Opens a tab the extension is responsible for, exempting it from the external-
// open grouper and (optionally) placing it in `groupId`.
export function openManagedTab(
  createProps: chrome.tabs.CreateProperties,
  groupId?: number
) {
  selfCreateGuardUntil = Date.now() + 1500;
  chrome.tabs.create(createProps, (tab) => {
    if (chrome.runtime.lastError || !tab || tab.id == null) return;
    markSelfCreated(tab.id);
    if (groupId != null) addTabToGroup(tab, groupId);
  });
}

// ---- External-open grouping -----------------------------------------------

// On the browser regaining focus, snapshot the currently-active tab's group as
// the adopt hint. This fires when the OS brings the browser forward to open an
// external link (right before the new tab is created) and when switching between
// browser windows. The active tab at that instant is the one you were viewing —
// its group (or the default space) is where an imminent external tab should go.
export function onWindowFocusChanged(windowId: number) {
  if (windowId == null || windowId === chrome.windows.WINDOW_ID_NONE) return;
  chrome.tabs.query({ active: true, windowId }, (tabs) => {
    void chrome.runtime.lastError;
    const t = tabs && tabs[0];
    const gid =
      t && t.groupId != null && t.groupId !== TAB_GROUP_ID_NONE ? t.groupId : null;
    void setAdoptHint({ groupId: gid, at: Date.now() });
  });
}

// The subset of a created tab we inspect to classify it.
export interface CreatedTabInfo {
  id?: number;
  openerTabId?: number;
  active?: boolean;
  groupId?: number;
  url?: string;
  pendingUrl?: string;
}

// Pure: could this newly-created tab be an "external" open? It must be focused,
// carry a real web URL, have NO opener (in-page link clicks / window.open are
// grouped with their source by Chrome), not already be grouped, and not be one
// we created. Whether it actually gets grouped is further gated on a fresh
// focus hint (see onTabCreated) so browser-internal opens — Ctrl+T and reopened
// tabs (Ctrl+Shift+T), which happen while already focused — are left alone.
export function isExternalOpen(tab: CreatedTabInfo, selfCreated: boolean): boolean {
  if (!tab || tab.id == null) return false;
  if (selfCreated) return false;
  if (tab.openerTabId != null) return false; // in-page link / window.open
  if (!tab.active) return false; // external opens focus their tab
  if (tab.groupId != null && tab.groupId !== TAB_GROUP_ID_NONE) return false;
  const url = tab.pendingUrl || tab.url || "";
  return WEB_URL.test(url);
}

// Pure: given the current adopt hint and now, the group an external tab should
// join — or null to leave it where it is (no fresh hint, or the hint's context
// was the default space).
export function adoptTargetFor(hint: AdoptHint | null, now: number): number | null {
  if (!hint) return null;
  if (now - hint.at > ADOPT_WINDOW_MS) return null; // no recent focus-from-outside
  return hint.groupId; // may be null -> stay in the default space
}

// onCreated handler: move a detected external open into the group the user was
// viewing when the browser regained focus. The onCreated payload often omits
// openerTabId (and may lag the URL), so we re-read the tab after a short tick
// before classifying — otherwise in-page links would be misread as external.
export function onTabCreated(tab: chrome.tabs.Tab) {
  if (!tab || tab.id == null) return;
  const id = tab.id;
  if (isSelfCreated(id)) return; // fast path: our own bar/favorite tab
  setTimeout(() => {
    void adoptIfExternal(id);
  }, 120);
}

async function adoptIfExternal(id: number): Promise<void> {
  const tab = await new Promise<chrome.tabs.Tab | null>((resolve) =>
    chrome.tabs.get(id, (t) => {
      void chrome.runtime.lastError;
      resolve(t || null);
    })
  );
  if (!tab) return;
  if (!isExternalOpen(tab as CreatedTabInfo, isSelfCreated(id))) return;
  const target = adoptTargetFor(await getAdoptHint(), Date.now());
  if (target == null) return; // no fresh external-focus hint, or default space
  const groups = await queryGroups();
  if (!groups.some((g) => g.id === target)) return; // group vanished
  chrome.tabs.group({ tabIds: [id], groupId: target }, () => {
    void chrome.runtime.lastError; // group may have vanished between checks
  });
}

// ---- Alarms / per-tab expiry ----------------------------------------------

export function ensureAlarm() {
  chrome.alarms.get(GROUP_ALARM, (a) => {
    if (!a) chrome.alarms.create(GROUP_ALARM, { periodInMinutes: 1 });
  });
}

export function onAlarm(alarm: chrome.alarms.Alarm) {
  if (alarm.name === GROUP_ALARM) tickTabs();
}

// The subset of tab fields expiry cares about.
export interface ExpiryTab {
  id?: number;
  groupId?: number;
  active?: boolean;
  pinned?: boolean;
  windowId?: number;
  lastAccessed?: number;
}

// Inactivity thresholds (ms) for grouped vs ungrouped tabs.
export interface ExpiryThresholds {
  groupedMs: number;
  ungroupedMs: number;
}

// Pure: which tab ids should be closed for inactivity. A tab in a group expires
// after `groupedMs` idle, an ungrouped tab after `ungroupedMs` (both default to
// the built-in constants). Never closes the active tab, a pinned tab, a tab with
// unknown last-access, or the sole tab in its window.
export function expiredTabIds(
  tabs: ExpiryTab[],
  now: number,
  thresholds?: ExpiryThresholds
): number[] {
  const groupedMs = thresholds ? thresholds.groupedMs : GROUPED_EXPIRY_MS;
  const ungroupedMs = thresholds ? thresholds.ungroupedMs : UNGROUPED_EXPIRY_MS;
  const perWindow: Record<number, number> = {};
  for (const t of tabs) {
    const w = t.windowId ?? -1;
    perWindow[w] = (perWindow[w] || 0) + 1;
  }
  const out: number[] = [];
  for (const t of tabs) {
    if (t.id == null || t.active || t.pinned) continue;
    if ((perWindow[t.windowId ?? -1] || 0) <= 1) continue;
    const last = t.lastAccessed || 0;
    if (!last) continue; // unknown activity -> treat as fresh
    const grouped = t.groupId != null && t.groupId !== TAB_GROUP_ID_NONE;
    const threshold = grouped ? groupedMs : ungroupedMs;
    if (now - last > threshold) out.push(t.id);
  }
  return out;
}

// Every tick: close inactive tabs (using the user's configured thresholds).
// Chrome auto-removes any group left empty; we then reconcile a dangling
// active-group id against the surviving groups.
export async function tickTabs() {
  const now = Date.now();
  const [tabs, settings] = await Promise.all([
    new Promise<chrome.tabs.Tab[]>((resolve) =>
      chrome.tabs.query({}, (t) => resolve(t || []))
    ),
    getSettings(),
  ]);
  const ids = expiredTabIds(tabs as ExpiryTab[], now, {
    groupedMs: settings.groupedExpiryMs,
    ungroupedMs: settings.ungroupedExpiryMs,
  });
  if (ids.length) await closeTabs(ids);
  // Drop the active group if it no longer exists (all its tabs expired).
  const activeId = await getActiveGroupId();
  if (activeId != null) {
    const groups = await queryGroups();
    if (!groups.some((g) => g.id === activeId)) await setActiveGroupId(null);
  }
}

export function closeTabs(ids: number[]): Promise<void> {
  return new Promise((resolve) => {
    if (!ids.length) return resolve();
    chrome.tabs.remove(ids, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

export function closeGroupTabs(groupId: number): Promise<void> {
  return new Promise((resolve) => {
    chrome.tabs.query({ groupId }, (tabs) => {
      if (chrome.runtime.lastError || !tabs || !tabs.length) return resolve();
      closeTabs(tabs.map((t) => t.id).filter((id): id is number => id != null)).then(
        resolve
      );
    });
  });
}
