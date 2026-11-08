// Moving Day's own music, written through the MCP server's `song_write`: a cosy electric-piano tune for the menus, a bright plucked folk song for the
// morning streets, a mellow marimba bossa for the afternoon and a slow piano-and-bells song for the evening. Each has sections and comes back varied
// (the arranger is Potion Panic's: scripts/potion/music.mjs), so a long puzzle never hears the same eight bars twice in a row.
//   scripts/env.sh node scripts/moving-day/music.mjs     (cargo build --release -p nova-studio --bin nova-ogg first, so that they are .ogg)
import { connect } from "../rally/mcp.mjs";
import { join } from "node:path";
const PROJECT = join(new URL("../..", import.meta.url).pathname, "examples/moving-day");

const track = (name, kind, wave, notes, o = {}) => ({ name, kind, wave, duty: 0.5, attack: 0.01, decay: 0.1, sustain: 0.6, release: 0.12, volume: 0.5, pan: 0, mute: false, notes, ...o });
const N = (step, pitch, len, vel = 0.7) => ({ step, len, pitch, vel });
const DRUM = { kick: 36, snare: 38, clap: 39, hat: 42, open: 46, tom: 45, crash: 49 };


// The arranger. A song is a list of bars, each belonging to a section ({ name, i (its bar within the section), n (the section's length), lead,
// chords, lift, energy, ... }). So that a song keeps moving instead of looping:
//  - a section may bring its own chord progression (`chords`), and starts it on its first bar;
//  - a tune that comes back is varied: the second time with turns round its long notes, from the third time with a harmony a chord tone below;
//    over chords that are not its own (`fit`) its notes are moved to the nearest chord tone;
//  - `energy` 0, 1 or 2 thins or fills the drums and the plucked chords; every section ends on a drum fill and the next opens with a crash;
//  - `lift` moves a section up (a key change for the last chorus).
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
    const up = (list) => list.map((n) => ({ ...n, pitch: n.pitch + lift }));
    if (pad && sec.pad !== false) for (const p of tones) tracks.pad.push(N(at, p - 12, bar - 1, energy === 0 ? 0.42 : 0.35));
    if (sec.bass !== false && bass) tracks.bass.push(...bass(at, root, tones, sec.i, sec));
    if (sec.pluck !== false && pluck) {
      const notes = pluck(at, root, tones, sec.i, sec);
      tracks.pluck.push(...(energy === 0 ? notes.filter((n, k) => k % 2 === 0) : notes));
    }
    if (sec.arp !== false && arp) tracks.arp.push(...arp(at, root, tones, sec.i, sec));
    if (sec.lead && lead) {
      let notes = up(lead(sec.lead, at, sec.i, sec));
      if (sec.fit) notes = notes.map((n) => ({ ...n, pitch: nearest(n.pitch, tones) }));
      const time = seen[sec.lead];
      if (time === 2) {
        // a turn round each long note: the note, the chord tone above, back
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
      if (sec.i === 0 && b > 0 && sec.name !== "outro" && energy > 0) hits.push(N(at, DRUM.crash, 1, 0.32));
      if (sec.i === sec.n - 1 && b < bars.length - 1 && energy > 0) {
        // a fill over the last beat: toms coming down, a snare
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

// instruments (the studio's synth parameters)
const EPIANO = { wave: "sine", unison: 2, detune: 5, attack: 0.003, decay: 0.7, sustain: 0.18, release: 0.5, reverb: 0.4, sub: 0.12, volume: 0.32 };
const MARIMBA = { wave: "triangle", attack: 0.002, decay: 0.28, sustain: 0.0, release: 0.2, reverb: 0.35, cutoff: 3600, volume: 0.34 };
const UKE = { wave: "triangle", unison: 2, detune: 4, attack: 0.002, decay: 0.24, sustain: 0.05, release: 0.15, reverb: 0.3, cutoff: 4200, volume: 0.24 };
const WHISTLE = { wave: "sine", attack: 0.05, decay: 0.1, sustain: 0.75, release: 0.2, vibrato: 0.14, reverb: 0.45, volume: 0.3 };
const BELLS = { wave: "sine", unison: 2, detune: 3, attack: 0.001, decay: 0.6, sustain: 0.02, release: 0.9, reverb: 0.65, volume: 0.26 };
const BASS = { wave: "triangle", attack: 0.004, decay: 0.3, sustain: 0.3, release: 0.12, sub: 0.45, volume: 0.48 };
const PAD = { wave: "saw", unison: 5, detune: 12, cutoff: 1200, sweep: 0.1, attack: 0.6, release: 1.0, reverb: 0.7, volume: 0.15 };
const BRUSH = { kit: "studio", reverb: 0.15, volume: 0.32 };
const tune = (bars) => (name, at, b) => (bars[name][b % bars[name].length] ?? []).map(([s, p, l, v]) => N(at + s, p, l, v ?? 0.62));

// ---- the menus: "Boxes in the Hall", C major, a lazy electric piano over brushes -----------------------------------------------------------
const menu = (() => {
  const chords = [[53, [64, 65, 69, 72]], [52, [62, 64, 67, 71]], [50, [60, 62, 65, 69]], [55, [59, 62, 65, 67]]]; // Fmaj7 Em7 Dm7 G7
  const T = {
    A: [[[0, 76, 3], [4, 77, 2], [6, 79, 6], [12, 81, 4]], [[0, 79, 6], [8, 76, 4], [12, 74, 4]], [[0, 77, 3], [4, 76, 2], [6, 74, 6], [12, 72, 4]], [[0, 74, 10], [12, 71, 4]]],
    B: [[[0, 84, 6], [6, 83, 2], [8, 81, 8]], [[0, 79, 4], [4, 81, 4], [8, 79, 4], [12, 76, 4]], [[0, 77, 6], [6, 79, 2], [8, 81, 4], [12, 84, 4]], [[0, 83, 12]]],
  };
  const bars = [
    ...section("intro", 4, { lead: null, energy: 0 }), ...section("A", 4, { lead: "A" }), ...section("A", 4, { lead: "A" }), ...section("B", 4, { lead: "B" }),
    ...section("bridge", 4, { lead: "A", fit: true, energy: 0, chords: [[57, [64, 67, 69, 72]], [50, [62, 65, 69, 72]], [55, [62, 65, 67, 71]], [48, [64, 67, 71, 72]]] }),
    ...section("A", 4, { lead: "A", energy: 2 }), ...section("B", 4, { lead: "B", energy: 2 }), ...section("outro", 4, { lead: "A", energy: 0 }),
  ];
  const t = build({
    bars, bar: 16, chords,
    bass: (at, root) => [N(at, root - 12, 6, 0.8), N(at + 6, root - 5, 2, 0.6), N(at + 8, root - 12, 4, 0.7), N(at + 12, root - 10, 4, 0.55)],
    pluck: (at, root, tones) => [2, 10].flatMap((s) => tones.map((p) => N(at + s, p, 5, 0.32))),
    arp: () => [],
    lead: tune(T),
    drums: (at) => [N(at, DRUM.kick, 1, 0.4), N(at + 10, DRUM.kick, 1, 0.3), N(at + 4, DRUM.snare, 1, 0.16), N(at + 12, DRUM.snare, 1, 0.16), ...[0, 3, 6, 8, 11, 14].map((s) => N(at + s, DRUM.hat, 1, 0.1))],
  });
  return { name: "menu", bpm: 88, stepsPerBeat: 4, length: bars.length * 16, tracks: [
    track("pad", "synth", "saw", t.pad, PAD),
    track("bass", "synth", "triangle", t.bass, BASS),
    track("keys", "synth", "sine", t.pluck, { ...EPIANO, volume: 0.2, pan: -0.15 }),
    track("lead", "synth", "sine", t.lead, { ...EPIANO, volume: 0.34, pan: 0.12 }),
    track("harmony", "synth", "sine", t.harmony, { ...EPIANO, volume: 0.18, pan: -0.25 }),
    track("drums", "drums", "noise", t.drums, BRUSH),
  ] };
})();

// ---- the morning streets: "Fresh Start", G major, plucked strings and a whistle, bouncy -----------------------------------------------------
const morning = (() => {
  const chords = [[43, [59, 62, 67]], [50, [57, 62, 66]], [52, [59, 64, 67]], [48, [60, 64, 67]]]; // G D Em C
  const T = {
    A: [[[0, 74, 2], [2, 79, 2], [4, 81, 2], [6, 83, 6], [12, 81, 4]], [[0, 78, 4], [4, 81, 4], [8, 78, 4], [12, 74, 4]], [[0, 76, 2], [2, 79, 2], [4, 83, 4], [8, 81, 2], [10, 79, 6]], [[0, 76, 4], [4, 79, 4], [8, 72, 8]]],
    B: [[[0, 86, 4], [4, 83, 2], [6, 81, 2], [8, 79, 8]], [[0, 81, 4], [4, 78, 2], [6, 76, 2], [8, 74, 8]], [[0, 79, 2], [2, 81, 2], [4, 83, 4], [8, 86, 4], [12, 88, 4]], [[0, 86, 6], [6, 83, 2], [8, 84, 8]]],
  };
  const bars = [
    ...section("intro", 2, { lead: null, energy: 0 }), ...section("A", 4, { lead: "A" }), ...section("A", 4, { lead: "A" }), ...section("B", 4, { lead: "B", energy: 2 }),
    ...section("bridge", 4, { lead: "A", fit: true, energy: 0, chords: [[48, [60, 64, 67]], [50, [57, 62, 66]], [47, [59, 62, 67]], [52, [59, 64, 67]]] }),
    ...section("A", 4, { lead: "A", energy: 2 }), ...section("B", 4, { lead: "B" }),
    ...section("break", 4, { lead: "B", energy: 0, pluck: false, fit: true, chords: [[45, [57, 60, 64]], [50, [57, 62, 66]], [43, [59, 62, 67]], [50, [57, 62, 66]]] }),
    ...section("A", 4, { lead: "A", lift: 2, energy: 2 }), ...section("B", 4, { lead: "B", lift: 2, energy: 2 }), ...section("outro", 4, { lead: "A", energy: 0 }),
  ];
  const t = build({
    bars, bar: 16, chords,
    bass: (at, root) => [N(at, root, 3, 0.8), N(at + 4, root + 7, 3, 0.6), N(at + 8, root, 3, 0.75), N(at + 12, root + 7, 3, 0.6)],
    pluck: (at, root, tones) => [0, 3, 6, 8, 11, 14].flatMap((s, k) => [N(at + s, tones[k % 3] + 12, 2, 0.42)]),
    arp: (at, root, tones) => [4, 12].flatMap((s) => tones.map((p) => N(at + s, p, 2, 0.3))),
    lead: tune(T),
    drums: (at) => [N(at, DRUM.kick, 1, 0.5), N(at + 8, DRUM.kick, 1, 0.45), N(at + 4, DRUM.clap, 1, 0.28), N(at + 12, DRUM.clap, 1, 0.28), ...[2, 6, 10, 14].map((s) => N(at + s, DRUM.hat, 1, 0.18))],
  });
  return { name: "morning", bpm: 112, stepsPerBeat: 4, length: bars.length * 16, tracks: [
    track("pad", "synth", "saw", t.pad, { ...PAD, volume: 0.1 }),
    track("bass", "synth", "triangle", t.bass, BASS),
    track("uke", "synth", "triangle", t.pluck, { ...UKE, pan: -0.2 }),
    track("strum", "synth", "triangle", t.arp, { ...UKE, volume: 0.16, pan: 0.2 }),
    track("lead", "synth", "sine", t.lead, { ...WHISTLE, pan: 0.1 }),
    track("harmony", "synth", "sine", t.harmony, { ...WHISTLE, volume: 0.16, pan: -0.25 }),
    track("drums", "drums", "noise", t.drums, BRUSH),
  ] };
})();

// ---- the afternoon: "Tea Break", F major, a marimba bossa ----------------------------------------------------------------------------------
const afternoon = (() => {
  const chords = [[41, [64, 65, 69, 72]], [43, [62, 65, 67, 70]], [45, [60, 64, 67, 69]], [46, [62, 65, 69, 70]]]; // Fmaj7 Gm7 Am7 Bbmaj7
  const T = {
    A: [[[0, 81, 3], [3, 79, 3], [6, 77, 2], [8, 76, 8]], [[0, 74, 3], [3, 77, 3], [6, 79, 10]], [[0, 76, 3], [3, 77, 3], [6, 79, 2], [8, 81, 6], [14, 79, 2]], [[0, 77, 12]]],
    B: [[[0, 84, 2], [2, 82, 2], [4, 81, 4], [8, 77, 8]], [[0, 79, 2], [2, 77, 2], [4, 76, 4], [8, 74, 8]], [[0, 72, 3], [3, 74, 3], [6, 77, 4], [10, 81, 6]], [[0, 79, 8], [8, 76, 8]]],
  };
  const bars = [
    ...section("intro", 4, { lead: null, energy: 0 }), ...section("A", 4, { lead: "A" }), ...section("B", 4, { lead: "B" }), ...section("A", 4, { lead: "A", energy: 2 }),
    ...section("bridge", 4, { lead: "B", fit: true, chords: [[38, [62, 65, 69, 72]], [43, [62, 65, 67, 71]], [48, [64, 67, 70, 72]], [41, [64, 65, 69, 72]]] }),
    ...section("break", 4, { lead: null, energy: 0, bass: false }),
    ...section("A", 4, { lead: "A", energy: 2 }), ...section("B", 4, { lead: "B", lift: 2 }), ...section("outro", 4, { lead: "A", energy: 0 }),
  ];
  const t = build({
    bars, bar: 16, chords,
    bass: (at, root) => [N(at, root, 3, 0.8), N(at + 3, root + 7, 1, 0.5), N(at + 4, root + 7, 3, 0.6), N(at + 8, root, 3, 0.75), N(at + 11, root + 7, 1, 0.5), N(at + 12, root + 7, 3, 0.6)],
    pluck: (at, root, tones) => [0, 3, 6, 10, 13].flatMap((s) => [N(at + s, tones[1], 2, 0.3), N(at + s, tones[3], 2, 0.28)]),
    arp: (at, root, tones, b) => [0, 2, 4, 6, 8, 10, 12, 14].map((s, k) => N(at + s, tones[(k + b) % 4] + 12, 2, k % 2 ? 0.26 : 0.36)),
    lead: tune(T),
    drums: (at) => [N(at, DRUM.kick, 1, 0.4), N(at + 6, DRUM.kick, 1, 0.3), N(at + 8, DRUM.kick, 1, 0.4), N(at + 14, DRUM.kick, 1, 0.3), N(at + 3, DRUM.tom, 1, 0.18), N(at + 10, DRUM.tom, 1, 0.18), ...[0, 2, 4, 6, 8, 10, 12, 14].map((s) => N(at + s, DRUM.hat, 1, 0.1))],
  });
  return { name: "afternoon", bpm: 100, stepsPerBeat: 4, length: bars.length * 16, tracks: [
    track("pad", "synth", "saw", t.pad, { ...PAD, volume: 0.13 }),
    track("bass", "synth", "triangle", t.bass, BASS),
    track("guitar", "synth", "triangle", t.pluck, { ...UKE, volume: 0.18, pan: -0.25 }),
    track("marimba", "synth", "triangle", t.arp, { ...MARIMBA, pan: 0.2 }),
    track("lead", "synth", "sine", t.lead, { ...EPIANO, volume: 0.34, pan: 0.05 }),
    track("harmony", "synth", "sine", t.harmony, { ...EPIANO, volume: 0.17, pan: -0.25 }),
    track("drums", "drums", "noise", t.drums, BRUSH),
  ] };
})();

// ---- the evening: "Lamps On", E flat major, slow piano and bells ----------------------------------------------------------------------------
const evening = (() => {
  const chords = [[39, [62, 63, 67, 70]], [36, [60, 63, 67, 70]], [44, [60, 63, 67, 68]], [46, [58, 62, 65, 68]]]; // Ebmaj7 Cm7 Abmaj7 Bb7
  const T = {
    A: [[[0, 79, 6], [6, 77, 2], [8, 75, 8]], [[0, 72, 4], [4, 75, 4], [8, 79, 8]], [[0, 80, 6], [6, 79, 2], [8, 77, 4], [12, 75, 4]], [[0, 74, 12]]],
    B: [[[0, 82, 8], [8, 79, 8]], [[0, 84, 6], [6, 82, 2], [8, 79, 8]], [[0, 80, 4], [4, 82, 4], [8, 84, 4], [12, 87, 4]], [[0, 86, 12]]],
  };
  const bars = [
    ...section("intro", 4, { lead: null, energy: 0 }), ...section("A", 4, { lead: "A", energy: 0 }), ...section("A", 4, { lead: "A" }), ...section("B", 4, { lead: "B" }),
    ...section("bridge", 4, { lead: "A", fit: true, energy: 0, chords: [[41, [60, 65, 68, 72]], [43, [62, 65, 67, 71]], [36, [60, 63, 67, 70]], [46, [58, 62, 65, 68]]] }),
    ...section("A", 4, { lead: "A", energy: 2 }), ...section("B", 4, { lead: "B", lift: 1 }), ...section("outro", 4, { lead: "A", energy: 0 }),
  ];
  const t = build({
    bars, bar: 16, chords,
    bass: (at, root) => [N(at, root, 8, 0.7), N(at + 8, root + 7, 8, 0.55)],
    pluck: (at, root, tones) => [0, 4, 8, 12].flatMap((s) => [N(at + s, tones[(s / 4) % 4], 4, 0.3)]),
    arp: (at, root, tones, b) => (b % 2 ? [N(at + 10, tones[2] + 24, 4, 0.22)] : [N(at + 6, tones[3] + 24, 4, 0.22)]),
    lead: tune(T),
    drums: (at) => [N(at, DRUM.kick, 1, 0.3), N(at + 8, DRUM.snare, 1, 0.12), ...[4, 12].map((s) => N(at + s, DRUM.hat, 1, 0.08))],
  });
  return { name: "evening", bpm: 76, stepsPerBeat: 4, length: bars.length * 16, tracks: [
    track("pad", "synth", "saw", t.pad, { ...PAD, cutoff: 1500, volume: 0.17 }),
    track("bass", "synth", "triangle", t.bass, { ...BASS, volume: 0.4 }),
    track("piano", "synth", "sine", t.pluck, { ...EPIANO, volume: 0.22, pan: -0.15 }),
    track("bells", "synth", "sine", t.arp, BELLS),
    track("lead", "synth", "sine", t.lead, { ...EPIANO, volume: 0.36, pan: 0.1 }),
    track("harmony", "synth", "sine", t.harmony, { ...BELLS, volume: 0.16, pan: -0.25 }),
    track("drums", "drums", "noise", t.drums, { ...BRUSH, volume: 0.26 }),
  ] };
})();

const nova = await connect(PROJECT);
try {
  for (const song of [menu, morning, afternoon, evening]) {
    const { name, ...rest } = song;
    console.log(await nova.call("song_write", { name, song: { version: 1, room: { size: 0.65, damping: 0.5 }, ...rest } }));
  }
} finally {
  nova.close();
}
