// View-model types for the render-* modules.
import type { ContextInfo } from "../../background/contexts";
import type { Favorite } from "../../shared/types";

export type { ContextInfo };

// A row in the results list.
export interface ResultRow {
  type: "tab" | "history" | "domain" | "search" | "command";
  title?: string;
  url?: string;
  subtitle?: string;
  engineLabel?: string;
  tabId?: number;
  windowId?: number;
  name?: string; // command name (type === "command")
}

// A single command param's live entry state.
export interface CommandState {
  name: string;
  params: { name: string; optional?: boolean }[];
  values: string[];
  index: number;
  enteredFrom: string;
  invalid: Set<number> | null;
}

export type { Favorite };
