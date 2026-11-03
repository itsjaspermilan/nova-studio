// Turns the solids of a model (boxes, wedges, round shapes, free meshes) into triangles. The 3D view and the
// .glb exporter both use this, so what you see is what the game gets.
//
// Every solid is first described as points and flat polygons (counter-clockwise seen from outside); drawing
// then gives each polygon its own vertices, so edges stay crisp unless a polygon asks for smooth shading.

import { DEFAULT_SEGMENTS, MAX_SEGMENTS, MIN_SEGMENTS, faceColor, hexToRgba, type Cube, type Face, type Vec3 } from "./model-doc";

/// Which corner of the box (0 = minimum, 1 = maximum on x, y, z) each face's four vertices are, counter-clockwise seen from outside.
export const FACE_CORNERS: Record<Face, { normal: Vec3; corners: [number, number, number][] }> = {
  east: { normal: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  west: { normal: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  up: { normal: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  down: { normal: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  south: { normal: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  north: { normal: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
};
const FACE_ORDER: Face[] = ["east", "west", "up", "down", "south", "north"];

export interface Poly {
  v: number[];
  /// The box face whose colour this polygon takes, if any; otherwise the element's colour.
  face?: Face;
  /// An explicit colour (mesh polygons).
  color?: string;
  smooth?: boolean;
}

export interface Solid {
  verts: Vec3[];
  polys: Poly[];
}

export interface Mesh {
  positions: number[];
  normals: number[];
  colors: number[];
  indices: number[];
  /// Which polygon of the solid each triangle belongs to.
  polyOfTriangle: number[];
}

export const segmentsOf = (c: Cube) => Math.min(MAX_SEGMENTS, Math.max(MIN_SEGMENTS, Math.round(c.segments ?? DEFAULT_SEGMENTS)));

/// Faces whose colour a shape uses, in the order the inspector lists them.
export function shapeFaces(shape: Cube["shape"]): Face[] {
  switch (shape ?? "box") {
    case "box": return ["east", "west", "up", "down", "south", "north"];
    case "wedge": return ["up", "down", "north", "east", "west"];
    case "pyramid": return ["down", "north", "south", "east", "west"];
    case "cylinder": return ["up", "down"];
    case "cone": return ["down"];
    default: return [];
  }
}

const cornerIndex = (c: [number, number, number]) => c[0] | (c[1] << 1) | (c[2] << 2);

/// The shape in a unit box (0 to 1 on every axis).
function unitSolid(c: Cube): Solid {
  const shape = c.shape ?? "box";
  const n = segmentsOf(c);
  const smooth = c.smooth !== false;
  const box: Vec3[] = Array.from({ length: 8 }, (_, i) => [i & 1, (i >> 1) & 1, (i >> 2) & 1] as Vec3);
  const face = (f: Face, drop?: Vec3): Poly => ({
    face: f,
    v: FACE_CORNERS[f].corners.filter((k) => !drop || k[0] !== drop[0] || k[1] !== drop[1] || k[2] !== drop[2]).map(cornerIndex),
  });
  if (shape === "box") return { verts: box, polys: FACE_ORDER.map((f) => face(f)) };
  if (shape === "wedge") {
    // Full height at the back (north), sloping down to nothing at the front (south). The slope counts as "up".
    const front = (f: Face) => face(f, [f === "east" ? 1 : 0, 1, 1]);
    const ci = cornerIndex;
    return {
      verts: box,
      polys: [
        { face: "up", v: [ci([0, 0, 1]), ci([1, 0, 1]), ci([1, 1, 0]), ci([0, 1, 0])] },
        face("down"),
        face("north"),
        front("east"),
        front("west"),
      ],
    };
  }
  if (shape === "pyramid") {
    const apex = 8;
    const verts = [...box, [0.5, 1, 0.5] as Vec3];
    const base = (f: Face): Poly => {
      const [a, b] = FACE_CORNERS[f].corners.filter((k) => k[1] === 0).map(cornerIndex);
      return { face: f, v: [a!, b!, apex] };
    };
    return { verts, polys: [face("down"), base("south"), base("east"), base("north"), base("west")] };
  }
  // Round shapes stand on y. Ring points go round with the angle growing from +x towards +z.
  const ring = (y: number, r: number) => Array.from({ length: n }, (_, i) => [0.5 + r * Math.cos((2 * Math.PI * i) / n), y, 0.5 + r * Math.sin((2 * Math.PI * i) / n)] as Vec3);
  const next = (i: number) => (i + 1) % n;
  if (shape === "cylinder") {
    const verts = [...ring(0, 0.5), ...ring(1, 0.5)];
    const polys: Poly[] = [];
    for (let i = 0; i < n; i++) polys.push({ smooth, v: [i, n + i, n + next(i), next(i)] });
    polys.push({ face: "up", v: Array.from({ length: n }, (_, i) => n + n - 1 - i) });
    polys.push({ face: "down", v: Array.from({ length: n }, (_, i) => i) });
    return { verts, polys };
  }
  if (shape === "cone") {
    const verts = [...ring(0, 0.5), [0.5, 1, 0.5] as Vec3];
    const polys: Poly[] = [];
    for (let i = 0; i < n; i++) polys.push({ smooth, v: [i, n, next(i)] });
    polys.push({ face: "down", v: Array.from({ length: n }, (_, i) => i) });
    return { verts, polys };
  }
  // sphere: poles, then rings of points between them
  const rings = Math.max(2, Math.round(n / 2));
  const verts: Vec3[] = [[0.5, 1, 0.5], [0.5, 0, 0.5]];
  for (let r = 1; r < rings; r++) {
    const theta = (Math.PI * r) / rings;
    verts.push(...ring(0.5 + 0.5 * Math.cos(theta), 0.5 * Math.sin(theta)));
  }
  const at = (r: number, i: number) => 2 + (r - 1) * n + (i % n);
  const polys: Poly[] = [];
  for (let i = 0; i < n; i++) polys.push({ smooth, v: [0, at(1, i + 1), at(1, i)] });
  for (let r = 1; r < rings - 1; r++) for (let i = 0; i < n; i++) polys.push({ smooth, v: [at(r, i), at(r, i + 1), at(r + 1, i + 1), at(r + 1, i)] });
  for (let i = 0; i < n; i++) polys.push({ smooth, v: [1, at(rings - 1, i), at(rings - 1, i + 1)] });
  return { verts, polys };
}

/// Euler angles in degrees, X then Y then Z (three.js's "XYZ"), as a row-major 3x3 matrix.
export function rotationMatrix(deg: Vec3): number[] {
  const [x, y, z] = deg.map((d) => (d * Math.PI) / 180) as Vec3;
  const [sx, cx, sy, cy, sz, cz] = [Math.sin(x), Math.cos(x), Math.sin(y), Math.cos(y), Math.sin(z), Math.cos(z)];
  return [cy * cz, -cy * sz, sy, cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy, sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy];
}
const apply = (m: number[], p: Vec3): Vec3 => [m[0]! * p[0] + m[1]! * p[1] + m[2]! * p[2], m[3]! * p[0] + m[4]! * p[1] + m[5]! * p[2], m[6]! * p[0] + m[7]! * p[1] + m[8]! * p[2]];

/// The element as points and polygons in its part's space: scaled to its box and turned about the box's centre.
export function solidOf(c: Cube): Solid {
  if (c.shape === "mesh") {
    return { verts: (c.verts ?? []).map((p) => [...p] as Vec3), polys: (c.polys ?? []).map((f) => ({ v: [...f.v], color: f.color ?? c.color, smooth: f.smooth })) };
  }
  const solid = unitSolid(c);
  const centre: Vec3 = [c.from[0] + c.size[0] / 2, c.from[1] + c.size[1] / 2, c.from[2] + c.size[2] / 2];
  const turn = c.rotation?.some((n) => n !== 0) ? rotationMatrix(c.rotation) : null;
  solid.verts = solid.verts.map((u) => {
    const local: Vec3 = [(u[0] - 0.5) * c.size[0], (u[1] - 0.5) * c.size[1], (u[2] - 0.5) * c.size[2]];
    const r = turn ? apply(turn, local) : local;
    return [centre[0] + r[0], centre[1] + r[1], centre[2] + r[2]];
  });
  return solid;
}

/// Area-weighted normal of a polygon (Newell's method); zero for a degenerate one.
export function polyNormal(verts: Vec3[], v: number[]): Vec3 {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < v.length; i++) {
    const a = verts[v[i]!]!;
    const b = verts[v[(i + 1) % v.length]!]!;
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [nx, ny, nz];
}

const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-12 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 1, 0];
};

/// Whether the element draws anything (a flat box or an empty mesh does not).
export function hasVolume(c: Cube): boolean {
  if (c.shape === "mesh") return (c.polys ?? []).some((f) => f.v.length >= 3);
  return c.size.every((s) => s > 0);
}

export function meshOf(c: Cube, scale = 1): Mesh {
  const m: Mesh = { positions: [], normals: [], colors: [], indices: [], polyOfTriangle: [] };
  if (!hasVolume(c)) return m;
  const solid = solidOf(c);
  // Smooth polygons share the averaged normal of the smooth polygons around each point.
  const smoothNormals = new Map<number, Vec3>();
  for (const poly of solid.polys) {
    if (!poly.smooth) continue;
    const n = polyNormal(solid.verts, poly.v);
    for (const i of poly.v) {
      const sum = smoothNormals.get(i) ?? [0, 0, 0];
      smoothNormals.set(i, [sum[0] + n[0], sum[1] + n[1], sum[2] + n[2]]);
    }
  }
  solid.polys.forEach((poly, pi) => {
    const flat = unit(polyNormal(solid.verts, poly.v));
    const rgba = hexToRgba(poly.color ?? (poly.face ? faceColor(c, poly.face) : c.color));
    const base = m.positions.length / 3;
    for (const i of poly.v) {
      const p = solid.verts[i]!;
      m.positions.push(p[0] * scale, p[1] * scale, p[2] * scale);
      m.normals.push(...(poly.smooth ? unit(smoothNormals.get(i)!) : flat));
      m.colors.push(...rgba);
    }
    for (let k = 1; k + 1 < poly.v.length; k++) {
      m.indices.push(base, base + k, base + k + 1);
      m.polyOfTriangle.push(pi);
    }
  });
  return m;
}

/// Six times the volume enclosed by the element's triangles; positive when they wind outwards.
export function signedVolume(c: Cube): number {
  const m = meshOf(c);
  let total = 0;
  for (let i = 0; i < m.indices.length; i += 3) {
    const p = [0, 1, 2].map((k) => m.indices[i + k]! * 3).map((o) => [m.positions[o]!, m.positions[o + 1]!, m.positions[o + 2]!]) as Vec3[];
    const [a, b, d] = p as [Vec3, Vec3, Vec3];
    total += a[0] * (b[1] * d[2] - b[2] * d[1]) - a[1] * (b[0] * d[2] - b[2] * d[0]) + a[2] * (b[0] * d[1] - b[1] * d[0]);
  }
  return total;
}
