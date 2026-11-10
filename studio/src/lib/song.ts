// The music editor's data and sound: a step sequencer of tracks with simple synth instruments and a
// small drum kit. A song is saved as `music/<name>.song.json`; `renderSong` plays it offline into the
// WAV the game loads (`nova.music.play("name")`). The render wraps the last notes' tails onto the
// start, so a looping song has no gap or click at the seam.
//
// A plain track is the classic chip voice (one oscillator and an envelope). The optional "voice" fields give a track
// a fuller sound: `unison` voices spread by `detune` cents (a thick, wide saw or pad), a `cutoff` low-pass filter that
// opens with the note's envelope (`sweep`) for plucks and bass, a `sub` octave, `vibrato`, and a `reverb` send into the
// song's room. Drum tracks can use the `studio` kit (a kick with a click, a snare with a body, metallic hats) instead of
// the `chip` one. A song with none of these renders exactly as before.

import { mulberry32 } from "./sfx";
import { compileFormula } from "./formula";
import { applyAutomation } from "./song-lanes";
import { applyFx, cleanFx, type Fx } from "./fx";
import { integratedLufs, limitPeaks } from "./loudness";
import type { Sound } from "./wav";

export type Wave = "square" | "saw" | "triangle" | "sine" | "noise" | "fm" | "pluck" | "organ" | "wavetable" | "formula" | "sample";
export const WAVES: Wave[] = ["square", "saw", "triangle", "sine", "noise", "fm", "pluck", "organ", "wavetable", "formula", "sample"];
/// The waves that are whole instruments (their own settings; the fuller voice's unison, filter and vibrato do not apply to them).
export const INSTRUMENT_WAVES: Wave[] = ["fm", "pluck", "organ", "wavetable", "formula", "sample"];

// ---- the sampler ----
/// The sound files the "sample" instrument can play, by project path (`sounds/kick.wav`). The editor loads the files a song names and puts them here before it renders;
/// the renderer itself reads no files, so rendering stays pure and repeatable for a given bank.
const sampleBank = new Map<string, Sound>();
export const setSample = (path: string, sound: Sound | null) => (sound ? void sampleBank.set(path, sound) : void sampleBank.delete(path));
export const hasSample = (path: string) => sampleBank.has(path);

/// The file a "samples" kit plays for a drum pitch, as one channel at the render rate (an empty array when the drum has no file or it is not loaded).
function padHit(track: Track, pitch: number, rate: number): Float32Array {
  const snd = sampleBank.get(track.pads?.[String(pitch)] ?? "");
  if (!snd || !snd.channels[0]) return new Float32Array(0);
  const src = snd.channels[0].length;
  const out = new Float32Array(Math.max(0, Math.floor((src * rate) / snd.rate)));
  for (let i = 0; i < out.length; i++) {
    const at = (i * snd.rate) / rate;
    const j = Math.floor(at);
    const f = at - j;
    const a = snd.channels.length > 1 ? (snd.channels[0]![j]! + (snd.channels[1]![j] ?? 0)) / 2 : snd.channels[0]![j]!;
    const b2 = j + 1 < src ? (snd.channels.length > 1 ? (snd.channels[0]![j + 1]! + (snd.channels[1]![j + 1] ?? 0)) / 2 : snd.channels[0]![j + 1]!) : a;
    out[i] = a + (b2 - a) * f;
  }
  return out;
}
export const isInstrument = (w: Wave) => INSTRUMENT_WAVES.includes(w);

export interface Note {
  /// First step (0-based) and length in steps.
  step: number;
  len: number;
  /// MIDI pitch (60 = middle C); for drum tracks it picks the drum.
  pitch: number;
  /// Loudness 0 to 1.
  vel: number;
  /// Where this note sits in the stereo field, added to the track's pan (-1 to 1; none: the track's own).
  pan?: number;
  /// A pitch glide in semitones (-12 to 12): the note starts at its pitch and slides this far by its end. Not for drums or the plucked string.
  bend?: number;
}

export interface Track {
  name: string;
  kind: "synth" | "drums";
  wave: Wave;
  duty: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  volume: number;
  pan: number;
  mute: boolean;
  /// While any track is soloed only the soloed tracks are heard (a muted track stays silent).
  solo?: boolean;
  notes: Note[];
  /// Voice fields (all optional; leave them out for the plain chip voice).
  /// Oscillators per note (1 to 7) and how far they are spread, in cents either way.
  unison?: number;
  detune?: number;
  /// Low-pass filter in Hz (0 or missing: none), its resonance (0 to 0.9), and how far the note's envelope opens it (0 to 1: up to three octaves).
  cutoff?: number;
  resonance?: number;
  sweep?: number;
  /// Level (0 to 1) of a sine one octave below.
  sub?: number;
  /// Vibrato depth in semitones (0 to 0.5).
  vibrato?: number;
  /// How much of the track goes to the song's reverb (0 to 1).
  reverb?: number;
  /// An echo on the track: how loud it is (0 to 1), how far apart the repeats are in steps (1 to 16), and how much of each repeat comes back (0 to 0.85).
  echo?: number;
  echoTime?: number;
  echoFeedback?: number;
  /// Drum tracks: "chip" (the original) or "studio".
  kit?: "chip" | "studio" | "samples";
  /// The "samples" kit: which sound file each drum plays, by the drum's pitch number as text (`"36": "sounds/kick.wav"`). A drum with no file is silent.
  pads?: Record<string, string>;
  /// The "fm" instrument: the modulator's pitch as a multiple of the note (0.25 to 8) and how strongly it bends the tone (0 to 12; it fades as the note rings).
  fmRatio?: number;
  fmIndex?: number;
  /// The "pluck" instrument: how long the string rings (0 short to 1 long).
  damping?: number;
  /// The "sample" instrument: a sound file of the project (`sounds/kick.wav`) played at the pitch of the note, taking `root` (a MIDI pitch, 60 by default) as the pitch the file has.
  sample?: string;
  root?: number;
  /// The "wavetable" instrument: where in the table of shapes it plays, 0 (sine) through triangle and saw (a third and two thirds) to 1 (square).
  wtPos?: number;
  /// The "formula" instrument: an expression of the phase `p`, the time `t` and the pitch `f` (lib/formula.ts).
  formula?: string;
  /// The "pluck" and "organ" instruments: how bright it is (0 dull to 1 bright).
  brightness?: number;
  /// A lane that changes how loud the notes are over the song: the gain (0 to 2) at each note's start follows these points (lib/song-tools.ts).
  automation?: Lane[];
  /// Effects on the track, run in order after its volume and pan (lib/fx.ts).
  fx?: Fx[];
  /// A colour for the track in the list and the mixer (`#rrggbb`); it does not change the sound.
  color?: string;
  /// The bus this track plays into (a name from the song's `buses`); none: straight to the master.
  bus?: string;
  /// Extra copies of the track's sound sent to buses (after its volume, pan and effects): the bus's name and how much (0 to 1).
  sends?: { bus: string; level: number }[];
  /// The arrangement: named patterns of notes, and clips that place a pattern on the track's timeline. A clip's notes play in addition to `notes`.
  patterns?: Pattern[];
  clips?: Clip[];
}

/// A short run of notes kept under a name (`length` steps; note steps count from its start) so it can be placed again and again.
export interface Pattern {
  name: string;
  length: number;
  notes: Note[];
}

/// A pattern placed on a track from `step`, filling `len` steps (it repeats to fill them, starting `offset` steps into the pattern).
export interface Clip {
  pattern: string;
  step: number;
  len: number;
  offset?: number;
  mute?: boolean;
  color?: string;
}

/// A bus: tracks are routed (or sent) into it, it has its own effects, volume and pan, and it plays into the master. Buses do not feed each other.
export interface Bus {
  name: string;
  volume: number;
  /// Balance, -1 (left) to 1 (right).
  pan: number;
  mute: boolean;
  /// How much of the bus goes to the song's reverb (0 to 1).
  reverb?: number;
  fx?: Fx[];
  color?: string;
}

/// The master section: the fader, an optional loudness target in LUFS (-30 to -6: quiet songs are lifted, loud ones lowered) and an optional peak
/// ceiling in dB (-12 to 0: a limiter keeps the loudest moments under it without clipping). A song with neither renders as before.
export interface SongMaster {
  volume: number;
  /// Effects on the whole mix, run after the buses and the room and before the master fader (lib/fx.ts).
  fx?: Fx[];
  lufs?: number;
  limit?: number;
}

/// One automation lane, read at each note's first step. "gain" (0 to 2) multiplies the note's loudness; "pan" (-1 to 1) is added to the note's place in the stereo field.
export type LaneParam = "gain" | "pan";
export const LANE_RANGE: Record<LaneParam, [number, number]> = { gain: [0, 2], pan: [-1, 1] };
export interface Lane {
  param: LaneParam;
  curve: "linear" | "step" | "smooth";
  points: { step: number; value: number }[];
}

export interface TempoChange {
  step: number;
  bpm: number;
  /// Glide: the tempo moves in a straight line from the one before (at the previous change, or the song's start) to this `bpm`, arriving at `step`, instead of jumping there.
  ramp?: boolean;
}

export interface MeterChange {
  step: number;
  beats: number;
}

/// A named place in the song (a verse, a drop); the loop region is where the game's loop runs.
export interface Marker {
  step: number;
  name: string;
}

/// The song's room: how long it rings (0 to 1), how dull the tail is (0 to 1) and how loud the reverb is overall.
export interface Room {
  size: number;
  damping: number;
  mix: number;
}

export interface Song {
  version: 1;
  bpm: number;
  stepsPerBeat: number;
  /// Total steps; a bar is `stepsPerBeat * 4`.
  length: number;
  tracks: Track[];
  room?: Room;
  /// The master fader: 1 is as the tracks add up, up to 1.5. A song with none renders as before.
  master?: SongMaster;
  /// Beats in a bar (1 to 16; 4 when missing), which sets where the bar lines fall; it does not change the sound.
  beatsPerBar?: number;
  markers?: Marker[];
  buses?: Bus[];
  /// The tempo track: from each step on the song plays at that tempo (`bpm` holds until the first). Steps are 1 or more, rising, inside the song.
  tempos?: TempoChange[];
  /// Time signature changes: from each step a bar is that many beats (`beatsPerBar` holds until the first); a new bar starts at the step. Drawing only.
  meters?: MeterChange[];
  /// The part of the song that loops in the game: exporting "the loop" renders just these steps (from, up to but not including to).
  loop?: { from: number; to: number };
}

export const MIN_BPM = 40;
export const MAX_BPM = 240;
export const MAX_STEPS = 1024;
export const MAX_TRACKS = 16;
export const MAX_BUSES = 8;
export const MAX_TEMPOS = 64;
export const MAX_METERS = 32;
export const MAX_SENDS = 4;
export const MAX_PATTERNS = 32;
export const MAX_CLIPS = 128;
export const MAX_MASTER = 1.5;
export const MAX_NOTES = 4000;
export const RATE = 44100;

export const DRUMS: { pitch: number; name: string }[] = [
  { pitch: 49, name: "Crash" },
  { pitch: 46, name: "Open hat" },
  { pitch: 42, name: "Hat" },
  { pitch: 45, name: "Tom" },
  { pitch: 39, name: "Clap" },
  { pitch: 38, name: "Snare" },
  { pitch: 36, name: "Kick" },
];

export const synthTrack = (name: string, wave: Wave = "square"): Track => ({
  name, kind: "synth", wave, duty: 0.5, attack: 0.01, decay: 0.1, sustain: 0.6, release: 0.12, volume: 0.5, pan: 0, mute: false, notes: [],
});
export const drumTrack = (name = "drums"): Track => ({ ...synthTrack(name, "noise"), kind: "drums", volume: 0.7 });

export function newSong(): Song {
  const lead = synthTrack("lead");
  lead.notes = [60, 64, 67, 72].map((pitch, i) => ({ step: i * 4, len: 3, pitch, vel: 0.8 }));
  const drums = drumTrack();
  drums.notes = [0, 4, 8, 12].map((step) => ({ step, len: 1, pitch: 36, vel: 0.9 })).concat([4, 12].map((step) => ({ step, len: 1, pitch: 38, vel: 0.8 })));
  return { version: 1, bpm: 120, stepsPerBeat: 4, length: 16, tracks: [lead, drums] };
}

export const stepSeconds = (s: Song) => 60 / s.bpm / s.stepsPerBeat;
/// The tempo in force at a step.
export function bpmAt(song: Song, step: number): number {
  const seg = tempoSegments(song).find((g) => step < g.to) ?? tempoSegments(song).at(-1)!;
  if (!seg.glide || step <= seg.from) return step >= seg.to ? seg.b2 : seg.b1;
  return seg.b1 + ((seg.b2 - seg.b1) * (step - seg.from)) / (seg.to - seg.from);
}

/// The tempo track as stretches of the song: each runs from a step to the next change; a stretch that glides goes from `b1` to `b2` in a straight line over it, the others
/// hold `b1` (and the song's last stretch holds its tempo to the end).
export interface TempoSegment {
  from: number;
  to: number;
  b1: number;
  b2: number;
  glide: boolean;
}
export function tempoSegments(song: Song): TempoSegment[] {
  const out: TempoSegment[] = [];
  let from = 0;
  let bpm = song.bpm;
  for (const t of song.tempos ?? []) {
    out.push({ from, to: t.step, b1: bpm, b2: t.ramp ? t.bpm : bpm, glide: !!t.ramp && t.bpm !== bpm });
    from = t.step;
    bpm = t.bpm;
  }
  out.push({ from, to: Infinity, b1: bpm, b2: bpm, glide: false });
  return out;
}

/// Seconds from the start of the song to a step (it may be fractional), following the tempo track.
export function stepTime(song: Song, step: number): number {
  if (!song.tempos?.length) return step * stepSeconds(song);
  const unit = 60 / song.stepsPerBeat; // seconds a step takes is unit / bpm
  let sec = 0;
  for (const g of tempoSegments(song)) {
    const x = Math.min(step, g.to);
    if (x <= g.from) break;
    if (!g.glide) sec += ((x - g.from) * unit) / g.b1;
    else {
      const k = (g.b2 - g.b1) / (g.to - g.from);
      sec += (unit * Math.log((g.b1 + k * (x - g.from)) / g.b1)) / k;
    }
    if (step <= g.to) break;
  }
  return sec;
}

/// The step that plays at a time in seconds (the inverse of `stepTime`).
export function stepAtTime(song: Song, seconds: number): number {
  if (!song.tempos?.length) return seconds / stepSeconds(song);
  const unit = 60 / song.stepsPerBeat;
  let start = 0;
  for (const g of tempoSegments(song)) {
    const length = g.glide ? (unit * Math.log(g.b2 / g.b1)) / ((g.b2 - g.b1) / (g.to - g.from)) : ((g.to - g.from) * unit) / g.b1;
    if (seconds < start + length || g.to === Infinity) {
      const t = seconds - start;
      if (!g.glide) return g.from + (t * g.b1) / unit;
      const k = (g.b2 - g.b1) / (g.to - g.from);
      return g.from + (g.b1 * (Math.exp((k * t) / unit) - 1)) / k;
    }
    start += length;
  }
  return seconds / stepSeconds(song);
}

export const songSeconds = (s: Song) => stepTime(s, s.length);

/// The steps where a bar starts (0 first), following the time signature changes; the last bar may be cut by the end of the song.
export function barStarts(song: Song): number[] {
  const out: number[] = [];
  const changes = [...(song.meters ?? [])];
  let beats = song.beatsPerBar ?? 4;
  let step = 0;
  while (step < song.length) {
    out.push(step);
    const next = step + beats * song.stepsPerBeat;
    const change = changes.find((c) => c.step > step && c.step < next);
    if (change) {
      step = change.step;
      beats = change.beats;
    } else {
      step = next;
      const here = changes.find((c) => c.step === step);
      if (here) beats = here.beats;
    }
  }
  return out;
}
export const barSteps = (s: Song) => s.stepsPerBeat * (s.beatsPerBar ?? 4);
export const midiFreq = (pitch: number) => 440 * 2 ** ((pitch - 69) / 12);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// ---- files --------------------------------------------------------------------------------------------

/// The voice fields' names and ranges.
const VOICE_RANGES: [keyof Track, number, number][] = [
  ["unison", 1, 7], ["detune", 0, 60], ["cutoff", 0, 20000], ["resonance", 0, 0.9], ["sweep", 0, 1], ["sub", 0, 1], ["vibrato", 0, 0.5], ["reverb", 0, 1], ["echo", 0, 1], ["echoTime", 1, 16], ["echoFeedback", 0, 0.85],
  ["fmRatio", 0.25, 8], ["fmIndex", 0, 12], ["damping", 0, 1], ["brightness", 0, 1], ["wtPos", 0, 1], ["root", 0, 127],
];

export type Parsed = { ok: true; song: Song } | { ok: false; error: string };

export function parseSong(text: string): Parsed {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `not valid JSON: ${e instanceof Error ? e.message : e}` };
  }
  const o = v as Partial<Song>;
  if (!o || typeof o !== "object" || !Array.isArray(o.tracks)) return { ok: false, error: 'a song file has a "tracks" list' };
  const num = (n: unknown, lo: number, hi: number) => typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi;
  if (!num(o.bpm, MIN_BPM, MAX_BPM)) return { ok: false, error: `"bpm" must be from ${MIN_BPM} to ${MAX_BPM}` };
  if (!num(o.stepsPerBeat, 1, 8) || !Number.isInteger(o.stepsPerBeat)) return { ok: false, error: '"stepsPerBeat" must be a whole number from 1 to 8' };
  if (!num(o.length, 1, MAX_STEPS) || !Number.isInteger(o.length)) return { ok: false, error: `"length" must be a whole number of steps up to ${MAX_STEPS}` };
  if (o.tracks.length > MAX_TRACKS) return { ok: false, error: `more than ${MAX_TRACKS} tracks` };
  let notes = 0;
  const tracks: Track[] = [];
  for (const [i, raw] of o.tracks.entries()) {
    const t = raw as Partial<Track>;
    const at = `tracks[${i}]`;
    if (!t || typeof t.name !== "string") return { ok: false, error: `${at} needs a name` };
    if (t.kind !== "synth" && t.kind !== "drums") return { ok: false, error: `${at}.kind must be "synth" or "drums"` };
    if (!WAVES.includes(t.wave as Wave)) return { ok: false, error: `${at}.wave must be one of ${WAVES.join(", ")}` };
    if (!Array.isArray(t.notes)) return { ok: false, error: `${at} needs a "notes" list` };
    notes += t.notes.length;
    if (notes > MAX_NOTES) return { ok: false, error: `more than ${MAX_NOTES} notes` };
    for (const [j, n] of t.notes.entries()) {
      if (!n || !Number.isInteger(n.step) || n.step < 0 || !Number.isInteger(n.len) || n.len < 1 || !num(n.pitch, 0, 127) || !num(n.vel, 0, 1)) {
        return { ok: false, error: `${at}.notes[${j}] needs whole "step" and "len" (1 or more), "pitch" 0 to 127 and "vel" 0 to 1` };
      }
      if ((n.pan !== undefined && !num(n.pan, -1, 1)) || (n.bend !== undefined && !num(n.bend, -12, 12))) return { ok: false, error: `${at}.notes[${j}]: "pan" is -1 to 1 and "bend" is -12 to 12 semitones` };
    }
    const base = t.kind === "drums" ? drumTrack(t.name) : synthTrack(t.name);
    const voice: Partial<Track> = {};
    for (const [key, lo, hi] of VOICE_RANGES) {
      const v = (t as Record<string, unknown>)[key];
      if (v === undefined) continue;
      if (typeof v !== "number" || !Number.isFinite(v)) return { ok: false, error: `${at}.${key} must be a number` };
      (voice as Record<string, number>)[key] = clamp(v, lo, hi);
    }
    if (t.kit !== undefined) {
      if (t.kit !== "chip" && t.kit !== "studio" && t.kit !== "samples") return { ok: false, error: `${at}.kit must be "chip", "studio" or "samples"` };
      voice.kit = t.kit;
    }
    if (t.color !== undefined) {
      if (typeof t.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(t.color)) return { ok: false, error: `${at}.color must be like "#5aa9ff"` };
      voice.color = t.color.toLowerCase();
    }
    if (t.patterns !== undefined || t.clips !== undefined) {
      const pats = t.patterns ?? [];
      const clips = t.clips ?? [];
      if (!Array.isArray(pats) || pats.length > MAX_PATTERNS || !Array.isArray(clips) || clips.length > MAX_CLIPS) return { ok: false, error: `${at}: up to ${MAX_PATTERNS} "patterns" and ${MAX_CLIPS} "clips"` };
      const cleanPats: Pattern[] = [];
      for (const [pi, pat] of pats.entries()) {
        const where = `${at}.patterns[${pi}]`;
        if (!pat || typeof pat.name !== "string" || !pat.name.trim() || cleanPats.some((q) => q.name === pat.name)) return { ok: false, error: `${where} needs its own name` };
        if (!Number.isInteger(pat.length) || !num(pat.length, 1, MAX_STEPS) || !Array.isArray(pat.notes)) return { ok: false, error: `${where} needs a whole "length" and a "notes" list` };
        notes += pat.notes.length;
        if (notes > MAX_NOTES) return { ok: false, error: `more than ${MAX_NOTES} notes` };
        for (const [j, n] of pat.notes.entries()) {
          if (!n || !Number.isInteger(n.step) || n.step < 0 || n.step >= pat.length || !Number.isInteger(n.len) || n.len < 1 || !num(n.pitch, 0, 127) || !num(n.vel, 0, 1)) return { ok: false, error: `${where}.notes[${j}] needs a "step" inside the pattern, "len", "pitch" and "vel"` };
        }
        cleanPats.push({ name: pat.name, length: pat.length, notes: pat.notes.map((n) => ({ ...n })) });
      }
      const cleanClips: Clip[] = [];
      for (const [ci, c] of clips.entries()) {
        const where = `${at}.clips[${ci}]`;
        if (!c || !cleanPats.some((q) => q.name === c.pattern)) return { ok: false, error: `${where}.pattern must be one of the track's patterns` };
        if (!Number.isInteger(c.step) || c.step < 0 || !Number.isInteger(c.len) || c.len < 1 || (c.offset !== undefined && (!Number.isInteger(c.offset) || c.offset < 0))) return { ok: false, error: `${where} needs whole "step" (0 or more) and "len" (1 or more)` };
        if (c.color !== undefined && (typeof c.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(c.color))) return { ok: false, error: `${where}.color must be like "#5aa9ff"` };
        cleanClips.push({ pattern: c.pattern, step: c.step, len: c.len, ...(c.offset ? { offset: c.offset } : {}), ...(c.mute ? { mute: true } : {}), ...(c.color ? { color: c.color.toLowerCase() } : {}) });
      }
      cleanClips.sort((a, b) => a.step - b.step);
      if (cleanPats.length) voice.patterns = cleanPats;
      else delete (t as Partial<Track>).patterns;
      if (cleanClips.length) voice.clips = cleanClips;
      else delete (t as Partial<Track>).clips;
    }
    if (t.pads !== undefined) {
      const ok = (x: unknown) => typeof x === "string" && /^[\w\-./ ]{1,120}$/.test(x) && !x.includes("..") && !x.startsWith("/");
      const entries = t.pads && typeof t.pads === "object" && !Array.isArray(t.pads) ? Object.entries(t.pads) : null;
      if (!entries || entries.length > 32 || !entries.every(([k, v]) => /^\d{1,3}$/.test(k) && Number(k) <= 127 && ok(v))) return { ok: false, error: `${at}.pads maps drum pitches to sound files inside the project, like { "36": "sounds/kick.wav" }` };
      if (entries.length) voice.pads = Object.fromEntries(entries);
    }
    if (t.sample !== undefined) {
      if (typeof t.sample !== "string" || !/^[\w\-./ ]{1,120}$/.test(t.sample) || t.sample.includes("..") || t.sample.startsWith("/")) return { ok: false, error: `${at}.sample must be a path inside the project, like "sounds/kick.wav"` };
      voice.sample = t.sample;
    }
    if (t.formula !== undefined) {
      if (typeof t.formula !== "string") return { ok: false, error: `${at}.formula must be text` };
      const c = compileFormula(t.formula);
      if (!c.ok) return { ok: false, error: `${at}.formula: ${c.error}` };
      voice.formula = t.formula;
    }
    if (t.bus !== undefined && typeof t.bus !== "string") return { ok: false, error: `${at}.bus must be a bus name` };
    if (t.sends !== undefined) {
      if (!Array.isArray(t.sends) || t.sends.length > MAX_SENDS || !t.sends.every((x) => x && typeof x.bus === "string" && num(x.level, 0, 1))) return { ok: false, error: `${at}.sends is up to ${MAX_SENDS} of { "bus": name, "level": 0 to 1 }` };
      if (t.sends.length) voice.sends = t.sends.map((x) => ({ bus: x.bus, level: x.level }));
      else delete (t as Partial<Track>).sends;
    }
    if (t.fx !== undefined) {
      const c = cleanFx(t.fx);
      if (!c.ok) return { ok: false, error: `${at}.${c.error}` };
      if (c.chain.length) voice.fx = c.chain;
      else delete (t as Partial<Track>).fx;
    }
    if (t.automation !== undefined) {
      if (!Array.isArray(t.automation) || t.automation.length > 4) return { ok: false, error: `${at}.automation is a list of up to 4 lanes` };
      const lanes: Lane[] = [];
      for (const [li, lane] of t.automation.entries()) {
        const where = `${at}.automation[${li}]`;
        if (!lane || (lane.param !== "gain" && lane.param !== "pan")) return { ok: false, error: `${where}.param must be "gain" or "pan"` };
        if (t.automation.slice(0, li).some((q) => q.param === lane.param)) return { ok: false, error: `${where}: there is already a "${lane.param}" lane on this track` };
        const [lowest, highest] = LANE_RANGE[lane.param];
        if (!["linear", "step", "smooth"].includes(lane.curve)) return { ok: false, error: `${where}.curve must be "linear", "step" or "smooth"` };
        if (!Array.isArray(lane.points) || lane.points.length > 256 || !lane.points.every((pt) => pt && Number.isInteger(pt.step) && pt.step >= 0 && num(pt.value, lowest, highest))) return { ok: false, error: `${where}.points are up to 256 { "step": whole, "value": ${lowest} to ${highest} }` };
        lanes.push({ param: lane.param, curve: lane.curve, points: [...lane.points].sort((a, b) => a.step - b.step).map((pt) => ({ step: pt.step, value: pt.value })) });
      }
      if (lanes.length) voice.automation = lanes;
      else delete (t as Partial<Track>).automation;
    }
    tracks.push({ ...base, ...t, ...voice, duty: clamp(t.duty ?? base.duty, 0.05, 0.95), volume: clamp(t.volume ?? base.volume, 0, 1), pan: clamp(t.pan ?? 0, -1, 1), mute: !!t.mute, ...(t.solo ? { solo: true } : {}) } as Track);
  }
  let room: Room | undefined;
  if (o.room !== undefined) {
    const r = o.room as Partial<Room>;
    if (!r || typeof r !== "object" || !num(r.size ?? 0.5, 0, 1) || !num(r.damping ?? 0.4, 0, 1) || !num(r.mix ?? 1, 0, 2)) return { ok: false, error: '"room" is { "size": 0 to 1, "damping": 0 to 1, "mix": 0 to 2 }' };
    room = { size: r.size ?? 0.5, damping: r.damping ?? 0.4, mix: r.mix ?? 1 };
  }
  let master: SongMaster | undefined;
  if (o.master !== undefined) {
    const m = o.master as { volume?: unknown; lufs?: unknown; limit?: unknown; fx?: unknown };
    if (!m || typeof m !== "object" || !num(m.volume ?? 1, 0, MAX_MASTER)) return { ok: false, error: `"master" is { "volume": 0 to ${MAX_MASTER} }` };
    if (m.lufs !== undefined && !num(m.lufs, -30, -6)) return { ok: false, error: '"master.lufs" must be from -30 to -6' };
    if (m.limit !== undefined && !num(m.limit, -12, 0)) return { ok: false, error: '"master.limit" must be from -12 to 0 (dB)' };
    let masterFx: Fx[] | undefined;
    if (m.fx !== undefined) {
      const c = cleanFx(m.fx);
      if (!c.ok) return { ok: false, error: `master.${c.error}` };
      if (c.chain.length) masterFx = c.chain;
    }
    master = { volume: (m.volume as number | undefined) ?? 1, ...(masterFx ? { fx: masterFx } : {}), ...(m.lufs !== undefined ? { lufs: m.lufs as number } : {}), ...(m.limit !== undefined ? { limit: m.limit as number } : {}) };
  }
  let buses: Bus[] | undefined;
  if (o.buses !== undefined) {
    if (!Array.isArray(o.buses) || o.buses.length > MAX_BUSES) return { ok: false, error: `"buses" is a list of up to ${MAX_BUSES}` };
    buses = [];
    for (const [i, raw] of (o.buses as Partial<Bus>[]).entries()) {
      const at = `buses[${i}]`;
      if (!raw || typeof raw.name !== "string" || !raw.name.trim()) return { ok: false, error: `${at} needs a name` };
      if (buses.some((b) => b.name === raw.name)) return { ok: false, error: `${at}: two buses are called "${raw.name}"` };
      if (!num(raw.volume ?? 1, 0, MAX_MASTER) || !num(raw.pan ?? 0, -1, 1) || !num(raw.reverb ?? 0, 0, 1)) return { ok: false, error: `${at}: "volume" is 0 to ${MAX_MASTER}, "pan" -1 to 1, "reverb" 0 to 1` };
      if (raw.color !== undefined && (typeof raw.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(raw.color))) return { ok: false, error: `${at}.color must be like "#5aa9ff"` };
      const bus: Bus = { name: raw.name, volume: raw.volume ?? 1, pan: raw.pan ?? 0, mute: !!raw.mute };
      if (raw.reverb) bus.reverb = raw.reverb;
      if (raw.color) bus.color = raw.color.toLowerCase();
      if (raw.fx !== undefined) {
        const c = cleanFx(raw.fx);
        if (!c.ok) return { ok: false, error: `${at}.${c.error}` };
        if (c.chain.length) bus.fx = c.chain;
      }
      buses.push(bus);
    }
  }
  for (const [i, t] of tracks.entries()) {
    const known = (name: string) => !!buses?.some((b) => b.name === name);
    if (t.bus !== undefined && !known(t.bus)) return { ok: false, error: `tracks[${i}].bus "${t.bus}" is not one of the song's buses` };
    for (const s of t.sends ?? []) if (!known(s.bus)) return { ok: false, error: `tracks[${i}].sends: "${s.bus}" is not one of the song's buses` };
  }
  let tempos: TempoChange[] | undefined;
  if (o.tempos !== undefined) {
    if (!Array.isArray(o.tempos) || o.tempos.length > MAX_TEMPOS) return { ok: false, error: `"tempos" is a list of up to ${MAX_TEMPOS} { "step", "bpm" }` };
    let last = 0;
    for (const [i, tc] of (o.tempos as TempoChange[]).entries()) {
      if (!tc || !Number.isInteger(tc.step) || tc.step <= last || tc.step >= o.length! || !num(tc.bpm, MIN_BPM, MAX_BPM)) return { ok: false, error: `tempos[${i}] needs a whole "step" after the one before it (and inside the song) and a "bpm" from ${MIN_BPM} to ${MAX_BPM}` };
      last = tc.step;
    }
    tempos = (o.tempos as TempoChange[]).map((tc) => ({ step: tc.step, bpm: tc.bpm, ...(tc.ramp === true ? { ramp: true } : {}) }));
  }
  let meters: MeterChange[] | undefined;
  if (o.meters !== undefined) {
    if (!Array.isArray(o.meters) || o.meters.length > MAX_METERS) return { ok: false, error: `"meters" is a list of up to ${MAX_METERS} { "step", "beats" }` };
    let last = 0;
    for (const [i, mc] of (o.meters as MeterChange[]).entries()) {
      if (!mc || !Number.isInteger(mc.step) || mc.step <= last || mc.step >= o.length! || !Number.isInteger(mc.beats) || !num(mc.beats, 1, 16)) return { ok: false, error: `meters[${i}] needs a whole "step" after the one before it (and inside the song) and "beats" 1 to 16` };
      last = mc.step;
    }
    meters = (o.meters as MeterChange[]).map((mc) => ({ step: mc.step, beats: mc.beats }));
  }
  if (o.beatsPerBar !== undefined && (!Number.isInteger(o.beatsPerBar) || !num(o.beatsPerBar, 1, 16))) return { ok: false, error: '"beatsPerBar" must be a whole number from 1 to 16' };
  let markers: Marker[] | undefined;
  if (o.markers !== undefined) {
    if (!Array.isArray(o.markers) || o.markers.length > 64) return { ok: false, error: '"markers" is a list of up to 64 { "step", "name" }' };
    for (const [i, mk] of (o.markers as Marker[]).entries()) {
      if (!mk || !Number.isInteger(mk.step) || mk.step < 0 || mk.step > o.length! || typeof mk.name !== "string") return { ok: false, error: `markers[${i}] needs a whole "step" inside the song and a "name"` };
    }
    markers = [...(o.markers as Marker[])].sort((a, b) => a.step - b.step).map((mk) => ({ step: mk.step, name: mk.name }));
  }
  let loop: Song["loop"];
  if (o.loop !== undefined) {
    const l = o.loop as { from?: unknown; to?: unknown };
    if (!l || !Number.isInteger(l.from) || !Number.isInteger(l.to) || (l.from as number) < 0 || (l.to as number) > o.length! || (l.from as number) >= (l.to as number)) return { ok: false, error: '"loop" is { "from", "to" } in steps, from before to and inside the song' };
    loop = { from: l.from as number, to: l.to as number };
  }
  return { ok: true, song: { version: 1, bpm: o.bpm!, stepsPerBeat: o.stepsPerBeat!, length: o.length!, tracks, ...(room ? { room } : {}), ...(master ? { master } : {}), ...(o.beatsPerBar !== undefined && o.beatsPerBar !== 4 ? { beatsPerBar: o.beatsPerBar } : {}), ...(markers?.length ? { markers } : {}), ...(buses?.length ? { buses } : {}), ...(tempos?.length ? { tempos } : {}), ...(meters?.length ? { meters } : {}), ...(loop ? { loop } : {}) } };
}

export function serializeSong(song: Song): string {
  const note = (n: Note) => `{ "step": ${n.step}, "len": ${n.len}, "pitch": ${n.pitch}, "vel": ${+n.vel.toFixed(2)}${n.pan ? `, "pan": ${+n.pan.toFixed(2)}` : ""}${n.bend ? `, "bend": ${+n.bend.toFixed(2)}` : ""} }`;
  const track = (t: Track) => {
    const fields = [
      `"name": ${JSON.stringify(t.name)}`, `"kind": "${t.kind}"`, `"wave": "${t.wave}"`, `"duty": ${t.duty}`,
      `"attack": ${t.attack}`, `"decay": ${t.decay}`, `"sustain": ${t.sustain}`, `"release": ${t.release}`,
      `"volume": ${t.volume}`, `"pan": ${t.pan}`, `"mute": ${t.mute}`,
    ];
    if (t.solo) fields.push(`"solo": true`);
    for (const [key] of VOICE_RANGES) if (t[key] !== undefined) fields.push(`"${key}": ${t[key]}`);
    if (t.kit !== undefined) fields.push(`"kit": "${t.kit}"`);
    if (t.color) fields.push(`"color": ${JSON.stringify(t.color)}`);
    if (t.patterns?.length) fields.push(`"patterns": ${JSON.stringify(t.patterns)}`);
    if (t.clips?.length) fields.push(`"clips": ${JSON.stringify(t.clips)}`);
    if (t.pads && Object.keys(t.pads).length) fields.push(`"pads": ${JSON.stringify(t.pads)}`);
    if (t.sample) fields.push(`"sample": ${JSON.stringify(t.sample)}`);
    if (t.formula) fields.push(`"formula": ${JSON.stringify(t.formula)}`);
    if (t.bus) fields.push(`"bus": ${JSON.stringify(t.bus)}`);
    if (t.sends?.length) fields.push(`"sends": ${JSON.stringify(t.sends)}`);
    if (t.fx?.length) fields.push(`"fx": ${JSON.stringify(t.fx)}`);
    if (t.automation?.length) fields.push(`"automation": ${JSON.stringify(t.automation)}`);
    const notes = t.notes.length ? `[\n${t.notes.map((n) => `        ${note(n)}`).join(",\n")}\n      ]` : "[]";
    return `    {\n${fields.map((f) => `      ${f}`).join(",\n")},\n      "notes": ${notes}\n    }`;
  };
  const room = song.room ? `,\n  "room": { "size": ${song.room.size}, "damping": ${song.room.damping}, "mix": ${song.room.mix} }` : "";
  const master = song.master ? `,\n  "master": { "volume": ${song.master.volume}${song.master.fx?.length ? `, "fx": ${JSON.stringify(song.master.fx)}` : ""}${song.master.lufs !== undefined ? `, "lufs": ${song.master.lufs}` : ""}${song.master.limit !== undefined ? `, "limit": ${song.master.limit}` : ""} }` : "";
  const bar = song.beatsPerBar && song.beatsPerBar !== 4 ? `,\n  "beatsPerBar": ${song.beatsPerBar}` : "";
  const markers = song.markers?.length ? `,\n  "markers": ${JSON.stringify(song.markers)}` : "";
  const buses = song.buses?.length ? `,\n  "buses": [\n${song.buses.map((b) => `    ${JSON.stringify(b)}`).join(",\n")}\n  ]` : "";
  const tempos = song.tempos?.length ? `,\n  "tempos": ${JSON.stringify(song.tempos)}` : "";
  const meters = song.meters?.length ? `,\n  "meters": ${JSON.stringify(song.meters)}` : "";
  const loop = song.loop ? `,\n  "loop": { "from": ${song.loop.from}, "to": ${song.loop.to} }` : "";
  return `{\n  "version": 1,\n  "bpm": ${song.bpm},\n  "stepsPerBeat": ${song.stepsPerBeat},\n  "length": ${song.length},\n  "tracks": [\n${song.tracks.map(track).join(",\n")}\n  ]${room}${master}${bar}${markers}${buses}${tempos}${meters}${loop}\n}\n`;
}

// ---- editing (every edit returns a new song) ----------------------------------------------------------

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export function setTempo(song: Song, bpm: number): Song {
  return { ...clone(song), bpm: clamp(Math.round(bpm), MIN_BPM, MAX_BPM) };
}

/// Changes the length (in steps). Notes starting past the end are dropped and long notes are cut at the end.
export function setLength(song: Song, steps: number): Song {
  const length = clamp(Math.round(steps), 1, MAX_STEPS);
  const next = clone(song);
  next.length = length;
  for (const t of next.tracks) {
    t.notes = t.notes.filter((n) => n.step < length).map((n) => ({ ...n, len: Math.min(n.len, length - n.step) }));
  }
  return next;
}

export function addTrack(song: Song, kind: "synth" | "drums", wave: Wave = "square"): Song {
  if (song.tracks.length >= MAX_TRACKS) return song;
  const next = clone(song);
  const used = new Set(next.tracks.map((t) => t.name));
  const base = kind === "drums" ? "drums" : wave === "triangle" ? "bass" : "synth";
  let name = base;
  for (let n = 2; used.has(name); n++) name = `${base}${n}`;
  next.tracks.push(kind === "drums" ? drumTrack(name) : synthTrack(name, wave));
  return next;
}

export function removeTrack(song: Song, index: number): Song {
  if (song.tracks.length <= 1 || !song.tracks[index]) return song;
  const next = clone(song);
  next.tracks.splice(index, 1);
  return next;
}

export function updateTrack(song: Song, index: number, change: Partial<Omit<Track, "notes" | "kind">>): Song {
  if (!song.tracks[index]) return song;
  const next = clone(song);
  const t = next.tracks[index]!;
  Object.assign(t, change);
  t.volume = clamp(t.volume, 0, 1);
  t.pan = clamp(t.pan, -1, 1);
  t.duty = clamp(t.duty, 0.05, 0.95);
  for (const k of ["attack", "decay", "release"] as const) t[k] = clamp(t[k], 0, 4);
  t.sustain = clamp(t.sustain, 0, 1);
  for (const [key, lo, hi] of VOICE_RANGES) if (t[key] !== undefined) (t as unknown as Record<string, number>)[key] = clamp(t[key] as number, lo, hi);
  if (!t.name.trim()) t.name = song.tracks[index]!.name;
  return next;
}

/// The note covering (step, pitch) on a track, if any.
export function noteAt(track: Track, step: number, pitch: number): number {
  return track.notes.findIndex((n) => n.pitch === pitch && step >= n.step && step < n.step + n.len);
}

/// Puts a note down; it replaces any note it overlaps at the same pitch. Returns the index of the new note.
export function addNote(song: Song, track: number, note: Note): { song: Song; index: number } {
  const t0 = song.tracks[track];
  if (!t0 || note.step < 0 || note.step >= song.length || song.tracks.reduce((n, t) => n + t.notes.length, 0) >= MAX_NOTES) return { song, index: -1 };
  const next = clone(song);
  const t = next.tracks[track]!;
  const len = clamp(Math.round(note.len), 1, song.length - note.step);
  const fresh: Note = { step: note.step, len, pitch: clamp(Math.round(note.pitch), 0, 127), vel: clamp(note.vel, 0, 1) };
  t.notes = t.notes.filter((n) => !(n.pitch === fresh.pitch && n.step < fresh.step + fresh.len && fresh.step < n.step + n.len));
  t.notes.push(fresh);
  t.notes.sort((a, b) => a.step - b.step || a.pitch - b.pitch);
  return { song: next, index: t.notes.indexOf(t.notes.find((n) => n.step === fresh.step && n.pitch === fresh.pitch)!) };
}

export function removeNote(song: Song, track: number, index: number): Song {
  if (!song.tracks[track]?.notes[index]) return song;
  const next = clone(song);
  next.tracks[track]!.notes.splice(index, 1);
  return next;
}

/// Moves and/or resizes a note; the result must fit inside the song.
export function changeNote(song: Song, track: number, index: number, change: Partial<Note>): { song: Song; index: number } {
  const n = song.tracks[track]?.notes[index];
  if (!n) return { song, index };
  const merged: Note = { ...n, ...change };
  if (merged.step < 0 || merged.step >= song.length || merged.len < 1) return { song, index };
  const without = removeNote(song, track, index);
  return addNote(without, track, merged);
}

export function transpose(song: Song, track: number, semitones: number): Song {
  const t = song.tracks[track];
  if (!t || t.kind === "drums") return song;
  const next = clone(song);
  next.tracks[track]!.notes = next.tracks[track]!.notes.map((n) => ({ ...n, pitch: clamp(n.pitch + semitones, 0, 127) }));
  return next;
}

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const noteName = (pitch: number) => `${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
export const isBlack = (pitch: number) => [1, 3, 6, 8, 10].includes(pitch % 12);

// ---- sound ------------------------------------------------------------------------------------------

/// One drum hit as samples, for the pitch's drum (unknown pitches get a short noise tick).
export function drumHit(pitch: number, rate = RATE): Float32Array {
  const rng = mulberry32(pitch * 7919);
  const make = (seconds: number, fn: (t: number, i: number) => number) => {
    const out = new Float32Array(Math.max(1, Math.round(seconds * rate)));
    for (let i = 0; i < out.length; i++) out[i] = fn(i / rate, i);
    return out;
  };
  const noise = () => rng() * 2 - 1;
  let hp = 0; // high-pass memory for hats and claps
  const hiss = () => {
    const n = noise();
    const y = n - hp;
    hp = n;
    return y;
  };
  switch (pitch) {
    case 36: { // kick: a sine that falls from 150 to 45 Hz
      let phase = 0;
      return make(0.35, (t) => {
        phase += (45 + 105 * Math.exp(-t * 28)) / rate;
        return Math.sin(2 * Math.PI * phase) * Math.exp(-t * 9);
      });
    }
    case 38: // snare: noise over a short 190 Hz body
      return make(0.22, (t) => (noise() * 0.7 * Math.exp(-t * 18) + Math.sin(2 * Math.PI * 190 * t) * 0.5 * Math.exp(-t * 30)));
    case 39: // clap: three quick noise bursts
      return make(0.25, (t) => hiss() * (Math.exp(-((t % 0.012) * 300)) * (t < 0.036 ? 1 : 0.8 * Math.exp(-(t - 0.036) * 25))));
    case 42:
      return make(0.07, (t) => hiss() * Math.exp(-t * 70) * 0.8);
    case 46:
      return make(0.35, (t) => hiss() * Math.exp(-t * 10) * 0.6);
    case 45: { // tom
      let phase = 0;
      return make(0.35, (t) => {
        phase += (70 + 55 * Math.exp(-t * 14)) / rate;
        return Math.sin(2 * Math.PI * phase) * Math.exp(-t * 7);
      });
    }
    case 49:
      return make(1.0, (t) => hiss() * Math.exp(-t * 3.5) * 0.6);
    default:
      return make(0.05, (t) => noise() * Math.exp(-t * 80) * 0.5);
  }
}

function oscillator(wave: Wave, duty: number, rng: () => number) {
  let phase = 0;
  let held = rng() * 2 - 1;
  return (freq: number, rate: number) => {
    phase += freq / rate;
    if (phase >= 1) {
      phase -= Math.floor(phase);
      held = rng() * 2 - 1;
    }
    switch (wave) {
      case "square": return phase < duty ? 1 : -1;
      case "saw": return 2 * phase - 1;
      case "triangle": return phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase;
      case "sine": return Math.sin(2 * Math.PI * phase);
      default: return held; // noise: a new random value every cycle
    }
  };
}

/// The instruments that are more than one oscillator: FM (a sine bent by another sine), a plucked string (Karplus-Strong) and an organ (added harmonics).
/// Each call makes a voice for one note; it gives one sample each time it is called with the note's pitch.
function instrumentOscillator(t: Track, rng: () => number) {
  if (t.wave === "sample") {
    const snd = sampleBank.get(t.sample ?? "");
    if (!snd || !snd.channels[0]) return () => 0;
    // the file as one channel, the two added if it has two
    const len = snd.channels[0].length;
    const mono = new Float32Array(len);
    for (let i = 0; i < len; i++) mono[i] = snd.channels.length > 1 ? (snd.channels[0]![i]! + (snd.channels[1]![i] ?? 0)) / 2 : snd.channels[0]![i]!;
    const rootFreq = midiFreq(clamp(t.root ?? 60, 0, 127));
    let at = 0;
    return (freq: number, rate: number) => {
      const i = Math.floor(at);
      const out = i + 1 < len ? mono[i]! + (mono[i + 1]! - mono[i]!) * (at - i) : i < len ? mono[i]! : 0;
      at += (freq / rootFreq) * (snd.rate / rate);
      return out;
    };
  }
  if (t.wave === "wavetable") {
    // a table of four shapes, blended between neighbours: sine, triangle, saw, square (saw and square softened by PolyBLEP so that high notes do not hiss)
    const pos = clamp(t.wtPos ?? 0.3, 0, 1) * 3;
    const lo = Math.min(2, Math.floor(pos));
    const k = pos - lo;
    let phase = 0;
    const shape = (i: number, ph: number, dt: number) => {
      switch (i) {
        case 0: return Math.sin(2 * Math.PI * ph);
        case 1: return ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph;
        case 2: return 2 * ph - 1 - polyblep(ph, dt);
        default: return (ph < 0.5 ? 1 : -1) + polyblep(ph, dt) - polyblep((ph + 0.5) % 1, dt);
      }
    };
    return (freq: number, rate: number) => {
      const dt = freq / rate;
      phase = (phase + dt) % 1;
      return shape(lo, phase, dt) * (1 - k) + shape(lo + 1, phase, dt) * k;
    };
  }
  if (t.wave === "formula") {
    const c = compileFormula(t.formula ?? "sin(2 * pi * p)");
    const run = c.ok ? c.run : () => 0;
    let phase = 0;
    let n = 0;
    return (freq: number, rate: number) => {
      phase = (phase + freq / rate) % 1;
      return run({ p: phase, t: n++ / rate, f: freq });
    };
  }
  if (t.wave === "fm") {
    const ratio = t.fmRatio ?? 2;
    const index = t.fmIndex ?? 3;
    let carrier = 0, modulator = 0, n = 0;
    return (freq: number, rate: number) => {
      carrier = (carrier + freq / rate) % 1;
      modulator = (modulator + (freq * ratio) / rate) % 1;
      // the bend is strongest at the start and fades as the note rings: the bright attack of a bell or an electric piano
      const bend = index * Math.exp(-(n++ / rate) * 2.5);
      return Math.sin(2 * Math.PI * carrier + bend * Math.sin(2 * Math.PI * modulator));
    };
  }
  if (t.wave === "pluck") {
    const damping = 0.9 + 0.0995 * clamp(t.damping ?? 0.7, 0, 1);
    const bright = clamp(t.brightness ?? 0.6, 0, 1);
    let line: Float32Array | null = null;
    let at = 0;
    return (freq: number, rate: number) => {
      if (!line) {
        line = new Float32Array(Math.max(2, Math.round(rate / Math.max(20, freq))));
        // a burst of noise, softened by how dull the string is
        let prev = 0;
        for (let i = 0; i < line.length; i++) {
          const x = rng() * 2 - 1;
          prev = prev + (x - prev) * (0.25 + 0.75 * bright);
          line[i] = prev;
        }
      }
      const next = (at + 1) % line.length;
      const out = line[at]!;
      line[at] = damping * 0.5 * (line[at]! + line[next]!);
      at = next;
      return out * 1.4;
    };
  }
  // organ: the note and its harmonics, with a sub octave, brighter or duller by `brightness`
  const b = clamp(t.brightness ?? 0.5, 0, 1);
  const harmonics = [0.5, 1, 2, 3, 4, 5, 6, 8];
  const weights = harmonics.map((h, i) => (i === 0 ? 0.6 : i === 1 ? 1 : Math.pow(0.35 + 0.6 * b, i)));
  const total = weights.reduce((x, y) => x + y, 0);
  const phases = harmonics.map(() => 0);
  return (freq: number, rate: number) => {
    let sum = 0;
    for (let i = 0; i < harmonics.length; i++) {
      phases[i] = (phases[i]! + (freq * harmonics[i]!) / rate) % 1;
      sum += weights[i]! * Math.sin(2 * Math.PI * phases[i]!);
    }
    return sum / total * 1.6;
  };
}

/// Starting points for a sound: a name and the track settings it sets (the instrument, its envelope and its character). Applying one changes only these fields.
export const INSTRUMENT_PRESETS: { name: string; set: Partial<Track> }[] = [
  { name: "Bass (monosynth)", set: { wave: "saw", duty: 0.5, attack: 0.005, decay: 0.2, sustain: 0.5, release: 0.08, cutoff: 700, resonance: 0.35, sweep: 0.55, sub: 0.5, unison: 1, vibrato: 0 } },
  { name: "Soft pad", set: { wave: "saw", attack: 0.45, decay: 0.3, sustain: 0.8, release: 0.9, unison: 5, detune: 14, cutoff: 2600, resonance: 0.1, sweep: 0.1, sub: 0, reverb: 0.35 } },
  { name: "Bright lead", set: { wave: "square", duty: 0.4, attack: 0.01, decay: 0.12, sustain: 0.7, release: 0.15, unison: 3, detune: 8, vibrato: 0.12, cutoff: 0 } },
  { name: "Electric piano (FM)", set: { wave: "fm", fmRatio: 1, fmIndex: 2.2, attack: 0.005, decay: 0.6, sustain: 0.25, release: 0.3 } },
  { name: "Bell (FM)", set: { wave: "fm", fmRatio: 3.5, fmIndex: 5, attack: 0.002, decay: 1.2, sustain: 0.1, release: 0.8 } },
  { name: "Plucked string", set: { wave: "pluck", damping: 0.75, brightness: 0.55, attack: 0.001, decay: 0.05, sustain: 0.95, release: 0.25 } },
  { name: "Wavetable sweep", set: { wave: "wavetable", wtPos: 0.55, attack: 0.02, decay: 0.2, sustain: 0.7, release: 0.2 } },
  { name: "Formula: soft square", set: { wave: "formula", formula: "tri(p) * 0.6 + sq(p) * 0.2", attack: 0.01, decay: 0.1, sustain: 0.8, release: 0.1 } },
  { name: "Organ", set: { wave: "organ", brightness: 0.55, attack: 0.01, decay: 0.05, sustain: 0.95, release: 0.08 } },
];

/// Level of an attack-decay-sustain-release envelope `t` seconds after the note starts, for a note held `hold` seconds.
export function envelope(t: number, hold: number, a: number, d: number, s: number, r: number): number {
  const level = (x: number) => (x < a ? (a > 0 ? x / a : 1) : x < a + d ? 1 - (1 - s) * ((x - a) / Math.max(d, 1e-9)) : s);
  if (t < hold) return level(t);
  const end = level(hold);
  return r > 0 && t < hold + r ? end * (1 - (t - hold) / r) : 0;
}

// ---- richer voices ------------------------------------------------------------------------------------------

/// Whether a track uses the fuller voice (anything beyond one plain oscillator or the chip drums).
export function isRich(t: Track): boolean {
  if (t.kind === "synth" && isInstrument(t.wave)) return false;
  if (t.kind === "drums") return t.kit === "studio" || (t.reverb ?? 0) > 0;
  return (t.unison ?? 1) > 1 || (t.cutoff ?? 0) > 0 || (t.sub ?? 0) > 0 || (t.vibrato ?? 0) > 0 || (t.reverb ?? 0) > 0;
}

/// The correction that rounds off a saw or square's jump, so the high harmonics do not fold back as hiss (PolyBLEP).
function polyblep(t: number, dt: number): number {
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

/// A state-variable filter (topology-preserving): low-pass or band-pass or high-pass of the input, one sample at a time.
class Svf {
  private ic1 = 0;
  private ic2 = 0;
  low = 0;
  band = 0;
  high = 0;
  /// `fc` Hz at `rate`, `q` 0.5 and up.
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

const softClip = (x: number, drive: number) => Math.tanh(x * drive) / Math.tanh(drive);

/// One drum hit of the "studio" kit: more body, a click on the kick, a snare with a tone and a rattle, metallic hats.
export function studioDrumHit(pitch: number, rate = RATE): Float32Array {
  const rng = mulberry32(pitch * 104729);
  const make = (seconds: number, fn: (t: number, i: number) => number) => {
    const out = new Float32Array(Math.max(1, Math.round(seconds * rate)));
    for (let i = 0; i < out.length; i++) out[i] = fn(i / rate, i);
    return out;
  };
  const noise = () => rng() * 2 - 1;
  const metal = [263, 400, 421, 474, 587, 845];
  const phases = metal.map(() => 0);
  const metallic = () => {
    let sum = 0;
    for (let k = 0; k < metal.length; k++) {
      phases[k] = (phases[k]! + metal[k]! * 2.4 / rate) % 1;
      sum += phases[k]! < 0.5 ? 1 : -1;
    }
    return sum / metal.length;
  };
  switch (pitch) {
    case 36: { // kick: a sine falling from about 170 to 46 Hz, a click, a soft clip for weight
      let phase = 0;
      const click = new Svf();
      return make(0.5, (t) => {
        phase += (46 + 125 * Math.exp(-t * 32)) / rate;
        click.step(noise(), 3200, rate, 0.8);
        const body = Math.sin(2 * Math.PI * phase) * Math.exp(-t * 6.5);
        return softClip(body * 1.1 + click.band * Math.exp(-t * 420) * 0.5, 1.5) * 0.95;
      });
    }
    case 38: { // snare: a rattle of band-passed noise over two short tones
      const body = new Svf();
      return make(0.32, (t) => {
        body.step(noise(), 2600, rate, 0.7);
        const tone = Math.sin(2 * Math.PI * (175 - 25 * Math.min(1, t * 20)) * t) * 0.55 * Math.exp(-t * 26) + Math.sin(2 * Math.PI * 330 * t) * 0.25 * Math.exp(-t * 34);
        return softClip(tone + (body.band * 1.4 + body.high * 0.5) * Math.exp(-t * 15) * 0.8, 1.3);
      });
    }
    case 39: { // clap: four quick bursts and a tail
      const f = new Svf();
      return make(0.32, (t) => {
        f.step(noise(), 1500, rate, 1.1);
        const burst = t < 0.044 ? Math.exp(-((t % 0.011) * 260)) : 0.7 * Math.exp(-(t - 0.044) * 16);
        return f.band * burst * 1.3;
      });
    }
    case 42: { // closed hat: metallic, high-passed, short
      const f = new Svf();
      return make(0.09, (t) => {
        f.step(metallic() * 0.7 + noise() * 0.3, 7600, rate, 0.7);
        return f.high * Math.exp(-t * 62) * 0.7;
      });
    }
    case 46: { // open hat
      const f = new Svf();
      return make(0.5, (t) => {
        f.step(metallic() * 0.7 + noise() * 0.3, 7000, rate, 0.7);
        return f.high * Math.exp(-t * 8) * 0.55;
      });
    }
    case 45: { // tom
      let phase = 0;
      return make(0.45, (t) => {
        phase += (82 + 70 * Math.exp(-t * 16)) / rate;
        return softClip(Math.sin(2 * Math.PI * phase) * Math.exp(-t * 6), 1.3) * 0.9;
      });
    }
    case 49: { // crash
      const f = new Svf();
      return make(1.8, (t) => {
        f.step(metallic() * 0.5 + noise() * 0.5, 5200, rate, 0.7);
        return f.high * Math.exp(-t * 2.6) * 0.5;
      });
    }
    default:
      return drumHit(pitch, rate);
  }
}

/// A room: eight comb filters and four all-passes per side (the classic Freeverb layout), fed the mix of both channels.
/// The sends are run through twice so that what rings past the end wraps round to the start, as the notes' tails do.
function reverb(sendL: Float32Array, sendR: Float32Array, room: Room, rate: number): [Float32Array, Float32Array] {
  const scale = rate / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const allpass = [556, 441, 341, 225];
  const feedback = 0.72 + room.size * 0.26;
  const damp = 0.05 + room.damping * 0.5;
  const build = (spread: number) => ({
    comb: combs.map((n) => ({ buf: new Float32Array(Math.round((n + spread) * scale)), pos: 0, store: 0 })),
    all: allpass.map((n) => ({ buf: new Float32Array(Math.round((n + spread) * scale)), pos: 0 })),
  });
  const sides = [build(0), build(23)];
  const out: [Float32Array, Float32Array] = [new Float32Array(sendL.length), new Float32Array(sendL.length)];
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < sendL.length; i++) {
      const input = (sendL[i]! + sendR[i]!) * 0.015;
      for (let ch = 0; ch < 2; ch++) {
        const side = sides[ch]!;
        let y = 0;
        for (const c of side.comb) {
          const v = c.buf[c.pos]!;
          c.store = v * (1 - damp) + c.store * damp;
          c.buf[c.pos] = input + c.store * feedback;
          if (++c.pos >= c.buf.length) c.pos = 0;
          y += v;
        }
        for (const a of side.all) {
          const v = a.buf[a.pos]!;
          a.buf[a.pos] = y + v * 0.5;
          y = v - y;
          if (++a.pos >= a.buf.length) a.pos = 0;
        }
        if (pass === 1) out[ch]![i] = y * 3 * room.mix;
      }
    }
  }
  return out;
}

/// One note of a fuller voice: `unison` detuned oscillators spread across the stereo field, a sub, vibrato, and a low-pass
/// filter that the envelope opens. `out` takes the finished left and right values for sample `index`.
function richNote(
  track: Track, n: Note, seed: number, startIndex: number, hold: number, rate: number, volume: number, pan: number,
  out: (index: number, l: number, r: number) => void,
): void {
  const length = Math.round((hold + track.release) * rate);
  const rng = mulberry32(seed);
  const voices = clamp(Math.round(track.unison ?? 1), 1, 7);
  const spread = track.detune ?? 0;
  const base = midiFreq(n.pitch);
  const phase: number[] = [];
  const ratio: number[] = [];
  const gl: number[] = [];
  const gr: number[] = [];
  for (let v = 0; v < voices; v++) {
    const x = voices > 1 ? (v / (voices - 1)) * 2 - 1 : 0;
    phase.push(rng());
    ratio.push(2 ** ((x * spread) / 1200));
    const p = clamp(pan + x * 0.75, -1, 1);
    gl.push(Math.cos(((p + 1) * Math.PI) / 4));
    gr.push(Math.sin(((p + 1) * Math.PI) / 4));
  }
  const cutoff = track.cutoff ?? 0;
  const q = 0.5 + (track.resonance ?? 0) * 6;
  const sweep = track.sweep ?? 0;
  const sub = track.sub ?? 0;
  const vib = track.vibrato ?? 0;
  const norm = 0.5 / Math.sqrt(voices);
  const f1l = new Svf(), f2l = new Svf(), f1r = new Svf(), f2r = new Svf();
  let subPhase = 0;
  let held = rng() * 2 - 1;
  for (let k = 0; k < length; k++) {
    const t = k / rate;
    const e = envelope(t, hold, track.attack, track.decay, track.sustain, track.release);
    if (e <= 0) continue;
    const bend = vib > 0 ? 2 ** ((Math.sin(2 * Math.PI * 5.3 * t) * vib * Math.min(1, t / 0.25)) / 12) : 1;
    let l = 0, r = 0;
    for (let v = 0; v < voices; v++) {
      const dt = (base * ratio[v]! * bend) / rate;
      let ph = phase[v]! + dt;
      if (ph >= 1) { ph -= Math.floor(ph); if (track.wave === "noise") held = rng() * 2 - 1; }
      phase[v] = ph;
      let y: number;
      switch (track.wave) {
        case "saw": y = 2 * ph - 1 - polyblep(ph, dt); break;
        case "square": {
          y = ph < track.duty ? 1 : -1;
          y += polyblep(ph, dt);
          y -= polyblep((ph - track.duty + 1) % 1, dt);
          break;
        }
        case "triangle": y = ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph; break;
        case "sine": y = Math.sin(2 * Math.PI * ph); break;
        default: y = held;
      }
      l += y * gl[v]!;
      r += y * gr[v]!;
    }
    if (sub > 0) {
      subPhase = (subPhase + (base * 0.5 * bend) / rate) % 1;
      const s = Math.sin(2 * Math.PI * subPhase) * sub * Math.sqrt(voices);
      l += s * 0.7071;
      r += s * 0.7071;
    }
    if (cutoff > 0) {
      const fc = clamp(cutoff * 2 ** (sweep * 3 * e), 30, rate * 0.45);
      f1l.step(l, fc, rate, q); f2l.step(f1l.low, fc, rate, 0.707);
      f1r.step(r, fc, rate, q); f2r.step(f1r.low, fc, rate, 0.707);
      l = f2l.low;
      r = f2r.low;
    }
    const a = e * n.vel * norm * volume;
    out(startIndex + k, l * a, r * a);
  }
}

/// Plays the song offline into a stereo sound exactly `songSeconds` long. Note tails that run past the end
/// wrap to the beginning so a loop is seamless.
/// The echo of a signal: each repeat `delay` samples later and `feedback` as loud as the one before. The result is `total + tail` long; the part
/// past the end belongs at the start (a looping song's echoes wrap round).
export function echoOf(input: Float32Array, delay: number, feedback: number, tail: number): Float32Array {
  const total = input.length;
  const out = new Float32Array(total + tail);
  const d = Math.max(1, Math.round(delay));
  for (let i = d; i < out.length; i++) {
    const heard = i - d < total ? input[i - d]! : 0;
    out[i] = heard + feedback * out[i - d]!;
  }
  return out;
}

/// Whether a track is heard: not muted, and, when any track is soloed, soloed.
export function isAudible(song: Song, track: Track): boolean {
  return !track.mute && (!song.tracks.some((t) => t.solo) || !!track.solo);
}

/// The song with the master volume set (1 is as the tracks add up).
export function setMaster(song: Song, volume: number): Song {
  const v = clamp(volume, 0, MAX_MASTER);
  const next = { ...song };
  const keep = { ...(song.master?.fx?.length ? { fx: song.master.fx } : {}), ...(song.master?.lufs !== undefined ? { lufs: song.master.lufs } : {}), ...(song.master?.limit !== undefined ? { limit: song.master.limit } : {}) };
  if (v === 1 && !Object.keys(keep).length) delete next.master;
  else next.master = { volume: v, ...keep };
  return next;
}

/// The notes a clip plays, in song steps: its pattern repeated to fill the clip, starting `offset` steps in, cut at the clip's end and the song's.
export function clipNotes(track: Track, clip: Clip, songLength: number): Note[] {
  const pat = track.patterns?.find((p) => p.name === clip.pattern);
  if (!pat || clip.mute) return [];
  const out: Note[] = [];
  const end = Math.min(clip.len, songLength - clip.step);
  const phase = (clip.offset ?? 0) % pat.length;
  for (let r = -phase; r < end; r += pat.length) {
    for (const n of pat.notes) {
      let s = r + n.step;
      let len = n.len;
      if (s + len <= 0 || s >= end) continue;
      if (s < 0) {
        len += s; // the part of a note that began before the clip starts
        s = 0;
      }
      len = Math.min(len, end - s);
      out.push({ ...n, step: clip.step + s, len });
    }
  }
  return out;
}

/// The song with every clip turned into notes on its track (what the renderer and the exports play).
export function expandClips(song: Song): Song {
  if (!song.tracks.some((t) => t.clips?.length)) return song;
  return {
    ...song,
    tracks: song.tracks.map((t) => {
      if (!t.clips?.length) return t;
      const extra = t.clips.flatMap((c) => clipNotes(t, c, song.length));
      return { ...t, notes: [...t.notes, ...extra] };
    }),
  };
}

export function renderSong(source: Song, rate = RATE): Sound {
  const song = applyAutomation(expandClips(source));
  const stepSec = stepSeconds(song);
  const total = Math.round(songSeconds(song) * rate);
  // seconds a note holds, following the tempo track (a song without one keeps the single step length)
  const holdOf = (n: Note) => (song.tempos?.length ? stepTime(song, n.step + n.len) - stepTime(song, n.step) : n.len * stepSec);
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  const hitCache = new Map<number, Float32Array>();
  const studioCache = new Map<number, Float32Array>();
  const padCache = new Map<string, Float32Array>();
  const buses = song.buses ?? [];
  const busBuf = buses.map((b) => (b.mute ? null : { l: new Float32Array(total), r: new Float32Array(total) }));
  const busOf = (name: string | undefined) => (name === undefined ? -1 : buses.findIndex((b) => b.name === name));
  const anyRoom = song.tracks.some((t) => isAudible(song, t) && (t.reverb ?? 0) > 0) || buses.some((b) => !b.mute && (b.reverb ?? 0) > 0);
  const sendL = anyRoom ? new Float32Array(total) : null;
  const sendR = anyRoom ? new Float32Array(total) : null;
  const richSong = song.tracks.some((t) => isAudible(song, t) && isRich(t));
  song.tracks.forEach((track, ti) => {
    if (!isAudible(song, track)) return;
    const pan = clamp(track.pan, -1, 1);
    const gl = Math.cos(((pan + 1) * Math.PI) / 4) * track.volume;
    const gr = Math.sin(((pan + 1) * Math.PI) / 4) * track.volume;
    const send = clamp(track.reverb ?? 0, 0, 1);
    const echo = clamp(track.echo ?? 0, 0, 1);
    const echoL = echo > 0 ? new Float32Array(total) : null;
    const echoR = echo > 0 ? new Float32Array(total) : null;
    // a track with effects is mixed on its own first, run through the chain, then added to the song
    const chain = (track.fx ?? []).filter((f) => f.on !== false);
    const route = busOf(track.bus);
    const sends = (track.sends ?? []).map((s) => ({ at: busOf(s.bus), level: clamp(s.level, 0, 1) })).filter((s) => s.at >= 0 && s.level > 0 && busBuf[s.at]);
    // a track that is routed to a muted bus is not heard (its sends still reach other buses)
    const dest = route >= 0 ? busBuf[route] ?? null : { l: left, r: right };
    const temp = chain.length > 0 || sends.length > 0 || !dest;
    const outL = temp ? new Float32Array(total) : dest!.l;
    const outR = temp ? new Float32Array(total) : dest!.r;
    const sendNow = send > 0 && !chain.length && !!dest;
    // (a note's own pan moves it within the track's: `gl`/`gr` are the track's gains, `pl`/`pr` the note's)
    const mix = (index: number, v: number, pl = gl, pr = gr) => {
      const i = index % total; // wrap the tail onto the start
      outL[i] = outL[i]! + v * pl;
      outR[i] = outR[i]! + v * pr;
      if (echoL && echoR) {
        echoL[i] = echoL[i]! + v * pl;
        echoR[i] = echoR[i]! + v * pr;
      }
      if (sendNow) {
        sendL![i] = sendL![i]! + v * pl * send;
        sendR![i] = sendR![i]! + v * pr * send;
      }
    };
    // the same for a stereo pair of values already panned by the voice (a track's pan and volume are applied here)
    const mixStereo = (index: number, l: number, r: number) => {
      const i = index % total;
      outL[i] = outL[i]! + l;
      outR[i] = outR[i]! + r;
      if (echoL && echoR) {
        echoL[i] = echoL[i]! + l;
        echoR[i] = echoR[i]! + r;
      }
      if (sendNow) {
        sendL![i] = sendL![i]! + l * send;
        sendR![i] = sendR![i]! + r * send;
      }
    };
    for (const [ni, n] of track.notes.entries()) {
      const startIndex = Math.round((song.tempos?.length ? stepTime(song, n.step) : n.step * stepSec) * rate);
      const notePan = clamp(pan + (n.pan ?? 0), -1, 1);
      const nl = n.pan ? Math.cos(((notePan + 1) * Math.PI) / 4) * track.volume : gl;
      const nr = n.pan ? Math.sin(((notePan + 1) * Math.PI) / 4) * track.volume : gr;
      if (track.kind === "drums" && track.kit === "samples") {
        let hit = padCache.get(`${ti}:${n.pitch}`);
        if (!hit) padCache.set(`${ti}:${n.pitch}`, (hit = padHit(track, n.pitch, rate)));
        for (let k = 0; k < hit.length; k++) mix(startIndex + k, hit[k]! * n.vel, nl, nr);
        continue;
      }
      if (track.kind === "drums") {
        const studio = track.kit === "studio";
        const cache = studio ? studioCache : hitCache;
        let hit = cache.get(n.pitch);
        if (!hit) cache.set(n.pitch, (hit = studio ? studioDrumHit(n.pitch, rate) : drumHit(n.pitch, rate)));
        for (let k = 0; k < hit.length; k++) mix(startIndex + k, hit[k]! * n.vel, nl, nr);
        continue;
      }
      if (isRich(track)) {
        richNote(track, n, ti * 1000 + ni + 1, startIndex, holdOf(n), rate, track.volume, notePan, mixStereo);
        continue;
      }
      const hold = holdOf(n);
      const length = Math.round((hold + track.release) * rate);
      const osc = isInstrument(track.wave) ? instrumentOscillator(track, mulberry32(ti * 1000 + ni + 1)) : oscillator(track.wave, track.duty, mulberry32(ti * 1000 + ni + 1));
      const freq = midiFreq(n.pitch);
      const glide = n.bend ?? 0;
      for (let k = 0; k < length; k++) {
        const e = envelope(k / rate, hold, track.attack, track.decay, track.sustain, track.release);
        // the glide runs over the note's held length, then stays where it got to
        const f = glide ? freq * 2 ** ((glide * Math.min(1, k / rate / hold)) / 12) : freq;
        if (e > 0) mix(startIndex + k, osc(f, rate) * e * n.vel * 0.5, nl, nr);
      }
    }
    if (echoL && echoR) {
      const delay = clamp(track.echoTime ?? 2, 1, 16) * stepSec * rate;
      const feedback = clamp(track.echoFeedback ?? 0.4, 0, 0.85);
      // (enough tail for the repeats to fade to a thousandth)
      const repeats = feedback > 0 ? Math.min(40, Math.ceil(Math.log(0.001) / Math.log(feedback))) : 1;
      const tail = Math.round(delay * repeats);
      const wl = echoOf(echoL, delay, feedback, tail);
      const wr = echoOf(echoR, delay, feedback, tail);
      // (the repeats of a looping song's last notes come round to its start)
      for (let i = 0; i < wl.length; i++) {
        const j = i % total;
        outL[j] = outL[j]! + wl[i]! * echo;
        outR[j] = outR[j]! + wr[i]! * echo;
      }
    }
    if (temp) {
      const [pl, pr] = chain.length ? applyFx(chain, outL, outR, rate) : [outL, outR];
      for (let i = 0; i < total; i++) {
        if (dest) {
          dest.l[i] = dest.l[i]! + pl[i]!;
          dest.r[i] = dest.r[i]! + pr[i]!;
        }
        if (send > 0 && chain.length && dest) {
          sendL![i] = sendL![i]! + pl[i]! * send;
          sendR![i] = sendR![i]! + pr[i]! * send;
        }
      }
      for (const s of sends) {
        const b = busBuf[s.at]!;
        for (let i = 0; i < total; i++) {
          b.l[i] = b.l[i]! + pl[i]! * s.level;
          b.r[i] = b.r[i]! + pr[i]! * s.level;
        }
      }
    }
  });
  // The buses: their effects, then volume and balance, into the master (and a share to the room).
  buses.forEach((bus, bi) => {
    const buf = busBuf[bi];
    if (!buf) return;
    const chain = (bus.fx ?? []).filter((f) => f.on !== false);
    const [bl, br] = chain.length ? applyFx(chain, buf.l, buf.r, rate) : [buf.l, buf.r];
    const bal = clamp(bus.pan, -1, 1);
    const gl = bus.volume * (bal > 0 ? Math.cos((bal * Math.PI) / 2) : 1);
    const gr = bus.volume * (bal < 0 ? Math.cos((-bal * Math.PI) / 2) : 1);
    const share = clamp(bus.reverb ?? 0, 0, 1);
    for (let i = 0; i < total; i++) {
      left[i] = left[i]! + bl[i]! * gl;
      right[i] = right[i]! + br[i]! * gr;
      if (share > 0) {
        sendL![i] = sendL![i]! + bl[i]! * gl * share;
        sendR![i] = sendR![i]! + br[i]! * gr * share;
      }
    }
  });
  if (sendL && sendR) {
    const room = song.room ?? { size: 0.55, damping: 0.4, mix: 1 };
    const [wl, wr] = reverb(sendL, sendR, room, rate);
    for (let i = 0; i < total; i++) {
      left[i] = left[i]! + wl[i]!;
      right[i] = right[i]! + wr[i]!;
    }
  }
  // Effects on the whole mix.
  const masterChain = (song.master?.fx ?? []).filter((f) => f.on !== false);
  if (masterChain.length) {
    const [ml, mr] = applyFx(masterChain, left, right, rate);
    left.set(ml.subarray(0, total));
    right.set(mr.subarray(0, total));
  }
  // A fuller song gets a gentle soft clip so that the loudest moments round off instead of being scaled down as a whole.
  if (richSong) {
    for (let i = 0; i < total; i++) {
      left[i] = softClip(left[i]!, 1.1);
      right[i] = softClip(right[i]!, 1.1);
    }
  }
  // The master fader.
  const master = song.master?.volume ?? 1;
  if (master !== 1) {
    for (let i = 0; i < total; i++) {
      left[i] = left[i]! * master;
      right[i] = right[i]! * master;
    }
  }
  // The loudness target and the peak ceiling, when the song asks for them.
  if (song.master?.lufs !== undefined) {
    const now = integratedLufs([left, right], rate);
    if (Number.isFinite(now)) {
      const g = 10 ** ((song.master.lufs - now) / 20);
      for (let i = 0; i < total; i++) {
        left[i] = left[i]! * g;
        right[i] = right[i]! * g;
      }
    }
  }
  if (song.master?.limit !== undefined) limitPeaks([left, right], 10 ** (song.master.limit / 20), rate);
  // Keep peaks under full scale without touching quiet songs.
  let peak = 0;
  for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(left[i]!), Math.abs(right[i]!));
  if (peak > 0.97) {
    const g = 0.97 / peak;
    for (let i = 0; i < total; i++) {
      left[i] = left[i]! * g;
      right[i] = right[i]! * g;
    }
  }
  return { rate, channels: [left, right] };
}
