import { describe, expect, it } from "vitest";
import { edgeLoop, edgeRing, pointsOfEdges, selectSimilarFaces } from "./mesh-select";
import { subdivide, toMesh } from "./mesh-edit";
import type { Cube } from "./model-doc";

/// A cube divided once: every face is four quads, 26 points.
const grid = (): Cube => subdivide(toMesh({ from: [0, 0, 0], size: [10, 10, 10], color: "#fff" }));
const at = (c: Cube, x: number, y: number, z: number) => c.verts!.findIndex((p) => Math.abs(p[0] - x) < 1e-6 && Math.abs(p[1] - y) < 1e-6 && Math.abs(p[2] - z) < 1e-6);

describe("edge loops", () => {
  it("a loop round the middle of a divided cube comes back on itself: eight edges at y = 5", () => {
    const c = grid();
    const loop = edgeLoop(c, at(c, 0, 5, 0), at(c, 5, 5, 0));
    expect(loop.length).toBe(8);
    for (const [p, q] of loop) {
      expect(c.verts![p]![1]).toBeCloseTo(5, 6);
      expect(c.verts![q]![1]).toBeCloseTo(5, 6);
    }
    expect(pointsOfEdges(loop).length).toBe(8);
  });
  it("a loop that starts anywhere along it is the same loop", () => {
    const c = grid();
    const a = edgeLoop(c, at(c, 0, 5, 0), at(c, 5, 5, 0)).map((e) => e.slice().sort().join()).sort();
    const b = edgeLoop(c, at(c, 10, 5, 5), at(c, 10, 5, 10)).map((e) => e.slice().sort().join()).sort();
    expect(a).toEqual(b);
  });
  it("stops at a point where the edges do not meet four at a time", () => {
    const c = toMesh({ from: [0, 0, 0], size: [10, 10, 10], color: "#fff" }); // a plain box: corners have three edges
    expect(edgeLoop(c, 0, c.verts!.findIndex((_, i) => i !== 0 && Math.hypot(...(c.verts![i]!.map((v, k) => v - c.verts![0]![k]!) as number[])) === 10)).length).toBe(1);
    expect(edgeLoop(c, 0, 99)).toEqual([]);
  });
});

describe("edge rings", () => {
  it("runs across the quads parallel to the edge", () => {
    const c = grid();
    const ring = edgeRing(c, at(c, 0, 0, 0), at(c, 5, 0, 0)); // an edge along x on the bottom front
    // all of them run along x (same y and z at both ends), going round the cube through the quads
    expect(ring.length).toBeGreaterThanOrEqual(4);
    for (const [p, q] of ring) {
      const dx = Math.abs(c.verts![p]![0] - c.verts![q]![0]);
      expect(dx).toBeCloseTo(5, 6);
    }
  });
  it("is just the one edge when there is no quad beside it", () => {
    expect(edgeRing({ shape: "mesh", from: [0, 0, 0], size: [1, 1, 0], color: "#fff", verts: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], polys: [{ v: [0, 1, 2] }] } as Cube, 0, 1)).toEqual([[0, 1]]);
  });
});

describe("select similar", () => {
  it("by normal picks the faces that face the same way (a divided cube's face is four quads)", () => {
    const c = grid();
    const top = c.polys!.findIndex((f) => f.v.every((i) => c.verts![i]![1] === 10));
    expect(selectSimilarFaces(c, top, "normal").length).toBe(4);
  });
  it("by sides picks quads or triangles, and by area the faces of about the same size", () => {
    const c = grid();
    expect(selectSimilarFaces(c, 0, "sides").length).toBe(24);
    expect(selectSimilarFaces(c, 0, "area", 5).length).toBe(24);
    expect(selectSimilarFaces(c, 99, "sides")).toEqual([]);
    const box = toMesh({ from: [0, 0, 0], size: [10, 20, 10], color: "#fff" });
    const big = box.polys!.findIndex((f) => f.v.every((i) => box.verts![i]![2] === 0)); // a 10 by 20 face
    expect(selectSimilarFaces(box, big, "area", 5).length).toBe(4); // the four 10 by 20 sides
  });
});

import { edgeSlide } from "./mesh-select";
describe("edge slide", () => {
  /// A flat 3 by 1 strip of quads along x: points (0..3, 0, 0) and (0..3, 0, 1); the middle edges at x = 1 and x = 2 run along z.
  const strip = (): Cube => ({
    shape: "mesh", from: [0, 0, 0], size: [3, 0, 1], color: "#fff",
    verts: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0], [0, 0, 1], [1, 0, 1], [2, 0, 1], [3, 0, 1]],
    polys: [{ v: [0, 4, 5, 1] }, { v: [1, 5, 6, 2] }, { v: [2, 6, 7, 3] }],
  } as Cube);
  it("slides the edge along the quads beside it, both ways, and does nothing for 0", () => {
    const c = strip();
    // the edge between points 1 and 5 has the first quad (0 4 5 1) and the second (1 5 6 2) beside it
    const toFirst = edgeSlide(c, 1, 5, 0.5);
    expect(toFirst.verts![1]![0]).toBeCloseTo(0.5, 6);
    expect(toFirst.verts![5]![0]).toBeCloseTo(0.5, 6);
    const toSecond = edgeSlide(c, 1, 5, -0.5);
    expect(toSecond.verts![1]![0]).toBeCloseTo(1.5, 6);
    expect(toSecond.verts![5]![0]).toBeCloseTo(1.5, 6);
    expect(edgeSlide(c, 1, 5, 0).verts).toEqual(c.verts);
    expect(c.verts![1]![0]).toBe(1); // the source is untouched
  });
  it("a full slide lands on the neighbour, an edge on the border has only one side, and a bad edge changes nothing", () => {
    const c = strip();
    expect(edgeSlide(c, 1, 5, 1).verts![1]![0]).toBeCloseTo(0, 6);
    const border = edgeSlide(c, 0, 4, -0.5); // a border edge has one face only: the second side is not there
    expect(border.verts).toEqual(c.verts);
    expect(edgeSlide(c, 0, 7, 0.5).verts).toEqual(c.verts);
    expect(edgeSlide(c, 1, 5, 9).verts![1]![0]).toBeCloseTo(0, 6); // held to a whole slide
  });
});
