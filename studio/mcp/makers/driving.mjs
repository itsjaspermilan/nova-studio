// The sounds of driving (driving_sounds_make, makers/index-engine.ts): tyres on each surface, the squeal, wind, a turbo, a gearbox's whine, a
// body scraping a barrier, bumps, knocks, three gear changes, the blow-off and the exhaust's pops, made sample by sample with the engine model's
// tools (engine.mjs). First made for Pine Ridge Rally (scripts/rally/audio.mjs, `driving()`); seed 1 makes exactly those files.
import { RATE, Rand, applyH, bp, bump, drift, filtered, hp2, level, lp1, noiseLoop, peak, put, rms, scaled, signal, spectrum, wavBytes } from "./engine.mjs";

/// Where the files go while makeDriving runs, and the salt on every seed (0: the sounds first made).
let OUT = () => {};
let SALT = 0;

// ---- the sounds of driving (as first made) ---------------------------------------------------------------------------------------------------
// Loops are built round the circle like the engines (noise is given its spectrum directly, grains and knocks wrap, slow swells are
// loops of the same length), so none has a seam; the game steers each one's volume and pitch (lib/audio.lua). One-shots start and
// end at silence. Several takes of a knock are played through a group (sounds/<name>.group.json), so that no two are alike.
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
  OUT(`${name}.wav`, wavBytes(level(tidy(x), target, 0.9)));
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
  OUT(`${name}.wav`, wavBytes(out));
}
const group = (name, sounds, pitch = [0.93, 1.07]) => OUT(`${name}.group.json`, `${JSON.stringify({ sounds, volume: [0.85, 1], pitch, no_repeat: true })}\n`);

function driving() {
  const rand = new Rand(20261120 + SALT);

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

  // -- a turbo (every turbocharged car plays this one, at its own level and pitch: lib/audio.lua): mostly the breath of the air
  // it moves, a broad rush round 1 kHz that swells a little, and far under it the compressor's note, low (1.7 kHz, where it was
  // 3.6) and unsteady, so that it is heard as air under pressure and not as a whistle. (Its own random numbers: the loops after it
  // do not change when it does.) --
  {
    const r = new Rand(20261121 + SALT);
    const air = times(noiseLoop(SHORT, r, (f) => bump(f, 950, 0.8) + 0.2 * bump(f, 2000, 0.6)), swell(SHORT, r, 0.5, 7, 0.18));
    const note = times(tone(SHORT, r, 1700, 0.012, [1, 0.1]), swell(SHORT, r, 0.5, 9, 0.3));
    loop("turbo_loop", mix(SHORT, [air, 1], [level(note, 1, Infinity), 0.2]), 0.14);
  }

  // -- an old 4x4's or a lorry's gearbox: the whine of straight teeth meshing, beating once a turn of the shaft. A low note
  // (the teeth at 310 Hz in the loop, where they were at 703) with soft harmonics, in a little noise: a hum that follows the road
  // speed, not a whistle --
  {
    const turns = 42, mesh = turns * 11; // cycles in the loop: the shaft at 28 Hz, the teeth at 311 Hz
    const d = drift(SHORT, rand, 0.3, 5), out = new Float64Array(SHORT);
    let phase = 0;
    for (let i = 0; i < SHORT; i++) {
      phase += ((2 * Math.PI * mesh) / SHORT) * (1 + 0.003 * d[i]);
      out[i] = (Math.sin(phase) + 0.3 * Math.sin(2 * phase) + 0.08 * Math.sin(3 * phase)) * (1 + 0.14 * Math.sin(phase / 11));
    }
    loop("whine_loop", mix(SHORT, [level(out, 1, Infinity), 1], [noiseLoop(SHORT, rand, (f) => bump(f, 600, 1.0)), 0.2]), 0.14);
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
    const n = secs(0.36), r = new Rand(300 + k + SALT);
    shot(`thump${k + 1}`, n, [thud(n, 0, 120 * tune, 62 * tune, 0.04, 0.07, 1), burst(n, r, 0, 380 * tune, 0.9, 0.014, 0.9), thud(n, 0.012, 310 * tune, 300 * tune, 0.05, 0.03, 0.15)]);
    thumps.push(`thump${k + 1}`);
  }
  group("thump", thumps);

  // -- hitting a barrier or another car: a heavy thud, the crunch of the panel (several cracks close together), the panel's
  // own ring, and a short rattle of what came loose (three takes) --
  const impacts = [];
  for (const [k, tune] of [0.88, 1, 1.15].entries()) {
    const n = secs(0.62), r = new Rand(400 + k + SALT);
    const parts = [thud(n, 0, 140 * tune, 55 * tune, 0.03, 0.06, 1)];
    for (let c = 0; c < 4; c++) parts.push(burst(n, r, c === 0 ? 0 : r.range(0.008, 0.07), r.range(500, 2500) * tune, 1.2, r.range(0.025, 0.06), c === 0 ? 0.8 : r.range(0.3, 0.6)));
    for (const [hz, tau] of [[390, 0.11], [870, 0.08], [1650, 0.05]]) parts.push(thud(n, 0.002, hz * tune, hz * tune * 0.985, 0.05, tau, 0.22));
    parts.push(burst(n, r, 0.03, 3000 * tune, 1, 0.12, 0.15, 0.01));
    shot(`impact${k + 1}`, n, parts);
    impacts.push(`impact${k + 1}`);
  }
  group("impact", impacts);

  // -- gear changes: three, and each car plays the one its gearbox would make (lib/audio.lua) --
  // quick (a twin-clutch, sequential or modern automatic box): a small click, then three quick beats of the exhaust as the next gear takes up
  {
    const n = secs(0.26), r = new Rand(500 + SALT);
    const parts = [burst(n, r, 0, 3200, 2, 0.004, 0.45)];
    for (const [at, g] of [[0.035, 1], [0.049, 0.7], [0.063, 0.45]]) parts.push(thud(n, at, 150, 90, 0.01, 0.014, g), burst(n, r, at, 900, 1, 0.008, 0.5 * g));
    shot("shift_quick", n, parts);
  }
  // stick (an ordinary manual box): the lever clicks out of one gear, slides across, and knocks home in the next, a third of a second
  {
    const n = secs(0.34), r = new Rand(503 + SALT);
    const parts = [burst(n, r, 0, 1700, 3, 0.005, 0.55), thud(n, 0, 260, 240, 0.02, 0.016, 0.45)];
    parts.push(burst(n, r, 0.07, 1300, 2, 0.02, 0.1, 0.01)); // (the slide across the gate)
    parts.push(thud(n, 0.15, 200, 150, 0.015, 0.03, 1), burst(n, r, 0.15, 800, 3, 0.011, 0.55), burst(n, r, 0.153, 2100, 3, 0.003, 0.15));
    shot("shift_stick", n, parts);
  }
  // clunk (an old or heavy box with a long lever): a clack out of one gear, a rattle across the gate, a heavy clunk into the next
  {
    const n = secs(0.5), r = new Rand(501 + SALT);
    const parts = [burst(n, r, 0, 1100, 4, 0.009, 0.6), thud(n, 0, 230, 215, 0.02, 0.028, 0.8)];
    for (let k = 0; k < 5; k++) parts.push(burst(n, r, r.range(0.06, 0.19), 1800, 3, 0.003, 0.12));
    parts.push(thud(n, 0.24, 170, 120, 0.02, 0.045, 1), burst(n, r, 0.24, 650, 3, 0.016, 0.6), burst(n, r, 0.243, 2400, 3, 0.003, 0.2));
    shot("shift_clunk", n, parts);
  }
  // a turbocharged petrol car lifting off under boost: the charge air let go past the valve, a rush that falls in pitch and
  // flutters as it dies (lower than it was: it starts at 2.5 kHz, not 4.8)
  {
    const n = secs(0.5), r = new Rand(502 + SALT);
    const rush = burst(n, r, 0, (t) => 900 + 1600 * Math.exp(-t / 0.12), 1.2, 0.13, 1, 0.006);
    for (let i = 0; i < n; i++) { const t = i / RATE; rush[i] *= 1 - 0.35 * Math.exp(-t / 0.15) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 34 * t)); }
    shot("bov", n, [rush, burst(n, r, 0, 300, 0.8, 0.06, 0.35, 0.004)], 0.7);
  }
  // an exhaust popping on the overrun (the cars that do: lib/audio.lua): one bang down the pipe (three takes)
  const pops = [];
  for (const [k, tune] of [0.88, 1, 1.13].entries()) {
    const n = secs(0.22), r = new Rand(600 + k + SALT);
    shot(`pop${k + 1}`, n, [thud(n, 0, 170 * tune, 80 * tune, 0.012, 0.022, 1), burst(n, r, 0, 1000 * tune, 0.8, 0.009, 1.3), thud(n, 0.003, 290 * tune, 285 * tune, 0.03, 0.035, 0.3)]);
    pops.push(`pop${k + 1}`);
  }
  group("pop", pops, [0.9, 1.1]);
  // another car going by close: air pushed aside, rising and falling
  {
    const n = secs(0.5), r = new Rand(700 + SALT);
    const air = burst(n, r, 0, (t) => 650 + 1300 * Math.exp(-(((t - 0.2) / 0.11) ** 2)), 1.2, 10, 1, 0.001);
    for (let i = 0; i < n; i++) air[i] *= Math.sin((Math.PI * i) / n) ** 2;
    shot("whoosh", n, [air], 0.6);
  }
}


/// The files driving_sounds_make writes, in the order they are made (each loop's random numbers follow the ones before: all are always made).
export const DRIVING_SOUNDS = ["tyre_road", "tyre_gravel", "tyre_dirt", "tyre_snow", "tyre_sand", "tyre_rough", "tyre_squeal", "wind_loop", "turbo_loop", "whine_loop", "scrape_loop", "thump", "impact", "shift_quick", "shift_stick", "shift_clunk", "bov", "pop", "whoosh"];

/// Makes every driving sound, handing each file to `put(fileName, bytes)` (a .wav, or a .group.json for the ones with takes).
export function makeDriving(seed = 1, put) {
  OUT = put;
  SALT = seed === 1 ? 0 : (Math.imul(seed, 2654435761) >>> 0) % 1000003;
  try {
    driving();
  } finally {
    OUT = () => {};
    SALT = 0;
  }
}
void [applyH, hp2, lp1, signal, spectrum];
