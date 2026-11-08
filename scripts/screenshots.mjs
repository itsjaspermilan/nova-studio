// Takes the screenshots in docs/images/ by running Pine Ridge Rally headless with scripted key presses (see crates/nova-runtime/src/inputscript.rs):
//   scripts/env.sh node scripts/screenshots.mjs            (builds nothing: run `cargo build --release -p nova-runtime` first)
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const game = join(root, "examples/pine-ridge-rally");
const out = join(root, "docs/images");
const bin = join(root, "target/release/nova");
mkdirSync(out, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "nova-shots-"));

const E = "key:Enter", D = "key:ArrowDown", U = "key:ArrowUp", R = "key:ArrowRight";
// a script from a list of taps (each held two frames, twelve frames apart) and then waits and holds
function script(taps, then = []) {
  const ev = [];
  let at = 40;
  for (const k of taps) { ev.push({ at, for: 2, hold: { [k]: 1 } }); at += 12; }
  for (const [wait, hold, frames] of then) { at += wait; if (hold) ev.push({ at, for: frames, hold }); at += frames ?? 0; }
  return { ev, frames: at + 30 };
}
const START = [E, E]; // title -> main menu -> chooser (Mode is the first row)
const startRace = (circuit) => [...START, ...(circuit ? [D, E, ...Array(circuit).fill(R), E, U] : []), U, E];
const startRally = (stage) => [...START, E, R, R, E, ...(stage ? [D, E, ...Array(stage).fill(R), E, U] : []), U, E];
const countdown = 420; // (the wipe going into a race holds the countdown for a moment)

const shots = {
  "title": script([]),
  "options": script([E, D, D, E]),
  "transition": script(startRace(0), [[20, null, 0]]),
  "chooser": script(START),
  "circuits": script([...START, D, E, R, R, R, R, R, R]),
  "cars": script([...START, D, D, E, "key:KeyE", "key:KeyE", "key:KeyE"]),
  "race-pine-ridge": script(startRace(0), [[countdown, null, 0], [0, { "key:F9": 1 }, 2], [60 * 16, null, 0]]),
  "race-dust-valley": script(startRace(1), [[countdown, null, 0], [0, { "key:F9": 1 }, 2], [60 * 9, null, 0]]),
  "race-frost-pass": script(startRace(2), [[countdown, null, 0], [0, { "key:F9": 1 }, 2], [60 * 9, null, 0]]),
  "race-harbour-lights": script(startRace(3), [[countdown, null, 0], [0, { "key:F9": 1 }, 2], [60 * 9, null, 0]]),
  "pause": script(startRace(0), [[countdown, null, 0], [0, { "key:F9": 1 }, 2], [60 * 5, null, 0], [0, { "key:Escape": 1 }, 2], [10, { "key:ArrowDown": 1 }, 2], [30, null, 0]]),
  "rally-stage": script(startRally(0), [[countdown, null, 0], [0, { "key:F9": 1 }, 2], [60 * 13, null, 0]]),
  "rally-results": script(startRally(0), [[countdown, null, 0], [0, { "key:F9": 1 }, 2], [60 * 140, null, 0]]),
  // the courses added on 2026-11-07 (played with everything opened: see UNLOCKED below)
  "race-autumn-glen": script(startRace(4), [[countdown, null, 0], [0, { "key:F9": 1 }, 2], [60 * 11, null, 0]]),
  "race-copper-canyon": script(startRace(6), [[countdown, null, 0], [0, { "key:F9": 1 }, 2], [60 * 14, null, 0]]),
  "race-neon-docks": script(startRace(8), [[countdown, null, 0], [0, { "key:F9": 1 }, 2], [60 * 10, null, 0]]),
  "rally-glacier-night": script(startRally(7), [[countdown, null, 0], [0, { "key:F9": 1 }, 2], [60 * 12, null, 0]]),
};
// shots of courses a new player has not opened yet start from a save in which everything has been won
const UNLOCKED = new Set(["race-autumn-glen", "race-copper-canyon", "race-neon-docks", "rally-glacier-night"]);
const COURSES = ["pine_ridge", "dust_valley", "frost_pass", "harbour_lights", "autumn_glen", "ridge_gp", "copper_canyon", "glacier_ring", "neon_docks", "autumn_summit",
  "stage_pine_ridge", "stage_dust_valley", "stage_frost_pass", "stage_harbour_lights", "stage_autumn_glen", "stage_mesa_run", "stage_canyon", "stage_glacier_night", "stage_harbour_sprint", "stage_marathon"];

const only = process.argv.slice(2);
for (const [name, { ev, frames }] of Object.entries(shots)) {
  if (only.length && !only.includes(name)) continue;
  const input = join(work, `${name}.json`);
  writeFileSync(input, JSON.stringify(ev));
  // (each shot has a save of its own, never the player's: a new player's, or one with everything opened)
  const save = join(work, `save-${name}`);
  mkdirSync(save, { recursive: true });
  if (UNLOCKED.has(name)) {
    const data = { wins: 3 };
    for (const id of COURSES) data[`done_${id}`] = { done: true, place: 1, stars: 3 };
    writeFileSync(join(save, "save.json"), JSON.stringify({ format: 1, data }));
  }
  const r = spawnSync(bin, ["run", game, "--headless", "--frames", String(frames), "--size", "1280x720", "--input", input, "--save-dir", save, "--capture", join(out, `${name}.png`)], { encoding: "utf8" });
  console.log(r.status === 0 ? `docs/images/${name}.png` : `${name}: failed\n${r.stderr}`);
}
