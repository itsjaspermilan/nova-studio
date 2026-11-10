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
    expect(cleanFx([{ type: "reverb", params: {} }]).ok).toBe(false);
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
