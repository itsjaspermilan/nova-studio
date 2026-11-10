import { describe, expect, it } from "vitest";
import { getPixel, newRaster, setPixel, type Raster, type Rgba } from "./pixels";
import { brighten, dropShadow, flipRaster, grayscale, hslToRgb, hueShift, invertColors, offsetWrap, outline, replaceColor, rgbToHsl, rotateQuarter, usedColors } from "./sprite-fx";

const RED: Rgba = [255, 0, 0, 255];
const BLUE: Rgba = [0, 0, 255, 255];
const dot = (w: number, h: number, x: number, y: number, c: Rgba = RED): Raster => {
  const r = newRaster(w, h);
  setPixel(r, x, y, c);
  return r;
};
const where = (r: Raster) => {
  const out: string[] = [];
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) if (getPixel(r, x, y)![3] > 0) out.push(`${x},${y}`);
  return out;
};

describe("flipping and turning", () => {
  it("mirrors across the picture or inside an area", () => {
    expect(where(flipRaster(dot(4, 4, 0, 1), false))).toEqual(["3,1"]);
    expect(where(flipRaster(dot(4, 4, 0, 1), true))).toEqual(["0,2"]);
    expect(where(flipRaster(dot(4, 4, 1, 0), false, { x: 0, y: 0, w: 2, h: 4 }))).toEqual(["0,0"]);
  });

  it("turns a square a quarter clockwise or back, and refuses a rectangle", () => {
    expect(where(rotateQuarter(dot(4, 4, 0, 0), false)!)).toEqual(["3,0"]); // top left goes to top right
    expect(where(rotateQuarter(dot(4, 4, 0, 0), true)!)).toEqual(["0,3"]);
    expect(rotateQuarter(dot(4, 2, 0, 0))).toBeNull();
    const four = rotateQuarter(rotateQuarter(rotateQuarter(rotateQuarter(dot(4, 4, 1, 0))!)!)!)!;
    expect(where(four)).toEqual(["1,0"]);
  });
});

describe("colours", () => {
  it("invert, grey out and brighten without touching alpha or empty pixels", () => {
    const r = dot(2, 1, 0, 0, [200, 100, 0, 128]);
    expect(Array.from(getPixel(invertColors(r), 0, 0)!)).toEqual([55, 155, 255, 128]);
    expect(getPixel(invertColors(r), 1, 0)![3]).toBe(0);
    const g = getPixel(grayscale(dot(1, 1, 0, 0, [255, 0, 0, 255])), 0, 0)!;
    expect(g[0]).toBe(g[1]);
    expect(g[1]).toBe(g[2]);
    expect(Array.from(getPixel(brighten(dot(1, 1, 0, 0, [100, 100, 100, 255]), 1), 0, 0)!)).toEqual([255, 255, 255, 255]);
    expect(Array.from(getPixel(brighten(dot(1, 1, 0, 0, [100, 100, 100, 255]), -1), 0, 0)!)).toEqual([0, 0, 0, 255]);
  });

  it("shift the hue by degrees, and a full turn changes nothing", () => {
    expect(Array.from(getPixel(hueShift(dot(1, 1, 0, 0, RED), 120), 0, 0)!)).toEqual([0, 255, 0, 255]);
    expect(Array.from(getPixel(hueShift(dot(1, 1, 0, 0, RED), 360), 0, 0)!)).toEqual([255, 0, 0, 255]);
    const [h, s, l] = rgbToHsl(10, 200, 90);
    const back = hslToRgb(h, s, l);
    expect(Math.max(...back.map((v, i) => Math.abs(v - [10, 200, 90][i]!)))).toBeLessThanOrEqual(1);
  });

  it("replace one colour, only inside an area when asked", () => {
    const r = dot(4, 1, 0, 0);
    setPixel(r, 3, 0, RED);
    const only = replaceColor(r, RED, BLUE, { x: 0, y: 0, w: 2, h: 1 });
    expect(Array.from(getPixel(only, 0, 0)!)).toEqual([0, 0, 255, 255]);
    expect(Array.from(getPixel(only, 3, 0)!)).toEqual([255, 0, 0, 255]);
  });

  it("list the colours a picture uses, most used first", () => {
    const r = dot(4, 1, 0, 0);
    setPixel(r, 1, 0, BLUE);
    setPixel(r, 2, 0, BLUE);
    expect(usedColors(r)).toEqual(["#0000ff", "#ff0000"]);
  });
});

describe("shapes", () => {
  it("slides and wraps round", () => {
    expect(where(offsetWrap(dot(4, 4, 3, 3), 1, 1))).toEqual(["0,0"]);
    expect(where(offsetWrap(dot(4, 4, 0, 0), -1, 0))).toEqual(["3,0"]);
  });

  it("outlines a shape on its four sides, or eight with the corners", () => {
    expect(where(outline(dot(5, 5, 2, 2), BLUE)).sort()).toEqual(["1,2", "2,1", "2,2", "2,3", "3,2"]);
    expect(where(outline(dot(5, 5, 2, 2), BLUE, true))).toHaveLength(9);
    expect(Array.from(getPixel(outline(dot(5, 5, 2, 2), BLUE), 2, 2)!)).toEqual([255, 0, 0, 255]); // the shape stays
    expect(where(outline(dot(3, 3, 0, 0), BLUE)).sort()).toEqual(["0,0", "0,1", "1,0"]); // (the edge of the picture is not a pixel)
  });

  it("casts a shadow behind a shape, never over it", () => {
    const s = dropShadow(dot(5, 5, 1, 1), 2, 1, BLUE);
    expect(where(s).sort()).toEqual(["1,1", "3,2"]);
    expect(Array.from(getPixel(s, 1, 1)!)).toEqual([255, 0, 0, 255]);
  });
});

describe("effects inside a selection that is not a rectangle", () => {
  it("only touch the cells it holds", () => {
    const r = newRaster(3, 1);
    for (let x = 0; x < 3; x++) setPixel(r, x, 0, RED);
    const area = { x: 0, y: 0, w: 3, h: 1, has: (x: number) => x !== 1 };
    const out = invertColors(r, area);
    expect(Array.from(getPixel(out, 0, 0)!)).toEqual([0, 255, 255, 255]);
    expect(Array.from(getPixel(out, 1, 0)!)).toEqual([255, 0, 0, 255]);
    expect(Array.from(getPixel(out, 2, 0)!)).toEqual([0, 255, 255, 255]);
  });
});
