import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { readAseprite } from "./aseprite-read";
import { getPixel } from "./pixels";

// A small writer for the test: just enough of the format to build files with known contents.
const u16 = (n: number) => [n & 255, (n >> 8) & 255];
const i16 = (n: number) => u16(n & 0xffff);
const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const str = (s: string) => [...u16(s.length), ...new TextEncoder().encode(s)];
const chunk = (type: number, body: number[]) => [...u32(body.length + 6), ...u16(type), ...body];
const layer = (name: string, opts: { flags?: number; type?: number; level?: number; blend?: number; opacity?: number } = {}) =>
  chunk(0x2004, [...u16(opts.flags ?? 1), ...u16(opts.type ?? 0), ...u16(opts.level ?? 0), ...u16(0), ...u16(0), ...u16(opts.blend ?? 0), opts.opacity ?? 255, 0, 0, 0, ...str(name)]);
const cel = (layerIdx: number, x: number, y: number, w: number, h: number, rgba: number[], compressed = true, opacity = 255) => {
  const data = compressed ? [...deflateSync(Uint8Array.from(rgba))] : rgba;
  return chunk(0x2005, [...u16(layerIdx), ...i16(x), ...i16(y), opacity, ...u16(compressed ? 2 : 0), ...u16(0), 0, 0, 0, 0, 0, ...u16(w), ...u16(h), ...data]);
};
const linked = (layerIdx: number, frame: number) => chunk(0x2005, [...u16(layerIdx), ...i16(0), ...i16(0), 255, ...u16(1), ...u16(0), 0, 0, 0, 0, 0, ...u16(frame)]);
const tags = (list: { from: number; to: number; dir: number; name: string }[]) =>
  chunk(0x2018, [...u16(list.length), 0, 0, 0, 0, 0, 0, 0, 0, ...list.flatMap((t) => [...u16(t.from), ...u16(t.to), t.dir, ...u16(0), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...str(t.name)])]);
const frame = (ms: number, chunks: number[][]) => {
  const body = chunks.flat();
  return [...u32(16 + body.length), ...u16(0xf1fa), ...u16(chunks.length), ...u16(ms), 0, 0, ...u32(chunks.length), ...body];
};
const file = (w: number, h: number, depth: number, frames: number[][], extra: number[] = []) => {
  const body = frames.flat();
  const header = [...u32(128 + body.length), ...u16(0xa5e0), ...u16(frames.length), ...u16(w), ...u16(h), ...u16(depth), ...u32(1), ...u16(100), ...u32(0), ...u32(0), 0, ...new Array(3).fill(0), ...u16(0), 1, 1, ...i16(0), ...i16(0), ...u16(0), ...u16(0), ...new Array(84).fill(0)];
  return Uint8Array.from([...header.slice(0, 128), ...extra, ...body]);
};
const px = (...c: number[][]) => c.flat();

describe("reading Aseprite files", () => {
  it("reads layers, cels (placed by their offset), durations and tags", async () => {
    const red = px([255, 0, 0, 255], [255, 0, 0, 255]); // a 2x1 cel
    const blue = px([0, 0, 255, 255]);
    const bytes = file(4, 3, 32, [
      frame(80, [layer("Background"), layer("Top", { opacity: 128, blend: 1 }), cel(0, 1, 1, 2, 1, red), cel(1, 0, 0, 1, 1, blue, false), tags([{ from: 0, to: 1, dir: 2, name: "walk" }])]),
      frame(200, [cel(0, 0, 2, 2, 1, red), linked(1, 0)]),
    ]);
    const { doc, warnings } = await readAseprite(bytes);
    expect(warnings).toEqual([]);
    expect([doc.fw, doc.fh, doc.frames.length]).toEqual([4, 3, 2]);
    expect(doc.durations).toEqual([80, 200]);
    expect(doc.layers.map((l) => [l.name, l.visible, Math.round(l.opacity * 100), l.blend ?? "normal"])).toEqual([["Background", true, 100, "normal"], ["Top", true, 50, "multiply"]]);
    expect(getPixel(doc.layers[0]!.cels[0]!, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(getPixel(doc.layers[0]!.cels[0]!, 0, 1)).toEqual([0, 0, 0, 0]);
    expect(getPixel(doc.layers[0]!.cels[1]!, 0, 2)).toEqual([255, 0, 0, 255]);
    expect(getPixel(doc.layers[1]!.cels[0]!, 0, 0)).toEqual([0, 0, 255, 255]);
    expect(getPixel(doc.layers[1]!.cels[1]!, 0, 0)).toEqual([0, 0, 255, 255]); // the linked cel is frame 1's copy of frame 0's
    expect(doc.tags).toEqual([{ name: "walk", from: 0, to: 1, direction: "pingpong", loop: true }]);
  });
  it("hides a layer the file hides, and flattens groups (a hidden group hides its layers)", async () => {
    const one = px([9, 9, 9, 255]);
    const bytes = file(1, 1, 32, [frame(100, [layer("Hidden", { flags: 0 }), layer("Group", { type: 1, flags: 0 }), layer("Inside", { level: 1 }), cel(0, 0, 0, 1, 1, one), cel(2, 0, 0, 1, 1, one)])]);
    const { doc, warnings } = await readAseprite(bytes);
    expect(doc.layers.map((l) => [l.name, l.visible])).toEqual([["Hidden", false], ["Inside", false]]);
    expect(warnings.join(" ")).toContain("groups were flattened");
  });
  it("reads grey and indexed colour files", async () => {
    const grey = await readAseprite(file(2, 1, 16, [frame(100, [layer("L"), cel(0, 0, 0, 2, 1, [10, 255, 200, 128])])]));
    expect(getPixel(grey.doc.layers[0]!.cels[0]!, 0, 0)).toEqual([10, 10, 10, 255]);
    expect(getPixel(grey.doc.layers[0]!.cels[0]!, 1, 0)).toEqual([200, 200, 200, 128]);
    // palette chunk: 2 colours; index 0 is the transparent one
    const pal = chunk(0x2019, [...u32(2), ...u32(0), ...u32(1), ...new Array(8).fill(0), ...u16(0), 1, 2, 3, 255, ...u16(0), 40, 50, 60, 255]);
    const indexed = await readAseprite(file(2, 1, 8, [frame(100, [layer("L"), pal, cel(0, 0, 0, 2, 1, [0, 1])])]));
    expect(getPixel(indexed.doc.layers[0]!.cels[0]!, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(getPixel(indexed.doc.layers[0]!.cels[0]!, 1, 0)).toEqual([40, 50, 60, 255]);
  });
  it("says what is wrong with a file that is not one, is too short, or has nothing to draw", async () => {
    await expect(readAseprite(new Uint8Array(200))).rejects.toThrow(/not an Aseprite file/);
    await expect(readAseprite(new Uint8Array(20))).rejects.toThrow(/too short/);
    await expect(readAseprite(file(1, 1, 32, [frame(100, [layer("L", { type: 1 })])]))).rejects.toThrow(/no picture layers/);
  });
});
