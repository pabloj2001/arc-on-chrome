import { describe, it, expect } from "vitest";
import {
  parseDuration, formatDuration, findSettingDef, mergeSettings,
  applySettingValue, DEFAULT_SETTINGS,
} from "../../src/shared/settings";

describe("parseDuration", () => {
  it("parses m/h/d and bare-number-as-minutes", () => {
    expect(parseDuration("30m")).toBe(30 * 60000);
    expect(parseDuration("24h")).toBe(24 * 3600000);
    expect(parseDuration("2d")).toBe(2 * 86400000);
    expect(parseDuration("45")).toBe(45 * 60000); // bare -> minutes
    expect(parseDuration("1 h")).toBe(3600000); // tolerates a space
  });
  it("rejects zero, negatives, and junk", () => {
    expect(parseDuration("0h")).toBeNull();
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("abc")).toBeNull();
    expect(parseDuration("10s")).toBeNull();
    expect(parseDuration("-5m")).toBeNull();
  });
});

describe("formatDuration", () => {
  it("uses the most compact whole unit, preferring hours until 2 days", () => {
    expect(formatDuration(30 * 60000)).toBe("30m");
    expect(formatDuration(24 * 3600000)).toBe("24h"); // not "1d"
    expect(formatDuration(48 * 3600000)).toBe("2d");
    expect(formatDuration(90 * 60000)).toBe("90m"); // not a whole hour
  });
  it("round-trips through parseDuration", () => {
    for (const s of ["30m", "24h", "2d", "90m"]) {
      expect(formatDuration(parseDuration(s))).toBe(s);
    }
  });
});

describe("findSettingDef", () => {
  it("matches tokens case-insensitively", () => {
    expect(findSettingDef("group-expiry")?.key).toBe("groupedExpiryMs");
    expect(findSettingDef("Default-Expiry")?.key).toBe("ungroupedExpiryMs");
    expect(findSettingDef("nope")).toBeNull();
  });
});

describe("mergeSettings", () => {
  it("fills defaults and ignores invalid/non-positive values", () => {
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings({ groupedExpiryMs: 1000 })).toEqual({
      ...DEFAULT_SETTINGS,
      groupedExpiryMs: 1000,
    });
    expect(mergeSettings({ groupedExpiryMs: 0, ungroupedExpiryMs: -5 })).toEqual(
      DEFAULT_SETTINGS
    );
    expect(mergeSettings({ groupedExpiryMs: "24h" })).toEqual(DEFAULT_SETTINGS);
  });
});

describe("applySettingValue", () => {
  it("updates a known setting and reports the change", () => {
    const res = applySettingValue(DEFAULT_SETTINGS, "group-expiry", "12h");
    expect(res.ok).toBe(true);
    expect(res.settings?.groupedExpiryMs).toBe(12 * 3600000);
    expect(res.settings?.ungroupedExpiryMs).toBe(DEFAULT_SETTINGS.ungroupedExpiryMs);
    expect(res.message).toContain("12h");
  });
  it("rejects an unknown setting name", () => {
    const res = applySettingValue(DEFAULT_SETTINGS, "bogus", "1h");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Unknown setting");
  });
  it("rejects an invalid value", () => {
    const res = applySettingValue(DEFAULT_SETTINGS, "default-expiry", "soon");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Invalid value");
  });
});
