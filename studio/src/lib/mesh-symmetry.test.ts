import { describe, expect, it } from "vitest";
import { bevelChain, edgesOf, extrudeFace, loopCut, toMesh } from "./mesh-edit";
import { mirrorResult, pointsAt, twinChain, twinFace, twinPoints, twinWay, withTwinFaces } from "./mesh-symmetry";
import type { Cube } from "./model-doc";

// a box 8 wide (x -4 to 4), cut once across x so that it has a middle line
const box = (): Cube => {
  const m = toMesh({ from: [-4, 0, -2], size: [8, 6, 4], color: "#888888" });
  const top = m.polys!.findIndex((_, i) => Math.abs(m.verts![m.polys![i]!.v[0]!]![1] - 6) < 1e-6 && m.polys![i]!.v.every((v) => m.verts![v]![1] === 6));
  const cut = loopCut(m, top, 0, 0.5);
  return cut.points.length ? cut.cube : m;
};
const facing = (c: Cube, ny: number) => c.polys!.map((_, i) => i).filter((i) => {
  const vs = c.polys![i]!.v.map((v) => c.verts![v]!);
  const cy = vs.reduce((s, p) => s + p[1], 0) / vs.length;
  return ny > 0 ? vs.every((p) => Math.abs(p[1] - 6) < 1e-6) : Math.abs(cy) < 1e-6;
});

describe("mirror twins", () => {
  it("finds the twin of every point of a symmetrical mesh, and the points on the plane are their own", () => {
    const c = box();
    const t = twinPoints(c, 0);
    expect(t.every((x) => x >= 0)).toBe(true);
    c.verts!.forEach((p, i) => {
      if (Math.abs(p[0]) < 1e-6) expect(t[i]).toBe(i);
      else expect(c.verts![t[i]!]).toEqual([-p[0], p[1], p[2]]);
    });
  });

  it("has no twin where the mesh is not symmetrical", () => {
    const c = box();
    c.verts![0] = [c.verts![0]![0] + 0.5, c.verts![0]![1], c.verts![0]![2]];
    expect(twinPoints(c, 0)[0]).toBe(-1);
  });

  it("a transform of picked points is copied, mirrored, onto their twins", () => {
    const c = box();
    const picked = c.verts!.map((p, i) => (p[0] > 3.9 && p[1] > 5.9 ? i : -1)).filter((i) => i >= 0);
    const moved: Cube = { ...c, verts: c.verts!.map((p, i) => (picked.includes(i) ? ([p[0] + 1, p[1] + 2, p[2] + 0.5] as [number, number, number]) : p)) };
    const out = mirrorResult(c, moved, picked, 0);
    const t = twinPoints(c, 0);
    for (const i of picked) expect(out.verts![t[i]!]).toEqual([-out.verts![i]![0], out.verts![i]![1], out.verts![i]![2]]);
    // and only those moved
    const changed = out.verts!.filter((p, i) => p.some((n, k) => n !== c.verts![i]![k])).length;
    expect(changed).toBe(picked.length * 2);
  });

  it("keeps a picked point on the plane on it", () => {
    const c = box();
    const i = c.verts!.findIndex((p) => Math.abs(p[0]) < 1e-6 && p[1] > 5.9);
    const moved: Cube = { ...c, verts: c.verts!.map((p, k) => (k === i ? ([p[0] + 1, p[1] + 1, p[2]] as [number, number, number]) : p)) };
    expect(mirrorResult(c, moved, [i], 0).verts![i]![0]).toBe(0);
  });

  it("extruding a face and its twin pulls out two matching bumps", () => {
    const c = box();
    const tops = facing(c, 1);
    expect(tops.length).toBe(2);
    const both = withTwinFaces(c, [tops[0]!], 0);
    expect(both.sort()).toEqual([...tops].sort());
    expect(twinFace(c, tops[0]!, 0)).toBe(tops[1]);
    let out = c;
    for (const f of both) out = extrudeFace(out, f, 3).cube;
    const t = twinPoints(out, 0);
    expect(t.every((x) => x >= 0)).toBe(true);
  });

  it("a loop cut through a face and the way of its twin's cut", () => {
    const c = box();
    const faces = c.polys!.map((_, i) => i).filter((i) => c.polys![i]!.v.length === 4);
    for (const f of faces) {
      const t = twinFace(c, f, 0);
      if (t < 0) continue;
      for (const way of [0, 1] as const) {
        const w = twinWay(c, f, way, t, 0);
        expect(w === 0 || w === 1).toBe(true);
      }
    }
  });

  it("the twin of a chain of points, found again by position after another edit", () => {
    const c = box();
    // an edge down a side corner: two points at x = 4
    const chain = c.verts!.map((p, i) => (p[0] > 3.9 && p[2] > 1.9 ? i : -1)).filter((i) => i >= 0);
    const tw = twinChain(c, chain, 0);
    expect(tw).not.toBeNull();
    const bev = bevelChain(c, chain.slice(0, 2), 0.25);
    expect(bev).not.toBeNull();
    // the twin chain's points are still where they were
    const found = pointsAt(bev!.cube, tw!.slice(0, 2).map((i) => c.verts![i]!));
    expect(found).not.toBeNull();
  });
});

import { bevelChainSym, extrudeFaceSym, loopCutThrough } from "./mesh-symmetry";

/// Every point has a mirror twin and every face too: the mesh is still symmetrical.
const symmetrical = (c: Cube, axis: 0 | 1 | 2 = 0) => {
  const t = twinPoints(c, axis);
  if (t.some((x) => x < 0)) return false;
  return c.polys!.every((_, f) => {
    const w = twinFace(c, f, axis, t);
    if (w >= 0) return true;
    // a face that is its own mirror image maps its points among themselves
    return c.polys![f]!.v.every((v) => c.polys![f]!.v.includes(t[v]!));
  });
};

describe("symmetrical operations", () => {
  it("extrude with symmetry pulls out the face and its twin, and without it only the one", () => {
    const c = box();
    const top = facing(c, 1)[0]!;
    const one = extrudeFaceSym(c, top, 2, 0, null);
    const both = extrudeFaceSym(c, top, 2, 0, 0);
    expect(one.cube.verts!.length).toBe(c.verts!.length + 4);
    // the two halves of the top meet along the middle: they are pulled out as one block (6 new points, not 8: the two on the middle are shared)
    expect(both.cube.verts!.length).toBe(c.verts!.length + 6);
    expect(both.points.length).toBe(6);
    expect(symmetrical(both.cube)).toBe(true);
    // ... with no wall left standing inside it: every edge belongs to exactly two faces
    expect(edgesOf(both.cube).every((e) => e.faces === 2)).toBe(true);
    expect(symmetrical(one.cube)).toBe(false);
  });

  it("an inset with symmetry stays symmetrical, with the same shrink on both sides", () => {
    const c = box();
    const top = facing(c, 1)[0]!;
    const r = extrudeFaceSym(c, top, 0, 0.3, 0);
    expect(symmetrical(r.cube)).toBe(true);
  });

  it("a face on the plane itself is extruded once", () => {
    const m = toMesh({ from: [-4, 0, -2], size: [8, 6, 4], color: "#888888" }); // uncut: its top spans the plane
    const top = m.polys!.findIndex((p) => p.v.every((v) => m.verts![v]![1] === 6));
    expect(withTwinFaces(m, [top], 0)).toEqual([top]);
    expect(extrudeFaceSym(m, top, 2, 0, 0).cube.verts!.length).toBe(m.verts!.length + 4);
  });

  it("a bevel of an edge and of its mirror twin, one after the other, stays symmetrical", () => {
    const c = box();
    // the top edge at x = +4, running along z (two points), has a twin at x = -4
    const pts = c.verts!.map((p, i) => (p[0] > 3.9 && p[1] > 5.9 ? i : -1)).filter((i) => i >= 0);
    expect(pts.length).toBe(2);
    const one = bevelChainSym(c, pts, 0.25, 1, null);
    const both = bevelChainSym(c, pts, 0.25, 1, 0);
    expect(one).not.toBeNull();
    expect(both).not.toBeNull();
    expect(both!.cube.polys!.length).toBeGreaterThan(one!.cube.polys!.length);
    expect(symmetrical(both!.cube)).toBe(true);
    expect(symmetrical(one!.cube)).toBe(false);
  });

  it("a loop cut through a side face is made on the other side too, at the same place", () => {
    const m = toMesh({ from: [-4, 0, -2], size: [8, 6, 4], color: "#888888" });
    // the face at x = +4: a cut across it (one way or the other) goes right round the box and reaches x = -4 itself,
    // so the mirrored cut is found already done and not made twice
    const side = m.polys!.findIndex((p) => p.v.every((v) => m.verts![v]![0] === 4));
    const plain = loopCut(m, side, 0, 0.3);
    const withSym = loopCutThrough(m, side, 0, 0.3, 0);
    expect(withSym.cube.polys!.length).toBe(plain.cube.polys!.length);
    // the cut of a face on top, where the ring does not reach the twin, is mirrored
    const c = box();
    const top = facing(c, 1)[0]!;
    for (const way of [0, 1] as const) {
      const r = loopCutThrough(c, top, way, 0.5, 0);
      expect(r.points.length, `way ${way}`).toBeGreaterThan(0);
      expect(symmetrical(r.cube), `way ${way}`).toBe(true);
    }
  });
});
