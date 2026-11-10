import { describe, expect, it } from "vitest";
import { bakeNormals } from "./model-bake";
import { addCube, newModel, parseModel, serializeModel, type Cube, type ModelDoc } from "./model-doc";
import { enableTexture } from "./model-uv";
import { exportGlb } from "./glb";
import { newRaster } from "./pixels";

const tilted = (): Cube => {
  const t = Math.tan((30 * Math.PI) / 180);
  return { shape: "mesh", color: "#ffffff", from: [0, 5, 0], size: [10, 6, 10], verts: [[0, 10 - 5 * t, 0], [10, 10 - 5 * t, 0], [10, 10 + 5 * t, 10], [0, 10 + 5 * t, 10]], polys: [{ v: [0, 3, 2, 1] }] } as Cube;
};
function scene(): ModelDoc {
  let doc = newModel();
  doc = { ...doc, parts: [{ ...doc.parts[0]!, cubes: [] }] };
  const a = addCube(doc, [0], { from: [0, 0, 0], size: [10, 10, 10], color: "#c8c8c8" });
  const r = enableTexture(a.doc, newRaster(8, 8), a.path.parts, a.path.cube ?? 0, 4)!;
  doc = r.doc;
  // a high-poly source part holding the tilted plane
  return { ...doc, parts: [...doc.parts, { name: "high", origin: [0, 0, 0], rotation: [0, 0, 0], cubes: [tilted()], children: [], bakeSource: true }] };
}

describe("baking normals from a high-poly part", () => {
  it("gives the low shape the high surface's tilt in its own frame, and is flat where nothing was met", () => {
    const doc = scene();
    const n = bakeNormals(doc, 4)!;
    expect(n.w).toBe(doc.texture!.size[0]);
    let tilt = 0, flat = 0;
    for (let i = 0; i < n.data.length; i += 4) {
      const [r, g, b] = [n.data[i]! / 255 * 2 - 1, n.data[i + 1]! / 255 * 2 - 1, n.data[i + 2]! / 255 * 2 - 1];
      if (Math.abs(b - Math.cos((30 * Math.PI) / 180)) < 0.02 && Math.abs(Math.hypot(r, g) - 0.5) < 0.03) tilt++;
      else if (n.data[i] === 128 && n.data[i + 1] === 128 && n.data[i + 2] === 255) flat++;
    }
    expect(tilt).toBeGreaterThan(5); // the top face's texels lean 30 degrees
    expect(flat).toBeGreaterThan(0);
  });
  it("needs a high-poly part and a texture", () => {
    const doc = scene();
    expect(bakeNormals({ ...doc, parts: doc.parts.map((p) => ({ ...p, bakeSource: undefined })) })).toBeNull();
    expect(bakeNormals({ ...doc, texture: undefined })).toBeNull();
  });
  it("the high part is left out of the file's game side, and the flags round-trip", () => {
    const doc = { ...scene(), texture: { ...scene().texture!, normals: true } };
    const again = parseModel(serializeModel(doc));
    if (!again.ok) throw new Error(again.error);
    expect(again.doc.parts[1]!.bakeSource).toBe(true);
    expect(again.doc.texture!.normals).toBe(true);
    const glb = exportGlb(doc);
    const len = new DataView(glb.buffer, glb.byteOffset).getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + len)));
    expect(json.nodes.map((n: { name: string }) => n.name)).not.toContain("high");
  });
});

describe("a baked normal map in the glb", () => {
  it("is the game's normal map (texture 1 when there is no surface picture), flat in the white row", () => {
    const doc = { ...scene(), texture: { ...scene().texture!, normals: true } };
    const map = bakeNormals(doc, 4)!;
    const glb = exportGlb(doc, undefined, undefined, map);
    const len = new DataView(glb.buffer, glb.byteOffset).getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + len)));
    expect(json.images.length).toBe(2);
    expect(json.textures.length).toBe(2);
    expect(JSON.stringify(json.materials)).toContain('"normalTexture":{"index":1}');
    // without the picture the file has no normal map
    expect(JSON.stringify(jsonOf(exportGlb(doc)).materials)).not.toContain("normalTexture");
  });
});
function jsonOf(glb: Uint8Array) {
  const len = new DataView(glb.buffer, glb.byteOffset).getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + len)));
}
