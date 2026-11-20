// What every tile maker shares (tileset.ts, city-tiles.ts): a terrain's and a prop's recipe, the drawing context, and the
// helpers that keep the light and the shadows the same everywhere.

import { E, SE, SW, W } from "../../src/lib/autotile";
import type { Palette } from "./palettes";
import { hash2, Img, rngOf, seedOf, SHADOW, type Ramp, type Rgba } from "./paint";

export interface Shape {
  /// How far inside the cell the terrain starts at an open side (what lies beside it shows in that rim), pixels.
  inset: number;
  /// How round an outer corner is.
  round: number;
  /// How far the edge wanders in and out, pixels (0 is a straight edge).
  wobble: number;
}

export interface Probe {
  /// How deep inside the terrain this pixel is: 0 is the outermost pixel, below 0 is outside.
  d: number;
  /// Which way the nearest open edge faces (-1, 0 or 1 each).
  nx: number;
  ny: number;
}

export interface TerrainKind {
  name: string;
  what: string;
  solid: boolean;
  shape: Shape;
  variants: number;
  /// The ground texture of variant v (a whole tile).
  texture: (c: Ctx, v: number) => Img;
  /// One pixel of a joining tile: the texture's colour there, or what the edge makes of it; null is see-through.
  edge: (c: Ctx, p: Probe, mask: number, x: number, y: number, tex: Rgba) => Rgba | null;
}

export interface Ctx {
  t: number;
  /// How many times bigger than 16 the tile is.
  k: number;
  P: Palette;
  seed: number;
}

export const lightSide = (p: Probe) => p.ny < 0 || (p.ny === 0 && p.nx < 0); // an edge that faces up or left

export function speckle(c: Ctx, name: string, v: number, base: Rgba, marks: (img: Img, rng: () => number, at: () => [number, number]) => void): Img {
  const img = new Img(c.t, c.t);
  img.rect(0, 0, c.t, c.t, base);
  const rng = rngOf(seedOf(`${name}/${v}`) + c.seed);
  // marks stay a pixel inside the tile, so nothing is cut at a seam
  const at = (): [number, number] => [1 + Math.floor(rng() * (c.t - 3)), 2 + Math.floor(rng() * (c.t - 4))];
  marks(img, rng, at);
  return img;
}

export const times = (n: number, fn: (i: number) => void) => {
  for (let i = 0; i < Math.round(n); i++) fn(i);
};

/// On a face (a wall's, a cliff's): the column where the face stops because the ground beside it carries on towards us.

export const faceEnds = (mask: number, x: number, t: number): boolean => (x === 0 && !!(mask & W) && !!(mask & SW)) || (x === t - 1 && !!(mask & E) && !!(mask & SE));

export interface PropKind {
  name: string;
  what: string;
  /// Size in tiles; the cell a map names is the bottom row's `anchor` column.
  w: number;
  h: number;
  anchor: number;
  solid: boolean;
  /// Every tile of the bottom row is solid (a stall two tiles wide), not only the anchor.
  solidRow?: boolean;
  variants: number;
  draw: (c: Ctx, v: number) => Img;
}

/// A lump with light from the top left: a base colour, lighter towards the top left and darker towards the bottom right,
/// in steps, with a broken edge between the steps so it does not look like rings.
export function lump(img: Img, cx: number, cy: number, rx: number, ry: number, r: Ramp, seed: number) {
  img.ellipse(cx, cy, rx, ry, (x, y) => {
    const u = (x - cx) / rx, v = (y - cy) / ry;
    const lightness = -(u * 0.55 + v * 0.8) + (hash2(x, y, seed) - 0.5) * 0.35;
    return lightness > 0.62 ? r[4] : lightness > 0.22 ? r[3] : lightness > -0.3 ? r[2] : lightness > -0.68 ? r[1] : r[0];
  });
}

/// A terrain that stands on the ground and joins along its length (a fence, a rail, a lit strip in the floor): sixteen
/// tiles, by which of its four sides (1 north, 2 east, 4 south, 8 west) have more of it.
export interface EdgeKind {
  name: string;
  what: string;
  solid: boolean;
  tile: (c: Ctx, mask: number) => Img;
}

/// A picture drawn at 16 pixels a tile made `k` times larger, pixel by pixel (what the city's tiles are drawn at).
export function up(img: Img, k: number): Img {
  if (k === 1) return img;
  const out = new Img(Math.round(img.w * k), Math.round(img.h * k));
  for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) {
    const c = img.get(Math.floor(x / k), Math.floor(y / k));
    if (c) out.r.data.set(c, (y * out.w + x) * 4);
  }
  return out;
}

export function ground(img: Img, cx: number, y: number, rx: number) {
  img.ellipse(cx, y, rx, 1.6, SHADOW);
}
