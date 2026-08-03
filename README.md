# Arc Search Bar

A Chrome extension that replicates Arc's floating command/search bar.

## What it does

- **Search** — press the search shortcut (**Cmd+T** / **Ctrl+T** by default) to open a
  floating bar. Type and press **Enter**: URL-shaped input opens in a **new tab** and is
  resolved by the browser, so corporate intranet links work — including ones with a trailing
  query such as `go/glean my search` (opened as `http://go/glean%20my%20search`). Anything
  that isn't URL-shaped (plain words, phrases) is searched on Google instead.
- **Edit URL** — press the URL shortcut (**Cmd+L** / **Ctrl+L** by default) to open the bar
  prefilled with the current tab's URL. Editing and pressing **Enter** navigates the
  **current tab** (the same URL-vs-search resolution applies).
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
  Use **↑/↓** to move the selection (**Tab** jumps to the first result), and **Enter** to go —
  switching to the tab if it's already open, otherwise opening the page. The list shows ~4 rows
  at a time (scroll for the rest, up to 10).

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
row shows the usage and a description). Pick one with **↑/↓ + Enter**, **Tab**, or a click
(typing a command name + space also works, and autocompletes a prefix like `/short`).

Selecting a command turns it into **pills**: the command name, then one pill per parameter.
The active parameter's name shows as a placeholder — type its value and press **Space** or
**Tab** to move to the next, **Shift+Tab** to go back, and **Backspace** on an empty parameter
to step back (or exit the command). **Enter** runs it.

| Command | Description |
| --- | --- |
| `/favorite <1-8> <url>` | Save a favorite, e.g. `/favorite 1 github.com` |
| `/unfavorite <1-8>` | Clear a favorite |
| `/shortcut <alias> <url with %s>` | Add a keyword shortcut, e.g. `/shortcut go https://go/%s` |
| `/unshortcut <alias>` | Remove a keyword shortcut |

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

- `manifest.json` — MV3 manifest, permissions (`commands`, `tabs`, `storage`, `favicon`, `history`), and command bindings.
- `background.js` — routes the shortcuts to the page (with a mode), opens results in new tabs, switches to an existing tab when opening a favorite, and serves the open-tabs + 7-day history index used by the result list.
- `content.js` — renders the bar (isolated Shadow DOM), handles input, modes, favorites, keyword shortcuts, the tabs/history result list, the command registry, and dismissal.
