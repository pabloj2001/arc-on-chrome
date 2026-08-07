// Renders the results list below the bar. Rows carry data-type for tests and
// dispatch onChoose (click) / onHover (mousemove) back to the caller.
import { faviconUrl } from "../../shared/url";

const SEARCH_ICON =
  '<circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>';

const TAG_LABEL = {
  tab: "Open tab",
  command: "Command",
  domain: "Website",
  search: "Search",
};

export function renderResults({ el, items, activeIndex, onChoose, onHover }) {
  if (!el) return;
  el.textContent = "";
  if (!items.length) {
    el.style.display = "none";
    return;
  }
  el.style.display = "block";
  items.forEach((r, i) => {
    const row = document.createElement("div");
    row.className = "result" + (i === activeIndex ? " active" : "");
    row.dataset.type = r.type;

    if (r.type === "command") {
      const ic = document.createElement("div");
      ic.className = "result-ic";
      ic.textContent = "/";
      row.appendChild(ic);
    } else if (r.type === "search") {
      const ic = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      ic.setAttribute("class", "result-ic-svg");
      ic.setAttribute("viewBox", "0 0 24 24");
      ic.setAttribute("fill", "none");
      ic.setAttribute("stroke", "currentColor");
      ic.setAttribute("stroke-width", "2");
      ic.setAttribute("stroke-linecap", "round");
      ic.innerHTML = SEARCH_ICON;
      row.appendChild(ic);
    } else {
      const img = document.createElement("img");
      img.src = faviconUrl(r.url);
      img.alt = "";
      img.addEventListener("error", () => {
        img.style.visibility = "hidden";
      });
      row.appendChild(img);
    }

    const meta = document.createElement("div");
    meta.className = "meta";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent =
      r.type === "command" || r.type === "search" ? r.title : r.title || r.url;
    const url = document.createElement("div");
    url.className = "url";
    url.textContent =
      r.type === "command"
        ? r.subtitle
        : r.type === "search"
        ? r.engineLabel || "Google Search"
        : r.url;
    meta.appendChild(title);
    meta.appendChild(url);

    const tag = document.createElement("div");
    tag.className = "tag";
    tag.textContent = TAG_LABEL[r.type] || "History";

    row.appendChild(meta);
    row.appendChild(tag);
    row.addEventListener("click", () => onChoose(i));
    row.addEventListener("mousemove", () => onHover(i));
    el.appendChild(row);
  });
}
