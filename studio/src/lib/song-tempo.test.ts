import { describe, expect, it } from "vitest";
import { barStarts, bpmAt, parseSong, renderSong, serializeSong, stepAtTime, stepTime, songSeconds, synthTrack, type Song } from "./song";
import { regionOf, setMeterAt, setTempoAt } from "./song-tools";
import { songToMidi, midiToSong } from "./midi";

const song = (over: Partial<Song> = {}): Song => ({ version: 1, bpm: 120, stepsPerBeat: 4, length: 32, tracks: [{ ...synthTrack("a", "sine"), notes: [{ step: 0, len: 2, pitch: 69, vel: 1 }, { step: 16, len: 2, pitch: 69, vel: 1 }] }], ...over });
const firstSound = (c: Float32Array, from = 0) => { for (let i = from; i < c.length; i++) if (Math.abs(c[i]!) > 0.01) return i; return -1; };

describe("the tempo track", () => {
  it("times steps through the changes and inverts that", () => {
    const s = song({ tempos: [{ step: 16, bpm: 60 }] });
    expect(bpmAt(s, 0)).toBe(120);
    expect(bpmAt(s, 16)).toBe(60);
    expect(stepTime(s, 16)).toBeCloseTo(2, 9); // 16 steps at 125 ms
    expect(stepTime(s, 32)).toBeCloseTo(2 + 16 * 0.25, 9); // then 250 ms a step
    expect(songSeconds(s)).toBeCloseTo(6, 9);
    for (const step of [0, 5, 16, 20.5, 31]) expect(stepAtTime(s, stepTime(s, step))).toBeCloseTo(step, 9);
  });
  it("a song with no changes keeps its exact timing", () => {
    expect(songSeconds(song())).toBe(32 * 0.125);
    expect(stepTime(song(), 7)).toBe(7 * 0.125);
  });
  it("the render is longer after a slowdown and the late note starts where the tempo says", () => {
    const fast = renderSong(song(), 8000).channels[0]!;
    const slow = renderSong(song({ tempos: [{ step: 8, bpm: 60 }] }), 8000).channels[0]!;
    expect(fast.length).toBe(32000);
    expect(slow.length).toBe(Math.round(songSeconds(song({ tempos: [{ step: 8, bpm: 60 }] })) * 8000));
    // note 2 is at step 16: 8 steps at 125 ms then 8 at 250 ms = 3 s
    const at = firstSound(slow, 8000 * 2.5);
    expect(at / 8000).toBeGreaterThan(2.99);
    expect(at / 8000).toBeLessThan(3.05);
  });
  it("is edited, kept in order and cleaned of repeats", () => {
    let s = setTempoAt(song(), 16, 90);
    s = setTempoAt(s, 8, 100);
    expect(s.tempos).toEqual([{ step: 8, bpm: 100 }, { step: 16, bpm: 90 }]);
    expect(setTempoAt(s, 8, 120).tempos).toEqual([{ step: 16, bpm: 90 }]); // same as before it: dropped
    expect(setTempoAt(setTempoAt(s, 8, null), 16, null).tempos).toBeUndefined();
    expect(setTempoAt(s, 0, 150).bpm).toBe(150);
    expect(setTempoAt(s, 99, 150)).toBe(s);
  });
  it("is saved, checked, and carried into an exported loop", () => {
    const s = song({ tempos: [{ step: 8, bpm: 90 }, { step: 24, bpm: 150 }], meters: [{ step: 16, beats: 3 }] });
    const back = parseSong(serializeSong(s));
    expect(back.ok && back.song).toEqual(s);
    for (const bad of [[{ step: 8, bpm: 90 }, { step: 8, bpm: 100 }], [{ step: 0, bpm: 90 }], [{ step: 40, bpm: 90 }], [{ step: 4, bpm: 900 }]]) {
      expect(parseSong(JSON.stringify({ ...s, tempos: bad })).ok).toBe(false);
    }
    const part = regionOf(s, 8, 32);
    expect(part.bpm).toBe(90);
    expect(part.tempos).toEqual([{ step: 16, bpm: 150 }]);
    expect(part.meters).toEqual([{ step: 8, beats: 3 }]);
  });
  it("goes through a MIDI file", () => {
    const s = song({ tempos: [{ step: 16, bpm: 90 }] });
    const back = midiToSong(songToMidi(s));
    expect(back.song.bpm).toBe(120);
    expect(back.song.tempos).toEqual([{ step: 16, bpm: 90 }]);
  });
});

describe("time signature changes", () => {
  it("move the bar lines", () => {
    expect(barStarts(song())).toEqual([0, 16]);
    expect(barStarts(song({ length: 24, meters: [{ step: 16, beats: 2 }] }))).toEqual([0, 16]);
    // 4 beats (16 steps), then 3 beats (12 steps) from step 16: bars at 0, 16, 28
    expect(barStarts(song({ meters: [{ step: 16, beats: 3 }] }))).toEqual([0, 16, 28]);
    // a change that lands part-way through a bar starts a new bar there
    expect(barStarts(song({ meters: [{ step: 10, beats: 2 }] }))).toEqual([0, 10, 18, 26]);
  });
  it("are set and taken away", () => {
    let s = setMeterAt(song(), 16, 3);
    expect(s.meters).toEqual([{ step: 16, beats: 3 }]);
    s = setMeterAt(s, 16, null);
    expect(s.meters).toBeUndefined();
    expect(setMeterAt(song(), 0, 3).meters).toBeUndefined();
  });
});
