// The smooth 2D art (image_make): the words on the signposts, the mailboxes' numbers, BRIDGE OUT, the post office's sign, the van's
// lettering, smoke, the minimap's disc, its north mark and the "you" mark, the title. (The paper map is drawn by Nova's map generator:
// tools/map.mjs.) Run from the repository's root: scripts/env.sh node examples/mountain-post/tools/art.mjs [section ...]
// (sections: words, minimap, title, icons; none: all of them)
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO, tool } from "./lib.mjs";
import { PAL } from "./palette.mjs";

const BLUE = "#2f5fa6", RED = "#b9372b";
const img = (name, size, shapes, extra = {}) => tool("image_make", { name, size, shapes, ...extra }, { quiet: true }) && console.log(`made sprites/${name}.png`);
const want = process.argv.slice(2);
const doing = (section) => !want.length || want.includes(section);

// ---- words in the world ------------------------------------------------------------------------------------------------------------------
// The signposts' road names (the owner's fifth play: "The road signs are hard to see from far away"): bold cream capitals on the arms'
// dark panels (tools/models.mjs `SIGN`), 0.36 m high on one line, 0.29 m on the two lines of a long name, drawn at SIGN_PPM texels a metre and
// cropped to the words, so entities/signpost.lua sizes each from its picture. Thick strokes (no hairlines): every stroke is at least
// 4 cm, two texels of the smallest mip level the van sees it at from 60 m, so the words fade with distance and never break up.
export const SIGN_PPM = 300;
const NOVA = process.env.NOVA_BIN ?? join(REPO, "target/release/nova");
function wordsWidth(text, size) {
  const dir = mkdtempSync(join(tmpdir(), "fern-sign-"));
  try {
    return JSON.parse(execFileSync(NOVA, ["glyphs", "rounded", String(size), join(dir, "w.png"), "--text", text], { encoding: "utf8" }).trim().split("\n").pop()).width;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
if (doing("words")) {
  if (!existsSync(NOVA)) throw new Error(`the sign words are measured with the runtime: build it (${NOVA})`);
  // (a long name goes on two lines on the taller board, every board being 3.6 m long: KETTLE CREEK over ROAD, 0.29 m capitals)
  for (const [key, lines] of [["FERN LANE", ["FERN LANE"]], ["POST ROAD", ["POST ROAD"]], ["KETTLE CREEK RD", ["KETTLE CREEK", "ROAD"]]]) {
    const cap = lines.length > 1 ? 0.29 : 0.36;
    const size = Math.round((cap * SIGN_PPM) / 0.7); // (the rounded face's capitals are 0.7 of its size)
    const stroke = Math.round(size * 0.07);
    const lineH = Math.round(size * 1.02 + stroke * 2), gap = Math.round(cap * SIGN_PPM * 0.42);
    const w = Math.max(...lines.map((t) => wordsWidth(t, size))) + stroke * 2 + 24, h = lineH * lines.length + gap * (lines.length - 1);
    const name = `fx/sign_${key.toLowerCase().replace(/[^a-z]+/g, "_")}`;
    img(name, [w, h], lines.map((text, i) => (
      { text, at: [w / 2, Math.round(i * (lineH + gap) + lineH / 2 + size * 0.35)], size, font: "rounded", align: "center", fill: "#f8efd8", stroke: { color: "#f8efd8", width: stroke } }
    )));
  }
  // The mailboxes' numbers: big and dark on a cream plate filling the box's side
  for (const n of [3, 7]) {
    img(`fx/num_${n}`, [176, 160], [
      { rect: [6, 6, 164, 148], radius: 22, fill: "#f6eedb", stroke: { color: "#3e3631", width: 8, align: "inside" } },
      { text: String(n), at: [88, 136], size: 150, font: "rounded", align: "center", fill: "#3e3631", stroke: { color: "#3e3631", width: 6 } },
    ]);
  }
  img("fx/bridge_out", [512, 186], [
    { text: "BRIDGE", at: [256, 84], size: 86, font: "comic", align: "center", fill: RED, opacity: 0.95 },
    { text: "OUT", at: [256, 172], size: 92, font: "comic", align: "center", fill: RED, opacity: 0.95 },
    { line: [[40, 104], [470, 98]], width: 5, fill: RED, opacity: 0.6, cap: "round" },
  ]);
  img("fx/po_sign", [512, 104], [
    { text: "FERNHOLLOW", at: [256, 34], size: 28, font: "rounded", align: "center", fill: "#e9dcbccc" },
    { text: "POST OFFICE", at: [256, 88], size: 52, font: "rounded", align: "center", fill: "#efe2c2dd" },
  ]);
  // (the van's sides: chunky painted letters in the stripe's red and the postmaster's blue, thick enough to read from the chase camera)
  img("fx/van_side", [880, 300], [
    { text: "FERNHOLLOW", at: [440, 132], size: 128, font: "rounded", align: "center", fill: PAL.red, stroke: { color: PAL.red, width: 12 } },
    { text: "POST", at: [440, 282], size: 124, font: "rounded", align: "center", fill: BLUE, stroke: { color: BLUE, width: 12 } },
  ]);
  img("fx/puff", [64, 64], [{ circle: [32, 32, 22], fill: { radial: [32, 32, 30], stops: [[0, "#ffffffee"], [0.6, "#ffffff88"], [1, "#ffffff00"]] }, blur: 3 }]);
  img("fx/mote", [16, 16], [{ circle: [8, 8, 5], fill: { radial: [8, 8, 7], stops: [[0, "#fff8e0ff"], [1, "#fff8e000"]] } }]);
  img("fx/sunbeam", [64, 256], [{ rect: [0, 0, 64, 256], fill: { linear: [0, 0, 0, 256], stops: [[0, "#fff4d066"], [1, "#fff4d000"]] }, blur: 6 }]);
}

// ---- the minimap: its disc, the north mark on its rim, the "you" mark --------------------------------------------------------------------
// In the UI kit's colours and the paper map's: the kit's wooden frame (#9a6a44 with its darker foot #6f4a31) round a disc of the map's
// meadow on its paper; the roads on it are drawn by lib/ui.lua in the map's road colours and casing. The disc turns with the camera, so
// north is wherever the red "N" tab on its rim says.
if (doing("minimap")) {
  img("ui/minimap_disc", [200, 200], [
    { circle: [100, 103, 97], fill: "#2a2018", opacity: 0.35, blur: 2 },
    { circle: [100, 100, 96], fill: "#6f4a31" },
    { circle: [100, 98, 95], fill: "#9a6a44" },
    { circle: [100, 98, 87], fill: "#f3e6c8" },
    { circle: [100, 98, 85], fill: { radial: [100, 98, 85], stops: [[0, "#dfe0b0"], [0.8, "#d5d8a6"], [1, "#c6c896"]] } },
    { ring: [100, 98, 85, 1.5], fill: "#6f4a31", opacity: 0.55 },
  ]);
  // the disc's rim again, with nothing inside it: drawn over the roads, so they end under the frame (a road is cut at the meadow's edge
  // and the cut hides under this ring, instead of showing as a flat end). The same colours and place as the disc's own paper edge and
  // wood, out to 92 px (the roads reach 87).
  img("ui/minimap_rim", [200, 200], [
    { ring: [100, 98, 86, 2], fill: "#f3e6c8" },
    { ring: [100, 98, 85.375, 0.75], fill: "#6f4a31", opacity: 0.55 },
    { ring: [100, 98, 89.5, 5], fill: "#9a6a44" },
  ]);
  img("ui/minimap_north", [48, 48], [
    { circle: [24, 25, 19], fill: "#2a2018", opacity: 0.35, blur: 1.5 },
    { circle: [24, 23, 18], fill: PAL.red, stroke: { color: "#f3e6c8", width: 3, align: "inside" } },
    { text: "N", at: [24, 32], size: 24, font: "rounded", align: "center", fill: "#fff8ea", stroke: { color: "#fff8ea", width: 1.6 } },
  ]);
  // the roads' strokes on the disc (lib/ui.lua tints them): a bar whose long edges are smoothed in the picture, so a road drawn at any
  // angle has soft edges and does not shimmer as the disc turns, and a round joint for each bend; both about the size they are drawn
  img("ui/minimap_road", [8, 16], [{ rect: [-4, 2, 16, 12], fill: "#ffffff" }]);
  img("ui/minimap_joint", [16, 16], [{ circle: [8, 8, 6], fill: "#ffffff" }]);
  img("ui/you", [48, 48], [{ polygon: [[24, 4], [40, 42], [24, 33], [8, 42]], round: 2, fill: "#e8662e", stroke: { color: "#fffaf0", width: 4, align: "outside" } }]);
}

// ---- the title's painted valley: a late-morning sky, three ranges of blue mountains, a dark wood of pines, the road winding in ---------
if (doing("title")) {
  const W = 1920, H = 1080, sh = [];
  sh.push({ rect: [0, 0, W, H], fill: { linear: [0, 0, 0, H], stops: [[0, "#7fb2d8"], [0.55, "#cfe3ea"], [1, "#e9e1c8"]] } });
  sh.push({ circle: [1460, 250, 70], fill: "#fff6dc", glow: { blur: 60, color: "#fff2c8", spread: 20 } });
  const range = (base, amp, seed, col) => {
    const pts = [[0, H]];
    for (let x = 0; x <= W; x += 40) pts.push([x, base - amp * (0.5 + 0.5 * Math.sin(x * 0.004 * seed + seed) * Math.sin(x * 0.0017 + seed * 2)) - (x % 160 === 0 ? amp * 0.15 : 0)]);
    pts.push([W, H]);
    sh.push({ polygon: pts, fill: col });
  };
  range(620, 260, 1.3, "#9fb7cf"); range(700, 200, 2.1, "#7d9bb8"); range(790, 150, 3.3, "#5f7f88");
  // pines along the front
  for (let x = -20; x < W + 40; x += 34) {
    const hgt = 150 + ((x * 37) % 90), b = 1010 - ((x * 13) % 40);
    sh.push({ polygon: [[x, b - hgt], [x + 38, b], [x - 38, b]], fill: (x / 34) % 2 ? "#2f5a3e" : "#386a48" });
  }
  sh.push({ rect: [0, 0, W, H], fill: { linear: [0, 0, 0, H], stops: [[0, "#00000000"], [0.7, "#00000000"], [1, "#1a120c66"]] } });
  img("ui/title_bg", [W, H], sh);
  img("ui/logo", [1100, 320], [
    { text: "Fernhollow Post", at: [550, 196], size: 116, font: "rounded", align: "center", fill: "#fbf3df", stroke: { color: "#fbf3df", width: 5 }, shadow: { offset: [0, 5], blur: 12, color: "#1e2a3acc" } },
    { text: "a mountain post office", at: [550, 270], size: 38, font: "rounded", align: "center", fill: "#fbf3df", stroke: { color: "#fbf3df", width: 1.5 }, shadow: { offset: [0, 2], blur: 6, color: "#1e2a3acc" } },
  ]);
}

// ---- the label card's and the letter's icons -----------------------------------------------------------------------------------------
if (doing("icons")) {
  img("ui/parcel_icon", [96, 80], [
    { rect: [8, 14, 80, 58], radius: 6, fill: "#c99b67", stroke: { color: "#6b4a2c", width: 3 } },
    { rect: [43, 14, 10, 58], fill: "#efe4cc" }, { rect: [8, 38, 80, 10], fill: "#efe4cc" },
  ]);
  img("ui/letter_icon", [96, 80], [
    { rect: [8, 14, 80, 54], radius: 4, fill: "#f2ead8", stroke: { color: "#8a6e4a", width: 3 } },
    { line: [[10, 18], [48, 46], [86, 18]], width: 3, fill: "#8a6e4a" }, { rect: [66, 22, 14, 16], fill: RED },
  ]);
}
