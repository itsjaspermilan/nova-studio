import { describe, expect, it } from "vitest";
import { FACE_CORNERS, eulerToQuaternion, exportGlb } from "./glb";
import { History, addBox, addCapsule, removeBox, removeCapsule, updateBox, updateCapsule, addCollider, removeCollider, updateCollider, addCube, addPart, afterRemoval, countCubes, cubeAt, duplicateNode, newModel, parseModel, partAt, removeNode, serializeModel, setFaceColor, updateCube, updatePart, walk, FACES, type ModelDoc } from "./model-doc";

const sample = (): ModelDoc => {
  let d = newModel();
  d = addPart(d, [0], "wheel").doc;
  d = addCube(d, [0, 0], { from: [-2, -2, -1], size: [4, 4, 2], color: "#202020" }).doc;
  d = updatePart(d, [0, 0], { origin: [6, 2, 8], rotation: [0, 0, 90] });
  return d;
};

describe("parsing and saving", () => {
  it("round-trips a model through its own text", () => {
    const d = setFaceColor(sample(), { parts: [0], cube: 0 }, "up", "#ff0000");
    const text = serializeModel(d);
    expect(parseModel(text)).toEqual({ ok: true, doc: d });
    expect(serializeModel((parseModel(text) as { doc: ModelDoc }).doc)).toBe(text);
    expect(text).toContain('"cubes": [\n');
    expect(text.endsWith("}\n")).toBe(true);
  });

  it("explains what is wrong with a bad file", () => {
    expect(parseModel("{ no")).toMatchObject({ ok: false });
    expect(parseModel("{}")).toMatchObject({ ok: false, error: 'a model file has a "parts" list' });
    const bad = (mutate: (d: any) => void) => {
      const d = JSON.parse(serializeModel(sample()));
      mutate(d);
      return parseModel(JSON.stringify(d));
    };
    expect(bad((d) => (d.parts[0].name = ""))).toMatchObject({ ok: false, error: "parts[0] needs a name" });
    expect(bad((d) => (d.parts[0].origin = [1, 2]))).toMatchObject({ error: "parts[0].origin must be three numbers" });
    expect(bad((d) => (d.parts[0].cubes[0].color = "red"))).toMatchObject({ error: "parts[0].cubes[0].color must be like #c9d1d9" });
    expect(bad((d) => (d.parts[0].cubes[0].size = [1, -1, 1]))).toMatchObject({ error: "parts[0].cubes[0].size cannot be negative" });
    expect(bad((d) => (d.parts[0].children[0].cubes[0].faces = { top: "#ffffff" }))).toMatchObject({ error: expect.stringContaining("parts[0].children[0].cubes[0].faces.top") });
    expect(bad((d) => (d.scale = 0))).toMatchObject({ error: '"scale" must be a positive number' });
  });
});

describe("editing", () => {
  it("adds parts and cubes, finds them by path, and never edits the original", () => {
    const base = newModel();
    const { doc, path } = addPart(base, [], "body");
    expect(doc.parts.map((p) => p.name)).toEqual(["body", "body2"]);
    expect(path).toEqual({ parts: [1] });
    expect(base.parts).toHaveLength(1);
    const withCube = addCube(doc, [1]);
    expect(withCube.path).toEqual({ parts: [1], cube: 0 });
    expect(cubeAt(withCube.doc, withCube.path)).toMatchObject({ size: [8, 8, 8] });
    expect(countCubes(withCube.doc)).toBe(2);
    expect(partAt(withCube.doc, [9])).toBeUndefined();
    expect(addCube(doc, [9]).doc).toBe(doc);
    expect(walk(sample()).map((w) => [w.part.name, w.depth])).toEqual([["body", 0], ["wheel", 1]]);
  });

  it("changes cubes (no negative sizes), face colours and part transforms", () => {
    let d = sample();
    const p = { parts: [0, 0], cube: 0 };
    d = updateCube(d, p, { size: [5, -3, 5], from: [0, 0, 0] });
    expect(cubeAt(d, p)).toMatchObject({ size: [5, 0, 5], from: [0, 0, 0] });
    d = setFaceColor(d, p, "east", "#00ff00");
    expect(cubeAt(d, p)!.faces).toEqual({ east: "#00ff00" });
    expect(setFaceColor(d, p, "east", "green")).toBe(d);
    d = setFaceColor(d, p, "all", "#112233");
    expect(cubeAt(d, p)).toMatchObject({ color: "#112233" });
    expect(cubeAt(d, p)!.faces).toBeUndefined();
    d = updatePart(d, [0, 0], { name: "  tyre " });
    expect(partAt(d, [0, 0])!.name).toBe("tyre");
    expect(updateCube(d, { parts: [0] }, { color: "#ffffff" })).toBe(d);
  });

  it("removes and duplicates nodes and says where selection goes next", () => {
    const d = sample();
    const removed = removeNode(d, { parts: [0, 0] });
    expect(walk(removed)).toHaveLength(1);
    expect(afterRemoval(removed, { parts: [0, 0] })).toEqual({ parts: [0] });
    expect(removeNode(d, { parts: [] })).toBe(d);
    expect(removeNode(removeNode(d, { parts: [0], cube: 0 }), { parts: [0], cube: 0 })).toEqual(removeNode(d, { parts: [0], cube: 0 }));
    expect(afterRemoval(removeNode(d, { parts: [0], cube: 0 }), { parts: [0], cube: 0 })).toEqual({ parts: [0] });
    const dupCube = duplicateNode(d, { parts: [0], cube: 0 })!;
    expect(countCubes(dupCube.doc)).toBe(3);
    expect(cubeAt(dupCube.doc, dupCube.path)!.from).toEqual([-6, 0, -6]);
    const dupPart = duplicateNode(d, { parts: [0, 0] })!;
    expect(partAt(dupPart.doc, dupPart.path.parts)!.name).toBe("wheel2");
    expect(duplicateNode(d, { parts: [] })).toBeNull();
    expect(afterRemoval(removeNode(newModel(), { parts: [0] }), { parts: [0] })).toBeNull();
  });

  it("undoes and redoes", () => {
    const h = new History();
    const a = newModel();
    const b = addPart(a, []).doc;
    h.record(a);
    expect(h.undo(b)).toBe(a);
    expect(h.redo(a)).toBe(b);
    expect(new History().undo(a)).toBeNull();
  });
});

const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const sub = (a: number[], b: number[]) => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const cross = (a: number[], b: number[]) => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];

describe("glTF export", () => {
  function parse(bytes: Uint8Array) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(v.getUint32(0, true)).toBe(0x46546c67);
    expect(v.getUint32(4, true)).toBe(2);
    expect(v.getUint32(8, true)).toBe(bytes.length);
    const jsonLen = v.getUint32(12, true);
    expect(jsonLen % 4).toBe(0);
    const json = JSON.parse(new TextDecoder().decode(bytes.slice(20, 20 + jsonLen)));
    const binAt = 20 + jsonLen;
    const binLen = v.getUint32(binAt, true);
    expect(v.getUint32(binAt + 4, true)).toBe(0x004e4942);
    expect(binLen % 4).toBe(0);
    expect(binAt + 8 + binLen).toBe(bytes.length);
    expect(json.buffers[0].byteLength).toBe(binLen);
    return { json, bin: bytes.slice(binAt + 8), view: v, binAt: binAt + 8 };
  }

  it("makes a valid container with one node per part and the hierarchy kept", () => {
    const { json } = parse(exportGlb(sample()));
    expect(json.asset.version).toBe("2.0");
    expect(json.nodes.map((n: any) => n.name)).toEqual(["body", "wheel"]);
    expect(json.nodes[0].children).toEqual([1]);
    expect(json.scenes[0].nodes).toEqual([0]);
    expect(json.nodes[1].translation).toEqual([6 / 16, 2 / 16, 8 / 16]);
    expect(json.nodes[1].rotation).toHaveLength(4);
    expect(json.nodes[0].translation).toBeUndefined();
    expect(json.meshes).toHaveLength(2);
    for (const view of json.bufferViews) expect(view.byteOffset % 4).toBe(0);
  });

  it("writes 24 vertices and 12 triangles per cube with position bounds", () => {
    const { json } = parse(exportGlb(newModel()));
    const prim = json.meshes[0].primitives[0];
    const pos = json.accessors[prim.attributes.POSITION];
    expect(pos.count).toBe(24);
    expect(pos.min).toEqual([-0.5, 0, -0.5]);
    expect(pos.max).toEqual([0.5, 1, 0.5]);
    expect(json.accessors[prim.indices].count).toBe(36);
    expect(json.accessors[prim.attributes.COLOR_0]).toMatchObject({ componentType: 5121, normalized: true, type: "VEC4" });
  });

  it("winds every face counter-clockwise seen from outside and keeps normals unit length", () => {
    for (const f of FACES) {
      const { normal, corners } = FACE_CORNERS[f];
      const p = corners.map((c) => c.map((x) => (x ? 1 : 0)));
      const n = cross(sub(p[1]!, p[0]!), sub(p[2]!, p[0]!));
      expect(dot(n, normal), f).toBeGreaterThan(0);
      expect(dot(normal, normal)).toBe(1);
      // all four corners lie on the face's plane
      const d = dot(normal, p[0]!);
      for (const q of p) expect(dot(normal, q), f).toBe(d);
    }
  });

  it("bakes face colours into the vertex colours", () => {
    let d = newModel();
    d = setFaceColor(d, { parts: [0], cube: 0 }, "up", "#ff0000");
    d = setFaceColor(d, { parts: [0], cube: 0 }, "all", "#0000ff80");
    d = setFaceColor(d, { parts: [0], cube: 0 }, "up", "#ff0000");
    const { json, bin } = parse(exportGlb(d));
    const prim = json.meshes[0].primitives[0];
    const view = json.bufferViews[json.accessors[prim.attributes.COLOR_0].bufferView];
    const colours = bin.slice(view.byteOffset, view.byteOffset + view.byteLength);
    const upFace = FACES.indexOf("up") * 4;
    expect(Array.from(colours.slice(upFace * 4, upFace * 4 + 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(colours.slice(0, 4))).toEqual([0, 0, 255, 128]);
  });

  it("refuses an empty model and skips cubes without volume", () => {
    expect(() => exportGlb({ version: 1, scale: 1, parts: [] })).toThrow("no shapes");
    const flat = updateCube(newModel(), { parts: [0], cube: 0 }, { size: [4, 0, 4] });
    expect(() => exportGlb(flat)).toThrow("no shapes");
    const mixed = addCube(flat, [0], { size: [2, 2, 2] }).doc;
    expect(parse(exportGlb(mixed)).json.accessors[0].count).toBe(24);
  });

  it("uses 32-bit indices when a part has too many vertices", () => {
    let d = newModel();
    for (let i = 0; i < 2800; i++) d = addCube(d, [0], { size: [1, 1, 1] }).doc;
    const { json } = parse(exportGlb(d));
    const prim = json.meshes[0].primitives[0];
    expect(json.accessors[prim.indices].componentType).toBe(5125);
  });

  it("matches three.js's XYZ rotation order", () => {
    expect(eulerToQuaternion([0, 0, 0])).toEqual([0, 0, 0, 1]);
    const [x, y, z, w] = eulerToQuaternion([0, 0, 90]);
    expect([x, y, +z.toFixed(4), +w.toFixed(4)]).toEqual([0, 0, 0.7071, 0.7071]);
    expect(eulerToQuaternion([90, 0, 0])[0]).toBeCloseTo(Math.SQRT1_2);
  });
});

import { existsSync, readFileSync, writeFileSync } from "node:fs";

describe("the runtime's view of exported models", () => {
  // crates/nova-runtime/tests/fixtures/studio_model.glb is what this exporter writes for `sample()`; the
  // Rust test `studio_models_load_with_the_expected_shape` imports it with the real loader.
  const fixture = new URL("../../../crates/nova-runtime/tests/fixtures/studio_model.glb", import.meta.url);
  it("matches the committed fixture byte for byte (UPDATE_FIXTURES=1 rewrites it)", () => {
    const bytes = exportGlb(sample());
    if (process.env.UPDATE_FIXTURES || !existsSync(fixture)) writeFileSync(fixture, bytes);
    expect(Array.from(readFileSync(fixture))).toEqual(Array.from(bytes));
  });
});

describe("shapes that light themselves", () => {
  const glowing = (): ModelDoc => {
    let d = newModel();
    d = addCube(d, [0], { from: [0, 0, 0], size: [4, 4, 4], color: "#444444" }).doc;
    d = addCube(d, [0], { from: [6, 0, 0], size: [2, 2, 2], color: "#ffe9a8", emissive: 0.8 }).doc;
    return d;
  };
  const gltfOf = (glb: Uint8Array) => {
    const len = new DataView(glb.buffer, glb.byteOffset).getUint32(12, true);
    return JSON.parse(new TextDecoder().decode(glb.slice(20, 20 + len)));
  };
  it("is written to the file only when it glows, and read back", () => {
    const text = serializeModel(glowing());
    expect(text.match(/"emissive"/g)).toHaveLength(1);
    const back = parseModel(text);
    expect(back.ok && back.doc.parts[0]!.cubes.map((c) => c.emissive)).toContain(0.8);
    expect(parseModel(text.replace('"emissive": 0.8', '"emissive": 3')).ok).toBe(false);
  });
  it("exports a material with an emissive factor, used only by the glowing shape", () => {
    const json = gltfOf(exportGlb(glowing()));
    expect(json.materials).toHaveLength(2);
    expect(json.materials[1].emissiveFactor).toEqual([0.8, 0.8, 0.8]);
    expect(json.materials[0].emissiveFactor).toBeUndefined();
    const prims = json.meshes[0].primitives;
    expect(prims.map((p: { material: number }) => p.material).sort()).toEqual([0, 1]);
  });
});

describe("the glow fixture for the runtime", () => {
  // a dark box (0 to 4) and a box that glows 80% (6 to 8), in one part: the runtime test reads this file back
  it("matches the committed fixture byte for byte (UPDATE_FIXTURES=1 rewrites it)", async () => {
    const { existsSync, readFileSync, writeFileSync } = await import("node:fs");
    let d = newModel();
    d.parts[0]!.cubes = []; // (a new model starts with one grey cube)
    d = addCube(d, [0], { from: [0, 0, 0], size: [4, 4, 4], color: "#444444" }).doc;
    d = addCube(d, [0], { from: [6, 0, 0], size: [2, 2, 2], color: "#ffe9a8", emissive: 0.8 }).doc;
    const bytes = exportGlb(d);
    const fixture = new URL("../../../crates/nova-runtime/tests/fixtures/studio_model_glow.glb", import.meta.url);
    if (process.env.UPDATE_FIXTURES || !existsSync(fixture)) writeFileSync(fixture, bytes);
    expect(Array.from(readFileSync(fixture))).toEqual(Array.from(bytes));
  });
});

describe("collision circles", () => {
  const withCircles = () => {
    let d = newModel();
    d = addCollider(d, { x: 0, z: 0, r: 8 });
    d = addCollider(d, { x: 4, z: -2, r: 3 });
    return d;
  };
  it("are written only when there are some, and read back", () => {
    expect(serializeModel(newModel())).not.toContain("colliders");
    const text = serializeModel(withCircles());
    expect(text).toContain('"colliders": [{ "x": 0, "z": 0, "r": 8 }, { "x": 4, "z": -2, "r": 3 }]');
    const back = parseModel(text);
    expect(back.ok && back.doc.colliders).toEqual([{ x: 0, z: 0, r: 8 }, { x: 4, z: -2, r: 3 }]);
  });
  it("are checked when a file is read", () => {
    const text = serializeModel(withCircles());
    for (const [bad, expected] of [
      ['{ "x": 0, "z": 0, "r": 0 }', "radius"],
      ['{ "x": "a", "z": 0, "r": 1 }', "x and z"],
      ["7", "x and z"],
    ] as const) {
      const r = parseModel(text.replace('{ "x": 0, "z": 0, "r": 8 }', bad));
      expect(r.ok, bad).toBe(false);
      expect(!r.ok && r.error).toContain(expected);
    }
  });
  it("can be added, changed and removed (and never made empty-radius)", () => {
    let d = withCircles();
    d = updateCollider(d, 1, { r: 5 });
    expect(d.colliders![1]).toEqual({ x: 4, z: -2, r: 5 });
    expect(updateCollider(d, 1, { r: 0 })).toBe(d);
    expect(updateCollider(d, 9, { r: 1 })).toBe(d);
    d = removeCollider(d, 0);
    expect(d.colliders).toEqual([{ x: 4, z: -2, r: 5 }]);
    expect(removeCollider(d, 0).colliders).toBeUndefined();
  });
  it("go into the glTF scene's extras in metres, and a fixture is kept for the runtime", async () => {
    const d = withCircles();
    const len = (g: Uint8Array) => new DataView(g.buffer, g.byteOffset).getUint32(12, true);
    const glb = exportGlb(d);
    const json = JSON.parse(new TextDecoder().decode(glb.slice(20, 20 + len(glb))));
    expect(json.scenes[0].extras.nova.colliders).toEqual([[0, 0, 0.5], [0.25, -0.125, 0.1875]]);
    const { existsSync, readFileSync, writeFileSync } = await import("node:fs");
    const fixture = new URL("../../../crates/nova-runtime/tests/fixtures/studio_model_colliders.glb", import.meta.url);
    if (process.env.UPDATE_FIXTURES || !existsSync(fixture)) writeFileSync(fixture, glb);
    expect(Array.from(readFileSync(fixture))).toEqual(Array.from(glb));
  });
});

describe("collision capsules and boxes", () => {
  const withShapes = () => {
    let d = addCollider(newModel(), { x: 0, z: 0, r: 8 });
    d = addCapsule(d, { ax: 0, az: -8, bx: 0, bz: 8, r: 4 });
    d = addBox(d, { x: 16, z: 0, hw: 2, hl: 8, turn: 90 });
    return d;
  };
  it("are written under their own keys, only when there are some, and read back", () => {
    const text = serializeModel(withShapes());
    expect(text).toContain('"capsules": [{ "ax": 0, "az": -8, "bx": 0, "bz": 8, "r": 4 }]');
    expect(text).toContain('"boxes": [{ "x": 16, "z": 0, "hw": 2, "hl": 8, "turn": 90 }]');
    expect(serializeModel(addCollider(newModel(), { x: 0, z: 0, r: 1 }))).not.toMatch(/capsules|boxes/);
    const back = parseModel(text);
    expect(back.ok && back.doc.capsules).toEqual(withShapes().capsules);
    expect(back.ok && back.doc.boxes).toEqual(withShapes().boxes);
  });
  it("are checked when a file is read", () => {
    const text = serializeModel(withShapes());
    const bad1 = parseModel(text.replace('"r": 4 }', '"r": 0 }'));
    expect(!bad1.ok && bad1.error).toContain("capsules[0]");
    const bad2 = parseModel(text.replace('"hw": 2', '"hw": "x"'));
    expect(!bad2.ok && bad2.error).toContain("boxes[0]");
    const bad3 = parseModel(text.replace('"hl": 8', '"hl": -1'));
    expect(!bad3.ok && bad3.error).toContain("above 0");
  });
  it("can be added, changed and removed", () => {
    let d = withShapes();
    d = updateCapsule(d, 0, { r: 5 });
    expect(d.capsules![0].r).toBe(5);
    expect(updateCapsule(d, 0, { r: 0 })).toBe(d);
    d = updateBox(d, 0, { turn: 45 });
    expect(d.boxes![0].turn).toBe(45);
    expect(updateBox(d, 0, { hw: 0 })).toBe(d);
    expect(updateBox(d, 3, { hw: 1 })).toBe(d);
    d = removeCapsule(removeBox(d, 0), 0);
    expect(d.capsules).toBeUndefined();
    expect(d.boxes).toBeUndefined();
    expect(d.colliders).toHaveLength(1);
  });
  it("go into the glTF extras (circles keep their shape) and a fixture is kept for the runtime", async () => {
    const d = withShapes();
    const len = (g: Uint8Array) => new DataView(g.buffer, g.byteOffset).getUint32(12, true);
    const glb = exportGlb(d);
    const json = JSON.parse(new TextDecoder().decode(glb.slice(20, 20 + len(glb))));
    expect(json.scenes[0].extras.nova.colliders).toEqual([[0, 0, 0.5]]);
    expect(json.scenes[0].extras.nova.capsules).toEqual([[0, -0.5, 0, 0.5, 0.25]]);
    expect(json.scenes[0].extras.nova.boxes).toEqual([[1, 0, 0.125, 0.5, 1.5708]]);
    const { existsSync, readFileSync, writeFileSync } = await import("node:fs");
    const fixture = new URL("../../../crates/nova-runtime/tests/fixtures/studio_model_collider_shapes.glb", import.meta.url);
    if (process.env.UPDATE_FIXTURES || !existsSync(fixture)) writeFileSync(fixture, glb);
    expect(Array.from(readFileSync(fixture))).toEqual(Array.from(glb));
  });
});
