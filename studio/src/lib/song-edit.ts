// Edits to a song that act on many notes at once (the piano roll's quantise and repeat), each returning a new song.

import { MAX_NOTES, MAX_STEPS, type Song, type Track } from "./song";

const withTrack = (song: Song, index: number, change: (t: Track) => Track): Song => ({ ...song, tracks: song.tracks.map((t, i) => (i === index ? change(t) : t)) });

/// Moves every note of a track to the nearest multiple of `grid` steps (a note never starts on top of a note of the same pitch twice).
export function quantizeTrack(song: Song, track: number, grid: number): Song {
  if (!(grid >= 1) || !Number.isInteger(grid)) return song;
  return withTrack(song, track, (t) => {
    const seen = new Set<string>();
    const notes = t.notes
      .map((n) => ({ ...n, step: Math.max(0, Math.round(n.step / grid) * grid) }))
      .filter((n) => {
        const key = `${n.step}:${n.pitch}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((n) => ({ ...n, step: Math.min(n.step, song.length - 1) }));
    return { ...t, notes };
  });
}

/// Makes the song `times` times as long, with everything played again in each copy (so a one-bar idea becomes a four-bar loop to build on).
/// Stops short of the limits on length and notes and says so by returning null.
export function repeatSong(song: Song, times: number): Song | null {
  if (!Number.isInteger(times) || times < 2) return null;
  const length = song.length * times;
  const count = song.tracks.reduce((n, t) => n + t.notes.length, 0) * times;
  if (length > MAX_STEPS || count > MAX_NOTES) return null;
  return {
    ...song,
    length,
    tracks: song.tracks.map((t) => ({ ...t, notes: Array.from({ length: times }, (_, k) => t.notes.map((n) => ({ ...n, step: n.step + k * song.length }))).flat() })),
  };
}

/// Sets the loudness of a track's notes together (every note to the same value), for a quick even level.
export function setAllVelocities(song: Song, track: number, vel: number): Song {
  const v = Math.min(1, Math.max(0, vel));
  return withTrack(song, track, (t) => ({ ...t, notes: t.notes.map((n) => ({ ...n, vel: v })) }));
}

/// The song with only one track heard, everything else as it was (the room and the master fader too): what a stem is rendered from.
export function stemSong(song: Song, track: number): Song {
  return { ...song, tracks: song.tracks.map((t, i) => ({ ...t, mute: i !== track, solo: false })) };
}

/// The file name for a stem: `<song>_<track>`, with anything but letters, numbers, - and _ in the track's name turned into _.
export function stemName(songName: string, trackName: string, taken: string[] = []): string {
  const clean = trackName.trim().replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "track";
  let name = `${songName}_${clean}`;
  for (let n = 2; taken.includes(name); n++) name = `${songName}_${clean}${n}`;
  return name;
}

// ---- groups of notes (the piano roll's selection) ---------------------------------------------------------

/// A note named by where it starts and its pitch: unique within a track, and it survives edits that reorder the notes.
export const noteKey = (n: { step: number; pitch: number }) => `${n.step}:${n.pitch}`;

export interface ClipNote {
  /// Steps after the first note of the copy, and the rest of the note.
  dstep: number;
  len: number;
  pitch: number;
  vel: number;
}

const pick = (t: Track, keys: Set<string>) => t.notes.filter((n) => keys.has(noteKey(n)));

/// The notes of a track that touch a rectangle of steps and pitches (a rubber band drawn on the roll), by key.
export function notesInBox(track: Track, step0: number, step1: number, pitchLo: number, pitchHi: number): Set<string> {
  const [a, b] = [Math.min(step0, step1), Math.max(step0, step1)];
  return new Set(track.notes.filter((n) => n.pitch >= pitchLo && n.pitch <= pitchHi && n.step <= b && n.step + n.len - 1 >= a).map(noteKey));
}

/// Moves the notes by some steps and semitones (clamped to the song and to pitches 0 to 127); notes landing on one that stays are dropped.
/// Returns the song and the keys of the moved notes in their new places.
export function moveNotes(song: Song, track: number, keys: Set<string>, dstep: number, dpitch: number): { song: Song; keys: Set<string> } {
  const t = song.tracks[track];
  if (!t || keys.size === 0) return { song, keys };
  const chosen = pick(t, keys);
  const lowest = Math.min(...chosen.map((n) => n.step));
  const highest = Math.max(...chosen.map((n) => n.step));
  const ds = Math.max(-lowest, Math.min(song.length - 1 - highest, dstep));
  const lo = Math.min(...chosen.map((n) => n.pitch));
  const hi = Math.max(...chosen.map((n) => n.pitch));
  const dp = Math.max(-lo, Math.min(127 - hi, dpitch));
  const moved = chosen.map((n) => ({ ...n, step: n.step + ds, pitch: n.pitch + dp }));
  const movedKeys = new Set(moved.map(noteKey));
  const staying = t.notes.filter((n) => !keys.has(noteKey(n)) && !movedKeys.has(noteKey(n)));
  const notes = [...staying, ...moved].sort((x, y) => x.step - y.step || x.pitch - y.pitch);
  return { song: withTrack(song, track, (tr) => ({ ...tr, notes })), keys: movedKeys };
}

export function deleteNotes(song: Song, track: number, keys: Set<string>): Song {
  return withTrack(song, track, (t) => ({ ...t, notes: t.notes.filter((n) => !keys.has(noteKey(n))) }));
}

/// The notes as a copy that can be pasted anywhere (positions relative to the first).
export function copyNotes(song: Song, track: number, keys: Set<string>): ClipNote[] {
  const t = song.tracks[track];
  if (!t) return [];
  const chosen = pick(t, keys);
  if (!chosen.length) return [];
  const first = Math.min(...chosen.map((n) => n.step));
  return chosen.map((n) => ({ dstep: n.step - first, len: n.len, pitch: n.pitch, vel: n.vel })).sort((a, b) => a.dstep - b.dstep || a.pitch - b.pitch);
}

/// Puts a copy into a track starting at a step: notes past the end of the song are left out, and a note that lands on one with the same start
/// and pitch replaces it. Returns the song and the keys of the pasted notes; null when it would pass the limit on notes.
export function pasteNotes(song: Song, track: number, clip: ClipNote[], atStep: number): { song: Song; keys: Set<string> } | null {
  const t = song.tracks[track];
  if (!t || !clip.length) return null;
  const pasted = clip
    .map((c) => ({ step: atStep + c.dstep, len: c.len, pitch: c.pitch, vel: c.vel }))
    .filter((n) => n.step >= 0 && n.step < song.length)
    .map((n) => ({ ...n, len: Math.min(n.len, song.length - n.step) }));
  if (!pasted.length) return null;
  const keys = new Set(pasted.map(noteKey));
  const notes = [...t.notes.filter((n) => !keys.has(noteKey(n))), ...pasted].sort((x, y) => x.step - y.step || x.pitch - y.pitch);
  if (song.tracks.reduce((n, tr, i) => n + (i === track ? notes.length : tr.notes.length), 0) > MAX_NOTES) return null;
  return { song: withTrack(song, track, (tr) => ({ ...tr, notes })), keys };
}
