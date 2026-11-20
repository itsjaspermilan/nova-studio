// Pictures for the MCP tools: reading and writing PNG files in Node, and the few drawing helpers the previews share
// (a checker background, outlines, labels in the studio's pixel font, enlarging without blur, contact sheets).

import { deflateSync, inflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { crc32, ihdrFor, joinBytes, pngChunk, PNG_SIGNATURE, scanlines } from "../src/lib/png-encode";
import { drawText, textSize } from "../src/lib/pixel-text";
import { newRaster, type Raster, type Rgba } from "../src/lib/pixels";

void crc32;

/// A PNG with its pixels compressed (the studio's own encoder stores them plain, which is fine for small sprites but not for previews).
export function pngOf(r: Raster): Uint8Array {
  return joinBytes([PNG_SIGNATURE, pngChunk("IHDR", ihdrFor(r.w, r.h)), pngChunk("IDAT", deflateSync(scanlines(r), { level: 6 })), pngChunk("IEND", new Uint8Array(0))]);
}

/// Decodes a PNG (8 or 16 bits a channel, grey, colour or palette, with or without alpha; not interlaced) into RGBA.
export function decodePng(bytes: Uint8Array): Raster {
  if (bytes.length < 33 || bytes[0] !== 137 || bytes[1] !== 80) throw new Error("not a PNG file");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let w = 0, h = 0, depth = 8, type = 6, interlace = 0;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  for (let i = 8; i + 8 <= bytes.length; ) {
    const n = view.getUint32(i);
    const id = String.fromCharCode(bytes[i + 4]!, bytes[i + 5]!, bytes[i + 6]!, bytes[i + 7]!);
    const body = bytes.subarray(i + 8, i + 8 + n);
    if (id === "IHDR") {
      w = view.getUint32(i + 8);
      h = view.getUint32(i + 12);
      depth = body[8]!;
      type = body[9]!;
      interlace = body[12]!;
    } else if (id === "PLTE") palette = body;
    else if (id === "tRNS") trns = body;
    else if (id === "IDAT") idat.push(body);
    else if (id === "IEND") break;
    i += 12 + n;
  }
  if (interlace) throw new Error("interlaced PNG files are not supported");
  if (depth !== 8 && depth !== 16) throw new Error(`PNG files with ${depth} bits a channel are not supported`);
  const channels = type === 0 ? 1 : type === 2 ? 3 : type === 3 ? 1 : type === 4 ? 2 : 4;
  const bpp = channels * (depth / 8);
  const stride = w * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const out = newRaster(w, h);
  const line = new Uint8Array(stride);
  const prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp]! : 0;
      const b = prev[x]!;
      const c = x >= bpp ? prev[x - bpp]! : 0;
      let v = src[x]!;
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = v & 255;
    }
    const step = depth / 8;
    for (let x = 0; x < w; x++) {
      const at = (i: number) => line[(x * channels + i) * step]!;
      const o = (y * w + x) * 4;
      if (type === 0) out.data.set([at(0), at(0), at(0), 255], o);
      else if (type === 2) out.data.set([at(0), at(1), at(2), 255], o);
      else if (type === 3) {
        const p = at(0);
        out.data.set([palette?.[p * 3] ?? 0, palette?.[p * 3 + 1] ?? 0, palette?.[p * 3 + 2] ?? 0, trns && p < trns.length ? trns[p]! : 255], o);
      } else if (type === 4) out.data.set([at(0), at(0), at(0), at(1)], o);
      else out.data.set([at(0), at(1), at(2), at(3)], o);
    }
    prev.set(line);
  }
  return out;
}

export const readPng = (file: string): Raster => decodePng(readFileSync(file));

export const WHITE: Rgba = [255, 255, 255, 255];
export const BLACK: Rgba = [0, 0, 0, 255];
export const INK: Rgba = [232, 236, 244, 255];
export const DIM: Rgba = [150, 158, 172, 255];
export const PAPER: Rgba = [28, 31, 38, 255];

export function fill(r: Raster, x: number, y: number, w: number, h: number, c: Rgba) {
  const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(r.w, Math.round(x + w)), y1 = Math.min(r.h, Math.round(y + h));
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const o = (py * r.w + px) * 4;
      if (c[3] === 255) {
        r.data[o] = c[0];
        r.data[o + 1] = c[1];
        r.data[o + 2] = c[2];
        r.data[o + 3] = 255;
      } else {
        const a = c[3] / 255;
        r.data[o] = Math.round(r.data[o]! * (1 - a) + c[0] * a);
        r.data[o + 1] = Math.round(r.data[o + 1]! * (1 - a) + c[1] * a);
        r.data[o + 2] = Math.round(r.data[o + 2]! * (1 - a) + c[2] * a);
        r.data[o + 3] = Math.max(r.data[o + 3]!, c[3]);
      }
    }
  }
}

/// A one-pixel (or `t`-pixel) outline just inside the box.
export function outline(r: Raster, x: number, y: number, w: number, h: number, c: Rgba, t = 1) {
  fill(r, x, y, w, t, c);
  fill(r, x, y + h - t, w, t, c);
  fill(r, x, y, t, h, c);
  fill(r, x + w - t, y, t, h, c);
}

/// The grey checks that stand for "see-through".
export function checker(r: Raster, x: number, y: number, w: number, h: number, cell = 8) {
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const light = (Math.floor(px / cell) + Math.floor(py / cell)) % 2 === 0;
      const v = light ? 92 : 74;
      const o = ((y + py) * r.w + x + px) * 4;
      if (x + px < 0 || y + py < 0 || x + px >= r.w || y + py >= r.h) continue;
      r.data[o] = v;
      r.data[o + 1] = v;
      r.data[o + 2] = v + 6;
      r.data[o + 3] = 255;
    }
  }
}

/// Draws `src` (or the part of it `from` names) at (x, y), `scale` times bigger (no smoothing when enlarging, averaged when
/// shrinking), blended over what is there. `flip` mirrors it left to right.
export function paste(dst: Raster, src: Raster, x: number, y: number, scale = 1, from?: { x: number; y: number; w: number; h: number }, flip = false, alpha = 1) {
  const f = from ?? { x: 0, y: 0, w: src.w, h: src.h };
  const w = Math.max(1, Math.round(f.w * scale)), h = Math.max(1, Math.round(f.h * scale));
  for (let py = 0; py < h; py++) {
    const dy = Math.round(y) + py;
    if (dy < 0 || dy >= dst.h) continue;
    for (let px = 0; px < w; px++) {
      const dx = Math.round(x) + px;
      if (dx < 0 || dx >= dst.w) continue;
      let cr = 0, cg = 0, cb = 0, ca = 0;
      if (scale >= 1) {
        const sx = f.x + Math.min(f.w - 1, Math.floor((flip ? w - 1 - px : px) / scale));
        const sy = f.y + Math.min(f.h - 1, Math.floor(py / scale));
        if (sx < 0 || sy < 0 || sx >= src.w || sy >= src.h) continue;
        const o = (sy * src.w + sx) * 4;
        cr = src.data[o]!;
        cg = src.data[o + 1]!;
        cb = src.data[o + 2]!;
        ca = src.data[o + 3]!;
      } else {
        // the mean of the source pixels this one covers
        const sx0 = f.x + Math.floor((flip ? w - 1 - px : px) / scale), sy0 = f.y + Math.floor(py / scale);
        const n = Math.max(1, Math.round(1 / scale));
        let count = 0;
        for (let yy = sy0; yy < Math.min(sy0 + n, f.y + f.h, src.h); yy++) {
          for (let xx = sx0; xx < Math.min(sx0 + n, f.x + f.w, src.w); xx++) {
            if (xx < 0 || yy < 0) continue;
            const o = (yy * src.w + xx) * 4;
            const a = src.data[o + 3]!;
            cr += src.data[o]! * a;
            cg += src.data[o + 1]! * a;
            cb += src.data[o + 2]! * a;
            ca += a;
            count++;
          }
        }
        if (!count || !ca) continue;
        cr /= ca;
        cg /= ca;
        cb /= ca;
        ca /= count;
      }
      const a = (ca / 255) * alpha;
      if (a <= 0) continue;
      const o = (dy * dst.w + dx) * 4;
      dst.data[o] = Math.round(dst.data[o]! * (1 - a) + cr * a);
      dst.data[o + 1] = Math.round(dst.data[o + 1]! * (1 - a) + cg * a);
      dst.data[o + 2] = Math.round(dst.data[o + 2]! * (1 - a) + cb * a);
      dst.data[o + 3] = Math.max(dst.data[o + 3]!, Math.round(a * 255));
    }
  }
}

/// Text with a dark edge so that it reads on any picture. Returns its size.
export function label(r: Raster, x: number, y: number, text: string, color: Rgba = INK, scale = 1, edge = true): { w: number; h: number } {
  x = Math.round(x);
  y = Math.round(y);
  if (edge) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) drawText(r, x + dx * scale, y + dy * scale, text, [0, 0, 0, 255], scale);
  return drawText(r, x, y, text, color, scale);
}
export { textSize };

/// Shortens a text to fit a width in pixels at a scale.
export function fit(text: string, width: number, scale = 1): string {
  const max = Math.max(1, Math.floor((width + scale) / (6 * scale)));
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}~`;
}

export function line(r: Raster, x0: number, y0: number, x1: number, y1: number, c: Rgba) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= n; i++) fill(r, Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), 1, 1, c);
}

/// Several pictures in one, in rows, each with a caption under it (a film strip of a run, the moments of a clip).
export function contactSheet(tiles: { picture: Raster; caption: string }[], opts: { columns?: number; maxWidth?: number; title?: string } = {}): Raster {
  if (!tiles.length) throw new Error("no pictures to show");
  const columns = Math.min(tiles.length, opts.columns ?? (tiles.length <= 4 ? tiles.length : tiles.length <= 6 ? 3 : 4));
  const rows = Math.ceil(tiles.length / columns);
  const tw = Math.max(...tiles.map((t) => t.picture.w)), th = Math.max(...tiles.map((t) => t.picture.h));
  const maxWidth = opts.maxWidth ?? 1920;
  const gap = 6;
  const scale = Math.min(1, (maxWidth - gap * (columns + 1)) / (tw * columns));
  const cw = Math.round(tw * scale), ch = Math.round(th * scale);
  const text = cw >= 300 ? 2 : 1;
  const caption = 9 * text + 4;
  const head = opts.title ? 9 * text + 6 : 0;
  const out = newRaster(gap + columns * (cw + gap), head + gap + rows * (ch + caption + gap));
  fill(out, 0, 0, out.w, out.h, PAPER);
  if (opts.title) label(out, gap, 4, fit(opts.title, out.w - gap * 2, text), INK, text, false);
  tiles.forEach((t, i) => {
    const x = gap + (i % columns) * (cw + gap), y = head + gap + Math.floor(i / columns) * (ch + caption + gap);
    paste(out, t.picture, x, y, scale);
    outline(out, x - 1, y - 1, Math.round(t.picture.w * scale) + 2, Math.round(t.picture.h * scale) + 2, [70, 76, 90, 255]);
    label(out, x, y + ch + 3, fit(t.caption, cw, text), INK, text, false);
  });
  return out;
}

/// A part of a picture, enlarged: `[x, y, w, h]` in the picture's pixels, by a whole `zoom`.
export function cropZoom(src: Raster, box: number[] | undefined, zoom = 1): Raster {
  const [x, y, w, h] = box ? box.map((v) => Math.round(v)) : [0, 0, src.w, src.h];
  const bx = Math.max(0, Math.min(src.w - 1, x!)), by = Math.max(0, Math.min(src.h - 1, y!));
  const bw = Math.max(1, Math.min(src.w - bx, w!)), bh = Math.max(1, Math.min(src.h - by, h!));
  const z = Math.max(1, Math.min(16, Math.round(zoom)));
  const out = newRaster(bw * z, bh * z);
  paste(out, src, 0, 0, z, { x: bx, y: by, w: bw, h: bh });
  for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255;
  return out;
}
