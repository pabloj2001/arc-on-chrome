// Constants shared by the content and background bundles. Keeping the storage
// keys and tunables in one place stops the two files from drifting apart.

// Storage keys (chrome.storage.local)
export const STORAGE_KEY = "arcFavorites";
export const SHORTCUTS_KEY = "arcShortcuts";
export const ACTIVE_GROUP_KEY = "arcActiveGroupId"; // groupId | null

// Tunables
export const FAV_COUNT = 8;
export const MAX_RESULTS = 10;
export const EXPORT_VERSION = 1;

// DOM
export const HOST_ID = "arc-search-bar-host";

// Tab-expiry alarm + inactivity windows. Groups no longer expire as a unit;
// individual tabs expire on inactivity (ungrouped sooner, grouped later), and a
// tab group Chrome auto-removes once its last tab is closed.
export const GROUP_ALARM = "arc-tab-expiry-check";
export const UNGROUPED_EXPIRY_MS = 2 * 60 * 60 * 1000; // 2h
export const GROUPED_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24h

// Color names to cycle new groups through. Limited to colors whose Edge hex we
// map confidently (Edge's Fluent palette has no true red/green), so the bar's
// pill color always matches the tab-strip chip.
export const GROUP_COLORS: Array<`${chrome.tabGroups.Color}`> = [
  "blue", "purple", "pink", "cyan", "orange", "yellow", "grey",
];

// Matches an absolute http(s) URL — used to filter the index to web pages.
export const WEB_URL = /^https?:\/\//i;
