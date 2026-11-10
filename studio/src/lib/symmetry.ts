// Drawing in more than one place at once: mirrored strokes (left-right, up-down, across a diagonal) and tiled drawing, where what runs off one
// edge of the picture comes back in at the other (for textures that repeat). A "map" says where a point goes; a stroke is drawn once through every map.

import type { Point } from "./pixels";

export type PointMap = (p: Point) => Point;

export interface SymmetryOptions {
  /// Mirror left to right, and up and down.
  x?: boolean;
  y?: boolean;
  /// Mirror across the main diagonal (and, with both x and y, the other one too): only for a square picture.
  diagonal?: boolean;
  /// Draw the stroke again one picture further left and right, and up and down, so it wraps round the edges.
  tileX?: boolean;
  tileY?: boolean;
}

/// Every way to draw one stroke: the stroke itself first, then each mirror of it, then (when tiling) each of those shifted a picture's width or
/// height either way. Points that fall outside the picture are simply not drawn, so the shifted copies are what wrap round.
export function strokeMaps(w: number, h: number, o: SymmetryOptions): PointMap[] {
  const base: PointMap[] = [(p) => p];
  if (o.x) base.push((p) => ({ x: w - 1 - p.x, y: p.y }));
  if (o.y) base.push((p) => ({ x: p.x, y: h - 1 - p.y }));
  if (o.x && o.y) base.push((p) => ({ x: w - 1 - p.x, y: h - 1 - p.y }));
  if (o.diagonal && w === h) {
    // (every map so far, then turned across the diagonal: this gives the transpose, and with x and y the full set of eight)
    const so_far = [...base];
    for (const m of so_far) base.push((p) => {
      const q = m(p);
      return { x: q.y, y: q.x };
    });
  }
  const dxs = o.tileX ? [0, -w, w] : [0];
  const dys = o.tileY ? [0, -h, h] : [0];
  const out: PointMap[] = [];
  for (const m of base) for (const dy of dys) for (const dx of dxs) out.push(dx === 0 && dy === 0 ? m : (p) => {
    const q = m(p);
    return { x: q.x + dx, y: q.y + dy };
  });
  return out;
}

/// The distinct places a point is drawn through the maps, inside the picture (or up to `margin` cells outside it, for a brush that overhangs the edge).
export function placesOf(p: Point, maps: PointMap[], w: number, h: number, margin = 0): Point[] {
  const seen = new Set<string>();
  const out: Point[] = [];
  for (const m of maps) {
    const q = m(p);
    if (q.x < -margin || q.y < -margin || q.x >= w + margin || q.y >= h + margin) continue;
    const key = `${q.x},${q.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out;
}
