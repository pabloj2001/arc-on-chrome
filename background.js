// Each command opens the same bar with different options:
//   toggle-search-bar -> empty bar, Enter opens in a NEW tab
//   open-url-bar       -> prefilled with the current URL, Enter replaces THIS tab
const COMMAND_OPTIONS = {
  "toggle-search-bar": { opensInCurrentTab: false, useCurrentUrl: false },
  "open-url-bar": { opensInCurrentTab: true, useCurrentUrl: true },
};

chrome.commands.onCommand.addListener((command) => {
  const opts = COMMAND_OPTIONS[command];
  if (!opts) return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.id) return;
    chrome.tabs.sendMessage(
      tab.id,
      { type: "TOGGLE_ARC_SEARCH", ...opts },
      () => {
        // Swallow "receiving end does not exist" on pages where the content
        // script can't run (chrome:// pages, the web store, etc.).
        void chrome.runtime.lastError;
      }
    );
  });
});

// Opens a query/favorite in a new tab. Done from the background so it works
// even if the originating page blocks window.open.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;
  switch (message.type) {
    case "ARC_SEARCH_SUBMIT":
      if (message.url) {
        chrome.tabs.create({ url: message.url }, (tab) => {
          addTabToContext(tab, message.groupId);
        });
      }
      break;
    case "ARC_OPEN_FAVORITE":
      if (message.url) focusOrCreateTab(message.url, message.groupId);
      break;
    case "ARC_ACTIVATE_TAB":
      if (message.tabId != null) {
        chrome.tabs.update(message.tabId, { active: true });
        if (message.windowId != null) {
          chrome.windows.update(message.windowId, { focused: true });
        }
      }
      break;
    case "ARC_SET_CONTEXT":
      setContext(sender, message.name, message.expiry, sendResponse);
      return true;
    case "ARC_CLEAR_CONTEXT":
      clearActiveContext(sendResponse);
      return true;
    case "ARC_SWITCH_CONTEXT":
      switchContext(message.groupId, sendResponse);
      return true;
    case "ARC_DELETE_CONTEXT":
      deleteContext(message.name, sendResponse);
      return true;
    case "ARC_GET_INDEX":
      getIndex(sender, sendResponse);
      return true; // keep the message channel open for the async response
  }
});

const WEB_URL = /^https?:\/\//i;

// Builds the small index the bar searches: currently-open tabs plus the last
// 7 days of history (capped). Only http(s) pages are included.
function getIndex(sender, sendResponse) {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  chrome.tabs.query({}, (tabs) => {
    const openTabs = tabs
      .filter((t) => t.url && WEB_URL.test(t.url))
      .map((t) => ({
        tabId: t.id,
        windowId: t.windowId,
        title: t.title || t.url,
        url: t.url,
        lastAccessed: t.lastAccessed || 0,
      }))
      // Most recently used tabs first (lastAccessed is when a tab was last active).
      .sort((a, b) => b.lastAccessed - a.lastAccessed);
    chrome.history.search(
      { text: "", startTime: weekAgo, maxResults: 500 },
      (items) => {
        const history = (items || [])
          .filter((h) => h.url && WEB_URL.test(h.url))
          .map((h) => ({
            title: h.title || h.url,
            url: h.url,
            lastVisitTime: h.lastVisitTime || 0,
            visitCount: h.visitCount || 1,
          }));
        getContextState((state) => {
          sendResponse({
            currentTabId: sender.tab && sender.tab.id,
            currentTabGroupId:
              sender.tab && sender.tab.groupId != null
                ? sender.tab.groupId
                : -1,
            tabs: openTabs,
            history,
            activeContext: state.activeContext, // { groupId, name, color } or null
            contexts: state.contexts, // [{ groupId, name, color }]
          });
        });
      }
    );
  });
}

// Parses a URL into the parts we compare on: host without a leading "www.",
// path without trailing slashes, and the query string.
function parseUrl(u) {
  try {
    const x = new URL(u);
    return {
      host: x.host.replace(/^www\./i, "").toLowerCase(),
      path: x.pathname.replace(/\/+$/, ""),
      search: x.search,
    };
  } catch (_) {
    return null;
  }
}

// A tab matches a favorite when they share a host and the favorite's path is a
// prefix of the tab's path. This means a bare-domain favorite (e.g.
// gemini.google.com) matches the tab it redirects to (gemini.google.com/app),
// while a favorite with a path only matches tabs under that path.
function tabMatchesFavorite(fav, tab) {
  if (!fav || !tab || fav.host !== tab.host) return false;
  if (fav.path === "" || fav.path === tab.path) return true;
  return tab.path === fav.path || tab.path.startsWith(fav.path + "/");
}

// If a tab already shows the favorite (exact URL preferred, else same-host
// prefix), focus it (and its window); otherwise open the URL in a new tab
// (added to the active context group when one is given).
function focusOrCreateTab(url, groupId) {
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
      chrome.tabs.create({ url }, (tab) => addTabToContext(tab, groupId));
    }
  });
}

// ---- Contexts (ephemeral tab groups) ---------------------------------------

const CONTEXTS_KEY = "arcContexts"; // [{ groupId, name, color, durationMs, lastActiveAt }]
const ACTIVE_CONTEXT_KEY = "arcActiveContextId"; // groupId | null
const CONTEXT_ALARM = "arc-context-check";
const DEFAULT_DURATION_MS = 24 * 60 * 60 * 1000;
// Color names to cycle contexts through. Limited to colors whose Edge hex we
// map confidently (Edge's Fluent palette has no true red/green), so the bar's
// pill color always matches the tab-strip chip.
const GROUP_COLORS = [
  "blue", "purple", "pink", "cyan", "orange", "yellow", "grey",
];

function getContexts() {
  return new Promise((resolve) =>
    chrome.storage.local.get(CONTEXTS_KEY, (r) =>
      resolve(Array.isArray(r[CONTEXTS_KEY]) ? r[CONTEXTS_KEY] : [])
    )
  );
}
function setContexts(list) {
  return new Promise((resolve) =>
    chrome.storage.local.set({ [CONTEXTS_KEY]: list }, resolve)
  );
}
function getActiveContextId() {
  return new Promise((resolve) =>
    chrome.storage.local.get(ACTIVE_CONTEXT_KEY, (r) =>
      resolve(r[ACTIVE_CONTEXT_KEY] != null ? r[ACTIVE_CONTEXT_KEY] : null)
    )
  );
}
function setActiveContextId(id) {
  return new Promise((resolve) =>
    chrome.storage.local.set({ [ACTIVE_CONTEXT_KEY]: id }, resolve)
  );
}

// Resolves the active context's display info ({ groupId, name, color }) or null.
async function getActiveContext(cb) {
  const id = await getActiveContextId();
  if (id == null) return cb(null);
  const ctx = (await getContexts()).find((c) => c.groupId === id);
  cb(ctx ? { groupId: ctx.groupId, name: ctx.name, color: ctx.color } : null);
}

// Resolves both the active context and the full tracked-contexts list (for the
// numbered contexts row in the bar).
async function getContextState(cb) {
  const id = await getActiveContextId();
  const contexts = await getContexts();
  const active = contexts.find((c) => c.groupId === id) || null;
  cb({
    activeContext: active
      ? { groupId: active.groupId, name: active.name, color: active.color }
      : null,
    contexts: contexts.map((c) => ({
      groupId: c.groupId,
      name: c.name,
      color: c.color,
    })),
  });
}

// "8h" / "1d" / "30m" -> milliseconds. Defaults to 24h when unset/invalid.
function parseExpiry(str) {
  const m = String(str || "").trim().match(/^(\d+)\s*([mhd])$/i);
  if (!m) return DEFAULT_DURATION_MS;
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  const mult = unit === "m" ? 60000 : unit === "h" ? 3600000 : 86400000;
  return n * mult;
}

function fmtRemaining(ms) {
  if (ms <= 0) return "0m";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return mins + "m";
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + "h";
  const days = Math.floor(hours / 24);
  const rem = hours % 24;
  return rem ? `${days}d ${rem}h` : `${days}d`;
}

function groupTitle(ctx, now) {
  const remaining = ctx.durationMs - (now - ctx.lastActiveAt);
  return `${ctx.name} [${fmtRemaining(remaining)}]`;
}

const MAX_CONTEXTS = 5;

// Creates a group from the sender's current tab, tracks it, and makes it active.
async function setContext(sender, name, expiry, sendResponse) {
  const cleanName = String(name || "").trim();
  if (!cleanName) return clearActiveContext(sendResponse);
  const contexts = await getContexts();
  // No two contexts may share a name.
  if (contexts.some((c) => c.name.toLowerCase() === cleanName.toLowerCase())) {
    return sendResponse && sendResponse({ ok: false, reason: "duplicate" });
  }
  if (contexts.length >= MAX_CONTEXTS) {
    return sendResponse && sendResponse({ ok: false, reason: "limit" });
  }
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || tab.id == null) return sendResponse && sendResponse({ ok: false });
    const color = GROUP_COLORS[contexts.length % GROUP_COLORS.length];
    chrome.tabs.group({ tabIds: [tab.id] }, async (groupId) => {
      if (chrome.runtime.lastError || groupId == null) {
        return sendResponse && sendResponse({ ok: false });
      }
      const ctx = {
        groupId,
        name: cleanName,
        color,
        durationMs: parseExpiry(expiry),
        lastActiveAt: Date.now(),
      };
      contexts.push(ctx);
      await setContexts(contexts);
      await setActiveContextId(groupId);
      chrome.tabGroups.update(groupId, {
        title: groupTitle(ctx, Date.now()),
        color,
      });
      ensureAlarm();
      sendResponse && sendResponse({ ok: true, groupId, name: cleanName, color });
    });
  });
}

async function clearActiveContext(sendResponse) {
  await setActiveContextId(null);
  sendResponse && sendResponse({ ok: true });
}

// Make a tracked context the active one (where new bar-opened tabs go). Does not
// jump to its tabs — the bar stays where it is.
async function switchContext(groupId, sendResponse) {
  const contexts = await getContexts();
  const ctx = contexts.find((c) => c.groupId === groupId);
  if (!ctx) return sendResponse && sendResponse({ ok: false });
  await setActiveContextId(groupId);
  sendResponse &&
    sendResponse({
      ok: true,
      activeContext: { groupId: ctx.groupId, name: ctx.name, color: ctx.color },
    });
}

// Delete a context by name: close its group's tabs and drop the tracker.
async function deleteContext(name, sendResponse) {
  const clean = String(name || "").trim().toLowerCase();
  const contexts = await getContexts();
  const idx = contexts.findIndex((c) => c.name.toLowerCase() === clean);
  if (idx < 0) return sendResponse && sendResponse({ ok: false, reason: "notfound" });
  const [ctx] = contexts.splice(idx, 1);
  await setContexts(contexts);
  const activeId = await getActiveContextId();
  if (activeId === ctx.groupId) await setActiveContextId(null);
  await closeGroupTabs(ctx.groupId);
  sendResponse && sendResponse({ ok: true, name: ctx.name });
}

// Adds a freshly-created tab to a context group (guarding against a group that
// no longer exists).
function addTabToContext(tab, groupId) {
  if (!tab || tab.id == null || groupId == null) return;
  chrome.tabs.group({ tabIds: [tab.id], groupId }, () => {
    void chrome.runtime.lastError; // group may have been deleted
  });
}

// Reset a tracked group's inactivity timer whenever one of its tabs is visited.
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, async (tab) => {
    if (chrome.runtime.lastError || !tab) return;
    const gid = tab.groupId;
    if (gid == null || gid < 0) return;
    const contexts = await getContexts();
    const ctx = contexts.find((c) => c.groupId === gid);
    if (!ctx) return;
    ctx.lastActiveAt = Date.now();
    await setContexts(contexts);
  });
});

function ensureAlarm() {
  chrome.alarms.get(CONTEXT_ALARM, (a) => {
    if (!a) chrome.alarms.create(CONTEXT_ALARM, { periodInMinutes: 1 });
  });
}

chrome.runtime.onStartup.addListener(ensureAlarm);
chrome.runtime.onInstalled.addListener(ensureAlarm);
ensureAlarm();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CONTEXT_ALARM) tickContexts();
});

// Every tick: expire groups past their inactivity window (close their tabs and
// untrack), otherwise refresh the group title with the time remaining. A group
// that no longer exists (user deleted it) is kept tracked until it expires, so
// reopening closed tabs can still land back in a live context.
async function tickContexts() {
  const now = Date.now();
  const contexts = await getContexts();
  if (!contexts.length) return;
  const activeId = await getActiveContextId();
  const survivors = [];
  for (const ctx of contexts) {
    const remaining = ctx.durationMs - (now - ctx.lastActiveAt);
    if (remaining <= 0) {
      // Expired: close the group's tabs (if the group still exists) and untrack.
      await closeGroupTabs(ctx.groupId);
      if (ctx.groupId === activeId) await setActiveContextId(null);
      continue;
    }
    survivors.push(ctx);
    chrome.tabGroups.update(
      ctx.groupId,
      { title: groupTitle(ctx, now) },
      () => void chrome.runtime.lastError // group may not currently exist
    );
  }
  if (survivors.length !== contexts.length) await setContexts(survivors);
}

function closeGroupTabs(groupId) {
  return new Promise((resolve) => {
    chrome.tabs.query({ groupId }, (tabs) => {
      if (chrome.runtime.lastError || !tabs || !tabs.length) return resolve();
      chrome.tabs.remove(
        tabs.map((t) => t.id).filter((id) => id != null),
        () => {
          void chrome.runtime.lastError;
          resolve();
        }
      );
    });
  });
}

