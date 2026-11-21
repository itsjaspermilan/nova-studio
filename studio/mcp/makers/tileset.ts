// tileset_make: a whole tileset from a short recipe. Terrains (grass, path, sand, water, floors, walls, hedge, cliff, roof)
// come with the 47 joining tiles each that the studio's terrain brush and scene_write's `paint` choose from, so areas meet
// with proper edges and corners; props (trees, bushes, rocks, flowers, a fence, a door, a window) are tiles too.
//
// How the pictures are made, so that every tile agrees with every other:
//  - the light comes from the top left: what faces up or left is lighter, what faces down or right darker, and something
//    higher (a bank of grass, a wall) throws its shadow down and to the right;
//  - ground has no outline, only a darker lip where one terrain meets another; things that stand on the ground (a hedge,
//    a wall, a tree, a rock) have the palette's outline all round and a soft shadow at the foot;
//  - large areas are never flat and never noise: a few deliberate marks per tile, and two to four variants of each
//    ground tile that `paint` scatters.
// The result is an ordinary tileset: tiles can be redrawn with sprite_write `at`, added with `append`, renamed.

import { BLOB_MASKS, E, N, NE, NW, S, SE, SW, W, type Terrain } from "../../src/lib/autotile";
import { hash2, Img, mix, rngOf, seedOf, shade, SHADOW, type Ramp, type Rgba } from "./paint";
import { describePalette, paletteOf } from "./palettes";
import { HD_PROPS, HD_TERRAINS, railHd, stripHd } from "./city-hd";
import { styleOf } from "./style";
import { CITY_EDGES, CITY_PROP_NAMES, CITY_PROPS, CITY_TERRAIN_NAMES, CITY_TERRAINS } from "./city-tiles";
import { faceEnds, ground, lightSide, lump, speckle, times, type Ctx, type EdgeKind, type Probe, type PropKind, type Shape, type TerrainKind } from "./tilekit";
import { writeSheet, type Put } from "./sheet";
import { tileRoom } from "../../src/lib/tileset";
import { poolWobble, wearTiles, WORN } from "./wear";

type Args = Record<string, any>;

// ---- the shape of a terrain's edge ---------------------------------------------------------------------------------------


/// An edge that wanders by a pixel: the same along every tile, and 0 at both ends so that corners meet.
function wobbleOf(t: number, amount: number, seed: number): number[] {
  const out = new Array<number>(t).fill(0);
  if (!amount) return out;
  const rng = rngOf(seed);
  let x = 2;
  while (x < t - 2) {
    const len = 3 + Math.floor(rng() * 4);
    const v = rng() < 0.45 ? 0 : rng() < 0.5 ? -amount : amount;
    for (let i = x; i < Math.min(t - 2, x + len); i++) out[i] = v;
    x += len;
  }
  return out;
}

function probe(mask: number, x: number, y: number, t: number, s: Shape, wob: number[][]): Probe {
  const cx = x + 0.5, cy = y + 0.5;
  const n = !(mask & N), e = !(mask & E), so = !(mask & S), w = !(mask & W);
  let d = 99, nx = 0, ny = 0;
  const take = (dist: number, ax: number, ay: number) => {
    if (dist < d) [d, nx, ny] = [dist, ax, ay];
  };
  if (n) take(cy - s.inset - wob[0]![x]!, 0, -1);
  if (e) take(t - cx - s.inset - wob[1]![y]!, 1, 0);
  if (so) take(t - cy - s.inset - wob[2]![x]!, 0, 1);
  if (w) take(cx - s.inset - wob[3]![y]!, -1, 0);
  // outer corners are rounded
  const R = s.round, i = s.inset;
  const corner = (open: boolean, ox: number, oy: number, ax: number, ay: number) => {
    if (!open || !R) return;
    const dx = ax < 0 ? i + R - cx : cx - (t - i - R), dy = ay < 0 ? i + R - cy : cy - (t - i - R);
    if (dx > 0 && dy > 0) take(R - Math.hypot(dx, dy), ox, oy);
  };
  corner(n && w, -1, -1, -1, -1);
  corner(n && e, 1, -1, 1, -1);
  corner(so && w, -1, 1, -1, 1);
  corner(so && e, 1, 1, 1, 1);
  // inner corners: both sides are the terrain but the cell across the corner is not, so it bites a quarter circle out
  const bite = (open: boolean, px: number, py: number, ax: number, ay: number) => {
    if (open) take(Math.hypot(cx - px, cy - py) - Math.max(i, 0.5), ax, ay);
  };
  bite(!n && !w && !(mask & NW), 0, 0, -1, -1);
  bite(!n && !e && !(mask & NE), t, 0, 1, -1);
  bite(!so && !w && !(mask & SW), 0, t, -1, 1);
  bite(!so && !e && !(mask & SE), t, t, 1, 1);
  return { d: d >= 0 ? Math.floor(d) : -1, nx, ny };
}

// ---- what a recipe can ask for ----------------------------------------------------------------------------------------------



/// The outermost pixel of bare ground (a path, sand) where grass begins: earth in the grass's shade along the top and
/// left, where the higher ground throws its shadow, and only a little darker than the ground along the bottom and right.
const lip = (c: Ctx, r: Ramp, shaded: boolean): Rgba => (shaded ? mix(r[0], c.P.mat.grass[0], 0.45) : mix(r[1], c.P.mat.grass[1], 0.25));



function grassTexture(c: Ctx, v: number, g: Ramp = c.P.mat.grass): Img {
  return speckle(c, "grass", v, g[2], (img, rng, at) => {
    const area = c.k * c.k;
    times(4 * area, () => img.set(...at(), g[1]));
    times(3 * area, () => {
      const [x, y] = at();
      img.set(x, y, g[3]);
      img.set(x, y - 1, g[3]);
    });
    if (v === 1) {
      // a tuft: two blades leaning apart over a dark root
      const [x, y] = [3 + Math.floor(rng() * (c.t - 7)), 6 + Math.floor(rng() * (c.t - 9))];
      img.line(x, y, x - 1, y - 2, g[3]);
      img.line(x + 1, y, x + 2, y - 3, g[3]);
      img.set(x + 2, y - 3, g[4]);
      img.set(x, y + 1, g[1]);
      img.set(x + 1, y + 1, g[1]);
    } else if (v === 2) {
      // a patch of shorter, darker grass
      const [x, y] = [3 + Math.floor(rng() * (c.t - 9)), 4 + Math.floor(rng() * (c.t - 9))];
      for (const [dx, dy] of [[0, 0], [1, 0], [2, 0], [4, 0], [1, 1], [2, 1], [3, 1], [0, 2], [2, 2], [3, 2]]) img.set(x + dx!, y + dy!, mix(g[2], g[1], 0.6));
      img.set(x + 3, y, g[1]);
      img.set(x + 1, y + 2, g[1]);
    } else if (v === 3) {
      // two small wild flowers
      for (const f of [c.P.mat.flower3[3], c.P.mat.flower2[2]]) {
        const [x, y] = at();
        img.set(x, y, f);
        img.set(x, y + 1, g[0]);
      }
    }
  });
}

function pebble(img: Img, x: number, y: number, r: Ramp) {
  img.set(x, y, r[4]);
  img.set(x + 1, y, r[3]);
  img.set(x, y + 1, r[1]);
  img.set(x + 1, y + 1, r[0]);
}

const TERRAINS: TerrainKind[] = [
  {
    name: "grass", what: "open ground", solid: false, shape: { inset: 1, round: 3, wobble: 1 }, variants: 8,
    texture: (c, v) => grassTexture(c, v),
    edge: (c, p, _m, _x, _y, tex) => (p.d < 0 ? null : p.d === 0 ? c.P.mat.grass[lightSide(p) ? 3 : 0] : p.d === 1 && !lightSide(p) ? c.P.mat.grass[1] : tex),
  },
  {
    name: "sand", what: "a beach, a desert floor", solid: false, shape: { inset: 1, round: 3, wobble: 1 }, variants: 3,
    texture: (c, v) => {
      const s = c.P.mat.sand;
      return speckle(c, "sand", v, s[2], (img, rng, at) => {
        times(3 * c.k * c.k, () => {
          const [x, y] = at();
          const len = 2 + Math.floor(rng() * 3);
          for (let i = 0; i < len && x + i < c.t - 1; i++) img.set(x + i, y, s[3]);
        });
        times(4 * c.k * c.k, () => img.set(...at(), s[1]));
        if (v === 2) {
          const [x, y] = at();
          img.set(x, y, c.P.mat.flower3[3]);
          img.set(x, y + 1, s[0]);
        }
      });
    },
    edge: (c, p, _m, x, y, tex) => (p.d < 0 ? null : p.d === 0 ? lip(c, c.P.mat.sand, lightSide(p)) : p.d === 1 && lightSide(p) && (x + y) % 2 === 0 ? c.P.mat.sand[1] : tex),
  },
  {
    name: "path", what: "a dirt path or a yard", solid: false, shape: { inset: 2, round: 3, wobble: 1 }, variants: 4,
    texture: (c, v) => {
      const p = c.P.mat.path;
      return speckle(c, "path", v, p[2], (img, _rng, at) => {
        times(5 * c.k * c.k, () => img.set(...at(), p[1]));
        times(3 * c.k * c.k, () => img.set(...at(), p[3]));
        if (v >= 2) pebble(img, ...at(), p);
        if (v === 3) {
          const [x, y] = at();
          pebble(img, Math.min(c.t - 3, x), Math.max(2, y - 3), p);
          img.line(x, y + 2, x + 2, y + 3, p[1]);
        }
      });
    },
    // the grass beside a path stands a little higher: its shadow falls on the path's top and left edges
    edge: (c, p, _m, _x, _y, tex) => (p.d < 0 ? null : p.d === 0 ? lip(c, c.P.mat.path, lightSide(p)) : p.d === 1 && lightSide(p) ? mix(c.P.mat.path[2], c.P.mat.path[1], 0.7) : tex),
  },
  {
    name: "stone_floor", what: "flagstones, indoors or a town square", solid: false, shape: { inset: 0, round: 0, wobble: 0 }, variants: 4,
    texture: (c, v) => {
      const s = c.P.mat.stone;
      const img = new Img(c.t, c.t);
      const h = c.t / 2, w = c.t / 2;
      for (let y = 0; y < c.t; y++) for (let x = 0; x < c.t; x++) {
        const row = Math.floor(y / h);
        const ox = (x + (row % 2 ? w / 2 : 0)) % c.t;
        const lx = ox % w, ly = y % h, col = Math.floor(ox / w);
        const tone = hash2(col + v * 7, row + v * 3, c.seed + 11);
        const face = tone < 0.3 ? mix(s[2], s[1], 0.45) : tone > 0.75 ? mix(s[2], s[3], 0.5) : s[2];
        img.set(x, y, lx === w - 1 || ly === h - 1 ? s[1] : lx === 0 || ly === 0 ? mix(face, s[4], 0.3) : lx === w - 2 || ly === h - 2 ? mix(face, s[1], 0.3) : face);
      }
      if (v === 3) {
        img.line(c.t * 0.2, c.t * 0.15, c.t * 0.35, c.t * 0.3, s[1]);
        img.line(c.t * 0.35, c.t * 0.3, c.t * 0.3, c.t * 0.4, s[1]);
      }
      return img;
    },
    edge: (_c, p, _m, _x, _y, tex) => (p.d === 0 ? shade(tex, lightSide(p) ? -2.4 : -1) : p.d === 1 && lightSide(p) ? shade(tex, -1) : tex),
  },
  {
    name: "wood_floor", what: "floorboards", solid: false, shape: { inset: 0, round: 0, wobble: 0 }, variants: 2,
    texture: (c, v) => {
      const w = c.P.mat.wood;
      const img = new Img(c.t, c.t);
      const h = c.t / 4;
      for (let y = 0; y < c.t; y++) for (let x = 0; x < c.t; x++) {
        const row = Math.floor(y / h), ly = y % h;
        const joint = Math.floor(hash2(row, v, c.seed + 5) * c.t);
        const board = hash2(row + (x > joint ? 31 : 0), v * 5, c.seed + 9);
        const face = board < 0.35 ? mix(w[2], w[1], 0.4) : board > 0.7 ? mix(w[2], w[3], 0.45) : w[2];
        const grain = hash2(Math.floor(x / 3) + row * 13, v + 40, c.seed) < 0.16 && ly === Math.floor(h / 2);
        img.set(x, y, ly === h - 1 ? w[1] : x === joint ? w[0] : ly === 0 ? mix(face, w[4], 0.35) : grain ? mix(face, w[0], 0.4) : face);
      }
      return img;
    },
    edge: (_c, p, _m, _x, _y, tex) => (p.d === 0 ? shade(tex, lightSide(p) ? -2.4 : -1) : p.d === 1 && lightSide(p) ? shade(tex, -1) : tex),
  },
  {
    name: "water", what: "a pond, a river, the sea: with a shore", solid: true, shape: { inset: 1, round: 4, wobble: 1 }, variants: 3,
    texture: (c, v) => {
      const w = c.P.mat.water;
      return speckle(c, "water", v, w[2], (img, rng) => {
        times(2 * c.k * c.k + (v ? 1 : 0), (i) => {
          const x = 2 + Math.floor(rng() * (c.t - 8)), y = 2 + Math.floor(((i + rng() * 0.8) / (2 * c.k * c.k + 1)) * (c.t - 4));
          const len = 3 + Math.floor(rng() * 2);
          for (let j = 0; j < len; j++) img.set(x + j, y, j === 1 ? w[4] : w[3]);
          img.set(x + len, y + 1, w[3]);
          img.set(x + 1, y + 2, w[1]);
          img.set(x + 2, y + 2, w[1]);
        });
      });
    },
    // the bank's shadow lies on the water along the top and left; foam breaks along the bottom and right
    edge: (c, p, _m, x, y, tex) => {
      const w = c.P.mat.water;
      if (p.d < 0) return null;
      if (p.d === 0) return mix(w[0], c.P.outline, 0.35);
      if (lightSide(p)) return p.d === 1 ? w[0] : p.d === 2 ? w[1] : tex;
      if (p.d === 1) return hash2(x >> 1, y >> 1, c.seed + 3) < 0.7 ? w[4] : w[3];
      return p.d === 2 && hash2(x, y, c.seed + 4) < 0.3 ? w[3] : tex;
    },
  },
  {
    name: "hedge", what: "a clipped hedge: a soft wall", solid: true, shape: { inset: 1, round: 3, wobble: 0 }, variants: 3,
    texture: (c, v) => {
      const l = c.P.mat.leaf;
      return speckle(c, "hedge", v, l[2], (img, rng) => {
        // clumps of leaves: each a small lit curve with its shadow under it, one to a quarter of the tile so they never crowd
        const q = c.t / 2;
        for (let i = 0; i < 4; i++) {
          const x = (i % 2) * q + 1 + Math.floor(rng() * (q - 5)), y = Math.floor(i / 2) * q + 1 + Math.floor(rng() * (q - 4));
          img.set(x + 1, y, l[3]);
          img.set(x + 2, y, l[3]);
          img.set(x, y + 1, l[3]);
          if (i % 2 === v % 2) img.set(x + 1, y, l[4]);
          img.set(x + 2, y + 2, l[1]);
          img.set(x + 3, y + 1, l[1]);
          img.set(x + 3, y + 2, l[1]);
          if (rng() < 0.5) img.set(x + 1, y + 3, l[1]);
        }
      });
    },
    edge: (c, p, mask, _x, y, tex) => {
      const l = c.P.mat.leaf;
      if (p.d < 0) return null;
      if (p.d === 0) return c.P.outline;
      const front = !(mask & S) && y >= c.t - Math.round(5 * c.k) - 1; // the side that faces us
      if (front) return y === c.t - Math.round(5 * c.k) - 1 ? l[1] : shade(tex, -1.6);
      if (p.d === 1) return lightSide(p) ? l[4] : l[0];
      return tex;
    },
  },
  {
    name: "cliff", what: "raised ground with a rock face: a plateau nobody climbs", solid: true, shape: { inset: 0, round: 2, wobble: 0 }, variants: 2,
    texture: (c, v) => grassTexture(c, v, c.P.mat.grass.map((g, i) => (i === 2 ? mix(g, c.P.mat.grass[3], 0.35) : g)) as Ramp),
    edge: (c, p, mask, x, y, tex) => {
      // warm rock: the palette's stone with some of its earth in it
      const r = c.P.mat.rock.map((s, i) => mix(s, c.P.mat.path[i]!, 0.42)) as Ramp, g = c.P.mat.grass;
      if (p.d < 0) return null;
      if (p.d === 0) return c.P.outline;
      const cap = c.t - Math.round(11 * c.k);
      if (!(mask & S) && y >= cap) {
        // the rock face: grass hanging over a lit lip, three ledges that darken downwards with light caught on each,
        // two cracks, a dark foot
        if (faceEnds(mask, x, c.t)) return c.P.outline;
        const fy = Math.floor((y - cap) / c.k), fx = Math.floor(x / c.k);
        const jag = (n: number) => hash2(fx, n, c.seed + 20);
        if (fy === 0) return g[jag(1) < 0.3 ? 1 : 0];
        if (fy === 1) return jag(2) < 0.3 ? g[0] : r[4];
        if (y >= c.t - 1 - Math.round(c.k)) return r[0];
        const crackAt = [3 + Math.floor(jag(0) * 0), 11];
        if ((fx === crackAt[0]! + (fy > 5 ? 1 : 0) && fy > 2 && fy < 9) || (fx === crackAt[1]! - (fy > 6 ? 1 : 0) && fy > 4)) return r[0];
        const step = fy - (hash2(fx >> 2, 7, c.seed + 23) < 0.5 ? 1 : 0); // ledges sit a little higher or lower along the face
        if (step === 4 || step === 7) return hash2(fx >> 1, step, c.seed + 24) < 0.6 ? r[4] : r[3];
        return step < 4 ? r[3] : step < 7 ? r[2] : r[1];
      }
      // the other edges of the plateau: turf rounding over, light towards the sun and dark away from it
      if (p.d === 1) return lightSide(p) ? g[4] : g[0];
      if (p.d === 2) return lightSide(p) ? g[3] : g[1];
      return tex;
    },
  },
  {
    name: "earth", what: "ground seen from the side, for a platformer: earth with turf wherever its top is open", solid: true, shape: { inset: 0, round: 2, wobble: 0 }, variants: 3,
    texture: (c, v) => {
      const e = c.P.mat.path.map((p, i) => mix(p, c.P.mat.trunk[i]!, 0.5)) as Ramp;
      return speckle(c, "earth", v, e[2], (img, _rng, at) => {
        times(5 * c.k * c.k, () => img.set(...at(), e[1]));
        times(3 * c.k * c.k, () => img.set(...at(), e[3]));
        if (v >= 1) pebble(img, ...at(), c.P.mat.rock);
        if (v === 2) {
          const [x, y] = at();
          img.line(x, y, Math.min(c.t - 2, x + 3), y + 1, e[0]);
        }
      });
    },
    edge: (c, p, mask, x, y) => {
      const e = c.P.mat.path.map((q, i) => mix(q, c.P.mat.trunk[i]!, 0.5)) as Ramp, g = c.P.mat.grass;
      const tex = hash2(x, y, c.seed + 41) < 0.08 ? e[1] : e[2];
      if (p.d < 0) return null;
      if (p.d === 0) return c.P.outline;
      if (!(mask & N)) {
        // turf: a lit top, blades hanging over the earth unevenly
        const depth = Math.floor(y / c.k);
        const hang = 3 + (hash2(Math.floor(x / c.k) >> 1, 2, c.seed + 40) < 0.4 ? 1 : 0) + (Math.floor(x / c.k) % 5 === 2 ? 1 : 0);
        if (depth === 1) return g[4];
        if (depth === 2) return g[3];
        if (depth <= hang) return depth === hang ? g[1] : g[2];
        if (depth === hang + 1) return e[0];
      }
      if (p.d === 1) return lightSide(p) ? e[3] : e[0];
      if (p.d === 2 && !lightSide(p)) return e[1];
      return tex;
    },
  },
  wall("brick_wall", "a brick wall seen from above: a light top and, where it faces us, its bricks", "brick", 4),
  wall("stone_wall", "a wall of cut stone: the same, for castles and dungeons", "stone", 5),
  {
    name: "house_wall", what: "the front of a house: plaster between timbers (put a roof above it)", solid: true, shape: { inset: 0, round: 0, wobble: 0 }, variants: 1,
    texture: (c) => {
      const pl = c.P.mat.plaster, st = c.P.mat.stone;
      const img = speckle(c, "house_wall", 0, pl[3], (im, _r, at) => times(5 * c.k * c.k, () => im.set(...at(), pl[2])));
      const foot = Math.round(3 * c.k);
      img.rect(0, c.t - foot, c.t, foot, st[2]);
      img.rect(0, c.t - foot, c.t, 1, st[4]);
      img.rect(0, c.t - 1, c.t, 1, st[0]);
      for (let x = Math.round(5 * c.k); x < c.t; x += Math.round(8 * c.k)) img.rect(x, c.t - foot + 1, 1, foot - 2, st[1]);
      return img;
    },
    edge: (c, p, mask, x, y, tex) => {
      const tr = c.P.mat.trunk;
      const beam = Math.round(2 * c.k);
      if (!(mask & N) && y < beam + 1) return y === beam ? shade(tex, -1.5) : tr[y === 0 ? 1 : 2];
      if (!(mask & W) && x < beam + 1) return x === 0 ? c.P.outline : x === beam ? tr[0] : tr[2];
      if (!(mask & E) && x > c.t - beam - 2) return x === c.t - 1 ? c.P.outline : x === c.t - beam - 1 ? tr[3] : tr[1];
      return p.d === 0 && p.ny > 0 ? c.P.outline : tex;
    },
  },
  {
    name: "roof", what: "a tiled roof seen from the front", solid: true, shape: { inset: 0, round: 0, wobble: 0 }, variants: 1,
    texture: (c) => {
      const r = c.P.mat.roof;
      const img = new Img(c.t, c.t);
      const h = Math.round(4 * c.k), w = Math.round(8 * c.k);
      for (let y = 0; y < c.t; y++) for (let x = 0; x < c.t; x++) {
        const row = Math.floor(y / h), ly = y % h, lx = (x + (row % 2 ? w / 2 : 0)) % w;
        const tone = hash2(Math.floor((x + (row % 2 ? w / 2 : 0)) / w), row, c.seed + 33);
        const face = tone < 0.25 ? mix(r[2], r[1], 0.5) : tone > 0.8 ? mix(r[2], r[3], 0.4) : r[2];
        // each tile's lower edge is a shallow curve with a shadow under it
        const lip = ly === h - 1 && lx > 0 && lx < w - 1;
        img.set(x, y, lip || (ly === h - 2 && (lx === 0 || lx === w - 1)) ? r[0] : ly === 0 && lx > 0 && lx < w - 1 ? r[3] : lx === 0 ? r[1] : face);
      }
      return img;
    },
    edge: (c, p, mask, x, y, tex) => {
      const r = c.P.mat.roof;
      if (p.d === 0) return c.P.outline;
      if (!(mask & N) && y === 1) return r[4];
      if (!(mask & N) && y === 2) return r[3];
      if (!(mask & S) && y >= c.t - 3) return r[y === c.t - 2 ? 1 : 0];
      if (!(mask & W) && x === 1) return r[3];
      if (!(mask & E) && x === c.t - 2) return r[1];
      return tex;
    },
  },
];


function wall(name: string, what: string, material: "brick" | "stone", course: number): TerrainKind {
  return {
    name, what, solid: true, shape: { inset: 0, round: 0, wobble: 0 }, variants: 1,
    // the top of the wall: a flat cap, lighter than its face
    texture: (c) => {
      const m = c.P.mat[material];
      const top = mix(mix(m[0], c.P.mat.stone[0], 0.5), c.P.outline, 0.35);
      return speckle(c, name, 0, top, (img, _r, at) => {
        times(3 * c.k * c.k, () => img.set(...at(), shade(top, -1)));
        times(2 * c.k * c.k, () => img.set(...at(), shade(top, 1)));
      });
    },
    edge: (c, p, mask, x, y, tex) => {
      const m = c.P.mat[material];
      const cap = c.t - Math.round(10 * c.k);
      const h = Math.round(course * c.k), w = Math.round(8 * c.k);
      if (!(mask & S) && y >= cap) {
        // the face: courses of brick or stone, each a half step along from the one above, dark where it meets the floor
        if ((!(mask & W) && x === 0) || (!(mask & E) && x === c.t - 1) || y === c.t - 1 || faceEnds(mask, x, c.t)) return c.P.outline;
        const fy = y - cap;
        if (fy === 0) return mix(m[3], c.P.mat.stone[4], 0.35);
        const row = Math.floor((fy - 1) / h), ly = (fy - 1) % h, lx = (x + (row % 2 ? w / 2 : 0)) % w;
        const tone = hash2(Math.floor((x + (row % 2 ? w / 2 : 0)) / w) % 2, row, c.seed + 17);
        let face = tone < 0.3 ? m[1] : tone > 0.8 ? mix(m[2], m[3], 0.5) : m[2];
        if (ly === 0 && material === "stone") face = mix(face, m[4], 0.4);
        if (y >= c.t - 3) face = shade(face, -1.2);
        return ly === h - 1 || lx === w - 1 ? m[0] : face;
      }
      if (p.d === 0) return c.P.outline;
      if (p.d === 1) return lightSide(p) ? mix(m[2], c.P.mat.stone[2], 0.4) : shade(tex, -1.5);
      return tex;
    },
  };
}

// ---- props: things that stand on the ground ------------------------------------------------------------------------------



const PROPS: PropKind[] = [
  {
    name: "tree", what: "a round tree, two tiles tall: its crown is drawn in front of whoever walks behind it", w: 1, h: 2, anchor: 0, solid: true, variants: 2,
    draw: (c, v) => {
      const k = c.k, t = c.t, l = c.P.mat.leaf, tr = c.P.mat.trunk;
      const img = new Img(t, 2 * t);
      const trunk = new Img(t, 2 * t);
      // a short trunk under a crown about as wide as it is tall, made of a few overlapping lumps so its edge is bumpy
      trunk.rect(t / 2 - 2 * k, 21 * k, 4 * k, 8 * k, tr[2]);
      trunk.rect(t / 2 - 2 * k, 21 * k, 1 * k, 8 * k, tr[3]);
      trunk.rect(t / 2 + 1 * k, 21 * k, 1 * k, 8 * k, tr[1]);
      trunk.rect(t / 2 - 3 * k, 28 * k, 6 * k, 1 * k, tr[1]);
      trunk.rect(t / 2 - 2 * k, 21 * k, 4 * k, 4 * k, tr[0]); // the crown's shadow on the trunk
      const crown = new Img(t, 2 * t);
      const s = seedOf(`tree${v}`) + c.seed;
      const top = v === 1 ? 4 : 6;
      lump(crown, t / 2 - 0.5, (top + 23) / 2 * k, 6 * k, ((23 - top) / 2) * k, l, s);
      lump(crown, 4 * k, 17 * k, 3.5 * k, 4.5 * k, l, s + 1);
      lump(crown, 11.5 * k, 18 * k, 3.5 * k, 4 * k, [l[0], l[0], l[1], l[2], l[3]], s + 2);
      lump(crown, 5 * k, (top + 4) * k, 3.5 * k, 3 * k, [l[1], l[2], l[3], l[3], l[4]], s + 3);
      lump(crown, 10.5 * k, (top + 5) * k, 3.5 * k, 3.5 * k, l, s + 4);
      ground(img, t / 2 - 0.5, 29.5 * k, 6 * k);
      img.draw(trunk.outline(c.P.outline));
      img.draw(crown.outline(c.P.outline));
      return img;
    },
  },
  {
    name: "pine", what: "a fir tree, two tiles tall", w: 1, h: 2, anchor: 0, solid: true, variants: 1,
    draw: (c) => {
      const k = c.k, t = c.t, tr = c.P.mat.trunk;
      const l = c.P.mat.leaf.map((x) => mix(x, c.P.mat.water[0], 0.22)) as Ramp;
      const img = new Img(t, 2 * t), body = new Img(t, 2 * t);
      body.rect(t / 2 - 1.5 * k, 25 * k, 3 * k, 5 * k, tr[1]);
      body.rect(t / 2 - 1.5 * k, 25 * k, 1 * k, 5 * k, tr[2]);
      // three skirts, each wider than the one above, lit on the left
      for (const [top, bottom, half] of [[2, 12, 4.5], [8, 19, 6], [14, 26, 7.5]] as const) {
        for (let y = top * k; y < bottom * k; y++) {
          const wide = ((y - top * k + 1) / ((bottom - top) * k)) * half * k;
          for (let x = Math.ceil(t / 2 - 0.5 - wide); x <= Math.floor(t / 2 - 0.5 + wide); x++) {
            const u = (x - (t / 2 - 0.5)) / (half * k);
            const low = y >= (bottom - 1.5) * k;
            body.set(x, y, low ? l[0] : u < -0.35 ? l[3] : u > 0.4 ? l[1] : hash2(x, y, c.seed) < 0.12 ? l[3] : l[2]);
          }
        }
      }
      ground(img, t / 2 - 0.5, 29.5 * k, 6 * k);
      img.draw(body.outline(c.P.outline));
      return img;
    },
  },
  {
    name: "big_tree", what: "an old oak, three tiles wide and three tall (leave a cell between two of them)", w: 3, h: 3, anchor: 1, solid: true, variants: 1,
    draw: (c) => {
      const k = c.k, t = c.t, l = c.P.mat.leaf, tr = c.P.mat.trunk;
      const img = new Img(3 * t, 3 * t), trunk = new Img(3 * t, 3 * t), crown = new Img(3 * t, 3 * t);
      const mx = 1.5 * t - 0.5;
      trunk.rect(mx - 3.5 * k, 28 * k, 8 * k, 17 * k, tr[2]);
      trunk.rect(mx - 3.5 * k, 28 * k, 2 * k, 17 * k, tr[3]);
      trunk.rect(mx + 2.5 * k, 28 * k, 2 * k, 17 * k, tr[1]);
      trunk.rect(mx - 5.5 * k, 43 * k, 12 * k, 2 * k, tr[1]);
      trunk.rect(mx - 1.5 * k, 36 * k, 1 * k, 4 * k, tr[0]);
      trunk.rect(mx - 3.5 * k, 28 * k, 8 * k, 4 * k, tr[0]);
      const s = c.seed + 77;
      lump(crown, mx, 17 * k, 17 * k, 14 * k, l, s);
      lump(crown, mx - 11 * k, 24 * k, 9 * k, 8 * k, l, s + 1);
      lump(crown, mx + 10 * k, 25 * k, 10 * k, 8 * k, [l[0], l[0], l[1], l[2], l[3]], s + 2);
      lump(crown, mx - 6 * k, 9 * k, 9 * k, 7 * k, [l[1], l[2], l[3], l[3], l[4]], s + 3);
      lump(crown, mx + 7 * k, 12 * k, 8 * k, 6 * k, l, s + 4);
      ground(img, mx, 45.5 * k, 14 * k);
      img.draw(trunk.outline(c.P.outline));
      img.draw(crown.outline(c.P.outline));
      return img;
    },
  },
  {
    name: "bush", what: "a round bush", w: 1, h: 1, anchor: 0, solid: true, variants: 2,
    draw: (c, v) => {
      const k = c.k, t = c.t, l = c.P.mat.leaf;
      const img = new Img(t, t), body = new Img(t, t);
      lump(body, t / 2 - 0.5, 9 * k, 6.5 * k, 5 * k, l, c.seed + v);
      lump(body, t / 2 - 3.5 * k, 7 * k, 3 * k, 3 * k, l, c.seed + v + 5);
      lump(body, t / 2 + 2.5 * k, 6.5 * k, 3.5 * k, 3 * k, l, c.seed + v + 9);
      if (v === 1) for (const [x, y] of [[4, 8], [9, 6], [11, 10], [7, 11]]) {
        body.set(x! * k, y! * k, c.P.mat.flower[3]);
        body.set(x! * k, y! * k + 1, c.P.mat.flower[1]);
      }
      ground(img, t / 2 - 0.5, 14 * k, 6 * k);
      img.draw(body.outline(c.P.outline));
      return img;
    },
  },
  {
    name: "rock", what: "a boulder", w: 1, h: 1, anchor: 0, solid: true, variants: 2,
    draw: (c, v) => {
      const k = c.k, t = c.t, r = c.P.mat.rock;
      const img = new Img(t, t), body = new Img(t, t);
      // a faceted stone: a lit top, a mid side and a dark foot, with one crack
      const top = v ? 5 : 4, left = v ? 2 : 3;
      for (let y = top * k; y < 14 * k; y++) {
        const f = (y - top * k) / ((14 - top) * k);
        const half = (v ? 5.5 : 5) * k * Math.min(1, 0.45 + f * 1.3) * (f > 0.85 ? 0.94 : 1);
        for (let x = Math.ceil(t / 2 - 0.5 - half - (v ? 0 : 0.5 * k)); x <= Math.floor(t / 2 - 0.5 + half + left * 0.2 * k); x++) {
          const u = (x - t / 2) / (6 * k);
          body.set(x, y, f < 0.3 - u * 0.25 ? r[4] : f < 0.55 - u * 0.5 ? r[3] : f > 0.82 || u > 0.55 ? r[1] : r[2]);
        }
      }
      body.line(t / 2 + 1 * k, (top + 3) * k, t / 2 + 2 * k, (top + 6) * k, r[0]);
      ground(img, t / 2 - 0.5, 14 * k, 6.5 * k);
      img.draw(body.outline(c.P.outline));
      return img;
    },
  },
  {
    name: "flowers", what: "a patch of flowers (walked over)", w: 1, h: 1, anchor: 0, solid: false, variants: 3,
    draw: (c, v) => {
      const k = c.k, t = c.t, g = c.P.mat.grass;
      const img = new Img(t, t);
      const petals = [c.P.mat.flower, c.P.mat.flower2, c.P.mat.flower3][v]!;
      const centre = v === 1 ? c.P.mat.flower[2] : c.P.mat.flower2[3];
      const rng = rngOf(c.seed + 60 + v);
      for (const [bx, by] of [[4, 5], [11, 4], [7, 10], [12, 12], [3, 12]]) {
        const x = Math.round((bx! + rng() * 1.5 - 0.7) * k), y = Math.round((by! + rng() * 1.5 - 0.7) * k);
        img.set(x, y + 2, g[0]);
        img.set(x, y + 1, g[0]);
        img.set(x - 1, y + 2, g[1]);
        for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) img.set(x + dx!, y + dy!, petals[dx! + dy! < 0 ? 4 : 2]);
        img.set(x, y, centre);
      }
      return img;
    },
  },
  {
    name: "tall_grass", what: "long grass (walked through)", w: 1, h: 1, anchor: 0, solid: false, variants: 1,
    draw: (c) => {
      const k = c.k, t = c.t, g = c.P.mat.grass;
      const img = new Img(t, t);
      // two rows of thick blades, each lit on its left and dark at the root
      for (let i = 0; i < 7; i++) {
        const x = Math.round((1 + i * 2.1) * k), base = Math.round((i % 2 ? 9 : 14) * k), tall = Math.round((5 + ((i * 7) % 3)) * k);
        for (let j = 0; j < tall; j++) {
          const lean = j > tall * 0.6 ? (i % 3 === 0 ? -1 : 1) : 0;
          img.set(x + lean, base - j, j < 2 ? g[0] : g[1]);
          img.set(x + lean - 1, base - j, j < 1 ? g[0] : j > tall - 2 ? g[4] : g[3]);
        }
      }
      return img;
    },
  },
  {
    name: "stump", what: "a tree stump", w: 1, h: 1, anchor: 0, solid: true, variants: 1,
    draw: (c) => {
      const k = c.k, t = c.t, tr = c.P.mat.trunk, w = c.P.mat.wood;
      const img = new Img(t, t), body = new Img(t, t);
      body.rect(4 * k, 7 * k, 8 * k, 6 * k, tr[2]);
      body.rect(4 * k, 7 * k, 2 * k, 6 * k, tr[3]);
      body.rect(10 * k, 7 * k, 2 * k, 6 * k, tr[1]);
      body.rect(3 * k, 12 * k, 10 * k, 1 * k, tr[1]);
      body.ellipse(t / 2 - 0.5, 6.5 * k, 4 * k, 2.2 * k, w[3]);
      body.ellipse(t / 2 - 0.5, 6.5 * k, 2 * k, 1 * k, w[2]);
      body.set(t / 2 - 1, 6.5 * k, w[1]);
      ground(img, t / 2 - 0.5, 13.5 * k, 6 * k);
      img.draw(body.outline(c.P.outline));
      return img;
    },
  },
  {
    name: "sign", what: "a wooden signpost", w: 1, h: 1, anchor: 0, solid: true, variants: 1,
    draw: (c) => {
      const k = c.k, t = c.t, w = c.P.mat.wood, tr = c.P.mat.trunk;
      const img = new Img(t, t), body = new Img(t, t);
      body.rect(7 * k, 8 * k, 2 * k, 6 * k, tr[2]);
      body.rect(8 * k, 8 * k, 1 * k, 6 * k, tr[1]);
      body.rect(3 * k, 3 * k, 10 * k, 6 * k, w[2]);
      body.rect(3 * k, 3 * k, 10 * k, 1 * k, w[4]);
      body.rect(3 * k, 8 * k, 10 * k, 1 * k, w[1]);
      body.rect(5 * k, 5 * k, 6 * k, 1, w[0]);
      body.rect(5 * k, 7 * k - 1, 4 * k, 1, w[0]);
      ground(img, t / 2 - 0.5, 14 * k, 4 * k);
      img.draw(body.outline(c.P.outline));
      return img;
    },
  },
  {
    name: "barrel", what: "a barrel", w: 1, h: 1, anchor: 0, solid: true, variants: 1,
    draw: (c) => {
      const k = c.k, t = c.t, w = c.P.mat.wood, m = c.P.mat.metal;
      const img = new Img(t, t), body = new Img(t, t);
      for (let y = 3 * k; y < 14 * k; y++) {
        const bulge = Math.round((1 - Math.abs((y - 8.5 * k) / (5.5 * k)) ** 2) * 1.2 * k);
        for (let x = 4 * k - bulge; x < 12 * k + bulge; x++) {
          const u = (x - 4 * k + bulge) / (8 * k + 2 * bulge);
          const hoop = y === Math.round(5 * k) || y === Math.round(11 * k);
          body.set(x, y, hoop ? m[u < 0.3 ? 3 : 1] : u < 0.2 ? w[4] : u < 0.45 ? w[3] : u > 0.8 ? w[0] : (x & 1) && u > 0.6 ? w[1] : w[2]);
        }
      }
      body.ellipse(t / 2 - 0.5, 3.5 * k, 3.5 * k, 1.2 * k, w[1]);
      ground(img, t / 2 - 0.5, 14 * k, 5.5 * k);
      img.draw(body.outline(c.P.outline));
      return img;
    },
  },
  {
    name: "crate", what: "a wooden crate", w: 1, h: 1, anchor: 0, solid: true, variants: 1,
    draw: (c) => {
      const k = c.k, t = c.t, w = c.P.mat.wood;
      const img = new Img(t, t), body = new Img(t, t);
      body.rect(3 * k, 3 * k, 10 * k, 11 * k, w[2]);
      body.rect(3 * k, 3 * k, 10 * k, 3 * k, w[3]); // the lid, seen a little from above
      body.rect(3 * k, 3 * k, 10 * k, 1, w[4]);
      body.rect(3 * k, 6 * k, 10 * k, 1, w[0]);
      body.rect(3 * k, 7 * k, 2 * k, 7 * k, w[3]);
      body.rect(11 * k, 7 * k, 2 * k, 7 * k, w[1]);
      body.line(5 * k, 7 * k + 1, 11 * k - 1, 14 * k - 2, w[1]);
      body.line(5 * k, 7 * k, 11 * k - 1, 14 * k - 3, w[3]);
      body.rect(3 * k, 13 * k, 10 * k, 1 * k, w[1]);
      ground(img, t / 2 - 0.5, 14.2 * k, 6 * k);
      img.draw(body.outline(c.P.outline));
      return img;
    },
  },
  {
    name: "door", what: "a wooden door that fills its tile: put it in a wall (it is not solid)", w: 1, h: 1, anchor: 0, solid: false, variants: 1,
    draw: (c) => {
      const k = c.k, t = c.t, w = c.P.mat.wood, st = c.P.mat.stone, g = c.P.mat.gold;
      const img = new Img(t, t);
      img.rect(0, 0, t, t, st[1]);
      img.rect(0, 0, t, 1, c.P.outline);
      img.rect(0, 0, 1, t, c.P.outline);
      img.rect(t - 1, 0, 1, t, c.P.outline);
      img.rect(1, 1, t - 2, 1, st[4]);
      img.rect(1, 1, 1, t - 1, st[3]);
      img.rect(t - 2, 2, 1, t - 2, st[0]);
      img.rect(2 * k, 2 * k, t - 4 * k, t - 2 * k, c.P.outline);
      for (let x = 2 * k + 1; x < t - 2 * k - 1; x++) for (let y = 2 * k + 1; y < t; y++) {
        const plank = Math.floor((x - 2 * k - 1) / (3.4 * k));
        const edge = Math.floor((x - 2 * k) / (3.4 * k)) !== plank;
        img.set(x, y, edge ? w[0] : y === 2 * k + 1 ? w[4] : plank === 0 ? w[3] : plank >= 2 ? w[1] : w[2]);
      }
      img.rect(2 * k + 1, 6 * k, t - 4 * k - 2, 1, w[0]);
      img.rect(2 * k + 1, 12 * k, t - 4 * k - 2, 1, w[0]);
      img.rect(10 * k, 9 * k, k, k, g[3]);
      img.set(10 * k, 9 * k + k, g[0]);
      return img;
    },
  },
  {
    name: "window", what: "a window, to lay on a wall", w: 1, h: 1, anchor: 0, solid: false, variants: 1,
    draw: (c) => {
      const k = c.k, t = c.t, w = c.P.mat.wood, wa = c.P.mat.water;
      const img = new Img(t, t), body = new Img(t, t);
      body.rect(3 * k, 3 * k, 10 * k, 9 * k, w[1]);
      body.rect(3 * k, 3 * k, 10 * k, 1, w[3]);
      body.rect(2 * k, 11 * k, 12 * k, 2 * k, w[2]);
      body.rect(2 * k, 11 * k, 12 * k, 1, w[4]);
      for (const x of [4 * k, 8.5 * k]) for (const y of [4 * k, 7.5 * k + 1]) {
        const gw = Math.round(3.5 * k), gh = Math.round(3 * k);
        body.rect(x, y, gw, gh, mix(wa[3], [255, 255, 255, 255], 0.25));
        body.rect(x, y, gw, 1, wa[1]);
        body.line(x, y + gh - 1, x + gh - 1, y, [255, 255, 255, 255]);
      }
      img.draw(body.outline(c.P.outline));
      return img;
    },
  },
];

/// The fence joins along its length: sixteen tiles, by which of its four sides have more fence.
function fenceTile(c: Ctx, mask: number): Img {
  const k = c.k, t = c.t, w = c.P.mat.wood;
  const img = new Img(t, t), body = new Img(t, t);
  const rails = [5 * k, 10 * k];
  if (mask & 2) for (const y of rails) {
    body.rect(t / 2, y, t / 2, 2 * k, w[2]);
    body.rect(t / 2, y, t / 2, 1, w[4]);
  }
  if (mask & 8) for (const y of rails) {
    body.rect(0, y, t / 2, 2 * k, w[2]);
    body.rect(0, y, t / 2, 1, w[4]);
  }
  // a run up and down the map is seen end on: one rail between the posts
  for (const [bit, y0, y1] of [[1, 0, 4 * k], [4, 13 * k, t]] as const) {
    if (!(mask & bit)) continue;
    body.rect(t / 2 - k, y0, 2 * k, y1 - y0, w[2]);
    body.rect(t / 2 - k, y0, 1, y1 - y0, w[4]);
  }
  body.rect(t / 2 - 2 * k, 3 * k, 4 * k, 11 * k, w[2]);
  body.rect(t / 2 - 2 * k, 3 * k, 1 * k, 11 * k, w[3]);
  body.rect(t / 2 + 1 * k, 3 * k, 1 * k, 11 * k, w[1]);
  body.rect(t / 2 - 2 * k, 3 * k, 4 * k, 1 * k, w[4]);
  ground(img, t / 2, 14 * k, 3.5 * k);
  img.draw(body.outline(c.P.outline));
  // (where the fence runs on into the next tile there is no outline across it)
  return img;
}

const sideName = (mask: number): string => {
  const open = [[N, "n"], [E, "e"], [S, "s"], [W, "w"]].filter(([b]) => !(mask & (b as number))).map(([, l]) => l).join("");
  const bites = ([[N, E, NE, "ne"], [S, E, SE, "se"], [S, W, SW, "sw"], [N, W, NW, "nw"]] as const).filter(([a, b, cn]) => mask & a && mask & b && !(mask & cn)).map(([, , , l]) => l);
  return `${open ? `_edge_${open}` : ""}${bites.length ? `_in_${bites.join("_")}` : ""}`;
};

/// Terrains whose tiles mirror what stands above them (a tileset's `reflect` list). Only the city's puddles: the classic tilesets stay byte for byte as
/// they were (a water layer can still be made reflective with `"reflect": true` in its scene).
const REFLECTIVE = ["puddle"];
const EDGES: EdgeKind[] = [{ name: "fence", what: "a wooden fence that joins along its length; it stands on the ground beside it", solid: true, tile: fenceTile }, ...CITY_EDGES];
const ALL_TERRAINS = [...TERRAINS, ...CITY_TERRAINS];
const ALL_PROPS = [...PROPS, ...CITY_PROPS];

/// What a tileset has when it names none: the countryside's terrains and props, or for a city palette the city's.
export const CLASSIC_TERRAIN_NAMES = [...TERRAINS.map((t) => t.name), "fence"];
export const CLASSIC_PROP_NAMES = PROPS.map((p) => p.name);
export { CITY_PROP_NAMES, CITY_TERRAIN_NAMES };
export const TERRAIN_NAMES = [...ALL_TERRAINS.map((t) => t.name), ...EDGES.map((e) => e.name)];
export const PROP_NAMES = ALL_PROPS.map((p) => p.name);
export const TILE_SIZES = [16, 24, 32];

const pick = (given: unknown, all: string[], what: string, fallback: string[]): string[] => {
  if (given === undefined || given === null) return all.filter((n) => fallback.includes(n));
  if (!Array.isArray(given)) throw new Error(`"${what}" is a list of names from: ${all.join(", ")}`);
  const wanted = given.map((n) => String(n).trim().toLowerCase().replace(/[ -]/g, "_"));
  const bad = wanted.filter((n) => !all.includes(n));
  if (bad.length) throw new Error(`"${what}" names ${bad.map((b) => `'${b}'`).join(", ")}, which the maker does not have. It has: ${all.join(", ")}`);
  // (the order terrains lie over each other in is the maker's, not the list's)
  return all.filter((n) => wanted.includes(n));
};

/// `tileset_make`: see the tool's description in server.ts.
export function makeTileset(name: string, a: Args, put: Put): { text: string; picture: import("./paint").Raster } {
  const hd = styleOf(a) === "detailed";
  if (hd && a.tile !== undefined && Number(a.tile) !== 32) throw new Error(`"tile": the detailed style is drawn at 32 pixels a tile (leave "tile" out, and draw the layer with "scale": 1.5)`);
  const t = hd ? 32 : a.tile === undefined ? 16 : Number(a.tile);
  if (!TILE_SIZES.includes(t)) throw new Error(`"tile" is the tile size in pixels: ${TILE_SIZES.join(", ")} (16 is the one the art is tuned for; the others are the same drawings made larger)`);
  const P = paletteOf(a.palette);
  const c: Ctx = { t, k: t / 16, P, seed: Math.floor(Number(a.seed ?? 1)) || 0 };
  const terrains = pick(a.terrains, TERRAIN_NAMES, "terrains", P.city || hd ? CITY_TERRAIN_NAMES : CLASSIC_TERRAIN_NAMES);
  const props = pick(a.props, PROP_NAMES, "props", P.city || hd ? CITY_PROP_NAMES : CLASSIC_PROP_NAMES);
  if (hd) {
    const missing = [...terrains.filter((n) => !CITY_TERRAIN_NAMES.includes(n)), ...props.filter((n) => !HD_PROPS[n])];
    if (missing.length) throw new Error(`the detailed style is drawn for the city: ${missing.map((m) => `'${m}'`).join(", ")} ${missing.length > 1 ? "have" : "has"} no detailed drawing. Its terrains: ${CITY_TERRAIN_NAMES.join(", ")}; its props: ${CITY_PROP_NAMES.join(", ")}`);
  }

  const frames: Img[] = [];
  const names: Record<number, string> = {};
  const solid: number[] = [];
  const docTerrains: Terrain[] = [];
  const reflect: number[] = [];
  const add = (img: Img, tileName: string, isSolid: boolean): number => {
    frames.push(img);
    names[frames.length - 1] = tileName;
    if (isSolid) solid.push(frames.length - 1);
    return frames.length - 1;
  };

  for (const plain of ALL_TERRAINS.filter((k) => terrains.includes(k.name))) {
    const H = hd ? HD_TERRAINS[plain.name]! : null;
    const kind: typeof plain = H ? { ...plain, variants: H.variants ?? plain.variants, texture: H.texture, edge: H.edge, shape: { inset: plain.shape.inset * 2, round: plain.shape.round * 2, wobble: plain.shape.wobble * 2 } } : plain;
    // (a pool drawn with several outlines: each its own smooth wobble per side and corner radius; see city-hd.ts)
    const outline = (k: number) => {
      const o = H?.outlines;
      if (!o) return { shape: kind.shape, wob: [0, 1, 2, 3].map((side) => wobbleOf(t, kind.shape.wobble, seedOf(`${kind.name}/${side}`) + c.seed)) };
      return { shape: { inset: o.inset, round: o.rounds[k]!, wobble: o.wobble }, wob: [0, 1, 2, 3].map((side) => poolWobble(t, seedOf(`${kind.name}/${k}/${side}`) + c.seed, o.wobble)) };
    };
    const textures = Array.from({ length: kind.variants }, (_, v) => kind.texture(c, v));
    const joining = (k: number, mask: number) => {
      const { shape, wob } = outline(k);
      const img = new Img(t, t);
      for (let y = 0; y < t; y++) for (let x = 0; x < t; x++) {
        const tex = textures[0]!.get(x, y)!;
        img.set(x, y, mask === 255 ? tex : kind.edge(c, probe(mask, x, y, t, shape, wob), mask, x, y, tex));
      }
      return img;
    };
    const tiles: number[] = [];
    for (const mask of BLOB_MASKS) tiles.push(add(joining(0, mask), `${kind.name}${sideName(mask)}`, kind.solid));
    for (let v = 1; v < kind.variants; v++) add(textures[v]!, `${kind.name}_${v + 1}`, kind.solid);
    if (H) {
      // worn variants: a plain tile with one mark of use on it, for the painter to place where the street is worn
      (WORN[kind.name] ?? []).forEach((w, i) => {
        const img = textures[i % kind.variants]!.part(0, 0, t, t);
        w.draw(c, img, rngOf(seedOf(`worn/${kind.name}/${w.what}`) + c.seed));
        add(img, `${kind.name}_worn_${w.what}`, kind.solid);
      });
      for (let k = 1; k < (H.outlines?.rounds.length ?? 0); k++) for (const mask of BLOB_MASKS) if (mask !== 255) add(joining(k, mask), `${kind.name}_shape${k + 1}${sideName(mask)}`, kind.solid);
    }
    docTerrains.push({ name: kind.name, mode: "blob", tiles });
    // still water shows what stands above it (nova.reflections): every tile of a puddle or water terrain, edges and variants too
    if (REFLECTIVE.includes(kind.name)) for (let n = tiles[0]!; n < frames.length; n++) reflect.push(n);
  }
  for (const kind of EDGES.filter((k) => terrains.includes(k.name))) {
    const tiles: number[] = [];
    const draw = hd ? (kind.name === "tram_rail" ? railHd : (cc: Ctx, m: number) => stripHd(cc, m, cc.P.accent[kind.name === "neon_strip" ? 0 : 1])) : kind.tile;
    for (let mask = 0; mask < 16; mask++) tiles.push(add(draw(c, mask), mask === 15 ? kind.name : `${kind.name}_${["n", "e", "s", "w"].filter((_, i) => mask & (1 << i)).join("") || "post"}`, kind.solid));
    docTerrains.push({ name: kind.name, mode: "edges", tiles });
  }
  for (const kind of ALL_PROPS.filter((p) => props.includes(p.name))) {
    for (let v = 0; v < (hd ? 1 : kind.variants); v++) {
      const img = hd ? HD_PROPS[kind.name]!(c) : kind.draw(c, v);
      const base = v ? `${kind.name}_${v + 1}` : kind.name;
      // the anchor's tile first (it carries the name a map uses), then the others by where they are from it
      const cells: [number, number][] = [[kind.anchor, kind.h - 1]];
      for (let r = 0; r < kind.h; r++) for (let col = 0; col < kind.w; col++) if (!(col === kind.anchor && r === kind.h - 1)) cells.push([col, r]);
      for (const [col, r] of cells) {
        const tile = img.part(col * t, r * t, t, t);
        if (tile.empty()) continue;
        const dx = col - kind.anchor, dy = r - (kind.h - 1);
        add(tile, dx || dy ? `${base}@${dx},${dy}` : base, kind.solid && dy === 0 && (dx === 0 || !!kind.solidRow));
      }
    }
  }
  // the detailed city's wear: see-through tiles the painter lays over the ground (none of them solid in the tileset)
  if (hd) for (const w of wearTiles(c)) add(w.img, w.name, false);

  const made = writeSheet(name, { frames, names, solid, reflect, terrains: docTerrains }, put);
  const said = [
    `sprites/${name}.png: a tileset of ${frames.length} tiles of ${t}x${t}, ${describePalette(P)}, seed ${c.seed}`,
    `terrains (later ones lie over earlier ones; each has the joining tiles for every edge and corner, and scene_write's "paint" picks them):`,
    ...ALL_TERRAINS.filter((k) => terrains.includes(k.name)).map((k) => `  ${k.name}${k.solid ? " (solid)" : ""}: ${k.what}${k.variants > 1 ? `; ${k.variants} variants scattered` : ""}`),
    ...EDGES.filter((k) => terrains.includes(k.name)).map((k) => `  ${k.name}${k.solid ? " (solid)" : ""}: ${k.what}`),
    `props (one character in a painted map places the whole thing):`,
    ...ALL_PROPS.filter((p) => props.includes(p.name)).map((p) => `  ${p.name}${p.solid ? " (solid)" : ""}: ${p.what}${p.variants > 1 ? `; ${p.variants} variants` : ""}`),
    `Paint a map: scene_write { "name": "meadow", "scene": { "version": 1, "tilemaps": [ { "tileset": "${name}", "scale": ${hd ? 1.5 : 3}, "paint": { "g": "grass", "p": "path", "w": "water", "T": "tree", "f": "flowers" }, "tiles": ["gggTgg", "gppppg", "gpwwfg", "gggggg"] } ] } }`,
    `Every tile has a name (the whole tile of a terrain is its name, e.g. "grass"; variants "grass_2"; an edge "path_edge_n"); redraw one with sprite_preview { "frame": "<name>" } and sprite_write { "at": n }, or add your own with "append": true.`,
  ];
  const room = tileRoom(frames.length, name);
  if (room.warning) said.splice(1, 0, room.warning);
  return { text: said.join("\n"), picture: made.picture };
}
