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
  workStartMin: number; // minutes from local midnight; == workEndMin => 24h (no limit)
  workEndMin: number;
  includeWeekends: boolean; // do Sat/Sun count toward tab expiry?
}

export const DEFAULT_SETTINGS: Settings = {
  groupedExpiryMs: GROUPED_EXPIRY_MS,
  ungroupedExpiryMs: UNGROUPED_EXPIRY_MS,
  workStartMin: 9 * 60, // 09:00
  workEndMin: 18 * 60, // 18:00
  includeWeekends: false,
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

// ---- Time-of-day parsing/formatting ---------------------------------------

// "9", "9:30", "09:30", "9am", "6pm", "18:00" -> minutes from midnight (0..1439),
// or null. Bare hour is allowed; 12h am/pm and 24h both accepted.
export function parseTimeOfDay(str: string): number | null {
  const s = String(str || "").trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ap = m[3];
  if (min > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap === "am") h = h === 12 ? 0 : h;
    else h = h === 12 ? 12 : h + 12;
  } else if (h > 23) {
    return null;
  }
  return h * 60 + min;
}

// Minutes from midnight -> "HH:MM" (24h).
export function formatTimeOfDay(mins: number): string {
  const m = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// ---- Toggle parsing/formatting --------------------------------------------

export function parseToggle(str: string): boolean | null {
  const s = String(str || "").trim().toLowerCase();
  if (["on", "yes", "true", "1", "y", "enable", "enabled"].includes(s)) return true;
  if (["off", "no", "false", "0", "n", "disable", "disabled"].includes(s)) return false;
  return null;
}
export function formatToggle(v: boolean): string {
  return v ? "on" : "off";
}

// ---- Setting registry ------------------------------------------------------

export type SettingKind = "duration" | "time" | "toggle";
export type SettingValue = number | boolean;

// A single adjustable setting: how to name it (command token), label/hint it in
// the modal, its input kind, and how to convert to/from the string the user types.
export interface SettingDef {
  key: keyof Settings;
  token: string; // the /settings <token> name (no spaces)
  label: string; // modal row label
  hint: string; // placeholder / example
  kind: SettingKind;
  parse: (s: string) => SettingValue | null;
  format: (v: SettingValue) => string;
}

export const SETTING_DEFS: SettingDef[] = [
  {
    key: "groupedExpiryMs",
    token: "group-expiry",
    label: "Grouped tab expiry",
    hint: "e.g. 24h — inactivity before a tab in a group is closed",
    kind: "duration",
    parse: parseDuration,
    format: (v) => formatDuration(v as number),
  },
  {
    key: "ungroupedExpiryMs",
    token: "default-expiry",
    label: "Default (ungrouped) tab expiry",
    hint: "e.g. 2h — inactivity before an ungrouped tab is closed",
    kind: "duration",
    parse: parseDuration,
    format: (v) => formatDuration(v as number),
  },
  {
    key: "workStartMin",
    token: "work-start",
    label: "Working hours start",
    hint: "e.g. 9:00 — expiry pauses before this time (start == end disables)",
    kind: "time",
    parse: parseTimeOfDay,
    format: (v) => formatTimeOfDay(v as number),
  },
  {
    key: "workEndMin",
    token: "work-end",
    label: "Working hours end",
    hint: "e.g. 17:00 — expiry pauses after this time (start == end disables)",
    kind: "time",
    parse: parseTimeOfDay,
    format: (v) => formatTimeOfDay(v as number),
  },
  {
    key: "includeWeekends",
    token: "include-weekends",
    label: "Count weekends",
    hint: "on/off — whether Sat/Sun count toward tab expiry",
    kind: "toggle",
    parse: parseToggle,
    format: (v) => formatToggle(v as boolean),
  },
];

// Finds a setting definition by its command token (case-insensitive).
export function findSettingDef(token: string): SettingDef | null {
  const t = String(token || "").trim().toLowerCase();
  return SETTING_DEFS.find((d) => d.token === t) || null;
}

// True if a raw value is valid for a setting's kind (durations must be positive;
// times are 0..1439; toggles are booleans).
function validValue(kind: SettingKind, v: unknown): boolean {
  if (kind === "toggle") return typeof v === "boolean";
  if (typeof v !== "number" || !isFinite(v)) return false;
  if (kind === "duration") return v > 0;
  return v >= 0 && v < 1440; // time
}

// Merges a raw stored object over the defaults, keeping only valid values so a
// corrupt/partial blob can never disable expiry or store nonsense.
export function mergeSettings(raw: unknown): Settings {
  const out = { ...DEFAULT_SETTINGS } as Record<string, SettingValue>;
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  for (const def of SETTING_DEFS) {
    const v = src[def.key];
    if (validValue(def.kind, v)) out[def.key] = v as SettingValue;
  }
  return out as unknown as Settings;
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
  const next = { ...settings, [def.key]: parsed } as Settings;
  return {
    ok: true,
    settings: next,
    def,
    message: `${def.label} set to ${def.format(parsed)}`,
  };
}

// ---- Working-time expiry ---------------------------------------------------

export interface WorkHours {
  workStartMin: number;
  workEndMin: number;
  includeWeekends: boolean;
}

export function workHoursOf(s: Settings): WorkHours {
  return {
    workStartMin: s.workStartMin,
    workEndMin: s.workEndMin,
    includeWeekends: s.includeWeekends,
  };
}

function isWeekend(d: Date): boolean {
  const g = d.getDay(); // 0 = Sun, 6 = Sat (local)
  return g === 0 || g === 6;
}

// The number of milliseconds between `from` and `to` that fall inside the
// configured working hours (local time), skipping weekends when they're
// excluded. When workStart == workEnd the whole day counts (no after-hours
// limit). This is what tab-expiry accrues against, so idle time outside working
// hours / on excluded weekends doesn't push a tab toward closing.
export function workingElapsedMs(from: number, to: number, opts: WorkHours): number {
  if (to <= from) return 0;
  const allDay = opts.workStartMin === opts.workEndMin;
  const startMs = opts.workStartMin * MIN;
  const endMs = opts.workEndMin * MIN;

  let total = 0;
  const cur = new Date(from);
  cur.setHours(0, 0, 0, 0); // local midnight of the day containing `from`
  let dayStart = cur.getTime();
  // Guard against pathological ranges (cap the walk at ~400 days).
  for (let i = 0; dayStart < to && i < 400; i++) {
    const nextMid = dayStart + DAY;
    if (opts.includeWeekends || !isWeekend(new Date(dayStart))) {
      const windows: [number, number][] = [];
      if (allDay) {
        windows.push([dayStart, nextMid]);
      } else if (opts.workStartMin < opts.workEndMin) {
        windows.push([dayStart + startMs, dayStart + endMs]);
      } else {
        // Overnight span (e.g. 22:00–06:00): night tail + early morning.
        windows.push([dayStart + startMs, nextMid]);
        windows.push([dayStart, dayStart + endMs]);
      }
      for (const [ws, we] of windows) {
        const s = Math.max(ws, from);
        const e = Math.min(we, to);
        if (e > s) total += e - s;
      }
    }
    dayStart = nextMid;
  }
  return total;
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
