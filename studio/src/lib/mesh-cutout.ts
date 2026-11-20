// Cut-outs (Blender's "knife project"): an outline drawn in one of the standard views is pressed onto the surface it faces. The faces it crosses are cut along
// it, so the area inside becomes faces of its own, which can then take a colour and a surface (a window, a lamp lens), sink into the body as a pocket with walls
// (a grille, a recessed lamp, a panel gap), or be taken away (a wheel arch, with a rolled-in lip if it has depth). This is how detail is cut INTO a smooth
// subdivided body instead of being laid on top of it. Pure functions on points and polygons; the modifier stack runs them (`cutout` in modifiers.ts).

import type { MeshFace, Vec3 } from "./model-doc";

export type CutView = "side" | "front" | "back" | "top" | "bottom";
export const CUT_VIEWS: CutView[] = ["side", "front", "back", "top", "bottom"];
export const MAX_CUTS = 96;
export const MAX_CUT_POINTS = 96;

/// One outline. Its points are in the view's own plane: `side` (z, y), seen from either flank; `front` and `back` (x, y); `top` and `bottom` (x, z).
export interface Cut {
  name?: string;
  view: CutView;
  /// The closed outline, at least three points, either way round.
  points: [number, number][];
  /// Front, back, top and bottom: also cut the outline's mirror image across x = 0 (a pair of lamps from one drawing).
  mirror?: boolean;
  /// Side view: cut only the flank on this side ("+x" or "-x"); both when missing (a fuel flap is on one side only).
  only?: "+x" | "-x";
  /// Colour of the faces inside (missing: they keep theirs).
  color?: string;
  /// Take the faces inside away (an opening).
  remove?: boolean;
  /// Sink the inside this far along the line of sight, with walls round it (0 or missing: flush). With `remove`, only the walls are made: a rolled-in lip.
  depth?: number;
  /// Colour of the walls (missing: the inside colour, darkened). Walls are always matt.
  wall?: string;
  /// The surface of the faces inside, when it differs from the shape's own: glass, a lamp that glows.
  metallic?: number;
  roughness?: number;
  emissive?: number;
  coat?: number;
  /// How squarely a face must look at the view to be cut, 0 (edge on) to 1 (facing it exactly); default 0.2. Below 0 (to -1) faces that look away are cut too
  /// (a wheel opening goes through the sill's underside as well).
  facing?: number;
  /// Only faces whose middle is between these two distances along the line of sight (model units; side: |x|, front and back: z, top and bottom: y).
  near?: number;
  far?: number;
  /// Shade the inside flat instead of following the body's curve.
  flat?: boolean;
}

type P2 = [number, number];
interface Frame { a: 0 | 1 | 2; b: 0 | 1 | 2; d: 0 | 1 | 2; sign: 1 | -1 | 0 }
const FRAMES: Record<CutView, Frame> = {
  side: { a: 2, b: 1, d: 0, sign: 0 },
  front: { a: 0, b: 1, d: 2, sign: 1 },
  back: { a: 0, b: 1, d: 2, sign: -1 },
  top: { a: 0, b: 2, d: 1, sign: 1 },
  bottom: { a: 0, b: 2, d: 1, sign: -1 },
};
const EPS = 1e-5;
/// The walls of a pocket are matt whatever the body is made of (a lacquered wall a few millimetres wide only glitters).
const WALL = { metallic: 0, roughness: 0.9 };
const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);

function newell(verts: Vec3[], v: number[]): Vec3 {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < v.length; i++) {
    const p = verts[v[i]!]!, q = verts[v[(i + 1) % v.length]!]!;
    nx += (p[1] - q[1]) * (p[2] + q[2]);
    ny += (p[2] - q[2]) * (p[0] + q[0]);
    nz += (p[0] - q[0]) * (p[1] + q[1]);
  }
  return [nx, ny, nz];
}
function inside(o: P2[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = o.length - 1; i < o.length; j = i++) {
    const [xi, yi] = o[i]!, [xj, yj] = o[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const darker = (hex: string, k: number) => "#" + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * k).toString(16).padStart(2, "0")).join("");

interface Piece { face: MeshFace; dir: 1 | -1 }

/// Presses one outline onto the mesh. Returns new lists (the points of `verts` are kept and added to).
export function applyCut(vertsIn: Vec3[], polysIn: MeshFace[], cut: Cut, fallbackColor = "#888888"): { verts: Vec3[]; polys: MeshFace[]; cut: number } {
  const fr = FRAMES[cut.view];
  const verts = vertsIn;
  if (!cut.points || cut.points.length < 3) return { verts, polys: polysIn, cut: 0 };
  const outlines: P2[][] = [cut.points.map((p) => [p[0], p[1]] as P2)];
  if (cut.mirror && cut.view !== "side") outlines.push(cut.points.map((p) => [-p[0], p[1]] as P2));
  const facing = cut.facing ?? 0.2;
  let polys = polysIn;
  let total = 0;
  for (const o of outlines) {
    let lo: P2 = [Infinity, Infinity], hi: P2 = [-Infinity, -Infinity];
    for (const [x, y] of o) { lo = [Math.min(lo[0], x), Math.min(lo[1], y)]; hi = [Math.max(hi[0], x), Math.max(hi[1], y)]; }
    const p2 = (i: number): P2 => [verts[i]![fr.a], verts[i]![fr.b]];
    // which faces the outline may touch: looking at the view, in range, with their box over the outline's
    const rest: MeshFace[] = [];
    let work: Piece[] = [];
    for (const f of polys) {
      const n = newell(verts, f.v);
      const l = Math.hypot(n[0], n[1], n[2]);
      const along = l > 1e-12 ? n[fr.d] / l : 0;
      // (from the side, a face belongs to the flank it is on: the side of the middle its own middle lies)
      let side = 0;
      if (fr.sign === 0) for (const i of f.v) side += verts[i]![0];
      const dir: 1 | -1 = fr.sign !== 0 ? fr.sign : side >= 0 ? 1 : -1;
      let ok = along * dir >= facing;
      if (ok && cut.view === "side" && cut.only) ok = (cut.only === "+x") === (dir > 0);
      if (ok) {
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, mid = 0;
        for (const i of f.v) { const [x, y] = p2(i); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); mid += verts[i]![fr.d] / f.v.length; }
        const depth = cut.view === "side" ? Math.abs(mid) : mid;
        ok = x1 >= lo[0] - EPS && x0 <= hi[0] + EPS && y1 >= lo[1] - EPS && y0 <= hi[1] + EPS && (cut.near === undefined || depth >= cut.near) && (cut.far === undefined || depth <= cut.far);
      }
      if (ok) work.push({ face: f, dir }); else rest.push(f);
    }
    if (!work.length) continue;
    // cut every face an edge of the outline passes through along that edge's line
    const split = new Map<string, number[]>(); // an edge that got new points: for the faces beside it that were not cut
    for (let e = 0; e < o.length; e++) {
      const p = o[e]!, q = o[(e + 1) % o.length]!;
      const ex = q[0] - p[0], ey = q[1] - p[1];
      const el = Math.hypot(ex, ey);
      if (el < EPS) continue;
      const made = new Map<string, number>();
      const next: Piece[] = [];
      for (const piece of work) {
        const v = piece.face.v;
        const pts = v.map(p2);
        const s = pts.map(([x, y]) => (ex * (y - p[1]) - ey * (x - p[0])) / el);
        const pos = s.some((d) => d > EPS), neg = s.some((d) => d < -EPS);
        if (!pos || !neg) { next.push(piece); continue; }
        // does the edge itself (not just its line) reach this face? clip it to the face, taken as convex
        let t0 = 0, t1 = 1, area = 0;
        for (let i = 0; i < pts.length; i++) { const a = pts[i]!, b = pts[(i + 1) % pts.length]!; area += a[0] * b[1] - b[0] * a[1]; }
        const ccw = area >= 0 ? 1 : -1;
        for (let i = 0; i < pts.length && t0 <= t1; i++) {
          const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
          const nx = -(b[1] - a[1]) * ccw, ny = (b[0] - a[0]) * ccw; // points into the face
          const d0 = nx * (p[0] - a[0]) + ny * (p[1] - a[1]), dd = nx * ex + ny * ey;
          if (Math.abs(dd) < 1e-12) { if (d0 < -EPS) t0 = 2; continue; }
          const t = -d0 / dd;
          if (dd > 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
        }
        if (t1 - t0 < EPS / el) { next.push(piece); continue; }
        const A: number[] = [], B: number[] = [];
        for (let i = 0; i < v.length; i++) {
          const j = (i + 1) % v.length, si = s[i]!, sj = s[j]!;
          if (si >= -EPS) A.push(v[i]!);
          if (si <= EPS) B.push(v[i]!);
          if ((si > EPS && sj < -EPS) || (si < -EPS && sj > EPS)) {
            const k = key(v[i]!, v[j]!);
            let m = made.get(k);
            if (m === undefined) {
              const t = si / (si - sj), a = verts[v[i]!]!, b = verts[v[j]!]!;
              m = verts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]) - 1;
              made.set(k, m);
              split.set(k, [...(split.get(k) ?? []), m]);
            }
            A.push(m); B.push(m);
          }
        }
        for (const loop of [A, B]) if (loop.length >= 3) next.push({ face: { ...piece.face, v: loop }, dir: piece.dir });
        total++;
      }
      work = next;
    }
    // the faces beside a cut edge take its new points too, so the surface stays closed
    const expand = (a: number, b: number, depth = 0): number[] => {
      const mids = split.get(key(a, b));
      if (!mids || depth > 12) return [];
      const pa = verts[a]!, pb = verts[b]!;
      const t = (m: number) => { const pm = verts[m]!; return (pm[0] - pa[0]) * (pb[0] - pa[0]) + (pm[1] - pa[1]) * (pb[1] - pa[1]) + (pm[2] - pa[2]) * (pb[2] - pa[2]); };
      const sorted = [...mids].sort((x, y) => t(x) - t(y));
      const out: number[] = [];
      let from = a;
      for (const m of sorted) { out.push(...expand(from, m, depth + 1), m); from = m; }
      out.push(...expand(from, b, depth + 1));
      return out;
    };
    const mend = (f: MeshFace): MeshFace => {
      if (!split.size) return f;
      const v: number[] = [];
      let changed = false;
      for (let i = 0; i < f.v.length; i++) {
        const a = f.v[i]!, b = f.v[(i + 1) % f.v.length]!;
        v.push(a);
        const more = expand(a, b).filter((m) => !f.v.includes(m) && !v.includes(m));
        if (more.length) { v.push(...more); changed = true; }
      }
      return changed ? { ...f, v } : f;
    };
    const out: MeshFace[] = rest.map(mend);
    const within: Piece[] = [];
    for (const piece of work) {
      const face = mend(piece.face);
      let cx = 0, cy = 0;
      for (const i of face.v) { const [x, y] = p2(i); cx += x / face.v.length; cy += y / face.v.length; }
      if (inside(o, cx, cy)) within.push({ face, dir: piece.dir }); else out.push(face);
    }
    // what happens to the inside
    const depth = cut.depth ?? 0;
    const paint = (f: MeshFace): MeshFace => {
      const g: MeshFace = { ...f };
      if (cut.color) g.color = cut.color;
      if (cut.flat) delete g.smooth;
      if (cut.metallic !== undefined || cut.roughness !== undefined || cut.emissive !== undefined || cut.coat !== undefined) {
        g.mat = { ...(cut.metallic !== undefined ? { metallic: cut.metallic } : {}), ...(cut.roughness !== undefined ? { roughness: cut.roughness } : {}), ...(cut.emissive !== undefined ? { emissive: cut.emissive } : {}), ...(cut.coat !== undefined ? { coat: cut.coat } : {}) };
      }
      return g;
    };
    if (depth > 0) {
      // a wall stands where the inside meets the rest of the surface (not along the surface's own open border)
      const edges = new Set<string>();
      for (const face of out) for (let i = 0; i < face.v.length; i++) edges.add(`${face.v[i]},${face.v[(i + 1) % face.v.length]}`);
      const sunk = new Map<string, number>();
      const sink = (i: number, dir: number) => {
        const k = `${i},${dir}`;
        let m = sunk.get(k);
        if (m === undefined) {
          const p = [...verts[i]!] as Vec3;
          p[fr.d] -= dir * depth;
          m = verts.push(p) - 1;
          sunk.set(k, m);
        }
        return m;
      };
      const walls: MeshFace[] = [];
      const wallColor = cut.wall ?? darker(cut.color ?? within[0]?.face.color ?? fallbackColor, 0.45);
      for (const { face, dir } of within) {
        for (let i = 0; i < face.v.length; i++) {
          const a = face.v[i]!, b = face.v[(i + 1) % face.v.length]!;
          if (edges.has(`${b},${a}`)) walls.push({ v: [a, b, sink(b, dir), sink(a, dir)], color: wallColor, mat: WALL });
        }
        if (!cut.remove) walls.push(paint({ ...face, v: face.v.map((i) => sink(i, dir)) }));
      }
      out.push(...walls);
    } else if (!cut.remove) for (const { face } of within) out.push(paint(face));
    polys = out;
  }
  return { verts, polys, cut: total };
}

/// Checks the `cuts` of a cut-out modifier read from a file; a message for the first problem.
export function checkCuts(cuts: unknown, at: string): string | null {
  if (cuts === undefined) return null;
  if (!Array.isArray(cuts) || cuts.length > MAX_CUTS) return `${at}.cuts must be a list of up to ${MAX_CUTS} outlines`;
  const isColor = (v: unknown) => typeof v === "string" && /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(v);
  for (const [i, raw] of cuts.entries()) {
    const w = `${at}.cuts[${i}]`;
    if (!raw || typeof raw !== "object") return `${w} must be an object`;
    const c = raw as Record<string, unknown>;
    if (!CUT_VIEWS.includes(c.view as CutView)) return `${w}.view must be one of ${CUT_VIEWS.join(", ")}`;
    const pts = c.points;
    if (!Array.isArray(pts) || pts.length < 3 || pts.length > MAX_CUT_POINTS || !pts.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number" && Number.isFinite(n)))) return `${w}.points must be 3 to ${MAX_CUT_POINTS} pairs of numbers`;
    for (const k of ["color", "wall"]) if (c[k] !== undefined && !isColor(c[k])) return `${w}.${k} must be like #c9d1d9`;
    for (const k of ["mirror", "remove", "flat"]) if (c[k] !== undefined && typeof c[k] !== "boolean") return `${w}.${k} must be true or false`;
    for (const [k, lo, hi] of [["depth", 0, 1e6], ["metallic", 0, 1], ["roughness", 0, 1], ["emissive", 0, 1], ["coat", 0, 1], ["facing", -1, 1], ["near", -1e6, 1e6], ["far", -1e6, 1e6]] as const) {
      const v = c[k];
      if (v !== undefined && !(typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi)) return `${w}.${k} must be a number from ${lo} to ${hi}`;
    }
    if (c.only !== undefined && c.only !== "+x" && c.only !== "-x") return `${w}.only must be "+x" or "-x"`;
    if (c.name !== undefined && typeof c.name !== "string") return `${w}.name must be text`;
  }
  return null;
}
