const { test, expect } = require("./fixtures");
const h = require("./helpers");

const MODAL_HOST = "arc-settings-modal-host";

async function readSettings(sw) {
  return sw.evaluate(
    () => new Promise((r) => chrome.storage.local.get("arcSettings", (v) => r(v.arcSettings || null)))
  );
}

async function modalOpen(page) {
  return page.evaluate((id) => !!document.getElementById(id), MODAL_HOST);
}

// /settings enters param mode with value suggestions; the modal opens by
// choosing the empty "Open settings…" option (Enter with no field typed).
async function openModalViaCommand(page, sw) {
  await h.openBarOn(page, sw);
  await h.type(page, "/settings");
  await h.press(page, "Enter"); // choose the command -> param mode + suggestions
  await h.press(page, "Enter"); // empty setting -> open the modal
  await h.sleep(200);
}

async function modalInputs(page) {
  return page.evaluate((id) => {
    const host = document.getElementById(id);
    if (!host) return null;
    return [...host.shadowRoot.querySelectorAll("input")].map((i) => ({
      token: i.getAttribute("data-token"),
      value: i.value,
    }));
  }, MODAL_HOST);
}

test.describe("settings (/settings command + modal)", () => {
  test("/settings <name> <value> updates storage without opening the modal", async ({ page, serviceWorker }) => {
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "/settings group-expiry 12h");
    await h.press(page, "Enter");
    await h.sleep(200);
    const s = await readSettings(serviceWorker);
    expect(s.groupedExpiryMs).toBe(12 * 3600000);
    expect(await modalOpen(page)).toBe(false);
  });

  test("/settings default-expiry accepts m/h/d durations", async ({ page, serviceWorker }) => {
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "/settings default-expiry 90m");
    await h.press(page, "Enter");
    await h.sleep(200);
    const s = await readSettings(serviceWorker);
    expect(s.ungroupedExpiryMs).toBe(90 * 60000);
  });

  test("/settings with a bad value reports an error and leaves storage untouched", async ({ page, serviceWorker }) => {
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "/settings group-expiry soon");
    await h.press(page, "Enter");
    await h.sleep(200);
    const st = await h.readState(page);
    expect(st.status.toLowerCase()).toContain("invalid");
    const s = await readSettings(serviceWorker);
    expect(s).toBeNull(); // never written
  });

  test("/settings work-start / work-end set working hours; include-weekends toggles", async ({ page, serviceWorker }) => {
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "/settings work-start 9:00");
    await h.press(page, "Enter");
    await h.sleep(120);
    await h.type(page, "/settings work-end 5pm");
    await h.press(page, "Enter");
    await h.sleep(120);
    await h.type(page, "/settings include-weekends off");
    await h.press(page, "Enter");
    await h.sleep(150);
    const s = await readSettings(serviceWorker);
    expect(s.workStartMin).toBe(540);
    expect(s.workEndMin).toBe(1020);
    expect(s.includeWeekends).toBe(false);
  });

  test("/settings enters param mode with setting suggestions incl. an open-modal option", async ({ page, serviceWorker }) => {
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "/settings");
    await h.press(page, "Enter"); // choose the command -> param mode
    await h.sleep(120);
    const st = await h.readState(page);
    const sugg = st.results.filter((r) => r.type === "suggestion");
    const titles = sugg.map((r) => r.title);
    expect(titles).toContain("Open settings…");
    expect(titles).toContain("group-expiry");
    expect(titles).toContain("default-expiry");
  });

  test("/settings (no args) closes the bar and opens the modal prefilled from storage", async ({ page, serviceWorker }) => {
    // seed a known value so the modal shows it
    await serviceWorker.evaluate(
      () => new Promise((r) => chrome.storage.local.set({ arcSettings: { groupedExpiryMs: 8 * 3600000, ungroupedExpiryMs: 2 * 3600000 } }, r))
    );
    await openModalViaCommand(page, serviceWorker);
    expect(await h.barExists(page)).toBe(false); // bar closed
    expect(await modalOpen(page)).toBe(true);
    const inputs = await modalInputs(page);
    const grp = inputs.find((i) => i.token === "group-expiry");
    const def = inputs.find((i) => i.token === "default-expiry");
    expect(grp.value).toBe("8h");
    expect(def.value).toBe("2h");
  });

  test("editing a field in the modal and saving persists it; Escape closes", async ({ page, serviceWorker }) => {
    await openModalViaCommand(page, serviceWorker);
    expect(await modalOpen(page)).toBe(true);
    // set group-expiry to 3d and save
    await page.evaluate((id) => {
      const host = document.getElementById(id);
      const input = [...host.shadowRoot.querySelectorAll("input")].find(
        (i) => i.getAttribute("data-token") === "group-expiry"
      );
      input.focus();
      input.value = "3d";
    }, MODAL_HOST);
    await page.evaluate((id) => {
      const host = document.getElementById(id);
      host.shadowRoot.querySelector(".btn.save").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }, MODAL_HOST);
    await h.sleep(200);
    expect(await modalOpen(page)).toBe(false);
    const s = await readSettings(serviceWorker);
    expect(s.groupedExpiryMs).toBe(3 * 86400000);
  });

  test("the modal renders working-hours + weekend toggle and saves them", async ({ page, serviceWorker }) => {
    await openModalViaCommand(page, serviceWorker);
    // work-start/work-end are text inputs prefilled from the default (00:00)
    const kinds = await page.evaluate((id) => {
      const host = document.getElementById(id);
      const q = (tok) =>
        [...host.shadowRoot.querySelectorAll("input")].find((i) => i.getAttribute("data-token") === tok);
      return {
        start: q("work-start").type,
        end: q("work-end").type,
        weekend: q("include-weekends").type,
      };
    }, MODAL_HOST);
    expect(kinds).toEqual({ start: "text", end: "text", weekend: "checkbox" });
    // set 9:00–17:00 and turn weekends off, then save
    await page.evaluate((id) => {
      const host = document.getElementById(id);
      const sr = host.shadowRoot;
      const q = (tok) => [...sr.querySelectorAll("input")].find((i) => i.getAttribute("data-token") === tok);
      q("work-start").value = "9:00";
      q("work-end").value = "17:00";
      q("include-weekends").checked = false;
      sr.querySelector(".btn.save").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }, MODAL_HOST);
    await h.sleep(200);
    const s = await readSettings(serviceWorker);
    expect(s.workStartMin).toBe(540);
    expect(s.workEndMin).toBe(1020);
    expect(s.includeWeekends).toBe(false);
  });

  test("an invalid modal value blocks save and shows an error", async ({ page, serviceWorker }) => {
    await openModalViaCommand(page, serviceWorker);
    await page.evaluate((id) => {
      const host = document.getElementById(id);
      const input = [...host.shadowRoot.querySelectorAll("input")].find(
        (i) => i.getAttribute("data-token") === "group-expiry"
      );
      input.value = "nope";
      host.shadowRoot.querySelector(".btn.save").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }, MODAL_HOST);
    await h.sleep(150);
    expect(await modalOpen(page)).toBe(true); // still open
    const err = await page.evaluate((id) => {
      const host = document.getElementById(id);
      return host.shadowRoot.querySelector(".error").textContent;
    }, MODAL_HOST);
    expect(err.length).toBeGreaterThan(0);
    const s = await readSettings(serviceWorker);
    expect(s).toBeNull(); // not persisted
  });

  test("the modal has General + Shortcuts sections; shortcuts can be added and removed", async ({ page, serviceWorker }) => {
    // seed one shortcut so the list isn't empty
    await h.seedSettings(serviceWorker, { shortcuts: { go: "https://go/%s" } });
    await openModalViaCommand(page, serviceWorker);
    // sidebar shows both sections
    const navs = await page.evaluate((id) => {
      const host = document.getElementById(id);
      return [...host.shadowRoot.querySelectorAll(".nav-item")].map((n) => n.textContent);
    }, MODAL_HOST);
    expect(navs).toEqual(["General", "Expiry", "Shortcuts"]);
    // switch to Shortcuts and read the list
    await page.evaluate((id) => {
      const host = document.getElementById(id);
      [...host.shadowRoot.querySelectorAll(".nav-item")].find((n) => n.textContent === "Shortcuts").click();
    }, MODAL_HOST);
    await h.sleep(100);
    let aliases = await page.evaluate((id) => {
      const host = document.getElementById(id);
      return [...host.shadowRoot.querySelectorAll(".sc-alias")].map((a) => a.textContent);
    }, MODAL_HOST);
    expect(aliases).toContain("go");
    // add a new shortcut
    await page.evaluate((id) => {
      const host = document.getElementById(id);
      const sr = host.shadowRoot;
      sr.querySelector(".sc-add-alias").value = "gh";
      sr.querySelector(".sc-add-url").value = "https://github.com/search?q=%s";
      sr.querySelector(".sc-add-btn").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }, MODAL_HOST);
    await h.sleep(200);
    let stored = await serviceWorker.evaluate(
      () => new Promise((r) => chrome.storage.local.get("arcShortcuts", (v) => r(v.arcShortcuts || {})))
    );
    expect(stored.gh).toBe("https://github.com/search?q=%s");
    // remove the seeded "go" shortcut
    await page.evaluate((id) => {
      const host = document.getElementById(id);
      host.shadowRoot.querySelector('.sc-remove[data-alias="go"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }, MODAL_HOST);
    await h.sleep(200);
    stored = await serviceWorker.evaluate(
      () => new Promise((r) => chrome.storage.local.get("arcShortcuts", (v) => r(v.arcShortcuts || {})))
    );
    expect(stored.go).toBeUndefined();
    expect(stored.gh).toBe("https://github.com/search?q=%s");
  });
});

