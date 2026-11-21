import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseModel, serializeModel } from "../../src/lib/model-doc";
import { expandModel } from "../modelkit";
// @ts-ignore (Pine Ridge Rally's recipe: which preset each of its models is)
import { SCENERY } from "../../../scripts/rally/scenery.mjs";
import { DETAILED_KINDS, makeScenery, speciesOf } from "./scenery";

const pine = new URL("../../../examples/pine-ridge-rally/models/", import.meta.url).pathname;
const written = (model: unknown) => {
  const p = parseModel(JSON.stringify(expandModel(model as Record<string, unknown>).model));
  if (!p.ok) throw new Error(p.error);
  return p.doc;
};
const NATURAL = ["broadleaf", "conifer", "dead_tree", "shrub", "grass", "flowers", "cactus", "boulder", "log", "stump", "mesa", "mountain", "cloud"];

describe("prop3d_make's detailed kinds", () => {
  it("make every one of Pine Ridge Rally's scenery models exactly, from its recipe", () => {
    expect(SCENERY.length).toBeGreaterThan(110);
    for (const it of SCENERY as { kind: string; name: string }[]) {
      const prop = makeScenery({ ...it, style: "detailed", colliders: false }, it.name);
      expect(serializeModel(written(prop.model)), it.name).toBe(readFileSync(join(pine, `${it.name}.model.json`), "utf8"));
    }
  }, 120_000);

  it("make each kind and species again for a seed, grow another tree for another, and stand on the ground with what blocks", () => {
    for (const kind of DETAILED_KINDS) for (const species of speciesOf(kind)) {
      const a = makeScenery({ kind, species, seed: 3 }, "x"), b = makeScenery({ kind, species, seed: 3 }, "x");
      expect(JSON.stringify(a.model), `${kind} ${species}`).toBe(JSON.stringify(b.model));
      if (NATURAL.includes(kind) && kind !== "mesa") expect(JSON.stringify(a.model), `${kind} ${species} by seed`).not.toBe(JSON.stringify(makeScenery({ kind, species, seed: 4 }, "x").model));
      written(a.model);
      // (the nk_ presets bury their feet a little, as the kit models did; nothing floats)
      expect(a.size.h, `${kind} ${species}`).toBeGreaterThan(0.005);
      if (a.entity.solid) expect((a.model.colliders?.length ?? 0) + (a.model.boxes?.length ?? 0), `${kind} ${species} blocks`).toBeGreaterThan(0);
    }
    expect(makeScenery({ kind: "spectator", species: "man_a" }, "fan").model.clips.map((c: { name: string }) => c.name)).toEqual(["static", "idle", "watch", "cheer", "clap", "wave"]);
  }, 120_000);

  it("takes the season from the palette, and a height", () => {
    const snow = makeScenery({ kind: "conifer", palette: "snow" }, "t"), plain = makeScenery({ kind: "conifer" }, "t");
    expect(JSON.stringify(snow.model)).not.toBe(JSON.stringify(plain.model));
    expect(makeScenery({ kind: "conifer", height: 5 }, "t").size.h).toBeCloseTo(5, 0);
    expect(() => makeScenery({ kind: "conifer", species: "palm" }, "t")).toThrow(/species are tall_a/);
    expect(() => makeScenery({ kind: "grandstand", height: 9 }, "t")).toThrow(/built to measure/);
  });
});
