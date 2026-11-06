// The rally game's sound effects and music, made through the Nova MCP server's `sfx_write` and `song_write` tools.
import { withServer } from "./mcp.mjs";

// ---- sound effects: the sound editor's settings, by name --------------------------------------------------------------
// (menu_move, menu_accept, menu_back, pause and bump are Kenney's interface and impact sounds now: scripts/rally/kenney-ui.sh)
const sfx = {
  beep: { params: { wave: "sine", freq: 440, attack: 0.005, sustain: 0.18, decay: 0.12, volume: 0.55 } },
  go: { params: { wave: "sine", freq: 880, attack: 0.005, sustain: 0.4, decay: 0.3, punch: 0.3, volume: 0.6 } },
  checkpoint: { params: { wave: "triangle", freq: 700, arpSemitones: 5, arpTime: 0.05, attack: 0, sustain: 0.06, decay: 0.16, volume: 0.45 } },
  lap: { params: { wave: "square", freq: 523, arpSemitones: 7, arpTime: 0.09, attack: 0, sustain: 0.12, decay: 0.4, duty: 0.3, volume: 0.45 } },
  best_lap: { params: { wave: "square", freq: 659, arpSemitones: 5, arpTime: 0.08, attack: 0, sustain: 0.2, decay: 0.55, duty: 0.35, vibratoDepth: 0.1, vibratoSpeed: 10, volume: 0.45 } },
  finish: { params: { wave: "square", freq: 392, arpSemitones: 9, arpTime: 0.14, attack: 0, sustain: 0.5, decay: 0.7, duty: 0.4, punch: 0.3, volume: 0.5 } },
  // Loops that the game plays all the time and changes while they play (nova.sound.set): the engine's pitch follows the revs,
  // the gravel and the tyre squeal follow how hard the car is on the loose or sliding. 0.5 s of a 100 Hz saw is exactly 50 cycles,
  // so the engine loops without a seam.
  // (the engine is no longer synthesised: sounds/engine_1 to engine_6 are recorded loops, CC0, see licenses/opengameart-engine-loops.txt)
  gravel_loop: { params: { wave: "noise", freq: 900, attack: 0, sustain: 0.5, decay: 0, lowpass: 3200, highpass: 400, volume: 0.5 } },
  skid_loop: { params: { wave: "noise", freq: 1500, attack: 0, sustain: 0.5, decay: 0, lowpass: 9000, highpass: 1800, volume: 0.3 } },
  // a change of gear: a short chuff of air and a click
  shift: { params: { wave: "noise", freq: 700, attack: 0, sustain: 0.015, decay: 0.07, punch: 0.5, lowpass: 3500, highpass: 500, volume: 0.45 } },
  whoosh: { params: { wave: "noise", freq: 1200, attack: 0.05, sustain: 0.05, decay: 0.3, lowpass: 3000, highpass: 600, volume: 0.25 } },
};

// ---- music -----------------------------------------------------------------------------------------------------------
const track = (name, kind, wave, notes, o = {}) => ({ name, kind, wave, duty: 0.5, attack: 0.01, decay: 0.1, sustain: 0.6, release: 0.12, volume: 0.5, pan: 0, mute: false, notes, ...o });
const DRUM = { kick: 36, snare: 38, clap: 39, hat: 42, open: 46, crash: 49, tom: 45 };
/// One drum hit per listed step in each bar of a pattern, repeated for `bars` bars (16 steps a bar).
const drums = (bars, pattern) => {
  const notes = [];
  for (let b = 0; b < bars; b++)
    for (const [drum, steps, vel = 0.8] of pattern) for (const s of steps) notes.push({ step: b * 16 + s, len: 1, pitch: DRUM[drum], vel });
  return notes;
};
/// Notes of a chord each held for `len` steps from the bar's start, for every chord of a progression.
const pads = (progression, len = 16, vel = 0.5) => progression.flatMap((chord, bar) => chord.map((pitch) => ({ step: bar * 16, len, pitch, vel })));
const bassline = (roots, pattern, vel = 0.8) => roots.flatMap((root, bar) => pattern.map(([step, len, octave = 0]) => ({ step: bar * 16 + step, len, pitch: root + octave, vel })));

const menu = {
  version: 1, bpm: 96, stepsPerBeat: 4, length: 128,
  tracks: [
    track("pad", "synth", "triangle", pads([[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62], [57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 56, 59]], 15, 0.4), { attack: 0.08, release: 0.4, volume: 0.45 }),
    track("bass", "synth", "saw", bassline([45, 41, 36, 43, 45, 41, 43, 40], [[0, 6], [8, 4], [12, 3]], 0.7), { volume: 0.4, sustain: 0.5 }),
    track("lead", "synth", "square", [
      ...[[0, 69, 6], [8, 67, 4], [12, 64, 4]].map(([s, p, l]) => ({ step: 0 * 16 + s, len: l, pitch: p, vel: 0.55 })),
      ...[[0, 65, 6], [8, 69, 4], [12, 72, 4]].map(([s, p, l]) => ({ step: 16 + s, len: l, pitch: p, vel: 0.55 })),
      ...[[0, 72, 8], [8, 71, 4], [12, 67, 4]].map(([s, p, l]) => ({ step: 32 + s, len: l, pitch: p, vel: 0.55 })),
      ...[[0, 71, 8], [8, 74, 8]].map(([s, p, l]) => ({ step: 48 + s, len: l, pitch: p, vel: 0.55 })),
      ...[[0, 69, 6], [8, 72, 4], [12, 76, 4]].map(([s, p, l]) => ({ step: 64 + s, len: l, pitch: p, vel: 0.55 })),
      ...[[0, 77, 6], [8, 72, 4], [12, 69, 4]].map(([s, p, l]) => ({ step: 80 + s, len: l, pitch: p, vel: 0.55 })),
      ...[[0, 74, 4], [4, 71, 4], [8, 67, 8]].map(([s, p, l]) => ({ step: 96 + s, len: l, pitch: p, vel: 0.55 })),
      ...[[0, 68, 4], [4, 71, 4], [8, 64, 8]].map(([s, p, l]) => ({ step: 112 + s, len: l, pitch: p, vel: 0.55 })),
    ], { duty: 0.25, volume: 0.32, attack: 0.02, release: 0.25 }),
    track("drums", "drums", "noise", drums(8, [["kick", [0, 10]], ["snare", [8], 0.6], ["hat", [0, 2, 4, 6, 8, 10, 12, 14], 0.3]]), { volume: 0.5 }),
  ],
};

// a driving E-minor theme for the forest circuit
const raceForest = {
  version: 1, bpm: 148, stepsPerBeat: 4, length: 128,
  tracks: [
    track("bass", "synth", "saw", bassline([40, 40, 36, 43, 40, 40, 38, 43], [[0, 2], [2, 2], [4, 2], [6, 2], [8, 2], [10, 2], [12, 2], [14, 2]], 0.8), { volume: 0.4, sustain: 0.4, release: 0.05 }),
    track("lead", "synth", "square", [
      ...[[0, 64, 3], [4, 67, 3], [8, 71, 4], [12, 69, 2], [14, 67, 2]].map(([s, p, l]) => ({ step: s, len: l, pitch: p, vel: 0.7 })),
      ...[[0, 64, 3], [4, 67, 3], [8, 72, 4], [12, 71, 2], [14, 69, 2]].map(([s, p, l]) => ({ step: 16 + s, len: l, pitch: p, vel: 0.7 })),
      ...[[0, 60, 3], [4, 64, 3], [8, 67, 4], [12, 64, 2], [14, 60, 2]].map(([s, p, l]) => ({ step: 32 + s, len: l, pitch: p, vel: 0.7 })),
      ...[[0, 62, 3], [4, 67, 3], [8, 71, 4], [12, 74, 4]].map(([s, p, l]) => ({ step: 48 + s, len: l, pitch: p, vel: 0.7 })),
      ...[[0, 76, 4], [4, 74, 2], [6, 71, 2], [8, 69, 4], [12, 71, 4]].map(([s, p, l]) => ({ step: 64 + s, len: l, pitch: p, vel: 0.7 })),
      ...[[0, 76, 4], [4, 79, 2], [6, 76, 2], [8, 74, 4], [12, 72, 4]].map(([s, p, l]) => ({ step: 80 + s, len: l, pitch: p, vel: 0.7 })),
      ...[[0, 72, 4], [4, 71, 2], [6, 67, 2], [8, 64, 4], [12, 67, 4]].map(([s, p, l]) => ({ step: 96 + s, len: l, pitch: p, vel: 0.7 })),
      ...[[0, 74, 4], [4, 71, 4], [8, 67, 4], [12, 62, 4]].map(([s, p, l]) => ({ step: 112 + s, len: l, pitch: p, vel: 0.7 })),
    ], { duty: 0.3, volume: 0.3, attack: 0.005, release: 0.08 }),
    track("stabs", "synth", "saw", pads([[52, 55, 59], [52, 55, 59], [48, 52, 55], [50, 55, 59], [52, 55, 59], [52, 55, 59], [50, 54, 57], [50, 55, 59]], 3, 0.45).flatMap((n) => [n, { ...n, step: n.step + 6 }, { ...n, step: n.step + 10 }]), { volume: 0.22, decay: 0.08, sustain: 0.3, release: 0.05, pan: 0.2 }),
    track("drums", "drums", "noise", drums(8, [["kick", [0, 4, 8, 12]], ["snare", [4, 12], 0.8], ["hat", [2, 6, 10, 14], 0.45], ["hat", [0, 8], 0.25], ["open", [14], 0.3]]).concat([{ step: 0, len: 1, pitch: DRUM.crash, vel: 0.6 }]), { volume: 0.6 }),
  ],
};

// a dusty, twangy theme for the desert circuit (D minor with a flat second)
const raceDesert = {
  version: 1, bpm: 132, stepsPerBeat: 4, length: 128,
  tracks: [
    track("bass", "synth", "triangle", bassline([38, 38, 39, 38, 38, 36, 39, 38], [[0, 3], [4, 1], [6, 2], [8, 3], [12, 1], [14, 2]], 0.85), { volume: 0.55, sustain: 0.6 }),
    track("twang", "synth", "saw", [
      ...[[0, 62, 2], [3, 65, 1], [4, 69, 4], [10, 68, 2], [12, 65, 4]].map(([s, p, l]) => ({ step: s, len: l, pitch: p, vel: 0.7 })),
      ...[[0, 62, 2], [3, 65, 1], [4, 70, 4], [10, 69, 2], [12, 65, 4]].map(([s, p, l]) => ({ step: 16 + s, len: l, pitch: p, vel: 0.7 })),
      ...[[0, 63, 2], [3, 67, 1], [4, 70, 4], [10, 67, 2], [12, 63, 4]].map(([s, p, l]) => ({ step: 32 + s, len: l, pitch: p, vel: 0.7 })),
      ...[[0, 62, 2], [3, 65, 1], [4, 69, 8], [14, 70, 2]].map(([s, p, l]) => ({ step: 48 + s, len: l, pitch: p, vel: 0.7 })),
      ...[[0, 74, 4], [4, 72, 2], [6, 70, 2], [8, 69, 4], [12, 65, 4]].map(([s, p, l]) => ({ step: 64 + s, len: l, pitch: p, vel: 0.7 })),
      ...[[0, 74, 4], [4, 75, 2], [6, 74, 2], [8, 70, 4], [12, 69, 4]].map(([s, p, l]) => ({ step: 80 + s, len: l, pitch: p, vel: 0.7 })),
      ...[[0, 72, 2], [3, 70, 1], [4, 67, 4], [10, 70, 2], [12, 72, 4]].map(([s, p, l]) => ({ step: 96 + s, len: l, pitch: p, vel: 0.7 })),
      ...[[0, 70, 4], [4, 69, 4], [8, 65, 4], [12, 62, 4]].map(([s, p, l]) => ({ step: 112 + s, len: l, pitch: p, vel: 0.7 })),
    ], { volume: 0.26, decay: 0.2, sustain: 0.4, release: 0.15, pan: -0.15 }),
    track("pad", "synth", "triangle", pads([[50, 57, 62], [50, 57, 62], [51, 58, 62], [50, 57, 62], [50, 57, 62], [48, 55, 60], [51, 58, 62], [50, 57, 62]], 16, 0.35), { attack: 0.1, release: 0.4, volume: 0.35 }),
    track("drums", "drums", "noise", drums(8, [["kick", [0, 6, 10]], ["snare", [4, 12], 0.7], ["tom", [14], 0.5], ["hat", [0, 2, 4, 6, 8, 10, 12, 14], 0.3]]), { volume: 0.55 }),
  ],
};

// a cool, spacious theme for the snow circuit: bell-like arpeggios over a slow pulse (A minor, then F)
const raceSnow = {
  version: 1, bpm: 124, stepsPerBeat: 4, length: 128,
  tracks: [
    track("bells", "synth", "sine", [57, 60, 64, 69, 64, 60, 57, 60, 65, 69, 72, 69, 65, 69, 64, 60].flatMap((pitch, i) => [0, 1, 2, 3, 4, 5, 6, 7].map((bar) => ({ step: bar * 16 + i, len: 1, pitch: pitch + (bar % 4 === 2 ? -4 : 0) + (bar % 4 === 3 ? -2 : 0), vel: 0.55 + (i % 4 === 0 ? 0.2 : 0) }))), { volume: 0.3, attack: 0.002, decay: 0.25, sustain: 0.2, release: 0.4, pan: 0.1 }),
    track("bass", "synth", "triangle", bassline([45, 45, 41, 43, 45, 45, 41, 43], [[0, 6], [8, 3], [12, 3]], 0.85), { volume: 0.5, sustain: 0.7 }),
    track("pad", "synth", "saw", pads([[57, 60, 64], [57, 60, 64], [53, 57, 60], [55, 59, 62], [57, 60, 64], [57, 60, 64], [53, 57, 60], [55, 59, 62]], 16, 0.3), { attack: 0.15, release: 0.5, volume: 0.16, pan: -0.2 }),
    track("drums", "drums", "noise", drums(8, [["kick", [0, 6, 8, 14]], ["clap", [4, 12], 0.5], ["hat", [2, 6, 10, 14], 0.35], ["open", [15], 0.2]]), { volume: 0.5 }),
  ],
};

// a low, steady night drive: a pulsing bass under a slow, lonely lead (D minor)
const raceNight = {
  version: 1, bpm: 108, stepsPerBeat: 4, length: 128,
  tracks: [
    track("lead", "synth", "triangle", [[0, 62, 6], [8, 65, 4], [12, 69, 4], [16, 67, 8], [24, 65, 4], [28, 62, 4], [32, 60, 6], [40, 64, 4], [44, 67, 4], [48, 69, 12], [64, 62, 6], [72, 65, 4], [76, 69, 4], [80, 70, 8], [88, 69, 4], [92, 65, 4], [96, 67, 6], [104, 64, 4], [108, 60, 4], [112, 62, 14]].map(([s, p, l]) => ({ step: s, len: l, pitch: p, vel: 0.65 })), { volume: 0.3, attack: 0.03, release: 0.5, pan: 0.15 }),
    track("bass", "synth", "saw", bassline([38, 38, 34, 36, 38, 38, 34, 31], [[0, 2], [4, 2], [8, 2], [12, 2]], 0.8), { volume: 0.38, sustain: 0.5 }),
    track("pad", "synth", "triangle", pads([[50, 53, 57], [50, 53, 57], [46, 50, 53], [48, 52, 55], [50, 53, 57], [50, 53, 57], [46, 50, 53], [43, 47, 50]], 16, 0.3), { attack: 0.2, release: 0.6, volume: 0.3, pan: -0.2 }),
    track("drums", "drums", "noise", drums(8, [["kick", [0, 4, 8, 12]], ["snare", [4, 12], 0.6], ["hat", [2, 6, 10, 14], 0.3]]), { volume: 0.5 }),
  ],
};

// a short, bright fanfare for the results screen
const results = {
  version: 1, bpm: 112, stepsPerBeat: 4, length: 64,
  tracks: [
    track("lead", "synth", "square", [
      ...[[0, 67, 4], [4, 72, 4], [8, 76, 8], [16, 74, 4], [20, 71, 4], [24, 67, 8], [32, 69, 4], [36, 72, 4], [40, 77, 8], [48, 76, 4], [52, 74, 4], [56, 72, 8]].map(([s, p, l]) => ({ step: s, len: l, pitch: p, vel: 0.7 })),
    ], { duty: 0.3, volume: 0.32, release: 0.3 }),
    track("pad", "synth", "triangle", pads([[48, 52, 55], [55, 59, 62], [53, 57, 60], [48, 52, 55]], 16, 0.4), { attack: 0.06, release: 0.5, volume: 0.4 }),
    track("bass", "synth", "saw", bassline([36, 43, 41, 36], [[0, 4], [8, 4]], 0.7), { volume: 0.35 }),
    track("drums", "drums", "noise", drums(4, [["kick", [0, 8]], ["clap", [4, 12], 0.5], ["hat", [2, 6, 10, 14], 0.25]]), { volume: 0.45 }),
  ],
};

// ---- the fuller voices of the studio (unison, filter, reverb, studio drums) given to the tracks above, by song and track name ----
const PAD = { wave: "saw", unison: 5, detune: 14, cutoff: 1500, sweep: 0.15, attack: 0.3, release: 0.9, reverb: 0.55 };
const BASS = { wave: "saw", unison: 2, detune: 6, cutoff: 480, resonance: 0.15, sweep: 0.5, sub: 0.55, attack: 0.005, release: 0.08 };
const LEAD = { wave: "saw", unison: 3, detune: 9, cutoff: 3600, sweep: 0.4, vibrato: 0.08, reverb: 0.35 };
const DRUMS = { kit: "studio", reverb: 0.12 };
const voices = {
  menu: { room: { size: 0.65, damping: 0.4 }, pad: { ...PAD, volume: 0.5 }, bass: { ...BASS, volume: 0.45 }, lead: { ...LEAD, volume: 0.3, cutoff: 3000, attack: 0.03, release: 0.4 }, drums: { ...DRUMS, volume: 0.55 } },
  race_forest: { room: { size: 0.5, damping: 0.45 }, bass: { ...BASS, volume: 0.42 }, lead: { ...LEAD, volume: 0.3, release: 0.12 }, stabs: { wave: "saw", unison: 3, detune: 12, cutoff: 1800, sweep: 0.6, reverb: 0.25, volume: 0.24 }, drums: { ...DRUMS, volume: 0.65 } },
  race_desert: { room: { size: 0.45, damping: 0.5 }, bass: { ...BASS, wave: "saw", cutoff: 560, volume: 0.45 }, twang: { wave: "saw", unison: 2, detune: 5, cutoff: 2400, resonance: 0.2, sweep: 0.7, reverb: 0.3, volume: 0.28 }, pad: { ...PAD, volume: 0.4 }, drums: { ...DRUMS, volume: 0.6 } },
  race_snow: { room: { size: 0.8, damping: 0.3, mix: 1.2 }, bells: { unison: 2, detune: 3, reverb: 0.65, volume: 0.3 }, bass: { ...BASS, wave: "saw", cutoff: 520, volume: 0.45 }, pad: { ...PAD, cutoff: 1800, reverb: 0.7, volume: 0.3 }, drums: { ...DRUMS, volume: 0.55 } },
  race_night: { room: { size: 0.75, damping: 0.5 }, lead: { wave: "saw", unison: 3, detune: 8, cutoff: 2400, vibrato: 0.1, reverb: 0.5, attack: 0.06, release: 0.6, volume: 0.28 }, bass: { ...BASS, volume: 0.42 }, pad: { ...PAD, cutoff: 1100, volume: 0.38 }, drums: { ...DRUMS, volume: 0.55 } },
  results: { room: { size: 0.6, damping: 0.4 }, lead: { ...LEAD, volume: 0.32, release: 0.35 }, pad: { ...PAD, volume: 0.45 }, bass: { ...BASS, volume: 0.4 }, drums: { ...DRUMS, volume: 0.5 } },
};
// ---- arrangement: each eight-bar loop above becomes four sections (so the music runs four times as long before it repeats):
// 1 the theme; 2 the theme with the lead doubled an octave up and busier hats; 3 a breakdown (the bass and stabs wait, the drums thin
// out, the lead plays every other note); 4 the theme again with a fifth above the lead, a crash and a snare fill into the loop.
const LEADS = new Set(["lead", "twang", "bells"]);
const hits = (steps, pitch, vel, at) => steps.map((st) => ({ step: at + st, len: 1, pitch, vel }));
function arrange(song) {
  const L = song.length;
  const shift = (notes, by) => notes.map((n) => ({ ...n, step: n.step + by }));
  const tracks = song.tracks.map((t) => {
    const base = t.notes;
    const parts = [];
    // 1: the theme
    parts.push(...shift(base, 0));
    // 2: the lead doubled up an octave, extra hats
    if (LEADS.has(t.name)) parts.push(...shift(base, L), ...shift(base.map((n) => ({ ...n, pitch: n.pitch + 12, vel: n.vel * 0.45 })), L));
    else if (t.kind === "drums") {
      const bars = L / 16;
      parts.push(...shift(base, L));
      for (let b = 0; b < bars; b++) parts.push(...hits([1, 3, 5, 7, 9, 11, 13, 15], 42, 0.16, L + b * 16));
      parts.push(...hits([0], 49, 0.55, L));
    } else parts.push(...shift(base, L));
    // 3: the breakdown
    if (LEADS.has(t.name)) parts.push(...shift(base.filter((_, i) => i % 2 === 0), 2 * L));
    else if (t.kind === "drums") {
      const bars = L / 16;
      for (let b = 0; b < bars; b++) {
        if (b >= 2) parts.push(...hits([0, 8], 36, 0.8, 2 * L + b * 16));
        parts.push(...hits([4, 12], 42, 0.3, 2 * L + b * 16));
        if (b >= 6) parts.push(...hits([4, 12], 38, 0.6, 2 * L + b * 16));
      }
    } else if (t.name === "bass") parts.push(...shift(base.filter((n) => n.step >= L / 2), 2 * L));
    else if (t.name === "pad") parts.push(...shift(base, 2 * L));
    // (the stabs and any other track rest)
    // 4: the theme with a fifth above the lead, a crash, and a fill into the loop
    if (LEADS.has(t.name)) parts.push(...shift(base, 3 * L), ...shift(base.map((n) => ({ ...n, pitch: n.pitch + 7, vel: n.vel * 0.4 })), 3 * L));
    else if (t.kind === "drums") {
      parts.push(...shift(base.filter((n) => n.step < L - 16), 3 * L), ...hits([0], 49, 0.6, 3 * L));
      parts.push(...hits([0, 4, 8, 10, 12, 13, 14, 15], 38, 0.7, 3 * L + L - 16), ...hits([0, 8], 36, 0.9, 3 * L + L - 16));
    } else parts.push(...shift(base, 3 * L));
    return { ...t, notes: parts };
  });
  return { ...song, length: 4 * L, tracks };
}

function dress(name, song) {
  const v = voices[name];
  const arranged = name === "results" ? song : arrange(song);
  return { ...arranged, room: v.room, tracks: arranged.tracks.map((t) => ({ ...t, ...(v[t.name] ?? {}) })) };
}

await withServer(async (nova) => {
  for (const [name, a] of Object.entries(sfx)) console.log(await nova.call("sfx_write", { name, ...a }));
  for (const [name, song] of Object.entries({ menu, race_forest: raceForest, race_desert: raceDesert, race_snow: raceSnow, race_night: raceNight, results })) console.log(await nova.call("song_write", { name, song: dress(name, song) }));
});
