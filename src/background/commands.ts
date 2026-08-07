// chrome.commands routing. Each command opens the same bar with different
// options; we broadcast a TOGGLE message to the active tab's content script.
import { MSG } from "../shared/messages";

// toggle-search-bar -> empty bar, Enter opens in a NEW tab
// open-url-bar       -> prefilled with the current URL, Enter replaces THIS tab
const COMMAND_OPTIONS = {
  "toggle-search-bar": { opensInCurrentTab: false, useCurrentUrl: false },
  "open-url-bar": { opensInCurrentTab: true, useCurrentUrl: true },
};

export function onCommand(command) {
  const opts = COMMAND_OPTIONS[command];
  if (!opts) return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.id) return;
    chrome.tabs.sendMessage(
      tab.id,
      { type: MSG.TOGGLE_ARC_SEARCH, ...opts },
      () => {
        // Swallow "receiving end does not exist" on pages where the content
        // script can't run (chrome:// pages, the web store, etc.).
        void chrome.runtime.lastError;
      }
    );
  });
}
