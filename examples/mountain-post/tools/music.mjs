// The music: four pieces for felt piano that take turns through the day, with quiet between them (the owner, seventh play: the one
// piece was "too repetitive"; chosen fix: "several pieces that take turns, with quiet between them"). Each is written here note by
// note, plays once and ends (no loop), and is five stems of one song that the game plays together, sample-locked (lib/music.lua):
// the felt piano always, and four layers that join while the van is driven (bass, brushes, pad, celesta), the same rule for every
// piece.
//
//   fernhollow   F major, 68 to the minute, 4/4   the morning walk: the first piece, shortened to intro A B C A''' and an ending
//   thistle      G major, 104, 4/4                 a bright skipping tune (dotted eighths), a bouncing left hand, a trio in C
//   stillwater   E flat major, 58, 4/4             reflective and slow: long notes and sighs, a middle in C minor
//   meadowsweet  D major, 120, 3/4                 a folksy waltz: oom-pah-pah, a middle in G with a flat-seven C, the tune up high
//
// Each is 1 3/4 to 2 1/2 minutes in sections that come back changed, ends on a rolled chord that slows into it and a bar of
// silence for the room to ring out (nothing rings past the end, so nothing clicks), and is set so that the piano alone measures
// -18 LUFS (the stack of all five a dB or two over it). Phrases end on rests; the level rises and falls; the tempo eases at the
// ends of sections.
//
// Run from the repository's root: scripts/env.sh node examples/mountain-post/tools/music.mjs [--only <name>] [--measure | --audition]
// (song_write renders each as five stems, music/<name>_<stem>.ogg, with the bar lines; --measure only prints the levels;
// --audition renders each piece, piano alone and full, checks them with sound_report and writes one clip of excerpts to
// build/audition/).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { GAME, REPO, tool } from "./lib.mjs";

const SPB = 4; // steps a beat: sixteenths (the brushes' lilt and the skipping tune need them)

// ---- pitches -----------------------------------------------------------------------------------------------------------------------
const NAMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/// "Bb4" -> 70, "C5" -> 72, "F#3" -> 54
const P = (s) => {
  const m = /^([A-G])(b|#)?(-?\d)$/.exec(s);
  if (!m) throw new Error(`not a pitch: ${s}`);
  return 12 * (Number(m[3]) + 1) + NAMES[m[1]] + (m[2] === "b" ? -1 : m[2] === "#" ? 1 : 0);
};
const r2 = (x) => Math.round(x * 100) / 100;

// ---- the tunes: one string a bar, "pitch:beats" or "r:beats" (a rest) --------------------------------------------------------------
const tune = (bars) => bars.map((bar) => bar.trim().split(/\s+/).map((t) => {
  const [p, d] = t.split(":");
  return { p: p === "r" ? null : P(p), d: Number(d) };
}));
const up = (bars, n = 12) => bars.map((bar) => bar.map(({ p, d }) => ({ p: p === null ? null : p + n, d })));

// A chord is its notes from the bottom: the bass, then the rest in the octave above it (the left hand's patterns pick by index).
const chords = (t) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.map(P)]));

// ---- the pieces --------------------------------------------------------------------------------------------------------------------
// Each piece: its tempo, beats a bar, chords, left-hand patterns ([beat, which note of the chord (0 the bass), held for beats]: every
// note is held as on the pedal), the voice's brightness, how its layers play, and `write(s)`, which lays it out section by section.
const PIECES = [];

// Fernhollow (the first piece, kept: the owner liked it for the day). The notes are the old loop's; its form is shortened to
// intro A B C A''' and a real ending (the ornamented A', the high A'' and B' are gone), so it no longer loops and lasts 2 minutes.
PIECES.push({
  name: "fernhollow", title: "Fernhollow", key: "F major", character: "the morning walk: an unhurried tune over a broken-chord left hand",
  bpm: 68, beats: 4, ease: 7, excerpt: "A",
  chords: chords({
    F: ["F2", "C3", "A3", "C4"], Dm: ["D2", "A2", "F3", "A3"], Bb: ["Bb1", "F2", "D3", "F3"], C: ["C2", "G2", "E3", "G3"],
    Am: ["A1", "E2", "C3", "E3"], Gm: ["G1", "D2", "Bb2", "D3"], Gm7: ["G1", "D2", "F3", "Bb3"], Csus: ["C2", "G2", "F3", "G3"],
    FA: ["A1", "F2", "C3", "F3"], Eb: ["Eb2", "Bb2", "G3", "Bb3"], BbD: ["D2", "Bb2", "F3", "Bb3"], C7: ["C2", "G2", "E3", "Bb3"],
  }),
  lh: {
    broken: [[0, 0, 4], [1, 1, 3], [2, 2, 2], [3, 1, 1]],
    long: [[0, 0, 4], [2, 2, 2], [2, 3, 2]],
    rolling: [[0, 0, 4], [0.5, 1, 3.5], [1, 2, 3], [1.5, 3, 2.5], [2, 1, 2], [2.5, 2, 1.5], [3, 3, 1], [3.5, 2, 0.5]],
    intro: [[0, 0, 4], [1, 1, 3], [2, 3, 2]],
  },
  thin: ["C"], // (the piano stem keeps only the beats of C's rolling eighths: the layers fill the rest)
  bright: [0.38, 0.18],
  layers: { bass: "two", brushes: "lilt", balance: { bass: 0.42, bassUp: 0.4, brushes: 1, pad: 0.21, celesta: 0.34 } },
  write(s) {
    s.intro(["F", "Csus"], "intro", [0.42, 0.36]);
    s.section("A", tune([
      "C5:1 A4:0.5 C5:0.5 F5:1.5 r:0.5", "E5:1 D5:1 A4:1.5 r:0.5", "D5:1 C5:0.5 Bb4:0.5 D5:1 F5:1", "E5:3 r:1",
      "C5:1 A4:0.5 C5:0.5 A5:1.5 G5:0.5", "E5:1.5 C5:0.5 A4:1.5 r:0.5", "Bb4:1 D5:1 C5:1 E5:1", "F5:3 r:1",
    ]), ["F", "Dm", "Bb", "C", "F", "Am", ["Bb", "C"], "F"], "broken", 0.62);
    s.section("B", tune([
      "A4:1.5 F4:0.5 D4:1 F4:1", "Bb4:2 A4:1 G4:1", "G4:1.5 Bb4:0.5 D5:1 C5:1", "C5:3 r:1",
      "A4:1 D5:1 F5:1 E5:1", "D5:2 C5:1 Bb4:1", "Bb4:1 A4:1 G4:1 F4:1", "G4:2 r:2",
    ]), ["Dm", "Bb", "Gm", "C", "Dm", "Bb", "Gm7", "Csus"], "long", 0.52);
    s.section("C", tune([
      "F5:2 D5:1 Bb4:1", "C5:2 A4:1.5 r:0.5", "Bb4:1 D5:1 G5:2", "F5:3 r:1",
      "G5:1.5 F5:0.5 Eb5:2", "D5:2 Bb4:1 D5:1", "C5:2 E5:1 G5:1", "r:4",
    ]), ["Bb", "FA", "Gm", "F", "Eb", "BbD", "C", "C7"], "rolling", 0.74, { lastBarPattern: "long" });
    s.section("A'''", tune([
      "C5:1 A4:0.5 C5:0.5 F5:1.5 r:0.5", "E5:1 D5:1 A4:1.5 r:0.5", "D5:1 C5:0.5 Bb4:0.5 D5:1 F5:1", "E5:2 G5:1 E5:1",
      "C5:1 A4:0.5 C5:0.5 A5:2", "G5:1 E5:1 C5:1 D5:1", "Bb4:1 A4:1 G4:1 E4:1", "F4:3 r:1",
    ]), ["F", "Dm", "Bb", "C", "F", "Am", ["Bb", "C7"], "F"], "broken", 0.56, { ending: 2 });
  },
});

// Thistle Lane: bright and skipping. Dotted eighths in the tune, an oom-pa left hand, a legato B on E minor, a trio in C major that
// ends on a bar with no tune, and the tune once more into a short coda.
PIECES.push({
  name: "thistle", title: "Thistle Lane", key: "G major", character: "a bright skipping tune: dotted eighths over a bouncing left hand",
  bpm: 104, beats: 4, ease: 8, excerpt: "A",
  chords: chords({
    G: ["G2", "D3", "B3", "D4"], C: ["C2", "G2", "E3", "G3"], D: ["D2", "A2", "F#3", "A3"], D7: ["D2", "A2", "F#3", "C4"],
    Em: ["E2", "B2", "G3", "B3"], Am: ["A1", "E2", "C3", "E3"], GB: ["B1", "G2", "D3", "G3"], F: ["F2", "C3", "A3", "C4"],
  }),
  lh: {
    bounce: [[0, 0, 1], [1, 2, 0.5], [1, 3, 0.5], [2, 1, 1], [3, 2, 0.5], [3, 3, 0.5]],
    broken: [[0, 0, 4], [1, 1, 3], [2, 2, 2], [3, 1, 1]],
    rolling: [[0, 0, 4], [0.5, 1, 3.5], [1, 2, 3], [1.5, 3, 2.5], [2, 1, 2], [2.5, 2, 1.5], [3, 3, 1], [3.5, 2, 0.5]],
    long: [[0, 0, 4], [2, 2, 2], [2, 3, 2]],
  },
  thin: ["C"],
  bright: [0.42, 0.2],
  layers: { bass: "short", brushes: "skip", balance: { bass: 0.4, bassUp: 0.38, brushes: 0.85, pad: 0.17, celesta: 0.3 } },
  write(s) {
    s.intro(["G", "D7"], "bounce", [0.46, 0.42]);
    const A = [
      "D5:0.75 B4:0.25 G4:0.75 B4:0.25 D5:1 G5:1", "E5:0.75 D5:0.25 C5:0.75 E5:0.25 G5:1.5 r:0.5",
      "D5:0.75 B4:0.25 G4:0.75 A4:0.25 B4:1 D5:1", "A4:0.75 B4:0.25 A4:0.75 F#4:0.25 D4:1.5 r:0.5",
      "D5:0.75 B4:0.25 G4:0.75 B4:0.25 D5:1 G5:1", "B5:0.75 A5:0.25 G5:0.75 E5:0.25 G5:1 E5:1",
      "C5:0.75 E5:0.25 D5:0.75 C5:0.25 B4:1 A4:1",
    ];
    const harmA = ["G", "C", "G", "D", "G", ["Em", "C"], ["Am", "D7"], "G"];
    s.section("A", tune([...A, "G4:2.5 r:1.5"]), harmA, "bounce", 0.64);
    s.section("A'", tune([
      "D5:0.75 B4:0.25 G4:0.75 B4:0.25 D5:0.75 E5:0.25 G5:1", "E5:0.75 D5:0.25 C5:0.75 E5:0.25 G5:1 A5:0.5 G5:0.5",
      "F#5:0.75 E5:0.25 D5:0.75 A4:0.25 F#4:0.75 A4:0.25 D5:1", "C5:0.75 B4:0.25 A4:0.75 F#4:0.25 D4:1 r:1",
      "G5:0.75 F#5:0.25 G5:0.75 D5:0.25 B4:1 G4:1", "E5:0.75 F#5:0.25 G5:0.75 B5:0.25 A5:1 G5:1",
      "E5:0.75 C5:0.25 A4:0.75 B4:0.25 C5:1 F#5:1", "G5:1.5 D5:0.5 G4:1 r:1",
    ]), ["G", "C", "D", "D7", "G", ["Em", "C"], ["Am", "D7"], "G"], "bounce", 0.68);
    s.section("B", tune([
      "B4:1.5 E5:0.5 G5:1 F#5:1", "E5:1.5 D5:0.5 C5:1 r:1", "D5:0.75 C5:0.25 B4:0.75 C5:0.25 D5:1 G5:1", "F#5:3 r:1",
      "G5:1.5 F#5:0.5 E5:1 B4:1", "C5:1.5 E5:0.5 A5:1 G5:1", "E5:0.75 D5:0.25 C5:0.75 B4:0.25 C5:1 E5:1", "D5:2 F#4:0.75 A4:0.25 C5:1",
    ]), ["Em", "C", "G", "D", "Em", "Am", "C", "D7"], "broken", 0.56);
    s.section("C", tune([
      "E5:0.75 G5:0.25 C6:1 B5:0.75 A5:0.25 G5:1", "D5:0.75 G5:0.25 B5:1 A5:1 G5:1", "C5:0.75 E5:0.25 A5:1 G5:0.75 F5:0.25 E5:1", "B4:3 r:1",
      "A4:0.75 C5:0.25 F5:1 E5:0.75 D5:0.25 C5:1", "G4:0.75 C5:0.25 E5:1 G5:1.5 r:0.5",
      "A5:0.75 G5:0.25 E5:0.75 C5:0.25 D5:0.75 E5:0.25 F#5:1", "r:4",
    ]), ["C", "GB", "Am", "Em", "F", "C", ["Am", "D"], "D7"], "rolling", 0.74, { lastBarPattern: "long" });
    s.section("A''", tune([...A, "G4:0.75 B4:0.25 D5:0.75 B4:0.25 G4:2", "E5:0.75 D5:0.25 C5:0.75 E5:0.25 D5:1 B4:1", "G4:3 r:1"]),
      [...harmA, "C", "G"], "bounce", 0.62, { ending: 2 });
  },
});

// Stillwater: reflective and slow, in E flat. Long notes and sighs over a slow rolled left hand; a middle in C minor that climbs
// to a held G and falls back; the tune again, closing on C minor instead of home, and a three-bar coda that finds E flat.
PIECES.push({
  name: "stillwater", title: "Stillwater", key: "E flat major", character: "reflective and slow: long notes and sighs, a middle in C minor",
  bpm: 58, beats: 4, ease: 5, excerpt: "A",
  chords: chords({
    Eb: ["Eb2", "Bb2", "G3", "Bb3"], Ab: ["Ab1", "Eb2", "C3", "Eb3"], AbM7: ["Ab1", "Eb2", "C3", "G3"], Bb: ["Bb1", "F2", "D3", "F3"],
    Bbsus: ["Bb1", "F2", "Eb3", "F3"], Cm: ["C2", "G2", "Eb3", "G3"], Gm: ["G1", "D2", "Bb2", "D3"], Fm: ["F1", "C2", "Ab2", "C3"],
  }),
  lh: {
    slow: [[0, 0, 4], [0.5, 1, 3.5], [1, 2, 3], [2, 3, 2]],
    long: [[0, 0, 4], [2, 2, 2], [2, 3, 2]],
    tenths: [[0, 0, 4], [1, 2, 3], [2.5, 3, 1.5]],
  },
  thin: [],
  bright: [0.32, 0.16],
  layers: { bass: "long", brushes: "soft", balance: { bass: 0.4, bassUp: 0.36, brushes: 1.2, pad: 0.22, celesta: 0.34 } },
  write(s) {
    s.intro(["Eb"], "slow", [0.4]);
    const A = [
      "G4:1.5 Ab4:0.5 Bb4:2", "C5:1.5 Bb4:0.5 Ab4:1 G4:1", "G4:1 Eb4:1 F4:1 G4:1", "F4:3 r:1",
      "G4:1.5 Ab4:0.5 Bb4:1 Eb5:1", "Eb5:1.5 D5:0.5 C5:1.5 r:0.5",
    ];
    s.section("A", tune([...A, "C5:1 Ab4:1 Bb4:1.5 F4:0.5", "Eb4:3 r:1"]), ["Eb", "AbM7", "Cm", "Bb", "Eb", "Ab", ["Fm", "Bb"], "Eb"], "slow", 0.52);
    s.section("B", tune([
      "Eb5:2 D5:1 C5:1", "D5:1.5 Bb4:0.5 G4:1.5 r:0.5", "C5:1 Eb5:1 Ab5:1.5 G5:0.5", "G5:3 r:1",
      "F5:1.5 Eb5:0.5 C5:1 Ab4:1", "G4:1.5 C5:0.5 Eb5:1 D5:1", "C5:2 Bb4:1 Ab4:1", "Bb4:2 r:2",
    ]), ["Cm", "Gm", "Ab", "Eb", "Fm", "Cm", "Ab", "Bbsus"], "tenths", 0.58);
    s.section("A'", tune([...A, "C5:1 Ab4:1 G4:1 F4:1", "Eb4:2 r:2"]), ["Eb", "AbM7", "Cm", "Bb", "Eb", "Ab", ["Fm", "Bb"], "Cm"], "slow", 0.5);
    s.section("coda", tune(["Ab4:1.5 G4:0.5 F4:2", "F4:1 G4:1 D4:2", "Eb4:3 r:1"]), ["Ab", "Bb", "Eb"], "slow", 0.44, { ending: 2 });
  },
});

// Meadowsweet: a folksy waltz in D. Oom-pah-pah, a sixteen-bar tune and its ornamented repeat, a middle in G that touches a flat-seven
// C (the folk colour) and B minor and ends on a bar with no tune, the tune an octave up and soft, then down again into a slowing coda.
PIECES.push({
  name: "meadowsweet", title: "Meadowsweet", key: "D major", character: "a folksy waltz in 3/4: oom-pah-pah, a middle in G",
  bpm: 120, beats: 3, ease: 8, excerpt: "A",
  chords: chords({
    D: ["D2", "A2", "F#3", "A3"], A7: ["A1", "E2", "C#3", "G3"], A: ["A1", "E2", "C#3", "E3"], G: ["G2", "D3", "B3", "D4"],
    Em: ["E2", "B2", "G3", "B3"], Bm: ["B1", "F#2", "D3", "F#3"], Fsm: ["F#2", "C#3", "A3", "C#4"], C: ["C2", "G2", "E3", "G3"],
  }),
  lh: {
    oompah: [[0, 0, 3], [1, 2, 0.75], [1, 3, 0.75], [2, 2, 0.75], [2, 3, 0.75]],
    lilt: [[0, 0, 3], [1, 2, 1], [1, 3, 1], [2.5, 1, 0.5]],
    roll: [[0, 0, 3], [0.5, 1, 2.5], [1, 2, 2], [1.5, 3, 1.5], [2, 2, 1], [2.5, 1, 0.5]],
    high: [[0, 0, 3], [1, 3, 1], [2, 2, 1]],
    hold: [[0, 0, 3], [1, 2, 2], [1, 3, 2]],
  },
  thin: ["B"],
  bright: [0.38, 0.2],
  layers: { bass: "waltz", brushes: "waltz", balance: { bass: 0.4, bassUp: 0.36, brushes: 0.85, pad: 0.18, celesta: 0.3 } },
  write(s) {
    s.intro(["D", "D", "A7", "A7"], "oompah", [0.44, 0.4, 0.42, 0.38]);
    const harmA = ["D", "A7", "A7", "D", "G", "D", "Em", "A", "D", "A7", "A7", "D", "G", "D", "A7", "D"];
    const A1 = ["F#4:1 A4:1 D5:1", "E5:2 C#5:1", "G4:1 A4:1 C#5:1", "D5:2 r:1", "B4:1 D5:1 G5:1", "F#5:2 D5:1", "G5:1.5 F#5:0.5 E5:1", "E5:2 r:1"];
    s.section("A", tune([...A1,
      "F#4:1 A4:1 D5:1", "E5:2 C#5:1", "G5:1 F#5:1 E5:1", "F#5:2 r:1", "B5:1.5 A5:0.5 G5:1", "F#5:1.5 E5:0.5 D5:1", "C#5:1 E5:1 A4:1", "D5:2 r:1",
    ]), harmA, "oompah", 0.6);
    s.section("A'", tune([
      "F#4:0.5 G4:0.5 A4:1 D5:1", "E5:1.5 D5:0.5 C#5:1", "B4:0.5 A4:0.5 G4:1 C#5:1", "D5:1 F#5:1 r:1",
      "B4:0.5 C#5:0.5 D5:1 G5:1", "F#5:1.5 E5:0.5 D5:1", "G5:1 F#5:0.5 E5:0.5 D5:0.5 C#5:0.5", "E5:2 r:1",
      "A5:1 F#5:0.5 E5:0.5 D5:1", "E5:1.5 G5:0.5 E5:1", "C#5:1 B4:0.5 C#5:0.5 E5:1", "D5:2 r:1",
      "D5:1 G5:1 B5:1", "A5:1.5 F#5:0.5 D5:1", "E5:1 G5:1 C#5:1", "D5:2 r:1",
    ]), harmA, "lilt", 0.64);
    s.section("B", tune([
      "D5:1 G5:1.5 A5:0.5", "B5:2 G5:1", "A5:1 F#5:1 D5:1", "F#5:2 r:1", "G5:1.5 E5:0.5 C5:1", "D5:1.5 B4:0.5 G4:1", "A4:1 C#5:1 E5:1", "D5:2 r:1",
      "F#5:1.5 D5:0.5 B4:1", "C#5:1 F#5:1 A5:1", "B5:1.5 A5:0.5 G5:1", "F#5:2 r:1", "G5:1 E5:1 B4:1", "C#5:1 E5:1 G5:1", "F#5:2 D5:1", "r:3",
    ]), ["G", "G", "D", "D", "C", "G", "A7", "D", "Bm", "Fsm", "G", "D", "Em", "A7", "D", "A7"], "roll", 0.7, { lastBarPattern: "hold" });
    s.section("A''", up(tune(A1)), harmA.slice(0, 8), "high", 0.48);
    s.section("A'''", tune([
      "F#4:1 A4:1 D5:1", "E5:2 C#5:1", "G5:1 F#5:1 E5:1", "F#5:2 r:1", "B5:1.5 A5:0.5 G5:1", "F#5:1 E5:1 D5:1", "E5:1.5 C#5:0.5 A4:1", "D5:2 r:1",
      "r:1 B4:1 D5:1", "F#5:3", "r:1 E5:1 C#5:1", "D5:3",
    ]), [...harmA.slice(8), "G", "D", "A7", "D"], "oompah", 0.56, { ending: 4, rest: 2 });
  },
});

// ---- building a piece --------------------------------------------------------------------------------------------------------------
function build(def) {
  const { beats, bpm } = def;
  const CH = def.chords;
  const LH = { ...def.lh, end: [[0, 0, beats], [0.17, 1, beats - 0.17], [0.33, 2, beats - 0.33], [0.5, 3, beats - 0.5]] };
  const right = [], left = [], markers = [], tempos = [], bars = [];
  let bar = 0;
  const step = (b, beat) => Math.round((b * beats + beat) * SPB);

  // the left hand of one bar: the chord (or two, each for half the bar) in a pattern, at a level
  function leftBar(chord, pattern, vel) {
    const halves = Array.isArray(chord) ? chord : [chord];
    const half = beats / 2;
    for (const [beat, which, hold] of LH[pattern]) {
      const h = halves.length > 1 ? (beat < half ? 0 : 1) : 0;
      const notes = CH[halves[h]];
      if (!notes) throw new Error(`${def.name}: no chord ${halves[h]}`);
      const end = halves.length > 1 && h === 0 ? half : beats;
      const len = Math.max(0.5, Math.min(hold, end - beat));
      const pitch = notes[which];
      // the bass a touch firmer than the rest; later notes of a bar a little softer
      const v = vel * (which === 0 ? 1.08 : 0.86 - beat * 0.03);
      left.push({ step: step(bar, beat), len: Math.round(len * SPB), pitch, vel: r2(v), pan: r2((pitch - 52) / 60) });
    }
  }

  const api = {
    // bars of the left hand alone, getting ready
    intro(harm, pattern, levels) {
      markers.push({ step: 0, name: "intro" });
      harm.forEach((c, i) => {
        leftBar(c, pattern, levels[i]);
        bars.push({ bar, chord: c, section: "intro", level: levels[i], tune: null });
        bar++;
      });
    },
    // a section: its tune over its chords, a level that rises and falls over it; `ending` bars slow into the last chord, which is
    // rolled and held, and then `rest` bars of silence let the room ring out
    section(name, melody, harm, pattern, level, opts = {}) {
      markers.push({ step: step(bar, 0), name });
      const n = melody.length;
      if (harm.length !== n) throw new Error(`${def.name} ${name}: ${n} bars of tune, ${harm.length} chords`);
      for (let i = 0; i < n; i++) {
        const swell = 0.86 + 0.14 * Math.sin(Math.PI * (i + 0.5) / n) + (i % 4 === 3 ? -0.05 : 0);
        const last = opts.ending && i === n - 1;
        let beat = 0;
        for (const { p, d } of melody[i]) {
          if (p !== null) {
            // a note on the beat a little firmer; a long note a little firmer still
            const accent = (Number.isInteger(beat) ? 1 : 0.9) * (d >= 2 ? 1.04 : 1);
            const v = Math.min(1, level * swell * accent * (last ? 0.85 : 1));
            right.push({ step: step(bar, beat), len: Math.max(1, Math.round(d * SPB)), pitch: p, vel: r2(v), pan: r2((p - 64) / 70) });
          }
          beat += d;
        }
        if (Math.abs(beat - beats) > 1e-9) throw new Error(`${def.name} ${name} bar ${i + 1} has ${beat} beats, not ${beats}`);
        bars.push({ bar, chord: harm[i], section: name, level: level * swell, tune: melody[i] });
        const pat = last ? "end" : opts.lastBarPattern && i === n - 1 ? opts.lastBarPattern : pattern;
        leftBar(harm[i], pat, level * 0.62 * swell * (last ? 0.85 : 1));
        bar++;
      }
      if (opts.ending) {
        // a ritardando over the last bars, into the held chord
        tempos.push({ step: step(bar - opts.ending, 0), bpm });
        tempos.push({ step: step(bar - 1, 0), bpm: Math.round(bpm * 0.8), ramp: true });
        for (let k = 0; k < (opts.rest ?? 1); k++) {
          if (k === 0) markers.push({ step: step(bar, 0), name: "end" });
          bars.push({ bar, chord: null, section: "end", level: 0, tune: null });
          bar++;
        }
      } else {
        // the tempo eases into the section's last bar and picks up again after it
        tempos.push({ step: step(bar - 1, 0), bpm });
        tempos.push({ step: step(bar - 1, beats - 0.5), bpm: bpm - def.ease, ramp: true });
        tempos.push({ step: step(bar, 0), bpm });
      }
    },
  };
  def.write(api);
  const LENGTH = step(bar, 0);
  if (LENGTH > 1024) throw new Error(`${def.name} is ${LENGTH} steps: more than a song may have`);
  const tempoTrack = [];
  for (const t of tempos.sort((a, b) => a.step - b.step)) {
    if (t.step <= 0 || t.step >= LENGTH) continue;
    if (tempoTrack.length && tempoTrack.at(-1).step === t.step) tempoTrack[tempoTrack.length - 1] = t; else tempoTrack.push(t);
  }

  // ---- the layers ------------------------------------------------------------------------------------------------------------------
  // Five stems the game plays together, in step: the felt piano always, and four layers that join one at a time while the van is
  // driven. Each works with the piano and with any of the ones before it.
  //   piano     the tune and the left hand (in the `thin` sections the left hand's flowing eighths keep only the beats)
  //   bass      a round, soft bass (a saw through a low filter, and the same line an octave up for a small speaker), its pattern
  //             the piece's: root and fifth on 1 and 3, short and skipping, held a bar, or the waltz's oom alternating root and fifth
  //   brushes   a shaker and soft taps: the lilt (a ghost before 3 and 1), a swung skip, a soft pulse, or the waltz's pah-pah
  //   pad       warm, slow strings (three detuned saws through a low filter) holding each chord from D3 up, under the tune
  //   celesta   the celesta answering the tune in its rests (its last two notes an octave up), an arpeggio where the tune is silent
  // The intro and the ending's silence are the piano's alone.
  const sectionAt = (st) => markers.filter((m) => m.step <= st).at(-1)?.name ?? "intro";
  const thin = new Set(def.thin);
  const pianoLeft = left.filter((n) => !(thin.has(sectionAt(n.step)) && n.step % SPB !== 0));
  const halvesOf = (c) => (Array.isArray(c) ? [[c[0], 0, beats / 2], [c[1], beats / 2, beats / 2]] : [[c, 0, beats]]);
  const played = bars.filter((b) => b.chord && b.section !== "intro" && b.tune);
  const L = def.layers;

  const bass = [];
  let prev = null, flip = false;
  for (const b of played) {
    const v = r2(0.5 + 0.4 * (b.level - 0.45));
    if (Array.isArray(b.chord)) {
      for (const [c, at, len] of halvesOf(b.chord)) bass.push({ step: step(b.bar, at), len: Math.round((len - 0.25) * SPB), pitch: CH[c][0], vel: v });
    } else if (L.bass === "two" || L.bass === "short") {
      const len = L.bass === "short" ? 0.75 : 1.75;
      bass.push({ step: step(b.bar, 0), len: Math.round(len * SPB), pitch: CH[b.chord][0], vel: v });
      bass.push({ step: step(b.bar, 2), len: Math.round(len * SPB), pitch: CH[b.chord][1], vel: r2(v * 0.88) });
    } else if (L.bass === "long") {
      bass.push({ step: step(b.bar, 0), len: Math.round((beats - 0.25) * SPB), pitch: CH[b.chord][0], vel: v });
    } else if (L.bass === "waltz") {
      // the oom: the root, and the fifth below it on the second bar of a chord held two bars
      flip = prev === b.chord ? !flip : false;
      bass.push({ step: step(b.bar, 0), len: Math.round(2.5 * SPB), pitch: flip ? CH[b.chord][1] - 12 : CH[b.chord][0], vel: r2(v * (flip ? 0.9 : 1)) });
    }
    prev = b.chord;
  }
  // (the bass's upper voice: the same line an octave up, a round saw, so that a small speaker hears the bass's weight)
  const bassUp = bass.map((n) => ({ ...n, pitch: n.pitch + 12, vel: r2(n.vel * 0.9) }));

  const brushes = [];
  const hit = (b, beat, pitch, vel) => brushes.push({ step: step(b.bar, beat), len: 1, pitch, vel: r2(vel) });
  for (const b of played) {
    const k = Math.min(1.2, Math.max(0.75, 1 + 1.2 * (b.level - 0.62)));
    if (L.brushes === "lilt") {
      for (let e = 0; e < 8; e++) hit(b, e / 2, 42, (e % 2 ? 0.5 : 0.8) * k);
      for (const beat of [1.75, 3.75]) hit(b, beat, 42, 0.3 * k);
      for (const beat of [1, 3]) hit(b, beat, 38, 0.6 * k);
    } else if (L.brushes === "skip") {
      for (let q = 0; q < 4; q++) { hit(b, q, 42, 0.8 * k); hit(b, q + 0.75, 42, 0.45 * k); }
      for (const beat of [1, 3]) hit(b, beat, 38, 0.55 * k);
    } else if (L.brushes === "soft") {
      for (let q = 0; q < 4; q++) { hit(b, q, 42, (q % 2 ? 0.45 : 0.6) * k); hit(b, q + 0.5, 42, 0.25 * k); }
      hit(b, 2, 38, 0.4 * k);
    } else if (L.brushes === "waltz") {
      for (let e = 0; e < 6; e++) hit(b, e / 2, 42, (e === 0 ? 0.8 : e % 2 ? 0.4 : 0.6) * k);
      hit(b, 2.75, 42, 0.3 * k);
      for (const beat of [1, 2]) hit(b, beat, 38, 0.45 * k);
    }
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
    const lift = (p) => (p + 12 > P("A6") ? p : p + 12);
    if (b.tune.every((t) => t.p === null)) {
      // a bar without the tune: a little rising arpeggio of its chord, two octaves up
      CH[halvesOf(b.chord)[0][0]].slice(1).forEach((p, i) => celesta.push({ step: step(b.bar, i * 0.5), len: SPB, pitch: p + 24, vel: v }));
      continue;
    }
    let beat = 0;
    for (const { p, d } of b.tune) {
      if (p === null && d >= 1 && heard.length >= 2) {
        // a rest of a beat or more: the last two notes the tune sang, an octave up, in eighths
        heard.slice(-2).forEach((q, i) => celesta.push({ step: step(b.bar, beat + i * 0.5), len: SPB / 2, pitch: lift(q), vel: r2(v * (i ? 0.85 : 1)) }));
      }
      if (p !== null) heard.push(p);
      beat += d;
    }
  }
  return { def, right, pianoLeft, bass, bassUp, brushes, pad, celesta, markers, tempos: tempoTrack, LENGTH, bars: bar };
}

// ---- the instrument and the stems ------------------------------------------------------------------------------------------------------
// The piano layer's voice: "felt" (the day). "celesta" (the owner liked its clip "for the nighttime") is the named voice for the
// night, which is not in the slice; "epiano" (a mellow electric piano) is the third they heard. Set VOICE and run this again to hear
// another (the layers stay as they are).
const VOICE = "felt";
export const NIGHT_VOICE = "celesta";

const synth = (name, notes, set) => ({ name, kind: "synth", duty: 0.5, attack: 0.002, decay: 0.05, sustain: 1, release: 0.4, volume: 0.6, pan: 0, mute: false, ...set, notes });
function pianoTracks(b, voice) {
  const [rb, lb] = b.def.bright;
  if (voice === "felt") return [
    synth("right hand", b.right, { wave: "piano", brightness: rb, release: 0.5, volume: 0.62, reverb: 0.36 }),
    synth("left hand", b.pianoLeft, { wave: "piano", brightness: lb, release: 0.7, volume: 0.5, reverb: 0.4 }),
  ];
  if (voice === "epiano") return [
    synth("right hand", b.right, { wave: "fm", fmRatio: 1, fmIndex: 1.3, attack: 0.003, decay: 2.2, sustain: 0.3, release: 0.35, volume: 0.6, reverb: 0.3, fx: [{ type: "chorus", params: { rate: 0.35, depth: 2.2, mix: 0.35 } }] }),
    synth("left hand", b.pianoLeft, { wave: "fm", fmRatio: 1, fmIndex: 0.8, attack: 0.004, decay: 2.6, sustain: 0.3, release: 0.45, volume: 0.48, reverb: 0.3 }),
  ];
  if (voice === "celesta") return [
    synth("right hand", b.right.map((n) => ({ ...n, pitch: n.pitch + (n.pitch < P("C6") ? 12 : 0) })), { wave: "fm", fmRatio: 3, fmIndex: 0.45, attack: 0.003, decay: 1.8, sustain: 0, release: 0.5, volume: 0.55, reverb: 0.42 }),
    synth("left hand", b.pianoLeft.map((n) => ({ ...n, pitch: n.pitch + 12 })), { wave: "fm", fmRatio: 3, fmIndex: 0.25, attack: 0.004, decay: 2.4, sustain: 0, release: 0.6, volume: 0.4, reverb: 0.42 }),
  ];
  throw new Error(`no voice ${voice}`);
}
function songFor(b, voice, lufs = -18) {
  const B = b.def.layers.balance;
  const tracks = [
    ...pianoTracks(b, voice),
    // (the low voice: a saw opened to 560 Hz for its 2nd to 6th harmonics, its fundamental cut where a small speaker has none (60 Hz,
    // 9 dB) and the 120 to 300 Hz presence lifted; the upper voice the same line an octave up)
    synth("bass", b.bass, { wave: "saw", cutoff: 560, resonance: 0.1, sweep: 0.3, attack: 0.012, decay: 0.9, sustain: 0.5, release: 0.22, volume: B.bass, pan: -0.05, reverb: 0.12,
      fx: [{ type: "parametric", params: { f1: 60, g1: -9, q1: 0.8, f2: 250, g2: 4, q2: 0.8, f3: 5000, g3: 0, q3: 1 } }] }),
    synth("bass upper", b.bassUp, { wave: "saw", cutoff: 640, resonance: 0.08, sweep: 0.25, attack: 0.012, decay: 0.9, sustain: 0.5, release: 0.22, volume: B.bassUp, pan: -0.05, reverb: 0.12 }),
    { name: "brushes", kind: "drums", kit: "chip", volume: B.brushes, pan: 0.15, mute: false, reverb: 0.25, fx: [{ type: "eq", params: { low: -6, mid: -2, midFreq: 2500, high: -10 } }], notes: b.brushes },
    synth("pad", b.pad, { wave: "saw", unison: 3, detune: 9, cutoff: 850, resonance: 0.05, sweep: 0, attack: 0.9, decay: 0.5, sustain: 0.85, release: 1.4, volume: B.pad, reverb: 0.45 }),
    synth("celesta", b.celesta, { wave: "fm", fmRatio: 3, fmIndex: 0.45, attack: 0.003, decay: 1.6, sustain: 0, release: 0.5, volume: B.celesta, pan: 0.2, reverb: 0.45 }),
  ];
  return {
    version: 1, bpm: b.def.bpm, stepsPerBeat: SPB, length: b.LENGTH, tracks,
    room: { size: 0.66, damping: 0.7, mix: 1 },
    master: { volume: 1, lufs, limit: -1 },
    ...(b.def.beats !== 4 ? { beatsPerBar: b.def.beats } : {}),
    markers: b.markers, tempos: b.tempos,
  };
}
const STEMS = [
  { name: "piano", tracks: ["right hand", "left hand"] },
  { name: "bass", tracks: ["bass", "bass upper"] },
  { name: "brushes", tracks: ["brushes"] },
  { name: "pad", tracks: ["pad"] },
  { name: "celesta", tracks: ["celesta"] },
];

// ---- making it ---------------------------------------------------------------------------------------------------------------------------
// The studio's own renderer, bundled for Node by the rolldown the studio has (this checkout's, or the main checkout's), so this
// script can measure the stems before writing them and render the audition.
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
const peakDb = (s, from, to) => {
  let m = 0;
  for (const c of s.channels) for (let i = Math.max(0, from); i < Math.min(c.length, to); i++) m = Math.max(m, Math.abs(c[i]));
  return m > 0 ? 20 * Math.log10(m) : -Infinity;
};

const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
const made = [];
for (const def of PIECES.filter((d) => !only || d.name === only)) {
  const b = build(def);
  // The piano alone is to sit at -18 LUFS: render once, measure, and set the song's target so that the sum of every stem lands
  // where the piano alone is -18.
  let song = songFor(b, VOICE);
  let { stems } = R.renderStems(song, STEMS);
  const lift = lufsOf(sumOf(stems.map((s) => s.sound))) - lufsOf(stems[0].sound);
  if (lift > 3) throw new Error(`${def.name}: the full stack is ${lift.toFixed(1)} dB over the piano alone: lower its balance`);
  song = songFor(b, VOICE, r2(-18 + lift));
  ({ stems } = R.renderStems(song, STEMS));
  const full = sumOf(stems.map((s) => s.sound));
  const seconds = stems[0].sound.channels[0].length / stems[0].sound.rate;
  console.log(`${def.name} (${def.title}): ${def.key}, ${def.bpm} bpm, ${def.beats}/4, ${b.bars} bars, ${seconds.toFixed(2)} s (${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}), ${b.LENGTH} steps`);
  console.log(`  each stem alone: ${stems.map((s) => `${s.name} ${lufsOf(s.sound).toFixed(1)}`).join(", ")} LUFS; all five ${lufsOf(full).toFixed(1)} (+${lift.toFixed(1)} dB)`);
  made.push({ def, b, song, stems, full, seconds, lift });
  if (!process.argv.includes("--measure") && !process.argv.includes("--audition")) {
    console.log(tool("song_write", { name: def.name, song, stems: STEMS }));
  }
}
if (made.length > 1) {
  const pianos = made.map((m) => lufsOf(m.stems[0].sound)), fulls = made.map((m) => lufsOf(m.full));
  const spread = (a) => Math.max(...a) - Math.min(...a);
  console.log(`across the pieces: piano alone ${spread(pianos).toFixed(2)} LU apart, all five ${spread(fulls).toFixed(2)} LU apart`);
  console.log(`for lib/music.lua: ${made.map((m) => `${m.def.name} = ${m.seconds.toFixed(2)}`).join(", ")}`);
}
if (process.argv.includes("--audition")) audition();

// The audition: each piece whole, piano alone and with every layer (WAV, for sound_report: levels, a small speaker, clicks, the start
// and the end), and one clip of excerpts of every piece, the piano alone for 20 s and then the layers joining (about 3 minutes; AAC).
function audition() {
  const dir = join(OUT, "pieces");
  mkdirSync(dir, { recursive: true });
  for (const m of made) {
    for (const [kind, sound] of [["piano", m.stems[0].sound], ["full", m.full]]) {
      const file = join(dir, `${m.def.name}-${kind}.wav`);
      writeFileSync(file, R.encodeWav(sound));
      const rate = sound.rate, n = sound.channels[0].length;
      const text = tool("sound_report", { file, loop: false, picture: false }, { quiet: true });
      console.log(`--- ${m.def.name} ${kind}: first 20 ms peak ${peakDb(sound, 0, rate / 50).toFixed(1)} dBFS, last 50 ms ${peakDb(sound, n - rate / 20, n).toFixed(1)} dBFS, last second ${peakDb(sound, n - rate, n).toFixed(1)} dBFS`);
      console.log(text.split("\n").filter((l) => /level:|small speaker|click|WARNING|energy by range/i.test(l)).join("\n"));
    }
  }
  // the excerpts: from each piece's first section, 21 s of the piano, then 23 s with the four layers fading in over 2.5 s
  const rate = made[0].stems[0].sound.rate;
  const EACH = 44, JOIN = 21, FADE = 2.5, OUTF = 1.5, GAP = 1.2;
  const parts = [];
  for (const m of made) {
    const at = Math.round(R.stepTime(m.song, m.b.markers.find((x) => x.name === m.def.excerpt).step) * rate);
    const n = Math.round(EACH * rate);
    const ch = [new Float32Array(n), new Float32Array(n)];
    m.stems.forEach((s, k) => {
      for (let i = 0; i < n; i++) {
        const t = i / rate;
        const g = k === 0 ? 1 : Math.min(1, Math.max(0, (t - JOIN) / FADE));
        for (let c = 0; c < 2; c++) ch[c][i] += (s.sound.channels[c][at + i] ?? 0) * g;
      }
    });
    for (let i = 0; i < Math.round(0.05 * rate); i++) for (let c = 0; c < 2; c++) ch[c][i] *= i / (0.05 * rate);
    for (let i = n - Math.round(OUTF * rate); i < n; i++) for (let c = 0; c < 2; c++) ch[c][i] *= (n - i) / (OUTF * rate);
    parts.push(ch, [new Float32Array(Math.round(GAP * rate)), new Float32Array(Math.round(GAP * rate))]);
  }
  const total = parts.reduce((a, p) => a + p[0].length, 0);
  const all = [new Float32Array(total), new Float32Array(total)];
  let o = 0;
  for (const p of parts) { all[0].set(p[0], o); all[1].set(p[1], o); o += p[0].length; }
  const wav = join(OUT, "mountain-post-pieces-excerpts.wav"), m4a = join(OUT, "mountain-post-pieces-excerpts.m4a");
  writeFileSync(wav, R.encodeWav({ rate, channels: all }));
  execFileSync("afconvert", ["-f", "m4af", "-d", "aac", "-b", "160000", wav, m4a]);
  console.log(`the excerpts: ${(total / rate).toFixed(1)} s -> ${m4a} (${made.map((m) => m.def.title).join(", ")}: each the piano alone for ${JOIN} s, then the layers)`);
}
