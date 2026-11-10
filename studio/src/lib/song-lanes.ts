// Automation lanes: a value that changes over the song, read where a note starts. Kept apart from lib/song-tools.ts so the renderer can use it.

import type { Lane, Song } from "./song";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/// The value of a lane at a step: before the first point the first value, after the last the last; between points by the lane's curve
/// ("step" holds the earlier value, "linear" is a straight line, "smooth" an ease in and out). 1 (no change) for a lane with no points.
export function laneValue(lane: Lane, step: number): number {
  const p = lane.points;
  if (!p.length) return 1;
  if (step <= p[0]!.step) return p[0]!.value;
  const last = p[p.length - 1]!;
  if (step >= last.step) return last.value;
  let i = 1;
  while (p[i]!.step < step) i++;
  const a = p[i - 1]!;
  const b = p[i]!;
  if (lane.curve === "step") return a.value;
  const k = b.step === a.step ? 1 : (step - a.step) / (b.step - a.step);
  const e = lane.curve === "smooth" ? k * k * (3 - 2 * k) : k;
  return a.value + (b.value - a.value) * e;
}

/// The song with every track's gain lanes folded into its notes' loudness (each note's loudness times the lane's value at its start), so the renderer
/// need not know about lanes. Loudness stays within 0 to 1.
export function applyAutomation(song: Song): Song {
  if (!song.tracks.some((t) => t.automation?.length)) return song;
  return {
    ...song,
    tracks: song.tracks.map((t) => {
      const lanes = (t.automation ?? []).filter((l) => l.param === "gain");
      if (!lanes.length) return t;
      return { ...t, notes: t.notes.map((n) => ({ ...n, vel: clamp(n.vel * lanes.reduce((g, l) => g * laneValue(l, n.step), 1), 0, 1) })) };
    }),
  };
}
