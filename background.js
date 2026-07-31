// Each configured command maps to a bar "mode":
//   search -> empty bar, Enter opens the query in a NEW tab
//   url    -> bar prefilled with the current URL, Enter navigates THIS tab
const COMMAND_MODES = {
  "toggle-search-bar": "search",
  "open-url-bar": "url",
};

chrome.commands.onCommand.addListener((command) => {
  const mode = COMMAND_MODES[command];
  if (!mode) return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.id) return;
    chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_ARC_SEARCH", mode }, () => {
      // Swallow "receiving end does not exist" on pages where the content
      // script can't run (chrome:// pages, the web store, etc.).
      void chrome.runtime.lastError;
    });
  });
});

// Opens a query/favorite in a new tab. Done from the background so it works
// even if the originating page blocks window.open.
chrome.runtime.onMessage.addListener((message) => {
  if (!message) return;
  if (message.type === "ARC_SEARCH_SUBMIT" && message.url) {
    chrome.tabs.create({ url: message.url });
  } else if (message.type === "ARC_OPEN_FAVORITE" && message.url) {
    focusOrCreateTab(message.url);
  }
});

// Parses a URL into the parts we compare on: host without a leading "www.",
// path without trailing slashes, and the query string.
function parseUrl(u) {
  try {
    const x = new URL(u);
    return {
      host: x.host.replace(/^www\./i, "").toLowerCase(),
      path: x.pathname.replace(/\/+$/, ""),
      search: x.search,
    };
  } catch (_) {
    return null;
  }
}

// A tab matches a favorite when they share a host and the favorite's path is a
// prefix of the tab's path. This means a bare-domain favorite (e.g.
// gemini.google.com) matches the tab it redirects to (gemini.google.com/app),
// while a favorite with a path only matches tabs under that path.
function tabMatchesFavorite(fav, tab) {
  if (!fav || !tab || fav.host !== tab.host) return false;
  if (fav.path === "" || fav.path === tab.path) return true;
  return tab.path === fav.path || tab.path.startsWith(fav.path + "/");
}

// If a tab already shows the favorite (exact URL preferred, else same-host
// prefix), focus it (and its window); otherwise open the URL in a new tab.
function focusOrCreateTab(url) {
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
      chrome.tabs.create({ url });
    }
  });
}

