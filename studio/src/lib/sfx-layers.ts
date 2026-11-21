// The fuller sound effect: several layers in one effect, and a finish over the whole (drive, a small room, stereo width).
// A layer is one source (a band-limited oscillator, FM, ring modulation, white/pink noise or crackle) with its own start time,
// envelope, pitch envelope and moving filter. This is what an effect from a modern action game is made of: a short bright
// click on top (the transient), a body with a pitch drop, filtered noise that sweeps, a sub thump under an impact, a touch of
// saturation and a short room. Pure and deterministic like the plain voice: the same settings always give the same samples.
//
// A file without `layers`, `drive`, `reverb` and `width` never comes here and renders exactly as before (lib/sfx.ts).

export type LayerWave = "sine" | "triangle" | "saw" | "square" | "noise" | "pink" | "crackle";
export const LAYER_WAVES: LayerWave[] = ["sine", "triangle", "saw", "square", "noise", "pink", "crackle"];
export type LayerFilter = "none" | "lowpass" | "highpass" | "bandpass";
export const LAYER_FILTERS: LayerFilter[] = ["none", "lowpass", "highpass", "bandpass"];

export interface SfxLayer {
  wave: LayerWave;
  /// Pitch in Hz where the pitch envelope settles (for `crackle`: crackles a second; unused by `noise` and `pink`).
  freq: number;
  /// Seconds after the effect starts that this layer starts.
  start: number;
  /// Envelope: a rise of `attack` seconds, full level for `hold` seconds, then a fall that reaches -60 dB after `decay` seconds (a natural, exponential fall).
  attack: number;
  hold: number;
  decay: number;
  volume: number;
  /// -1 left to 1 right.
  pan: number;
  /// Pitch envelope: the layer starts this many semitones away from `freq` (positive: above) and glides there, most of the way in `pitchTime` seconds.
  pitch: number;
  pitchTime: number;
  /// A steady bend after that, in octaves per second (negative falls).
  slide: number;
  vibrato: number;
  vibratoSpeed: number;
  /// Square wave width.
  duty: number;
  /// Oscillators (1 to 5) spread `detune` cents either way and across the stereo field by the effect's `width`.
  unison: number;
  detune: number;
  /// FM: a sine modulator at `fmRatio` times the pitch bends the phase by up to `fm` radians; it fades over `fmDecay` seconds (0: it does not fade).
  /// A ratio that is not a whole number (1.41, 2.76) gives the clangorous, inharmonic partials of metal and bells.
  fm: number;
  fmRatio: number;
  fmDecay: number;
  /// Ring modulation: the layer multiplied by a sine of this many Hz (0: off). Electric, metallic, robotic.
  ring: number;
  /// A filter that moves: `cutoff` Hz at the start to `cutoffEnd` Hz (an even glide in pitch) over `filterTime` seconds (0: the layer's whole length).
  filter: LayerFilter;
  cutoff: number;
  cutoffEnd: number;
  filterTime: number;
  /// Resonance: 0.5 is gentle, 0.7 neutral, up to 12 a whistling peak at the cutoff.
  q: number;
}

export const LAYER_DEFAULTS: Omit<SfxLayer, "wave"> = {
  freq: 220, start: 0, attack: 0.002, hold: 0.03, decay: 0.25, volume: 0.5, pan: 0, pitch: 0, pitchTime: 0.04, slide: 0, vibrato: 0, vibratoSpeed: 6,
  duty: 0.5, unison: 1, detune: 0, fm: 0, fmRatio: 1, fmDecay: 0, ring: 0, filter: "none", cutoff: 2000, cutoffEnd: 0, filterTime: 0, q: 0.7,
};

/// The number fields of a layer: their ranges and what they are, for the tools' help and checking.
export const LAYER_RANGES: Record<Exclude<keyof SfxLayer, "wave" | "filter">, { min: number; max: number; what: string }> = {
  freq: { min: 20, max: 12000, what: "pitch in Hz (crackle: crackles a second; noise and pink: unused)" },
  start: { min: 0, max: 3, what: "seconds after the effect starts" },
  attack: { min: 0, max: 2, what: "seconds to full level" },
  hold: { min: 0, max: 3, what: "seconds at full level" },
  decay: { min: 0.005, max: 4, what: "seconds to fall to -60 dB" },
  volume: { min: 0, max: 1, what: "level" },
  pan: { min: -1, max: 1, what: "-1 left to 1 right" },
  pitch: { min: -48, max: 48, what: "semitones from freq at the start, gliding to freq" },
  pitchTime: { min: 0.001, max: 2, what: "seconds for most of the pitch glide" },
  slide: { min: -8, max: 8, what: "octaves per second after that" },
  vibrato: { min: 0, max: 12, what: "semitones" },
  vibratoSpeed: { min: 0.5, max: 60, what: "Hz" },
  duty: { min: 0.05, max: 0.95, what: "square width" },
  unison: { min: 1, max: 5, what: "oscillators" },
  detune: { min: 0, max: 100, what: "cents either way" },
  fm: { min: 0, max: 30, what: "FM depth" },
  fmRatio: { min: 0.1, max: 16, what: "modulator pitch / pitch" },
  fmDecay: { min: 0, max: 4, what: "seconds for the FM to fade (0: steady)" },
  ring: { min: 0, max: 8000, what: "ring modulator Hz (0: off)" },
  cutoff: { min: 20, max: 20000, what: "filter Hz at the start" },
  cutoffEnd: { min: 0, max: 20000, what: "filter Hz at the end (0: same as cutoff)" },
  filterTime: { min: 0, max: 4, what: "seconds for the filter's move (0: the whole layer)" },
  q: { min: 0.5, max: 12, what: "resonance" },
};

export const LAYER_KEYS = ["wave", "filter", ...Object.keys(LAYER_RANGES)];
export const MAX_LAYERS = 8;

/// The effect-wide finish. All 0 (or missing): nothing is done.
export interface SfxFinish {
  /// Soft-clip saturation (0 to 1): denser, grittier, louder; the peaks round off instead of clipping.
  drive?: number;
  /// A short room (0 to 1: how much of it is heard) and its size (0 small and tight to 1 a hall).
  reverb?: number;
  room?: number;
  /// Stereo spread (0 to 1): unison oscillators fan out, noise layers become two independent noises, the room is wide.
  width?: number;
}

export const FINISH_RANGES: Record<keyof SfxFinish, { min: number; max: number; what: string }> = {
  drive: { min: 0, max: 1, what: "soft-clip saturation" },
  reverb: { min: 0, max: 1, what: "how much of a short room is heard" },
  room: { min: 0, max: 1, what: "the room's size (default 0.3)" },
  width: { min: 0, max: 1, what: "stereo spread" },
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/// A layer as given (a partial object) made whole and checked. Throws with what is wrong, naming the nearest key for a misspelt one.
export function cleanLayer(v: unknown, at = "layer"): SfxLayer {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${at} is an object like { "wave": "noise", "decay": 0.2 }`);
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!LAYER_KEYS.includes(k)) throw new Error(`${at} has "${k}", which a layer does not have${nearest(k, LAYER_KEYS)} (a layer has ${LAYER_KEYS.join(", ")})`);
  }
  if (!LAYER_WAVES.includes(o.wave as LayerWave)) throw new Error(`${at}.wave is one of ${LAYER_WAVES.join(", ")} (got ${JSON.stringify(o.wave)})`);
  const out: SfxLayer = { wave: o.wave as LayerWave, ...LAYER_DEFAULTS };
  if (o.filter !== undefined) {
    if (!LAYER_FILTERS.includes(o.filter as LayerFilter)) throw new Error(`${at}.filter is one of ${LAYER_FILTERS.join(", ")} (got ${JSON.stringify(o.filter)})`);
    out.filter = o.filter as LayerFilter;
  }
  for (const [k, r] of Object.entries(LAYER_RANGES) as [keyof typeof LAYER_RANGES, { min: number; max: number }][]) {
    const n = o[k];
    if (n === undefined) continue;
    if (typeof n !== "number" || !Number.isFinite(n)) throw new Error(`${at}.${k} is a number from ${r.min} to ${r.max}`);
    out[k] = clamp(n, r.min, r.max);
  }
  if (o.filter === undefined && (o.cutoff !== undefined || o.cutoffEnd !== undefined)) out.filter = "lowpass";
  out.unison = Math.round(out.unison);
  return out;
}

/// The keys of a layer that differ from the defaults (what a file keeps).
export function layerToJson(l: SfxLayer): Record<string, unknown> {
  const out: Record<string, unknown> = { wave: l.wave };
  for (const k of Object.keys(LAYER_DEFAULTS) as (keyof typeof LAYER_DEFAULTS)[]) {
    if (l[k] !== LAYER_DEFAULTS[k]) out[k] = l[k];
  }
  if (l.filter !== "none" && out.filter === undefined) out.filter = l.filter;
  return out;
}

/// " (did you mean ...?)" for a misspelt key, or "".
export function nearest(word: string, words: string[]): string {
  const dist = (a: string, b: string) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
    for (let j = 1; j <= b.length; j++) d[0]![j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1]!.toLowerCase() === b[j - 1]!.toLowerCase() ? 0 : 1));
    return d[a.length]![b.length]!;
  };
  const best = [...words].sort((x, y) => dist(word, x) - dist(word, y))[0];
  return best && dist(word, best) <= Math.max(2, Math.floor(word.length / 3)) ? ` (did you mean "${best}"?)` : "";
}

function rngOf(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/// PolyBLEP: rounds off a saw's or square's jump so its high harmonics do not fold back below as hiss and whistles (aliasing).
function blep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

/// A state-variable filter, one sample at a time.
class Svf {
  private ic1 = 0;
  private ic2 = 0;
  low = 0;
  band = 0;
  high = 0;
  step(x: number, fc: number, rate: number, q: number): void {
    const g = Math.tan((Math.PI * Math.min(fc, rate * 0.45)) / rate);
    const k = 1 / q;
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = x - this.ic2;
    const v1 = a1 * this.ic1 + a2 * v3;
    const v2 = this.ic2 + a2 * this.ic1 + a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.low = v2;
    this.band = v1;
    this.high = x - k * v1 - v2;
  }
}

export const layerSeconds = (l: SfxLayer) => l.start + l.attack + l.hold + l.decay;

/// One layer, rendered into `outL`/`outR` (added) from its start. `width` is the effect's stereo spread.
function renderLayer(l: SfxLayer, seed: number, width: number, rate: number, outL: Float32Array, outR: Float32Array): void {
  const rng = rngOf(seed);
  const begin = Math.round(l.start * rate);
  const len = Math.min(outL.length - begin, Math.round((l.attack + l.hold + l.decay) * rate));
  if (len <= 0) return;
  const noisy = l.wave === "noise" || l.wave === "pink" || l.wave === "crackle";
  const voices = noisy ? (width > 0 ? 2 : 1) : l.unison;
  const phase: number[] = [], ratio: number[] = [], gl: number[] = [], gr: number[] = [];
  for (let v = 0; v < voices; v++) {
    const x = voices > 1 ? (v / (voices - 1)) * 2 - 1 : 0;
    phase.push(noisy || voices === 1 ? 0 : rng());
    ratio.push(noisy ? 1 : 2 ** ((x * l.detune) / 1200));
    const p = clamp(l.pan + x * width * (noisy ? 1 : 0.8), -1, 1);
    gl.push(Math.cos(((p + 1) * Math.PI) / 4));
    gr.push(Math.sin(((p + 1) * Math.PI) / 4));
  }
  const norm = 1 / Math.sqrt(voices);
  // noise: per voice a pink filter state; two noise voices are two independent noises, mixed a little so that the centre holds
  const pink = Array.from({ length: voices }, () => [0, 0, 0, 0, 0, 0, 0]);
  const crackle = Array.from({ length: voices }, () => ({ level: 0 }));
  const filters = Array.from({ length: voices }, () => new Svf());
  const fTime = l.filterTime > 0 ? l.filterTime : (l.attack + l.hold + l.decay);
  const fEnd = l.cutoffEnd > 0 ? l.cutoffEnd : l.cutoff;
  let modPhase = 0, ringPhase = 0;
  const fade = Math.min(len, Math.round(0.004 * rate));
  const crackleFall = Math.exp(-1 / (0.0012 * rate)); // (each crackle dies away in about a millisecond)
  for (let k = 0; k < len; k++) {
    const t = k / rate;
    // envelope
    let env: number;
    if (t < l.attack) env = Math.sin((t / l.attack) * Math.PI * 0.5);
    else if (t < l.attack + l.hold) env = 1;
    else env = Math.exp((-6.908 * (t - l.attack - l.hold)) / l.decay);
    if (k >= len - fade) env *= (len - k) / fade; // (the last few ms reach exactly 0: no click at the layer's end)
    // pitch: the glide from `pitch` semitones away to freq, then the slide, the vibrato
    const semis = l.pitch * Math.exp(-t / l.pitchTime) + l.vibrato * Math.sin(2 * Math.PI * l.vibratoSpeed * t);
    const f = clamp(l.freq * 2 ** (semis / 12 + l.slide * t), 1, rate * 0.45);
    let fmOffset = 0;
    if (l.fm > 0) {
      modPhase = (modPhase + (f * l.fmRatio) / rate) % 1;
      const depth = l.fmDecay > 0 ? l.fm * Math.exp(-t / l.fmDecay) : l.fm;
      fmOffset = (depth * Math.sin(2 * Math.PI * modPhase)) / (2 * Math.PI);
    }
    let left = 0, right = 0;
    for (let v = 0; v < voices; v++) {
      let y: number;
      if (l.wave === "noise") y = rng() * 2 - 1;
      else if (l.wave === "pink") {
        // Paul Kellet's economy pink filter
        const b = pink[v]!;
        const w = rng() * 2 - 1;
        b[0] = 0.99886 * b[0]! + w * 0.0555179;
        b[1] = 0.99332 * b[1]! + w * 0.0750759;
        b[2] = 0.969 * b[2]! + w * 0.153852;
        b[3] = 0.8665 * b[3]! + w * 0.3104856;
        b[4] = 0.55 * b[4]! + w * 0.5329522;
        b[5] = -0.7616 * b[5]! - w * 0.016898;
        y = (b[0]! + b[1]! + b[2]! + b[3]! + b[4]! + b[5]! + b[6]! + w * 0.5362) * 0.18;
        b[6] = w * 0.115926;
      } else if (l.wave === "crackle") {
        const c = crackle[v]!;
        if (rng() < f / rate) c.level = (rng() < 0.5 ? -1 : 1) * (0.3 + 0.7 * rng());
        y = c.level;
        c.level *= crackleFall;
      } else {
        const dt = (f * ratio[v]!) / rate;
        let ph = phase[v]! + dt;
        if (ph >= 1) ph -= Math.floor(ph);
        phase[v] = ph;
        const p = fmOffset ? (((ph + fmOffset) % 1) + 1) % 1 : ph;
        switch (l.wave) {
          case "sine": y = Math.sin(2 * Math.PI * p); break;
          case "triangle": y = p < 0.5 ? 4 * p - 1 : 3 - 4 * p; break;
          case "saw": y = 2 * p - 1 - (fmOffset ? 0 : blep(p, dt)); break;
          default: {
            y = p < l.duty ? 1 : -1;
            if (!fmOffset) y += blep(p, dt) - blep((p - l.duty + 1) % 1, dt);
          }
        }
      }
      if (l.filter !== "none") {
        const fc = l.cutoff * (fEnd / l.cutoff) ** Math.min(1, t / fTime);
        const s = filters[v]!;
        s.step(y, fc, rate, l.q);
        y = l.filter === "lowpass" ? s.low : l.filter === "highpass" ? s.high : s.band;
      }
      left += y * gl[v]!;
      right += y * gr[v]!;
    }
    let g = env * l.volume * norm;
    if (l.ring > 0) {
      ringPhase = (ringPhase + l.ring / rate) % 1;
      g *= Math.sin(2 * Math.PI * ringPhase);
    }
    outL[begin + k] = outL[begin + k]! + left * g;
    outR[begin + k] = outR[begin + k]! + right * g;
  }
}

/// A small stereo room (four combs and two all-passes a side, with a short pre-delay), added onto the dry sound. The arrays are
/// already long enough for the tail.
function room(l: Float32Array, r: Float32Array, wet: number, size: number, width: number, rate: number): void {
  const scale = (rate / 44100) * (0.35 + size * 0.75);
  const feedback = 0.62 + size * 0.26;
  const damp = 0.3;
  const pre = Math.round(0.008 * rate);
  const n = l.length;
  const side = (spread: number) => {
    const combs = [1116, 1188, 1277, 1356].map((len) => ({ buf: new Float32Array(Math.max(1, Math.round((len + spread) * scale))), pos: 0, store: 0 }));
    const aps = [556, 341].map((len) => ({ buf: new Float32Array(Math.max(1, Math.round((len + spread) * (rate / 44100)))), pos: 0 }));
    return { combs, aps };
  };
  const sides = [side(0), side(37)];
  const outs = [new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) {
    const src = i - pre >= 0 ? (l[i - pre]! + r[i - pre]!) * 0.5 : 0;
    for (let ch = 0; ch < 2; ch++) {
      const s = sides[ch]!;
      let y = 0;
      for (const c of s.combs) {
        const v = c.buf[c.pos]!;
        c.store = v * (1 - damp) + c.store * damp;
        c.buf[c.pos] = src * 0.2 + c.store * feedback;
        if (++c.pos >= c.buf.length) c.pos = 0;
        y += v;
      }
      for (const a of s.aps) {
        const v = a.buf[a.pos]!;
        a.buf[a.pos] = y + v * 0.5;
        y = v - y;
        if (++a.pos >= a.buf.length) a.pos = 0;
      }
      outs[ch]![i] = y;
    }
  }
  // (narrow: both sides closer to their middle)
  const w = 0.35 + 0.65 * width;
  for (let i = 0; i < n; i++) {
    const m = (outs[0]![i]! + outs[1]![i]!) * 0.5, sd = (outs[0]![i]! - outs[1]![i]!) * 0.5 * w;
    l[i] = l[i]! + (m + sd) * wet;
    r[i] = r[i]! + (m - sd) * wet;
  }
}

/// How long the room rings after the sound (seconds), so the effect can be made that much longer.
export function roomTail(reverb: number, size: number): number {
  return reverb > 0 ? 0.15 + size * 0.7 : 0;
}

/// Renders layers (or, given `dry`, an already made mono sound) and puts the finish over them. `volume` scales the layers
/// before the drive; `seconds` caps the whole.
export function renderRich(layers: SfxLayer[] | null, dry: Float32Array | null, finish: SfxFinish, volume: number, seed: number, maxSeconds: number, rate: number): Float32Array[] {
  const drive = clamp(finish.drive ?? 0, 0, 1), reverb = clamp(finish.reverb ?? 0, 0, 1), size = clamp(finish.room ?? 0.3, 0, 1), width = clamp(finish.width ?? 0, 0, 1);
  const body = layers ? Math.max(0.01, ...layers.map(layerSeconds)) : (dry?.length ?? 1) / rate;
  const seconds = Math.min(maxSeconds, body + roomTail(reverb, size));
  const n = Math.max(1, Math.round(seconds * rate));
  const l = new Float32Array(n), r = new Float32Array(n);
  if (layers) layers.forEach((layer, i) => renderLayer(layer, (seed >>> 0) * 7919 + i * 104729 + 1, width, rate, l, r));
  else if (dry) for (let i = 0; i < Math.min(n, dry.length); i++) l[i] = r[i] = dry[i]!;
  // a DC blocker (a high-pass at 15 Hz): pulses, crackle and slow noise lean to one side, which clicks at the start and end
  const hpA = Math.exp((-2 * Math.PI * 15) / rate);
  for (const ch of [l, r]) {
    let y = 0, prev = 0;
    for (let i = 0; i < n; i++) {
      y = hpA * (y + ch[i]! - prev);
      prev = ch[i]!;
      ch[i] = y;
    }
  }
  const gain = layers ? volume : 1;
  if (drive > 0) {
    const g = 1 + 5 * drive, norm = Math.tanh(g);
    for (let i = 0; i < n; i++) {
      l[i] = Math.tanh(g * l[i]! * gain) / norm;
      r[i] = Math.tanh(g * r[i]! * gain) / norm;
    }
  } else if (gain !== 1) {
    for (let i = 0; i < n; i++) {
      l[i] = l[i]! * gain;
      r[i] = r[i]! * gain;
    }
  }
  if (reverb > 0) room(l, r, reverb, size, width, rate);
  // under full scale; the end cut where the sound has fallen 66 dB under its peak (a room's tail need not run on in silence), and
  // a short fade there so nothing clicks
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(l[i]!), Math.abs(r[i]!));
  const top = peak > 0.98 ? 0.98 / peak : 1;
  let end = n;
  while (end > 1 && Math.abs(l[end - 1]!) < peak * 0.0005 && Math.abs(r[end - 1]!) < peak * 0.0005) end--;
  const m = Math.max(1, Math.min(n, end + Math.round(0.005 * rate)));
  const fade = Math.min(m, Math.round(0.01 * rate));
  for (let i = 0; i < m; i++) {
    const f = i >= m - fade ? (m - i) / fade : 1;
    l[i] = l[i]! * top * f;
    r[i] = r[i]! * top * f;
  }
  // mono when nothing makes the two sides differ
  let differ = false;
  for (let i = 0; i < m && !differ; i++) differ = l[i] !== r[i];
  return differ ? [l.slice(0, m), r.slice(0, m)] : [l.slice(0, m)];
}
