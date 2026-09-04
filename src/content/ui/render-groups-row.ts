// Numbered row of open groups above the bar: a small "Ctrl +" hint, a "Default"
// chip (1), each open tab group, then a "+" chip. Clicks dispatch via the
// onDefault/onSwitch/onAdd callbacks.
//
// Chip elements are reconciled IN PLACE across renders (cached on the row by a
// stable key) rather than rebuilt, so toggling the `.active` class animates via
// CSS — the collapsed name slides open when a chip is selected and closes when
// it's deselected (including via Ctrl+N).
import { groupHex, groupTextColor } from "../../shared/colors";
import type { GroupInfo } from "./types";

interface Deps { el: HTMLElement | null; groups: GroupInfo[]; activeGroup: GroupInfo | null; onDefault: () => void; onSwitch: (groupId: number) => void; onAdd: () => void; }

type Clickable = HTMLElement & { _onClick?: () => void };
type RowEl = HTMLElement & { _chipCache?: Map<string, HTMLElement> };

export function renderGroupsRow({ el, groups, activeGroup, onDefault, onSwitch, onAdd }: Deps) {
  if (!el) return;
  const row = el as RowEl;
  if (!groups.length) {
    row.style.display = "none";
    row.textContent = "";
    row._chipCache = new Map();
    return;
  }
  row.style.display = "flex";
  // With 3+ groups (besides Default) the row gets crowded, so collapse it: only
  // the active chip shows its name; the rest show just their number and slide the
  // name open on hover / when selected (see the .ctx-collapsed rules in bar.css).
  row.classList.toggle("ctx-collapsed", groups.length >= 3);

  const cache = row._chipCache || new Map<string, HTMLElement>();
  row._chipCache = cache;
  const order: string[] = [];
  const used = new Set<string>();

  const ensure = (key: string, make: () => HTMLElement): HTMLElement => {
    let node = cache.get(key);
    if (!node) {
      node = make();
      cache.set(key, node);
    }
    used.add(key);
    order.push(key);
    return node;
  };

  // A chip button with a number badge + a name span and a delegated click that
  // calls the latest handler stored on the element.
  const makeChip = (): Clickable => {
    const chip = document.createElement("button") as Clickable;
    const num = document.createElement("span");
    num.className = "ctx-num";
    const nm = document.createElement("span");
    nm.className = "ctx-cname";
    chip.appendChild(num);
    chip.appendChild(nm);
    chip.addEventListener("click", () => chip._onClick && chip._onClick());
    return chip;
  };
  const setNum = (chip: HTMLElement, s: string) => {
    (chip.querySelector(".ctx-num") as HTMLElement).textContent = s;
  };
  const setName = (chip: HTMLElement, s: string) => {
    (chip.querySelector(".ctx-cname") as HTMLElement).textContent = s;
  };

  // "Ctrl +" hint, nudging the keyboard shortcut (Ctrl+1 default, Ctrl+2 ...).
  ensure("hint", () => {
    const s = document.createElement("span");
    s.className = "ctx-hint";
    s.textContent = "Ctrl +";
    return s;
  });

  // Default (no group) chip, number 1.
  const def = ensure("default", makeChip) as Clickable;
  def.className = "ctx-chip ctx-default" + (!activeGroup ? " active" : "");
  def.title = "Default space (Ctrl+1)";
  setNum(def, "1");
  setName(def, "Default");
  def._onClick = onDefault;

  groups.forEach((c: GroupInfo, i: number) => {
    const chip = ensure("g" + c.groupId, makeChip) as Clickable;
    const isActive = !!activeGroup && activeGroup.groupId === c.groupId;
    chip.className = "ctx-chip" + (isActive ? " active" : "");
    chip.style.background = groupHex(c.color);
    chip.style.color = groupTextColor();
    chip.title = `Switch to "${c.name}" (Ctrl+${i + 2})`;
    setNum(chip, String(i + 2));
    setName(chip, c.name);
    chip._onClick = () => onSwitch(c.groupId);
  });

  // "+" chip to create a new group from the current tab.
  const add = ensure("add", () => {
    const b = document.createElement("button") as Clickable;
    b.className = "ctx-chip ctx-add";
    b.title = "New group (Ctrl++)";
    b.textContent = "+";
    b.addEventListener("click", () => b._onClick && b._onClick());
    return b;
  }) as Clickable;
  add._onClick = onAdd;

  // Order the nodes, moving ONLY those whose position actually changed — moving a
  // node detaches/reattaches it and would reset its CSS transition, which is why
  // selecting a chip (Ctrl+N/click) wouldn't animate. Untouched nodes keep their
  // transition, so toggling .active slides the name open/closed.
  order.forEach((key, i) => {
    const node = cache.get(key) as HTMLElement;
    if (row.children[i] !== node) row.insertBefore(node, row.children[i] || null);
  });
  // Drop any chips whose group went away.
  for (const key of Array.from(cache.keys())) {
    if (!used.has(key)) {
      const node = cache.get(key);
      if (node && node.parentNode) node.parentNode.removeChild(node);
      cache.delete(key);
    }
  }
}
