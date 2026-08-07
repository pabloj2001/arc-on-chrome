// Paints the ghost autocomplete overlay: the typed text (transparent, to occupy
// width) followed by the completion `suffix` (faded). The caller computes the
// suffix; this module only draws it.
export function renderGhost({ ghost, input, suffix }) {
  if (!ghost || !input) return;
  if (!suffix) {
    ghost.style.display = "none";
    ghost.textContent = "";
    return;
  }
  ghost.textContent = "";
  const typed = document.createElement("span");
  typed.className = "g-typed";
  typed.textContent = input.value;
  const suf = document.createElement("span");
  suf.className = "g-suffix";
  suf.textContent = suffix;
  ghost.appendChild(typed);
  ghost.appendChild(suf);
  ghost.style.display = "flex";
}
