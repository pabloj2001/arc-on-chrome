// Renders the keyword-shortcut pill and keeps the input placeholder in sync.
interface Deps {
  pill: HTMLElement | null;
  input: HTMLInputElement;
  activeShortcut: string | null;
  commandState: unknown | null;
  opensInCurrentTab: boolean;
}
export function renderPill({ pill, input, activeShortcut, commandState, opensInCurrentTab }: Deps) {
  if (!pill) return;
  if (activeShortcut) {
    pill.textContent = activeShortcut;
    pill.style.display = "inline-flex";
    input.placeholder = `Search "${activeShortcut}"…`;
  } else {
    pill.style.display = "none";
    if (!commandState) {
      input.placeholder = opensInCurrentTab
        ? "Edit URL or search…"
        : "Search or enter address…";
    }
  }
}
