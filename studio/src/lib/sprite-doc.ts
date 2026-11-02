// A sprite document: equal-sized frames, per-frame durations and animation tags. It maps onto a
// PNG sheet plus a `*.sprite.json` file (format v1, see crates/nova-runtime/src/sprite.rs).

import { blit, cloneRaster, crop, newRaster, type Raster } from "./pixels";

export type Direction = "forward" | "reverse" | "pingpong";
export interface Tag {
  name: string;
  from: number;
  to: number;
  direction: Direction;
  loop: boolean;
}
export interface SpriteDoc {
  fw: number;
  fh: number;
  frames: Raster[];
  durations: number[];
  tags: Tag[];
}

export const DEFAULT_DURATION = 100;
export const MAX_SIDE = 1024;
export const MAX_FRAMES = 256;
export const SHEET_COLUMNS = 16;

export function newDoc(fw: number, fh: number, frames = 1): SpriteDoc {
  return { fw, fh, frames: Array.from({ length: frames }, () => newRaster(fw, fh)), durations: Array(frames).fill(DEFAULT_DURATION), tags: [] };
}

export function cloneDoc(d: SpriteDoc): SpriteDoc {
  return { fw: d.fw, fh: d.fh, frames: d.frames.map(cloneRaster), durations: [...d.durations], tags: d.tags.map((t) => ({ ...t })) };
}

/// The frame numbers one pass of a tag plays; ping-pong goes there and back without repeating the ends (as the runtime does).
export function tagSequence(tag: Tag): number[] {
  const forward: number[] = [];
  for (let i = tag.from; i <= tag.to; i++) forward.push(i);
  if (tag.direction === "reverse") return forward.reverse();
  if (tag.direction === "pingpong" && forward.length > 2) return [...forward, ...forward.slice(1, -1).reverse()];
  return forward;
}

/// Inserts a frame so it ends up at `index` (blank, or a copy of the frame it follows). Tags at or after it shift right.
export function insertFrame(doc: SpriteDoc, index: number, copyOf?: number): SpriteDoc {
  if (doc.frames.length >= MAX_FRAMES) return doc;
  const next = cloneDoc(doc);
  const at = Math.max(0, Math.min(index, next.frames.length));
  next.frames.splice(at, 0, copyOf === undefined ? newRaster(next.fw, next.fh) : cloneRaster(next.frames[copyOf]!));
  next.durations.splice(at, 0, copyOf === undefined ? DEFAULT_DURATION : next.durations[copyOf]!);
  for (const t of next.tags) {
    if (t.from >= at) t.from++;
    if (t.to >= at) t.to++;
  }
  return next;
}

/// Removes a frame (never the last one). Tags shrink with it and disappear when empty.
export function removeFrame(doc: SpriteDoc, index: number): SpriteDoc {
  if (doc.frames.length <= 1 || index < 0 || index >= doc.frames.length) return doc;
  const next = cloneDoc(doc);
  next.frames.splice(index, 1);
  next.durations.splice(index, 1);
  next.tags = next.tags
    .map((t) => ({ ...t, from: t.from > index ? t.from - 1 : t.from, to: t.to >= index ? t.to - 1 : t.to }))
    .filter((t) => t.to >= t.from);
  return next;
}

/// Moves a frame to a new position. Tags keep their frame numbers (they describe positions, not pictures).
export function moveFrame(doc: SpriteDoc, from: number, to: number): SpriteDoc {
  const last = doc.frames.length - 1;
  if (from === to || from < 0 || from > last || to < 0 || to > last) return doc;
  const next = cloneDoc(doc);
  const [frame] = next.frames.splice(from, 1);
  const [duration] = next.durations.splice(from, 1);
  next.frames.splice(to, 0, frame!);
  next.durations.splice(to, 0, duration!);
  return next;
}

export function addTag(doc: SpriteDoc, from: number, to: number): SpriteDoc {
  const next = cloneDoc(doc);
  const used = new Set(next.tags.map((t) => t.name));
  let n = 1;
  while (used.has(`tag${n}`)) n++;
  next.tags.push({ name: `tag${n}`, from: Math.min(from, to), to: Math.max(from, to), direction: "forward", loop: true });
  return next;
}

export function updateTag(doc: SpriteDoc, index: number, change: Partial<Tag>): SpriteDoc {
  const next = cloneDoc(doc);
  const tag = next.tags[index];
  if (!tag) return doc;
  Object.assign(tag, change);
  const last = next.frames.length - 1;
  tag.from = Math.max(0, Math.min(tag.from, last));
  tag.to = Math.max(tag.from, Math.min(tag.to, last));
  return next;
}

export function removeTag(doc: SpriteDoc, index: number): SpriteDoc {
  const next = cloneDoc(doc);
  next.tags.splice(index, 1);
  return next;
}

/// Problems a person should fix before the runtime will accept the sheet.
export function tagProblems(doc: SpriteDoc): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  doc.tags.forEach((t, i) => {
    if (!t.name.trim()) problems.push(`Tag ${i + 1} needs a name`);
    else if (seen.has(t.name)) problems.push(`There are two tags called "${t.name}"`);
    seen.add(t.name);
  });
  return problems;
}

export function sheetColumns(frames: number): number {
  return Math.min(frames, SHEET_COLUMNS);
}

/// All frames laid out in a grid, `SHEET_COLUMNS` wide.
export function toSheet(doc: SpriteDoc): Raster {
  const columns = sheetColumns(doc.frames.length);
  const rows = Math.ceil(doc.frames.length / columns);
  const sheet = newRaster(columns * doc.fw, rows * doc.fh);
  doc.frames.forEach((f, i) => blit(sheet, f, (i % columns) * doc.fw, Math.floor(i / columns) * doc.fh));
  return sheet;
}

export interface SheetJson {
  version?: number;
  image?: string;
  frame_width: number;
  frame_height: number;
  columns?: number;
  frames?: number;
  frame_duration_ms?: number;
  durations_ms?: number[];
  tags?: { name: string; from: number; to: number; direction?: Direction; loop?: boolean }[];
}

export type ParsedSheet = { ok: true; json: SheetJson } | { ok: false; error: string };

export function parseSheetJson(text: string): ParsedSheet {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `not valid JSON: ${e instanceof Error ? e.message : e}` };
  }
  const o = v as SheetJson;
  if (!o || typeof o !== "object" || Array.isArray(o)) return { ok: false, error: "a sprite file is a JSON object" };
  const side = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n > 0 && n <= MAX_SIDE;
  if (!side(o.frame_width) || !side(o.frame_height)) return { ok: false, error: `"frame_width" and "frame_height" must be whole numbers from 1 to ${MAX_SIDE}` };
  if (o.tags !== undefined && !Array.isArray(o.tags)) return { ok: false, error: '"tags" must be a list' };
  return { ok: true, json: o };
}

/// Cuts a loaded sheet image into a document, the same way the runtime reads it.
export function fromSheet(sheet: Raster, json: SheetJson): SpriteDoc {
  const fw = json.frame_width;
  const fh = json.frame_height;
  const fit = Math.max(1, Math.floor(sheet.w / fw));
  const columns = Math.max(1, Math.min(json.columns ?? fit, fit));
  const rows = Math.max(1, Math.floor(sheet.h / fh));
  const count = Math.max(1, Math.min(json.frames ?? columns * rows, columns * rows, MAX_FRAMES));
  const frames = Array.from({ length: count }, (_, i) => crop(sheet, (i % columns) * fw, Math.floor(i / columns) * fh, fw, fh));
  const durations = frames.map((_, i) => json.durations_ms?.[i] ?? json.frame_duration_ms ?? DEFAULT_DURATION);
  const tags: Tag[] = (json.tags ?? [])
    .filter((t) => t && typeof t.name === "string" && Number.isInteger(t.from) && Number.isInteger(t.to))
    .map((t) => ({ name: t.name, from: t.from, to: t.to, direction: t.direction ?? "forward", loop: t.loop ?? true }))
    .filter((t) => t.from >= 0 && t.to >= t.from && t.to < count);
  return { fw, fh, frames, durations, tags };
}

/// A single PNG as a one-frame document.
export function fromImage(image: Raster): SpriteDoc {
  return { fw: image.w, fh: image.h, frames: [cloneRaster(image)], durations: [DEFAULT_DURATION], tags: [] };
}

/// The `*.sprite.json` text for a document whose sheet PNG is `image` (relative to the JSON file).
export function toSheetJson(doc: SpriteDoc, image: string): string {
  const columns = sheetColumns(doc.frames.length);
  const lines: string[] = [
    `  "version": 1`,
    `  "image": ${JSON.stringify(image)}`,
    `  "frame_width": ${doc.fw}`,
    `  "frame_height": ${doc.fh}`,
    ...(columns > 1 ? [`  "columns": ${columns}`] : []),
    ...(doc.frames.length > 1 ? [`  "frames": ${doc.frames.length}`] : []),
  ];
  const first = doc.durations[0] ?? DEFAULT_DURATION;
  lines.push(doc.durations.every((d) => d === first) ? `  "frame_duration_ms": ${first}` : `  "durations_ms": [${doc.durations.join(", ")}]`);
  if (doc.tags.length) {
    const tags = doc.tags.map((t) => {
      const parts = [`"name": ${JSON.stringify(t.name)}`, `"from": ${t.from}`, `"to": ${t.to}`];
      if (t.direction !== "forward") parts.push(`"direction": "${t.direction}"`);
      if (!t.loop) parts.push(`"loop": false`);
      return `    { ${parts.join(", ")} }`;
    });
    lines.push(`  "tags": [\n${tags.join(",\n")}\n  ]`);
  }
  return `{\n${lines.join(",\n")}\n}\n`;
}

/// Frame whose picture should show at `ms` into a looping run of `sequence` (durations come from the doc).
export function frameAt(doc: SpriteDoc, sequence: number[], ms: number, loop = true): number {
  if (sequence.length === 0) return 0;
  const total = sequence.reduce((sum, f) => sum + (doc.durations[f] ?? DEFAULT_DURATION), 0);
  let t = loop ? ms % Math.max(1, total) : Math.min(ms, total - 1);
  for (const f of sequence) {
    const d = doc.durations[f] ?? DEFAULT_DURATION;
    if (t < d) return f;
    t -= d;
  }
  return sequence[sequence.length - 1]!;
}

import { resizeCanvas } from "./pixels";

/// Every frame on a new canvas size (see `resizeCanvas` for the anchor). Tags and durations are untouched.
export function resizeDoc(doc: SpriteDoc, w: number, h: number, anchorX = 0, anchorY = 0): SpriteDoc {
  const side = (n: number) => Math.max(1, Math.min(MAX_SIDE, Math.floor(n)));
  const nw = side(w);
  const nh = side(h);
  if (nw === doc.fw && nh === doc.fh) return doc;
  return { ...cloneDoc(doc), fw: nw, fh: nh, frames: doc.frames.map((f) => resizeCanvas(f, nw, nh, anchorX, anchorY)) };
}
