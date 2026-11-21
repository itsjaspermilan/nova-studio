// Makes every course's road again from its track file (tracks/<name>.track.json -> models/road_<name>.glb) with Nova's `road_make`, without
// touching the scenes: what the studio's track editor and `track_write` write for the road. Run it after changing the ribbon in
// scripts/lib/trackgen.mjs; `--textured` first turns the road pictures on in every track file ("textured": true).
//
//   scripts/env.sh node scripts/rally/roads.mjs [--textured] [--project folder]
import { withServer } from "./mcp.mjs";

await withServer(async (nova) => {
  console.log(await nova.call("road_make", { tracks: "all", preview: false, ...(process.argv.includes("--textured") ? { textured: true } : {}) }));
});
