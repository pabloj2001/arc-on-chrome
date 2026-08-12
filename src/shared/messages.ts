// The message wire protocol between the content script and the service worker.
// One source of truth for the type strings so the two bundles can't drift.
// A full typed REQUEST/RESPONSE union + validators lands in a later phase (§7);
// for now this freezes the existing string constants.

export const MSG = {
  // content -> content (broadcast to open bars to toggle/open)
  TOGGLE_ARC_SEARCH: "TOGGLE_ARC_SEARCH",
  // content -> worker
  SEARCH_SUBMIT: "ARC_SEARCH_SUBMIT",
  OPEN_FAVORITE: "ARC_OPEN_FAVORITE",
  ACTIVATE_TAB: "ARC_ACTIVATE_TAB",
  SET_GROUP: "ARC_SET_GROUP",
  CLEAR_GROUP: "ARC_CLEAR_GROUP",
  SWITCH_GROUP: "ARC_SWITCH_GROUP",
  DELETE_GROUP: "ARC_DELETE_GROUP",
  GET_INDEX: "ARC_GET_INDEX",
  RELOAD_EXTENSION: "ARC_RELOAD_EXTENSION",
} as const;

export type MessageType = (typeof MSG)[keyof typeof MSG];
