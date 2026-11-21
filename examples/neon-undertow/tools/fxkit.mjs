// The pieces the effects' art scripts share: a seeded random, smooth noise, a pixel canvas with the few drawing moves they need
// (discs, soft discs, lines, polygons, an outline), and a sheet writer (a PNG and its .sprite.json, as sprite_write makes them).
import fs from "node:fs";
import { writePng } from "./pnglib.mjs";

export const project = new URL("../", import.meta.url).pathname.replace(/\/$/, "");

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const hash = (x, y, s) => { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 982451653)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const sm = (t) => t * t * (3 - 2 * t);
export function noise(x, y, s = 1) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = sm(x - xi), fy = sm(y - yi);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
export function fbm(x, y, s = 1, oct = 3) { let v = 0, amp = 0.5, f = 1, tot = 0; for (let i = 0; i < oct; i++) { v += noise(x * f, y * f, s + i * 17) * amp; tot += amp; amp *= 0.5; f *= 2; } return v / tot; }

export const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export class Img {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Uint8ClampedArray(w * h * 4); }
  set(x, y, c, a = 255) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= this.w || y >= this.h) return; const i = (y * this.w + x) * 4; this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = a; }
  a(x, y) { if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0; return this.d[(y * this.w + x) * 4 + 3]; }
  // blend a colour over what is there with a share of `a` (0 to 255)
  over(x, y, c, a) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return; const i = (y * this.w + x) * 4, da = this.d[i + 3] / 255, sa = a / 255, oa = sa + da * (1 - sa); if (oa <= 0) return; for (let k = 0; k < 3; k++) this.d[i + k] = (c[k] * sa + this.d[i + k] * da * (1 - sa)) / oa; this.d[i + 3] = oa * 255; }
  fill(f) { for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) { const r = f(x, y); if (r) this.set(x, y, r.slice(0, 3), r[3] ?? 255); } }
  disc(cx, cy, r, c, a = 255) { for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) this.set(x, y, c, a); }
  line(x0, y0, x1, y1, c, w = 1, a = 255) { const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2) + 1; for (let i = 0; i <= n; i++) { const t = i / n; this.disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, w / 2, c, a); } }
  // a dark 1 px outline round everything drawn (where a pixel is empty and a neighbour is not)
  outline(c, minA = 128) { const add = []; for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) { if (this.a(x, y) > 0) continue; if (this.a(x - 1, y) >= minA || this.a(x + 1, y) >= minA || this.a(x, y - 1) >= minA || this.a(x, y + 1) >= minA) add.push([x, y]); } for (const [x, y] of add) this.set(x, y, c, 255); }
  blur(r) { const out = new Uint8ClampedArray(this.d.length); const k = (2 * r + 1) ** 2; for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) { let s = [0, 0, 0, 0], wsum = 0; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= this.w || Y >= this.h) { wsum += 0; continue; } const i = (Y * this.w + X) * 4, a = this.d[i + 3]; s[0] += this.d[i] * a; s[1] += this.d[i + 1] * a; s[2] += this.d[i + 2] * a; s[3] += a; } const o = (y * this.w + x) * 4; if (s[3] > 0) { out[o] = s[0] / s[3]; out[o + 1] = s[1] / s[3]; out[o + 2] = s[2] / s[3]; } out[o + 3] = s[3] / k; } const r2 = new Img(this.w, this.h); r2.d = out; return r2; }
}

// Writes sprites/<name>.png and sprites/<name>.sprite.json from the frames (all one size). tags: [{ name, from, to, loop }]; ms: one number or one per frame.
export function writeSheet(name, frames, { cols, tags = [], ms = 60, pivot } = {}) {
  const fw = frames[0].w, fh = frames[0].h, n = frames.length;
  cols = cols ?? Math.min(n, Math.max(1, Math.floor(2048 / fw)));
  const rows = Math.ceil(n / cols), W = cols * fw, H = rows * fh;
  const data = new Uint8ClampedArray(W * H * 4);
  frames.forEach((f, i) => { const ox = (i % cols) * fw, oy = Math.floor(i / cols) * fh; for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) { const s = (y * fw + x) * 4, d = ((oy + y) * W + ox + x) * 4; for (let k = 0; k < 4; k++) data[d + k] = f.d[s + k]; } });
  writePng(`${project}/sprites/${name}.png`, W, H, data);
  const json = { version: 1, image: `${name}.png`, frame_width: fw, frame_height: fh, columns: cols, frames: n };
  if (Array.isArray(ms)) json.durations_ms = ms; else json.frame_duration_ms = ms;
  if (tags.length) json.tags = tags.map((t) => ({ name: t.name, from: t.from, to: t.to, ...(t.loop === false ? { loop: false } : {}) }));
  if (pivot) json.pivot = pivot;
  fs.writeFileSync(`${project}/sprites/${name}.sprite.json`, JSON.stringify(json, null, 2) + "\n");
  console.log(`${name}: ${n} frames of ${fw}x${fh}`);
}
