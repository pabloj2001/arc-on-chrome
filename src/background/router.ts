// Routes chrome.runtime messages from the content script to the right handler.
// Returns true for handlers that reply asynchronously (keeps the channel open).
import { MSG } from "../shared/messages";
import { isSafeNavigationUrl } from "../shared/url";
import { getSettings } from "../shared/settings";
import { focusOrCreateTab, focusFavoriteByIndex } from "./favorites";
import { getIndex } from "./index-builder";
import {
  openManagedTab, createGroup, clearActiveGroup, switchGroup, deleteGroup,
} from "./groups";

export function onMessage(message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) {
  if (!message) return;
  switch (message.type) {
    case MSG.SEARCH_SUBMIT:
      if (message.url && isSafeNavigationUrl(message.url)) {
        // Managed create: exempt from the external-open grouper and placed in
        // the bar's chosen group (message.groupId), or the default space when none.
        openManagedTab({ url: message.url }, message.groupId);
      }
      break;
    case MSG.OPEN_FAVORITE:
      if (message.url && isSafeNavigationUrl(message.url)) {
        // With pinning on, favorites live as pinned tabs aligned to the favorite
        // slots — focus the Nth pinned tab by position (its URL may have drifted),
        // falling back to URL match/create. With pinning off, open a new tab.
        getSettings().then((s) => {
          if (!s.pinFavorites) {
            openManagedTab({ url: message.url }, message.groupId);
          } else if (typeof message.index === "number") {
            const winId = sender.tab ? sender.tab.windowId : undefined;
            focusFavoriteByIndex(message.index, message.url, winId, message.groupId, {
              enabled: s.resetStaleFavorites,
              staleMs: s.staleFavoriteMs,
            });
          } else {
            focusOrCreateTab(message.url, message.groupId);
          }
        });
      }
      break;
    case MSG.ACTIVATE_TAB:
      if (message.tabId != null) {
        chrome.tabs.update(message.tabId, { active: true });
        if (message.windowId != null) {
          chrome.windows.update(message.windowId, { focused: true });
        }
      }
      break;
    case MSG.SET_GROUP:
      createGroup(sender, message.name, sendResponse);
      return true;
    case MSG.CLEAR_GROUP:
      clearActiveGroup(sendResponse);
      return true;
    case MSG.SWITCH_GROUP:
      switchGroup(message.groupId, sendResponse);
      return true;
    case MSG.DELETE_GROUP:
      deleteGroup(message.name, sendResponse);
      return true;
    case MSG.GET_INDEX:
      getIndex(sender, sendResponse);
      return true; // keep the message channel open for the async response
    case MSG.RELOAD_EXTENSION:
      chrome.runtime.reload();
      break;
  }
}
