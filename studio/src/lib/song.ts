// The music editor's data and sound: a step sequencer of tracks with simple synth instruments and a
// small drum kit. A song is saved as `music/<name>.song.json`; `renderSong` plays it offline into the
// WAV the game loads (`nova.music.play("name")`). The render wraps the last notes' tails onto the
// start, so a looping song has no gap or click at the seam.

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
}

export interface Song {
  version: 1;
  bpm: number;
  stepsPerBeat: number;
  /// Total steps; a bar is `stepsPerBeat * 4`.
  length: number;
  tracks: Track[];
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
    tracks.push({ ...base, ...t, duty: clamp(t.duty ?? base.duty, 0.05, 0.95), volume: clamp(t.volume ?? base.volume, 0, 1), pan: clamp(t.pan ?? 0, -1, 1), mute: !!t.mute } as Track);
  }
  return { ok: true, song: { version: 1, bpm: o.bpm!, stepsPerBeat: o.stepsPerBeat!, length: o.length!, tracks } };
}

export function serializeSong(song: Song): string {
  const note = (n: Note) => `{ "step": ${n.step}, "len": ${n.len}, "pitch": ${n.pitch}, "vel": ${+n.vel.toFixed(2)} }`;
  const track = (t: Track) => {
    const fields = [
      `"name": ${JSON.stringify(t.name)}`, `"kind": "${t.kind}"`, `"wave": "${t.wave}"`, `"duty": ${t.duty}`,
      `"attack": ${t.attack}`, `"decay": ${t.decay}`, `"sustain": ${t.sustain}`, `"release": ${t.release}`,
      `"volume": ${t.volume}`, `"pan": ${t.pan}`, `"mute": ${t.mute}`,
    ];
    const notes = t.notes.length ? `[\n${t.notes.map((n) => `        ${note(n)}`).join(",\n")}\n      ]` : "[]";
    return `    {\n${fields.map((f) => `      ${f}`).join(",\n")},\n      "notes": ${notes}\n    }`;
  };
  return `{\n  "version": 1,\n  "bpm": ${song.bpm},\n  "stepsPerBeat": ${song.stepsPerBeat},\n  "length": ${song.length},\n  "tracks": [\n${song.tracks.map(track).join(",\n")}\n  ]\n}\n`;
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

/// Plays the song offline into a stereo sound exactly `songSeconds` long. Note tails that run past the end
/// wrap to the beginning so a loop is seamless.
export function renderSong(song: Song, rate = RATE): Sound {
  const stepSec = stepSeconds(song);
  const total = Math.round(song.length * stepSec * rate);
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  const hitCache = new Map<number, Float32Array>();
  song.tracks.forEach((track, ti) => {
    if (track.mute) return;
    const pan = clamp(track.pan, -1, 1);
    const gl = Math.cos(((pan + 1) * Math.PI) / 4) * track.volume;
    const gr = Math.sin(((pan + 1) * Math.PI) / 4) * track.volume;
    const mix = (index: number, v: number) => {
      const i = index % total; // wrap the tail onto the start
      left[i] = left[i]! + v * gl;
      right[i] = right[i]! + v * gr;
    };
    for (const [ni, n] of track.notes.entries()) {
      const startIndex = Math.round(n.step * stepSec * rate);
      if (track.kind === "drums") {
        let hit = hitCache.get(n.pitch);
        if (!hit) hitCache.set(n.pitch, (hit = drumHit(n.pitch, rate)));
        for (let k = 0; k < hit.length; k++) mix(startIndex + k, hit[k]! * n.vel);
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
