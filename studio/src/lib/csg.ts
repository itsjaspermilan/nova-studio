// Solid geometry on meshes: union, difference and intersection of two closed solids, by splitting polygons with binary space partition trees (the method of
// the csg.js library by Evan Wallace, MIT licence; this is a fresh implementation of the same idea, not a copy). Both inputs must be closed and consistently wound
// (a polygon's points go anticlockwise seen from outside); open or self-crossing meshes give a ragged result.

import type { MeshFace, Vec3 } from "./model-doc";

type V = Vec3;
const EPS = 1e-5;
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp = (a: V, b: V, t: number): V => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const unit = (a: V): V => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};

/// A flat piece of surface: its corners (convex, in order), and what the source face had (colour, smooth).
export interface Piece {
  v: V[];
  color?: string;
  smooth?: boolean;
}

interface Plane {
  n: V;
  w: number;
}
const planeOf = (p: Piece): Plane | null => {
  // (a robust normal for a convex polygon: the sum of cross products round it)
  let n: V = [0, 0, 0];
  for (let i = 0; i < p.v.length; i++) {
    const a = p.v[i]!;
    const b = p.v[(i + 1) % p.v.length]!;
    n = [n[0] + (a[1] - b[1]) * (a[2] + b[2]), n[1] + (a[2] - b[2]) * (a[0] + b[0]), n[2] + (a[0] - b[0]) * (a[1] + b[1])];
  }
  const u = unit(n);
  if (u[0] === 0 && u[1] === 0 && u[2] === 0) return null;
  return { n: u, w: dot(u, p.v[0]!) };
};

/// Cuts `piece` by the plane into the four buckets: in front, behind, and lying in the plane facing the same way or the opposite way.
function split(plane: Plane, piece: Piece, coFront: Piece[], coBack: Piece[], front: Piece[], back: Piece[]) {
  const types: number[] = piece.v.map((p) => {
    const t = dot(plane.n, p) - plane.w;
    return t < -EPS ? 2 : t > EPS ? 1 : 0; // 2 behind, 1 in front, 0 on the plane
  });
  const kind = types.reduce((a, b) => a | b, 0);
  const own = planeOf(piece);
  const meta = { ...(piece.color ? { color: piece.color } : {}), ...(piece.smooth ? { smooth: true } : {}) };
  if (kind === 0) (own && dot(plane.n, own.n) > 0 ? coFront : coBack).push(piece);
  else if (kind === 1) front.push(piece);
  else if (kind === 2) back.push(piece);
  else {
    const f: V[] = [];
    const b: V[] = [];
    for (let i = 0; i < piece.v.length; i++) {
      const j = (i + 1) % piece.v.length;
      const ti = types[i]!;
      const tj = types[j]!;
      const vi = piece.v[i]!;
      const vj = piece.v[j]!;
      if (ti !== 2) f.push(vi);
      if (ti !== 1) b.push(vi);
      if ((ti | tj) === 3) {
        const t = (plane.w - dot(plane.n, vi)) / dot(plane.n, sub(vj, vi));
        const m = lerp(vi, vj, t);
        f.push(m);
        b.push(m);
      }
    }
    if (f.length >= 3) front.push({ v: f, ...meta });
    if (b.length >= 3) back.push({ v: b, ...meta });
  }
}

class Node {
  plane: Plane | null = null;
  front: Node | null = null;
  back: Node | null = null;
  pieces: Piece[] = [];
  constructor(pieces?: Piece[]) {
    if (pieces) this.build(pieces);
  }
  clone(): Node {
    const n = new Node();
    n.plane = this.plane && { n: [...this.plane.n] as V, w: this.plane.w };
    n.front = this.front?.clone() ?? null;
    n.back = this.back?.clone() ?? null;
    n.pieces = this.pieces.map((p) => ({ ...p, v: p.v.map((x) => [...x] as V) }));
    return n;
  }
  /// Turns solid space into empty space and the other way round.
  invert() {
    for (const p of this.pieces) p.v.reverse();
    if (this.plane) this.plane = { n: [-this.plane.n[0], -this.plane.n[1], -this.plane.n[2]], w: -this.plane.w };
    this.front?.invert();
    this.back?.invert();
    [this.front, this.back] = [this.back, this.front];
  }
  /// What is left of `pieces` after removing the parts inside this tree's solid.
  clip(pieces: Piece[]): Piece[] {
    if (!this.plane) return [...pieces];
    let front: Piece[] = [];
    let back: Piece[] = [];
    for (const p of pieces) split(this.plane, p, front, back, front, back);
    if (this.front) front = this.front.clip(front);
    back = this.back ? this.back.clip(back) : [];
    return [...front, ...back];
  }
  clipTo(other: Node) {
    this.pieces = other.clip(this.pieces);
    this.front?.clipTo(other);
    this.back?.clipTo(other);
  }
  all(): Piece[] {
    return [...this.pieces, ...(this.front?.all() ?? []), ...(this.back?.all() ?? [])];
  }
  build(pieces: Piece[]) {
    if (!pieces.length) return;
    if (!this.plane) {
      const first = pieces.map(planeOf).find((p) => p);
      if (!first) return;
      this.plane = first;
    }
    const front: Piece[] = [];
    const back: Piece[] = [];
    for (const p of pieces) split(this.plane, p, this.pieces, this.pieces, front, back);
    if (front.length) (this.front ??= new Node()).build(front);
    if (back.length) (this.back ??= new Node()).build(back);
  }
}

export type BooleanOp = "union" | "difference" | "intersect";
export const BOOLEAN_OPS: BooleanOp[] = ["union", "difference", "intersect"];

/// The solid made from two solids: both together, the first with the second cut out, or only where both are.
export function booleanPieces(a: Piece[], b: Piece[], op: BooleanOp): Piece[] {
  const copy = (p: Piece): Piece => ({ ...p, v: p.v.map((q) => [...q] as V) });
  const x = new Node(a.map(copy));
  const y = new Node(b.map(copy));
  if (op === "union") {
    x.clipTo(y);
    y.clipTo(x);
    y.invert();
    y.clipTo(x);
    y.invert();
    x.build(y.all());
    return x.all();
  }
  if (op === "difference") {
    x.invert();
    x.clipTo(y);
    y.clipTo(x);
    y.invert();
    y.clipTo(x);
    y.invert();
    x.build(y.all());
    x.invert();
    return x.all();
  }
  x.invert();
  y.clipTo(x);
  y.invert();
  x.clipTo(y);
  y.clipTo(x);
  x.build(y.all());
  x.invert();
  return x.all();
}

// ---- cutters: closed convex solids to carve with ----

export type CutterShape = "box" | "cylinder" | "sphere";
export const CUTTER_SHAPES: CutterShape[] = ["box", "cylinder", "sphere"];

/// A closed solid centred on `at` with half-sizes `size / 2` (a cylinder stands along y), wound outwards.
export function cutterPieces(shape: CutterShape, at: V, size: V, segments = 16): Piece[] {
  const h: V = [Math.abs(size[0]) / 2, Math.abs(size[1]) / 2, Math.abs(size[2]) / 2];
  const P = (x: number, y: number, z: number): V => [at[0] + x * h[0], at[1] + y * h[1], at[2] + z * h[2]];
  if (shape === "box") {
    const quad = (a: V, b: V, c: V, d: V): Piece => ({ v: [a, b, c, d] });
    return [
      quad(P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1)),
      quad(P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1)),
      quad(P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1)),
      quad(P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1)),
      quad(P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1), P(1, -1, -1)),
      quad(P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)),
    ];
  }
  const n = Math.max(3, Math.min(64, Math.round(segments)));
  const out: Piece[] = [];
  if (shape === "cylinder") {
    const ring = (i: number) => [Math.cos((i / n) * Math.PI * 2), Math.sin((i / n) * Math.PI * 2)] as const;
    const top: V[] = [];
    const bottom: V[] = [];
    for (let i = 0; i < n; i++) {
      const [c, s] = ring(i);
      const [c2, s2] = ring(i + 1);
      out.push({ v: [P(c, -1, s), P(c2, -1, s2), P(c2, 1, s2), P(c, 1, s)] });
      top.push(P(c, 1, s));
      bottom.push(P(c, -1, s));
    }
    out.push({ v: top.reverse() }, { v: bottom });
    // (seen from outside, anticlockwise: the sides above go round with y up, so the top cap runs the other way)
    return fixWinding(out, at);
  }
  // a sphere as bands of quads between rings, with a fan at each pole
  const rows = Math.max(3, Math.round(n / 2));
  const pt = (i: number, r: number): V => {
    const a = (i / n) * Math.PI * 2;
    const b = (r / rows) * Math.PI;
    return P(Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a));
  };
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < n; i++) {
      const quad = r === 0 ? [pt(0, 0), pt(i + 1, 1), pt(i, 1)] : r === rows - 1 ? [pt(i, r), pt(i + 1, r), pt(0, rows)] : [pt(i, r), pt(i + 1, r), pt(i + 1, r + 1), pt(i, r + 1)];
      out.push({ v: quad });
    }
  }
  return fixWinding(out, at);
}

/// Turns any piece whose normal points towards `inside` the other way round, so the surface faces outwards (for convex solids).
function fixWinding(pieces: Piece[], inside: V): Piece[] {
  return pieces.map((p) => {
    const pl = planeOf(p);
    if (pl && dot(pl.n, inside) - pl.w > 0) return { ...p, v: [...p.v].reverse() };
    return p;
  });
}

// ---- to and from the editor's polygons ----

/// A mesh's polygons as pieces (cut into triangles first, so each is flat and convex).
export function piecesOf(verts: V[], polys: MeshFace[]): Piece[] {
  const out: Piece[] = [];
  for (const f of polys) {
    if (f.v.length < 3) continue;
    const meta = { ...(f.color ? { color: f.color } : {}), ...(f.smooth ? { smooth: true } : {}) };
    for (let k = 1; k + 1 < f.v.length; k++) {
      const tri = [verts[f.v[0]!]!, verts[f.v[k]!]!, verts[f.v[k + 1]!]!];
      if (len2(cross(sub(tri[1]!, tri[0]!), sub(tri[2]!, tri[0]!))) < 1e-18) continue;
      out.push({ v: tri.map((p) => [...p] as V), ...meta });
    }
  }
  return out;
}
const len2 = (a: V) => dot(a, a);

/// Pieces back into points and polygons, joining points that are the same (within a hundred-thousandth) and dropping slivers.
export function meshOf(pieces: Piece[]): { verts: V[]; polys: MeshFace[] } {
  const verts: V[] = [];
  const index = new Map<string, number>();
  const at = (p: V) => {
    const key = p.map((x) => Math.round(x / 1e-4)).join(",");
    let i = index.get(key);
    if (i === undefined) {
      i = verts.push([...p] as V) - 1;
      index.set(key, i);
    }
    return i;
  };
  const polys: MeshFace[] = [];
  for (const p of pieces) {
    const ids: number[] = [];
    for (const x of p.v) {
      const i = at(x);
      if (ids[ids.length - 1] !== i) ids.push(i);
    }
    if (ids.length > 1 && ids[0] === ids[ids.length - 1]) ids.pop();
    if (new Set(ids).size < 3) continue;
    polys.push({ v: ids, ...(p.color ? { color: p.color } : {}), ...(p.smooth ? { smooth: true } : {}) });
  }
  return { verts, polys: healJunctions(verts, polys) };
}

/// Splitting can leave a point of one polygon in the middle of a neighbour's edge (a T-junction): the surface is whole but the mesh is not watertight. Every such point is
/// added to the polygons whose edge it lies on. Skipped for very big meshes (it compares every edge with every point).
export function healJunctions(verts: V[], polys: MeshFace[], tolerance = 2e-4): MeshFace[] {
  const edges = new Map<string, [number, number]>();
  for (const f of polys) f.v.forEach((a, k) => {
    const b = f.v[(k + 1) % f.v.length]!;
    edges.set(a < b ? `${a},${b}` : `${b},${a}`, a < b ? [a, b] : [b, a]);
  });
  if (edges.size * verts.length > 6e6) return polys;
  const onEdge = new Map<string, number[]>();
  for (const [key, [a, b]] of edges) {
    const p = verts[a]!;
    const d = sub(verts[b]!, p);
    const l2 = dot(d, d);
    if (l2 < 1e-12) continue;
    const found: { c: number; t: number }[] = [];
    for (let c = 0; c < verts.length; c++) {
      if (c === a || c === b) continue;
      const q = verts[c]!;
      const t = dot(sub(q, p), d) / l2;
      if (t <= 1e-6 || t >= 1 - 1e-6) continue;
      const off = sub(q, [p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t]);
      if (dot(off, off) < tolerance * tolerance) found.push({ c, t });
    }
    if (found.length) onEdge.set(key, found.sort((x, y) => x.t - y.t).map((x) => x.c));
  }
  if (!onEdge.size) return polys;
  return polys.map((f) => {
    const out: number[] = [];
    f.v.forEach((a, k) => {
      const b = f.v[(k + 1) % f.v.length]!;
      out.push(a);
      const mid = onEdge.get(a < b ? `${a},${b}` : `${b},${a}`);
      if (mid) out.push(...(a < b ? mid : [...mid].reverse()));
    });
    return { ...f, v: out };
  });
}
