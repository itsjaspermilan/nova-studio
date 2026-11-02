import { describe, expect, it } from "vitest";
import { getPixel, setPixel, type Rgba } from "./pixels";
import { addTag, frameAt, fromImage, fromSheet, insertFrame, moveFrame, newDoc, parseSheetJson, removeFrame, removeTag, tagProblems, tagSequence, toSheet, toSheetJson, updateTag, type SpriteDoc, type Tag } from "./sprite-doc";

const RED: Rgba = [255, 0, 0, 255];
const tag = (over: Partial<Tag> = {}): Tag => ({ name: "t", from: 0, to: 3, direction: "forward", loop: true, ...over });
const marked = (n: number): SpriteDoc => {
  const d = newDoc(4, 4, n);
  d.frames.forEach((f, i) => setPixel(f, i % 4, 0, RED)); // frame i has its red pixel at x = i % 4
  return d;
};
const which = (d: SpriteDoc) => d.frames.map((f) => [0, 1, 2, 3].find((x) => getPixel(f, x, 0)![3] > 0));

describe("tag playback order", () => {
  it("matches the runtime for forward, reverse and ping-pong", () => {
    expect(tagSequence(tag())).toEqual([0, 1, 2, 3]);
    expect(tagSequence(tag({ direction: "reverse" }))).toEqual([3, 2, 1, 0]);
    expect(tagSequence(tag({ direction: "pingpong" }))).toEqual([0, 1, 2, 3, 2, 1]);
    expect(tagSequence(tag({ direction: "pingpong", to: 1 }))).toEqual([0, 1]);
    expect(tagSequence(tag({ from: 2, to: 2 }))).toEqual([2]);
  });
});

describe("frames", () => {
  it("inserts blanks and copies, shifting tags", () => {
    let d = marked(3);
    d.tags = [tag({ from: 1, to: 2 })];
    d = insertFrame(d, 1, 0); // copy of frame 0 goes to index 1
    expect(which(d)).toEqual([0, 0, 1, 2]);
    expect(d.tags[0]).toMatchObject({ from: 2, to: 3 });
    expect(which(insertFrame(d, 99))).toEqual([0, 0, 1, 2, undefined]);
    expect(d.frames).toHaveLength(4);
  });

  it("removes frames, shrinking and dropping tags, and keeps the last frame", () => {
    let d = marked(4);
    d.tags = [tag({ name: "a", from: 1, to: 2 }), tag({ name: "b", from: 3, to: 3 }), tag({ name: "c", from: 0, to: 3 })];
    d = removeFrame(d, 3);
    expect(d.tags.map((t) => [t.name, t.from, t.to])).toEqual([["a", 1, 2], ["c", 0, 2]]);
    d = removeFrame(d, 1);
    expect(d.tags.map((t) => [t.name, t.from, t.to])).toEqual([["a", 1, 1], ["c", 0, 1]]);
    const one = newDoc(2, 2);
    expect(removeFrame(one, 0)).toBe(one);
  });

  it("moves a frame with its duration; tags stay on their positions", () => {
    let d = marked(3);
    d.durations = [10, 20, 30];
    d.tags = [tag({ from: 0, to: 1 })];
    d = moveFrame(d, 0, 2);
    expect(which(d)).toEqual([1, 2, 0]);
    expect(d.durations).toEqual([20, 30, 10]);
    expect(d.tags[0]).toMatchObject({ from: 0, to: 1 });
    expect(moveFrame(d, 1, 1)).toBe(d);
    expect(moveFrame(d, 0, 9)).toBe(d);
  });
});

describe("tags", () => {
  it("adds with fresh names, clamps edits to the frames and finds problems", () => {
    let d = newDoc(2, 2, 3);
    d = addTag(d, 2, 0);
    d = addTag(d, 1, 1);
    expect(d.tags.map((t) => [t.name, t.from, t.to])).toEqual([["tag1", 0, 2], ["tag2", 1, 1]]);
    d = updateTag(d, 0, { to: 99 });
    expect(d.tags[0]!.to).toBe(2);
    d = updateTag(d, 1, { from: 2, to: 0 });
    expect(d.tags[1]).toMatchObject({ from: 2, to: 2 });
    expect(updateTag(d, 9, { name: "x" })).toBe(d);
    expect(tagProblems(d)).toEqual([]);
    d = updateTag(updateTag(d, 1, { name: "tag1" }), 0, { name: " " });
    expect(tagProblems(d)).toEqual(["Tag 1 needs a name"]);
    expect(tagProblems(updateTag(d, 0, { name: "tag1" }))).toEqual(['There are two tags called "tag1"']);
    expect(removeTag(d, 0).tags).toHaveLength(1);
  });
});

describe("sheets", () => {
  it("lays frames in a grid and cuts them out again", () => {
    const d = marked(3);
    const sheet = toSheet(d);
    expect([sheet.w, sheet.h]).toEqual([12, 4]);
    const back = fromSheet(sheet, { frame_width: 4, frame_height: 4, frames: 3 });
    expect(which(back)).toEqual([0, 1, 2]);
    const wide = toSheet(newDoc(2, 2, 20));
    expect([wide.w, wide.h]).toEqual([32, 4]); // 16 columns, 2 rows
  });

  it("reads the runtime's defaults: columns and frame count from the image, durations from either key", () => {
    const sheet = toSheet(marked(4));
    const d = fromSheet(sheet, { frame_width: 4, frame_height: 4, durations_ms: [5, 6], frame_duration_ms: 7, tags: [{ name: "ok", from: 0, to: 1 }, { name: "bad", from: 2, to: 9 }, { name: "pp", from: 1, to: 2, direction: "pingpong", loop: false }] });
    expect(d.frames).toHaveLength(4);
    expect(d.durations).toEqual([5, 6, 7, 7]);
    expect(d.tags.map((t) => t.name)).toEqual(["ok", "pp"]);
    expect(d.tags[1]).toMatchObject({ direction: "pingpong", loop: false });
    expect(fromSheet(sheet, { frame_width: 4, frame_height: 4, frames: 2 }).frames).toHaveLength(2);
    expect(fromSheet(sheet, { frame_width: 50, frame_height: 50 }).frames).toHaveLength(1);
    expect(fromImage(sheet).frames).toHaveLength(1);
  });

  it("writes tidy JSON the parser and runtime format accept, and survives a round trip", () => {
    const d = marked(3);
    d.durations = [100, 100, 250];
    d.tags = [tag({ name: "run", from: 0, to: 2, direction: "pingpong" }), tag({ name: "hit", from: 2, to: 2, loop: false })];
    const text = toSheetJson(d, "hero.png");
    expect(text).toBe(`{
  "version": 1,
  "image": "hero.png",
  "frame_width": 4,
  "frame_height": 4,
  "columns": 3,
  "frames": 3,
  "durations_ms": [100, 100, 250],
  "tags": [
    { "name": "run", "from": 0, "to": 2, "direction": "pingpong" },
    { "name": "hit", "from": 2, "to": 2, "loop": false }
  ]
}
`);
    const parsed = parseSheetJson(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const back = fromSheet(toSheet(d), parsed.json);
    expect(back.tags).toEqual(d.tags);
    expect(back.durations).toEqual(d.durations);
    expect(toSheetJson(newDoc(8, 8), "a.png")).toBe('{\n  "version": 1,\n  "image": "a.png",\n  "frame_width": 8,\n  "frame_height": 8,\n  "frame_duration_ms": 100\n}\n');
  });

  it("rejects bad sheet files with a reason", () => {
    expect(parseSheetJson("{ no")).toMatchObject({ ok: false });
    expect(parseSheetJson("[]")).toMatchObject({ ok: false, error: "a sprite file is a JSON object" });
    expect(parseSheetJson('{"frame_width": 0, "frame_height": 8}')).toMatchObject({ ok: false });
    expect(parseSheetJson('{"frame_width": 8, "frame_height": 8, "tags": 3}')).toMatchObject({ ok: false, error: '"tags" must be a list' });
  });
});

describe("playback timing", () => {
  it("finds the frame for a time, looping or holding the last", () => {
    const d = newDoc(2, 2, 3);
    d.durations = [100, 200, 50];
    expect(frameAt(d, [0, 1, 2], 0)).toBe(0);
    expect(frameAt(d, [0, 1, 2], 99)).toBe(0);
    expect(frameAt(d, [0, 1, 2], 100)).toBe(1);
    expect(frameAt(d, [0, 1, 2], 300)).toBe(2);
    expect(frameAt(d, [0, 1, 2], 350)).toBe(0); // looped
    expect(frameAt(d, [0, 1, 2], 9999, false)).toBe(2);
    expect(frameAt(d, [], 10)).toBe(0);
  });
});

import { resizeDoc } from "./sprite-doc";

describe("resizeDoc", () => {
  it("resizes every frame, clamps silly sizes and keeps tags and durations", () => {
    let d = marked(2);
    d.durations = [10, 20];
    d.tags = [tag({ from: 0, to: 1 })];
    const big = resizeDoc(d, 8, 6);
    expect([big.fw, big.fh]).toEqual([8, 6]);
    expect(big.frames.every((f) => f.w === 8 && f.h === 6)).toBe(true);
    expect(getPixel(big.frames[1]!, 1, 0)![3]).toBe(255);
    expect(big.durations).toEqual([10, 20]);
    expect(big.tags).toEqual(d.tags);
    expect(resizeDoc(d, 4, 4)).toBe(d);
    expect(resizeDoc(d, 99999, 0).fw).toBe(1024);
    expect(resizeDoc(d, 99999, 0).fh).toBe(1);
    expect(d.fw).toBe(4); // untouched
  });
});

import { addLayer, applyLayers, composeFrame, duplicateLayer, hashRaster, layerSheets, layersFileText, mergeDown, moveLayer, parseLayersFile, recompose, removeLayer, updateLayer } from "./sprite-doc";
import { newRaster, stamp } from "./pixels";

const BLUE: Rgba = [0, 0, 255, 255];
const px = (r: ReturnType<typeof newRaster>, x: number, y: number) => getPixel(r, x, y)!;

describe("layers", () => {
  it("starts with one layer and stacks visible layers bottom to top", () => {
    let d = newDoc(4, 4, 2);
    expect(d.layers).toHaveLength(1);
    setPixel(d.layers[0]!.cels[0]!, 1, 1, RED);
    const added = addLayer(d, 0);
    d = added.doc;
    expect(added.index).toBe(1);
    expect(d.layers.map((l) => l.name)).toEqual(["Layer 1", "Layer 2"]);
    setPixel(d.layers[1]!.cels[0]!, 1, 1, BLUE);
    setPixel(d.layers[1]!.cels[0]!, 2, 2, BLUE);
    recompose(d, 0);
    expect(px(d.frames[0]!, 1, 1)).toEqual(BLUE); // the top layer wins
    expect(px(composeFrame(d, 1), 1, 1)).toEqual([0, 0, 0, 0]);
    d = updateLayer(d, 1, { visible: false });
    expect(px(d.frames[0]!, 1, 1)).toEqual(RED); // hiding shows what is underneath
    expect(px(d.frames[0]!, 2, 2)[3]).toBe(0);
    d = updateLayer(d, 1, { visible: true, opacity: 0.5 });
    expect(px(d.frames[0]!, 2, 2)[3]).toBe(128);
    expect(updateLayer(d, 9, { name: "x" })).toBe(d);
    expect(updateLayer(d, 0, { name: "  Body " }).layers[0]!.name).toBe("Body");
    expect(updateLayer(d, 0, { opacity: 7 }).layers[0]!.opacity).toBe(1);
  });

  it("adds layers above a chosen one, duplicates, reorders and removes (never the last)", () => {
    let d = newDoc(2, 2);
    d = addLayer(addLayer(d, 0).doc, 0).doc; // a second layer inserted above the first, then another above the first
    expect(d.layers.map((l) => l.name)).toEqual(["Layer 1", "Layer 3", "Layer 2"]);
    const dup = duplicateLayer(d, 0);
    expect(dup.index).toBe(1);
    expect(dup.doc.layers[1]!.name).toBe("Layer 1 copy");
    const up = moveLayer(dup.doc, 0, 1);
    expect(up.index).toBe(1);
    expect(up.doc.layers.map((l) => l.name)).toEqual(["Layer 1 copy", "Layer 1", "Layer 3", "Layer 2"]);
    expect(moveLayer(d, 2, 1).index).toBe(2);
    expect(moveLayer(d, 0, -1).doc).toBe(d);
    const removed = removeLayer(d, 1);
    expect(removed.layers).toHaveLength(2);
    expect(removeLayer(removeLayer(removed, 0), 0).layers).toHaveLength(1);
    expect(removeLayer(newDoc(2, 2), 0).layers).toHaveLength(1);
    expect(d.layers).toHaveLength(3); // untouched
  });

  it("keeps every layer in step with frame and canvas edits", () => {
    let d = addLayer(newDoc(4, 4, 2), 0).doc;
    setPixel(d.layers[1]!.cels[1]!, 0, 0, RED);
    d = insertFrame(d, 0);
    expect(d.layers.every((l) => l.cels.length === 3)).toBe(true);
    expect(px(d.layers[1]!.cels[2]!, 0, 0)).toEqual(RED); // moved along with its frame
    d = moveFrame(d, 2, 0);
    expect(px(d.layers[1]!.cels[0]!, 0, 0)).toEqual(RED);
    d = insertFrame(d, 1, 0); // a copy of frame 0 carries each layer's pixels
    expect(px(d.layers[1]!.cels[1]!, 0, 0)).toEqual(RED);
    d = removeFrame(d, 1);
    expect(d.layers.every((l) => l.cels.length === 3)).toBe(true);
    const big = resizeDoc(d, 8, 8, 1, 1);
    expect(big.layers.every((l) => l.cels.every((c) => c.w === 8 && c.h === 8))).toBe(true);
    expect(px(big.layers[1]!.cels[0]!, 4, 4)).toEqual(RED);
  });

  it("merges a layer into the one below using its opacity", () => {
    let d = addLayer(newDoc(2, 2), 0).doc;
    setPixel(d.layers[0]!.cels[0]!, 0, 0, RED);
    setPixel(d.layers[1]!.cels[0]!, 1, 0, BLUE);
    d = updateLayer(d, 1, { opacity: 0.5 });
    const m = mergeDown(d, 1);
    expect(m.index).toBe(0);
    expect(m.doc.layers).toHaveLength(1);
    expect(px(m.doc.layers[0]!.cels[0]!, 0, 0)).toEqual(RED);
    expect(px(m.doc.layers[0]!.cels[0]!, 1, 0)).toEqual([0, 0, 255, 128]);
    expect(mergeDown(d, 0).doc).toBe(d);
  });

  it("round-trips layers through a file and notices when the sheet was changed elsewhere", () => {
    let d = addLayer(newDoc(4, 4, 3), 0).doc;
    setPixel(d.layers[0]!.cels[1]!, 1, 1, RED);
    setPixel(d.layers[1]!.cels[2]!, 2, 2, BLUE);
    d = updateLayer(d, 1, { name: "Outline", opacity: 0.75 });
    recompose(d, 1);
    recompose(d, 2);
    const sheets = layerSheets(d);
    const text = layersFileText(d, sheets.map((_, i) => `data:image/png;base64,L${i}`));
    const file = parseLayersFile(text)!;
    expect(file).toMatchObject({ frames: 3, columns: 3, sheet: hashRaster(toSheet(d)) });
    expect(file.layers.map((l) => [l.name, l.opacity])).toEqual([["Layer 1", 1], ["Outline", 0.75]]);
    const flat = fromSheet(toSheet(d), { frame_width: 4, frame_height: 4, frames: 3 });
    const back = applyLayers(flat, file, sheets)!;
    expect(back.layers.map((l) => l.name)).toEqual(["Layer 1", "Outline"]);
    expect(px(back.layers[1]!.cels[2]!, 2, 2)).toEqual(BLUE);
    expect(hashRaster(toSheet(back))).toBe(hashRaster(toSheet(d)));
    // someone edited the PNG: the flat picture no longer matches the layers
    setPixel(flat.frames[0]!, 0, 0, [9, 9, 9, 255]);
    expect(applyLayers(flat, file, sheets)).toBeNull();
    expect(applyLayers(fromSheet(toSheet(d), { frame_width: 4, frame_height: 4, frames: 2 }), file, sheets)).toBeNull();
  });

  it("rejects damaged layer files", () => {
    expect(parseLayersFile("{ no")).toBeNull();
    expect(parseLayersFile('{"version":2}')).toBeNull();
    expect(parseLayersFile('{"version":1,"sheet":"x","frames":1,"columns":1,"layers":[]}')).toBeNull();
    expect(parseLayersFile('{"version":1,"sheet":"x","frames":1,"columns":1,"layers":[{"name":1}]}')).toBeNull();
  });

  it("fingerprints pictures by size and content", () => {
    const a = newRaster(2, 2);
    const b = newRaster(2, 2);
    expect(hashRaster(a)).toBe(hashRaster(b));
    stamp(b, 0, 0, 1, RED);
    expect(hashRaster(a)).not.toBe(hashRaster(b));
    expect(hashRaster(newRaster(4, 1))).not.toBe(hashRaster(newRaster(2, 2)));
  });
});
