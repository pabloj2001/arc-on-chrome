// The /settings modal: a self-contained overlay (its own shadow host, separate
// from the bar's, which is torn down when the bar closes). Renders one row per
// SETTING_DEF, validates on save via each def's parse(), and hands the updated
// Settings back to the caller to persist. Esc or a backdrop click cancels.
import { SETTING_DEFS, type Settings } from "../../shared/settings";

const MODAL_HOST_ID = "arc-settings-modal-host";

const MODAL_CSS = `
:host { all: initial; }
.backdrop {
  position: fixed; inset: 0; z-index: 2147483647;
  background: rgba(0,0,0,0.32);
  display: flex; align-items: flex-start; justify-content: center;
  padding-top: 12vh;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
.panel {
  width: 520px; max-width: calc(100vw - 32px);
  background: #fafafc; color: #1a1a1f;
  border-radius: 16px; padding: 22px 24px 18px;
  box-shadow: 0 24px 64px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.06);
}
.title { font-size: 18px; font-weight: 700; margin: 0 0 4px; }
.subtitle { font-size: 13px; color: #6a6a70; margin: 0 0 16px; }
.row { display: flex; flex-direction: column; gap: 5px; margin-bottom: 16px; }
.row label { font-size: 14px; font-weight: 600; }
.row .hint { font-size: 12px; color: #7a7a80; }
.row input {
  all: unset; box-sizing: border-box; width: 100%;
  height: 38px; padding: 0 12px; border-radius: 10px;
  background: #fff; border: 1px solid #d9d9e0; color: #1a1a1f;
  font-size: 14px;
}
.row input:focus { border-color: #4b6cff; box-shadow: 0 0 0 3px rgba(75,108,255,0.18); }
.row.invalid input { border-color: #e3008c; box-shadow: 0 0 0 3px rgba(227,0,140,0.16); }
.error { min-height: 18px; font-size: 13px; color: #e3008c; margin: -4px 0 10px; }
.actions { display: flex; justify-content: flex-end; gap: 10px; }
.btn {
  all: unset; box-sizing: border-box; cursor: pointer;
  height: 36px; padding: 0 16px; border-radius: 10px;
  font-size: 14px; font-weight: 600;
}
.btn.cancel { color: #4a4a50; background: #ededf0; }
.btn.cancel:hover { background: #e2e2e6; }
.btn.save { color: #fff; background: #4b6cff; }
.btn.save:hover { background: #3a5cf0; }
@media (prefers-color-scheme: dark) {
  .panel { background: #1e1e21; color: #f2f2f4; box-shadow: 0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06); }
  .subtitle, .row .hint { color: #a0a0a8; }
  .row input { background: #26262a; border-color: #3a3a40; color: #f2f2f4; }
  .btn.cancel { color: #d0d0d6; background: #2e2e33; }
  .btn.cancel:hover { background: #37373d; }
}
`;

export interface SettingsModalHandle {
  close: () => void;
}

export function openSettingsModal(opts: {
  settings: Settings;
  onSave: (next: Settings) => void;
  onClose?: () => void;
}): SettingsModalHandle {
  // Only one modal at a time.
  const existing = document.getElementById(MODAL_HOST_ID);
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

  const host = document.createElement("div");
  host.id = MODAL_HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = MODAL_CSS;

  const backdrop = document.createElement("div");
  backdrop.className = "backdrop";

  const panel = document.createElement("div");
  panel.className = "panel";

  const title = document.createElement("h2");
  title.className = "title";
  title.textContent = "Settings";
  const subtitle = document.createElement("p");
  subtitle.className = "subtitle";
  subtitle.textContent =
    "Durations accept m / h / d (e.g. 30m, 24h, 2d). A bare number means minutes.";

  const error = document.createElement("div");
  error.className = "error";

  // One row + input per setting.
  const rows = SETTING_DEFS.map((def) => {
    const row = document.createElement("div");
    row.className = "row";
    const label = document.createElement("label");
    label.textContent = def.label;
    const input = document.createElement("input");
    input.type = "text";
    input.value = def.format(opts.settings[def.key]);
    input.setAttribute("data-token", def.token);
    input.autocapitalize = "off";
    input.autocomplete = "off";
    input.spellcheck = false;
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = def.hint;
    row.appendChild(label);
    row.appendChild(input);
    row.appendChild(hint);
    return { def, row, input };
  });

  const actions = document.createElement("div");
  actions.className = "actions";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn cancel";
  cancelBtn.textContent = "Cancel";
  const saveBtn = document.createElement("button");
  saveBtn.className = "btn save";
  saveBtn.textContent = "Save";
  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);

  panel.appendChild(title);
  panel.appendChild(subtitle);
  for (const r of rows) panel.appendChild(r.row);
  panel.appendChild(error);
  panel.appendChild(actions);
  backdrop.appendChild(panel);
  shadow.appendChild(style);
  shadow.appendChild(backdrop);
  document.documentElement.appendChild(host);

  function close() {
    document.removeEventListener("keydown", onKeyDown, true);
    if (host.parentNode) host.parentNode.removeChild(host);
    if (opts.onClose) opts.onClose();
  }

  function save() {
    error.textContent = "";
    const next: Settings = { ...opts.settings };
    let firstBad: HTMLInputElement | null = null;
    for (const r of rows) {
      r.row.classList.remove("invalid");
      const parsed = r.def.parse(r.input.value);
      if (parsed == null) {
        r.row.classList.add("invalid");
        if (!firstBad) firstBad = r.input;
        continue;
      }
      next[r.def.key] = parsed;
    }
    if (firstBad) {
      error.textContent = "Enter a valid duration (e.g. 24h) for the highlighted field.";
      firstBad.focus();
      firstBad.select();
      return;
    }
    opts.onSave(next);
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
      save();
    }
  }

  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) close();
  });
  cancelBtn.addEventListener("click", close);
  saveBtn.addEventListener("click", save);
  document.addEventListener("keydown", onKeyDown, true);

  if (rows.length) {
    rows[0].input.focus();
    rows[0].input.select();
  }

  return { close };
}
