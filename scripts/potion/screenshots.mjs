// Screenshots of Potion Panic, made by running it headless with scripted key presses:
//   scripts/env.sh node scripts/potion/screenshots.mjs [name ...]      (cargo build --release -p nova-runtime first)
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("../..", import.meta.url).pathname;
const game = join(root, "examples/potion-panic");
const out = join(root, "docs/images/potion");
const bin = join(root, "target/release/nova");
mkdirSync(out, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "potion-shots-"));

const E = "key:Enter", D = "key:ArrowDown", U = "key:ArrowUp", R = "key:ArrowRight", L = "key:ArrowLeft", AUTO = "key:F9", ESC = "key:Escape";
function script(taps, then = []) {
  const ev = [];
  let at = 40;
  for (const k of taps) { ev.push({ at, for: 2, hold: { [k]: 1 } }); at += 20; }
  for (const [wait, hold, frames] of then) { at += wait; if (hold) ev.push({ at, for: frames, hold }); at += frames ?? 0; }
  return { ev, frames: at + 30 };
}
const story = Array(12).fill(E); // (Enter through a story card)
const intro = 60 * 4.2;
// the campaign from the title: Enter (title), Enter (Story campaign), then the intro story (3 cards: skip with Escape), then the map
const toMap = [E, E, ESC];
// saves to start from: the levels beaten so far (all three stars) and the story seen
const ids = ["m1", "m2", "m3", "f1", "f2", "f3", "e1", "e2", "e3", "r1", "r2", "r3"];
const save = (cleared, seen = true) => {
  const o = { options: { music: 0.8, sfx: 0.9, smooth: true, vibration: true } };
  for (let i = 0; i < cleared; i++) { o["stars_" + ids[i]] = 3; o["best_" + ids[i]] = 500; o["free_" + ids[i]] = 400 + i * 20; }
  if (seen) { o.seen_intro = true; for (let b = 1; b <= 4; b++) o["seen_biome" + b] = true; }
  return o;
};
const shots = {
  "title": script([]),
  "menu": script([E]),
  "map": { ...script([E, E]), save: save(2) },
  "map-frost": { ...script([E, E, R, R, R]), save: save(5) },
  "free": { ...script([E, D, E]), save: save(7) },
  "options": script([E, D, D, E]),
  "story": script([E, E], [[120, null, 0]]),
  "meadow": script([...toMap, E, ESC], [[intro, { [AUTO]: 1 }, 2], [60 * 55, null, 0]]),
  "frost": { ...script([E, E, E], [[intro, { [AUTO]: 1 }, 2], [60 * 50, null, 0]]), save: save(3) },
  "ember": { ...script([E, E, E], [[intro, { [AUTO]: 1 }, 2], [60 * 50, null, 0]]), save: save(6) },
  "mire": { ...script([E, E, E], [[intro, { [AUTO]: 1 }, 2], [60 * 50, null, 0]]), save: save(9) },
  "free-rules": { ...script([E, D, E, E], [[40, null, 0]]), save: save(7) },
  "free-picked": { ...script([E, D, E], [[40, null, 0]]), save: save(7) },
  "pause": script([...toMap, E, ESC], [[intro, null, 0], [60 * 5, { [ESC]: 1 }, 2], [30, null, 0]]),
  "intro": script([...toMap, E, ESC], [[90, null, 0]]),
  "results": script([...toMap, E, ESC], [[intro, { [AUTO]: 1 }, 2], [60 * 190, null, 0]]),
  "transition": script([...toMap, E, ESC], [[20, null, 0]]),
};
const only = process.argv.slice(2);
for (const [name, { ev, frames, save: saved }] of Object.entries(shots)) {
  if (only.length && !only.includes(name)) continue;
  const input = join(work, `${name}.json`);
  writeFileSync(input, JSON.stringify(ev));
  const args = ["run", game, "--headless", "--frames", String(frames), "--size", "1280x720", "--input", input, "--capture", join(out, `${name}.png`)];
  if (saved) {
    const dir = join(work, "save-" + name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "save.json"), JSON.stringify({ format: 1, data: saved }));
    args.push("--save-dir", dir);
  }
  const r = spawnSync(bin, args, { encoding: "utf8" });
  console.log(r.status === 0 ? `docs/images/potion/${name}.png` : `${name}: failed\n${r.stderr}`);
  const logs = (r.stderr || "").split("\n").filter((l) => l.includes("potion:") || /error|panic/i.test(l));
  if (logs.length) console.log("  " + logs.slice(0, 4).join("\n  "));
}
