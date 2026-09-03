import {
  STORAGE_KEY, SHORTCUTS_KEY, FAV_COUNT, MAX_RESULTS,
} from "../shared/constants";
import {
  normalizeUrl, buildUrl, applyShortcut, canon, hostPath, shortcutDedupKey,
  looksLikeNavigable, isSafeNavigationUrl, faviconUrl, originOf,
} from "../shared/url";
import { MSG } from "../shared/messages";
import {
  getSettings, setSettings, applySettingValue,
} from "../shared/settings";
import { normalizeShortcuts } from "../shared/shortcuts";
import {
  normalizeFavArray, buildSettingsExport, parseSettingsImport,
} from "./settings";
import {
  matchesQuery, templateBase, underBase, hostOf, computeDomainScores,
  bestDomainMatch as pickDomainMatch,
} from "./search/matching";
import { isToggleCombo, isUrlCombo } from "./keyboard/combos";
import { COMMANDS, usageOf, bestCommandByPrefix } from "./commands/registry";
import { ICON_SEARCH, ICON_BACK } from "./ui/icons";
import { mountBar } from "./ui/mount";
import { renderPill as renderPillView } from "./ui/render-pill";
import { renderGhost as renderGhostView } from "./ui/render-ghost";
import { renderFavorites as renderFavoritesView } from "./ui/render-favorites";
import { renderResults as renderResultsView } from "./ui/render-results";
import { renderGroup as renderGroupView } from "./ui/render-group";
import { renderGroupsRow as renderGroupsRowView } from "./ui/render-groups-row";
import { renderCommandChips as renderCommandChipsView } from "./ui/render-command-chips";
import { openSettingsModal } from "./ui/settings-modal";
import type { Favorite, Shortcuts, TabItem, HistoryItem } from "../shared/types";
import type { CommandCtx } from "./commands/types";
import type { ResultRow, CommandState, GroupInfo } from "./ui/types";

declare global {
  interface Window {
    __arcSearchInjected?: boolean;
  }
}

(() => {
  // Only run in the top frame — avoids duplicate bars inside iframes and keeps
  // URL navigation targeting the real tab.
  if (window.top !== window) return;
  if (window.__arcSearchInjected) return;
  window.__arcSearchInjected = true;

  // ICON_SEARCH / ICON_BACK now live in ./ui/icons; STYLES is ./ui/bar.css.

  let host: HTMLDivElement | null = null;
  let overlay: HTMLDivElement | null = null;
  let stack: HTMLDivElement | null = null;
  let input: HTMLInputElement | null = null;
  let barEl: HTMLDivElement | null = null;
  let iconEl: SVGElement | null = null;
  let inputWrap: HTMLDivElement | null = null;
  let ghostEl: HTMLDivElement | null = null;
  let pillEl: HTMLSpanElement | null = null;
  let cmdChipsEl: HTMLSpanElement | null = null;
  let favRow: HTMLDivElement | null = null;
  let groupsRowEl: HTMLDivElement | null = null;
  let resultsEl: HTMLDivElement | null = null;
  let statusEl: HTMLDivElement | null = null;
  let isOpen = false;
  let opensInCurrentTab = false; // cmd+L: submit replaces the current tab
  let defaultUrl = ""; // text the bar is prefilled with on open (cmd+L)
  let favorites: Favorite[] = new Array(FAV_COUNT).fill(null);
  let shortcuts: Shortcuts = {}; // alias -> url template (with %s)
  let activeShortcut: string | null = null; // alias currently shown as a pill
  let dismissedToken: string | null = null; // the typed token the user backspaced out of, to avoid re-arming
  let shortcutTypedToken: string | null = null; // what the user actually typed before the pill armed (e.g. "data")
  let openTabs: TabItem[] = []; // index of open tabs {tabId, windowId, title, url}
  let historyItems: HistoryItem[] = []; // 7-day history {title, url, lastVisitTime}
  let currentTabId: number | null = null; // the tab hosting this bar (excluded from results)
  let results: ResultRow[] = []; // current visible result rows
  let activeIndex = -1; // highlighted result, -1 = none (typing/search)
  let commandState: CommandState | null = null; // active command param entry, or null
  let domainScores: Map<string, number> = new Map(); // host -> score, for inline autocomplete
  let ghostSuffix = ""; // current inline-autocomplete completion (after the caret)
  let typedQuery = ""; // the user's actual typed text (preserved while navigating)
  let navigating = false; // true while previewing a highlighted suggestion's URL
  let activeGroup: GroupInfo | null = null; // { groupId, name, color } or null
  let groupsList: GroupInfo[] = []; // all groups [{ groupId, name, color }]
  let currentTabGroupId = -1; // group id of the tab the bar was opened over (-1 = none)
  let groupTemporarilyExited = false; // one-shot "use the default space" for this bar open

  // ---- Favorites / shortcuts persistence -------------------------------------
  // normalizeFavArray now lives in ./settings.

  chrome.storage.local.get([STORAGE_KEY, SHORTCUTS_KEY], (res) => {
    if (res && Array.isArray(res[STORAGE_KEY])) {
      favorites = normalizeFavArray(res[STORAGE_KEY]);
    }
    if (res && res[SHORTCUTS_KEY] && typeof res[SHORTCUTS_KEY] === "object") {
      shortcuts = normalizeShortcuts(res[SHORTCUTS_KEY]);
    }
    if (isOpen) renderFavorites();
  });

  // Keep every open tab's copy in sync (e.g. after a /favorite in another tab).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[STORAGE_KEY]) {
      favorites = normalizeFavArray(changes[STORAGE_KEY].newValue || []);
      if (isOpen) renderFavorites();
    }
    if (changes[SHORTCUTS_KEY]) {
      shortcuts = normalizeShortcuts(changes[SHORTCUTS_KEY].newValue || {});
    }
  });

  function saveFavorites() {
    return new Promise<void>((resolve) =>
      chrome.storage.local.set({ [STORAGE_KEY]: favorites }, () => resolve())
    );
  }

  function saveShortcuts() {
    return new Promise<void>((resolve) =>
      chrome.storage.local.set({ [SHORTCUTS_KEY]: shortcuts }, () => resolve())
    );
  }

  // ---- Settings export -------------------------------------------------------
  // buildSettingsExport + parseSettingsImport now live in ./settings; the
  // clipboard/file plumbing (downloadSettings, pickSettingsFile) stays here.

  // Fallback when the clipboard API is unavailable/denied: download the JSON.
  function downloadSettings(json: string): boolean {
    try {
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "arc-search-settings.json";
      a.style.display = "none";
      document.documentElement.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    } catch (_) {
      return false;
    }
  }

  // Parses a /export JSON blob and returns the durable settings, or null if the
  // shape/version isn't recognized. Lives in ./settings (parseSettingsImport).

  // Fallback when the clipboard can't be read: prompt for a JSON file and hand
  // its text to `cb`.
  function pickSettingsFile(cb: (text: string | null) => void): boolean {
    try {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json,.json";
      input.style.display = "none";
      input.addEventListener("change", () => {
        const file = input.files && input.files[0];
        input.remove();
        if (!file) return cb(null);
        const reader = new FileReader();
        reader.onload = () => cb(String(reader.result || ""));
        reader.onerror = () => cb(null);
        reader.readAsText(file);
      });
      document.documentElement.appendChild(input);
      input.click();
      return true;
    } catch (_) {
      return false;
    }
  }

  // ---- URL helpers -----------------------------------------------------------
  // parseUrl/normalizeUrl/buildUrl/applyShortcut/faviconUrl/canon/hostPath and
  // the looksLikeNavigable predicate now live in ../shared/url.

  // ---- Command system --------------------------------------------------------
  // The COMMANDS registry + usageOf + bestCommandByPrefix now live in
  // ./commands/registry. Commands reach mutable state through the ctx object
  // built by commandCtx() below.

  function commandCtx() {
    return {
      status,
      setFavorite: (i: number, url: Favorite) => {
        favorites[i] = url;
        saveFavorites();
        renderFavorites();
      },
      setShortcut: (alias: string, url: string, name: string) => {
        shortcuts[alias] = { url, name: name || alias };
        saveShortcuts();
      },
      removeShortcut: (alias: string) => {
        delete shortcuts[alias];
        saveShortcuts();
      },
      hasShortcut: (alias: string) => !!shortcuts[alias],
      exportSettings: () => {
        const json = buildSettingsExport(favorites, shortcuts);
        const shortcutCount = Object.keys(shortcuts).length;
        const favCount = favorites.filter(Boolean).length;
        const ok = () =>
          status(
            `Copied ${favCount} favorite${favCount === 1 ? "" : "s"} + ${shortcutCount} shortcut${shortcutCount === 1 ? "" : "s"} to clipboard`
          );
        const fallback = () =>
          status(
            downloadSettings(json)
              ? "Clipboard unavailable — downloaded settings JSON instead"
              : "Couldn't export settings"
          );
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(json).then(ok, fallback);
        } else {
          fallback();
        }
      },
      importSettings: (pasted: string | null) => {
        const apply = (text: string | null) => {
          if (text == null) return status("Import cancelled");
          const parsed = parseSettingsImport(text);
          if (!parsed) return status("Couldn't read settings — invalid JSON");
          let favCount = 0;
          let shortcutCount = 0;
          if (parsed.favorites) {
            favorites = parsed.favorites;
            favCount = favorites.filter(Boolean).length;
            saveFavorites();
            renderFavorites();
          }
          if (parsed.shortcuts) {
            shortcuts = parsed.shortcuts;
            shortcutCount = Object.keys(shortcuts).length;
            saveShortcuts();
          }
          status(
            `Imported ${favCount} favorite${favCount === 1 ? "" : "s"} + ${shortcutCount} shortcut${shortcutCount === 1 ? "" : "s"}`
          );
        };
        if (pasted) return apply(pasted);
        const viaFile = () =>
          pickSettingsFile(apply) ||
          status("Couldn't read clipboard or open a file");
        if (navigator.clipboard && navigator.clipboard.readText) {
          navigator.clipboard.readText().then(
            (text) => (text && text.trim() ? apply(text) : viaFile()),
            viaFile
          );
        } else {
          viaFile();
        }
      },
      setGroup: (name: string) => {
        chrome.runtime.sendMessage(
          { type: MSG.SET_GROUP, name },
          (res) => {
            if (chrome.runtime.lastError || !res) return;
            if (!res.ok) {
              status("Couldn't create group");
              return;
            }
            activeGroup = { groupId: res.groupId, name: res.name, color: res.color };
            groupTemporarilyExited = false;
            status(`Group "${res.name}" created`);
            renderGroup();
            loadIndex(); // refresh the groups row
          }
        );
      },
      clearGroup: () => {
        chrome.runtime.sendMessage({ type: MSG.CLEAR_GROUP }, () => {
          void chrome.runtime.lastError;
        });
        activeGroup = null;
        groupTemporarilyExited = false;
        renderGroup();
      },
      deleteGroup: (name: string) => {
        chrome.runtime.sendMessage(
          { type: MSG.DELETE_GROUP, name },
          (res) => {
            if (chrome.runtime.lastError || !res) return;
            if (!res.ok) {
              status(`No group named "${name}"`);
              return;
            }
            status(`Deleted group "${res.name}"`);
            loadIndex(); // refresh row + active group
          }
        );
      },
      openSettings: () => {
        close(); // the /settings modal replaces the bar
        getSettings().then((settings) => {
          openSettingsModal({
            settings,
            onSave: (next) => {
              void setSettings(next);
            },
            shortcuts: { ...shortcuts },
            onSaveShortcut: (alias, shortcut, prevAlias) => {
              if (prevAlias && prevAlias !== alias) delete shortcuts[prevAlias];
              shortcuts[alias] = shortcut;
              void saveShortcuts();
            },
            onRemoveShortcut: (alias) => {
              delete shortcuts[alias];
              void saveShortcuts();
            },
          });
        });
      },
      setSetting: (token: string, value: string) => {
        getSettings().then((cur) => {
          const res = applySettingValue(cur, token, value);
          if (res.ok && res.settings) {
            setSettings(res.settings).then(() => status(res.message || "Saved"));
          } else {
            status(res.error || "Couldn't update setting");
          }
        });
      },
      reload: () => {
        chrome.runtime.sendMessage({ type: MSG.RELOAD_EXTENSION }, () => {
          void chrome.runtime.lastError; // the worker tears down as it reloads
        });
        close();
      },
      listShortcuts: () => Object.keys(shortcuts).sort(),
      listGroups: () => groupsList.map((g) => ({ name: g.name })),
      listFavorites: () =>
        favorites
          .map((url, i) => ({ index: i + 1, url: url || "" }))
          .filter((f) => !!f.url),
      close,
      clearInput: () => {
        if (input) input.value = "";
      },
    };
  }

  function runCommand(text: string) {
    const parts = text.slice(1).split(/\s+/).filter(Boolean);
    const name = (parts.shift() || "").toLowerCase();
    const cmd = COMMANDS[name];
    if (!cmd) return status(`Unknown command: /${name}`);
    cmd.run(parts, commandCtx());
  }

  // ---- Command param mode (pills) --------------------------------------------

  // commandState = { name, params, values, index, enteredFrom, invalid } while
  // filling in a command's params, or null. `enteredFrom` is the text to restore
  // if the user backspaces out.
  function enterCommandMode(name: string, firstValue?: string, enteredFrom?: string) {
    const cmd = COMMANDS[name];
    if (!cmd) return;
    if (!cmd.params || !cmd.params.length) {
      cmd.run([], commandCtx()); // no params -> run immediately
      input.value = "";
      input.focus();
      refreshResults();
      return;
    }
    commandState = {
      name,
      params: cmd.params,
      values: [],
      index: 0,
      enteredFrom: enteredFrom || "/" + name,
      invalid: null,
    };
    input.value = firstValue || "";
    status(cmd.description);
    renderCommandChips();
    activeIndex = -1;
    refreshResults();
    input.focus();
  }

  // Leaves command mode, putting `text` in the input. Refocuses so the deferred
  // blur-close doesn't fire.
  function exitCommandMode(text: string) {
    commandState = null;
    renderCommandChips();
    input.value = text || "";
    const n = input.value.length;
    input.setSelectionRange(n, n);
    activeIndex = -1;
    refreshResults();
    input.focus();
  }

  // Back out of the command to the text the user had typed (e.g. "/fav").
  function exitToText() {
    if (!commandState) return;
    const text = commandState.enteredFrom || "/" + commandState.name;
    status("");
    exitCommandMode(text);
  }

  function advanceParam() {
    if (!commandState) return;
    commandState.values[commandState.index] = input.value;
    if (commandState.index < commandState.params.length - 1) {
      commandState.index++;
      input.value = commandState.values[commandState.index] || "";
      renderCommandChips();
    }
  }

  function gotoPrevParam() {
    if (!commandState || commandState.index === 0) return;
    commandState.values[commandState.index] = input.value;
    commandState.index--;
    input.value = commandState.values[commandState.index] || "";
    renderCommandChips();
    const n = input.value.length;
    input.setSelectionRange(n, n);
  }

  // Briefly outline the empty params in red without running the command.
  function flashInvalidParams(indices: number[]) {
    if (!commandState) return;
    commandState.invalid = new Set(indices);
    renderCommandChips();
    setTimeout(() => {
      if (commandState) {
        commandState.invalid = null;
        renderCommandChips();
      }
    }, 700);
  }

  function runCommandStructured() {
    if (!commandState) return;
    commandState.values[commandState.index] = input.value;
    const missing: number[] = [];
    commandState.params.forEach((p, i) => {
      const v = commandState.values[i];
      if (!p.optional && (!v || !v.trim())) missing.push(i);
    });
    if (missing.length) {
      flashInvalidParams(missing);
      return;
    }
    const cmd = COMMANDS[commandState.name];
    const args = commandState.params.map((_, i) => commandState.values[i] || "");
    exitCommandMode(""); // keep the bar open, clear the text
    cmd.run(args, commandCtx()); // shows a status notification
  }

  // ---- Groups (mirror of Chrome tab groups) -----------------------------------------

  function groupActive() {
    return !!activeGroup && !groupTemporarilyExited;
  }

  function dispatchGroupId() {
    return groupActive() ? activeGroup.groupId : null;
  }

  // Instruction shown under the suggestions while a group is active.
  function idleStatus() {
    if (groupActive()) {
      return "← exit group to open in the default space";
    }
    if (activeGroup && groupTemporarilyExited) {
      return "Default space — reopen the bar to return to the group";
    }
    return "";
  }

  // Tints the bar's border, search icon, and background with the active
  // group's color (the group name is shown in the row above the bar).
  function renderGroup() {
    if (!barEl) return;
    renderGroupView({
      bar: barEl,
      icon: iconEl,
      activeGroup: groupActive() ? activeGroup : null,
      iconSearch: ICON_SEARCH,
      iconBack: ICON_BACK,
    });
    // Keep the bottom instruction in sync when nothing else owns the status.
    if (!activeShortcut && !commandState && !input.value.trim()) {
      status(idleStatus());
    }
  }

  // tintBg/hexToRgb now live in ../shared/colors.

  // One-shot: leave the group for this bar session so the next tab opens in the
  // default space. The group stays active and returns when the bar reopens.
  function exitGroupTemporarily() {
    if (!groupActive()) return;
    groupTemporarilyExited = true;
    renderGroup();
    status(idleStatus());
  }

  // Numbered row of open groups above the bar: a "Default" chip on the left,
  // then each open group. Click (or Ctrl+N) switches to one.
  function renderGroupsRow() {
    renderGroupsRowView({
      el: groupsRowEl,
      groups: groupsList,
      activeGroup,
      onDefault: switchToDefault,
      onSwitch: (groupId) => switchGroupByGroupId(groupId),
      onAdd: openGroupCommand,
    });
  }

  // Opens the /group command (with param pills) to create a new group.
  function openGroupCommand() {
    enterCommandMode("group", "", "/group");
  }

  // Switching just changes the active group (where new bar-opened tabs go);
  // the bar stays open and its pill/border update.
  function switchGroupByGroupId(groupId: number) {
    chrome.runtime.sendMessage(
      { type: MSG.SWITCH_GROUP, groupId },
      (res) => {
        if (chrome.runtime.lastError || !res || !res.ok) return;
        activeGroup = res.activeGroup || null;
        groupTemporarilyExited = false;
        renderGroup();
        renderGroupsRow();
      }
    );
  }

  function switchToDefault() {
    chrome.runtime.sendMessage({ type: MSG.CLEAR_GROUP }, () => {
      void chrome.runtime.lastError;
    });
    activeGroup = null;
    groupTemporarilyExited = false;
    renderGroup();
    renderGroupsRow();
  }

  // `digit` is the Ctrl+N number: 1 = default space, 2 = first group, etc.
  function switchGroupByIndex(digit: number) {
    if (digit === 1) return switchToDefault();
    const g = groupsList[digit - 2];
    if (g) switchGroupByGroupId(g.groupId);
  }

  // ---- Shortcut pill ---------------------------------------------------------

  function renderPill() {
    const sc = activeShortcut ? shortcuts[activeShortcut] : null;
    renderPillView({
      pill: pillEl,
      input,
      activeShortcut,
      shortcutName: sc ? sc.name : null,
      shortcutIcon: sc ? faviconUrl(originOf(sc.url) || sc.url) : null,
      commandState,
      opensInCurrentTab,
    });
  }

  // Renders the command pill followed by a pill for EVERY param: completed ones
  // show their value, the active one is the input itself (placed inline), and
  // upcoming ones show as faded placeholders. The input is moved into the active
  // slot and restored to the bar when command mode ends.
  function renderCommandChips() {
    renderCommandChipsView({
      cmdChips: cmdChipsEl,
      inputWrap,
      input,
      ghost: ghostEl,
      commandState,
      onRenderPill: renderPill,
      onUpdateWidth: updateParamInputWidth,
      onJumpToParam: (i) => jumpToParam(i),
      onRenderGhost: renderGhost,
    });
  }

  // Move to a specific param (e.g. clicking a pill), keeping the current value.
  function jumpToParam(i: number) {
    if (!commandState) return;
    commandState.values[commandState.index] = input.value;
    commandState.index = i;
    input.value = commandState.values[i] || "";
    renderCommandChips();
    const n = input.value.length;
    input.setSelectionRange(n, n);
    input.focus();
  }

  function updateParamInputWidth() {
    if (!input || !commandState || !barEl) return;
    // Hug the content...
    const chars = Math.max(input.value.length, 1) + 1;
    input.style.width = chars + "ch";
    // ...but never let the bar overflow: if it does, shrink the input so its
    // text scrolls internally instead of spilling past the bar edge.
    const overflow = barEl.scrollWidth - barEl.clientWidth;
    if (overflow > 0) {
      const current = input.getBoundingClientRect().width;
      const target = Math.max(current - overflow - 2, 40);
      input.style.width = target + "px";
    }
  }

  // Turn "<alias> <rest>" into a pill + query field. `typedToken` is what the
  // user actually typed (may be a prefix that autocompleted), so backspacing the
  // pill can restore exactly that.
  function activateShortcut(alias: string, rest: string, typedToken: string) {
    activeShortcut = alias;
    shortcutTypedToken = typedToken || alias;
    dismissedToken = null;
    input.value = rest || "";
    renderPill();
    const n = input.value.length;
    input.setSelectionRange(n, n);
    status("");
  }

  // The best alias a prefix could autocomplete to: shortest match wins, then
  // alphabetical. Excludes an exact match (handled separately).
  function bestAliasByPrefix(token: string): string | null {
    const t = token.toLowerCase();
    const cands = Object.keys(shortcuts).filter(
      (a) => a !== t && a.startsWith(t)
    );
    if (!cands.length) return null;
    cands.sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
    return cands[0];
  }

  // Which alias pressing space on this first token should arm: an exact alias,
  // or (once 3+ chars are typed) the most likely prefix completion.
  function aliasForSpace(token: string): string | null {
    if (!token) return null;
    if (shortcuts[token]) return token;
    if (token.length >= 3) return bestAliasByPrefix(token);
    return null;
  }

  // Remove the pill and restore the exact text the user typed, so they can use
  // it literally. `dismissedToken` prevents the next space from re-arming until
  // that first token is edited.
  function dismissShortcutPill() {
    const typed = shortcutTypedToken || activeShortcut;
    activeShortcut = null;
    shortcutTypedToken = null;
    dismissedToken = typed;
    renderPill();
    input.value = typed;
    const n = input.value.length;
    input.setSelectionRange(n, n);
    input.focus();
    activeIndex = -1;
    refreshResults();
  }

  // ---- Open tabs + history results -------------------------------------------

  // TRACKING_PARAM + canon (URL de-dup key) now live in ../shared/url.
  // matchesQuery, templateBase, underBase now live in ./search/matching.
  // hostPath now lives in ../shared/url.

  // No shortcut: empty query -> other open tabs; typing -> title/url matches in
  // open tabs then history. With a shortcut pill active: restrict to tabs/history
  // under the shortcut's destination URL (and further narrow by the typed query).

  // While filling a command param, a command may offer value suggestions (e.g.
  // /unshortcut lists aliases, /settings lists setting names). Filtered by what's
  // typed into the active param; empty otherwise.
  function computeSuggestions(): ResultRow[] {
    if (!commandState) return [];
    const cmd = COMMANDS[commandState.name];
    if (!cmd || !cmd.suggest) return [];
    const current = input ? input.value : "";
    const list = cmd.suggest(commandState.index, current, commandCtx()) || [];
    const q = current.trim().toLowerCase();
    const filtered = q
      ? list.filter(
          (s) =>
            s.value.toLowerCase().includes(q) ||
            s.label.toLowerCase().includes(q)
        )
      : list;
    return filtered.slice(0, MAX_RESULTS).map((s) => ({
      type: "suggestion",
      name: s.value,
      title: s.label,
      subtitle: s.description || "",
      tag: s.tag,
      run: s.run,
    }));
  }

  function computeResults(): ResultRow[] {
    if (commandState) return computeSuggestions();
    const raw = input ? input.value : "";

    // Command palette: typing "/" lists matching commands.
    if (!activeShortcut && raw.trim().startsWith("/")) {
      const q = raw.trim().slice(1).toLowerCase();
      let names = Object.keys(COMMANDS).filter((n) => n.startsWith(q));
      if (!names.length) {
        names = Object.keys(COMMANDS).filter(
          (n) =>
            n.includes(q) || COMMANDS[n].description.toLowerCase().includes(q)
        );
      }
      names.sort();
      return names.slice(0, MAX_RESULTS).map((n) => ({
        type: "command",
        name: n,
        title: usageOf(n),
        subtitle: COMMANDS[n].description,
      }));
    }

    let base = null;
    if (activeShortcut) {
      base = templateBase(shortcuts[activeShortcut].url);
      if (!base) return [];
    }
    const tokens = raw.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const out: ResultRow[] = [];
    const seen = new Set<string>();
    // With a shortcut active, collapse results by the value `%s` fills so the
    // many incidental-param variants a template surfaces don't crowd out the
    // genuinely distinct destinations; otherwise use the normal canonical key.
    const keyOf = (url: string) =>
      activeShortcut ? shortcutDedupKey(url, shortcuts[activeShortcut].url) : canon(url);

    // Top result: a website to visit. Prefer a visited domain we can autocomplete
    // to (so "linkedin.c" suggests the known "linkedin.com", matching the ghost);
    // otherwise, if the typed text is itself a complete URL/host, visit it exactly.
    if (!base) {
      const term = raw.trim();
      const completion = bestDomainMatch(term); // full visited host, or null
      let domUrl = null;
      let domTitle = null;
      if (completion) {
        domUrl = "https://" + completion;
        domTitle = completion;
      } else if (looksLikeNavigable(term)) {
        domUrl = normalizeUrl(term);
        domTitle = domUrl
          ? domUrl.replace(/^https?:\/\//i, "").replace(/\/$/, "")
          : term;
      }
      if (domUrl) {
        out.push({ type: "domain", title: domTitle, url: domUrl });
        seen.add(canon(domUrl));
      }
    }

    for (const t of openTabs) {
      if (t.tabId === currentTabId) continue;
      if (base && !underBase(t.url, base)) continue;
      if (tokens.length && !matchesQuery(t, tokens)) continue;
      const c = keyOf(t.url);
      if (seen.has(c)) continue;
      seen.add(c);
      out.push({ type: "tab", title: t.title, url: t.url, tabId: t.tabId, windowId: t.windowId });
      if (out.length >= MAX_RESULTS) break;
    }

    // Include history when there's a query, or a shortcut base to browse under.
    if (out.length < MAX_RESULTS && (tokens.length || base)) {
      for (const h of historyItems) {
        const c = keyOf(h.url);
        if (seen.has(c)) continue;
        if (base && !underBase(h.url, base)) continue;
        if (tokens.length && !matchesQuery(h, tokens)) continue;
        seen.add(c);
        out.push({ type: "history", title: h.title, url: h.url });
        if (out.length >= MAX_RESULTS) break;
      }
    }

    // Offer a "Search for <term>" result as the second suggestion whenever there
    // is a typed term and at least one other suggestion. This lets Enter go to
    // the top match while the search alternative is one step away. In shortcut
    // mode the search runs the shortcut query instead of a plain web search.
    const term = raw.trim();
    if (term && out.length) {
      const searchResult: ResultRow = base
        ? {
            type: "search",
            term,
            title: `Search “${shortcuts[activeShortcut].name}” for “${term}”`,
            engineLabel: templateBase(shortcuts[activeShortcut].url).host,
            url: applyShortcut(shortcuts[activeShortcut].url, term),
          }
        : {
            type: "search",
            term,
            title: `Search for “${term}”`,
            url: `https://www.google.com/search?q=${encodeURIComponent(term)}`,
          };
      if (searchResult.url) {
        out.splice(1, 0, searchResult);
        if (out.length > MAX_RESULTS) out.length = MAX_RESULTS;
      }
    }
    return out;
  }

  function refreshResults(autoHighlightFirst?: boolean) {
    results = computeResults();
    if (activeIndex >= results.length) activeIndex = results.length - 1;
    // While typing a query, highlight the first suggestion by default so Enter
    // goes to it (Arc-style). Only when something is typed, not on empty/prefill.
    if (autoHighlightFirst && activeIndex < 0 && results.length) {
      activeIndex = 0;
    }
    renderResults();
  }

  function renderResults() {
    renderResultsView({
      el: resultsEl,
      items: results,
      activeIndex,
      onChoose: (i) => chooseResult(i),
      onHover: (i) => setActive(i, false),
    });
  }

  function setActive(i: number, scroll: boolean) {
    activeIndex = i;
    if (!resultsEl) return;
    const rows = resultsEl.children;
    for (let k = 0; k < rows.length; k++) {
      rows[k].classList.toggle("active", k === activeIndex);
    }
    if (scroll && activeIndex >= 0 && rows[activeIndex]) {
      rows[activeIndex].scrollIntoView({ block: "nearest" });
    }
  }

  function moveSelection(dir: number) {
    if (!results.length) return;
    let next = activeIndex + dir;
    if (next < -1) next = -1;
    if (next > results.length - 1) next = results.length - 1;
    setActive(next, true);
    previewSelection();
  }

  // Mirror the highlighted suggestion's URL into the bar (omnibox-style). When
  // nothing is highlighted, restore the user's typed text and the ghost. In
  // command param mode the input belongs to the active param, so previewing does
  // nothing (arrowing just moves the highlight; choosing fills the param).
  function previewSelection() {
    if (!input) return;
    if (commandState) return;
    if (activeIndex < 0) {
      navigating = false;
      input.value = typedQuery;
      const n = input.value.length;
      input.setSelectionRange(n, n);
      renderGhost();
      return;
    }
    const r = results[activeIndex];
    if (!r) return;
    navigating = true;
    ghostSuffix = "";
    if (ghostEl) ghostEl.style.display = "none";
    // The search suggestion keeps the typed term in the bar (not the Google URL).
    const shown = r.type === "search" ? r.term : r.url;
    if (shown != null) {
      input.value = shown;
      const n = input.value.length;
      input.setSelectionRange(n, n);
    }
  }

  function chooseResult(i: number) {
    const r = results[i];
    if (!r) return;
    if (r.type === "command") {
      // Remember the typed text (e.g. "/fav") to restore on backspace-out.
      enterCommandMode(r.name, "", input ? input.value : "");
      return;
    }
    if (r.type === "suggestion") {
      if (!commandState || !input) return;
      // Fill the active param with the suggestion's value.
      input.value = r.name || "";
      commandState.values[commandState.index] = r.name || "";
      const isLast = commandState.index >= commandState.params.length - 1;
      if (r.run || isLast) {
        runCommandStructured();
      } else {
        advanceParam();
        activeIndex = -1;
        refreshResults();
        input.focus();
      }
      return;
    }
    close();
    if (r.type === "tab") {
      // Switching to an already-open tab is the sensible action in both modes.
      chrome.runtime.sendMessage({
        type: MSG.ACTIVATE_TAB,
        tabId: r.tabId,
        windowId: r.windowId,
      });
    } else if (
      r.type === "domain" ||
      r.type === "search" ||
      r.type === "history"
    ) {
      // A typed base domain, explicit search, or a chosen history entry always
      // navigates to that exact URL (new tab, or current tab for cmd+L) — never
      // switch to some other open tab that merely shares the domain.
      if (opensInCurrentTab) {
        if (isSafeNavigationUrl(r.url)) location.assign(r.url);
      } else
        chrome.runtime.sendMessage({
          type: MSG.SEARCH_SUBMIT,
          url: r.url,
          groupId: dispatchGroupId(),
        });
    } else if (opensInCurrentTab) {
      if (isSafeNavigationUrl(r.url)) location.assign(r.url); // cmd+L: replace the current page
    } else {
      chrome.runtime.sendMessage({
        type: MSG.OPEN_FAVORITE,
        url: r.url,
        groupId: dispatchGroupId(),
      });
    }
  }

  // `adoptCurrentTabGroup` (set on open) makes the active group follow the tab
  // you're viewing; mid-session refreshes (after /group or /deletegroup) pass
  // false and keep the group those handlers just set, since `sender.tab`'s group
  // snapshot is stale right after a regrouping.
  function loadIndex(adoptCurrentTabGroup?: boolean) {
    chrome.runtime.sendMessage({ type: MSG.GET_INDEX }, (res) => {
      if (chrome.runtime.lastError || !res) return;
      openTabs = res.tabs || [];
      historyItems = res.history || [];
      currentTabId = res.currentTabId != null ? res.currentTabId : null;
      currentTabGroupId =
        res.currentTabGroupId != null ? res.currentTabGroupId : -1;
      groupsList = res.groups || [];
      // Opening the bar adopts the group of the tab you're viewing: if the
      // current tab lives in a group, that becomes the active group (so tabs you
      // open from the bar join it); an ungrouped tab means the default space.
      // This overrides the globally-stored active group. The temporary-exit flag
      // is left untouched here — applyInitialState resets it on each fresh open,
      // so a mid-session refresh (e.g. a storage change) won't undo a ←/Backspace
      // exit.
      if (adoptCurrentTabGroup) {
        activeGroup =
          groupsList.find((c) => c.groupId === currentTabGroupId) || null;
      } else {
        activeGroup = res.activeGroup || null;
      }
      buildDomainScores();
      if (isOpen) {
        renderGroup();
        renderGroupsRow();
        refreshResults();
        renderGhost();
      }
    });
  }

  // ---- Inline URL autocomplete (ghost text) ----------------------------------
  // hostOf + the pure domain ranking now live in ./search/matching.

  function buildDomainScores() {
    domainScores = computeDomainScores(openTabs, historyItems);
  }

  // Wraps the pure ranking with the command/shortcut-mode suppression guard.
  function bestDomainMatch(value: string): string | null {
    if (commandState || activeShortcut) return null;
    return pickDomainMatch(value, domainScores);
  }

  // The completion suffix shown as ghost text: completes a command name when
  // typing "/…", otherwise a visited base domain (e.g. "gith" -> "ub.com"), or "".
  function computeCompletion(value: string): string {
    if (!value || commandState || activeShortcut) return "";
    // Command-name ghost: "/fav" -> "orite".
    if (value.startsWith("/") && !/\s/.test(value)) {
      const partial = value.slice(1).toLowerCase();
      if (!partial) return "";
      const best = bestCommandByPrefix(partial);
      return best ? best.slice(partial.length) : "";
    }
    const best = bestDomainMatch(value);
    if (!best) return "";
    const typedHost = value
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .toLowerCase();
    return best.slice(typedHost.length);
  }

  // Paints the ghost overlay: the typed text (transparent, to occupy width)
  // followed by the completion suffix (faded).
  function renderGhost() {
    if (!ghostEl || !input) return;
    ghostSuffix = navigating ? "" : computeCompletion(input.value);
    renderGhostView({ ghost: ghostEl, input, suffix: ghostSuffix });
  }

  // Accept the ghost completion (Right arrow): fill the text, don't navigate.
  function completeGhost() {
    if (!ghostSuffix) return false;
    input.value = input.value + ghostSuffix;
    const n = input.value.length;
    input.setSelectionRange(n, n);
    ghostSuffix = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  // ---- Key handling ----------------------------------------------------------
  // isToggleCombo / isUrlCombo now live in ./keyboard/combos.

  function onKeyDown(e: KeyboardEvent) {
    if (isToggleCombo(e)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      toggle({});
      return;
    }
    if (isUrlCombo(e)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      toggle({ opensInCurrentTab: true, defaultUrl: location.href });
      return;
    }
    if (!isOpen) return; // when closed, let the page handle its own keys

    // Command param mode: Tab advances to the next param, Shift+Tab goes back
    // (does nothing on the first param), Enter runs. Space types normally.
    if (commandState) {
      if (e.key === "Tab" && e.shiftKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (commandState.index > 0) gotoPrevParam();
        // On the first param, Shift+Tab is a no-op.
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        e.stopImmediatePropagation();
        // Tab picks the highlighted suggestion (fills the param) if any, else
        // advances to the next param.
        if (activeIndex >= 0 && results[activeIndex]) chooseResult(activeIndex);
        else advanceParam();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopImmediatePropagation();
        moveSelection(1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopImmediatePropagation();
        moveSelection(-1);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopImmediatePropagation();
        // A highlighted suggestion wins; otherwise run with the typed values.
        if (activeIndex >= 0 && results[activeIndex]) chooseResult(activeIndex);
        else runCommandStructured();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        close();
        return;
      }
      if (e.key === "Backspace" && input && input.value === "") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (commandState.index > 0) gotoPrevParam();
        else exitToText(); // Backspace out of the first param -> back to text
        return;
      }
      // Left arrow at the start of the field -> previous param.
      if (
        e.key === "ArrowLeft" &&
        input &&
        input.selectionStart === 0 &&
        input.selectionEnd === 0 &&
        commandState.index > 0
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        gotoPrevParam();
        return;
      }
      // Right arrow at the end of the field -> next param.
      if (
        e.key === "ArrowRight" &&
        input &&
        input.selectionStart === input.value.length &&
        input.selectionEnd === input.value.length &&
        commandState.index < commandState.params.length - 1
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        advanceParam();
        return;
      }
      e.stopImmediatePropagation(); // block page; let the key type into the input
      return;
    }

    // Ctrl+1-9 switches group (1 = default, 2 = first group, ...); Cmd+1-8
    // opens the Nth favorite. On macOS metaKey = Cmd, ctrlKey = Ctrl. Uses e.code
    // so the physical digit is used regardless of modifiers.
    if (!e.altKey && !e.shiftKey) {
      const digit = /^Digit([0-9])$/.exec(e.code);
      if (digit) {
        const n = parseInt(digit[1], 10);
        // Ctrl (without Cmd) -> switch group.
        if (e.ctrlKey && !e.metaKey && n >= 1) {
          e.preventDefault();
          e.stopImmediatePropagation();
          switchGroupByIndex(n); // 1 = default, 2..N = group
          return;
        }
        // Cmd (without Ctrl) -> open favorite.
        if (e.metaKey && !e.ctrlKey && n >= 1 && n <= 8) {
          e.preventDefault();
          e.stopImmediatePropagation();
          openFavorite(n - 1);
          return;
        }
      }
    }

    // Ctrl++ (or Ctrl+=) opens the /group command to create a new group.
    if (
      e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      (e.key === "+" || e.key === "=" || e.code === "Equal")
    ) {
      e.preventDefault();
      e.stopImmediatePropagation();
      openGroupCommand();
      return;
    }

    // Arrow keys navigate the results list. Right arrow at the end of the input
    // accepts the inline ghost completion (fills the text, doesn't navigate).
    if (
      e.key === "ArrowRight" &&
      !navigating &&
      ghostSuffix &&
      input &&
      input.selectionStart === input.value.length &&
      input.selectionStart === input.selectionEnd
    ) {
      e.preventDefault();
      e.stopImmediatePropagation();
      completeGhost();
      return;
    }
    // Left arrow at the start of the input, while in a group, temporarily
    // exits it so the next tab opens in the default space.
    if (
      e.key === "ArrowLeft" &&
      groupActive() &&
      !navigating &&
      input &&
      input.selectionStart === 0 &&
      input.selectionEnd === 0
    ) {
      e.preventDefault();
      e.stopImmediatePropagation();
      exitGroupTemporarily();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopImmediatePropagation();
      moveSelection(1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopImmediatePropagation();
      moveSelection(-1);
      return;
    }
    // Tab: first press autofills the (already-highlighted) first suggestion —
    // filling the bar with its URL, or entering a highlighted command. Pressing
    // Tab again moves to the next suggestion. Shift+Tab goes to the previous.
    if (e.key === "Tab") {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.shiftKey) {
        moveSelection(-1);
      } else if (!navigating && activeIndex >= 0 && results[activeIndex]) {
        if (results[activeIndex].type === "command") {
          chooseResult(activeIndex); // enter the command
        } else {
          previewSelection(); // fill the bar with the first suggestion
        }
      } else {
        moveSelection(1);
      }
      return;
    }

    e.stopImmediatePropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && results[activeIndex]) chooseResult(activeIndex);
      else if (results.length && results[0].type === "command") chooseResult(0);
      else submit();
    } else if (
      e.key === "Backspace" &&
      activeShortcut &&
      input &&
      input.value === ""
    ) {
      // Empty query + backspace removes the pill and restores the alias word.
      e.preventDefault();
      dismissShortcutPill();
    } else if (
      e.key === "Backspace" &&
      groupActive() &&
      input &&
      input.value === ""
    ) {
      // Empty bar + backspace inside a group temporarily exits it (like ←),
      // so the next tab opens in the default space.
      e.preventDefault();
      exitGroupTemporarily();
    }
  }

  function onKeyOther(e: KeyboardEvent) {
    if (isOpen) e.stopImmediatePropagation();
  }

  // Close on blur, but only once focus has actually left the whole bar. Deferring
  // and checking the shadow root's active element lets focus move between the
  // input and param pills without closing, while still closing on Escape-blur
  // (e.g. Vimium), click-out, etc.
  function onFocusOut() {
    if (!isOpen) return;
    setTimeout(() => {
      if (!isOpen) return;
      const inside = host && host.shadowRoot && host.shadowRoot.activeElement;
      if (!inside) close();
    }, 0);
  }

  // ---- UI --------------------------------------------------------------------

  function status(msg: string) {
    if (statusEl) statusEl.textContent = msg || "";
  }

  function openFavorite(i: number) {
    const url = favorites[i];
    if (!url) {
      status(`Favorite ${i + 1} is empty. Set it with /favorite ${i + 1} <url>`);
      return;
    }
    const groupId = dispatchGroupId();
    close();
    // With pinning on, favorites are pinned tabs aligned to the favorite slots,
    // so just focus the Nth pinned tab (index i) — its URL may have drifted.
    // Falls back to URL match/create when this window has no such pinned slot.
    chrome.runtime.sendMessage({ type: MSG.OPEN_FAVORITE, url, groupId, index: i });
  }

  function renderFavorites() {
    renderFavoritesView({
      favRow,
      favorites,
      onOpen: (i) => openFavorite(i),
      onEmpty: (i) => {
        // Start the /favorite command with this slot number and the current
        // tab's URL prefilled.
        enterCommandMode("favorite", String(i + 1));
        advanceParam(); // commit the slot number, move to the url param
        input.value = location.href;
        updateParamInputWidth();
        input.focus();
        input.select();
      },
    });
  }

  // STYLES moved to ./ui/bar.css (imported as text via esbuild).

  function open(opts?: { opensInCurrentTab?: boolean; defaultUrl?: string }) {
    if (isOpen) return;
    opts = opts || {};
    isOpen = true;
    opensInCurrentTab = !!opts.opensInCurrentTab;
    defaultUrl = opts.defaultUrl || "";

    const refs = mountBar();
    host = refs.host;
    overlay = refs.overlay;
    stack = refs.stack;
    barEl = refs.bar;
    iconEl = refs.icon;
    input = refs.input;
    inputWrap = refs.inputWrap;
    ghostEl = refs.ghost;
    pillEl = refs.pill;
    cmdChipsEl = refs.cmdChips;
    favRow = refs.favRow;
    groupsRowEl = refs.groupsRow;
    resultsEl = refs.results;
    statusEl = refs.status;

    // Inside a group the icon is a back arrow that temporarily exits to default.
    iconEl.addEventListener("click", () => {
      if (groupActive()) exitGroupTemporarily();
    });
    pillEl.addEventListener("click", () => {
      if (activeShortcut) dismissShortcutPill();
    });

    applyInitialState();
    renderFavorites();
    loadIndex(true); // adopt the current tab's group on open

    // Clicking the backdrop closes; clicking anything else inside keeps input
    // focus (so favorite buttons work without the blur-close firing first).
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) {
        close();
      } else if (e.target !== input) {
        e.preventDefault();
      }
    });

    input.addEventListener("blur", onFocusOut);
    input.addEventListener("input", () => {
      // Command param mode: keep the active-param pill sized to its content and
      // refresh any value suggestions as the user types (no auto-highlight, so
      // Enter still runs with the typed value unless a suggestion is chosen).
      if (commandState) {
        updateParamInputWidth();
        activeIndex = -1;
        refreshResults();
        return;
      }
      const v = input.value;
      typedQuery = v; // remember what the user actually typed
      navigating = false;

      // Enter command param mode when a full/prefix command name is followed by
      // a space (e.g. "/favorite " or "/fav " -> autocompletes to /favorite).
      // Only for commands that declare params; a no-param command (e.g. /settings
      // or /export) keeps the raw text so inline args like "/settings x y" reach
      // runCommand on Enter instead of the command firing on the first space.
      if (!activeShortcut) {
        const cm = v.match(/^\/(\w+)\s([\s\S]*)$/);
        if (cm) {
          const name = COMMANDS[cm[1]] ? cm[1] : bestCommandByPrefix(cm[1]);
          if (name && COMMANDS[name].params && COMMANDS[name].params.length) {
            enterCommandMode(name, cm[2], "/" + cm[1]);
            return;
          }
        }
      }

      // Arm a shortcut pill when the first token (exact alias, or a 3+ char
      // prefix of one) is followed by a space — space autocompletes the alias.
      if (!activeShortcut) {
        const firstTok = v.split(/\s/)[0];
        if (dismissedToken && firstTok !== dismissedToken) dismissedToken = null;
        const m = v.match(/^(\S+)\s([\s\S]*)$/);
        if (m && m[1] !== dismissedToken) {
          const alias = aliasForSpace(m[1]);
          if (alias) {
            activateShortcut(alias, m[2], m[1]);
            activeIndex = -1;
            refreshResults(true);
            renderGhost();
            return;
          }
        }
      }

      // Status line: a "press space" alias suggestion (command list shows in the
      // results panel now).
      if (
        !activeShortcut &&
        !v.startsWith("/") &&
        v.length &&
        !/\s/.test(v) &&
        v !== dismissedToken
      ) {
        const alias = aliasForSpace(v);
        status(alias && alias !== v ? `space → ${alias}` : "");
      } else {
        status("");
      }
      activeIndex = -1; // reset selection whenever the query changes
      // Auto-highlight the first result only when a query is actually typed.
      refreshResults(v.trim().length > 0);
      renderGhost();
    });

    // Reliable Escape/Enter path when nothing upstream intercepts the key.
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        submit();
      }
    });

    input.focus();
  }

  function applyInitialState() {
    activeShortcut = null;
    dismissedToken = null;
    shortcutTypedToken = null;
    commandState = null;
    activeIndex = -1;
    navigating = false;
    groupTemporarilyExited = false; // group returns on each fresh open
    typedQuery = defaultUrl || "";
    input.value = defaultUrl || "";
    renderCommandChips();
    renderPill();
    renderGroup();
    renderGroupsRow();
    if (defaultUrl) input.select(); // highlight the prefilled URL for easy replace
    status(idleStatus());
    refreshResults();
    renderGhost();
  }

  // Sends a resolved URL to the right place: the current tab (cmd+L) or a new
  // tab (cmd+T, added to the active group when one is set).
  function dispatch(url: string) {
    const groupId = dispatchGroupId();
    close();
    if (opensInCurrentTab) {
      location.assign(url);
    } else {
      chrome.runtime.sendMessage({ type: MSG.SEARCH_SUBMIT, url, groupId });
    }
  }

  function submit() {
    // Active shortcut pill: substitute the query into the template.
    if (activeShortcut) {
      const url = applyShortcut(shortcuts[activeShortcut].url, input.value);
      if (url) dispatch(url);
      else close();
      return;
    }
    const raw = input.value;
    if (raw.trim().startsWith("/")) {
      runCommand(raw.trim());
      input.value = "";
      return;
    }
    const url = buildUrl(raw);
    if (!url) {
      close();
      return;
    }
    dispatch(url);
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    activeShortcut = null;
    dismissedToken = null;
    shortcutTypedToken = null;
    commandState = null;
    results = [];
    activeIndex = -1;
    if (host && host.parentNode) host.parentNode.removeChild(host);
    ghostSuffix = "";
    host = overlay = stack = input = barEl = inputWrap = ghostEl = pillEl = cmdChipsEl = favRow = groupsRowEl = resultsEl = statusEl = null;
  }

  function toggle(opts?: { opensInCurrentTab?: boolean; defaultUrl?: string }) {
    opts = opts || {};
    const nextCurrent = !!opts.opensInCurrentTab;
    if (isOpen) {
      if (nextCurrent !== opensInCurrentTab) {
        opensInCurrentTab = nextCurrent;
        defaultUrl = opts.defaultUrl || "";
        applyInitialState();
        input.focus();
      } else {
        close();
      }
    } else {
      open(opts);
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === MSG.TOGGLE_ARC_SEARCH) {
      toggle({
        opensInCurrentTab: !!message.opensInCurrentTab,
        defaultUrl: message.useCurrentUrl ? location.href : "",
      });
    }
  });

  // Registered at document_start so they run before page scripts on the capture
  // phase and can block the page from seeing keys while the bar is open.
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyOther, true);
  window.addEventListener("keypress", onKeyOther, true);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) close();
  });
  window.addEventListener("blur", close);
})();