// Reads an animated GIF: every frame as a full-size picture (the disposal methods are followed, so a frame that only drew what changed still comes out
// whole), how long each shows, and whether it loops. Handles global and local colour tables, transparency and interlaced frames.

import { newRaster, type Raster } from "./pixels";

export interface GifFrame {
  raster: Raster;
  ms: number;
}
export interface GifImage {
  width: number;
  height: number;
  frames: GifFrame[];
  /// 0 repeats for ever; otherwise how many times it plays (1 when the file has no loop block).
  loops: number;
}

/// Decodes the LZW data of one image into colour indices (`pixels` of them).
function lzwDecode(min: number, data: Uint8Array, pixels: number): Uint8Array {
  const out = new Uint8Array(pixels);
  const clear = 1 << min;
  const eoi = clear + 1;
  const prefix = new Int16Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4097);
  let size = min + 1;
  let next = eoi + 1;
  let prev = -1;
  let first = 0;
  let o = 0;
  let bits = 0;
  let acc = 0;
  let at = 0;
  for (let i = 0; i < clear; i++) suffix[i] = i;
  while (o < pixels) {
    while (bits < size && at < data.length) {
      acc |= data[at++]! << bits;
      bits += 8;
    }
    if (bits < size) break;
    let code = acc & ((1 << size) - 1);
    acc >>>= size;
    bits -= size;
    if (code === clear) {
      size = min + 1;
      next = eoi + 1;
      prev = -1;
      continue;
    }
    if (code === eoi) break;
    if (prev === -1) {
      out[o++] = suffix[code]!;
      prev = code;
      first = code;
      continue;
    }
    const incoming = code;
    let sp = 0;
    if (code >= next) {
      stack[sp++] = first;
      code = prev;
    }
    while (code >= clear) {
      stack[sp++] = suffix[code]!;
      code = prefix[code]!;
    }
    first = suffix[code]!;
    stack[sp++] = first;
    if (next < 4096) {
      prefix[next] = prev;
      suffix[next] = first;
      next++;
      if ((next & ((1 << size) - 1)) === 0 && size < 12) size++;
    }
    prev = incoming;
    while (sp > 0 && o < pixels) out[o++] = stack[--sp]!;
  }
  return out;
}

export function readGif(bytes: Uint8Array): GifImage {
  const sig = String.fromCharCode(...bytes.subarray(0, 6));
  if (sig !== "GIF87a" && sig !== "GIF89a") throw new Error("This is not a GIF file (it does not start with GIF87a or GIF89a).");
  const u16 = (p: number) => bytes[p]! | (bytes[p + 1]! << 8);
  const width = u16(6);
  const height = u16(8);
  if (!width || !height || width > 4096 || height > 4096) throw new Error(`A GIF of ${width} by ${height} is not supported (up to 4096).`);
  const flags = bytes[10]!;
  let p = 13;
  let global: Uint8Array | null = null;
  if (flags & 0x80) {
    const n = 3 * (1 << ((flags & 7) + 1));
    global = bytes.subarray(p, p + n);
    p += n;
  }
  const canvas = newRaster(width, height);
  const frames: GifFrame[] = [];
  let loops = 1;
  let delay = 10;
  let transparent = -1;
  let disposal = 0;
  let pending: { disposal: number; x: number; y: number; w: number; h: number; saved: Uint8ClampedArray | null } | null = null;
  const subBlocks = (): Uint8Array => {
    const parts: Uint8Array[] = [];
    let total = 0;
    while (p < bytes.length) {
      const n = bytes[p++]!;
      if (n === 0) break;
      parts.push(bytes.subarray(p, p + n));
      p += n;
      total += n;
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (const part of parts) (out.set(part, o), (o += part.length));
    return out;
  };
  while (p < bytes.length) {
    const b = bytes[p++]!;
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = bytes[p++]!;
      if (label === 0xf9) {
        const body = subBlocks();
        disposal = (body[0]! >> 2) & 7;
        transparent = body[0]! & 1 ? body[3]! : -1;
        delay = (body[1]! | (body[2]! << 8)) * 10;
      } else if (label === 0xff) {
        const body = subBlocks();
        // (the application block's name sits in its first sub-block, the loop count in the next: both are joined here)
        const text = String.fromCharCode(...body.subarray(0, 11));
        if (text.startsWith("NETSCAPE2.0") && body[11] === 1) loops = body[12]! | (body[13]! << 8);
      } else subBlocks();
      continue;
    }
    if (b !== 0x2c) throw new Error("The GIF is damaged (an unknown block).");
    const left = u16(p), top = u16(p + 2), w = u16(p + 4), h = u16(p + 6);
    const packed = bytes[p + 8]!;
    p += 9;
    let table = global;
    if (packed & 0x80) {
      const n = 3 * (1 << ((packed & 7) + 1));
      table = bytes.subarray(p, p + n);
      p += n;
    }
    if (!table) throw new Error("The GIF has no colour table.");
    const min = bytes[p++]!;
    if (min < 2 || min > 8) throw new Error("The GIF's picture data is damaged.");
    const indices = lzwDecode(min, subBlocks(), w * h);
    // what the previous frame asked to happen before this one is drawn
    if (pending) {
      if (pending.disposal === 2) {
        for (let y = pending.y; y < pending.y + pending.h && y < height; y++) for (let x = pending.x; x < pending.x + pending.w && x < width; x++) canvas.data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 4);
      } else if (pending.disposal === 3 && pending.saved) canvas.data.set(pending.saved);
    }
    const saved = disposal === 3 ? new Uint8ClampedArray(canvas.data) : null;
    const rows = packed & 0x40 ? interlacedRows(h) : null;
    for (let row = 0; row < h; row++) {
      const y = top + (rows ? rows[row]! : row);
      if (y >= height) continue;
      for (let col = 0; col < w; col++) {
        const x = left + col;
        const idx = indices[row * w + col]!;
        if (x >= width || idx === transparent) continue;
        const o = (y * width + x) * 4;
        canvas.data[o] = table[idx * 3]!;
        canvas.data[o + 1] = table[idx * 3 + 1]!;
        canvas.data[o + 2] = table[idx * 3 + 2]!;
        canvas.data[o + 3] = 255;
      }
    }
    frames.push({ raster: { w: width, h: height, data: new Uint8ClampedArray(canvas.data) }, ms: delay || 100 });
    pending = { disposal, x: left, y: top, w, h, saved };
    disposal = 0;
    transparent = -1;
    delay = 10;
  }
  if (!frames.length) throw new Error("There is no picture in this GIF.");
  return { width, height, frames, loops };
}

/// For an interlaced image: the real row of each row in the file (every 8th from 0, every 8th from 4, every 4th from 2, every 2nd from 1).
function interlacedRows(h: number): number[] {
  const out: number[] = [];
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]] as const) for (let y = start; y < h; y += step) out.push(y);
  return out;
}
