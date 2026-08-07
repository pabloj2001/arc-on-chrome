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

// Builds a fully-encoded URL from raw input. Single-label hosts (go, localhost)
// use http:// so corporate redirectors resolve; dotted/public hosts use https.
export function normalizeUrl(u: string): string | null {
  const s = (u || "").trim();
  if (!s) return null;
  const full = HAS_SCHEME.test(s) ? s : `${schemeFor(s)}://${s}`;
  try {
    return new URL(full).href;
  } catch (_) {
    return null;
  }
}

// Resolves user input to a URL that opens in a tab. A navigable host/path is
// handed to the browser as a URL; otherwise it becomes a Google search.
export function buildUrl(query: string): string | null {
  const q = query.trim();
  if (!q) return null;
  if (looksLikeNavigable(q)) return normalizeUrl(q);
  const first = q.split(/\s+/)[0];
  if (HAS_SCHEME.test(first) || INTRANET_PATH.test(first)) {
    return normalizeUrl(q);
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
