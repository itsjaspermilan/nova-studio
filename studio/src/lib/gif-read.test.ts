import { describe, expect, it } from "vitest";
import { encodeGif } from "./gif";
import { readGif } from "./gif-read";
import { getPixel, newRaster, setPixel, type Rgba } from "./pixels";

const RED: Rgba = [255, 0, 0, 255];
const BLUE: Rgba = [0, 0, 255, 255];
const GREEN: Rgba = [0, 255, 0, 255];

describe("reading GIFs", () => {
  it("brings back what the studio's own writer wrote: sizes, colours, times, transparency and looping", () => {
    const a = newRaster(5, 4);
    setPixel(a, 0, 0, RED);
    setPixel(a, 4, 3, BLUE);
    const b = newRaster(5, 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) setPixel(b, x, y, GREEN);
    const g = readGif(encodeGif([{ raster: a, ms: 80 }, { raster: b, ms: 250 }], true));
    expect([g.width, g.height]).toEqual([5, 4]);
    expect(g.frames).toHaveLength(2);
    expect(g.frames.map((f) => f.ms)).toEqual([80, 250]);
    expect(g.loops).toBe(0);
    expect(getPixel(g.frames[0]!.raster, 0, 0)).toEqual(RED);
    expect(getPixel(g.frames[0]!.raster, 4, 3)).toEqual(BLUE);
    expect(getPixel(g.frames[0]!.raster, 2, 2)![3]).toBe(0);
    expect(getPixel(g.frames[1]!.raster, 3, 1)).toEqual(GREEN);
  });
  it("reads a GIF that plays once", () => {
    const a = newRaster(2, 2);
    setPixel(a, 0, 0, RED);
    expect(readGif(encodeGif([{ raster: a, ms: 100 }], false)).loops).toBe(1);
  });
  it("copes with many colours (a longer LZW stream with growing code sizes)", () => {
    const big = newRaster(32, 32);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) setPixel(big, x, y, [x * 8, y * 8, (x + y) * 4, 255]);
    const g = readGif(encodeGif([{ raster: big, ms: 100 }], true));
    // the writer reduces to 256 colours: the picture comes back close, not identical
    let worst = 0;
    for (let y = 0; y < 32; y += 5) for (let x = 0; x < 32; x += 5) {
      const [r, gr, b] = getPixel(g.frames[0]!.raster, x, y)!;
      const want = getPixel(big, x, y)!;
      worst = Math.max(worst, Math.abs(r - want[0]), Math.abs(gr - want[1]), Math.abs(b - want[2]));
    }
    expect(worst).toBeLessThan(40);
  });
  it("reads the classic one-pixel transparent GIF", () => {
    const bytes = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (c) => c.charCodeAt(0));
    const g = readGif(bytes);
    expect([g.width, g.height, g.frames.length]).toEqual([1, 1, 1]);
    expect(getPixel(g.frames[0]!.raster, 0, 0)).toEqual([0, 0, 0, 0]);
  });
  it("says what is wrong with a file that is not a GIF or is cut short", () => {
    expect(() => readGif(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]))).toThrow(/not a GIF/);
    const ok = encodeGif([{ raster: newRaster(2, 2), ms: 100 }], true);
    expect(() => readGif(ok.subarray(0, 14))).toThrow();
  });
});
