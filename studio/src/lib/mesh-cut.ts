// The knife as a free cut: a plane through two points (and the way the camera looks) cuts every face it crosses between those points. Pure function on a mesh element.

import { toMesh } from "./mesh-edit";
import type { Cube, Vec3 } from "./model-doc";

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/// Cuts the mesh with the plane that holds the line from `p0` to `p1` and the direction `view` (the way the camera looks). Faces the plane crosses between the two
/// points are split in two along the cut; edges cut on the way get a new point that the faces beside them share. Returns the new mesh element and how many faces were cut
/// (the same mesh and 0 when the points, the view or the faces leave nothing to cut).
export function knifeCut(source: Cube, p0: Vec3, p1: Vec3, view: Vec3, eps = 1e-6): { cube: Cube; cut: number; points: number[] } {
  const c = toMesh(source);
  const line = sub(p1, p0);
  const len2 = dot(line, line);
  const normal = cross(line, view);
  const nl = Math.hypot(...normal);
  if (len2 < 1e-12 || nl < 1e-9) return { cube: c, cut: 0, points: [] };
  const n: Vec3 = [normal[0] / nl, normal[1] / nl, normal[2] / nl];
  const out: Cube = JSON.parse(JSON.stringify(c));
  const verts = out.verts!;
  const dist = verts.map((p) => dot(sub(p, p0), n));
  const along = (p: Vec3) => dot(sub(p, p0), line) / len2;
  const inSpan = (p: Vec3) => along(p) >= -1e-6 && along(p) <= 1 + 1e-6;
  const edgePoint = new Map<string, number>();
  const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  const crossing = (a: number, b: number): number | null => {
    const da = dist[a]!;
    const db = dist[b]!;
    if (!((da > eps && db < -eps) || (da < -eps && db > eps))) return null;
    const k = key(a, b);
    const had = edgePoint.get(k);
    if (had !== undefined) return had;
    const t = da / (da - db);
    const p: Vec3 = [verts[a]![0] + (verts[b]![0] - verts[a]![0]) * t, verts[a]![1] + (verts[b]![1] - verts[a]![1]) * t, verts[a]![2] + (verts[b]![2] - verts[a]![2]) * t];
    if (!inSpan(p)) return null;
    verts.push(p);
    dist.push(0);
    edgePoint.set(k, verts.length - 1);
    return verts.length - 1;
  };
  const polys: NonNullable<Cube["polys"]> = [];
  let cut = 0;
  const cutPoints = new Set<number>();
  for (const f of out.polys ?? []) {
    // the loop with the cut points put in, and which of its places are on the plane (inside the span)
    const loop: number[] = [];
    const onPlane: boolean[] = [];
    f.v.forEach((a, k) => {
      const b = f.v[(k + 1) % f.v.length]!;
      loop.push(a);
      onPlane.push(Math.abs(dist[a]!) <= eps && inSpan(verts[a]!));
      const m = crossing(a, b);
      if (m !== null) {
        loop.push(m);
        onPlane.push(true);
      }
    });
    const marks = loop.map((_, i) => i).filter((i) => onPlane[i]);
    const [i, j] = marks.length === 2 ? [marks[0]!, marks[1]!] : [-1, -1];
    if (i >= 0 && j - i > 1 && !(i === 0 && j === loop.length - 1)) {
      polys.push({ ...f, v: loop.slice(i, j + 1) }, { ...f, v: [...loop.slice(j), ...loop.slice(0, i + 1)] });
      cut++;
      cutPoints.add(loop[i]!);
      cutPoints.add(loop[j]!);
    } else polys.push({ ...f, v: loop });
  }
  out.polys = polys;
  return cut ? { cube: out, cut, points: [...cutPoints] } : { cube: c, cut: 0, points: [] };
}
