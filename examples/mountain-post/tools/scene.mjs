// The valley's scene file (scenes/valley.scene.json) composed from layout.mjs: the houses and everything at them, the signposts and
// mailboxes, the bridge, the barrier, the roads' and the water's lines (for the map, the minimap and the limits), and the forest,
// planted by rules that keep sight lines open (a clear verge along each road, clearings round the houses, the picnic spot's view,
// the bend on Fern Lane that hides Hazel's cabin until you are round it) and close the map's edges with thick wood.
// Also the office's scene (scenes/office.scene.json) and the one-line entity files of the static props.
import { centreline } from "../../../scripts/lib/trackgen.mjs";
import { BOUNDS_EN, BRIDGE, CREEK, DECK_ENDS, GORGE, LAKE, PADS, PLACES, ROADS, SIGNS, ry_facing, xz } from "./layout.mjs";
import { rng } from "./geo.mjs";
import { put, tool } from "./lib.mjs";
import { placedFootprint } from "./footprint.mjs";
import { roads } from "./roads.mjs";

// ---- nothing stands on a road ------------------------------------------------------------------------------------------------------
// The road surface is the network road_make builds (tools/roads.mjs: its real outline, junction patches, fillets, aprons and rounded
// ends included). Every placed thing keeps its ground footprint (tools/footprint.mjs, from its model) clear of it: a signpost 0.8 m or
// more off the edge (it is put about a metre off, in the grass of its corner), a mailbox 0.6 m, everything else 0.4 m. Things placed
// one by one are moved off the road until they are clear; scattered ones (trees, rocks, bushes) are simply not put there. Only the
// BRIDGE OUT barrier stands across its road's end, as it must (the bridge's deck carries the road, the ribbon stops at it).
const CLEAR = { signpost: 0.8, mailbox: 0.6 };
const ON_ROAD_ALLOWED = new Set(["barrier"]); // (by name)
const clearOf = (kind, en, ry = 0, sx = 1) => {
  const pts = placedFootprint(kind, en, ry, sx);
  return Math.min(...(pts.length ? pts : [en]).map((p) => roads().clearance(p)));
};
/// A thing placed one by one, moved off the road (the way off it) until its footprint is `want` metres clear.
const placeOff = (kind, en, ry = 0, sx = 1, want = CLEAR[kind] ?? 0.4) => {
  let p = [...en];
  for (let k = 0; k < 60; k++) {
    const c = clearOf(kind, p, ry, sx);
    if (c >= want - 0.005) return p;
    const d = roads().away(p), step = Math.max(0.03, Math.min(1, want - c));
    p = [p[0] + d[0] * step, p[1] + d[1] * step];
  }
  throw new Error(`a ${kind} at ${en} could not be put clear of the road`);
};
// (the signposts in their corners, a metre off the edge: layout.mjs says which corner, this says exactly where)
const SIGNS_AT = SIGNS.map((s) => ({ ...s, at: placeOff("signpost", s.at, 0, 1, 1.0).map((v) => Math.round(v * 100) / 100) }));

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
obj("valley_ground", [0, 0], { roads: ["road_valley"] }, "ground");
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
obj("mailbox", placeOff("mailbox", hz.mailbox, ry_facing(0.5, -1)), { ry: r2(ry_facing(0.5, -1)), number: 3 }, "mailbox_3");
for (const s of [-1.2, 1.2]) obj("gate_post", placeOff("gate_post", [hz.gate[0] + s * 2.9 * 0.66, hz.gate[1] + s * 2.9 * 0.75]));
obj("flowers", [hz.building[0] + 4, hz.building[1] - 4.5]);
obj("bush", [hz.building[0] - 5, hz.building[1] - 3]);
// the low stone wall on the left of Fern Lane, going up, along its last stretch: right at the edge, where everyone clips it
{
  const pts = roadLines.fern_lane, L = lengthOf(pts);
  for (let d = L - 92; d < L - 10; d += 4.05) {
    const { p, dir } = along(pts, d);
    const left = [-dir[1], dir[0]];
    const off = 2.3 + 1.0, ry = ry_facing(dir[0], dir[1]) + Math.PI / 2;
    const w = placeOff("stone_wall", [p[0] + left[0] * off, p[1] + left[1] * off], ry);
    obj("stone_wall", w, { ry: r2(ry) });
    take(w, 2);
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
obj("mailbox", placeOff("mailbox", pp.mailbox, ry_facing(-1, -0.4)), { ry: r2(ry_facing(-1, -0.4)), number: 7 }, "mailbox_7");
for (const s of [-1.2, 1.2]) obj("gate_post", placeOff("gate_post", [pp.gate[0] + s * 2.9 * 0.78, pp.gate[1] - s * 2.9 * 0.62]));
for (let i = 0; i < 5; i++) obj("fence", [pp.gate[0] + 5.5 + i * 2.6 * 0.78, pp.gate[1] - 4.5 - i * 2.6 * 0.62 + 0.0], { ry: r2(ry_facing(0.78, -0.62) + Math.PI / 2) });
obj("flowers", [pp.building[0] - 4, pp.building[1] - 3.6]); obj("flowers", [pp.building[0] + 3.5, pp.building[1] - 4.2]);
obj("bush2", [pp.building[0] + 5, pp.building[1] + 1]);
obj("woodpile", [pp.building[0] - 4.5, pp.building[1] + 2.5], { ry: r2(ry_facing(...pp.face)) });

// ---- the bridge over Kettle Creek, the barrier at the gorge and what is left of the lake bridge ---------------------------------------
{
  const mid = [(BRIDGE.a[0] + BRIDGE.b[0]) / 2, (BRIDGE.a[1] + BRIDGE.b[1]) / 2], d = norm([BRIDGE.b[0] - BRIDGE.a[0], BRIDGE.b[1] - BRIDGE.a[1]]);
  // (its ends `a`, `b` are where its deck ends and the road stops: the deck is level with the road there)
  obj("bridge", mid, { ry: r2(ry_facing(d[0], d[1])), a: xz(DECK_ENDS.a).map(r2), b: xz(DECK_ENDS.b).map(r2) }, "bridge");
  take(mid, 9);
}
// The view from the BRIDGE OUT barrier across the gorge to what is left of the bridge's far half (the owner's sixth play: distant forest
// partly hid it): from the barrier to the far ruin, a corridor 5 m either side at the barrier widening to 16 m at the far ruin, and a
// little way past it, in which no forest mass stands (every mass kept out by its own size: tests/mountain_post.rs).
let BRIDGE_VIEW = null;
{
  const pts = roadLines.post_road, end = pts.at(-1), dir = norm([pts.at(-1)[0] - pts.at(-3)[0], pts.at(-1)[1] - pts.at(-3)[1]]);
  obj("barrier", [end[0] - dir[0] * 1.5, end[1] - dir[1] * 1.5], { ry: r2(ry_facing(dir[0], dir[1]) + Math.PI) }, "barrier");
  // what is left of the lake bridge: its near half on the rim just past the road's end (5 m on: its pier starts a metre past the
  // origin, kept clear of the road), its far half on the far rim (z 271), both facing across the gorge
  // (on along the road's line, half a metre at a time, until its footprint is clear of the road's rounded end)
  let ruin = [...end];
  while (clearOf("old_bridge", ruin, ry_facing(0, 1)) < 0.4) ruin = [ruin[0] + dir[0] * 0.5, ruin[1] + dir[1] * 0.5];
  obj("old_bridge", ruin, { ry: r2(ry_facing(0, 1)) }, "old_bridge");
  obj("old_bridge_far", [ruin[0], 271], { ry: r2(ry_facing(0, 1)) }, "old_bridge_far");
  BRIDGE_VIEW = { from: [end[0] - dir[0] * 1.5, end[1] - dir[1] * 1.5], to: [ruin[0], 271] };
  take(end, 14);
  // a view point: the old bridge's far pier and the lake side
  obj("spot", [end[0] - dir[0] * 6, end[1] - dir[1] * 6], {}, "bridge_out_view");
}

// (an arm's turn about its post: pointing along its road, then swung off it by `turn` degrees: layout.mjs SIGNS; and the way it points on the map)
const armRy = (s, a) => ry_facing(a.toward[0] - s.at[0], a.toward[1] - s.at[1]) - Math.PI / 2 + ((a.turn ?? 0) * Math.PI) / 180;
const armDir = (s, a) => [-Math.cos(r2(armRy(s, a))), -Math.sin(r2(armRy(s, a)))];
// ---- signposts: at each junction, an arm for each road pointing along it ------------------------------------------------------------
SIGNS_AT.forEach((s, i) => {
  obj("signpost", s.at, { arms: s.arms.map((a) => ({ text: a.text, ry: r2(armRy(s, a)) })) }, `sign_${i + 1}`);
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

// ---- the trees ----------------------------------------------------------------------------------------------------------------------------
// A toy diorama's planting, not a forest of thousands (the owner, 2026-11-22: "Can we cut the trees a bit? Or do it in a different
// way?"): near the roads and the houses, deliberate clumps of three to seven chunky trees with open grass between them; one big
// "hero" tree at each junction's signpost and at each gate, landmarks to learn the roads by; and where nobody goes (the valley's sides,
// beyond the creek, the far bank, the map's edges) no single trees at all but a few dozen soft forest masses (tools/nature.mjs).
// The sight lines stay: no crown over a road, the picnic spot's view east kept open, the inside of Fern Lane's bend thick so Hazel's
// cabin shows only once you are round it.
const R = rng(11);
const roadsAll = Object.values(roadLines);
const B = BOUNDS_EN;
const placeCentres = [po.building, hz.building, pp.building, pic, ov, PLACES.post_office.parking];
const dRoadOf = (p) => Math.min(...roadsAll.map((l) => distTo(l, p)));
const dPlaceOf = (p) => Math.min(...placeCentres.map((c) => Math.hypot(c[0] - p[0], c[1] - p[1])));
const inGorge = (p) => p[1] > 232 && (p[1] < 266 || p[1] > 288);
const picnicView = (p) => p[0] > pic[0] && p[0] < pic[0] + 70 && Math.abs(p[1] - pic[1]) < 26;
const SPECIES = ["larch", "larch", "larch_small", "pine", "pine2", "pine3", "pine", "birch"];
let trees = 0, rocks = 0, masses = 0;
// The signposts' sight lines (the owner's fifth play: at 60 m a tree hid the Fern Lane board from Post Road). The rule: from every
// road that comes to a signpost, along its last 70 m (both ways along the road), the line from the chase camera's place over the
// road to each of the sign's boards is clear of every tree's crown. SIGHT holds those lines (in metres east and north), from 8 m out.
const SIGHT = [];
{
  const ARM_MID = 1.75; // (the middle of a board along its arm: entities/signpost.lua)
  for (const s of SIGNS_AT) {
    const boards = [s.at, ...s.arms.map((a) => { const d = armDir(s, a); return [s.at[0] + d[0] * ARM_MID, s.at[1] + d[1] * ARM_MID]; })];
    for (const pts of Object.values(roadLines)) {
      // (the point of the road nearest the sign, then out along it either way)
      let best = 0, bd = Infinity;
      pts.forEach((p, i) => { const d = Math.hypot(p[0] - s.at[0], p[1] - s.at[1]); if (d < bd) (bd = d, (best = i)); });
      if (bd > 30) continue;
      for (const dir of [1, -1]) {
        let acc = 0;
        for (let i = best; pts[i + dir] && acc < 70; i += dir) {
          acc += Math.hypot(pts[i + dir][0] - pts[i][0], pts[i + dir][1] - pts[i][1]);
          // (the chase camera stands about 9.5 m behind the van, over the road)
          if (acc >= 8) for (const b of boards) SIGHT.push([pts[i + dir], b]);
        }
      }
    }
  }
}
const segDist = ([a, b], p) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
};
// (each kind's crown radius at its own size, from its model: metres at sx 1)
const CROWN = { pine: 1.49, pine2: 1.61, pine3: 1.47, larch: 2.58, larch_small: 1.75, birch: 2.29 };
const crownOf = (kind, size) => (CROWN[kind] ?? 2) * size * 1.05 + 0.3; // (with a margin: a crown just grazing the line still hides an edge)
// (a crown of radius r there would cut a sight line; the last metre at the sign, the post's own, does not count)
const hidesSign = (p, r) => SIGHT.some((l) => Math.hypot(p[0] - l[1][0], p[1] - l[1][1]) > 1 && segDist(l, p) < r);
// one tree, where it may stand: chunky (a little larger than before), never with its crown over a road, never in a signpost's sight line
const tree = (p, kind, grow = 1) => {
  if (inGorge(p) || distTo(creekLine, p) < 5 || !free(p, 2.2) || dPlaceOf(p) < 13) return false;
  const size = grow * (kind.startsWith("pine") ? 1.9 + R() * 1.0 : kind === "birch" ? 1.3 + R() * 0.4 : 1.0 + R() * 0.45);
  if (dRoadOf(p) < 6.5 + size * (kind.startsWith("pine") ? 1.6 : kind === "birch" ? 2.0 : 1.2)) return false;
  if (hidesSign(p, crownOf(kind, size))) return false;
  obj(kind, p, { ry: r2(R() * 6.28), sx: r2(size) });
  take(p, 2.2);
  trees++;
  return true;
};
// a clump: three to seven trees of one or two kinds round a middle, a bush at its edge now and then
const clump = (c, n, spread = 5) => {
  if (picnicView(c)) return;
  const a = SPECIES[Math.floor(R() * SPECIES.length)], b = SPECIES[Math.floor(R() * SPECIES.length)];
  let placed = 0;
  for (let i = 0; i < n * 3 && placed < n; i++) {
    const ang = R() * 6.28, d = i === 0 ? 0 : 2.6 + R() * spread;
    if (tree([c[0] + Math.sin(ang) * d, c[1] + Math.cos(ang) * d], R() < 0.7 ? a : b)) placed++;
  }
  if (placed && R() < 0.5) {
    const ang = R() * 6.28, p = [c[0] + Math.sin(ang) * (spread + 3), c[1] + Math.cos(ang) * (spread + 3)];
    if (free(p, 1.2) && dRoadOf(p) > 5) obj(R() < 0.5 ? "bush" : "bush2", p, { sx: r2(0.9 + R() * 0.5) });
  }
};
// clumps along each road, on either side, with stretches of open grass between them; a second, sparser row further out
for (const pts of roadsAll) {
  const L = lengthOf(pts);
  for (let d = 6 + R() * 8; d < L - 6; d += 11 + R() * 10) {
    if (R() < 0.15) continue; // (an open stretch)
    const { p, dir } = along(pts, d), side = R() < 0.5 ? 1 : -1, right = [dir[1], -dir[0]];
    const off = 12 + R() * 10;
    clump([p[0] + right[0] * off * side, p[1] + right[1] * off * side], 4 + Math.floor(R() * 5));
    if (R() < 0.8) {
      const off2 = 26 + R() * 16;
      clump([p[0] - right[0] * off2 * side, p[1] - right[1] * off2 * side], 4 + Math.floor(R() * 4), 6);
    }
  }
}
// round the houses: a few clumps behind and beside each, never in front of its door
for (const [c, face] of [[po.building, po.face], [hz.building, hz.face], [pp.building, pp.face]]) {
  const f = norm(face);
  for (let i = 0; i < 6; i++) {
    const ang = R() * 6.28, dir = [Math.sin(ang), Math.cos(ang)];
    if (dir[0] * f[0] + dir[1] * f[1] > 0.3) continue;
    const d = 20 + R() * 12;
    clump([c[0] + dir[0] * d, c[1] + dir[1] * d], 4 + Math.floor(R() * 4));
  }
}
// the inside of Fern Lane's bend: thick, so the cabin shows only once you are round it
for (let i = 0; i < 4; i++) clump([-128 + (R() - 0.5) * 22, -2 + (R() - 0.5) * 22], 7, 4);
// hero trees: one big tree beside each signpost and each gate, on the side away from the road
for (const at of [...SIGNS_AT.map((s) => s.at), hz.gate, pp.gate]) {
  for (let k = 0; k < 16; k++) {
    const ang = (k / 16) * 6.28, p = [at[0] + Math.sin(ang) * 9, at[1] + Math.cos(ang) * 9];
    if (dRoadOf(p) > 9 && tree(p, k % 2 ? "pine2" : "birch", 1.35)) break;
  }
}
// (a mass is a capsule along its own x, as nature.mjs makes it: length L, depth D; its puffs reach 0.6 D)
const MASS_SIZE = { forest_long: [42, 13], forest_tall: [28, 15], forest_round: [20, 16] };
const hidesBridge = (kind, p, ry, sx) => {
  const [L, D] = MASS_SIZE[kind], half = (L / 2 - D * 0.4) * sx, ax = [-Math.cos(ry), -Math.sin(ry)];
  const a = [p[0] - ax[0] * half, p[1] - ax[1] * half], b = [p[0] + ax[0] * half, p[1] + ax[1] * half];
  const { from, to } = BRIDGE_VIEW, len = Math.hypot(to[0] - from[0], to[1] - from[1]), d = [(to[0] - from[0]) / len, (to[1] - from[1]) / len];
  for (let m = 0; m <= len + 6; m += 2) {
    const q = [from[0] + d[0] * m, from[1] + d[1] * m], width = 5 + 11 * Math.min(1, m / len);
    if (segDist([a, b], q) < D * 0.6 * sx + width) return true;
  }
  return false;
};
// the forest masses where nobody goes: away from the roads and the houses, the far bank, the map's edges
for (let n = B.n0 + 20; n < B.n1 + 10; n += 46) for (let e = B.e0 + 10; e < B.e1; e += 48) {
  const p = [e + (R() - 0.5) * 22, n + (R() - 0.5) * 22];
  const farBank = p[1] > 268 && p[1] < 286;
  if (inGorge(p) && !farBank) continue;
  const dRoad = dRoadOf(p), dWater = distTo(creekLine, p), edge = Math.min(p[0] - B.e0, B.e1 - p[0], p[1] - B.n0);
  if (!farBank && (dRoad < 48 || dPlaceOf(p) < 60 || dWater < 16 || picnicView(p))) continue;
  if (!farBank && edge > 60 && R() < 0.35) continue; // (an open meadow here and there inside the valley)
  const kind = ["forest_long", "forest_tall", "forest_round"][Math.floor(R() * 3)];
  const ry = r2(R() * 6.28), sx = r2(1.0 + R() * 0.5);
  if (hidesBridge(kind, p, ry, sx)) continue; // (the bridge's far half stays in view from the barrier)
  obj(kind, p, { ry, sx });
  take(p, 14);
  masses++;
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

{
  const SCATTERED = new Set(["pine", "pine2", "pine3", "larch", "larch_small", "birch", "rock", "rock_big", "rock_small", "bush", "bush2", "log", "stump", "flowers"]);
  const UNPLACED = new Set(["valley_ground", "roadline", "water", "lake", "limits", "groundcover", "far_mountain", "spot", "van", "postmaster", "hazel", "pip", "deck", "bridge"]);
  let dropped = 0;
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (UNPLACED.has(o.kind) || ON_ROAD_ALLOWED.has(o.name)) continue;
    const en = [-o.x, o.z], c = clearOf(o.kind, en, o.props?.ry ?? 0, o.props?.sx ?? 1), want = CLEAR[o.kind] ?? 0.4;
    if (c >= want - 0.01) continue;
    if (SCATTERED.has(o.kind)) { objects.splice(i, 1); dropped++; continue; }
    throw new Error(`${o.name ?? o.kind} at ${o.x}, ${o.z} stands ${c.toFixed(2)} m from the road surface (it needs ${want} m)`);
  }
  if (dropped) console.log(`(${dropped} scattered things left off the roads)`);
}
console.log(`valley: ${objects.length} objects, ${trees} trees, ${masses} forest masses, ${rocks} rocks`);
tool("scene_write", { name: "valley", scene: { version: 1, background: [196, 222, 236], camera: { eye: [10, 30, -200], target: [20, 15, -170], fov: 60 }, objects } }, { quiet: true });

// ---- the office: one room, the shelf of today's post, the door out ------------------------------------------------------------------
const office = [
  { kind: "office_room", name: "room", x: 0, y: 0, z: 0 },
  { kind: "postmaster", name: "postmaster", x: 0.3, y: 0, z: 0.55, props: { ry: 3.14 } },
  { kind: "item", name: "letter", x: 1.0, y: 0.81, z: -0.45, props: { item: "letter", ry: 0.25 } },
  { kind: "item", name: "parcel_hazel", x: 3.25, y: 1.29, z: 1.25, props: { item: "hazel", ry: 1.57 } },
  { kind: "item", name: "parcel_pip", x: 3.25, y: 1.29, z: 0.55, props: { item: "pip", ry: 1.57 } },
  { kind: "spot", name: "office_exit", x: 0.9, y: 0, z: 2.55 },
  { kind: "spot", name: "counter_spot", x: 0.4, y: 0, z: 0.1 },
];
tool("scene_write", { name: "office", scene: { version: 1, background: [40, 34, 30], camera: { eye: [0, 2.2, 2.2], target: [0, 1, 0], fov: 60 }, objects: office } }, { quiet: true });

// ---- the static props' entity files: scenery that never moves; trees have a far model and sway; the rest block with their own shapes ---
// Trees, bushes and tall things stand upright on the hills (`lift = "upright"`: the foot follows the slope, the crown stays level;
// lifted vertex by vertex, a cone on a hillside leans with the ground: the owner's play notes of 2026-11-22).
const UP = ', lift = "upright"';
const RIGID = ', lift = "origin"'; // (drawn whole, lifted by the ground under its origin: a ruin standing on a rim)
const statics = {
  post_office: "", cabin_hazel: "", cabin_pip: "", workshop: "", sawhorse: "", planks: "", woodpile: "", fence: "", stone_wall: "", gate_post: "",
  picnic_table: "", bench: "", old_bridge: RIGID, old_bridge_far: RIGID, barrier: "", office_room: "", mast: UP,
  pine: ', lod = "pine_far", lod_distance = 110, sway = 0.012' + UP, pine2: ', lod = "pine_far", lod_distance = 110, sway = 0.012' + UP, pine3: ', lod = "pine_far", lod_distance = 110, sway = 0.012' + UP,
  larch: ', lod = "larch_far", lod_distance = 110, sway = 0.016' + UP, larch_small: ', lod = "larch_far", lod_distance = 110, sway = 0.018' + UP, birch: ", sway = 0.02" + UP,
  forest_long: ", max_distance = 1500", forest_tall: ", max_distance = 1500", forest_round: ", max_distance = 1500",
  rock: "", rock_big: "", rock_small: "", bush: ", sway = 0.02" + UP, bush2: ", sway = 0.02" + UP, flowers: ", sway = 0.3", log: "", stump: UP,
};
for (const [kind, extra] of Object.entries(statics)) put(`entities/${kind}.lua`, `-- Scenery (tools/scene.mjs writes this file): drawn near the camera, never moves.\nreturn nova.entity { model = "${kind}", static = true${extra} }\n`);
put("entities/far_mountain.lua", `-- A far blue range (tools/scene.mjs): scenery drawn out to the horizon, never moves.\nreturn nova.entity { model = "mountain", static = true, max_distance = 2000 }\n`);
