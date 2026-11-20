// The city's terrains and props for tileset_make: wet streets, kerbs, plate, grating, puddles, tiles, marble, platforms,
// walls of concrete, metal and glass, tram rails and lit strips that join along their length, and the street furniture of
// a drowned neon city (stalls, signs, lamps, vending machines, tanks, servers...). Made for the city palettes ("gutter
// market", "bloom labs", "hollow line", "spire") but drawn from any palette's materials.
//
// The rules are the tileset's (light from the top left, the outline round what stands on the ground, soft shadows),
// plus one for the night: what glows is light, not paint. A lit thing has a brighter core, the accent itself round it
// and a halo dithered one pixel further out (paint.ts `glow`), and only the palette's two accents glow, so the eye goes
// to what matters. Street lamps and bulbs give plain light, not the accents.
// Everything is drawn at 16 pixels a tile; a larger `tile` is the same drawing made larger pixel by pixel.

import { E, N, S, W } from "../../src/lib/autotile";
import { glow, hash2, hex, Img, mix, ramp, rngOf, seedOf, shade, type Ramp, type Rgba } from "./paint";
import { faceEnds, ground, lightSide, lump, up, type Ctx, type EdgeKind, type PropKind, type TerrainKind } from "./tilekit";

const WHITE: Rgba = [255, 255, 255, 255];
const A = (c: Ctx, i: 0 | 1) => c.P.accent[i];
const alpha = (c: Rgba, a: number): Rgba => [c[0], c[1], c[2], a];
/// The plain light of a street lamp or a bulb: not an accent, so it never competes with what matters.
const LAMP: Ramp = ramp(hex("#dcefff"));
const BULB: Ramp = ramp(hex("#ffd99a"));

/// A 16-pixel texture with marks, made at the tile's size.
function tex16(c: Ctx, name: string, v: number, draw: (img: Img, rng: () => number) => void): Img {
  const img = new Img(16, 16);
  draw(img, rngOf(seedOf(`${name}/${v}`) + c.seed));
  return up(img, c.k);
}

/// A reflection: a short vertical streak, brightest in its middle, as a light is seen in a wet street.
function streak(img: Img, x: number, y: number, len: number, base: Rgba, mid: Rgba, peak: Rgba) {
  for (let i = 0; i < len; i++) {
    const f = Math.abs(i - (len - 1) / 2) / (len / 2);
    img.set(x, y + i, f < 0.3 ? peak : f < 0.75 ? mid : base);
    if (f < 0.4 && i % 2 === 0) img.set(x + 1, y + i, mix(base, mid, 0.5));
  }
}

// ---- terrains -------------------------------------------------------------------------------------------------------------
const dark = (c: Ctx) => mix(c.P.outline, c.P.mat.asphalt[0], 0.5);

function cityWall(name: string, what: string, top: (c: Ctx) => Img, face: (c: Ctx, x: number, fy: number, h: number) => Rgba, glass = false): TerrainKind {
  return {
    name, what, solid: true, shape: { inset: 0, round: 0, wobble: 0 }, variants: 1,
    texture: (c) => top(c),
    edge: (c, p, mask, x, y, tex) => {
      const cap = c.t - Math.round(10 * c.k), frame = c.P.mat.metal;
      if (!(mask & S) && y >= cap) {
        if ((!(mask & W) && x === 0) || (!(mask & E) && x === c.t - 1) || y === c.t - 1 || faceEnds(mask, x, c.t)) return glass ? frame[0] : c.P.outline;
        return face(c, Math.floor(x / c.k), Math.floor((y - cap) / c.k), 10);
      }
      if (p.d === 0) return c.P.outline;
      if (p.d === 1) return lightSide(p) ? (glass ? frame[3] : shade(tex, 1)) : shade(tex, -1.2);
      return tex;
    },
  };
}

export const CITY_TERRAINS: TerrainKind[] = [
  {
    name: "gap", what: "the drop beside a platform: a dark track bed (solid; a roll may cross it if the game says so)", solid: true, shape: { inset: 0, round: 0, wobble: 0 }, variants: 2,
    texture: (c, v) => tex16(c, "gap", v, (img, rng) => {
      const a = c.P.mat.asphalt, base = dark(c);
      img.rect(0, 0, 16, 16, base);
      for (let i = 0; i < 9; i++) img.set(1 + Math.floor(rng() * 14), 1 + Math.floor(rng() * 14), i % 3 ? a[0] : a[1]);
      // a sleeper across, half seen in the dark
      img.rect(0, 9, 16, 2, mix(base, c.P.mat.wood[0], 0.35));
      img.rect(0, 9, 16, 1, mix(base, c.P.mat.wood[1], 0.35));
      if (v === 1) img.set(4 + Math.floor(rng() * 8), 4, mix(base, c.P.mat.water[3], 0.5));
    }),
    edge: (c, p, _m, _x, _y, tex) => (p.d === 0 ? c.P.outline : tex),
  },
  {
    name: "asphalt", what: "a wet street: blue-black, with lighter streaks where lights are reflected", solid: false, shape: { inset: 0, round: 0, wobble: 0 }, variants: 8,
    texture: (c, v) => tex16(c, "asphalt", v, (img, rng) => {
      const a = c.P.mat.asphalt;
      img.rect(0, 0, 16, 16, a[2]);
      const at = (): [number, number] => [1 + Math.floor(rng() * 13), 1 + Math.floor(rng() * 13)];
      for (let i = 0; i < 6; i++) img.set(...at(), a[1]);
      for (let i = 0; i < 2; i++) img.set(...at(), mix(a[2], a[3], 0.45));
      const [sx, sy] = [2 + Math.floor(rng() * 10), 2 + Math.floor(rng() * 6)];
      const faint = (r: Ramp) => streak(img, sx, sy, 7, mix(a[2], r[1], 0.22), mix(a[2], r[2], 0.36), mix(a[3], r[2], 0.45));
      if (v === 1) streak(img, sx, sy, 6, mix(a[2], a[3], 0.25), mix(a[2], a[3], 0.45), mix(a[2], a[3], 0.65));
      if (v === 2) img.ellipse(sx + 1, sy + 4, 4, 2.5, (x, y) => ((x + y) % 2 ? mix(a[2], a[3], 0.28) : undefined));
      if (v === 4) {
        let x = sx, y = 3;
        for (let i = 0; i < 8; i++) {
          img.set(x, y, a[1]);
          y++;
          if (rng() < 0.4) x += rng() < 0.5 ? -1 : 1;
        }
      }
      if (v === 5) for (let x = 3; x < 12; x++) for (let y = 7; y < 9; y++) if (hash2(x, y, c.seed + 3) < 0.7) img.set(x, y, mix(a[2], c.P.mat.plaster[3], 0.22));
      if (v === 6) faint(A(c, 0));
      if (v === 7) faint(A(c, 1));
    }),
    edge: (c, p, _m, _x, _y, tex) => (p.d === 0 ? (lightSide(p) ? mix(c.P.mat.asphalt[0], c.P.outline, 0.4) : c.P.mat.asphalt[1]) : tex),
  },
  {
    name: "pavement", what: "pavement slabs raised on a kerb: the kerb's face shows where the street lies below", solid: false, shape: { inset: 0, round: 0, wobble: 0 }, variants: 6,
    texture: (c, v) => tex16(c, "pavement", v, (img, rng) => {
      const C = c.P.mat.concrete;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const sx = x >> 3, sy = y >> 3, lx = x & 7, ly = y & 7;
        const tone = hash2(sx + v * 5, sy + v * 3, c.seed + 31);
        const face = tone < 0.3 ? mix(C[2], C[1], 0.3) : tone > 0.75 ? mix(C[2], C[3], 0.2) : C[2];
        const wet = hash2(sx, sy + v * 7, c.seed + 32) < 0.2 && lx - ly >= 1 && lx - ly <= 2 && lx > 2;
        img.set(x, y, lx === 7 || ly === 7 ? C[0] : lx === 0 || ly === 0 ? mix(face, C[3], 0.35) : wet ? mix(face, C[4], 0.2) : face);
      }
      if (v === 3) {
        let x = 9, y = 1;
        for (let i = 0; i < 6; i++) {
          img.set(x, y, mix(C[2], C[0], 0.7));
          y++;
          if (rng() < 0.5) x++;
        }
      }
      if (v === 4) for (let y = 9; y < 14; y++) for (let x = 2; x < 6; x++) if ((x + y) % 2 === 0) img.set(x, y, mix(C[2], C[1], 0.6));
      if (v === 5) {
        // a drain in the slab
        img.rect(9, 10, 5, 4, c.P.mat.plate[0]);
        for (let x = 10; x < 13; x += 2) img.rect(x, 11, 1, 2, dark(c));
        img.rect(9, 10, 5, 1, c.P.mat.plate[2]);
      }
    }),
    edge: (c, p, mask, x, y, tex) => {
      const C = c.P.mat.concrete, kerb = Math.round(3 * c.k);
      if (!(mask & S) && y >= c.t - kerb) {
        if (faceEnds(mask, x, c.t)) return C[1];
        const fy = Math.floor((y - (c.t - kerb)) / c.k);
        return fy === 0 ? C[4] : fy === 1 ? C[1] : mix(C[0], c.P.outline, 0.4);
      }
      if (p.d === 0) return p.ny < 0 ? C[4] : p.nx < 0 ? C[3] : C[1];
      return tex;
    },
  },
  {
    name: "metal_plate", what: "tread plate bolted down: docks, catwalks, factory floors", solid: false, shape: { inset: 0, round: 0, wobble: 0 }, variants: 3,
    texture: (c, v) => tex16(c, "metal_plate", v, (img, rng) => {
      const P = c.P.mat.plate;
      img.rect(0, 0, 16, 16, P[2]);
      for (let gy = 0; gy < 4; gy++) for (let gx = 0; gx < 4; gx++) {
        const x = gx * 4 + (gy % 2) * 2, y = gy * 4 + 1;
        img.set(x + 1, y, P[3]);
        img.set(x + 2, y + 1, P[1]);
      }
      img.rect(0, 0, 16, 1, P[3]);
      img.rect(0, 0, 1, 16, P[3]);
      img.rect(0, 15, 16, 1, P[0]);
      img.rect(15, 0, 1, 16, P[0]);
      for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]] as const) {
        img.set(x, y, P[4]);
        img.set(x + 1, y + 1, P[0]);
      }
      if (v === 1) {
        const [cx, cy] = [5 + Math.floor(rng() * 6), 5 + Math.floor(rng() * 6)];
        img.ellipse(cx, cy, 3, 2, (x, y) => (hash2(x, y, c.seed + 9) < 0.6 ? c.P.mat.rust[(x + y) % 2 ? 2 : 1] : undefined));
      }
      if (v === 2) img.line(4, 11, 10, 6, P[1]);
    }),
    edge: (c, p, _m, _x, _y, tex) => (p.d === 0 ? mix(c.P.mat.plate[0], c.P.outline, 0.5) : p.d === 1 ? (lightSide(p) ? c.P.mat.plate[3] : c.P.mat.plate[1]) : tex),
  },
  {
    name: "grating", what: "a floor grating over a dark drop: bars with the dark showing between them (walked on)", solid: false, shape: { inset: 0, round: 0, wobble: 0 }, variants: 2,
    texture: (c, v) => tex16(c, "grating", v, (img) => {
      const P = c.P.mat.plate, deep = dark(c);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const bar = y % 3 === 0, support = x === 0 || x === 8;
        // below the bars: a pipe crossing the dark, and on the second variant something lit far down
        const pipe = Math.abs(y - (11 - x * 0.4)) < 1;
        const below = v === 1 && Math.abs(y - 7) < 2 ? ((x + y) % 2 ? mix(deep, A(c, 0)[0], 0.55) : mix(deep, A(c, 0)[1], 0.4)) : pipe ? c.P.mat.asphalt[1] : deep;
        img.set(x, y, support ? (x === 0 ? P[3] : P[1]) : bar ? (y === 0 ? P[3] : P[2]) : below);
      }
    }),
    edge: (c, p, _m, _x, _y, tex) => (p.d === 0 ? (lightSide(p) ? c.P.mat.plate[3] : c.P.mat.plate[0]) : tex),
  },
  {
    name: "lab_tile", what: "small pale floor tiles with a gloss, for labs and clinics", solid: false, shape: { inset: 0, round: 0, wobble: 0 }, variants: 6,
    texture: (c, v) => tex16(c, "lab_tile", v, (img, rng) => {
      const T = c.P.mat.tile;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const lx = x & 3, ly = y & 3;
        const tone = hash2(x >> 2, (y >> 2) + v * 4, c.seed + 41);
        const face = tone < 0.25 ? mix(T[2], T[1], 0.3) : tone > 0.8 ? mix(T[2], T[3], 0.35) : T[2];
        const gloss = x + y >= 9 && x + y <= 10;
        img.set(x, y, lx === 3 || ly === 3 ? T[1] : lx === 0 && ly === 0 ? mix(face, T[4], 0.4) : gloss ? mix(face, T[4], 0.3) : face);
      }
      if (v === 3) img.line(5, 4, 7, 7, T[1]);
      if (v === 4) {
        img.ellipse(7.5, 7.5, 2, 2, T[0]);
        img.set(7, 7, c.P.mat.plate[0]);
        img.set(8, 8, c.P.mat.plate[0]);
      }
      if (v === 5) for (let i = 0; i < 5; i++) img.set(9 + Math.floor(rng() * 4), 9 + Math.floor(rng() * 4), c.P.mat.leaf[(i % 2) + 1]!);
    }),
    edge: (_c, p, _m, _x, _y, tex) => (p.d === 0 ? shade(tex, lightSide(p) ? -2.4 : -1) : p.d === 1 && lightSide(p) ? shade(tex, -1) : tex),
  },
  {
    name: "marble", what: "polished stone slabs with veins and a reflection", solid: false, shape: { inset: 0, round: 0, wobble: 0 }, variants: 3,
    texture: (c, v) => tex16(c, "marble", v, (img, rng) => {
      const M = c.P.mat.marble;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const band = (((x - y) % 16) + 16) % 16;
        img.set(x, y, x === 15 || y === 15 ? M[1] : x === 0 || y === 0 ? M[3] : band >= 4 && band <= 5 ? mix(M[2], M[4], 0.55) : M[2]);
      }
      // a vein wandering across
      let y = 2 + Math.floor(rng() * 10);
      for (let x = 1; x < 15; x++) {
        if (hash2(x, v, c.seed + 51) < 0.8) img.set(x, y, mix(M[2], M[0], 0.4));
        if (rng() < 0.35) y += rng() < 0.5 ? -1 : 1;
        y = Math.max(1, Math.min(14, y));
      }
      if (v === 1) img.rect(1, 7, 14, 1, c.P.mat.gold[3]);
      if (v === 2) img.ellipse(10, 5, 2, 1, mix(M[3], WHITE, 0.4));
    }),
    edge: (_c, p, _m, _x, _y, tex) => (p.d === 0 ? shade(tex, lightSide(p) ? -2.4 : -1) : p.d === 1 && lightSide(p) ? shade(tex, -1) : tex),
  },
  {
    name: "platform", what: "a station platform: a painted safety line along its open edges, and a face where it drops to the gap", solid: false, shape: { inset: 0, round: 0, wobble: 0 }, variants: 2,
    texture: (c, v) => tex16(c, "platform", v, (img, rng) => {
      const C = c.P.mat.concrete;
      img.rect(0, 0, 16, 16, mix(C[2], C[3], 0.25));
      for (let i = 0; i < 7; i++) img.set(1 + Math.floor(rng() * 14), 1 + Math.floor(rng() * 14), i % 2 ? C[1] : C[3]);
      img.rect(0, 15, 16, 1, C[1]);
      if (v === 1) img.ellipse(6, 9, 2, 1, mix(C[2], C[1], 0.6));
    }),
    edge: (c, p, mask, x, y, tex) => {
      const C = c.P.mat.concrete, G = c.P.mat.gold, faceH = Math.round(5 * c.k);
      if (!(mask & S)) {
        const fy = y - (c.t - faceH);
        if (fy >= 0) {
          if (faceEnds(mask, x, c.t)) return c.P.outline;
          const f = Math.floor(fy / c.k);
          return f === 0 ? C[4] : f === 1 ? C[1] : f === 2 ? C[1] : f === 3 ? C[0] : c.P.outline;
        }
        const line = Math.floor(-fy / c.k);
        if (line === 2 || line === 3) return line === 3 ? G[3] : G[2];
      }
      const d = Math.floor(p.d / c.k);
      if (d === 0) return lightSide(p) ? C[4] : C[1];
      if ((d === 2 || d === 3) && !(p.ny > 0)) return d === 2 ? G[3] : G[2];
      return tex;
    },
  },
  {
    name: "puddle", what: "a shallow puddle on the street: dark water with a wet rim, holding the lights (walked through)", solid: false, shape: { inset: 1, round: 4, wobble: 1 }, variants: 3,
    texture: (c, v) => tex16(c, "puddle", v, (img, rng) => {
      const Wa = c.P.mat.water, base = mix(Wa[1], c.P.mat.asphalt[1], 0.35);
      img.rect(0, 0, 16, 16, base);
      // rain rings
      for (let i = 0; i < 2; i++) {
        const [x, y] = [3 + Math.floor(rng() * 9), 3 + Math.floor(rng() * 9)];
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) img.set(x + dx, y + dy, mix(base, Wa[3], 0.45));
      }
      const x = 4 + Math.floor(rng() * 7), y = 3 + Math.floor(rng() * 3);
      if (v === 0) streak(img, x, y, 8, mix(base, Wa[3], 0.4), mix(base, Wa[4], 0.6), mix(Wa[4], WHITE, 0.3));
      if (v === 1) streak(img, x, y, 8, mix(base, A(c, 0)[1], 0.6), A(c, 0)[2], mix(A(c, 0)[2], WHITE, 0.45));
      if (v === 2) streak(img, x, y, 8, mix(base, A(c, 1)[1], 0.6), A(c, 1)[2], mix(A(c, 1)[2], WHITE, 0.45));
    }),
    // the street's lip throws a shadow on the water along the top and left; the far rim catches the light
    edge: (c, p, _m, _x, _y, tex) => {
      const Wa = c.P.mat.water;
      if (p.d < 0) return null;
      if (p.d === 0) return mix(c.P.mat.asphalt[0], c.P.outline, 0.35);
      if (p.d === 1) return lightSide(p) ? mix(Wa[0], c.P.outline, 0.3) : mix(Wa[3], c.P.mat.asphalt[3], 0.4);
      return tex;
    },
  },
  cityWall("concrete_wall", "a wall of cast concrete: a dark top and, where it faces us, its face with seams, tie holes and streaks",
    (c) => tex16(c, "concrete_wall", 0, (img, rng) => {
      const C = c.P.mat.concrete, top = mix(C[0], c.P.outline, 0.3);
      img.rect(0, 0, 16, 16, top);
      for (let i = 0; i < 6; i++) img.set(1 + Math.floor(rng() * 14), 1 + Math.floor(rng() * 14), i % 2 ? shade(top, 1) : C[0]);
    }),
    (c, x, fy, h) => {
      const C = c.P.mat.concrete;
      if (fy === 0) return C[4];
      if (fy >= h - 2) return shade(C[1], -0.6);
      const drip = fy < 2 + Math.floor(hash2(x, 3, c.seed + 61) * 6) && hash2(x, 4, c.seed + 62) < 0.3;
      if (fy % 4 === 0) return C[1];
      if (x % 8 === 3 && fy % 4 === 2) return C[0];
      return drip ? mix(C[2], C[1], 0.6) : x === 0 ? C[3] : C[2];
    }),
  cityWall("metal_wall", "a wall of corrugated metal sheet: ribs, a rail, rust where the rain runs",
    (c) => tex16(c, "metal_wall", 0, (img) => {
      const P = c.P.mat.plate, top = mix(P[0], c.P.outline, 0.25);
      img.rect(0, 0, 16, 16, top);
      for (let x = 1; x < 16; x += 4) img.rect(x, 0, 1, 16, shade(top, 0.8));
    }),
    (c, x, fy, h) => {
      const P = c.P.mat.plate, R = c.P.mat.rust;
      if (fy === 0) return P[4];
      if (fy === 4) return P[0];
      if (fy === 5) return P[3];
      const rib = x % 3 === 0 ? P[3] : x % 3 === 1 ? P[2] : P[1];
      const rust = hash2(x >> 1, 9, c.seed + 63) < 0.25 && fy > 5 && fy < 5 + hash2(x, 8, c.seed) * 5;
      return fy >= h - 2 ? shade(rib, -1) : rust ? R[x % 3 === 0 ? 2 : 1] : rib;
    }),
  cityWall("glass_wall", "a glass wall in a metal frame: the floor shows through its panes (shots pass, bodies do not)",
    (c) => tex16(c, "glass_wall", 0, (img) => {
      const F = c.P.mat.metal, G = c.P.mat.glass;
      img.rect(0, 0, 16, 16, F[1]);
      img.rect(0, 7, 16, 2, G[3]);
      img.rect(0, 7, 16, 1, G[4]);
      img.rect(0, 0, 16, 1, F[3]);
    }),
    (c, x, fy, h) => {
      const F = c.P.mat.metal, G = c.P.mat.glass;
      if (fy === 0) return F[3];
      if (fy === 1 || fy >= h - 2) return fy >= h - 1 ? F[0] : F[1];
      if (x === 0 || x === 8) return x === 0 ? F[2] : F[1];
      const d = (x + fy) % 9;
      return d === 0 ? alpha(G[4], 210) : d === 1 ? alpha(G[3], 170) : alpha(G[2], 120);
    }, true),
];

// ---- terrains that join along their length --------------------------------------------------------------------------------
/// Which halves of a tile a run along the map covers: the tile's middle to each side it goes on to.
const runs = (mask: number) => ({ n: !!(mask & 1), e: !!(mask & 2), s: !!(mask & 4), w: !!(mask & 8) });

function railTile(c: Ctx, mask: number): Img {
  const img = new Img(16, 16), M = c.P.mat.metal, C = c.P.mat.concrete, a = c.P.mat.asphalt;
  const r = runs(mask);
  const across = r.e || r.w || (!r.n && !r.s), along = r.n || r.s;
  const sett = (x: number, y: number, vertical: boolean) => {
    const u = vertical ? y : x, v = vertical ? x : y;
    const joint = u % 3 === 2 || (v - 5) % 3 === 2;
    return joint ? a[0] : (u + v) % 5 === 0 ? mix(C[2], C[1], 0.5) : mix(C[1], a[2], 0.3);
  };
  // the stones between the rails, then the rails: a lit steel top and the dark groove beside it
  const lay = (vertical: boolean, from: number, to: number) => {
    for (let i = from; i < to; i++) for (let j = 5; j <= 10; j++) {
      const [x, y] = vertical ? [j, i] : [i, j];
      img.set(x, y, sett(x, y, vertical));
    }
    for (const at of [4, 11]) for (let i = from; i < to; i++) {
      const [x, y] = vertical ? [at, i] : [i, at];
      img.set(x, y, i % 5 === 1 ? M[4] : M[2]);
      img.set(vertical ? x + 1 : x, vertical ? y : y + 1, a[0]);
    }
  };
  if (across) lay(false, r.w || (!r.e && !along) ? 0 : 8, r.e || (!r.w && !along) ? 16 : 8);
  if (along) lay(true, r.n ? 0 : 8, r.s ? 16 : 8);
  if (!across && !along) lay(false, 2, 14);
  return up(img, c.k);
}

function stripTile(c: Ctx, mask: number, acc: Ramp): Img {
  const img = new Img(16, 16);
  const r = runs(mask);
  const core = (x: number, y: number) =>
    (y === 7 && ((r.w && x <= 7) || (r.e && x >= 7))) || (x === 7 && ((r.n && y <= 7) || (r.s && y >= 7))) || (mask === 0 && y === 7 && x >= 4 && x <= 11);
  // a dark channel the tube lies in, then the light
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (core(x, y) || core(x, y - 1) || core(x, y + 1) || core(x - 1, y) || core(x + 1, y)) img.set(x, y, c.P.mat.plate[0]);
  glow(img, core, acc);
  return up(img, c.k);
}

export const CITY_EDGES: EdgeKind[] = [
  { name: "tram_rail", what: "a tram line set in the street: two rails with stones between, joining along its length (walked over)", solid: false, tile: railTile },
  { name: "neon_strip", what: "a lit strip in the floor in accent 1, joining along its length", solid: false, tile: (c, m) => stripTile(c, m, A(c, 0)) },
  { name: "neon_strip2", what: "the same in accent 2", solid: false, tile: (c, m) => stripTile(c, m, A(c, 1)) },
];

// ---- props ----------------------------------------------------------------------------------------------------------------
/// One prop drawn at 16 pixels a tile: its body outlined, its shadow under it, and what glows on top.
function prop(c: Ctx, w: number, h: number, draw: (body: Img, after: Img) => void, shadow?: [number, number]): Img {
  const img = new Img(16 * w, 16 * h), body = new Img(16 * w, 16 * h), after = new Img(16 * w, 16 * h);
  draw(body, after);
  if (shadow) ground(img, shadow[0], 16 * h - 1.5, shadow[1]);
  img.draw(body.outline(c.P.outline));
  img.draw(after);
  return up(img, c.k);
}

/// A box lit from the top left: its top lighter, its left edge lit, its right edge dark.
function box(img: Img, x: number, y: number, w: number, h: number, r: Ramp, top = 2) {
  img.rect(x, y, w, h, r[2]);
  img.rect(x, y, w, top, r[3]);
  img.rect(x, y, w, 1, r[4]);
  img.rect(x, y + top, 1, h - top, r[3]);
  img.rect(x + w - 1, y + top, 1, h - top, r[1]);
  img.rect(x, y + h - 1, w, 1, r[1]);
}

/// The vending machine, shared with creature_make's vending mimic, which must look exactly like it until it opens.
export function vendingMachine(c: Ctx): Img {
  return prop(c, 1, 2, (b, after) => {
    const P = c.P.mat.plate, G = c.P.mat.glass, M = c.P.mat;
    box(b, 1, 4, 14, 27, P, 2);
    b.rect(13, 6, 1, 24, P[0]);
    // the lit header, the window of cans on three shelves, the buttons and the slot
    b.rect(3, 7, 10, 3, mix(c.P.outline, P[0], 0.5));
    b.rect(3, 11, 8, 11, mix(c.P.outline, G[1], 0.55));
    const cans: Rgba[] = [M.flower2[3], M.flower[3], M.leaf[4], M.gold[3], M.metal[4]];
    for (const [row, y] of [[0, 12], [1, 16], [2, 20]] as const) {
      for (let i = 0; i < 4; i++) {
        b.rect(4 + i * 2, y, 1, 2, cans[(i + row * 2) % cans.length]!);
        b.set(4 + i * 2, y, mix(cans[(i + row * 2) % cans.length]!, WHITE, 0.4));
      }
      b.rect(3, y + 2, 8, 1, P[1]);
    }
    b.line(4, 13, 6, 11, alpha(G[4], 170));
    b.rect(11, 11, 2, 9, P[1]);
    for (const y of [12, 14, 16]) b.set(11, y, P[4]);
    b.rect(3, 24, 10, 3, mix(c.P.outline, P[0], 0.3));
    b.rect(3, 23, 10, 1, P[3]);
    b.rect(2, 29, 12, 2, P[0]);
    glow(after, (x, y) => y === 8 && x >= 4 && x <= 11, A(c, 0), { ring: false });
    glow(after, (x, y) => x === 12 && y === 18, A(c, 1), { ring: false });
  }, [8, 7.5]);
}

function sign(c: Ctx, shape: (x: number, y: number) => boolean, acc: Ramp): Img {
  return prop(c, 1, 2, (b, after) => {
    const P = c.P.mat.plate;
    // a dark board hanging from a bracket, the tubes on it, and down on the wet street the sign's reflection
    b.rect(4, 0, 1, 2, P[2]);
    b.rect(11, 0, 1, 2, P[1]);
    b.rect(1, 2, 14, 11, mix(c.P.outline, P[0], 0.6));
    b.rect(1, 2, 14, 1, P[2]);
    glow(after, (x, y) => x >= 2 && x <= 13 && y >= 3 && y <= 11 && shape(x, y), acc);
    for (let y = 18; y < 31; y++) for (let x = 4; x < 12; x++) {
      const f = (y - 18) / 13, mid = Math.abs(x - 7.5);
      if ((x + y) % 2 || hash2(x, y, c.seed + 70) > 0.85 - f * 0.4 || mid > 3.5 - f * 1.5) continue;
      after.set(x, y, alpha(mid < 1.2 ? acc[2] : acc[1], Math.round(130 - f * 80)));
    }
  });
}

const near = (x: number, y: number, x0: number, y0: number, x1: number, y1: number) => {
  const len = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= len; i++) if (Math.round(x0 + ((x1 - x0) * i) / len) === x && Math.round(y0 + ((y1 - y0) * i) / len) === y) return true;
  return false;
};

const SIGNS: Record<string, { what: string; accent: 0 | 1; shape: (x: number, y: number) => boolean }> = {
  sign_bowl: {
    what: "a noodle bowl with chopsticks", accent: 0,
    shape: (x, y) => (y === 7 && x >= 3 && x <= 12) || (y > 7 && Math.abs(((x - 7.5) / 4.5) ** 2 + ((y - 7) / 3.6) ** 2 - 1) < 0.28) || near(x, y, 8, 3, 11, 6) || near(x, y, 10, 3, 12, 5),
  },
  sign_arrow: { what: "an arrow", accent: 1, shape: (x, y) => (y === 7 && x >= 3 && x <= 11) || near(x, y, 9, 4, 12, 7) || near(x, y, 9, 10, 12, 7) },
  sign_eye: {
    what: "an eye", accent: 0,
    shape: (x, y) => Math.abs(((x - 7.5) / 5.5) ** 2 + ((y - 7) / 3.4) ** 2 - 1) < 0.25 || (Math.abs(x - 7.5) < 1 && Math.abs(y - 7) < 1),
  },
  sign_cross: { what: "a medic's cross", accent: 1, shape: (x, y) => (x === 7 && y >= 4 && y <= 10) || (y === 7 && x >= 4 && x <= 10) },
  sign_bars: { what: "three lines of lit writing", accent: 0, shape: (x, y) => (y === 4 && x >= 3 && x <= 12) || (y === 7 && x >= 3 && x <= 9) || (y === 10 && x >= 3 && x <= 11 && x !== 7) },
};

export const CITY_PROPS: PropKind[] = [
  {
    name: "stall", what: "a market stall two tiles wide: a counter of goods (solid), and an awning with bulbs that is drawn in front of whoever walks behind", w: 2, h: 2, anchor: 0, solid: true, solidRow: true, variants: 1,
    draw: (c) => prop(c, 2, 2, (b, after) => {
      const P = c.P.mat.plate, M = c.P.mat, Rf = M.roof;
      // poles, the counter and its goods
      b.rect(2, 10, 1, 12, M.metal[2]);
      b.rect(29, 10, 1, 12, M.metal[1]);
      box(b, 1, 20, 30, 10, P, 3);
      b.rect(1, 24, 30, 2, Rf[1]);
      for (const x of [8, 16, 24]) b.rect(x, 26, 1, 4, P[0]);
      box(b, 3, 16, 4, 4, ramp(M.flower2[2]), 1);
      for (const x of [8, 10]) box(b, x, 16, 2, 4, M.metal, 1);
      b.ellipse(15, 18, 2.5, 1.5, M.plaster[3]);
      b.rect(13, 17, 5, 1, M.flower2[3]);
      lump(b, 21, 18, 2, 1.6, M.flower, c.seed + 3);
      lump(b, 24, 18, 2, 1.6, M.leaf, c.seed + 4);
      for (const x of [27, 29]) b.rect(x, 15, 1, 5, M.glass[3]);
      // the awning: stripes, a scalloped hem
      for (let y = 1; y < 12; y++) for (let x = 0; x < 32; x++) {
        const stripe = (x >> 2) % 2 ? Rf[2] : Rf[3];
        b.set(x, y, y === 1 ? Rf[4] : y >= 10 ? Rf[1] : x === 0 ? Rf[4] : stripe);
      }
      for (let x = 0; x < 32; x++) if (x % 4 === 1 || x % 4 === 2) b.set(x, 12, (x >> 2) % 2 ? Rf[1] : Rf[2]);
      glow(after, (x, y) => y === 11 && x % 5 === 2, BULB, { ring: false });
    }, [16, 15]),
  },
  {
    name: "cargo_crate", what: "a ribbed cargo crate", w: 1, h: 1, anchor: 0, solid: true, variants: 1,
    draw: (c) => prop(c, 1, 1, (b) => {
      const R = c.P.mat.rust;
      box(b, 2, 3, 12, 11, R, 3);
      for (const x of [5, 10]) b.rect(x, 6, 1, 7, R[1]);
      for (const [x, y] of [[2, 3], [13, 3], [2, 13], [13, 13]] as const) b.set(x, y, c.P.mat.metal[3]);
      for (const x of [6, 8]) b.rect(x, 9, 1, 1, c.P.mat.plaster[3]);
    }, [8, 6]),
  },
  {
    name: "explosive_barrel", what: "a red drum with a hazard band: it explodes (the name says so; the game decides how)", w: 1, h: 1, anchor: 0, solid: true, variants: 1,
    draw: (c) => prop(c, 1, 1, (b) => {
      const red = ramp(hex("#b0302a")), G = c.P.mat.gold;
      for (let y = 3; y < 14; y++) for (let x = 4; x < 12; x++) b.set(x, y, x === 4 ? red[4] : x === 5 ? red[3] : x >= 10 ? red[1] : red[2]);
      for (const y of [5, 12]) b.rect(4, y, 8, 1, red[0]);
      for (let y = 8; y < 11; y++) for (let x = 4; x < 12; x++) b.set(x, y, ((x + y) & 3) < 2 ? G[3] : c.P.outline);
      b.ellipse(7.5, 3, 3.5, 1, red[1]);
      b.set(6, 3, red[4]);
    }, [8, 5]),
  },
  { name: "vending_machine", what: "a vending machine, two tiles tall: lit header and cans (its top is drawn in front of whoever walks behind)", w: 1, h: 2, anchor: 0, solid: true, variants: 1, draw: (c) => vendingMachine(c) },
  ...Object.entries(SIGNS).map(([name, s]): PropKind => ({
    name, what: `a hanging neon sign (${s.what}, accent ${s.accent + 1}): the sign is drawn in front of everything, one tile up, and its reflection lies on the street in the cell named`, w: 1, h: 2, anchor: 0, solid: false, variants: 1,
    draw: (c) => sign(c, s.shape, A(c, s.accent)),
  })),
  {
    name: "street_lamp", what: "a street lamp, two tiles tall: a pool of plain light at its foot", w: 1, h: 2, anchor: 0, solid: true, variants: 1,
    draw: (c) => prop(c, 1, 2, (b, after) => {
      const M = c.P.mat.metal;
      for (let y = 25; y < 31; y++) for (let x = 1; x < 15; x++) {
        const f = ((x - 7.5) / 7) ** 2 + ((y - 28.5) / 2.6) ** 2;
        if (f < 1 && (x + y) % 2 === 0) after.set(x, y, alpha(LAMP[3], f < 0.4 ? 70 : 40));
      }
      b.rect(7, 6, 2, 23, M[2]);
      b.rect(7, 6, 1, 23, M[3]);
      b.rect(5, 27, 6, 3, M[1]);
      b.rect(5, 27, 6, 1, M[3]);
      b.rect(3, 3, 10, 2, M[1]);
      b.rect(3, 3, 10, 1, M[3]);
      glow(after, (x, y) => y === 5 && x >= 4 && x <= 11, LAMP, { ring: false });
    }),
  },
  {
    name: "bin", what: "a street bin", w: 1, h: 1, anchor: 0, solid: true, variants: 1,
    draw: (c) => prop(c, 1, 1, (b) => {
      const P = ramp(mix(c.P.mat.plate[2], c.P.mat.leaf[2], 0.35));
      box(b, 4, 5, 8, 9, P, 1);
      for (const x of [6, 9]) b.rect(x, 7, 1, 6, P[1]);
      b.rect(3, 3, 10, 2, P[3]);
      b.rect(3, 3, 10, 1, P[4]);
      b.rect(6, 2, 4, 1, P[1]);
    }, [8, 5]),
  },
  {
    name: "terminal", what: "a console on a stand, its screen lit in accent 2", w: 1, h: 1, anchor: 0, solid: true, variants: 1,
    draw: (c) => prop(c, 1, 1, (b, after) => {
      const P = c.P.mat.plate, acc = A(c, 1);
      b.rect(6, 9, 4, 5, P[1]);
      b.rect(6, 9, 1, 5, P[3]);
      box(b, 2, 2, 12, 8, P, 1);
      b.rect(3, 3, 10, 5, mix(c.P.outline, acc[0], 0.35));
      b.rect(3, 9, 10, 2, P[3]);
      for (let x = 4; x < 12; x += 2) b.set(x, 10, P[1]);
      glow(after, (x, y) => (y === 4 && x >= 4 && x <= 10) || (y === 6 && x >= 4 && x <= 8), acc, { ring: false });
    }, [8, 5]),
  },
  {
    name: "specimen_tank", what: "a glass tank two tiles tall, lit liquid in accent 1 and something curled inside", w: 1, h: 2, anchor: 0, solid: true, variants: 1,
    draw: (c) => prop(c, 1, 2, (b, after) => {
      const M = c.P.mat.metal, acc = A(c, 0);
      const liquid = ramp(mix(acc[2], c.P.outline, 0.45));
      box(b, 2, 26, 12, 5, M, 1);
      box(b, 2, 2, 12, 4, M, 1);
      for (let y = 6; y < 26; y++) for (let x = 3; x < 13; x++) b.set(x, y, y === 8 ? liquid[4] : y < 8 ? mix(c.P.mat.glass[1], c.P.outline, 0.3) : x === 3 ? liquid[3] : x >= 11 ? liquid[1] : liquid[2]);
      b.ellipse(8, 17, 2, 3.5, mix(c.P.outline, liquid[0], 0.5));
      b.ellipse(8, 12, 1.5, 1.5, mix(c.P.outline, liquid[0], 0.5));
      for (const [x, y] of [[5, 21], [6, 14], [10, 10], [9, 19]] as const) b.set(x, y, liquid[4]);
      b.rect(4, 9, 1, 15, alpha(WHITE, 110));
      glow(after, (x, y) => y === 8 && x >= 4 && x <= 11, acc, { ring: false });
      glow(after, (x, y) => (x === 6 || x === 9) && y === 3, acc, { ring: false, halo: false });
    }, [8, 7]),
  },
  {
    name: "server_stack", what: "a rack of servers two tiles tall, its lights blinking in both accents", w: 1, h: 2, anchor: 0, solid: true, variants: 1,
    draw: (c) => prop(c, 1, 2, (b, after) => {
      const P = c.P.mat.plate;
      box(b, 2, 2, 12, 28, P, 2);
      for (let y = 5; y < 28; y += 3) {
        b.rect(3, y, 10, 2, P[2]);
        b.rect(3, y, 10, 1, P[3]);
        b.rect(3, y + 2, 10, 1, P[0]);
        for (let x = 4; x < 9; x += 2) b.set(x, y + 1, P[0]);
        const lit = A(c, ((y / 3) | 0) % 2 as 0 | 1);
        after.set(10, y + 1, mix(lit[2], WHITE, 0.45));
        after.set(11, y + 1, lit[2]);
      }
    }, [8, 7]),
  },
  {
    name: "bench", what: "a metal bench", w: 1, h: 1, anchor: 0, solid: true, variants: 1,
    draw: (c) => prop(c, 1, 1, (b) => {
      const P = c.P.mat.plate;
      for (const x of [2, 13]) b.rect(x, 9, 1, 5, P[1]);
      box(b, 1, 3, 14, 3, P, 1);
      box(b, 1, 7, 14, 3, P, 1);
      b.rect(1, 8, 14, 1, P[1]);
    }, [8, 7]),
  },
  {
    name: "barricade", what: "a concrete barrier with a hazard band and a firing slit", w: 1, h: 1, anchor: 0, solid: true, variants: 1,
    draw: (c) => prop(c, 1, 1, (b) => {
      const C = c.P.mat.concrete, G = c.P.mat.gold;
      box(b, 3, 4, 10, 3, C, 1);
      box(b, 1, 6, 14, 8, C, 1);
      b.rect(5, 7, 6, 1, c.P.outline);
      for (let y = 9; y < 12; y++) for (let x = 2; x < 14; x++) b.set(x, y, ((x - y) & 3) < 2 ? G[3] : mix(c.P.outline, G[0], 0.3));
    }, [8, 7]),
  },
  {
    name: "turnstile", what: "a turnstile: two posts and a turning arm (not solid: the game lets people through one way)", w: 1, h: 1, anchor: 0, solid: false, variants: 1,
    draw: (c) => prop(c, 1, 1, (b, after) => {
      const P = c.P.mat.plate, M = c.P.mat.metal;
      box(b, 1, 4, 3, 10, P, 1);
      box(b, 12, 4, 3, 10, P, 1);
      b.line(4, 8, 7, 8, M[3]);
      b.line(7, 8, 10, 6, M[3]);
      b.line(7, 8, 10, 11, M[2]);
      b.rect(6, 7, 2, 2, M[1]);
      after.set(13, 5, mix(A(c, 1)[2], WHITE, 0.4));
    }, [8, 7]),
  },
  {
    name: "ticket_booth", what: "a ticket booth two tiles wide and tall: a lit window and a sign (its top is drawn in front of whoever walks behind)", w: 2, h: 2, anchor: 0, solid: true, solidRow: true, variants: 1,
    draw: (c) => prop(c, 2, 2, (b, after) => {
      const P = c.P.mat.plate, Rf = c.P.mat.roof;
      box(b, 2, 6, 28, 25, P, 1);
      b.rect(0, 2, 32, 4, Rf[2]);
      b.rect(0, 2, 32, 1, Rf[4]);
      b.rect(0, 5, 32, 1, Rf[0]);
      b.rect(5, 9, 22, 10, mix(BULB[0], c.P.outline, 0.55));
      b.ellipse(16, 15, 3, 3, mix(c.P.outline, BULB[0], 0.25));
      b.ellipse(16, 11, 2, 2, mix(c.P.outline, BULB[0], 0.25));
      b.line(6, 17, 12, 10, alpha(WHITE, 90));
      b.rect(4, 19, 24, 2, P[3]);
      b.rect(14, 21, 4, 1, c.P.outline);
      for (const x of [9, 16, 23]) b.rect(x, 23, 1, 7, P[1]);
      glow(after, (x, y) => y === 3 && x >= 10 && x <= 21 && x % 3 !== 0, A(c, 0), { ring: false });
    }, [16, 15]),
  },
  {
    name: "pillar", what: "a concrete pillar two tiles tall (its top is drawn in front of whoever walks behind)", w: 1, h: 2, anchor: 0, solid: true, variants: 1,
    draw: (c) => prop(c, 1, 2, (b) => {
      const C = c.P.mat.concrete;
      for (let y = 4; y < 29; y++) for (let x = 4; x < 12; x++) b.set(x, y, x < 6 ? C[3] : x > 9 ? C[1] : y > 24 ? mix(C[2], C[1], 0.6) : C[2]);
      box(b, 3, 1, 10, 3, C, 1);
      box(b, 3, 28, 10, 3, C, 1);
    }, [8, 6]),
  },
  {
    name: "potted_plant", what: "a plant in a concrete pot", w: 1, h: 1, anchor: 0, solid: true, variants: 1,
    draw: (c) => prop(c, 1, 1, (b) => {
      const C = c.P.mat.concrete, L = c.P.mat.leaf;
      for (let y = 9; y < 15; y++) for (let x = 4 + ((y - 9) >> 2); x < 12 - ((y - 9) >> 2); x++) b.set(x, y, x < 6 ? C[3] : x > 9 ? C[1] : C[2]);
      b.rect(3, 9, 10, 1, C[4]);
      lump(b, 8, 6, 4, 3.5, L, c.seed + 11);
      lump(b, 5, 4, 2, 2, L, c.seed + 12);
      lump(b, 11, 4, 2, 2.5, L, c.seed + 13);
    }, [8, 5]),
  },
  {
    name: "desk", what: "an office desk with a lit monitor", w: 1, h: 1, anchor: 0, solid: true, variants: 1,
    draw: (c) => prop(c, 1, 1, (b, after) => {
      const P = c.P.mat.plate, Mb = c.P.mat.marble;
      box(b, 1, 6, 14, 4, Mb, 2);
      b.rect(2, 10, 2, 4, P[1]);
      b.rect(12, 10, 2, 4, P[1]);
      b.rect(5, 1, 6, 5, P[1]);
      b.rect(6, 2, 4, 3, mix(c.P.outline, A(c, 1)[0], 0.5));
      b.rect(10, 7, 3, 2, Mb[4]);
      glow(after, (x, y) => y === 3 && x >= 6 && x <= 9, A(c, 1), { ring: false, halo: false });
    }, [8, 7]),
  },
  {
    name: "vent", what: "a floor vent (walked over); vent_puff is the same vent puffing a cloud in accent 1", w: 1, h: 1, anchor: 0, solid: false, variants: 1,
    draw: (c) => ventImg(c, false),
  },
  { name: "vent_puff", what: "the vent puffing (swap the tile to puff)", w: 1, h: 1, anchor: 0, solid: false, variants: 1, draw: (c) => ventImg(c, true) },
  {
    name: "cables", what: "cables lying across the floor (walked over); they run on into the tiles beside", w: 1, h: 1, anchor: 0, solid: false, variants: 1,
    draw: (c) => prop(c, 1, 1, (b) => {
      const P = c.P.mat.plate, Rf = c.P.mat.roof;
      const cable = (y0: number, sag: number, r: Rgba[]) => {
        for (let x = 0; x < 16; x++) {
          const y = Math.round(y0 + sag * Math.sin((x / 15) * Math.PI));
          b.set(x, y, r[1]!);
          b.set(x, y + 1, r[0]!);
        }
      };
      cable(5, 2, [mix(c.P.outline, P[0], 0.6), P[1]]);
      cable(9, -1, [Rf[0], Rf[2]]);
      cable(11, 1.5, [mix(c.P.outline, P[0], 0.6), P[2]]);
      b.rect(10, 6, 2, 8, c.P.mat.metal[2]);
    }),
  },
  {
    name: "manhole", what: "a manhole cover (walked over)", w: 1, h: 1, anchor: 0, solid: false, variants: 1,
    draw: (c) => prop(c, 1, 1, (b) => {
      const M = c.P.mat.metal;
      b.ellipse(7.5, 8, 6, 5, (x, y) => {
        const u = (x - 7.5) / 6, v = (y - 8) / 5, r = u * u + v * v;
        if (r > 0.7) return u + v < 0 ? M[2] : M[0];
        return (x + y) % 3 === 0 ? M[0] : M[1];
      });
      b.rect(6, 7, 4, 2, M[2]);
    }),
  },
  {
    name: "shutter", what: "a rolling shutter that fills its tile: put it in a wall (solid while shut; shutter_open is it rolled up)", w: 1, h: 1, anchor: 0, solid: true, variants: 1,
    draw: (c) => shutterImg(c, false),
  },
  { name: "shutter_open", what: "the shutter rolled up: a dark way through (not solid)", w: 1, h: 1, anchor: 0, solid: false, variants: 1, draw: (c) => shutterImg(c, true) },
];

function ventImg(c: Ctx, puff: boolean): Img {
  return prop(c, 1, 1, (b, after) => {
    const P = c.P.mat.plate;
    box(b, 2, 4, 12, 10, P, 1);
    for (let y = 6; y < 13; y += 2) b.rect(3, y, 10, 1, mix(c.P.outline, P[0], 0.5));
    if (puff) {
      const acc = A(c, 0);
      for (const [cx, cy, r] of [[8, 6, 5], [4.5, 4, 3], [11, 3, 3.5], [7, 1.5, 2.5]] as const) {
        after.ellipse(cx, cy, r, r * 0.8, (x, y) => ((x + y) % 2 === 0 || Math.hypot(x - cx, y - cy) < r * 0.5 ? alpha(Math.hypot(x - cx, y - cy) < r * 0.55 ? acc[3] : acc[1], 190) : undefined));
      }
    }
  });
}

function shutterImg(c: Ctx, open: boolean): Img {
  const P = c.P.mat.plate, img = new Img(16, 16);
  img.rect(0, 0, 16, 16, P[1]);
  img.rect(0, 0, 16, 4, P[1]);
  img.rect(0, 0, 16, 1, P[3]);
  img.rect(0, 3, 16, 1, P[0]);
  if (open) {
    for (let y = 4; y < 16; y++) img.rect(2, y, 12, 1, mix(c.P.outline, c.P.mat.asphalt[1], (y - 4) / 16));
    img.rect(2, 4, 12, 2, P[3]);
    img.rect(2, 5, 12, 1, P[1]);
  } else {
    for (let y = 4; y < 16; y++) img.rect(2, y, 12, 1, y % 2 ? P[1] : P[3]);
    img.rect(6, 14, 4, 1, P[0]);
  }
  img.rect(0, 0, 1, 16, c.P.outline);
  img.rect(15, 0, 1, 16, c.P.outline);
  img.rect(1, 1, 1, 15, P[3]);
  img.rect(14, 1, 1, 15, P[0]);
  glow(img, (x, y) => x === 12 && y === 1, A(c, open ? 1 : 0), { ring: false });
  return up(img, c.k);
}

export const CITY_TERRAIN_NAMES = [...CITY_TERRAINS.map((t) => t.name), ...CITY_EDGES.map((t) => t.name)];
export const CITY_PROP_NAMES = CITY_PROPS.map((p) => p.name);
