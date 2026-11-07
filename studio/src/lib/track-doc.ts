// The track editor's model: a racing route as a list of control points and a few settings, saved as `tracks/<name>.track.json`.
// The route itself, its statistics and the generated scene all come from the shared generator (scripts/lib/trackgen.mjs, plain
// JavaScript that the MCP server's `track_write` tool and Pine Ridge Rally's script use too): nothing here repeats its algorithm.
// @ts-ignore (plain JavaScript)
import { centreline, curvature, gateIndices, layout, paceNotes, roadGlb, stageMarks, tightest, ROAD_COLOURS } from "../../../scripts/lib/trackgen.mjs";

import { parseScene, serializeScene } from "./scene-model";

export type Point = [number, number];
export type RoadKind = "road_asphalt" | "road_dirt" | "road_snow" | "road_gravel" | "road_sand";

export const ROADS: { id: RoadKind; name: string; colour: string }[] = [
  { id: "road_asphalt", name: "Asphalt", colour: "#444" },
  { id: "road_dirt", name: "Dirt", colour: "#805e3d" },
  { id: "road_snow", name: "Snow", colour: "#99a8bd" },
  { id: "road_gravel", name: "Gravel", colour: "#4d4236" },
  { id: "road_sand", name: "Sand", colour: "#d1a86b" },
];

export interface TrackDoc {
  version: 1;
  /// A point-to-point stage instead of a loop.
  open: boolean;
  road: RoadKind;
  /// Control points [x, z] in metres; the route starts at the first, heading to the second.
  control: Point[];
  sections: number;
  leadIn: number;
  runout: number;
  seed: number;
  trees: string[];
  small: string[];
  rock: string[];
  /// Trees per piece of road, 0 to 1.
  density: number;
  rocks: number;
  lamps: boolean;
}

export const SPACING = 5; // metres between road points, as the generator lays them
export const MIN_POINTS = 4; // what `track_write` asks for
export const WARN_RADIUS = 15; // metres: a bend tighter than this is hard to drive
export const WARN_CLOSE = 40; // metres: two far-apart parts of the route closer than this touch or crowd each other
export const ROAD_WIDTH = 12;

/// A starting oval: a loop of eight points, 200 m by 120 m.
export function newTrack(): TrackDoc {
  return {
    version: 1, open: false, road: "road_asphalt",
    control: [[0, -60], [0, 40], [30, 110], [100, 140], [170, 110], [200, 40], [170, -30], [100, -60]],
    sections: 5, leadIn: 40, runout: 90, seed: 1, trees: [], small: [], rock: [], density: 0.4, rocks: 0.05, lamps: false,
  };
}

const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const names = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export type Parsed = { ok: true; doc: TrackDoc } | { ok: false; error: string };

export function parseTrack(text: string): Parsed {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `not valid JSON: ${e instanceof Error ? e.message : e}` };
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, error: "a track file is a JSON object" };
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.control)) return { ok: false, error: '"control" must be a list of [x, z] points' };
  const control: Point[] = [];
  for (const [i, p] of o.control.entries()) {
    if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== "number" || typeof p[1] !== "number" || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
      return { ok: false, error: `control[${i}] must be [x, z] numbers` };
    }
    control.push([p[0], p[1]]);
  }
  const d = newTrack();
  return {
    ok: true,
    doc: {
      version: 1,
      open: o.open === true,
      road: ROADS.some((r) => r.id === o.road) ? (o.road as RoadKind) : d.road,
      control,
      sections: Math.round(num(o.sections, d.sections, 1, 20)),
      leadIn: num(o.leadIn, d.leadIn, 10, 500),
      runout: num(o.runout, d.runout, 10, 500),
      seed: Math.round(num(o.seed, d.seed, 0, 2 ** 31)),
      trees: names(o.trees), small: names(o.small), rock: names(o.rock),
      density: num(o.density, d.density, 0, 1),
      rocks: num(o.rocks, d.rocks, 0, 1),
      lamps: o.lamps === true,
    },
  };
}

export function serializeTrack(doc: TrackDoc): string {
  const { control, ...rest } = doc;
  const lines = control.map((p) => `    [${round(p[0])}, ${round(p[1])}]`).join(",\n");
  const head = JSON.stringify(rest, null, 2).slice(0, -2); // (without the closing brace)
  return `${head},\n  "control": [\n${lines}\n  ]\n}\n`;
}

const round = (n: number) => Math.round(n * 10) / 10;

// ---- editing: every function returns a new document ---------------------------------------------------------------

/// Index of the control point within `reach` metres of (x, z), the nearest one, or -1.
export function pointAt(doc: TrackDoc, x: number, z: number, reach: number): number {
  let best = -1, bestD = reach;
  doc.control.forEach((p, i) => {
    const d = Math.hypot(p[0] - x, p[1] - z);
    if (d <= bestD) { best = i; bestD = d; }
  });
  return best;
}

/// Adds a point. Near the route (within `reach` metres of a stretch between two control points) it goes in between them; anywhere
/// else it goes on the end. Returns the new document and the new point's index.
export function addPoint(doc: TrackDoc, x: number, z: number, reach = 20): { doc: TrackDoc; index: number } {
  const p: Point = [round(x), round(z)];
  const c = doc.control;
  const n = c.length;
  let at = n, best = reach;
  const segments = doc.open ? n - 1 : n;
  for (let i = 0; i < segments && n >= 2; i++) {
    const a = c[i]!, b = c[(i + 1) % n]!;
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / len2));
    const d = Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
    if (d < best) { best = d; at = i + 1; }
  }
  const control = [...c.slice(0, at), p, ...c.slice(at)];
  return { doc: { ...doc, control }, index: at };
}

export function movePoint(doc: TrackDoc, index: number, x: number, z: number): TrackDoc {
  if (index < 0 || index >= doc.control.length) return doc;
  return { ...doc, control: doc.control.map((p, i): Point => (i === index ? [round(x), round(z)] : p)) };
}

/// Removes a point (the route keeps at least two).
export function removePoint(doc: TrackDoc, index: number): TrackDoc {
  if (doc.control.length <= 2 || index < 0 || index >= doc.control.length) return doc;
  return { ...doc, control: doc.control.filter((_, i) => i !== index) };
}

export function setField<K extends keyof TrackDoc>(doc: TrackDoc, key: K, value: TrackDoc[K]): TrackDoc {
  return { ...doc, [key]: value };
}

// ---- the route, and what can be said about it ---------------------------------------------------------------------

export interface RoadPoint { x: number; z: number; tx: number; tz: number; ry: number }

export interface Corner { s: number; left: boolean; grade: number }

export interface Marks {
  /// Index (into the route's points) of the start line.
  start: number;
  /// Index of the finish line, or null on a circuit.
  finish: number | null;
  /// Indices of the section gates; the last is the finish.
  gates: number[];
}

export interface TrackStats {
  line: RoadPoint[];
  /// Curvature at each point, in 1/metres; positive turns towards +x when heading +z.
  curv: number[];
  length: number;
  /// The tightest bend's radius in metres, and where.
  minRadius: number;
  tightestAt: Point;
  /// The closest two distant parts of the route, metres; null when no two parts count as distant.
  closest: number | null;
  marks: Marks;
  corners: Corner[];
  warnings: string[];
}

/// A route needs two points on a stage and three on a loop before it can be drawn.
export const drawable = (doc: TrackDoc) => doc.control.length >= (doc.open ? 2 : 3);

export function analyse(doc: TrackDoc): TrackStats | null {
  if (!drawable(doc)) return null;
  const line: RoadPoint[] = centreline(doc.control, SPACING, doc.open);
  if (line.length < 3) return null;
  const curv: number[] = curvature(line, SPACING, doc.open);
  const n = line.length;
  const { L, F } = stageMarks(n, SPACING, doc.open, doc.leadIn, doc.runout);
  const peak = Math.max(...curv.map(Math.abs));
  const at = curv.map(Math.abs).indexOf(peak);
  const minRadius = peak > 0 ? Math.round(1 / peak) : Infinity;
  const near: number = tightest(line, SPACING);
  const closest = near > 1e6 ? null : near;
  const warnings: string[] = [];
  if (minRadius < WARN_RADIUS) warnings.push(`A bend is very tight (about ${minRadius} m across). Cars will struggle: move its points apart.`);
  if (closest !== null && closest < WARN_CLOSE) warnings.push(`Two parts of the route come within ${closest} m of each other: the road may touch itself.`);
  if (doc.open && F <= L + 4) warnings.push("The stage is too short for its lead-in and run-out.");
  return {
    line, curv, length: doc.open ? (n - 1) * SPACING : n * SPACING, minRadius, tightestAt: [Math.round(line[at]!.x), Math.round(line[at]!.z)], closest,
    marks: { start: L, finish: doc.open ? F : null, gates: doc.open && F > L ? gateIndices(L, F, doc.sections) : [] },
    corners: paceNotes(line, curv, doc.open, doc.leadIn, SPACING),
    warnings,
  };
}

/// "Left 3", "Right 5": how a co-driver would call the corner.
export const callOut = (c: Corner) => `${c.left ? "Left" : "Right"} ${c.grade}`;

/// A colour for a point's curvature: green on straights, through yellow, to red where the road is tight.
export function curvatureColour(k: number): string {
  const t = Math.min(1, Math.abs(k) / 0.04);
  return `hsl(${Math.round(120 * (1 - t))} 80% 50%)`;
}

// ---- generating the scene and the road -----------------------------------------------------------------------------

export interface TrackFiles {
  scene: string;
  glb: Uint8Array;
  report: string;
}

/// The scene file name and the road model name for a track.
export const sceneOf = (name: string) => `scenes/${name}.scene.json`;
export const roadOf = (name: string) => `models/road_${name}.glb`;
export const trackOf = (name: string) => `tracks/${name}.track.json`;
export const trackName = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.track\.json$/i, "");

/// What the track becomes: the scene (start and finish, gates, waypoints, grid, scenery) and the road ribbon.
export function buildTrack(doc: TrackDoc): TrackFiles {
  if (doc.control.length < MIN_POINTS) throw `a track needs at least ${MIN_POINTS} points`;
  const spec = {
    seed: doc.seed, control: doc.control, open: doc.open, road: doc.road, rail: "guardrail", sky: [138, 182, 224],
    sections: doc.sections, leadIn: doc.leadIn, runout: doc.runout, lamps: doc.lamps,
    trees: doc.trees, small: doc.small, rock: doc.rock, density: doc.trees.length ? doc.density : 0, rocks: doc.rocks,
    landmarks: { kind: doc.trees[0] ?? "", count: 0, radius: 0 },
  };
  const { scene, stats } = layout(spec);
  const parsed = parseScene(JSON.stringify(scene));
  if (!parsed.ok) throw `the layout is not a valid scene: ${parsed.error}`;
  const glb: Uint8Array = roadGlb(doc.control, doc.road, doc.open);
  return { scene: serializeScene(parsed.scene), glb, report: `${stats.length} m, ${stats.objects} objects, tightest bend ~${stats.minRadius} m` };
}

export { ROAD_COLOURS };
