// URL helpers shared by both bundles. All pure (no closure/DOM state) except
// faviconUrl, which only needs chrome.runtime (present in content + worker).
import type { UrlParts, HostPath } from "./types";

export const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
// Intranet-style path, e.g. "go/glean" or "wiki/Main_Page" (single label + /).
export const INTRANET_PATH = /^[a-z0-9-]+\/\S*/i;
// Tracking params dropped from the canonical de-dup key.
export const TRACKING_PARAM = /^(utm_|fbclid$|gclid$|gclsrc$|dclid$|msclkid$|mc_eid$|mc_cid$|igshid$|ref$|ref_src$|ref_url$|spm$|yclid$|_hsenc$|_hsmi$|_openstat$|si$)/i;

// Parses a URL into the parts we compare on: host without a leading "www.",
// path without trailing slashes, and the query string.
export function parseUrl(u: string): UrlParts | null {
  try {
    const x = new URL(u);
    return {
      host: x.host.replace(/^www\./i, "").toLowerCase(),
      path: x.pathname.replace(/\/+$/, ""),
      search: x.search,
    };
  } catch (_) {
    return null;
  }
}

// A tab matches a favorite when they share a host and the favorite's path is a
// prefix of the tab's path. A bare-domain favorite matches the tab it redirects
// to; a favorite with a path only matches tabs under that path.
export function tabMatchesFavorite(fav: UrlParts | HostPath | null, tab: UrlParts | HostPath | null): boolean {
  if (!fav || !tab || fav.host !== tab.host) return false;
  if (fav.path === "" || fav.path === tab.path) return true;
  return tab.path === fav.path || tab.path.startsWith(fav.path + "/");
}

// True when the whole (single-token) string is a URL/host on its own.
export function looksLikeNavigable(q: string): boolean {
  const s = q.trim();
  if (!s || /\s/.test(s)) return false; // spaces handled separately below
  if (HAS_SCHEME.test(s)) return true;
  if (/^localhost(:\d+)?([/?#]|$)/i.test(s)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}([:/?#]|$)/.test(s)) return true; // IPv4
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#]|$)/i.test(s)) return true; // dotted domain
  if (/^[a-z0-9-]+:\d+([/?#]|$)/i.test(s)) return true; // host:port
  if (INTRANET_PATH.test(s)) return true; // go/foo
  return false;
}

export function schemeFor(s: string): "http" | "https" {
  const host = s.split(/[/?#\s]/)[0].split(":")[0];
  return host.includes(".") ? "https" : "http";
}

// Schemes that must never reach the tabs API: Chrome rejects javascript:/data:
// navigations ("JavaScript URLs are not allowed…"), so we treat them as unsafe
// and never build or open them from user input.
const UNSAFE_SCHEME = /^(javascript|data|vbscript):/i;

// True when a URL is safe to open via chrome.tabs.create/update.
export function isSafeNavigationUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return !UNSAFE_SCHEME.test(url.trim());
}

// Builds a fully-encoded URL from raw input. Single-label hosts (go, localhost)
// use http:// so corporate redirectors resolve; dotted/public hosts use https.
// Returns null for unparseable input or an unsafe (javascript:/data:) scheme.
export function normalizeUrl(u: string): string | null {
  const s = (u || "").trim();
  if (!s) return null;
  if (UNSAFE_SCHEME.test(s)) return null;
  const full = HAS_SCHEME.test(s) ? s : `${schemeFor(s)}://${s}`;
  try {
    const href = new URL(full).href;
    return isSafeNavigationUrl(href) ? href : null;
  } catch (_) {
    return null;
  }
}

// Resolves user input to a URL that opens in a tab. A navigable host/path is
// handed to the browser as a URL; otherwise (or when it resolves to an unsafe
// scheme) it becomes a Google search.
export function buildUrl(query: string): string | null {
  const q = query.trim();
  if (!q) return null;
  if (looksLikeNavigable(q)) {
    const n = normalizeUrl(q);
    if (n) return n;
  } else {
    const first = q.split(/\s+/)[0];
    if (HAS_SCHEME.test(first) || INTRANET_PATH.test(first)) {
      const n = normalizeUrl(q);
      if (n) return n;
    }
  }
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

export function ensureScheme(u: string): string {
  return HAS_SCHEME.test(u) ? u : `${schemeFor(u)}://${u}`;
}

// Substitutes the query into a shortcut template. `%s` is replaced with the
// URL-encoded query; templates without `%s` get the query appended.
export function applyShortcut(template: string, query: string): string {
  const q = (query || "").trim();
  const enc = encodeURIComponent(q);
  const url = template.includes("%s")
    ? template.replace(/%s/g, enc)
    : template + enc;
  return ensureScheme(url);
}

// The origin ("https://host/") of a URL, ignoring a %s placeholder in the path
// or query, for building a favicon URL. Null if the host can't be determined.
export function originOf(u: string): string | null {
  const hp = hostPath(u);
  if (!hp || !hp.host) return null;
  const scheme = /^http:\/\//i.test(u) ? "http" : "https";
  return `${scheme}://${hp.host}/`;
}

// Chrome's favicon service URL for a page (needs the "favicon" permission).
export function faviconUrl(pageUrl: string): string {
  return chrome.runtime.getURL(
    `_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=64`
  );
}

// Canonical key for de-duplication: host without "www.", path without a
// trailing slash, and the query with tracking params dropped and the rest
// sorted so param order doesn't matter. Scheme and hash are ignored.
export function canon(u: string): string {
  try {
    const x = new URL(u);
    const kept = [];
    for (const [k, v] of new URLSearchParams(x.search)) {
      if (!TRACKING_PARAM.test(k)) kept.push([k, v]);
    }
    kept.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const qs = kept.length
      ? "?" + kept.map(([k, v]) => `${k}=${v}`).join("&")
      : "";
    return (
      x.host.replace(/^www\./i, "") +
      x.pathname.replace(/\/+$/, "") +
      qs
    ).toLowerCase();
  } catch (_) {
    return (u || "").toLowerCase();
  }
}

// Host (sans "www.") + path (sans trailing slash), or null if unparseable.
export function hostPath(u: string): HostPath | null {
  try {
    const x = new URL(u);
    return {
      host: x.host.replace(/^www\./i, "").toLowerCase(),
      path: x.pathname.replace(/\/+$/, ""),
    };
  } catch (_) {
    return null;
  }
}

// The query-string parameter name whose value is the `%s` placeholder in a
// shortcut template, or null when `%s` isn't a query value (it's in the path, or
// the template has no query). E.g. ".../results?query=%s&x=1" -> "query".
export function shortcutParam(template: string): string | null {
  const tpl = template || "";
  const q = tpl.indexOf("?");
  const s = tpl.indexOf("%s");
  if (s === -1 || q === -1 || s < q) return null; // %s not in the query
  for (const pair of tpl.slice(q + 1).split("&")) {
    const eq = pair.indexOf("=");
    const key = eq === -1 ? pair : pair.slice(0, eq);
    const val = eq === -1 ? "" : pair.slice(eq + 1);
    if (val.includes("%s")) return key || null;
  }
  return null;
}

// A de-dup key for a candidate URL *relative to a shortcut template*, so the
// near-identical results a shortcut surfaces collapse to the value that actually
// varies (the part `%s` fills), ignoring incidental query params.
//   • `%s` in the query (e.g. "?query=%s"): key = host + path + that one param
//     (all other params dropped), so "?query=X&current=2" == "?query=X".
//   • `%s` in the path (e.g. "/dags/%s/grid"): key = host + path (query dropped),
//     so ".../grid?tab=details" == ".../grid?task_id=…".
// Falls back to `canon` when the URL can't be parsed against the template.
export function shortcutDedupKey(url: string, template: string): string {
  try {
    const x = new URL(url);
    const host = x.host.replace(/^www\./i, "");
    const path = x.pathname.replace(/\/+$/, "");
    const param = shortcutParam(template);
    if (param) {
      const val = new URLSearchParams(x.search).get(param);
      return `${host}${path}?${param}=${val == null ? "" : val}`.toLowerCase();
    }
    return `${host}${path}`.toLowerCase();
  } catch (_) {
    return canon(url);
  }
}

// decodeURIComponent that never throws (returns the raw string on malformed %).
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch (_) {
    return s;
  }
}

// The value `%s` would hold to reach `url` via `template` — i.e. what you'd type
// after the shortcut alias to get there — or null when the URL doesn't fit the
// template. Mirrors shortcutDedupKey's two cases:
//   • `%s` in the query ("?q=%s"): the value of that param (decoded).
//   • `%s` in the path ("/dags/%s/grid"): the segment between the template's
//     fixed prefix and suffix (decoded), ignoring any query on the candidate.
export function shortcutValue(url: string, template: string): string | null {
  try {
    const x = new URL(url);
    const param = shortcutParam(template);
    if (param) {
      const v = new URLSearchParams(x.search).get(param);
      return v == null ? null : safeDecode(v);
    }
    const idx = (template || "").indexOf("%s");
    if (idx === -1) return null;
    const strip = (s: string) =>
      s
        .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
        .replace(/^www\./i, "")
        .replace(/\/+$/, "");
    const pre = strip(template.slice(0, idx));
    const post = strip(template.slice(idx + 2).split(/[?#]/)[0]);
    const cand = strip(x.host + x.pathname);
    if (
      cand.startsWith(pre) &&
      cand.endsWith(post) &&
      cand.length >= pre.length + post.length
    ) {
      const mid = cand.slice(pre.length, cand.length - post.length).replace(/^\/+|\/+$/g, "");
      return mid ? safeDecode(mid) : null;
    }
    return null;
  } catch (_) {
    return null;
  }
}
