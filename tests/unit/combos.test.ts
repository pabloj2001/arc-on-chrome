import { describe, it, expect } from "vitest";
import { isToggleCombo, isUrlCombo } from "../../src/content/keyboard/combos";

const key = (k: string, mods: Partial<KeyboardEvent> = {}) =>
  ({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods }) as any;

describe("isToggleCombo", () => {
  it("matches Cmd/Ctrl+T only", () => {
    expect(isToggleCombo(key("t", { metaKey: true }))).toBe(true);
    expect(isToggleCombo(key("T", { ctrlKey: true }))).toBe(true);
    expect(isToggleCombo(key("t"))).toBe(false); // no modifier
    expect(isToggleCombo(key("t", { metaKey: true, shiftKey: true }))).toBe(false);
    expect(isToggleCombo(key("l", { metaKey: true }))).toBe(false);
  });
});

describe("isUrlCombo", () => {
  it("matches Cmd/Ctrl+L only", () => {
    expect(isUrlCombo(key("l", { metaKey: true }))).toBe(true);
    expect(isUrlCombo(key("L", { ctrlKey: true }))).toBe(true);
    expect(isUrlCombo(key("l", { metaKey: true, altKey: true }))).toBe(false);
    expect(isUrlCombo(key("t", { metaKey: true }))).toBe(false);
  });
});
