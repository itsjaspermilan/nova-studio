import { describe, expect, it } from "vitest";
import { mirrorPart, addFace, compact, deleteFaces, deleteVerts, extrudeFace, faceCentre, faceNormal, flipFaces, freshMesh, mirrorElement, moveVerts, setFaceColors, subdivide, toMesh, weld, weldable, type Axis } from "./mesh-edit";
import { parseModel, serializeModel, addCube, newModel, type Cube, type Shape } from "./model-doc";
import { meshOf, signedVolume } from "./model-mesh";

const box = (extra: Partial<Cube> = {}): Cube => ({ from: [0, 0, 0], size: [10, 10, 10], color: "#c9d1d9", ...extra });
const vol = (c: Cube) => signedVolume(c) / 6;
const key = (p: number[]) => p.map((x) => (Math.abs(x) < 1e-9 ? 0 : x).toFixed(4)).join(",");
const positions = (c: Cube) => {
  const m = meshOf(c);
  return new Set(Array.from({ length: m.positions.length / 3 }, (_, i) => key([m.positions[i * 3]!, m.positions[i * 3 + 1]!, m.positions[i * 3 + 2]!])));
};
const upFace = (c: Cube) => c.polys!.findIndex((_, i) => faceNormal(c, i)[1] > 0.99);

describe("making a mesh", () => {
  it("copies what a shape looks like now, colours and smoothing included", () => {
    const sphere: Cube = { shape: "sphere", from: [0, 0, 0], size: [8, 8, 8], color: "#336699", segments: 12, rotation: [10, 20, 30] };
    const mesh = toMesh(sphere);
    expect(mesh.shape).toBe("mesh");
    expect(mesh.rotation).toBeUndefined();
    expect(vol(mesh)).toBeCloseTo(vol(sphere), 6);
    expect(mesh.polys!.every((f) => f.smooth)).toBe(true);
    const painted = toMesh(box({ faces: { up: "#ff0000" } }));
    expect(painted.polys!.filter((f) => f.color === "#ff0000")).toHaveLength(1);
    expect(painted.polys!.filter((f) => f.color === undefined)).toHaveLength(5);
    expect(vol(painted)).toBeCloseTo(1000, 6);
  });

  it("starts from a single upward square", () => {
    const quad = freshMesh();
    expect(quad.polys).toHaveLength(1);
    expect(faceNormal(quad, 0)).toEqual([0, 1, 0]);
    expect(quad.size).toEqual([8, 0, 8]);
  });
});

describe("editing points and faces", () => {
  it("moves points and keeps the bounds in step", () => {
    const m = moveVerts(toMesh(box()), [0, 1], [0, -5, 0]);
    expect(m.from[1]).toBe(-5);
    expect(m.size[1]).toBe(15);
  });

  it("extrudes a face outwards, adding a wall for each edge", () => {
    const m = toMesh(box());
    const up = upFace(m);
    const { cube, points } = extrudeFace(m, up, 5);
    expect(vol(cube)).toBeCloseTo(1500, 6);
    expect(cube.polys).toHaveLength(6 + 4);
    expect(points).toHaveLength(4);
    expect(cube.polys![up]!.v).toEqual(points);
    expect(faceCentre(cube, up)[1]).toBeCloseTo(15, 6);
  });

  it("digs a face inwards the same way", () => {
    // Split the top into 16 squares and push the one next to the middle, away from the box's own sides.
    const base = toMesh(box());
    const once = subdivide(base, [upFace(base)]);
    const tops = once.polys!.map((_, i) => i).filter((i) => faceNormal(once, i)[1] > 0.99);
    const split = subdivide(once, tops);
    const inner = split.polys!.findIndex((_, i) => {
      const c = faceCentre(split, i);
      return faceNormal(split, i)[1] > 0.99 && Math.abs(c[0] - 3.75) < 1e-6 && Math.abs(c[2] - 3.75) < 1e-6;
    });
    expect(inner).toBeGreaterThanOrEqual(0);
    const area = 2.5 * 2.5;
    expect(vol(extrudeFace(split, inner, -2).cube)).toBeCloseTo(1000 - area * 2, 6);
    expect(vol(extrudeFace(split, inner, 2).cube)).toBeCloseTo(1000 + area * 2, 6);
  });

  it("extrudes a free square into a closed-sided tube", () => {
    const { cube } = extrudeFace(freshMesh(), 0, 6);
    expect(cube.size).toEqual([8, 6, 8]);
    expect(cube.polys).toHaveLength(5);
  });

  it("subdivides faces without changing the shape", () => {
    const m = toMesh(box());
    const s = subdivide(m);
    expect(s.polys).toHaveLength(24);
    expect(vol(s)).toBeCloseTo(1000, 6);
    expect(s.verts!.length).toBe(8 + 12 + 6); // corners, edge middles, face middles
    expect(subdivide(m, [0]).polys).toHaveLength(5 + 4);
  });

  it("deletes faces and the points only they used, and deletes points with their faces", () => {
    const m = toMesh(box());
    const noTop = deleteFaces(m, [upFace(m)]);
    expect(noTop.polys).toHaveLength(5);
    expect(noTop.verts).toHaveLength(8);
    const one = deleteFaces(m, [0, 1, 2, 3, 4]);
    expect(one.polys).toHaveLength(1);
    expect(one.verts).toHaveLength(4);
    const cut = deleteVerts(m, [0]);
    expect(cut.verts).toHaveLength(7);
    expect(cut.polys).toHaveLength(3);
    expect(cut.polys!.flatMap((f) => f.v).every((i) => i < 7)).toBe(true);
    expect(compact(cut).verts).toHaveLength(7);
  });

  it("adds a face between chosen points and flips and colours faces", () => {
    const hole = deleteFaces(toMesh(box()), [2]);
    const open = hole.polys!.flatMap((f) => f.v);
    expect(open.length).toBeGreaterThan(0);
    const corners = [...new Set(hole.polys!.flatMap((f) => f.v))].filter((i) => hole.verts![i]![1] === 10);
    expect(corners).toHaveLength(4);
    const flipped = flipFaces(toMesh(box()), [0]);
    expect(vol(flipped)).toBeLessThan(1000);
    expect(addFace(hole, [0, 0, 1]).polys).toHaveLength(hole.polys!.length);
    expect(addFace(hole, [0, 1]).polys).toHaveLength(hole.polys!.length);
    expect(addFace(hole, [0, 1, 2]).polys).toHaveLength(hole.polys!.length + 1);
    expect(setFaceColors(toMesh(box()), [1, 2], "#123456").polys!.filter((f) => f.color === "#123456")).toHaveLength(2);
  });

  it("welds points that sit on each other", () => {
    const m = toMesh(box());
    const doubled: Cube = { ...m, verts: [...m.verts!, [0, 0, 0]], polys: [...m.polys!, { v: [8, 1, 2] }] };
    expect(weldable(doubled)).toBe(1);
    const w = weld(doubled);
    expect(w.verts).toHaveLength(8);
    expect(w.polys).toHaveLength(7);
    expect(weldable(m)).toBe(0);
  });
});

describe("mirroring", () => {
  const items: [Shape, Partial<Cube>][] = [
    ["box", { rotation: [20, 30, 40], faces: { east: "#ff0000", up: "#00ff00" } }],
    ["wedge", { rotation: [10, 25, 35] }],
    ["pyramid", { rotation: [15, 0, 5] }],
    ["cylinder", { rotation: [0, 30, 60], segments: 10 }],
    ["cone", { rotation: [30, 0, 0], segments: 9 }],
    ["sphere", { rotation: [5, 6, 7], segments: 8 }],
  ];
  for (const [shape, extra] of items) {
    for (const axis of [0, 1, 2] as Axis[]) {
      it(`reflects a ${shape} across axis ${axis} and keeps it solid`, () => {
        const c: Cube = { shape, from: [2, 3, 4], size: [6, 8, 10], color: "#abcdef", ...extra };
        const m = mirrorElement(c, axis);
        const reflected = new Set([...positions(c)].map((s) => key(s.split(",").map((x, a) => (a === axis ? -Number(x) : Number(x))))));
        expect(positions(m)).toEqual(reflected);
        expect(vol(m)).toBeGreaterThan(0);
        expect(vol(m)).toBeCloseTo(vol(c), 4);
      });
    }
  }

  it("swaps the coloured faces of a box across the mirror", () => {
    const m = mirrorElement(box({ faces: { east: "#ff0000" } }), 0);
    expect(m.faces).toEqual({ west: "#ff0000" });
    expect(m.from).toEqual([-10, 0, 0]);
  });

  it("mirrors a mesh and keeps its faces outward", () => {
    const m = toMesh(box({ from: [2, 0, 0] }));
    const r = mirrorElement(m, 0);
    expect(r.from[0]).toBe(-12);
    expect(vol(r)).toBeCloseTo(1000, 6);
  });
});

describe("meshes in files", () => {
  it("survive saving and loading", () => {
    let d = addCube(newModel(), [0], extrudeFace(freshMesh("#336699"), 0, 5).cube).doc;
    d = addCube(d, [0], subdivide(toMesh(box()), [0])).doc;
    const text = serializeModel(d);
    const back = parseModel(text);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.doc.parts[0]!.cubes[1]).toEqual(d.parts[0]!.cubes[1]);
    expect(serializeModel(back.doc)).toBe(text);
    expect(text).toContain('"shape": "mesh"');
  });

  it("are checked", () => {
    const mesh = (c: object) => parseModel(JSON.stringify({ parts: [{ name: "a", origin: [0, 0, 0], rotation: [0, 0, 0], children: [], cubes: [{ shape: "mesh", color: "#ffffff", verts: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], polys: [{ v: [0, 1, 2] }], ...c }] }] }));
    expect(mesh({}).ok).toBe(true);
    expect(mesh({ polys: [{ v: [0, 1, 7] }] })).toMatchObject({ ok: false });
    expect(mesh({ polys: [{ v: [0, 1] }] })).toMatchObject({ ok: false });
    expect(mesh({ polys: [{ v: [0, 1, 1] }] })).toMatchObject({ ok: false });
    expect(mesh({ verts: [[0, 0]] })).toMatchObject({ ok: false });
    expect(mesh({ polys: [{ v: [0, 1, 2], color: "red" }] })).toMatchObject({ ok: false });
    expect(mesh({ rotation: [0, 10, 0] })).toMatchObject({ ok: false });
    const ok = mesh({});
    if (ok.ok) expect(ok.doc.parts[0]!.cubes[0]).toMatchObject({ from: [0, 0, 0], size: [1, 1, 0] });
  });
});

describe("mirroring parts", () => {
  it("reflects a part, its shapes and its children across the parent's centre line", () => {
    let d = newModel();
    d.parts[0]!.cubes = [];
    d = { ...d, parts: [{ name: "body", origin: [0, 0, 0], rotation: [0, 0, 0], cubes: [], children: [{ name: "arm", origin: [6, 4, 0], rotation: [0, 0, 30], cubes: [box({ from: [0, 0, 0], size: [2, 6, 2] })], children: [] }] }] };
    const r = mirrorPart(d, [0, 0], 0)!;
    expect(r.path).toEqual({ parts: [0, 1] });
    const twin = r.doc.parts[0]!.children[1]!;
    expect(twin.name).toBe("arm mirror");
    expect(twin.origin).toEqual([-6, 4, 0]);
    expect(twin.rotation).toEqual([0, 0, -30]);
    expect(twin.cubes[0]!.from).toEqual([-2, 0, 0]);
    expect(r.doc.parts[0]!.children[0]).toEqual(d.parts[0]!.children[0]);
    expect(mirrorPart(d, [5], 0)).toBeNull();
  });
});

import { transformMesh } from "./mesh-edit";

describe("transforming a mesh with a matrix", () => {
  // column-major
  const translate = (x: number, y: number, z: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
  const scale = (x: number, y: number, z: number) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
  it("moves, resizes and keeps the bounds in step", () => {
    const m = toMesh(box());
    const moved = transformMesh(m, translate(5, -2, 1));
    expect(moved.from).toEqual([5, -2, 1]);
    expect(moved.size).toEqual([10, 10, 10]);
    const big = transformMesh(m, scale(2, 1, 0.5));
    expect(big.size).toEqual([20, 10, 5]);
    expect(vol(big)).toBeCloseTo(1000, 6);
  });

  it("keeps faces outward when a resize flips the mesh", () => {
    const flipped = transformMesh(toMesh(box()), scale(-1, 1, 1));
    expect(vol(flipped)).toBeCloseTo(1000, 6);
    expect(flipped.from[0]).toBe(-10);
  });

  it("turns a mesh a quarter about y", () => {
    const m = toMesh(box({ size: [4, 2, 2] }));
    const c = Math.cos(Math.PI / 2), s = Math.sin(Math.PI / 2);
    const turned = transformMesh(m, [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
    expect(turned.size.map((n) => Math.round(n))).toEqual([2, 2, 4]);
    expect(vol(turned)).toBeCloseTo(16, 6);
  });
});

import { loopCut, moveVertsSymmetric } from "./mesh-edit";

describe("tapering and insetting", () => {
  it("pulls the new face towards its middle", () => {
    const m = toMesh(box());
    const up = upFace(m);
    const taper = extrudeFace(m, up, 5, 0.5).cube;
    expect(taper.size).toEqual([10, 15, 10]);
    // a frustum: 10x10 base to 5x5 top over 5 units
    expect(vol(taper)).toBeCloseTo(1000 + (5 * (100 + 25 + Math.sqrt(100 * 25))) / 3, 4);
    const inset = extrudeFace(m, up, 0, 0.2);
    expect(inset.cube.polys).toHaveLength(10);
    expect(vol(inset.cube)).toBeCloseTo(1000, 6); // nothing moved up or down
    const top = faceCentre(inset.cube, up);
    expect(top[1]).toBeCloseTo(10, 6);
    // each point went a fifth of the way to the middle, so the cap is 80% of its width
    const xs = inset.cube.polys![up]!.v.map((i) => inset.cube.verts![i]![0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(8, 6);
    expect(extrudeFace(m, up, 1, 7).cube.polys).toHaveLength(10); // an oversized shrink is held back
  });
});

describe("loop cuts", () => {
  it("cuts the ring of faces around a box in two without changing its shape", () => {
    const m = toMesh(box());
    const up = upFace(m);
    for (const way of [0, 1] as const) {
      const r = loopCut(m, up, way);
      // the ring runs round the box through four faces, so four edges are crossed
      expect(r.points).toHaveLength(4);
      expect(r.cube.polys).toHaveLength(6 + 4);
      expect(vol(r.cube)).toBeCloseTo(1000, 6);
      expect(r.cube.size).toEqual([10, 10, 10]);
    }
  });

  it("cuts at a chosen place and leaves a face that is not four-sided alone", () => {
    const m = toMesh(box());
    const r = loopCut(m, upFace(m), 0, 0.25);
    const ys = r.points.map((i) => r.cube.verts![i]!);
    expect(ys.length).toBe(4);
    const tri = toMesh({ shape: "wedge", from: [0, 0, 0], size: [4, 4, 4], color: "#ffffff" });
    const triFace = tri.polys!.findIndex((f) => f.v.length === 3);
    expect(loopCut(tri, triFace, 0).points).toEqual([]);
  });

  it("stops at a boundary", () => {
    const sheet = freshMesh();
    const { cube } = extrudeFace(sheet, 0, 4);
    const r = loopCut(cube, 0, 0);
    expect(r.cube.polys!.length).toBeGreaterThan(cube.polys!.length);
  });
});

describe("symmetry", () => {
  const half = toMesh(box({ from: [-5, 0, -5] }));
  it("moves the point across the mirror plane the opposite way", () => {
    const i = half.verts!.findIndex((p) => p[0] === 5 && p[1] === 10 && p[2] === 5);
    const out = moveVertsSymmetric(half, [i], [2, 3, 0], 0);
    expect(out.verts![i]).toEqual([7, 13, 5]);
    const twin = half.verts!.findIndex((p) => p[0] === -5 && p[1] === 10 && p[2] === 5);
    expect(out.verts![twin]).toEqual([-7, 13, 5]);
  });

  it("keeps points on the plane on it, and does not move a twin twice", () => {
    const sheet = freshMesh();
    sheet.verts![0] = [0, 0, 4];
    const on = moveVertsSymmetric(sheet, [0], [3, 1, 0], 0);
    expect(on.verts![0]).toEqual([0, 1, 4]);
    const i = half.verts!.findIndex((p) => p[0] === 5 && p[1] === 10 && p[2] === 5);
    const twin = half.verts!.findIndex((p) => p[0] === -5 && p[1] === 10 && p[2] === 5);
    const both = moveVertsSymmetric(half, [i, twin], [1, 0, 0], 0);
    expect(both.verts![i]![0]).toBe(6);
    expect(both.verts![twin]![0]).toBe(-5 + 1); // each moved by what was asked, not mirrored over each other
  });

  it("moves a lone point when there is no twin", () => {
    const m = moveVertsSymmetric(toMesh(box({ from: [1, 0, 0] })), [0], [0, 5, 0], 0);
    expect(m.verts![0]![1]).toBe(5);
  });
});
