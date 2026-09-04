const { test, expect } = require("./fixtures");
const h = require("./helpers");

test.describe("groups (Chrome tab groups)", () => {
  test("groups row shows a default chip (1), the group chip (2), and a + chip", async ({ page, serviceWorker }) => {
    const res = await h.createGroup(serviceWorker, "work");
    expect(res.ok).toBe(true);
    await h.openBarOn(page, serviceWorker);
    const s = await h.readState(page);
    const def = s.groupChips.find((c) => c.isDefault);
    const add = s.groupChips.find((c) => c.isAdd);
    const work = s.groupChips.find((c) => c.name.includes("work"));
    expect(def).toBeTruthy();
    expect(def.num).toBe("1");
    expect(work).toBeTruthy();
    expect(work.num).toBe("2"); // default=1, first group=2
    expect(add).toBeTruthy();
    expect(s.hasGroup).toBe(true); // active group tints the bar
  });

  test("Ctrl+1 switches to default, Ctrl+2 switches to the first group", async ({ page, serviceWorker }) => {
    await h.createGroup(serviceWorker, "work");
    await h.openBarOn(page, serviceWorker);
    await h.press(page, "Control+1"); // default
    let s = await h.readState(page);
    expect(s.hasGroup).toBe(false);
    await h.press(page, "Control+2"); // back to the group
    s = await h.readState(page);
    expect(s.hasGroup).toBe(true);
  });

  test("Left-arrow at the start temporarily exits the group to default", async ({ page, serviceWorker }) => {
    await h.createGroup(serviceWorker, "work");
    await h.openBarOn(page, serviceWorker);
    expect((await h.readState(page)).hasGroup).toBe(true);
    await h.press(page, "ArrowLeft");
    expect((await h.readState(page)).hasGroup).toBe(false);
  });

  test("Backspace on an empty bar temporarily exits the group", async ({ page, serviceWorker }) => {
    await h.createGroup(serviceWorker, "work");
    await h.openBarOn(page, serviceWorker);
    expect((await h.readState(page)).hasGroup).toBe(true);
    await h.press(page, "Backspace");
    expect((await h.readState(page)).hasGroup).toBe(false);
  });

  test("clicking the back-arrow icon temporarily exits the group", async ({ page, serviceWorker }) => {
    await h.createGroup(serviceWorker, "work");
    await h.openBarOn(page, serviceWorker);
    expect((await h.readState(page)).hasGroup).toBe(true);
    await page.locator("#arc-search-bar-host").evaluate((host) => {
      host.shadowRoot.querySelector(".icon").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await h.sleep(150);
    expect((await h.readState(page)).hasGroup).toBe(false);
  });

  test("Cmd+L shows the current tab's group (default when the tab is ungrouped)", async ({ page, context, serviceWorker, baseURL }) => {
    // active group is "work" (groups the fixture tab)
    await h.createGroup(serviceWorker, "work");
    // a brand-new ungrouped tab
    const other = await h.openTabAt(context, baseURL + "/other");
    await other.bringToFront();
    await h.openBar(serviceWorker, { opensInCurrentTab: true, useCurrentUrl: true });
    await h.waitForBar(other);
    const s = await h.readState(other);
    expect(s.hasGroup).toBe(false); // ungrouped tab -> default, not the active "work"
    await other.close().catch(() => {});
  });

  test("opening the bar adopts the current tab's group (ungrouped tab -> default, even with a group active)", async ({ page, context, serviceWorker, baseURL }) => {
    // "work" is created from the fixture tab and becomes the globally-active group
    await h.createGroup(serviceWorker, "work");
    // open the bar on the grouped fixture tab -> adopts "work"
    await h.openBarOn(page, serviceWorker);
    expect((await h.readState(page)).hasGroup).toBe(true);
    await h.press(page, "Escape");
    // now view a brand-new ungrouped tab and open the bar normally (not cmd+L)
    const other = await h.openTabAt(context, baseURL + "/plain");
    await other.bringToFront();
    await h.openBarOn(other, serviceWorker);
    expect((await h.readState(other)).hasGroup).toBe(false); // adopts default, not "work"
    await other.close().catch(() => {});
  });

  test("a tab opened from the bar on a grouped tab joins that tab's group", async ({ page, context, serviceWorker, baseURL }) => {
    // group the fixture tab as "work"
    const res = await h.createGroup(serviceWorker, "work");
    // open the bar normally on the grouped tab and open a URL
    await h.openBarOn(page, serviceWorker);
    await h.type(page, baseURL + "/adopted");
    await h.press(page, "Enter");
    await h.sleep(600);
    const inGroup = await serviceWorker.evaluate(
      (gid) => new Promise((r) => chrome.tabs.query({ groupId: gid }, (t) => r(t.map((x) => x.url || x.pendingUrl || "")))),
      res.groupId
    );
    expect(inGroup.some((u) => u.includes("/adopted"))).toBe(true);
  });

  test("a tab opened from the bar while a group is active joins that group", async ({ page, serviceWorker, baseURL }) => {
    const res = await h.createGroup(serviceWorker, "work");
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

  test("the switcher mirrors multiple open groups (no 5-group cap)", async ({ context, serviceWorker, baseURL }) => {
    const pages = [];
    for (let i = 0; i < 6; i++) {
      const p = await h.openTabAt(context, `${baseURL}/g-${i}`);
      await p.bringToFront();
      const res = await h.createGroup(serviceWorker, `g${i}`);
      expect(res.ok).toBe(true); // every group creates successfully — unbounded
      pages.push(p);
    }
    const last = pages[pages.length - 1];
    await h.openBarOn(last, serviceWorker);
    const s = await h.readState(last);
    const named = s.groupChips.filter((c) => !c.isDefault && !c.isAdd);
    expect(named.length).toBeGreaterThanOrEqual(6);
    for (const p of pages) await p.close().catch(() => {});
  });

  test("with 3+ groups only the active chip shows its name; the rest reveal it on hover", async ({ context, serviceWorker, baseURL }) => {
    const pages = [];
    for (let i = 0; i < 3; i++) {
      const p = await h.openTabAt(context, `${baseURL}/c-${i}`);
      await p.bringToFront();
      const res = await h.createGroup(serviceWorker, `grp${i}`);
      expect(res.ok).toBe(true);
      pages.push(p);
    }
    const last = pages[pages.length - 1]; // its group (grp2) is the active one
    await h.openBarOn(last, serviceWorker);

    const info = await last.evaluate((host) => {
      const sr = document.getElementById(host).shadowRoot;
      const row = sr.querySelector(".contexts-row");
      const chips = [...row.querySelectorAll(".ctx-chip")].filter(
        (c) => !c.classList.contains("ctx-add")
      );
      return {
        collapsed: row.classList.contains("ctx-collapsed"),
        chips: chips.map((c) => {
          const cname = c.querySelector(".ctx-cname");
          return {
            active: c.classList.contains("active"),
            name: cname ? cname.textContent : "",
            shown: cname ? getComputedStyle(cname).opacity !== "0" : false,
          };
        }),
      };
    }, h.HOST);

    expect(info.collapsed).toBe(true);
    // The name is present in the DOM for every chip, but only the active one is
    // visible; the rest are collapsed (opacity 0 / max-width 0) until hovered.
    const shown = info.chips.filter((c) => c.shown);
    expect(shown.length).toBe(1);
    expect(shown[0].active).toBe(true);
    expect(shown[0].name).toContain("grp2");
    // A non-active chip keeps its name in the DOM, just hidden (opacity 0).
    const hiddenNamed = info.chips.filter((c) => !c.shown && c.name);
    expect(hiddenNamed.length).toBeGreaterThanOrEqual(1);

    // Hovering a collapsed (non-active) chip slides/expands its name in.
    const groupTwo = last
      .locator(".ctx-chip")
      .filter({ has: last.locator(".ctx-num", { hasText: /^2$/ }) });
    await groupTwo.hover();
    await h.sleep(300); // let the expand/fade transition finish
    const revealedOpacity = await groupTwo.evaluate(
      (c) => getComputedStyle(c.querySelector(".ctx-cname")).opacity
    );
    expect(Number(revealedOpacity)).toBeGreaterThan(0.5);

    for (const p of pages) await p.close().catch(() => {});
  });

  test("a 'Ctrl +' hint precedes the chips", async ({ page, serviceWorker }) => {
    await h.createGroup(serviceWorker, "work");
    await h.openBarOn(page, serviceWorker);
    const hint = await page.evaluate((host) => {
      const row = document.getElementById(host).shadowRoot.querySelector(".contexts-row");
      const el = row.querySelector(".ctx-hint");
      return { text: el ? el.textContent : null, isFirst: row.firstElementChild === el };
    }, h.HOST);
    expect(hint.text).toBe("Ctrl +");
    expect(hint.isFirst).toBe(true);
  });

  test("selecting a group animates its name open and collapses the previously active one", async ({ context, serviceWorker, baseURL }) => {
    const pages = [];
    for (let i = 0; i < 3; i++) {
      const p = await h.openTabAt(context, `${baseURL}/s-${i}`);
      await p.bringToFront();
      const res = await h.createGroup(serviceWorker, `grp${i}`);
      expect(res.ok).toBe(true);
      pages.push(p);
    }
    const last = pages[pages.length - 1]; // grp2 active
    await h.openBarOn(last, serviceWorker);
    await h.press(last, "Control+1"); // switch to the default space
    await h.sleep(320); // let the expand/collapse transition settle
    const op = await last.evaluate((host) => {
      const row = document.getElementById(host).shadowRoot.querySelector(".contexts-row");
      const chips = [...row.querySelectorAll(".ctx-chip")];
      const byNum = (n) => chips.find((c) => c.querySelector(".ctx-num") && c.querySelector(".ctx-num").textContent === n);
      const opacity = (c) => (c ? getComputedStyle(c.querySelector(".ctx-cname")).opacity : null);
      return { def: opacity(byNum("1")), grp2: opacity(byNum("4")) };
    }, h.HOST);
    // Default (now active) slid its name open; the previously active grp2 collapsed.
    expect(Number(op.def)).toBeGreaterThan(0.5);
    expect(Number(op.grp2)).toBeLessThan(0.5);
    for (const p of pages) await p.close().catch(() => {});
  });

  test("deletegroup closes the group's tabs", async ({ page, serviceWorker, baseURL }) => {
    const res = await h.createGroup(serviceWorker, "temp");
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "/deletegroup");
    await h.press(page, "Enter"); // choose the highlighted command
    await h.type(page, "temp"); // fill the name param
    await h.press(page, "Enter"); // run
    await h.sleep(500);
    const stillThere = await serviceWorker.evaluate(
      (gid) => new Promise((r) => chrome.tabs.query({ groupId: gid }, (t) => r(t.length))),
      res.groupId
    );
    expect(stillThere).toBe(0);
  });
});
