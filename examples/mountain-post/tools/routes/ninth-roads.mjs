// Writes ninth-roads.json, the pictures of the owner's ninth notes 4 and 7 (all roads gravel, the driveways by the homes): Post Road,
// a junction, a lane and each driveway from the driving camera (the van driven, the game's own camera) and the walking camera (the
// postmaster on foot), the post office's yard from above and from its porch.
//   scripts/env.sh node examples/mountain-post/tools/routes/ninth-roads.mjs [out]
// then, in examples/mountain-post: ../../target/release/nova run . --headless --size 1280x720 --play tools/routes/ninth-roads.json
import { writeFileSync } from "node:fs";

const out = process.argv[2] || "build/gallery/ninth-roads";
// (Nova's ground: x = -E, z = N; a heading turns from +z toward +x)
// name, where the van or the walker stands (x, z), and a point it looks toward (x, z)
const VIEWS = [
  ["post-road", [6, -128], [8, -100]],
  ["fern-junction", [4.5, -96], [9, -66]],
  ["fern-lane", [72, -72], [100, -54]],
  // the drives: from where each is turned into, toward the yard (lib/world.lua's drives, by their order in the scene)
  ["po-drive", "drive1", 0],
  ["hazel-drive", "drive2", 0],
  ["pip-drive", "drive3", 0],
];
const lua = [
  "CAM = require('lib.camera'); W = require('lib.world')",
  // the van driven at (x, z) facing (tx, tz), the game's driving camera behind it
  "IN_VAN = function(x, z, tx, tz) local h = math.atan(tx - x, tz - z); local v = nova.named('van'); v:teleport(x, z, h); local s = nova.scene_now(); s.mode = 'van'; v.driven = true; v.engine_on = true; nova.named('postmaster').seated = true; CAM.pinned = nil; CAM.reset(h) end",
  // the postmaster on foot at (x, z) facing (tx, tz), the van parked out of the way, the game's walking camera behind
  "ON_FOOT = function(x, z, tx, tz) local h = math.atan(tx - x, tz - z); local s = nova.scene_now(); s.mode = 'foot'; local v = nova.named('van'); v.driven = false; v.engine_on = false; v:teleport(300, 300, 0); local p = nova.named('postmaster'); p.seated = false; p.x, p.z, p.face = x, z, h; CAM.pinned = nil; CAM.reset(h) end",
  // a drive's approach: 22 m back from its yard along the lane it carries on (20 m down Post Road for the post office's), looking at the yard
  "DRIVE = function(k) local d = W.drives[k]; local pts = d.points; local y = d.yard; local ax, az = pts[1][1], pts[1][2]; local dx, dz = ax - y.x, az - y.z; local l = math.sqrt(dx * dx + dz * dz); local back = math.max(0, 22 - l); local r, _, _, _, tx, tz = W.nearest('road', ax, az); local sx, sz = dx / l, dz / l; if r and r.id ~= 'post_road' then local e = r.points[#r.points]; local p = r.points[math.max(1, #r.points - 4)]; local ex, ez = p[1] - e[1], p[2] - e[2]; local el = math.sqrt(ex * ex + ez * ez); sx, sz = ex / el, ez / el else return ax - 0.7, az - 20, y.x, y.z end; return ax + sx * back, az + sz * back, y.x, y.z end",
];
const route = [{ wait: 40, lua: "nova.named('van'):teleport(300, 300, 0)" }];
for (const [name, a, b] of VIEWS) {
  const where = typeof a === "string" ? `local x, z, tx, tz = DRIVE(${a.slice(5)})` : `local x, z, tx, tz = ${a[0]}, ${a[1]}, ${b[0]}, ${b[1]}`;
  route.push({ lua: `${where}; IN_VAN(x, z, tx, tz)` }, { wait: 50, capture: `${name} driving` });
  route.push({ lua: `${where}; ON_FOOT(x + (tx - x) * 0.45, z + (tz - z) * 0.45, tx, tz)` }, { wait: 50, capture: `${name} walking` });
}
// the post office's yard: from above, and from the porch's steps looking out at the van in its spot
route.push(
  { lua: "local s = nova.scene_now(); s.mode = 'foot'; local p = nova.named('postmaster'); p.seated = false; p.x, p.z = 40, -150; local d = W.drives[1]; local a = d.points[1]; local v = nova.named('van'); v.driven = false; v:teleport(d.yard.x - 0.2, d.yard.z, math.atan(a[1] - d.yard.x, a[2] - d.yard.z) + math.pi)" },
  { lua: "local d = W.drives[1]; local y = d.yard; local h = nova.terrain_height(y.x + 8, y.z); CAM.pinned = { y.x + 8, h + 34, y.z - 0.5, y.x + 8, h, y.z, 45 }" },
  { wait: 30, capture: "post-office yard from above" },
  { lua: "local h = nova.terrain_height(12, -179); CAM.pinned = { 0.5, h + 3.4, -168, 15, h + 0.6, -183, 55 }" },
  { wait: 6, capture: "post-office yard from Post Road" },
);
writeFileSync(new URL("./ninth-roads.json", import.meta.url), JSON.stringify({ start_scene: "valley", lua: lua.join("; "), route, out }, null, 1) + "\n");
