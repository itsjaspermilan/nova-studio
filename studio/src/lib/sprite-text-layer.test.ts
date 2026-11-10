import { describe, expect, it } from "vitest";
import { addTextLayer, rasterizeText, setLayerText } from "./sprite-text-layer";
import { applyLayers, layerSheets, layersFileText, newDoc, parseLayersFile, toSheet } from "./sprite-doc";
import { drawText, textSize } from "./pixel-text";
import { newRaster } from "./pixels";

const count = (c: { data: Uint8ClampedArray }) => c.data.filter((_, i) => i % 4 === 3 && c.data[i]! > 0).length;

describe("text layers", () => {
  it("draws the words into every frame, locks the layer, and names it after them", () => {
    const base = newDoc(40, 16, 3);
    const r = addTextLayer(base, 0, { value: "Hi", x: 1, y: 1, color: "#ff0000" });
    const layer = r.doc.layers[r.index]!;
    expect(layer.text?.value).toBe("Hi");
    expect(layer.locked).toBe(true);
    expect(layer.name).toBe("Hi");
    const expected = newRaster(40, 16);
    drawText(expected, 1, 1, "Hi", [255, 0, 0, 255], 1);
    for (const cel of layer.cels) expect([...cel.data]).toEqual([...expected.data]);
    // the picture shows it
    expect(count(r.doc.frames[2]!)).toBe(count(expected));
  });
  it("changes redraw it from scratch: new words, a bigger size, a new place, a new colour", () => {
    let d = addTextLayer(newDoc(60, 30, 1), 0, { value: "ab" }).doc;
    const before = count(d.layers[1]!.cels[0]!);
    d = setLayerText(d, 1, { value: "abcd" });
    expect(count(d.layers[1]!.cels[0]!)).toBeGreaterThan(before);
    d = setLayerText(d, 1, { scale: 2, x: 4, y: 4, color: "#00ff00" });
    const box = textSize("abcd", 2);
    const cel = d.layers[1]!.cels[0]!;
    expect(count(cel)).toBeGreaterThan(0);
    // nothing is left of the old place
    expect(cel.data[(2 * 60 + 2) * 4 + 3]).toBe(0);
    expect(box.w).toBeGreaterThan(textSize("abcd", 1).w);
    expect(setLayerText(newDoc(8, 8, 1), 0, { value: "x" }).layers[0]!.text).toBeUndefined();
  });
  it("rasterize keeps the pixels and drops the words and the lock", () => {
    const d = rasterizeText(addTextLayer(newDoc(40, 16, 1), 0, { value: "Hi" }).doc, 1);
    expect(d.layers[1]!.text).toBeUndefined();
    expect(d.layers[1]!.locked).toBeUndefined();
    expect(count(d.layers[1]!.cels[0]!)).toBeGreaterThan(0);
  });
  it("is kept in the layers file and comes back as a text layer", () => {
    const d = addTextLayer(newDoc(40, 16, 2), 0, { value: "Go", scale: 2, x: 3, y: 1, color: "#123456" }).doc;
    const text = layersFileText(d, ["a.png", "b.png"]);
    const file = parseLayersFile(text)!;
    expect(file.layers[1]!.text).toEqual({ value: "Go", x: 3, y: 1, scale: 2, color: "#123456" });
    const sheets = layerSheets(d);
    const flat = { ...d, layers: [d.layers[0]!] };
    const again = applyLayers({ ...newDoc(40, 16, 2), frames: d.frames.map((f) => f) , layers: flat.layers }, file, sheets)!;
    expect(again.layers[1]!.text?.value).toBe("Go");
    expect(again.layers[1]!.locked).toBe(true);
    expect(toSheet(again).data.length).toBe(toSheet(d).data.length);
    // a bad one is refused
    expect(parseLayersFile(text.replace('"scale": 2', '"scale": 99'))).toBeNull();
  });
});
