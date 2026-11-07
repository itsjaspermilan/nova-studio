// Screenshots of Nebula Swap, made by running it headless with scripted key presses (like scripts/screenshots.mjs does for the rally):
//   scripts/env.sh node scripts/nebula/screenshots.mjs [name ...]      (cargo build --release -p nova-runtime first)
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("../..", import.meta.url).pathname;
const game = join(root, "examples/nebula-swap");
const out = join(root, "docs/images/nebula");
const bin = join(root, "target/release/nova");
mkdirSync(out, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "nebula-shots-"));

const E = "key:Enter", D = "key:ArrowDown", U = "key:ArrowUp", R = "key:ArrowRight", L = "key:ArrowLeft", AUTO = "key:F9", ESC = "key:Escape";
function script(taps, then = []) {
  const ev = [];
  let at = 40;
  for (const k of taps) { ev.push({ at, for: 2, hold: { [k]: 1 } }); at += 16; }
  for (const [wait, hold, frames] of then) { at += wait; if (hold) ev.push({ at, for: frames, hold }); at += frames ?? 0; }
  return { ev, frames: at + 30 };
}
const intro = 60 * 4;
const shots = {
  "title": script([]),
  "menu": script([E]),
  "pace": script([E, E]),
  "puzzles": script([E, D, E]),
  "options": script([E, D, D, D, E]),
  "garbage-menu": script([E, D, D]),
  "endless": script([E, E, D, E], [[intro, { [AUTO]: 1 }, 2], [60 * 14, null, 0]]),
  "versus": script([E, D, D, E, E], [[intro, { [AUTO]: 1 }, 2], [60 * 25, null, 0]]),
  "puzzle": script([E, D, E, E], [[100, null, 0]]),
  "pause": script([E, E, D, E], [[intro, { [AUTO]: 1 }, 2], [60 * 5, { [ESC]: 1 }, 2], [20, null, 0]]),
  "gameover": script([E, E, D, E], [[intro, null, 0], [60 * 75, null, 0]]),
  "transition": script([E, E, D, E], [[24, null, 0]]),
};
const only = process.argv.slice(2);
for (const [name, { ev, frames }] of Object.entries(shots)) {
  if (only.length && !only.includes(name)) continue;
  const input = join(work, `${name}.json`);
  writeFileSync(input, JSON.stringify(ev));
  const r = spawnSync(bin, ["run", game, "--headless", "--frames", String(frames), "--size", "1280x720", "--input", input, "--capture", join(out, `${name}.png`)], { encoding: "utf8" });
  console.log(r.status === 0 ? `docs/images/nebula/${name}.png` : `${name}: failed\n${r.stderr}`);
  const logs = (r.stderr || "").split("\n").filter((l) => l.includes("nebula:") || /error|panic/i.test(l));
  if (logs.length) console.log("  " + logs.slice(0, 4).join("\n  "));
}
