import { describe, expect, it } from "vitest";
import { brushOffsets, ditherThreshold, gradientFill, shadeColor, shadeStamp, stampBrush } from "./brush";
import { getPixel, newRaster, setPixel, stamp, type Rgba } from "./pixels";

const cells = (offs: { x: number; y: number }[]) => offs.map((o) => `${o.x},${o.y}`).sort();
const RED: Rgba = [255, 0, 0, 255];
const BLUE: Rgba = [0, 0, 255, 255];

describe("brush shapes", () => {
  it("a square brush is the block the old stamp drew, and a one-pixel brush is one pixel in every shape", () => {
    const a = newRaster(7, 7);
    const b = newRaster(7, 7);
    stamp(a, 3, 3, 4, RED);
    stampBrush(b, 3, 3, 4, "square", RED);
    expect(Array.from(b.data)).toEqual(Array.from(a.data));
    for (const shape of ["square", "round", "diamond"] as const) expect(brushOffsets(1, shape)).toEqual([{ x: 0, y: 0 }]);
  });

  it("round and diamond brushes leave their corners out, and keep the middle", () => {
    expect(cells(brushOffsets(3, "diamond"))).toEqual(["-1,0", "0,-1", "0,0", "0,1", "1,0"]);
    const round5 = cells(brushOffsets(5, "round"));
    expect(round5).toContain("0,0");
    expect(round5).not.toContain("-2,-2");
    expect(round5.length).toBeLessThan(25);
    expect(round5.length).toBeGreaterThan(12);
    expect(cells(brushOffsets(5, "diamond")).length).toBeLessThan(round5.length);
  });

  it("are symmetric for an odd size", () => {
    for (const shape of ["round", "diamond"] as const) {
      const set = new Set(cells(brushOffsets(7, shape)));
      for (const o of brushOffsets(7, shape)) expect(set.has(`${-o.x},${o.y}`)).toBe(true);
    }
  });
});

describe("shading", () => {
  it("lightens and darkens, turning the hue a little, and keeps alpha", () => {
    const base: Rgba = [120, 80, 60, 200];
    const light = shadeColor(base, 0.5);
    const dark = shadeColor(base, -0.5);
    expect(light[0] + light[1] + light[2]).toBeGreaterThan(base[0] + base[1] + base[2]);
    expect(dark[0] + dark[1] + dark[2]).toBeLessThan(base[0] + base[1] + base[2]);
    expect(light[3]).toBe(200);
    const blueShare = (c: Rgba) => c[2] / (c[0] + c[1] + c[2]);
    expect(blueShare(dark)).toBeGreaterThan(blueShare(base)); // (darker tones lean to blue)
    expect(blueShare(light)).toBeLessThan(blueShare(base)); // (and lighter ones to yellow)
    expect(shadeColor(base, 0)).toEqual(base);
  });

  it("only touches visible pixels under the brush", () => {
    const r = newRaster(3, 1);
    setPixel(r, 0, 0, [100, 100, 100, 255]);
    shadeStamp(r, 1, 0, 3, "square", 0.5);
    expect(getPixel(r, 0, 0)![0]).toBeGreaterThan(100);
    expect(getPixel(r, 1, 0)![3]).toBe(0);
  });
});

describe("gradients", () => {
  it("run from one colour to the other along the drag, smooth without a dither", () => {
    const g = gradientFill(newRaster(5, 1), { x: 0, y: 0 }, { x: 4, y: 0 }, RED, BLUE, "none");
    expect(Array.from(getPixel(g, 0, 0)!)).toEqual(RED);
    expect(Array.from(getPixel(g, 4, 0)!)).toEqual(BLUE);
    expect(Array.from(getPixel(g, 2, 0)!)).toEqual([128, 0, 128, 255]);
  });

  it("use only the two colours when dithered, more of the second as it goes", () => {
    const g = gradientFill(newRaster(8, 8), { x: 0, y: 0 }, { x: 7, y: 0 }, RED, BLUE, "bayer4");
    const colours = new Set<string>();
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) colours.add(getPixel(g, x, y)!.join());
    expect([...colours].sort()).toEqual(["0,0,255,255", "255,0,0,255"]);
    const blueIn = (col: number) => [0, 1, 2, 3, 4, 5, 6, 7].filter((y) => getPixel(g, col, y)![2] === 255).length;
    expect(blueIn(0)).toBe(0);
    expect(blueIn(7)).toBe(8);
    expect(blueIn(5)).toBeGreaterThan(blueIn(2));
  });

  it("stay inside an area, and hold at the ends beyond the drag", () => {
    const g = gradientFill(newRaster(4, 1), { x: 1, y: 0 }, { x: 2, y: 0 }, RED, BLUE, "none", { x: 1, y: 0, w: 3, h: 1 });
    expect(getPixel(g, 0, 0)![3]).toBe(0);
    expect(Array.from(getPixel(g, 3, 0)!)).toEqual(BLUE);
    expect(Array.from(gradientFill(newRaster(2, 1), { x: 0, y: 0 }, { x: 0, y: 0 }, RED, BLUE, "none").data.slice(0, 4))).toEqual(RED);
  });

  it("have patterns that are fair: each dither passes about half of a mid gradient", () => {
    for (const mode of ["bayer2", "bayer4", "checker"] as const) {
      let on = 0;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (0.5 > ditherThreshold(mode, x, y)) on++;
      expect(on).toBe(8);
    }
    expect(ditherThreshold("none", 0, 0)).toBe(-1);
  });
});

describe("brushes cut from a picture", () => {
  it("keeps the visible cells around the middle and stamps them with their colours or one colour", async () => {
    const { brushFromRaster, stampPicture } = await import("./brush");
    const piece = newRaster(3, 3);
    setPixel(piece, 1, 1, [255, 0, 0, 255]);
    setPixel(piece, 2, 1, [0, 255, 0, 255]);
    const b = brushFromRaster(piece)!;
    expect(b.cells).toHaveLength(2);
    const r = newRaster(6, 6);
    stampPicture(r, 3, 3, b);
    expect(getPixel(r, 3, 3)).toEqual([255, 0, 0, 255]);
    expect(getPixel(r, 4, 3)).toEqual([0, 255, 0, 255]);
    stampPicture(r, 1, 1, b, [9, 9, 9, 255]);
    expect(getPixel(r, 2, 1)).toEqual([9, 9, 9, 255]);
    expect(brushFromRaster(newRaster(2, 2))).toBeNull();
  });
});

import { pressureSize } from "./brush";
describe("pen pressure", () => {
  it("scales the brush from a fifth to the whole size, never under one pixel", () => {
    expect(pressureSize(10, 1)).toBe(10);
    expect(pressureSize(10, 0)).toBe(2);
    expect(pressureSize(10, 0.5)).toBe(6);
    expect(pressureSize(1, 0)).toBe(1);
    expect(pressureSize(8, 7)).toBe(8); // out of range is clamped
    expect(pressureSize(8, NaN)).toBe(8);
  });
});
