const { test, expect } = require("./fixtures");
const h = require("./helpers");

// Poll a tab's groupId until it's grouped (or timeout), returning the groupId.
function groupIdOfUrl(sw, substr) {
  return sw.evaluate(
    (s) =>
      new Promise((resolve) => {
        const start = Date.now();
        const find = () =>
          chrome.tabs.query({}, (tabs) => {
            const t = tabs.find((x) =>
              (x.url || x.pendingUrl || "").includes(s)
            );
            if (!t) return resolve("notfound");
            if (t.groupId != null && t.groupId !== -1) return resolve(t.groupId);
            if (Date.now() - start > 2500) return resolve(t.groupId);
            setTimeout(find, 100);
          });
        find();
      }),
    substr
  );
}

test.describe("external-open grouping", () => {
  test("an externally-opened tab joins the last-used group", async ({ page, serviceWorker, baseURL }) => {
    const res = await h.createGroup(serviceWorker, "work"); // groups fixture tab + sets last-used
    // Simulate an OS/other-app open: a fresh, focused web tab with no opener,
    // created outside the extension's own openManagedTab path.
    await serviceWorker.evaluate(
      (url) => new Promise((r) => chrome.tabs.create({ url, active: true }, () => r())),
      baseURL + "/external"
    );
    const gid = await groupIdOfUrl(serviceWorker, "/external");
    expect(gid).toBe(res.groupId);
  });

  test("an in-page link (openerTabId set) is NOT pulled into the last-used group", async ({ page, context, serviceWorker, baseURL }) => {
    // Start clean so the opener (created before any group) isn't itself adopted.
    await serviceWorker.evaluate(
      () => new Promise((r) => chrome.storage.local.remove(["arcLastUsedGroupId", "arcActiveGroupId"], r))
    );
    // An ungrouped opener tab created BEFORE any group exists -> stays ungrouped.
    const opener = await h.openTabAt(context, baseURL + "/opener");
    await page.bringToFront();
    await h.createGroup(serviceWorker, "work"); // groups the fixture tab; last-used = work
    // A child tab that declares the (ungrouped) opener — Chrome keeps it with the
    // opener, and our grouper must not touch it because it has an openerTabId.
    await serviceWorker.evaluate(
      (url) =>
        new Promise((r) =>
          chrome.tabs.query({}, (tabs) => {
            const op = tabs.find((t) => (t.url || "").includes("/opener"));
            chrome.tabs.create({ url, active: true, openerTabId: op.id }, () => r());
          })
        ),
      baseURL + "/child"
    );
    await h.sleep(800);
    const gid = await serviceWorker.evaluate(
      (s) =>
        new Promise((r) =>
          chrome.tabs.query({}, (tabs) => {
            const t = tabs.find((x) => (x.url || x.pendingUrl || "").includes(s));
            r(t ? t.groupId : "notfound");
          })
        ),
      "/child"
    );
    expect(gid).toBe(-1); // stayed ungrouped
    await opener.close().catch(() => {});
  });

  test("a bar-opened default-space tab is NOT auto-grouped even with a last-used group", async ({ page, serviceWorker, baseURL }) => {
    await h.createGroup(serviceWorker, "work"); // last-used = work
    await h.openBarOn(page, serviceWorker);
    await h.press(page, "Control+1"); // switch the bar to the default space
    await h.type(page, baseURL + "/plain");
    await h.press(page, "Enter");
    await h.sleep(800);
    const gid = await serviceWorker.evaluate(
      (s) =>
        new Promise((r) =>
          chrome.tabs.query({}, (tabs) => {
            const t = tabs.find((x) => (x.url || x.pendingUrl || "").includes(s));
            r(t ? t.groupId : "notfound");
          })
        ),
      "/plain"
    );
    expect(gid).toBe(-1); // intentional default-space tab stays ungrouped
  });
});
