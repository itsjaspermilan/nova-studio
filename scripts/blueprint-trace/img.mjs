// Tiny PNG tools for tracing blueprints: decode, crop/zoom with a coordinate grid, silhouettes.
import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync, deflateSync } from "node:zlib";

export function load(path) {
  const b = readFileSync(path);
  let p = 8, w = 0, h = 0, depth = 0, type = 0, pal = null;
  const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p), kind = b.toString("ascii", p + 4, p + 8), d = b.subarray(p + 8, p + 8 + len);
    if (kind === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; type = d[9]; if (d[12]) throw new Error("interlaced"); }
    else if (kind === "PLTE") pal = d;
    else if (kind === "IDAT") idat.push(d);
    p += 12 + len;
  }
  if (depth !== 8) throw new Error("depth " + depth);
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type], raw = inflateSync(Buffer.concat(idat)), stride = w * ch;
  const px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? px[y * stride + i - ch] : 0, up = y ? px[(y - 1) * stride + i] : 0, ul = y && i >= ch ? px[(y - 1) * stride + i - ch] : 0;
      let v = row[i];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const pp = a + up - ul, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - ul); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : ul; }
      px[y * stride + i] = v;
    }
  }
  const g = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (type === 3) g[i] = (pal[px[i] * 3] + pal[px[i] * 3 + 1] + pal[px[i] * 3 + 2]) / 3;
    else if (ch >= 3) g[i] = (px[i * ch] + px[i * ch + 1] + px[i * ch + 2]) / 3;
    else g[i] = px[i * ch];
  }
  return { w, h, g };
}
const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function save(path, w, h, rgb) {
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; Buffer.from(rgb.buffer, y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1); }
  const chunk = (kind, d) => { const o = Buffer.alloc(12 + d.length); o.writeUInt32BE(d.length, 0); o.write(kind, 4, "ascii"); d.copy(o, 8); o.writeUInt32BE(crc(o.subarray(4, 8 + d.length)), 8 + d.length); return o; };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}
const FONT = { "0": "111101101101111", "1": "010110010010111", "2": "111001111100111", "3": "111001111001111", "4": "101101111001001", "5": "111100111001111", "6": "111100111101111", "7": "111001001001001", "8": "111101111101111", "9": "111101111001111", "-": "000000111000000", ".": "000000000000010" };
export class Canvas {
  constructor(w, h) { this.w = w; this.h = h; this.rgb = new Uint8Array(w * h * 3).fill(255); }
  set(x, y, c, a = 1) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= this.w || y >= this.h) return; const i = (y * this.w + x) * 3; for (let k = 0; k < 3; k++) this.rgb[i + k] = this.rgb[i + k] * (1 - a) + c[k] * a; }
  line(x0, y0, x1, y1, c, a = 1) { const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) || 1; for (let i = 0; i <= n; i++) this.set(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), c, a); }
  text(x, y, s, c, k = 2) { for (const chr of String(s)) { const f = FONT[chr]; if (f) for (let i = 0; i < 15; i++) if (f[i] === "1") for (let dx = 0; dx < k; dx++) for (let dy = 0; dy < k; dy++) this.set(x + (i % 3) * k + dx, y + ((i / 3) | 0) * k + dy, c); x += 4 * k; } }
  dot(x, y, c, r = 2) { for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) this.set(x + dx, y + dy, c); }
  save(path) { save(path, this.w, this.h, this.rgb); }
}
/// A zoomed crop of the image with a grid in model units. cal = { ox, oy, k (pixels per unit), sx (+1: u grows to the right, -1: to the left) }; v always grows upward.
export function view(img, out, [x0, y0, x1, y1], zoom, cal, step = 1, draw = null) {
  const w = Math.round((x1 - x0) * zoom), h = Math.round((y1 - y0) * zoom), c = new Canvas(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const g = img.g[Math.min(img.h - 1, (y0 + y / zoom) | 0) * img.w + Math.min(img.w - 1, (x0 + x / zoom) | 0)]; const i = (y * w + x) * 3; c.rgb[i] = c.rgb[i + 1] = c.rgb[i + 2] = g; }
  const X = (u) => (cal.ox + cal.sx * u * cal.k - x0) * zoom, ky = cal.ky ?? cal.k, Y = (v) => (cal.oy - v * ky - y0) * zoom;
  if (cal) {
    const u0 = Math.min((x0 - cal.ox) / cal.k / cal.sx, (x1 - cal.ox) / cal.k / cal.sx), u1 = Math.max((x0 - cal.ox) / cal.k / cal.sx, (x1 - cal.ox) / cal.k / cal.sx);
    const v0 = (cal.oy - y1) / ky, v1 = (cal.oy - y0) / ky;
    for (let u = Math.ceil(u0 / step) * step; u <= u1; u += step) { const major = Math.abs(u / (step * 5) - Math.round(u / (step * 5))) < 1e-6; c.line(X(u), 0, X(u), h, major ? [255, 0, 0] : [255, 150, 150], major ? 0.55 : 0.3); if (major || zoom * cal.k * step > 30) c.text(X(u) + 2, 2, Math.round(u * 10) / 10, [200, 0, 0]); }
    for (let v = Math.ceil(v0 / step) * step; v <= v1; v += step) { const major = Math.abs(v / (step * 5) - Math.round(v / (step * 5))) < 1e-6; c.line(0, Y(v), w, Y(v), major ? [0, 0, 255] : [150, 150, 255], major ? 0.55 : 0.3); if (major || zoom * ky * step > 30) c.text(2, Y(v) + 2, Math.round(v * 10) / 10, [0, 0, 200]); }
  }
  if (draw) draw(c, X, Y);
  c.save(out);
}
/// Everything reachable from the border of the rectangle through light pixels is "outside"; returns a mask (1 = the drawing and what it encloses).
export function solid(img, [x0, y0, x1, y1], thr = 150) {
  const w = x1 - x0, h = y1 - y0, m = new Uint8Array(w * h).fill(1), stack = [];
  const light = (x, y) => img.g[(y0 + y) * img.w + x0 + x] > thr;
  const push = (x, y) => { if (x >= 0 && y >= 0 && x < w && y < h && m[y * w + x] && light(x, y)) { m[y * w + x] = 0; stack.push(x, y); } };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) { const y = stack.pop(), x = stack.pop(); push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1); }
  return { w, h, m, x0, y0 };
}
/// For each column: the first and last row of a run of solid pixels at least `min` long (null where none).
export function columns(s, min = 6) {
  const out = [];
  for (let x = 0; x < s.w; x++) {
    let top = null, bot = null, run = 0;
    for (let y = 0; y <= s.h; y++) {
      if (y < s.h && s.m[y * s.w + x]) run++;
      else { if (run >= min) { if (top === null) top = y - run; bot = y - 1; } run = 0; }
    }
    out.push(top === null ? null : [top + s.y0, bot + s.y0]);
  }
  return out;
}
export function rows(s, min = 6) {
  const out = [];
  for (let y = 0; y < s.h; y++) {
    let a = null, b = null, run = 0;
    for (let x = 0; x <= s.w; x++) {
      if (x < s.w && s.m[y * s.w + x]) run++;
      else { if (run >= min) { if (a === null) a = x - run; b = x - 1; } run = 0; }
    }
    out.push(a === null ? null : [a + s.x0, b + s.x0]);
  }
  return out;
}
