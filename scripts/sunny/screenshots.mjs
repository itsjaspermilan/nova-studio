// Screenshots of Sunny Hop for docs/images/sunny-hop/, made by running it headless with scripted key presses and prepared save data (F9 in a
// level lets the computer play it, so the shots show real play):
//   scripts/env.sh node scripts/sunny/screenshots.mjs [name ...]      (cargo build --release -p nova-runtime first)
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("../..", import.meta.url).pathname;
const game = join(root, "examples/sunny-hop");
const out = join(root, "docs/images/sunny-hop");
const bin = join(root, "target/release/nova");
mkdirSync(out, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "sunny-shots-"));

const A = "pad:south", ESC = "key:Escape", BOT = "key:F9", Y = "pad:north", R = "key:ArrowRight";
// taps from frame 40, 24 frames apart, then waits ([frames, source to tap or null])
function script(taps, then = []) {
  const ev = [];
  let at = 40;
  for (const k of taps) { ev.push({ at, for: 2, hold: { [k]: 1 } }); at += 24; }
  for (const [wait, key] of then) { at += wait; if (key) { ev.push({ at, for: 2, hold: { [key]: 1 } }); at += 2; } }
  return { ev, frames: at + 2 };
}
const ORDER = ["grass-0", ...[1, 2, 3, 4, 5, 6].map((n) => "grass-" + n), ...["sand", "snow", "castle"].flatMap((w) => [1, 2, 3, 4, 5, 6].map((n) => `${w}-${n}`))];
// a save with the levels before `id` cleared (some gems found), the map's cursor on `id`
const save = (id, extra = {}) => {
  const o = { options: { music: 0.8, sfx: 0.9 }, last: id };
  for (const lv of ORDER.slice(0, ORDER.indexOf(id))) {
    const k = ORDER.indexOf(lv);
    o["lv_" + lv] = { done: true, gems: [true, k % 2 === 0, k % 3 !== 1], best: 40 + k, coins: 20 + k };
  }
  return { ...o, ...extra };
};
// into a level from the title: A (menu), A (Play: the map, on the saved level), A (play it)
const play = (id, seconds, extra = []) => ({ ...script([A, A], [[100, A], [80, null], [10, BOT], [60 * seconds, null], ...extra]), save: save(id) });
const shots = {
  "title": script([]),
  "menu": script([A]),
  "map": { ...script([A, A], [[90, null]]), save: save("grass-3") },
  "map-snow": { ...script([A, A], [[90, null]]), save: save("snow-2") },
  "first-hops": { ...script([A, A], [[100, A], [140, null]]), save: save("grass-0") },
  "meadow": play("grass-1", 9),
  "bee-creek": play("grass-3", 7),
  "dunes": play("sand-2", 12),
  "pyramid": play("sand-3", 14),
  "frozen-lake": play("snow-3", 10),
  "castle": play("castle-1", 8),
  "lava": play("castle-2", 7),
  "king-slime": play("grass-6", 30),
  "fire-king": play("castle-6", 34),
  "pause": { ...script([A, A], [[100, A], [140, ESC], [30, null]]), save: save("grass-2") },
  "trial": { ...script([A, A], [[100, Y], [120, null]]), save: save("grass-2", { last: "grass-1" }) },
  "results": play("grass-0", 60),
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
  console.log(r.status === 0 ? `docs/images/sunny-hop/${name}.png` : `${name}: failed\n${r.stderr}`);
  const logs = (r.stderr || "").split("\n").filter((l) => /sunny: (finished|bot|play)|error|panic/i.test(l));
  if (logs.length) console.log("  " + logs.slice(0, 4).map((l) => l.replace(/.*lua: /, "")).join("\n  "));
}
