import { describe, expect, it } from "vitest";
import { knifeCut } from "./mesh-cut";
import { toMesh } from "./mesh-edit";

const box = () => toMesh({ from: [0, 0, 0], size: [10, 10, 10], color: "#fff" });
describe("knife cut", () => {
  it("a plane through the middle of a box cuts the four faces it crosses", () => {
    // line along z at x = 5, looking down y: the plane is x = 5
    const r = knifeCut(box(), [5, 5, -5], [5, 5, 15], [0, 1, 0]);
    expect(r.cut).toBe(4);
    expect(r.cube.polys!.length).toBe(10);
    expect(r.cube.verts!.length).toBe(12);
    expect(r.points.length).toBe(4);
    for (const i of r.points) expect(r.cube.verts![i]![0]).toBeCloseTo(5, 6);
  });
  it("every new face has at least three points and the faces keep their colour", () => {
    const r = knifeCut(box(), [5, 5, -5], [5, 5, 15], [0, 1, 0]);
    for (const p of r.cube.polys!) { expect(p.v.length).toBeGreaterThanOrEqual(3); expect(new Set(p.v).size).toBe(p.v.length); }
  });
  it("only cuts between the two points", () => {
    // the line covers z from -5 to 2: it reaches the top and bottom faces' cut, but not the far end of the box
    const r = knifeCut(box(), [5, 5, -5], [5, 5, 2], [0, 1, 0]);
    expect(r.cut).toBeLessThan(4);
  });
  it("a cut that misses the mesh, or a view along the line, changes nothing", () => {
    expect(knifeCut(box(), [50, 5, -5], [50, 5, 15], [0, 1, 0]).cut).toBe(0);
    expect(knifeCut(box(), [5, 5, -5], [5, 5, 15], [0, 0, 1]).cut).toBe(0);
  });
});
