import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exportGlb, textureForExport } from "./glb";
import { addCube, newModel, type Cube, type ModelDoc } from "./model-doc";
import { boxRects, bakeColors } from "./model-uv";
import { getPixel, newRaster, type Raster } from "./pixels";

// A painted box next to a plain coloured one, at 1/16 scale. crates/nova-runtime/tests/fixtures/studio_model_textured.glb is
// what the exporter writes for it, and the Rust test `studio_textures_reach_the_vertices` loads it with the real importer.
const painted: Cube = { from: [0, 0, 0], size: [4, 4, 4], color: "#ffffff", texture: { at: [0, 0] } };
const plain: Cube = { from: [8, 0, 0], size: [4, 4, 4], color: "#336699" };
const doc = (): ModelDoc => {
  let d: ModelDoc = { ...newModel(), texture: { size: [32, 32] } };
  d.parts[0]!.cubes = [];
  d = addCube(d, [0], painted).doc;
  d = addCube(d, [0], plain).doc;
  return d;
};
/// The painter's picture: the colours baked in, then the top face pure green and the north face pure red.
const picture = (): Raster => {
  const r = newRaster(32, 32);
  bakeColors(r, painted);
  const rects = boxRects(4, 4, 4);
  const paint = (face: string, c: [number, number, number, number]) => {
    const [x, y, w, h] = rects[face]!;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) r.data.set(c, ((y + j) * r.w + x + i) * 4);
  };
  paint("up", [0, 255, 0, 255]);
  paint("north", [255, 0, 0, 255]);
  return r;
};

function parse(bytes: Uint8Array) {
  const v = new DataView(bytes.buffer, bytes.byteOffset);
  const jsonLen = v.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.slice(20, 20 + jsonLen)));
  const bin = bytes.slice(20 + jsonLen + 8);
  return { json, bin };
}

describe("exporting a textured model", () => {
  it("embeds the picture with a white row, and gives every vertex a texture coordinate", () => {
    const { json, bin } = parse(exportGlb(doc(), picture()));
    expect(json.samplers).toEqual([{ magFilter: 9728, minFilter: 9728, wrapS: 33071, wrapT: 33071 }]);
    expect(json.textures).toEqual([{ sampler: 0, source: 0 }]);
    expect(json.materials[0].pbrMetallicRoughness.baseColorTexture).toEqual({ index: 0 });
    const view = json.bufferViews[json.images[0].bufferView];
    const png = bin.slice(view.byteOffset, view.byteOffset + view.byteLength);
    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(new DataView(png.buffer, png.byteOffset).getUint32(16)).toBe(32); // width
    expect(new DataView(png.buffer, png.byteOffset).getUint32(20)).toBe(33); // height: the picture and the white row
    const prim = json.meshes[0].primitives[0];
    expect(json.accessors[prim.attributes.TEXCOORD_0]).toMatchObject({ type: "VEC2", componentType: 5126, count: 48 });
  });

  it("points the painted box at its texels and the plain box at the white one", () => {
    const { json, bin } = parse(exportGlb(doc(), picture()));
    const prim = json.meshes[0].primitives[0];
    const acc = json.accessors[prim.attributes.TEXCOORD_0];
    const view = json.bufferViews[acc.bufferView];
    const uv = new Float32Array(bin.slice(view.byteOffset, view.byteOffset + acc.count * 8).buffer);
    const all = Array.from(uv);
    for (let i = 24; i < 48; i++) {
      expect(all[i * 2]).toBeCloseTo(0.5 / 32, 6);
      expect(all[i * 2 + 1]).toBeCloseTo(32.5 / 33, 6);
    }
    for (let i = 0; i < 48 * 2; i++) {
      expect(all[i]).toBeGreaterThanOrEqual(0);
      expect(all[i]).toBeLessThanOrEqual(1);
    }
    // the painted box's top face (vertices 8..11, after east and west) lies inside the "up" rectangle of its block
    const up = boxRects(4, 4, 4).up!;
    for (let i = 8; i < 12; i++) {
      const [x, y] = [all[i * 2]! * 32, all[i * 2 + 1]! * 33];
      expect(x).toBeGreaterThanOrEqual(up[0] - 1e-4);
      expect(x).toBeLessThanOrEqual(up[0] + up[2] + 1e-4);
      expect(y).toBeGreaterThanOrEqual(up[1] - 1e-4);
      expect(y).toBeLessThanOrEqual(up[1] + up[3] + 1e-4);
    }
  });

  it("leaves a model without painted shapes exactly as before", () => {
    const plainOnly: ModelDoc = { ...newModel(), texture: { size: [32, 32] } };
    const { json } = parse(exportGlb(plainOnly));
    expect(json.images).toBeUndefined();
    expect(json.meshes[0].primitives[0].attributes.TEXCOORD_0).toBeUndefined();
    expect(parse(exportGlb({ ...plainOnly, texture: undefined })).json.materials[0].name).toBe("vertex colours");
  });

  it("bakes the colours into a fresh picture when none is given", () => {
    const t = textureForExport(doc());
    expect([t.w, t.h]).toEqual([32, 33]);
    const up = boxRects(4, 4, 4).up!;
    expect(getPixel(t, up[0] + 1, up[1] + 1)).toEqual([255, 255, 255, 255]);
    expect(getPixel(t, 5, 32)).toEqual([255, 255, 255, 255]); // the white row
  });

  it("matches the committed fixture byte for byte (UPDATE_FIXTURES=1 rewrites it)", () => {
    const fixture = new URL("../../../crates/nova-runtime/tests/fixtures/studio_model_textured.glb", import.meta.url);
    const bytes = exportGlb(doc(), picture());
    if (process.env.UPDATE_FIXTURES || !existsSync(fixture)) writeFileSync(fixture, bytes);
    expect(Array.from(readFileSync(fixture))).toEqual(Array.from(bytes));
  });
});
