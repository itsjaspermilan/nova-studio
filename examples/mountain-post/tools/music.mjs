// The one piece of music, for piano (the owner, after the second play: "The music is a little repetitive. Can we use piano?").
// A soft felt piano (Nova's "piano" instrument, brightness low: a felt-muted upright), the right hand singing the tune, the left hand
// a simple accompaniment, nothing else: no drums, no bass but the left hand's low notes, a room round it. In F major, slow (68 to the
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
// (song_write renders it to music/fernhollow.ogg with its loop points; sound_report checks levels, the seam and a small speaker).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { GAME, REPO, tool } from "./lib.mjs";

const SPB = 2; // steps a beat: eighths
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
leftBar("F", "intro", 0.42); bar++;
leftBar("Csus", "intro", 0.36); bar++;
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
bar++;
const LENGTH = step(bar, 0);
if (LENGTH > 1024) throw new Error(`the song is ${LENGTH} steps: more than a song may have`);
// (the tempo track: the song's own bpm holds until the first change; keep only changes inside the song, in order, no repeats)
const tempoTrack = [];
for (const t of tempos.sort((a, b) => a.step - b.step)) {
  if (t.step <= 0 || t.step >= LENGTH) continue;
  if (tempoTrack.length && tempoTrack.at(-1).step === t.step) tempoTrack[tempoTrack.length - 1] = t; else tempoTrack.push(t);
}

// ---- the instrument -------------------------------------------------------------------------------------------------------------------
// Which instrument plays it: "felt" (the felt piano) ships. "epiano" (a mellow electric piano: a warm tine with a soft bell on the
// attack and a slow shimmer) and "celesta" (a soft, rounded celesta or music box, the tune an octave up) are the other two the owner
// can choose between by ear; set VOICE to one of them and run this again to make it the game's music.
// `--audition` writes a clip of each (the same 24 seconds: the tune, a quiet passage, the fullest) to build/audition/ and changes
// nothing in the game.
const VOICE = "felt";

const sectionAt = (s) => markers.filter((m) => m.step <= s).at(-1)?.name ?? "intro";
const synth = (name, notes, set) => ({ name, kind: "synth", duty: 0.5, attack: 0.002, decay: 0.05, sustain: 1, release: 0.4, volume: 0.6, pan: 0, mute: false, ...set, notes });
const master = { volume: 1, fx: [{ type: "compressor", params: { threshold: -20, ratio: 1.5, attack: 20, release: 250, makeup: 0 } }], lufs: -18, limit: -1.5 };

function songFor(voice) {
  let tracks, room;
  if (voice === "felt") {
    // Nova's piano voiced as a felt upright: dull, the right hand a little brighter than the left, a soft damper (release), a room
    tracks = [
      synth("right hand", right, { wave: "piano", brightness: 0.38, release: 0.5, volume: 0.62, reverb: 0.36 }),
      synth("left hand", left, { wave: "piano", brightness: 0.18, release: 0.7, volume: 0.5, reverb: 0.4 }),
    ];
    room = { size: 0.66, damping: 0.7, mix: 1 };
  } else if (voice === "epiano") {
    // a tine electric piano: FM with the modulator on the note (a warm body whose bend fades as it rings), a quiet bell an octave
    // and a fifth over it that dies in a quarter of a second, a slow chorus for the shimmer
    const shimmer = [{ type: "chorus", params: { rate: 0.35, depth: 2.2, mix: 0.35 } }];
    tracks = [
      synth("right hand", right, { wave: "fm", fmRatio: 1, fmIndex: 1.3, attack: 0.003, decay: 2.2, sustain: 0.3, release: 0.35, volume: 0.6, reverb: 0.3, fx: shimmer }),
      synth("right hand bell", right.map((n) => ({ ...n, vel: r2(n.vel * 0.8) })), { wave: "fm", fmRatio: 7, fmIndex: 0.8, attack: 0.002, decay: 0.25, sustain: 0, release: 0.1, volume: 0.07, reverb: 0.3 }),
      synth("left hand", left, { wave: "fm", fmRatio: 1, fmIndex: 0.8, attack: 0.004, decay: 2.6, sustain: 0.3, release: 0.45, volume: 0.48, reverb: 0.3, fx: shimmer }),
    ];
    room = { size: 0.6, damping: 0.65, mix: 1 };
  } else if (voice === "celesta") {
    // a celesta or music box: a sine with a soft bell (FM, the modulator an octave and a fifth up, its bend gone within half a second)
    // that falls away; the tune an octave up where it is not high already, the left hand an octave up too and quieter
    const up = (n, by) => ({ ...n, pitch: n.pitch + by });
    const high = new Set(["A''", "B'"]);
    tracks = [
      synth("right hand", right.map((n) => up(n, high.has(sectionAt(n.step)) ? 0 : 12)), { wave: "fm", fmRatio: 3, fmIndex: 0.45, attack: 0.003, decay: 1.8, sustain: 0, release: 0.5, volume: 0.55, reverb: 0.42 }),
      synth("left hand", left.map((n) => up(n, 12)), { wave: "fm", fmRatio: 3, fmIndex: 0.25, attack: 0.004, decay: 2.4, sustain: 0, release: 0.6, volume: 0.4, reverb: 0.42 }),
    ];
    room = { size: 0.72, damping: 0.7, mix: 1 };
  } else throw new Error(`no voice ${voice}`);
  return { version: 1, bpm: BPM, stepsPerBeat: SPB, length: LENGTH, tracks, room, master, markers, tempos: tempoTrack, loop: { from: LOOP, to: LENGTH } };
}

if (process.argv.includes("--audition")) {
  await audition();
} else {
  const song = songFor(VOICE);
  writeFileSync(join(GAME, "build", "fernhollow-score.json"), JSON.stringify({ bars: bar, loopFromBar: 2, sections: markers, voice: VOICE }, null, 1));
  console.log(`${bar} bars, ${right.length + left.length} notes, loop from step ${LOOP} to ${LENGTH}, ${VOICE}`);
  console.log(tool("song_write", { name: "fernhollow", song }));
  console.log(tool("sound_report", { sounds: [{ name: "music/fernhollow", volume: 0.3 }, { name: "horn", volume: 0.7 }, { name: "step_grass1", volume: 0.4 }, { name: "voice_hazel1", volume: 0.45 }, { name: "creek_loop", volume: 0.75 }, { name: "forest_air", volume: 0.42 }] }));
}

// The three clips: each voice's whole song rendered as song_write renders it (its room, master and loudness), then three pieces
// joined with short crossfades: the tune (A, bars 1 to 3), the quiet B (bars 1 and 2) and the fullest C (bars 1 and 2).
async function audition() {
  const out = join(GAME, "build", "audition");
  mkdirSync(out, { recursive: true });
  // the studio's own renderer, bundled for Node by the rolldown the studio has (this checkout's, or the main checkout's)
  const common = execFileSync("git", ["-C", REPO, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim();
  const bundler = [join(REPO, "studio/node_modules/.bin/rolldown"), join(dirname(common), "studio/node_modules/.bin/rolldown")].find(existsSync);
  if (!bundler) throw new Error("no studio/node_modules: run `cd studio && ../scripts/env.sh npm ci` (a download: ask first)");
  const entry = join(out, "render-entry.ts");
  writeFileSync(entry, `export { renderSong, stepTime } from ${JSON.stringify(join(REPO, "studio/src/lib/song.ts"))};\nexport { encodeWav } from ${JSON.stringify(join(REPO, "studio/src/lib/wav.ts"))};\n`);
  execFileSync(bundler, [entry, "--file", join(out, "render.mjs"), "--format", "esm", "--platform", "node"], { stdio: "ignore" });
  const { renderSong, stepTime, encodeWav } = await import(`${pathToFileURL(join(out, "render.mjs")).href}?${Date.now()}`);
  const names = { felt: "a-felt-piano", epiano: "b-electric-piano", celesta: "c-celesta" };
  for (const voice of ["felt", "epiano", "celesta"]) {
    const song = songFor(voice);
    const full = renderSong(song);
    const rate = full.rate;
    const at = (name, bars) => Math.round(stepTime(song, markers.find((m) => m.name === name).step + bars * BAR) * rate);
    const pieces = [["A", 3], ["B", 2], ["C", 2]].map(([name, bars]) => [at(name, 0), at(name, bars)]);
    const xf = Math.round(0.6 * rate); // each piece runs this much into the next, which fades in under it
    const total = pieces.reduce((s, [a, b]) => s + (b - a), 0);
    const ch = [new Float32Array(total), new Float32Array(total)];
    let w = 0;
    for (const [a, b] of pieces) {
      const len = b - a + (w + b - a < total ? xf : 0); // (the last piece fades out at its own end)
      for (let i = 0; i < len && w + i < total; i++) {
        const fin = w > 0 && i < xf ? Math.sin((Math.PI / 2) * (i / xf)) : 1;
        const fout = i >= len - xf ? Math.cos((Math.PI / 2) * ((i - (len - xf)) / xf)) : 1;
        for (let c = 0; c < 2; c++) ch[c][w + i] += (full.channels[c][a + i] ?? 0) * fin * fout;
      }
      w += b - a;
    }
    writeFileSync(join(out, `${names[voice]}-song.json`), JSON.stringify(song));
    const wav = join(out, `${names[voice]}.wav`), m4a = join(out, `${names[voice]}.m4a`);
    writeFileSync(wav, encodeWav({ rate, channels: ch }));
    execFileSync("afconvert", ["-f", "m4af", "-d", "aac", "-b", "160000", wav, m4a]);
    console.log(`${voice}: ${(total / rate).toFixed(1)} s -> ${wav} and ${m4a}`);
  }
}
