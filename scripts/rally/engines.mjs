// Pine Ridge Rally's engines, made offline from a model of each (no recording, nothing to license). Every car has its own:
//
//   car_gt       3.0 turbo straight-six petrol      car_offroad  4.2 straight-six diesel, no turbo
//   car_s15      2.0 turbo four (car_s14 plays the same loops with its own mix: lib/audio.lua)
//   car_hatch_r  2.0 turbo four, hard-edged         car_hatch    2.0 four, no turbo, quiet
//   car_city     0.8 three-cylinder                 car_rally    2.4 four on open carburettors
//   car_gt2      2.5 turbo five, racing exhaust     car_muscle   5.6 cross-plane V8
//   car_suv      2.8 turbo diesel four              car_truck    7.2 turbo diesel six
//   car_pickup   3.4 twin-turbo V6
//
// The model. A four-stroke engine's pattern repeats every two turns of the crank (720 degrees, rpm / 120 times a second: the
// "engine cycle"), and in that time each cylinder fires once. A `layout` says how many cylinders there are, the order they fire
// in, at what crank angles (evenly spread unless `angles` says otherwise) and which exhaust bank each belongs to. An even engine
// of n cylinders fires rpm x n / 120 times a second (a three rpm / 40, a four rpm / 30, a five rpm / 24, a six rpm / 20, a V8
// rpm / 15): that is its note. What sits under the note, on the other multiples of rpm / 120 (the half-orders), is the burr:
//   - no two cylinders are alike (`cylGain`, `cylDelay`: unequal pipes), a little in a tidy engine, a lot in a five
//   - a cross-plane V8 fires evenly as a whole but unevenly on each bank (left-right-right-left-right-left-left-right). A
//     firing that follows close on another in its own bank's pipe finds it still full and comes out weaker, one after a long
//     gap stronger (`crowd`: the pulse's strength goes with the gap to the power of it), and each bank has its own pipe
//     (`bankGain`, `bankDelay`, `bankTune`), so the two never cancel: the burble, the same at any revs
//   - `angles` that are not evenly spread (an odd-fire engine) put the pattern itself on the half-orders
// Each firing is an event with its own strength (combustion is never twice the same) and a little wander in its timing; every
// event feeds several sources:
//   exhaust  a pressure pulse down that cylinder's pipe, through its bank's resonances and the silencer
//   intake   a pulse of the opposite sign through the plenum's and the runners' resonances: the howl or bark under load
//   block    the knock of the combustion ringing the engine's metal (a different ring for each cylinder): faint in a petrol
//            engine, a diesel's voice at idle
//   valves   the valve train's ticks, and the whirr of what the engine drives
//   flow     the hiss of gas leaving the tail pipe, in bursts after each firing
//   fan      a diesel's cooling fan, a roar that grows with the revs
//   crackle  some petrol engines off the throttle at high revs: unburnt fuel popping in the exhaust
// Each source is brought to a known level, then mixed by a table that depends on the revs and on whether the throttle is down
// (`on`) or lifted (`off`): every band of revs has both loops, of the same length and with the same firings at the same
// instants, so the game can crossfade the two as the foot moves without the notes beating. Last, `tone` is what the car's body
// keeps from the driver: everything above it is turned down, so that the note and its first harmonics carry the sound.
//
// How the loops stay clean. A band is named by its `cycles`: the engine cycles a loop of 65536 samples would hold, so its revs
// are that number times 80.75 rpm (lib/audio.lua has the same numbers and plays each loop at the pitch that makes it the engine's
// note). A band of 16 cycles or more (always an even number) is written at half the length with half the cycles: the same revs
// in half the bytes, and still eight engine cycles or more before it repeats. Everything is built round the circle: events wrap,
// and every filter is applied to the loop's own spectrum (one long FFT), so a loop has no seam at all. It is made at twice the
// sample rate, the peaks are rounded there (a soft limit: knocks are tall), and only then is everything above 17 kHz removed and
// the rate halved: nothing folds back as aliasing. All loops leave at the same loudness (RMS), and
// `scripts/rally/sound-check.mjs` measures all of this.
//
//   node scripts/rally/engines.mjs [project folder] [--only car_gt,car_muscle]
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

// ---- the engines -------------------------------------------------------------------------------------------------------------

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (v, a, b) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const even = (n) => Array.from({ length: n }, (_, i) => (i * 720) / n);

/// The firings of one engine cycle, in order: [{ cyl (from 0), angle (degrees of the 720), bank }].
/// `gap` is the crank angle since the firing before it on the same bank, as a share of that bank's mean (1 in an even bank).
export function firings(layout) {
  const angles = layout.angles ?? even(layout.order.length);
  const all = layout.order.map((c, i) => ({ cyl: c - 1, angle: angles[i], bank: layout.banks ? layout.banks[c - 1] : 0 }));
  for (const e of all) {
    const own = all.filter((o) => o.bank === e.bank);
    const before = own[(own.indexOf(e) + own.length - 1) % own.length];
    e.gap = ((((e.angle - before.angle) % 720) + 720) % 720 || 720) / (720 / own.length);
  }
  return all;
}
/// How many times a turn of the engine cycle the firing pattern repeats when every cylinder is alike: the engine's note is this
/// many times rpm / 120. An even engine: its cylinders. Uneven angles: the lowest harmonic of the cycle the pattern has at all.
export function patternOrder(layout) {
  const f = firings(layout);
  for (let h = 1; h <= f.length; h++) {
    let re = 0, im = 0;
    for (const e of f) { re += Math.cos((2 * Math.PI * h * e.angle) / 720); im += Math.sin((2 * Math.PI * h * e.angle) / 720); }
    if (Math.hypot(re, im) > 1e-6 * f.length) return h;
  }
  return f.length;
}
/// The firing frequency (Hz) of an engine at these revs: firings a second, counted evenly.
export const firingHz = (spec, rpm) => (rpm * spec.layout.order.length) / 120;

/// The level of each source (as a share of the exhaust's) at x = 0 (idle) to 1 (the limit), throttle down (`on`) or lifted.
/// Each entry is [at idle, added by the limit]; the `off` ones are [what is always there, what only a fed engine adds]
/// (`fuel`: off the throttle the engine is only fed near idle, less the higher it turns).
const mixer = (m) => (x, on) => {
  const fuelled = (1 - x) ** (m.fuel ?? 3);
  const at = ([a, b], v) => a + b * v;
  return on
    ? { exhaust: 1, intake: at(m.intake, x), block: at(m.block, x), valves: at(m.valves, x), flow: at(m.flow, x), fan: (m.fan ?? 0) * x ** 1.5, crackle: 0 }
    : { exhaust: m.exhaustOff ?? 1, intake: at(m.intakeOff, fuelled), block: at(m.blockOff, fuelled), valves: at(m.valvesOff ?? m.valves, x), flow: m.flowOff ?? 0.04, fan: (m.fan ?? 0) * x ** 1.5, crackle: (m.crackle ?? 0) * smooth(x, 0.3, 0.6) };
};

const SIX = { order: [1, 5, 3, 6, 2, 4] };
const FOUR = { order: [1, 3, 4, 2] };

// `cycles`: each band's revs, in engine cycles to 65536 samples (times 80.75 rpm). Resonances are [Hz, Q, strength].
// `src`: how sharp a pulse is, [a, b]: its corner is a x rpm / 20 + b Hz (a pulse lasts a share of a turn, so it sharpens with the revs).
export const ENGINES = {
  // 3.0 turbo straight-six petrol: smooth, an intake howl that rises, the exhaust softened by the turbine
  car_gt: {
    idle: 750, max: 7000, cycles: [9, 13, 20, 28, 40, 58, 86], layout: SIX,
    // a twin-scroll manifold: cylinders 1-3 and 4-6 reach the turbine by two paths, one longer and weaker. They fire in turn,
    // so the difference sounds an octave under the note (the 1.5th order): the six's body
    cylGain: [1, 0.97, 1, 0.74, 0.78, 0.74], cylDelay: [0, 0.05, 0, 0.6, 0.65, 0.6], // (ms)
    vary: 0.03, jitter: 0.004, burble: 0.3, knockVary: 0.15,
    exhaust: { src: [2.2, 70], srcOff: [1.5, 50], direct: 1.1, res: [[115, 1.6, 0.8], [250, 1.8, 0.8], [430, 2, 0.5], [700, 2.3, 0.3], [1300, 2, 0.15]], silencer: 1900 },
    intake: { src: [3.0, 140], direct: 0.2, res: [[150, 2, 0.6], [340, 3, 1.0], [680, 3.2, 0.7], [1400, 2.5, 0.2]], top: 3200 },
    block: { src: 2200, res: [[1050, 5, 1], [2000, 5, 0.4]], spread: 0.05 },
    valves: { res: [[2400, 3, 1], [3600, 3, 0.4]], whirr: [1700, 1.0] },
    flow: { centre: 1000, width: 1.1 }, tone: 2400,
    mix: mixer({ intake: [0.4, 0.8], intakeOff: [0.06, 0.3], block: [0.08, 0.03], blockOff: [0.04, 0.05], valves: [0.04, 0.05], valvesOff: [0.05, 0.08], flow: [0.06, 0.14], crackle: 0.22 }),
  },
  // 4.2 straight-six diesel, no turbo: low and heavy, the knock of the combustion in the block, a fan
  car_offroad: {
    idle: 650, max: 4200, cycles: [8, 11, 16, 24, 36, 52], layout: SIX,
    // a log manifold and six worn injectors: no two cylinders alike
    cylGain: [1, 0.8, 0.95, 0.72, 0.98, 0.85], cylDelay: [0, 0.25, 0.5, 0.8, 0.55, 0.3],
    vary: 0.12, jitter: 0.012, burble: 0, knockVary: 0.3,
    exhaust: { src: [1.7, 45], srcOff: [1.3, 40], direct: 1.3, res: [[95, 1.4, 0.6], [200, 1.8, 0.7], [360, 2, 0.5], [640, 2, 0.25]], silencer: 950 },
    intake: { src: [2.3, 90], direct: 0.2, res: [[140, 2, 0.6], [270, 3, 1.0], [480, 3, 0.4]], top: 2000 },
    block: { src: 4200, res: [[560, 5, 1], [980, 6, 0.9], [1600, 6, 0.6], [2500, 5, 0.3]], spread: 0.07 },
    valves: { res: [[1900, 3, 1], [3000, 3, 0.5]], whirr: [1300, 1.1] },
    flow: { centre: 600, width: 1.1 }, fan: { centre: 420, width: 1.3 }, tone: 2600,
    // (a diesel on the overrun injects little: less knock; at idle it knocks whatever the foot does)
    mix: mixer({ fuel: 1.2, intake: [0.35, 0.3], intakeOff: [0.3, 0], block: [0.55, 0.15], blockOff: [0.12, 0.42], valves: [0.08, 0.07], valvesOff: [0.1, 0.1], flow: [0.05, 0.2], fan: 0.5, exhaustOff: 0.9 }),
  },
  // 2.0 turbo four: eager; a four's coarser beat (two firings a turn), the turbine rounding it off
  car_s15: {
    idle: 850, max: 7200, cycles: [10, 14, 20, 30, 42, 60, 88], layout: FOUR,
    cylGain: [1, 0.9, 0.96, 0.84], cylDelay: [0, 0.2, 0.4, 0.15],
    vary: 0.04, jitter: 0.005, burble: 0.3, knockVary: 0.15,
    exhaust: { src: [2.5, 70], srcOff: [1.6, 50], direct: 1.1, res: [[105, 1.6, 0.8], [225, 1.8, 0.8], [400, 2, 0.55], [680, 2.3, 0.35], [1250, 2, 0.2]], silencer: 2100 },
    intake: { src: [3.2, 140], direct: 0.2, res: [[170, 2, 0.6], [360, 3, 1.0], [720, 3, 0.6], [1350, 2.5, 0.2]], top: 3200 },
    block: { src: 2200, res: [[1100, 5, 1], [2100, 5, 0.4]], spread: 0.05 },
    valves: { res: [[2500, 3, 1], [3700, 3, 0.4]], whirr: [1700, 1.0] },
    flow: { centre: 1000, width: 1.1 }, tone: 2500,
    mix: mixer({ intake: [0.35, 0.7], intakeOff: [0.06, 0.3], block: [0.09, 0.03], blockOff: [0.04, 0.05], valves: [0.05, 0.05], valvesOff: [0.05, 0.08], flow: [0.06, 0.15], crackle: 0.12 }),
  },
  // 2.0 turbo four, hard-edged: a sharper pulse, a freer exhaust with an edge round 1.3 kHz, crackle on the overrun
  car_hatch_r: {
    idle: 800, max: 7000, cycles: [10, 14, 20, 28, 42, 60, 86], layout: FOUR,
    cylGain: [1, 0.86, 0.95, 0.8], cylDelay: [0, 0.3, 0.55, 0.2],
    vary: 0.05, jitter: 0.005, burble: 0.45, knockVary: 0.15,
    exhaust: { src: [3.1, 80], srcOff: [1.9, 55], direct: 1.0, res: [[125, 1.7, 0.7], [270, 2, 0.9], [480, 2.2, 0.6], [820, 2.5, 0.45], [1350, 2.2, 0.32]], silencer: 2700 },
    intake: { src: [3.2, 140], direct: 0.2, res: [[180, 2, 0.5], [390, 3, 1.0], [760, 3, 0.6], [1400, 2.5, 0.2]], top: 3200 },
    block: { src: 2200, res: [[1150, 5, 1], [2200, 5, 0.4]], spread: 0.05 },
    valves: { res: [[2500, 3, 1], [3700, 3, 0.4]], whirr: [1700, 1.0] },
    flow: { centre: 1100, width: 1.1 }, tone: 2800,
    mix: mixer({ intake: [0.3, 0.5], intakeOff: [0.06, 0.25], block: [0.09, 0.03], blockOff: [0.04, 0.05], valves: [0.05, 0.05], valvesOff: [0.05, 0.08], flow: [0.07, 0.18], crackle: 0.4 }),
  },
  // 2.0 four, no turbo: quiet and smooth; a well-silenced exhaust, a soft intake hum, nothing rough
  car_hatch: {
    idle: 750, max: 6500, cycles: [9, 14, 22, 34, 52, 80], layout: FOUR,
    cylGain: [1, 0.92, 0.97, 0.88], cylDelay: [0, 0.12, 0.25, 0.08],
    vary: 0.035, jitter: 0.004, burble: 0.1, knockVary: 0.1,
    exhaust: { src: [1.8, 55], srcOff: [1.4, 45], direct: 1.2, res: [[100, 1.5, 0.7], [210, 1.7, 0.7], [370, 1.8, 0.4], [620, 2, 0.2]], silencer: 1200 },
    intake: { src: [2.6, 120], direct: 0.2, res: [[160, 2, 0.6], [330, 2.5, 1.0], [640, 2.5, 0.45]], top: 2400 },
    block: { src: 2000, res: [[1000, 4, 1], [1900, 4, 0.3]], spread: 0.04 },
    valves: { res: [[2300, 3, 1], [3400, 3, 0.4]], whirr: [1500, 1.0] },
    flow: { centre: 800, width: 1.1 }, tone: 2000,
    mix: mixer({ intake: [0.3, 0.45], intakeOff: [0.06, 0.25], block: [0.07, 0.02], blockOff: [0.04, 0.04], valves: [0.05, 0.04], valvesOff: [0.05, 0.06], flow: [0.05, 0.1] }),
  },
  // 0.8 three-cylinder: thrummy and small; three firings to two turns (the 1.5th order), short pipes that ring higher
  car_city: {
    idle: 900, max: 6200, cycles: [11, 16, 24, 34, 52, 76], layout: { order: [1, 2, 3] },
    cylGain: [1, 0.9, 0.95], cylDelay: [0, 0.2, 0.1],
    vary: 0.05, jitter: 0.006, burble: 0.15, knockVary: 0.2,
    exhaust: { src: [2.4, 60], srcOff: [1.6, 50], direct: 1.4, res: [[135, 1.8, 0.9], [290, 2, 0.7], [520, 2, 0.4], [880, 2, 0.2]], silencer: 1500 },
    intake: { src: [2.8, 130], direct: 0.25, res: [[210, 2.2, 0.7], [450, 2.8, 1.0], [850, 2.5, 0.4]], top: 2600 },
    block: { src: 2400, res: [[1250, 4, 1], [2300, 4, 0.35]], spread: 0.05 },
    valves: { res: [[2600, 3, 1], [3800, 3, 0.4]], whirr: [1800, 1.0] },
    flow: { centre: 1000, width: 1.0 }, tone: 2300,
    mix: mixer({ intake: [0.35, 0.5], intakeOff: [0.08, 0.25], block: [0.12, 0.03], blockOff: [0.06, 0.05], valves: [0.08, 0.05], valvesOff: [0.08, 0.07], flow: [0.05, 0.1] }),
  },
  // 2.4 four on open carburettors, no turbo: the intake is the voice (four open trumpets: a loud raspy bark), an open exhaust
  car_rally: {
    idle: 1000, max: 7600, cycles: [12, 18, 28, 42, 62, 92], layout: FOUR,
    cylGain: [1, 0.88, 0.95, 0.82], cylDelay: [0, 0.25, 0.5, 0.2],
    vary: 0.06, jitter: 0.006, burble: 0.5, knockVary: 0.2,
    exhaust: { src: [3.2, 90], srcOff: [2.0, 60], direct: 1.0, res: [[120, 1.7, 0.7], [260, 2, 0.9], [460, 2.2, 0.6], [800, 2.5, 0.4], [1300, 2.2, 0.25]], silencer: 2800 },
    intake: { src: [5.0, 200], direct: 0.35, res: [[190, 2, 0.5], [410, 3, 1.0], [800, 3.5, 1.0], [1450, 3, 0.42], [2200, 2.5, 0.12]], top: 3600 },
    block: { src: 2400, res: [[1150, 5, 1], [2200, 5, 0.4]], spread: 0.05 },
    valves: { res: [[2500, 3, 1], [3700, 3, 0.4]], whirr: [1700, 1.0] },
    flow: { centre: 1100, width: 1.1 }, tone: 3200,
    mix: mixer({ intake: [0.8, 1.2], intakeOff: [0.1, 0.5], block: [0.1, 0.03], blockOff: [0.05, 0.05], valves: [0.07, 0.05], valvesOff: [0.07, 0.08], flow: [0.07, 0.15], crackle: 0.3 }),
  },
  // 2.5 turbo five, racing exhaust: five firings to two turns (the 2.5th order, a note between a four's and a six's) and five
  // pipes of five lengths, so the pulses reach the collector unevenly: the five's warble
  car_gt2: {
    idle: 1100, max: 7200, cycles: [13, 20, 28, 42, 60, 88], layout: { order: [1, 2, 4, 5, 3] },
    cylGain: [1, 0.68, 0.92, 0.6, 0.82], cylDelay: [0, 0.3, 0.55, 0.2, 0.45],
    vary: 0.06, jitter: 0.006, burble: 0.45, knockVary: 0.2,
    exhaust: { src: [3.0, 80], srcOff: [1.9, 55], direct: 1.0, res: [[120, 1.7, 0.7], [255, 2, 0.9], [440, 2.2, 0.65], [760, 2.5, 0.45], [1300, 2.2, 0.3]], silencer: 2900 },
    intake: { src: [3.2, 140], direct: 0.2, res: [[170, 2, 0.5], [370, 3, 1.0], [730, 3, 0.6], [1400, 2.5, 0.2]], top: 3200 },
    block: { src: 2200, res: [[1100, 5, 1], [2100, 5, 0.4]], spread: 0.05 },
    valves: { res: [[2500, 3, 1], [3700, 3, 0.4]], whirr: [1700, 1.0] },
    flow: { centre: 1100, width: 1.1 }, tone: 3000,
    mix: mixer({ intake: [0.3, 0.5], intakeOff: [0.06, 0.25], block: [0.1, 0.03], blockOff: [0.05, 0.05], valves: [0.06, 0.05], valvesOff: [0.06, 0.08], flow: [0.08, 0.2], crackle: 0.45 }),
  },
  // 5.6 cross-plane V8: it fires evenly as a whole (every 90 degrees) but 1-8-4-3-6-5-7-2 puts the firings on each bank
  // left-right-right-left-right-left-left-right, and each bank has its own pipe: the burble. Deep, a lumpy idle, no turbo
  car_muscle: {
    idle: 700, max: 5600, cycles: [8, 13, 20, 30, 46, 68], layout: { order: [1, 8, 4, 3, 6, 5, 7, 2], banks: [0, 1, 0, 1, 0, 1, 0, 1] },
    cylGain: [1, 0.95, 0.9, 1, 0.93, 0.88, 0.97, 0.92], cylDelay: [0, 0.05, 0.1, 0.15, 0.1, 0.2, 0.05, 0.15],
    crowd: 1.2, bankGain: [1, 0.45], bankDelay: [0, 0.3], bankTune: [1, 1.18],
    vary: 0.09, jitter: 0.009, burble: 0.3, knockVary: 0.25,
    exhaust: { src: [2.0, 45], srcOff: [1.5, 40], direct: 1.3, res: [[72, 1.5, 0.8], [150, 1.8, 0.9], [265, 2, 0.6], [440, 2, 0.35], [760, 2, 0.2]], silencer: 1500 },
    intake: { src: [2.6, 110], direct: 0.25, res: [[130, 2, 0.6], [280, 2.5, 1.0], [540, 2.5, 0.5]], top: 2400 },
    block: { src: 2000, res: [[900, 4, 1], [1700, 4, 0.35]], spread: 0.06 },
    valves: { res: [[2000, 3, 1], [3100, 3, 0.4]], whirr: [1400, 1.0] },
    flow: { centre: 750, width: 1.1 }, tone: 2200,
    mix: mixer({ intake: [0.3, 0.45], intakeOff: [0.08, 0.25], block: [0.1, 0.03], blockOff: [0.05, 0.05], valves: [0.07, 0.04], valvesOff: [0.07, 0.06], flow: [0.07, 0.15], crackle: 0.15 }),
  },
  // 2.8 turbo diesel four: a modern diesel: the knock is there but damped, the turbine muffles the exhaust
  car_suv: {
    idle: 700, max: 4400, cycles: [8, 12, 18, 26, 38, 54], layout: FOUR,
    cylGain: [1, 0.9, 0.96, 0.86], cylDelay: [0, 0.2, 0.35, 0.15],
    vary: 0.07, jitter: 0.008, burble: 0, knockVary: 0.25,
    exhaust: { src: [1.8, 45], srcOff: [1.3, 40], direct: 1.3, res: [[90, 1.5, 0.7], [190, 1.8, 0.8], [340, 2, 0.5], [600, 2, 0.25]], silencer: 850 },
    intake: { src: [2.3, 90], direct: 0.2, res: [[150, 2, 0.6], [300, 2.8, 1.0], [540, 2.5, 0.4]], top: 2000 },
    block: { src: 3600, res: [[640, 4, 1], [1150, 5, 0.8], [1900, 5, 0.45]], spread: 0.06 },
    valves: { res: [[2000, 3, 1], [3100, 3, 0.4]], whirr: [1400, 1.0] },
    flow: { centre: 650, width: 1.1 }, tone: 2000,
    mix: mixer({ fuel: 1.2, intake: [0.3, 0.3], intakeOff: [0.25, 0], block: [0.34, 0.08], blockOff: [0.09, 0.26], valves: [0.06, 0.05], valvesOff: [0.07, 0.07], flow: [0.05, 0.15], exhaustOff: 0.9 }),
  },
  // 7.2 turbo diesel six: very low and slow; long pipes, a big block that knocks at a low pitch, a big fan
  car_truck: {
    idle: 600, max: 2500, cycles: [7, 10, 14, 20, 30], layout: SIX,
    cylGain: [1, 0.86, 0.95, 0.8, 0.97, 0.88], cylDelay: [0, 0.4, 0.8, 1.2, 0.9, 0.5],
    vary: 0.1, jitter: 0.01, burble: 0, knockVary: 0.3,
    exhaust: { src: [1.6, 35], srcOff: [1.2, 30], direct: 1.4, res: [[58, 1.4, 0.7], [120, 1.8, 0.9], [215, 2, 0.6], [380, 2, 0.3]], silencer: 700 },
    intake: { src: [2.2, 70], direct: 0.2, res: [[95, 2, 0.6], [190, 2.8, 1.0], [350, 2.5, 0.4]], top: 1500 },
    block: { src: 3000, res: [[400, 5, 1], [720, 6, 0.9], [1200, 6, 0.6], [1900, 5, 0.3]], spread: 0.07 },
    valves: { res: [[1500, 3, 1], [2400, 3, 0.5]], whirr: [1000, 1.1] },
    flow: { centre: 450, width: 1.1 }, fan: { centre: 320, width: 1.3 }, tone: 1900,
    mix: mixer({ fuel: 1.2, intake: [0.35, 0.3], intakeOff: [0.3, 0], block: [0.5, 0.12], blockOff: [0.12, 0.38], valves: [0.07, 0.06], valvesOff: [0.08, 0.08], flow: [0.05, 0.2], fan: 0.55, exhaustOff: 0.9 }),
  },
  // 3.4 twin-turbo V6: the banks fire in turn, each evenly into its own turbine: smooth and deep, a little uneven between the banks
  car_pickup: {
    idle: 650, max: 5800, cycles: [8, 11, 16, 24, 34, 50, 70], layout: { order: [1, 4, 2, 5, 3, 6], banks: [0, 0, 0, 1, 1, 1] },
    cylGain: [1, 0.95, 0.97, 1, 0.93, 0.96], cylDelay: [0, 0.1, 0.2, 0, 0.1, 0.2],
    bankGain: [1, 0.8], bankDelay: [0, 0.7], bankTune: [1, 1.06],
    vary: 0.04, jitter: 0.005, burble: 0.2, knockVary: 0.15,
    exhaust: { src: [2.1, 60], srcOff: [1.5, 45], direct: 1.2, res: [[88, 1.6, 0.8], [190, 1.8, 0.8], [330, 2, 0.5], [560, 2.2, 0.3], [950, 2, 0.15]], silencer: 1600 },
    intake: { src: [2.8, 120], direct: 0.2, res: [[130, 2, 0.6], [290, 2.8, 1.0], [580, 3, 0.6]], top: 2600 },
    block: { src: 2000, res: [[950, 5, 1], [1800, 5, 0.4]], spread: 0.05 },
    valves: { res: [[2200, 3, 1], [3300, 3, 0.4]], whirr: [1500, 1.0] },
    flow: { centre: 850, width: 1.1 }, tone: 2200,
    mix: mixer({ intake: [0.35, 0.6], intakeOff: [0.06, 0.3], block: [0.08, 0.03], blockOff: [0.04, 0.05], valves: [0.05, 0.04], valvesOff: [0.05, 0.07], flow: [0.06, 0.14] }),
  },
};
export const bandRpm = (cycles) => cycles * RPM_PER_CYCLE;
/// The samples in a band's file: half a loop (holding half the cycles) from 16 cycles up.
export const loopLength = (cycles) => (cycles >= 16 && cycles % 2 === 0 ? LOOP / 2 : LOOP);

/// One loop: the band of `cycles` (engine cycles to 65536 samples) of this engine with the throttle down ("on") or lifted
/// ("off"). The same seed gives both layers the same firings.
export function engineLoop(spec, cycles, layer, seed) {
  const N = loopLength(cycles), M = N * 2, rate = RATE * 2;
  const count = (cycles * N) / LOOP; // engine cycles in this file
  const on = layer === "on";
  const pattern = firings(spec.layout), n = pattern.length;
  const rpm = bandRpm(cycles), fr = rpm / 20; // (`fr`: a frequency that goes with the revs, the same for every layout)
  const x = clamp01((rpm - spec.idle) / (spec.max - spec.idle));
  const Tc = M / count, T0 = Tc / n, Ta = Tc / 6; // samples in an engine cycle, between firings, and in 120 degrees of crank
  const w = spec.mix(x, on);
  const ms = rate / 1000;
  const banks = 1 + Math.max(...pattern.map((e) => e.bank));

  // the firings: the two layers share their instants (the same random numbers), only the off layer's strengths wander more
  const timing = new Rand(seed), strength = new Rand(seed ^ (on ? 0x51ed : 0x9e37)), rand = new Rand(seed * 7919 + (on ? 1 : 2));
  const vary = on ? spec.vary : spec.vary + spec.burble * x;
  const events = [];
  for (let c = 0; c < count; c++) {
    for (const e of pattern) {
      const t = (c + e.angle / 720) * Tc + spec.jitter * T0 * timing.gauss();
      events.push({ t, cyl: e.cyl, bank: e.bank, s: Math.max(0.15, 1 + vary * strength.gauss()), crowd: e.gap ** (spec.crowd ?? 0) });
    }
  }
  /// when a firing's gas reaches the collector: its own pipe, then its bank's
  const arrives = (e) => e.t + (spec.cylDelay[e.cyl] + (spec.bankDelay?.[e.bank] ?? 0)) * ms;
  const bankGain = (e) => spec.bankGain?.[e.bank] ?? 1;

  const total = { re: new Float64Array(M), im: new Float64Array(M) };
  /// Adds a source: these signals, each through its own H, summed, brought to RMS 1, times `weight`.
  const add = (parts, weight) => {
    if (!(weight > 0)) return;
    const sum = { re: new Float64Array(M), im: new Float64Array(M) };
    for (const [buf, H] of parts) {
      const s = spectrum(buf);
      if (H) applyH(s, rate, H);
      for (let i = 0; i < M; i++) { sum.re[i] += s.re[i]; sum.im[i] += s.im[i]; }
    }
    const p = Math.sqrt(power(sum));
    if (!(p > 0)) return;
    const g = weight / p;
    for (let i = 0; i < M; i++) { total.re[i] += sum.re[i] * g; total.im[i] += sum.im[i] * g; }
  };
  const tract = (part, tune = 1) => (f) => {
    let re = part.direct ?? 0, im = 0;
    for (const [f0, q, g] of part.res) { const h = bp(f, f0 * tune, q); re += g * h[0]; im += g * h[1]; }
    return [re, im];
  };

  // exhaust: a pulse per firing (rising fast, dying away: two poles), through its bank's pipes and the silencer
  const ex = spec.exhaust;
  const exH = (corner, bank = 0) => { const tr = tract(ex, spec.bankTune?.[bank] ?? 1); return (f) => { const s = lp1(f, corner); return cmul(cmul(cmul(s, s), tr(f)), lp1(f, ex.silencer)); }; };
  const [ka, kb] = on ? ex.src : ex.srcOff;
  const exhaust = [];
  for (let b = 0; b < banks; b++) {
    const buf = new Float64Array(M);
    for (const e of events) if (e.bank === b) put(buf, arrives(e), spec.cylGain[e.cyl] * bankGain(e) * e.crowd * e.s);
    exhaust.push([buf, exH(ka * fr + kb, b)]);
  }
  add(exhaust, w.exhaust);

  // intake: the opposite sign, a little after each firing's place in the pattern, steadier than the exhaust
  const inn = spec.intake;
  const inTract = tract(inn);
  const intake = new Float64Array(M);
  for (const e of events) put(intake, e.t + 0.37 * Ta, -(0.5 + 0.5 * e.s));
  const inCorner = inn.src[0] * fr + inn.src[1];
  add([[intake, (f) => { const s = lp1(f, inCorner); return cmul(cmul(cmul(s, s), inTract(f)), lp1(f, inn.top)); }]], w.intake);

  // block: each cylinder's knock rings the metal at its own pitches
  const bl = spec.block;
  const knocks = [];
  for (let cyl = 0; cyl < n; cyl++) {
    const buf = new Float64Array(M);
    for (const e of events) if (e.cyl === cyl) put(buf, e.t, spec.cylGain[cyl] * e.s * e.s * Math.max(0.2, 1 + spec.knockVary * rand.gauss()));
    const tr = tract({ res: bl.res }, 1 + bl.spread * (2 * ((cyl * 0.618034 + 0.3) % 1) - 1)); // (spread over the cylinders, in no order)
    knocks.push([buf, (f) => cmul(tr(f), lp1(f, bl.src))]);
  }
  add(knocks, w.block);

  // valves: four ticks to a firing (two valves opening, two closing), and the steady whirr of the belt and what it turns
  const va = spec.valves;
  const ticks = new Float64Array(M);
  for (const e of events) for (const at of [0.12, 0.41, 0.63, 0.88]) put(ticks, e.t + (at + 0.01 * rand.gauss()) * Ta, rand.range(0.5, 1) * (rand.next() < 0.5 ? -1 : 1));
  const valves = filtered(ticks, rate, tract({ res: va.res }));
  const whirr = noiseLoop(M, rand, (f) => bump(f, va.whirr[0], va.whirr[1]), rate);
  const vr = rms(valves);
  for (let i = 0; i < M; i++) valves[i] = valves[i] / vr + 0.45 * whirr[i];
  add([[valves, null]], w.valves);

  // flow: hiss that swells after each firing and falls away before the next
  const fl = spec.flow;
  const tau = Math.max(0.0015, Math.min(0.009, (0.3 * T0) / rate));
  const puffs = new Float64Array(M);
  for (const e of events) put(puffs, arrives(e), e.crowd * e.s);
  const swell = filtered(puffs, rate, (f) => lp1(f, 1 / (2 * Math.PI * tau)));
  let mean = 0;
  for (let i = 0; i < M; i++) mean += Math.max(0, swell[i]) / M;
  const hiss = noiseLoop(M, rand, () => 1, rate);
  for (let i = 0; i < M; i++) hiss[i] *= Math.max(0, swell[i]) + 0.2 * mean;
  add([[hiss, (f) => bump(f, fl.centre, fl.width)]], w.flow);

  // fan: a steady roar
  if (spec.fan) add([[noiseLoop(M, rand, (f) => bump(f, spec.fan.centre, spec.fan.width), rate), null]], w.fan);

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
    add([[bangs, exH(800)]], w.crackle * 0.8);
    const env = filtered(bursts, rate, (f) => lp1(f, 1 / (2 * Math.PI * 0.004)));
    const spit = noiseLoop(M, rand, () => 1, rate);
    for (let i = 0; i < M; i++) spit[i] *= Math.max(0, env[i]);
    add([[spit, (f) => bump(f, 800, 1.1)]], w.crackle * 0.45);
  }

  // the peaks rounded (at the high rate, so that what the rounding adds can be removed), then what the body keeps out (`tone`: a
  // gain, no delay), nothing under 20 Hz or over 17 kHz, and the rate halved by keeping the lower half of the spectrum
  const y = signal(total);
  const r = rms(y), LIMIT = 2.6;
  for (let i = 0; i < M; i++) y[i] = LIMIT * Math.tanh(y[i] / r / LIMIT);
  const s = spectrum(y);
  const out = { re: new Float64Array(N), im: new Float64Array(N) };
  for (let k = 1; k < N / 2; k++) {
    const f = (k * RATE) / N;
    if (f > 17000) break;
    const h = hp2(f, 20), fade = f > 15000 ? 0.5 + 0.5 * Math.cos((Math.PI * (f - 15000)) / 2000) : 1;
    const g = fade * (0.2 + 0.8 / (1 + (f / spec.tone) ** 2));
    out.re[k] = (s.re[k] * h[0] - s.im[k] * h[1]) * g; out.im[k] = (s.re[k] * h[1] + s.im[k] * h[0]) * g;
    out.re[N - k] = out.re[k]; out.im[N - k] = -out.im[k];
  }
  return level(signal(out), 0.2);
}

function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf("--only");
  const only = at >= 0 ? args.splice(at, 2)[1].split(",") : null;
  const project = path.resolve(args[0] ?? path.join(ROOT, "examples/pine-ridge-rally"));
  const dir = path.join(project, "sounds");
  const made = new Set();
  let seed = 11, bytes = 0;
  for (const [id, spec] of Object.entries(ENGINES)) {
    spec.cycles.forEach((cycles, j) => {
      seed += 1;
      for (const layer of ["on", "off"]) {
        const name = layer === "on" ? `eng_${id}_${j + 1}.wav` : `eng_${id}_off_${j + 1}.wav`;
        made.add(name);
        if (only && !only.includes(id)) continue;
        writeWav(path.join(dir, name), engineLoop(spec, cycles, layer, seed));
      }
    });
    console.log(id.padEnd(12), spec.cycles.map((c) => Math.round(bandRpm(c))).join(" "), "rpm");
  }
  // only these engines: the loops of any other (cars that have left the game, bands that have moved) are taken away
  for (const f of fs.readdirSync(dir)) {
    if (!/^eng_.*\.wav$/.test(f)) continue;
    if (!made.has(f)) { fs.unlinkSync(path.join(dir, f)); console.log("removed", f); } else bytes += fs.statSync(path.join(dir, f)).size;
  }
  console.log(`${made.size} loops, ${(bytes / 1e6).toFixed(2)} MB`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
