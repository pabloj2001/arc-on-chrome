// @ts-nocheck
// Service-worker entry. ALL listeners are registered synchronously at module
// top (before any await) so an MV3 worker restart never misses an early command
// or message. Handler logic lives in the sibling modules.
import { onCommand } from "./commands";
import { onMessage } from "./router";
import { onTabActivated, onAlarm, ensureAlarm, setContext } from "./contexts";

chrome.commands.onCommand.addListener(onCommand);
chrome.runtime.onMessage.addListener(onMessage);
chrome.tabs.onActivated.addListener(onTabActivated);
chrome.alarms.onAlarm.addListener(onAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);
chrome.runtime.onInstalled.addListener(ensureAlarm);
ensureAlarm();

// Test bridge: before bundling, the worker's functions were top-level globals
// that the Playwright harness referenced directly (e.g. `setContext`). esbuild's
// IIFE wrapper hides them, so re-expose the few the harness needs. Harmless in
// production — just a function reference on the worker's global.
self.setContext = setContext;
