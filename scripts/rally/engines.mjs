// Pine Ridge Rally's two engines, made offline from a model of each (no recording, nothing to license):
//
//   car_gt       a 3.0 litre turbocharged straight-six petrol, idle 750, limit 7000 rpm: smooth, an intake howl that rises, a crisp exhaust
//   car_offroad  a 4.2 litre straight-six diesel without a turbo, idle 650, limit 4200 rpm: low, heavy, combustion knock and clatter
//
// The model. A four-stroke straight six fires 1-5-3-6-2-4, one cylinder every 120 degrees of the crank, so three times a turn:
// rpm / 20 firings a second, and the whole pattern repeats every two turns (rpm / 120 a second). Each firing is an event with its
// own strength (combustion is never twice the same) and a little wander in its timing; every event feeds several sources:
//   exhaust  a pressure pulse down that cylinder's pipe (each cylinder a little different in length and strength: this is what
//            puts the half-orders, the burr, under an even six) through the exhaust's fixed resonances and the silencer
//   intake   a pulse of the opposite sign through the plenum's and the runners' resonances: the howl of a six under load
//   block    the knock of the combustion ringing the engine's metal (a different ring for each cylinder): faint in the petrol
//            engine, the diesel's whole voice at idle
//   valves   the valve train's ticks, and the whirr of what the engine drives
//   flow     the hiss of gas leaving the tail pipe, in bursts after each firing
//   fan      the diesel's cooling fan, a roar that grows with the revs
//   crackle  the petrol engine off the throttle at high revs: unburnt fuel popping in the exhaust
// Each source is brought to a known level, then mixed by a table that depends on the revs and on whether the throttle is down
// (`on`) or lifted (`off`): every band of revs has both loops, of the same length and with the same firings at the same
// instants, so the game can crossfade the two as the foot moves without the notes beating.
//
// How the loops stay clean. A loop is 65536 samples and holds a whole number of engine cycles, so its revs are that number times
// 80.75 rpm (the bands below; lib/audio.lua has the same numbers and plays each loop at the pitch that makes it the engine's note).
// Everything is built round the circle: events wrap, and every filter is applied to the loop's own spectrum (one long FFT), so a
// loop has no seam at all. It is made at twice the sample rate, the peaks are rounded there (a soft limit: knocks are tall), and
// only then is everything above 17 kHz removed and the rate halved: nothing folds back as aliasing. All loops leave at the same
// loudness (RMS), and `scripts/rally/sound-check.mjs` measures all of this.
//
//   node scripts/rally/engines.mjs [project folder]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const RATE = 44100;
export const LOOP = 65536; // samples in an engine loop
export const RPM_PER_CYCLE = (120 * RATE) / LOOP; // a loop of n engine cycles is at n times this many rpm
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// ---- tools shared with scripts/rally/audio.mjs (the tyres, the wind, the knocks) -------------------------------------------------

export class Rand {
  constructor(seed) { this.s = seed >>> 0; }
  next() { // mulberry32
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  gauss() { return Math.sqrt(-2 * Math.log(1 - this.next())) * Math.cos(2 * Math.PI * this.next()); }
}

/// In-place FFT of a power-of-two length (the inverse divides by the length).
export function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const a = re[i]; re[i] = re[j]; re[j] = a; const b = im[i]; im[i] = im[j]; im[j] = b; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1, step = ((inverse ? 2 : -2) * Math.PI) / len;
    for (let k = 0; k < half; k++) {
      const wr = Math.cos(step * k), wi = Math.sin(step * k);
      for (let i = k; i < n; i += len) {
        const j = i + half;
        const xr = re[j] * wr - im[j] * wi, xi = re[j] * wi + im[j] * wr;
        re[j] = re[i] - xr; im[j] = im[i] - xi;
        re[i] += xr; im[i] += xi;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

export const spectrum = (x) => { const s = { re: Float64Array.from(x), im: new Float64Array(x.length) }; fft(s.re, s.im); return s; };
export const signal = (s) => { fft(s.re, s.im, true); return s.re; };
/// The mean square of the signal a spectrum is of.
export const power = (s) => { let e = 0; for (let i = 0; i < s.re.length; i++) e += s.re[i] * s.re[i] + s.im[i] * s.im[i]; return e / (s.re.length * s.re.length); };
/// Multiplies a real signal's spectrum by H(f): a number (a gain with no delay) or [re, im] (a real filter's response).
export function applyH(s, rate, H) {
  const n = s.re.length;
  for (let k = 0; k <= n / 2; k++) {
    const h = H((k * rate) / n);
    const hr = typeof h === "number" ? h : h[0], hi = typeof h === "number" ? 0 : h[1];
    const a = s.re[k], b = s.im[k];
    if (k === 0 || k === n / 2) { s.re[k] = a * hr; s.im[k] = 0; continue; }
    s.re[k] = a * hr - b * hi; s.im[k] = a * hi + b * hr;
    s.re[n - k] = s.re[k]; s.im[n - k] = -s.im[k];
  }
  return s;
}
export const filtered = (x, rate, H) => signal(applyH(spectrum(x), rate, H));

// filter responses at frequency f, as [re, im]
export const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
/// One pole low-pass (in time: an exponential decay): 1 / (1 + j f/fc).
export const lp1 = (f, fc) => { const r = f / fc, d = 1 + r * r; return [1 / d, -r / d]; };
/// A resonance: a two-pole band-pass of gain 1 at f0 (in time: a ring that dies away over about q / (pi f0) seconds).
export const bp = (f, f0, q) => { const r = f / f0, a = 1 - r * r, b = r / q, d = a * a + b * b; return [(b * b) / d, (a * b) / d]; };
/// Second-order high-pass (Butterworth).
export const hp2 = (f, fc) => { const r = f / fc, a = 1 - r * r, b = Math.SQRT2 * r, d = a * a + b * b; return [(-r * r * a) / d, (r * r * b) / d]; };
/// A smooth hump round f0, `octaves` wide (a gain, no delay).
export const bump = (f, f0, octaves) => (f <= 0 ? 0 : Math.exp(-0.5 * (Math.log2(f / f0) / octaves) ** 2));

export const rms = (x) => { let e = 0; for (let i = 0; i < x.length; i++) e += x[i] * x[i]; return Math.sqrt(e / x.length); };
export const peak = (x) => { let p = 0; for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i])); return p; };
export const scaled = (x, g) => { for (let i = 0; i < x.length; i++) x[i] *= g; return x; };
/// To this RMS (and no peak above `cap`).
export function level(x, target, cap = 0.92) {
  const r = rms(x);
  if (r > 0) scaled(x, target / r);
  const p = peak(x);
  if (p > cap) scaled(x, cap / p);
  return x;
}

/// A loop of noise with the spectrum `mag(f)`, RMS 1: random phases given to the loop's own harmonics, so it has no seam.
export function noiseLoop(n, rand, mag, rate = RATE) {
  const s = { re: new Float64Array(n), im: new Float64Array(n) };
  for (let k = 1; k < n / 2; k++) {
    const g = mag((k * rate) / n);
    if (!(g > 0)) continue;
    s.re[k] = g * rand.gauss(); s.im[k] = g * rand.gauss();
    s.re[n - k] = s.re[k]; s.im[n - k] = -s.im[k];
  }
  return level(signal(s), 1, Infinity);
}
/// Slow, smooth random movement between two frequencies (RMS 1, mean exactly 0), for wander and swell.
export const drift = (n, rand, lo, hi, rate = RATE) => noiseLoop(n, rand, (f) => (f >= lo && f <= hi ? 1 : 0), rate);

/// Adds an impulse at a place between samples, round the circle.
export function put(buf, at, amp) {
  const n = buf.length;
  const i = Math.floor(at), frac = at - i;
  buf[((i % n) + n) % n] += amp * (1 - frac);
  buf[(((i + 1) % n) + n) % n] += amp * frac;
}

export function writeWav(file, x) {
  const data = Buffer.alloc(x.length * 2);
  for (let i = 0; i < x.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), i * 2);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVEfmt ", 8);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24); head.writeUInt32LE(RATE * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write("data", 36); head.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([head, data]));
}

// ---- the two engines ---------------------------------------------------------------------------------------------------------

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (v, a, b) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const ORDER = [1, 5, 3, 6, 2, 4];

// `cycles`: the engine cycles in each band's loop (times 80.75 rpm). Resonances are [Hz, Q, strength].
// `mix(x, on)`: the level of each source (as a share of the exhaust's) at x = 0 (idle) to 1 (the limit), throttle down or lifted.
export const ENGINES = {
  car_gt: {
    idle: 750, max: 7000, cycles: [9, 13, 20, 28, 41, 60, 87],
    // a twin-scroll manifold: cylinders 1-3 and 4-6 reach the turbine by two paths, one a little longer and weaker
    cylGain: [1, 1, 1, 0.88, 0.88, 0.88], cylDelay: [0, 0, 0, 0.35, 0.35, 0.35], // (ms)
    vary: 0.03, jitter: 0.004, burble: 0.35, knockVary: 0.15,
    // the turbine takes the edge off the exhaust: a soft pulse, low resonances, and a little bite round 1.5 kHz
    exhaust: { src: [2.4, 70], srcOff: [1.5, 50], direct: 1, res: [[130, 1.6, 0.7], [290, 1.8, 0.7], [470, 2, 0.5], [760, 2.5, 0.35], [1500, 2, 0.3]], silencer: 2600 },
    intake: { src: [3.5, 150], direct: 0.2, res: [[160, 2, 0.5], [380, 3, 1.0], [760, 3.5, 0.9], [1750, 3, 0.45]], top: 5000 },
    block: { src: 2500, res: [[1150, 5, 1], [2300, 6, 0.6], [3700, 5, 0.3]], spread: 0.05 },
    valves: { res: [[2900, 3, 1], [4600, 3, 0.6]], whirr: [2600, 1.0] },
    flow: { centre: 1500, width: 1.1 },
    mix(x, on) {
      const fuelled = (1 - x) ** 3; // off the throttle the engine is only fed near idle
      return on
        ? { exhaust: 1, intake: 0.45 + 1.1 * x, block: 0.12 + 0.06 * x, valves: 0.05 + 0.12 * x, flow: 0.08 + 0.3 * x, fan: 0, crackle: 0 }
        : { exhaust: 1, intake: 0.06 + 0.3 * fuelled, block: 0.05 + 0.07 * fuelled, valves: 0.08 + 0.3 * x, flow: 0.05, fan: 0, crackle: 0.35 * smooth(x, 0.3, 0.6) };
    },
  },
  car_offroad: {
    idle: 650, max: 4200, cycles: [8, 12, 17, 25, 36, 52],
    // a log manifold and six worn injectors: no two cylinders alike
    cylGain: [1, 0.84, 0.95, 0.78, 0.98, 0.88], cylDelay: [0, 0.2, 0.45, 0.7, 0.5, 0.25],
    vary: 0.12, jitter: 0.012, burble: 0, knockVary: 0.3,
    exhaust: { src: [1.8, 45], srcOff: [1.3, 40], direct: 1.2, res: [[118, 1.4, 0.45], [250, 1.8, 0.6], [420, 2, 0.5], [800, 2, 0.3]], silencer: 1100 },
    intake: { src: [2.5, 90], direct: 0.2, res: [[170, 2, 0.6], [310, 3, 1.0], [540, 3, 0.5]], top: 2500 },
    block: { src: 9000, res: [[820, 6, 1], [1450, 8, 0.9], [2300, 8, 0.7], [3400, 7, 0.45], [5200, 5, 0.2]], spread: 0.07 },
    valves: { res: [[2200, 3, 1], [3800, 3, 0.7]], whirr: [1800, 1.1] },
    flow: { centre: 750, width: 1.1 },
    fan: { centre: 650, width: 1.4 },
    mix(x, on) {
      const fuelled = (1 - x) ** 1.2; // (a diesel on the overrun injects little: less knock; at idle it knocks whatever the foot does)
      return on
        ? { exhaust: 1, intake: 0.35 + 0.35 * x, block: 0.55 + 0.3 * x, valves: 0.14 + 0.2 * x, flow: 0.06 + 0.3 * x, fan: 0.6 * x ** 1.5, crackle: 0 }
        : { exhaust: 0.9, intake: 0.3, block: 0.12 + 0.5 * fuelled, valves: 0.2 + 0.5 * x, flow: 0.04, fan: 0.6 * x ** 1.5, crackle: 0 };
    },
  },
};
export const bandRpm = (cycles) => cycles * RPM_PER_CYCLE;

/// One loop: `cycles` engine cycles of this engine with the throttle down ("on") or lifted ("off"). The same seed gives both
/// layers the same firings.
export function engineLoop(spec, cycles, layer, seed) {
  const N = LOOP, M = N * 2, rate = RATE * 2;
  const on = layer === "on";
  const rpm = bandRpm(cycles), f0 = rpm / 20;
  const x = clamp01((rpm - spec.idle) / (spec.max - spec.idle));
  const Tc = M / cycles, T0 = Tc / 6; // samples in an engine cycle, and between firings
  const w = spec.mix(x, on);
  const ms = rate / 1000;

  // the firings: the two layers share their instants (the same random numbers), only the off layer's strengths wander more
  const timing = new Rand(seed), strength = new Rand(seed ^ (on ? 0x51ed : 0x9e37)), rand = new Rand(seed * 7919 + (on ? 1 : 2));
  const vary = on ? spec.vary : spec.vary + spec.burble * x;
  const events = [];
  for (let c = 0; c < cycles; c++) {
    for (let i = 0; i < 6; i++) {
      const t = (c + i / 6) * Tc + spec.jitter * T0 * timing.gauss();
      events.push({ t, cyl: ORDER[i] - 1, s: Math.max(0.15, 1 + vary * strength.gauss()) });
    }
  }

  const total = { re: new Float64Array(M), im: new Float64Array(M) };
  /// Adds a source: this signal through H, brought to RMS 1, times `weight`.
  const add = (buf, H, weight) => {
    if (!(weight > 0)) return;
    const s = spectrum(buf);
    if (H) applyH(s, rate, H);
    const p = Math.sqrt(power(s));
    if (!(p > 0)) return;
    const g = weight / p;
    for (let i = 0; i < M; i++) { total.re[i] += s.re[i] * g; total.im[i] += s.im[i] * g; }
  };
  const tract = (part) => (f) => {
    let re = part.direct ?? 0, im = 0;
    for (const [fr, q, g] of part.res) { const h = bp(f, fr, q); re += g * h[0]; im += g * h[1]; }
    return [re, im];
  };

  // exhaust: a pulse per firing (rising fast, dying away: two poles), through the pipes and the silencer
  const ex = spec.exhaust;
  const exTract = tract(ex);
  const exH = (corner) => (f) => { const s = lp1(f, corner); return cmul(cmul(cmul(s, s), exTract(f)), lp1(f, ex.silencer)); };
  const [ka, kb] = on ? ex.src : ex.srcOff;
  const exhaust = new Float64Array(M);
  for (const e of events) put(exhaust, e.t + spec.cylDelay[e.cyl] * ms, spec.cylGain[e.cyl] * e.s);
  add(exhaust, exH(ka * f0 + kb), w.exhaust);

  // intake: the opposite sign, a little after each firing's place in the pattern, steadier than the exhaust
  const inn = spec.intake;
  const inTract = tract(inn);
  const intake = new Float64Array(M);
  for (const e of events) put(intake, e.t + 0.37 * T0, -(0.5 + 0.5 * e.s));
  const inCorner = inn.src[0] * f0 + inn.src[1];
  add(intake, (f) => { const s = lp1(f, inCorner); return cmul(cmul(cmul(s, s), inTract(f)), lp1(f, inn.top)); }, w.intake);

  // block: each cylinder's knock rings the metal at its own pitches
  const bl = spec.block;
  const blockSum = { re: new Float64Array(M), im: new Float64Array(M) };
  for (let cyl = 0; cyl < 6; cyl++) {
    const buf = new Float64Array(M);
    for (const e of events) if (e.cyl === cyl) put(buf, e.t, spec.cylGain[cyl] * e.s * e.s * Math.max(0.2, 1 + spec.knockVary * rand.gauss()));
    const tune = 1 + bl.spread * (((cyl * 5) % 6) / 2.5 - 1); // (spread over the six, in no order)
    const s = applyH(spectrum(buf), rate, (f) => {
      let re = 0, im = 0;
      for (const [fr, q, g] of bl.res) { const h = bp(f, fr * tune, q); re += g * h[0]; im += g * h[1]; }
      return cmul([re, im], lp1(f, bl.src));
    });
    for (let i = 0; i < M; i++) { blockSum.re[i] += s.re[i]; blockSum.im[i] += s.im[i]; }
  }
  { const p = Math.sqrt(power(blockSum)); if (p > 0 && w.block > 0) for (let i = 0; i < M; i++) { total.re[i] += (blockSum.re[i] * w.block) / p; total.im[i] += (blockSum.im[i] * w.block) / p; } }

  // valves: four ticks to a firing (two valves opening, two closing), and the steady whirr of the belt and what it turns
  const va = spec.valves;
  const ticks = new Float64Array(M);
  for (const e of events) for (const at of [0.12, 0.41, 0.63, 0.88]) put(ticks, e.t + (at + 0.01 * rand.gauss()) * T0, rand.range(0.5, 1) * (rand.next() < 0.5 ? -1 : 1));
  const valves = filtered(ticks, rate, tract({ res: va.res }));
  const whirr = noiseLoop(M, rand, (f) => bump(f, va.whirr[0], va.whirr[1]), rate);
  const vr = rms(valves);
  for (let i = 0; i < M; i++) valves[i] = valves[i] / vr + 0.45 * whirr[i];
  add(valves, null, w.valves);

  // flow: hiss that swells after each firing and falls away before the next
  const fl = spec.flow;
  const tau = Math.max(0.0015, Math.min(0.009, (0.3 * T0) / rate));
  const puffs = new Float64Array(M);
  for (const e of events) put(puffs, e.t + spec.cylDelay[e.cyl] * ms, e.s);
  const swell = filtered(puffs, rate, (f) => lp1(f, 1 / (2 * Math.PI * tau)));
  let mean = 0;
  for (let i = 0; i < M; i++) mean += Math.max(0, swell[i]) / M;
  const hiss = noiseLoop(M, rand, () => 1, rate);
  for (let i = 0; i < M; i++) hiss[i] *= Math.max(0, swell[i]) + 0.2 * mean;
  add(hiss, (f) => bump(f, fl.centre, fl.width), w.flow);

  // fan: a steady roar
  if (spec.fan) add(noiseLoop(M, rand, (f) => bump(f, spec.fan.centre, spec.fan.width), rate), null, w.fan);

  // crackle: now and then a firing's worth of fuel burns in the pipe instead: a bang down the exhaust and a burst of noise
  if (w.crackle > 0) {
    const pops = Math.round(((5 + 9 * x) * N) / RATE);
    const bangs = new Float64Array(M), bursts = new Float64Array(M);
    for (let k = 0; k < pops; k++) {
      const e = events[Math.floor(rand.next() * events.length)];
      const a = rand.range(1, 2.5);
      put(bangs, e.t + 2.2 * ms, a);
      put(bursts, e.t + 2.2 * ms, a);
    }
    add(bangs, exH(900), w.crackle * 0.8);
    const env = filtered(bursts, rate, (f) => lp1(f, 1 / (2 * Math.PI * 0.004)));
    const spit = noiseLoop(M, rand, () => 1, rate);
    for (let i = 0; i < M; i++) spit[i] *= Math.max(0, env[i]);
    add(spit, (f) => bump(f, 1100, 1.2), w.crackle * 0.6);
  }

  // the peaks rounded (at the high rate, so that what the rounding adds can be removed), then nothing under 20 Hz or over 17 kHz, and
  // the rate halved by keeping the lower half of the spectrum
  const y = signal(total);
  const r = rms(y), LIMIT = 2.6;
  for (let i = 0; i < M; i++) y[i] = LIMIT * Math.tanh(y[i] / r / LIMIT);
  const s = spectrum(y);
  const out = { re: new Float64Array(N), im: new Float64Array(N) };
  for (let k = 1; k < N / 2; k++) {
    const f = (k * RATE) / N;
    if (f > 17000) break;
    const h = hp2(f, 20), fade = f > 15000 ? 0.5 + 0.5 * Math.cos((Math.PI * (f - 15000)) / 2000) : 1;
    out.re[k] = (s.re[k] * h[0] - s.im[k] * h[1]) * fade; out.im[k] = (s.re[k] * h[1] + s.im[k] * h[0]) * fade;
    out.re[N - k] = out.re[k]; out.im[N - k] = -out.im[k];
  }
  return level(signal(out), 0.2);
}

function main() {
  const project = path.resolve(process.argv[2] ?? path.join(ROOT, "examples/pine-ridge-rally"));
  const dir = path.join(project, "sounds");
  const made = new Set();
  let seed = 11;
  for (const [id, spec] of Object.entries(ENGINES)) {
    spec.cycles.forEach((cycles, j) => {
      seed += 1;
      for (const layer of ["on", "off"]) {
        const name = layer === "on" ? `eng_${id}_${j + 1}.wav` : `eng_${id}_off_${j + 1}.wav`;
        writeWav(path.join(dir, name), engineLoop(spec, cycles, layer, seed));
        made.add(name);
      }
    });
    console.log(id.padEnd(12), spec.cycles.map((c) => Math.round(bandRpm(c))).join(" "), "rpm");
  }
  // only these two engines: the loops of any other (cars that have left the game) are taken away
  for (const f of fs.readdirSync(dir)) if (/^eng_.*\.wav$/.test(f) && !made.has(f)) { fs.unlinkSync(path.join(dir, f)); console.log("removed", f); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
