import { describe, expect, it } from "vitest";
import { addNote, addTrack, changeNote, drumHit, drumTrack, envelope, midiFreq, newSong, noteAt, noteName, parseSong, removeNote, removeTrack, renderSong, serializeSong, setLength, setTempo, songSeconds, stepSeconds, synthTrack, transpose, updateTrack, type Song } from "./song";
import { frames, peak } from "./wav";

const empty = (over: Partial<Song> = {}): Song => ({ version: 1, bpm: 120, stepsPerBeat: 4, length: 16, tracks: [synthTrack("a")], ...over });
const energy = (c: Float32Array, a = 0, b = c.length) => c.slice(a, b).reduce((s, x) => s + x * x, 0);
const crossings = (c: Float32Array) => c.reduce((n, x, i) => (i > 0 && (c[i - 1]! < 0) !== (x < 0) ? n + 1 : n), 0);

describe("pitch and timing", () => {
  it("maps MIDI notes to frequencies and names", () => {
    expect(midiFreq(69)).toBe(440);
    expect(midiFreq(57)).toBe(220);
    expect(midiFreq(60)).toBeCloseTo(261.63, 1);
    expect(noteName(60)).toBe("C4");
    expect(noteName(61)).toBe("C#4");
    expect(noteName(36)).toBe("C2");
  });
  it("derives step and song length from the tempo", () => {
    const s = empty();
    expect(stepSeconds(s)).toBe(0.125);
    expect(songSeconds(s)).toBe(2);
    expect(songSeconds(empty({ bpm: 60, length: 8 }))).toBe(2);
  });
});

describe("envelope", () => {
  it("rises, decays to the sustain level, holds, then releases to silence", () => {
    expect(envelope(0, 1, 0.1, 0.1, 0.5, 0.2)).toBe(0);
    expect(envelope(0.05, 1, 0.1, 0.1, 0.5, 0.2)).toBeCloseTo(0.5);
    expect(envelope(0.1, 1, 0.1, 0.1, 0.5, 0.2)).toBeCloseTo(1);
    expect(envelope(0.5, 1, 0.1, 0.1, 0.5, 0.2)).toBe(0.5);
    expect(envelope(1.1, 1, 0.1, 0.1, 0.5, 0.2)).toBeCloseTo(0.25);
    expect(envelope(1.3, 1, 0.1, 0.1, 0.5, 0.2)).toBe(0);
    expect(envelope(0, 1, 0, 0, 1, 0)).toBe(1);
  });
});

describe("rendering", () => {
  it("lasts exactly the song and starts notes on their step", () => {
    const s = empty();
    s.tracks[0] = { ...synthTrack("a", "sine"), attack: 0, release: 0, sustain: 1, notes: [{ step: 8, len: 4, pitch: 69, vel: 1 }] };
    const out = renderSong(s, 8000);
    expect(frames(out)).toBe(16000);
    const l = out.channels[0]!;
    expect(energy(l, 0, 7900)).toBe(0); // nothing before step 8 (1 s)
    expect(energy(l, 8100, 8800)).toBeGreaterThan(10);
    expect(energy(l, 12100, 16000)).toBe(0); // the note ended after 4 steps
  });

  it("plays the right pitch", () => {
    const s = empty({ length: 32 });
    s.tracks[0] = { ...synthTrack("a", "sine"), attack: 0, release: 0, sustain: 1, notes: [{ step: 0, len: 32, pitch: 69, vel: 1 }] };
    const l = renderSong(s, 8000).channels[0]!.slice(0, 8000); // the first second
    expect(crossings(l)).toBeGreaterThan(870);
    expect(crossings(l)).toBeLessThan(890);
  });

  it("wraps a tail that runs past the end onto the start for seamless loops", () => {
    const s = empty({ length: 4 });
    s.tracks[0] = { ...synthTrack("a", "square"), attack: 0, decay: 0, sustain: 1, release: 0.5, notes: [{ step: 3, len: 1, pitch: 60, vel: 1 }] };
    const out = renderSong(s, 8000);
    expect(energy(out.channels[0]!, 0, 1000)).toBeGreaterThan(1); // the release continues at the start
  });

  it("is deterministic, stereo, in range, and honours volume, pan and mute", () => {
    const a = renderSong(newSong(), 8000);
    const b = renderSong(newSong(), 8000);
    expect(Array.from(a.channels[0]!)).toEqual(Array.from(b.channels[0]!));
    expect(a.channels).toHaveLength(2);
    expect(peak(a)).toBeLessThanOrEqual(0.97 + 1e-6);
    expect(peak(a)).toBeGreaterThan(0.1);
    const quiet = newSong();
    quiet.tracks[0] = { ...quiet.tracks[0]!, volume: 0.1 };
    quiet.tracks[1] = { ...quiet.tracks[1]!, mute: true };
    expect(peak(renderSong(quiet, 8000))).toBeLessThan(peak(a));
    const left = newSong();
    left.tracks = [{ ...left.tracks[0]!, pan: -1 }];
    const l = renderSong(left, 8000);
    expect(energy(l.channels[0]!)).toBeGreaterThan(1);
    expect(energy(l.channels[1]!)).toBeLessThan(1e-6);
    const allMuted = newSong();
    allMuted.tracks.forEach((t) => (t.mute = true));
    expect(peak(renderSong(allMuted, 8000))).toBe(0);
  });

  it("scales a loud mix down instead of clipping", () => {
    const s = empty({ length: 4 });
    s.tracks = Array.from({ length: 8 }, (_, i) => ({ ...synthTrack(`t${i}`), volume: 1, attack: 0, release: 0, sustain: 1, notes: [{ step: 0, len: 4, pitch: 60, vel: 1 }] }));
    expect(peak(renderSong(s, 8000))).toBeCloseTo(0.97, 2);
  });
});

describe("drums", () => {
  it("every drum makes sound that dies away, and the kick is low", () => {
    for (const p of [36, 38, 39, 42, 45, 46, 49, 99]) {
      const hit = drumHit(p, 8000);
      expect(energy(hit), `drum ${p}`).toBeGreaterThan(0.01);
      expect(Math.max(...Array.from(hit).map(Math.abs)), `drum ${p}`).toBeLessThan(2);
      expect(energy(hit, hit.length - 20), `drum ${p} tail`).toBeLessThan(energy(hit) * 0.01);
    }
    expect(crossings(drumHit(36, 8000))).toBeLessThan(crossings(drumHit(42, 8000)));
    expect(Array.from(drumHit(38, 8000))).toEqual(Array.from(drumHit(38, 8000)));
  });
});

describe("files", () => {
  it("round-trips and gives the same song back", () => {
    const text = serializeSong(newSong());
    const parsed = parseSong(text);
    expect(parsed).toEqual({ ok: true, song: newSong() });
    expect(serializeSong((parsed as { song: Song }).song)).toBe(text);
    expect(text.endsWith("}\n")).toBe(true);
  });

  it("explains bad files", () => {
    expect(parseSong("{ x")).toMatchObject({ ok: false });
    expect(parseSong("{}")).toMatchObject({ error: 'a song file has a "tracks" list' });
    const bad = (m: (d: any) => void) => {
      const d = JSON.parse(serializeSong(newSong()));
      m(d);
      return parseSong(JSON.stringify(d));
    };
    expect(bad((d) => (d.bpm = 5))).toMatchObject({ error: '"bpm" must be from 40 to 240' });
    expect(bad((d) => (d.length = 0.5))).toMatchObject({ ok: false });
    expect(bad((d) => (d.tracks[0].kind = "piano"))).toMatchObject({ error: 'tracks[0].kind must be "synth" or "drums"' });
    expect(bad((d) => (d.tracks[0].wave = "tuba"))).toMatchObject({ ok: false });
    expect(bad((d) => (d.tracks[0].notes[0].len = 0))).toMatchObject({ error: expect.stringContaining("tracks[0].notes[0]") });
    expect(bad((d) => delete d.tracks[1].duty)).toMatchObject({ ok: true }); // missing optional fields get defaults
  });
});

describe("editing", () => {
  it("adds notes, replacing overlaps at the same pitch, keeping them sorted and inside the song", () => {
    let s = empty();
    s = addNote(s, 0, { step: 4, len: 4, pitch: 60, vel: 1 }).song;
    s = addNote(s, 0, { step: 0, len: 2, pitch: 64, vel: 1 }).song;
    expect(s.tracks[0]!.notes.map((n) => n.step)).toEqual([0, 4]);
    const over = addNote(s, 0, { step: 6, len: 4, pitch: 60, vel: 0.5 });
    expect(over.song.tracks[0]!.notes.filter((n) => n.pitch === 60).map((n) => [n.step, n.len])).toEqual([[6, 4]]);
    expect(over.song.tracks[0]!.notes[over.index]).toMatchObject({ step: 6, pitch: 60 });
    const clipped = addNote(s, 0, { step: 14, len: 9, pitch: 50, vel: 1 });
    expect(clipped.song.tracks[0]!.notes.at(-1)!.len).toBe(2);
    expect(addNote(s, 0, { step: 16, len: 1, pitch: 60, vel: 1 }).index).toBe(-1);
    expect(addNote(s, 5, { step: 0, len: 1, pitch: 60, vel: 1 }).index).toBe(-1);
    expect(noteAt(s.tracks[0]!, 5, 60)).toBeGreaterThanOrEqual(0);
    expect(noteAt(s.tracks[0]!, 8, 60)).toBe(-1);
  });

  it("moves, resizes, removes and transposes", () => {
    let s = addNote(empty(), 0, { step: 0, len: 2, pitch: 60, vel: 1 }).song;
    const moved = changeNote(s, 0, 0, { step: 5, pitch: 62 });
    expect(moved.song.tracks[0]!.notes[moved.index]).toMatchObject({ step: 5, len: 2, pitch: 62 });
    expect(changeNote(s, 0, 0, { len: 0 }).song).toBe(s);
    expect(changeNote(s, 0, 0, { step: 99 }).song).toBe(s);
    expect(removeNote(s, 0, 0).tracks[0]!.notes).toEqual([]);
    expect(removeNote(s, 0, 9)).toBe(s);
    expect(transpose(s, 0, 12).tracks[0]!.notes[0]!.pitch).toBe(72);
    expect(transpose(s, 0, 999).tracks[0]!.notes[0]!.pitch).toBe(127);
    const d = { ...s, tracks: [drumTrack()] };
    expect(transpose(d, 0, 5)).toBe(d);
  });

  it("changes tempo and length, trimming notes that no longer fit", () => {
    let s = addNote(addNote(empty(), 0, { step: 2, len: 8, pitch: 60, vel: 1 }).song, 0, { step: 12, len: 2, pitch: 62, vel: 1 }).song;
    expect(setTempo(s, 999).bpm).toBe(240);
    expect(setTempo(s, 10).bpm).toBe(40);
    s = setLength(s, 8);
    expect(s.length).toBe(8);
    expect(s.tracks[0]!.notes).toEqual([{ step: 2, len: 6, pitch: 60, vel: 1 }]);
    expect(setLength(s, 99999).length).toBe(1024);
    expect(setLength(s, 0).length).toBe(1);
  });

  it("manages tracks: unique names, a last track that cannot be removed, clamped settings", () => {
    let s = newSong();
    s = addTrack(s, "synth", "triangle");
    s = addTrack(s, "synth", "triangle");
    s = addTrack(s, "drums");
    expect(s.tracks.map((t) => t.name)).toEqual(["lead", "drums", "bass", "bass2", "drums2"]);
    expect(removeTrack(s, 0).tracks).toHaveLength(4);
    expect(removeTrack(removeTrack(removeTrack(removeTrack(s, 0), 0), 0), 0).tracks).toHaveLength(1);
    const u = updateTrack(s, 0, { volume: 9, pan: -9, duty: 0, sustain: 4, name: "  " });
    expect(u.tracks[0]).toMatchObject({ volume: 1, pan: -1, duty: 0.05, sustain: 1, name: "lead" });
    expect(updateTrack(s, 99, { volume: 0 })).toBe(s);
  });
});
