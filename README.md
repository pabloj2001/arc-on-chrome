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
  redirected to (`gemini.google.com/app`). With **pin-favorites** on (the default), favorites are
  also **mirrored as pinned tabs**: each set favorite is kept open as a pinned tab in favorite-slot
  order, and the pinned strip is reconciled to match your favorites whenever you add, reorder, or
  remove one — a removed favorite's tab (and any other non-favorite pinned tab) is **closed**, not
  left behind. Pinned favorite tabs are never auto-expired. Turn `pin-favorites` off (in Settings)
  to leave pins alone entirely — then opening a favorite just opens it as a new tab.
- **Keyword shortcuts** — like custom search engines. Register an alias with a `%s` URL
  template, then type the alias + space to turn it into a **pill** and search through it (see
  below).
- **Slash commands** — type `/` followed by a command to run it (see below).
- **Browse tabs & history** — under the bar, a result list shows your other open tabs. As you
  type, it matches by title/URL across open tabs first, then your last 14 days of history.
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
- **Groups** — organize your work into Chrome tab groups with `/group` (see below).

The bar disappears when you press **Escape**, click outside it, or switch tabs/windows.

## Groups (Chrome tab groups)

The bar's group switcher mirrors the **Chrome tab groups** you have open — including ones you
create yourself from the browser UI. One group can be **active**, which is where tabs you open
**from the bar** (searches, favorites, suggestions) get collected.

- `/group <name>` — makes a colored tab group named `<name>`, moves the current tab into it,
  and makes it active. While a group is active, tabs you open from the bar go into that group.
- `/group` with **no name** returns to the default space (ungrouped). `/deletegroup <name>`
  closes that group's tabs (Chrome removes the now-empty group).

A row above the bar shows the **default space** and each open group as numbered chips (colored to
match the tab group), plus a **+** chip to create a new one. Switch with a click or
**Ctrl+1** (default), **Ctrl+2** (first group), … ; **Ctrl++** opens the new-group command.
While a group is active the bar's border, search icon, and a faint background tint take on the
group's color. Press **← (Left arrow)** at the start of the input — or **Backspace** while the
bar is empty — to *temporarily* leave the group so the next tab opens in the default space; it
returns the next time you open the bar. **Opening the bar always adopts the group of the tab
you're currently viewing** — if that tab is in a group, that group becomes active (so tabs you
open from the bar join it); if it's ungrouped, the bar opens in the default space. This applies to
the URL shortcut (**Cmd+L**) too, since every open follows the current tab rather than a
separately-remembered "active" group.

### External links join the group you're viewing

When you open a link from **another application** (Slack, Mail, a PDF…) the OS hands it to the
browser, which normally drops it in a fresh tab at the end, outside every group. Instead, the
extension moves that tab into the group of **the tab you were viewing when the browser came
forward** — so a link opened while you're working in a group lands in that group. If the tab you
were on is **ungrouped**, the link stays in the default space (ungrouped) too.

Only genuine external opens are moved. The trick is *window focus*: opening a link from another
app makes the browser regain focus from the OS first, whereas **Cmd/Ctrl+T** (new tab) and
**Cmd/Ctrl+Shift+T** (reopen closed tab) happen while the browser is already focused — those, plus
tabs you open from the bar and links clicked **within a page** (they keep their source tab's
group, or stay ungrouped), are left exactly where they are.

### Tab expiry

Groups don't expire — **individual tabs** do, on inactivity, and Chrome removes a group once its
last tab is gone. A background alarm checks every minute:

- a tab **not in a group** is closed after **2 hours** of inactivity (configurable);
- a tab **in a group** is closed after **24 hours** of inactivity (configurable);
- a group whose tabs have all expired disappears automatically.

The currently-active tab, pinned tabs, and the sole tab in a window are never auto-closed.
"Inactivity" is measured from when a tab was last focused. Both windows are adjustable in
**Settings** (see below).

By default idle time only accrues during **working hours** (9:00–18:00, weekends excluded) so a
tab doesn't age overnight or on weekends. Adjust `work-start` / `work-end` (e.g. `9:00`–`17:00`)
to change the window, toggle `include-weekends` on to count Saturdays and Sundays, or set
`work-start` equal to `work-end` to count all hours around the clock.

The bar disappears when you press **Escape**, click outside it, or switch tabs/windows.

## Settings

Run **`/settings`** to open the settings modal, or set one directly without it via
**`/settings <name> <value>`**. Typing `/settings` and choosing it shows **value suggestions** —
each adjustable setting (with its description) plus an **"Open settings…"** option that launches
the modal. Durations accept `m` / `h` / `d` (e.g. `30m`, `24h`, `2d`); a bare number means minutes.

The modal has a left sidebar with two sections:

- **General** — one field per setting; **Save** (or **Enter**) validates and persists, **Cancel**
  / **Escape** / click-outside discards.
- **Shortcuts** — lists every keyword shortcut with a **×** to remove it, plus an inline
  *alias + URL* form to add a new one. Adds/removes apply immediately.

| Setting | `<name>` | Default | What it controls |
| --- | --- | --- | --- |
| Grouped tab expiry | `group-expiry` | `24h` | Inactivity before a tab **in a group** is closed |
| Default tab expiry | `default-expiry` | `2h` | Inactivity before an **ungrouped** tab is closed |
| Working hours start | `work-start` | `09:00` | Idle time only accrues after this time (`==` end disables) |
| Working hours end | `work-end` | `18:00` | Idle time only accrues before this time (`==` start disables) |
| Count weekends | `include-weekends` | `off` | Whether Sat/Sun count toward tab expiry |
| Pin favorites | `pin-favorites` | `on` | Keep each favorite open as a pinned tab (off: favorites don't touch pins and open as a new tab) |

Examples: `/settings group-expiry 12h`, `/settings default-expiry 90m`, `/settings work-start 9:00`,
`/settings work-end 5pm`, `/settings include-weekends off`. Times accept 24h (`17:00`) or am/pm
(`5pm`); toggles accept `on`/`off`. Settings are stored in `chrome.storage.local` and read by the
background expiry check on its next tick.

### Command argument suggestions

Several commands suggest their argument values once selected: **`/settings`** lists the settings
(and the open-modal option), **`/unshortcut`** lists your existing aliases, **`/deletegroup`**
lists your open groups, and **`/unfavorite`** lists your set favorites. Suggestions filter as you
type; **↑/↓** highlight, **Enter**/**Tab**/click chooses (running the command or filling the next
param).

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
| `/group [name]` | Create a Chrome tab group from the current tab (no name returns to default) |
| `/deletegroup <name>` | Close a group's tabs (Chrome removes the empty group) |
| `/export` | Copy all settings (favorites + shortcuts) to the clipboard as JSON |
| `/import [json]` | Restore settings from the clipboard (or a file) exported via `/export` |
| `/settings [name] [value]` | Open the settings modal, or set one directly (e.g. `/settings group-expiry 12h`) |
| `/reload` | Reload the extension (applies a freshly built `dist/`) |

Favorites and shortcuts are stored with `chrome.storage.local`, so they persist across browser
restarts and stay in sync across tabs. The favicon buttons under the bar reflect your saved
favorites; empty slots show their number and can be clicked to start a `/favorite` command.

### Backing up settings

Run **`/export`** to copy all your settings (favorites + keyword shortcuts) to the clipboard as
versioned JSON (if the clipboard is unavailable it downloads a `arc-search-settings.json` file
instead). Groups are ephemeral and not included. Run **`/import`** to restore them — it reads
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
      // ctx: { status, setFavorite, setShortcut, removeShortcut, hasShortcut, exportSettings, importSettings, setGroup, clearGroup, deleteGroup, openSettings, setSetting, close, clearInput }
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
the results list + inline autocomplete, the command palette + param pills, groups,
keyboard/focus behavior, and `/export` + `/import`. Unit tests live in `tests/unit/`, e2e in
`tests/e2e/`.

## Project layout

The extension is written as modular TypeScript in `src/` and bundled by esbuild
(`build.mjs`) into two files in `dist/` — `content.js` (IIFE, CSS inlined) and
`background.js` (classic service worker) — alongside a copied `manifest.json`.

```
src/
  shared/        # imported by BOTH bundles: url, colors, constants, messages,
                 #   settings (durable config: tab-expiry durations)
  background/    # service worker: index (listeners), commands, router,
                 #   index-builder, favorites, groups (tab-group mirror + tab expiry)
  content/       # the bar
    index.ts     #   entry: state + input/keyboard/dispatch + render wrappers
    settings.ts  #   export/import (de)serialization
    search/      #   matching + ranking helpers
    keyboard/    #   key-combo predicates
    commands/    #   the slash-command registry
    ui/          #   mount.ts (DOM refs), bar.css, icons, settings-modal, render-*.ts view modules
```

Build/dev scripts: `npm run build` (minified prod), `npm run dev` (esbuild watch,
source maps), `npm run typecheck` (tsc), `npm run test:unit` (Vitest), `npm test`
(Playwright, builds first). `dist/` is git-ignored; `src/` is the source of truth.
