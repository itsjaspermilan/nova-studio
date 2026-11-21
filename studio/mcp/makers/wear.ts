// Wear for the detailed city: what makes a street look used. Three kinds of tiles, all drawn here and added to a detailed
// tileset by tileset_make:
//  - worn variants of a terrain's whole tile ("asphalt_worn_crack", "pavement_worn_missing"): the plain tile with one
//    placed mark of use on it (a crack, a chipped corner, a patch of newer tarmac, a stain, a missing slab, a dent);
//  - wear features ("wear_pothole", "wear_patch_nw", "wear_crack_ns", "wear_zebra"): see-through tiles laid over the ground
//    in a layer of their own, some of several tiles ("wear_pothole_big@1,1"), some joining along their length (a crack
//    that wanders across many tiles, a repaired patch with a tar outline, a hatched box);
//  - more outlines for a pool on the ground ("puddle_shape2_edge_n"), so a puddle's edge wanders differently in every cell.
// scene_write's painter (wear-paint.ts) decides where they go. Everything is low in contrast on purpose: the floor is where
// the game's own marks (an enemy's tell, a pickup's glow) must read first.

import type { Ctx } from "./tilekit";
import { hash2, Img, mix, rngOf, seedOf, shade, type Ramp, type Rgba } from "./paint";

const T = 32;
const WHITE: Rgba = [255, 255, 255, 255];
const al = (c: Rgba, a: number): Rgba => [c[0], c[1], c[2], Math.max(0, Math.min(255, Math.round(a)))];
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth01 = (v: number) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};

/// A colour laid over a pixel with its own alpha, the alphas combined as glass over glass: a mark on a see-through tile
/// stays see-through around it, and a faint mark stays faint.
export function put(img: Img, x: number, y: number, c: Rgba) {
  x = Math.round(x);
  y = Math.round(y);
  if (!img.inside(x, y) || c[3] <= 0) return;
  const d = img.r.data, o = (y * img.w + x) * 4;
  const sa = c[3] / 255, da = d[o + 3]! / 255, oa = sa + da * (1 - sa);
  for (let i = 0; i < 3; i++) d[o + i] = Math.round((c[i]! * sa + d[o + i]! * da * (1 - sa)) / oa);
  d[o + 3] = Math.round(oa * 255);
}

/// Smooth value noise from 0 to 1 (the same for the same seed).
export function vnoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), s = (t: number) => t * t * (3 - 2 * t);
  const u = s(x - x0), v = s(y - y0);
  const a = hash2(x0, y0, seed), b = hash2(x0 + 1, y0, seed), c = hash2(x0, y0 + 1, seed), d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/// How far a pixel is inside a rough blob: below 1 is inside. The edge wanders by `rough` (0.3 is a stain, 0.6 a splash).
const blob = (x: number, y: number, cx: number, cy: number, rx: number, ry: number, seed: number, rough = 0.35) =>
  Math.hypot((x - cx) / rx, (y - cy) / ry) + (vnoise(x / 3.2, y / 3.2, seed) - 0.5) * rough * 2;

/// A path that wanders from one point to another through `n` points pushed sideways by up to `amp` pixels.
function wander(rng: () => number, x0: number, y0: number, x1: number, y1: number, amp: number, n = 3): [number, number][] {
  const out: [number, number][] = [[x0, y0]];
  const len = Math.hypot(x1 - x0, y1 - y0) || 1, px = -(y1 - y0) / len, py = (x1 - x0) / len;
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1), o = (rng() * 2 - 1) * amp;
    out.push([x0 + (x1 - x0) * t + px * o, y0 + (y1 - y0) * t + py * o]);
  }
  out.push([x1, y1]);
  return out;
}

/// The pixels of a polyline, one each, in order.
function pixelsOf(pts: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  const seen = new Set<number>();
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i]!, [x1, y1] = pts[i + 1]!;
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let s = 0; s <= steps; s++) {
      const x = Math.round(x0 + ((x1 - x0) * s) / steps), y = Math.round(y0 + ((y1 - y0) * s) / steps);
      const k = y * 1000 + x;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push([x, y]);
    }
  }
  return out;
}

/// A crack: a dark groove with its far lip (below and to the right, facing the light) catching a little light. `fade`
/// thins it to nothing towards its end.
function crack(img: Img, c: Ctx, pts: [number, number][], strength = 1, fade = false) {
  const px = pixelsOf(pts);
  const on = new Set(px.map(([x, y]) => y * 1000 + x));
  px.forEach(([x, y], i) => {
    const f = fade ? 1 - (i / px.length) ** 1.5 : 1;
    put(img, x, y, al(c.P.outline, 210 * strength * f));
    // a full-strength crack is open: two pixels wide in its middle stretch
    if (strength >= 1 && f > 0.6 && i % 5 !== 0 && !on.has(y * 1000 + x + 1)) put(img, x + 1, y, al(c.P.outline, 120 * f));
    if (!on.has((y + 1) * 1000 + x)) put(img, x, y + 1, al(shade(c.P.mat.concrete[3], 1), 52 * strength * f));
  });
}

/// A hairline: a fainter crack with a branch or two.
function hairline(img: Img, c: Ctx, rng: () => number, x0: number, y0: number, x1: number, y1: number, strength = 0.7) {
  const main = wander(rng, x0, y0, x1, y1, 3, 4);
  crack(img, c, main, strength);
  const at = main[1 + Math.floor(rng() * (main.length - 2))]!;
  crack(img, c, wander(rng, at[0], at[1], at[0] + (rng() * 2 - 1) * 9, at[1] + (rng() * 2 - 1) * 9, 2, 2), strength * 0.6, true);
}

/// Small loose stones: clusters of one to three pixels with a lit top.
function stones(img: Img, rng: () => number, n: number, r: Ramp, x0: number, y0: number, x1: number, y1: number) {
  for (let i = 0; i < n; i++) {
    const x = x0 + Math.floor(rng() * (x1 - x0)), y = y0 + Math.floor(rng() * (y1 - y0));
    put(img, x, y, r[3]);
    if (rng() < 0.6) put(img, x + 1, y, r[2]);
    put(img, x, y + 1, r[0]);
  }
}

/// Grass and weeds coming up: a few blades from a dark root, lit at their tips.
function weeds(img: Img, c: Ctx, rng: () => number, x: number, y: number, n = 4) {
  const L = c.P.mat.leaf;
  for (let i = 0; i < n; i++) {
    const bx = x + Math.round((rng() * 2 - 1) * 3), tall = 3 + Math.floor(rng() * 4), lean = rng() < 0.5 ? -1 : 1;
    for (let j = 0; j < tall; j++) put(img, bx + (j > tall / 2 ? lean : 0), y - j, j === tall - 1 ? L[4] : j < 1 ? L[1] : L[3]);
  }
  put(img, x - 1, y + 1, al(c.P.outline, 120));
  put(img, x, y + 1, al(c.P.outline, 120));
}

/// A soft moss patch: dull green in clumps, the light catching their tops.
function moss(img: Img, c: Ctx, cx: number, cy: number, rx: number, ry: number, seed: number) {
  const L = c.P.mat.leaf;
  for (let y = Math.floor(cy - ry - 2); y <= cy + ry + 2; y++) for (let x = Math.floor(cx - rx - 2); x <= cx + rx + 2; x++) {
    const d = blob(x, y, cx, cy, rx, ry, seed, 0.5);
    if (d < 1) put(img, x, y, al(hash2(x, y, seed) < 0.2 ? L[3] : d < 0.6 ? L[1] : L[2], d < 0.7 ? 190 : 120));
  }
}

/// A stain: a dark soft blot, darkest in its middle.
function stain(img: Img, c: Ctx, cx: number, cy: number, rx: number, ry: number, seed: number, a = 70, col?: Rgba) {
  const k = col ?? c.P.outline;
  for (let y = Math.floor(cy - ry - 3); y <= cy + ry + 3; y++) for (let x = Math.floor(cx - rx - 3); x <= cx + rx + 3; x++) {
    const d = blob(x, y, cx, cy, rx, ry, seed, 0.3);
    if (d < 1) put(img, x, y, al(k, a * (d < 0.8 ? 1 : (1 - d) * 5)));
  }
}

// ---- worn variants of the whole tiles ----------------------------------------------------------------------------------------

export interface Worn {
  what: string;
  draw: (c: Ctx, img: Img, rng: () => number) => void;
}

/// One slab of a pavement tile (16 px slabs, four to a tile): its corner and size.
const slab = (rng: () => number) => [(Math.floor(rng() * 2) << 4) + 0, (Math.floor(rng() * 2) << 4) + 0] as const;

export const WORN: Record<string, Worn[]> = {
  asphalt: [
    { what: "crack", draw: (c, img, rng) => hairline(img, c, rng, 2 + rng() * 8, 1, 20 + rng() * 10, 30) },
    {
      what: "crazing",
      draw: (c, img, rng) => {
        // a crazed patch: cracks meeting in small cells, the way old tarmac breaks before a pothole
        const cx = 10 + rng() * 12, cy = 10 + rng() * 12, s = seedOf("craze") + c.seed;
        const pts: [number, number][] = Array.from({ length: 7 }, () => [cx + (rng() * 2 - 1) * 10, cy + (rng() * 2 - 1) * 8]);
        for (let i = 0; i < pts.length; i++) {
          const [x, y] = pts[i]!, [nx, ny] = pts[(i + 1 + Math.floor(rng() * 2)) % pts.length]!;
          if (Math.hypot(nx - x, ny - y) < 14) crack(img, c, wander(rng, x, y, nx, ny, 1.5, 2), 0.75);
        }
        stain(img, c, cx, cy, 8, 6, s, 22);
      },
    },
    {
      what: "chip",
      draw: (c, img, rng) => {
        // the top layer broken away near an edge: the rougher, darker course under it, its rim lit on the far side
        const A = c.P.mat.asphalt, side = Math.floor(rng() * 4), s = seedOf("chip") + c.seed + side;
        const cx = side === 0 ? 4 + rng() * 6 : side === 1 ? 26 - rng() * 6 : 8 + rng() * 16, cy = side === 2 ? 4 + rng() * 5 : side === 3 ? 26 - rng() * 4 : 8 + rng() * 16;
        for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
          const d = blob(x, y, cx, cy, 6, 4.5, s, 0.5);
          if (d < 0.82) img.set(x, y, hash2(x, y, s) < 0.18 ? A[2] : hash2(x, y, s + 1) < 0.1 ? A[0] : A[1]);
          else if (d < 1) img.set(x, y, x + y > cx + cy ? mix(A[2], A[3], 0.6) : mix(A[1], c.P.outline, 0.4));
        }
      },
    },
    {
      what: "filled",
      draw: (c, img, rng) => {
        // an old pothole filled by hand: a lumpy round of smoother, darker tarmac, its rim sealed with tar
        const A = c.P.mat.asphalt, cx = 9 + rng() * 14, cy = 9 + rng() * 14, s = seedOf("filled") + c.seed;
        for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
          const d = blob(x, y, cx, cy, 7, 5.5, s, 0.4);
          if (d < 0.86) img.set(x, y, hash2(x, y, s) < 0.05 ? A[2] : mix(A[1], A[2], 0.8));
          else if (d < 1) put(img, x, y, al(A[0], 150));
        }
      },
    },
    { what: "stain", draw: (c, img, rng) => stain(img, c, 8 + rng() * 16, 8 + rng() * 16, 7 + rng() * 4, 4 + rng() * 3, seedOf("stain") + c.seed, 60) },
    {
      what: "smooth",
      draw: (c, img, rng) => {
        // worn smooth where wheels run: the grit gone, a soft polish
        const A = c.P.mat.asphalt, y0 = 8 + rng() * 10;
        for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
          const f = 1 - Math.abs(y - y0 - Math.sin(x / 9) * 2) / 7;
          if (f > 0) img.set(x, y, mix(A[2], A[3], 0.16 * f + (f > 0.6 ? 0.06 : 0)));
        }
      },
    },
    {
      what: "seam",
      draw: (c, img, rng) => {
        // where two lanes of tarmac were laid: a tar seam straight across, a little glossy
        const y = 6 + Math.floor(rng() * 20);
        for (let x = 0; x < T; x++) {
          const yy = y + (x > 14 && x < 19 ? 1 : 0);
          put(img, x, yy, al(c.P.outline, 170));
          put(img, x, yy + 1, al(mix(c.P.outline, c.P.mat.asphalt[1], 0.5), 200));
          if (x % 7 < 4) put(img, x, yy - 1, al(c.P.mat.asphalt[4], 40));
        }
      },
    },
    { what: "gravel", draw: (c, img, rng) => stones(img, rng, 26, c.P.mat.asphalt, 6 + Math.floor(rng() * 6), 6 + Math.floor(rng() * 6), 26, 26) },
    {
      what: "scuff",
      draw: (c, img, rng) => {
        for (let k = 0; k < 4; k++) {
          const x = 4 + rng() * 18, y = 6 + rng() * 20, len = 5 + rng() * 8;
          for (let i = 0; i < len; i++) put(img, x + i, y + i * 0.25, al(c.P.mat.asphalt[4], 34));
        }
      },
    },
    {
      what: "pit",
      draw: (c, img, rng) => {
        // a small pothole starting: a dark pit with a broken rim
        const A = c.P.mat.asphalt, cx = 9 + rng() * 14, cy = 9 + rng() * 14, s = seedOf("pit") + c.seed;
        for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
          const d = blob(x, y, cx, cy, 4, 3, s, 0.5);
          if (d < 0.75) img.set(x, y, hash2(x, y, s) < 0.2 ? A[1] : mix(A[0], c.P.outline, 0.5));
          else if (d < 1) img.set(x, y, x + y > cx + cy ? A[3] : A[0]);
        }
        stones(img, rng, 4, A, cx - 7, cy - 6, cx + 7, cy + 6);
      },
    },
    {
      what: "drops",
      draw: (c, img, rng) => {
        // oil dropped from a parked car: a few dark drops, one with a sheen
        for (let k = 0; k < 5; k++) stain(img, c, 6 + rng() * 20, 6 + rng() * 20, 1.5 + rng() * 2, 1 + rng() * 1.5, seedOf(`drop${k}`) + c.seed, 90);
        const x = 10 + rng() * 12, y = 10 + rng() * 12;
        put(img, x, y, al(c.P.accent[1][3], 50));
        put(img, x + 1, y, al(c.P.accent[0][3], 40));
      },
    },
  ],
  pavement: [
    {
      what: "crack",
      draw: (c, img, rng) => {
        const [sx, sy] = slab(rng);
        hairline(img, c, rng, sx + 2 + rng() * 4, sy + 1, sx + 8 + rng() * 5, sy + 13, 0.8);
      },
    },
    {
      what: "missing",
      draw: (c, img, rng) => {
        // a slab gone: earth and broken bits in the hole, its sides in shadow at the top and left
        const [sx, sy] = slab(rng), d = c.P.mat.path, C = c.P.mat.concrete;
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
          const h = hash2(sx + x, sy + y, c.seed + 91);
          img.set(sx + x, sy + y, y < 2 || x < 2 ? mix(d[0], c.P.outline, 0.5) : h < 0.12 ? d[3] : h < 0.3 ? d[1] : d[2]);
        }
        stones(img, rng, 6, C, sx + 3, sy + 3, sx + 14, sy + 14);
        if (rng() < 0.6) weeds(img, c, rng, sx + 5 + Math.floor(rng() * 6), sy + 12, 3);
      },
    },
    {
      what: "lifted",
      draw: (c, img, rng) => {
        // a slab lifted by a root or frost: its top edge lit, a dark gap and its shadow below
        const [sx, sy] = slab(rng), C = c.P.mat.concrete;
        for (let x = 1; x < 15; x++) {
          img.set(sx + x, sy, C[4]);
          img.set(sx + x, sy + 14, c.P.outline);
          img.set(sx + x, sy + 15, mix(C[0], c.P.outline, 0.4));
        }
        for (let y = 1; y < 14; y++) img.set(sx + 14, sy + y, mix(C[0], c.P.outline, 0.3));
        for (let y = 1; y < 14; y++) for (let x = 1; x < 14; x++) img.set(sx + x, sy + y, mix(img.get(sx + x, sy + y) ?? C[2], C[3], 0.18));
      },
    },
    { what: "stain", draw: (c, img, rng) => stain(img, c, 8 + rng() * 16, 8 + rng() * 16, 8, 5, seedOf("pstain") + c.seed, 55) },
    {
      what: "gum",
      draw: (c, img, rng) => {
        for (let k = 0; k < 7; k++) {
          const x = 3 + Math.floor(rng() * 26), y = 3 + Math.floor(rng() * 26);
          put(img, x, y, al(c.P.outline, 110));
          put(img, x + 1, y, al(c.P.outline, 80));
          put(img, x, y - 1, al(c.P.mat.concrete[3], 60));
        }
      },
    },
    {
      what: "chipped",
      draw: (c, img, rng) => {
        // slab corners knocked off, showing the bedding
        const C = c.P.mat.concrete;
        for (let k = 0; k < 2; k++) {
          const [sx, sy] = slab(rng), cx = sx + (rng() < 0.5 ? 2 : 13), cy = sy + (rng() < 0.5 ? 2 : 13), s = c.seed + k * 7;
          for (let y = cy - 4; y <= cy + 4; y++) for (let x = cx - 4; x <= cx + 4; x++) {
            const d = blob(x, y, cx, cy, 3.4, 3, s, 0.4);
            if (d < 0.8) img.set(x, y, hash2(x, y, s) < 0.3 ? C[1] : mix(C[0], c.P.mat.path[1], 0.4));
            else if (d < 1) img.set(x, y, x + y > cx + cy ? C[3] : C[0]);
          }
        }
      },
    },
    {
      what: "sunk",
      draw: (c, img, rng) => {
        // a slab sunk a little: its top edge in shadow, the slab a shade darker
        const [sx, sy] = slab(rng), C = c.P.mat.concrete;
        for (let y = 0; y < 15; y++) for (let x = 0; x < 15; x++) img.set(sx + x, sy + y, mix(img.get(sx + x, sy + y) ?? C[2], C[0], y < 2 || x < 2 ? 0.55 : 0.22));
      },
    },
    {
      what: "broken",
      draw: (c, img, rng) => {
        // a slab broken into pieces: dark gaps between them, each piece's edge lit
        const [sx, sy] = slab(rng);
        const mx = sx + 5 + rng() * 6, my = sy + 5 + rng() * 6;
        for (const [ex, ey] of [[sx + 1, sy + 1 + rng() * 12], [sx + 14, sy + 2 + rng() * 11], [sx + 3 + rng() * 10, sy + 14]] as const) crack(img, c, wander(rng, mx, my, ex, ey, 1.5, 2), 1.1);
      },
    },
    {
      what: "weedy",
      draw: (c, img, rng) => {
        // weeds and moss in the joints
        for (const [x, y] of [[15, 6 + rng() * 6], [6 + rng() * 6, 15], [15, 20 + rng() * 6]] as const) {
          moss(img, c, x, y, 2, 2.5, seedOf("jm") + c.seed + Math.round(y));
          if (rng() < 0.7) weeds(img, c, rng, Math.round(x), Math.round(y) + 1, 3);
        }
      },
    },
    {
      what: "grime",
      draw: (c, img) => {
        for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if ((x & 15) >= 14 || (y & 15) >= 14) put(img, x, y, al(c.P.outline, 80 * vnoise(x / 6, y / 6, c.seed + 5)));
      },
    },
  ],
  metal_plate: [
    {
      what: "dent",
      draw: (c, img, rng) => {
        // a dent: shadow on the side towards the light, a lit far rim
        const cx = 9 + rng() * 14, cy = 9 + rng() * 14, P = c.P.mat.plate;
        for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
          const d = Math.hypot((x - cx) / 6, (y - cy) / 4.5);
          if (d < 1) put(img, x, y, (x - cx) + (y - cy) < -1 ? al(c.P.outline, 90 * (1 - d)) : al(P[4], 70 * (1 - d)));
        }
      },
    },
    { what: "rust_streak", draw: (c, img, rng) => rustStreaks(img, c, rng, 3) },
    {
      what: "rust",
      draw: (c, img, rng) => {
        const R = c.P.mat.rust, cx = 8 + rng() * 16, cy = 8 + rng() * 16, s = seedOf("rust") + c.seed;
        for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
          const d = blob(x, y, cx, cy, 9, 7, s, 0.6);
          if (d < 1) put(img, x, y, al(hash2(x >> 1, y >> 1, s) < 0.3 ? R[1] : d < 0.5 ? R[2] : R[3], d < 0.7 ? 200 : 120));
        }
      },
    },
    {
      what: "scratched",
      draw: (c, img, rng) => {
        for (let k = 0; k < 5; k++) {
          const x = rng() * 10, y = 4 + rng() * 24, len = 10 + rng() * 14, s = rng() * 0.5 - 0.25;
          for (let i = 0; i < len; i++) put(img, x + i, y + i * s, al(c.P.mat.plate[4], 60));
        }
      },
    },
    {
      what: "bolt_gone",
      draw: (c, img, rng) => {
        const [x, y] = ([[3, 3], [27, 3], [3, 27], [27, 27]] as const)[Math.floor(rng() * 4)]!;
        img.rect(x, y, 2, 2, c.P.outline);
        for (let i = 1; i < 8; i++) put(img, x + (i % 2), y + 2 + i, al(c.P.mat.rust[2], 160 - i * 18));
      },
    },
    {
      what: "worn",
      draw: (c, img, rng) => {
        // the tread worn flat in a band where everyone walks
        const P = c.P.mat.plate, y0 = 6 + rng() * 16;
        for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (Math.abs(y - y0) < 5 && x > 0 && x < 31 && y > 0 && y < 31) img.set(x, y, mix(img.get(x, y) ?? P[2], P[2], 0.75));
      },
    },
    { what: "oil", draw: (c, img, rng) => oilBlot(img, c, 8 + rng() * 16, 8 + rng() * 16, 7, 5, seedOf("poil") + c.seed) },
  ],
  grating: [
    {
      what: "bent",
      draw: (c, img, rng) => {
        const y = 4 * (1 + Math.floor(rng() * 6)), P = c.P.mat.plate;
        for (let x = 3; x < 15; x++) {
          const sag = Math.round(Math.sin(((x - 3) / 12) * Math.PI) * 2);
          img.set(x, y, c.P.outline);
          img.set(x, y + 1, c.P.outline);
          img.set(x, y + sag, P[3]);
          img.set(x, y + sag + 1, P[1]);
        }
      },
    },
    {
      what: "missing",
      draw: (c, img, rng) => {
        const y = 4 * (1 + Math.floor(rng() * 6));
        for (let x = 18; x < 32; x++) {
          img.set(x, y, c.P.outline);
          img.set(x, y + 1, c.P.outline);
        }
      },
    },
    { what: "rust", draw: (c, img, rng) => rustStreaks(img, c, rng, 2) },
    {
      what: "debris",
      draw: (c, img, rng) => {
        // paper and leaves caught on the bars
        const x = 6 + rng() * 16, y = 8 + rng() * 14;
        for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) put(img, x + i, y + j - (i > 3 ? 1 : 0), al(c.P.mat.plaster[i + j < 3 ? 3 : 2], 220));
        for (let k = 0; k < 4; k++) put(img, x + 8 + rng() * 6, y + rng() * 6, c.P.mat.leaf[k % 2 ? 1 : 2]);
      },
    },
  ],
  lab_tile: [
    { what: "cracked", draw: (c, img, rng) => hairline(img, c, rng, 1 + rng() * 6, 2 + rng() * 6, 30, 22 + rng() * 8, 0.85) },
    {
      what: "missing",
      draw: (c, img, rng) => {
        // a few small tiles gone: the grey screed under them, a lip of shadow at their top and left
        const C = c.P.mat.concrete, gx = Math.floor(rng() * 3), gy = Math.floor(rng() * 3);
        const cells = [[gx, gy], [gx + 1, gy], [gx, gy + 1], ...(rng() < 0.6 ? [[gx + 1, gy + 1]] : [])];
        for (const [tx, ty] of cells) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
          const px = tx! * 8 + x, py = ty! * 8 + y, h = hash2(px, py, c.seed + 13);
          img.set(px, py, y === 0 || x === 0 ? mix(C[0], c.P.outline, 0.3) : h < 0.15 ? C[1] : h > 0.9 ? C[3] : C[2]);
        }
        stones(img, rng, 3, c.P.mat.tile, gx * 8 + 2, gy * 8 + 2, gx * 8 + 14, gy * 8 + 14);
      },
    },
    {
      what: "chipped",
      draw: (c, img, rng) => {
        const T2 = c.P.mat.tile, x = 8 * Math.floor(rng() * 4) + 5, y = 8 * Math.floor(rng() * 4) + 5;
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3 - i; j++) img.set(x + i - 1, y + j - 1, i === 0 || j === 0 ? T2[0] : c.P.mat.concrete[1]);
      },
    },
    {
      what: "stain",
      draw: (c, img, rng) => {
        // a dried spill: a pale ring with a darker edge
        const cx = 9 + rng() * 14, cy = 9 + rng() * 14, s = seedOf("lstain") + c.seed;
        for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
          const d = blob(x, y, cx, cy, 8, 6, s, 0.3);
          if (d < 1 && d > 0.82) put(img, x, y, al(mix(c.P.mat.rust[2], c.P.outline, 0.3), 90));
          else if (d <= 0.82) put(img, x, y, al(c.P.mat.rust[3], 26));
        }
      },
    },
    {
      what: "grime",
      draw: (c, img) => {
        for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if ((x & 7) === 7 || (y & 7) === 7) put(img, x, y, al(c.P.outline, 110 * vnoise(x / 5, y / 5, c.seed + 9)));
      },
    },
    {
      what: "growth",
      draw: (c, img, rng) => {
        // something green coming up between the tiles
        const x = 8 * (1 + Math.floor(rng() * 3)) - 1, y = 8 * (1 + Math.floor(rng() * 3)) - 1;
        moss(img, c, x, y, 3, 3, seedOf("lg") + c.seed);
        weeds(img, c, rng, x, y, 4);
      },
    },
    { what: "scorch", draw: (c, img, rng) => stain(img, c, 10 + rng() * 12, 10 + rng() * 12, 6, 5, seedOf("lsc") + c.seed, 110, mix(c.P.outline, c.P.mat.rust[0], 0.3)) },
    {
      what: "drain",
      draw: (c, img) => {
        // a floor drain, its grate rusted at the rim
        img.ellipse(16, 16, 4, 4, c.P.mat.tile[0]);
        img.ellipse(16, 16, 3, 3, c.P.mat.plate[1]);
        for (let x = 14; x <= 18; x += 2) img.rect(x, 14, 1, 5, mix(c.P.outline, c.P.mat.asphalt[0], 0.5));
        stain(img, c, 16, 18, 6, 4, c.seed + 3, 30, c.P.mat.rust[1]);
      },
    },
  ],
  marble: [
    { what: "hairline", draw: (c, img, rng) => hairline(img, c, rng, 3 + rng() * 6, 2, 26 + rng() * 4, 29, 0.42) },
    {
      what: "scuff",
      draw: (c, img, rng) => {
        // heel marks by a door: short dark arcs
        for (let k = 0; k < 4; k++) {
          const x = 6 + rng() * 18, y = 8 + rng() * 16;
          for (let i = 0; i < 5; i++) put(img, x + i, y + Math.round(Math.sin(i / 2) * 1.2), al(c.P.outline, 70));
        }
      },
    },
  ],
  platform: [
    { what: "crack", draw: (c, img, rng) => hairline(img, c, rng, 2 + rng() * 10, 1, 18 + rng() * 10, 30, 0.85) },
    {
      what: "chip",
      draw: (c, img, rng) => {
        const C = c.P.mat.concrete, cx = 8 + rng() * 16, cy = 8 + rng() * 14, s = seedOf("pchip") + c.seed;
        for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
          const d = blob(x, y, cx, cy, 5, 3.5, s, 0.5);
          if (d < 0.8) img.set(x, y, hash2(x, y, s) < 0.25 ? C[1] : mix(C[0], C[1], 0.5));
          else if (d < 1) img.set(x, y, x + y > cx + cy ? C[3] : C[0]);
        }
      },
    },
    {
      what: "gum",
      draw: (c, img, rng) => {
        for (let k = 0; k < 8; k++) put(img, 2 + rng() * 28, 2 + rng() * 26, al(c.P.outline, 100));
      },
    },
    { what: "stain", draw: (c, img, rng) => stain(img, c, 8 + rng() * 16, 8 + rng() * 14, 9, 5, seedOf("plst") + c.seed, 55) },
    { what: "soot", draw: (c, img, rng) => stain(img, c, 16 + (rng() * 2 - 1) * 6, 14, 13, 10, seedOf("soot") + c.seed, 70, mix(c.P.outline, c.P.mat.asphalt[0], 0.3)) },
    { what: "ballast", draw: (c, img, rng) => stones(img, rng, 18, c.P.mat.rock, 3, 3, 29, 28) },
  ],
  gap: [
    {
      what: "ballast",
      draw: (c, img, rng) => {
        const R = c.P.mat.rock.map((r) => mix(r, c.P.outline, 0.45)) as Ramp;
        stones(img, rng, 34, R, 1, 2, 31, 30);
      },
    },
    {
      what: "junk",
      draw: (c, img, rng) => {
        // a dropped rail chair and a can, far below
        const M = c.P.mat.metal.map((r) => mix(r, c.P.outline, 0.5)) as Ramp, x = 6 + rng() * 14, y = 10 + rng() * 10;
        img.rect(x, y, 7, 3, M[2]);
        img.rect(x, y, 7, 1, M[3]);
        img.rect(x + 10, y + 4, 3, 2, mix(c.P.mat.flower[2], c.P.outline, 0.5));
      },
    },
  ],
};

function rustStreaks(img: Img, c: Ctx, rng: () => number, n: number) {
  const R = c.P.mat.rust;
  for (let k = 0; k < n; k++) {
    const x = 3 + Math.floor(rng() * 26), len = 8 + Math.floor(rng() * 18), y0 = Math.floor(rng() * 8);
    for (let i = 0; i < len; i++) {
      const a = 170 * (1 - i / len);
      put(img, x, y0 + i, al(R[2], a));
      if (i % 3 !== 2) put(img, x + 1, y0 + i, al(R[1], a * 0.6));
    }
  }
}

function oilBlot(img: Img, c: Ctx, cx: number, cy: number, rx: number, ry: number, seed: number) {
  // a dark slick with a thin rainbow at its edge (the palette's two accents and a warm third, very faint)
  const hues = [c.P.accent[0][3], c.P.mat.gold[3], c.P.accent[1][3]];
  for (let y = Math.floor(cy - ry - 3); y <= cy + ry + 3; y++) for (let x = Math.floor(cx - rx - 3); x <= cx + rx + 3; x++) {
    const d = blob(x, y, cx, cy, rx, ry, seed, 0.35);
    if (d >= 1) continue;
    // the slick darkest in its middle, soft at its edge; the sheen only in a few broken stretches of the rim
    put(img, x, y, al(mix(c.P.outline, c.P.mat.asphalt[0], 0.3), 120 * Math.min(1, (1 - d) * 3)));
    if (d > 0.7 && vnoise(x / 2.5, y / 2.5, seed + 9) > 0.62) {
      const k = Math.floor(((Math.atan2(y - cy, x - cx) + Math.PI) / (2 * Math.PI)) * 5 + d * 2) % 3;
      put(img, x, y, al(mix(hues[k]!, c.P.outline, 0.45), 48));
    }
  }
  const hx = cx - rx * 0.3, hy = cy - ry * 0.4;
  for (let i = 0; i < 4; i++) put(img, hx + i, hy, al(c.P.mat.asphalt[4], 50));
}

// ---- wear features: see-through tiles laid over the ground ----------------------------------------------------------------

export interface WearTile {
  name: string;
  img: Img;
}

/// A drawing of `w` by `h` tiles cut into its tiles: "wear_<name>" at the top left, "wear_<name>@dx,dy" the others.
function stamp(out: WearTile[], name: string, w: number, h: number, draw: (img: Img) => void) {
  const img = new Img(w * T, h * T);
  draw(img);
  for (let r = 0; r < h; r++) for (let col = 0; col < w; col++) out.push({ name: col || r ? `wear_${name}@${col},${r}` : `wear_${name}`, img: img.part(col * T, r * T, T, T) });
}
const one = (out: WearTile[], name: string, draw: (img: Img) => void) => stamp(out, name, 1, 1, draw);

/// Where a crack crosses each side of a tile, so cracks in neighbouring tiles meet.
const ENTRY: Record<string, [number, number]> = { n: [13, -1], e: [32, 18], s: [13, 32], w: [-1, 18] };
export const CRACK_MASKS = ["n", "e", "s", "w", "ne", "ns", "nw", "es", "ew", "sw", "nes", "new", "nsw", "esw", "nesw"];

function pothole(img: Img, c: Ctx, cx: number, cy: number, rx: number, ry: number, seed: number, wet: boolean) {
  const A = c.P.mat.asphalt, Wa = c.P.mat.water, rng = rngOf(seed);
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const d = blob(x, y, cx, cy, rx, ry, seed, 0.4);
    if (d >= 1.1) continue;
    const toward = (x - cx) / rx + (y - cy) / ry; // the far side faces the light
    if (d >= 1) {
      // the torn edge of the top layer: a thin lip, lit on the near side, dark on the far
      put(img, x, y, toward < -0.3 ? al(A[4], 90) : toward > 0.3 ? al(c.P.outline, 120) : al(A[3], 40));
      continue;
    }
    if (d > 0.84) {
      // the torn top layer's inner wall: lit on the far side (it faces the light), in shadow on the near side
      img.set(x, y, toward > 0.2 ? mix(A[3], A[4], 0.3) : toward > -0.2 ? A[2] : mix(A[0], c.P.outline, 0.6));
      continue;
    }
    if (d > 0.72 && !wet) {
      // the base course under it: coarse grey-brown gravel
      const g = hash2(x, y, seed + 3);
      img.set(x, y, g < 0.3 ? mix(c.P.mat.path[2], A[2], 0.5) : g < 0.6 ? mix(c.P.mat.path[1], A[1], 0.5) : toward < 0 ? mix(A[0], c.P.outline, 0.4) : A[1]);
      continue;
    }
    if (wet) {
      const base = mix(Wa[1], A[0], 0.35);
      img.set(x, y, d > 0.68 && toward < 0 ? mix(base, c.P.outline, 0.4) : Math.abs(x - cx - (y - cy) * 0.3) < 1.2 && d < 0.6 ? mix(base, Wa[3], 0.55) : base);
    } else {
      // the floor of the hole, the rim's shadow across its near side
      const shadowed = toward < -0.25 && d > 0.45;
      img.set(x, y, shadowed ? mix(A[0], c.P.outline, 0.5) : hash2(x, y, seed + 1) < 0.2 ? mix(A[1], A[2], 0.5) : hash2(x, y, seed + 2) < 0.1 ? mix(c.P.mat.path[1], A[1], 0.5) : A[0]);
    }
  }
  // the asphalt round it is breaking up too: short cracks running out from the rim, loose crumbs
  for (let k = 0; k < 3; k++) {
    const a = rng() * Math.PI * 2, r0 = 1.05, r1 = 1.05 + 0.35 + rng() * 0.3;
    const x0 = cx + Math.cos(a) * rx * r0, y0 = cy + Math.sin(a) * ry * r0, x1 = cx + Math.cos(a) * rx * r1, y1 = cy + Math.sin(a) * ry * r1;
    if (x1 > 1 && y1 > 1 && x1 < img.w - 2 && y1 < img.h - 2) crack(img, c, wander(rng, x0, y0, x1, y1, 1.5, 2), 0.8, true);
  }
  stones(img, rng, Math.round(rx), A, cx - rx - 4, cy - ry - 3, cx + rx + 4, cy + ry + 4);
}

/// One tile of a rectangle drawn in nine parts (corners, sides, middle): `inside(x, y)` says how far in from each open side.
function nine(out: WearTile[], name: string, draw: (img: Img, open: { n: boolean; e: boolean; s: boolean; w: boolean }) => void) {
  for (const [part, n, e, s, w] of [["nw", 1, 0, 0, 1], ["n", 1, 0, 0, 0], ["ne", 1, 1, 0, 0], ["w", 0, 0, 0, 1], ["c", 0, 0, 0, 0], ["e", 0, 1, 0, 0], ["sw", 0, 0, 1, 1], ["s", 0, 0, 1, 0], ["se", 0, 1, 1, 0]] as const) {
    const img = new Img(T, T);
    draw(img, { n: !!n, e: !!e, s: !!s, w: !!w });
    out.push({ name: `wear_${name}_${part}`, img });
  }
}

/// A seam that wanders by a pixel or two along a side but is back on its line at both ends, so sides join.
const seamWobble = (i: number, seed: number) => Math.round(Math.sin((i / 31) * Math.PI) * (hash2(seed, 3, 7) * 2 - 1) * 1.6);

export function wearTiles(c: Ctx): WearTile[] {
  const out: WearTile[] = [];
  const A = c.P.mat.asphalt, C = c.P.mat.concrete;
  // painted road markings, faded: white for crossings and bays, a dull yellow for lines and boxes
  const paintW = mix(C[4], [232, 230, 220, 255], 0.35), paintY = mix(c.P.mat.gold[3], C[3], 0.35);
  const faded = (img: Img, x: number, y: number, col: Rgba, worn: number, seed: number) => {
    // worn through to the tarmac in broad soft holes (never in small shapes that could read as writing), with grit in it
    const n = 0.8 * vnoise(x / 10, y / 10, seed) + 0.2 * vnoise(x / 3, y / 3, seed + 1);
    // (faded softly, not cut: hard holes in a stripe read as letters)
    const keep = smooth01((n - worn) / 0.28);
    if (keep <= 0.05) return;
    put(img, x, y, al(col, (hash2(x, y, seed) < 0.14 ? 55 : 96) * keep));
  };

  // cracks that wander from tile to tile, joining at fixed points on each side, with forks in the tiles where three meet
  for (const m of CRACK_MASKS) for (let v = 0; v < (m.length === 2 ? 2 : 1); v++) {
    one(out, `crack_${m}${v ? `_${v + 1}` : ""}`, (img) => {
      const rng = rngOf(seedOf(`crack/${m}/${v}`) + c.seed);
      const hub: [number, number] = [13 + (rng() * 2 - 1) * 4, 18 + (rng() * 2 - 1) * 4];
      for (const side of m) {
        const [ex, ey] = ENTRY[side]!;
        crack(img, c, wander(rng, ex, ey, hub[0], hub[1], 3, 3), 1, m.length === 1);
      }
      if (m.length >= 2 && rng() < 0.7) hairline(img, c, rng, hub[0], hub[1], hub[0] + (rng() * 2 - 1) * 10, hub[1] + (rng() * 2 - 1) * 10, 0.5);
    });
  }
  // potholes: small and large, dry and holding water
  for (let v = 0; v < 2; v++) one(out, `pothole${v ? "_2" : ""}`, (img) => pothole(img, c, 15 + v, 16 - v, 10 - v, 7.5, seedOf(`ph${v}`) + c.seed, false));
  one(out, "pothole_wet", (img) => pothole(img, c, 16, 16, 10.5, 7.5, seedOf("phw") + c.seed, true));
  stamp(out, "pothole_big", 2, 2, (img) => pothole(img, c, 31, 32, 20, 15, seedOf("phb") + c.seed, false));
  stamp(out, "pothole_big_wet", 2, 2, (img) => pothole(img, c, 32, 31, 21, 14, seedOf("phbw") + c.seed, true));
  // the same holes indoors and on a pavement: small floor tiles gone over a ragged area, showing the screed; slabs gone,
  // showing the earth, with broken bits in it
  stamp(out, "tiles_gone", 2, 2, (img) => {
    const Tl = c.P.mat.tile, s = seedOf("tilesgone") + c.seed;
    for (let ty = 0; ty < 8; ty++) for (let tx = 0; tx < 8; tx++) {
      const d = blob(tx * 8 + 4, ty * 8 + 4, 32, 31, 22, 18, s, 0.6);
      if (d >= 1) continue;
      const broken = d > 0.8; // a tile at the rim is cracked, not gone
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const px = tx * 8 + x, py = ty * 8 + y, k = hash2(px, py, s);
        if (broken) {
          if (x + y === 5 || (x === 3 && y > 3)) img.set(px, py, Tl[0]);
          continue;
        }
        img.set(px, py, y === 0 || x === 0 ? mix(C[0], c.P.outline, 0.35) : k < 0.12 ? C[1] : k > 0.92 ? C[3] : mix(C[1], C[2], 0.6));
      }
    }
    stones(img, rngOf(s), 8, Tl, 16, 16, 48, 46);
  });
  stamp(out, "slabs_gone", 2, 2, (img) => {
    const d0 = c.P.mat.path, s = seedOf("slabsgone") + c.seed, rng = rngOf(s);
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const d = blob(sx * 16 + 8, sy * 16 + 8, 32, 32, 26, 22, s, 0.5);
      if (d >= 0.9) continue;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const px = sx * 16 + x, py = sy * 16 + y, k = hash2(px, py, s);
        img.set(px, py, y < 2 || x < 2 ? mix(d0[0], c.P.outline, 0.5) : k < 0.12 ? d0[3] : k < 0.3 ? d0[1] : d0[2]);
      }
    }
    stones(img, rng, 14, C, 10, 10, 54, 54);
    for (let k = 0; k < 2; k++) weeds(img, c, rng, 16 + Math.floor(rng() * 32), 22 + Math.floor(rng() * 30), 4);
  });
  // broad tone over several tiles, laid in a layer under the features: damp ground, dry dust, a lane polished by wheels.
  // Soft and faint, and gone well inside the stamp's edge, so it never shows a tile's square.
  const soft = (img: Img, cx: number, cy: number, rx: number, ry: number, seed: number, col: Rgba, a: number) => {
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
      const d = blob(x, y, cx, cy, rx, ry, seed, 0.22);
      if (d < 1) put(img, x, y, al(col, a * smooth01((1 - d) / 0.45)));
    }
  };
  const dampCol = mix(c.P.outline, A[0], 0.3);
  for (let v = 0; v < 2; v++) stamp(out, `damp${v ? "_2" : ""}`, 2, 2, (img) => {
    soft(img, 31 + v * 2, 32 - v, 21 - v * 2, 20, seedOf(`damp${v}`) + c.seed, dampCol, 84);
    soft(img, 24 + v * 14, 26 + v * 8, 8, 6, seedOf(`dampc${v}`) + c.seed, dampCol, 26);
  });
  stamp(out, "damp_wide", 3, 2, (img) => soft(img, 48, 31, 36, 20, seedOf("dampw") + c.seed, dampCol, 78));
  for (let v = 0; v < 2; v++) stamp(out, `dust${v ? "_2" : ""}`, 2, 2, (img) => {
    soft(img, 32, 31, 21, 19, seedOf(`dust${v}`) + c.seed, C[3], 24);
    stones(img, rngOf(seedOf(`dusts${v}`) + c.seed), 5, C, 18, 18, 46, 46);
  });
  stamp(out, "lane", 3, 1, (img) => {
    for (let y = 0; y < T; y++) for (let x = 0; x < 96; x++) {
      const f = Math.min(1, x / 18, (95 - x) / 18) * (1 - Math.abs(y - 15.5 - Math.sin(x / 17)) / 9);
      if (f > 0) put(img, x, y, al(A[4], 20 * smooth01(f)));
    }
  });
  // a crazed stretch: the surface broken into small plates (the way old tarmac goes before it falls in), darkened, a few
  // plates gone; over two by two tiles, faded out at its edge
  for (let v = 0; v < 2; v++) stamp(out, `crazed${v ? "_2" : ""}`, 2, 2, (img) => {
    const s = seedOf(`crazed${v}`) + c.seed, rng = rngOf(s);
    const pts: [number, number][] = [];
    for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 5; gx++) pts.push([10 + gx * 11 + (rng() * 2 - 1) * 4, 10 + gy * 11 + (rng() * 2 - 1) * 4]);
    const inside = (x: number, y: number) => blob(x, y, 32, 32, 24, 21, s, 0.3) < 1;
    stain(img, c, 32, 32, 20, 17, s + 1, 40);
    for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 5; gx++) {
      const p = pts[gy * 5 + gx]!;
      for (const [nx, ny] of [[gx + 1, gy], [gx, gy + 1]] as const) {
        if (nx > 4 || ny > 4) continue;
        const q = pts[ny * 5 + nx]!;
        if (inside(p[0], p[1]) && inside(q[0], q[1]) && rng() < 0.8) crack(img, c, wander(rng, p[0], p[1], q[0], q[1], 2.5, 2), 0.62);
      }
    }
    // a few plates gone: the dark base showing, their far edges lit
    for (let k = 0; k < 3 + v; k++) {
      const p = pts[6 + Math.floor(rng() * 13)]!;
      for (let y = -3; y <= 3; y++) for (let x = -4; x <= 4; x++) {
        const d = blob(p[0] + x, p[1] + y, p[0], p[1], 3.6, 2.6, s + k, 0.4);
        if (d < 0.8) img.set(p[0] + x, p[1] + y, hash2(x, y, s + k) < 0.2 ? A[1] : mix(A[0], c.P.outline, 0.45));
        else if (d < 1 && x + y > 0) img.set(p[0] + x, p[1] + y, mix(A[2], A[3], 0.5));
      }
    }
  });
  // a repaired trench or patch: newer, smoother tarmac in a tar outline
  nine(out, "patch", (img, o) => {
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const dn = o.n ? y - 3 - seamWobble(x, 1) : 99, ds = o.s ? 28 - y - seamWobble(x, 2) : 99, dw = o.w ? x - 3 - seamWobble(y, 3) : 99, de = o.e ? 28 - x - seamWobble(y, 4) : 99;
      const d = Math.min(dn, ds, dw, de);
      if (d < 0) continue;
      // (a little see-through: the old surface still shows faintly through the new)
      if (d < 1) put(img, x, y, al(A[0], 200));
      else if (d < 2) put(img, x, y, al(mix(A[0], A[1], 0.5), 190));
      else if (d < 3 && (dn < 3 || dw < 3)) put(img, x, y, al(A[3], 60));
      else put(img, x, y, al(hash2(x, y, c.seed + 72) < 0.03 ? mix(A[2], A[3], 0.3) : mix(A[1], A[2], 0.7), 205));
    }
  });
  // a sunken stretch: a soft hollow, shadowed on the side towards the light, cracked round part of its edge
  stamp(out, "sunken", 2, 2, (img) => {
    const rng = rngOf(seedOf("sunken") + c.seed);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const d = blob(x, y, 32, 32, 25, 22, c.seed + 81, 0.25);
      if (d >= 1) continue;
      const toward = (x - 32) / 25 + (y - 32) / 22;
      put(img, x, y, toward < -0.4 && d > 0.6 ? al(c.P.outline, 90 * (d - 0.6) * 2.5) : toward > 0.5 && d > 0.75 ? al(A[4], 34) : al(c.P.outline, 40 * (1 - d)));
    }
    crack(img, c, wander(rng, 10, 26, 30, 9, 3, 4), 0.9);
    crack(img, c, wander(rng, 30, 9, 50, 14, 3, 3), 0.9, true);
  });
  // markings
  for (let v = 0; v < 2; v++) {
    const worn = v ? 0.4 : 0.12;
    one(out, `line_h${v ? "_2" : ""}`, (img) => {
      for (let y = 15; y < 18; y++) for (let x = 4; x < 28; x++) faded(img, x, y, paintY, worn, c.seed + 11 + v);
    });
    one(out, `line_v${v ? "_2" : ""}`, (img) => {
      for (let y = 4; y < 28; y++) for (let x = 15; x < 18; x++) faded(img, x, y, paintY, worn, c.seed + 13 + v);
    });
    one(out, `zebra${v ? "_2" : ""}`, (img) => {
      for (const y0 of [4, 20]) for (let y = y0; y < y0 + 9; y++) for (let x = 0; x < T; x++) faded(img, x, y, paintW, worn, c.seed + 15 + v);
    });
    one(out, `zebra_v${v ? "_2" : ""}`, (img) => {
      for (const x0 of [4, 20]) for (let x = x0; x < x0 + 9; x++) for (let y = 0; y < T; y++) faded(img, x, y, paintW, worn, c.seed + 17 + v);
    });
  }
  one(out, "stop", (img) => {
    for (let y = 0; y < T; y++) for (let x = 13; x < 17; x++) faded(img, x, y, paintW, 0.24, c.seed + 19);
  });
  one(out, "stop_v", (img) => {
    for (let x = 0; x < T; x++) for (let y = 13; y < 17; y++) faded(img, x, y, paintW, 0.24, c.seed + 20);
  });
  const arrow = (img: Img, dir: "r" | "l" | "u" | "d") => {
    const long = dir === "r" || dir === "l" ? img.w : img.h;
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
      // along: 0 at the tail, long at the tip; across: from the arrow's middle line
      const along = dir === "r" ? x : dir === "l" ? long - 1 - x : dir === "d" ? y : long - 1 - y, across = Math.abs((dir === "r" || dir === "l" ? y : x) - 15.5);
      const shaft = along >= 8 && along < 40 && across < 2.5, head = along >= 38 && along < 58 && across < (58 - along) * 0.5;
      if (shaft || head) faded(img, x, y, paintW, 0.26, c.seed + 21);
    }
  };
  stamp(out, "arrow_r", 2, 1, (img) => arrow(img, "r"));
  stamp(out, "arrow_l", 2, 1, (img) => arrow(img, "l"));
  stamp(out, "arrow_d", 1, 2, (img) => arrow(img, "d"));
  stamp(out, "arrow_u", 1, 2, (img) => arrow(img, "u"));
  // a parking bay's divider, its foot away from the kerb
  for (const up of [false, true]) one(out, up ? "bay_up" : "bay", (img) => {
    for (let y = 0; y < T; y++) for (let x = 0; x < 3; x++) faded(img, x, y, paintW, 0.3, c.seed + 23);
    const fy = up ? 0 : 29;
    for (let x = 0; x < 9; x++) for (let y = fy; y < fy + 3; y++) faded(img, x, y, paintW, 0.3, c.seed + 24);
  });
  // a hatched box at a junction
  nine(out, "hatch", (img, o) => {
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const d = Math.min(o.n ? y - 3 : 99, o.s ? 28 - y : 99, o.w ? x - 3 : 99, o.e ? 28 - x : 99);
      if (d < 0) continue;
      if (d < 3 || ((x + y) & 15) < 3) faded(img, x, y, paintY, 0.3, c.seed + 25);
    }
  });
  // a drain at the kerb, and the stain running from it
  stamp(out, "drain", 1, 2, (img) => {
    const P = c.P.mat.plate;
    img.rect(5, 1, 22, 9, c.P.outline);
    img.rect(6, 2, 20, 7, P[1]);
    img.rect(6, 2, 20, 1, P[3]);
    for (let x = 8; x < 25; x += 3) img.rect(x, 4, 2, 4, mix(c.P.outline, A[0], 0.3));
    for (let y = 10; y < 52; y++) for (let x = 2; x < 30; x++) {
      const spread = 9 + (y - 10) * 0.18, f = 1 - Math.abs(x - 16 + Math.sin(y / 6) * 2) / spread;
      if (f > 0) put(img, x, y, al(mix(c.P.outline, c.P.mat.rust[0], 0.3), 70 * f * (1 - (y - 10) / 44)));
    }
  });
  one(out, "stain_trail", (img) => {
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const f = 1 - Math.abs(x - 15 - Math.sin(y / 5) * 2) / (7 + y * 0.15);
      if (f > 0) put(img, x, y, al(mix(c.P.outline, c.P.mat.rust[0], 0.35), 75 * f * (1 - y / 34)));
    }
  });
  one(out, "stain_ring", (img) => stain(img, c, 16, 14, 13, 10, c.seed + 27, 46, mix(c.P.outline, c.P.mat.rust[0], 0.3)));
  // oil
  for (let v = 0; v < 2; v++) one(out, `oil${v ? "_2" : ""}`, (img) => oilBlot(img, c, 15 + v * 2, 16 - v, 9 - v * 2, 6, seedOf(`oil${v}`) + c.seed));
  stamp(out, "oil_long", 2, 1, (img) => {
    oilBlot(img, c, 22, 16, 14, 6, seedOf("oill") + c.seed);
    oilBlot(img, c, 46, 18, 6, 4, seedOf("oill2") + c.seed);
  });
  // tyre marks along a lane, and a skid
  stamp(out, "tyre", 3, 1, (img) => {
    for (let x = 0; x < 96; x++) for (const y0 of [9, 22]) {
      const y = y0 + Math.round(Math.sin(x / 30) * 1.5), a = 64 * Math.sin((x / 95) * Math.PI) * (vnoise(x / 5, y0, c.seed + 29) > 0.3 ? 1 : 0.3);
      for (let k = 0; k < 3; k++) put(img, x, y + k, al(c.P.outline, a * (k === 1 ? 1 : 0.6)));
    }
  });
  stamp(out, "skid", 2, 1, (img) => {
    for (let x = 0; x < 64; x++) for (const y0 of [8, 21]) {
      const y = y0 + Math.round(((x - 10) / 54) ** 2 * 7), a = 80 * Math.min(1, x / 10) * (1 - x / 70);
      if (x > 6) for (let k = 0; k < 3; k++) put(img, x, y + k, al(c.P.outline, a));
    }
  });
  // scorch: soot thrown out in rays round a black core
  const scorch = (img: Img, cx: number, cy: number, r: number, seed: number) => {
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
      const ang = Math.atan2(y - cy, x - cx), reach = r * (0.7 + 0.45 * vnoise(ang * 2.2 + 10, 3, seed));
      const d = Math.hypot(x - cx, (y - cy) * 1.2) / reach;
      if (d < 1) put(img, x, y, al(mix(c.P.outline, c.P.mat.rust[0], 0.25), 150 * (1 - d) ** 1.4 + (d < 0.3 ? 40 : 0)));
      if (d < 0.9 && hash2(x, y, seed) < 0.03) put(img, x, y, al(C[3], 90));
    }
  };
  stamp(out, "scorch", 2, 2, (img) => scorch(img, 32, 32, 27, seedOf("scorch") + c.seed));
  one(out, "scorch_small", (img) => scorch(img, 16, 16, 13, seedOf("scorch1") + c.seed));
  // litter
  const items: ((img: Img, x: number, y: number) => void)[] = [
    (img, x, y) => {
      // a can on its side
      const r = c.P.mat.flower;
      img.rect(x, y, 7, 4, r[2]);
      img.rect(x, y, 7, 1, r[4]);
      img.rect(x, y + 3, 7, 1, r[0]);
      img.rect(x + 6, y, 1, 4, c.P.mat.metal[3]);
    },
    (img, x, y) => {
      // a crumpled sheet of paper
      const p = c.P.mat.plaster;
      for (let j = 0; j < 5; j++) for (let i = 0; i < 7; i++) if (!((i === 0 || i === 6) && (j === 0 || j === 4))) img.set(x + i, y + j, (i + j) % 4 === 0 ? p[1] : j < 2 ? p[4] : p[3]);
    },
    (img, x, y) => {
      // a crushed box
      const w = c.P.mat.wood;
      img.rect(x, y, 10, 6, w[2]);
      img.rect(x, y, 10, 1, w[4]);
      img.rect(x + 3, y + 1, 1, 5, w[1]);
      img.rect(x + 7, y + 2, 3, 4, w[1]);
    },
    (img, x, y) => {
      // a bottle
      const g = c.P.mat.leaf;
      img.rect(x, y, 6, 3, g[2]);
      img.rect(x + 6, y + 1, 3, 1, g[1]);
      img.rect(x + 1, y, 3, 1, g[4]);
    },
    (img, x, y) => {
      // a bin bag, split
      const d = c.P.mat.roof;
      img.ellipse(x + 4, y + 3, 5, 3.2, d[1]);
      img.ellipse(x + 3, y + 2, 2.5, 1.4, d[3]);
      img.rect(x + 7, y + 4, 3, 1, c.P.mat.plaster[3]);
    },
  ];
  for (let v = 0; v < 4; v++) one(out, `litter${v ? `_${v + 1}` : ""}`, (img) => {
    const rng = rngOf(seedOf(`litter${v}`) + c.seed), body = new Img(T, T);
    const n = 1 + (v % 2) + (v === 3 ? 1 : 0);
    for (let k = 0; k < n; k++) items[(v * 2 + k) % items.length]!(body, 4 + Math.floor(rng() * 16), 6 + Math.floor(rng() * 16));
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (body.has(x, y) && !body.has(x + 1, y + 1)) put(img, x + 1, y + 1, al(c.P.outline, 90));
    img.draw(body.outline(mix(c.P.outline, A[1], 0.3)));
  });
  // cables lying along the floor, and where they end
  const cableRow = (img: Img, x0: number, x1: number, dy: number) => {
    for (const [y0, r] of [[12 + dy, c.P.mat.roof], [17 + dy, c.P.mat.plate]] as const) for (let x = x0; x < x1; x++) {
      const y = Math.round(y0 + Math.sin((x + y0 * 3) / 7) * 1.2);
      put(img, x, y - 1, al(r[3], 220));
      put(img, x, y, al(r[1], 230));
      put(img, x, y + 1, al(c.P.outline, 120));
    }
  };
  for (let v = 0; v < 2; v++) one(out, `cable_h${v ? "_2" : ""}`, (img) => cableRow(img, 0, 32, v * 3));
  one(out, "cable_l", (img) => {
    cableRow(img, 12, 32, 0);
    img.rect(5, 9, 8, 12, c.P.mat.plate[1]);
    img.rect(5, 9, 8, 1, c.P.mat.plate[3]);
    img.rect(5, 20, 8, 1, c.P.outline);
  });
  one(out, "cable_r", (img) => {
    cableRow(img, 0, 22, 0);
    img.rect(21, 15, 4, 3, c.P.mat.metal[3]);
  });
  // growth
  for (let v = 0; v < 2; v++) one(out, `weeds${v ? "_2" : ""}`, (img) => {
    const rng = rngOf(seedOf(`weeds${v}`) + c.seed);
    moss(img, c, 14 + v * 4, 20, 5, 3, c.seed + 31 + v);
    for (let k = 0; k < 2 + v; k++) weeds(img, c, rng, 8 + Math.floor(rng() * 16), 16 + Math.floor(rng() * 10), 4);
  });
  for (let v = 0; v < 2; v++) one(out, `moss${v ? "_2" : ""}`, (img) => {
    moss(img, c, 12 + v * 6, 14 + v * 3, 9 - v * 2, 6, c.seed + 35 + v);
    moss(img, c, 22 - v * 12, 24, 4, 3, c.seed + 37 + v);
  });
  // rubble against a wall, and a fallen block of masonry with its bars bent out
  const chunk = (img: Img, x: number, y: number, w: number, h: number, r: Ramp) => {
    img.rect(x, y, w, h, r[2]);
    img.rect(x, y, w, 1, r[4]);
    img.rect(x, y, 1, h, r[3]);
    img.rect(x + w - 1, y + 1, 1, h - 1, r[1]);
    img.rect(x, y + h - 1, w, 1, r[0]);
  };
  for (let v = 0; v < 2; v++) one(out, `rubble${v ? "_2" : ""}`, (img) => {
    const rng = rngOf(seedOf(`rubble${v}`) + c.seed), body = new Img(T, T);
    img.ellipse(16, 22, 13, 6, al(c.P.outline, 80));
    for (let k = 0; k < 9; k++) chunk(body, 4 + Math.floor(rng() * 20), 8 + Math.floor(rng() * 14) + (k < 4 ? 4 : 0), 3 + Math.floor(rng() * 5), 2 + Math.floor(rng() * 4), C);
    img.draw(body.outline(c.P.outline));
    stones(img, rng, 8, C, 2, 22, 30, 30);
  });
  stamp(out, "masonry", 2, 1, (img) => {
    const rng = rngOf(seedOf("masonry") + c.seed), body = new Img(64, 32);
    img.ellipse(32, 24, 28, 6, al(c.P.outline, 80));
    chunk(body, 6, 9, 22, 14, C);
    chunk(body, 30, 13, 16, 11, C);
    chunk(body, 46, 18, 8, 6, C);
    for (const [x, y, dx, dy] of [[12, 9, -3, -6], [20, 9, 2, -7], [36, 13, 5, -5]] as const) for (let i = 0; i < 7; i++) body.set(x + (dx * i) / 7, y + (dy * i) / 7, c.P.mat.rust[i < 3 ? 2 : 3]);
    img.draw(body.outline(c.P.outline));
    stones(img, rng, 10, C, 2, 22, 62, 30);
  });
  // where the ground meets a wall: grime and old water marks, darkest against the wall
  for (let v = 0; v < 3; v++) one(out, `grime${v ? `_${v + 1}` : ""}`, (img) => {
    const reach = 10 + v * 6;
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const edge = reach + (vnoise(x / 5, 0, c.seed + 41 + v) - 0.5) * 8;
      if (y < edge) put(img, x, y, al(c.P.outline, 120 * (1 - y / edge) ** 1.6));
      if (v && y < edge + 6 && vnoise(x / 2, 7, c.seed + 43) > 0.72) put(img, x, y, al(mix(c.P.outline, c.P.mat.rust[0], 0.4), 40 * (1 - y / (edge + 6))));
    }
  });
  // on the faces of walls (drawn from 12 pixels down: the face of a detailed wall)
  for (let v = 0; v < 3; v++) one(out, `wall_drip${v ? `_${v + 1}` : ""}`, (img) => {
    const rng = rngOf(seedOf(`drip${v}`) + c.seed);
    for (let k = 0; k < 3 + v; k++) {
      const x = 2 + Math.floor(rng() * 28), len = 5 + Math.floor(rng() * 14), w = rng() < 0.4 ? 2 : 1;
      for (let i = 0; i < len; i++) for (let j = 0; j < w; j++) put(img, x + j, 13 + i, al(mix(c.P.outline, C[0], 0.3), 110 * (1 - i / len)));
    }
  });
  one(out, "wall_soot", (img) => {
    for (let y = 12; y < 31; y++) for (let x = 1; x < 31; x++) {
      const f = 1 - Math.abs(x - 16) / (6 + (31 - y) * 0.5);
      if (f > 0) put(img, x, y, al(c.P.outline, 120 * f * (0.4 + 0.6 * vnoise(x / 3, y / 3, c.seed + 47))));
    }
  });
  for (let v = 0; v < 2; v++) one(out, `wall_crack${v ? "_2" : ""}`, (img) => {
    const rng = rngOf(seedOf(`wcrack${v}`) + c.seed);
    crack(img, c, wander(rng, 6 + v * 14, 12, 16 + v * 6, 30, 4, 5), 0.75);
    hairline(img, c, rng, 12 + v * 8, 20, 26 - v * 18, 26, 0.6);
  });
  for (let v = 0; v < 2; v++) one(out, `wall_rust${v ? "_2" : ""}`, (img) => {
    const rng = rngOf(seedOf(`wrust${v}`) + c.seed), R = c.P.mat.rust;
    for (let k = 0; k < 4; k++) {
      const x = 2 + Math.floor(rng() * 28), len = 6 + Math.floor(rng() * 12);
      for (let i = 0; i < len; i++) put(img, x, 13 + i, al(i % 2 ? R[3] : R[2], 150 * (1 - i / len)));
    }
  });
  // a platform's edge broken away, and ballast thrown up onto it
  for (let v = 0; v < 2; v++) one(out, `edge_chip${v ? "_2" : ""}`, (img) => {
    const cx = 8 + v * 14, s = c.seed + 51 + v;
    for (let y = 14; y < 32; y++) for (let x = 0; x < T; x++) {
      const d = blob(x, y, cx, 23, 6, 6, s, 0.5);
      if (d < 0.85) img.set(x, y, hash2(x, y, s) < 0.2 ? C[1] : mix(C[0], c.P.outline, 0.5));
      else if (d < 1) img.set(x, y, x + y > cx + 23 ? C[3] : c.P.outline);
    }
  });
  one(out, "ballast", (img) => stones(img, rngOf(seedOf("ballast") + c.seed), 22, c.P.mat.rock, 2, 4, 30, 30));
  // indoors: equipment dragged across the floor, a spill, broken glass
  stamp(out, "scratch", 3, 1, (img) => {
    for (const y0 of [10, 13, 22]) for (let x = 4; x < 92; x++) {
      const y = y0 + Math.round(Math.sin(x / 23) * 1.5);
      if (vnoise(x / 4, y0, c.seed + 53) > 0.25) {
        put(img, x, y, al(c.P.mat.tile[4], 60));
        put(img, x, y + 1, al(c.P.outline, 40));
      }
    }
  });
  const spill = (img: Img, cx: number, cy: number, rx: number, ry: number, seed: number) => {
    const liquid = mix(c.P.mat.leaf[1], c.P.mat.water[2], 0.5);
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
      const d = blob(x, y, cx, cy, rx, ry, seed, 0.6);
      if (d < 1) put(img, x, y, al(d > 0.85 ? mix(liquid, c.P.outline, 0.4) : liquid, d > 0.85 ? 170 : 130));
    }
    for (let i = 0; i < 5; i++) put(img, cx - rx * 0.4 + i, cy - ry * 0.3, al(WHITE, 50));
  };
  one(out, "spill", (img) => spill(img, 16, 16, 9, 6, seedOf("spill") + c.seed));
  stamp(out, "spill_long", 2, 1, (img) => {
    spill(img, 24, 15, 15, 6, seedOf("spill2") + c.seed);
    spill(img, 48, 19, 6, 3, seedOf("spill3") + c.seed);
  });
  one(out, "glass", (img) => {
    const rng = rngOf(seedOf("glass") + c.seed), G = c.P.mat.glass;
    for (let k = 0; k < 9; k++) {
      const x = 4 + rng() * 24, y = 5 + rng() * 22, s = 1 + Math.floor(rng() * 3);
      for (let i = 0; i < s; i++) put(img, x + i, y - i * (rng() < 0.5 ? 0 : 1), al(i ? G[3] : mix(G[4], WHITE, 0.4), 210));
      put(img, x, y + 1, al(c.P.outline, 90));
    }
  });
  return out;
}

/// The outline of a pool drawn several ways: a smooth wobble per side, back to zero at both ends of the tile so every
/// version joins every other; `k` picks the version.
export function poolWobble(t: number, seed: number, amount: number): number[] {
  const rng = rngOf(seed);
  const a = [(rng() * 2 - 1) * amount, (rng() * 2 - 1) * amount * 0.5, (rng() * 2 - 1) * amount * 0.3];
  return Array.from({ length: t }, (_, i) => {
    const u = (i + 0.5) / t;
    return Math.round(a[0]! * Math.sin(u * Math.PI) + a[1]! * Math.sin(2 * u * Math.PI) + a[2]! * Math.sin(3 * u * Math.PI));
  });
}

export const clampWear = clamp01;
