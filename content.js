(() => {
  // Only run in the top frame — avoids duplicate bars inside iframes and keeps
  // URL navigation targeting the real tab.
  if (window.top !== window) return;
  if (window.__arcSearchInjected) return;
  window.__arcSearchInjected = true;

  const HOST_ID = "arc-search-bar-host";
  const FAV_COUNT = 8;
  const STORAGE_KEY = "arcFavorites";
  const SHORTCUTS_KEY = "arcShortcuts";
  const MAX_RESULTS = 10;

  let host = null;
  let overlay = null;
  let stack = null;
  let input = null;
  let barEl = null;
  let inputWrap = null;
  let ghostEl = null;
  let pillEl = null;
  let cmdChipsEl = null;
  let favRow = null;
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

  // ---- Favorites / shortcuts persistence -------------------------------------

  function normalizeFavArray(arr) {
    const out = new Array(FAV_COUNT).fill(null);
    for (let i = 0; i < FAV_COUNT; i++) out[i] = (arr && arr[i]) || null;
    return out;
  }

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

  // ---- URL helpers -----------------------------------------------------------

  const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
  // Intranet-style path, e.g. "go/glean" or "wiki/Main_Page" (single label + /).
  const INTRANET_PATH = /^[a-z0-9-]+\/\S*/i;

  // True when the whole (single-token) string is a URL/host on its own.
  function looksLikeNavigable(q) {
    const s = q.trim();
    if (!s || /\s/.test(s)) return false; // spaces handled separately below
    if (HAS_SCHEME.test(s)) return true;
    if (/^localhost(:\d+)?([/?#]|$)/i.test(s)) return true;
    if (/^\d{1,3}(\.\d{1,3}){3}([:/?#]|$)/.test(s)) return true; // IPv4
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#]|$)/i.test(s)) return true; // dotted domain
    if (/^[a-z0-9-]+:\d+([/?#]|$)/i.test(s)) return true; // host:port
    if (INTRANET_PATH.test(s)) return true; // go/foo
    return false;
  }

  function schemeFor(s) {
    const host = s.split(/[/?#\s]/)[0].split(":")[0];
    return host.includes(".") ? "https" : "http";
  }

  // Builds a fully-encoded URL from raw input. Single-label hosts (go, localhost)
  // use http:// so corporate redirectors resolve; dotted/public hosts use https.
  // The URL constructor encodes spaces and other unsafe characters, so queries
  // like "go/glean my search" become http://go/glean%20my%20search.
  function normalizeUrl(u) {
    const s = (u || "").trim();
    if (!s) return null;
    const full = HAS_SCHEME.test(s) ? s : `${schemeFor(s)}://${s}`;
    try {
      return new URL(full).href;
    } catch (_) {
      return null;
    }
  }

  // Resolves user input to a URL that opens in a tab. If the input is (or starts
  // with) a navigable host/path — including intranet links with a trailing query
  // like "go/glean cats" — the whole thing is handed to the browser as a URL;
  // otherwise it becomes a search.
  function buildUrl(query) {
    const q = query.trim();
    if (!q) return null;
    if (looksLikeNavigable(q)) return normalizeUrl(q);
    const first = q.split(/\s+/)[0];
    if (HAS_SCHEME.test(first) || INTRANET_PATH.test(first)) {
      return normalizeUrl(q);
    }
    return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  }

  function faviconUrl(pageUrl) {
    return chrome.runtime.getURL(
      `_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=64`
    );
  }

  function ensureScheme(u) {
    return HAS_SCHEME.test(u) ? u : `${schemeFor(u)}://${u}`;
  }

  // Substitutes the query into a shortcut template. `%s` is replaced with the
  // URL-encoded query; templates without `%s` get the query appended.
  function applyShortcut(template, query) {
    const q = (query || "").trim();
    const enc = encodeURIComponent(q);
    const url = template.includes("%s")
      ? template.replace(/%s/g, enc)
      : template + enc;
    return ensureScheme(url);
  }

  // ---- Command system --------------------------------------------------------
  // Add a command by adding an entry here: `name`, `description`, a `params`
  // list (each shown as a pill), and `run(args, ctx)` where args are the param
  // values in order. `usage` is derived from name + params.
  const COMMANDS = {
    favorite: {
      description: "Save a favorite for quick-open (Cmd+1-8).",
      params: [{ name: "1-8" }, { name: "url" }],
      run: (args, ctx) => {
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
      run: (args, ctx) => {
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
      run: (args, ctx) => {
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
      run: (args, ctx) => {
        const alias = (args[0] || "").trim().toLowerCase();
        if (!alias || !shortcuts[alias]) {
          return ctx.status(`No shortcut "${alias}"`);
        }
        ctx.removeShortcut(alias);
        ctx.status(`Removed shortcut "${alias}"`);
      },
    },
  };

  function usageOf(name) {
    const cmd = COMMANDS[name];
    const params = (cmd.params || []).map((p) => `<${p.name}>`).join(" ");
    return `/${name}${params ? " " + params : ""}`;
  }

  function bestCommandByPrefix(prefix) {
    const p = prefix.toLowerCase();
    const cands = Object.keys(COMMANDS).filter((n) => n !== p && n.startsWith(p));
    if (!cands.length) return null;
    cands.sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
    return cands[0];
  }

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
    commandState.params.forEach((_, i) => {
      const v = commandState.values[i];
      if (!v || !v.trim()) missing.push(i);
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

  // Query params that only affect tracking/analytics and shouldn't make two
  // otherwise-identical URLs count as different pages.
  const TRACKING_PARAM = /^(utm_|fbclid$|gclid$|gclsrc$|dclid$|msclkid$|mc_eid$|mc_cid$|igshid$|ref$|ref_src$|ref_url$|spm$|yclid$|_hsenc$|_hsmi$|_openstat$|si$)/i;

  // Canonical key for de-duplication: host without "www.", path without a
  // trailing slash, and the query with tracking params dropped and the rest
  // sorted so param order doesn't matter. Scheme and hash are ignored.
  function canon(u) {
    try {
      const x = new URL(u);
      const kept = [];
      for (const [k, v] of new URLSearchParams(x.search)) {
        if (!TRACKING_PARAM.test(k)) kept.push([k, v]);
      }
      kept.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      const qs = kept.length
        ? "?" + kept.map(([k, v]) => `${k}=${v}`).join("&")
        : "";
      return (
        x.host.replace(/^www\./i, "") +
        x.pathname.replace(/\/+$/, "") +
        qs
      ).toLowerCase();
    } catch (_) {
      return (u || "").toLowerCase();
    }
  }

  function matchesQuery(item, tokens) {
    const hay = `${item.title || ""} ${item.url || ""}`.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  }

  function hostPath(u) {
    try {
      const x = new URL(u);
      return {
        host: x.host.replace(/^www\./i, "").toLowerCase(),
        path: x.pathname.replace(/\/+$/, ""),
      };
    } catch (_) {
      return null;
    }
  }

  // The host/path an active shortcut's template resolves to (the part before %s),
  // used to filter results to that destination (e.g. "https://go/%s" -> go, "").
  function templateBase(template) {
    let prefix = (template || "").split("%s")[0];
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(prefix)) prefix = "https://" + prefix;
    return hostPath(prefix);
  }

  // True if a URL lives under a shortcut's base host + path prefix.
  function underBase(u, base) {
    const hp = hostPath(u);
    if (!hp || hp.host !== base.host) return false;
    if (base.path === "") return true;
    return hp.path === base.path || hp.path.startsWith(base.path + "/");
  }

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

    // A matched base domain is always the top result, so Enter navigates there.
    if (!base) {
      const domHost = bestDomainMatch(raw);
      if (domHost) {
        const url = "https://" + domHost;
        out.push({ type: "domain", title: domHost, url });
        seen.add(canon(url));
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
      if (out.length >= MAX_RESULTS) return out;
    }

    // Include history when there's a query, or a shortcut base to browse under.
    if (tokens.length || base) {
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

      if (r.type === "command") {
        const ic = document.createElement("div");
        ic.className = "result-ic";
        ic.textContent = "/";
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
      title.textContent = r.type === "command" ? r.title : r.title || r.url;
      const url = document.createElement("div");
      url.className = "url";
      url.textContent = r.type === "command" ? r.subtitle : r.url;
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
    if (r && r.url) {
      navigating = true;
      input.value = r.url;
      const n = input.value.length;
      input.setSelectionRange(n, n);
      ghostSuffix = "";
      if (ghostEl) ghostEl.style.display = "none";
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
        type: "ARC_ACTIVATE_TAB",
        tabId: r.tabId,
        windowId: r.windowId,
      });
    } else if (r.type === "domain") {
      // A typed base domain always opens fresh (new tab, or current tab for
      // cmd+L) — never switch to an existing tab under that domain.
      if (opensInCurrentTab) location.assign(r.url);
      else chrome.runtime.sendMessage({ type: "ARC_SEARCH_SUBMIT", url: r.url });
    } else if (opensInCurrentTab) {
      location.assign(r.url); // cmd+L: replace the current page
    } else {
      chrome.runtime.sendMessage({ type: "ARC_OPEN_FAVORITE", url: r.url });
    }
  }

  function loadIndex() {
    chrome.runtime.sendMessage({ type: "ARC_GET_INDEX" }, (res) => {
      if (chrome.runtime.lastError || !res) return;
      openTabs = res.tabs || [];
      historyItems = res.history || [];
      currentTabId = res.currentTabId != null ? res.currentTabId : null;
      buildDomainScores();
      if (isOpen) {
        refreshResults();
        renderGhost();
      }
    });
  }

  // ---- Inline URL autocomplete (ghost text) ----------------------------------

  function hostOf(u) {
    try {
      return new URL(u).host.replace(/^www\./i, "").toLowerCase();
    } catch (_) {
      return null;
    }
  }

  // Score each visited host so autocomplete prefers open tabs, then frequently
  // visited history.
  function buildDomainScores() {
    const scores = new Map();
    for (const t of openTabs) {
      const h = hostOf(t.url);
      if (h) scores.set(h, (scores.get(h) || 0) + 1000);
    }
    for (const it of historyItems) {
      const h = hostOf(it.url);
      if (h) scores.set(h, (scores.get(h) || 0) + (it.visitCount || 1));
    }
    domainScores = scores;
  }

  // Returns the best visited base domain (host) whose name the typed value is a
  // prefix of, or null. Domain-level only (no spaces/paths/commands/shortcuts).
  function bestDomainMatch(value) {
    if (!value || commandState || activeShortcut) return null;
    if (/\s/.test(value) || value.startsWith("/")) return null;
    const typed = value.replace(/^https?:\/\//i, "");
    if (typed.includes("/")) return null;
    const typedHost = typed.replace(/^www\./i, "").toLowerCase();
    if (!typedHost) return null;
    let best = null;
    let bestScore = -1;
    for (const [host, score] of domainScores) {
      if (host.length < typedHost.length || !host.startsWith(typedHost)) continue;
      if (
        score > bestScore ||
        (score === bestScore && (best === null || host.length < best.length))
      ) {
        best = host;
        bestScore = score;
      }
    }
    return best;
  }

  // The completion suffix shown as ghost text (e.g. "gith" -> "ub.com"), or "".
  function computeCompletion(value) {
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

  function isToggleCombo(e) {
    return (
      (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey &&
      e.key.toLowerCase() === "t"
    );
  }

  function isUrlCombo(e) {
    return (
      (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey &&
      e.key.toLowerCase() === "l"
    );
  }

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

    // Command param mode: Space/Tab advance, Shift+Tab back, Enter runs.
    if (commandState) {
      if (e.key === "Tab" && e.shiftKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (commandState.index > 0) gotoPrevParam();
        else close(); // Shift+Tab out of the first param closes
        return;
      }
      if (e.key === "Tab" || e.key === " ") {
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

    // Cmd/Ctrl + 1-8 opens the matching favorite.
    if ((e.metaKey || e.ctrlKey) && !e.altKey && /^[1-8]$/.test(e.key)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      openFavorite(parseInt(e.key, 10) - 1);
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
    // Tab moves to the next suggestion, Shift+Tab to the previous.
    if (e.key === "Tab") {
      e.preventDefault();
      e.stopImmediatePropagation();
      moveSelection(e.shiftKey ? -1 : 1);
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
    close();
    // Switch to an existing tab with this URL if one is open, else new tab.
    chrome.runtime.sendMessage({ type: "ARC_OPEN_FAVORITE", url });
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

  const STYLES = `
    :host { all: initial; }
    .backdrop {
      position: fixed; inset: 0; z-index: 2147483647;
      display: flex; align-items: flex-start; justify-content: center;
      background: rgba(0, 0, 0, 0.28); backdrop-filter: blur(2px);
      animation: arc-fade 120ms ease-out;
    }
    .stack {
      margin-top: 22vh; width: min(680px, 90vw);
      display: flex; flex-direction: column; align-items: stretch; gap: 12px;
      animation: arc-pop 140ms cubic-bezier(0.2, 0.9, 0.3, 1.2);
    }
    .bar {
      background: rgba(250, 250, 252, 0.98); border-radius: 16px;
      box-shadow: 0 24px 64px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.06);
      padding: 14px 18px; display: flex; align-items: center; gap: 12px;
      overflow: hidden;
    }
    .icon { width: 20px; height: 20px; flex: 0 0 auto; opacity: 0.5; }
    .pill {
      flex: 0 0 auto; display: none; align-items: center;
      height: 28px; padding: 0 12px; border-radius: 9px;
      background: #4b6cff; color: #fff; cursor: pointer;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 16px; font-weight: 600; line-height: 28px; white-space: nowrap;
    }
    .chips { display: inline-flex; align-items: center; gap: 8px; flex: 0 0 auto; }
    .cmd-chips { display: none; align-items: center; gap: 8px; }
    .cmd-pill {
      display: inline-flex; align-items: center; height: 28px; padding: 0 12px;
      border-radius: 9px; background: #6b4bff; color: #fff; white-space: nowrap;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 16px; font-weight: 600; line-height: 28px;
    }
    .param-pill {
      display: inline-flex; align-items: center; gap: 6px; height: 28px;
      padding: 0 10px; border-radius: 9px; background: rgba(107,75,255,0.14);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 15px; line-height: 28px; white-space: nowrap; min-width: 0;
    }
    .param-pill .plabel { color: #9a86ff; font-size: 12px; flex: 0 0 auto; }
    .param-pill .pval {
      color: #1c1c1e; font-weight: 600;
      max-width: 34ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .param-pill.upcoming { background: rgba(107,75,255,0.07); cursor: pointer; }
    .param-pill.upcoming .plabel { color: #b3b3ba; }
    .param-pill.filled { cursor: pointer; }
    .param-pill.active { box-shadow: inset 0 0 0 1.5px rgba(107,75,255,0.55); }
    .param-pill.invalid {
      background: rgba(255,64,64,0.14) !important;
      box-shadow: inset 0 0 0 1.5px rgba(255,64,64,0.85) !important;
      animation: arc-shake 0.35s ease;
    }
    .param-pill.invalid .plabel { color: #ff5a5a !important; }
    input.param-active {
      flex: 0 0 auto; min-width: 1ch; padding: 0; background: transparent;
      font-size: 15px; line-height: 28px; font-weight: 600; color: #1c1c1e;
    }
    input {
      all: unset; flex: 1 1 auto;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 20px; line-height: 28px; color: #1c1c1e; caret-color: #4b6cff;
    }
    input::placeholder { color: #9a9aa2; }
    .input-wrap { position: relative; flex: 1 1 auto; display: flex; min-width: 0; }
    .input-wrap input { flex: 1 1 auto; position: relative; z-index: 1; }
    .ghost {
      position: absolute; inset: 0; z-index: 0; pointer-events: none;
      display: none; align-items: center; white-space: pre; overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 20px; line-height: 28px;
    }
    .ghost .g-typed { color: transparent; }
    .ghost .g-suffix { color: #b9b9c0; }
    .result-ic {
      width: 20px; height: 20px; flex: 0 0 auto; border-radius: 5px;
      display: flex; align-items: center; justify-content: center;
      background: rgba(107,75,255,0.16); color: #6b4bff; font-weight: 700; font-size: 14px;
    }
    .faves { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
    .fave {
      all: unset; box-sizing: border-box; position: relative;
      width: 46px; height: 46px; border-radius: 12px; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      background: rgba(250, 250, 252, 0.95);
      box-shadow: 0 6px 18px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.06);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 15px; font-weight: 600; color: #8a8a90;
      transition: transform 90ms ease, box-shadow 90ms ease;
    }
    .fave:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(0,0,0,0.28), 0 0 0 1px rgba(0,0,0,0.08); }
    .fave.empty { background: rgba(255,255,255,0.55); box-shadow: 0 0 0 1px rgba(0,0,0,0.08); }
    .fave img { width: 24px; height: 24px; border-radius: 5px; display: block; }
    .fave .badge {
      position: absolute; bottom: -6px; right: -6px;
      min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px;
      background: #4b6cff; color: #fff; font-size: 10px; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    }
    .fave.empty .badge { display: none; }
    .results {
      background: rgba(250, 250, 252, 0.98); border-radius: 14px;
      box-shadow: 0 24px 64px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.06);
      padding: 6px; max-height: 248px; overflow-y: auto;
    }
    .result {
      display: flex; align-items: center; gap: 12px;
      padding: 9px 12px; border-radius: 10px; cursor: pointer;
    }
    .result.active { background: rgba(75, 108, 255, 0.16); }
    .result img { width: 20px; height: 20px; border-radius: 5px; flex: 0 0 auto; }
    .result .meta { display: flex; flex-direction: column; min-width: 0; flex: 1 1 auto; }
    .result .title {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 15px; line-height: 19px; color: #1c1c1e;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .result .url {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 12px; line-height: 15px; color: #8a8a90;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .result .tag {
      flex: 0 0 auto; margin-left: 8px; padding: 2px 8px; border-radius: 6px;
      background: rgba(0,0,0,0.06); color: #6a6a70; font-size: 11px; font-weight: 600;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .status {
      min-height: 16px; text-align: center; white-space: pre-line;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px; line-height: 16px; color: #e8e8ea;
      text-shadow: 0 1px 3px rgba(0,0,0,0.5);
    }
    @keyframes arc-fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes arc-shake {
      0%, 100% { transform: translateX(0); }
      25% { transform: translateX(-3px); }
      75% { transform: translateX(3px); }
    }
    @keyframes arc-pop {
      from { opacity: 0; transform: translateY(-8px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @media (prefers-color-scheme: dark) {
      .bar { background: rgba(30, 30, 33, 0.98); }
      input { color: #f2f2f7; }
      input::placeholder { color: #8a8a90; }
      .ghost .g-suffix { color: #6a6a72; }
      .fave { background: rgba(44, 44, 48, 0.98); color: #c7c7cc; }
      .fave.empty { background: rgba(60,60,64,0.6); }
      .results { background: rgba(30, 30, 33, 0.98); }
      .result.active { background: rgba(75, 108, 255, 0.28); }
      .result .title { color: #f2f2f7; }
      .result .url { color: #9a9aa2; }
      .result .tag { background: rgba(255,255,255,0.1); color: #c7c7cc; }
      .param-pill .pval { color: #f2f2f7; }
      .param-pill { background: rgba(107,75,255,0.28); }
      input.param-active { color: #f2f2f7; }
      .result-ic { background: rgba(107,75,255,0.30); color: #b9a8ff; }
    }
  `;

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
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("fill", "none");
    icon.setAttribute("stroke", "currentColor");
    icon.setAttribute("stroke-width", "2");
    icon.setAttribute("stroke-linecap", "round");
    icon.innerHTML =
      '<circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>';

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

    resultsEl = document.createElement("div");
    resultsEl.className = "results";
    resultsEl.style.display = "none";

    statusEl = document.createElement("div");
    statusEl.className = "status";

    bar.appendChild(icon);
    bar.appendChild(chips);
    bar.appendChild(inputWrap);
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
    typedQuery = defaultUrl || "";
    input.value = defaultUrl || "";
    renderCommandChips();
    renderPill();
    if (defaultUrl) input.select(); // highlight the prefilled URL for easy replace
    status("");
    refreshResults();
    renderGhost();
  }

  // Sends a resolved URL to the right place: the current tab (cmd+L) or a new
  // tab (cmd+T).
  function dispatch(url) {
    close();
    if (opensInCurrentTab) {
      location.assign(url);
    } else {
      chrome.runtime.sendMessage({ type: "ARC_SEARCH_SUBMIT", url });
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
    host = overlay = stack = input = barEl = inputWrap = ghostEl = pillEl = cmdChipsEl = favRow = resultsEl = statusEl = null;
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
    if (message && message.type === "TOGGLE_ARC_SEARCH") {
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
