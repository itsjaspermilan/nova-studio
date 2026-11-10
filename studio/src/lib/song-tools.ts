// The piano roll's helpers beyond the basics: strum, glue, humanise, scales and chords, markers, the loop region and automation lanes. Every edit
// takes a song and gives a new one; notes are named by `noteKey` (where they start and their pitch), like the rest of lib/song-edit.ts.

import { mulberry32 } from "./sfx";
import { LANE_RANGE, MAX_METERS, MAX_NOTES, MAX_TEMPOS, MAX_BPM, MIN_BPM, bpmAt, type Lane, type LaneParam, type Marker, type Note, type Song, type TempoChange, type Track } from "./song";
import { noteKey } from "./song-edit";
import { applyAutomation, laneValue } from "./song-lanes";

export { applyAutomation, laneValue };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const withTrack = (song: Song, index: number, change: (t: Track) => Track): Song => ({ ...song, tracks: song.tracks.map((t, i) => (i === index ? change(t) : t)) });
const sorted = (notes: Note[]) => [...notes].sort((a, b) => a.step - b.step || a.pitch - b.pitch);
const totalNotes = (song: Song, track: number, mine: number) => song.tracks.reduce((n, t, i) => n + (i === track ? mine : t.notes.length), 0);

// ---- notes --------------------------------------------------------------------------------------

/// Plays the notes of each chord (notes that start on the same step) one after another, lowest first, each `gap` steps after the one before (a
/// guitar-like strum). The notes keep their end, so the later ones are shorter. Returns the song and the new keys.
export function strumNotes(song: Song, track: number, keys: Set<string>, gap = 1, down = true): { song: Song; keys: Set<string> } {
  const t = song.tracks[track];
  if (!t || keys.size === 0) return { song, keys };
  const chosen = t.notes.filter((n) => keys.has(noteKey(n)));
  const byStep = new Map<number, Note[]>();
  for (const n of chosen) byStep.set(n.step, [...(byStep.get(n.step) ?? []), n]);
  const moved: Note[] = [];
  for (const [step, chord] of byStep) {
    chord.sort((a, b) => (down ? b.pitch - a.pitch : a.pitch - b.pitch)); // a downstrum starts with the highest string
    chord.forEach((n, i) => {
      const shift = Math.min(i * gap, n.len - 1);
      moved.push({ ...n, step: step + shift, len: n.len - shift });
    });
  }
  const movedKeys = new Set(moved.map(noteKey));
  const rest = t.notes.filter((n) => !keys.has(noteKey(n)) && !movedKeys.has(noteKey(n)));
  return { song: withTrack(song, track, (tr) => ({ ...tr, notes: sorted([...rest, ...moved]) })), keys: movedKeys };
}

/// Joins notes of the same pitch that touch or overlap into one long note (the loudness of the first). Works on the chosen notes only.
export function glueNotes(song: Song, track: number, keys: Set<string>): { song: Song; keys: Set<string> } {
  const t = song.tracks[track];
  if (!t || keys.size === 0) return { song, keys };
  const chosen = t.notes.filter((n) => keys.has(noteKey(n)));
  const byPitch = new Map<number, Note[]>();
  for (const n of chosen) byPitch.set(n.pitch, [...(byPitch.get(n.pitch) ?? []), n]);
  const glued: Note[] = [];
  for (const list of byPitch.values()) {
    list.sort((a, b) => a.step - b.step);
    let cur = { ...list[0]! };
    for (const n of list.slice(1)) {
      if (n.step <= cur.step + cur.len) cur.len = Math.max(cur.len, n.step + n.len - cur.step);
      else (glued.push(cur), (cur = { ...n }));
    }
    glued.push(cur);
  }
  const rest = t.notes.filter((n) => !keys.has(noteKey(n)));
  return { song: withTrack(song, track, (tr) => ({ ...tr, notes: sorted([...rest, ...glued]) })), keys: new Set(glued.map(noteKey)) };
}

/// Varies the loudness of the notes by up to `amount` (0 to 1) either way, the same way for the same seed.
export function humanizeVelocity(song: Song, track: number, keys: Set<string>, amount: number, seed = 1): Song {
  const rng = mulberry32(seed);
  return withTrack(song, track, (t) => ({
    ...t,
    notes: t.notes.map((n) => (keys.has(noteKey(n)) ? { ...n, vel: +clamp(n.vel + (rng() * 2 - 1) * amount, 0.05, 1).toFixed(3) } : n)),
  }));
}

/// Shifts the notes' start by a number of steps for a looser feel: each moves up to `amount` steps either way (0 to 2; whole steps, the grid is the grid).
export function humanizeTiming(song: Song, track: number, keys: Set<string>, amount: number, seed = 1): { song: Song; keys: Set<string> } {
  const t = song.tracks[track];
  if (!t) return { song, keys };
  const rng = mulberry32(seed);
  const moved: Note[] = [];
  const taken = new Set(t.notes.filter((n) => !keys.has(noteKey(n))).map(noteKey));
  for (const n of t.notes.filter((n) => keys.has(noteKey(n)))) {
    let step = clamp(n.step + Math.round((rng() * 2 - 1) * amount), 0, song.length - 1);
    if (taken.has(noteKey({ step, pitch: n.pitch }))) step = n.step;
    taken.add(noteKey({ step, pitch: n.pitch }));
    moved.push({ ...n, step, len: Math.min(n.len, song.length - step) });
  }
  const rest = t.notes.filter((n) => !keys.has(noteKey(n)));
  return { song: withTrack(song, track, (tr) => ({ ...tr, notes: sorted([...rest, ...moved]) })), keys: new Set(moved.map(noteKey)) };
}

// ---- scales and chords --------------------------------------------------------------------------

export const SCALES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  "harmonic minor": [0, 2, 3, 5, 7, 8, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  "pentatonic major": [0, 2, 4, 7, 9],
  "pentatonic minor": [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

/// Whether a pitch is in a scale (root 0 to 11 is the key note: 0 = C).
export const inScale = (pitch: number, root: number, scale: string): boolean => (SCALES[scale] ?? SCALES.chromatic!).includes((((pitch - root) % 12) + 12) % 12);

/// The scale note nearest a pitch (the lower one on a tie).
export function nearestInScale(pitch: number, root: number, scale: string): number {
  for (let d = 0; d <= 6; d++) {
    if (inScale(pitch - d, root, scale)) return pitch - d;
    if (inScale(pitch + d, root, scale)) return pitch + d;
  }
  return pitch;
}

/// Moves each chosen note to the nearest note of the scale. Notes that land on another note of the track at the same step are merged.
export function snapToScale(song: Song, track: number, keys: Set<string>, root: number, scale: string): { song: Song; keys: Set<string> } {
  const t = song.tracks[track];
  if (!t || t.kind === "drums" || keys.size === 0) return { song, keys };
  const unique = new Map<string, Note>();
  for (const n of t.notes.filter((n) => keys.has(noteKey(n)))) {
    const m = { ...n, pitch: clamp(nearestInScale(n.pitch, root, scale), 0, 127) };
    const k = noteKey(m);
    const there = unique.get(k);
    if (!there || m.len > there.len) unique.set(k, m);
  }
  const moved = [...unique.values()];
  const movedKeys = new Set(moved.map(noteKey));
  const rest = t.notes.filter((n) => !keys.has(noteKey(n)) && !movedKeys.has(noteKey(n)));
  return { song: withTrack(song, track, (tr) => ({ ...tr, notes: sorted([...rest, ...moved]) })), keys: movedKeys };
}

export const CHORDS: Record<string, number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  diminished: [0, 3, 6],
  augmented: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  "major 7th": [0, 4, 7, 11],
  "minor 7th": [0, 3, 7, 10],
  "dominant 7th": [0, 4, 7, 10],
  power: [0, 7],
};

/// Adds the rest of a chord on top of each chosen note (the note is the root): same start, length and loudness. `inversion` moves that many of the
/// lowest notes up an octave. Stays under the note limit; returns the song and the keys of every note of the chords.
export function addChord(song: Song, track: number, keys: Set<string>, chord: string, inversion = 0): { song: Song; keys: Set<string> } | null {
  const t = song.tracks[track];
  const shape = CHORDS[chord];
  if (!t || !shape || t.kind === "drums" || keys.size === 0) return null;
  const roots = t.notes.filter((n) => keys.has(noteKey(n)));
  // (an inversion lifts the root itself, so the root note leaves its place)
  const base = inversion > 0 ? t.notes.filter((n) => !keys.has(noteKey(n))) : t.notes;
  const have = new Set(base.map(noteKey));
  const added: Note[] = [];
  const all = new Set<string>();
  for (const r of roots) {
    const offsets = shape.map((o, i) => (i < inversion ? o + 12 : o));
    for (const o of offsets) {
      const pitch = r.pitch + o;
      if (pitch > 127) continue;
      const key = noteKey({ step: r.step, pitch });
      all.add(key);
      if (have.has(key)) continue;
      have.add(key);
      added.push({ step: r.step, len: r.len, pitch, vel: r.vel });
    }
  }
  const notes = sorted([...base, ...added]);
  if (totalNotes(song, track, notes.length) > MAX_NOTES) return null;
  return { song: withTrack(song, track, (tr) => ({ ...tr, notes })), keys: all };
}

// ---- markers, the loop region and bars ----------------------------------------------------------

export function addMarker(song: Song, step: number, name: string): Song {
  if (!Number.isInteger(step) || step < 0 || step > song.length) return song;
  const markers = [...(song.markers ?? []).filter((m) => m.step !== step), { step, name: name.trim() || "marker" }].sort((a, b) => a.step - b.step).slice(0, 64);
  return { ...song, markers };
}

export function removeMarker(song: Song, step: number): Song {
  const next = { ...song };
  const markers = (song.markers ?? []).filter((m) => m.step !== step);
  if (markers.length) next.markers = markers;
  else delete next.markers;
  return next;
}

export const markerAt = (song: Song, step: number): Marker | undefined => song.markers?.find((m) => m.step === step);

/// Sets the loop region (whole steps, from before to, inside the song); null clears it.
export function setLoop(song: Song, loop: { from: number; to: number } | null): Song {
  const next = { ...song };
  if (!loop) {
    delete next.loop;
    return next;
  }
  const from = clamp(Math.round(loop.from), 0, song.length - 1);
  const to = clamp(Math.round(loop.to), from + 1, song.length);
  next.loop = { from, to };
  return next;
}

/// The beats in a bar (1 to 16); 4 is the usual and is not written to the file.
export function setBeatsPerBar(song: Song, beats: number): Song {
  const b = clamp(Math.round(beats), 1, 16);
  const next = { ...song };
  if (b === 4) delete next.beatsPerBar;
  else next.beatsPerBar = b;
  return next;
}

/// Sets the tempo from a step on (step 0 is the song's own tempo; `null` takes a change away). A change that equals the tempo before it is not kept.
export function setTempoAt(song: Song, step: number, bpm: number | null): Song {
  const at = Math.round(step);
  if (at < 0 || at >= song.length) return song;
  if (at === 0) return bpm === null ? song : { ...song, bpm: clamp(Math.round(bpm), MIN_BPM, MAX_BPM) };
  const rest = (song.tempos ?? []).filter((t) => t.step !== at);
  if (bpm !== null) {
    if (rest.length >= MAX_TEMPOS) return song;
    rest.push({ step: at, bpm: clamp(Math.round(bpm), MIN_BPM, MAX_BPM) });
  }
  rest.sort((a, b) => a.step - b.step);
  // drop changes that repeat the tempo before them
  const out: TempoChange[] = [];
  let before = song.bpm;
  for (const t of rest) {
    if (t.bpm === before) continue;
    out.push(t);
    before = t.bpm;
  }
  const next = { ...song };
  if (out.length) next.tempos = out;
  else delete next.tempos;
  return next;
}

/// Sets the beats in a bar from a step on (a new bar starts there); `null` takes the change away.
export function setMeterAt(song: Song, step: number, beats: number | null): Song {
  const at = Math.round(step);
  if (at <= 0 || at >= song.length) return song;
  const rest = (song.meters ?? []).filter((m) => m.step !== at);
  if (beats !== null) {
    if (rest.length >= MAX_METERS) return song;
    rest.push({ step: at, beats: clamp(Math.round(beats), 1, 16) });
  }
  rest.sort((a, b) => a.step - b.step);
  const next = { ...song };
  if (rest.length) next.meters = rest;
  else delete next.meters;
  return next;
}

/// Just the steps from `from` to `to` as a song of its own, for exporting a loop: notes that start inside are kept (clipped at the end), and notes that
/// started earlier but are still sounding at `from` come in cut at the start. Markers inside come along; the loop region is dropped.
export function regionOf(song: Song, from: number, to: number): Song {
  const a = clamp(Math.round(from), 0, song.length - 1);
  const b = clamp(Math.round(to), a + 1, song.length);
  const tracks = song.tracks.map((t) => {
    const notes: Note[] = [];
    for (const n of t.notes) {
      const end = n.step + n.len;
      if (end <= a || n.step >= b) continue;
      if (t.kind === "drums" && n.step < a) continue; // a drum hit that started before is not a held note
      const step = Math.max(n.step, a) - a;
      notes.push({ ...n, step, len: Math.min(end, b) - a - step });
    }
    return { ...t, notes };
  });
  const out: Song = { ...song, length: b - a, tracks };
  delete out.loop;
  // the tempo track and the time signatures come along, shifted; the song starts at the tempo in force at `a`
  out.bpm = bpmAt(song, a);
  const tempos = (song.tempos ?? []).filter((t) => t.step > a && t.step < b).map((t) => ({ ...t, step: t.step - a }));
  if (tempos.length) out.tempos = tempos;
  else delete out.tempos;
  const meterNow = [...(song.meters ?? [])].reverse().find((m) => m.step <= a);
  if (meterNow && a > 0) out.beatsPerBar = meterNow.beats;
  const meters = (song.meters ?? []).filter((m) => m.step > a && m.step < b).map((m) => ({ ...m, step: m.step - a }));
  if (meters.length) out.meters = meters;
  else delete out.meters;
  const markers = (song.markers ?? []).filter((m) => m.step >= a && m.step < b).map((m) => ({ ...m, step: m.step - a }));
  if (markers.length) out.markers = markers;
  else delete out.markers;
  return out;
}

// ---- automation ---------------------------------------------------------------------------------

/// Sets one lane of a track (a track has at most one lane of each parameter; the others stay). `null` (with the parameter to clear) or a lane without points takes it away.
export function setLane(song: Song, track: number, lane: Lane | null, param: LaneParam = lane?.param ?? "gain"): Song {
  return withTrack(song, track, (t) => {
    const next = { ...t };
    const others = (t.automation ?? []).filter((l) => l.param !== param);
    const mine = lane && lane.points.length ? [{ ...lane, param, points: [...lane.points].sort((a, b) => a.step - b.step) }] : [];
    const all = [...others, ...mine];
    if (all.length) next.automation = all;
    else delete next.automation;
    return next;
  });
}

/// Puts one point on a lane (replacing a point on the same step); the value is held to the parameter's range. Used when a lane is drawn with the mouse.
export function setLanePoint(song: Song, track: number, param: LaneParam, step: number, value: number, curve: Lane["curve"] = "linear"): Song {
  const t = song.tracks[track];
  if (!t) return song;
  const [lo, hi] = LANE_RANGE[param];
  const old = t.automation?.find((l) => l.param === param);
  const s = Math.max(0, Math.min(song.length, Math.round(step)));
  const points = [...(old?.points ?? []).filter((p) => p.step !== s), { step: s, value: Math.round(Math.min(hi, Math.max(lo, value)) * 100) / 100 }];
  if (points.length > 256) return song;
  return setLane(song, track, { param, curve: old?.curve ?? curve, points });
}

/// A lane drawn by a low-frequency oscillator: `period` steps per cycle, swinging `depth` (0 to 1) around 1, with a point every step or two.
export function lfoLane(length: number, period: number, depth: number, shape: "sine" | "triangle" | "square" = "sine"): Lane {
  const points: Lane["points"] = [];
  const stepEvery = Math.max(1, Math.floor(period / 8));
  for (let s = 0; s <= length; s += stepEvery) {
    const ph = (s / period) % 1;
    const w = shape === "sine" ? Math.sin(2 * Math.PI * ph) : shape === "triangle" ? 1 - 4 * Math.abs(ph - 0.5) + 0 : ph < 0.5 ? 1 : -1;
    const tri = shape === "triangle" ? (ph < 0.25 ? ph * 4 : ph < 0.75 ? 2 - ph * 4 : ph * 4 - 4) : w;
    points.push({ step: s, value: +clamp(1 + tri * depth, 0, 2).toFixed(3) });
  }
  return { param: "gain", curve: shape === "square" ? "step" : "linear", points: points.slice(0, 256) };
}

/// Sets the stereo position (-1 to 1, added to the track's pan) and/or the pitch glide (-12 to 12 semitones) of the notes; 0 clears it.
export function setNoteProps(song: Song, track: number, keys: Set<string>, props: { pan?: number; bend?: number }): Song {
  return withTrack(song, track, (t) => ({
    ...t,
    notes: t.notes.map((n) => {
      if (!keys.has(noteKey(n))) return n;
      const next = { ...n };
      if (props.pan !== undefined) {
        const v = +clamp(props.pan, -1, 1).toFixed(2);
        if (v) next.pan = v;
        else delete next.pan;
      }
      if (props.bend !== undefined && t.kind === "synth") {
        const v = +clamp(props.bend, -12, 12).toFixed(2);
        if (v) next.bend = v;
        else delete next.bend;
      }
      return next;
    }),
  }));
}

/// The tempo a series of taps (times in milliseconds) beat out: the average gap of the last few taps, as beats per minute. A pause of over 2.5 seconds starts a new series.
/// null with fewer than two taps in the series.
export function tapTempo(taps: number[]): number | null {
  const series: number[] = [];
  for (const t of taps) {
    if (series.length && t - series[series.length - 1]! > 2500) series.length = 0;
    series.push(t);
  }
  const last = series.slice(-8);
  if (last.length < 2) return null;
  const bpm = 60000 / ((last[last.length - 1]! - last[0]!) / (last.length - 1));
  return Number.isFinite(bpm) ? Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm))) : null;
}
