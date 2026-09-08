const { test, expect } = require("./fixtures");
const h = require("./helpers");

// The pinned tabs (url + pinned + index), in tab-strip order.
function pinnedTabs(sw) {
  return sw.evaluate(
    () =>
      new Promise((r) =>
        chrome.tabs.query({ pinned: true }, (tabs) =>
          r(
            tabs
              .map((t) => ({ url: t.url || t.pendingUrl || "", index: t.index, windowId: t.windowId }))
              .sort((a, b) => a.index - b.index)
          )
        )
      )
  );
}

// Wait until the pinned set (by URL substring) matches `expected` order, or time out.
async function waitForPins(sw, expectedSubstrs, timeout = 3000) {
  const start = Date.now();
  for (;;) {
    const pins = await pinnedTabs(sw);
    const urls = pins.map((p) => p.url);
    const ok =
      urls.length === expectedSubstrs.length &&
      expectedSubstrs.every((s, i) => urls[i].includes(s));
    if (ok) return pins;
    if (Date.now() - start > timeout) return pins; // return last seen for a useful assert
    await h.sleep(100);
  }
}

test.describe("favorites mirror to pinned tabs", () => {
  test("setting favorites opens them as pinned tabs in slot order", async ({ serviceWorker, baseURL }) => {
    await h.seedSettings(serviceWorker, {
      favorites: [baseURL + "/fav-a", baseURL + "/fav-b", null, null, null, null, null, null],
    });
    const pins = await waitForPins(serviceWorker, ["/fav-a", "/fav-b"]);
    expect(pins.map((p) => p.url.replace(baseURL, ""))).toEqual(["/fav-a", "/fav-b"]);
  });

  test("reordering favorites reorders the pinned tabs", async ({ serviceWorker, baseURL }) => {
    await h.seedSettings(serviceWorker, {
      favorites: [baseURL + "/fav-a", baseURL + "/fav-b", null, null, null, null, null, null],
    });
    await waitForPins(serviceWorker, ["/fav-a", "/fav-b"]);
    // swap the two slots
    await h.seedSettings(serviceWorker, {
      favorites: [baseURL + "/fav-b", baseURL + "/fav-a", null, null, null, null, null, null],
    });
    const pins = await waitForPins(serviceWorker, ["/fav-b", "/fav-a"]);
    expect(pins.map((p) => p.url.replace(baseURL, ""))).toEqual(["/fav-b", "/fav-a"]);
  });

  test("removing a favorite closes its tab (no leftover)", async ({ serviceWorker, baseURL }) => {
    await h.seedSettings(serviceWorker, {
      favorites: [baseURL + "/fav-a", baseURL + "/fav-b", null, null, null, null, null, null],
    });
    await waitForPins(serviceWorker, ["/fav-a", "/fav-b"]);
    const before = await h.tabCount(serviceWorker);
    await h.seedSettings(serviceWorker, {
      favorites: [baseURL + "/fav-a", null, null, null, null, null, null, null],
    });
    const pins = await waitForPins(serviceWorker, ["/fav-a"]);
    expect(pins.map((p) => p.url.replace(baseURL, ""))).toEqual(["/fav-a"]);
    // the removed favorite's tab is gone entirely, not just unpinned
    const stillOpen = await serviceWorker.evaluate(
      (s) =>
        new Promise((r) =>
          chrome.tabs.query({}, (tabs) =>
            r(tabs.some((t) => (t.url || t.pendingUrl || "").includes(s)))
          )
        ),
      "/fav-b"
    );
    expect(stillOpen).toBe(false);
    expect(await h.tabCount(serviceWorker)).toBe(before - 1);
  });

  test("an existing open tab is reused (pinned) rather than duplicated", async ({ context, serviceWorker, baseURL }) => {
    const existing = await h.openTabAt(context, baseURL + "/fav-x");
    await h.seedSettings(serviceWorker, {
      favorites: [baseURL + "/fav-x", null, null, null, null, null, null, null],
    });
    await waitForPins(serviceWorker, ["/fav-x"]);
    const matching = await serviceWorker.evaluate(
      (u) =>
        new Promise((r) =>
          chrome.tabs.query({}, (tabs) =>
            r(tabs.filter((t) => (t.url || t.pendingUrl || "").includes("/fav-x")).length)
          )
        ),
      baseURL
    );
    expect(matching).toBe(1); // reused, not duplicated
    await existing.close().catch(() => {});
  });

  test("a non-favorite pinned tab is closed to match the favorites", async ({ context, serviceWorker, baseURL }) => {
    const stray = await h.openTabAt(context, baseURL + "/stray");
    await serviceWorker.evaluate(
      (u) =>
        new Promise((r) =>
          chrome.tabs.query({}, (tabs) => {
            const t = tabs.find((x) => (x.url || "").includes("/stray"));
            chrome.tabs.update(t.id, { pinned: true }, () => r());
          })
        ),
      baseURL
    );
    // now set a favorite; the stray pin should be removed entirely
    await h.seedSettings(serviceWorker, {
      favorites: [baseURL + "/fav-a", null, null, null, null, null, null, null],
    });
    await waitForPins(serviceWorker, ["/fav-a"]);
    const strayOpen = await serviceWorker.evaluate(
      () =>
        new Promise((r) =>
          chrome.tabs.query({}, (tabs) =>
            r(tabs.some((t) => (t.url || t.pendingUrl || "").includes("/stray")))
          )
        )
    );
    expect(strayOpen).toBe(false);
    await stray.close().catch(() => {});
  });

  test("with pin-favorites off: favorites don't create pins and open as a new tab", async ({ page, context, serviceWorker, baseURL }) => {
    // disable pinning
    await serviceWorker.evaluate(
      () => new Promise((r) => chrome.storage.local.set({ arcSettings: { pinFavorites: false } }, r))
    );
    // an existing open tab for the favorite URL
    const existing = await h.openTabAt(context, baseURL + "/np");
    await page.bringToFront();
    await h.seedSettings(serviceWorker, {
      favorites: [baseURL + "/np", null, null, null, null, null, null, null],
    });
    await h.sleep(500);
    // no pinned tab was created
    const anyPinned = await serviceWorker.evaluate(
      () => new Promise((r) => chrome.tabs.query({ pinned: true }, (t) => r(t.length)))
    );
    expect(anyPinned).toBe(0);
    // clicking the favorite opens a NEW tab (doesn't reuse the existing one)
    const beforeNp = await serviceWorker.evaluate(
      () => new Promise((r) => chrome.tabs.query({}, (t) => r(t.filter((x) => (x.url || x.pendingUrl || "").includes("/np")).length)))
    );
    await h.openBarOn(page, serviceWorker);
    await page.locator(".fave").first().click();
    await h.sleep(500);
    const afterNp = await serviceWorker.evaluate(
      () => new Promise((r) => chrome.tabs.query({}, (t) => r(t.filter((x) => (x.url || x.pendingUrl || "").includes("/np")).length)))
    );
    expect(afterNp).toBe(beforeNp + 1); // opened a new tab
    await existing.close().catch(() => {});
  });
});
