import { describe, expect, it } from "vitest";
import { getPixel, newRaster, setPixel, type Raster, type Rgba } from "./pixels";
import { newDoc, recompose } from "./sprite-doc";
import { DEFAULT_PROFILE, atlasJson, checkProfile, cropRaster, framePieces, layerPieces, packSheet, safeName, scaleUp, trimBounds } from "./sprite-export";

const RED: Rgba = [255, 0, 0, 255];
const BLUE: Rgba = [0, 0, 255, 255];
const dot = (w: number, h: number, x: number, y: number, c: Rgba): Raster => {
  const r = newRaster(w, h);
  setPixel(r, x, y, c);
  return r;
};

describe("trimming and scaling", () => {
  it("finds the box round the visible pixels, and says nothing for an empty picture", () => {
    const r = newRaster(10, 10);
    setPixel(r, 3, 2, RED);
    setPixel(r, 6, 7, RED);
    expect(trimBounds(r)).toEqual({ x: 3, y: 2, w: 4, h: 6 });
    expect(trimBounds(newRaster(4, 4))).toBeNull();
    expect(cropRaster(r, { x: 3, y: 2, w: 4, h: 6 }).w).toBe(4);
    expect(getPixel(cropRaster(r, { x: 3, y: 2, w: 4, h: 6 }), 3, 5)).toEqual(RED);
  });
  it("enlarges by a whole number", () => {
    const big = scaleUp(dot(2, 2, 1, 0, RED), 3);
    expect([big.w, big.h]).toEqual([6, 6]);
    expect(getPixel(big, 5, 2)).toEqual(RED);
    expect(getPixel(big, 2, 2)).toEqual([0, 0, 0, 0]);
  });
  it("makes names that are safe in a file", () => {
    expect(safeName("Hero walk!")).toBe("Hero_walk");
    expect(safeName("???")).toBe("sprite");
  });
});

describe("pieces", () => {
  const doc = newDoc(4, 4, 3);
  doc.tags = [{ name: "walk", from: 0, to: 1, direction: "forward", loop: true }, { name: "jump", from: 2, to: 2, direction: "forward", loop: true }];
  doc.layers[0]!.cels[0] = dot(4, 4, 0, 0, RED);
  doc.layers[0]!.cels[2] = dot(4, 4, 3, 3, BLUE);
  doc.layers.push({ name: "Shadow", visible: true, opacity: 1, cels: [newRaster(4, 4), newRaster(4, 4), newRaster(4, 4)] });
  for (let f = 0; f < 3; f++) recompose(doc, f);
  it("names the frames after their animation, counting from 1", () => {
    expect(framePieces(doc, "Hero").map((p) => p.name)).toEqual(["Hero_walk_1", "Hero_walk_2", "Hero_jump_1"]);
  });
  it("makes a piece for every layer and frame", () => {
    expect(layerPieces(doc, "Hero").map((p) => p.name)).toEqual(["Hero_Layer_1_1", "Hero_Layer_1_2", "Hero_Layer_1_3", "Hero_Shadow_1", "Hero_Shadow_2", "Hero_Shadow_3"]);
  });
});

describe("packing a sheet", () => {
  const pieces = [
    { name: "a", raster: dot(8, 8, 2, 2, RED) },
    { name: "b", raster: dot(8, 8, 5, 6, BLUE) },
    { name: "same", raster: dot(8, 8, 2, 2, RED) },
  ];
  it("trims the empty edges, keeps where each came from, and stores identical pictures once", () => {
    const p = packSheet(pieces, { padding: 1 })!;
    expect(p.atlas.frames.a).toMatchObject({ w: 1, h: 1, sourceX: 2, sourceY: 2, sourceW: 8, sourceH: 8, trimmed: true });
    expect(p.atlas.frames.same!.x).toBe(p.atlas.frames.a!.x);
    expect(p.atlas.frames.b!.x === p.atlas.frames.a!.x && p.atlas.frames.b!.y === p.atlas.frames.a!.y).toBe(false);
    const a = p.atlas.frames.a!;
    expect(getPixel(p.sheet, a.x, a.y)).toEqual(RED);
    const b = p.atlas.frames.b!;
    expect(getPixel(p.sheet, b.x, b.y)).toEqual(BLUE);
  });
  it("can leave the pieces whole, scale them, and round the sheet up to powers of two", () => {
    const whole = packSheet(pieces, { trim: false, padding: 0 })!;
    expect(whole.atlas.frames.a).toMatchObject({ w: 8, h: 8, trimmed: false });
    const big = packSheet(pieces, { scale: 2, padding: 0 })!;
    expect(big.atlas.frames.a).toMatchObject({ w: 2, h: 2, sourceW: 16 });
    const p2 = packSheet(pieces, { powerOfTwo: true, padding: 1 })!;
    expect(Math.log2(p2.sheet.w) % 1).toBe(0);
    expect(Math.log2(p2.sheet.h) % 1).toBe(0);
  });
  it("starts a new row when the width is used up, and says no when a piece cannot fit", () => {
    const wide = Array.from({ length: 6 }, (_, i) => ({ name: `p${i}`, raster: dot(10, 4, 0, 0, [i * 40, 0, 0, 255] as Rgba) }));
    const p = packSheet(wide, { trim: false, padding: 0, maxWidth: 30 })!;
    expect(p.sheet.w).toBeLessThanOrEqual(30);
    expect(new Set(Object.values(p.atlas.frames).map((f) => f.y)).size).toBe(2);
    expect(packSheet([{ name: "huge", raster: newRaster(50, 5) }], { trim: false, maxWidth: 30 })).toBeNull();
  });
  it("writes the atlas the way other tools read it, with frame times when given", () => {
    const p = packSheet(pieces, { durations: new Map([["a", 120]]) })!;
    const json = JSON.parse(atlasJson(p, "hero.png"));
    expect(json.frames.a.frame).toEqual({ x: p.atlas.frames.a!.x, y: p.atlas.frames.a!.y, w: 1, h: 1 });
    expect(json.frames.a.spriteSourceSize).toEqual({ x: 2, y: 2, w: 1, h: 1 });
    expect(json.frames.a.sourceSize).toEqual({ w: 8, h: 8 });
    expect(json.frames.a.duration).toBe(120);
    expect(json.meta.image).toBe("hero.png");
  });
});

describe("export profiles", () => {
  it("clamps what is read from a file and refuses nonsense", () => {
    expect(checkProfile({ name: "x", what: "frames", scale: 99, padding: -3 })).toEqual({ name: "x", what: "frames", scale: 16, trim: true, padding: 0, powerOfTwo: false });
    expect(checkProfile({ name: "x", what: "movie" })).toBeNull();
    expect(checkProfile(null)).toBeNull();
    expect(checkProfile(DEFAULT_PROFILE)).toEqual(DEFAULT_PROFILE);
  });
});
