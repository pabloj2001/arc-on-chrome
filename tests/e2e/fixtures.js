const base = require("@playwright/test");
const { chromium } = require("@playwright/test");
const http = require("http");
const path = require("path");

const EXT_PATH = path.join(__dirname, "..", "..");

// Run with visible windows only when HEADED=1; otherwise use Chromium's *new*
// headless mode (`--headless=new`), which — unlike the old headless shell —
// loads MV3 extensions and runs their service worker. So `npm test` stays
// windowless by default.
const HEADED = process.env.HEADED === "1";

// A tiny local static server so tests never depend on the public internet
// (which was intermittently throwing ERR_SOCKET_NOT_CONNECTED). It answers any
// path with a minimal HTML page, so opening tabs / seeding the index is instant
// and reliable. Content scripts run on http://127.0.0.1, so the bar injects.
let server;
let baseURLValue;
async function ensureServer() {
  if (baseURLValue) return baseURLValue;
  server = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(
      `<!doctype html><html><head><title>${req.url}</title></head><body><h1>${req.url}</h1></body></html>`
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseURLValue = `http://127.0.0.1:${server.address().port}`;
  return baseURLValue;
}

// A test fixture that loads the unpacked extension into a fresh persistent
// context (isolated storage per test) and exposes the extension's service
// worker plus a page already sitting on the local server (content script
// injected). Clipboard permissions are granted for the /export tests.
const test = base.test.extend({
  baseURL: async ({}, use) => {
    await use(await ensureServer());
  },

  context: async ({}, use) => {
    const args = [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      "--no-first-run",
      "--no-default-browser-check",
    ];
    // New headless supports extensions; must be passed explicitly with
    // headless:false so Playwright doesn't launch the old headless shell.
    if (!HEADED) args.push("--headless=new");
    const context = await chromium.launchPersistentContext("", {
      headless: false,
      args,
      permissions: ["clipboard-read", "clipboard-write"],
    });
    await use(context);
    await context.close();
  },

  serviceWorker: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent("serviceworker");
    await use(sw);
  },

  // A page on the local server with the content script injected and new-tab
  // tracking armed in the worker (so we can assert what a submit tried to open
  // without waiting on navigation).
  page: async ({ context, serviceWorker, baseURL }, use) => {
    await serviceWorker.evaluate(() => {
      globalThis.__newTabUrls = [];
      if (!globalThis.__tabTrackInstalled) {
        globalThis.__tabTrackInstalled = true;
        chrome.tabs.onCreated.addListener((t) => {
          globalThis.__newTabUrls.push(t.pendingUrl || t.url || "");
        });
      }
    });
    const page = await context.newPage();
    await page.goto(baseURL + "/");
    await page.bringToFront();
    await use(page);
  },
});

const expect = base.expect;

module.exports = { test, expect, EXT_PATH };
