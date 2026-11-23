// The game's one UI theme (docs/games/mountain-post.md, "UI theme"): a few pieces of Kenney's "UI Pack" 2.0 (CC0; the grey set,
// drawn at twice the size: PNG/Grey/Double and PNG/Extra/Double), recoloured into the toy palette (tools/palette.mjs) by a
// gradient map: each grey of the pack's four (the dark under-edge, the outline, the face, the highlight line) becomes a colour of
// ours, and the anti-aliased greys between them blend between those. Only the pieces below are copied into the game
// (sprites/ui/kit/), and lib/ui.lua draws every panel, chip, button, tab and card from them.
//
// Run from the repository's root, with the pack's folder (unpacked, untouched) as the argument:
//   scripts/env.sh node examples/mountain-post/tools/ui-kit.mjs /path/to/kenney-ui
// The pack's licence (CC0) and the list of the files used are licenses/kenney-ui-pack.txt (and the game's own licenses/).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readPng, writePng } from "../../../scripts/pnglib.mjs";
import { GAME } from "./lib.mjs";
import { PAL } from "./palette.mjs";

const PACK = process.argv[2];
if (!PACK || !existsSync(join(PACK, "PNG/Grey/Double"))) {
  console.error("usage: scripts/env.sh node examples/mountain-post/tools/ui-kit.mjs /path/to/kenney-ui   (the UI Pack 2.0 folder)");
  process.exit(1);
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const grey = (v) => [v, v, v];

// The pack's greys (measured: every grey piece is drawn in these four, anti-aliased between them).
const DEPTH = 103, EDGE = 154, FACE = 220, LIGHT = 255;

/// Recolours one picture of the pack: `stops` maps each of the pack's greys (by brightness) to a colour, straight lines between.
function recolour(src, out, stops) {
  const im = readPng(join(PACK, src));
  const keys = Object.keys(stops).map(Number).sort((a, b) => a - b);
  const at = (l) => {
    if (l <= keys[0]) return stops[keys[0]];
    for (let i = 1; i < keys.length; i++) {
      if (l <= keys[i]) {
        const a = keys[i - 1], b = keys[i], t = (l - a) / (b - a);
        return stops[a].map((v, k) => v + (stops[b][k] - v) * t);
      }
    }
    return stops[keys.at(-1)];
  };
  const d = im.data;
  for (let i = 0; i < im.w * im.h; i++) {
    if (d[i * 4 + 3] === 0) continue;
    const l = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    const c = at(l);
    d[i * 4] = Math.round(c[0]); d[i * 4 + 1] = Math.round(c[1]); d[i * 4 + 2] = Math.round(c[2]);
  }
  writePng(join(GAME, "sprites/ui/kit", out), im.w, im.h, d);
  console.log(`sprites/ui/kit/${out}  <- ${src} (${im.w}x${im.h})`);
}

// The paper panel: cream paper on a wooden frame with a darker wooden foot (every panel, card, the dialogue box, the pause menu).
recolour("PNG/Grey/Double/button_rectangle_depth_flat.png", "panel.png", {
  [DEPTH]: hex("#6f4a31"), [EDGE]: hex("#9a6a44"), [FACE]: hex(PAL.cream), [LIGHT]: hex("#fff8ea"),
});
// ... and held down (a paper key pressed: the flat shape, no foot).
recolour("PNG/Grey/Double/button_rectangle_flat.png", "panel_down.png", {
  [EDGE]: hex("#9a6a44"), [FACE]: hex("#eadcb9"), [LIGHT]: hex("#fff8ea"),
});
// The same shape in neutral greys, tinted by the game (`color` multiplies): buttons, chips, name tags, the title strip, the L1/R1
// tabs. "raised" has its foot (a key at rest); "pressed" is the flat one, drawn lower by the foot's height (a key held down).
const NEUTRAL = { [DEPTH]: grey(128), [EDGE]: grey(170), [FACE]: grey(232), [LIGHT]: grey(255) };
recolour("PNG/Grey/Double/button_rectangle_depth_flat.png", "raised.png", NEUTRAL);
recolour("PNG/Grey/Double/button_rectangle_flat.png", "pressed.png", NEUTRAL);
// The round cap of a face button (A, B, X, Y), tinted in the pad's colours.
recolour("PNG/Grey/Double/button_round_depth_flat.png", "round.png", NEUTRAL);
recolour("PNG/Grey/Double/button_round_flat.png", "round_down.png", NEUTRAL);
// A parcel's label: a white slip with the post's red double edge (the label card, the van's panel, the corner card).
recolour("PNG/Extra/Double/input_outline_rectangle.png", "slip.png", {
  [EDGE]: hex(PAL.red), [FACE]: hex("#f1d8c8"), [LIGHT]: hex("#fffaf0"),
});
// A rule under a title: a wooden groove with a light edge.
recolour("PNG/Extra/Double/divider_edges.png", "rule.png", { [EDGE]: hex("#9a6a44"), [LIGHT]: hex("#fff4de") });
// The little chevrons beside L1 and R1 ("go round"), tinted like the tabs.
recolour("PNG/Grey/Double/arrow_basic_w_small.png", "chev_l.png", NEUTRAL);
recolour("PNG/Grey/Double/arrow_basic_e_small.png", "chev_r.png", NEUTRAL);
