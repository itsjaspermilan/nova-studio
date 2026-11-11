// Sculpt masks and local detail: a mask protects points from the brushes, and detail adds points only where the brush works, so a coarse shape can be
// sculpted finely without subdividing all of it. Pure functions on a mesh element.

import { falloffWeight, type Falloff } from "./mesh-ops";
import { toMesh } from "./mesh-edit";
import { fitBounds, type Cube, type MeshFace, type Vec3 } from "./model-doc";

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/// The mask of a mesh: one number a point (0 free, 1 protected); all zero for a shape that has none.
export function maskOf(c: Cube): number[] {
  const n = c.verts?.length ?? 0;
  return c.mask && c.mask.length === n ? c.mask : new Array<number>(n).fill(0);
}

const withMask = (c: Cube, mask: number[]): Cube => {
  const out = toMesh(c);
  if (mask.some((m) => m > 0)) out.mask = mask.map((m) => Math.round(Math.min(1, Math.max(0, m)) * 1000) / 1000);
  else delete out.mask;
  return out;
};

/// One dab of the mask brush at `center`: raises the mask by the falloff times `strength` (or wipes it, with `erase`). Also on the mirror side with `symmetryX`.
export function maskDab(source: Cube, center: Vec3, o: { radius: number; strength: number; falloff?: Falloff; erase?: boolean; symmetryX?: boolean }): Cube {
  const verts = source.verts ?? [];
  const mask = [...maskOf(source)];
  const r = Math.max(1e-6, o.radius);
  const centres: Vec3[] = [center];
  if (o.symmetryX) centres.push([-center[0], center[1], center[2]]);
  for (const at of centres) {
    for (let i = 0; i < verts.length; i++) {
      const d = dist(verts[i]!, at);
      if (d >= r) continue;
      const w = falloffWeight(o.falloff ?? "smooth", d / r) * Math.min(1, Math.max(0, o.strength));
      mask[i] = o.erase ? Math.max(0, mask[i]! - w) : Math.min(1, mask[i]! + w);
    }
  }
  return withMask(source, mask);
}

export const clearMask = (c: Cube): Cube => withMask(c, new Array<number>(c.verts?.length ?? 0).fill(0));
export const invertMask = (c: Cube): Cube => withMask(c, maskOf(c).map((m) => 1 - m));
/// Protects the given points fully (or, with `hide` false, frees them).
export const maskPoints = (c: Cube, points: number[], protect = true): Cube => {
  const mask = [...maskOf(c)];
  for (const i of points) if (i >= 0 && i < mask.length) mask[i] = protect ? 1 : 0;
  return withMask(c, mask);
};
/// Softens the edge of the mask: each point takes the average of itself and its neighbours.
export function blurMask(c: Cube, times = 1): Cube {
  const n = c.verts?.length ?? 0;
  const nb: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (const f of c.polys ?? []) f.v.forEach((a, k) => {
    const b = f.v[(k + 1) % f.v.length]!;
    nb[a]!.add(b);
    nb[b]!.add(a);
  });
  let m = maskOf(c);
  for (let t = 0; t < times; t++) m = m.map((v, i) => (nb[i]!.size ? (v + [...nb[i]!].reduce((s, j) => s + m[j]!, 0)) / (1 + nb[i]!.size) : v));
  return withMask(c, m);
}

const longestEdge = (verts: Vec3[], f: MeshFace) => f.v.reduce((m, a, k) => Math.max(m, dist(verts[a]!, verts[f.v[(k + 1) % f.v.length]!]!)), 0);

/// Splits the polygons whose middle is within `radius` of `center` and whose longest edge is over `maxEdge`, each into one quad per corner. A neighbouring polygon
/// that shares a split edge takes the new point into its outline (it becomes a polygon with one more corner), so the mesh stays closed when the points move.
/// Mask, skin weights and colours carry over; shape keys are dropped (they name a place for every old point). Returns the same mesh when nothing is long enough.
export function refineUnder(source: Cube, center: Vec3, radius: number, maxEdge: number): Cube {
  const c = toMesh(source);
  const verts = c.verts!;
  const polys = c.polys ?? [];
  const mid = (f: MeshFace): Vec3 => {
    const s = f.v.reduce<Vec3>((t, i) => [t[0] + verts[i]![0], t[1] + verts[i]![1], t[2] + verts[i]![2]], [0, 0, 0]);
    return [s[0] / f.v.length, s[1] / f.v.length, s[2] / f.v.length];
  };
  const chosen = new Set<number>();
  polys.forEach((f, i) => {
    if (dist(mid(f), center) < radius && longestEdge(verts, f) > maxEdge) chosen.add(i);
  });
  if (!chosen.size || verts.length > 60000) return source;
  const mask = c.mask && c.mask.length === verts.length ? [...c.mask] : null;
  const skin = c.skin && c.skin.weights.length === verts.length ? c.skin : null;
  const weights = skin ? skin.weights.map((w) => w.map((p) => [...p] as [number, number])) : null;
  const edgeMid = new Map<string, number>();
  const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  const addPoint = (p: Vec3, from: number, m: number) => {
    verts.push(p);
    mask?.push(m);
    weights?.push(weights[from]!.map((q) => [...q] as [number, number]));
    return verts.length - 1;
  };
  const midpoint = (a: number, b: number) => {
    const k = key(a, b);
    let m = edgeMid.get(k);
    if (m === undefined) {
      const pa = verts[a]!;
      const pb = verts[b]!;
      m = addPoint([(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2], a, mask ? (mask[a]! + mask[b]!) / 2 : 0);
      edgeMid.set(k, m);
    }
    return m;
  };
  // the new points on every edge of a chosen polygon first, so the others can use them
  for (const i of chosen) {
    const f = polys[i]!;
    f.v.forEach((a, k) => midpoint(a, f.v[(k + 1) % f.v.length]!));
  }
  const out: MeshFace[] = [];
  polys.forEach((f, i) => {
    const k = f.v.length;
    if (chosen.has(i)) {
      const mids = f.v.map((a, j) => midpoint(a, f.v[(j + 1) % k]!));
      const sum = f.v.reduce<Vec3>((t, p) => [t[0] + verts[p]![0], t[1] + verts[p]![1], t[2] + verts[p]![2]], [0, 0, 0]);
      const centre = addPoint([sum[0] / k, sum[1] / k, sum[2] / k], f.v[0]!, mask ? f.v.reduce((s, p) => s + mask[p]!, 0) / k : 0);
      for (let j = 0; j < k; j++) {
        const piece: MeshFace = { v: [f.v[j]!, mids[j]!, centre, mids[(j + k - 1) % k]!] };
        if (f.color) piece.color = f.color;
        if (f.smooth) piece.smooth = true;
        out.push(piece);
      }
      return;
    }
    // a polygon beside a split edge takes the new point into its outline
    const v: number[] = [];
    f.v.forEach((a, j) => {
      v.push(a);
      const m = edgeMid.get(key(a, f.v[(j + 1) % k]!));
      if (m !== undefined) v.push(m);
    });
    out.push(v.length === k ? f : { ...f, v });
  });
  c.polys = out;
  if (mask) c.mask = mask;
  if (skin && weights) c.skin = { ...skin, weights };
  delete c.shapes;
  delete c.keyEdit;
  fitBounds(c);
  return c;
}
