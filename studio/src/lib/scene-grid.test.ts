import { describe, expect, it } from "vitest";
import { addGrid, addGridModel, gridCellAt, gridCellCenter, gridsOf, paintGridCell } from "./scene-grid";
import type { Scene } from "./scene-model";

const scene = (): Scene => ({ version: 1, grids: [{ name: "kitchen", cell: 1, models: ["floor", "counter"], tiles: [[1, 1], [0, 0]] }] } as unknown as Scene);

describe("grids", () => {
  it("are read with their defaults", () => {
    const [g] = gridsOf(scene());
    expect(g).toMatchObject({ name: "kitchen", cell: 1, x: 0, y: 0, z: 0, models: ["floor", "counter"], tiles: [[1, 1], [0, 0]] });
    expect(gridsOf({ version: 1 } as Scene)).toEqual([]);
  });
  it("find the cell under a point and the middle of a cell", () => {
    const [g] = gridsOf(scene());
    expect(gridCellAt(g!, 1.5, 0.2)).toEqual({ col: 1, row: 0 });
    expect(gridCellCenter(g!, 1, 0)).toEqual([1.5, 0, 0.5]);
  });
  it("paint a cell, and grow when painted past an edge without moving what is there", () => {
    let s = paintGridCell(scene(), 0, 0, 1, 1);
    expect(gridsOf(s)[0]!.tiles).toEqual([[1, 1], [1, 0]]);
    s = paintGridCell(s, 0, -1, 0, 0);
    const g = gridsOf(s)[0]!;
    expect(g.x).toBe(-1);
    expect(g.tiles).toEqual([[0, 1, 1], [-1, 1, 0]]);
    s = paintGridCell(s, 0, 3, 3, 1);
    expect(gridsOf(s)[0]!.tiles.length).toBe(4);
    expect(gridsOf(s)[0]!.tiles[3]![3]).toBe(1);
    // an empty cell painted outside, or a tile the palette lacks, changes nothing
    expect(paintGridCell(s, 0, 9, 9, -1)).toBe(s);
    expect(paintGridCell(s, 0, 0, 0, 5)).toBe(s);
  });
  it("are added, and take more models", () => {
    let s = addGrid({ version: 1 } as Scene, "yard", ["grass"], 3, 2);
    expect(gridsOf(s)[0]!.tiles).toEqual([[-1, -1, -1], [-1, -1, -1]]);
    s = addGridModel(s, 0, "fence");
    expect(gridsOf(s)[0]!.models).toEqual(["grass", "fence"]);
    expect(addGridModel(s, 0, "fence")).toBe(s);
  });
});
