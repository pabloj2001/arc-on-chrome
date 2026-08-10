// The slash-command registry + name helpers. Each command declares a
// `description`, a `params` list (each shown as a pill), and `run(args, ctx)`
// where `ctx` is the effects object supplied by the content entry. Commands hold
// no state of their own — anything mutable is reached through `ctx`.
import { FAV_COUNT } from "../../shared/constants";
import { normalizeUrl } from "../../shared/url";
import type { Command, CommandCtx } from "./types";

export const COMMANDS: Record<string, Command> = {
  favorite: {
    description: "Save a favorite for quick-open (Cmd+1-8).",
    params: [{ name: "1-8" }, { name: "url" }],
    run: (args: string[], ctx: CommandCtx) => {
      const idx = parseInt(args[0], 10);
      if (!idx || idx < 1 || idx > FAV_COUNT) {
        return ctx.status(`Usage: ${usageOf("favorite")}`);
      }
      const url = normalizeUrl(args.slice(1).join(" "));
      if (!url) return ctx.status(`Provide a URL, e.g. /favorite ${idx} github.com`);
      ctx.setFavorite(idx - 1, url);
      ctx.status(`Saved favorite ${idx} → ${url}`);
    },
  },
  unfavorite: {
    description: "Clear a saved favorite.",
    params: [{ name: "1-8" }],
    run: (args: string[], ctx: CommandCtx) => {
      const idx = parseInt(args[0], 10);
      if (!idx || idx < 1 || idx > FAV_COUNT) {
        return ctx.status(`Usage: ${usageOf("unfavorite")}`);
      }
      ctx.setFavorite(idx - 1, null);
      ctx.status(`Cleared favorite ${idx}`);
    },
  },
  shortcut: {
    description: "Add a keyword search, e.g. /shortcut go https://go/%s",
    params: [{ name: "alias" }, { name: "url with %s" }],
    run: (args: string[], ctx: CommandCtx) => {
      const alias = (args[0] || "").trim().toLowerCase();
      const url = args.slice(1).join(" ").trim();
      if (!alias || /\s/.test(alias)) {
        return ctx.status(`Usage: ${usageOf("shortcut")}`);
      }
      if (!url) {
        return ctx.status(
          `Provide a URL, e.g. /shortcut ${alias} https://example.com/search?q=%s`
        );
      }
      ctx.setShortcut(alias, url);
      ctx.status(`Shortcut "${alias}" → ${url}`);
    },
  },
  unshortcut: {
    description: "Remove a keyword search.",
    params: [{ name: "alias" }],
    run: (args: string[], ctx: CommandCtx) => {
      const alias = (args[0] || "").trim().toLowerCase();
      if (!alias || !ctx.hasShortcut(alias)) {
        return ctx.status(`No shortcut "${alias}"`);
      }
      ctx.removeShortcut(alias);
      ctx.status(`Removed shortcut "${alias}"`);
    },
  },
  export: {
    description: "Copy all settings (favorites + shortcuts) to the clipboard as JSON.",
    params: [],
    run: (args: string[], ctx: CommandCtx) => {
      ctx.exportSettings();
    },
  },
  import: {
    description: "Restore settings from the clipboard (or a file) exported via /export.",
    params: [{ name: "json", optional: true }],
    run: (args: string[], ctx: CommandCtx) => {
      const pasted = args.join(" ").trim();
      ctx.importSettings(pasted || null);
    },
  },
  group: {
    description:
      "Group the current tab into a Chrome tab group. No name clears the active group.",
    params: [{ name: "name", optional: true }],
    run: (args: string[], ctx: CommandCtx) => {
      const name = (args[0] || "").trim();
      if (!name) {
        ctx.clearGroup();
        ctx.status("Group cleared — back to the default space");
        return;
      }
      ctx.setGroup(name); // status is set from the response
    },
  },
  deletegroup: {
    description: "Delete a group: closes its tabs (Chrome removes the empty group).",
    params: [{ name: "name" }],
    run: (args: string[], ctx: CommandCtx) => {
      const name = (args[0] || "").trim();
      if (!name) return ctx.status(`Usage: ${usageOf("deletegroup")}`);
      ctx.deleteGroup(name);
    },
  },
};

// "/name <required> [optional]" usage string derived from a command's params.
export function usageOf(name: string): string {
  const cmd = COMMANDS[name];
  const params = (cmd.params || [])
    .map((p) => (p.optional ? `[${p.name}]` : `<${p.name}>`))
    .join(" ");
  return `/${name}${params ? " " + params : ""}`;
}

// The shortest command name that starts with `prefix` (for ghost completion +
// prefix dispatch), or null. Excludes an exact match.
export function bestCommandByPrefix(prefix: string): string | null {
  const p = prefix.toLowerCase();
  const cands = Object.keys(COMMANDS).filter((n) => n !== p && n.startsWith(p));
  if (!cands.length) return null;
  cands.sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
  return cands[0];
}
