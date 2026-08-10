// Tints the bar (border/icon/background) for the active group, or clears it.
// The caller passes the *resolved* active group (null while temporarily exited)
// and owns the status line.
import { groupHex, tintBg } from "../../shared/colors";
import type { GroupInfo } from "./types";

interface Deps { bar: HTMLElement | null; icon: SVGElement | null; activeGroup: GroupInfo | null; iconSearch: string; iconBack: string; }
export function renderGroup({ bar, icon, activeGroup, iconSearch, iconBack }: Deps) {
  if (!bar) return;
  if (activeGroup) {
    const hex = groupHex(activeGroup.color);
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
