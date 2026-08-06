const { test, expect } = require("./fixtures");
const h = require("./helpers");

test.describe("keyboard, focus & lifecycle", () => {
  test("Escape closes the bar", async ({ page, serviceWorker }) => {
    await h.openBarOn(page, serviceWorker);
    expect(await h.barExists(page)).toBe(true);
    await h.press(page, "Escape");
    expect(await h.barExists(page)).toBe(false);
  });

  test("the input is focused on open", async ({ page, serviceWorker }) => {
    await h.openBarOn(page, serviceWorker);
    const focused = await page.evaluate((id) => {
      const sr = document.getElementById(id).shadowRoot;
      return sr.activeElement && sr.activeElement.tagName.toLowerCase() === "input";
    }, h.HOST);
    expect(focused).toBe(true);
  });

  test("clicking the backdrop closes the bar", async ({ page, serviceWorker }) => {
    await h.openBarOn(page, serviceWorker);
    await page.locator("#arc-search-bar-host").evaluate((host) => {
      host.shadowRoot.querySelector(".backdrop").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      host.shadowRoot.querySelector(".backdrop").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await h.sleep(200);
    expect(await h.barExists(page)).toBe(false);
  });

  test("while open, key events are blocked from reaching the page but still type into the bar", async ({ page, serviceWorker }) => {
    // Install a page-level capture listener BEFORE opening the bar.
    await page.evaluate(() => {
      window.__pageKeys = 0;
      document.addEventListener("keydown", () => { window.__pageKeys++; }, true);
    });
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "abc");
    const s = await h.readState(page);
    expect(s.value).toBe("abc"); // typed into the bar
    const pageKeys = await page.evaluate(() => window.__pageKeys);
    expect(pageKeys).toBe(0); // page never saw the keys
  });

  test("losing window focus (tab/window switch) closes the bar", async ({ page, serviceWorker }) => {
    await h.openBarOn(page, serviceWorker);
    expect(await h.barExists(page)).toBe(true);
    // Switching tabs/windows blurs the page window; the bar closes on that.
    // (Real tab backgrounding isn't emulated in headless, so drive the same
    // window 'blur' the browser fires on a switch.)
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await h.sleep(150);
    expect(await h.barExists(page)).toBe(false);
  });
});
