// The one piece of music, for piano (the owner, after the second play: "The music is a little repetitive. Can we use piano?").
// A soft felt piano (Nova's "piano" instrument, brightness low: a felt-muted upright), the right hand singing the tune, the left hand
// a simple accompaniment, a room round it; and four layers that join it while the van is driven ("The layers" below). In F major, slow (68 to the
// minute, easing at the ends of phrases), and long enough not to grate: two bars of left hand that play once, then a loop of
// 57 bars (about three minutes and twenty seconds) in sections that each come back changed:
//
//   intro  2 bars  the left hand alone (plays once)
//   A      8       the tune, middle of the piano, a broken-chord left hand
//   A'     8       the tune again, ornamented, the left hand flowing in eighths
//   B      8       on D minor and B flat: a lower, darker tune over long chords, quieter
//   A''    8       the tune high and soft, the left hand thinned to a few notes, ending on a new cadence
//   C      8       in B flat: a slow, rising tune over rolling arpeggios, the loudest and fullest, then a bar of near silence
//   B'     8       the B tune an octave up over the arpeggios of C, falling back
//   A'''   7       the tune once more, slower at the end, and a last bar of one held note before the loop comes round
//
// Phrases breathe (a rest at the end of most two-bar phrases), the velocity rises and falls over each section and over the whole,
// and the tempo eases at section ends. Run from the repository's root: scripts/env.sh node examples/mountain-post/tools/music.mjs
// (song_write renders it as five stems, music/fernhollow_<stem>.ogg, in step, with the loop points and the bar lines; --measure only
// prints the levels; --audition writes each stage and a drive to build/audition/ and checks them with sound_report).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { GAME, REPO, tool } from "./lib.mjs";

const SPB = 4; // steps a beat: sixteenths (the brushes' lilt needs them)
const BAR = 4 * SPB;
const BPM = 68;

// ---- pitches -----------------------------------------------------------------------------------------------------------------------
const NAMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/// "Bb4" -> 70, "C5" -> 72, "F#3" -> 54
const P = (s) => {
  const m = /^([A-G])(b|#)?(-?\d)$/.exec(s);
  if (!m) throw new Error(`not a pitch: ${s}`);
  return 12 * (Number(m[3]) + 1) + NAMES[m[1]] + (m[2] === "b" ? -1 : m[2] === "#" ? 1 : 0);
};

// ---- the tunes: one string a bar, "pitch:beats" or "r:beats" (a rest); each bar is four beats --------------------------------------
const tune = (bars) => bars.map((bar) => bar.trim().split(/\s+/).map((t) => {
  const [p, d] = t.split(":");
  return { p: p === "r" ? null : P(p), d: Number(d) };
}));
const A = tune([
  "C5:1 A4:0.5 C5:0.5 F5:1.5 r:0.5", "E5:1 D5:1 A4:1.5 r:0.5", "D5:1 C5:0.5 Bb4:0.5 D5:1 F5:1", "E5:3 r:1",
  "C5:1 A4:0.5 C5:0.5 A5:1.5 G5:0.5", "E5:1.5 C5:0.5 A4:1.5 r:0.5", "Bb4:1 D5:1 C5:1 E5:1", "F5:3 r:1",
]);
const A2 = tune([
  "r:0.5 C5:0.5 A4:0.5 C5:0.5 F5:1 G5:0.5 A5:0.5", "G5:1 F5:0.5 E5:0.5 D5:1.5 r:0.5", "D5:1 C5:0.5 Bb4:0.5 F5:1 D5:1", "C5:2 r:2",
  "A5:1 G5:0.5 F5:0.5 C5:1.5 D5:0.5", "E5:2 A4:1 C5:1", "D5:1 Bb4:1 G4:1 E5:1", "F5:2.5 r:1.5",
]);
const B = tune([
  "A4:1.5 F4:0.5 D4:1 F4:1", "Bb4:2 A4:1 G4:1", "G4:1.5 Bb4:0.5 D5:1 C5:1", "C5:3 r:1",
  "A4:1 D5:1 F5:1 E5:1", "D5:2 C5:1 Bb4:1", "Bb4:1 A4:1 G4:1 F4:1", "G4:2 r:2",
]);
const A3 = tune([
  "C6:1 A5:0.5 C6:0.5 F6:1.5 r:0.5", "E6:1 D6:1 A5:1.5 r:0.5", "D6:1 C6:0.5 Bb5:0.5 D6:1 F6:1", "E6:2 r:2",
  "C6:1 A5:0.5 C6:0.5 A5:1 G5:1", "E5:1.5 C5:0.5 A4:1.5 r:0.5", "Bb4:1 C5:1 D5:1 E5:1", "F5:2 C5:1 A4:1",
]);
const C = tune([
  "F5:2 D5:1 Bb4:1", "C5:2 A4:1.5 r:0.5", "Bb4:1 D5:1 G5:2", "F5:3 r:1",
  "G5:1.5 F5:0.5 Eb5:2", "D5:2 Bb4:1 D5:1", "C5:2 E5:1 G5:1", "r:4",
]);
const B2 = tune([
  "A5:1.5 F5:0.5 D5:1 F5:1", "Bb5:2 A5:1 G5:1", "G5:1.5 Bb5:0.5 D6:1 C6:1", "C6:2 r:2",
  "A5:1 D6:1 F6:1 E6:1", "D6:2 C6:0.5 Bb5:0.5 A5:1", "Bb5:1 A5:1 G5:1 F5:1", "E5:2 r:2",
]);
const A4 = tune([
  "C5:1 A4:0.5 C5:0.5 F5:1.5 r:0.5", "E5:1 D5:1 A4:1.5 r:0.5", "D5:1 C5:0.5 Bb4:0.5 D5:1 F5:1", "E5:2 G5:1 E5:1",
  "C5:1 A4:0.5 C5:0.5 A5:2", "G5:1 E5:1 C5:1 D5:1", "Bb4:1 A4:1 G4:1 E4:1",
]);

// ---- the chords (one or two a bar) and the left hand's patterns ------------------------------------------------------------------------
// A chord is its notes from the bottom: the bass, then the rest in the octave above it.
const CH = {
  F: ["F2", "C3", "A3", "C4"], Dm: ["D2", "A2", "F3", "A3"], Bb: ["Bb1", "F2", "D3", "F3"], C: ["C2", "G2", "E3", "G3"],
  Am: ["A1", "E2", "C3", "E3"], Gm: ["G1", "D2", "Bb2", "D3"], Gm7: ["G1", "D2", "F3", "Bb3"], Csus: ["C2", "G2", "F3", "G3"],
  FA: ["A1", "F2", "C3", "F3"], Eb: ["Eb2", "Bb2", "G3", "Bb3"], BbD: ["D2", "Bb2", "F3", "Bb3"], C7: ["C2", "G2", "E3", "Bb3"],
  Fadd: ["F2", "C3", "G3", "A3"],
};
for (const k of Object.keys(CH)) CH[k] = CH[k].map(P);
const HARM = {
  A: ["F", "Dm", "Bb", "C", "F", "Am", ["Bb", "C"], "F"],
  B: ["Dm", "Bb", "Gm", "C", "Dm", "Bb", "Gm7", "Csus"],
  A3: ["F", "Dm", "Bb", "C", "F", "Am", ["Bb", "C"], "Fadd"],
  C: ["Bb", "FA", "Gm", "F", "Eb", "BbD", "C", "C7"],
  A4: ["F", "Dm", "Bb", "C", "F", "Am", ["Bb", "C7"]],
};
// Patterns: [beat, which note of the chord (0 the bass), held for beats]. Every note is held as on the pedal, to the bar's end.
const LH = {
  broken: [[0, 0, 4], [1, 1, 3], [2, 2, 2], [3, 1, 1]],             // A: bass, fifth, third, fifth
  flowing: [[0, 0, 4], [0.5, 1, 3.5], [1, 2, 3], [1.5, 3, 2.5], [2, 1, 2], [2.5, 2, 1.5], [3, 3, 1], [3.5, 2, 0.5]], // A': eighths
  long: [[0, 0, 4], [2, 2, 2], [2, 3, 2]],                         // B: a bass and a dyad on 3
  sparse: [[0, 0, 4], [2.5, 2, 1.5]],                               // A'': two notes a bar
  rolling: [[0, 0, 4], [0.5, 1, 3.5], [1, 2, 3], [1.5, 3, 2.5], [2, 1, 2], [2.5, 2, 1.5], [3, 3, 1], [3.5, 2, 0.5]],
  intro: [[0, 0, 4], [1, 1, 3], [2, 3, 2]],
};

// ---- building the song -------------------------------------------------------------------------------------------------------------
const right = [], left = [], markers = [], tempos = [];
// what each bar holds, for the layers: its chord (or two), its section, its level, and the tune's notes and rests
const bars = [];
let bar = 0;
const step = (b, beat) => Math.round((b * 4 + beat) * SPB);

// the left hand of one bar: the chord (or two, each for half the bar) in a pattern, at a level
function leftBar(chord, pattern, vel, opts = {}) {
  const halves = Array.isArray(chord) ? chord : [chord];
  for (const [beat, which, hold] of LH[pattern]) {
    const half = halves.length > 1 ? (beat < 2 ? 0 : 1) : 0;
    const notes = CH[halves[half]];
    const end = halves.length > 1 && half === 0 ? 2 : 4;
    const len = Math.max(0.5, Math.min(hold, end - beat));
    const pitch = notes[which] + (opts.up ?? 0);
    // the bass a touch firmer than the rest; later notes of a bar a little softer
    const v = vel * (which === 0 ? 1.08 : 0.86 - beat * 0.03);
    left.push({ step: step(bar, beat), len: Math.round(len * SPB), pitch, vel: r2(v), pan: r2((pitch - 52) / 60) });
  }
}
const r2 = (x) => Math.round(x * 100) / 100;

// a section: its tune over its chords; `shape(i, n)` is the level of bar i of n (rises and falls), times `level`
function section(name, melody, harm, pattern, level, opts = {}) {
  markers.push({ step: step(bar, 0), name });
  const n = melody.length;
  for (let i = 0; i < n; i++) {
    const swell = 0.86 + 0.14 * Math.sin(Math.PI * (i + 0.5) / n) + (i % 4 === 3 ? -0.05 : 0);
    let beat = 0;
    for (const { p, d } of melody[i]) {
      if (p !== null) {
        // a note on the beat a little firmer; a long note a little firmer still; the phrase's top note leans
        const accent = (Number.isInteger(beat) ? 1 : 0.9) * (d >= 2 ? 1.04 : 1);
        right.push({ step: step(bar, beat), len: Math.max(1, Math.round(d * SPB)), pitch: p, vel: r2(Math.min(1, level * swell * accent)), pan: r2((p - 64) / 70) });
      }
      beat += d;
    }
    if (Math.abs(beat - 4) > 1e-9) throw new Error(`${name} bar ${i + 1} has ${beat} beats`);
    bars.push({ bar, chord: harm[i] ?? null, section: name, level: level * swell, tune: melody[i] });
    if (harm[i]) leftBar(harm[i], opts.lastBarPattern && i === n - 1 ? opts.lastBarPattern : pattern, level * 0.62 * swell, opts);
    bar++;
  }
  // the tempo eases into the section's last bar and picks up again after it
  if (opts.ease !== false) {
    tempos.push({ step: step(bar - 1, 0), bpm: BPM });
    tempos.push({ step: step(bar - 1, 3.5), bpm: BPM - 7, ramp: true });
    tempos.push({ step: step(bar, 0), bpm: BPM });
  }
}

// intro: two bars of the left hand alone, F then C, getting ready (plays once)
markers.push({ step: 0, name: "intro" });
leftBar("F", "intro", 0.42); bars.push({ bar, chord: null, section: "intro" }); bar++;
leftBar("Csus", "intro", 0.36); bars.push({ bar, chord: null, section: "intro" }); bar++;
const LOOP = step(bar, 0);
// (the intro's last chord is let go a beat early, so that its damper has fallen before the loop's start: the game comes back to
// that point from the end, where nothing of the intro rings, and a tail still sounding there would click at every loop)
for (const n of left) n.len = Math.max(1, Math.min(n.len, step(bar - 1, 3) - n.step));
section("A", A, HARM.A, "broken", 0.62);
section("A'", A2, HARM.A, "flowing", 0.66);
section("B", B, HARM.B, "long", 0.52);
section("A''", A3, HARM.A3, "sparse", 0.5);
section("C", C, HARM.C, "rolling", 0.74, { lastBarPattern: "long" });
// (C's last bar has no tune: the left hand holds its C7 quietly, a bar of near silence)
section("B'", B2, HARM.B, "rolling", 0.6);
section("A'''", A4, HARM.A4, "broken", 0.56);
// the last bar: one low F held, softly, and the room, before the loop comes round to A
markers.push({ step: step(bar, 0), name: "breath" });
left.push({ step: step(bar, 0), len: 3 * SPB, pitch: P("F2"), vel: 0.3, pan: -0.15 });
left.push({ step: step(bar, 0), len: 3 * SPB, pitch: P("C3"), vel: 0.22, pan: -0.1 });
tempos.push({ step: step(bar, 0), bpm: BPM - 4 });
bars.push({ bar, chord: null, section: "breath" });
bar++;
const LENGTH = step(bar, 0);
if (LENGTH > 1024) throw new Error(`the song is ${LENGTH} steps: more than a song may have`);
// (the tempo track: the song's own bpm holds until the first change; keep only changes inside the song, in order, no repeats)
const tempoTrack = [];
for (const t of tempos.sort((a, b) => a.step - b.step)) {
  if (t.step <= 0 || t.step >= LENGTH) continue;
  if (tempoTrack.length && tempoTrack.at(-1).step === t.step) tempoTrack[tempoTrack.length - 1] = t; else tempoTrack.push(t);
}

// ---- the layers ----------------------------------------------------------------------------------------------------------------------
// The piece is written as five stems that the game plays together, in step (lib/music.lua): the felt piano always, and four layers
// that join one at a time while the van is driven. Each works with the piano and with any of the ones before it.
//   piano     the tune and a lighter left hand than before: in A', C and B' the left hand's flowing eighths keep only the beats
//   bass      a round, soft bass (a triangle: its few, soft overtones let a small speaker hear a bass it cannot play): the chord's
//             root on 1 and its fifth on 3, the root of each when a bar has two chords
//   brushes   a shaker on the eighths with a ghost on the last sixteenth of beats 2 and 4 (the lilt) and soft taps on 2 and 4,
//             softened at the top; lighter in B, a little firmer in C
//   pad       warm, slow strings (three detuned saws through a low filter) holding each chord from D3 up, under the tune
//   celesta   the celesta answering the tune in its rests: the last two notes it sang, an octave up, and a little rising
//             arpeggio in the bar where the tune is silent
// The intro and the last breath are the piano's alone.
const sectionAt = (s) => markers.filter((m) => m.step <= s).at(-1)?.name ?? "intro";
const FLOWING = new Set(["A'", "C", "B'"]);
const pianoLeft = left.filter((n) => !(FLOWING.has(sectionAt(n.step)) && n.step % SPB !== 0));
const halvesOf = (c) => (Array.isArray(c) ? [[c[0], 0, 2], [c[1], 2, 2]] : [[c, 0, 4]]);
const played = bars.filter((b) => b.chord);

const bass = [];
for (const b of played) {
  const v = r2(0.5 + 0.4 * (b.level - 0.45));
  if (Array.isArray(b.chord)) {
    for (const [c, at, len] of halvesOf(b.chord)) bass.push({ step: step(b.bar, at), len: Math.round((len - 0.25) * SPB), pitch: CH[c][0], vel: v });
  } else {
    bass.push({ step: step(b.bar, 0), len: Math.round(1.75 * SPB), pitch: CH[b.chord][0], vel: v });
    bass.push({ step: step(b.bar, 2), len: Math.round(1.75 * SPB), pitch: CH[b.chord][1], vel: r2(v * 0.88) });
  }
}

const brushes = [];
for (const b of played) {
  const k = b.section === "B" ? 0.8 : b.section === "C" ? 1.15 : 1;
  for (let e = 0; e < 8; e++) brushes.push({ step: step(b.bar, e / 2), len: 1, pitch: 42, vel: r2((e % 2 ? 0.5 : 0.8) * k) });
  for (const beat of [1.75, 3.75]) brushes.push({ step: step(b.bar, beat), len: 1, pitch: 42, vel: r2(0.3 * k) });
  for (const beat of [1, 3]) brushes.push({ step: step(b.bar, beat), len: 1, pitch: 38, vel: r2(0.6 * k) });
}

// each chord in close position from D3 up (nothing in the bass's octave), held for its half or whole bar
const voicing = (c) => [...new Set([CH[c][0] + 12, CH[c][2], CH[c][3]].map((n) => (n < P("D3") ? n + 12 : n)))].sort((a, b) => a - b);
const pad = [];
for (const b of played) {
  for (const [c, at, len] of halvesOf(b.chord)) {
    for (const pitch of voicing(c)) pad.push({ step: step(b.bar, at), len: Math.round(len * SPB), pitch, vel: r2(0.42 + 0.3 * (b.level - 0.5)) });
  }
}

const celesta = [];
const heard = [];
for (const b of played) {
  const v = r2(0.3 + 0.3 * (b.level - 0.5));
  const up = (p) => (p + 12 > P("A6") ? p : p + 12);
  if (b.tune.every((t) => t.p === null)) {
    // a bar without the tune: a little rising arpeggio of its chord, two octaves up
    CH[halvesOf(b.chord)[0][0]].slice(1).forEach((p, i) => celesta.push({ step: step(b.bar, i * 0.5), len: SPB, pitch: p + 24, vel: v }));
    continue;
  }
  let beat = 0;
  for (const { p, d } of b.tune) {
    if (p === null && d >= 1 && heard.length >= 2) {
      // a rest of a beat or more: the last two notes the tune sang, an octave up, in eighths
      heard.slice(-2).forEach((q, i) => celesta.push({ step: step(b.bar, beat + i * 0.5), len: SPB / 2, pitch: up(q), vel: r2(v * (i ? 0.85 : 1)) }));
    }
    if (p !== null) heard.push(p);
    beat += d;
  }
}

// ---- the instrument and the stems ------------------------------------------------------------------------------------------------------
// The piano layer's voice: "felt" (the day: the felt piano). "celesta" (the owner liked its clip "for the nighttime") is the named
// voice for the night, which is not in the slice; "epiano" (a mellow electric piano) is the third they heard. Set VOICE and run this
// again to hear another (the layers stay as they are).
const VOICE = "felt";
export const NIGHT_VOICE = "celesta";

const synth = (name, notes, set) => ({ name, kind: "synth", duty: 0.5, attack: 0.002, decay: 0.05, sustain: 1, release: 0.4, volume: 0.6, pan: 0, mute: false, ...set, notes });
function pianoTracks(voice) {
  if (voice === "felt") return [
    synth("right hand", right, { wave: "piano", brightness: 0.38, release: 0.5, volume: 0.62, reverb: 0.36 }),
    synth("left hand", pianoLeft, { wave: "piano", brightness: 0.18, release: 0.7, volume: 0.5, reverb: 0.4 }),
  ];
  if (voice === "epiano") return [
    synth("right hand", right, { wave: "fm", fmRatio: 1, fmIndex: 1.3, attack: 0.003, decay: 2.2, sustain: 0.3, release: 0.35, volume: 0.6, reverb: 0.3, fx: [{ type: "chorus", params: { rate: 0.35, depth: 2.2, mix: 0.35 } }] }),
    synth("left hand", pianoLeft, { wave: "fm", fmRatio: 1, fmIndex: 0.8, attack: 0.004, decay: 2.6, sustain: 0.3, release: 0.45, volume: 0.48, reverb: 0.3 }),
  ];
  if (voice === "celesta") {
    const high = new Set(["A''", "B'"]);
    return [
      synth("right hand", right.map((n) => (high.has(sectionAt(n.step)) ? n : { ...n, pitch: n.pitch + 12 })), { wave: "fm", fmRatio: 3, fmIndex: 0.45, attack: 0.003, decay: 1.8, sustain: 0, release: 0.5, volume: 0.55, reverb: 0.42 }),
      synth("left hand", pianoLeft.map((n) => ({ ...n, pitch: n.pitch + 12 })), { wave: "fm", fmRatio: 3, fmIndex: 0.25, attack: 0.004, decay: 2.4, sustain: 0, release: 0.6, volume: 0.4, reverb: 0.42 }),
    ];
  }
  throw new Error(`no voice ${voice}`);
}
// The layers' balance: all four with the piano at most about 3 dB louder than the piano alone (measured below, every run).
const LAYER = { bass: 0.6, brushes: 1, pad: 0.21, celesta: 0.34 };
function songFor(voice, lufs = -18) {
  const tracks = [
    ...pianoTracks(voice),
    synth("bass", bass, { wave: "saw", cutoff: 380, resonance: 0.1, sweep: 0.3, attack: 0.012, decay: 0.9, sustain: 0.5, release: 0.22, volume: LAYER.bass, pan: -0.05, reverb: 0.12 }),
    { name: "brushes", kind: "drums", kit: "chip", volume: LAYER.brushes, pan: 0.15, mute: false, reverb: 0.25, fx: [{ type: "eq", params: { low: -6, mid: -2, midFreq: 2500, high: -10 } }], notes: brushes },
    synth("pad", pad, { wave: "saw", unison: 3, detune: 9, cutoff: 850, resonance: 0.05, sweep: 0, attack: 0.9, decay: 0.5, sustain: 0.85, release: 1.4, volume: LAYER.pad, reverb: 0.45 }),
    synth("celesta", celesta, { wave: "fm", fmRatio: 3, fmIndex: 0.45, attack: 0.003, decay: 1.6, sustain: 0, release: 0.5, volume: LAYER.celesta, pan: 0.2, reverb: 0.45 }),
  ];
  return {
    version: 1, bpm: BPM, stepsPerBeat: SPB, length: LENGTH, tracks,
    room: { size: 0.66, damping: 0.7, mix: 1 },
    master: { volume: 1, lufs, limit: -1 },
    markers, tempos: tempoTrack, loop: { from: LOOP, to: LENGTH },
  };
}
const STEMS = [
  { name: "piano", tracks: ["right hand", "left hand"] },
  { name: "bass", tracks: ["bass"] },
  { name: "brushes", tracks: ["brushes"] },
  { name: "pad", tracks: ["pad"] },
  { name: "celesta", tracks: ["celesta"] },
];

// ---- making it ---------------------------------------------------------------------------------------------------------------------------
// The studio's own renderer, bundled for Node by the rolldown the studio has (this checkout's, or the main checkout's), so this
// script can measure the stems before writing them and render the audition clips.
async function renderer() {
  const out = join(GAME, "build", "audition");
  mkdirSync(out, { recursive: true });
  const common = execFileSync("git", ["-C", REPO, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim();
  const bundler = [join(REPO, "studio/node_modules/.bin/rolldown"), join(dirname(common), "studio/node_modules/.bin/rolldown")].find(existsSync);
  if (!bundler) throw new Error("no studio/node_modules: run `cd studio && ../scripts/env.sh npm ci` (a download: ask first)");
  const entry = join(out, "render-entry.ts");
  const lib = (f) => JSON.stringify(join(REPO, "studio/src/lib", f));
  writeFileSync(entry, `export { renderStems, stepTime, barStarts } from ${lib("song.ts")};\nexport { encodeWav } from ${lib("wav.ts")};\nexport { integratedLufs } from ${lib("loudness.ts")};\n`);
  execFileSync(bundler, [entry, "--file", join(out, "render.mjs"), "--format", "esm", "--platform", "node"], { stdio: "ignore" });
  return import(`${pathToFileURL(join(out, "render.mjs")).href}?${Date.now()}`);
}

const R = await renderer();
const OUT = join(GAME, "build", "audition");
const sumOf = (sounds) => {
  const n = sounds[0].channels[0].length;
  const ch = [new Float32Array(n), new Float32Array(n)];
  for (const s of sounds) for (let c = 0; c < 2; c++) for (let i = 0; i < n; i++) ch[c][i] += s.channels[c][i];
  return { rate: sounds[0].rate, channels: ch };
};
const lufsOf = (s) => R.integratedLufs(s.channels, s.rate);
// The piano alone is to sit at -18 LUFS (as the piece did before the layers): render once, measure, and set the song's target so
// that the sum of every stem lands where the piano alone is -18.
let song = songFor(VOICE);
let { stems } = R.renderStems(song, STEMS);
const lift = lufsOf(sumOf(stems.map((s) => s.sound))) - lufsOf(stems[0].sound);
if (lift > 3) throw new Error(`the full stack is ${lift.toFixed(1)} dB over the piano alone: lower LAYER`);
song = songFor(VOICE, r2(-18 + lift));
({ stems } = R.renderStems(song, STEMS));
const stageSounds = STEMS.map((_, k) => sumOf(stems.slice(0, k + 1).map((s) => s.sound)));
const rate = stems[0].sound.rate;
const loop = { start: Math.round(R.stepTime(song, LOOP) * rate), end: Math.round(R.stepTime(song, LENGTH) * rate) };
console.log(`${bar} bars, loop from step ${LOOP} to ${LENGTH}, ${VOICE}; all the layers lift it ${lift.toFixed(1)} dB`);
console.log("each stem alone: " + stems.map((s) => `${s.name} ${lufsOf(s.sound).toFixed(1)}`).join(", ") + " LUFS");
console.log("the stages (the whole piece): " + stageSounds.map((s, k) => `${STEMS.slice(0, k + 1).map((x) => x.name).join("+")} ${lufsOf(s).toFixed(1)} LUFS`).join(", "));

if (process.argv.includes("--measure")) {
  // (only the numbers above: nothing is written)
} else if (process.argv.includes("--audition")) {
  await audition();
} else {
  writeFileSync(join(GAME, "build", "fernhollow-score.json"), JSON.stringify({ bars: bar, loopFromBar: 2, sections: markers, voice: VOICE, stems: STEMS }, null, 1));
  console.log(tool("song_write", { name: "fernhollow", song, stems: STEMS }));
}

// The audition: each stage as a file (the whole piece, with its loop points, for sound_report: levels, a small speaker, the seam),
// and one clip of a drive as the game would play it: on foot, getting in, the layers joining, slowing for a junction, pulling away,
// stopping and getting out. The layers' levels come from the game's own rule (lib/music.lua's music.simulate, run in the game by
// the play tool), placed on the piece's bar lines as the mixer places them.
async function audition() {
  mkdirSync(join(OUT, "stages"), { recursive: true });
  for (const [k, s] of stageSounds.entries()) {
    const file = join(OUT, "stages", `stage-${k}-${STEMS.slice(0, k + 1).map((x) => x.name).join("-")}.wav`);
    writeFileSync(file, R.encodeWav(s, loop));
    const text = tool("sound_report", { file }, { quiet: true });
    console.log(`--- ${file.split("/").at(-1)}\n` + text.split("\n").filter((l) => /level:|energy by range|small speaker|loop seam|clicks|WARNING/.test(l)).join("\n"));
  }
  // the drive (seconds; the van's speed in m/s): an input every 0.1 s
  const DT = 0.1;
  const END = 68, IN = 6, OUT_AT = 61;
  const ramp = (t, a, b, t0, t1) => a + (b - a) * Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  const speedAt = (t) => {
    if (t < 8) return 0;
    if (t < 14) return ramp(t, 0, 9, 8, 14);
    if (t < 34) return 9 + 0.4 * Math.sin(t * 1.3); // cruising, with the small wobbles of a real drive
    if (t < 38) return ramp(t, 9, 1.5, 34, 38); // slowing for a junction
    if (t < 40) return 1.5;
    if (t < 45) return ramp(t, 1.5, 9, 40, 45); // pulling away
    if (t < 55) return 9 + 0.4 * Math.sin(t * 1.1);
    if (t < 59) return ramp(t, 9, 0, 55, 59); // stopping
    return 0;
  };
  const inputs = [];
  for (let k = 1; k * DT <= END + 1e-9; k++) { const t = k * DT; inputs.push({ driving: t >= IN && t < OUT_AT, speed: r2(speedAt(t)) }); }
  const lua = `require('lib.music').simulate({${inputs.map((x) => `{driving=${x.driving},speed=${x.speed}}`).join(",")}}, ${DT})`;
  const answer = tool("play", { start_scene: "title", steps: [{ wait: 1, record: lua }] }, { quiet: true });
  const line = answer.split("\n").find((l) => l.startsWith("record"));
  // (the line is `record `<expr>` (step 1, 1 frames): f2 <value>`, the value quoted or not)
  const text = /\): f\d+ (.*)$/.exec(line)[1].replace(/^"|"$/g, "");
  const events = text.split(";").filter(Boolean).map((e) => { const [t, layer, level, fade, at] = e.split(" "); return { t: +t, layer: +layer, level: +level, fade: +fade, at }; });
  // the piece from the start of A, each stem's level as the rule says (a change "at bar" waits for the piece's next bar line)
  const t0 = R.stepTime(song, LOOP);
  const barTimes = R.barStarts(song).map((b) => R.stepTime(song, b) - t0).filter((b) => b >= 0);
  const n = Math.round(END * rate);
  const at0 = Math.round(t0 * rate);
  const curves = STEMS.map((_, k) => {
    const c = new Float32Array(n).fill(k === 0 ? 1 : 0);
    if (k === 0) return c;
    const mine = events.filter((e) => e.layer === k).map((e) => ({ ...e, t: e.at === "bar" ? barTimes.find((b) => b >= e.t - 1e-6) ?? e.t : e.t }));
    let level = 0, from = 0, target = 0, start = 0, len = 1, j = 0;
    for (let i = 0; i < n; i++) {
      while (j < mine.length && mine[j].t <= i / rate) { from = level; target = mine[j].level; start = i; len = Math.max(1, Math.round(mine[j].fade * rate)); j++; }
      level = from + (target - from) * Math.min(1, (i - start) / len);
      c[i] = level;
    }
    return c;
  });
  // the dial: lower in the cab, eased (lib/music.lua: TUNE.cab and TUNE.ease)
  const dial = new Float32Array(n);
  let d = 1;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    d += ((t >= IN && t < OUT_AT ? 0.72 : 1) - d) / (0.5 * rate);
    dial[i] = d;
  }
  const ch = [new Float32Array(n), new Float32Array(n)];
  stems.forEach((s, k) => { for (let c = 0; c < 2; c++) for (let i = 0; i < n; i++) ch[c][i] += s.sound.channels[c][at0 + i] * curves[k][i] * dial[i]; });
  const fadeOut = Math.round(2 * rate);
  for (let i = n - fadeOut; i < n; i++) for (let c = 0; c < 2; c++) ch[c][i] *= (n - i) / fadeOut;
  const wav = join(OUT, "fernhollow-drive.wav"), m4a = join(OUT, "fernhollow-drive.m4a");
  writeFileSync(wav, R.encodeWav({ rate, channels: ch }));
  execFileSync("afconvert", ["-f", "m4af", "-d", "aac", "-b", "160000", wav, m4a]);
  writeFileSync(join(OUT, "fernhollow-drive-events.txt"), events.map((e) => `${e.t.toFixed(1)} s (speed ${inputs[Math.round(e.t / DT) - 1]?.speed} m/s): ${STEMS[e.layer].name} to ${e.level} over ${e.fade} s (${e.at})`).join("\n") + "\n");
  console.log(`the drive: ${END} s -> ${wav} and ${m4a}; ${events.length} level changes (build/audition/fernhollow-drive-events.txt)`);
  const report = tool("sound_report", { file: wav }, { quiet: true });
  console.log(report.split("\n").filter((l) => /level:|loudness over time|clicks|WARNING/.test(l)).join("\n"));
}
