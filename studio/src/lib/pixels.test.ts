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

import { inRect, lift, mirrored, pixelPerfect, place, rectBetween, resizeCanvas } from "./pixels";

describe("symmetry", () => {
  it("lists a point and its mirrors without duplicates", () => {
    expect(mirrored({ x: 1, y: 2 }, 8, 8, false, false)).toEqual([{ x: 1, y: 2 }]);
    expect(mirrored({ x: 1, y: 2 }, 8, 8, true, false)).toEqual([{ x: 1, y: 2 }, { x: 6, y: 2 }]);
    expect(mirrored({ x: 1, y: 2 }, 8, 8, true, true)).toHaveLength(4);
    expect(mirrored({ x: 3, y: 3 }, 7, 7, true, true)).toEqual([{ x: 3, y: 3 }]); // on the centre lines
  });
});

describe("pixel-perfect strokes", () => {
  it("removes the corner of an L but keeps straight and diagonal runs", () => {
    const L = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
    expect(pixelPerfect(L)).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    const straight = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }];
    expect(pixelPerfect(straight)).toEqual(straight);
    const diagonal = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }];
    expect(pixelPerfect(diagonal)).toEqual(diagonal);
    const stairs = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }];
    expect(pixelPerfect(stairs)).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }]);
    expect(pixelPerfect([{ x: 2, y: 2 }, { x: 2, y: 2 }])).toEqual([{ x: 2, y: 2 }]);
    expect(pixelPerfect([])).toEqual([]);
  });
});

describe("selections", () => {
  it("makes clipped rectangles from two corners", () => {
    expect(rectBetween({ x: 3, y: 1 }, { x: 1, y: 2 }, 8, 8)).toEqual({ x: 1, y: 1, w: 3, h: 2 });
    expect(rectBetween({ x: -5, y: -5 }, { x: 1, y: 1 }, 8, 8)).toEqual({ x: 0, y: 0, w: 2, h: 2 });
    expect(rectBetween({ x: 9, y: 9 }, { x: 12, y: 12 }, 8, 8)).toBeNull();
    expect(inRect({ x: 1, y: 1, w: 2, h: 2 }, 2, 2)).toBe(true);
    expect(inRect({ x: 1, y: 1, w: 2, h: 2 }, 3, 2)).toBe(false);
  });

  it("lifts pixels out and places them elsewhere, letting transparent pixels show through", () => {
    const r = newRaster(6, 3);
    setPixel(r, 1, 1, RED);
    setPixel(r, 2, 1, BLUE);
    setPixel(r, 5, 0, BLUE);
    const { piece, rest } = lift(r, { x: 1, y: 1, w: 3, h: 1 });
    expect(lit(rest)).toEqual(["5,0"]);
    expect(lit(piece)).toEqual(["0,0", "1,0"]);
    const moved = place(rest, piece, 3, 2);
    expect(lit(moved)).toEqual(["5,0", "3,2", "4,2"]);
    const under = newRaster(6, 3);
    setPixel(under, 4, 2, RED);
    const over = place(under, piece, 3, 2);
    expect(getPixel(over, 3, 2)).toEqual(RED); // piece pixel (0,0) is the red one
    expect(getPixel(over, 4, 2)).toEqual(BLUE); // overwritten by the piece's blue
    expect(getPixel(place(under, piece, 3, 2), 5, 2)).toEqual(CLEAR); // the piece's transparent third column
    expect(lit(place(newRaster(2, 2), piece, 1, 1))).toEqual(["1,1"]); // clipped at the edge
  });

  it("resizes the canvas around an anchor, keeping or cropping pixels", () => {
    const r = newRaster(2, 2);
    setPixel(r, 0, 0, RED);
    setPixel(r, 1, 1, BLUE);
    const grown = resizeCanvas(r, 4, 4);
    expect(grown.w).toBe(4);
    expect(lit(grown)).toEqual(["0,0", "1,1"]);
    expect(lit(resizeCanvas(r, 4, 4, 1, 1))).toEqual(["2,2", "3,3"]);
    expect(lit(resizeCanvas(r, 4, 4, 0.5, 0.5))).toEqual(["1,1", "2,2"]);
    const cropped = resizeCanvas(grown, 2, 2, 0, 0);
    expect(lit(cropped)).toEqual(["0,0", "1,1"]);
    expect(lit(resizeCanvas(grown, 1, 1, 1, 1))).toEqual([]); // the kept corner is empty
  });
});
