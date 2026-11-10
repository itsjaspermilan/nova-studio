import { describe, expect, it } from "vitest";
import { addLayer, duplicateLayer, flatten, layerPath, mergeDown, moveLayer, removeLayer, singleLayer, updateLayer, MAX_TEX_LAYERS } from "./texture-layers";
import { newRaster, setPixel } from "./pixels";

const red = () => { const r = newRaster(2, 1); setPixel(r, 0, 0, [255, 0, 0, 255]); return r; };

describe("texture layers", () => {
  it("a single layer flattens to itself", () => {
    const f = flatten(singleLayer(red()));
    expect([...f.data.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect(f.data[7]).toBe(0);
  });
  it("a layer above covers the one below where it is painted, and shows it elsewhere", () => {
    let s = addLayer(singleLayer(red()), 2, 1);
    setPixel(s.rasters[1]!, 0, 0, [0, 0, 255, 255]);
    expect([...flatten(s).data.slice(0, 4)]).toEqual([0, 0, 255, 255]);
    s = updateLayer(s, 1, { visible: false });
    expect([...flatten(s).data.slice(0, 4)]).toEqual([255, 0, 0, 255]);
  });
  it("opacity mixes and multiply darkens", () => {
    let s = addLayer(singleLayer(red()), 2, 1);
    setPixel(s.rasters[1]!, 0, 0, [0, 0, 255, 255]);
    const half = flatten(updateLayer(s, 1, { opacity: 0.5 })).data;
    expect(half[0]).toBeGreaterThan(100); expect(half[2]).toBeGreaterThan(100);
    const mul = flatten(updateLayer(s, 1, { blend: "multiply" })).data;
    expect([mul[0], mul[1], mul[2]]).toEqual([0, 0, 0]);
  });
  it("adds with unique names up to the most, and removes all but the last", () => {
    let s = singleLayer(newRaster(1, 1));
    s = addLayer(s, 1, 1); s = addLayer(s, 1, 1);
    expect(s.info.map((l) => l.name)).toEqual(["Layer", "Layer 2", "Layer 3"]);
    for (let i = 0; i < 20; i++) s = addLayer(s, 1, 1);
    expect(s.rasters.length).toBe(MAX_TEX_LAYERS);
    s = removeLayer(singleLayer(newRaster(1, 1)), 0);
    expect(s.rasters.length).toBe(1);
  });
  it("moves, duplicates and merges down", () => {
    let s = addLayer(singleLayer(red()), 2, 1);
    setPixel(s.rasters[1]!, 1, 0, [0, 255, 0, 255]);
    const m = moveLayer(s, 1, -1);
    expect(m.rasters[0]).toBe(s.rasters[1]);
    expect(duplicateLayer(s, 1).info[2]!.name).toBe("Layer 2 copy");
    const merged = mergeDown(s, 1);
    expect(merged.rasters.length).toBe(1);
    expect([...merged.rasters[0]!.data]).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
  });
  it("keeps names unique and the settings in range", () => {
    const s = addLayer(singleLayer(newRaster(1, 1)), 1, 1);
    expect(updateLayer(s, 1, { name: "Layer" }).info[1]!.name).toBe("Layer 2");
    expect(updateLayer(s, 1, { opacity: 7 }).info[1]!.opacity).toBeUndefined();
    expect(updateLayer(s, 1, { opacity: -1 }).info[1]!.opacity).toBe(0);
  });
  it("names the layer files beside the texture", () => {
    expect(layerPath("models/car.texture.png", 2)).toBe("models/car.texture.layer2.png");
  });
});

import { parseModel, serializeModel } from "./model-doc";
describe("texture layers in the model file", () => {
  it("round-trips, and rejects a bad opacity", () => {
    const text = `{"version":1,"texture":{"size":[16,16],"layers":[{"name":"Base"},{"name":"Dirt","opacity":0.5,"blend":"multiply"},{"name":"Hidden","visible":false}]},"parts":[{"name":"a","origin":[0,0,0],"rotation":[0,0,0],"cubes":[],"children":[]}]}`;
    const r = parseModel(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.texture!.layers).toEqual([{ name: "Base" }, { name: "Dirt", opacity: 0.5, blend: "multiply" }, { name: "Hidden", visible: false }]);
    const again = parseModel(serializeModel(r.doc));
    expect(again.ok && again.doc.texture!.layers).toEqual(r.doc.texture!.layers);
    expect(parseModel(text.replace('"opacity":0.5', '"opacity":3')).ok).toBe(false);
  });
});
