// The car makes' logos for Pine Ridge Rally's garage, drawn by code (nothing copied from anywhere; every make and mark is invented):
//   sprites/logos/<make>.png   a smooth emblem, 256 x 256, anti-aliased, on see-through; it reads at 48 units and at 160
// Each emblem is a few shapes (signed distance functions: circles, rings, rounded polygons, tapered strokes) in the make's colour with a
// light top and a darker foot, and cream details. The makes and their colours are in lib/state.lua (`state.makes`); the colours here
// must match its `color` (the test `every_make_has_a_logo` in crates/nova-runtime/tests/rally.rs checks that each file exists).
// The pixel-art tool `sprite_write` has no anti-aliasing, so like scripts/rally/fx-sprites.mjs this writes the PNGs itself; `check`
// and `sprite_preview` then read them like any sprite.
//
//   scripts/env.sh node scripts/rally/logos.mjs [--project folder] [--sheet path.png]    (--sheet: also one picture of all of them on dark)
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectArg } from "./mcp.mjs";

const N = 256;
const C = N / 2;

// ---- the PNG file ----------------------------------------------------------------------------------------------------------------
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(w, h, rgba) {
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// ---- signed distances (negative inside), in pixels -------------------------------------------------------------------------------
const circle = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r;
const ring = (cx, cy, r, t) => (x, y) => Math.abs(Math.hypot(x - cx, y - cy) - r) - t / 2;
const ellipse = (cx, cy, rx, ry) => (x, y) => {
  // (a good-enough distance: the circle's, scaled by the smaller radius; exact enough for edges that are only anti-aliased)
  const k = Math.min(rx, ry);
  return (Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) * k;
};
const rbox = (cx, cy, hw, hh, r) => (x, y) => {
  const qx = Math.abs(x - cx) - hw + r, qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
function polygon(pts, round = 0) {
  return (x, y) => {
    let d = Infinity, inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [ax, ay] = pts[j], [bx, by] = pts[i];
      const ex = bx - ax, ey = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey || 1)));
      d = Math.min(d, Math.hypot(x - ax - ex * t, y - ay - ey * t));
      if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    }
    return (inside ? -d : d) - round;
  };
}
/// a stroke through points whose width runs from w0 to w1 along it, with round ends
function stroke(pts, w0, w1 = w0) {
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = lens[lens.length - 1] || 1;
  return (x, y) => {
    let d = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const ex = bx - ax, ey = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey || 1)));
      const along = (lens[i - 1] + (lens[i] - lens[i - 1]) * t) / total;
      d = Math.min(d, Math.hypot(x - ax - ex * t, y - ay - ey * t) - (w0 + (w1 - w0) * along) / 2);
    }
    return d;
  };
}
const arc = (cx, cy, r, a0, a1, steps = 48) => Array.from({ length: steps + 1 }, (_, i) => {
  const a = a0 + ((a1 - a0) * i) / steps;
  return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
});
const union = (...fs) => (x, y) => Math.min(...fs.map((f) => f(x, y)));
const minus = (a, b) => (x, y) => Math.max(a(x, y), -b(x, y));
const both = (a, b) => (x, y) => Math.max(a(x, y), b(x, y));
const mirrored = (pts) => pts.map(([x, y]) => [N - x, y]);
const rad = (deg) => (deg * Math.PI) / 180;

// ---- painting ------------------------------------------------------------------------------------------------------------------------
const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const shade = (c, k) => c.map((v) => Math.max(0, Math.min(255, k >= 0 ? v + (255 - v) * k : v * (1 + k))));

/// Paints `dist` into the picture: `color` is one colour, or a function of y (a gradient), `alpha` scales it
function paint(img, dist, color, alpha = 1) {
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const cov = Math.max(0, Math.min(1, 0.5 - dist(x + 0.5, y + 0.5))) * alpha;
      if (cov <= 0) continue;
      const c = typeof color === "function" ? color(x + 0.5, y + 0.5) : color;
      const o = (y * N + x) * 4;
      const a0 = img[o + 3];
      const a = cov + a0 * (1 - cov);
      for (let k = 0; k < 3; k++) img[o + k] = (c[k] * cov + img[o + k] * a0 * (1 - cov)) / a;
      img[o + 3] = a;
    }
  }
}
/// the make's colour, lighter at the top and darker at the foot of the picture
const lit = (c) => (_x, y) => shade(c, ((C - y) / C) * 0.22);

/// a body in the make's colour with a thin lighter rim along its inside edge
function solid(img, dist, c, rim = true) {
  paint(img, dist, lit(c));
  if (rim) paint(img, (x, y) => Math.max(dist(x, y), -(dist(x, y) + 5)), shade(c, 0.35), 0.55); // (a band 5 px wide, just inside the edge)
}

// ---- the emblems ------------------------------------------------------------------------------------------------------------------------
const CREAM = [250, 244, 232];
const INK = [16, 21, 28];

const EMBLEMS = {
  // Apex: a shield with a peak cut into it
  apex(img, c) {
    const shield = polygon([[C - 86, 30], [C - 34, 44], [C, 34], [C + 34, 44], [C + 86, 30], [C + 86, 128], [C + 70, 172], [C, 232], [C - 70, 172], [C - 86, 128]], 9);
    solid(img, shield, c);
    const peak = polygon([[C, 66], [C + 62, 176], [C + 36, 176], [C, 112], [C - 36, 176], [C - 62, 176]], 3);
    paint(img, peak, INK);
    paint(img, polygon([[C, 130], [C + 20, 166], [C - 20, 166]], 2), CREAM);
  },
  // Kaze: a ring open on the left, and three gusts blowing through it, each curling at its end
  kaze(img, c) {
    paint(img, stroke(arc(C, C, 98, rad(205), rad(515), 90), 24, 24), lit(c));
    const gust = (x0, x1, y, r, up) => {
      const cy = y + (up ? -r : r);
      const curl = up ? arc(x1, cy, r, rad(90), rad(-150), 28) : arc(x1, cy, r, rad(-90), rad(150), 28);
      paint(img, stroke([[x0, y], [x1, y], ...curl], 15, 15), CREAM);
    };
    gust(C - 108, C + 22, C - 36, 19, true);
    gust(C - 108, C + 56, C + 2, 21, true);
    gust(C - 50, C + 16, C + 40, 17, false);
  },
  // Sora: the sun coming up over a line, seven rays
  sora(img, c) {
    for (let i = 0; i < 7; i++) {
      const a = Math.PI + (Math.PI * (i + 0.5)) / 7;
      const r0 = 78, r1 = 112;
      paint(img, stroke([[C + Math.cos(a) * r0, 176 + Math.sin(a) * r0], [C + Math.cos(a) * r1, 176 + Math.sin(a) * r1]], 18, 18), lit(c));
    }
    paint(img, both(circle(C, 176, 62), (x, y) => y - 176), lit(c));
    paint(img, rbox(C, 196, 100, 9, 9), CREAM);
    paint(img, rbox(C, 222, 62, 7, 7), CREAM, 0.75);
  },
  // Tarn: a hexagon with a T cut out of it
  tarn(img, c) {
    const hexagon = polygon(Array.from({ length: 6 }, (_, i) => [C + Math.cos(rad(60 * i - 90)) * 106, C + Math.sin(rad(60 * i - 90)) * 106]), 12);
    solid(img, hexagon, c);
    paint(img, rbox(C, 88, 56, 15, 4), INK);
    paint(img, polygon([[C - 17, 100], [C + 17, 100], [C + 13, 186], [C - 13, 186]], 2), INK);
  },
  // Kestrel: a bird of prey from the front, wings swept up and out
  kestrel(img, c) {
    const wing = [[C - 8, 118], [C - 40, 84], [C - 112, 38], [C - 100, 80], [C - 124, 98], [C - 92, 114], [C - 110, 138], [C - 74, 146], [C - 82, 168], [C - 40, 164], [C - 8, 184]];
    solid(img, union(polygon(wing, 4), polygon(mirrored(wing), 4)), c);
    solid(img, stroke([[C, 84], [C, 190], [C, 230]], 44, 6), c);
    paint(img, polygon([[C - 15, 118], [C, 134], [C + 15, 118], [C + 15, 134], [C, 152], [C - 15, 134]], 2), INK);
  },
  // Cairn: three stones piled up, in a ring
  cairn(img, c) {
    paint(img, ring(C, C, 104, 20), lit(c));
    // (each stone has a dark line round it, drawn from the bottom up so that the upper stones cover the lines of the lower)
    for (const [cx, cy, rx, ry] of [[C, C + 52, 68, 30], [C - 4, C + 2, 49, 25], [C + 3, C - 40, 31, 20]]) {
      paint(img, ellipse(cx, cy, rx + 4, ry + 4), INK);
      solid(img, ellipse(cx, cy, rx, ry), c, false);
      paint(img, ellipse(cx - rx * 0.1, cy - ry * 0.35, rx * 0.62, ry * 0.3), shade(c, 0.4), 0.3);
    }
  },
  // Mammut: a mammoth's head: ears, a trunk and two great tusks
  mammut(img, c) {
    const tusk = (s) => stroke(arc(C + s * 52, C + 30, 66, s > 0 ? rad(75) : rad(105), s > 0 ? rad(-55) : rad(235), 40).map(([x, y], i, a) => [x, y]), 26, 4);
    paint(img, tusk(-1), CREAM);
    paint(img, tusk(1), CREAM);
    paint(img, circle(C - 78, C - 36, 40), lit(c));
    paint(img, circle(C + 78, C - 36, 40), lit(c));
    solid(img, polygon([[C - 62, C - 72], [C - 28, C - 94], [C, C - 100], [C + 28, C - 94], [C + 62, C - 72], [C + 58, C + 10], [C + 30, C + 52], [C - 30, C + 52], [C - 58, C + 10]], 18), c);
    paint(img, stroke([[C, C - 10], [C, C + 50], [C - 6, C + 92], [C - 30, C + 108], [C - 46, C + 92]], 40, 20), lit(c));
    paint(img, circle(C - 30, C - 20, 8), INK);
    paint(img, circle(C + 30, C - 20, 8), INK);
    paint(img, stroke([[C - 6, C + 6], [C - 4, C + 60]], 4, 4), shade(c, -0.35), 0.6);
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
const out = join(project, "sprites/logos");
mkdirSync(out, { recursive: true });
const sheet = process.argv.indexOf("--sheet") >= 0 ? process.argv[process.argv.indexOf("--sheet") + 1] : null;
const names = Object.keys(MAKES);
const pictures = {};
for (const name of names) {
  const img = new Float64Array(N * N * 4);
  EMBLEMS[name](img, hex(MAKES[name]));
  const bytes = Buffer.alloc(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    const a = img[i * 4 + 3];
    bytes[i * 4] = Math.round(img[i * 4]); bytes[i * 4 + 1] = Math.round(img[i * 4 + 1]); bytes[i * 4 + 2] = Math.round(img[i * 4 + 2]);
    bytes[i * 4 + 3] = Math.round(a * 255);
  }
  pictures[name] = bytes;
  writeFileSync(join(out, `${name}.png`), png(N, N, bytes));
  console.log(`logo ${name} ${MAKES[name]}`);
}
if (sheet) {
  // every logo at 160, 96 and 48 pixels on the garage's dark ground, to judge them by eye
  const W = names.length * 176 + 16, H = 160 + 96 + 48 + 80;
  const board = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { board[i * 4] = 14; board[i * 4 + 1] = 19; board[i * 4 + 2] = 24; board[i * 4 + 3] = 255; }
  names.forEach((name, n) => {
    [[160, 16], [96, 192], [48, 304]].forEach(([size, y0]) => {
      const x0 = 16 + n * 176;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          // (a box filter from 256 down: every source pixel in the cell)
          const s = N / size;
          let r = 0, g = 0, b = 0, a = 0, k = 0;
          for (let sy = Math.floor(y * s); sy < Math.floor((y + 1) * s); sy++) {
            for (let sx = Math.floor(x * s); sx < Math.floor((x + 1) * s); sx++) {
              const p = (sy * N + sx) * 4, pa = pictures[name][p + 3] / 255;
              r += pictures[name][p] * pa; g += pictures[name][p + 1] * pa; b += pictures[name][p + 2] * pa; a += pa; k++;
            }
          }
          const o = ((y0 + y) * W + x0 + x) * 4, cov = a / k;
          if (a > 0) {
            board[o] = (r / a) * cov + board[o] * (1 - cov); board[o + 1] = (g / a) * cov + board[o + 1] * (1 - cov); board[o + 2] = (b / a) * cov + board[o + 2] * (1 - cov);
          }
        }
      }
    });
  });
  writeFileSync(sheet, png(W, H, board));
  console.log(`sheet ${sheet}`);
}
