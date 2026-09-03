import { describe, it, expect } from "vitest";
import { normalizeShortcut, normalizeShortcuts } from "../../src/shared/shortcuts";

describe("normalizeShortcut", () => {
  it("upgrades a legacy string to {url, name=alias}", () => {
    expect(normalizeShortcut("go", "https://go/%s")).toEqual({
      url: "https://go/%s",
      name: "go",
    });
  });
  it("keeps an object's name, or fills it from the alias", () => {
    expect(normalizeShortcut("gh", { url: "https://x/%s", name: "GitHub" })).toEqual({
      url: "https://x/%s",
      name: "GitHub",
    });
    expect(normalizeShortcut("gh", { url: "https://x/%s" })).toEqual({
      url: "https://x/%s",
      name: "gh",
    });
    expect(normalizeShortcut("gh", { url: "https://x/%s", name: "   " })).toEqual({
      url: "https://x/%s",
      name: "gh",
    });
  });
  it("drops entries without a usable URL", () => {
    expect(normalizeShortcut("x", "")).toBeNull();
    expect(normalizeShortcut("x", { name: "no url" })).toBeNull();
    expect(normalizeShortcut("x", null)).toBeNull();
    expect(normalizeShortcut("x", 42)).toBeNull();
  });
});

describe("normalizeShortcuts", () => {
  it("normalizes a mixed map and skips junk", () => {
    expect(
      normalizeShortcuts({
        go: "https://go/%s",
        gh: { url: "https://gh/%s", name: "GitHub" },
        bad: "",
      })
    ).toEqual({
      go: { url: "https://go/%s", name: "go" },
      gh: { url: "https://gh/%s", name: "GitHub" },
    });
  });
  it("returns {} for non-objects", () => {
    expect(normalizeShortcuts(null)).toEqual({});
    expect(normalizeShortcuts("nope")).toEqual({});
  });
});
