// Baking light into the model's texture: ambient occlusion. Every texel of every textured shape is a point on a surface; rays are sent out from it over the half
// space above the surface, and the share that escapes without hitting another surface (within a distance) is how open the spot is. Crevices and the feet of
// things come out dark, open faces bright. The same rays every time (no random numbers), so a bake is repeatable.

import { namesOf, walk, type ModelDoc, type Vec3 } from "./model-doc";
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
  const samples = Math.max(4, Math.min(256, options.samples ?? 24));
  const distance = options.distance ?? 8;
  const dirs = hemisphere(samples);
  return bakeTexels(doc, (at, n, tx, ty, tris) => {
    const origin = add(at, mul(n, 1e-3 + 1e-3 * distance));
    let open = 0;
    for (const d of dirs) {
      const dir = unit(add(add(mul(tx, d[0]), mul(ty, d[1])), mul(n, d[2])));
      let blocked = false;
      for (const t of tris) if (hits(origin, dir, t, distance)) { blocked = true; break; }
      if (!blocked) open++;
    }
    return open / dirs.length;
  });
}

/// Calls `shade` for every texel a shape covers (with the point on the surface in model space, the surface's normal, two directions across the surface, and every triangle of
/// the model) and writes what it returns (0 to 1) as grey. Null when the model has no texture.
function bakeTexels(doc: ModelDoc, shade: (at: V, n: V, tx: V, ty: V, tris: Tri[]) => number): Raster | null {
  return bakeTexelsRaw(doc, (at, n, tx, ty, tris) => {
    const grey = Math.round(Math.max(0, Math.min(1, shade(at, n, tx, ty, tris))) * 255);
    return [grey, grey, grey, 255];
  });
}

/// The same walk over the covered texels, but `shade` returns the texel's whole colour (or null to leave it empty).
/// The parts that are high-poly sources (a part with `bakeSource` and everything under it), as index paths joined by ".".
function sourcePaths(doc: ModelDoc): Set<string> {
  const out = new Set<string>();
  const go = (list: ModelDoc["parts"], prefix: number[], inside: boolean) => list.forEach((p, i) => {
    const path = [...prefix, i];
    const on = inside || !!p.bakeSource;
    if (on) out.add(path.join("."));
    go(p.children, path, on);
  });
  go(doc.parts, [], false);
  return out;
}

/// The tangent frame of a surface triangle from its texel coordinates: `t` along +u (right in the picture) and `b` up the picture (against v, which runs down), made
/// square to the normal `n`: what a glTF normal map's red and green mean. Null for a triangle with no area in the picture.
function tangentFrame(pa: V, pb: V, pc: V, ta: UV, tb: UV, tc: UV, n: V): { t: V; b: V } | null {
  const e1 = sub(pb, pa), e2 = sub(pc, pa);
  const du1 = tb[0] - ta[0], dv1 = tb[1] - ta[1], du2 = tc[0] - ta[0], dv2 = tc[1] - ta[1];
  const det = du1 * dv2 - du2 * dv1;
  if (Math.abs(det) < 1e-12) return null;
  const r = 1 / det;
  let t = unit(mul(sub(mul(e1, dv2), mul(e2, dv1)), r));
  t = unit(sub(t, mul(n, dot(t, n))));
  const dpdv = mul(sub(mul(e2, du1), mul(e1, du2)), r);
  const b = unit(sub(mul(dpdv, -1), mul(n, dot(dpdv, n))));
  if (dot(t, t) < 1e-12 || dot(b, b) < 1e-12) return null;
  return { t, b };
}

function bakeTexelsRaw(doc: ModelDoc, shade: (at: V, n: V, tx: V, ty: V, tris: Tri[], frame: { t: V; b: V } | null) => [number, number, number, number] | null): Raster | null {
  if (!doc.texture) return null;
  const sources = sourcePaths(doc);
  const [w, h] = doc.texture.size;
  const out = newRaster(w, h);
  const worlds = worldMatrices(doc);
  // every triangle of every shape, in model space
  const tris: Tri[] = [];
  const surfaces: { uv: UV[]; pts: V[]; normal: V }[] = [];
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
  for (const { part, parts: at } of walk(doc)) {
    if (sources.has(at.join("."))) continue; // a high-poly source is not part of the model
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
      const frame = tangentFrame(pa, pb, pc, ta, tb, tc, n);
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const px = x + 0.5, py = y + 0.5;
          const l1 = ((tb[1] - tc[1]) * (px - tc[0]) + (tc[0] - tb[0]) * (py - tc[1])) / den;
          const l2 = ((tc[1] - ta[1]) * (px - tc[0]) + (ta[0] - tc[0]) * (py - tc[1])) / den;
          const l3 = 1 - l1 - l2;
          if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
          const at = add(add(mul(pa, l1), mul(pb, l2)), mul(pc, l3));
          const rgba = shade(at, n, tx, ty, tris, frame);
          if (!rgba) continue;
          const i = (y * w + x) * 4;
          out.data[i] = rgba[0];
          out.data[i + 1] = rgba[1];
          out.data[i + 2] = rgba[2];
          out.data[i + 3] = rgba[3];
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

// ---- curvature ----

/// How strongly each point of a mesh bends: the average, over the edges at the point, of the turn between the two faces of the edge, in units of a right angle (so a box's
/// corner is about +1, a flat spot 0, a groove -1). Positive is convex (an edge you could knock), negative concave (a crease dirt collects in). An edge on only one face counts
/// as flat.
export function vertexCurvature(verts: V[], polys: { v: number[] }[]): number[] {
  const normals = polys.map((f) => unit(polyNormal(verts, f.v)));
  const centres = polys.map((f) => {
    const c: V = [0, 0, 0];
    for (const i of f.v) for (let a = 0; a < 3; a++) c[a]! += verts[i]![a]! / f.v.length;
    return c;
  });
  const edges = new Map<string, number[]>();
  polys.forEach((f, fi) => f.v.forEach((a, k) => {
    const b = f.v[(k + 1) % f.v.length]!;
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    (edges.get(key) ?? edges.set(key, []).get(key)!).push(fi);
  }));
  const sum = verts.map(() => 0);
  const count = verts.map(() => 0);
  for (const [key, faces] of edges) {
    const [a, b] = key.split(",").map(Number) as [number, number];
    let turn = 0;
    if (faces.length === 2) {
      const [f, g] = faces as [number, number];
      const angle = Math.acos(Math.max(-1, Math.min(1, dot(normals[f]!, normals[g]!))));
      // convex when the other face's middle lies behind this face's plane
      const behind = dot(sub(centres[g]!, centres[f]!), normals[f]!) < 0;
      turn = (behind ? angle : -angle) / (Math.PI / 2);
    }
    for (const i of [a, b]) {
      sum[i]! += turn;
      count[i]!++;
    }
  }
  return sum.map((v, i) => (count[i] ? v / count[i]! : 0));
}

/// The curvature of every textured texel: a picture the size of the texture, grey 128 where the surface is flat, lighter where it is convex and darker where it is concave
/// (`range` is the curvature, in right angles, that reaches the ends of the scale), with alpha 255 where a shape covers the texel. Null when the model has no texture.
export function bakeCurvature(doc: ModelDoc, range = 1): Raster | null {
  if (!doc.texture) return null;
  const [w, h] = doc.texture.size;
  const out = newRaster(w, h);
  for (const { part } of walk(doc)) {
    for (const c of part.cubes) {
      if (!c.texture || !hasVolume(c)) continue;
      const solid = solidOf(c);
      const curv = vertexCurvature(solid.verts, solid.polys);
      const un = unwrap(c);
      const [ax, ay] = c.texture.at;
      solid.polys.forEach((poly, pi) => {
        const uv = un.polys[pi]!.map((q) => [ax + q[0], ay + q[1]] as UV);
        for (let k = 1; k + 1 < poly.v.length; k++) {
          const ta = uv[0]!, tb = uv[k]!, tc = uv[k + 1]!;
          const va = curv[poly.v[0]!]!, vb = curv[poly.v[k]!]!, vc = curv[poly.v[k + 1]!]!;
          const den = (tb[1] - tc[1]) * (ta[0] - tc[0]) + (tc[0] - tb[0]) * (ta[1] - tc[1]);
          if (Math.abs(den) < 1e-9) continue;
          for (let y = Math.max(0, Math.floor(Math.min(ta[1], tb[1], tc[1]))); y <= Math.min(h - 1, Math.ceil(Math.max(ta[1], tb[1], tc[1]))); y++) {
            for (let x = Math.max(0, Math.floor(Math.min(ta[0], tb[0], tc[0]))); x <= Math.min(w - 1, Math.ceil(Math.max(ta[0], tb[0], tc[0]))); x++) {
              const px = x + 0.5, py = y + 0.5;
              const l1 = ((tb[1] - tc[1]) * (px - tc[0]) + (tc[0] - tb[0]) * (py - tc[1])) / den;
              const l2 = ((tc[1] - ta[1]) * (px - tc[0]) + (ta[0] - tc[0]) * (py - tc[1])) / den;
              const l3 = 1 - l1 - l2;
              if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
              const v = (l1 * va + l2 * vb + l3 * vc) / Math.max(1e-6, range);
              const grey = Math.round(128 + Math.max(-1, Math.min(1, v)) * 127);
              const i = (y * w + x) * 4;
              out.data[i] = out.data[i + 1] = out.data[i + 2] = grey;
              out.data[i + 3] = 255;
            }
          }
        }
      });
    }
  }
  return out;
}

/// Edge wear: the picture lightened where the surface is convex (edges, which wear bright) and darkened where it is concave (creases, where dirt collects). `strength` is the
/// most a texel is changed (0 to 1). Texels the bake does not cover are left alone.
export function applyCurvature(picture: Raster, curvature: Raster, strength = 0.4): Raster {
  const out = { w: picture.w, h: picture.h, data: new Uint8ClampedArray(picture.data) };
  const k = Math.min(1, Math.max(0, strength));
  for (let i = 0; i < out.data.length; i += 4) {
    if (i + 3 >= curvature.data.length || !curvature.data[i + 3]) continue;
    const c = (curvature.data[i]! - 128) / 127; // -1 concave .. 1 convex
    for (let a = 0; a < 3; a++) {
      const v = out.data[i + a]!;
      out.data[i + a] = Math.round(c >= 0 ? v + (255 - v) * c * k : v * (1 + c * k));
    }
  }
  return out;
}

// ---- lighting ----

export interface LightBake {
  /// The way the light travels is FROM this direction: a vector pointing at the sun, in model space (it need not be a unit vector). Default: from above and a little to the side.
  toLight?: V;
  /// How much light reaches a surface that faces away or sits in shadow, 0 to 1.
  ambient?: number;
}

/// Sunlight baked into a picture: how lit each textured texel is, 0 (dark) to 255, from one directional light: the surface's cosine to the light, zero where something is in the
/// way (a shadow ray towards the light meets a triangle), plus the ambient floor. Null when the model has no texture.
export function bakeLighting(doc: ModelDoc, options: LightBake = {}): Raster | null {
  const dir = unit(options.toLight ?? [0.4, 1, 0.3]);
  const ambient = Math.max(0, Math.min(1, options.ambient ?? 0.25));
  return bakeTexels(doc, (at, n, _tx, _ty, tris) => {
    const facing = Math.max(0, dot(n, dir));
    if (facing <= 0) return ambient;
    const origin = add(at, mul(n, 2e-3));
    for (const t of tris) if (hits(origin, dir, t, 1e6)) return ambient;
    return ambient + (1 - ambient) * facing;
  });
}

/// The picture multiplied by the baked light (a texel the bake does not cover is left alone). `strength` 1 is the full effect, 0 none.
export function applyLighting(picture: Raster, light: Raster, strength = 1): Raster {
  const out = { w: picture.w, h: picture.h, data: new Uint8ClampedArray(picture.data) };
  const k = Math.min(1, Math.max(0, strength));
  for (let i = 0; i < out.data.length; i += 4) {
    if (i + 3 >= light.data.length || !light.data[i + 3]) continue;
    const f = 1 - k + (k * light.data[i]!) / 255;
    for (let a = 0; a < 3; a++) out.data[i + a] = Math.round(out.data[i + a]! * f);
  }
  return out;
}

/// Projection painting: a picture thrown onto the model from the camera, as a slide projector would. `modelToClip` is the camera's view and projection matrices times the
/// model's own (column-major, 16 numbers, as three.js keeps them); `eye` is the camera's place in model space. Every texel whose surface faces the camera, is not hidden
/// behind another surface and lands inside the picture takes the picture's colour there. Returns a picture the size of the texture with only those texels filled (alpha 0
/// elsewhere), to lay over the painting. `viewAspect` is the view's width over its height; the picture is shown in the middle of the view at its own proportions. Null when the model has no texture.
export function projectImage(doc: ModelDoc, image: Raster, modelToClip: number[], eye: Vec3, viewAspect = image.w / image.h): Raster | null {
  const m = modelToClip;
  // the picture sits in the middle of the view at its own proportions, as large as fits
  const ia = image.w / image.h;
  const shownW = ia >= viewAspect ? 1 : ia / viewAspect;
  const shownH = ia >= viewAspect ? viewAspect / ia : 1;
  return bakeTexelsRaw(doc, (at, n, _tx, _ty, tris) => {
    const toEye = sub(eye, at);
    const dist = Math.hypot(toEye[0], toEye[1], toEye[2]);
    if (dist < 1e-9 || dot(n, toEye) <= 0) return null;
    const cx = m[0]! * at[0] + m[4]! * at[1] + m[8]! * at[2] + m[12]!;
    const cy = m[1]! * at[0] + m[5]! * at[1] + m[9]! * at[2] + m[13]!;
    const cw = m[3]! * at[0] + m[7]! * at[1] + m[11]! * at[2] + m[15]!;
    if (cw <= 1e-9) return null;
    const nx = cx / cw;
    const ny = cy / cw;
    if (nx < -1 || nx > 1 || ny < -1 || ny > 1) return null;
    const dir = mul(toEye, 1 / dist);
    const origin = add(at, mul(n, 2e-3));
    for (const t of tris) if (hits(origin, dir, t, dist - 4e-3)) return null;
    const u = ((nx + 1) / 2 - (1 - shownW) / 2) / shownW;
    const v = ((1 - ny) / 2 - (1 - shownH) / 2) / shownH;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return null;
    const px = Math.min(image.w - 1, Math.floor(u * image.w));
    const py = Math.min(image.h - 1, Math.floor(v * image.h));
    const i = (py * image.w + px) * 4;
    if (!image.data[i + 3]) return null;
    return [image.data[i]!, image.data[i + 1]!, image.data[i + 2]!, image.data[i + 3]!];
  });
}

/// The nearest triangle a ray meets within `max` (either side counts), with the distance.
function nearestHit(o: V, d: V, tris: Tri[], max: number): { t: number; tri: Tri } | null {
  let best: { t: number; tri: Tri } | null = null;
  for (const tri of tris) {
    const e1 = sub(tri.b, tri.a), e2 = sub(tri.c, tri.a);
    const p = cross(d, e2);
    const det = dot(e1, p);
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det;
    const s = sub(o, tri.a);
    const u = dot(s, p) * inv;
    if (u < 0 || u > 1) continue;
    const q = cross(s, e1);
    const v = dot(d, q) * inv;
    if (v < 0 || u + v > 1) continue;
    const t = dot(e2, q) * inv;
    if (t > 1e-9 && t <= max && (!best || t < best.t)) best = { t, tri };
  }
  return best;
}

/// A tangent-space normal map baked from the model's high-poly source parts onto its textured shapes: from each texel's point a ray goes in against the surface from `cage`
/// model units out, and the face it meets first (within twice the cage) gives the normal, written in the surface's own frame (red along +u, green up the picture, blue out of
/// the surface, as glTF wants it). Texels that meet nothing, and texels no shape covers, are flat (128, 128, 255). Null when the model has no texture or no high-poly part.
export function bakeNormals(doc: ModelDoc, cage = 4): Raster | null {
  if (!doc.texture) return null;
  const sources = sourcePaths(doc);
  const worlds = worldMatrices(doc);
  const high: Tri[] = [];
  for (const { part, parts } of walk(doc)) {
    if (!sources.has(parts.join("."))) continue;
    const m = worlds.get(namesOf(doc, parts).join("/"));
    if (!m) continue;
    for (const c of part.cubes) {
      if (!hasVolume(c)) continue;
      const solid = solidOf(c);
      const world = solid.verts.map((p) => transformPoint(m, p));
      for (const poly of solid.polys) for (let k = 1; k + 1 < poly.v.length; k++) high.push({ a: world[poly.v[0]!]!, b: world[poly.v[k]!]!, c: world[poly.v[k + 1]!]! });
    }
  }
  if (!high.length) return null;
  const raw = bakeTexelsRaw(doc, (at, n, _tx, _ty, _tris, frame) => {
    if (!frame) return null;
    const hit = nearestHit(add(at, mul(n, cage)), mul(n, -1), high, cage * 2);
    let nh: V = n;
    if (hit) {
      nh = unit(cross(sub(hit.tri.b, hit.tri.a), sub(hit.tri.c, hit.tri.a)));
      if (dot(nh, n) < 0) nh = mul(nh, -1);
    }
    const tn = unit([dot(nh, frame.t), dot(nh, frame.b), Math.max(0.1, dot(nh, n))]);
    return [Math.round((tn[0] * 0.5 + 0.5) * 255), Math.round((tn[1] * 0.5 + 0.5) * 255), Math.round((tn[2] * 0.5 + 0.5) * 255), 255];
  });
  if (!raw) return null;
  for (let i = 0; i < raw.data.length; i += 4) {
    if (raw.data[i + 3] === 0) {
      raw.data[i] = 128;
      raw.data[i + 1] = 128;
      raw.data[i + 2] = 255;
      raw.data[i + 3] = 255;
    }
  }
  return raw;
}
