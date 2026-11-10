import { describe, expect, it } from "vitest";
import { midiToSong, songToMidi } from "./midi";
import { newSong, synthTrack, type Song } from "./song";

describe("writing", () => {
  it("makes a type 1 file: a header, a tempo track and a track per song track", () => {
    const bytes = songToMidi(newSong());
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe("MThd");
    const v = new DataView(bytes.buffer, bytes.byteOffset);
    expect([v.getUint16(8), v.getUint16(10), v.getUint16(12)]).toEqual([1, 3, 480]);
  });
});

describe("reading what was written", () => {
  it("brings back the tempo, bar, tracks, pitches, lengths, loudness, drums and markers", () => {
    const s: Song = { ...newSong(), bpm: 96, beatsPerBar: 3, length: 24, markers: [{ step: 12, name: "bridge" }] };
    const lead = s.tracks[0]!;
    lead.name = "lead line";
    lead.notes = [{ step: 0, len: 3, pitch: 60, vel: 0.5 }, { step: 6, len: 1, pitch: 72, vel: 1 }, { step: 6, len: 2, pitch: 64, vel: 0.25 }];
    const { song, warnings } = midiToSong(songToMidi(s));
    expect(warnings).toEqual([]);
    expect(song.bpm).toBe(96);
    expect(song.beatsPerBar).toBe(3);
    expect(song.markers).toEqual([{ step: 12, name: "bridge" }]);
    expect(song.tracks.map((t) => [t.name, t.kind])).toEqual([["lead line", "synth"], ["drums", "drums"]]);
    expect(song.tracks[0]!.notes.map((n) => [n.step, n.len, n.pitch, Math.round(n.vel * 127)])).toEqual([[0, 3, 60, 64], [6, 2, 64, 32], [6, 1, 72, 127]]);
    const kicks = song.tracks[1]!.notes.filter((n) => n.pitch === 36).map((n) => n.step);
    expect(kicks).toEqual([0, 4, 8, 12]);
    expect(song.length % (4 * 3)).toBe(0);
  });
  it("is the same song when written again", () => {
    const first = midiToSong(songToMidi(newSong())).song;
    const again = midiToSong(songToMidi(first)).song;
    expect(again.tracks.map((t) => t.notes)).toEqual(first.tracks.map((t) => t.notes));
  });
});

describe("reading other people's files", () => {
  /// A hand-made file with running status, a note-on of velocity 0 as a note-off, ticks off the grid and a General MIDI drum.
  const make = (ppq: number, events: number[]) => {
    const body = [...events, 0x00, 0xff, 0x2f, 0x00];
    return Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (ppq >> 8) & 255, ppq & 255, 0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, body.length, ...body]);
  };
  it("handles running status and velocity-zero note-offs, and says what it rounded", () => {
    const bytes = make(96, [
      0x00, 0x90, 60, 100, // on at 0
      0x18, 62, 100, // running status: on at 24 (a step is 24 ticks at 96 ppq, 4 steps a beat)
      0x18, 60, 0, // note-on velocity 0 = off for 60 at 48
      0x0b, 62, 0, // off for 62 at 59
    ]);
    const { song, warnings } = midiToSong(bytes);
    expect(song.tracks[0]!.notes.map((n) => [n.step, n.len, n.pitch])).toEqual([[0, 2, 60], [1, 1, 62]]);
    expect(warnings.some((w) => w.includes("moved to the song's grid"))).toBe(false);
  });
  it("maps General MIDI drums on channel 10 to the song's drums", () => {
    const { song } = midiToSong(make(480, [0, 0x99, 35, 90, 0x78, 35, 0, 0, 0x99, 40, 90, 0x78, 40, 0]));
    expect(song.tracks[0]!.kind).toBe("drums");
    expect(song.tracks[0]!.notes.map((n) => n.pitch)).toEqual([36, 38]);
  });
  it("says what is wrong with a file that is not usable", () => {
    expect(() => midiToSong(new Uint8Array([1, 2, 3, 4, 5]))).toThrow(/not a MIDI file/);
    expect(() => midiToSong(Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 2, 0, 1, 1, 224]))).toThrow(/type 2/);
    expect(() => midiToSong(Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0xe7, 0x28]))).toThrow(/SMPTE/);
    expect(() => midiToSong(make(480, []))).toThrow(/no notes/);
    expect(() => midiToSong(new TextEncoder().encode("MThd"))).toThrow();
  });
  it("rounds a note off the grid and reports it", () => {
    const { warnings } = midiToSong(make(480, [0x07, 0x90, 60, 100, 0x78, 60, 0]));
    expect(warnings.join(" ")).toContain("moved to the song's grid");
  });
  it("is fine with the synth tracks it makes", () => {
    expect(synthTrack("x").notes).toEqual([]);
  });
});
