const { test, expect } = require("./fixtures");
const h = require("./helpers");

test.describe("command argument suggestions", () => {
  test("/unshortcut suggests existing aliases and selecting one removes it", async ({ page, serviceWorker }) => {
    await h.seedSettings(serviceWorker, {
      shortcuts: { go: "https://go/%s", gh: "https://github.com/search?q=%s" },
    });
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "/unshortcut");
    await h.press(page, "Enter"); // choose command -> param mode + suggestions
    await h.sleep(120);
    let st = await h.readState(page);
    const titles = st.results.filter((r) => r.type === "suggestion").map((r) => r.title);
    expect(titles).toContain("go");
    expect(titles).toContain("gh");
    // arrow to the first suggestion and choose it (runs immediately)
    await h.press(page, "ArrowDown");
    await h.press(page, "Enter");
    await h.sleep(200);
    const stored = await serviceWorker.evaluate(
      () => new Promise((r) => chrome.storage.local.get("arcShortcuts", (v) => r(v.arcShortcuts || {})))
    );
    // exactly one alias removed (whichever sorted first: "gh")
    expect(Object.keys(stored).length).toBe(1);
    expect(stored.gh).toBeUndefined();
  });

  test("/unshortcut suggestions filter as you type", async ({ page, serviceWorker }) => {
    await h.seedSettings(serviceWorker, {
      shortcuts: { go: "https://go/%s", gh: "https://github.com/search?q=%s", maps: "https://maps.google.com/?q=%s" },
    });
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "/unshortcut");
    await h.press(page, "Enter");
    await h.type(page, "ma");
    await h.sleep(120);
    const st = await h.readState(page);
    const titles = st.results.filter((r) => r.type === "suggestion").map((r) => r.title);
    expect(titles).toEqual(["maps"]);
  });

  test("/deletegroup suggests existing groups", async ({ page, serviceWorker }) => {
    await h.createGroup(serviceWorker, "work");
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "/deletegroup");
    await h.press(page, "Enter");
    await h.sleep(120);
    const st = await h.readState(page);
    const titles = st.results.filter((r) => r.type === "suggestion").map((r) => r.title);
    expect(titles).toContain("work");
  });

  test("/unfavorite suggests set favorites only", async ({ page, serviceWorker }) => {
    await h.seedSettings(serviceWorker, {
      favorites: ["https://a.com/", null, "https://c.com/", null, null, null, null, null],
    });
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "/unfavorite");
    await h.press(page, "Enter");
    await h.sleep(120);
    const st = await h.readState(page);
    const titles = st.results.filter((r) => r.type === "suggestion").map((r) => r.title);
    expect(titles.some((t) => t.startsWith("1 "))).toBe(true);
    expect(titles.some((t) => t.startsWith("3 "))).toBe(true);
    expect(titles.some((t) => t.startsWith("2 "))).toBe(false); // slot 2 is empty
  });
});
