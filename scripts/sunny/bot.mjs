// Lets the computer player (examples/sunny-hop/lib/bot.lua) play Sunny Hop's levels, several at once (one headless game each, entered from the
// map with a save that has the levels before it cleared), and reports how each went: its time, the gems it found, how often it fell.
//   scripts/env.sh node scripts/sunny/bot.mjs [level ...]            (cargo build --release -p nova-runtime first)
//   scripts/env.sh node scripts/sunny/bot.mjs --write-targets        also sets each level's star time from the computer's time
// The star time is the computer's time (finding every gem on the way) plus a fifth, rounded up to five seconds; it is written into the props of the
// level's "level" object in its scene file, as the studio's inspector would.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir, availableParallelism } from "node:os";
import { join } from "node:path";

const root = new URL("../..", import.meta.url).pathname;
const game = join(root, "examples/sunny-hop");
const bin = join(root, "target/release/nova");
const work = mkdtempSync(join(tmpdir(), "sunny-bot-"));
const args = process.argv.slice(2);
const write = args.includes("--write-targets");
const ORDER = ["grass-0", ...[1, 2, 3, 4, 5, 6].map((n) => "grass-" + n), ...["sand", "snow", "castle"].flatMap((w) => [1, 2, 3, 4, 5, 6].map((n) => `${w}-${n}`))];
const wanted = args.filter((a) => !a.startsWith("--"));
const ids = wanted.length ? wanted : ORDER;

function runOne(id) {
  const dir = join(work, id);
  mkdirSync(dir, { recursive: true });
  const data = { options: { music: 0, sfx: 0 }, last: id };
  for (const lv of ORDER.slice(0, ORDER.indexOf(id))) data["lv_" + lv] = { done: true, gems: [false, false, false], coins: 0 };
  writeFileSync(join(dir, "save.json"), JSON.stringify({ format: 1, data }));
  // A (menu), A (Play: the map, on this level), A (play it), then F9: the computer plays
  const ev = [40, 70, 170].map((at) => ({ at, for: 2, hold: { "pad:south": 1 } }));
  ev.push({ at: +(process.env.BOT_START || 280), for: 2, hold: { "key:F9": 1 } });
  writeFileSync(join(dir, "input.json"), JSON.stringify(ev));
  return new Promise((done) => {
    const p = spawn(bin, ["run", game, "--headless", "--frames", String(60 * 60 * 6), "--size", "320x180", "--input", join(dir, "input.json"), "--save-dir", dir], { stdio: ["ignore", "ignore", "pipe"] });
    let log = "";
    p.stderr.on("data", (d) => {
      log += d;
      if (/sunny: (finished|bot FAILED)/.test(log)) p.kill();
    });
    p.on("close", () => {
      const lines = log.split("\n").map((l) => l.replace(/.*lua: /, "")).filter((l) => /^sunny: (bot|finished)|error/i.test(l));
      const fin = lines.find((l) => l.startsWith("sunny: finished"));
      const time = fin ? +/time=([\d.]+)/.exec(fin)[1] : null;
      const gems = fin ? /gems=(\d)\/3/.exec(fin)[1] : "-";
      done({ id, time, gems, falls: lines.filter((l) => l.includes("bot fell")).length, gaveup: lines.filter((l) => l.includes("gave up")), failed: !fin, lines });
    });
  });
}

const results = [];
const queue = [...ids];
const lanes = Math.max(1, Math.min(availableParallelism() - 1, 8));
await Promise.all(Array.from({ length: lanes }, async () => {
  while (queue.length) {
    const id = queue.shift();
    const r = await runOne(id);
    results.push(r);
    console.log(`${id.padEnd(9)} ${r.failed ? "NOT FINISHED" : `time ${r.time.toFixed(2).padStart(6)} s  gems ${r.gems}/3`}  falls ${r.falls}${r.gaveup.length ? "  " + r.gaveup.join("; ") : ""}`);
    if (r.failed) console.log("   " + r.lines.slice(-6).join("\n   "));
  }
}));
results.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
const ok = results.filter((r) => !r.failed && r.gems === "3").length;
console.log(`${ok} of ${results.length} levels finished with every gem`);

if (write) {
  for (const r of results) {
    if (r.failed) continue;
    const file = join(game, "scenes/levels", r.id + ".scene.json");
    const text = readFileSync(file, "utf8");
    const target = Math.ceil((r.time * 1.2) / 5) * 5;
    // change only the target's number in the level object's props (the file keeps its layout)
    const next = text.replace(/("kind": "level",[\s\S]*?"props": \{[\s\S]*?)("target": [\d.]+)/, `$1"target": ${target}`);
    const out = next === text && !/"target":/.test(text) ? text.replace(/("kind": "level",[\s\S]*?"props": \{)/, `$1\n        "target": ${target},`) : next;
    writeFileSync(file, out);
    console.log(`${r.id}: star time ${target} s`);
  }
}
