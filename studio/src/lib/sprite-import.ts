// Opening other programs' animation files as a sprite: an animated GIF, an animated or plain PNG, and an Aseprite file. Picks the reader by the file's
// first bytes (not its name), and makes one sprite document with a layer, the frames and their times.

import { readApng } from "./apng-read";
import { readAseprite } from "./aseprite-read";
import { readGif } from "./gif-read";
import { newDoc, recompose, MAX_FRAMES, MAX_SIDE, type SpriteDoc } from "./sprite-doc";
import type { Raster } from "./pixels";

export interface Imported {
  doc: SpriteDoc;
  what: string;
  warnings: string[];
}

/// A sprite from a list of equally sized pictures and how long each shows (one layer, one animation).
export function docFromFrames(frames: { raster: Raster; ms: number }[]): { doc: SpriteDoc; truncated: number } {
  const kept = frames.slice(0, MAX_FRAMES);
  const first = kept[0]!.raster;
  const doc = newDoc(first.w, first.h, kept.length);
  kept.forEach((f, i) => {
    doc.layers[0]!.cels[i] = { w: f.raster.w, h: f.raster.h, data: new Uint8ClampedArray(f.raster.data) };
    doc.durations[i] = Math.max(10, Math.round(f.ms));
  });
  for (let i = 0; i < kept.length; i++) recompose(doc, i);
  return { doc, truncated: frames.length - kept.length };
}

const startsWith = (b: Uint8Array, bytes: number[]) => bytes.every((x, i) => b[i] === x);

export async function importAnimation(bytes: Uint8Array): Promise<Imported> {
  if (bytes.length < 8) throw new Error("This file is too short to be a picture.");
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) {
    const g = readGif(bytes);
    if (g.width > MAX_SIDE || g.height > MAX_SIDE) throw new Error(`A picture of ${g.width} by ${g.height} is too big (up to ${MAX_SIDE}).`);
    const { doc, truncated } = docFromFrames(g.frames);
    return { doc, what: `an animated GIF of ${g.frames.length} frame${g.frames.length === 1 ? "" : "s"}`, warnings: truncated ? [`${truncated} more frames did not fit (up to ${MAX_FRAMES}).`] : [] };
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) {
    const p = await readApng(bytes);
    const { doc, truncated } = docFromFrames(p.frames);
    return { doc, what: p.animated ? `an animated PNG of ${p.frames.length} frames` : "a PNG", warnings: truncated ? [`${truncated} more frames did not fit (up to ${MAX_FRAMES}).`] : [] };
  }
  if (bytes[4] === 0xe0 && bytes[5] === 0xa5) {
    const a = await readAseprite(bytes);
    return { doc: a.doc, what: `an Aseprite file with ${a.doc.layers.length} layer${a.doc.layers.length === 1 ? "" : "s"} and ${a.doc.frames.length} frame${a.doc.frames.length === 1 ? "" : "s"}`, warnings: a.warnings };
  }
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) throw new Error("This looks like a zip file (a Pixelorama .pxo project?). Pixelorama's own format cannot be read yet: in Pixelorama use File > Export to save a PNG sheet, a GIF or an animated PNG, and open that here.");
  throw new Error("This is not a GIF, PNG or Aseprite file.");
}
