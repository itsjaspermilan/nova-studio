// The menu music: smooth techno, 124 bpm, 48 bars (about a minute and a half before it comes round again), written through the MCP server's `song_write`.
//   scripts/env.sh node scripts/rally/techno.mjs     (cargo build --release -p nova-studio --bin nova-ogg first, so that it is an .ogg)
import { withServer } from "./mcp.mjs";

const track = (name, kind, wave, notes, o = {}) => ({ name, kind, wave, duty: 0.5, attack: 0.01, decay: 0.1, sustain: 0.6, release: 0.12, volume: 0.5, pan: 0, mute: false, notes, ...o });
const DRUM = { kick: 36, clap: 39, hat: 42, open: 46, crash: 49 };
const BARS = 48;
// Am9, Fmaj7, Cmaj7, G6: one chord a bar, round and round
const CHORDS = [[57, 60, 64, 71], [53, 57, 60, 64], [48, 55, 59, 64], [55, 59, 62, 64]];
const ROOTS = [45, 41, 36, 43];
// the sections, by bar: 0-7 intro, 8-15 groove, 16-23 build, 24-31 breakdown, 32-39 main, 40-47 outro
const section = (bar) => (bar < 8 ? "intro" : bar < 16 ? "groove" : bar < 24 ? "build" : bar < 32 ? "break" : bar < 40 ? "main" : "outro");

const drums = [], pad = [], bass = [], arp = [], lead = [];
const hit = (bar, step, pitch, vel) => drums.push({ step: bar * 16 + step, len: 1, pitch, vel });
for (let bar = 0; bar < BARS; bar++) {
  const s = section(bar), chord = CHORDS[bar % 4], root = ROOTS[bar % 4];
  const kick = (s === "groove" || s === "build" || s === "main") || (s === "intro" && bar >= 4) || (s === "outro" && bar < 44);
  if (kick) for (const st of [0, 4, 8, 12]) hit(bar, st, DRUM.kick, st === 0 ? 0.85 : 0.78);
  if (s !== "break" || bar >= 30) for (const st of [2, 6, 10, 14]) hit(bar, st, DRUM.hat, 0.3); // the offbeat hat
  if (s === "build" || s === "main") { hit(bar, 4, DRUM.clap, 0.42); hit(bar, 12, DRUM.clap, 0.42); for (const st of [1, 3, 5, 7, 9, 11, 13, 15]) hit(bar, st, DRUM.hat, 0.1); }
  if (s === "main" && bar % 4 === 3) hit(bar, 14, DRUM.open, 0.3);
  if (bar % 8 === 0 && bar > 0 && s !== "outro") hit(bar, 0, DRUM.crash, 0.45);
  // the pad plays all through (it thins in the intro and breakdown by being the only voice)
  for (const p of chord) pad.push({ step: bar * 16, len: 16, pitch: p, vel: s === "break" ? 0.5 : 0.38 });
  // the bass rolls on the offbeats under the kick, and rests in the intro's first half and the breakdown
  if (s === "groove" || s === "build" || s === "main" || (s === "intro" && bar >= 4) || (s === "outro" && bar < 44)) {
    for (const st of [2, 6, 10, 14]) bass.push({ step: bar * 16 + st, len: 2, pitch: root, vel: 0.78 });
    if (bar % 4 === 3) bass.push({ step: bar * 16 + 15, len: 1, pitch: root + 12, vel: 0.5 });
  }
  // the pluck: a loose pattern of chord tones, an octave and a bit up (from the build on, and in the breakdown)
  if (s === "build" || s === "break" || s === "main") {
    const tones = [chord[1] + 12, chord[2] + 12, chord[3] + 12, chord[2] + 12, chord[1] + 12, chord[3] + 12];
    [0, 3, 6, 8, 11, 14].forEach((st, i) => arp.push({ step: bar * 16 + st, len: 2, pitch: tones[i], vel: i === 0 ? 0.65 : 0.5 }));
  }
  // a slow lead line in the main section and the end of the build
  if (s === "main" || (s === "build" && bar >= 20)) {
    const line = [[0, 76, 6], [8, 74, 4], [12, 72, 4]], line2 = [[0, 72, 6], [8, 69, 4], [12, 71, 4]];
    for (const [st, p, l] of bar % 2 === 0 ? line : line2) lead.push({ step: bar * 16 + st, len: l, pitch: p - (bar % 4 >= 2 ? 3 : 0), vel: 0.55 });
  }
}

const song = {
  version: 1, bpm: 124, stepsPerBeat: 4, length: BARS * 16,
  room: { size: 0.7, damping: 0.45 },
  tracks: [
    track("drums", "drums", "noise", drums, { kit: "studio", reverb: 0.1, volume: 0.62 }),
    track("pad", "synth", "saw", pad, { unison: 5, detune: 14, cutoff: 1300, sweep: 0.2, attack: 0.5, release: 1.0, reverb: 0.6, volume: 0.36, pan: -0.1 }),
    track("bass", "synth", "saw", bass, { unison: 2, detune: 6, cutoff: 420, resonance: 0.2, sweep: 0.5, sub: 0.6, attack: 0.005, release: 0.1, volume: 0.45 }),
    track("pluck", "synth", "saw", arp, { unison: 2, detune: 7, cutoff: 2600, resonance: 0.15, sweep: 0.7, decay: 0.14, sustain: 0.15, release: 0.25, reverb: 0.45, volume: 0.26, pan: 0.2 }),
    track("lead", "synth", "saw", lead, { unison: 3, detune: 9, cutoff: 2200, sweep: 0.3, vibrato: 0.08, attack: 0.05, release: 0.5, reverb: 0.5, volume: 0.24, pan: -0.15 }),
  ],
};

await withServer(async (nova) => { console.log(await nova.call("song_write", { name: "menu", song })); });
