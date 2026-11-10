// Editing a heightmap with brushes: raise, lower, smooth, flatten, roughen and erode, on the same grid the scene view and the engine read
// (`HeightGrid` in scene-terrain.ts: samples `cell` metres apart from (x0, z0)). `gridToPixels` writes the grid back as the 8-bit picture the engine reads.

import { falloffWeight, type Falloff } from "./mesh-ops";
import { mulberry32 } from "./sfx";
import type { HeightGrid, HeightmapSpec } from "./scene-terrain";

export type TerrainBrushMode = "raise" | "lower" | "smooth" | "flatten" | "roughen" | "erode";
export const TERRAIN_BRUSHES: TerrainBrushMode[] = ["raise", "lower", "smooth", "flatten", "roughen", "erode"];

export interface TerrainBrush {
  mode: TerrainBrushMode;
  /// Metres.
  radius: number;
  /// 0 to 1: how much one dab does (a full-strength raise adds a tenth of `height` at the centre).
  strength: number;
  falloff?: Falloff;
  /// For flatten: the height to level to (metres); missing: the height under the centre of the brush.
  level?: number;
  /// Roughen: a different number gives a different pattern.
  seed?: number;
}

export const copyGrid = (g: HeightGrid): HeightGrid => ({ ...g, heights: new Float32Array(g.heights) });

/// One dab at world position (x, z). `height` is the top of the heightmap's range (the spec's `height`): heights stay between 0 and it. Returns a new grid.
export function dab(source: HeightGrid, x: number, z: number, brush: TerrainBrush, height: number): HeightGrid {
  const g = copyGrid(source);
  const r = Math.max(1e-6, brush.radius);
  const falloff = brush.falloff ?? "smooth";
  const k = Math.min(1, Math.max(0, brush.strength));
  const cx = (x - g.x0) / g.cell;
  const cz = (z - g.z0) / g.cell;
  const reach = Math.ceil(r / g.cell) + 1;
  const ix0 = Math.max(0, Math.floor(cx) - reach), ix1 = Math.min(g.w - 1, Math.ceil(cx) + reach);
  const iz0 = Math.max(0, Math.floor(cz) - reach), iz1 = Math.min(g.rows - 1, Math.ceil(cz) + reach);
  const at = (ix: number, iz: number) => source.heights[Math.min(g.rows - 1, Math.max(0, iz)) * g.w + Math.min(g.w - 1, Math.max(0, ix))]!;
  const level = brush.level ?? at(Math.round(cx), Math.round(cz));
  const rng = mulberry32((brush.seed ?? 1) * 7919 + Math.round(cx) * 31 + Math.round(cz));
  for (let iz = iz0; iz <= iz1; iz++) {
    for (let ix = ix0; ix <= ix1; ix++) {
      const d = Math.hypot(g.x0 + ix * g.cell - x, g.z0 + iz * g.cell - z);
      if (d >= r) continue;
      const w = falloffWeight(falloff, d / r) * k;
      const i = iz * g.w + ix;
      const h = source.heights[i]!;
      let next = h;
      switch (brush.mode) {
        case "raise": next = h + height * 0.1 * w; break;
        case "lower": next = h - height * 0.1 * w; break;
        case "flatten": next = h + (level - h) * Math.min(1, w); break;
        case "smooth": {
          const avg = (at(ix - 1, iz) + at(ix + 1, iz) + at(ix, iz - 1) + at(ix, iz + 1) + h) / 5;
          next = h + (avg - h) * Math.min(1, w);
          break;
        }
        case "roughen": next = h + (rng() * 2 - 1) * height * 0.03 * w; break;
        case "erode": {
          // thermal erosion: the height moves towards the lowest neighbour when the slope is steep, like loose rock sliding down
          const lowest = Math.min(at(ix - 1, iz), at(ix + 1, iz), at(ix, iz - 1), at(ix, iz + 1));
          const drop = h - lowest;
          if (drop > g.cell * 0.5) next = h - (drop - g.cell * 0.5) * 0.5 * Math.min(1, w);
          break;
        }
      }
      g.heights[i] = Math.min(height, Math.max(0, next));
    }
  }
  return g;
}

/// Drags the dab along a stroke from one point to another, a dab every third of the radius.
export function stroke(source: HeightGrid, from: [number, number], to: [number, number], brush: TerrainBrush, height: number): HeightGrid {
  const dist = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const steps = Math.max(1, Math.ceil(dist / (brush.radius / 3)));
  let g = source;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    g = dab(g, from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, brush, height);
  }
  return g;
}

/// The grid as 8-bit RGBA pixels for a heightmap picture, the engine's way: red and green hold (height / range) * 65535 as a 16-bit number (red the high byte), blue is 0 and
/// alpha 255. Reading it back with `gridFromPixels` gives the heights to within one part in 65535.
export function gridToPixels(g: HeightGrid, spec: Pick<HeightmapSpec, "height">): Uint8ClampedArray {
  const out = new Uint8ClampedArray(g.w * g.rows * 4);
  for (let i = 0; i < g.w * g.rows; i++) {
    const v = Math.round(Math.min(1, Math.max(0, g.heights[i]! / spec.height)) * 65535);
    out[i * 4] = v >> 8;
    out[i * 4 + 1] = v & 255;
    out[i * 4 + 2] = 0;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/// A new flat grid: `size` samples on a side, `cell` metres apart from (x0, z0), at `level` metres.
export function flatGrid(size: number, cell: number, x0: number, z0: number, level = 0): HeightGrid {
  const w = Math.max(2, Math.round(size));
  return { w, rows: w, cell, x0, z0, heights: new Float32Array(w * w).fill(level) };
}

/// The lowest and highest height of the grid and its average.
export function gridStats(g: HeightGrid): { min: number; max: number; mean: number } {
  let min = Infinity, max = -Infinity, sum = 0;
  for (const h of g.heights) {
    min = Math.min(min, h);
    max = Math.max(max, h);
    sum += h;
  }
  return { min, max, mean: sum / Math.max(1, g.heights.length) };
}
