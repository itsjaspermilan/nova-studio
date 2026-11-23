// Writes tools/routes/roads.json: a route that pictures every junction, road end and surface change in the valley from above and from
// a driving camera (1280x720), for judging the road builder by eye. scripts/env.sh node examples/mountain-post/tools/routes/roads.mjs [out]
// then scripts/nova-tool --project examples/mountain-post play @examples/mountain-post/tools/routes/roads.json
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = process.argv[2] ?? "build/gallery/roads";
// name, x, z (Nova's ground), metres across from above, and where a driver comes from (x, z) on the main road and on the side road
const VIEWS = [
  ["fern_lane_junction", 9, -66, 34, [6, -110], [40, -78]],
  ["kettle_creek_junction", -10, 24, 34, [2, -18], [-44, 26]],
  ["bridge_west", -96, 53, 30, [-74, 40], null],
  ["bridge_east", -114, 57.5, 30, [-140, 66], null],
  ["bridge_out_end", 20, 226, 30, [20, 190], null],
  ["post_office", 5, -200, 60, [-4, -160], null],
  ["post_road_start", -8, -240, 30, [-4, -205], null],
  ["hazel_end", 148, 40, 40, [134, 18], null],
  ["pip_end", -176, 102, 40, [-162, 84], null],
];
const route = [{ wait: 30, lua: "nova.named('van'):teleport(300, 300, 0)" }];
for (const [n, x, z, w, a, b] of VIEWS) {
  const H = w / 2 / Math.tan((20 * Math.PI) / 180);
  route.push({ lua: `local h = nova.terrain_height(${x}, ${z}); CAM.pinned = { ${x}, h + ${H.toFixed(1)}, ${z} - 0.5, ${x}, h, ${z}, 40 }` }, { wait: 3, capture: `${n} from above` });
  for (const [k, p] of [["main", a], ["side", b]]) {
    if (!p) continue;
    const dx = x - p[0], dz = z - p[1], l = Math.hypot(dx, dz), ux = dx / l, uz = dz / l;
    const ex = x - ux * 20, ez = z - uz * 20;
    route.push({ lua: `local h = nova.terrain_height(${ex}, ${ez}); local t = nova.terrain_height(${x}, ${z}); CAM.pinned = { ${ex}, h + 3.4, ${ez}, ${x + ux * 4}, t + 0.6, ${z + uz * 4}, 52 }` }, { wait: 3, capture: `${n} driving ${k}` });
  }
}
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), "roads.json"), JSON.stringify({ size: "1280x720", start_scene: "valley", lua: "CAM = require('lib.camera')", route, out }, null, 1) + "\n");
