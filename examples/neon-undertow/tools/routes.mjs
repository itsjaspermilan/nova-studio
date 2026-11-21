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

// =====================================================================================================================
// SLICE 3a: a run of the Gutter Market (lib/run.lua chain, lib/elite.lua, entities/barrel, sign, puddle, tram, stranger, counter...)
// =====================================================================================================================
const STATUS = "require('lib.status')";
const ELITE = "require('lib.elite')";
const META = "require('lib.meta')";
const SHOP = "require('lib.shop')";
const TALK = "require('lib.talk')";
const hold1 = (s) => `local ST = ${STATUS}; ${s}`;
// a stunned scrapper with lots of health: a target that stands still
const stillScrapper = (v, x, y, hp = 30) => `${v} = nova.spawn('scrapper', ${x}, ${y}); ${v}.hp = ${hp}; ${STATUS}.stun(${v}, 99)`;

// ---- the chain: the same seed builds the same eight rooms, another seed other rooms, and over many seeds every layout is used
out("chain_seeds", {
  start_scene: "test_lab",
  lua: `local R = ${RUN}
local function ch(seed) local c = R.build_chain(seed); local a = {}; for i, e in ipairs(c) do a[i] = e.scene .. '/' .. (e.table or 0) end; return table.concat(a, ' ') end
CH_A1 = ch(1234); CH_A2 = ch(1234); CH_B = ch(99); CH_C = ch(4321)
local c = R.build_chain(1234)
KINDS8 = ''; for i = 1, 9 do KINDS8 = KINDS8 .. c[i].kind .. (i < 9 and ',' or '') end
local L = require('data.layouts')
USED = {}; MARKS = {}; WHO = {}; TABLES = {}; ELITE_KINDS = {}
for s = 1, 300 do
  local cc = R.build_chain(s)
  for i = 1, 8 do USED[cc[i].scene] = true; TABLES[i .. ':' .. (cc[i].table or 0)] = true end
  MARKS[cc[4].mark] = true; WHO[cc[6].who] = true; ELITE_KINDS[cc[4].elite_kind] = true
end
local n, total = 0, 0
for i, slot in ipairs(L.slots) do for _, name in ipairs(slot.layouts) do total = total + 1; if USED[name] then n = n + 1 end end end
LAYOUTS_USED, LAYOUTS_TOTAL = n, total
local function count(t) local k = 0; for _ in pairs(t) do k = k + 1 end; return k end
MARKS_N, WHO_N, TABLES_N, EK_N = count(MARKS), count(WHO), count(TABLES), count(ELITE_KINDS)
-- every wave table's spawn points exist in every layout of its slot
local W = require('data.gutter_waves')
MISSING = 0
for i, tables in pairs(W) do
  for _, t in ipairs(tables) do
    for _, w in ipairs(t.waves) do for _, row in ipairs(w.rows) do
      for _, name in ipairs(L.slots[i].layouts) do
        local found = false
        for _, o in ipairs(nova.scene_data(name).objects) do if o.name == row.at then found = true end end
        if not found then MISSING = MISSING + 1; nova.log('missing ' .. row.at .. ' in ' .. name) end
      end
    end end
  end
end
R.begin(1)`,
  route: [{ wait: 2 }],
  print: ["CH_A1", "CH_A2", "CH_B", "CH_C", "KINDS8", "LAYOUTS_USED", "LAYOUTS_TOTAL", "MARKS_N", "WHO_N", "TABLES_N", "EK_N", "MISSING"],
});

// ---- the barrel: a hit lights a 1 s fuse, then a blast hurts everyone within 2 tiles (96): the runner 3, an enemy 6, a stall 6, a barrel lights its own fuse
const barrelPlan = (gap) => ({
  start_scene: "test_lab",
  lua: `${labPlace(700 - gap, 420)}
${stillScrapper("EN", 790, 420)}; ${stillScrapper("EF", 700, 530)}
SB = nova.spawn('stall', 700, 340, { tiles = 1, dir = 'h' })
B2 = nova.spawn('barrel', 760, 360)
B1 = nova.spawn('barrel', 700, 420)`,
  route: [
    { wait: 3 }, { lua: "B1:take_hit(1, 1, 0, 0)" }, { wait: 20, capture: "the fuse" },
    { until: "not B1:is_alive()", max: 100, capture: "the blast" }, { wait: 2 },
    { lua: `HP = ${R0}.hp; EN_HP = EN.hp; EF_HP = EF.hp; STALL_HP = SB.hp; B2_STATE = B2.state` },
    { until: "not B2:is_alive()", max: 100 },
  ],
  print: ["HP", "EN_HP", "EF_HP", "STALL_HP", "B2_STATE"],
});
out("barrel_inside", barrelPlan(90));
out("barrel_outside", barrelPlan(110));

// ---- the sign: a baton cannot drop it, a shot does; it makes every puddle touching it live for 4 s; standing in a live puddle costs 1 each second
out("sign_puddle", {
  start_scene: "test_lab",
  lua: `${labPlace(540, 300)}
SG = nova.spawn('sign', 600, 300)
P1 = nova.spawn('puddle', 700, 340)
P2 = nova.spawn('puddle', 1150, 340)
${stillScrapper("ES1", 700, 340)}; ${stillScrapper("ES2", 1150, 340)}`,
  route: [
    { wait: 3 }, { press: "attack" }, { wait: 24 },
    { lua: "BATON_STATE = SG.state; BATON_LIVE = P1.live_t" },
    { lua: `${R0}.x = 400; ${R0}.facing = 'right'` }, { wait: 4 },
    { hold: ["ranged"], frames: 6 }, { wait: 26, capture: "the sign is down" },
    { lua: `SHOT_STATE = SG.state; P1_LIVE = P1:is_live(); P2_LIVE = P2:is_live(); RUNNER_HP0 = ${R0}.hp; ${R0}.x, ${R0}.y = 700, 340` },
    { wait: 40, capture: "standing in a live puddle" },
    { wait: 230, capture: "dry again" },
    { lua: `P1_DRY = tostring(not P1:is_live()); RUNNER_HP = ${R0}.hp; ES1_HP = ES1.hp; ES2_HP = ES2.hp; P2_AFTER = tostring(P2:is_live())` },
    { wait: 90 }, { lua: `RUNNER_HP_LATER = ${R0}.hp` },
  ],
  print: ["BATON_STATE", "BATON_LIVE", "SHOT_STATE", "tostring(P1_LIVE)", "tostring(P2_LIVE)", "RUNNER_HP0", "RUNNER_HP", "ES1_HP", "ES2_HP", "P1_DRY", "P2_AFTER", "RUNNER_HP_LATER"],
});

// ---- the tram: a bell and a flashing rail 1.5 s ahead, then it flattens what is on the rail for 6, enemies too
out("tram", {
  start_scene: "test_lab",
  lua: `${labPlace(300, 300)}
TR = nova.spawn('tram', 48, 540, { dir = 'h', span = 1344, phase = 10 })
${stillScrapper("E1", 700, 540)}; ${stillScrapper("E2", 700, 700)}`,
  route: [
    { until: "TR.state == 'warn'", max: 100 }, { wait: 40, capture: "the rail flashes" },
    { until: "TR.state == 'cross'", max: 100 }, { wait: 14, capture: "the tram crosses" },
    { until: "TR.state == 'idle'", max: 200, capture: "across" },
    { lua: `E1_HP = E1.hp; E2_HP = E2.hp; RUNNER_HP_A = ${R0}.hp; ${R0}.x, ${R0}.y = 900, 540; TR.c = 11.0` },
    { until: "TR.state == 'cross'", max: 120 }, { wait: 10 },
    { until: "TR.state == 'idle'", max: 200 },
    { lua: `RUNNER_HP_B = ${R0}.hp; E1_HP_B = E1.hp; CROSSINGS = TR.crossings` },
  ],
  print: ["E1_HP", "E2_HP", "RUNNER_HP_A", "RUNNER_HP_B", "E1_HP_B", "CROSSINGS"],
});

// ---- the elite marks
out("elite_shielded", {
  start_scene: "test_lab",
  lua: `${labPlace(500, 540)}
${stillScrapper("E", 800, 540, 8)}; E.facing = 'left'; ${ELITE}.make(E, 'shielded'); BIG_SX = E.sx; BASE_SX = nova.spawn('scrapper', 100, 100).sx`,
  route: [
    { wait: 3 }, { lua: "HP0 = E.hp; SIZE = E.size_mult; MARK = E.elite" },
    { hold: ["ranged"], frames: 6 }, { wait: 40, capture: "a shot at its front" },
    { lua: "HP_FRONT = E.hp; BLOCKED = E.blocked or 0; E.facing = 'right'" },
    { hold: ["ranged"], frames: 6 }, { wait: 40, capture: "a shot at its back" },
    { lua: `HP_BACK = E.hp; E.facing = 'left'; ${R0}.x = 744` },
    { press: "attack" }, { wait: 30, capture: "the baton at its front" },
    { lua: "HP_BATON = E.hp" },
  ],
  print: ["HP0", "SIZE", "MARK", "string.format('%.1f', BIG_SX / BASE_SX)", "HP_FRONT", "BLOCKED", "HP_BACK", "HP_BATON"],
});
out("elite_splitting", {
  start_scene: "test_lab",
  lua: `${labPlace(500, 540)}
${stillScrapper("E", 900, 540, 8)}; ${ELITE}.make(E, 'splitting')`,
  route: [
    { wait: 3 }, { lua: "HP0 = E.hp; E:take_hit(99, 0, 0, 0)" }, { wait: 4, capture: "two small ones" },
    { lua: `COUNT = nova.count('enemy'); local a = {}; for _, e in ipairs(nova.all('enemy')) do a[#a+1] = e.hp .. '/' .. string.format('%.1f', e.sx / 1.5) end; SMALL = table.concat(a, ' ')
for _, e in ipairs(nova.all('enemy')) do e:take_hit(99, 0, 0, 0) end` },
    { wait: 4 }, { lua: "COUNT2 = nova.count('enemy')" },
  ],
  print: ["HP0", "COUNT", "SMALL", "COUNT2"],
});
out("elite_magnetic", {
  start_scene: "test_lab",
  lua: `${labPlace(500, 600)}
${stillScrapper("C", 900, 540)}`,
  route: [
    { wait: 60 }, { lua: "CX = nova.named('runner').x" },
    { hold: ["ranged"], frames: 6 }, { wait: 60 },
    { lua: `CONTROL_HP = C.hp; CONTROL_MOVED = ${R0}.x - 500; C:destroy(); ${R0}.x, ${R0}.y = 500, 600; ${R0}.charge = 3
${stillScrapper("E", 900, 540, 8)}; ${ELITE}.make(E, 'magnetic')` },
    { wait: 60, capture: "pulled" }, { lua: `PULL_MOVED = ${R0}.x - 500; ${R0}.x, ${R0}.y = 500, 600` },
    { hold: ["ranged"], frames: 6 }, { wait: 6, capture: "the shot bends" }, { wait: 50 },
    { lua: "E_HP = E.hp" },
  ],
  print: ["CONTROL_HP", "string.format('%.1f', CONTROL_MOVED)", "string.format('%.1f', PULL_MOVED)", "E_HP"],
});
out("elite_volatile", {
  start_scene: "test_lab",
  lua: `${labPlace(620, 540)}
${stillScrapper("E", 700, 540, 8)}; ${ELITE}.make(E, 'volatile')
${stillScrapper("BY1", 780, 540)}; ${stillScrapper("BY2", 700, 650)}`,
  route: [
    { wait: 3 }, { lua: "E:take_hit(99, 0, 0, 0)" }, { wait: 30, capture: "the fuse" },
    { until: "nova.count('fuse') == 0", max: 100, capture: "the blast" }, { wait: 2 },
    { lua: `RUNNER_HP = ${R0}.hp; BY1_HP = BY1.hp; BY2_HP = BY2.hp` },
  ],
  print: ["RUNNER_HP", "BY1_HP", "BY2_HP"],
});
out("elite_linked", {
  start_scene: "test_lab",
  lua: `${labPlace(300, 300)}
${stillScrapper("E", 800, 540, 8)}; ${ELITE}.make(E, 'linked'); E.hp = 6
${stillScrapper("PA", 900, 540)}`,
  route: [
    { wait: 30 }, { lua: "H1 = E.hp; HAS_PARTNER = tostring(nova.first('elite_fx').partner ~= nil)" },
    { wait: 120, capture: "the link" }, { lua: "H2 = E.hp; PA:take_hit(99, 0, 0, 0)" },
    { wait: 4 }, { lua: "H3 = E.hp" }, { wait: 120 }, { lua: "H4 = E.hp" },
  ],
  print: ["H1", "tostring(HAS_PARTNER)", "H2", "H3", "H4"],
});

// ---- the offers: never two cards of one family in an offer unless the pool cannot fill it; a guaranteed rarity; a reroll
out("offers_rule", {
  start_scene: "test_lab",
  lua: `local R = ${RUN}; local C = require('data.cards')
local function fam(o) local f = {}; local n = 0; for _, id in ipairs(o) do if not f[C.by_id[id].family] then f[C.by_id[id].family] = true; n = n + 1 end end; return n end
SAME_FAMILY = 0; OFFERS = 0
for s = 1, 200 do
  R.begin(s)
  for k = 1, 4 do
    local o = R.offer(3); OFFERS = OFFERS + 1
    if fam(o) < #o then SAME_FAMILY = SAME_FAMILY + 1 end
    R.add_card(o[1])
  end
end
-- a pool that cannot fill it: only body cards left, then baton and body only
R.begin(5)
for _, c in ipairs(C.list) do if c.family ~= 'body' then R.counts[c.id] = c.max end end
ONLY_BODY = table.concat(R.offer(3), ',')
R.begin(5)
for _, c in ipairs(C.list) do if c.family ~= 'body' and c.family ~= 'baton' then R.counts[c.id] = c.max end end
BATON_BODY = R.offer(3); BATON_BODY_FAMILIES = fam(BATON_BODY); BATON_BODY_N = #BATON_BODY
-- the guarantee
R.begin(9); G_BAD = 0; G_SAME = 0
for s = 1, 200 do
  R.begin(s)
  local o = R.offer(3, { guarantee = 'uncommon' })
  local u = false
  for _, id in ipairs(o) do if C.by_id[id].rarity == 'uncommon' then u = true end end
  if not u then G_BAD = G_BAD + 1 end
  if fam(o) < #o then G_SAME = G_SAME + 1 end
end
UNCOMMON = {}; for _, c in ipairs(C.list) do if c.rarity == 'uncommon' and c.index <= 12 then UNCOMMON[#UNCOMMON + 1] = c.id end end
UNCOMMON = table.concat(UNCOMMON, ',')
-- a reroll draws the same offer number again with another salt
R.begin(77); R.offers = 4; PLAIN = table.concat(R.offer(3), ',')
R.begin(77); R.offers = 4; R.reroll_next = true; REROLLED = table.concat(R.offer(3), ','); FLAG_AFTER = tostring(R.reroll_next)
R.begin(1)`,
  route: [{ wait: 2 }],
  print: ["SAME_FAMILY", "OFFERS", "ONLY_BODY", "BATON_BODY_FAMILIES", "BATON_BODY_N", "G_BAD", "G_SAME", "UNCOMMON", "PLAIN", "REROLLED", "FLAG_AFTER"],
});

// ---- the strangers: Patch's three meetings (the lines advance, the choice works), Old Sal's truce
const seedFor = (who) => `for s = 1, 400 do if ${RUN}.build_chain(s)[6].who == '${who}' then SEED_${who.toUpperCase()} = s; break end end`;
const enterStranger = (seed, first) => ({ lua: `${first ? `${RUN}.begin_chain(${seed});` : ""} nova.goto_scene('gutter.stranger')` });
const toTalk = [
  { until: "nova.current_scene() == 'gutter.stranger' and nova.named('runner') ~= nil", max: 30 }, { wait: 3 },
  { walk_to: "stranger", who: "runner", max: 900 }, { press: "interact" }, { wait: 3 },
];
const talkOn = (choice) => [
  { repeat: 8, until: `${TALK}.stage == 'choice'`, steps: [{ press: "interact" }, { wait: 3 }] },
  ...(choice === 2 ? [{ hold: ["right"], frames: 4 }, { wait: 2 }] : [{ wait: 6 }]),
  { press: "interact" }, { wait: 4 },
];
const visit = (n, seedVar, first, choice, set) => [
  enterStranger(seedVar, first), ...toTalk,
  { lua: `V${n}_SET = ${TALK}.set; V${n}_LINE = ${TALK}.lines[1]; V${n}_MET = ${META}.met[${TALK}.who]; V${n}_WHO = ${TALK}.who; V${n}_STAGE0 = ${TALK}.stage` },
  { wait: 2, capture: `meeting ${n}: the first line` },
  ...talkOn(choice), { until: `not ${TALK}.active`, max: 60 }, { wait: 6, capture: `meeting ${n}: the choice made` },
  { lua: `V${n}_CHOSEN = ${TALK}.chosen.label; V${n}_MAXHP = ${R0}.max_hp; V${n}_HP = ${R0}.hp; V${n}_STAGE = ${TALK}.stage` },
];
out("stranger_patch", {
  start_scene: "test_lab",
  lua: `${META}.met.patch = 0; ${seedFor("patch")}`,
  route: [
    { lua: `SP = SEED_PATCH` },
    ...visit(1, "SP", true, 1),
    // saying goodbye after the choice is a line, not a new meeting
    { press: "interact" }, { wait: 3 }, { lua: `MET_AFTER_BYE = ${META}.met.patch; BYE_ACTIVE = tostring(${TALK}.active)` },
    // meeting 2 (the run goes on: health 5 of 14): heal to full
    { lua: `${R0}.hp = 5; ${RUN}.take_from(${R0})` },
    ...visit(2, "SP", false, 2),
    ...visit(3, "SP", false, 1),
    { lua: `MET_END = ${META}.met.patch` },
  ],
  print: ["SP", "V1_SET", "V1_LINE", "V1_MET", "V1_WHO", "V1_CHOSEN", "V1_MAXHP", "V1_HP", "V1_STAGE", "MET_AFTER_BYE", "BYE_ACTIVE",
    "V2_SET", "V2_LINE", "V2_MET", "V2_CHOSEN", "V2_MAXHP", "V2_HP", "V3_SET", "V3_LINE", "V3_MET", "V3_CHOSEN", "V3_MAXHP", "MET_END"],
});
out("stranger_sal", {
  start_scene: "test_lab",
  lua: `${META}.met.old_sal = 0; ${seedFor("old_sal")}`,
  route: [
    { lua: `SS = SEED_OLD_SAL` },
    ...visit(1, "SS", true, 1),
    ...visit(2, "SS", false, 2),
    ...visit(3, "SS", false, 2),
    { lua: `TRUCE = tostring(${RUN}.perks.truce); MET_END = ${META}.met.old_sal; nova.goto_scene('test_lab')` },
    { until: "nova.current_scene() == 'test_lab' and nova.named('runner') ~= nil", max: 30 }, { wait: 2 },
    { lua: `A0 = ${R0}.hp; ${R0}:take_damage(2); A1 = ${R0}.hp` }, { wait: 60 },
    { lua: `${R0}:take_damage(2); A2 = ${R0}.hp; nova.goto_scene('test_room')` },
    { until: "nova.current_scene() == 'test_room' and nova.named('runner') ~= nil", max: 30 }, { wait: 2 },
    { lua: `B0 = ${R0}.hp; ${R0}:take_damage(2); B1 = ${R0}.hp` }, { wait: 60 },
    { lua: `${R0}:take_damage(2); B2 = ${R0}.hp` },
  ],
  print: ["SS", "V1_SET", "V1_LINE", "V1_CHOSEN", "V2_SET", "V2_LINE", "V2_CHOSEN", "V3_SET", "V3_LINE", "V3_MET", "TRUCE", "MET_END", "A0", "A1", "A2", "B0", "B1", "B2"],
});

// ---- the shop and the bank: the sums
out("shop_sums", {
  start_scene: "test_lab",
  lua: `local R, S, J, M = ${RUN}, ${SHOP}, ${J}, ${META}
R.begin_chain(5); local r = nova.named('runner'); r.hp = 6; J.scrap = 100
local ok1, t1 = S.buy('heal', r); HEAL1 = tostring(ok1) .. ' ' .. J.scrap .. ' ' .. r.hp
local ok2 = S.buy('heal', r); r.hp = 12; local ok2b, t2b = S.buy('heal', r); HEAL_FULL = tostring(ok2b) .. ' ' .. J.scrap .. ' ' .. r.hp
r.hp = 11; S.buy('heal', r); HEAL_PART = J.scrap .. ' ' .. r.hp          -- 4 points for 20 even when only 1 fits
local ok3 = S.buy('reroll', r); REROLL1 = tostring(ok3) .. ' ' .. J.scrap .. ' ' .. tostring(R.reroll_next)
local ok4 = S.buy('reroll', r); REROLL2 = tostring(ok4) .. ' ' .. J.scrap
local ok5, t5 = S.buy('jinx', r); JINX = tostring(ok5) .. ' ' .. J.scrap .. ' ' .. t5
J.scrap = 10; local ok6 = S.buy('heal', r); r.hp = 3; local ok6b = S.buy('heal', r); POOR = tostring(ok6b) .. ' ' .. J.scrap
J.scrap = 83; M.keys = 0; local ok7, t7 = S.buy('bank', r); BANK1 = tostring(ok7) .. ' ' .. J.scrap .. ' ' .. M.keys .. ' ' .. R.banked .. ' ' .. t7
J.scrap = 3; local ok8, t8 = S.buy('bank', r); BANK2 = tostring(ok8) .. ' ' .. J.scrap .. ' ' .. M.keys .. ' ' .. t8
J.scrap = 100; local ok9 = S.buy('bank', r); BANK3 = J.scrap .. ' ' .. M.keys
R.begin(1)`,
  route: [{ wait: 2 }],
  print: ["HEAL1", "HEAL_FULL", "HEAL_PART", "REROLL1", "REROLL2", "JINX", "POOR", "BANK1", "BANK2", "BANK3"],
});
// ... and in the room: walk to the bank, the heal stall and the shut jinx stall, press interact
out("shop_room", {
  start_scene: "gutter.walk",
  route: [
    { wait: 5 }, { lua: `${J}.scrap = 83; ${META}.keys = 0` },
    { walk_to: "bank", who: "runner", max: 900 }, { wait: 2, capture: "at the bank" }, { press: "interact" }, { wait: 6, capture: "banked" },
    { lua: `BANK_SCRAP = ${J}.scrap; BANK_KEYS = ${META}.keys; BANKED = ${RUN}.banked; ${J}.scrap = 50; ${R0}.hp = 6` },
    { walk_to: "shop_heal", who: "runner", max: 900 }, { wait: 2, capture: "at the shop" }, { press: "interact" }, { wait: 6, capture: "healed" },
    { lua: `HEAL_SCRAP = ${J}.scrap; HEAL_HP = ${R0}.hp` },
    { walk_to: "shop_jinx", who: "runner", max: 900 }, { wait: 2 }, { press: "interact" }, { wait: 6, capture: "the shut stall" },
    { lua: `JINX_SCRAP = ${J}.scrap; JINX_TOAST = nova.scene_now().toast` },
  ],
  print: ["BANK_SCRAP", "BANK_KEYS", "BANKED", "HEAL_SCRAP", "HEAL_HP", "JINX_SCRAP", "JINX_TOAST"],
});

// ---- carry: health, charge, scrap and cards through real doors, rooms 1 to 4 (the third made a stranger's room): nothing is invincible here
out("carry_chain", {
  start_scene: "test_lab",
  lua: `local R = ${RUN}; R.begin_chain(1234); R.chain[3] = { index = 3, slot = 3, kind = 'stranger', scene = 'gutter.stranger', who = 'patch', layout = 1 }
nova.goto_scene(R.chain[1].scene)`,
  route: [
    { until: `nova.current_scene() == ${RUN}.chain[1].scene and nova.named('runner') ~= nil`, max: 30 }, { wait: 3 },
    { lua: `local r = ${R0}; r.hp = 7; r.charge = 1.5; ${J}.scrap = 44; ${RUN}.add_card('long_reach', r); ${RUN}.add_card('capacitor', r)
local S = nova.scene_now(); S.state = 'fight'; S.wave_i = #S.def.waves; S.countdown = nil` },
    { until: "nova.scene_now().state == 'cards'", max: 300 }, { wait: 40 },
    { lua: `local c = nova.all('card')[1]; ${R0}.x, ${R0}.y = c.x, c.y + 24` }, { wait: 5 }, { press: "interact" }, { wait: 10 },
    { lua: `A_HP = ${R0}.hp; A_CHARGE = string.format('%.2f', ${R0}.charge); A_SCRAP = ${J}.scrap; A_CARDS = #${RUN}.cards; A_MAXHP = ${R0}.max_hp; A_MAXCH = ${R0}.max_charge` },
    { walk_to: "door_out", who: "runner", max: 1200 }, { wait: 4 },
    { lua: `B_SCENE = nova.current_scene(); B_IS_2 = tostring(B_SCENE == ${RUN}.chain[2].scene); B_HP = ${R0}.hp; B_CHARGE = string.format('%.2f', ${R0}.charge); B_SCRAP = ${J}.scrap; B_CARDS = #${RUN}.cards; B_MAXHP = ${R0}.max_hp; B_MAXCH = ${R0}.max_charge
local S = nova.scene_now(); S.state = 'fight'; S.wave_i = #S.def.waves; S.countdown = nil` },
    { until: "nova.scene_now().state == 'cards'", max: 300 }, { wait: 40 },
    { lua: `local c = nova.all('card')[1]; ${R0}.x, ${R0}.y = c.x, c.y + 24` }, { wait: 5 }, { press: "interact" }, { wait: 10 },
    { lua: `B2_CARDS = #${RUN}.cards; B2_SCRAP = ${J}.scrap` },
    { walk_to: "door_out", who: "runner", max: 1200 }, { wait: 4 },
    { lua: `C_SCENE = nova.current_scene(); C_HP = ${R0}.hp; C_CHARGE = string.format('%.2f', ${R0}.charge); C_SCRAP = ${J}.scrap; C_CARDS = #${RUN}.cards; C_MAXHP = ${R0}.max_hp; C_STATE = nova.scene_now().state` },
    { walk_to: "door_out", who: "runner", max: 1200 }, { wait: 4 },
    { lua: `D_SCENE = nova.current_scene(); D_IS_ELITE = tostring(D_SCENE == ${RUN}.chain[4].scene); D_HP = ${R0}.hp; D_CHARGE = string.format('%.2f', ${R0}.charge); D_SCRAP = ${J}.scrap; D_CARDS = #${RUN}.cards; D_MAXHP = ${R0}.max_hp; D_ROOM = ${RUN}.room` },
  ],
  print: ["A_HP", "A_CHARGE", "A_SCRAP", "A_CARDS", "A_MAXHP", "A_MAXCH", "B_IS_2", "B_HP", "B_CHARGE", "B_SCRAP", "B_CARDS", "B_MAXHP", "B_MAXCH", "B2_CARDS", "B2_SCRAP",
    "C_SCENE", "C_HP", "C_CHARGE", "C_SCRAP", "C_CARDS", "C_MAXHP", "C_STATE", "D_IS_ELITE", "D_HP", "D_CHARGE", "D_SCRAP", "D_CARDS", "D_MAXHP", "D_ROOM"],
});

// ---- death anywhere ends the run at the summary; interact starts again at room 1 with a new seed and nothing held
out("death_summary", {
  start_scene: "test_lab",
  lua: `local R = ${RUN}; R.begin_chain(77); OLD_SEED = R.seed; R.room = 3; R.cleared = 3; nova.goto_scene(R.chain[4].scene)`,
  route: [
    { until: `nova.current_scene() == ${RUN}.chain[4].scene and nova.named('runner') ~= nil`, max: 30 }, { wait: 3 },
    { lua: `${RUN}.add_card('plating', ${R0}); ${RUN}.add_card('long_reach', ${R0}); ${RUN}.banked = 5; ${R0}.hp = 1` },
    { wait: 30 }, { lua: `${R0}:take_damage(2); DEAD_STATE = ${R0}.state` },
    { until: "nova.current_scene() == 'summary'", max: 200, capture: "the summary" },
    { lua: `local s = ${RUN}.summary; SUM = s.result .. ' ' .. s.cleared .. ' ' .. string.format('%.0f', s.time) .. ' ' .. s.keys .. ' ' .. s.cards; SUM_ACTIVE = tostring(${RUN}.active)` },
    { wait: 60 }, { press: "interact" },
    { until: `nova.current_scene() == ${RUN}.chain[1].scene and nova.named('runner') ~= nil`, max: 60 }, { wait: 5, capture: "room 1 again" },
    { lua: `NEW_SEED = ${RUN}.seed; SEED_CHANGED = tostring(NEW_SEED ~= OLD_SEED); ROOM_AFTER = ${RUN}.room; CARDS_AFTER = #${RUN}.cards; HP_AFTER = ${R0}.hp; MAX_AFTER = ${R0}.max_hp; SCRAP_AFTER = ${J}.scrap; FIRST = tostring(nova.current_scene() == ${RUN}.chain[1].scene)` },
  ],
  print: ["DEAD_STATE", "SUM", "SUM_ACTIVE", "SEED_CHANGED", "ROOM_AFTER", "CARDS_AFTER", "HP_AFTER", "MAX_AFTER", "SCRAP_AFTER", "FIRST"],
});

// ---- every layout starts, warns its first wave and spawns it (no missing spawn point, no warning): a quick look at each, with the invincible player

// ---- the whole run, room 1 to the summary, with the test player (invincible: this proves the rooms, the chain, the doors, the talk, the
// shop and the summary, not the fighting)
const clearRoom3a = { repeat: 200, until: "nova.scene_now().state == 'cards'", steps: [
  { until: "nova.count('enemy') > 0 or nova.scene_now().state == 'cards'", max: 80, may_time_out: true },
  { fight: "enemy", attack: "attack", max: 1500, may_time_out: true },
  { wait: 4 },
] };
const fightRoomSteps = (i) => [
  { lua: `ROOM${i} = nova.current_scene(); KIND${i} = ${RUN}.chain[${i}].kind` },
  clearRoom3a, { wait: 48, capture: `room ${i}: cleared, the cards risen` },
  { lua: `PAID${i} = nova.scene_now().paid; CARDS${i} = #${RUN}.cards` },
  { walk_to: "card", who: "runner", max: 900 }, { press: "interact" }, { wait: 8 },
  { lua: `CARDS${i}_AFTER = #${RUN}.cards; SCRAP${i} = ${J}.scrap` },
  { walk_to: "door_out", who: "runner", max: 1500 }, { wait: 4 },
];
const wholeRun = (seed) => ({
  start_scene: "run_start",
  seed,
  invincible: true,
  route: [
    { until: "nova.named('runner') ~= nil", max: 30 }, { wait: 2 },
    { lua: `CHAIN = ''; for i = 1, #${RUN}.chain do CHAIN = CHAIN .. ${RUN}.chain[i].scene .. (i < #${RUN}.chain and ' ' or '') end; RUN_SEED = ${RUN}.seed; MARK = ${RUN}.chain[4].mark; WHO = ${RUN}.chain[6].who` },
    ...[1, 2, 3, 4, 5].flatMap((i) => fightRoomSteps(i)),
    // 6: the stranger
    { lua: `ROOM6 = nova.current_scene(); KIND6 = ${RUN}.chain[6].kind; MET0 = ${META}.met[${RUN}.chain[6].who]` },
    { walk_to: "stranger", who: "runner", max: 900 }, { press: "interact" }, { wait: 3, capture: "a stranger's talk" },
    { repeat: 10, until: `${TALK}.stage == 'done'`, steps: [{ press: "interact" }, { wait: 3 }] }, { wait: 5, capture: "the choice made" },
    { lua: `TALKED = ${TALK}.chosen.label; MET1 = ${META}.met[${RUN}.chain[6].who]` },
    { walk_to: "door_out", who: "runner", max: 1500 }, { wait: 4 },
    ...fightRoomSteps(7),
    // 8: Mother Coil. (The test player is invincible here and these two routes prove the chain, not the fights: the boss is taken down with her
    // own `die`, the rare card is left on the floor and the door opened by hand, so the six-card count of slice 3a still holds. `boss_fair` is
    // the fight, played without invincibility; `full_run` takes the card and goes on to the Den.)
    { lua: `ROOM8 = nova.current_scene(); KIND8 = ${RUN}.chain[8].kind; WON0 = tostring(${RUN}.won)` }, { wait: 20, capture: "Mother Coil's arena" },
    { lua: "nova.named('coil'):die()" }, { until: "nova.scene_now().state == 'cards'", max: 600, capture: "she is down: the cards rise" }, { wait: 20 },
    { lua: "nova.scene_now().state = 'done'; for _, c in ipairs(nova.all('card')) do c:sink() end; for _, d in ipairs(nova.all('door')) do if d.exit then d:open() end end" },
    { walk_to: "door_out", who: "runner", max: 1500 }, { wait: 4 },
    // 9: the walk-through room: the bank
    { lua: `ROOM9 = nova.current_scene(); WON9 = tostring(${RUN}.won); SCRAP_BEFORE_BANK = ${J}.scrap; KEYS0 = ${META}.keys` },
    { walk_to: "bank", who: "runner", max: 900 }, { press: "interact" }, { wait: 6, capture: "the bank" },
    { lua: `KEYS1 = ${META}.keys; SCRAP_AFTER_BANK = ${J}.scrap` },
    // (the last door leads to a scene with no walker: walk beside it and push, as the slice-2 route did)
    { walk_to: [2010, 424], who: "runner", max: 1500 }, { hold: ["right"], until: "nova.current_scene() == 'summary'", max: 160 }, { wait: 40, capture: "the summary" },
    { lua: `local s = ${RUN}.summary; END_SCENE = nova.current_scene(); SUM = s.result .. ' ' .. s.cleared .. ' ' .. s.keys .. ' ' .. s.cards; SUM_TIME = string.format('%.0f', s.time)` },
  ],
  print: ["RUN_SEED", "CHAIN", "MARK", "WHO", "ROOM1", "ROOM2", "ROOM3", "ROOM4", "ROOM5", "ROOM6", "ROOM7", "ROOM8", "ROOM9", "KIND4", "KIND7", "PAID1", "PAID4", "PAID7", "CARDS1_AFTER", "CARDS4_AFTER", "CARDS5_AFTER", "CARDS7_AFTER",
    "MET0", "MET1", "TALKED", "WON0", "WON9", "SCRAP_BEFORE_BANK", "KEYS0", "KEYS1", "SCRAP_AFTER_BANK", "END_SCENE", "SUM", "SUM_TIME"],
});
out("run_a", wholeRun(3));
out("run_b", wholeRun(20));

// =====================================================================================================================
// Pictures to look at (slice 3a): each hazard, each elite mark, a stranger's talk, the shop (saved under build/look_*)
// =====================================================================================================================
{
  const base = (n) => JSON.parse(fs.readFileSync(`${dir}/r_${n}.json`, "utf8"));
  withLook("look_barrel", { ...base("barrel_inside"), route: [
    { wait: 3, capture: "a barrel, a stall, another barrel" }, { lua: "B1:take_hit(1, 1, 0, 0)" }, { wait: 6, capture: "the fuse is lit: the blast ring" }, { wait: 40, capture: "the fuse runs" },
    { until: "not B1:is_alive()", max: 100, capture: "the blast" }, { wait: 8, capture: "hurt" }, { wait: 50, capture: "the second barrel" },
  ] }, { ...look("barrel"), crop_to: "stall", crop_margin: 190 });
  withLook("look_sign", { ...base("sign_puddle"), route: [
    { wait: 3, capture: "a sign over a puddle, another puddle far off" },
    { lua: `${R0}.x = 400; ${R0}.facing = 'right'` }, { wait: 4 }, { hold: ["ranged", "right"], frames: 6 }, { wait: 6, capture: "the shot flies" }, { wait: 12, capture: "the sign is down" },
    { lua: `${R0}.x, ${R0}.y = 700, 340` }, { wait: 30, capture: "standing in the live puddle" }, { wait: 120, capture: "live" }, { wait: 140, capture: "dry again" },
  ] }, { ...look("sign"), crop_to: "sign", crop_margin: 330 });
  withLook("look_tram", { ...base("tram"), lua: base("tram").lua + `; ${R0}.x, ${R0}.y = 500, 400; nova.spawn('rail', 48, 540, { dir = 'h', span = 1344 })`, route: [
    { wait: 20, capture: "the rail" }, { until: "TR.state == 'warn'", max: 100 }, { wait: 6, capture: "the bell: the rail flashes" }, { wait: 50, capture: "still flashing" },
    { until: "TR.state == 'cross'", max: 100 }, { wait: 12, capture: "the tram comes in" }, { wait: 14, capture: "it flattens a scrapper on the rail" }, { wait: 30, capture: "it passes" },
  ] }, look("tram"));
  const pic = (n, caps) => ({ ...base(n), route: caps });
  withLook("look_elite_shielded", pic("elite_shielded", [{ wait: 3, capture: "the shield on its front" }, { hold: ["ranged"], frames: 6 }, { wait: 22, capture: "the shot is blocked" }, { lua: "E.facing = 'right'" }, { wait: 8, capture: "the shield turns away" }]),
    { ...look("elite_shielded"), crop_to: "elite_fx", crop_margin: 300 });
  withLook("look_elite_splitting", pic("elite_splitting", [{ wait: 3, capture: "a double-size scrapper" }, { lua: "E:take_hit(99, 0, 0, 0)" }, { wait: 4, capture: "two small ones" }, { wait: 20, capture: "they come" }]),
    { ...look("elite_splitting"), crop_to: "elite_fx", crop_margin: 250 });
  withLook("look_elite_magnetic", pic("elite_magnetic", [{ lua: `${R0}.x, ${R0}.y = 500, 600; ${R0}.charge = 3; ${stillScrapper("E", 900, 540, 8)}; ${ELITE}.make(E, 'magnetic')` }, { wait: 15, capture: "its pull rings" }, { hold: ["ranged"], frames: 6 }, { wait: 5, capture: "the shot leaves" }, { wait: 6, capture: "it bends" }, { wait: 8, capture: "it hits" }]),
    { ...look("elite_magnetic"), crop_to: "elite_fx", crop_margin: 420 });
  withLook("look_elite_volatile", pic("elite_volatile", [{ wait: 3, capture: "a double-size scrapper" }, { lua: "E:take_hit(99, 0, 0, 0)" }, { wait: 6, capture: "dead: the fuse is lit" }, { wait: 30, capture: "the ring flashes" }, { until: "nova.count('fuse') == 0", max: 100, capture: "the blast" }, { wait: 6, capture: "after" }]),
    { ...look("elite_volatile"), crop_to: "fuse", crop_margin: 220 });
  withLook("look_elite_linked", pic("elite_linked", [{ wait: 10, capture: "linking" }, { wait: 40, capture: "the line, healing" }, { wait: 60, capture: "healed" }, { lua: "PA:take_hit(99, 0, 0, 0)" }, { wait: 6, capture: "partner dead: the line is gone" }]),
    { ...look("elite_linked"), crop_to: "elite_fx", crop_margin: 280 });
  withLook("look_stranger", { start_scene: "test_lab", lua: `${META}.met.patch = 1; ${seedFor("patch")}`, route: [
    { lua: `${RUN}.begin_chain(SEED_PATCH); nova.goto_scene('gutter.stranger')` }, ...toTalk.slice(0, 2), { wait: 20, capture: "the stranger's room" },
    { walk_to: "stranger", who: "runner", max: 900 }, { wait: 3, capture: "by her: the prompt" }, { press: "interact" }, { wait: 3, capture: "a line" },
    { press: "interact" }, { wait: 3, capture: "the next" }, { press: "interact" }, { wait: 3 }, { press: "interact" }, { wait: 3, capture: "the choice" },
    { hold: ["right"], frames: 4 }, { wait: 3, capture: "the other choice" },
  ] }, look("stranger"));
  withLook("look_shop", { start_scene: "gutter.walk", route: [
    { wait: 10, capture: "the walk-through room" }, { lua: `${J}.scrap = 83; ${R0}.hp = 6` },
    { walk_to: "shop_heal", who: "runner", max: 900 }, { wait: 3, capture: "the heal stall" }, { press: "interact" }, { wait: 8, capture: "bought: +4 health" },
    { walk_to: "shop_jinx", who: "runner", max: 900 }, { wait: 3, capture: "the shut stall" }, { press: "interact" }, { wait: 6, capture: "shut" },
    { walk_to: "bank", who: "runner", max: 900 }, { wait: 3, capture: "the bank" }, { press: "interact" }, { wait: 8, capture: "banked" },
  ] }, look("shop"));
  withLook("look_summary", { start_scene: "summary", lua: `${RUN}.begin_chain(3); ${RUN}.cleared = 8; ${RUN}.banked = 67; ${RUN}.add_card('plating'); ${RUN}.add_card('live_wire'); ${RUN}.time = 311; ${RUN}.won = true; ${RUN}.finish('win'); nova.goto_scene('summary')`,
    route: [{ wait: 50, capture: "the summary at the win" }] }, look("summary"));
}

// =====================================================================================================================
// SLICE 3b: Mother Coil, the Den, the Workbench, saving. Each route prints the numbers the Rust test asserts.
// =====================================================================================================================
const BOT = fs.readFileSync(`${dir}/bossbot.lua`, "utf8");
const COIL = "nova.named('coil')";
const manual = (rx, ry) => `${COIL}.manual = true; ${R0}.x, ${R0}.y = ${rx}, ${ry}`;
const FIELD = "require('lib.field')";
const WORK = "require('lib.workbench')";

// ---- (1) junk lanes: lit 0.8 s ahead; they hurt in the lane and not between. (layout 1: lanes at y 348, 624, 900; he stands still)
out("boss_lane_hit", {
  start_scene: "gutter.boss", lua: manual(1000, 624),
  route: [{ wait: 25 }, { lua: `HP0 = ${R0}.hp; ${COIL}:cast('lanes'); ROWS = ''; for _, l in ipairs(nova.all('coil_lane')) do ROWS = ROWS .. string.format('%.0f ', l.y) end` },
    { wait: 40, capture: "the lanes are lit" }, { wait: 40, capture: "the junk comes" }, { until: "nova.count('coil_lane') == 0", max: 400 }, { wait: 5, capture: "after" }, { lua: `HP1 = ${R0}.hp` }],
  print: ["HP0", "HP1", "ROWS"],
});
out("boss_lane_gap", {
  start_scene: "gutter.boss", lua: manual(1000, 486),
  route: [{ wait: 25 }, { lua: `HP0 = ${R0}.hp; ${COIL}:cast('lanes')` }, { wait: 40, capture: "the lanes are lit: he stands between" }, { wait: 40, capture: "the junk passes" },
    { until: "nova.count('coil_lane') == 0", max: 400 }, { wait: 5, capture: "after" }, { lua: `HP1 = ${R0}.hp` }],
  print: ["HP0", "HP1"],
});

// ---- (2) cars: a shadow for 1 s, then a slam that hurts within 1.5 tiles (72) and not outside it; the wreck stays and later attacks break it
out("boss_car", {
  start_scene: "gutter.boss", lua: manual(800, 700),
  route: [{ wait: 25 },
    // a car 100 units away: outside the radius
    { lua: `HP0 = ${R0}.hp; nova.spawn('coil_car', 900, 700, { delay = 0 })` }, { wait: 30, capture: "the shadow grows (a car 100 away)" }, { until: "nova.count('coil_car') == 0", max: 200 }, { wait: 4, capture: "wreckage" },
    { lua: `HP1 = ${R0}.hp; WR1 = nova.count('wreckage'); WR1_SETTLED = tostring(nova.all('wreckage')[1].settled)` },
    // a car on him: within the radius
    { lua: `nova.spawn('coil_car', ${R0}.x + 50, ${R0}.y, { delay = 0 })` }, { wait: 40, capture: "the shadow on him" }, { until: "nova.count('coil_car') == 0", max: 200 }, { wait: 4, capture: "hurt" },
    { lua: `HP2 = ${R0}.hp; WR2 = nova.count('wreckage')` },
    // he walks out of the wreck (it was soft while he stood in it) and it is solid cover now
    { walk_to: [600, 820], who: "runner", max: 200 }, { wait: 4 }, { lua: `WR2_SOLID = 0; for _, w in ipairs(nova.all('wreckage')) do if w.settled then WR2_SOLID = WR2_SOLID + 1 end end` },
    // a lane drags through both wrecks and breaks them
    { lua: `nova.spawn('coil_lane', 48, 700, { dir = 1, x0 = 48, x1 = 2064, first = true })` }, { wait: 60, capture: "the lane is lit over the wrecks" }, { until: "nova.count('coil_lane') == 0", max: 400, capture: "the junk has gone through" },
    { lua: `WR3 = nova.count('wreckage'); HP3 = ${R0}.hp` },
    // the fourth car in a row pushes the oldest wreck out (at most four stand)
    { lua: `for i = 1, 5 do nova.spawn('coil_car', 300 + i * 140, 400, { delay = 0 }) end` }, { wait: 90 }, { lua: `WR4 = nova.count('wreckage')` }],
  print: ["HP0", "HP1", "WR1", "WR1_SETTLED", "HP2", "WR2", "WR2_SOLID", "WR3", "HP3", "WR4"],
});

// ---- (3) the magnet slam and the drum: the drum takes no damage while shut (a clang), the magnet slams where he stands after a tell,
// and for 2.5 s after the slam the drum is open: the baton does 2, 2, 4 to it. After the window it is shut again.
out("boss_drum", {
  start_scene: "gutter.boss", lua: manual(1056, 290),
  route: [{ wait: 25 }, { lua: `${R0}.facing = 'up'; C0 = ${COIL}.hp; HP0 = ${R0}.hp` },
    ...chain3, { lua: `C1 = ${COIL}.hp; CLANGS = ${COIL}.clangs; OPEN_BEFORE = tostring(${COIL}.open)` },
    { lua: `${COIL}:cast('slam')` }, { wait: 30, capture: "the magnet follows him" }, { until: "nova.first('coil_magnet').state == 'lock'", max: 100 }, { wait: 6, capture: "locked: the ring" },
    { until: `${COIL}.open`, max: 200, capture: "slam: the drum opens" }, { lua: `HP1 = ${R0}.hp` }, { wait: 6 },
    { lua: `${R0}.x, ${R0}.y = 1056, 290; ${R0}.facing = 'up'` }, ...chain3, { lua: `C2 = ${COIL}.hp` },
    { until: `not ${COIL}.open`, max: 300, capture: "the drum shuts" }, { wait: 4 },
    { lua: `${R0}.x, ${R0}.y = 1056, 290; ${R0}.facing = 'up'; ${R0}.blink_t = 0; OPEN_AFTER = tostring(${COIL}.open)` }, ...chain3, { lua: `C3 = ${COIL}.hp; CLANGS2 = ${COIL}.clangs` }],
  print: ["C0", "OPEN_BEFORE", "C1", "CLANGS", "HP0", "HP1", "C2", "OPEN_AFTER", "C3", "CLANGS2"],
});
// ... and the same from a distance with a shot (the drum is a target too)
out("boss_drum_shot", {
  start_scene: "gutter.boss", lua: manual(1056, 700),
  route: [{ wait: 25 }, { lua: `${R0}.facing = 'up'; ${R0}.aim_dx, ${R0}.aim_dy = 0, -1; ${R0}:fire(); C0 = ${COIL}.hp` }, { wait: 60 }, { lua: `C1 = ${COIL}.hp; CLANGS = ${COIL}.clangs` },
    { lua: `${COIL}:open_drum(); ${R0}.shot_cd = 0; ${R0}:fire()` }, { wait: 60, capture: "a shot hits the open drum" }, { lua: `C2 = ${COIL}.hp` }],
  print: ["C0", "C1", "CLANGS", "C2"],
});

// ---- (4) half health: the stripe phase. A shot fired inside a stripe curves, one in a gap does not; a Rat-drone in a stripe is pulled along it
out("boss_phase2", {
  start_scene: "gutter.boss", lua: manual(1900, 990),
  route: [{ wait: 25 }, { lua: `${COIL}.hp = 49; ${COIL}.open = true; ${COIL}.state = 'window'; ${COIL}.t = 0; PH0 = tostring(${COIL}.phase2); PAUSE0 = ${COIL}:pause_len(); ARMED0 = tostring(${FIELD}.armed)` },
    { lua: `${COIL}:take_hit(2, 0, 0, 0); PH1 = tostring(${COIL}.phase2); PAUSE1 = ${COIL}:pause_len(); HP_BOSS = ${COIL}.hp` }, { wait: 30, capture: "the stripes charge" },
    { until: `${FIELD}.armed`, max: 200, capture: "armed" },
    { lua: `ST = ''; for _, s in ipairs(${FIELD}.stripes) do ST = ST .. string.format('%.0f-%.0f ', s.x0, s.x1) end; local x1 = ${FIELD}.stripes[1].cx
${R0}.x, ${R0}.y = x1, 520; ${R0}.aim_dx, ${R0}.aim_dy = 0, 1; ${R0}.shot_cd = 0; ${R0}:fire()
SHOT_IN = nova.first('shot'); IN_X0, IN_Y0 = SHOT_IN.x, SHOT_IN.y
${R0}.x, ${R0}.y = 800, 520; ${R0}.shot_cd = 0; ${R0}:fire()
for _, s in ipairs(nova.all('shot')) do if s ~= SHOT_IN then SHOT_OUT = s end end; OUT_X0, OUT_Y0 = SHOT_OUT.x, SHOT_OUT.y` },
    { wait: 6, capture: "two shots leave" }, { wait: 14, capture: "the one in the stripe bends" },
    { lua: `IN_X1, IN_Y1, IN_DX = SHOT_IN.x, SHOT_IN.y, SHOT_IN.dx; OUT_X1, OUT_Y1, OUT_DX = SHOT_OUT.x, SHOT_OUT.y, SHOT_OUT.dx; IN_TURN = SHOT_IN.curved; OUT_TURN = SHOT_OUT.curved or 0` },
    // the drones: one in stripe 1 (pulled down), one in stripe 2 (pulled up), one in a gap (not pulled)
    { lua: `${R0}.x, ${R0}.y = 1900, 990; local c = ${FIELD}.stripes; D1 = nova.spawn('rat_drone', c[1].cx, 600); D2 = nova.spawn('rat_drone', c[2].cx, 600); D3 = nova.spawn('rat_drone', 800, 600); DY0 = 600` }, { wait: 60, capture: "pulled along the stripes" },
    { lua: `DY1, DY2, DY3 = D1.y - DY0, D2.y - DY0, D3.y - DY0` }],
  print: ["PH0", "PAUSE0", "ARMED0", "PH1", "PAUSE1", "HP_BOSS", "ST", "IN_X0", "IN_X1", "IN_DX", "IN_TURN", "OUT_X0", "OUT_X1", "OUT_DX", "OUT_TURN", "DY1", "DY2", "DY3"],
});

// ---- (5) she dies: the burst, the pay, a rare card on offer, the district track again, the door
out("boss_dies", {
  start_scene: "gutter.boss", lua: manual(1056, 600),
  route: [{ wait: 25 }, { lua: `${COIL}.open = true; ${COIL}.state = 'window'; ${COIL}.hp = 3; SCRAP0 = ${J}.scrap; local dummy = nova.spawn('rat_drone', 700, 700)` },
    { lua: `${COIL}:take_hit(4, 0, 0, 0); BEFORE_STATE = nova.scene_now().state` }, { wait: 40, capture: "the burst begins" }, { wait: 60, capture: "going down" },
    { until: "nova.scene_now().state == 'cleared'", max: 400, capture: "gone: cleared" }, { lua: `COIL_LEFT = nova.count('mother_coil'); DOOR_STATE = nova.named('door_out').state` },
    { until: "nova.count('card') == 3", max: 200 }, { wait: 40, capture: "the cards rise" },
    { lua: `SCRAP1 = ${J}.scrap; IDS = ''; RARES = 0; for _, c in ipairs(nova.all('card')) do IDS = IDS .. c.card_id .. ','; if c.def.rarity == 'rare' then RARES = RARES + 1; RC = c end end; DRONES = nova.count('rat_drone'); PAID = nova.scene_now().paid` },
    { lua: `${R0}.x, ${R0}.y = RC.x, RC.y + 24` }, { wait: 4, capture: "by the rare card" }, { press: "interact" }, { wait: 10, capture: "taken: the door opens" },
    { lua: `TAKEN = RC.card_id; HELD = ${RUN}.cards[#${RUN}.cards]; DOOR2 = nova.named('door_out').state` }],
  print: ["BEFORE_STATE", "COIL_LEFT", "DOOR_STATE", "SCRAP0", "SCRAP1", "PAID", "IDS", "RARES", "DRONES", "TAKEN", "HELD", "DOOR2"],
});

// ---- (6) THE FIGHT, no invincibility: the test player's eyes (tools/bossbot.lua) wait for each tell, walk to the safe place and hit the
// drum in its window. It wins without being hurt: every attack has a safe place and the tell to find it.
out("boss_fair", {
  start_scene: "gutter.boss", seed: 5,
  lua: BOT + `\n${R0}.x, ${R0}.y = 1056, 380`,
  route: [{ wait: 30 },
    { repeat: 1500, may_time_out: true, until: "(not BOSS:is_alive()) or RUNNER.state == 'dead'", steps: [
      { lua: "BRAIN()" }, { walk_to: "spot", who: "runner", max: 8, may_time_out: true },
      { repeat: 1, may_time_out: true, until: "MODE ~= 'strike'", steps: [{ press: "attack" }, { wait: 2 }] }, { wait: 1 },
    ] },
    { wait: 10, capture: "end" },
    { until: "nova.scene_now().state == 'cards'", max: 600, capture: "the cards rise" }],
  print: ["RUNNER.hp", "RUNNER.state", "nova.scene_now().state", "nova.count('mother_coil')", "#nova.all('card')"],
});
// ... and the three pictures of the fight at its three beats (lanes, a car, the slam and the open drum), then the stripe phase
withLook("look_boss", { start_scene: "gutter.boss", seed: 5, lua: BOT + `\n${R0}.x, ${R0}.y = 1056, 380`,
  route: [{ wait: 30 },
    { until: `${COIL}.state == 'cast' and ${COIL}.attack == 'lanes'`, max: 400 }, { wait: 30, capture: "lanes: lit, 0.8 s ahead" }, { wait: 40, capture: "lanes: the junk is dragged" }, { wait: 35, capture: "lanes: it passes while he stands between" },
    { until: `${COIL}.state == 'cast' and ${COIL}.attack == 'slam'`, max: 800 }, { wait: 20, capture: "slam: the ring follows" }, { until: "nova.first('coil_magnet') and nova.first('coil_magnet').state == 'lock'", max: 100 }, { wait: 20, capture: "slam: locked" },
    { until: `${COIL}.open`, max: 100 }, { wait: 6, capture: "slam: it lands, the drum opens" },
    { repeat: 120, may_time_out: true, until: `not ${COIL}.open`, steps: [{ lua: "BRAIN()" }, { walk_to: "spot", who: "runner", max: 8, may_time_out: true }, { repeat: 1, may_time_out: true, until: "MODE ~= 'strike'", steps: [{ press: "attack" }, { wait: 2 }] }, { wait: 1 }] },
    { until: `${COIL}.state == 'cast' and ${COIL}.attack == 'cars'`, max: 800 }, { wait: 40, capture: "cars: the shadows grow" }, { wait: 30, capture: "cars: they land" }, { wait: 30, capture: "cars: the wrecks" },
  ], print: ["RUNNER.hp"] }, { out: "build/look_boss", columns: 3 });
withLook("look_boss_drum", { start_scene: "gutter.boss", lua: manual(1056, 300),
  route: [{ wait: 25 }, { lua: `${COIL}:open_drum()` }, { wait: 10, capture: "the drum is open: glow, marker, bar, banner" }, { lua: `${R0}.facing = 'up'` }, ...chain3.slice(0, 3), { wait: 8, capture: "a hit" }, { wait: 60 }, { until: `not ${COIL}.open`, max: 200, capture: "shut again" }],
}, { out: "build/look_boss_drum", columns: 2 });
withLook("look_boss_stripes", { start_scene: "gutter.boss", lua: manual(1900, 700),
  route: [{ wait: 25 }, { lua: `${COIL}.hp = 49; ${COIL}.open = true; ${COIL}.state = 'window'; ${COIL}:take_hit(2, 0, 0, 0)` }, { wait: 20, capture: "the floor charges" }, { until: `${FIELD}.armed`, max: 200 }, { wait: 6, capture: "armed" },
    { lua: `local c = ${FIELD}.stripes; ${R0}.x, ${R0}.y = c[1].cx, 520; ${R0}.aim_dx, ${R0}.aim_dy = 0, 1; ${R0}.shot_cd = 0; ${R0}:fire(); nova.spawn('rat_drone', c[2].cx, 600); nova.spawn('rat_drone', c[3].cx, 800)` },
    { wait: 8, capture: "a shot in a stripe" }, { wait: 10, capture: "it bends" }, { wait: 30, capture: "drones are pulled" }, { wait: 40, capture: "further" }],
}, { out: "build/look_boss_stripes", columns: 3 });
withLook("look_boss_death", { start_scene: "gutter.boss", lua: manual(1056, 340), capture_at: [40, 52, 66, 90, 120, 150, 180, 188, 192, 200],
  route: [{ wait: 25 }, { lua: `${COIL}.open = true; ${COIL}.state = 'window'; ${COIL}.hp = 3; ${COIL}:take_hit(4, 0, 0, 0)` }, { until: "nova.scene_now().state == 'cards'", max: 500 }, { wait: 50, capture: "cleared: the pay and the rare card" }],
}, { out: "build/look_boss_death", columns: 4 });
// ---- the ten upgrades, each doing what it says. (begin_chain applies the Workbench to a new run; the tiers are set in lua here, the buying has its own route)
const luaTable = (o) => "{ " + Object.entries(o).map(([k, v]) => `${k} = ${v}`).join(", ") + " }";
const upStart = (tiers, extra = "") => `for k, v in pairs(${luaTable(tiers)}) do ${META}.upgrades[k] = v end; ${extra}`;
const newRun = (seed = 5) => `${RUN}.begin_chain(${seed}); nova.goto_scene(${RUN}.chain[1].scene)`;
const inRoom1 = [{ until: `nova.current_scene() == ${RUN}.chain[1].scene and nova.named('runner') ~= nil`, max: 40 }, { wait: 3 }];
// Thicker Print: +1 health point a tier: tier 2 starts a run with 14
out("up_thicker", { start_scene: "test_lab", lua: upStart({ thicker_print: 2 }, newRun()), route: [...inRoom1, { lua: `MAX = ${R0}.max_hp; HP = ${R0}.hp; RUN_MAX = ${RUN}.max_hp()` }], print: ["MAX", "HP", "RUN_MAX"] });
// Good Solder: +5% a tier on baton damage (tier 3: +15%); fractions are carried: 100 hits of 2 do 230 at tier 3, 210 at tier 1, 200 at none
out("up_solder", { start_scene: "test_lab",
  lua: `local H = require('lib.hits'); local function total(t) ${META}.upgrades.good_solder = t; ${RUN}.begin_chain(5); local d = 0; for i = 1, 100 do d = d + H.baton_damage({}, 2) end; return d end
T0, T1, T3 = total(0), total(1), total(3)
local c = 0; for i = 1, 5 do c = c + H.baton_damage({}, 2) + H.baton_damage({}, 2) + H.baton_damage({}, 4) end; CHAINS5 = c
${META}.upgrades.good_solder = 3; ${RUN}.begin_chain(5); local c3 = 0; CH = ''; for i = 1, 5 do local a, b, d = H.baton_damage({}, 2), H.baton_damage({}, 2), H.baton_damage({}, 4); CH = CH .. a .. b .. d .. ' '; c3 = c3 + a + b + d end; CHAINS5_T3 = c3
${META}.upgrades.good_solder = 0; ${RUN}.begin_chain(5)`,
  route: [{ wait: 2 }], print: ["T0", "T1", "T3", "CH", "CHAINS5_T3"] });
// ... and a real swing at a dummy: three chains at tier 0 and at tier 3
const swingChains = (n) => Array.from({ length: n }, () => chain3).flat();
out("up_solder_real", { start_scene: "test_lab", lua: `${labPlace(324, 420)}; ${dum("d1", 400, 420)}; ${dum("d2", 400, 100)}; ${dum("d3", 400, 700)}`,
  route: [{ wait: 3 }, ...swingChains(3), { lua: `BASE = ${tot("d1")}; ${META}.upgrades.good_solder = 3; ${RUN}.begin_chain(5); nova.named('d1').total = 0` }, ...swingChains(3), { lua: `SOLDER = ${tot("d1")}` }],
  print: ["BASE", "SOLDER"] });
// Warm Start: tier 1 a common, tier 2 + an uncommon, tier 3 + the chosen card
out("up_warm", { start_scene: "test_lab",
  lua: `local C = require('data.cards'); local function held() local out = {}; for _, id in ipairs(${RUN}.cards) do out[#out + 1] = id .. ':' .. C.by_id[id].rarity end; return table.concat(out, ',') end
${META}.upgrades.warm_start = 0; ${RUN}.begin_chain(7); W0 = held()
${META}.upgrades.warm_start = 1; ${RUN}.begin_chain(7); W1 = held()
${META}.upgrades.warm_start = 2; ${RUN}.begin_chain(7); W2 = held()
${META}.upgrades.warm_start = 3; ${META}.warm_pick = 'plating'; ${RUN}.begin_chain(7); W3 = held(); MAXHP3 = ${RUN}.max_hp()
${META}.upgrades.warm_start = 1; ${RUN}.begin_chain(8); W1B = held()
${META}.upgrades.warm_start = 0`,
  route: [{ wait: 2 }], print: ["W0", "W1", "W2", "W3", "MAXHP3", "W1B"] });
// Bigger Magazine: +1 charge pip a tier
out("up_magazine", { start_scene: "test_lab", lua: upStart({ bigger_magazine: 2 }, newRun()), route: [...inRoom1, { lua: `PIPS = ${R0}.max_charge; CH = ${R0}.charge` }], print: ["PIPS", "CH"] });
// Familiar Streets: a card reroll a tier: two at tier 2, the third does nothing; the offer changes
out("up_streets", { start_scene: "test_lab", lua: upStart({ familiar_streets: 2 }, newRun(11)), route: [...inRoom1,
  { lua: `local S = nova.scene_now(); S.state = 'fight'; S.wave_i = #S.def.waves; S.countdown = nil; LEFT0 = ${RUN}.rerolls` },
  { until: "nova.scene_now().state == 'cards'", max: 400 }, { wait: 40 }, { lua: `local function ids() local t = {}; for _, c in ipairs(nova.all('card')) do t[#t + 1] = c.card_id end; table.sort(t); return table.concat(t, ',') end; IDS = ids(); IDS_FN = ids` },
  { press: "ranged" }, { wait: 60 }, { lua: `IDS1 = IDS_FN(); LEFT1 = ${RUN}.rerolls; N1 = nova.count('card')` },
  { press: "ranged" }, { wait: 60 }, { lua: `IDS2 = IDS_FN(); LEFT2 = ${RUN}.rerolls; N2 = nova.count('card')` },
  { press: "ranged" }, { wait: 60, capture: "no rerolls left" }, { lua: `IDS3 = IDS_FN(); LEFT3 = ${RUN}.rerolls; SHOTS = ${R0}.stats.shots` }],
  print: ["LEFT0", "IDS", "IDS1", "LEFT1", "N1", "IDS2", "LEFT2", "N2", "IDS3", "LEFT3", "SHOTS"] });
// LULLABY's Eye: tier 1 names the next room's kind, tier 2 the elite's mark too (the room after room 3 is the elite's)
out("up_eye", { start_scene: "test_lab",
  lua: `local function at(t) ${META}.upgrades.lullaby_eye = t; ${RUN}.begin_chain(5); ${RUN}.room = 2; return tostring(${WORK}.eye_text(${RUN})) end
E0, E1, E2 = at(0), at(1), at(2); MARK = ${RUN}.chain[4].mark; ${RUN}.room = 7; E_BOSS = ${WORK}.eye_text(${RUN}); ${META}.upgrades.lullaby_eye = 0`,
  route: [{ wait: 2 }], print: ["E0", "E1", "E2", "MARK", "E_BOSS"] });
// Deeper Deck: the pool is 12 cards plus 6 a tier; the thirteenth card (Metronome) is never offered at tier 0 and is at tier 1
out("up_deck", { start_scene: "test_lab",
  lua: `local C = require('data.cards')
local function seen(t) ${META}.upgrades.deeper_deck = t; local n = 0; for s = 1, 150 do ${RUN}.begin(s); for _, id in ipairs(${RUN}.offer(3)) do if id == 'metronome' then n = n + 1 end end end; return n end
POOL0 = ${WORK}.pool_size(); SEEN0 = seen(0); ${META}.upgrades.deeper_deck = 1; POOL1 = ${WORK}.pool_size(); SEEN1 = seen(1); ${META}.upgrades.deeper_deck = 4; POOL4 = ${WORK}.pool_size()
${META}.keys = 500; ${META}.upgrades.deeper_deck = 1; BUY, WHY = ${WORK}.can_buy('deeper_deck'); ${META}.upgrades.deeper_deck = 0; ${RUN}.begin(1)`,
  route: [{ wait: 2 }], print: ["POOL0", "SEEN0", "POOL1", "SEEN1", "POOL4", "BUY", "WHY"] });
// Second Chance: once a run a killing blow leaves him on half health with 2 s untouchable; the second kills
out("up_second", { start_scene: "test_lab", lua: upStart({ second_chance: 1 }, newRun()), route: [...inRoom1,
  { lua: `${R0}.hp = 2; ${R0}:take_damage(5); HP1 = ${R0}.hp; STATE1 = ${R0}.state; BLINK1 = string.format('%.1f', ${R0}.blink_t); LEFT1 = ${RUN}.revives` }, { wait: 130 },
  { lua: `${R0}.hp = 2; ${R0}:take_damage(5); HP2 = ${R0}.hp; STATE2 = ${R0}.state` }],
  print: ["HP1", "STATE1", "BLINK1", "LEFT1", "HP2", "STATE2"] });
// Loose Change: a share (10% a tier) of the scrap not banked becomes keys when he dies: 100 scrap at tier 2 is 20 keys
out("up_loose", { start_scene: "test_lab", lua: upStart({ loose_change: 2 }, `${META}.keys = 5; ` + newRun()), route: [...inRoom1,
  { lua: `${J}.scrap = 100; ${RUN}.take_from(${R0}); KEYS0 = ${META}.keys; ${R0}.hp = 1; ${R0}:take_damage(2)` }, { until: "nova.current_scene() == 'summary'", max: 200 },
  { lua: `KEYS1 = ${META}.keys; LOOSE = ${RUN}.summary.loose; BANKED = ${RUN}.summary.keys` }],
  print: ["KEYS0", "KEYS1", "LOOSE", "BANKED"] });
// Fast Print is stored but locked ("after the second district"); Deeper Deck is for sale now (slice 4)
out("up_locked", { start_scene: "test_lab",
  lua: `${META}.keys = 500; local W = ${WORK}; local a, ta = W.buy('fast_print'); local b, tb = W.buy('deeper_deck'); FAST = tostring(a) .. ' ' .. ta; DEEP = tostring(b) .. ' ' .. tb; KEYS = ${META}.keys
TIER_F, TIER_D = W.tier('fast_print'), W.tier('deeper_deck'); NAMES = ''; for _, u in ipairs(W.list) do NAMES = NAMES .. u.name .. '/' .. #u.costs .. ' ' end`,
  route: [{ wait: 2 }], print: ["FAST", "DEEP", "KEYS", "TIER_F", "TIER_D", "NAMES"] });
// Buying: the right keys, never below zero, never past the last tier
out("workbench_sums", { start_scene: "test_lab",
  lua: `local W, M = ${WORK}, ${META}
M.keys = 50; local o1 = W.buy('thicker_print'); B1 = tostring(o1) .. ' ' .. M.keys .. ' ' .. W.tier('thicker_print')
local o2 = W.buy('thicker_print'); B2 = tostring(o2) .. ' ' .. M.keys .. ' ' .. W.tier('thicker_print')
local o3, t3 = W.buy('thicker_print'); B3 = tostring(o3) .. ' ' .. M.keys .. ' ' .. W.tier('thicker_print') .. ' ' .. t3
M.keys = 100; local o4 = W.buy('thicker_print'); B4 = tostring(o4) .. ' ' .. M.keys .. ' ' .. W.tier('thicker_print')
local o5, t5 = W.buy('thicker_print'); B5 = tostring(o5) .. ' ' .. M.keys .. ' ' .. W.tier('thicker_print') .. ' ' .. t5
M.keys = 0; local o6, t6 = W.buy('good_solder'); B6 = tostring(o6) .. ' ' .. M.keys .. ' ' .. W.tier('good_solder') .. ' ' .. t6
COSTS = ''; for _, u in ipairs(W.list) do COSTS = COSTS .. u.id .. '=' .. table.concat(u.costs, '/') .. ' ' end`,
  route: [{ wait: 2 }], print: ["B1", "B2", "B3", "B4", "B5", "B6", "COSTS"] });

// ---- the Den: the stations (the bench's screen, the screen's talk, the plates), and the route from the title
const denWake = [{ until: "nova.current_scene() == 'den' and nova.named('runner') ~= nil", max: 60 }, { wait: 60 }, { press: "interact" }, { until: "nova.scene_now().state == 'free' or nova.scene_now().state == 'movein'", max: 200 }, { wait: 3 }];
const DENS = "nova.scene_now()";
out("den_tour", { start_scene: "title", lua: `${META}.keys = 40`,
  route: [{ wait: 25, capture: "the title" }, { press: "interact" }, { wait: 30, capture: "printing: the bed, LULLABY's first line" }, { lua: `WAKE_LINE = ${DENS}.line; WAKE_KIND = ${DENS}.line_kind; WAKE_STATE = ${DENS}.state` }, ...denWake.slice(1),
    { lua: `FREE = ${DENS}.state; DEN_SCENE = nova.current_scene()` }, { wait: 5, capture: "the Den" },
    { walk_to: "screen", who: "runner", max: 900 }, { wait: 3, capture: "at LULLABY's screen" }, { press: "interact" }, { wait: 3, capture: "she talks" }, { lua: `SCREEN_SET = ${DENS}.panel.set; SCREEN_N = #${DENS}.panel.lines` },
    { repeat: 6, until: `${DENS}.state == 'free'`, steps: [{ press: "interact" }, { wait: 6 }] },
    { walk_to: "stall_patch", who: "runner", max: 900 }, { wait: 3, capture: "an empty stall: its plate" }, { press: "interact" }, { wait: 3, capture: "the plate" }, { lua: `PLATE = ${DENS}.panel.text` }, { press: "interact" }, { wait: 4 },
    { walk_to: "bench", who: "runner", max: 900 }, { wait: 3, capture: "at the Workbench" }, { press: "interact" }, { wait: 4, capture: "the Workbench's screen" },
    { lua: `BENCH = ${DENS}.state; SEL0 = ${DENS}.sel` }, { hold: ["down"], frames: 5 }, { wait: 3 }, { lua: `SEL1 = ${DENS}.sel` }, { hold: ["up"], frames: 5 }, { wait: 3 },
    { press: "interact" }, { wait: 6, capture: "bought: Thicker Print" }, { lua: `KEYS_AFTER = ${META}.keys; TIER = ${META}.upgrades.thicker_print; TOAST = ${DENS}.toast` },
    { press: "interact" }, { wait: 6 }, { lua: `KEYS_AFTER2 = ${META}.keys; TIER2 = ${META}.upgrades.thicker_print` }, { press: "dash" }, { wait: 4, capture: "closed" }, { lua: `CLOSED = ${DENS}.state` },
    { walk_to: "rundoor", who: "runner", max: 900 }, { wait: 3, capture: "the door" }, { press: "interact" },
    { until: `nova.current_scene() == ${RUN}.chain[1].scene and nova.named('runner') ~= nil`, max: 60 }, { wait: 5, capture: "room 1" }, { lua: `RUN_MAX = ${R0}.max_hp; ROOM1 = nova.current_scene(); FROM_DEN = tostring(${RUN}.from_den)` }],
  print: ["WAKE_KIND", "WAKE_STATE", "WAKE_LINE", "FREE", "DEN_SCENE", "SCREEN_SET", "SCREEN_N", "PLATE", "BENCH", "SEL0", "SEL1", "KEYS_AFTER", "TIER", "TOAST", "KEYS_AFTER2", "TIER2", "CLOSED", "RUN_MAX", "ROOM1", "FROM_DEN"] });
// LULLABY's lines: how many, all different, by kind
out("lullaby_lines", { start_scene: "test_lab",
  lua: `local D = require('data.den'); local seen, dup, total = {}, 0, 0; KINDS = ''
for _, k in ipairs({ 'first', 'dead', 'win' }) do KINDS = KINDS .. k .. '=' .. #D.wake_lines[k] .. ' '; for _, l in ipairs(D.wake_lines[k]) do total = total + 1; if seen[l] then dup = dup + 1 end; seen[l] = true end end
TOTAL, DUP = total, dup; SCREEN = ''; for _, s in ipairs(D.screen) do SCREEN = SCREEN .. s.when .. '=' .. #s.lines .. ' ' end
local Den = require('lib.lullaby'); local d0 = Den.wake_line('dead'); local d1 = Den.wake_line('dead'); local d2 = Den.wake_line('dead'); NEXT_DIFFERENT = tostring(d0 ~= d1 and d1 ~= d2)`,
  route: [{ wait: 2 }], print: ["KINDS", "TOTAL", "DUP", "SCREEN", "NEXT_DIFFERENT"] });
// Three meetings move a stranger in: Patch (+2 health at the start of each run), then the Den lines and the perk
const moveIn = (who, choice) => ({
  start_scene: "test_lab", lua: `${META}.met.${who} = 0; ${seedFor(who)}`,
  route: [{ lua: `SP = SEED_${who.toUpperCase()}` }, ...visit(1, "SP", true, choice), { lua: `IN1 = tostring(${META}.moved_in.${who}); MET1 = ${META}.met.${who}` },
    ...visit(2, "SP", false, choice), { lua: `IN2 = tostring(${META}.moved_in.${who}); MET2 = ${META}.met.${who}` }, ...visit(3, "SP", false, choice),
    { lua: `IN3 = tostring(${META}.moved_in.${who}); MET3 = ${META}.met.${who}; MOVED = table.concat(${RUN}.moved, ','); nova.goto_scene('den')` },
    { until: "nova.current_scene() == 'den' and nova.named('runner') ~= nil", max: 60 }, { wait: 60 }, { press: "interact" }, { until: `${DENS}.state == 'movein' or ${DENS}.state == 'free'`, max: 200 }, { wait: 3, capture: "they have moved in: the announcement" },
    { lua: `ANN = ${DENS}.state; ANN_WHO = ${DENS}.panel and ${DENS}.panel.who; SEEN = tostring(${META}.seen_in.${who})` }, { press: "interact" }, { wait: 6 },
    { walk_to: `stall_${who}`, who: "runner", max: 900 }, { wait: 4, capture: "their stall" }, { press: "interact" }, { wait: 4, capture: "their line" },
    { lua: `LINE = ${DENS}.panel.line; STATE_R = ${DENS}.state; LINE_1 = require('data.den').movers.${who}.den_lines[1]` }, { press: "interact" }, { wait: 4 },
    { walk_to: "rundoor", who: "runner", max: 900 }, { press: "interact" },
    { until: `nova.current_scene() == ${RUN}.chain[1].scene and nova.named('runner') ~= nil`, max: 60 }, { wait: 5, capture: "room 1" },
    { lua: `MAX1 = ${R0}.max_hp; HP1 = ${R0}.hp; NOTES = table.concat(${RUN}.den_notes, ';'); H0 = ${R0}.hp; ${R0}:take_damage(2); H1 = ${R0}.hp` }, { wait: 60 }, { lua: `${R0}:take_damage(2); H2 = ${R0}.hp` },
    { lua: `${RUN}.take_from(${R0}); ${RUN}.room = 1; nova.goto_scene(${RUN}.chain[2].scene)` }, { until: `nova.current_scene() == ${RUN}.chain[2].scene and nova.named('runner') ~= nil`, max: 60 }, { wait: 3 },
    { lua: `G0 = ${R0}.hp; ${R0}:take_damage(2); G1 = ${R0}.hp` }],
  print: ["IN1", "MET1", "IN2", "MET2", "IN3", "MET3", "MOVED", "ANN", "ANN_WHO", "SEEN", "LINE", "LINE_1", "STATE_R", "MAX1", "HP1", "NOTES", "H0", "H1", "H2", "G0", "G1"],
});
out("movein_patch", moveIn("patch", 2));
out("movein_sal", moveIn("old_sal", 2));
// A death leads to the summary, then the Den (not into a run), with LULLABY's death line; a stall's perk stays for the next run
out("death_den", { start_scene: "den", lua: `${META}.keys = 7; ${META}.last = 'first'`,
  route: [...denWake, { lua: `LINE0 = ${DENS}.line_kind` }, { walk_to: "rundoor", who: "runner", max: 900 }, { press: "interact" },
    { until: `nova.current_scene() == ${RUN}.chain[1].scene and nova.named('runner') ~= nil`, max: 60 }, { wait: 5 },
    { lua: `${J}.scrap = 40; ${R0}.hp = 1; ${R0}:take_damage(2)` }, { until: "nova.current_scene() == 'summary'", max: 200, capture: "the summary: printed again" }, { lua: `SUM_DEN = tostring(${RUN}.from_den); LAST = ${META}.last; PRINTS = ${META}.prints` },
    { wait: 60 }, { press: "interact" }, { until: "nova.current_scene() == 'den' and nova.named('runner') ~= nil", max: 80 }, { wait: 30, capture: "the Den: LULLABY's death line" },
    { lua: `KIND = ${DENS}.line_kind; LINE = ${DENS}.line; STATE = ${DENS}.state; RUNS = ${META}.runs; IN_RUN = tostring(${RUN}.active)` }],
  print: ["LINE0", "SUM_DEN", "LAST", "PRINTS", "KIND", "LINE", "STATE", "RUNS", "IN_RUN"] });

// ---- saving: two boots on one save folder (the Rust test plays boot 1, then boot 2 on what boot 1 wrote, then boot 3 after "new game")
out("save_boot1", { start_scene: "title", lua: `${META}.keys = 50`,
  route: [{ wait: 25 }, { press: "interact" }, ...denWake, { walk_to: "bench", who: "runner", max: 900 }, { press: "interact" }, { wait: 4 }, { press: "interact" }, { wait: 6, capture: "bought" }, { press: "dash" }, { wait: 4 },
    { lua: `${META}.met.patch = 3; ${META}.moved_in.patch = true; ${META}.seen_in.patch = true; ${META}.runs = 4; ${META}.wins = 1; ${META}.best = 311.5; ${META}.save()` }],
  print: [`${META}.keys`, `${META}.tier('thicker_print')`, `${META}.met.patch`, `tostring(${META}.moved_in.patch)`, `${META}.runs`, `${META}.wins`, `${META}.best`, "nova.current_scene()"] });
out("save_boot2", { start_scene: "title",
  route: [{ wait: 25 }, { lua: `L_KEYS = ${META}.keys; L_TIER = ${META}.tier('thicker_print'); L_MET = ${META}.met.patch; L_IN = tostring(${META}.moved_in.patch); L_RUNS = ${META}.runs; L_WINS = ${META}.wins; L_BEST = ${META}.best; ITEMS = table.concat(${DENS.replace("scene_now()", "scene_now()")}:items(), '/')` },
    // Continue goes on with the save; New game asks first, and "keep my save" keeps it
    { hold: ["down"], frames: 4 }, { wait: 3 }, { press: "interact" }, { wait: 5, capture: "are you sure?" }, { lua: `MODE1 = ${DENS}.mode` }, { press: "interact" }, { wait: 5, capture: "kept" }, { lua: `MODE2 = ${DENS}.mode; KEYS_KEPT = ${META}.keys` },
    { press: "interact" }, { wait: 5 }, { hold: ["right"], frames: 4 }, { wait: 3, capture: "erase it all" }, { press: "interact" }, { until: "nova.current_scene() == 'den'", max: 60 }, { wait: 5, capture: "a new game: the Den" },
    { lua: `W_KEYS = ${META}.keys; W_TIER = ${META}.tier('thicker_print'); W_MET = ${META}.met.patch; W_IN = tostring(${META}.moved_in.patch); W_RUNS = ${META}.runs; W_WINS = ${META}.wins; W_LAST = ${META}.last` }],
  print: ["L_KEYS", "L_TIER", "L_MET", "L_IN", "L_RUNS", "L_WINS", "L_BEST", "ITEMS", "MODE1", "MODE2", "KEYS_KEPT", "W_KEYS", "W_TIER", "W_MET", "W_IN", "W_RUNS", "W_WINS", "W_LAST"] });
out("save_boot3", { start_scene: "title", route: [{ wait: 5 }, { lua: `N_KEYS = ${META}.keys; N_TIER = ${META}.tier('thicker_print'); N_IN = tostring(${META}.moved_in.patch); N_RUNS = ${META}.runs` }], print: ["N_KEYS", "N_TIER", "N_IN", "N_RUNS"] });

// ---- THE WHOLE ROUTE: title, Den, buy one upgrade, a run (all eight rooms, Mother Coil too), the bank, "district cleared", the Den with a win counted.
// The test player is invincible (said here and in the report): the fighting is proven by the routes above (boss_fair is the one without invincibility).
{
  const tail = [];
  out("full_run", {
    start_scene: "title", seed: 3, invincible: true,
    lua: `${META}.keys = 40`,     // (a fresh save has no keys; the bank gives them after the first win)
    route: [
      { wait: 25 }, { press: "interact" }, ...denWake, { lua: `DEN0 = ${DENS}.line_kind; WINS0 = ${META}.wins` },
      { walk_to: "bench", who: "runner", max: 900 }, { press: "interact" }, { wait: 4 }, { press: "interact" }, { wait: 6, capture: "Thicker Print bought" }, { press: "dash" }, { wait: 4 },
      { lua: `BOUGHT = ${META}.tier('thicker_print'); KEYS_SPENT = 40 - ${META}.keys` },
      { walk_to: "rundoor", who: "runner", max: 900 }, { press: "interact" },
      { until: "nova.named('runner') ~= nil and " + `${RUN}.chain ~= nil and nova.current_scene() == ${RUN}.chain[1].scene`, max: 60 }, { wait: 2 },
      { lua: `CHAIN = ''; for i = 1, #${RUN}.chain do CHAIN = CHAIN .. ${RUN}.chain[i].scene .. (i < #${RUN}.chain and ' ' or '') end; MAX_START = ${R0}.max_hp; WHO = ${RUN}.chain[6].who` },
      ...[1, 2, 3, 4, 5].flatMap((i) => fightRoomSteps(i)),
      { lua: `ROOM6 = nova.current_scene()` }, { walk_to: "stranger", who: "runner", max: 900 }, { press: "interact" }, { wait: 3, capture: "a stranger's talk" },
      { repeat: 10, until: `${TALK}.stage == 'done'`, steps: [{ press: "interact" }, { wait: 3 }] }, { wait: 5 }, { walk_to: "door_out", who: "runner", max: 1500 }, { wait: 4 },
      ...fightRoomSteps(7),
      // 8: Mother Coil, with the test player's eyes
      { lua: `ROOM8 = nova.current_scene()\n` + BOT }, { wait: 20, capture: "Mother Coil's arena" },
      { repeat: 1500, may_time_out: true, until: "nova.scene_now().state ~= 'boss' and nova.scene_now().state ~= 'boss_intro'", steps: [
        { lua: "BRAIN()" }, { walk_to: "spot", who: "runner", max: 8, may_time_out: true },
        { repeat: 1, may_time_out: true, until: "MODE ~= 'strike'", steps: [{ press: "attack" }, { wait: 2 }] }, { wait: 1 } ] },
      { until: "nova.scene_now().state == 'cards'", max: 800, capture: "she is down" }, { wait: 40 },
      { lua: `RARE_OFFER = 0; for _, c in ipairs(nova.all('card')) do if c.def.rarity == 'rare' then RARE_OFFER = RARE_OFFER + 1 end end; BOSS_PAID = nova.scene_now().paid` },
      { walk_to: "card", who: "runner", max: 900 }, { press: "interact" }, { wait: 8 }, { lua: `CARDS8 = #${RUN}.cards` },
      { walk_to: "door_out", who: "runner", max: 1500 }, { wait: 4 },
      { lua: `ROOM9 = nova.current_scene(); WON9 = tostring(${RUN}.won); WINS1 = ${META}.wins; SCRAP_BEFORE_BANK = ${J}.scrap; KEYS0 = ${META}.keys` },
      { walk_to: "bank", who: "runner", max: 900 }, { press: "interact" }, { wait: 6, capture: "the bank" }, { lua: `KEYS1 = ${META}.keys` },
      { walk_to: [2010, 424], who: "runner", max: 1500 }, { hold: ["right"], until: "nova.current_scene() == 'summary'", max: 160 }, { wait: 40, capture: "district cleared" },
      { lua: `local s = ${RUN}.summary; END_SCENE = nova.current_scene(); SUM = s.result .. ' ' .. s.cleared .. ' ' .. s.keys .. ' ' .. s.cards; BEST = ${META}.best` },
      { wait: 40 }, { press: "interact" }, { until: "nova.current_scene() == 'den' and nova.named('runner') ~= nil", max: 80 }, { wait: 40, capture: "back in the Den: a win counted" },
      { lua: `BACK = nova.current_scene(); DEN1 = ${DENS}.line_kind; WINS2 = ${META}.wins; LAST = ${META}.last; KEYS_END = ${META}.keys` },
    ],
    print: ["DEN0", "WINS0", "BOUGHT", "KEYS_SPENT", "CHAIN", "MAX_START", "ROOM8", "RARE_OFFER", "BOSS_PAID", "CARDS8", "ROOM9", "WON9", "WINS1", "SCRAP_BEFORE_BANK", "KEYS0", "KEYS1", "END_SCENE", "SUM", "BEST", "BACK", "DEN1", "WINS2", "LAST", "KEYS_END"],
  });
}

// ---- a rough gauge of the first run: rooms 1 to 4 with the test player and NO invincibility, on five seeds (it fights with `fight`: no dodging,
// no card choice: worse than a person in some ways, better in none; read the numbers as a floor of the difficulty, not as the difficulty)
const gaugeStop = "(function() local r = nova.named('runner'); return nova.current_scene() == 'summary' or (r ~= nil and r.state == 'dead') end)()";
const gaugeRoom = (i) => ({ repeat: 1, may_time_out: true, until: gaugeStop, steps: [
  { lua: `G_ROOM = ${i}; G_HP${i} = ${R0}.hp; G_CARDS${i} = #${RUN}.cards` },
  { repeat: 200, may_time_out: true, until: `nova.scene_now().state == 'cards' or ${gaugeStop}`, steps: [
    { until: "nova.count('enemy') > 0 or nova.scene_now().state == 'cards'", max: 80, may_time_out: true },
    { fight: "enemy", attack: "attack", max: 1500, may_time_out: true }, { wait: 4 } ] },
  { repeat: 1, may_time_out: true, until: gaugeStop, steps: [
    { wait: 48 }, { walk_to: "card", who: "runner", max: 900, may_time_out: true }, { press: "interact" }, { wait: 8 },
    { walk_to: "door_out", who: "runner", max: 1500, may_time_out: true }, { wait: 4 } ] },
] });
for (const seed of [3, 7, 11, 20, 31]) {
  out(`gauge_${seed}`, { start_scene: "run_start", seed,
    route: [{ until: "nova.named('runner') ~= nil", max: 30 }, { wait: 2 }, ...[1, 2, 3, 4].map(gaugeRoom), { wait: 100 },
      { lua: `G_END = nova.current_scene(); G_DIED = tostring(${RUN}.summary ~= nil and ${RUN}.summary.result == 'dead'); G_CLEARED = ${RUN}.summary and ${RUN}.summary.cleared or ${RUN}.cleared` }],
    print: ["G_ROOM", "G_DIED", "G_CLEARED", "G_HP1", "G_HP2", "G_HP3", "G_HP4", "G_END"] });
}

// ---- pictures to look at (slice 3b): the Den with each station, the Workbench, a move-in, the death, the district cleared screen
{
  const base3 = (n) => JSON.parse(fs.readFileSync(`${dir}/r_${n}.json`, "utf8"));
  withLook("look_den", { ...base3("den_tour") }, { out: "build/look_den", columns: 3 });
  withLook("look_movein", { ...base3("movein_patch") }, { out: "build/look_movein", columns: 3 });
  withLook("look_den_death", { ...base3("death_den") }, { out: "build/look_den_death", columns: 3 });
  withLook("look_den_bench", { start_scene: "den", lua: `${META}.keys = 63; ${META}.upgrades.thicker_print = 1; ${META}.upgrades.warm_start = 3; ${META}.warm_pick = 'plating'; ${META}.upgrades.lullaby_eye = 1; ${META}.last = 'win'; ${META}.runs = 6; ${META}.wins = 1; nova.goto_scene('den')`,
    route: [...denWake, { walk_to: "bench", who: "runner", max: 900 }, { press: "interact" }, { wait: 4, capture: "the Workbench: Thicker Print" },
      ...[4, 5, 6, 7, 8].flatMap((i) => [{ hold: ["down"], frames: 4 }, { wait: 3, capture: `row ${i + 1}` }]),
    ] }, { out: "build/look_den_bench", columns: 3 });
  withLook("look_den_won", { start_scene: "den", lua: `${META}.keys = 63; ${META}.last = 'win'; ${META}.runs = 6; ${META}.wins = 1; ${META}.met.patch = 3; ${META}.moved_in.patch = true; ${META}.seen_in.patch = true; ${META}.met.old_sal = 3; ${META}.moved_in.old_sal = true; ${META}.seen_in.old_sal = true; nova.goto_scene('den')`,
    route: [{ wait: 40, capture: "a win: LULLABY's line" }, { wait: 90, capture: "waking" }, ...denWake.slice(1), { wait: 20, capture: "free: the Den with two residents" },
      { walk_to: "stall_old_sal", who: "runner", max: 900 }, { wait: 4, capture: "Old Sal's stall" }, { press: "interact" }, { wait: 4, capture: "Old Sal's line" }, { press: "interact" }, { wait: 4 },
      { walk_to: "screen", who: "runner", max: 900 }, { wait: 4 }, { press: "interact" }, { wait: 4, capture: "the screen after a win" }] }, { out: "build/look_den_won", columns: 3 });
  withLook("look_cleared", { start_scene: "summary", lua: `${META}.runs = 3; ${RUN}.begin_chain(3); ${RUN}.cleared = 8; ${RUN}.banked = 71; ${RUN}.add_card('plating'); ${RUN}.add_card('scatter'); ${RUN}.time = 402; ${RUN}.moved = { 'patch' }; ${RUN}.from_den = true; ${RUN}.won = true; ${RUN}.finish('win'); nova.goto_scene('summary')`,
    route: [{ wait: 60, capture: "district cleared" }] }, { out: "build/look_cleared" });
  withLook("look_title", { start_scene: "title", lua: `${META}.started = true`, route: [{ wait: 30, capture: "the title (a save exists)" }, { hold: ["down"], frames: 4 }, { wait: 3 }, { press: "interact" }, { wait: 4, capture: "new game: the confirm" }] }, { out: "build/look_title", columns: 2 });
}

// =====================================================================================================================
// SLICE 4: the other 24 cards, tags and sets, jinxes, keys for every cleared room, the codex.
// Each card has a route (prints the numbers its rule says); `S4` keeps the steps so the look routes can play several cards in one strip.
// =====================================================================================================================
const HITS = "require('lib.hits')";
const park = `${dum("d1", 1300, 120)}; ${dum("d2", 1300, 420)}; ${dum("d3", 1300, 760)}`;
const stillFoe = (v, x, y, hp = 30, kind = "scrapper") => `${v} = nova.spawn('${kind}', ${x}, ${y}); ${v}.hp = ${hp}; ${v}.max_hp = ${hp}; ${STATUS}.stun(${v}, 99)`;
const reset4 = `${RUN}.begin(1); ${HITS}.last_hit = -99; ${J}.slow_t = 0; for _, t in ipairs({ 'scrapper', 'fire', 'decoy', 'ally', 'shot', 'scrap', 'zap', 'barrel', 'bottle', 'can' }) do for _, e in ipairs(nova.all(t)) do e:destroy() end end; local r = ${R0}; r.hp, r.max_hp, r.charge, r.max_charge, r.state, r.blink_t, r.roll_cd = 12, 12, 3, 3, 'free', 0, 0; r.stats.baton_hits = 0; ${HITS}.dip_t = 0`;
const S4 = {};
const card4 = (name, def) => { S4[name] = def; out(`s4_${name}`, { start_scene: "test_lab", ...(def.plan || {}), lua: `${park}; ${def.lua}`, route: def.route, print: def.print }); };
const stand = (x = 324, y = 420, face = "right") => labPlace(x, y, face);

// ---- Metronome: a hit in the rhythm does +1 a copy. A real chain (0.37 s between hits) gets +1 on hits 2 and 3, a hit a second later gets none;
// and the window itself: gaps of 0.2 and 0.4 s are in it, 0.6 s is out.
card4("metronome", { lua: `${stand()}; ${dum("d1", 400, 420)}; ${give("metronome")}`,
  route: [{ wait: 3 }, ...chain3, { lua: `CH = ${tot("d1")}` }, { wait: 60 }, { press: "attack" }, { wait: 30, capture: "a lone hit: no rhythm" }, { lua: `LONE = nova.named('d1').last_damage; local H = ${HITS}
local function gap(g) H.last_hit = H.clock - g; return tostring(H.rhythm()) end; G02, G04, G06 = gap(0.2), gap(0.4), gap(0.6)` }],
  print: ["CH", "LONE", "G02", "G04", "G06"] });
// ---- Skim: the first hit on a healthy enemy makes it leak 1 scrap for each hit it takes; a hurt enemy does not start to leak
card4("skim", { lua: `${stand()}; ${stillFoe("S1", 400, 420)}; ${stillFoe("S2", 400, 560, 30)}; S2.hp = 20; ${give("skim")}`,
  route: [{ wait: 3 }, ...chain3, { lua: "LEAKY = tostring(S1.leaky); HP1 = S1.hp" }, { lua: `${stand(324, 560)}` }, { wait: 40 }, { press: "attack" }, { wait: 30, capture: "a hurt enemy does not leak" }, { lua: "HURT_LEAKY = tostring(S2.leaky)" }],
  print: ["LEAKY", "HP1", "HURT_LEAKY"] });
// ---- Backhand: swing within 0.4 s of a roll and the swing also hits behind, for double; no roll, no rear swing
card4("backhand", { lua: `${stand(200, 420)}; ${give("backhand")}; ${dum("d2", 1300, 420)}`,
  route: [{ wait: 3 },
    { hold: ["right"], tap: "dash", tap_every: 200, until: "nova.named('runner').state == 'roll'", max: 6 }, { until: "nova.named('runner').state ~= 'roll'", max: 40 },
    { lua: `local r = ${R0}; ${dum("d1", "r.x - 70", "r.y")}; ${dum("d2", "r.x + 66", "r.y")}` }, { press: "attack" }, { wait: 25, capture: "after a roll: hit in front and behind" },
    { lua: `REAR = ${tot("d1")}; FRONT = ${tot("d2")}; BACKHANDS = ${R0}.stats.backhands` }, { wait: 60 },
    { press: "attack" }, { wait: 30, capture: "no roll: only in front" }, { lua: `REAR2 = ${tot("d1")}; FRONT2 = ${tot("d2")}; BACKHANDS2 = ${R0}.stats.backhands` }],
  print: ["REAR", "FRONT", "BACKHANDS", "REAR2", "FRONT2", "BACKHANDS2"] });
// ---- Overpressure: held 0.7 s the shot is a slug: 7 damage, through 2 enemies in line (not a third), 2 pips; a short hold is the plain shot
card4("overpressure", { lua: `${stand()}; ${dum("d1", 480, 420)}; ${dum("d2", 540, 420)}; ${dum("d3", 600, 420)}; ${give("overpressure")}`,
  route: [{ wait: 3 }, { hold: ["ranged"], frames: 46, capture: "held: the sight line goes gold" }, { lua: `READY = tostring(${R0}.slug_ready)` }, { wait: 1 }, { wait: 30, capture: "the slug" },
    { lua: `D1 = ${tot("d1")}; D2 = ${tot("d2")}; D3 = ${tot("d3")}; CH1 = string.format('%.2f', ${R0}.charge); SLUGS = ${R0}.stats.slugs` },
    { lua: `nova.named('d1').total = 0; nova.named('d2').total = 0; ${R0}.charge = 3; ${R0}.shot_cd = 0` }, { wait: 10 }, ...shoot,
    { lua: `Q1 = ${tot("d1")}; Q2 = ${tot("d2")}; CH2 = string.format('%.2f', ${R0}.charge); SLUGS2 = ${R0}.stats.slugs` }],
  print: ["READY", "D1", "D2", "D3", "CH1", "SLUGS", "Q1", "Q2", "CH2", "SLUGS2"] });
// ---- Incendiary: a shot leaves a fire for 2 s that sets the enemy alight and never burns the runner
card4("incendiary", { lua: `${stand()}; ${stillFoe("S1", 520, 420)}; ${give("incendiary")}`,
  route: [{ wait: 3 }, ...shoot, { lua: `FIRES = nova.count('fire'); BURN = S1.burn_t or 0; HP0 = S1.hp; local f = nova.first('fire'); FRIENDLY = tostring(f and f.friendly); ${R0}.x, ${R0}.y = f.x, f.y; RHP0 = ${R0}.hp` }, { wait: 30, capture: "the fire, and the runner standing in it" },
    { lua: `HP1 = S1.hp; RHP1 = ${R0}.hp` }, { wait: 110 }, { lua: `FIRES_LATE = nova.count('fire')` }],
  print: ["FIRES", "FRIENDLY", "RHP0", "RHP1", "HP0", "HP1", "FIRES_LATE"] });
// ---- Siphon: a kill with a shot gives its pip back (a shot that does not kill does not)
card4("siphon", { lua: `${stand()}; ${stillFoe("S1", 520, 420, 3)}; ${stillFoe("S2", 520, 560, 30)}; ${give("siphon")}`,
  route: [{ wait: 3 }, ...shoot, { lua: `KILLED = tostring(not S1:is_alive()); CH_KILL = string.format('%.2f', ${R0}.charge); ${stand(324, 560)}; ${R0}.charge = 3; ${R0}.shot_cd = 0` }, { wait: 10 }, ...shoot,
    { lua: `CH_HIT = string.format('%.2f', ${R0}.charge); S2HP = S2.hp` }],
  print: ["KILLED", "CH_KILL", "CH_HIT", "S2HP"] });
// ---- Smart Round: a shot aimed 17 degrees off curves onto the enemy; without the card it misses
const smartShot = [{ lua: `local r = ${R0}; r.aim_dx, r.aim_dy = math.cos(-0.5), math.sin(-0.5); r.shot_cd = 0; r.charge = 3; r:fire()` }, { wait: 5, capture: "it bends" }, { wait: 45 }];
card4("smart_round", { lua: `${stand()}; ${stillFoe("S1", 600, 340)}`,
  route: [{ wait: 3 }, ...smartShot, { lua: `MISS = S1.hp; ${give("smart_round")}` }, ...smartShot, { lua: `HIT = S1.hp` }],
  print: ["MISS", "HIT"] });
// ---- Afterimage: the roll leaves a copy; an enemy goes for it for 1.5 s, then for the runner again
card4("afterimage", { lua: `${stand(400, 420, "left")}; ${give("afterimage")}; SC = nova.spawn('scrapper', 640, 420); SC.hp = 40; SC.max_hp = 40`, plan: { invincible: false },
  route: [{ wait: 2 }, { hold: ["left"], tap: "dash", tap_every: 200, until: "nova.named('runner').state == 'roll'", max: 6 }, { wait: 20, capture: "the copy stays, the runner rolls away" },
    { lua: `DECOYS = nova.count('decoy'); TARGET1 = SC.target_kind; DX = string.format('%.0f', nova.first('decoy').x)` }, { wait: 50, capture: "it goes for the copy" }, { lua: `TARGET2 = SC.target_kind; HP_MID = ${R0}.hp` },
    { wait: 40 }, { lua: `TARGET3 = SC.target_kind; DECOYS3 = nova.count('decoy')` }, { wait: 20, capture: "the copy is gone: back to the runner" }, { lua: `TARGET4 = SC.target_kind; HP_END = ${R0}.hp` }],
  print: ["DECOYS", "TARGET1", "DX", "TARGET2", "HP_MID", "TARGET3", "DECOYS3", "TARGET4"] });
// ---- Slipstream: 30% faster for 1.5 s after a roll
card4("slipstream", { lua: `${stand(120, 420)}; ${give("slipstream")}`,
  route: [{ wait: 2 }, { lua: `X0 = ${R0}.x` }, { hold: ["right"], frames: 30 }, { lua: `BASE = ${R0}.x - X0; ${R0}.x = 120` },
    { hold: ["right"], tap: "dash", tap_every: 200, until: "nova.named('runner').state == 'roll'", max: 6 }, { until: "nova.named('runner').state ~= 'roll'", max: 40 },
    { lua: `X1 = ${R0}.x; SLIP = string.format('%.2f', ${R0}.slip_t)` }, { hold: ["right"], frames: 30, capture: "faster" }, { lua: `FAST = ${R0}.x - X1; ${R0}.x = 120` }, { wait: 100 },
    { lua: `X2 = ${R0}.x; SLIP_END = string.format('%.2f', ${R0}.slip_t)` }, { hold: ["right"], frames: 30 }, { lua: `AFTER = ${R0}.x - X2; RATIO = string.format('%.2f', FAST / BASE)` }],
  print: ["string.format('%.1f', BASE)", "string.format('%.1f', FAST)", "SLIP", "SLIP_END", "string.format('%.1f', AFTER)", "RATIO"] });
// ---- Burn Rubber: the roll leaves a 1 s trail of fire (never hurting the runner) that sets enemies alight
card4("burn_rubber", { lua: `${stand(200, 420)}; ${stillFoe("S1", 290, 420)}; ${give("burn_rubber")}`,
  route: [{ wait: 2 },
    { hold: ["right"], tap: "dash", tap_every: 200, until: "nova.named('runner').state == 'roll'", max: 6 }, { until: "nova.named('runner').state ~= 'roll'", max: 40, capture: "the trail" },
    { lua: `TRAIL = nova.count('fire'); BURN = S1.burn_t or 0; RHP = ${R0}.hp` }, { wait: 20, capture: "burning" }, { lua: `S1HP = S1.hp` }, { wait: 100 }, { lua: `TRAIL_LATE = nova.count('fire')` }],
  print: ["TRAIL", "BURN", "RHP", "S1HP", "TRAIL_LATE"] });
// ---- Phase: an attack landing in the last 0.1 s of the roll's untouchable time slows the enemies for 1 s; an early one does not
card4("phase", { lua: `${stand(300, 420)}; ${give("phase")}; SC = nova.spawn('scrapper', 900, 800); SC.hp = 99; SC.max_hp = 99; SC.state = 'recover'; SC.t = 0`,
  route: [{ wait: 2 }, { hold: ["right"], tap: "dash", tap_every: 200, until: "nova.named('runner').state == 'roll'", max: 6 },
    { until: "nova.named('runner').roll_t >= 0.04", max: 20 }, { lua: `local ok = ${R0}:take_damage(2); EARLY = string.format('%.2f', ${J}.slow_t)` },
    { until: "nova.named('runner').roll_t >= 0.14", max: 20 }, { lua: `${R0}:take_damage(2); LATE = string.format('%.2f', ${J}.slow_t); PERFECT = ${R0}.stats.perfect; T0 = SC.t` }, { wait: 30, capture: "time slows for the enemies" },
    { lua: `SLOWED = string.format('%.2f', SC.t - T0); T1 = SC.t` }, { wait: 60 }, { lua: `SLOW_END = string.format('%.2f', ${J}.slow_t); T2 = SC.t` }, { wait: 30 }, { lua: `NORMAL = string.format('%.2f', SC.t - T2)` }],
  print: ["EARLY", "LATE", "PERFECT", "SLOWED", "SLOW_END", "NORMAL"] });
// ---- Ghost in the Shell: once a run a killing blow leaves 1 point and 2 s untouchable; the second kills
card4("ghost", { lua: `${give("ghost_in_the_shell")}`, plan: {},
  route: [{ wait: 2 }, { lua: `${R0}.hp = 3; ${R0}:take_damage(9); H1 = ${R0}.hp; S1 = ${R0}.state; B1 = string.format('%.1f', ${R0}.blink_t); USED = tostring(${RUN}.ghost_used)` }, { wait: 130 },
    { lua: `${R0}:take_damage(9); H2 = ${R0}.hp; S2 = ${R0}.state` }],
  print: ["H1", "S1", "B1", "USED", "H2", "S2"] });
// ---- Adrenal: below half health +25% damage and speed
card4("adrenal", { lua: `${give("adrenal")}`,
  route: [{ wait: 2 }, { lua: `local H = ${HITS}; local function tot100() local d = 0; for i = 1, 100 do d = d + H.baton_damage({}, 2) end; return d end
${R0}.hp = 12; FULL = tot100(); FULL_SPEED = ${R0}:speed_mult(); ${R0}.hp = 5; LOW = tot100(); LOW_SPEED = ${R0}:speed_mult(); ${R0}.hp = 6; HALF = tot100()` }],
  print: ["FULL", "FULL_SPEED", "LOW", "LOW_SPEED", "HALF"] });
// ---- Friendly Fire: a can, a pipe swing and a bottle hurt other enemies (a control without the card first)
const ffSteps = [{ wait: 2 }, { lua: `nova.spawn('can', 400, 420, { dx = 1, dy = 0 }); nova.spawn('enemy_swing', 400, 580, { dir = 'right', damage = 2, area = require('data.enemies').scrapper.area }); nova.spawn('bottle', 380, 700, { sx0 = 380, sy0 = 700, tx = 520, ty = 700, time = 0.3, height = 20 })` }, { wait: 40, capture: "can, pipe and bottle hit enemies" },
  { lua: `CAN = 30 - A.hp; PIPE = 30 - B.hp; BOTTLE = 30 - C.hp` }];
card4("friendly_fire", { lua: `${stand(120, 420)}; ${stillFoe("A", 480, 420)}; ${stillFoe("B", 470, 580)}; ${stillFoe("C", 520, 700)}; ${give("friendly_fire")}`, route: ffSteps, print: ["CAN", "PIPE", "BOTTLE"] });
out("s4_friendly_fire_base", { start_scene: "test_lab", lua: `${park}; ${stand(120, 420)}; ${stillFoe("A", 480, 420)}; ${stillFoe("B", 470, 580)}; ${stillFoe("C", 520, 700)}`, route: ffSteps, print: ["CAN", "PIPE", "BOTTLE"] });
// ---- Bad Wiring: a barrel blasts twice as wide and does not hurt the runner (control: 3 to the runner, nothing at 150)
const wiring = (card) => ({ start_scene: "test_lab", lua: `${park}; ${stand(500, 500)}; ${stillFoe("S1", 500, 270)}; ${card ? give("bad_wiring") : ""}; BAR = nova.spawn('barrel', 500, 420)`,
  route: [{ wait: 3 }, { lua: "BAR:take_hit(1, 1, 0, 0)" }, { wait: 90, capture: "the blast" }, { lua: `RHP = ${R0}.hp; S1HP = S1.hp` }], print: ["RHP", "S1HP"] });
out("s4_bad_wiring", wiring(true)); out("s4_bad_wiring_base", wiring(false));
// ---- Brownout / Bounty Board / Loop Trap / Open Channel / Clot / Crowd Pleaser / Debt Spiral: in the real rooms
const roomRun = (seed, extra) => `${META}.upgrades = {}; ${RUN}.begin_chain(${seed}); ${extra}; nova.goto_scene(${RUN}.chain[1].scene)`;
const fight1 = [...inRoom1, { until: "nova.count('enemy') > 0", max: 200 }, { wait: 3 }];
card4("brownout", { lua: roomRun(5, give("brownout").replace("nova.named('runner')", "nil")), route: [...fight1,
  { lua: `local S = nova.scene_now(); S.fight_t = 19.9; N0 = nova.count('enemy'); NS0 = 0; for _, e in ipairs(nova.all('enemy')) do if (e.stun_t or 0) > 0 then NS0 = NS0 + 1 end end` }, { wait: 12, capture: "the lights dip: everyone stunned" },
  { lua: `N1 = nova.count('enemy'); NS1 = 0; for _, e in ipairs(nova.all('enemy')) do if (e.stun_t or 0) > 0 then NS1 = NS1 + 1 end end; DIP = string.format('%.2f', ${HITS}.dip_t)` }, { wait: 75 },
  { lua: `NS2 = 0; for _, e in ipairs(nova.all('enemy')) do if (e.stun_t or 0) > 0 then NS2 = NS2 + 1 end end; NEXT = nova.scene_now().next_dip` }],
  print: ["NS0", "N1", "NS1", "DIP", "NS2", "NEXT"] });
const bountyRoute = (markedFirst) => ({ start_scene: "test_lab", lua: roomRun(5, give("bounty_board").replace("nova.named('runner')", "nil")), route: [...fight1,
  { wait: 3 }, { lua: `MARKED = 0; for _, e in ipairs(nova.all('enemy')) do if e.bounty then MARKED = MARKED + 1; BM = e else BO = e end end; BOUNTY = BM.bounty; S0 = ${J}.scrap; ${markedFirst ? "BM" : "BO"}:take_hit(99, 0, 0, 0)` },
  { wait: 5, capture: markedFirst ? "the marked one first: 15 scrap" : "another first: no pay" }, { lua: `PAID = ${J}.scrap - S0; ${markedFirst ? "BO" : "BM"}:take_hit(99, 0, 0, 0)` }, { wait: 5 }, { lua: `PAID2 = ${J}.scrap - S0` }], print: ["MARKED", "BOUNTY", "PAID", "PAID2"] });
out("s4_bounty_board", bountyRoute(true)); out("s4_bounty_board_other", bountyRoute(false));
card4("loop_trap", { lua: `${stand(120, 420)}; ${RUN}.room_kills = 0; ${give("loop_trap")}; ${stillFoe("A", 400, 420, 1)}; ${stillFoe("B", 480, 420, 4)}; ${stillFoe("C", 480, 560, 30)}`,
  route: [{ wait: 3 }, { lua: "A:take_hit(5, 0, 0, 0)" }, { wait: 4, capture: "the first to die rises" }, { lua: `ALLIES = nova.count('ally'); KILLS0 = ${HITS}.ally_kills` }, { wait: 70, capture: "it fights for you" },
    { lua: `KILLS1 = ${HITS}.ally_kills; BDEAD = tostring(not B:is_alive()); ROOM_KILLS = ${RUN}.room_kills; ${stillFoe("D", 700, 640, 1)}; D:take_hit(9, 0, 0, 0); ALLIES2 = nova.count('ally')` }, { wait: 520 }, { lua: `ALLIES_END = nova.count('ally')` }],
  print: ["ALLIES", "KILLS0", "KILLS1", "BDEAD", "ROOM_KILLS", "ALLIES2", "ALLIES_END"] });
const openRoute = (card) => ({ start_scene: "test_lab", lua: `${META}.upgrades = {}; ${RUN}.begin_chain(5); ${card ? give("open_channel").replace("nova.named('runner')", "nil") : ""}; ${RUN}.room = 3; nova.goto_scene('gutter.elite')`,
  route: [{ until: "nova.current_scene() == 'gutter.elite' and nova.named('runner') ~= nil", max: 40 }, { until: "nova.count('warn') > 0", max: 200 }, { lua: `WARN1 = nova.count('warn')` }, { wait: 70, capture: "the first wave" }, { lua: `ENEMIES1 = nova.count('enemy'); ELITES = 0; for _, e in ipairs(nova.all('enemy')) do if e.elite then ELITES = ELITES + 1 end end` },
  ], print: ["WARN1", "ENEMIES1", "ELITES"] });
out("s4_open_channel", openRoute(true)); out("s4_open_channel_base", openRoute(false));
const bossHp = (card) => ({ start_scene: "test_lab", lua: `${META}.upgrades = {}; ${RUN}.begin_chain(5); ${card ? give("open_channel").replace("nova.named('runner')", "nil") : ""}; ${RUN}.room = 7; nova.goto_scene('gutter.boss')`,
  route: [{ until: "nova.current_scene() == 'gutter.boss' and nova.named('coil') ~= nil", max: 40 }, { wait: 5 }, { lua: `HP = ${COIL}.hp; MAX = ${COIL}.max_hp` }], print: ["HP", "MAX"] });
out("s4_open_channel_boss", bossHp(true)); out("s4_open_channel_boss_base", bossHp(false));
const clotRoute = (hit) => ({ start_scene: "test_lab", lua: roomRun(5, give("clot").replace("nova.named('runner')", "nil")), route: [...inRoom1,
  { lua: `${R0}.hp = 8; ${RUN}.take_from(${R0}); local S = nova.scene_now(); S.state = 'fight'; S.wave_i = #S.def.waves; S.countdown = nil; ${hit ? `${RUN}.room_hit = true` : ""}` }, { until: "nova.scene_now().state == 'cards'", max: 400, capture: hit ? "hit in the room: no heal" : "clean room: Clot heals" },
  { wait: 20 }, { lua: `HP = ${R0}.hp; NOTE = tostring(nova.scene_now().heal_note)` }], print: ["HP", "NOTE"] });
out("s4_clot", clotRoute(false)); out("s4_clot_hit", clotRoute(true));
// killing every enemy as it appears: the room's waves, their pay and the cards
const killLoop = { repeat: 300, until: "nova.scene_now().state == 'cards'", steps: [{ until: "nova.count('enemy') > 0 or nova.scene_now().state == 'cards'", max: 90, may_time_out: true }, { lua: killAll }, { wait: 4 }] };
const crowdRoute = (card) => ({ start_scene: "test_lab", lua: roomRun(11, card ? give("crowd_pleaser").replace("nova.named('runner')", "nil") : ""), route: [...inRoom1, killLoop, { wait: 60, capture: "the cards" }, { lua: `CARDS = nova.count('card')` }], print: ["CARDS"] });
out("s4_crowd_pleaser", crowdRoute(true)); out("s4_crowd_pleaser_base", crowdRoute(false));
out("s4_debt_spiral", { start_scene: "test_lab", lua: roomRun(5, `${give("debt_spiral").replace("nova.named('runner')", "nil")}; ${META}.keys = 0`), route: [...inRoom1,
  { lua: `HP = ${R0}.hp; ${J}.scrap = 40; BANK = ${RUN}.bank(4); KEYS = ${META}.keys; ROOM = ${RUN}.pay_keys('fight'); KEYS2 = ${META}.keys` }], print: ["HP", "BANK", "ROOM", "KEYS2"] });
// ---- Overclock, Red Line
card4("overclock", { lua: `${give("overclock")}`, route: [{ wait: 2 }, { lua: `local H = ${HITS}; local d = 0; for i = 1, 100 do d = d + H.baton_damage({}, 2) end; DEALT = d; ${R0}.hp = 12; ${R0}:take_damage(2); HP = ${R0}.hp` }], print: ["DEALT", "HP"] });
card4("red_line", { lua: `${give("red_line")}`, route: [{ wait: 2 }, { lua: `MAX = ${R0}.max_hp; HP = ${R0}.hp; ${R0}.charge = 0` }, { wait: 84 }, { lua: `REGEN = string.format('%.2f', ${R0}.charge); ${give("plating")}; MAX2 = ${R0}.max_hp` },
  { lua: `${RUN}.remove_card('red_line', ${R0}); MAX3 = ${R0}.max_hp; ${R0}.charge = 0` }, { wait: 84 }, { lua: `REGEN2 = string.format('%.2f', ${R0}.charge)` }], print: ["MAX", "HP", "REGEN", "MAX2", "MAX3", "REGEN2"] });

// ---- sets: three different cards of one tag; copies of one card count once
out("s4_set_copies", { start_scene: "test_lab", lua: `${RUN}.begin(1)`, route: [{ wait: 2 }, { lua: `local R = ${RUN}; for i = 1, 3 do R.add_card('live_wire', ${R0}) end; COPIES = R.set_count('volt') .. ' ' .. tostring(R.set_on('volt')); local Hd = require('lib.hud'); local C = require('data.cards'); LINE1 = Hd.set_lines(C.by_id.tracer)[1]; R.add_card('tracer', ${R0}); TWO = R.set_count('volt') .. ' ' .. tostring(R.set_on('volt')); LINE2 = Hd.set_lines(C.by_id.shock_wake)[1]; R.add_card('shock_wake', ${R0}); LINE3 = Hd.set_lines(C.by_id.shock_wake)[1]; THREE = R.set_count('volt') .. ' ' .. tostring(R.set_on('volt')); FLASH = tostring(R.set_flash and R.set_flash.tag)` }, { wait: 10, capture: "SET COMPLETE" }], print: ["COPIES", "TWO", "THREE", "FLASH", "LINE1", "LINE2", "LINE3"] });
const voltPlan = (set) => ({ start_scene: "test_lab", lua: `${labPlace(324, 420)}; ${dum("d1", 400, 420)}; ${dum("d2", 400, 310)}; ${dum("d3", 400, 530)}; ${give("live_wire")}; ${set ? `${give("tracer")}; ${give("shock_wake")}` : ""}`,
  route: [{ wait: 3 }, ...chain3, { wait: 20, capture: set ? "the second arc" : "one arc" }, { lua: `D2 = ${tot("d2")}; D3 = ${tot("d3")}; ON = tostring(${RUN}.set_on('volt'))` }], print: ["D2", "D3", "ON"] });
out("s4_set_volt", voltPlan(true)); out("s4_set_volt_base", voltPlan(false));
const burnSet = (set) => ({ start_scene: "test_lab", lua: `${park}; ${stand(200, 420)}; ${set ? `${give("hot_solder")}; ${give("incendiary")}; ${give("burn_rubber")}` : `${give("hot_solder")}; ${give("incendiary")}`}; ${stillFoe("A", 400, 420, 30)}; ${stillFoe("B", 440, 420, 10)}; ${stillFoe("C", 400, 600, 30)}; ${stillFoe("E", 440, 600, 10)}; ${STATUS}.burn(A, 3, 1)`,
  route: [{ wait: 3 }, { lua: "A:take_hit(99, 0, 0, 0); C:take_hit(99, 0, 0, 0)" }, { wait: 6, capture: "a burning one explodes" }, { lua: `BHP = B.hp; EHP = E.hp; RHP = ${R0}.hp` }], print: ["BHP", "EHP", "RHP"] });
out("s4_set_burn", burnSet(true)); out("s4_set_burn_base", burnSet(false));
const leakSet = (set) => ({ start_scene: "test_lab", lua: `${park}; ${stand()}; ${set ? `${give("skim")}; ${give("siphon")}; ${give("deep_pockets")}` : `${give("skim")}; ${give("siphon")}`}; ${R0}.hp = 6; ${RUN}.take_from(${R0}); ${J}.scrap = 0`,
  route: [{ wait: 2 }, { repeat: 5, steps: [{ lua: scrapDrop }, { wait: 40 }] }, { wait: 30, capture: "scrap picked up: Leak heals" }, { lua: `SCRAP = ${J}.scrap; HP = ${R0}.hp; ACC = ${RUN}.leak_acc` }], print: ["SCRAP", "HP", "ACC"] });
out("s4_set_leak", leakSet(true)); out("s4_set_leak_base", leakSet(false));
const echoSet = (set) => ({ start_scene: "test_lab", lua: `${park}; ${labPlace(324, 420)}; ${dum("d1", 400, 420)}; ${set ? `${give("afterimage")}; ${give("loop_trap")}; ${give("ghost_in_the_shell")}` : `${give("afterimage")}; ${give("loop_trap")}`}; nova.spawn('afterimage', 330, 560, { life = 9 }); ${stillFoe("S1", 380, 600)}`,
  route: [{ wait: 3 }, ...chain3, { wait: 10, capture: "the copy hits too" }, { lua: `HP = S1.hp; ON = tostring(${RUN}.set_on('echo'))` }], print: ["HP", "ON"] });
out("s4_set_echo", echoSet(true)); out("s4_set_echo_base", echoSet(false));

// ---- jinxes in the offers: never in the first two offers of a run, at the stated rate after, never in a base pool; the guarantees at each tier
out("s4_jinx_offers", { start_scene: "test_lab",
  lua: `local R, C, M = ${RUN}, require('data.cards'), ${META}
local function counts(tier, seeds, offers)
  M.upgrades.deeper_deck = tier; local per = {}; for k = 1, offers do per[k] = 0 end
  for s = 1, seeds do R.begin(s); for k = 1, offers do for _, id in ipairs(R.offer(3)) do if C.by_id[id].jinx then per[k] = per[k] + 1 end end end end
  return table.concat(per, ',')
end
J4 = counts(4, 600, 10); J0 = counts(0, 100, 10); J3 = counts(3, 100, 10)
-- one jinx maximum at the end of the offer; a held jinx is not offered again
local both = 0; M.upgrades.deeper_deck = 4
for s = 1, 400 do R.begin(s); R.offers = 5; local o = R.offer(3); local n = 0; for _, id in ipairs(o) do if C.by_id[id].jinx then n = n + 1 end end; if n > 1 then both = both + 1 end end
TWO_JINX = both
R.begin(3); R.counts.overclock = 1; R.counts.red_line = 1; R.counts.crowd_pleaser = 1; R.counts.debt_spiral = 1; HELD_OFFERED = 0
for k = 1, 30 do R.offers = 5; for _, id in ipairs(R.offer(3)) do if C.by_id[id].jinx then HELD_OFFERED = HELD_OFFERED + 1 end end end
M.upgrades.deeper_deck = 0; R.begin(1)`,
  route: [{ wait: 2 }], print: ["J4", "J0", "J3", "TWO_JINX", "HELD_OFFERED"] });
// Deeper Deck: each tier reveals six more cards; the boss's rare and the elite's uncommon guarantee hold at every tier
out("s4_deck_tiers", { start_scene: "test_lab",
  lua: `local R, C, M = ${RUN}, require('data.cards'), ${META}
TIERS = ''; GR_BAD = ''; GU_BAD = ''; NEW = ''
for t = 0, 4 do
  M.upgrades.deeper_deck = t
  local seen, n = {}, 0
  for s = 1, 300 do R.begin(s); for k = 1, 4 do for _, id in ipairs(R.offer(3)) do if not seen[id] then seen[id] = true; n = n + 1 end end end end
  TIERS = TIERS .. n .. ' '
  local bad_r, bad_u = 0, 0
  for s = 1, 300 do
    R.begin(s); local o = R.offer(3, { guarantee = 'rare' }); local ok = false
    for _, id in ipairs(o) do if C.by_id[id].rarity == 'rare' and not C.by_id[id].jinx then ok = true end end
    if not ok or C.by_id[o[1]].jinx then bad_r = bad_r + 1 end
    R.begin(s); o = R.offer(3, { guarantee = 'uncommon' }); ok = false
    for _, id in ipairs(o) do if C.by_id[id].rarity == 'uncommon' then ok = true end end
    if not ok or C.by_id[o[1]].jinx then bad_u = bad_u + 1 end
  end
  GR_BAD = GR_BAD .. bad_r .. ' '; GU_BAD = GU_BAD .. bad_u .. ' '
  local names = {}; for _, c in ipairs(C.list) do if c.index > 12 + 6 * (t - 1) and c.index <= 12 + 6 * t and t > 0 then names[#names + 1] = c.id end end
  NEW = NEW .. table.concat(names, ',') .. ' | '
end
M.upgrades.deeper_deck = 0; R.begin(1)`,
  route: [{ wait: 2 }], print: ["TIERS", "GR_BAD", "GU_BAD", "NEW"] });
// buying Deeper Deck, tier by tier
out("s4_deck_buy", { start_scene: "test_lab", lua: `local W, M = ${WORK}, ${META}; M.upgrades = {}; M.keys = 400; local out = {}
for t = 1, 5 do local before = M.keys; local ok = W.buy('deeper_deck'); out[#out + 1] = tostring(ok) .. ':' .. (before - M.keys) .. ':' .. W.pool_size() end
BUYS = table.concat(out, ' '); M.upgrades = {}; M.keys = 0`, route: [{ wait: 2 }], print: ["BUYS"] });
// the shop's jinx stall: nothing to remove, then one removed for 30 scrap (the one taken last), and Red Line's cap lifts
out("s4_shop_jinx", { start_scene: "test_lab", lua: `${RUN}.begin_chain(5); local r = ${R0}; ${J}.scrap = 100; local S = ${SHOP}
local ok0, t0 = S.buy('jinx', r); NONE = tostring(ok0) .. ' ' .. ${J}.scrap .. ' ' .. t0
${RUN}.add_card('red_line', r); ${RUN}.add_card('overclock', r); BEFORE = r.max_hp .. ' ' .. ${RUN}.mods.overclock .. ' ' .. #${RUN}.held_jinxes()
local ok1, t1 = S.buy('jinx', r); ONE = tostring(ok1) .. ' ' .. ${J}.scrap .. ' ' .. t1 .. ' ' .. ${RUN}.mods.overclock .. ' ' .. #${RUN}.held_jinxes()
local ok2, t2 = S.buy('jinx', r); TWO = tostring(ok2) .. ' ' .. ${J}.scrap .. ' ' .. t2 .. ' ' .. r.max_hp .. ' ' .. #${RUN}.held_jinxes()
${J}.scrap = 10; ${RUN}.add_card('debt_spiral', r); local ok3, t3 = S.buy('jinx', r); POOR = tostring(ok3) .. ' ' .. ${J}.scrap .. ' ' .. t3 .. ' ' .. #${RUN}.held_jinxes()`,
  route: [{ wait: 2 }], print: ["NONE", "BEFORE", "ONE", "TWO", "POOR"] });
out("s4_shop_jinx_room", { start_scene: "gutter.walk", route: [{ wait: 5 }, { lua: `${RUN}.begin_chain(5); ${RUN}.add_card('overclock', ${R0}); ${J}.scrap = 50` }, { walk_to: "shop_jinx", who: "runner", max: 900 }, { wait: 2, capture: "at the jinx stall" }, { press: "interact" }, { wait: 6, capture: "the jinx is gone" },
  { lua: `SCRAP = ${J}.scrap; HELD = ${RUN}.count('overclock'); TOAST = nova.scene_now().toast` }, { press: "interact" }, { wait: 6 }, { lua: `SCRAP2 = ${J}.scrap; TOAST2 = nova.scene_now().toast` }], print: ["SCRAP", "HELD", "TOAST", "SCRAP2", "TOAST2"] });

// ---- keys: every cleared room pays at once (1 fight, 3 elite, 2 gauntlet, 10 boss), kept on death; the bank on top
out("s4_keys_kinds", { start_scene: "test_lab", lua: `${META}.upgrades = {}; ${META}.keys = 0; ${RUN}.begin_chain(5); nova.goto_scene(${RUN}.chain[1].scene)`,
  route: [...inRoom1, killLoop, { wait: 30, capture: "a fight room: +1 key" }, { lua: `K_FIGHT = ${META}.keys; ROOM_KEYS1 = ${RUN}.room_keys; ${RUN}.room = 3; nova.goto_scene('gutter.elite')` },
    { until: "nova.current_scene() == 'gutter.elite' and nova.named('runner') ~= nil", max: 40 }, killLoop, { wait: 30, capture: "the elite: +3" }, { lua: `K_ELITE = ${META}.keys; ${RUN}.room = 6; nova.goto_scene('gutter.s7_yard')` },
    { until: "nova.current_scene() == 'gutter.s7_yard' and nova.named('runner') ~= nil", max: 40 }, killLoop, { wait: 30, capture: "the gauntlet: +2" }, { lua: `K_GAUNTLET = ${META}.keys; ${RUN}.room = 7; nova.goto_scene('gutter.boss')` },
    { until: "nova.current_scene() == 'gutter.boss' and nova.named('coil') ~= nil", max: 40 }, { wait: 30 }, { lua: "nova.named('coil'):die()" }, { until: "nova.scene_now().state == 'cards'", max: 900, capture: "the boss: +10" }, { wait: 20 },
    { lua: `K_BOSS = ${META}.keys; ROOM_KEYS = ${RUN}.room_keys` }], print: ["K_FIGHT", "ROOM_KEYS1", "K_ELITE", "K_GAUNTLET", "K_BOSS", "ROOM_KEYS"] });
const leaveRoom = [{ wait: 48 }, { walk_to: "card", who: "runner", max: 900 }, { press: "interact" }, { wait: 8 }, { walk_to: "door_out", who: "runner", max: 1500 }, { wait: 4 }];
out("s4_keys_death_boot1", { start_scene: "title", lua: `${META}.keys = 0`, route: [{ wait: 25 }, { press: "interact" }, ...denWake, { walk_to: "rundoor", who: "runner", max: 900 }, { press: "interact" },
    { until: `nova.current_scene() == ${RUN}.chain[1].scene and nova.named('runner') ~= nil`, max: 60 }, { wait: 2 }, killLoop, ...leaveRoom,
    { until: `nova.current_scene() == ${RUN}.chain[2].scene and nova.named('runner') ~= nil`, max: 60 }, { wait: 2 }, killLoop, ...leaveRoom,
    { until: `nova.current_scene() == ${RUN}.chain[3].scene and nova.named('runner') ~= nil`, max: 60 }, { wait: 5 }, { lua: `K_BEFORE = ${META}.keys; ${R0}.hp = 1; ${R0}:take_damage(2)` }, { until: "nova.current_scene() == 'summary'", max: 200, capture: "died in room 3: the summary lists the keys" },
    { lua: `K_AFTER = ${META}.keys; SUM_ROOM_KEYS = ${RUN}.summary.room_keys; SUM_CLEARED = ${RUN}.summary.cleared` }],
  print: ["K_BEFORE", "K_AFTER", "SUM_ROOM_KEYS", "SUM_CLEARED"] });
out("s4_keys_death_boot2", { start_scene: "title", route: [{ wait: 25 }, { lua: `K_LOADED = ${META}.keys; RUNS = ${META}.runs` }], print: ["K_LOADED", "RUNS"] });

// ---- the codex: seen cards are saved; the Den's terminal lists seen, unseen and locked cards
out("s4_codex_boot1", { start_scene: "test_lab", lua: `${META}.upgrades = {}; ${META}.seen_cards = {}; ${RUN}.begin(7); local ids = {}; for k = 1, 2 do for _, id in ipairs(${RUN}.offer(3)) do ids[#ids + 1] = id end end; table.sort(ids); OFFERED = table.concat(ids, ',')`, route: [{ wait: 2 }, { lua: `SEEN_N = 0; for _ in pairs(${META}.seen_cards) do SEEN_N = SEEN_N + 1 end` }], print: ["OFFERED", "SEEN_N"] });
out("s4_codex_boot2", { start_scene: "den", route: [...denWake, { lua: "OFFERED_SEEN = ''" }, { walk_to: "codex", who: "runner", max: 900 }, { wait: 3, capture: "at the codex" }, { press: "interact" }, { wait: 4, capture: "the codex: the first card" },
    { lua: `local D = ${DENS}; local C = require('data.cards'); STATE = D.state; local l = {}; for _, id in ipairs({ 'live_wire', 'long_reach', 'riot_stock', 'hot_solder', 'ricochet', 'scatter', 'tracer', 'shock_wake', 'second_wind', 'plating', 'capacitor', 'deep_pockets', 'metronome', 'overclock' }) do l[#l + 1] = id .. '=' .. D:card_state(C.by_id[id]) end; STATES = table.concat(l, ' '); SEEN_COUNT = 0; for _ in pairs(${META}.seen_cards) do SEEN_COUNT = SEEN_COUNT + 1 end; TIER_OVER = D:tier_needed(C.by_id.overclock); TIER_METRO = D:tier_needed(C.by_id.metronome)` },
    { hold: ["down"], frames: 4 }, { wait: 3 }, { hold: ["down"], frames: 4 }, { wait: 3, capture: "scrolling" }, { lua: `CSEL = ${DENS}.csel` }, { press: "dash" }, { wait: 4 }, { lua: `CLOSED = ${DENS}.state` }],
  print: ["STATE", "STATES", "SEEN_COUNT", "TIER_OVER", "TIER_METRO", "CSEL", "CLOSED"] });

// ---- the soak: a whole district on 30 seeds with random cards (from the whole list, jinxes too), invincible. A monitor wraps the juice tick:
// every frame it checks health and charge are not negative and no enemy is alive far off the map, and now and then it rolls and shoots (so the
// roll and sidearm cards run too). The route must reach the summary: the rooms clear, the doors open, the boss falls.
const SOAK_LUA = `SOAK_BAD = ''; SOAK_FRAMES = 0; SOAK_ROLLS = 0; SOAK_SHOTS = 0
-- (the test player's "invincible" puts health back after the frame, so a single blow bigger than what is left, a tram and Overclock's +1, would still kill: it is healed just before any blow)
local RC = require('entities.runner'); local otd = RC.take_damage
RC.take_damage = function(self, n) if self.hp ~= nil and self.hp <= n + 6 then self.hp = self.max_hp end return otd(self, n) end
local Jx = require('lib.juice'); local orig = Jx.tick
Jx.tick = function()
  orig()
  SOAK_FRAMES = SOAK_FRAMES + 1
  local r = nova.named('runner'); local sc = nova.scene_now()
  if r and r.hp and r.state ~= 'dead' then
    if r.hp < 0 or r.charge < -1e-6 or r.charge ~= r.charge then SOAK_BAD = SOAK_BAD .. string.format('runner hp %s charge %s in %s; ', tostring(r.hp), tostring(r.charge), nova.current_scene()) end
    if SOAK_FRAMES % 70 == 0 and r.state == 'free' and r.roll_cd <= 0 and nova.count('enemy') > 0 then r:start_roll(); SOAK_ROLLS = SOAK_ROLLS + 1 end
    if SOAK_FRAMES % 113 == 0 and r.state == 'free' then
      local e = nova.nearest(r.x, r.y, 'enemy')
      if e then local dx, dy = e.x - r.x, e.y - 14 - (r.y - 14); local l = math.sqrt(dx * dx + dy * dy)
        if l > 1 then r.aim_dx, r.aim_dy = dx / l, dy / l; r.aim_t = (SOAK_FRAMES % 226 == 0) and 1 or 0; r.shot_cd = 0; r:fire(); SOAK_SHOTS = SOAK_SHOTS + 1 end end
    end
  end
  if sc and sc.w then
    for _, e in ipairs(nova.all('enemy')) do
      if e.state ~= 'dead' and (e.x < -100 or e.x > sc.w + 100 or e.y < -100 or e.y > sc.h + 100) then SOAK_BAD = SOAK_BAD .. string.format('%s off the map at %.0f,%.0f; ', tostring(e.kind_name), e.x, e.y) end
    end
  end
end
function RANDCARD()
  local C = require('data.cards'); local R = ${RUN}; local list = {}
  for _, c in ipairs(C.list) do if R.can_take(c.id) then list[#list + 1] = c.id end end
  local id = list[math.random(#list)]; R.add_card(id, nova.named('runner')); SOAK_PICKS = (SOAK_PICKS or '') .. id .. ','
end`;
for (let seed = 1; seed <= 30; seed++) {
  const w = wholeRun(seed);
  const route = [{ lua: SOAK_LUA }];
  for (const st of w.route) {
    if (st.lua && /^ROOM\d = nova\.current_scene\(\); KIND\d/.test(st.lua)) route.push({ lua: "RANDCARD(); RANDCARD()" });
    route.push(st);
  }
  out(`soak_${seed}`, { ...w, route, print: ["SOAK_BAD", "SOAK_FRAMES", "SOAK_ROLLS", "SOAK_SHOTS", "END_SCENE", "SUM", "SOAK_PICKS", "WON9"] });
}

// ---- strips to look at (slice 4): the new cards a few to a strip (build/look_s4_*), a set completing, a jinx on the floor, the codex
{
  const group = (names) => names.flatMap((n) => [{ lua: `${reset4}; ${park}; ${S4[n].lua}` }, { wait: 3 }, ...S4[n].route]);
  const lab = (name, names, extra = {}) => out(`look_s4_${name}`, { start_scene: "test_lab", lua: park, route: group(names), out: `build/look_s4_${name}`, columns: 4, ...extra });
  lab("baton", ["metronome", "skim", "backhand"]);
  lab("sidearm", ["overpressure", "incendiary", "siphon", "smart_round"]);
  lab("roll", ["afterimage", "burn_rubber", "phase"]);
  lab("district", ["friendly_fire", "loop_trap"]);
  out("look_s4_wiring", { ...JSON.parse(fs.readFileSync(`${dir}/r_s4_bad_wiring.json`, "utf8")), route: [{ wait: 3, capture: "a barrel, a runner close, an enemy at 3 tiles" }, { lua: "BAR:take_hit(1, 1, 0, 0)" }, { wait: 40, capture: "the fuse: the ring is twice as wide" }, { wait: 50, capture: "the blast: the runner untouched" }], out: "build/look_s4_wiring", columns: 3 });
  out("look_s4_ghost", { start_scene: "test_lab", lua: `${park}; ${give("ghost_in_the_shell")}; ${give("adrenal")}`, route: [{ wait: 3, capture: "before" }, { lua: `${R0}.hp = 3; ${R0}:take_damage(9)` }, { wait: 6, capture: "a killing blow: left on 1, flickering" }, { wait: 20, capture: "untouchable for 2 s" }, { lua: `${R0}.hp = 4` }, { wait: 6, capture: "below half health (Adrenal)" }], out: "build/look_s4_ghost", columns: 4 });
  out("look_s4_brownout", { ...JSON.parse(fs.readFileSync(`${dir}/r_s4_brownout.json`, "utf8")), route: [...fight1, { wait: 10, capture: "a fight" }, { lua: "nova.scene_now().fight_t = 19.9" }, { wait: 8, capture: "the lights dip" }, { wait: 14, capture: "everyone stunned" }, { wait: 40, capture: "the lights are back" }], out: "build/look_s4_brownout", columns: 4 });
  out("look_s4_bounty", { ...JSON.parse(fs.readFileSync(`${dir}/r_s4_bounty_board.json`, "utf8")), route: [...fight1, { wait: 10, capture: "one enemy carries a $15 tag" }, { lua: "for _, e in ipairs(nova.all('enemy')) do if e.bounty then e:take_hit(99, 0, 0, 0) end end" }, { wait: 6, capture: "killed first: paid" }], out: "build/look_s4_bounty", columns: 3 });
  out("look_s4_sets", { start_scene: "test_lab", lua: `${park}; ${stand()}; ${RUN}.begin(1)`, route: [{ wait: 3 }, { lua: `${give("live_wire")}; ${give("tracer")}` }, { wait: 10, capture: "two Volt cards" }, { lua: give("shock_wake") }, { wait: 6, capture: "SET COMPLETE: VOLT (banner and sound)" }, { wait: 40, capture: "the banner stays a moment" }, { press: "start" }, { wait: 4, capture: "the pause list: tags and SETS" }], out: "build/look_s4_sets", columns: 4 });
  out("look_s4_volt", { ...JSON.parse(fs.readFileSync(`${dir}/r_s4_set_volt.json`, "utf8")), route: [{ wait: 3 }, ...chain3.slice(0, 5), { wait: 4, capture: "the first arc" }, { wait: 6, capture: "the second arc (Volt set)" }, { wait: 20 }], out: "build/look_s4_volt", columns: 3 });
  // a jinx on the floor: a card spot with a warning ring, the panel with its cost and the set line
  out("look_s4_jinx", { start_scene: "test_lab", lua: `${park}; ${RUN}.begin(1); ${give("live_wire")}; ${give("tracer")}; local at = nova.named('cards'); nova.spawn('card', at.x - 160, at.y, { card_id = 'overclock' }); nova.spawn('card', at.x, at.y, { card_id = 'shock_wake' }); nova.spawn('card', at.x + 160, at.y, { card_id = 'debt_spiral' }); ${R0}.x, ${R0}.y = at.x - 160, at.y + 40; nova.scene_now().state = 'cards'`,
    route: [{ wait: 60, capture: "three cards: two jinxes with warning rings" }, { wait: 4, capture: "standing by Overclock: its cost" }, { lua: `${R0}.x = nova.named('cards').x` }, { wait: 5, capture: "by Shock Wake: this completes the set" }], out: "build/look_s4_jinx", columns: 3 });
  out("look_s4_codex", { start_scene: "den", lua: `${META}.upgrades.deeper_deck = 1; ${META}.seen_cards = { live_wire = true, scatter = true, plating = true, metronome = true }; ${META}.last = 'dead'; ${META}.started = true`, route: [...denWake, { walk_to: "codex", who: "runner", max: 900 }, { wait: 3, capture: "the terminal beside LULLABY's screen" }, { press: "interact" }, { wait: 4, capture: "the codex: a seen card" },
    { hold: ["down"], frames: 4 }, { wait: 3, capture: "unseen: ???" }, ...Array.from({ length: 14 }, () => [{ hold: ["down"], frames: 4 }, { wait: 2 }]).flat(), { wait: 3, capture: "a locked card (greyed, its tier)" }, ...Array.from({ length: 7 }, () => [{ hold: ["down"], frames: 4 }, { wait: 2 }]).flat(), { wait: 3, capture: "a jinx, locked" }], out: "build/look_s4_codex", columns: 3 });
}
