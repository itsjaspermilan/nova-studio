// A sprite document: equal-sized frames, per-frame durations and animations. It maps onto a PNG sheet plus a
// `*.sprite.json` file (format v1, see crates/nova-runtime/src/sprite.rs).
//
// In the studio every animation owns its frames: the frames are one list, and the animations (`tags`) are
// consecutive blocks of it that cover every frame once, in order. So adding, removing or moving a frame
// touches one animation only, and the saved file's tags never overlap. Files from elsewhere whose tags
// overlap or leave gaps are split into such blocks when they are opened (`normalizeAnimations`).

import { applyLayerEffects, cleanLayerEffects, type LayerEffect } from "./layer-fx";
import { BLEND_MODES, blit, cloneRaster, composite, crop, isClear, newRaster, resizeCanvas, type BlendMode, type Raster } from "./pixels";

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
  /// How the layer combines with the ones under it (missing means normal).
  blend?: BlendMode;
  /// A locked layer cannot be drawn on or changed by the tools (hidden or not).
  locked?: boolean;
  /// A clipping layer shows only where the layer below it (the nearest one that is not clipping) has something: shading and highlights that stay inside a shape.
  clip?: boolean;
  /// Effects that stay on the layer: run on each cel when the picture is stacked (lib/layer-fx.ts), so the drawing itself is never changed.
  effects?: LayerEffect[];
  /// A group layer holds the layers just below it that are one level deeper (`depth`): they are stacked together first and the result is what the group
  /// shows, with the group's own opacity, blend mode, visibility and effects. A group has no drawing of its own (its cels are blank and locked).
  kind?: "group";
  /// How deep the layer sits in groups (0, or missing, at the top level).
  depth?: number;
  cels: Raster[];
  /// For each cel, 0 or a group number: cels of this layer with the same number are linked, and drawing on one draws on all.
  links?: number[];
}
/// A box in pixels of a frame, from its top left.
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Point2 {
  x: number;
  y: number;
}
/// What one frame carries besides its picture: a hitbox, a pivot (where it stands) and the names of events that fire when it comes up (docs/project-format.md).
export interface FrameData {
  hitbox?: Box;
  pivot?: Point2;
  events?: string[];
}
/// Border sizes for stretching a picture as a panel.
export interface NineSlice {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
export const MAX_EVENTS = 8;

export interface SpriteDoc {
  fw: number;
  fh: number;
  /// Per frame (same length as `frames` when present; null for a frame with nothing of its own), and the defaults every frame starts from.
  data?: (FrameData | null)[];
  defaults?: { hitbox?: Box; pivot?: Point2 };
  nineSlice?: NineSlice;
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
    layers: d.layers.map((l) => ({ ...l, cels: l.cels.map(cloneRaster), ...(l.links ? { links: [...l.links] } : {}), ...(l.effects ? { effects: JSON.parse(JSON.stringify(l.effects)) as LayerEffect[] } : {}) })),
    ...(d.data ? { data: d.data.map((x) => (x ? (JSON.parse(JSON.stringify(x)) as FrameData) : null)) } : {}),
    ...(d.defaults ? { defaults: JSON.parse(JSON.stringify(d.defaults)) as SpriteDoc["defaults"] } : {}),
    ...(d.nineSlice ? { nineSlice: { ...d.nineSlice } } : {}),
  };
}

/// Frame `i` with every visible layer stacked, bottom to top. A group's layers are stacked first and the result goes on as one layer.
export function composeFrame(doc: SpriteDoc, i: number): Raster {
  // what has been stacked so far at each depth of group
  const acc: (Raster | undefined)[] = [];
  // what the nearest layer below that is not clipping has in this frame (its own picture, whether or not it is shown), as 0 to 255 per pixel, at each depth
  const bases: (Uint8ClampedArray | null)[] = [];
  for (const layer of doc.layers) {
    const d = layer.depth ?? 0;
    if (layer.kind === "group") {
      const inner = acc[d + 1];
      acc[d + 1] = undefined;
      bases[d + 1] = null;
      if (!inner || !(layer.visible && layer.opacity > 0)) continue;
      acc[d] = composite(acc[d] ?? newRaster(doc.fw, doc.fh), applyLayerEffects(inner, layer.effects), layer.opacity, layer.blend);
      continue;
    }
    const cel = layer.cels[i];
    if (!layer.clip && cel) bases[d] = cel.data;
    if (!(layer.visible && layer.opacity > 0 && cel)) continue;
    let shown = layer.effects?.length ? applyLayerEffects(cel, layer.effects) : cel;
    const base = bases[d];
    if (layer.clip && base) {
      shown = { w: shown.w, h: shown.h, data: new Uint8ClampedArray(shown.data) };
      for (let k = 3; k < shown.data.length; k += 4) shown.data[k] = Math.round((shown.data[k]! * base[k]!) / 255);
    } else if (layer.clip) continue; // nothing below to clip to
    acc[d] = composite(acc[d] ?? newRaster(doc.fw, doc.fh), shown, layer.opacity, layer.blend);
  }
  // (layers left deeper than any group, from a damaged file, still show)
  let out = acc[0] ?? newRaster(doc.fw, doc.fh);
  for (let d = 1; d < acc.length; d++) if (acc[d]) out = composite(out, acc[d]!, 1);
  return out;
}

/// Every frame and layer cut down to a rectangle (the sprite gets that size); null when the rectangle holds nothing of the picture.
export function cropDoc(doc: SpriteDoc, rect: { x: number; y: number; w: number; h: number }): SpriteDoc {
  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  const w = Math.min(doc.fw, rect.x + rect.w) - x;
  const h = Math.min(doc.fh, rect.y + rect.h) - y;
  if (w < 1 || h < 1) return doc;
  const next = cloneDoc(doc);
  next.fw = w;
  next.fh = h;
  shiftBoxes(next, -x, -y);
  next.frames = doc.frames.map((f) => crop(f, x, y, w, h));
  next.layers = next.layers.map((l, i) => ({ ...l, cels: doc.layers[i]!.cels.map((c) => crop(c, x, y, w, h)) }));
  return next;
}

/// Moves every hitbox and pivot by an offset (the picture moved under them), dropping what no longer lies inside the new frame (checked by the caller's size).
function shiftBoxes(d: SpriteDoc, dx: number, dy: number) {
  const mb = (b?: Box) => (b ? { ...b, x: b.x + dx, y: b.y + dy } : undefined);
  const mp = (p?: Point2) => (p ? { x: p.x + dx, y: p.y + dy } : undefined);
  if (d.defaults) {
    const hb = mb(d.defaults.hitbox), pv = mp(d.defaults.pivot);
    d.defaults = { ...(hb ? { hitbox: hb } : {}), ...(pv ? { pivot: pv } : {}) };
  }
  d.data = d.data?.map((f) => (f ? { ...f, ...(f.hitbox ? { hitbox: mb(f.hitbox)! } : {}), ...(f.pivot ? { pivot: mp(f.pivot)! } : {}) } : f));
}

// ---- frame data: hitboxes, pivots, events and the nine-slice ------------------------------------------------

/// What frame `i` has of its own (an empty object when nothing).
export const frameDataOf = (doc: SpriteDoc, i: number): FrameData => doc.data?.[i] ?? {};

/// The hitbox and pivot a frame ends up with: its own, else the defaults.
export function effectiveData(doc: SpriteDoc, i: number): { hitbox?: Box; pivot?: Point2; events: string[] } {
  const f = frameDataOf(doc, i);
  return { hitbox: f.hitbox ?? doc.defaults?.hitbox, pivot: f.pivot ?? doc.defaults?.pivot, events: f.events ?? [] };
}

const clampBox = (b: Box, w: number, h: number): Box | null => {
  const x = Math.max(0, Math.min(w - 1, Math.round(b.x)));
  const y = Math.max(0, Math.min(h - 1, Math.round(b.y)));
  const bw = Math.min(w - x, Math.round(b.w));
  const bh = Math.min(h - y, Math.round(b.h));
  return bw >= 1 && bh >= 1 ? { x, y, w: bw, h: bh } : null;
};
const clampPoint = (p: Point2, w: number, h: number): Point2 => ({ x: Math.max(0, Math.min(w, Math.round(p.x))), y: Math.max(0, Math.min(h, Math.round(p.y))) });
const cleanEvents = (list: string[]) => [...new Set(list.map((e) => e.trim().slice(0, 32)).filter(Boolean))].slice(0, MAX_EVENTS);

/// Changes one frame's own data (a field set to null is removed; boxes and points are kept inside the frame). Returns the same doc when nothing changes.
export function setFrameData(doc: SpriteDoc, i: number, change: { hitbox?: Box | null; pivot?: Point2 | null; events?: string[] | null }): SpriteDoc {
  if (i < 0 || i >= doc.frames.length) return doc;
  const next = cloneDoc(doc);
  const data = next.data ?? doc.frames.map(() => null);
  const cur: FrameData = { ...(data[i] ?? {}) };
  if (change.hitbox !== undefined) {
    const b = change.hitbox && clampBox(change.hitbox, doc.fw, doc.fh);
    if (b) cur.hitbox = b;
    else delete cur.hitbox;
  }
  if (change.pivot !== undefined) {
    if (change.pivot) cur.pivot = clampPoint(change.pivot, doc.fw, doc.fh);
    else delete cur.pivot;
  }
  if (change.events !== undefined) {
    const e = change.events ? cleanEvents(change.events) : [];
    if (e.length) cur.events = e;
    else delete cur.events;
  }
  data[i] = Object.keys(cur).length ? cur : null;
  if (JSON.stringify(data[i]) === JSON.stringify(doc.data?.[i] ?? null)) return doc;
  next.data = data.some(Boolean) ? data : undefined;
  if (!next.data) delete next.data;
  return next;
}

/// The same hitbox or pivot or events on every frame of an animation.
export function copyFrameDataTo(doc: SpriteDoc, from: number, tagIndex: number, which: ("hitbox" | "pivot" | "events")[]): SpriteDoc {
  const tag = doc.tags[tagIndex];
  const src = frameDataOf(doc, from);
  if (!tag) return doc;
  let next = doc;
  for (let f = tag.from; f <= tag.to; f++) {
    if (f === from) continue;
    next = setFrameData(next, f, {
      ...(which.includes("hitbox") ? { hitbox: src.hitbox ?? null } : {}),
      ...(which.includes("pivot") ? { pivot: src.pivot ?? null } : {}),
      ...(which.includes("events") ? { events: src.events ?? null } : {}),
    });
  }
  return next;
}

/// The defaults every frame starts from (null removes one).
export function setDefaults(doc: SpriteDoc, change: { hitbox?: Box | null; pivot?: Point2 | null }): SpriteDoc {
  const next = cloneDoc(doc);
  const d = { ...(next.defaults ?? {}) };
  if (change.hitbox !== undefined) {
    const b = change.hitbox && clampBox(change.hitbox, doc.fw, doc.fh);
    if (b) d.hitbox = b;
    else delete d.hitbox;
  }
  if (change.pivot !== undefined) {
    if (change.pivot) d.pivot = clampPoint(change.pivot, doc.fw, doc.fh);
    else delete d.pivot;
  }
  if (Object.keys(d).length) next.defaults = d;
  else delete next.defaults;
  return JSON.stringify(next.defaults) === JSON.stringify(doc.defaults) ? doc : next;
}

/// Sets the nine-slice borders (clamped so left + right fit the width and top + bottom the height); null removes it.
export function setNineSlice(doc: SpriteDoc, n: NineSlice | null): SpriteDoc {
  const next = cloneDoc(doc);
  if (!n || (n.left | n.right | n.top | n.bottom) === 0) delete next.nineSlice;
  else {
    const c = (v: number) => Math.max(0, Math.round(v) || 0);
    let [l, r, t, b] = [c(n.left), c(n.right), c(n.top), c(n.bottom)];
    if (l + r > doc.fw) [l, r] = [Math.min(l, doc.fw), Math.max(0, doc.fw - Math.min(l, doc.fw))];
    if (t + b > doc.fh) [t, b] = [Math.min(t, doc.fh), Math.max(0, doc.fh - Math.min(t, doc.fh))];
    next.nineSlice = { left: l, right: r, top: t, bottom: b };
  }
  return JSON.stringify(next.nineSlice) === JSON.stringify(doc.nineSlice) ? doc : next;
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
  if (doc.data) next.data = order.map((i) => (doc.data![i] ? (JSON.parse(JSON.stringify(doc.data![i])) as FrameData) : null));
  // a frame that appears twice (a copy) keeps its link on the first appearance only
  next.layers = doc.layers.map((l) => {
    const seen = new Set<number>();
    const links = l.links ? order.map((i) => (seen.has(i) ? 0 : (seen.add(i), l.links![i] ?? 0))) : undefined;
    return { ...l, cels: order.map((i) => cloneRaster(l.cels[i]!)), ...(links ? { links } : {}) };
  });
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
  for (const l of next.layers) {
    l.cels.splice(at, 0, copyOf === undefined ? newRaster(next.fw, next.fh) : cloneRaster(l.cels[copyOf]!));
    l.links?.splice(at, 0, 0); // a copy is not linked to what it was copied from
  }
  next.durations.splice(at, 0, copyOf === undefined ? DEFAULT_DURATION : next.durations[copyOf]!);
  next.data?.splice(at, 0, copyOf === undefined ? null : next.data[copyOf] ? (JSON.parse(JSON.stringify(next.data[copyOf])) as FrameData) : null);
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
  for (const l of next.layers) {
    l.cels.splice(index, 1);
    l.links?.splice(index, 1);
  }
  next.durations.splice(index, 1);
  next.data?.splice(index, 1);
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
    if (l.links) {
      const [link] = l.links.splice(from, 1);
      l.links.splice(to, 0, link ?? 0);
    }
  }
  next.durations.splice(to, 0, duration!);
  if (next.data) {
    const [moved] = next.data.splice(from, 1);
    next.data.splice(to, 0, moved ?? null);
  }
  return next;
}

/// Removes several frames at once. An animation keeps at least one frame: if the choice would empty one, its first frame stays.
export function removeFrames(doc: SpriteDoc, indices: number[]): SpriteDoc {
  const gone = new Set(indices.filter((i) => i >= 0 && i < doc.frames.length));
  if (!gone.size) return doc;
  const blocks = blocksOf(doc).map((b) => {
    const keep = b.frames.filter((f) => !gone.has(f));
    return { tag: b.tag, frames: keep.length ? keep : [b.frames[0]!] };
  });
  const next = assemble(doc, blocks);
  return next.frames.length === doc.frames.length ? doc : next;
}

/// Copies of the chosen frames, put right after the last chosen frame of each animation, in order.
export function duplicateFrames(doc: SpriteDoc, indices: number[]): { doc: SpriteDoc; picked: number[] } {
  const chosen = [...new Set(indices.filter((i) => i >= 0 && i < doc.frames.length))].sort((a, b) => a - b);
  if (!chosen.length || doc.frames.length + chosen.length > MAX_FRAMES) return { doc, picked: indices };
  // blocks hold old frame numbers; a copy is a repeat of the number, so `assemble` clones the picture
  const picked: number[] = [];
  let at = 0;
  const blocks = blocksOf(doc).map((b) => {
    const mine = chosen.filter((f) => f >= b.tag.from && f <= b.tag.to);
    const frames = [...b.frames];
    if (mine.length) frames.splice(frames.indexOf(mine.at(-1)!) + 1, 0, ...mine);
    const copyStart = at + frames.indexOf(mine.at(-1) ?? -1) + 1;
    mine.forEach((_, k) => picked.push(copyStart + k));
    at += frames.length;
    return { tag: b.tag, frames };
  });
  return { doc: assemble(doc, blocks), picked };
}

/// Moves the chosen frames to the end of animation `target` (frames of that animation that are chosen stay where they are,
/// ahead of the rest). Another animation is never emptied: its first frame stays. Returns the frames' new numbers.
export function moveFramesTo(doc: SpriteDoc, indices: number[], target: number): { doc: SpriteDoc; picked: number[] } {
  if (!doc.tags[target]) return { doc, picked: indices };
  const chosen = new Set(indices.filter((i) => i >= 0 && i < doc.frames.length));
  const moving: number[] = [];
  const blocks = blocksOf(doc).map((b, i) => {
    if (i === target) return { tag: b.tag, frames: [...b.frames] };
    const keep = b.frames.filter((f) => !chosen.has(f));
    const out = keep.length ? keep : [b.frames[0]!];
    for (const f of b.frames) if (chosen.has(f) && !(keep.length === 0 && f === b.frames[0])) moving.push(f);
    return { tag: b.tag, frames: out };
  });
  if (!moving.length) return { doc, picked: indices };
  blocks[target]!.frames.push(...moving.sort((a, b) => a - b));
  const next = assemble(doc, blocks);
  const end = next.tags[target]!.to;
  return { doc: next, picked: moving.map((_, k) => end - moving.length + 1 + k) };
}

/// Moves several frames (all in one animation) to where `target` is in that animation, keeping their order: after it when they
/// move later, before it when they move earlier, as `moveFrame` does for one. Returns the frames' new numbers.
export function moveFramesWithin(doc: SpriteDoc, indices: number[], target: number): { doc: SpriteDoc; picked: number[] } {
  const owner = animationOf(doc, target);
  const chosen = [...new Set(indices)].sort((a, b) => a - b);
  if (owner < 0 || !chosen.length || chosen.some((f) => animationOf(doc, f) !== owner) || chosen.includes(target) && chosen.length === 1) return { doc, picked: indices };
  const tag = doc.tags[owner]!;
  const rest = range(tag.from, tag.to).filter((f) => !chosen.includes(f));
  const later = target > chosen[0]!;
  const at = rest.filter((f) => (later ? f <= target : f < target)).length;
  const frames = [...rest.slice(0, at), ...chosen, ...rest.slice(at)];
  if (frames.every((f, i) => f === tag.from + i)) return { doc, picked: indices };
  const blocks = blocksOf(doc).map((b, i) => (i === owner ? { tag: b.tag, frames } : b));
  return { doc: assemble(doc, blocks), picked: chosen.map((_, k) => tag.from + at + k) };
}

/// Multiplies the duration of the chosen frames (at least 10 ms each after).
export function scaleDurations(doc: SpriteDoc, indices: number[], factor: number): SpriteDoc {
  if (!Number.isFinite(factor) || factor <= 0) return doc;
  const next = cloneDoc(doc);
  let changed = false;
  for (const i of new Set(indices)) {
    if (i < 0 || i >= next.durations.length) continue;
    const ms = Math.max(10, Math.round(next.durations[i]! * factor));
    if (ms !== next.durations[i]) changed = true;
    next.durations[i] = ms;
  }
  return changed ? next : doc;
}

/// A new animation of one blank frame, after the others.
export function addAnimation(doc: SpriteDoc, name = "animation"): { doc: SpriteDoc; index: number } {
  if (doc.frames.length >= MAX_FRAMES) return { doc, index: doc.tags.length - 1 };
  const next = cloneDoc(doc);
  const at = next.frames.length;
  next.frames.push(newRaster(next.fw, next.fh));
  for (const l of next.layers) {
    l.cels.push(newRaster(next.fw, next.fh));
    l.links?.push(0);
  }
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

// ---- linked cels -------------------------------------------------------------------------------------------

/// The frames whose cel on `layer` is linked to the one at `frame` (including `frame` itself); just `frame` when it is not linked.
export function linkedFrames(layer: Layer, frame: number): number[] {
  const group = layer.links?.[frame] ?? 0;
  if (!group) return [frame];
  return layer.links!.map((g, i) => (g === group ? i : -1)).filter((i) => i >= 0);
}

/// Links the cels of `frames` on one layer: they all take the picture of the first, and from then on drawing on one draws on all.
/// A frame that was linked to others leaves its old group.
export function linkCels(doc: SpriteDoc, layerIndex: number, frames: number[]): SpriteDoc {
  const chosen = [...new Set(frames)].filter((f) => f >= 0 && f < doc.frames.length).sort((a, b) => a - b);
  if (chosen.length < 2 || !doc.layers[layerIndex]) return doc;
  const next = cloneDoc(doc);
  const layer = next.layers[layerIndex]!;
  layer.links ??= layer.cels.map(() => 0);
  const group = Math.max(0, ...layer.links) + 1;
  for (const f of chosen) {
    layer.links[f] = group;
    if (f !== chosen[0]) layer.cels[f]!.data.set(layer.cels[chosen[0]!]!.data);
  }
  for (const f of chosen) recompose(next, f);
  return next;
}

/// Takes cels out of their link groups; they keep the picture they have.
export function unlinkCels(doc: SpriteDoc, layerIndex: number, frames: number[]): SpriteDoc {
  const layer = doc.layers[layerIndex];
  if (!layer?.links || !frames.some((f) => (layer.links![f] ?? 0) > 0)) return doc;
  const next = cloneDoc(doc);
  for (const f of frames) if (next.layers[layerIndex]!.links![f] !== undefined) next.layers[layerIndex]!.links![f] = 0;
  return next;
}

/// After drawing on the cel at `frame`, gives its picture to the cels it is linked to and refreshes their frames, in place.
/// Returns the frames that changed.
export function syncLinked(doc: SpriteDoc, layerIndex: number, frame: number): number[] {
  const layer = doc.layers[layerIndex];
  if (!layer?.links || !(layer.links[frame] ?? 0)) return [];
  const others = linkedFrames(layer, frame).filter((f) => f !== frame);
  for (const f of others) {
    layer.cels[f]!.data.set(layer.cels[frame]!.data);
    recompose(doc, f);
  }
  return others;
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
  const linkArrays: number[][] = base.layers.map(() => []);
  const tags: Tag[] = [];
  blocks.forEach((b, i) => {
    const start = frames.length;
    for (const f of b.frames) {
      frames.push(cloneRaster(base.frames[f]!));
      durations.push(base.durations[f]!);
      base.layers.forEach((l, li) => {
        cels[li]!.push(cloneRaster(l.cels[f]!));
        linkArrays[li]!.push(l.links?.[f] ?? 0);
      });
    }
    for (const t of extra[i] ?? []) {
      const picture = fit(t);
      frames.push(picture);
      durations.push(ms);
      base.layers.forEach((_, li) => {
        cels[li]!.push(li === layer ? cloneRaster(picture) : newRaster(base.fw, base.fh));
        linkArrays[li]!.push(0);
      });
    }
    tags.push({ ...b.tag, from: start, to: frames.length - 1 });
  });
  const next: SpriteDoc = { ...cloneDoc(base), frames, durations, tags, layers: base.layers.map((l, li) => ({ ...l, cels: cels[li]!, ...(l.links ? { links: linkArrays[li]! } : {}) })) };
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
  hitbox?: Box;
  pivot?: Point2;
  nine_slice?: Partial<NineSlice>;
  frame_data?: { frame: number; hitbox?: Box; pivot?: Point2; events?: string[] }[];
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
  const doc: SpriteDoc = { fw, fh, frames, durations, tags, layers: [layerOf("Layer 1", frames.map(cloneRaster))] };
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const okBox = (b: unknown): b is Box => !!b && typeof b === "object" && num((b as Box).x) && num((b as Box).y) && num((b as Box).w) && num((b as Box).h);
  const okPoint = (p: unknown): p is Point2 => !!p && typeof p === "object" && num((p as Point2).x) && num((p as Point2).y);
  const def: SpriteDoc["defaults"] = {};
  if (okBox(json.hitbox)) def.hitbox = json.hitbox;
  if (okPoint(json.pivot)) def.pivot = json.pivot;
  if (Object.keys(def).length) doc.defaults = def;
  if (json.nine_slice && typeof json.nine_slice === "object") {
    const n = json.nine_slice;
    const c = (v: unknown) => (num(v) ? Math.max(0, Math.round(v as number)) : 0);
    const slice = { left: c(n.left), right: c(n.right), top: c(n.top), bottom: c(n.bottom) };
    if (slice.left + slice.right + slice.top + slice.bottom > 0) doc.nineSlice = slice;
  }
  if (Array.isArray(json.frame_data)) {
    const data: (FrameData | null)[] = frames.map(() => null);
    for (const e of json.frame_data) {
      if (!e || !Number.isInteger(e.frame) || e.frame < 0 || e.frame >= count) continue;
      const f: FrameData = {};
      if (okBox(e.hitbox)) f.hitbox = e.hitbox;
      if (okPoint(e.pivot)) f.pivot = e.pivot;
      if (Array.isArray(e.events)) {
        const list = cleanEvents(e.events.filter((x): x is string => typeof x === "string"));
        if (list.length) f.events = list;
      }
      if (Object.keys(f).length) data[e.frame] = f;
    }
    if (data.some(Boolean)) doc.data = data;
  }
  return normalizeAnimations(doc);
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
  const box = (b: Box) => `{ "x": ${b.x}, "y": ${b.y}, "w": ${b.w}, "h": ${b.h} }`;
  const pt = (p: Point2) => `{ "x": ${p.x}, "y": ${p.y} }`;
  if (doc.defaults?.hitbox) lines.push(`  "hitbox": ${box(doc.defaults.hitbox)}`);
  if (doc.defaults?.pivot) lines.push(`  "pivot": ${pt(doc.defaults.pivot)}`);
  if (doc.nineSlice) lines.push(`  "nine_slice": { "left": ${doc.nineSlice.left}, "right": ${doc.nineSlice.right}, "top": ${doc.nineSlice.top}, "bottom": ${doc.nineSlice.bottom} }`);
  const own = (doc.data ?? []).map((d, frame) => ({ d, frame })).filter((x) => x.d);
  if (own.length) {
    const rows = own.map(({ d, frame }) => {
      const parts = [`"frame": ${frame}`];
      if (d!.hitbox) parts.push(`"hitbox": ${box(d!.hitbox)}`);
      if (d!.pivot) parts.push(`"pivot": ${pt(d!.pivot)}`);
      if (d!.events?.length) parts.push(`"events": ${JSON.stringify(d!.events)}`);
      return `    { ${parts.join(", ")} }`;
    });
    lines.push(`  "frame_data": [\n${rows.join(",\n")}\n  ]`);
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
  // (an anchor of 0.5 puts the old picture half the growth in; the same shift carries the boxes and pivots)
  shiftBoxes(base, Math.floor((nw - doc.fw) * anchorX), Math.floor((nh - doc.fh) * anchorY));
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
  const fresh = layerOf(`Layer ${n}`, doc.frames.map(() => newRaster(doc.fw, doc.fh)));
  const depth = doc.layers[above]?.depth ?? 0;
  if (depth) fresh.depth = depth;
  next.layers.splice(index, 0, fresh);
  return { doc: recomposed(next), index };
}

export function duplicateLayer(doc: SpriteDoc, index: number): { doc: SpriteDoc; index: number } {
  const src = doc.layers[index];
  if (!src || src.kind === "group" || doc.layers.length >= MAX_LAYERS) return { doc, index };
  const next = cloneDoc(doc);
  next.layers.splice(index + 1, 0, { ...next.layers[index]!, name: `${src.name} copy` });
  return { doc: recomposed(next), index: index + 1 };
}

/// The layers inside a group (the ones just below its header that are deeper), as indices.
export function groupMembers(doc: SpriteDoc, group: number): number[] {
  const g = doc.layers[group];
  if (!g || g.kind !== "group") return [];
  const out: number[] = [];
  for (let k = group - 1; k >= 0 && (doc.layers[k]!.depth ?? 0) > (g.depth ?? 0); k--) out.unshift(k);
  return out;
}

/// Whether the groups are in order: every layer that is deeper than the top level has its group header after it (with only its own members between).
export function groupsAreValid(layers: Layer[]): boolean {
  const open = new Set<number>();
  for (const l of layers) {
    const d = l.depth ?? 0;
    if (d < 0 || !Number.isInteger(d)) return false;
    const isGroup = l.kind === "group";
    // everything deeper than this layer's children must already be closed by its own group
    for (const k of open) if (k > d + (isGroup ? 1 : 0)) return false;
    if (isGroup) open.delete(d + 1);
    if (d > 0) open.add(d);
  }
  return open.size === 0;
}

/// Removes a layer (never the last drawing layer). Removing a group removes the layers in it.
export function removeLayer(doc: SpriteDoc, index: number): SpriteDoc {
  const l = doc.layers[index];
  if (doc.layers.length <= 1 || !l) return doc;
  const gone = new Set([index, ...groupMembers(doc, index)]);
  if (doc.layers.every((x, i) => gone.has(i) || x.kind === "group")) return doc;
  const next = cloneDoc(doc);
  next.layers = next.layers.filter((_, i) => !gone.has(i));
  return recomposed(next);
}

/// Puts the layers from `from` to `to` (whole groups included) into a new group, shown above them. Returns the new group's index.
export function groupLayers(doc: SpriteDoc, from: number, to: number): { doc: SpriteDoc; index: number } {
  const a = Math.min(from, to);
  const b = Math.max(from, to);
  if (!doc.layers[a] || !doc.layers[b] || doc.layers.length >= MAX_LAYERS) return { doc, index: b };
  const top = Math.min(...doc.layers.slice(a, b + 1).map((l) => l.depth ?? 0));
  const next = cloneDoc(doc);
  for (let k = a; k <= b; k++) next.layers[k]!.depth = (next.layers[k]!.depth ?? 0) + 1;
  let n = 1;
  const used = new Set(next.layers.map((l) => l.name));
  while (used.has(`Group ${n}`)) n++;
  const group: Layer = { ...layerOf(`Group ${n}`, doc.frames.map(() => newRaster(doc.fw, doc.fh))), kind: "group", locked: true };
  if (top) group.depth = top;
  next.layers.splice(b + 1, 0, group);
  if (!groupsAreValid(next.layers)) return { doc, index: b };
  return { doc: recomposed(next), index: b + 1 };
}

/// Takes a group apart: its layers stay, one level shallower, and the group goes.
export function ungroup(doc: SpriteDoc, index: number): SpriteDoc {
  const members = groupMembers(doc, index);
  if (doc.layers[index]?.kind !== "group") return doc;
  const next = cloneDoc(doc);
  for (const k of members) {
    const l = next.layers[k]!;
    if ((l.depth ?? 0) <= 1) delete l.depth;
    else l.depth = l.depth! - 1;
  }
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
  // a move that would take a layer out of its group, or a group away from its layers, is refused
  if (!groupsAreValid(next.layers) || layer!.kind === "group") return { doc, index };
  return { doc: recomposed(next), index: to };
}

export function updateLayer(doc: SpriteDoc, index: number, change: Partial<Pick<Layer, "name" | "visible" | "opacity" | "blend" | "locked" | "clip" | "effects">>): SpriteDoc {
  if (!doc.layers[index]) return doc;
  const next = cloneDoc(doc);
  const l = next.layers[index]!;
  if (l.kind === "group") {
    // (a group is always locked and does not clip)
    change = { ...change };
    delete change.locked;
    delete change.clip;
  }
  if (change.effects !== undefined) {
    if (change.effects.length) l.effects = change.effects;
    else delete l.effects;
  }
  if (change.name !== undefined && change.name.trim()) l.name = change.name.trim();
  if (change.visible !== undefined) l.visible = change.visible;
  if (change.opacity !== undefined) l.opacity = clampOpacity(change.opacity);
  if (change.locked !== undefined) {
    if (change.locked) l.locked = true;
    else delete l.locked;
  }
  if (change.clip !== undefined) {
    if (change.clip && index > 0) l.clip = true;
    else delete l.clip;
  }
  if (change.blend !== undefined && BLEND_MODES.includes(change.blend)) {
    if (change.blend === "normal") delete l.blend;
    else l.blend = change.blend;
  }
  return recomposed(next);
}

/// Paints a layer onto the one below it (using its opacity) and removes it. Returns the index of the merged layer.
export function mergeDown(doc: SpriteDoc, index: number): { doc: SpriteDoc; index: number } {
  if (index <= 0 || !doc.layers[index]) return { doc, index };
  const upper = doc.layers[index]!;
  const lower = doc.layers[index - 1]!;
  if (upper.kind === "group" || lower.kind === "group" || (upper.depth ?? 0) !== (lower.depth ?? 0)) return { doc, index };
  const next = cloneDoc(doc);
  const top = next.layers[index]!;
  const below = next.layers[index - 1]!;
  // (the upper layer's effects are part of what it shows)
  top.cels = top.cels.map((c) => applyLayerEffects(c, top.effects));
  below.cels = below.cels.map((c, f) => composite(c, top.cels[f]!, top.visible ? top.opacity : 0, top.blend));
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
  layers: { name: string; visible: boolean; opacity: number; blend?: BlendMode; locked?: boolean; clip?: boolean; effects?: LayerEffect[]; group?: boolean; depth?: number; image: string; /** link groups of the cels, when any are linked */ links?: number[] }[];
}

/// Each layer as a sheet laid out like the exported one.
export function layerSheets(doc: SpriteDoc): Raster[] {
  return doc.layers.map((l) => toSheet({ ...doc, frames: l.cels }));
}

export function layersFileText(doc: SpriteDoc, images: string[]): string {
  const file: LayersFile = {
    version: 1, sheet: hashRaster(toSheet(doc)), frames: doc.frames.length, columns: sheetColumns(doc.frames.length),
    layers: doc.layers.map((l, i) => ({ name: l.name, visible: l.visible, opacity: l.opacity, ...(l.blend ? { blend: l.blend } : {}), ...(l.locked ? { locked: true } : {}), ...(l.clip ? { clip: true } : {}), ...(l.effects?.length ? { effects: l.effects } : {}), ...(l.kind === "group" ? { group: true } : {}), ...(l.depth ? { depth: l.depth } : {}), image: images[i]!, ...(l.links?.some((n) => n > 0) ? { links: l.links } : {}) })),
  };
  return `${JSON.stringify(file, null, 1)}\n`;
}

export function parseLayersFile(text: string): LayersFile | null {
  try {
    const f = JSON.parse(text) as LayersFile;
    const good = f && f.version === 1 && typeof f.sheet === "string" && Number.isInteger(f.frames) && Number.isInteger(f.columns) && Array.isArray(f.layers) && f.layers.length > 0 && f.layers.length <= MAX_LAYERS
      && f.layers.every((l) => typeof l.name === "string" && typeof l.visible === "boolean" && typeof l.opacity === "number" && typeof l.image === "string" && (l.blend === undefined || BLEND_MODES.includes(l.blend)) && (l.locked === undefined || typeof l.locked === "boolean") && (l.clip === undefined || typeof l.clip === "boolean") && (l.effects === undefined || cleanLayerEffects(l.effects) !== null) && (l.group === undefined || typeof l.group === "boolean") && (l.depth === undefined || (Number.isInteger(l.depth) && l.depth > 0 && l.depth < 8))
        && (l.links === undefined || (Array.isArray(l.links) && l.links.length === f.frames && l.links.every((n) => Number.isInteger(n) && n >= 0))));
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
    name: l.name, visible: l.visible, opacity: clampOpacity(l.opacity), ...(l.blend && l.blend !== "normal" ? { blend: l.blend } : {}), ...(l.locked ? { locked: true } : {}), ...(l.clip ? { clip: true } : {}),
    ...(l.effects?.length ? { effects: cleanLayerEffects(l.effects)! } : {}), ...(l.group ? { kind: "group" as const, locked: true } : {}), ...(l.depth ? { depth: l.depth } : {}),
    cels: cutFrames(sheets[i]!, doc.fw, doc.fh, doc.frames.length, columns),
    ...(l.links?.some((n) => n > 0) ? { links: [...l.links] } : {}),
  }));
  if (!groupsAreValid(next.layers)) return null;
  recomposed(next);
  return hashRaster(toSheet(next)) === file.sheet && hashRaster(toSheet(next)) === hashRaster(toSheet(doc)) ? next : null;
}
