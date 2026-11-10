// Brushes beyond the square one: round and diamond shapes, a shading brush that lightens or darkens what it passes over (shifting the hue a little
// the way pixel artists do, so shadows go cool and highlights warm), and a gradient between two colours, optionally dithered with a fixed pattern.

import { getPixel, setPixel, type Point, type Raster, type Rect, type Rgba } from "./pixels";
import { hslToRgb, rgbToHsl } from "./sprite-fx";

export type BrushShape = "square" | "round" | "diamond";
export const BRUSH_SHAPES: BrushShape[] = ["square", "round", "diamond"];

/// The cells a brush covers, relative to the point it is at: a block of `size` (centred as well as an even size allows, as `stamp` does), a disc,
/// or a diamond.
export function brushOffsets(size: number, shape: BrushShape): Point[] {
  const s = Math.max(1, Math.round(size));
  const start = -Math.floor((s - 1) / 2);
  const centre = start + (s - 1) / 2;
  const out: Point[] = [];
  for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) {
    const [ox, oy] = [start + dx, start + dy];
    if (shape === "round") {
      const [ux, uy] = [(ox - centre) / (s / 2), (oy - centre) / (s / 2)];
      if (ux * ux + uy * uy > 1.0001) continue;
    } else if (shape === "diamond") {
      const r = s / 2;
      if (Math.abs(ox - centre) + Math.abs(oy - centre) > r - 0.001 + (s % 2 ? 0.5 : 0)) continue;
    }
    out.push({ x: ox, y: oy });
  }
  // (a one-pixel brush is always its pixel)
  return out.length ? out : [{ x: 0, y: 0 }];
}

/// A brush of any shape, drawn at a point.
export function stampBrush(r: Raster, x: number, y: number, size: number, shape: BrushShape, c: Rgba) {
  for (const o of brushOffsets(size, shape)) setPixel(r, x + o.x, y + o.y, c);
}

/// A colour made lighter (amount > 0) or darker (< 0): the lightness moves by the amount and the hue turns a little towards yellow when lightening
/// and towards blue when darkening, so shaded areas keep their life. Amount is from -1 to 1; alpha is kept.
export function shadeColor(c: Rgba, amount: number): Rgba {
  const [h, s, l] = rgbToHsl(c[0], c[1], c[2]);
  const k = Math.max(-1, Math.min(1, amount));
  const target = k >= 0 ? 60 / 360 : 240 / 360;
  // turn the short way round the wheel towards the target by a tenth of the amount
  let d = target - h;
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  const nh = (((h + d * Math.abs(k) * 0.25) % 1) + 1) % 1;
  const nl = Math.max(0, Math.min(1, l + k * 0.2));
  const [r, g, b] = hslToRgb(nh, s, nl);
  return [r, g, b, c[3]];
}

/// Shades the visible pixels under a brush (empty pixels stay empty).
export function shadeStamp(r: Raster, x: number, y: number, size: number, shape: BrushShape, amount: number) {
  for (const o of brushOffsets(size, shape)) {
    const c = getPixel(r, x + o.x, y + o.y);
    if (c && c[3] > 0) setPixel(r, x + o.x, y + o.y, shadeColor(c, amount));
  }
}

export type Dither = "none" | "bayer2" | "bayer4" | "checker";
export const DITHERS: Dither[] = ["none", "bayer2", "bayer4", "checker"];

const BAYER2 = [[0, 2], [3, 1]];
const BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

/// The threshold (0 to 1) a pixel's gradient position must pass to take the second colour, for a dither pattern. "none" is a hard 0.5 split of
/// nothing: the gradient is smooth (no dither), which this signals with -1.
export function ditherThreshold(mode: Dither, x: number, y: number): number {
  switch (mode) {
    case "bayer2":
      return (BAYER2[y & 1]![x & 1]! + 0.5) / 4;
    case "bayer4":
      return (BAYER4[y & 3]![x & 3]! + 0.5) / 16;
    case "checker":
      return ((x + y) & 1) === 0 ? 0.25 : 0.75;
    default:
      return -1;
  }
}

const mix = (a: Rgba, b: Rgba, t: number): Rgba => [0, 1, 2, 3].map((i) => Math.round(a[i]! + (b[i]! - a[i]!) * t)) as Rgba;

/// A straight gradient from colour `from` at point `a` to colour `to` at point `b` over a picture's pixels (all of them, or inside `area`, or only
/// the cells where `has` says). Without dithering every pixel gets the mixed colour; with it each pixel takes one end colour or the other by the
/// pattern, which keeps the palette to two colours. Returns a new raster.
export function gradientFill(r: Raster, a: Point, b: Point, from: Rgba, to: Rgba, dither: Dither, area: (Rect & { has?: (x: number, y: number) => boolean }) | null = null): Raster {
  const out = { w: r.w, h: r.h, data: new Uint8ClampedArray(r.data) } as Raster;
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const len2 = dx * dx + dy * dy;
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    if (area && !(x >= area.x && y >= area.y && x < area.x + area.w && y < area.y + area.h && (!area.has || area.has(x, y)))) continue;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
    const th = ditherThreshold(dither, x, y);
    setPixel(out, x, y, th < 0 ? mix(from, to, t) : t > th ? to : from);
  }
  return out;
}

/// A brush cut from a picture: the visible pixels of a piece (its colours stay), stamped with its middle on the pointer.
export interface PictureBrush {
  w: number;
  h: number;
  cells: { dx: number; dy: number; color: Rgba }[];
}

export function brushFromRaster(piece: Raster, has?: (x: number, y: number) => boolean): PictureBrush | null {
  const cells: PictureBrush["cells"] = [];
  const cx = Math.floor(piece.w / 2);
  const cy = Math.floor(piece.h / 2);
  for (let y = 0; y < piece.h; y++) {
    for (let x = 0; x < piece.w; x++) {
      const i = (y * piece.w + x) * 4;
      if (piece.data[i + 3] === 0 || (has && !has(x, y))) continue;
      cells.push({ dx: x - cx, dy: y - cy, color: [piece.data[i]!, piece.data[i + 1]!, piece.data[i + 2]!, piece.data[i + 3]!] });
    }
  }
  return cells.length ? { w: piece.w, h: piece.h, cells } : null;
}

/// Stamps a picture brush with its middle at (x, y); with `color` given every cell takes that colour instead (a shape brush).
export function stampPicture(r: Raster, x: number, y: number, b: PictureBrush, color?: Rgba) {
  for (const c of b.cells) setPixel(r, x + c.dx, y + c.dy, color ?? c.color);
}
