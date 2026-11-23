// Writes tools/routes/signs.json: a route that pictures every signpost from each road that comes to it, from the driving camera at the
// distances asked (the van is placed, the camera's distance to the post measured and corrected), and each board from both of its faces
// close to (1280x720), for judging the signs by eye. scripts/env.sh node examples/mountain-post/tools/routes/signs.mjs [out] [distances]
// then scripts/nova-tool --project examples/mountain-post play @examples/mountain-post/tools/routes/signs.json
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = process.argv[2] ?? "build/gallery/signs";
const DISTANCES = (process.argv[3] ?? "12,25,40").split(",").map(Number);
// post, the road driven on and which way along it (1: the camera behind the post's nearest point on lower stations, heading up the road;
// -1: the other way), and what to call it
const APPROACHES = [
  ["sign_1", "post_road", 1, "Fern Lane post from the south on Post Road"],
  ["sign_1", "post_road", -1, "Fern Lane post from the north on Post Road"],
  ["sign_1", "fern_lane", -1, "Fern Lane post from Fern Lane"],
  ["sign_2", "post_road", 1, "Kettle Creek post from the south on Post Road"],
  ["sign_2", "post_road", -1, "Kettle Creek post from the north on Post Road"],
  ["sign_2", "kettle_creek_road", -1, "Kettle Creek post from Kettle Creek Road"],
];
const lua = "CAM = require('lib.camera'); W = require('lib.world'); ART = require('lib.sign_art'); IN_VAN = function(x, z, h) local v = nova.named('van'); v.autopilot = nil; v:teleport(x, z, h); local sc = nova.scene_now(); sc.mode = 'van'; v.driven = true; v.engine_on = true; nova.named('postmaster').seated = true; CAM.pinned = nil; CAM.reset(h) end; ROAD = function(key) for _, r in ipairs(W.roads) do if r.id == key then return r.points end end end; PLACE = function() local s, pts, dir = A.sign, ROAD(A.key), A.dir; local bi, bd = 1, math.huge; for i, p in ipairs(pts) do local d = (p[1] - s.x) ^ 2 + (p[2] - s.z) ^ 2; if d < bd then bi, bd = i, d end end; local i, acc = bi, 0; while pts[i - dir] do local a, b = pts[i], pts[i - dir]; local l = math.sqrt((a[1] - b[1]) ^ 2 + (a[2] - b[2]) ^ 2); if acc + l >= A.d then local t = (A.d - acc) / l; local x, z = a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t; IN_VAN(x, z, math.atan(a[1] - b[1], a[2] - b[2])); return end; acc = acc + l; i = i - dir end end; APPROACH = function(sign, key, dir, target) A = { sign = nova.named(sign), key = key, dir = dir, target = target, d = math.max(0, target - 9.5) }; PLACE() end; DIST = function() local e, s = CAM.state.eye, A.sign; local g = nova.terrain_height(s.x, s.z); return math.sqrt((e[1] - s.x) ^ 2 + (e[2] - g - 2.6) ^ 2 + (e[3] - s.z) ^ 2) end; REFINE = function() local m = DIST(); A.d = math.max(0, A.d + A.target - m); PLACE() end; MEASURE = function(label) nova.log(string.format('%s: the camera %.1f m from the signpost (asked %d)', label, DIST(), A.target)) end; FACE = function(sign, i, side, dist) local s = nova.named(sign); local a, d = s.arms[i], s.drawn[i]; local ax, az, nx, nz = math.cos(a.ry), -math.sin(a.ry), math.sin(a.ry), math.cos(a.ry); local mid = ART[d.sprite].mid; local cx, cz = s.x + ax * mid, s.z + az * mid; local g = nova.terrain_height(s.x, s.z); local y = g + d.y; CAM.pinned = { cx + side * nx * dist, y + 0.15, cz + side * nz * dist, cx, y, cz, 38 } end";
const route = [{ wait: 20 }];
for (const [sign, road, dir, name] of APPROACHES) {
  for (const d of DISTANCES) {
    route.push({ lua: `APPROACH('${sign}', '${road}', ${dir}, ${d})` });
    for (let k = 0; k < 3; k++) route.push({ wait: 30, lua: "REFINE()" });
    route.push({ wait: 40, lua: `MEASURE('${name}')`, capture: `${name}, ${d} m` });
  }
}
// both faces of each board, from 5 m, level with it: side +1 is the face the arm's turn gives (its normal), -1 the back
for (const sign of ["sign_1", "sign_2"]) {
  for (let i = 1; i <= 3; i++) {
    for (const [side, face] of [[1, "front"], [-1, "back"]]) {
      route.push({ lua: `IN_VAN(300, 300, 0); FACE('${sign}', ${i}, ${side}, 5)` }, { wait: 4, capture: `${sign} board ${i} ${face}` });
    }
  }
}
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), "signs.json"), JSON.stringify({ size: "1280x720", start_scene: "valley", lua, route, out }, null, 1) + "\n");
