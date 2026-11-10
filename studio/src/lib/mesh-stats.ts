// What a model costs and what is wrong with it: triangle and point counts (after modifiers, as exported), open edges, edges shared by more than two
// faces, degenerate faces, loose points, and a budget bar against the triangles a model of that kind should stay under.

import { walk, type Cube, type ModelDoc } from "./model-doc";
import { evaluate } from "./modifiers";
import { toMesh } from "./mesh-edit";

export interface MeshStats {
  triangles: number;
  points: number;
  faces: number;
  /// Edges only one face uses (an open border) and edges more than two faces use (a fin).
  openEdges: number;
  fins: number;
  /// Faces with a zero-length edge or no area, and points no face uses.
  degenerate: number;
  loose: number;
}

const EMPTY: MeshStats = { triangles: 0, points: 0, faces: 0, openEdges: 0, fins: 0, degenerate: 0, loose: 0 };

const sum = (a: MeshStats, b: MeshStats): MeshStats => ({
  triangles: a.triangles + b.triangles, points: a.points + b.points, faces: a.faces + b.faces, openEdges: a.openEdges + b.openEdges, fins: a.fins + b.fins, degenerate: a.degenerate + b.degenerate, loose: a.loose + b.loose,
});

/// The statistics of one element as it is exported (its modifiers applied for the export).
export function statsOf(c: Cube): MeshStats {
  const m = toMesh(evaluate(c, "render"));
  const verts = m.verts ?? [];
  const polys = m.polys ?? [];
  const edges = new Map<string, number>();
  const used = new Set<number>();
  let triangles = 0;
  let degenerate = 0;
  for (const f of polys) {
    triangles += Math.max(0, f.v.length - 2);
    let flat = false;
    f.v.forEach((a, k) => {
      used.add(a);
      const b = f.v[(k + 1) % f.v.length]!;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
      const p = verts[a]!, q = verts[b]!;
      if (a === b || (p && q && Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1e-9)) flat = true;
    });
    if (new Set(f.v).size !== f.v.length) flat = true;
    if (!flat && f.v.length >= 3) {
      let nx = 0, ny = 0, nz = 0;
      for (let i = 0; i < f.v.length; i++) {
        const a = verts[f.v[i]!]!, b = verts[f.v[(i + 1) % f.v.length]!]!;
        nx += (a[1] - b[1]) * (a[2] + b[2]);
        ny += (a[2] - b[2]) * (a[0] + b[0]);
        nz += (a[0] - b[0]) * (a[1] + b[1]);
      }
      if (Math.hypot(nx, ny, nz) < 1e-12) flat = true;
    }
    if (flat) degenerate++;
  }
  let openEdges = 0, fins = 0;
  for (const n of edges.values()) (n === 1 ? openEdges++ : n > 2 && fins++);
  return { triangles, points: verts.length, faces: polys.length, openEdges, fins, degenerate, loose: verts.filter((_, i) => !used.has(i)).length };
}

export interface ModelStats extends MeshStats {
  parts: number;
  /// Per part, in the order of `walk`, with the path of part names.
  perPart: { name: string; stats: MeshStats }[];
}

export function modelStats(doc: ModelDoc): ModelStats {
  let total = EMPTY;
  const perPart: ModelStats["perPart"] = [];
  let parts = 0;
  for (const { part, depth } of walk(doc)) {
    parts++;
    let s = EMPTY;
    for (const c of part.cubes ?? []) s = sum(s, statsOf(c));
    total = sum(total, s);
    perPart.push({ name: `${"  ".repeat(depth)}${part.name}`, stats: s });
  }
  return { ...total, parts, perPart };
}

export type ModelKind = "prop" | "character" | "vehicle" | "hero";
/// Triangle budgets for a handheld at 60 fps (docs/performance.md and docs/switch-class-graphics.md: hero cars 15 to 40 thousand, props a few thousand).
export const BUDGETS: Record<ModelKind, { label: string; soft: number; hard: number }> = {
  prop: { label: "A prop", soft: 2000, hard: 5000 },
  character: { label: "A character", soft: 8000, hard: 20000 },
  vehicle: { label: "A vehicle", soft: 15000, hard: 30000 },
  hero: { label: "A hero model", soft: 25000, hard: 40000 },
};

export type BudgetState = "fine" | "heavy" | "over";

/// How full the budget is (0 to 1 and beyond: the share of the hard limit), and whether it is fine, past the comfortable size, or over the limit.
export function budgetOf(triangles: number, kind: ModelKind): { fraction: number; state: BudgetState; label: string } {
  const b = BUDGETS[kind];
  const state: BudgetState = triangles > b.hard ? "over" : triangles > b.soft ? "heavy" : "fine";
  const words = state === "fine" ? `${triangles.toLocaleString("en")} of about ${b.soft.toLocaleString("en")} triangles` : state === "heavy" ? `${triangles.toLocaleString("en")} triangles: past the comfortable ${b.soft.toLocaleString("en")}` : `${triangles.toLocaleString("en")} triangles: over the ${b.hard.toLocaleString("en")} a handheld should draw for this`;
  return { fraction: triangles / b.hard, state, label: `${b.label}: ${words}` };
}

/// Plain-words problems from the statistics, most important first.
export function problemsOf(s: MeshStats): string[] {
  const out: string[] = [];
  if (s.degenerate) out.push(`${s.degenerate} face${s.degenerate === 1 ? " has" : "s have"} no area (a repeated point): delete or weld them.`);
  if (s.fins) out.push(`${s.fins} edge${s.fins === 1 ? " is" : "s are"} used by more than two faces, which shades badly.`);
  if (s.loose) out.push(`${s.loose} point${s.loose === 1 ? " is" : "s are"} not used by any face.`);
  if (s.openEdges) out.push(`${s.openEdges} edge${s.openEdges === 1 ? " is" : "s are"} open (a hole or a thin sheet). That is fine for a flat panel, and shows through on a solid.`);
  return out;
}
