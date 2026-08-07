// Renders the favicon buttons row. Each filled slot opens its favorite; each
// empty slot shows its number and starts a /favorite command (via onEmpty).
import { FAV_COUNT } from "../../shared/constants";
import { faviconUrl } from "../../shared/url";
import type { Favorite } from "../../shared/types";

interface Deps { favRow: HTMLElement | null; favorites: Favorite[]; onOpen: (i: number) => void; onEmpty: (i: number) => void; }
export function renderFavorites({ favRow, favorites, onOpen, onEmpty }: Deps) {
  if (!favRow) return;
  favRow.textContent = "";
  for (let i = 0; i < FAV_COUNT; i++) {
    const url = favorites[i];
    const btn = document.createElement("button");
    btn.className = "fave" + (url ? "" : " empty");
    btn.title = url
      ? `${i + 1}: ${url}`
      : `Empty — set with /favorite ${i + 1} <url>`;

    if (url) {
      const img = document.createElement("img");
      img.src = faviconUrl(url);
      img.alt = "";
      img.addEventListener("error", () => {
        img.remove();
        btn.textContent = String(i + 1);
      });
      btn.appendChild(img);
    } else {
      btn.textContent = String(i + 1);
    }

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = String(i + 1);
    btn.appendChild(badge);

    btn.addEventListener("click", () => {
      if (url) onOpen(i);
      else onEmpty(i);
    });
    favRow.appendChild(btn);
  }
}
