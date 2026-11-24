// map_make: an illustrated, hand-drawn-looking paper map of a 3D game's town, made from its scene file (roads' middle lines,
// water, buildings, trees, landmarks) and its terrain (nova.terrain's heightmap), for the game to show as a picture (a "paper
// map" button). North (+z) is up and east to the right: on Nova's ground +x is to the LEFT of someone facing +z, so east is -x.
//
// What it draws, in order: warm parchment (mottled, faint fibres and two folds, darker towards its edges); the land, gently shaded
// from the heights (two or three soft tonal bands, a light from the north-west, faint contours); water below a level (a lake) and
// water along lines (a creek: a blue wavy ribbon with a darker bank); trees as little drawn symbols where the scene has trees,
// meadow left open; roads as cased ribbons (a dark edge, a light fill) whose width is their class's, joined where they meet; a
// bridge where a road crosses water; small pictorial icons for the buildings and landmarks the recipe names; the roads' names
// lettered along their curves (never upside down, repeated along long roads, kept clear of each other, of the icons and of the
// other roads); a compass rose, a scale bar in metres, a title cartouche, a drawn border with corner ornaments.
//
// It prints ONLY the words the recipe gives (road labels from the scene's road lines, water names, the labels of `places` and
// `marks`, area names, the title): never a house number, a resident's name, a mark for the player or a destination, whatever the
// scene holds. Deterministic: the same inputs and `seed` (the hand's wobble) give the same bytes.
//
// Built for a small slice now and a bigger world later: label density follows the map's scale (a long road gets its name again
// every `repeat` pixels), symbols are thinned to a grid in pixels (a forest of a thousand trees stays readable), and the picture can
// be made larger (`size`) for a bigger world, ready for a pan-and-zoom view.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import type { Raster } from "../../src/lib/pixels";
import { decodePng } from "../draw";
import { encode, parseColor, signedField } from "../image";

type Args = Record<string, any>;
type RGB = [number, number, number];
type P = [number, number];

// ---- the palette ------------------------------------------------------------------------------------------------------------------
/// The colours, every one replaceable by `palette` (a game passes its own, so the map sits with its UI).
export const MAP_COLOURS = {
  paper: "#f2e4c4", paper_edge: "#c9ab7c", fibre: "#b89a6c", ink: "#4a3a2c", faint: "#8a7255",
  meadow: "#d7dcaa", hill: "#c3c993", high: "#adb17f", contour: "#9a8a5e",
  forest: "#7f9d5a", forest_dark: "#55744a", forest_light: "#a9c27a", trunk: "#7a5a3c",
  water: "#a7cad3", water_dark: "#5e8fa0", water_light: "#d3e6e8",
  road: "#fbf5e4", road_edge: "#5d4836", lane: "#f0e1bd", lane_edge: "#6e5640",
  red: "#c94a3b", roof: "#b5503f", slate: "#677c6c", wall: "#efdcb6", wood: "#b97c4f", wood_dark: "#86583c", stone: "#aca394",
  label: "#3e3631", water_label: "#3c6d7f", halo: "#f4e8cc", blue: "#4f78ad", mustard: "#e2b04a",
};
type Colours = Record<keyof typeof MAP_COLOURS, RGB>;

/// The icons a place or a mark may have.
export const MAP_ICONS = ["post_office", "house", "shed", "bridge", "broken_bridge", "barrier", "picnic", "mast", "wall", "viewpoint", "bench"] as const;

const rgb = (c: unknown, where: string): RGB => {
  const v = parseColor(c, where);
  return [v[0], v[1], v[2]];
};

// ---- small helpers ----------------------------------------------------------------------------------------------------------------
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
function rng(seed: number) {
  let s = (seed >>> 0) || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
/// Smooth value noise in [0, 1] (seeded; the same everywhere for the same seed).
function noise(seed: number) {
  const hash = (x: number, y: number) => {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), tx = x - xi, ty = y - yi;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

// ---- the picture ------------------------------------------------------------------------------------------------------------------
class Canvas {
  px: Float32Array;
  constructor(public w: number, public h: number, bg: RGB) {
    this.px = new Float32Array(w * h * 3);
    for (let i = 0; i < w * h; i++) this.px.set(bg, i * 3);
  }
  /// Paints colour c over pixel i with coverage a (0..1).
  over(i: number, c: RGB, a: number) {
    if (a <= 0) return;
    if (a > 1) a = 1;
    const o = i * 3;
    this.px[o] = this.px[o]! + (c[0] - this.px[o]!) * a;
    this.px[o + 1] = this.px[o + 1]! + (c[1] - this.px[o + 1]!) * a;
    this.px[o + 2] = this.px[o + 2]! + (c[2] - this.px[o + 2]!) * a;
  }
  /// Multiplies pixel i towards colour c by a.
  mul(i: number, c: RGB, a: number) {
    const o = i * 3;
    for (let k = 0; k < 3; k++) this.px[o + k] = this.px[o + k]! * (1 - a + (a * c[k]!) / 255);
  }
  /// Paints a signed distance (px; negative inside) within a box: coverage clamp(0.5 - d).
  shape(d: (x: number, y: number) => number, box: [number, number, number, number], c: RGB, alpha = 1) {
    const x0 = Math.max(0, Math.floor(box[0])), y0 = Math.max(0, Math.floor(box[1]));
    const x1 = Math.min(this.w, Math.ceil(box[2])), y1 = Math.min(this.h, Math.ceil(box[3]));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const cov = 0.5 - d(x + 0.5, y + 0.5);
      if (cov > 0) this.over(y * this.w + x, c, Math.min(1, cov) * alpha);
    }
  }
  raster(): Raster {
    const data = new Uint8ClampedArray(this.w * this.h * 4);
    for (let i = 0; i < this.w * this.h; i++) {
      data[i * 4] = Math.round(this.px[i * 3]!);
      data[i * 4 + 1] = Math.round(this.px[i * 3 + 1]!);
      data[i * 4 + 2] = Math.round(this.px[i * 3 + 2]!);
      data[i * 4 + 3] = 255;
    }
    return { w: this.w, h: this.h, data };
  }
}

// distances (px) to simple shapes
const dSeg = (x: number, y: number, ax: number, ay: number, bx: number, by: number) => {
  const ex = bx - ax, ey = by - ay, t = clamp(((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey || 1), 0, 1);
  return Math.hypot(x - ax - ex * t, y - ay - ey * t);
};
const dBox = (x: number, y: number, cx: number, cy: number, hw: number, hh: number, r = 0) => {
  const qx = Math.abs(x - cx) - hw + r, qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const dPoly = (x: number, y: number, pts: P[]) => {
  let d = Infinity, inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[j]!, [bx, by] = pts[i]!;
    d = Math.min(d, dSeg(x, y, ax, ay, bx, by));
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside ? -d : d;
};
const boxOf = (pts: P[], m: number): [number, number, number, number] => {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, y] of pts) (a = Math.min(a, x), b = Math.min(b, y), c = Math.max(c, x), d = Math.max(d, y));
  return [a - m, b - m, c + m, d + m];
};

/// A distance field over the whole picture (px), kept as the minimum of everything added: a union of ribbons, so roads join.
class Field {
  d: Float32Array;
  tag: Int16Array;
  constructor(public w: number, public h: number) {
    this.d = new Float32Array(w * h).fill(1e6);
    this.tag = new Int16Array(w * h).fill(-1);
  }
  /// A thick line (its edge at `r` px from the points), tagged.
  line(pts: P[], r: number, tag = 0) {
    for (let k = 1; k < pts.length; k++) {
      const [ax, ay] = pts[k - 1]!, [bx, by] = pts[k]!;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r - 40)), x1 = Math.min(this.w, Math.ceil(Math.max(ax, bx) + r + 40));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r - 40)), y1 = Math.min(this.h, Math.ceil(Math.max(ay, by) + r + 40));
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const v = dSeg(x + 0.5, y + 0.5, ax, ay, bx, by) - r, i = y * this.w + x;
        if (v < this.d[i]!) (this.d[i] = v, (this.tag[i] = tag));
      }
    }
  }
  at(x: number, y: number) {
    const xi = Math.floor(x), yi = Math.floor(y);
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return 1e6;
    return this.d[yi * this.w + xi]!;
  }
}

/// A line given a hand's wobble: each point moved along the line's normal by smooth noise of the distance along it.
function wobble(pts: P[], amp: number, wave: number, seed: number): P[] {
  if (amp <= 0 || pts.length < 2) return pts;
  const n = noise(seed);
  let s = 0;
  return pts.map((p, i) => {
    if (i) s += Math.hypot(p[0] - pts[i - 1]![0], p[1] - pts[i - 1]![1]);
    const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(pts.length - 1, i + 1)]!;
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    const k = (n(s / wave, 0.5) - 0.5) * 2 * amp;
    return [p[0] - (dy / l) * k, p[1] + (dx / l) * k];
  });
}
/// Points every `step` px along a line (for even dashes, labels and wobble).
function resample(pts: P[], step: number): P[] {
  const out: P[] = [pts[0]!];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]!, [bx, by] = pts[i]!;
    const len = Math.hypot(bx - ax, by - ay);
    let t = step - carry;
    while (t <= len) {
      out.push([ax + ((bx - ax) * t) / len, ay + ((by - ay) * t) / len]);
      t += step;
    }
    carry = len - (t - step);
  }
  const last = pts[pts.length - 1]!;
  if (Math.hypot(last[0] - out[out.length - 1]![0], last[1] - out[out.length - 1]![1]) > step * 0.3) out.push(last);
  return out;
}
const lengthOf = (pts: P[]) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1]![0], p[1] - pts[i - 1]![1]) : 0), 0);

// ---- the terrain's heights ------------------------------------------------------------------------------------------------------
interface Heights { w: number; h: number; v: Float32Array; x0: number; z0: number; cell: number; height: number }

/// A heightmap PNG read as nova.terrain reads it (crates/nova-runtime/src/heightmap.rs): 16-bit grey v / 65535; 8-bit RGB(A)
/// (R * 256 + G) / 65535; 16-bit RGB(A) its red; 8-bit grey v / 255; times `height` metres.
function readHeights(bytes: Uint8Array, x0: number, z0: number, size: number, height: number): Heights {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let w = 0, h = 0, depth = 8, type = 0;
  const idat: Uint8Array[] = [];
  for (let i = 8; i + 8 <= bytes.length; ) {
    const n = view.getUint32(i), id = String.fromCharCode(bytes[i + 4]!, bytes[i + 5]!, bytes[i + 6]!, bytes[i + 7]!);
    if (id === "IHDR") (w = view.getUint32(i + 8), (h = view.getUint32(i + 12)), (depth = bytes[i + 16]!), (type = bytes[i + 17]!));
    else if (id === "IDAT") idat.push(bytes.subarray(i + 8, i + 8 + n));
    i += 12 + n;
  }
  if (type === 3 || (depth !== 8 && depth !== 16)) throw new Error("terrain: the heightmap is a grey or RGB(A) PNG of 8 or 16 bits a channel");
  const ch = type === 0 ? 1 : type === 2 ? 3 : type === 4 ? 2 : 4, bpp = ch * (depth / 8), stride = w * bpp;
  const raw = inflateSync(Buffer.concat(idat)), out = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp]! : 0, b = y ? out[(y - 1) * stride + x]! : 0, c = x >= bpp && y ? out[(y - 1) * stride + x - bpp]! : 0;
      let v = raw[y * (stride + 1) + 1 + x]!;
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = v & 255;
    }
  }
  const v = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * bpp;
    let t: number;
    if (depth === 16) t = (out[o]! * 256 + out[o + 1]!) / 65535;
    else if (ch >= 3) t = (out[o]! * 256 + out[o + 1]!) / 65535;
    else t = out[o]! / 255;
    v[i] = t * height;
  }
  return { w, h, v, x0, z0, cell: size / (w - 1), height };
}
function heightAt(m: Heights, x: number, z: number) {
  const fx = clamp((x - m.x0) / m.cell, 0, m.w - 1.0001), fz = clamp((z - m.z0) / m.cell, 0, m.h - 1.0001);
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  const a = m.v[j * m.w + i]!, b = m.v[j * m.w + i + 1]!, c = m.v[(j + 1) * m.w + i]!, d = m.v[(j + 1) * m.w + i + 1]!;
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}
/// The project's nova.terrain{ heightmap = ..., x, z, size, height } line, found in its Lua files (the first one).
function findTerrain(root: string): Args | null {
  const walk = (dir: string, depth: number): Args | null => {
    if (depth > 3 || !existsSync(dir)) return null;
    for (const f of readdirSync(dir).sort()) {
      if (f.startsWith(".") || ["build", "tools", "node_modules"].includes(f)) continue;
      const p = join(dir, f);
      if (statSync(p).isDirectory()) {
        const r = walk(p, depth + 1);
        if (r) return r;
      } else if (f.endsWith(".lua")) {
        const m = /nova\.terrain\s*\{([^}]*heightmap[^}]*)\}/.exec(readFileSync(p, "utf8"));
        if (m) {
          const o: Args = {};
          for (const [, k, v] of m[1]!.matchAll(/(\w+)\s*=\s*("[^"]*"|-?[\d.]+)/g)) o[k!] = v!.startsWith('"') ? v!.slice(1, -1) : Number(v);
          return o;
        }
      }
    }
    return null;
  };
  return walk(root, 0);
}

// ---- text, through the runtime's fonts ---------------------------------------------------------------------------------------------
interface Words { text: string; w: number; h: number; ascent: number; cap: number; field: Float64Array; k: number; pw: number; ph: number; pad: number; size: number }
const K = 2; // the words are drawn at twice the size and read back as a distance, so letters stay crisp along a curve
function wordsOf(ctx: { bin: string | null; root: string; tmp: () => string; font: string }, text: string, size: number, cache: Map<string, Words>): Words {
  const key = `${size}|${text}`;
  const had = cache.get(key);
  if (had) return had;
  if (!ctx.bin || !existsSync(ctx.bin)) throw new Error("map_make draws its words with the runtime's fonts (`nova glyphs`): build it with scripts/env.sh cargo build --release -p nova-runtime");
  const file = join(ctx.tmp(), `w${cache.size}.png`);
  const r = spawnSync(ctx.bin, ["glyphs", ctx.font, String(size * K), file, "--text", text, "--project", ctx.root], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`map_make: ${(r.stderr || r.stdout).trim()}`);
  const m = JSON.parse(r.stdout.trim().split("\n").pop()!);
  const pic = decodePng(readFileSync(file));
  const pad = Math.ceil(10 * K);
  const pw = pic.w + pad * 2, ph = pic.h + pad * 2;
  const cov = new Float64Array(pw * ph);
  for (let y = 0; y < pic.h; y++) for (let x = 0; x < pic.w; x++) cov[(y + pad) * pw + x + pad] = pic.data[(y * pic.w + x) * 4 + 3]! / 255;
  // (the cap height: the rows of a capital "H" are not to hand, so the font's usual 0.7 of the size)
  const out: Words = { text, w: pic.w / K, h: pic.h / K, ascent: m.ascent / K, cap: size * 0.7, field: signedField(cov, pw, ph), k: K, pw, ph, pad, size };
  cache.set(key, out);
  return out;
}
/// The distance (output px) from the words at a point of the words' own frame (px from the left of the words, from their top).
function wordsDist(g: Words, u: number, v: number) {
  const fx = (u * g.k) + g.pad - 0.5, fy = (v * g.k) + g.pad - 0.5;
  const cx = clamp(fx, 0, g.pw - 1.001), cy = clamp(fy, 0, g.ph - 1.001);
  const ix = Math.floor(cx), iy = Math.floor(cy), tx = cx - ix, ty = cy - iy, f = g.field, W = g.pw;
  const val = f[iy * W + ix]! * (1 - tx) * (1 - ty) + f[iy * W + ix + 1]! * tx * (1 - ty) + f[(iy + 1) * W + ix]! * (1 - tx) * ty + f[(iy + 1) * W + ix + 1]! * tx * ty;
  return (val + Math.hypot(fx - cx, fy - cy)) / g.k;
}

/// A placed piece of writing: what it says, what it names, and the circles it covers (for the overlap rule and the tests).
export interface MapLabel { text: string; kind: "road" | "water" | "place" | "area" | "title" | "scale" | "compass"; circles: [number, number, number][]; of?: string; px?: number }

// ---- the recipe -------------------------------------------------------------------------------------------------------------------
const TOP_KEYS = ["name", "project", "scene", "terrain", "bounds", "size", "sizes", "title", "subtitle", "seed", "palette", "font", "roads", "water", "trees", "forest", "places", "marks", "areas", "water_below", "water_areas", "ponds", "compass", "scale_bar", "repeat", "label_size", "text_min", "wobble"];

export const MAP_HELP =
  "Inputs: `scene` (scenes/<scene>.scene.json); `terrain` ({ heightmap, x, z, size, height } as nova.terrain takes them, found in the project's Lua when left out, false for none); `bounds` [x0, z0, x1, z1] in metres (the scene's roads and water and 40 m round them when left out); `size` [w, h] or a height (the width follows the bounds); `sizes` more copies, each the area-average of the first ([[w, h]] or scales [0.67]); " +
  "`roads`: { kind: \"roadline\" (objects whose props have points [[x, z], ...], width, label and surface), classes: { road: { width: 12 }, gravel: { width: 8.5, lane: true } } (px of fill; a class with lane: true is drawn in the lane colours) }; " +
  "`water`: { kind: \"water\" (props points, width, key), names: { creek: \"Kettle Creek\" } (a key's name, lettered along it) }; `water_below`: metres (the terrain below it is water: a lake); `water_areas`: [[x0, z0, x1, z1], ...] (open water beyond the terrain: a lake, the sea); `ponds`: { kind: \"pond\" } (objects whose props have `shore`, [[x, z], ...] round still water: a pond or a lake, its shore wobbled a little); " +
  "`trees`: { pine: [kinds], round: [kinds] } (each object of those kinds is a little drawn tree, thinned to a grid); `forest`: { kinds: [...], radius: 12 } (a mass of trees round each); " +
  `\`places\`: { <kind>: { icon, label? } } (every object of that kind gets the icon, and the label if one is given; icons: ${MAP_ICONS.join(", ")}; a bridge uses the object's props a and b, a wall each object's place and turn); ` +
  "`marks`: [{ at: [x, z], icon, label? }] (landmarks not in the scene); `areas`: [{ at: [x, z], text }] (a region's name, lettered faintly); " +
  "`title`, `subtitle` (the cartouche); `compass`, `scale_bar` (true; false leaves them out); `repeat` (px between a long road's names; 380); `label_size` (px; 2.4% of the height); `text_min` (px: no word is drawn smaller, the subtitle and the scale's numbers grow to it and a place's name that finds no room is left out rather than shrunk below it; none by default); `wobble` (px of the hand's wobble; 0.7); `font` (\"rounded\"); `palette` { " + Object.keys(MAP_COLOURS).join(", ") + " } (\"#rrggbb\" each); `seed`.";

interface Placed { x: number; y: number; r: number }

/// What map_make does: draws the map and returns the files (path in the project, PNG bytes), the picture, its words and a summary.
export function makeTownMap(root: string, a: Args, bin: string | null): { files: [string, Uint8Array][]; picture: Raster; text: string; labels: MapLabel[] } {
  const unknown = Object.keys(a).filter((k) => !TOP_KEYS.includes(k));
  if (unknown.length) throw new Error(`${unknown.map((k) => `\`${k}\``).join(", ")} ${unknown.length > 1 ? "are not options" : "is not an option"} of map_make (it takes ${TOP_KEYS.join(", ")}). Nothing was written`);
  const name = String(a.name ?? "ui/map").trim().replace(/^sprites\//, "").replace(/\.png$/i, "");
  if (!/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/.test(name)) throw new Error(`"name" is the picture's name under sprites/ ("ui/map"; got '${name}')`);
  if (typeof a.scene !== "string") throw new Error('"scene" is the scene to map (scenes/<scene>.scene.json)');
  const sceneFile = join(root, "scenes", `${a.scene.replace(/\./g, "/")}.scene.json`);
  if (!existsSync(sceneFile)) throw new Error(`there is no scenes/${a.scene}.scene.json`);
  const scene = JSON.parse(readFileSync(sceneFile, "utf8"));
  const objects: Args[] = Array.isArray(scene.objects) ? scene.objects : [];
  const seed = Math.round(Number(a.seed ?? 1));
  const C = Object.fromEntries(Object.entries({ ...MAP_COLOURS, ...(a.palette ?? {}) }).map(([k, v]) => [k, rgb(v, `palette ${k}`)])) as Colours;
  const badPal = Object.keys(a.palette ?? {}).filter((k) => !(k in MAP_COLOURS));
  if (badPal.length) throw new Error(`palette has ${badPal.join(", ")}; its colours are ${Object.keys(MAP_COLOURS).join(", ")}`);

  // the scene's lines
  const roadCfg = a.roads ?? {};
  const roadKind = String(roadCfg.kind ?? "roadline");
  const classes: Args = { road: { width: 12 }, gravel: { width: 8.5, lane: true }, ...(roadCfg.classes ?? {}) };
  const roads = objects.filter((o) => o.kind === roadKind && Array.isArray(o.props?.points) && o.props.points.length >= 2)
    .map((o, i) => ({ key: String(o.props.key ?? o.name ?? `road${i}`), label: typeof o.props.label === "string" ? o.props.label : null, cls: String(o.props.surface ?? "road"), width: Number(o.props.width ?? 5), pts: o.props.points as P[] }));
  const waterCfg = a.water ?? {};
  const waters = objects.filter((o) => o.kind === String(waterCfg.kind ?? "water") && Array.isArray(o.props?.points) && o.props.points.length >= 2)
    .map((o) => ({ key: String(o.props.key ?? o.name ?? ""), width: Number(o.props.width ?? 4), pts: o.props.points as P[] }));

  // where the map looks: bounds in metres, then the picture's size and the scale
  let bounds: number[];
  if (a.bounds !== undefined) {
    if (!Array.isArray(a.bounds) || a.bounds.length !== 4 || !a.bounds.every((v: unknown) => typeof v === "number")) throw new Error('"bounds" is [x0, z0, x1, z1] in metres');
    bounds = a.bounds;
  } else {
    const all = [...roads.flatMap((r) => r.pts), ...waters.flatMap((w) => w.pts)];
    if (!all.length) throw new Error(`scenes/${a.scene}.scene.json has no road lines (kind "${roadKind}") or water to map: give \`bounds\``);
    bounds = [Math.min(...all.map((p) => p[0])) - 40, Math.min(...all.map((p) => p[1])) - 40, Math.max(...all.map((p) => p[0])) + 40, Math.max(...all.map((p) => p[1])) + 40];
  }
  const [bx0, bz0, bx1, bz1] = [Math.min(bounds[0]!, bounds[2]!), Math.min(bounds[1]!, bounds[3]!), Math.max(bounds[0]!, bounds[2]!), Math.max(bounds[1]!, bounds[3]!)];
  let H = typeof a.size === "number" ? a.size : Array.isArray(a.size) ? Number(a.size[1]) : 990;
  const frame = Math.round(H * 0.045); // the border's margin
  let s = (H - 2 * frame) / (bz1 - bz0);
  let W = Array.isArray(a.size) ? Number(a.size[0]) : Math.round((bx1 - bx0) * s + 2 * frame);
  if (Array.isArray(a.size)) s = Math.min(s, (W - 2 * frame) / (bx1 - bx0));
  if (!(W >= 64 && H >= 64 && W <= 4096 && H <= 4096)) throw new Error('"size" gives a picture from 64 to 4096 px on a side');
  W = Math.round(W);
  H = Math.round(H);
  const ox = (W - (bx1 - bx0) * s) / 2, oy = (H - (bz1 - bz0) * s) / 2;
  // (north up, east right: east is -x on Nova's ground)
  const toMap = (x: number, z: number): P => [ox + (bx1 - x) * s, oy + (bz1 - z) * s];
  const toWorld = (px: number, py: number): P => [bx1 - (px - ox) / s, bz1 - (py - oy) / s];
  const wob = Number(a.wobble ?? 0.7);
  const inner = [frame, frame, W - frame, H - frame];
  const inFrame = (x: number, y: number, m = 0) => x > inner[0]! + m && y > inner[1]! + m && x < inner[2]! - m && y < inner[3]! - m;

  // the terrain
  let heights: Heights | null = null;
  const tCfg = a.terrain === false ? null : a.terrain ?? findTerrain(root);
  if (tCfg) {
    const file = join(root, String(tCfg.heightmap ?? ""));
    if (!tCfg.heightmap || !existsSync(file)) throw new Error(`terrain: there is no heightmap ${tCfg.heightmap ?? "(none named)"} in the project`);
    heights = readHeights(new Uint8Array(readFileSync(file)), Number(tCfg.x ?? 0), Number(tCfg.z ?? 0), Number(tCfg.size ?? 100), Number(tCfg.height ?? 10));
  }
  const waterBelow = a.water_below === undefined ? null : Number(a.water_below);

  let tmpDir: string | null = null;
  const tctx = { bin, root, font: String(a.font ?? "rounded"), tmp: () => (tmpDir ??= mkdtempSync(join(tmpdir(), "nova-map-"))) };
  const cache = new Map<string, Words>();
  const labels: MapLabel[] = [];
  const taken: Placed[] = []; // icons, labels and furniture: nothing is lettered over them
  const free = (x: number, y: number, r: number) => taken.every((t) => Math.hypot(t.x - x, t.y - y) > t.r + r);
  try {
    const cv = new Canvas(W, H, C.paper);
    const rnd = rng(seed * 7919 + 17);
    const n1 = noise(seed), n2 = noise(seed + 101), n3 = noise(seed + 202);

    // ---- fields: roads, water ----------------------------------------------------------------------------------------------------
    const clsOf = (c: string) => classes[c] ?? classes.road;
    const roadPx = roads.map((r, i) => {
      const pts = wobble(resample(r.pts.map(([x, z]) => toMap(x, z)), 3), wob, 60, seed * 31 + i);
      return { ...r, px: pts, half: Number(clsOf(r.cls).width ?? 10) / 2, lane: clsOf(r.cls).lane === true };
    });
    const roadField = new Field(W, H);
    roadPx.forEach((r, i) => roadField.line(r.px, r.half, i));
    const mainField = new Field(W, H);
    roadPx.forEach((r, i) => !r.lane && mainField.line(r.px, r.half, i));
    const waterPx = waters.map((w, i) => ({ ...w, px: wobble(resample(w.pts.map(([x, z]) => toMap(x, z)), 3), wob * 1.4, 40, seed * 53 + i), half: Math.max(2.4, (w.width * s) / 2) }));
    const waterField = new Field(W, H);
    waterPx.forEach((w, i) => waterField.line(w.px, w.half, i));
    // (the lake: the terrain below `water_below`, its edge wobbled by noise)
    const lake = new Uint8Array(W * H);
    if (heights && waterBelow !== null) {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const [wx, wz] = toWorld(x + 0.5, y + 0.5);
        if (heightAt(heights, wx, wz) + (n2(x / 9, y / 9) - 0.5) * 0.6 < waterBelow) lake[y * W + x] = 1;
      }
    }
    // (and open water given as rectangles: the sea or a lake beyond the terrain's edge, its shore wobbled by a few metres)
    const areasOfWater: number[][] = a.water_areas ?? [];
    for (const [i, r] of areasOfWater.entries()) {
      if (!Array.isArray(r) || r.length !== 4) throw new Error(`water_areas ${i} is [x0, z0, x1, z1] in metres`);
      const [x0, z0, x1, z1] = [Math.min(r[0]!, r[2]!), Math.min(r[1]!, r[3]!), Math.max(r[0]!, r[2]!), Math.max(r[1]!, r[3]!)];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const [wx, wz] = toWorld(x + 0.5, y + 0.5), k = (n2(x / 14, y / 14 + 50) - 0.5) * 6;
        if (wx > x0 + k && wx < x1 - k && wz > z0 + k && wz < z1 - k) lake[y * W + x] = 1;
      }
    }
    // (and the ponds: still water inside a shore line, objects of the scene of the kind `ponds.kind`, its shore wobbled by a metre or so)
    const pondKind = a.ponds && typeof a.ponds === "object" ? String(a.ponds.kind ?? "pond") : null;
    for (const o of pondKind ? objects.filter((q) => q.kind === pondKind && Array.isArray(q.props?.shore) && q.props.shore.length >= 3) : []) {
      const shore = o.props.shore as P[];
      const inside = (wx: number, wz: number) => {
        let c = false;
        for (let i = 0, j = shore.length - 1; i < shore.length; j = i++) {
          const [xi, zi] = shore[i]!, [xj, zj] = shore[j]!;
          if ((zi! > wz) !== (zj! > wz) && wx < ((xj! - xi!) * (wz - zi!)) / (zj! - zi!) + xi!) c = !c;
        }
        return c;
      };
      const pts = shore.map(([x, z]) => toMap(x!, z!)), xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      for (let y = Math.max(0, Math.floor(Math.min(...ys)) - 3); y < Math.min(H, Math.ceil(Math.max(...ys)) + 3); y++)
        for (let x = Math.max(0, Math.floor(Math.min(...xs)) - 3); x < Math.min(W, Math.ceil(Math.max(...xs)) + 3); x++) {
          const k = (n2(x / 5, y / 5 + 90) - 0.5) * 2;
          const [wx, wz] = toWorld(x + 0.5 + k, y + 0.5 - k);
          if (inside(wx, wz)) lake[y * W + x] = 1;
        }
    }
    const isWater = (x: number, y: number) => waterField.at(x, y) < 0 || lake[Math.floor(clamp(y, 0, H - 1)) * W + Math.floor(clamp(x, 0, W - 1))] === 1;

    // ---- the places' icons: where each goes (drawn later) ------------------------------------------------------------------------
    type Icon = { icon: string; x: number; y: number; ry: number; size: number; label?: string; a?: P; b?: P; of: string };
    const icons: Icon[] = [];
    const placeCfg: Args = a.places ?? {};
    const U = H / 990; // (sizes are tuned for a picture 990 px high; a bigger map draws them bigger)
    const textMin = Math.max(0, Math.round(Number(a.text_min ?? 0))); // (the smallest word, px: a small map's small print stays readable)
    const iconSize: Record<string, number> = { post_office: 34, house: 22, shed: 16, bridge: 0, broken_bridge: 0, barrier: 18, picnic: 16, mast: 26, wall: 0, viewpoint: 18, bench: 12 };
    for (const o of objects) {
      const cfg = placeCfg[o.kind];
      if (!cfg) continue;
      if (!MAP_ICONS.includes(cfg.icon)) throw new Error(`places ${o.kind}: icon is ${MAP_ICONS.join(", ")}`);
      const [x, y] = toMap(Number(o.x ?? 0), Number(o.z ?? 0));
      const ic: Icon = { icon: cfg.icon, x, y, ry: Number(o.props?.ry ?? 0), size: (cfg.size ?? iconSize[cfg.icon] ?? 18) * U, label: typeof cfg.label === "string" ? cfg.label : undefined, of: o.kind };
      if (Array.isArray(o.props?.a) && Array.isArray(o.props?.b)) (ic.a = toMap(o.props.a[0], o.props.a[1])), (ic.b = toMap(o.props.b[0], o.props.b[1]));
      icons.push(ic);
    }
    for (const [i, m] of (a.marks ?? []).entries()) {
      if (!Array.isArray(m.at) || !MAP_ICONS.includes(m.icon)) throw new Error(`marks ${i} is { at: [x, z], icon (${MAP_ICONS.join(", ")}), label? }`);
      const [x, y] = toMap(m.at[0], m.at[1]);
      icons.push({ icon: m.icon, x, y, ry: Number(m.ry ?? 0), size: (m.size ?? iconSize[m.icon] ?? 18) * U, label: m.label, of: `mark ${i}` });
    }
    // (an icon that would sit on a road is moved off it, the least way that clears it: a map's symbol stands beside the road its
    // building stands by)
    for (const ic of icons) {
      if (ic.size <= 0 || ic.icon === "barrier") continue; // (a barrier stands across its road)
      const clearOf = (x: number, y: number) => roadField.at(x, y - ic.size * 0.3) > ic.size * 0.55 && roadField.at(x, y) > ic.size * 0.35;
      if (clearOf(ic.x, ic.y)) continue;
      search: for (let d = 2; d < ic.size * 2.5; d += 2) {
        for (let k = 0; k < 16; k++) {
          const an = (k / 16) * Math.PI * 2, x = ic.x + Math.cos(an) * d, y = ic.y + Math.sin(an) * d;
          if (clearOf(x, y)) {
            (ic.x = x), (ic.y = y);
            break search;
          }
        }
      }
    }
    for (const ic of icons) if (ic.size > 0) taken.push({ x: ic.x, y: ic.y - ic.size * 0.15, r: ic.size * 0.62 });
    // (the post office's flag stands out to its west)
    for (const ic of icons) if (ic.icon === "post_office") taken.push({ x: ic.x - ic.size * 0.68, y: ic.y - ic.size * 0.85, r: ic.size * 0.3 });
    // (a bridge: its deck, from one end to the other)
    for (const ic of icons) if (ic.a && ic.b) for (let t = 0; t <= 1.001; t += 0.25) taken.push({ x: ic.a[0] + (ic.b[0] - ic.a[0]) * t, y: ic.a[1] + (ic.b[1] - ic.a[1]) * t, r: 7 * U });
    // a wall's stones are kept clear of a little, too
    for (const ic of icons) if (ic.icon === "wall") taken.push({ x: ic.x, y: ic.y, r: 4 * s * 0.5 });

    // ---- the furniture: in the corners with the least in them --------------------------------------------------------------------
    // (a road, a water line or an icon under it counts heavily; a lake hardly: a cartouche over open water is the old way)
    const busy = (x0: number, y0: number, w: number, h: number, wet = 0.2) => {
      let n = 0;
      for (let y = y0; y < y0 + h; y += 4) for (let x = x0; x < x0 + w; x += 4) {
        if (roadField.at(x, y) < 6) n += 20;
        const wd = waterField.at(x, y);
        // (a narrow line of water, a creek, counts; a wide one, a river or a gorge, is open water)
        if (wd < 4 && waterPx[waterField.tag[Math.floor(y) * W + Math.floor(x)]!]!.half < 9 * U) n += 3 + wet * 4;
        else if (isWater(x, y) || wd < 0) n += wet;
        if (taken.some((t) => Math.hypot(t.x - x, t.y - y) < t.r + 3)) n += 20;
      }
      return n;
    };
    const m = frame + 14 * U;
    // (the four corners first, then the middles of the four sides)
    const corners = (w: number, h: number): P[] => [[m, m], [W - m - w, m], [m, H - m - h], [W - m - w, H - m - h], [(W - w) / 2, m], [(W - w) / 2, H - m - h], [m, (H - h) / 2], [W - m - w, (H - h) / 2], [(W - w) * 0.25, H - m - h], [(W - w) * 0.75, H - m - h], [(W - w) * 0.25, m], [(W - w) * 0.75, m]];
    const pick = (w: number, h: number, avoid: P[] = [], wet = 0.2) => {
      let best: P = corners(w, h)[0]!, bv = Infinity;
      for (const c of corners(w, h)) {
        if (avoid.some(([x, y]) => Math.abs(x - c[0]) < 1 && Math.abs(y - c[1]) < 1)) continue;
        const v = busy(c[0], c[1], w, h, wet);
        if (v < bv) (bv = v, (best = c));
      }
      return best;
    };
    const blockRect = (x: number, y: number, w: number, h: number) => {
      // (circles of half the short side, evenly from end to end, the last at the far end; each a little bigger than half the
      // spacing's diagonal, so the whole rectangle is covered)
      const r = Math.min(w, h) / 2, nx = Math.max(1, Math.ceil((w - 2 * r) / r) + 1), ny = Math.max(1, Math.ceil((h - 2 * r) / r) + 1);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const xx = nx > 1 ? x + r + ((w - 2 * r) * i) / (nx - 1) : x + w / 2, yy = ny > 1 ? y + r + ((h - 2 * r) * j) / (ny - 1) : y + h / 2;
        taken.push({ x: xx, y: yy, r: r * 1.12 });
      }
    };
    const usedCorners: P[] = [];
    // the title
    let titleBox: [number, number, number, number] | null = null;
    const titleWords = a.title ? wordsOf(tctx, String(a.title), Math.round(56 * U), cache) : null;
    const subWords = a.subtitle ? wordsOf(tctx, String(a.subtitle), Math.max(textMin, Math.round(20 * U)), cache) : null;
    if (titleWords) {
      const tw = Math.max(titleWords.w, subWords?.w ?? 0) + 56 * U, th = titleWords.cap + (subWords ? subWords.cap + 26 * U : 0) + 50 * U;
      const [x, y] = pick(tw, th);
      usedCorners.push([x, y]);
      titleBox = [x, y, tw, th];
      blockRect(x - 30 * U, y - 6, tw + 60 * U, th + 12); // (with the ribbons either side)
    }
    // the compass rose
    let compassAt: P | null = null;
    const rose = 46 * U;
    if (a.compass !== false) {
      const [x, y] = pick(rose * 2 + 10, rose * 2 + 34 * U, usedCorners, 2); // (the compass and the scale on land: a lake is no place for them)
      usedCorners.push([x, y]);
      compassAt = [x + rose + 5, y + rose + 30 * U];
      blockRect(x, y, rose * 2 + 10, rose * 2 + 34 * U);
    }
    // the scale bar: a round length near a fifth of the width
    let scaleAt: P | null = null, scaleM = 0;
    if (a.scale_bar !== false) {
      const want = (W * 0.2) / s;
      const nice = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
      const first = nice.reduce((b, v) => (Math.abs(v - want) < Math.abs(b - want) ? v : b), 50);
      // (that length, or the next shorter one when it finds a clearer place: a scale bar never lies across a road or a creek)
      const sh = 40 * U;
      let best: [number, P, number] | null = null;
      for (const len of [first, nice[Math.max(0, nice.indexOf(first) - 1)]!]) {
        const w0 = len * s + 40 * U, at = pick(w0, sh, usedCorners, 2), v = busy(at[0], at[1], w0, sh, 2);
        if (!best || v < best[2] - 1) best = [len, at, v];
      }
      scaleM = best![0];
      const [x, y] = best![1], sw = scaleM * s;
      usedCorners.push([x, y]);
      scaleAt = [x + 12 * U, y + 12 * U];
      blockRect(x, y, sw + 40 * U, sh);
    }

    // ---- labels: where each name goes -----------------------------------------------------------------------------------------
    const labelSize = Math.max(textMin, Math.round(Number(a.label_size ?? 24 * U)));
    const halo = Math.max(2, 3.2 * U);
    type Run = { words: Words; path: P[]; off: number; color: RGB; kind: MapLabel["kind"]; of: string };
    const runs: Run[] = [];
    const flat: { words: Words; x: number; y: number; color: RGB; kind: MapLabel["kind"]; of: string; weight: number; halo: number }[] = [];
    /// Places one or more names along a line: the straightest stretches, clear of everything, `repeat` px apart along it.
    // (`relax` 1: a second try for a name that found no room: bendier stretches, and across a creek)
    const along = (text: string, line: P[], half: number, color: RGB, kind: MapLabel["kind"], of: string, own: Field, ownTag: number, repeatPx: number, relax = 0) => {
      const g = wordsOf(tctx, text, labelSize, cache);
      const pts = resample(line, 2);
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
      const total = cum[cum.length - 1]!, L = g.w + 6;
      if (total < L + 8) return 0;
      const idx = (sv: number) => {
        let lo = 0, hi = cum.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (cum[mid]! < sv) lo = mid + 1;
          else hi = mid;
        }
        return lo;
      };
      const dirAt = (i: number) => {
        const p = pts[Math.max(0, i - 3)]!, q = pts[Math.min(pts.length - 1, i + 3)]!;
        return Math.atan2(q[1] - p[1], q[0] - p[0]);
      };
      type Cand = { s0: number; side: number; score: number; circles: [number, number, number][]; piece: P[]; off: number };
      const cands: Cand[] = [];
      const rad = g.cap / 2 + halo + 1.5;
      for (let s0 = 6; s0 + L < total - 6; s0 += 5) {
        const i0 = idx(s0), i1 = idx(s0 + L);
        // straight enough? (the turn over the name, and the sharpest bend in it)
        let turn = 0, bend = 0;
        const d0 = dirAt(i0);
        for (let i = i0; i <= i1; i += 3) {
          const dd = Math.abs(((dirAt(i) - d0 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
          turn = Math.max(turn, dd);
          if (i + 6 <= i1) bend = Math.max(bend, Math.abs(((dirAt(i + 6) - dirAt(i) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI));
        }
        if (turn > (relax ? 1.1 : 0.75) || bend > (relax ? 0.5 : 0.35)) continue;
        let piece = pts.slice(i0, i1 + 1);
        // never upside down: the words read left to right
        if (piece[piece.length - 1]![0] < piece[0]![0]) piece = [...piece].reverse();
        for (const side of [1, -1]) {
          const off = side * (half + 2.1 * U + 4 + 1.5 * U + g.cap / 2 + 1);
          const circles: [number, number, number][] = [];
          let ok = true, near = 0;
          for (let k = 0; k < piece.length && ok; k += Math.max(1, Math.round(rad / 2.2))) {
            const a0 = piece[Math.max(0, k - 2)]!, b0 = piece[Math.min(piece.length - 1, k + 2)]!;
            const dx = b0[0] - a0[0], dy = b0[1] - a0[1], l = Math.hypot(dx, dy) || 1;
            const cx = piece[k]![0] + (dy / l) * off, cy = piece[k]![1] - (dx / l) * off;
            if (!inFrame(cx, cy, rad + 4)) ok = false;
            else if (roadField.at(cx, cy) < rad - 1) ok = false;
            else if (own !== roadField && own.at(cx, cy) < rad - 1 && own.tag[Math.floor(cy) * W + Math.floor(cx)] !== ownTag) ok = false;
            else if (kind === "road" && (lake[Math.floor(cy) * W + Math.floor(cx)] === 1 || (!relax && waterField.at(cx, cy) < rad * 0.8))) ok = false;
            else if (!free(cx, cy, rad)) ok = false;
            // (close to another road is allowed but costs: a name between two roads is ambiguous)
            const other = roadField.tag[Math.floor(clamp(cy, 0, H - 1)) * W + Math.floor(clamp(cx, 0, W - 1))];
            if (other !== ownTag && roadField.at(cx, cy) < rad + 14) near++;
            circles.push([cx, cy, rad]);
          }
          if (!ok) continue;
          // the score: straight is better, and away from the ends and from other roads
          const mid = s0 + L / 2;
          const score = turn * 40 + bend * 60 + near * 6 + (Math.min(mid, total - mid) < L ? 8 : 0) + (side < 0 ? 0.5 : 0);
          cands.push({ s0, side, score, circles, piece, off });
        }
      }
      // how many: one per `repeat` px of road. A long road's names are spread out: each is chosen near its own share of the road
      // (the best within a slot first), so the best spot in the middle does not leave no room for the others.
      const want = Math.max(1, Math.floor(total / repeatPx) + (total > repeatPx * 0.75 ? 1 : 0));
      const gap = Math.min(repeatPx * 0.85, total / want - L * 0.25);
      const chosen: Cand[] = [];
      const take = (c: Cand) => {
        chosen.push(c);
        for (const [x, y, r] of c.circles) taken.push({ x, y, r });
        labels.push({ text, kind, circles: c.circles, of, px: g.size });
        runs.push({ words: g, path: c.piece, off: c.off, color, kind, of });
      };
      const fits = (c: Cand) => !chosen.some((o) => Math.abs(o.s0 - c.s0) < gap) && c.circles.every(([x, y, r]) => free(x, y, r));
      const byScore = [...cands].sort((p, q) => p.score - q.score || p.s0 - q.s0);
      if (want > 1) {
        for (let k = 0; k < want; k++) {
          const lo = (total * k) / want, hi = (total * (k + 1)) / want;
          const best = byScore.find((c) => c.s0 + L / 2 >= lo && c.s0 + L / 2 < hi && fits(c));
          if (best) take(best);
        }
      }
      for (const c of byScore) {
        if (chosen.length >= want) break;
        if (fits(c)) take(c);
      }
      return chosen.length;
    };
    /// A name beside an icon: the first of eight places round it that is clear.
    // (with no room round it at its size, a name is tried once more a size smaller)
    const beside = (text: string, x: number, y: number, r: number, color: RGB, of: string, size = labelSize * 0.86, kind: MapLabel["kind"] = "place"): boolean =>
      besideAt(text, x, y, r, color, of, Math.max(size, textMin), kind) || (size * 0.82 >= textMin && besideAt(text, x, y, r, color, of, size * 0.82, kind));
    const besideAt = (text: string, x: number, y: number, r: number, color: RGB, of: string, size: number, kind: MapLabel["kind"]) => {
      const g = wordsOf(tctx, text, Math.round(size), cache);
      // (above and below it, also slid a quarter or a third of its width either way, to fit between a road and a creek)
      const slid = (dy: number): [number, number, string][] => [0.25, -0.25, 0.34, -0.34].map((k) => [k * 2 * (g.w / 2) / Math.max(1, r + 6), dy, "c"]);
      const spots: [number, number, string][] = [[1, 0, "l"], [-1, 0, "r"], [0, 1, "c"], [0, -1, "c"], [1, 1, "l"], [-1, 1, "r"], [1, -1, "l"], [-1, -1, "r"], ...slid(-1), ...slid(1)];
      // (the eight places close round it first, then a little further out)
      for (const [dx, dy, al, far] of [0, 1, 2].flatMap((f) => spots.map(([a, b, c]) => [a, b, c, f] as [number, number, string, number]))) {
        const cx = x + dx * (r + 6 + far * r * 0.6 + (al === "c" ? 0 : g.w / 2)), cy = y + dy * (r + 4 + far * r * 0.4 + g.cap / 2);
        const circles: [number, number, number][] = [];
        const rr = g.cap / 2 + halo + 1;
        for (let u = -g.w / 2 + rr * 0.6; u <= g.w / 2 - rr * 0.6 + 0.1; u += rr) circles.push([cx + u, cy, rr]);
        if (!circles.every(([px, py, pr]) => inFrame(px, py, pr + 2) && free(px, py, pr) && roadField.at(px, py) > pr * 0.7 && waterField.at(px, py) > pr * 0.6)) continue;
        for (const [px, py, pr] of circles) taken.push({ x: px, y: py, r: pr });
        labels.push({ text, kind, circles, of, px: g.size });
        flat.push({ words: g, x: cx - g.w / 2, y: cy + g.cap / 2, color, kind, of, weight: 0.45, halo });
        return true;
      }
      return false;
    };
    // places first (they are few and fixed), then the roads, the water, the areas
    for (const ic of icons) if (ic.label) beside(ic.label, ic.x, ic.y - ic.size * 0.15, ic.size * 0.55, ic.icon === "barrier" ? C.red : C.label, ic.of);
    const repeatPx = Number(a.repeat ?? 380 * U);
    const named = roadPx.filter((r) => r.label);
    for (const [i, r] of roadPx.entries()) if (r.label && !along(r.label, r.px, r.half, C.label, "road", r.key, roadField, i, repeatPx)) along(r.label, r.px, r.half, C.label, "road", r.key, roadField, i, repeatPx, 1);
    const waterNames: Args = waterCfg.names ?? {};
    for (const [i, w] of waterPx.entries()) if (typeof waterNames[w.key] === "string") along(waterNames[w.key], w.px, w.half, C.water_label, "water", w.key, waterField, i, repeatPx * 1.4);
    for (const [i, ar] of (a.areas ?? []).entries()) {
      if (!Array.isArray(ar.at) || typeof ar.text !== "string") throw new Error(`areas ${i} is { at: [x, z], text }`);
      const [ax, ay] = toMap(ar.at[0], ar.at[1]);
      const g = wordsOf(tctx, ar.text, Math.round(labelSize * 0.92), cache);
      const rr = g.cap / 2 + halo;
      // (at its point, or the nearest place round it that is clear: spiralling out a few px at a time)
      const at = (x: number, y: number) => {
        const c: [number, number, number][] = [];
        for (let u = -g.w / 2 + rr * 0.6; u <= g.w / 2 - rr * 0.6 + 0.1; u += rr) c.push([x + u, y, rr]);
        return c;
      };
      const clear = (c: [number, number, number][]) => c.every(([px, py, pr]) => inFrame(px, py, pr) && free(px, py, pr) && roadField.at(px, py) > pr);
      let circles = at(ax, ay), x = ax, y = ay;
      for (let k = 1; k <= 1500 && !clear(circles); k++) {
        const an = k * 2.4, rad2 = 3 * Math.sqrt(k) * U;
        (x = ax + Math.cos(an) * rad2 * 2), (y = ay + Math.sin(an) * rad2);
        circles = at(x, y);
      }
      // (a region's name is a nicety: with nowhere clear near its point, it is left out)
      if (!clear(circles)) continue;
      for (const [px, py, pr] of circles) taken.push({ x: px, y: py, r: pr });
      labels.push({ text: ar.text, kind: "area", circles, of: `area ${i}`, px: g.size });
      flat.push({ words: g, x: x - g.w / 2, y: y + g.cap / 2, color: C.faint, kind: "area", of: `area ${i}`, weight: 0.2, halo: halo * 0.8 });
    }
    const missing = named.filter((r) => !labels.some((l) => l.kind === "road" && l.of === r.key));

    // ---- paint: the land -----------------------------------------------------------------------------------------------------------
    let hmin = Infinity, hmax = -Infinity;
    const hAt = new Float32Array(W * H), hCont = new Float32Array(W * H);
    if (heights) {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const [wx, wz] = toWorld(x + 0.5, y + 0.5);
        const v = heightAt(heights, wx, wz);
        hAt[y * W + x] = v;
        if (inFrame(x, y) && !lake[y * W + x] && waterField.d[y * W + x]! > 0) (hmin = Math.min(hmin, v), (hmax = Math.max(hmax, v)));
      }
    }
    const span = Math.max(1, hmax - hmin);
    const contour = span > 60 ? 10 : 5;
    // The land is shaded from the terrain with its water channels left out: a creek's cut (and its banks) is filled in from the ground
    // round it and the whole is smoothed a little (a weighted blur, the channel weighing nothing), so a creek is not drawn as a long dark
    // slope beside it, and the shading and contours follow the hills, not every ripple of the heightmap.
    if (heights) {
      const bank = Math.max(6, 7 * s);
      const wgt = new Float32Array(W * H), num = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) {
        const w0 = lake[i] ? 0 : smooth(0, bank, waterField.d[i]!);
        wgt[i] = w0;
        num[i] = hAt[i]! * w0;
      }
      const r = Math.max(3, Math.round(7 * U));
      for (let pass = 0; pass < 3; pass++) for (const f of [num, wgt]) boxBlur(f, W, H, r);
      for (let i = 0; i < W * H; i++) if (wgt[i]! > 1e-4) hAt[i] = num[i]! / wgt[i]!;
      // (the contours from a smoother copy still: a bump a few metres across closes into a small ring that reads as a stray circle)
      hCont.set(hAt);
      for (let pass = 0; pass < 2; pass++) boxBlur(hCont, W, H, Math.max(4, Math.round(12 * U)));
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      // the paper itself: mottled, a little warmer here and paler there
      const mot = (n1(x / 90, y / 90) - 0.5) * 0.7 + (n2(x / 23, y / 23) - 0.5) * 0.3;
      cv.over(i, mot > 0 ? C.paper_edge : [255, 250, 236], Math.abs(mot) * 0.16);
      if (!inFrame(x, y)) continue;
      // the land: meadow tint, bands by height, shading from the north-west, faint contours
      let t = 0;
      if (heights) {
        const h0 = hAt[i]!;
        t = clamp((h0 - hmin) / span, 0, 1);
        const band = smooth(0.28, 0.4, t) + smooth(0.6, 0.72, t);
        const col: RGB = band < 1 ? mix3(C.meadow, C.hill, band) : mix3(C.hill, C.high, band - 1);
        cv.mul(i, col, 0.42);
        // (the slope, from the neighbours, in metres)
        const hx = (hAt[y * W + Math.min(W - 1, x + 1)]! - hAt[y * W + Math.max(0, x - 1)]!) / (2 / s);
        const hy = (hAt[Math.min(H - 1, y + 1) * W + x]! - hAt[Math.max(0, y - 1) * W + x]!) / (2 / s);
        // map x is east, map y is south; the light comes from the north-west, 45 degrees up
        const nx = -hx, ny = -hy, nz = 1, nl = Math.hypot(nx, ny, nz);
        const lit = (nx * -0.5 + ny * -0.5 + nz * 0.7071) / nl;
        const shadeK = (lit - 0.7071) * 1.6;
        if (shadeK < 0) cv.mul(i, C.contour, Math.min(0.32, -shadeK * 0.55));
        else cv.over(i, [255, 252, 240], Math.min(0.3, shadeK * 0.6));
        // (contours: from the smoother copy, only where the ground really slopes, faded out near the sheet's edge, where the land rising
        // to the map's rim would draw a ruled line along the frame)
        const c0 = hCont[i]!;
        const cx = (hCont[y * W + Math.min(W - 1, x + 1)]! - hCont[y * W + Math.max(0, x - 1)]!) / (2 / s);
        const cy = (hCont[Math.min(H - 1, y + 1) * W + x]! - hCont[Math.max(0, y - 1) * W + x]!) / (2 / s);
        const grad = Math.hypot(cx, cy);
        const edgeFade = smooth(0, 70 * U, Math.min(x - inner[0]!, y - inner[1]!, inner[2]! - x, inner[3]! - y));
        if (grad > 0.03 && edgeFade > 0) {
          const f = c0 / contour, dist = (Math.abs(f - Math.round(f)) * contour) / grad * s;
          const major = Math.round(f) % 5 === 0;
          const cov = clamp((major ? 0.95 : 0.7) - dist, 0, 1) * (major ? 0.32 : 0.18) * edgeFade * smooth(0.03, 0.08, grad);
          if (cov > 0) cv.over(i, C.contour, cov);
        }
      } else cv.mul(i, C.meadow, 0.35);
    }

    // ---- water: the lake, then the lines ---------------------------------------------------------------------------------------
    const waterEdge = new Float32Array(W * H).fill(1e6);
    if (waterBelow !== null || areasOfWater.length) {
      // (the distance into the lake from its edge, a few px, for the shore line)
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (!lake[i]) continue;
        cv.over(i, C.water, 0.92);
        const edge = !lake[i - 1] || !lake[i + 1] || !lake[i - W] || !lake[i + W];
        if (edge) waterEdge[i] = 0;
      }
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (waterEdge[i] === 0) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) cv.over(i + dy * W + dx, C.water_dark, dx || dy ? 0.35 : 0.8);
      }
      // ripples: short strokes across the lake
      const rr = rng(seed * 13 + 5);
      for (let k = 0; k < (W * H) / 2600; k++) {
        const x = rr() * W, y = rr() * H, len = (6 + rr() * 10) * U;
        let ok = true;
        for (let t = -len; t <= len && ok; t += 2) if (!lake[Math.floor(y) * W + Math.floor(clamp(x + t, 0, W - 1))] || waterEdge[Math.floor(y) * W + Math.floor(clamp(x + t, 0, W - 1))] === 0) ok = false;
        if (!ok || !inFrame(x, y, 4)) continue;
        cv.shape((px, py) => dSeg(px, py, x - len, y + Math.sin(x) * 0.5, x + len, y) - 0.55 * U, [x - len - 2, y - 3, x + len + 2, y + 3], C.water_dark, 0.35);
      }
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, d = waterField.d[i]!;
      if (d > 2) continue;
      if (d < 0) cv.over(i, C.water, clamp(0.5 - d, 0, 1) * 0.95);
      cv.over(i, C.water_dark, clamp(0.5 - Math.abs(d + 0.4) + 0.6 * U, 0, 1) * 0.8);
    }
    // a light wavy thread down the middle of each water line
    for (const [wi, w] of waterPx.entries()) {
      if (w.half < 3.2) continue;
      const mid = resample(w.px, 2).map(([x, y], k, arr) => {
        const p = arr[Math.max(0, k - 1)]!, q = arr[Math.min(arr.length - 1, k + 1)]!, dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1;
        const sw = Math.sin(k * 0.33 + wi) * w.half * 0.35;
        return [x - (dy / l) * sw, y + (dx / l) * sw] as P;
      });
      for (let k = 1; k < mid.length; k++) {
        if (Math.floor(k / 6) % 3 === 2) continue;
        const [ax, ay] = mid[k - 1]!, [bx, by] = mid[k]!;
        cv.shape((px, py) => dSeg(px, py, ax, ay, bx, by) - 0.55 * U, [Math.min(ax, bx) - 2, Math.min(ay, by) - 2, Math.max(ax, bx) + 2, Math.max(ay, by) + 2], C.water_light, 0.85);
      }
    }

    // ---- trees: little drawn symbols, thinned to a grid, kept off the roads, the water, the names and the icons ----------------
    const treeCfg: Args = a.trees ?? {};
    const pineKinds = new Set<string>(treeCfg.pine ?? []), roundKinds = new Set<string>(treeCfg.round ?? []);
    const forestCfg: Args = a.forest ?? {};
    const forestKinds = new Set<string>(forestCfg.kinds ?? []);
    const cell = Math.max(7, 10.5 * U);
    const grid = new Map<string, true>();
    const trees: { x: number; y: number; pine: boolean; k: number }[] = [];
    const tryTree = (x: number, y: number, pine: boolean) => {
      if (!inFrame(x, y, 8)) return;
      const key = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
      if (grid.has(key)) return;
      // (its trunk and its crown, about 12 px above it, both clear of the roads, the water, the names and the icons)
      const cy = y - 6.5 * U;
      if (roadField.at(x, y) < 3 * U + 2.5 || roadField.at(x, cy) < 6 * U + 2 || waterField.at(x, y) < 3 || waterField.at(x, cy) < 5 * U || isWater(x, y + 3) || !free(x, y, 4 * U) || !free(x, cy, 6 * U)) return;
      if (titleBox && x > titleBox[0] - 6 && x < titleBox[0] + titleBox[2] + 6 && y > titleBox[1] - 6 && y < titleBox[1] + titleBox[3] + 6) return;
      grid.set(key, true);
      trees.push({ x: x + (rnd() - 0.5) * 2, y: y + (rnd() - 0.5) * 2, pine, k: rnd() });
    };
    for (const o of objects) {
      const pine = pineKinds.has(o.kind), round = roundKinds.has(o.kind);
      if (pine || round) {
        const [x, y] = toMap(Number(o.x ?? 0), Number(o.z ?? 0));
        tryTree(x, y, pine);
      } else if (forestKinds.has(o.kind)) {
        const [x, y] = toMap(Number(o.x ?? 0), Number(o.z ?? 0));
        const r = Number(forestCfg.radius ?? 12) * Number(o.props?.sx ?? 1) * s;
        const fr = rng(Math.round(Math.abs(o.x * 31 + o.z * 17)) + seed);
        for (let k = 0; k < Math.max(3, (r * r) / (cell * cell) * 2.2); k++) {
          const an = fr() * Math.PI * 2, rr = Math.sqrt(fr()) * r;
          tryTree(x + Math.cos(an) * rr, y + Math.sin(an) * rr * 0.8, fr() < 0.7);
        }
      }
    }
    trees.sort((p, q) => p.y - q.y || p.x - q.x);
    for (const t of trees) drawTree(cv, t.x, t.y, t.pine, t.k, U, C);

    // ---- roads: the casing of all, then the fill of all, so they join -----------------------------------------------------------
    const edgeW = 2.1 * U;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, d = roadField.d[i]!;
      if (d > edgeW + 1) continue;
      const r = roadPx[roadField.tag[i]!]!;
      cv.over(i, r.lane ? C.lane_edge : C.road_edge, clamp(0.5 - (d - edgeW), 0, 1) * 0.92);
    }
    // (the lanes' fill first, then the main roads' over it: where a lane meets a main road, the main road's fill runs on unbroken)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, d = roadField.d[i]!;
      if (d > 1) continue;
      cv.over(i, roadPx[roadField.tag[i]!]!.lane ? C.lane : C.road, clamp(0.5 - d, 0, 1));
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, d = mainField.d[i]!;
      if (d < 1 && roadField.tag[i] !== mainField.tag[i]) cv.over(i, C.road, clamp(0.5 - d, 0, 1));
    }
    // a dashed middle line on the main roads (not the lanes)
    for (const r of roadPx) {
      if (r.lane || r.half < 4.5 * U) continue;
      const pts = resample(r.px, 2);
      for (let k = 1; k < pts.length; k++) {
        if (Math.floor(k / 4) % 2 === 1) continue;
        const [ax, ay] = pts[k - 1]!, [bx, by] = pts[k]!;
        // (not across a lane's mouth: only where this road is the only road)
        if (roadField.tag[Math.floor(ay) * W + Math.floor(ax)] !== roadPx.indexOf(r)) continue;
        cv.shape((px, py) => dSeg(px, py, ax, ay, bx, by) - 0.6 * U, [Math.min(ax, bx) - 2, Math.min(ay, by) - 2, Math.max(ax, bx) + 2, Math.max(ay, by) + 2], C.faint, 0.45);
      }
    }

    // ---- icons ---------------------------------------------------------------------------------------------------------------------
    // (bridges first, over the road; then the rest from the back to the front)
    for (const ic of icons.filter((i) => i.icon === "bridge" || i.icon === "broken_bridge")) drawBridge(cv, ic, s, U, C, roadPx, roadField);
    for (const ic of icons.filter((i) => i.icon === "wall")) drawWall(cv, ic, s, U, C);
    for (const ic of [...icons].filter((i) => !["bridge", "broken_bridge", "wall"].includes(i.icon)).sort((p, q) => p.y - q.y)) drawIcon(cv, ic, U, C);

    // ---- the words -----------------------------------------------------------------------------------------------------------------
    for (const r of runs) drawRun(cv, r.words, r.path, r.off, r.color, C.halo, halo, r.kind === "water" ? 0.25 : 0.5);
    for (const f of flat) drawFlat(cv, f.words, f.x, f.y, f.color, C.halo, f.halo, f.weight);

    // ---- the furniture: title, compass, scale ---------------------------------------------------------------------------------------
    if (titleBox && titleWords) {
      const [x, y, w, h] = titleBox;
      // a cream panel with a double ink rule and a red ribbon tab at each side
      for (const side of [-1, 1]) {
        const cx = side < 0 ? x - 4 * U : x + w + 4 * U, cy = y + h * 0.5;
        cv.shape((px, py) => dPoly(px, py, [[cx, cy - 13 * U], [cx + side * 22 * U, cy - 13 * U], [cx + side * 14 * U, cy], [cx + side * 22 * U, cy + 13 * U], [cx, cy + 13 * U]]), [cx - 26 * U, cy - 16 * U, cx + 26 * U, cy + 16 * U], C.red, 0.95);
      }
      cv.shape((px, py) => dBox(px, py, x + w / 2, y + h / 2, w / 2, h / 2, 10 * U), [x - 2, y - 2, x + w + 2, y + h + 2], mix3(C.paper, [255, 252, 242], 0.5));
      cv.shape((px, py) => Math.abs(dBox(px, py, x + w / 2, y + h / 2, w / 2, h / 2, 10 * U)) - 1.4 * U, [x - 3, y - 3, x + w + 3, y + h + 3], C.ink);
      cv.shape((px, py) => Math.abs(dBox(px, py, x + w / 2, y + h / 2, w / 2 - 6 * U, h / 2 - 6 * U, 6 * U)) - 0.6 * U, [x, y, x + w, y + h], C.ink, 0.7);
      const ty = y + 24 * U + titleWords.cap;
      drawFlat(cv, titleWords, x + (w - titleWords.w) / 2, ty, mix3(C.ink, C.wood_dark, 0.35), null, 0, 1.1);
      labels.push({ text: String(a.title), kind: "title", circles: [], of: "title", px: titleWords.size });
      if (subWords) {
        const sy = ty + 18 * U + subWords.cap;
        cv.shape((px, py) => dSeg(px, py, x + w * 0.2, ty + 9 * U, x + w * 0.8, ty + 9 * U) - 0.7 * U, [x, ty + 5 * U, x + w, ty + 13 * U], C.red, 0.8);
        drawFlat(cv, subWords, x + (w - subWords.w) / 2, sy, C.faint, null, 0, 0.35);
        labels.push({ text: String(a.subtitle), kind: "title", circles: [], of: "subtitle", px: subWords.size });
      }
    }
    if (compassAt) {
      drawCompass(cv, compassAt[0], compassAt[1], rose, U, C);
      const g = wordsOf(tctx, "N", Math.max(textMin, Math.round(24 * U)), cache);
      drawFlat(cv, g, compassAt[0] - g.w / 2, compassAt[1] - rose - 6 * U, C.ink, C.halo, halo, 0.9);
      labels.push({ text: "N", kind: "compass", circles: [], of: "compass", px: g.size });
    }
    if (scaleAt) {
      const [x, y] = scaleAt, sw = scaleM * s, bh = 7 * U, parts = 4;
      for (let k = 0; k < parts; k++) {
        const x0 = x + (sw * k) / parts, x1 = x + (sw * (k + 1)) / parts;
        cv.shape((px, py) => dBox(px, py, (x0 + x1) / 2, y + 20 * U, (x1 - x0) / 2, bh / 2), [x0 - 1, y + 10 * U, x1 + 1, y + 30 * U], k % 2 ? mix3(C.paper, [255, 255, 255], 0.4) : C.ink);
      }
      cv.shape((px, py) => Math.abs(dBox(px, py, x + sw / 2, y + 20 * U, sw / 2, bh / 2)) - 0.7 * U, [x - 3, y + 10 * U, x + sw + 3, y + 30 * U], C.ink);
      for (const [v, at] of [[0, x], [scaleM / 2, x + sw / 2], [scaleM, x + sw]] as [number, number][]) {
        const g = wordsOf(tctx, v === scaleM ? `${v} m` : String(v), Math.round(Math.max(13, 15 * U, textMin)), cache);
        drawFlat(cv, g, at - (v === scaleM ? g.w * 0.3 : g.w / 2), y + 10 * U, C.ink, C.halo, 2, 0.4);
        labels.push({ text: g.text, kind: "scale", circles: [], of: "scale", px: g.size });
      }
    }

    // ---- the paper's age: fibres, two folds, darker edges, the border and its corners ------------------------------------------
    const fr = rng(seed * 97 + 3);
    for (let k = 0; k < (W * H) / 1400; k++) {
      const x = fr() * W, y = fr() * H, an = fr() * Math.PI, len = (4 + fr() * 12) * U, bend = (fr() - 0.5) * 4;
      const ax = x - Math.cos(an) * len, ay = y - Math.sin(an) * len, bx = x + Math.cos(an) * len + bend, by = y + Math.sin(an) * len;
      cv.shape((px, py) => dSeg(px, py, ax, ay, bx, by) - 0.35, [Math.min(ax, bx) - 2, Math.min(ay, by) - 2, Math.max(ax, bx) + 2, Math.max(ay, by) + 2], fr() < 0.5 ? C.fibre : [255, 251, 238], 0.13);
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      // folds: a pale crest and a soft shadow beside it, a third and two thirds across, and halfway down
      for (const fx of [W / 3, (2 * W) / 3]) {
        const d = x - fx + (n3(y / 70, fx) - 0.5) * 3;
        if (Math.abs(d) < 5) cv.over(i, d < 0 ? [255, 252, 244] : C.paper_edge, (1 - Math.abs(d) / 5) * 0.1);
      }
      const dy = y - H / 2 + (n3(x / 70, 7) - 0.5) * 3;
      if (Math.abs(dy) < 5) cv.over(i, dy < 0 ? [255, 252, 244] : C.paper_edge, (1 - Math.abs(dy) / 5) * 0.1);
      // darker towards the edges, unevenly
      const e = Math.min(x, y, W - 1 - x, H - 1 - y) / (Math.min(W, H) * 0.09) + (n1(x / 40 + 9, y / 40) - 0.5) * 0.5;
      if (e < 1) cv.mul(i, C.paper_edge, (1 - clamp(e, 0, 1)) ** 1.6 * 0.55);
    }
    // the border: a thick line and a thin one inside it, drawn by hand
    const bw = frame * 0.42, b2 = frame * 0.72;
    const rectLine = (inset: number) => wobble(resample([[inset, inset], [W - inset, inset], [W - inset, H - inset], [inset, H - inset], [inset, inset]], 3), wob * 0.8, 50, seed + Math.round(inset));
    for (const [inset, wdt] of [[bw, 1.9 * U], [b2, 0.9 * U]] as [number, number][]) {
      const pts = rectLine(inset);
      for (let k = 1; k < pts.length; k++) {
        const [ax, ay] = pts[k - 1]!, [bx, by] = pts[k]!;
        cv.shape((px, py) => dSeg(px, py, ax, ay, bx, by) - wdt, [Math.min(ax, bx) - 4, Math.min(ay, by) - 4, Math.max(ax, bx) + 4, Math.max(ay, by) + 4], C.ink, 0.85);
      }
    }
    for (const [cx, cy, sx, sy] of [[bw, bw, 1, 1], [W - bw, bw, -1, 1], [bw, H - bw, 1, -1], [W - bw, H - bw, -1, -1]] as [number, number, number, number][]) drawCorner(cv, cx, cy, sx, sy, U, C);

    // ---- out --------------------------------------------------------------------------------------------------------------------
    const picture = cv.raster();
    const files: [string, Uint8Array][] = [[`sprites/${name}.png`, encode(picture)]];
    for (const [i, sz] of (a.sizes ?? []).entries()) {
      const wh = typeof sz === "number" ? [Math.round(W * sz), Math.round(H * sz)] : sz;
      if (!Array.isArray(wh) || wh.length !== 2 || !(wh[0] >= 16 && wh[1] >= 16)) throw new Error(`sizes ${i} is [w, h] or a scale`);
      const small = shrink(picture, wh[0], wh[1]);
      files.push([`sprites/${name}_${small.w}x${small.h}.png`, encode(small)]);
    }
    const roadNames = named.map((r) => `${r.label} (${labels.filter((l) => l.kind === "road" && l.of === r.key).length})`);
    const text = [
      `${files.map(([f]) => f).join(", ")}: a ${W}x${H} paper map of scenes/${a.scene}.scene.json, ${(bx1 - bx0).toFixed(0)} x ${(bz1 - bz0).toFixed(0)} m at ${s.toFixed(2)} px a metre, north up (east is -x)${heights ? `, hills from ${tCfg!.heightmap} (${hmin.toFixed(1)} to ${hmax.toFixed(1)} m, contours every ${contour} m)` : ""}.`,
      `roads lettered: ${roadNames.join(", ") || "none named"}${missing.length ? `; NO ROOM for ${missing.map((r) => r.label).join(", ")} (a bigger size, a smaller label_size or fewer marks)` : ""}.`,
      `${trees.length} tree symbols, ${icons.length} icons (${[...new Set(icons.map((i) => i.icon))].join(", ") || "none"}), ${labels.filter((l) => l.kind === "place" || l.kind === "area" || l.kind === "water").length} other names. Words on it: ${[...new Set(labels.map((l) => l.text))].join(" | ")}.`,
      `Show it with nova.ui.sprite("${name}", x, y, { w = ${W}, h = ${H} }) (one texel a pixel is crispest). It marks nothing for the player: no position, no destination.`,
    ].join("\n");
    return { files, picture, text, labels };
  } finally {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  }
}

/// A box blur of radius r (px) along x then y, in place; the picture's edge is held.
function boxBlur(f: Float32Array, w: number, h: number, r: number) {
  const line = new Float32Array(Math.max(w, h));
  const run = (n: number, get: (k: number) => number, set: (k: number, v: number) => void) => {
    for (let k = 0; k < n; k++) line[k] = get(k);
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += line[clamp(k, 0, n - 1)]!;
    for (let k = 0; k < n; k++) {
      set(k, acc / (2 * r + 1));
      acc += line[clamp(k + r + 1, 0, n - 1)]! - line[clamp(k - r, 0, n - 1)]!;
    }
  };
  for (let y = 0; y < h; y++) run(w, (k) => f[y * w + k]!, (k, v) => (f[y * w + k] = v));
  for (let x = 0; x < w; x++) run(h, (k) => f[k * w + x]!, (k, v) => (f[k * w + x] = v));
}

const mix3 = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/// A smaller copy: each pixel the average of the area it covers.
function shrink(r: Raster, w: number, h: number): Raster {
  const data = new Uint8ClampedArray(w * h * 4);
  const kx = r.w / w, ky = r.h / h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const acc = [0, 0, 0, 0];
    let n = 0;
    const x0 = x * kx, x1 = (x + 1) * kx, y0 = y * ky, y1 = (y + 1) * ky;
    for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
      const wgt = (Math.min(x1, sx + 1) - Math.max(x0, sx)) * (Math.min(y1, sy + 1) - Math.max(y0, sy));
      if (wgt <= 0) continue;
      const o = (Math.min(r.h - 1, sy) * r.w + Math.min(r.w - 1, sx)) * 4;
      for (let k = 0; k < 4; k++) acc[k]! += r.data[o + k]! * wgt;
      n += wgt;
    }
    for (let k = 0; k < 4; k++) data[(y * w + x) * 4 + k] = Math.round(acc[k]! / n);
  }
  return { w, h, data };
}

// ---- drawing the words --------------------------------------------------------------------------------------------------------------
/// Words along a line (the piece of the line they cover, read left to right), their middle `off` px to its left, with a halo.
function drawRun(cv: Canvas, g: Words, path: P[], off: number, color: RGB, haloC: RGB, halo: number, weight: number) {
  const pts = resample(path, 1);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
  const L = cum[cum.length - 1]!, s0 = (L - g.w) / 2;
  // (the normal "up" for the words at each point: left of the way they read)
  const nrm = pts.map((_, i) => {
    const p = pts[Math.max(0, i - 4)]!, q = pts[Math.min(pts.length - 1, i + 4)]!, dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1;
    return [dy / l, -dx / l] as P;
  });
  const mid = g.ascent - g.cap / 2;
  const [bx0, by0, bx1, by1] = boxOf(pts, Math.abs(off) + g.h + halo + 4);
  const x0 = Math.max(0, Math.floor(bx0)), y0 = Math.max(0, Math.floor(by0)), x1 = Math.min(cv.w, Math.ceil(bx1)), y1 = Math.min(cv.h, Math.ceil(by1));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const qx = x + 0.5, qy = y + 0.5;
    // the nearest point of the line, measured from the words' own middle line
    let best = Infinity, bi = 0;
    for (let i = 0; i < pts.length; i += 2) {
      const cx = pts[i]![0] + nrm[i]![0] * off, cy = pts[i]![1] + nrm[i]![1] * off;
      const d = (cx - qx) ** 2 + (cy - qy) ** 2;
      if (d < best) (best = d, (bi = i));
    }
    for (let i = Math.max(0, bi - 2); i <= Math.min(pts.length - 1, bi + 2); i++) {
      const cx = pts[i]![0] + nrm[i]![0] * off, cy = pts[i]![1] + nrm[i]![1] * off;
      const d = (cx - qx) ** 2 + (cy - qy) ** 2;
      if (d < best) (best = d, (bi = i));
    }
    if (best > (g.h + halo + 2) ** 2) continue;
    const cx = pts[bi]![0] + nrm[bi]![0] * off, cy = pts[bi]![1] + nrm[bi]![1] * off;
    const n = (qx - cx) * nrm[bi]![0] + (qy - cy) * nrm[bi]![1];
    const tx = -nrm[bi]![1], ty = nrm[bi]![0];
    const along = cum[bi]! + (qx - cx) * tx + (qy - cy) * ty - s0;
    const v = mid - n;
    if (along < -halo - 3 || along > g.w + halo + 3) continue;
    const d = wordsDist(g, along, v) - weight;
    const i = y * cv.w + x;
    if (halo > 0) cv.over(i, haloC, clamp(0.5 - (d - halo), 0, 1) * 0.88);
    cv.over(i, color, clamp(0.5 - d, 0, 1));
  }
}
/// Words level, `x` their left, `y` their baseline, with a halo (none when haloC is null); `weight` px thicker.
function drawFlat(cv: Canvas, g: Words, x: number, y: number, color: RGB, haloC: RGB | null, halo: number, weight: number) {
  const top = y - g.ascent;
  const x0 = Math.max(0, Math.floor(x - halo - 3)), x1 = Math.min(cv.w, Math.ceil(x + g.w + halo + 3));
  const y0 = Math.max(0, Math.floor(top - halo - 3)), y1 = Math.min(cv.h, Math.ceil(top + g.h + halo + 3));
  for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) {
    const d = wordsDist(g, px + 0.5 - x, py + 0.5 - top) - weight, i = py * cv.w + px;
    if (haloC && halo > 0) cv.over(i, haloC, clamp(0.5 - (d - halo), 0, 1) * 0.88);
    cv.over(i, color, clamp(0.5 - d, 0, 1));
  }
}

// ---- the symbols ------------------------------------------------------------------------------------------------------------------
function drawTree(cv: Canvas, x: number, y: number, pine: boolean, k: number, U: number, C: Colours) {
  const sz = (8.5 + k * 3) * U;
  const green = k < 0.33 ? C.forest_dark : k < 0.8 ? C.forest : mix3(C.forest, C.forest_light, 0.6);
  const dark = mix3(green, C.ink, 0.45);
  // a soft shadow to the south-east, a trunk, the crown
  cv.shape((px, py) => Math.hypot((px - x - 2.2 * U) / 1.6, py - y - 0.8 * U) - sz * 0.22, [x - sz, y - sz, x + sz * 1.4, y + sz * 0.6], C.ink, 0.12);
  cv.shape((px, py) => dBox(px, py, x, y - sz * 0.05, 0.9 * U, sz * 0.18, 0.5), [x - 3, y - sz * 0.4, x + 3, y + sz * 0.3], C.trunk, 0.9);
  if (pine) {
    const tiers: P[][] = [];
    for (let t = 0; t < 2; t++) {
      const top = y - sz * (0.95 - t * 0.38), base = y - sz * (0.32 - t * 0.38), hw = sz * (0.32 + t * 0.12);
      tiers.push([[x, top], [x + hw, base], [x - hw, base]]);
    }
    for (const tri of tiers.reverse()) {
      const bb = boxOf(tri, 3);
      cv.shape((px, py) => dPoly(px, py, tri) - 0.6 * U, bb, green);
      // the shaded right half, and an inked edge
      cv.shape((px, py) => Math.max(dPoly(px, py, tri) - 0.6 * U, x + 0.3 - px), bb, dark, 0.45);
      cv.shape((px, py) => Math.abs(dPoly(px, py, tri) - 0.6 * U) - 0.45 * U, bb, dark, 0.7);
    }
  } else {
    const cy = y - sz * 0.55, r = sz * 0.4;
    const crown = (px: number, py: number) => Math.min(Math.hypot(px - x, py - cy) - r, Math.hypot(px - x - r * 0.55, py - cy - r * 0.25) - r * 0.7, Math.hypot(px - x + r * 0.55, py - cy - r * 0.25) - r * 0.7);
    const bb: [number, number, number, number] = [x - r * 1.5, cy - r * 1.3, x + r * 1.5, cy + r * 1.3];
    cv.shape(crown, bb, green);
    cv.shape((px, py) => Math.max(crown(px, py), -(Math.hypot(px - x + r * 0.35, py - cy + r * 0.35) - r * 0.9)), bb, dark, 0.4);
    cv.shape((px, py) => Math.abs(crown(px, py)) - 0.45 * U, bb, dark, 0.7);
  }
}

function drawIcon(cv: Canvas, ic: { icon: string; x: number; y: number; size: number }, U: number, C: Colours) {
  const { x, y } = ic, s = ic.size;
  const shadow = (w: number) => cv.shape((px, py) => Math.hypot((px - x - 2 * U) / 2.2, py - y - 1 * U) - w * 0.22, [x - w * 1.3, y - w * 0.5, x + w * 1.3, y + w * 0.5], C.ink, 0.14);
  const ink = (d: (px: number, py: number) => number, bb: [number, number, number, number], fill: RGB, line = 0.9 * U) => {
    cv.shape(d, bb, fill);
    cv.shape((px, py) => Math.abs(d(px, py)) - line, [bb[0] - 2, bb[1] - 2, bb[2] + 2, bb[3] + 2], C.ink, 0.95);
  };
  const house = (w: number, h: number, roof: RGB, walls: RGB, chimney: boolean) => {
    shadow(w);
    const top = y - h, eave = y - h * 0.55;
    ink((px, py) => dBox(px, py, x, (eave + y) / 2, w / 2, (y - eave) / 2, 1.2 * U), [x - w, eave - 2, x + w, y + 2], walls);
    if (chimney) ink((px, py) => dBox(px, py, x + w * 0.24, top + h * 0.2, w * 0.08, h * 0.16, 0.6 * U), [x, top - 4, x + w, eave], C.stone);
    const roofP: P[] = [[x - w * 0.62, eave + 1 * U], [x, top], [x + w * 0.62, eave + 1 * U]];
    ink((px, py) => dPoly(px, py, roofP) - 0.8 * U, boxOf(roofP, 3), roof);
    // a door and a window
    cv.shape((px, py) => dBox(px, py, x - w * 0.17, y - (y - eave) * 0.32, w * 0.09, (y - eave) * 0.3, 0.5 * U), [x - w, eave, x, y], C.wood_dark);
    cv.shape((px, py) => dBox(px, py, x + w * 0.2, y - (y - eave) * 0.55, w * 0.1, w * 0.1, 0.5 * U), [x, eave, x + w, y], C.water_dark, 0.9);
  };
  switch (ic.icon) {
    case "post_office": {
      house(s, s * 0.82, C.red, C.wall, false);
      // the flag: a pole and a red pennant; an envelope badge on the wall
      const fx = x - s * 0.62, ft = y - s * 1.12;
      cv.shape((px, py) => dSeg(px, py, fx, y, fx, ft) - 0.8 * U, [fx - 3, ft - 3, fx + 3, y + 2], C.ink);
      const flag: P[] = [[fx, ft], [fx - s * 0.36, ft + s * 0.1], [fx, ft + s * 0.2]];
      ink((px, py) => dPoly(px, py, flag), boxOf(flag, 3), C.red, 0.6 * U);
      const ex = x + s * 0.02, ey = y - s * 0.66, ew = s * 0.2, eh = s * 0.14;
      ink((px, py) => dBox(px, py, ex, ey, ew, eh, 1 * U), [ex - ew - 3, ey - eh - 3, ex + ew + 3, ey + eh + 3], [255, 250, 236], 0.8 * U);
      cv.shape((px, py) => Math.min(dSeg(px, py, ex - ew, ey - eh, ex, ey + eh * 0.2), dSeg(px, py, ex, ey + eh * 0.2, ex + ew, ey - eh)) - 0.55 * U, [ex - ew - 2, ey - eh - 2, ex + ew + 2, ey + eh + 2], C.red);
      break;
    }
    case "house":
      house(s, s * 0.85, C.roof, C.wood, true);
      break;
    case "shed":
      house(s, s * 0.8, C.slate, C.wood, false);
      break;
    case "barrier": {
      // a little sign on two legs: a striped board, red and white
      shadow(s);
      const top = y - s * 0.9, bh = s * 0.32;
      for (const lx of [x - s * 0.32, x + s * 0.32]) cv.shape((px, py) => dSeg(px, py, lx, y, lx, top + bh) - 0.9 * U, [lx - 3, top, lx + 3, y + 2], C.ink);
      const board = (px: number, py: number) => dBox(px, py, x, top + bh / 2, s * 0.55, bh / 2, 1 * U);
      cv.shape(board, [x - s, top - 2, x + s, top + bh + 2], [252, 246, 236]);
      cv.shape((px, py) => Math.max(board(px, py), Math.abs(((px - py + 1000) % (s * 0.3)) - s * 0.15) - s * 0.075), [x - s, top - 2, x + s, top + bh + 2], C.red);
      cv.shape((px, py) => Math.abs(board(px, py)) - 0.8 * U, [x - s, top - 3, x + s, top + bh + 3], C.ink);
      break;
    }
    case "picnic": {
      shadow(s);
      const top = y - s * 0.55;
      ink((px, py) => dBox(px, py, x, top, s * 0.55, s * 0.12, 0.8 * U), [x - s, top - s * 0.3, x + s, top + s * 0.3], C.wood);
      for (const lx of [x - s * 0.38, x + s * 0.38]) cv.shape((px, py) => dSeg(px, py, lx, top + s * 0.1, lx + (lx < x ? -1 : 1) * s * 0.08, y) - 0.9 * U, [lx - 4, top, lx + 4, y + 2], C.ink);
      ink((px, py) => dBox(px, py, x, y - s * 0.18, s * 0.5, s * 0.07, 0.6 * U), [x - s, y - s * 0.4, x + s, y], C.wood_dark, 0.6 * U);
      break;
    }
    case "bench": {
      shadow(s);
      ink((px, py) => dBox(px, py, x, y - s * 0.4, s * 0.55, s * 0.1, 0.6 * U), [x - s, y - s, x + s, y], C.wood, 0.7 * U);
      ink((px, py) => dBox(px, py, x, y - s * 0.75, s * 0.55, s * 0.09, 0.6 * U), [x - s, y - s * 1.2, x + s, y], C.wood, 0.7 * U);
      break;
    }
    case "viewpoint": {
      // a little telescope on a stand, looking out
      shadow(s);
      const top = y - s * 0.62;
      for (const dx of [-0.3, 0, 0.3]) cv.shape((px, py) => dSeg(px, py, x, top, x + dx * s, y) - 0.8 * U, [x - s, top - 2, x + s, y + 2], C.ink);
      const tube: P[] = [[x - s * 0.45, top - s * 0.02], [x + s * 0.45, top - s * 0.32], [x + s * 0.5, top - s * 0.18], [x - s * 0.4, top + s * 0.12]];
      ink((px, py) => dPoly(px, py, tube) - 0.6 * U, boxOf(tube, 3), C.mustard, 0.8 * U);
      break;
    }
    case "mast": {
      // a radio mast: a tall thin lattice and a light on top, unlabelled
      shadow(s * 0.6);
      const top = y - s, hw = s * 0.16;
      const legs: [number, number, number, number][] = [[x - hw, y, x, top], [x + hw, y, x, top]];
      for (const [ax, ay, bx, by] of legs) cv.shape((px, py) => dSeg(px, py, ax, ay, bx, by) - 0.75 * U, [x - hw - 3, top - 3, x + hw + 3, y + 2], C.ink);
      for (let k = 1; k < 5; k++) {
        const t0 = k / 5, t1 = (k + 1) / 5, wa = hw * (1 - t0), wb = hw * (1 - Math.min(1, t1));
        const ya = y - s * t0, yb = y - s * Math.min(1, t1);
        cv.shape((px, py) => Math.min(dSeg(px, py, x - wa, ya, x + wb, yb), dSeg(px, py, x + wa, ya, x - wb, yb)) - 0.4 * U, [x - hw - 2, top - 2, x + hw + 2, y + 2], C.ink, 0.8);
      }
      cv.shape((px, py) => Math.hypot(px - x, py - top) - 2 * U, [x - 5, top - 5, x + 5, top + 5], C.red);
      break;
    }
  }
}

function drawBridge(cv: Canvas, ic: { icon: string; x: number; y: number; ry: number; a?: P; b?: P }, s: number, U: number, C: Colours, roads: { px: P[]; half: number }[], field: Field) {
  let a = ic.a, b = ic.b;
  if (!a || !b) {
    const len = 9 * s;
    // (along the object's turn: its +x on the ground is (cos ry, -sin ry) in x, z, which on the map is (-cos ry, sin ry) in px)
    const dx = -Math.cos(ic.ry), dy = Math.sin(ic.ry);
    a = [ic.x - dx * len, ic.y - dy * len];
    b = [ic.x + dx * len, ic.y + dy * len];
  }
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l, nx = -uy, ny = ux;
  // the width: the road under it (or a lane's)
  const mx = Math.round((a[0] + b[0]) / 2), my = Math.round((a[1] + b[1]) / 2);
  const tag = field.at(mx, my) < 0 ? field.tag[my * field.w + mx]! : -1;
  const hw = (tag >= 0 ? roads[tag]!.half : 5 * U) + 2.5 * U;
  const broken = ic.icon === "broken_bridge";
  const L = broken ? l * 0.35 : l;
  const deck: P[] = [[a[0] + nx * hw, a[1] + ny * hw], [a[0] + ux * L + nx * hw, a[1] + uy * L + ny * hw], [a[0] + ux * L - nx * hw, a[1] + uy * L - ny * hw], [a[0] - nx * hw, a[1] - ny * hw]];
  if (broken) {
    // a jagged end where it fell
    const e: P = [a[0] + ux * L, a[1] + uy * L];
    deck.splice(2, 0, [e[0] + ux * 4 * U, e[1] + uy * 4 * U], [e[0] - ux * 2 * U - nx * hw * 0.3, e[1] - uy * 2 * U - ny * hw * 0.3], [e[0] + ux * 3 * U - nx * hw * 0.6, e[1] + uy * 3 * U - ny * hw * 0.6]);
  }
  const bb = boxOf(deck, 6);
  cv.shape((px, py) => dPoly(px, py, deck) - 0.5, bb, C.wood);
  // planks across it
  for (let t = 3 * U; t < L - 1; t += 3.2 * U) {
    const cx = a[0] + ux * t, cy = a[1] + uy * t;
    cv.shape((px, py) => Math.max(dSeg(px, py, cx - nx * hw, cy - ny * hw, cx + nx * hw, cy + ny * hw) - 0.45 * U, dPoly(px, py, deck)), bb, C.wood_dark, 0.7);
  }
  // the rails, with a post at each end, inked
  for (const side of [1, -1]) {
    const ra: P = [a[0] + nx * hw * side - ux * 2 * U, a[1] + ny * hw * side - uy * 2 * U], rb: P = [a[0] + ux * (L + (broken ? -2 : 2) * U) + nx * hw * side, a[1] + uy * (L + (broken ? -2 : 2) * U) + ny * hw * side];
    cv.shape((px, py) => dSeg(px, py, ra[0], ra[1], rb[0], rb[1]) - 1.1 * U, bb, C.ink);
    for (const p of broken ? [ra] : [ra, rb]) cv.shape((px, py) => Math.hypot(px - p[0], py - p[1]) - 1.9 * U, [p[0] - 5, p[1] - 5, p[0] + 5, p[1] + 5], C.ink);
  }
}

function drawWall(cv: Canvas, ic: { x: number; y: number; ry: number }, s: number, U: number, C: Colours) {
  // a dry-stone wall, 4 m along its own x: a short chain of grey stones
  const half = 2 * s, dx = -Math.cos(ic.ry), dy = Math.sin(ic.ry);
  const n = Math.max(2, Math.round((half * 2) / (3 * U)));
  for (let k = 0; k <= n; k++) {
    const t = -half + (2 * half * k) / n, x = ic.x + dx * t, y = ic.y + dy * t, r = (1.5 + ((k * 7) % 3) * 0.25) * U;
    cv.shape((px, py) => Math.hypot(px - x, (py - y) * 1.15) - r, [x - 5, y - 5, x + 5, y + 5], C.stone);
    cv.shape((px, py) => Math.abs(Math.hypot(px - x, (py - y) * 1.15) - r) - 0.4 * U, [x - 5, y - 5, x + 5, y + 5], C.ink, 0.65);
  }
}

function drawCompass(cv: Canvas, x: number, y: number, r: number, U: number, C: Colours) {
  const ring = (rr: number, w: number, a = 1) => cv.shape((px, py) => Math.abs(Math.hypot(px - x, py - y) - rr) - w, [x - rr - 4, y - rr - 4, x + rr + 4, y + rr + 4], C.ink, a);
  cv.shape((px, py) => Math.hypot(px - x, py - y) - r * 0.78, [x - r, y - r, x + r, y + r], mix3(C.paper, [255, 252, 242], 0.5), 0.8);
  ring(r * 0.78, 0.9 * U);
  ring(r * 0.7, 0.45 * U, 0.7);
  // the points: four long, four short; each half light, half dark, as if lit from the north-west
  const point = (an: number, len: number, wide: number, light: RGB, dark: RGB) => {
    const ux = Math.sin(an), uy = -Math.cos(an), nx = -uy, ny = ux;
    const tip: P = [x + ux * len, y + uy * len];
    const l: P[] = [[x, y], tip, [x + nx * wide, y + ny * wide]], rt: P[] = [[x, y], tip, [x - nx * wide, y - ny * wide]];
    cv.shape((px, py) => dPoly(px, py, l), boxOf(l, 3), light);
    cv.shape((px, py) => dPoly(px, py, rt), boxOf(rt, 3), dark);
    cv.shape((px, py) => Math.min(Math.abs(dPoly(px, py, l)), Math.abs(dPoly(px, py, rt))) - 0.5 * U, boxOf([...l, ...rt], 3), C.ink, 0.9);
  };
  for (let k = 0; k < 4; k++) point(Math.PI / 4 + (k * Math.PI) / 2, r * 0.62, r * 0.11, mix3(C.paper, [255, 255, 255], 0.5), mix3(C.faint, C.paper, 0.3));
  for (let k = 0; k < 4; k++) point((k * Math.PI) / 2, r * (k === 0 ? 1.0 : 0.88), r * 0.17, k === 0 ? C.red : [252, 246, 234], k === 0 ? mix3(C.red, C.ink, 0.35) : C.ink);
  cv.shape((px, py) => Math.hypot(px - x, py - y) - 2.4 * U, [x - 6, y - 6, x + 6, y + 6], C.mustard);
  cv.shape((px, py) => Math.abs(Math.hypot(px - x, py - y) - 2.4 * U) - 0.5 * U, [x - 6, y - 6, x + 6, y + 6], C.ink);
}

function drawCorner(cv: Canvas, x: number, y: number, sx: number, sy: number, U: number, C: Colours) {
  // a small diamond on the corner and a curl along each side
  const r = 7 * U;
  const dia: P[] = [[x, y - r], [x + r, y], [x, y + r], [x - r, y]];
  cv.shape((px, py) => dPoly(px, py, dia), boxOf(dia, 3), C.red, 0.95);
  cv.shape((px, py) => Math.abs(dPoly(px, py, dia)) - 0.8 * U, boxOf(dia, 4), C.ink);
  cv.shape((px, py) => Math.hypot(px - x, py - y) - 1.8 * U, [x - 4, y - 4, x + 4, y + 4], [255, 248, 230]);
  for (const [dx, dy] of [[sx, 0], [0, sy]] as P[]) {
    const cx = x + dx * r * 2.6, cy = y + dy * r * 2.6;
    const arc = (px: number, py: number) => {
      const d = Math.abs(Math.hypot(px - cx, py - cy) - r * 0.9) - 0.7 * U;
      // (only the half of the ring away from the frame's line)
      const side = dx ? (py - cy) * sy : (px - cx) * sx;
      return side < 0 ? Math.max(d, 0.6) : d;
    };
    cv.shape(arc, [cx - r * 1.4, cy - r * 1.4, cx + r * 1.4, cy + r * 1.4], C.ink, 0.85);
    cv.shape((px, py) => Math.hypot(px - cx - (dy ? r * 0.9 * sx : 0), py - cy - (dx ? r * 0.9 * sy : 0)) - 1.4 * U, [cx - r * 2, cy - r * 2, cx + r * 2, cy + r * 2], C.ink, 0.85);
  }
}
