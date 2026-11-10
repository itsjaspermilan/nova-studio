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
    bad.tracks[0].fx = [{ type: "vocoder", params: {} }];
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

describe("the instruments: FM, plucked string, organ and the presets", () => {
  const play = async (patch: Record<string, unknown>) => {
    const { renderSong } = await import("./song");
    const s = song([{ step: 0, len: 4, pitch: 57, vel: 1 }], 8);
    s.tracks[0] = { ...s.tracks[0]!, ...patch } as typeof s.tracks[0];
    return renderSong(s, 22050).channels[0]!;
  };
  const rms = (x: Float32Array, a = 0, b = x.length) => Math.sqrt(x.slice(a, b).reduce((s, v) => s + v * v, 0) / (b - a));
  it("each makes sound, the same every time, and rings out", async () => {
    for (const wave of ["fm", "pluck", "organ"] as const) {
      const a = await play({ wave });
      const b = await play({ wave });
      expect(rms(a, 0, 4000), wave).toBeGreaterThan(0.01);
      expect(a, wave).toEqual(b);
      expect(Array.from(a).every(Number.isFinite), wave).toBe(true);
    }
  });
  it("a plucked string fades, and a longer damping rings longer", async () => {
    const short = await play({ wave: "pluck", damping: 0.1, sustain: 1, attack: 0.001, release: 0.5 });
    const long = await play({ wave: "pluck", damping: 1, sustain: 1, attack: 0.001, release: 0.5 });
    expect(rms(short, 400, 2400)).toBeGreaterThan(rms(short, 8000, 10000));
    expect(rms(long, 8000, 10000)).toBeGreaterThan(rms(short, 8000, 10000));
  });
  it("FM with more bend has more high-frequency energy than a plain sine", async () => {
    const roughness = (x: Float32Array) => { let s = 0; for (let i = 1; i < 6000; i++) s += Math.abs(x[i]! - x[i - 1]!); return s / 6000; };
    const plain = await play({ wave: "fm", fmIndex: 0, fmRatio: 2 });
    const bent = await play({ wave: "fm", fmIndex: 9, fmRatio: 3.5 });
    expect(roughness(bent)).toBeGreaterThan(roughness(plain) * 1.3);
  });
  it("the settings are saved and checked, and a preset sets what it names", async () => {
    const { INSTRUMENT_PRESETS } = await import("./song");
    const s = song([], 8);
    s.tracks[0] = { ...s.tracks[0]!, wave: "fm", fmRatio: 3, fmIndex: 4, damping: 0.5, brightness: 0.2 };
    const back = parseSong(serializeSong(s));
    if (!back.ok) throw new Error(back.error);
    expect(back.song.tracks[0]).toMatchObject({ wave: "fm", fmRatio: 3, fmIndex: 4, damping: 0.5, brightness: 0.2 });
    const bad = JSON.parse(serializeSong(s));
    bad.tracks[0].fmRatio = 99;
    const clamped = parseSong(JSON.stringify(bad));
    expect(clamped.ok && clamped.song.tracks[0]!.fmRatio).toBe(8);
    bad.tracks[0].wave = "theremin";
    expect(parseSong(JSON.stringify(bad)).ok).toBe(false);
    expect(INSTRUMENT_PRESETS.length).toBeGreaterThanOrEqual(6);
    for (const p of INSTRUMENT_PRESETS) expect(Object.keys(p.set).length, p.name).toBeGreaterThan(2);
  });
});

describe("a colour for a track", () => {
  it("is saved, read back lower case, and refused when it is not a colour", async () => {
    const { updateTrack } = await import("./song");
    const s = updateTrack(song([], 8), 0, { color: "#5AA9FF" });
    const back = parseSong(serializeSong(s));
    expect(back.ok && back.song.tracks[0]!.color).toBe("#5aa9ff");
    const bad = JSON.parse(serializeSong(s));
    bad.tracks[0].color = "blue";
    expect(parseSong(JSON.stringify(bad)).ok).toBe(false);
    expect(serializeSong(updateTrack(s, 0, { color: undefined }))).not.toContain("color");
  });
});

describe("note pan and bend", () => {
  it("sets and clears them on the picked notes only", async () => {
    const { setNoteProps } = await import("./song-tools");
    const s: Song = { version: 1, bpm: 120, stepsPerBeat: 4, length: 16, tracks: [{ ...synthTrack("a"), notes: [{ step: 0, len: 2, pitch: 60, vel: 1 }, { step: 4, len: 2, pitch: 62, vel: 1 }] }] };
    const a = setNoteProps(s, 0, new Set(["0:60"]), { pan: 2, bend: -3 });
    expect(a.tracks[0]!.notes[0]).toMatchObject({ pan: 1, bend: -3 });
    expect(a.tracks[0]!.notes[1]!.pan).toBeUndefined();
    const b = setNoteProps(a, 0, new Set(["0:60"]), { pan: 0, bend: 0 });
    expect(b.tracks[0]!.notes[0]).toEqual({ step: 0, len: 2, pitch: 60, vel: 1 });
  });
});

describe("tap tempo", () => {
  it("averages the gaps, keeps the last eight taps, and a long pause starts again", async () => {
    const { tapTempo } = await import("./song-tools");
    expect(tapTempo([])).toBeNull();
    expect(tapTempo([100])).toBeNull();
    expect(tapTempo([0, 500, 1000, 1500])).toBe(120);
    expect(tapTempo([0, 600, 1200])).toBe(100);
    expect(tapTempo([0, 1000, 2000, 10000, 10500, 11000])).toBe(120); // the pause cut the slow taps off
    expect(tapTempo([0, 10])).toBe(240); // too fast: held to the top tempo
    expect(tapTempo([0, 2400])).toBe(40);
    expect(tapTempo([0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4020])).toBeGreaterThan(100);
  });
});

describe("a pan lane and drawing lanes", () => {
  const mk = (): Song => ({ version: 1, bpm: 120, stepsPerBeat: 4, length: 16, tracks: [{ ...synthTrack("a", "sine"), notes: [{ step: 0, len: 2, pitch: 69, vel: 1 }, { step: 8, len: 2, pitch: 69, vel: 1 }] }] });
  it("a track has one lane of each kind and setting one leaves the other", async () => {
    const { setLane, setLanePoint } = await import("./song-tools");
    let s = setLanePoint(mk(), 0, "gain", 4, 0.5);
    s = setLanePoint(s, 0, "pan", 4, -0.5);
    expect(s.tracks[0]!.automation!.map((l) => l.param).sort()).toEqual(["gain", "pan"]);
    s = setLane(s, 0, null, "gain");
    expect(s.tracks[0]!.automation!.map((l) => l.param)).toEqual(["pan"]);
    expect(setLane(s, 0, null, "pan").tracks[0]!.automation).toBeUndefined();
  });
  it("drawing puts points in order, replaces one on the same step and holds the value to the range", async () => {
    const { setLanePoint } = await import("./song-tools");
    let s = setLanePoint(mk(), 0, "pan", 8, 3);
    s = setLanePoint(s, 0, "pan", 2, -3);
    s = setLanePoint(s, 0, "pan", 8, 0.25);
    const l = s.tracks[0]!.automation![0]!;
    expect(l.points).toEqual([{ step: 2, value: -1 }, { step: 8, value: 0.25 }]);
    expect(setLanePoint(s, 0, "gain", 99, 9).tracks[0]!.automation!.find((x) => x.param === "gain")!.points[0]).toEqual({ step: 16, value: 2 });
  });
  it("a pan lane moves each note to its side, added to its own pan, and the render follows", async () => {
    const { setLanePoint } = await import("./song-tools");
    const s = setLanePoint(setLanePoint(mk(), 0, "pan", 0, -1), 0, "pan", 8, 1);
    const a = applyAutomation(s).tracks[0]!.notes;
    expect(a[0]!.pan).toBe(-1);
    expect(a[1]!.pan).toBe(1);
    const { renderSong } = await import("./song");
    const [l, r] = renderSong(s, 8000).channels;
    const e = (c: Float32Array, from: number, to: number) => c.slice(from, to).reduce((x, v) => x + v * v, 0);
    expect(e(l!, 0, 2000)).toBeGreaterThan(e(r!, 0, 2000) * 20); // the first note is left
    expect(e(r!, 8 * 1000, 8 * 1000 + 2000)).toBeGreaterThan(e(l!, 8 * 1000, 8 * 1000 + 2000) * 20); // the second is right
  });
  it("is saved, and the range of each lane is checked", () => {
    const s = mk();
    s.tracks[0]!.automation = [{ param: "pan", curve: "linear", points: [{ step: 0, value: -0.5 }] }];
    const back = parseSong(serializeSong(s));
    expect(back.ok && back.song.tracks[0]!.automation).toEqual(s.tracks[0]!.automation);
    const bad = JSON.parse(serializeSong(s));
    bad.tracks[0].automation[0].points[0].value = 1.5;
    expect(parseSong(JSON.stringify(bad)).ok).toBe(false);
    bad.tracks[0].automation = [{ param: "pan", curve: "linear", points: [] }, { param: "pan", curve: "linear", points: [] }];
    expect(parseSong(JSON.stringify(bad)).ok).toBe(false);
    bad.tracks[0].automation = [{ param: "cutoff", curve: "linear", points: [] }];
    expect(parseSong(JSON.stringify(bad)).ok).toBe(false);
  });
});

import { bpmAt as bpmAtTempo, stepAtTime as stepAtT, stepTime as stepT, newSong as newS } from "./song";
import { setTempoAt as setTempoGlide } from "./song-tools";
describe("a tempo that glides", () => {
  const song = () => {
    let s = { ...newS(), length: 64, bpm: 120 };
    s = setTempoGlide(s, 32, 60, true); // from step 0 the tempo falls in a straight line to 60 at step 32
    return s;
  };
  it("passes through the tempo between on the way, and holds the new tempo after", () => {
    const s = song();
    expect(s.tempos).toEqual([{ step: 32, bpm: 60, ramp: true }]);
    expect(bpmAtTempo(s, 0)).toBe(120);
    expect(bpmAtTempo(s, 16)).toBe(90);
    expect(bpmAtTempo(s, 32)).toBe(60);
    expect(bpmAtTempo(s, 50)).toBe(60);
  });
  it("takes longer than the fast tempo and less than the slow one, and time and step undo each other", () => {
    const s = song();
    const fast = (32 * 60) / 120 / s.stepsPerBeat, slow = (32 * 60) / 60 / s.stepsPerBeat;
    const t = stepT(s, 32);
    expect(t).toBeGreaterThan(fast);
    expect(t).toBeLessThan(slow);
    // the log mean: 60/spb * ln(120/60) / ((120-60)/32)
    expect(t).toBeCloseTo(((60 / s.stepsPerBeat) * Math.log(2)) / (60 / 32), 6);
    for (const step of [0, 5, 16, 31.5, 32, 40, 63]) expect(stepAtT(s, stepT(s, step))).toBeCloseTo(step, 6);
  });
  it("a plain tempo change is as before", () => {
    const s = setTempoGlide({ ...newS(), length: 64 }, 32, 60);
    expect(stepT(s, 32)).toBeCloseTo((32 * 60) / 120 / s.stepsPerBeat, 9);
    expect(stepT(s, 36)).toBeCloseTo((32 * 60) / 120 / s.stepsPerBeat + (4 * 60) / 60 / s.stepsPerBeat, 9);
  });
});
