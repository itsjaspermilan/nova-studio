import { describe, expect, it } from "vitest";
import { gainToLufs, integratedLufs, limitPeaks, peakDb } from "./loudness";

const RATE = 48000;
const sine = (hz: number, amp: number, seconds: number, rate = RATE) => Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));

describe("loudness", () => {
  it("reads a 1 kHz tone at -20 dBFS in both channels as about -20 LUFS, and follows its level", () => {
    const a = sine(1000, 0.1, 3);
    expect(integratedLufs([a, a], RATE)).toBeGreaterThan(-20.4);
    expect(integratedLufs([a, a], RATE)).toBeLessThan(-19.6);
    const quieter = sine(1000, 0.05, 3);
    expect(integratedLufs([a, a], RATE) - integratedLufs([quieter, quieter], RATE)).toBeCloseTo(6.02, 1);
  });
  it("counts one channel as 3 dB quieter than two, and a low tone as quieter than a mid one", () => {
    const a = sine(1000, 0.1, 3);
    expect(integratedLufs([a, a], RATE) - integratedLufs([a], RATE)).toBeCloseTo(3.01, 1);
    expect(integratedLufs([sine(40, 0.1, 3)], RATE)).toBeLessThan(integratedLufs([a], RATE) - 3);
  });
  it("says silence, and a sound shorter than a block, are silent", () => {
    expect(integratedLufs([new Float32Array(RATE)], RATE)).toBe(-Infinity);
    expect(integratedLufs([sine(1000, 0.5, 0.2)], RATE)).toBe(-Infinity);
  });
  it("ignores a long quiet passage (the gates)", () => {
    const loud = sine(1000, 0.2, 3);
    const quiet = sine(1000, 0.0005, 6);
    const both = new Float32Array(loud.length + quiet.length);
    both.set(loud);
    both.set(quiet, loud.length);
    expect(Math.abs(integratedLufs([both], RATE) - integratedLufs([loud], RATE))).toBeLessThan(0.5);
  });
  it("gives the gain for a target", () => {
    const a = sine(1000, 0.1, 3);
    expect(gainToLufs([a, a], RATE, -14)).toBeCloseTo(6, 0);
    expect(gainToLufs([new Float32Array(10)], RATE, -14)).toBe(0);
  });
});

describe("the limiter", () => {
  it("holds every sample under the ceiling and leaves a quiet signal alone", () => {
    const l = sine(200, 1.6, 1);
    const r = sine(300, 1.2, 1);
    limitPeaks([l, r], 0.5, RATE);
    expect(Math.max(...l.map(Math.abs), ...r.map(Math.abs))).toBeLessThanOrEqual(0.5 + 1e-6);
    const q = sine(200, 0.2, 1);
    const copy = Float32Array.from(q);
    limitPeaks([q], 0.5, RATE);
    expect(q).toEqual(copy);
  });
  it("takes the gain down smoothly, not by hard clipping the tops off a loud tone", () => {
    const x = sine(100, 1, 1);
    limitPeaks([x], 0.5, RATE);
    // a clipped sine would have long flat runs at the ceiling; a limited one keeps its shape, so few samples sit exactly at the ceiling
    expect(x.filter((v) => Math.abs(Math.abs(v) - 0.5) < 1e-6).length).toBeLessThan(RATE * 0.05);
    expect(peakDb([x])).toBeLessThanOrEqual(-6.0);
  });
});
