// View-model types for the render-* modules.
import type { GroupInfo } from "../../background/groups";
import type { Favorite } from "../../shared/types";

export type { GroupInfo };

// A row in the results list.
export interface ResultRow {
  type: "tab" | "history" | "domain" | "search" | "command" | "suggestion";
  title?: string;
  url?: string;
  subtitle?: string;
  engineLabel?: string;
  term?: string; // search rows: the raw typed term (kept in the bar on preview)
  tabId?: number;
  windowId?: number;
  name?: string; // command name (type === "command"); fill value (type === "suggestion")
  tag?: string; // override tag label (suggestion rows)
  run?: boolean; // suggestion rows: selecting runs the command immediately
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
