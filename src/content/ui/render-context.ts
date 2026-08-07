// @ts-nocheck
// Tints the bar (border/icon/background) for the active context, or clears it.
// The caller passes the *resolved* active context (null while temporarily
// exited) and owns the status line.
import { groupHex, tintBg } from "../../shared/colors";

export function renderContext({ bar, icon, activeContext, iconSearch, iconBack }) {
  if (!bar) return;
  if (activeContext) {
    const hex = groupHex(activeContext.color);
    bar.style.setProperty("--ctx-color", hex);
    bar.style.background = tintBg(hex);
    if (icon) {
      icon.innerHTML = iconBack; // clickable back arrow -> exit to default
      icon.style.color = hex;
      icon.style.opacity = "1";
      icon.classList.add("clickable");
      icon.setAttribute("aria-label", "Back to default space");
    }
    bar.classList.add("has-context");
  } else {
    bar.style.background = "";
    if (icon) {
      icon.innerHTML = iconSearch;
      icon.style.color = "";
      icon.style.opacity = "";
      icon.classList.remove("clickable");
      icon.removeAttribute("aria-label");
    }
    bar.classList.remove("has-context");
  }
}
