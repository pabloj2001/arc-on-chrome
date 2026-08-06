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
  SET_CONTEXT: "ARC_SET_CONTEXT",
  CLEAR_CONTEXT: "ARC_CLEAR_CONTEXT",
  SWITCH_CONTEXT: "ARC_SWITCH_CONTEXT",
  DELETE_CONTEXT: "ARC_DELETE_CONTEXT",
  GET_INDEX: "ARC_GET_INDEX",
} as const;

export type MessageType = (typeof MSG)[keyof typeof MSG];
