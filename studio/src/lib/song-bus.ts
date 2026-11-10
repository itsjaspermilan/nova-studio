// Editing a song's buses and the routing of its tracks (every edit returns a new song). The sound itself is made in `renderSong` (lib/song.ts).

import { MAX_BUSES, MAX_MASTER, MAX_SENDS, type Bus, type Song } from "./song";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/// A new bus (named "bus", "bus2", ...), or the song as it was when it already has the most.
export function addBus(song: Song, name = "bus"): Song {
  const buses = song.buses ?? [];
  if (buses.length >= MAX_BUSES) return song;
  const used = new Set(buses.map((b) => b.name));
  const base = name.trim() || "bus";
  let unique = base;
  for (let n = 2; used.has(unique); n++) unique = `${base}${n}`;
  const next = clone(song);
  next.buses = [...buses, { name: unique, volume: 1, pan: 0, mute: false }];
  return next;
}

/// Removes a bus; tracks that played into it go straight to the master and its sends are dropped.
export function removeBus(song: Song, name: string): Song {
  if (!song.buses?.some((b) => b.name === name)) return song;
  const next = clone(song);
  next.buses = next.buses!.filter((b) => b.name !== name);
  if (!next.buses.length) delete next.buses;
  for (const t of next.tracks) {
    if (t.bus === name) delete t.bus;
    if (t.sends) {
      t.sends = t.sends.filter((s) => s.bus !== name);
      if (!t.sends.length) delete t.sends;
    }
  }
  return next;
}

/// Changes a bus. A new name is made unique and every track's route follows it.
export function updateBus(song: Song, name: string, change: Partial<Bus>): Song {
  const at = song.buses?.findIndex((b) => b.name === name) ?? -1;
  if (at < 0) return song;
  const next = clone(song);
  const bus = next.buses![at]!;
  Object.assign(bus, change);
  bus.volume = clamp(bus.volume, 0, MAX_MASTER);
  bus.pan = clamp(bus.pan, -1, 1);
  if (bus.reverb !== undefined) bus.reverb = clamp(bus.reverb, 0, 1);
  if (bus.reverb === 0) delete bus.reverb;
  if (bus.fx && !bus.fx.length) delete bus.fx;
  const wanted = bus.name.trim();
  if (!wanted || next.buses!.some((b, i) => i !== at && b.name === wanted)) bus.name = name;
  else bus.name = wanted;
  if (bus.name !== name) {
    for (const t of next.tracks) {
      if (t.bus === name) t.bus = bus.name;
      for (const s of t.sends ?? []) if (s.bus === name) s.bus = bus.name;
    }
  }
  return next;
}

/// Where a track plays: into a bus (by name) or, with `undefined`, straight to the master.
export function routeTrack(song: Song, track: number, bus: string | undefined): Song {
  if (!song.tracks[track] || (bus !== undefined && !song.buses?.some((b) => b.name === bus))) return song;
  const next = clone(song);
  if (bus === undefined) delete next.tracks[track]!.bus;
  else next.tracks[track]!.bus = bus;
  return next;
}

/// How much of a track is also sent to a bus (0 removes the send; at most MAX_SENDS per track).
export function setSend(song: Song, track: number, bus: string, level: number): Song {
  const t = song.tracks[track];
  if (!t || !song.buses?.some((b) => b.name === bus)) return song;
  const next = clone(song);
  const mine = next.tracks[track]!;
  const sends = (mine.sends ?? []).filter((s) => s.bus !== bus);
  const v = clamp(level, 0, 1);
  if (v > 0) {
    if (sends.length >= MAX_SENDS) return song;
    sends.push({ bus, level: v });
  }
  if (sends.length) mine.sends = sends;
  else delete mine.sends;
  return next;
}

export const sendLevel = (song: Song, track: number, bus: string): number => song.tracks[track]?.sends?.find((s) => s.bus === bus)?.level ?? 0;
