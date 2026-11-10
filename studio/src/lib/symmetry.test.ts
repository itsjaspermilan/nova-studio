import { describe, expect, it } from "vitest";
import { placesOf, strokeMaps } from "./symmetry";

const at = (w: number, h: number, o: Parameters<typeof strokeMaps>[2], p = { x: 1, y: 0 }) =>
  placesOf(p, strokeMaps(w, h, o), w, h).map((q) => `${q.x},${q.y}`).sort();

describe("mirrored strokes", () => {
  it("draw once with no symmetry", () => {
    expect(at(8, 8, {})).toEqual(["1,0"]);
  });

  it("mirror left to right, up and down, or both", () => {
    expect(at(8, 8, { x: true })).toEqual(["1,0", "6,0"]);
    expect(at(8, 8, { y: true })).toEqual(["1,0", "1,7"]);
    expect(at(8, 8, { x: true, y: true })).toEqual(["1,0", "1,7", "6,0", "6,7"]);
  });

  it("mirror across the diagonal on a square, and not at all on a rectangle", () => {
    expect(at(8, 8, { diagonal: true })).toEqual(["0,1", "1,0"]);
    expect(at(8, 4, { diagonal: true })).toEqual(["1,0"]);
    expect(at(8, 8, { x: true, y: true, diagonal: true })).toHaveLength(8);
  });

  it("do not draw a point twice when it lies on the mirror", () => {
    expect(at(8, 8, { x: true }, { x: 3, y: 2 }).length).toBe(2);
    expect(at(7, 7, { x: true }, { x: 3, y: 2 })).toEqual(["3,2"]); // (the middle column of an odd picture)
  });
});

describe("tiled drawing", () => {
  it("brings a point that runs off the picture back in at the other side", () => {
    // a point one past the right edge, as the end of a wide brush would be
    const maps = strokeMaps(8, 8, { tileX: true });
    expect(placesOf({ x: 8, y: 3 }, maps, 8, 8).map((q) => `${q.x},${q.y}`)).toEqual(["0,3"]);
    expect(placesOf({ x: -1, y: 3 }, maps, 8, 8).map((q) => `${q.x},${q.y}`)).toEqual(["7,3"]);
    expect(placesOf({ x: 8, y: 3 }, strokeMaps(8, 8, {}), 8, 8)).toEqual([]);
  });

  it("wraps up and down too, and combines with mirroring", () => {
    expect(placesOf({ x: 2, y: -1 }, strokeMaps(8, 8, { tileY: true }), 8, 8)).toEqual([{ x: 2, y: 7 }]);
    const both = placesOf({ x: 8, y: 0 }, strokeMaps(8, 8, { x: true, tileX: true }), 8, 8).map((q) => `${q.x},${q.y}`).sort();
    expect(both).toEqual(["0,0", "7,0"]);
  });
});

describe("about the middle", () => {
  it("a half turn repeats a stroke at the opposite corner, on any shape", () => {
    expect(at(8, 8, { point: true })).toEqual(["1,0", "6,7"]);
    expect(at(8, 4, { point: true })).toEqual(["1,0", "6,3"]);
  });
  it("a half turn with both mirrors adds nothing new", () => {
    expect(at(8, 8, { point: true, x: true, y: true })).toEqual(at(8, 8, { x: true, y: true }));
  });
  it("a four-way turn gives the four corners' turns, and only on a square", () => {
    expect(at(8, 8, { quarter: true })).toEqual(["0,6", "1,0", "6,7", "7,1"]);
    expect(at(8, 4, { quarter: true })).toEqual(["1,0"]);
  });
});
