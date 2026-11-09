import { describe, expect, it } from "vitest";
import { exportGlb } from "./glb";
import { toMesh } from "./mesh-edit";
import { addCube, newModel, parseModel, serializeModel, type Cube } from "./model-doc";
import { signedVolume } from "./model-mesh";
import { applyStack, array, bevel, evaluate, hasModifiers, mirror, newModifier, solidify, subdivideOnce, subsurf, type Soup } from "./modifiers";

const box = (size = 10, at = 0): Cube => toMesh({ from: [at, at, at], size: [size, size, size], color: "#c9d1d9" });
const soupOf = (c: Cube): Soup => ({ verts: c.verts!, polys: c.polys! });
const volume = (s: Soup) => signedVolume({ shape: "mesh", from: [0, 0, 0], size: [0, 0, 0], color: "#fff", verts: s.verts, polys: s.polys }) / 6;
/// Every edge belongs to exactly two polygons that run opposite ways: a closed, consistently wound surface.
const closed = (s: Soup) => {
  const dir = new Map<string, number>();
  for (const f of s.polys) f.v.forEach((a, k) => { const key = `${a}>${f.v[(k + 1) % f.v.length]}`; dir.set(key, (dir.get(key) ?? 0) + 1); });
  for (const [key, n] of dir) {
    const [a, b] = key.split(">");
    if (n !== 1 || dir.get(`${b}>${a}`) !== 1) return false;
  }
  return true;
};
const bounds = (s: Soup) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of s.verts) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a]!, p[a]!); hi[a] = Math.max(hi[a]!, p[a]!); }
  return { lo, hi };
};

describe("mirror", () => {
  // The half of a box on the +x side of the plane: five faces, open at x = 0.
  const half = (): Soup => {
    const c = box(10);
    const s = soupOf(c);
    const verts = s.verts.map((p) => [p[0] + 0, p[1], p[2]] as [number, number, number]);
    return { verts, polys: s.polys };
  };

  it("doubles the polygons and flips their winding", () => {
    const m = mirror({ verts: box(10, 1).verts!, polys: box(10, 1).polys! }, { type: "mirror", axis: "x", merge: 0.01 });
    expect(m.polys).toHaveLength(12);
    expect(m.verts).toHaveLength(16);
    expect(volume(m)).toBeCloseTo(2000, 6);
    expect(bounds(m).lo[0]).toBeCloseTo(-11, 6);
    expect(bounds(m).hi[0]).toBeCloseTo(11, 6);
  });

  it("joins the halves where they meet the plane and drops the wall between them", () => {
    const m = mirror(half(), { type: "mirror", axis: "x" });
    // The face lying in the plane goes, the four ring faces and the far end stay twice, and the shared points are single.
    expect(m.polys).toHaveLength(10);
    expect(m.verts).toHaveLength(12);
    expect(closed(m)).toBe(true);
    expect(volume(m)).toBeCloseTo(2000, 6);
  });

  it("with clip pulls points near the plane onto it so there is no gap", () => {
    const s = half();
    s.verts[0] = [0.004, s.verts[0]![1], s.verts[0]![2]];
    const joined = mirror(s, { type: "mirror", axis: "x", merge: 0.01, clip: true });
    expect(closed(joined)).toBe(true);
    const loose = mirror(s, { type: "mirror", axis: "x", merge: 0.001, clip: false });
    expect(closed(loose)).toBe(false);
  });

  it("mirrors about any axis and any centre", () => {
    const c = box(4, 1);
    const y = mirror(soupOf(c), { type: "mirror", axis: "y", center: 0 });
    expect(bounds(y).lo[1]).toBeCloseTo(-5, 6);
    const z = mirror(soupOf(c), { type: "mirror", axis: "z", center: 10 });
    expect(bounds(z).hi[2]).toBeCloseTo(19, 6);
  });

  it("keeps colours and smoothing on the copy", () => {
    const s = soupOf(box(4, 1));
    s.polys[0] = { ...s.polys[0]!, color: "#ff0000", smooth: true };
    const m = mirror(s, { type: "mirror", axis: "x" });
    expect(m.polys.filter((f) => f.color === "#ff0000")).toHaveLength(2);
    expect(m.polys.filter((f) => f.smooth)).toHaveLength(2);
  });
});

describe("subdivision surface", () => {
  it("makes a quad of every corner of every face", () => {
    const once = subdivideOnce(soupOf(box()), true);
    expect(once.polys).toHaveLength(24);
    expect(once.verts).toHaveLength(8 + 12 + 6);
    expect(closed(once)).toBe(true);
  });

  it("puts a cube's corners where Catmull-Clark says", () => {
    const once = subdivideOnce(soupOf(box(2)), true);
    // The cube [0,2]^3: its corner moves to (5/9, 5/9, 5/9) of the way... worked out: (F + 2R + 0 * P) / 3 with n = 3.
    const corner = once.verts[0]!;
    const expected = (v: number) => v; // eslint-disable-line
    void expected;
    // Corner 0 of the cube sits at (0,0,0): the three face points are at 1/3-way averages of (1,1,0),(1,0,1),(0,1,1) = (2/3,2/3,2/3);
    // the three edge midpoints average to (1/3, 1/3, 1/3) (twice that makes 2/3): (2/3 + 2/3·... ) / 3
    const f = 2 / 3;
    const r = 1 / 3;
    expect(corner[0]).toBeCloseTo((f + 2 * r) / 3, 9);
    expect(corner[1]).toBeCloseTo((f + 2 * r) / 3, 9);
  });

  it("shrinks a cube towards a sphere, a little more at each level, and stays closed", () => {
    const cube = soupOf(box());
    const v = [0, 1, 2, 3].map((l) => volume(subsurf(cube, l)));
    expect(v[0]).toBeCloseTo(1000, 6);
    expect(v[1]!).toBeLessThan(v[0]!);
    expect(v[2]!).toBeLessThan(v[1]!);
    expect(v[3]!).toBeLessThan(v[2]!);
    expect(v[3]!).toBeGreaterThan(250); // it settles near a third of the cube
    expect(closed(subsurf(cube, 3))).toBe(true);
  });

  it("leaves open borders on their own curve", () => {
    const plane: Soup = { verts: [[0, 0, 0], [4, 0, 0], [4, 0, -4], [0, 0, -4]], polys: [{ v: [0, 1, 2, 3] }] };
    const out = subsurf(plane, 2);
    const b = bounds(out);
    expect(b.lo[1]).toBeCloseTo(0, 9);
    expect(b.hi[1]).toBeCloseTo(0, 9);
    // The corners are pulled in a little, the middle of the border stays straight.
    expect(b.hi[0]).toBeLessThanOrEqual(4);
    expect(out.polys).toHaveLength(16);
  });

  it("shades smoothly unless told not to, and keeps polygon colours", () => {
    const s = soupOf(box());
    s.polys[2] = { ...s.polys[2]!, color: "#00ff00" };
    const out = subsurf(s, 1, true);
    expect(out.polys.every((f) => f.smooth)).toBe(true);
    expect(out.polys.filter((f) => f.color === "#00ff00")).toHaveLength(4);
    expect(subsurf(s, 1, false).polys.some((f) => f.smooth)).toBe(false);
  });

  it("stops before the limit on the number of polygons", () => {
    const out = subsurf(subsurf(soupOf(box()), 4), 4);
    expect(out.polys.length).toBeLessThanOrEqual(20000);
  });
});

describe("bevel", () => {
  it("rounds every edge of a cube: faces, strips and corner caps", () => {
    const out = bevel(soupOf(box()), { type: "bevel", width: 1, segments: 1, angle: 30 });
    // 6 faces + 12 edge strips + 8 corner triangles
    expect(out.polys).toHaveLength(26);
    expect(out.verts).toHaveLength(24);
    expect(closed(out)).toBe(true);
    expect(volume(out)).toBeLessThan(1000);
    expect(volume(out)).toBeGreaterThan(900);
  });

  it("more segments make a rounder, slightly bigger corner", () => {
    const flat = volume(bevel(soupOf(box()), { type: "bevel", width: 2, segments: 1 }));
    const round = volume(bevel(soupOf(box()), { type: "bevel", width: 2, segments: 4 }));
    const out = bevel(soupOf(box()), { type: "bevel", width: 2, segments: 4 });
    expect(closed(out)).toBe(true);
    expect(round).toBeGreaterThan(flat);
    expect(round).toBeLessThan(1000);
    // The faces stay where they were.
    expect(bounds(out).lo[0]).toBeCloseTo(0, 6);
    expect(bounds(out).hi[0]).toBeCloseTo(10, 6);
  });

  it("the section is a circular arc: points lie a fixed distance from its centre", () => {
    const out = bevel(soupOf(box()), { type: "bevel", width: 2, segments: 6 });
    // The vertical edge at the corner (0, 0): where it ends at y = 2 its section is an arc round (2, 2, 2).
    const onEdge = out.verts.filter((p) => Math.abs(p[1] - 2) < 1e-6 && p[0] < 2.0001 && p[2] < 2.0001);
    expect(onEdge.length).toBeGreaterThanOrEqual(7);
    for (const p of onEdge) expect(Math.hypot(p[0] - 2, p[2] - 2)).toBeCloseTo(2, 6);
  });

  it("leaves edges flatter than the angle limit alone", () => {
    const out = bevel(soupOf(box()), { type: "bevel", width: 1, segments: 2, angle: 100 });
    expect(out.polys).toHaveLength(6);
    expect(out.verts).toHaveLength(8);
  });

  it("bevels only the sharp edges of a mixed mesh and stays closed", () => {
    // A cube whose top is subdivided: the edges inside the top are flat (0 degrees) and stay as they are.
    const top = toMesh({ from: [0, 0, 0], size: [10, 10, 10], color: "#fff" });
    const cut = { ...top, polys: top.polys!.map((f) => f) };
    const sub = subdivideOnce(soupOf(cut), false);
    const out = bevel(sub, { type: "bevel", width: 0.5, segments: 2, angle: 30 });
    expect(closed(out)).toBe(true);
    expect(volume(out)).toBeLessThan(1000);
  });

  it("a width of zero changes nothing", () => {
    const s = soupOf(box());
    expect(bevel(s, { type: "bevel", width: 0 })).toBe(s);
  });
});

describe("solidify", () => {
  const sheet: Soup = { verts: [[0, 0, 0], [4, 0, 0], [4, 0, -4], [0, 0, -4]], polys: [{ v: [0, 1, 2, 3] }] };

  it("makes a sheet into a closed slab", () => {
    const out = solidify(sheet, { type: "solidify", thickness: 1, offset: -1 });
    expect(out.polys).toHaveLength(6);
    expect(closed(out)).toBe(true);
    expect(volume(out)).toBeCloseTo(16, 6);
    const b = bounds(out);
    expect(b.lo[1]).toBeCloseTo(-1, 6);
    expect(b.hi[1]).toBeCloseTo(0, 6);
  });

  it("offset chooses which side the wall grows on", () => {
    const up = bounds(solidify(sheet, { type: "solidify", thickness: 2, offset: 1 }));
    expect(up.lo[1]).toBeCloseTo(0, 6);
    expect(up.hi[1]).toBeCloseTo(2, 6);
    const mid = bounds(solidify(sheet, { type: "solidify", thickness: 2, offset: 0 }));
    expect(mid.lo[1]).toBeCloseTo(-1, 6);
    expect(mid.hi[1]).toBeCloseTo(1, 6);
  });

  it("hollows a closed mesh into a shell: volume is the difference of the two", () => {
    const out = solidify(soupOf(box(10)), { type: "solidify", thickness: 1, offset: -1, even: true });
    expect(out.polys).toHaveLength(12);
    expect(closed(out)).toBe(true);
    // 10^3 outside minus the inner box, which is about 8^3 (corners move 1 along each face normal with even thickness)
    expect(volume(out)).toBeCloseTo(1000 - 512, 0);
  });
});

describe("array", () => {
  it("repeats the mesh by a fixed offset", () => {
    const out = array(soupOf(box(2)), { type: "array", count: 3, offset: [5, 0, 0] });
    expect(out.verts).toHaveLength(24);
    expect(out.polys).toHaveLength(18);
    expect(bounds(out).hi[0]).toBeCloseTo(12, 6);
  });

  it("relative offset is a fraction of the mesh's size, and adds to the fixed one", () => {
    const out = array(soupOf(box(4)), { type: "array", count: 2, offset: [1, 0, 0], relative: [1, 0, 0] });
    expect(bounds(out).hi[0]).toBeCloseTo(9, 6);
  });

  it("merge joins the touching faces of neighbours", () => {
    const out = array(soupOf(box(4)), { type: "array", count: 2, offset: [4, 0, 0], merge: 0.01 });
    expect(out.verts).toHaveLength(12);
  });

  it("limits the count", () => {
    expect(array(soupOf(box(2)), { type: "array", count: 1000, offset: [3, 0, 0] }).verts.length).toBeLessThanOrEqual(20000);
    expect(array(soupOf(box(2)), { type: "array", count: 1 }).polys).toHaveLength(6);
  });
});

describe("the stack on an element", () => {
  const car = (): Cube => ({ ...box(), modifiers: [{ type: "mirror", axis: "x", merge: 0.01 }, { type: "subsurf", levels: 1, renderLevels: 2 }] });

  it("leaves an element with no (visible) modifiers as it is", () => {
    const plain = box();
    expect(evaluate(plain)).toBe(plain);
    const hidden: Cube = { ...car(), modifiers: [{ type: "subsurf", show: false }] };
    expect(evaluate(hidden, "view")).toBe(hidden);
    expect(hasModifiers(hidden, "render")).toBe(true);
  });

  it("runs the stack in order and never touches the cage", () => {
    const c = car();
    const before = JSON.stringify(c);
    const view = evaluate(c, "view");
    const render = evaluate(c, "render");
    expect(JSON.stringify(c)).toBe(before);
    expect(view.modifiers).toBeUndefined();
    expect(render.polys!.length).toBeGreaterThan(view.polys!.length);
  });

  it("uses the viewport level on screen and the export level in the file", () => {
    const c: Cube = { ...box(), modifiers: [{ type: "subsurf", levels: 0, renderLevels: 2 }] };
    expect(evaluate(c, "view").polys).toHaveLength(6);
    expect(evaluate(c, "render").polys).toHaveLength(96);
    const off: Cube = { ...box(), modifiers: [{ type: "subsurf", levels: 1, renderLevels: 1, render: false }] };
    expect(evaluate(off, "render")).toBe(off);
  });

  it("Apply bakes a modifier into the cage and keeps the others", () => {
    const c = car();
    const applied = applyStack(c, 1);
    expect(applied.modifiers).toEqual([{ type: "subsurf", levels: 1, renderLevels: 2 }]);
    expect(applied.polys!.length).toBe(10); // the box's face in the plane goes: 5 + 5
    expect(applyStack(c, 2).modifiers).toBeUndefined();
    expect(applyStack(c, 2).polys).toHaveLength(evaluate(c, "view").polys!.length);
  });

  it("is ignored on a skinned mesh", () => {
    const c: Cube = { ...car(), skin: { bones: ["a"], weights: Array.from({ length: 8 }, () => [[0, 1]] as [number, number][]) } };
    expect(evaluate(c)).toBe(c);
  });

  it("a half cage with Mirror and Subdivision becomes a smooth closed body", () => {
    // The right half of a body: a box from the x = 0 plane outwards.
    const half = toMesh({ from: [0, 0, 0], size: [8, 4, 16], color: "#cc2222" });
    const body: Cube = { ...half, modifiers: [{ type: "mirror", axis: "x" }, { type: "subsurf", levels: 2 }] };
    const out = evaluate(body, "view");
    expect(closed({ verts: out.verts!, polys: out.polys! })).toBe(true);
    expect(out.polys!.every((f) => f.smooth && f.color === undefined)).toBe(true);
    // Symmetrical about x = 0.
    const b = bounds({ verts: out.verts!, polys: out.polys! });
    expect(b.lo[0]).toBeCloseTo(-b.hi[0]!, 9);
  });
});

const put = (cube: Partial<Cube>) => addCube({ ...newModel(), parts: [{ ...newModel().parts[0]!, cubes: [] }] }, [0], cube);

describe("saving", () => {
  const withMods = (): Cube => ({ ...box(), modifiers: [{ type: "mirror", axis: "z", center: 2, clip: false }, { type: "bevel", width: 0.5, segments: 3, angle: 40, show: false }, { type: "array", count: 3, offset: [1, 2, 3], render: false }] });

  it("round-trips through the model file, and files without modifiers load unchanged", () => {
    const doc = put({ ...withMods() }).doc;
    const parsed = parseModel(serializeModel(doc));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.doc.parts[0]!.cubes[0]!.modifiers).toEqual(withMods().modifiers);
    const plain = put({}).doc;
    expect(serializeModel(plain)).not.toContain("modifiers");
  });

  it("rejects bad modifiers with a plain message", () => {
    const bad = (m: unknown, c = withMods()) => {
      const doc = put({ ...c, modifiers: [m as never] }).doc;
      const r = parseModel(JSON.stringify(doc));
      return r.ok ? null : r.error;
    };
    expect(bad({ type: "twirl" })).toMatch(/modifiers\[0\]\.type must be one of/);
    expect(bad({ type: "mirror", axis: "w" })).toMatch(/axis must be x, y or z/);
    expect(bad({ type: "subsurf", levels: 9 })).toMatch(/levels/);
    expect(bad({ type: "bevel", segments: 1.5 })).toMatch(/segments/);
    expect(bad({ type: "array", offset: [1, 2] })).toMatch(/three numbers/);
    expect(bad({ type: "mirror", axis: "x" }, { ...box(), shape: "box", verts: undefined, polys: undefined, from: [0, 0, 0], size: [1, 1, 1] })).toMatch(/only for a mesh/);
  });

  it("every default modifier is valid", () => {
    for (const t of ["mirror", "subsurf", "bevel", "solidify", "array"] as const) {
      const doc = put({ ...box(), modifiers: [newModifier(t)] }).doc;
      expect(parseModel(serializeModel(doc)).ok).toBe(true);
    }
  });

  it("exports the finished mesh to the .glb while the file keeps the cage", () => {
    const doc = put({ ...box(), modifiers: [{ type: "subsurf", levels: 0, renderLevels: 1 }] }).doc;
    const glb = exportGlb(doc);
    const count = (g: Uint8Array) => {
      const json = JSON.parse(new TextDecoder().decode(g.slice(20, 20 + new DataView(g.buffer, g.byteOffset).getUint32(12, true)))) as { accessors: { count: number; type: string }[] };
      return json.accessors.find((x) => x.type === "VEC3")!.count;
    };
    expect(count(glb)).toBe(96); // 24 quads, each with its own four points
    expect(doc.parts[0]!.cubes[0]!.polys).toHaveLength(6); // the cage is untouched
    expect(count(exportGlb(put(box()).doc))).toBe(24);
  });
});
