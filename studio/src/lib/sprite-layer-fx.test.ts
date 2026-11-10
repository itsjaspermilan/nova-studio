import { describe, expect, it } from "vitest";
import { addLayer, applyLayers, composeFrame, groupLayers, groupMembers, groupsAreValid, layerSheets, layersFileText, mergeDown, moveLayer, newDoc, parseLayersFile, removeLayer, ungroup, updateLayer, duplicateLayer, recompose } from "./sprite-doc";
import { cleanLayerEffects, newLayerEffect } from "./layer-fx";
import { getPixel, setPixel } from "./pixels";

const px = (doc: ReturnType<typeof newDoc>, x = 0, y = 0) => getPixel(composeFrame(doc, 0), x, y)!;
/// A 2 by 1 sprite with two layers: red below, blue above (each one pixel).
function two() {
  let d = newDoc(2, 1);
  setPixel(d.layers[0]!.cels[0]!, 0, 0, [255, 0, 0, 255]);
  d = addLayer(d, 0).doc;
  setPixel(d.layers[1]!.cels[0]!, 1, 0, [0, 0, 255, 255]);
  recompose(d, 0);
  return d;
}

describe("effects that stay on a layer", () => {
  it("change what is shown but not the drawing, and come off again", () => {
    const d = two();
    const inv = updateLayer(d, 0, { effects: [newLayerEffect("invert")] });
    expect(px(inv, 0)).toEqual([0, 255, 255, 255]);
    expect(Array.from(inv.layers[0]!.cels[0]!.data.slice(0, 4))).toEqual([255, 0, 0, 255]); // the cel is still red
    expect(inv.frames[0]!.data[0]).toBe(0); // the stacked picture follows
    const off = updateLayer(inv, 0, { effects: [{ ...inv.layers[0]!.effects![0]!, on: false }] });
    expect(px(off, 0)).toEqual([255, 0, 0, 255]);
    expect(px(updateLayer(inv, 0, { effects: [] }), 0)).toEqual([255, 0, 0, 255]);
    expect(updateLayer(inv, 0, { effects: [] }).layers[0]!.effects).toBeUndefined();
  });
  it("run in order, and only on their own layer", () => {
    const d = updateLayer(two(), 0, { effects: [newLayerEffect("invert"), newLayerEffect("grayscale")] });
    const [r, g, b] = px(d, 0);
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(px(d, 1)).toEqual([0, 0, 255, 255]); // the blue layer is untouched
  });
  it("an outline grows the picture's edge without touching the cel", () => {
    const d = updateLayer(two(), 1, { effects: [{ ...newLayerEffect("outline"), params: { color: "#00ff00", diagonals: 0 } }] });
    expect(px(d, 0)).toEqual([0, 255, 0, 255]); // the blue's outline lands on the red pixel and covers it
    const one = newDoc(3, 1);
    setPixel(one.layers[0]!.cels[0]!, 1, 0, [255, 255, 255, 255]);
    const o = updateLayer(one, 0, { effects: [{ ...newLayerEffect("outline"), params: { color: "#00ff00" } }] });
    expect(px(o, 0)).toEqual([0, 255, 0, 255]);
    expect(px(o, 2)).toEqual([0, 255, 0, 255]);
  });
  it("are checked when read from a file", () => {
    expect(cleanLayerEffects([{ type: "hue", params: { degrees: 20 } }])).toEqual([{ type: "hue", params: { degrees: 20 } }]);
    expect(cleanLayerEffects([{ type: "nope", params: {} }])).toBeNull();
    expect(cleanLayerEffects([{ type: "hue", params: { degrees: "x" } }])).toBeNull();
    expect(cleanLayerEffects([{ type: "outline", params: { color: "red" } }])).toBeNull();
  });
  it("are baked in when a layer is merged down", () => {
    const d = updateLayer(two(), 1, { effects: [newLayerEffect("invert")] });
    const m = mergeDown(d, 1).doc;
    expect(m.layers.length).toBe(1);
    expect(getPixel(m.layers[0]!.cels[0]!, 1, 0)).toEqual([255, 255, 0, 255]);
  });
});

describe("group layers", () => {
  it("stack their layers first and then act as one", () => {
    const d = two();
    const g = groupLayers(d, 0, 1);
    expect(g.index).toBe(2);
    const doc = g.doc;
    expect(doc.layers.map((l) => [l.kind ?? "layer", l.depth ?? 0])).toEqual([["layer", 1], ["layer", 1], ["group", 0]]);
    expect(groupMembers(doc, 2)).toEqual([0, 1]);
    expect(groupsAreValid(doc.layers)).toBe(true);
    expect(Array.from(doc.frames[0]!.data)).toEqual(Array.from(d.frames[0]!.data)); // looks the same
    const half = updateLayer(doc, 2, { opacity: 0.5 });
    expect(px(half, 0)[3]).toBe(128);
    expect(px(half, 1)[3]).toBe(128);
    expect(px(updateLayer(doc, 2, { visible: false }), 0)[3]).toBe(0);
    const inv = updateLayer(doc, 2, { effects: [newLayerEffect("invert")] });
    expect(px(inv, 0)).toEqual([0, 255, 255, 255]);
    expect(px(inv, 1)).toEqual([255, 255, 0, 255]);
  });
  it("a group's opacity is not the same as lowering each layer (overlaps do not show through)", () => {
    let d = newDoc(1, 1);
    setPixel(d.layers[0]!.cels[0]!, 0, 0, [255, 0, 0, 255]);
    d = addLayer(d, 0).doc;
    setPixel(d.layers[1]!.cels[0]!, 0, 0, [0, 0, 255, 255]);
    const grouped = updateLayer(groupLayers(d, 0, 1).doc, 2, { opacity: 0.5 });
    const separate = updateLayer(updateLayer(d, 0, { opacity: 0.5 }), 1, { opacity: 0.5 });
    expect(px(grouped)).toEqual([0, 0, 255, 128]); // blue covers red, then the whole is half there
    expect(px(separate)[3]).toBeGreaterThan(128); // each half-covers the other: more solid
  });
  it("can be nested, taken apart and removed with their layers", () => {
    let d = addLayer(two(), 1).doc; // three layers
    const inner = groupLayers(d, 0, 1).doc; // [l,l,G,l]
    const outer = groupLayers(inner, 0, 2).doc; // [l,l,G,G2,l]? the outer group takes layers 0..2
    expect(groupsAreValid(outer.layers)).toBe(true);
    expect(outer.layers.map((l) => l.depth ?? 0)).toEqual([2, 2, 1, 0, 0]);
    expect(groupMembers(outer, 3)).toEqual([0, 1, 2]);
    const apart = ungroup(outer, 3);
    expect(apart.layers.map((l) => l.depth ?? 0)).toEqual([1, 1, 0, 0]);
    expect(Array.from(apart.frames[0]!.data)).toEqual(Array.from(inner.frames[0]!.data));
    const gone = removeLayer(inner, 2); // the group and the two layers in it
    expect(gone.layers.length).toBe(1);
    expect(removeLayer(newDoc(1, 1), 0).layers.length).toBe(1);
  });
  it("refuses moves that would break a group, copies of a group, and merges across it", () => {
    const doc = groupLayers(two(), 0, 1).doc;
    expect(moveLayer(doc, 1, 1).index).toBe(1); // the top member may not leave over the header
    expect(moveLayer(doc, 2, -1).index).toBe(2); // nor the header move
    expect(moveLayer(doc, 0, 1).index).toBe(1); // members swap freely
    expect(duplicateLayer(doc, 2).doc).toBe(doc);
    expect(mergeDown(doc, 2).doc).toBe(doc);
    expect(updateLayer(doc, 2, { locked: false }).layers[2]!.locked).toBe(true);
  });
  it("a new layer above a member joins its group", () => {
    const doc = groupLayers(two(), 0, 1).doc;
    const next = addLayer(doc, 1).doc;
    expect(next.layers.map((l) => l.depth ?? 0)).toEqual([1, 1, 1, 0]);
    expect(groupsAreValid(next.layers)).toBe(true);
  });
  it("detects broken groups", () => {
    const d = groupLayers(two(), 0, 1).doc;
    expect(groupsAreValid(d.layers.slice(0, 2))).toBe(false); // members with no header
    expect(groupsAreValid([d.layers[2]!, d.layers[0]!, d.layers[1]!])).toBe(false);
  });
});

describe("saving layers with groups and effects", () => {
  it("round-trips through the layers file and checks against the sheet", () => {
    let d = groupLayers(two(), 0, 1).doc;
    d = updateLayer(d, 2, { opacity: 0.7, effects: [newLayerEffect("hue")] });
    d = updateLayer(d, 0, { effects: [newLayerEffect("brightness")] });
    const images = d.layers.map((_, i) => `l${i}.png`);
    const file = parseLayersFile(layersFileText(d, images))!;
    expect(file).not.toBeNull();
    expect(file.layers[2]).toMatchObject({ group: true });
    expect(file.layers[0]!.depth).toBe(1);
    const flat = { ...d, layers: [{ ...d.layers[0]!, cels: d.frames, effects: undefined, depth: undefined }] };
    const back = applyLayers(flat as typeof d, file, layerSheets(d));
    expect(back).not.toBeNull();
    expect(back!.layers.map((l) => [l.kind ?? "layer", l.depth ?? 0, l.effects?.length ?? 0])).toEqual([["layer", 1, 1], ["layer", 1, 0], ["group", 0, 1]]);
    expect(Array.from(back!.frames[0]!.data)).toEqual(Array.from(d.frames[0]!.data));
  });
  it("a file with a bad effect or a broken group is not trusted", () => {
    const d = groupLayers(two(), 0, 1).doc;
    const text = layersFileText(d, ["a", "b", "c"]);
    const bad = JSON.parse(text);
    bad.layers[0].effects = [{ type: "zzz", params: {} }];
    expect(parseLayersFile(JSON.stringify(bad))).toBeNull();
    const broken = JSON.parse(text);
    delete broken.layers[2].group;
    const f = parseLayersFile(JSON.stringify(broken))!;
    expect(applyLayers({ ...d, layers: [d.layers[0]!] } as typeof d, f, layerSheets(d))).toBeNull();
  });
});

import { addLayerEffect, moveLayerEffect, removeLayerEffect, setLayerEffectParam, toggleLayerEffect, MAX_LAYER_FX } from "./layer-fx";
describe("editing the effect list", () => {
  it("adds up to the limit, moves, sets, switches and removes", () => {
    let l = addLayerEffect(undefined, "invert");
    l = addLayerEffect(l, "hue");
    expect(l.map((e) => e.type)).toEqual(["invert", "hue"]);
    expect(moveLayerEffect(l, 1, -1).map((e) => e.type)).toEqual(["hue", "invert"]);
    expect(moveLayerEffect(l, 0, -1)).toEqual(l);
    expect(setLayerEffectParam(l, 1, "degrees", 90)[1]!.params.degrees).toBe(90);
    expect(toggleLayerEffect(l, 0)[0]!.on).toBe(false);
    expect(toggleLayerEffect(toggleLayerEffect(l, 0), 0)[0]!.on).toBe(true);
    expect(removeLayerEffect(l, 0).map((e) => e.type)).toEqual(["hue"]);
    let many = l;
    for (let i = 0; i < 10; i++) many = addLayerEffect(many, "grayscale");
    expect(many.length).toBe(MAX_LAYER_FX);
  });
});

import { setCelOpacity, insertFrame, moveFrame, removeFrame } from "./sprite-doc";
describe("opacity of one cel", () => {
  const twoFrames = () => {
    let d = insertFrame(newDoc(1, 1, 1), 1, 0);
    d.layers[0]!.cels.forEach((c) => setPixel(c, 0, 0, [200, 0, 0, 255]));
    recompose(d, 0);
    recompose(d, 1);
    return d;
  };
  it("fades one frame of a layer and not the others", () => {
    const d = setCelOpacity(twoFrames(), 0, 1, 0.5);
    const at = (f: number) => getPixel(composeFrame(d, f), 0, 0)![3];
    expect(at(0)).toBe(255);
    expect(at(1)).toBe(128);
    expect(d.frames[1]!.data[3]).toBe(128);
    expect(setCelOpacity(d, 0, 1, 1).layers[0]!.cels[1]!.celOpacity).toBeUndefined();
    expect(setCelOpacity(d, 0, 9, 0.5)).toBe(d);
  });
  it("multiplies with the layer's own opacity", () => {
    let d = updateLayer(twoFrames(), 0, { opacity: 0.5 });
    d = setCelOpacity(d, 0, 0, 0.5);
    expect(getPixel(composeFrame(d, 0), 0, 0)![3]).toBe(64);
  });
  it("travels with its frame when frames are moved, copied or removed", () => {
    let d = setCelOpacity(twoFrames(), 0, 1, 0.25);
    d = moveFrame(d, 1, 0);
    expect(d.layers[0]!.cels[0]!.celOpacity).toBe(0.25);
    expect(d.layers[0]!.cels[1]!.celOpacity).toBeUndefined();
    const copied = insertFrame(d, 1, 0);
    expect(copied.layers[0]!.cels[1]!.celOpacity).toBe(0.25); // a copy of the frame is a copy of the cel
    expect(removeFrame(d, 0).layers[0]!.cels[0]!.celOpacity).toBeUndefined();
  });
  it("is saved in the layers file and put back", () => {
    const d = setCelOpacity(twoFrames(), 0, 1, 0.5);
    const file = parseLayersFile(layersFileText(d, ["l.png"]))!;
    expect(file.layers[0]!.celOpacity).toEqual([1, 0.5]);
    const flat = { ...d, layers: [{ ...d.layers[0]!, cels: d.frames.map((f) => ({ ...f, celOpacity: undefined })) }] };
    const back = applyLayers(flat as typeof d, file, layerSheets({ ...d, layers: [{ ...d.layers[0]!, cels: d.layers[0]!.cels }] }));
    expect(back).not.toBeNull();
    expect(back!.layers[0]!.cels[1]!.celOpacity).toBe(0.5);
    const bad = JSON.parse(layersFileText(d, ["l.png"]));
    bad.layers[0].celOpacity = [1, 3];
    expect(parseLayersFile(JSON.stringify(bad))).toBeNull();
  });
});
