// Getting pictures out of a sprite: one PNG per frame, one per layer, a sheet packed tightly (empty borders trimmed, a gap between pieces) with a JSON
// atlas that says where each piece is and how much was trimmed, and the file names for all of them. Pure functions on rasters; the export dialog writes the files.

import { newRaster, type Raster, type Rect } from "./pixels";
import { tagSequence, type SpriteDoc } from "./sprite-doc";

/// The box round every visible pixel, or null for an empty picture.
export function trimBounds(r: Raster): Rect | null {
  let x0 = r.w, y0 = r.h, x1 = -1, y1 = -1;
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      if (r.data[(y * r.w + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function cropRaster(r: Raster, rect: Rect): Raster {
  const out = newRaster(rect.w, rect.h);
  for (let y = 0; y < rect.h; y++) out.data.set(r.data.subarray(((rect.y + y) * r.w + rect.x) * 4, ((rect.y + y) * r.w + rect.x + rect.w) * 4), y * rect.w * 4);
  return out;
}

/// A whole-number enlargement.
export function scaleUp(r: Raster, k: number): Raster {
  const n = Math.max(1, Math.round(k));
  if (n === 1) return r;
  const out = newRaster(r.w * n, r.h * n);
  for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) out.data.set(r.data.subarray(((Math.floor(y / n)) * r.w + Math.floor(x / n)) * 4, ((Math.floor(y / n)) * r.w + Math.floor(x / n)) * 4 + 4), (y * out.w + x) * 4);
  return out;
}

/// A file-name-safe version of a name.
export const safeName = (s: string) => s.trim().replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "sprite";

export interface Piece {
  name: string;
  raster: Raster;
  /// Which frame it is, for the atlas.
  frame?: number;
}

/// One piece per frame: the frames' own pictures, named `<base>_<animation>_<number>` (the number counts from 1 inside the animation).
export function framePieces(doc: SpriteDoc, base: string): Piece[] {
  const out: Piece[] = [];
  const named = new Set<number>();
  for (const tag of doc.tags) {
    tagSequence({ ...tag, direction: "forward" }).forEach((f, i) => {
      if (named.has(f)) return;
      named.add(f);
      out.push({ name: `${safeName(base)}_${safeName(tag.name)}_${i + 1}`, raster: doc.frames[f]!, frame: f });
    });
  }
  doc.frames.forEach((r, f) => {
    if (!named.has(f)) out.push({ name: `${safeName(base)}_${f + 1}`, raster: r, frame: f });
  });
  return out.sort((a, b) => (a.frame ?? 0) - (b.frame ?? 0));
}

/// One piece per layer and frame: `<base>_<layer>_<number>`.
export function layerPieces(doc: SpriteDoc, base: string): Piece[] {
  const out: Piece[] = [];
  for (const layer of doc.layers) layer.cels.forEach((r, f) => out.push({ name: `${safeName(base)}_${safeName(layer.name)}_${f + 1}`, raster: r, frame: f }));
  return out;
}

export interface AtlasFrame {
  /// Where the piece is in the sheet.
  x: number;
  y: number;
  w: number;
  h: number;
  /// Where the trimmed piece sat in the original picture, and the original's size (so a game can put it back).
  sourceX: number;
  sourceY: number;
  sourceW: number;
  sourceH: number;
  trimmed: boolean;
  /// Milliseconds, when the piece is an animation frame.
  duration?: number;
}
export interface Packed {
  sheet: Raster;
  atlas: { frames: Record<string, AtlasFrame>; width: number; height: number; scale: number };
}
export interface PackOptions {
  trim?: boolean;
  /// Empty pixels between pieces (and round the edge).
  padding?: number;
  /// Make the sheet's sides powers of two.
  powerOfTwo?: boolean;
  /// The widest the sheet may be (default 2048).
  maxWidth?: number;
  scale?: number;
  durations?: Map<string, number>;
}

const pow2 = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

/// Packs pieces into one sheet in rows (tallest first, so rows stay tight). Identical pictures are stored once. Returns null when they cannot fit in `maxWidth`.
export function packSheet(pieces: Piece[], o: PackOptions = {}): Packed | null {
  const pad = Math.max(0, o.padding ?? 1);
  const maxW = o.maxWidth ?? 2048;
  const scale = Math.max(1, Math.round(o.scale ?? 1));
  type Item = { name: string; raster: Raster; box: Rect; src: Rect; srcW: number; srcH: number; trimmed: boolean; key: string };
  const items: Item[] = pieces.map((p) => {
    const bounds = o.trim === false ? { x: 0, y: 0, w: p.raster.w, h: p.raster.h } : trimBounds(p.raster) ?? { x: 0, y: 0, w: 1, h: 1 };
    const cropped = scaleUp(cropRaster(p.raster, bounds), scale);
    const key = `${cropped.w}x${cropped.h}:${Array.from(cropped.data).join(",")}`;
    return { name: p.name, raster: cropped, box: { x: 0, y: 0, w: cropped.w, h: cropped.h }, src: bounds, srcW: p.raster.w, srcH: p.raster.h, trimmed: bounds.w !== p.raster.w || bounds.h !== p.raster.h, key };
  });
  const unique = new Map<string, Item>();
  for (const it of items) if (!unique.has(it.key)) unique.set(it.key, it);
  const order = [...unique.values()].sort((a, b) => b.raster.h - a.raster.h || b.raster.w - a.raster.w);
  if (order.some((it) => it.raster.w + 2 * pad > maxW)) return null;
  let x = pad, y = pad, rowH = 0, width = 0;
  for (const it of order) {
    if (x + it.raster.w + pad > maxW) {
      x = pad;
      y += rowH + pad;
      rowH = 0;
    }
    it.box = { x, y, w: it.raster.w, h: it.raster.h };
    x += it.raster.w + pad;
    rowH = Math.max(rowH, it.raster.h);
    width = Math.max(width, x);
  }
  let height = y + rowH + pad;
  let w = Math.max(1, width);
  if (o.powerOfTwo) (w = pow2(w)), (height = pow2(height));
  const sheet = newRaster(w, Math.max(1, height));
  for (const it of order) for (let row = 0; row < it.raster.h; row++) sheet.data.set(it.raster.data.subarray(row * it.raster.w * 4, (row + 1) * it.raster.w * 4), ((it.box.y + row) * w + it.box.x) * 4);
  const frames: Record<string, AtlasFrame> = {};
  for (const it of items) {
    const at = unique.get(it.key)!.box;
    frames[it.name] = { x: at.x, y: at.y, w: at.w, h: at.h, sourceX: it.src.x * scale, sourceY: it.src.y * scale, sourceW: it.srcW * scale, sourceH: it.srcH * scale, trimmed: it.trimmed, ...(o.durations?.has(it.name) ? { duration: o.durations.get(it.name) } : {}) };
  }
  return { sheet, atlas: { frames, width: w, height: sheet.h, scale } };
}

/// The atlas as JSON text, in the usual "hash" shape other tools read (frame, spriteSourceSize, sourceSize), with Nova's own `meta`.
export function atlasJson(p: Packed, image: string): string {
  const frames: Record<string, unknown> = {};
  for (const [name, f] of Object.entries(p.atlas.frames)) {
    frames[name] = {
      frame: { x: f.x, y: f.y, w: f.w, h: f.h },
      rotated: false,
      trimmed: f.trimmed,
      spriteSourceSize: { x: f.sourceX, y: f.sourceY, w: f.w, h: f.h },
      sourceSize: { w: f.sourceW, h: f.sourceH },
      ...(f.duration !== undefined ? { duration: f.duration } : {}),
    };
  }
  return `${JSON.stringify({ frames, meta: { app: "Nova Studio", image, size: { w: p.atlas.width, h: p.atlas.height }, scale: p.atlas.scale } }, null, 2)}\n`;
}

/// What the person chose in the export dialog, saved with the sprite so the same export can be run again.
export interface ExportProfile {
  name: string;
  what: "frames" | "layers" | "sheet" | "gif" | "apng";
  scale: number;
  trim: boolean;
  padding: number;
  powerOfTwo: boolean;
}
export const DEFAULT_PROFILE: ExportProfile = { name: "Packed sheet", what: "sheet", scale: 1, trim: true, padding: 1, powerOfTwo: false };

export function checkProfile(p: unknown): ExportProfile | null {
  const o = p as Partial<ExportProfile> | null;
  if (!o || typeof o !== "object" || typeof o.name !== "string") return null;
  if (!["frames", "layers", "sheet", "gif", "apng"].includes(o.what as string)) return null;
  const n = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);
  return { name: o.name.slice(0, 60), what: o.what as ExportProfile["what"], scale: n(o.scale, 1, 16, 1), trim: o.trim !== false, padding: n(o.padding, 0, 16, 1), powerOfTwo: !!o.powerOfTwo };
}
