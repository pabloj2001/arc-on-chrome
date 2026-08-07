// Pure (de)serialization of durable user settings — favorites + keyword
// shortcuts. Contexts are ephemeral and intentionally excluded. The DOM-facing
// clipboard/file plumbing stays in the content entry; this is just the data.
import { FAV_COUNT, EXPORT_VERSION } from "../shared/constants";
import type { Favorite, Shortcuts } from "../shared/types";
import type { SettingsImport } from "./commands/types";

// Pads/truncates a stored favorites array to exactly FAV_COUNT slots (null = empty).
export function normalizeFavArray(arr: unknown): Favorite[] {
  const src = Array.isArray(arr) ? arr : [];
  const out: Favorite[] = new Array(FAV_COUNT).fill(null);
  for (let i = 0; i < FAV_COUNT; i++) out[i] = src[i] || null;
  return out;
}

// Serializes favorites + shortcuts into a versioned JSON blob. /import reads
// this same shape.
export function buildSettingsExport(favorites: Favorite[], shortcuts: Shortcuts): string {
  return JSON.stringify(
    {
      type: "arc-search-settings",
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      favorites,
      shortcuts,
    },
    null,
    2
  );
}

// Parses a /export JSON blob and returns the durable settings, or null if the
// shape/version isn't recognized. Tolerant of missing pieces.
export function parseSettingsImport(text: string): SettingsImport | null {
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    return null;
  }
  if (!data || data.type !== "arc-search-settings") return null;
  if (typeof data.version !== "number" || data.version > EXPORT_VERSION) {
    return null;
  }
  const favs = Array.isArray(data.favorites)
    ? normalizeFavArray(data.favorites)
    : null;
  const shorts =
    data.shortcuts && typeof data.shortcuts === "object" ? data.shortcuts : null;
  if (!favs && !shorts) return null;
  return { favorites: favs, shortcuts: shorts };
}
