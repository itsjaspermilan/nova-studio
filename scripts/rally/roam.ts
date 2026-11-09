// Pine Ridge Rally's free-roam map (scenes/roam.scene.json, and the road between the courses: models/road_roam_link.glb), made from
// the courses' own scene files: the Pine Ridge circuit where it is, the Pine Ridge stage 1.2 km to the east, and a gravel road between
// them laid by the track generator (scripts/lib/trackgen.mjs). Everything on the map is a scene object a person could place:
//   roam_point   the roads' points (route, i, k, road, loop), from each course's waypoints
//   road         each road's model (its `model`), as one object at the course's offset
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
// the gravel roads: from the circuit's east side to the town's main street, and from its far end to just behind the stage's start
const LINKS = [
  { id: "roam_link", control: [[428, 40], [500, 30], [580, 8], [640, -24], [676, -39], [700, -40]] as [number, number][] },
  { id: "roam_link_east", control: [[896, -40], [930, -41], [990, -72], [1060, -150], [1140, -210], [1188, -206], [1200, -175], [1200, -150]] as [number, number][] },
];
// the town (2026-11-08): Kenney's city kits at 14 times their size (scripts/rally/town-models.sh), a tile every 14 m. The main street
// runs east along z = -40 from x = 700 to 896, with a crossroads at x = 805 and a side street each way that ends in a turning circle.
const TILE = 14;
const MAIN = { z: -40, x0: 700, x1: 896, cross: 805 };
const SIDE = { z0: -96, z1: 16 }; // (the side street's turning circles, north and south)
const TOWN_BOX = { x0: 682, x1: 914, z0: -116, z1: 36 }; // the courses' and the links' scenery is cleared out of it
const DROP = new Set(["race", "foliage", "waypoint", "grid_slot", "section_gate", "road"]);
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
  objects.push({ kind: "road", x: c.dx, y: 0, z: c.dz, props: { model: `road_${c.id}` } });
  for (const o of way) {
    const p = o.props!;
    objects.push({ kind: "roam_point", x: r1(o.x + c.dx), y: 0, z: r1(o.z + c.dz), props: { route: c.id, i: p.i, k: p.k, road: (p.road as string) ?? c.road, ...(p.w ? { w: p.w } : {}), ...(c.loop ? { loop: true } : {}) } });
  }
  for (const o of scene.objects as Obj[]) {
    if (DROP.has(o.kind) || isCrowd(o.kind) || o.name) continue;
    scenery.push({ o: { ...o, x: r1(o.x + c.dx), z: r1(o.z + c.dz) }, own: c.id });
  }
}

// the link roads: the generator's layout of an open road, with only its waypoints, barriers and scenery kept, and a power line beside it
const track = read("tracks/stage_pine_ridge.track.json");
const town: Obj[] = [];
for (const [n, LINK] of LINKS.entries()) {
  const made = layout({
    seed: 311 + n, control: LINK.control, open: true, road: "road_gravel", rail: track.rail, sky: track.sky, sections: 1, leadIn: 0, runout: 0,
    lamps: false, trees: track.trees, small: track.small, rock: track.rock, density: 0.45, rocks: 0.06, far: track.far,
    landmarks: { kind: [], count: 0, radius: 0 }, roadside: null, crowd: { kind: [], size: 1 }, zones: [], keep: [],
  });
  const linkLine = centreline(LINK.control, 5, false);
  routes.push({ name: LINK.id, pts: linkLine.map((p: { x: number; z: number }) => ({ x: p.x, z: p.z })) });
  objects.push({ kind: "road", x: 0, y: 0, z: 0, props: { model: `road_${LINK.id}` } });
  for (const o of made.scene.objects as Obj[]) {
    if (o.kind === "waypoint") {
      objects.push({ kind: "roam_point", x: o.x, y: 0, z: o.z, props: { route: LINK.id, i: o.props!.i, k: o.props!.k, road: "road_gravel" } });
    } else if (!["start_arch", "road_start", "grid_slot", "section_gate", "race", "foliage"].includes(o.kind) && !isCrowd(o.kind)) {
      scenery.push({ o, own: LINK.id });
    }
  }
  writeFileSync(join(GAME, `models/road_${LINK.id}.glb`), roadGlb(LINK.control, "road_gravel", true, []));
  // power poles every 40 m, 11 m to the road's right, the wires running along it (a pole's arms lie across the line)
  for (let i = 4; i < linkLine.length - 4; i += 8) {
    const p = linkLine[i]!;
    const x = p.x + p.tz * -11, z = p.z - p.tx * -11;
    if (x > TOWN_BOX.x0 && x < TOWN_BOX.x1 && z > TOWN_BOX.z0 && z < TOWN_BOX.z1) continue;
    scenery.push({ o: { kind: "ck_electricity_pole", x: r1(x), y: 0, z: r1(z), props: { ry: Math.round(p.ry * 1000) / 1000 } }, own: LINK.id });
  }
}

// ---- the town -------------------------------------------------------------------------------------------------------------------
const put = (kind: string, x: number, z: number, ry = 0) => town.push({ kind, x: r1(x), y: 0, z: r1(z), ...(ry ? { props: { ry: Math.round(ry * 1000) / 1000 } } : {}) });
const Q = Math.PI / 2;
// the main street, a tile at a time (the straight tiles run along x as the kit makes them), the crossroads in the middle
for (let x = MAIN.x0 + TILE / 2; x < MAIN.x1; x += TILE) put(Math.abs(x - MAIN.cross) < 1 ? "ck_road_crossroad" : "ck_road_straight", x, MAIN.z);
// the side street, north and south of the crossroads, each ending in a turning circle
for (let z = MAIN.z - TILE; z > SIDE.z0; z -= TILE) put("ck_road_straight", MAIN.cross, z, Q);
for (let z = MAIN.z + TILE; z < SIDE.z1; z += TILE) put("ck_road_straight", MAIN.cross, z, Q);
put("ck_road_end_round", MAIN.cross, SIDE.z0, Q);
put("ck_road_end_round", MAIN.cross, SIDE.z1, -Q);
// the town's roads, as road points: the main street, and the side street through the crossroads
const townRoute = (name: string, pts: [number, number][]) => {
  routes.push({ name, pts: pts.map(([x, z]) => ({ x, z })) });
  pts.forEach(([x, z], i) => objects.push({ kind: "roam_point", x, y: 0, z, props: { route: name, i: i + 1, k: 0, w: 5, road: "road_asphalt" } }));
};
const mainPts: [number, number][] = [];
for (let x = MAIN.x0; x <= MAIN.x1; x += 7) mainPts.push([x, MAIN.z]);
townRoute("town_main", mainPts);
const sidePts: [number, number][] = [];
for (let z = SIDE.z0; z <= SIDE.z1; z += 7) sidePts.push([MAIN.cross, z]);
townRoute("town_side", sidePts);
// along the main street: houses set back on both sides, shops either side of the crossroads; each faces the street
const HOUSES = ["a", "b", "c", "d", "e", "f", "g", "h"];
let h = 0;
for (const x of [716, 740, 764, 846, 870]) {
  put(`ck_house_${HOUSES[h++ % 8]}`, x, MAIN.z - 19, 0);
  put(`ck_house_${HOUSES[h++ % 8]}`, x, MAIN.z + 19, Math.PI);
}
for (const [x, i] of [[786, 0], [824, 1]] as [number, number][]) {
  put(`ck_shop_${"abcd"[i * 2]}`, x, MAIN.z - 16, 0);
  put(`ck_shop_${"abcd"[i * 2 + 1]}`, x, MAIN.z + 16, Math.PI);
}
// along the side street, beyond the main street's houses: houses facing it, east and west
for (const z of [-80, 0]) {
  put(`ck_house_${HOUSES[h++ % 8]}`, MAIN.cross - 19, z, Q);
  put(`ck_house_${HOUSES[h++ % 8]}`, MAIN.cross + 19, z, -Q);
}
// a tree in the gardens between the houses
for (const x of [728, 752, 858]) for (const side of [-1, 1]) put(side < 0 ? "ck_tree_large" : "ck_tree_small", x, MAIN.z + side * 24);
// street lights along the main street, on alternate sides, their arms over the road; traffic lights at the corners of the crossroads
for (let x = MAIN.x0 + 14, k = 0; x < MAIN.x1 - 6; x += 28, k++) {
  if (Math.abs(x - MAIN.cross) < 12) continue;
  const north = k % 2 === 0;
  put("ck_light_curved", x, MAIN.z + (north ? -6.6 : 6.6), north ? Math.PI : 0);
}
for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) put("ck_traffic_light", MAIN.cross + dx * 7.2, MAIN.z + dz * 7.2, Math.atan2(-dx, -dz));
// signs over the way in at each end of town
put("ck_sign_highway", MAIN.x0 + 4, MAIN.z - 8, Q);
put("ck_sign_highway", MAIN.x1 - 4, MAIN.z + 8, -Q);

// scenery on any road but its own is left out: within 9 m of another road's middle (the road is 12 m wide)
const near = (o: Obj, pts: { x: number; z: number }[]) => pts.some((p) => (p.x - o.x) ** 2 + (p.z - o.z) ** 2 < 81);
let dropped = 0;
const inTown = (o: Obj) => o.x > TOWN_BOX.x0 && o.x < TOWN_BOX.x1 && o.z > TOWN_BOX.z0 && o.z < TOWN_BOX.z1;
for (const { o, own } of scenery) {
  const clash = inTown(o) || routes.some((r) => r.name !== own && near(o, r.pts));
  if (clash) dropped++;
  else objects.push(o);
}
objects.push(...town);

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
console.log(`roam: ${objects.length} objects, ${count("roam_point")} road points on ${routes.length} roads, ${count("event")} events, ${town.length} pieces of town, ${dropped} pieces of scenery left off the roads and out of the town`);
