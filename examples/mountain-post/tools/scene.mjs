// The valley's scene file (scenes/valley.scene.json) composed from layout.mjs: the houses and everything at them, the signposts and
// mailboxes, the bridge, the barrier, the roads' and the water's lines (for the map, the minimap and the limits), and the forest,
// planted by rules that keep sight lines open (a clear verge along each road, clearings round the houses, the picnic spot's view,
// the bend on Fern Lane that hides Hazel's cabin until you are round it) and close the map's edges with thick wood.
// Also the office's scene (scenes/office.scene.json) and the one-line entity files of the static props.
import { centreline } from "../../../scripts/lib/trackgen.mjs";
import { BOUNDS_EN, BRIDGE, CREEK, GORGE, LAKE, PADS, PLACES, ROADS, SIGNS, ry_facing, xz } from "./layout.mjs";
import { rng } from "./geo.mjs";
import { put, tool } from "./lib.mjs";

const r2 = (v) => Math.round(v * 100) / 100;
const objects = [];
const obj = (kind, en, props = {}, name) => {
  const [x, z] = xz(en);
  const o = { kind, x: r2(x), y: 0, z: r2(z) };
  if (name) o.name = name;
  if (Object.keys(props).length) o.props = props;
  objects.push(o);
  return o;
};
const line = (pts, spacing = 5) => centreline(pts.length < 4 ? [pts[0], ...pts, pts.at(-1)] : pts, spacing, true).map((p) => [p.x, p.z]);
const norm = ([a, b]) => { const l = Math.hypot(a, b) || 1; return [a / l, b / l]; };

// ---- the ground, the roads' and the water's lines --------------------------------------------------------------------------------------
obj("valley_ground", [0, 0], { roads: ["road_post_road", "road_fern_lane", "road_kettle_west", "road_kettle_east"] }, "ground");
const roadLines = {};
for (const r of ROADS) {
  roadLines[r.id] = line(r.control);
  obj("roadline", [0, 0], { key: r.id, label: r.name, surface: r.surface === "road_asphalt" ? "road" : "gravel", width: r.width, points: line(r.control.map(xz)).map(([x, z]) => [r2(x), r2(z)]) });
}
const creekLine = line(CREEK.points), gorgeLine = line(GORGE.points);
obj("water", [0, 0], { key: "creek", width: CREEK.width + 1.2, depth: 0.35, points: line(CREEK.points.map(xz), 4).map(([x, z]) => [r2(x), r2(z)]), sound: true }, "creek");
obj("water", [0, 0], { key: "gorge", width: GORGE.width + 2, depth: 1.0, points: line(GORGE.points.map(xz), 6).map(([x, z]) => [r2(x), r2(z)]) }, "gorge");
obj("lake", [0, 300], { z0: 285, level: LAKE.level }, "lake");
obj("limits", [0, 0], { bounds: [-BOUNDS_EN.e1, BOUNDS_EN.n0, -BOUNDS_EN.e0, BOUNDS_EN.n1], edge: 26, gorge: 236 }, "limits");

// distances, for the planting rules
const distTo = (pts, [e, n]) => {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((e - ax) * dx + (n - az) * dz) / l2));
    best = Math.min(best, Math.hypot(e - ax - dx * t, n - az - dz * t));
  }
  return best;
};
// (a point along a road's line at a distance, and its direction)
const along = (pts, d) => {
  let left = d;
  for (let i = 0; i + 1 < pts.length; i++) {
    const seg = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    if (left <= seg) { const t = left / seg; return { p: [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t], dir: norm([pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]]) }; }
    left -= seg;
  }
  const n = pts.length;
  return { p: pts[n - 1], dir: norm([pts[n - 1][0] - pts[n - 2][0], pts[n - 1][1] - pts[n - 2][1]]) };
};
const lengthOf = (pts) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
const used = []; // footprints already taken: [e, n, r]
const take = (en, r) => used.push([en[0], en[1], r]);
const free = (en, r) => used.every(([e, n, rr]) => Math.hypot(en[0] - e, en[1] - n) > r + rr);

// A point of a house in its model's own metres (lx: its left, lz: its front), as (E, N): the model faces `face`, and its +x is its
// own left, which is (-fn, fe) on the map.
const at = (building, face, lx, lz) => { const f = norm(face); return [building[0] + f[0] * lz - f[1] * lx, building[1] + f[1] * lz + f[0] * lx]; };
// a porch or a step: a level floor over a rectangle of the house's front (`h` its height)
const deck = (building, face, lx, lz, hw, hl, h) => obj("deck", at(building, face, lx, lz), { ry: r2(ry_facing(...norm(face))), hw, hl, h });

// ---- the post office -------------------------------------------------------------------------------------------------------------------
const po = PLACES.post_office;
obj("post_office", po.building, { ry: r2(ry_facing(...po.face)) }, "post_office");
take(po.building, 9);
// (models.mjs: 9 x 6.4 m, the floor 0.45 up, the porch 2.2 deep in front, three steps down from the porch's middle)
obj("spot", at(po.building, po.face, 0, 3.55), { ry: r2(ry_facing(...po.face)) }, "office_door");
deck(po.building, po.face, 0, 4.3, 3.9, 1.1, 0.45);
deck(po.building, po.face, 0, 5.6, 1.1, 0.25, 0.3);
deck(po.building, po.face, 0, 5.9, 1.1, 0.2, 0.15);
obj("van", po.parking, { ry: r2(ry_facing(...po.parking_face)) }, "van");
obj("postmaster", at(po.building, po.face, 0, 7.6), { ry: r2(ry_facing(1, 0)) }, "postmaster");
take(po.parking, 4);
obj("bench", [-8.5, -197], { ry: r2(ry_facing(1, 0.3)) });
obj("woodpile", [-27, -177], { ry: r2(ry_facing(0, -1)) });
obj("flowers", [-11.5, -191]); obj("flowers", [-11.8, -181]); obj("bush", [-14, -195.5]); obj("bush2", [-28, -195]);
for (let i = 0; i < 4; i++) obj("fence", [-30 + i * 3.05, -199], { ry: r2(ry_facing(0, 1) + Math.PI / 2) });

// ---- No. 3, Hazel's ---------------------------------------------------------------------------------------------------------------------
const hz = PLACES.hazel;
obj("cabin_hazel", hz.building, { ry: r2(ry_facing(...hz.face)) }, "cabin_hazel");
take(hz.building, 9);
const hzRight = [-hz.face[1], hz.face[0]]; // (the cabin's right as you face it: the workshop stands there)
const ws = [hz.building[0] + hzRight[0] * -8 + hz.face[0] * 1.5, hz.building[1] + hzRight[1] * -8 + hz.face[1] * 1.5];
obj("workshop", ws, { ry: r2(ry_facing(...hz.face)) }, "workshop");
take(ws, 4);
obj("sawhorse", hz.sawhorse, { ry: r2(ry_facing(...hz.face) + 0.4) }, "sawhorse");
obj("sawhorse", [hz.sawhorse[0] - 1.6 * hz.face[1], hz.sawhorse[1] + 1.6 * hz.face[0]], { ry: r2(ry_facing(...hz.face) + 0.5) });
obj("planks", [hz.sawhorse[0] + 2.8, hz.sawhorse[1] + 2.2], { ry: r2(ry_facing(...hz.face) + 1.4) });
obj("woodpile", [hz.building[0] + 5.5, hz.building[1] + 2.5], { ry: r2(ry_facing(...hz.face)) });
// (7.5 x 6 m, the door left of the middle; the porch 2 m deep, 0.36 up)
obj("spot", at(hz.building, hz.face, -1.0, 3.7), {}, "door_hazel");
deck(hz.building, hz.face, 0, 4.1, 3.25, 1.0, 0.36);
obj("hazel", hz.resident, { ry: r2(ry_facing(1, -0.6)), work: hz.sawhorse }, "hazel");
obj("mailbox", hz.mailbox, { ry: r2(ry_facing(0.5, -1)), number: 3 }, "mailbox_3");
for (const s of [-1.2, 1.2]) obj("gate_post", [hz.gate[0] + s * 2.9 * 0.66, hz.gate[1] + s * 2.9 * 0.75]);
obj("flowers", [hz.building[0] + 4, hz.building[1] - 4.5]);
obj("bush", [hz.building[0] - 5, hz.building[1] - 3]);
// the low stone wall on the left of Fern Lane, going up, along its last stretch: right at the edge, where everyone clips it
{
  const pts = roadLines.fern_lane, L = lengthOf(pts);
  for (let d = L - 92; d < L - 10; d += 4.05) {
    const { p, dir } = along(pts, d);
    const left = [-dir[1], dir[0]];
    const off = 2.3 + 1.0;
    obj("stone_wall", [p[0] + left[0] * off, p[1] + left[1] * off], { ry: r2(ry_facing(dir[0], dir[1]) + Math.PI / 2) });
    take([p[0] + left[0] * off, p[1] + left[1] * off], 2);
  }
}

// ---- No. 7, Pip's -------------------------------------------------------------------------------------------------------------------------
const pp = PLACES.pip;
obj("cabin_pip", pp.building, { ry: r2(ry_facing(...pp.face)) }, "cabin_pip");
take(pp.building, 8);
obj("mast", pp.mast, { ry: 0.3 }, "mast");
take(pp.mast, 2);
// (6 x 5 m, the yellow door right of the middle; the porch 1.5 m deep, 0.4 up)
obj("spot", at(pp.building, pp.face, 0.9, 3.0), {}, "door_pip");
deck(pp.building, pp.face, 0, 3.3, 2.7, 0.75, 0.4);
obj("pip", pp.resident, { ry: r2(ry_facing(-0.8, -0.6)), work: [pp.mast[0] - 1.6, pp.mast[1] - 1.0] }, "pip");
obj("mailbox", pp.mailbox, { ry: r2(ry_facing(-1, -0.4)), number: 7 }, "mailbox_7");
for (const s of [-1.2, 1.2]) obj("gate_post", [pp.gate[0] + s * 2.9 * 0.78, pp.gate[1] - s * 2.9 * 0.62]);
for (let i = 0; i < 5; i++) obj("fence", [pp.gate[0] + 5.5 + i * 2.6 * 0.78, pp.gate[1] - 4.5 - i * 2.6 * 0.62 + 0.0], { ry: r2(ry_facing(0.78, -0.62) + Math.PI / 2) });
obj("flowers", [pp.building[0] - 4, pp.building[1] - 3.6]); obj("flowers", [pp.building[0] + 3.5, pp.building[1] - 4.2]);
obj("bush2", [pp.building[0] + 5, pp.building[1] + 1]);
obj("woodpile", [pp.building[0] - 4.5, pp.building[1] + 2.5], { ry: r2(ry_facing(...pp.face)) });

// ---- the bridge over Kettle Creek, the barrier at the gorge and what is left of the lake bridge ---------------------------------------
{
  const mid = [(BRIDGE.a[0] + BRIDGE.b[0]) / 2, (BRIDGE.a[1] + BRIDGE.b[1]) / 2], d = norm([BRIDGE.b[0] - BRIDGE.a[0], BRIDGE.b[1] - BRIDGE.a[1]]);
  obj("bridge", mid, { ry: r2(ry_facing(d[0], d[1])), a: xz(BRIDGE.a).map(r2), b: xz(BRIDGE.b).map(r2) }, "bridge");
  take(mid, 9);
}
{
  const pts = roadLines.post_road, end = pts.at(-1), dir = norm([pts.at(-1)[0] - pts.at(-3)[0], pts.at(-1)[1] - pts.at(-3)[1]]);
  obj("barrier", [end[0] - dir[0] * 1.5, end[1] - dir[1] * 1.5], { ry: r2(ry_facing(dir[0], dir[1]) + Math.PI) }, "barrier");
  obj("old_bridge", [end[0] + dir[0] * 9, 239], { ry: r2(ry_facing(0, 1)) }, "old_bridge");
  take(end, 14);
  // a view point: the old bridge's far pier and the lake side
  obj("spot", [end[0] - dir[0] * 6, end[1] - dir[1] * 6], {}, "bridge_out_view");
}

// ---- signposts: at each junction, an arm for each road pointing along it ------------------------------------------------------------
SIGNS.forEach((s, i) => {
  obj("signpost", s.at, { arms: s.arms.map((a) => ({ text: a.text, ry: r2(ry_facing(a.toward[0] - s.at[0], a.toward[1] - s.at[1]) - Math.PI / 2) })) }, `sign_${i + 1}`);
  take(s.at, 2);
});

// ---- by the roads: the picnic spot, the overlook, an old wall in the wood --------------------------------------------------------------
const pic = PADS.find((p) => p.id === "picnic").at;
obj("picnic_table", pic, { ry: r2(ry_facing(1, 0.2)) }, "picnic");
obj("bench", [pic[0] + 4, pic[1] - 2], { ry: r2(ry_facing(1, -0.3)) });
take(pic, 10);
const ov = PADS.find((p) => p.id === "overlook").at;
obj("bench", ov, { ry: r2(ry_facing(1, -0.2)) }, "overlook");
take(ov, 8);
for (let i = 0; i < 6; i++) { const at = [-46 + i * 3.6, 66 + i * 1.2]; if (i !== 3) obj("stone_wall", at, { ry: r2(ry_facing(1, 0.33) + Math.PI / 2) }); take(at, 2); }
obj("log", [-40, 70], { ry: 1.1 }); obj("stump", [-38, 61]);

// ---- the forest -------------------------------------------------------------------------------------------------------------------------
const R = rng(11);
const roadsAll = Object.values(roadLines);
const B = BOUNDS_EN;
const placeCentres = [po.building, hz.building, pp.building, pic, ov, PLACES.post_office.parking];
const groves = (e, n) => 0.5 + 0.28 * Math.sin(e * 0.031 + 1.3) * Math.sin(n * 0.027 - 0.4) + 0.22 * Math.sin(e * 0.071 - n * 0.053 + 2.1);
let trees = 0, rocks = 0;
for (let n = B.n0 + 3; n < B.n1; n += 7) for (let e = B.e0 + 3; e < B.e1; e += 7) {
  const p = [e + (R() - 0.5) * 6, n + (R() - 0.5) * 6];
  if (p[1] > 232 && (p[1] < 266 || p[1] > 288)) continue; // the gorge and the lake; the far bank between them is wooded
  const dRoad = Math.min(...roadsAll.map((l) => distTo(l, p)));
  const dWater = distTo(creekLine, p);
  const dPlace = Math.min(...placeCentres.map((c) => Math.hypot(c[0] - p[0], c[1] - p[1])));
  const edge = Math.min(p[0] - B.e0, B.e1 - p[0], p[1] - B.n0, 232 - p[1]);
  if (dRoad < 7 || dWater < 4.5 || dPlace < 20 || !free(p, 2.5)) {
    if (dRoad > 4.5 && dRoad < 9 && dWater > 4 && free(p, 2) && R() < 0.06) { obj(R() < 0.5 ? "rock" : "rock_small", p, { ry: r2(R() * 6.28), sx: r2(0.7 + R() * 0.6) }); rocks++; }
    continue;
  }
  let density = 0.62 * groves(...p);
  if (dRoad < 16) density *= 0.55; // the verges are open; a few trees frame the road
  if (edge < 70) density = Math.max(density, 0.95 - edge / 140); // thick wood at the map's edges
  if (dPlace < 34) density *= 0.35; // the houses' clearings
  if (dWater < 14) density *= 0.6;
  // the picnic spot looks east over the creek valley: keep that view open
  if (p[0] > pic[0] && p[0] < pic[0] + 70 && Math.abs(p[1] - pic[1]) < 26) density *= 0.15;
  // the inside of Fern Lane's bend is thick, so the cabin shows only once you are round it
  if (Math.hypot(p[0] + 128, p[1] + 2) < 26) density = Math.max(density, 0.85);
  if (R() > density) continue;
  const near = dRoad < 40 || dPlace < 60;
  const k = R();
  const kind = k < 0.36 ? "larch" : k < 0.5 ? "larch_small" : k < 0.67 ? "pine" : k < 0.84 ? "pine2" : k < 0.97 ? "pine3" : "birch";
  const size = kind.startsWith("pine") ? 1.7 + R() * 1.1 : kind === "birch" ? 1.1 + R() * 0.4 : 0.85 + R() * 0.45;
  if (dRoad < 6.5 + size * (kind.startsWith("pine") ? 1.6 : 1.2)) continue; // (no crown over the road: the chase camera passes through it)
  obj(kind, p, { ry: r2(R() * 6.28), sx: r2(size) });
  trees++;
  if (near && R() < 0.12) { obj(R() < 0.5 ? "bush" : "bush2", [p[0] + 2.5, p[1] - 1.5], { sx: r2(0.8 + R() * 0.5) }); }
}
// mossy rocks and ferns' stones along Fern Lane, a few logs in the wood
{
  const pts = roadLines.fern_lane, L = lengthOf(pts);
  for (let d = 15; d < L - 10; d += 9) {
    const { p, dir } = along(pts, d), side = R() < 0.5 ? 1 : -1, right = [dir[1], -dir[0]];
    const off = 4.3 + R() * 4;
    const at = [p[0] + right[0] * off * side, p[1] + right[1] * off * side];
    if (free(at, 2)) { obj(R() < 0.3 ? "rock_big" : "rock", at, { ry: r2(R() * 6.28), sx: r2(0.6 + R() * 0.5) }); rocks++; }
  }
}
for (let i = 0; i < 14; i++) {
  const p = [B.e0 + 40 + R() * (B.e1 - B.e0 - 80), B.n0 + 40 + R() * 260];
  if (Math.min(...roadsAll.map((l) => distTo(l, p))) > 12 && distTo(creekLine, p) > 6 && free(p, 3)) obj(R() < 0.5 ? "log" : "stump", p, { ry: r2(R() * 6.28) });
}
// rocks in the creek's banks
for (let d = 20; d < lengthOf(creekLine) - 30; d += 13) {
  const { p, dir } = along(creekLine, d), side = R() < 0.5 ? 1 : -1;
  const at = [p[0] + dir[1] * side * 3.4, p[1] - dir[0] * side * 3.4];
  if (free(at, 3) && distTo(roadsAll[2], at) > 8) { obj(R() < 0.4 ? "rock_big" : "rock", at, { ry: r2(R() * 6.28), sx: r2(0.5 + R() * 0.5) }); rocks++; }
}
// the plants on the ground: a rule (lib/groundcover.lua plants it), so the scene file says how much of what, and where
obj("groundcover", [0, 0], {
  plants: [
    { model: "fern", count: 1400, near: "fern_lane", within: 22, tints: [[255, 255, 255], [230, 245, 220]] },
    { model: "fern_big", count: 500, near: "fern_lane", within: 18 },
    { model: "fern_light", count: 900, near: "any", within: 30 },
    { model: "fern", count: 700, near: "creek", within: 14 },
    { model: "grass", count: 2600, near: "any", within: 16, tints: [[255, 255, 255], [240, 250, 215], [225, 240, 205]] },
    { model: "flowers", count: 260, near: "any", within: 12 },
  ],
  seed: 5,
}, "groundcover");
// the far mountains: a ring of blue ranges beyond the map, highest to the north (the lake side) and the east
const ring = [[0, 900, 2.6], [-420, 820, 2.2], [380, 860, 2.4], [-820, 420, 2.0], [800, 300, 2.3], [-760, -300, 1.8], [700, -500, 2.0], [0, -900, 1.7], [-300, -820, 1.6], [420, -760, 1.8], [-600, 700, 2.1], [650, 650, 2.0]];
ring.forEach(([e, n, s], i) => obj("far_mountain", [e, n], { ry: r2(i * 1.7), sx: s }));

console.log(`valley: ${objects.length} objects, ${trees} trees, ${rocks} rocks`);
tool("scene_write", { name: "valley", scene: { version: 1, background: [196, 222, 236], camera: { eye: [10, 30, -200], target: [20, 15, -170], fov: 60 }, objects } }, { quiet: true });

// ---- the office: one room, the shelf of today's post, the door out ------------------------------------------------------------------
const office = [
  { kind: "office_room", name: "room", x: 0, y: 0, z: 0 },
  { kind: "postmaster", name: "postmaster", x: 0.3, y: 0, z: 0.55, props: { ry: 3.14 } },
  { kind: "item", name: "letter", x: 1.0, y: 0.81, z: -0.45, props: { item: "letter", ry: 0.25 } },
  { kind: "item", name: "parcel_hazel", x: 3.25, y: 0.45, z: 1.25, props: { item: "hazel", ry: 1.57 } },
  { kind: "item", name: "parcel_pip", x: 3.25, y: 0.45, z: 0.55, props: { item: "pip", ry: 1.57 } },
  { kind: "spot", name: "office_exit", x: 0.9, y: 0, z: 2.55 },
  { kind: "spot", name: "counter_spot", x: 0.4, y: 0, z: 0.1 },
];
tool("scene_write", { name: "office", scene: { version: 1, background: [40, 34, 30], camera: { eye: [0, 2.2, 2.2], target: [0, 1, 0], fov: 60 }, objects: office } }, { quiet: true });

// ---- the static props' entity files: scenery that never moves; trees have a far model and sway; the rest block with their own shapes ---
// Trees, bushes and tall things stand upright on the hills (`lift = "upright"`: the foot follows the slope, the crown stays level;
// lifted vertex by vertex, a cone on a hillside leans with the ground: the owner's play notes of 2026-11-22).
const UP = ', lift = "upright"';
const statics = {
  post_office: "", cabin_hazel: "", cabin_pip: "", workshop: "", sawhorse: "", planks: "", woodpile: "", fence: "", stone_wall: "", gate_post: "",
  picnic_table: "", bench: "", old_bridge: "", barrier: "", office_room: "", mast: UP,
  pine: ', lod = "pine_far", lod_distance = 110, sway = 0.012' + UP, pine2: ', lod = "pine_far", lod_distance = 110, sway = 0.012' + UP, pine3: ', lod = "pine_far", lod_distance = 110, sway = 0.012' + UP,
  larch: ', lod = "larch_far", lod_distance = 110, sway = 0.016' + UP, larch_small: ', lod = "larch_far", lod_distance = 110, sway = 0.018' + UP, birch: ", sway = 0.02" + UP,
  rock: "", rock_big: "", rock_small: "", bush: ", sway = 0.02" + UP, bush2: ", sway = 0.02" + UP, flowers: ", sway = 0.3", log: "", stump: UP,
};
for (const [kind, extra] of Object.entries(statics)) put(`entities/${kind}.lua`, `-- Scenery (tools/scene.mjs writes this file): drawn near the camera, never moves.\nreturn nova.entity { model = "${kind}", static = true${extra} }\n`);
put("entities/far_mountain.lua", `-- A far blue range (tools/scene.mjs): scenery drawn out to the horizon, never moves.\nreturn nova.entity { model = "mountain", static = true, max_distance = 2000 }\n`);
