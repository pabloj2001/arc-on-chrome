# Arc Search Bar

A Chrome extension that replicates Arc's floating command/search bar.

## What it does

- **Search** — press the search shortcut (**Cmd+T** / **Ctrl+T** by default) to open a
  floating bar. Type and press **Enter**: URL-shaped input opens in a **new tab** and is
  resolved by the browser, so corporate intranet links work — including ones with a trailing
  query such as `go/glean my search` (opened as `http://go/glean%20my%20search`). Anything
  that isn't URL-shaped (plain words, phrases) is searched on Google instead.
- **Edit URL** — press the URL shortcut (**Cmd+L** / **Ctrl+L** by default) to open the bar
  prefilled with the current tab's URL. It works exactly like the search bar (suggestions,
  commands, autocomplete), except **Enter navigates the current tab** instead of opening a new
  one. (Internally the bar just takes `opensInCurrentTab` / `defaultUrl` options.)
- **Favorites** — save up to 8 favorites and jump to them with **Cmd+1 … Cmd+8** while the
  bar is open, or by clicking the favicon buttons shown under the bar. If the site is already
  open in a tab, it switches to that tab instead of opening a duplicate — matching by host and
  path prefix, so a bare-domain favorite (e.g. `gemini.google.com`) still matches the tab it
  redirected to (`gemini.google.com/app`).
- **Keyword shortcuts** — like custom search engines. Register an alias with a `%s` URL
  template, then type the alias + space to turn it into a **pill** and search through it (see
  below).
- **Slash commands** — type `/` followed by a command to run it (see below).
- **Browse tabs & history** — under the bar, a result list shows your other open tabs. As you
  type, it matches by title/URL across open tabs first, then your last 7 days of history.
  Use **↑/↓** or **Tab / Shift+Tab** to move the selection (which previews the highlighted
  result's URL in the bar), and **Enter** to go — switching to the tab if it's already open,
  otherwise opening the page. The list shows ~4 rows at a time (scroll for the rest, up to 10).
- **Inline URL autocomplete** — as you type a domain you've visited before, the completion
  appears as faded ghost text (`gith` → `ub.com`), preferring root domains over subdomains. The
  matched domain is also shown as the top **Website** result, so **Enter** opens it in a fresh
  tab; press **→ (Right arrow)** to accept the ghost into the text without navigating. Typing a
  complete URL you've never visited still offers it as the top result.
- **Search suggestion** — whenever there's at least one other suggestion, a **Search for "…"**
  row is inserted as the second result, so you can always fall back to a web search.
- **Contexts** — group your work into expiring tab groups with `/context` (see below).

The bar disappears when you press **Escape**, click outside it, or switch tabs/windows.

## Contexts (expiring tab groups)

A **context** is an ephemeral browser tab group that tabs you open get collected into, and that
cleans itself up after a period of inactivity.

- `/context <name> [expiry]` — create a context (max 5): makes a colored tab group named
  `<name>`, moves the current tab into it, and makes it active. While a context is active, tabs
  you open **from the bar** (searches, favorites, suggestions) go into that group. `expiry` is
  `Nh` / `Nd` (e.g. `8h`, `1d`); it defaults to **24h**. Names must be unique.
- `/context` with **no name** resets to the default space (the group itself stays until it
  expires). `/deletecontext <name>` closes a context's group and stops tracking it.
- The group is titled `<name> [<time remaining>]` and the countdown resets whenever you visit a
  tab inside it. When it expires, the group's tabs are closed.

A row above the bar shows the **default space** and each context as numbered chips (colored to
match the tab group), plus a **+** chip to create a new one. Switch with a click or
**Ctrl+1** (default), **Ctrl+2** (first context), … ; **Ctrl++** opens the new-context command.
While a context is active the bar's border, search icon, and a faint background tint take on the
group's color. Press **← (Left arrow)** at the start of the input — or **Backspace** while the
bar is empty — to *temporarily* leave the context so the next tab opens in the default space; it
returns the next time you open the bar. Opening the bar with the **URL shortcut (Cmd+L)** shows
the context of the *current tab* (the group it belongs to, or the default space if it isn't in a
context) instead of the globally-active one, since that command acts on the current tab.

Contexts are tracked in `chrome.storage.local` and survive browser restarts. A background alarm
checks every minute: it closes + untracks expired groups and refreshes the remaining-time in
each title. If a tracked group no longer exists (you closed it, or the browser reset its tabs)
it is **kept** — not untracked — until it expires, so reopening closed tabs can land back in a
live context.

The bar disappears when you press **Escape**, click outside it, or switch tabs/windows.

## Keyword shortcuts (search-engine pills)

Register a shortcut, then type its alias at the start of the bar followed by a **space** — the
alias becomes a pill and whatever you type next is substituted into the template's `%s`:

```
/shortcut go https://go/%s      then typing:  go hello   →  visits https://go/hello
/shortcut yt https://www.youtube.com/results?search_query=%s
```

- Press **space** after a registered alias to arm the pill; type your query and **Enter**.
- While the pill is active, the result list shows your open tabs and history under the
  shortcut's destination (e.g. the `go` pill shows `https://go/*`), narrowing as you type.
- With the pill active and the query empty, press **Backspace** to remove the pill and get the
  plain word back (so you can use the word itself without the shortcut). The next space won't
  re-arm the same alias until you edit that first word.
- Click the pill to remove it.
- Templates without `%s` get the query appended; schemeless templates default to `https://`
  (single-label hosts like `go` use `http://`).

## Commands

Type **`/`** to open the command palette — a list of commands that filters as you type (each
row shows the usage and a description). Pick one with **↑/↓ + Enter** or a click (typing a
command name + space also works, and autocompletes a prefix like `/fav`).

Selecting a command turns it into **pills**: the command name, then one pill per parameter
(all shown up front, upcoming ones faded). The active parameter shows its name as a label —
type its value and press **Tab** to move to the next parameter, **Shift+Tab** (or **←/→**) to
move between them, and **Backspace** on an empty parameter to step back (or back out to the
typed text). **Enter** runs it — the bar stays open, clears, and shows a confirmation; if
required parameters are empty they flash red instead.

| Command | Description |
| --- | --- |
| `/favorite <1-8> <url>` | Save a favorite, e.g. `/favorite 1 github.com` |
| `/unfavorite <1-8>` | Clear a favorite |
| `/shortcut <alias> <url with %s>` | Add a keyword shortcut, e.g. `/shortcut go https://go/%s` |
| `/unshortcut <alias>` | Remove a keyword shortcut |
| `/context [name] [expiry]` | Start an expiring tab-group context (no name resets to default) |
| `/deletecontext <name>` | Close a context's tab group and stop tracking it |
| `/export` | Copy all settings (favorites + shortcuts) to the clipboard as JSON |
| `/import [json]` | Restore settings from the clipboard (or a file) exported via `/export` |

Favorites and shortcuts are stored with `chrome.storage.local`, so they persist across browser
restarts and stay in sync across tabs. The favicon buttons under the bar reflect your saved
favorites; empty slots show their number and can be clicked to start a `/favorite` command.

### Backing up settings

Run **`/export`** to copy all your settings (favorites + keyword shortcuts) to the clipboard as
versioned JSON (if the clipboard is unavailable it downloads a `arc-search-settings.json` file
instead). Contexts are ephemeral and not included. Run **`/import`** to restore them — it reads
the JSON from the clipboard, or falls back to a file picker (you can also paste the JSON directly
after the command). This is the migration path across installs, including the upcoming built
(`dist/`) version, which loads under a fresh extension id.

### Adding new commands

Commands live in a small registry in `src/content/commands/registry.ts`. To add one, add an entry to the
`COMMANDS` object:

```js
const COMMANDS = {
  mycmd: {
    description: "What it does.",
    params: [{ name: "arg" }, { name: "other" }], // each shown as a pill
    run: (args, ctx) => {
      // args: the param values in order
      // ctx: { status, setFavorite, setShortcut, removeShortcut, hasShortcut, exportSettings, importSettings, setContext, clearContext, deleteContext, close, clearInput }
      ctx.status("done");
    },
  },
};
```

## Install (load unpacked)

The extension is compiled from `src/` into `dist/` (the folder Chrome loads):

1. `npm install` then `npm run build` (produces `dist/`).
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top-right).
4. Click **Load unpacked** and select the **`dist/`** folder.

> **Upgrading from an older build?** Loading from `dist/` may give the extension a new
> unpacked id, which resets its stored settings. Run **`/export`** on the old build first,
> then **`/import`** on the new one to carry your favorites + shortcuts across.

## Updating

To pull the latest version and rebuild in one step:

```
npm run update
```

This runs `scripts/update.sh`, which checks out and fast-forwards the default branch
(`main`), installs dependencies (`npm ci` when a lockfile is present, else `npm install`),
and runs `npm run build` to refresh `dist/`. When it finishes, reload the extension:

1. Open `edge://extensions` (or `chrome://extensions`).
2. Click the **reload ↻** icon on **Arc Search Bar**.

(You can also run the script directly: `bash scripts/update.sh`.)

## Shortcuts

Both shortcuts default to **reserved browser shortcuts** (`Cmd+T` = New Tab,
`Cmd+L` = address bar), which Chrome may not let the extension bind automatically. To set
them:

1. Go to `chrome://extensions/shortcuts`.
2. Find **Arc Search Bar** and bind **"Open the Arc-style search bar"** and
   **"Open the bar to edit the current tab's URL"** to your preferred keys.

The extension also listens for the combos directly on the page as a best-effort fallback,
but pages can't override reserved browser shortcuts, so binding them in settings is
recommended.

> **Note on Cmd+1–8:** these are reserved for switching browser tabs. They work for
> favorites while the bar is open in most setups, but if your browser intercepts them,
> just click the favicon buttons instead.

## Tests

Two layers: fast **Vitest** unit tests for the pure `src/shared/` helpers, and an
end-to-end **Playwright** suite that exercises the bar against the real (built) extension:

```
npm install
npx playwright install chromium   # one-time
npm run build                     # compile src/ -> dist/ (what the tests load)
npm run test:unit                 # Vitest: shared url/color helpers
npm test                          # Playwright, headless (no windows)
HEADED=1 npm test                 # watch it drive a visible browser
```

`npm test` builds first (via `pretest`) and loads the unpacked extension from `dist/` into
Chromium's new headless mode (which supports extensions), serving its own pages from a local
HTTP server (no internet dependency). It covers search/URL modes, favorites, keyword shortcuts,
the results list + inline autocomplete, the command palette + param pills, contexts,
keyboard/focus behavior, and `/export` + `/import`. Unit tests live in `tests/unit/`, e2e in
`tests/e2e/`.

## Project layout

The extension is written as modular TypeScript in `src/` and bundled by esbuild
(`build.mjs`) into two files in `dist/` — `content.js` (IIFE, CSS inlined) and
`background.js` (classic service worker) — alongside a copied `manifest.json`.

```
src/
  shared/        # imported by BOTH bundles: url, colors, constants, messages
  background/    # service worker: index (listeners), commands, router,
                 #   index-builder, favorites, contexts (lifecycle + alarms)
  content/       # the bar
    index.ts     #   entry: state + input/keyboard/dispatch + render wrappers
    settings.ts  #   export/import (de)serialization
    search/      #   matching + ranking helpers
    keyboard/    #   key-combo predicates
    commands/    #   the slash-command registry
    ui/          #   mount.ts (DOM refs), bar.css, icons, render-*.ts view modules
```

Build/dev scripts: `npm run build` (minified prod), `npm run dev` (esbuild watch,
source maps), `npm run typecheck` (tsc), `npm run test:unit` (Vitest), `npm test`
(Playwright, builds first). `dist/` is git-ignored; `src/` is the source of truth.
