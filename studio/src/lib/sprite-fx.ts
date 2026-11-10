// Effects on one picture (a cel): each returns a new raster and works on the whole picture or only inside a rectangle. They change pixels for good
// (undo brings them back), like "Image" commands in a paint program.

import { cloneRaster, getPixel, inRect, newRaster, setPixel, type Raster, type Rect, type Rgba } from "./pixels";

/// The part of a picture an effect works on: a rectangle, with `has` limiting it to the cells of a selection that is not a rectangle. null is all of it.
export type Area = (Rect & { has?: (x: number, y: number) => boolean }) | null;
const inArea = (r: Area, x: number, y: number) => !r || (inRect(r, x, y) && (!r.has || r.has(x, y)));

/// Mirrors the picture left to right (or, with `vertical`, top to bottom), inside the area if given.
export function flipRaster(r: Raster, vertical: boolean, area: Area = null): Raster {
  const out = cloneRaster(r);
  const a = area ?? { x: 0, y: 0, w: r.w, h: r.h };
  for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) {
    const sx = vertical ? x : a.x + a.w - 1 - (x - a.x);
    const sy = vertical ? a.y + a.h - 1 - (y - a.y) : y;
    const c = getPixel(r, sx, sy);
    if (c) setPixel(out, x, y, c);
  }
  return out;
}

/// Turns a square area a quarter turn (clockwise, or counter-clockwise with `back`); null when the area is not square.
export function rotateQuarter(r: Raster, back = false, area: Area = null): Raster | null {
  const a = area ?? { x: 0, y: 0, w: r.w, h: r.h };
  if (a.w !== a.h) return null;
  const n = a.w;
  const out = cloneRaster(r);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    // clockwise: the pixel that lands at (x, y) came from (y, n - 1 - x)
    const [sx, sy] = back ? [n - 1 - y, x] : [y, n - 1 - x];
    const c = getPixel(r, a.x + sx, a.y + sy);
    if (c) setPixel(out, a.x + x, a.y + y, c);
  }
  return out;
}

/// Maps every visible pixel's colour through a function (alpha is kept), inside the area.
export function mapColors(r: Raster, fn: (c: Rgba) => Rgba, area: Area = null): Raster {
  const out = cloneRaster(r);
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    if (!inArea(area, x, y)) continue;
    const c = getPixel(r, x, y)!;
    if (c[3] === 0) continue;
    const m = fn(c);
    setPixel(out, x, y, [m[0], m[1], m[2], c[3]]);
  }
  return out;
}

export const invertColors = (r: Raster, area: Area = null) => mapColors(r, (c) => [255 - c[0], 255 - c[1], 255 - c[2], c[3]], area);
export const grayscale = (r: Raster, area: Area = null) =>
  mapColors(r, (c) => {
    const g = Math.round(0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]);
    return [g, g, g, c[3]];
  }, area);

/// Turns the hue of every colour round the colour wheel by some degrees.
export function hueShift(r: Raster, degrees: number, area: Area = null): Raster {
  return mapColors(r, (c) => {
    const [h, s, l] = rgbToHsl(c[0], c[1], c[2]);
    const [nr, ng, nb] = hslToRgb((((h + degrees / 360) % 1) + 1) % 1, s, l);
    return [nr, ng, nb, c[3]];
  }, area);
}

/// Makes every colour lighter (amount above 0, up to 1) or darker (below 0, down to -1).
export function brighten(r: Raster, amount: number, area: Area = null): Raster {
  const k = Math.max(-1, Math.min(1, amount));
  return mapColors(r, (c) => {
    const f = (v: number) => Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k));
    return [f(c[0]), f(c[1]), f(c[2]), c[3]];
  }, area);
}

/// Every pixel of one colour becomes another (the alpha of each pixel is kept).
export function replaceColor(r: Raster, from: Rgba, to: Rgba, area: Area = null): Raster {
  return mapColors(r, (c) => (c[0] === from[0] && c[1] === from[1] && c[2] === from[2] ? [to[0], to[1], to[2], c[3]] : c), area);
}

/// Slides the picture by some pixels and brings what leaves one side in at the other.
export function offsetWrap(r: Raster, dx: number, dy: number): Raster {
  const out = newRaster(r.w, r.h);
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    const c = getPixel(r, x, y)!;
    setPixel(out, (((x + dx) % r.w) + r.w) % r.w, (((y + dy) % r.h) + r.h) % r.h, c);
  }
  return out;
}

/// A line of one colour round the shapes: every empty pixel next to a visible one (up, down, left, right, and with `diagonals` also the corners)
/// takes the colour. The new pixels are drawn on the same picture; the shapes stay as they were.
export function outline(r: Raster, color: Rgba, diagonals = false): Raster {
  const out = cloneRaster(r);
  const around = diagonals ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    if (getPixel(r, x, y)![3] !== 0) continue;
    if (around.some(([dx, dy]) => (getPixel(r, x + dx!, y + dy!)?.[3] ?? 0) > 0)) setPixel(out, x, y, color);
  }
  return out;
}

/// A shadow of the shapes in one colour, shifted by (dx, dy), drawn behind them (only where the picture is empty).
export function dropShadow(r: Raster, dx: number, dy: number, color: Rgba): Raster {
  const out = cloneRaster(r);
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    if (getPixel(r, x, y)![3] === 0) continue;
    const [tx, ty] = [x + dx, y + dy];
    const there = getPixel(r, tx, ty);
    if (there && there[3] === 0) setPixel(out, tx, ty, color);
  }
  return out;
}

/// The colours a picture uses, most used first (transparent pixels are not counted), as #rrggbb.
export function usedColors(r: Raster, limit = 256): string[] {
  const counts = new Map<number, number>();
  for (let i = 0; i < r.data.length; i += 4) {
    if (r.data[i + 3] === 0) continue;
    const key = (r.data[i]! << 16) | (r.data[i + 1]! << 8) | r.data[i + 2]!;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, limit).map(([k]) => `#${k.toString(16).padStart(6, "0")}`);
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const [x, y, z] = [r / 255, g / 255, b / 255];
  const max = Math.max(x, y, z);
  const min = Math.min(x, y, z);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === x ? (y - z) / d + (y < z ? 6 : 0) : max === y ? (z - x) / d + 2 : (x - y) / d + 4;
  return [h / 6, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [Math.round(l * 255), Math.round(l * 255), Math.round(l * 255)];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    const u = ((t % 1) + 1) % 1;
    return u < 1 / 6 ? p + (q - p) * 6 * u : u < 1 / 2 ? q : u < 2 / 3 ? p + (q - p) * (2 / 3 - u) * 6 : p;
  };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}

/// Colours a picture by how light each pixel is: a list of colour stops (position 0 to 1, colour) is laid over the light-to-dark scale.
export function gradientMap(r: Raster, stops: { at: number; color: Rgba }[], area: Area = null): Raster {
  const s = [...stops].sort((a, b) => a.at - b.at);
  if (s.length === 0) return cloneRaster(r);
  const at = (t: number): Rgba => {
    if (t <= s[0]!.at) return s[0]!.color;
    for (let i = 1; i < s.length; i++) {
      const [a, b] = [s[i - 1]!, s[i]!];
      if (t <= b.at) {
        const k = b.at === a.at ? 0 : (t - a.at) / (b.at - a.at);
        return [0, 1, 2, 3].map((n) => Math.round(a.color[n]! + (b.color[n]! - a.color[n]!) * k)) as Rgba;
      }
    }
    return s[s.length - 1]!.color;
  };
  return mapColors(r, (c) => at((0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255), area);
}

/// Replaces every colour with the nearest colour of a palette (so a picture takes a palette's colours).
export function palettize(r: Raster, colors: Rgba[], area: Area = null): Raster {
  if (colors.length === 0) return cloneRaster(r);
  return mapColors(r, (c) => {
    let best = colors[0]!;
    let bestD = Infinity;
    for (const p of colors) {
      const d = 0.3 * (p[0] - c[0]) ** 2 + 0.59 * (p[1] - c[1]) ** 2 + 0.11 * (p[2] - c[2]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }, area);
}

/// Makes the picture blocky: every block of `size` by `size` pixels takes the average colour of its visible pixels.
export function pixelate(r: Raster, size: number, area: Area = null): Raster {
  const out = cloneRaster(r);
  const n = Math.max(1, Math.round(size));
  for (let by = 0; by < r.h; by += n) {
    for (let bx = 0; bx < r.w; bx += n) {
      let [sr, sg, sb, sa, count] = [0, 0, 0, 0, 0];
      for (let y = by; y < Math.min(r.h, by + n); y++) {
        for (let x = bx; x < Math.min(r.w, bx + n); x++) {
          const c = getPixel(r, x, y)!;
          if (c[3] === 0) continue;
          sr += c[0]; sg += c[1]; sb += c[2]; sa += c[3]; count++;
        }
      }
      if (count === 0) continue;
      const avg: Rgba = [Math.round(sr / count), Math.round(sg / count), Math.round(sb / count), Math.round(sa / count)];
      for (let y = by; y < Math.min(r.h, by + n); y++) {
        for (let x = bx; x < Math.min(r.w, bx + n); x++) {
          if (inArea(area, x, y) && getPixel(r, x, y)![3] > 0) setPixel(out, x, y, avg);
        }
      }
    }
  }
  return out;
}

/// Brightness, contrast (-1 to 1 each) and gamma (1 = none; above 1 lightens the middle) as one curve over all three colour channels.
export function colorCurve(r: Raster, brightness: number, contrast: number, gamma = 1, area: Area = null): Raster {
  const k = (1 + contrast) / (1 - Math.min(0.99, contrast));
  const curve = (v: number) => {
    let t = v / 255;
    t = Math.pow(Math.min(1, Math.max(0, t)), 1 / Math.max(0.05, gamma));
    t = (t - 0.5) * k + 0.5 + brightness;
    return Math.round(Math.min(1, Math.max(0, t)) * 255);
  };
  return mapColors(r, (c) => [curve(c[0]), curve(c[1]), curve(c[2]), c[3]], area);
}
