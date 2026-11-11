// Mirror editing: when Symmetry is on, an edit of the picked points or faces is made on their mirror twins too. A twin is the point (or face) that sits at the
// mirror image across the x, y or z plane through the part's origin, found by position, so the mesh has to be symmetrical to start with.

import { bevelChain, deleteFaces, extrudeFace, loopCut, weld } from "./mesh-edit";
import type { Cube, Vec3 } from "./model-doc";

export type Axis = 0 | 1 | 2;
const EPS = 0.01;

const mirrored = (p: Vec3, axis: Axis): Vec3 => {
  const r: Vec3 = [...p] as Vec3;
  r[axis] = -r[axis];
  return r;
};
const close = (a: Vec3, b: Vec3, eps: number) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= eps;

/// For each point, its mirror twin's number, or -1 when there is none. A point on the plane is its own twin.
export function twinPoints(c: Cube, axis: Axis, eps = EPS): number[] {
  const verts = c.verts ?? [];
  // (a coarse grid so that a mesh of thousands of points is not compared pair by pair)
  const cell = (p: Vec3) => p.map((n) => Math.round(n / (eps * 4))).join(",");
  const grid = new Map<string, number[]>();
  verts.forEach((p, i) => {
    const k = cell(p);
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
  });
  const near = (p: Vec3): number => {
    const base = p.map((n) => Math.round(n / (eps * 4)));
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const j of grid.get(`${base[0]! + dx},${base[1]! + dy},${base[2]! + dz}`) ?? []) if (close(verts[j]!, p, eps)) return j;
    }
    return -1;
  };
  return verts.map((p, i) => (Math.abs(p[axis]) <= eps ? i : near(mirrored(p, axis))));
}

/// The picked points with the transform's result copied, mirrored, onto their twins: `result` is `base` after the points in `picked` were moved, scaled or turned.
/// A picked point on the plane stays on it; a point whose twin is also picked is the one that leads (the lower number), the other follows it.
export function mirrorResult(base: Cube, result: Cube, picked: number[], axis: Axis, eps = EPS): Cube {
  if (!base.verts || !result.verts || base.verts.length !== result.verts.length) return result;
  const twins = twinPoints(base, axis, eps);
  const out: Cube = { ...result, verts: result.verts.map((p) => [...p] as Vec3) };
  const follower = new Set<number>();
  for (const i of [...picked].sort((a, b) => a - b)) {
    const t = twins[i] ?? -1;
    if (t < 0 || t === i || follower.has(i)) continue;
    out.verts![t] = mirrored(out.verts![i]!, axis);
    follower.add(t);
  }
  for (const i of picked) if (twins[i] === i) out.verts![i]![axis] = 0;
  return out;
}

const sameSet = (a: number[], b: number[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

/// The face that mirrors `face` (all its points twinned), or -1 when there is none or the face is its own mirror image.
export function twinFace(c: Cube, face: number, axis: Axis, twins = twinPoints(c, axis)): number {
  const f = c.polys?.[face];
  if (!f) return -1;
  const mapped = f.v.map((i) => twins[i] ?? -1);
  if (mapped.some((i) => i < 0) || sameSet(mapped, f.v)) return -1;
  return (c.polys ?? []).findIndex((q, j) => j !== face && sameSet(q.v, mapped));
}

/// The faces to treat as picked: `faces` and the mirror twin of each (once).
export function withTwinFaces(c: Cube, faces: number[], axis: Axis): number[] {
  const twins = twinPoints(c, axis);
  const out = [...faces];
  for (const f of faces) {
    const t = twinFace(c, f, axis, twins);
    if (t >= 0 && !out.includes(t)) out.push(t);
  }
  return out;
}

/// Which way (0 or 1: the edges `way` and `way + 2`) a loop cut through `twin` must go to be the mirror of the cut through `face` going `way`, or null.
export function twinWay(c: Cube, face: number, way: 0 | 1, twin: number, axis: Axis): 0 | 1 | null {
  const f = c.polys?.[face];
  const g = c.polys?.[twin];
  if (!f || !g || f.v.length !== 4 || g.v.length !== 4) return null;
  const twins = twinPoints(c, axis);
  const a = twins[f.v[way]!] ?? -1;
  const b = twins[f.v[(way + 1) % 4]!] ?? -1;
  for (let k = 0; k < 4; k++) {
    const p = g.v[k]!;
    const q = g.v[(k + 1) % 4]!;
    if ((p === a && q === b) || (p === b && q === a)) return (k % 2) as 0 | 1;
  }
  return null;
}

/// The mirror image of a run of points (a chain of edges), or null when some point has no twin or the chain is its own mirror image.
export function twinChain(c: Cube, chain: number[], axis: Axis): number[] | null {
  const twins = twinPoints(c, axis);
  const mapped = chain.map((i) => twins[i] ?? -1);
  if (mapped.some((i) => i < 0) || sameSet(mapped, chain)) return null;
  return mapped;
}

/// The numbers of the points of `c` that sit where the points `at` (positions) are, or null when one is missing.
export function pointsAt(c: Cube, at: Vec3[], eps = EPS): number[] | null {
  const out: number[] = [];
  for (const p of at) {
    const j = (c.verts ?? []).findIndex((q) => close(q, p, eps));
    if (j < 0) return null;
    out.push(j);
  }
  return out;
}

/// Whether the points `b` are the mirror image of the points `a` (the same set of places, reflected), as the second of two mirrored edits should leave them.
export function mirrorsEachOther(c: Cube, a: number[], b: number[], axis: Axis, eps = EPS): boolean {
  const verts = c.verts ?? [];
  if (a.length !== b.length) return false;
  const used = new Set<number>();
  for (const i of a) {
    const want = mirrored(verts[i]!, axis);
    const j = b.findIndex((k, n) => !used.has(n) && verts[k] && close(verts[k]!, want, eps));
    if (j < 0) return false;
    used.add(j);
  }
  return true;
}

// ---- the editing operations, done on the picked faces or edges and on their mirror twins ------------------------------------------------

/// Pulls a face out (or in), or insets it (distance 0), and with an axis the face that mirrors it the same way. Returns every point of the new faces.
export function extrudeFaceSym(c: Cube, face: number, distance: number, shrink: number, axis: Axis | null): { cube: Cube; points: number[] } {
  const faces = axis === null ? [face] : withTwinFaces(c, [face], axis);
  let out = c;
  let points: number[] = [];
  for (const f of faces) {
    const r = extrudeFace(out, f, distance, shrink);
    out = r.cube;
    points.push(...r.points);
  }
  if (faces.length < 2) return { cube: out, points };
  // Two faces that meet along the plane are pulled out as one block: the wall each makes along the shared edge faces the other's, back to back, so both go,
  // and the points that were doubled on the plane are joined.
  const key = (f: { v: number[] }) => f.v.map((i) => out.verts![i]!.map((n) => n.toFixed(3)).join(",")).sort().join("|");
  const seen = new Map<string, number>();
  const doubled: number[] = [];
  for (let i = c.polys!.length; i < out.polys!.length; i++) {
    const k = key(out.polys![i]!);
    const was = seen.get(k);
    if (was === undefined) seen.set(k, i);
    else doubled.push(was, i);
  }
  if (!doubled.length) return { cube: out, points };
  const at = points.map((i) => out.verts![i]!);
  out = weld(deleteFaces(out, doubled), 0.001);
  points = [...new Set(pointsAt(out, at) ?? [])];
  return { cube: out, points };
}

/// A bevel along a chain of points, and with an axis the mirrored chain too. (The first bevel renumbers points, so the twin chain is found again by where it is.)
export function bevelChainSym(c: Cube, chain: number[], fraction: number, segments: number, axis: Axis | null): { cube: Cube; points: number[] } | null {
  const r = bevelChain(c, chain, fraction, segments);
  if (!r || axis === null || !c.verts) return r;
  const twin = twinChain(c, chain, axis);
  if (!twin) return r;
  const again = pointsAt(r.cube, twin.map((i) => c.verts![i]!));
  if (!again) return r;
  const r2 = bevelChain(r.cube, again, fraction, segments);
  if (!r2) return r;
  const first = pointsAt(r2.cube, r.points.map((i) => r.cube.verts![i]!)) ?? [];
  return { cube: r2.cube, points: [...first, ...r2.points] };
}

/// A loop cut through a face, and with an axis the mirrored cut through its twin (unless the ring already went round to it).
export function loopCutThrough(c: Cube, face: number, way: 0 | 1, at: number, axis: Axis | null): { cube: Cube; points: number[] } {
  const r = loopCut(c, face, way, at);
  if (!r.points.length || axis === null) return r;
  const t = twinFace(c, face, axis);
  if (t < 0) return r;
  const w = twinWay(c, face, way, t, axis);
  if (w === null) return r;
  // the twin face is still whole after the first cut (its points, in the same order)? If the ring went round to it, it has been cut already
  const wanted = c.polys![t]!.v.join();
  const left = r.cube.polys!.findIndex((p) => p.v.join() === wanted);
  if (left < 0) return r;
  for (const fraction of at === 0.5 ? [0.5] : [at, 1 - at]) {
    const r2 = loopCut(r.cube, left, w, fraction);
    if (r2.points.length && mirrorsEachOther(r2.cube, r.points, r2.points, axis)) return { cube: r2.cube, points: [...r.points, ...r2.points] };
  }
  return r;
}
