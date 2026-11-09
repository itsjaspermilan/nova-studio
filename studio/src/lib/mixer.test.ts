import { describe, expect, it } from "vitest";
import { dbfs, measureLevels, meterFraction, showDb } from "./mixer";
import { newSong, setMaster, type Song } from "./song";
import { quantizeTrack, repeatSong, setAllVelocities } from "./song-edit";

describe("levels", () => {
  it("convert amplitude to dB, and draw a meter from -60 to 0", () => {
    expect(dbfs(1)).toBe(0);
    expect(dbfs(0.5)).toBeCloseTo(-6.02, 2);
    expect(dbfs(0)).toBe(-Infinity);
    expect(meterFraction(0)).toBe(1);
    expect(meterFraction(-30)).toBe(0.5);
    expect(meterFraction(-Infinity)).toBe(0);
    expect(showDb(-12.34)).toBe("-12.3 dB");
    expect(showDb(-Infinity)).toBe("silent");
  });

  it("measure the master and each track on its own", () => {
    const song = newSong();
    const l = measureLevels(song, 8000);
    expect(l.tracks).toHaveLength(2);
    expect(l.master.peakDb).toBeLessThanOrEqual(0);
    expect(l.tracks[0]!.peakDb).toBeGreaterThan(-60);
    const quiet = measureLevels(setMaster(song, 0.25), 8000);
    expect(quiet.master.peakDb).toBeLessThan(l.master.peakDb);
  });

  it("measure a muted track as it would sound by itself, and silence as silent", () => {
    const song = newSong();
    song.tracks[0] = { ...song.tracks[0]!, mute: true };
    expect(measureLevels(song, 8000).tracks[0]!.peakDb).toBeGreaterThan(-60);
    const none: Song = { ...newSong(), tracks: [{ ...newSong().tracks[0]!, notes: [] }] };
    expect(measureLevels(none, 8000).master.peakDb).toBe(-Infinity);
  });
});

describe("editing many notes", () => {
  const song = (): Song => {
    const s = newSong();
    s.tracks[0] = { ...s.tracks[0]!, notes: [{ step: 1, len: 1, pitch: 60, vel: 0.5 }, { step: 2, len: 1, pitch: 60, vel: 0.5 }, { step: 6, len: 2, pitch: 64, vel: 0.9 }] };
    return s;
  };

  it("quantise moves notes to the grid and drops one that lands on another of the same pitch", () => {
    const q = quantizeTrack(song(), 0, 2);
    expect(q.tracks[0]!.notes.map((n) => [n.step, n.pitch])).toEqual([[2, 60], [6, 64]]); // (steps 1 and 2 both land on 2: one is dropped)
    expect(quantizeTrack(song(), 0, 0)).toEqual(song());
  });

  it("repeat copies everything after the song's end, and refuses what would be too much", () => {
    const r = repeatSong(song(), 3)!;
    expect(r.length).toBe(48);
    expect(r.tracks[0]!.notes).toHaveLength(9);
    expect(r.tracks[0]!.notes[3]!.step).toBe(17);
    expect(repeatSong(song(), 1)).toBeNull();
    expect(repeatSong({ ...song(), length: 600 }, 2)).toBeNull();
  });

  it("set every velocity at once", () => {
    expect(setAllVelocities(song(), 0, 0.7).tracks[0]!.notes.every((n) => n.vel === 0.7)).toBe(true);
    expect(setAllVelocities(song(), 0, 4).tracks[0]!.notes.every((n) => n.vel === 1)).toBe(true);
  });
});

import { stemName, stemSong } from "./song-edit";
import { renderSong } from "./song";

describe("stems", () => {
  it("hear one track only, and are the same length as the song so they line up when layered", () => {
    const song = newSong();
    const lead = renderSong(stemSong(song, 0), 8000);
    const drums = renderSong(stemSong(song, 1), 8000);
    expect(lead.channels[0]!.length).toBe(renderSong(song, 8000).channels[0]!.length);
    expect(Array.from(lead.channels[0]!)).not.toEqual(Array.from(drums.channels[0]!));
    const soloed = newSong();
    soloed.tracks[1] = { ...soloed.tracks[1]!, solo: true };
    expect(Math.max(...Array.from(renderSong(stemSong(soloed, 0), 8000).channels[0]!).map(Math.abs))).toBeGreaterThan(0); // a solo elsewhere does not silence it
  });

  it("are named after the song and the track, safely, and never twice", () => {
    expect(stemName("theme", "Lead synth!")).toBe("theme_Lead_synth");
    expect(stemName("theme", "  ")).toBe("theme_track");
    expect(stemName("theme", "Bass", ["theme_Bass"])).toBe("theme_Bass2");
  });
});
