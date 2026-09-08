import { describe, it, expect } from "vitest";
import { expiredTabIds } from "../../src/background/groups";
import { UNGROUPED_EXPIRY_MS, GROUPED_EXPIRY_MS } from "../../src/shared/constants";

const NONE = -1;
const now = 10_000_000_000;

function tab(over = {}) {
  return { id: 1, groupId: NONE, active: false, pinned: false, windowId: 1, lastAccessed: now, ...over };
}

describe("expiredTabIds", () => {
  it("expires an ungrouped tab after 2h of inactivity", () => {
    const fresh = tab({ id: 1, lastAccessed: now - (UNGROUPED_EXPIRY_MS - 1000) });
    const stale = tab({ id: 2, lastAccessed: now - (UNGROUPED_EXPIRY_MS + 1000) });
    // second tab in the window so neither is the sole tab
    expect(expiredTabIds([fresh, stale], now)).toEqual([2]);
  });

  it("keeps an ungrouped tab that is younger than 2h but a grouped one survives to 24h", () => {
    const g1 = tab({ id: 1, groupId: 5, lastAccessed: now - (UNGROUPED_EXPIRY_MS + 5000) });
    const g2 = tab({ id: 2, groupId: 5, lastAccessed: now - (GROUPED_EXPIRY_MS - 1000) });
    // both grouped, both younger than 24h -> neither expires
    expect(expiredTabIds([g1, g2], now)).toEqual([]);
  });

  it("expires a grouped tab after 24h of inactivity", () => {
    const g1 = tab({ id: 1, groupId: 5, lastAccessed: now - (GROUPED_EXPIRY_MS + 1000) });
    const g2 = tab({ id: 2, groupId: 5, lastAccessed: now });
    expect(expiredTabIds([g1, g2], now)).toEqual([1]);
  });

  it("never expires the active or pinned tab", () => {
    const active = tab({ id: 1, active: true, lastAccessed: now - 10 * GROUPED_EXPIRY_MS });
    const pinned = tab({ id: 2, pinned: true, lastAccessed: now - 10 * GROUPED_EXPIRY_MS });
    const filler = tab({ id: 3, lastAccessed: now });
    expect(expiredTabIds([active, pinned, filler], now)).toEqual([]);
  });

  it("never expires the sole tab in a window", () => {
    const lone = tab({ id: 1, windowId: 7, lastAccessed: now - 10 * UNGROUPED_EXPIRY_MS });
    expect(expiredTabIds([lone], now)).toEqual([]);
  });

  it("treats unknown last-access (0) as fresh", () => {
    const unknown = tab({ id: 1, lastAccessed: 0 });
    const filler = tab({ id: 2, lastAccessed: now });
    expect(expiredTabIds([unknown, filler], now)).toEqual([]);
  });

  it("counts per-window so a stale tab still expires when its window has others", () => {
    const staleA = tab({ id: 1, windowId: 1, lastAccessed: now - (UNGROUPED_EXPIRY_MS + 1) });
    const freshA = tab({ id: 2, windowId: 1, lastAccessed: now });
    const loneB = tab({ id: 3, windowId: 2, lastAccessed: now - (UNGROUPED_EXPIRY_MS + 1) });
    // window 1 has 2 tabs -> tab 1 expires; window 2 has only tab 3 -> protected
    expect(expiredTabIds([staleA, freshA, loneB], now)).toEqual([1]);
  });

  it("honors custom thresholds from settings", () => {
    // 10-minute grouped / 5-minute ungrouped windows
    const thresholds = { groupedMs: 10 * 60000, ungroupedMs: 5 * 60000 };
    const grouped = tab({ id: 1, groupId: 5, lastAccessed: now - 6 * 60000 }); // <10m -> survives
    const ungrouped = tab({ id: 2, lastAccessed: now - 6 * 60000 }); // >5m -> expires
    expect(expiredTabIds([grouped, ungrouped], now, thresholds)).toEqual([2]);
    // With longer thresholds neither expires
    const relaxed = { groupedMs: GROUPED_EXPIRY_MS, ungroupedMs: UNGROUPED_EXPIRY_MS };
    expect(expiredTabIds([grouped, ungrouped], now, relaxed)).toEqual([]);
  });
});

import { isExternalOpen } from "../../src/background/groups";

describe("isExternalOpen", () => {
  const base = {
    id: 42,
    active: true,
    groupId: -1,
    pendingUrl: "https://example.com/",
  };

  it("accepts a focused, ungrouped, opener-less web tab we didn't create", () => {
    expect(isExternalOpen(base, false)).toBe(true);
    expect(isExternalOpen({ id: 1, active: true, groupId: -1, url: "http://x.com" }, false)).toBe(true);
  });

  it("rejects tabs the extension created itself", () => {
    expect(isExternalOpen(base, true)).toBe(false);
  });

  it("rejects in-page links / window.open (they carry an openerTabId)", () => {
    expect(isExternalOpen({ ...base, openerTabId: 7 }, false)).toBe(false);
  });

  it("rejects background (non-active) tabs — e.g. session restore", () => {
    expect(isExternalOpen({ ...base, active: false }, false)).toBe(false);
  });

  it("rejects tabs already in a group", () => {
    expect(isExternalOpen({ ...base, groupId: 5 }, false)).toBe(false);
  });

  it("rejects non-web tabs (new-tab page, extension pages)", () => {
    expect(isExternalOpen({ ...base, pendingUrl: "", url: "edge://newtab/" }, false)).toBe(false);
    expect(isExternalOpen({ ...base, pendingUrl: "about:blank", url: "" }, false)).toBe(false);
    expect(isExternalOpen({ id: 1, active: true, groupId: -1 }, false)).toBe(false);
  });
});

import { adoptTargetFor, ADOPT_WINDOW_MS } from "../../src/background/groups";

describe("adoptTargetFor", () => {
  const t = 1_000_000;
  it("returns null with no hint", () => {
    expect(adoptTargetFor(null, t)).toBeNull();
  });
  it("returns the hinted group when the hint is fresh", () => {
    expect(adoptTargetFor({ groupId: 9, at: t }, t + 100)).toBe(9);
    expect(adoptTargetFor({ groupId: 9, at: t }, t + ADOPT_WINDOW_MS - 1)).toBe(9);
  });
  it("returns null when the hint is stale (no recent focus-from-outside)", () => {
    expect(adoptTargetFor({ groupId: 9, at: t }, t + ADOPT_WINDOW_MS + 1)).toBeNull();
  });
  it("returns null when the hinted context was the default space", () => {
    expect(adoptTargetFor({ groupId: null, at: t }, t + 100)).toBeNull();
  });
});

describe("expiredTabIds with working hours", () => {
  const HOUR = 3600000;
  const work = { workStartMin: 540, workEndMin: 1020, includeWeekends: true }; // 9–17
  // "now" = Monday 10:00; a tab last active Friday 16:00.
  const now = new Date(2024, 0, 8, 10, 0, 0, 0).getTime(); // Mon
  const friday16 = new Date(2024, 0, 5, 16, 0, 0, 0).getTime();

  it("does not expire a tab whose idle time is mostly after-hours/weekend", () => {
    const thresholds = { groupedMs: 24 * HOUR, ungroupedMs: 2 * HOUR };
    const noWeekend = { ...work, includeWeekends: false };
    // Working time Fri16->Mon10 (weekends excluded) = 2h, which is NOT > 2h ungrouped.
    const t = tab({ id: 1, groupId: NONE, lastAccessed: friday16 });
    const filler = tab({ id: 2, lastAccessed: now });
    expect(expiredTabIds([t, filler], now, thresholds, noWeekend)).toEqual([]);
  });

  it("expires once enough working time has accrued", () => {
    const thresholds = { groupedMs: 24 * HOUR, ungroupedMs: 1 * HOUR };
    const noWeekend = { ...work, includeWeekends: false };
    // 2h working time > 1h ungrouped threshold -> expires.
    const t = tab({ id: 1, groupId: NONE, lastAccessed: friday16 });
    const filler = tab({ id: 2, lastAccessed: now });
    expect(expiredTabIds([t, filler], now, thresholds, noWeekend)).toEqual([1]);
  });
});

import { orderGroupsByStrip } from "../../src/background/groups";

describe("orderGroupsByStrip", () => {
  const g = (id) => ({ id });

  it("orders groups by their earliest tab's index (not by id)", () => {
    // Group 10 sits later in the strip than group 20 (index 5 vs 1).
    const groups = [g(10), g(20)];
    const tabs = [
      { groupId: 20, windowId: 1, index: 1 },
      { groupId: 20, windowId: 1, index: 2 },
      { groupId: 10, windowId: 1, index: 5 },
    ];
    expect(orderGroupsByStrip(groups, tabs).map((x) => x.id)).toEqual([20, 10]);
  });

  it("orders across windows by windowId then index", () => {
    const groups = [g(1), g(2), g(3)];
    const tabs = [
      { groupId: 3, windowId: 2, index: 0 },
      { groupId: 1, windowId: 1, index: 3 },
      { groupId: 2, windowId: 1, index: 0 },
    ];
    // window 1 (grp2 idx0, grp1 idx3) then window 2 (grp3).
    expect(orderGroupsByStrip(groups, tabs).map((x) => x.id)).toEqual([2, 1, 3]);
  });

  it("ignores ungrouped tabs and falls back to id for tab-less groups", () => {
    const groups = [g(7), g(9)];
    const tabs = [
      { groupId: -1, windowId: 1, index: 0 }, // ungrouped, ignored
      { groupId: 9, windowId: 1, index: 4 },
      // group 7 has no tabs -> sorts after, by id
    ];
    expect(orderGroupsByStrip(groups, tabs).map((x) => x.id)).toEqual([9, 7]);
  });

  it("does not mutate the input array", () => {
    const groups = [g(3), g(1)];
    const copy = groups.slice();
    orderGroupsByStrip(groups, [{ groupId: 1, windowId: 1, index: 0 }]);
    expect(groups).toEqual(copy);
  });
});
