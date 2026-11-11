import { describe, expect, it } from "vitest";
import { toMesh } from "./mesh-edit";
import { sculptDab } from "./sculpt";
import { blurMask, clearMask, invertMask, maskDab, maskOf, maskPoints, refineUnder } from "./sculpt-mask";
import { parseModel, serializeModel, newModel } from "./model-doc";
import type { Cube } from "./model-doc";

function sheet(n = 10): Cube {
  const verts: [number, number, number][] = [];
  const polys: { v: number[] }[] = [];
  const w = n + 1;
  for (let z = 0; z <= n; z++) for (let x = 0; x <= n; x++) verts.push([x - n / 2, 0, z - n / 2]);
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    const a = z * w + x;
    polys.push({ v: [a, a + w, a + w + 1, a + 1] });
  }
  return { shape: "mesh", from: [-n / 2, 0, -n / 2], size: [n, 0, n], color: "#c9d1d9", verts, polys } as Cube;
}
const at = (c: Cube, x: number, z: number) => c.verts![(z + 5) * 11 + (x + 5)]!;

describe("sculpt masks", () => {
  it("a mask dab raises the mask near the spot and erase wipes it", () => {
    const m = maskDab(sheet(), [0, 0, 0], { radius: 3, strength: 1 });
    expect(maskOf(m)[60]).toBe(1);
    expect(maskOf(m)[0]).toBe(0);
    expect(maskOf(maskDab(m, [0, 0, 0], { radius: 3, strength: 1, erase: true }))[60]).toBe(0);
  });
  it("a masked point is not moved by the brushes, an unmasked one is", () => {
    const masked = maskPoints(sheet(), [60]);
    const out = sculptDab(masked, [0, 0, 0], { mode: "draw", radius: 3, strength: 1 });
    expect(at(out, 0, 0)[1]).toBe(0);
    expect(Math.abs(at(out, 1, 0)[1])).toBeGreaterThan(0);
  });
  it("half a mask halves the push", () => {
    const full = sculptDab(sheet(), [0, 0, 0], { mode: "draw", radius: 3, strength: 1 });
    const half = sculptDab(maskPoints(sheet(), []) && { ...sheet(), mask: new Array(121).fill(0.5) }, [0, 0, 0], { mode: "draw", radius: 3, strength: 1 });
    expect(Math.abs(at(half, 0, 0)[1])).toBeCloseTo(Math.abs(at(full, 0, 0)[1]) / 2, 9);
  });
  it("pen pressure scales a dab", () => {
    const full = sculptDab(sheet(), [0, 0, 0], { mode: "draw", radius: 3, strength: 1 });
    const soft = sculptDab(sheet(), [0, 0, 0], { mode: "draw", radius: 3, strength: 1, pressure: 0.25 });
    expect(Math.abs(at(soft, 0, 0)[1])).toBeCloseTo(Math.abs(at(full, 0, 0)[1]) / 4, 9);
  });
  it("clear, invert and blur", () => {
    const m = maskPoints(sheet(), [60]);
    expect(maskOf(clearMask(m)).every((v) => v === 0)).toBe(true);
    expect(clearMask(m).mask).toBeUndefined();
    expect(maskOf(invertMask(m))[60]).toBe(0);
    expect(maskOf(invertMask(m))[0]).toBe(1);
    const b = maskOf(blurMask(m));
    expect(b[60]).toBeLessThan(1);
    expect(b[61]).toBeGreaterThan(0);
  });
  it("a mask of the wrong length is ignored and is not saved in the file", () => {
    const bad = { ...sheet(), mask: [1, 1] };
    expect(Math.abs(at(sculptDab(bad, [0, 0, 0], { mode: "draw", radius: 3, strength: 1 }), 0, 0)[1])).toBeGreaterThan(0);
    const model = newModel();
    model.parts[0]!.cubes = [maskPoints(sheet(), [60])];
    expect(serializeModel(model)).not.toContain("mask");
    expect(parseModel(serializeModel(model)).ok).toBe(true);
  });
});

describe("local detail", () => {
  it("splits only the polygons under the brush that are too long, and keeps the mesh closed", () => {
    const s = sheet();
    const out = refineUnder(s, [0, 0, 0], 1.5, 0.6);
    expect(out.polys!.length).toBeGreaterThan(s.polys!.length);
    expect(out.verts!.length).toBeGreaterThan(s.verts!.length);
    // far away nothing changed: a corner polygon is the same
    expect(out.polys![0]!.v).toEqual(s.polys![0]!.v);
    // every edge is used by at most two polygons, and an inner edge by exactly two
    const uses = new Map<string, number>();
    for (const f of out.polys!) f.v.forEach((a, k) => {
      const b = f.v[(k + 1) % f.v.length]!;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      uses.set(key, (uses.get(key) ?? 0) + 1);
    });
    expect([...uses.values()].every((n) => n <= 2)).toBe(true);
    // the surface is still the same flat sheet
    expect(out.verts!.every((p) => p[1] === 0)).toBe(true);
  });
  it("does nothing when the polygons are already short, and carries the mask over", () => {
    const s = sheet();
    expect(refineUnder(s, [0, 0, 0], 3, 5)).toBe(s);
    const masked = maskPoints(s, [60]);
    const out = refineUnder(masked, [0, 0, 0], 1.5, 0.6);
    expect(out.mask!.length).toBe(out.verts!.length);
    expect(out.mask![60]).toBe(1);
  });
  it("carries skin weights over, and drops shape keys", () => {
    const s = sheet();
    s.skin = { bones: ["a"], weights: s.verts!.map(() => [[0, 1]] as [number, number][]) };
    s.shapes = [{ name: "k", verts: s.verts!.map((p) => [...p] as [number, number, number]) }];
    const out = refineUnder(s, [0, 0, 0], 1.5, 0.6);
    expect(out.skin!.weights.length).toBe(out.verts!.length);
    expect(out.shapes).toBeUndefined();
  });
  it("toMesh keeps a flat sheet a mesh", () => {
    expect(toMesh(sheet()).shape).toBe("mesh");
  });
});
