const { test, expect } = require("./fixtures");
const h = require("./helpers");

// Read a tab's groupId by URL substring (polling until grouped or timeout).
function groupIdOfUrl(sw, substr, wantGrouped = true) {
  return sw.evaluate(
    ({ s, want }) =>
      new Promise((resolve) => {
        const start = Date.now();
        const find = () =>
          chrome.tabs.query({}, (tabs) => {
            const t = tabs.find((x) => (x.url || x.pendingUrl || "").includes(s));
            if (!t) return resolve("notfound");
            const grouped = t.groupId != null && t.groupId !== -1;
            if (want && grouped) return resolve(t.groupId);
            if (Date.now() - start > 1200) return resolve(t.groupId);
            setTimeout(find, 80);
          });
        find();
      }),
    { s: substr, want: wantGrouped }
  );
}

// Simulate the browser regaining focus (as the OS does when opening an external
// link) so the extension snapshots the current tab's group as the adopt hint.
function simulateFocusIn(sw) {
  return sw.evaluate(
    () =>
      new Promise((r) =>
        chrome.windows.getCurrent((w) => {
          onWindowFocusChanged(w.id);
          setTimeout(r, 120); // let the async active-tab query store the hint
        })
      )
  );
}

function clearAdoptHint(sw) {
  return sw.evaluate(
    () => new Promise((r) => chrome.storage.session.remove("arcExternalAdopt", r))
  );
}

// Open a tab the way an external app would: focused, real URL, no opener, and
// NOT via the extension's own openManagedTab path.
function openExternalLike(sw, url) {
  return sw.evaluate(
    (u) => new Promise((r) => chrome.tabs.create({ url: u, active: true }, () => r())),
    url
  );
}

test.describe("external-open grouping", () => {
  test("an external open joins the group you were viewing (fresh focus hint)", async ({ page, serviceWorker, baseURL }) => {
    const res = await h.createGroup(serviceWorker, "work"); // fixture tab now grouped + active
    await simulateFocusIn(serviceWorker); // hint = "work"
    await openExternalLike(serviceWorker, baseURL + "/external");
    const gid = await groupIdOfUrl(serviceWorker, "/external");
    expect(gid).toBe(res.groupId);
  });

  test("an external open stays ungrouped when the current tab is in the default space", async ({ page, context, serviceWorker, baseURL }) => {
    await h.createGroup(serviceWorker, "work");
    // focus an UNGROUPED tab so the hint's context is the default space
    const plain = await h.openTabAt(context, baseURL + "/ungrouped");
    await plain.bringToFront();
    await simulateFocusIn(serviceWorker); // hint = null (default)
    await openExternalLike(serviceWorker, baseURL + "/external2");
    const gid = await groupIdOfUrl(serviceWorker, "/external2", false);
    expect(gid).toBe(-1); // not pulled into "work"
    await plain.close().catch(() => {});
  });

  test("a reopened/internal tab (no fresh focus) is NOT moved even with a group active", async ({ page, serviceWorker, baseURL }) => {
    await h.createGroup(serviceWorker, "work"); // group active + last viewed
    await clearAdoptHint(serviceWorker); // simulate: browser already focused (Ctrl+Shift+T)
    await openExternalLike(serviceWorker, baseURL + "/reopened");
    const gid = await groupIdOfUrl(serviceWorker, "/reopened", false);
    expect(gid).toBe(-1); // stayed ungrouped — no focus-from-outside
  });

  test("an in-page link (openerTabId set) is NOT moved even with a fresh hint", async ({ page, context, serviceWorker, baseURL }) => {
    await h.createGroup(serviceWorker, "work");
    await simulateFocusIn(serviceWorker); // fresh hint = "work"
    const opener = await h.openTabAt(context, baseURL + "/opener");
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
    const gid = await groupIdOfUrl(serviceWorker, "/child", false);
    expect(gid).toBe(-1);
    await opener.close().catch(() => {});
  });

  test("a bar-opened default-space tab is NOT auto-grouped even with a fresh hint", async ({ page, serviceWorker, baseURL }) => {
    await h.createGroup(serviceWorker, "work");
    await simulateFocusIn(serviceWorker); // fresh hint = "work"
    await h.openBarOn(page, serviceWorker);
    await h.press(page, "Control+1"); // switch the bar to the default space
    await h.type(page, baseURL + "/plain");
    await h.press(page, "Enter");
    const gid = await groupIdOfUrl(serviceWorker, "/plain", false);
    expect(gid).toBe(-1); // extension-created default-space tab stays ungrouped
  });
});
