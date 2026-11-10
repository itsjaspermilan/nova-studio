import { describe, expect, it } from "vitest";
import { toMesh } from "./mesh-edit";
import { checkModifier, evaluate, newModifier, type Soup } from "./modifiers";
import { lattice, shrinkwrap, wireframe, ZERO_LATTICE } from "./modifier-more";
import { signedVolume } from "./model-mesh";
import { type Cube } from "./model-doc";

const box = (size = 10): Cube => toMesh({ from: [0, 0, 0], size: [size, size, size], color: "#c9d1d9" });
const soupOf = (c: Cube): Soup => ({ verts: c.verts!.map((p) => [...p] as [number, number, number]), polys: c.polys! });
const volume = (s: Soup) => signedVolume({ shape: "mesh", from: [0, 0, 0], size: [0, 0, 0], color: "#fff", verts: s.verts, polys: s.polys }) / 6;
const closed = (s: Soup) => {
  const dir = new Map<string, number>();
  for (const f of s.polys) f.v.forEach((a, k) => { const key = `${a}>${f.v[(k + 1) % f.v.length]}`; dir.set(key, (dir.get(key) ?? 0) + 1); });
  for (const [key, n] of dir) {
    const [a, b] = key.split(">");
    if (n !== 1 || dir.get(`${b}>${a}`) !== 1) return false;
  }
  return true;
};

describe("wireframe", () => {
  it("makes a bar for each edge, each a closed solid with the volume of its section", () => {
    const w = wireframe(soupOf(box()), 1);
    expect(w.verts.length).toBe(12 * 8);
    expect(w.polys.length).toBe(12 * 6);
    expect(closed(w)).toBe(true);
    // twelve bars 10 long and 1 by 1 across
    expect(Math.abs(volume(w))).toBeCloseTo(12 * 10, 3);
    expect(volume(w)).toBeGreaterThan(0); // wound outwards
  });
  it("is thicker with a larger thickness and keeps the polygon colours", () => {
    const c = box();
    c.polys![0]!.color = "#ff0000";
    const thin = Math.abs(volume(wireframe(soupOf(c), 0.5)));
    const thick = Math.abs(volume(wireframe(soupOf(c), 1)));
    expect(thick).toBeCloseTo(thin * 4, 3);
    expect(wireframe(soupOf(c), 1).polys.some((f) => f.color === "#ff0000")).toBe(true);
  });
});

describe("shrinkwrap", () => {
  const dist = (p: number[], c: number[]) => Math.hypot(p[0]! - c[0]!, p[1]! - c[1]!, p[2]! - c[2]!);
  it("puts every point on a sphere about the mesh's centre", () => {
    const r = shrinkwrap(soupOf(box()), "sphere", 1, 1, 6);
    for (const p of r.verts) expect(dist(p, [5, 5, 5])).toBeCloseTo(6, 6);
  });
  it("with no radius uses the average distance, and a factor of 0 changes nothing", () => {
    const s = soupOf(box());
    const r = shrinkwrap(s, "sphere", 1, 1, 0);
    const d0 = dist(r.verts[0]!, [5, 5, 5]);
    for (const p of r.verts) expect(dist(p, [5, 5, 5])).toBeCloseTo(d0, 6);
    expect(shrinkwrap(s, "sphere", 1, 0, 0).verts).toEqual(s.verts);
    const half = shrinkwrap(s, "sphere", 1, 0.5, 6);
    expect(dist(half.verts[0]!, [5, 5, 5])).toBeCloseTo((Math.hypot(5, 5, 5) + 6) / 2, 6);
  });
  it("wraps a cylinder round an axis (the height is kept) and flattens onto a plane", () => {
    const cyl = shrinkwrap(soupOf(box()), "cylinder", 1, 1, 5);
    for (const [i, p] of cyl.verts.entries()) {
      expect(Math.hypot(p[0]! - 5, p[2]! - 5)).toBeCloseTo(5, 6);
      expect(p[1]).toBe(soupOf(box()).verts[i]![1]);
    }
    const flat = shrinkwrap(soupOf(box()), "plane", 1, 1, 0);
    for (const p of flat.verts) expect(p[1]).toBe(5);
  });
});

describe("lattice", () => {
  it("with no offsets leaves the mesh alone", () => {
    const s = soupOf(box());
    expect(lattice(s, ZERO_LATTICE()).verts).toEqual(s.verts);
  });
  it("moving the four top corners sideways leans the mesh, the bottom staying put", () => {
    const corners = ZERO_LATTICE();
    for (const k of [2, 3, 6, 7]) corners[k] = [4, 0, 0]; // y = high
    const s = soupOf(box());
    const out = lattice(s, corners);
    for (const [i, p] of s.verts.entries()) expect(out.verts[i]![0]).toBeCloseTo(p[0] + (p[1] / 10) * 4, 9);
    // halfway up it has moved half as far
    const mid = lattice({ verts: [[0, 5, 0], [10, 10, 10], [0, 0, 0]], polys: [] }, corners);
    expect(mid.verts[0]![0]).toBeCloseTo(2, 9);
  });
  it("spreading the corners of one end flares it", () => {
    const corners = ZERO_LATTICE();
    corners[0] = [-2, 0, -2];
    corners[1] = [2, 0, -2];
    corners[4] = [-2, 0, 2];
    corners[5] = [2, 0, 2];
    const out = lattice(soupOf(box()), corners);
    const low = out.verts.filter((_, i) => soupOf(box()).verts[i]![1] === 0);
    expect(Math.min(...low.map((p) => p[0]))).toBe(-2);
    expect(Math.max(...low.map((p) => p[0]))).toBe(12);
  });
});

describe("in the modifier stack", () => {
  it("are new with sensible values, checked, and run by evaluate", () => {
    for (const t of ["wireframe", "shrinkwrap", "lattice"] as const) expect(checkModifier(newModifier(t), "m")).toBeNull();
    expect(checkModifier({ type: "shrinkwrap", kind: "blob" }, "m")).toContain("sphere");
    expect(checkModifier({ type: "shrinkwrap", factor: 2 }, "m")).toContain("0 to 1");
    expect(checkModifier({ type: "lattice", corners: [[0, 0, 0]] }, "m")).toContain("eight");
    expect(checkModifier({ type: "wireframe", thickness: 0 }, "m")).toContain("thickness");
    const c = { ...box(), modifiers: [newModifier("wireframe")] };
    const out = evaluate(c);
    expect(out.polys!.length).toBe(72);
    const sphere = evaluate({ ...box(), modifiers: [{ type: "shrinkwrap", kind: "sphere", factor: 1, radius: 4 } as const] });
    for (const p of sphere.verts!) expect(Math.hypot(p[0] - 5, p[1] - 5, p[2] - 5)).toBeCloseTo(4, 5);
  });
});
