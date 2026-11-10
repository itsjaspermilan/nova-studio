// Reads an Aseprite file (.aseprite or .ase) into a sprite document: layers with their blend mode, opacity and visibility, a picture for every layer and
// frame (linked cels followed), the frames' durations, and the tags as animations. RGBA, grey and indexed colour modes. Group layers are read as
// ordinary layers (their members are kept, the group itself is dropped), and tilemap layers and slices are left out, with a note.

import { inflate } from "./inflate";
import { newRaster, type BlendMode, type Raster } from "./pixels";
import { MAX_FRAMES, MAX_LAYERS, MAX_SIDE, normalizeAnimations, recompose, type Direction, type Layer, type SpriteDoc, type Tag } from "./sprite-doc";

export interface AsepriteImport {
  doc: SpriteDoc;
  /// Things left out or changed, in plain words.
  warnings: string[];
}

class Reader {
  at: number;
  readonly v: DataView;
  constructor(public b: Uint8Array, at = 0) {
    this.at = at;
    this.v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  u8() { return this.b[this.at++]!; }
  u16() { const x = this.v.getUint16(this.at, true); this.at += 2; return x; }
  i16() { const x = this.v.getInt16(this.at, true); this.at += 2; return x; }
  u32() { const x = this.v.getUint32(this.at, true); this.at += 4; return x; }
  skip(n: number) { this.at += n; }
  str() { const n = this.u16(); const s = new TextDecoder().decode(this.b.subarray(this.at, this.at + n)); this.at += n; return s; }
}

const BLEND: Record<number, BlendMode> = { 0: "normal", 1: "multiply", 2: "screen", 3: "overlay", 4: "darken", 5: "lighten", 16: "add" };
const DIRECTION: Record<number, Direction> = { 0: "forward", 1: "reverse", 2: "pingpong", 3: "pingpong" };

interface RawLayer { name: string; visible: boolean; opacity: number; blend: BlendMode; type: number; level: number }
interface RawCel { layer: number; x: number; y: number; opacity: number; picture: Raster | null; linkTo: number | null }

export async function readAseprite(bytes: Uint8Array): Promise<AsepriteImport> {
  if (bytes.length < 128) throw new Error("This file is too short to be an Aseprite file.");
  const r = new Reader(bytes);
  r.skip(4); // file size
  if (r.u16() !== 0xa5e0) throw new Error("This is not an Aseprite file (it does not start with the Aseprite signature).");
  const frameCount = r.u16();
  const width = r.u16();
  const height = r.u16();
  const depth = r.u16();
  r.skip(4); // flags
  r.skip(2 + 4 + 4); // speed, reserved
  const transparentIndex = r.u8();
  if (![8, 16, 32].includes(depth)) throw new Error(`This file uses ${depth} bits a pixel, which Aseprite does not use.`);
  if (!width || !height || width > MAX_SIDE || height > MAX_SIDE) throw new Error(`A picture of ${width} by ${height} cannot be opened (up to ${MAX_SIDE}).`);
  const warnings: string[] = [];
  r.at = 128;
  const layers: RawLayer[] = [];
  const cels: Map<number, RawCel>[] = []; // per frame: layer index to cel
  const durations: number[] = [];
  const tags: Tag[] = [];
  let palette: Uint8Array = new Uint8Array(256 * 4);
  let skippedTilemaps = 0;
  let sawSlices = false;
  for (let f = 0; f < Math.min(frameCount, MAX_FRAMES); f++) {
    const start = r.at;
    const size = r.u32();
    if (r.u16() !== 0xf1fa) throw new Error(`Frame ${f + 1} of the file is damaged.`);
    const oldChunks = r.u16();
    durations.push(r.u16() || 100);
    r.skip(2);
    const newChunks = r.u32();
    const count = newChunks || oldChunks;
    const map = new Map<number, RawCel>();
    cels.push(map);
    for (let c = 0; c < count; c++) {
      const cStart = r.at;
      const cSize = r.u32();
      const type = r.u16();
      const bodyEnd = cStart + cSize;
      if (type === 0x2004) {
        const flags = r.u16();
        const lt = r.u16();
        const level = r.u16();
        r.skip(4);
        const blend = r.u16();
        const opacity = r.u8();
        r.skip(3);
        layers.push({ name: r.str(), visible: !!(flags & 1), opacity: opacity / 255, blend: BLEND[blend] ?? "normal", type: lt, level });
        if (!(blend in BLEND)) warnings.push(`Layer "${layers.at(-1)!.name}" uses a blend mode this studio does not have; it is normal here.`);
      } else if (type === 0x2005) {
        const layer = r.u16();
        const x = r.i16(), y = r.i16();
        const opacity = r.u8();
        const celType = r.u16();
        r.skip(2 + 5);
        if (celType === 1) map.set(layer, { layer, x, y, opacity: opacity / 255, picture: null, linkTo: r.u16() });
        else if (celType === 0 || celType === 2) {
          const w = r.u16(), h = r.u16();
          const data = celType === 2 ? await inflate(bytes.subarray(r.at, bodyEnd)) : bytes.subarray(r.at, r.at + w * h * (depth / 8));
          map.set(layer, { layer, x, y, opacity: opacity / 255, picture: pixelsOf(data, w, h, depth, palette, transparentIndex), linkTo: null });
        } else skippedTilemaps++;
      } else if (type === 0x2018) {
        const n = r.u16();
        r.skip(8);
        for (let i = 0; i < n; i++) {
          const from = r.u16(), to = r.u16(), dir = r.u8();
          r.skip(2 + 6 + 3 + 1);
          tags.push({ name: r.str(), from, to, direction: DIRECTION[dir] ?? "forward", loop: true });
        }
      } else if (type === 0x2019) {
        const total = r.u32();
        const first = r.u32(), last = r.u32();
        r.skip(8);
        if (total > palette.length / 4) { const bigger = new Uint8Array(total * 4); bigger.set(palette); palette = bigger; }
        for (let i = first; i <= last && r.at < bodyEnd; i++) {
          const flags = r.u16();
          for (let k = 0; k < 4; k++) palette[i * 4 + k] = r.u8();
          if (flags & 1) r.str();
        }
      } else if (type === 0x2022) sawSlices = true;
      r.at = bodyEnd;
    }
    r.at = start + size;
  }
  if (frameCount > MAX_FRAMES) warnings.push(`The file has ${frameCount} frames; only the first ${MAX_FRAMES} are kept.`);
  if (skippedTilemaps) warnings.push("Tilemap layers are not imported (their cels are left out).");
  if (sawSlices) warnings.push("Slices (9-slice and hitbox areas) are not imported yet.");
  // only real picture layers become layers: groups and tilemaps are dropped, and a layer inside a hidden group is hidden
  const keep: number[] = [];
  const hiddenByGroup = new Set<number>();
  const stack: { level: number; visible: boolean }[] = [];
  layers.forEach((l, i) => {
    while (stack.length && stack[stack.length - 1]!.level >= l.level) stack.pop();
    const inHidden = stack.some((g) => !g.visible);
    if (l.type === 1) stack.push({ level: l.level, visible: l.visible });
    else if (l.type === 0) {
      keep.push(i);
      if (inHidden) hiddenByGroup.add(i);
    }
  });
  if (layers.some((l) => l.type === 1)) warnings.push("Layer groups were flattened into their layers (a hidden group hides its layers).");
  if (keep.length > MAX_LAYERS) warnings.push(`The file has ${keep.length} layers; only the first ${MAX_LAYERS} are kept.`);
  const frames = cels.length;
  const doc: SpriteDoc = { fw: width, fh: height, frames: [], durations, tags: [], layers: [] };
  for (const li of keep.slice(0, MAX_LAYERS)) {
    const raw = layers[li]!;
    const layer: Layer = { name: raw.name, visible: raw.visible && !hiddenByGroup.has(li), opacity: raw.opacity, cels: [] };
    if (raw.blend !== "normal") layer.blend = raw.blend;
    for (let f = 0; f < frames; f++) {
      let cel = cels[f]!.get(li);
      if (cel && cel.picture === null && cel.linkTo !== null) cel = cels[cel.linkTo]?.get(li);
      const out = newRaster(width, height);
      if (cel?.picture) placeCel(out, cel);
      layer.cels.push(out);
    }
    doc.layers.push(layer);
  }
  if (!doc.layers.length) throw new Error("There are no picture layers in this file.");
  for (let f = 0; f < frames; f++) doc.frames.push(newRaster(width, height));
  doc.tags = tags.filter((t) => t.from >= 0 && t.to >= t.from && t.to < frames);
  if (!doc.tags.length) doc.tags = [{ name: "idle", from: 0, to: frames - 1, direction: "forward", loop: true }];
  let out = doc;
  for (let f = 0; f < frames; f++) recompose(out, f);
  if (tags.length > 1) {
    const before = out.frames.length;
    out = normalizeAnimations(out);
    if (out.frames.length !== before) warnings.push("Animations that overlapped were copied apart so that each has its own frames.");
  }
  return { doc: out, warnings };
}

function placeCel(into: Raster, cel: RawCel) {
  const p = cel.picture!;
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      const tx = cel.x + x, ty = cel.y + y;
      if (tx < 0 || ty < 0 || tx >= into.w || ty >= into.h) continue;
      const s = (y * p.w + x) * 4, d = (ty * into.w + tx) * 4;
      for (let c = 0; c < 3; c++) into.data[d + c] = p.data[s + c]!;
      into.data[d + 3] = Math.round(p.data[s + 3]! * cel.opacity);
    }
  }
}

function pixelsOf(data: Uint8Array, w: number, h: number, depth: number, palette: Uint8Array, transparentIndex: number): Raster {
  const r = newRaster(w, h);
  const need = w * h * (depth / 8);
  if (data.length < need) throw new Error("A picture in the file is cut short.");
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (depth === 32) {
      for (let c = 0; c < 4; c++) r.data[o + c] = data[i * 4 + c]!;
    } else if (depth === 16) {
      r.data[o] = r.data[o + 1] = r.data[o + 2] = data[i * 2]!;
      r.data[o + 3] = data[i * 2 + 1]!;
    } else {
      const idx = data[i]!;
      if (idx === transparentIndex) continue;
      for (let c = 0; c < 4; c++) r.data[o + c] = palette[idx * 4 + c]!;
    }
  }
  return r;
}
