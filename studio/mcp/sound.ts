// sound_report: what a sound is, in numbers and plain words, for a maker who cannot listen: length, level, how the loudness
// moves, where the energy sits, the strongest lines, clipping, clicks, silence at the ends, whether a loop's seam matches,
// and a spectrogram picture. Pure functions on samples; server.ts finds and decodes the files.

import { integratedLufs } from "../src/lib/loudness";
import { newRaster, type Raster, type Rgba } from "../src/lib/pixels";
import { fft } from "../src/lib/spectrum";
import type { SfxParams } from "../src/lib/sfx";
import { DRUMS, expandClips, isInstrument, renderSong, stepTime, type Song } from "../src/lib/song";
import type { Sound } from "../src/lib/wav";
import { DIM, fill, fit, INK, label, PAPER } from "./draw";

const db = (v: number) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
const fmt = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "-inf");
const hz = (f: number) => (f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 0 : 1)} kHz` : `${Math.round(f)} Hz`);
const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function note(f: number): string {
  if (!(f > 20)) return "";
  const midi = Math.round(69 + 12 * Math.log2(f / 440));
  return `${NOTES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

export interface Analysis {
  name: string;
  seconds: number;
  rate: number;
  channels: number;
  peakDb: number;
  rmsDb: number;
  /// The level of the parts that sound (100 ms windows within 26 dB of the loudest): what a short effect is heard at.
  loudDb: number;
  lufs: number;
  clipped: number;
  dc: number;
  centroid: number;
  shares: { name: string; from: number; to: number; share: number }[];
  lines: { hz: number; share: number }[];
  flatness: number;
  reading: string[];
  warnings: string[];
  envelope: number[];
  pitch: number[];
  silenceStart: number;
  silenceEnd: number;
  clicks: number[];
  seam?: { step: number; typical: number; slope: number; levelDb: number; ok: boolean; why?: string; sounding?: string };
  /// columns of dB by frequency bin, for the picture
  stft: { columns: Float32Array[]; size: number; hop: number };
  mono: Float32Array;
  /// What it is made of (lib/sound.ts `character`): what makes a sound read as an old console's or as a produced one.
  character: Character;
  /// For an effect: what it lacks against a produced game sound, each with what to add (empty for music and runs).
  advice: string[];
  /// On a small speaker (little below SPEAKER_HZ): the share of the energy below it, and how much quieter the sound is there.
  speaker: { below: number; lossDb: number };
}

/// The make-up of a sound, measured: the numbers behind "it sounds like a chip".
export interface Character {
  /// From the first sound to the loudest 5 ms.
  attackMs: number;
  /// The first 20 ms are brighter or noisier than the rest: a click or crack that the ear takes as the moment of impact.
  transient: boolean;
  /// Spectral lines within 30 dB of the strongest (100 Hz to 12 kHz).
  partials: number;
  /// Those lines sit on whole multiples of the lowest one (a buzzy square or saw is harmonic; metal and bells are not).
  harmonic: boolean;
  /// How noisy the sounding moments are, 0 a pure tone to 1 white noise (the mean flatness of each moment's spectrum).
  noise: number;
  /// How much the spectrum's shape changes from one 20 ms to the next, in dB (0: frozen; a sweeping filter or falling pitch: 3 and up).
  movement: number;
  /// The spectral centroid at the end over that at the start (below 1: it darkens, as real impacts and whooshes do).
  darkening: number;
  /// Stereo: the side's energy over the middle's (0: mono).
  width: number;
  /// Share of the energy below 150 Hz (the thump under an impact).
  low: number;
  /// From the loudest moment to 40 dB below it.
  tailMs: number;
  /// The fall: "exponential" (a natural ring), "linear" (straight down), "cut" (stops short), or "" when it does not fall.
  fall: string;
}

/// Measures a sound's make-up from its samples (the STFT columns `analyse` made, power per bin).
export function character(sound: Sound, mono: Float32Array, columns: Float32Array[], size: number, hop: number): Character {
  const rate = sound.rate, n = mono.length;
  const binHz = rate / size;
  // a 5 ms envelope
  const w5 = Math.max(1, Math.round(rate * 0.005));
  const env: number[] = [];
  for (let i = 0; i < n; i += w5) {
    let e = 0;
    const end = Math.min(n, i + w5);
    for (let k = i; k < end; k++) e += mono[k]! * mono[k]!;
    env.push(Math.sqrt(e / Math.max(1, end - i)));
  }
  const top = Math.max(1e-12, ...env);
  const first = env.findIndex((e) => e > top * 0.01);
  const peakAt = env.indexOf(top);
  const attackMs = first >= 0 ? (peakAt - first) * 5 : 0;
  let tail = peakAt;
  while (tail < env.length && env[tail]! > top * 0.01) tail++;
  const tailMs = (tail - peakAt) * 5;
  // the shape of the fall: compare the level halfway through the fall with what a straight line (in amplitude) or an exponential would give
  let fall = "";
  // (from where it last stood within 6 dB of its peak: a held sound is judged on its fall, not its hold)
  let held = peakAt;
  for (let i = peakAt; i < tail; i++) if (env[i]! >= top * 0.5) held = i;
  const after = env.slice(held, tail);
  if (after.length >= 6) {
    const mid = after[Math.floor(after.length / 2)]! / after[0]!;
    const lastBits = env.slice(tail - 2, tail + 1).map((e) => e / top);
    const cutShort = (lastBits[0] ?? 0) > 0.08 && (env[tail + 1] ?? 0) / top < 0.005;
    fall = cutShort ? "cut" : mid > 0.3 ? "linear" : "exponential";
  }
  // the sounding columns, in bands of a third of an octave from 100 Hz to 12 kHz
  const bands: [number, number][] = [];
  for (let f = 100; f < 12000; f *= 2 ** (1 / 3)) bands.push([Math.max(1, Math.floor(f / binHz)), Math.max(1, Math.floor((f * 2 ** (1 / 3)) / binHz))]);
  const colEnergy = columns.map((c) => {
    let e = 0;
    for (let k = 1; k < c.length; k++) e += c[k]!;
    return e;
  });
  const loudest = Math.max(1e-30, ...colEnergy);
  const sounding = columns.map((_, i) => colEnergy[i]! > loudest * 1e-3);
  const shape = columns.map((c) => {
    const v = bands.map(([a, b]) => {
      let e = 0;
      for (let k = a; k <= Math.min(b, c.length - 1); k++) e += c[k]!;
      return 10 * Math.log10(e / Math.max(1, b - a + 1) + 1e-30);
    });
    const m = Math.max(...v);
    return v.map((x) => Math.max(-50, x - m));
  });
  const gap = Math.max(1, Math.round((0.02 * rate) / hop));
  let flux = 0, fluxN = 0;
  for (let i = 0; i + gap < columns.length; i++) {
    if (!sounding[i] || !sounding[i + gap]) continue;
    let d = 0;
    for (let b = 0; b < bands.length; b++) d += Math.abs(shape[i + gap]![b]! - shape[i]![b]!);
    flux += d / bands.length;
    fluxN++;
  }
  // per-column noisiness and centroid. Noisiness is the flatness inside each band of a third of an octave (a filtered noise is
  // flat within its bands even when the filter tilts the whole; a tone or a stack of harmonics is a few spikes), weighted by
  // the band's energy, over 2: white noise reads about 1, a square wave near 0.
  const wide: [number, number][] = [];
  // (thirds of an octave from 40 Hz, merged at the bottom until each band has 12 bins or more: three times the width of a window's main lobe, so one pure line in a band reads as a line)
  let from = Math.max(1, Math.floor(40 / binHz));
  for (let f = 40; f < 14000; f *= 2 ** (1 / 3)) {
    const b = Math.floor((f * 2 ** (1 / 3)) / binHz);
    if (b - from >= 11 && b < size / 2) {
      wide.push([from, b]);
      from = b + 1;
    }
  }
  const flat: number[] = [], flatWeight: number[] = [], cent: number[] = [];
  // (the noisiness is read from the loud moments only, those within 3 dB of the loudest: there the window sits inside the sound)
  const loudCol = Math.max(0, ...columns.map((c, i) => (sounding[i] ? colEnergy[i]! : 0)));
  columns.forEach((c, i) => {
    if (!sounding[i]) return;
    let wsum = 0, tot = 0;
    for (let k = 1; k < c.length; k++) {
      tot += c[k]!;
      wsum += c[k]! * k * binHz;
    }
    let num = 0, den = 0;
    for (const [a, b] of wide) {
      let lg = 0, lin = 0;
      for (let k = a; k <= b; k++) {
        lg += Math.log(c[k]! + 1e-30);
        lin += c[k]!;
      }
      const m = b - a + 1;
      if (lin <= 0) continue;
      num += lin * (Math.exp(lg / m) / (lin / m));
      den += lin;
    }
    flat.push(den > 0 ? Math.min(1, num / den / 0.56) : 0);
    flatWeight.push(tot >= loudCol * 0.5 ? tot : 0);
    cent.push(tot > 0 ? wsum / tot : 0);
  });
  // (weighted by each moment's energy: the moments where the window only catches the start or the end are smeared)
  const weightSum = flatWeight.reduce((s, x) => s + x, 0);
  const noise = weightSum > 0 ? flat.reduce((s, x, i) => s + x * flatWeight[i]!, 0) / weightSum : 0;
  const third = Math.max(1, Math.floor(cent.length / 3));
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
  const darkening = cent.length >= 3 ? avg(cent.slice(-third)) / Math.max(1, avg(cent.slice(0, third))) : 1;
  // a transient: the highs (above about 2.5 kHz) of the first 15 ms stand out against the next 45 ms by much more than the sound
  // as a whole does (a crack or click over a body), and are loud enough to hear
  let transient = false;
  {
    let peakAbs = 1e-9;
    for (let i = 0; i < n; i++) peakAbs = Math.max(peakAbs, Math.abs(mono[i]!));
    let onset = 0;
    while (onset < n && Math.abs(mono[onset]!) < peakAbs * 0.03) onset++;
    const a = Math.exp((-2 * Math.PI * 2500) / rate);
    let hp = 0, prev = onset > 0 ? mono[onset - 1]! : 0;
    const h0 = Math.round(0.015 * rate), h1 = Math.round(0.06 * rate);
    let hfHead = 0, hfAfter = 0, allHead = 0, allAfter = 0;
    for (let i = onset; i < Math.min(n, onset + h1); i++) {
      hp = a * (hp + mono[i]! - prev);
      prev = mono[i]!;
      if (i - onset < h0) {
        hfHead += hp * hp;
        allHead += mono[i]! * mono[i]!;
      } else {
        hfAfter += hp * hp;
        allAfter += mono[i]! * mono[i]!;
      }
    }
    if (allHead > 0 && hfHead / allHead >= 0.02) transient = allAfter <= 0 || hfAfter <= 0 || hfHead / hfAfter / (allHead / allAfter) >= 2.5;
  }
  // partials of the mean spectrum
  const mean = new Float64Array(size / 2 + 1);
  columns.forEach((c, i) => {
    if (sounding[i]) for (let k = 0; k < c.length; k++) mean[k]! += c[k]!;
  });
  const lo = Math.max(2, Math.floor(100 / binHz)), hi = Math.min(size / 2 - 2, Math.floor(12000 / binHz));
  let strongest = 0;
  for (let k = lo; k <= hi; k++) strongest = Math.max(strongest, mean[k]!);
  const peaks: number[] = [];
  for (let k = lo; k <= hi; k++) {
    if (mean[k]! >= strongest * 1e-3 && mean[k]! > mean[k - 1]! && mean[k]! >= mean[k + 1]! && mean[k]! > 4 * Math.min(mean[k - 2]!, mean[k + 2]!)) {
      if (peaks.length && k - peaks[peaks.length - 1]! < 3) continue;
      peaks.push(k);
    }
  }
  // (each line's frequency finer than a bin: the parabola through the three bins round it)
  const fine = peaks.map((k) => {
    const a = Math.log(mean[k - 1]! + 1e-30), b = Math.log(mean[k]! + 1e-30), c = Math.log(mean[k + 1]! + 1e-30);
    return k + Math.max(-0.5, Math.min(0.5, (a - c) / (2 * (a - 2 * b + c) || 1)));
  });
  const base = fine[0];
  const harmonic = !!base && fine.length >= 2 && fine.every((k) => {
    const r = k / base;
    return Math.round(r) >= 1 && Math.abs(r / Math.round(r) - 1) < 0.03;
  });
  // stereo and low end
  let side = 0, mid = 0;
  if (sound.channels.length === 2) {
    const [l, r] = sound.channels as [Float32Array, Float32Array];
    for (let i = 0; i < n; i++) {
      const m = (l[i]! + r[i]!) / 2, s = (l[i]! - r[i]!) / 2;
      mid += m * m;
      side += s * s;
    }
  }
  let lowE = 0, all = 0;
  for (let k = 1; k < mean.length; k++) {
    all += mean[k]!;
    if (k * binHz < 150) lowE += mean[k]!;
  }
  return {
    attackMs, transient, partials: peaks.length, harmonic, noise, movement: fluxN ? flux / fluxN : 0, darkening,
    width: mid > 0 ? side / mid : 0, low: all > 0 ? lowE / all : 0, tailMs, fall,
  };
}

/// What a song lacks against produced game music, read from its settings and its measured width: each with the field to set.
export function adviseSong(c: Character, song: Song): string[] {
  const out: string[] = [];
  const live = song.tracks.filter((t) => !t.mute && (t.notes.length || t.clips?.length));
  const chip = live.filter((t) => t.kind === "synth" && !isInstrument(t.wave) && (t.unison ?? 1) <= 1 && !((t.cutoff ?? 0) > 0));
  if (chip.length) out.push(`${chip.map((t) => `"${t.name}"`).join(", ")} ${chip.length > 1 ? "use" : "uses"} the plain chip voice (one oscillator, nothing moving): the main reason a song sounds like an old console. Give a lead or pad \`unison\` 3 to 5 with \`detune\` 10 to 20, a \`cutoff\` with \`sweep\`, and a \`reverb\` send.`);
  const lowest = live.filter((t) => t.kind === "synth" && t.notes.length).sort((x, y) => Math.min(...x.notes.map((n) => n.pitch)) - Math.min(...y.notes.map((n) => n.pitch)))[0];
  const triBass = lowest && lowest.wave === "triangle" && Math.min(...lowest.notes.map((n) => n.pitch)) < 55 ? [lowest] : [];
  if (triBass.length) out.push(`${triBass.map((t) => `"${t.name}"`).join(", ")}: a triangle bass is the NES's bass. A produced bass is a saw (or two detuned) through a low-pass that opens on each note: \`"wave": "saw", "unison": 2, "detune": 8, "cutoff": 400, "sweep": 0.5, "sub": 0.5\`.`);
  const chipDrums = live.filter((t) => t.kind === "drums" && (t.kit ?? "chip") === "chip");
  if (chipDrums.length) out.push(`${chipDrums.map((t) => `"${t.name}"`).join(", ")} ${chipDrums.length > 1 ? "use" : "uses"} the chip drum kit (a blip and a burst of held noise): set \`"kit": "studio"\` (or \`"punch"\` for big gated drums) and a little \`reverb\`.`);
  if (!live.some((t) => (t.reverb ?? 0) > 0) && !(song.buses ?? []).some((b) => (b.reverb ?? 0) > 0)) out.push("no room at all: give the lead, pads and snare a `reverb` send (0.15 to 0.4).");
  const kicks = live.filter((t) => t.kind === "drums").reduce((s, t) => s + t.notes.filter((n) => n.pitch === 36).length, 0);
  const driving = kicks / Math.max(1, song.length / (song.stepsPerBeat * 4)) >= 3; // (three kicks a bar or more: music that drives)
  if (driving && !live.some((t) => (t.duck ?? 0) > 0) && live.length >= 3) out.push("nothing makes room for the kick: give the bass and pads `duck` 0.3 to 0.6 (they dip on every kick and swell back: the pump of dance music and synthwave).");
  if (song.master?.limit === undefined && !(song.master?.fx ?? []).some((f) => f.type === "compressor")) out.push('no glue on the mix: `"master": { "volume": 1, "limit": -1, "fx": [{ "type": "compressor", "params": { "threshold": -14, "ratio": 2.5, "attack": 15, "release": 150 } }] }` evens it out and lets it be louder without clipping.');
  if (c.width < 0.01) out.push(`nearly mono (side/middle ${c.width.toFixed(3)}): pan the harmony and hats a little apart, and unison voices spread across the field.`);
  return out;
}

/// What a short effect lacks against a produced game sound, in words, each with what to add: the advice an agent who cannot
/// listen needs to go from "a chip blip" to "a hit". `sfx` names the settings when the effect's file is known.
export function adviseEffect(c: Character, seconds: number, sfx: SfxParams | undefined, loudStart: boolean): string[] {
  const out: string[] = [];
  const layered = !!sfx?.layers?.length;
  const plain = !!sfx && !layered;
  const impact = loudStart && seconds < 1.5;
  const tonal = c.noise < 0.15;
  const onlyNoise = c.noise > 0.8 && c.partials <= 1 && c.low < 0.05;
  const toy: string[] = [];
  if (tonal && c.partials <= 2 && c.movement < 2) toy.push("one or two steady partials");
  else if (tonal && c.partials >= 6 && c.harmonic) toy.push("a buzzy stack of harmonics (a raw square or saw)");
  if (c.noise < 0.05 && !c.transient) toy.push("no noise at all");
  if (onlyNoise) toy.push("noise with nothing under it");
  if (impact && !c.transient) toy.push("no transient");
  if (c.movement < 1 && seconds >= 0.08) toy.push("a frozen spectrum");
  if (c.width < 0.002) toy.push("mono");
  if (c.fall === "linear" || c.fall === "cut") toy.push(c.fall === "cut" ? "it stops short instead of ringing out" : "a straight-line fade instead of a ring");
  if (plain && sfx!.wave === "noise") toy.push("held-step noise (an 8-bit console's noise channel)");
  if (toy.length >= 3) out.push(`toy-like (it reads as an old console's sound): ${toy.join(", ")}.`);
  if (impact && !c.transient) out.push(`no transient: nothing marks the moment of impact. Add a layer of noise or a click 5 to 20 ms long at the start: { "wave": "noise", "filter": "highpass", "cutoff": 3000, "decay": 0.02, "volume": 0.5 }.`);
  if (impact && tonal && !c.transient) out.push(`no noise: if this is an impact, a shot or a whoosh, those are mostly noise. Add a noise layer through a filter that falls: { "wave": "noise", "filter": "bandpass", "cutoff": 3000, "cutoffEnd": 500, "q": 1.2, "decay": 0.25 }.`);
  if (impact && onlyNoise) out.push(`only noise, no body: add a tone that drops in pitch under it, high enough for a small speaker: { "wave": "triangle", "freq": 150, "pitch": 24, "pitchTime": 0.03, "decay": 0.25, "filter": "lowpass", "cutoff": 1400 } (a thump with harmonics), or 200 to 300 Hz for a knock.`);
  if (impact && seconds >= 0.15 && c.low < 0.04 && c.noise > 0.5) out.push(`no weight under it (${Math.round(c.low * 100)} % below 150 Hz): for a heavy hit, a slam or an explosion add a body that a small speaker plays, a knock at 120 to 250 Hz: { "wave": "triangle", "freq": 160, "pitch": 19, "pitchTime": 0.03, "decay": 0.25, "filter": "lowpass", "cutoff": 1400, "volume": 0.6 }, and if you like a quiet sine an octave under it for headphones (a handheld's speaker plays little below 200 Hz).`);
  if (c.movement < 1 && seconds >= 0.08) out.push(`static: the spectrum hardly moves (${c.movement.toFixed(1)} dB per 20 ms). Give a layer a pitch envelope (\`pitch\` 12 to 24 with \`pitchTime\` 0.03) or a filter that moves (\`cutoff\` 6000 to \`cutoffEnd\` 600).`);
  if (c.width < 0.002 && seconds >= 0.12 && !(sfx?.reverb || sfx?.width)) out.push(`mono and dry: add \`width\` 0.3 to 0.6 and a short room, \`reverb\` 0.1 to 0.25 with \`room\` 0.2 to 0.4 (wet concrete: 0.3).`);
  if (c.fall === "linear" || c.fall === "cut") out.push(`${c.fall === "cut" ? "it is cut off while still sounding" : "it fades in a straight line"}: real sounds ring out exponentially. ${layered ? "Layers already fall exponentially: lengthen the last layer's `decay`." : "Layers fall exponentially (`decay` is the time to -60 dB)."}`);
  if (plain && (sfx!.wave === "square" || sfx!.wave === "saw") && sfx!.freq > 600) out.push(`the plain voice's ${sfx!.wave} is not band-limited: at ${Math.round(sfx!.freq)} Hz its upper harmonics fold back as whistles (aliasing). A layer's saw and square are band-limited: move it into \`layers\`.`);
  if (plain && sfx!.wave === "noise") out.push(`the plain voice's noise is held steps (an 8-bit console's noise channel, buzzy at freq ${Math.round(sfx!.freq)}). A layer's \`noise\` and \`pink\` are smooth, and its filter can move.`);
  return out;
}

/// Below this a handheld's or a phone's speaker plays little; a sound with more than SPEAKER_SHARE of its energy under it is mostly lost there.
export const SPEAKER_HZ = 200;
export const SPEAKER_SHARE = 0.6;
/// A looping piece shorter than this (seconds) is warned about: heard many times over in a scene of minutes.
export const SHORT_LOOP = 45;

const BANDS: [string, number, number][] = [
  ["below 80 Hz (sub: felt, not heard on small speakers)", 0, 80],
  ["80-250 Hz (bass)", 80, 250],
  ["250-800 Hz (low mids)", 250, 800],
  ["800 Hz-2.5 kHz (mids)", 800, 2500],
  ["2.5-6 kHz (presence: where the ear is keenest)", 2500, 6000],
  ["above 6 kHz (air, hiss)", 6000, 1e9],
];

/// What is known about where a sound came from, so that a warning can say which setting to change and which way.
export interface Source {
  /// A sound effect's settings (its `.sfx.json`).
  sfx?: SfxParams;
  /// A song (its `.song.json`).
  song?: Song;
  /// A recording of a run: the sounds the game started, each with its frame (the play tool writes them beside the WAV).
  events?: { frame: number; text: string }[];
  fps?: number;
}

const n2 = (v: number) => String(Math.round(v * 1000) / 1000);

/// The names of a song's notes that start on its first step, and of those still held when it ends: what sounds at the seam.
export function atSeam(song: Song): { starting: string[]; held: string[]; without: Song } {
  const flat = expandClips(song);
  const from = flat.loop?.from ?? 0, to = flat.loop?.to ?? flat.length;
  const starting: string[] = [], held: string[] = [];
  const noteName = (pitch: number) => `${NOTES[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;
  const tracks = flat.tracks.map((t) => {
    if (t.mute) return t;
    const first = t.notes.filter((n) => n.step === from);
    const over = t.kind === "synth" ? t.notes.filter((n) => n.step < to && n.step + n.len >= to) : [];
    const what = (list: typeof t.notes) => [...new Set(list.map((n) => (t.kind === "drums" ? (DRUMS.find((d) => d.pitch === n.pitch)?.name.toLowerCase() ?? `drum ${n.pitch}`) : noteName(n.pitch))))].join(", ");
    if (first.length) starting.push(`${t.name} (${what(first)})`);
    if (over.length) held.push(`${t.name} (${what(over)})`);
    return { ...t, notes: t.notes.filter((n) => n.step !== from) };
  });
  return { starting, held, without: { ...flat, tracks } };
}

/// The sounds a run started within a few frames of a moment, as words.
function startedNear(source: Source | undefined, seconds: number, before = 3, after = 1): string {
  if (!source?.events) return "";
  const fps = source.fps ?? 60;
  const frame = Math.floor(seconds * fps + 1e-3) + 1;
  const near = source.events.filter((e) => e.frame >= frame - before && e.frame <= frame + after);
  if (!near.length) return ` (frame ${frame}: no sound started within ${before} frames of it, so something already playing jumped: music that restarted or was stopped without a fade, or a sound cut off)`;
  const counts = new Map<string, number>();
  for (const e of near) counts.set(`f${e.frame} ${e.text}`, (counts.get(`f${e.frame} ${e.text}`) ?? 0) + 1);
  return ` (frame ${frame}; started just then: ${[...counts].map(([k, c]) => (c > 1 ? `${k} x${c}` : k)).join(", ")})`;
}

export function analyse(name: string, sound: Sound, opts: { loop?: boolean; run?: boolean; source?: Source } = {}): Analysis {
  const sfx = opts.source?.sfx, song = opts.source?.song, events = opts.source?.events;
  const noisy = sfx?.wave === "noise";
  const n = sound.channels[0]?.length ?? 0;
  const rate = sound.rate;
  const mono = new Float32Array(n);
  let clipped = 0;
  for (const c of sound.channels) {
    for (let i = 0; i < n; i++) {
      mono[i]! += c[i]! / sound.channels.length;
      if (Math.abs(c[i]!) >= 0.999) clipped++;
    }
  }
  let peak = 0, sq = 0, sum = 0;
  for (const c of sound.channels) for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(c[i]!));
  for (let i = 0; i < n; i++) {
    sq += mono[i]! * mono[i]!;
    sum += mono[i]!;
  }
  const rms = Math.sqrt(sq / Math.max(1, n));
  // the level of the parts that sound
  const win = Math.max(1, Math.round(rate * 0.1));
  const energies: number[] = [];
  for (let i = 0; i < n; i += win) {
    let e = 0;
    const end = Math.min(n, i + win);
    for (let k = i; k < end; k++) e += mono[k]! * mono[k]!;
    energies.push(e / (end - i));
  }
  const top = Math.max(0, ...energies);
  const loudOnes = energies.filter((e) => e > top * 0.0025);
  const loud = Math.sqrt(loudOnes.reduce((s, e) => s + e, 0) / Math.max(1, loudOnes.length));
  // LUFS needs 400 ms: a shorter sound is measured with silence after it
  const need = Math.round(rate * 0.45);
  const padded = n >= need ? sound.channels : sound.channels.map((c) => {
    const p = new Float32Array(need);
    p.set(c);
    return p;
  });
  const lufs = n ? integratedLufs(padded, rate) : -Infinity;

  // loudness over time: twelve equal parts
  const parts = Math.min(12, Math.max(1, Math.floor(n / Math.max(1, Math.round(rate * 0.01)))));
  const envelope: number[] = [];
  for (let p = 0; p < parts; p++) {
    const a = Math.floor((p * n) / parts), b = Math.floor(((p + 1) * n) / parts);
    let e = 0;
    for (let k = a; k < b; k++) e += mono[k]! * mono[k]!;
    envelope.push(db(Math.sqrt(e / Math.max(1, b - a))));
  }
  // silence at either end (below -60 dBFS)
  const quiet = 0.001;
  let s0 = 0, s1 = 0;
  while (s0 < n && Math.abs(mono[s0]!) < quiet) s0++;
  while (s1 < n - s0 && Math.abs(mono[n - 1 - s1]!) < quiet) s1++;

  // the spectrum over time
  const size = n < 8192 ? 1024 : n < 131072 ? 2048 : 4096;
  const hop = Math.max(64, Math.floor(Math.max(1, n - size) / 560), 1);
  const hann = new Float64Array(size);
  for (let i = 0; i < size; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  const columns: Float32Array[] = [];
  const mean = new Float64Array(size / 2 + 1);
  const re = new Float64Array(size), im = new Float64Array(size);
  for (let at = 0; at === 0 || at + size <= n; at += hop) {
    for (let i = 0; i < size; i++) {
      re[i] = (at + i < n ? mono[at + i]! : 0) * hann[i]!;
      im[i] = 0;
    }
    fft(re, im);
    const col = new Float32Array(size / 2 + 1);
    for (let k = 0; k <= size / 2; k++) {
      const p = re[k]! * re[k]! + im[k]! * im[k]!;
      mean[k]! += p;
      col[k] = p;
    }
    columns.push(col);
    if (columns.length > 4000) break;
  }
  const binHz = rate / size;
  let total = 0, weighted = 0;
  for (let k = 1; k <= size / 2; k++) {
    total += mean[k]!;
    weighted += mean[k]! * k * binHz;
  }
  const centroid = total > 0 ? weighted / total : 0;
  const shares = BANDS.map(([bandName, from, to]) => {
    let e = 0;
    for (let k = 1; k <= size / 2; k++) if (k * binHz >= from && k * binHz < to) e += mean[k]!;
    return { name: bandName, from, to, share: total > 0 ? e / total : 0 };
  });
  // the strongest lines: peaks of the mean spectrum with the energy of the few bins around each
  const peaks: { hz: number; share: number; k: number }[] = [];
  for (let k = 2; k < size / 2 - 2; k++) {
    if (mean[k]! > mean[k - 1]! && mean[k]! >= mean[k + 1]! && mean[k]! > total * 0.002) {
      let e = 0;
      for (let j = k - 2; j <= k + 2; j++) e += mean[j]!;
      // (a finer frequency than the bin: the parabola through the three bins)
      const a = Math.log(mean[k - 1]! + 1e-30), b = Math.log(mean[k]! + 1e-30), c = Math.log(mean[k + 1]! + 1e-30);
      const shift = (a - c) / (2 * (a - 2 * b + c) || 1) ;
      peaks.push({ hz: (k + Math.max(-0.5, Math.min(0.5, shift))) * binHz, share: e / total, k });
    }
  }
  peaks.sort((x, y) => y.share - x.share);
  const lines: { hz: number; share: number; k: number }[] = [];
  for (const p of peaks) {
    if (lines.some((l) => Math.abs(l.k - p.k) <= 4)) continue;
    lines.push(p);
    if (lines.length >= 6) break;
  }
  // flatness between 60 Hz and 12 kHz: near 1 for noise, near 0 for tones
  let logSum = 0, lin = 0, count = 0;
  for (let k = 1; k <= size / 2; k++) {
    const f = k * binHz;
    if (f < 60 || f > 12000) continue;
    logSum += Math.log(mean[k]! + 1e-30);
    lin += mean[k]!;
    count++;
  }
  const flatness = count && lin > 0 ? Math.exp(logSum / count) / (lin / count) : 0;
  // the strongest frequency in each of up to eight parts (a rising chirp, a little tune)
  const pitch: number[] = [];
  const pparts = Math.min(8, columns.length);
  for (let p = 0; p < pparts; p++) {
    const a = Math.floor((p * columns.length) / pparts), b = Math.max(a + 1, Math.floor(((p + 1) * columns.length) / pparts));
    let best = 0, bestK = 0, energy = 0;
    for (let k = 2; k < size / 2; k++) {
      let e = 0;
      for (let c = a; c < b; c++) e += columns[c]![k]!;
      energy += e;
      if (e > best) {
        best = e;
        bestK = k;
      }
    }
    pitch.push(energy / (b - a) > (total / columns.length) * 0.02 ? bestK * binHz : 0);
  }
  // clicks: single steps far bigger than the sound's own
  const steps = new Float32Array(Math.max(0, n - 1));
  for (let i = 1; i < n; i++) steps[i - 1] = Math.abs(mono[i]! - mono[i - 1]!);
  const sorted = Float32Array.from(steps).sort();
  const typical = sorted.length ? sorted[Math.floor(sorted.length * 0.999)]! : 0;
  const clicks: number[] = [];
  for (let i = 0; i < steps.length && clicks.length < 6; i++) {
    if (steps[i]! > 0.25 && steps[i]! > typical * 3 && (clicks.length === 0 || i / rate - clicks[clicks.length - 1]! > 0.01)) clicks.push((i + 1) / rate); // (the sample the jump lands on)
  }

  const reading: string[] = [];
  const warnings: string[] = [];
  const topLine = lines[0];
  const fiveShare = lines.slice(0, 5).reduce((s, l) => s + l.share, 0);
  if (peak <= 0.0005) reading.push("silence");
  else if (topLine && topLine.share > 0.8) reading.push(`nearly a pure tone at ${hz(topLine.hz)} (${note(topLine.hz)})`);
  else if (flatness > 0.08 && fiveShare < 0.45 && (topLine?.share ?? 0) < 0.12) reading.push("mostly noise (no clear pitch)");
  else if (fiveShare > 0.6) reading.push(`tonal: its strongest lines hold ${Math.round(fiveShare * 100)} % of the energy`);
  else reading.push("a mix of tone and noise");
  const below80 = shares[0]!.share, bass = shares[0]!.share + shares[1]!.share, high = shares[4]!.share + shares[5]!.share;
  // a small speaker: what share of the energy lies below SPEAKER_HZ, and how much quieter the sound is through a speaker that rolls off
  // there (a second-order high-pass at SPEAKER_HZ, as a handheld's or a phone's does: little below it, nothing much below 100 Hz)
  let lowE = 0, heard = 0;
  for (let k = 1; k <= size / 2; k++) {
    const f = k * binHz;
    if (f < SPEAKER_HZ) lowE += mean[k]!;
    heard += mean[k]! * (f ** 4 / (f ** 4 + SPEAKER_HZ ** 4));
  }
  const speaker = { below: total > 0 ? lowE / total : 0, lossDb: total > 0 && heard > 0 ? 10 * Math.log10(total / heard) : 0 };
  // which setting to change, and which way, for a sound whose settings are known
  const lowTrack = () => {
    if (!song) return "";
    const synths = song.tracks.filter((t) => t.kind === "synth" && !t.mute && t.notes.length);
    const low = synths.map((t) => ({ t, min: Math.min(...t.notes.map((n) => n.pitch)) })).sort((x, y) => x.min - y.min)[0];
    const kick = song.tracks.some((t) => t.kind === "drums" && !t.mute && t.notes.some((n) => n.pitch === 36));
    return low && low.min < 48 ? `the track "${low.t.name}" goes down to pitch ${low.min} (${note(440 * 2 ** ((low.min - 69) / 12))}, ${Math.round(440 * 2 ** ((low.min - 69) / 12))} Hz): raise its notes by 12 (an octave) or lower its \`volume\` (it is ${n2(low.t.volume)})${kick ? "; the kick drum adds to it: lower the drum track's `volume` or the kick's `vel`" : ""}` : kick ? "the kick drum is most of it: lower the drum track's `volume` or the kick notes' `vel`, or add a track above 200 Hz" : "";
  };
  const lowFix = sfx
    ? noisy
      ? ` Raise \`freq\` (it is ${n2(sfx.freq)}; for noise it sets the colour: 1500 to 3000 is a crunch) or add \`highpass\` 200 or more.`
      : ` Raise \`freq\` above about 160 (it is ${n2(sfx.freq)})${sfx.slide < 0 ? `; the falling \`slide\` (${n2(sfx.slide)}) takes it lower still: make it less negative, or set \`freqLimit\` to 100 so the sound stops there` : ""}, or add \`highpass\` 100 or more.`
    : song
      ? ` ${lowTrack() || "Raise the lowest notes by an octave."}.`
      : " Raise the pitch, or add something above 200 Hz.";
  if (below80 > 0.8) warnings.push(`almost all of its energy (${Math.round(below80 * 100)} %) is below 80 Hz: a rumble that small speakers (a handheld, a phone) cannot play, so it will be nearly inaudible there.${lowFix}`);
  else if (below80 > 0.5) warnings.push(`${Math.round(below80 * 100)} % of its energy is below 80 Hz, which small speakers cannot play: it will sound much quieter on a handheld than the numbers say.${lowFix}`);
  else if (speaker.below > SPEAKER_SHARE) {
    const fix = sfx?.layers?.length
      ? " Give the low layers harmonics (a triangle or saw through a low-pass at 400 to 800 Hz instead of a pure sine, or some `drive`), add a layer an octave up (a knock at 120 to 250 Hz with a pitch drop), and turn the pure sub layer down."
      : sfx
        ? " Raise `freq`, or move the sound into `layers` with a knock at 120 to 250 Hz over the low end."
        : song
          ? " Give the bass upper harmonics (a saw with its `cutoff` at 700 Hz or more, a little `drive` in its `fx`), add a bass layer an octave up, turn the `sub` down, and give the kick a click and a body at 100 to 200 Hz (the `punch` kit's)."
          : " Add harmonics or a layer an octave up.";
    warnings.push(`most of the energy (${Math.round(speaker.below * 100)} %) is below ${SPEAKER_HZ} Hz, under what a handheld's or a phone's speaker plays: there it will be about ${fmt(speaker.lossDb)} dB quieter and thin, and the low part is lost. Add harmonics or a layer an octave up.${fix}`);
  } else if (bass > 0.6) reading.push("bass-heavy");
  if (high > 0.6) reading.push(centroid > 7000 ? "very bright, hissy" : "bright");
  if (topLine && topLine.share > 0.6 && topLine.hz > 2500 && topLine.hz < 6000 && n / rate > 0.4) warnings.push(`a strong steady tone at ${hz(topLine.hz)}, where the ear is keenest: piercing if it lasts or repeats. ${sfx ? `Lower \`freq\` (it is ${n2(sfx.freq)}) below 2000, shorten \`sustain\` (${n2(sfx.sustain)}), or set \`lowpass\` to about ${Math.round(topLine.hz / 2 / 100) * 100}` : "Lower its pitch, shorten it, or soften the wave (a triangle or sine, or a low-pass filter)"}.`);
  const voiced = pitch.filter((p) => p > 0);
  if (voiced.length >= 3) {
    const first = voiced[0]!, last = voiced[voiced.length - 1]!;
    if (last > first * 1.3) reading.push("rising in pitch");
    else if (last < first / 1.3) reading.push("falling in pitch");
  }
  if (envelope.length >= 4) {
    const max = Math.max(...envelope);
    const at = envelope.indexOf(max);
    if (at === 0 && envelope[envelope.length - 1]! < max - 12) reading.push("loudest at the start, then dying away (a hit, a pluck)");
    else if (at >= envelope.length - 2 && envelope[0]! < max - 12) reading.push("swelling to the end");
    else if (Math.max(...envelope) - Math.min(...envelope) < 4) reading.push("steady in level");
  }
  if (clipped > 0) {
    // (in a run: where it first clips, and what had started in the half second before)
    let where = "";
    if (events) {
      let firstAt = -1;
      for (let i = 0; i < n && firstAt < 0; i++) for (const c of sound.channels) if (Math.abs(c[i]!) >= 0.999) firstAt = i;
      if (firstAt >= 0) where = ` First at ${(firstAt / rate).toFixed(3)} s${startedNear(opts.source, firstAt / rate, 30, 0).replace("started just then", "started in the half second before").replace(/no sound started within 30 frames of it.*\)$/, "only sounds started earlier are playing)")}.`;
    }
    const fix = sfx
      ? `Lower \`volume\` (it is ${n2(sfx.volume)})${sfx.punch > 0 ? ` or \`punch\` (it is ${n2(sfx.punch)}, which adds up to ${Math.round(sfx.punch * 200)} % at the start)` : ""}${sfx.highpass > 0 || sfx.lowpass < 20000 ? "; a filter can overshoot, so leave a little room" : ""}.`
      : song
        ? `Lower the tracks' \`volume\` (the loudest is "${[...song.tracks].filter((t) => !t.mute).sort((x, y) => y.volume - x.volume)[0]?.name ?? "?"}"), or the song's master.`
        : events
          ? "Too much plays at once at full volume: lower the `volume` option of nova.sound.play for the sounds named, give the one that repeats `limit = 2`, or lower nova.music.volume."
          : "Lower its volume.";
    warnings.push(`${clipped} samples at full scale: it clips (distortion).${where} ${fix}`);
  }
  if (peak < 0.05 && peak > 0.0005) warnings.push(`very quiet: its peak is ${fmt(db(peak))} dBFS. ${sfx ? `Raise \`volume\` (it is ${n2(sfx.volume)})${sfx.lowpass < 2000 ? `, or raise \`lowpass\` (${n2(sfx.lowpass)}), which is taking most of it away` : ""}.` : "Raise its volume."}`);
  if (Math.abs(sum / Math.max(1, n)) > 0.02) {
    const offDuty = song ? song.tracks.filter((t) => t.kind === "synth" && !t.mute && t.wave === "square" && Math.abs(t.duty - 0.5) > 0.05).map((t) => `"${t.name}" (duty ${n2(t.duty)})`) : [];
    const fix = sfx
      ? sfx.wave === "square" && Math.abs(sfx.duty - 0.5) > 0.02
        ? `It comes from the square wave's \`duty\` (it is ${n2(sfx.duty)}): set \`duty\` to 0.5, or keep the thin sound and add \`highpass\` 150 or more.`
        : noisy
          ? `Slow noise leans to one side: raise \`freq\` (it is ${n2(sfx.freq)}) or add \`highpass\` 100 or more.`
          : "Add `highpass` 100 or more."
      : offDuty.length
        ? `It comes from square tracks whose \`duty\` is not 0.5: set \`duty\` to 0.5 on ${offDuty.join(", ")}.`
        : "Remove it with a high-pass filter (in an editor), or make the sound again.";
    warnings.push(`a DC offset of ${fmt((sum / n) * 100)} % of full scale (it will click when it starts and stops). ${fix}`);
  }
  if (n && Math.abs(mono[0]!) > 0.1 && !opts.loop && !opts.run) warnings.push(`it starts at ${Math.round(Math.abs(mono[0]!) * 100)} % of full scale instead of from silence: a click at the start. ${sfx ? `Raise \`attack\` to about 0.004 (it is ${n2(sfx.attack)}).` : "Fade its first few milliseconds in."}`);
  if (n && Math.abs(mono[n - 1]!) > 0.1 && !opts.loop && !opts.run) {
    const fix = sfx
      ? sfx.freqLimit > 0
        ? `\`freqLimit\` (${n2(sfx.freqLimit)}) cuts it off while it still sounds: lower \`freqLimit\`, or shorten \`sustain\` and \`decay\` so that it has faded before the pitch gets there.`
        : `Raise \`decay\` (it is ${n2(sfx.decay)}) so that it fades out.`
      : "Fade its last few milliseconds out.";
    warnings.push(`it ends at ${Math.round(Math.abs(mono[n - 1]!) * 100)} % of full scale instead of fading out: a click at the end. ${fix}`);
  }
  if (clicks.length) {
    const fix = events
      ? "Each is named with its frame and the sounds that started within 3 frames of it: give those a longer `attack` (0.01 to 0.03) with sfx_write, or play them quieter (`volume`); two of the same starting on one frame add up, so give that sound `limit = 1`."
      : sfx
        ? `Soften it: ${sfx.attack < 0.004 ? `raise \`attack\` to about 0.004 (it is ${n2(sfx.attack)}), ` : ""}${sfx.punch > 0.3 ? `lower \`punch\` (${n2(sfx.punch)}), ` : ""}${sfx.arpNotes?.length || sfx.arpSemitones ? "the pitch jumps (`arpTime`) land at full level, so lower `volume`, " : ""}or set \`lowpass\` to 4000-8000${sfx.lowpass < 20000 ? ` (it is ${n2(sfx.lowpass)}: lower it)` : ""}.`
        : song
          ? "A note that starts at full level clicks: raise that track's `attack` to 0.005 or more, or lower its `volume`."
          : "Fade in whatever starts there, or lower its level.";
    warnings.push(`sudden jumps (clicks) at ${clicks.map((t) => `${t.toFixed(3)} s${startedNear(opts.source, t)}`).join(", ")}. ${fix}`);
  }
  if (s0 / rate > 0.05 && s0 < n) warnings.push(`${Math.round((s0 / rate) * 1000)} ms of silence before it starts: it will feel late. ${song ? "Move the first notes to step 0." : sfx ? `Shorten \`attack\` (it is ${n2(sfx.attack)}).` : "Cut the silence off the front of the file."}`);

  let seam: Analysis["seam"];
  // a song with an intro that plays once loops back to its loop's start, not to the top
  const ls = song?.loop && song.loop.to === song.length && song.loop.from > 0 ? Math.max(0, Math.min(n - 2, Math.round(stepTime(song, song.loop.from) * rate))) : 0;
  if (opts.loop && n > 64) {
    const step = Math.abs(mono[ls]! - mono[n - 1]!);
    const inner = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
    const slope = Math.abs(mono[ls + 1]! - mono[ls]! - (mono[n - 1]! - mono[n - 2]!));
    const edge = Math.min((n - ls) >> 1, Math.round(rate * 0.05));
    let e0 = 0, e1 = 0;
    for (let i = 0; i < edge; i++) {
      e0 += mono[ls + i]! * mono[ls + i]!;
      e1 += mono[n - 1 - i]! * mono[n - 1 - i]!;
    }
    const levelDb = db(Math.sqrt(e0 / edge)) - db(Math.sqrt(e1 / edge));
    // (a beat at the start and a tail at the end differ in level and still loop well, so the level is told, not judged)
    const gap = (s0 + s1) / rate;
    const limit = Math.max(inner * 1.5, 0.02);
    let ok = step <= limit;
    let why = "";
    let sounding = "";
    if (song) {
      // What sounds at the seam, by track. A note that starts on the first step brings its own attack (a kick's click
      // is a drum being a drum, the same on every beat it plays): the seam is judged without those notes.
      const at = atSeam(song);
      sounding = `${at.starting.length ? `starting on the first step: ${at.starting.join("; ")}` : "nothing starts on the first step"}${at.held.length ? `; still held at the end: ${at.held.join("; ")}` : ""}`;
      if (!ok && at.starting.length) {
        const rest = renderSong(at.without, rate).channels;
        const m = rest[0]!.length;
        const restStep = m > 1 ? Math.abs(rest.reduce((s, c) => s + c[Math.min(ls, m - 1)]!, 0) / rest.length - rest.reduce((s, c) => s + c[m - 1]!, 0) / rest.length) : 0;
        if (restStep <= limit) {
          ok = true;
          why = `the step across it is the attack of what starts on the first step (${at.starting.join("; ")}), as on any other beat`;
        }
      }
    } else if (!ok) {
      // a loop that ends in silence: the step is the first sound's own attack, the same as when it first plays
      const tail = Math.min(n, Math.round(rate * 0.002));
      let end = 0;
      for (let i = n - tail; i < n; i++) end = Math.max(end, Math.abs(mono[i]!));
      if (end <= 0.01) {
        ok = true;
        why = "the end is silent, so the step across it is the attack of what starts the loop";
      }
    }
    seam = { step, typical: inner, slope, levelDb, ok, why, sounding };
    if (!ok) {
      warnings.push(`the loop's seam does not match: the last sample to the first is a step of ${fmt(step * 100)} % of full scale, against ${fmt(inner * 100)} % for the biggest steps inside it (a click every time round). ${song ? `At the seam: ${sounding}. A note that is cut off by the end is the usual cause: shorten the notes still held at the end so that they finish a step earlier, or lengthen those tracks' \`release\`.` : "Make the loop end where the wave crosses zero, or fade its last few milliseconds into its first."}`);
    } else if (gap >= 0.08) warnings.push(`the loop has ${Math.round(gap * 1000)} ms of silence at its ends: if that is not a rest in the music, it is a gap every time round. ${song ? "Put a note on the first step, or shorten the song's `length`." : "Cut the silence off the file's ends."}`);
    // a short loop under a long scene is heard over and over (a jingle or a sting under 10 s is left alone)
    const loopSeconds = (n - ls) / rate;
    if (!opts.run && loopSeconds >= 10 && loopSeconds < SHORT_LOOP) warnings.push(`it loops every ${loopSeconds.toFixed(0)} s: under about ${SHORT_LOOP} s, a level or a fight that lasts minutes hears it many times over and it grows tiring. ${song ? "Make it longer with sections that change (song_make's default form: an intro that plays once, then A, B, a break and A again, a minute or more; or patterns and clips), and set `loop` from the first section after the intro to the end." : "Make a longer piece with sections that change."}`);
  }
  const made = character(sound, mono, columns, size, hop);
  const loudStart = envelope.length > 0 && envelope.indexOf(Math.max(...envelope)) <= 1;
  const advice = peak > 0.0005 && !opts.loop && !opts.run && !song ? adviseEffect(made, n / rate, sfx, loudStart) : song ? adviseSong(made, song) : [];
  return {
    name, seconds: n / rate, rate, channels: sound.channels.length, peakDb: db(peak), rmsDb: db(rms), loudDb: db(loud), lufs, clipped, dc: sum / Math.max(1, n),
    centroid, shares, lines: lines.map((l) => ({ hz: l.hz, share: l.share })), flatness, reading, warnings, envelope, pitch,
    silenceStart: s0 / rate, silenceEnd: s1 / rate, clicks, seam, stft: { columns, size, hop }, mono, character: made, advice, speaker,
  };
}

/// The level a sound is heard at, as the mix table measures it: LUFS for a sound of 0.45 s or more, else the RMS of its loud
/// parts (100 ms windows within 26 dB of the loudest). Cheap: no spectrum.
export function heardLevel(sound: Sound): number {
  const n = sound.channels[0]?.length ?? 0;
  if (!n) return -Infinity;
  if (n / sound.rate >= 0.45) return integratedLufs(sound.channels, sound.rate);
  const win = Math.max(1, Math.round(sound.rate * 0.1));
  const energies: number[] = [];
  for (let i = 0; i < n; i += win) {
    let e = 0;
    const end = Math.min(n, i + win);
    for (let k = i; k < end; k++) {
      let m = 0;
      for (const c of sound.channels) m += c[k]! / sound.channels.length;
      e += m * m;
    }
    energies.push(e / (end - i));
  }
  const top = Math.max(0, ...energies);
  const loud = energies.filter((e) => e > top * 0.0025);
  return db(Math.sqrt(loud.reduce((s, e) => s + e, 0) / Math.max(1, loud.length)));
}

/// The report of one sound, in words.
export function describe(a: Analysis): string {
  const out: string[] = [];
  out.push(`${a.name}: ${a.seconds.toFixed(2)} s, ${a.channels === 1 ? "mono" : "stereo"}, ${a.rate} Hz`);
  out.push(`  reading: ${a.reading.join("; ")}`);
  for (const w of a.warnings) out.push(`  WARNING: ${w}`);
  out.push(`  level: peak ${fmt(a.peakDb)} dBFS, loud parts ${fmt(a.loudDb)} dB RMS, whole ${fmt(a.rmsDb)} dB RMS, loudness ${fmt(a.lufs)} LUFS${a.seconds < 0.45 ? " (a short sound: measured with silence after it)" : ""}`);
  const partMs = (a.seconds / a.envelope.length) * 1000;
  out.push(`  loudness over time (dB RMS, ${a.envelope.length} equal parts of ${partMs >= 1000 ? `${(partMs / 1000).toFixed(1)} s` : `${Math.round(partMs)} ms`}): ${a.envelope.map((v) => (Number.isFinite(v) ? Math.round(v) : "-inf")).join(" ")}`);
  out.push(`  spectral centroid ${hz(a.centroid)}; flatness ${a.flatness.toFixed(2)} (0 a tone, 1 noise)`);
  out.push(`  energy by range: ${a.shares.filter((s) => s.share >= 0.005).map((s) => `${s.name.split(" (")[0]} ${Math.round(s.share * 100)} %`).join(", ")}`);
  out.push(`  on a small speaker (a handheld's or a phone's, little below ${SPEAKER_HZ} Hz): ${Math.round(a.speaker.below * 100)} % of the energy is below that, so it plays about ${fmt(a.speaker.lossDb)} dB quieter there`);
  if (a.lines.length) out.push(`  strongest lines: ${a.lines.filter((l) => l.share >= 0.02).map((l) => `${hz(l.hz)} ${note(l.hz)} ${Math.round(l.share * 100)} %`).join(", ") || "none above 2 % of the energy"}`);
  if (a.pitch.some((p) => p > 0)) out.push(`  strongest pitch over time (${a.pitch.length} equal parts): ${a.pitch.map((p) => (p > 0 ? `${Math.round(p)}` : "-")).join(" ")} Hz`);
  out.push(`  ends: ${Math.round(a.silenceStart * 1000)} ms of silence at the start, ${Math.round(a.silenceEnd * 1000)} ms at the end; ${a.clipped ? `${a.clipped} clipped samples` : "no clipping"}; ${a.clicks.length ? `${a.clicks.length} click(s)` : "no clicks"}`);
  const c = a.character;
  // (a loop or a recording has no one attack and tail: only what it is made of)
  if (a.seam || a.seconds > 4) out.push(`  make-up: noise ${c.noise.toFixed(2)} (0 tone, 1 noise), movement ${c.movement.toFixed(1)} dB per 20 ms, ${c.width < 0.002 ? "mono" : `stereo width ${c.width.toFixed(2)}`}, ${Math.round(c.low * 100)} % below 150 Hz`);
  else out.push(`  make-up: ${c.transient ? "a transient at the start" : "no transient"}, rises in ${c.attackMs} ms, ${c.partials} spectral line${c.partials === 1 ? "" : "s"}${c.partials >= 2 ? (c.harmonic ? " (harmonic)" : " (not harmonic)") : ""}, noise ${c.noise.toFixed(2)} (0 tone, 1 noise), movement ${c.movement.toFixed(1)} dB per 20 ms, brightness end/start ${c.darkening.toFixed(2)}, ${c.width < 0.002 ? "mono" : `stereo width ${c.width.toFixed(2)}`}, ${Math.round(c.low * 100)} % below 150 Hz, tail ${c.tailMs} ms${c.fall ? ` (${c.fall === "exponential" ? "rings out" : c.fall === "linear" ? "a straight fade" : "cut short"})` : ""}`);
  for (const s of a.advice) out.push(`  advice: ${s}`);
  if (a.seam) out.push(`  loop seam: ${a.seam.ok ? "matches" : "DOES NOT MATCH"} (step ${fmt(a.seam.step * 100)} % of full scale across it, ${fmt(a.seam.typical * 100)} % for the big steps inside; level ${fmt(Math.abs(a.seam.levelDb))} dB apart${a.seam.ok && a.seam.why ? `; ${a.seam.why}` : ""})${a.seam.sounding ? `; at the seam: ${a.seam.sounding}` : ""}`);
  return out.join("\n");
}

/// Several sounds side by side: which is loudest and by how much. `volumes` are what the game plays each at (the `volume`
/// option of nova.sound.play, nova.music.volume): the table is then of what is heard, not of the files. `music` marks the
/// ones that are music, to say how far they sit under the effects.
export function mixTable(list: Analysis[], volumes: (number | undefined)[] = [], music: boolean[] = []): string {
  // LUFS needs 0.4 s of sound: a shorter one is measured with silence after it and reads low, so a short sound is
  // taken at the level of the part that sounds
  const fileLevel = (a: Analysis) => (a.seconds >= 0.45 && Number.isFinite(a.lufs) ? a.lufs : a.loudDb);
  const rows = list.map((a, i) => {
    const volume = volumes[i];
    const gain = volume !== undefined && volume > 0 ? 20 * Math.log10(volume) : volume === 0 ? -Infinity : 0;
    return { a, volume, music: !!music[i], level: fileLevel(a) + gain, peak: a.peakDb + gain, short: !(a.seconds >= 0.45 && Number.isFinite(a.lufs)) };
  });
  const sorted = [...rows].sort((x, y) => y.level - x.level);
  const top = sorted[0]!.level;
  const any = rows.some((r) => r.volume !== undefined);
  const width = Math.max(...sorted.map((r) => r.a.name.length), 5);
  const out = [`the mix, loudest first (loudness in LUFS${any ? ", at the volumes given" : ", every file at volume 1: give { name, volume } pairs to see it as the game plays it"}; "below" is how far under the loudest; 10 dB is about half as loud):`];
  out.push(`  ${"sound".padEnd(width)}  ${any ? "volume  " : ""}LUFS    below   peak dBFS  length`);
  for (const r of sorted) {
    out.push(`  ${r.a.name.padEnd(width)}  ${any ? `${(r.volume ?? 1).toFixed(2).padStart(6)}  ` : ""}${fmt(r.level).padStart(5)}${r.short ? "~" : " "}  ${(top - r.level < 0.05 ? "-" : fmt(top - r.level)).padStart(5)}   ${fmt(r.peak).padStart(6)}     ${r.a.seconds.toFixed(2)} s${r.a.warnings.length ? "   (!)" : ""}`);
  }
  if (sorted.some((r) => r.short)) out.push("  (~ a sound shorter than 0.45 s: the level of the part that sounds, since LUFS cannot be measured on so little)");
  const spread = top - sorted[sorted.length - 1]!.level;
  if (sorted.length > 1) {
    out.push(spread > 18 ? `  the quietest is ${fmt(spread)} dB under the loudest: it will be hard to hear beside it${any ? "" : " at the same volume"}` : `  they sit within ${fmt(spread)} dB of each other`);
    const tunes = rows.filter((r) => r.music), effects = rows.filter((r) => !r.music);
    if (tunes.length && effects.length) {
      const loudest = Math.max(...effects.map((r) => r.level));
      for (const t of tunes) {
        const under = loudest - t.level;
        const now = t.volume ?? 1;
        const want = now * 10 ** ((under - 8) / 20);
        const verdict = under >= 6 && under <= 10 ? "which is where music usually sits (6 to 10 dB under)" : `music usually sits 6 to 10 dB under: play it at volume ${Math.min(4, want).toFixed(2)} for 8 dB (nova.music.volume(${Math.min(4, want).toFixed(2)}), or the volume option of nova.music.play)${want > 1 ? ", or play the effects quieter" : ""}`;
        out.push(`  ${t.a.name} is ${under >= 0 ? `${fmt(under)} dB under` : `${fmt(-under)} dB OVER`} the loudest effect${any ? "" : " with everything at volume 1"}, ${verdict}`);
      }
    } else out.push("  (music usually sits 6 to 10 dB under the effects that must be heard over it; set that with the volume option of nova.sound.play and nova.music.volume)");
  }
  return out.join("\n");
}

// a dark-to-bright colour ramp for the spectrogram
function heat(t: number): Rgba {
  const stops: [number, number, number][] = [[8, 10, 24], [40, 30, 110], [150, 40, 120], [235, 100, 50], [255, 210, 80], [255, 255, 235]];
  const x = Math.max(0, Math.min(0.9999, t)) * (stops.length - 1);
  const i = Math.floor(x), f = x - i;
  const a = stops[i]!, b = stops[i + 1]!;
  return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f), 255];
}

/// The picture of one sound: its waveform over its spectrogram (time left to right, pitch upward on a log scale from 40 Hz to 16 kHz,
/// brightness the level over a 70 dB range), with the frequencies down the side and the time along the bottom.
export function spectrogram(a: Analysis, width = 720): Raster {
  const left = 46, top = 16, waveH = 56, specH = 240, bottom = 16;
  const w = width - left - 8;
  const out = newRaster(width, top + waveH + 6 + specH + bottom);
  fill(out, 0, 0, out.w, out.h, PAPER);
  label(out, 4, 4, fit(`${a.name}  ${a.seconds.toFixed(2)} s  peak ${fmt(a.peakDb)} dB  ${a.reading[0] ?? ""}`, width - 8), INK, 1, false);
  // waveform: the highest and lowest sample of each column
  fill(out, left, top, w, waveH, [16, 18, 26, 255]);
  const n = a.mono.length;
  for (let x = 0; x < w; x++) {
    const i0 = Math.floor((x * n) / w), i1 = Math.max(i0 + 1, Math.floor(((x + 1) * n) / w));
    let lo = 0, hi = 0;
    for (let i = i0; i < i1 && i < n; i++) {
      lo = Math.min(lo, a.mono[i]!);
      hi = Math.max(hi, a.mono[i]!);
    }
    const y0 = top + waveH / 2 - Math.min(1, hi) * (waveH / 2 - 1), y1 = top + waveH / 2 - Math.max(-1, lo) * (waveH / 2 - 1);
    fill(out, left + x, y0, 1, Math.max(1, y1 - y0), Math.max(Math.abs(lo), Math.abs(hi)) >= 0.999 ? [255, 70, 70, 255] : [110, 200, 255, 255]);
  }
  label(out, 2, top + 2, "+1", DIM, 1, false);
  label(out, 2, top + waveH - 9, "-1", DIM, 1, false);
  // spectrogram
  const sy = top + waveH + 6;
  const { columns, size } = a.stft;
  const binHz = a.rate / size;
  const fLo = 40, fHi = Math.min(16000, a.rate / 2);
  let max = 1e-12;
  for (const c of columns) for (let k = 1; k < c.length; k++) max = Math.max(max, c[k]!);
  for (let x = 0; x < w; x++) {
    const c = columns[Math.min(columns.length - 1, Math.floor((x * columns.length) / w))]!;
    for (let y = 0; y < specH; y++) {
      const f0 = fLo * (fHi / fLo) ** ((specH - 1 - y) / specH), f1 = fLo * (fHi / fLo) ** ((specH - y) / specH);
      const k0 = Math.max(1, Math.floor(f0 / binHz)), k1 = Math.min(c.length - 1, Math.max(k0, Math.ceil(f1 / binHz) - 1));
      let p = 0;
      for (let k = k0; k <= k1; k++) p = Math.max(p, c[k]!);
      const level = 10 * Math.log10(p / max + 1e-12); // 0 dB is the loudest point
      fill(out, left + x, sy + y, 1, 1, heat((level + 70) / 70));
    }
  }
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
    if (f > fHi) continue;
    const y = sy + specH - 1 - (Math.log(f / fLo) / Math.log(fHi / fLo)) * specH;
    fill(out, left - 4, y, 4, 1, DIM);
    fill(out, left, y, w, 1, [255, 255, 255, 22]);
    label(out, 2, y - 3, f >= 1000 ? `${f / 1000}k` : String(f), DIM, 1, false);
  }
  const tick = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 30, 60].find((t) => a.seconds / t <= 10) ?? 120;
  for (let t = 0; t <= a.seconds + 1e-9; t += tick) {
    const x = left + (t / Math.max(1e-9, a.seconds)) * w;
    fill(out, x, sy + specH, 1, 4, DIM);
    label(out, Math.min(out.w - 30, x + 2), sy + specH + 5, `${Number(t.toFixed(2))}s`, DIM, 1, false);
  }
  return out;
}

/// Pictures stacked into one.
export function stack(pictures: Raster[]): Raster {
  const out = newRaster(Math.max(...pictures.map((p) => p.w)), pictures.reduce((s, p) => s + p.h, 0));
  fill(out, 0, 0, out.w, out.h, PAPER);
  let y = 0;
  for (const p of pictures) {
    for (let row = 0; row < p.h; row++) out.data.set(p.data.subarray(row * p.w * 4, (row + 1) * p.w * 4), ((y + row) * out.w) * 4);
    y += p.h;
  }
  return out;
}
