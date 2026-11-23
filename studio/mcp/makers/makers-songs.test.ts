// The makers' sound effects and the first half of the song moods (the other half: makers-songs-more.test.ts; why they are
// apart: makers-kit.ts).
import { describe, expect, it } from "vitest";
import { checkMood, makersFolder } from "./makers-kit";
import { programs } from "../server";
import { unlessPassedBefore } from "../test-cache";
import { MOOD_NAMES } from "./song";
import { PURPOSE_NAMES } from "./sound";

const m = makersFolder();
const { text, use, bytes, again } = m;

describe("sounds and songs by what they are for", () => {
  it("gives a tuned effect for every purpose that passes sound_report, and variants by seed", () => {
    for (const purpose of PURPOSE_NAMES) {
      for (const seed of [1, 2, 3]) {
        const said = text(use("sfx_write", { name: `${purpose}_${seed}`, purpose, seed }));
        expect(said, `${purpose} seed ${seed}`).not.toContain("WARNING");
        // built like a produced sound: layered, and not one the report calls toy-like
        expect(said, `${purpose} seed ${seed}`).not.toContain("toy-like");
        expect(JSON.parse(bytes(`sounds/${purpose}_${seed}.sfx.json`).toString()).layers.length, purpose).toBeGreaterThan(1);
      }
      expect(bytes(`sounds/${purpose}_1.wav`).equals(bytes(`sounds/${purpose}_2.wav`)), `${purpose}: another seed is another sound`).toBe(false);
    }
    again("sfx_write", { name: "step_grass_2", purpose: "step_grass", seed: 2 }, ["sounds/step_grass_2.wav", "sounds/step_grass_2.sfx.json"]);
    // a purpose is a starting point: the finish and the layers still change it, and the file is an ordinary effect
    use("sfx_write", { name: "low", purpose: "coin", params: { volume: 0.3, reverb: 0.4 } });
    expect(JSON.parse(bytes("sounds/low.sfx.json").toString())).toMatchObject({ volume: 0.3, reverb: 0.4 });
    // the plain voice's keys would change nothing in a layered effect: refused, not ignored
    expect(() => use("sfx_write", { name: "low", purpose: "coin", params: { freq: 500 } })).toThrow(/made of layers.*"freq" would change nothing/);
    // the old purposes are all still there, with the new ones
    for (const p of ["step_grass", "step_stone", "sword_swing", "hit", "hurt", "pickup", "coin", "door", "chest_open", "jump", "land", "ui_move", "ui_select", "enemy_die", "locked", "powerup", "explosion", "laser", "heavy_hit", "whoosh", "shot", "zap", "tell", "alarm", "death", "metal_hit", "glass"]) expect(PURPOSE_NAMES).toContain(p);
    // a misspelt key, of the effect or of a layer, is refused with the nearest one
    expect(() => use("sfx_write", { name: "x", params: { revrb: 0.2 } })).toThrow(/"revrb", which the synth does not have \(did you mean "reverb"\?\)/);
    expect(() => use("sfx_write", { name: "x", params: { layers: [{ wave: "noise", cutof: 300 }] } })).toThrow(/layers\[0\] has "cutof", which a layer does not have \(did you mean "cutoff"\?\)/);
    // a level to match: the volume is found for it
    const matched = text(use("sfx_write", { name: "quiet_hit", purpose: "hit", loudness: -24 }));
    expect(matched).toMatch(/volume [\d.]+ for loudness -2[34]\.\d \(asked -24\)/);
    expect(() => use("sfx_write", { name: "x", purpose: "sneeze" })).toThrow(/unknown purpose 'sneeze'. Purposes: step_grass/);
  }, 30_000); // (81 layered effects rendered and reported: a few seconds alone, more when the whole suite runs at once)

  it("makes a looping song for every mood (the first half) that passes sound_report and stays an ordinary song", (ctx) => {
    // (the songs are encoded by nova-ogg and their Ogg read back by nova, when they are built: those programs are among what it reads)
    const passed = unlessPassedBefore(ctx, programs.nova, programs.ogg);
    for (const mood of MOOD_NAMES.slice(0, Math.ceil(MOOD_NAMES.length / 2))) checkMood(m, mood);
    passed();
  }, 120_000); // (each mood rendered, a minute of music each, and reported: half a minute alone, more when the suite runs at once)

  it("makes a song again the same, another by seed, key and tempo, the old short loop, and refuses what it does not know", (ctx) => {
    const passed = unlessPassedBefore(ctx, programs.nova, programs.ogg);
    use("song_make", { name: "victory_jingle", mood: "victory jingle" });
    use("song_make", { name: "boss", mood: "boss" });
    expect(() => use("song_write", { name: "victory_again", song: bytes("music/victory_jingle.song.json").toString() })).not.toThrow();
    again("song_make", { name: "boss", mood: "boss" }, ["music/boss.song.json"]);
    const first = bytes("music/boss.song.json").toString();
    use("song_make", { name: "boss", mood: "boss", seed: 2, key: "A minor", tempo: 170 });
    const second = JSON.parse(bytes("music/boss.song.json").toString());
    expect(second.bpm).toBe(170);
    expect(bytes("music/boss.song.json").toString()).not.toBe(first);
    // the old short loop on request, which the report says is short
    use("song_make", { name: "short", mood: "synthwave", form: "loop" });
    const short = JSON.parse(bytes("music/short.song.json").toString());
    expect(short.length).toBe(128);
    expect(short.loop).toBeUndefined();
    expect(text(use("sound_report", { sound: "music/short", picture: false }))).toMatch(/WARNING: it loops every 16 s: under about 45 s/);
    expect(() => use("song_make", { name: "x", mood: "boss", form: "medley" })).toThrow(/"form" is "song"/);
    expect(() => use("song_make", { name: "x", mood: "polka" })).toThrow(/"mood" is one of: "calm village"/);
    expect(() => use("song_make", { name: "x", mood: "boss", key: "H" })).toThrow(/"key" is a note name/);
    passed();
  }, 120_000);
});
