// Grids: a scene file's 3D tilemaps (as a GridMap): rows of numbers, each a model in the grid's `models` (from 0; -1 is an empty cell). Cell (column
// c, row r, from 0 here) stands at x + (c + 0.5) * cell, y, z + (r + 0.5) * cell, rows going towards +z. The 3D view draws them and paints them; these
// are the edits, each giving back a new scene.
import type { Scene } from "./scene-model";

export interface Grid {
  name?: string;
  cell: number;
  x: number;
  y: number;
  z: number;
  models: string[];
  tiles: number[][];
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/// The scene's grids, with their defaults filled in.
export function gridsOf(scene: Scene): Grid[] {
  const list = (scene as { grids?: unknown[] }).grids;
  if (!Array.isArray(list)) return [];
  return list.map((g) => {
    const o = (g ?? {}) as Record<string, unknown>;
    return {
      name: typeof o.name === "string" ? o.name : undefined,
      cell: num(o.cell, 1),
      x: num(o.x, 0),
      y: num(o.y, 0),
      z: num(o.z, 0),
      models: Array.isArray(o.models) ? o.models.map(String) : [],
      tiles: Array.isArray(o.tiles) ? o.tiles.map((row) => (Array.isArray(row) ? row.map((v) => num(v, -1)) : [])) : [],
    };
  });
}

/// The cell under a ground point (0-based; may be outside the grid).
export function gridCellAt(g: Grid, x: number, z: number): { col: number; row: number } {
  return { col: Math.floor((x - g.x) / g.cell), row: Math.floor((z - g.z) / g.cell) };
}

/// The middle of a cell, on the grid's floor.
export function gridCellCenter(g: Grid, col: number, row: number): [number, number, number] {
  return [g.x + (col + 0.5) * g.cell, g.y, g.z + (row + 0.5) * g.cell];
}

const write = (scene: Scene, index: number, grid: Grid): Scene => {
  const list = [...((scene as { grids?: unknown[] }).grids ?? [])];
  const old = (list[index] ?? {}) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...old, cell: grid.cell, x: grid.x, y: grid.y, z: grid.z, models: grid.models, tiles: grid.tiles };
  if (grid.name !== undefined) next.name = grid.name;
  list[index] = next;
  return { ...scene, grids: list } as Scene;
};

/// Paints one cell. Painting past the edge grows the grid (its corner moves when it grows to the left or back, so nothing else moves); an empty
/// cell painted outside it changes nothing.
export function paintGridCell(scene: Scene, index: number, col: number, row: number, tile: number): Scene {
  const g = gridsOf(scene)[index];
  if (!g || tile < -1 || tile >= g.models.length) return scene;
  const width = Math.max(1, ...g.tiles.map((r) => r.length));
  let tiles = g.tiles.map((r) => [...r, ...Array(width - r.length).fill(-1)]);
  const inside = row >= 0 && row < tiles.length && col >= 0 && col < width;
  if (!inside && tile === -1) return scene;
  let { x, z } = g;
  if (col < 0) {
    tiles = tiles.map((r) => [...Array(-col).fill(-1), ...r]);
    x -= -col * g.cell;
    col = 0;
  }
  if (row < 0) {
    const w = tiles[0]!.length;
    tiles = [...Array.from({ length: -row }, () => Array(w).fill(-1)), ...tiles];
    z -= -row * g.cell;
    row = 0;
  }
  const w = Math.max(tiles[0]!.length, col + 1);
  tiles = tiles.map((r) => [...r, ...Array(w - r.length).fill(-1)]);
  while (tiles.length <= row) tiles.push(Array(w).fill(-1));
  if (tiles[row]![col] === tile) return scene;
  tiles[row]![col] = tile;
  return write(scene, index, { ...g, x, z, tiles });
}

/// A new grid of empty cells.
export function addGrid(scene: Scene, name: string, models: string[], cols: number, rows: number, cell = 1): Scene {
  const list = [...((scene as { grids?: unknown[] }).grids ?? [])];
  list.push({ name, cell, x: 0, y: 0, z: 0, models: models.length ? models : [""], tiles: Array.from({ length: Math.max(1, rows) }, () => Array(Math.max(1, cols)).fill(-1)) });
  return { ...scene, grids: list } as Scene;
}

/// A model added to a grid's palette (the next tile number), unless it is there already.
export function addGridModel(scene: Scene, index: number, model: string): Scene {
  const g = gridsOf(scene)[index];
  if (!g || !model || g.models.includes(model)) return scene;
  return write(scene, index, { ...g, models: [...g.models, model] });
}
