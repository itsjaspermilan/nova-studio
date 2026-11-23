import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../server";
import { unlessPassedBefore } from "../test-cache";
import { bandFiring, ENGINE_BASES, makeEngine } from "./engine-make";
import { firingOf } from "./index-engine";
// @ts-ignore (plain JavaScript)
import { engineLoop, firingHz, bandRpm, patternOrder, wavBytes, fft } from "./engine.mjs";
// @ts-ignore
import { makeDriving } from "./driving.mjs";
// @ts-ignore (Pine Ridge Rally's recipes)
import { ENGINES as PINE } from "../../../scripts/rally/engines.mjs";

const sounds = new URL("../../../examples/pine-ridge-rally/sounds/", import.meta.url).pathname;
const recipes = new URL("../../../scripts/rally/engines.mjs", import.meta.url).pathname;
let dir = "";
beforeAll(() => (dir = mkdtempSync(join(tmpdir(), "nova-engine-test-"))));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("engine_make", () => {
  it("makes each of Pine Ridge Rally's engines from its recipe exactly (the first and last band, both layers)", (ctx) => {
    const passed = unlessPassedBefore(ctx, recipes, sounds);
    expect(Object.keys(PINE).sort()).toEqual([...ENGINE_BASES].sort());
    for (const [id, recipe] of Object.entries(PINE as Record<string, Record<string, unknown>>)) {
      const e = makeEngine(recipe);
      expect(e.base, id).toBe(id);
      const n = e.spec.cycles.length;
      for (const j of [0, n - 1]) for (const layer of ["on", "off"]) {
        const file = `eng_${id}_${layer === "on" ? "" : "off_"}${j + 1}.wav`;
        expect(Buffer.compare(wavBytes(engineLoop(e.spec, e.spec.cycles[j], layer, e.seed + j)), readFileSync(join(sounds, file))), file).toBe(0);
      }
    }
    passed();
  }, 120_000);

  it("fires at the layout's frequency in every band", (ctx) => {
    const passed = unlessPassedBefore(ctx);
    for (const recipe of [{ layout: "three" }, { layout: "four", aspiration: "turbo", character: "raspy" }, { layout: "five", displacement: 3.2 }, { layout: "six", fuel: "diesel", displacement: 6 }, { layout: "v6" }, { layout: "v8", displacement: 7, character: "smooth" }]) {
      const e = makeEngine(recipe), cyl = e.spec.layout.order.length;
      bandFiring(e).forEach((b: { cycles: number; rpm: number; hz: number }, j: number) => {
        expect(b.hz, `${recipe.layout}`).toBeCloseTo((bandRpm(b.cycles) * cyl) / 120, 0);
        expect(firingHz(e.spec, bandRpm(b.cycles))).toBeCloseTo(b.hz, 0);
        // measured from the sound: its lines are the firing frequency apart, or a whole share of it the pattern repeats at (a V8's two
        // banks, a five's unequal pipes: the burr is part of the pattern), and most of the energy is on the firing harmonics
        const m = firingOf(engineLoop(e.spec, b.cycles, "on", e.seed + j), b.cycles, e.spec.layout), share = b.hz / m.fired, whole = Math.round(share), what = `${JSON.stringify(recipe)} band ${j + 1}: fires at ${b.hz} Hz, lines ${m.fired} Hz apart`;
        expect(Math.abs(share / whole - 1), what).toBeLessThan(0.01);
        expect(patternOrder(e.spec.layout) % whole, what).toBe(0);
        expect(m.firing + m.half, what).toBeGreaterThan(0.5);
      });
    }
    passed();
  }, 120_000);

  it("moves a recipe away from its base, the same each time, and writes the loops and the profile", () => {
    const a = makeEngine({ layout: "four", displacement: 1.4, idle: 900, limit: 6800, character: "burbly" }), b = makeEngine({ layout: "four", displacement: 1.4, idle: 900, limit: 6800, character: "burbly" });
    expect(JSON.stringify(a.spec)).toBe(JSON.stringify(b.spec));
    expect(a.says.length).toBeGreaterThan(1);
    expect(a.spec.cycles[0]).toBeLessThan(a.spec.cycles[a.spec.cycles.length - 1]);
    expect(makeEngine({ layout: "four", aspiration: "none" }).profile.turbo).toBeUndefined();
    expect(makeEngine({ layout: "four", fuel: "petrol", aspiration: "turbo" }).profile.turbo).toBeDefined();
    const said = (call("engine_make", { project: dir, name: "car", layout: "v8", displacement: 6.2, report: false }).content[0] as { text: string }).text;
    expect(said).toMatch(/band 1: \d+ rpm, firing [\d.]+ Hz/);
    expect(existsSync(join(dir, "sounds/eng_car_1.wav"))).toBe(true);
    expect(readFileSync(join(dir, "engines/car.lua"), "utf8")).toMatch(/return \{\n  sound = "car",\n  idle = \d+/);
    expect(() => makeEngine({ layout: "w16" })).toThrow(/layout is three, four/);
  }, 120_000);
});

describe("driving_sounds_make", () => {
  it("makes Pine Ridge Rally's driving sounds with seed 1, and another take with another seed", (ctx) => {
    const passed = unlessPassedBefore(ctx, sounds);
    const one: Record<string, Buffer> = {}, two: Record<string, Buffer> = {};
    makeDriving(1, (f: string, b: Uint8Array | string) => (one[f] = Buffer.from(b)));
    for (const [f, b] of Object.entries(one)) expect(Buffer.compare(b, readFileSync(join(sounds, f))), f).toBe(0);
    makeDriving(2, (f: string, b: Uint8Array | string) => (two[f] = Buffer.from(b)));
    expect(Buffer.compare(two["tyre_gravel.wav"]!, one["tyre_gravel.wav"]!)).not.toBe(0);
    const again: Record<string, Buffer> = {};
    makeDriving(2, (f: string, b: Uint8Array | string) => (again[f] = Buffer.from(b)));
    expect(Buffer.compare(two["pop1.wav"]!, again["pop1.wav"]!)).toBe(0);
    passed();
  }, 120_000);

  // The first gravel had an 8 to 50 Hz flutter on its bed and 228 sharp, ringing grains a second in six narrow bands: heard as separate
  // pops. A dense loop has an envelope that is nearly the noise's own: little spread in its 1 ms level and almost no flutter of 16 to 64 Hz
  // beyond what noise itself has.
  const read = (bytes: Buffer) => { const n = (bytes.length - 44) / 2; const x = new Float64Array(n); for (let i = 0; i < n; i++) x[i] = bytes.readInt16LE(44 + 2 * i) / 32768; return x; };
  const stats = (x: Float64Array) => {
    const w = 44, m = Math.floor(x.length / w), env = new Float64Array(m);
    for (let i = 0; i < m; i++) { let a = 0; for (let j = 0; j < w; j++) a += x[i * w + j] ** 2; env[i] = Math.sqrt(a / w); }
    const mean = env.reduce((a, b) => a + b) / m;
    const cv = Math.sqrt(env.reduce((a, b) => a + (b - mean) ** 2, 0) / m) / mean;
    const n = 1 << Math.floor(Math.log2(m)), re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = env[i] - mean;
    fft(re, im);
    let flutter = 0, all = 0;
    for (let k = 1; k < n / 2; k++) { const f = (k * 1000) / n, e = re[k] ** 2 + im[k] ** 2; if (f >= 0.3 && f < 250) all += e; if (f >= 16 && f < 64) flutter += e; }
    return { cv, flutter: flutter / all };
  };
  it("makes the loose-surface loops dense and steady (no flutter, no separate pops), with a sliding layer and takes of a stone", () => {
    const made: Record<string, Buffer> = {};
    makeDriving(1, (f: string, b: Uint8Array | string) => (made[f] = Buffer.from(b)));
    for (const name of ["tyre_gravel", "tyre_dirt", "tyre_snow", "tyre_slide"]) {
      const s = stats(read(made[`${name}.wav`]!));
      expect(s.cv, `${name} level spread`).toBeLessThan(0.4); // (the first gravel: 0.57, dirt 0.50, snow 0.56; plain noise 0.12)
      expect(s.flutter, `${name} flutter share`).toBeLessThan(0.3); // (the first gravel: 0.52, dirt 0.39, snow 0.48; plain noise 0.19)
    }
    expect(Object.keys(made).filter((f) => /^stone\d\.wav$/.test(f)).length).toBeGreaterThanOrEqual(3);
    expect(JSON.parse(made["stone.group.json"]!.toString()).sounds.length).toBeGreaterThanOrEqual(3);
  }, 120_000);
});
