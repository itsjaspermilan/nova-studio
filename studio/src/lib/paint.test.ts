import { describe, expect, it } from "vitest";
import { applyBrush } from "./paint";
import { cloneRaster, getPixel, newRaster, setPixel, stamp, type Raster, type Rgba } from "./pixels";

const WHITE: Rgba = [255, 255, 255, 255];
const mark = (r: Raster, ...points: [number, number][]) => points.forEach(([x, y]) => setPixel(r, x, y, WHITE));
const brush = (over = {}) => ({ colour: [200, 0, 0, 255] as Rgba, opacity: 1, erase: false, lockAlpha: false, ...over });
const run = (picture: Raster, mask: Raster, b: ReturnType<typeof brush>, done = new Uint8Array(picture.w * picture.h)) => applyBrush(picture, cloneRaster(picture), mask, done, b);

describe("applyBrush", () => {
  it("paints touched pixels at full strength and reports the changed box", () => {
    const pic = newRaster(4, 4);
    const mask = newRaster(4, 4);
    mark(mask, [1, 1], [2, 2]);
    expect(run(pic, mask, brush())).toEqual({ x: 1, y: 1, w: 2, h: 2 });
    expect(getPixel(pic, 1, 1)).toEqual([200, 0, 0, 255]);
    expect(getPixel(pic, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(run(newRaster(4, 4), newRaster(4, 4), brush())).toBeNull();
  });

  it("blends over what is there by the opacity, and over nothing gives a see-through pixel", () => {
    const pic = newRaster(2, 1);
    setPixel(pic, 0, 0, [0, 0, 200, 255]);
    const mask = newRaster(2, 1);
    mark(mask, [0, 0], [1, 0]);
    run(pic, mask, brush({ opacity: 0.5 }));
    expect(getPixel(pic, 0, 0)).toEqual([100, 0, 100, 255]);
    expect(getPixel(pic, 1, 0)).toEqual([200, 0, 0, 128]);
  });

  it("does not build up when a pixel is touched twice in one stroke", () => {
    const pic = newRaster(1, 1);
    setPixel(pic, 0, 0, [0, 0, 0, 255]);
    const base = cloneRaster(pic);
    const mask = newRaster(1, 1);
    mark(mask, [0, 0]);
    const done = new Uint8Array(1);
    applyBrush(pic, base, mask, done, brush({ opacity: 0.5 }));
    applyBrush(pic, base, mask, done, brush({ opacity: 0.5 }));
    expect(getPixel(pic, 0, 0)).toEqual([100, 0, 0, 255]);
  });

  it("erases by the opacity", () => {
    const pic = newRaster(1, 1);
    setPixel(pic, 0, 0, [9, 9, 9, 255]);
    const mask = newRaster(1, 1);
    mark(mask, [0, 0]);
    run(pic, mask, brush({ erase: true, opacity: 0.25 }));
    expect(getPixel(pic, 0, 0)).toEqual([9, 9, 9, 191]);
  });

  it("with alpha locked, recolours only painted pixels and keeps their alpha", () => {
    const pic = newRaster(2, 1);
    setPixel(pic, 0, 0, [0, 0, 200, 128]);
    const mask = newRaster(2, 1);
    mark(mask, [0, 0], [1, 0]);
    run(pic, mask, brush({ lockAlpha: true }));
    expect(getPixel(pic, 0, 0)).toEqual([200, 0, 0, 128]);
    expect(getPixel(pic, 1, 0)).toEqual([0, 0, 0, 0]);
    const e = newRaster(1, 1);
    setPixel(e, 0, 0, [1, 2, 3, 255]);
    const m = newRaster(1, 1);
    stamp(m, 0, 0, 1, WHITE);
    run(e, m, brush({ erase: true, lockAlpha: true }));
    expect(getPixel(e, 0, 0)).toEqual([1, 2, 3, 255]);
  });
});

import { applyGradient } from "./paint";

describe("applyGradient", () => {
  it("blends from the first colour at the start of the drag to the second at the end", () => {
    const pic = newRaster(5, 1);
    applyGradient(pic, cloneRaster(pic), { x: 0, y: 0 }, { x: 4, y: 0 }, [0, 0, 0, 255], [200, 100, 50, 255], 1, false);
    expect([0, 1, 2, 3, 4].map((x) => getPixel(pic, x, 0)![0])).toEqual([0, 50, 100, 150, 200]);
    expect(getPixel(pic, 4, 0)).toEqual([200, 100, 50, 255]);
  });

  it("goes the other way when dragged backwards or down, and stays inside the picture", () => {
    const pic = newRaster(3, 5);
    applyGradient(pic, cloneRaster(pic), { x: 1, y: 4 }, { x: 1, y: 0 }, [255, 0, 0, 255], [0, 0, 255, 255], 1, false);
    expect(getPixel(pic, 1, 4)).toEqual([255, 0, 0, 255]);
    expect(getPixel(pic, 1, 0)).toEqual([0, 0, 255, 255]);
    expect(getPixel(pic, 0, 2)![3]).toBe(0); // only the dragged column
    const wide = newRaster(2, 2);
    applyGradient(wide, cloneRaster(wide), { x: -5, y: -5 }, { x: 99, y: 99 }, [9, 9, 9, 255], [9, 9, 9, 255], 1, false);
    expect(getPixel(wide, 1, 1)).toEqual([9, 9, 9, 255]);
  });

  it("respects opacity and the alpha lock", () => {
    const pic = newRaster(2, 1);
    setPixel(pic, 0, 0, [0, 0, 100, 255]);
    applyGradient(pic, cloneRaster(pic), { x: 0, y: 0 }, { x: 1, y: 0 }, [200, 0, 0, 255], [200, 0, 0, 255], 0.5, true);
    expect(getPixel(pic, 0, 0)).toEqual([100, 0, 50, 255]);
    expect(getPixel(pic, 1, 0)).toEqual([0, 0, 0, 0]); // locked: nothing there to recolour
  });
});
