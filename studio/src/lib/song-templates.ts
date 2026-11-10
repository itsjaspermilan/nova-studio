// Starter songs for "New song": each is a complete little loop to listen to and change, made from the same tools the editor has (a chord pattern, a bass line,
// drums). Notes are put in by pattern so the file stays a plain song file; nothing here is copied from any piece of music.

import { MAX_STEPS, drumTrack, synthTrack, type Note, type Song, type Track } from "./song";

const note = (step: number, len: number, pitch: number, vel = 0.8): Note => ({ step, len, pitch, vel });
const track = (name: string, wave: Track["wave"], notes: Note[], patch: Partial<Track> = {}): Track => ({ ...synthTrack(name, wave), notes, ...patch });
const drums = (hits: Record<number, number[]>, len: number, kit: "chip" | "studio" = "chip", vel = 0.85): Track => {
  const t = drumTrack("drums");
  t.kit = kit;
  t.notes = Object.entries(hits).flatMap(([pitch, steps]) => steps.map((s) => note(s, 1, Number(pitch), pitch === "42" ? vel * 0.7 : vel))).filter((n) => n.step < len).sort((a, b) => a.step - b.step || a.pitch - b.pitch);
  return t;
};
const every = (from: number, to: number, by: number) => Array.from({ length: Math.max(0, Math.ceil((to - from) / by)) }, (_, i) => from + i * by);

export interface SongTemplate {
  id: string;
  name: string;
  blurb: string;
  make: () => Song;
}

const base = (bpm: number, length: number, tracks: Track[], extra: Partial<Song> = {}): Song => ({ version: 1, bpm, stepsPerBeat: 4, length: Math.min(MAX_STEPS, length), tracks, ...extra });

export const SONG_TEMPLATES: SongTemplate[] = [
  {
    id: "blank",
    name: "Blank",
    blurb: "Two bars with one lead and a drum track to start from.",
    make: () => {
      const lead = track("lead", "square", [60, 64, 67, 72].map((p, i) => note(i * 4, 3, p)));
      return base(120, 16, [lead, drums({ 36: [0, 4, 8, 12], 38: [4, 12] }, 16)]);
    },
  },
  {
    id: "chiptune",
    name: "Chiptune adventure",
    blurb: "A bright four-bar loop: square lead, triangle bass, light drums. Good for a title or an overworld.",
    make: () => {
      // C major, I - V - vi - IV, one bar each (16 steps)
      const chords: [number, number[]][] = [[48, [60, 64, 67]], [43, [59, 62, 67]], [45, [60, 64, 69]], [41, [60, 65, 69]]];
      const bass = chords.flatMap(([root], bar) => every(0, 16, 4).map((s) => note(bar * 16 + s, 3, root, 0.85)));
      const arp = chords.flatMap(([, ch], bar) => every(0, 16, 2).map((s, i) => note(bar * 16 + s, 2, ch[i % 3]! + 12, 0.6)));
      const melody = [[0, 4, 76], [4, 2, 74], [6, 2, 72], [8, 4, 74], [16, 4, 71], [20, 4, 74], [24, 8, 79], [32, 4, 76], [36, 2, 77], [38, 2, 76], [40, 4, 72], [48, 4, 77], [52, 4, 74], [56, 8, 72]].map(([s, l, p]) => note(s!, l!, p!, 0.9));
      return base(132, 64, [
        track("lead", "square", melody, { duty: 0.25, volume: 0.45 }),
        track("arp", "square", arp, { duty: 0.125, volume: 0.28 }),
        track("bass", "triangle", bass, { volume: 0.6 }),
        drums({ 36: every(0, 64, 8), 38: every(4, 64, 8), 42: every(0, 64, 2) }, 64),
      ]);
    },
  },
  {
    id: "techno",
    name: "Night drive (four on the floor)",
    blurb: "A steady 128 bpm beat with a pulsing bass and a filtered stab. Good for racing and chases.",
    make: () => {
      const bassLine = every(0, 32, 4).flatMap((s) => [note(s + 2, 1, s % 16 < 8 ? 36 : 39, 0.9), note(s + 3, 1, s % 16 < 8 ? 36 : 39, 0.7)]);
      const stabs = [0, 6, 10, 16, 22, 26].map((s, i) => note(s, 2, [60, 63, 67][i % 3]! + (s >= 16 ? 5 : 0), 0.7));
      return base(128, 32, [
        track("bass", "saw", bassLine, { volume: 0.55, cutoff: 600, resonance: 0.3, sweep: 0.5, sub: 0.5, release: 0.08 }),
        track("stab", "square", stabs, { volume: 0.35, cutoff: 1800, sweep: 0.4, unison: 3, detune: 10, reverb: 0.3, echo: 0.3, echoTime: 3 }),
        drums({ 36: every(0, 32, 4), 39: every(4, 32, 8), 42: every(2, 32, 4), 46: every(14, 32, 16) }, 32, "studio"),
      ], { room: { size: 0.5, damping: 0.5, mix: 0.8 } });
    },
  },
  {
    id: "lullaby",
    name: "Lullaby",
    blurb: "A slow, gentle loop on a plucked instrument and a soft pad. Good for a menu or a quiet scene.",
    make: () => {
      const tune = [[0, 4, 72], [4, 4, 71], [8, 8, 67], [16, 4, 69], [20, 4, 67], [24, 8, 64], [32, 4, 65], [36, 4, 64], [40, 4, 62], [44, 4, 64], [48, 12, 60]].map(([s, l, p]) => note(s!, l!, p!, 0.75));
      const pad = [[0, 16, [48, 55, 64]], [16, 16, [45, 52, 60]], [32, 16, [41, 48, 57]], [48, 16, [43, 50, 59]]].flatMap(([s, l, ch]) => (ch as number[]).map((p) => note(s as number, l as number, p, 0.4)));
      return base(72, 64, [
        track("melody", "pluck", tune, { damping: 0.85, brightness: 0.5, volume: 0.6, reverb: 0.4 }),
        track("pad", "sine", pad, { attack: 0.6, release: 1.2, sustain: 0.8, volume: 0.35, unison: 3, detune: 8, reverb: 0.5 }),
      ], { room: { size: 0.7, damping: 0.5, mix: 1 } });
    },
  },
  {
    id: "battle",
    name: "Battle drums",
    blurb: "A tense minor loop with a driving bass and snare rolls. Good for a fight or a boss.",
    make: () => {
      // A minor, i - VI - VII - i
      const roots = [45, 41, 43, 45];
      const bass = roots.flatMap((r, bar) => every(0, 16, 2).map((s) => note(bar * 16 + s, 1, r, s % 4 === 0 ? 0.9 : 0.65)));
      const riff = roots.flatMap((r, bar) => [0, 3, 6, 8, 11, 14].map((s, i) => note(bar * 16 + s, 2, r + 24 + [0, 3, 7, 3, 7, 10][i]!, 0.7)));
      const roll = every(56, 64, 1).map((s) => note(s, 1, 38, 0.5 + ((s - 56) / 8) * 0.4));
      const d = drums({ 36: [...every(0, 64, 8), ...every(3, 64, 8)], 38: every(4, 56, 8), 49: [0, 32], 42: every(0, 56, 2) }, 64, "studio");
      d.notes = [...d.notes, ...roll].sort((a, b) => a.step - b.step || a.pitch - b.pitch);
      return base(150, 64, [
        track("riff", "saw", riff, { volume: 0.4, cutoff: 2400, resonance: 0.2, sweep: 0.3, unison: 3, detune: 12 }),
        track("bass", "square", bass, { volume: 0.5, duty: 0.3, cutoff: 900, sweep: 0.3 }),
        d,
      ], { room: { size: 0.4, damping: 0.6, mix: 0.6 } });
    },
  },
];

export const templateById = (id: string) => SONG_TEMPLATES.find((t) => t.id === id) ?? SONG_TEMPLATES[0]!;
