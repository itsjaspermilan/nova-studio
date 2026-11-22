// image_make: smooth pictures (logos, UI panels, icons, glows, Steam art) from shapes, the way sprite_write makes pixel art
// from palette characters. Every shape is a signed distance (negative inside) in the picture's own units; a pixel is covered
// by clamp(0.5 - distance), so every edge is anti-aliased, at any size the picture is written at. Fills are a colour or a
// linear or radial gradient; a shape can have a stroke (centred, inside or outside), cut-outs, a soft shadow, a glow, a blur,
// an opacity and a blend; layers group shapes. Existing pictures can be placed, cropped, scaled (smooth or nearest), tinted,
// and the whole can start from one. Text comes from the runtime's own fonts (`nova glyphs`).
//
// Deterministic: the same recipe gives the same bytes (the PNG is written with no filter and zlib level 9).

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { decodePng } from "./draw";
import { pngChunk } from "../src/lib/png-encode";
import type { Raster } from "../src/lib/pixels";

type Args = Record<string, any>;
type Rgba = [number, number, number, number]; // 0..255 colour, alpha 0..1
type Paint = (x: number, y: number) => Rgba;
type Dist = (x: number, y: number) => number;

// ---- colours and fills --------------------------------------------------------------------------------------------------------
const NAMED: Record<string, string> = { white: "#ffffff", black: "#000000", transparent: "#00000000", red: "#ff0000", green: "#00ff00", blue: "#0000ff" };

/// "#rgb", "#rrggbb", "#rrggbbaa", a name, [r, g, b] or [r, g, b, a] (0..255), or { "color": c, "shade": k } (k > 0 lightens
/// towards white, k < 0 darkens towards black, by that share), or { "color": c, "alpha": a } (0..1).
export function parseColor(c: unknown, where = "colour"): Rgba {
  if (typeof c === "string") {
    const s = NAMED[c.toLowerCase()] ?? c;
    const m = /^#([0-9a-f]{3,8})$/i.exec(s.trim());
    if (m && [3, 4, 6, 8].includes(m[1]!.length)) {
      let h = m[1]!;
      if (h.length <= 4) h = [...h].map((ch) => ch + ch).join("");
      const v = (i: number) => parseInt(h.slice(i, i + 2), 16);
      return [v(0), v(2), v(4), h.length === 8 ? v(6) / 255 : 1];
    }
  }
  if (Array.isArray(c) && (c.length === 3 || c.length === 4) && c.every((v) => typeof v === "number" && Number.isFinite(v))) {
    return [c[0], c[1], c[2], c.length === 4 ? c[3] / 255 : 1];
  }
  if (c && typeof c === "object" && !Array.isArray(c) && "color" in (c as Args)) {
    const o = c as Args;
    const base = parseColor(o.color, where);
    if (o.shade !== undefined) {
      const k = Number(o.shade);
      if (!Number.isFinite(k) || k < -1 || k > 1) throw new Error(`${where}: "shade" is from -1 (black) to 1 (white)`);
      for (let i = 0; i < 3; i++) base[i] = Math.max(0, Math.min(255, k >= 0 ? base[i]! + (255 - base[i]!) * k : base[i]! * (1 + k)));
    }
    if (o.alpha !== undefined) base[3] = Math.max(0, Math.min(1, Number(o.alpha)));
    return base;
  }
  throw new Error(`${where}: ${JSON.stringify(c)} is not a colour ("#rrggbb", "#rrggbbaa", [r, g, b(, a)] from 0 to 255, or { "color": "#d3d9e4", "shade": 0.22 })`);
}

function stopsOf(stops: unknown, where: string): [number, Rgba][] {
  if (!Array.isArray(stops) || stops.length < 2) throw new Error(`${where}: "stops" is a list of at least two [position 0..1, colour]`);
  const out = stops.map((s, i) => {
    if (!Array.isArray(s) || s.length !== 2 || typeof s[0] !== "number") throw new Error(`${where}: stop ${i} is [position 0..1, colour]`);
    return [s[0], parseColor(s[1], `${where} stop ${i}`)] as [number, Rgba];
  });
  out.sort((a, b) => a[0] - b[0]);
  return out;
}

function along(stops: [number, Rgba][], t: number): Rgba {
  if (t <= stops[0]![0]) return stops[0]![1];
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i]!;
    if (t <= t1) {
      const [t0, c0] = stops[i - 1]!;
      const k = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k, c0[3] + (c1[3] - c0[3]) * k];
    }
  }
  return stops[stops.length - 1]![1];
}

/// A fill: a colour, { "linear": [x0, y0, x1, y1], "stops": [[0, c], [1, c]] } or { "radial": [cx, cy, r], "stops": [...] }.
export function parsePaint(p: unknown, where = "fill"): Paint {
  if (p && typeof p === "object" && !Array.isArray(p) && ("linear" in (p as Args) || "radial" in (p as Args))) {
    const o = p as Args;
    const stops = stopsOf(o.stops, where);
    if (o.linear) {
      const [x0, y0, x1, y1] = nums(o.linear, 4, `${where} linear`);
      const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy || 1;
      return (x, y) => along(stops, ((x - x0) * dx + (y - y0) * dy) / len2);
    }
    const [cx, cy, r] = nums(o.radial, 3, `${where} radial`);
    return (x, y) => along(stops, Math.hypot(x - cx, y - cy) / (r || 1));
  }
  const c = parseColor(p, where);
  return () => c;
}

function nums(v: unknown, n: number, where: string): number[] {
  if (!Array.isArray(v) || v.length !== n || !v.every((x) => typeof x === "number" && Number.isFinite(x))) throw new Error(`${where} is ${n} numbers (got ${JSON.stringify(v)})`);
  return v as number[];
}

// ---- shapes as signed distances ---------------------------------------------------------------------------------------------
const rad = (deg: number) => (deg * Math.PI) / 180;

/// Points, where an item may be { "arc": [cx, cy, r, from°, to°], "steps": 48 } (its points, inline) or { "curve": ... }.
function pointsOf(v: unknown, where: string): [number, number][] {
  if (!Array.isArray(v)) throw new Error(`${where} is a list of [x, y] points`);
  const out: [number, number][] = [];
  for (const p of v) {
    if (Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === "number")) out.push([p[0], p[1]]);
    else if (p && typeof p === "object" && Array.isArray((p as Args).arc)) {
      const [cx, cy, r, a0d, a1d] = nums((p as Args).arc, 5, `${where} arc`);
      const steps = Math.max(2, Math.min(720, Math.round(Number((p as Args).steps ?? 48))));
      const a0 = rad(a0d), a1 = rad(a1d);
      for (let i = 0; i <= steps; i++) {
        const a = a0 + ((a1 - a0) * i) / steps;
        out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
    } else throw new Error(`${where}: ${JSON.stringify(p)} is not a point ([x, y], or { "arc": [cx, cy, r, from_degrees, to_degrees], "steps": 48 })`);
  }
  return out;
}

/// An SVG-like path: M x y, L x y, H x, V y, Q x1 y1 x y, C x1 y1 x2 y2 x y, A? no; Z closes. Upper case only (absolute).
function flattenPath(d: string, where: string): { pts: [number, number][]; closed: boolean } {
  const tokens = d.match(/[MLHVQCZmlhvqcz]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const pts: [number, number][] = [];
  let i = 0, cmd = "", x = 0, y = 0, closed = false;
  const num = () => {
    const t = tokens[i++];
    if (t === undefined || /[A-Za-z]/.test(t)) throw new Error(`${where}: a path command is missing its numbers near "${d.slice(0, 40)}"`);
    return Number(t);
  };
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i]!)) cmd = tokens[i++]!;
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case "M":
      case "L":
        x = ox + num();
        y = oy + num();
        pts.push([x, y]);
        break;
      case "H":
        x = ox + num();
        pts.push([x, y]);
        break;
      case "V":
        y = oy + num();
        pts.push([x, y]);
        break;
      case "Q": {
        const x1 = ox + num(), y1 = oy + num(), x2 = ox + num(), y2 = oy + num();
        for (let s = 1; s <= 24; s++) {
          const t = s / 24, u = 1 - t;
          pts.push([u * u * x + 2 * u * t * x1 + t * t * x2, u * u * y + 2 * u * t * y1 + t * t * y2]);
        }
        x = x2;
        y = y2;
        break;
      }
      case "C": {
        const x1 = ox + num(), y1 = oy + num(), x2 = ox + num(), y2 = oy + num(), x3 = ox + num(), y3 = oy + num();
        for (let s = 1; s <= 32; s++) {
          const t = s / 32, u = 1 - t;
          pts.push([u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3]);
        }
        x = x3;
        y = y3;
        break;
      }
      case "Z":
        closed = true;
        break;
      default:
        throw new Error(`${where}: path command "${cmd}" is not one of M L H V Q C Z`);
    }
  }
  if (pts.length < 2) throw new Error(`${where}: a path needs at least two points`);
  return { pts, closed };
}

function polygonDist(pts: [number, number][], round: number): Dist {
  return (x, y) => {
    let d = Infinity, inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [ax, ay] = pts[j]!, [bx, by] = pts[i]!;
      const ex = bx - ax, ey = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey || 1)));
      d = Math.min(d, Math.hypot(x - ax - ex * t, y - ay - ey * t));
      if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    }
    return (inside ? -d : d) - round;
  };
}

/// A stroke through points, its width running from w0 to w1 along it; "round" ends (the default), or "butt" / "square".
function lineDist(pts: [number, number][], w0: number, w1: number, cap: string): Dist {
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
  const total = lens[lens.length - 1] || 1;
  const n = pts.length;
  return (x, y) => {
    let d = Infinity;
    for (let i = 1; i < n; i++) {
      const [ax, ay] = pts[i - 1]!, [bx, by] = pts[i]!;
      const ex = bx - ax, ey = by - ay;
      const raw = ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey || 1);
      const t = Math.max(0, Math.min(1, raw));
      const w = w0 + (w1 - w0) * ((lens[i - 1]! + (lens[i]! - lens[i - 1]!) * t) / total);
      let s = Math.hypot(x - ax - ex * t, y - ay - ey * t) - w / 2;
      if (cap !== "round") {
        const seg = Math.hypot(ex, ey) || 1;
        const ext = cap === "square" ? w / 2 : 0;
        // past an open end the stroke stops flat (butt) or half its width further on (square)
        if (i === 1 && raw < 0) s = Math.max(Math.abs((x - ax) * -ey + (y - ay) * ex) / seg - w / 2, -raw * seg - ext);
        if (i === n - 1 && raw > 1) s = Math.max(Math.abs((x - ax) * -ey + (y - ay) * ex) / seg - w / 2, (raw - 1) * seg - ext);
      }
      d = Math.min(d, s);
    }
    return d;
  };
}

const GEOMETRY = ["circle", "ellipse", "rect", "polygon", "ring", "arc", "line", "path", "union", "image", "text"] as const;
const SHAPE_KEYS = [...GEOMETRY, "radius", "round", "width", "width_end", "cap", "steps", "fill", "stroke", "opacity", "minus", "both", "shadow", "glow", "blur", "blend", "name", "at", "size", "crop", "filter", "tint", "font", "align", "color", "layer", "shapes", "outline"];

/// A shape's distance, in picture units.
function distOf(s: Args, where: string, ctx: Ctx): Dist {
  let d: Dist;
  if (s.circle) {
    const [cx, cy, r] = nums(s.circle, 3, `${where} circle`);
    d = (x, y) => Math.hypot(x - cx, y - cy) - r;
  } else if (s.ellipse) {
    const [cx, cy, rx, ry] = nums(s.ellipse, 4, `${where} ellipse`);
    const k = Math.min(rx, ry);
    d = (x, y) => (Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) * k;
  } else if (s.rect) {
    const [rx, ry, rw, rh] = nums(s.rect, 4, `${where} rect`);
    const r = Number(s.radius ?? 0);
    const cx = rx + rw / 2, cy = ry + rh / 2, hw = rw / 2, hh = rh / 2;
    d = (x, y) => {
      const qx = Math.abs(x - cx) - hw + r, qy = Math.abs(y - cy) - hh + r;
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
    };
  } else if (s.polygon) {
    d = polygonDist(pointsOf(s.polygon, `${where} polygon`), Number(s.round ?? 0));
  } else if (s.ring) {
    const [cx, cy, r, t] = nums(s.ring, 4, `${where} ring`);
    d = (x, y) => Math.abs(Math.hypot(x - cx, y - cy) - r) - t / 2;
  } else if (s.arc) {
    const [cx, cy, r, a0, a1] = nums(s.arc, 5, `${where} arc`);
    const w = Number(s.width ?? 4);
    d = lineDist(pointsOf([{ arc: [cx, cy, r, a0, a1], steps: s.steps ?? 48 }], where), w, Number(s.width_end ?? w), String(s.cap ?? "round"));
  } else if (s.line) {
    const w = Number(s.width ?? 4);
    d = lineDist(pointsOf(s.line, `${where} line`), w, Number(s.width_end ?? w), String(s.cap ?? "round"));
  } else if (s.path) {
    const { pts, closed } = flattenPath(String(s.path), where);
    if (closed || s.width === undefined) d = polygonDist(pts, Number(s.round ?? 0));
    else d = lineDist(pts, Number(s.width), Number(s.width_end ?? s.width), String(s.cap ?? "round"));
  } else if (s.union) {
    if (!Array.isArray(s.union)) throw new Error(`${where}: union is a list of shapes`);
    const parts = s.union.map((p: Args, i: number) => distOf(p, `${where} union ${i}`, ctx));
    d = (x, y) => {
      let m = Infinity;
      for (const f of parts) m = Math.min(m, f(x, y));
      return m;
    };
  } else if (s.text !== undefined) {
    d = textDist(s, where, ctx);
  } else throw new Error(`${where} has none of ${GEOMETRY.filter((g) => g !== "image" && g !== "text").join(", ")}, image, text (one of them says what it is)`);
  for (const [key, combine] of [["minus", (a: number, b: number) => Math.max(a, -b)], ["both", (a: number, b: number) => Math.max(a, b)]] as const) {
    if (s[key] === undefined) continue;
    const list = Array.isArray(s[key]) ? s[key] : [s[key]];
    for (const [i, cut] of list.entries()) {
      const f = distOf(cut, `${where} ${key} ${i}`, ctx), g = d;
      d = (x, y) => combine(g(x, y), f(x, y));
    }
  }
  return d;
}

// ---- text, through the runtime's fonts --------------------------------------------------------------------------------------
interface Ctx {
  scale: number;
  root: string;
  bin: string | null;
  tmp: () => string;
  next: () => number;
}

/// Text as a distance: the glyphs' coverage at the picture's pixel size made into a signed distance field (exact Euclidean,
/// Felzenszwalb's transform, with a margin round the words so an outline, a shadow or a glow has room), placed with its
/// `align` ("left", "center", "right") at `at` = [x, baseline y]; `size` in units.
function textDist(s: Args, where: string, ctx: Ctx): Dist {
  if (!ctx.bin || !existsSync(ctx.bin)) throw new Error(`${where}: text needs the runtime (\`nova glyphs\`): build it with scripts/env.sh cargo build --release -p nova-runtime`);
  const size = Number(s.size ?? 32);
  const [ax, ay] = nums(s.at ?? [0, size], 2, `${where} at`);
  const px = size * ctx.scale;
  const file = join(ctx.tmp(), `t${ctx.next()}.png`);
  const r = spawnSync(ctx.bin, ["glyphs", String(s.font ?? "sans"), String(px), file, "--text", String(s.text), "--project", ctx.root], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${where}: ${(r.stderr || r.stdout).trim()}`);
  const m = JSON.parse(r.stdout.trim().split("\n").pop()!);
  const pic = decodePng(readFileSync(file));
  const pad = Math.min(256, Math.ceil(48 * ctx.scale));
  const W = pic.w + pad * 2, H = pic.h + pad * 2;
  const cov = new Float64Array(W * H);
  for (let y = 0; y < pic.h; y++) for (let x = 0; x < pic.w; x++) cov[(y + pad) * W + x + pad] = pic.data[(y * pic.w + x) * 4 + 3]! / 255;
  const field = signedField(cov, W, H);
  const align = String(s.align ?? "left");
  const wUnits = pic.w / ctx.scale;
  const left = ax - (align === "center" ? wUnits / 2 : align === "right" ? wUnits : 0) - pad / ctx.scale;
  const top = ay - m.ascent / ctx.scale - pad / ctx.scale;
  return (x, y) => {
    // (bilinear between the field's pixel centres; beyond the margin, the edge's value plus the way still to go)
    const fx = (x - left) * ctx.scale - 0.5, fy = (y - top) * ctx.scale - 0.5;
    const cx = Math.max(0, Math.min(W - 1.001, fx)), cy = Math.max(0, Math.min(H - 1.001, fy));
    const ix = Math.floor(cx), iy = Math.floor(cy), tx = cx - ix, ty = cy - iy;
    const at = (i: number, j: number) => field[j * W + i]!;
    const v = at(ix, iy) * (1 - tx) * (1 - ty) + at(ix + 1, iy) * tx * (1 - ty) + at(ix, iy + 1) * (1 - tx) * ty + at(ix + 1, iy + 1) * tx * ty;
    return (v + Math.hypot(fx - cx, fy - cy)) / ctx.scale;
  };
}

/// The signed distance in pixels (negative inside) of a coverage picture: exact Euclidean distances to the other side, and
/// the coverage itself on the edge pixels (0.5 - coverage), so edges stay as smooth as the glyphs were drawn.
function signedField(cov: Float64Array, w: number, h: number): Float64Array {
  const INF = 1e20;
  const edt = (feature: (i: number) => boolean): Float64Array => {
    const f = new Float64Array(w * h);
    for (let i = 0; i < w * h; i++) f[i] = feature(i) ? 0 : INF;
    const line = (get: (k: number) => number, set: (k: number, v: number) => void, n: number) => {
      const d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
      const g = Array.from({ length: n }, (_, k) => get(k));
      let k = 0;
      v[0] = 0;
      z[0] = -INF;
      z[1] = INF;
      for (let q = 1; q < n; q++) {
        let s = (g[q]! + q * q - (g[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
        while (s <= z[k]!) {
          k--;
          s = (g[q]! + q * q - (g[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
        }
        k++;
        v[k] = q;
        z[k] = s;
        z[k + 1] = INF;
      }
      k = 0;
      for (let q = 0; q < n; q++) {
        while (z[k + 1]! < q) k++;
        d[q] = (q - v[k]!) * (q - v[k]!) + g[v[k]!]!;
      }
      for (let q = 0; q < n; q++) set(q, d[q]!);
    };
    for (let x = 0; x < w; x++) line((k) => f[k * w + x]!, (k, val) => (f[k * w + x] = val), h);
    for (let y = 0; y < h; y++) line((k) => f[y * w + k]!, (k, val) => (f[y * w + k] = val), w);
    return f;
  };
  const toInside = edt((i) => cov[i]! >= 0.5);
  const toOutside = edt((i) => cov[i]! < 0.5);
  const out = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const c = cov[i]!;
    if (c > 0 && c < 1) out[i] = 0.5 - c;
    else out[i] = c >= 0.5 ? -(Math.sqrt(toOutside[i]!) - 0.5) : Math.sqrt(toInside[i]!) - 0.5;
  }
  return out;
}

// ---- the picture: float RGBA, colour 0..255, alpha 0..1 ---------------------------------------------------------------------
interface Img {
  w: number;
  h: number;
  px: Float64Array;
}
const blank = (w: number, h: number): Img => ({ w, h, px: new Float64Array(w * h * 4) });

/// "Over", the way the logos were always painted: the colour weighted by coverage over what is there.
function over(img: Img, o: number, c: Rgba, cov: number, blend: string) {
  const a0 = img.px[o + 3]!;
  if (blend === "add") {
    for (let k = 0; k < 3; k++) img.px[o + k] = Math.min(255, img.px[o + k]! + c[k]! * cov);
    img.px[o + 3] = Math.min(1, a0 + cov * (1 - a0));
    return;
  }
  if (blend === "multiply" || blend === "screen") {
    for (let k = 0; k < 3; k++) {
      const b = img.px[o + k]!, m = blend === "multiply" ? (b * c[k]!) / 255 : 255 - ((255 - b) * (255 - c[k]!)) / 255;
      img.px[o + k] = b + (m - b) * cov;
    }
    return;
  }
  const a = cov + a0 * (1 - cov);
  if (a <= 0) return;
  for (let k = 0; k < 3; k++) img.px[o + k] = (c[k]! * cov + img.px[o + k]! * a0 * (1 - cov)) / a;
  img.px[o + 3] = a;
}

/// Paints a distance with a fill: each pixel's coverage is clamp(0.5 - distance in pixels).
function paint(img: Img, d: Dist, fill: Paint, alpha: number, blend: string, scale: number) {
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const ux = (x + 0.5) / scale, uy = (y + 0.5) / scale;
      const cov0 = Math.max(0, Math.min(1, 0.5 - d(ux, uy) * scale)) * alpha;
      if (cov0 <= 0) continue;
      const c = fill(ux, uy);
      const cov = cov0 * c[3];
      if (cov <= 0) continue;
      over(img, (y * img.w + x) * 4, c, cov, blend);
    }
  }
}

/// A coverage mask of a distance (for shadows and glows), offset by (dx, dy) units.
function mask(w: number, h: number, d: Dist, scale: number, dx = 0, dy = 0, grow = 0): Float64Array {
  const m = new Float64Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = Math.max(0, Math.min(1, 0.5 - (d((x + 0.5) / scale - dx, (y + 0.5) / scale - dy) - grow) * scale));
  return m;
}

/// A Gaussian blur (three box passes each way, the same every run) of `channels` planes of a w x h picture.
function blurPlanes(planes: Float64Array[], w: number, h: number, radius: number) {
  const sigma = radius / 2;
  if (sigma < 0.2) return;
  const boxes = (() => {
    const n = 3, ideal = Math.sqrt((12 * sigma * sigma) / n + 1);
    let wl = Math.floor(ideal);
    if (wl % 2 === 0) wl--;
    const wu = wl + 2, m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
    return Array.from({ length: n }, (_, i) => ((i < m ? wl : wu) - 1) / 2);
  })();
  const tmp = new Float64Array(w * h);
  for (const p of planes) {
    for (const r of boxes) {
      if (r < 1) continue;
      // along x, then along y; the picture's edge is held (see-through outside)
      for (let y = 0; y < h; y++) {
        let acc = 0;
        for (let x = -r; x <= r; x++) acc += x >= 0 && x < w ? p[y * w + x]! : 0;
        for (let x = 0; x < w; x++) {
          tmp[y * w + x] = acc / (2 * r + 1);
          const out = x - r, inn = x + r + 1;
          if (inn < w) acc += p[y * w + inn]!;
          if (out >= 0) acc -= p[y * w + out]!;
        }
      }
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let y = -r; y <= r; y++) acc += y >= 0 && y < h ? tmp[y * w + x]! : 0;
        for (let y = 0; y < h; y++) {
          p[y * w + x] = acc / (2 * r + 1);
          const out = y - r, inn = y + r + 1;
          if (inn < h) acc += tmp[inn * w + x]!;
          if (out >= 0) acc -= tmp[out * w + x]!;
        }
      }
    }
  }
}

/// Blurs a picture (premultiplied while blurred, so edges do not darken).
function blurImg(img: Img, radius: number) {
  const n = img.w * img.h;
  const planes = [0, 1, 2, 3].map(() => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    const a = img.px[i * 4 + 3]!;
    for (let k = 0; k < 3; k++) planes[k]![i] = img.px[i * 4 + k]! * a;
    planes[3]![i] = a;
  }
  blurPlanes(planes, img.w, img.h, radius);
  for (let i = 0; i < n; i++) {
    const a = planes[3]![i]!;
    for (let k = 0; k < 3; k++) img.px[i * 4 + k] = a > 1e-9 ? planes[k]![i]! / a : 0;
    img.px[i * 4 + 3] = a;
  }
}

/// Puts one picture over another (each pixel's alpha times `opacity` is its coverage).
function compose(dst: Img, src: Img, opacity: number, blend: string) {
  for (let i = 0; i < dst.w * dst.h; i++) {
    const cov = src.px[i * 4 + 3]! * opacity;
    if (cov <= 0) continue;
    over(dst, i * 4, [src.px[i * 4]!, src.px[i * 4 + 1]!, src.px[i * 4 + 2]!, 1], cov, blend);
  }
}

/// A soft shape under (shadow) or round (glow) another: { "offset": [dx, dy], "blur": r, "color": c, "spread": s }.
function softUnder(img: Img, d: Dist, o: Args, where: string, scale: number, isGlow: boolean) {
  const [dx, dy] = isGlow ? [0, 0] : nums(o.offset ?? [0, 4], 2, `${where} offset`);
  const blur = Number(o.blur ?? o.radius ?? (isGlow ? 12 : 6));
  const spread = Number(o.spread ?? (isGlow ? 2 : 0));
  const color = parseColor(o.color ?? (isGlow ? "#ffffff" : "#00000099"), `${where} color`);
  const m = mask(img.w, img.h, d, scale, dx, dy, spread);
  blurPlanes([m], img.w, img.h, blur * scale);
  const strength = Number(o.strength ?? 1);
  const blend = String(o.blend ?? (isGlow ? "add" : "normal"));
  for (let i = 0; i < img.w * img.h; i++) {
    const cov = Math.min(1, m[i]! * color[3] * strength);
    if (cov > 0) over(img, i * 4, color, cov, blend);
  }
}

// ---- pictures placed on the picture -----------------------------------------------------------------------------------------
function readPicture(root: string, file: string, where: string): Raster {
  const rel = String(file).replace(/^\/+/, "");
  const full = join(root, rel);
  if (!full.startsWith(root) || !existsSync(full)) throw new Error(`${where}: there is no ${rel} in the project`);
  return decodePng(readFileSync(full));
}

/// Samples a picture at (u, v) in its pixels: "smooth" (bilinear; an average of the area when it shrinks by more than two)
/// or "nearest". Returns premultiplied-free RGBA, alpha 0..1.
function sample(p: Raster, u: number, v: number, filter: string, footprint: number): Rgba {
  const at = (x: number, y: number): Rgba => {
    const cx = Math.max(0, Math.min(p.w - 1, x)), cy = Math.max(0, Math.min(p.h - 1, y));
    const o = (cy * p.w + cx) * 4;
    return [p.data[o]!, p.data[o + 1]!, p.data[o + 2]!, p.data[o + 3]! / 255];
  };
  if (filter === "nearest") return at(Math.floor(u), Math.floor(v));
  const acc = [0, 0, 0, 0];
  const add = (c: Rgba, wgt: number) => {
    acc[0]! += c[0] * c[3] * wgt;
    acc[1]! += c[1] * c[3] * wgt;
    acc[2]! += c[2] * c[3] * wgt;
    acc[3]! += c[3] * wgt;
  };
  if (footprint > 2) {
    const r = footprint / 2, x0 = Math.floor(u - r), x1 = Math.ceil(u + r), y0 = Math.floor(v - r), y1 = Math.ceil(v + r);
    let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) (add(at(x, y), 1), n++);
    for (let k = 0; k < 4; k++) acc[k]! /= n || 1;
  } else {
    const fx = u - 0.5, fy = v - 0.5, x = Math.floor(fx), y = Math.floor(fy), tx = fx - x, ty = fy - y;
    add(at(x, y), (1 - tx) * (1 - ty));
    add(at(x + 1, y), tx * (1 - ty));
    add(at(x, y + 1), (1 - tx) * ty);
    add(at(x + 1, y + 1), tx * ty);
  }
  const a = acc[3]!;
  return a > 1e-9 ? [acc[0]! / a, acc[1]! / a, acc[2]! / a, a] : [0, 0, 0, 0];
}

/// { "image": "sprites/x.png", "at": [x, y], "size": [w, h], "crop": [x, y, w, h], "filter": "smooth", "tint": c, "opacity": 1 }
function placeImage(img: Img, s: Args, where: string, ctx: Ctx) {
  const pic = readPicture(ctx.root, s.image, where);
  const [cx, cy, cw, ch] = s.crop ? nums(s.crop, 4, `${where} crop`) : [0, 0, pic.w, pic.h];
  const [ax, ay] = nums(s.at ?? [0, 0], 2, `${where} at`);
  const [w, h] = s.size ? nums(s.size, 2, `${where} size`) : [cw, ch];
  const filter = String(s.filter ?? "smooth");
  if (!["smooth", "nearest"].includes(filter)) throw new Error(`${where}: filter is "smooth" or "nearest"`);
  const tint = s.tint !== undefined ? parseColor(s.tint, `${where} tint`) : null;
  const opacity = Number(s.opacity ?? 1);
  const blend = String(s.blend ?? "normal");
  const footprint = Math.max(cw / (w * ctx.scale), ch / (h * ctx.scale));
  const x0 = Math.max(0, Math.floor(ax * ctx.scale)), x1 = Math.min(img.w, Math.ceil((ax + w) * ctx.scale));
  const y0 = Math.max(0, Math.floor(ay * ctx.scale)), y1 = Math.min(img.h, Math.ceil((ay + h) * ctx.scale));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const ux = (x + 0.5) / ctx.scale, uy = (y + 0.5) / ctx.scale;
      if (ux < ax || uy < ay || ux >= ax + w || uy >= ay + h) continue;
      const c = sample(pic, cx + ((ux - ax) / w) * cw, cy + ((uy - ay) / h) * ch, filter, footprint);
      if (tint) for (let k = 0; k < 3; k++) c[k] = (c[k]! * tint[k]!) / 255;
      const cov = c[3] * opacity * (tint ? tint[3] : 1);
      if (cov > 0) over(img, (y * img.w + x) * 4, c, cov, blend);
    }
  }
}

// ---- drawing a list of shapes -----------------------------------------------------------------------------------------------
function drawShapes(img: Img, shapes: unknown, where: string, ctx: Ctx) {
  if (!Array.isArray(shapes)) throw new Error(`${where} is a list of shapes`);
  shapes.forEach((s: Args, i: number) => drawShape(img, s, `${where} ${i}`, ctx));
}

function drawShape(img: Img, s: Args, where: string, ctx: Ctx) {
  if (!s || typeof s !== "object" || Array.isArray(s)) throw new Error(`${where} is not a shape object`);
  const unknown = Object.keys(s).filter((k) => !SHAPE_KEYS.includes(k));
  if (unknown.length) throw new Error(`${where}: ${unknown.map((k) => `\`${k}\``).join(", ")} ${unknown.length > 1 ? "are not options" : "is not an option"} of a shape (it takes ${SHAPE_KEYS.join(", ")})`);
  const label = s.name ? `${where} ("${s.name}")` : where;
  const opacity = Number(s.opacity ?? 1);
  const blend = String(s.blend ?? "normal");
  if (!["normal", "add", "multiply", "screen"].includes(blend)) throw new Error(`${label}: blend is "normal", "add", "multiply" or "screen"`);
  // a layer: its shapes drawn on a picture of their own, then that picture (blurred, faded, with its shadow) put on this one
  if (s.layer !== undefined || s.shapes !== undefined) {
    const layer = blank(img.w, img.h);
    drawShapes(layer, s.layer ?? s.shapes, `${label} layer`, ctx);
    if (s.shadow || s.glow) {
      const alphaDist: Dist = (x, y) => 0.5 - (layer.px[(Math.min(img.h - 1, Math.max(0, Math.floor(y * ctx.scale))) * img.w + Math.min(img.w - 1, Math.max(0, Math.floor(x * ctx.scale)))) * 4 + 3]!) / ctx.scale;
      if (s.shadow) softUnder(img, alphaDist, s.shadow, `${label} shadow`, ctx.scale, false);
      if (s.glow) softUnder(img, alphaDist, s.glow, `${label} glow`, ctx.scale, true);
    }
    if (s.blur) blurImg(layer, Number(s.blur) * ctx.scale);
    compose(img, layer, opacity, blend);
    return;
  }
  if (s.image !== undefined) {
    placeImage(img, s, label, ctx);
    return;
  }
  const d = distOf(s, label, ctx);
  if (s.shadow) softUnder(img, d, s.shadow, `${label} shadow`, ctx.scale, false);
  if (s.glow) softUnder(img, d, s.glow, `${label} glow`, ctx.scale, true);
  const target = s.blur ? blank(img.w, img.h) : img;
  const fill = s.fill === null ? null : parsePaint(s.fill ?? s.color ?? "#ffffff", `${label} fill`);
  if (fill) paint(target, d, fill, s.blur ? 1 : opacity, s.blur ? "normal" : blend, ctx.scale);
  const stroke = s.stroke ?? s.outline;
  if (stroke) {
    const st: Args = typeof stroke === "object" && !Array.isArray(stroke) && !("linear" in stroke) && !("radial" in stroke) && !("shade" in stroke) ? stroke : { color: stroke };
    const w = Number(st.width ?? 2);
    const align = String(st.align ?? "center");
    const band: Dist = align === "inside" ? (x, y) => Math.max(d(x, y), -(d(x, y) + w)) : align === "outside" ? (x, y) => Math.max(-d(x, y), d(x, y) - w) : (x, y) => Math.abs(d(x, y)) - w / 2;
    paint(target, band, parsePaint(st.color ?? st.fill ?? "#000000", `${label} stroke`), Number(st.opacity ?? 1) * (s.blur ? 1 : opacity), s.blur ? "normal" : blend, ctx.scale);
  }
  if (s.blur) {
    blurImg(target, Number(s.blur) * ctx.scale);
    compose(img, target, opacity, blend);
  }
}

// ---- the recipe -------------------------------------------------------------------------------------------------------------
const TOP_KEYS = ["name", "project", "size", "background", "base", "shapes", "sizes", "crop", "sheet"];

export const IMAGE_HELP =
  'Shapes (each one key says what it is; numbers are in the picture\'s units, [0, 0] its top left): ' +
  '{ "circle": [cx, cy, r] }, { "ellipse": [cx, cy, rx, ry] }, { "rect": [x, y, w, h], "radius": 8 }, { "polygon": [[x, y], ...], "round": 3 }, ' +
  '{ "ring": [cx, cy, r, width] }, { "arc": [cx, cy, r, from_deg, to_deg], "width": 6, "cap": "round" }, ' +
  '{ "line": [[x, y], ...], "width": 6, "width_end": 2, "cap": "round|butt|square" } (a point may be { "arc": [cx, cy, r, from_deg, to_deg], "steps": 48 }: its points inline; degrees clockwise from +x, y down), ' +
  '{ "path": "M 10 10 L 90 10 Q 120 50 90 90 C 60 120 20 120 10 90 Z" } (filled when closed with Z or given no width; with "width" an open path is a stroke), ' +
  '{ "union": [shapes] }, { "text": "PINE RIDGE", "at": [x, baseline_y], "size": 48, "font": "sans|rounded|pixel|terminal|mono|serif|comic|display|script|fonts/x.ttf", "align": "left|center|right" }, ' +
  '{ "image": "sprites/photo.png", "at": [x, y], "size": [w, h], "crop": [x, y, w, h], "filter": "smooth|nearest", "tint": c }, ' +
  'and { "layer": [shapes] } (drawn on its own, then put on with its opacity, blur, blend, shadow, glow). ' +
  'On any shape: "fill": "#rrggbb[aa]" | [r, g, b, a 0..255] | { "color": c, "shade": 0.2 } (lighter; negative darker) | { "linear": [x0, y0, x1, y1], "stops": [[0, c], [1, c]] } | { "radial": [cx, cy, r], "stops": [...] } (null: no fill); ' +
  '"stroke": { "color": c (or a gradient), "width": 3, "align": "center|inside|outside" }; "minus": [shapes] (cut out of it), "both": [shapes] (only where it overlaps them); ' +
  '"opacity": 0..1; "blend": "normal|add|multiply|screen"; "blur": units; "shadow": { "offset": [dx, dy], "blur": 6, "color": "#00000099", "spread": 0 } (under it); "glow": { "blur": 12, "color": c, "spread": 2, "blend": "add" } (round it); "name" (for messages).';

/// What `image_make` does: draws the recipe and returns the files (path in the project, PNG bytes) and the first picture.
export function makeImage(root: string, a: Args, bin: string | null): { files: [string, Uint8Array][]; picture: Raster; text: string } {
  const unknown = Object.keys(a).filter((k) => !TOP_KEYS.includes(k));
  if (unknown.length) throw new Error(`${unknown.map((k) => `\`${k}\``).join(", ")} ${unknown.length > 1 ? "are not options" : "is not an option"} of image_make (it takes ${TOP_KEYS.join(", ")}). Nothing was written`);
  const name = String(a.name ?? "").trim().replace(/^sprites\//, "").replace(/\.png$/i, "");
  if (!/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/.test(name)) throw new Error(`"name" is the picture's name under sprites/, letters, numbers, - and _ with / between folders ("logos/apex"; got '${name}')`);
  const base = a.base !== undefined ? readPicture(root, a.base, "base") : null;
  const [W, H] = a.size !== undefined ? nums(a.size, 2, "size") : base ? [base.w, base.h] : [0, 0];
  if (!(W >= 1 && H >= 1 && W <= 4096 && H <= 4096)) throw new Error('"size" is [width, height] from 1 to 4096 (the picture\'s units: also its pixels at "sizes" 1)');
  // the sizes to write: the first is sprites/<name>.png, the others <name>_<w>x<h>.png
  const sizes: [number, number][] = (a.sizes ?? [[W, H]]).map((s: unknown, i: number) => {
    const wh = typeof s === "number" ? [Math.round(W * s), Math.round(H * s)] : nums(s, 2, `sizes ${i}`);
    if (!(wh[0]! >= 1 && wh[1]! >= 1 && wh[0]! <= 8192 && wh[1]! <= 8192)) throw new Error(`sizes ${i}: from 1x1 to 8192x8192`);
    return wh as [number, number];
  });
  let tmpDir: string | null = null;
  let made = 0;
  const ctx = (scale: number): Ctx => ({ scale, root, bin, tmp: () => (tmpDir ??= mkdtempSync(join(tmpdir(), "nova-image-"))), next: () => made++ });
  const files: [string, Uint8Array][] = [];
  let first: Raster | null = null;
  try {
    for (const [i, [w, h]] of sizes.entries()) {
      const scale = w / W;
      if (Math.abs(h / H - scale) > 0.02) throw new Error(`sizes ${i}: ${w}x${h} is not the shape of ${W}x${H} (the same scale both ways; crop afterwards with "crop")`);
      const img = blank(w, h);
      if (a.background !== undefined) {
        const bg = parseColor(a.background, "background");
        for (let p = 0; p < w * h; p++) over(img, p * 4, bg, bg[3], "normal");
      }
      if (base) placeImage(img, { image: a.base, at: [0, 0], size: [W, H] }, "base", ctx(scale));
      drawShapes(img, a.shapes ?? [], "shape", ctx(scale));
      let out = toRaster(img);
      if (a.crop !== undefined) {
        const [cx, cy, cw, ch] = nums(a.crop, 4, "crop").map((v) => Math.round(v * scale));
        out = cropRaster(out, cx!, cy!, cw!, ch!);
      }
      first ??= out;
      files.push([`sprites/${name}${i === 0 ? "" : `_${out.w}x${out.h}`}.png`, encode(out)]);
    }
  } finally {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  }
  const text = `${files.map(([f], i) => `${f} (${sizes[i]![0]}x${sizes[i]![1]}${a.crop ? ", cropped" : ""})`).join(", ")}: drawn smooth from ${(a.shapes ?? []).length} shapes${base ? ` over ${a.base}` : ""}. Every PNG under sprites/ is a sprite: draw it with nova.sprite or nova.ui.sprite ("${name}"); look again with sprite_preview { "name": "${name}" }.`;
  return { files, picture: first!, text };
}

function toRaster(img: Img): Raster {
  const data = new Uint8ClampedArray(img.w * img.h * 4);
  for (let i = 0; i < img.w * img.h; i++) {
    data[i * 4] = Math.round(img.px[i * 4]!);
    data[i * 4 + 1] = Math.round(img.px[i * 4 + 1]!);
    data[i * 4 + 2] = Math.round(img.px[i * 4 + 2]!);
    data[i * 4 + 3] = Math.round(img.px[i * 4 + 3]! * 255);
  }
  return { w: img.w, h: img.h, data };
}

function cropRaster(r: Raster, x: number, y: number, w: number, h: number): Raster {
  if (!(w >= 1 && h >= 1)) throw new Error("crop is [x, y, w, h] with a width and height of at least 1");
  const data = new Uint8ClampedArray(w * h * 4);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const sx = x + i, sy = y + j;
    if (sx < 0 || sy < 0 || sx >= r.w || sy >= r.h) continue;
    data.set(r.data.subarray((sy * r.w + sx) * 4, (sy * r.w + sx) * 4 + 4), (j * w + i) * 4);
  }
  return { w, h, data };
}

/// The PNG: 8-bit RGBA, no filter, zlib level 9 (what scripts/rally/logos.mjs always wrote, byte for byte).
export function encode(r: Raster): Uint8Array {
  const raw = Buffer.alloc((r.w * 4 + 1) * r.h);
  for (let y = 0; y < r.h; y++) Buffer.from(r.data.buffer, r.data.byteOffset + y * r.w * 4, r.w * 4).copy(raw, y * (r.w * 4 + 1) + 1);
  const head = new Uint8Array(13);
  const v = new DataView(head.buffer);
  v.setUint32(0, r.w);
  v.setUint32(4, r.h);
  head[8] = 8;
  head[9] = 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", head), pngChunk("IDAT", deflateSync(raw, { level: 9 })), pngChunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) (out.set(p, at), (at += p.length));
  return out;
}
