// Numbered row of open groups above the bar: a "Default" chip (1) on the left,
// then each open tab group, then a "+" chip. Clicks dispatch via the
// onDefault/onSwitch/onAdd callbacks.
import { groupHex, groupTextColor } from "../../shared/colors";
import type { GroupInfo } from "./types";

interface Deps { el: HTMLElement | null; groups: GroupInfo[]; activeGroup: GroupInfo | null; onDefault: () => void; onSwitch: (groupId: number) => void; onAdd: () => void; }
export function renderGroupsRow({ el, groups, activeGroup, onDefault, onSwitch, onAdd }: Deps) {
  if (!el) return;
  el.textContent = "";
  if (!groups.length) {
    el.style.display = "none";
    return;
  }
  el.style.display = "flex";

  // With 3+ groups (besides Default) the row gets crowded, so collapse it: only
  // the active chip shows its name; every other chip shows just its number.
  const collapse = groups.length >= 3;

  // Default (no group) chip, number 1.
  const def = document.createElement("button");
  def.className = "ctx-chip ctx-default" + (!activeGroup ? " active" : "");
  def.title = "Default space (Ctrl+1)";
  const dnum = document.createElement("span");
  dnum.className = "ctx-num";
  dnum.textContent = "1";
  def.appendChild(dnum);
  if (!collapse || !activeGroup) {
    const dnm = document.createElement("span");
    dnm.className = "ctx-cname";
    dnm.textContent = "Default";
    def.appendChild(dnm);
  }
  def.addEventListener("click", onDefault);
  el.appendChild(def);

  groups.forEach((c: GroupInfo, i: number) => {
    const hex = groupHex(c.color);
    const isActive = !!activeGroup && activeGroup.groupId === c.groupId;
    const chip = document.createElement("button");
    chip.className = "ctx-chip" + (isActive ? " active" : "");
    chip.style.background = hex;
    chip.style.color = groupTextColor();
    chip.title = `Switch to "${c.name}" (Ctrl+${i + 2})`;
    const num = document.createElement("span");
    num.className = "ctx-num";
    num.textContent = String(i + 2);
    chip.appendChild(num);
    if (!collapse || isActive) {
      const nm = document.createElement("span");
      nm.className = "ctx-cname";
      nm.textContent = c.name;
      chip.appendChild(nm);
    }
    chip.addEventListener("click", () => onSwitch(c.groupId));
    el.appendChild(chip);
  });

  // "+" chip to create a new group from the current tab.
  const add = document.createElement("button");
  add.className = "ctx-chip ctx-add";
  add.title = "New group (Ctrl++)";
  add.textContent = "+";
  add.addEventListener("click", onAdd);
  el.appendChild(add);
}
