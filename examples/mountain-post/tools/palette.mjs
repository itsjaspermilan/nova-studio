// Fernhollow's one look, "a soft toy diorama" (docs/games/mountain-post.md, "One look"): every non-character model the recipes in
// this folder make takes its colours from PAL and its edges from `soft`, so the van, the cabins, the trees and the signs read as
// one set of toys and not as an asset dump.
//
// The rule, in short: everything rounded and chunky, like painted wooden or felt toys; details are flat paint (a stripe, a
// window, a number) rather than fiddly geometry; nothing thinner than about 6 cm; proportions a little squat and generous, never
// realistic; one small warm palette, a little muted, no pure black or white; a dark is a warm brown-grey (`ink`).

export const PAL = {
  // paint and paper
  cream: "#f3e6c8", paper: "#f6eedb", white: "#f4eee2", red: "#c94a3b", redDark: "#a23c31", mustard: "#e2b04a", rose: "#d98b78",
  lilac: "#b8a6d4", sky: "#8fb6c9", teal: "#5f9a92",
  // the post van's soft mail blue (a friendly periwinkle, not a navy) and its deeper tone
  mailBlue: "#6f8fd0", mailBlueDeep: "#56719f",
  // glass: a window by day is a soft blue-grey; a lit one is warm
  glass: "#5a7d8f", lit: "#ffe0a0",
  // wood, logs and stone
  woodLight: "#d8a670", wood: "#b97c4f", woodDark: "#86583c", log: "#97633f", trunk: "#7c5338",
  stone: "#aca394", stoneDark: "#8c8478",
  // roofs
  slate: "#677c6c", roofRed: "#b5503f",
  // greens, from deep pine to bright larch
  pine: "#4d7f50", pineDeep: "#3f6c46", leaf: "#6f9f52", moss: "#8aa955", larch: "#a2c168", grass: "#86ab52",
  // the darks and the greys: never black
  ink: "#3e3631", tyre: "#3b3532", metal: "#b5b2aa",
};

/// The soft edge for a box of this size (metres): a quarter of its thinnest side, at least 1.5 cm and at most 14 cm, so a plank is
/// as rounded as a toy brick and a wall's corner as soft as a block.
export function soft(size) {
  const t = Math.min(...size);
  return Math.max(0.015, Math.min(0.14, t * 0.25));
}

/// A colour a little lighter (k > 0) or darker (k < 0): shade variations stay inside the palette's family.
export { shade } from "./geo.mjs";
