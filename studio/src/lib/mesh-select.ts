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
