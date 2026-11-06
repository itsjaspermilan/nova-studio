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
import type { Sound } from "./wav";

export type Wave = "square" | "saw" | "triangle" | "sine" | "noise";
export const WAVES: Wave[] = ["square", "saw", "triangle", "sine", "noise"];

export interface Note {
  /// First step (0-based) and length in steps.
  step: number;
  len: number;
  /// MIDI pitch (60 = middle C); for drum tracks it picks the drum.
  pitch: number;
  /// Loudness 0 to 1.
  vel: number;
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
  /// Drum tracks: "chip" (the original) or "studio".
  kit?: "chip" | "studio";
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
}

export const MIN_BPM = 40;
export const MAX_BPM = 240;
export const MAX_STEPS = 1024;
export const MAX_TRACKS = 16;
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
export const songSeconds = (s: Song) => s.length * stepSeconds(s);
export const barSteps = (s: Song) => s.stepsPerBeat * 4;
export const midiFreq = (pitch: number) => 440 * 2 ** ((pitch - 69) / 12);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// ---- files --------------------------------------------------------------------------------------------

/// The voice fields' names and ranges.
const VOICE_RANGES: [keyof Track, number, number][] = [
  ["unison", 1, 7], ["detune", 0, 60], ["cutoff", 0, 20000], ["resonance", 0, 0.9], ["sweep", 0, 1], ["sub", 0, 1], ["vibrato", 0, 0.5], ["reverb", 0, 1],
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
      if (t.kit !== "chip" && t.kit !== "studio") return { ok: false, error: `${at}.kit must be "chip" or "studio"` };
      voice.kit = t.kit;
    }
    tracks.push({ ...base, ...t, ...voice, duty: clamp(t.duty ?? base.duty, 0.05, 0.95), volume: clamp(t.volume ?? base.volume, 0, 1), pan: clamp(t.pan ?? 0, -1, 1), mute: !!t.mute } as Track);
  }
  let room: Room | undefined;
  if (o.room !== undefined) {
    const r = o.room as Partial<Room>;
    if (!r || typeof r !== "object" || !num(r.size ?? 0.5, 0, 1) || !num(r.damping ?? 0.4, 0, 1) || !num(r.mix ?? 1, 0, 2)) return { ok: false, error: '"room" is { "size": 0 to 1, "damping": 0 to 1, "mix": 0 to 2 }' };
    room = { size: r.size ?? 0.5, damping: r.damping ?? 0.4, mix: r.mix ?? 1 };
  }
  return { ok: true, song: { version: 1, bpm: o.bpm!, stepsPerBeat: o.stepsPerBeat!, length: o.length!, tracks, ...(room ? { room } : {}) } };
}

export function serializeSong(song: Song): string {
  const note = (n: Note) => `{ "step": ${n.step}, "len": ${n.len}, "pitch": ${n.pitch}, "vel": ${+n.vel.toFixed(2)} }`;
  const track = (t: Track) => {
    const fields = [
      `"name": ${JSON.stringify(t.name)}`, `"kind": "${t.kind}"`, `"wave": "${t.wave}"`, `"duty": ${t.duty}`,
      `"attack": ${t.attack}`, `"decay": ${t.decay}`, `"sustain": ${t.sustain}`, `"release": ${t.release}`,
      `"volume": ${t.volume}`, `"pan": ${t.pan}`, `"mute": ${t.mute}`,
    ];
    for (const [key] of VOICE_RANGES) if (t[key] !== undefined) fields.push(`"${key}": ${t[key]}`);
    if (t.kit !== undefined) fields.push(`"kit": "${t.kit}"`);
    const notes = t.notes.length ? `[\n${t.notes.map((n) => `        ${note(n)}`).join(",\n")}\n      ]` : "[]";
    return `    {\n${fields.map((f) => `      ${f}`).join(",\n")},\n      "notes": ${notes}\n    }`;
  };
  const room = song.room ? `,\n  "room": { "size": ${song.room.size}, "damping": ${song.room.damping}, "mix": ${song.room.mix} }` : "";
  return `{\n  "version": 1,\n  "bpm": ${song.bpm},\n  "stepsPerBeat": ${song.stepsPerBeat},\n  "length": ${song.length},\n  "tracks": [\n${song.tracks.map(track).join(",\n")}\n  ]${room}\n}\n`;
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
  track: Track, n: Note, seed: number, startIndex: number, stepSec: number, rate: number, volume: number, pan: number,
  out: (index: number, l: number, r: number) => void,
): void {
  const hold = n.len * stepSec;
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
export function renderSong(song: Song, rate = RATE): Sound {
  const stepSec = stepSeconds(song);
  const total = Math.round(song.length * stepSec * rate);
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  const hitCache = new Map<number, Float32Array>();
  const studioCache = new Map<number, Float32Array>();
  const anyRoom = song.tracks.some((t) => !t.mute && (t.reverb ?? 0) > 0);
  const sendL = anyRoom ? new Float32Array(total) : null;
  const sendR = anyRoom ? new Float32Array(total) : null;
  const richSong = song.tracks.some((t) => !t.mute && isRich(t));
  song.tracks.forEach((track, ti) => {
    if (track.mute) return;
    const pan = clamp(track.pan, -1, 1);
    const gl = Math.cos(((pan + 1) * Math.PI) / 4) * track.volume;
    const gr = Math.sin(((pan + 1) * Math.PI) / 4) * track.volume;
    const send = clamp(track.reverb ?? 0, 0, 1);
    const mix = (index: number, v: number) => {
      const i = index % total; // wrap the tail onto the start
      left[i] = left[i]! + v * gl;
      right[i] = right[i]! + v * gr;
      if (send > 0) {
        sendL![i] = sendL![i]! + v * gl * send;
        sendR![i] = sendR![i]! + v * gr * send;
      }
    };
    // the same for a stereo pair of values already panned by the voice (a track's pan and volume are applied here)
    const mixStereo = (index: number, l: number, r: number) => {
      const i = index % total;
      left[i] = left[i]! + l;
      right[i] = right[i]! + r;
      if (send > 0) {
        sendL![i] = sendL![i]! + l * send;
        sendR![i] = sendR![i]! + r * send;
      }
    };
    for (const [ni, n] of track.notes.entries()) {
      const startIndex = Math.round(n.step * stepSec * rate);
      if (track.kind === "drums") {
        const studio = track.kit === "studio";
        const cache = studio ? studioCache : hitCache;
        let hit = cache.get(n.pitch);
        if (!hit) cache.set(n.pitch, (hit = studio ? studioDrumHit(n.pitch, rate) : drumHit(n.pitch, rate)));
        for (let k = 0; k < hit.length; k++) mix(startIndex + k, hit[k]! * n.vel);
        continue;
      }
      if (isRich(track)) {
        richNote(track, n, ti * 1000 + ni + 1, startIndex, stepSec, rate, track.volume, pan, mixStereo);
        continue;
      }
      const hold = n.len * stepSec;
      const length = Math.round((hold + track.release) * rate);
      const osc = oscillator(track.wave, track.duty, mulberry32(ti * 1000 + ni + 1));
      const freq = midiFreq(n.pitch);
      for (let k = 0; k < length; k++) {
        const e = envelope(k / rate, hold, track.attack, track.decay, track.sustain, track.release);
        if (e > 0) mix(startIndex + k, osc(freq, rate) * e * n.vel * 0.5);
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
  // A fuller song gets a gentle soft clip so that the loudest moments round off instead of being scaled down as a whole.
  if (richSong) {
    for (let i = 0; i < total; i++) {
      left[i] = softClip(left[i]!, 1.1);
      right[i] = softClip(right[i]!, 1.1);
    }
  }
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
