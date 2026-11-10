import { describe, expect, it } from "vitest";
import { FX_SPECS, FX_TYPES, MAX_FX, addFx, applyFx, cleanFx, moveFx, newFx, param, removeFx, setFxParam, toggleFx, type Fx } from "./fx";

const RATE = 22050;
const sine = (hz: number, amp = 0.5, seconds = 1) => Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / RATE));
const rms = (x: Float32Array, from = 0, to = x.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / (to - from));
};
const run = (fx: Fx, l: Float32Array, r = l) => applyFx([fx], l, r, RATE);
const withParams = (type: Fx["type"], params: Record<string, number>): Fx => ({ type, params });

describe("every effect", () => {
  it("keeps the signal the same length and finite, and leaves the input alone", () => {
    const x = sine(440);
    const copy = Float32Array.from(x);
    for (const type of FX_TYPES) {
      const [l, r] = run(newFx(type), x);
      expect(l.length, type).toBe(x.length);
      expect(r.length, type).toBe(x.length);
      expect(l.every(Number.isFinite), type).toBe(true);
    }
    expect(x).toEqual(copy);
  });
  it("does nothing when bypassed or when the chain is empty", () => {
    const x = sine(440);
    expect(applyFx([], x, x, RATE)[0]).toBe(x);
    expect(applyFx([{ ...newFx("distortion"), on: false }], x, x, RATE)[0]).toBe(x);
  });
  it("is the same every time", () => {
    const x = sine(300);
    for (const type of FX_TYPES) expect(run(newFx(type), x)[0], type).toEqual(run(newFx(type), x)[0]);
  });
});

describe("what each one does", () => {
  it("EQ lifts and cuts a band", () => {
    const low = sine(80);
    const up = rms(run(withParams("eq", { low: 12 }), low)[0], 5000, 20000);
    const down = rms(run(withParams("eq", { low: -12 }), low)[0], 5000, 20000);
    expect(up).toBeGreaterThan(rms(low, 5000, 20000) * 2);
    expect(down).toBeLessThan(rms(low, 5000, 20000) / 2);
    const same = run(withParams("eq", {}), low)[0];
    expect(same).toEqual(low);
  });
  it("the compressor turns a loud signal down and leaves a quiet one near as it was", () => {
    const loud = sine(440, 0.9);
    const quiet = sine(440, 0.01);
    const fx = withParams("compressor", { threshold: -20, ratio: 8, attack: 2, release: 50 });
    expect(rms(run(fx, loud)[0], 10000, 20000)).toBeLessThan(rms(loud, 10000, 20000) * 0.6);
    expect(rms(run(fx, quiet)[0], 10000, 20000)).toBeGreaterThan(rms(quiet, 10000, 20000) * 0.95);
    const made = rms(run({ ...fx, params: { ...fx.params, makeup: 12 } }, loud)[0], 10000, 20000);
    expect(made).toBeGreaterThan(rms(run(fx, loud)[0], 10000, 20000) * 3);
  });
  it("chorus and flanger change the sound and a mix of 0 leaves it", () => {
    const x = sine(440);
    expect(run(withParams("chorus", { mix: 0 }), x)[0]).toEqual(x);
    expect(run(withParams("chorus", { mix: 0.5 }), x)[0]).not.toEqual(x);
    expect(run(withParams("flanger", { mix: 0.5 }), x)[0]).not.toEqual(x);
    expect(run(withParams("phaser", { mix: 0.5 }), x)[0]).not.toEqual(x);
  });
  it("distortion adds harmonics: a quiet sine becomes squarer and louder at the top", () => {
    const x = sine(220, 0.2);
    const y = run(withParams("distortion", { drive: 20, tone: 12000, mix: 1 }), x)[0];
    expect(rms(y, 5000, 20000)).toBeGreaterThan(rms(x, 5000, 20000) * 1.5);
    expect(Math.max(...y.map(Math.abs))).toBeLessThanOrEqual(1);
  });
  it("the bit crusher uses few levels", () => {
    const y = run(withParams("bitcrush", { bits: 3, downsample: 1, mix: 1 }), sine(220, 0.9))[0];
    expect(new Set([...y].map((v) => +v.toFixed(4))).size).toBeLessThanOrEqual(8);
    const slow = run(withParams("bitcrush", { bits: 16, downsample: 8, mix: 1 }), sine(220, 0.9))[0];
    expect(slow[1]).toBe(slow[0]);
    expect(slow[7]).toBe(slow[0]);
  });
  it("the gate silences what is under the threshold and passes what is over", () => {
    const x = new Float32Array(RATE);
    x.set(sine(440, 0.5, 0.25), 0); // loud first quarter second, then nothing
    x.set(sine(440, 0.001, 0.25), Math.round(0.5 * RATE)); // very quiet
    const y = run(withParams("gate", { threshold: -40, attack: 1, release: 20 }), x)[0];
    expect(rms(y, 1000, 4000)).toBeGreaterThan(rms(x, 1000, 4000) * 0.9);
    expect(rms(y, Math.round(0.55 * RATE), Math.round(0.7 * RATE))).toBeLessThan(0.0002);
  });
});

describe("a chain", () => {
  it("adds, removes, moves, toggles and sets, within the limit", () => {
    let c = addFx([], "eq");
    c = addFx(c, "compressor");
    expect(c.map((f) => f.type)).toEqual(["eq", "compressor"]);
    expect(moveFx(c, 0, 1).map((f) => f.type)).toEqual(["compressor", "eq"]);
    expect(moveFx(c, 0, -1)).toBe(c);
    expect(toggleFx(c, 0)[0]!.on).toBe(false);
    expect(toggleFx(toggleFx(c, 0), 0)[0]!.on).toBe(true);
    expect(setFxParam(c, 1, "ratio", 10)[1]!.params.ratio).toBe(10);
    expect(removeFx(c, 0).map((f) => f.type)).toEqual(["compressor"]);
    let full = c;
    for (let i = 0; i < 10; i++) full = addFx(full, "gate");
    expect(full).toHaveLength(MAX_FX);
  });
  it("clamps a setting to its range and falls back to the default", () => {
    expect(param(withParams("eq", { low: 99 }), "low")).toBe(12);
    expect(param(withParams("eq", {}), "midFreq")).toBe(1000);
    expect(param(withParams("eq", { low: NaN }), "low")).toBe(0);
  });
  it("checks a chain from a file", () => {
    const ok = cleanFx([{ type: "eq", params: { low: 50 } }, { type: "gate", on: false, params: {} }]);
    expect(ok.ok && ok.chain[0]!.params.low).toBe(12);
    expect(ok.ok && ok.chain[1]!.on).toBe(false);
    expect(cleanFx([{ type: "vocoder", params: {} }]).ok).toBe(false);
    expect(cleanFx("x").ok).toBe(false);
    expect(cleanFx(Array.from({ length: 9 }, () => ({ type: "eq", params: {} }))).ok).toBe(false);
    expect(cleanFx([{ type: "eq", params: { low: "loud" } }]).ok).toBe(false);
  });
  it("describes every effect", () => {
    for (const type of FX_TYPES) {
      expect(FX_SPECS[type].title.length).toBeGreaterThan(0);
      for (const p of FX_SPECS[type].params) expect(p.default >= p.min && p.default <= p.max, `${type}.${p.key}`).toBe(true);
    }
  });
});

import { applyFx as run2, newFx as make } from "./fx";
describe("more effects", () => {
  const R = 22050;
  const sine = (hz: number, secs = 0.5, amp = 0.5) => Float32Array.from({ length: Math.round(R * secs) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / R));
  const rms = (x: Float32Array, a = 0, b = x.length) => Math.sqrt(x.slice(a, b).reduce((s, v) => s + v * v, 0) / Math.max(1, b - a));
  const cross = (x: Float32Array) => x.reduce((n, v, i) => (i > 0 && (x[i - 1]! < 0) !== (v < 0) ? n + 1 : n), 0);
  it("the parametric EQ boosts the band it is placed on and leaves a far tone alone", () => {
    const fx = { ...make("parametric"), params: { f2: 1000, g2: 12, q2: 2 } };
    const hit = run2([fx], sine(1000), sine(1000), R)[0];
    const miss = run2([fx], sine(100), sine(100), R)[0];
    expect(rms(hit, 4000) / rms(sine(1000), 4000)).toBeGreaterThan(3);
    expect(rms(miss, 4000) / rms(sine(100), 4000)).toBeCloseTo(1, 1);
  });
  it("stereo width 0 makes the sound mono, 1 leaves it, 2 spreads it", () => {
    const l = sine(300);
    const r = sine(500);
    const mono = run2([{ ...make("stereo"), params: { width: 0 } }], l, r, R);
    expect(Array.from(mono[0]!.slice(100, 120))).toEqual(Array.from(mono[1]!.slice(100, 120)));
    const same = run2([{ ...make("stereo"), params: { width: 1 } }], l, r, R);
    for (let i = 0; i < 200; i++) expect(same[0]![i]).toBeCloseTo(l[i]!, 5);
    const wide = run2([{ ...make("stereo"), params: { width: 2 } }], l, r, R);
    expect(rms(wide[0]!) ).toBeGreaterThan(rms(l) * 0.99);
    const side = (x: [Float32Array, Float32Array]) => x[0].map((v, i) => Math.abs(v - x[1][i]!)).reduce((a, b) => a + b, 0);
    expect(side(wide)).toBeGreaterThan(side(same) * 1.9);
  });
  it("the transient shaper boosts an onset and a negative punch softens it", () => {
    const hit = new Float32Array(R);
    for (let i = 0; i < 3000; i++) hit[i] = 0.5 * Math.sin((2 * Math.PI * 200 * i) / R) * Math.exp(-i / 800);
    const peakOf = (x: Float32Array) => x.slice(0, 400).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    const up = run2([{ ...make("transient"), params: { attack: 1, sustain: 0 } }], hit, hit, R)[0];
    const down = run2([{ ...make("transient"), params: { attack: -1, sustain: 0 } }], hit, hit, R)[0];
    expect(peakOf(up)).toBeGreaterThan(peakOf(hit) * 1.2);
    expect(peakOf(down)).toBeLessThan(peakOf(hit) * 0.9);
    const quiet = new Float32Array(1000);
    expect(run2([make("transient")], quiet, quiet, R)[0].every((v) => v === 0)).toBe(true);
  });
  it("the echo repeats an impulse at the gap, quieter each time, and ping-pong swaps sides", () => {
    const imp = new Float32Array(R);
    imp[0] = 1;
    const zero = new Float32Array(R);
    const e = { ...make("echo"), params: { time: 100, feedback: 0.5, mix: 1, pingpong: 0 } };
    const [l] = run2([e], imp, zero, R);
    const d = Math.round(0.1 * R);
    expect(l[d]).toBeCloseTo(0.5, 5);
    expect(l[2 * d]).toBeCloseTo(0.25, 5);
    const [pl, pr] = run2([{ ...e, params: { ...e.params, pingpong: 1 } }], imp, zero, R);
    expect(pr[d]).toBeCloseTo(0.5, 5); // the first repeat arrives on the other side
    expect(pl[d]).toBe(0);
    expect(pl[2 * d]).toBeCloseTo(0.25, 5);
    expect(l.length).toBe(R);
  });
  it("the reverb leaves a tail after a click, a bigger room a longer one, and mix 0 is dry", () => {
    const imp = new Float32Array(R);
    imp[0] = 1;
    const tail = (size: number) => rms(run2([{ ...make("reverb"), params: { size, damping: 0.2, mix: 1 } }], imp, imp, R)[0], 8000, 16000);
    expect(tail(0.2)).toBeGreaterThan(0);
    expect(tail(0.9)).toBeGreaterThan(tail(0.2));
    const dry = run2([{ ...make("reverb"), params: { mix: 0 } }], imp, imp, R)[0];
    expect(Array.from(dry)).toEqual(Array.from(imp));
  });
  it("the pitch shifter moves a tone an octave up (twice the zero crossings) and 0 semitones keeps it", () => {
    const x = sine(400, 1);
    const up = run2([{ ...make("pitch"), params: { semitones: 12, mix: 1 } }], x, x, R)[0];
    const ratio = cross(up.slice(2000, 18000)) / cross(x.slice(2000, 18000));
    expect(ratio).toBeGreaterThan(1.8);
    expect(ratio).toBeLessThan(2.2);
    const down = run2([{ ...make("pitch"), params: { semitones: -12, mix: 1 } }], x, x, R)[0];
    expect(cross(down.slice(2000, 18000)) / cross(x.slice(2000, 18000))).toBeLessThan(0.6);
    expect(rms(up, 3000, 18000)).toBeGreaterThan(0.1);
  });
});

describe("the multiband compressor", () => {
  const R = 22050;
  const sine = (hz: number, amp = 0.8) => Float32Array.from({ length: R }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / R));
  const rms = (x: Float32Array, a = 4000) => Math.sqrt(x.slice(a).reduce((s, v) => s + v * v, 0) / (x.length - a));
  it("with every ratio at 1 the level comes out as it went in, at low, middle and high pitches", () => {
    const flat = { ...newFx("multiband"), params: { lowRatio: 1, midRatio: 1, highRatio: 1 } };
    for (const hz of [60, 400, 1500, 6000]) {
      const x = sine(hz, 0.5);
      expect(rms(applyFx([flat], x, x, R)[0]) / rms(x), `${hz} Hz`).toBeCloseTo(1, 1);
    }
  });
  it("squashes the band a loud tone is in and leaves a tone in another band alone", () => {
    const fx = { ...newFx("multiband"), params: { lowThreshold: -30, lowRatio: 10, midRatio: 1, highRatio: 1, split1: 200, split2: 2500 } };
    const low = sine(80);
    const high = sine(5000);
    expect(rms(applyFx([fx], low, low, R)[0]) / rms(low)).toBeLessThan(0.6);
    expect(rms(applyFx([fx], high, high, R)[0]) / rms(high)).toBeGreaterThan(0.95);
  });
});
