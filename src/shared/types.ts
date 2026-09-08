// Shared domain types used across both bundles.

// A parsed URL reduced to the parts we compare on.
export interface UrlParts {
  host: string;
  path: string;
  search: string;
}

// Host + path only (no query), used for shortcut-scope matching.
export interface HostPath {
  host: string;
  path: string;
}

// An open tab in the search index (from the worker).
export interface TabItem {
  tabId?: number;
  windowId?: number;
  title: string;
  url: string;
  lastAccessed?: number;
}

// A history entry in the search index.
export interface HistoryItem {
  title: string;
  url: string;
  lastVisitTime?: number;
  visitCount?: number;
}

// A keyword shortcut: the destination URL template (contains %s) plus a
// human-readable name shown in the pill when the shortcut is armed.
export interface Shortcut {
  url: string;
  name: string;
}

// alias (the token you type to arm it) -> shortcut.
export type Shortcuts = Record<string, Shortcut>;

// A saved favorite slot (a URL, or null when empty).
export type Favorite = string | null;
