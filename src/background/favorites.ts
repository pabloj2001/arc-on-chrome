// Favorite/URL opening: focus a tab that already shows the target, else open it
// (joining the active context group when one is given).
import { parseUrl, tabMatchesFavorite } from "../shared/url";
import { addTabToContext } from "./contexts";

// If a tab already shows the favorite (exact URL preferred, else same-host
// prefix), focus it (and its window); otherwise open the URL in a new tab
// (added to the active context group when one is given).
export function focusOrCreateTab(url, groupId) {
  const fav = parseUrl(url);
  chrome.tabs.query({}, (tabs) => {
    const parsed = tabs
      .filter((t) => t.url)
      .map((t) => ({ tab: t, u: parseUrl(t.url) }))
      .filter((x) => tabMatchesFavorite(fav, x.u));
    // Prefer an exact path+query match, otherwise the first host/prefix match.
    const exact = parsed.find(
      (x) => fav && x.u.path === fav.path && x.u.search === fav.search
    );
    const match = (exact || parsed[0]) && (exact || parsed[0]).tab;
    if (match && match.id != null) {
      chrome.tabs.update(match.id, { active: true });
      if (match.windowId != null) {
        chrome.windows.update(match.windowId, { focused: true });
      }
    } else {
      chrome.tabs.create({ url }, (tab) => addTabToContext(tab, groupId));
    }
  });
}
