const { test, expect } = require("./fixtures");
const h = require("./helpers");

test.describe("/export settings", () => {
  test("copies favorites + shortcuts to the clipboard as versioned JSON", async ({ page, serviceWorker }) => {
    await h.seedSettings(serviceWorker, {
      favorites: ["https://github.com", null, "https://news.ycombinator.com", null, null, null, null, null],
      shortcuts: { gh: "https://github.com/search?q=%s", yt: "https://youtube.com/results?search_query=%s" },
    });
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "/export");
    await h.press(page, "Enter");
    await h.sleep(400);

    const s = await h.readState(page);
    expect(s.status.toLowerCase()).toContain("clipboard");

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    const data = JSON.parse(clip);
    expect(data.type).toBe("arc-search-settings");
    expect(data.version).toBe(1);
    expect(data.favorites[0]).toBe("https://github.com");
    expect(data.favorites[2]).toBe("https://news.ycombinator.com");
    expect(data.shortcuts.gh).toBe("https://github.com/search?q=%s");
    expect(data.shortcuts.yt).toBe("https://youtube.com/results?search_query=%s");
    // export is a no-op navigation and keeps the bar open
    expect(await h.barExists(page)).toBe(true);
  });

  test("export reflects live edits made via /favorite and /shortcut", async ({ page, serviceWorker }) => {
    await h.openBarOn(page, serviceWorker);
    // add a shortcut through the command
    await h.type(page, "/shortcut");
    await h.press(page, "Enter");
    await h.type(page, "go");
    await h.press(page, "Tab");
    await h.type(page, "https://go/%s");
    await h.press(page, "Enter");
    await h.sleep(200);
    // now export
    await h.type(page, "/export");
    await h.press(page, "Enter");
    await h.sleep(300);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    const data = JSON.parse(clip);
    expect(data.shortcuts.go).toBe("https://go/%s");
  });
});

test.describe("/import settings", () => {
  test("restores favorites + shortcuts from the clipboard", async ({ page, serviceWorker }) => {
    const payload = JSON.stringify({
      type: "arc-search-settings",
      version: 1,
      exportedAt: new Date().toISOString(),
      favorites: ["https://example.com", null, null, null, null, null, null, null],
      shortcuts: { dd: "https://duckduckgo.com/?q=%s" },
    });
    await h.openBarOn(page, serviceWorker);
    await page.evaluate((t) => navigator.clipboard.writeText(t), payload);

    await h.type(page, "/import");
    await h.press(page, "Enter"); // enter param mode
    await h.press(page, "Enter"); // submit with empty optional param
    await h.sleep(400);

    const s = await h.readState(page);
    expect(s.status.toLowerCase()).toContain("imported");

    const stored = await h.getStorage(serviceWorker, ["arcFavorites", "arcShortcuts"]);
    expect(stored.arcFavorites[0]).toBe("https://example.com");
    expect(stored.arcShortcuts.dd).toBe("https://duckduckgo.com/?q=%s");
  });

  test("rejects invalid JSON without changing settings", async ({ page, serviceWorker }) => {
    await h.seedSettings(serviceWorker, {
      favorites: ["https://github.com", null, null, null, null, null, null, null],
      shortcuts: { gh: "https://github.com/search?q=%s" },
    });
    await h.openBarOn(page, serviceWorker);
    await page.evaluate(() => navigator.clipboard.writeText("not json at all"));

    await h.type(page, "/import");
    await h.press(page, "Enter"); // enter param mode
    await h.press(page, "Enter"); // submit with empty optional param
    await h.sleep(400);

    const s = await h.readState(page);
    expect(s.status.toLowerCase()).toContain("invalid");

    const stored = await h.getStorage(serviceWorker, ["arcFavorites", "arcShortcuts"]);
    expect(stored.arcFavorites[0]).toBe("https://github.com");
    expect(stored.arcShortcuts.gh).toBe("https://github.com/search?q=%s");
  });
});
