// Pine Ridge Rally's open world (scenes/roam.scene.json and the roads between the courses, models/road_roam_*.glb), made from the
// courses' own scene files (2026-11-08). Five regions, each a town with its courses round it:
//   forest   Pine Ridge, Ridge GP, the Pine Ridge stage, the Forest Marathon     (the middle of the map)
//   autumn   Autumn Glen, Autumn Summit, the Autumn Glen stage
//   desert   Dust Valley, Copper Canyon, the Dust Valley stage, Canyon Climb, Mesa Run
//   snow     Frost Pass, Glacier Ring, the Frost Pass stage, Glacier by Night
//   harbour  Harbour Lights, Neon Docks, the Harbour Night stage, Harbour Sprint
// Each course is moved as a whole (its road, scenery and roadside) to a place round its region's town where its land is clear of the
// other courses, the towns and the highways; highways (tarmac, with a power line) run from the forest town to the others; and each course
// gets a road from the nearest road to its start (behind a stage's start line; onto a circuit's start straight from outside). Everything
// is a scene object a person could place:
//   roam_point   the roads' points (route, i, k, road, grip, loop)        road        a road model (its `model`) at its offset
//   event        a race to start in the world (course, mode)              region      a region's town and its look (`look`: a course)
//   roam_foliage the grass of some roads (routes, plants)                 power_line  a power line's poles (`pts`)
//   roam_spawn   where free roam starts
// Spectators, start grids and stage gates stay in the courses' own scenes. Scenery that would stand on another road is left out.
//   cd studio && ../scripts/env.sh npx vite-node ../scripts/rally/roam.ts
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { join } from "node:path";
import { centreline, layout, roadGlb } from "../lib/trackgen.mjs";
import { parseScene, serializeScene } from "../../studio/src/lib/scene-model";

const GAME = join(new URL("../..", import.meta.url).pathname, "examples/pine-ridge-rally");
const read = (p: string) => JSON.parse(readFileSync(join(GAME, p), "utf8"));
const r1 = (v: number) => Math.round(v * 10) / 10;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
type Obj = { kind: string; name?: string; x: number; y: number; z: number; props?: Record<string, unknown> };
type P = { x: number; z: number };
type Box = { x0: number; x1: number; z0: number; z1: number };

// the regions: where each town is, the course whose look (sky, sun, ground) the region has, its roads' surface and grip, and its courses
// (the harbour's courses are night races; in free roam it is day there, with the look of Ridge Grand Prix, a day circuit by the coast)
const REGIONS = [
  { id: "forest", name: "Pine Ridge", town: [0, 0], look: "pine_ridge", road: "road_gravel", grip: 0.88, courses: ["pine_ridge", "ridge_gp", "stage_pine_ridge", "stage_marathon"] },
  { id: "autumn", name: "Autumn Glen", town: [-300, -3600], look: "autumn_glen", road: "road_gravel", grip: 0.88, courses: ["autumn_glen", "autumn_summit", "stage_autumn_glen"] },
  { id: "desert", name: "Dust Valley", town: [400, 3800], look: "dust_valley", road: "road_sand", grip: 0.85, courses: ["dust_valley", "copper_canyon", "stage_dust_valley", "stage_canyon", "stage_mesa_run"] },
  { id: "snow", name: "Frost Pass", town: [-4000, -900], look: "frost_pass", road: "road_snow", grip: 0.72, courses: ["frost_pass", "glacier_ring", "stage_frost_pass", "stage_glacier_night"] },
  { id: "harbour", name: "Harbour", town: [4000, -600], look: "ridge_gp", road: "road_asphalt", grip: 1, courses: ["harbour_lights", "neon_docks", "stage_harbour_lights", "stage_harbour_sprint"] },
];
const SPAWN_REGION = "forest";
const GRASS = 0.3; // the share of each course's grass planted in the open world (twenty courses of grass would be too much for a handheld)
const DROP = new Set(["race", "foliage", "waypoint", "grid_slot", "section_gate", "road", "start_arch", "road_start", "tower", "flag_checkers"]);
const isCrowd = (k: string) => k.startsWith("crowd_");

const objects: Obj[] = [];
// each road's points, kept together and written as one `roam_road` object a road (ten thousand objects of one point each made the scene
// too slow to build): [x, z, k] for each point, with its width (`w`, half the road) and its road kind when they are not the road's own
const roadData = new Map<string, { road: string; grip: number; loop: boolean; pts: { i: number; v: (number | string)[] }[] }>();
function addPoint(route: string, i: number, x: number, z: number, k: number, road: string, grip: number, w?: number, loop = false) {
  let r = roadData.get(route);
  if (!r) { r = { road, grip, loop, pts: [] }; roadData.set(route, r); }
  const v: (number | string)[] = [r1(x), r1(z), Math.round(k * 10000) / 10000];
  if (w || road !== r.road) v.push(w ?? 0);
  if (road !== r.road) v.push(road);
  r.pts.push({ i, v });
}
const routes: { name: string; pts: P[] }[] = [];
const scenery: { o: Obj; own: string }[] = [];
const blocked: Box[] = []; // land taken: towns, highways, placed courses
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed / 2147483648);

// the open world's look to begin with (the forest's race object: the sky, sun, hills and music), named so the roam scene finds it
const forest = read("scenes/pine_ridge.scene.json");
objects.push({ ...forest.objects.find((o: Obj) => o.kind === "race"), name: "race" });

// ---- towns ----------------------------------------------------------------------------------------------------------------------
// Kenney's city kits at 14 times their size (scripts/rally/town-models.sh), a tile every 14 m: a main street along x with a crossroads
// and a side street along z. Its four ends are where roads join it; an end with no road ends in a turning circle.
const TILE = 14;
const Q = Math.PI / 2;
type End = { x: number; z: number; dx: number; dz: number; used?: boolean };
function makeTown(region: (typeof REGIONS)[number]) {
  const [cx, cz] = region.town as [number, number];
  const main = { z: cz, x0: cx - 98, x1: cx + 98, cross: cx + 7 };
  const side = { z0: cz - 56, z1: cz + 56 };
  const ends: Record<string, End> = {
    w: { x: main.x0, z: cz, dx: -1, dz: 0 }, e: { x: main.x1, z: cz, dx: 1, dz: 0 },
    n: { x: main.cross, z: side.z0, dx: 0, dz: -1 }, s: { x: main.cross, z: side.z1, dx: 0, dz: 1 },
  };
  blocked.push({ x0: main.x0 - 40, x1: main.x1 + 40, z0: side.z0 - 50, z1: side.z1 + 50 });
  return { region, main, side, ends, cx, cz };
}
function dressTown(t: ReturnType<typeof makeTown>) {
  const { main, side, ends, region } = t;
  const put = (kind: string, x: number, z: number, ry = 0) => objects.push({ kind, x: r1(x), y: 0, z: r1(z), ...(ry ? { props: { ry: r3(ry) } } : {}) });
  // the streets are roads like the highways (the generator's ribbon, tarmac), so a road comes into town and goes on with no seam
  // (2026-11-08: the kit's road tiles met the generated roads with a hard edge at every way in); the side street lies a hair under the
  // main street where they cross, so the two do not flicker
  const street = (id: string, control: [number, number][], y: number) => {
    writeFileSync(join(GAME, `models/road_${id}.glb`), roadGlb(control, "road_asphalt", true, []));
    objects.push({ kind: "road", x: 0, y, z: 0, props: { model: `road_${id}` } });
  };
  street(`town_${region.id}_main`, [[main.x0, main.z], [main.x0 + 60, main.z], [main.x1 - 60, main.z], [main.x1, main.z]], 0);
  street(`town_${region.id}_side`, [[main.cross, side.z0], [main.cross, side.z0 + 40], [main.cross, side.z1 - 40], [main.cross, side.z1]], -0.02);
  const pts = (name: string, list: [number, number][]) => {
    routes.push({ name, pts: list.map(([x, z]) => ({ x, z })) });
    list.forEach(([x, z], i) => addPoint(name, i + 1, x, z, 0, "road_asphalt", 1));
  };
  const mainPts: [number, number][] = [];
  for (let x = main.x0; x <= main.x1; x += 7) mainPts.push([x, main.z]);
  pts(`town_${region.id}_main`, mainPts);
  const sidePts: [number, number][] = [];
  for (let z = side.z0; z <= side.z1; z += 7) sidePts.push([main.cross, z]);
  pts(`town_${region.id}_side`, sidePts);
  const HOUSES = "abcdefgh";
  let h = region.id.length; // (each town starts at another house, so no two look the same)
  // the forest town (the hub) has the garage on its main street, in place of a house: Y at its marker opens the garage
  const hasGarage = region.id === SPAWN_REGION;
  if (hasGarage) {
    put("garage", t.cx + 70, main.z - 21, Math.PI);
    objects.push({ kind: "event", x: t.cx + 70, y: 0, z: main.z - 9, props: { mode: "garage", ry: r3(Q) } });
  }
  for (const dx of [-84, -60, -36, 46, 70]) {
    if (!(hasGarage && dx === 70)) put(`ck_house_${HOUSES[h++ % 8]}`, t.cx + dx, main.z - 19, 0);
    put(`ck_house_${HOUSES[h++ % 8]}`, t.cx + dx, main.z + 19, Math.PI);
  }
  for (const [dx, i] of [[-14, 0], [24, 1]] as [number, number][]) {
    put(`ck_shop_${"abcdef"[(i * 2 + h) % 6]}`, t.cx + dx, main.z - 16, 0);
    put(`ck_shop_${"abcdef"[(i * 2 + 1 + h) % 6]}`, t.cx + dx, main.z + 16, Math.PI);
  }
  for (const dz of [-40, 40]) {
    put(`ck_house_${HOUSES[h++ % 8]}`, main.cross - 19, main.z + dz, Q);
    put(`ck_house_${HOUSES[h++ % 8]}`, main.cross + 19, main.z + dz, -Q);
  }
  for (const dx of [-72, -48, 58]) for (const s of [-1, 1]) put(s < 0 ? "ck_tree_large" : "ck_tree_small", t.cx + dx, main.z + s * 24);
  for (let x = main.x0 + 14, k = 0; x < main.x1 - 6; x += 28, k++) {
    if (Math.abs(x - main.cross) < 12) continue;
    const north = k % 2 === 0;
    put("ck_light_curved", x, main.z + (north ? -6.6 : 6.6), north ? Math.PI : 0);
  }
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) put("ck_traffic_light", main.cross + dx * 7.2, main.z + dz * 7.2, Math.atan2(-dx, -dz));
  put("ck_sign_highway", main.x0 + 4, main.z - 8, Q);
  put("ck_sign_highway", main.x1 - 4, main.z + 8, -Q);
  objects.push({ kind: "region", name: `region_${region.id}`, x: t.cx, y: 0, z: t.cz, props: { title: region.name, look: region.look } });
}
const towns = REGIONS.map(makeTown);

// ---- roads between places: the generator's layout of an open road (its waypoints, barriers and scenery), a power line on a highway ----
const lookOf = (region: (typeof REGIONS)[number]) => read(`tracks/${region.look}.track.json`);
function buildRoad(id: string, control: [number, number][], region: (typeof REGIONS)[number], kind: string, grip: number, highway: boolean) {
  const look = lookOf(region);
  const made = layout({
    seed: 400 + routes.length, control, open: true, road: kind, rail: look.rail, sky: look.sky, sections: 1, leadIn: 0, runout: 0,
    lamps: false, trees: look.trees, small: look.small, rock: look.rock, density: highway ? 0.3 : 0.4, rocks: 0.05, far: look.far,
    landmarks: { kind: [], count: 0, radius: 0 }, roadside: null, crowd: { kind: [], size: 1 }, zones: [], keep: [],
  });
  const line = centreline(control, 5, true); // (open: a road from one place to another, not a loop)
  routes.push({ name: id, pts: line.map((p: P) => ({ x: p.x, z: p.z })) });
  // (a road in lies a hair under the road it joins, so the two do not flicker where they overlap)
  objects.push({ kind: "road", x: 0, y: highway ? 0 : -0.02, z: 0, props: { model: `road_${id}` } });
  for (const o of made.scene.objects as Obj[]) {
    if (o.kind === "waypoint") addPoint(id, o.props!.i as number, o.x, o.z, o.props!.k as number, kind, grip);
    else if (!DROP.has(o.kind) && !isCrowd(o.kind)) scenery.push({ o, own: id });
  }
  writeFileSync(join(GAME, `models/road_${id}.glb`), roadGlb(control, kind, true, []));
  if (highway) {
    // a pole about every 40 m, 11 m to one side (lib/powerlines.lua turns each along the line and strings the wires between them)
    const all = line.map((p: P & { tx: number; tz: number }) => ({ x: p.x - p.tz * 11, z: p.z + p.tx * 11 }));
    // (only the first 450 m out of each town: a pole every 7 m the whole way, as the kit spaces them, was a forest of poles)
    for (const side of [all.slice(0, 90), all.slice(-90).reverse()]) {
    const poles: [number, number][] = [[side[7]!.x, side[7]!.z]];
    const need = 40; // (metres to the next pole, walking along the line, measured straight from the last)
    for (let i = 8; i < side.length - 7; i++) {
      const a = side[i - 1]!, b = side[i]!;
      const last = poles[poles.length - 1]!;
      // the spot on this piece of the line 7 m from the last pole, if there is one
      const dx = b.x - a.x, dz = b.z - a.z, fx = a.x - last[0], fz = a.z - last[1];
      const A = dx * dx + dz * dz, B = 2 * (fx * dx + fz * dz), Cc = fx * fx + fz * fz - need * need;
      const disc = B * B - 4 * A * Cc;
      if (disc < 0) continue;
      const t = (-B + Math.sqrt(disc)) / (2 * A);
      if (t >= 0 && t <= 1) { poles.push([a.x + dx * t, a.z + dz * t]); i--; }
    }
    for (const p of poles) { p[0] = Math.round(p[0] * 100) / 100; p[1] = Math.round(p[1] * 100) / 100; }
    if (poles.length > 1) objects.push({ kind: "power_line", x: poles[0]![0], y: 0, z: poles[0]![1], props: { pts: poles } });
    }
  }
  return line as (P & { tx: number; tz: number })[];
}
// a road's control points from one place to another: straight out of the start and into the end, gentle bends between
function controlFrom(a: P, ad: P, b: P, bd: P, wiggle: number): [number, number][] {
  const out: [number, number][] = [[a.x, a.z], [a.x + ad.x * 60, a.z + ad.z * 60]];
  const s = { x: a.x + ad.x * 140, z: a.z + ad.z * 140 }, e = { x: b.x - bd.x * 140, z: b.z - bd.z * 140 };
  const len = Math.hypot(e.x - s.x, e.z - s.z);
  const n = Math.max(1, Math.round(len / 350));
  const [nx, nz] = [-(e.z - s.z) / (len || 1), (e.x - s.x) / (len || 1)];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const w = i === 0 || i === n ? 0 : (rand() - 0.5) * 2 * wiggle;
    out.push([s.x + (e.x - s.x) * t + nx * w, s.z + (e.z - s.z) * t + nz * w]);
  }
  out.push([b.x - bd.x * 60, b.z - bd.z * 60], [b.x, b.z]);
  return out.map(([x, z]) => [r1(x), r1(z)]);
}
const corridor = (line: P[]) => { for (const p of line.filter((_, i) => i % 6 === 0)) blocked.push({ x0: p.x - 45, x1: p.x + 45, z0: p.z - 45, z1: p.z + 45 }); };

// highways: from the forest town's end that faces each other town to that town's end that faces back
const hub = towns.find((t) => t.region.id === SPAWN_REGION)!;
const facing = (t: ReturnType<typeof makeTown>, x: number, z: number) =>
  Object.values(t.ends).filter((e) => !e.used).sort((a, b) => -((x - a.x) * a.dx + (z - a.z) * a.dz) + ((x - b.x) * b.dx + (z - b.z) * b.dz))[0]!;
for (const t of towns) {
  if (t === hub) continue;
  const a = facing(hub, t.cx, t.cz), b = facing(t, hub.cx, hub.cz);
  a.used = b.used = true;
  const line = buildRoad(`roam_hw_${t.region.id}`, controlFrom(a, { x: a.dx, z: a.dz }, b, { x: -b.dx, z: -b.dz }, 180), t.region, "road_asphalt", 1, true);
  corridor(line);
}
// the ring: a highway round the map through the four outer towns (autumn in the north, harbour east, desert south, snow west), each
// leg out of one town's end that faces the next town and into that town's end that faces back
const RING = ["autumn", "harbour", "desert", "snow"];
for (let i = 0; i < RING.length; i++) {
  const t = towns.find((o) => o.region.id === RING[i])!, u = towns.find((o) => o.region.id === RING[(i + 1) % RING.length])!;
  const a = facing(t, u.cx, u.cz), b = facing(u, t.cx, t.cz);
  a.used = b.used = true;
  // (the leg bows outwards, away from the middle of the map, so that it goes round the courses near the hub)
  const mx = (t.cx + u.cx) / 2, mz = (t.cz + u.cz) / 2, ml = Math.hypot(mx - hub.cx, mz - hub.cz) || 1;
  const bow = { x: mx + ((mx - hub.cx) / ml) * 1400, z: mz + ((mz - hub.cz) / ml) * 1400 };
  const c1 = controlFrom(a, { x: a.dx, z: a.dz }, bow, { x: (u.cx - t.cx) / Math.hypot(u.cx - t.cx, u.cz - t.cz), z: (u.cz - t.cz) / Math.hypot(u.cx - t.cx, u.cz - t.cz) }, 160);
  const c2 = controlFrom(bow, { x: (u.cx - t.cx) / Math.hypot(u.cx - t.cx, u.cz - t.cz), z: (u.cz - t.cz) / Math.hypot(u.cx - t.cx, u.cz - t.cz) }, b, { x: -b.dx, z: -b.dz }, 160);
  const line = buildRoad(`roam_ring_${RING[i]}`, [...c1.slice(0, -1), ...c2.slice(1)], t.region, "road_asphalt", 1, true);
  corridor(line);
}
towns.forEach(dressTown);

// ---- the courses ----------------------------------------------------------------------------------------------------------------
// Where a course's road in arrives (`end`) and which way it is going there (`into`): behind a stage's start line, along its first stretch;
// onto a circuit's start straight from outside it. `own` is the course's road points where it is placed.
function wayIn(id: string, own: P[], dx: number, dz: number) {
  const track = read(`tracks/${id}.track.json`);
  if (track.open) {
    const [a, b] = track.control as [number, number][];
    const len = Math.hypot(b![0] - a![0], b![1] - a![1]);
    return { end: { x: a![0] + dx, z: a![1] + dz }, into: { x: (b![0] - a![0]) / len, z: (b![1] - a![1]) / len } };
  }
  const p = own[0]!, q = own[1]!;
  const mid = { x: own.reduce((s, o) => s + o.x, 0) / own.length, z: own.reduce((s, o) => s + o.z, 0) / own.length };
  const len = Math.hypot(q.x - p.x, q.z - p.z);
  let n = { x: (q.z - p.z) / len, z: -(q.x - p.x) / len };
  if ((p.x - mid.x) * n.x + (p.z - mid.z) * n.z < 0) n = { x: -n.x, z: -n.z };
  return { end: p, into: { x: -n.x, z: -n.z } };
}
const courseBoxes: Box[] = []; // the courses' land
const lanes: Box[] = []; // the ways in from the courses' starts towards their towns, kept clear of the courses placed after
const trackOf = (id: string) => read(`tracks/${id}.track.json`);
const placed: { id: string; dx: number; dz: number; region: (typeof REGIONS)[number] }[] = [];
for (const region of REGIONS) {
  const town = towns.find((t) => t.region === region)!;
  // the biggest first: they need the most room
  const list = region.courses.map((id) => {
    const scene = read(`scenes/${id}.scene.json`);
    const xs = scene.objects.map((o: Obj) => o.x), zs = scene.objects.map((o: Obj) => o.z);
    return { id, scene, box: { x0: Math.min(...xs) - 30, x1: Math.max(...xs) + 30, z0: Math.min(...zs) - 30, z1: Math.max(...zs) + 30 } };
  }).sort((a, b) => (b.box.x1 - b.box.x0) * (b.box.z1 - b.box.z0) - (a.box.x1 - a.box.x0) * (a.box.z1 - a.box.z0));
  for (const c of list) {
    let found: { dx: number; dz: number } | null = null;
    const mx = (c.box.x0 + c.box.x1) / 2, mz = (c.box.z0 + c.box.z1) / 2;
    for (let r = 500; r < 6000 && !found; r += 100) {
      for (let a = 0; a < 360 && !found; a += 10) {
        const tx = town.cx + Math.cos((a * Math.PI) / 180) * r, tz = town.cz + Math.sin((a * Math.PI) / 180) * r;
        const dx = Math.round(tx - mx), dz = Math.round(tz - mz);
        const b = { x0: c.box.x0 + dx, x1: c.box.x1 + dx, z0: c.box.z0 + dz, z1: c.box.z1 + dz };
        if (blocked.some((o) => overlaps(o, b)) || lanes.some((l) => overlaps(l, b))) continue;
        // its own way in, from its start towards the town, must not run through a course already placed
        const way = (c.scene.objects as Obj[]).filter((o) => o.kind === "waypoint").sort((a, b2) => (a.props!.i as number) - (b2.props!.i as number)).map((o) => ({ x: o.x + dx, z: o.z + dz }));
        const w = wayIn(c.id, way, dx, dz);
        const lane: Box[] = [];
        const ax = w.end.x - w.into.x * 150, az = w.end.z - w.into.z * 150;
        const tl = Math.hypot(town.cx - ax, town.cz - az);
        for (let d = 0; d < tl - 250; d += 40) {
          const x = ax + ((town.cx - ax) / tl) * d, z = az + ((town.cz - az) / tl) * d;
          lane.push({ x0: x - 30, x1: x + 30, z0: z - 30, z1: z + 30 });
        }
        if (lane.some((l) => courseBoxes.some((o) => overlaps(o, l)))) continue;
        found = { dx, dz };
        blocked.push(b);
        courseBoxes.push(b);
        lanes.push(...lane);
      }
    }
    if (!found) throw new Error(`no room for ${c.id}`);
    placed.push({ id: c.id, ...found, region });
    const track = trackOf(c.id);
    const grip = (c.scene.objects.find((o: Obj) => o.kind === "race")?.props?.grip as number) ?? 1;
    const way = (c.scene.objects as Obj[]).filter((o) => o.kind === "waypoint").sort((a, b) => (a.props!.i as number) - (b.props!.i as number));
    routes.push({ name: c.id, pts: way.map((o) => ({ x: o.x + found!.dx, z: o.z + found!.dz })) });
    objects.push({ kind: "road", x: found.dx, y: 0, z: found.dz, props: { model: `road_${c.id}` } });
    for (const o of way) {
      const p = o.props!;
      addPoint(c.id, p.i as number, r1(o.x + found.dx), r1(o.z + found.dz), p.k as number, (p.road as string) ?? track.road, grip, p.w as number | undefined, !track.open);
    }
    for (const o of c.scene.objects as Obj[]) {
      if (DROP.has(o.kind) || isCrowd(o.kind) || o.name) continue;
      scenery.push({ o: { ...o, x: r1(o.x + found.dx), z: r1(o.z + found.dz) }, own: c.id });
    }
    const foliage = c.scene.objects.find((o: Obj) => o.kind === "foliage");
    if (foliage) objects.push({ kind: "roam_foliage", x: found.dx, y: 0, z: found.dz, props: { routes: [c.id], plants: (foliage.props.plants as { count: number }[]).map((p) => ({ ...p, count: Math.round(p.count * GRASS) })) } });
  }
}

// every course's road points, by 20 m square (for the roads in to keep clear of them)
const courseGrid = new Map<string, (P & { r: string })[]>();
for (const r of routes) if (placed.some((p) => p.id === r.name)) for (const q of r.pts) { const k = `${Math.floor(q.x / 20)},${Math.floor(q.z / 20)}`; (courseGrid.get(k) ?? courseGrid.set(k, []).get(k)!).push({ ...q, r: r.name }); }
// each course's road from the nearest road: behind a stage's start line, or onto a circuit's start straight from outside it
for (const c of placed) {
  const track = trackOf(c.id);
  const own = routes.find((r) => r.name === c.id)!.pts;
  const { end, into } = wayIn(c.id, own, c.dx, c.dz);
  // the nearest point of the road network (a town's streets, a highway, another course's road in; never a course itself), from a little
  // way out of its start
  const from = { x: end.x - into.x * 200, z: end.z - into.z * 200 };
  // candidates: the nearest points of the network (one per road, up to eight), each tried with a few different bends; the first road in
  // that keeps 25 m from every other course's road wins, else the one that comes near the fewest of their points
  const starts: { p: P; d: number }[] = [];
  for (const r of routes) {
    if (placed.some((p) => p.id === r.name)) continue;
    let best: P | null = null, bd = Infinity;
    for (const p of r.pts) { const d = (p.x - from.x) ** 2 + (p.z - from.z) ** 2; if (d < bd) { bd = d; best = p; } }
    if (best) starts.push({ p: best, d: bd });
  }
  starts.sort((a, b) => a.d - b.d);
  const clash = (line: P[]) => {
    let n = 0;
    for (const q of line) {
      const gx = Math.floor(q.x / 20), gz = Math.floor(q.z / 20);
      for (let i = gx - 2; i <= gx + 2; i++) for (let j = gz - 2; j <= gz + 2; j++)
        for (const o of (courseGrid.get(`${i},${j}`) ?? [])) if (o.r !== c.id && (o.x - q.x) ** 2 + (o.z - q.z) ** 2 < 625) n++;
    }
    return n;
  };
  let chosen: [number, number][] | null = null, fewest = Infinity;
  for (const st of starts.slice(0, 8)) {
    const out = { x: from.x - st.p.x, z: from.z - st.p.z };
    const ol = Math.hypot(out.x, out.z) || 1;
    for (let tryN = 0; tryN < 4; tryN++) {
      const control = controlFrom(st.p, { x: out.x / ol, z: out.z / ol }, end, into, tryN === 0 ? 0 : 140);
      const n = clash(centreline(control, 5, true));
      if (n < fewest) { fewest = n; chosen = control; }
      if (n === 0) break;
    }
    if (fewest === 0) break;
  }
  if (fewest > 0) console.log(`  ${c.id}: its road in comes near another course (${fewest} points)`);
  const kind = c.region.road, grip = c.region.grip;
  const line = buildRoad(`roam_to_${c.id}`, chosen!, c.region, kind, grip, false);
  objects.push({ kind: "roam_foliage", x: line[0]!.x, y: 0, z: line[0]!.z, props: { routes: [`roam_to_${c.id}`], plants: [] } });
  // the events: a circuit's race at its start and its time trial a little way round; a stage's rally at its start
  const at = (i: number, side: number) => {
    const p = own[i]!, q = own[i + 1]!;
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    const [tx, tz] = [(q.x - p.x) / len, (q.z - p.z) / len];
    return { x: r1(p.x + tz * side), z: r1(p.z - tx * side), ry: r3(Math.atan2(tx, tz)) };
  };
  const ev = (mode: string, w: { x: number; z: number; ry: number }) => objects.push({ kind: "event", x: w.x, y: 0, z: w.z, props: { course: c.id, mode, ry: w.ry } });
  if (track.open) ev("rally", at(4, 9));
  else { ev("race", at(3, 9)); ev("trial", at(Math.min(40, own.length - 2), 9)); }
}

// scenery on any road but its own is left out: within 9 m of another road's middle (the road is 12 m wide), and none in a town
let dropped = 0;
const grid = new Map<string, P[]>();
for (const r of routes) for (const p of r.pts) { const k = `${Math.floor(p.x / 20)},${Math.floor(p.z / 20)}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(Object.assign({ r: r.name }, p)); }
const nearOther = (o: Obj, own: string) => {
  const gx = Math.floor(o.x / 20), gz = Math.floor(o.z / 20);
  for (let i = gx - 1; i <= gx + 1; i++) for (let j = gz - 1; j <= gz + 1; j++)
    for (const p of (grid.get(`${i},${j}`) ?? []) as (P & { r: string })[]) if (p.r !== own && (p.x - o.x) ** 2 + (p.z - o.z) ** 2 < 81) return true;
  return false;
};
const townBoxes = towns.map((t) => ({ x0: t.main.x0 - 18, x1: t.main.x1 + 18, z0: t.side.z0 - 20, z1: t.side.z1 + 20 }));
const inTown = (o: Obj) => townBoxes.some((b) => o.x > b.x0 && o.x < b.x1 && o.z > b.z0 && o.z < b.z1);
for (const { o, own } of scenery) {
  if (inTown(o) || nearOther(o, own)) dropped++;
  else objects.push(o);
}

// ---- the land: one heightmap for the whole world (terrain/world.png), and water ---------------------------------------------------
// Within about 40 m of any road the ground keeps the gentle rolling the courses were made on (the forest's two hill waves), so every road
// drives as it did; further off, each region's own land comes in: hills in the forest and autumn, mesas in the desert, mountains in the
// snow, low ground by the harbour. Lakes lie in basins well away from the roads, and east of the harbour the land goes down into the sea.
// Water stands at WATER metres. The picture keeps each height in two bytes (red the high, green the low), as the engine reads an 8-bit
// RGB heightmap: exact, and the studio's scene view reads it the same way.
const CELL = 20, BASE = 30, WATER = BASE - 9;
const allPts = routes.flatMap((r) => r.pts);
const minX = Math.min(...allPts.map((p) => p.x)) - 1600, maxX = Math.max(...allPts.map((p) => p.x)) + 1600;
const minZ = Math.min(...allPts.map((p) => p.z)) - 1600, maxZ = Math.max(...allPts.map((p) => p.z)) + 1600;
const W = Math.ceil((maxX - minX) / CELL) + 1, H = Math.ceil((maxZ - minZ) / CELL) + 1;
// the distance from every cell to the nearest road, by a two-pass chamfer from the cells the roads cross
const dist = new Float32Array(W * H).fill(1e9);
for (const r of routes) for (let i = 0; i < r.pts.length; i++) {
  const a = r.pts[i]!, b = r.pts[Math.min(i + 1, r.pts.length - 1)]!;
  for (let t = 0; t <= 1; t += 0.25) {
    const x = Math.round((a.x + (b.x - a.x) * t - minX) / CELL), z = Math.round((a.z + (b.z - a.z) * t - minZ) / CELL);
    if (x >= 0 && x < W && z >= 0 && z < H) dist[z * W + x] = 0;
  }
}
const D1 = CELL, D2 = CELL * Math.SQRT2;
for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
  let d = dist[z * W + x]!;
  if (x > 0) d = Math.min(d, dist[z * W + x - 1]! + D1);
  if (z > 0) { d = Math.min(d, dist[(z - 1) * W + x]! + D1); if (x > 0) d = Math.min(d, dist[(z - 1) * W + x - 1]! + D2); if (x < W - 1) d = Math.min(d, dist[(z - 1) * W + x + 1]! + D2); }
  dist[z * W + x] = d;
}
for (let z = H - 1; z >= 0; z--) for (let x = W - 1; x >= 0; x--) {
  let d = dist[z * W + x]!;
  if (x < W - 1) d = Math.min(d, dist[z * W + x + 1]! + D1);
  if (z < H - 1) { d = Math.min(d, dist[(z + 1) * W + x]! + D1); if (x < W - 1) d = Math.min(d, dist[(z + 1) * W + x + 1]! + D2); if (x > 0) d = Math.min(d, dist[(z + 1) * W + x - 1]! + D2); }
  dist[z * W + x] = d;
}
// smooth value noise, and its layers
const hash = (i: number, j: number) => { let h = (i * 374761393 + j * 668265263) ^ 0x5bd1e995; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
const smooth = (t: number) => t * t * (3 - 2 * t);
const noise = (x: number, z: number) => {
  const i = Math.floor(x), j = Math.floor(z), fx = smooth(x - i), fz = smooth(z - j);
  const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
};
const fbm = (x: number, z: number, oct = 4) => { let v = 0, amp = 0.5, f = 1; for (let o = 0; o < oct; o++) { v += noise(x * f, z * f) * amp; f *= 2.03; amp *= 0.5; } return v / 0.9375; };
const smoothstep = (a: number, b: number, v: number) => smooth(Math.max(0, Math.min(1, (v - a) / (b - a))));
const LAND: Record<string, (x: number, z: number) => number> = {
  forest: (x, z) => 38 * fbm(x / 650, z / 650),
  autumn: (x, z) => 60 * fbm(x / 520 + 17, z / 520),
  desert: (x, z) => { const m = fbm(x / 720 + 40, z / 720); return 52 * smoothstep(0.52, 0.6, m) + 10 * fbm(x / 260, z / 260); },
  snow: (x, z) => { const r = 1 - Math.abs(2 * fbm(x / 900 + 90, z / 900) - 1); return 190 * r * r + 25 * fbm(x / 300, z / 300); },
  harbour: (x, z) => 8 * fbm(x / 400 + 60, z / 400),
};
const forestWaves = (forest.objects.find((o: Obj) => o.kind === "race").props.terrain.waves as { height: number; wavelength: number; direction: number; phase: number }[]);
const rolling = (x: number, z: number) => forestWaves.reduce((h, w) => {
  const k = (Math.PI * 2) / w.wavelength, a = (w.direction * Math.PI) / 180;
  return h + w.height * Math.sin(k * Math.cos(a) * x + k * Math.sin(a) * z + w.phase);
}, 0);
// the lakes: a few places well away from any road (and not by the sea), at least 1.3 km apart
const coastX = maxX - 1600 + 120; // (just east of the easternmost road: the sea in view from the harbour's roads)
// (beside a road: their middles 170 to 300 m from the nearest, their shores stopping just short of it, in clear view through the fog;
// tried in a shuffled order, so that they spread over the map)
const lakes: { x: number; z: number; r: number }[] = [];
const spots: { x: number; z: number; k: number; d: number }[] = [];
for (let z = minZ + 800; z < maxZ - 800; z += 200) for (let x = minX + 800; x < coastX - 700; x += 200) {
  const d = dist[Math.round((z - minZ) / CELL) * W + Math.round((x - minX) / CELL)]!;
  if (d > 170 && d < 300) spots.push({ x, z, k: hash(Math.round(x), Math.round(z)), d });
}
spots.sort((a, b) => a.k - b.k);
for (const sp of spots) {
  if (lakes.length >= 14) break;
  if (lakes.some((l) => Math.hypot(l.x - sp.x, l.z - sp.z) < 1300)) continue;
  // (as big as it can be with its shore, 1.7 times its radius, stopping 25 m short of the road: a lake by the road)
  lakes.push({ x: sp.x, z: sp.z, r: Math.min(150, (sp.d - 25) / 1.7) });
}
const heights = new Float32Array(W * H);
let top = 0;
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const x = minX + i * CELL, z = minZ + j * CELL;
  const away = smoothstep(40, 260, dist[j * W + i]!);
  // each region's land, weighted by how near its town is
  let land = 0, wsum = 0;
  for (const t of towns) { const w = Math.exp(-(((x - t.cx) ** 2 + (z - t.cz) ** 2) / 2600 ** 2)); land += w * LAND[t.region.id]!(x, z); wsum += w; }
  land /= wsum || 1;
  let h = BASE + rolling(x, z) * (1 - away) + land * away;
  for (const l of lakes) {
    const d = Math.hypot(x - l.x, z - l.z);
    if (d < l.r * 1.7) {
      const bed = WATER - 2 - 7 * Math.max(0, 1 - (d / l.r) ** 2);
      h = d < l.r ? bed : WATER + 0.6 + (h - WATER - 0.6) * smoothstep(l.r, l.r * 1.7, d);
    }
  }
  // the sea, east of the harbour, its coast wandering a little
  const coast = coastX + 140 * (fbm(z / 900 + 5, 3) - 0.5);
  // (the last 400 m before the coast slope gently down to a beach a few metres above the water, so the sea is in view from the
  // harbour's roads; past the coast the bed drops away)
  h = h + (WATER + 3 - h) * smoothstep(coast - 400, coast, x);
  if (x > coast) h = h + (WATER - 14 - h) * smoothstep(coast, coast + 110, x);
  heights[j * W + i] = h;
  top = Math.max(top, h);
}
const HEIGHT = Math.ceil(top + 5);
{
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let j = 0; j < H; j++) {
    raw[j * (W * 3 + 1)] = 0;
    for (let i = 0; i < W; i++) {
      const v = Math.max(0, Math.min(65535, Math.round((heights[j * W + i]! / HEIGHT) * 65535)));
      const o = j * (W * 3 + 1) + 1 + i * 3;
      raw[o] = v >> 8; raw[o + 1] = v & 255; raw[o + 2] = 0;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, "latin1"), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  writeFileSync(join(GAME, "terrain/world.png"), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]));
}
// the race object of the world carries the heightmap (the scene view shows it too)
const worldRace = objects.find((o) => o.kind === "race")!;
worldRace.props = { ...worldRace.props, terrain: { heightmap: "terrain/world.png", x: minX, z: minZ, size: (W - 1) * CELL, height: HEIGHT } };
// the water: each lake a square of water over its basin, and the sea a few big squares (the land above the water hides what is under it)
for (const l of lakes) objects.push({ kind: "water", x: r1(l.x), y: 0, z: r1(l.z), props: { size: Math.round(l.r * 2.6), level: WATER } });
// (the sea in squares of 600 m: a square is drawn its size times 1000 m up and its model that far down, so a big one loses its height
// to rounding; these are the size of the lakes)
for (let z = minZ; z < maxZ; z += 600) for (let x = coastX; x < coastX + 3000; x += 600) objects.push({ kind: "water", x: r1(x + 300), y: 0, z: r1(z + 300), props: { size: 600, level: WATER } });
// ---- the land's own scenery: woods in patches, and fields between them ----------------------------------------------------------
// The courses' scenery is a scatter along their roads; between them the land gets woods: where a slow noise is high, a patch of trees of
// one or two kinds (the nearest region's), dense in the middle and thinning at the edge, with rocks here and there; where it is low, open
// ground. In the desert, cacti and red rocks in loose clumps instead. Nothing on a road, in a town or in water.
let woods = 0;
const townClear = towns.map((t) => ({ x0: t.main.x0 - 60, x1: t.main.x1 + 60, z0: t.side.z0 - 60, z1: t.side.z1 + 60 }));
for (let z = minZ + 400; z < maxZ - 400; z += 90) for (let x = minX + 400; x < coastX - 150; x += 90) {
  const gi = Math.round((z - minZ) / CELL) * W + Math.round((x - minX) / CELL);
  const d = dist[gi]!;
  if (d < 45 || d > 900) continue;
  if (townClear.some((b) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1)) continue;
  const patch = fbm(x / 700 + 11, z / 700 + 7, 3);
  if (patch < 0.56) continue;
  // the nearest region's kinds of tree: a patch keeps to one or two of them
  let near = towns[0]!, nd = Infinity;
  for (const t of towns) { const dd = (x - t.cx) ** 2 + (z - t.cz) ** 2; if (dd < nd) { nd = dd; near = t; } }
  const look = lookOf(near.region);
  const kinds = look.trees as string[];
  const k1 = kinds[Math.floor(noise(x / 500, z / 500) * kinds.length) % kinds.length]!, k2 = kinds[Math.floor(noise(x / 500 + 3, z / 500) * kinds.length) % kinds.length]!;
  const dense = Math.min(1, (patch - 0.56) / 0.12);
  const n = near.region.id === "desert" ? 1 + Math.round(dense * 2) : 2 + Math.round(dense * 5);
  // (one `woods` object a patch, listing its trees: [dx, dz, which kind, turn in hundredths of a radian, size in hundredths])
  const rock = (look.rock as string[])[Math.floor(rand() * look.rock.length)]!;
  const kindsHere = [k1, k2, rock];
  const trees: number[][] = [];
  for (let i = 0; i < n; i++) {
    const tx = x + (rand() - 0.5) * 88, tz = z + (rand() - 0.5) * 88;
    const ti = Math.round((tz - minZ) / CELL) * W + Math.round((tx - minX) / CELL);
    if ((dist[ti] ?? 0) < 40 || (heights[ti] ?? 0) < WATER + 1.5) continue;
    const which = rand() < 0.07 ? 2 : rand() < 0.5 ? 0 : 1;
    trees.push([Math.round(tx - x), Math.round(tz - z), which, Math.round(rand() * 628), Math.round((0.8 + rand() * 0.6) * 100)]);
    woods++;
  }
  if (trees.length) objects.push({ kind: "woods", x, y: 0, z, props: { kinds: kindsHere, trees } });
}
console.log(`woods: ${woods} trees and rocks in patches between the roads`);
const heightAt = (x: number, z: number) => heights[Math.max(0, Math.min(H - 1, Math.round((z - minZ) / CELL))) * W + Math.max(0, Math.min(W - 1, Math.round((x - minX) / CELL)))]!;
console.log(`land: ${W} x ${H} samples of ${CELL} m, heights to ${HEIGHT} m, ${lakes.length} lakes, the coast at x = ${Math.round(coastX)}; lowest road ${Math.round(Math.min(...allPts.map((p) => heightAt(p.x, p.z))))} m (water ${WATER} m)`);

// free roam starts in the forest town, on its main street, heading east
objects.push({ kind: "roam_spawn", name: "spawn", x: hub.cx - 60, y: 0, z: hub.cz, props: { ry: r3(Q) } });

// the old link roads' models, gone with them
for (const f of readdirSync(join(GAME, "models"))) {
  if (/^road_roam_.*\.glb$/.test(f) && !routes.some((r) => `road_${r.name}.glb` === f)) unlinkSync(join(GAME, "models", f));
}

for (const [route, r] of roadData) {
  r.pts.sort((a, b) => a.i - b.i);
  const first = r.pts[0]!.v;
  objects.push({ kind: "roam_road", x: first[0] as number, y: 0, z: first[1] as number, props: { route, road: r.road, grip: r.grip, ...(r.loop ? { loop: true } : {}), pts: r.pts.map((p) => p.v) } });
}
const scene = { version: 1, background: forest.background, camera: { eye: [0, 3000, 2500], target: [0, 0, 0], fov: 55 }, objects };
const parsed = parseScene(JSON.stringify(scene));
if (!parsed.ok) throw new Error(parsed.error);
writeFileSync(join(GAME, "scenes/roam.scene.json"), serializeScene(parsed.scene));
writeFileSync(join(GAME, "../../build/roam-plan.json"), JSON.stringify({ routes, towns: towns.map((t) => ({ id: t.region.id, x: t.cx, z: t.cz })), placed }));
const count = (k: string) => objects.filter((o) => o.kind === k).length;
console.log(`roam: ${objects.length} objects, ${[...roadData.values()].reduce((n, r) => n + r.pts.length, 0)} road points on ${routes.length} roads, ${count("event")} events, ${towns.length} towns, ${dropped} pieces of scenery left off the roads and out of the towns`);
