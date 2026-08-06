const { test, expect } = require("./fixtures");
const h = require("./helpers");

test.describe("favorites", () => {
  test("empty slots get the .empty class; set slots do not", async ({ page, serviceWorker }) => {
    await h.seedSettings(serviceWorker, {
      favorites: ["https://github.com", null, null, null, null, null, null, null],
    });
    await h.openBarOn(page, serviceWorker);
    const s = await h.readState(page);
    expect(s.faves).toHaveLength(8);
    expect(s.faves[0].empty).toBe(false);
    expect(s.faves[1].empty).toBe(true);
    expect(s.faves.filter((f) => f.empty)).toHaveLength(7);
  });

  test("clicking a favorite whose site is already open switches to that tab (no duplicate)", async ({ page, context, serviceWorker, baseURL }) => {
    const existing = await h.openTabAt(context, baseURL + "/foo/bar");
    await page.bringToFront();
    await h.seedSettings(serviceWorker, {
      // path-prefix favorite matches the deeper open path -> switches, no new tab
      favorites: [baseURL + "/foo", null, null, null, null, null, null, null],
    });
    const before = await h.tabCount(serviceWorker);
    await h.openBarOn(page, serviceWorker);
    await page.locator(".fave").first().click();
    await h.sleep(400);
    expect(await h.tabCount(serviceWorker)).toBe(before);
    const active = await h.activeTab(serviceWorker);
    expect(active.url).toContain("/foo/bar");
    await existing.close().catch(() => {});
  });

  test("clicking a favorite with no open tab opens it in a new tab", async ({ page, serviceWorker, baseURL }) => {
    await h.seedSettings(serviceWorker, {
      favorites: [baseURL + "/onlyhere", null, null, null, null, null, null, null],
    });
    await h.openBarOn(page, serviceWorker);
    await page.locator(".fave").first().click();
    await h.sleep(400);
    const url = await h.lastNewTabUrl(serviceWorker);
    expect(url).toContain("/onlyhere");
  });

  test("clicking an empty slot starts a /favorite command prefilled with the current URL", async ({ page, serviceWorker, baseURL }) => {
    await h.openBarOn(page, serviceWorker);
    await page.locator(".fave").nth(2).click();
    await h.sleep(200);
    const s = await h.readState(page);
    // command param mode is active with the url param prefilled to the page URL
    expect(s.paramPills.length).toBeGreaterThan(0);
    expect(s.value).toContain("127.0.0.1");
  });
});
