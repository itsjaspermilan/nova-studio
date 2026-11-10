import { describe, expect, it } from "vitest";
import { addClip, deleteClip, deletePattern, duplicateClip, flattenTrack, makePattern, moveClip, renamePattern, resizeClip, setPatternNotes, splitClip, unpackClip } from "./song-arrange";
import { clipNotes, expandClips, parseSong, renderSong, serializeSong, synthTrack, type Song } from "./song";
import { songToMidi, midiToSong } from "./midi";

const base = (): Song => ({
  version: 1, bpm: 120, stepsPerBeat: 4, length: 32,
  tracks: [{ ...synthTrack("a", "sine"), notes: [{ step: 0, len: 2, pitch: 60, vel: 1 }, { step: 4, len: 2, pitch: 64, vel: 1 }, { step: 20, len: 1, pitch: 72, vel: 1 }] }],
});
const withPattern = () => makePattern(base(), 0, 0, 8, "riff")!.song;

describe("patterns and clips", () => {
  it("makes a pattern from the notes in a span and leaves a clip where they were", () => {
    const r = makePattern(base(), 0, 0, 8, "riff")!;
    const t = r.song.tracks[0]!;
    expect(r.name).toBe("riff");
    expect(t.notes.map((n) => n.step)).toEqual([20]);
    expect(t.patterns![0]).toMatchObject({ name: "riff", length: 8 });
    expect(t.patterns![0]!.notes.map((n) => n.step)).toEqual([0, 4]);
    expect(t.clips).toEqual([{ pattern: "riff", step: 0, len: 8 }]);
    expect(makePattern(base(), 0, 8, 16)).toBeNull(); // no notes there
    expect(makePattern(r.song, 0, 20, 24, "riff")!.name).toBe("riff2");
  });
  it("sounds the same as the notes it came from, and a longer clip repeats it", () => {
    const original = renderSong(base(), 8000).channels[0]!;
    const packed = renderSong(withPattern(), 8000).channels[0]!;
    expect(packed.length).toBe(original.length);
    for (let i = 0; i < original.length; i += 331) expect(packed[i]).toBeCloseTo(original[i]!, 6);
    const looped = resizeClip(withPattern(), 0, 0, 24);
    expect(clipNotes(looped.tracks[0]!, looped.tracks[0]!.clips![0]!, 32).map((n) => n.step)).toEqual([0, 4, 8, 12, 16, 20]);
  });
  it("cuts the repeats at the clip's end and the song's, notes included", () => {
    let s = withPattern();
    s = resizeClip(s, 0, 0, 6); // the second note (steps 4 to 6) fits, a third repeat does not start
    expect(expandClips(s).tracks[0]!.notes.filter((n) => n.step < 8).map((n) => [n.step, n.len])).toEqual([[0, 2], [4, 2]]);
    s = resizeClip(s, 0, 0, 5);
    expect(clipNotes(s.tracks[0]!, s.tracks[0]!.clips![0]!, 32).map((n) => [n.step, n.len])).toEqual([[0, 2], [4, 1]]);
  });
  it("splits a clip so the second part carries on from where the first stopped", () => {
    let s = resizeClip(withPattern(), 0, 0, 16);
    const whole = clipNotes(s.tracks[0]!, s.tracks[0]!.clips![0]!, 32).map((n) => n.step);
    s = splitClip(s, 0, 0, 6);
    const clips = s.tracks[0]!.clips!;
    expect(clips.map((c) => [c.step, c.len, c.offset ?? 0])).toEqual([[0, 6, 0], [6, 10, 6]]);
    const parts = clips.flatMap((c) => clipNotes(s.tracks[0]!, c, 32)).map((n) => n.step).sort((a, b) => a - b);
    // the note at step 4 (len 2) ends exactly at the cut; everything else lines up with the unsplit clip
    expect(parts).toEqual(whole);
    expect(splitClip(s, 0, 0, 0)).toBe(s); // not inside the clip
  });
  it("moves, duplicates, mutes, deletes and keeps clips in order", () => {
    let s = withPattern();
    s = duplicateClip(s, 0, 0);
    expect(s.tracks[0]!.clips!.map((c) => c.step)).toEqual([0, 8]);
    s = moveClip(s, 0, 0, 24);
    expect(s.tracks[0]!.clips!.map((c) => [c.step, c.len])).toEqual([[8, 8], [24, 8]]);
    s = moveClip(s, 0, 1, 30); // cut at the song's end
    expect(s.tracks[0]!.clips![1]).toMatchObject({ step: 30, len: 2 });
    s = deleteClip(s, 0, 0);
    expect(s.tracks[0]!.clips!.length).toBe(1);
    expect(expandClips(s).tracks[0]!.notes.some((n) => n.step === 30)).toBe(true);
  });
  it("a muted clip is silent", () => {
    const s = withPattern();
    const muted = { ...s, tracks: [{ ...s.tracks[0]!, notes: [], clips: [{ ...s.tracks[0]!.clips![0]!, mute: true }] }] };
    expect(Math.max(...renderSong(muted, 8000).channels[0]!.map(Math.abs))).toBe(0);
  });
  it("unpacks a clip into notes and flattens a track", () => {
    const s = withPattern();
    const u = unpackClip(s, 0, 0)!;
    expect(u.tracks[0]!.clips).toBeUndefined();
    expect(u.tracks[0]!.notes.map((n) => n.step)).toEqual([0, 4, 20]);
    const f = flattenTrack(resizeClip(s, 0, 0, 16), 0)!;
    expect(f.tracks[0]!.patterns).toBeUndefined();
    expect(f.tracks[0]!.notes.map((n) => n.step)).toEqual([0, 4, 8, 12, 20]);
  });
  it("renames, edits and deletes patterns, taking the clips with them", () => {
    let s = renamePattern(withPattern(), 0, "riff", "verse");
    expect(s.tracks[0]!.clips![0]!.pattern).toBe("verse");
    s = setPatternNotes(s, 0, "verse", [{ step: 1, len: 20, pitch: 67, vel: 1 }, { step: 9, len: 1, pitch: 60, vel: 1 }]);
    expect(s.tracks[0]!.patterns![0]!.notes).toEqual([{ step: 1, len: 7, pitch: 67, vel: 1 }]);
    expect(renamePattern(s, 0, "verse", "  ")).toBe(s);
    s = deletePattern(s, 0, "verse");
    expect(s.tracks[0]!.patterns).toBeUndefined();
    expect(s.tracks[0]!.clips).toBeUndefined();
    expect(addClip(s, 0, "verse", 0)).toBe(s);
  });
  it("is saved and checked; a clip of a pattern that is missing is refused", () => {
    const s = resizeClip(withPattern(), 0, 0, 16);
    const back = parseSong(serializeSong(s));
    expect(back.ok && back.song).toEqual(s);
    const bad = JSON.parse(serializeSong(s));
    bad.tracks[0].clips[0].pattern = "nope";
    expect(parseSong(JSON.stringify(bad)).ok).toBe(false);
    const bad2 = JSON.parse(serializeSong(s));
    bad2.tracks[0].patterns[0].notes[0].step = 99;
    expect(parseSong(JSON.stringify(bad2)).ok).toBe(false);
  });
  it("goes out in a MIDI file as the notes it plays", () => {
    const s = resizeClip(withPattern(), 0, 0, 16);
    const back = midiToSong(songToMidi(s));
    expect(back.song.tracks[0]!.notes.map((n) => n.step)).toEqual([0, 4, 8, 12, 20]);
  });
});
