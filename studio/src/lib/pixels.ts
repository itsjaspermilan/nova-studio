// Pixel buffers and the drawing tools. Everything here is pure: no canvas, no DOM.

export type Rgba = [number, number, number, number];
export interface Raster {
  w: number;
  h: number;
  /// RGBA, row by row, 4 bytes per pixel.
  data: Uint8ClampedArray;
}
export interface Point {
  x: number;
  y: number;
}

export const CLEAR: Rgba = [0, 0, 0, 0];

export function newRaster(w: number, h: number): Raster {
  return { w, h, data: new Uint8ClampedArray(w * h * 4) };
}

export function cloneRaster(r: Raster): Raster {
  return { w: r.w, h: r.h, data: new Uint8ClampedArray(r.data) };
}

export const inside = (r: Raster, x: number, y: number) => x >= 0 && y >= 0 && x < r.w && y < r.h;

export function getPixel(r: Raster, x: number, y: number): Rgba | null {
  if (!inside(r, x, y)) return null;
  const i = (y * r.w + x) * 4;
  return [r.data[i]!, r.data[i + 1]!, r.data[i + 2]!, r.data[i + 3]!];
}

export function setPixel(r: Raster, x: number, y: number, c: Rgba) {
  if (!inside(r, x, y)) return;
  const i = (y * r.w + x) * 4;
  r.data[i] = c[0];
  r.data[i + 1] = c[1];
  r.data[i + 2] = c[2];
  r.data[i + 3] = c[3];
}

const same = (a: Rgba, b: Rgba) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];

/// A square brush of `size` pixels, centred as well as an even size allows (extra pixel goes right/down).
export function stamp(r: Raster, x: number, y: number, size: number, c: Rgba) {
  const start = -Math.floor((size - 1) / 2);
  for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) setPixel(r, x + start + dx, y + start + dy, c);
}

/// Pixels on the straight line between two points, ends included (Bresenham).
export function linePoints(a: Point, b: Point): Point[] {
  const points: Point[] = [];
  let { x, y } = a;
  const dx = Math.abs(b.x - x);
  const dy = -Math.abs(b.y - y);
  const sx = x < b.x ? 1 : -1;
  const sy = y < b.y ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    points.push({ x, y });
    if (x === b.x && y === b.y) return points;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

export function drawLine(r: Raster, a: Point, b: Point, size: number, c: Rgba) {
  for (const p of linePoints(a, b)) stamp(r, p.x, p.y, size, c);
}

export function drawRect(r: Raster, a: Point, b: Point, size: number, c: Rgba, filled: boolean) {
  const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  if (filled) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setPixel(r, x, y, c);
    return;
  }
  drawLine(r, { x: x0, y: y0 }, { x: x1, y: y0 }, size, c);
  drawLine(r, { x: x0, y: y1 }, { x: x1, y: y1 }, size, c);
  drawLine(r, { x: x0, y: y0 }, { x: x0, y: y1 }, size, c);
  drawLine(r, { x: x1, y: y0 }, { x: x1, y: y1 }, size, c);
}

/// An ellipse that fits the box between two corners.
export function drawEllipse(r: Raster, a: Point, b: Point, size: number, c: Rgba, filled: boolean) {
  const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = (x1 - x0) / 2 + 0.5;
  const ry = (y1 - y0) / 2 + 0.5;
  const inEllipse = (x: number, y: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inEllipse(x, y)) continue;
      // The outline is the inside pixels that touch the outside.
      const edge = !inEllipse(x - 1, y) || !inEllipse(x + 1, y) || !inEllipse(x, y - 1) || !inEllipse(x, y + 1);
      if (filled || edge) stamp(r, x, y, filled ? 1 : size, c);
    }
  }
}

/// Replaces the connected area of one exact colour (4-way). Returns how many pixels changed.
export function floodFill(r: Raster, x: number, y: number, c: Rgba): number {
  const target = getPixel(r, x, y);
  if (!target || same(target, c)) return 0;
  const stack: number[] = [x, y];
  let changed = 0;
  while (stack.length) {
    const py = stack.pop()!;
    const px = stack.pop()!;
    const here = getPixel(r, px, py);
    if (!here || !same(here, target)) continue;
    // Walk the whole row segment, then queue the rows above and below.
    let left = px;
    while (left > 0 && same(getPixel(r, left - 1, py)!, target)) left--;
    let right = px;
    while (right < r.w - 1 && same(getPixel(r, right + 1, py)!, target)) right++;
    for (let i = left; i <= right; i++) {
      setPixel(r, i, py, c);
      changed++;
      for (const ny of [py - 1, py + 1]) {
        const above = getPixel(r, i, ny);
        if (above && same(above, target)) stack.push(i, ny);
      }
    }
  }
  return changed;
}

/// Copies `src` into `dst` at an offset, replacing pixels (used to lay frames out in a sheet).
export function blit(dst: Raster, src: Raster, ox: number, oy: number) {
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) setPixel(dst, ox + x, oy + y, getPixel(src, x, y)!);
}

/// A copy of the area (x, y, w, h); pixels outside `r` come out transparent.
export function crop(r: Raster, x: number, y: number, w: number, h: number): Raster {
  const out = newRaster(w, h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) setPixel(out, i, j, getPixel(r, x + i, y + j) ?? CLEAR);
  return out;
}

/// `over` drawn on top of `under` with normal alpha blending, into a new raster (for onion skins and previews).
export function composite(under: Raster, over: Raster, overOpacity = 1): Raster {
  const out = cloneRaster(under);
  for (let i = 0; i < out.data.length; i += 4) {
    const sa = (over.data[i + 3]! / 255) * overOpacity;
    if (sa === 0) continue;
    const da = out.data[i + 3]! / 255;
    const oa = sa + da * (1 - sa);
    for (let k = 0; k < 3; k++) out.data[i + k] = Math.round((over.data[i + k]! * sa + out.data[i + k]! * da * (1 - sa)) / oa);
    out.data[i + 3] = Math.round(oa * 255);
  }
  return out;
}

export function parseHex(text: string): Rgba | null {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(text.trim());
  if (!m) return null;
  const v = parseInt(m[1]!, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, m[2] ? parseInt(m[2], 16) : 255];
}

export function toHex(c: Rgba): string {
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(c[0])}${h(c[1])}${h(c[2])}${c[3] === 255 ? "" : h(c[3])}`;
}

export const isClear = (r: Raster) => r.data.every((v, i) => i % 4 !== 3 || v === 0);

// ---- symmetry, pixel-perfect strokes, selections ----------------------------------------------

/// The point and its mirror images across the middle of a w x h picture (duplicates removed).
export function mirrored(p: Point, w: number, h: number, horizontal: boolean, vertical: boolean): Point[] {
  const out: Point[] = [p];
  if (horizontal) out.push({ x: w - 1 - p.x, y: p.y });
  if (vertical) out.push({ x: p.x, y: h - 1 - p.y });
  if (horizontal && vertical) out.push({ x: w - 1 - p.x, y: h - 1 - p.y });
  return out.filter((q, i) => out.findIndex((r) => r.x === q.x && r.y === q.y) === i);
}

/// Drops the corner pixel of an "L" in a hand-drawn line, so one-pixel strokes stay one pixel thick.
export function pixelPerfect(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out.at(-1);
    if (last && last.x === p.x && last.y === p.y) continue;
    out.push(p);
    while (out.length >= 3) {
      const [a, b, c] = out.slice(-3) as [Point, Point, Point];
      const corner = (a.x === b.x || a.y === b.y) && (b.x === c.x || b.y === c.y) && a.x !== c.x && a.y !== c.y && Math.abs(a.x - c.x) === 1 && Math.abs(a.y - c.y) === 1;
      if (!corner) break;
      out.splice(out.length - 2, 1);
    }
  }
  return out;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/// The rectangle between two corner cells (inclusive), clipped to the picture; null when nothing is inside.
export function rectBetween(a: Point, b: Point, w: number, h: number): Rect | null {
  const x0 = Math.max(0, Math.min(a.x, b.x));
  const y0 = Math.max(0, Math.min(a.y, b.y));
  const x1 = Math.min(w - 1, Math.max(a.x, b.x));
  const y1 = Math.min(h - 1, Math.max(a.y, b.y));
  return x1 < x0 || y1 < y0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export const inRect = (r: Rect, x: number, y: number) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

/// Cuts a rectangle out: the pixels it held, and the picture with that area cleared.
export function lift(r: Raster, rect: Rect): { piece: Raster; rest: Raster } {
  const rest = cloneRaster(r);
  for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) setPixel(rest, x, y, CLEAR);
  return { piece: crop(r, rect.x, rect.y, rect.w, rect.h), rest };
}

/// Lays `piece` over `base` at (x, y): transparent pixels of the piece leave what is underneath alone.
export function place(base: Raster, piece: Raster, x: number, y: number): Raster {
  const out = cloneRaster(base);
  for (let j = 0; j < piece.h; j++) for (let i = 0; i < piece.w; i++) {
    const c = getPixel(piece, i, j)!;
    if (c[3] > 0) setPixel(out, x + i, y + j, c);
  }
  return out;
}

/// The same picture on a w x h canvas. The anchor (0 to 1 on each axis) says where the old picture sits
/// when the canvas grows or which part is kept when it shrinks: (0,0) top-left, (0.5,0.5) centre.
export function resizeCanvas(r: Raster, w: number, h: number, anchorX = 0, anchorY = 0): Raster {
  const ox = Math.round((w - r.w) * anchorX);
  const oy = Math.round((h - r.h) * anchorY);
  const out = newRaster(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = getPixel(r, x - ox, y - oy);
    if (c) setPixel(out, x, y, c);
  }
  return out;
}
