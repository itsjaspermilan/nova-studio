// The one piece of music: slow, warm, acoustic-feeling, quiet enough to drive to. song_make writes a "calm village" song in sections
// (an intro that plays once, then A, B, a break and A again, looping from the first A: a minute and a half), and this recipe gives it
// the slice's instruments: a soft plucked lead (a Karplus-Strong string), a warm pad for the chords, a round bass with enough
// harmonics for a small speaker, and soft, brushed-sounding drums (the studio kit, low, in a room, without the crash). song_write
// renders it again to the .ogg the game streams; sound_report checks the loop's seam and the level.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GAME, tool } from "./lib.mjs";

tool("song_make", { name: "fernhollow", mood: "calm village", key: "F", tempo: 80, seed: 3 });
const song = JSON.parse(readFileSync(join(GAME, "music/fernhollow.song.json"), "utf8"));
for (const t of song.tracks) {
  if (t.name === "melody") Object.assign(t, { wave: "pluck", damping: 0.72, brightness: 0.42, attack: 0.008, decay: 0.05, sustain: 0.95, release: 0.35, volume: 0.5, unison: undefined, detune: undefined, cutoff: undefined, vibrato: undefined, reverb: 0.32 });
  if (t.name === "harmony") Object.assign(t, { wave: "saw", attack: 0.6, release: 0.9, volume: 0.1, unison: 3, detune: 9, cutoff: 900, reverb: 0.5 });
  if (t.name === "bass") Object.assign(t, { wave: "saw", attack: 0.012, decay: 0.3, sustain: 0.5, release: 0.18, volume: 0.34, cutoff: 650, sweep: 0.15, sub: 0.22 });
  if (t.kind === "drums") {
    Object.assign(t, { kit: "studio", volume: 0.2, reverb: 0.3 });
    // brushed, not struck: no crashes, and the hats soft and on the off-beats only
    t.notes = t.notes.filter((n) => n.pitch !== 49 && n.pitch !== 57).map((n) => (n.pitch === 42 || n.pitch === 46 ? { ...n, vel: Math.min(n.vel ?? 1, 0.55) } : n));
  }
}
for (const t of song.tracks) for (const k of Object.keys(t)) if (t[k] === undefined) delete t[k];
song.room = { size: 0.6, damping: 0.5, mix: 1 };
song.master = { ...song.master, lufs: -18 };
console.log(tool("song_write", { name: "fernhollow", song }));
console.log(tool("sound_report", { sounds: [{ name: "music/fernhollow", volume: 0.3 }, { name: "horn", volume: 0.7 }, { name: "step_grass1", volume: 0.4 }, { name: "voice_hazel1", volume: 0.45 }, { name: "creek_loop", volume: 0.75 }, { name: "forest_air", volume: 0.42 }] }));
