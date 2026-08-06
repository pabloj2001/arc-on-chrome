// Shared helpers for the Arc Search Bar e2e tests. All bar reads reach into the
// extension's Shadow DOM (`#arc-search-bar-host`); all worker reads/seeds run in
// the service worker via chrome.* APIs.

const HOST = "arc-search-bar-host";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Seeding ---------------------------------------------------------------

async function seedSettings(sw, { favorites, shortcuts } = {}) {
  const data = {};
  if (favorites) data.arcFavorites = favorites;
  if (shortcuts) data.arcShortcuts = shortcuts;
  await sw.evaluate((d) => new Promise((r) => chrome.storage.local.set(d, r)), data);
  await sleep(120); // let storage.onChanged propagate to the content script
}

async function seedHistory(sw, urls) {
  await sw.evaluate(
    (list) =>
      Promise.all(
        list.map((u) => new Promise((r) => chrome.history.addUrl({ url: u }, r)))
      ),
    urls
  );
  await sleep(120);
}

// Open a real tab on a URL (so it appears in the open-tabs index).
async function openTabAt(context, url) {
  const p = await context.newPage();
  await p.goto(url);
  await sleep(120);
  return p;
}

// ---- Opening / driving the bar ---------------------------------------------

async function openBar(sw, opts = {}) {
  await sw.evaluate(async (o) => {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(t.id, { type: "TOGGLE_ARC_SEARCH", ...o });
  }, opts);
}

async function waitForBar(page) {
  await page.waitForFunction((id) => !!document.getElementById(id), HOST, {
    timeout: 6000,
  });
  await sleep(80);
}

async function openBarOn(page, sw, opts = {}) {
  await page.bringToFront();
  await openBar(sw, opts);
  await waitForBar(page);
}

async function barExists(page) {
  return page.evaluate((id) => !!document.getElementById(id), HOST);
}

// Type into the (focused) bar input.
async function type(page, text) {
  await page.keyboard.type(text);
  await sleep(80);
}
async function press(page, key) {
  await page.keyboard.press(key);
  await sleep(80);
}

// ---- Reading bar state ------------------------------------------------------

function readState(page) {
  return page.evaluate((id) => {
    const host = document.getElementById(id);
    if (!host) return { open: false };
    const sr = host.shadowRoot;
    const input = sr.querySelector("input");
    const ghost = sr.querySelector(".ghost");
    const ghostSuffix = sr.querySelector(".ghost .g-suffix");
    const status = sr.querySelector(".status");
    const pill = sr.querySelector(".pill");
    const bar = sr.querySelector(".bar");
    const results = [...sr.querySelectorAll(".result")].map((r) => ({
      type: r.dataset.type,
      title: r.querySelector(".title") ? r.querySelector(".title").textContent : "",
      url: r.querySelector(".url") ? r.querySelector(".url").textContent : "",
      tag: r.querySelector(".tag") ? r.querySelector(".tag").textContent : "",
      active: r.classList.contains("active"),
    }));
    const paramPills = [...sr.querySelectorAll(".param-pill")].map((p) => ({
      active: p.classList.contains("active"),
      invalid: p.classList.contains("invalid"),
      text: p.textContent,
    }));
    const contextChips = [...sr.querySelectorAll(".ctx-chip")].map((c) => ({
      cls: c.className,
      num: c.querySelector(".ctx-num") ? c.querySelector(".ctx-num").textContent : "",
      name: c.querySelector(".ctx-cname") ? c.querySelector(".ctx-cname").textContent : "",
      active: c.classList.contains("active"),
      isDefault: c.classList.contains("ctx-default"),
      isAdd: c.classList.contains("ctx-add"),
    }));
    const faves = [...sr.querySelectorAll(".fave")].map((f) => ({
      empty: f.classList.contains("empty"),
      text: f.textContent,
    }));
    return {
      open: true,
      value: input ? input.value : null,
      selStart: input ? input.selectionStart : null,
      selEnd: input ? input.selectionEnd : null,
      ghost: ghost && ghost.style.display !== "none" ? ghost.textContent : "",
      ghostSuffix: ghostSuffix ? ghostSuffix.textContent : "",
      status: status ? status.textContent : "",
      pillText: pill && pill.style.display !== "none" ? pill.textContent : "",
      hasContext: !!(bar && bar.classList.contains("has-context")),
      results,
      paramPills,
      contextChips,
      faves,
      activeIndex: results.findIndex((r) => r.active),
    };
  }, HOST);
}

// ---- Worker-side reads ------------------------------------------------------

async function activeTab(sw) {
  return sw.evaluate(async () => {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    return t ? { id: t.id, url: t.url || t.pendingUrl || "", groupId: t.groupId } : null;
  });
}

async function newTabUrls(sw) {
  return sw.evaluate(() => globalThis.__newTabUrls || []);
}

async function lastNewTabUrl(sw) {
  const urls = await newTabUrls(sw);
  return urls[urls.length - 1] || null;
}

async function tabCount(sw) {
  return sw.evaluate(
    () => new Promise((r) => chrome.tabs.query({}, (t) => r(t.length)))
  );
}

async function getStorage(sw, keys) {
  return sw.evaluate(
    (k) => new Promise((r) => chrome.storage.local.get(k, (v) => r(v))),
    keys
  );
}

// Create a context (tab group) from the current active tab, via the worker.
async function createContext(sw, name, expiry) {
  return sw.evaluate(
    (args) =>
      new Promise((r) => setContext({ tab: null }, args.name, args.expiry, r)),
    { name, expiry: expiry || "" }
  );
}

module.exports = {
  HOST,
  sleep,
  seedSettings,
  seedHistory,
  openTabAt,
  openBar,
  openBarOn,
  waitForBar,
  barExists,
  type,
  press,
  readState,
  activeTab,
  newTabUrls,
  lastNewTabUrl,
  tabCount,
  getStorage,
  createContext,
};
