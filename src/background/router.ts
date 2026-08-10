// Routes chrome.runtime messages from the content script to the right handler.
// Returns true for handlers that reply asynchronously (keeps the channel open).
import { MSG } from "../shared/messages";
import { focusOrCreateTab } from "./favorites";
import { getIndex } from "./index-builder";
import {
  addTabToGroup, createGroup, clearActiveGroup, switchGroup, deleteGroup,
} from "./groups";

export function onMessage(message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) {
  if (!message) return;
  switch (message.type) {
    case MSG.SEARCH_SUBMIT:
      if (message.url) {
        chrome.tabs.create({ url: message.url }, (tab) => {
          addTabToGroup(tab, message.groupId);
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
  }
}
