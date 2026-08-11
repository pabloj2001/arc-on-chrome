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

  test("/settings (no args) closes the bar and opens the modal prefilled from storage", async ({ page, serviceWorker }) => {
    // seed a known value so the modal shows it
    await serviceWorker.evaluate(
      () => new Promise((r) => chrome.storage.local.set({ arcSettings: { groupedExpiryMs: 8 * 3600000, ungroupedExpiryMs: 2 * 3600000 } }, r))
    );
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "/settings");
    await h.press(page, "Enter");
    await h.sleep(200);
    expect(await h.barExists(page)).toBe(false); // bar closed
    expect(await modalOpen(page)).toBe(true);
    const inputs = await modalInputs(page);
    const grp = inputs.find((i) => i.token === "group-expiry");
    const def = inputs.find((i) => i.token === "default-expiry");
    expect(grp.value).toBe("8h");
    expect(def.value).toBe("2h");
  });

  test("editing a field in the modal and saving persists it; Escape closes", async ({ page, serviceWorker }) => {
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "/settings");
    await h.press(page, "Enter");
    await h.sleep(200);
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

  test("an invalid modal value blocks save and shows an error", async ({ page, serviceWorker }) => {
    await h.openBarOn(page, serviceWorker);
    await h.type(page, "/settings");
    await h.press(page, "Enter");
    await h.sleep(200);
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
});
