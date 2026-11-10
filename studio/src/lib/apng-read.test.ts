import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { encodeApng } from "./apng";
import { readApng } from "./apng-read";
import { encodePng, crc32 } from "./png-encode";
import { getPixel, newRaster, setPixel, type Rgba } from "./pixels";

const RED: Rgba = [255, 0, 0, 255];
const BLUE: Rgba = [0, 0, 255, 255];

describe("reading PNGs", () => {
  it("reads back what the studio's own animated PNG writer made", async () => {
    const a = newRaster(4, 3);
    setPixel(a, 1, 1, RED);
    const b = newRaster(4, 3);
    setPixel(b, 2, 2, BLUE);
    const img = await readApng(encodeApng([{ picture: a, ms: 120 }, { picture: b, ms: 40 }], 5));
    expect(img.animated).toBe(true);
    expect(img.loops).toBe(5);
    expect(img.frames.map((f) => f.ms)).toEqual([120, 40]);
    expect(getPixel(img.frames[0]!.raster, 1, 1)).toEqual(RED);
    expect(getPixel(img.frames[1]!.raster, 2, 2)).toEqual(BLUE);
    expect(getPixel(img.frames[1]!.raster, 1, 1)).toEqual([0, 0, 0, 0]);
  });
  it("reads an ordinary PNG as one frame", async () => {
    const a = newRaster(3, 2);
    setPixel(a, 0, 0, RED);
    const img = await readApng(encodePng(a));
    expect(img.animated).toBe(false);
    expect(img.frames).toHaveLength(1);
    expect(getPixel(img.frames[0]!.raster, 0, 0)).toEqual(RED);
  });
  it("reads compressed data with every filter type, and palettes", async () => {
    // a 4x4 8-bit palette picture, each row with a different filter, written by hand and deflated by Node
    const w = 4, h = 4;
    const idx = [[0, 1, 2, 3], [3, 2, 1, 0], [1, 1, 2, 2], [0, 3, 0, 3]];
    const raw: number[] = [];
    const filters = [0, 1, 2, 4];
    const bpp = 1;
    for (let y = 0; y < h; y++) {
      raw.push(filters[y]!);
      for (let x = 0; x < w; x++) {
        const cur = idx[y]![x]!;
        const left = x >= bpp ? idx[y]![x - bpp]! : 0;
        const up = y ? idx[y - 1]![x]! : 0;
        const ul = y && x >= bpp ? idx[y - 1]![x - bpp]! : 0;
        let pred = 0;
        if (filters[y] === 1) pred = left;
        else if (filters[y] === 2) pred = up;
        else if (filters[y] === 4) {
          const pa = Math.abs(up - ul), pb = Math.abs(left - ul), pc = Math.abs(left + up - 2 * ul);
          pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : ul;
        }
        raw.push((cur - pred) & 255);
      }
    }
    const chunk = (type: string, body: Uint8Array) => {
      const out = new Uint8Array(12 + body.length);
      const dv = new DataView(out.buffer);
      dv.setUint32(0, body.length);
      for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
      out.set(body, 8);
      dv.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
      return out;
    };
    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 3;
    const plte = Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]);
    const trns = Uint8Array.from([255, 255, 255, 0]);
    const parts = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("PLTE", plte), chunk("tRNS", trns), chunk("IDAT", new Uint8Array(deflateSync(Uint8Array.from(raw)))), chunk("IEND", new Uint8Array(0))];
    const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) (png.set(p, o), (o += p.length));
    const img = await readApng(png);
    const colours: Rgba[] = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 0, 0]];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) expect(getPixel(img.frames[0]!.raster, x, y), `${x},${y}`).toEqual(colours[idx[y]![x]!]);
  });
  it("says what is wrong with a file that is not a PNG or is cut short", async () => {
    await expect(readApng(new Uint8Array([1, 2, 3]))).rejects.toThrow(/not a PNG/);
    const ok = encodePng(newRaster(4, 4));
    await expect(readApng(ok.subarray(0, 40))).rejects.toThrow();
  });
});
