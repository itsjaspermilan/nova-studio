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

// =====================================================================================================================
// Slice 2: a room that plays. Routes in the card lab (scenes/test_lab: named dummies d1..d3, a wall at x 672-720 / y 288-480, a stall
// at x 288-432 / y 672-720), and in the two fight rooms. Each prints the numbers the Rust test asserts.
// =====================================================================================================================
const RUN = "require('lib.run')";
const J = "require('lib.juice')";
const labPlace = (rx, ry, face = "right") => `local r = nova.named('runner'); r.x, r.y, r.facing = ${rx}, ${ry}, '${face}'`;
const dum = (n, x, y) => `do local d = nova.named('${n}'); d.x, d.y = ${x}, ${y} end`;
const give = (id) => `${RUN}.add_card('${id}', nova.named('runner'))`;
const chain3 = [{ press: "attack" }, { wait: 3 }, { press: "attack" }, { wait: 17 }, { press: "attack" }, { wait: 50 }];
const tot = (n) => `nova.named('${n}').total`;

// ---- the twelve cards: each changes what it says. A phase without the card, then the card is given and the same thing is tried.
// Live Wire: the third hit zaps the 2 enemies near the target (d2, d3) for 2 each; the first two hits do not.
out("card_live_wire", {
  start_scene: "test_lab",
  lua: `${labPlace(324, 420)}; ${dum("d1", 400, 420)}; ${dum("d2", 400, 310)}; ${dum("d3", 400, 530)}`,
  route: [
    { wait: 3 }, ...chain3,
    { lua: `BASE_D1 = ${tot("d1")}; BASE_D2 = ${tot("d2")}; BASE_D3 = ${tot("d3")}` },
    { lua: give("live_wire") + "; nova.named('runner').stats.baton_hits = 0" }, { wait: 40 },
    { press: "attack" }, { wait: 3 }, { press: "attack" },
    { until: "nova.named('runner').stats.baton_hits == 2", max: 60 },
    { lua: `MID_D2 = ${tot("d2")}; MID_D3 = ${tot("d3")}` },
    { wait: 12 }, { press: "attack" },
    { until: "nova.named('runner').stats.baton_hits == 3", max: 60, capture: "the third hit zaps" },
    { wait: 3 },
    { lua: `END_D1 = ${tot("d1")}; END_D2 = ${tot("d2")}; END_D3 = ${tot("d3")}` },
  ],
  print: ["BASE_D1", "BASE_D2", "BASE_D3", "MID_D2", "MID_D3", "END_D1", "END_D2", "END_D3"],
});

// Long Reach: a dummy 105 units away is out of the baton's short arc (78) and inside it with the card (98).
out("card_long_reach", {
  start_scene: "test_lab",
  lua: `${labPlace(300, 420)}; ${dum("d1", 405, 420)}`,
  route: [
    { wait: 3 }, { press: "attack" }, { wait: 30 },
    { lua: `BASE = ${tot("d1")}; ${give("long_reach")}; REACH = ${RUN}.mods.reach` }, { wait: 60 },
    { press: "attack" }, { wait: 30, capture: "reaches" },
    { lua: `WITH = ${tot("d1")}` },
  ],
  print: ["BASE", "WITH", "string.format('%.2f', REACH)"],
});

// Riot Stock: the third hit also stuns 0.6 s and knocks back twice as far. Two routes: without and with.
const riot = (card) => ({
  start_scene: "test_lab",
  invincible: true,
  lua: `${labPlace(324, 420)}; local s = nova.spawn('scrapper', 400, 420); s.hp = 60; ${card ? give("riot_stock") : ""}`,
  route: [
    { wait: 2 },
    { press: "attack" }, { wait: 3 }, { press: "attack" }, { until: "nova.named('runner').stats.baton_hits == 2", max: 60 },
    { lua: "X2 = nova.first('scrapper').x" },
    { press: "attack" },
    { until: "nova.named('runner').stats.baton_hits == 3", max: 60 },
    { wait: 2 }, { lua: "STUN = string.format('%.2f', nova.first('scrapper').stun_t or 0); X3 = nova.first('scrapper').x" },
    { wait: 10 }, { lua: "PUSH10 = nova.first('scrapper').x - X2" },
    { wait: 14, capture: card ? "stunned and pushed" : "pushed" }, { lua: "ST_AT_25 = nova.first('scrapper').state; STUN_AT_25 = string.format('%.2f', nova.first('scrapper').stun_t or 0)" },
    { wait: 40 }, { lua: "ST_LATE = nova.first('scrapper').state" },
  ],
  print: ["string.format('%.1f', PUSH10)", "STUN", "ST_AT_25", "STUN_AT_25", "ST_LATE"],
});
out("card_riot_stock_base", riot(false));
out("card_riot_stock", riot(true));

// Hot Solder: one baton hit sets the dummy alight; it takes 1 a second for 3 s (the dummy shows 2 + 3).
out("card_hot_solder", {
  start_scene: "test_lab",
  lua: `${labPlace(324, 420)}; ${dum("d1", 400, 420)}`,
  route: [
    { wait: 3 }, { press: "attack" }, { wait: 40 },
    { lua: `BASE = ${tot("d1")}; ${give("hot_solder")}` }, { wait: 40 },
    { press: "attack" }, { until: "nova.named('runner').stats.baton_hits == 2", max: 60 },
    { lua: `HIT = ${tot("d1")}; BURN_T = string.format('%.2f', nova.named('d1').burn_t)` },
    { wait: 50 }, { lua: `T0 = ${tot("d1")}` },
    { wait: 20 }, { lua: `T1 = ${tot("d1")}` },
    { wait: 60 }, { lua: `T2 = ${tot("d1")}` },
    { wait: 62 }, { lua: `T3 = ${tot("d1")}` }, { wait: 60, capture: "burnt out" },
    { lua: `T4 = ${tot("d1")}; BURN_END = nova.named('d1').burn_t` },
  ],
  print: ["BASE", "HIT", "BURN_T", "T0", "T1", "T2", "T3", "T4", "BURN_END"],
});

// Ricochet: the dummy sits behind the wall (the line from the runner to it is blocked); a shot up into the top wall comes down on it.
// (the stick stays over for the frame ranged is let go: the shot goes where the stick points)
const ricochetShot = [{ hold: ["ranged", "up", "right"], frames: 6 }, { hold: ["up", "right"], frames: 2 }, { wait: 80 }];
out("card_ricochet", {
  start_scene: "test_lab",
  lua: `${labPlace(480, 336)}; ${dum("d1", 1000, 318)}; ${dum("d2", 1300, 700)}; ${dum("d3", 1300, 760)}`,
  route: [
    { wait: 3 }, ...ricochetShot,
    { lua: `BASE = ${tot("d1")}; BASE_SHOTS = nova.named('runner').stats.shots; ${give("ricochet")}; nova.named('runner').charge = 3` },
    { wait: 20 }, ...ricochetShot,
    { lua: `WITH = ${tot("d1")}; BOUNCES = ${RUN}.mods.bounces` },
  ],
  print: ["BASE", "BASE_SHOTS", "WITH", "BOUNCES"],
});

// Scatter: three dummies in the fan 400 units away; one shot hits each for 2 (without the card only the middle one, for 3).
const scatterLayout = `${labPlace(300, 600)}; ${dum("d1", 700, 508)}; ${dum("d2", 700, 593)}; ${dum("d3", 700, 677)}`;
out("card_scatter", {
  start_scene: "test_lab",
  lua: scatterLayout,
  route: [
    { wait: 3 }, { hold: ["ranged"], frames: 6 }, { wait: 40 },
    { lua: `B1, B2, B3 = ${tot("d1")}, ${tot("d2")}, ${tot("d3")}; BASE_PELLETS = nova.named('runner').stats.pellets; nova.named('runner').charge = 3; ${give("scatter")}; PELLETS_PER = ${RUN}.mods.pellets; CH0 = nova.named('runner').charge` },
    { wait: 10 }, { hold: ["ranged"], frames: 6, capture: "aim" }, { wait: 40, capture: "pellets land" },
    { lua: `W1, W2, W3 = ${tot("d1")}, ${tot("d2")}, ${tot("d3")}; PELLETS = nova.named('runner').stats.pellets - BASE_PELLETS; CH1 = nova.named('runner').charge` },
  ],
  print: ["B1", "B2", "B3", "W1", "W2", "W3", "PELLETS", "PELLETS_PER", "CH0", "CH1"],
});

// Tracer: a shot marks the dummy; the next baton hit does 3 instead of 2 (and 6 instead of 4 on the third).
out("card_tracer", {
  start_scene: "test_lab",
  lua: `${labPlace(300, 420)}; ${dum("d1", 380, 420)}`,
  route: [
    { wait: 3 }, { press: "attack" }, { until: "nova.named('runner').stats.baton_hits == 1", max: 40 },
    { lua: `BASE_HIT = nova.named('d1').last_damage; ${give("tracer")}` }, { wait: 40 },
    { hold: ["ranged"], frames: 6 }, { wait: 20, capture: "marked" },
    { lua: `MARK = string.format('%.2f', nova.named('d1').mark_t or 0); SHOT_TOTAL = ${tot("d1")}` },
    { press: "attack" }, { until: "nova.named('runner').stats.baton_hits == 2", max: 40 }, { wait: 2, capture: "hit for more" },
    { lua: `MARKED_HIT = nova.named('d1').last_damage` },
    { wait: 200 }, // the mark runs out after 3 s
    { lua: `MARK_END = nova.named('d1').mark_t or 0` }, { press: "attack" }, { wait: 12 },
    { until: "nova.named('runner').stats.baton_hits == 3", max: 60 }, { wait: 2 },
    { lua: `AFTER_HIT = nova.named('d1').last_damage` },
  ],
  print: ["BASE_HIT", "MARK", "SHOT_TOTAL", "MARKED_HIT", "MARK_END", "AFTER_HIT"],
});

// Shock Wake: rolling at a (solid) dummy stops at it; with the card the roll passes through it and zaps it for 2.
out("card_shock_wake", {
  start_scene: "test_lab",
  lua: `${labPlace(300, 420)}; ${dum("d1", 400, 420)}`,
  route: [
    { wait: 3 },
    { hold: ["right"], tap: "dash", tap_every: 200, until: "nova.named('runner').state == 'roll'", max: 6 },
    { until: "nova.named('runner').state ~= 'roll'", max: 40 },
    { lua: `BASE_X = nova.named('runner').x; BASE_TOTAL = ${tot("d1")}; ${give("shock_wake")}; nova.named('runner').x = 300; nova.named('runner').roll_cd = 0` },
    { wait: 3 },
    { hold: ["right"], tap: "dash", tap_every: 200, until: "nova.named('runner').state == 'roll'", max: 6 },
    { wait: 7, capture: "through" },
    { until: "nova.named('runner').state ~= 'roll'", max: 40 },
    { lua: `WITH_X = nova.named('runner').x; WITH_TOTAL = ${tot("d1")}; ZAPS = nova.named('runner').stats.zaps` },
  ],
  print: ["string.format('%.0f', BASE_X)", "BASE_TOTAL", "string.format('%.0f', WITH_X)", "WITH_TOTAL", "ZAPS"],
});

// Second Wind: two presses of roll 20 frames apart give one roll; with the card, two.
out("card_second_wind", {
  start_scene: "test_lab",
  lua: `${labPlace(200, 420)}\n${PROBE}`,
  route: [
    { wait: 3 },
    { press: "dash" }, { wait: 20 }, { press: "dash" }, { wait: 70 },
    { lua: `BASE_ROLLS = nova.named('runner').stats.rolls; MARK_F = #H; ${give("second_wind")}; nova.named('runner').x = 200` },
    { wait: 40 },
    { lua: "START_F = #H" },
    { press: "dash" }, { wait: 20 }, { press: "dash" }, { wait: 20, capture: "second roll" },
    { lua: `WITH_ROLLS = nova.named('runner').stats.rolls - BASE_ROLLS; ROLLS_ALLOWED = ${RUN}.mods.rolls` },
    // after the second roll the wait is back: a third press at once does nothing; a fourth after the wait rolls
    { press: "dash" }, { wait: 8 }, { lua: `THIRD = nova.named('runner').stats.rolls - BASE_ROLLS` },
    { wait: 60 }, { press: "dash" }, { wait: 6 }, { lua: `FOURTH = nova.named('runner').stats.rolls - BASE_ROLLS` },
  ],
  print: ["BASE_ROLLS", "WITH_ROLLS", "ROLLS_ALLOWED", "THIRD", "FOURTH", "START_F", H],
});

// Plating: 14 health points (7 hearts), the 2 points healed.
out("card_plating", {
  start_scene: "test_lab",
  lua: `${labPlace(300, 420)}; nova.named('runner').hp = 5`,
  route: [
    { wait: 3 },
    { lua: `BASE_MAX = nova.named('runner').max_hp; BASE_HP = nova.named('runner').hp; ${give("plating")}` },
    { wait: 3, capture: "7 hearts" },
    { lua: `MAX = nova.named('runner').max_hp; HP = nova.named('runner').hp; HEARTS = math.ceil(MAX / 2); RUN_HP = ${RUN}.hp` },
  ],
  print: ["BASE_MAX", "BASE_HP", "MAX", "HP", "HEARTS", "RUN_HP"],
});

// Capacitor: 4 pips: four shots in a row (the fifth clicks).
out("card_capacitor", {
  start_scene: "test_lab",
  lua: `${labPlace(300, 420)}; ${dum("d1", 600, 420)}`,
  route: [
    { wait: 3 },
    { lua: `BASE_MAX = nova.named('runner').max_charge; ${give("capacitor")}` }, { wait: 3, capture: "4 pips" },
    { lua: `MAX = nova.named('runner').max_charge; CH = string.format('%.2f', nova.named('runner').charge)` },
    ...Array.from({ length: 5 }, () => [{ hold: ["ranged"], frames: 6 }, { wait: 14 }]).flat(),
    { lua: `SHOTS = nova.named('runner').stats.shots; CLICKS = nova.named('runner').stats.clicks; D = ${tot("d1")}` },
  ],
  print: ["BASE_MAX", "MAX", "CH", "SHOTS", "CLICKS", "D"],
});

// Deep Pockets: 8 bits of scrap count 8; with the card, 10 (+25%).
const scrapDrop = `for i = 1, 8 do nova.spawn('scrap', nova.named('runner').x, nova.named('runner').y - 6, {}) end`;
out("card_deep_pockets", {
  start_scene: "test_lab",
  lua: labPlace(300, 420),
  route: [
    { lua: scrapDrop }, { wait: 30 }, { lua: `BASE = ${J}.scrap; ${give("deep_pockets")}` },
    { lua: scrapDrop }, { wait: 30 }, { lua: `WITH = ${J}.scrap - BASE; LEFT = nova.count('scrap'); MULT = ${RUN}.mods.scrap` },
  ],
  print: ["BASE", "WITH", "LEFT", "MULT"],
});

// The offers: the same seed gives the same cards, another seed other cards, never the same card twice in an offer, never past a
// card's maximum, and over many seeds every card of the pool turns up.
out("offers", {
  start_scene: "test_lab",
  lua: `local R = ${RUN}
local function ids(t) return table.concat(t, ',') end
R.begin(1234); A1 = ids(R.offer(3)); A2 = ids(R.offer(3))
R.begin(1234); B1 = ids(R.offer(3)); B2 = ids(R.offer(3))
R.begin(99); C1 = ids(R.offer(3))
R.begin(4321); D1 = ids(R.offer(3))
DISTINCT = true
local seen = {}
for s = 1, 60 do
  R.begin(s)
  local o = R.offer(3)
  if o[1] == o[2] or o[1] == o[3] or o[2] == o[3] or #o ~= 3 then DISTINCT = false end
  for _, id in ipairs(o) do seen[id] = true end
end
POOL_SEEN = 0
for _ in pairs(seen) do POOL_SEEN = POOL_SEEN + 1 end
-- a card held 3 times (its maximum) is never offered again
R.begin(7)
for i = 1, 3 do R.add_card('long_reach') end
HELD = R.count('long_reach'); EXTRA = tostring(R.add_card('long_reach'))
MAXED_OFFERED = false
for k = 1, 80 do for _, id in ipairs(R.offer(3)) do if id == 'long_reach' then MAXED_OFFERED = true end end end
R.begin(1)`,
  route: [{ wait: 2 }],
  print: ["A1", "A2", "B1", "B2", "C1", "D1", "tostring(DISTINCT)", "POOL_SEEN", "HELD", "EXTRA", "tostring(MAXED_OFFERED)"],
});

// =====================================================================================================================
// The four new enemies, in the card lab.
// =====================================================================================================================
const ST = "require('lib.status')";

// ---- Bottle Thrower: tells 0.6 s, lobs a bottle at where the runner stood, the landing is marked while it flies, fire for 2 s that
// hurts anyone: a stunned Scrapper stands beside the runner and is burnt too.
out("thrower", {
  start_scene: "test_lab",
  lua: `${labPlace(500, 420)}; local t = nova.spawn('bottle_thrower', 800, 420); local s = nova.spawn('scrapper', 520, 430); s.hp = 30; ${ST}.stun(s, 9)`,
  route: [
    { until: "nova.first('bottle_thrower').state == 'tell'", max: 120, capture: "the tell" },
    { until: "nova.count('bottle') > 0", max: 80, capture: "thrown" },
    { wait: 25, capture: "in flight, the landing marked" },
    { until: "nova.count('fire') > 0", max: 80, capture: "landed" },
    { lua: "FIRE_SCALE = nova.first('fire').sx; nova.first('bottle_thrower'):take_hit(99, 0, 0, 0)" },   // (the thrower is put out of the picture: one fire to look at)
    { wait: 40, capture: "burning" },
    { until: "nova.count('fire') == 0", max: 200, capture: "burnt out" },
    { lua: "SCRAPPER_HP = nova.first('scrapper').hp; RUNNER_HP = nova.named('runner').hp" },
  ],
  print: ["SCRAPPER_HP", "RUNNER_HP", "FIRE_SCALE"],
});
// the thrower keeps its distance: the runner walks at it and it backs off (the gap stays near keep_min while it has room)
out("thrower_keeps_away", {
  start_scene: "test_lab",
  lua: `${labPlace(400, 560)}; local t = nova.spawn('bottle_thrower', 560, 560)`,
  route: [
    { wait: 2 }, { lua: "G0 = nova.first('bottle_thrower'):distance_to(nova.named('runner'))" },
    { wait: 30, capture: "backing away" },
    { lua: "G1 = nova.first('bottle_thrower'):distance_to(nova.named('runner')); ST1 = nova.first('bottle_thrower').state" },
  ],
  print: ["string.format('%.0f', G0)", "string.format('%.0f', G1)", "ST1"],
});

// ---- Rat-drone: rev-up tell 0.6 s with the lane drawn, a charge, a wall stops it: stunned 1 s and hurt by the crash.
const droneBase = (lane) => ({
  start_scene: "test_lab",
  lua: lane === "wall"
    ? `${labPlace(150, 600)}; local d = nova.spawn('rat_drone', 380, 600)`
    : `${labPlace(360, 830, "up")}; local d = nova.spawn('rat_drone', 360, 590)`,
  route: [
    { until: "nova.first('rat_drone').state == 'tell'", max: 60, capture: "rev-up: the lane" },
    { wait: 20, capture: "rev-up, later" },
    { until: "nova.first('rat_drone').state == 'charge'", max: 60, capture: "charge" },
    { until: "nova.first('rat_drone').state == 'stunned'", max: 90, capture: "hits the wall" },
    { lua: "HP_AT_CRASH = nova.first('rat_drone').hp; RUNNER_HP = nova.named('runner').hp; X_CRASH = nova.first('rat_drone').x; Y_CRASH = nova.first('rat_drone').y" },
    { wait: 30, capture: "stunned" },
    { until: "nova.first('rat_drone').state ~= 'stunned'", max: 90, capture: "recovers" },
    { lua: "CRASHES = nova.first('rat_drone').crashes; CHARGES = nova.first('rat_drone').charges" },
  ],
  print: ["HP_AT_CRASH", "RUNNER_HP", "string.format('%.0f', X_CRASH)", "string.format('%.0f', Y_CRASH)", "CRASHES", "CHARGES"],
});
out("drone_wall", droneBase("wall"));
out("drone_cover", droneBase("cover"));
// it hurts on contact only while charging: standing in it while it recovers and while it revs costs nothing; the charge costs 2
out("drone_contact", {
  start_scene: "test_lab",
  lua: `${labPlace(500, 420)}; local d = nova.spawn('rat_drone', 500, 420); d.state, d.t, d.dir_x, d.dir_y = 'recover', 0, 1, 0`,
  route: [
    { wait: 30 }, { lua: "HP_RECOVER = nova.named('runner').hp; local d = nova.first('rat_drone'); d.state, d.t = 'tell', 0" },
    { wait: 20 }, { lua: "HP_TELL = nova.named('runner').hp; REV_OVERLAP = tostring(nova.first('rat_drone'):overlaps(nova.named('runner')))" },
    { until: "nova.first('rat_drone').state == 'charge'", max: 40 }, { wait: 4 },
    { lua: "HP_CHARGE = nova.named('runner').hp" },
  ],
  print: ["HP_RECOVER", "HP_TELL", "REV_OVERLAP", "HP_CHARGE"],
});

// ---- Mimic Vendor: shut beyond 3 tiles (a shot still hurts it and does not wake it), flickers within 3 (tell 0.5 s), spits three cans.
out("mimic", {
  start_scene: "test_lab",
  lua: `${labPlace(600, 540)}; local m = nova.spawn('mimic_vendor', 900, 540); M_X, M_Y = m.x, m.y`,
  route: [
    { wait: 60 }, { lua: "FAR_STATE = nova.first('mimic_vendor').state; FAR_DIST = nova.first('mimic_vendor'):distance_to(nova.named('runner'))" },
    { hold: ["ranged"], frames: 6 }, { wait: 40, capture: "shot from afar" },
    { lua: "SHOT_HP = nova.first('mimic_vendor').hp; SHOT_STATE = nova.first('mimic_vendor').state" },
    { hold: ["right"], until: "nova.first('mimic_vendor'):distance_to(nova.named('runner')) < 152", max: 200 },
    { lua: "EDGE_STATE = nova.first('mimic_vendor').state; EDGE_DIST = nova.first('mimic_vendor'):distance_to(nova.named('runner'))" },
    { hold: ["right"], until: "nova.first('mimic_vendor').state == 'flicker'", max: 60, capture: "flicker: the lanes" },
    { hold: ["right"], until: "nova.first('mimic_vendor'):distance_to(nova.named('runner')) < 88", max: 40 },
    { press: "attack" }, { until: "nova.named('runner').stats.baton_hits == 1", max: 30, capture: "baton while it flickers" },
    { lua: "BATON_HP = nova.first('mimic_vendor').hp; BATON_STATE = nova.first('mimic_vendor').state" },
    { until: "nova.count('can') >= 3", max: 60, capture: "cans" },
    { lua: "local a = {}; for _, c in ipairs(nova.all('can')) do a[#a+1] = string.format('%.2f,%.2f', c.dx, c.dy) end; table.sort(a); CANS = table.concat(a, ' '); NCANS = #a; M_MOVED = string.format('%.1f', math.abs(nova.first('mimic_vendor').x - M_X) + math.abs(nova.first('mimic_vendor').y - M_Y))" },
    { wait: 40, capture: "recovering" },
  ],
  print: ["FAR_STATE", "string.format('%.0f', FAR_DIST)", "SHOT_HP", "SHOT_STATE", "EDGE_STATE", "string.format('%.0f', EDGE_DIST)", "BATON_HP", "BATON_STATE", "NCANS", "CANS", "M_MOVED"],
});
// the cans fly along their lanes and hurt the runner
out("mimic_cans_hurt", {
  start_scene: "test_lab",
  lua: `${labPlace(780, 540, "left")}; local m = nova.spawn('mimic_vendor', 900, 540)`,
  route: [
    { until: "nova.first('mimic_vendor').state == 'spit'", max: 80 },
    { wait: 40, capture: "cans in flight" },
    { lua: "RUNNER_HP = nova.named('runner').hp" },
  ],
  print: ["RUNNER_HP"],
});

// ---- Tout: everything within 5 tiles walks 30% faster; one hit switches it off for good and the speed goes back.
out("tout", {
  start_scene: "test_lab",
  lua: `${labPlace(520, 540, "right")}; local s = nova.spawn('scrapper', 900, 540); s.hp = 99; local f = nova.spawn('scrapper', 1300, 140); f.hp = 99`,
  route: [
    { wait: 3 }, { lua: "S = nova.all('scrapper')[1]; X0 = S.x" }, { wait: 40 }, { lua: "A = X0 - S.x; ST_A = S.state" },
    { lua: "TOUT = nova.spawn('tout', S.x + 60, S.y + 90)" }, { wait: 4 },
    { lua: "X0 = S.x; BUFF_NEAR = tostring((S.buff_t or 0) > 0); BUFF_FAR = tostring((nova.all('scrapper')[2].buff_t or 0) > 0)" }, { wait: 40, capture: "buffed: the mark over its head" },
    { lua: "B = X0 - S.x; ST_B = S.state; TOUT_HP_HIT = tostring(TOUT:take_hit(1, 1, 0, 0)); TOUT_ALIVE = tostring(TOUT:is_alive())" }, { wait: 6 },
    { lua: "X0 = S.x; BUFF_AFTER = tostring((S.buff_t or 0) > 0)" }, { wait: 40, capture: "back to normal" },
    { lua: "C = X0 - S.x; ST_C = S.state" },
  ],
  print: ["string.format('%.2f', A)", "string.format('%.2f', B)", "string.format('%.2f', C)", "string.format('%.3f', B / A)", "string.format('%.3f', C / A)", "ST_A", "ST_B", "ST_C", "BUFF_NEAR", "BUFF_FAR", "BUFF_AFTER", "TOUT_HP_HIT", "TOUT_ALIVE"],
});
// a real shot switches it off
out("tout_shot", {
  start_scene: "test_lab",
  lua: `${labPlace(300, 540, "right")}; local t = nova.spawn('tout', 700, 540)`,
  route: [
    { wait: 70, capture: "it shouts" },
    { hold: ["ranged"], frames: 6 }, { wait: 45, capture: "switched off" },
    { lua: "ALIVE = nova.count('tout'); LEFT = nova.count('enemy')" },
  ],
  print: ["ALIVE", "LEFT"],
});
// no enemy's tell is under 0.4 s (the numbers in data/enemies.lua)
out("tells", {
  start_scene: "test_lab",
  route: [{ wait: 2 }],
  print: ["require('data.enemies').scrapper.tell", "require('data.enemies').bottle_thrower.tell", "require('data.enemies').rat_drone.tell", "require('data.enemies').mimic_vendor.tell", "require('data.enemies').tout.pulse_tell"],
});

// =====================================================================================================================
// Rooms that play (scenes/market_a, market_b; lib/fightroom.lua; data/waves.lua)
// =====================================================================================================================
const doorsLua = "function DOORS() return nova.named('door_w').state .. ',' .. nova.named('door_e').state end";
const kindsLua = "function KINDS() local a = {}; for _, e in ipairs(nova.all('enemy')) do a[#a+1] = e.kind_name end; table.sort(a); return table.concat(a, ',') end";
const killAll = "for _, e in ipairs(nova.all('enemy')) do e:take_hit(99, 0, 0, 0) end";
const R0 = "nova.named('runner')";

// ---- room A from the doors shutting to the exit door: waves in order, the doors shut while it is fought, the room pays, three
// cards rise, one is taken, the door opens. (The enemies are knocked out by lua so the route is about the room; the fights
// themselves are in the routes above and in "slice".)
out("room_flow", {
  start_scene: "market_a",
  lua: doorsLua + "\n" + kindsLua + "\nD_START = DOORS()",
  route: [
    { wait: 40 }, { lua: "D_SHUT = DOORS(); SCRAP_START = " + J + ".scrap" },
    // the runner cannot walk through a shut door
    { lua: `${R0}.x, ${R0}.y = 1830, 576` }, { hold: ["right"], frames: 40, capture: "the shut door holds" },
    { lua: `PUSH_X = ${R0}.x; PUSH_SCENE = nova.current_scene(); ${R0}.x, ${R0}.y = 264, 552` },
    // wave 1
    { until: "nova.count('enemy') >= 2", max: 300 }, { wait: 2, capture: "wave 1" }, { lua: "W1 = KINDS(); D_WAVE1 = DOORS()" }, { lua: killAll },
    // wave 2: it warns only after the first is dead
    { until: "nova.count('warn') > 0", max: 200 }, { lua: "W2_ENEMIES_AT_WARN = nova.count('enemy')" }, { wait: 10, capture: "wave 2 warns" },
    { until: "nova.count('enemy') >= 2", max: 200 }, { lua: "W2 = KINDS()" }, { lua: killAll },
    // wave 3
    { until: "nova.count('warn') > 0", max: 200 }, { lua: "W3_ENEMIES_AT_WARN = nova.count('enemy')" },
    { until: "nova.count('enemy') >= 4", max: 200 }, { lua: "W3 = KINDS()" }, { lua: killAll },
    // cleared
    { until: "nova.scene_now().state == 'cleared'", max: 200 }, { wait: 4, capture: "cleared" },
    { lua: `D_CLEARED = DOORS(); PAID = nova.scene_now().paid; SCRAP_CLEARED = ${J}.scrap; WAVES_DONE = nova.scene_now().wave_i` },
    { until: "nova.count('card') == 3", max: 200 }, { wait: 12, capture: "the cards rise" }, { wait: 40, capture: "the cards" },
    { lua: "local ids = {}; local seen = {}; local n = 0; for _, c in ipairs(nova.all('card')) do ids[#ids+1] = c.card_id; if not seen[c.card_id] then seen[c.card_id] = true; n = n + 1 end end; table.sort(ids); CARD_IDS = table.concat(ids, ','); CARDS_DIFFERENT = n; CARD_STATE = nova.scene_now().state" },
    // the exit door stays down until a card is taken
    { lua: `${R0}.x, ${R0}.y = 1830, 576` }, { hold: ["right"], frames: 40 },
    { lua: `NOTYET_X = ${R0}.x; NOTYET_SCENE = nova.current_scene(); D_BEFORE_TAKE = DOORS()` },
    // stand by the first card: its text; take it with A
    { lua: `local c = nova.all('card')[1]; TAKEN_ID = c.card_id; ${R0}.x, ${R0}.y = c.x, c.y + 24` }, { wait: 5, capture: "by a card: its text" },
    { lua: `NEAR_ID = nova.scene_now().near_card and nova.scene_now().near_card.card_id or 'none'` },
    { press: "interact" }, { wait: 6, capture: "taken" },
    { lua: `D_AFTER_TAKE = DOORS(); HELD = table.concat(${RUN}.cards, ','); SCENE_STATE = nova.scene_now().state` },
    { wait: 40, capture: "the others sank" }, { lua: "CARDS_LEFT = nova.count('card')" },
    { walk_to: "door_e", who: "runner", max: 600 }, { wait: 2 },
    { lua: "END_SCENE = nova.current_scene()" },
  ],
  print: ["D_START", "D_SHUT", "PUSH_X", "PUSH_SCENE", "W1", "D_WAVE1", "W2_ENEMIES_AT_WARN", "W2", "W3_ENEMIES_AT_WARN", "W3", "D_CLEARED", "PAID", "SCRAP_START", "SCRAP_CLEARED", "WAVES_DONE",
    "CARD_IDS", "CARDS_DIFFERENT", "CARD_STATE", "NOTYET_X", "NOTYET_SCENE", "D_BEFORE_TAKE", "TAKEN_ID", "NEAR_ID", "D_AFTER_TAKE", "HELD", "CARDS_LEFT", "END_SCENE"],
});

// ---- health, charge, scrap and cards carry from room A into room B: a state that is not the default, through the real clear, rise, take and door.
out("carry", {
  start_scene: "market_a",
  lua: `local r = ${R0}; ${RUN}.begin(1234); r.hp = 7; r.charge = 1.5; ${J}.scrap = 44
${RUN}.add_card('long_reach', r); ${RUN}.add_card('capacitor', r)   -- (a card that changes the maximums too)
local S = nova.scene_now(); S.state = 'fight'; S.wave_i = #S.def.waves; S.countdown = nil   -- (the fight is won: the room clears itself)`,
  route: [
    { until: "nova.scene_now().state == 'cards'", max: 200 }, { wait: 40 },
    { lua: `local c = nova.all('card')[1]; ${R0}.x, ${R0}.y = c.x, c.y + 24` }, { wait: 5 },
    { press: "interact" }, { wait: 10 },
    { lua: `A_HP = ${R0}.hp; A_CHARGE = string.format('%.2f', ${R0}.charge); A_SCRAP = ${J}.scrap; A_CARDS = table.concat(${RUN}.cards, ','); A_MAXHP = ${R0}.max_hp; A_MAXCH = ${R0}.max_charge` },
    { walk_to: "door_e", who: "runner", max: 600 }, { wait: 3, capture: "room B" },
    { lua: `B_SCENE = nova.current_scene(); B_HP = ${R0}.hp; B_CHARGE = string.format('%.2f', ${R0}.charge); B_SCRAP = ${J}.scrap; B_CARDS = table.concat(${RUN}.cards, ','); B_MAXHP = ${R0}.max_hp; B_MAXCH = ${R0}.max_charge; B_REACH = ${RUN}.mods.reach` },
  ],
  print: ["A_HP", "A_CHARGE", "A_SCRAP", "A_CARDS", "A_MAXHP", "A_MAXCH", "B_SCENE", "B_HP", "B_CHARGE", "B_SCRAP", "B_CARDS", "B_MAXHP", "B_MAXCH", "B_REACH"],
});

// ---- Start pauses and shows the cards held; nothing moves while it is up
out("pause", {
  start_scene: "market_a",
  lua: `${RUN}.begin(5); ${RUN}.add_card('plating', ${R0}); ${RUN}.add_card('long_reach', ${R0}); ${RUN}.add_card('long_reach', ${R0}); ${RUN}.add_card('hot_solder', ${R0})`,
  route: [
    { wait: 30 }, { lua: `X0 = ${R0}.x` },
    { press: "start" }, { wait: 4, capture: "paused: the cards held" },
    { lua: "PAUSED = tostring(nova.scene_now().paused)" },
    { lua: "CD0 = nova.scene_now().countdown; T0 = nova.scene_now().t" }, { wait: 30, capture: "still paused" },
    { lua: "CD1 = nova.scene_now().countdown; T1 = nova.scene_now().t" },
    { press: "start" }, { wait: 2 }, { lua: "PAUSED_AFTER = tostring(nova.scene_now().paused)" },
    { hold: ["right"], frames: 20 }, { lua: `MOVED_FREE = ${R0}.x - X0` },
  ],
  print: ["PAUSED", "string.format('%.3f', CD0)", "string.format('%.3f', CD1)", "string.format('%.3f', T0)", "string.format('%.3f', T1)", "PAUSED_AFTER", "string.format('%.1f', MOVED_FREE)", "#" + RUN + ".cards"],
});

// ---- the whole slice: clear room A with the test player (fight, walk_to), take a card, go through the door, clear room B, take a card,
// go through its door to the banner. `invincible: true` (the test player is not good at dodging bottles): the room logic, the
// waves and the doors are what this proves, not the fighting (that is above).
const clearRoom = { repeat: 150, until: "nova.scene_now().state == 'cards'", steps: [
  { until: "nova.count('enemy') > 0 or nova.scene_now().state == 'cards'", max: 60, may_time_out: true },
  { fight: "enemy", attack: "attack", max: 1200, may_time_out: true },
  { wait: 4 },
] };
out("slice", {
  start_scene: "market_a",
  invincible: true,
  route: [
    clearRoom, { wait: 30, capture: "A: cleared, the cards" },
    { lua: `A_DOORS = nova.named('door_w').state .. ',' .. nova.named('door_e').state; A_PAID = nova.scene_now().paid; A_WAVES = nova.scene_now().wave_i; A_SCRAP = ${J}.scrap; A_OFFER = nova.scene_now().state` },
    { walk_to: "card", who: "runner", max: 600 }, { press: "interact" }, { wait: 8, capture: "A: a card taken" },
    { lua: `A_CARDS = table.concat(${RUN}.cards, ','); A_HP = nova.named('runner').hp; A_SCRAP_EXIT = ${J}.scrap; A_EXIT_DOOR = nova.named('door_e').state` },
    { walk_to: "door_e", who: "runner", max: 900 }, { wait: 3, capture: "B: the long street" },
    { lua: `B_SCENE = nova.current_scene(); B_CARDS = table.concat(${RUN}.cards, ','); B_SCRAP_ENTER = ${J}.scrap` },
    clearRoom, { wait: 30, capture: "B: cleared" },
    { lua: `B_PAID = nova.scene_now().paid; B_WAVES = nova.scene_now().wave_i; B_DOORS = nova.named('door_w').state .. ',' .. nova.named('door_e').state` },
    { walk_to: "card", who: "runner", max: 600 }, { press: "interact" }, { wait: 8 },
    { walk_to: [2010, 528], who: "runner", max: 900 }, { hold: ["right"], until: "nova.current_scene() == 'slice_end'", max: 120 }, { wait: 20, capture: "the end banner" },
    { lua: `END_SCENE = nova.current_scene(); END_CARDS = #${RUN}.cards; END_SCRAP = ${J}.scrap` },
  ],
  print: ["A_DOORS", "A_PAID", "A_WAVES", "A_SCRAP", "A_OFFER", "A_CARDS", "A_HP", "A_SCRAP_EXIT", "A_EXIT_DOOR", "B_SCENE", "B_CARDS", "B_SCRAP_ENTER", "B_PAID", "B_WAVES", "B_DOORS", "END_SCENE", "END_CARDS", "END_SCRAP"],
});

// =====================================================================================================================
// Pictures to look at (the tool saves each frame under build/look_*: `out`)
// =====================================================================================================================
const withLook = (name, plan, extra) => out(name, { ...plan, ...extra });
const look = (n) => ({ out: `build/look_${n}`, columns: 3 });
{
  const base = JSON.parse(fs.readFileSync(`${dir}/r_thrower.json`, "utf8"));
  withLook("look_thrower", { ...base, route: [
    { wait: 6, capture: "tell begins" }, { until: "nova.first('bottle_thrower').state == 'tell'", max: 5 }, { wait: 16, capture: "tell, arm up" },
    { until: "nova.count('bottle') > 0", max: 80, capture: "thrown" }, { wait: 22, capture: "flying, the landing marked" }, { wait: 22, capture: "about to land" },
    { until: "nova.count('fire') > 0", max: 80, capture: "landed: fire" }, { lua: "nova.first('bottle_thrower'):take_hit(99, 0, 0, 0)" }, { wait: 30, capture: "burning" },
  ] }, { ...look("thrower"), zoom: 2, crop: [330, 120, 480, 250] });
  for (const lane of ["wall"]) {
    const b = JSON.parse(fs.readFileSync(`${dir}/r_drone_${lane}.json`, "utf8"));
    withLook("look_drone", { ...b, route: [
      { wait: 4, capture: "rev-up begins: the lane" }, { wait: 14, capture: "rev-up" }, { wait: 14, capture: "rev-up, late" },
      { until: "nova.first('rat_drone').state == 'charge'", max: 60 }, { wait: 6, capture: "charge" }, { wait: 14, capture: "charging" },
      { until: "nova.first('rat_drone').state == 'stunned'", max: 90, capture: "meets the wall" }, { wait: 20, capture: "stunned" }, { wait: 30, capture: "recovering" },
    ] }, { ...look("drone"), zoom: 2, crop: [20, 140, 440, 300] });
  }
  const m = JSON.parse(fs.readFileSync(`${dir}/r_mimic.json`, "utf8"));
  withLook("look_mimic", { ...m, route: [
    { wait: 20, capture: "shut: a vending machine" },
    { hold: ["right"], until: "nova.first('mimic_vendor'):distance_to(nova.named('runner')) < 200", max: 200, capture: "3 tiles and a bit: still shut" },
    { hold: ["right"], until: "nova.first('mimic_vendor').state == 'flicker'", max: 60 }, { wait: 5, capture: "flicker: the three lanes" }, { wait: 10, capture: "flicker" },
    { until: "nova.first('mimic_vendor').state == 'spit'", max: 60 }, { wait: 3, capture: "spits" }, { wait: 10, capture: "cans" }, { wait: 12, capture: "cans, later" },
  ] }, { ...look("mimic"), zoom: 2, crop_to: "mimic_vendor", crop_margin: 130 });
  const t = JSON.parse(fs.readFileSync(`${dir}/r_tout.json`, "utf8"));
  withLook("look_tout", { ...t, route: [
    { wait: 3 }, { lua: "TOUT = nova.spawn('tout', nova.all('scrapper')[1].x + 60, nova.all('scrapper')[1].y + 90)" },
    { until: "nova.first('tout').state == 'shout'", max: 120 }, { wait: 3, capture: "the tout shouts: a ring" }, { wait: 14, capture: "ring spreads" }, { wait: 14, capture: "scrapper buffed: a mark" },
    { lua: "TOUT:take_hit(1, 1, 0, 0)" }, { wait: 4, capture: "switched off" }, { wait: 14, capture: "mark gone" },
  ], print: [] }, { ...look("tout"), zoom: 1, crop_to: "scrapper", crop_margin: 280 });
  withLook("look_wave", { start_scene: "market_a", invincible: true, route: [
    { lua: `${R0}.x, ${R0}.y = 420, 330` }, { until: "nova.count('warn') > 0", max: 200 }, { wait: 6, capture: "the warning marks" }, { wait: 30, capture: "closing in" },
    { until: "nova.count('enemy') >= 2", max: 100, capture: "they step out" }, { wait: 8, capture: "wave 1 here" },
    { lua: "for _, e in ipairs(nova.all('enemy')) do e:take_hit(99, 0, 0, 0) end" }, { until: "nova.count('warn') > 0", max: 200 }, { wait: 12, capture: "wave 2 warns: two points" },
  ] }, { ...look("wave"), columns: 3 });
  withLook("look_doors", { start_scene: "market_a", invincible: true,
    lua: `${R0}.x, ${R0}.y = 1700, 576`,
    route: [
      { wait: 8, capture: "open, before the fight" }, { wait: 24, capture: "shut" },
      { lua: "local S = nova.scene_now(); S.state = 'fight'; S.wave_i = #S.def.waves; S.countdown = nil" }, { wait: 6, capture: "unlocked: cyan light, bars still down" },
      { until: "nova.count('card') == 3", max: 200 }, { wait: 30 }, { lua: `local c = nova.all('card')[1]; ${R0}.x, ${R0}.y = c.x, c.y + 24` }, { wait: 4 }, { press: "interact" }, { wait: 3, capture: "card taken: the door opens" },
      { lua: `${R0}.x, ${R0}.y = 1700, 576` }, { wait: 20, capture: "open" },
    ] }, { ...look("doors"), zoom: 2, crop_to: "door_e", crop_margin: 120 });
  withLook("look_cards", { start_scene: "market_a", invincible: true,
    lua: `local S = nova.scene_now(); S.state = 'fight'; S.wave_i = #S.def.waves; S.countdown = nil; ${RUN}.begin(2026); S.state = 'fight'; ${R0}.x, ${R0}.y = 984, 700`,
    route: [
      { until: "nova.scene_now().state == 'cleared'", max: 50 }, { wait: 4, capture: "cleared: the banner" },
      { until: "nova.count('card') == 3", max: 200 }, { wait: 6, capture: "rising" }, { wait: 10, capture: "rising, further" }, { wait: 24, capture: "risen" },
      { lua: `${R0}.x, ${R0}.y = 984, 640` }, { wait: 4, capture: "by the middle card: its text" },
      { lua: `${R0}.x, ${R0}.y = 852, 640` }, { wait: 4, capture: "by the left card" },
      { lua: `${R0}.x, ${R0}.y = 1116, 640` }, { wait: 4, capture: "by the right card" },
    ] }, { ...look("cards"), columns: 3 });
  withLook("look_pause", { start_scene: "market_a",
    lua: `${RUN}.begin(5); for _, id in ipairs({'plating','long_reach','long_reach','hot_solder','scatter','second_wind','deep_pockets'}) do ${RUN}.add_card(id, ${R0}) end`,
    route: [{ wait: 20 }, { press: "start" }, { wait: 4, capture: "paused: the cards held" }] }, look("pause"));
  withLook("look_end", { start_scene: "slice_end", route: [{ wait: 70, capture: "the banner" }] }, look("end"));
}

// ---- dying in a fight room ends the run: the first room again, health and cards back to the start
out("die_in_room", {
  start_scene: "market_b",
  lua: `${RUN}.begin(77); ${RUN}.add_card('plating', ${R0}); ${R0}.hp = 1`,
  route: [
    { wait: 10 }, { lua: `HP_BEFORE = ${R0}.hp; MAX_BEFORE = ${R0}.max_hp; ${R0}:take_damage(2); STATE = ${R0}.state` },
    { wait: 40, capture: "printed again" },
    { until: "nova.current_scene() == 'market_a' and nova.named('runner') ~= nil", max: 120 }, { wait: 5, capture: "back at the start" },
    { lua: `HP_AFTER = ${R0}.hp; MAX_AFTER = ${R0}.max_hp; CARDS_AFTER = #${RUN}.cards; SCENE = nova.current_scene()` },
  ],
  print: ["HP_BEFORE", "MAX_BEFORE", "STATE", "SCENE", "HP_AFTER", "MAX_AFTER", "CARDS_AFTER"],
});
