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

import {
  parseTimeOfDay, formatTimeOfDay, parseToggle, formatToggle, workingElapsedMs,
} from "../../src/shared/settings";

describe("parseTimeOfDay / formatTimeOfDay", () => {
  it("parses 24h, bare hour, and am/pm", () => {
    expect(parseTimeOfDay("9")).toBe(540);
    expect(parseTimeOfDay("9:30")).toBe(570);
    expect(parseTimeOfDay("18:00")).toBe(1080);
    expect(parseTimeOfDay("9am")).toBe(540);
    expect(parseTimeOfDay("6pm")).toBe(1080);
    expect(parseTimeOfDay("12am")).toBe(0);
    expect(parseTimeOfDay("12pm")).toBe(720);
  });
  it("rejects nonsense and out-of-range", () => {
    expect(parseTimeOfDay("")).toBeNull();
    expect(parseTimeOfDay("25:00")).toBeNull();
    expect(parseTimeOfDay("9:99")).toBeNull();
    expect(parseTimeOfDay("13pm")).toBeNull();
  });
  it("formats minutes as HH:MM", () => {
    expect(formatTimeOfDay(540)).toBe("09:00");
    expect(formatTimeOfDay(1080)).toBe("18:00");
    expect(formatTimeOfDay(0)).toBe("00:00");
  });
});

describe("parseToggle / formatToggle", () => {
  it("parses common truthy/falsey words", () => {
    for (const s of ["on", "yes", "true", "1"]) expect(parseToggle(s)).toBe(true);
    for (const s of ["off", "no", "false", "0"]) expect(parseToggle(s)).toBe(false);
    expect(parseToggle("maybe")).toBeNull();
  });
  it("formats booleans", () => {
    expect(formatToggle(true)).toBe("on");
    expect(formatToggle(false)).toBe("off");
  });
});

describe("workingElapsedMs", () => {
  const HOUR = 3600000;
  // A fixed local Monday 09:00 baseline.
  const mon9 = new Date(2024, 0, 1, 9, 0, 0, 0).getTime(); // 2024-01-01 is a Monday
  const work = { workStartMin: 540, workEndMin: 1020, includeWeekends: true }; // 9:00–17:00

  it("counts all time when working hours span the whole day", () => {
    const allDay = { workStartMin: 0, workEndMin: 0, includeWeekends: true };
    expect(workingElapsedMs(mon9, mon9 + 5 * HOUR, allDay)).toBe(5 * HOUR);
  });

  it("does not count after-hours idle time", () => {
    // From Mon 16:00 to Tue 10:00: 1h (16→17) + 1h (9→10) = 2h of working time.
    const mon16 = new Date(2024, 0, 1, 16, 0, 0, 0).getTime();
    const tue10 = new Date(2024, 0, 2, 10, 0, 0, 0).getTime();
    expect(workingElapsedMs(mon16, tue10, work)).toBe(2 * HOUR);
  });

  it("counts a full working day as the window length", () => {
    // Mon 09:00 -> Tue 09:00 spans one full 9–17 window = 8h.
    const tue9 = new Date(2024, 0, 2, 9, 0, 0, 0).getTime();
    expect(workingElapsedMs(mon9, tue9, work)).toBe(8 * HOUR);
  });

  it("skips weekends when they're excluded", () => {
    // Fri 16:00 -> Mon 10:00, weekends excluded: 1h (Fri 16→17) + 1h (Mon 9→10).
    const fri16 = new Date(2024, 0, 5, 16, 0, 0, 0).getTime(); // 2024-01-05 Friday
    const mon10 = new Date(2024, 0, 8, 10, 0, 0, 0).getTime(); // 2024-01-08 Monday
    const noWeekend = { ...work, includeWeekends: false };
    expect(workingElapsedMs(fri16, mon10, noWeekend)).toBe(2 * HOUR);
    // With weekends included: Fri 16→17 (1h) + Sat 8h + Sun 8h + Mon 9→10 (1h) = 18h.
    expect(workingElapsedMs(fri16, mon10, work)).toBe(18 * HOUR);
  });
});
