// A small procedural sound-effect synthesiser in the spirit of sfxr/jfxr. Pure and deterministic:
// the same parameters and seed always give the same samples.

import type { Sound } from "./wav";

export type Wave = "square" | "saw" | "sine" | "triangle" | "noise";
export const WAVES: Wave[] = ["square", "saw", "sine", "triangle", "noise"];
export const SAMPLE_RATE = 44100;

export interface SfxParams {
  wave: Wave;
  /// Starting pitch in Hz.
  freq: number;
  /// Stops early when the pitch falls below this (Hz). 0 turns it off.
  freqLimit: number;
  /// Pitch change in octaves per second, and how that change itself changes.
  slide: number;
  slideDelta: number;
  /// Square wave width (0.05 to 0.95) and how it moves per second.
  duty: number;
  dutySweep: number;
  vibratoDepth: number;
  vibratoSpeed: number;
  /// Jump by this many semitones after `arpTime` seconds.
  arpSemitones: number;
  arpTime: number;
  attack: number;
  sustain: number;
  decay: number;
  /// Extra loudness at the start of the sustain that fades away (0 to 1).
  punch: number;
  /// Filters in Hz; lowpass 20000 and highpass 0 mean off.
  lowpass: number;
  highpass: number;
  volume: number;
  seed: number;
}

export const DEFAULTS: SfxParams = {
  wave: "square", freq: 440, freqLimit: 0, slide: 0, slideDelta: 0, duty: 0.5, dutySweep: 0, vibratoDepth: 0, vibratoSpeed: 8,
  arpSemitones: 0, arpTime: 0.1, attack: 0.005, sustain: 0.15, decay: 0.2, punch: 0, lowpass: 20000, highpass: 0, volume: 0.6, seed: 1,
};

/// Slider ranges, so the editor and the randomiser agree on what is sensible.
export const RANGES: Record<Exclude<keyof SfxParams, "wave" | "seed">, { min: number; max: number; step: number; label: string; unit?: string }> = {
  freq: { min: 40, max: 3000, step: 1, label: "Pitch", unit: "Hz" },
  freqLimit: { min: 0, max: 3000, step: 1, label: "Lowest pitch", unit: "Hz" },
  slide: { min: -4, max: 4, step: 0.05, label: "Slide", unit: "oct/s" },
  slideDelta: { min: -8, max: 8, step: 0.1, label: "Slide change" },
  duty: { min: 0.05, max: 0.95, step: 0.01, label: "Square width" },
  dutySweep: { min: -1, max: 1, step: 0.02, label: "Width sweep" },
  vibratoDepth: { min: 0, max: 1, step: 0.01, label: "Vibrato" },
  vibratoSpeed: { min: 1, max: 30, step: 0.5, label: "Vibrato speed", unit: "Hz" },
  arpSemitones: { min: -24, max: 24, step: 1, label: "Pitch jump", unit: "semitones" },
  arpTime: { min: 0.01, max: 1, step: 0.01, label: "Jump after", unit: "s" },
  attack: { min: 0, max: 0.5, step: 0.001, label: "Attack", unit: "s" },
  sustain: { min: 0, max: 1, step: 0.005, label: "Sustain", unit: "s" },
  decay: { min: 0, max: 1.5, step: 0.005, label: "Decay", unit: "s" },
  punch: { min: 0, max: 1, step: 0.01, label: "Punch" },
  lowpass: { min: 100, max: 20000, step: 10, label: "Lowpass", unit: "Hz" },
  highpass: { min: 0, max: 5000, step: 10, label: "Highpass", unit: "Hz" },
  volume: { min: 0, max: 1, step: 0.01, label: "Volume" },
};

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const MAX_SECONDS = 4;

export function render(params: SfxParams, rate = SAMPLE_RATE): Sound {
  const p = params;
  const seconds = Math.min(MAX_SECONDS, p.attack + p.sustain + p.decay);
  const total = Math.max(1, Math.round(seconds * rate));
  const rng = mulberry32(p.seed);
  const out = new Float32Array(total);
  let phase = 0;
  let held = rng() * 2 - 1; // noise: a new value each cycle
  let lp = 0;
  let hpPrev = 0;
  let hpOut = 0;
  const lpCoef = Math.min(1, (2 * Math.PI * Math.min(p.lowpass, rate / 2)) / rate);
  const hpCoef = p.highpass > 0 ? Math.exp((-2 * Math.PI * p.highpass) / rate) : 0;
  let length = total;

  for (let i = 0; i < total; i++) {
    const t = i / rate;
    let octaves = p.slide * t + 0.5 * p.slideDelta * t * t;
    octaves = Math.max(-12, Math.min(12, octaves));
    let freq = p.freq * 2 ** octaves;
    if (p.arpSemitones !== 0 && t >= p.arpTime) freq *= 2 ** (p.arpSemitones / 12);
    if (p.vibratoDepth > 0) freq *= 1 + p.vibratoDepth * 0.5 * Math.sin(2 * Math.PI * p.vibratoSpeed * t);
    if (p.freqLimit > 0 && freq < p.freqLimit) {
      length = i;
      break;
    }
    freq = Math.max(1, Math.min(rate / 2, freq));
    phase += freq / rate;
    let cycle = phase % 1;
    if (phase >= 1) {
      if (p.wave === "noise" && Math.floor(phase) > Math.floor(phase - freq / rate)) held = rng() * 2 - 1;
      phase %= 1;
      cycle = phase;
    }
    const duty = Math.max(0.05, Math.min(0.95, p.duty + p.dutySweep * t));
    let x: number;
    switch (p.wave) {
      case "square": x = cycle < duty ? 1 : -1; break;
      case "saw": x = 2 * cycle - 1; break;
      case "sine": x = Math.sin(2 * Math.PI * cycle); break;
      case "triangle": x = cycle < 0.5 ? 4 * cycle - 1 : 3 - 4 * cycle; break;
      default: x = held;
    }
    // envelope
    let env: number;
    if (t < p.attack) env = p.attack > 0 ? t / p.attack : 1;
    else if (t < p.attack + p.sustain) env = 1 + p.punch * 2 * (1 - (t - p.attack) / Math.max(p.sustain, 1e-6));
    else env = p.decay > 0 ? Math.max(0, 1 - (t - p.attack - p.sustain) / p.decay) ** 2 : 0;
    // filters
    lp += lpCoef * (x - lp);
    let y = p.lowpass < 20000 ? lp : x;
    if (hpCoef > 0) {
      hpOut = hpCoef * (hpOut + y - hpPrev);
      hpPrev = y;
      y = hpOut;
    }
    out[i] = Math.max(-1, Math.min(1, y * env * p.volume));
  }
  return { rate, channels: [length === total ? out : out.slice(0, length)] };
}

const P = (over: Partial<SfxParams>): SfxParams => ({ ...DEFAULTS, ...over });

export const PRESETS: Record<string, SfxParams> = {
  coin: P({ wave: "square", freq: 988, arpSemitones: 5, arpTime: 0.07, attack: 0, sustain: 0.08, decay: 0.25, duty: 0.35, volume: 0.5 }),
  jump: P({ wave: "square", freq: 280, slide: 1.6, attack: 0, sustain: 0.08, decay: 0.18, duty: 0.4 }),
  laser: P({ wave: "saw", freq: 1400, slide: -2.8, freqLimit: 160, attack: 0, sustain: 0.1, decay: 0.15, volume: 0.45 }),
  explosion: P({ wave: "noise", freq: 90, slide: -0.6, attack: 0.002, sustain: 0.15, decay: 0.7, punch: 0.6, lowpass: 2500, volume: 0.8 }),
  hit: P({ wave: "noise", freq: 260, slide: -1.2, attack: 0, sustain: 0.02, decay: 0.12, punch: 0.5, lowpass: 6000 }),
  powerup: P({ wave: "square", freq: 330, slide: 1.2, vibratoDepth: 0.15, vibratoSpeed: 14, attack: 0, sustain: 0.25, decay: 0.2, duty: 0.3 }),
  blip: P({ wave: "square", freq: 700, attack: 0, sustain: 0.03, decay: 0.05, duty: 0.5, volume: 0.45 }),
  bounce: P({ wave: "sine", freq: 520, slide: -3, attack: 0, sustain: 0.02, decay: 0.2, punch: 0.3 }),
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/// A nudged copy: each setting moves a little (`amount` 0 to 1), the seed changes too so noise differs.
export function mutate(params: SfxParams, rng: () => number, amount = 0.25): SfxParams {
  const out = { ...params, seed: Math.floor(rng() * 1e9) };
  for (const key of Object.keys(RANGES) as (keyof typeof RANGES)[]) {
    if (key === "volume") continue;
    const r = RANGES[key];
    const jitter = (rng() * 2 - 1) * amount * (r.max - r.min) * 0.5;
    out[key] = clamp(Math.round((params[key] + jitter) / r.step) * r.step, r.min, r.max);
  }
  // keep the sound audible: a sustain+decay of nothing renders silence
  if (out.sustain + out.decay < 0.05) out.decay = 0.1;
  return out;
}

export function randomFrom(rng: () => number): SfxParams {
  const base = Object.values(PRESETS)[Math.floor(rng() * Object.keys(PRESETS).length)]!;
  return mutate({ ...base, wave: WAVES[Math.floor(rng() * WAVES.length)]! }, rng, 0.6);
}

export function toJson(params: SfxParams): string {
  return `${JSON.stringify({ version: 1, ...params }, null, 2)}\n`;
}

export function fromJson(text: string): SfxParams | null {
  try {
    const v = JSON.parse(text) as Record<string, unknown>;
    if (!v || typeof v !== "object") return null;
    const out: SfxParams = { ...DEFAULTS };
    if (WAVES.includes(v.wave as Wave)) out.wave = v.wave as Wave;
    if (typeof v.seed === "number") out.seed = v.seed;
    for (const key of Object.keys(RANGES) as (keyof typeof RANGES)[]) {
      const n = v[key];
      if (typeof n === "number" && Number.isFinite(n)) out[key] = clamp(n, RANGES[key].min, RANGES[key].max);
    }
    return out;
  } catch {
    return null;
  }
}
