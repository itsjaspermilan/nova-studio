import { describe, expect, it } from "vitest";
import { addBus, removeBus, routeTrack, sendLevel, setSend, updateBus } from "./song-bus";
import { parseSong, renderSong, serializeSong, synthTrack, type Song } from "./song";

const energy = (c: Float32Array) => c.reduce((s, x) => s + x * x, 0);
const crossings = (c: Float32Array) => c.reduce((n, x, i) => (i > 0 && c[i - 1]! < 0 !== x < 0 ? n + 1 : n), 0);
const base = (): Song => ({ version: 1, bpm: 120, stepsPerBeat: 4, length: 16, tracks: [{ ...synthTrack("a", "sine"), notes: [{ step: 0, len: 8, pitch: 69, vel: 1 }] }] });
const withBus = (): Song => addBus(base(), "drums");

describe("buses", () => {
  it("adds uniquely named buses, up to the limit, and removing one clears the routes", () => {
    let s = addBus(addBus(base(), "mix"), "mix");
    expect(s.buses!.map((b) => b.name)).toEqual(["mix", "mix2"]);
    for (let i = 0; i < 12; i++) s = addBus(s);
    expect(s.buses!.length).toBe(8);
    let r = routeTrack(withBus(), 0, "drums");
    r = setSend(r, 0, "drums", 0.5);
    r = removeBus(r, "drums");
    expect(r.buses).toBeUndefined();
    expect(r.tracks[0]!.bus).toBeUndefined();
    expect(r.tracks[0]!.sends).toBeUndefined();
  });
  it("renaming a bus moves the routes with it and refuses a name already used", () => {
    let s = addBus(withBus(), "fx");
    s = routeTrack(s, 0, "drums");
    s = setSend(s, 0, "drums", 0.3);
    const renamed = updateBus(s, "drums", { name: "kit" });
    expect(renamed.tracks[0]!.bus).toBe("kit");
    expect(sendLevel(renamed, 0, "kit")).toBe(0.3);
    expect(updateBus(s, "drums", { name: "fx" }).buses![0]!.name).toBe("drums");
  });
  it("a bus with unity volume sounds the same as the track straight to the master", () => {
    const direct = renderSong(base()).channels[0]!;
    const routed = renderSong(routeTrack(withBus(), 0, "drums")).channels[0]!;
    expect(routed.length).toBe(direct.length);
    for (let i = 0; i < direct.length; i += 997) expect(routed[i]).toBeCloseTo(direct[i]!, 6);
  });
  it("the bus fader and mute change what is heard; balance moves it to one side", () => {
    const routed = routeTrack(withBus(), 0, "drums");
    const half = renderSong(updateBus(routed, "drums", { volume: 0.5 })).channels[0]!;
    const full = renderSong(routed).channels[0]!;
    expect(energy(half) / energy(full)).toBeCloseTo(0.25, 1);
    expect(energy(renderSong(updateBus(routed, "drums", { mute: true })).channels[0]!)).toBe(0);
    const right = renderSong(updateBus(routed, "drums", { pan: 1 })).channels;
    expect(energy(right[0]!)).toBeLessThan(energy(right[1]!) * 0.001);
  });
  it("a send adds a copy through the bus; a muted bus gives no send", () => {
    let s = setSend(withBus(), 0, "drums", 0.5);
    const direct = renderSong(base()).channels[0]!;
    const sent = renderSong(s).channels[0]!;
    // the track plays straight and a half-loud copy comes through the bus: 1.5 times as loud, 2.25 as much energy
    expect(energy(sent) / energy(direct)).toBeCloseTo(2.25, 1);
    s = updateBus(s, "drums", { mute: true });
    expect(energy(renderSong(s).channels[0]!)).toBeCloseTo(energy(direct), 3);
  });
  it("a bus has its own effect chain", () => {
    const routed = routeTrack(withBus(), 0, "drums");
    const gated = updateBus(routed, "drums", { fx: [{ type: "distortion", params: { drive: 1, tone: 1, mix: 1 } }] });
    const a = renderSong(routed).channels[0]!;
    const b = renderSong(gated).channels[0]!;
    expect(b.some((x, i) => Math.abs(x - a[i]!) > 0.01)).toBe(true);
  });
  it("a bus can send to the room", () => {
    const routed = routeTrack(withBus(), 0, "drums");
    const dry = renderSong(routed).channels[0]!;
    const wet = renderSong(updateBus(routed, "drums", { reverb: 1 })).channels[0]!;
    expect(wet.some((x, i) => Math.abs(x - dry[i]!) > 0.001)).toBe(true);
  });
  it("is saved in the song file, and a track naming a bus that is missing is refused", () => {
    let s = routeTrack(withBus(), 0, "drums");
    s = setSend(addBus(s, "b"), 0, "b", 0.25);
    s = updateBus(s, "drums", { volume: 0.8, pan: -0.5, reverb: 0.3, color: "#ff8800" });
    const back = parseSong(serializeSong(s));
    expect(back.ok && back.song).toEqual(s);
    const bad = JSON.parse(serializeSong(s));
    bad.tracks[0].bus = "nope";
    const r = parseSong(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("nope");
    const dup = JSON.parse(serializeSong(s));
    dup.buses.push({ name: "drums" });
    expect(parseSong(JSON.stringify(dup)).ok).toBe(false);
  });
});

describe("per-note pan and bend", () => {
  it("a note with its own pan sits on that side", () => {
    const s = base();
    s.tracks[0]!.notes[0]!.pan = 1;
    const [l, r] = renderSong(s).channels;
    expect(energy(l!)).toBeLessThan(energy(r!) * 0.01);
    s.tracks[0]!.notes[0]!.pan = -1;
    const [l2, r2] = renderSong(s).channels;
    expect(energy(r2!)).toBeLessThan(energy(l2!) * 0.01);
  });
  it("a bend up an octave makes the tone about a half as high again over the note", () => {
    const flat = base();
    const bent = base();
    bent.tracks[0]!.notes[0]!.bend = 12;
    const f = crossings(renderSong(flat).channels[0]!);
    const b = crossings(renderSong(bent).channels[0]!);
    // the glide runs from 1x to 2x pitch over the note, then holds that: more cycles, near 1.5x
    expect(b / f).toBeGreaterThan(1.3);
    expect(b / f).toBeLessThan(1.7);
  });
  it("pan and bend are saved and checked", () => {
    const s = base();
    s.tracks[0]!.notes[0] = { step: 0, len: 4, pitch: 60, vel: 0.5, pan: -0.5, bend: -2 };
    const back = parseSong(serializeSong(s));
    expect(back.ok && back.song.tracks[0]!.notes[0]).toEqual(s.tracks[0]!.notes[0]);
    const bad = JSON.parse(serializeSong(s));
    bad.tracks[0].notes[0].bend = 40;
    expect(parseSong(JSON.stringify(bad)).ok).toBe(false);
  });
});
