// Indexed colour: a picture that holds, for every pixel, a number that points into a palette. Swap a colour in the palette and every pixel of it changes at once, which is
// what pixel artists use it for (palette swaps, day and night versions of one sprite). The studio draws in full colour; this turns a picture into an indexed one against a
// palette, changes its palette, and writes an indexed PNG (colour type 3, with a transparent entry).

import { newRaster, setPixel, type Raster, type Rgba } from "./pixels";
import { PNG_SIGNATURE, joinBytes, pngChunk, zlibStored } from "./png-encode";

export interface Indexed {
  w: number;
  h: number;
  /// One palette index per pixel, row by row.
  indices: Uint8Array;
  /// Up to 256 colours; alpha 0 marks the transparent entry (pixels with no colour).
  palette: Rgba[];
}

const dist = (a: Rgba, b: Rgba) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/// The picture against a palette: each visible pixel takes the nearest colour (exact when the palette has it); each transparent pixel the transparent entry, which is added
/// as palette entry 0 when the palette has none. At most 256 entries, so a palette of 256 colours loses one to transparency.
export function toIndexed(r: Raster, colors: Rgba[]): Indexed {
  const palette: Rgba[] = [[0, 0, 0, 0] as Rgba, ...colors.filter((c) => c[3] !== 0).map((c) => [c[0], c[1], c[2], 255] as Rgba)].slice(0, 256);
  const indices = new Uint8Array(r.w * r.h);
  const cache = new Map<number, number>();
  for (let i = 0; i < indices.length; i++) {
    const a = r.data[i * 4 + 3]!;
    if (a < 128) continue; // index 0: transparent
    const key = (r.data[i * 4]! << 16) | (r.data[i * 4 + 1]! << 8) | r.data[i * 4 + 2]!;
    let best = cache.get(key);
    if (best === undefined) {
      const px: Rgba = [r.data[i * 4]!, r.data[i * 4 + 1]!, r.data[i * 4 + 2]!, 255];
      let d = Infinity;
      best = 0;
      for (let k = 1; k < palette.length; k++) {
        const dk = dist(px, palette[k]!);
        if (dk < d) {
          d = dk;
          best = k;
        }
      }
      cache.set(key, best);
    }
    indices[i] = best;
  }
  return { w: r.w, h: r.h, indices, palette };
}

/// A palette made of the picture's own colours (up to 255, most used first), for when there is no palette yet.
export function paletteOfPicture(r: Raster, limit = 255): Rgba[] {
  const counts = new Map<number, number>();
  for (let i = 0; i < r.w * r.h; i++) {
    if (r.data[i * 4 + 3]! < 128) continue;
    const key = (r.data[i * 4]! << 16) | (r.data[i * 4 + 1]! << 8) | r.data[i * 4 + 2]!;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([k]) => [(k >> 16) & 255, (k >> 8) & 255, k & 255, 255] as Rgba);
}

/// The full-colour picture an indexed one stands for.
export function fromIndexed(x: Indexed): Raster {
  const r = newRaster(x.w, x.h);
  for (let i = 0; i < x.indices.length; i++) setPixel(r, i % x.w, Math.floor(i / x.w), x.palette[x.indices[i]!] ?? [0, 0, 0, 0]);
  return r;
}

/// The same pixels with a different palette: entry k becomes `colors[k - 1]` (entry 0 stays transparent); entries the new palette has no colour for keep their old one.
export function swapPalette(x: Indexed, colors: Rgba[]): Indexed {
  const palette = x.palette.map((c, k) => (k === 0 ? c : colors[k - 1] ? ([colors[k - 1]![0], colors[k - 1]![1], colors[k - 1]![2], 255] as Rgba) : c));
  return { ...x, palette };
}

/// Changes one palette entry (never entry 0, the transparent one).
export function setPaletteColor(x: Indexed, index: number, color: Rgba): Indexed {
  if (index < 1 || index >= x.palette.length) return x;
  return { ...x, palette: x.palette.map((c, k) => (k === index ? ([color[0], color[1], color[2], 255] as Rgba) : c)) };
}

/// A PNG with a palette: 8 bits an index, PLTE for the colours and tRNS marking entry 0 clear.
export function encodeIndexedPng(x: Indexed): Uint8Array {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, x.w);
  v.setUint32(4, x.h);
  ihdr[8] = 8;
  ihdr[9] = 3; // indexed colour
  const raw = new Uint8Array(x.h * (x.w + 1));
  for (let y = 0; y < x.h; y++) raw.set(x.indices.subarray(y * x.w, (y + 1) * x.w), y * (x.w + 1) + 1);
  const plte = new Uint8Array(x.palette.length * 3);
  x.palette.forEach((c, k) => plte.set([c[0], c[1], c[2]], k * 3));
  return joinBytes([PNG_SIGNATURE, pngChunk("IHDR", ihdr), pngChunk("PLTE", plte), pngChunk("tRNS", new Uint8Array([0])), pngChunk("IDAT", zlibStored(raw)), pngChunk("IEND", new Uint8Array(0))]);
}

