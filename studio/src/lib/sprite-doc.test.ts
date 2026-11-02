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
