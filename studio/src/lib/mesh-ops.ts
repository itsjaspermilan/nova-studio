// More ways to edit a mesh element, each returning a new element: merge and dissolve points, dissolve an edge, triangulate, smooth, move with a soft
// falloff (proportional editing), snap, bridge two faces, spin and screw a profile, inset, decimate, displace, simple deforms and LOD copies.
// Faces are lists of point numbers, counter-clockwise seen from outside, as in lib/mesh-edit.ts.

import { fitBounds, type Cube, type MeshFace, type Vec3 } from "./model-doc";
import { polyNormal } from "./model-mesh";
import { compact, faceCentre } from "./mesh-edit";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => (len(a) > 1e-12 ? mul(a, 1 / len(a)) : [0, 0, 0]);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function finish(c: Cube): Cube {
  fitBounds(c);
  delete c.rotation;
  return c;
}
const ensure = (c: Cube): Cube => clone(c);

// ---- merge and dissolve ----------------------------------------------------------------------------------

export type MergeAt = "centre" | "first" | "last";

/// Collapses the chosen points into one (at their middle, or at the first or last of them); faces that fall to fewer than three points go.
export function mergeVerts(c: Cube, indices: number[], at: MergeAt = "centre"): { cube: Cube; point: number } | null {
  const out = ensure(c);
  const list = [...new Set(indices)].filter((i) => !!out.verts?.[i]);
  if (list.length < 2) return null;
  const keep = at === "last" ? list[list.length - 1]! : list[0]!;
  if (at === "centre") out.verts![keep] = mul(list.reduce<Vec3>((s, i) => add(s, out.verts![i]!), [0, 0, 0]), 1 / list.length);
  else if (at === "last") out.verts![keep] = [...out.verts![list[list.length - 1]!]!];
  const gone = new Set(list.filter((i) => i !== keep));
  const polys: MeshFace[] = [];
  for (const f of out.polys ?? []) {
    const v: number[] = [];
    for (const i of f.v) {
      const t = gone.has(i) ? keep : i;
      if (v[v.length - 1] !== t) v.push(t);
    }
    if (v.length > 1 && v[0] === v[v.length - 1]) v.pop();
    if (new Set(v).size >= 3 && new Set(v).size === v.length) polys.push({ ...f, v });
  }
  out.polys = polys;
  const { cube, map } = compactKeep(out);
  return { cube, point: map[keep]! };
}

function compactKeep(c: Cube): { cube: Cube; map: number[] } {
  const used = new Set(c.polys!.flatMap((f) => f.v));
  const map = c.verts!.map(() => -1);
  const verts: Vec3[] = [];
  c.verts!.forEach((p, i) => {
    if (used.has(i) || map[i] === -1) {
      // (a point nothing uses is dropped, except that the caller may ask where the merged one went; it maps to -1 then)
    }
    if (used.has(i)) {
      map[i] = verts.length;
      verts.push(p);
    }
  });
  const out = clone(c);
  out.verts = verts;
  out.polys = c.polys!.map((f) => ({ ...f, v: f.v.map((i) => map[i]!) }));
  delete out.creases;
  delete out.seams;
  return { cube: finish(out), map };
}

/// Removes a point and joins the faces round it into one (the mesh keeps its shape; the surface just has one fewer point). Points on the
/// border of the mesh, or where the surrounding faces do not form one ring, are left.
export function dissolveVerts(c: Cube, indices: number[]): Cube {
  let out = ensure(c);
  // highest first, so the numbers of the rest do not shift under us
  for (const v of [...new Set(indices)].sort((a, b) => b - a)) {
    const around = out.polys!.map((f, i) => ({ f, i })).filter(({ f }) => f.v.includes(v));
    if (around.length < 2) continue;
    // the directed edges of the faces that do not touch v
    const next = new Map<number, number>();
    let ok = true;
    for (const { f } of around) {
      const k = f.v.indexOf(v);
      const n = f.v.length;
      const path: number[] = [];
      for (let s = 1; s < n; s++) path.push(f.v[(k + s) % n]!);
      for (let s = 0; s + 1 < path.length; s++) {
        if (next.has(path[s]!)) ok = false;
        next.set(path[s]!, path[s + 1]!);
      }
    }
    if (!ok) continue;
    // each face contributes a path from the vertex after v to the one before v; chain them into one loop
    const starts = around.map(({ f }) => f.v[(f.v.indexOf(v) + 1) % f.v.length]!);
    const ends = around.map(({ f }) => f.v[(f.v.indexOf(v) + f.v.length - 1) % f.v.length]!);
    const startSet = new Set(starts);
    if (!ends.every((e) => startSet.has(e)) || startSet.size !== around.length) continue; // a border point: the ring is not closed
    const link = new Map(ends.map((e, k) => [e, k]));
    const order: number[] = [];
    let k = 0;
    for (let guard = 0; guard <= around.length; guard++) {
      order.push(k);
      const nextFace = starts.findIndex((s) => s === ends[k]);
      if (nextFace < 0) break;
      k = nextFace;
      if (k === order[0]) break;
    }
    void link;
    if (order.length !== around.length) continue;
    const loop: number[] = [];
    for (const idx of order) {
      const f = around[idx]!.f;
      const n = f.v.length;
      const at = f.v.indexOf(v);
      for (let s = 1; s < n - 1; s++) loop.push(f.v[(at + s) % n]!);
      loop.push(f.v[(at + n - 1) % n]!);
    }
    // consecutive faces share the vertex where one's last meets the next's first: drop the repeat
    const clean = loop.filter((p, i) => p !== loop[(i + 1) % loop.length]);
    if (new Set(clean).size !== clean.length || clean.length < 3) continue;
    const drop = new Set(around.map((a) => a.i));
    const merged: MeshFace = { v: clean, ...(around[0]!.f.color ? { color: around[0]!.f.color } : {}), ...(around[0]!.f.smooth ? { smooth: true } : {}) };
    out.polys = [...out.polys!.filter((_, i) => !drop.has(i)), merged];
    out = compact(out);
    // compact renumbers: keep going with the remaining (lower) numbers, which compact keeps in order for numbers below v
  }
  return finish(out);
}

/// Joins the two faces on either side of an edge into one. The edge must have exactly two faces.
export function dissolveEdge(c: Cube, a: number, b: number): Cube | null {
  const out = ensure(c);
  const sharing = out.polys!.map((f, i) => ({ f, i })).filter(({ f }) => f.v.includes(a) && f.v.includes(b) && edgeIn(f.v, a, b));
  if (sharing.length !== 2) return null;
  const [p, q] = [sharing[0]!, sharing[1]!];
  // walk p from b round to a, then q from a round to b: that is the outline of the two together
  const walk = (v: number[], from: number, to: number) => {
    const i = v.indexOf(from);
    const out: number[] = [];
    for (let s = 0; s < v.length; s++) {
      const x = v[(i + s) % v.length]!;
      out.push(x);
      if (x === to) break;
    }
    return out;
  };
  const pi = p.f.v.indexOf(a);
  const forward = p.f.v[(pi + 1) % p.f.v.length] === b;
  const [from, to] = forward ? [b, a] : [a, b];
  const first = walk(p.f.v, from, to); // from..to going the long way round p
  const second = walk(q.f.v, to, from);
  const v = [...first.slice(0, -1), ...second.slice(0, -1)];
  if (new Set(v).size !== v.length || v.length < 3) return null;
  out.polys = [...out.polys!.filter((_, i) => i !== p.i && i !== q.i), { v, ...(p.f.color ? { color: p.f.color } : {}), ...(p.f.smooth ? { smooth: true } : {}) }];
  return finish(out);
}
const edgeIn = (v: number[], a: number, b: number) => v.some((x, k) => (x === a && v[(k + 1) % v.length] === b) || (x === b && v[(k + 1) % v.length] === a));

// ---- triangulate ----------------------------------------------------------------------------------------

/// Splits faces (all of them by default) into triangles by ear clipping, so a concave face is cut correctly.
export function triangulate(c: Cube, faces?: number[]): Cube {
  const out = ensure(c);
  const chosen = new Set(faces ?? out.polys!.map((_, i) => i));
  const polys: MeshFace[] = [];
  out.polys!.forEach((f, i) => {
    if (!chosen.has(i) || f.v.length <= 3) return void polys.push(f);
    for (const tri of earClip(out.verts!, f.v)) polys.push({ ...f, v: tri });
  });
  out.polys = polys;
  return finish(out);
}

function earClip(verts: Vec3[], ring: number[]): number[][] {
  const n = norm(polyNormal(verts, ring));
  const idx = [...ring];
  const tris: number[][] = [];
  const area = (a: number, b: number, c: number) => dot(cross(sub(verts[b]!, verts[a]!), sub(verts[c]!, verts[a]!)), n);
  const inside = (p: number, a: number, b: number, c: number) => area(a, b, p) >= -1e-9 && area(b, c, p) >= -1e-9 && area(c, a, p) >= -1e-9;
  let guard = idx.length * idx.length + 4;
  while (idx.length > 3 && guard-- > 0) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length]!;
      const b = idx[i]!;
      const c = idx[(i + 1) % idx.length]!;
      if (area(a, b, c) <= 1e-12) continue; // a reflex or flat corner is not an ear
      if (idx.some((p) => p !== a && p !== b && p !== c && inside(p, a, b, c))) continue;
      tris.push([a, b, c]);
      idx.splice(i, 1);
      cut = true;
      break;
    }
    if (!cut) break; // a degenerate face: fall back to a fan for what is left
  }
  if (idx.length === 3) tris.push([idx[0]!, idx[1]!, idx[2]!]);
  else for (let i = 1; i + 1 < idx.length; i++) tris.push([idx[0]!, idx[i]!, idx[i + 1]!]);
  return tris;
}

// ---- smoothing and soft moves ---------------------------------------------------------------------

function neighbours(c: Cube): Map<number, Set<number>> {
  const out = new Map<number, Set<number>>();
  for (const f of c.polys ?? []) {
    f.v.forEach((a, k) => {
      const b = f.v[(k + 1) % f.v.length]!;
      (out.get(a) ?? out.set(a, new Set()).get(a)!).add(b);
      (out.get(b) ?? out.set(b, new Set()).get(b)!).add(a);
    });
  }
  return out;
}

/// Points on an edge that only one face uses (the border of an open mesh).
export function borderVerts(c: Cube): Set<number> {
  const count = new Map<string, number>();
  for (const f of c.polys ?? []) f.v.forEach((a, k) => {
    const b = f.v[(k + 1) % f.v.length]!;
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    count.set(key, (count.get(key) ?? 0) + 1);
  });
  const out = new Set<number>();
  for (const [key, n] of count) if (n === 1) for (const x of key.split(",")) out.add(Number(x));
  return out;
}

/// Relaxes the chosen points (all by default) towards the average of their neighbours: `factor` 0 to 1 a pass, `passes` times. Points on an open
/// border stay put unless `border` is true, so a smoothed sheet does not shrink at its edge.
export function smoothVerts(c: Cube, indices?: number[], factor = 0.5, passes = 1, border = false): Cube {
  const out = ensure(c);
  const nb = neighbours(out);
  const fixed = border ? new Set<number>() : borderVerts(out);
  const chosen = new Set(indices ?? out.verts!.map((_, i) => i));
  const f = clamp(factor, 0, 1);
  for (let p = 0; p < Math.max(1, Math.min(50, passes)); p++) {
    const next = out.verts!.map((v) => [...v] as Vec3);
    for (const i of chosen) {
      const around = nb.get(i);
      if (!around?.size || fixed.has(i)) continue;
      const avg = mul([...around].reduce<Vec3>((s, j) => add(s, out.verts![j]!), [0, 0, 0]), 1 / around.size);
      next[i] = add(out.verts![i]!, mul(sub(avg, out.verts![i]!), f));
    }
    out.verts = next;
  }
  return finish(out);
}

export type Falloff = "smooth" | "linear" | "sharp" | "root" | "sphere" | "constant";
export const FALLOFFS: Falloff[] = ["smooth", "linear", "sharp", "root", "sphere", "constant"];

/// How much a point `d` away (as a fraction of the radius, 0 to 1) follows the move.
export function falloffWeight(kind: Falloff, d: number): number {
  const t = clamp(d, 0, 1);
  const x = 1 - t;
  switch (kind) {
    case "linear": return x;
    case "smooth": return x * x * (3 - 2 * x);
    case "sharp": return x * x;
    case "root": return Math.sqrt(x);
    case "sphere": return Math.sqrt(Math.max(0, 1 - t * t));
    case "constant": return t >= 1 ? 0 : 1;
  }
}

/// Moves the chosen points by `delta` and the points near them by less: within `radius` of the nearest chosen point the move fades by the falloff
/// (Blender's proportional editing). With `connected` only points reachable along the mesh's edges within the radius follow.
export function proportionalMove(c: Cube, indices: number[], delta: Vec3, radius: number, falloff: Falloff = "smooth", connected = false): Cube {
  const out = ensure(c);
  const chosen = new Set(indices.filter((i) => !!out.verts?.[i]));
  if (!chosen.size) return out;
  const r = Math.max(1e-6, radius);
  const verts = out.verts!;
  const reach = connected ? connectedDistance(out, chosen, r) : null;
  const next = verts.map((v, i) => {
    if (chosen.has(i)) return add(v, delta);
    let d = Infinity;
    if (reach) d = reach.get(i) ?? Infinity;
    else for (const j of chosen) d = Math.min(d, len(sub(v, verts[j]!)));
    return d >= r ? v : add(v, mul(delta, falloffWeight(falloff, d / r)));
  });
  out.verts = next;
  return finish(out);
}

/// Shortest distance along edges from the chosen points, giving up past `limit`.
function connectedDistance(c: Cube, from: Set<number>, limit: number): Map<number, number> {
  const nb = neighbours(c);
  const dist = new Map<number, number>([...from].map((i) => [i, 0]));
  const queue = [...from];
  while (queue.length) {
    queue.sort((a, b) => dist.get(a)! - dist.get(b)!);
    const i = queue.shift()!;
    for (const j of nb.get(i) ?? []) {
      const d = dist.get(i)! + len(sub(c.verts![j]!, c.verts![i]!));
      if (d < limit && d < (dist.get(j) ?? Infinity)) {
        dist.set(j, d);
        queue.push(j);
      }
    }
  }
  return dist;
}

// ---- snapping ------------------------------------------------------------------------------------

/// A number rounded to the nearest multiple of `step` (a step of 0 or less leaves it).
export const snapTo = (n: number, step: number): number => (step > 0 ? Math.round(n / step) * step : n);

export const snapPoint = (p: Vec3, step: number): Vec3 => [snapTo(p[0], step), snapTo(p[1], step), snapTo(p[2], step)];

/// The nearest of some points when one is within `threshold` of `p` (to snap a dragged point onto another point), else null.
export function nearestPoint(p: Vec3, points: Vec3[], threshold: number): { index: number; point: Vec3 } | null {
  let best = -1;
  let bestD = threshold;
  points.forEach((q, i) => {
    const d = len(sub(p, q));
    if (d <= bestD) (best = i), (bestD = d);
  });
  return best >= 0 ? { index: best, point: points[best]! } : null;
}

// ---- inset, bridge, spin ----------------------------------------------------------------------------------

/// Insets a face: a smaller copy of it, `thickness` units in from the edges (and `depth` along its normal, 0 stays flat), with a ring of faces round it.
/// Returns the inner face's points.
export function insetFace(c: Cube, face: number, thickness: number, depth = 0): { cube: Cube; points: number[] } | null {
  const out = ensure(c);
  const f = out.polys?.[face];
  if (!f || !Number.isFinite(thickness) || thickness <= 0) return null;
  const mid = faceCentre(out, face);
  const n = norm(polyNormal(out.verts!, f.v));
  const old = [...f.v];
  const fresh = old.map((i, k) => {
    const p = out.verts![i]!;
    const prev = out.verts![old[(k + old.length - 1) % old.length]!]!;
    const nextP = out.verts![old[(k + 1) % old.length]!]!;
    // the corner's inward direction: the average of the two edge normals pointing into the face
    const e1 = norm(sub(nextP, p));
    const e2 = norm(sub(prev, p));
    let inward = norm(add(e1, e2));
    if (len(inward) < 1e-9 || dot(inward, sub(mid, p)) < 0) inward = norm(sub(mid, p));
    const half = Math.max(1e-6, Math.sqrt((1 - dot(e1, e2)) / 2)); // sin of half the corner angle
    const reach = Math.min(thickness / half, len(sub(mid, p)) * 0.95);
    return out.verts!.push(add(add(p, mul(inward, reach)), mul(n, depth))) - 1;
  });
  for (let i = 0; i < old.length; i++) {
    const j = (i + 1) % old.length;
    out.polys!.push({ v: [old[i]!, old[j]!, fresh[j]!, fresh[i]!], ...(f.color ? { color: f.color } : {}) });
  }
  f.v = fresh;
  return { cube: finish(out), points: fresh };
}

/// Joins two faces with the same number of points by a ring of quads and removes the two faces (a tunnel between them). The ring is turned to
/// the way that joins nearest points; faces that face each other give a clean tunnel.
export function bridgeFaces(c: Cube, a: number, b: number): Cube | null {
  const out = ensure(c);
  const fa = out.polys?.[a];
  const fb = out.polys?.[b];
  if (!fa || !fb || a === b || fa.v.length !== fb.v.length) return null;
  const n = fa.v.length;
  // b is walked the other way round so the tunnel's faces point outward
  const rb = [...fb.v].reverse();
  let bestShift = 0;
  let bestCost = Infinity;
  for (let s = 0; s < n; s++) {
    let cost = 0;
    for (let k = 0; k < n; k++) cost += len(sub(out.verts![fa.v[k]!]!, out.verts![rb[(k + s) % n]!]!));
    if (cost < bestCost - 1e-9) (bestCost = cost), (bestShift = s);
  }
  const polys: MeshFace[] = out.polys!.filter((_, i) => i !== a && i !== b);
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n;
    polys.push({ v: [fa.v[k]!, fa.v[k2]!, rb[(k2 + bestShift) % n]!, rb[(k + bestShift) % n]!], ...(fa.color ? { color: fa.color } : {}) });
  }
  out.polys = polys;
  return finish(out);
}

/// Turns a chain of points (a profile, in order) round an axis through the origin, `steps` pieces over `angle` degrees, making a face between each
/// pair of neighbouring copies: a lathe. `rise` moves each step along the axis too, for a screw (a thread, a spring). `closed` joins the last copy to the
/// first (for 360 degrees). The chain's own points are kept as the first copy.
export function spinChain(c: Cube, chain: number[], axis: 0 | 1 | 2, angle: number, steps: number, rise = 0): { cube: Cube; points: number[] } | null {
  const out = ensure(c);
  if (chain.length < 2 || !chain.every((i) => !!out.verts?.[i]) || steps < 1) return null;
  const n = Math.min(128, Math.round(steps));
  const full = Math.abs(angle) >= 359.999 && rise === 0;
  const copies = full ? n : n + 1;
  const rot = (p: Vec3, a: number): Vec3 => {
    const [s, co] = [Math.sin(a), Math.cos(a)];
    const [i, j] = axis === 0 ? [1, 2] : axis === 1 ? [2, 0] : [0, 1];
    const q: Vec3 = [...p];
    q[i] = p[i]! * co - p[j]! * s;
    q[j] = p[i]! * s + p[j]! * co;
    return q;
  };
  const ring: number[][] = [chain];
  for (let k = 1; k < copies; k++) {
    const a = ((angle * Math.PI) / 180) * (k / n);
    ring.push(chain.map((i) => {
      const q = rot(out.verts![i]!, a);
      q[axis] += rise * k;
      return out.verts!.push(q) - 1;
    }));
  }
  const pairs = full ? copies : copies - 1;
  for (let k = 0; k < pairs; k++) {
    const A = ring[k]!;
    const B = ring[(k + 1) % copies]!;
    for (let j = 0; j + 1 < chain.length; j++) out.polys!.push({ v: [A[j]!, A[j + 1]!, B[j + 1]!, B[j]!] });
  }
  return { cube: finish(out), points: ring[ring.length - 1]! };
}

// ---- reducing and bending ------------------------------------------------------------------------------

/// A cheaper copy: points are grouped into a grid and each group becomes one point (their average); faces that collapse go. `ratio` (0.05 to 1) is
/// about how many of the points to keep. Quick and good for a LOD of a hard-surface model; it does not look at curvature.
export function decimate(c: Cube, ratio: number): Cube {
  const out = ensure(c);
  const verts = out.verts ?? [];
  if (verts.length < 4 || ratio >= 1) return out;
  const r = clamp(ratio, 0.05, 1);
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const v of verts) for (let k = 0; k < 3; k++) (min[k] = Math.min(min[k]!, v[k]!)), (max[k] = Math.max(max[k]!, v[k]!));
  const size = sub(max, min);
  const volume = Math.max(1e-9, size[0] * size[1] * size[2]);
  // a cell size that gives about `r * count` occupied cells (a rough guess for a surface, tuned by trying)
  let cell = Math.cbrt(volume / Math.max(1, verts.length * r)) * 1.6 || Math.max(...size) / 8;
  let result = cluster(out, min, cell);
  for (let tries = 0; tries < 12; tries++) {
    const have = result.verts!.length / verts.length;
    if (have > r * 1.15) cell *= 1.18;
    else if (have < r * 0.7) cell /= 1.12;
    else break;
    result = cluster(out, min, cell);
  }
  return result;
}

function cluster(c: Cube, min: Vec3, cell: number): Cube {
  const out = clone(c);
  const key = (p: Vec3) => `${Math.floor((p[0] - min[0]) / cell)},${Math.floor((p[1] - min[1]) / cell)},${Math.floor((p[2] - min[2]) / cell)}`;
  const groups = new Map<string, number[]>();
  c.verts!.forEach((p, i) => (groups.get(key(p)) ?? groups.set(key(p), []).get(key(p))!).push(i));
  const target = c.verts!.map(() => 0);
  const verts: Vec3[] = [];
  for (const list of groups.values()) {
    const avg = mul(list.reduce<Vec3>((s, i) => add(s, c.verts![i]!), [0, 0, 0]), 1 / list.length);
    const id = verts.push(avg) - 1;
    for (const i of list) target[i] = id;
  }
  out.verts = verts;
  const polys: MeshFace[] = [];
  for (const f of c.polys!) {
    const v: number[] = [];
    for (const i of f.v) if (v[v.length - 1] !== target[i]) v.push(target[i]!);
    if (v.length > 1 && v[0] === v[v.length - 1]) v.pop();
    if (v.length >= 3 && new Set(v).size === v.length) polys.push({ ...f, v });
  }
  out.polys = polys;
  delete out.creases;
  delete out.seams;
  return compact(finish(out));
}

/// The usual LODs of a mesh: copies kept at each ratio (for example 0.5 and 0.25), most detailed first, with the original as the first entry.
export function lodChain(c: Cube, ratios: number[]): Cube[] {
  return [c, ...ratios.map((r) => decimate(c, r))];
}

/// Pushes every point along its (averaged) normal by a wave of the point's position: a simple way to make rough ground, dents or ripples.
/// `amount` is the height, `scale` the size of the bumps in units, `seed` varies the pattern; the same numbers give the same result.
export function displace(c: Cube, amount: number, scale: number, seed = 1): Cube {
  const out = ensure(c);
  const normals = vertexNormals(out);
  const s = Math.max(1e-3, scale);
  const noise = (p: Vec3) => {
    // a sum of three sines with seed-dependent phases: smooth, bounded to -1..1, cheap and repeatable
    const a = seed * 12.9898;
    return (Math.sin(p[0] / s + a) * Math.sin(p[2] / s + a * 1.7) + 0.5 * Math.sin((p[0] + p[1] * 1.3) / (s * 0.5) + a * 0.3) + 0.25 * Math.sin((p[1] - p[2] * 0.7) / (s * 0.25) + a * 2.1)) / 1.75;
  };
  out.verts = out.verts!.map((p, i) => add(p, mul(normals[i]!, amount * noise(p))));
  return finish(out);
}

/// The average of the unit normals of the faces round each point.
export function vertexNormals(c: Cube): Vec3[] {
  const sums: Vec3[] = (c.verts ?? []).map(() => [0, 0, 0]);
  for (const f of c.polys ?? []) {
    const n = norm(polyNormal(c.verts!, f.v));
    for (const i of f.v) sums[i] = add(sums[i]!, n);
  }
  return sums.map(norm);
}

export type DeformKind = "bend" | "twist" | "taper" | "stretch";
export const DEFORMS: DeformKind[] = ["bend", "twist", "taper", "stretch"];

/// Bends, twists, tapers or stretches the points along an axis (0 x, 1 y, 2 z) between the lowest and highest point. `amount` is degrees for bend
/// and twist (over the whole length), and a fraction for taper (the far end's size change, -1 to 1) and stretch (the far end's push, in units).
export function simpleDeform(c: Cube, kind: DeformKind, axis: 0 | 1 | 2, amount: number): Cube {
  const out = ensure(c);
  const verts = out.verts ?? [];
  if (!verts.length) return out;
  const lo = Math.min(...verts.map((p) => p[axis]));
  const hi = Math.max(...verts.map((p) => p[axis]));
  const span = Math.max(1e-9, hi - lo);
  const [i, j] = axis === 0 ? [1, 2] : axis === 1 ? [2, 0] : [0, 1];
  out.verts = verts.map((p) => {
    const t = (p[axis] - lo) / span;
    const q: Vec3 = [...p];
    if (kind === "twist") {
      const a = (amount * Math.PI / 180) * t;
      q[i] = p[i]! * Math.cos(a) - p[j]! * Math.sin(a);
      q[j] = p[i]! * Math.sin(a) + p[j]! * Math.cos(a);
    } else if (kind === "taper") {
      const k = 1 + amount * t;
      q[i] = p[i]! * k;
      q[j] = p[j]! * k;
    } else if (kind === "stretch") {
      q[axis] = p[axis] + amount * t;
    } else {
      // bend: the axis curves round a circle whose arc is the original length
      const total = (amount * Math.PI) / 180;
      if (Math.abs(total) < 1e-6) return q;
      const radius = span / total;
      const a = total * t;
      const off = p[i]!;
      q[axis] = lo + (radius - off) * Math.sin(a) + 0;
      q[i] = radius - (radius - off) * Math.cos(a) - 0;
    }
    return q;
  });
  return finish(out);
}
