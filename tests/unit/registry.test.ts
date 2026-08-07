import { describe, it, expect, vi } from "vitest";
import { COMMANDS, usageOf, bestCommandByPrefix } from "../../src/content/commands/registry";

describe("usageOf", () => {
  it("wraps required params in <> and optional in []", () => {
    expect(usageOf("favorite")).toBe("/favorite <1-8> <url>");
    expect(usageOf("context")).toBe("/context [name] [expiry]");
    expect(usageOf("export")).toBe("/export");
  });
});

describe("bestCommandByPrefix", () => {
  it("returns the shortest matching command name, excluding exact matches", () => {
    expect(bestCommandByPrefix("fav")).toBe("favorite");
    expect(bestCommandByPrefix("con")).toBe("context");
    expect(bestCommandByPrefix("zzz")).toBeNull();
    // "context" is an exact match so it is excluded; deletecontext doesn't start with it
    expect(bestCommandByPrefix("context")).toBeNull();
  });
});

describe("command run() reaches state only through ctx", () => {
  it("favorite validates the index and saves via ctx", () => {
    const ctx = { status: vi.fn(), setFavorite: vi.fn() };
    COMMANDS.favorite.run(["2", "github.com"], ctx);
    expect(ctx.setFavorite).toHaveBeenCalledWith(1, "https://github.com/");

    ctx.setFavorite.mockClear();
    COMMANDS.favorite.run(["9", "x.com"], ctx); // out of range
    expect(ctx.setFavorite).not.toHaveBeenCalled();
    expect(ctx.status).toHaveBeenCalledWith("Usage: /favorite <1-8> <url>");
  });

  it("unshortcut consults ctx.hasShortcut", () => {
    const present = { status: vi.fn(), removeShortcut: vi.fn(), hasShortcut: () => true };
    COMMANDS.unshortcut.run(["go"], present);
    expect(present.removeShortcut).toHaveBeenCalledWith("go");

    const absent = { status: vi.fn(), removeShortcut: vi.fn(), hasShortcut: () => false };
    COMMANDS.unshortcut.run(["go"], absent);
    expect(absent.removeShortcut).not.toHaveBeenCalled();
    expect(absent.status).toHaveBeenCalledWith('No shortcut "go"');
  });
});
