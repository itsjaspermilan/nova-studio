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
const REGIONS = [
  { id: "forest", name: "Pine Ridge", town: [0, 0], look: "pine_ridge", road: "road_gravel", grip: 0.88, courses: ["pine_ridge", "ridge_gp", "stage_pine_ridge", "stage_marathon"] },
  { id: "autumn", name: "Autumn Glen", town: [-300, -3600], look: "autumn_glen", road: "road_gravel", grip: 0.88, courses: ["autumn_glen", "autumn_summit", "stage_autumn_glen"] },
  { id: "desert", name: "Dust Valley", town: [400, 3800], look: "dust_valley", road: "road_sand", grip: 0.85, courses: ["dust_valley", "copper_canyon", "stage_dust_valley", "stage_canyon", "stage_mesa_run"] },
  { id: "snow", name: "Frost Pass", town: [-4000, -900], look: "frost_pass", road: "road_snow", grip: 0.72, courses: ["frost_pass", "glacier_ring", "stage_frost_pass", "stage_glacier_night"] },
  { id: "harbour", name: "Harbour", town: [4000, -600], look: "harbour_lights", road: "road_asphalt", grip: 1, courses: ["harbour_lights", "neon_docks", "stage_harbour_lights", "stage_harbour_sprint"] },
];
const SPAWN_REGION = "forest";
const GRASS = 0.3; // the share of each course's grass planted in the open world (twenty courses of grass would be too much for a handheld)
const DROP = new Set(["race", "foliage", "waypoint", "grid_slot", "section_gate", "road", "start_arch", "road_start", "tower", "flag_checkers"]);
const isCrowd = (k: string) => k.startsWith("crowd_");

const objects: Obj[] = [];
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
  for (let x = main.x0 + TILE / 2; x < main.x1; x += TILE) put(Math.abs(x - main.cross) < 1 ? "ck_road_crossroad" : "ck_road_straight", x, main.z);
  for (let z = main.z - TILE; z > side.z0; z -= TILE) put("ck_road_straight", main.cross, z, Q);
  for (let z = main.z + TILE; z < side.z1; z += TILE) put("ck_road_straight", main.cross, z, Q);
  put(ends.n.used ? "ck_road_straight" : "ck_road_end_round", main.cross, side.z0, Q);
  put(ends.s.used ? "ck_road_straight" : "ck_road_end_round", main.cross, side.z1, -Q);
  const pts = (name: string, list: [number, number][]) => {
    routes.push({ name, pts: list.map(([x, z]) => ({ x, z })) });
    list.forEach(([x, z], i) => objects.push({ kind: "roam_point", x, y: 0, z, props: { route: name, i: i + 1, k: 0, w: 5, road: "road_asphalt", grip: 1 } }));
  };
  const mainPts: [number, number][] = [];
  for (let x = main.x0; x <= main.x1; x += 7) mainPts.push([x, main.z]);
  pts(`town_${region.id}_main`, mainPts);
  const sidePts: [number, number][] = [];
  for (let z = side.z0; z <= side.z1; z += 7) sidePts.push([main.cross, z]);
  pts(`town_${region.id}_side`, sidePts);
  const HOUSES = "abcdefgh";
  let h = region.id.length; // (each town starts at another house, so no two look the same)
  for (const dx of [-84, -60, -36, 46, 70]) {
    put(`ck_house_${HOUSES[h++ % 8]}`, t.cx + dx, main.z - 19, 0);
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
  objects.push({ kind: "road", x: 0, y: 0, z: 0, props: { model: `road_${id}` } });
  for (const o of made.scene.objects as Obj[]) {
    if (o.kind === "waypoint") objects.push({ kind: "roam_point", x: o.x, y: 0, z: o.z, props: { route: id, i: o.props!.i, k: o.props!.k, road: kind, grip } });
    else if (!DROP.has(o.kind) && !isCrowd(o.kind)) scenery.push({ o, own: id });
  }
  writeFileSync(join(GAME, `models/road_${id}.glb`), roadGlb(control, kind, true, []));
  if (highway) {
    // a pole every 7 m (the kit's piece is two poles 7 m apart with the wire between: lib/powerlines.lua chains them), 11 m to one side
    const all = line.map((p: P & { tx: number; tz: number }) => ({ x: p.x - p.tz * 11, z: p.z + p.tx * 11 }));
    // (only the first 450 m out of each town: a pole every 7 m the whole way, as the kit spaces them, was a forest of poles)
    for (const side of [all.slice(0, 90), all.slice(-90).reverse()]) {
    const poles: [number, number][] = [[side[7]!.x, side[7]!.z]];
    let need = 7; // (metres to the next pole, walking along the line: each pole exactly 7 m from the last, measured straight)
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
        if (!blocked.some((o) => overlaps(o, b))) { found = { dx, dz }; blocked.push(b); }
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
      objects.push({ kind: "roam_point", x: r1(o.x + found.dx), y: 0, z: r1(o.z + found.dz), props: { route: c.id, i: p.i, k: p.k, road: (p.road as string) ?? track.road, grip, ...(p.w ? { w: p.w } : {}), ...(track.open ? {} : { loop: true }) } });
    }
    for (const o of c.scene.objects as Obj[]) {
      if (DROP.has(o.kind) || isCrowd(o.kind) || o.name) continue;
      scenery.push({ o: { ...o, x: r1(o.x + found.dx), z: r1(o.z + found.dz) }, own: c.id });
    }
    const foliage = c.scene.objects.find((o: Obj) => o.kind === "foliage");
    if (foliage) objects.push({ kind: "roam_foliage", x: found.dx, y: 0, z: found.dz, props: { routes: [c.id], plants: (foliage.props.plants as { count: number }[]).map((p) => ({ ...p, count: Math.round(p.count * GRASS) })) } });
  }
}

// each course's road from the nearest road: behind a stage's start line, or onto a circuit's start straight from outside it
for (const c of placed) {
  const track = trackOf(c.id);
  const own = routes.find((r) => r.name === c.id)!.pts;
  let end: P, into: P;
  if (track.open) {
    const [a, b] = track.control as [number, number][];
    const len = Math.hypot(b![0] - a![0], b![1] - a![1]);
    into = { x: (b![0] - a![0]) / len, z: (b![1] - a![1]) / len };
    end = { x: a![0] + c.dx, z: a![1] + c.dz };
  } else {
    const p = own[0]!, q = own[1]!;
    const mid = { x: own.reduce((s, o) => s + o.x, 0) / own.length, z: own.reduce((s, o) => s + o.z, 0) / own.length };
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    let n = { x: (q.z - p.z) / len, z: -(q.x - p.x) / len };
    if ((p.x - mid.x) * n.x + (p.z - mid.z) * n.z < 0) n = { x: -n.x, z: -n.z };
    into = { x: -n.x, z: -n.z };
    end = p;
  }
  // the nearest point of the road network (a town's streets, a highway, another course's road in; never a course itself), from a little
  // way out of its start
  const from = { x: end.x - into.x * 200, z: end.z - into.z * 200 };
  let best: P = towns[0]!.ends.w, bd = Infinity;
  for (const r of routes) {
    if (placed.some((p) => p.id === r.name)) continue;
    for (const p of r.pts) { const d = (p.x - from.x) ** 2 + (p.z - from.z) ** 2; if (d < bd) { bd = d; best = p; } }
  }
  const out = { x: from.x - best.x, z: from.z - best.z };
  const ol = Math.hypot(out.x, out.z) || 1;
  const kind = c.region.road, grip = c.region.grip;
  const line = buildRoad(`roam_to_${c.id}`, controlFrom(best, { x: out.x / ol, z: out.z / ol }, end, into, 60), c.region, kind, grip, false);
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

// free roam starts in the forest town, on its main street, heading east
objects.push({ kind: "roam_spawn", name: "spawn", x: hub.cx - 60, y: 0, z: hub.cz, props: { ry: r3(Q) } });

// the old link roads' models, gone with them
for (const f of readdirSync(join(GAME, "models"))) {
  if (/^road_roam_.*\.glb$/.test(f) && !routes.some((r) => `road_${r.name}.glb` === f)) unlinkSync(join(GAME, "models", f));
}

const scene = { version: 1, background: forest.background, camera: { eye: [0, 3000, 2500], target: [0, 0, 0], fov: 55 }, objects };
const parsed = parseScene(JSON.stringify(scene));
if (!parsed.ok) throw new Error(parsed.error);
writeFileSync(join(GAME, "scenes/roam.scene.json"), serializeScene(parsed.scene));
writeFileSync(join(GAME, "../../build/roam-plan.json"), JSON.stringify({ routes, towns: towns.map((t) => ({ id: t.region.id, x: t.cx, z: t.cz })), placed }));
const count = (k: string) => objects.filter((o) => o.kind === k).length;
console.log(`roam: ${objects.length} objects, ${count("roam_point")} road points on ${routes.length} roads, ${count("event")} events, ${towns.length} towns, ${dropped} pieces of scenery left off the roads and out of the towns`);
