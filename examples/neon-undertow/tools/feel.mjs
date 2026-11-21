// The gallery of the feel pass: plays each effect headless and keeps its film strip as a contact sheet in build/gallery/feel/.
//   scripts/env.sh node examples/neon-undertow/tools/feel.mjs [name ...]
// Every sheet is the `play` tool's own strip: the frames of the effect side by side, cut to a spot at the effect's middle.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const project = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const repo = project + "/../..";
const gallery = project + "/build/gallery/feel";
fs.mkdirSync(gallery, { recursive: true });
const scratch = repo + "/build/feel-args";
fs.mkdirSync(scratch, { recursive: true });

const R0 = "nova.named('runner')";
// a test lab with the runner parked and a spot where the effect happens (the pictures are cut to it)
const lab = (cx, cy, extra = "", runner = [cx - 150, cy + 70, "right"]) =>
  `local r = ${R0}; r.x, r.y, r.facing = ${runner[0]}, ${runner[1]}, '${runner[2]}'; r.hp = 99; r.max_hp = 99; SP = nova.spawn('spot', ${cx}, ${cy}); ${extra}`;
const waits = (list) => list.flatMap(([n, cap]) => [{ wait: n, ...(cap ? { capture: cap } : {}) }]);
const strip = (frames, first = 0) => frames.map((n, i) => ({ wait: i === 0 ? n - first : n - frames[i - 1], capture: `f${n}` }));

export const effects = {
  // an explosive barrel: the fuse, then the blast, every few frames
  barrel: { start_scene: "test_lab", lua: lab(700, 420, "B1 = nova.spawn('barrel', 700, 420)"), route: [{ wait: 2 }, { lua: "B1:take_hit(1, 1, 0, 0)" }, { wait: 12, capture: "fuse" }, { wait: 44, capture: "tell" }, { until: "not B1:is_alive()", max: 100 }, ...waits([[2, "+2"], [3, "+5"], [3, "+8"], [4, "+12"], [4, "+16"], [5, "+21"], [6, "+27"], [8, "+35"], [10, "+45"], [14, "+59"], [20, "+79"], [60, "+139"]])], crop_margin: 190, columns: 5, zoom: 1 },
};

// the runner running in each direction: a picture every 3 frames (the clip's 8 frames last 22 frames), then a sharp turn
const runStrip = (dir, hold) => ({ start_scene: "test_lab", crop_to: "runner", crop_margin: 70, columns: 8, zoom: 1.4,
  lua: `local r = ${R0}; r.x, r.y, r.facing = 640, 420, '${dir}'; r.hp = 99`,
  route: [{ wait: 4 }, { hold: [hold], frames: 3, capture: "start" }, ...Array.from({ length: 15 }, (_, i) => ({ hold: [hold], frames: 3, capture: `${(i + 2) * 3}` }))] });
effects.run_right = runStrip("right", "right");
effects.run_left = runStrip("left", "left");
effects.run_down = runStrip("down", "down");
effects.run_up = runStrip("up", "up");
// start, then a turn straight back: dust at both
effects.run_turn = { start_scene: "test_lab", crop_to: "runner", crop_margin: 90, columns: 8, zoom: 1.2, lua: `local r = ${R0}; r.x, r.y, r.facing = 560, 420, 'right'; r.hp = 99`,
  route: [{ wait: 4, capture: "idle" }, { hold: ["right"], frames: 3, capture: "start: dust" }, { hold: ["right"], frames: 3 }, { hold: ["right"], frames: 3, capture: "run" }, { hold: ["right"], frames: 6 }, { hold: ["right"], frames: 6, capture: "run" }, { hold: ["left"], frames: 2, capture: "turn: dust" }, { hold: ["left"], frames: 3, capture: "" }, { hold: ["left"], frames: 3, capture: "" }, { hold: ["left"], frames: 4, capture: "" }], print: ["nova.named('runner').dust_starts", "nova.named('runner').dust_turns"] };

// the baton: the first hit frame by frame, a dummy in front of the box so the sparks show; and the third (heavy) one
const hits = (n, facing = "right") => ({ start_scene: "test_lab", crop_margin: 130, columns: 8, zoom: 1.5,
  lua: lab(700, 420, `r.x, r.y, r.facing = 625, 420, '${facing}'; nova.spawn('dummy', 720, 420)`, [625, 420, facing]),
  route: [{ wait: 3 }, ...Array.from({ length: n }, (_, k) => [{ press: "attack" }, { wait: 1 }, ...Array.from({ length: 4 }, (_, j) => ({ wait: 1, capture: `hit ${k + 1} +${j + 4}` })), ...Array.from({ length: 5 }, (_, j) => ({ wait: 1, capture: `+${j + 8}` })), { wait: 3 }]).flat()] });
effects.baton_1 = { ...hits(1), route: [{ wait: 3, capture: "ready" }, { press: "attack" }, ...Array.from({ length: 14 }, (_, j) => ({ wait: 1, capture: `+${j + 3}` }))] };
effects.baton_3 = { ...hits(1), route: [{ wait: 3 }, { press: "attack" }, { wait: 14 }, { press: "attack" }, { wait: 14 }, { press: "attack" }, ...Array.from({ length: 14 }, (_, j) => ({ wait: 1, capture: `3rd +${j + 3}` }))] };
effects.baton_up = { ...hits(1, "up"), lua: lab(700, 420, "r.x, r.y, r.facing = 700, 500, 'up'; nova.spawn('dummy', 700, 400)", [700, 500, "up"]), route: [{ wait: 3 }, { press: "attack" }, ...Array.from({ length: 10 }, (_, j) => ({ wait: 1, capture: `+${j + 3}` }))] };
// the Scrapper's pipe: the tell filling the box, then the swing
effects.scrapper = { start_scene: "test_lab", crop_margin: 150, columns: 5, zoom: 1.2,
  lua: lab(700, 420, "r.x, r.y = 770, 420; S1 = nova.spawn('scrapper', 660, 420); S1.facing = 'right'; S1.state = 'tell'; S1.t = 0"),
  route: [{ wait: 6, capture: "tell" }, { wait: 12, capture: "tell" }, { wait: 12, capture: "tell" }, { until: "S1.state == 'swing'", max: 60 }, ...Array.from({ length: 10 }, (_, j) => ({ wait: 1, capture: `swing +${j}` }))] };

// the player's shot: the muzzle flash, the bolt with its trail, the impact on a dummy
effects.shot = { start_scene: "test_lab", crop_margin: 190, columns: 5, zoom: 1,
  lua: lab(600, 420, "r.charge = 3; nova.spawn('dummy', 690, 420)", [470, 420, "right"]),
  route: [{ wait: 3 }, { hold: ["ranged", "right"], frames: 8 }, { wait: 1, capture: "fires" }, { wait: 2, capture: "+3" }, { wait: 2, capture: "+5" }, { wait: 3, capture: "+8" }, { wait: 3, capture: "+11" }, { wait: 2, capture: "+13" }, { wait: 2, capture: "+15" }, { wait: 2, capture: "+17" }, { wait: 2, capture: "hit" }, { wait: 2, capture: "+21" }, { wait: 3, capture: "+24" }, { wait: 4, capture: "+28" }] };

// effects of the routes already kept: the same start, a new route of captures. `spot` = [x, y] the pictures are cut to (or crop_to).
const base = (n) => JSON.parse(fs.readFileSync(`${project}/tools/r_${n}.json`, "utf8"));
const from = (n, spot, route, extra = {}) => { const b = base(n); return { start_scene: b.start_scene, lua: b.lua + (spot ? `; SP = nova.spawn('spot', ${spot[0]}, ${spot[1]})` : ""), route, columns: 5, ...extra }; };
const burst = (n, gap = 3, label = "+") => Array.from({ length: n }, (_, i) => ({ wait: gap, capture: `${label}${(i + 1) * gap}` }));
effects.thrower = from("thrower", [650, 420], [{ until: "nova.first('bottle_thrower').state == 'tell'", max: 120, capture: "tell" }, { wait: 24, capture: "tell, late" }, { until: "nova.count('bottle') > 0", max: 80, capture: "thrown" }, { wait: 14, capture: "flying" }, { wait: 14, capture: "flying" }, { wait: 12, capture: "about to land" }, { until: "nova.count('fire') > 0", max: 80, capture: "smash" }, ...burst(6, 3), { wait: 30, capture: "burning" }, { wait: 40, capture: "burning" }], { crop_margin: 230, zoom: 1 });
effects.tram = from("tram", [700, 500], [{ lua: "nova.named('runner').x, nova.named('runner').y = 820, 380" }, { until: "TR.state == 'warn'", max: 100 }, { wait: 10, capture: "bell" }, { wait: 30, capture: "warn" }, { wait: 30, capture: "warn, late" }, { until: "TR.state == 'cross'", max: 100, capture: "crosses" }, { wait: 20, capture: "+20" }, { wait: 6, capture: "+26" }, { wait: 6, capture: "+32" }, { wait: 6, capture: "+38" }, { wait: 6, capture: "+44" }, { wait: 6, capture: "+50" }, { wait: 10, capture: "+60" }], { crop_margin: 280, columns: 4 });
effects.puddle = from("sign_puddle", [650, 320], [{ wait: 3, capture: "a sign over a puddle" }, { lua: "nova.named('runner').x = 400; nova.named('runner').facing = 'right'" }, { wait: 4 }, { hold: ["ranged"], frames: 6 }, { wait: 8, capture: "the shot flies" }, { wait: 4, capture: "+4" }, { wait: 4, capture: "the sign falls" }, { wait: 4, capture: "+" }, ...burst(5, 5), { wait: 40, capture: "live" }, { wait: 90, capture: "live" }], { crop_margin: 250 });
effects.drone = from("drone_wall", [330, 600], [{ until: "nova.first('rat_drone').state == 'tell'", max: 60, capture: "rev-up" }, { wait: 14, capture: "rev-up" }, { wait: 14, capture: "rev-up, late" }, { until: "nova.first('rat_drone').state == 'charge'", max: 60, capture: "charge" }, { wait: 6, capture: "+6" }, { wait: 6, capture: "+12" }, { until: "nova.first('rat_drone').state == 'stunned'", max: 90, capture: "crash" }, ...burst(4, 3)], { crop_margin: 230 });
effects.mimic = from("mimic", [760, 540], [{ lua: "nova.named('runner').x = 780; nova.named('runner').hp = 99; nova.named('runner').max_hp = 99" }, { until: "nova.first('mimic_vendor').state == 'flicker'", max: 200, capture: "flicker" }, { wait: 12, capture: "tell" }, { wait: 12, capture: "tell, late" }, { until: "nova.first('mimic_vendor').state == 'spit'", max: 60, capture: "spits" }, ...burst(5, 3)], { crop_margin: 260, zoom: 1 });
effects.tout = { start_scene: "test_lab", crop_margin: 230, columns: 5, lua: lab(700, 420, "TO = nova.spawn('tout', 700, 420); TO.t = require('data.enemies').tout.pulse_every - 0.2; SC = nova.spawn('scrapper', 780, 460); SC.hp = 40; require('lib.status').stun(SC, 99)", [560, 420, "right"]),
  route: [{ wait: 10 }, ...Array.from({ length: 12 }, (_, i) => ({ wait: 5, capture: `+${i * 5 + 15}` }))] };
effects.boss_lanes = from("boss_lane_hit", null, [{ wait: 25 }, { lua: "nova.named('coil'):cast('lanes')" }, { wait: 10, capture: "lit" }, { wait: 25, capture: "filling" }, { wait: 25, capture: "filling" }, { wait: 12, capture: "the junk" }, { wait: 10, capture: "+" }, { wait: 10, capture: "+" }, { wait: 10, capture: "+" }, { wait: 10, capture: "+" }], { crop_to: "runner", crop_margin: 330, columns: 5, zoom: 0.8 });
effects.boss_car = from("boss_car", null, [{ wait: 25 }, { lua: "nova.spawn('coil_car', 900, 700, { delay = 0 })" }, { wait: 20, capture: "shadow" }, { wait: 20, capture: "shadow" }, { wait: 14, capture: "falling" }, { until: "nova.count('coil_car') == 0", max: 200 }, ...burst(9, 4)], { crop_to: "runner", crop_margin: 300, columns: 5 });
effects.boss_magnet = from("boss_car", null, [{ wait: 25 }, { lua: "nova.spawn('coil_magnet', nova.named('runner').x, nova.named('runner').y - 200, { boss = nova.named('coil') })" }, { wait: 20, capture: "tracking" }, { wait: 25, capture: "tracking" }, { until: "nova.first('coil_magnet').state == 'lock'", max: 100 }, { wait: 6, capture: "lock" }, { wait: 20, capture: "lock" }, { wait: 20, capture: "lock, late" }, { until: "nova.first('coil_magnet').state == 'linger'", max: 100 }, ...burst(6, 3)], { crop_to: "runner", crop_margin: 280, columns: 5 });
effects.elite_shield = from("elite_shielded", [650, 540], [{ wait: 6, capture: "shield" }, { wait: 6, capture: "shield" }, { wait: 6, capture: "shield" }], { crop_margin: 230, columns: 3, zoom: 1.4 });
effects.elite_magnet = { start_scene: "test_lab", crop_margin: 250, columns: 5, lua: lab(700, 420, "E = nova.spawn('scrapper', 700, 420); E.hp = 30; require('lib.status').stun(E, 99); require('lib.elite').make(E, 'magnetic')", [520, 420, "right"]), route: Array.from({ length: 10 }, (_, i) => ({ wait: 7, capture: `+${i * 7 + 7}` })) };
effects.elite_link = from("elite_linked", [850, 540], [{ wait: 30 }, { wait: 8, capture: "the cord" }, { wait: 5, capture: "+" }, { wait: 5, capture: "+" }, { wait: 5, capture: "+" }], { crop_margin: 160, columns: 4, zoom: 1.4 });
effects.volatile = from("elite_volatile", [740, 560], [{ wait: 3 }, { lua: "E:take_hit(99, 0, 0, 0)" }, { wait: 10, capture: "fuse" }, { wait: 30, capture: "fuse" }, { wait: 20, capture: "fuse, late" }, { until: "nova.count('fuse') == 0", max: 100 }, ...burst(8, 4)], { crop_margin: 230, columns: 5 });
effects.zap = { start_scene: "test_lab", crop_margin: 180, columns: 5, lua: lab(700, 420, "A1 = nova.spawn('scrapper', 640, 420); B1 = nova.spawn('scrapper', 780, 460); A1.hp = 50; B1.hp = 50; require('lib.status').stun(A1, 99); require('lib.status').stun(B1, 99)", [560, 420, "right"]),
  route: [{ wait: 3 }, { lua: "nova.spawn('zap', 640, 392, { x2 = 780, y2 = 432 }); nova.spawn('zap', 640, 392, { x2 = 700, y2 = 360, color = { 255, 43, 214 } })" }, { wait: 1, capture: "bolt" }, { wait: 2, capture: "+3" }, { wait: 2, capture: "+5" }, { wait: 2, capture: "+7" }, { wait: 3, capture: "+10" }, { wait: 4, capture: "+14" }] };
effects.death = { start_scene: "test_lab", crop_margin: 130, columns: 6, zoom: 1.4, lua: lab(700, 420, "SC = nova.spawn('scrapper', 700, 420); SC.hp = 4", [560, 420, "right"]), route: [{ wait: 3 }, { lua: "SC:take_hit(99, 1, 0, 0)" }, ...burst(11, 3)] };

// the roll: 4.2 tiles in 0.34 s (21 frames): a picture every 2 frames, the after-images along the path
effects.roll = { start_scene: "test_lab", crop_margin: 170, columns: 6, zoom: 1,
  lua: lab(660, 420, "r.x, r.y, r.facing = 540, 420, 'right'; r.charge = 3", [540, 420, "right"]),
  route: [{ wait: 3, capture: "ready" }, { hold: ["right"], tap: "dash", tap_every: 200, until: "nova.named('runner').state == 'roll'", max: 6 }, ...Array.from({ length: 10 }, (_, i) => ({ hold: ["right"], frames: 2, capture: `roll +${(i + 1) * 2}` })), { hold: ["right"], frames: 2, capture: "free again" }] };

// the cheaper versions: "Effects: low" and "off" (the pause screen's switch): the same blast with fewer particles and no glow, scorch or light
for (const q of ["low", "off"]) effects[`barrel_${q}`] = { ...effects.barrel, lua: effects.barrel.lua + `; local L = require('lib.look'); L.quality = '${q}'; nova.effects('${q}')`, columns: 6 };

const want = process.argv.slice(2);
for (const [name, args] of Object.entries(effects)) {
  if (want.length && !want.includes(name)) continue;
  const plan = { crop_to: "spot", ...args, out: `build/feel_${name}`, state: "none" };
  const file = `${scratch}/${name}.json`;
  fs.writeFileSync(file, JSON.stringify(plan));
  const text = execFileSync(repo + "/scripts/nova-tool", ["--project", project, "play", "@" + file], { encoding: "utf8", cwd: repo, maxBuffer: 1 << 26 });
  const warn = text.split("\n").filter((l) => /WARNING|ERROR|error/.test(l)).slice(0, 4);
  fs.copyFileSync(`${project}/build/feel_${name}/strip.png`, `${gallery}/${name}.png`);
  console.log(`${name}: ${gallery}/${name}.png${warn.length ? "\n  " + warn.join("\n  ") : ""}`);
}
export { strip };
