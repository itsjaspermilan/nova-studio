import { describe, expect, it } from "vitest";
import { compileFormula } from "./formula";

const run = (src: string, env = { p: 0.25, t: 0.5, f: 440 }) => {
  const c = compileFormula(src);
  if (!c.ok) throw new Error(c.error);
  return c.run(env);
};

describe("the formula language", () => {
  it("does arithmetic with the usual precedence", () => {
    expect(run("1 + 2 * 3")).toBeCloseTo(1, 9); // 7, clamped to the sound's range -1 to 1
    expect(run("(1 + 2) * 0.1")).toBeCloseTo(0.3, 9);
    expect(run("0.5 - 0.25 - 0.125")).toBeCloseTo(0.125, 9);
    expect(run("0.5 ^ 2")).toBeCloseTo(0.25, 9);
    expect(run("2 ^ 3 ^ 2 / 1000")).toBeCloseTo(0.512, 9); // right-associative: 2^(3^2) = 512
    expect(run("-0.5 + 0.25")).toBeCloseTo(-0.25, 9);
    expect(run("-2 ^ 2 / 10")).toBeCloseTo(-0.4, 9); // unary minus binds looser than ^
    expect(run("0.7 % 0.5")).toBeCloseTo(0.2, 9);
  });
  it("knows the phase, the time, the pitch and the constants", () => {
    expect(run("p")).toBe(0.25);
    expect(run("t")).toBe(0.5);
    expect(run("f / 1000")).toBeCloseTo(0.44, 9);
    expect(run("sin(2 * pi * p)")).toBeCloseTo(1, 9);
    expect(run("e / 10")).toBeCloseTo(Math.E / 10, 9);
  });
  it("has the waves and helpers", () => {
    expect(run("saw(p)")).toBeCloseTo(-0.5, 9);
    expect(run("tri(p)")).toBeCloseTo(0, 9);
    expect(run("sq(p)")).toBe(1);
    expect(run("clamp(5, 0, 0.3)")).toBe(0.3);
    expect(run("mix(0, 1, 0.5)")).toBe(0.5);
    expect(run("max(0.1, min(0.9, 0.4))")).toBe(0.4);
    expect(run("frac(1.25)")).toBeCloseTo(0.25, 9);
    expect(run("noise(1)")).toBe(run("noise(1)")); // repeatable
    expect(run("p > 0.2")).toBe(1);
    expect(run("p < 0.2")).toBe(0);
  });
  it("never gives a number outside -1 to 1 or one that is not a number", () => {
    expect(run("1 / 0")).toBe(0);
    expect(run("sqrt(0 - 4)")).toBe(0);
    expect(run("1000 * p")).toBe(1);
    expect(run("-1000 * p")).toBe(-1);
    expect(run("0 ^ -1")).toBe(0);
  });
  it("says what is wrong, and where, in plain words", () => {
    const err = (s: string) => { const c = compileFormula(s); return c.ok ? "" : c.error; };
    expect(err("")).toContain("empty");
    expect(err("sin(")).toContain("ends too soon");
    expect(err("2 +")).toContain("ends too soon");
    expect(err("2 $ 3")).toContain('"$"');
    expect(err("x + 1")).toContain('"x" is not known');
    expect(err("foo(1)")).toContain('no function "foo"');
    expect(err("sin(1, 2)")).toContain("takes 1 number");
    expect(err("(1 + 2")).toContain('expected ")"');
    expect(err("1 2")).toContain("unexpected");
    expect(err("1 + ".repeat(60))).toContain("longer than");
  });
});
