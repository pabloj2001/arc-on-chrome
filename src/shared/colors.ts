// Tab-group color helpers (content-side; the worker only deals in color names).
// The tabGroups API exposes color NAMES only, so we map them to the hexes Edge
// renders (sampled from Edge's Fluent palette) to match the tab-strip chip.

// Light mode.
export const GROUP_COLOR_HEX = {
  grey: "#706d6b", blue: "#296eeb", cyan: "#038387", yellow: "#99700c",
  orange: "#ca5010", pink: "#e3008c", purple: "#8230ff",
  // Not in the rotation (Edge has no true red/green); best-effort so any
  // pre-existing group of these names still shows an Edge palette color.
  red: "#c239b3", green: "#004e8c",
};

// Dark-mode tints (approximate; refined once sampled on a dark tab strip).
export const GROUP_COLOR_HEX_DARK = {
  grey: "#c8c6c4", blue: "#7aa5f5", cyan: "#4bb6ba", yellow: "#d9b12a",
  orange: "#e8895a", pink: "#ff5aa8", purple: "#b48aff",
  red: "#d873c9", green: "#4a86bf",
};

export function isDarkScheme() {
  return (
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function groupHex(color) {
  const map = isDarkScheme() ? GROUP_COLOR_HEX_DARK : GROUP_COLOR_HEX;
  return map[color] || (isDarkScheme() ? "#c8d3ff" : "#325ccd");
}

// Readable text color for a group-colored pill (dark text on the light dark-mode
// tints, white on the saturated light-mode colors).
export function groupTextColor() {
  return isDarkScheme() ? "#202124" : "#fff";
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// A very faint version of the context color for the bar background, layered over
// the bar's near-opaque surface so it stays readable in both modes.
export function tintBg(hex) {
  const dark = isDarkScheme();
  const base = dark ? "rgba(30,30,33,0.98)" : "rgba(250,250,252,0.98)";
  const rgb = hexToRgb(hex);
  if (!rgb) return base;
  const a = dark ? 0.14 : 0.08;
  return `linear-gradient(rgba(${rgb.r},${rgb.g},${rgb.b},${a}), rgba(${rgb.r},${rgb.g},${rgb.b},${a})), ${base}`;
}
