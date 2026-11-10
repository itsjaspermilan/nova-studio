import { describe, expect, it } from "vitest";
import { BLOB_MASKS, E, N, NE, S, W, blobMask, edgeMask, eraseTerrain, layoutTiles, paintTerrain, retile, tileFor, tileForMask, type Terrain } from "./autotile";

const edges: Terrain = { name: "wall", mode: "edges", tiles: layoutTiles("edges", 10, 4, 8) };
const blob: Terrain = { name: "grass", mode: "blob", tiles: layoutTiles("blob", 100, 8, 8) };
const empty = (w: number, h: number) => Array.from({ length: h }, () => Array(w).fill(-1));
const at = (g: number[][], c: number, r: number) => g[r]![c]!;

describe("masks", () => {
  it("count the sides that touch, with north 1, east 2, south 4, west 8", () => {
    const set = new Set(["1,0", "2,1"]);
    const is = (c: number, r: number) => set.has(`${c},${r}`);
    expect(edgeMask(is, 1, 1)).toBe(1 | 2); // north and east
    expect(edgeMask(is, 5, 5)).toBe(0);
  });

  it("only count a corner when both sides next to it are there", () => {
    const only = (list: [number, number][]) => (c: number, r: number) => list.some(([x, y]) => x === c && y === r);
    expect(blobMask(only([[1, 0], [2, 1], [2, 0]]), 1, 1)).toBe(N | E | NE);
    expect(blobMask(only([[2, 0]]), 1, 1)).toBe(0); // a corner with no sides is nothing
    expect(blobMask(only([[1, 0], [2, 0]]), 1, 1)).toBe(N);
  });

  it("have 47 blob shapes, all of them reachable, and 16 edge ones", () => {
    expect(BLOB_MASKS).toHaveLength(47);
    expect(BLOB_MASKS[0]).toBe(0);
    expect(BLOB_MASKS.at(-1)).toBe(255);
    expect(edges.tiles).toHaveLength(16);
    expect(blob.tiles).toHaveLength(47);
  });
});

describe("laying a terrain out in a tileset", () => {
  it("goes row by row, wrapping every perRow tiles onto the next row of the tileset", () => {
    expect(layoutTiles("edges", 10, 4, 8).slice(0, 6)).toEqual([10, 11, 12, 13, 18, 19]);
    expect(layoutTiles("blob", 0, 8, 8)[8]).toBe(8);
    expect(layoutTiles("blob", 0, 8, 12)[8]).toBe(12);
  });

  it("finds the tile for a mask, and -1 when the terrain has none", () => {
    expect(tileForMask(edges, 0)).toBe(10);
    expect(tileForMask(edges, 15)).toBe(edges.tiles[15]);
    expect(tileForMask({ ...edges, tiles: [5] }, 3)).toBe(-1);
    expect(tileForMask(blob, N | S)).toBeGreaterThanOrEqual(100);
    expect(tileForMask(blob, N | NE)).toBe(-1); // (not a mask that can occur)
    expect(tileFor(edges, () => false, 0, 0)).toBe(10);
  });
});

describe("painting with a terrain", () => {
  it("picks edge tiles that join up as the area grows", () => {
    let g = empty(5, 3);
    g = paintTerrain(g, edges, 1, 1);
    expect(at(g, 1, 1)).toBe(edges.tiles[0]); // alone
    g = paintTerrain(g, edges, 2, 1);
    expect(at(g, 1, 1)).toBe(edges.tiles[2]); // east neighbour
    expect(at(g, 2, 1)).toBe(edges.tiles[8]); // west neighbour
    g = paintTerrain(g, edges, 3, 1);
    expect(at(g, 2, 1)).toBe(edges.tiles[2 | 8]);
  });

  it("leaves other tiles alone and ignores a cell off the map", () => {
    let g = empty(3, 3);
    g[0]![0] = 7; // not part of the terrain
    g = paintTerrain(g, edges, 1, 0);
    expect(at(g, 0, 0)).toBe(7);
    const same = paintTerrain(g, edges, 9, 9);
    expect(same).toBe(g);
  });

  it("erases a cell and gives its neighbours their open edges back", () => {
    let g = empty(4, 1);
    for (const c of [0, 1, 2]) g = paintTerrain(g, edges, c, 0);
    expect(at(g, 1, 0)).toBe(edges.tiles[2 | 8]);
    g = eraseTerrain(g, edges, 2, 0);
    expect(at(g, 2, 0)).toBe(-1);
    expect(at(g, 1, 0)).toBe(edges.tiles[8]);
    expect(eraseTerrain(g, edges, 3, 0)).toBe(g); // (already empty)
  });

  it("uses the corner tiles of a blob terrain, and a full area ends up all-inside", () => {
    let g = empty(4, 4);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) g = paintTerrain(g, blob, c, r);
    expect(at(g, 1, 1)).toBe(tileForMask(blob, 255));
    expect(at(g, 0, 0)).toBe(tileForMask(blob, E | S | (8 as number)));
    expect(at(g, 2, 2)).toBe(tileForMask(blob, N | W | 128));
    expect(W).toBe(64);
  });

  it("redoes a whole map after a terrain's tiles are changed", () => {
    let g = empty(3, 1);
    for (const c of [0, 1, 2]) g = paintTerrain(g, edges, c, 0);
    const moved: Terrain = { ...edges, tiles: edges.tiles.map((t) => t + 50) };
    const again = retile(g.map((row) => row.map((t) => (t >= 0 ? edges.tiles[0]! : t))), edges);
    expect(again[0]).toEqual([edges.tiles[2], edges.tiles[2 | 8], edges.tiles[8]]);
    expect(retile(g, moved)).toEqual(g); // (the old tiles are not this terrain's any more)
  });
});
