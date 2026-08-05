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
group's color. Press **← (Left arrow)** at the start of the input to *temporarily* leave the
context so the next tab opens in the default space; it returns the next time you open the bar.

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

Favorites and shortcuts are stored with `chrome.storage.local`, so they persist across browser
restarts and stay in sync across tabs. The favicon buttons under the bar reflect your saved
favorites; empty slots show their number and can be clicked to start a `/favorite` command.

### Adding new commands

Commands live in a small registry in `content.js`. To add one, add an entry to the
`COMMANDS` object:

```js
const COMMANDS = {
  mycmd: {
    description: "What it does.",
    params: [{ name: "arg" }, { name: "other" }], // each shown as a pill
    run: (args, ctx) => {
      // args: the param values in order
      // ctx: { status, setFavorite, setShortcut, removeShortcut, close, clearInput }
      ctx.status("done");
    },
  },
};
```

## Install (load unpacked)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and select this folder.

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

## Files

- `manifest.json` — MV3 manifest, permissions (`commands`, `tabs`, `storage`, `favicon`, `history`, `tabGroups`, `alarms`), and command bindings.
- `background.js` — routes the shortcuts to the page, opens results in new tabs, switches to an existing tab when opening a favorite, serves the open-tabs + 7-day history index, and manages contexts (tab groups): creation, grouping new tabs, and the expiry/title-refresh alarm.
- `content.js` — renders the bar (isolated Shadow DOM), handles input, modes, favorites, keyword shortcuts, the tabs/history result list, inline autocomplete, the search suggestion, the command palette/param pills, and the contexts row + coloring.
