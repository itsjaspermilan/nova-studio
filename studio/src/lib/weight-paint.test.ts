import { describe, expect, it } from "vitest";
import { paintWeights } from "./model-skin";
import type { Cube } from "./model-doc";

/// A row of five points along x (0 to 4) with edges between neighbours, all held by "a", two bones listed.
function strip(): Cube {
  return {
    shape: "mesh", from: [0, 0, 0], size: [4, 0, 1], color: "#fff",
    verts: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0]],
    polys: [{ v: [0, 1, 1] }, { v: [1, 2, 2] }, { v: [2, 3, 3] }, { v: [3, 4, 4] }],
    skin: { bones: ["a", "b"], weights: [[[0, 1]], [[0, 1]], [[0, 1]], [[0, 1]], [[0, 1]]] },
  } as Cube;
}
const held = (c: Cube, p: number, bone: number) => c.skin!.weights[p]!.reduce((n, [b, w]) => (b === bone ? n + w : n), 0);
const sums = (c: Cube) => c.skin!.weights.every((w) => Math.abs(w.reduce((n, [, x]) => n + x, 0) - 1) < 0.002 && w.length <= 4);

describe("painting weights", () => {
  it("add raises a bone under the brush, most at the centre, and the rest still add up to one", () => {
    const out = paintWeights(strip(), [2, 0, 0], { bone: "b", mode: "add", radius: 2, strength: 1, falloff: "linear" });
    expect(held(out, 2, 1)).toBeCloseTo(1, 3);
    expect(held(out, 1, 1)).toBeCloseTo(0.5, 3);
    expect(held(out, 0, 1)).toBe(0); // outside the radius
    expect(held(out, 1, 0)).toBeCloseTo(0.5, 3);
    expect(sums(out)).toBe(true);
  });
  it("strength scales the dab, and the source is not changed", () => {
    const s = strip();
    const half = paintWeights(s, [2, 0, 0], { bone: "b", mode: "add", radius: 1.5, strength: 0.5, falloff: "constant" });
    expect(held(half, 2, 1)).toBeCloseTo(0.5, 3);
    expect(held(s, 2, 1)).toBe(0);
  });
  it("subtract lowers a bone and hands the weight to the others", () => {
    const painted = paintWeights(strip(), [2, 0, 0], { bone: "b", mode: "add", radius: 5, strength: 0.5, falloff: "constant" });
    const out = paintWeights(painted, [2, 0, 0], { bone: "b", mode: "subtract", radius: 1.5, strength: 0.5, falloff: "constant" });
    expect(held(out, 2, 1)).toBeCloseTo(0.25, 3);
    expect(held(out, 2, 0)).toBeCloseTo(0.75, 3);
    expect(held(out, 4, 1)).toBeCloseTo(0.5, 3); // outside the brush
    // a point held by one bone alone cannot lose it: there is nothing to give the weight to
    expect(held(paintWeights(strip(), [2, 0, 0], { bone: "a", mode: "subtract", radius: 1, strength: 1 }), 2, 0)).toBe(1);
    expect(sums(out)).toBe(true);
  });
  it("smooth blends a point's weights with its neighbours'", () => {
    const sharp = paintWeights(strip(), [2, 0, 0], { bone: "b", mode: "add", radius: 0.5, strength: 1, falloff: "constant" });
    expect(held(sharp, 2, 1)).toBe(1);
    const out = paintWeights(sharp, [2, 0, 0], { bone: "b", mode: "smooth", radius: 0.5, strength: 1, falloff: "constant" });
    expect(held(out, 2, 1)).toBeLessThan(1);
    expect(held(out, 2, 1)).toBeGreaterThan(0);
    expect(sums(out)).toBe(true);
  });
  it("adds a bone that is not listed yet, and leaves an unskinned mesh alone", () => {
    const out = paintWeights(strip(), [2, 0, 0], { bone: "c", mode: "add", radius: 1, strength: 1 });
    expect(out.skin!.bones).toEqual(["a", "b", "c"]);
    const bare = { ...strip(), skin: undefined };
    expect(paintWeights(bare, [0, 0, 0], { bone: "a", mode: "add", radius: 9, strength: 1 })).toBe(bare);
  });
  it("keeps at most four bones on a point", () => {
    let c = strip();
    for (const b of ["b", "c", "d", "e", "f"]) c = paintWeights(c, [2, 0, 0], { bone: b, mode: "add", radius: 0.5, strength: 0.4, falloff: "constant" });
    expect(c.skin!.weights[2]!.length).toBeLessThanOrEqual(4);
    expect(sums(c)).toBe(true);
  });
});

import { mirrorWeights } from "./model-skin";
describe("mirroring weights", () => {
  /// Four points: two left (x +2 and +1, held by "left arm") and their mirrors (x -2, -1, painted other ways), and a point on the middle.
  const mesh = (): Cube => ({
    shape: "mesh", from: [-2, 0, 0], size: [4, 1, 1], color: "#fff",
    verts: [[2, 0, 0], [1, 1, 0], [-2, 0, 0], [-1, 1, 0], [0, 0, 1]],
    polys: [{ v: [0, 1, 3] }, { v: [0, 3, 2] }, { v: [1, 2, 4] }],
    skin: { bones: ["body/left arm", "body/right arm", "body"], weights: [[[0, 1]], [[0, 0.6], [2, 0.4]], [[2, 1]], [[2, 1]], [[2, 1]]] },
  } as Cube);
  const heldBy = (c: Cube, p: number) => c.skin!.weights[p]!.map(([b, w]) => `${c.skin!.bones[b]}:${w}`);
  it("gives each point's weights to its mirror, swapping left bones for right ones", () => {
    const r = mirrorWeights(mesh(), "positive");
    expect(r.set).toBe(2);
    expect(heldBy(r.cube, 2)).toEqual(["body/right arm:1"]);
    expect(heldBy(r.cube, 3)).toEqual(["body/right arm:0.6", "body:0.4"]);
    expect(heldBy(r.cube, 4)).toEqual(["body:1"]); // on the middle plane: untouched
    expect(heldBy(r.cube, 0)).toEqual(["body/left arm:1"]); // the source side is as it was
  });
  it("can go the other way, adds a bone the other side needs, and leaves an unskinned mesh alone", () => {
    const m = mesh();
    m.skin!.bones = ["body/left arm", "body", "x"];
    m.skin!.weights = [[[0, 1]], [[0, 1]], [[1, 1]], [[1, 1]], [[1, 1]]];
    const r = mirrorWeights(m, "positive");
    expect(r.cube.skin!.bones).toContain("body/right arm");
    const back = mirrorWeights(r.cube, "negative");
    expect(heldBy(back.cube, 0)).toEqual(["body/left arm:1"]);
    expect(mirrorWeights({ ...mesh(), skin: undefined }).set).toBe(0);
  });
  it("skips a point with no partner at the mirrored place", () => {
    const m = mesh();
    m.verts![2] = [-3, 0, 0];
    const r = mirrorWeights(m, "positive");
    expect(r.set).toBe(1);
    expect(heldBy(r.cube, 2)).toEqual(["body:1"]);
  });
});

import { gradientWeights } from "./model-skin";
describe("weight gradients and picked points", () => {
  it("blends two bones along an axis, whole at the ends and beyond them", () => {
    const out = gradientWeights(strip(), "a", "b", 0, 1, 3);
    expect(held(out, 0, 0)).toBe(1); // before the start: bone a
    expect(held(out, 1, 0)).toBe(1);
    expect(held(out, 2, 0)).toBeCloseTo(0.5, 3);
    expect(held(out, 2, 1)).toBeCloseTo(0.5, 3);
    expect(held(out, 3, 1)).toBe(1);
    expect(held(out, 4, 1)).toBe(1); // beyond the end: bone b
    expect(sums(out)).toBe(true);
    expect(gradientWeights(strip(), "a", "b", 0, 2, 2).skin).toEqual(strip().skin); // no span: nothing
  });
  it("only touches the picked points when some are given", () => {
    const out = gradientWeights(strip(), "a", "b", 0, 0, 4, [2]);
    expect(held(out, 2, 1)).toBeCloseTo(0.5, 3);
    expect(held(out, 3, 1)).toBe(0);
    expect(held(out, 0, 0)).toBe(1);
  });
  it("the weight brush can be limited to picked points", () => {
    const out = paintWeights(strip(), [2, 0, 0], { bone: "b", mode: "add", radius: 5, strength: 1, falloff: "constant", only: new Set([1, 2]) });
    expect(held(out, 1, 1)).toBeCloseTo(1, 3);
    expect(held(out, 2, 1)).toBeCloseTo(1, 3);
    expect(held(out, 3, 1)).toBe(0);
    expect(held(out, 0, 1)).toBe(0);
  });
});
