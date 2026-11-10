// More modifiers, each a function on the soup of points and polygons the stack works on (see modifiers.ts): Wireframe, Shrinkwrap (to a sphere, a
// cylinder or a plane) and Lattice (the box round the mesh with its eight corners moved).

import type { MeshFace, Vec3 } from "./model-doc";
import { MAX_FACES, MAX_VERTS } from "./model-doc";
import type { Soup } from "./modifiers";

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => (len(a) > 1e-12 ? mul(a, 1 / len(a)) : [0, 0, 0]);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/// Every edge of the polygons once, as [a, b] with a < b, with the colour of the first polygon that has it.
function edgesOf(s: Soup): { a: number; b: number; color?: string }[] {
  const seen = new Map<string, { a: number; b: number; color?: string }>();
  for (const f of s.polys) {
    for (let k = 0; k < f.v.length; k++) {
      const p = f.v[k]!;
      const q = f.v[(k + 1) % f.v.length]!;
      const a = Math.min(p, q);
      const b = Math.max(p, q);
      const key = `${a},${b}`;
      if (!seen.has(key)) seen.set(key, { a, b, ...(f.color ? { color: f.color } : {}) });
    }
  }
  return [...seen.values()];
}

/// Replaces every edge by a thin four-sided bar `thickness` wide (the bars stand on the edge, so the frame keeps the mesh's outline). The faces go.
/// Stops adding bars at the model's limit on points and faces.
export function wireframe(s: Soup, thickness: number): Soup {
  const half = Math.max(0.001, thickness) / 2;
  const verts: Vec3[] = [];
  const polys: MeshFace[] = [];
  for (const e of edgesOf(s)) {
    if (verts.length + 8 > MAX_VERTS || polys.length + 6 > MAX_FACES) break;
    const p = s.verts[e.a]!;
    const q = s.verts[e.b]!;
    const dir = unit(sub(q, p));
    if (len(dir) === 0) continue;
    const helper: Vec3 = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = mul(unit(cross(dir, helper)), half);
    const w = mul(unit(cross(dir, u)), half);
    const corners: Vec3[] = [add(u, w), sub(w, u), sub(mul(add(u, w), -1), [0, 0, 0]), sub(u, w)];
    const base = verts.length;
    for (const end of [p, q]) for (const c of corners) verts.push(add(end, c));
    const face = (v: number[]): MeshFace => ({ v, ...(e.color ? { color: e.color } : {}) });
    // sides (wound outwards), then the two caps
    for (let k = 0; k < 4; k++) polys.push(face([base + k, base + (k + 1) % 4, base + 4 + (k + 1) % 4, base + 4 + k]));
    polys.push(face([base + 3, base + 2, base + 1, base]));
    polys.push(face([base + 4, base + 5, base + 6, base + 7]));
  }
  return { verts, polys };
}

export type WrapKind = "sphere" | "cylinder" | "plane";
export const WRAP_KINDS: WrapKind[] = ["sphere", "cylinder", "plane"];

/// The centre of the box round the points.
function centreOf(verts: Vec3[]): Vec3 {
  if (!verts.length) return [0, 0, 0];
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const v of verts) for (let i = 0; i < 3; i++) {
    lo[i] = Math.min(lo[i]!, v[i]!);
    hi[i] = Math.max(hi[i]!, v[i]!);
  }
  return [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
}

/// Moves the points onto a sphere or a cylinder (round `axis`) centred on the mesh, with `radius` (0: the average distance now), or flattens them onto a plane
/// through the centre across `axis`. `factor` 0 leaves the mesh as it is and 1 puts every point on the shape.
export function shrinkwrap(s: Soup, kind: WrapKind, axis: 0 | 1 | 2, factor: number, radius: number): Soup {
  const f = clamp(factor, 0, 1);
  const c = centreOf(s.verts);
  const away = (p: Vec3): Vec3 => {
    const d = sub(p, c);
    if (kind === "cylinder") d[axis] = 0;
    return d;
  };
  let r = radius;
  if (kind !== "plane" && !(r > 0)) {
    const ds = s.verts.map((p) => len(away(p)));
    r = ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : 1;
  }
  const verts = s.verts.map((p) => {
    let target: Vec3;
    if (kind === "plane") {
      target = [...p] as Vec3;
      target[axis] = c[axis]!;
    } else {
      const d = away(p);
      const l = len(d);
      // a point on the axis (or at the centre) has no direction: it stays
      if (l < 1e-9) return [...p] as Vec3;
      const onShape = add(c, mul(d, r / l));
      target = [...p] as Vec3;
      for (let i = 0; i < 3; i++) if (kind === "sphere" || i !== axis) target[i] = onShape[i]!;
    }
    return add(mul(p, 1 - f), mul(target, f));
  });
  return { ...s, verts };
}

/// The offsets of the eight corners of the box round the mesh: corner `i` is at x = i & 1, y = (i >> 1) & 1, z = (i >> 2) & 1 (0 low, 1 high).
export type LatticeCorners = [Vec3, Vec3, Vec3, Vec3, Vec3, Vec3, Vec3, Vec3];
export const ZERO_LATTICE = (): LatticeCorners => Array.from({ length: 8 }, () => [0, 0, 0] as Vec3) as LatticeCorners;

/// Moves every point by the blend of the eight corner offsets for where it sits in the box round the mesh (trilinear): move the top corners to lean, spread the
/// bottom ones to flare. A flat mesh (no extent along an axis) is blended by the low corners on that axis.
export function lattice(s: Soup, corners: LatticeCorners): Soup {
  if (!s.verts.length) return s;
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const v of s.verts) for (let i = 0; i < 3; i++) {
    lo[i] = Math.min(lo[i]!, v[i]!);
    hi[i] = Math.max(hi[i]!, v[i]!);
  }
  const verts = s.verts.map((p) => {
    const t = [0, 1, 2].map((i) => (hi[i]! - lo[i]! > 1e-9 ? (p[i]! - lo[i]!) / (hi[i]! - lo[i]!) : 0));
    let out: Vec3 = [...p] as Vec3;
    for (let k = 0; k < 8; k++) {
      const w = ((k & 1 ? t[0]! : 1 - t[0]!) * (k & 2 ? t[1]! : 1 - t[1]!) * (k & 4 ? t[2]! : 1 - t[2]!));
      out = add(out, mul(corners[k]!, w));
    }
    return out;
  });
  return { ...s, verts };
}

/// Blocky remesh: the mesh (which must be a closed solid) is cut into cubes `voxel` on a side, and the surface of the cubes that are inside it becomes the new mesh,
/// one square per exposed cube face, wound outwards. Point order inside the mesh is by crossing parity of a ray along +x, so thin gaps and open meshes give ragged results.
/// At most `limit` cubes along the longest side (the voxel grows to fit).
export function remeshBlocks(s: Soup, voxel: number, limit = 64): Soup {
  if (!s.verts.length || !s.polys.length) return s;
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const v of s.verts) for (let i = 0; i < 3; i++) {
    lo[i] = Math.min(lo[i]!, v[i]!);
    hi[i] = Math.max(hi[i]!, v[i]!);
  }
  const longest = Math.max(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!, 1e-6);
  const size = Math.max(voxel, longest / limit, 1e-4);
  const n: [number, number, number] = [Math.max(1, Math.ceil((hi[0]! - lo[0]!) / size)), Math.max(1, Math.ceil((hi[1]! - lo[1]!) / size)), Math.max(1, Math.ceil((hi[2]! - lo[2]!) / size))];
  // triangles (fan of each polygon)
  const tris: [Vec3, Vec3, Vec3][] = [];
  for (const f of s.polys) for (let k = 1; k + 1 < f.v.length; k++) tris.push([s.verts[f.v[0]!]!, s.verts[f.v[k]!]!, s.verts[f.v[k + 1]!]!]);
  const inside = new Uint8Array(n[0] * n[1] * n[2]);
  const at = (x: number, y: number, z: number) => (x < 0 || y < 0 || z < 0 || x >= n[0] || y >= n[1] || z >= n[2] ? 0 : inside[(z * n[1] + y) * n[0] + x]!);
  // for each row of cells (y, z) cast one ray along +x from far left and mark the cells between an odd and an even crossing
  for (let z = 0; z < n[2]; z++) {
    for (let y = 0; y < n[1]; y++) {
      const py = lo[1]! + (y + 0.5) * size + 1e-7; // a hair off so the ray does not run along an edge
      const pz = lo[2]! + (z + 0.5) * size + 1.3e-7;
      const xs: number[] = [];
      for (const [a, b, c] of tris) {
        // the triangle's crossing of the line (any x, py, pz): barycentric in the (y, z) plane
        const d = (b[1] - c[1]) * (a[2] - c[2]) + (c[2] - b[2]) * (a[1] - c[1]);
        if (Math.abs(d) < 1e-12) continue;
        const l1 = ((b[1] - c[1]) * (pz - c[2]) + (c[2] - b[2]) * (py - c[1])) / d;
        const l2 = ((c[1] - a[1]) * (pz - c[2]) + (a[2] - c[2]) * (py - c[1])) / d;
        const l3 = 1 - l1 - l2;
        if (l1 < 0 || l2 < 0 || l3 < 0) continue;
        xs.push(l1 * a[0] + l2 * b[0] + l3 * c[0]);
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const from = Math.max(0, Math.ceil((xs[i]! - lo[0]!) / size - 0.5));
        const to = Math.min(n[0] - 1, Math.floor((xs[i + 1]! - lo[0]!) / size - 0.5));
        for (let x = from; x <= to; x++) inside[(z * n[1] + y) * n[0] + x] = 1;
      }
    }
  }
  const verts: Vec3[] = [];
  const index = new Map<string, number>();
  const corner = (x: number, y: number, z: number) => {
    const key = `${x},${y},${z}`;
    let i = index.get(key);
    if (i === undefined) {
      i = verts.push([lo[0]! + x * size, lo[1]! + y * size, lo[2]! + z * size]) - 1;
      index.set(key, i);
    }
    return i;
  };
  const polys: MeshFace[] = [];
  const color = s.polys[0]?.color;
  const quad = (a: [number, number, number], b: [number, number, number], c: [number, number, number], d: [number, number, number]) =>
    polys.push({ v: [corner(...a), corner(...b), corner(...c), corner(...d)], ...(color ? { color } : {}) });
  for (let z = 0; z < n[2]; z++) for (let y = 0; y < n[1]; y++) for (let x = 0; x < n[0]; x++) {
    if (!at(x, y, z)) continue;
    if (!at(x - 1, y, z)) quad([x, y, z], [x, y, z + 1], [x, y + 1, z + 1], [x, y + 1, z]);
    if (!at(x + 1, y, z)) quad([x + 1, y, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x + 1, y, z + 1]);
    if (!at(x, y - 1, z)) quad([x, y, z], [x + 1, y, z], [x + 1, y, z + 1], [x, y, z + 1]);
    if (!at(x, y + 1, z)) quad([x, y + 1, z], [x, y + 1, z + 1], [x + 1, y + 1, z + 1], [x + 1, y + 1, z]);
    if (!at(x, y, z - 1)) quad([x, y, z], [x, y + 1, z], [x + 1, y + 1, z], [x + 1, y, z]);
    if (!at(x, y, z + 1)) quad([x, y, z + 1], [x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]);
  }
  return { verts, polys };
}

/// Bends the mesh along a curve: the mesh's extent along `axis` is laid along the path (a smooth Catmull-Rom curve through `points`, in the mesh's own units), and what
/// is off the axis keeps its distance from it, measured across the path (the path's "up" is +y, or +z when the path runs along y). A path of fewer than two points
/// leaves the mesh alone. The mesh starts at the first point and its length is spread along the path by arc length.
export function curveDeform(s: Soup, points: Vec3[], axis: 0 | 1 | 2): Soup {
  if (points.length < 2 || !s.verts.length) return s;
  // sample the path into a fine polyline with cumulative lengths
  const P = (i: number) => points[Math.max(0, Math.min(points.length - 1, i))]!;
  const poly: Vec3[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    for (let k = 0; k < 24; k++) {
      const t = k / 24;
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      poly.push([0, 1, 2].map((a) => 0.5 * (2 * p1[a]! + (p2[a]! - p0[a]!) * t + (2 * p0[a]! - 5 * p1[a]! + 4 * p2[a]! - p3[a]!) * t * t + (3 * p1[a]! - p0[a]! - 3 * p2[a]! + p3[a]!) * t ** 3)) as Vec3);
    }
  }
  poly.push([...points[points.length - 1]!] as Vec3);
  const cum = [0];
  for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1]! + len(sub(poly[i]!, poly[i - 1]!)));
  const total = cum[cum.length - 1]!;
  if (total < 1e-9) return s;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of s.verts) {
    lo = Math.min(lo, v[axis]!);
    hi = Math.max(hi, v[axis]!);
  }
  const span = Math.max(1e-9, hi - lo);
  const others = ([0, 1, 2] as const).filter((a) => a !== axis) as [0 | 1 | 2, 0 | 1 | 2];
  const at = (dist: number): { pos: Vec3; tangent: Vec3 } => {
    const d = Math.min(total, Math.max(0, dist));
    let i = 1;
    while (i < cum.length - 1 && cum[i]! < d) i++;
    const seg = Math.max(1e-12, cum[i]! - cum[i - 1]!);
    const f = (d - cum[i - 1]!) / seg;
    return { pos: lerpV(poly[i - 1]!, poly[i]!, f), tangent: unit(sub(poly[i]!, poly[i - 1]!)) };
  };
  const verts = s.verts.map((v) => {
    const { pos, tangent } = at(((v[axis]! - lo) / span) * total);
    // a frame across the path: `up` perpendicular to the tangent, `side` completing it
    const ref: Vec3 = Math.abs(tangent[1]) < 0.95 ? [0, 1, 0] : [0, 0, 1];
    const side = unit(cross(tangent, ref));
    const up = cross(side, tangent);
    // the first of the mesh's other axes lies along `up`, the second along `side` (so a mesh built along x with height y and depth z keeps its height as height)
    return add(add(pos, mul(up, v[others[0]]!)), mul(side, v[others[1]]!));
  });
  return { ...s, verts };
}
const lerpV = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
