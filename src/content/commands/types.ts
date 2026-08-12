// Types for the slash-command system.
import type { Favorite, Shortcuts } from "../../shared/types";

export interface CommandParam {
  name: string;
  optional?: boolean;
}

// A suggested value for a command param, shown as a results row while entering
// that param. `value` fills the field; `run` (or being the last param) submits.
export interface CommandSuggestion {
  value: string;
  label: string;
  description?: string;
  tag?: string;
  run?: boolean; // selecting this runs the command immediately (e.g. "open modal")
}

// A tracked group's display info the content entry exposes to command suggest().
export interface GroupSuggestSource {
  name: string;
}

// A set favorite the content entry exposes to command suggest().
export interface FavoriteSuggestSource {
  index: number; // 1-based slot
  url: string;
}

// The effects object commands act through — supplied by the content entry.
export interface CommandCtx {
  status: (msg: string) => void;
  setFavorite: (i: number, url: Favorite) => void;
  setShortcut: (alias: string, url: string) => void;
  removeShortcut: (alias: string) => void;
  hasShortcut: (alias: string) => boolean;
  exportSettings: () => void;
  importSettings: (pasted: string | null) => void;
  setGroup: (name: string) => void;
  clearGroup: () => void;
  deleteGroup: (name: string) => void;
  openSettings: () => void;
  setSetting: (token: string, value: string) => void;
  reload: () => void;
  listShortcuts: () => string[];
  listGroups: () => GroupSuggestSource[];
  listFavorites: () => FavoriteSuggestSource[];
  close?: () => void;
  clearInput?: () => void;
}

export interface Command {
  description: string;
  params: CommandParam[];
  run: (args: string[], ctx: CommandCtx) => void;
  // Optional per-param value suggestions shown while filling `argIndex`.
  suggest?: (argIndex: number, current: string, ctx: CommandCtx) => CommandSuggestion[];
}

// Exported settings blob shape (favorites + shortcuts).
export interface SettingsImport {
  favorites: Favorite[] | null;
  shortcuts: Shortcuts | null;
}


// Exported settings blob shape (favorites + shortcuts).
export interface SettingsImport {
  favorites: Favorite[] | null;
  shortcuts: Shortcuts | null;
}
