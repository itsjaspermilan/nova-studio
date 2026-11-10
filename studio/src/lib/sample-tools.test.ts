import { describe, expect, it } from "vitest";
import { changeSpeed, findHits, makeLoopable, shiftPitch, slicePieces, spectrogram, stretchTime } from "./sample-tools";
import type { Sound } from "./wav";

const RATE = 22050;
const sine = (hz: number, secs: number, amp = 0.6): Sound => ({ rate: RATE, channels: [Float32Array.from({ length: Math.round(secs * RATE) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / RATE))] });
/// The pitch of a sound in Hz, from its zero crossings.
const pitchOf = (s: Sound) => {
  const c = s.channels[0]!;
  let crossings = 0;
  for (let i = 1; i < c.length; i++) if (c[i - 1]! < 0 && c[i]! >= 0) crossings++;
  return (crossings * s.rate) / c.length;
};
const rms = (c: Float32Array) => Math.sqrt(c.reduce((s, v) => s + v * v, 0) / c.length);

describe("speed, stretch and pitch", () => {
  it("reading faster makes it shorter and higher together", () => {
    const fast = changeSpeed(sine(440, 1), 2);
    expect(fast.channels[0]!.length).toBe(RATE / 2);
    expect(pitchOf(fast)).toBeGreaterThan(860);
    expect(pitchOf(fast)).toBeLessThan(900);
  });
  it("stretching changes the length and keeps the pitch", () => {
    const base = sine(440, 1);
    for (const f of [0.6, 1.5, 2]) {
      const out = stretchTime(base, f);
      expect(Math.abs(out.channels[0]!.length / RATE - f), String(f)).toBeLessThan(0.02);
      expect(Math.abs(pitchOf(out) - 440), String(f)).toBeLessThan(12);
      expect(rms(out.channels[0]!.subarray(2000, out.channels[0]!.length - 2000)), String(f)).toBeGreaterThan(0.3);
    }
    expect(stretchTime(base, 1)).toBe(base);
  });
  it("shifting the pitch keeps the length", () => {
    const base = sine(440, 1);
    const up = shiftPitch(base, 12);
    expect(up.channels[0]!.length).toBe(base.channels[0]!.length);
    expect(Math.abs(pitchOf(up) - 880)).toBeLessThan(30);
    const down = shiftPitch(base, -12);
    expect(Math.abs(pitchOf(down) - 220)).toBeLessThan(15);
    expect(shiftPitch(base, 0)).toBe(base);
  });
});

describe("looping", () => {
  it("crossfades the end into the start, a little shorter, with no jump at the seam", () => {
    const s = sine(100, 1);
    const out = makeLoopable(s, 0.1);
    expect(out.channels[0]!.length).toBe(RATE - Math.floor(0.1 * RATE));
    const c = out.channels[0]!;
    // the last sample runs into the first like neighbouring samples of the sine do
    expect(Math.abs(c[0]! - c[c.length - 1]!)).toBeLessThan(0.1);
    expect(makeLoopable(sine(100, 0.0001), 0.5).channels[0]!.length).toBe(Math.round(0.0001 * RATE));
  });
});

describe("hits and slices", () => {
  const drums = (): Sound => {
    const c = new Float32Array(RATE * 2);
    for (const at of [0.1, 0.6, 1.2]) {
      const start = Math.round(at * RATE);
      for (let i = 0; i < 2000; i++) c[start + i] = Math.sin(i * 0.5) * Math.exp(-i / 500) * 0.8;
    }
    return { rate: RATE, channels: [c] };
  };
  it("finds the start of each hit", () => {
    const hits = findHits(drums(), 0.6);
    expect(hits[0]).toBe(0);
    const found = hits.slice(1);
    expect(found).toHaveLength(3);
    [0.1, 0.6, 1.2].forEach((t, i) => expect(Math.abs(found[i]! - t * RATE)).toBeLessThan(RATE * 0.03));
  });
  it("finds nothing in a steady tone, and cuts at the places it is given", () => {
    expect(findHits(sine(300, 1), 0.5)).toEqual([0]);
    const parts = slicePieces(sine(100, 1), [5000, 5001, 12000]);
    expect(parts.map((p) => p.channels[0]!.length)).toEqual([5000, 6999, RATE - 12000]);
    expect(slicePieces(sine(100, 1), []).length).toBe(1);
  });
});

describe("the spectrogram", () => {
  it("puts a tone in the right row and is loudest there", () => {
    const sp = spectrogram(sine(2756, 1), 8, 512); // a quarter of the Nyquist rate (11025/4)
    const col = sp.columns[4]!;
    const peakRow = col.indexOf(Math.max(...col));
    expect(Math.abs(peakRow / col.length - 0.25)).toBeLessThan(0.03);
    expect(sp.maxHz).toBe(RATE / 2);
    expect(sp.seconds).toBe(1);
    expect(Math.max(...col)).toBeGreaterThan(col[Math.floor(col.length * 0.8)]! + 40);
  });
});
