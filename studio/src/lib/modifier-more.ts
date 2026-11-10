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
