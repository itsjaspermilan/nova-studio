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
    bassVoice: { wave: "saw", unison: 2, detune: 6, cutoff: 600, sweep: 0.5, sub: 0.4, attack: 0.005, decay: 0.12, sustain: 0.5, release: 0.06, volume: 0.36, duck: 0.2 },
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
    bassVoice: { wave: "saw", unison: 2, detune: 8, cutoff: 500, sweep: 0.6, sub: 0.3, attack: 0.004, decay: 0.1, sustain: 0.4, release: 0.05, volume: 0.36, duck: 0.3 },
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
    bassVoice: { wave: "saw", unison: 2, detune: 7, cutoff: 420, resonance: 0.2, sweep: 0.55, sub: 0.3, attack: 0.003, decay: 0.12, sustain: 0.45, release: 0.05, volume: 0.38, duck: 0.35 },
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
    bassVoice: { wave: "saw", unison: 2, detune: 6, cutoff: 360, sweep: 0.35, sub: 0.55, attack: 0.01, decay: 0.3, sustain: 0.6, release: 0.15, volume: 0.36, duck: 0.25 },
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
  const lowRoot = (root: number) => (root > bassTonic + 9 ? root - 12 : root);
  const BAR = 16, bars = mood.bars, length = BAR * bars;

  // the melody, as steps of the scale from the key note
  const lead: NoteSpec[] = [];
  const barNotes: { rhythm: Rhythm; degrees: number[] }[] = [];
  let at = 4 + Math.floor(rng() * 3); // start around the fifth
  for (let bar = 0; bar < bars; bar++) {
    const chord = mood.chords[bar]!;
    const tones = [chord, chord + 2, chord + 4, chord + 7, chord - 3, chord - 5, chord + 9];
    const last = bar === bars - 1;
    // bars five and six say bars one and two again
    const again = bars === 8 && (bar === 4 || bar === 5) ? barNotes[bar - 4] : undefined;
    const rhythm = again?.rhythm ?? (last ? mood.rhythms[mood.rhythms.length - 1]! : mood.rhythms[Math.floor(rng() * (mood.rhythms.length - (bars === 3 ? 1 : 0)))]!);
    const way = rng() < 0.5 ? 1 : -1;
    const degrees: number[] = [];
    rhythm.forEach(([start, len], i) => {
      let d: number;
      if (again) d = again.degrees[i]!;
      else {
        const strong = start % 8 === 0 || len >= 4 || i === rhythm.length - 1;
        if (strong) {
          // the nearest note of the chord (sometimes the next nearest), kept within an octave and a half
          const near = tones.filter((t) => t >= -2 && t <= 10).sort((p, q) => Math.abs(p - at) - Math.abs(q - at));
          d = near[rng() < 0.7 || near.length < 2 ? 0 : 1] ?? chord;
        } else d = at + (rng() < 0.75 ? way : -way) * (rng() < 0.8 ? 1 : 2);
        if (d > 10) d -= 2;
        if (d < -2) d += 2;
        if (last && i === rhythm.length - 1 && bars !== 3) d = [chord, chord + 2, chord + 4].sort((p, q) => Math.abs(p - at) - Math.abs(q - at))[0]!;
        if (bars === 3 && last) d = i === 0 ? 7 : 4; // a fanfare ends on the high key note
      }
      at = d;
      degrees.push(d);
      lead.push({ step: bar * BAR + start, len, pitch: pitchOf(d, tonic), vel: start % 8 === 0 ? 0.85 : 0.7 });
    });
    barNotes.push({ rhythm, degrees });
  }

  const harmony: NoteSpec[] = [], bass: NoteSpec[] = [], drums: NoteSpec[] = [], arp: NoteSpec[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const chord = mood.chords[bar]!, s0 = bar * BAR;
    // harmony below the melody: the chord's three notes, held or one after another
    const triad = [chord, chord + 2, chord + 4].map((d) => pitchOf(d, tonic - 12)).map((p) => (p < tonic - 10 ? p + 12 : p));
    if (mood.harmony === "held") for (const p of triad) harmony.push({ step: s0, len: BAR, pitch: p, vel: 0.5 });
    else for (let i = 0; i < 8; i++) harmony.push({ step: s0 + i * 2, len: 2, pitch: triad[[0, 1, 2, 1][i % 4]!]!, vel: i % 4 === 0 ? 0.6 : 0.45 });
    mood.bass.forEach(([start, len], i) => {
      const root = pitchOf(chord, bassTonic);
      const up = mood.bassLine[i % mood.bassLine.length]!;
      bass.push({ step: s0 + start, len, pitch: lowRoot(root) + (up === 4 ? 7 : up === 7 && lowRoot(root) + 12 <= bassTonic + 14 ? 12 : up === 7 ? 7 : 0), vel: i === 0 ? 0.85 : 0.7 });
    });
    for (const k of mood.drums.kick) drums.push({ step: s0 + k, len: 1, pitch: 36, vel: 0.85 });
    for (const sn of mood.drums.snare) drums.push({ step: s0 + sn, len: 1, pitch: 38, vel: 0.7 });
    for (const hh of mood.drums.hat) drums.push({ step: s0 + hh, len: 1, pitch: (mood.drums.open ?? []).includes(hh) ? 46 : 42, vel: mood.drums.hatVel });
    if (mood.drums.clap) for (const sn of mood.drums.snare) drums.push({ step: s0 + sn, len: 1, pitch: 39, vel: 0.5 });
    // the arpeggio: the chord's notes an octave over the harmony, up and down in sixteenths
    if (mood.arp) for (let i = 0; i < BAR; i++) arp.push({ step: s0 + i, len: 1, pitch: triad[[0, 1, 2, 1][i % 4]!]! + 12 + (i % 8 >= 4 && i % 4 === 2 ? 12 : 0), vel: i % 4 === 0 ? 0.8 : 0.6 });
    // a fill into the turn of the loop
    if (bar === bars - 1 && bars === 8 && mood.drums.snare.length) for (const st of [13, 14, 15]) drums.push({ step: s0 + st, len: 1, pitch: st === 15 ? 38 : 45, vel: 0.6 });
    if (mood.drums.crash && bar === 0) drums.push({ step: 0, len: 1, pitch: 49, vel: 0.5 });
  }
  const song = {
    version: 1, bpm, stepsPerBeat: 4, length,
    tracks: [
      { name: "melody", kind: "synth", ...mood.lead, notes: lead },
      ...(mood.arp ? [{ name: "arp", kind: "synth", ...mood.arp, notes: arp }] : []),
      { name: "harmony", kind: "synth", pan: -0.25, ...mood.harmonyVoice, notes: harmony },
      { name: "bass", kind: "synth", ...mood.bassVoice, notes: bass },
      { name: "drums", kind: "drums", wave: "noise", volume: 0.5, kit: mood.kit, reverb: mood.drumReverb, notes: drums },
    ],
    ...(mood.room ? { room: mood.room } : {}),
    // glue on the mix: a gentle compressor and a ceiling a decibel under full scale
    master: { volume: 1, fx: [{ type: "compressor", params: { threshold: -16, ratio: 2.5, attack: 12, release: 140, makeup: 1.5 } }], limit: -1 },
  };
  const names = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  const numerals = ["I", "II", "III", "IV", "V", "VI", "VII"];
  return {
    song,
    said: `"${MOOD_NAMES.find((n) => MOODS[n] === mood)}" in ${names[pc]} ${minor ? "minor" : "major"} at ${bpm} beats a minute, ${bars} bars (${length} steps), seed ${seed}; chords by bar: ${mood.chords.map((c) => numerals[c]).join(" ")}; tracks: melody (${lead.length} notes), ${mood.arp ? "arp, " : ""}harmony, bass, drums (the ${mood.kit} kit). It is an ordinary song: read music/<name>.song.json and give it back to song_write to change a note, an instrument or the tempo.`,
  };
}
