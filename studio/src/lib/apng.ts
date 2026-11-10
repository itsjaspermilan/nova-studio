// Animated PNG: the PNG with an animation control chunk and one frame-control chunk per frame (the first frame's pixels are the ordinary image,
// so a viewer that does not know APNG still shows it). Uncompressed like the rest of the studio's PNG writer.

import { ihdrFor, joinBytes, pngChunk, PNG_SIGNATURE, scanlines, zlibStored } from "./png-encode";
import type { Raster } from "./pixels";

export interface ApngFrame {
  picture: Raster;
  /// How long it shows, in milliseconds.
  ms: number;
}

/// `loops` 0 repeats for ever. Frames must all be the same size.
export function encodeApng(frames: ApngFrame[], loops = 0): Uint8Array {
  if (frames.length === 0) throw new Error("An animated PNG needs at least one frame.");
  const { w, h } = frames[0]!.picture;
  if (frames.some((f) => f.picture.w !== w || f.picture.h !== h)) throw new Error("All frames must be the same size.");
  const parts: Uint8Array[] = [PNG_SIGNATURE, pngChunk("IHDR", ihdrFor(w, h))];
  const actl = new Uint8Array(8);
  new DataView(actl.buffer).setUint32(0, frames.length);
  new DataView(actl.buffer).setUint32(4, loops);
  parts.push(pngChunk("acTL", actl));
  let seq = 0;
  frames.forEach((f, i) => {
    const fctl = new Uint8Array(26);
    const v = new DataView(fctl.buffer);
    v.setUint32(0, seq++);
    v.setUint32(4, w);
    v.setUint32(8, h);
    // x and y offsets stay 0
    v.setUint16(20, Math.max(1, Math.min(65535, Math.round(f.ms))));
    v.setUint16(22, 1000); // delay is ms / 1000 seconds
    fctl[24] = 0; // dispose: none
    fctl[25] = 0; // blend: source (replace)
    parts.push(pngChunk("fcTL", fctl));
    const z = zlibStored(scanlines(f.picture));
    if (i === 0) parts.push(pngChunk("IDAT", z));
    else {
      const body = new Uint8Array(4 + z.length);
      new DataView(body.buffer).setUint32(0, seq++);
      body.set(z, 4);
      parts.push(pngChunk("fdAT", body));
    }
  });
  parts.push(pngChunk("IEND", new Uint8Array(0)));
  return joinBytes(parts);
}
