// Service-worker entry. ALL listeners are registered synchronously at module
// top (before any await) so an MV3 worker restart never misses an early command
// or message. Handler logic lives in the sibling modules.
import { onCommand } from "./commands";
import { onMessage } from "./router";
import { onFavoritesChanged } from "./favorites";
import { onAlarm, ensureAlarm, createGroup, onTabCreated, onWindowFocusChanged } from "./groups";

chrome.commands.onCommand.addListener(onCommand);
chrome.runtime.onMessage.addListener(onMessage);
chrome.alarms.onAlarm.addListener(onAlarm);
chrome.tabs.onCreated.addListener(onTabCreated);
chrome.windows.onFocusChanged.addListener(onWindowFocusChanged);
chrome.storage.onChanged.addListener(onFavoritesChanged);
chrome.runtime.onStartup.addListener(ensureAlarm);
chrome.runtime.onInstalled.addListener(ensureAlarm);
ensureAlarm();

// Test bridge: before bundling, the worker's functions were top-level globals
// that the Playwright harness referenced directly (e.g. `createGroup`). esbuild's
// IIFE wrapper hides them, so re-expose the few the harness needs. Harmless in
// production — just function references on the worker's global.
Object.assign(self as unknown as Record<string, unknown>, {
  createGroup,
  onWindowFocusChanged,
});
