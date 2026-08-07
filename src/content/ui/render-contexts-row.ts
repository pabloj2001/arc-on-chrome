// Numbered row of contexts above the bar: a "Default" chip (1) on the left, then
// each tracked context, then a "+" chip (hidden at the limit). Clicks dispatch
// via the onDefault/onSwitch/onAdd callbacks.
import { groupHex, groupTextColor } from "../../shared/colors";
import { MAX_CONTEXTS } from "../../shared/constants";

export function renderContextsRow({ el, contexts, activeContext, onDefault, onSwitch, onAdd }) {
  if (!el) return;
  el.textContent = "";
  if (!contexts.length) {
    el.style.display = "none";
    return;
  }
  el.style.display = "flex";

  // Default (no context) chip, number 1.
  const def = document.createElement("button");
  def.className = "ctx-chip ctx-default" + (!activeContext ? " active" : "");
  def.title = "Default space (Ctrl+1)";
  const dnum = document.createElement("span");
  dnum.className = "ctx-num";
  dnum.textContent = "1";
  const dnm = document.createElement("span");
  dnm.className = "ctx-cname";
  dnm.textContent = "Default";
  def.appendChild(dnum);
  def.appendChild(dnm);
  def.addEventListener("click", onDefault);
  el.appendChild(def);

  contexts.forEach((c, i) => {
    const hex = groupHex(c.color);
    const chip = document.createElement("button");
    chip.className =
      "ctx-chip" +
      (activeContext && activeContext.groupId === c.groupId ? " active" : "");
    chip.style.background = hex;
    chip.style.color = groupTextColor();
    chip.title = `Switch to "${c.name}" (Ctrl+${i + 2})`;
    const num = document.createElement("span");
    num.className = "ctx-num";
    num.textContent = String(i + 2);
    const nm = document.createElement("span");
    nm.className = "ctx-cname";
    nm.textContent = c.name;
    chip.appendChild(num);
    chip.appendChild(nm);
    chip.addEventListener("click", () => onSwitch(c.groupId));
    el.appendChild(chip);
  });

  // "+" chip to create a new context (hidden at the 5-context limit).
  if (contexts.length < MAX_CONTEXTS) {
    const add = document.createElement("button");
    add.className = "ctx-chip ctx-add";
    add.title = "New context (Ctrl++)";
    add.textContent = "+";
    add.addEventListener("click", onAdd);
    el.appendChild(add);
  }
}
