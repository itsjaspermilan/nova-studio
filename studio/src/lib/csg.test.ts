import { describe, expect, it } from "vitest";
import { booleanPieces, cutterPieces, meshOf, piecesOf, type BooleanOp } from "./csg";
import { signedVolume } from "./model-mesh";
import { toMesh } from "./mesh-edit";
import { type Cube } from "./model-doc";

const volumeOf = (m: { verts: [number, number, number][]; polys: { v: number[] }[] }) =>
  signedVolume({ shape: "mesh", from: [0, 0, 0], size: [0, 0, 0], color: "#fff", verts: m.verts, polys: m.polys } as Cube) / 6;
const box = (at: number, size: number): Cube => toMesh({ from: [at, at, at], size: [size, size, size], color: "#c9d1d9" });
const solid = (c: Cube) => piecesOf(c.verts!, c.polys!);
const run = (a: ReturnType<typeof solid>, b: ReturnType<typeof solid>, op: BooleanOp) => meshOf(booleanPieces(a, b, op));
/// Every edge is used by two polygons running opposite ways: a closed, consistently wound surface.
const closed = (m: { polys: { v: number[] }[] }) => {
  const dir = new Map<string, number>();
  for (const f of m.polys) f.v.forEach((a, k) => { const key = `${a}>${f.v[(k + 1) % f.v.length]}`; dir.set(key, (dir.get(key) ?? 0) + 1); });
  for (const [key, n] of dir) {
    const [a, b] = key.split(">");
    if (n !== 1 || dir.get(`${b}>${a}`) !== 1) return false;
  }
  return true;
};

describe("solid geometry", () => {
  // box A is 0..10, box B is 5..15: they overlap in a 5 cube (125); each is 1000
  const a = solid(box(0, 10));
  const b = solid(box(5, 10));
  it("a lone box has the volume it should", () => {
    expect(volumeOf(meshOf(a))).toBeCloseTo(1000, 3);
  });
  it("union adds the volumes less the overlap", () => {
    const u = run(a, b, "union");
    expect(volumeOf(u)).toBeCloseTo(1000 + 1000 - 125, 2);
    expect(closed(u)).toBe(true);
  });
  it("difference takes the overlap away from the first", () => {
    const d = run(a, b, "difference");
    expect(volumeOf(d)).toBeCloseTo(1000 - 125, 2);
    expect(closed(d)).toBe(true);
  });
  it("intersect keeps only the overlap", () => {
    const i = run(a, b, "intersect");
    expect(volumeOf(i)).toBeCloseTo(125, 2);
    expect(closed(i)).toBe(true);
  });
  it("a box with a hole drilled through it by a cylinder", () => {
    const drill = cutterPieces("cylinder", [5, 5, 5], [4, 20, 4], 32);
    const out = run(a, drill, "difference");
    // the cylinder is a 32-sided prism: area of a regular polygon of radius 2, 10 long
    const prism = 0.5 * 32 * 4 * Math.sin((Math.PI * 2) / 32) * 10;
    expect(volumeOf(out)).toBeCloseTo(1000 - prism, 1);
    expect(closed(out)).toBe(true);
  });
  it("a sphere cutter takes a bite out of a corner", () => {
    const bite = cutterPieces("sphere", [10, 10, 10], [8, 8, 8], 16);
    const out = run(a, bite, "difference");
    const full = volumeOf(meshOf(bite));
    expect(full).toBeGreaterThan(0);
    // an eighth of the sphere lies inside the box corner (and the rest outside it)
    expect(volumeOf(out)).toBeCloseTo(1000 - full / 8, 1);
    expect(closed(out)).toBe(true);
  });
  it("keeps the colours of the faces and a cutter's faces take the first solid's look", () => {
    const red = box(0, 10);
    red.polys!.forEach((f) => (f.color = "#ff0000"));
    const out = run(solid(red), b, "difference");
    expect(out.polys.some((f) => f.color === "#ff0000")).toBe(true);
  });
  it("two solids that do not touch: union keeps both, difference changes nothing, intersect is empty", () => {
    const far = solid(box(50, 10));
    expect(volumeOf(run(a, far, "union"))).toBeCloseTo(2000, 3);
    expect(volumeOf(run(a, far, "difference"))).toBeCloseTo(1000, 3);
    expect(run(a, far, "intersect").polys.length).toBe(0);
  });
});

import { checkModifier, evaluate, type Modifier } from "./modifiers";
describe("the boolean modifier", () => {
  it("carves a model's mesh, is checked, and runs in the stack", () => {
    const base = box(0, 10);
    const hole: Modifier = { type: "boolean", operation: "difference", shape: "cylinder", at: [5, 5, 5], size: [4, 20, 4] };
    expect(checkModifier(hole, "m")).toBeNull();
    expect(checkModifier({ type: "boolean", operation: "xor" }, "m")).toContain("operation");
    expect(checkModifier({ type: "boolean", shape: "cone" }, "m")).toContain("shape");
    expect(checkModifier({ type: "boolean", at: [1, 2] }, "m")).toContain("three numbers");
    const out = evaluate({ ...base, modifiers: [hole] });
    expect(out.polys!.length).toBeGreaterThan(12);
    expect(volumeOf({ verts: out.verts as [number, number, number][], polys: out.polys! })).toBeLessThan(1000);
    expect(volumeOf({ verts: out.verts as [number, number, number][], polys: out.polys! })).toBeGreaterThan(850);
  });
});
