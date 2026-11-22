// Writes the routes that picture the cast (scripts/env.sh node examples/mountain-post/tools/routes/cast-make.mjs, then play each
// with scripts/nova-tool play @<route>): cast.json (each of the three from the front, three-quarters and the side where they live,
// then both hand-overs line by line through the game's own conversation camera, then Hazel seen from the van's chase camera) and
// gaits.json (the postmaster's walk, run and parcel trot, filmed from beside).
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const lua = [
  "T = require('lib.testkit'); S = require('lib.state'); CAM = require('lib.camera')",
  // a pinned view of `who` from `yaw` degrees round their front, `d` metres off, looking at `h` metres up
  "VIEW = function(who, yaw, d, h) local c = nova.named(who); local a = c.face + math.rad(yaw); local g = nova.terrain_height(c.x, c.z) + (c.y or 0); CAM.pinned = { c.x + math.sin(a) * d, g + h + 0.15, c.z + math.cos(a) * d, c.x, g + h, c.z, 34 } end",
  // the postmaster stands `d` metres in front of a resident, the resident's parcel in hand, facing them
  "MEET = function(who, d) local r = nova.named(who); local p = nova.named('postmaster'); S.carrying = who; p.x, p.z = r.x + math.sin(r.face) * d, r.z + math.cos(r.face) * d; p.face = r.face + math.pi; CAM.pinned = nil; CAM.reset(p.face) end",
  "STILL = function(who) local c = nova.named(who); c.mood.wait, c.mood.blink = 99, 0 end",
].join("; ");

const turn = (who, h) => [
  { lua: `STILL('${who}'); local p = nova.named('postmaster'); if '${who}' ~= 'postmaster' then local c = nova.named('${who}'); p.x, p.z = c.x - math.cos(c.face) * 3, c.z + math.sin(c.face) * 3 end; VIEW('${who}', 0, 2.3, ${h})` }, { wait: 6, capture: `${who} front` },
  { lua: `VIEW('${who}', 40, 2.3, ${h})` }, { wait: 4, capture: `${who} three-quarter` },
  { lua: `VIEW('${who}', 90, 2.3, ${h})` }, { wait: 4, capture: `${who} side` },
  { lua: `VIEW('${who}', 180, 2.3, ${h})` }, { wait: 4, capture: `${who} back` },
];
const talk = (who, n) => [
  { lua: `MEET('${who}', 1.7)` },
  { wait: 90 },
  { press: "act" },
  { wait: 50, capture: `${who} line 1` },
  ...Array.from({ length: n - 1 }, (_, i) => [{ press: "act" }, { wait: 12 }, { press: "act" }, { wait: 50, capture: `${who} line ${i + 2}` }]).flat(),
  { repeat: 12, until: `S.delivered.${who}`, steps: [{ press: "act" }, { wait: 20 }] },
];

const cast = {
  size: "1280x720",
  start_scene: "valley",
  lua,
  route: [
    { wait: 10, lua: "local p = nova.named('postmaster'); p.x, p.z, p.face, p.control = 4.5, -125, 0, false" },
    ...turn("postmaster", 0.55),
    { lua: "CAM.pinned = nil; local p = nova.named('postmaster'); p.control = true" },
    ...talk("hazel", 5),
    { wait: 30, capture: "after Hazel's" },
    ...turn("hazel", 0.5),
    { lua: "CAM.pinned = nil" },
    ...talk("pip", 5),
    ...turn("pip", 0.5),
    // the van stopped on Fern Lane a few metres from Hazel, the chase camera behind it
    { lua: "CAM.pinned = nil; local h = nova.named('hazel'); h.mode = 'work'; local v = nova.named('van'); local a = math.atan(h.x - 150, h.z - 44); v:teleport(h.x - math.sin(a) * 12, h.z - math.cos(a) * 12, a + 0.4); a = a + 0.4; local s = nova.scene_now(); s.mode = 'van'; v.driven = true; v.engine_on = true; nova.named('postmaster').hidden = true; CAM.reset(a)" },
    { wait: 60, capture: "Hazel from the van, 12 m" },
    { lua: "local h = nova.named('hazel'); local v = nova.named('van'); local a = math.atan(h.x - 150, h.z - 44); v:teleport(h.x - math.sin(a) * 6.5, h.z - math.cos(a) * 6.5, a + 0.55); CAM.reset(a + 0.55)" },
    { wait: 60, capture: "Hazel from the van, 6.5 m" },
  ],
  out: "build/cast_run",
};
writeFileSync(join(here, "cast.json"), JSON.stringify(cast, null, 1));

// the gaits from beside: a gentle tilt walks, a full push runs with the arms out, a full push with a parcel trots
const gaits = {
  size: "1280x720",
  start_scene: "valley",
  view: { follow: "postmaster", from: "front", yaw: 35, distance: 2.2, height: 0.1 },
  capture_at: [46, 52, 58, 116, 120, 124, 202, 206, 210],
  route: [
    { wait: 10, lua: "local p = nova.named('postmaster'); p.x, p.z, p.face = 4.5, -140, 0; require('lib.camera').reset(0)" },
    { hold: ["move_y=-0.5"], frames: 60, capture: "walk" },
    { wait: 25 },
    { hold: ["move_y=-1"], frames: 60, capture: "run" },
    { wait: 25, lua: "require('lib.state').carrying = 'hazel'" },
    { hold: ["move_y=-1"], frames: 60, capture: "trot with a parcel" },
  ],
  out: "build/gaits_run",
};
writeFileSync(join(here, "gaits.json"), JSON.stringify(gaits, null, 1));
console.log("wrote cast.json and gaits.json");
