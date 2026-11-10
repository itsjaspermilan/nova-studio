// Baking light into the model's texture: ambient occlusion. Every texel of every textured shape is a point on a surface; rays are sent out from it over the half
// space above the surface, and the share that escapes without hitting another surface (within a distance) is how open the spot is. Crevices and the feet of
// things come out dark, open faces bright. The same rays every time (no random numbers), so a bake is repeatable.

import { walk, type ModelDoc, type Vec3 } from "./model-doc";
import { polyNormal, hasVolume, solidOf } from "./model-mesh";
import { transformPoint, transformDirection, worldMatrices } from "./model-skin";
import { unwrap, type UV } from "./model-uv";
import { newRaster, type Raster } from "./pixels";

type V = Vec3;
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V): V => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 1e-12 ? mul(a, 1 / l) : [0, 0, 0];
};

interface Tri {
  a: V;
  b: V;
  c: V;
}

/// Whether a ray from `o` along `d` (unit) meets the triangle within `max` (Möller-Trumbore; both sides count).
function hits(o: V, d: V, t: Tri, max: number): boolean {
  const e1 = sub(t.b, t.a);
  const e2 = sub(t.c, t.a);
  const p = cross(d, e2);
  const det = dot(e1, p);
  if (Math.abs(det) < 1e-12) return false;
  const inv = 1 / det;
  const s = sub(o, t.a);
  const u = dot(s, p) * inv;
  if (u < 0 || u > 1) return false;
  const q = cross(s, e1);
  const v = dot(d, q) * inv;
  if (v < 0 || u + v > 1) return false;
  const dist = dot(e2, q) * inv;
  return dist > 1e-4 && dist < max;
}

/// `count` directions spread evenly over the hemisphere about +z, denser near the pole (cosine weighted): a low-discrepancy (Hammersley) set.
export function hemisphere(count: number): V[] {
  const out: V[] = [];
  for (let i = 0; i < count; i++) {
    let bits = i;
    bits = ((bits << 16) | (bits >>> 16)) >>> 0;
    bits = (((bits & 0x55555555) << 1) | ((bits & 0xaaaaaaaa) >>> 1)) >>> 0;
    bits = (((bits & 0x33333333) << 2) | ((bits & 0xcccccccc) >>> 2)) >>> 0;
    bits = (((bits & 0x0f0f0f0f) << 4) | ((bits & 0xf0f0f0f0) >>> 4)) >>> 0;
    bits = (((bits & 0x00ff00ff) << 8) | ((bits & 0xff00ff00) >>> 8)) >>> 0;
    const u = (i + 0.5) / count;
    const v = bits * 2.3283064365386963e-10;
    const r = Math.sqrt(u);
    const phi = 2 * Math.PI * v;
    out.push([r * Math.cos(phi), r * Math.sin(phi), Math.sqrt(Math.max(0, 1 - u))]);
  }
  return out;
}

export interface BakeOptions {
  /// Rays a texel sends out.
  samples?: number;
  /// How far a ray looks for something in the way, in model units.
  distance?: number;
}

/// The openness of every textured texel: a picture the size of the model's texture with grey = how open (255 fully open, dark = enclosed) and alpha 255 where a shape's
/// polygon covers the texel (0 elsewhere). Null when the model has no texture.
export function bakeOcclusion(doc: ModelDoc, options: BakeOptions = {}): Raster | null {
  if (!doc.texture) return null;
  const samples = Math.max(4, Math.min(256, options.samples ?? 24));
  const distance = options.distance ?? 8;
  const [w, h] = doc.texture.size;
  const out = newRaster(w, h);
  const worlds = worldMatrices(doc);
  // every triangle of every shape, in model space
  const tris: Tri[] = [];
  const surfaces: { uv: UV[]; pts: V[]; normal: V }[] = [];
  const dirs = hemisphere(samples);
  const nameOf = new Map<unknown, string>();
  for (const { part, parts } of walk(doc)) {
    let list = doc.parts;
    const names: string[] = [];
    for (const i of parts) {
      names.push(list[i]!.name);
      list = list[i]!.children;
    }
    nameOf.set(part, names.join("/"));
  }
  for (const { part } of walk(doc)) {
    const m = worlds.get(nameOf.get(part)!);
    if (!m) continue;
    for (const c of part.cubes) {
      if (!hasVolume(c)) continue;
      const solid = solidOf(c);
      const world = solid.verts.map((p) => transformPoint(m, p));
      const un = c.texture ? unwrap(c) : null;
      solid.polys.forEach((poly, pi) => {
        const pts = poly.v.map((i) => world[i]!);
        for (let k = 1; k + 1 < pts.length; k++) tris.push({ a: pts[0]!, b: pts[k]!, c: pts[k + 1]! });
        if (!un || !c.texture) return;
        const n = unit(transformDirection(m, polyNormal(solid.verts, poly.v)));
        const [ax, ay] = c.texture.at;
        surfaces.push({ uv: un.polys[pi]!.map((q) => [ax + q[0], ay + q[1]] as UV), pts, normal: n });
      });
    }
  }
  for (const s of surfaces) {
    const n = s.normal;
    if (n[0] === 0 && n[1] === 0 && n[2] === 0) continue;
    // a frame about the normal to turn the hemisphere's directions into the world
    const helper: V = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const tx = unit(cross(helper, n));
    const ty = cross(n, tx);
    for (let k = 1; k + 1 < s.uv.length; k++) {
      const ta = s.uv[0]!, tb = s.uv[k]!, tc = s.uv[k + 1]!;
      const pa = s.pts[0]!, pb = s.pts[k]!, pc = s.pts[k + 1]!;
      const minX = Math.max(0, Math.floor(Math.min(ta[0], tb[0], tc[0]))), maxX = Math.min(w - 1, Math.ceil(Math.max(ta[0], tb[0], tc[0])));
      const minY = Math.max(0, Math.floor(Math.min(ta[1], tb[1], tc[1]))), maxY = Math.min(h - 1, Math.ceil(Math.max(ta[1], tb[1], tc[1])));
      const den = (tb[1] - tc[1]) * (ta[0] - tc[0]) + (tc[0] - tb[0]) * (ta[1] - tc[1]);
      if (Math.abs(den) < 1e-9) continue;
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const px = x + 0.5, py = y + 0.5;
          const l1 = ((tb[1] - tc[1]) * (px - tc[0]) + (tc[0] - tb[0]) * (py - tc[1])) / den;
          const l2 = ((tc[1] - ta[1]) * (px - tc[0]) + (ta[0] - tc[0]) * (py - tc[1])) / den;
          const l3 = 1 - l1 - l2;
          if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
          const at = add(add(mul(pa, l1), mul(pb, l2)), mul(pc, l3));
          const origin = add(at, mul(n, 1e-3 + 1e-3 * distance));
          let open = 0;
          for (const d of dirs) {
            const dir = unit(add(add(mul(tx, d[0]), mul(ty, d[1])), mul(n, d[2])));
            let blocked = false;
            for (const t of tris) if (hits(origin, dir, t, distance)) { blocked = true; break; }
            if (!blocked) open++;
          }
          const grey = Math.round((open / dirs.length) * 255);
          const i = (y * w + x) * 4;
          out.data[i] = out.data[i + 1] = out.data[i + 2] = grey;
          out.data[i + 3] = 255;
        }
      }
    }
  }
  return out;
}

/// The picture darkened where the bake says a spot is enclosed: each covered texel's colour is multiplied by `1 - strength * (1 - openness)`. Texels the bake does not
/// cover are left alone.
export function applyOcclusion(picture: Raster, ao: Raster, strength = 1): Raster {
  const out = { w: picture.w, h: picture.h, data: new Uint8ClampedArray(picture.data) };
  const k = Math.min(1, Math.max(0, strength));
  for (let i = 0; i < out.data.length; i += 4) {
    if (!ao.data[i + 3] || i + 3 >= ao.data.length) continue;
    const f = 1 - k * (1 - ao.data[i]! / 255);
    out.data[i] = Math.round(out.data[i]! * f);
    out.data[i + 1] = Math.round(out.data[i + 1]! * f);
    out.data[i + 2] = Math.round(out.data[i + 2]! * f);
  }
  return out;
}
