const { test, expect } = require("./fixtures");
const h = require("./helpers");

test.describe("results list, domain suggestion & autocomplete", () => {
  test("typing matches open tabs by title/url", async ({ page, context, serviceWorker, baseURL }) => {
    const open = await h.openTabAt(context, baseURL + "/dashboard");
    await page.bringToFront();
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "dashboard");
    const s = await h.readState(page);
    expect(s.results.some((r) => r.type === "tab" && r.url.includes("dashboard"))).toBe(true);
    await open.close().catch(() => {});
  });

  test("a complete URL you've never visited is offered as the top Website result", async ({ page, serviceWorker }) => {
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "neverseen-xyz.com");
    const s = await h.readState(page);
    expect(s.results[0].type).toBe("domain");
    expect(s.results[0].url).toContain("neverseen-xyz.com");
  });

  test("typing a base domain shows it as the top Website result even if only a subdomain was visited", async ({ page, serviceWorker }) => {
    await h.seedHistory(serviceWorker, ["https://observe.corp.foobar.com/page"]);
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "foobar.com");
    const s = await h.readState(page);
    expect(s.results[0].type).toBe("domain");
    expect(s.results[0].url).toContain("foobar.com");
    expect(s.results[0].url).not.toContain("observe.corp");
  });

  test("inline ghost autocompletes a visited domain; Right-arrow accepts it without navigating", async ({ page, serviceWorker }) => {
    await h.seedHistory(serviceWorker, ["https://foobar.com/"]);
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "foob");
    let s = await h.readState(page);
    expect(s.ghostSuffix).toBe("ar.com");
    const before = (await h.newTabUrls(serviceWorker)).length;
    await h.press(page, "ArrowRight");
    s = await h.readState(page);
    expect(s.value).toBe("foobar.com"); // ghost accepted into the text
    expect((await h.newTabUrls(serviceWorker)).length).toBe(before); // no navigation
  });

  test("root domains are preferred over subdomains for the ghost + Website result", async ({ page, serviceWorker }) => {
    await h.seedHistory(serviceWorker, [
      "https://google.com/",
      "https://drive.google.com/",
    ]);
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "goog");
    const s = await h.readState(page);
    expect(s.ghostSuffix).toBe("le.com"); // completes to google.com, not drive.google.com
    expect(s.results[0].type).toBe("domain");
    expect(s.results[0].url).toBe("https://google.com");
  });

  test("Search-for result is inserted as the 2nd suggestion whenever another suggestion exists", async ({ page, serviceWorker }) => {
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "foobar.com");
    const s = await h.readState(page);
    expect(s.results.length).toBeGreaterThanOrEqual(2);
    expect(s.results[0].type).toBe("domain");
    expect(s.results[1].type).toBe("search");
  });

  // Regression: with many matching open tabs, the search suggestion was dropped
  // by an early return; it must still be inserted.
  test("search suggestion still appears when many open tabs match", async ({ page, context, serviceWorker, baseURL }) => {
    const opened = [];
    for (let i = 0; i < 11; i++) {
      opened.push(await h.openTabAt(context, `${baseURL}/match-${i}`));
    }
    await page.bringToFront();
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "match");
    const s = await h.readState(page);
    expect(s.results.some((r) => r.type === "tab")).toBe(true);
    expect(s.results.some((r) => r.type === "search")).toBe(true);
    for (const p of opened) await p.close().catch(() => {});
  });

  test("no search suggestion when there are no other suggestions", async ({ page, serviceWorker }) => {
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "zzq-nothing-here-at-all");
    const s = await h.readState(page);
    // may be empty, but must never be a lone search row
    expect(s.results.every((r) => r.type !== "search") || s.results.length === 0).toBe(true);
  });
});
