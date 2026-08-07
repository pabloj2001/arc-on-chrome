// @ts-nocheck
import {
  STORAGE_KEY, SHORTCUTS_KEY, FAV_COUNT, MAX_RESULTS, MAX_CONTEXTS,
  HOST_ID, EXPORT_VERSION,
} from "../shared/constants";
import {
  normalizeUrl, buildUrl, applyShortcut, faviconUrl, canon, hostPath,
  looksLikeNavigable,
} from "../shared/url";
import { groupHex, groupTextColor, tintBg } from "../shared/colors";
import { MSG } from "../shared/messages";
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
import STYLES from "./ui/bar.css";

(() => {
  // Only run in the top frame — avoids duplicate bars inside iframes and keeps
  // URL navigation targeting the real tab.
  if (window.top !== window) return;
  if (window.__arcSearchInjected) return;
  window.__arcSearchInjected = true;

  // ICON_SEARCH / ICON_BACK now live in ./ui/icons; STYLES is ./ui/bar.css.

  let host = null;
  let overlay = null;
  let stack = null;
  let input = null;
  let barEl = null;
  let iconEl = null;
  let inputWrap = null;
  let ghostEl = null;
  let pillEl = null;
  let cmdChipsEl = null;
  let favRow = null;
  let contextsRowEl = null;
  let resultsEl = null;
  let statusEl = null;
  let isOpen = false;
  let opensInCurrentTab = false; // cmd+L: submit replaces the current tab
  let defaultUrl = ""; // text the bar is prefilled with on open (cmd+L)
  let favorites = new Array(FAV_COUNT).fill(null);
  let shortcuts = {}; // alias -> url template (with %s)
  let activeShortcut = null; // alias currently shown as a pill
  let dismissedToken = null; // the typed token the user backspaced out of, to avoid re-arming
  let shortcutTypedToken = null; // what the user actually typed before the pill armed (e.g. "data")
  let openTabs = []; // index of open tabs {tabId, windowId, title, url}
  let historyItems = []; // 7-day history {title, url, lastVisitTime}
  let currentTabId = null; // the tab hosting this bar (excluded from results)
  let results = []; // current visible result rows
  let activeIndex = -1; // highlighted result, -1 = none (typing/search)
  let commandState = null; // active command param entry, or null
  let domainScores = new Map(); // host -> score, for inline autocomplete
  let ghostSuffix = ""; // current inline-autocomplete completion (after the caret)
  let typedQuery = ""; // the user's actual typed text (preserved while navigating)
  let navigating = false; // true while previewing a highlighted suggestion's URL
  let activeContext = null; // { groupId, name, color } or null
  let contextsList = []; // all tracked contexts [{ groupId, name, color }]
  let currentTabGroupId = -1; // group id of the tab the bar was opened over (-1 = none)
  let contextTemporarilyExited = false; // one-shot "use the default space" for this bar open

  // ---- Favorites / shortcuts persistence -------------------------------------
  // normalizeFavArray now lives in ./settings.

  chrome.storage.local.get([STORAGE_KEY, SHORTCUTS_KEY], (res) => {
    if (res && Array.isArray(res[STORAGE_KEY])) {
      favorites = normalizeFavArray(res[STORAGE_KEY]);
    }
    if (res && res[SHORTCUTS_KEY] && typeof res[SHORTCUTS_KEY] === "object") {
      shortcuts = res[SHORTCUTS_KEY];
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
      shortcuts = changes[SHORTCUTS_KEY].newValue || {};
    }
  });

  function saveFavorites() {
    return new Promise((resolve) =>
      chrome.storage.local.set({ [STORAGE_KEY]: favorites }, resolve)
    );
  }

  function saveShortcuts() {
    return new Promise((resolve) =>
      chrome.storage.local.set({ [SHORTCUTS_KEY]: shortcuts }, resolve)
    );
  }

  // ---- Settings export -------------------------------------------------------
  // buildSettingsExport + parseSettingsImport now live in ./settings; the
  // clipboard/file plumbing (downloadSettings, pickSettingsFile) stays here.

  // Fallback when the clipboard API is unavailable/denied: download the JSON.
  function downloadSettings(json) {
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
  function pickSettingsFile(cb) {
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
      setFavorite: (i, url) => {
        favorites[i] = url;
        saveFavorites();
        renderFavorites();
      },
      setShortcut: (alias, url) => {
        shortcuts[alias] = url;
        saveShortcuts();
      },
      removeShortcut: (alias) => {
        delete shortcuts[alias];
        saveShortcuts();
      },
      hasShortcut: (alias) => !!shortcuts[alias],
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
      importSettings: (pasted) => {
        const apply = (text) => {
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
      setContext: (name, expiry) => {
        chrome.runtime.sendMessage(
          { type: MSG.SET_CONTEXT, name, expiry },
          (res) => {
            if (chrome.runtime.lastError || !res) return;
            if (!res.ok) {
              status(
                res.reason === "duplicate"
                  ? `A context named "${name}" already exists`
                  : res.reason === "limit"
                  ? "Context limit reached (max 5) — delete one first"
                  : "Couldn't create context"
              );
              return;
            }
            activeContext = { groupId: res.groupId, name: res.name, color: res.color };
            contextTemporarilyExited = false;
            status(`Context "${res.name}" created`);
            renderContext();
            loadIndex(); // refresh the contexts row
          }
        );
      },
      clearContext: () => {
        chrome.runtime.sendMessage({ type: MSG.CLEAR_CONTEXT }, () => {
          void chrome.runtime.lastError;
        });
        activeContext = null;
        contextTemporarilyExited = false;
        renderContext();
      },
      deleteContext: (name) => {
        chrome.runtime.sendMessage(
          { type: MSG.DELETE_CONTEXT, name },
          (res) => {
            if (chrome.runtime.lastError || !res) return;
            if (!res.ok) {
              status(`No context named "${name}"`);
              return;
            }
            status(`Deleted context "${res.name}"`);
            loadIndex(); // refresh row + active context
          }
        );
      },
      close,
      clearInput: () => {
        if (input) input.value = "";
      },
    };
  }

  function runCommand(text) {
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
  function enterCommandMode(name, firstValue, enteredFrom) {
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
  function exitCommandMode(text) {
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
  function flashInvalidParams(indices) {
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
    const missing = [];
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

  // ---- Context (ephemeral tab group) -----------------------------------------

  function contextActive() {
    return !!activeContext && !contextTemporarilyExited;
  }

  function contextGroupIdForDispatch() {
    return contextActive() ? activeContext.groupId : null;
  }

  // Instruction shown under the suggestions while a context is active.
  function idleStatus() {
    if (contextActive()) {
      return "← exit context to open in the default space";
    }
    if (activeContext && contextTemporarilyExited) {
      return "Default space — reopen the bar to return to the context";
    }
    return "";
  }

  // Tints the bar's border, search icon, and background with the active
  // context's color (the context name is shown in the row above the bar).
  function renderContext() {
    if (!barEl) return;
    if (contextActive()) {
      const hex = groupHex(activeContext.color);
      barEl.style.setProperty("--ctx-color", hex);
      barEl.style.background = tintBg(hex);
      if (iconEl) {
        iconEl.innerHTML = ICON_BACK; // clickable back arrow -> exit to default
        iconEl.style.color = hex;
        iconEl.style.opacity = "1";
        iconEl.classList.add("clickable");
        iconEl.setAttribute("aria-label", "Back to default space");
      }
      barEl.classList.add("has-context");
    } else {
      barEl.style.background = "";
      if (iconEl) {
        iconEl.innerHTML = ICON_SEARCH;
        iconEl.style.color = "";
        iconEl.style.opacity = "";
        iconEl.classList.remove("clickable");
        iconEl.removeAttribute("aria-label");
      }
      barEl.classList.remove("has-context");
    }
    // Keep the bottom instruction in sync when nothing else owns the status.
    if (!activeShortcut && !commandState && !input.value.trim()) {
      status(idleStatus());
    }
  }

  // tintBg/hexToRgb now live in ../shared/colors.

  // One-shot: leave the context for this bar session so the next tab opens in the
  // default space. The context stays active and returns when the bar reopens.
  function exitContextTemporarily() {
    if (!contextActive()) return;
    contextTemporarilyExited = true;
    renderContext();
    status(idleStatus());
  }

  // Numbered row of contexts above the bar: a "0" default chip on the far left,
  // then each tracked context. Click (or Cmd/Ctrl+Shift+N) switches to one.
  function renderContextsRow() {
    if (!contextsRowEl) return;
    contextsRowEl.textContent = "";
    if (!contextsList.length) {
      contextsRowEl.style.display = "none";
      return;
    }
    contextsRowEl.style.display = "flex";

    // Default (no context) chip, number 1.
    const def = document.createElement("button");
    def.className = "ctx-chip ctx-default" + (!activeContext ? " active" : "");
    def.title = "Default space (Ctrl+1)";
    const dnum = document.createElement("span");
    dnum.className = "ctx-num";
    dnum.textContent = "1";
    const dnm = document.createElement("span");
    dnm.className = "ctx-cname";
    dnm.textContent = "Default";
    def.appendChild(dnum);
    def.appendChild(dnm);
    def.addEventListener("click", switchContextToDefault);
    contextsRowEl.appendChild(def);

    contextsList.forEach((c, i) => {
      const hex = groupHex(c.color);
      const chip = document.createElement("button");
      chip.className =
        "ctx-chip" +
        (activeContext && activeContext.groupId === c.groupId ? " active" : "");
      chip.style.background = hex;
      chip.style.color = groupTextColor();
      chip.title = `Switch to "${c.name}" (Ctrl+${i + 2})`;
      const num = document.createElement("span");
      num.className = "ctx-num";
      num.textContent = String(i + 2);
      const nm = document.createElement("span");
      nm.className = "ctx-cname";
      nm.textContent = c.name;
      chip.appendChild(num);
      chip.appendChild(nm);
      chip.addEventListener("click", () => switchContextByGroupId(c.groupId));
      contextsRowEl.appendChild(chip);
    });

    // "+" chip to create a new context (hidden at the 5-context limit).
    if (contextsList.length < MAX_CONTEXTS) {
      const add = document.createElement("button");
      add.className = "ctx-chip ctx-add";
      add.title = "New context (Ctrl++)";
      add.textContent = "+";
      add.addEventListener("click", openContextCommand);
      contextsRowEl.appendChild(add);
    }
  }

  // Opens the /context command (with param pills) to create a new context.
  function openContextCommand() {
    if (contextsList.length >= MAX_CONTEXTS) {
      status("Context limit reached (max 5) — delete one first");
      return;
    }
    enterCommandMode("context", "", "/context");
  }

  // Switching just changes the active context (where new bar-opened tabs go);
  // the bar stays open and its pill/border update.
  function switchContextByGroupId(groupId) {
    chrome.runtime.sendMessage(
      { type: MSG.SWITCH_CONTEXT, groupId },
      (res) => {
        if (chrome.runtime.lastError || !res || !res.ok) return;
        activeContext = res.activeContext || null;
        contextTemporarilyExited = false;
        renderContext();
        renderContextsRow();
      }
    );
  }

  function switchContextToDefault() {
    chrome.runtime.sendMessage({ type: MSG.CLEAR_CONTEXT }, () => {
      void chrome.runtime.lastError;
    });
    activeContext = null;
    contextTemporarilyExited = false;
    renderContext();
    renderContextsRow();
  }

  // `digit` is the Ctrl+N number: 1 = default space, 2 = first context, etc.
  function switchContextByIndex(digit) {
    if (digit === 1) return switchContextToDefault();
    const ctx = contextsList[digit - 2];
    if (ctx) switchContextByGroupId(ctx.groupId);
  }

  // ---- Shortcut pill ---------------------------------------------------------

  function renderPill() {
    if (!pillEl) return;
    if (activeShortcut) {
      pillEl.textContent = activeShortcut;
      pillEl.style.display = "inline-flex";
      input.placeholder = `Search "${activeShortcut}"…`;
    } else {
      pillEl.style.display = "none";
      if (!commandState) {
        input.placeholder = opensInCurrentTab
          ? "Edit URL or search…"
          : "Search or enter address…";
      }
    }
  }

  // Renders the command pill followed by a pill for EVERY param: completed ones
  // show their value, the active one is the input itself (placed inline), and
  // upcoming ones show as faded placeholders. The input is moved into the active
  // slot and restored to the bar when command mode ends.
  function renderCommandChips() {
    if (!cmdChipsEl) return;
    // Detach the input before clearing so we don't destroy it, then re-place it.
    if (inputWrap) inputWrap.appendChild(input);
    cmdChipsEl.textContent = "";

    if (!commandState) {
      cmdChipsEl.style.display = "none";
      input.classList.remove("param-active");
      input.style.width = "";
      renderPill();
      return;
    }
    cmdChipsEl.style.display = "inline-flex";

    const cp = document.createElement("span");
    cp.className = "cmd-pill";
    cp.textContent = "/" + commandState.name;
    cmdChipsEl.appendChild(cp);

    for (let i = 0; i < commandState.params.length; i++) {
      const invalid = commandState.invalid && commandState.invalid.has(i);
      if (i === commandState.index) {
        const wrap = document.createElement("span");
        wrap.className = "param-pill active" + (invalid ? " invalid" : "");
        const lab = document.createElement("span");
        lab.className = "plabel";
        lab.textContent = commandState.params[i].name;
        wrap.appendChild(lab);
        input.placeholder = "";
        input.classList.add("param-active");
        wrap.appendChild(input);
        cmdChipsEl.appendChild(wrap);
        updateParamInputWidth();
      } else {
        const value = commandState.values[i];
        const hasVal = value != null && value !== "";
        const pp = document.createElement("span");
        pp.className =
          "param-pill" + (hasVal ? " filled" : " upcoming") + (invalid ? " invalid" : "");
        const lab = document.createElement("span");
        lab.className = "plabel";
        lab.textContent = commandState.params[i].name;
        pp.appendChild(lab);
        if (hasVal) {
          const val = document.createElement("span");
          val.className = "pval";
          val.textContent = value;
          pp.appendChild(val);
        }
        pp.addEventListener("click", () => jumpToParam(i));
        cmdChipsEl.appendChild(pp);
      }
    }
    if (ghostEl) renderGhost(); // hide any stale ghost while in command mode
    input.focus();
  }

  // Move to a specific param (e.g. clicking a pill), keeping the current value.
  function jumpToParam(i) {
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
  function activateShortcut(alias, rest, typedToken) {
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
  function bestAliasByPrefix(token) {
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
  function aliasForSpace(token) {
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
  function computeResults() {
    if (commandState) return [];
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
      base = templateBase(shortcuts[activeShortcut]);
      if (!base) return [];
    }
    const tokens = raw.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const out = [];
    const seen = new Set();

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
      const c = canon(t.url);
      if (seen.has(c)) continue;
      seen.add(c);
      out.push({ type: "tab", title: t.title, url: t.url, tabId: t.tabId, windowId: t.windowId });
      if (out.length >= MAX_RESULTS) break;
    }

    // Include history when there's a query, or a shortcut base to browse under.
    if (out.length < MAX_RESULTS && (tokens.length || base)) {
      for (const h of historyItems) {
        const c = canon(h.url);
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
      const searchResult = base
        ? {
            type: "search",
            term,
            title: `Search “${activeShortcut}” for “${term}”`,
            engineLabel: templateBase(shortcuts[activeShortcut]).host,
            url: applyShortcut(shortcuts[activeShortcut], term),
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

  function refreshResults(autoHighlightFirst) {
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
    if (!resultsEl) return;
    resultsEl.textContent = "";
    if (!results.length) {
      resultsEl.style.display = "none";
      return;
    }
    resultsEl.style.display = "block";
    results.forEach((r, i) => {
      const row = document.createElement("div");
      row.className = "result" + (i === activeIndex ? " active" : "");
      row.dataset.type = r.type;

      if (r.type === "command") {
        const ic = document.createElement("div");
        ic.className = "result-ic";
        ic.textContent = "/";
        row.appendChild(ic);
      } else if (r.type === "search") {
        const ic = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        ic.setAttribute("class", "result-ic-svg");
        ic.setAttribute("viewBox", "0 0 24 24");
        ic.setAttribute("fill", "none");
        ic.setAttribute("stroke", "currentColor");
        ic.setAttribute("stroke-width", "2");
        ic.setAttribute("stroke-linecap", "round");
        ic.innerHTML =
          '<circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>';
        row.appendChild(ic);
      } else {
        const img = document.createElement("img");
        img.src = faviconUrl(r.url);
        img.alt = "";
        img.addEventListener("error", () => {
          img.style.visibility = "hidden";
        });
        row.appendChild(img);
      }

      const meta = document.createElement("div");
      meta.className = "meta";
      const title = document.createElement("div");
      title.className = "title";
      title.textContent =
        r.type === "command" || r.type === "search" ? r.title : r.title || r.url;
      const url = document.createElement("div");
      url.className = "url";
      url.textContent =
        r.type === "command"
          ? r.subtitle
          : r.type === "search"
          ? r.engineLabel || "Google Search"
          : r.url;
      meta.appendChild(title);
      meta.appendChild(url);

      const tag = document.createElement("div");
      tag.className = "tag";
      tag.textContent =
        r.type === "tab"
          ? "Open tab"
          : r.type === "command"
          ? "Command"
          : r.type === "domain"
          ? "Website"
          : r.type === "search"
          ? "Search"
          : "History";

      row.appendChild(meta);
      row.appendChild(tag);
      row.addEventListener("click", () => chooseResult(i));
      row.addEventListener("mousemove", () => setActive(i, false));
      resultsEl.appendChild(row);
    });
  }

  function setActive(i, scroll) {
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

  function moveSelection(dir) {
    if (!results.length) return;
    let next = activeIndex + dir;
    if (next < -1) next = -1;
    if (next > results.length - 1) next = results.length - 1;
    setActive(next, true);
    previewSelection();
  }

  // Mirror the highlighted suggestion's URL into the bar (omnibox-style). When
  // nothing is highlighted, restore the user's typed text and the ghost.
  function previewSelection() {
    if (!input) return;
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

  function chooseResult(i) {
    const r = results[i];
    if (!r) return;
    if (r.type === "command") {
      // Remember the typed text (e.g. "/fav") to restore on backspace-out.
      enterCommandMode(r.name, "", input ? input.value : "");
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
      if (opensInCurrentTab) location.assign(r.url);
      else
        chrome.runtime.sendMessage({
          type: MSG.SEARCH_SUBMIT,
          url: r.url,
          groupId: contextGroupIdForDispatch(),
        });
    } else if (opensInCurrentTab) {
      location.assign(r.url); // cmd+L: replace the current page
    } else {
      chrome.runtime.sendMessage({
        type: MSG.OPEN_FAVORITE,
        url: r.url,
        groupId: contextGroupIdForDispatch(),
      });
    }
  }

  function loadIndex() {
    chrome.runtime.sendMessage({ type: MSG.GET_INDEX }, (res) => {
      if (chrome.runtime.lastError || !res) return;
      openTabs = res.tabs || [];
      historyItems = res.history || [];
      currentTabId = res.currentTabId != null ? res.currentTabId : null;
      currentTabGroupId =
        res.currentTabGroupId != null ? res.currentTabGroupId : -1;
      activeContext = res.activeContext || null;
      contextsList = res.contexts || [];
      // cmd+L acts on the current tab, so show the context that tab actually
      // lives in (a different group than the selected context, or default when
      // the tab isn't in a tracked context) rather than the globally-active one.
      if (opensInCurrentTab) {
        activeContext =
          contextsList.find((c) => c.groupId === currentTabGroupId) || null;
        contextTemporarilyExited = false;
      }
      buildDomainScores();
      if (isOpen) {
        renderContext();
        renderContextsRow();
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
  function bestDomainMatch(value) {
    if (commandState || activeShortcut) return null;
    return pickDomainMatch(value, domainScores);
  }

  // The completion suffix shown as ghost text: completes a command name when
  // typing "/…", otherwise a visited base domain (e.g. "gith" -> "ub.com"), or "".
  function computeCompletion(value) {
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
    if (!ghostSuffix) {
      ghostEl.style.display = "none";
      ghostEl.textContent = "";
      return;
    }
    ghostEl.textContent = "";
    const typed = document.createElement("span");
    typed.className = "g-typed";
    typed.textContent = input.value;
    const suffix = document.createElement("span");
    suffix.className = "g-suffix";
    suffix.textContent = ghostSuffix;
    ghostEl.appendChild(typed);
    ghostEl.appendChild(suffix);
    ghostEl.style.display = "flex";
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

  function onKeyDown(e) {
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
        advanceParam();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopImmediatePropagation();
        runCommandStructured();
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

    // Ctrl+1-9 switches context (1 = default, 2 = first context, ...); Cmd+1-8
    // opens the Nth favorite. On macOS metaKey = Cmd, ctrlKey = Ctrl. Uses e.code
    // so the physical digit is used regardless of modifiers.
    if (!e.altKey && !e.shiftKey) {
      const digit = /^Digit([0-9])$/.exec(e.code);
      if (digit) {
        const n = parseInt(digit[1], 10);
        // Ctrl (without Cmd) -> switch context.
        if (e.ctrlKey && !e.metaKey && n >= 1) {
          e.preventDefault();
          e.stopImmediatePropagation();
          switchContextByIndex(n); // 1 = default, 2..N = context
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

    // Ctrl++ (or Ctrl+=) opens the /context command to create a new context.
    if (
      e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      (e.key === "+" || e.key === "=" || e.code === "Equal")
    ) {
      e.preventDefault();
      e.stopImmediatePropagation();
      openContextCommand();
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
    // Left arrow at the start of the input, while in a context, temporarily
    // exits it so the next tab opens in the default space.
    if (
      e.key === "ArrowLeft" &&
      contextActive() &&
      !navigating &&
      input &&
      input.selectionStart === 0 &&
      input.selectionEnd === 0
    ) {
      e.preventDefault();
      e.stopImmediatePropagation();
      exitContextTemporarily();
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
      contextActive() &&
      input &&
      input.value === ""
    ) {
      // Empty bar + backspace inside a context temporarily exits it (like ←),
      // so the next tab opens in the default space.
      e.preventDefault();
      exitContextTemporarily();
    }
  }

  function onKeyOther(e) {
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

  function status(msg) {
    if (statusEl) statusEl.textContent = msg || "";
  }

  function openFavorite(i) {
    const url = favorites[i];
    if (!url) {
      status(`Favorite ${i + 1} is empty. Set it with /favorite ${i + 1} <url>`);
      return;
    }
    const groupId = contextGroupIdForDispatch();
    close();
    // Switch to an existing tab with this URL if one is open, else new tab.
    chrome.runtime.sendMessage({ type: MSG.OPEN_FAVORITE, url, groupId });
  }

  function renderFavorites() {
    if (!favRow) return;
    favRow.textContent = "";
    for (let i = 0; i < FAV_COUNT; i++) {
      const url = favorites[i];
      const btn = document.createElement("button");
      btn.className = "fave" + (url ? "" : " empty");
      btn.title = url
        ? `${i + 1}: ${url}`
        : `Empty — set with /favorite ${i + 1} <url>`;

      if (url) {
        const img = document.createElement("img");
        img.src = faviconUrl(url);
        img.alt = "";
        img.addEventListener("error", () => {
          img.remove();
          btn.textContent = String(i + 1);
        });
        btn.appendChild(img);
      } else {
        btn.textContent = String(i + 1);
      }

      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = String(i + 1);
      btn.appendChild(badge);

      btn.addEventListener("click", () => {
        if (url) {
          openFavorite(i);
        } else {
          // Start the /favorite command with this slot number and the current
          // tab's URL prefilled.
          enterCommandMode("favorite", String(i + 1));
          advanceParam(); // commit the slot number, move to the url param
          input.value = location.href;
          updateParamInputWidth();
          input.focus();
          input.select();
        }
      });
      favRow.appendChild(btn);
    }
  }

  // STYLES moved to ./ui/bar.css (imported as text via esbuild).

  function open(opts) {
    if (isOpen) return;
    opts = opts || {};
    isOpen = true;
    opensInCurrentTab = !!opts.opensInCurrentTab;
    defaultUrl = opts.defaultUrl || "";

    host = document.createElement("div");
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = STYLES;

    overlay = document.createElement("div");
    overlay.className = "backdrop";

    stack = document.createElement("div");
    stack.className = "stack";

    const bar = document.createElement("div");
    bar.className = "bar";
    barEl = bar;

    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("class", "icon");
    iconEl = icon;
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("fill", "none");
    icon.setAttribute("stroke", "currentColor");
    icon.setAttribute("stroke-width", "2");
    icon.setAttribute("stroke-linecap", "round");
    icon.setAttribute("stroke-linejoin", "round");
    icon.innerHTML = ICON_SEARCH;
    // Inside a context the icon is a back arrow that temporarily exits to default.
    icon.addEventListener("click", () => {
      if (contextActive()) exitContextTemporarily();
    });

    input = document.createElement("input");
    input.type = "text";
    input.autocapitalize = "off";
    input.autocomplete = "off";
    input.spellcheck = false;

    // Wrap the input so the ghost autocomplete overlay can sit behind it.
    inputWrap = document.createElement("div");
    inputWrap.className = "input-wrap";
    ghostEl = document.createElement("div");
    ghostEl.className = "ghost";
    ghostEl.style.display = "none";
    inputWrap.appendChild(ghostEl);
    inputWrap.appendChild(input);

    pillEl = document.createElement("span");
    pillEl.className = "pill";
    pillEl.style.display = "none";
    pillEl.title = "Click or backspace to remove";
    pillEl.addEventListener("click", () => {
      if (activeShortcut) dismissShortcutPill();
    });

    cmdChipsEl = document.createElement("span");
    cmdChipsEl.className = "cmd-chips";
    cmdChipsEl.style.display = "none";

    const chips = document.createElement("span");
    chips.className = "chips";
    chips.appendChild(pillEl);
    chips.appendChild(cmdChipsEl);

    favRow = document.createElement("div");
    favRow.className = "faves";

    contextsRowEl = document.createElement("div");
    contextsRowEl.className = "contexts-row";
    contextsRowEl.style.display = "none";

    resultsEl = document.createElement("div");
    resultsEl.className = "results";
    resultsEl.style.display = "none";

    statusEl = document.createElement("div");
    statusEl.className = "status";

    bar.appendChild(icon);
    bar.appendChild(chips);
    bar.appendChild(inputWrap);
    stack.appendChild(contextsRowEl);
    stack.appendChild(bar);
    stack.appendChild(favRow);
    stack.appendChild(resultsEl);
    stack.appendChild(statusEl);
    overlay.appendChild(stack);
    shadow.appendChild(style);
    shadow.appendChild(overlay);
    document.documentElement.appendChild(host);

    applyInitialState();
    renderFavorites();
    loadIndex();

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
      // Command param mode: keep the active-param pill sized to its content.
      if (commandState) {
        updateParamInputWidth();
        return;
      }
      const v = input.value;
      typedQuery = v; // remember what the user actually typed
      navigating = false;

      // Enter command param mode when a full/prefix command name is followed by
      // a space (e.g. "/favorite " or "/fav " -> autocompletes to /favorite).
      if (!activeShortcut) {
        const cm = v.match(/^\/(\w+)\s([\s\S]*)$/);
        if (cm) {
          const name = COMMANDS[cm[1]] ? cm[1] : bestCommandByPrefix(cm[1]);
          if (name) {
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
    contextTemporarilyExited = false; // context returns on each fresh open
    typedQuery = defaultUrl || "";
    input.value = defaultUrl || "";
    renderCommandChips();
    renderPill();
    renderContext();
    renderContextsRow();
    if (defaultUrl) input.select(); // highlight the prefilled URL for easy replace
    status(idleStatus());
    refreshResults();
    renderGhost();
  }

  // Sends a resolved URL to the right place: the current tab (cmd+L) or a new
  // tab (cmd+T, added to the active context group when one is set).
  function dispatch(url) {
    const groupId = contextGroupIdForDispatch();
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
      const url = applyShortcut(shortcuts[activeShortcut], input.value);
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
    host = overlay = stack = input = barEl = inputWrap = ghostEl = pillEl = cmdChipsEl = favRow = contextsRowEl = resultsEl = statusEl = null;
  }

  function toggle(opts) {
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