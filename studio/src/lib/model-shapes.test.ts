import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exportGlb } from "./glb";
import { extrudeFace, toMesh } from "./mesh-edit";
import type { Cube, ModelDoc } from "./model-doc";
import { meshOf, signedVolume } from "./model-mesh";

// One of every shape, side by side, at 1/16 scale. crates/nova-runtime/tests/fixtures/studio_model_shapes.glb is
// what the exporter writes for it, and the Rust test `studio_shapes_load_and_wind_outwards` loads that file with the
// real importer and checks the numbers below.
const at = (x: number, extra: Partial<Cube>): Cube => ({ from: [x, 0, 0], size: [8, 8, 8], color: "#c9d1d9", ...extra });
const tower = (() => {
  const base = toMesh(at(80, {}));
  const up = base.polys!.findIndex((_, i) => base.verts![base.polys![i]!.v[0]!]![1] === 8 && base.polys![i]!.v.every((v) => base.verts![v]![1] === 8));
  return extrudeFace(base, up, 4).cube;
})();
const shapes: Cube[] = [
  at(0, {}),
  at(10, { shape: "wedge" }),
  at(20, { shape: "pyramid", rotation: [0, 45, 0] }),
  at(30, { shape: "cylinder", segments: 8 }),
  at(40, { shape: "cone", segments: 8, color: "#ff8800" }),
  at(50, { shape: "sphere", segments: 8 }),
  at(60, { shape: "box", rotation: [0, 0, 30] }),
  tower,
];
const doc: ModelDoc = { version: 1, scale: 1 / 16, parts: [{ name: "shapes", origin: [0, 0, 0], rotation: [0, 0, 0], cubes: shapes, children: [] }] };

/// The values the Rust test expects (model units, before the 1/16 scale).
const EXPECTED = {
  vertices: shapes.reduce((n, c) => n + meshOf(c).positions.length / 3, 0),
  triangles: shapes.reduce((n, c) => n + meshOf(c).indices.length / 3, 0),
  volume: shapes.reduce((n, c) => n + signedVolume(c) / 6, 0),
};

describe("the shapes fixture", () => {
  it("has the volumes of its solids", () => {
    const v = (i: number) => signedVolume(shapes[i]!) / 6;
    expect(v(0)).toBeCloseTo(512, 6);
    expect(v(1)).toBeCloseTo(256, 6);
    expect(v(2)).toBeCloseTo(512 / 3, 6);
    expect(v(3)).toBeCloseTo(0.5 * 8 * 16 * Math.SQRT1_2 * 8, 6);
    expect(v(4)).toBeCloseTo((0.5 * 8 * 16 * Math.SQRT1_2 * 8) / 3, 6);
    expect(v(6)).toBeCloseTo(512, 6);
    expect(v(7)).toBeCloseTo(8 * 8 * 12, 6);
    expect(EXPECTED.vertices).toBe(314);
    expect(EXPECTED.triangles).toBe(148);
    expect(EXPECTED.volume).toBeCloseTo(2907.39778661252, 6);
  });

  it("matches the committed fixture byte for byte (UPDATE_FIXTURES=1 rewrites it)", () => {
    const fixture = new URL("../../../crates/nova-runtime/tests/fixtures/studio_model_shapes.glb", import.meta.url);
    const bytes = exportGlb(doc);
    if (process.env.UPDATE_FIXTURES || !existsSync(fixture)) writeFileSync(fixture, bytes);
    expect(Array.from(readFileSync(fixture))).toEqual(Array.from(bytes));
  });
});
