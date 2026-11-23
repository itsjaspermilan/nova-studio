// Measures the valley's ambience where it is loudest: a rendered minute (the play tool's `audio: true`) at each spot, with the
// music stopped and everything else as the game plays it, then each source alone at its own spot. For each: the loudness over
// the whole minute (LUFS, BS.1770 K-weighted), the loudest three seconds (short-term LUFS), the loudest 400 ms (momentary), the
// peak, and how far the short-term loudness moves (the spread between its quietest and loudest tenth). The music is the yardstick:
// it is measured the same way at the game's volume (0.3).
//
//   scripts/env.sh node examples/mountain-post/tools/ambience.mjs [label] [--quick]
//
// It writes build/ambience-<label>.json and prints a table. `--quick` renders 20 seconds a spot instead of 60.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { GAME, REPO } from "./lib.mjs";

const label = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "now";
const quick = process.argv.includes("--quick");
const FRAMES = quick ? 1200 : 3600;

// ---- loudness (ITU-R BS.1770: the K-weighting's two filters, mean square over both channels) ----------------------------------------
function kWeight(x, fs) {
  const biquad = (b0, b1, b2, a1, a2) => {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    return (v) => { const y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = v; y2 = y1; y1 = y; return y; };
  };
  let K = Math.tan((Math.PI * 1681.974450955533) / fs);
  const Q = 0.7071752369554196, Vh = 10 ** (3.999843853973347 / 20), Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf = biquad((Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
  K = Math.tan((Math.PI * 38.13547087602444) / fs);
  const Q2 = 0.5003270373238773;
  a0 = 1 + K / Q2 + K * K;
  const hp = biquad(1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q2 + K * K) / a0);
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = hp(shelf(x[i]));
  return out;
}
function readWav(file) {
  const b = readFileSync(file);
  let p = 12, fmt = null, data = null;
  while (p < b.length) {
    const id = b.toString("latin1", p, p + 4), len = b.readUInt32LE(p + 4);
    if (id === "fmt ") fmt = { format: b.readUInt16LE(p + 8), ch: b.readUInt16LE(p + 10), rate: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    if (id === "data") data = b.subarray(p + 8, p + 8 + len);
    p += 8 + len + (len & 1);
  }
  const n = data.length / (fmt.bits / 8) / fmt.ch;
  const chans = Array.from({ length: fmt.ch }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < fmt.ch; c++) {
    const o = (i * fmt.ch + c) * (fmt.bits / 8);
    chans[c][i] = fmt.bits === 32 && fmt.format === 3 ? data.readFloatLE(o) : fmt.bits === 16 ? data.readInt16LE(o) / 32768 : data.readInt32LE(o) / 2147483648;
  }
  return { rate: fmt.rate, chans };
}
const db = (ms) => (ms > 1e-12 ? -0.691 + 10 * Math.log10(ms) : -120);
export function loudness(file, skip = 1) {
  const { rate, chans } = readWav(file);
  const start = Math.round(skip * rate); // (the first second: sounds starting, the scene settling)
  const k = chans.map((c) => kWeight(c, rate).subarray(start));
  const n = k[0].length;
  const sq = new Float64Array(n);
  for (const c of k) for (let i = 0; i < n; i++) sq[i] += c[i] * c[i];
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + sq[i];
  const windowed = (len, hop) => { const out = []; const L = Math.round(len * rate), H = Math.round(hop * rate); for (let i = 0; i + L <= n; i += H) out.push(db((pre[i + L] - pre[i]) / L)); return out; };
  const momentary = windowed(0.4, 0.1), short = windowed(3, 0.5);
  const sorted = [...short].sort((a, b) => a - b);
  let peak = 0;
  for (const c of chans) for (let i = start; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]));
  // integrated: gated at -70 LUFS and then 10 LU under the ungated mean (BS.1770-4), on 400 ms blocks
  const blocks = windowed(0.4, 0.1).filter((v) => v > -70);
  const mean = (arr) => db(arr.reduce((s, v) => s + 10 ** ((v + 0.691) / 10), 0) / Math.max(1, arr.length));
  const gate = mean(blocks) - 10;
  const integrated = mean(blocks.filter((v) => v > gate));
  return {
    integrated: r1(integrated), short_max: r1(Math.max(...short)), momentary_max: r1(Math.max(...momentary)), peak_dbfs: r1(20 * Math.log10(peak || 1e-9)),
    spread: r1(sorted[Math.floor(sorted.length * 0.9)] - sorted[Math.floor(sorted.length * 0.1)]),
  };
}
const r1 = (x) => Math.round(x * 10) / 10;

// ---- the runs ---------------------------------------------------------------------------------------------------------------------------
const STOP_MUSIC = "nova.music.stop()";
const PLACE = (x, z, face) => `local p = nova.named('postmaster'); p.x, p.z, p.face = ${x}, ${z}, ${face}; require('lib.camera').reset(${face})`;
// everything but `keep` silenced, every frame (the loops by volume; the birds' and the residents' timers held off)
// (lib/ambience.lua's `gain` silences a loop for good; before it had one, the air was set again by the game every frame, so the
// first measurements' "alone" runs have the air under them)
const SOLO = (keep) => `local A = require('lib.ambience'); if A.gain then for k in pairs(A.gain) do A.gain[k] = (k == '${keep}') and 1 or 0 end end; ` +
  `for k, id in pairs(A.playing) do if k ~= '${keep}' then nova.sound.set(id, { volume = 0 }) end end; ` +
  (keep === "birds" ? "" : "A.bird_t = 99; ") +
  (keep === "saw" ? "" : "local h = nova.named('hazel'); if h then h.work_sound_t = 99 end; ") +
  (keep === "tinker" ? "" : "local q = nova.named('pip'); if q then q.work_sound_t = 99 end; ");
const SPOTS = {
  // on foot on the creek's bridge, and on its bank beside it
  bridge: PLACE(-105, 55.2, 1.57),
  // by Pip's gate (his mailbox), his radio mast and his cabin ahead, far enough that he goes on tinkering (he stops for a visitor)
  pip: PLACE(-173, 97, -0.9),
  // at Hazel's gate while she saws (near enough to talk to she stops and comes over)
  hazel: PLACE(143, 40, 0.8),
  // the post office's yard: the forest's air and the birds
  yard: PLACE(10, -175, 0),
};
const RUNS = [
  ...Object.keys(SPOTS).map((s) => ({ name: `${s}: all`, spot: s })),
  { name: "bridge: creek alone", spot: "bridge", solo: "creek" },
  { name: "pip: radio alone", spot: "pip", solo: "radio" },
  { name: "pip: tinkering alone", spot: "pip", solo: "tinker" },
  { name: "hazel: saw alone", spot: "hazel", solo: "saw" },
  { name: "yard: air alone", spot: "yard", solo: "air" },
  { name: "yard: birds alone", spot: "yard", solo: "birds" },
  // driving east to west over the bridge (the engine and tyres silenced: the ambience as the camera rushes past it)
  { name: "driving over the bridge: all", drive: true },
];

function run(r) {
  const out = join("build", "amb", r.name.replace(/[^a-z]+/gi, "_"));
  rmSync(join(GAME, out), { recursive: true, force: true });
  const each = [r.solo ? SOLO(r.solo) : "", r.drive ? "local v = nova.named('van'); v.engine_on = false" : ""].filter(Boolean).join("; ");
  const plan = {
    size: "64x64", start_scene: "valley", audio: true, out,
    lua: "T = require('lib.testkit')",
    route: r.drive
      ? [{ wait: 2, lua: `${STOP_MUSIC}; local v = nova.named('van'); v:teleport(-40, 26, -1.57); local s = nova.scene_now(); s.mode = 'van'; v.driven = true; nova.named('postmaster').seated = true; require('lib.camera').reset(-1.57); T.drive('pip')` }, { wait: FRAMES }]
      : [{ wait: 2, lua: `${STOP_MUSIC}; ${SPOTS[r.spot]}` }, { wait: FRAMES }],
    ...(each ? { each_frame: each } : {}),
  };
  mkdirSync(join(GAME, "build", "amb"), { recursive: true });
  const args = join(GAME, "build", "amb", "plan.json");
  writeFileSync(args, JSON.stringify(plan));
  execFileSync(join(REPO, "scripts/nova-tool"), ["--project", GAME, "play", `@${args}`], { cwd: REPO, encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] });
  // (how many of each one-shot started: the birds, the saw's strokes, the tinkering, so a quiet "alone" is not a silent one)
  const started = {};
  try {
    const rep = JSON.parse(readFileSync(join(GAME, out, "report.json"), "utf8"));
    for (const s of rep.sounds ?? []) {
      const name = (/^sound (\S+)/.exec(String(s.text ?? ""))?.[1] ?? "").replace(/\d+$/, "");
      if (/^(bird_a|bird_b|saw|tinker)$/.test(name)) started[name] = (started[name] ?? 0) + 1;
    }
  } catch { /* no report */ }
  return { ...loudness(join(GAME, out, "run.wav")), started };
}

const results = {};
for (const r of RUNS) {
  results[r.name] = run(r);
  console.log(`${r.name.padEnd(34)} ${JSON.stringify(results[r.name])}`);
}
// the yardstick: the song at the game's volume on foot (0.3), its first minute and a half
const song = join(GAME, "build", "amb", "music.wav");
execFileSync(join(REPO, "scripts/nova-tool"), ["--project", GAME, "play", JSON.stringify({ size: "64x64", start_scene: "valley", audio: true, out: "build/amb/music",
  each_frame: "local A = require('lib.ambience'); for k, id in pairs(A.playing) do nova.sound.set(id, { volume = 0 }) end; A.bird_t = 99; local h = nova.named('hazel'); if h then h.work_sound_t = 99 end; local q = nova.named('pip'); if q then q.work_sound_t = 99 end",
  route: [{ wait: 2, lua: PLACE(10, -175, 0) }, { wait: FRAMES }] })], { cwd: REPO, encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] });
results["music (on foot, volume 0.3)"] = loudness(join(GAME, "build/amb/music/run.wav"), 3);
console.log(`${"music (on foot, volume 0.3)".padEnd(34)} ${JSON.stringify(results["music (on foot, volume 0.3)"])}`);
writeFileSync(join(GAME, "build", `ambience-${label}.json`), JSON.stringify(results, null, 1));
void song;
