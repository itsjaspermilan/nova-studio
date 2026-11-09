// The mixer's numbers: how loud each track and the whole song are, measured by rendering them (offline, so it is exact, not a guess).

import { MAX_STEPS, renderSong, type Song } from "./song";

export interface Level {
  /// Loudest sample and average power, in dB below full scale (0 is as loud as it gets; -Infinity is silence).
  peakDb: number;
  rmsDb: number;
}

export interface Levels {
  tracks: Level[];
  master: Level;
}

export const dbfs = (amplitude: number): number => (amplitude <= 0 ? -Infinity : 20 * Math.log10(amplitude));

/// Where a level sits on a meter that runs from -60 dB (empty) to 0 dB (full).
export function meterFraction(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return Math.min(1, Math.max(0, (db + 60) / 60));
}

/// "-12.3 dB", or "silent".
export const showDb = (db: number): string => (Number.isFinite(db) ? `${db.toFixed(1)} dB` : "silent");

function levelOf(channels: Float32Array[]): Level {
  let peak = 0;
  let sum = 0;
  let n = 0;
  for (const c of channels) {
    for (let i = 0; i < c.length; i++) {
      const a = Math.abs(c[i]!);
      if (a > peak) peak = a;
      sum += a * a;
    }
    n += c.length;
  }
  return { peakDb: dbfs(peak), rmsDb: dbfs(n ? Math.sqrt(sum / n) : 0) };
}

/// Renders the whole song, and each track on its own (with its own volume and pan, the others silent), at a lower sample rate to be quick.
export function measureLevels(song: Song, rate = 22050): Levels {
  const master = levelOf(renderSong(song, rate).channels);
  const tracks = song.tracks.map((_, i) => {
    const alone: Song = { ...song, master: undefined, tracks: song.tracks.map((t, j) => ({ ...t, mute: j !== i, solo: false })) };
    alone.tracks[i] = { ...alone.tracks[i]!, mute: false };
    return levelOf(renderSong(alone, rate).channels);
  });
  return { tracks, master };
}

export { MAX_STEPS };
