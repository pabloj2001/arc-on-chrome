const { test, expect } = require("./fixtures");
const h = require("./helpers");

test.describe("contexts (ephemeral tab groups)", () => {
  test("contexts row shows a default chip (1), the context chip (2), and a + chip", async ({ page, serviceWorker }) => {
    const res = await h.createContext(serviceWorker, "work");
    expect(res.ok).toBe(true);
    await h.openBarOn(page, serviceWorker);
    const s = await h.readState(page);
    const def = s.contextChips.find((c) => c.isDefault);
    const add = s.contextChips.find((c) => c.isAdd);
    const work = s.contextChips.find((c) => c.name.includes("work"));
    expect(def).toBeTruthy();
    expect(def.num).toBe("1");
    expect(work).toBeTruthy();
    expect(work.num).toBe("2"); // default=1, first context=2
    expect(add).toBeTruthy();
    expect(s.hasContext).toBe(true); // active context tints the bar
  });

  test("Ctrl+1 switches to default, Ctrl+2 switches to the first context", async ({ page, serviceWorker }) => {
    await h.createContext(serviceWorker, "work");
    await h.openBarOn(page, serviceWorker);
    await h.press(page, "Control+1"); // default
    let s = await h.readState(page);
    expect(s.hasContext).toBe(false);
    await h.press(page, "Control+2"); // back to the context
    s = await h.readState(page);
    expect(s.hasContext).toBe(true);
  });

  test("Left-arrow at the start temporarily exits the context to default", async ({ page, serviceWorker }) => {
    await h.createContext(serviceWorker, "work");
    await h.openBarOn(page, serviceWorker);
    expect((await h.readState(page)).hasContext).toBe(true);
    await h.press(page, "ArrowLeft");
    expect((await h.readState(page)).hasContext).toBe(false);
  });

  test("Backspace on an empty bar temporarily exits the context", async ({ page, serviceWorker }) => {
    await h.createContext(serviceWorker, "work");
    await h.openBarOn(page, serviceWorker);
    expect((await h.readState(page)).hasContext).toBe(true);
    await h.press(page, "Backspace");
    expect((await h.readState(page)).hasContext).toBe(false);
  });

  test("clicking the back-arrow icon temporarily exits the context", async ({ page, serviceWorker }) => {
    await h.createContext(serviceWorker, "work");
    await h.openBarOn(page, serviceWorker);
    expect((await h.readState(page)).hasContext).toBe(true);
    await page.locator("#arc-search-bar-host").evaluate((host) => {
      host.shadowRoot.querySelector(".icon").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await h.sleep(150);
    expect((await h.readState(page)).hasContext).toBe(false);
  });

  test("Cmd+L shows the current tab's context (default when the tab is ungrouped)", async ({ page, context, serviceWorker, baseURL }) => {
    // active context is "work" (groups the fixture tab)
    await h.createContext(serviceWorker, "work");
    // a brand-new ungrouped tab
    const other = await h.openTabAt(context, baseURL + "/other");
    await other.bringToFront();
    await h.openBar(serviceWorker, { opensInCurrentTab: true, useCurrentUrl: true });
    await h.waitForBar(other);
    const s = await h.readState(other);
    expect(s.hasContext).toBe(false); // ungrouped tab -> default, not the active "work"
    await other.close().catch(() => {});
  });

  test("a tab opened from the bar while a context is active joins that context's group", async ({ page, serviceWorker, baseURL }) => {
    const res = await h.createContext(serviceWorker, "work");
    await h.openBarOn(page, serviceWorker);
    await h.type(page, baseURL + "/joined");
    await h.press(page, "Enter");
    await h.sleep(600);
    const inGroup = await serviceWorker.evaluate(
      (gid) => new Promise((r) => chrome.tabs.query({ groupId: gid }, (t) => r(t.map((x) => x.url || x.pendingUrl || "")))),
      res.groupId
    );
    expect(inGroup.some((u) => u.includes("/joined"))).toBe(true);
  });

  test("context limit is 5", async ({ context, serviceWorker, baseURL }) => {
    const pages = [];
    for (let i = 0; i < 5; i++) {
      const p = await h.openTabAt(context, `${baseURL}/ctx-${i}`);
      await p.bringToFront();
      const res = await h.createContext(serviceWorker, `ctx${i}`);
      expect(res.ok).toBe(true);
      pages.push(p);
    }
    const sixth = await h.createContext(serviceWorker, "ctx5");
    expect(sixth.ok).toBe(false);
    expect(sixth.reason).toBe("limit");
    for (const p of pages) await p.close().catch(() => {});
  });
});
