// The post office's picture frame and old computer (image_make). Run from the repository's root:
//   scripts/env.sh node examples/mountain-post/tools/art-office.mjs
// The frame on the back wall shows how many parcels are still to deliver. scenes/office.lua draws its numerals as billboards lying on the
// wall (nova.billboard with `face`): a numeral is one picture, so it is as crisp as the picture is big, it lies in the wall's plane and
// foreshortens with the fixed view like paint on the wall, and it needs no second font size. (A screen label would stay sharp too but
// would not lie in the wall.) Big friendly numerals in the UI kit's ink; the caption is small, in the frame's own wood. The computer's
// screen is a green glow with a few lines of words.
import { tool } from "./lib.mjs";

const img = (name, size, shapes) => tool("image_make", { name, size, shapes }, { quiet: true }) && console.log(`made sprites/${name}.png`);

for (let n = 0; n <= 9; n++) {
  img(`fx/tally_${n}`, [160, 224], [
    { text: String(n), at: [80, 176], size: 230, font: "rounded", align: "center", fill: "#3e3631", stroke: { color: "#3e3631", width: 10 } },
  ]);
}
img("fx/tally_caption", [320, 72], [
  { text: "To deliver", at: [160, 52], size: 52, font: "rounded", align: "center", fill: "#86583c", stroke: { color: "#86583c", width: 2.5 } },
]);
img("fx/crt_screen", [256, 192], [
  { rect: [0, 0, 256, 192], fill: "#2f5a3e" },
  { rect: [0, 0, 256, 192], fill: { radial: [128, 96, 150], stops: [[0, "#9be39a55"], [1, "#9be39a00"]] } },
  { text: "FERNHOLLOW", at: [128, 64], size: 38, font: "rounded", align: "center", fill: "#c6f5b0", stroke: { color: "#c6f5b0", width: 1.5 } },
  { text: "POST", at: [128, 104], size: 38, font: "rounded", align: "center", fill: "#c6f5b0", stroke: { color: "#c6f5b0", width: 1.5 } },
  { line: [[40, 126], [216, 126]], width: 3, fill: "#c6f5b0", opacity: 0.6, cap: "round" },
  { line: [[40, 146], [170, 146]], width: 3, fill: "#c6f5b0", opacity: 0.45, cap: "round" },
  { rect: [40, 160, 14, 10], fill: "#c6f5b0" },
]);
