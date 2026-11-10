// A tube swept along a path: a circle of `sides` points carried along a smooth curve through the given points, with caps at both ends. Good for pipes, cables, branches, rails.

import type { Cube, MeshFace, Vec3 } from "./model-doc";

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

export const MAX_TUBE_POINTS = 16;

/// Reads "x,y,z; x,y,z; ..." (or one point per line) into points. Returns null when a point is not three numbers or fewer than two points are given.
export function parsePath(text: string): V[] | null {
  const pts = text.split(/[;\n]/).map((s) => s.trim()).filter(Boolean).map((s) => s.split(/[\s,]+/).map(Number));
  if (pts.length < 2 || pts.length > MAX_TUBE_POINTS || !pts.every((p) => p.length === 3 && p.every(Number.isFinite))) return null;
  return pts as V[];
}

/// The tube as a mesh element. `perSegment` rings are placed between each pair of path points (Catmull-Rom through the points). The circle is kept from twisting by carrying its
/// frame along the path (parallel transport). Faces are wound outwards; the end caps are fans.
export function sweepTube(points: V[], radius: number, sides = 8, perSegment = 6, color = "#c9d1d9"): Cube | null {
  if (points.length < 2 || points.length > MAX_TUBE_POINTS) return null;
  const n = Math.max(3, Math.min(32, Math.round(sides)));
  const r = Math.max(0.01, radius);
  // the centre line
  const P = (i: number) => points[Math.max(0, Math.min(points.length - 1, i))]!;
  const line: V[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    for (let k = 0; k < perSegment; k++) {
      const t = k / perSegment;
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      line.push([0, 1, 2].map((a) => 0.5 * (2 * p1[a]! + (p2[a]! - p0[a]!) * t + (2 * p0[a]! - 5 * p1[a]! + 4 * p2[a]! - p3[a]!) * t * t + (3 * p1[a]! - p0[a]! - 3 * p2[a]! + p3[a]!) * t ** 3)) as V);
    }
  }
  line.push([...points[points.length - 1]!] as V);
  // tangents, then a frame carried along
  const tangent = line.map((p, i) => unit(sub(line[Math.min(line.length - 1, i + 1)]!, line[Math.max(0, i - 1)]!)));
  if (tangent.every((t) => t[0] === 0 && t[1] === 0 && t[2] === 0)) return null;
  let normal: V = Math.abs(tangent[0]![1]) < 0.9 ? unit(cross(tangent[0]!, [0, 1, 0])) : unit(cross(tangent[0]!, [1, 0, 0]));
  const verts: V[] = [];
  const polys: MeshFace[] = [];
  line.forEach((p, i) => {
    if (i > 0) {
      // parallel transport: take the previous normal off the new tangent's direction
      const t = tangent[i]!;
      normal = unit(sub(normal, mul(t, dot(normal, t))));
    }
    const binormal = cross(tangent[i]!, normal);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      verts.push(add(p, add(mul(normal, Math.cos(a) * r), mul(binormal, Math.sin(a) * r))));
    }
  });
  for (let i = 0; i < line.length - 1; i++) {
    for (let k = 0; k < n; k++) {
      const a = i * n + k, b = i * n + ((k + 1) % n), c = (i + 1) * n + ((k + 1) % n), d = (i + 1) * n + k;
      polys.push({ v: [a, d, c, b], smooth: true });
    }
  }
  // caps: a point in the middle of each end and a fan
  const startCentre = verts.push([...line[0]!] as V) - 1;
  const endCentre = verts.push([...line[line.length - 1]!] as V) - 1;
  const last = (line.length - 1) * n;
  for (let k = 0; k < n; k++) {
    polys.push({ v: [startCentre, k, (k + 1) % n] });
    polys.push({ v: [endCentre, last + ((k + 1) % n), last + k] });
  }
  // (the rings were wound the other way round: turn every face over so they face outwards)
  for (const f of polys) f.v.reverse();
  const xs = verts.map((p) => p[0]), ys = verts.map((p) => p[1]), zs = verts.map((p) => p[2]);
  const from: V = [Math.min(...xs), Math.min(...ys), Math.min(...zs)];
  return { name: "tube", shape: "mesh", from, size: [Math.max(...xs) - from[0], Math.max(...ys) - from[1], Math.max(...zs) - from[2]], color, verts, polys };
}
