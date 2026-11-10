// Looking at how a model's texture is laid on it: how many texels each shape gets per model unit (texel density), how much a face is stretched when it is unfolded flat, and a
// checker picture to see both on the model.

import { walk, type Cube, type ModelDoc, type Vec3 } from "./model-doc";
import { hasVolume, solidOf } from "./model-mesh";
import { unwrap } from "./model-uv";
import { newRaster, setPixel, type Raster, type Rgba } from "./pixels";

type V = Vec3;
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);

export interface FaceStretch {
  /// Texels per model unit across the face (the square root of the ratio of areas), and how lopsided the mapping is: 1 is the same stretch in every direction, 2 means one
  /// direction has twice the texels of the other.
  density: number;
  stretch: number;
}

/// The mapping of one triangle from the surface to the picture: the two stretch factors of the 2x2 map between them (their geometric mean is the density).
function triangleStretch(p: [V, V, V], t: [[number, number], [number, number], [number, number]]): FaceStretch | null {
  const e1 = sub(p[1], p[0]);
  const e2 = sub(p[2], p[0]);
  const l1 = len(e1);
  if (l1 < 1e-9) return null;
  const ux: V = [e1[0] / l1, e1[1] / l1, e1[2] / l1];
  const h = len(cross(ux, e2));
  if (h < 1e-9) return null;
  // the triangle on a plane: p0 = (0,0), p1 = (l1, 0), p2 = (a, h)
  const a = dot(e2, ux);
  const u1 = [t[1][0] - t[0][0], t[1][1] - t[0][1]];
  const u2 = [t[2][0] - t[0][0], t[2][1] - t[0][1]];
  // J * [l1 a; 0 h] = [u1 u2]  =>  J = [u1 u2] * inverse([l1 a; 0 h])
  const j00 = u1[0]! / l1;
  const j10 = u1[1]! / l1;
  const j01 = (u2[0]! - j00 * a) / h;
  const j11 = (u2[1]! - j10 * a) / h;
  // singular values of the 2x2 matrix [j00 j01; j10 j11]
  const s = j00 * j00 + j01 * j01 + j10 * j10 + j11 * j11;
  const d = j00 * j11 - j01 * j10;
  const disc = Math.sqrt(Math.max(0, s * s - 4 * d * d));
  const big = Math.sqrt((s + disc) / 2);
  const small = Math.sqrt(Math.max(0, (s - disc) / 2));
  if (small < 1e-9) return { density: Math.sqrt(big * small), stretch: Infinity };
  return { density: Math.sqrt(big * small), stretch: big / small };
}

export interface ShapeReport {
  name: string;
  /// Where the shape is in the model: its part's names and its place in the part's list.
  parts: number[];
  cube: number;
  /// The average texels per unit over its faces (area weighted), and the range over its faces.
  density: number;
  densityMin: number;
  densityMax: number;
  /// The worst stretch over its faces (1 is none).
  stretch: number;
}

/// A report on every textured shape: how dense its texels are and how stretched its faces are.
export function uvReport(doc: ModelDoc): ShapeReport[] {
  const out: ShapeReport[] = [];
  for (const { part, parts } of walk(doc)) {
    part.cubes.forEach((c: Cube, ci) => {
      if (!c.texture || !hasVolume(c)) return;
      const solid = solidOf(c);
      const un = unwrap(c);
      let weighted = 0;
      let area = 0;
      let lo = Infinity;
      let hi = 0;
      let worst = 1;
      solid.polys.forEach((poly, pi) => {
        for (let k = 1; k + 1 < poly.v.length; k++) {
          const tri: [V, V, V] = [solid.verts[poly.v[0]!]!, solid.verts[poly.v[k]!]!, solid.verts[poly.v[k + 1]!]!];
          const uv = un.polys[pi]!;
          const r = triangleStretch(tri, [uv[0]!, uv[k]!, uv[k + 1]!]);
          if (!r) continue;
          const a = len(cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]))) / 2;
          weighted += r.density * a;
          area += a;
          lo = Math.min(lo, r.density);
          hi = Math.max(hi, r.density);
          worst = Math.max(worst, r.stretch);
        }
      });
      if (area > 0) out.push({ name: c.name ?? `shape ${ci + 1}`, parts, cube: ci, density: weighted / area, densityMin: lo, densityMax: hi, stretch: worst });
    });
  }
  return out;
}

/// Sets every textured shape to the same density (texels per unit) so detail looks even across the model; with no `texels` the middle one of the current densities is used.
/// The shapes' blocks change size, so the caller packs the blocks again afterwards (`packModel`).
export function equalizeDensity(doc: ModelDoc, texels?: number): ModelDoc {
  const report = uvReport(doc);
  if (!report.length) return doc;
  const sorted = report.map((r) => r.density).sort((a, b) => a - b);
  const target = Math.max(0.25, Math.min(8, texels ?? sorted[Math.floor(sorted.length / 2)]!));
  const next: ModelDoc = JSON.parse(JSON.stringify(doc));
  for (const { part } of walk(next)) for (const c of part.cubes) if (c.texture) c.texture.scale = Math.round(target * 4) / 4;
  return next;
}

/// A checker picture: squares of `cell` texels in two greys, with a colour in each square's corner so a turned or mirrored face shows.
export function checkerRaster(w: number, h: number, cell = 8): Raster {
  const r = newRaster(w, h);
  const light: Rgba = [200, 200, 205, 255];
  const dark: Rgba = [90, 95, 110, 255];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      let c = (cx + cy) % 2 === 0 ? light : dark;
      // a coloured mark in the top left of each square: red across, green down
      const ix = x % cell;
      const iy = y % cell;
      if (iy === 0 && ix < Math.max(2, cell / 2)) c = [220, 70, 70, 255];
      if (ix === 0 && iy < Math.max(2, cell / 2)) c = [70, 190, 90, 255];
      setPixel(r, x, y, c);
    }
  }
  return r;
}
