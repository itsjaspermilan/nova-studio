import { describe, expect, it } from "vitest";
import { applyCut, checkCuts } from "./mesh-cutout";
import type { Cube, MeshFace, Vec3 } from "./model-doc";
import { checkModifier, evaluate, evaluateSurfaces } from "./modifiers";

/// A wall of n x n squares in the plane x = 4, facing +x, from z -4..4 and y 0..8, and its twin at x = -4 facing -x.
function walls(n = 4): { verts: Vec3[]; polys: MeshFace[] } {
  const verts: Vec3[] = [], polys: MeshFace[] = [];
  for (const sx of [1, -1]) {
    const base = verts.length;
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) verts.push([4 * sx, (8 * j) / n, -4 + (8 * i) / n]);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = base + j * (n + 1) + i, loop = [a, a + n + 1, a + n + 2, a + 1]; // counter-clockwise seen from +x
      polys.push({ v: sx > 0 ? loop : [...loop].reverse(), color: "#aa0000", smooth: true });
    }
  }
  return { verts, polys };
}
const area = (verts: Vec3[], f: MeshFace) => {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < f.v.length; i++) { const p = verts[f.v[i]!]!, q = verts[f.v[(i + 1) % f.v.length]!]!; nx += (p[1] - q[1]) * (p[2] + q[2]); ny += (p[2] - q[2]) * (p[0] + q[0]); nz += (p[0] - q[0]) * (p[1] + q[1]); }
  return Math.hypot(nx, ny, nz) / 2;
};
/// Every edge of a closed sheet is used once each way, or once on its border: no edge may be used twice the same way, and no point may sit in the middle of a neighbour's edge.
const openEdges = (polys: MeshFace[]) => {
  const seen = new Map<string, number>();
  for (const f of polys) for (let i = 0; i < f.v.length; i++) { const k = `${f.v[i]},${f.v[(i + 1) % f.v.length]}`; seen.set(k, (seen.get(k) ?? 0) + 1); }
  let open = 0;
  for (const [k, n] of seen) { expect(n).toBe(1); const [a, b] = k.split(","); if (!seen.has(`${b},${a}`)) open++; }
  return open;
};
const square: [number, number][] = [[-1.5, 2.5], [1.5, 2.5], [1.5, 5.5], [-1.5, 5.5]];

describe("cut-outs", () => {
  it("cuts an outline into both flanks and colours the inside, keeping the area and the sheet whole", () => {
    const w = walls();
    const before = openEdges(w.polys);
    const r = applyCut(w.verts, w.polys, { view: "side", points: square, color: "#0000ff" });
    const blue = r.polys.filter((f) => f.color === "#0000ff");
    expect(blue.reduce((s, f) => s + area(r.verts, f), 0)).toBeCloseTo(18, 5); // 3 x 3 on each flank
    expect(r.polys.reduce((s, f) => s + area(r.verts, f), 0)).toBeCloseTo(128, 5);
    expect(openEdges(r.polys)).toBe(before); // no new holes, no T-junctions
    expect(blue.every((f) => f.smooth)).toBe(true);
  });
  it("cuts one flank only when asked, and a slanted or concave outline too", () => {
    const w = walls();
    const r = applyCut(w.verts, w.polys, { view: "side", only: "+x", points: [[-3, 1], [3, 1], [3, 7], [0, 3.2], [-3, 7]], color: "#00ff00" });
    const green = r.polys.filter((f) => f.color === "#00ff00");
    expect(green.every((f) => f.v.every((i) => r.verts[i]![0] === 4))).toBe(true);
    expect(green.reduce((s, f) => s + area(r.verts, f), 0)).toBeCloseTo(36 - 0.5 * 6 * 3.8, 4);
    openEdges(r.polys);
  });
  it("sinks a pocket with walls, and takes an opening away with a lip", () => {
    const w = walls();
    const r = applyCut(w.verts, w.polys, { view: "side", only: "+x", points: square, color: "#111111", depth: 0.5, wall: "#222222" });
    const floor = r.polys.filter((f) => f.color === "#111111");
    expect(floor.every((f) => f.v.every((i) => r.verts[i]![0] === 3.5))).toBe(true);
    const wall = r.polys.filter((f) => f.color === "#222222");
    expect(wall.reduce((s, f) => s + area(r.verts, f), 0)).toBeCloseTo(12 * 0.5, 5);
    // the walls look into the pocket: on the left wall (z = -1.5) the normal points to +z
    const left = wall.find((f) => f.v.every((i) => Math.abs(r.verts[i]![2] + 1.5) < 1e-9))!;
    const [a, b, c] = left.v.map((i) => r.verts[i]!) as [Vec3, Vec3, Vec3];
    const nz = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    expect(nz).toBeGreaterThan(0);
    expect(openEdges(r.polys)).toBe(openEdges(walls().polys)); // the pocket closes the sheet again

    const hole = applyCut(walls().verts, walls().polys, { view: "side", only: "+x", points: square, remove: true });
    expect(hole.polys.reduce((s, f) => s + area(hole.verts, f), 0)).toBeCloseTo(128 - 9, 5);
  });
  it("mirrors a front outline, and leaves faces that look away alone", () => {
    const verts: Vec3[] = [[-8, 0, 2], [8, 0, 2], [8, 8, 2], [-8, 8, 2], [-8, 0, -2], [8, 0, -2], [8, 8, -2], [-8, 8, -2]];
    const polys: MeshFace[] = [{ v: [0, 1, 2, 3], color: "#aaaaaa" }, { v: [5, 4, 7, 6], color: "#aaaaaa" }]; // a front face and a back face
    const r = applyCut(verts, polys, { view: "front", mirror: true, points: [[2, 2], [5, 2], [5, 4], [2, 4]], color: "#ffff00", emissive: 0.8 });
    const lit = r.polys.filter((f) => f.mat?.emissive === 0.8);
    expect(lit.reduce((s, f) => s + area(r.verts, f), 0)).toBeCloseTo(12, 5);
    expect(lit.every((f) => f.v.every((i) => r.verts[i]![2] === 2))).toBe(true);
    expect(new Set(lit.map((f) => Math.sign(r.verts[f.v[0]!]![0]))).size).toBe(2);
  });
  it("runs in the modifier stack after a subdivision, and the exporter gets a shape for each surface", () => {
    const w = walls(2);
    const cube: Cube = { shape: "mesh", from: [0, 0, 0], size: [0, 0, 0], color: "#aa0000", metallic: 0.3, roughness: 0.4, verts: w.verts, polys: w.polys, modifiers: [{ type: "subsurf", levels: 1, renderLevels: 1 }, { type: "cutout", cuts: [{ view: "side", points: [[-1, 3], [1, 3], [1, 5], [-1, 5]], color: "#203050", metallic: 0.6, roughness: 0.1 }] }] };
    const done = evaluate(cube, "render");
    expect(done.polys!.some((f) => f.color === "#203050" && f.mat)).toBe(true);
    const shapes = evaluateSurfaces(cube, "render");
    expect(shapes.length).toBe(2);
    expect(shapes.map((s) => s.roughness).sort()).toEqual([0.1, 0.4]);
    expect(shapes.reduce((n, s) => n + s.polys!.length, 0)).toBe(done.polys!.length);
  });
  it("gives a pane of glass a surface of its own, without the body's lacquer", () => {
    const w = walls(2);
    const cube: Cube = { shape: "mesh", from: [0, 0, 0], size: [0, 0, 0], color: "#aa0000", metallic: 0.4, roughness: 0.3, coat: 1, verts: w.verts, polys: w.polys, modifiers: [{ type: "cutout", cuts: [{ view: "side", points: [[-1, 3], [1, 3], [1, 5], [-1, 5]], color: "#1a2633", metallic: 0.7, roughness: 0.06, glass: 1 }] }] };
    const shapes = evaluateSurfaces(cube, "render");
    expect(shapes.length).toBe(2);
    const pane = shapes.find((s) => s.glass === 1)!, body = shapes.find((s) => s.glass === undefined)!;
    expect(pane.coat).toBeUndefined();
    expect(body.coat).toBe(1);
    expect(checkModifier({ type: "cutout", cuts: [{ view: "side", points: [[-1, 3], [1, 3], [1, 5]], glass: 2 }] }, "m")).toContain("glass");
  });
  it("checks what a file says", () => {
    expect(checkModifier({ type: "cutout", cuts: [{ view: "side", points: square, color: "#112233", depth: 0.2 }] }, "m")).toBeNull();
    expect(checkCuts([{ view: "up", points: square }], "m")).toMatch(/view/);
    expect(checkCuts([{ view: "side", points: [[0, 0], [1, 1]] }], "m")).toMatch(/points/);
    expect(checkCuts([{ view: "side", points: square, color: "blue" }], "m")).toMatch(/color/);
  });
});
