import { describe, expect, it } from "vitest";
import { drawText, hasGlyph, textSize } from "./pixel-text";
import { getPixel, newRaster } from "./pixels";

const RED: [number, number, number, number] = [255, 0, 0, 255];
const lit = (r: ReturnType<typeof newRaster>) => { let n = 0; for (let i = 3; i < r.data.length; i += 4) if (r.data[i]) n++; return n; };

describe("pixel text", () => {
  it("draws a letter from its bit rows", () => {
    const r = newRaster(10, 10);
    drawText(r, 1, 1, "I", RED);
    // I is 0E 04 04 04 04 04 0E: top row three wide in the middle, a stem, a foot
    expect([1, 2, 3].map((x) => getPixel(r, 1 + x, 1)![3])).toEqual([255, 255, 255]);
    expect(getPixel(r, 1, 1)![3]).toBe(0);
    expect(getPixel(r, 3, 4)![3]).toBe(255);
    expect(lit(r)).toBe(3 + 5 + 3);
  });
  it("measures and scales", () => {
    expect(textSize("AB")).toEqual({ w: 11, h: 7 });
    expect(textSize("A\nB")).toEqual({ w: 5, h: 16 });
    const one = newRaster(40, 40);
    const two = newRaster(40, 40);
    drawText(one, 0, 0, "A", RED, 1);
    drawText(two, 0, 0, "A", RED, 2);
    expect(lit(two)).toBe(lit(one) * 4);
  });
  it("draws lower case with its own shapes, leaves unknown characters as a box, and clips at the edge", () => {
    const a = newRaster(20, 10);
    const b = newRaster(20, 10);
    drawText(a, 0, 0, "abc", RED);
    drawText(b, 0, 0, "ABC", RED);
    expect(Array.from(a.data)).not.toEqual(Array.from(b.data));
    expect(hasGlyph("g")).toBe(true);
    // a small letter sits lower than a capital: an x has nothing in the top two rows
    const x = newRaster(8, 8);
    drawText(x, 0, 0, "x", RED);
    expect([0, 1].every((row) => [0, 1, 2, 3, 4].every((col) => getPixel(x, col, row)![3] === 0))).toBe(true);
    expect(getPixel(x, 0, 2)![3]).toBe(255);
    expect(hasGlyph("é")).toBe(false);
    const c = newRaster(20, 10);
    drawText(c, 0, 0, "é", RED);
    expect(lit(c)).toBeGreaterThan(10);
    const d = newRaster(3, 3);
    expect(() => drawText(d, 0, 0, "WIDE TEXT", RED)).not.toThrow();
  });
});
