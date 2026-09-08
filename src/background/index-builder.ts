// Builds the small index the bar searches: currently-open tabs plus the last
// 14 days of history (capped). Only http(s) pages are included.
import { WEB_URL } from "../shared/constants";
import { getGroupState } from "./groups";

export function getIndex(sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) {
  const lookbackStart = Date.now() - 14 * 24 * 60 * 60 * 1000;
  chrome.tabs.query({}, (tabs) => {
    const openTabs = tabs
      .filter((t) => t.url && WEB_URL.test(t.url))
      .map((t) => ({
        tabId: t.id,
        windowId: t.windowId,
        title: t.title || t.url,
        url: t.url,
        lastAccessed: t.lastAccessed || 0,
      }))
      // Most recently used tabs first (lastAccessed is when a tab was last active).
      .sort((a, b) => b.lastAccessed - a.lastAccessed);
    chrome.history.search(
      { text: "", startTime: lookbackStart, maxResults: 1000 },
      (items) => {
        const history = (items || [])
          .filter((h) => h.url && WEB_URL.test(h.url))
          .map((h) => ({
            title: h.title || h.url,
            url: h.url,
            lastVisitTime: h.lastVisitTime || 0,
            visitCount: h.visitCount || 1,
          }));
        getGroupState((state) => {
          sendResponse({
            currentTabId: sender.tab && sender.tab.id,
            currentTabGroupId:
              sender.tab && sender.tab.groupId != null
                ? sender.tab.groupId
                : -1,
            tabs: openTabs,
            history,
            activeGroup: state.activeGroup, // { groupId, name, color } or null
            groups: state.groups, // [{ groupId, name, color }]
          });
        });
      }
    );
  });
}
