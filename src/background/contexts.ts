// @ts-nocheck
// Contexts: ephemeral tab groups the bar can create, switch, and delete. This
// module owns their storage, lifecycle, expiry/alarms, and the tab-activity
// timer reset — the single biggest background concern kept cohesive.
import {
  CONTEXTS_KEY, ACTIVE_CONTEXT_KEY, CONTEXT_ALARM, DEFAULT_DURATION_MS,
  GROUP_COLORS, MAX_CONTEXTS,
} from "../shared/constants";

// ---- Storage ---------------------------------------------------------------

export function getContexts() {
  return new Promise((resolve) =>
    chrome.storage.local.get(CONTEXTS_KEY, (r) =>
      resolve(Array.isArray(r[CONTEXTS_KEY]) ? r[CONTEXTS_KEY] : [])
    )
  );
}
export function setContexts(list) {
  return new Promise((resolve) =>
    chrome.storage.local.set({ [CONTEXTS_KEY]: list }, resolve)
  );
}
export function getActiveContextId() {
  return new Promise((resolve) =>
    chrome.storage.local.get(ACTIVE_CONTEXT_KEY, (r) =>
      resolve(r[ACTIVE_CONTEXT_KEY] != null ? r[ACTIVE_CONTEXT_KEY] : null)
    )
  );
}
export function setActiveContextId(id) {
  return new Promise((resolve) =>
    chrome.storage.local.set({ [ACTIVE_CONTEXT_KEY]: id }, resolve)
  );
}

// Resolves the active context's display info ({ groupId, name, color }) or null.
export async function getActiveContext(cb) {
  const id = await getActiveContextId();
  if (id == null) return cb(null);
  const ctx = (await getContexts()).find((c) => c.groupId === id);
  cb(ctx ? { groupId: ctx.groupId, name: ctx.name, color: ctx.color } : null);
}

// Resolves both the active context and the full tracked-contexts list (for the
// numbered contexts row in the bar).
export async function getContextState(cb) {
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

// ---- Formatting ------------------------------------------------------------

// "8h" / "1d" / "30m" -> milliseconds. Defaults to 24h when unset/invalid.
export function parseExpiry(str) {
  const m = String(str || "").trim().match(/^(\d+)\s*([mhd])$/i);
  if (!m) return DEFAULT_DURATION_MS;
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  const mult = unit === "m" ? 60000 : unit === "h" ? 3600000 : 86400000;
  return n * mult;
}

export function fmtRemaining(ms) {
  if (ms <= 0) return "0m";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return mins + "m";
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + "h";
  const days = Math.floor(hours / 24);
  const rem = hours % 24;
  return rem ? `${days}d ${rem}h` : `${days}d`;
}

export function groupTitle(ctx, now) {
  const remaining = ctx.durationMs - (now - ctx.lastActiveAt);
  return `${ctx.name} [${fmtRemaining(remaining)}]`;
}

// ---- Lifecycle -------------------------------------------------------------

// Creates a group from the sender's current tab, tracks it, and makes it active.
export async function setContext(sender, name, expiry, sendResponse) {
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

export async function clearActiveContext(sendResponse) {
  await setActiveContextId(null);
  sendResponse && sendResponse({ ok: true });
}

// Make a tracked context the active one (where new bar-opened tabs go). Does not
// jump to its tabs — the bar stays where it is.
export async function switchContext(groupId, sendResponse) {
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
export async function deleteContext(name, sendResponse) {
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
export function addTabToContext(tab, groupId) {
  if (!tab || tab.id == null || groupId == null) return;
  chrome.tabs.group({ tabIds: [tab.id], groupId }, () => {
    void chrome.runtime.lastError; // group may have been deleted
  });
}

// Reset a tracked group's inactivity timer whenever one of its tabs is visited.
export function onTabActivated({ tabId }) {
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
}

// ---- Alarms / expiry -------------------------------------------------------

export function ensureAlarm() {
  chrome.alarms.get(CONTEXT_ALARM, (a) => {
    if (!a) chrome.alarms.create(CONTEXT_ALARM, { periodInMinutes: 1 });
  });
}

export function onAlarm(alarm) {
  if (alarm.name === CONTEXT_ALARM) tickContexts();
}

// Every tick: expire groups past their inactivity window (close their tabs and
// untrack), otherwise refresh the group title with the time remaining. A group
// that no longer exists (user deleted it) is kept tracked until it expires, so
// reopening closed tabs can still land back in a live context.
export async function tickContexts() {
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

export function closeGroupTabs(groupId) {
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
