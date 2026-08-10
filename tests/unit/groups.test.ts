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
});
