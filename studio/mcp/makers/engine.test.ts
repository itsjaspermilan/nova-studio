import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../server";
import { bandFiring, ENGINE_BASES, makeEngine } from "./engine-make";
import { firingOf } from "./index-engine";
// @ts-ignore (plain JavaScript)
import { engineLoop, firingHz, bandRpm, patternOrder, wavBytes } from "./engine.mjs";
// @ts-ignore
import { makeDriving } from "./driving.mjs";
// @ts-ignore (Pine Ridge Rally's recipes)
import { ENGINES as PINE } from "../../../scripts/rally/engines.mjs";

const sounds = new URL("../../../examples/pine-ridge-rally/sounds/", import.meta.url).pathname;
let dir = "";
beforeAll(() => (dir = mkdtempSync(join(tmpdir(), "nova-engine-test-"))));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("engine_make", () => {
  it("makes each of Pine Ridge Rally's engines from its recipe exactly (the first and last band, both layers)", () => {
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
  }, 120_000);

  it("fires at the layout's frequency in every band", () => {
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
  it("makes Pine Ridge Rally's driving sounds with seed 1, and another take with another seed", () => {
    const one: Record<string, Buffer> = {}, two: Record<string, Buffer> = {};
    makeDriving(1, (f: string, b: Uint8Array | string) => (one[f] = Buffer.from(b)));
    for (const [f, b] of Object.entries(one)) expect(Buffer.compare(b, readFileSync(join(sounds, f))), f).toBe(0);
    makeDriving(2, (f: string, b: Uint8Array | string) => (two[f] = Buffer.from(b)));
    expect(Buffer.compare(two["tyre_gravel.wav"]!, one["tyre_gravel.wav"]!)).not.toBe(0);
    const again: Record<string, Buffer> = {};
    makeDriving(2, (f: string, b: Uint8Array | string) => (again[f] = Buffer.from(b)));
    expect(Buffer.compare(two["pop1.wav"]!, again["pop1.wav"]!)).toBe(0);
  }, 120_000);
});
