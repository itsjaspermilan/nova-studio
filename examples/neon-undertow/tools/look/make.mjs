// The look routes: play routes for the `play` tool that shoot every scene the art swap has to be judged on (film strips and full frames).
// Run: scripts/env.sh node examples/neon-undertow/tools/look/make.mjs   (writes tools/look/<name>.json), then, from the repository folder:
//   scripts/nova-tool --project examples/neon-undertow play @examples/neon-undertow/tools/look/<name>.json     (pictures land in build/look/<name>/)
import fs from "node:fs";
const dir = new URL("./", import.meta.url).pathname;
const BOT = `
-- a stand-in player for the pictures: walks at the nearest enemy, swings when it is near, rolls and shoots now and then
BOT_F = 0
local Jx = require('lib.juice'); local orig = Jx.tick
Jx.tick = function()
  orig()
  BOT_F = BOT_F + 1
  local r = nova.named('runner')
  if not (r and r.state == 'free') then return end
  local e = nova.nearest(r.x, r.y, 'enemy')
  if not e then return end
  local dx, dy = e.x - r.x, e.y - r.y; local d = math.sqrt(dx * dx + dy * dy)
  r:face(dx, dy)
  if d > 420 and BOT_F % 40 == 0 then r.x, r.y = e.x - (dx > 0 and 150 or -150), e.y end   -- (the stand-in is lazy: it steps to the fight)
  if d < 90 and BOT_F % 24 == 0 then r:start_attack()
  elseif d >= 90 and BOT_F % 90 ~= 0 then r:move(dx / d * 3.1, dy / d * 3.1)
  elseif BOT_F % 90 == 0 and r.roll_cd <= 0 then r:start_roll()
  elseif BOT_F % 45 == 0 then r.aim_dx, r.aim_dy = dx / d, dy / d; r.shot_cd = 0; r:fire() end
end
`;
const enter = (room, seed = 5) => ({ lua: `require('lib.run').begin_chain(${seed}); nova.goto_scene('${room}')` });
const waitIn = (room) => ({ until: `nova.current_scene() == '${room}' and nova.named('runner') ~= nil`, max: 40 });
const write = (name, plan) => fs.writeFileSync(`${dir}${name}.json`, JSON.stringify({ start_scene: "test_lab", invincible: true, who: "runner", out: `build/look/${name}`, columns: 3, ...plan }, null, 1));

for (const [name, room, seed, frames] of [["fight_square", "gutter.s1_square", 5, [60, 150, 240, 330, 420, 520]], ["fight_street", "gutter.s1_street", 7, [70, 160, 250, 340, 430, 520]], ["fight_flood", "gutter.s3_flood", 9, [70, 160, 250, 340, 430, 520]], ["fight_yard", "gutter.s7_yard", 11, [70, 160, 250, 340, 430, 520]]]) {
  write(name, { route: [enter(room, seed), waitIn(room), { lua: BOT }, ...frames.map((f, i) => ({ wait: i === 0 ? f : f - frames[i - 1], capture: `${name} ${f}` }))], print: ["nova.count('enemy')", "nova.named('runner').hp"] });
}
const QUIET = `local S = nova.scene_now(); S.state = 'lab'; S.def = { waves = {}, scrap = 0 }; for _, w in ipairs(nova.all('warn')) do w:destroy() end`;
const go = (room, seed = 5) => [enter(room, seed), waitIn(room), { lua: QUIET }];
// the elite with each mark, side by side (stunned) in the street, the runner in front
write("elites", { route: [...go("gutter.s1_street", 7), { lua: `local r = nova.named('runner'); r.x, r.y = 700, 480; r.facing = 'up'; local x = 520; for i, m in ipairs(require('data.elites').order) do local e = nova.spawn('scrapper', x, 380); e.hp = 30; require('lib.status').stun(e, 99); e.facing = 'down'; require('lib.elite').make(e, m); x = x + 150 end` }, { wait: 20, capture: "elite marks: shielded, splitting, magnetic, volatile, linked" }, { lua: "nova.cam.set(760, 400)" }, { wait: 10, capture: "elite marks again" }], print: ["nova.count('enemy')"] });
// a barrel blast: the fuse and the blast, next to a stall
write("barrel_blast", { route: [...go("gutter.s3_flood", 9), { lua: `local b = nova.all('barrel')[1]; BARREL = b; local r = nova.named('runner'); r.x, r.y = b.x - 130, b.y + 10; nova.spawn('scrapper', b.x + 60, b.y + 30)` }, { wait: 10, capture: "a barrel" }, { lua: "BARREL:take_hit(1, 0, 0, 0)" }, { wait: 8, capture: "the fuse is lit" }, { wait: 30, capture: "the fuse runs" }, { wait: 22, capture: "the blast" }, { wait: 14, capture: "after" }] });
// a dropped sign and a live puddle
write("sign_puddle", { route: [...go("gutter.s3_flood", 9), { lua: `local sg = nova.all('sign')[1]; SIGN = sg; local r = nova.named('runner'); r.x, r.y = sg.x - 160, sg.y + 60; local best, bd = nil, 1e9; for _, p in ipairs(nova.all('puddle')) do local d = math.abs(p.x - sg.x) + math.abs(p.y - sg.y); if d < bd then best, bd = p, d end end; PUD = best` }, { wait: 10, capture: "a sign over a puddle" }, { lua: "require('lib.hits').from = 'shot'; SIGN:take_hit(1, 0, 0, 0); require('lib.hits').from = nil" }, { wait: 6, capture: "the sign drops" }, { lua: "local r = nova.named('runner'); r.x, r.y = PUD.x - 20, PUD.y" }, { wait: 14, capture: "standing in the live puddle" }, { wait: 40, capture: "live" }] });
// the tram crossing in a real room
write("tram_room", { route: [...go("gutter.s3_tram", 5), { lua: `TR = nova.all('tram')[1]; local r = nova.named('runner'); r.x, r.y = TR.x + 700, TR.y - 150; TR.c = 10.3; TR.state = 'idle'` }, { until: "TR.state == 'warn'", max: 100 }, { wait: 40, capture: "the rail flashes" }, { until: "TR.state == 'cross'", max: 200 }, { wait: 22, capture: "the tram comes in" }, { wait: 16, capture: "it crosses" }, { wait: 24, capture: "it passes" }] });
// Patch and Old Sal in their room (the seed that puts each at the stranger slot)
for (const [who, nm] of [["patch", "patch_room"], ["old_sal", "sal_room"]]) {
  write(nm, { route: [{ lua: `require('lib.meta').met.${who} = 0; for s = 1, 400 do if require('lib.run').build_chain(s)[6].who == '${who}' then SEED = s; break end end; require('lib.run').begin_chain(SEED); nova.goto_scene('gutter.stranger')` }, { until: "nova.current_scene() == 'gutter.stranger' and nova.named('runner') ~= nil", max: 40 }, { wait: 12, capture: "the room" }, { walk_to: "stranger", who: "runner", max: 900 }, { wait: 4, capture: "beside them" }, { press: "interact" }, { wait: 4, capture: "the first line" }] });
}
write("shop_room", { route: [...go("gutter.walk", 5).slice(0, 2), { wait: 20, capture: "the hall" }, { walk_to: "shop_heal", who: "runner", max: 900 }, { wait: 10, capture: "at the stalls" }, { walk_to: "bank", who: "runner", max: 900 }, { wait: 10, capture: "at the bank" }] });
// the whole cast side by side at game scale, calm, then each telling
write("cast", { route: [...go("gutter.s1_street", 7), { lua: `local r = nova.named('runner'); r.x, r.y = 500, 480; r.facing = 'right'; local x = 600; CAST = {}; for _, k in ipairs({ 'scrapper', 'bottle_thrower', 'rat_drone', 'tout', 'mimic_vendor', 'dummy' }) do local e = nova.spawn(k, x, 480); CAST[#CAST + 1] = e; if k ~= 'dummy' then require('lib.status').stun(e, 99) end; x = x + 110 end` }, { wait: 20, capture: "the cast at game scale" }, { lua: "nova.cam.set(780, 400)" }, { wait: 6, capture: "the cast, centred" }], print: ["nova.count('enemy')"] });
console.log("wrote", fs.readdirSync(dir).filter((f) => f.endsWith(".json")).join(" "));
