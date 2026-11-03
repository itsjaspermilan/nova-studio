// A sprite document: equal-sized frames, per-frame durations and animations. It maps onto a PNG sheet plus a
// `*.sprite.json` file (format v1, see crates/nova-runtime/src/sprite.rs).
//
// In the studio every animation owns its frames: the frames are one list, and the animations (`tags`) are
// consecutive blocks of it that cover every frame once, in order. So adding, removing or moving a frame
// touches one animation only, and the saved file's tags never overlap. Files from elsewhere whose tags
// overlap or leave gaps are split into such blocks when they are opened (`normalizeAnimations`).

import { blit, cloneRaster, composite, crop, isClear, newRaster, resizeCanvas, type Raster } from "./pixels";

export type Direction = "forward" | "reverse" | "pingpong";
export interface Tag {
  name: string;
  from: number;
  to: number;
  direction: Direction;
  loop: boolean;
}
/// One layer: a picture for every frame (`cels[frame]`). Layers stack bottom (index 0) to top.
export interface Layer {
  name: string;
  visible: boolean;
  /// 0 to 1.
  opacity: number;
  cels: Raster[];
}
export interface SpriteDoc {
  fw: number;
  fh: number;
  /// What the frames look like with every visible layer stacked: what is shown, previewed and exported.
  frames: Raster[];
  durations: number[];
  tags: Tag[];
  layers: Layer[];
}

export const MAX_LAYERS = 32;
const layerOf = (name: string, cels: Raster[]): Layer => ({ name, visible: true, opacity: 1, cels });

export const DEFAULT_DURATION = 100;
export const MAX_SIDE = 1024;
export const MAX_FRAMES = 256;
export const SHEET_COLUMNS = 16;

export const DEFAULT_ANIMATION = "idle";

export function newDoc(fw: number, fh: number, frames = 1): SpriteDoc {
  const blank = () => Array.from({ length: frames }, () => newRaster(fw, fh));
  return {
    fw, fh, frames: blank(), durations: Array(frames).fill(DEFAULT_DURATION),
    tags: [{ name: DEFAULT_ANIMATION, from: 0, to: frames - 1, direction: "forward", loop: true }], layers: [layerOf("Layer 1", blank())],
  };
}

export function cloneDoc(d: SpriteDoc): SpriteDoc {
  return {
    fw: d.fw, fh: d.fh, frames: d.frames.map(cloneRaster), durations: [...d.durations], tags: d.tags.map((t) => ({ ...t })),
    layers: d.layers.map((l) => ({ ...l, cels: l.cels.map(cloneRaster) })),
  };
}

/// Frame `i` with every visible layer stacked, bottom to top.
export function composeFrame(doc: SpriteDoc, i: number): Raster {
  let out = newRaster(doc.fw, doc.fh);
  for (const layer of doc.layers) {
    const cel = layer.cels[i];
    if (layer.visible && layer.opacity > 0 && cel) out = composite(out, cel, layer.opacity);
  }
  return out;
}

/// Refreshes the stacked picture of one frame (after drawing on a cel), in place.
export function recompose(doc: SpriteDoc, i: number) {
  const frame = doc.frames[i];
  if (frame) frame.data.set(composeFrame(doc, i).data);
}

const recomposed = (doc: SpriteDoc): SpriteDoc => {
  doc.frames.forEach((_, i) => recompose(doc, i));
  return doc;
};

/// The frame numbers one pass of a tag plays; ping-pong goes there and back without repeating the ends (as the runtime does).
export function tagSequence(tag: Tag): number[] {
  const forward: number[] = [];
  for (let i = tag.from; i <= tag.to; i++) forward.push(i);
  if (tag.direction === "reverse") return forward.reverse();
  if (tag.direction === "pingpong" && forward.length > 2) return [...forward, ...forward.slice(1, -1).reverse()];
  return forward;
}

// ---- animations: consecutive blocks of frames ------------------------------------------------------------

export const framesIn = (t: Tag) => t.to - t.from + 1;

/// The animation a frame belongs to (-1 when there are none).
export function animationOf(doc: SpriteDoc, frame: number): number {
  return doc.tags.findIndex((t) => frame >= t.from && frame <= t.to);
}

const isPartition = (doc: SpriteDoc) =>
  doc.tags.length > 0 && doc.tags[0]!.from === 0 && doc.tags.every((t, i) => t.to >= t.from && (i === 0 || t.from === doc.tags[i - 1]!.to + 1)) && doc.tags.at(-1)!.to === doc.frames.length - 1;

const uniqueName = (doc: SpriteDoc, base: string) => {
  const used = new Set(doc.tags.map((t) => t.name));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
};

/// A document made of the given blocks, in order: each block is an animation and the old frame numbers it plays
/// (a number may appear in several blocks or none; the pictures are copied).
function assemble(doc: SpriteDoc, blocks: { tag: Tag; frames: number[] }[]): SpriteDoc {
  const order = blocks.flatMap((b) => b.frames);
  const next = cloneDoc(doc);
  next.frames = order.map((i) => cloneRaster(doc.frames[i]!));
  next.durations = order.map((i) => doc.durations[i]!);
  next.layers = doc.layers.map((l) => ({ ...l, cels: order.map((i) => cloneRaster(l.cels[i]!)) }));
  let at = 0;
  next.tags = blocks.map(({ tag, frames }) => {
    const out = { ...tag, from: at, to: at + frames.length - 1 };
    at += frames.length;
    return out;
  });
  return next;
}

const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
const blocksOf = (doc: SpriteDoc) => doc.tags.map((tag) => ({ tag, frames: range(tag.from, tag.to) }));

/// Makes the animations consecutive blocks that cover every frame once. A frame in two animations is copied into
/// each; frames in none go into an animation of their own. Documents that already are blocks come back unchanged.
export function normalizeAnimations(doc: SpriteDoc): SpriteDoc {
  const n = doc.frames.length;
  if (n === 0 || isPartition(doc)) return doc;
  const tags = doc.tags.filter((t) => t.from >= 0 && t.to >= t.from && t.to < n).sort((a, b) => a.from - b.from);
  const blocks = tags.map((tag) => ({ tag, frames: range(tag.from, tag.to) }));
  const covered = new Set(blocks.flatMap((b) => b.frames));
  const loose = range(0, n - 1).filter((i) => !covered.has(i));
  if (loose.length) blocks.push({ tag: { name: blocks.length ? "unused" : DEFAULT_ANIMATION, from: 0, to: 0, direction: "forward", loop: true }, frames: loose });
  return assemble(doc, blocks);
}

function shiftFrom(tags: Tag[], at: number, by: number, skip = -1) {
  tags.forEach((t, i) => {
    if (i === skip) return;
    if (t.from >= at) {
      t.from += by;
      t.to += by;
    }
  });
}

/// Inserts a frame so it ends up at `index` (blank, or a copy of `copyOf`). It joins the animation the frame
/// before it is in (or `anim`, when given); later animations move along.
export function insertFrame(doc: SpriteDoc, index: number, copyOf?: number, anim?: number): SpriteDoc {
  if (doc.frames.length >= MAX_FRAMES) return doc;
  const next = cloneDoc(doc);
  const at = Math.max(0, Math.min(index, next.frames.length));
  const owner = anim ?? animationOf(next, Math.max(0, Math.min(at - 1, next.frames.length - 1)));
  if (!next.tags[owner]) return doc;
  next.frames.splice(at, 0, copyOf === undefined ? newRaster(next.fw, next.fh) : cloneRaster(next.frames[copyOf]!));
  for (const l of next.layers) l.cels.splice(at, 0, copyOf === undefined ? newRaster(next.fw, next.fh) : cloneRaster(l.cels[copyOf]!));
  next.durations.splice(at, 0, copyOf === undefined ? DEFAULT_DURATION : next.durations[copyOf]!);
  shiftFrom(next.tags, at, 1, owner);
  next.tags[owner]!.to++;
  return next;
}

/// Removes a frame from its animation. An animation keeps at least one frame (remove the animation instead).
export function removeFrame(doc: SpriteDoc, index: number): SpriteDoc {
  const owner = animationOf(doc, index);
  if (owner < 0 || framesIn(doc.tags[owner]!) <= 1) return doc;
  const next = cloneDoc(doc);
  next.frames.splice(index, 1);
  for (const l of next.layers) l.cels.splice(index, 1);
  next.durations.splice(index, 1);
  next.tags[owner]!.to--;
  shiftFrom(next.tags, index + 1, -1, owner);
  return next;
}

/// Moves a frame to a new position inside its animation (other animations are left alone).
export function moveFrame(doc: SpriteDoc, from: number, to: number): SpriteDoc {
  const owner = animationOf(doc, from);
  if (from === to || owner < 0 || animationOf(doc, to) !== owner) return doc;
  const next = cloneDoc(doc);
  const [frame] = next.frames.splice(from, 1);
  const [duration] = next.durations.splice(from, 1);
  next.frames.splice(to, 0, frame!);
  for (const l of next.layers) {
    const [cel] = l.cels.splice(from, 1);
    l.cels.splice(to, 0, cel!);
  }
  next.durations.splice(to, 0, duration!);
  return next;
}

/// A new animation of one blank frame, after the others.
export function addAnimation(doc: SpriteDoc, name = "animation"): { doc: SpriteDoc; index: number } {
  if (doc.frames.length >= MAX_FRAMES) return { doc, index: doc.tags.length - 1 };
  const next = cloneDoc(doc);
  const at = next.frames.length;
  next.frames.push(newRaster(next.fw, next.fh));
  for (const l of next.layers) l.cels.push(newRaster(next.fw, next.fh));
  next.durations.push(DEFAULT_DURATION);
  next.tags.push({ name: uniqueName(doc, name), from: at, to: at, direction: "forward", loop: true });
  return { doc: next, index: next.tags.length - 1 };
}

/// A copy of an animation (all its frames) right after it.
export function duplicateAnimation(doc: SpriteDoc, index: number): { doc: SpriteDoc; index: number } {
  const t = doc.tags[index];
  if (!t || doc.frames.length + framesIn(t) > MAX_FRAMES) return { doc, index };
  const blocks = blocksOf(doc);
  blocks.splice(index + 1, 0, { tag: { ...t, name: uniqueName(doc, `${t.name} copy`) }, frames: range(t.from, t.to) });
  return { doc: assemble(doc, blocks), index: index + 1 };
}

/// Removes an animation with its frames (the last animation cannot be removed).
export function removeAnimation(doc: SpriteDoc, index: number): { doc: SpriteDoc; index: number } {
  if (doc.tags.length <= 1 || !doc.tags[index]) return { doc, index };
  const blocks = blocksOf(doc);
  blocks.splice(index, 1);
  return { doc: assemble(doc, blocks), index: Math.min(index, blocks.length - 1) };
}

/// Swaps an animation with its neighbour (`delta` -1 or 1), taking its frames with it.
export function moveAnimation(doc: SpriteDoc, index: number, delta: number): { doc: SpriteDoc; index: number } {
  const to = index + delta;
  if (!doc.tags[index] || to < 0 || to >= doc.tags.length || delta === 0) return { doc, index };
  const blocks = blocksOf(doc);
  const [moved] = blocks.splice(index, 1);
  blocks.splice(to, 0, moved!);
  return { doc: assemble(doc, blocks), index: to };
}

export function updateAnimation(doc: SpriteDoc, index: number, change: Partial<Pick<Tag, "name" | "direction" | "loop">>): SpriteDoc {
  if (!doc.tags[index]) return doc;
  const next = cloneDoc(doc);
  Object.assign(next.tags[index]!, change);
  return next;
}

/// Gives every frame of an animation the same duration.
export function setAnimationDuration(doc: SpriteDoc, index: number, ms: number): SpriteDoc {
  const t = doc.tags[index];
  if (!t || !Number.isFinite(ms) || ms < 10) return doc;
  const next = cloneDoc(doc);
  for (let i = t.from; i <= t.to; i++) next.durations[i] = Math.round(ms);
  return next;
}

// ---- importing sheets --------------------------------------------------------------------------------------

/// How a picture of tiles is cut up: tile size, the gap between tiles and the border around them.
export interface GridSpec {
  tw: number;
  th: number;
  spacing?: number;
  margin?: number;
}

/// The tiles of a sheet, row by row.
export function gridTiles(sheet: Raster, g: GridSpec): { tiles: Raster[]; columns: number; rows: number } {
  const [tw, th, gap, margin] = [Math.max(1, Math.floor(g.tw)), Math.max(1, Math.floor(g.th)), Math.max(0, Math.floor(g.spacing ?? 0)), Math.max(0, Math.floor(g.margin ?? 0))];
  const columns = Math.max(0, Math.floor((sheet.w - 2 * margin + gap) / (tw + gap)));
  const rows = Math.max(0, Math.floor((sheet.h - 2 * margin + gap) / (th + gap)));
  const tiles: Raster[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) tiles.push(crop(sheet, margin + c * (tw + gap), margin + r * (th + gap), tw, th));
  return { tiles, columns, rows };
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/// A first guess at the tile size of a sheet: the biggest common square size that cuts it into at least two tiles
/// with nothing left over; failing that, squares as tall as the picture; failing that, the whole picture.
export function detectGrid(sheet: Raster): GridSpec {
  const { w, h } = sheet;
  for (const s of [256, 128, 96, 64, 48, 32, 24, 16, 12, 8]) {
    if (w % s === 0 && h % s === 0 && (w / s) * (h / s) >= 2) return { tw: s, th: s };
  }
  if (w > h && w % h === 0) return { tw: h, th: h };
  if (h > w && h % w === 0) return { tw: w, th: w };
  const g = gcd(w, h);
  return g >= 4 && (w / g) * (h / g) >= 2 ? { tw: g, th: g } : { tw: w, th: h };
}

/// The tile size for a sheet cut into `columns` x `rows` tiles (with the same gap and border options as `gridTiles`).
export function gridFromCounts(sheet: Raster, columns: number, rows: number, spacing = 0, margin = 0): GridSpec {
  const [c, r] = [Math.max(1, Math.floor(columns)), Math.max(1, Math.floor(rows))];
  return {
    tw: Math.max(1, Math.floor((sheet.w - 2 * margin - (c - 1) * spacing) / c)),
    th: Math.max(1, Math.floor((sheet.h - 2 * margin - (r - 1) * spacing) / r)),
    spacing,
    margin,
  };
}

/// Runs of pixels (columns or rows) that have something in them, as [start, end] pairs.
function runs(has: boolean[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < has.length; i++) {
    if (!has[i]) continue;
    let j = i;
    while (j + 1 < has.length && has[j + 1]) j++;
    out.push([i, j]);
    i = j;
  }
  return out;
}

/// Finds the grid of a sheet whose tiles are separated by empty gutters: every tile the same size, every gutter the same
/// width, and the same border all round. Null when the sheet is not laid out like that (tiles touching, or uneven).
export function smartGrid(sheet: Raster): GridSpec | null {
  const col = Array.from({ length: sheet.w }, () => false);
  const row = Array.from({ length: sheet.h }, () => false);
  for (let y = 0; y < sheet.h; y++) for (let x = 0; x < sheet.w; x++) {
    if (sheet.data[(y * sheet.w + x) * 4 + 3]! > 0) col[x] = row[y] = true;
  }
  const [cs, rs] = [runs(col), runs(row)];
  if (!cs.length || !rs.length || cs.length * rs.length < 2) return null;
  const even = (list: [number, number][], total: number) => {
    const size = list[0]![1] - list[0]![0] + 1;
    const gap = list.length > 1 ? list[1]![0] - list[0]![1] - 1 : 0;
    const ok = list.every((r, i) => r[1] - r[0] + 1 === size && (i === 0 || r[0] - list[i - 1]![1] - 1 === gap));
    const margin = list[0]![0];
    const endMargin = total - 1 - list.at(-1)![1];
    return ok && endMargin === margin ? { size, gap, margin } : null;
  };
  const [a, b] = [even(cs, sheet.w), even(rs, sheet.h)];
  if (!a || !b) return null;
  // a single row or column has no gap to measure: take the other axis's
  const gap = cs.length > 1 ? a.gap : rs.length > 1 ? b.gap : 0;
  if (cs.length > 1 && rs.length > 1 && a.gap !== b.gap) return null;
  if (a.margin !== b.margin) return null;
  return { tw: a.size, th: b.size, spacing: gap, margin: a.margin };
}

/// A fresh sprite that has not been drawn on: one blank frame in one animation.
export function isPristine(doc: SpriteDoc): boolean {
  return doc.frames.length === 1 && doc.tags.length === 1 && doc.layers.length === 1 && isClear(doc.frames[0]!);
}

export interface TileGroup {
  name: string;
  tiles: Raster[];
}

/// Puts groups of tiles into a sprite as animations, one per group, after the existing ones. Each tile goes on
/// layer `layer`, sized to the sprite's frames (bottom centre kept) — except that an untouched sprite takes the tile
/// size itself. With `append`, the tiles of the first group join the end of that animation instead. `truncated`
/// counts tiles that did not fit under the frame limit.
export function importTiles(
  doc: SpriteDoc, groups: TileGroup[], opts: { append?: number; layer?: number; durationMs?: number } = {},
): { doc: SpriteDoc; index: number; added: number; truncated: number } {
  const usable = groups.filter((g) => g.tiles.length > 0);
  if (!usable.length) return { doc, index: Math.max(0, doc.tags.length - 1), added: 0, truncated: 0 };
  const ms = Math.max(10, Math.round(opts.durationMs ?? DEFAULT_DURATION));
  let base = doc;
  const fresh = isPristine(doc) && opts.append === undefined;
  if (fresh) {
    const first = usable[0]!.tiles[0]!;
    base = newDoc(first.w, first.h, 1);
    base.frames = [];
    base.durations = [];
    base.tags = [];
    base.layers = [{ ...base.layers[0]!, cels: [] }];
  }
  const layer = Math.min(Math.max(0, opts.layer ?? 0), base.layers.length - 1);
  const fit = (t: Raster) => (t.w === base.fw && t.h === base.fh ? cloneRaster(t) : resizeCanvas(t, base.fw, base.fh, 0.5, 1));
  const blocks = blocksOf(base);
  let room = MAX_FRAMES - base.frames.length;
  let truncated = 0;
  let added = 0;
  let index = Math.max(0, base.tags.length - 1);
  const extra: Raster[][] = []; // new pictures for each block, in block order
  const names = new Set(base.tags.map((t) => t.name));
  usable.forEach((g, gi) => {
    const take = g.tiles.slice(0, Math.max(0, room));
    truncated += g.tiles.length - take.length;
    room -= take.length;
    if (!take.length) return;
    added += take.length;
    if (opts.append !== undefined && gi === 0 && base.tags[opts.append]) {
      extra[opts.append] = [...(extra[opts.append] ?? []), ...take];
      index = opts.append;
      return;
    }
    let name = g.name.trim() || "animation";
    for (let n = 2; names.has(name); n++) name = `${g.name.trim() || "animation"} ${n}`;
    names.add(name);
    blocks.push({ tag: { name, from: 0, to: 0, direction: "forward", loop: true }, frames: [] });
    extra[blocks.length - 1] = take;
    index = blocks.length - 1;
  });
  // Build the new frame list: each block's old frames, then its new tiles.
  const frames: Raster[] = [];
  const durations: number[] = [];
  const cels: Raster[][] = base.layers.map(() => []);
  const tags: Tag[] = [];
  blocks.forEach((b, i) => {
    const start = frames.length;
    for (const f of b.frames) {
      frames.push(cloneRaster(base.frames[f]!));
      durations.push(base.durations[f]!);
      base.layers.forEach((l, li) => cels[li]!.push(cloneRaster(l.cels[f]!)));
    }
    for (const t of extra[i] ?? []) {
      const picture = fit(t);
      frames.push(picture);
      durations.push(ms);
      base.layers.forEach((_, li) => cels[li]!.push(li === layer ? cloneRaster(picture) : newRaster(base.fw, base.fh)));
    }
    tags.push({ ...b.tag, from: start, to: frames.length - 1 });
  });
  const next: SpriteDoc = { ...cloneDoc(base), frames, durations, tags, layers: base.layers.map((l, li) => ({ ...l, cels: cels[li]! })) };
  return { doc: recomposed(next), index, added, truncated };
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
  const frames = cutFrames(sheet, fw, fh, count, columns);
  const durations = frames.map((_, i) => json.durations_ms?.[i] ?? json.frame_duration_ms ?? DEFAULT_DURATION);
  const tags: Tag[] = (json.tags ?? [])
    .filter((t) => t && typeof t.name === "string" && Number.isInteger(t.from) && Number.isInteger(t.to))
    .map((t) => ({ name: t.name, from: t.from, to: t.to, direction: t.direction ?? "forward", loop: t.loop ?? true }))
    .filter((t) => t.from >= 0 && t.to >= t.from && t.to < count);
  return normalizeAnimations({ fw, fh, frames, durations, tags, layers: [layerOf("Layer 1", frames.map(cloneRaster))] });
}

/// Cuts `count` frames of fw x fh out of a sheet laid out `columns` wide.
export function cutFrames(sheet: Raster, fw: number, fh: number, count: number, columns: number): Raster[] {
  return Array.from({ length: count }, (_, i) => crop(sheet, (i % columns) * fw, Math.floor(i / columns) * fh, fw, fh));
}

/// A single PNG as a one-frame document.
export function fromImage(image: Raster): SpriteDoc {
  return { fw: image.w, fh: image.h, frames: [cloneRaster(image)], durations: [DEFAULT_DURATION], tags: [{ name: DEFAULT_ANIMATION, from: 0, to: 0, direction: "forward", loop: true }], layers: [layerOf("Layer 1", [cloneRaster(image)])] };
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

/// Every frame on a new canvas size (see `resizeCanvas` for the anchor). Tags and durations are untouched.
export function resizeDoc(doc: SpriteDoc, w: number, h: number, anchorX = 0, anchorY = 0): SpriteDoc {
  const side = (n: number) => Math.max(1, Math.min(MAX_SIDE, Math.floor(n)));
  const nw = side(w);
  const nh = side(h);
  if (nw === doc.fw && nh === doc.fh) return doc;
  const base = cloneDoc(doc);
  return {
    ...base, fw: nw, fh: nh,
    frames: doc.frames.map((f) => resizeCanvas(f, nw, nh, anchorX, anchorY)),
    layers: doc.layers.map((l) => ({ ...l, cels: l.cels.map((c) => resizeCanvas(c, nw, nh, anchorX, anchorY)) })),
  };
}


// ---- layers ---------------------------------------------------------------------------------------------

const clampOpacity = (n: number) => Math.min(1, Math.max(0, n));

/// A new empty layer just above `above`. Returns the new layer's index.
export function addLayer(doc: SpriteDoc, above: number): { doc: SpriteDoc; index: number } {
  if (doc.layers.length >= MAX_LAYERS) return { doc, index: above };
  const next = cloneDoc(doc);
  const index = Math.max(0, Math.min(above + 1, next.layers.length));
  const used = new Set(next.layers.map((l) => l.name));
  let n = next.layers.length + 1;
  while (used.has(`Layer ${n}`)) n++;
  next.layers.splice(index, 0, layerOf(`Layer ${n}`, doc.frames.map(() => newRaster(doc.fw, doc.fh))));
  return { doc: recomposed(next), index };
}

export function duplicateLayer(doc: SpriteDoc, index: number): { doc: SpriteDoc; index: number } {
  const src = doc.layers[index];
  if (!src || doc.layers.length >= MAX_LAYERS) return { doc, index };
  const next = cloneDoc(doc);
  next.layers.splice(index + 1, 0, { ...src, name: `${src.name} copy`, cels: src.cels.map(cloneRaster) });
  return { doc: recomposed(next), index: index + 1 };
}

/// Removes a layer (never the last one).
export function removeLayer(doc: SpriteDoc, index: number): SpriteDoc {
  if (doc.layers.length <= 1 || !doc.layers[index]) return doc;
  const next = cloneDoc(doc);
  next.layers.splice(index, 1);
  return recomposed(next);
}

/// Moves a layer up (+1) or down (-1) in the stack. Returns where it ended up.
export function moveLayer(doc: SpriteDoc, index: number, delta: number): { doc: SpriteDoc; index: number } {
  const to = index + delta;
  if (!doc.layers[index] || to < 0 || to >= doc.layers.length || delta === 0) return { doc, index };
  const next = cloneDoc(doc);
  const [layer] = next.layers.splice(index, 1);
  next.layers.splice(to, 0, layer!);
  return { doc: recomposed(next), index: to };
}

export function updateLayer(doc: SpriteDoc, index: number, change: Partial<Pick<Layer, "name" | "visible" | "opacity">>): SpriteDoc {
  if (!doc.layers[index]) return doc;
  const next = cloneDoc(doc);
  const l = next.layers[index]!;
  if (change.name !== undefined && change.name.trim()) l.name = change.name.trim();
  if (change.visible !== undefined) l.visible = change.visible;
  if (change.opacity !== undefined) l.opacity = clampOpacity(change.opacity);
  return recomposed(next);
}

/// Paints a layer onto the one below it (using its opacity) and removes it. Returns the index of the merged layer.
export function mergeDown(doc: SpriteDoc, index: number): { doc: SpriteDoc; index: number } {
  if (index <= 0 || !doc.layers[index]) return { doc, index };
  const next = cloneDoc(doc);
  const top = next.layers[index]!;
  const below = next.layers[index - 1]!;
  below.cels = below.cels.map((c, f) => composite(c, top.cels[f]!, top.visible ? top.opacity : 0));
  next.layers.splice(index, 1);
  return { doc: recomposed(next), index: index - 1 };
}

// ---- keeping layers in a file next to the sheet ------------------------------------------------------------

/// A short fingerprint of a picture (FNV-1a over its size and pixels).
export function hashRaster(r: Raster): string {
  let h = 0x811c9dc5;
  const mix = (n: number) => {
    h ^= n & 255;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  for (const n of [r.w & 255, r.w >> 8, r.h & 255, r.h >> 8]) mix(n);
  for (const b of r.data) mix(b);
  return h.toString(16).padStart(8, "0");
}

export interface LayersFile {
  version: 1;
  /// Fingerprint of the exported sheet these layers add up to; a different sheet means it was changed elsewhere.
  sheet: string;
  frames: number;
  columns: number;
  layers: { name: string; visible: boolean; opacity: number; image: string }[];
}

/// Each layer as a sheet laid out like the exported one.
export function layerSheets(doc: SpriteDoc): Raster[] {
  return doc.layers.map((l) => toSheet({ ...doc, frames: l.cels }));
}

export function layersFileText(doc: SpriteDoc, images: string[]): string {
  const file: LayersFile = {
    version: 1, sheet: hashRaster(toSheet(doc)), frames: doc.frames.length, columns: sheetColumns(doc.frames.length),
    layers: doc.layers.map((l, i) => ({ name: l.name, visible: l.visible, opacity: l.opacity, image: images[i]! })),
  };
  return `${JSON.stringify(file, null, 1)}\n`;
}

export function parseLayersFile(text: string): LayersFile | null {
  try {
    const f = JSON.parse(text) as LayersFile;
    const good = f && f.version === 1 && typeof f.sheet === "string" && Number.isInteger(f.frames) && Number.isInteger(f.columns) && Array.isArray(f.layers) && f.layers.length > 0 && f.layers.length <= MAX_LAYERS
      && f.layers.every((l) => typeof l.name === "string" && typeof l.visible === "boolean" && typeof l.opacity === "number" && typeof l.image === "string");
    return good ? f : null;
  } catch {
    return null;
  }
}

/// Puts saved layers back on a document read from the flat sheet. Returns null (keep the flat picture as one
/// layer) when the layers do not add up to the sheet, meaning the PNG was edited outside the studio.
export function applyLayers(doc: SpriteDoc, file: LayersFile, sheets: Raster[]): SpriteDoc | null {
  if (file.frames !== doc.frames.length || sheets.length !== file.layers.length) return null;
  const columns = Math.max(1, file.columns);
  const next = cloneDoc(doc);
  next.layers = file.layers.map((l, i) => ({
    name: l.name, visible: l.visible, opacity: clampOpacity(l.opacity),
    cels: cutFrames(sheets[i]!, doc.fw, doc.fh, doc.frames.length, columns),
  }));
  recomposed(next);
  return hashRaster(toSheet(next)) === file.sheet && hashRaster(toSheet(next)) === hashRaster(toSheet(doc)) ? next : null;
}
