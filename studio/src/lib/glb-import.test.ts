import { waving } from "./model-skin.test";
import { samplePose } from "./model-anim";
import { skinnedPoints, worldMatrices } from "./model-skin";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exportGlb, eulerToQuaternion } from "./glb";
import { importGlb, quaternionToEuler } from "./glb-import";
import { setEase, setKey } from "./model-anim";
import { addCube, addPart, newModel, parseModel, serializeModel, walk, type ModelDoc, type Vec3 } from "./model-doc";
import { meshOf, signedVolume } from "./model-mesh";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../crates/nova-runtime/tests/fixtures/${name}`, import.meta.url)));
const ok = (bytes: Uint8Array) => {
  const r = importGlb(bytes);
  if (!r.ok) throw new Error(r.error);
  return r;
};
const bounds = (d: ModelDoc) => {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const { part } of walk(d)) for (const c of part.cubes) {
    const m = meshOf(c);
    for (let i = 0; i < m.positions.length; i += 3) for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a]!, m.positions[i + a]!);
      hi[a] = Math.max(hi[a]!, m.positions[i + a]!);
    }
  }
  return [lo, hi];
};

describe("quaternions to turns", () => {
  it("read back what eulerToQuaternion wrote", () => {
    for (const deg of [[0, 0, 0], [30, 0, 0], [0, 45, 0], [0, 0, 90], [20, -35, 60], [-120, 40, 15]] as Vec3[]) {
      const back = quaternionToEuler(eulerToQuaternion(deg));
      back.forEach((v, i) => expect(v, `${deg} axis ${i}`).toBeCloseTo(deg[i]!, 2));
    }
    expect(quaternionToEuler([0, 0, 0, 1])).toEqual([0, 0, 0]);
  });
});

describe("importing a model the studio made", () => {
  it("brings back its parts, colours, shape and size", () => {
    const original = ok(fixture("studio_model.glb"));
    expect(original.doc.parts.map((p) => p.name)).toEqual(["body"]);
    const wheel = original.doc.parts[0]!.children[0]!;
    expect(wheel.name).toBe("wheel");
    expect(wheel.origin).toEqual([6, 2, 8]);
    wheel.rotation.forEach((v, i) => expect(v).toBeCloseTo([0, 0, 90][i]!, 2));
    expect(original.doc.parts[0]!.cubes[0]!.color).toBe("#c9d1d9");
    expect(wheel.cubes[0]!.color).toBe("#202020");
    // a 16-unit cube comes back 16 units wide, standing on y = 0
    expect(original.doc.parts[0]!.cubes[0]!.size).toEqual([16, 16, 16]);
    expect(original.doc.parts[0]!.cubes[0]!.from).toEqual([-8, 0, -8]);
    expect(original.doc.scale).toBe(1 / 16);
    expect(original.notes).toEqual([]);
  });

  it("welds the points of a cube back to eight and keeps every face facing outward", () => {
    const cube = ok(fixture("studio_model.glb")).doc.parts[0]!.cubes[0]!;
    expect(cube.shape).toBe("mesh");
    expect(cube.verts).toHaveLength(8);
    expect(cube.polys).toHaveLength(12);
    expect(signedVolume(cube) / 6).toBeCloseTo(16 ** 3, 3);
  });

  it("round-trips a model through export and import: same bounds, same clips", () => {
    let d: ModelDoc = newModel();
    d = addCube(addPart(d, [0], "arm").doc, [0, 0], { from: [0, 0, 0], size: [2, 6, 2], color: "#336699", shape: "wedge" }).doc;
    d = { ...d, parts: d.parts.map((p) => ({ ...p, children: p.children.map((c) => ({ ...c, origin: [6, 10, 0] as Vec3, rotation: [10, 20, 30] as Vec3 })) })) };
    d = { ...d, clips: [{ name: "wave", duration: 1, loop: true, tracks: [] }] };
    d = setKey(d, 0, ["body", "arm"], "rotation", 0, [0, 0, 0]);
    d = setKey(d, 0, ["body", "arm"], "rotation", 1, [0, 0, 90]);
    d = setKey(d, 0, ["body", "arm"], "position", 0, [6, 10, 0]);
    d = setKey(d, 0, ["body", "arm"], "position", 1, [6, 14, 0]);
    d = setEase(d, 0, ["body", "arm"], 0, "step");
    const back = ok(exportGlb(d));
    const [lo, hi] = bounds(d);
    const [lo2, hi2] = bounds(back.doc);
    expect(lo2!.map((x) => Math.round(x * 100))).toEqual(lo!.map((x) => Math.round(x * 100)));
    expect(hi2!.map((x) => Math.round(x * 100))).toEqual(hi!.map((x) => Math.round(x * 100)));
    expect(back.doc.parts[0]!.children[0]!.name).toBe("arm");
    expect(back.doc.parts[0]!.children[0]!.origin).toEqual([6, 10, 0]);
    expect(back.doc.clips).toHaveLength(1);
    const pos = back.doc.clips![0]!.tracks.find((t) => t.prop === "position")!;
    expect(pos.part).toEqual(["body", "arm"]);
    expect(pos.keys[0]!.value).toEqual([6, 10, 0]);
    expect(pos.keys.at(-1)!.value).toEqual([6, 14, 0]);
    const rot = back.doc.clips![0]!.tracks.find((t) => t.prop === "rotation")!;
    rot.keys.at(-1)!.value.forEach((v, i) => expect(v).toBeCloseTo([0, 0, 90][i]!, 2));
    // the imported model is a valid model file
    const reparsed = parseModel(serializeModel(back.doc));
    expect(reparsed.ok ? "" : reparsed.error).toBe("");
  });

  it("reads the animated fixture's clips", () => {
    const r = ok(fixture("studio_model_anim.glb"));
    expect(r.doc.clips!.length).toBeGreaterThan(0);
    expect(r.doc.clips![0]!.tracks.every((t) => t.keys.length > 0 && t.part.length > 0)).toBe(true);
    expect(parseModel(serializeModel(r.doc)).ok).toBe(true);
  });
});

describe("importing a model made elsewhere", () => {
  /// A one-triangle glb with the given JSON pieces.
  function make(extra: Record<string, unknown> = {}, colours?: number[]) {
    const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const idx = new Uint16Array([0, 1, 2, 0]); // padded
    const col = colours ? new Uint8Array(colours) : new Uint8Array(0);
    const parts = [new Uint8Array(pos.buffer), new Uint8Array(idx.buffer, 0, 6), col];
    const offsets = [0, 36, 44];
    const bin = new Uint8Array(44 + col.length);
    bin.set(parts[0]!, 0);
    bin.set(parts[1]!, 36);
    bin.set(col, 44);
    const json = {
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: "Tri", mesh: 0, scale: [2, 2, 2] }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0, ...(colours ? { COLOR_0: 2 } : {}) }, indices: 1, material: 0 }] }],
      materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
        { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
        ...(colours ? [{ bufferView: 2, componentType: 5121, normalized: true, count: 3, type: "VEC4" }] : []),
      ],
      bufferViews: [
        { buffer: 0, byteOffset: offsets[0], byteLength: 36 },
        { buffer: 0, byteOffset: offsets[1], byteLength: 6 },
        ...(colours ? [{ buffer: 0, byteOffset: offsets[2], byteLength: colours.length }] : []),
      ],
      buffers: [{ byteLength: bin.length }],
      ...extra,
    };
    const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
    const padded = new Uint8Array((jsonBytes.length + 3) & ~3).fill(0x20);
    padded.set(jsonBytes);
    const out = new Uint8Array(12 + 8 + padded.length + 8 + bin.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, 0x46546c67, true);
    v.setUint32(4, 2, true);
    v.setUint32(8, out.length, true);
    v.setUint32(12, padded.length, true);
    v.setUint32(16, 0x4e4f534a, true);
    out.set(padded, 20);
    v.setUint32(20 + padded.length, bin.length, true);
    v.setUint32(24 + padded.length, 0x004e4942, true);
    out.set(bin, 28 + padded.length);
    return out;
  }

  it("applies a node's size to its mesh, in model units", () => {
    const r = ok(make());
    const cube = r.doc.parts[0]!.cubes[0]!;
    expect(r.doc.parts[0]!.name).toBe("Tri");
    expect(cube.size).toEqual([32, 32, 0]); // 1 glTF unit x 2 (node scale) x 16
    expect(cube.polys).toEqual([{ v: [0, 1, 2] }]);
  });

  it("takes colours from the vertices, tinted by the material", () => {
    const red = ok(make({}, [255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]));
    expect(red.doc.parts[0]!.cubes[0]!.color).toBe("#ff0000");
    const tinted = ok(make({ materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } }] }));
    expect(tinted.doc.parts[0]!.cubes[0]!.color).toBe("#ff0000");
    expect(ok(make()).doc.parts[0]!.cubes[0]!.color).toBe("#ffffff");
  });

  it("says what it left out", () => {
    const r = ok(make({ textures: [{ source: 0 }], nodes: [{ name: "Tri", mesh: 0, skin: 0 }] }));
    expect(r.notes.some((n) => n.includes("textures are not imported"))).toBe(true);
    expect(r.notes.some((n) => n.includes("skin"))).toBe(true);
  });

  it("refuses what is not a model, and files that are cut short", () => {
    expect(importGlb(new Uint8Array(30))).toMatchObject({ ok: false });
    expect(importGlb(new TextEncoder().encode("not a model at all, really")).ok).toBe(false);
    const good = make();
    expect(importGlb(good.slice(0, 40)).ok).toBe(false);
    const empty = make({ nodes: [], scenes: [{ nodes: [] }] });
    expect(importGlb(empty)).toMatchObject({ ok: false, error: "the model has nothing in it" });
  });
});

describe("skinned models", () => {
  it("come back with their weights: the same points at rest and in a pose", () => {
    const original = waving();
    const r = importGlb(exportGlb(original));
    if (!r.ok) throw new Error(r.error);
    expect(r.notes.filter((n) => /skin|bind/.test(n))).toEqual([]);
    // find the skinned shape and the part that holds it
    let path: { parts: number[]; cube: number } | null = null;
    const visit = (list: typeof r.doc.parts, prefix: number[]) =>
      list.forEach((p, i) => {
        p.cubes.forEach((c, ci) => c.skin && (path = { parts: [...prefix, i], cube: ci }));
        visit(p.children, [...prefix, i]);
      });
    visit(r.doc.parts, []);
    expect(path).not.toBeNull();
    const cube = path!.cube;
    const imported = r.doc;
    const sorted = (pts: number[][]) => pts.map((p) => p.map((x) => Math.round(x * 100) / 100)).sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!);
    const pts = (doc: typeof imported, p: typeof path, t: number) => {
      const clip = doc.clips![0]!;
      return skinnedPoints(doc, p!, worldMatrices(doc, samplePose(clip, t, false) as never))!;
    };
    const originalPath = { parts: [0, 0], cube: 0 };
    for (const t of [0, 0.5, 1]) {
      const want = sorted(pts(original, originalPath, t));
      const got = sorted(pts(imported, path, t));
      // each original point appears in the import (welding may keep a point more than once, never fewer)
      for (const w of want) expect(got.some((g) => g.every((x, k) => Math.abs(x - w[k]!) < 0.02)), `t=${t} ${w}`).toBe(true);
    }
    expect(cube).toBeGreaterThanOrEqual(0);
  });
});
