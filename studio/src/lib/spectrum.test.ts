import { describe, expect, it } from "vitest";
import { fft, loudestBand, spectrum } from "./spectrum";

const R = 22050;
const sine = (hz: number, amp = 1, secs = 0.5) => Float32Array.from({ length: Math.round(R * secs) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / R));

describe("the FFT", () => {
  it("puts a sine of a whole number of cycles in one bin", () => {
    const n = 256;
    const re = Float64Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 8 * i) / n));
    const im = new Float64Array(n);
    fft(re, im);
    const mag = (k: number) => Math.hypot(re[k]!, im[k]!);
    expect(mag(8)).toBeCloseTo(n / 2, 6);
    expect(mag(7)).toBeLessThan(1e-6);
    expect(mag(100)).toBeLessThan(1e-6);
  });
  it("is linear and keeps energy (Parseval)", () => {
    const n = 64;
    const x = Float64Array.from({ length: n }, (_, i) => Math.sin(i * 0.7) + 0.3 * Math.cos(i * 2.1));
    const re = Float64Array.from(x);
    const im = new Float64Array(n);
    const time = x.reduce((s, v) => s + v * v, 0);
    fft(re, im);
    const freq = re.reduce((s, v, i) => s + v * v + im[i]! * im[i]!, 0) / n;
    expect(freq).toBeCloseTo(time, 6);
  });
});

describe("the spectrum", () => {
  it("shows a tone in the band it belongs to, near 0 dB for a full-scale sine", () => {
    const b = spectrum(sine(1000), R);
    const top = loudestBand(b)!;
    expect(top.hz).toBeGreaterThan(850);
    expect(top.hz).toBeLessThan(1150);
    expect(top.db).toBeGreaterThan(-4);
    expect(top.db).toBeLessThan(1);
    expect(b.filter((x) => x.hz > 3000).every((x) => x.db < -50)).toBe(true);
  });
  it("a quieter tone reads lower by the right amount, and two tones show two peaks", () => {
    const loud = loudestBand(spectrum(sine(500, 1), R))!.db;
    const half = loudestBand(spectrum(sine(500, 0.5), R))!.db;
    expect(loud - half).toBeCloseTo(6.02, 0);
    const hi = sine(4000);
    const two = spectrum(Float32Array.from(sine(200), (v, i) => v + hi[i]!), R);
    const peaks = two.filter((x) => x.db > -10).map((x) => x.hz);
    expect(peaks.some((h) => h < 300)).toBe(true);
    expect(peaks.some((h) => h > 3000)).toBe(true);
  });
  it("silence is the floor, a sound shorter than a window still reads, and the bands rise in pitch", () => {
    expect(spectrum(new Float32Array(5000), R).every((b) => b.db === -120)).toBe(true);
    expect(loudestBand(spectrum(sine(1000, 1, 0.05), R))!.db).toBeGreaterThan(-12);
    const b = spectrum(sine(300), R, 24);
    expect(b.length).toBe(24);
    for (let i = 1; i < b.length; i++) expect(b[i]!.hz).toBeGreaterThan(b[i - 1]!.hz);
  });
});

import { BARS, liveBars } from "./spectrum";
describe("the live analyser's bars", () => {
  it("puts a tone in the bar of its pitch and leaves the rest empty", () => {
    const rate = 48000, bins = 1024;
    const data = new Float32Array(bins).fill(-120);
    const bin = Math.round((1000 * bins * 2) / rate); // 1 kHz
    data[bin] = -10;
    const bars = liveBars(data, rate);
    expect(bars.length).toBe(BARS);
    const loud = bars.map((v, i) => (v > -50 ? i : -1)).filter((i) => i >= 0);
    expect(loud.length).toBe(1);
    // the bar for 1 kHz sits where a log scale from 40 Hz to 16 kHz puts it
    expect(loud[0]).toBe(Math.floor((Math.log(1000 / 40) / Math.log(16000 / 40)) * BARS));
  });
});
