import { describe, expect, it } from "vitest";
import { encodeIndexedPng, fromIndexed, paletteOfPicture, setPaletteColor, swapPalette, toIndexed } from "./indexed";
import { getPixel, newRaster, setPixel, type Rgba } from "./pixels";
import { inflate } from "./inflate";

const RED: Rgba = [255, 0, 0, 255];
const GREEN: Rgba = [0, 255, 0, 255];
const BLUE: Rgba = [0, 0, 255, 255];
function pic() {
  const r = newRaster(3, 2);
  setPixel(r, 0, 0, RED);
  setPixel(r, 1, 0, GREEN);
  setPixel(r, 2, 0, [250, 10, 10, 255]); // nearly red
  setPixel(r, 0, 1, BLUE);
  return r; // (1,1) and (2,1) clear
}

describe("indexed colour", () => {
  it("points every pixel at the nearest palette colour and every clear one at entry 0", () => {
    const x = toIndexed(pic(), [RED, GREEN, BLUE]);
    expect(x.palette.length).toBe(4);
    expect(x.palette[0]![3]).toBe(0);
    expect(Array.from(x.indices)).toEqual([1, 2, 1, 3, 0, 0]); // the nearly red pixel took red
    expect(fromIndexed(x).data.slice(8, 12)).toEqual(new Uint8ClampedArray([255, 0, 0, 255]));
    expect(getPixel(fromIndexed(x), 1, 1)![3]).toBe(0);
  });
  it("a palette swap recolours every pixel of an index at once, and leaves the clear ones", () => {
    const x = toIndexed(pic(), [RED, GREEN, BLUE]);
    const night = swapPalette(x, [[40, 0, 80, 255], GREEN, BLUE]);
    const r = fromIndexed(night);
    expect(getPixel(r, 0, 0)).toEqual([40, 0, 80, 255]);
    expect(getPixel(r, 2, 0)).toEqual([40, 0, 80, 255]); // both reds changed together
    expect(getPixel(r, 1, 0)).toEqual(GREEN);
    expect(getPixel(r, 2, 1)![3]).toBe(0);
    expect(Array.from(night.indices)).toEqual(Array.from(x.indices)); // the pixels themselves did not move
    const one = setPaletteColor(x, 2, [9, 9, 9, 255]);
    expect(getPixel(fromIndexed(one), 1, 0)).toEqual([9, 9, 9, 255]);
    expect(setPaletteColor(x, 0, [1, 2, 3, 255])).toBe(x);
  });
  it("makes a palette from a picture's own colours, most used first", () => {
    const r = newRaster(4, 1);
    for (const [x, c] of [[0, BLUE], [1, RED], [2, RED], [3, RED]] as [number, Rgba][]) setPixel(r, x, 0, c);
    expect(paletteOfPicture(r)).toEqual([RED, BLUE]);
    expect(paletteOfPicture(newRaster(2, 2))).toEqual([]);
  });
  it("is limited to 256 entries", () => {
    const many: Rgba[] = Array.from({ length: 300 }, (_, i) => [i % 256, (i * 7) % 256, 0, 255]);
    expect(toIndexed(newRaster(1, 1), many).palette.length).toBe(256);
  });
  it("is written as a PNG with a palette, a clear entry and the right pixels", async () => {
    const x = toIndexed(pic(), [RED, GREEN, BLUE]);
    const png = encodeIndexedPng(x);
    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const types: string[] = [];
    let at = 8;
    let idat = new Uint8Array(0);
    let colourType = 0;
    while (at < png.length) {
      const len = new DataView(png.buffer, png.byteOffset + at).getUint32(0);
      const type = String.fromCharCode(...png.slice(at + 4, at + 8));
      types.push(type);
      if (type === "IHDR") colourType = png[at + 8 + 9]!;
      if (type === "IDAT") idat = png.slice(at + 8, at + 8 + len);
      at += 12 + len;
    }
    expect(types).toEqual(["IHDR", "PLTE", "tRNS", "IDAT", "IEND"]);
    expect(colourType).toBe(3);
    const raw = await inflate(idat);
    expect(Array.from(raw)).toEqual([0, 1, 2, 1, 0, 3, 0, 0]); // a filter byte (0) before each row
  });
});
