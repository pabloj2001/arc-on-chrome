const { test, expect } = require("./fixtures");
const h = require("./helpers");

test.describe("keyword shortcuts (pills)", () => {
  test("alias + space arms a pill and clears the alias from the input", async ({ page, serviceWorker }) => {
    await h.seedSettings(serviceWorker, { shortcuts: { gh: "https://github.com/search?q=%s" } });
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "gh ");
    const s = await h.readState(page);
    expect(s.pillText).toContain("gh");
    expect(s.value).toBe("");
  });

  test("typing a query + Enter runs the shortcut with %s substituted, in a new tab", async ({ page, serviceWorker }) => {
    await h.seedSettings(serviceWorker, { shortcuts: { gh: "https://github.com/search?q=%s" } });
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "gh ");
    await h.type(page, "hello");
    await h.press(page, "Enter");
    const url = await h.lastNewTabUrl(serviceWorker);
    expect(url).toBe("https://github.com/search?q=hello");
  });

  // Regression: Enter runs the shortcut query and does not switch to an open
  // same-domain tab that isn't under the shortcut's base path.
  test("Enter runs the shortcut query, not an open same-domain tab", async ({ page, context, serviceWorker, baseURL }) => {
    await h.seedSettings(serviceWorker, { shortcuts: { ex: `${baseURL}/search?q=%s` } });
    const open = await h.openTabAt(context, baseURL + "/home");
    await page.bringToFront();
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "ex ");
    await h.type(page, "home");
    await h.press(page, "Enter");
    const url = await h.lastNewTabUrl(serviceWorker);
    expect(url).toBe(`${baseURL}/search?q=home`);
    await open.close().catch(() => {});
  });

  // Regression: choosing a highlighted history result under a shortcut navigates
  // to that exact URL, not to some other open same-domain tab.
  test("choosing a history result navigates to its exact URL, not an open same-domain tab", async ({ page, context, serviceWorker, baseURL }) => {
    await h.seedSettings(serviceWorker, { shortcuts: { ex: `${baseURL}/%s` } });
    await h.seedHistory(serviceWorker, [`${baseURL}/deep/article-about-cats`]);
    const open = await h.openTabAt(context, baseURL + "/dashboard");
    await page.bringToFront();
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "ex ");
    await h.type(page, "cats");
    const s = await h.readState(page);
    expect(s.results[0].url).toContain("article-about-cats");
    expect(s.activeIndex).toBe(0);
    await h.press(page, "Enter");
    const url = await h.lastNewTabUrl(serviceWorker);
    expect(url).toContain("article-about-cats");
    expect(url).not.toContain("dashboard");
    await open.close().catch(() => {});
  });

  test("clicking a scoped open-tab result switches to that tab (no duplicate)", async ({ page, context, serviceWorker, baseURL }) => {
    await h.seedSettings(serviceWorker, { shortcuts: { ex: `${baseURL}/%s` } });
    const open = await h.openTabAt(context, baseURL + "/home");
    await page.bringToFront();
    const before = await h.tabCount(serviceWorker);
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "ex ");
    await h.type(page, "home");
    await page.locator('.result[data-type="tab"]').first().click();
    await h.sleep(300);
    expect(await h.tabCount(serviceWorker)).toBe(before); // switched, not created
    const active = await h.activeTab(serviceWorker);
    expect(active.url).toBe(`${baseURL}/home`);
    await open.close().catch(() => {});
  });

  test("empty-query Backspace dismisses the pill and restores the alias word; next space does not re-arm", async ({ page, serviceWorker }) => {
    await h.seedSettings(serviceWorker, { shortcuts: { gh: "https://github.com/search?q=%s" } });
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "gh ");
    let s = await h.readState(page);
    expect(s.pillText).toContain("gh");
    await h.press(page, "Backspace");
    s = await h.readState(page);
    expect(s.pillText).toBe(""); // pill gone
    expect(s.value).toBe("gh"); // alias word restored
    await h.type(page, " ");
    s = await h.readState(page);
    expect(s.pillText).toBe("");
  });

  test("search result appears as the 2nd suggestion in shortcut mode and runs the shortcut query", async ({ page, serviceWorker, baseURL }) => {
    await h.seedSettings(serviceWorker, { shortcuts: { ex: `${baseURL}/search?q=%s` } });
    await h.seedHistory(serviceWorker, [`${baseURL}/search?q=cats-old`]);
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "ex ");
    await h.type(page, "cats");
    const s = await h.readState(page);
    expect(s.results.length).toBeGreaterThanOrEqual(2);
    expect(s.results[1].type).toBe("search");
    expect(s.results[1].url).toContain("127.0.0.1"); // engine label = destination host
    await h.press(page, "ArrowDown");
    await h.press(page, "Enter");
    const url = await h.lastNewTabUrl(serviceWorker);
    expect(url).toBe(`${baseURL}/search?q=cats`);
  });

  test("no lone search suggestion when there are no other suggestions", async ({ page, serviceWorker, baseURL }) => {
    await h.seedSettings(serviceWorker, { shortcuts: { ex: `${baseURL}/search?q=%s` } });
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "ex ");
    await h.type(page, "zzz-nothing-matches-this");
    const s = await h.readState(page);
    expect(s.results).toHaveLength(0);
  });

  test("clicking the pill removes it", async ({ page, serviceWorker }) => {
    await h.seedSettings(serviceWorker, { shortcuts: { gh: "https://github.com/search?q=%s" } });
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "gh ");
    await page.locator(".pill").click();
    await h.sleep(150);
    const s = await h.readState(page);
    expect(s.pillText).toBe("");
  });
});
