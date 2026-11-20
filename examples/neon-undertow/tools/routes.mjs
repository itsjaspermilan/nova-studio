// Writes the play routes (tool arguments for `play`: scripts/nova-tool --project <game> play @tools/r_<name>.json).
// The Rust play test (crates/nova-runtime/tests/neon_undertow.rs) runs the "proof" routes headless and asserts what they print.
// Run: scripts/env.sh node examples/neon-undertow/tools/routes.mjs
import fs from "node:fs";
import path from "node:path";
const dir = path.dirname(new URL(import.meta.url).pathname);
const out = (name, obj) => fs.writeFileSync(`${dir}/r_${name}.json`, JSON.stringify(obj, null, 1) + "\n");

// The probe: wraps the runner's update so that every frame writes "x,y,attack frame,hit-stop hold,state" into H.
const PROBE = `local R = nova.named('runner'); local J = require('lib.juice'); H = {}; local orig = R.update;
R.update = function(self, dt) orig(self, dt); H[#H+1] = string.format('%.2f,%.2f,%d,%d,%s', self.x, self.y, self.f, J.hold, self.state) end`;
const place = (x, y, facing) => `local r = nova.named('runner'); r.x, r.y, r.facing = ${x}, ${y}, '${facing}'`;
const H = "table.concat(H, ' ')";

// ---- 1. the chain: 2, 2, 4 damage to the dummy; three hits refund a pip; start-up frames come from the log
out("chain", {
  start_scene: "test_room",
  lua: place(380, 470, "right") + "; r.charge = 0",
  route: [
    { wait: 3 },
    { press: "attack" }, { wait: 3 }, { press: "attack" }, { wait: 17 }, { press: "attack" }, { wait: 50, capture: "end" },
  ],
  print: ["nova.named('dummy').total", "nova.named('dummy').last_damage", "string.format('%.3f', nova.named('runner').charge)", "nova.named('runner').stats.baton_hits"],
});

// ---- 2. the hit-stop: the runner (holding right) does not move for 3 frames on a hit
out("hitstop", {
  start_scene: "test_room",
  lua: place(380, 470, "right") + "\n" + PROBE,
  route: [
    { wait: 3 },
    { hold: ["right"], tap: "attack", tap_every: 100, frames: 40 },
    { wait: 5, capture: "end" },
  ],
  print: [H],
});

// ---- 3. the roll: 3.2 tiles; the second roll waits 0.6 s after the first ends
out("roll", {
  start_scene: "test_room",
  lua: place(200, 470, "right") + "\n" + PROBE + "; X0 = r.x",
  route: [
    { wait: 3 },
    { hold: ["right"], tap: "dash", tap_every: 200, until: "nova.named('runner').state == 'roll'", max: 6 },
    { until: "nova.named('runner').state ~= 'roll'", max: 40, capture: "roll over" },
    { lua: "R1 = nova.named('runner').x - X0; ROLLS_AFTER_1 = nova.named('runner').stats.rolls" },
    { press: "dash" }, { wait: 20 },
    { lua: "EARLY = nova.named('runner').stats.rolls" },
    { until: "nova.named('runner').roll_cd <= 0", max: 60 },
    { press: "dash" }, { wait: 3, capture: "second roll" },
    { lua: "LATE = nova.named('runner').stats.rolls" },
  ],
  print: ["string.format('%.2f', R1)", "ROLLS_AFTER_1", "EARLY", "LATE", H],
});

// ---- 4. rolling through a Scrapper's swing: A lands inside the untouchable time, B after it
const scrapperSetup = (rx, ry) =>
  `local r = nova.named('runner'); r.x, r.y, r.facing = ${rx}, ${ry}, 'right';
local s = nova.named('scrapper'); s.x, s.y = 700, 470; s.facing = 'left'; s.state = 'tell'; s.t = 0`;
out("roll_through", {
  start_scene: "test_room",
  lua: scrapperSetup(650, 470),
  route: [
    { wait: 1 },
    { until: "nova.named('scrapper').t >= 0.5 - 2.5/60", max: 60 },
    { hold: ["right"], tap: "dash", tap_every: 200, until: "nova.named('runner').state == 'roll'", max: 5 },
    { wait: 12, capture: "A: swing lands during the roll" },
    { lua: "A_HP = nova.named('runner').hp; A_SWINGS = nova.named('scrapper').swings; A_BLOCKED = nova.named('runner').stats.blocked_by_roll" },
  ],
  print: ["A_HP", "A_SWINGS", "A_BLOCKED"],
});
out("roll_late", {
  start_scene: "test_room",
  lua: scrapperSetup(500, 470),
  route: [
    { wait: 1 },
    { until: "nova.named('scrapper').t >= 0.5 - 15/60", max: 60 },
    { hold: ["right"], tap: "dash", tap_every: 200, until: "nova.named('runner').state == 'roll'", max: 5 },
    { wait: 20, capture: "B: swing lands after the roll's untouchable time" },
    { lua: "B_HP = nova.named('runner').hp; B_SWINGS = nova.named('scrapper').swings; B_HURT = nova.named('runner').stats.hurt" },
  ],
  print: ["B_HP", "B_SWINGS", "B_HURT"],
});
// control: the same swing with no roll hits for 2
out("swing_control", {
  start_scene: "test_room",
  lua: scrapperSetup(650, 470),
  route: [{ wait: 45, capture: "the swing lands" }],
  print: ["nova.named('runner').hp", "nova.named('scrapper').swings"],
});

// ---- 5. aiming slows walking to 35%
out("aim_walk", {
  start_scene: "test_room",
  lua: place(200, 470, "right") + "\n" + PROBE,
  route: [
    { wait: 2 }, { lua: "X0 = nova.named('runner').x" },
    { hold: ["right"], frames: 30 },
    { lua: "WALK = nova.named('runner').x - X0; nova.named('runner').x = 200; X1 = 200" },
    { hold: ["right", "ranged"], frames: 30, capture: "aiming" },
    { lua: "AIM = nova.named('runner').x - X1" },
  ],
  print: ["string.format('%.3f', WALK)", "string.format('%.3f', AIM)", "string.format('%.4f', AIM / WALK)"],
});

// ---- 6. shots cost a pip, an empty one clicks, baton hits give a third back
const shoot = [{ hold: ["ranged"], frames: 6 }, { wait: 14 }];
out("charge", {
  start_scene: "test_room",
  lua: place(250, 470, "right"),
  route: [
    { wait: 3 },
    { lua: "C0 = string.format('%.3f', nova.named('runner').charge)" },
    ...shoot, { lua: "C1 = string.format('%.3f', nova.named('runner').charge); S1 = nova.named('runner').stats.shots" },
    ...shoot, { lua: "C2 = string.format('%.3f', nova.named('runner').charge)" },
    ...shoot, { lua: "C3 = string.format('%.3f', nova.named('runner').charge); S3 = nova.named('runner').stats.shots; DUMMY = nova.named('dummy').total" },
    ...shoot, { lua: "C4 = string.format('%.3f', nova.named('runner').charge); S4 = nova.named('runner').stats.shots; K4 = nova.named('runner').stats.clicks; DUMMY4 = nova.named('dummy').total" },
    { lua: "local r = nova.named('runner'); r.x = 380" },
    { press: "attack" }, { wait: 3 }, { press: "attack" }, { wait: 17 }, { press: "attack" }, { wait: 50 },
    { lua: "C5 = string.format('%.3f', nova.named('runner').charge); B5 = nova.named('runner').stats.baton_hits" },
  ],
  print: ["C0", "C1", "S1", "C2", "C3", "S3", "DUMMY", "C4", "S4", "K4", "DUMMY4", "C5", "B5"],
});

// ---- 7. the blink: 0.8 s (48 frames) without damage after a hit. The first swing lands at about frame 32; a second real swing
// (a tell started by hand at frame 46) lands inside the blink and misses; direct hits at +25 and +40 frames miss, +50 lands.
out("blink", {
  start_scene: "test_room",
  lua: scrapperSetup(650, 470),
  route: [
    { until: "nova.named('runner').stats.hurt == 1", max: 80 },
    { lua: "HP1 = nova.named('runner').hp; local s = nova.named('scrapper'); s.state = 'tell'; s.t = 0.4; SW1 = s.swings" },
    { wait: 14 }, { lua: "SW2 = nova.named('scrapper').swings; BLOCKED2 = nova.named('runner').stats.blocked_by_blink; HP2 = nova.named('runner').hp" },
    { wait: 11 }, { lua: "T25 = tostring(nova.named('runner'):take_damage(2)); HP3 = nova.named('runner').hp" },
    { wait: 15 }, { lua: "T40 = tostring(nova.named('runner'):take_damage(2)); HP4 = nova.named('runner').hp; BL = string.format('%.2f', nova.named('runner').blink_t)" },
    { wait: 10 }, { lua: "T50 = tostring(nova.named('runner'):take_damage(2)); HP5 = nova.named('runner').hp" },
  ],
  print: ["HP1", "SW1", "SW2", "BLOCKED2", "HP2", "T25", "HP3", "T40", "HP4", "BL", "T50", "HP5"],
});

// ---- 8. killing the Scrapper drops scrap, walking over it counts it
out("kill_scrapper", {
  start_scene: "test_room",
  invincible: true,
  lua: `local r = nova.named('runner'); r.x, r.y, r.facing = 640, 470, 'right'; local s = nova.named('scrapper'); s.x, s.y = 700, 470`,
  route: [
    { wait: 2 },
    { press: "attack" }, { wait: 3 }, { press: "attack" }, { wait: 17 }, { press: "attack" },
    { until: "nova.count('scrap') > 0", max: 60, capture: "the burst" },
    { wait: 2, capture: "burst 2" }, { wait: 3, capture: "burst 3" },
    { wait: 6, capture: "scrap on the floor" },
    { lua: "DROPPED = nova.count('scrap'); ALIVE = nova.count('scrapper')" },
    { repeat: 3, until: "nova.count('scrap') == 0", steps: [{ walk_to: "scrap", who: "runner", max: 120, may_time_out: true }, { wait: 2 }] },
    { wait: 5, capture: "all taken" },
  ],
  zoom: 2, crop: [330, 150, 420, 220], out: "build/look_kill", columns: 3,
  print: ["DROPPED", "ALIVE", "require('lib.juice').scrap", "nova.count('scrap')"],
});

// ---- 9. dying: the beat, then the room restarts with full health
out("die", {
  start_scene: "test_room",
  route: [
    { wait: 3 },
    { lua: "nova.named('runner').hp = 2; nova.named('runner'):take_damage(2); D_STATE = nova.named('runner').state; D_HP = nova.named('runner').hp" },
    { wait: 40, capture: "printed again" },
    { until: "nova.named('runner').state == 'free' and nova.named('runner').hp == 12", max: 120, capture: "room restarted" },
    { lua: "NEW_HP = nova.named('runner').hp; NEW_STATE = nova.named('runner').state; NEW_SCRAP = require('lib.juice').scrap" },
  ],
  print: ["D_STATE", "D_HP", "NEW_HP", "NEW_STATE", "NEW_SCRAP"],
});

// ---- pictures to look at
for (const [dir, x, y, face] of [["right", 380, 470, "right"], ["left", 535, 470, "left"], ["down", 456, 388, "down"], ["up", 456, 540, "up"]]) {
  const hits = (n) => `nova.named('runner').stats.baton_hits == ${n}`;
  out(`look_chain_${dir}`, {
    start_scene: "test_room",
    lua: place(x, y, face),
    route: [
      { wait: 3 },
      { press: "attack" }, { wait: 3, capture: "1 wind-up" }, { press: "attack" },
      { until: hits(1), max: 30, capture: "1 hit" }, { wait: 5, capture: "1 later" },
      { until: hits(2), max: 40 }, { press: "attack" }, { wait: 1, capture: "2 hit" }, { until: hits(3), max: 40, capture: "3 hit (heavy)" }, { wait: 3, capture: "3 later" }, { wait: 5, capture: "3 end" },
    ],
    zoom: 2, crop: [210, 120, 480, 270], out: `build/look_chain_${dir}`, columns: 3,
  });
}
out("look_roll", {
  start_scene: "test_room",
  lua: place(300, 470, "right"),
  route: [{ wait: 3 }, { hold: ["right"], tap: "dash", tap_every: 200, until: "nova.named('runner').state == 'roll'", max: 6 }, { wait: 3, capture: "a" }, { wait: 3, capture: "b" }, { wait: 3, capture: "c" }, { wait: 3, capture: "d" }, { wait: 4, capture: "e" }, { wait: 6, capture: "end" }],
  zoom: 3, crop: [200, 190, 320, 130], out: "build/look_roll", columns: 3,
});
out("look_aim", {
  start_scene: "test_room",
  lua: place(300, 470, "right"),
  route: [{ wait: 3 }, { hold: ["ranged"], frames: 12, capture: "aim right" }, { hold: ["ranged", "up", "right"], frames: 12, capture: "aim up-right" }, { wait: 5, capture: "shot flies" }, { wait: 10, capture: "shot lands" }, { lua: "nova.named('runner').charge = 0" }, { hold: ["ranged"], frames: 8, capture: "aim, no charge" }],
  zoom: 2, crop: [150, 130, 520, 220], out: "build/look_aim", columns: 3,
});
out("look_scrapper", {
  start_scene: "test_room",
  lua: scrapperSetup(650, 470),
  route: [{ wait: 3, capture: "tell begins" }, { wait: 10, capture: "tell" }, { wait: 12, capture: "tell, late" }, { wait: 6, capture: "swing" }, { wait: 3, capture: "swing 2" }, { wait: 6, capture: "recover" }],
  zoom: 3, crop: [330, 190, 330, 170], out: "build/look_scrapper", columns: 3,
});
out("look_hitboxes", {
  start_scene: "test_room",
  overlay: ["hitboxes"],
  lua: `${place(380, 470, "right")}; local s = nova.named('scrapper'); s.x, s.y = 700, 400; s.facing = 'left'; s.state = 'tell'; s.t = 0.45; s.x = 700`,
  route: [{ wait: 3 }, { press: "attack" }, { wait: 7, capture: "baton box" }, { wait: 12, capture: "scrapper's tell box" }, { wait: 6, capture: "scrapper's swing box" }],
  zoom: 2, crop: [250, 120, 560, 250], out: "build/look_hitboxes", columns: 3,
});
out("look_hud", {
  start_scene: "test_room",
  lua: `${place(380, 470, "right")}; local r = nova.named('runner'); r.hp = 7; r.charge = 1.67`,
  route: [{ wait: 3, capture: "hud: 3.5 hearts, 1 and two thirds pips" }],
  out: "build/look_hud", columns: 1,
});
out("look_hitboxes_scrapper", {
  start_scene: "test_room",
  overlay: ["hitboxes"],
  lua: scrapperSetup(650, 470),
  route: [{ wait: 20, capture: "tell: the magenta zone" }, { until: "nova.named('scrapper').swings == 1", max: 40, capture: "swing: the box it hurts with" }, { wait: 3, capture: "swing, 3 frames later" }],
  zoom: 2, crop: [250, 150, 330, 170], out: "build/look_hitboxes_scrapper", columns: 3,
});

// ---- the third hit knocks back (a Scrapper with plenty of health, so it survives to be pushed)
out("knockback", {
  start_scene: "test_room",
  invincible: true,
  lua: `local r = nova.named('runner'); r.x, r.y, r.facing = 640, 470, 'right'; local s = nova.named('scrapper'); s.x, s.y, s.hp = 700, 470, 30`,
  route: [
    { wait: 2 },
    { press: "attack" }, { wait: 3 }, { press: "attack" }, { until: "nova.named('runner').stats.baton_hits == 2", max: 60 },
    { press: "attack" },
    { lua: "X2 = nova.named('scrapper').x" },
    { until: "nova.named('runner').stats.baton_hits == 3", max: 60 },
    { wait: 3, capture: "knocked back" },
    { lua: "X3 = nova.named('scrapper').x; ST = nova.named('scrapper').state" },
    { wait: 25, capture: "settled" },
    { lua: "X4 = nova.named('scrapper').x" },
  ],
  print: ["string.format('%.1f', X2)", "string.format('%.1f', X3)", "ST", "string.format('%.1f', X4)", "nova.named('scrapper').hp"],
});
