import { describe, expect, it } from "vitest";
import { distanceFactor, mapVerts, medianOf, rotateAbout, scaleAbout, sweepAngle } from "./point-transform";
import type { Cube } from "./model-doc";

const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 9));

describe("scaling and turning points", () => {
  it("scales about a pivot, on every axis or on one", () => {
    close(scaleAbout([4, 2, 0], [2, 2, 0], [2, 2, 2]), [6, 2, 0]);
    close(scaleAbout([4, 4, 4], [0, 0, 0], [1, 0.5, 1]), [4, 2, 4]);
    close(scaleAbout([5, 5, 5], [5, 5, 5], [3, 3, 3]), [5, 5, 5]);
  });
  it("turns a quarter about each axis, right-handed, and keeps the distance from the pivot", () => {
    close(rotateAbout([1, 0, 0], [0, 0, 0], [0, 0, 1], Math.PI / 2), [0, 1, 0]);
    close(rotateAbout([0, 1, 0], [0, 0, 0], [1, 0, 0], Math.PI / 2), [0, 0, 1]);
    close(rotateAbout([0, 0, 1], [0, 0, 0], [0, 1, 0], Math.PI / 2), [1, 0, 0]);
    const p = rotateAbout([3, 1, 2], [1, 1, 1], [1, 2, 3], 0.7);
    expect(Math.hypot(p[0] - 1, p[1] - 1, p[2] - 1)).toBeCloseTo(Math.hypot(2, 0, 1), 9);
  });
  it("turns about a pivot that is not the origin, and a point on the axis stays", () => {
    close(rotateAbout([3, 1, 0], [2, 1, 0], [0, 0, 1], Math.PI), [1, 1, 0]);
    close(rotateAbout([2, 1, 5], [2, 1, 0], [0, 0, 1], 1.2), [2, 1, 5]);
    close(rotateAbout([1, 2, 3], [0, 0, 0], [0, 0, 0], 1), [1, 2, 3]);
  });
  it("finds the median, and changes only the chosen points of a mesh", () => {
    expect(medianOf([[0, 0, 0], [2, 4, 6]])).toEqual([1, 2, 3]);
    const c = { shape: "mesh", from: [0, 0, 0], size: [2, 2, 2], color: "#fff", verts: [[0, 0, 0], [2, 0, 0], [2, 2, 0]], polys: [{ v: [0, 1, 2] }] } as Cube;
    const out = mapVerts(c, [1, 2], (p) => scaleAbout(p, [1, 1, 0], [2, 2, 2]));
    expect(out.verts![0]).toEqual([0, 0, 0]);
    expect(out.verts![1]).toEqual([3, -1, 0]);
    expect(c.verts![1]).toEqual([2, 0, 0]);
  });
  it("the mouse going a quarter turn round the pivot is 90 degrees, either way, and the distance ratio is the factor", () => {
    expect(sweepAngle({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(Math.PI / 2, 9);
    expect(sweepAngle({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: -10 })).toBeCloseTo(-Math.PI / 2, 9);
    expect(sweepAngle({ x: 0, y: 0 }, { x: -10, y: 1 }, { x: -10, y: -1 })).toBeCloseTo(0.2, 1);
    expect(distanceFactor(50, 100)).toBe(2);
    expect(distanceFactor(0.2, 100)).toBe(1);
    expect(distanceFactor(50, 0)).toBe(0.01);
  });
});
