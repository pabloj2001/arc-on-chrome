import { describe, it, expect, beforeEach } from "vitest";
import { hexToRgb, groupHex, groupTextColor, tintBg } from "../../src/shared/colors";

function setScheme(dark: boolean) {
  (globalThis as any).window = {
    matchMedia: (q: string) => ({ matches: dark && q.includes("dark") }),
  };
}

describe("hexToRgb", () => {
  it("parses 6-digit hex with or without #", () => {
    expect(hexToRgb("#296eeb")).toEqual({ r: 41, g: 110, b: 235 });
    expect(hexToRgb("296eeb")).toEqual({ r: 41, g: 110, b: 235 });
  });
  it("returns null for bad input", () => {
    expect(hexToRgb("nope")).toBeNull();
    expect(hexToRgb("")).toBeNull();
  });
});

describe("groupHex / groupTextColor (scheme-aware)", () => {
  beforeEach(() => setScheme(false));
  it("maps known colors in light mode", () => {
    expect(groupHex("blue")).toBe("#296eeb");
    expect(groupTextColor()).toBe("#fff");
  });
  it("falls back for unknown colors", () => {
    expect(groupHex("chartreuse")).toBe("#325ccd");
  });
  it("uses dark tints in dark mode", () => {
    setScheme(true);
    expect(groupHex("blue")).toBe("#7aa5f5");
    expect(groupTextColor()).toBe("#202124");
  });
});

describe("tintBg", () => {
  beforeEach(() => setScheme(false));
  it("layers the color over the surface", () => {
    const bg = tintBg("#296eeb");
    expect(bg).toContain("linear-gradient(");
    expect(bg).toContain("41,110,235");
  });
  it("returns the base when the hex is invalid", () => {
    expect(tintBg("bad")).toBe("rgba(250,250,252,0.98)");
  });
});
