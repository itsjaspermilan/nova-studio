// Bringing a sound file in from outside (WAV, Ogg or MP3: whatever the system's audio decoder reads): a file name made safe for a project, the length
// cut to what a game should hold, and the choice between a sound effect (a WAV in sounds/) and music (an Ogg in music/, which the game streams).

import type { Sound } from "./wav";

export const MAX_IMPORT_SECONDS = 600;
/// Longer than this and a sound is music: it is kept as an Ogg that streams, instead of a WAV that sits in memory.
export const MUSIC_FROM_SECONDS = 15;

/// A name made of letters, digits, - and _ from a file's name (its extension dropped); "sound" when nothing is left.
export function safeSoundName(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, "").replace(/\.[A-Za-z0-9]{1,5}$/, "");
  const s = base.trim().replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
  return s || "sound";
}

/// A name that is not taken: `name`, then `name_2`, `name_3`...
export function freeName(name: string, taken: (n: string) => boolean): string {
  if (!taken(name)) return name;
  let k = 2;
  while (taken(`${name}_${k}`)) k++;
  return `${name}_${k}`;
}

export const seconds = (s: Sound) => (s.channels[0]?.length ?? 0) / Math.max(1, s.rate);

/// The sound with at most two channels (the first two) and at most `max` seconds (the rest cut off); returns whether anything was cut.
export function fitForProject(s: Sound, max = MAX_IMPORT_SECONDS): { sound: Sound; cut: boolean; mixedDown: boolean } {
  const keep = Math.min(2, s.channels.length);
  const limit = Math.floor(max * s.rate);
  const length = s.channels[0]?.length ?? 0;
  const cut = length > limit;
  const channels = s.channels.slice(0, keep).map((c) => (cut ? c.slice(0, limit) : c));
  return { sound: { rate: s.rate, channels }, cut, mixedDown: s.channels.length > 2 };
}

export type ImportKind = "effect" | "music";
export const kindFor = (s: Sound): ImportKind => (seconds(s) >= MUSIC_FROM_SECONDS ? "music" : "effect");
