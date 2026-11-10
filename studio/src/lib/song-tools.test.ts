import { describe, expect, it } from "vitest";
import { MAX_NOTES, newSong, parseSong, serializeSong, synthTrack, barSteps, type Song } from "./song";
import { noteKey } from "./song-edit";
import { addChord, addMarker, applyAutomation, glueNotes, humanizeTiming, humanizeVelocity, inScale, laneValue, lfoLane, markerAt, nearestInScale, regionOf, removeMarker, setBeatsPerBar, setLane, setLoop, snapToScale, strumNotes } from "./song-tools";

const song = (notes: { step: number; len: number; pitch: number; vel?: number }[], length = 32): Song => {
  const t = synthTrack("lead");
  t.notes = notes.map((n) => ({ vel: 0.8, ...n }));
  return { version: 1, bpm: 120, stepsPerBeat: 4, length, tracks: [t] };
};
const all = (s: Song) => new Set(s.tracks[0]!.notes.map(noteKey));
const steps = (s: Song) => s.tracks[0]!.notes.map((n) => `${n.step}:${n.pitch}:${n.len}`);

describe("strum, glue and humanise", () => {
  it("staggers a chord from the top down, and the late notes end with the chord", () => {
    const s = song([{ step: 0, len: 4, pitch: 60 }, { step: 0, len: 4, pitch: 64 }, { step: 0, len: 4, pitch: 67 }]);
    const r = strumNotes(s, 0, all(s), 1, true);
    expect(steps(r.song)).toEqual(["0:67:4", "1:64:3", "2:60:2"]);
    expect(steps(strumNotes(s, 0, all(s), 1, false).song)).toEqual(["0:60:4", "1:64:3", "2:67:2"]);
  });
  it("never strums a note away", () => {
    const s = song([{ step: 0, len: 1, pitch: 60 }, { step: 0, len: 1, pitch: 64 }]);
    expect(steps(strumNotes(s, 0, all(s), 2).song)).toEqual(["0:64:1", "0:60:1"].sort());
  });
  it("glues touching and overlapping notes of one pitch and leaves the others", () => {
    const s = song([{ step: 0, len: 2, pitch: 60 }, { step: 2, len: 2, pitch: 60 }, { step: 3, len: 4, pitch: 60 }, { step: 12, len: 2, pitch: 60 }, { step: 0, len: 2, pitch: 64 }]);
    expect(steps(glueNotes(s, 0, all(s)).song)).toEqual(["0:60:7", "0:64:2", "12:60:2"]);
  });
  it("varies loudness the same way for the same seed, inside 0.05 to 1", () => {
    const s = song([{ step: 0, len: 1, pitch: 60, vel: 0.5 }, { step: 4, len: 1, pitch: 60, vel: 1 }]);
    const a = humanizeVelocity(s, 0, all(s), 0.3, 7);
    const b = humanizeVelocity(s, 0, all(s), 0.3, 7);
    expect(a).toEqual(b);
    expect(a.tracks[0]!.notes[0]!.vel).not.toBe(0.5);
    expect(a.tracks[0]!.notes.every((n) => n.vel >= 0.05 && n.vel <= 1)).toBe(true);
  });
  it("loosens timing without leaving the song or stacking two notes", () => {
    const s = song([{ step: 0, len: 2, pitch: 60 }, { step: 1, len: 2, pitch: 60 }, { step: 31, len: 3, pitch: 62 }]);
    const r = humanizeTiming(s, 0, all(s), 2, 3);
    const keys = r.song.tracks[0]!.notes.map(noteKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(r.song.tracks[0]!.notes.every((n) => n.step >= 0 && n.step + n.len <= 32)).toBe(true);
  });
});

describe("scales and chords", () => {
  it("knows what is in a scale and the nearest note", () => {
    expect(inScale(61, 0, "major")).toBe(false);
    expect(inScale(64, 0, "major")).toBe(true);
    expect(inScale(66, 6, "major")).toBe(true);
    expect(nearestInScale(61, 0, "major")).toBe(60);
    expect(nearestInScale(63, 0, "major")).toBe(62);
  });
  it("snaps notes to a scale and merges those that land together", () => {
    const s = song([{ step: 0, len: 1, pitch: 61 }, { step: 0, len: 1, pitch: 60 }, { step: 4, len: 1, pitch: 66 }]);
    expect(steps(snapToScale(s, 0, all(s), 0, "major").song)).toEqual(["0:60:1", "4:65:1"]);
  });
  it("builds a chord on each chosen note, with an inversion, without repeating a note that is there", () => {
    const s = song([{ step: 0, len: 2, pitch: 60 }, { step: 0, len: 2, pitch: 67 }]);
    const r = addChord(s, 0, new Set([noteKey({ step: 0, pitch: 60 })]), "major")!;
    expect(r.song.tracks[0]!.notes.map((n) => n.pitch)).toEqual([60, 64, 67]);
    const inv = addChord(s, 0, new Set([noteKey({ step: 0, pitch: 60 })]), "major", 1)!;
    expect(inv.song.tracks[0]!.notes.map((n) => n.pitch)).toEqual([64, 67, 72]);
    expect(addChord(s, 0, new Set(), "major")).toBeNull();
    expect(addChord(s, 0, all(s), "no such")).toBeNull();
  });
  it("stops at the note limit", () => {
    const big = song(Array.from({ length: MAX_NOTES - 1 }, (_, i) => ({ step: i % 32, len: 1, pitch: (i % 100) + 1 })), 32);
    big.tracks[0]!.notes = big.tracks[0]!.notes.filter((n, i, a) => a.findIndex((m) => noteKey(m) === noteKey(n)) === i);
    const fill = song(Array.from({ length: MAX_NOTES }, (_, i) => ({ step: i % 1000, len: 1, pitch: Math.floor(i / 1000) + 20 })), 1000);
    expect(addChord(fill, 0, new Set([noteKey(fill.tracks[0]!.notes[0]!)]), "major")).toBeNull();
  });
});

describe("markers, loop and bars", () => {
  it("adds, renames at the same place, sorts and removes markers", () => {
    let s = addMarker(song([]), 16, "drop");
    s = addMarker(s, 0, "intro");
    s = addMarker(s, 16, "big drop");
    expect(s.markers).toEqual([{ step: 0, name: "intro" }, { step: 16, name: "big drop" }]);
    expect(markerAt(s, 16)?.name).toBe("big drop");
    expect(addMarker(s, 99, "x")).toBe(s);
    expect(removeMarker(removeMarker(s, 0), 16).markers).toBeUndefined();
  });
  it("keeps the loop inside the song and from before to", () => {
    expect(setLoop(song([]), { from: 8, to: 24 }).loop).toEqual({ from: 8, to: 24 });
    expect(setLoop(song([]), { from: 8, to: 4 }).loop).toEqual({ from: 8, to: 9 });
    expect(setLoop(song([]), { from: -5, to: 99 }).loop).toEqual({ from: 0, to: 32 });
    expect(setLoop(setLoop(song([]), { from: 1, to: 2 }), null).loop).toBeUndefined();
  });
  it("sets the bar length", () => {
    const s = setBeatsPerBar(song([]), 3);
    expect(barSteps(s)).toBe(12);
    expect(barSteps(setBeatsPerBar(s, 4))).toBe(16);
    expect(setBeatsPerBar(s, 4).beatsPerBar).toBeUndefined();
  });
  it("cuts a region into a song of its own", () => {
    const s = addMarker(song([{ step: 2, len: 4, pitch: 60 }, { step: 10, len: 3, pitch: 62 }, { step: 14, len: 8, pitch: 64 }, { step: 20, len: 2, pitch: 65 }]), 12, "b");
    const r = regionOf(s, 8, 16);
    expect(r.length).toBe(8);
    expect(steps(r)).toEqual(["2:62:3", "6:64:2"]);
    expect(r.markers).toEqual([{ step: 4, name: "b" }]);
    expect(steps(regionOf(s, 4, 16)).includes("0:60:2")).toBe(true); // a held note comes in cut at the start
  });
});

describe("automation", () => {
  const lane = { param: "gain" as const, curve: "linear" as const, points: [{ step: 0, value: 0 }, { step: 10, value: 1 }] };
  it("follows the points, by the curve", () => {
    expect(laneValue(lane, -3)).toBe(0);
    expect(laneValue(lane, 5)).toBeCloseTo(0.5);
    expect(laneValue(lane, 30)).toBe(1);
    expect(laneValue({ ...lane, curve: "step" }, 9)).toBe(0);
    expect(laneValue({ ...lane, curve: "smooth" }, 2.5)).toBeLessThan(0.25);
    expect(laneValue({ ...lane, points: [] }, 3)).toBe(1);
  });
  it("folds a lane into the notes' loudness", () => {
    const s = setLane(song([{ step: 0, len: 1, pitch: 60, vel: 1 }, { step: 5, len: 1, pitch: 60, vel: 1 }, { step: 10, len: 1, pitch: 60, vel: 0.5 }]), 0, lane);
    expect(applyAutomation(s).tracks[0]!.notes.map((n) => +n.vel.toFixed(2))).toEqual([0, 0.5, 0.5]);
    expect(applyAutomation(song([]))).toEqual(song([]));
  });
  it("makes an LFO lane that swings round 1", () => {
    const l = lfoLane(32, 8, 0.5, "sine");
    const vals = l.points.map((p) => p.value);
    expect(Math.max(...vals)).toBeLessThanOrEqual(1.5);
    expect(Math.min(...vals)).toBeGreaterThanOrEqual(0.5);
    expect(lfoLane(32, 8, 0.5, "square").curve).toBe("step");
  });
});

describe("the song file keeps all of it", () => {
  it("round-trips bars, markers, the loop, lanes and the master section, and refuses bad ones", () => {
    let s = newSong();
    s = setBeatsPerBar(s, 3);
    s = addMarker(s, 4, "verse");
    s = setLoop(s, { from: 4, to: 12 });
    s = setLane(s, 0, { param: "gain", curve: "smooth", points: [{ step: 0, value: 1 }, { step: 8, value: 0.5 }] });
    s = { ...s, master: { volume: 1, lufs: -14, limit: -1 } };
    const back = parseSong(serializeSong(s));
    if (!back.ok) throw new Error(back.error);
    expect(back.song.beatsPerBar).toBe(3);
    expect(back.song.markers).toEqual([{ step: 4, name: "verse" }]);
    expect(back.song.loop).toEqual({ from: 4, to: 12 });
    expect(back.song.tracks[0]!.automation![0]!.curve).toBe("smooth");
    expect(back.song.master).toEqual({ volume: 1, lufs: -14, limit: -1 });
    const bad = (patch: object) => parseSong(JSON.stringify({ ...JSON.parse(serializeSong(newSong())), ...patch })).ok;
    expect(bad({ beatsPerBar: 0 })).toBe(false);
    expect(bad({ loop: { from: 5, to: 5 } })).toBe(false);
    expect(bad({ markers: [{ step: 999, name: "x" }] })).toBe(false);
    expect(bad({ master: { volume: 1, lufs: 5 } })).toBe(false);
    expect(bad({ master: { volume: 1, limit: 3 } })).toBe(false);
  });
});

describe("rendering with a loudness target and a ceiling", () => {
  it("brings the song to the target loudness, and keeps its peaks under the ceiling", async () => {
    const { renderSong } = await import("./song");
    const { integratedLufs, peakDb } = await import("./loudness");
    const base = newSong();
    base.length = 32;
    const plain = renderSong(base, 22050);
    const quiet = renderSong({ ...base, master: { volume: 1, lufs: -26 } }, 22050);
    const target = integratedLufs(quiet.channels, 22050);
    expect(Math.abs(target - -26)).toBeLessThan(1);
    expect(integratedLufs(plain.channels, 22050)).not.toBeCloseTo(-26, 0);
    const limited = renderSong({ ...base, master: { volume: 1.5, limit: -6 } }, 22050);
    expect(peakDb(limited.channels)).toBeLessThanOrEqual(-6 + 0.1);
  });
  it("renders a lane's gain: a note lowered to nothing is silent", async () => {
    const { renderSong } = await import("./song");
    const s = song([{ step: 0, len: 4, pitch: 60, vel: 1 }], 8);
    const silent = setLane(s, 0, { param: "gain", curve: "linear", points: [{ step: 0, value: 0 }] });
    const sound = renderSong(silent, 22050);
    expect(Math.max(...sound.channels[0]!.map(Math.abs))).toBe(0);
    expect(Math.max(...renderSong(s, 22050).channels[0]!.map(Math.abs))).toBeGreaterThan(0.01);
  });
});

describe("effects on a track", () => {
  it("round-trip through the file, are refused when wrong, and change what is rendered", async () => {
    const { renderSong } = await import("./song");
    const { addFx, setFxParam } = await import("./fx");
    const s = song([{ step: 0, len: 4, pitch: 60, vel: 1 }, { step: 4, len: 4, pitch: 67, vel: 1 }], 16);
    let chain = addFx([], "distortion");
    chain = setFxParam(chain, 0, "drive", 25);
    s.tracks[0] = { ...s.tracks[0]!, fx: chain };
    const back = parseSong(serializeSong(s));
    if (!back.ok) throw new Error(back.error);
    expect(back.song.tracks[0]!.fx![0]!.params.drive).toBe(25);
    const bad = JSON.parse(serializeSong(s));
    bad.tracks[0].fx = [{ type: "reverb", params: {} }];
    expect(parseSong(JSON.stringify(bad)).ok).toBe(false);
    const dry = renderSong({ ...s, tracks: [{ ...s.tracks[0]!, fx: undefined }] }, 22050);
    const wet = renderSong(s, 22050);
    expect(wet.channels[0]).not.toEqual(dry.channels[0]);
    expect(Math.max(...wet.channels[0]!.map(Math.abs))).toBeGreaterThan(0.01);
    // a bypassed effect renders exactly as no effect
    const off = renderSong({ ...s, tracks: [{ ...s.tracks[0]!, fx: [{ ...chain[0]!, on: false }] }] }, 22050);
    expect(off.channels[0]).toEqual(dry.channels[0]);
  });
});
