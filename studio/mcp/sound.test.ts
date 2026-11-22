// sound_report's make-up and advice: what an agent who cannot listen is told about a thin or toy-like sound.
import { describe, expect, it } from "vitest";
import { DEFAULTS, fromJson, render, toJson, type SfxParams } from "../src/lib/sfx";
import { cleanLayer } from "../src/lib/sfx-layers";
import { drumTrack, parseSong, renderSong, synthTrack, type Song } from "../src/lib/song";
import { analyse, describe as words, heardLevel } from "./sound";
import { PURPOSES, purposeParams } from "./makers/sound";

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

  it("writes every purpose and variant so that its file renders back to the same sound", () => {
    for (const name of Object.keys(PURPOSES)) {
      for (const seed of [1, 2, 3]) {
        const p = purposeParams(name, seed);
        const back = fromJson(toJson(p))!;
        expect(toJson(back), `${name} ${seed}`).toBe(toJson(p));
        expect(render(back).channels[0], `${name} ${seed}`).toEqual(render(p).channels[0]);
      }
    }
  });

  it("warns when most of a sound is below what a handheld's speaker plays, and not when a knock carries it", () => {
    const layered = (layers: Record<string, unknown>[]): SfxParams => ({ ...DEFAULTS, volume: 0.8, layers: layers.map((l) => cleanLayer({ hold: 0.05, decay: 0.3, ...l })) });
    const sub = analyse("x", render(layered([{ wave: "sine", freq: 110, pitch: 12 }])), { source: { sfx: layered([{ wave: "sine", freq: 110, pitch: 12 }]) } });
    expect(sub.speaker.below).toBeGreaterThan(0.9);
    expect(sub.speaker.lossDb).toBeGreaterThan(6);
    expect(sub.warnings.join(" ")).toMatch(/most of the energy \(\d+ %\) is below 200 Hz, under what a handheld's or a phone's speaker plays: .* Add harmonics or a layer an octave up/);
    const knock = layered([{ wave: "sine", freq: 60, pitch: 12, volume: 0.3 }, { wave: "triangle", freq: 180, pitch: 12, filter: "lowpass", cutoff: 1400, volume: 0.6 }]);
    const ok = analyse("x", render(knock), { source: { sfx: knock } });
    expect(ok.speaker.below).toBeLessThan(0.6);
    expect(ok.warnings.join(" ")).not.toContain("below 200 Hz");
    expect(words(ok)).toMatch(/on a small speaker \(a handheld's or a phone's, little below 200 Hz\): \d+ % of the energy/);
  });

  it("judges a song with an intro at its loop's start, and warns when a loop is short", () => {
    const bar = (from: number) => [0, 4, 8, 12].map((s) => ({ step: from + s, len: 4, pitch: 57, vel: 0.8 }));
    const intro: Song = {
      version: 1, bpm: 120, stepsPerBeat: 4, length: 64, loop: { from: 16, to: 64 },
      // (the intro is a different, quieter note than the loop: judged from the top, the seam would not match)
      tracks: [{ ...synthTrack("pad", "saw"), attack: 0.01, sustain: 1, release: 0.05, notes: [{ step: 0, len: 12, pitch: 69, vel: 0.3 }, ...bar(16), ...bar(32), ...bar(48)] }],
    };
    const a = analyse("music/x", renderSong(intro), { loop: true, source: { song: intro } });
    expect(a.seam?.ok).toBe(true);
    expect(a.warnings.some((w) => w.startsWith("it loops every"))).toBe(false); // (6 s: under 10 s, a sting, left alone)
    const long: Song = { ...intro, length: 512, loop: { from: 16, to: 512 }, tracks: [{ ...intro.tracks[0]!, notes: Array.from({ length: 31 }, (_, i) => bar(16 + i * 16)).flat() }] };
    const b = analyse("music/y", renderSong(long), { loop: true, source: { song: long } });
    expect(b.warnings.some((w) => w.startsWith("it loops every"))).toBe(false); // (62 s: long enough)
    const mid: Song = { ...long, length: 256, loop: { from: 16, to: 256 }, tracks: [{ ...intro.tracks[0]!, notes: Array.from({ length: 15 }, (_, i) => bar(16 + i * 16)).flat() }] };
    const c = analyse("music/z", renderSong(mid), { loop: true, source: { song: mid } });
    expect(c.warnings.join(" ")).toMatch(/it loops every 30 s: under about 45 s/);
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
