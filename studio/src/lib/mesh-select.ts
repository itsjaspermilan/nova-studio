// Selecting mesh parts by their layout: edge loops and rings on a quad mesh, and "select similar" faces. Pure functions on a mesh element; the editor turns the result into picked points.

import { toMesh } from "./mesh-edit";
import { polyNormal } from "./model-mesh";
import type { Cube, Vec3 } from "./model-doc";

type Edge = [number, number];
const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-12 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 0];
};

/// The edges at each point and the faces on each edge.
function topology(c: Cube) {
  const faces = new Map<string, number[]>();
  const around = new Map<number, Set<number>>();
  (c.polys ?? []).forEach((f, fi) => f.v.forEach((a, k) => {
    const b = f.v[(k + 1) % f.v.length]!;
    (faces.get(key(a, b)) ?? faces.set(key(a, b), []).get(key(a, b))!).push(fi);
    for (const [p, q] of [[a, b], [b, a]] as Edge[]) (around.get(p) ?? around.set(p, new Set()).get(p)!).add(q);
  }));
  return { faces, around };
}

/// The edge loop through an edge: from each end the loop carries straight on through points where exactly four edges meet (the edge that shares no face with the one it
/// arrived by), and stops at any other point or when it comes back round. Returns the edges in order along the loop.
export function edgeLoop(source: Cube, a: number, b: number): Edge[] {
  const c = toMesh(source);
  const { faces, around } = topology(c);
  if (!faces.has(key(a, b))) return [];
  const share = (e1: Edge, e2: Edge) => (faces.get(key(...e1)) ?? []).some((f) => (faces.get(key(...e2)) ?? []).includes(f));
  const walk = (from: number, to: number): Edge[] => {
    const out: Edge[] = [];
    let prev = from;
    let at = to;
    const seen = new Set<string>([key(a, b)]);
    while (true) {
      const next = around.get(at);
      if (!next || next.size !== 4) break;
      const incoming: Edge = [prev, at];
      const straight = [...next].find((n) => n !== prev && !share(incoming, [at, n]));
      if (straight === undefined || seen.has(key(at, straight))) break;
      seen.add(key(at, straight));
      out.push([at, straight]);
      prev = at;
      at = straight;
    }
    return out;
  };
  const forward = walk(a, b);
  // a loop that comes back to where it began is closed: the other way round would only repeat it
  if (forward.length && forward[forward.length - 1]![1] === a) return [[a, b], ...forward];
  const backward = walk(b, a).map(([p, q]) => [q, p] as Edge).reverse();
  return [...backward, [a, b], ...forward];
}

/// The edge ring through an edge: the edges that run across the quads on either side of it, parallel to it, as far as the quads go (each quad's opposite edge).
export function edgeRing(source: Cube, a: number, b: number): Edge[] {
  const c = toMesh(source);
  const { faces } = topology(c);
  if (!faces.has(key(a, b))) return [];
  const polys = c.polys ?? [];
  const walk = (start: Edge, face: number): Edge[] => {
    const out: Edge[] = [];
    let edge = start;
    let f = face;
    const seen = new Set<string>([key(...start)]);
    while (f !== undefined) {
      const v = polys[f]!.v;
      if (v.length !== 4) break;
      const i = v.findIndex((p, k) => key(p, v[(k + 1) % 4]!) === key(...edge));
      if (i < 0) break;
      const opposite: Edge = [v[(i + 3) % 4]!, v[(i + 2) % 4]!]; // the edge across the quad (reversed to follow the same direction)
      if (seen.has(key(...opposite))) break;
      seen.add(key(...opposite));
      out.push(opposite);
      const next = (faces.get(key(...opposite)) ?? []).find((g) => g !== f);
      if (next === undefined) break;
      edge = opposite;
      f = next;
    }
    return out;
  };
  const fs = faces.get(key(a, b))!;
  const first = fs[0] !== undefined ? walk([a, b], fs[0]) : [];
  const second = fs[1] !== undefined ? walk([a, b], fs[1]) : [];
  return [...second.reverse(), [a, b] as Edge, ...first];
}

/// The points an edge list touches (each once).
export const pointsOfEdges = (edges: Edge[]): number[] => [...new Set(edges.flat())];

export type SimilarBy = "normal" | "area" | "sides";

/// The faces like a given one: the same way it faces (within `tolerance` degrees), about the same area (within a fraction `tolerance`), or the same number of sides.
export function selectSimilarFaces(source: Cube, face: number, by: SimilarBy, tolerance = 5): number[] {
  const c = toMesh(source);
  const polys = c.polys ?? [];
  const verts = c.verts ?? [];
  const f = polys[face];
  if (!f) return [];
  const normalOf = (i: number) => unit(polyNormal(verts, polys[i]!.v));
  const areaOf = (i: number) => Math.hypot(...polyNormal(verts, polys[i]!.v)) / 2;
  const n0 = normalOf(face);
  const a0 = areaOf(face);
  const out: number[] = [];
  polys.forEach((p, i) => {
    if (by === "sides" ? p.v.length === f.v.length : by === "normal" ? n0[0] * normalOf(i)[0] + n0[1] * normalOf(i)[1] + n0[2] * normalOf(i)[2] >= Math.cos((tolerance * Math.PI) / 180) - 1e-9 : Math.abs(areaOf(i) - a0) <= a0 * (tolerance / 100) + 1e-9) out.push(i);
  });
  return out;
}

/// Edge slide: moves the edge's two points along the edges that run from them across the quads beside it, towards the face on one side (`t` from 0 to 1) or the other (0 to -1),
/// so the edge keeps its shape and its place in the loop but moves along the surface. The sides are the first and second face on the edge (in the mesh's own order). An edge with
/// a face of fewer or more than four sides on the side asked for is left alone on that side. Returns a new mesh element.
export function edgeSlide(source: Cube, a: number, b: number, t: number): Cube {
  const c = toMesh(source);
  const { faces } = topology(c);
  const beside = faces.get(key(a, b));
  const out: Cube = JSON.parse(JSON.stringify(c));
  if (!beside || !beside.length || !Number.isFinite(t) || t === 0) return out;
  const face = beside[t > 0 ? 0 : 1];
  if (face === undefined) return out;
  const v = c.polys![face]!.v;
  if (v.length !== 4) return out;
  const amount = Math.min(1, Math.abs(t));
  // the point next to `p` in the face that is not the other end of the edge
  const rail = (p: number, other: number) => {
    const i = v.indexOf(p);
    const n1 = v[(i + 1) % 4]!;
    const n2 = v[(i + 3) % 4]!;
    return n1 === other ? n2 : n1;
  };
  const move = (p: number, other: number) => {
    const to = rail(p, other);
    const from = c.verts![p]!;
    const target = c.verts![to]!;
    out.verts![p] = [from[0] + (target[0] - from[0]) * amount, from[1] + (target[1] - from[1]) * amount, from[2] + (target[2] - from[2]) * amount];
  };
  move(a, b);
  move(b, a);
  return out;
}

/// The open borders of a mesh: each is a closed ring of points, in order, along edges that only one face uses. Wound so that a face made from the ring in this order faces
/// the way the surface around the hole does not (it closes the hole, matching the winding of its neighbours).
export function boundaryLoops(source: Cube): number[][] {
  const c = toMesh(source);
  const next = new Map<number, number[]>();
  const count = new Map<string, number>();
  for (const f of c.polys ?? []) f.v.forEach((a, k) => {
    const b = f.v[(k + 1) % f.v.length]!;
    count.set(key(a, b), (count.get(key(a, b)) ?? 0) + 1);
  });
  // a border edge a->b of a face is walked the other way, b->a, by the face that would close the hole
  for (const f of c.polys ?? []) f.v.forEach((a, k) => {
    const b = f.v[(k + 1) % f.v.length]!;
    if (count.get(key(a, b)) === 1) (next.get(b) ?? next.set(b, []).get(b)!).push(a);
  });
  const loops: number[][] = [];
  const used = new Set<number>();
  for (const start of next.keys()) {
    if (used.has(start)) continue;
    const loop = [start];
    used.add(start);
    let at = next.get(start)![0]!;
    while (at !== start && !used.has(at) && next.has(at)) {
      loop.push(at);
      used.add(at);
      at = next.get(at)![0]!;
    }
    if (at === start && loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/// Closes the hole whose border passes through `point` with quads meeting at a new point in the middle (a triangle fan when the border has an odd number of points). Returns the
/// mesh as it was when the point is not on a border.
export function fillHole(source: Cube, point: number): Cube {
  const c = toMesh(source);
  const loop = boundaryLoops(c).find((l) => l.includes(point));
  if (!loop) return c;
  const out: Cube = JSON.parse(JSON.stringify(c));
  const mid: Vec3 = [0, 0, 0];
  for (const i of loop) for (let a = 0; a < 3; a++) mid[a]! += c.verts![i]![a]! / loop.length;
  const centre = out.verts!.push(mid) - 1;
  const n = loop.length;
  const colour = c.polys![0]?.color;
  if (n % 2 === 0) {
    for (let k = 0; k < n; k += 2) out.polys!.push({ v: [loop[k]!, loop[(k + 1) % n]!, loop[(k + 2) % n]!, centre], ...(colour ? { color: colour } : {}) });
  } else {
    for (let k = 0; k < n; k++) out.polys!.push({ v: [loop[k]!, loop[(k + 1) % n]!, centre], ...(colour ? { color: colour } : {}) });
  }
  return out;
}

/// Smooth by angle: a face is shaded smooth when every face it shares an edge with turns away from it by no more than `angle` degrees, and flat otherwise, so the
/// round parts of a mesh shade smoothly and its hard corners stay crisp. Only the faces in `faces` (all by default) are decided. Returns a new mesh element.
export function smoothByAngle(source: Cube, angle: number, faces?: number[]): Cube {
  const c = toMesh(source);
  const out: Cube = JSON.parse(JSON.stringify(c));
  const polys = c.polys ?? [];
  const verts = c.verts ?? [];
  const normals = polys.map((p) => unit(polyNormal(verts, p.v)));
  const { faces: onEdge } = topology(c);
  const limit = Math.cos((Math.max(0, angle) * Math.PI) / 180) - 1e-9;
  for (const i of faces ?? polys.map((_, k) => k)) {
    const f = polys[i];
    if (!f) continue;
    let soft = true;
    f.v.forEach((a, k) => {
      for (const j of onEdge.get(key(a, f.v[(k + 1) % f.v.length]!)) ?? []) {
        if (j === i) continue;
        const d = normals[i]![0] * normals[j]![0] + normals[i]![1] * normals[j]![1] + normals[i]![2] * normals[j]![2];
        if (d < limit) soft = false;
      }
    });
    if (soft) out.polys![i]!.smooth = true;
    else delete out.polys![i]!.smooth;
  }
  return out;
}
