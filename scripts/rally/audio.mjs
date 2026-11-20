// The rally game's sound effects and music.
//   - the beeps and the music: through the Nova MCP server's `sfx_write` and `song_write` tools (the studio's own editors)
//   - the sounds of driving (tyres on each surface, wind, the turbo, the gear whine, bumps, knocks, scrapes, gear changes): made
//     here, sample by sample (`driving()` below), with the tools of scripts/rally/engines.mjs, which makes the engines themselves
//
//   node scripts/rally/audio.mjs            everything
//   node scripts/rally/audio.mjs driving    only the sounds of driving (no MCP server, the music is left alone)
import fs from "node:fs";
import path from "node:path";
import { RATE, ROOT, Rand, applyH, bp, bump, drift, filtered, hp2, level, lp1, noiseLoop, peak, put, rms, scaled, signal, spectrum, writeWav } from "./engines.mjs";

// ---- sound effects: the sound editor's settings, by name --------------------------------------------------------------
// (menu_move, menu_accept, menu_back, pause and bump are Kenney's interface and impact sounds now: scripts/rally/kenney-ui.sh)
const sfx = {
  beep: { params: { wave: "sine", freq: 440, attack: 0.005, sustain: 0.18, decay: 0.12, volume: 0.55 } },
  go: { params: { wave: "sine", freq: 880, attack: 0.005, sustain: 0.4, decay: 0.3, punch: 0.3, volume: 0.6 } },
  checkpoint: { params: { wave: "triangle", freq: 700, arpSemitones: 5, arpTime: 0.05, attack: 0, sustain: 0.06, decay: 0.16, volume: 0.45 } },
  finish: { params: { wave: "square", freq: 392, arpSemitones: 9, arpTime: 0.14, attack: 0, sustain: 0.5, decay: 0.7, duty: 0.4, punch: 0.3, volume: 0.5 } },
  // (the engines are made by scripts/rally/engines.mjs, and the tyres, the wind, the gear changes and the knocks by `driving()` below:
  // the sound editor's one filtered noise was all that the old gravel_loop, skid_loop, shift and whoosh could be)
};

// ---- the sounds of driving ---------------------------------------------------------------------------------------------------
// Loops are built round the circle like the engines (noise is given its spectrum directly, grains and knocks wrap, slow swells are
// loops of the same length), so none has a seam; the game steers each one's volume and pitch (lib/audio.lua). One-shots start and
// end at silence. Several takes of a knock are played through a group (sounds/<name>.group.json), so that no two are alike.
const SOUNDS = path.join(ROOT, "examples/pine-ridge-rally/sounds");
const LONG = 1 << 17, SHORT = 1 << 16; // 2.97 s and 1.49 s

/// Grains: `perSecond` clicks at random instants with random strengths, each ringing through `H`.
function grains(n, rand, perSecond, H) {
  const buf = new Float64Array(n);
  const count = Math.round((perSecond * n) / RATE);
  for (let i = 0; i < count; i++) put(buf, rand.next() * n, -Math.log(1 - rand.next()) * (rand.next() < 0.5 ? -1 : 1));
  return level(filtered(buf, RATE, H), 1, Infinity);
}
const mix = (n, ...parts) => { const out = new Float64Array(n); for (const [x, g] of parts) for (let i = 0; i < n; i++) out[i] += g * x[i]; return out; };
/// A swell that never goes below `floor`: 1 on average.
function swell(n, rand, lo, hi, depth, floor = 0.1) { const d = drift(n, rand, lo, hi); for (let i = 0; i < n; i++) d[i] = Math.max(floor, 1 + depth * d[i]); return d; }
const times = (x, env) => { for (let i = 0; i < x.length; i++) x[i] *= env[i]; return x; };
/// A tone whose pitch wanders (so many cycles in the loop exactly: the wander has no average), with harmonics.
function tone(n, rand, hz, wander, partials) {
  const cycles = Math.round((hz * n) / RATE);
  const d = drift(n, rand, 0.3, 6);
  const out = new Float64Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    phase += ((2 * Math.PI * cycles) / n) * (1 + wander * d[i]);
    for (let h = 0; h < partials.length; h++) out[i] += partials[h] * Math.sin((h + 1) * phase);
  }
  return out;
}
/// Removes what a loop has above 16 kHz and below 30 Hz (its spectrum is the loop's own, so no seam appears).
const tidy = (x) => filtered(x, RATE, (f) => (f > 16000 ? 0 : f > 14000 ? 0.5 + 0.5 * Math.cos((Math.PI * (f - 14000)) / 2000) : 1) * (f < 30 ? f / 30 : 1));
/// Writes a loop at this RMS. Tall peaks (a big stone, a creak) are rounded off first, at three times the RMS, so that every loop can
/// be as loud as the others; what the rounding adds above 16 kHz is removed with the rest.
const loop = (name, x, target = 0.16) => {
  const r = rms(x), LIMIT = 3;
  for (let i = 0; i < x.length; i++) x[i] = LIMIT * Math.tanh(x[i] / r / LIMIT);
  writeWav(path.join(SOUNDS, `${name}.wav`), level(tidy(x), target, 0.9));
  console.log("made", name);
};

// one-shots, in time
const secs = (s) => Math.round(s * RATE);
/// Noise through a band-pass (a two-pole resonator run sample by sample; `hz` may be a function of time), dying away.
function burst(n, rand, at, hz, q, tau, gain, attack = 0.001) {
  const out = new Float64Array(n);
  let y1 = 0, y2 = 0;
  const start = secs(at);
  for (let i = start; i < n; i++) {
    const t = (i - start) / RATE;
    const f = typeof hz === "function" ? hz(t) : hz;
    const w = (2 * Math.PI * f) / RATE, r = Math.exp(-w / (2 * q));
    const x = (rand.next() * 2 - 1) * Math.min(1, t / attack) * Math.exp(-t / tau);
    const y = (1 - r) * x + 2 * r * Math.cos(w) * y1 - r * r * y2;
    y2 = y1; y1 = y;
    out[i] = y;
  }
  const p = peak(out);
  return p > 0 ? scaled(out, gain / p) : out;
}
/// A struck note: a sine from f1 falling to f2, dying away.
function thud(n, at, f1, f2, fall, tau, gain) {
  const out = new Float64Array(n);
  const start = secs(at);
  let phase = 0;
  for (let i = start; i < n; i++) {
    const t = (i - start) / RATE;
    phase += (2 * Math.PI * (f2 + (f1 - f2) * Math.exp(-t / fall))) / RATE;
    out[i] = gain * Math.sin(phase) * Math.exp(-t / tau) * Math.min(1, t / 0.0015);
  }
  return out;
}
function shot(name, n, parts, target = 0.8) {
  const out = new Float64Array(n);
  for (const x of parts) for (let i = 0; i < n; i++) out[i] += x[i];
  // no DC, and silence at both ends
  let mean = 0;
  for (const v of out) mean += v / n;
  const edge = secs(0.012);
  for (let i = 0; i < n; i++) out[i] = (out[i] - mean) * Math.min(1, i / secs(0.0008)) * Math.min(1, (n - 1 - i) / edge);
  scaled(out, target / peak(out));
  writeWav(path.join(SOUNDS, `${name}.wav`), out);
  console.log("made", name);
}
const group = (name, sounds, pitch = [0.93, 1.07]) => fs.writeFileSync(path.join(SOUNDS, `${name}.group.json`), `${JSON.stringify({ sounds, volume: [0.85, 1], pitch, no_repeat: true })}\n`);

function driving() {
  const rand = new Rand(20261120);

  // -- tyres rolling, one loop for each surface (volume and pitch follow the speed; louder and higher when the car slides) --
  // tarmac: the hiss of tread on a hard road, most of it round 1 kHz, over a low rumble
  loop("tyre_road", times(mix(LONG,
    [noiseLoop(LONG, rand, (f) => bump(f, 1000, 0.9)), 1],
    [noiseLoop(LONG, rand, (f) => bump(f, 130, 1.1)), 0.7]), swell(LONG, rand, 0.3, 5, 0.1)));
  // gravel: a crunching bed, stones rattling off each other (sharp grains at many pitches), and now and then one against the floor
  {
    const bed = times(noiseLoop(LONG, rand, (f) => bump(f, 320, 1.2)), swell(LONG, rand, 8, 50, 0.5, 0.25));
    const parts = [[bed, 1]];
    for (const [hz, q] of [[1200, 2.5], [1900, 3], [2700, 3], [3800, 3.5], [5200, 3.5], [7000, 4]]) parts.push([grains(LONG, rand, 38, (f) => bp(f, hz, q)), 0.24]);
    parts.push([grains(LONG, rand, 5, (f) => { const a = bp(f, 520, 5), b = bp(f, 880, 4); return [a[0] + 0.7 * b[0], a[1] + 0.7 * b[1]]; }), 0.35]);
    loop("tyre_gravel", mix(LONG, ...parts));
  }
  // dirt: packed earth: a duller, softer rumble, a few small stones
  {
    const bed = times(noiseLoop(LONG, rand, (f) => bump(f, 210, 1.1)), swell(LONG, rand, 4, 30, 0.35, 0.3));
    loop("tyre_dirt", mix(LONG, [bed, 1], [noiseLoop(LONG, rand, (f) => bump(f, 1500, 1.0)), 0.22],
      [grains(LONG, rand, 30, (f) => bp(f, 1100, 2)), 0.16], [grains(LONG, rand, 22, (f) => bp(f, 2300, 2.5)), 0.12]));
  }
  // snow: the squeak and crunch of packed snow giving under the tread (it comes in creaks), a soft low press, a hiss of loose powder
  {
    const creak = drift(LONG, rand, 12, 45);
    for (let i = 0; i < LONG; i++) creak[i] = 0.2 + creak[i] * creak[i];
    loop("tyre_snow", mix(LONG,
      [times(noiseLoop(LONG, rand, (f) => bump(f, 2400, 0.8)), creak), 0.55],
      [times(noiseLoop(LONG, rand, (f) => bump(f, 170, 1.0)), swell(LONG, rand, 2, 12, 0.3)), 0.6],
      [noiseLoop(LONG, rand, (f) => bump(f, 6500, 0.7)), 0.16]));
  }
  // sand: a smooth, dry hiss that breathes, and the soft drag of the tyre sinking in
  loop("tyre_sand", mix(LONG,
    [times(noiseLoop(LONG, rand, (f) => bump(f, 3800, 1.0)), swell(LONG, rand, 1.5, 6, 0.3)), 0.7],
    [times(noiseLoop(LONG, rand, (f) => bump(f, 150, 1.0)), swell(LONG, rand, 1, 8, 0.25)), 0.55]));
  // the rough (grass and verge): a heavy drumming of bumps under the car, and the swish of grass against it
  {
    const bumps = grains(LONG, rand, 9, (f) => { const a = bp(f, 70, 2.5), b = bp(f, 140, 2.5); return [a[0] + 0.5 * b[0], a[1] + 0.5 * b[1]]; });
    loop("tyre_rough", mix(LONG, [bumps, 0.9], [noiseLoop(LONG, rand, (f) => bump(f, 95, 1.0)), 0.6],
      [times(noiseLoop(LONG, rand, (f) => bump(f, 3000, 1.0)), swell(LONG, rand, 6, 20, 0.55, 0.15)), 0.3]));
  }
  // tarmac, sliding: the squeal of rubber catching and letting go, two tyres at their own pitches (each wanders and swells), over scrub
  {
    const a = times(tone(LONG, rand, 905, 0.025, [1, 0.4, 0.18, 0.08]), swell(LONG, rand, 0.3, 3, 0.45, 0.12));
    const b = times(tone(LONG, rand, 1180, 0.03, [1, 0.35, 0.15, 0.06]), swell(LONG, rand, 0.3, 3, 0.5, 0.05));
    const scrub = times(noiseLoop(LONG, rand, (f) => bump(f, 2600, 0.9)), swell(LONG, rand, 0.5, 8, 0.3));
    loop("tyre_squeal", mix(LONG, [level(a, 1, Infinity), 1], [level(b, 1, Infinity), 0.75], [scrub, 0.4]));
  }

  // -- the air: wind round the car at speed (deep, with a broad hump of rush, gusting a little) --
  loop("wind_loop", times(mix(LONG,
    [noiseLoop(LONG, rand, (f) => (f < 40 ? 0 : 1 / (1 + (f / 350) ** 1.1))), 1],
    [noiseLoop(LONG, rand, (f) => bump(f, 900, 0.8)), 0.35]), swell(LONG, rand, 0.2, 1.6, 0.22)));

  // -- the GT's turbo: the compressor's whistle (a steady high note that wavers a little) in a rush of air --
  loop("turbo_loop", mix(SHORT,
    [level(times(tone(SHORT, rand, 3600, 0.004, [1, 0.2]), swell(SHORT, rand, 0.5, 9, 0.1)), 1, Infinity), 1],
    [noiseLoop(SHORT, rand, (f) => bump(f, 2800, 0.8)), 0.4]), 0.14);

  // -- the 4x4's gearbox: the whine of straight teeth meshing (a note with two harmonics), beating once a turn of the shaft (19 teeth) --
  {
    const turns = 55, mesh = turns * 19; // cycles in the loop: the shaft at 37 Hz, the teeth at 703 Hz
    const d = drift(SHORT, rand, 0.3, 5), out = new Float64Array(SHORT);
    let phase = 0;
    for (let i = 0; i < SHORT; i++) {
      phase += ((2 * Math.PI * mesh) / SHORT) * (1 + 0.003 * d[i]);
      out[i] = (Math.sin(phase) + 0.45 * Math.sin(2 * phase) + 0.2 * Math.sin(3 * phase)) * (1 + 0.14 * Math.sin(phase / 19));
    }
    loop("whine_loop", mix(SHORT, [level(out, 1, Infinity), 1], [noiseLoop(SHORT, rand, (f) => bump(f, 1400, 1.0)), 0.12]), 0.14);
  }

  // -- the body dragging along a barrier: grit (in chattering bursts, as it catches and slips) ringing the panel --
  {
    const chatter = drift(LONG, rand, 20, 90);
    for (let i = 0; i < LONG; i++) chatter[i] = 0.3 + Math.abs(chatter[i]);
    const grit = times(noiseLoop(LONG, rand, () => 1), chatter);
    const panel = filtered(grit, RATE, (f) => {
      let re = 0.35 * bump(f, 3500, 1.3), im = 0;
      for (const [hz, g] of [[610, 0.8], [1350, 1], [2900, 0.8], [4700, 0.5]]) { const h = bp(f, hz, 9); re += g * h[0]; im += g * h[1]; }
      return [re, im];
    });
    loop("scrape_loop", panel);
  }

  // -- the suspension taking a bump: the body's thump, the tyre's slap, something in the car rattling (three takes) --
  const thumps = [];
  for (const [k, tune] of [0.9, 1, 1.12].entries()) {
    const n = secs(0.36), r = new Rand(300 + k);
    shot(`thump${k + 1}`, n, [thud(n, 0, 120 * tune, 62 * tune, 0.04, 0.07, 1), burst(n, r, 0, 380 * tune, 0.9, 0.014, 0.9), thud(n, 0.012, 310 * tune, 300 * tune, 0.05, 0.03, 0.15)]);
    thumps.push(`thump${k + 1}`);
  }
  group("thump", thumps);

  // -- hitting a barrier or another car: a heavy thud, the crunch of the panel (several cracks close together), the panel's
  // own ring, and a short rattle of what came loose (three takes) --
  const impacts = [];
  for (const [k, tune] of [0.88, 1, 1.15].entries()) {
    const n = secs(0.62), r = new Rand(400 + k);
    const parts = [thud(n, 0, 140 * tune, 55 * tune, 0.03, 0.06, 1)];
    for (let c = 0; c < 4; c++) parts.push(burst(n, r, c === 0 ? 0 : r.range(0.008, 0.07), r.range(500, 2500) * tune, 1.2, r.range(0.025, 0.06), c === 0 ? 0.8 : r.range(0.3, 0.6)));
    for (const [hz, tau] of [[390, 0.11], [870, 0.08], [1650, 0.05]]) parts.push(thud(n, 0.002, hz * tune, hz * tune * 0.985, 0.05, tau, 0.22));
    parts.push(burst(n, r, 0.03, 3000 * tune, 1, 0.12, 0.15, 0.01));
    shot(`impact${k + 1}`, n, parts);
    impacts.push(`impact${k + 1}`);
  }
  group("impact", impacts);

  // -- gear changes --
  // the GT's twin-clutch box: a small click, then three quick beats of the exhaust as the next gear takes up
  {
    const n = secs(0.26), r = new Rand(500);
    const parts = [burst(n, r, 0, 3200, 2, 0.004, 0.45)];
    for (const [at, g] of [[0.035, 1], [0.049, 0.7], [0.063, 0.45]]) parts.push(thud(n, at, 150, 90, 0.01, 0.014, g), burst(n, r, at, 900, 1, 0.008, 0.5 * g));
    shot("shift_car_gt", n, parts);
  }
  // the 4x4's long lever: a clack out of one gear, a rattle across the gate, a heavy clunk into the next
  {
    const n = secs(0.5), r = new Rand(501);
    const parts = [burst(n, r, 0, 1100, 4, 0.009, 0.6), thud(n, 0, 230, 215, 0.02, 0.028, 0.8)];
    for (let k = 0; k < 5; k++) parts.push(burst(n, r, r.range(0.06, 0.19), 1800, 3, 0.003, 0.12));
    parts.push(thud(n, 0.24, 170, 120, 0.02, 0.045, 1), burst(n, r, 0.24, 650, 3, 0.016, 0.6), burst(n, r, 0.243, 2400, 3, 0.003, 0.2));
    shot("shift_car_offroad", n, parts);
  }
  // the GT lifting off under boost: the charge air let go past the valve, a rush that falls in pitch and flutters as it dies
  {
    const n = secs(0.5), r = new Rand(502);
    const rush = burst(n, r, 0, (t) => 1700 + 3100 * Math.exp(-t / 0.12), 1.5, 0.13, 1, 0.006);
    for (let i = 0; i < n; i++) { const t = i / RATE; rush[i] *= 1 - 0.35 * Math.exp(-t / 0.15) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 34 * t)); }
    shot("bov_car_gt", n, [rush, burst(n, r, 0, 300, 0.8, 0.06, 0.3, 0.004)], 0.7);
  }
  // the GT's exhaust popping on the overrun: one bang down the pipe (three takes)
  const pops = [];
  for (const [k, tune] of [0.88, 1, 1.13].entries()) {
    const n = secs(0.22), r = new Rand(600 + k);
    shot(`pop${k + 1}`, n, [thud(n, 0, 170 * tune, 80 * tune, 0.012, 0.022, 1), burst(n, r, 0, 1000 * tune, 0.8, 0.009, 1.3), thud(n, 0.003, 290 * tune, 285 * tune, 0.03, 0.035, 0.3)]);
    pops.push(`pop${k + 1}`);
  }
  group("pop_car_gt", pops, [0.9, 1.1]);
  // another car going by close: air pushed aside, rising and falling
  {
    const n = secs(0.5), r = new Rand(700);
    const air = burst(n, r, 0, (t) => 650 + 1300 * Math.exp(-(((t - 0.2) / 0.11) ** 2)), 1.2, 10, 1, 0.001);
    for (let i = 0; i < n; i++) air[i] *= Math.sin((Math.PI * i) / n) ** 2;
    shot("whoosh", n, [air], 0.6);
  }
  // the sound editor's files for the sounds that are made here now
  for (const old of ["gravel_loop.wav", "gravel_loop.sfx.json", "skid_loop.wav", "skid_loop.sfx.json", "shift.wav", "shift.sfx.json", "whoosh.sfx.json"]) fs.rmSync(path.join(SOUNDS, old), { force: true });
}

// ---- music -----------------------------------------------------------------------------------------------------------
const track = (name, kind, wave, notes, o = {}) => ({ name, kind, wave, duty: 0.5, attack: 0.01, decay: 0.1, sustain: 0.6, release: 0.12, volume: 0.5, pan: 0, mute: false, notes, ...o });
const DRUM = { kick: 36, snare: 38, clap: 39, hat: 42, open: 46, crash: 49, tom: 45 };
/// One drum hit per listed step in each bar of a pattern, repeated for `bars` bars (16 steps a bar).
const drums = (bars, pattern) => {
  const notes = [];
  for (let b = 0; b < bars; b++)
    for (const [drum, steps, vel = 0.8] of pattern) for (const s of steps) notes.push({ step: b * 16 + s, len: 1, pitch: DRUM[drum], vel });
  return notes;
};
/// Notes of a chord each held for `len` steps from the bar's start, for every chord of a progression.
const pads = (progression, len = 16, vel = 0.5) => progression.flatMap((chord, bar) => chord.map((pitch) => ({ step: bar * 16, len, pitch, vel })));
const bassline = (roots, pattern, vel = 0.8) => roots.flatMap((root, bar) => pattern.map(([step, len, octave = 0]) => ({ step: bar * 16 + step, len, pitch: root + octave, vel })));

const menu = {
  version: 1, bpm: 96, stepsPerBeat: 4, length: 128,
  tracks: [
    track("pad", "synth", "triangle", pads([[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62], [57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 56, 59]], 15, 0.4), { attack: 0.08, release: 0.4, volume: 0.45 }),
    track("bass", "synth", "saw", bassline([45, 41, 36, 43, 45, 41, 43, 40], [[0, 6], [8, 4], [12, 3]], 0.7), { volume: 0.4, sustain: 0.5 }),
    track("lead", "synth", "square", [
      ...[[0, 69, 6], [8, 67, 4], [12, 64, 4]].map(([s, p, l]) => ({ step: 0 * 16 + s, len: l, pitch: p, vel: 0.55 })),
      ...[[0, 65, 6], [8, 69, 4], [12, 72, 4]].map(([s, p, l]) => ({ step: 16 + s, len: l, pitch: p, vel: 0.55 })),
      ...[[0, 72, 8], [8, 71, 4], [12, 67, 4]].map(([s, p, l]) => ({ step: 32 + s, len: l, pitch: p, vel: 0.55 })),
      ...[[0, 71, 8], [8, 74, 8]].map(([s, p, l]) => ({ step: 48 + s, len: l, pitch: p, vel: 0.55 })),
      ...[[0, 69, 6], [8, 72, 4], [12, 76, 4]].map(([s, p, l]) => ({ step: 64 + s, len: l, pitch: p, vel: 0.55 })),
      ...[[0, 77, 6], [8, 72, 4], [12, 69, 4]].map(([s, p, l]) => ({ step: 80 + s, len: l, pitch: p, vel: 0.55 })),
      ...[[0, 74, 4], [4, 71, 4], [8, 67, 8]].map(([s, p, l]) => ({ step: 96 + s, len: l, pitch: p, vel: 0.55 })),
      ...[[0, 68, 4], [4, 71, 4], [8, 64, 8]].map(([s, p, l]) => ({ step: 112 + s, len: l, pitch: p, vel: 0.55 })),
    ], { duty: 0.25, volume: 0.32, attack: 0.02, release: 0.25 }),
    track("drums", "drums", "noise", drums(8, [["kick", [0, 10]], ["snare", [8], 0.6], ["hat", [0, 2, 4, 6, 8, 10, 12, 14], 0.3]]), { volume: 0.5 }),
  ],
};

// a driving E-minor theme for the forest circuit
const raceForest = {
  version: 1, bpm: 148, stepsPerBeat: 4, length: 128,
  tracks: [
    track("bass", "synth", "saw", bassline([40, 40, 36, 43, 40, 40, 38, 43], [[0, 2], [2, 2], [4, 2], [6, 2], [8, 2], [10, 2], [12, 2], [14, 2]], 0.8), { volume: 0.4, sustain: 0.4, release: 0.05 }),
    track("lead", "synth", "square", [
      ...[[0, 64, 3], [4, 67, 3], [8, 71, 4], [12, 69, 2], [14, 67, 2]].map(([s, p, l]) => ({ step: s, len: l, pitch: p, vel: 0.7 })),
      ...[[0, 64, 3], [4, 67, 3], [8, 72, 4], [12, 71, 2], [14, 69, 2]].map(([s, p, l]) => ({ step: 16 + s, len: l, pitch: p, vel: 0.7 })),
      ...[[0, 60, 3], [4, 64, 3], [8, 67, 4], [12, 64, 2], [14, 60, 2]].map(([s, p, l]) => ({ step: 32 + s, len: l, pitch: p, vel: 0.7 })),
      ...[[0, 62, 3], [4, 67, 3], [8, 71, 4], [12, 74, 4]].map(([s, p, l]) => ({ step: 48 + s, len: l, pitch: p, vel: 0.7 })),
      ...[[0, 76, 4], [4, 74, 2], [6, 71, 2], [8, 69, 4], [12, 71, 4]].map(([s, p, l]) => ({ step: 64 + s, len: l, pitch: p, vel: 0.7 })),
      ...[[0, 76, 4], [4, 79, 2], [6, 76, 2], [8, 74, 4], [12, 72, 4]].map(([s, p, l]) => ({ step: 80 + s, len: l, pitch: p, vel: 0.7 })),
      ...[[0, 72, 4], [4, 71, 2], [6, 67, 2], [8, 64, 4], [12, 67, 4]].map(([s, p, l]) => ({ step: 96 + s, len: l, pitch: p, vel: 0.7 })),
      ...[[0, 74, 4], [4, 71, 4], [8, 67, 4], [12, 62, 4]].map(([s, p, l]) => ({ step: 112 + s, len: l, pitch: p, vel: 0.7 })),
    ], { duty: 0.3, volume: 0.3, attack: 0.005, release: 0.08 }),
    track("stabs", "synth", "saw", pads([[52, 55, 59], [52, 55, 59], [48, 52, 55], [50, 55, 59], [52, 55, 59], [52, 55, 59], [50, 54, 57], [50, 55, 59]], 3, 0.45).flatMap((n) => [n, { ...n, step: n.step + 6 }, { ...n, step: n.step + 10 }]), { volume: 0.22, decay: 0.08, sustain: 0.3, release: 0.05, pan: 0.2 }),
    track("drums", "drums", "noise", drums(8, [["kick", [0, 4, 8, 12]], ["snare", [4, 12], 0.8], ["hat", [2, 6, 10, 14], 0.45], ["hat", [0, 8], 0.25], ["open", [14], 0.3]]).concat([{ step: 0, len: 1, pitch: DRUM.crash, vel: 0.6 }]), { volume: 0.6 }),
  ],
};

// a dusty, twangy theme for the desert circuit (D minor with a flat second)
const raceDesert = {
  version: 1, bpm: 132, stepsPerBeat: 4, length: 128,
  tracks: [
    track("bass", "synth", "triangle", bassline([38, 38, 39, 38, 38, 36, 39, 38], [[0, 3], [4, 1], [6, 2], [8, 3], [12, 1], [14, 2]], 0.85), { volume: 0.55, sustain: 0.6 }),
    track("twang", "synth", "saw", [
      ...[[0, 62, 2], [3, 65, 1], [4, 69, 4], [10, 68, 2], [12, 65, 4]].map(([s, p, l]) => ({ step: s, len: l, pitch: p, vel: 0.7 })),
      ...[[0, 62, 2], [3, 65, 1], [4, 70, 4], [10, 69, 2], [12, 65, 4]].map(([s, p, l]) => ({ step: 16 + s, len: l, pitch: p, vel: 0.7 })),
      ...[[0, 63, 2], [3, 67, 1], [4, 70, 4], [10, 67, 2], [12, 63, 4]].map(([s, p, l]) => ({ step: 32 + s, len: l, pitch: p, vel: 0.7 })),
      ...[[0, 62, 2], [3, 65, 1], [4, 69, 8], [14, 70, 2]].map(([s, p, l]) => ({ step: 48 + s, len: l, pitch: p, vel: 0.7 })),
      ...[[0, 74, 4], [4, 72, 2], [6, 70, 2], [8, 69, 4], [12, 65, 4]].map(([s, p, l]) => ({ step: 64 + s, len: l, pitch: p, vel: 0.7 })),
      ...[[0, 74, 4], [4, 75, 2], [6, 74, 2], [8, 70, 4], [12, 69, 4]].map(([s, p, l]) => ({ step: 80 + s, len: l, pitch: p, vel: 0.7 })),
      ...[[0, 72, 2], [3, 70, 1], [4, 67, 4], [10, 70, 2], [12, 72, 4]].map(([s, p, l]) => ({ step: 96 + s, len: l, pitch: p, vel: 0.7 })),
      ...[[0, 70, 4], [4, 69, 4], [8, 65, 4], [12, 62, 4]].map(([s, p, l]) => ({ step: 112 + s, len: l, pitch: p, vel: 0.7 })),
    ], { volume: 0.26, decay: 0.2, sustain: 0.4, release: 0.15, pan: -0.15 }),
    track("pad", "synth", "triangle", pads([[50, 57, 62], [50, 57, 62], [51, 58, 62], [50, 57, 62], [50, 57, 62], [48, 55, 60], [51, 58, 62], [50, 57, 62]], 16, 0.35), { attack: 0.1, release: 0.4, volume: 0.35 }),
    track("drums", "drums", "noise", drums(8, [["kick", [0, 6, 10]], ["snare", [4, 12], 0.7], ["tom", [14], 0.5], ["hat", [0, 2, 4, 6, 8, 10, 12, 14], 0.3]]), { volume: 0.55 }),
  ],
};

// a cool, spacious theme for the snow circuit: bell-like arpeggios over a slow pulse (A minor, then F)
const raceSnow = {
  version: 1, bpm: 124, stepsPerBeat: 4, length: 128,
  tracks: [
    track("bells", "synth", "sine", [57, 60, 64, 69, 64, 60, 57, 60, 65, 69, 72, 69, 65, 69, 64, 60].flatMap((pitch, i) => [0, 1, 2, 3, 4, 5, 6, 7].map((bar) => ({ step: bar * 16 + i, len: 1, pitch: pitch + (bar % 4 === 2 ? -4 : 0) + (bar % 4 === 3 ? -2 : 0), vel: 0.55 + (i % 4 === 0 ? 0.2 : 0) }))), { volume: 0.3, attack: 0.002, decay: 0.25, sustain: 0.2, release: 0.4, pan: 0.1 }),
    track("bass", "synth", "triangle", bassline([45, 45, 41, 43, 45, 45, 41, 43], [[0, 6], [8, 3], [12, 3]], 0.85), { volume: 0.5, sustain: 0.7 }),
    track("pad", "synth", "saw", pads([[57, 60, 64], [57, 60, 64], [53, 57, 60], [55, 59, 62], [57, 60, 64], [57, 60, 64], [53, 57, 60], [55, 59, 62]], 16, 0.3), { attack: 0.15, release: 0.5, volume: 0.16, pan: -0.2 }),
    track("drums", "drums", "noise", drums(8, [["kick", [0, 6, 8, 14]], ["clap", [4, 12], 0.5], ["hat", [2, 6, 10, 14], 0.35], ["open", [15], 0.2]]), { volume: 0.5 }),
  ],
};

// a low, steady night drive: a pulsing bass under a slow, lonely lead (D minor)
const raceNight = {
  version: 1, bpm: 108, stepsPerBeat: 4, length: 128,
  tracks: [
    track("lead", "synth", "triangle", [[0, 62, 6], [8, 65, 4], [12, 69, 4], [16, 67, 8], [24, 65, 4], [28, 62, 4], [32, 60, 6], [40, 64, 4], [44, 67, 4], [48, 69, 12], [64, 62, 6], [72, 65, 4], [76, 69, 4], [80, 70, 8], [88, 69, 4], [92, 65, 4], [96, 67, 6], [104, 64, 4], [108, 60, 4], [112, 62, 14]].map(([s, p, l]) => ({ step: s, len: l, pitch: p, vel: 0.65 })), { volume: 0.3, attack: 0.03, release: 0.5, pan: 0.15 }),
    track("bass", "synth", "saw", bassline([38, 38, 34, 36, 38, 38, 34, 31], [[0, 2], [4, 2], [8, 2], [12, 2]], 0.8), { volume: 0.38, sustain: 0.5 }),
    track("pad", "synth", "triangle", pads([[50, 53, 57], [50, 53, 57], [46, 50, 53], [48, 52, 55], [50, 53, 57], [50, 53, 57], [46, 50, 53], [43, 47, 50]], 16, 0.3), { attack: 0.2, release: 0.6, volume: 0.3, pan: -0.2 }),
    track("drums", "drums", "noise", drums(8, [["kick", [0, 4, 8, 12]], ["snare", [4, 12], 0.6], ["hat", [2, 6, 10, 14], 0.3]]), { volume: 0.5 }),
  ],
};

// a short, bright fanfare for the results screen
const results = {
  version: 1, bpm: 112, stepsPerBeat: 4, length: 64,
  tracks: [
    track("lead", "synth", "square", [
      ...[[0, 67, 4], [4, 72, 4], [8, 76, 8], [16, 74, 4], [20, 71, 4], [24, 67, 8], [32, 69, 4], [36, 72, 4], [40, 77, 8], [48, 76, 4], [52, 74, 4], [56, 72, 8]].map(([s, p, l]) => ({ step: s, len: l, pitch: p, vel: 0.7 })),
    ], { duty: 0.3, volume: 0.32, release: 0.3 }),
    track("pad", "synth", "triangle", pads([[48, 52, 55], [55, 59, 62], [53, 57, 60], [48, 52, 55]], 16, 0.4), { attack: 0.06, release: 0.5, volume: 0.4 }),
    track("bass", "synth", "saw", bassline([36, 43, 41, 36], [[0, 4], [8, 4]], 0.7), { volume: 0.35 }),
    track("drums", "drums", "noise", drums(4, [["kick", [0, 8]], ["clap", [4, 12], 0.5], ["hat", [2, 6, 10, 14], 0.25]]), { volume: 0.45 }),
  ],
};

// ---- the fuller voices of the studio (unison, filter, reverb, studio drums) given to the tracks above, by song and track name ----
const PAD = { wave: "saw", unison: 5, detune: 14, cutoff: 1500, sweep: 0.15, attack: 0.3, release: 0.9, reverb: 0.55 };
const BASS = { wave: "saw", unison: 2, detune: 6, cutoff: 480, resonance: 0.15, sweep: 0.5, sub: 0.55, attack: 0.005, release: 0.08 };
const LEAD = { wave: "saw", unison: 3, detune: 9, cutoff: 3600, sweep: 0.4, vibrato: 0.08, reverb: 0.35 };
const DRUMS = { kit: "studio", reverb: 0.12 };
const voices = {
  menu: { room: { size: 0.65, damping: 0.4 }, pad: { ...PAD, volume: 0.5 }, bass: { ...BASS, volume: 0.45 }, lead: { ...LEAD, volume: 0.3, cutoff: 3000, attack: 0.03, release: 0.4 }, drums: { ...DRUMS, volume: 0.55 } },
  race_forest: { room: { size: 0.5, damping: 0.45 }, bass: { ...BASS, volume: 0.42 }, lead: { ...LEAD, volume: 0.3, release: 0.12 }, stabs: { wave: "saw", unison: 3, detune: 12, cutoff: 1800, sweep: 0.6, reverb: 0.25, volume: 0.24 }, drums: { ...DRUMS, volume: 0.65 } },
  race_desert: { room: { size: 0.45, damping: 0.5 }, bass: { ...BASS, wave: "saw", cutoff: 560, volume: 0.45 }, twang: { wave: "saw", unison: 2, detune: 5, cutoff: 2400, resonance: 0.2, sweep: 0.7, reverb: 0.3, volume: 0.28 }, pad: { ...PAD, volume: 0.4 }, drums: { ...DRUMS, volume: 0.6 } },
  race_snow: { room: { size: 0.8, damping: 0.3, mix: 1.2 }, bells: { unison: 2, detune: 3, reverb: 0.65, volume: 0.3 }, bass: { ...BASS, wave: "saw", cutoff: 520, volume: 0.45 }, pad: { ...PAD, cutoff: 1800, reverb: 0.7, volume: 0.3 }, drums: { ...DRUMS, volume: 0.55 } },
  race_night: { room: { size: 0.75, damping: 0.5 }, lead: { wave: "saw", unison: 3, detune: 8, cutoff: 2400, vibrato: 0.1, reverb: 0.5, attack: 0.06, release: 0.6, volume: 0.28 }, bass: { ...BASS, volume: 0.42 }, pad: { ...PAD, cutoff: 1100, volume: 0.38 }, drums: { ...DRUMS, volume: 0.55 } },
  results: { room: { size: 0.6, damping: 0.4 }, lead: { ...LEAD, volume: 0.32, release: 0.35 }, pad: { ...PAD, volume: 0.45 }, bass: { ...BASS, volume: 0.4 }, drums: { ...DRUMS, volume: 0.5 } },
};
// ---- arrangement: each eight-bar loop above becomes four sections (so the music runs four times as long before it repeats):
// 1 the theme; 2 the theme with the lead doubled an octave up and busier hats; 3 a breakdown (the bass and stabs wait, the drums thin
// out, the lead plays every other note); 4 the theme again with a fifth above the lead, a crash and a snare fill into the loop.
const LEADS = new Set(["lead", "twang", "bells"]);
const hits = (steps, pitch, vel, at) => steps.map((st) => ({ step: at + st, len: 1, pitch, vel }));
function arrange(song) {
  const L = song.length;
  const shift = (notes, by) => notes.map((n) => ({ ...n, step: n.step + by }));
  const tracks = song.tracks.map((t) => {
    const base = t.notes;
    const parts = [];
    // 1: the theme
    parts.push(...shift(base, 0));
    // 2: the lead doubled up an octave, extra hats
    if (LEADS.has(t.name)) parts.push(...shift(base, L), ...shift(base.map((n) => ({ ...n, pitch: n.pitch + 12, vel: n.vel * 0.45 })), L));
    else if (t.kind === "drums") {
      const bars = L / 16;
      parts.push(...shift(base, L));
      for (let b = 0; b < bars; b++) parts.push(...hits([1, 3, 5, 7, 9, 11, 13, 15], 42, 0.16, L + b * 16));
      parts.push(...hits([0], 49, 0.55, L));
    } else parts.push(...shift(base, L));
    // 3: the breakdown
    if (LEADS.has(t.name)) parts.push(...shift(base.filter((_, i) => i % 2 === 0), 2 * L));
    else if (t.kind === "drums") {
      const bars = L / 16;
      for (let b = 0; b < bars; b++) {
        if (b >= 2) parts.push(...hits([0, 8], 36, 0.8, 2 * L + b * 16));
        parts.push(...hits([4, 12], 42, 0.3, 2 * L + b * 16));
        if (b >= 6) parts.push(...hits([4, 12], 38, 0.6, 2 * L + b * 16));
      }
    } else if (t.name === "bass") parts.push(...shift(base.filter((n) => n.step >= L / 2), 2 * L));
    else if (t.name === "pad") parts.push(...shift(base, 2 * L));
    // (the stabs and any other track rest)
    // 4: the theme with a fifth above the lead, a crash, and a fill into the loop
    if (LEADS.has(t.name)) parts.push(...shift(base, 3 * L), ...shift(base.map((n) => ({ ...n, pitch: n.pitch + 7, vel: n.vel * 0.4 })), 3 * L));
    else if (t.kind === "drums") {
      parts.push(...shift(base.filter((n) => n.step < L - 16), 3 * L), ...hits([0], 49, 0.6, 3 * L));
      parts.push(...hits([0, 4, 8, 10, 12, 13, 14, 15], 38, 0.7, 3 * L + L - 16), ...hits([0, 8], 36, 0.9, 3 * L + L - 16));
    } else parts.push(...shift(base, 3 * L));
    return { ...t, notes: parts };
  });
  return { ...song, length: 4 * L, tracks };
}

function dress(name, song) {
  const v = voices[name];
  const arranged = name === "results" ? song : arrange(song);
  return { ...arranged, room: v.room, tracks: arranged.tracks.map((t) => ({ ...t, ...(v[t.name] ?? {}) })) };
}

driving();
if (process.argv[2] !== "driving") await (await import("./mcp.mjs")).withServer(async (nova) => {
  for (const [name, a] of Object.entries(sfx)) console.log(await nova.call("sfx_write", { name, ...a }));
  for (const [name, song] of Object.entries({ menu, race_forest: raceForest, race_desert: raceDesert, race_snow: raceSnow, race_night: raceNight, results })) console.log(await nova.call("song_write", { name, song: dress(name, song) }));
});
