// Writes eighth.json, the pictures of the owner's eighth play (flowers close and at 10 m, a strip of frames while walking past the
// grass's edge, wind curls in open ground and on a hill): scripts/env.sh node examples/mountain-post/tools/routes/eighth.mjs [out]
// then, in examples/mountain-post: ../../target/release/nova run . --headless --size 1280x720 --play tools/routes/eighth.json
import { writeFileSync } from "node:fs";

const out = process.argv[2] || "build/eighth/after";
const walk = [];
for (let i = 0; i < 8; i++) walk.push({ hold: ["move_y=-1", "run"], frames: 20, capture: "walk " + (i + 1) });
const plan = {
  start_scene: "valley",
  lua: "CAM = require('lib.camera'); AT = function(ex, ey, ez, tx, ty, tz, fov) CAM.pinned = { ex, nova.terrain_height(ex, ez) + ey, ez, tx, nova.terrain_height(tx, tz) + ty, tz, fov or 50 } end; HILL = function() local bx, bz, bh = 0, 0, -1e9 for x = -200, 200, 8 do for z = -240, 240, 8 do local h = nova.terrain_height(x, z) if h > bh then bx, bz, bh = x, z, h end end end return bx, bz end",
  route: [
    { wait: 40, lua: "local p = nova.named('postmaster'); p.x, p.z, p.face = 14.5, -186, 3.3; AT(14.6, 1.25, -194.5, 11.5, 0.15, -190.5, 55)" },
    { wait: 6, capture: "flowers close" },
    { lua: "AT(21, 1.7, -199, 11.5, 0.2, -188, 50)" },
    { wait: 6, capture: "flowers at 10 m" },
    { lua: "AT(40, 1.7, -146, 70, 0.0, -120, 55)" },
    { wait: 6, capture: "meadow low across" },
    { lua: "CAM.pinned = nil; local p = nova.named('postmaster'); p.x, p.z, p.face = 36, -150, 0.9; CAM.reset(0.9)" },
    { wait: 60 },
    ...walk,
    { lua: "pcall(function() require('lib.atmosphere').start(4) end); CAM.pinned = nil; local p = nova.named('postmaster'); p.x, p.z, p.face = 36, -150, 0.9; CAM.reset(0.9)" },
    { wait: 200, capture: "wind curls open ground 1" },
    { wait: 70, capture: "wind curls open ground 2" },
    { wait: 70, capture: "wind curls open ground 3" },
    { lua: "local p = nova.named('postmaster'); p.x, p.z = 146, 41; AT(150, 2.2, 45, 70, -12, -30, 60)" },
    { wait: 120, capture: "wind curls on a hill 1" },
    { wait: 70, capture: "wind curls on a hill 2" },
  ],
  print: ["nova.perf().gpu_ms", "nova.perf().triangles", "nova.ambient_info().streaks"],
  out,
};
writeFileSync(new URL("./eighth.json", import.meta.url), JSON.stringify(plan, null, 1) + "\n");
