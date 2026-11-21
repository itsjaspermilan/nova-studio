import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fft } from "./spectrum";
import { DEFAULTS, fromJson, parseSfx, render, toJson, type SfxParams } from "./sfx";
import { cleanLayer, type SfxLayer } from "./sfx-layers";
import { encodeWav } from "./wav";

const layered = (layers: Partial<SfxLayer>[], extra: Partial<SfxParams> = {}): SfxParams => ({
  ...DEFAULTS, volume: 0.8, seed: 1, layers: layers.map((l, i) => cleanLayer({ wave: "sine", ...l }, `layer ${i}`)), ...extra,
});

/// The power spectrum of a stretch of samples (Hann window), one value per bin of rate / size Hz.
function spectrum(x: Float32Array, from: number, size = 4096): Float64Array {
  const re = new Float64Array(size), im = new Float64Array(size);
  for (let i = 0; i < size; i++) re[i] = (x[from + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
  fft(re, im);
  const out = new Float64Array(size / 2);
  for (let k = 0; k < size / 2; k++) out[k] = re[k]! ** 2 + im[k]! ** 2;
  return out;
}
const centroid = (p: Float64Array, rate: number) => {
  let w = 0, t = 0;
  p.forEach((v, k) => {
    w += v * k;
    t += v;
  });
  return ((w / t) * rate) / (2 * p.length);
};

describe("the fuller sound effect (layers and the finish)", () => {
  it("leaves every old effect exactly as it was: a committed WAV is what its settings render", () => {
    const dir = join(__dirname, "../../../examples/maker-demo/sounds");
    for (const name of ["hit", "coin", "door", "step_grass"]) {
      const p = fromJson(readFileSync(join(dir, `${name}.sfx.json`), "utf8"))!;
      expect(Buffer.from(encodeWav(render(p))).equals(readFileSync(join(dir, `${name}.wav`))), name).toBe(true);
      expect(render(p).channels).toHaveLength(1);
      expect(toJson(p)).not.toContain("layers");
    }
  });

  it("renders layers deterministically, each from its own start, and ends in silence", () => {
    const p = layered([{ wave: "noise", hold: 0, decay: 0.05 }, { freq: 220, start: 0.1, hold: 0.02, decay: 0.1 }]);
    const a = render(p), b = render(p);
    expect(a.channels[0]).toEqual(b.channels[0]);
    const x = a.channels[0]!;
    // the second layer starts 0.1 s in: before it, the noise has died away
    let before = 0;
    for (let i = Math.round(0.07 * a.rate); i < Math.round(0.1 * a.rate); i++) before = Math.max(before, Math.abs(x[i]!));
    let after = 0;
    for (let i = Math.round(0.11 * a.rate); i < Math.round(0.13 * a.rate); i++) after = Math.max(after, Math.abs(x[i]!));
    expect(before).toBeLessThan(0.02);
    expect(after).toBeGreaterThan(0.2);
    expect(Math.abs(x[0]!)).toBeLessThan(0.01);
    expect(Math.abs(x[x.length - 1]!)).toBeLessThan(0.001);
    expect(x.length / a.rate).toBeCloseTo(0.2 + 0.002, 1);
  });

  it("band-limits saw and square layers: far less energy between the harmonics than the plain voice's saw", () => {
    const f = 1661; // (high enough that a plain saw's harmonics fold back between its own)
    const plain = render({ ...DEFAULTS, wave: "saw", freq: f, attack: 0.01, sustain: 0.3, decay: 0.01, volume: 0.5 });
    const layer = render(layered([{ wave: "saw", freq: f, hold: 0.3, decay: 0.01, volume: 0.5 }]));
    const offHarmonic = (s: typeof plain) => {
      const p = spectrum(s.channels[0]!, 2048, 8192);
      const bin = s.rate / 8192;
      let on = 0, off = 0;
      p.forEach((v, k) => {
        const r = (k * bin) / f;
        if (k * bin < 100) return;
        if (Math.abs(r - Math.round(r)) < 0.03) on += v;
        else off += v;
      });
      return off / on;
    };
    expect(offHarmonic(layer)).toBeLessThan(offHarmonic(plain) / 10);
  });

  it("drops the pitch from `pitch` semitones above to freq, and moves a filter from cutoff to cutoffEnd", () => {
    const s = render(layered([{ freq: 100, pitch: 24, pitchTime: 0.02, hold: 0.3, decay: 0.05 }]));
    const crossings = (from: number, to: number) => {
      const x = s.channels[0]!;
      let c = 0;
      for (let i = Math.round(from * s.rate) + 1; i < Math.round(to * s.rate); i++) if (x[i - 1]! < 0 && x[i]! >= 0) c++;
      return c / (to - from);
    };
    expect(crossings(0, 0.01)).toBeGreaterThan(250); // near 400 Hz at the start
    expect(crossings(0.2, 0.3)).toBeCloseTo(100, -1); // settled on 100 Hz
    const sweep = render(layered([{ wave: "noise", filter: "lowpass", cutoff: 8000, cutoffEnd: 400, hold: 0.4, decay: 0.05 }]));
    const early = centroid(spectrum(sweep.channels[0]!, 0), sweep.rate), late = centroid(spectrum(sweep.channels[0]!, Math.round(0.33 * sweep.rate)), sweep.rate);
    expect(early).toBeGreaterThan(late * 3);
  });

  it("FM with a ratio that is not whole gives partials off the harmonic series (metal), ring modulation moves the pitch", () => {
    const f = 400;
    const metal = render(layered([{ freq: f, fm: 5, fmRatio: 1.41, hold: 0.3, decay: 0.05 }]));
    const p = spectrum(metal.channels[0]!, 1024, 8192);
    const bin = metal.rate / 8192;
    let off = 0, all = 0;
    p.forEach((v, k) => {
      all += v;
      const r = (k * bin) / f;
      if (Math.abs(r - Math.round(r)) > 0.1) off += v;
    });
    expect(off / all).toBeGreaterThan(0.3);
    // a 300 Hz sine ring-modulated by 1000 Hz: the energy moves to 700 and 1300
    const ring = render(layered([{ freq: 300, ring: 1000, hold: 0.3, decay: 0.05 }]));
    const q = spectrum(ring.channels[0]!, 1024, 8192);
    const at = (hz: number) => q[Math.round(hz / (ring.rate / 8192))]!;
    expect(at(700)).toBeGreaterThan(at(300) * 100);
    expect(at(1300)).toBeGreaterThan(at(300) * 100);
  });

  it("drive saturates (louder, peaks still under full scale), reverb adds a tail, width makes it stereo", () => {
    const base = layered([{ freq: 150, hold: 0.1, decay: 0.2 }, { wave: "noise", filter: "bandpass", cutoff: 2000, hold: 0.02, decay: 0.15 }], { volume: 0.5 });
    const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
    const dry = render(base), driven = render({ ...base, drive: 0.8 });
    expect(rms(driven.channels[0]!)).toBeGreaterThan(rms(dry.channels[0]!) * 1.5);
    expect(Math.max(...driven.channels[0]!.map(Math.abs))).toBeLessThanOrEqual(0.98 + 1e-6);
    const wet = render({ ...base, reverb: 0.4, room: 0.6 });
    expect(wet.channels[0]!.length).toBeGreaterThan(dry.channels[0]!.length + 0.1 * dry.rate);
    expect(dry.channels).toHaveLength(1);
    const wide = render({ ...base, width: 0.6 });
    expect(wide.channels).toHaveLength(2);
    expect(wide.channels[0]).not.toEqual(wide.channels[1]);
  });

  it("keeps a layered file small (only what differs from the defaults) and reads it back the same", () => {
    const p = layered([{ wave: "noise", filter: "bandpass", cutoff: 3000, cutoffEnd: 500, decay: 0.2 }], { drive: 0.3, reverb: 0.2, room: 0.3, width: 0.4 });
    const json = JSON.parse(toJson(p));
    expect(Object.keys(json)).toEqual(["version", "volume", "seed", "drive", "reverb", "room", "width", "layers"]);
    expect(json.layers[0]).toEqual({ wave: "noise", cutoff: 3000, cutoffEnd: 500, filter: "bandpass", decay: 0.2 });
    const back = fromJson(toJson(p))!;
    expect(render(back).channels[0]).toEqual(render(p).channels[0]);
  });

  it("refuses a misspelt key, a wrong wave and an unknown file key, naming the nearest", () => {
    expect(() => cleanLayer({ wave: "sine", decya: 0.2 })).toThrow(/"decya", which a layer does not have \(did you mean "decay"\?\)/);
    expect(() => cleanLayer({ wave: "sawtooth" })).toThrow(/wave is one of sine, triangle, saw, square, noise, pink, crackle/);
    expect(() => cleanLayer({ wave: "noise", filter: "notch" })).toThrow(/filter is one of none, lowpass, highpass, bandpass/);
    expect(parseSfx(JSON.stringify({ version: 1, reverbb: 0.2 }))).toEqual({ ok: false, error: 'it has "reverbb", which an effect does not have (did you mean "reverb"?)' });
    expect(parseSfx(JSON.stringify({ version: 1, layers: [{ wave: "noise", cutof: 300 }] })).ok).toBe(false);
    expect(parseSfx(toJson(DEFAULTS)).ok).toBe(true);
    // a cutoff alone means a low-pass
    expect(cleanLayer({ wave: "noise", cutoff: 500 }).filter).toBe("lowpass");
  });
});
