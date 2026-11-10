// An animated GIF writer, so a sprite's animation can be shared outside a game. Frames are full pictures (a `Raster` each) with a time in
// milliseconds; transparent pixels stay transparent. GIF has at most 256 colours: a sprite with fewer is written exactly, and one with more has
// its colours merged to the 255 most used (by 4 bits a channel), each pixel taking the nearest one.

import type { Raster } from "./pixels";

export interface GifFrame {
  raster: Raster;
  /// How long the frame shows, in milliseconds (GIF keeps hundredths of a second).
  ms: number;
}

/// The colour table and the index of every pixel of every frame. Index 0 is kept for transparent pixels when any frame has them.
export function indexFrames(frames: Raster[]): { palette: number[][]; indices: Uint8Array[]; transparent: boolean } {
  const key = (r: number, g: number, b: number) => (r << 16) | (g << 8) | b;
  const counts = new Map<number, number>();
  let transparent = false;
  for (const f of frames) for (let i = 0; i < f.data.length; i += 4) {
    if (f.data[i + 3]! < 128) transparent = true;
    else counts.set(key(f.data[i]!, f.data[i + 1]!, f.data[i + 2]!), (counts.get(key(f.data[i]!, f.data[i + 1]!, f.data[i + 2]!)) ?? 0) + 1);
  }
  const room = transparent ? 255 : 256;
  let colors: number[];
  if (counts.size <= room) colors = [...counts.keys()].sort((a, b) => a - b);
  else {
    // too many colours: merge by 4 bits a channel, keep the most used buckets, and use the real average colour of each bucket
    const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
    for (const [k, n] of counts) {
      const [r, g, b] = [(k >> 16) & 255, (k >> 8) & 255, k & 255];
      const bk = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const e = buckets.get(bk) ?? { n: 0, r: 0, g: 0, b: 0 };
      e.n += n;
      e.r += r * n;
      e.g += g * n;
      e.b += b * n;
      buckets.set(bk, e);
    }
    colors = [...buckets.values()]
      .sort((a, b) => b.n - a.n)
      .slice(0, room)
      .map((e) => key(Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)));
  }
  const palette = [...(transparent ? [[0, 0, 0]] : []), ...colors.map((k) => [(k >> 16) & 255, (k >> 8) & 255, k & 255])];
  const exact = new Map<number, number>(colors.map((k, i) => [k, i + (transparent ? 1 : 0)]));
  const nearest = new Map<number, number>();
  const indices = frames.map((f) => {
    const out = new Uint8Array(f.w * f.h);
    for (let p = 0; p < out.length; p++) {
      const i = p * 4;
      if (f.data[i + 3]! < 128) {
        out[p] = 0;
        continue;
      }
      const k = key(f.data[i]!, f.data[i + 1]!, f.data[i + 2]!);
      let idx = exact.get(k) ?? nearest.get(k);
      if (idx === undefined) {
        let best = Infinity;
        idx = transparent ? 1 : 0;
        for (let c = transparent ? 1 : 0; c < palette.length; c++) {
          const [r, g, b] = palette[c]!;
          const d = (r! - f.data[i]!) ** 2 + (g! - f.data[i + 1]!) ** 2 + (b! - f.data[i + 2]!) ** 2;
          if (d < best) {
            best = d;
            idx = c;
          }
        }
        nearest.set(k, idx);
      }
      out[p] = idx;
    }
    return out;
  });
  return { palette, indices, transparent };
}

/// GIF's variable-width LZW: codes start at minSize + 1 bits and grow as the table fills; a clear code resets the table when it is full.
export function lzwEncode(pixels: Uint8Array, minSize: number): Uint8Array {
  const clear = 1 << minSize;
  const end = clear + 1;
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  const emit = (code: number, width: number) => {
    acc |= code << bits;
    bits += width;
    while (bits >= 8) {
      out.push(acc & 255);
      acc >>>= 8;
      bits -= 8;
    }
  };
  let width = minSize + 1;
  let next = end + 1;
  let table = new Map<number, number>();
  emit(clear, width);
  let prefix = pixels[0]!;
  for (let i = 1; i < pixels.length; i++) {
    const c = pixels[i]!;
    const key = (prefix << 8) | c;
    const found = table.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    emit(prefix, width);
    if (next < 4096) {
      table.set(key, next++);
      if (next - 1 === 1 << width && width < 12) width++;
    } else {
      emit(clear, width);
      table = new Map();
      width = minSize + 1;
      next = end + 1;
    }
    prefix = c;
  }
  emit(prefix, width);
  emit(end, width);
  if (bits > 0) out.push(acc & 255);
  return Uint8Array.from(out);
}

const u16 = (n: number) => [n & 255, (n >> 8) & 255];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/// A GIF89a file: every frame the same size, looping for ever (or once, with `loop` false).
export function encodeGif(frames: GifFrame[], loop = true): Uint8Array {
  if (frames.length === 0) throw new Error("a GIF needs at least one frame");
  const { w, h } = frames[0]!.raster;
  if (frames.some((f) => f.raster.w !== w || f.raster.h !== h)) throw new Error("every frame of a GIF must be the same size");
  const { palette, indices, transparent } = indexFrames(frames.map((f) => f.raster));
  let size = 1;
  while (1 << size < Math.max(2, palette.length)) size++;
  const table: number[] = [];
  for (let i = 0; i < 1 << size; i++) table.push(...(palette[i] ?? [0, 0, 0]));
  const out: number[] = [...ascii("GIF89a"), ...u16(w), ...u16(h), 0x80 | 0x70 | (size - 1), 0, 0, ...table];
  if (loop) out.push(0x21, 0xff, 11, ...ascii("NETSCAPE2.0"), 3, 1, 0, 0, 0);
  frames.forEach((f, n) => {
    // graphic control: restore to the background after each frame (so transparent areas show through), the frame's time, the transparent index
    out.push(0x21, 0xf9, 4, (2 << 2) | (transparent ? 1 : 0), ...u16(Math.max(1, Math.round(f.ms / 10))), 0, 0);
    out.push(0x2c, 0, 0, 0, 0, ...u16(w), ...u16(h), 0);
    const minSize = Math.max(2, size);
    out.push(minSize);
    const data = lzwEncode(indices[n]!, minSize);
    for (let i = 0; i < data.length; i += 255) {
      const chunk = data.subarray(i, i + 255);
      out.push(chunk.length, ...chunk);
    }
    out.push(0);
  });
  out.push(0x3b);
  return Uint8Array.from(out);
}

/// A picture scaled up by a whole number with hard edges (for a sprite that is a few dozen pixels wide).
export function scaleRaster(r: Raster, k: number): Raster {
  const f = Math.max(1, Math.round(k));
  if (f === 1) return r;
  const out = { w: r.w * f, h: r.h * f, data: new Uint8ClampedArray(r.w * f * r.h * f * 4) };
  for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) {
    const s = (Math.floor(y / f) * r.w + Math.floor(x / f)) * 4;
    out.data.set(r.data.subarray(s, s + 4), (y * out.w + x) * 4);
  }
  return out;
}
