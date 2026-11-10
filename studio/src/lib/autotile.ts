// Auto-tiling: painting with a terrain (grass, wall, water) instead of single tiles. The tile for each cell is chosen from its neighbours, so
// the edges and corners of an area join up by themselves. A terrain is a list of tiles of the tileset in a fixed order:
//  - "edges" (16 tiles): by which of the four sides touch the same terrain (north 1, east 2, south 4, west 8), so tile k is the one with mask k;
//  - "blob" (47 tiles): the same plus the four corners, where a corner only counts when both sides next to it do; the 47 masks that can occur,
//    from the smallest to the largest.
// The scene file just holds the chosen tile numbers (the game needs to know nothing about terrains).

export type TerrainMode = "edges" | "blob";

export interface Terrain {
  name: string;
  mode: TerrainMode;
  /// The terrain's tile numbers, 16 for "edges", 47 for "blob".
  tiles: number[];
}

export const N = 1;
export const NE = 2;
export const E = 4;
export const SE = 8;
export const S = 16;
export const SW = 32;
export const W = 64;
export const NW = 128;

/// The 47 corner-and-edge masks that can occur, ascending (a corner bit is only ever set when both its sides are).
export const BLOB_MASKS: number[] = Array.from({ length: 256 }, (_, m) => m).filter(
  (m) => (!(m & NE) || ((m & N) && (m & E))) && (!(m & SE) || ((m & S) && (m & E))) && (!(m & SW) || ((m & S) && (m & W))) && (!(m & NW) || ((m & N) && (m & W))),
);
const BLOB_INDEX = new Map(BLOB_MASKS.map((m, i) => [m, i]));

export const tileCountOf = (mode: TerrainMode) => (mode === "edges" ? 16 : BLOB_MASKS.length);

export type Member = (col: number, row: number) => boolean;

/// The four-side mask of a cell: which neighbours are the same terrain.
export function edgeMask(isMember: Member, col: number, row: number): number {
  return (isMember(col, row - 1) ? 1 : 0) | (isMember(col + 1, row) ? 2 : 0) | (isMember(col, row + 1) ? 4 : 0) | (isMember(col - 1, row) ? 8 : 0);
}

/// The eight-neighbour mask of a cell, with corners that do not count removed.
export function blobMask(isMember: Member, col: number, row: number): number {
  const n = isMember(col, row - 1);
  const e = isMember(col + 1, row);
  const s = isMember(col, row + 1);
  const w = isMember(col - 1, row);
  return (n ? N : 0) | (e ? E : 0) | (s ? S : 0) | (w ? W : 0) | (n && e && isMember(col + 1, row - 1) ? NE : 0) | (s && e && isMember(col + 1, row + 1) ? SE : 0) | (s && w && isMember(col - 1, row + 1) ? SW : 0) | (n && w && isMember(col - 1, row - 1) ? NW : 0);
}

/// The tile a terrain uses for a mask, or -1 when the terrain has no tile for it (a list that is too short).
export function tileForMask(t: Terrain, mask: number): number {
  const i = t.mode === "edges" ? mask : (BLOB_INDEX.get(mask) ?? -1);
  return i >= 0 ? (t.tiles[i] ?? -1) : -1;
}

/// The tile for a cell given who its neighbours are.
export function tileFor(t: Terrain, isMember: Member, col: number, row: number): number {
  return tileForMask(t, t.mode === "edges" ? edgeMask(isMember, col, row) : blobMask(isMember, col, row));
}

/// A terrain's tiles laid out in the tileset the usual way: row after row from `first`, `perRow` to a row, starting a new row of the tileset
/// every `perRow` tiles (the tileset's own width in tiles is `columns`).
export function layoutTiles(mode: TerrainMode, first: number, perRow: number, columns: number): number[] {
  return Array.from({ length: tileCountOf(mode) }, (_, k) => first + (k % perRow) + Math.floor(k / perRow) * columns);
}

type Grid = number[][];
const cell = (g: Grid, c: number, r: number): number | undefined => g[r]?.[c];

function copy(g: Grid): Grid {
  return g.map((row) => [...row]);
}

/// Paints one cell with a terrain and refreshes the tiles of the terrain cells round it. Painting past the edge is ignored; the grid is copied.
export function paintTerrain(grid: Grid, t: Terrain, col: number, row: number): Grid {
  if (cell(grid, col, row) === undefined) return grid;
  const out = copy(grid);
  const members = new Set(t.tiles);
  // the cell counts as terrain while its neighbours are worked out
  const marker = t.tiles.find((x) => x >= 0) ?? -1;
  out[row]![col] = marker;
  refresh(out, t, members, col, row);
  return out;
}

/// Clears one cell (to -1) and refreshes the terrain cells round it.
export function eraseTerrain(grid: Grid, t: Terrain, col: number, row: number): Grid {
  if (cell(grid, col, row) === undefined || grid[row]![col] === -1) return grid;
  const out = copy(grid);
  const members = new Set(t.tiles);
  out[row]![col] = -1;
  refresh(out, t, members, col, row);
  return out;
}

function refresh(g: Grid, t: Terrain, members: Set<number>, col: number, row: number) {
  const isMember: Member = (c, r) => {
    const v = cell(g, c, r);
    return v !== undefined && members.has(v);
  };
  // (a cell's mask is read before any of the changes of this pass are written, so the order does not matter)
  const updates: [number, number, number][] = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const [c, r] = [col + dc, row + dr];
    if (!isMember(c, r)) continue;
    const tile = tileFor(t, isMember, c, r);
    if (tile >= 0) updates.push([c, r, tile]);
  }
  for (const [c, r, tile] of updates) g[r]![c] = tile;
}

/// Redoes every cell of a terrain in a grid (after the terrain's tiles changed, or to fix a map made by hand).
export function retile(grid: Grid, t: Terrain): Grid {
  const members = new Set(t.tiles);
  const out = copy(grid);
  const isMember: Member = (c, r) => {
    const v = cell(grid, c, r);
    return v !== undefined && members.has(v);
  };
  for (let r = 0; r < grid.length; r++) for (let c = 0; c < grid[r]!.length; c++) {
    if (!isMember(c, r)) continue;
    const tile = tileFor(t, isMember, c, r);
    if (tile >= 0) out[r]![c] = tile;
  }
  return out;
}
