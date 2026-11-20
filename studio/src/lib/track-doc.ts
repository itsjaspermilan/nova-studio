// The track editor's model: a racing route as a list of control points and a few settings, saved as `tracks/<name>.track.json`.
// The route itself, its statistics and the generated scene all come from the shared generator (scripts/lib/trackgen.mjs, plain
// JavaScript that the MCP server's `track_write` tool and Pine Ridge Rally's script use too): nothing here repeats its algorithm.
// @ts-ignore (plain JavaScript)
import { centreline, curvature, gateIndices, layout, paceNotes, roadGlb, stageMarks, tightest, ROAD_COLOURS } from "../../../scripts/lib/trackgen.mjs";
// @ts-ignore (plain JavaScript)
import { randomRoute } from "../../../scripts/lib/trackrandom.mjs";

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
  /// The barrier entity on the outside of the bends.
  rail: string;
  /// The scene's background colour, [r, g, b] 0 to 255 (what the scene editor shows behind it).
  sky: Rgb;
  /// Distant scenery, 60 to 150 m from the road: kinds and how many per piece of road (0 to 1; 0 for none).
  far: { kind: string[]; density: number };
  /// A few tall features well away from the road: `count` of them at about `radius` metres from the route's middle (0 for none).
  landmarks: { kind: string[]; count: number; radius: number };
  /// The life beside the road (null for none): the kinds of the stands, long tents, banners and flags at the start, the two billboards
  /// that take turns on the straights, and the pylons on the outside of the hard bends. An empty kind is left out.
  roadside: Roadside | null;
  /// Spectators in groups beside the road (by the start, at the hard bends, along the straights): the kinds they are picked from (none: no
  /// crowd) and their size (the models' scale).
  crowd: { kind: string[]; size: number };
  /// Stretches of the route with their own surface or width: gravel into tarmac on a stage, a narrow walled section.
  zones: Zone[];
  /// The road has texture coordinates and names the project's road pictures, `textures/road.png` and `textures/road_grain.png`
  /// (docs/track-editor.md, "A textured road"). Without it the road is flat colours and needs no pictures.
  textured?: boolean;
}

export interface Roadside {
  stand: string; tent: string; banner: string; flag: string; boards: string[]; pylon: string;
  /// A row of `garages` pit garages behind the start line (and an office at its end), a gantry over the road after the line, and light
  /// posts along the straights: empty for none.
  garage?: string; garages?: number; office?: string; gantry?: string; post?: string;
}

/// Metres along the route from its first point (a stage's lead-in counts), and what changes there: another road kind, another width
/// (metres across; the road is 12), and a wall entity along both edges.
export interface Zone { from: number; to: number; road?: RoadKind; width?: number; wall?: string }

export type Rgb = [number, number, number];

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
    rail: "guardrail", sky: [138, 182, 224], far: { kind: [], density: 0 }, landmarks: { kind: [], count: 0, radius: 150 },
    roadside: null, crowd: { kind: [], size: 1 }, zones: [],
  };
}

const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
// (a kind may be given alone, as a string, or as a list)
const names = (v: unknown) => (typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const record = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const rgb = (v: unknown, d: Rgb): Rgb => (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x)) ? (v.map((x) => Math.min(255, Math.max(0, Math.round(x)))) as Rgb) : d);

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
      rail: typeof o.rail === "string" && o.rail ? o.rail : d.rail,
      sky: rgb(o.sky, d.sky),
      far: { kind: names(record(o.far).kind), density: num(record(o.far).density, 0, 0, 1) },
      landmarks: { kind: names(record(o.landmarks).kind), count: Math.round(num(record(o.landmarks).count, 0, 0, 200)), radius: num(record(o.landmarks).radius, d.landmarks.radius, 0, 2000) },
      roadside: o.roadside && typeof o.roadside === "object" && !Array.isArray(o.roadside) ? roadsideOf(record(o.roadside)) : null,
      crowd: { kind: names(record(o.crowd).kind), size: num(record(o.crowd).size, 1, 0.05, 20) },
      zones: Array.isArray(o.zones) ? o.zones.map(record).map(zoneOf).filter((z): z is Zone => z !== null) : [],
      ...(o.textured === true ? { textured: true } : {}),
    },
  };
}

const kindOf = (v: unknown) => (typeof v === "string" ? v : "");
const roadsideOf = (o: Record<string, unknown>): Roadside => ({
  stand: kindOf(o.stand), tent: kindOf(o.tent), banner: kindOf(o.banner), flag: kindOf(o.flag), boards: names(o.boards).slice(0, 2), pylon: kindOf(o.pylon),
  ...(kindOf(o.garage) ? { garage: kindOf(o.garage), garages: Math.round(num(o.garages, 5, 1, 20)), office: kindOf(o.office) } : {}),
  ...(kindOf(o.gantry) ? { gantry: kindOf(o.gantry) } : {}),
  ...(kindOf(o.post) ? { post: kindOf(o.post) } : {}),
});
const zoneOf = (o: Record<string, unknown>): Zone | null => {
  const from = num(o.from, NaN, 0, 1e6), to = num(o.to, NaN, 0, 1e6);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
  const z: Zone = { from, to };
  if (ROADS.some((r) => r.id === o.road)) z.road = o.road as RoadKind;
  if (typeof o.width === "number" && Number.isFinite(o.width)) z.width = Math.min(30, Math.max(6, o.width));
  if (kindOf(o.wall)) z.wall = kindOf(o.wall);
  return z;
};

/// What a new track's roadside starts as when it is switched on (the kinds Pine Ridge Rally has).
export const ROADSIDE: Roadside = { stand: "grandstand", tent: "tent_long", banner: "banner_green", flag: "flag_green", boards: ["billboard", "billboard_low"], pylon: "pylon" };

export function serializeTrack(doc: TrackDoc): string {
  const { control, zones, textured, ...rest } = doc;
  if (zones.length) (rest as Record<string, unknown>).zones = zones;
  if (textured) (rest as Record<string, unknown>).textured = true;
  const lines = control.map((p) => `    [${round(p[0])}, ${round(p[1])}]`).join(",\n");
  // (each setting on a line of its own; a list of kinds or a colour stays on that line)
  const fields = Object.entries(rest).map(([k, v]) => `  ${JSON.stringify(k)}: ${inline(v)}`);
  return `{\n${fields.join(",\n")},\n  "control": [\n${lines}\n  ]\n}\n`;
}

const round = (n: number) => Math.round(n * 10) / 10;

/// JSON on one line, spaced as a person would type it.
function inline(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(inline).join(", ")}]`;
  if (v && typeof v === "object") return `{ ${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(", ")} }`;
  return JSON.stringify(v);
}

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

/// What the track becomes: the scene (start and finish, gates, waypoints, grid, scenery, roadside, crowd) and the road ribbon. `previous` is the
/// scene being replaced, if there is one: its named objects (settings a person keeps in the scene, such as a game's `race` object; the
/// generator names nothing it places) are kept, first in the new scene. With the track's `name`, the scene also gets a `road` object
/// naming the road model (`road_<name>`), so the road is a placed thing: the scene view shows it, and a game draws it by its entity.
export function buildTrack(doc: TrackDoc, previous?: string | null, name?: string): TrackFiles {
  if (doc.control.length < MIN_POINTS) throw `a track needs at least ${MIN_POINTS} points`;
  const spec = {
    seed: doc.seed, control: doc.control, open: doc.open, road: doc.road, rail: doc.rail, sky: doc.sky,
    sections: doc.sections, leadIn: doc.leadIn, runout: doc.runout, lamps: doc.lamps,
    trees: doc.trees, small: doc.small, rock: doc.rock, density: doc.trees.length ? doc.density : 0, rocks: doc.rocks,
    far: doc.far, landmarks: doc.landmarks.kind.length ? doc.landmarks : { kind: [], count: 0, radius: 0 },
    roadside: doc.roadside, crowd: doc.crowd, zones: doc.zones, keep: keptObjects(previous),
  };
  const { scene, stats } = layout(spec);
  if (name) {
    const kept = spec.keep.length;
    scene.objects.splice(kept, 0, { kind: "road", x: 0, y: 0, z: 0, props: { model: roadOf(name).replace(/^models\/|\.glb$/g, "") } });
  }
  const parsed = parseScene(JSON.stringify(scene));
  if (!parsed.ok) throw `the layout is not a valid scene: ${parsed.error}`;
  const glb: Uint8Array = roadGlb(doc.control, doc.road, doc.open, doc.zones, doc.textured === true);
  return { scene: serializeScene(parsed.scene), glb, report: `${stats.length} m, ${stats.objects} objects, tightest bend ~${stats.minRadius} m` };
}

/// The named objects of a scene file (none if it is missing or not a scene).
export function keptObjects(scene: string | null | undefined): unknown[] {
  if (!scene) return [];
  const parsed = parseScene(scene);
  if (!parsed.ok) return [];
  return (parsed.scene.objects ?? []).filter((o) => typeof (o as { name?: unknown }).name === "string");
}

export { ROAD_COLOURS };

// ---- a made-up route and a look for it ---------------------------------------------------------------------------------------------
// "Generate route" proposes control points from a seed (scripts/lib/trackrandom.mjs) and keeps everything else; a theme sets the scenery,
// the road and the sky (the sets Pine Ridge Rally's courses use). Both are plain edits of the document: the result is an ordinary track.

export interface RouteOptions { length: number; curviness: number; seed: number }

/// A new route for the document (a circuit or a stage as it is set), from the seed. `ok` is false when no candidate passed the editor's own
/// checks (a bend tighter than 28 m, road parts closer than 60 m): the best one is used anyway, and a different seed will likely do better.
export function withRandomRoute(doc: TrackDoc, o: RouteOptions): { doc: TrackDoc; ok: boolean } {
  const r = randomRoute({ open: doc.open, length: o.length, curviness: o.curviness, seed: o.seed });
  // (the zones are metres along the old route and mean nothing on the new one)
  return { doc: { ...doc, control: r.control as Point[], zones: [] }, ok: r.ok };
}

const CROWD = ["crowd_fa", "crowd_fb", "crowd_fc", "crowd_fd", "crowd_ma", "crowd_mb", "crowd_mc", "crowd_md"];
const SIDE = { boards: ["billboard", "billboard_low"], pylon: "pylon", tent: "tent_long" };

export type ThemeId = "forest" | "desert" | "snow";
export const THEMES: { id: ThemeId; name: string; set: Partial<TrackDoc> }[] = [
  {
    id: "forest", name: "Forest (pines and oaks, asphalt)",
    set: {
      road: "road_asphalt", sky: [138, 182, 224], density: 0.5, rocks: 0.08, lamps: false,
      trees: ["nk_pinetall_a", "nk_pinetall_b", "nk_pinetall_c", "nk_pinetall_d", "nk_pineround_a", "nk_pineround_c", "nk_pineround_e", "nk_pinesmall_a", "nk_pinesmall_c", "nk_oak", "nk_default", "nk_tall", "nk_fat", "nk_thin", "nk_oak_fall", "pine", "pine_dark", "birch"],
      small: ["nk_bush_large", "nk_bush_detailed", "nk_bush_tri", "bush", "nk_stump", "nk_log", "nk_rock_largeC"],
      rock: ["nk_rock_largeA", "nk_rock_largeC", "nk_rock_largeE", "nk_rock_tallB", "nk_rock_tallF", "nk_rock_tallH"],
      far: { kind: ["nk_pinetall_a", "nk_pinetall_d", "nk_pineround_e", "pine_dark"], density: 0.5 },
      landmarks: { kind: ["pine_dark"], count: 0, radius: 150 },
      roadside: { ...SIDE, stand: "grandstand", banner: "banner_green", flag: "flag_green" },
      crowd: { kind: CROWD, size: 2 },
    },
  },
  {
    id: "desert", name: "Desert (cacti and mesas, sand)",
    set: {
      road: "road_sand", sky: [230, 160, 120], density: 0.32, rocks: 0.14, lamps: false,
      trees: ["nk_cactus_tall", "nk_cactus_tall", "nk_cactus_short", "nk_cactus_short", "cactus", "nk_dead_thin", "nk_dead_tall", "dry_bush"],
      small: ["dry_bush", "nk_rockred_largeC", "dry_bush", "nk_stump", "nk_rockred_tallF"],
      rock: ["nk_rockred_largeA", "nk_rockred_largeC", "nk_rockred_largeE", "nk_rockred_tallB", "nk_rockred_tallF", "nk_rockred_tallH"],
      far: { kind: ["mesa"], density: 0.22 },
      landmarks: { kind: ["mesa"], count: 14, radius: 220 },
      roadside: { ...SIDE, stand: "grandstand_covered", banner: "banner_red", flag: "flag_red" },
      crowd: { kind: CROWD, size: 2 },
    },
  },
  {
    id: "snow", name: "Snow (frosted pines, snowy road)",
    set: {
      road: "road_snow", sky: [196, 216, 236], density: 0.55, rocks: 0.1, lamps: false,
      trees: ["nk_snow_pinetall_a", "nk_snow_pinetall_c", "nk_snow_pinetall_d", "nk_snow_pineround_a", "nk_snow_pineround_e", "nk_snow_pinesmall_a", "pine_snow", "pine_snow", "nk_pinetall_a", "nk_pineround_c"],
      small: ["bush_snow", "nk_rockice_largeC", "bush_snow", "nk_stump"],
      rock: ["nk_rockice_largeA", "nk_rockice_largeC", "nk_rockice_largeE", "nk_rockice_tallB", "nk_rockice_tallF", "nk_rockice_tallH"],
      far: { kind: ["pine_snow", "nk_snow_pinetall_d", "nk_snow_pineround_e"], density: 0.6 },
      landmarks: { kind: ["pine_snow"], count: 0, radius: 150 },
      roadside: { ...SIDE, stand: "grandstand_covered", banner: "banner_red", flag: "flag_checkers" },
      crowd: { kind: CROWD, size: 2 },
    },
  },
];

/// The document with a theme's scenery, road and sky (the route, sections and seed stay).
export function withTheme(doc: TrackDoc, id: ThemeId): TrackDoc {
  const t = THEMES.find((x) => x.id === id);
  return t ? { ...doc, ...t.set } : doc;
}
