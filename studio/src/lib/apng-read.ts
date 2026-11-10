// Reads a PNG, animated or not: every frame as a full-size picture (the disposal and blend steps of the file are followed). 8-bit and 16-bit
// grey, grey with alpha, colour, colour with alpha, and 1, 2, 4 and 8-bit palettes. Interlaced files are refused with a clear message.

import { inflate } from "./inflate";
import { newRaster, type Raster } from "./pixels";

export interface ApngFrame {
  raster: Raster;
  ms: number;
}
export interface ApngImage {
  width: number;
  height: number;
  frames: ApngFrame[];
  /// 0 repeats for ever.
  loops: number;
  animated: boolean;
}

interface Header {
  w: number;
  h: number;
  depth: number;
  colorType: number;
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function unfilter(raw: Uint8Array, w: number, h: number, head: Header): Uint8Array {
  const bpp = Math.max(1, (CHANNELS[head.colorType]! * head.depth) >> 3);
  const stride = Math.ceil((w * CHANNELS[head.colorType]! * head.depth) / 8);
  if (raw.length < h * (stride + 1)) throw new Error("The picture data of this PNG is cut short.");
  const out = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!;
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const up = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? cur[i - bpp]! : 0;
      const above = up ? up[i]! : 0;
      const upLeft = up && i >= bpp ? up[i - bpp]! : 0;
      let add = 0;
      if (f === 1) add = left;
      else if (f === 2) add = above;
      else if (f === 3) add = (left + above) >> 1;
      else if (f === 4) {
        const pa = Math.abs(above - upLeft), pb = Math.abs(left - upLeft), pc = Math.abs(left + above - 2 * upLeft);
        add = pa <= pb && pa <= pc ? left : pb <= pc ? above : upLeft;
      } else if (f !== 0) throw new Error("This PNG uses a filter the reader does not know.");
      cur[i] = (row[i]! + add) & 255;
    }
  }
  return out;
}

function toRgba(px: Uint8Array, w: number, h: number, head: Header, palette: Uint8Array | null, trns: Uint8Array | null): Raster {
  const r = newRaster(w, h);
  const ch = CHANNELS[head.colorType]!;
  const stride = Math.ceil((w * ch * head.depth) / 8);
  const sample = (row: number, index: number): number => {
    if (head.depth === 8) return px[row * stride + index]!;
    if (head.depth === 16) return px[row * stride + index * 2]!; // the high byte is plenty for a screen
    const perByte = 8 / head.depth;
    const byte = px[row * stride + Math.floor(index / perByte)]!;
    const shift = 8 - head.depth * ((index % perByte) + 1);
    return (byte >> shift) & ((1 << head.depth) - 1);
  };
  const scale = head.depth < 8 && head.colorType !== 3 ? 255 / ((1 << head.depth) - 1) : 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (head.colorType === 6) {
        for (let c = 0; c < 4; c++) r.data[o + c] = sample(y, x * 4 + c);
      } else if (head.colorType === 2) {
        for (let c = 0; c < 3; c++) r.data[o + c] = sample(y, x * 3 + c);
        r.data[o + 3] = 255;
        if (trns && trns.length >= 6 && head.depth === 8 && [0, 1, 2].every((c) => r.data[o + c] === trns[c * 2 + 1])) r.data[o + 3] = 0;
      } else if (head.colorType === 0) {
        const v = Math.round(sample(y, x) * scale);
        r.data[o] = r.data[o + 1] = r.data[o + 2] = v;
        r.data[o + 3] = trns && trns.length >= 2 && Math.round(sample(y, x)) === trns[1] ? 0 : 255;
      } else if (head.colorType === 4) {
        const v = sample(y, x * 2);
        r.data[o] = r.data[o + 1] = r.data[o + 2] = v;
        r.data[o + 3] = sample(y, x * 2 + 1);
      } else {
        const i = sample(y, x);
        if (!palette || i * 3 + 2 >= palette.length) throw new Error("This PNG's colour table is too short.");
        r.data[o] = palette[i * 3]!;
        r.data[o + 1] = palette[i * 3 + 1]!;
        r.data[o + 2] = palette[i * 3 + 2]!;
        r.data[o + 3] = trns && i < trns.length ? trns[i]! : 255;
      }
    }
  }
  return r;
}

const cat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
};

export async function readApng(bytes: Uint8Array): Promise<ApngImage> {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 8 || sig.some((b, i) => bytes[i] !== b)) throw new Error("This is not a PNG file.");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let head: Header | null = null;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  let plays = 1;
  let animated = false;
  interface Frame { x: number; y: number; w: number; h: number; ms: number; dispose: number; blend: number; data: Uint8Array[] }
  const frames: Frame[] = [];
  let defaultData: Uint8Array[] = [];
  let current: Frame | null = null;
  for (let at = 8; at + 8 <= bytes.length; ) {
    const len = v.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + len);
    at += 12 + len;
    if (type === "IHDR") {
      head = { w: v.getUint32(at - 12 - len + 8), h: v.getUint32(at - 12 - len + 12), depth: body[8]!, colorType: body[9]! };
      if (body[12] !== 0) throw new Error("Interlaced PNG files cannot be read yet: save it without interlacing.");
      if (!(head.colorType in CHANNELS) || ![1, 2, 4, 8, 16].includes(head.depth)) throw new Error("This PNG's colour format is not supported.");
    } else if (type === "PLTE") palette = body;
    else if (type === "tRNS") trns = body;
    else if (type === "acTL") {
      animated = true;
      plays = new DataView(body.buffer, body.byteOffset).getUint32(4);
    } else if (type === "fcTL") {
      const d = new DataView(body.buffer, body.byteOffset);
      const num = d.getUint16(20), den = d.getUint16(22) || 100;
      current = { w: d.getUint32(4), h: d.getUint32(8), x: d.getUint32(12), y: d.getUint32(16), ms: Math.max(10, Math.round((num / den) * 1000)), dispose: body[24]!, blend: body[25]!, data: [] };
      frames.push(current);
    } else if (type === "IDAT") (current ? current.data : defaultData).push(body);
    else if (type === "fdAT" && current) current.data.push(body.subarray(4));
    else if (type === "IEND") break;
  }
  if (!head) throw new Error("This PNG has no header.");
  const { w, h } = head;
  if (!w || !h || w > 4096 || h > 4096) throw new Error(`A picture of ${w} by ${h} is not supported (up to 4096).`);
  const decode = async (parts: Uint8Array[], fw: number, fh: number) => toRgba(unfilter(await inflate(cat(parts)), fw, fh, head!), fw, fh, head!, palette, trns);
  if (!animated || !frames.length) {
    return { width: w, height: h, frames: [{ raster: await decode(defaultData, w, h), ms: 100 }], loops: 0, animated: false };
  }
  const canvas = newRaster(w, h);
  const out: ApngFrame[] = [];
  for (const f of frames) {
    const piece = await decode(f.data, f.w, f.h);
    const before = new Uint8ClampedArray(canvas.data);
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        const cx = f.x + x, cy = f.y + y;
        if (cx >= w || cy >= h) continue;
        const s = (y * f.w + x) * 4;
        const d = (cy * w + cx) * 4;
        const a = piece.data[s + 3]! / 255;
        if (f.blend === 0 || a === 1) for (let c = 0; c < 4; c++) canvas.data[d + c] = piece.data[s + c]!;
        else if (a > 0) {
          const da = canvas.data[d + 3]! / 255;
          const oa = a + da * (1 - a);
          for (let c = 0; c < 3; c++) canvas.data[d + c] = (piece.data[s + c]! * a + canvas.data[d + c]! * da * (1 - a)) / oa;
          canvas.data[d + 3] = oa * 255;
        }
      }
    }
    out.push({ raster: { w, h, data: new Uint8ClampedArray(canvas.data) }, ms: f.ms });
    if (f.dispose === 1) for (let y = f.y; y < f.y + f.h && y < h; y++) for (let x = f.x; x < f.x + f.w && x < w; x++) canvas.data.fill(0, (y * w + x) * 4, (y * w + x) * 4 + 4);
    else if (f.dispose === 2) canvas.data.set(before);
  }
  return { width: w, height: h, frames: out, loops: plays, animated: true };
}
