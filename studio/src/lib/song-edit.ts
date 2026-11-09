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
