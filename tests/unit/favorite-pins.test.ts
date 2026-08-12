import { describe, it, expect } from "vitest";
import { planFavoritePins, planPinnedOrder } from "../../src/background/favorites";

const A = "https://a.com/";
const B = "https://b.com/";
const C = "https://c.com/";

function tab(over = {}) {
  return { id: 1, url: "", pendingUrl: "", pinned: false, windowId: 1, ...over };
}

describe("planFavoritePins", () => {
  it("creates a pinned tab for a favorite with no open tab", () => {
    const plan = planFavoritePins([A, null], []);
    expect(plan.create).toEqual([A]);
    expect(plan.pin).toEqual([]);
    expect(plan.close).toEqual([]);
  });

  it("pins an existing (unpinned) tab that matches a favorite", () => {
    const tabs = [tab({ id: 5, url: A })];
    const plan = planFavoritePins([A], tabs);
    expect(plan.pin).toEqual([5]);
    expect(plan.create).toEqual([]);
  });

  it("keeps a favorite that is already pinned (no-op)", () => {
    const tabs = [tab({ id: 5, url: A, pinned: true })];
    const plan = planFavoritePins([A], tabs);
    expect(plan).toEqual({ pin: [], close: [], create: [] });
  });

  it("closes a pinned tab that is not a favorite", () => {
    const tabs = [tab({ id: 9, url: C, pinned: true })];
    const plan = planFavoritePins([A], tabs);
    expect(plan.close).toEqual([9]);
    expect(plan.create).toEqual([A]);
  });

  it("closes the pin of a removed favorite (no leftover tab)", () => {
    // was [A, B], now just [A]; B's pinned tab should be closed.
    const tabs = [
      tab({ id: 1, url: A, pinned: true }),
      tab({ id: 2, url: B, pinned: true }),
    ];
    const plan = planFavoritePins([A], tabs);
    expect(plan.close).toEqual([2]);
    expect(plan.pin).toEqual([]);
    expect(plan.create).toEqual([]);
  });

  it("closes duplicate pins of the same favorite, keeping one", () => {
    const tabs = [
      tab({ id: 1, url: A, pinned: true }),
      tab({ id: 2, url: A, pinned: true }),
    ];
    const plan = planFavoritePins([A], tabs);
    expect(plan.close).toEqual([2]);
    expect(plan.pin).toEqual([]);
    expect(plan.create).toEqual([]);
  });

  it("matches by canonical URL (ignores www / trailing slash / tracking)", () => {
    const tabs = [tab({ id: 5, url: "https://www.a.com", pinned: true })];
    const plan = planFavoritePins([A], tabs);
    expect(plan).toEqual({ pin: [], close: [], create: [] });
  });
});

describe("planPinnedOrder", () => {
  it("orders pinned favorite tabs by favorite slot within a window", () => {
    const tabs = [
      tab({ id: 30, url: C, pinned: true }),
      tab({ id: 10, url: A, pinned: true }),
      tab({ id: 20, url: B, pinned: true }),
    ];
    const moves = planPinnedOrder([A, B, C], tabs);
    expect(moves).toEqual([
      { id: 10, windowId: 1, index: 0 },
      { id: 20, windowId: 1, index: 1 },
      { id: 30, windowId: 1, index: 2 },
    ]);
  });

  it("orders independently per window", () => {
    const tabs = [
      tab({ id: 2, url: B, pinned: true, windowId: 1 }),
      tab({ id: 1, url: A, pinned: true, windowId: 1 }),
      tab({ id: 3, url: A, pinned: true, windowId: 2 }),
    ];
    const moves = planPinnedOrder([A, B], tabs);
    expect(moves).toContainEqual({ id: 1, windowId: 1, index: 0 });
    expect(moves).toContainEqual({ id: 2, windowId: 1, index: 1 });
    expect(moves).toContainEqual({ id: 3, windowId: 2, index: 0 });
  });

  it("ignores pinned tabs that aren't favorites", () => {
    const tabs = [tab({ id: 7, url: C, pinned: true })];
    expect(planPinnedOrder([A, B], tabs)).toEqual([]);
  });
});
