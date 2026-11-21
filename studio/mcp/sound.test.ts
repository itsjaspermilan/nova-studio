// sound_report's make-up and advice: what an agent who cannot listen is told about a thin or toy-like sound.
import { describe, expect, it } from "vitest";
import { DEFAULTS, render, type SfxParams } from "../src/lib/sfx";
import { cleanLayer } from "../src/lib/sfx-layers";
import { drumTrack, parseSong, renderSong, synthTrack, type Song } from "../src/lib/song";
import { analyse, describe as words, heardLevel } from "./sound";
import { PURPOSES } from "./makers/sound";

const report = (p: SfxParams) => analyse("x", render(p), { source: { sfx: p } });

describe("the make-up of a sound and the advice on it", () => {
  it("calls a plain square blip toy-like and says what to add", () => {
    const blip: SfxParams = { ...DEFAULTS, wave: "square", freq: 700, attack: 0.004, sustain: 0.03, decay: 0.05, volume: 0.45 };
    const a = report(blip);
    expect(a.character.width).toBe(0);
    expect(a.character.transient).toBe(false);
    expect(a.character.noise).toBeLessThan(0.15);
    const text = words(a);
    expect(text).toMatch(/advice: toy-like \(it reads as an old console's sound\): .*mono/);
    expect(text).toContain("the plain voice's square is not band-limited");
    expect(text).toMatch(/make-up: no transient, rises in \d+ ms, \d+ spectral lines/);
  });

  it("tells a plain noise hit that it is held-step noise with no transient and no body", () => {
    const a = report({ ...DEFAULTS, wave: "noise", freq: 2200, slide: -1.2, attack: 0.004, sustain: 0.02, decay: 0.12, punch: 0.3, lowpass: 6000, volume: 0.5 });
    const text = a.advice.join("\n");
    expect(text).toContain("held steps (an 8-bit console's noise channel");
    expect(text).toContain("no transient");
  });

  it("finds the transient, the stereo and the body of a layered hit, and calls it nothing toy-like", () => {
    const a = report(PURPOSES.hit!.params);
    expect(a.character.transient).toBe(true);
    expect(a.character.width).toBeGreaterThan(0.002);
    expect(a.character.fall).toBe("exponential");
    expect(a.warnings).toEqual([]);
    expect(a.advice.join(" ")).not.toContain("toy-like");
  });

  it("tells inharmonic metal (FM) from a harmonic buzz", () => {
    const p = (layer: Record<string, unknown>): SfxParams => ({ ...DEFAULTS, volume: 0.6, layers: [cleanLayer({ wave: "sine", hold: 0.3, decay: 0.2, ...layer })] });
    expect(report(p({ wave: "saw", freq: 220 })).character.harmonic).toBe(true);
    expect(report(p({ freq: 300, fm: 6, fmRatio: 1.41 })).character.harmonic).toBe(false);
  });

  it("measures the level a sound is heard at as the mix table does", () => {
    const short = render(PURPOSES.hit!.params);
    expect(heardLevel(short)).toBeCloseTo(analyse("x", short).loudDb, 5);
    const long = render(PURPOSES.explosion!.params);
    expect(heardLevel(long)).toBeCloseTo(analyse("x", long).lufs, 5);
  });

  it("reads a chip song's settings and says which tracks to give fuller voices, ducking and glue", () => {
    const song: Song = {
      version: 1, bpm: 120, stepsPerBeat: 4, length: 16,
      tracks: [
        { ...synthTrack("lead", "square"), notes: [{ step: 0, len: 4, pitch: 72, vel: 0.8 }] },
        { ...synthTrack("bass", "triangle"), notes: [0, 4, 8, 12].map((step) => ({ step, len: 2, pitch: 45, vel: 0.8 })) },
        { ...drumTrack(), notes: [0, 4, 8, 12].map((step) => ({ step, len: 1, pitch: 36, vel: 0.8 })) },
      ],
    };
    const a = analyse("music/x", renderSong(song), { loop: true, source: { song } });
    const text = a.advice.join("\n");
    expect(text).toContain('"lead", "bass" use the plain chip voice');
    expect(text).toContain('"bass": a triangle bass is the NES\'s bass');
    expect(text).toContain('"drums" uses the chip drum kit');
    expect(text).toContain("nothing makes room for the kick");
    expect(text).toContain("no glue on the mix");
    // a loop's make-up has no attack or tail
    expect(words(a)).toMatch(/make-up: noise [\d.]+ \(0 tone, 1 noise\), movement/);
    const parsed = parseSong(JSON.stringify(song));
    expect(parsed.ok).toBe(true);
  });
});
