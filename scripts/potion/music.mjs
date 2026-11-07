// Potion Panic's own music, written through the MCP server's `song_write`: a waltz for the apothecary's bench (the menus and the book), a folk tune for the meadow, glassy bells for the
// frost, a stalking low riff for the embers, a slow eerie drone for the mire and a short fanfare for the results. Plucked strings, bells, flute and a soft pad: a wizard's workshop.
//   scripts/env.sh node scripts/potion/music.mjs     (cargo build --release -p nova-studio --bin nova-ogg first, so that they are .ogg)
import { connect } from "../rally/mcp.mjs";
import { join } from "node:path";
const PROJECT = join(new URL("../..", import.meta.url).pathname, "examples/potion-panic");

const track = (name, kind, wave, notes, o = {}) => ({ name, kind, wave, duty: 0.5, attack: 0.01, decay: 0.1, sustain: 0.6, release: 0.12, volume: 0.5, pan: 0, mute: false, notes, ...o });
const N = (step, pitch, len, vel = 0.7) => ({ step, len, pitch, vel });
const DRUM = { kick: 36, snare: 38, clap: 39, hat: 42, open: 46, tom: 45, crash: 49 };

// instruments (the studio's synth parameters)
const HARP = { wave: "triangle", unison: 2, detune: 4, attack: 0.002, decay: 0.38, sustain: 0.06, release: 0.5, reverb: 0.5, cutoff: 5200, volume: 0.34 };
const CELESTA = { wave: "sine", unison: 2, detune: 3, attack: 0.001, decay: 0.55, sustain: 0.02, release: 0.9, reverb: 0.65, volume: 0.3 };
const FLUTE = { wave: "triangle", attack: 0.07, decay: 0.1, sustain: 0.7, release: 0.22, vibrato: 0.12, reverb: 0.4, volume: 0.3 };
const PIZZ = { wave: "triangle", attack: 0.002, decay: 0.22, sustain: 0.05, release: 0.12, volume: 0.5, sub: 0.3 };
const PAD = { wave: "saw", unison: 5, detune: 12, cutoff: 1100, sweep: 0.12, attack: 0.5, release: 1.0, reverb: 0.7, volume: 0.22 };
const DRUMS = { kit: "studio", reverb: 0.12, volume: 0.4 };

// a section's chords, one bar each (a bar is `bar` steps), as [root bass pitch, [chord tones]]
function build({ bars, bar, chords, pad = true, bass, pluck, arp, lead, drums }) {
  const tracks = { pad: [], bass: [], pluck: [], arp: [], lead: [], drums: [] };
  for (let b = 0; b < bars.length; b++) {
    const sec = bars[b];
    const [root, tones] = chords[b % chords.length];
    const at = b * bar;
    if (pad && sec.pad !== false) for (const p of tones) tracks.pad.push(N(at, p - 12, bar - 1, 0.35));
    if (sec.bass !== false && bass) tracks.bass.push(...bass(at, root, tones, b));
    if (sec.pluck !== false && pluck) tracks.pluck.push(...pluck(at, root, tones, b));
    if (sec.arp !== false && arp) tracks.arp.push(...arp(at, root, tones, b));
    if (sec.lead && lead) tracks.lead.push(...lead(sec.lead, at, b));
    if (sec.drums !== false && drums) tracks.drums.push(...drums(at, b, sec));
  }
  return tracks;
}
const section = (name, count, o = {}) => Array.from({ length: count }, (_, i) => ({ name, i, ...o }));

// ---- the apothecary's waltz (the menus and the book): D minor, three beats to the bar ----------------------------------------------------
const waltz = (() => {
  const chords = [[50, [62, 65, 69]], [55, [62, 67, 70]], [58, [65, 70, 74]], [57, [64, 69, 73]]]; // Dm Gm Bb A
  // the lead's two tunes, four bars each: [step, pitch, len] per bar
  const A = [[[0, 74, 4], [4, 77, 4], [8, 81, 4]], [[0, 79, 6], [6, 77, 3], [9, 74, 3]], [[0, 82, 6], [6, 81, 3], [9, 77, 3]], [[0, 76, 4], [4, 73, 4], [8, 69, 4]]];
  const B = [[[0, 77, 6], [6, 81, 6]], [[0, 79, 6], [6, 82, 6]], [[0, 81, 4], [4, 79, 4], [8, 77, 4]], [[0, 76, 12]]];
  const tunes = { A, B, A8: A.map((b) => b.map(([s, p, l]) => [s, p + 12, l])) };
  const bars = [
    ...section("intro", 4, { lead: null, pluck: false, bass: false }),
    ...section("A", 4, { lead: "A" }), ...section("A", 4, { lead: "A" }), ...section("B", 4, { lead: "B" }),
    ...section("A", 4, { lead: "A" }), ...section("B", 4, { lead: "B" }),
    ...section("break", 4, { lead: null, bass: false, pluck: false }),
    ...section("A", 4, { lead: "A8" }), ...section("B", 4, { lead: "B" }), ...section("A", 4, { lead: "A" }), ...section("B", 4, { lead: "B" }),
    ...section("outro", 4, { lead: "A" }),
  ];
  const t = build({
    bars, bar: 12, chords,
    bass: (at, root) => [N(at, root, 3, 0.85)],
    pluck: (at, root, tones) => [N(at + 4, tones[0], 3, 0.5), N(at + 4, tones[1], 3, 0.5), N(at + 4, tones[2], 3, 0.5), N(at + 8, tones[0], 3, 0.45), N(at + 8, tones[1], 3, 0.45), N(at + 8, tones[2], 3, 0.45)],
    arp: (at, root, tones) => [0, 1, 2, 3].flatMap((i) => [N(at + i * 3, tones[i % 3] + 12, 2, 0.4), N(at + i * 3 + 1, tones[(i + 1) % 3] + 12, 2, 0.3)]).slice(0, 8),
    lead: (name, at, b) => (tunes[name][b % 4] ?? []).map(([s, p, l]) => N(at + s, p, l, 0.62)),
    drums: (at) => [N(at + 4, DRUM.hat, 1, 0.14), N(at + 8, DRUM.hat, 1, 0.14)],
  });
  return { name: "menu", bpm: 126, stepsPerBeat: 4, length: bars.length * 12, tracks: [
    track("pad", "synth", "saw", t.pad, PAD),
    track("bass", "synth", "triangle", t.bass, PIZZ),
    track("pluck", "synth", "triangle", t.pluck, { ...HARP, volume: 0.24, decay: 0.16 }),
    track("arp", "synth", "triangle", t.arp, { ...HARP, pan: -0.2 }),
    track("lead", "synth", "sine", t.lead, { ...FLUTE, pan: 0.15 }),
    track("drums", "drums", "noise", t.drums, DRUMS),
  ] };
})();

// ---- the meadow: C major, a bouncy folk tune, four to the bar ------------------------------------------------------------------------------
const meadow = (() => {
  const chords = [[48, [60, 64, 67]], [45, [57, 60, 64]], [53, [60, 65, 69]], [55, [59, 62, 67]]]; // C Am F G
  const A = [[[0, 76, 2], [2, 79, 2], [4, 81, 4], [8, 79, 4], [12, 76, 4]], [[0, 76, 2], [2, 79, 2], [4, 81, 4], [8, 84, 4], [12, 81, 4]], [[0, 77, 4], [4, 81, 4], [8, 84, 4], [12, 81, 4]], [[0, 79, 8], [8, 76, 4], [12, 74, 4]]];
  const B = [[[0, 84, 4], [4, 81, 2], [6, 79, 2], [8, 76, 8]], [[0, 81, 4], [4, 79, 2], [6, 76, 2], [8, 72, 8]], [[0, 77, 2], [2, 79, 2], [4, 81, 4], [8, 84, 4], [12, 86, 4]], [[0, 84, 6], [6, 79, 2], [8, 79, 8]]];
  const tunes = { A, B };
  const bars = [
    ...section("intro", 4, { lead: null }), ...section("A", 4, { lead: "A" }), ...section("A", 4, { lead: "A" }), ...section("B", 4, { lead: "B" }),
    ...section("A", 4, { lead: "A" }), ...section("B", 4, { lead: "B" }), ...section("A", 4, { lead: "A" }), ...section("B", 4, { lead: "B" }),
    ...section("A", 4, { lead: "A" }), ...section("B", 4, { lead: "B" }), ...section("A", 4, { lead: "A" }), ...section("outro", 4, { lead: "B" }),
  ];
  const t = build({
    bars, bar: 16, chords,
    bass: (at, root, tones) => [N(at, root, 4, 0.8), N(at + 4, root + 7, 4, 0.6), N(at + 8, root, 4, 0.75), N(at + 12, root + 7, 4, 0.6)],
    pluck: (at, root, tones) => [2, 6, 10, 14].flatMap((s) => tones.map((p) => N(at + s, p, 2, 0.4))),
    arp: () => [],
    lead: (name, at, b) => (tunes[name][b % 4] ?? []).map(([s, p, l]) => N(at + s, p, l, 0.65)),
    drums: (at, b, sec) => [N(at, DRUM.kick, 1, 0.5), N(at + 8, DRUM.kick, 1, 0.45), ...[2, 6, 10, 14].map((s) => N(at + s, DRUM.hat, 1, 0.22)), N(at + 4, DRUM.clap, 1, 0.3), N(at + 12, DRUM.clap, 1, 0.3)],
  });
  return { name: "meadow", bpm: 122, stepsPerBeat: 4, length: bars.length * 16, tracks: [
    track("pad", "synth", "saw", t.pad, { ...PAD, volume: 0.14 }),
    track("bass", "synth", "triangle", t.bass, PIZZ),
    track("pluck", "synth", "triangle", t.pluck, { ...HARP, volume: 0.26, decay: 0.14, pan: -0.15 }),
    track("lead", "synth", "triangle", t.lead, { ...FLUTE, volume: 0.34, pan: 0.15 }),
    track("drums", "drums", "noise", t.drums, DRUMS),
  ] };
})();

// ---- the frost: slow glassy bells over a wide pad -------------------------------------------------------------------------------------------
const frost = (() => {
  const chords = [[45, [57, 60, 64, 71]], [41, [53, 57, 60, 64]], [48, [55, 59, 64, 67]], [43, [55, 59, 62, 64]]]; // Am9 Fmaj7 Cmaj7 G6
  const bells = [76, 79, 83, 86, 83, 79, 76, 74, 76, 79, 81, 79];
  const bars = [...section("intro", 4, { lead: null }), ...section("A", 8, { lead: "bell" }), ...section("B", 8, { lead: "bell2" }), ...section("A", 8, { lead: "bell" }), ...section("B", 8, { lead: "bell2" }), ...section("outro", 4, { lead: null })];
  const t = build({
    bars, bar: 16, chords,
    bass: (at, root) => [N(at, root, 12, 0.6)],
    pluck: () => [],
    arp: (at, root, tones, b) => tones.flatMap((p, i) => [N(at + i * 4, p + 12, 3, 0.4), N(at + i * 4 + 2, p + 24, 2, 0.28)]),
    lead: (name, at, b) => {
      const seq = name === "bell" ? [[0, 88, 4], [6, 91, 3], [10, 86, 6]] : [[0, 91, 6], [8, 88, 4], [12, 84, 4]];
      return seq.map(([s, p, l]) => N(at + s, p - (b % 4 === 2 ? 2 : 0), l, 0.5));
    },
    drums: (at, b, sec) => (sec.name === "intro" || sec.name === "outro" ? [] : [N(at, DRUM.kick, 1, 0.3), N(at + 10, DRUM.kick, 1, 0.25), N(at + 8, DRUM.hat, 1, 0.12)]),
  });
  return { name: "frost", bpm: 82, stepsPerBeat: 4, length: bars.length * 16, tracks: [
    track("pad", "synth", "saw", t.pad, { ...PAD, cutoff: 1500, reverb: 0.85, volume: 0.24 }),
    track("bass", "synth", "sine", t.bass, { wave: "sine", attack: 0.03, decay: 0.5, sustain: 0.4, release: 0.4, volume: 0.4 }),
    track("arp", "synth", "sine", t.arp, { ...CELESTA, volume: 0.28 }),
    track("lead", "synth", "sine", t.lead, { ...CELESTA, volume: 0.32, pan: 0.2, decay: 0.9 }),
    track("drums", "drums", "noise", t.drums, { ...DRUMS, volume: 0.28 }),
  ] };
})();

// ---- the embers: E phrygian, a stalking low riff and drums like a heartbeat ----------------------------------------------------------------
const ember = (() => {
  const chords = [[40, [52, 55, 59]], [41, [53, 56, 60]], [40, [52, 55, 59]], [38, [50, 54, 57]]]; // Em F Em D
  const riff = (at, root) => [[0, 0], [3, 0], [4, 1], [6, 0], [8, 0], [11, 12], [12, 1], [14, 0]].map(([s, o]) => N(at + s, root + o, 2, 0.8));
  const mel = [[[0, 71, 4], [4, 72, 2], [6, 71, 2], [8, 67, 8]], [[0, 72, 4], [4, 75, 2], [6, 72, 2], [8, 68, 8]], [[0, 71, 4], [4, 76, 4], [8, 75, 4], [12, 71, 4]], [[0, 69, 8], [8, 66, 4], [12, 69, 4]]];
  const bars = [...section("intro", 4, { lead: null }), ...section("A", 8, { lead: "m" }), ...section("A", 8, { lead: "m" }), ...section("break", 4, { lead: null, bass: false }), ...section("A", 8, { lead: "m" }), ...section("A", 8, { lead: "m" }), ...section("outro", 4, { lead: null })];
  const t = build({
    bars, bar: 16, chords,
    bass: riff,
    pluck: () => [],
    arp: () => [],
    lead: (name, at, b) => mel[b % 4].map(([s, p, l]) => N(at + s, p, l, 0.6)),
    drums: (at, b, sec) => [N(at, DRUM.kick, 1, 0.8), N(at + 3, DRUM.tom, 1, 0.5), N(at + 8, DRUM.kick, 1, 0.7), N(at + 11, DRUM.tom, 1, 0.5), N(at + 6, DRUM.hat, 1, 0.2), N(at + 14, DRUM.hat, 1, 0.2), ...(sec.name === "break" ? [] : [N(at + 4, DRUM.clap, 1, 0.45), N(at + 12, DRUM.clap, 1, 0.45)])],
  });
  return { name: "ember", bpm: 114, stepsPerBeat: 4, length: bars.length * 16, tracks: [
    track("pad", "synth", "saw", t.pad, { ...PAD, cutoff: 900, volume: 0.2 }),
    track("bass", "synth", "saw", t.bass, { wave: "saw", unison: 2, detune: 6, cutoff: 520, resonance: 0.2, sweep: 0.5, sub: 0.5, attack: 0.004, decay: 0.15, sustain: 0.4, release: 0.08, volume: 0.45 }),
    track("lead", "synth", "saw", t.lead, { wave: "saw", unison: 3, detune: 9, cutoff: 2400, sweep: 0.5, attack: 0.02, release: 0.3, vibrato: 0.1, reverb: 0.4, volume: 0.24, pan: 0.1 }),
    track("drums", "drums", "noise", t.drums, { ...DRUMS, volume: 0.55 }),
  ] };
})();

// ---- the mire: a slow drone, a heartbeat and a few uneasy notes -------------------------------------------------------------------------------
const mire = (() => {
  const chords = [[37, [49, 52, 56]], [37, [49, 52, 55]], [34, [46, 49, 53]], [35, [47, 50, 54]]]; // C#m C#dim A#m B
  const notes = [[[4, 85, 6], [12, 82, 4]], [[2, 80, 8]], [[6, 83, 6], [13, 80, 3]], [[0, 85, 10]]];
  const bars = [...section("intro", 4, { lead: null }), ...section("A", 8, { lead: "n" }), ...section("A", 8, { lead: "n" }), ...section("A", 8, { lead: "n" }), ...section("outro", 4, { lead: null })];
  const t = build({
    bars, bar: 16, chords,
    bass: (at, root) => [N(at, root, 14, 0.7)],
    pluck: () => [],
    arp: (at, root, tones, b) => (b % 2 === 0 ? [N(at + 8, tones[2] + 12, 4, 0.3)] : [N(at + 12, tones[0] + 24, 3, 0.25)]),
    lead: (name, at, b) => notes[b % 4].map(([s, p, l]) => N(at + s, p, l, 0.4)),
    drums: (at, b, sec) => [N(at, DRUM.kick, 1, 0.5), N(at + 2, DRUM.kick, 1, 0.3), N(at + 8, DRUM.kick, 1, 0.45), N(at + 10, DRUM.kick, 1, 0.25)],
  });
  return { name: "mire", bpm: 72, stepsPerBeat: 4, length: bars.length * 16, tracks: [
    track("pad", "synth", "saw", t.pad, { ...PAD, unison: 6, detune: 22, cutoff: 800, reverb: 0.85, volume: 0.26 }),
    track("bass", "synth", "sine", t.bass, { wave: "sine", attack: 0.2, decay: 0.2, sustain: 0.7, release: 0.5, volume: 0.45, sub: 0.4 }),
    track("arp", "synth", "sine", t.arp, { ...CELESTA, volume: 0.24, pan: -0.3 }),
    track("lead", "synth", "triangle", t.lead, { wave: "triangle", unison: 3, detune: 18, attack: 0.05, decay: 0.4, sustain: 0.2, release: 1.0, vibrato: 0.2, reverb: 0.75, volume: 0.24, pan: 0.25 }),
    track("drums", "drums", "noise", t.drums, { ...DRUMS, volume: 0.35 }),
  ] };
})();

// ---- the results: a short fanfare ---------------------------------------------------------------------------------------------------------
const results = (() => {
  const chords = [[48, [60, 64, 67]], [53, [60, 65, 69]], [55, [59, 62, 67]], [48, [60, 64, 67]]];
  const mel = [[[0, 79, 4], [4, 84, 4], [8, 88, 8]], [[0, 86, 4], [4, 84, 4], [8, 81, 8]], [[0, 83, 4], [4, 86, 4], [8, 91, 8]], [[0, 88, 12]]];
  const bars = section("A", 8, { lead: "m" });
  const t = build({
    bars, bar: 16, chords,
    bass: (at, root) => [N(at, root, 4, 0.7), N(at + 8, root + 7, 4, 0.6)],
    pluck: (at, root, tones) => [4, 12].flatMap((s) => tones.map((p) => N(at + s, p, 3, 0.4))),
    arp: (at, root, tones) => tones.flatMap((p, i) => [N(at + i * 4, p + 12, 3, 0.35)]),
    lead: (name, at, b) => mel[b % 4].map(([s, p, l]) => N(at + s, p, l, 0.7)),
    drums: (at) => [N(at, DRUM.kick, 1, 0.6), N(at + 8, DRUM.kick, 1, 0.5), N(at + 4, DRUM.clap, 1, 0.4), N(at + 12, DRUM.clap, 1, 0.4), ...[2, 6, 10, 14].map((s) => N(at + s, DRUM.hat, 1, 0.2))],
  });
  return { name: "results", bpm: 120, stepsPerBeat: 4, length: bars.length * 16, tracks: [
    track("pad", "synth", "saw", t.pad, { ...PAD, volume: 0.16 }),
    track("bass", "synth", "triangle", t.bass, PIZZ),
    track("pluck", "synth", "triangle", t.pluck, { ...HARP, volume: 0.26 }),
    track("arp", "synth", "sine", t.arp, { ...CELESTA, volume: 0.26 }),
    track("lead", "synth", "triangle", t.lead, { ...FLUTE, volume: 0.36 }),
    track("drums", "drums", "noise", t.drums, DRUMS),
  ] };
})();

const nova = await connect(PROJECT);
try {
  for (const song of [waltz, meadow, frost, ember, mire, results]) {
    const { name, ...rest } = song;
    console.log(await nova.call("song_write", { name, song: { version: 1, room: { size: 0.7, damping: 0.45 }, ...rest } }));
  }
} finally {
  nova.close();
}
