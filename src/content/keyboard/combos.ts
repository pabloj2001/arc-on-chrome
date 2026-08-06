// @ts-nocheck
// Pure key-combo predicates for the bar's global shortcuts.

// Cmd/Ctrl+T (no Alt/Shift) — toggle the search bar.
export function isToggleCombo(e) {
  return (
    (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey &&
    e.key.toLowerCase() === "t"
  );
}

// Cmd/Ctrl+L (no Alt/Shift) — open the bar to edit the current URL.
export function isUrlCombo(e) {
  return (
    (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey &&
    e.key.toLowerCase() === "l"
  );
}
