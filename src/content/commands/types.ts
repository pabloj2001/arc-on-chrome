// Types for the slash-command system.
import type { Favorite, Shortcuts } from "../../shared/types";

export interface CommandParam {
  name: string;
  optional?: boolean;
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
  setContext: (name: string, expiry: string) => void;
  clearContext: () => void;
  deleteContext: (name: string) => void;
  close?: () => void;
  clearInput?: () => void;
}

export interface Command {
  description: string;
  params: CommandParam[];
  run: (args: string[], ctx: CommandCtx) => void;
}

// Exported settings blob shape (favorites + shortcuts).
export interface SettingsImport {
  favorites: Favorite[] | null;
  shortcuts: Shortcuts | null;
}
