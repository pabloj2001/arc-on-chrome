// The /settings modal: a self-contained overlay (its own shadow host, separate
// from the bar's, which is torn down when the bar closes). A left sidebar
// switches between sections:
//   • General   — one validated field per SETTING_DEF; saved with the Save button.
//   • Shortcuts — list every keyword shortcut with a remove button, plus an
//                 inline form to add a new one (applied immediately).
// Esc or a backdrop click closes.
import { SETTING_DEFS, SETTING_CATEGORIES, type Settings } from "../../shared/settings";

const MODAL_HOST_ID = "arc-settings-modal-host";

const MODAL_CSS = `
:host { all: initial; }
.backdrop {
  position: fixed; inset: 0; z-index: 2147483647;
  background: rgba(0,0,0,0.32);
  display: flex; align-items: flex-start; justify-content: center;
  padding-top: 10vh;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
.panel {
  width: 840px; max-width: calc(100vw - 32px); min-height: 360px;
  background: #fafafc; color: #1a1a1f;
  border-radius: 16px; overflow: hidden;
  box-shadow: 0 24px 64px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.06);
  display: grid; grid-template-columns: 200px 1fr;
}
.sidebar {
  background: #f0f0f3; padding: 20px 12px; border-right: 1px solid rgba(0,0,0,0.06);
  display: flex; flex-direction: column; gap: 4px;
}
.sidebar .brand { font-size: 15px; font-weight: 700; padding: 0 10px 12px; }
.nav-item {
  all: unset; box-sizing: border-box; cursor: pointer;
  padding: 8px 10px; border-radius: 8px; font-size: 14px; font-weight: 600; color: #45454c;
}
.nav-item:hover { background: rgba(0,0,0,0.05); }
.nav-item.active { background: #4b6cff; color: #fff; }
.main { padding: 22px 24px 18px; display: flex; flex-direction: column; }
.section { display: none; flex: 1; }
.section.active { display: flex; flex-direction: column; }
.section h3 { font-size: 16px; font-weight: 700; margin: 0 0 4px; }
.section .lead { font-size: 12px; color: #6a6a70; margin: 0 0 16px; }
.row { display: flex; flex-direction: column; gap: 5px; margin-bottom: 16px; }
.row label { font-size: 14px; font-weight: 600; }
.row .hint { font-size: 12px; color: #7a7a80; }
.row input {
  all: unset; box-sizing: border-box; width: 100%;
  height: 38px; padding: 0 12px; border-radius: 10px;
  background: #fff; border: 1px solid #d9d9e0; color: #1a1a1f; font-size: 14px;
}
.row input:focus { border-color: #4b6cff; box-shadow: 0 0 0 3px rgba(75,108,255,0.18); }
.row.invalid input { border-color: #e3008c; box-shadow: 0 0 0 3px rgba(227,0,140,0.16); }
.row-toggle { flex-direction: row; align-items: center; gap: 10px; flex-wrap: wrap; }
.row-toggle label { order: 2; white-space: nowrap; flex: 0 1 auto; }
/* Checkboxes must keep their native rendering — the all:unset rule above strips
   the appearance and leaves a blank, dead box, so restore it explicitly here. */
.row-toggle input[type="checkbox"] {
  all: revert; order: 1; width: 18px; height: 18px; flex: 0 0 auto;
  margin: 0; cursor: pointer; accent-color: #4b6cff;
}
.row-toggle .hint { order: 3; flex-basis: 100%; }
.error { min-height: 18px; font-size: 13px; color: #e3008c; margin: -4px 0 10px; }
.actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: auto; padding-top: 12px; }
.form-footer { display: flex; flex-direction: column; }
.form-footer.hidden { display: none; }
.btn {
  all: unset; box-sizing: border-box; cursor: pointer;
  height: 36px; padding: 0 16px; border-radius: 10px; font-size: 14px; font-weight: 600;
}
.btn.cancel { color: #4a4a50; background: #ededf0; }
.btn.cancel:hover { background: #e2e2e6; }
.btn.save { color: #fff; background: #4b6cff; }
.btn.save:hover { background: #3a5cf0; }
/* Shortcuts */
.sc-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; max-height: 240px; overflow: auto; }
.sc-empty { font-size: 13px; color: #8a8a90; padding: 8px 0; }
.sc-row {
  display: flex; align-items: center; gap: 10px;
  background: #fff; border: 1px solid #e6e6ec; border-radius: 10px; padding: 8px 10px;
}
.sc-alias { font-weight: 700; font-size: 14px; min-width: 72px; }
.sc-url { flex: 1; font-size: 13px; color: #55555c; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sc-remove {
  all: unset; box-sizing: border-box; cursor: pointer;
  width: 26px; height: 26px; border-radius: 7px; text-align: center; line-height: 26px;
  color: #b0303f; background: rgba(227,0,140,0.08); font-weight: 700;
}
.sc-remove:hover { background: rgba(227,0,140,0.16); }
.sc-add { display: flex; gap: 8px; align-items: flex-start; }
.sc-add input {
  all: unset; box-sizing: border-box; height: 36px; padding: 0 10px; border-radius: 9px;
  background: #fff; border: 1px solid #d9d9e0; color: #1a1a1f; font-size: 13px;
}
.sc-add input:focus { border-color: #4b6cff; box-shadow: 0 0 0 3px rgba(75,108,255,0.18); }
.sc-add .sc-add-alias { width: 120px; }
.sc-add .sc-add-url { flex: 1; }
@media (prefers-color-scheme: dark) {
  .panel { background: #1e1e21; color: #f2f2f4; box-shadow: 0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06); }
  .sidebar { background: #26262a; border-right-color: rgba(255,255,255,0.06); }
  .nav-item { color: #c8c8d0; }
  .nav-item:hover { background: rgba(255,255,255,0.06); }
  .section .lead, .row .hint { color: #a0a0a8; }
  .row input, .sc-add input { background: #26262a; border-color: #3a3a40; color: #f2f2f4; }
  .btn.cancel { color: #d0d0d6; background: #2e2e33; }
  .btn.cancel:hover { background: #37373d; }
  .sc-row { background: #26262a; border-color: #3a3a40; }
  .sc-url { color: #a8a8b0; }
}
`;

export interface SettingsModalHandle {
  close: () => void;
}

export function openSettingsModal(opts: {
  settings: Settings;
  onSave: (next: Settings) => void;
  shortcuts?: Record<string, string>;
  onAddShortcut?: (alias: string, url: string) => void;
  onRemoveShortcut?: (alias: string) => void;
}): SettingsModalHandle {
  // Only one modal at a time.
  const existing = document.getElementById(MODAL_HOST_ID);
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

  const shortcuts: Record<string, string> = { ...(opts.shortcuts || {}) };

  const host = document.createElement("div");
  host.id = MODAL_HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = MODAL_CSS;

  const backdrop = document.createElement("div");
  backdrop.className = "backdrop";
  const panel = document.createElement("div");
  panel.className = "panel";

  // ---- Sidebar -------------------------------------------------------------
  const sidebar = document.createElement("div");
  sidebar.className = "sidebar";
  const brand = document.createElement("div");
  brand.className = "brand";
  brand.textContent = "Settings";
  sidebar.appendChild(brand);

  const sections: { id: string; label: string }[] = [
    ...SETTING_CATEGORIES.map((c) => ({ id: c.id, label: c.label })),
    { id: "shortcuts", label: "Shortcuts" },
  ];
  const firstId = sections[0].id;
  const navButtons: Record<string, HTMLButtonElement> = {};
  for (const s of sections) {
    const btn = document.createElement("button");
    btn.className = "nav-item" + (s.id === firstId ? " active" : "");
    btn.textContent = s.label;
    btn.setAttribute("data-section", s.id);
    btn.addEventListener("click", () => selectSection(s.id));
    navButtons[s.id] = btn;
    sidebar.appendChild(btn);
  }

  // ---- Main ----------------------------------------------------------------
  const main = document.createElement("div");
  main.className = "main";

  const CATEGORY_LEAD: Record<string, string> = {
    general: "",
    favorites: "How favorites open and stay in sync with pinned tabs.",
    expiry:
      "Durations accept m / h / d (e.g. 30m, 24h, 2d); times accept 9:00 or 5pm.",
  };

  // One section per settings category, each holding its own fields.
  const categorySections: Record<string, HTMLDivElement> = {};
  const rows: { def: (typeof SETTING_DEFS)[number]; row: HTMLDivElement; input: HTMLInputElement }[] = [];
  for (const cat of SETTING_CATEGORIES) {
    const section = document.createElement("div");
    section.className = "section" + (cat.id === firstId ? " active" : "");
    section.setAttribute("data-section", cat.id);
    const title = document.createElement("h3");
    title.textContent = cat.label;
    const lead = document.createElement("p");
    lead.className = "lead";
    lead.textContent = CATEGORY_LEAD[cat.id] || "";
    section.appendChild(title);
    section.appendChild(lead);
    for (const def of SETTING_DEFS.filter((d) => d.category === cat.id)) {
      const row = document.createElement("div");
      row.className = "row" + (def.kind === "toggle" ? " row-toggle" : "");
      const label = document.createElement("label");
      label.textContent = def.label;
      const input = document.createElement("input");
      input.setAttribute("data-token", def.token);
      input.autocapitalize = "off";
      input.autocomplete = "off";
      input.spellcheck = false;
      if (def.kind === "toggle") {
        input.type = "checkbox";
        input.checked = opts.settings[def.key] === true;
      } else {
        input.type = "text";
        input.value = def.format(opts.settings[def.key]);
      }
      const hint = document.createElement("div");
      hint.className = "hint";
      hint.textContent = def.hint;
      row.appendChild(label);
      row.appendChild(input);
      row.appendChild(hint);
      section.appendChild(row);
      rows.push({ def, row, input });
    }
    categorySections[cat.id] = section;
    main.appendChild(section);
  }

  // Shared settings footer (error + Save/Cancel), placed before the shortcuts
  // section so `.error` / `.btn.save` resolve to the settings controls. Hidden
  // while the Shortcuts section (which saves inline) is active.
  const footer = document.createElement("div");
  footer.className = "form-footer";
  const error = document.createElement("div");
  error.className = "error";
  const gActions = document.createElement("div");
  gActions.className = "actions";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn cancel";
  cancelBtn.textContent = "Cancel";
  const saveBtn = document.createElement("button");
  saveBtn.className = "btn save";
  saveBtn.textContent = "Save";
  gActions.appendChild(cancelBtn);
  gActions.appendChild(saveBtn);
  footer.appendChild(error);
  footer.appendChild(gActions);
  main.appendChild(footer);

  // Shortcuts section.
  const scSection = document.createElement("div");
  scSection.className = "section";
  scSection.setAttribute("data-section", "shortcuts");
  const scTitle = document.createElement("h3");
  scTitle.textContent = "Shortcuts";
  const scLead = document.createElement("p");
  scLead.className = "lead";
  scLead.textContent = "Keyword searches. Type an alias in the bar, then Space to arm it. Use %s for the query.";
  const scList = document.createElement("div");
  scList.className = "sc-list";
  scSection.appendChild(scTitle);
  scSection.appendChild(scLead);
  scSection.appendChild(scList);

  const scAdd = document.createElement("div");
  scAdd.className = "sc-add";
  const addAlias = document.createElement("input");
  addAlias.className = "sc-add-alias";
  addAlias.placeholder = "alias";
  addAlias.autocapitalize = "off";
  addAlias.autocomplete = "off";
  addAlias.spellcheck = false;
  const addUrl = document.createElement("input");
  addUrl.className = "sc-add-url";
  addUrl.placeholder = "https://example.com/search?q=%s";
  addUrl.autocapitalize = "off";
  addUrl.autocomplete = "off";
  addUrl.spellcheck = false;
  const addBtn = document.createElement("button");
  addBtn.className = "btn save sc-add-btn";
  addBtn.textContent = "Add";
  scAdd.appendChild(addAlias);
  scAdd.appendChild(addUrl);
  scAdd.appendChild(addBtn);
  const scError = document.createElement("div");
  scError.className = "sc-error";
  scSection.appendChild(scAdd);
  scSection.appendChild(scError);

  main.appendChild(scSection);

  panel.appendChild(sidebar);
  panel.appendChild(main);
  backdrop.appendChild(panel);
  shadow.appendChild(style);
  shadow.appendChild(backdrop);
  document.documentElement.appendChild(host);

  let currentSection = firstId;

  function selectSection(id: string) {
    currentSection = id;
    for (const s of sections) navButtons[s.id].classList.toggle("active", s.id === id);
    for (const cat of SETTING_CATEGORIES) {
      categorySections[cat.id].classList.toggle("active", cat.id === id);
    }
    scSection.classList.toggle("active", id === "shortcuts");
    footer.classList.toggle("hidden", id === "shortcuts");
    error.textContent = "";
    scError.textContent = "";
  }

  function renderShortcuts() {
    scList.textContent = "";
    const aliases = Object.keys(shortcuts).sort();
    if (!aliases.length) {
      const empty = document.createElement("div");
      empty.className = "sc-empty";
      empty.textContent = "No shortcuts yet.";
      scList.appendChild(empty);
      return;
    }
    for (const alias of aliases) {
      const row = document.createElement("div");
      row.className = "sc-row";
      const a = document.createElement("div");
      a.className = "sc-alias";
      a.textContent = alias;
      const u = document.createElement("div");
      u.className = "sc-url";
      u.textContent = shortcuts[alias];
      u.title = shortcuts[alias];
      const rm = document.createElement("button");
      rm.className = "sc-remove";
      rm.textContent = "×";
      rm.title = `Remove "${alias}"`;
      rm.setAttribute("data-alias", alias);
      rm.addEventListener("click", () => removeShortcut(alias));
      row.appendChild(a);
      row.appendChild(u);
      row.appendChild(rm);
      scList.appendChild(row);
    }
  }

  function removeShortcut(alias: string) {
    delete shortcuts[alias];
    if (opts.onRemoveShortcut) opts.onRemoveShortcut(alias);
    renderShortcuts();
  }

  function addShortcut() {
    scError.textContent = "";
    const alias = addAlias.value.trim().toLowerCase();
    const url = addUrl.value.trim();
    if (!alias || /\s/.test(alias)) {
      scError.textContent = "Enter a single-word alias (no spaces).";
      addAlias.focus();
      return;
    }
    if (!url) {
      scError.textContent = "Enter a URL (use %s where the query goes).";
      addUrl.focus();
      return;
    }
    shortcuts[alias] = url;
    if (opts.onAddShortcut) opts.onAddShortcut(alias, url);
    addAlias.value = "";
    addUrl.value = "";
    renderShortcuts();
    addAlias.focus();
  }

  function close() {
    document.removeEventListener("keydown", onKeyDown, true);
    if (host.parentNode) host.parentNode.removeChild(host);
  }

  function saveGeneral() {
    error.textContent = "";
    const next = { ...opts.settings } as Record<string, number | boolean>;
    let firstBad: { input: HTMLInputElement; category: string } | null = null;
    for (const r of rows) {
      r.row.classList.remove("invalid");
      if (r.def.kind === "toggle") {
        next[r.def.key] = r.input.checked;
        continue;
      }
      const parsed = r.def.parse(r.input.value);
      if (parsed == null) {
        r.row.classList.add("invalid");
        if (!firstBad) firstBad = { input: r.input, category: r.def.category };
        continue;
      }
      next[r.def.key] = parsed;
    }
    if (firstBad) {
      // Reveal the offending field's section, then flag it.
      if (currentSection !== firstBad.category) selectSection(firstBad.category);
      error.textContent = "That value isn't valid — check the highlighted field.";
      firstBad.input.focus();
      firstBad.input.select();
      return;
    }
    opts.onSave(next as unknown as Settings);
    close();
  }

  function onKeyDown(e: KeyboardEvent) {
    // The modal owns the keyboard while it's up.
    e.stopImmediatePropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (currentSection === "shortcuts") addShortcut();
      else saveGeneral();
    }
  }

  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) close();
  });
  cancelBtn.addEventListener("click", close);
  saveBtn.addEventListener("click", saveGeneral);
  addBtn.addEventListener("click", addShortcut);
  document.addEventListener("keydown", onKeyDown, true);

  renderShortcuts();
  // Focus the first field in the initially-active section.
  const firstActive = rows.find((r) => r.def.category === firstId);
  if (firstActive) {
    firstActive.input.focus();
    if (firstActive.input.type !== "checkbox") firstActive.input.select();
  }

  return { close };
}
