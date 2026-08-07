import { describe, it, expect } from "vitest";
import {
  matchesQuery, templateBase, underBase, hostOf, computeDomainScores,
  bestDomainMatch,
} from "../../src/content/search/matching";

describe("matchesQuery", () => {
  it("requires every token in title or url", () => {
    const item = { title: "GitHub Search", url: "https://github.com/search" };
    expect(matchesQuery(item, ["git", "search"])).toBe(true);
    expect(matchesQuery(item, ["gitlab"])).toBe(false);
  });
});

describe("templateBase", () => {
  it("takes the part before %s and adds https when schemeless", () => {
    expect(templateBase("https://go/%s")).toEqual({ host: "go", path: "" });
    expect(templateBase("example.com/s?q=%s")).toEqual({ host: "example.com", path: "/s" });
  });
});

describe("underBase", () => {
  const base = { host: "go", path: "" };
  it("matches any path when base path is empty", () => {
    expect(underBase("http://go/glean", base)).toBe(true);
  });
  it("respects a non-empty base path", () => {
    const b = { host: "example.com", path: "/docs" };
    expect(underBase("https://example.com/docs/x", b)).toBe(true);
    expect(underBase("https://example.com/other", b)).toBe(false);
  });
  it("rejects a different host", () => {
    expect(underBase("http://other/x", base)).toBe(false);
  });
});

describe("hostOf", () => {
  it("strips www and lowercases", () => {
    expect(hostOf("https://WWW.Example.com/x")).toBe("example.com");
    expect(hostOf("garbage")).toBeNull();
  });
});

describe("computeDomainScores + bestDomainMatch", () => {
  const openTabs = [{ url: "https://github.com/a" }];
  const history = [
    { url: "https://gist.github.com/x", visitCount: 5 },
    { url: "https://github.com/b", visitCount: 2 },
  ];
  const scores = computeDomainScores(openTabs, history);

  it("weights open tabs above history", () => {
    expect(scores.get("github.com")).toBe(1002); // 1000 open + 2 history
    expect(scores.get("gist.github.com")).toBe(5);
  });

  it("prefers root domains over subdomains for a shared prefix", () => {
    // "git" is a prefix of both github.com and gist.github.com; root wins.
    expect(bestDomainMatch("git", scores)).toBe("github.com");
  });

  it("returns null when nothing matches or input is a path/query", () => {
    expect(bestDomainMatch("zzz", scores)).toBeNull();
    expect(bestDomainMatch("github.com/a", scores)).toBeNull();
    expect(bestDomainMatch("two words", scores)).toBeNull();
  });
});
