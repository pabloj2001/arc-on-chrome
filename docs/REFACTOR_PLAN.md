# Refactor Plan — Modular Architecture with a Build Step

Status: **REVISED after review — ready to execute pending final sign-off**
Branch: `refactor/modular-architecture`

> **Review incorporated + user decisions.** A separate reviewer critiqued the
> first draft. The decisions now baked in: (1) **framework-free** for this
> refactor — Preact is deferred to a separate, test-guarded change (§2); (2)
> **build into a new `dist/` directory** — this changes the unpacked extension's
> id on first load (constant thereafter), so settings are migrated with the new
> **`/export`** command (and a later `/import`) rather than by keeping the load
> path (§3); (3) the service worker ships as a **bundled classic IIFE** (§3);
> (4) the content state model is a **reducer + explicit imperative-effects layer
> + generation IDs**, not a generic reactive store (§6); (5) a **committed
> Playwright baseline is Phase 0**, established green against the *current* files
> before any code moves (§8 — DONE: 48 e2e tests, run headless via
> `--headless=new`). Remaining review notes are tracked inline as **[review]**.

## 1. Goal & constraints

Today the extension is two hand-written flat files:

- `content.js` — **2114 lines**, a single IIFE holding all UI + state + logic.
- `background.js` — **410 lines**, the MV3 service worker.

We want to split this into small, single-responsibility modules organized into
directories, optionally using a UI framework, and **compile them back down to
the exact two artifacts the manifest loads**: `content.js` and `background.js`
(plus any CSS the bundler inlines). The runtime behavior must be byte-for-byte
equivalent from the user's perspective — this is a pure restructuring, no
feature changes.

Hard constraints that shape every decision below:

1. **The content script must ship as ONE self-contained file.** MV3 content
   scripts declared in the manifest cannot use native ESM `import` at runtime.
   Everything must be bundled into a single IIFE. (Same for the service worker,
   which *can* use ESM via `"type": "module"`, but we'll bundle it too for
   consistency and to allow shared modules.)
2. **Runs at `document_start`, on `<all_urls>`, in `all_frames`.** The content
   bundle must stay small and must not assume the page DOM/CSS. It already
   guards with `window.top !== window` and a shadow root — that stays.
3. **Shadow DOM isolation is mandatory.** All styles must live inside the shadow
   root; a framework's global style injection is unacceptable.
4. **No network at runtime, no CDN.** Everything is bundled locally.
5. **Zero behavior change.** Same keyboard model, same messages, same storage
   keys (`arcFavorites`, `arcShortcuts`, `arcContexts`, `arcActiveContextId`).

## 2. Framework decision

The bar is largely imperative DOM today, but it has clear component-shaped
pieces (bar, pills, chips, results list, favorites row, contexts row). Options:

| Option | Bundle cost | Fit | Notes |
| --- | --- | --- | --- |
| **A. No framework** — small render modules + explicit DOM helpers | ~0 KB | Good | Least churn, keeps full control, but we keep hand-writing DOM diffing. |
| **B. Preact + TSX** | ~4 KB gz | **Best** | React-like DX, tiny, renders cleanly into a shadow root, signals available for state. |
| **C. React + TSX** | ~40 KB gz | OK | Familiar, but heavy for a content script injected on every page/frame. |

**Decision: Option A (framework-free) for this refactor.** [review — blocking]
Preact does not actually stay confined to the `ui/` layer: controlled-input
commit timing, caret/selection restoration, focus management, DOM measurement
(the param-pill width hack), and mount/unmount lifecycle all cross into the
keyboard/state/lifecycle code. Adopting it here would turn a "pure
restructuring" into a behavioral rewrite. So we keep the view as small,
explicit render modules (typed DOM helpers) with the **same file layout** as
below, and the keyboard path stays in the global native capture-phase listener
(never component handlers, which can't be authoritative under our
`stopImmediatePropagation` model). **Preact/React is re-evaluated as a separate,
interaction-test-guarded change after this refactor lands** — the directory
design does not depend on that outcome, since only the `ui/` implementation
would change.

**Language: TypeScript** regardless. Typed `Message` unions and `Result` types
remove a whole class of the bugs we've been hand-fixing (e.g. result-type
routing in `chooseResult`).

For reference, the options considered:

| Option | Bundle cost | Notes |
| --- | --- | --- |
| **A. Framework-free** (chosen) | ~0 KB | Least behavior risk, keeps full control of caret/focus/measurement/propagation. |
| B. Preact + TSX | ~4 KB gz | Nice DX, but controlled-input + capture-phase-key interplay is a real migration hazard; deferred. |
| C. React + TSX | ~40 KB gz | Too heavy for a script injected on every page/frame. |

## 3. Build tooling

- **Bundler: `esbuild`.** Two entry points → two **classic IIFE** outputs. Fast
  (<50ms), trivial config, first-class TS, CSS `text` loader.
- **Build into a new `dist/` directory.** [user decision] The unpacked extension
  is loaded from `dist/`, so `src/` holds only source. This **changes the
  extension id on first load** (Chrome derives it from the load path), which
  resets `chrome.storage` for the new id — accepted, because the id stays
  constant on every load afterward, and settings are migrated explicitly:
  - **Migration path:** the new **`/export`** command (shipped now, pre-rework)
    copies favorites + shortcuts to the clipboard as versioned JSON; a later
    **`/import`** reads that JSON back. So the user exports from the old
    (root-loaded) extension, loads the new `dist/` build, and imports. Contexts
    are ephemeral and excluded from export.
- **Outputs (both bundled, `bundle: true`, `splitting: false`):**
  - `src/content/index.ts` → `dist/content.js` — `format: "iife"`, single file, CSS inlined as a string.
  - `src/background/index.ts` → `dist/background.js` — **`format: "iife"` (classic worker)**, so `dist/manifest.json` needs **no `"type": "module"`** and top-level listeners register synchronously.
  - `manifest.json` (+ `_favicon` usage etc.) is copied into `dist/`, still referencing `content.js` / `background.js`.
- **Dev vs prod modes.** [review] `npm run dev` = esbuild `--watch`, **unminified + external source maps** (`sourcemap: "external"`, no `eval`-based maps — MV3 CSP forbids them); load `dist/` unpacked. `npm run build` = `minify: true`, no source maps. `npm run typecheck` = `tsc --noEmit`. Explicit `target` (e.g. `chrome120`); no dynamic code generation emitted.
- **`dist/` is git-ignored** (build artifact); `src/` is the source of truth. A
  README note documents `npm run build` before loading.
- **CSS:** the ~200-line `STYLES` template string becomes `bar.css`, imported via
  the esbuild `text` loader and injected as **exactly one** `<style>` in the
  shadow root. [review] A test asserts one host / one shadow root / one `<style>`
  / no global sheet.

## 4. Feature inventory (what must survive the move)

Enumerated from the current code + README so nothing is dropped:

### Content script (`content.js`) features
1. **Injection guard** — top-frame only, single-injection flag.
2. **Two open modes** — search (new tab, `Cmd+T`) and edit-URL (current tab,
   `Cmd+L`, prefilled + selected).
3. **Favorites** — 8 slots, `Cmd+1..8`, favicon buttons, empty-slot styling,
   focus-or-create matching, storage sync.
4. **Keyword shortcuts (pills)** — alias+space arms a pill, `%s` templating,
   backspace-to-dismiss, dismissed-token guard, scheme inference.
5. **Slash-command palette** — `/` list, prefix autocomplete, fuzzy fallback.
6. **Command param mode (pills)** — per-param pills, Tab/Shift+Tab/←/→ nav,
   backspace step-back, required-param flash, structured run.
7. **Command registry** — `favorite`, `unfavorite`, `shortcut`, `unshortcut`,
   `context`, `deletecontext` (+ the "add a command" extension pattern).
8. **Results list** — open tabs + 7-day history, query matching, dedup/canon,
   scoped-to-base in shortcut mode, "Website" domain result, "Search for …"
   second result, tab/history/domain/search/command result types + routing.
9. **Inline URL autocomplete (ghost)** — domain scoring, best-domain match,
   root-over-subdomain preference, `→` to accept.
10. **Contexts (ephemeral tab groups)** — active-context tint (border/icon/bg),
    numbered contexts row (+default chip, `+` chip), switch by click/`Ctrl+1..N`,
    `Ctrl++` to create, back-arrow icon, temp-exit via `←` / empty Backspace,
    `Cmd+L` shows current tab's context, Edge color palette mapping.
11. **Keyboard engine** — global capture-phase listeners (Vimium coexistence),
    toggle/url combo detection, Escape/Enter/Arrows/Tab handling, propagation
    blocking while open.
12. **Lifecycle** — open/close/toggle, focus management, close-on-blur,
    close-on-backdrop, initial-state application.
13. **Dispatch** — new tab vs current tab, context group routing.

### Background (`background.js`) features
A. **Command routing** — `chrome.commands` → `TOGGLE_ARC_SEARCH` with options.
B. **Message router** — the `onMessage` switch (8 message types).
C. **Index builder** — `getIndex`: open tabs + 7-day history + context state +
   current tab group id.
D. **Favorite open** — `focusOrCreateTab` + `tabMatchesFavorite` + `parseUrl`.
E. **Contexts core** — storage (`getContexts`/`setContexts`/active id), create,
   clear, switch, delete, add-tab-to-group, expiry parsing/formatting, titles.
F. **Alarms & tab events** — 1-min tick (`tickContexts`), `onActivated`
   last-active refresh, `closeGroupTabs`, alarm bootstrap.

## 5. Proposed directory structure

```
arc-search-extension/
├─ manifest.json                 # source manifest (copied into dist/ at build)
├─ package.json                  # scripts + devDeps (esbuild, typescript, vitest, @playwright/test)
├─ tsconfig.json
├─ build.mjs                     # esbuild config (2 entry points, css text loader, dev/prod)
├─ dist/                         # BUILD OUTPUT (git-ignored) — the loaded extension
│  ├─ manifest.json              # copied; references content.js / background.js
│  ├─ content.js                 # bundled IIFE (+ .map in dev)
│  └─ background.js              # bundled classic worker (+ .map in dev)
├─ docs/
│  └─ REFACTOR_PLAN.md
├─ tests/
│  ├─ unit/                      # Vitest: pure modules (shared/url, search/results, contexts/expiry…)
│  └─ e2e/                       # Playwright regression harness (committed baseline — DONE, 48 tests)
└─ src/
   ├─ shared/                    # imported by BOTH bundles (kills current duplication)
   │  ├─ messages.ts             # Message REQUEST + RESPONSE unions + runtime validators (§7)
   │  ├─ constants.ts            # storage keys + FAV_COUNT, MAX_RESULTS, MAX_CONTEXTS, GROUP_COLORS, durations
   │  ├─ url.ts                  # parseUrl, canon, hostPath, normalizeUrl, ensureScheme, schemeFor, looksLikeNavigable, faviconUrl, buildUrl, applyShortcut
   │  └─ colors.ts               # GROUP_COLOR_HEX(_DARK), groupHex, groupTextColor, isDarkScheme, hexToRgb, tintBg
   │
   ├─ background/
   │  ├─ index.ts                # entry: registers ALL listeners synchronously (commands, onMessage, alarms, tab events) BEFORE any await
   │  ├─ commands.ts             # chrome.commands routing (feature A)
   │  ├─ router.ts               # onMessage switch → handlers, payload validation, `return true` per async reply (feature B)
   │  ├─ index-builder.ts        # getIndex (feature C)
   │  ├─ favorites.ts            # focusOrCreateTab, tabMatchesFavorite (feature D)
   │  └─ contexts.ts             # contexts core: store + create/clear/switch/delete + expiry/alarms/tab-events (features E,F)
   │
   └─ content/
      ├─ index.ts                # entry: injection guard, register key listeners SYNC, then bootstrap storage/index
      ├─ state/
      │  ├─ store.ts             # reducer + dispatch + generation IDs (§6). Canonical UI state ONLY.
      │  ├─ actions.ts           # typed actions: OPEN_SEARCH, OPEN_URL, SET_QUERY, ARM_PILL, ENTER_PARAM, PREVIEW_RESULT, CLOSE, …
      │  ├─ selectors.ts         # derived: contextActive(), contextGroupIdForDispatch(), idleStatus(), urlMode()
      │  └─ effects.ts           # imperative-effects layer: focus/select/setSelectionRange/scrollIntoView/measure, run AFTER commit
      ├─ data/                   # cached (non-canonical) data, not in the reducer
      │  ├─ favorites.ts         # load/save/sync favorites + shortcuts (storage.onChanged)
      │  ├─ index-client.ts      # loadIndex(): ARC_GET_INDEX, holds openTabs/history/context cache (guarded by generation id)
      │  └─ domain-scores.ts     # buildDomainScores, bestDomainMatch, hostOf
      ├─ search/
      │  ├─ results.ts           # computeResults, refreshResults, matchesQuery, templateBase, underBase (pure over inputs)
      │  └─ autocomplete.ts      # computeCompletion, ghost suffix logic
      ├─ commands/
      │  ├─ registry.ts          # COMMANDS definitions ONLY (no side effects)
      │  ├─ effects-api.ts       # the ctx effects object (setFavorite, setContext, …) — returns intents, doesn't import UI
      │  ├─ runner.ts            # runCommand, runCommandStructured, usageOf, bestCommandByPrefix
      │  └─ param-mode.ts        # enter/exit command mode, advance/prev param, flashInvalidParams (uses effects.ts for measure)
      ├─ keyboard/
      │  ├─ combos.ts            # isToggleCombo, isUrlCombo
      │  └─ keydown.ts           # the authoritative native capture-phase engine, onKeyOther, propagation blocking
      ├─ dispatch/               # split per review to avoid a god-module + cycles
      │  ├─ navigation.ts        # dispatch(url): new-tab vs current-tab + context group routing (background messaging)
      │  └─ actions.ts           # submit(), chooseResult(i), openFavorite(i): orchestrates results+context → navigation
      ├─ lifecycle.ts            # open/close/toggle, applyInitialState, onFocusOut, lazy mount/unmount of the host
      └─ ui/                     # VIEW layer only (framework-free render modules)
         ├─ mount.ts             # create host + shadow root, inject bar.css as ONE <style>, own DOM refs
         ├─ bar.css              # the STYLES string, extracted
         ├─ icons.ts             # ICON_SEARCH, ICON_BACK
         ├─ render-bar.ts        # overlay/backdrop, bar frame, input + ghost, status line
         ├─ render-pill.ts       # shortcut pill
         ├─ render-command-chips.ts  # command name chip + param pills (keeps ONE stable input node — see §6)
         ├─ render-results.ts    # results list + row (tab/history/domain/search/command)
         ├─ render-favorites.ts  # favicon buttons row
         └─ render-contexts-row.ts   # default chip + context chips + "+" chip, tint application
```

> [review] The tree above is **less granular** than the first draft (~20 modules
> vs ~30): `background/contexts/*` collapsed to one `contexts.ts`, `shared/url`
> absorbs the thin `url-builder` wrappers, and `storage-keys` folds into
> `constants`. We start from these cohesive modules and only split further if a
> real dependency-direction or test boundary demands it.

### Why this split
- **`shared/`** kills the current duplication: `parseUrl`, color maps, storage
  keys, and message strings exist in *both* files today and drift apart. One
  source of truth, typed.
- **`background/contexts.ts`** keeps the single biggest background concern
  (roughly half of `background.js`) in one cohesive module (storage + lifecycle +
  expiry + alarms) rather than four tiny files. [review]
- **`content/` is split by concern:** `state`, `data`, `search`, `commands`,
  `keyboard`, `dispatch`, `lifecycle`, `ui`. Each maps directly to the feature
  inventory in §4 so a reviewer can check coverage 1:1.
- **Directional dependencies to avoid cycles** [review — blocking risk]:
  `shared` (pure) → `search`/`data` (pure-ish over inputs) → `state` (reducer +
  actions) → `commands`/`dispatch`/`lifecycle` (effect orchestrators) →
  `ui` (render only) and `keyboard` (calls actions/orchestrators). **Commands
  return intents** via `effects-api.ts` instead of importing `lifecycle`/`ui`/
  `dispatch` directly; the runner applies them. `dispatch/` is split into
  `navigation.ts` (pure background messaging) and `actions.ts` (orchestration)
  so `submit`/`chooseResult` don't pull the whole graph into one node.
- **`ui/` is the only view layer.** Framework-free render modules own all DOM
  refs (via `mount.ts`); logic modules never hold element handles.

## 6. State model (the crux of the content refactor)

Today ~25 module-level `let`s + DOM element refs are mutated in place and
re-rendered by scattered `renderX()` calls. Target — **a reducer + an explicit
imperative-effects layer, NOT a generic reactive store** [review — blocking],
because current behavior depends on *ordered* mutations immediately followed by
`focus()`, `select()`, `setSelectionRange()`, `scrollIntoView()`, and layout
measurement; a batching/reordering reactive store would break the ghost caret,
result scroll, and param-pill width.

- **Canonical UI state (reducer, `state/store.ts`)** — the source of truth:
  `isOpen`, `mode` (`search|url`; `opensInCurrentTab`/`urlMode` are *derived*
  from this, not stored twice), `defaultUrl`, `query`/`typedQuery`, `results`,
  `activeIndex`, `pill` (`activeShortcut`, `dismissedToken`, `typedToken`),
  `command` (name, params, index, values), `context` (`active`, `list`,
  `tempExited`, `currentTabGroupId`), `ghostSuffix`, `navigating`, and a
  monotonically increasing **`generation` id**.
- **Cached data (NOT in the reducer, lives in `data/`)** — `favorites`,
  `shortcuts`, `openTabs`, `history`, `domainScores`. Inputs to `computeResults`,
  refreshed from storage/index; the reducer reads snapshots.
- **Transient DOM state (owned by `ui/mount.ts`)** — all element refs leave
  state entirely.
- **Generation IDs guard async races** [review]: `loadIndex()` responses, the
  ~700ms invalid-param flash timer, and any deferred callback capture the
  `generation` at issue time and no-op if the bar has since closed/reopened.
- **Effects run after commit** [review]: reducers are pure; the dispatcher, after
  applying an action and letting `ui/` render, invokes `state/effects.ts` for
  focus/select/caret/scroll/measure. Actions are **atomic transitions** —
  `OPEN_SEARCH`, `OPEN_URL`, `SET_QUERY`, `ARM_PILL`, `DISMISS_PILL`,
  `ENTER_PARAM`, `ADVANCE_PARAM`, `PREVIEW_RESULT`, `CHOOSE_RESULT`, `CLOSE` —
  each pairing a state change with a declared effect, replacing the ~15 ad-hoc
  `renderX()` calls and the "forgot to call renderContext()" bug class.
- **The param-pill input is ONE stable node** [review]: it is *moved* between the
  bar and the active pill (never remounted per-parameter), and
  `scrollWidth`/`getBoundingClientRect` measurement happens only in the
  post-commit effect phase. `render-command-chips.ts` documents this invariant.

## 7. Message protocol (typed, in `shared/messages.ts`)

Freeze the existing wire format, just give it types — **including response
shapes and boundary validation** [review]:

```ts
type ToContent = { type: "TOGGLE_ARC_SEARCH"; opensInCurrentTab?: boolean; useCurrentUrl?: boolean };

type ToBackground =
  | { type: "ARC_SEARCH_SUBMIT"; url: string; groupId: number | null }
  | { type: "ARC_OPEN_FAVORITE"; url: string; groupId: number | null }
  | { type: "ARC_ACTIVATE_TAB"; tabId: number; windowId?: number }
  | { type: "ARC_SET_CONTEXT"; name: string; expiry?: string }
  | { type: "ARC_CLEAR_CONTEXT" }
  | { type: "ARC_SWITCH_CONTEXT"; groupId: number }
  | { type: "ARC_DELETE_CONTEXT"; name: string }
  | { type: "ARC_GET_INDEX" };

// Response contracts (previously implicit) — one per request that replies:
type Responses = {
  ARC_SET_CONTEXT: { ok: boolean; reason?: "duplicate" | "limit"; groupId?: number; name?: string; color?: string };
  ARC_SWITCH_CONTEXT: { ok: boolean; activeContext?: ContextInfo };
  ARC_DELETE_CONTEXT: { ok: boolean; reason?: "notfound"; name?: string };
  ARC_GET_INDEX: { currentTabId: number|null; currentTabGroupId: number; tabs: TabInfo[]; history: HistoryInfo[]; activeContext: ContextInfo|null; contexts: ContextInfo[] };
  ARC_CLEAR_CONTEXT: { ok: boolean };
};
```

- **No new/renamed messages** — guarantees background and content stay
  compatible at every phase.
- **`router.ts` validates payloads** at the boundary and preserves `return true`
  for every async `sendResponse` path (the existing bug-prone spot). [review]
- Tests cover `chrome.runtime.lastError` and **service-worker suspension/restart**
  between messages (no correctness may depend on worker module-level state).
  [review]

## 8. Execution phases

Each phase ends **green**: `npm run build` succeeds, the extension loads from
`dist/`, Vitest passes, and the committed Playwright harness passes. We migrate
incrementally so `dist/` is always loadable.

0. **Baseline harness — ✅ DONE (this checkpoint).** Committed a Playwright e2e
   harness of **48 tests** covering the behavior-sensitive spots we tuned:
   search/url modes, favorites focus-or-create + empty-slot styling, shortcut
   pills (arm/dismiss, `%s`, the shortcut-Enter + history-routing regressions,
   scoped results, search-as-2nd-result), results/domain/ghost autocomplete +
   root-domain preference + many-open-tabs search fix, command palette + param
   pills (Tab-only advance, Shift+Tab first-param no-op, required-flash),
   contexts (row numbering, Ctrl+1/2 switch, ← / empty-Backspace temp-exit,
   back-arrow, `Cmd+L` current-tab context, join-group, limit 5), keyboard
   (Escape, focus, backdrop, propagation blocking), and the new `/export`. Runs
   **windowless** via Chromium `--headless=new` (`npm test`; `HEADED=1` to
   watch). A Vitest layer for pure modules is added as those modules are
   extracted (Phase 2+). Still **manual** in Chrome/Edge: OS-level command
   shortcuts and Fluent tab-group colors.
1. **Scaffold build (verbatim move). — ✅ DONE.** Added `tsconfig.json`,
   `build.mjs` (esbuild, two entry points → `dist/`, CSS `text` loader, dev/prod
   modes, classic IIFE worker), devDeps (esbuild, typescript, vitest,
   @types/chrome) and npm scripts `dev`/`build`/`typecheck` (+ `pretest` builds
   before Playwright). Created `src/content/index.ts` + `src/background/index.ts`
   with the *current* code moved verbatim (`// @ts-nocheck`); listeners stay
   registered synchronously at module top. Build emits `dist/{content,background}.js`
   and copies `manifest.json`. The Playwright fixture now loads the extension from
   `dist/` and the harness passes (**50 tests** — added `/import` coverage). The
   IIFE wrapper hid the worker's top-level `setContext`, so it is re-exposed on
   `self` for the harness. Shipped the **`/import`** command (clipboard →
   file-picker → pasted-arg) so settings survive the extension-id change.
2. **Extract `shared/` — ✅ DONE.** Pulled `url` (parseUrl, tabMatchesFavorite,
   normalizeUrl, buildUrl, applyShortcut, faviconUrl, canon, hostPath,
   looksLikeNavigable, schemeFor, ensureScheme), `colors` (group hex maps +
   isDarkScheme/groupHex/groupTextColor/tintBg/hexToRgb), `constants` (storage
   keys + tunables + GROUP_COLORS + alarm/duration + WEB_URL), and `messages`
   (the `MSG` wire-string map) out of both bundles and de-duplicated the two
   former copies of `parseUrl`. Both entry files now `import` from `../shared/*`.
   Added Vitest (`npm run test:unit`, `tests/unit/`) with 20 tests for the pure
   url + color helpers. `npm run typecheck` is clean; the 50-test Playwright
   harness still passes against `dist/`.
3. **Split `background/` — ✅ DONE.** Broke the worker monolith into the module
   tree: `commands.ts` (chrome.commands routing), `router.ts` (onMessage switch →
   handlers, `return true` per async reply), `index-builder.ts` (getIndex),
   `favorites.ts` (focusOrCreateTab), and a cohesive `contexts.ts` (storage +
   create/clear/switch/delete + tab-activity reset + expiry/alarms/tick). `index.ts`
   is now a thin entry that registers ALL listeners synchronously at module top
   (commands, onMessage, tabs.onActivated, alarms.onAlarm, onStartup/onInstalled)
   before any await, then `ensureAlarm()` and the `self.setContext` test bridge.
   Added 4 Vitest cases for the pure `parseExpiry`/`fmtRemaining`/`groupTitle`
   (24 unit total). typecheck clean; the 50-test Playwright harness — including
   the full context lifecycle + alarms — still passes against `dist/`.
4. **Split `content/` logic — 🚧 IN PROGRESS (incremental).** Per a mid-refactor
   decision, we extract the cleanly-pure logic modules first (keeping the harness
   green at each step) and introduce the reducer as a focused follow-up, rather
   than rewriting the 2100-line closure in one pass. **Done so far:**
   `content/settings.ts` (normalizeFavArray + buildSettingsExport/parseSettingsImport,
   the pure JSON (de)serialization; clipboard/file plumbing stays in the entry),
   `content/search/matching.ts` (matchesQuery, templateBase, underBase, hostOf,
   computeDomainScores, and the pure `bestDomainMatch` ranking — the entry keeps a
   thin guard wrapper), `content/keyboard/combos.ts` (isToggleCombo/isUrlCombo),
   and `content/commands/registry.ts` (the COMMANDS registry + usageOf +
   bestCommandByPrefix — `unshortcut` now consults `ctx.hasShortcut` instead of
   closure state). The entry `import`s these; 21 new Vitest cases cover them
   (45 unit total). typecheck clean; 50 e2e still green. **Remaining:** extract
   data/index-client, then the reducer + effects with a compatibility renderer
   (the original Phase 4/5 crux).
5. **Rebuild the `ui/` layer — ✅ DONE.** DOM construction is consolidated in
   `src/content/ui/mount.ts` (`mountBar()` builds host + shadow root + the single
   `<style>` and returns a refs object). `STYLES` → `ui/bar.css` (text import),
   icons → `ui/icons.ts`. Every render function is now a framework-free view
   module over an explicit deps object: `render-pill`, `render-ghost`,
   `render-favorites`, `render-results`, `render-context`, `render-contexts-row`,
   and `render-command-chips` (which preserves the single-stable-input-node
   invariant — the input is moved into the active param slot, never recreated).
   The entry keeps thin wrappers supplying refs/state/callbacks (state still lives
   in the entry as the store; these render modules are the effects that draw it).
   `content/index.ts` is down from 2117 → ~1420 lines. typecheck clean; 50 e2e +
   45 unit green. **Remaining (deferred crux):** formalize the entry's state into
   a `state/store.ts` reducer + dispatch (the render wrappers already isolate the
   effect boundary), then Phase 6 hardening.
6. **Harden — ✅ DONE (with one documented island).** Deleted the dead root
   `content.js`/`background.js` (source is `src/`, build emits `dist/`). Dev build
   already ships external source maps (`npm run dev`); prod is minified/mapless.
   `/import` shipped in Phase 1. README updated (load unpacked from `dist/`,
   Project-layout section, build scripts, `/export`→`/import`). **Typing:** turned
   on `noImplicitAny` and removed `@ts-nocheck` from **all 19 leaf modules**, which
   are now fully typed (new type homes: `shared/types.ts`,
   `content/commands/types.ts`, `content/ui/types.ts`; `background/contexts.ts`
   gets `Context`/`ContextInfo`/`ContextState` + `GroupColor`). `typecheck` is
   clean under `noImplicitAny`; Vitest (45) + Playwright (50) green. **Single
   remaining `@ts-nocheck` island: `src/content/index.ts`** — the ~1400-line
   imperative entry (state vars + focus/caret/measure effects). Full `strict` +
   typing it is the same deferred crux as the reducer (its 299 implicit-any errors
   are almost all the untyped module-scoped state); left for a focused follow-up
   so it can be done as one cohesive reducer+types change without risking the
   behavior the harness guards.

The harness from Phase 0 runs at the end of **every** phase.

### Status summary (as of this checkpoint)
Phases 0–5 complete; Phase 6 complete except the single `content/index.ts`
`@ts-nocheck` island (the deferred reducer + full-`strict` typing of the entry).
The extension is fully modular: `src/shared/*`, `src/background/*` (6 modules),
`src/content/*` (settings, search, keyboard, commands, ui/{mount,bar.css,icons,
7×render-*}) → bundled by esbuild into `dist/{content,background}.js`. 45 Vitest +
50 Playwright tests green; `npm run typecheck` clean under `noImplicitAny`.

## 9. Risks & mitigations
- **Behavior drift during split** → migrate verbatim first (Phase 1), split
  behind a green build, run Vitest + the Playwright baseline each phase.
- **Extension identity / storage resets on cutover** [user decision] → building
  into `dist/` changes the id on first load, which resets `chrome.storage` for
  the new id. Mitigated by **`/export` → `/import`** settings migration (§3);
  contexts are ephemeral and not migrated.
- **Missed early commands** [review] → register all content + worker listeners
  **synchronously at module evaluation, before any `await`**; no top-level await.
- **Async races landing on a reopened bar** [review] → generation IDs on every
  deferred callback (§6).
- **Framework/event interference** → framework-free; keyboard stays in the global
  native capture-phase listener (§2).
- **Content bundle bloat** [review] → measure raw/min/gzip **and** parse/startup
  cost (script runs at `document_start`); budget stays tiny without a framework.
- **`all_frames` cost** [review] → verify whether top-frame-only manifest
  injection preserves behavior; if so set `all_frames:false`. Regardless, keep all
  imported modules **side-effect-free** so the injection guard runs before any
  bundler dependency initializes.
- **Shadow-DOM style leakage** → CSS injected as exactly one `<style>` in the
  shadow root; test asserts one host / one shadow root / one style / no global
  sheet.
- **MV3 CSP + source maps** [review] → external (non-`eval`) source maps in dev
  only; no dynamic code generation emitted.
- **Lazy vs permanent host** [review] → host stays **lazy-mounted on open, fully
  unmounted on close** (current behavior); test repeated open/close and extension
  reload, and detect/clean a stale host by ID.

## 10. Resolved decisions
1. **Framework:** framework-free (Option A) now; Preact re-evaluated later as a
   separate, interaction-test-guarded change.
2. **Build output location:** emit into a new **`dist/`** directory (git-ignored);
   `src/` is the source of truth. Accepts a one-time extension-id change on first
   load; settings migrate via **`/export` → `/import`**. [user decision]
3. **Worker format:** bundled **classic IIFE**; no `"type":"module"` in the
   manifest.
4. **TypeScript strictness:** `@ts-nocheck` through the verbatim/split phases,
   turn on full `strict` in Phase 6.
5. **Output filenames:** keep `content.js` / `background.js` inside `dist/`.
6. **Tests:** committed Playwright e2e harness (Phase 0, **done**) plus a Vitest
   layer for pure modules added as they're extracted. [user decision]
7. **`/export` now, `/import` later:** `/export` ships this checkpoint (clipboard
   JSON, favorites + shortcuts); `/import` lands before/with the `dist/` cutover
   (Phase 1) so settings carry across the id change. [user decision]
