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

// alias -> URL template (contains %s).
export type Shortcuts = Record<string, string>;

// A saved favorite slot (a URL, or null when empty).
export type Favorite = string | null;
