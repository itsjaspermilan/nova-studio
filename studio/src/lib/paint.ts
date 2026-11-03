// Painting with opacity and a locked alpha channel. A stroke is drawn into a mask (any pixel with alpha is touched); each
// touched pixel is then worked out once from the picture as it was when the stroke began, so going over a spot twice in
// one stroke does not build it up: it is as strong as the opacity says.

import type { Raster, Rgba } from "./pixels";

export interface Brush {
  colour: Rgba;
  /// 0 to 1.
  opacity: number;
  erase: boolean;
  /// Leave transparent pixels alone and keep every pixel's alpha.
  lockAlpha: boolean;
}

/// Applies `brush` to the pixels `mask` touches that `done` has not yet marked, reading from `base` and writing to `picture`.
/// Returns the box of pixels changed (or null if none).
export function applyBrush(picture: Raster, base: Raster, mask: Raster, done: Uint8Array, brush: Brush): { x: number; y: number; w: number; h: number } | null {
  const a = Math.min(1, Math.max(0, brush.opacity));
  let [x0, y0, x1, y1] = [picture.w, picture.h, -1, -1];
  for (let i = 0; i < picture.w * picture.h; i++) {
    if (mask.data[i * 4 + 3] === 0 || done[i]) continue;
    done[i] = 1;
    const o = i * 4;
    const [br, bg, bb, ba] = [base.data[o]!, base.data[o + 1]!, base.data[o + 2]!, base.data[o + 3]! / 255];
    if (brush.lockAlpha && ba === 0) continue;
    if (brush.erase) {
      if (brush.lockAlpha) continue; // erasing is changing alpha
      picture.data[o + 3] = Math.round(ba * (1 - a) * 255);
    } else if (brush.lockAlpha) {
      for (let c = 0; c < 3; c++) picture.data[o + c] = Math.round(base.data[o + c]! * (1 - a) + brush.colour[c]! * a);
      picture.data[o + 3] = base.data[o + 3]!;
    } else {
      const outA = a + ba * (1 - a);
      for (let c = 0; c < 3; c++) picture.data[o + c] = outA === 0 ? 0 : Math.round((brush.colour[c]! * a + [br, bg, bb][c]! * ba * (1 - a)) / outA);
      picture.data[o + 3] = Math.round(outA * 255);
    }
    const [x, y] = [i % picture.w, Math.floor(i / picture.w)];
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
