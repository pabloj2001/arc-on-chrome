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

  let host = null;
  let overlay = null;
  let stack = null;
  let input = null;
  let pillEl = null;
  let favRow = null;
  let statusEl = null;
  let isOpen = false;
  let mode = "search"; // "search" | "url"
  let favorites = new Array(FAV_COUNT).fill(null);
  let shortcuts = {}; // alias -> url template (with %s)
  let activeShortcut = null; // alias currently shown as a pill
  let dismissedAlias = null; // alias the user backspaced out of, to avoid re-arming

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

  // Keep every open tab's copy in sync (e.g. after a /fave in another tab).
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
  // Add a command by adding an entry here. `run(args, ctx)` receives the
  // whitespace-split arguments (after the command name) and a ctx of helpers.
  const COMMANDS = {
    fave: {
      usage: "/fave <1-8> <url>",
      description: "Save a favorite for quick-open (Cmd+1-8).",
      run: (args, ctx) => {
        const idx = parseInt(args[0], 10);
        if (!idx || idx < 1 || idx > FAV_COUNT) {
          return ctx.status(`Usage: ${COMMANDS.fave.usage}`);
        }
        const url = normalizeUrl(args.slice(1).join(" "));
        if (!url) return ctx.status(`Provide a URL, e.g. /fave ${idx} github.com`);
        ctx.setFavorite(idx - 1, url);
        ctx.status(`Saved favorite ${idx} → ${url}`);
      },
    },
    unfave: {
      usage: "/unfave <1-8>",
      description: "Clear a saved favorite.",
      run: (args, ctx) => {
        const idx = parseInt(args[0], 10);
        if (!idx || idx < 1 || idx > FAV_COUNT) {
          return ctx.status(`Usage: ${COMMANDS.unfave.usage}`);
        }
        ctx.setFavorite(idx - 1, null);
        ctx.status(`Cleared favorite ${idx}`);
      },
    },
    shortcut: {
      usage: "/shortcut <alias> <url with %s>",
      description: "Add a keyword search, e.g. /shortcut go https://go/%s",
      run: (args, ctx) => {
        const alias = (args[0] || "").trim().toLowerCase();
        const url = args.slice(1).join(" ").trim();
        if (!alias || /\s/.test(alias)) {
          return ctx.status(`Usage: ${COMMANDS.shortcut.usage}`);
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
      usage: "/unshortcut <alias>",
      description: "Remove a keyword search.",
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

  function showCommandHints(value) {
    const rest = value.slice(1).split(/\s+/)[0].toLowerCase();
    const names = Object.keys(COMMANDS).filter((n) => n.startsWith(rest));
    if (!names.length) return status("No matching command");
    status(names.map((n) => `${COMMANDS[n].usage} — ${COMMANDS[n].description}`).join("\n"));
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
      input.placeholder =
        mode === "url" ? "Edit URL or search…" : "Search or enter address…";
    }
  }

  // Turn "<alias> <rest>" into a pill + query field.
  function activateShortcut(alias, rest) {
    activeShortcut = alias;
    dismissedAlias = null;
    input.value = rest || "";
    renderPill();
    const n = input.value.length;
    input.setSelectionRange(n, n);
    status("");
  }

  // Remove the pill and restore the plain alias word so it can be used literally.
  // `dismissedAlias` prevents the next space from immediately re-arming the pill.
  function dismissShortcutPill() {
    const alias = activeShortcut;
    activeShortcut = null;
    dismissedAlias = alias;
    renderPill();
    input.value = alias;
    const n = input.value.length;
    input.setSelectionRange(n, n);
    input.focus();
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
      toggle("search");
      return;
    }
    if (isUrlCombo(e)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      toggle("url");
      return;
    }
    if (!isOpen) return; // when closed, let the page handle its own keys

    // Cmd/Ctrl + 1-8 opens the matching favorite.
    if ((e.metaKey || e.ctrlKey) && !e.altKey && /^[1-8]$/.test(e.key)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      openFavorite(parseInt(e.key, 10) - 1);
      return;
    }

    e.stopImmediatePropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Enter") {
      e.preventDefault();
      submit();
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

  // Closing on input blur is what lets us coexist with extensions like Vimium,
  // whose insert-mode Escape blurs the input before our keydown listener runs.
  function onFocusOut() {
    if (isOpen) close();
  }

  // ---- UI --------------------------------------------------------------------

  function status(msg) {
    if (statusEl) statusEl.textContent = msg || "";
  }

  function openFavorite(i) {
    const url = favorites[i];
    if (!url) {
      status(`Favorite ${i + 1} is empty. Set it with /fave ${i + 1} <url>`);
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
        : `Empty — set with /fave ${i + 1} <url>`;

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
          input.value = `/fave ${i + 1} `;
          input.focus();
          showCommandHints(input.value);
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
      margin-top: 16vh; width: min(680px, 90vw);
      display: flex; flex-direction: column; align-items: stretch; gap: 12px;
      animation: arc-pop 140ms cubic-bezier(0.2, 0.9, 0.3, 1.2);
    }
    .bar {
      background: rgba(250, 250, 252, 0.98); border-radius: 16px;
      box-shadow: 0 24px 64px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.06);
      padding: 14px 18px; display: flex; align-items: center; gap: 12px;
    }
    .icon { width: 20px; height: 20px; flex: 0 0 auto; opacity: 0.5; }
    .pill {
      flex: 0 0 auto; display: none; align-items: center;
      height: 28px; padding: 0 12px; border-radius: 9px;
      background: #4b6cff; color: #fff; cursor: pointer;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 16px; font-weight: 600; line-height: 28px; white-space: nowrap;
    }
    input {
      all: unset; flex: 1 1 auto;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 20px; line-height: 28px; color: #1c1c1e; caret-color: #4b6cff;
    }
    input::placeholder { color: #9a9aa2; }
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
    .status {
      min-height: 16px; text-align: center; white-space: pre-line;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px; line-height: 16px; color: #e8e8ea;
      text-shadow: 0 1px 3px rgba(0,0,0,0.5);
    }
    @keyframes arc-fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes arc-pop {
      from { opacity: 0; transform: translateY(-8px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @media (prefers-color-scheme: dark) {
      .bar { background: rgba(30, 30, 33, 0.98); }
      input { color: #f2f2f7; }
      input::placeholder { color: #8a8a90; }
      .fave { background: rgba(44, 44, 48, 0.98); color: #c7c7cc; }
      .fave.empty { background: rgba(60,60,64,0.6); }
    }
  `;

  function open(m) {
    if (isOpen) return;
    isOpen = true;
    mode = m || "search";

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

    pillEl = document.createElement("span");
    pillEl.className = "pill";
    pillEl.style.display = "none";
    pillEl.title = "Click or backspace to remove";
    pillEl.addEventListener("click", () => {
      if (activeShortcut) dismissShortcutPill();
    });

    favRow = document.createElement("div");
    favRow.className = "faves";

    statusEl = document.createElement("div");
    statusEl.className = "status";

    bar.appendChild(icon);
    bar.appendChild(pillEl);
    bar.appendChild(input);
    stack.appendChild(bar);
    stack.appendChild(favRow);
    stack.appendChild(statusEl);
    overlay.appendChild(stack);
    shadow.appendChild(style);
    shadow.appendChild(overlay);
    document.documentElement.appendChild(host);

    applyMode();
    renderFavorites();

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
      const v = input.value;
      // Arm a shortcut pill when the first typed token is a registered alias
      // followed by a space (matching custom-search-engine behavior).
      if (!activeShortcut) {
        const firstTok = v.split(/\s/)[0];
        if (dismissedAlias && firstTok !== dismissedAlias) dismissedAlias = null;
        const m = v.match(/^(\S+)\s([\s\S]*)$/);
        if (m && shortcuts[m[1]] && m[1] !== dismissedAlias) {
          activateShortcut(m[1], m[2]);
          return;
        }
      }
      if (!activeShortcut && v.startsWith("/")) showCommandHints(v);
      else status("");
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

  function applyMode() {
    activeShortcut = null;
    dismissedAlias = null;
    if (mode === "url") {
      input.value = location.href;
      renderPill();
      input.select();
    } else {
      input.value = "";
      renderPill();
    }
    status("");
  }

  // Sends a resolved URL to the right place based on the current mode.
  function dispatch(url) {
    close();
    if (mode === "url") {
      location.assign(url); // navigate the current tab
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
    dismissedAlias = null;
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = overlay = stack = input = pillEl = favRow = statusEl = null;
  }

  function toggle(m) {
    const next = m || "search";
    if (isOpen) {
      if (next !== mode) {
        mode = next;
        applyMode();
        input.focus();
      } else {
        close();
      }
    } else {
      open(next);
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === "TOGGLE_ARC_SEARCH") toggle(message.mode);
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
