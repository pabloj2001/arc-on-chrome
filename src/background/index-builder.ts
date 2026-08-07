// Builds the small index the bar searches: currently-open tabs plus the last
// 7 days of history (capped). Only http(s) pages are included.
import { WEB_URL } from "../shared/constants";
import { getContextState } from "./contexts";

export function getIndex(sender, sendResponse) {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
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
      { text: "", startTime: weekAgo, maxResults: 500 },
      (items) => {
        const history = (items || [])
          .filter((h) => h.url && WEB_URL.test(h.url))
          .map((h) => ({
            title: h.title || h.url,
            url: h.url,
            lastVisitTime: h.lastVisitTime || 0,
            visitCount: h.visitCount || 1,
          }));
        getContextState((state) => {
          sendResponse({
            currentTabId: sender.tab && sender.tab.id,
            currentTabGroupId:
              sender.tab && sender.tab.groupId != null
                ? sender.tab.groupId
                : -1,
            tabs: openTabs,
            history,
            activeContext: state.activeContext, // { groupId, name, color } or null
            contexts: state.contexts, // [{ groupId, name, color }]
          });
        });
      }
    );
  });
}
