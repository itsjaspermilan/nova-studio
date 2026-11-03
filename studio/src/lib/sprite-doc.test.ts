import { describe, expect, it } from "vitest";
import { getPixel, newRaster, setPixel, type Rgba } from "./pixels";
import {
  addAnimation, animationOf, duplicateFrames, moveFramesTo, removeFrames, detectGrid, gridFromCounts, smartGrid, duplicateAnimation, frameAt, fromImage, fromSheet, gridTiles, importTiles, insertFrame, isPristine, moveAnimation, moveFrame, newDoc, normalizeAnimations,
  parseSheetJson, removeAnimation, removeFrame, setAnimationDuration, tagProblems, tagSequence, toSheet, toSheetJson, updateAnimation, type SpriteDoc, type Tag,
} from "./sprite-doc";

const RED: Rgba = [255, 0, 0, 255];
const tag = (over: Partial<Tag> = {}): Tag => ({ name: "t", from: 0, to: 3, direction: "forward", loop: true, ...over });
const marked = (n: number): SpriteDoc => {
  const d = newDoc(4, 4, n);
  d.frames.forEach((f, i) => {
    setPixel(f, i % 4, 0, RED); // frame i has its red pixel at x = i % 4
    setPixel(d.layers[0]!.cels[i]!, i % 4, 0, RED); // on its only layer too, as drawn frames are
  });
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

/// n marked frames split into animations of the given sizes, named a, b, c...
const split = (...sizes: number[]): SpriteDoc => {
  const d = marked(sizes.reduce((x, y) => x + y, 0));
  let at = 0;
  d.tags = sizes.map((n, i) => {
    const t = tag({ name: String.fromCharCode(97 + i), from: at, to: at + n - 1 });
    at += n;
    return t;
  });
  return d;
};
const shape = (d: SpriteDoc) => d.tags.map((t) => [t.name, t.from, t.to]);

describe("frames inside animations", () => {
  it("inserts into the animation of the frame before, and only later animations move", () => {
    let d = split(2, 2);
    d = insertFrame(d, 1, 0); // a copy of frame 0 after frame 0
    expect(which(d)).toEqual([0, 0, 1, 2, 3]);
    expect(shape(d)).toEqual([["a", 0, 2], ["b", 3, 4]]);
    d = insertFrame(d, 5, 4); // after the very last frame
    expect(shape(d)).toEqual([["a", 0, 2], ["b", 3, 5]]);
    const front = insertFrame(split(2, 2), 2, undefined, 1); // asked for animation b explicitly: at its start
    expect(shape(front)).toEqual([["a", 0, 1], ["b", 2, 4]]);
    expect(which(insertFrame(marked(2), 99))).toEqual([0, 1, undefined]);
  });

  it("removes a frame from its own animation and refuses to empty one", () => {
    let d = split(2, 1, 2);
    d = removeFrame(d, 0);
    expect(shape(d)).toEqual([["a", 0, 0], ["b", 1, 1], ["c", 2, 3]]);
    expect(removeFrame(d, 0)).toBe(d); // a has one frame left
    expect(removeFrame(d, 1)).toBe(d);
    d = removeFrame(d, 3);
    expect(shape(d)).toEqual([["a", 0, 0], ["b", 1, 1], ["c", 2, 2]]);
    expect(d.layers[0]!.cels).toHaveLength(3);
    const one = newDoc(2, 2);
    expect(removeFrame(one, 0)).toBe(one);
  });

  it("moves a frame with its duration, within its animation only", () => {
    let d = split(3, 1);
    d.durations = [10, 20, 30, 40];
    d = moveFrame(d, 0, 2);
    expect(which(d)).toEqual([1, 2, 0, 3]);
    expect(d.durations).toEqual([20, 30, 10, 40]);
    expect(shape(d)).toEqual([["a", 0, 2], ["b", 3, 3]]);
    expect(moveFrame(d, 1, 1)).toBe(d);
    expect(moveFrame(d, 2, 3)).toBe(d); // into another animation
    expect(moveFrame(d, 0, 9)).toBe(d);
  });

  it("finds a frame's animation", () => {
    const d = split(2, 3);
    expect([0, 1, 2, 4, 5].map((f) => animationOf(d, f))).toEqual([0, 0, 1, 1, -1]);
  });
});

describe("the animation list", () => {
  it("adds, duplicates, removes and reorders whole animations with their frames", () => {
    let d = split(2, 1);
    d.durations = [10, 20, 30];
    const added = addAnimation(d, "jump");
    expect(shape(added.doc)).toEqual([["a", 0, 1], ["b", 2, 2], ["jump", 3, 3]]);
    expect(added.index).toBe(2);
    expect(addAnimation(added.doc, "jump").doc.tags[3]!.name).toBe("jump 2");

    const copy = duplicateAnimation(d, 0);
    expect(copy.index).toBe(1);
    expect(shape(copy.doc)).toEqual([["a", 0, 1], ["a copy", 2, 3], ["b", 4, 4]]);
    expect(which(copy.doc)).toEqual([0, 1, 0, 1, 2]);
    expect(copy.doc.durations).toEqual([10, 20, 10, 20, 30]);
    copy.doc.frames[2]!.data[0] = 7; // the copy has pictures of its own
    expect(d.frames[0]!.data[0]).not.toBe(7);

    const gone = removeAnimation(copy.doc, 1);
    expect(shape(gone.doc)).toEqual([["a", 0, 1], ["b", 2, 2]]);
    expect(gone.index).toBe(1);
    expect(removeAnimation(newDoc(2, 2), 0).doc.tags).toHaveLength(1);

    const moved = moveAnimation(d, 1, -1);
    expect(shape(moved.doc)).toEqual([["b", 0, 0], ["a", 1, 2]]);
    expect(which(moved.doc)).toEqual([2, 0, 1]);
    expect(moved.doc.durations).toEqual([30, 10, 20]);
    expect(moved.index).toBe(0);
    expect(moveAnimation(d, 0, -1).doc).toBe(d);
  });

  it("edits names, direction and loop, and gives a whole animation one speed", () => {
    let d = split(2, 2);
    d = updateAnimation(d, 1, { name: "run", direction: "pingpong", loop: false });
    expect(d.tags[1]).toMatchObject({ name: "run", direction: "pingpong", loop: false, from: 2, to: 3 });
    expect(updateAnimation(d, 9, { name: "x" })).toBe(d);
    d = setAnimationDuration(d, 1, 55);
    expect(d.durations).toEqual([100, 100, 55, 55]);
    expect(setAnimationDuration(d, 1, 3)).toBe(d);
    expect(tagProblems(d)).toEqual([]);
    expect(tagProblems(updateAnimation(d, 0, { name: " " }))).toEqual(["Tag 1 needs a name"]);
    expect(tagProblems(updateAnimation(d, 0, { name: "run" }))).toEqual(['There are two tags called "run"']);
  });

  it("splits overlapping and gappy files into animations of their own", () => {
    const sheet = toSheet(marked(4));
    const d = fromSheet(sheet, { frame_width: 4, frame_height: 4, durations_ms: [5, 6, 7, 8], tags: [{ name: "walk", from: 0, to: 1 }, { name: "run", from: 1, to: 2 }] });
    expect(shape(d)).toEqual([["walk", 0, 1], ["run", 2, 3], ["unused", 4, 4]]);
    expect(which(d)).toEqual([0, 1, 1, 2, 3]);
    expect(d.durations).toEqual([5, 6, 6, 7, 8]);
    expect(d.layers[0]!.cels).toHaveLength(5);
    expect(normalizeAnimations(d)).toBe(d); // already blocks
    const none = fromSheet(sheet, { frame_width: 4, frame_height: 4 });
    expect(shape(none)).toEqual([["idle", 0, 3]]);
    expect(shape(newDoc(4, 4, 3))).toEqual([["idle", 0, 2]]);
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
    // ok (0-1) and pp (1-2) overlap on frame 1, which is copied; frame 3 is in none and goes to "unused"
    expect(d.frames).toHaveLength(5);
    expect(d.durations).toEqual([5, 6, 6, 7, 7]);
    expect(d.tags.map((t) => t.name)).toEqual(["ok", "pp", "unused"]);
    expect(d.tags[1]).toMatchObject({ direction: "pingpong", loop: false, from: 2, to: 3 });
    expect(fromSheet(sheet, { frame_width: 4, frame_height: 4, frames: 2 }).frames).toHaveLength(2);
    expect(fromSheet(sheet, { frame_width: 50, frame_height: 50 }).frames).toHaveLength(1);
    expect(fromImage(sheet).frames).toHaveLength(1);
  });

  it("writes tidy JSON the parser and runtime format accept, and survives a round trip", () => {
    const d = marked(3);
    d.durations = [100, 100, 250];
    d.tags = [tag({ name: "run", from: 0, to: 1, direction: "pingpong" }), tag({ name: "hit", from: 2, to: 2, loop: false })];
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
    { "name": "run", "from": 0, "to": 1, "direction": "pingpong" },
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
    expect(toSheetJson(newDoc(8, 8), "a.png")).toBe('{\n  "version": 1,\n  "image": "a.png",\n  "frame_width": 8,\n  "frame_height": 8,\n  "frame_duration_ms": 100,\n  "tags": [\n    { "name": "idle", "from": 0, "to": 0 }\n  ]\n}\n');
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
import { stamp } from "./pixels";

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

describe("importing sheets", () => {
  /// A sheet of `cols` x `rows` 4x4 tiles; tile k has its red pixel at x = k % 4 in its top row, and tiles listed in `blank` stay empty.
  const sheetOf = (cols: number, rows: number, blank: number[] = [], gap = 0, margin = 0) => {
    const r = newRaster(2 * margin + cols * 4 + (cols - 1) * gap, 2 * margin + rows * 4 + (rows - 1) * gap);
    for (let k = 0; k < cols * rows; k++) {
      if (blank.includes(k)) continue;
      const [c, row] = [k % cols, Math.floor(k / cols)];
      setPixel(r, margin + c * (4 + gap) + (k % 4), margin + row * (4 + gap), RED);
    }
    return r;
  };
  const diag = (r: { data: Uint8ClampedArray }) => [0, 1, 2, 3].find((x) => r.data[x * 4 + 3]! > 0);

  it("cuts a sheet into tiles, with optional gaps and a border", () => {
    const g = gridTiles(sheetOf(3, 2), { tw: 4, th: 4 });
    expect([g.columns, g.rows, g.tiles.length]).toEqual([3, 2, 6]);
    expect(g.tiles.map(diag)).toEqual([0, 1, 2, 3, 0, 1]);
    const gap = gridTiles(sheetOf(3, 2, [], 1, 2), { tw: 4, th: 4, spacing: 1, margin: 2 });
    expect([gap.columns, gap.rows]).toEqual([3, 2]);
    expect(gap.tiles.map(diag)).toEqual([0, 1, 2, 3, 0, 1]);
    expect(gridTiles(sheetOf(1, 1), { tw: 9, th: 9 }).tiles).toEqual([]);
  });

  it("guesses a tile size", () => {
    expect(detectGrid(newRaster(64, 16))).toEqual({ tw: 16, th: 16 });
    expect(detectGrid(newRaster(128, 128))).toEqual({ tw: 64, th: 64 });
    expect(detectGrid(newRaster(96, 32))).toEqual({ tw: 32, th: 32 });
    expect(detectGrid(newRaster(30, 10))).toEqual({ tw: 10, th: 10 });
    expect(detectGrid(newRaster(7, 5))).toEqual({ tw: 7, th: 5 });
  });

  it("turns an untouched sprite into the imported animation at the tile size", () => {
    const fresh = newDoc(16, 16);
    expect(isPristine(fresh)).toBe(true);
    const tiles = gridTiles(sheetOf(4, 1), { tw: 4, th: 4 }).tiles;
    const r = importTiles(fresh, [{ name: "run", tiles }], { durationMs: 80 });
    expect([r.doc.fw, r.doc.fh, r.added, r.truncated, r.index]).toEqual([4, 4, 4, 0, 0]);
    expect(shape(r.doc)).toEqual([["run", 0, 3]]);
    expect(which(r.doc)).toEqual([0, 1, 2, 3]);
    expect(r.doc.durations).toEqual([80, 80, 80, 80]);
    expect(r.doc.layers[0]!.cels).toHaveLength(4);
    expect(isPristine(r.doc)).toBe(false);
  });

  it("adds animations after the existing ones, sizing tiles to the frames and keeping other animations", () => {
    const d = split(2, 1);
    const tiles = gridTiles(sheetOf(2, 1), { tw: 4, th: 4 }).tiles;
    const small = tiles.map((t) => t);
    const r = importTiles(d, [{ name: "a", tiles: small }, { name: "walk", tiles }]);
    expect(shape(r.doc)).toEqual([["a", 0, 1], ["b", 2, 2], ["a 2", 3, 4], ["walk", 5, 6]]);
    expect(r.index).toBe(3);
    expect(which(r.doc)).toEqual([0, 1, 2, 0, 1, 0, 1]);
    // tiles of another size are placed at the bottom centre of the frame
    const big = importTiles(d, [{ name: "tiny", tiles: [newRaster(2, 2)] }]);
    expect(big.doc.frames[3]!.w).toBe(4);
  });

  it("appends to an animation, reports tiles over the frame limit and ignores empty groups", () => {
    const d = split(2, 2);
    const tiles = gridTiles(sheetOf(3, 1), { tw: 4, th: 4 }).tiles;
    const r = importTiles(d, [{ name: "x", tiles }], { append: 0 });
    expect(shape(r.doc)).toEqual([["a", 0, 4], ["b", 5, 6]]);
    expect(which(r.doc)).toEqual([0, 1, 0, 1, 2, 2, 3]);
    expect(r.index).toBe(0);
    expect(importTiles(d, [{ name: "none", tiles: [] }]).doc).toBe(d);
    const full = newDoc(4, 4, 255);
    const over = importTiles(full, [{ name: "more", tiles }]);
    expect([over.added, over.truncated, over.doc.frames.length]).toEqual([1, 2, 256]);
  });

  it("puts imported pictures on the chosen layer", () => {
    const d = split(1);
    d.layers.push({ name: "Top", visible: true, opacity: 1, cels: d.frames.map(() => newRaster(4, 4)) });
    const tiles = gridTiles(sheetOf(1, 1), { tw: 4, th: 4 }).tiles;
    const r = importTiles(d, [{ name: "n", tiles }], { layer: 1 });
    expect(diag(r.doc.layers[1]!.cels[1]!)).toBe(0);
    expect(r.doc.layers[0]!.cels[1]!.data.some((v) => v)).toBe(false);
    expect(diag(r.doc.frames[1]!)).toBe(0);
  });
});

describe("finding a grid", () => {
  /// A sheet of cols x rows tiles (each tile w x h with a pixel in it), `gap` apart with `margin` all round.
  const sheet = (cols: number, rows: number, w: number, h: number, gap = 0, margin = 0) => {
    const r = newRaster(2 * margin + cols * w + (cols - 1) * gap, 2 * margin + rows * h + (rows - 1) * gap);
    for (let c = 0; c < cols; c++) for (let k = 0; k < rows; k++) {
      const [x0, y0] = [margin + c * (w + gap), margin + k * (h + gap)];
      for (let x = 0; x < w; x++) setPixel(r, x0 + x, y0, RED);
      for (let y = 0; y < h; y++) setPixel(r, x0, y0 + y, RED);
    }
    return r;
  };

  it("smart-slices a sheet with gutters", () => {
    expect(smartGrid(sheet(4, 2, 12, 10, 2, 3))).toEqual({ tw: 12, th: 10, spacing: 2, margin: 3 });
    expect(smartGrid(sheet(5, 1, 8, 8, 1, 0))).toEqual({ tw: 8, th: 8, spacing: 1, margin: 0 });
    expect(smartGrid(sheet(1, 3, 6, 9, 4, 2))).toEqual({ tw: 6, th: 9, spacing: 4, margin: 2 });
  });

  it("gives up on tiles that touch, differ or have uneven gutters", () => {
    expect(smartGrid(sheet(3, 3, 8, 8))).toBeNull();
    expect(smartGrid(sheet(1, 1, 8, 8, 0, 2))).toBeNull();
    expect(smartGrid(newRaster(8, 8))).toBeNull();
    const uneven = sheet(3, 1, 8, 8, 2);
    for (let y = 0; y < 8; y++) setPixel(uneven, 8, y, RED); // widens the first gutter's neighbour
    expect(smartGrid(uneven)).toBeNull();
  });

  it("works out a tile size from how many tiles there are", () => {
    expect(gridFromCounts(newRaster(64, 32), 4, 2)).toEqual({ tw: 16, th: 16, spacing: 0, margin: 0 });
    expect(gridFromCounts(newRaster(71, 32), 4, 1, 1, 2)).toEqual({ tw: 16, th: 28, spacing: 1, margin: 2 });
    expect(gridFromCounts(newRaster(10, 10), 0, 0).tw).toBe(10);
  });
});

describe("working on several frames at once", () => {
  // split(3, 1): frames 0, 1, 2 in animation a and frame 3 in b, each marked with its own column
  it("removes chosen frames but never empties an animation", () => {
    const d = removeFrames(split(3, 1), [0, 2]);
    expect(shape(d)).toEqual([["a", 0, 0], ["b", 1, 1]]);
    expect(which(d)).toEqual([1, 3]);
    const all = removeFrames(split(2, 2), [0, 1, 2, 3]);
    expect(shape(all)).toEqual([["a", 0, 0], ["b", 1, 1]]);
    expect(which(all)).toEqual([0, 2]); // the first frame of each stays
    const one = split(2);
    expect(removeFrames(one, [9])).toBe(one);
  });

  it("copies chosen frames after the last chosen frame of their animation", () => {
    const r = duplicateFrames(split(3, 1), [0, 1, 3]);
    expect(shape(r.doc)).toEqual([["a", 0, 4], ["b", 5, 6]]);
    expect(which(r.doc)).toEqual([0, 1, 0, 1, 2, 3, 3]);
    expect(r.picked).toEqual([2, 3, 6]);
    expect(r.doc.layers[0]!.cels).toHaveLength(7);
    expect(r.doc.frames[2]).not.toBe(r.doc.frames[0]); // a picture of its own
  });

  it("moves chosen frames to the end of another animation", () => {
    const r = moveFramesTo(split(3, 1), [0, 2], 1);
    expect(shape(r.doc)).toEqual([["a", 0, 0], ["b", 1, 3]]);
    expect(which(r.doc)).toEqual([1, 3, 0, 2]);
    expect(r.picked).toEqual([2, 3]);
    const keep = moveFramesTo(split(2, 1), [0, 1], 1);
    expect(shape(keep.doc)).toEqual([["a", 0, 0], ["b", 1, 2]]); // a keeps its first frame, so only one frame moved
    expect(which(keep.doc)).toEqual([0, 2, 1]);
    const d = split(3, 1);
    expect(moveFramesTo(d, [0], 9).doc).toBe(d);
  });
});
