import { describe, it, expect } from "vitest";
import {
  parseUrl, tabMatchesFavorite, looksLikeNavigable, schemeFor, normalizeUrl,
  buildUrl, ensureScheme, applyShortcut, canon, hostPath, isSafeNavigationUrl,
  shortcutParam, shortcutDedupKey,
} from "../../src/shared/url";

describe("parseUrl", () => {
  it("strips www and trailing slashes", () => {
    expect(parseUrl("https://www.example.com/a/b/")).toEqual({
      host: "example.com",
      path: "/a/b",
      search: "",
    });
  });
  it("returns null for garbage", () => {
    expect(parseUrl("not a url")).toBeNull();
  });
});

describe("tabMatchesFavorite", () => {
  const fav = { host: "example.com", path: "" };
  it("matches a bare-domain favorite to a sub-path tab", () => {
    expect(tabMatchesFavorite(fav, { host: "example.com", path: "/app" })).toBe(true);
  });
  it("does not match a different host", () => {
    expect(tabMatchesFavorite(fav, { host: "other.com", path: "" })).toBe(false);
  });
  it("respects a path prefix", () => {
    const f = { host: "example.com", path: "/docs" };
    expect(tabMatchesFavorite(f, { host: "example.com", path: "/docs/x" })).toBe(true);
    expect(tabMatchesFavorite(f, { host: "example.com", path: "/other" })).toBe(false);
  });
});

describe("looksLikeNavigable", () => {
  it("accepts schemes, domains, localhost, IPs, and intranet paths", () => {
    for (const s of ["https://x.com", "example.com", "localhost:3000", "127.0.0.1", "go/glean"]) {
      expect(looksLikeNavigable(s)).toBe(true);
    }
  });
  it("rejects multi-word text and plain words", () => {
    expect(looksLikeNavigable("hello world")).toBe(false);
    expect(looksLikeNavigable("banana")).toBe(false);
  });
});

describe("schemeFor / normalizeUrl / ensureScheme", () => {
  it("uses http for single-label hosts and https for dotted", () => {
    expect(schemeFor("go/x")).toBe("http");
    expect(schemeFor("example.com")).toBe("https");
    expect(normalizeUrl("go/glean my search")).toBe("http://go/glean%20my%20search");
    expect(normalizeUrl("example.com")).toBe("https://example.com/");
    expect(ensureScheme("example.com")).toBe("https://example.com");
  });
});

describe("buildUrl", () => {
  it("navigates real URLs and searches plain text", () => {
    expect(buildUrl("example.com")).toBe("https://example.com/");
    expect(buildUrl("hello world")).toBe(
      "https://www.google.com/search?q=hello%20world"
    );
  });
  it("never builds a javascript:/data: URL — falls back to a search", () => {
    expect(buildUrl("javascript://%0aalert(1)")).toBe(
      "https://www.google.com/search?q=javascript%3A%2F%2F%250aalert(1)"
    );
    expect(buildUrl("data://text/html,x")).toBe(
      "https://www.google.com/search?q=data%3A%2F%2Ftext%2Fhtml%2Cx"
    );
  });
});

describe("isSafeNavigationUrl", () => {
  it("rejects javascript:/data:/vbscript: and empty, accepts http(s)", () => {
    expect(isSafeNavigationUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeNavigationUrl("JavaScript:alert(1)")).toBe(false);
    expect(isSafeNavigationUrl("data:text/html,x")).toBe(false);
    expect(isSafeNavigationUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isSafeNavigationUrl("")).toBe(false);
    expect(isSafeNavigationUrl(null)).toBe(false);
    expect(isSafeNavigationUrl("https://example.com/")).toBe(true);
  });
  it("normalizeUrl returns null for unsafe schemes", () => {
    expect(normalizeUrl("javascript://%0aalert(1)")).toBeNull();
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("applyShortcut", () => {
  it("substitutes %s and appends when absent", () => {
    expect(applyShortcut("https://go/%s", "hi there")).toBe("https://go/hi%20there");
    expect(applyShortcut("https://go/?q=", "x")).toBe("https://go/?q=x");
    expect(applyShortcut("go/%s", "x")).toBe("http://go/x");
  });
});

describe("canon", () => {
  it("drops tracking params and sorts the rest", () => {
    expect(canon("https://www.Example.com/p/?utm_source=x&b=2&a=1")).toBe(
      "example.com/p?a=1&b=2"
    );
  });
  it("ignores scheme and hash", () => {
    expect(canon("http://example.com/p#frag")).toBe(canon("https://example.com/p"));
  });
});

describe("hostPath", () => {
  it("returns normalized host + path", () => {
    expect(hostPath("https://www.example.com/a/")).toEqual({
      host: "example.com",
      path: "/a",
    });
  });
});

describe("shortcutParam", () => {
  it("names the query param whose value is %s", () => {
    expect(shortcutParam("https://jarvis/codesearch/results?query=%s")).toBe("query");
    expect(shortcutParam("https://x/s?a=1&q=%s&b=2")).toBe("q");
  });
  it("is null when %s is in the path or there's no query", () => {
    expect(shortcutParam("https://war/dags/%s/grid")).toBeNull();
    expect(shortcutParam("https://go/%s")).toBeNull();
    // %s before the '?' is a path placeholder, not a query value.
    expect(shortcutParam("https://x/%s/y?tab=1")).toBeNull();
  });
});

describe("shortcutDedupKey", () => {
  it("path %s: collapses incidental query params (dedup by host+path)", () => {
    const tpl = "https://war.oklahoma-airflow.grid.linkedin.com/dags/%s/grid";
    const a = shortcutDedupKey(
      "https://war.oklahoma-airflow.grid.linkedin.com/dags/sis-x/grid?tab=details&dag_run_id=r1",
      tpl
    );
    const b = shortcutDedupKey(
      "https://war.oklahoma-airflow.grid.linkedin.com/dags/sis-x/grid?task_id=T&tab=logs",
      tpl
    );
    expect(a).toBe(b); // same dag -> one entry
    // A different dag stays distinct.
    const c = shortcutDedupKey(
      "https://war.oklahoma-airflow.grid.linkedin.com/dags/log-compact/grid",
      tpl
    );
    expect(c).not.toBe(a);
  });

  it("query %s: dedups by the %s param only, ignoring other params", () => {
    const tpl = "https://jarvis.corp.linkedin.com/codesearch/results?query=%s";
    const base = "https://jarvis.corp.linkedin.com/codesearch/results?query=ABC";
    const k = shortcutDedupKey(base, tpl);
    expect(shortcutDedupKey(base + "&current=2", tpl)).toBe(k);
    expect(shortcutDedupKey(base + "&current=2&nresults=10", tpl)).toBe(k);
    // A different query value is a distinct result.
    expect(
      shortcutDedupKey("https://jarvis.corp.linkedin.com/codesearch/results?query=XYZ", tpl)
    ).not.toBe(k);
  });
});
