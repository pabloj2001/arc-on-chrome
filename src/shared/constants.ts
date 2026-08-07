// Constants shared by the content and background bundles. Keeping the storage
// keys and tunables in one place stops the two files from drifting apart.

// Storage keys (chrome.storage.local)
export const STORAGE_KEY = "arcFavorites";
export const SHORTCUTS_KEY = "arcShortcuts";
export const CONTEXTS_KEY = "arcContexts"; // [{ groupId, name, color, durationMs, lastActiveAt }]
export const ACTIVE_CONTEXT_KEY = "arcActiveContextId"; // groupId | null

// Tunables
export const FAV_COUNT = 8;
export const MAX_RESULTS = 10;
export const MAX_CONTEXTS = 5;
export const EXPORT_VERSION = 1;

// DOM
export const HOST_ID = "arc-search-bar-host";

// Contexts / alarms
export const CONTEXT_ALARM = "arc-context-check";
export const DEFAULT_DURATION_MS = 24 * 60 * 60 * 1000;

// Color names to cycle contexts through. Limited to colors whose Edge hex we
// map confidently (Edge's Fluent palette has no true red/green), so the bar's
// pill color always matches the tab-strip chip.
export const GROUP_COLORS: Array<`${chrome.tabGroups.Color}`> = [
  "blue", "purple", "pink", "cyan", "orange", "yellow", "grey",
];

// Matches an absolute http(s) URL — used to filter the index to web pages.
export const WEB_URL = /^https?:\/\//i;
