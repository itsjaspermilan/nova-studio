// Turning and resizing pieces of pixel art: scale by whole steps or to any size (nearest pixel, so edges stay hard), and rotate by any angle, either plainly (nearest pixel) or the
// RotSprite way, which keeps the lines clean (the picture is enlarged eight times with Scale2x, turned, and brought back down taking the most common colour of each block).
// RotSprite is Xenowhirlpool's algorithm; this is a fresh implementation of the published method.

import { getPixel, newRaster, setPixel, type Raster, type Rgba } from "./pixels";

const same = (a: Rgba, b: Rgba) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];

/// The picture scaled to w by h pixels, each new pixel the nearest old one.
export function scaleTo(r: Raster, w: number, h: number): Raster {
  const nw = Math.max(1, Math.round(w));
  const nh = Math.max(1, Math.round(h));
  const out = newRaster(nw, nh);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) setPixel(out, x, y, getPixel(r, Math.min(r.w - 1, Math.floor(((x + 0.5) * r.w) / nw)), Math.min(r.h - 1, Math.floor(((y + 0.5) * r.h) / nh)))!);
  return out;
}

/// Scale2x (Andrea Mazzoleni's AdvMAME2x): each pixel becomes four, and diagonal edges are smoothed without making new colours.
export function scale2x(r: Raster): Raster {
  const out = newRaster(r.w * 2, r.h * 2);
  const at = (x: number, y: number): Rgba => getPixel(r, Math.min(r.w - 1, Math.max(0, x)), Math.min(r.h - 1, Math.max(0, y)))!;
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const p = at(x, y), a = at(x, y - 1), b = at(x + 1, y), c = at(x - 1, y), d = at(x, y + 1);
      const diff = !same(c, b) && !same(a, d);
      setPixel(out, 2 * x, 2 * y, diff && same(a, c) ? a : p);
      setPixel(out, 2 * x + 1, 2 * y, diff && same(a, b) ? b : p);
      setPixel(out, 2 * x, 2 * y + 1, diff && same(d, c) ? c : p);
      setPixel(out, 2 * x + 1, 2 * y + 1, diff && same(d, b) ? b : p);
    }
  }
  return out;
}

/// The picture turned by an angle (degrees, clockwise) about its middle, into a picture just big enough to hold it; each new pixel is the nearest old one.
export function rotateNearest(r: Raster, degrees: number): Raster {
  const t = (degrees * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const w = Math.max(1, Math.ceil(Math.abs(r.w * cos) + Math.abs(r.h * sin) - 1e-9));
  const h = Math.max(1, Math.ceil(Math.abs(r.w * sin) + Math.abs(r.h * cos) - 1e-9));
  const out = newRaster(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // back to the source: turn the other way about the middle
      const dx = x + 0.5 - w / 2;
      const dy = y + 0.5 - h / 2;
      const sx = Math.floor(dx * cos + dy * sin + r.w / 2);
      const sy = Math.floor(-dx * sin + dy * cos + r.h / 2);
      if (sx >= 0 && sy >= 0 && sx < r.w && sy < r.h) setPixel(out, x, y, getPixel(r, sx, sy)!);
    }
  }
  return out;
}

/// Brings a picture that is `k` times too big back down: each block's most common colour (a block that is mostly empty stays empty).
function shrink(r: Raster, k: number, w: number, h: number): Raster {
  const out = newRaster(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const counts = new Map<string, { c: Rgba; n: number }>();
      let clear = 0;
      for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) {
        const p = getPixel(r, x * k + i, y * k + j);
        if (!p || p[3] === 0) { clear++; continue; }
        const key = `${p[0]},${p[1]},${p[2]},${p[3]}`;
        const e = counts.get(key);
        if (e) e.n++;
        else counts.set(key, { c: p, n: 1 });
      }
      if (clear * 2 > k * k) continue;
      let best: { c: Rgba; n: number } | null = null;
      for (const e of counts.values()) if (!best || e.n > best.n) best = e;
      if (best) setPixel(out, x, y, best.c);
    }
  }
  return out;
}

/// RotSprite: the picture turned by an angle (clockwise) with clean edges. Three Scale2x steps, a nearest-pixel turn, and the way back down. The result is just big enough
/// to hold the turned picture, the same size as `rotateNearest` gives.
export function rotSprite(r: Raster, degrees: number): Raster {
  const t = ((degrees % 360) + 360) % 360;
  if (t === 0) return { w: r.w, h: r.h, data: new Uint8ClampedArray(r.data) };
  const target = rotateNearest(r, degrees);
  const big = scale2x(scale2x(scale2x(r)));
  const turned = rotateNearest(big, degrees);
  // (the turned big picture is about 8 times the target; sample it on the target's grid, centred)
  const k = 8;
  const padded = newRaster(target.w * k, target.h * k);
  const ox = Math.floor((padded.w - turned.w) / 2);
  const oy = Math.floor((padded.h - turned.h) / 2);
  for (let y = 0; y < turned.h; y++) for (let x = 0; x < turned.w; x++) {
    const p = getPixel(turned, x, y)!;
    if (p[3]) setPixel(padded, x + ox, y + oy, p);
  }
  return shrink(padded, k, target.w, target.h);
}
