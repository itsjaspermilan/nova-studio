import { describe, expect, it } from "vitest";
import { addShapeKey, blendShapeKeys, partShapeNames, removeShapeKey, renameShapeKey, shapeDeltas, swapWithKey, validKeyName } from "./shape-keys";
import { moveVerts, toMesh } from "./mesh-edit";
import type { Cube } from "./model-doc";

const box = (): Cube => toMesh({ from: [0, 0, 0], size: [10, 10, 10], color: "#ffffff" });

describe("shape keys", () => {
  it("a new key copies the points, names are checked and there are at most eight", () => {
    let c = addShapeKey(box(), "smile");
    expect(c.shapes![0]!.verts).toEqual(c.verts);
    expect(addShapeKey(c, "smile")).toBe(c);
    expect(addShapeKey(c, "no good!")).toBe(c);
    for (let i = 0; i < 12; i++) c = addShapeKey(c, `k${i}`);
    expect(c.shapes!.length).toBe(8);
    expect(validKeyName("Mouth open-1")).toBe(true);
    expect(validKeyName("")).toBe(false);
  });
  it("editing a key by swapping: the points become the key's, and swapping again restores everything", () => {
    const c0 = addShapeKey(box(), "up");
    const swapped = swapWithKey(c0, "up");
    const edited = moveVerts(swapped, [0], [0, 5, 0]); // pull a point of the key
    const back = swapWithKey(edited, "up");
    expect(back.verts).toEqual(c0.verts); // the base is as it was
    expect(back.shapes![0]!.verts[0]![1]).toBe(c0.verts![0]![1]! + 5); // the key has the pulled point
  });
  it("blends by weight for a preview, and gives the exporter the offsets per emitted vertex", () => {
    let c = addShapeKey(box(), "up");
    c = swapWithKey(moveVerts(swapWithKey(c, "up"), [0], [0, 4, 0]), "up");
    const half = blendShapeKeys(c, { up: 0.5 });
    expect(half.verts![0]![1]).toBe(c.verts![0]![1]! + 2);
    expect(half.shapes).toBeUndefined();
    expect(blendShapeKeys(c, {}).verts).toEqual(c.verts);
    const d = shapeDeltas(c, "up", 0.5)!;
    expect(d.length).toBe(c.polys!.reduce((n, p) => n + p.v.length * 3, 0));
    expect(d.filter((v) => v !== 0).length).toBeGreaterThan(0);
    expect(Math.max(...d)).toBe(2);
    expect(shapeDeltas(c, "none", 1)!.every((v) => v === 0)).toBe(true);
    expect(shapeDeltas({ ...c, modifiers: [{ type: "subdivision", levels: 1 } as never] }, "up", 1)).toBeNull();
  });
  it("renames and removes keys, and lists a part's keys", () => {
    let c = addShapeKey(addShapeKey(box(), "a"), "b");
    c = renameShapeKey(c, "a", "c");
    expect(c.shapes!.map((s) => s.name)).toEqual(["c", "b"]);
    expect(renameShapeKey(c, "c", "b")).toBe(c);
    expect(partShapeNames({ name: "p", origin: [0, 0, 0], rotation: [0, 0, 0], cubes: [c], children: [] })).toEqual(["c", "b"]);
    expect(removeShapeKey(removeShapeKey(c, "c"), "b").shapes).toBeUndefined();
  });
});

import { exportGlb } from "./glb";
import { newModel, addCube } from "./model-doc";
describe("shape keys in the glb", () => {
  const jsonOf = (glb: Uint8Array) => {
    const len = new DataView(glb.buffer, glb.byteOffset).getUint32(12, true);
    return JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + len)));
  };
  it("become morph targets with their names on the mesh", () => {
    let doc = newModel();
    doc = { ...doc, parts: doc.parts.map((p, i) => (i === 0 ? { ...p, cubes: [] } : p)) };
    const a = addCube(doc, [0], { from: [0, 0, 0], size: [8, 8, 8], color: "#c8c8c8" });
    doc = a.doc;
    let c = addShapeKey(toMesh(doc.parts[0]!.cubes[0]!), "up");
    c = swapWithKey(moveVerts(swapWithKey(c, "up"), [0], [0, 4, 0]), "up");
    doc = { ...doc, parts: doc.parts.map((p, i) => (i === 0 ? { ...p, cubes: [c] } : p)) };
    const json = jsonOf(exportGlb(doc));
    const mesh = json.meshes[0];
    expect(mesh.extras.targetNames).toEqual(["up"]);
    expect(mesh.primitives[0].targets.length).toBe(1);
    const acc = json.accessors[mesh.primitives[0].targets[0].POSITION];
    expect(acc.max[1]).toBeGreaterThan(0);
    // a model without shape keys has no targets
    const plain = jsonOf(exportGlb({ ...doc, parts: doc.parts.map((p, i) => (i === 0 ? { ...p, cubes: [{ ...c, shapes: undefined }] } : p)) }));
    expect(plain.meshes[0].primitives[0].targets).toBeUndefined();
  });
});

import { serializeModel, parseModel, settleKeyEdits } from "./model-doc";
import { beginKeyEdit, endKeyEdit } from "./shape-keys";
describe("editing a key leaves nothing behind in the file", () => {
  it("is written and exported as if the key edit were finished, and round-trips with the key's points", () => {
    let doc = newModel();
    doc = { ...doc, parts: doc.parts.map((p, i) => (i === 0 ? { ...p, cubes: [] } : p)) };
    const a = addCube(doc, [0], { from: [0, 0, 0], size: [8, 8, 8], color: "#c8c8c8" });
    let c = addShapeKey(toMesh(a.doc.parts[0]!.cubes[0]!), "up");
    const rest = JSON.parse(JSON.stringify(c.verts));
    c = moveVerts(beginKeyEdit(c, "up"), [0], [0, 4, 0]);
    expect(c.keyEdit).toBe("up");
    const mid = { ...a.doc, parts: a.doc.parts.map((p, i) => (i === 0 ? { ...p, cubes: [c] } : p)) };
    const parsed = parseModel(serializeModel(mid));
    if (!parsed.ok) throw new Error(parsed.error);
    const saved = parsed.doc.parts[0]!.cubes[0]!;
    expect(saved.keyEdit).toBeUndefined();
    expect(saved.verts).toEqual(rest);
    expect(saved.shapes![0]!.verts[0]![1]).toBe(rest[0][1] + 4);
    expect(settleKeyEdits(mid).parts[0]!.cubes[0]!.keyEdit).toBeUndefined();
    expect(endKeyEdit(c).verts).toEqual(rest);
  });
});

describe("constraints in the glb", () => {
  it("are written on the part's node, a reach target in metres", () => {
    let doc = newModel();
    doc = { ...doc, parts: doc.parts.map((p, i) => (i === 0 ? { ...p, cubes: [{ from: [0, 0, 0] as [number, number, number], size: [4, 4, 4] as [number, number, number], color: "#ffffff" }], constraints: [{ type: "limit" as const, min: [-10, 0, 0] as [number, number, number], max: [10, 0, 0] as [number, number, number] }, { type: "reach" as const, target: [16, 0, 0] as [number, number, number] }] } : p)) };
    const json = (() => {
      const glb = exportGlb(doc);
      const len = new DataView(glb.buffer, glb.byteOffset).getUint32(12, true);
      return JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + len)));
    })();
    const cons = json.nodes[0].extras.nova.constraints;
    expect(cons[0]).toEqual({ type: "limit", min: [-10, 0, 0], max: [10, 0, 0] });
    expect(cons[1].target[0]).toBeCloseTo(16 * doc.scale, 6);
  });
});
