// Pine Ridge Rally's free-roam map (scenes/roam.scene.json, and the road between the courses: models/road_roam_link.glb), made from
// the courses' own scene files: the Pine Ridge circuit where it is, the Pine Ridge stage 1.2 km to the east, and a gravel road between
// them laid by the track generator (scripts/lib/trackgen.mjs). Everything on the map is a scene object a person could place:
//   roam_point   the roads' points (route, i, k, road, loop), from each course's waypoints
//   road_*       each road's model, as one object at the course's offset
//   event        a race to start in the world (course, mode)
//   roam_spawn   where free roam starts
// and the courses' scenery and roadside, moved by their offset. Spectators, start grids and stage gates stay in the courses' own scenes.
// Scenery that would stand on another road (the circuit's trees where the link road runs) is left out.
//   cd studio && ../scripts/env.sh npx vite-node ../scripts/rally/roam.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { centreline, layout, roadGlb } from "../lib/trackgen.mjs";
import { parseScene, serializeScene } from "../../studio/src/lib/scene-model";

const GAME = join(new URL("../..", import.meta.url).pathname, "examples/pine-ridge-rally");
const read = (p: string) => JSON.parse(readFileSync(join(GAME, p), "utf8"));
const r1 = (v: number) => Math.round(v * 10) / 10;
type Obj = { kind: string; name?: string; x: number; y: number; z: number; props?: Record<string, unknown> };

// the courses on the map: where each one's scene is moved to, and its road
const COURSES = [
  { id: "pine_ridge", dx: 0, dz: 0, road: "road_asphalt", loop: true },
  { id: "stage_pine_ridge", dx: 1200, dz: 0, road: "road_gravel", loop: false },
];
// the gravel road from the circuit's east side to just behind the stage's start
const LINK = {
  id: "roam_link",
  control: [[428, 40], [520, 30], [640, 0], [780, -60], [920, -150], [1060, -210], [1160, -215], [1200, -185], [1200, -160]] as [number, number][],
};
const DROP = new Set(["race", "foliage", "waypoint", "grid_slot", "section_gate"]);
const isCrowd = (k: string) => k.startsWith("crowd_");

const objects: Obj[] = [];
const routes: { name: string; pts: { x: number; z: number }[] }[] = [];

// the course's settings: the circuit's race object (the sky, sun, hills, music) with free roam's own name, and its grass
const circuit = read("scenes/pine_ridge.scene.json");
const race = circuit.objects.find((o: Obj) => o.kind === "race");
objects.push({ ...race, name: "race" });
objects.push({ ...circuit.objects.find((o: Obj) => o.kind === "foliage"), name: "foliage" });

const scenery: { o: Obj; own: string }[] = [];
for (const c of COURSES) {
  const scene = read(`scenes/${c.id}.scene.json`);
  const way = (scene.objects as Obj[]).filter((o) => o.kind === "waypoint").sort((a, b) => (a.props!.i as number) - (b.props!.i as number));
  routes.push({ name: c.id, pts: way.map((o) => ({ x: o.x + c.dx, z: o.z + c.dz })) });
  objects.push({ kind: `road_${c.id}`, x: c.dx, y: 0, z: c.dz });
  for (const o of way) {
    const p = o.props!;
    objects.push({ kind: "roam_point", x: r1(o.x + c.dx), y: 0, z: r1(o.z + c.dz), props: { route: c.id, i: p.i, k: p.k, road: (p.road as string) ?? c.road, ...(p.w ? { w: p.w } : {}), ...(c.loop ? { loop: true } : {}) } });
  }
  for (const o of scene.objects as Obj[]) {
    if (DROP.has(o.kind) || isCrowd(o.kind) || o.name) continue;
    scenery.push({ o: { ...o, x: r1(o.x + c.dx), z: r1(o.z + c.dz) }, own: c.id });
  }
}

// the link road: the generator's layout of an open road, with only its waypoints, barriers and scenery kept
const track = read("tracks/stage_pine_ridge.track.json");
const made = layout({
  seed: 311, control: LINK.control, open: true, road: "road_gravel", rail: track.rail, sky: track.sky, sections: 1, leadIn: 0, runout: 0,
  lamps: false, trees: track.trees, small: track.small, rock: track.rock, density: 0.45, rocks: 0.06, far: track.far,
  landmarks: { kind: [], count: 0, radius: 0 }, roadside: null, crowd: { kind: [], size: 1 }, zones: [], keep: [],
});
const linkLine = centreline(LINK.control, 5, false);
routes.push({ name: LINK.id, pts: linkLine.map((p: { x: number; z: number }) => ({ x: p.x, z: p.z })) });
objects.push({ kind: `road_${LINK.id}`, x: 0, y: 0, z: 0 });
for (const o of made.scene.objects as Obj[]) {
  if (o.kind === "waypoint") {
    objects.push({ kind: "roam_point", x: o.x, y: 0, z: o.z, props: { route: LINK.id, i: o.props!.i, k: o.props!.k, road: "road_gravel" } });
  } else if (!["start_arch", "road_start", "grid_slot", "section_gate", "race", "foliage"].includes(o.kind) && !isCrowd(o.kind)) {
    scenery.push({ o, own: LINK.id });
  }
}
writeFileSync(join(GAME, `models/road_${LINK.id}.glb`), roadGlb(LINK.control, "road_gravel", true, []));

// scenery on any road but its own is left out: within 9 m of another road's middle (the road is 12 m wide)
const near = (o: Obj, pts: { x: number; z: number }[]) => pts.some((p) => (p.x - o.x) ** 2 + (p.z - o.z) ** 2 < 81);
let dropped = 0;
for (const { o, own } of scenery) {
  const clash = routes.some((r) => r.name !== own && near(o, r.pts));
  if (clash) dropped++;
  else objects.push(o);
}

// the events: the circuit race at the circuit's start, its time trial a little way round, the rally at the stage's start
const at = (route: string, i: number, side: number) => {
  const pts = routes.find((r) => r.name === route)!.pts;
  const p = pts[i]!, q = pts[i + 1]!;
  const len = Math.hypot(q.x - p.x, q.z - p.z);
  const [tx, tz] = [(q.x - p.x) / len, (q.z - p.z) / len];
  return { x: r1(p.x + tz * side), z: r1(p.z - tx * side), ry: Math.round(Math.atan2(tx, tz) * 1000) / 1000 };
};
const ev = (course: string, mode: string, where: { x: number; z: number; ry: number }) =>
  objects.push({ kind: "event", x: where.x, y: 0, z: where.z, props: { course, mode, ry: where.ry } });
ev("pine_ridge", "race", at("pine_ridge", 3, 9));
ev("pine_ridge", "trial", at("pine_ridge", 40, 9));
ev("stage_pine_ridge", "rally", at("stage_pine_ridge", 4, 9));
// free roam starts on the circuit's main straight, just past the line, facing along it
const spawn = at("pine_ridge", 4, 0);
objects.push({ kind: "roam_spawn", name: "spawn", x: spawn.x, y: 0, z: spawn.z, props: { ry: spawn.ry } });

const scene = { version: 1, background: circuit.background, camera: { eye: [-60, 140, -260], target: [500, 0, 0], fov: 55 }, objects };
const parsed = parseScene(JSON.stringify(scene));
if (!parsed.ok) throw new Error(parsed.error);
writeFileSync(join(GAME, "scenes/roam.scene.json"), serializeScene(parsed.scene));
const count = (k: string) => objects.filter((o) => o.kind === k).length;
console.log(`roam: ${objects.length} objects, ${count("roam_point")} road points on ${routes.length} roads, ${count("event")} events, ${dropped} pieces of scenery left off the roads`);
