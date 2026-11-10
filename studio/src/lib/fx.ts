// Effects on a track: EQ, compressor, chorus, flanger, phaser, distortion, bit crusher and gate. A track has a chain of them, run in order on the
// track's stereo signal after its volume and pan. Pure and deterministic (no random noise), so an export is the same every time.

export type FxType = "eq" | "parametric" | "compressor" | "chorus" | "flanger" | "phaser" | "distortion" | "bitcrush" | "gate" | "stereo" | "transient" | "echo" | "reverb" | "pitch" | "multiband";

export interface Fx {
  type: FxType;
  /// false bypasses it (kept in the chain with its settings).
  on?: boolean;
  /// Settings by key; a missing one takes the default.
  params: Record<string, number>;
}

export interface ParamSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;
}

export const FX_SPECS: Record<FxType, { title: string; help: string; params: ParamSpec[] }> = {
  eq: {
    title: "EQ",
    help: "Turn the lows, the middle and the highs up or down",
    params: [
      { key: "low", label: "Lows", min: -12, max: 12, step: 0.5, default: 0, unit: "dB" },
      { key: "mid", label: "Middle", min: -12, max: 12, step: 0.5, default: 0, unit: "dB" },
      { key: "midFreq", label: "Middle at", min: 200, max: 5000, step: 50, default: 1000, unit: "Hz" },
      { key: "high", label: "Highs", min: -12, max: 12, step: 0.5, default: 0, unit: "dB" },
    ],
  },
  compressor: {
    title: "Compressor",
    help: "Evens out loud and quiet: sounds above the threshold are turned down",
    params: [
      { key: "threshold", label: "Threshold", min: -40, max: 0, step: 1, default: -18, unit: "dB" },
      { key: "ratio", label: "Ratio", min: 1, max: 20, step: 0.5, default: 4 },
      { key: "attack", label: "Attack", min: 1, max: 100, step: 1, default: 10, unit: "ms" },
      { key: "release", label: "Release", min: 20, max: 500, step: 10, default: 120, unit: "ms" },
      { key: "makeup", label: "Make-up", min: 0, max: 18, step: 0.5, default: 0, unit: "dB" },
    ],
  },
  chorus: {
    title: "Chorus",
    help: "Thickens the sound with a slightly detuned copy",
    params: [
      { key: "rate", label: "Rate", min: 0.1, max: 5, step: 0.05, default: 0.8, unit: "Hz" },
      { key: "depth", label: "Depth", min: 0, max: 8, step: 0.1, default: 3, unit: "ms" },
      { key: "mix", label: "Mix", min: 0, max: 1, step: 0.01, default: 0.5 },
    ],
  },
  flanger: {
    title: "Flanger",
    help: "A sweeping, jet-like comb",
    params: [
      { key: "rate", label: "Rate", min: 0.05, max: 2, step: 0.05, default: 0.3, unit: "Hz" },
      { key: "depth", label: "Depth", min: 0, max: 3, step: 0.05, default: 1.5, unit: "ms" },
      { key: "feedback", label: "Feedback", min: 0, max: 0.9, step: 0.01, default: 0.5 },
      { key: "mix", label: "Mix", min: 0, max: 1, step: 0.01, default: 0.5 },
    ],
  },
  phaser: {
    title: "Phaser",
    help: "A slow, swirling sweep",
    params: [
      { key: "rate", label: "Rate", min: 0.05, max: 4, step: 0.05, default: 0.5, unit: "Hz" },
      { key: "depth", label: "Depth", min: 0, max: 1, step: 0.01, default: 0.7 },
      { key: "feedback", label: "Feedback", min: 0, max: 0.9, step: 0.01, default: 0.4 },
      { key: "mix", label: "Mix", min: 0, max: 1, step: 0.01, default: 0.5 },
    ],
  },
  distortion: {
    title: "Distortion",
    help: "Crunch: pushes the sound into a soft clip",
    params: [
      { key: "drive", label: "Drive", min: 1, max: 30, step: 0.5, default: 6 },
      { key: "tone", label: "Tone", min: 500, max: 12000, step: 100, default: 6000, unit: "Hz" },
      { key: "mix", label: "Mix", min: 0, max: 1, step: 0.01, default: 1 },
    ],
  },
  multiband: {
    title: "Multiband compressor",
    help: "Splits the sound into lows, mids and highs and squashes each on its own, so a loud bass does not pump the rest",
    params: [
      { key: "split1", label: "Lows end at", min: 60, max: 800, step: 10, default: 200, unit: "Hz" },
      { key: "split2", label: "Highs start at", min: 1000, max: 8000, step: 100, default: 2500, unit: "Hz" },
      { key: "lowThreshold", label: "Lows threshold", min: -60, max: 0, step: 1, default: -20, unit: "dB" },
      { key: "lowRatio", label: "Lows ratio", min: 1, max: 20, step: 0.5, default: 3 },
      { key: "midThreshold", label: "Mids threshold", min: -60, max: 0, step: 1, default: -20, unit: "dB" },
      { key: "midRatio", label: "Mids ratio", min: 1, max: 20, step: 0.5, default: 2 },
      { key: "highThreshold", label: "Highs threshold", min: -60, max: 0, step: 1, default: -20, unit: "dB" },
      { key: "highRatio", label: "Highs ratio", min: 1, max: 20, step: 0.5, default: 2 },
      { key: "attack", label: "Attack", min: 1, max: 100, step: 1, default: 10, unit: "ms" },
      { key: "release", label: "Release", min: 20, max: 1000, step: 10, default: 150, unit: "ms" },
    ],
  },
  parametric: {
    title: "Parametric EQ",
    help: "Three bands you place yourself: pick a pitch, boost or cut it, and how wide the change is",
    params: [
      { key: "f1", label: "Band 1 at", min: 30, max: 1000, step: 10, default: 120, unit: "Hz" },
      { key: "g1", label: "Band 1", min: -15, max: 15, step: 0.5, default: 0, unit: "dB" },
      { key: "q1", label: "Band 1 width", min: 0.3, max: 8, step: 0.1, default: 1 },
      { key: "f2", label: "Band 2 at", min: 200, max: 6000, step: 50, default: 1000, unit: "Hz" },
      { key: "g2", label: "Band 2", min: -15, max: 15, step: 0.5, default: 0, unit: "dB" },
      { key: "q2", label: "Band 2 width", min: 0.3, max: 8, step: 0.1, default: 1 },
      { key: "f3", label: "Band 3 at", min: 1000, max: 16000, step: 100, default: 5000, unit: "Hz" },
      { key: "g3", label: "Band 3", min: -15, max: 15, step: 0.5, default: 0, unit: "dB" },
      { key: "q3", label: "Band 3 width", min: 0.3, max: 8, step: 0.1, default: 1 },
    ],
  },
  stereo: {
    title: "Stereo width",
    help: "Narrow the sound towards the middle (0) or spread it wide (up to 2); the lows can be kept in the middle",
    params: [
      { key: "width", label: "Width", min: 0, max: 2, step: 0.05, default: 1.3 },
      { key: "monoBelow", label: "Keep lows central below", min: 0, max: 400, step: 10, default: 0, unit: "Hz" },
    ],
  },
  transient: {
    title: "Transient shaper",
    help: "Make the start of each sound punchier or softer, and what rings after it longer or shorter",
    params: [
      { key: "attack", label: "Punch", min: -1, max: 1, step: 0.05, default: 0.4 },
      { key: "sustain", label: "Ring", min: -1, max: 1, step: 0.05, default: 0 },
    ],
  },
  echo: {
    title: "Echo",
    help: "Repeats of the sound, each quieter; ping-pong bounces them from side to side",
    params: [
      { key: "time", label: "Gap", min: 20, max: 1000, step: 10, default: 300, unit: "ms" },
      { key: "feedback", label: "Repeats", min: 0, max: 0.9, step: 0.05, default: 0.4 },
      { key: "pingpong", label: "Ping-pong", min: 0, max: 1, step: 1, default: 0 },
      { key: "mix", label: "Mix", min: 0, max: 1, step: 0.01, default: 0.35 },
    ],
  },
  reverb: {
    title: "Reverb",
    help: "A room's ring; bigger rooms ring longer, a damped room is duller",
    params: [
      { key: "size", label: "Room size", min: 0, max: 1, step: 0.05, default: 0.5 },
      { key: "damping", label: "Damping", min: 0, max: 1, step: 0.05, default: 0.4 },
      { key: "mix", label: "Mix", min: 0, max: 1, step: 0.01, default: 0.25 },
    ],
  },
  pitch: {
    title: "Pitch shifter",
    help: "Move the pitch up or down by semitones, keeping the speed (a little graininess is normal)",
    params: [
      { key: "semitones", label: "Semitones", min: -12, max: 12, step: 1, default: 7 },
      { key: "mix", label: "Mix", min: 0, max: 1, step: 0.01, default: 0.5 },
    ],
  },
  bitcrush: {
    title: "Bit crusher",
    help: "Old-console grit: fewer bits and a lower sample rate",
    params: [
      { key: "bits", label: "Bits", min: 3, max: 16, step: 1, default: 8 },
      { key: "downsample", label: "Rate divide", min: 1, max: 32, step: 1, default: 4 },
      { key: "mix", label: "Mix", min: 0, max: 1, step: 0.01, default: 1 },
    ],
  },
  gate: {
    title: "Gate",
    help: "Silences the track while it is quieter than the threshold",
    params: [
      { key: "threshold", label: "Threshold", min: -60, max: -6, step: 1, default: -40, unit: "dB" },
      { key: "attack", label: "Attack", min: 1, max: 50, step: 1, default: 3, unit: "ms" },
      { key: "release", label: "Release", min: 10, max: 400, step: 10, default: 80, unit: "ms" },
    ],
  },
};

export const FX_TYPES = Object.keys(FX_SPECS) as FxType[];
export const MAX_FX = 6;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/// A setting's value, clamped to its range, or its default.
export function param(fx: Fx, key: string): number {
  const spec = FX_SPECS[fx.type].params.find((p) => p.key === key);
  if (!spec) return 0;
  const v = fx.params[key];
  return typeof v === "number" && Number.isFinite(v) ? clamp(v, spec.min, spec.max) : spec.default;
}

export const newFx = (type: FxType): Fx => ({ type, params: Object.fromEntries(FX_SPECS[type].params.map((p) => [p.key, p.default])) });

// ---- filters ---------------------------------------------------------------------------------------

type Coeffs = { b0: number; b1: number; b2: number; a1: number; a2: number };

/// RBJ cookbook biquads.
function biquad(kind: "lowshelf" | "highshelf" | "peaking" | "lowpass" | "highpass", f0: number, gainDb: number, q: number, rate: number): Coeffs {
  const A = 10 ** (gainDb / 40);
  const w = (2 * Math.PI * clamp(f0, 20, rate * 0.45)) / rate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  if (kind === "peaking") {
    b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A;
    a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
  } else if (kind === "highpass") {
    b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2;
    a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
  } else if (kind === "lowpass") {
    b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2;
    a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
  } else {
    const sq = 2 * Math.sqrt(A) * alpha;
    if (kind === "lowshelf") {
      b0 = A * (A + 1 - (A - 1) * cos + sq); b1 = 2 * A * (A - 1 - (A + 1) * cos); b2 = A * (A + 1 - (A - 1) * cos - sq);
      a0 = A + 1 + (A - 1) * cos + sq; a1 = -2 * (A - 1 + (A + 1) * cos); a2 = A + 1 + (A - 1) * cos - sq;
    } else {
      b0 = A * (A + 1 + (A - 1) * cos + sq); b1 = -2 * A * (A - 1 + (A + 1) * cos); b2 = A * (A + 1 + (A - 1) * cos - sq);
      a0 = A + 1 - (A - 1) * cos + sq; a1 = 2 * (A - 1 - (A + 1) * cos); a2 = A + 1 - (A - 1) * cos - sq;
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function runBiquad(x: Float32Array, c: Coeffs): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = c.b0 * x[i]! + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    y[i] = v;
    x2 = x1; x1 = x[i]!; y2 = y1; y1 = v;
  }
  return y;
}

type Stereo = [Float32Array, Float32Array];
const both = (s: Stereo, f: (x: Float32Array) => Float32Array): Stereo => [f(s[0]), f(s[1])];
const mixDryWet = (dry: Float32Array, wet: Float32Array, mix: number) => {
  const out = new Float32Array(dry.length);
  for (let i = 0; i < out.length; i++) out[i] = dry[i]! * (1 - mix) + wet[i]! * mix;
  return out;
};

// ---- the effects -------------------------------------------------------------------------------------

function eq(s: Stereo, fx: Fx, rate: number): Stereo {
  const chain = [
    param(fx, "low") !== 0 ? biquad("lowshelf", 200, param(fx, "low"), 0.707, rate) : null,
    param(fx, "mid") !== 0 ? biquad("peaking", param(fx, "midFreq"), param(fx, "mid"), 1, rate) : null,
    param(fx, "high") !== 0 ? biquad("highshelf", 4000, param(fx, "high"), 0.707, rate) : null,
  ].filter((c): c is Coeffs => !!c);
  return both(s, (x) => chain.reduce((y, c) => runBiquad(y, c), x));
}

/// Three bands split with Linkwitz-Riley crossovers (two Butterworth filters in a row: the bands add back up to a flat response, only shifted in phase), each compressed on its own.
function multiband(s: Stereo, fx: Fx, rate: number): Stereo {
  const lo1 = biquad("lowpass", param(fx, "split1"), 0, 0.707, rate);
  const hi1 = biquad("highpass", param(fx, "split1"), 0, 0.707, rate);
  const lo2 = biquad("lowpass", param(fx, "split2"), 0, 0.707, rate);
  const hi2 = biquad("highpass", param(fx, "split2"), 0, 0.707, rate);
  const twice = (x: Stereo, c: Coeffs): Stereo => both(x, (v) => runBiquad(runBiquad(v, c), c));
  const squash = (x: Stereo, band: "low" | "mid" | "high"): Stereo =>
    compressor(x, { type: "compressor", params: { threshold: param(fx, `${band}Threshold`), ratio: param(fx, `${band}Ratio`), attack: param(fx, "attack"), release: param(fx, "release"), makeup: 0 } }, rate);
  const low = twice(s, lo1);
  const rest = twice(s, hi1);
  const mid = twice(rest, lo2);
  const high = twice(rest, hi2);
  const [l, m, h] = [squash(low, "low"), squash(mid, "mid"), squash(high, "high")];
  const out = (c: 0 | 1) => l[c].map((v, i) => v + m[c][i]! + h[c][i]!);
  return [out(0), out(1)];
}

function parametric(s: Stereo, fx: Fx, rate: number): Stereo {
  const chain = [1, 2, 3]
    .map((i) => (param(fx, `g${i}`) !== 0 ? biquad("peaking", param(fx, `f${i}`), param(fx, `g${i}`), param(fx, `q${i}`), rate) : null))
    .filter((c): c is Coeffs => !!c);
  return both(s, (x) => chain.reduce((y, c) => runBiquad(y, c), x));
}

/// Mid/side width: the sides are scaled by `width`; below `monoBelow` Hz the sides are removed (a one-pole low-pass picks the lows out).
function stereoWidth(s: Stereo, fx: Fx, rate: number): Stereo {
  const width = param(fx, "width");
  const below = param(fx, "monoBelow");
  const n = s[0].length;
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  const a = below > 0 ? 1 - Math.exp((-2 * Math.PI * below) / rate) : 1;
  let lowSide = 0;
  for (let i = 0; i < n; i++) {
    const mid = (s[0][i]! + s[1][i]!) / 2;
    let side = (s[0][i]! - s[1][i]!) / 2;
    if (below > 0) {
      lowSide += a * (side - lowSide);
      side = (side - lowSide) * width; // only what is above the cut-off is widened; the lows of the side signal are dropped
    } else side *= width;
    l[i] = mid + side;
    r[i] = mid - side;
  }
  return [l, r];
}

/// Punch and ring: a fast and a slow follower of the level; where the fast one is ahead (an attack) the gain follows `attack`, where it is behind (the tail) `sustain`.
function transient(s: Stereo, fx: Fx, rate: number): Stereo {
  const attack = param(fx, "attack");
  const sustain = param(fx, "sustain");
  const fast = Math.exp(-1 / (0.002 * rate));
  const slow = Math.exp(-1 / (0.06 * rate));
  const n = s[0].length;
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  let f = 0;
  let sl = 0;
  for (let i = 0; i < n; i++) {
    const level = Math.max(Math.abs(s[0][i]!), Math.abs(s[1][i]!));
    // the fast follower rises at once and falls at its own rate; the slow one rises slowly: the difference is the "attack"
    f = level > f ? level : level + (f - level) * fast;
    sl = level > sl ? sl + (level - sl) * (1 - slow) * 3 : level + (sl - level) * slow;
    const ratio = f / (sl + 1e-6);
    const g = ratio > 1 ? 1 + attack * Math.min(1, ratio - 1) * 2 : 1 + sustain * Math.min(1, 1 - ratio);
    const gain = clamp(g, 0.1, 3);
    l[i] = s[0][i]! * gain;
    r[i] = s[1][i]! * gain;
  }
  return [l, r];
}

function echo(s: Stereo, fx: Fx, rate: number): Stereo {
  const d = Math.max(1, Math.round((param(fx, "time") / 1000) * rate));
  const fb = param(fx, "feedback");
  const mix = param(fx, "mix");
  const pingpong = param(fx, "pingpong") >= 1;
  const n = s[0].length;
  const tail = Math.min(n, Math.ceil(Math.log(0.001) / Math.log(Math.max(0.05, fb))) * d);
  const outL = new Float32Array(n + tail);
  const outR = new Float32Array(n + tail);
  for (let i = 0; i < n + tail; i++) {
    const inL = i < n ? s[0][i]! : 0;
    const inR = i < n ? s[1][i]! : 0;
    const eL = i >= d ? outL[i - d]! : 0;
    const eR = i >= d ? outR[i - d]! : 0;
    // ping-pong: each side's repeats come from the other side
    outL[i] = inL + (pingpong ? eR : eL) * fb;
    outR[i] = inR + (pingpong ? eL : eR) * fb;
  }
  // the dry sound and the repeats (what is not the dry sound), cut back to the length of the input: the tail past the end is dropped
  const mk = (x: Float32Array, dry: Float32Array) => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = dry[i]! + (x[i]! - dry[i]!) * mix;
    return out;
  };
  return [mk(outL, s[0]), mk(outR, s[1])];
}

/// A Schroeder reverb: four comb filters and two all-passes a side (the right side slightly longer, for width).
function reverbFx(s: Stereo, fx: Fx, rate: number): Stereo {
  const size = param(fx, "size");
  const damp = param(fx, "damping");
  const mix = param(fx, "mix");
  const feedback = 0.6 + size * 0.35;
  const run = (x: Float32Array, spread: number) => {
    const n = x.length;
    const out = new Float32Array(n);
    const scale = rate / 44100;
    const combs = [1116, 1188, 1277, 1356].map((len) => ({ buf: new Float32Array(Math.max(1, Math.round((len + spread) * scale * (0.6 + size * 0.8)))), pos: 0, store: 0 }));
    const aps = [556, 441].map((len) => ({ buf: new Float32Array(Math.max(1, Math.round((len + spread) * scale))), pos: 0 }));
    for (let i = 0; i < n; i++) {
      let y = 0;
      for (const c of combs) {
        const v = c.buf[c.pos]!;
        c.store = v * (1 - damp) + c.store * damp;
        c.buf[c.pos] = x[i]! * 0.25 + c.store * feedback;
        if (++c.pos >= c.buf.length) c.pos = 0;
        y += v;
      }
      for (const a of aps) {
        const v = a.buf[a.pos]!;
        a.buf[a.pos] = y + v * 0.5;
        y = v - y;
        if (++a.pos >= a.buf.length) a.pos = 0;
      }
      out[i] = y;
    }
    return out;
  };
  const wetL = run(s[0], 0);
  const wetR = run(s[1], 23);
  const mk = (dry: Float32Array, wet: Float32Array) => {
    const out = new Float32Array(dry.length);
    for (let i = 0; i < out.length; i++) out[i] = dry[i]! + wet[i]! * mix * 3;
    return out;
  };
  return [mk(s[0], wetL), mk(s[1], wetR)];
}

/// Pitch shift by two read pointers moving through a delay line at the new rate, each fading in and out over a window (so the jump back is not heard).
function pitchShift(s: Stereo, fx: Fx, rate: number): Stereo {
  const ratio = 2 ** (param(fx, "semitones") / 12);
  const mix = param(fx, "mix");
  const win = Math.max(64, Math.round(0.05 * rate));
  const shift = (x: Float32Array) => {
    const n = x.length;
    const out = new Float32Array(n);
    // two taps half a window apart; each tap's delay sweeps from the window down to 0 (up-shift) or 0 up to the window (down-shift) and wraps
    for (let i = 0; i < n; i++) {
      let y = 0;
      for (let k = 0; k < 2; k++) {
        const phase = (((i * (1 - ratio)) / win + k / 2) % 1 + 1) % 1; // 0 to 1, repeating
        const delay = phase * win;
        const at = i - delay;
        const fade = Math.sin(Math.PI * phase) ** 2; // 0 at the jump, 1 half way
        if (at < 0) continue;
        const i0 = Math.floor(at);
        const f = at - i0;
        y += (x[i0]! * (1 - f) + (x[Math.min(n - 1, i0 + 1)] ?? 0) * f) * fade;
      }
      out[i] = y;
    }
    return out;
  };
  return [mixDryWet(s[0], shift(s[0]), mix), mixDryWet(s[1], shift(s[1]), mix)];
}

function compressor(s: Stereo, fx: Fx, rate: number): Stereo {
  const threshold = param(fx, "threshold");
  const ratio = param(fx, "ratio");
  const makeup = 10 ** (param(fx, "makeup") / 20);
  const atk = Math.exp(-1 / (Math.max(0.001, param(fx, "attack") / 1000) * rate));
  const rel = Math.exp(-1 / (Math.max(0.001, param(fx, "release") / 1000) * rate));
  const n = s[0].length;
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  let env = 0;
  for (let i = 0; i < n; i++) {
    const level = Math.max(Math.abs(s[0][i]!), Math.abs(s[1][i]!));
    env = level > env ? level + (env - level) * atk : level + (env - level) * rel;
    const db = env > 1e-6 ? 20 * Math.log10(env) : -120;
    const over = db - threshold;
    const reduction = over > 0 ? over - over / ratio : 0;
    const g = 10 ** (-reduction / 20) * makeup;
    l[i] = s[0][i]! * g;
    r[i] = s[1][i]! * g;
  }
  return [l, r];
}

/// A delay line with a moving read point (linear interpolation), for chorus and flanger. `feedback` feeds the output back into the line.
function modDelay(x: Float32Array, rate: number, baseMs: number, depthMs: number, hz: number, phase: number, feedback: number): Float32Array {
  const n = x.length;
  const size = Math.ceil(((baseMs + depthMs) / 1000) * rate) + 4;
  const line = new Float32Array(size);
  const out = new Float32Array(n);
  let w = 0;
  for (let i = 0; i < n; i++) {
    const lfo = 0.5 + 0.5 * Math.sin(2 * Math.PI * (hz * i / rate + phase));
    const delay = ((baseMs + depthMs * lfo) / 1000) * rate;
    let pos = w - delay;
    while (pos < 0) pos += size;
    const i0 = Math.floor(pos) % size;
    const frac = pos - Math.floor(pos);
    const y = line[i0]! * (1 - frac) + line[(i0 + 1) % size]! * frac;
    out[i] = y;
    line[w] = x[i]! + y * feedback;
    w = (w + 1) % size;
  }
  return out;
}

function chorus(s: Stereo, fx: Fx, rate: number): Stereo {
  const hz = param(fx, "rate");
  const depth = param(fx, "depth");
  const mix = param(fx, "mix");
  return [mixDryWet(s[0], modDelay(s[0], rate, 12, depth, hz, 0, 0), mix), mixDryWet(s[1], modDelay(s[1], rate, 12, depth, hz, 0.25, 0), mix)];
}

function flanger(s: Stereo, fx: Fx, rate: number): Stereo {
  const hz = param(fx, "rate");
  const depth = param(fx, "depth");
  const fb = param(fx, "feedback");
  const mix = param(fx, "mix");
  return [mixDryWet(s[0], modDelay(s[0], rate, 0.5, depth, hz, 0, fb), mix), mixDryWet(s[1], modDelay(s[1], rate, 0.5, depth, hz, 0.25, fb), mix)];
}

function phaser(s: Stereo, fx: Fx, rate: number): Stereo {
  const hz = param(fx, "rate");
  const depth = param(fx, "depth");
  const fb = param(fx, "feedback");
  const mix = param(fx, "mix");
  const run = (x: Float32Array, phase: number) => {
    const n = x.length;
    const out = new Float32Array(n);
    const z = [0, 0, 0, 0];
    let last = 0;
    for (let i = 0; i < n; i++) {
      const lfo = 0.5 + 0.5 * Math.sin(2 * Math.PI * (hz * i / rate + phase));
      const f = 300 * 2 ** (lfo * depth * 4); // sweeps 300 Hz upwards by up to four octaves
      const t = Math.tan((Math.PI * clamp(f, 50, rate * 0.4)) / rate);
      const a = (t - 1) / (t + 1);
      let v = x[i]! + last * fb;
      for (let k = 0; k < 4; k++) {
        const y = a * v + z[k]!;
        z[k] = v - a * y;
        v = y;
      }
      last = v;
      out[i] = x[i]! + v;
    }
    return mixDryWet(x, out.map((v) => v * 0.5), mix);
  };
  return [run(s[0], 0), run(s[1], 0.25)];
}

function distortion(s: Stereo, fx: Fx, rate: number): Stereo {
  const drive = param(fx, "drive");
  const mix = param(fx, "mix");
  const lp = biquad("lowpass", param(fx, "tone"), 0, 0.707, rate);
  const norm = 1 / Math.tanh(drive);
  return both(s, (x) => {
    const wet = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) wet[i] = Math.tanh(x[i]! * drive) * norm * 0.8;
    return mixDryWet(x, runBiquad(wet, lp), mix);
  });
}

function bitcrush(s: Stereo, fx: Fx): Stereo {
  const levels = 2 ** (Math.round(param(fx, "bits")) - 1) - 1; // (3 bits: -3 to 3, seven levels)
  const hold = Math.max(1, Math.round(param(fx, "downsample")));
  const mix = param(fx, "mix");
  return both(s, (x) => {
    const wet = new Float32Array(x.length);
    let held = 0;
    for (let i = 0; i < x.length; i++) {
      if (i % hold === 0) held = Math.round(clamp(x[i]!, -1, 1) * levels) / levels;
      wet[i] = held;
    }
    return mixDryWet(x, wet, mix);
  });
}

function gate(s: Stereo, fx: Fx, rate: number): Stereo {
  const threshold = 10 ** (param(fx, "threshold") / 20);
  const open = Math.exp(-1 / (Math.max(0.0005, param(fx, "attack") / 1000) * rate));
  const close = Math.exp(-1 / (Math.max(0.001, param(fx, "release") / 1000) * rate));
  const n = s[0].length;
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  let env = 0;
  let g = 0;
  for (let i = 0; i < n; i++) {
    const level = Math.max(Math.abs(s[0][i]!), Math.abs(s[1][i]!));
    env = level > env ? level : env * close; // a peak follower that lets go over the release
    const target = env > threshold ? 1 : 0;
    g = target > g ? target + (g - target) * open : target + (g - target) * close;
    l[i] = s[0][i]! * g;
    r[i] = s[1][i]! * g;
  }
  return [l, r];
}

/// Runs a chain of effects on a stereo signal (a bypassed one is skipped). Returns new arrays; the inputs are not changed.
export function applyFx(chain: Fx[], left: Float32Array, right: Float32Array, rate: number): Stereo {
  let s: Stereo = [left, right];
  for (const fx of chain) {
    if (fx.on === false) continue;
    switch (fx.type) {
      case "eq": s = eq(s, fx, rate); break;
      case "parametric": s = parametric(s, fx, rate); break;
      case "multiband": s = multiband(s, fx, rate); break;
      case "stereo": s = stereoWidth(s, fx, rate); break;
      case "transient": s = transient(s, fx, rate); break;
      case "echo": s = echo(s, fx, rate); break;
      case "reverb": s = reverbFx(s, fx, rate); break;
      case "pitch": s = pitchShift(s, fx, rate); break;
      case "compressor": s = compressor(s, fx, rate); break;
      case "chorus": s = chorus(s, fx, rate); break;
      case "flanger": s = flanger(s, fx, rate); break;
      case "phaser": s = phaser(s, fx, rate); break;
      case "distortion": s = distortion(s, fx, rate); break;
      case "bitcrush": s = bitcrush(s, fx); break;
      case "gate": s = gate(s, fx, rate); break;
    }
  }
  return s;
}

// ---- editing a chain (each returns a new list) ------------------------------------------------------------

export function addFx(chain: Fx[], type: FxType): Fx[] {
  return chain.length >= MAX_FX || !FX_SPECS[type] ? chain : [...chain, newFx(type)];
}
export const removeFx = (chain: Fx[], index: number): Fx[] => chain.filter((_, i) => i !== index);
export function moveFx(chain: Fx[], index: number, by: number): Fx[] {
  const to = index + by;
  if (to < 0 || to >= chain.length || index < 0 || index >= chain.length) return chain;
  const out = [...chain];
  [out[index], out[to]] = [out[to]!, out[index]!];
  return out;
}
export const setFxParam = (chain: Fx[], index: number, key: string, value: number): Fx[] => chain.map((f, i) => (i === index ? { ...f, params: { ...f.params, [key]: value } } : f));
export const toggleFx = (chain: Fx[], index: number): Fx[] => chain.map((f, i) => (i === index ? { ...f, on: f.on === false ? true : false } : f));

/// Checks a chain read from a file: known types, up to MAX_FX, numbers clamped to their ranges. Returns the cleaned chain or what is wrong.
export function cleanFx(raw: unknown): { ok: true; chain: Fx[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "fx is a list of effects" };
  if (raw.length > MAX_FX) return { ok: false, error: `at most ${MAX_FX} effects on a track` };
  const chain: Fx[] = [];
  for (const [i, f] of raw.entries()) {
    const type = (f as Fx | undefined)?.type;
    if (!type || !(type in FX_SPECS)) return { ok: false, error: `fx[${i}].type must be one of ${FX_TYPES.join(", ")}` };
    const params: Record<string, number> = {};
    for (const spec of FX_SPECS[type].params) {
      const v = (f as Fx).params?.[spec.key];
      if (v === undefined) continue;
      if (typeof v !== "number" || !Number.isFinite(v)) return { ok: false, error: `fx[${i}].params.${spec.key} must be a number` };
      params[spec.key] = clamp(v, spec.min, spec.max);
    }
    chain.push({ type, ...((f as Fx).on === false ? { on: false } : {}), params });
  }
  return { ok: true, chain };
}
