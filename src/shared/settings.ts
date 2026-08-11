// Durable, user-adjustable settings shared by both bundles. The content side
// edits them (via /settings + the settings modal); the background reads them
// (tab-expiry thresholds). Kept framework-free and mostly pure so the parsing
// and the setting registry can be unit-tested without chrome.*.
import {
  SETTINGS_KEY, GROUPED_EXPIRY_MS, UNGROUPED_EXPIRY_MS,
} from "./constants";

export interface Settings {
  groupedExpiryMs: number;
  ungroupedExpiryMs: number;
}

export const DEFAULT_SETTINGS: Settings = {
  groupedExpiryMs: GROUPED_EXPIRY_MS,
  ungroupedExpiryMs: UNGROUPED_EXPIRY_MS,
};

// ---- Duration parsing/formatting ------------------------------------------

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// "30m" / "8h" / "2d" (a lone space tolerated) -> milliseconds, or null. A bare
// number is read as minutes. Zero and negatives are rejected.
export function parseDuration(str: string): number | null {
  const s = String(str || "").trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/^(\d+)\s*([mhd]?)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!n || n <= 0) return null;
  const unit = m[2] || "m";
  const mult = unit === "d" ? DAY : unit === "h" ? HOUR : MIN;
  return n * mult;
}

// Milliseconds -> the most compact whole-unit string ("30m", "24h", "2d").
// Prefers days only at 2d+, so a 24h default reads as "24h" rather than "1d".
export function formatDuration(ms: number): string {
  if (ms <= 0) return "0m";
  if (ms % DAY === 0 && ms / DAY >= 2) return ms / DAY + "d";
  if (ms % HOUR === 0) return ms / HOUR + "h";
  if (ms % MIN === 0) return ms / MIN + "m";
  return Math.round(ms / MIN) + "m";
}

// ---- Setting registry ------------------------------------------------------

// A single adjustable setting: how to name it (command token), label/hint it in
// the modal, and convert between its stored value and the string the user types.
export interface SettingDef {
  key: keyof Settings;
  token: string; // the /settings <token> name (no spaces)
  label: string; // modal row label
  hint: string; // placeholder / example
  parse: (s: string) => number | null;
  format: (v: number) => string;
}

export const SETTING_DEFS: SettingDef[] = [
  {
    key: "groupedExpiryMs",
    token: "group-expiry",
    label: "Grouped tab expiry",
    hint: "e.g. 24h — inactivity before a tab in a group is closed",
    parse: parseDuration,
    format: formatDuration,
  },
  {
    key: "ungroupedExpiryMs",
    token: "default-expiry",
    label: "Default (ungrouped) tab expiry",
    hint: "e.g. 2h — inactivity before an ungrouped tab is closed",
    parse: parseDuration,
    format: formatDuration,
  },
];

// Finds a setting definition by its command token (case-insensitive).
export function findSettingDef(token: string): SettingDef | null {
  const t = String(token || "").trim().toLowerCase();
  return SETTING_DEFS.find((d) => d.token === t) || null;
}

// Merges a raw stored object over the defaults, keeping only valid positive
// numbers so a corrupt/partial blob can never disable expiry.
export function mergeSettings(raw: unknown): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  for (const def of SETTING_DEFS) {
    const v = src[def.key];
    if (typeof v === "number" && isFinite(v) && v > 0) out[def.key] = v;
  }
  return out;
}

// Result of applying a `/settings` edit.
export interface ApplySettingResult {
  ok: boolean;
  settings?: Settings;
  def?: SettingDef;
  message?: string;
  error?: string;
}

// Applies a `/settings <token> <value>` edit against a settings object, purely.
// Returns the updated settings + a confirmation, or an error message.
export function applySettingValue(
  settings: Settings,
  token: string,
  value: string
): ApplySettingResult {
  const def = findSettingDef(token);
  if (!def) {
    const names = SETTING_DEFS.map((d) => d.token).join(", ");
    return { ok: false, error: `Unknown setting "${token}". Try: ${names}` };
  }
  const parsed = def.parse(value);
  if (parsed == null) {
    return { ok: false, error: `Invalid value for ${def.token} — ${def.hint}` };
  }
  const next = { ...settings, [def.key]: parsed };
  return {
    ok: true,
    settings: next,
    def,
    message: `${def.label} set to ${def.format(parsed)}`,
  };
}

// ---- Storage ---------------------------------------------------------------

export function getSettings(): Promise<Settings> {
  return new Promise((resolve) =>
    chrome.storage.local.get(SETTINGS_KEY, (r) => resolve(mergeSettings(r[SETTINGS_KEY])))
  );
}

export function setSettings(settings: Settings): Promise<void> {
  return new Promise((resolve) =>
    chrome.storage.local.set({ [SETTINGS_KEY]: settings }, () => resolve())
  );
}
