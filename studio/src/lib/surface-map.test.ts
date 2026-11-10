import { describe, expect, it } from "vitest";
import { exportGlb } from "./glb";
import { addCube, newModel, type ModelDoc } from "./model-doc";
import { bakeSurface, channelToGrey, enableTexture, greyToChannel } from "./model-uv";
import { newRaster, type Raster } from "./pixels";
import { parseModel, serializeModel } from "./model-doc";

const jsonOf = (glb: Uint8Array) => {
  const len = new DataView(glb.buffer, glb.byteOffset).getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + len)));
};
function painted(metal?: number, rough?: number): { doc: ModelDoc; picture: Raster } {
  let doc = newModel();
  doc = { ...doc, parts: doc.parts.map((p, i) => (i === 0 ? { ...p, cubes: [] } : p)) };
  const a = addCube(doc, [0], { from: [0, 0, 0], size: [8, 8, 8], color: "#c8c8c8", ...(metal !== undefined ? { metallic: metal } : {}), ...(rough !== undefined ? { roughness: rough } : {}) });
  const r = enableTexture(a.doc, newRaster(8, 8), a.path.parts, a.path.cube ?? 0, 4)!;
  return { doc: r.doc, picture: r.picture };
}

describe("the surface (roughness and metal) picture", () => {
  it("is baked from each shape's own numbers, and a channel round-trips through a grey picture", () => {
    const { doc } = painted(0.5, 0.25);
    const s = bakeSurface({ ...doc, texture: { ...doc.texture!, surface: true } });
    const i = [...Array(s.w * s.h).keys()].find((k) => s.data[k * 4 + 2] !== 0)!;
    expect(s.data[i * 4 + 1]).toBe(64);
    expect(s.data[i * 4 + 2]).toBe(128);
    const grey = channelToGrey(s, "metal");
    expect(grey.data[i * 4]).toBe(128);
    grey.data[i * 4] = 200;
    const back = greyToChannel(s, grey, "metal");
    expect(back.data[i * 4 + 2]).toBe(200);
    expect(back.data[i * 4 + 1]).toBe(64);
  });
  it("is written as the glTF metallic-roughness picture only when the model asks for it", () => {
    const { doc, picture } = painted(0.5, 0.25);
    const plain = jsonOf(exportGlb(doc, picture));
    expect(plain.images.length).toBe(1);
    expect(JSON.stringify(plain.materials)).not.toContain("metallicRoughnessTexture");
    const withSurface = jsonOf(exportGlb({ ...doc, texture: { ...doc.texture!, surface: true } }, picture));
    expect(withSurface.images.length).toBe(2);
    expect(withSurface.textures.length).toBe(2);
    expect(JSON.stringify(withSurface.materials)).toContain('"metallicRoughnessTexture":{"index":1}');
    // a painted shape's own numbers give way to the picture (factors 1)
    expect(withSurface.materials.some((m: { pbrMetallicRoughness: { metallicFactor: number; roughnessFactor: number } }) => m.pbrMetallicRoughness.metallicFactor === 1 && m.pbrMetallicRoughness.roughnessFactor === 1)).toBe(true);
  });
  it("round-trips through the model file", () => {
    const { doc } = painted();
    const again = parseModel(serializeModel({ ...doc, texture: { ...doc.texture!, surface: true } }));
    expect(again.ok && again.doc.texture!.surface).toBe(true);
  });
});
