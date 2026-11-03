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

/// One pixel from how it was at the start of a stroke: painted over with `colour` at strength `a` (0 to 1), erased by `a`, or
/// recoloured with its alpha kept when `lockAlpha` is on. Returns false when the pixel was left alone.
function blend(picture: Raster, base: Raster, o: number, colour: readonly number[], a: number, erase: boolean, lockAlpha: boolean): boolean {
  const ba = base.data[o + 3]! / 255;
  if (lockAlpha && ba === 0) return false;
  if (erase) {
    if (lockAlpha) return false; // erasing is changing alpha
    picture.data[o + 3] = Math.round(ba * (1 - a) * 255);
  } else if (lockAlpha) {
    for (let c = 0; c < 3; c++) picture.data[o + c] = Math.round(base.data[o + c]! * (1 - a) + colour[c]! * a);
    picture.data[o + 3] = base.data[o + 3]!;
  } else {
    const outA = a + ba * (1 - a);
    for (let c = 0; c < 3; c++) picture.data[o + c] = outA === 0 ? 0 : Math.round((colour[c]! * a + base.data[o + c]! * ba * (1 - a)) / outA);
    picture.data[o + 3] = Math.round(outA * 255);
  }
  return true;
}

/// Applies `brush` to the pixels `mask` touches that `done` has not yet marked, reading from `base` and writing to `picture`.
/// Returns the box of pixels changed (or null if none).
export function applyBrush(picture: Raster, base: Raster, mask: Raster, done: Uint8Array, brush: Brush): { x: number; y: number; w: number; h: number } | null {
  const a = Math.min(1, Math.max(0, brush.opacity));
  let [x0, y0, x1, y1] = [picture.w, picture.h, -1, -1];
  for (let i = 0; i < picture.w * picture.h; i++) {
    if (mask.data[i * 4 + 3] === 0 || done[i]) continue;
    done[i] = 1;
    if (!blend(picture, base, i * 4, brush.colour, a, brush.erase, brush.lockAlpha)) continue;
    const [x, y] = [i % picture.w, Math.floor(i / picture.w)];
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/// Fills the box `from` to `to` (corners, either order) with a straight gradient from colour `a` to colour `b` along its longer side,
/// over the picture as it was in `base`, with the brush's opacity and alpha lock.
export function applyGradient(picture: Raster, base: Raster, from: { x: number; y: number }, to: { x: number; y: number }, a: Rgba, b: Rgba, opacity: number, lockAlpha: boolean) {
  const [x0, x1] = [Math.max(0, Math.min(from.x, to.x)), Math.min(picture.w - 1, Math.max(from.x, to.x))];
  const [y0, y1] = [Math.max(0, Math.min(from.y, to.y)), Math.min(picture.h - 1, Math.max(from.y, to.y))];
  const across = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y);
  const strength = Math.min(1, Math.max(0, opacity));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    // the end the drag started at gets colour a
    const span = across ? Math.abs(to.x - from.x) : Math.abs(to.y - from.y);
    const along = across ? Math.abs(x - from.x) : Math.abs(y - from.y);
    const t = span === 0 ? 0 : Math.min(1, along / span);
    const colour = [0, 1, 2].map((c) => Math.round(a[c]! + (b[c]! - a[c]!) * t));
    blend(picture, base, (y * picture.w + x) * 4, colour, strength * (a[3]! / 255), false, lockAlpha);
  }
}
