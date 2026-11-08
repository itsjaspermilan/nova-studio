// Screenshots of Moving Day, made by running it headless with scripted key presses (docs/images/moving-day/):
//   scripts/env.sh node scripts/moving-day/screenshots.mjs [name ...]      (cargo build --release -p nova-runtime first)
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("../..", import.meta.url).pathname;
const game = join(root, "examples/moving-day");
const out = join(root, "docs/images/moving-day");
const bin = join(root, "target/release/nova");
mkdirSync(out, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "moving-day-shots-"));

const A = "key:Enter", D = "key:ArrowDown", U = "key:ArrowUp", R = "key:ArrowRight", L = "key:ArrowLeft", AUTO = "key:F9", PAUSE = "key:Escape", RB = "key:PageDown";
// taps from frame 70 (after the first wipe), 20 frames apart, then [wait, hold, frames] steps
function script(taps, then = []) {
  const ev = [];
  let at = 70;
  for (const k of taps) { ev.push({ at, for: 2, hold: { [k]: 1 } }); at += 20; }
  for (const [wait, hold, frames] of then) { at += wait; if (hold) ev.push({ at, for: frames, hold }); at += frames ?? 0; }
  return { ev, frames: at + 20 };
}
// a save with the first `n` flats solved (stars as given, else three)
const save = (n, stars = 3) => {
  const o = { options: { music: 0.8, sfx: 0.9, smooth: true }, tutorial_done: true };
  for (let i = 1; i <= n; i++) { o["stars_" + i] = typeof stars === "function" ? stars(i) : stars; o["best_" + i] = 10 + i * 2; }
  return o;
};
// play the next flat from the level select (it opens on the first flat not yet solved: the save decides which)
const toFlat = () => [D, A, A];
const wipe = 80;
const shots = {
  "title": { ...script([], [[60, null, 0]]), save: save(9) },
  "streets": { ...script([D, A], [[40, null, 0]]), save: save(8, (i) => 1 + (i % 3)) },
  "streets-flats": { ...script([D, A, RB, RB, RB], [[40, null, 0]]), save: save(24, (i) => 1 + (i % 3)) },
  "tutorial": script([A], [[wipe, null, 0], [10, { [R]: 1 }, 2], [40, null, 0]]),
  "play-cottage": { ...script(toFlat(7), [[wipe, null, 0], [20, null, 0]]), save: save(6) },
  "play-townhouse": { ...script(toFlat(13), [[wipe, null, 0], [20, null, 0]]), save: save(12) },
  "play-penthouse": { ...script(toFlat(26), [[wipe, null, 0], [20, null, 0]]), save: save(25) },
  "turning": { ...script(toFlat(3), [[wipe, { [AUTO]: 1 }, 2], [22, null, 0]]), save: save(2) },
  "wish-granted": { ...script(toFlat(4), [[wipe, { [AUTO]: 1 }, 2], [110, null, 0]]), save: save(3) },
  "solved": { ...script(toFlat(6), [[wipe, { [AUTO]: 1 }, 2], [60 * 4, null, 0]]), save: save(5) },
  "results": { ...script(toFlat(2), [[wipe, { [AUTO]: 1 }, 2], [60 * 6, null, 0]]), save: save(1) },
  "pause": { ...script(toFlat(5), [[wipe, null, 0], [10, { [PAUSE]: 1 }, 2], [30, null, 0]]), save: save(4) },
  "options": script([D, D, D, A], [[30, null, 0]]),
  "transition": { ...script(toFlat(9), [[22, null, 0]]), save: save(8) },
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
  console.log(r.status === 0 ? `docs/images/moving-day/${name}.png` : `${name}: failed\n${r.stderr}`);
  const logs = (r.stderr || "").split("\n").filter((l) => l.includes("play:") || /error|panic/i.test(l));
  if (logs.length) console.log("  " + logs.slice(0, 4).join("\n  "));
}
