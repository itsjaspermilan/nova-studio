// Selections for the sprite editor: a mask the size of the picture, with one byte per pixel (1 = selected). Rectangles, ellipses, free-hand shapes
// (lasso) and colour picks (magic wand) all make masks, which can be added to, taken from, inverted, grown and shrunk, and used to cut, move,
// copy and apply effects to just those pixels.

import { CLEAR, cloneRaster, getPixel, newRaster, setPixel, type Point, type Raster, type Rect, type Rgba } from "./pixels";

export interface Mask {
  w: number;
  h: number;
  /// w * h bytes, row by row; 1 selected, 0 not.
  bits: Uint8Array;
}

export type Combine = "replace" | "add" | "subtract" | "intersect";

export const emptyMask = (w: number, h: number): Mask => ({ w, h, bits: new Uint8Array(w * h) });
export const has = (m: Mask, x: number, y: number) => x >= 0 && y >= 0 && x < m.w && y < m.h && m.bits[y * m.w + x] === 1;
const set = (m: Mask, x: number, y: number, v = 1) => {
  if (x >= 0 && y >= 0 && x < m.w && y < m.h) m.bits[y * m.w + x] = v;
};
export const countOf = (m: Mask) => m.bits.reduce((n, b) => n + b, 0);
export const isEmpty = (m: Mask) => countOf(m) === 0;

export function maskFromRect(r: Rect, w: number, h: number): Mask {
  const m = emptyMask(w, h);
  for (let y = Math.max(0, r.y); y < Math.min(h, r.y + r.h); y++) for (let x = Math.max(0, r.x); x < Math.min(w, r.x + r.w); x++) set(m, x, y);
  return m;
}

/// The ellipse that fits in the box between two corner cells (inclusive): a cell is in when its middle is inside the curve.
export function maskFromEllipse(a: Point, b: Point, w: number, h: number): Mask {
  const m = emptyMask(w, h);
  const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x) + 1];
  const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y) + 1];
  const [cx, cy, rx, ry] = [(x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const [dx, dy] = [(x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry];
    if (dx * dx + dy * dy <= 1) set(m, x, y);
  }
  return m;
}

/// The area inside a free-hand outline (the points are cells; the shape is closed from the last point to the first): a cell is in when its middle
/// is inside, by the even-odd rule.
export function maskFromPolygon(points: Point[], w: number, h: number): Mask {
  const m = emptyMask(w, h);
  if (points.length === 0) return m;
  if (points.length < 3) {
    for (const p of points) set(m, p.x, p.y);
    return m;
  }
  for (let y = 0; y < h; y++) {
    const yy = y + 0.5;
    const crossings: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const [p, q] = [points[i]!, points[(i + 1) % points.length]!];
      const [py, qy] = [p.y + 0.5, q.y + 0.5];
      if ((py <= yy && qy > yy) || (qy <= yy && py > yy)) crossings.push(p.x + 0.5 + ((yy - py) / (qy - py)) * (q.x - p.x));
    }
    crossings.sort((u, v) => u - v);
    for (let i = 0; i + 1 < crossings.length; i += 2) for (let x = Math.ceil(crossings[i]! - 0.5); x < crossings[i + 1]! - 0.5 + 1e-9; x++) set(m, x, y);
    // the outline itself is part of the shape
  }
  for (let i = 0; i < points.length; i++) {
    const [p, q] = [points[i]!, points[(i + 1) % points.length]!];
    const n = Math.max(Math.abs(q.x - p.x), Math.abs(q.y - p.y));
    for (let k = 0; k <= n; k++) set(m, Math.round(p.x + ((q.x - p.x) * k) / (n || 1)), Math.round(p.y + ((q.y - p.y) * k) / (n || 1)));
  }
  return m;
}

/// How far apart two colours are, 0 (the same) to 255 (the furthest), counting every channel including alpha.
export function colorDistance(a: Rgba, b: Rgba): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]), Math.abs(a[3] - b[3]));
}

/// The magic wand: the cells whose colour is within `tolerance` of the one clicked, joined to it (`contiguous`) or anywhere in the picture.
export function maskFromColor(r: Raster, x: number, y: number, tolerance: number, contiguous: boolean): Mask {
  const m = emptyMask(r.w, r.h);
  const target = getPixel(r, x, y);
  if (!target) return m;
  const near = (px: number, py: number) => {
    const c = getPixel(r, px, py);
    // (every empty pixel is the same colour, whatever its hidden colour channels hold)
    if (!c) return false;
    if (c[3] === 0 && target[3] === 0) return true;
    return colorDistance(c, target) <= tolerance;
  };
  if (!contiguous) {
    for (let py = 0; py < r.h; py++) for (let px = 0; px < r.w; px++) if (near(px, py)) set(m, px, py);
    return m;
  }
  const stack: [number, number][] = [[x, y]];
  while (stack.length) {
    const [px, py] = stack.pop()!;
    if (has(m, px, py) || !near(px, py)) continue;
    set(m, px, py);
    stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
  }
  return m;
}

/// Combines a new shape with the selection there was: replace it, add to it, take from it, or keep only where both are.
export function combine(base: Mask | null, shape: Mask, how: Combine): Mask {
  if (!base || how === "replace") return shape;
  const out = emptyMask(base.w, base.h);
  for (let i = 0; i < out.bits.length; i++) {
    const [a, b] = [base.bits[i]!, shape.bits[i]!];
    out.bits[i] = how === "add" ? (a | b) : how === "subtract" ? (a & (1 - b)) : (a & b);
  }
  return out;
}

export function invertMask(m: Mask): Mask {
  const out = emptyMask(m.w, m.h);
  for (let i = 0; i < out.bits.length; i++) out.bits[i] = 1 - m.bits[i]!;
  return out;
}

/// The selection made `by` cells bigger (above 0) or smaller (below 0), one cell at a time, through the four sides.
export function growMask(m: Mask, by: number): Mask {
  let cur = m;
  for (let k = 0; k < Math.abs(by); k++) {
    const out = emptyMask(m.w, m.h);
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      const around = [has(cur, x, y), has(cur, x + 1, y), has(cur, x - 1, y), has(cur, x, y + 1), has(cur, x, y - 1)];
      // (an edge of the picture counts as selected when shrinking, so a selection touching the edge does not eat into it)
      const on = by > 0 ? around.some(Boolean) : has(cur, x, y) && [x + 1, x - 1].every((px) => px < 0 || px >= m.w || has(cur, px, y)) && [y + 1, y - 1].every((py) => py < 0 || py >= m.h || has(cur, x, py));
      if (on) set(out, x, y);
    }
    cur = out;
  }
  return cur;
}

/// The smallest rectangle round the selection, or null when nothing is selected.
export function boundsOf(m: Mask): Rect | null {
  let [x0, y0, x1, y1] = [m.w, m.h, -1, -1];
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    if (m.bits[y * m.w + x] !== 1) continue;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/// Whether a mask is exactly a rectangle (so a selection can be shown and moved the simple way).
export function isRect(m: Mask): boolean {
  const b = boundsOf(m);
  return !!b && countOf(m) === b.w * b.h;
}

/// The selected pixels cut out: a piece the size of the selection's bounds holding them (everything else transparent), its mask in the same
/// size, and the picture with those pixels cleared.
export function liftMasked(r: Raster, m: Mask): { piece: Raster; pieceMask: Mask; rest: Raster; bounds: Rect } | null {
  const bounds = boundsOf(m);
  if (!bounds) return null;
  const piece = newRaster(bounds.w, bounds.h);
  const pieceMask = emptyMask(bounds.w, bounds.h);
  const rest = cloneRaster(r);
  for (let y = 0; y < bounds.h; y++) for (let x = 0; x < bounds.w; x++) {
    const [px, py] = [bounds.x + x, bounds.y + y];
    if (!has(m, px, py)) continue;
    setPixel(piece, x, y, getPixel(r, px, py) ?? CLEAR);
    setPixel(rest, px, py, CLEAR);
    set(pieceMask, x, y);
  }
  return { piece, pieceMask, rest, bounds };
}

/// A mask moved by (dx, dy), clipped to the picture.
export function shiftMask(m: Mask, dx: number, dy: number): Mask {
  const out = emptyMask(m.w, m.h);
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (has(m, x, y)) set(out, x + dx, y + dy);
  return out;
}

/// A small mask (the shape of a piece) placed in a picture-sized one at (x, y).
export function placeMask(piece: Mask, w: number, h: number, x: number, y: number): Mask {
  const out = emptyMask(w, h);
  for (let py = 0; py < piece.h; py++) for (let px = 0; px < piece.w; px++) if (has(piece, px, py)) set(out, x + px, y + py);
  return out;
}

/// The cell edges that run along the selection's outline, as [x1, y1, x2, y2] segments in cell corners, for drawing marching ants.
export function outlineSegments(m: Mask): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    if (!has(m, x, y)) continue;
    if (!has(m, x, y - 1)) out.push([x, y, x + 1, y]);
    if (!has(m, x, y + 1)) out.push([x, y + 1, x + 1, y + 1]);
    if (!has(m, x - 1, y)) out.push([x, y, x, y + 1]);
    if (!has(m, x + 1, y)) out.push([x + 1, y, x + 1, y + 1]);
  }
  return out;
}

/// A selection painted with a square brush `size` cells across: every cell a stamp along the points touches (the points are joined, so a quick drag leaves no gaps).
export function maskFromStroke(points: Point[], size: number, w: number, h: number): Mask {
  const m = emptyMask(w, h);
  const s = Math.max(1, Math.round(size));
  const stamp = (p: Point) => {
    const x0 = p.x - Math.floor((s - 1) / 2);
    const y0 = p.y - Math.floor((s - 1) / 2);
    for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) set(m, x, y);
  };
  points.forEach((p, i) => {
    if (i === 0) return stamp(p);
    const a = points[i - 1]!;
    const steps = Math.max(Math.abs(p.x - a.x), Math.abs(p.y - a.y));
    for (let k = 1; k <= steps; k++) stamp({ x: Math.round(a.x + ((p.x - a.x) * k) / steps), y: Math.round(a.y + ((p.y - a.y) * k) / steps) });
  });
  if (points.length === 1) stamp(points[0]!);
  return m;
}
