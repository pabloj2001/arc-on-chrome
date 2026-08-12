const { test, expect } = require("./fixtures");
const h = require("./helpers");

test.describe("command palette & param pills", () => {
  test("typing / shows the command palette, including /export", async ({ page, serviceWorker }) => {
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "/");
    const s = await h.readState(page);
    const names = s.results.map((r) => r.title);
    expect(s.results.every((r) => r.type === "command")).toBe(true);
    expect(names.join(" ")).toContain("/favorite");
    expect(names.join(" ")).toContain("/export");
    expect(names.join(" ")).toContain("/reload");
  });

  test("selecting a command enters param mode with a pill per parameter", async ({ page, serviceWorker }) => {
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "/shortcut");
    await h.press(page, "Enter"); // choose the highlighted command
    const s = await h.readState(page);
    expect(s.paramPills.length).toBe(2); // alias + url
    expect(s.paramPills[0].active).toBe(true);
  });

  test("Tab advances params; Space does NOT advance", async ({ page, serviceWorker }) => {
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "/shortcut");
    await h.press(page, "Enter");
    // still on param 0
    let s = await h.readState(page);
    const firstActive = s.paramPills.findIndex((p) => p.active);
    expect(firstActive).toBe(0);
    // Space should keep us on param 0 (space-to-advance was removed)
    await h.press(page, "Space");
    s = await h.readState(page);
    expect(s.paramPills.findIndex((p) => p.active)).toBe(0);
    // Tab advances to param 1
    await h.press(page, "Tab");
    s = await h.readState(page);
    expect(s.paramPills.findIndex((p) => p.active)).toBe(1);
  });

  test("Shift+Tab on the first param is a no-op (does not close the bar)", async ({ page, serviceWorker }) => {
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "/shortcut");
    await h.press(page, "Enter");
    await h.press(page, "Shift+Tab");
    expect(await h.barExists(page)).toBe(true);
    const s = await h.readState(page);
    expect(s.paramPills.findIndex((p) => p.active)).toBe(0);
  });

  test("running with required params empty flashes them invalid without running", async ({ page, serviceWorker }) => {
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "/favorite");
    await h.press(page, "Enter");
    await h.press(page, "Enter"); // run with both params empty
    const s = await h.readState(page);
    expect(s.paramPills.some((p) => p.invalid)).toBe(true);
    expect(await h.barExists(page)).toBe(true);
  });

  test("running a valid command keeps the bar open, clears the text, and shows a confirmation", async ({ page, serviceWorker }) => {
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "/shortcut");
    await h.press(page, "Enter");
    await h.type(page, "gg");
    await h.press(page, "Tab");
    await h.type(page, "https://gg.example/%s");
    await h.press(page, "Enter");
    const s = await h.readState(page);
    expect(await h.barExists(page)).toBe(true);
    expect(s.value).toBe("");
    expect(s.status.toLowerCase()).toContain("shortcut");
    const stored = await h.getStorage(serviceWorker, "arcShortcuts");
    expect(stored.arcShortcuts.gg).toBe("https://gg.example/%s");
  });

  test("Backspace on an empty first param backs out to the typed command text", async ({ page, serviceWorker }) => {
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "/unshortcut");
    await h.press(page, "Enter");
    let s = await h.readState(page);
    expect(s.paramPills.length).toBe(1);
    await h.press(page, "Backspace");
    s = await h.readState(page);
    expect(s.paramPills.length).toBe(0);
    expect(s.value).toContain("/unshortcut");
  });
});
