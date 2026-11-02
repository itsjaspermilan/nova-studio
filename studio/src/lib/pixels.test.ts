import { describe, expect, it } from "vitest";
import { CLEAR, blit, composite, crop, drawEllipse, drawLine, drawRect, floodFill, getPixel, isClear, linePoints, newRaster, parseHex, setPixel, stamp, toHex, type Raster, type Rgba } from "./pixels";

const RED: Rgba = [255, 0, 0, 255];
const BLUE: Rgba = [0, 0, 255, 255];
const lit = (r: Raster) => {
  const out: string[] = [];
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) if (getPixel(r, x, y)![3] > 0) out.push(`${x},${y}`);
  return out;
};
const art = (r: Raster) => Array.from({ length: r.h }, (_, y) => Array.from({ length: r.w }, (_, x) => (getPixel(r, x, y)![3] ? "#" : ".")).join("")).join("\n");

describe("pixels", () => {
  it("reads and writes inside the buffer and ignores the outside", () => {
    const r = newRaster(2, 2);
    setPixel(r, 1, 1, RED);
    setPixel(r, 5, 5, RED);
    setPixel(r, -1, 0, RED);
    expect(getPixel(r, 1, 1)).toEqual(RED);
    expect(getPixel(r, 2, 0)).toBeNull();
    expect(lit(r)).toEqual(["1,1"]);
  });

  it("stamps a centred square brush", () => {
    const r = newRaster(5, 5);
    stamp(r, 2, 2, 3, RED);
    expect(art(r)).toBe(".....\n.###.\n.###.\n.###.\n.....");
    const e = newRaster(4, 4);
    stamp(e, 1, 1, 2, RED);
    expect(lit(e)).toEqual(["1,1", "2,1", "1,2", "2,2"]); // the extra pixel goes right and down
  });

  it("draws gap-free lines in every direction, ends included", () => {
    expect(linePoints({ x: 0, y: 0 }, { x: 3, y: 0 })).toHaveLength(4);
    expect(linePoints({ x: 0, y: 0 }, { x: 0, y: 0 })).toEqual([{ x: 0, y: 0 }]);
    for (const [a, b] of [[{ x: 0, y: 0 }, { x: 7, y: 3 }], [{ x: 7, y: 3 }, { x: 0, y: 0 }], [{ x: 2, y: 9 }, { x: 5, y: 0 }]] as const) {
      const pts = linePoints(a, b);
      expect(pts[0]).toEqual(a);
      expect(pts.at(-1)).toEqual(b);
      for (let i = 1; i < pts.length; i++) expect(Math.max(Math.abs(pts[i]!.x - pts[i - 1]!.x), Math.abs(pts[i]!.y - pts[i - 1]!.y))).toBe(1);
    }
    const r = newRaster(4, 4);
    drawLine(r, { x: 0, y: 0 }, { x: 3, y: 3 }, 1, RED);
    expect(lit(r)).toEqual(["0,0", "1,1", "2,2", "3,3"]);
  });

  it("draws outline and filled rectangles from any pair of corners", () => {
    const r = newRaster(5, 4);
    drawRect(r, { x: 4, y: 3 }, { x: 1, y: 0 }, 1, RED, false);
    expect(art(r)).toBe(".####\n.#..#\n.#..#\n.####");
    const f = newRaster(3, 3);
    drawRect(f, { x: 0, y: 0 }, { x: 1, y: 1 }, 1, RED, true);
    expect(lit(f)).toEqual(["0,0", "1,0", "0,1", "1,1"]);
  });

  it("draws ellipses that stay in their box, hollow or solid", () => {
    const r = newRaster(9, 7);
    drawEllipse(r, { x: 0, y: 0 }, { x: 8, y: 6 }, 1, RED, false);
    const solid = newRaster(9, 7);
    drawEllipse(solid, { x: 0, y: 0 }, { x: 8, y: 6 }, 1, RED, true);
    expect(getPixel(r, 4, 3)![3]).toBe(0);
    expect(getPixel(solid, 4, 3)![3]).toBe(255);
    expect(getPixel(r, 4, 0)![3]).toBe(255);
    expect(getPixel(r, 0, 3)![3]).toBe(255);
    expect(getPixel(r, 0, 0)![3]).toBe(0);
    expect(lit(r).length).toBeLessThan(lit(solid).length);
    const one = newRaster(3, 3);
    drawEllipse(one, { x: 1, y: 1 }, { x: 1, y: 1 }, 1, RED, false);
    expect(lit(one)).toEqual(["1,1"]);
  });

  it("flood fills only the connected area of the exact colour", () => {
    const r = newRaster(5, 3);
    drawRect(r, { x: 2, y: 0 }, { x: 2, y: 2 }, 1, BLUE, true); // a wall
    expect(floodFill(r, 0, 0, RED)).toBe(6);
    expect(getPixel(r, 1, 2)).toEqual(RED);
    expect(getPixel(r, 3, 0)).toEqual(CLEAR);
    expect(floodFill(r, 0, 0, RED)).toBe(0); // already that colour
    expect(floodFill(r, 9, 9, RED)).toBe(0);
    expect(floodFill(r, 2, 1, RED)).toBe(3); // the wall itself
  });

  it("fills a big area without blowing the stack and handles diagonal gaps as walls", () => {
    const big = newRaster(512, 512);
    expect(floodFill(big, 0, 0, RED)).toBe(512 * 512);
    const d = newRaster(3, 3);
    for (const i of [0, 1, 2]) setPixel(d, i, i, BLUE);
    expect(floodFill(d, 2, 0, RED)).toBe(3); // 4-way fill does not leak through the diagonal
    expect(getPixel(d, 0, 2)).toEqual(CLEAR);
  });

  it("blits, crops, composites and detects empty rasters", () => {
    const a = newRaster(4, 4);
    const s = newRaster(2, 2);
    stamp(s, 0, 0, 2, RED);
    blit(a, s, 3, 3);
    expect(lit(a)).toEqual(["3,3"]);
    const c = crop(a, 2, 2, 3, 3);
    expect(c.w).toBe(3);
    expect(lit(c)).toEqual(["1,1"]);
    const over = composite(a, s, 0.5);
    expect(getPixel(over, 0, 0)).toEqual([255, 0, 0, 128]);
    expect(isClear(newRaster(2, 2))).toBe(true);
    expect(isClear(a)).toBe(false);
  });

  it("parses and prints hex colours", () => {
    expect(parseHex("#ff8000")).toEqual([255, 128, 0, 255]);
    expect(parseHex("FF800080")).toEqual([255, 128, 0, 128]);
    expect(parseHex("nope")).toBeNull();
    expect(toHex([255, 128, 0, 255])).toBe("#ff8000");
    expect(toHex([1, 2, 3, 4])).toBe("#01020304");
  });
});
