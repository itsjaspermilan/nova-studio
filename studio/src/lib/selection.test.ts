import { describe, expect, it } from "vitest";
import { newRaster, setPixel, type Rgba } from "./pixels";
import { boundsOf, combine, countOf, emptyMask, growMask, has, invertMask, isRect, liftMasked, maskFromColor, maskFromEllipse, maskFromPolygon, maskFromRect, outlineSegments, placeMask, shiftMask } from "./selection";

const RED: Rgba = [255, 0, 0, 255];
const BLUE: Rgba = [0, 0, 255, 255];
const cells = (m: ReturnType<typeof emptyMask>) => {
  const out: string[] = [];
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (has(m, x, y)) out.push(`${x},${y}`);
  return out;
};

describe("shapes", () => {
  it("make a rectangle, clipped to the picture", () => {
    const m = maskFromRect({ x: 1, y: 1, w: 3, h: 2 }, 5, 5);
    expect(countOf(m)).toBe(6);
    expect(countOf(maskFromRect({ x: 3, y: 3, w: 9, h: 9 }, 5, 5))).toBe(4);
    expect(isRect(m)).toBe(true);
  });

  it("make an ellipse that leaves the corners out", () => {
    const m = maskFromEllipse({ x: 0, y: 0 }, { x: 6, y: 6 }, 8, 8);
    expect(has(m, 3, 3)).toBe(true);
    expect(has(m, 0, 0)).toBe(false);
    expect(has(m, 3, 0)).toBe(true);
    expect(boundsOf(m)).toEqual({ x: 0, y: 0, w: 7, h: 7 });
    expect(isRect(m)).toBe(false);
    // the same ellipse whichever corner the drag started from
    expect(cells(maskFromEllipse({ x: 6, y: 6 }, { x: 0, y: 0 }, 8, 8))).toEqual(cells(m));
  });

  it("make a free-hand shape by its outline, and a line or a dot from a short one", () => {
    const tri = maskFromPolygon([{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 0, y: 6 }], 8, 8);
    expect(has(tri, 1, 1)).toBe(true);
    expect(has(tri, 5, 5)).toBe(false);
    expect(has(tri, 6, 0)).toBe(true); // (the corners are on the outline)
    expect(countOf(maskFromPolygon([{ x: 2, y: 2 }], 5, 5))).toBe(1);
    expect(countOf(maskFromPolygon([], 5, 5))).toBe(0);
  });
});

describe("the magic wand", () => {
  const pic = () => {
    const r = newRaster(5, 3);
    for (const [x, y, c] of [[0, 0, RED], [1, 0, RED], [3, 0, RED], [1, 1, BLUE], [2, 1, BLUE]] as [number, number, Rgba][]) setPixel(r, x, y, c);
    return r;
  };

  it("picks the joined run of a colour, or every pixel of it anywhere", () => {
    expect(cells(maskFromColor(pic(), 0, 0, 0, true)).sort()).toEqual(["0,0", "1,0"]);
    expect(cells(maskFromColor(pic(), 0, 0, 0, false)).sort()).toEqual(["0,0", "1,0", "3,0"]);
  });

  it("takes in colours that are close when the tolerance allows", () => {
    const r = newRaster(3, 1);
    setPixel(r, 0, 0, [100, 100, 100, 255]);
    setPixel(r, 1, 0, [110, 100, 100, 255]);
    setPixel(r, 2, 0, [200, 100, 100, 255]);
    expect(countOf(maskFromColor(r, 0, 0, 0, true))).toBe(1);
    expect(countOf(maskFromColor(r, 0, 0, 15, true))).toBe(2);
    expect(countOf(maskFromColor(r, 0, 0, 255, true))).toBe(3);
  });

  it("treats all empty pixels alike and ignores a click off the picture", () => {
    expect(countOf(maskFromColor(pic(), 4, 2, 0, true))).toBe(9); // (the empty pixel boxed in at 2,0 is not joined to the rest)
    expect(countOf(maskFromColor(pic(), 4, 2, 0, false))).toBe(10);
    expect(countOf(maskFromColor(pic(), 9, 9, 0, true))).toBe(0);
  });
});

describe("combining, inverting and resizing a selection", () => {
  const a = () => maskFromRect({ x: 0, y: 0, w: 3, h: 1 }, 4, 2);
  const b = () => maskFromRect({ x: 2, y: 0, w: 2, h: 2 }, 4, 2);

  it("adds, subtracts and intersects, and replaces when there was nothing", () => {
    expect(cells(combine(a(), b(), "add")).sort()).toEqual(["0,0", "1,0", "2,0", "2,1", "3,0", "3,1"]);
    expect(cells(combine(a(), b(), "subtract"))).toEqual(["0,0", "1,0"]);
    expect(cells(combine(a(), b(), "intersect"))).toEqual(["2,0"]);
    expect(combine(null, b(), "add")).toEqual(b());
    expect(combine(a(), b(), "replace")).toEqual(b());
  });

  it("inverts and is its own opposite", () => {
    expect(countOf(invertMask(a()))).toBe(8 - 3);
    expect(invertMask(invertMask(a()))).toEqual(a());
  });

  it("grows and shrinks one cell at a time", () => {
    const dot = maskFromRect({ x: 2, y: 2, w: 1, h: 1 }, 5, 5);
    expect(countOf(growMask(dot, 1))).toBe(5);
    expect(countOf(growMask(dot, 2))).toBe(13);
    const block = maskFromRect({ x: 1, y: 1, w: 3, h: 3 }, 5, 5);
    expect(cells(growMask(block, -1))).toEqual(["2,2"]);
    expect(countOf(growMask(block, -2))).toBe(0);
    const edge = maskFromRect({ x: 0, y: 0, w: 3, h: 3 }, 5, 5);
    expect(countOf(growMask(edge, -1))).toBe(4); // (the picture's edge does not eat into a selection that touches it)
  });
});

describe("moving what is selected", () => {
  it("lifts only the selected pixels, leaves the rest, and keeps the shape", () => {
    const r = newRaster(4, 2);
    for (let x = 0; x < 4; x++) setPixel(r, x, 0, RED);
    const m = maskFromRect({ x: 1, y: 0, w: 2, h: 1 }, 4, 2);
    const lifted = liftMasked(r, m)!;
    expect(lifted.bounds).toEqual({ x: 1, y: 0, w: 2, h: 1 });
    expect(Array.from(lifted.piece.data.slice(0, 4))).toEqual([255, 0, 0, 255]);
    expect(lifted.rest.data[3]).toBe(255); // x = 0 stays
    expect(lifted.rest.data[7]).toBe(0); // x = 1 is gone
    expect(countOf(lifted.pieceMask)).toBe(2);
    expect(liftMasked(r, emptyMask(4, 2))).toBeNull();
  });

  it("shifts and places a mask", () => {
    const m = maskFromRect({ x: 0, y: 0, w: 2, h: 1 }, 4, 2);
    expect(cells(shiftMask(m, 2, 1))).toEqual(["2,1", "3,1"]);
    expect(cells(shiftMask(m, 3, 0))).toEqual(["3,0"]); // (clipped)
    expect(cells(placeMask(maskFromRect({ x: 0, y: 0, w: 2, h: 1 }, 2, 1), 4, 2, 1, 1))).toEqual(["1,1", "2,1"]);
  });

  it("draws an outline of segments round the shape", () => {
    expect(outlineSegments(maskFromRect({ x: 1, y: 1, w: 1, h: 1 }, 3, 3))).toHaveLength(4);
    expect(outlineSegments(maskFromRect({ x: 0, y: 0, w: 2, h: 1 }, 3, 3))).toHaveLength(6);
  });
});
