// Renders the keyword-shortcut pill and keeps the input placeholder in sync.
// The pill shows the shortcut's site icon followed by its name (the alias is
// what you type to arm it; the name is the friendly label).
interface Deps {
  pill: HTMLElement | null;
  input: HTMLInputElement;
  activeShortcut: string | null;
  shortcutName?: string | null;
  shortcutIcon?: string | null;
  commandState: unknown | null;
  opensInCurrentTab: boolean;
}
export function renderPill({
  pill,
  input,
  activeShortcut,
  shortcutName,
  shortcutIcon,
  commandState,
  opensInCurrentTab,
}: Deps) {
  if (!pill) return;
  if (activeShortcut) {
    const label = shortcutName || activeShortcut;
    pill.textContent = "";
    if (shortcutIcon) {
      const img = document.createElement("img");
      img.className = "pill-icon";
      img.src = shortcutIcon;
      img.alt = "";
      // A broken/absent favicon shouldn't leave a gap.
      img.addEventListener("error", () => img.remove());
      pill.appendChild(img);
    }
    const text = document.createElement("span");
    text.className = "pill-label";
    text.textContent = label;
    pill.appendChild(text);
    pill.style.display = "inline-flex";
    input.placeholder = `Search "${label}"…`;
  } else {
    pill.textContent = "";
    pill.style.display = "none";
    if (!commandState) {
      input.placeholder = opensInCurrentTab
        ? "Edit URL or search…"
        : "Search or enter address…";
    }
  }
}
