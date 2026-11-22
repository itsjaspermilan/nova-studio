// song_make: a short looping song from a mood, a key and a tempo. It writes an ordinary step-sequencer song (the same
// `.song.json` song_write takes and the music editor opens): a melody, a bass, a harmony part and drums that follow one
// chord progression, eight bars that come round to the start again. The same mood, key, tempo and seed give the same song.
//
// How it is put together: the mood picks the scale, the progression, the rhythm of each part and the instruments. The
// melody lands on a note of the bar's chord on the strong beats and walks along the scale between them; bars five and
// six repeat one and two (so there is a tune to remember), and the last bar ends on the chord that leads home.

import { rngOf } from "./paint";

type Args = Record<string, any>;
type NoteSpec = { step: number; len: number; pitch: number; vel: number };

const MAJOR = [0, 2, 4, 5, 7, 9, 11], MINOR = [0, 2, 3, 5, 7, 8, 10];
const KEYS: Record<string, number> = { c: 0, "c#": 1, db: 1, d: 2, "d#": 3, eb: 3, e: 4, f: 5, "f#": 6, gb: 6, g: 7, "g#": 8, ab: 8, a: 9, "a#": 10, bb: 10, b: 11 };

type Rhythm = [number, number][]; // [first step of the bar, length in steps]

interface Mood {
  what: string;
  minor: boolean;
  key: string;
  bpm: number;
  /// A chord per bar, as steps of the scale from the key note (0 is the home chord, 4 the one that leads back to it).
  chords: number[];
  lead: Record<string, unknown>;
  rhythms: Rhythm[];
  /// The harmony part: held chords, or the chord's notes one after another.
  harmony: "held" | "broken";
  bass: Rhythm;
  /// Which note of the chord the bass plays on each of its notes: 0 the root, 4 the fifth above, 7 the octave.
  bassLine: number[];
  drums: { kick: number[]; snare: number[]; hat: number[]; hatVel: number; crash?: boolean; open?: number[]; clap?: boolean };
  bars: number;
  /// The fuller voices (song.ts): the harmony part's and the bass's instrument, the drum kit and its room send. Every mood has them: the
  /// plain chip voice and the chip kit are what makes a song sound like an old console (docs/sound-for-agents.md).
  harmonyVoice: Record<string, unknown>;
  bassVoice: Record<string, unknown>;
  kit: "studio" | "punch";
  drumReverb: number;
  /// Synthwave: a fast arpeggio of the bar's chord, and held pads under it (then the harmony part is the pad).
  arp?: Record<string, unknown>;
  room?: { size: number; damping: number; mix: number };
  /// The B section's chords (default VI IV I V VI IV VII V, as steps of the scale).
  chordsB?: number[];
  /// A second bass track, the bass line an octave up and quieter: the part of the bass a handheld's or a phone's speaker plays.
  bassHi?: Record<string, unknown>;
}

export const MOODS: Record<string, Mood> = {
  "calm village": {
    what: "gentle and unhurried, for a village or a home", minor: false, key: "g", bpm: 96, chords: [0, 5, 3, 4, 0, 5, 3, 4], bars: 8,
    lead: { wave: "triangle", attack: 0.02, decay: 0.2, sustain: 0.6, release: 0.2, volume: 0.42, vibrato: 0.06, reverb: 0.25, unison: 2, detune: 6, cutoff: 3200 },
    harmonyVoice: { wave: "saw", unison: 3, detune: 12, cutoff: 1100, attack: 0.25, decay: 0.3, sustain: 0.7, release: 0.5, volume: 0.13, reverb: 0.4 },
    bassVoice: { wave: "saw", cutoff: 420, sweep: 0.25, sub: 0.4, attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.1, volume: 0.36 },
    kit: "studio", drumReverb: 0.12,
    rhythms: [[[0, 4], [4, 2], [6, 2], [8, 6], [14, 2]], [[0, 6], [6, 2], [8, 4], [12, 4]], [[0, 2], [2, 2], [4, 4], [8, 8]], [[0, 4], [4, 4], [8, 2], [10, 2], [12, 4]]],
    harmony: "held", bass: [[0, 6], [8, 6]], bassLine: [0, 4],
    drums: { kick: [0], snare: [], hat: [4, 12], hatVel: 0.3 },
  },
  "adventure field": {
    what: "bright and striding, for the open map", minor: false, key: "c", bpm: 132, chords: [0, 3, 4, 0, 5, 3, 4, 4], bars: 8,
    lead: { wave: "square", duty: 0.5, attack: 0.008, decay: 0.12, sustain: 0.55, release: 0.1, volume: 0.3, unison: 2, detune: 8, cutoff: 4200, sweep: 0.3, reverb: 0.18, echo: 0.2, echoTime: 3 },
    harmonyVoice: { wave: "saw", cutoff: 1500, sweep: 0.6, attack: 0.005, decay: 0.15, sustain: 0.25, release: 0.1, volume: 0.17, pan: -0.3, reverb: 0.25 },
    bassVoice: { wave: "saw", unison: 2, detune: 6, cutoff: 900, sweep: 0.5, sub: 0.2, attack: 0.005, decay: 0.12, sustain: 0.5, release: 0.06, volume: 0.34, duck: 0.2 },
    bassHi: { wave: "triangle", cutoff: 1800, attack: 0.005, decay: 0.1, sustain: 0.4, release: 0.06, volume: 0.12, duck: 0.2 },
    kit: "studio", drumReverb: 0.1,
    rhythms: [[[0, 2], [2, 2], [4, 2], [6, 2], [8, 4], [12, 2], [14, 2]], [[0, 3], [3, 3], [6, 2], [8, 4], [12, 4]], [[0, 2], [2, 1], [3, 1], [4, 4], [8, 2], [10, 2], [12, 4]], [[0, 4], [4, 2], [6, 2], [8, 3], [11, 3], [14, 2]]],
    harmony: "broken", bass: [[0, 2], [2, 2], [4, 2], [6, 2], [8, 2], [10, 2], [12, 2], [14, 2]], bassLine: [0, 0, 4, 0, 0, 0, 4, 7],
    drums: { kick: [0, 8, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], hatVel: 0.35 },
  },
  dungeon: {
    what: "slow, low and uneasy, for caves and ruins", minor: true, key: "d", bpm: 84, chords: [0, 5, 3, 4, 0, 5, 6, 4], bars: 8,
    lead: { wave: "triangle", attack: 0.03, decay: 0.3, sustain: 0.5, release: 0.3, volume: 0.42, reverb: 0.5, unison: 2, detune: 7, echo: 0.25, echoTime: 6 },
    harmonyVoice: { wave: "saw", unison: 4, detune: 14, cutoff: 800, attack: 0.5, decay: 0.4, sustain: 0.7, release: 0.8, volume: 0.13, reverb: 0.5 },
    bassVoice: { wave: "saw", cutoff: 330, sweep: 0.3, sub: 0.5, attack: 0.02, decay: 0.3, sustain: 0.6, release: 0.2, volume: 0.36 },
    kit: "studio", drumReverb: 0.3,
    rhythms: [[[0, 8], [8, 4], [12, 4]], [[0, 6], [6, 6], [12, 4]], [[0, 4], [4, 4], [8, 8]], [[0, 12], [12, 4]]],
    harmony: "held", bass: [[0, 4], [6, 2], [8, 6]], bassLine: [0, 0, 4],
    drums: { kick: [0, 10], snare: [], hat: [8], hatVel: 0.25 },
  },
  boss: {
    what: "fast and driving, for a fight", minor: true, key: "e", bpm: 156, chords: [0, 0, 5, 6, 0, 0, 3, 4], bars: 8,
    lead: { wave: "saw", attack: 0.005, decay: 0.1, sustain: 0.6, release: 0.08, volume: 0.26, cutoff: 3200, unison: 3, detune: 14, sweep: 0.3, reverb: 0.15 },
    harmonyVoice: { wave: "saw", cutoff: 1400, sweep: 0.6, attack: 0.005, decay: 0.12, sustain: 0.2, release: 0.08, volume: 0.17, pan: -0.3, reverb: 0.2 },
    bassVoice: { wave: "saw", unison: 2, detune: 8, cutoff: 950, sweep: 0.6, sub: 0.1, attack: 0.004, decay: 0.1, sustain: 0.4, release: 0.05, volume: 0.32, duck: 0.3, fx: [{ type: "distortion", params: { drive: 3, tone: 3500, mix: 0.4 } }] },
    bassHi: { wave: "square", cutoff: 2000, sweep: 0.3, attack: 0.003, decay: 0.08, sustain: 0.3, release: 0.04, volume: 0.12, duck: 0.3 },
    kit: "punch", drumReverb: 0.12,
    rhythms: [[[0, 1], [1, 1], [2, 2], [4, 2], [6, 2], [8, 1], [9, 1], [10, 2], [12, 4]], [[0, 2], [2, 2], [4, 1], [5, 1], [6, 2], [8, 3], [11, 3], [14, 2]], [[0, 3], [3, 3], [6, 2], [8, 2], [10, 2], [12, 2], [14, 2]]],
    harmony: "broken", bass: [[0, 1], [2, 1], [4, 1], [6, 1], [8, 1], [10, 1], [12, 1], [14, 1]], bassLine: [0, 0, 7, 0, 0, 0, 7, 4],
    drums: { kick: [0, 4, 8, 12], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], hatVel: 0.4, crash: true },
  },
  title: {
    what: "open and hopeful, for the title screen", minor: false, key: "f", bpm: 108, chords: [0, 4, 5, 2, 3, 0, 3, 4], bars: 8,
    lead: { wave: "square", duty: 0.5, attack: 0.01, decay: 0.18, sustain: 0.55, release: 0.16, volume: 0.3, vibrato: 0.08, reverb: 0.3, unison: 2, detune: 8, cutoff: 3600, echo: 0.2, echoTime: 3 },
    harmonyVoice: { wave: "saw", cutoff: 1600, sweep: 0.5, attack: 0.005, decay: 0.2, sustain: 0.3, release: 0.15, volume: 0.16, pan: -0.3, reverb: 0.35 },
    bassVoice: { wave: "saw", cutoff: 500, sweep: 0.35, sub: 0.4, attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.1, volume: 0.36, duck: 0.2 },
    kit: "studio", drumReverb: 0.15,
    rhythms: [[[0, 6], [6, 2], [8, 4], [12, 4]], [[0, 4], [4, 4], [8, 6], [14, 2]], [[0, 2], [2, 2], [4, 4], [8, 8]], [[0, 3], [3, 3], [6, 2], [8, 8]]],
    harmony: "broken", bass: [[0, 4], [4, 4], [8, 4], [12, 4]], bassLine: [0, 4, 7, 4],
    drums: { kick: [0, 8], snare: [12], hat: [4, 6, 12, 14], hatVel: 0.3 },
  },
  "victory jingle": {
    what: "a short fanfare for a win (three bars; it loops like any song, so stop it or play it once as you need)", minor: false, key: "c", bpm: 140, chords: [0, 3, 0], bars: 3,
    lead: { wave: "square", duty: 0.5, attack: 0.005, decay: 0.1, sustain: 0.6, release: 0.12, volume: 0.32, unison: 2, detune: 8, cutoff: 5000, reverb: 0.3 },
    harmonyVoice: { wave: "saw", unison: 3, detune: 12, cutoff: 1800, attack: 0.02, decay: 0.3, sustain: 0.6, release: 0.3, volume: 0.13, reverb: 0.35 },
    bassVoice: { wave: "saw", cutoff: 550, sweep: 0.4, sub: 0.4, attack: 0.005, decay: 0.2, sustain: 0.6, release: 0.1, volume: 0.36 },
    kit: "studio", drumReverb: 0.2,
    rhythms: [[[0, 2], [2, 2], [4, 2], [6, 2], [8, 4], [12, 4]], [[0, 3], [3, 1], [4, 4], [8, 4], [12, 4]], [[0, 12], [12, 4]]],
    harmony: "held", bass: [[0, 4], [4, 4], [8, 8]], bassLine: [0, 4, 0],
    drums: { kick: [0, 8], snare: [4, 12, 14], hat: [], hatVel: 0.3, crash: true },
  },
  synthwave: {
    what: "driving synthwave for a fight: a fast bright arpeggio, a detuned saw lead and bass that pump with the kick, big gated drums, wide pads", minor: true, key: "a", bpm: 118, chords: [0, 5, 2, 6, 0, 5, 3, 4], bars: 8,
    lead: { wave: "saw", attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.15, volume: 0.2, unison: 3, detune: 12, cutoff: 3400, sweep: 0.25, vibrato: 0.08, reverb: 0.3, echo: 0.22, echoTime: 3, echoFeedback: 0.35, pan: 0.05 },
    rhythms: [[[0, 4], [4, 2], [6, 2], [8, 6], [14, 2]], [[0, 3], [3, 3], [6, 2], [8, 4], [12, 4]], [[0, 6], [6, 2], [8, 2], [10, 2], [12, 4]], [[0, 8], [8, 4], [12, 4]]],
    harmony: "held", bass: [[0, 2], [2, 2], [4, 2], [6, 2], [8, 2], [10, 2], [12, 2], [14, 2]], bassLine: [0, 7, 0, 7, 0, 7, 0, 7],
    drums: { kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14], hatVel: 0.42, crash: true, open: [14], clap: true },
    harmonyVoice: { wave: "saw", unison: 5, detune: 18, cutoff: 1500, resonance: 0.1, attack: 0.3, decay: 0.4, sustain: 0.8, release: 0.6, volume: 0.13, reverb: 0.45, duck: 0.5 },
    bassVoice: { wave: "saw", unison: 2, detune: 7, cutoff: 1100, resonance: 0.2, sweep: 0.5, sub: 0.08, attack: 0.003, decay: 0.12, sustain: 0.45, release: 0.05, volume: 0.28, duck: 0.35, fx: [{ type: "distortion", params: { drive: 3, tone: 3500, mix: 0.45 } }] },
    bassHi: { wave: "saw", unison: 2, detune: 12, cutoff: 2200, sweep: 0.4, attack: 0.003, decay: 0.1, sustain: 0.3, release: 0.05, volume: 0.18, pan: 0.1, duck: 0.35 },
    arp: { wave: "square", unison: 2, detune: 6, cutoff: 1900, resonance: 0.25, sweep: 0.7, attack: 0.002, decay: 0.1, sustain: 0.15, release: 0.05, volume: 0.17, reverb: 0.25, echo: 0.3, echoTime: 3, echoFeedback: 0.4, duck: 0.25 },
    kit: "punch", drumReverb: 0.15, room: { size: 0.6, damping: 0.35, mix: 1 },
  },
  "synthwave night": {
    what: "slow, dreamy synthwave for a hub or a night street: soft arpeggios through echo, wide pads that breathe with the kick, a warm bass", minor: true, key: "d", bpm: 92, chords: [0, 5, 3, 6, 0, 5, 3, 4], bars: 8,
    lead: { wave: "triangle", attack: 0.03, decay: 0.3, sustain: 0.6, release: 0.4, volume: 0.3, unison: 2, detune: 8, cutoff: 2600, vibrato: 0.1, reverb: 0.45, echo: 0.3, echoTime: 6, echoFeedback: 0.4 },
    rhythms: [[[0, 6], [6, 2], [8, 8]], [[0, 4], [4, 4], [8, 6], [14, 2]], [[0, 8], [8, 4], [12, 4]], [[0, 12], [12, 4]]],
    harmony: "held", bass: [[0, 3], [3, 3], [6, 2], [8, 3], [11, 3], [14, 2]], bassLine: [0, 0, 7, 0, 0, 4],
    drums: { kick: [0, 8], snare: [4, 12], hat: [2, 6, 10, 14], hatVel: 0.3, open: [14] },
    harmonyVoice: { wave: "saw", unison: 5, detune: 20, cutoff: 1100, attack: 0.6, decay: 0.5, sustain: 0.8, release: 0.9, volume: 0.14, reverb: 0.55, duck: 0.4 },
    bassVoice: { wave: "saw", unison: 2, detune: 6, cutoff: 700, sweep: 0.35, sub: 0.15, attack: 0.01, decay: 0.3, sustain: 0.6, release: 0.15, volume: 0.34, duck: 0.25, fx: [{ type: "distortion", params: { drive: 2.5, tone: 3000, mix: 0.35 } }] },
    bassHi: { wave: "triangle", unison: 2, detune: 8, cutoff: 1500, attack: 0.01, decay: 0.3, sustain: 0.5, release: 0.15, volume: 0.13, pan: -0.1, duck: 0.25 },
    arp: { wave: "saw", cutoff: 1300, sweep: 0.6, attack: 0.003, decay: 0.15, sustain: 0.1, release: 0.1, volume: 0.13, reverb: 0.35, echo: 0.35, echoTime: 3, echoFeedback: 0.45, pan: 0.2, duck: 0.2 },
    kit: "punch", drumReverb: 0.25, room: { size: 0.75, damping: 0.45, mix: 1 },
  },
};

export const MOOD_NAMES = Object.keys(MOODS);

/// `song_make`: the song as song_write takes it. Throws with the list of moods or keys when one is not known.
export function makeSong(a: Args): { song: Record<string, unknown>; said: string } {
  const moodName = String(a.mood ?? "").trim().toLowerCase().replace(/[_-]/g, " ");
  const mood = MOODS[moodName] ?? MOODS[MOOD_NAMES.find((n) => n.split(" ").includes(moodName)) ?? ""];
  if (!mood) throw new Error(`"mood" is one of: ${MOOD_NAMES.map((n) => `"${n}" (${MOODS[n]!.what})`).join("; ")}`);
  // the key: a note name, with "minor" or "major" to go against the mood's own
  const keyText = String(a.key ?? mood.key).trim().toLowerCase();
  const m = /^([a-g](?:#|b)?)\s*(m|min|minor|maj|major)?$/.exec(keyText);
  if (!m || KEYS[m[1]!] === undefined) throw new Error(`"key" is a note name, with "minor" or "major" if the mood's own is not wanted: "C", "A minor", "F# major" (got '${a.key}')`);
  const minor = m[2] ? /^m(in|inor)?$/.test(m[2]) : mood.minor;
  const scale = minor ? MINOR : MAJOR;
  const bpm = a.tempo === undefined ? mood.bpm : Number(a.tempo);
  if (!(bpm >= 40 && bpm <= 240)) throw new Error(`"tempo" is beats per minute, 40 to 240 (this mood's own is ${mood.bpm})`);
  const seed = Math.floor(Number(a.seed ?? 1)) || 0;
  const rng = rngOf(seed * 7919 + moodName.length);
  const pc = KEYS[m[1]!]!;
  // the key note for the melody sits around middle C, the bass an octave or two below but never under what a small speaker plays
  const tonic = 60 + (pc > 6 ? pc - 12 : pc);
  let bassTonic = tonic - 24;
  while (bassTonic < 43) bassTonic += 12;
  const pitchOf = (degree: number, base: number) => base + 12 * Math.floor(degree / 7) + scale[((degree % 7) + 7) % 7]!;
  const lowRoot = (root: number) => (root > bassTonic + 9 && root - 12 >= 43 ? root - 12 : root);
  const BAR = 16;

  // ---- the form: sections of bars. A song (the default) is an intro that plays once, then A, B, a break and A again, which loop
  // (the loop comes back from the last A's fill to the first A, as one section goes to the next, not as a restart); at least 32 bars
  // and about a minute or more. `form: "loop"` is the old single 8-bar loop. The victory jingle is always its three bars.
  const formName = a.form === undefined ? (mood.bars === 3 ? "loop" : "song") : String(a.form).trim().toLowerCase();
  if (formName !== "song" && formName !== "loop") throw new Error(`"form" is "song" (an intro, then A, B, a break and A again, looping from the first A: a minute or more) or "loop" (one ${mood.bars}-bar loop) (got '${a.form}')`);
  type Kind = "intro" | "A" | "B" | "break" | "A2";
  interface Section { kind: Kind; chords: number[] }
  const chordsB = mood.chordsB ?? [5, 3, 0, 4, 5, 3, 6, 4];
  const sections: Section[] = [];
  if (formName === "loop") sections.push({ kind: "A", chords: mood.chords });
  else {
    sections.push({ kind: "intro", chords: mood.chords.slice(0, 4) }, { kind: "A", chords: mood.chords }, { kind: "B", chords: chordsB }, { kind: "break", chords: [chordsB[0]!, chordsB[1]!, chordsB[0]!, 4] }, { kind: "A2", chords: mood.chords });
    // a fast song gets a second B before the break, so that the loop lasts 50 seconds or more
    const loopBars = sections.slice(1).reduce((s, x) => s + x.chords.length, 0);
    if ((loopBars * 4 * 60) / bpm < 50) sections.splice(3, 0, { kind: "B", chords: chordsB });
  }
  const bars = sections.reduce((s, x) => s + x.chords.length, 0), length = BAR * bars;
  const loopFrom = formName === "song" ? sections[0]!.chords.length * BAR : 0;

  // the melody of a section, as steps of the scale from the key note (bars five and six say one and two again)
  const melody = (chords: number[], from: number, r: () => number): NoteSpec[] => {
    const out: NoteSpec[] = [];
    const barNotes: { rhythm: Rhythm; degrees: number[] }[] = [];
    let at = 4 + Math.floor(r() * 3); // start around the fifth
    const n = chords.length;
    for (let bar = 0; bar < n; bar++) {
      const chord = chords[bar]!;
      const tones = [chord, chord + 2, chord + 4, chord + 7, chord - 3, chord - 5, chord + 9];
      const last = bar === n - 1;
      const again = n === 8 && (bar === 4 || bar === 5) ? barNotes[bar - 4] : undefined;
      const rhythm = again?.rhythm ?? (last ? mood.rhythms[mood.rhythms.length - 1]! : mood.rhythms[Math.floor(r() * (mood.rhythms.length - (n === 3 ? 1 : 0)))]!);
      const way = r() < 0.5 ? 1 : -1;
      const degrees: number[] = [];
      rhythm.forEach(([start, len], i) => {
        let d: number;
        if (again) d = again.degrees[i]!;
        else {
          const strong = start % 8 === 0 || len >= 4 || i === rhythm.length - 1;
          if (strong) {
            // the nearest note of the chord (sometimes the next nearest), kept within an octave and a half
            const near = tones.filter((t) => t >= -2 && t <= 10).sort((p, q) => Math.abs(p - at) - Math.abs(q - at));
            d = near[r() < 0.7 || near.length < 2 ? 0 : 1] ?? chord;
          } else d = at + (r() < 0.75 ? way : -way) * (r() < 0.8 ? 1 : 2);
          if (d > 10) d -= 2;
          if (d < -2) d += 2;
          if (last && i === rhythm.length - 1 && n !== 3) d = [chord, chord + 2, chord + 4].sort((p, q) => Math.abs(p - at) - Math.abs(q - at))[0]!;
          if (n === 3 && last) d = i === 0 ? 7 : 4; // a fanfare ends on the high key note
        }
        at = d;
        degrees.push(d);
        out.push({ step: from + bar * BAR + start, len, pitch: pitchOf(d, tonic), vel: start % 8 === 0 ? 0.85 : 0.7 });
      });
      barNotes.push({ rhythm, degrees });
    }
    return out;
  };

  const lead: NoteSpec[] = [], harmony: NoteSpec[] = [], bass: NoteSpec[] = [], bassHi: NoteSpec[] = [], drums: NoteSpec[] = [], arp: NoteSpec[] = [];
  const driving = mood.drums.kick.length >= 3;
  let tuneA: NoteSpec[] | undefined;
  let tuneB: NoteSpec[] | undefined;
  let s0 = 0;
  for (const [si, sec] of sections.entries()) {
    const start = s0;
    const n = sec.chords.length;
    // the lead: the A tune (the same each time it comes back, the second time with a third above it), a B tune of its own, none in the intro and the break
    if (sec.kind === "A" || sec.kind === "A2") {
      tuneA ??= melody(sec.chords, 0, rng);
      for (const nt of tuneA) {
        lead.push({ ...nt, step: start + nt.step });
        if (sec.kind === "A2") lead.push({ ...nt, step: start + nt.step, pitch: nt.pitch + (scale.includes((nt.pitch - tonic + 4 + 120) % 12) ? 4 : 3), vel: nt.vel * 0.6 });
      }
    } else if (sec.kind === "B") {
      tuneB ??= melody(sec.chords, 0, rngOf(seed * 7919 + moodName.length + 101));
      for (const nt of tuneB) lead.push({ ...nt, step: start + nt.step });
    }
    for (let bar = 0; bar < n; bar++) {
      const chord = sec.chords[bar]!, b0 = start + bar * BAR, lastBar = bar === n - 1;
      // (the intro's last bar stops early: the loop comes back to the first A after the last A, not after the intro, so nothing of the
      // intro may still ring there)
      const introEnd = sec.kind === "intro" && lastBar;
      const triad = [chord, chord + 2, chord + 4].map((d) => pitchOf(d, tonic - 12)).map((p) => (p < tonic - 10 ? p + 12 : p));
      // harmony below the melody: the chord's three notes, held or one after another (held in the intro and the break)
      if (mood.harmony === "held" || sec.kind === "intro" || sec.kind === "break") for (const p of triad) harmony.push({ step: b0, len: introEnd ? 10 : BAR, pitch: p, vel: sec.kind === "intro" ? 0.4 : 0.5 });
      else for (let i = 0; i < 8; i++) harmony.push({ step: b0 + i * 2, len: 2, pitch: triad[[0, 1, 2, 1][i % 4]!]!, vel: i % 4 === 0 ? 0.6 : 0.45 });
      // the bass: its pattern, held roots in the break and the intro's second half, nothing at the very start
      const root = lowRoot(pitchOf(chord, bassTonic));
      const bassNotes: NoteSpec[] = [];
      if (sec.kind === "intro" || sec.kind === "break") {
        if (sec.kind === "break" || bar >= n / 2) bassNotes.push({ step: b0, len: introEnd ? 10 : BAR, pitch: root, vel: 0.7 });
      } else {
        mood.bass.forEach(([st, len], i) => {
          const up = mood.bassLine[i % mood.bassLine.length]!;
          // (B pushes: on its offbeats the bass takes the octave)
          const push = sec.kind === "B" && st % 4 === 2 && up === 0 && driving ? 12 : 0;
          bassNotes.push({ step: b0 + st, len, pitch: root + push + (up === 4 ? 7 : up === 7 && root + 12 <= bassTonic + 14 ? 12 : up === 7 ? 7 : 0), vel: i === 0 ? 0.85 : 0.7 });
        });
      }
      bass.push(...bassNotes);
      // the bass an octave up, quieter: the part of the bass line a handheld's or a phone's speaker can play
      if (mood.bassHi) for (const nt of bassNotes) bassHi.push({ ...nt, pitch: nt.pitch + 12 });
      // drums
      const d = mood.drums;
      const hit = (st: number, pitch: number, vel: number) => drums.push({ step: b0 + st, len: 1, pitch, vel });
      if (sec.kind === "intro") {
        // the hats alone, then the kick on the last bar with a snare roll that leads in
        if (bar >= n / 2) for (const hh of d.hat) hit(hh, 42, d.hatVel * 0.8);
        if (lastBar && d.snare.length) {
          for (const k of d.kick) if (k < 10) hit(k, 36, 0.7);
          for (let st = 4; st < 12; st += driving ? 1 : 2) hit(st, 38, 0.3 + ((st - 4) / 8) * 0.5);
        }
      } else if (sec.kind === "break") {
        // the drums drop out: a kick on the one, then a roll into the last A
        if (!lastBar) hit(0, 36, 0.6);
        else if (d.snare.length) for (let st = 0; st < 16; st += st < 8 ? 2 : 1) hit(st, 38, 0.3 + (st / 16) * 0.55);
      } else {
        const alt = sec.kind === "B";
        for (const k of d.kick) hit(k, 36, 0.75);
        if (alt && driving) hit(14, 36, 0.6); // (a push before the next bar)
        for (const sn of d.snare) hit(sn, 38, 0.7);
        if (d.clap) for (const sn of d.snare) hit(sn, 39, 0.5);
        // hats: B opens them on the offbeats; the last A doubles them for lift
        const hats = sec.kind === "A2" && d.hat.length >= 4 ? [...new Set([...d.hat, ...d.hat.map((h) => (h + 1) % 16)])].sort((x, y) => x - y) : d.hat;
        for (const hh of hats) hit(hh, (d.open ?? []).includes(hh) || (alt && hh % 8 === 6) ? 46 : 42, hats === d.hat ? d.hatVel : d.hatVel * 0.75);
        // a fill at the end of every section, and a crash where the next one starts
        if (lastBar && d.snare.length) for (const st of [12, 13, 14, 15]) hit(st, st === 15 ? 38 : 45, 0.5 + (st - 12) * 0.08);
        if (bar === 0 && (d.crash || formName === "song")) hit(0, 49, 0.5);
      }
      // the arpeggio: the chord's notes an octave over the harmony, up and down in sixteenths (soft in the intro)
      if (mood.arp) for (let i = 0; i < (introEnd ? 10 : BAR); i++) arp.push({ step: b0 + i, len: 1, pitch: triad[[0, 1, 2, 1][i % 4]!]! + 12 + (i % 8 >= 4 && i % 4 === 2 ? 12 : 0), vel: (i % 4 === 0 ? 0.8 : 0.6) * (sec.kind === "intro" ? 0.6 : 1) });
    }
    s0 += n * BAR;
    void si;
  }
  const song = {
    version: 1, bpm, stepsPerBeat: 4, length,
    tracks: [
      { name: "melody", kind: "synth", ...mood.lead, notes: lead },
      ...(mood.arp ? [{ name: "arp", kind: "synth", ...mood.arp, notes: arp }] : []),
      { name: "harmony", kind: "synth", pan: -0.25, ...mood.harmonyVoice, notes: harmony },
      { name: "bass", kind: "synth", ...mood.bassVoice, notes: bass },
      ...(mood.bassHi ? [{ name: "bass_hi", kind: "synth", ...mood.bassHi, notes: bassHi }] : []),
      { name: "drums", kind: "drums", wave: "noise", volume: mood.kit === "punch" ? 0.34 : 0.36, kit: mood.kit, reverb: mood.drumReverb, notes: drums },
    ],
    ...(mood.room ? { room: mood.room } : {}),
    // glue on the mix: a gentle compressor and a ceiling a decibel under full scale
    master: { volume: 1, fx: [{ type: "compressor", params: { threshold: -16, ratio: 2.5, attack: 12, release: 140, makeup: 1.5 } }], limit: -1 },
    // the game loops from the first A to the end; the intro plays once
    ...(loopFrom > 0 ? { loop: { from: loopFrom, to: length } } : {}),
    ...(formName === "song" ? { markers: sections.reduce((acc, sec) => { acc.list.push({ step: acc.at, name: sec.kind === "A2" ? "A again" : sec.kind }); acc.at += sec.chords.length * BAR; return acc; }, { at: 0, list: [] as { step: number; name: string }[] }).list } : {}),
  };
  const names = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  const numerals = ["I", "II", "III", "IV", "V", "VI", "VII"];
  const seconds = (length * 15) / bpm;
  const form = formName === "song" ? `${sections.map((s) => `${s.kind === "A2" ? "A again" : s.kind} (${s.chords.length})`).join(", ")}: ${bars} bars, ${seconds.toFixed(0)} s; the game loops from the first A (bar ${loopFrom / BAR + 1}) to the end, ${(((length - loopFrom) * 15) / bpm).toFixed(0)} s, and the intro plays once` : `${bars} bars (${length} steps), ${seconds.toFixed(0)} s, looping whole`;
  return {
    song,
    said: `"${MOOD_NAMES.find((n) => MOODS[n] === mood)}" in ${names[pc]} ${minor ? "minor" : "major"} at ${bpm} beats a minute, seed ${seed}; ${form}; chords by bar in A: ${mood.chords.map((c) => numerals[c]).join(" ")}${formName === "song" ? `, in B: ${chordsB.map((c) => numerals[c]).join(" ")}` : ""}; tracks: melody (${lead.length} notes), ${mood.arp ? "arp, " : ""}harmony, bass, ${mood.bassHi ? "bass_hi (the bass an octave up, for small speakers), " : ""}drums (the ${mood.kit} kit). It is an ordinary song: read music/<name>.song.json and give it back to song_write to change a note, an instrument or the tempo.`,
  };
}
