const { test, expect } = require("./fixtures");
const h = require("./helpers");

test.describe("search / url modes", () => {
  test("plain words are searched on Google in a new tab", async ({ page, serviceWorker }) => {
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "hello world");
    await h.press(page, "Enter");
    const url = await h.lastNewTabUrl(serviceWorker);
    expect(url).toContain("google.com/search");
    expect(url).toContain("hello");
    // bar closes on submit
    expect(await h.barExists(page)).toBe(false);
  });

  test("a URL-shaped query opens as a URL in a new tab", async ({ page, serviceWorker }) => {
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "example.org");
    await h.press(page, "Enter");
    const url = await h.lastNewTabUrl(serviceWorker);
    expect(url).toContain("example.org");
    expect(url).not.toContain("google.com/search");
  });

  test("intranet path with trailing query keeps the query in the path", async ({ page, serviceWorker }) => {
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "go/glean my search");
    await h.press(page, "Enter");
    const url = await h.lastNewTabUrl(serviceWorker);
    // "go/glean my search" -> http://go/glean%20my%20search (not a web search)
    expect(url).toMatch(/^https?:\/\/go\/glean/);
    expect(url).not.toContain("google.com/search");
  });

  test("Cmd+L mode prefills the current URL and selects it", async ({ page, serviceWorker, baseURL }) => {
    await h.openBarOn(page, serviceWorker, {
      opensInCurrentTab: true,
      useCurrentUrl: true,
    });
    const s = await h.readState(page);
    expect(s.value).toBe(baseURL + "/");
    // whole value is selected for easy replace
    expect(s.selStart).toBe(0);
    expect(s.selEnd).toBe((baseURL + "/").length);
  });

  test("empty submit just closes the bar", async ({ page, serviceWorker }) => {
    await h.openBarOn(page, serviceWorker);
    const before = await h.newTabUrls(serviceWorker);
    await h.press(page, "Enter");
    expect(await h.barExists(page)).toBe(false);
    const after = await h.newTabUrls(serviceWorker);
    expect(after.length).toBe(before.length);
  });
});
