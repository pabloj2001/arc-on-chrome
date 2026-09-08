// Normalizing keyword shortcuts read from storage / an /export blob. The stored
// shape evolved from `alias -> "url"` (a bare string) to `alias -> {url, name}`.
// Legacy string entries — and object entries missing a name — get the alias
// copied in as the name, so old data keeps working without a migration step.
import type { Shortcut, Shortcuts } from "./types";

// One entry -> a valid Shortcut, or null when it has no usable URL.
export function normalizeShortcut(alias: string, raw: unknown): Shortcut | null {
  if (typeof raw === "string") {
    return raw.trim() ? { url: raw, name: alias } : null;
  }
  if (raw && typeof raw === "object") {
    const o = raw as { url?: unknown; name?: unknown };
    const url = typeof o.url === "string" ? o.url : "";
    if (!url.trim()) return null;
    const name =
      typeof o.name === "string" && o.name.trim() ? o.name : alias;
    return { url, name };
  }
  return null;
}

// A whole map -> a clean Shortcuts (drops entries without a usable URL).
export function normalizeShortcuts(raw: unknown): Shortcuts {
  const out: Shortcuts = {};
  if (raw && typeof raw === "object") {
    for (const alias of Object.keys(raw as Record<string, unknown>)) {
      const s = normalizeShortcut(alias, (raw as Record<string, unknown>)[alias]);
      if (s) out[alias] = s;
    }
  }
  return out;
}
