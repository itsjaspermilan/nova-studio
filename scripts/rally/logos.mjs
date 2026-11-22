// The car makes' logos for Pine Ridge Rally's garage (nothing copied from anywhere; every make and mark is invented):
//   sprites/logos/<make>.png   a smooth emblem, 256 x 256, anti-aliased, on see-through; it reads at 48 units and at 160
// Each emblem is a few shapes drawn by the Nova tools' `image_make` (circles, rings, rounded polygons, tapered strokes) in the
// make's colour with a light top and a darker foot (a linear gradient), a thin lighter rim inside its edge, and cream details.
// The makes and their colours are in lib/state.lua (`state.makes`); the colours here must match its `color` (the test
// `every_car_has_a_make_and_every_make_a_logo_file` in crates/nova-runtime/tests/rally.rs checks that each file exists).
// scripts/rally/verify.sh makes them again and compares them byte for byte.
//
//   scripts/env.sh node scripts/rally/logos.mjs [--project folder] [--sheet path.png]    (--sheet: also one picture of all of them on dark)
import { join } from "node:path";
import { readPng, writePng } from "../pnglib.mjs";
import { projectArg, withServer } from "./mcp.mjs";

const N = 256;
const C = N / 2;

const CREAM = [250, 244, 232];
const INK = [16, 21, 28];

/// the make's colour, lighter at the top of the picture and darker at its foot
const lit = (c) => ({ linear: [0, 0, 0, N], stops: [[0, { color: c, shade: 0.22 }], [0.5, c], [1, { color: c, shade: -0.22 }]] });
/// a body in the make's colour with a thin lighter rim along its inside edge (a band 5 px wide)
const solid = (shape, c, rim = true) => ({ ...shape, fill: lit(c), ...(rim ? { stroke: { color: { color: c, shade: 0.35 }, width: 5, align: "inside", opacity: 0.55 } } : {}) });
const mirrored = (pts) => pts.map(([x, y]) => [N - x, y]);

const EMBLEMS = {
  // Apex: a shield with a peak cut into it
  apex: (c) => [
    solid({ polygon: [[C - 86, 30], [C - 34, 44], [C, 34], [C + 34, 44], [C + 86, 30], [C + 86, 128], [C + 70, 172], [C, 232], [C - 70, 172], [C - 86, 128]], round: 9 }, c),
    { polygon: [[C, 66], [C + 62, 176], [C + 36, 176], [C, 112], [C - 36, 176], [C - 62, 176]], round: 3, fill: INK },
    { polygon: [[C, 130], [C + 20, 166], [C - 20, 166]], round: 2, fill: CREAM },
  ],
  // Kaze: a ring open on the left, and three gusts blowing through it, each curling at its end
  kaze: (c) => {
    const gust = (x0, x1, y, r, up) => {
      const cy = y + (up ? -r : r);
      const curl = up ? { arc: [x1, cy, r, 90, -150], steps: 28 } : { arc: [x1, cy, r, -90, 150], steps: 28 };
      return { line: [[x0, y], [x1, y], curl], width: 15, fill: CREAM };
    };
    return [
      { line: [{ arc: [C, C, 98, 205, 515], steps: 90 }], width: 24, fill: lit(c) },
      gust(C - 108, C + 22, C - 36, 19, true),
      gust(C - 108, C + 56, C + 2, 21, true),
      gust(C - 50, C + 16, C + 40, 17, false),
    ];
  },
  // Sora: the sun coming up over a line, seven rays
  sora: (c) => [
    ...Array.from({ length: 7 }, (_, i) => {
      const a = Math.PI + (Math.PI * (i + 0.5)) / 7;
      return { line: [[C + Math.cos(a) * 78, 176 + Math.sin(a) * 78], [C + Math.cos(a) * 112, 176 + Math.sin(a) * 112]], width: 18, fill: lit(c) };
    }),
    // (the sun is the circle above y 176: a rectangle that ends there, far bigger than the picture, keeps only that half)
    { circle: [C, 176, 62], both: [{ rect: [-1000, -1000, 3000, 1176] }], fill: lit(c) },
    { rect: [C - 100, 187, 200, 18], radius: 9, fill: CREAM },
    { rect: [C - 62, 215, 124, 14], radius: 7, fill: CREAM, opacity: 0.75 },
  ],
  // Tarn: a hexagon with a T cut out of it
  tarn: (c) => [
    solid({ polygon: Array.from({ length: 6 }, (_, i) => [C + Math.cos(((60 * i - 90) * Math.PI) / 180) * 106, C + Math.sin(((60 * i - 90) * Math.PI) / 180) * 106]), round: 12 }, c),
    { rect: [C - 56, 73, 112, 30], radius: 4, fill: INK },
    { polygon: [[C - 17, 100], [C + 17, 100], [C + 13, 186], [C - 13, 186]], round: 2, fill: INK },
  ],
  // Kestrel: a bird of prey from the front, wings swept up and out
  kestrel: (c) => {
    const wing = [[C - 8, 118], [C - 40, 84], [C - 112, 38], [C - 100, 80], [C - 124, 98], [C - 92, 114], [C - 110, 138], [C - 74, 146], [C - 82, 168], [C - 40, 164], [C - 8, 184]];
    return [
      solid({ union: [{ polygon: wing, round: 4 }, { polygon: mirrored(wing), round: 4 }] }, c),
      solid({ line: [[C, 84], [C, 190], [C, 230]], width: 44, width_end: 6 }, c),
      { polygon: [[C - 15, 118], [C, 134], [C + 15, 118], [C + 15, 134], [C, 152], [C - 15, 134]], round: 2, fill: INK },
    ];
  },
  // Cairn: three stones piled up, in a ring
  cairn: (c) => [
    { ring: [C, C, 104, 20], fill: lit(c) },
    // (each stone has a dark line round it, drawn from the bottom up so that the upper stones cover the lines of the lower)
    ...[[C, C + 52, 68, 30], [C - 4, C + 2, 49, 25], [C + 3, C - 40, 31, 20]].flatMap(([cx, cy, rx, ry]) => [
      { ellipse: [cx, cy, rx + 4, ry + 4], fill: INK },
      solid({ ellipse: [cx, cy, rx, ry] }, c, false),
      { ellipse: [cx - rx * 0.1, cy - ry * 0.35, rx * 0.62, ry * 0.3], fill: { color: c, shade: 0.4 }, opacity: 0.3 },
    ]),
  ],
  // Mammut: a mammoth's head: ears, a trunk and two great tusks
  mammut: (c) => {
    const tusk = (s) => ({ line: [{ arc: [C + s * 52, C + 30, 66, s > 0 ? 75 : 105, s > 0 ? -55 : 235], steps: 40 }], width: 26, width_end: 4, fill: CREAM });
    return [
      tusk(-1),
      tusk(1),
      { circle: [C - 78, C - 36, 40], fill: lit(c) },
      { circle: [C + 78, C - 36, 40], fill: lit(c) },
      solid({ polygon: [[C - 62, C - 72], [C - 28, C - 94], [C, C - 100], [C + 28, C - 94], [C + 62, C - 72], [C + 58, C + 10], [C + 30, C + 52], [C - 30, C + 52], [C - 58, C + 10]], round: 18 }, c),
      { line: [[C, C - 10], [C, C + 50], [C - 6, C + 92], [C - 30, C + 108], [C - 46, C + 92]], width: 40, width_end: 20, fill: lit(c) },
      { circle: [C - 30, C - 20, 8], fill: INK },
      { circle: [C + 30, C - 20, 8], fill: INK },
      { line: [[C - 6, C + 6], [C - 4, C + 60]], width: 4, fill: { color: c, shade: -0.35 }, opacity: 0.6 },
    ];
  },
};

const MAKES = {
  apex: "#d3d9e4",
  kaze: "#3de0c5",
  sora: "#ffa726",
  tarn: "#4aa8ff",
  kestrel: "#ef4444",
  cairn: "#8bd45f",
  mammut: "#d19a5b",
};

const project = projectArg();
const sheet = process.argv.indexOf("--sheet") >= 0 ? process.argv[process.argv.indexOf("--sheet") + 1] : null;
const names = Object.keys(MAKES);
await withServer(async (nova) => {
  for (const name of names) {
    await nova.call("image_make", { name: `logos/${name}`, size: [N, N], shapes: EMBLEMS[name](MAKES[name]) });
    console.log(`logo ${name} ${MAKES[name]}`);
  }
}, project);
if (sheet) {
  // every logo at 160, 96 and 48 pixels on the garage's dark ground, to judge them by eye
  const W = names.length * 176 + 16, H = 160 + 96 + 48 + 80;
  const board = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) board.set([14, 19, 24, 255], i * 4);
  names.forEach((name, n) => {
    const pic = readPng(join(project, `sprites/logos/${name}.png`)).data;
    [[160, 16], [96, 192], [48, 304]].forEach(([size, y0]) => {
      const x0 = 16 + n * 176, s = N / size;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          // (a box filter from 256 down: every source pixel in the cell)
          let r = 0, g = 0, b = 0, a = 0, k = 0;
          for (let sy = Math.floor(y * s); sy < Math.floor((y + 1) * s); sy++) {
            for (let sx = Math.floor(x * s); sx < Math.floor((x + 1) * s); sx++) {
              const p = (sy * N + sx) * 4, pa = pic[p + 3] / 255;
              r += pic[p] * pa; g += pic[p + 1] * pa; b += pic[p + 2] * pa; a += pa; k++;
            }
          }
          const o = ((y0 + y) * W + x0 + x) * 4, cov = a / k;
          if (a > 0) for (const [i, v] of [r, g, b].entries()) board[o + i] = (v / a) * cov + board[o + i] * (1 - cov);
        }
      }
    });
  });
  writePng(sheet, W, H, board);
  console.log(`sheet ${sheet}`);
}
