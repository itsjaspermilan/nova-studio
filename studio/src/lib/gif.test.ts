import { describe, expect, it } from "vitest";
import { encodeGif, indexFrames, lzwEncode, scaleRaster } from "./gif";
import { newRaster, setPixel, type Rgba } from "./pixels";

const RED: Rgba = [255, 0, 0, 255];
const BLUE: Rgba = [0, 0, 255, 255];

/// A small GIF reader, only for these tests: the frames' sizes, times and pixel colours, to check what the writer made.
function readGif(b: Uint8Array) {
  let p = 6;
  const w = b[p]! | (b[p + 1]! << 8);
  const h = b[p + 2]! | (b[p + 3]! << 8);
  const flags = b[p + 4]!;
  p += 7;
  const colors = 1 << ((flags & 7) + 1);
  const table: number[][] = [];
  for (let i = 0; i < colors; i++) table.push([b[p]!, b[p + 1]!, b[p + 2]!]), (p += 3);
  const frames: { ms: number; pixels: (number[] | null)[] }[] = [];
  let looping = false;
  let delay = 0;
  let transparentIndex = -1;
  while (b[p] !== 0x3b) {
    if (b[p] === 0x21) {
      const label = b[p + 1]!;
      if (label === 0xff) looping = true;
      if (label === 0xf9) {
        delay = (b[p + 4]! | (b[p + 5]! << 8)) * 10;
        transparentIndex = b[p + 3]! & 1 ? b[p + 6]! : -1;
      }
      p += 2;
      while (b[p] !== 0) p += b[p]! + 1;
      p++;
    } else if (b[p] === 0x2c) {
      p += 10;
      const minSize = b[p++]!;
      const data: number[] = [];
      while (b[p] !== 0) {
        data.push(...b.subarray(p + 1, p + 1 + b[p]!));
        p += b[p]! + 1;
      }
      p++;
      const idx = lzwDecode(Uint8Array.from(data), minSize);
      frames.push({ ms: delay, pixels: idx.slice(0, w * h).map((i) => (i === transparentIndex ? null : table[i]!)) });
    } else throw new Error("unexpected block " + b[p]);
  }
  return { w, h, frames, looping };
}

function lzwDecode(data: Uint8Array, minSize: number): number[] {
  const clear = 1 << minSize;
  const end = clear + 1;
  let table: number[][] = [];
  const reset = () => {
    table = Array.from({ length: clear }, (_, i) => [i]);
    table.push([], []);
  };
  reset();
  let width = minSize + 1;
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  let pos = 0;
  let prev: number[] | null = null;
  for (;;) {
    while (bits < width && pos < data.length) {
      acc |= data[pos++]! << bits;
      bits += 8;
    }
    if (bits < width) break;
    const code = acc & ((1 << width) - 1);
    acc >>>= width;
    bits -= width;
    if (code === clear) {
      reset();
      width = minSize + 1;
      prev = null;
      continue;
    }
    if (code === end) break;
    let entry: number[];
    if (code < table.length) entry = table[code]!;
    else entry = [...prev!, prev![0]!];
    out.push(...entry);
    if (prev) table.push([...prev, entry[0]!]);
    if (table.length === 1 << width && width < 12) width++;
    prev = entry;
  }
  return out;
}

const two = () => {
  const a = newRaster(3, 2);
  const b = newRaster(3, 2);
  setPixel(a, 0, 0, RED);
  setPixel(a, 1, 1, BLUE);
  setPixel(b, 2, 0, RED);
  return [a, b];
};

describe("the GIF writer", () => {
  it("writes a GIF89a that reads back with the same size, frames, times and colours", () => {
    const [a, b] = two();
    const gif = encodeGif([{ raster: a!, ms: 100 }, { raster: b!, ms: 250 }]);
    expect(String.fromCharCode(...gif.slice(0, 6))).toBe("GIF89a");
    expect(gif.at(-1)).toBe(0x3b);
    const g = readGif(gif);
    expect([g.w, g.h, g.frames.length, g.looping]).toEqual([3, 2, 2, true]);
    expect(g.frames.map((f) => f.ms)).toEqual([100, 250]);
    // frame 1: red at (0,0), blue at (1,1), the rest transparent
    expect(g.frames[0]!.pixels[0]).toEqual([255, 0, 0]);
    expect(g.frames[0]!.pixels[1 * 3 + 1]).toEqual([0, 0, 255]);
    expect(g.frames[0]!.pixels[2]).toBeNull();
    expect(g.frames[1]!.pixels[2]).toEqual([255, 0, 0]);
    expect(g.frames[1]!.pixels[0]).toBeNull();
  });

  it("can be played once instead of looping, and a picture with no transparency needs no transparent index", () => {
    const solid = newRaster(2, 2);
    for (let i = 0; i < 4; i++) setPixel(solid, i % 2, Math.floor(i / 2), RED);
    const once = encodeGif([{ raster: solid, ms: 50 }], false);
    expect(readGif(once).looping).toBe(false);
    expect(indexFrames([solid]).transparent).toBe(false);
    expect(readGif(once).frames[0]!.pixels.every((p) => p && p[0] === 255)).toBe(true);
  });

  it("keeps hundredths of a second, at least one", () => {
    const [a] = two();
    expect(readGif(encodeGif([{ raster: a!, ms: 4 }])).frames[0]!.ms).toBe(10);
    expect(readGif(encodeGif([{ raster: a!, ms: 1234 }])).frames[0]!.ms).toBe(1230);
  });

  it("refuses no frames, or frames of different sizes", () => {
    expect(() => encodeGif([])).toThrow();
    expect(() => encodeGif([{ raster: newRaster(2, 2), ms: 10 }, { raster: newRaster(3, 2), ms: 10 }])).toThrow();
  });

  it("merges the colours of a picture with more than 256, keeping the most used and giving every pixel a near colour", () => {
    const r = newRaster(32, 32);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) setPixel(r, x, y, [x * 8, y * 8, (x * y) % 256, 255]);
    const { palette } = indexFrames([r]);
    expect(palette.length).toBeLessThanOrEqual(256);
    const g = readGif(encodeGif([{ raster: r, ms: 10 }]));
    const px = g.frames[0]!.pixels[5 * 32 + 9]!;
    expect(Math.abs(px[0]! - 72)).toBeLessThan(24);
    expect(Math.abs(px[1]! - 40)).toBeLessThan(24);
  });

  it("round-trips a long run of data through the compressor, including when its table fills and resets", () => {
    const n = 20000;
    const pixels = Uint8Array.from({ length: n }, (_, i) => (i * 7 + ((i >> 3) % 5)) % 16);
    const g = readGif(
      encodeGif([{ raster: { w: 100, h: 200, data: Uint8ClampedArray.from({ length: n * 4 }, (_, i) => (i % 4 === 3 ? 255 : pixels[Math.floor(i / 4)]! * 16)) }, ms: 10 }]),
    );
    expect(g.frames[0]!.pixels.length).toBe(n);
    expect(g.frames[0]!.pixels.every((p, i) => p![0] === pixels[i]! * 16)).toBe(true);
    expect(lzwEncode(pixels, 4).length).toBeLessThan(n);
  });
});

describe("scaling up", () => {
  it("repeats each pixel into a block", () => {
    const r = newRaster(2, 1);
    setPixel(r, 0, 0, RED);
    const big = scaleRaster(r, 3);
    expect([big.w, big.h]).toEqual([6, 3]);
    expect(Array.from(big.data.slice((2 * 6 + 2) * 4, (2 * 6 + 2) * 4 + 4))).toEqual([255, 0, 0, 255]);
    expect(big.data[(0 * 6 + 3) * 4 + 3]).toBe(0);
    expect(scaleRaster(r, 1)).toBe(r);
  });
});

describe("limited colours and dither", () => {
  const ramp = () => {
    const r = newRaster(16, 4);
    for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) setPixel(r, x, y, [x * 16, x * 16, x * 16, 255]);
    return r;
  };
  it("keeps to the number of colours asked for", () => {
    expect(indexFrames([ramp()], { colors: 4 }).palette.length).toBeLessThanOrEqual(4);
    expect(indexFrames([ramp()]).palette.length).toBe(16);
  });
  it("counts the transparent slot in the limit", () => {
    const r = ramp();
    setPixel(r, 0, 0, [0, 0, 0, 0]);
    expect(indexFrames([r], { colors: 4 }).palette.length).toBeLessThanOrEqual(4);
  });
  it("dithering mixes neighbours where flat banding would not, and leaves an exact picture alone", () => {
    const flat = indexFrames([ramp()], { colors: 3 });
    const dith = indexFrames([ramp()], { colors: 3, dither: true });
    const used = (a: Uint8Array) => new Set(a).size;
    expect(used(dith.indices[0]!)).toBeGreaterThanOrEqual(used(flat.indices[0]!));
    expect(Array.from(dith.indices[0]!)).not.toEqual(Array.from(flat.indices[0]!));
    const two = newRaster(2, 1);
    setPixel(two, 0, 0, RED);
    setPixel(two, 1, 0, BLUE);
    expect(indexFrames([two], { colors: 8, dither: true }).indices[0]).toEqual(indexFrames([two]).indices[0]);
  });
  it("still writes a valid file", () => {
    const g = readGif(encodeGif([{ raster: ramp(), ms: 100 }], true, { colors: 4, dither: true }));
    expect(g.w).toBe(16);
    expect(g.frames).toHaveLength(1);
  });
});
