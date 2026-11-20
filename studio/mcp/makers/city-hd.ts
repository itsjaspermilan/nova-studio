// The city's terrains and props in the detailed style: drawn at 32 pixels a tile (a scene layer's "scale": 1.5), not the
// 16-pixel drawings made larger. Ground is drawn in 2D with texture by clusters (stones, grit, seams) and soft reflections;
// what stands on the ground is built in 3D and drawn by pix3d.ts (form shading, specular bands, selective outlines);
// what glows is lit by glowHd, with a coloured spill on the ground beneath.

import { E, S, W } from "../../src/lib/autotile";
import { hash2, hex, Img, mix, rngOf, seedOf, shade, type Ramp, type Rgba } from "./paint";
import { blend, box, capsule, cut, cylinder, cylinderX, ellipsoid, glowHd, hdRamp, render, sphere, spill, union, type Hit, type Look, type Part, type Sdf, type V3 } from "./pix3d";
import { faceEnds, lightSide, type Ctx, type Probe } from "./tilekit";

const WHITE: Rgba = [255, 255, 255, 255];
const A = (c: Ctx, i: 0 | 1) => c.P.accent[i];
const al = (c: Rgba, a: number): Rgba => [c[0], c[1], c[2], Math.round(a)];

export interface HdTerrain {
  texture: (c: Ctx, v: number) => Img;
  edge: (c: Ctx, p: Probe, mask: number, x: number, y: number, tex: Rgba) => Rgba | null;
  variants?: number;
}

function canvas(c: Ctx, name: string, v: number, draw: (img: Img, rng: () => number) => void): Img {
  const img = new Img(32, 32);
  draw(img, rngOf(seedOf(`hd/${name}/${v}`) + c.seed));
  return img;
}

/// A soft reflection on a wet surface: a vertical streak, widest and brightest in its middle, falling off at its ends
/// and sides (blended into what is there).
function reflection(img: Img, x: number, y: number, len: number, wide: number, col: Rgba, a: number) {
  for (let i = 0; i < len; i++) {
    const f = 1 - Math.abs(i - (len - 1) / 2) / (len / 2);
    const wob = 0;
    for (let dx = -wide; dx <= wide; dx++) {
      const g = f * (1 - Math.abs(dx) / (wide + 1));
      if (g < 0.15) continue;
      img.set(x + dx + wob, y + i, blend(img.get(x + dx + wob, y + i), g > 0.6 ? mix(col, WHITE, 0.25) : col, a * (g > 0.6 ? 1 : g > 0.35 ? 0.6 : 0.3)));
    }
  }
}

/// Grit: small clusters (one to four pixels) of a darker or lighter tone, never lone noise everywhere.
function grit(img: Img, rng: () => number, n: number, cols: Rgba[], x0 = 1, y0 = 1, x1 = 30, y1 = 30) {
  for (let i = 0; i < n; i++) {
    const x = x0 + Math.floor(rng() * (x1 - x0)), y = y0 + Math.floor(rng() * (y1 - y0)), c = cols[i % cols.length]!;
    img.set(x, y, c);
    if (rng() < 0.6) img.set(x + 1, y, c);
    if (rng() < 0.3) img.set(x, y + 1, shade(c, -0.4));
  }
}

const darkOf = (c: Ctx) => mix(c.P.outline, c.P.mat.asphalt[0], 0.5);

// ---- terrains -------------------------------------------------------------------------------------------------------------
export const HD_TERRAINS: Record<string, HdTerrain> = {
  gap: {
    texture: (c, v) => canvas(c, "gap", v, (img, rng) => {
      const d = darkOf(c), a = c.P.mat.asphalt;
      img.rect(0, 0, 32, 32, d);
      grit(img, rng, 26, [a[0], mix(d, a[1], 0.5), a[1]]);
      // sleepers and two rails far below, half lost in the dark
      for (const y of [6, 22]) {
        img.rect(0, y, 32, 4, mix(d, c.P.mat.wood[0], 0.4));
        img.rect(0, y, 32, 1, mix(d, c.P.mat.wood[1], 0.4));
      }
      for (const x of [8, 23]) {
        img.rect(x, 0, 2, 32, mix(d, c.P.mat.metal[1], 0.45));
        img.rect(x, 0, 1, 32, mix(d, c.P.mat.metal[3], 0.4));
      }
      if (v === 1) reflection(img, 15, 10, 9, 1, c.P.mat.water[3], 0.3);
    }),
    edge: (c, p, _m, _x, _y, tex) => (p.d === 0 ? c.P.outline : p.d < 3 && lightSide(p) ? mix(tex, c.P.outline, 0.5) : tex),
  },
  asphalt: {
    variants: 16,
    texture: (c, v) => canvas(c, "asphalt", v, (img, rng) => {
      const a = c.P.mat.asphalt;
      img.rect(0, 0, 32, 32, a[2]);
      // the wet sheen: broad soft patches a tone lighter
      for (let k = 0; k < 2; k++) {
        const cx = 4 + rng() * 24, cy = 4 + rng() * 24, rx = 4 + rng() * 6, ry = 3 + rng() * 4;
        img.ellipse(cx, cy, rx, ry, (x, y) => (hash2(x >> 1, y >> 1, c.seed + k) < 0.75 ? mix(a[2], a[3], 0.22) : undefined));
      }
      grit(img, rng, 22, [a[1], mix(a[1], a[0], 0.5), mix(a[2], a[3], 0.5)]);
      const x = 6 + Math.floor(rng() * 20), y = 3 + Math.floor(rng() * 10);
      if (v === 1) reflection(img, x, 4, 24, 1, mix(a[3], a[4], 0.3), 0.25);
      if (v === 3) reflection(img, x, 4, 24, 2, A(c, 0)[1], 0.16);
      if (v === 4) reflection(img, x, 4, 24, 2, A(c, 1)[1], 0.16);
      if (v === 5) {
        // a crack: a dark line with its far lip catching light
        let cx = x, cy = 2;
        while (cy < 30) {
          img.set(cx, cy, a[0]);
          img.set(cx + 1, cy, mix(a[2], a[3], 0.5));
          cy++;
          if (rng() < 0.4) cx += rng() < 0.5 ? -1 : 1;
        }
      }

    }),
    edge: (c, p, _m, _x, _y, tex) => (p.d === 0 ? mix(c.P.mat.asphalt[0], c.P.outline, 0.4) : p.d === 1 && lightSide(p) ? c.P.mat.asphalt[1] : tex),
  },
  pavement: {
    variants: 7,
    texture: (c, v) => canvas(c, "pavement", v, (img, rng) => {
      const C = c.P.mat.concrete;
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
        const sx = x >> 4, sy = y >> 4, lx = x & 15, ly = y & 15;
        const tone = hash2(sx + v * 5, sy + v * 3, c.seed + 31);
        const face = tone < 0.3 ? mix(C[2], C[1], 0.25) : tone > 0.75 ? mix(C[2], C[3], 0.18) : C[2];
        // each slab bevelled: lit top and left, a dark joint and its shadow at the bottom and right
        const col = lx === 15 || ly === 15 ? C[0] : lx === 14 || ly === 14 ? mix(face, C[1], 0.6) : lx === 0 || ly === 0 ? mix(face, C[3], 0.5) : lx === 1 || ly === 1 ? mix(face, C[3], 0.15) : face;
        img.set(x, y, col);
      }
      grit(img, rng, 14, [mix(C[2], C[1], 0.6), mix(C[2], C[3], 0.4)], 2, 2, 29, 29);
      // a wet slab: a soft corner of reflected light
      const wx = (Math.floor(rng() * 2) << 4) + 3, wy = (Math.floor(rng() * 2) << 4) + 3;
      if (v % 3 === 1) for (let i = 0; i < 6; i++) for (let j = 0; j < 6 - i; j++) img.set(wx + i, wy + j, blend(img.get(wx + i, wy + j), C[4], 0.18));
      if (v === 4) {
        let x = 20, y = 2;
        for (let i = 0; i < 12; i++) {
          img.set(x, y, C[0]);
          img.set(x + 1, y, mix(C[2], C[3], 0.4));
          y++;
          if (rng() < 0.5) x++;
        }
      }
      if (v === 5) img.ellipse(9, 22, 5, 3, (x, y) => (hash2(x, y, c.seed) < 0.8 ? mix(img.get(x, y) ?? C[2], C[0], 0.35) : undefined));
      if (v === 6) {
        // a drain grate set in the slab
        img.rect(18, 18, 10, 8, c.P.mat.plate[1]);
        img.rect(18, 18, 10, 1, c.P.mat.plate[3]);
        for (let x = 19; x < 28; x += 2) img.rect(x, 20, 1, 5, darkOf(c));
      }
    }),
    edge: (c, p, mask, x, y, tex) => {
      const C = c.P.mat.concrete;
      if (!(mask & S) && y >= 26) {
        // the kerb's face: a lit lip, the face, its foot in shadow, and the wet street's sheen at the bottom
        if (faceEnds(mask, x, 32)) return C[1];
        const f = y - 26;
        return f === 0 ? C[4] : f === 1 ? C[3] : f < 4 ? C[1] : f === 4 ? C[0] : mix(C[0], c.P.outline, 0.5);
      }
      if (p.d === 0) return p.ny < 0 ? C[4] : p.nx < 0 ? C[3] : C[0];
      if (p.d === 1) return p.ny < 0 ? C[3] : p.nx < 0 ? mix(tex, C[3], 0.5) : C[1];
      return tex;
    },
  },
  metal_plate: {
    variants: 3,
    texture: (c, v) => canvas(c, "metal_plate", v, (img, rng) => {
      const P = c.P.mat.plate;
      img.rect(0, 0, 32, 32, P[2]);
      // diamond tread, each a lit and a dark half
      for (let gy = 0; gy < 6; gy++) for (let gx = 0; gx < 6; gx++) {
        const x = 2 + gx * 5 + (gy % 2 ? 2 : 0), y = 2 + gy * 5;
        if (x > 28) continue;
        img.set(x, y + 1, P[3]);
        img.set(x + 1, y, P[3]);
        img.set(x + 1, y + 1, P[4]);
        img.set(x + 2, y + 2, P[1]);
        img.set(x + 1, y + 2, P[1]);
      }
      img.rect(0, 0, 32, 1, P[3]);
      img.rect(0, 0, 1, 32, P[3]);
      img.rect(0, 31, 32, 1, P[0]);
      img.rect(31, 0, 1, 32, P[0]);
      for (const [x, y] of [[3, 3], [27, 3], [3, 27], [27, 27]] as const) {
        img.rect(x, y, 2, 2, P[3]);
        img.set(x, y, P[4]);
        img.set(x + 1, y + 1, P[1]);
        img.set(x + 2, y + 2, P[0]);
      }
      // the specular band of a sheet of metal under the street lights
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (Math.abs(x - y - 4) < 2) img.set(x, y, blend(img.get(x, y), P[4], 0.2));
      if (v === 1) img.ellipse(14 + rng() * 4, 16, 6, 4, (x, y) => (hash2(x >> 1, y >> 1, c.seed + 2) < 0.7 ? c.P.mat.rust[(x + y) % 3 ? 2 : 1] : undefined));
      if (v === 2) img.line(6, 24, 20, 12, P[1]);
    }),
    edge: (c, p, _m, _x, _y, tex) => (p.d === 0 ? mix(c.P.mat.plate[0], c.P.outline, 0.5) : p.d === 1 ? (lightSide(p) ? c.P.mat.plate[3] : c.P.mat.plate[1]) : tex),
  },
  grating: {
    variants: 2,
    texture: (c, v) => canvas(c, "grating", v, (img) => {
      const P = c.P.mat.plate, deep = darkOf(c);
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
        const bar = y % 4 === 0 || y % 4 === 1, frame = x < 2 || x === 16 || x === 17;
        const pipe = Math.abs(y - (22 - x * 0.45)) < 1.6;
        let below = pipe ? (Math.abs(y - (22 - x * 0.45)) < 0.6 ? c.P.mat.metal[1] : c.P.mat.asphalt[1]) : deep;
        if (v === 1 && Math.abs(y - 14) < 3) below = mix(deep, A(c, 0)[1], 0.55 - Math.abs(y - 14) * 0.12);
        img.set(x, y, frame ? (x === 0 || x === 16 ? P[3] : P[1]) : bar ? (y % 4 === 0 ? P[3] : P[1]) : below);
      }
    }),
    edge: (c, p, _m, _x, _y, tex) => (p.d === 0 ? (lightSide(p) ? c.P.mat.plate[3] : c.P.mat.plate[0]) : p.d === 1 ? c.P.mat.plate[1] : tex),
  },
  lab_tile: {
    variants: 10,
    texture: (c, v) => canvas(c, "lab_tile", v, (img, rng) => {
      const T = c.P.mat.tile;
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
        const lx = x & 7, ly = y & 7;
        const tone = hash2(x >> 3, (y >> 3) + v * 4, c.seed + 41);
        const face = tone < 0.25 ? mix(T[2], T[1], 0.25) : tone > 0.8 ? mix(T[2], T[3], 0.3) : T[2];
        const gloss = Math.abs(x + y - 30) < 2;
        img.set(x, y, lx === 7 || ly === 7 ? T[0] : lx === 0 || ly === 0 ? mix(face, T[4], 0.35) : lx === 6 || ly === 6 ? mix(face, T[1], 0.4) : gloss ? mix(face, T[4], 0.3) : face);
      }
      if (v === 3) img.line(10, 8, 14, 14, T[1]);
      if (v === 4) {
        img.ellipse(16, 16, 4, 4, T[0]);
        img.ellipse(16, 16, 3, 3, c.P.mat.plate[1]);
        for (let x = 14; x <= 18; x += 2) img.rect(x, 14, 1, 5, darkOf(c));
      }
      if (v === 5) for (let i = 0; i < 9; i++) {
        const x = 18 + Math.floor(rng() * 8), y = 18 + Math.floor(rng() * 8);
        img.set(x, y, c.P.mat.leaf[2]);
        img.set(x + 1, y, c.P.mat.leaf[1]);
      }
    }),
    edge: (_c, p, _m, _x, _y, tex) => (p.d === 0 ? shade(tex, lightSide(p) ? -2.4 : -1) : p.d < 3 && lightSide(p) ? shade(tex, -0.8) : tex),
  },
  marble: {
    variants: 3,
    texture: (c, v) => canvas(c, "marble", v, (img, rng) => {
      const M = c.P.mat.marble;
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
        const band = (((x - y) % 32) + 32) % 32;
        img.set(x, y, x === 31 || y === 31 ? M[1] : x === 0 || y === 0 ? M[3] : band >= 8 && band <= 11 ? mix(M[2], M[4], band === 9 || band === 10 ? 0.5 : 0.25) : M[2]);
      }
      // veins: a main one and a branch, two tones
      let y = 4 + Math.floor(rng() * 20);
      for (let x = 1; x < 31; x++) {
        img.set(x, y, mix(M[2], M[0], 0.35));
        img.set(x, y + 1, mix(M[2], M[1], 0.3));
        if (rng() < 0.3) y += rng() < 0.5 ? -1 : 1;
        y = Math.max(2, Math.min(28, y));
      }
      if (v === 1) img.rect(1, 15, 30, 1, c.P.mat.gold[3]);
      if (v === 2) reflection(img, 22, 5, 12, 2, M[4], 0.5);
    }),
    edge: (_c, p, _m, _x, _y, tex) => (p.d === 0 ? shade(tex, lightSide(p) ? -2.4 : -1) : p.d < 2 && lightSide(p) ? shade(tex, -0.8) : tex),
  },
  platform: {
    variants: 2,
    texture: (c, v) => canvas(c, "platform", v, (img, rng) => {
      const C = c.P.mat.concrete;
      img.rect(0, 0, 32, 32, mix(C[2], C[3], 0.2));
      grit(img, rng, 18, [C[1], mix(C[2], C[3], 0.6)]);
      img.rect(0, 31, 32, 1, C[1]);
      img.rect(15, 0, 1, 32, mix(C[2], C[1], 0.5));
      if (v === 1) img.ellipse(8, 20, 4, 2, mix(C[2], C[1], 0.5));
    }),
    edge: (c, p, mask, x, y, tex) => {
      const C = c.P.mat.concrete, G = c.P.mat.gold;
      if (!(mask & S)) {
        const fy = y - 22;
        if (fy >= 0) {
          if (faceEnds(mask, x, 32)) return c.P.outline;
          return fy === 0 ? C[4] : fy === 1 ? C[3] : fy < 5 ? C[1] : fy < 8 ? C[0] : c.P.outline;
        }
        // tactile studs, then the painted line
        if (fy >= -6 && fy <= -3) return fy === -6 || fy === -3 ? G[3] : G[2];
        if (fy >= -10 && fy <= -8 && x % 3 === 1) return fy === -10 ? C[4] : C[3];
      }
      if (p.d === 0) return lightSide(p) ? C[4] : C[0];
      if ((p.d >= 4 && p.d <= 6) && p.ny <= 0) return p.d === 4 ? G[3] : G[2];
      return tex;
    },
  },
  puddle: {
    variants: 4,
    texture: (c, v) => canvas(c, "puddle", v, (img, rng) => {
      const Wa = c.P.mat.water, base = mix(Wa[1], c.P.mat.asphalt[1], 0.3);
      img.rect(0, 0, 32, 32, base);
      // the sky's dull glow on the water, then reflections of the street's lights, then rain rings
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (Math.abs(x - y * 0.4 - 10) < 5) img.set(x, y, mix(base, Wa[2], 0.3));
      const x = 8 + Math.floor(rng() * 16), y = 3 + Math.floor(rng() * 6);
      if (v === 0) reflection(img, x, y, 20, 2, Wa[4], 0.6);
      if (v === 1) reflection(img, x, y, 20, 2, A(c, 0)[2], 0.7);
      if (v === 2) reflection(img, x, y, 20, 2, A(c, 1)[2], 0.7);
      for (let k = 0; k < 2; k++) {
        const rx = 4 + Math.floor(rng() * 24), ry = 4 + Math.floor(rng() * 24);
        img.ellipse(rx, ry, 3, 1.5, (px, py) => (Math.abs(((px - rx) / 3) ** 2 + ((py - ry) / 1.5) ** 2 - 1) < 0.5 ? mix(base, Wa[3], py < ry ? 0.6 : 0.3) : undefined));
      }
    }),
    edge: (c, p, _m, _x, _y, tex) => {
      const Wa = c.P.mat.water;
      if (p.d < 0) return null;
      if (p.d === 0) return mix(c.P.mat.asphalt[0], c.P.outline, 0.4);
      if (p.d === 1) return lightSide(p) ? mix(Wa[0], c.P.outline, 0.3) : mix(Wa[3], c.P.mat.asphalt[3], 0.4);
      if (p.d === 2) return lightSide(p) ? mix(tex, Wa[0], 0.5) : mix(tex, Wa[3], 0.3);
      return tex;
    },
  },
  concrete_wall: hdWall("concrete", (c, x, fy) => {
    const C = c.P.mat.concrete;
    if (fy <= 1) return fy === 0 ? C[4] : C[3];
    if (fy >= 19) return mix(C[0], c.P.outline, 0.3);
    if (fy >= 17) return C[1];
    // panels of cast concrete: seams, round tie holes with a lit lower lip, rain streaks under them
    if (fy % 9 === 0) return C[1];
    if (fy % 9 === 1) return mix(C[2], C[3], 0.3);
    const hx = x % 10, hy = fy % 9;
    if ((hx === 4 || hx === 5) && (hy === 4 || hy === 5)) return hy === 4 ? C[0] : mix(C[0], C[1], 0.5);
    if ((hx === 4 || hx === 5) && hy === 6) return C[3];
    const drip = hash2(x, 5, c.seed + 61) < 0.25 && fy < 4 + hash2(x, 6, c.seed) * 12;
    return drip ? mix(C[2], C[1], 0.5) : x % 16 === 0 ? C[1] : x % 16 === 1 ? mix(C[2], C[3], 0.3) : C[2];
  }),
  metal_wall: hdWall("metal", (c, x, fy) => {
    const P = c.P.mat.plate, R = c.P.mat.rust;
    if (fy === 0) return P[4];
    if (fy >= 19) return mix(P[0], c.P.outline, 0.3);
    if (fy === 8 || fy === 9) return fy === 8 ? P[0] : P[3];
    // corrugation: each rib a cylinder with its own specular line
    const k = x % 4;
    let col = k === 0 ? P[3] : k === 1 ? P[4] : k === 2 ? P[2] : P[1];
    if (fy > 9 && hash2(x >> 2, 3, c.seed + 63) < 0.3 && fy < 10 + hash2(x >> 2, 4, c.seed) * 9) col = mix(col, R[k < 2 ? 3 : 1], 0.6);
    return fy >= 17 ? shade(col, -1.2) : col;
  }),
  glass_wall: hdWall("glass", (c, x, fy) => {
    const F = c.P.mat.metal, G = c.P.mat.glass;
    if (fy <= 1) return fy === 0 ? F[4] : F[3];
    if (fy >= 18) return fy === 19 ? F[0] : F[1];
    if (x % 16 === 0 || x % 16 === 1) return x % 16 === 0 ? F[3] : F[1];
    // panes: what is behind shows through; a highlight runs across in two slanted bands
    const d = (x + fy * 1.4) % 22;
    if (d < 1.5) return al(mix(G[4], WHITE, 0.4), 220);
    if (d < 3) return al(G[4], 170);
    if (d > 10 && d < 11.5) return al(G[3], 150);
    return al(fy < 6 ? G[3] : G[2], 105);
  }),
};

/// A wall in the detailed style: a dark top with texture, and a face 20 pixels tall where it faces us.
function hdWall(kind: string, face: (c: Ctx, x: number, fy: number) => Rgba): HdTerrain {
  return {
    texture: (c, v) => canvas(c, `${kind}_wall`, v, (img, rng) => {
      const m = kind === "concrete" ? c.P.mat.concrete : kind === "metal" ? c.P.mat.plate : c.P.mat.metal;
      const top = mix(m[0], c.P.outline, 0.3);
      img.rect(0, 0, 32, 32, top);
      if (kind === "glass") {
        img.rect(0, 13, 32, 6, c.P.mat.glass[2]);
        img.rect(0, 13, 32, 1, c.P.mat.glass[4]);
        img.rect(0, 18, 32, 1, c.P.mat.glass[1]);
      } else if (kind === "metal") for (let x = 1; x < 32; x += 6) img.rect(x, 0, 2, 32, mix(top, m[2], 0.3));
      else grit(img, rng, 16, [shade(top, 0.8), mix(top, c.P.outline, 0.4)]);
    }),
    edge: (c, p, mask, x, y, tex) => {
      const cap = 12;
      if (!(mask & S) && y >= cap) {
        if ((!(mask & W) && x === 0) || (!(mask & E) && x === 31) || y === 31 || faceEnds(mask, x, 32)) return kind === "glass" ? c.P.mat.metal[0] : c.P.outline;
        return face(c, x, y - cap);
      }
      if (p.d === 0) return c.P.outline;
      if (p.d === 1) return lightSide(p) ? shade(tex, 1.2) : shade(tex, -1.2);
      return tex;
    },
  };
}

// ---- edges that join along their length ------------------------------------------------------------------------------------
const runs = (mask: number) => ({ n: !!(mask & 1), e: !!(mask & 2), s: !!(mask & 4), w: !!(mask & 8) });

export function railHd(c: Ctx, mask: number): Img {
  const img = new Img(32, 32), M = c.P.mat.metal, C = c.P.mat.concrete, a = c.P.mat.asphalt;
  const r = runs(mask);
  const across = r.e || r.w || (!r.n && !r.s), along = r.n || r.s;
  const lay = (vertical: boolean, from: number, to: number) => {
    for (let i = from; i < to; i++) for (let j = 10; j <= 21; j++) {
      const [x, y] = vertical ? [j, i] : [i, j];
      // stone setts between the rails, each bevelled
      const u = vertical ? y : x, v = vertical ? x : y;
      const su = (u + (Math.floor((v - 10) / 4) % 2) * 3) % 6, sv = (v - 10) % 4;
      img.set(x, y, su === 5 || sv === 3 ? a[0] : su === 0 || sv === 0 ? mix(C[2], C[3], 0.3) : mix(C[1], a[2], 0.25));
    }
    for (const at of [8, 22]) for (let i = from; i < to; i++) {
      const put = (k: number, col: Rgba) => img.set(vertical ? at + k : i, vertical ? i : at + k, col);
      put(-1, a[0]);
      put(0, M[4]);
      put(1, M[2]);
      put(2, M[1]);
      put(3, a[0]);
    }
  };
  if (across) lay(false, r.w || (!r.e && !along) ? 0 : 16, r.e || (!r.w && !along) ? 32 : 16);
  if (along) lay(true, r.n ? 0 : 16, r.s ? 32 : 16);
  if (!across && !along) lay(false, 4, 28);
  return img;
}

export function stripHd(c: Ctx, mask: number, acc: Ramp): Img {
  const img = new Img(32, 32);
  const r = runs(mask);
  const core = (x: number, y: number) =>
    ((y === 15 || y === 16) && ((r.w && x <= 16) || (r.e && x >= 15))) || ((x === 15 || x === 16) && ((r.n && y <= 16) || (r.s && y >= 15))) || (mask === 0 && (y === 15 || y === 16) && x >= 8 && x <= 23);
  // light spilled on the floor round the strip, its dark channel, then the light
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    let d = 99;
    for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) if (core(x + dx, y + dy)) d = Math.min(d, Math.hypot(dx, dy));
    if (d <= 2.2) img.set(x, y, c.P.mat.plate[0]);
    else if (d < 7) img.set(x, y, al(acc[1], 70 * (1 - d / 7)));
  }
  glowHd(img, core, acc, { reach: 3.5, hot: 0.55 });
  return img;
}

// ---- props --------------------------------------------------------------------------------------------------------------
export type HdProp = (c: Ctx) => Img;

interface Mats {
  plate: Ramp; metal: Ramp; concrete: Ramp; rust: Ramp; glass: Ramp; dark: Ramp; roof: Ramp; wood: Ramp; leaf: Ramp; marble: Ramp; gold: Ramp; red: Ramp;
}
function mats(c: Ctx): Mats {
  const warm = mix(A(c, 0)[2], WHITE, 0.65);
  const R = (r: Ramp) => hdRamp(r[2], warm);
  const m = c.P.mat;
  return {
    plate: R(m.plate), metal: R(m.metal), concrete: R(m.concrete), rust: R(m.rust), glass: R(m.glass), dark: hdRamp(mix(m.plate[0], c.P.outline, 0.3), warm), roof: R(m.roof),
    wood: R(m.wood), leaf: R(m.leaf), marble: R(m.marble), gold: R(m.gold), red: hdRamp(hex("#b0302a"), warm),
  };
}
const L = (ramp: Ramp, spec = 0, extra: Partial<Look> = {}): Look => ({ ramp, spec, ...extra });

/// A prop built in 3D: `w` by `h` tiles, its ground origin on the anchor cell, parts and what glows.
function prop3d(c: Ctx, w: number, h: number, parts: (M: Mats) => Part[], o: { shadow?: [number, number, number, number][]; glow?: Ramp; after?: (img: Img) => void; ox?: number } = {}): Img {
  const M = mats(c);
  const { img, emit } = render(parts(M), { w: 32 * w, h: 32 * h, ox: o.ox ?? 16, oy: 32 * h - 6, tilt: 25, outline: c.P.outline, rim: c.P.city ? c.P.accent[1][3] : undefined, shadows: o.shadow });
  if (o.glow) glowHd(img, (x, y) => emit.has(x, y), o.glow, { reach: 3.2 });
  o.after?.(img);
  return img;
}
const P = (sdf: Sdf, at: V3, size: number, look: Part["look"], group?: number): Part => ({ sdf, at, size, look, group });

function sign(c: Ctx, shape: (x: number, y: number) => boolean, acc: Ramp): Img {
  const img = new Img(32, 64), M = mats(c);
  // a dark board on two brackets, the tubes lit on it; below, on the wet street, its light and its reflection
  spill(img, 16, 40, 12, 6, acc[1], 0.05);
  reflection(img, 16, 34, 28, 2, acc[2], 0.22);
  const board = new Img(32, 32);
  board.rect(3, 0, 2, 4, M.metal[1]);
  board.rect(27, 0, 2, 4, M.metal[1]);
  board.rect(2, 4, 28, 22, M.dark[1]);
  board.rect(2, 4, 28, 2, M.dark[3]);
  board.rect(2, 4, 1, 22, M.dark[2]);
  board.rect(29, 4, 1, 22, M.dark[0]);
  board.rect(2, 25, 28, 1, M.dark[0]);
  for (let y = 7; y < 24; y += 4) for (let x = 5; x < 28; x += 4) board.set(x, y, M.dark[0]);
  img.draw(board.outline(c.P.outline));
  glowHd(img, (x, y) => y >= 6 && y <= 24 && x >= 4 && x <= 27 && shape(x, y), acc, { reach: 4, hot: 0.6 });
  return img;
}
const seg = (x: number, y: number, x0: number, y0: number, x1: number, y1: number, w = 0.7) => {
  const dx = x1 - x0, dy = y1 - y0, t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - x0 - dx * t, y - y0 - dy * t) <= w;
};
const ring = (x: number, y: number, cx: number, cy: number, rx: number, ry: number, from = -Math.PI, to = Math.PI) => {
  const a = Math.atan2((y - cy) / ry, (x - cx) / rx);
  return a >= from && a <= to && Math.abs(Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) < 0.11;
};
export const HD_SIGNS: Record<string, (x: number, y: number) => boolean> = {
  sign_bowl: (x, y) => seg(x, y, 6, 14, 25, 14) || ring(x, y, 15.5, 14, 9.5, 7.5, 0, Math.PI) || seg(x, y, 17, 6, 23, 12) || seg(x, y, 20, 5, 25, 10) || seg(x, y, 11, 9, 11, 7) || seg(x, y, 14, 10, 14, 7),
  sign_arrow: (x, y) => seg(x, y, 6, 15, 23, 15) || seg(x, y, 17, 9, 24, 15) || seg(x, y, 17, 21, 24, 15),
  sign_eye: (x, y) => ring(x, y, 15.5, 15, 11, 6.5) || ring(x, y, 15.5, 15, 3.5, 3.5) || (Math.hypot(x - 15.5, y - 15) < 1.2),
  sign_cross: (x, y) => seg(x, y, 15.5, 7, 15.5, 23) || seg(x, y, 7.5, 15, 23.5, 15) || ring(x, y, 15.5, 15, 10, 10),
  sign_bars: (x, y) => seg(x, y, 6, 9, 25, 9) || seg(x, y, 6, 15, 18, 15) || (seg(x, y, 6, 21, 22, 21) && x !== 13 && x !== 14),
};

export const HD_PROPS: Record<string, HdProp> = {
  stall: (c) => prop3d(c, 2, 2, (M) => {
    const goods: Part[] = [
      P(box([-22, 15.5, 1], [4, 2.5, 3.5], 0.8), [-22, 15, 1], 6, L(hdRamp(c.P.mat.flower2[2]))),
      P(box([-15, 15, 0], [2.5, 2, 3], 0.8), [-15, 15, 0], 5, L(hdRamp(c.P.mat.flower[3]))),
      P(cylinder([-8, 0, 2], 1.6, 13, 18.5, 0.5), [-8, 16, 2], 4, L(M.metal, 0.9)),
      P(cylinder([-4.5, 0, 2], 1.6, 13, 18.5, 0.5), [-4.5, 16, 2], 4, L(hdRamp(c.P.mat.flower[2]), 0.6)),
      P(cut(cylinder([3, 0, 0], 4, 13, 16.5, 0.8), cylinder([3, 0, 0], 3.2, 15, 20)), [3, 14, 0], 5, L(hdRamp([222, 214, 200, 255]), 0.5)),
      ...[[12, 15, 2, 3], [15.5, 14.6, 1, 2], [13.5, 17.5, 0, 3], [18.5, 15, 2, 4]].map(([x, y, z, k]) => P(sphere([x!, y!, z!], 2.3), [x!, y!, z!], 3, L(k === 4 ? M.leaf : hdRamp(c.P.mat.flower[k!]!), 0.3))),
      ...[24, 26.5].map((x) => P(capsule([x, 13, 1], [x, 20, 1], 1.1, 0.7), [x, 16, 1], 5, L(M.glass, 1, { alpha: 0.85 }))),
    ];
    const stripe = (h: Hit) => (Math.floor((h.w[0] + 34) / 6.8) % 2 ? L(M.roof) : L(hdRamp(c.P.mat.roof[3])));
    return [
      // the counter, a cloth hanging off it, the goods
      P(box([0, 6.5, 0], [30, 6.5, 6], 1), [0, 6, 0], 31, (h) => (h.ln[2] > 0.6 && h.w[1] > 7 && h.w[1] < 11 ? L(M.roof) : L(M.plate, 0.2))),
      ...goods,
      // poles and the awning: a striped canopy with a scalloped hem
      P(capsule([-28, 0, -4], [-28, 32, -4], 0.9), [-28, 16, -4], 17, L(M.metal, 0.8)),
      P(capsule([28, 0, -4], [28, 32, -4], 0.9), [28, 16, -4], 17, L(M.metal, 0.8)),
      P(box([0, 34, 0], [33, 1.2, 9.5], 0.8), [0, 34, 0], 35, stripe, 3),
      P(union(...Array.from({ length: 10 }, (_, k) => ellipsoid([-30.6 + k * 6.8, 32, 9], [3.2, 2.2, 0.8]))), [0, 32, 9], 34, stripe, 3),
      // bulbs along the hem
      ...[-24, -12, 0, 12, 24].map((x) => P(sphere([x, 30.2, 9.2], 0.9), [x, 30, 9], 2, L(hdRamp([255, 214, 150, 255]), 0, { emit: true }), 4)),
    ];
  }, { ox: 32, shadow: [[0, 1, 32, 8]], glow: hdRamp([255, 200, 120, 255]) }),
  cargo_crate: (c) => prop3d(c, 1, 1, (M) => [
    P(box([0, 9, 0], [11, 9, 9], 1.2), [0, 9, 0], 15, (h) => {
      const rib = h.ln[2] > 0.6 && (Math.abs(h.w[0]) % 7 < 1.2);
      const band = Math.abs(h.w[1] - 15) < 1;
      return L(rib || band ? hdRamp(c.P.mat.rust[1]) : M.rust, 0.3);
    }),
    ...[[-10, 0, 8], [10, 0, 8]].map(([x, , z]) => P(box([x!, 9, z!], [1.4, 9.2, 1.4], 0.6), [x!, 9, z!], 10, L(M.metal, 0.9))),
  ], { shadow: [[0, 1, 13, 11]], after: (img) => { for (const x of [12, 15, 18]) img.rect(x, 17, 2, 2, mix(c.P.mat.plaster[3], WHITE, 0.2)); } }),
  explosive_barrel: (c) => prop3d(c, 1, 1, (M) => [
    P(cylinder([0, 0, 0], 8, 0, 21, 1.5), [0, 10, 0], 13, (h) => {
      const y = h.w[1];
      if (Math.abs(y - 4) < 0.9 || Math.abs(y - 17) < 0.9) return L(([M.red[0], M.red[0], M.red[0], M.red[1], M.red[1]] as Ramp), 0.5);
      if (y > 8 && y < 13) return L(((Math.floor(Math.atan2(h.w[0], h.w[2]) * 4 + y * 0.5) % 2) + 2) % 2 ? M.gold : M.dark, 0.3);
      if (h.n[1] > 0.8) return L(([M.red[1], M.red[2], M.red[3], M.red[4], M.red[4]] as Ramp), 0.6);
      return L(M.red, 0.7);
    }),
  ], { shadow: [[0, 1, 9, 8]] }),
  vending_machine: (c) => vendingHd(c, 0),
  ...Object.fromEntries(Object.entries(HD_SIGNS).map(([n, shape]) => [n, (c: Ctx) => sign(c, shape, A(c, n === "sign_arrow" || n === "sign_cross" ? 1 : 0))])),
  street_lamp: (c) => prop3d(c, 1, 2, (M) => [
    P(cylinder([0, 0, 0], 3.2, 0, 3.5, 0.8), [0, 2, 0], 5, L(M.metal, 0.8)),
    P(capsule([0, 2, 0], [0, 50, 0], 1.3, 1), [0, 26, 0], 26, L(M.metal, 0.9)),
    P(capsule([0, 50, 0], [5, 53, 0], 1), [2, 51, 0], 5, L(M.metal, 0.9)),
    P(cut(ellipsoid([6, 52, 0], [7, 3.2, 4]), box([6, 48.5, 0], [8, 1.6, 6])), [6, 52, 0], 8, L(M.dark, 0.7)),
    P(ellipsoid([6, 50.2, 0], [5.6, 0.9, 3]), [6, 50, 0], 7, L(hdRamp([220, 240, 255, 255]), 0, { emit: true }), 3),
  ], { shadow: [[0, 1, 5, 4]], glow: hdRamp([200, 228, 255, 255]), after: (img) => spill(img, 21, 57, 13, 5, [210, 230, 255, 255], 0.22) }),
  bin: (c) => prop3d(c, 1, 1, (M) => [
    P(cylinder([0, 0, 0], 7.5, 0, 17, 1), [0, 9, 0], 11, (h) => L(Math.sin(Math.atan2(h.w[0], h.w[2]) * 10) > 0.7 ? hdRamp(mix(c.P.mat.plate[1], c.P.mat.leaf[1], 0.4)) : hdRamp(mix(c.P.mat.plate[2], c.P.mat.leaf[2], 0.35)), 0.4)),
    P(cylinder([0, 0, 0], 8.4, 17, 19.5, 1), [0, 18, 0], 9, L(M.plate, 0.6)),
    P(ellipsoid([2, 20, -1], [4, 3, 3]), [2, 20, -1], 5, L(M.dark, 0.5)),
  ], { shadow: [[0, 1, 9, 8]] }),
  terminal: (c) => prop3d(c, 1, 1, (M) => [
    P(box([0, 5, -1], [3, 5, 3], 0.6), [0, 5, -1], 6, L(M.plate, 0.4)),
    P(box([0, 15, 0], [11, 6, 3], 1, 0), [0, 15, 0], 13, (h) => (h.ln[2] > 0.7 && Math.abs(h.w[0]) < 9 && Math.abs(h.w[1] - 15.5) < 4 ? L(hdRamp(mix(c.P.outline, A(c, 1)[0], 0.5)), 0, { flat: 1 }) : L(M.plate, 0.5))),
    P(box([0, 9.5, 5], [10, 1, 3.5], 0.5), [0, 9.5, 5], 11, L(M.plate, 0.6)),
  ], { shadow: [[0, 1, 11, 7]], after: (img) => glowHd(img, (x, y) => (y === 14 || y === 17) && x >= 8 && x <= (y === 14 ? 23 : 18) && x % 3 !== 0, A(c, 1), { reach: 2.5 }) }),
  specimen_tank: (c) => {
    const acc = A(c, 0), liquid = hdRamp(mix(acc[2], c.P.outline, 0.45));
    return prop3d(c, 1, 2, (M) => [
      P(cylinder([0, 0, 0], 11, 0, 7, 1), [0, 3, 0], 13, L(M.metal, 0.8)),
      P(cylinder([0, 0, 0], 11, 44, 50, 1), [0, 47, 0], 13, L(M.metal, 0.8)),
      P(ellipsoid([0, 25, 0], [4, 8, 4]), [0, 25, 0], 9, L(hdRamp(mix(c.P.outline, liquid[0], 0.5)))),
      P(sphere([0, 36, 1], 3.6), [0, 36, 1], 5, L(hdRamp(mix(c.P.outline, liquid[0], 0.5)))),
      P(cylinder([0, 0, 0], 9.5, 7, 44), [0, 25, 0], 22, (h) => (h.w[1] > 39 ? L(M.glass, 1, { alpha: 0.5 }) : h.w[1] > 38 ? L(liquid, 0, { emit: true }) : L(liquid, 0.9, { alpha: 0.82 })), 5),
    ], { shadow: [[0, 1, 12, 9]], glow: acc });
  },
  server_stack: (c) => prop3d(c, 1, 2, (M) => [
    P(box([0, 25, 0], [11, 25, 8], 1), [0, 25, 0], 28, (h) => {
      if (h.ln[2] < 0.7) return L(M.dark, 0.5);
      const u = Math.floor(h.w[1] / 5), v = h.w[1] % 5;
      if (v < 0.9) return L(hdRamp(c.P.outline), 0, { flat: 1 });
      if (h.w[0] > 5 && h.w[0] < 8 && v > 2 && v < 3.4) return L(A(c, (u % 2) as 0 | 1), 0, { emit: true });
      if (h.w[0] < 2 && Math.floor(h.w[0]) % 2 === 0 && v > 1.5 && v < 4) return L(M.dark, 0, { flat: 0 });
      return L(M.plate, 0.6);
    }),
  ], { shadow: [[0, 1, 12, 9]], glow: A(c, 1) }),
  bench: (c) => prop3d(c, 1, 1, (M) => [
    ...[-11, 11].map((x) => P(box([x, 4, 0], [1.2, 4, 4], 0.4), [x, 4, 0], 6, L(M.metal, 0.8))),
    ...[-2, 2].map((z) => P(box([0, 8.5, z], [13, 0.9, 1.6], 0.5), [0, 8.5, z], 14, L(M.plate, 0.7))),
    ...[0, 1].map((k) => P(box([0, 12 + k * 3.5, -4.5], [13, 1.1, 0.7], 0.5), [0, 13, -4.5], 14, L(M.plate, 0.7))),
  ], { shadow: [[0, 1, 13, 6]] }),
  barricade: (c) => prop3d(c, 1, 1, (M) => [
    P(cut(union(box([0, 3.5, 0], [13, 3.5, 6], 1), box([0, 11, 0], [10, 5, 3.5], 1)), box([0, 12.5, 0], [4, 0.9, 6])), [0, 8, 0], 15, (h) => (h.w[1] > 3 && h.w[1] < 7 && h.ln[2] > 0.5 ? L(Math.floor((h.w[0] - h.w[1]) / 3) % 2 ? M.gold : M.dark, 0.2) : L(M.concrete))),
  ], { shadow: [[0, 1, 14, 7]] }),
  turnstile: (c) => prop3d(c, 1, 1, (M) => [
    P(box([-11, 8, 0], [2.5, 8, 6], 1), [-11, 8, 0], 11, L(M.plate, 0.6)),
    P(box([11, 8, 0], [2.5, 8, 6], 1), [11, 8, 0], 11, L(M.plate, 0.6)),
    P(sphere([-8, 13, 0], 1.6), [-8, 13, 0], 2, L(M.metal, 1)),
    ...[0, 2.1, 4.2].map((a) => P(capsule([-8, 13, 0], [-8 + Math.cos(a) * 10, 13 - Math.sin(a) * 2, Math.sin(a) * 6], 0.7), [-4, 12, 2], 9, L(M.metal, 1))),
    P(sphere([11, 16.6, 4], 0.9), [11, 16.6, 4], 2, L(A(c, 1), 0, { emit: true })),
  ], { shadow: [[0, 1, 14, 7]], glow: A(c, 1) }),
  ticket_booth: (c) => prop3d(c, 2, 2, (M) => [
    P(box([0, 18, 0], [26, 18, 10], 1), [0, 18, 0], 32, (h) => {
      if (h.ln[2] > 0.7 && Math.abs(h.w[0]) < 22 && h.w[1] > 18 && h.w[1] < 32) return L(hdRamp(mix([255, 200, 140, 255], c.P.outline, 0.55)), 0.9, { flat: 2 });
      if (h.ln[2] > 0.7 && Math.abs(h.w[1] - 16.5) < 1) return L(M.plate, 0.8);
      return L(M.plate, 0.3);
    }),
    P(box([0, 39, 2], [29, 2.5, 13], 1), [0, 39, 2], 30, L(M.roof, 0.2)),
    P(box([0, 42.5, 10], [12, 1.6, 0.6], 0.4), [0, 42, 10], 13, L(A(c, 0), 0, { emit: true })),
  ], { ox: 32, shadow: [[0, 1, 28, 11]], glow: A(c, 0) }),
  pillar: (c) => prop3d(c, 1, 2, (M) => [
    P(cylinder([0, 0, 0], 8, 3, 47, 0), [0, 25, 0], 25, (h) => L(h.w[1] < 9 ? hdRamp(c.P.mat.concrete[1]) : M.concrete, 0.15)),
    P(box([0, 1.5, 0], [10.5, 1.5, 10.5], 0.6), [0, 1.5, 0], 15, L(M.concrete)),
    P(box([0, 49, 0], [10.5, 2, 10.5], 0.6), [0, 49, 0], 15, L(M.concrete)),
  ], { shadow: [[0, 1, 12, 10]] }),
  potted_plant: (c) => prop3d(c, 1, 1, (M) => [
    P(cylinder([0, 0, 0], 7, 0, 9, 1.2), [0, 5, 0], 9, L(M.concrete, 0.2)),
    P(ellipsoid([0, 15, 0], [8, 6, 7]), [0, 15, 0], 9, (h) => L(Math.sin(h.w[0] * 1.3 + h.w[1]) > 0.5 ? hdRamp(c.P.mat.leaf[1]) : M.leaf, 0.2)),
    P(ellipsoid([-5, 19, -1], [4, 4, 4]), [-5, 19, -1], 5, L(M.leaf, 0.2)),
    P(ellipsoid([5, 20, 0], [4, 4.5, 4]), [5, 20, 0], 5, L(M.leaf, 0.2)),
  ], { shadow: [[0, 1, 9, 7]] }),
  desk: (c) => prop3d(c, 1, 1, (M) => [
    ...[-11, 11].map((x) => P(box([x, 5, 0], [1.5, 5, 6], 0.4), [x, 5, 0], 8, L(M.dark, 0.6))),
    P(box([0, 11, 0], [14, 1.4, 7], 0.6), [0, 11, 0], 15, L(M.marble, 0.7)),
    P(box([0, 18, -3], [6, 4.5, 0.8], 0.4), [0, 18, -3], 8, (h) => (h.ln[2] > 0.7 && Math.abs(h.w[0]) < 5 && Math.abs(h.w[1] - 18) < 3.5 ? L(hdRamp(mix(c.P.outline, A(c, 1)[1], 0.6)), 0, { flat: 2 }) : L(M.dark, 0.6))),
    P(box([7, 12.8, 3], [3, 0.4, 2], 0.2), [7, 12.8, 3], 4, L(hdRamp([236, 236, 240, 255]))),
  ], { shadow: [[0, 1, 14, 8]] }),
  vent: (c) => ventHd(c, false),
  vent_puff: (c) => ventHd(c, true),
  cables: (c) => {
    const img = new Img(32, 32), M = mats(c);
    for (const [y0, sag, r] of [[9, 3, M.dark], [17, -2, M.roof], [22, 2, M.dark]] as const) {
      for (let x = 0; x < 32; x++) {
        const y = Math.round(y0 + sag * Math.sin((x / 31) * Math.PI));
        img.set(x, y - 1, r[3]);
        img.set(x, y, r[2]);
        img.set(x, y + 1, r[1]);
        img.set(x, y + 2, r[0]);
        img.set(x, y + 3, [18, 14, 34, 80]);
      }
    }
    img.rect(20, 7, 3, 20, M.metal[2]);
    img.rect(20, 7, 1, 20, M.metal[4]);
    return img;
  },
  manhole: (c) => {
    const img = new Img(32, 32), M = mats(c);
    img.ellipse(15.5, 16, 12, 9, (x, y) => {
      const u = (x - 15.5) / 12, v = (y - 16) / 9, r = u * u + v * v;
      if (r > 0.82) return u + v < 0 ? M.metal[3] : M.metal[0];
      if (r > 0.72) return M.metal[1];
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 ? M.metal[2] : M.metal[1];
    });
    img.rect(12, 14, 8, 4, M.metal[3]);
    img.rect(12, 17, 8, 1, M.metal[1]);
    return img;
  },
  shutter: (c) => shutterHd(c, false),
  shutter_open: (c) => shutterHd(c, true),
};

/// The vending machine (and the mimic that looks exactly like it until `open` goes from 0 to 1).
export function vendingHd(c: Ctx, open: number, tell = false): Img {
  const acc0 = A(c, 0), acc1 = A(c, 1);
  return prop3d(c, 1, 2, (M) => {
    const cans = [c.P.mat.flower2[3], c.P.mat.flower[3], c.P.mat.leaf[4], c.P.mat.gold[3], c.P.mat.metal[4]];
    const parts: Part[] = [
      P(box([0, 27, 0], [13, 27, 9], 1.2), [0, 27, 0], 31, (h: Hit) => {
        const x = h.w[0], y = h.w[1];
        if (h.ln[2] < 0.7) return L(M.plate, 0.6);
        // the front: a lit header, the window of cans on shelves, the buttons, the slot
        if (y > 44 && y < 50 && Math.abs(x) < 10) return tell ? L(M.dark, 0, { flat: 0 }) : L(acc0, 0, { emit: true });
        if (x > -11 && x < 5 && y > 18 && y < 42) {
          if (open > 0) {
            const top = 42 - open * 4, bottom = 18 + open * 2;
            if (y > bottom && y < top) {
              const tooth = (y > top - 2.5 && Math.abs((x * 0.7) % 2) < 1) || (y < bottom + 2.5 && Math.abs(((x + 1) * 0.7) % 2) < 1);
              return tooth ? L(hdRamp([236, 228, 212, 255]), 0, { flat: 3 }) : L(hdRamp([84, 20, 34, 255]), 0, { flat: y < bottom + 5 ? 2 : 1 });
            }
          }
          const shelf = (y - 18) % 8;
          if (shelf < 1.2) return L(M.metal, 0, { flat: 2 });
          const col = cans[(Math.floor((x + 11) / 3.2) + Math.floor(y / 8)) % cans.length]!;
          if (shelf > 1.5 && shelf < 6.5 && Math.abs(((x + 11) % 3.2) - 1.6) < 1) return L(hdRamp(col), 0, { flat: shelf > 5 ? 4 : 3 });
          return L(hdRamp(mix(c.P.outline, c.P.mat.glass[1], 0.6)), 0, { flat: 1 });
        }
        if (x > 6 && x < 11 && y > 26 && y < 40) return Math.abs(y - 30) < 1 ? L(acc1, 0, { emit: true }) : L(M.dark, 0.5, { flat: (Math.floor(y) % 3) ? 1 : 3 });
        if (Math.abs(x) < 9 && y > 7 && y < 13) return L(hdRamp(c.P.outline), 0, { flat: 2 });
        return L(M.plate, 0.5);
      }),
    ];
    if (tell) for (const s of [-1, 1]) parts.push(P(sphere([s * 4, 47, 9], 1.4), [s * 4, 47, 9], 2, L(acc0, 0, { emit: true })));
    return parts;
  }, { shadow: [[0, 1, 14, 10]], glow: acc0, after: (img) => {
    // the window's glass catches the light in a slanted band
    for (let y = 26; y < 48; y++) for (let x = 5; x < 20; x++) if (Math.abs(x - (y - 26) * 0.5 - 5) < 1 && (img.get(x, y)?.[3] ?? 0) > 200 && open === 0) img.set(x, y, blend(img.get(x, y), WHITE, 0.3));
  } });
}

function ventHd(c: Ctx, puff: boolean): Img {
  const img = new Img(32, 32), M = mats(c);
  img.rect(4, 7, 24, 18, M.plate[1]);
  img.rect(4, 7, 24, 2, M.plate[3]);
  img.rect(4, 7, 2, 18, M.plate[2]);
  img.rect(26, 7, 2, 18, M.plate[0]);
  img.rect(4, 23, 24, 2, M.plate[0]);
  for (let y = 11; y < 23; y += 3) {
    img.rect(7, y, 18, 1, mix(c.P.outline, M.plate[0], 0.4));
    img.rect(7, y + 1, 18, 1, M.plate[2]);
  }
  for (const [x, y] of [[6, 9], [25, 9], [6, 22], [25, 22]] as const) img.set(x, y, M.metal[4]);
  if (puff) {
    const acc = A(c, 0);
    for (const [cx, cy, r] of [[16, 12, 9], [9, 8, 6], [23, 7, 6.5], [15, 3, 5]] as const) {
      for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const d = Math.hypot(x - cx, (y - cy) * 1.2) / r;
        if (d < 1) img.set(x, y, blend(img.get(x, y), d < 0.5 ? acc[3] : acc[2], d < 0.5 ? 0.6 : 0.4));
      }
    }
  }
  return img;
}

function shutterHd(c: Ctx, open: boolean): Img {
  const M = mats(c), img = new Img(32, 32);
  img.rect(0, 0, 32, 32, M.plate[1]);
  img.rect(0, 0, 32, 7, M.plate[2]);
  img.rect(0, 0, 32, 1, M.plate[4]);
  img.rect(0, 6, 32, 1, M.plate[0]);
  if (open) {
    for (let y = 7; y < 32; y++) img.rect(3, y, 26, 1, mix(c.P.outline, c.P.mat.asphalt[1], (y - 7) / 30));
    img.rect(3, 7, 26, 3, M.plate[3]);
    img.rect(3, 9, 26, 1, M.plate[1]);
  } else {
    for (let y = 7; y < 32; y++) {
      const k = (y - 7) % 3;
      img.rect(3, y, 26, 1, k === 0 ? M.plate[3] : k === 1 ? M.plate[2] : M.plate[0]);
    }
    img.rect(12, 28, 8, 2, M.dark[1]);
    img.rect(12, 28, 8, 1, M.metal[3]);
  }
  img.rect(0, 0, 1, 32, c.P.outline);
  img.rect(31, 0, 1, 32, c.P.outline);
  img.rect(1, 1, 2, 31, M.plate[3]);
  img.rect(29, 1, 2, 31, M.plate[0]);
  glowHd(img, (x, y) => x >= 24 && x <= 25 && y >= 2 && y <= 3, A(c, open ? 1 : 0), { reach: 2.5 });
  return img;
}

export const HD_TERRAIN_NAMES = Object.keys(HD_TERRAINS);
export const HD_PROP_NAMES = Object.keys(HD_PROPS);
export type { Mats };
void ellipsoid;
void cylinderX;
