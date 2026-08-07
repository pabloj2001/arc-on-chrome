import { describe, it, expect } from "vitest";
import { normalizeFavArray, buildSettingsExport, parseSettingsImport } from "../../src/content/settings";

describe("normalizeFavArray", () => {
  it("pads to 8 slots and fills gaps with null", () => {
    expect(normalizeFavArray(["a"])).toEqual(["a", null, null, null, null, null, null, null]);
  });
  it("truncates to 8 slots", () => {
    const nine = Array.from({ length: 9 }, (_, i) => "u" + i);
    expect(normalizeFavArray(nine)).toHaveLength(8);
  });
  it("handles null/undefined input", () => {
    expect(normalizeFavArray(null)).toEqual(new Array(8).fill(null));
  });
});

describe("buildSettingsExport / parseSettingsImport round-trip", () => {
  const favorites = ["https://github.com", null, null, null, null, null, null, null];
  const shortcuts = { gh: "https://github.com/search?q=%s" };

  it("round-trips favorites + shortcuts", () => {
    const json = buildSettingsExport(favorites, shortcuts);
    const parsed = parseSettingsImport(json);
    expect(parsed.favorites).toEqual(favorites);
    expect(parsed.shortcuts).toEqual(shortcuts);
    const data = JSON.parse(json);
    expect(data.type).toBe("arc-search-settings");
    expect(data.version).toBe(1);
  });

  it("rejects bad type, bad JSON, and future versions", () => {
    expect(parseSettingsImport("not json")).toBeNull();
    expect(parseSettingsImport(JSON.stringify({ type: "other" }))).toBeNull();
    expect(
      parseSettingsImport(JSON.stringify({ type: "arc-search-settings", version: 99, favorites }))
    ).toBeNull();
  });

  it("accepts a partial blob (shortcuts only)", () => {
    const parsed = parseSettingsImport(
      JSON.stringify({ type: "arc-search-settings", version: 1, shortcuts })
    );
    expect(parsed.favorites).toBeNull();
    expect(parsed.shortcuts).toEqual(shortcuts);
  });
});
