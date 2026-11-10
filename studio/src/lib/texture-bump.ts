// Bumps painted as a height picture become a tangent-space normal map, the picture the game lights the surface with (glTF's `normalTexture`).

import { newRaster, type Raster } from "./pixels";

/// A normal map from the red channel of `height` (0 low, 255 high): each texel's slope against its four neighbours, clamped at the picture's edge, tilts the normal.
/// `strength` is how steep a full-range step is (1 is a gentle bump, 4 a deep one). Following glTF: red is +x to the right, green is +y up the picture (rows run
/// down), blue is out of the surface; a flat picture gives (128, 128, 255). Alpha is opaque.
export function heightToNormal(height: Raster, strength: number): Raster {
  const out = newRaster(height.w, height.h);
  const k = Math.max(0, strength);
  const at = (x: number, y: number) => height.data[(Math.min(height.h - 1, Math.max(0, y)) * height.w + Math.min(height.w - 1, Math.max(0, x))) * 4]! / 255;
  for (let y = 0; y < height.h; y++) {
    for (let x = 0; x < height.w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 0.5 * k * 8;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 0.5 * k * 8;
      // the surface rises with the height: the normal leans away from the rise (x to the left when it rises to the right; up the picture when it rises down it)
      const nx = -dx, ny = dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const i = (y * height.w + x) * 4;
      out.data[i] = Math.round((nx / l * 0.5 + 0.5) * 255);
      out.data[i + 1] = Math.round((ny / l * 0.5 + 0.5) * 255);
      out.data[i + 2] = Math.round((nz / l * 0.5 + 0.5) * 255);
      out.data[i + 3] = 255;
    }
  }
  return out;
}
