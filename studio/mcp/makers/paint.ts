// What every maker draws with: a small picture with pixel tools, colours with shade ramps, and repeatable random numbers.
// Nothing here knows about Nova's files; the makers turn these pictures into ordinary sprite sheets (see sheet.ts).

import { newRaster, type Raster, type Rgba } from "../../src/lib/pixels";

export type { Raster, Rgba };

// ---- repeatable random numbers -----------------------------------------------------------------------------------------
export function rngOf(seed: number): () => number {
  let a = (Math.floor(seed) ^ 0x9e3779b9) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/// A number from 0 to 1 that depends only on the cell and the seed (the same map always gets the same scatter).
export function hash2(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1274126177)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

export const seedOf = (text: string): number => {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619) >>> 0;
  return h;
};

// ---- colours -----------------------------------------------------------------------------------------------------------
export function hex(text: string): Rgba {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(text.trim());
  if (!m) throw new Error(`'${text}' is not a colour: write "#rrggbb"`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, m[2] ? parseInt(m[2], 16) : 255];
}
export const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v.trim());
export const toHex = (c: Rgba): string => `#${[c[0], c[1], c[2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

function toHsl(c: Rgba): [number, number, number] {
  const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function fromHsl(h: number, s: number, l: number, a = 255): Rgba {
  h = ((h % 360) + 360) % 360;
  s = Math.min(1, Math.max(0, s));
  l = Math.min(1, Math.max(0, l));
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255), a];
}

export function mix(a: Rgba, b: Rgba, t: number): Rgba {
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t), Math.round(a[3] + (b[3] - a[3]) * t)];
}

/// Moves a hue towards another the short way round.
function hueTowards(h: number, target: number, amount: number): number {
  const d = ((target - h + 540) % 360) - 180;
  return h + Math.sign(d) * Math.min(Math.abs(d), amount);
}

/// One colour shaded `by` steps: negative is darker (and a little bluer and richer, as shadows are), positive lighter (and
/// a little yellower and paler). One step is about a tenth of the way to black or white.
export function shade(c: Rgba, by: number): Rgba {
  const [h, s, l] = toHsl(c);
  if (by === 0) return c;
  const dark = by < 0, n = Math.abs(by);
  const hue = s < 0.06 ? h : hueTowards(h, dark ? 250 : 55, n * (dark ? 5 : 6));
  const sat = dark ? s * (1 - 0.03 * n) : s * (1 - 0.07 * n);
  const light = dark ? l * (1 - 0.16 * n) : l + (1 - l) * 0.2 * n;
  return fromHsl(hue, s < 0.06 ? s : sat, light, c[3]);
}

/// Five shades of a colour, dark to light; the middle one (2) is the colour itself.
export type Ramp = [Rgba, Rgba, Rgba, Rgba, Rgba];
export const ramp = (c: Rgba): Ramp => [shade(c, -2.2), shade(c, -1), c, shade(c, 1), shade(c, 2.1)];

/// A ramp from what a recipe gives: one colour, or five written out dark to light.
export function rampOf(v: unknown, what: string): Ramp {
  if (isHex(v)) return ramp(hex(v));
  if (Array.isArray(v) && v.length === 5 && v.every(isHex)) return v.map((c) => hex(c)) as Ramp;
  throw new Error(`${what} is one colour ("#rrggbb") or five shades from dark to light, got ${JSON.stringify(v)}`);
}

/// Plain colour words a recipe may use instead of "#rrggbb".
export const DYES: Record<string, string> = {
  red: "#d9483b", crimson: "#a8324a", orange: "#e8862e", yellow: "#f2c53d", gold: "#e3a92f", green: "#4fa84a", forest: "#2f6f47", teal: "#2f9c93",
  blue: "#3f7fd6", navy: "#2c4a8a", sky: "#6bb7ea", purple: "#8a56c2", violet: "#6a4fb0", pink: "#ea7fa8", brown: "#8a5a34", tan: "#c9a36a",
  white: "#f1ede4", cream: "#ead9b5", grey: "#8d93a0", gray: "#8d93a0", silver: "#b9c0cc", black: "#34303c", bone: "#e9e2cf",
};
export function colourOf(v: unknown, what: string, fallback?: string): Rgba {
  if (v === undefined || v === null) {
    if (fallback) return hex(DYES[fallback] ?? fallback);
    throw new Error(`${what} needs a colour`);
  }
  const s = String(v).trim().toLowerCase();
  if (DYES[s]) return hex(DYES[s]!);
  if (isHex(s)) return hex(s);
  throw new Error(`${what}: '${v}' is not a colour. Write "#rrggbb" or one of ${Object.keys(DYES).join(", ")}`);
}

// ---- a picture to draw on ----------------------------------------------------------------------------------------------
export class Img {
  r: Raster;
  constructor(public w: number, public h: number) {
    this.r = newRaster(w, h);
  }
  inside(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  set(x: number, y: number, c: Rgba | null) {
    x = Math.round(x);
    y = Math.round(y);
    if (!this.inside(x, y)) return;
    const o = (y * this.w + x) * 4;
    if (!c) this.r.data.fill(0, o, o + 4);
    else if (c[3] === 255 || this.r.data[o + 3] === 0) this.r.data.set(c, o);
    else {
      const a = c[3] / 255;
      for (let i = 0; i < 3; i++) this.r.data[o + i] = Math.round(this.r.data[o + i]! * (1 - a) + c[i]! * a);
    }
  }
  get(x: number, y: number): Rgba | null {
    if (!this.inside(x, y)) return null;
    const o = (y * this.w + x) * 4;
    return this.r.data[o + 3] ? [this.r.data[o]!, this.r.data[o + 1]!, this.r.data[o + 2]!, this.r.data[o + 3]!] : null;
  }
  has(x: number, y: number) {
    return this.inside(x, y) && this.r.data[(y * this.w + x) * 4 + 3]! > 0;
  }
  /// Solid enough to carry an outline (a soft shadow on the ground is not).
  firm(x: number, y: number) {
    return this.inside(x, y) && this.r.data[(y * this.w + x) * 4 + 3]! > 200;
  }
  rect(x: number, y: number, w: number, h: number, c: Rgba | null) {
    for (let py = Math.round(y); py < Math.round(y + h); py++) for (let px = Math.round(x); px < Math.round(x + w); px++) this.set(px, py, c);
  }
  /// An ellipse about (cx, cy): a whole number is the middle of a pixel, a half the line between two.
  ellipse(cx: number, cy: number, rx: number, ry: number, c: Rgba | null | ((x: number, y: number) => Rgba | null | undefined)) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        if (((x - cx) / (rx + 0.25)) ** 2 + ((y - cy) / (ry + 0.25)) ** 2 > 1) continue;
        const v = typeof c === "function" ? c(x, y) : c;
        if (v !== undefined) this.set(x, y, v);
      }
    }
  }
  line(x0: number, y0: number, x1: number, y1: number, c: Rgba | null) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= steps; i++) this.set(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, c);
  }
  /// Every pixel a function of where it is (undefined leaves it).
  each(fn: (x: number, y: number, now: Rgba | null) => Rgba | null | undefined) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const v = fn(x, y, this.get(x, y));
      if (v !== undefined) this.set(x, y, v);
    }
  }
  /// The outline rule of the makers: every see-through pixel beside a drawn one becomes the outline colour (the four
  /// sides only, so corners stay round). Soft shadows do not get one.
  outline(c: Rgba) {
    const edge: [number, number][] = [];
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (this.firm(x, y)) continue;
      if (this.firm(x - 1, y) || this.firm(x + 1, y) || this.firm(x, y - 1) || this.firm(x, y + 1)) edge.push([x, y]);
    }
    for (const [x, y] of edge) {
      const o = (y * this.w + x) * 4;
      this.r.data.set(c, o);
    }
    return this;
  }
  /// Draws another picture over this one at (x, y); see-through pixels leave what is there.
  draw(src: Img, x = 0, y = 0) {
    for (let py = 0; py < src.h; py++) for (let px = 0; px < src.w; px++) {
      const c = src.get(px, py);
      if (c) this.set(x + px, y + py, c);
    }
    return this;
  }
  part(x: number, y: number, w: number, h: number): Img {
    const out = new Img(w, h);
    for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
      const c = this.get(x + px, y + py);
      if (c) out.r.data.set(c, (py * w + px) * 4);
    }
    return out;
  }
  flipX(): Img {
    const out = new Img(this.w, this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const c = this.get(this.w - 1 - x, y);
      if (c) out.r.data.set(c, (y * this.w + x) * 4);
    }
    return out;
  }
  clone(): Img {
    return this.part(0, 0, this.w, this.h);
  }
  /// Every drawn pixel one colour: the white copy shown for a moment when something is hit.
  silhouette(c: Rgba): Img {
    const out = this.clone();
    for (let i = 0; i < out.r.data.length; i += 4) if (out.r.data[i + 3]! > 200) out.r.data.set([c[0], c[1], c[2], 255], i);
    return out;
  }
  empty(): boolean {
    for (let i = 3; i < this.r.data.length; i += 4) if (this.r.data[i]) return false;
    return true;
  }
  opaque(): boolean {
    for (let i = 3; i < this.r.data.length; i += 4) if (this.r.data[i] !== 255) return false;
    return true;
  }
}

/// A soft shadow on the ground under something that stands on it.
export const SHADOW: Rgba = [20, 18, 40, 70];

const WHITE: Rgba = [255, 255, 255, 255];

/// Light, not paint: the pixels `core` says are the lit tube or lamp become a bright core (the accent near white), the
/// pixels beside them the accent itself (unless `ring` is false), and one pixel further out a soft halo dithered over what
/// is there (every other pixel, the accent's dark shade mixed in, or half see-through where nothing is drawn). `ring`
/// thin strokes skip the solid ring so a 1-pixel line stays a line with a glow, not a 3-pixel bar.
export function glow(img: Img, core: (x: number, y: number) => boolean, acc: Ramp, o: { ring?: boolean; halo?: boolean; hot?: number; keep?: boolean } = {}) {
  const ring = o.ring ?? true, halo = o.halo ?? true;
  const w = img.w, h = img.h;
  const at = new Uint8Array(w * h); // 1 core, 2 ring, 3 halo
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (core(x, y)) at[y * w + x] = 1;
  const grow = (from: number, to: number, diagonal: boolean) => {
    const add: number[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (at[y * w + x]) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || (!diagonal && dx && dy)) continue;
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && at[yy * w + xx] === from) {
          near = true;
          break;
        }
      }
      if (near) add.push(y * w + x);
    }
    for (const i of add) at[i] = to;
  };
  if (ring) grow(1, 2, false);
  if (halo) grow(ring ? 2 : 1, 3, true);
  const hot = mix(acc[2], WHITE, o.hot ?? 0.62);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = at[y * w + x];
    if (k === 1) {
      if (!o.keep) img.set(x, y, hot);
    }
    else if (k === 2) img.set(x, y, acc[2]);
    else if (k === 3 && (x + y) % 2 === 0) {
      const now = img.get(x, y);
      if (now && now[3] > 200) img.set(x, y, mix(now, acc[1], 0.55));
      else img.set(x, y, [acc[1][0], acc[1][1], acc[1][2], 150]);
    }
  }
}
