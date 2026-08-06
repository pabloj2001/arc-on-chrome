import { describe, it, expect } from "vitest";
import { parseExpiry, fmtRemaining, groupTitle } from "../../src/background/contexts";

describe("parseExpiry", () => {
  it("parses m/h/d units", () => {
    expect(parseExpiry("30m")).toBe(30 * 60000);
    expect(parseExpiry("8h")).toBe(8 * 3600000);
    expect(parseExpiry("2d")).toBe(2 * 86400000);
    expect(parseExpiry("1 h")).toBe(3600000); // tolerates a space
  });
  it("defaults to 24h for missing/invalid input", () => {
    expect(parseExpiry("")).toBe(86400000);
    expect(parseExpiry("nope")).toBe(86400000);
    expect(parseExpiry("10s")).toBe(86400000);
  });
});

describe("fmtRemaining", () => {
  it("formats minutes, hours, and days", () => {
    expect(fmtRemaining(0)).toBe("0m");
    expect(fmtRemaining(-5)).toBe("0m");
    expect(fmtRemaining(45 * 60000)).toBe("45m");
    expect(fmtRemaining(3 * 3600000)).toBe("3h");
    expect(fmtRemaining(25 * 3600000)).toBe("1d 1h");
    expect(fmtRemaining(48 * 3600000)).toBe("2d");
  });
});

describe("groupTitle", () => {
  it("appends the remaining time to the name", () => {
    const now = 1_000_000;
    const ctx = { name: "work", durationMs: 3600000, lastActiveAt: now };
    expect(groupTitle(ctx, now)).toBe("work [1h]");
  });
});
