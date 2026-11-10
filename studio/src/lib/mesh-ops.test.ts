import { describe, expect, it } from "vitest";
import type { Cube, Vec3 } from "./model-doc";
import { toMesh, edgesOf } from "./mesh-edit";
import {
  bridgeFaces, decimate, displace, dissolveEdge, dissolveVerts, falloffWeight, insetFace, lodChain, mergeVerts, nearestPoint, proportionalMove, simpleDeform, smoothVerts, snapPoint, snapTo, spinChain, triangulate, vertexNormals,
} from "./mesh-ops";

const box = (): Cube => toMesh({ shape: "box", from: [0, 0, 0], size: [2, 2, 2], color: "#888888" });
/// A flat n by n grid of squares in the x-z plane, facing up (+y).
function grid(n: number): Cube {
  const verts: Vec3[] = [];
  for (let z = 0; z <= n; z++) for (let x = 0; x <= n; x++) verts.push([x, 0, -z]);
  const polys = [];
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    const a = z * (n + 1) + x;
    polys.push({ v: [a, a + 1, a + n + 2, a + n + 1] });
  }
  // (counter-clockwise seen from above: +x then -z)
  return { shape: "mesh", from: [0, 0, 0], size: [0, 0, 0], color: "#888888", verts, polys };
}
const faces = (c: Cube) => c.polys!.length;
const normalY = (c: Cube, f: number) => {
  const v = c.polys![f]!.v.map((i) => c.verts![i]!);
  const a = v[0]!, b = v[1]!, d = v[2]!;
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
  return e1[2]! * e2[0]! - e1[0]! * e2[2]!;
};

describe("merge and dissolve", () => {
  it("merges two points into one at their middle, dropping the faces that collapse", () => {
    const g = grid(2);
    const r = mergeVerts(g, [0, 1], "centre")!;
    expect(r.cube.verts!.length).toBe(g.verts!.length - 1);
    expect(r.cube.verts![r.point]).toEqual([0.5, 0, 0]);
    // the first square had two of its points joined: it is a triangle now, and no face is lost
    expect(faces(r.cube)).toBe(4);
    expect(r.cube.polys!.some((f) => f.v.length === 3)).toBe(true);
    expect(mergeVerts(g, [0], "first")).toBeNull();
  });
  it("merging to the first or last point keeps that point where it was", () => {
    const g = grid(2);
    expect(mergeVerts(g, [0, 1], "first")!.cube.verts![0]).toEqual([0, 0, 0]);
    const last = mergeVerts(g, [0, 1], "last")!;
    expect(last.cube.verts![last.point]).toEqual([1, 0, 0]);
  });
  it("collapsing a whole face to a point removes it", () => {
    const r = mergeVerts(grid(1), [0, 1, 2, 3], "centre")!;
    expect(faces(r.cube)).toBe(0);
  });
  it("dissolves the point in the middle of a grid into one bigger face", () => {
    const g = grid(2); // 9 points; the middle one is 4
    const d = dissolveVerts(g, [4]);
    expect(faces(d)).toBe(1);
    expect(d.polys![0]!.v.length).toBe(8);
    expect(d.verts!.length).toBe(8);
    expect(normalY(d, 0)).toBeGreaterThan(0);
  });
  it("leaves a border point alone", () => {
    expect(dissolveVerts(grid(2), [0]).polys!.length).toBe(4);
  });
  it("dissolves a box corner into a hexagon", () => {
    const b = box();
    const d = dissolveVerts(b, [0]);
    expect(d.verts!.length).toBe(7);
    expect(d.polys!.map((f) => f.v.length).sort()).toEqual([4, 4, 4, 6]);
  });
  it("joins the two faces on either side of an edge", () => {
    const g = grid(2);
    const edge = edgesOf(g).find((e) => e.faces === 2)!;
    const d = dissolveEdge(g, edge.a, edge.b)!;
    expect(faces(d)).toBe(3);
    expect(Math.max(...d.polys!.map((f) => f.v.length))).toBe(6);
    const border = edgesOf(g).find((e) => e.faces === 1)!;
    expect(dissolveEdge(g, border.a, border.b)).toBeNull();
  });
});

describe("triangulate", () => {
  it("cuts a square into two triangles and a box into twelve", () => {
    expect(faces(triangulate(grid(1)))).toBe(2);
    expect(faces(triangulate(box()))).toBe(12);
    expect(triangulate(box()).polys!.every((f) => f.v.length === 3)).toBe(true);
  });
  it("cuts a concave face (an L) correctly: three triangles whose areas add up", () => {
    const verts: Vec3[] = [[0, 0, 0], [2, 0, 0], [2, 0, -1], [1, 0, -1], [1, 0, -2], [0, 0, -2]];
    const l: Cube = { shape: "mesh", from: [0, 0, 0], size: [0, 0, 0], color: "#fff", verts, polys: [{ v: [0, 1, 2, 3, 4, 5] }] };
    const t = triangulate(l);
    expect(faces(t)).toBe(4);
    let area = 0;
    for (const f of t.polys!) {
      const [a, b, c] = f.v.map((i) => t.verts![i]!) as [Vec3, Vec3, Vec3];
      area += Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0])) / 2;
      expect(normalY(t, t.polys!.indexOf(f))).toBeGreaterThan(0);
    }
    expect(area).toBeCloseTo(3, 6);
  });
  it("only touches the faces asked for", () => {
    expect(faces(triangulate(grid(2), [0]))).toBe(5);
  });
});

describe("smoothing, soft moves and snapping", () => {
  it("smooths a spike towards its neighbours and leaves the border alone", () => {
    const g = grid(2);
    g.verts![4] = [1, 3, -1];
    const s = smoothVerts(g, undefined, 1, 1);
    expect(s.verts![4]![1]).toBeCloseTo(0, 6);
    expect(JSON.stringify(s.verts![0])).toBe(JSON.stringify(g.verts![0]));
    const edgeMove = smoothVerts(g, [0], 1, 1, true);
    expect(edgeMove.verts![0]).not.toEqual(g.verts![0]);
  });
  it("shapes falloff from 1 at the middle to 0 at the edge", () => {
    for (const k of ["smooth", "linear", "sharp", "root", "sphere"] as const) {
      expect(falloffWeight(k, 0), k).toBeCloseTo(1, 6);
      expect(falloffWeight(k, 1), k).toBeCloseTo(0, 6);
    }
    expect(falloffWeight("constant", 0.5)).toBe(1);
    expect(falloffWeight("linear", 0.5)).toBeCloseTo(0.5);
    expect(falloffWeight("sharp", 0.5)).toBeLessThan(0.5);
    expect(falloffWeight("root", 0.5)).toBeGreaterThan(0.5);
  });
  it("moves the chosen point fully and its neighbours less, and far points not at all", () => {
    const g = grid(4);
    const mid = 2 * 5 + 2;
    const m = proportionalMove(g, [mid], [0, 2, 0], 2.5, "linear");
    expect(m.verts![mid]![1]).toBe(2);
    const near = m.verts![mid + 1]![1]; // 1 away: 1 - 1/2.5 = 0.6 of 2
    expect(near).toBeCloseTo(1.2, 6);
    expect(m.verts![0]![1]).toBe(0);
  });
  it("only lets points joined by edges follow when asked", () => {
    const verts: Vec3[] = [[0, 0, 0], [5, 0, 0], [0.5, 0, 0]];
    const two: Cube = { shape: "mesh", from: [0, 0, 0], size: [0, 0, 0], color: "#fff", verts, polys: [{ v: [0, 1, 1] }] };
    const free = proportionalMove(two, [0], [0, 1, 0], 2, "constant", false);
    const joined = proportionalMove(two, [0], [0, 1, 0], 2, "constant", true);
    expect(free.verts![2]![1]).toBe(1);
    expect(joined.verts![2]![1]).toBe(0);
  });
  it("snaps to a grid and to the nearest point", () => {
    expect(snapTo(1.26, 0.25)).toBe(1.25);
    expect(snapTo(1.26, 0)).toBe(1.26);
    expect(snapPoint([0.9, 2.1, -0.4], 0.5)).toEqual([1, 2, -0.5]);
    expect(nearestPoint([1, 1, 1], [[5, 5, 5], [1.1, 1, 1]], 0.5)).toEqual({ index: 1, point: [1.1, 1, 1] });
    expect(nearestPoint([1, 1, 1], [[5, 5, 5]], 0.5)).toBeNull();
  });
});

describe("inset, bridge and spin", () => {
  it("insets a face: the ring of faces and a smaller face inside", () => {
    const r = insetFace(grid(1), 0, 0.2)!;
    expect(faces(r.cube)).toBe(5);
    expect(r.points).toHaveLength(4);
    for (const i of r.points) {
      const p = r.cube.verts![i]!;
      expect(p[0]).toBeGreaterThan(0.1);
      expect(p[0]).toBeLessThan(0.9);
    }
    expect(insetFace(grid(1), 0, 0)).toBeNull();
    expect(insetFace(grid(1), 9, 0.2)).toBeNull();
  });
  it("insets with depth along the normal", () => {
    const r = insetFace(grid(1), 0, 0.2, 0.5)!;
    expect(r.cube.verts![r.points[0]!]![1]).toBeCloseTo(0.5, 6);
  });
  it("bridges two faces that face each other with a tunnel of quads", () => {
    const b = box();
    // the top and bottom faces of a box face away from each other; bridging them makes a ring round the box
    const top = b.polys!.findIndex((f) => f.v.every((i) => b.verts![i]![1] === 2));
    const bottom = b.polys!.findIndex((f) => f.v.every((i) => b.verts![i]![1] === 0));
    const r = bridgeFaces(b, top, bottom)!;
    expect(faces(r)).toBe(4 + 4); // 4 sides of the box, 4 new ones; the two ends are gone
    expect(bridgeFaces(b, 0, 0)).toBeNull();
    expect(bridgeFaces(grid(1), 0, 0)).toBeNull();
  });
  it("spins a profile into a lathe: a closed ring of faces for 360 degrees", () => {
    const profile: Cube = { shape: "mesh", from: [0, 0, 0], size: [0, 0, 0], color: "#fff", verts: [[2, 0, 0], [2, 1, 0], [1, 2, 0]], polys: [] };
    const r = spinChain(profile, [0, 1, 2], 1, 360, 8)!;
    expect(r.cube.verts!.length).toBe(3 * 8);
    expect(faces(r.cube)).toBe(8 * 2);
    const p = r.cube.verts![3]!; // the first copy turned 45 degrees about y
    expect(Math.hypot(p[0], p[2])).toBeCloseTo(2, 6);
    expect(p[1]).toBe(0);
  });
  it("screws: a rise adds up along the axis and the ring stays open", () => {
    const profile: Cube = { shape: "mesh", from: [0, 0, 0], size: [0, 0, 0], color: "#fff", verts: [[2, 0, 0], [2.5, 0, 0]], polys: [] };
    const r = spinChain(profile, [0, 1], 1, 720, 16, 0.25)!;
    expect(r.cube.verts!.length).toBe(2 * 17);
    expect(faces(r.cube)).toBe(16);
    expect(r.cube.verts![2 * 16]![1]).toBeCloseTo(4, 6);
    expect(spinChain(profile, [0], 1, 360, 8)).toBeNull();
  });
});

describe("decimate, displace, deform and LODs", () => {
  const sphere = (): Cube => {
    const verts: Vec3[] = [];
    const polys = [];
    const rings = 12, around = 16;
    for (let r = 0; r <= rings; r++) for (let a = 0; a < around; a++) {
      const th = (Math.PI * r) / rings, ph = (2 * Math.PI * a) / around;
      verts.push([Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)]);
    }
    for (let r = 0; r < rings; r++) for (let a = 0; a < around; a++) {
      const i = r * around + a, j = r * around + ((a + 1) % around);
      polys.push({ v: [i, i + around, j + around, j] });
    }
    return { shape: "mesh", from: [0, 0, 0], size: [0, 0, 0], color: "#fff", verts, polys };
  };
  it("keeps about the share of points asked for, and the shape stays within its size", () => {
    const s = sphere();
    const d = decimate(s, 0.4);
    expect(d.verts!.length).toBeLessThan(s.verts!.length * 0.6);
    expect(d.verts!.length).toBeGreaterThan(s.verts!.length * 0.15);
    for (const p of d.verts!) expect(Math.hypot(...p)).toBeLessThan(1.05);
    expect(JSON.stringify(decimate(s, 1))).toBe(JSON.stringify(s));
  });
  it("makes a chain of LODs that gets smaller each step", () => {
    const l = lodChain(sphere(), [0.5, 0.25]);
    expect(l).toHaveLength(3);
    expect(l[1]!.polys!.length).toBeLessThan(l[0]!.polys!.length);
    expect(l[2]!.polys!.length).toBeLessThan(l[1]!.polys!.length);
  });
  it("displaces along the normals the same way each time, and not at all for an amount of 0", () => {
    const g = grid(4);
    const a = displace(g, 0.5, 1.5, 3);
    expect(displace(g, 0.5, 1.5, 3)).toEqual(a);
    expect(displace(g, 0.5, 1.5, 4)).not.toEqual(a);
    expect(a.verts!.every((p) => Math.abs(p[1]) <= 0.5 + 1e-9)).toBe(true);
    expect(a.verts!.some((p) => Math.abs(p[1]) > 0.01)).toBe(true);
    expect(JSON.stringify(displace(g, 0, 1.5).verts)).toBe(JSON.stringify(g.verts));
    expect(vertexNormals(g)[4]![1]).toBeCloseTo(1, 6);
  });
  it("twists, tapers, stretches and bends along an axis", () => {
    const column: Cube = { shape: "mesh", from: [0, 0, 0], size: [0, 0, 0], color: "#fff", verts: [[1, 0, 0], [1, 2, 0], [-1, 4, 0]], polys: [{ v: [0, 1, 2] }] };
    const tw = simpleDeform(column, "twist", 1, 90);
    expect(tw.verts![0]).toEqual([1, 0, 0]);
    expect(Math.hypot(tw.verts![2]![0], tw.verts![2]![2])).toBeCloseTo(1, 6);
    expect(tw.verts![2]![0]).toBeCloseTo(0, 6);
    const tp = simpleDeform(column, "taper", 1, -0.5);
    expect(tp.verts![2]![0]).toBeCloseTo(-0.5, 6);
    expect(tp.verts![0]![0]).toBe(1);
    const st = simpleDeform(column, "stretch", 1, 2);
    expect(st.verts![2]![1]).toBe(6);
    const bd = simpleDeform(column, "bend", 1, 90);
    expect(bd.verts![0]![1]).toBeCloseTo(0, 6);
    expect(bd.verts![2]![1]).not.toBe(4);
    expect(simpleDeform(column, "bend", 1, 0).verts).toEqual(column.verts);
  });
});
