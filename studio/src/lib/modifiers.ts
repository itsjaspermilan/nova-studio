// A non-destructive modifier stack for mesh elements, the way Blender has it. The element keeps its
// original points and polygons (the "cage") plus a list of modifiers; `evaluate` runs the list on
// a copy and returns the finished mesh, which the viewport draws and the .glb exporter writes. The
// .model.json never stores the result, so the cage stays editable.
//
// Every modifier is a pure function from a soup of points and polygons (counter-clockwise seen from
// outside, like the rest of the editor) to a new soup. Polygon colour and `smooth` ride along.

import { MAX_FACES, MAX_VERTS, type Cube, type MeshFace, type Vec3 } from "./model-doc";
import { polyNormal } from "./model-mesh";
import { fitBounds } from "./model-doc";
import { toMesh } from "./mesh-edit";
import { BOOLEAN_OPS, CUTTER_SHAPES, booleanPieces, cutterPieces, meshOf, piecesOf, type BooleanOp, type CutterShape } from "./csg";
import { ZERO_LATTICE, curveDeform, edgeSplit, lattice, remeshBlocks, shrinkwrap, wireframe, type LatticeCorners, type WrapKind } from "./modifier-more";
import { DEFORMS, decimate as decimateCube, displace as displaceCube, simpleDeform, smoothVerts, triangulate as triangulateCube, type DeformKind } from "./mesh-ops";
import { applyCut, checkCuts, type Cut } from "./mesh-cutout";
export { DEFORMS, type DeformKind };
export type { Cut };

export type ModAxis = "x" | "y" | "z";
export const MOD_AXES: ModAxis[] = ["x", "y", "z"];
export const MAX_MODIFIERS = 16;

interface Common {
  /// Drawn in the editor's view (default true).
  show?: boolean;
  /// Baked into the .glb (default true).
  render?: boolean;
}
/// Adds the mirror image across a plane through the part's origin.
export interface MirrorMod extends Common {
  type: "mirror";
  axis: ModAxis;
  /// Where the plane is along the axis (default 0).
  center?: number;
  /// Points this close to the plane, or to their own reflection, become one point (default 0.01 units).
  merge?: number;
  /// Points within `merge` of the plane are pulled exactly onto it, so the halves close without a gap (default true).
  clip?: boolean;
}
/// Catmull-Clark subdivision: rounds the cage off.
export interface SubsurfMod extends Common {
  type: "subsurf";
  /// Steps drawn in the editor (default 1).
  levels?: number;
  /// Steps written to the .glb (default 2).
  renderLevels?: number;
  /// Shade the result smoothly (default true).
  smooth?: boolean;
}
/// Rounds off the sharp edges.
export interface BevelMod extends Common {
  type: "bevel";
  /// How far the bevel reaches into each face, in units (default 1).
  width?: number;
  /// Steps across the rounding (default 2).
  segments?: number;
  /// Only edges where the faces meet at least this many degrees apart are bevelled (default 30).
  angle?: number;
}
/// Gives a surface thickness.
export interface SolidifyMod extends Common {
  type: "solidify";
  thickness?: number;
  /// -1 grows inwards from the surface, 1 outwards, 0 straddles it (default -1).
  offset?: number;
  /// Keeps the wall the same thickness around corners (default true).
  even?: boolean;
}
/// Repeats the mesh along a line.
export interface ArrayMod extends Common {
  type: "array";
  count?: number;
  /// Distance between copies, in units.
  offset?: Vec3;
  /// Extra distance between copies as a fraction of the mesh's own size.
  relative?: Vec3;
  /// Points of neighbouring copies closer than this are joined (default 0 = off).
  merge?: number;
}
/// Spins the mesh's points, taken in order as a profile line, about an axis: wheels, tyres, rims, bottles. It makes the shape from
/// the points alone, so the polygons of the mesh it sits on do not matter. The profile is (distance from the axis, position along it):
/// for the y axis that is (x, y), for x it is (y, x), for z it is (x, z). A point on the axis (distance 0) becomes one point.
export interface RevolveMod extends Common {
  type: "revolve";
  axis?: ModAxis;
  /// Steps round the turn (default 24).
  segments?: number;
  /// How far it turns, degrees; 360 is all the way round and closes up (default 360).
  angle?: number;
  /// Join the last profile point back to the first (default false).
  closed?: boolean;
  /// Corners of the profile sharper than this many degrees stay crisp; gentler ones shade smoothly (default 40).
  sharp?: number;
  /// Turn the faces inside out (use it if the profile runs the other way).
  flip?: boolean;
}
/// Joins points closer than `distance` (default 0.01).
export interface WeldMod extends Common {
  type: "weld";
  distance?: number;
}
/// Cuts every face into triangles.
export interface TriangulateMod extends Common {
  type: "triangulate";
}
/// A cheaper mesh: groups of close points become one. `ratio` is about the share kept (default 0.5).
export interface DecimateMod extends Common {
  type: "decimate";
  ratio?: number;
}
/// Pushes the surface in and out along its normals in a bumpy pattern.
export interface DisplaceMod extends Common {
  type: "displace";
  amount?: number;
  scale?: number;
  seed?: number;
}
/// Bends, twists, tapers or stretches the mesh along an axis (degrees for bend and twist, a fraction for taper, units for stretch).
export interface DeformMod extends Common {
  type: "deform";
  kind?: DeformKind;
  axis?: ModAxis;
  amount?: number;
}
/// Relaxes the points towards their neighbours.
export interface SmoothMod extends Common {
  type: "smooth";
  factor?: number;
  passes?: number;
}
/// Replaces the edges with thin bars (a wire frame of the mesh).
export interface WireframeMod extends Common {
  type: "wireframe";
  thickness?: number;
}
/// Pulls the points onto a sphere, a cylinder (round `axis`) or a plane (across `axis`).
export interface ShrinkwrapMod extends Common {
  type: "shrinkwrap";
  kind?: WrapKind;
  axis?: ModAxis;
  factor?: number;
  /// Sphere and cylinder: 0 (or missing) is the average distance now.
  radius?: number;
}
/// Moves the eight corners of the box round the mesh and carries the points along (`corners[i]` is the offset of corner i: x = i & 1, y = (i >> 1) & 1, z = (i >> 2) & 1).
export interface LatticeMod extends Common {
  type: "lattice";
  corners?: LatticeCorners;
}
/// Carves with a solid (a box, a cylinder along y or a sphere) placed at `at`: take it away from the mesh, add it, or keep only where both are. The mesh must be a closed
/// solid; the cutter is not drawn as a shape of its own.
export interface BooleanMod extends Common {
  type: "boolean";
  operation?: BooleanOp;
  shape?: CutterShape;
  at?: [number, number, number];
  size?: [number, number, number];
}
/// Rebuilds the mesh out of cubes (a blocky remesh; a closed solid is needed): `voxel` is a cube's side in units. Follow it with Smooth for a rounder result.
export interface RemeshMod extends Common {
  type: "remesh";
  voxel?: number;
}
/// Lays the mesh along a smooth curve through `points` (the mesh's length along `axis` is spread along the path).
export interface CurveMod extends Common {
  type: "curve";
  axis?: ModAxis;
  points?: [number, number, number][];
}
/// Shades smoothly except across edges sharper than `angle` degrees, where the points are split so the corner stays crisp.
export interface EdgeSplitMod extends Common {
  type: "edgesplit";
  angle?: number;
}
/// Presses outlines drawn in the standard views onto the surface (Blender's knife project): windows, lamps, grilles, panel gaps and wheel openings cut into a
/// smooth body. Put it after Mirror and Subdivision. See `mesh-cutout.ts` for what an outline can do.
export interface CutoutMod extends Common {
  type: "cutout";
  cuts?: Cut[];
}
export type Modifier = CutoutMod | EdgeSplitMod | CurveMod | RemeshMod | BooleanMod | WireframeMod | ShrinkwrapMod | LatticeMod | MirrorMod | SubsurfMod | BevelMod | SolidifyMod | ArrayMod | RevolveMod | WeldMod | TriangulateMod | DecimateMod | DisplaceMod | DeformMod | SmoothMod;
export type ModifierType = Modifier["type"];
export const MODIFIER_TYPES: ModifierType[] = ["mirror", "subsurf", "bevel", "solidify", "array", "revolve", "weld", "triangulate", "decimate", "displace", "deform", "smooth", "wireframe", "shrinkwrap", "lattice", "boolean", "remesh", "curve", "edgesplit", "cutout"];
export const MODIFIER_LABELS: Record<ModifierType, string> = { cutout: "Cut-out", mirror: "Mirror", subsurf: "Subdivision", bevel: "Bevel", solidify: "Solidify", array: "Array", revolve: "Revolve", weld: "Weld", triangulate: "Triangulate", decimate: "Decimate", displace: "Displace", deform: "Simple deform", smooth: "Smooth", wireframe: "Wireframe", shrinkwrap: "Shrinkwrap", lattice: "Lattice", boolean: "Boolean", remesh: "Remesh (blocks)", curve: "Curve", edgesplit: "Edge split" };
export const MAX_REVOLVE = 128;
/// A crease weight of 1 stays sharp through this many subdivision levels (the most a modifier does).
export const CREASE_LEVELS = 4;

export const MAX_SUBSURF = 4;
export const MAX_BEVEL_SEGMENTS = 16;
export const MAX_ARRAY = 64;

export function newModifier(type: ModifierType): Modifier {
  switch (type) {
    case "mirror": return { type, axis: "x", merge: 0.01, clip: true };
    case "subsurf": return { type, levels: 1, renderLevels: 2, smooth: true };
    case "bevel": return { type, width: 1, segments: 2, angle: 30 };
    case "solidify": return { type, thickness: 1, offset: -1, even: true };
    case "array": return { type, count: 2, offset: [8, 0, 0] };
    case "revolve": return { type, axis: "y", segments: 24, angle: 360, sharp: 40 };
    case "weld": return { type, distance: 0.01 };
    case "triangulate": return { type };
    case "decimate": return { type, ratio: 0.5 };
    case "displace": return { type, amount: 0.5, scale: 4, seed: 1 };
    case "deform": return { type, kind: "bend", axis: "y", amount: 45 };
    case "smooth": return { type, factor: 0.5, passes: 2 };
    case "wireframe": return { type, thickness: 0.5 };
    case "shrinkwrap": return { type, kind: "sphere", axis: "y", factor: 1, radius: 0 };
    case "lattice": return { type, corners: ZERO_LATTICE() };
    case "edgesplit": return { type, angle: 30 };
    case "remesh": return { type, voxel: 2 };
    case "curve": return { type, axis: "x", points: [[0, 0, 0], [8, 0, 0], [16, 8, 0], [16, 16, 0]] };
    case "boolean": return { type, operation: "difference", shape: "box", at: [0, 0, 0], size: [8, 8, 8] };
    case "cutout": return { type, cuts: [{ name: "window", view: "side", points: [[-4, 2], [4, 2], [4, 6], [-4, 6]], color: "#2f4f78", depth: 0.25 }] };
  }
}

// ---------------------------------------------------------------------------------------------
// The soup the modifiers work on

export interface Soup {
  verts: Vec3[];
  polys: MeshFace[];
  /// Sharpness of edges (key "a,b" with a < b) in subdivision levels: 0 smooth, 1 one level held sharp, ... Open borders count as infinitely sharp.
  creases?: Map<string, number>;
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => {
  const l = len(a);
  return l > 1e-12 ? mul(a, 1 / l) : [0, 0, 0];
};
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => add(mul(a, 1 - t), mul(b, t));
const edgeKey = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
/// Carries creases through a renumbering of points (`map[old]`, -1 for gone); `copies` adds a second set for `twin`.
function mapCreases(c: Map<string, number> | undefined, map: (i: number) => number, extra?: (i: number) => number): Map<string, number> | undefined {
  if (!c) return undefined;
  const out = new Map<string, number>();
  for (const [key, w] of c) {
    const [a, b] = key.split(",").map(Number) as [number, number];
    for (const f of extra ? [map, extra] : [map]) {
      const x = f(a), y = f(b);
      if (x >= 0 && y >= 0 && x !== y) out.set(edgeKey(x, y), Math.max(out.get(edgeKey(x, y)) ?? 0, w));
    }
  }
  return out.size ? out : undefined;
}
const axisIndex = (a: ModAxis) => (a === "x" ? 0 : a === "y" ? 1 : 2);
const copyPoly = (f: MeshFace, v: number[]): MeshFace => {
  const out: MeshFace = { v };
  if (f.color) out.color = f.color;
  if (f.smooth) out.smooth = true;
  if (f.mat) out.mat = f.mat;
  return out;
};
const soupOf = (c: Cube): Soup => {
  const creases = new Map<string, number>();
  for (const [a, b, w] of c.creases ?? []) if (w > 0) creases.set(edgeKey(a, b), Math.max(creases.get(edgeKey(a, b)) ?? 0, w * CREASE_LEVELS));
  return { verts: (c.verts ?? []).map((p) => [...p] as Vec3), polys: (c.polys ?? []).map((f) => copyPoly(f, [...f.v])), ...(creases.size ? { creases } : {}) };
};


/// Drops points no polygon uses and renumbers.
export function compactSoup(s: Soup): Soup {
  const map = new Map<number, number>();
  const verts: Vec3[] = [];
  const polys = s.polys.map((f) => copyPoly(f, f.v.map((i) => {
    let m = map.get(i);
    if (m === undefined) {
      m = verts.push(s.verts[i]!) - 1;
      map.set(i, m);
    }
    return m;
  })));
  return { verts, polys, ...(s.creases ? (() => { const c = mapCreases(s.creases, (i) => map.get(i) ?? -1); return c ? { creases: c } : {}; })() : {}) };
}

/// Joins points closer than `distance` (grid lookup, so it is fast on big meshes) and drops polygons that collapse to fewer than three points.
export function weldSoup(s: Soup, distance: number, only?: (a: number, b: number) => boolean): Soup {
  if (!(distance > 0)) return s;
  const cell = (p: Vec3) => p.map((x) => Math.floor(x / distance)) as Vec3;
  const grid = new Map<string, number[]>();
  const target = s.verts.map((_, i) => i);
  s.verts.forEach((p, i) => {
    const [cx, cy, cz] = cell(p);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const j of grid.get(`${cx! + dx},${cy! + dy},${cz! + dz}`) ?? []) {
        if (target[j] !== j || len(sub(s.verts[j]!, p)) > distance || (only && !only(j, i))) continue;
        target[i] = j;
        return;
      }
    }
    const key = cell(p).join(",");
    grid.set(key, [...(grid.get(key) ?? []), i]);
  });
  const polys: MeshFace[] = [];
  for (const f of s.polys) {
    const v: number[] = [];
    for (const i of f.v) {
      const t = target[i]!;
      if (v[v.length - 1] !== t) v.push(t);
    }
    if (v.length > 1 && v[0] === v[v.length - 1]) v.pop();
    if (new Set(v).size >= 3 && v.length === new Set(v).size) polys.push(copyPoly(f, v));
  }
  return compactSoup({ verts: s.verts, polys, creases: mapCreases(s.creases, (i) => target[i]!) });
}

// ---------------------------------------------------------------------------------------------
// Mirror

export function mirror(s: Soup, m: MirrorMod): Soup {
  const a = axisIndex(m.axis);
  const centre = m.center ?? 0;
  const merge = Math.max(0, m.merge ?? 0.01);
  const verts = s.verts.map((p) => [...p] as Vec3);
  const on: boolean[] = verts.map((p) => Math.abs(p[a] - centre) <= merge / 2 + 1e-9);
  if (m.clip !== false) verts.forEach((p, i) => { if (on[i]) p[a] = centre; });
  const n = verts.length;
  // A point on the plane is its own reflection; the rest get a new point.
  const twin: number[] = verts.map((p, i) => {
    if (on[i]) return i;
    return -1;
  });
  const out: Vec3[] = [...verts];
  for (let i = 0; i < n; i++) {
    if (twin[i] !== -1) continue;
    const p = [...verts[i]!] as Vec3;
    p[a] = 2 * centre - p[a];
    twin[i] = out.push(p) - 1;
  }
  const polys: MeshFace[] = [];
  const flat = (f: MeshFace) => f.v.every((i) => on[i]);
  for (const f of s.polys) {
    // A polygon lying in the plane would be an inner wall once mirrored; both copies go.
    if (flat(f)) continue;
    polys.push(copyPoly(f, [...f.v]));
  }
  for (const f of s.polys) {
    if (flat(f)) continue;
    polys.push(copyPoly(f, f.v.map((i) => twin[i]!).reverse()));
  }
  return compactSoup({ verts: out, polys, creases: mapCreases(s.creases, (i) => i, (i) => twin[i]!) });
}

// ---------------------------------------------------------------------------------------------
// Subdivision surface (Catmull-Clark)

export function subdivideOnce(s: Soup, smooth: boolean): Soup {
  const nv = s.verts.length;
  const faceEdges = new Map<string, number[]>();
  s.polys.forEach((f, fi) => {
    for (let k = 0; k < f.v.length; k++) {
      const key = edgeKey(f.v[k]!, f.v[(k + 1) % f.v.length]!);
      faceEdges.set(key, [...(faceEdges.get(key) ?? []), fi]);
    }
  });
  // How sharp each edge is: open borders and edges shared by more than two faces are infinitely sharp, the rest follow the creases.
  const sharpness = (key: string) => {
    const n = faceEdges.get(key)!.length;
    return n !== 2 ? Infinity : s.creases?.get(key) ?? 0;
  };
  const blend = (smoothP: Vec3, sharpP: Vec3, sigma: number) => (sigma >= 1 ? sharpP : sigma <= 0 ? smoothP : lerp(smoothP, sharpP, sigma));
  const facePoint: Vec3[] = s.polys.map((f) => mul(f.v.reduce<Vec3>((acc, i) => add(acc, s.verts[i]!), [0, 0, 0]), 1 / f.v.length));
  // Edge points are numbered after the points and before the face points.
  const edgeIndex = new Map<string, number>();
  const edgePoints: Vec3[] = [];
  for (const [key, faces] of faceEdges) {
    const [a, b] = key.split(",").map(Number) as [number, number];
    const mid = mul(add(s.verts[a]!, s.verts[b]!), 0.5);
    edgeIndex.set(key, nv + edgePoints.length);
    const smoothP = faces.length === 2 ? mul(add(mid, mul(add(facePoint[faces[0]!]!, facePoint[faces[1]!]!), 0.5)), 0.5) : mid;
    edgePoints.push(blend(smoothP, mid, sharpness(key)));
  }
  // New positions of the old points.
  const vertFaces: number[][] = s.verts.map(() => []);
  const vertEdges: number[][] = s.verts.map(() => []);
  s.polys.forEach((f, fi) => f.v.forEach((i) => vertFaces[i]!.push(fi)));
  for (const key of faceEdges.keys()) {
    const [a, b] = key.split(",").map(Number) as [number, number];
    vertEdges[a]!.push(b);
    vertEdges[b]!.push(a);
  }
  const moved: Vec3[] = s.verts.map((p, i) => {
    const faces = vertFaces[i]!;
    const nbrs = vertEdges[i]!;
    if (!faces.length) return p;
    const sharpNbrs = nbrs.map((j) => ({ j, w: sharpness(edgeKey(i, j)) })).filter((e) => e.w > 0);
    const manifold = nbrs.length === faces.length && nbrs.every((j) => faceEdges.get(edgeKey(i, j))!.length === 2);
    let smoothP = p;
    if (manifold) {
      const n = nbrs.length;
      const f = mul(faces.reduce<Vec3>((acc, fi) => add(acc, facePoint[fi]!), [0, 0, 0]), 1 / n);
      const r = mul(nbrs.reduce<Vec3>((acc, j) => add(acc, mul(add(p, s.verts[j]!), 0.5)), [0, 0, 0]), 1 / n);
      smoothP = mul(add(add(f, mul(r, 2)), mul(p, n - 3)), 1 / n);
    }
    if (sharpNbrs.length < 2) return smoothP;
    if (sharpNbrs.length === 2) {
      const [e1, e2] = sharpNbrs as [{ j: number; w: number }, { j: number; w: number }];
      const creaseP = mul(add(add(s.verts[e1.j]!, s.verts[e2.j]!), mul(p, 6)), 1 / 8);
      return blend(smoothP, creaseP, (Math.min(e1.w, 1e9) + Math.min(e2.w, 1e9)) / 2);
    }
    // a corner: three or more sharp edges meet
    const avg = sharpNbrs.reduce((sum, e) => sum + Math.min(e.w, 1e9), 0) / sharpNbrs.length;
    return blend(smoothP, p, avg);
  });
  const verts = [...moved, ...edgePoints, ...facePoint];
  const faceBase = nv + edgePoints.length;
  const polys: MeshFace[] = [];
  s.polys.forEach((f, fi) => {
    const k = f.v.length;
    for (let j = 0; j < k; j++) {
      const piece = copyPoly(f, [
        f.v[j]!,
        edgeIndex.get(edgeKey(f.v[j]!, f.v[(j + 1) % k]!))!,
        faceBase + fi,
        edgeIndex.get(edgeKey(f.v[(j + k - 1) % k]!, f.v[j]!))!,
      ]);
      if (smooth) piece.smooth = true;
      polys.push(piece);
    }
  });
  // Each half of a creased edge carries the crease on, one level softer.
  let creases: Map<string, number> | undefined;
  if (s.creases) {
    creases = new Map();
    for (const [key, w] of s.creases) {
      const e = edgeIndex.get(key);
      if (e === undefined || w <= 1) continue;
      const [a, b] = key.split(",").map(Number) as [number, number];
      creases.set(edgeKey(a, e), w - 1);
      creases.set(edgeKey(b, e), w - 1);
    }
    if (!creases.size) creases = undefined;
  }
  return { verts, polys, ...(creases ? { creases } : {}) };
}

export function subsurf(s: Soup, levels: number, smooth = true): Soup {
  let out = s;
  const n = Math.max(0, Math.min(MAX_SUBSURF, Math.round(levels)));
  for (let i = 0; i < n; i++) {
    const quads = out.polys.reduce((sum, f) => sum + f.v.length, 0);
    // Stop before the mesh outgrows the element limits.
    if (quads > MAX_FACES || out.verts.length + out.polys.length * 2 + quads > MAX_VERTS) break;
    out = subdivideOnce(out, smooth);
  }
  if (n === 0 && smooth) out = { verts: out.verts, polys: out.polys.map((f) => ({ ...f, smooth: true })) };
  return out;
}

// ---------------------------------------------------------------------------------------------
// Bevel

/// Rounds the edges where two faces meet at `angle` degrees or more. Each face is pulled in by `width` along a bevelled
/// edge; a strip of `segments` quads (a circular arc in section) fills the gap; each point where bevelled edges meet gets a
/// cap polygon. Edges at the open border of a mesh, and edges shared by more than two faces, are left alone.
export function bevel(s: Soup, b: BevelMod): Soup {
  const width = Math.max(0, b.width ?? 1);
  const segs = Math.max(1, Math.min(MAX_BEVEL_SEGMENTS, Math.round(b.segments ?? 2)));
  if (width <= 0 || !s.polys.length) return s;
  const limit = Math.cos(((Math.max(0, Math.min(180, b.angle ?? 30))) * Math.PI) / 180);
  const normals = s.polys.map((f) => norm(polyNormal(s.verts, f.v)));
  const edgeFaces = new Map<string, number[]>();
  s.polys.forEach((f, fi) => f.v.forEach((a, k) => {
    const key = edgeKey(a, f.v[(k + 1) % f.v.length]!);
    edgeFaces.set(key, [...(edgeFaces.get(key) ?? []), fi]);
  }));
  const sharp = new Set<string>();
  for (const [key, faces] of edgeFaces) {
    if (faces.length !== 2) continue;
    const [fa, fb] = faces as [number, number];
    if (dot(normals[fa]!, normals[fb]!) <= limit + 1e-9 && len(normals[fa]!) > 0 && len(normals[fb]!) > 0) sharp.add(key);
  }
  if (!sharp.size) return s;

  const verts = s.verts.map((p) => [...p] as Vec3);
  const point = (p: Vec3) => verts.push(p) - 1;
  const edgeLen = (a: number, c: number) => len(sub(s.verts[a]!, s.verts[c]!));

  // Which corners (face, position) each point has.
  const cornersAt: { f: number; k: number }[][] = s.verts.map(() => []);
  s.polys.forEach((f, fi) => f.v.forEach((i, k) => cornersAt[i]!.push({ f: fi, k })));
  const touched = new Set<number>();
  for (const key of sharp) for (const i of key.split(",").map(Number)) touched.add(i);

  // The slide point on a plain edge at a point (key "v>nbr"), and the corner point where two bevelled edges meet in a face.
  const slide = new Map<string, number>(); // best slide distance per (point, neighbour)
  const slideAt = (v: number, nbr: number) => `${v}>${nbr}`;
  const inward = (fi: number, a: number, c: number): Vec3 => norm(cross(normals[fi]!, norm(sub(s.verts[c]!, s.verts[a]!)))); // inwards from edge a->c, in face fi
  const cornerInfo = (fi: number, k: number) => {
    const f = s.polys[fi]!;
    const m = f.v.length;
    const v = f.v[k]!;
    const p = f.v[(k + m - 1) % m]!;
    const n = f.v[(k + 1) % m]!;
    return { v, p, n, bp: sharp.has(edgeKey(p, v)), bn: sharp.has(edgeKey(v, n)) };
  };
  // First pass: how far each plain edge must slide at each touched point.
  for (const v of touched) {
    for (const { f, k } of cornersAt[v]!) {
      const { p, n, bp, bn } = cornerInfo(f, k);
      if (bp === bn) continue;
      const [bevelled, plain] = bp ? [p, n] : [n, p];
      const inw = bp ? inward(f, p, v) : inward(f, v, n);
      const d = norm(sub(s.verts[plain]!, s.verts[v]!));
      const along = dot(d, inw);
      const t = Math.min(along > 0.05 ? width / along : width * 20, edgeLen(v, plain) * 0.49);
      void bevelled;
      const key = slideAt(v, plain);
      slide.set(key, Math.max(slide.get(key) ?? 0, t));
    }
  }
  // Points: T (on plain edges), Q (corner of two bevelled edges), arcs (along bevelled edges).
  const tPoint = new Map<string, number>();
  const T = (v: number, nbr: number) => {
    const key = slideAt(v, nbr);
    let i = tPoint.get(key);
    if (i === undefined) {
      const t = slide.get(key) ?? 0;
      i = point(add(s.verts[v]!, mul(norm(sub(s.verts[nbr]!, s.verts[v]!)), t)));
      tPoint.set(key, i);
    }
    return i;
  };
  const qPoint = new Map<string, number>();
  const Q = (fi: number, k: number) => {
    const key = `${fi}:${k}`;
    let i = qPoint.get(key);
    if (i === undefined) {
      const { v, p, n } = cornerInfo(fi, k);
      const ip = inward(fi, p, v);
      const inn = inward(fi, v, n);
      const c = dot(ip, inn);
      const x = mul(add(ip, inn), width / Math.max(0.15, 1 + c));
      i = point(add(s.verts[v]!, x));
      qPoint.set(key, i);
    }
    return i;
  };
  /// The point where face `fi`'s corner `k` touches the edge towards `nbr` (a bevelled or plain edge).
  const side = (fi: number, k: number, nbr: number): number => {
    const { v, p, n, bp, bn } = cornerInfo(fi, k);
    const other = nbr === p ? n : p;
    const otherSharp = nbr === p ? bn : bp;
    const thisSharp = nbr === p ? bp : bn;
    if (thisSharp && otherSharp) return Q(fi, k);
    void other;
    // A plain edge, or a bevelled one whose partner at this corner is plain: the slide point of whichever is plain.
    return T(v, thisSharp ? other : nbr);
  };

  // Arcs along each bevelled edge at each end: from the face before to the face after, counter-clockwise around the point.
  const faceTraversing = (a: number, c: number) => (edgeFaces.get(edgeKey(a, c)) ?? []).find((fi) => {
    const f = s.polys[fi]!;
    return f.v.some((x, k) => x === a && f.v[(k + 1) % f.v.length] === c);
  });
  const cornerOf = (fi: number, v: number) => s.polys[fi]!.v.indexOf(v);
  const arcs = new Map<string, number[]>();
  const arc = (v: number, nbr: number): number[] => {
    const key = `${v}>${nbr}`;
    let pts = arcs.get(key);
    if (pts) return pts;
    const fa = faceTraversing(v, nbr); // after: the face going v -> nbr
    const fb = faceTraversing(nbr, v); // before: the face going nbr -> v
    if (fa === undefined || fb === undefined) return [];
    const ka = cornerOf(fa, v);
    const kb = cornerOf(fb, v);
    const start = side(fb, kb, nbr);
    const end = side(fa, ka, nbr);
    const pS = verts[start]!;
    const pE = verts[end]!;
    // Control point: on the original edge line (the section's tangents meet there).
    const cA = sub(pE, mul(inward(fa, v, nbr), width));
    const cB = sub(pS, mul(inward(fb, nbr, v), width));
    const ctl = mul(add(cA, cB), 0.5);
    const wgt = Math.sqrt(Math.max(0, (1 + dot(normals[fa]!, normals[fb]!)) / 2));
    pts = [start];
    for (let j = 1; j < segs; j++) {
      const t = j / segs;
      const w0 = (1 - t) * (1 - t);
      const w1 = 2 * t * (1 - t) * wgt;
      const w2 = t * t;
      const sum = w0 + w1 + w2;
      pts.push(point(mul(add(add(mul(pS, w0), mul(ctl, w1)), mul(pE, w2)), 1 / sum)));
    }
    pts.push(end);
    arcs.set(key, pts);
    return pts;
  };

  const polys: MeshFace[] = [];
  // Faces: each corner at a touched point is replaced by the points where its two edges meet it.
  s.polys.forEach((f, fi) => {
    const v: number[] = [];
    f.v.forEach((i, k) => {
      if (!touched.has(i)) return void v.push(i);
      const { p, n, bp, bn } = cornerInfo(fi, k);
      if (bp && bn) return void v.push(Q(fi, k));
      const a = side(fi, k, p);
      const c = side(fi, k, n);
      v.push(a);
      if (c !== a) v.push(c);
    });
    polys.push(copyPoly(f, v.filter((x, j) => x !== v[(j + 1) % v.length] || v.length < 2)));
  });
  // Strips along bevelled edges.
  for (const key of sharp) {
    const [a, c] = key.split(",").map(Number) as [number, number];
    const pa = [...arc(a, c)].reverse(); // a's arc runs B -> A; the strip runs A -> B
    const pc = arc(c, a);
    if (pa.length !== pc.length || pa.length < 2) continue;
    for (let j = 0; j + 1 < pa.length; j++) {
      const strip: MeshFace = { v: [pc[j]!, pa[j]!, pa[j + 1]!, pc[j + 1]!] };
      const owner = s.polys[faceTraversing(a, c)!]!;
      if (owner.color) strip.color = owner.color;
      if (segs > 1) strip.smooth = true;
      polys.push(strip);
    }
  }
  // Caps where bevelled edges meet: walk the faces around the point to get the ring in order.
  for (const v of touched) {
    const corners = cornersAt[v]!.map(({ f, k }) => ({ f, ...cornerInfo(f, k) }));
    // A face's wedge runs from its next edge counter-clockwise to its previous edge, so the face after it has that previous edge as its next.
    const byNext = new Map(corners.map((c) => [c.n, c]));
    if (byNext.size !== corners.length) continue;
    const ring: number[] = [];
    let at = corners[0]!;
    let closed = false;
    for (let guard = 0; guard <= corners.length; guard++) {
      // Points along this face's wedge: from the edge before it to the edge after it (counter-clockwise).
      const edge = at.n; // the edge this wedge starts at; the arc or point of that edge comes first
      if (sharp.has(edgeKey(v, edge))) ring.push(...arc(v, edge));
      else ring.push(T(v, edge));
      const nextCorner = byNext.get(at.p);
      if (!nextCorner) break;
      at = nextCorner;
      if (at === corners[0]) {
        closed = true;
        break;
      }
    }
    if (!closed) continue;
    const clean = ring.filter((x, j) => x !== ring[(j + 1) % ring.length]);
    if (new Set(clean).size >= 3) {
      const owner = s.polys[corners[0]!.f]!;
      const cap: MeshFace = { v: clean };
      if (owner.color) cap.color = owner.color;
      if (segs > 1 && corners.some((c) => c.bp || c.bn)) cap.smooth = true;
      polys.push(cap);
    }
  }
  return compactSoup({ verts, polys });
}

// ---------------------------------------------------------------------------------------------
// Solidify

export function solidify(s: Soup, m: SolidifyMod): Soup {
  const thickness = m.thickness ?? 1;
  const offset = Math.max(-1, Math.min(1, m.offset ?? -1));
  if (!thickness || !s.polys.length) return s;
  const n = s.verts.length;
  const faceN = s.polys.map((f) => norm(polyNormal(s.verts, f.v)));
  const vn: Vec3[] = s.verts.map(() => [0, 0, 0]);
  s.polys.forEach((f, fi) => {
    const area = polyNormal(s.verts, f.v);
    for (const i of f.v) vn[i] = add(vn[i]!, area);
  });
  const dirs: Vec3[] = vn.map((v, i) => {
    const d = norm(v);
    if (m.even === false) return d;
    // Slanted walls: scale so the wall is `thickness` thick measured across the faces, not along the normal.
    let worst = 1;
    s.polys.forEach((f, fi) => { if (f.v.includes(i)) worst = Math.min(worst, dot(d, faceN[fi]!)); });
    return mul(d, 1 / Math.max(0.25, worst));
  });
  const outer = (offset + 1) / 2;
  const inner = (offset - 1) / 2;
  const verts: Vec3[] = [];
  for (let i = 0; i < n; i++) verts.push(add(s.verts[i]!, mul(dirs[i]!, thickness * outer)));
  for (let i = 0; i < n; i++) verts.push(add(s.verts[i]!, mul(dirs[i]!, thickness * inner)));
  const polys: MeshFace[] = s.polys.map((f) => copyPoly(f, [...f.v]));
  for (const f of s.polys) polys.push(copyPoly(f, f.v.map((i) => i + n).reverse()));
  // A wall along every open edge.
  const count = new Map<string, number>();
  for (const f of s.polys) f.v.forEach((a, k) => { const key = edgeKey(a, f.v[(k + 1) % f.v.length]!); count.set(key, (count.get(key) ?? 0) + 1); });
  for (const f of s.polys) {
    f.v.forEach((a, k) => {
      const c = f.v[(k + 1) % f.v.length]!;
      if (count.get(edgeKey(a, c)) !== 1) return;
      polys.push(copyPoly(f, [a, a + n, c + n, c]));
    });
  }
  // A negative thickness would turn everything inside out.
  if (thickness < 0) polys.forEach((p) => p.v.reverse());
  return { verts, polys, ...(s.creases ? { creases: mapCreases(s.creases, (i) => i, (i) => i + n) } : {}) };
}

// ---------------------------------------------------------------------------------------------
// Array

export function array(s: Soup, m: ArrayMod): Soup {
  const count = Math.max(1, Math.min(MAX_ARRAY, Math.round(m.count ?? 2)));
  if (count < 2 || !s.verts.length) return s;
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of s.verts) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a]!, p[a]!); hi[a] = Math.max(hi[a]!, p[a]!); }
  const step = add(m.offset ?? [0, 0, 0], [0, 1, 2].map((a) => (m.relative?.[a] ?? 0) * (hi[a]! - lo[a]!)) as Vec3);
  // Respect the element limits.
  const fit = Math.max(1, Math.min(count, Math.floor(MAX_VERTS / Math.max(1, s.verts.length)), Math.floor(MAX_FACES / Math.max(1, s.polys.length))));
  const verts: Vec3[] = [];
  const polys: MeshFace[] = [];
  for (let c = 0; c < fit; c++) {
    const base = verts.length;
    for (const p of s.verts) verts.push(add(p, mul(step, c)));
    for (const f of s.polys) polys.push(copyPoly(f, f.v.map((i) => i + base)));
  }
  let creases: Map<string, number> | undefined;
  if (s.creases) {
    creases = new Map();
    for (let c = 0; c < fit; c++) for (const [key, w] of s.creases) {
      const [a, b] = key.split(",").map(Number) as [number, number];
      creases.set(edgeKey(a + c * s.verts.length, b + c * s.verts.length), w);
    }
  }
  const merge = m.merge ?? 0;
  if (merge <= 0) return { verts, polys, ...(creases ? { creases } : {}) };
  // Only points of different copies are joined.
  const n = s.verts.length;
  return weldSoup({ verts, polys, ...(creases ? { creases } : {}) }, merge, (a, b) => Math.floor(a / n) !== Math.floor(b / n));
}

// ---------------------------------------------------------------------------------------------
// Revolve (lathe)

export function revolve(s: Soup, m: RevolveMod): Soup {
  const profile = s.verts;
  if (profile.length < 2) return { verts: [], polys: [] };
  const axis = axisIndex(m.axis ?? "y");
  const steps = Math.max(2, Math.min(MAX_REVOLVE, Math.round(m.segments ?? 24)));
  const angle = Math.max(1, Math.min(360, m.angle ?? 360));
  const full = angle >= 359.999;
  const sharp = Math.max(0, Math.min(180, m.sharp ?? 40));
  // Profile as (radius, height): the axis's own coordinate is the height, the next one round is the radius.
  const radius = axis === 0 ? 1 : 0;
  const pr = profile.map((p) => Math.abs(p[radius]!));
  const ph = profile.map((p) => p[axis]!);
  const segs: [number, number][] = [];
  for (let i = 0; i + 1 < profile.length; i++) segs.push([i, i + 1]);
  if (m.closed && profile.length > 2) segs.push([profile.length - 1, 0]);
  const dir = (j: number): [number, number] => {
    const [a, b] = segs[j]!;
    const dx = pr[b]! - pr[a]!, dy = ph[b]! - ph[a]!, l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  };
  const verts: Vec3[] = [];
  const polys: MeshFace[] = [];
  const at = (r: number, h: number, theta: number): Vec3 => {
    // (x, y, z) = (r cos, h, r sin) turned so that `h` lies on the chosen axis (a cyclic move keeps the faces facing outwards)
    const base: Vec3 = [r * Math.cos(theta), h, r * Math.sin(theta)];
    return axis === 1 ? base : axis === 0 ? [base[1], base[2], base[0]] : [base[2], base[0], base[1]];
  };
  const poles = new Map<number, number[]>();
  const ring = (point: number): number[] => {
    const r = pr[point]!, h = ph[point]!;
    if (r < 1e-9) {
      // a point on the axis is one point, however many segments meet there
      if (!poles.has(point)) poles.set(point, [verts.push(at(0, h, 0)) - 1]);
      return poles.get(point)!;
    }
    const count = full ? steps : steps + 1;
    return Array.from({ length: count }, (_, k) => verts.push(at(r, h, (((angle * Math.PI) / 180) * k) / steps)) - 1);
  };
  // One ring per segment end; a profile point shared by two gentle segments shares its ring.
  const rings: [number[], number[]][] = [];
  const shared = new Map<number, number[]>();
  segs.forEach(([a, b], j) => {
    const ends: number[][] = [];
    for (const [point, other, side] of [[a, j - 1, 0], [b, j + 1, 1]] as const) {
      const prev = side === 0 ? (j > 0 ? j - 1 : m.closed && segs.length > 1 ? segs.length - 1 : -1) : (j + 1 < segs.length ? j + 1 : m.closed && segs.length > 1 ? 0 : -1);
      void other;
      let turn = 180;
      if (prev >= 0) {
        const d1 = side === 0 ? dir(prev) : dir(j);
        const d2 = side === 0 ? dir(j) : dir(prev);
        turn = (Math.acos(Math.max(-1, Math.min(1, d1[0] * d2[0] + d1[1] * d2[1]))) * 180) / Math.PI;
      }
      if (turn <= sharp) {
        let r = shared.get(point);
        if (!r) shared.set(point, (r = ring(point)));
        ends.push(r);
      } else ends.push(ring(point));
    }
    rings.push([ends[0]!, ends[1]!]);
  });
  const wrap = (r: number[], k: number) => r[full ? k % r.length : k]!;
  for (const [A, B] of rings) {
    for (let k = 0; k < steps; k++) {
      const quad = [wrap(A, k), wrap(B, k), wrap(B, k + 1), wrap(A, k + 1)].filter((v, i, all) => v !== all[(i + 1) % 4] || all.length < 2);
      const unique = quad.filter((v, i) => quad.indexOf(v) === i);
      if (unique.length < 3) continue;
      polys.push({ v: unique, smooth: true });
    }
  }
  if (m.flip) polys.forEach((p) => p.v.reverse());
  return { verts, polys };
}

// ---------------------------------------------------------------------------------------------
// The stack

/// The modifiers that work on a whole mesh at once go through the editor's own mesh functions (lib/mesh-ops.ts) on a plain element made from the soup.
function throughCube(s: Soup, fn: (c: Cube) => Cube, keepCreases: boolean): Soup {
  const cube: Cube = { shape: "mesh", from: [0, 0, 0], size: [0, 0, 0], color: "#c9d1d9", verts: s.verts.map((p) => [...p] as Vec3), polys: s.polys.map((f) => copyPoly(f, [...f.v])) };
  const out = fn(cube);
  return { verts: out.verts ?? [], polys: (out.polys ?? []).map((f) => copyPoly(f, [...f.v])), ...(keepCreases && s.creases ? { creases: s.creases } : {}) };
}

export type Stage = "view" | "render";

export function applyModifier(s: Soup, m: Modifier, stage: Stage): Soup {
  switch (m.type) {
    case "cutout": {
      let verts = s.verts.map((p) => [...p] as Vec3), polys = s.polys;
      for (const cut of m.cuts ?? []) ({ verts, polys } = applyCut(verts, polys, cut));
      return compactSoup({ verts, polys, ...(s.creases ? { creases: s.creases } : {}) });
    }
    case "mirror": return mirror(s, m);
    case "subsurf": return subsurf(s, stage === "render" ? m.renderLevels ?? 2 : m.levels ?? 1, m.smooth !== false);
    case "bevel": return bevel(s, m);
    case "solidify": return solidify(s, m);
    case "array": return array(s, m);
    case "revolve": return revolve(s, m);
    case "weld": return weldSoup(s, Math.max(0, m.distance ?? 0.01));
    case "triangulate": return throughCube(s, (c) => triangulateCube(c), true);
    case "decimate": return throughCube(s, (c) => decimateCube(c, m.ratio ?? 0.5), false);
    case "displace": return throughCube(s, (c) => displaceCube(c, m.amount ?? 0.5, m.scale ?? 4, m.seed ?? 1), true);
    case "deform": return throughCube(s, (c) => simpleDeform(c, m.kind ?? "bend", axisIndex(m.axis ?? "y") as 0 | 1 | 2, m.amount ?? 45), true);
    case "wireframe": return wireframe(s, m.thickness ?? 0.5);
    case "shrinkwrap": return shrinkwrap(s, m.kind ?? "sphere", axisIndex(m.axis ?? "y") as 0 | 1 | 2, m.factor ?? 1, m.radius ?? 0);
    case "lattice": return lattice(s, m.corners ?? ZERO_LATTICE());
    case "edgesplit": return edgeSplit(s, m.angle ?? 30);
    case "remesh": return remeshBlocks(s, m.voxel ?? 2);
    case "curve": return curveDeform(s, m.points ?? [], axisIndex(m.axis ?? "x") as 0 | 1 | 2);
    case "boolean": {
      const solid = booleanPieces(piecesOf(s.verts, s.polys), cutterPieces(m.shape ?? "box", m.at ?? [0, 0, 0], m.size ?? [8, 8, 8]), m.operation ?? "difference");
      const out = meshOf(solid);
      return { verts: out.verts, polys: out.polys };
    }
    case "smooth": return throughCube(s, (c) => smoothVerts(c, undefined, m.factor ?? 0.5, m.passes ?? 2), true);
  }
}

export const isActive = (m: Modifier, stage: Stage) => (stage === "view" ? m.show !== false : m.render !== false);

/// Whether the element has modifiers that would change what is drawn at that stage.
export function hasModifiers(c: Cube, stage: Stage = "view"): boolean {
  return !!c.modifiers?.some((m) => isActive(m, stage)) && !c.skin;
}

/// The finished mesh: the element's cage with the visible (or exported) modifiers applied in order.
/// An element without modifiers comes back as it is. A skinned mesh ignores its modifiers (they would break its weights).
/// The result is a plain mesh element with no modifiers and no texture placement (its polygons are new).
export function evaluate(c: Cube, stage: Stage = "view"): Cube {
  if (!hasModifiers(c, stage)) return c;
  const base = toMesh(c);
  let soup = soupOf(base);
  for (const m of c.modifiers!) {
    if (!isActive(m, stage)) continue;
    soup = applyModifier(soup, m, stage);
    if (soup.verts.length > MAX_VERTS || soup.polys.length > MAX_FACES) break;
  }
  const out: Cube = { ...(c.name ? { name: c.name } : {}), shape: "mesh", from: [0, 0, 0], size: [0, 0, 0], color: c.color, verts: soup.verts, polys: soup.polys };
  if (c.emissive !== undefined) out.emissive = c.emissive;
  if (c.metallic !== undefined) out.metallic = c.metallic;
  if (c.roughness !== undefined) out.roughness = c.roughness;
  if (c.coat !== undefined) out.coat = c.coat;
  if (c.glass !== undefined) out.glass = c.glass;
  const kept = [...(soup.creases ?? [])].filter(([, w]) => Number.isFinite(w) && w > 0);
  if (kept.length) out.creases = kept.map(([k, w]) => { const [a, b] = k.split(",").map(Number) as [number, number]; return [a, b, Math.min(1, w / CREASE_LEVELS)] as [number, number, number]; });
  fitBounds(out);
  return out;
}

/// The finished mesh as the shapes the exporter writes: the faces a Cut-out gave a surface of their own (glass, a glowing lamp) come back as separate shapes
/// with that surface, the rest as one shape with the element's own. An element whose faces all share its surface comes back alone.
export function evaluateSurfaces(c: Cube, stage: Stage = "render"): Cube[] {
  const done = evaluate(c, stage);
  if (!done.polys?.some((f) => f.mat)) return [done];
  const groups = new Map<string, { mat: MeshFace["mat"]; polys: MeshFace[] }>();
  for (const f of done.polys) {
    const k = f.mat ? `${f.mat.metallic ?? ""}/${f.mat.roughness ?? ""}/${f.mat.emissive ?? ""}/${f.mat.coat ?? ""}/${f.mat.glass ?? ""}` : "";
    const g = groups.get(k) ?? { mat: f.mat, polys: [] };
    const { mat: _mat, ...plain } = f;
    g.polys.push(plain);
    groups.set(k, g);
  }
  return [...groups.values()].map(({ mat, polys }) => {
    const part = compactSoup({ verts: done.verts!, polys });
    const out: Cube = { ...done, verts: part.verts, polys: part.polys };
    delete out.creases;
    if (mat?.metallic !== undefined) out.metallic = mat.metallic;
    if (mat?.roughness !== undefined) out.roughness = mat.roughness;
    if (mat?.emissive !== undefined) out.emissive = mat.emissive;
    if (mat) { if (mat.coat !== undefined) out.coat = mat.coat; else delete out.coat; } // (a surface of its own is not lacquered unless it says so)
    if (mat) { if (mat.glass !== undefined) out.glass = mat.glass; else delete out.glass; } // (nor glass)
    fitBounds(out);
    return out;
  });
}

/// Bakes the modifiers into the cage itself (Blender's "Apply"): `upTo` is how many modifiers from the top of the stack to bake
/// (the first one by default). What is baked uses the editor's own (view) settings. Keeps the rest of the stack.
export function applyStack(c: Cube, upTo = 1): Cube {
  const list = c.modifiers ?? [];
  const take = list.slice(0, upTo);
  const rest = list.slice(upTo);
  const baked = evaluate({ ...toMesh(c), modifiers: take.filter((m) => m.show !== false) }, "view");
  const out: Cube = { ...(baked === c ? toMesh(c) : baked) };
  delete out.modifiers;
  if (rest.length) out.modifiers = rest;
  return out;
}

/// Checks a modifier read from a file; returns a message for the first problem.
export function checkModifier(m: unknown, at: string): string | null {
  if (!m || typeof m !== "object") return `${at} must be an object`;
  const o = m as Record<string, unknown>;
  if (!MODIFIER_TYPES.includes(o.type as ModifierType)) return `${at}.type must be one of ${MODIFIER_TYPES.join(", ")}`;
  const num = (k: string, lo: number, hi: number, whole = false) => {
    const v = o[k];
    if (v === undefined) return null;
    return typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi && (!whole || Number.isInteger(v)) ? null : `${at}.${k} must be ${whole ? "a whole " : "a "}number from ${lo} to ${hi}`;
  };
  const flag = (k: string) => (o[k] === undefined || typeof o[k] === "boolean" ? null : `${at}.${k} must be true or false`);
  const vec = (k: string) => (o[k] === undefined || (Array.isArray(o[k]) && (o[k] as unknown[]).length === 3 && (o[k] as unknown[]).every((x) => typeof x === "number" && Number.isFinite(x))) ? null : `${at}.${k} must be three numbers`);
  const problems = [flag("show"), flag("render")];
  switch (o.type) {
    case "mirror":
      if (!MOD_AXES.includes(o.axis as ModAxis)) return `${at}.axis must be x, y or z`;
      problems.push(num("center", -1e6, 1e6), num("merge", 0, 1e6), flag("clip"));
      break;
    case "subsurf":
      problems.push(num("levels", 0, MAX_SUBSURF, true), num("renderLevels", 0, MAX_SUBSURF, true), flag("smooth"));
      break;
    case "bevel":
      problems.push(num("width", 0, 1e6), num("segments", 1, MAX_BEVEL_SEGMENTS, true), num("angle", 0, 180));
      break;
    case "solidify":
      problems.push(num("thickness", -1e6, 1e6), num("offset", -1, 1), flag("even"));
      break;
    case "revolve":
      if (o.axis !== undefined && !MOD_AXES.includes(o.axis as ModAxis)) return `${at}.axis must be x, y or z`;
      problems.push(num("segments", 2, MAX_REVOLVE, true), num("angle", 1, 360), num("sharp", 0, 180), flag("closed"), flag("flip"));
      break;
    case "array":
      problems.push(num("count", 1, MAX_ARRAY, true), vec("offset"), vec("relative"), num("merge", 0, 1e6));
      break;
    case "weld":
      problems.push(num("distance", 0, 1e6));
      break;
    case "triangulate":
      break;
    case "decimate":
      problems.push(num("ratio", 0.05, 1));
      break;
    case "displace":
      problems.push(num("amount", -1e6, 1e6), num("scale", 0.001, 1e6), num("seed", 1, 1e6, true));
      break;
    case "deform":
      if (o.kind !== undefined && !(DEFORMS as string[]).includes(o.kind as string)) return `${at}.kind must be one of ${DEFORMS.join(", ")}`;
      if (o.axis !== undefined && !MOD_AXES.includes(o.axis as ModAxis)) return `${at}.axis must be x, y or z`;
      problems.push(num("amount", -1e6, 1e6));
      break;
    case "smooth":
      problems.push(num("factor", 0.1, 1), num("passes", 1, 20, true));
      break;
    case "wireframe":
      problems.push(num("thickness", 0.001, 1e6));
      break;
    case "shrinkwrap":
      if (o.kind !== undefined && !["sphere", "cylinder", "plane"].includes(o.kind as string)) return `${at}.kind must be sphere, cylinder or plane`;
      if (o.axis !== undefined && !MOD_AXES.includes(o.axis as ModAxis)) return `${at}.axis must be x, y or z`;
      problems.push(num("factor", 0, 1), num("radius", 0, 1e6));
      break;
    case "cutout":
      problems.push(checkCuts(o.cuts, at));
      break;
    case "edgesplit":
      problems.push(num("angle", 0, 180));
      break;
    case "remesh":
      problems.push(num("voxel", 0.01, 1e6));
      break;
    case "curve": {
      if (o.axis !== undefined && !MOD_AXES.includes(o.axis as ModAxis)) return `${at}.axis must be x, y or z`;
      const pts = o.points;
      if (pts !== undefined && !(Array.isArray(pts) && pts.length >= 2 && pts.length <= 16 && pts.every((v) => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x))))) return `${at}.points must be 2 to 16 points of three numbers`;
      break;
    }
    case "boolean": {
      if (o.operation !== undefined && !(BOOLEAN_OPS as string[]).includes(o.operation as string)) return `${at}.operation must be union, difference or intersect`;
      if (o.shape !== undefined && !(CUTTER_SHAPES as string[]).includes(o.shape as string)) return `${at}.shape must be box, cylinder or sphere`;
      problems.push(vec("at"), vec("size"));
      break;
    }
    case "lattice": {
      const c = o.corners;
      if (c !== undefined && !(Array.isArray(c) && c.length === 8 && c.every((v) => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x))))) return `${at}.corners must be eight offsets of three numbers`;
      break;
    }
  }
  return problems.find((p) => p) ?? null;
}
