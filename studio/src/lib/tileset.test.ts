import { describe, expect, it } from "vitest";
import { newRaster, setPixel } from "./pixels";
import { addTerrain, duplicateTiles, gridOf, imagePathFor, newTileset, parseTileset, removeTerrain, serializeTileset, setTerrainSlot, setTileName, tilesetPathFor, toggleSolidTile } from "./tileset";

describe("a tileset description", () => {
  it("is saved and read back with its solid tiles, names and terrains", () => {
    let doc = newTileset(16, 16);
    doc = toggleSolidTile(toggleSolidTile(doc, 5), 2);
    doc = setTileName(doc, 5, "stone wall");
    doc = addTerrain(doc, "grass", "edges", 0, 8);
    const again = parseTileset(serializeTileset(doc));
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.doc).toEqual(doc);
    expect(doc.solid).toEqual([2, 5]);
    expect(serializeTileset(newTileset(8, 8))).toContain('"terrains": []');
  });

  it("refuses what cannot be right and says why", () => {
    for (const bad of ["{no", "5", '{"tile_width":0,"tile_height":8}', '{"tile_width":8,"tile_height":8,"solid":"x"}', '{"tile_width":8,"tile_height":8,"names":{"a":"b"}}', '{"tile_width":8,"tile_height":8,"terrains":[{"name":"t","mode":"edges","tiles":[1]}]}', '{"tile_width":8,"tile_height":8,"terrains":[{"name":"t","mode":"hex","tiles":[]}]}']) {
      const r = parseTileset(bad);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(5);
    }
  });

  it("toggles solid, names and clears a name, and keeps solid sorted", () => {
    let d = toggleSolidTile(newTileset(8, 8), 3);
    d = toggleSolidTile(d, 1);
    expect(d.solid).toEqual([1, 3]);
    expect(toggleSolidTile(d, 3).solid).toEqual([1]);
    expect(setTileName(setTileName(d, 1, " door "), 1, "").names).toEqual({});
  });
});

describe("terrains in a description", () => {
  it("get a layout from a first tile, a unique name, and slots that can be set", () => {
    let d = addTerrain(newTileset(8, 8), "sea", "edges", 4, 10);
    d = addTerrain(d, "sea", "blob", 0, 12);
    expect(d.terrains.map((t) => t.name)).toEqual(["sea", "sea 2"]);
    expect(d.terrains[0]!.tiles.slice(0, 5)).toEqual([4, 5, 6, 7, 14]);
    expect(d.terrains[1]!.tiles).toHaveLength(47);
    d = setTerrainSlot(d, 0, 0, 99);
    expect(d.terrains[0]!.tiles[0]).toBe(99);
    expect(setTerrainSlot(d, 0, 99, 1)).toBe(d);
    expect(removeTerrain(d, 0).terrains.map((t) => t.name)).toEqual(["sea 2"]);
  });
});

describe("the picture", () => {
  it("counts whole tiles", () => {
    expect(gridOf(40, 20, 16, 16)).toEqual({ columns: 2, rows: 1, count: 2 });
    expect(gridOf(8, 8, 16, 16).count).toBe(0);
  });

  it("finds tiles that look the same and ignores empty ones", () => {
    const pic = newRaster(8, 4);
    for (const x of [0, 4]) setPixel(pic, x + 1, 1, [255, 0, 0, 255]); // tiles 0 and 1 are the same
    expect(duplicateTiles(pic, 4, 4)).toEqual([[0, 1]]);
    setPixel(pic, 5, 2, [0, 0, 255, 255]);
    expect(duplicateTiles(pic, 4, 4)).toEqual([]);
    expect(duplicateTiles(newRaster(8, 4), 4, 4)).toEqual([]);
  });

  it("goes with a description of the same name", () => {
    expect(tilesetPathFor("sprites/tiles.png")).toBe("sprites/tiles.tileset.json");
    expect(imagePathFor("sprites/tiles.tileset.json")).toBe("sprites/tiles.png");
  });
});
