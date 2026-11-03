import { describe, expect, it } from "vitest";
import { crc32, encodePng } from "./png-encode";
import { newRaster, setPixel } from "./pixels";

/// Reads back what encodePng wrote, for stored blocks only: checks every chunk's CRC and returns the pixels.
function decode(png: Uint8Array) {
  const v = new DataView(png.buffer, png.byteOffset);
  expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  let at = 8;
  const idat: number[] = [];
  let w = 0, h = 0;
  const types: string[] = [];
  while (at < png.length) {
    const len = v.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const body = png.subarray(at + 8, at + 8 + len);
    expect(v.getUint32(at + 8 + len), `${type} crc`).toBe(crc32(png.subarray(at + 4, at + 8 + len)));
    types.push(type);
    if (type === "IHDR") [w, h] = [v.getUint32(at + 8), v.getUint32(at + 12)];
    if (type === "IDAT") for (const b of body) idat.push(b);
    at += 12 + len;
  }
  // zlib header, then stored blocks, then adler
  const z = Uint8Array.from(idat);
  let p = 2;
  const raw: number[] = [];
  for (;;) {
    const last = z[p]! & 1;
    const len = z[p + 1]! | (z[p + 2]! << 8);
    expect((~len & 0xffff)).toBe(z[p + 3]! | (z[p + 4]! << 8));
    for (const b of z.subarray(p + 5, p + 5 + len)) raw.push(b);
    p += 5 + len;
    if (last) break;
  }
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    expect(raw[y * (w * 4 + 1)]).toBe(0);
    data.set(raw.slice(y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1)), y * w * 4);
  }
  return { w, h, data, types };
}

describe("encodePng", () => {
  it("writes a valid RGBA file whose pixels read back", () => {
    const r = newRaster(5, 3);
    setPixel(r, 4, 2, [1, 2, 3, 4]);
    setPixel(r, 0, 0, [255, 128, 7, 255]);
    const d = decode(encodePng(r));
    expect([d.w, d.h, d.types.join()]).toEqual([5, 3, "IHDR,IDAT,IEND"]);
    expect(Array.from(d.data)).toEqual(Array.from(r.data));
  });

  it("splits big pictures over several stored blocks", () => {
    const r = newRaster(200, 200); // 160 KB of rows: three blocks
    for (let i = 0; i < r.data.length; i++) r.data[i] = (i * 7) & 255;
    const d = decode(encodePng(r));
    expect(Array.from(d.data)).toEqual(Array.from(r.data));
  });

  it("has the standard CRC-32 check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});
