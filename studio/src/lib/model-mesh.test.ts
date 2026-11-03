import { describe, expect, it } from "vitest";
import { eulerToQuaternion, exportGlb } from "./glb";
import { addCube, newModel, parseModel, serializeModel, setFaceColor, updateCube, type Cube, type Shape, type Vec3 } from "./model-doc";
import { FACE_CORNERS, hasVolume, meshOf, rotationMatrix, shapeFaces, signedVolume, solidOf } from "./model-mesh";

const shapes: Shape[] = ["box", "wedge", "pyramid", "cylinder", "cone", "sphere"];
const shape = (s: Shape, extra: Partial<Cube> = {}): Cube => ({ shape: s, from: [-3, 1, 2], size: [10, 8, 6], color: "#c9d1d9", segments: 48, ...extra });
const key = (p: number[]) => p.map((x) => x.toFixed(4)).join(",");
const positions = (c: Cube) => {
  const m = meshOf(c);
  const out = new Set<string>();
  for (let i = 0; i < m.positions.length; i += 3) out.add(key([m.positions[i]!, m.positions[i + 1]!, m.positions[i + 2]!]));
  return out;
};

describe("solids", () => {
  it("wind every triangle outwards, so the signed volume is positive and about right", () => {
    const box = 10 * 8 * 6;
    const expected: Record<string, number> = { box, wedge: box / 2, pyramid: box / 3, cylinder: (box * Math.PI) / 4, cone: (box * Math.PI) / 12, sphere: (box * Math.PI) / 6 };
    for (const s of shapes) {
      const v = signedVolume(shape(s)) / 6;
      expect(v, s).toBeGreaterThan(0);
      expect(Math.abs(v - expected[s]!) / expected[s]!, s).toBeLessThan(0.02);
    }
  });

  it("keeps the volume when a shape is turned about its centre", () => {
    for (const s of shapes) {
      const flat = signedVolume(shape(s));
      expect(signedVolume(shape(s, { rotation: [30, 45, 60] })), s).toBeCloseTo(flat, 4);
    }
  });

  it("faces every flat polygon of a convex shape away from its middle", () => {
    for (const s of ["box", "wedge", "pyramid"] as Shape[]) {
      const c = shape(s, { rotation: [10, 20, 30] });
      const used = [...new Set(solidOf(c).polys.flatMap((p) => p.v))].map((i) => solidOf(c).verts[i]!);
      const mid = used.reduce((a, p) => [a[0]! + p[0] / used.length, a[1]! + p[1] / used.length, a[2]! + p[2] / used.length], [0, 0, 0]);
      const m = meshOf(c);
      for (let t = 0; t < m.indices.length; t += 3) {
        const o = m.indices[t]! * 3;
        const n = [m.normals[o]!, m.normals[o + 1]!, m.normals[o + 2]!];
        const toward = [m.positions[o]! - mid[0]!, m.positions[o + 1]! - mid[1]!, m.positions[o + 2]! - mid[2]!];
        expect(n[0]! * toward[0]! + n[1]! * toward[1]! + n[2]! * toward[2]!, s).toBeGreaterThan(0);
      }
    }
  });

  it("gives unit normals, and a box still has 24 vertices and 12 triangles", () => {
    expect(meshOf(shape("box")).positions.length / 3).toBe(24);
    expect(meshOf(shape("box")).indices.length).toBe(36);
    for (const s of shapes) {
      const m = meshOf(shape(s, { segments: 8 }));
      for (let i = 0; i < m.normals.length; i += 3) expect(Math.hypot(m.normals[i]!, m.normals[i + 1]!, m.normals[i + 2]!), s).toBeCloseTo(1, 5);
    }
  });

  it("shades round sides smoothly unless told not to", () => {
    const smooth = meshOf(shape("cylinder", { segments: 8 }));
    const flat = meshOf(shape("cylinder", { segments: 8, smooth: false }));
    const distinct = (m: ReturnType<typeof meshOf>) => new Set(Array.from({ length: m.normals.length / 3 }, (_, i) => key([m.normals[i * 3]!, m.normals[i * 3 + 1]!, m.normals[i * 3 + 2]!]))).size;
    expect(distinct(smooth)).toBeGreaterThan(distinct(flat) - 1);
    // flat: one normal per side plus two caps; smooth: one per point on each ring, plus the caps
    expect(distinct(flat)).toBe(8 + 2);
    expect(distinct(smooth)).toBe(8 + 2);
  });

  it("colours caps by face and round sides by the element colour", () => {
    let d = addCube(newModel(), [0], shape("cylinder", { segments: 6, faces: { up: "#ff0000" }, color: "#0000ff" })).doc;
    const c = d.parts[0]!.cubes[1]!;
    const m = meshOf(c);
    const colours = new Set<string>();
    for (let i = 0; i < m.colors.length; i += 4) colours.add(m.colors.slice(i, i + 3).join(","));
    expect([...colours].sort()).toEqual(["0,0,255", "255,0,0"]);
    expect(shapeFaces("cylinder")).toEqual(["up", "down"]);
    expect(shapeFaces("sphere")).toEqual([]);
    d = setFaceColor(d, { parts: [0], cube: 1 }, "all", "#00ff00");
    expect(d.parts[0]!.cubes[1]!.faces).toBeUndefined();
  });

  it("skips a shape with no volume", () => {
    expect(hasVolume(shape("sphere", { size: [4, 0, 4] }))).toBe(false);
    expect(meshOf(shape("sphere", { size: [4, 0, 4] })).positions).toEqual([]);
  });

  it("turns like the glTF rotation the exporter writes", () => {
    const deg: Vec3 = [25, -70, 140];
    const m = rotationMatrix(deg);
    const [qx, qy, qz, qw] = eulerToQuaternion(deg);
    for (const p of [[1, 0, 0], [0, 1, 0], [0.3, -2, 5]] as Vec3[]) {
      // q * p * q^-1
      const t = [2 * (qy * p[2] - qz * p[1]), 2 * (qz * p[0] - qx * p[2]), 2 * (qx * p[1] - qy * p[0])];
      const viaQ = [p[0] + qw * t[0]! + (qy * t[2]! - qz * t[1]!), p[1] + qw * t[1]! + (qz * t[0]! - qx * t[2]!), p[2] + qw * t[2]! + (qx * t[1]! - qy * t[0]!)];
      const viaM = [m[0]! * p[0] + m[1]! * p[1] + m[2]! * p[2], m[3]! * p[0] + m[4]! * p[1] + m[5]! * p[2], m[6]! * p[0] + m[7]! * p[1] + m[8]! * p[2]];
      viaM.forEach((v, i) => expect(v).toBeCloseTo(viaQ[i]!, 6));
    }
    expect(FACE_CORNERS.up.normal).toEqual([0, 1, 0]);
  });
});

describe("shapes in the file", () => {
  const doc = () => {
    let d = newModel();
    d = addCube(d, [0], shape("wedge", { rotation: [0, 90, 0] })).doc;
    d = addCube(d, [0], shape("cylinder", { segments: 12, smooth: false })).doc;
    return d;
  };

  it("round-trips shapes, rotation, segments and smoothing", () => {
    const text = serializeModel(doc());
    const back = parseModel(text);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.doc.parts[0]!.cubes.slice(1)).toEqual(doc().parts[0]!.cubes.slice(1));
    expect(serializeModel(back.doc)).toBe(text);
    expect(text).toContain('"shape": "wedge"');
    expect(text).not.toContain('"shape": "box"'); // a box is the default and stays plain
  });

  it("rejects what it cannot draw", () => {
    const bad = (cube: object) => parseModel(JSON.stringify({ parts: [{ name: "a", origin: [0, 0, 0], rotation: [0, 0, 0], children: [], cubes: [{ from: [0, 0, 0], size: [1, 1, 1], color: "#ffffff", ...cube }] }] }));
    expect(bad({ shape: "torus" })).toMatchObject({ ok: false });
    expect(bad({ segments: 2 })).toMatchObject({ ok: false });
    expect(bad({ segments: 12.5 })).toMatchObject({ ok: false });
    expect(bad({ smooth: "yes" })).toMatchObject({ ok: false });
    expect(bad({ rotation: [1, 2] })).toMatchObject({ ok: false });
    expect(bad({ shape: "sphere", segments: 24, rotation: [0, 45, 0] }).ok).toBe(true);
  });

  it("exports every shape into one glb with the right vertex counts", () => {
    const d = doc();
    const out = exportGlb(d);
    const v = new DataView(out.buffer, out.byteOffset);
    const json = JSON.parse(new TextDecoder().decode(out.slice(20, 20 + v.getUint32(12, true))));
    const expected = d.parts[0]!.cubes.reduce((n, c) => n + meshOf(c).positions.length / 3, 0);
    expect(json.accessors[json.meshes[0].primitives[0].attributes.POSITION].count).toBe(expected);
  });

  it("moves a mesh's points when its box is moved or resized", () => {
    const mesh: Cube = { shape: "mesh", from: [0, 0, 0], size: [10, 10, 10], color: "#ffffff", verts: [[0, 0, 0], [10, 0, 0], [10, 10, 10]], polys: [{ v: [0, 1, 2] }] };
    let d = addCube(newModel(), [0], mesh).doc;
    d = updateCube(d, { parts: [0], cube: 1 }, { from: [5, 0, 0] });
    expect(d.parts[0]!.cubes[1]!.verts).toEqual([[5, 0, 0], [15, 0, 0], [15, 10, 10]]);
    d = updateCube(d, { parts: [0], cube: 1 }, { size: [20, 10, 10] });
    expect(d.parts[0]!.cubes[1]!.verts).toEqual([[5, 0, 0], [25, 0, 0], [25, 10, 10]]);
  });
});
