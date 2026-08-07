// Renders the command pill + a pill for every param. CRITICAL: the `input` is a
// single stable DOM node that is *moved* into the active param slot and restored
// to `inputWrap` when command mode ends — never recreated. The caller supplies
// the width/pill/ghost effects and the jump-to-param handler.
interface Deps {
  cmdChips: HTMLElement | null;
  inputWrap: HTMLElement | null;
  input: HTMLInputElement;
  ghost: HTMLElement | null;
  commandState: import("./types").CommandState | null;
  onRenderPill: () => void;
  onUpdateWidth: () => void;
  onJumpToParam: (i: number) => void;
  onRenderGhost: () => void;
}
export function renderCommandChips({
  cmdChips, inputWrap, input, ghost, commandState,
  onRenderPill, onUpdateWidth, onJumpToParam, onRenderGhost,
}: Deps) {
  if (!cmdChips) return;
  // Detach the input before clearing so we don't destroy it, then re-place it.
  if (inputWrap) inputWrap.appendChild(input);
  cmdChips.textContent = "";

  if (!commandState) {
    cmdChips.style.display = "none";
    input.classList.remove("param-active");
    input.style.width = "";
    onRenderPill();
    return;
  }
  cmdChips.style.display = "inline-flex";

  const cp = document.createElement("span");
  cp.className = "cmd-pill";
  cp.textContent = "/" + commandState.name;
  cmdChips.appendChild(cp);

  for (let i = 0; i < commandState.params.length; i++) {
    const invalid = commandState.invalid && commandState.invalid.has(i);
    if (i === commandState.index) {
      const wrap = document.createElement("span");
      wrap.className = "param-pill active" + (invalid ? " invalid" : "");
      const lab = document.createElement("span");
      lab.className = "plabel";
      lab.textContent = commandState.params[i].name;
      wrap.appendChild(lab);
      input.placeholder = "";
      input.classList.add("param-active");
      wrap.appendChild(input);
      cmdChips.appendChild(wrap);
      onUpdateWidth();
    } else {
      const value = commandState.values[i];
      const hasVal = value != null && value !== "";
      const pp = document.createElement("span");
      pp.className =
        "param-pill" + (hasVal ? " filled" : " upcoming") + (invalid ? " invalid" : "");
      const lab = document.createElement("span");
      lab.className = "plabel";
      lab.textContent = commandState.params[i].name;
      pp.appendChild(lab);
      if (hasVal) {
        const val = document.createElement("span");
        val.className = "pval";
        val.textContent = value;
        pp.appendChild(val);
      }
      pp.addEventListener("click", () => onJumpToParam(i));
      cmdChips.appendChild(pp);
    }
  }
  if (ghost) onRenderGhost(); // hide any stale ghost while in command mode
  input.focus();
}
