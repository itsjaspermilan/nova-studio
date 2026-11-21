import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportGlb } from "../../src/lib/glb";
import { parseModel, serializeModel } from "../../src/lib/model-doc";
import { expandModel } from "../modelkit";
import { call } from "../server";
import { CAR_TYPES, LIMITS, makeCar } from "./car";

const pine = new URL("../../../examples/pine-ridge-rally/models/", import.meta.url).pathname;
/// What model_write would write for a model: expanded, read by the editor's parser, written back.
const written = (model: unknown) => {
  const p = parseModel(JSON.stringify(expandModel(model as Record<string, unknown>).model));
  if (!p.ok) throw new Error(p.error);
  return p.doc;
};
// Each type with no options is the car Pine Ridge Rally drives, byte for byte (its recipe: scripts/rally/cars.mjs).
const PINE: Record<string, string> = {
  modern_coupe: "car_gt", short_4x4: "car_offroad", city_car: "car_city", muscle_fastback: "car_muscle", gt_race: "car_gt2", family_hatch: "car_hatch",
  hot_hatch: "car_hatch_r", crew_cab_pickup: "car_pickup", rally_coupe: "car_rally", coupe_90s: "car_s14", aero_coupe: "car_s15", suv: "car_suv", truck_6x6: "car_truck",
};

describe("car_make", () => {
  it("makes each type with no options exactly as Pine Ridge Rally's car", () => {
    expect(CAR_TYPES.sort()).toEqual(Object.keys(PINE).sort());
    for (const type of CAR_TYPES) {
      const car = makeCar({ type });
      expect(serializeModel(written(car.model)), type).toBe(readFileSync(join(pine, `${PINE[type]}.model.json`), "utf8"));
    }
  });

  it("is the same car again for a seed and a visibly different one for another, with its wheels as parts", () => {
    for (const type of CAR_TYPES) {
      const a = makeCar({ type, seed: 5 }), b = makeCar({ type, seed: 5 }), c = makeCar({ type, seed: 6 });
      expect(JSON.stringify(a.model), type).toBe(JSON.stringify(b.model));
      expect(JSON.stringify(a.model), type).not.toBe(JSON.stringify(c.model));
      const names = a.model.parts.map((p: { name: string }) => p.name);
      expect(names.slice(0, 5), type).toEqual(["body", "wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr"]);
      if (type === "truck_6x6") expect(names).toContain("wheel_ml");
      // (every wheel stands on the ground: its centre is its radius up)
      for (const w of a.wheels) expect(w.y, `${type} ${w.name}`).toBeCloseTo(a.wheelRadius, 1);
    }
  });

  it("reshapes to the sizes asked for, within the limits, and says where it clamped", () => {
    const own = makeCar({ type: "coupe_90s" });
    const long = makeCar({ type: "coupe_90s", length: own.length * 1.1, height: own.height * 1.05, wheel: own.wheelRadius * 2 * 1.1, ride_height: 0.05 });
    expect(long.length).toBeCloseTo(own.length * 1.1, 1);
    expect(long.wheelbase).toBeCloseTo(own.wheelbase * 1.1, 1);
    expect(long.wheelRadius).toBeCloseTo(own.wheelRadius * 1.1, 1);
    expect(long.height).toBeGreaterThan(own.height * 1.05);
    expect(long.says).toEqual([]);
    const far = makeCar({ type: "coupe_90s", length: 9, width: 1 });
    expect(far.length).toBeCloseTo(own.length * LIMITS.length[1], 1);
    expect(far.says.join("\n")).toMatch(/length 9 m is past/);
    expect(far.says.join("\n")).toMatch(/width 1 m is past/);
  });

  it("takes style pieces off and puts them on", () => {
    const names = (o: Record<string, unknown>) => makeCar(o as never).model.parts[0].cubes.map((c: { name: string }) => c.name);
    expect(names({ type: "coupe_90s" })).toContain("spoiler");
    expect(names({ type: "coupe_90s", spoiler: false })).not.toContain("spoiler");
    expect(names({ type: "modern_coupe", spoiler: true })).toContain("spoiler");
    expect(names({ type: "family_hatch", spoiler: true })).toContain("roof spoiler");
    expect(names({ type: "family_hatch", roof_rails: true }).some((n: string) => n.startsWith("roof rail"))).toBe(true);
    expect(names({ type: "suv", flares: false }).some((n: string) => n.startsWith("flare"))).toBe(false);
    expect(names({ type: "city_car", flares: "paint" }).some((n: string) => n.startsWith("flare"))).toBe(true);
    expect(names({ type: "crew_cab_pickup", bed: "cover" })).toContain("bed cover");
  });

  it("builds a car from a whole spec", () => {
    const spec = {
      paint: "#2f6fc4",
      body: {
        w: [[-30, 10], [-26, 12.5], [0, 13], [26, 12.6], [30, 10]], yb: 3, ys: [[-30, 12], [0, 11.5], [30, 10]], top: [[-29, 13], [-20, 19], [0, 20], [12, 17], [16, 12.5], [30, 11]],
        rw: 10, profile: [[0, 0.93], [0.5, 1], [1, 0.9]],
        front: { zc: 26, L: 8, plan: [[0, 30], [8, 29.5], [12.6, 26]], side: [[3, 29.5], [6, 30], [10, 29.8]] },
        rear: { zc: -26, L: 6, plan: [[0, -30], [8, -29.6], [12.5, -26]], side: [[3, -29.5], [8, -30], [12, -29.8]] },
      },
      wheels: { R: 5, track: 11, z: [19, -19] },
      cuts: [{ view: "side", name: "side glass", points: { rounded: [[8, 12.5, 1], [-12, 12.5, 1], [-10, 17.5], [4, 17.8]] }, glass: true }, { view: "back", name: "tail lamp", mirror: true, points: { rrect: [7, 9, 11, 10.5] }, color: "#b01620", emissive: 0.45 }],
      pieces: [{ shape: "pebble", name: "mirror", mirror: true, a: [[13, 12.5, 6], [15.5, 12.6, 6.3], [15.6, 14.4, 6.4], [13.1, 14.4, 6.1]], b: [[12.9, 12.6, 8], [15.3, 12.7, 8.4], [15.4, 14.3, 8.5], [13, 14.3, 8.1]] }],
    };
    const car = makeCar({ spec });
    expect(car.type).toBe(null);
    expect(car.length).toBeCloseTo(3.75, 1);
    const doc = written(car.model);
    expect(doc.parts.length).toBe(5);
    expect(() => makeCar({ spec: { ...spec, cuts: [{ view: "sideways", points: [] }] } })).toThrow(/view is side, front, back, top or bottom/);
    expect(() => makeCar({ spec: { ...spec, body: { w: 1 } } })).toThrow(/body.yb/);
  });

  describe("through the tool", () => {
    let dir = "";
    beforeAll(() => (dir = mkdtempSync(join(tmpdir(), "nova-car-test-"))));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));
    it("writes the model, its paints, and the glb the studio's own export makes of it", () => {
      const r = call("car_make", { project: dir, name: "car", type: "city_car", seed: 3, length: 3.7, paints: { red: "#c4302b" }, preview: false });
      const said = (r.content[0] as { text: string }).text;
      expect(said).toMatch(/wheel_fl at x/);
      expect(said).toMatch(/rear lamps: x ±/);
      for (const name of ["car", "car_red"]) {
        const p = parseModel(readFileSync(join(dir, "models", `${name}.model.json`), "utf8"));
        if (!p.ok) throw new Error(p.error);
        expect(Buffer.compare(Buffer.from(exportGlb(p.doc)), readFileSync(join(dir, "models", `${name}.glb`))), name).toBe(0);
      }
    });
  });
});
