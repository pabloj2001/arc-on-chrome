// @ts-nocheck
// Routes chrome.runtime messages from the content script to the right handler.
// Returns true for handlers that reply asynchronously (keeps the channel open).
import { MSG } from "../shared/messages";
import { focusOrCreateTab } from "./favorites";
import { getIndex } from "./index-builder";
import {
  addTabToContext, setContext, clearActiveContext, switchContext, deleteContext,
} from "./contexts";

export function onMessage(message, sender, sendResponse) {
  if (!message) return;
  switch (message.type) {
    case MSG.SEARCH_SUBMIT:
      if (message.url) {
        chrome.tabs.create({ url: message.url }, (tab) => {
          addTabToContext(tab, message.groupId);
        });
      }
      break;
    case MSG.OPEN_FAVORITE:
      if (message.url) focusOrCreateTab(message.url, message.groupId);
      break;
    case MSG.ACTIVATE_TAB:
      if (message.tabId != null) {
        chrome.tabs.update(message.tabId, { active: true });
        if (message.windowId != null) {
          chrome.windows.update(message.windowId, { focused: true });
        }
      }
      break;
    case MSG.SET_CONTEXT:
      setContext(sender, message.name, message.expiry, sendResponse);
      return true;
    case MSG.CLEAR_CONTEXT:
      clearActiveContext(sendResponse);
      return true;
    case MSG.SWITCH_CONTEXT:
      switchContext(message.groupId, sendResponse);
      return true;
    case MSG.DELETE_CONTEXT:
      deleteContext(message.name, sendResponse);
      return true;
    case MSG.GET_INDEX:
      getIndex(sender, sendResponse);
      return true; // keep the message channel open for the async response
  }
}
