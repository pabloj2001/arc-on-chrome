// Builds the bar's DOM (host + shadow root + the single <style>) and returns
// handles to every element the render/logic layers touch. Purely structural —
// no event wiring or state; the entry attaches listeners to these refs.
import STYLES from "./bar.css";
import { ICON_SEARCH } from "./icons";
import { HOST_ID } from "../../shared/constants";

export function mountBar() {
  const host = document.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = STYLES;

  const overlay = document.createElement("div");
  overlay.className = "backdrop";

  const stack = document.createElement("div");
  stack.className = "stack";

  const bar = document.createElement("div");
  bar.className = "bar";

  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("class", "icon");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "2");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.innerHTML = ICON_SEARCH;

  const input = document.createElement("input");
  input.type = "text";
  input.autocapitalize = "off";
  input.autocomplete = "off";
  input.spellcheck = false;

  // Wrap the input so the ghost autocomplete overlay can sit behind it.
  const inputWrap = document.createElement("div");
  inputWrap.className = "input-wrap";
  const ghost = document.createElement("div");
  ghost.className = "ghost";
  ghost.style.display = "none";
  inputWrap.appendChild(ghost);
  inputWrap.appendChild(input);

  const pill = document.createElement("span");
  pill.className = "pill";
  pill.style.display = "none";
  pill.title = "Click or backspace to remove";

  const cmdChips = document.createElement("span");
  cmdChips.className = "cmd-chips";
  cmdChips.style.display = "none";

  const chips = document.createElement("span");
  chips.className = "chips";
  chips.appendChild(pill);
  chips.appendChild(cmdChips);

  const favRow = document.createElement("div");
  favRow.className = "faves";

  const groupsRow = document.createElement("div");
  groupsRow.className = "contexts-row";
  groupsRow.style.display = "none";

  const results = document.createElement("div");
  results.className = "results";
  results.style.display = "none";

  const status = document.createElement("div");
  status.className = "status";

  bar.appendChild(icon);
  bar.appendChild(chips);
  bar.appendChild(inputWrap);
  stack.appendChild(groupsRow);
  stack.appendChild(bar);
  stack.appendChild(favRow);
  stack.appendChild(results);
  stack.appendChild(status);
  overlay.appendChild(stack);
  shadow.appendChild(style);
  shadow.appendChild(overlay);
  document.documentElement.appendChild(host);

  return {
    host, shadow, overlay, stack, bar, icon, input, inputWrap, ghost, pill,
    cmdChips, favRow, groupsRow, results, status,
  };
}
