// Sunny Hop's own music, written through the MCP server's `song_write` (the studio's music editor's format): a bright title tune, a strolling map
// theme, a bouncy one for Green Hills, a steel-drum shuffle for Sunny Dunes, a waltz of bells for Frosty Peaks, a march for the Purple Keep and a
// boss fight. Each is a song in sections (intro, two tunes, a bridge on other chords, a breakdown, the tune again a step higher, an outro), and a
// tune that comes back is varied (turns round long notes, then a harmony), so that nothing simply loops.
//   scripts/env.sh node scripts/sunny/music.mjs [name]     (cargo build --release -p nova-studio --bin nova-ogg first, so that they are .ogg)
import { connect } from "../rally/mcp.mjs";
import { join } from "node:path";
const PROJECT = join(new URL("../..", import.meta.url).pathname, "examples/sunny-hop");

const track = (name, kind, wave, notes, o = {}) => ({ name, kind, wave, duty: 0.5, attack: 0.01, decay: 0.1, sustain: 0.6, release: 0.12, volume: 0.5, pan: 0, mute: false, notes, ...o });
const N = (step, pitch, len, vel = 0.7) => ({ step, len, pitch, vel });
const DRUM = { kick: 36, snare: 38, clap: 39, hat: 42, open: 46, tom: 45, crash: 49 };

// instruments
const MARIMBA = { wave: "triangle", unison: 2, detune: 3, attack: 0.002, decay: 0.22, sustain: 0.0, release: 0.2, reverb: 0.35, cutoff: 4200, volume: 0.32 };
const PULSE = { wave: "square", duty: 0.3, unison: 2, detune: 6, attack: 0.008, decay: 0.12, sustain: 0.55, release: 0.12, vibrato: 0.08, cutoff: 3600, reverb: 0.3, volume: 0.22 };
const FLUTE = { wave: "triangle", attack: 0.05, decay: 0.1, sustain: 0.75, release: 0.2, vibrato: 0.12, reverb: 0.4, volume: 0.32 };
const BELL = { wave: "sine", unison: 2, detune: 4, attack: 0.001, decay: 0.6, sustain: 0.02, release: 0.9, reverb: 0.6, volume: 0.3 };
const STEEL = { wave: "sine", unison: 3, detune: 8, attack: 0.002, decay: 0.3, sustain: 0.05, release: 0.3, sub: 0.2, reverb: 0.4, volume: 0.34 };
const BASS = { wave: "triangle", attack: 0.004, decay: 0.18, sustain: 0.35, release: 0.08, sub: 0.45, volume: 0.5 };
const SYNBASS = { wave: "saw", unison: 2, detune: 5, cutoff: 700, resonance: 0.2, sweep: 0.5, sub: 0.5, attack: 0.004, decay: 0.15, sustain: 0.4, release: 0.08, volume: 0.42 };
const PAD = { wave: "saw", unison: 5, detune: 12, cutoff: 1300, sweep: 0.1, attack: 0.4, release: 0.9, reverb: 0.7, volume: 0.15 };
const ORGAN = { wave: "square", duty: 0.5, unison: 3, detune: 7, attack: 0.01, decay: 0.05, sustain: 0.8, release: 0.1, vibrato: 0.15, cutoff: 2600, reverb: 0.45, volume: 0.2 };
const DRUMS = { kit: "studio", reverb: 0.12, volume: 0.42 };

// ---- the arranger (as Potion Panic's): bars belong to sections; a section may bring its own chords; a tune that comes back is varied;
// `energy` 0, 1 or 2 thins or fills the drums and the accompaniment; sections end on a fill and open with a crash; `lift` transposes.
const nearest = (p, tones) => {
  let best = p, d = 99;
  for (const t of tones) for (let o = -36; o <= 36; o += 12) { const q = t + o; if (Math.abs(q - p) < d) { d = Math.abs(q - p); best = q; } }
  return best;
};
function build({ bars, bar, chords, pad = true, bass, pluck, arp, lead, drums }) {
  const tracks = { pad: [], bass: [], pluck: [], arp: [], lead: [], harmony: [], drums: [] };
  const seen = {};
  for (let b = 0; b < bars.length; b++) {
    const sec = bars[b];
    if (sec.i === 0 && sec.lead) seen[sec.lead] = (seen[sec.lead] || 0) + 1;
    const prog = sec.chords || chords;
    const [root0, tones0] = prog[sec.i % prog.length];
    const lift = sec.lift || 0;
    const root = root0 + lift, tones = tones0.map((p) => p + lift);
    const at = b * bar;
    const energy = sec.energy ?? 1;
    if (pad && sec.pad !== false) for (const p of tones) tracks.pad.push(N(at, p - 12, bar - 1, energy === 0 ? 0.42 : 0.33));
    if (sec.bass !== false && bass) tracks.bass.push(...bass(at, root, tones, sec.i, sec));
    if (sec.pluck !== false && pluck) {
      const notes = pluck(at, root, tones, sec.i, sec);
      tracks.pluck.push(...(energy === 0 ? notes.filter((n, k) => k % 2 === 0) : notes));
    }
    if (sec.arp !== false && arp) tracks.arp.push(...arp(at, root, tones, sec.i, sec));
    if (sec.lead && lead) {
      let notes = lead(sec.lead, at, sec.i, sec).map((n) => ({ ...n, pitch: n.pitch + lift }));
      if (sec.fit) notes = notes.map((n) => ({ ...n, pitch: nearest(n.pitch, tones) }));
      const time = seen[sec.lead];
      if (time === 2) {
        notes = notes.flatMap((n) => {
          if (n.len < 4) return [n];
          const above = nearest(n.pitch + 3, tones) > n.pitch ? nearest(n.pitch + 3, tones) : n.pitch + 2;
          return [{ ...n, len: n.len - 2 }, { ...n, step: n.step + n.len - 2, len: 1, pitch: above, vel: n.vel * 0.8 }, { ...n, step: n.step + n.len - 1, len: 1, vel: n.vel * 0.85 }];
        });
      }
      if (time >= 3) {
        for (const n of notes) {
          let h = nearest(n.pitch - 4, tones);
          if (h >= n.pitch) h -= 12;
          tracks.harmony.push({ ...n, pitch: h, vel: n.vel * 0.7 });
        }
      }
      tracks.lead.push(...notes);
    }
    if (sec.drums !== false && drums) {
      let hits = drums(at, sec.i, sec);
      if (energy === 0) hits = hits.filter((n) => n.pitch === DRUM.kick && (n.step - at) % (bar / 2) === 0);
      if (energy === 2) for (let st = 1; st < bar; st += 2) hits.push(N(at + st, DRUM.hat, 1, 0.12));
      if (sec.i === 0 && b > 0 && sec.name !== "outro" && energy > 0) hits.push(N(at, DRUM.crash, 1, 0.3));
      if (sec.i === sec.n - 1 && b < bars.length - 1 && energy > 0) {
        const from = at + bar - 4;
        hits = hits.filter((n) => n.step < from);
        hits.push(N(from, DRUM.snare, 1, 0.35), N(from + 1, DRUM.tom, 1, 0.4), N(from + 2, DRUM.tom, 1, 0.45), N(from + 3, DRUM.snare, 1, 0.5));
      }
      tracks.drums.push(...hits);
    }
  }
  return tracks;
}
const section = (name, n, o = {}) => Array.from({ length: n }, (_, i) => ({ name, i, n, ...o }));
const tune = (bars) => (name, at, b) => (bars[name][b % bars[name].length] ?? []).map(([s, p, l, v]) => N(at + s, p, l, v ?? 0.66));
const four = (h = 0.22) => (at) => [N(at, DRUM.kick, 1, 0.55), N(at + 8, DRUM.kick, 1, 0.5), N(at + 4, DRUM.clap, 1, 0.35), N(at + 12, DRUM.clap, 1, 0.35), ...[2, 6, 10, 14].map((s) => N(at + s, DRUM.hat, 1, h))];

// ---- Title: C major, bright and bouncy -------------------------------------------------------------------------------------------------
const title = (() => {
  const chords = [[48, [60, 64, 67]], [53, [60, 65, 69]], [45, [57, 60, 64]], [55, [59, 62, 67]]]; // C F Am G
  const T = {
    A: [[[0, 76, 2], [2, 79, 2], [4, 84, 4], [8, 83, 2], [10, 81, 2], [12, 79, 4]], [[0, 77, 2], [2, 81, 2], [4, 84, 4], [8, 86, 4], [12, 84, 4]],
      [[0, 84, 2], [2, 83, 2], [4, 81, 4], [8, 76, 2], [10, 79, 2], [12, 81, 4]], [[0, 79, 6], [6, 77, 2], [8, 74, 4], [12, 79, 4]]],
    B: [[[0, 81, 4], [4, 79, 2], [6, 77, 2], [8, 76, 8]], [[0, 77, 4], [4, 76, 2], [6, 74, 2], [8, 72, 8]], [[0, 74, 2], [2, 76, 2], [4, 77, 4], [8, 81, 4], [12, 84, 4]], [[0, 83, 8], [8, 86, 4], [12, 83, 4]]],
  };
  const bars = [...section("intro", 2, { lead: null, energy: 0 }), ...section("A", 4, { lead: "A" }), ...section("B", 4, { lead: "B" }), ...section("A", 4, { lead: "A", energy: 2 }),
    ...section("bridge", 4, { lead: "B", fit: true, energy: 0, chords: [[50, [62, 65, 69]], [55, [59, 62, 67]], [52, [59, 64, 67]], [57, [61, 64, 69]]] }),
    ...section("A", 4, { lead: "A", lift: 2, energy: 2 }), ...section("B", 4, { lead: "B", lift: 2 }), ...section("outro", 2, { lead: null, energy: 0 })];
  const t = build({ bars, bar: 16, chords,
    bass: (at, root) => [N(at, root, 3, 0.85), N(at + 6, root + 7, 2, 0.6), N(at + 8, root, 3, 0.8), N(at + 12, root + 12, 2, 0.6), N(at + 14, root + 7, 2, 0.6)],
    pluck: (at, root, tones) => [2, 6, 10, 14].flatMap((s) => tones.map((p) => N(at + s, p, 2, 0.42))),
    arp: (at, root, tones) => [0, 3, 6, 8, 11, 14].map((s, i) => N(at + s, tones[i % 3] + 24, 2, 0.3)),
    lead: tune(T), drums: four() });
  return { name: "title", bpm: 136, stepsPerBeat: 4, length: bars.length * 16, tracks: [
    track("pad", "synth", "saw", t.pad, PAD), track("bass", "synth", "triangle", t.bass, BASS), track("pluck", "synth", "triangle", t.pluck, { ...MARIMBA, pan: -0.2 }),
    track("arp", "synth", "sine", t.arp, { ...BELL, volume: 0.16, pan: 0.25 }), track("lead", "synth", "square", t.lead, { ...PULSE, pan: 0.1 }),
    track("harmony", "synth", "triangle", t.harmony, { ...FLUTE, volume: 0.18, pan: -0.25 }), track("drums", "drums", "noise", t.drums, DRUMS),
  ] };
})();

// ---- Map: F major, a stroll ---------------------------------------------------------------------------------------------------------------
const map = (() => {
  const chords = [[53, [57, 60, 65]], [50, [57, 62, 65]], [46, [58, 62, 65]], [48, [60, 64, 67]]]; // F Dm Bb C
  const T = {
    A: [[[0, 72, 4], [4, 77, 2], [6, 76, 2], [8, 77, 4], [12, 81, 4]], [[0, 81, 4], [4, 79, 2], [6, 77, 2], [8, 74, 8]], [[0, 74, 2], [2, 77, 2], [4, 82, 4], [8, 81, 4], [12, 79, 4]], [[0, 79, 8], [8, 76, 4], [12, 72, 4]]],
    B: [[[0, 84, 6], [6, 82, 2], [8, 81, 4], [12, 77, 4]], [[0, 77, 6], [6, 79, 2], [8, 81, 8]], [[0, 82, 4], [4, 81, 4], [8, 79, 4], [12, 77, 4]], [[0, 79, 12], [12, 76, 4]]],
  };
  const bars = [...section("intro", 2, { lead: null, energy: 0 }), ...section("A", 4, { lead: "A" }), ...section("A", 4, { lead: "A" }), ...section("B", 4, { lead: "B", energy: 2 }),
    ...section("bridge", 4, { lead: "A", fit: true, energy: 0, chords: [[46, [58, 62, 65]], [45, [57, 60, 64]], [43, [55, 58, 62]], [48, [55, 60, 64]]] }),
    ...section("A", 4, { lead: "A", energy: 2 }), ...section("B", 4, { lead: "B", lift: 1 }), ...section("outro", 2, { lead: null, energy: 0 })];
  const t = build({ bars, bar: 16, chords,
    bass: (at, root, tones) => [0, 4, 8, 12].map((s, i) => N(at + s, i % 2 ? root + 7 : root, 3, 0.75)),
    pluck: (at, root, tones) => [4, 12].flatMap((s) => tones.map((p) => N(at + s, p, 3, 0.36))),
    arp: () => [], lead: tune(T),
    drums: (at) => [N(at, DRUM.kick, 1, 0.45), N(at + 8, DRUM.kick, 1, 0.4), ...[4, 12].map((s) => N(at + s, DRUM.snare, 1, 0.22)), ...[0, 4, 8, 12].map((s) => N(at + s + 2, DRUM.hat, 1, 0.18))] });
  return { name: "map", bpm: 112, stepsPerBeat: 4, length: bars.length * 16, tracks: [
    track("pad", "synth", "saw", t.pad, { ...PAD, volume: 0.12 }), track("bass", "synth", "triangle", t.bass, BASS), track("pluck", "synth", "triangle", t.pluck, MARIMBA),
    track("lead", "synth", "triangle", t.lead, { ...FLUTE, pan: 0.15 }), track("harmony", "synth", "triangle", t.harmony, { ...FLUTE, volume: 0.17, pan: -0.25 }),
    track("drums", "drums", "noise", t.drums, { ...DRUMS, volume: 0.35 }),
  ] };
})();

// ---- Green Hills: G major, a bouncy run ----------------------------------------------------------------------------------------------------
const grass = (() => {
  const chords = [[43, [59, 62, 67]], [48, [60, 64, 67]], [50, [62, 66, 69]], [43, [59, 62, 67]]]; // G C D G
  const T = {
    A: [[[0, 74, 2], [2, 71, 2], [4, 74, 2], [6, 79, 4], [10, 78, 2], [12, 76, 4]], [[0, 76, 2], [2, 72, 2], [4, 76, 2], [6, 79, 2], [8, 84, 6], [14, 83, 2]],
      [[0, 81, 3], [3, 78, 3], [6, 74, 2], [8, 76, 2], [10, 78, 2], [12, 81, 4]], [[0, 79, 6], [6, 74, 2], [8, 79, 8]]],
    B: [[[0, 79, 4], [4, 83, 4], [8, 81, 2], [10, 79, 2], [12, 76, 4]], [[0, 76, 4], [4, 79, 4], [8, 84, 4], [12, 83, 4]], [[0, 81, 2], [2, 83, 2], [4, 84, 2], [6, 86, 6], [12, 84, 2], [14, 83, 2]], [[0, 81, 8], [8, 78, 4], [12, 74, 4]]],
  };
  const Bchords = [[52, [59, 64, 67]], [48, [60, 64, 67]], [50, [62, 66, 69]], [50, [60, 62, 66]]]; // Em C D D7
  const bars = [...section("intro", 4, { lead: null, energy: 0 }), ...section("A", 4, { lead: "A" }), ...section("A", 4, { lead: "A" }), ...section("B", 4, { lead: "B", chords: Bchords, energy: 2 }),
    ...section("bridge", 4, { lead: "A", fit: true, energy: 0, chords: [[45, [60, 64, 69]], [50, [62, 66, 69]], [47, [59, 62, 66]], [52, [59, 64, 67]]] }),
    ...section("bridge", 4, { lead: "B", fit: true, chords: [[48, [60, 64, 67]], [50, [62, 66, 69]], [52, [59, 64, 67]], [50, [62, 66, 69]]] }),
    ...section("A", 4, { lead: "A", energy: 2 }), ...section("B", 4, { lead: "B", chords: Bchords, energy: 2 }),
    ...section("breakdown", 4, { lead: null, pluck: false, energy: 0 }),
    ...section("A", 4, { lead: "A", lift: 2, energy: 2 }), ...section("B", 4, { lead: "B", lift: 2, chords: Bchords, energy: 2 }), ...section("outro", 4, { lead: "A", energy: 0 })];
  const t = build({ bars, bar: 16, chords,
    bass: (at, root) => [N(at, root, 3, 0.85), N(at + 3, root, 1, 0.5), N(at + 6, root + 7, 2, 0.65), N(at + 8, root, 3, 0.8), N(at + 12, root + 7, 2, 0.6), N(at + 14, root + 12, 2, 0.6)],
    pluck: (at, root, tones) => [2, 6, 10, 14].flatMap((s) => tones.map((p) => N(at + s, p + 12, 2, 0.36))),
    arp: (at, root, tones, i, sec) => (sec.name === "breakdown" ? [0, 2, 4, 6, 8, 10, 12, 14].map((s, k) => N(at + s, tones[k % 3] + 12, 2, 0.4)) : []),
    lead: tune(T), drums: four(0.24) });
  return { name: "grass", bpm: 148, stepsPerBeat: 4, length: bars.length * 16, tracks: [
    track("pad", "synth", "saw", t.pad, { ...PAD, volume: 0.1 }), track("bass", "synth", "triangle", t.bass, BASS), track("pluck", "synth", "triangle", t.pluck, { ...MARIMBA, pan: -0.25 }),
    track("arp", "synth", "triangle", t.arp, { ...MARIMBA, pan: 0.25 }), track("lead", "synth", "square", t.lead, { ...PULSE, pan: 0.1 }),
    track("harmony", "synth", "triangle", t.harmony, { ...FLUTE, volume: 0.18, pan: -0.25 }), track("drums", "drums", "noise", t.drums, DRUMS),
  ] };
})();

// ---- Sunny Dunes: D mixolydian, a steel-drum shuffle --------------------------------------------------------------------------------------
const sand = (() => {
  const chords = [[50, [62, 66, 69]], [48, [60, 64, 67]], [43, [59, 62, 67]], [50, [62, 66, 69]]]; // D C G D
  const T = {
    A: [[[0, 74, 3], [3, 78, 3], [6, 81, 2], [8, 78, 2], [10, 81, 2], [12, 84, 4]], [[0, 84, 3], [3, 81, 3], [6, 79, 2], [8, 76, 4], [12, 72, 4]],
      [[0, 71, 3], [3, 74, 3], [6, 79, 2], [8, 83, 3], [11, 81, 3], [14, 79, 2]], [[0, 78, 6], [6, 76, 2], [8, 74, 8]]],
    B: [[[0, 86, 2], [2, 84, 2], [4, 81, 4], [8, 84, 2], [10, 81, 2], [12, 78, 4]], [[0, 79, 2], [2, 76, 2], [4, 72, 4], [8, 76, 4], [12, 79, 4]], [[0, 83, 3], [3, 79, 3], [6, 74, 2], [8, 79, 4], [12, 83, 4]], [[0, 81, 12], [12, 78, 4]]],
  };
  const bars = [...section("intro", 4, { lead: null, energy: 0 }), ...section("A", 4, { lead: "A" }), ...section("B", 4, { lead: "B" }), ...section("A", 4, { lead: "A", energy: 2 }),
    ...section("bridge", 4, { lead: "B", fit: true, energy: 0, chords: [[47, [59, 62, 66]], [43, [59, 62, 67]], [45, [57, 61, 64]], [45, [57, 60, 64]]] }),
    ...section("bridge", 4, { lead: "A", fit: true, chords: [[48, [60, 64, 67]], [43, [59, 62, 67]], [45, [57, 61, 64]], [50, [62, 66, 69]]] }),
    ...section("A", 4, { lead: "A", energy: 2 }), ...section("B", 4, { lead: "B", energy: 2 }), ...section("breakdown", 4, { lead: null, energy: 0 }),
    ...section("A", 4, { lead: "A", lift: 2, energy: 2 }), ...section("B", 4, { lead: "B", lift: 2 }), ...section("outro", 2, { lead: null, energy: 0 })];
  const t = build({ bars, bar: 16, chords,
    bass: (at, root) => [N(at, root, 3, 0.85), N(at + 3, root + 12, 2, 0.5), N(at + 6, root + 7, 2, 0.7), N(at + 10, root, 2, 0.6), N(at + 12, root + 7, 3, 0.7)],
    pluck: (at, root, tones) => [0, 3, 6, 10, 12].flatMap((s) => tones.slice(1).map((p) => N(at + s, p, 2, 0.32))),
    arp: (at, root, tones) => [2, 5, 8, 11, 14].map((s, k) => N(at + s, tones[(k + 1) % 3] + 12, 1, 0.3)),
    lead: tune(T),
    drums: (at) => [N(at, DRUM.kick, 1, 0.55), N(at + 6, DRUM.kick, 1, 0.4), N(at + 8, DRUM.kick, 1, 0.5), N(at + 4, DRUM.clap, 1, 0.3), N(at + 12, DRUM.clap, 1, 0.35), ...[0, 3, 6, 8, 11, 14].map((s) => N(at + s, DRUM.hat, 1, 0.2)), N(at + 10, DRUM.tom, 1, 0.3)] });
  return { name: "sand", bpm: 124, stepsPerBeat: 4, length: bars.length * 16, tracks: [
    track("pad", "synth", "saw", t.pad, { ...PAD, volume: 0.1, cutoff: 1600 }), track("bass", "synth", "triangle", t.bass, BASS), track("pluck", "synth", "sine", t.pluck, { ...STEEL, volume: 0.2, pan: -0.25 }),
    track("arp", "synth", "triangle", t.arp, { ...MARIMBA, volume: 0.22, pan: 0.3 }), track("lead", "synth", "sine", t.lead, { ...STEEL, pan: 0.1 }),
    track("harmony", "synth", "sine", t.harmony, { ...STEEL, volume: 0.18, pan: -0.25 }), track("drums", "drums", "noise", t.drums, DRUMS),
  ] };
})();

// ---- Frosty Peaks: E minor to G, a waltz of bells (three to the bar) ---------------------------------------------------------------------
const snow = (() => {
  const chords = [[40, [55, 59, 64]], [48, [55, 60, 64]], [43, [55, 59, 62]], [47, [54, 59, 63]]]; // Em C G B
  const T = {
    A: [[[0, 76, 4], [4, 79, 4], [8, 83, 4]], [[0, 84, 6], [6, 83, 3], [9, 79, 3]], [[0, 79, 4], [4, 83, 4], [8, 86, 4]], [[0, 87, 8], [8, 83, 4]]],
    B: [[[0, 88, 6], [6, 86, 3], [9, 84, 3]], [[0, 84, 6], [6, 83, 3], [9, 79, 3]], [[0, 81, 4], [4, 79, 4], [8, 78, 4]], [[0, 76, 12]]],
  };
  const bars = [...section("intro", 4, { lead: null, energy: 0 }), ...section("A", 4, { lead: "A" }), ...section("A", 4, { lead: "A" }), ...section("B", 4, { lead: "B" }),
    ...section("bridge", 4, { lead: "A", fit: true, energy: 0, chords: [[43, [55, 59, 62]], [50, [54, 57, 62]], [48, [55, 60, 64]], [47, [54, 59, 63]]] }),
    ...section("B", 4, { lead: "B", energy: 2 }), ...section("A", 4, { lead: "A", energy: 2 }), ...section("breakdown", 4, { lead: null, energy: 0, bass: false }),
    ...section("A", 4, { lead: "A", lift: 3 }), ...section("B", 4, { lead: "B", lift: 3, energy: 2 }), ...section("outro", 4, { lead: null, energy: 0 })];
  const t = build({ bars, bar: 12, chords,
    bass: (at, root) => [N(at, root, 4, 0.75)],
    pluck: (at, root, tones) => [4, 8].flatMap((s) => tones.map((p) => N(at + s, p + 12, 3, 0.3))),
    arp: (at, root, tones) => [0, 2, 4, 6, 8, 10].map((s, k) => N(at + s, tones[[0, 1, 2, 1, 2, 1][k]] + 24, 2, 0.22)),
    lead: tune(T),
    drums: (at) => [N(at, DRUM.kick, 1, 0.4), N(at + 4, DRUM.hat, 1, 0.16), N(at + 8, DRUM.hat, 1, 0.16)] });
  return { name: "snow", bpm: 132, stepsPerBeat: 4, length: bars.length * 12, tracks: [
    track("pad", "synth", "saw", t.pad, { ...PAD, volume: 0.16, reverb: 0.85 }), track("bass", "synth", "sine", t.bass, { wave: "sine", attack: 0.02, decay: 0.4, sustain: 0.4, release: 0.3, sub: 0.3, volume: 0.42 }),
    track("pluck", "synth", "triangle", t.pluck, { ...MARIMBA, volume: 0.22 }), track("arp", "synth", "sine", t.arp, { ...BELL, volume: 0.16, pan: 0.3 }),
    track("lead", "synth", "sine", t.lead, { ...BELL, volume: 0.34, pan: -0.1 }), track("harmony", "synth", "triangle", t.harmony, { ...FLUTE, volume: 0.16, pan: 0.25 }),
    track("drums", "drums", "noise", t.drums, { ...DRUMS, volume: 0.3 }),
  ] };
})();

// ---- Purple Keep: A minor, a march with an organ -------------------------------------------------------------------------------------------
const castle = (() => {
  const chords = [[45, [57, 60, 64]], [41, [57, 60, 65]], [43, [55, 59, 62]], [40, [56, 59, 64]]]; // Am F G E
  const T = {
    A: [[[0, 69, 3], [3, 72, 3], [6, 76, 2], [8, 81, 6], [14, 80, 2]], [[0, 81, 4], [4, 77, 4], [8, 76, 4], [12, 72, 4]], [[0, 74, 3], [3, 79, 3], [6, 83, 2], [8, 86, 4], [12, 83, 4]], [[0, 80, 8], [8, 76, 4], [12, 71, 4]]],
    B: [[[0, 84, 2], [2, 83, 2], [4, 81, 4], [8, 76, 4], [12, 81, 4]], [[0, 77, 2], [2, 76, 2], [4, 74, 4], [8, 72, 4], [12, 77, 4]], [[0, 79, 2], [2, 81, 2], [4, 83, 4], [8, 86, 4], [12, 83, 4]], [[0, 80, 12], [12, 83, 4]]],
  };
  const bars = [...section("intro", 4, { lead: null, energy: 0 }), ...section("A", 4, { lead: "A" }), ...section("A", 4, { lead: "A", energy: 2 }), ...section("B", 4, { lead: "B" }),
    ...section("bridge", 4, { lead: "A", fit: true, energy: 0, chords: [[38, [57, 62, 65]], [45, [57, 60, 64]], [38, [57, 62, 65]], [40, [56, 59, 64]]] }),
    ...section("A", 4, { lead: "A", energy: 2 }), ...section("B", 4, { lead: "B", energy: 2 }), ...section("breakdown", 4, { lead: null, energy: 0, pluck: false }),
    ...section("A", 4, { lead: "A", lift: 1, energy: 2 }), ...section("B", 4, { lead: "B", lift: 1 }), ...section("outro", 4, { lead: null, energy: 0 })];
  const t = build({ bars, bar: 16, chords,
    bass: (at, root) => [0, 2, 4, 6, 8, 10, 12, 14].map((s, k) => N(at + s, k % 4 === 3 ? root + 7 : root, 2, k % 2 ? 0.55 : 0.8)),
    pluck: (at, root, tones) => [0, 8].flatMap((s) => tones.map((p) => N(at + s, p, 6, 0.3))),
    arp: (at, root, tones) => [2, 6, 10, 14].map((s, k) => N(at + s, tones[k % 3] + 12, 2, 0.26)),
    lead: tune(T),
    drums: (at) => [N(at, DRUM.kick, 1, 0.6), N(at + 8, DRUM.kick, 1, 0.55), N(at + 4, DRUM.snare, 1, 0.4), N(at + 12, DRUM.snare, 1, 0.42), N(at + 14, DRUM.snare, 1, 0.2), ...[2, 6, 10].map((s) => N(at + s, DRUM.hat, 1, 0.2))] });
  return { name: "castle", bpm: 128, stepsPerBeat: 4, length: bars.length * 16, tracks: [
    track("pad", "synth", "saw", t.pad, { ...PAD, volume: 0.14, cutoff: 900 }), track("bass", "synth", "saw", t.bass, SYNBASS), track("pluck", "synth", "square", t.pluck, { ...ORGAN, volume: 0.13 }),
    track("arp", "synth", "triangle", t.arp, { ...MARIMBA, volume: 0.2, pan: 0.3 }), track("lead", "synth", "square", t.lead, { ...ORGAN, pan: -0.1 }),
    track("harmony", "synth", "square", t.harmony, { ...ORGAN, volume: 0.12, pan: 0.25 }), track("drums", "drums", "noise", t.drums, { ...DRUMS, volume: 0.5 }),
  ] };
})();

// ---- Boss: D minor, quick and urgent -------------------------------------------------------------------------------------------------------
const boss = (() => {
  const chords = [[38, [62, 65, 69]], [46, [62, 65, 70]], [36, [60, 64, 67]], [45, [61, 64, 69]]]; // Dm Bb C A
  const T = {
    A: [[[0, 74, 2], [2, 77, 2], [4, 81, 2], [6, 77, 2], [8, 86, 4], [12, 84, 4]], [[0, 82, 2], [2, 81, 2], [4, 77, 4], [8, 74, 4], [12, 77, 4]], [[0, 79, 2], [2, 76, 2], [4, 72, 4], [8, 79, 4], [12, 84, 4]], [[0, 81, 8], [8, 85, 4], [12, 88, 4]]],
    B: [[[0, 86, 6], [6, 84, 2], [8, 82, 4], [12, 81, 4]], [[0, 82, 6], [6, 81, 2], [8, 77, 8]], [[0, 76, 4], [4, 79, 4], [8, 84, 4], [12, 88, 4]], [[0, 85, 16]]],
  };
  const bars = [...section("intro", 2, { lead: null, energy: 0 }), ...section("A", 4, { lead: "A", energy: 2 }), ...section("B", 4, { lead: "B" }), ...section("A", 4, { lead: "A", energy: 2 }),
    ...section("bridge", 4, { lead: "B", fit: true, energy: 0, chords: [[43, [62, 67, 70]], [41, [60, 65, 69]], [46, [62, 65, 70]], [45, [61, 64, 69]]] }),
    ...section("A", 4, { lead: "A", lift: 2, energy: 2 }), ...section("B", 4, { lead: "B", lift: 2, energy: 2 })];
  const t = build({ bars, bar: 16, chords,
    bass: (at, root) => [0, 2, 3, 6, 8, 10, 11, 14].map((s, k) => N(at + s, k === 3 || k === 7 ? root + 12 : root, 2, 0.8)),
    pluck: () => [], arp: (at, root, tones) => [0, 2, 4, 6, 8, 10, 12, 14].map((s, k) => N(at + s, tones[k % 3] + 12, 1, 0.3)),
    lead: tune(T),
    drums: (at) => [N(at, DRUM.kick, 1, 0.7), N(at + 6, DRUM.kick, 1, 0.5), N(at + 8, DRUM.kick, 1, 0.65), N(at + 4, DRUM.snare, 1, 0.5), N(at + 12, DRUM.snare, 1, 0.5), ...[2, 6, 10, 14].map((s) => N(at + s, DRUM.hat, 1, 0.22))] });
  return { name: "boss", bpm: 164, stepsPerBeat: 4, length: bars.length * 16, tracks: [
    track("pad", "synth", "saw", t.pad, { ...PAD, volume: 0.13, cutoff: 1000 }), track("bass", "synth", "saw", t.bass, SYNBASS), track("arp", "synth", "square", t.arp, { ...PULSE, volume: 0.12, pan: 0.3 }),
    track("lead", "synth", "saw", t.lead, { wave: "saw", unison: 3, detune: 9, cutoff: 2800, sweep: 0.4, attack: 0.01, release: 0.2, vibrato: 0.1, reverb: 0.35, volume: 0.22 }),
    track("harmony", "synth", "square", t.harmony, { ...PULSE, volume: 0.13, pan: -0.25 }), track("drums", "drums", "noise", t.drums, { ...DRUMS, volume: 0.55 }),
  ] };
})();

const only = process.argv[2];
const nova = await connect(PROJECT);
try {
  for (const song of [title, map, grass, sand, snow, castle, boss]) {
    if (only && song.name !== only) continue;
    const { name, ...rest } = song;
    console.log(await nova.call("song_write", { name, song: { version: 1, room: { size: 0.6, damping: 0.45 }, ...rest } }));
  }
} finally {
  nova.close();
}
