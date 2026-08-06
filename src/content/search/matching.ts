// @ts-nocheck
// Pure matching + ranking helpers over explicit inputs (no closure/DOM state).
import { hostPath } from "../../shared/url";

// True when every token appears in the item's title or url (case-insensitive).
export function matchesQuery(item, tokens) {
  const hay = `${item.title || ""} ${item.url || ""}`.toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

// The host/path a shortcut's template resolves to (the part before %s), used to
// filter results to that destination (e.g. "https://go/%s" -> go, "").
export function templateBase(template) {
  let prefix = (template || "").split("%s")[0];
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(prefix)) prefix = "https://" + prefix;
  return hostPath(prefix);
}

// True if a URL lives under a shortcut's base host + path prefix.
export function underBase(u, base) {
  const hp = hostPath(u);
  if (!hp || hp.host !== base.host) return false;
  if (base.path === "") return true;
  return hp.path === base.path || hp.path.startsWith(base.path + "/");
}

export function hostOf(u) {
  try {
    return new URL(u).host.replace(/^www\./i, "").toLowerCase();
  } catch (_) {
    return null;
  }
}

// Score each visited host so autocomplete prefers open tabs, then frequently
// visited history. Returns a host -> score Map.
export function computeDomainScores(openTabs, historyItems) {
  const scores = new Map();
  for (const t of openTabs) {
    const h = hostOf(t.url);
    if (h) scores.set(h, (scores.get(h) || 0) + 1000);
  }
  for (const it of historyItems) {
    const h = hostOf(it.url);
    if (h) scores.set(h, (scores.get(h) || 0) + (it.visitCount || 1));
  }
  return scores;
}

// Returns the best visited base domain (host) the typed value is a prefix of, or
// null. Prefers root domains over subdomains, then most-used, then shortest.
// Caller is responsible for suppressing this in command/shortcut modes.
export function bestDomainMatch(value, domainScores) {
  if (!value) return null;
  if (/\s/.test(value) || value.startsWith("/")) return null;
  const typed = value.replace(/^https?:\/\//i, "");
  if (typed.includes("/")) return null;
  const typedHost = typed.replace(/^www\./i, "").toLowerCase();
  if (!typedHost) return null;
  const cands = [];
  for (const [host, score] of domainScores) {
    if (host.length < typedHost.length || !host.startsWith(typedHost)) continue;
    cands.push({ host, score, labels: host.split(".").length });
  }
  if (!cands.length) return null;
  cands.sort(
    (a, b) =>
      a.labels - b.labels || // root domains before subdomains
      b.score - a.score || // then most-used
      a.host.length - b.host.length // then shortest
  );
  return cands[0].host;
}
