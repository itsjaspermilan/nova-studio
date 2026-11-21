// A small PNG reader and writer (8-bit RGBA, no interlacing) for the tool scripts: the effects' art is drawn here pixel by pixel and
// written as sprite sheets with their .sprite.json, and the contact sheets that check it are cut from the same files.
import fs from "node:fs";
import zlib from "node:zlib";

export function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

export function decodePng(buf) {
  let p = 8, w = 0, h = 0, ct = 6; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString("latin1", p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    if (type === "IDAT") idat.push(data);
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 4;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = new Uint8ClampedArray(w * h * 4);
  const stride = w * bpp;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[i] = v & 255;
    }
    for (let x = 0; x < w; x++) for (let k = 0; k < 4; k++) out[(y * w + x) * 4 + k] = bpp === 4 ? line[x * 4 + k] : k < 3 ? line[x * 3 + k] : 255;
    prev = line;
  }
  return { w, h, data: out };
}

export function readPng(file) { return decodePng(fs.readFileSync(file)); }
export function writePng(file, w, h, rgba) { fs.mkdirSync(file.slice(0, file.lastIndexOf("/")), { recursive: true }); fs.writeFileSync(file, encodePng(w, h, rgba)); }

// A canvas to compose contact sheets on: `put(img, x, y, scale, blend)` copies a decoded picture (or a frame of it).
export class Canvas {
  constructor(w, h, bg = [14, 16, 28]) { this.w = w; this.h = h; this.data = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) { this.data[i * 4] = bg[0]; this.data[i * 4 + 1] = bg[1]; this.data[i * 4 + 2] = bg[2]; this.data[i * 4 + 3] = 255; } }
  put(img, sx, sy, sw, sh, dx, dy, scale = 1, add = false) {
    for (let y = 0; y < sh * scale; y++) for (let x = 0; x < sw * scale; x++) {
      const X = dx + x, Y = dy + y; if (X < 0 || Y < 0 || X >= this.w || Y >= this.h) continue;
      const si = ((sy + Math.floor(y / scale)) * img.w + sx + Math.floor(x / scale)) * 4, di = (Y * this.w + X) * 4;
      const a = img.data[si + 3] / 255; if (!a) continue;
      for (let k = 0; k < 3; k++) this.data[di + k] = add ? Math.min(255, this.data[di + k] + img.data[si + k] * a) : this.data[di + k] * (1 - a) + img.data[si + k] * a;
    }
  }
  save(file) { writePng(file, this.w, this.h, this.data); }
}
