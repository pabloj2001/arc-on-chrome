// Renders the keyword-shortcut pill and keeps the input placeholder in sync.
export function renderPill({ pill, input, activeShortcut, commandState, opensInCurrentTab }) {
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
