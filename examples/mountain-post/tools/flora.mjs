// The meadow's small flowers and plants as painted pictures (the owner's eighth play: "The flowers look kinda weird. Just like blobs on
// sticks ... don't some games use 2D assets for the less important items?"): textures/flora.png, five kinds side by side, each a square
// cell of 128 texels with the ground at its bottom, drawn by image_make in the soft-toy palette. The engine stands them among the grass
// blades, turned to the camera (nova.grass's `flowers`, docs/project-format.md "Grass"; entities/valley_ground.lua).
// Run from the repository's root: scripts/env.sh node examples/mountain-post/tools/flora.mjs
//
// Kinds, left to right (the order entities/valley_ground.lua's KINDS names): daisies, buttercups, lupines, clover, dandelions.
// Rules for a picture this small on screen (a plant is 0.3 to 0.5 m, so 20 to 60 pixels tall from the walking camera): flat paint with
// a lighter cap where the sun falls, no outline, no detail finer than 3 texels (the smaller copies average it away), stems at least
// 3 texels, the flower heads big and few: they are what is seen.
import { renameSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { GAME, tool } from "./lib.mjs";
import { PAL } from "./palette.mjs";

const C = 128; // a cell
const KINDS = ["daisies", "buttercups", "lupines", "clover", "dandelions"];
let seed = 11;
const R = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const STEM = "#5f8f45", STEM_DARK = "#4d7a3c", LEAF = PAL.leaf, LEAF_LIGHT = PAL.moss;
const shapes = [];
const at = (k, x, y) => [k * C + x, y];
const stem = (k, x0, x1, top, width = 3.2) =>
  shapes.push({ path: `M ${k * C + x0} ${C} Q ${k * C + (x0 + x1) / 2 + (R() - 0.5) * 6} ${(C + top) / 2} ${k * C + x1} ${top}`, width, fill: null, stroke: { color: STEM, width } });
// a leaf: a pointed oval from (x, y) leaning `ang` degrees from upright, `len` long
const leaf = (k, x, y, ang, len, w, color = LEAF) => {
  const a = (ang * Math.PI) / 180, dx = Math.sin(a), dy = -Math.cos(a);
  const tip = [x + dx * len, y + dy * len], mid = [x + dx * len * 0.5, y + dy * len * 0.5], nx = -dy * w, ny = dx * w;
  shapes.push({ path: `M ${k * C + x} ${y} Q ${k * C + mid[0] + nx} ${mid[1] + ny} ${k * C + tip[0]} ${tip[1]} Q ${k * C + mid[0] - nx} ${mid[1] - ny} ${k * C + x} ${y} Z`, fill: color });
};
const tuft = (k, cx, n, spread, h) => { for (let i = 0; i < n; i++) leaf(k, cx + (i - (n - 1) / 2) * spread, C, (i - (n - 1) / 2) * 22 + (R() - 0.5) * 10, h * (0.7 + R() * 0.5), 5, i % 2 ? LEAF : LEAF_LIGHT); };

// ---- 0 daisies: a few white daisies with sunny middles on thin stems, a low rosette of leaves ----
{
  const k = 0;
  tuft(k, 64, 6, 9, 30);
  const heads = [[36, 52, 16], [72, 32, 18], [98, 58, 15], [56, 80, 13]];
  for (const [x, y] of heads) stem(k, x + (64 - x) * 0.4 + (R() - 0.5) * 8, x, y + 4);
  for (const [x, y, r] of heads) {
    const petals = [];
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2 + R() * 0.2;
      petals.push({ ellipse: [k * C + x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.5, r * 0.42, r * 0.24], fill: PAL.white });
    }
    // the petals as one flat white, slightly darker underneath, and a mustard middle with a lighter cap
    shapes.push({ union: petals, fill: { linear: [0, y - r, 0, y + r], stops: [[0, "#fbf7ee"], [1, "#e4ddcd"]] } });
    shapes.push({ circle: [k * C + x, y, r * 0.3], fill: { radial: [k * C + x - r * 0.08, y - r * 0.1, r * 0.35], stops: [[0, "#f4c95a"], [1, "#d9a03a"]] } });
  }
}
// ---- 1 buttercups: glossy yellow cups held up on branching stems over a mound of lobed leaves ----
{
  const k = 1;
  for (let i = 0; i < 7; i++) {
    const x = 26 + i * 12 + (R() - 0.5) * 6;
    shapes.push({ circle: [k * C + x, C - 8 - R() * 8, 10 + R() * 4], fill: i % 2 ? LEAF : LEAF_LIGHT });
  }
  const cups = [[40, 50], [62, 30], [84, 46], [100, 70], [50, 72], [76, 64]];
  for (const [x, y] of cups) stem(k, 64 + (x - 64) * 0.3, x, y + 5, 3);
  for (const [x, y] of cups) {
    const r = 11 + R() * 2;
    shapes.push({ path: `M ${k * C + x - r} ${y - 2} Q ${k * C + x - r} ${y + r} ${k * C + x} ${y + r * 0.95} Q ${k * C + x + r} ${y + r} ${k * C + x + r} ${y - 2} Q ${k * C + x} ${y + 3} ${k * C + x - r} ${y - 2} Z`,
      fill: { linear: [0, y - 2, 0, y + r], stops: [[0, "#ffe27a"], [1, "#e8b42a"]] } });
    shapes.push({ ellipse: [k * C + x, y - 1.5, r * 0.86, r * 0.32], fill: "#f7d04a" });
    shapes.push({ circle: [k * C + x - r * 0.35, y + r * 0.25, r * 0.22], fill: "#fff3c0", opacity: 0.85 });
  }
}
// ---- 2 lupines: two or three tall spikes of lilac and rose bells, tapering to a point, over hand-shaped leaves ----
{
  const k = 2;
  const spikes = [[44, 14, PAL.lilac, "#9d89c4"], [72, 6, "#c9a6d8", "#a685bd"], [96, 26, PAL.rose, "#c27463"]];
  for (const [x, top] of spikes) stem(k, x + (R() - 0.5) * 4, x, top + 10, 4);
  for (const [x, top, light, dark] of spikes) {
    // a spike of round bells, loose at the bottom and tight to a bud at the top, each bell darker below and lighter on top
    const bottom = top + 64;
    for (let y = bottom; y >= top + 4; y -= 5) {
      const t = (bottom - y) / (bottom - top), r = 6.2 * (1 - t * 0.55);
      for (const side of [-1, 1]) {
        const bx = k * C + x + side * r * 0.75 + (R() - 0.5) * 2, by = y - (side > 0 ? 2.5 : 0);
        shapes.push({ circle: [bx, by, r], fill: { linear: [0, by - r, 0, by + r], stops: [[0, light], [1, dark]] } });
      }
    }
    shapes.push({ ellipse: [k * C + x, top + 1, 3.4, 5], fill: light });
  }
  // a fan of hand-shaped leaves at the foot
  for (let i = 0; i < 4; i++) {
    const cx = 26 + i * 26;
    for (let j = 0; j < 7; j++) leaf(k, cx, C - 6, -75 + j * 25, 20, 4.5, j % 2 ? LEAF : LEAF_LIGHT);
  }
}
// ---- 3 clover: a low mound of three-lobed leaves with a few round pink-white heads ----
{
  const k = 3;
  for (let i = 0; i < 14; i++) {
    const x = 18 + R() * 92, y = C - 6 - R() * 26, r = 6 + R() * 2;
    const lobes = [0, 1, 2].map((j) => { const a = -Math.PI / 2 + (j - 1) * 2.1; return { circle: [k * C + x + Math.cos(a) * r * 0.75, y + Math.sin(a) * r * 0.75, r * 0.72] }; });
    shapes.push({ union: lobes, fill: i % 3 ? LEAF_LIGHT : LEAF });
    shapes.push({ circle: [k * C + x, y - r * 0.3, r * 0.35], fill: "#b9d27a", opacity: 0.7 });
  }
  for (const [x, y] of [[40, 70], [76, 60], [98, 80]]) {
    stem(k, x + (R() - 0.5) * 6, x, y + 4, 3);
    const r = 9;
    shapes.push({ circle: [k * C + x, y, r], fill: { radial: [k * C + x - 2, y - 3, r * 1.2], stops: [[0, "#fbeef0"], [0.6, "#eab9c4"], [1, "#d690a3"]] } });
    for (let j = 0; j < 7; j++) { const a = (j / 7) * Math.PI * 2; shapes.push({ circle: [k * C + x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62, 2.4], fill: "#f6dde3" }); }
  }
}
// ---- 4 dandelions: two white seed clocks and a yellow head over a rosette of toothed leaves ----
{
  const k = 4;
  for (let i = 0; i < 6; i++) {
    const a = -75 + i * 30, len = 26 + R() * 8;
    leaf(k, 64 + (i - 2.5) * 6, C, a, len, 6, i % 2 ? LEAF : LEAF_LIGHT);
  }
  const clocks = [[46, 30, 15], [84, 44, 13]];
  for (const [x, y] of clocks) stem(k, 64 + (x - 64) * 0.3, x, y + 6, 3);
  stem(k, 66, 66, 72, 3.4);
  for (const [x, y, r] of clocks) {
    shapes.push({ circle: [k * C + x, y, r], fill: { radial: [k * C + x - r * 0.25, y - r * 0.3, r * 1.1], stops: [[0, "#fffdf6"], [0.75, "#f1ece0"], [1, "#e2dccd"]] } });
    for (let j = 0; j < 12; j++) { const a = (j / 12) * Math.PI * 2; shapes.push({ circle: [k * C + x + Math.cos(a) * r * 0.95, y + Math.sin(a) * r * 0.95, 2.6], fill: "#fbf8ef" }); }
    shapes.push({ circle: [k * C + x, y, 2.5], fill: "#b9ab8a" });
  }
  shapes.push({ circle: [k * C + 66, 70, 9], fill: { radial: [k * C + 64, 67, 10], stops: [[0, "#ffe27a"], [1, "#e9a92b"]] } });
  for (let j = 0; j < 10; j++) { const a = (j / 10) * Math.PI * 2; shapes.push({ ellipse: [k * C + 66 + Math.cos(a) * 8, 70 + Math.sin(a) * 6, 3.4, 2.4], fill: "#f2c23e" }); }
}

tool("image_make", { name: "fx/_flora", size: [C * KINDS.length, C], shapes }, { quiet: true });
const from = join(GAME, "sprites/fx/_flora.png"), to = join(GAME, "textures/flora.png");
mkdirSync(join(GAME, "textures"), { recursive: true });
if (existsSync(to)) rmSync(to);
renameSync(from, to);
console.log(`made textures/flora.png: ${KINDS.join(", ")}`);
