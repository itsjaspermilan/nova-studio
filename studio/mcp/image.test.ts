// image_make: smooth pictures from shapes, the same bytes every time, at several sizes, over or from other pictures.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { releaseBinary, stableBinary } from "./binaries";
import { decodePng } from "./draw";
import { encode, makeImage, parseColor } from "./image";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nova-image-"));
  mkdirSync(join(dir, "sprites"), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const bin = stableBinary(releaseBinary(resolve(dirname(fileURLToPath(import.meta.url)), "../.."), "nova"));
const make = (a: Record<string, unknown>) => makeImage(dir, a, existsSync(bin) ? bin : null);
const px = (r: { w: number; data: Uint8ClampedArray }, x: number, y: number) => Array.from(r.data.subarray((y * r.w + x) * 4, (y * r.w + x) * 4 + 4));

describe("image_make", () => {
  it("draws a smooth circle: solid inside, see-through outside, part-covered on its edge", () => {
    const { picture, files } = make({ name: "dot", size: [32, 32], shapes: [{ circle: [16, 16, 10], fill: "#ff0000" }] });
    expect(files.map((f) => f[0])).toEqual(["sprites/dot.png"]);
    expect(px(picture, 16, 16)).toEqual([255, 0, 0, 255]);
    expect(px(picture, 1, 1)[3]).toBe(0);
    const edge = [...Array(32).keys()].map((x) => px(picture, x, 16)[3]!).filter((a) => a > 0 && a < 255);
    expect(edge.length).toBeGreaterThanOrEqual(2); // anti-aliased on both sides
  });

  it("writes the same bytes for the same recipe, and each size drawn again at its own resolution", () => {
    const recipe = { name: "badge", size: [64, 32], sizes: [1, 2, [16, 8]], shapes: [{ rect: [4, 4, 56, 24], radius: 8, fill: { linear: [0, 4, 0, 28], stops: [[0, "#3a7bd5"], [1, "#1c3f7a"]] }, stroke: { color: "#fff", width: 2, align: "inside" } }] };
    const a = make(recipe), b = make(recipe);
    expect(a.files.map((f) => f[0])).toEqual(["sprites/badge.png", "sprites/badge_128x64.png", "sprites/badge_16x8.png"]);
    for (const [i, [, bytes]] of a.files.entries()) expect(Buffer.from(bytes).equals(Buffer.from(b.files[i]![1]))).toBe(true);
    const big = decodePng(a.files[1]![1]);
    expect([big.w, big.h]).toEqual([128, 64]);
    // the gradient: lighter at the top than at the foot; the stroke white along the inside of the edge
    expect(px(big, 64, 12)[2]!).toBeGreaterThan(px(big, 64, 46)[2]!);
    expect(px(big, 64, 9)).toEqual([255, 255, 255, 255]);
    expect(() => make({ ...recipe, sizes: [[20, 20]] })).toThrow(/not the shape of 64x32/);
  });

  it("cuts out, keeps the overlap, strokes, fades, and lays a soft shadow and a glow", () => {
    const { picture } = make({
      name: "moon", size: [64, 64], shapes: [
        { circle: [32, 32, 20], fill: "#ffffff", minus: [{ circle: [42, 28, 16] }], shadow: { offset: [0, 6], blur: 4, color: "#000000ff" } },
        { rect: [0, 0, 64, 64], fill: "#00ff00", both: [{ circle: [8, 56, 6] }], opacity: 0.5 },
        { ring: [50, 50, 8, 2], fill: "#0000ff", glow: { blur: 6, color: "#0000ff" } },
      ],
    });
    expect(px(picture, 20, 32)).toEqual([255, 255, 255, 255]); // the moon
    expect(px(picture, 44, 28)[3]).toBeLessThan(255); // the bite is cut out (the shadow may show)
    expect(px(picture, 20, 55)[3]).toBeGreaterThan(30); // the shadow under it, soft
    expect(px(picture, 8, 56)[1]).toBe(255); // the half-faded green disc
    expect(px(picture, 8, 56)[3]).toBe(128);
    expect(px(picture, 50, 50)[2]).toBeGreaterThan(0); // the glow inside the ring
  });

  it("places, crops, scales and tints a picture, starts from one, and crops the result", () => {
    // a 4x4 picture: the left half red, the right half blue
    const src = { w: 4, h: 4, data: new Uint8ClampedArray(64) };
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) src.data.set(x < 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * 4 + x) * 4);
    writeFileSync(join(dir, "sprites/src.png"), encode(src));
    const placed = make({ name: "big", size: [40, 40], shapes: [{ image: "sprites/src.png", at: [0, 0], size: [40, 40], filter: "nearest" }, { image: "sprites/src.png", crop: [2, 0, 2, 4], at: [0, 30], size: [10, 10], tint: "#808080" }] }).picture;
    expect(px(placed, 5, 5)).toEqual([255, 0, 0, 255]);
    expect(px(placed, 35, 5)).toEqual([0, 0, 255, 255]);
    expect(px(placed, 5, 35)).toEqual([0, 0, 128, 255]); // the right half, tinted grey
    const smooth = make({ name: "smooth", size: [40, 40], shapes: [{ image: "sprites/src.png", size: [40, 40] }] }).picture;
    const mid = px(smooth, 20, 20);
    expect(mid[0]! > 0 && mid[2]! > 0).toBe(true); // blended across the middle
    const based = make({ name: "framed", base: "sprites/src.png", size: [4, 4], shapes: [{ rect: [0, 0, 4, 2], fill: "#00000080", blend: "normal" }], crop: [0, 2, 4, 2] }).picture;
    expect([based.w, based.h]).toEqual([4, 2]);
    expect(px(based, 0, 0)).toEqual([255, 0, 0, 255]); // the bottom half, not darkened
    expect(() => make({ name: "x", size: [8, 8], shapes: [{ image: "sprites/nope.png" }] })).toThrow(/no sprites\/nope.png in the project/);
  });

  it("draws curves and strokes with ends and widths, and refuses what it does not know, naming what it takes", () => {
    const { picture } = make({ name: "path", size: [64, 64], shapes: [{ path: "M 8 8 L 56 8 Q 64 32 56 56 L 8 56 Z", fill: "#ffffff" }, { line: [[8, 32], [56, 32]], width: 6, width_end: 2, cap: "butt", fill: "#000000" }] });
    expect(px(picture, 20, 20)).toEqual([255, 255, 255, 255]);
    expect(px(picture, 10, 32)).toEqual([0, 0, 0, 255]);
    expect(px(picture, 6, 32)).toEqual([0, 0, 0, 0]); // a butt end stops at the point (outside the white too)
    expect(() => make({ name: "x", size: [8, 8], shapes: [{ circel: [1, 1, 1] }] })).toThrow(/`circel` is not an option of a shape/);
    expect(() => make({ name: "x", size: [8, 8], shapes: [{ fill: "#fff" }] })).toThrow(/has none of circle, ellipse, rect/);
    expect(() => make({ name: "x", size: [8, 8], colour: 1, shapes: [] })).toThrow(/`colour` is not an option of image_make/);
    expect(() => make({ name: "../x", size: [8, 8], shapes: [] })).toThrow(/"name" is the picture's name under sprites/);
    expect(parseColor({ color: "#808080", shade: 0.5 })).toEqual([191.5, 191.5, 191.5, 1]);
    expect(parseColor("#ff000080")[3]).toBeCloseTo(128 / 255);
  });

  it.skipIf(!existsSync(bin))("writes text in the game's own fonts, with an outline that has room round it", () => {
    const { picture } = make({ name: "title", size: [160, 48], shapes: [{ text: "PINE", at: [80, 36], size: 32, font: "comic", align: "center", fill: "#ffd54a", stroke: { color: "#000000", width: 3, align: "outside" } }] });
    const inked = [...Array(160 * 48).keys()].filter((i) => picture.data[i * 4 + 3]! > 200).length;
    expect(inked).toBeGreaterThan(400);
    // the words sit in the middle (centred on x 80)
    let left = 160, right = 0;
    for (let y = 0; y < 48; y++) for (let x = 0; x < 160; x++) if (picture.data[(y * 160 + x) * 4 + 3]! > 128) (left = Math.min(left, x), (right = Math.max(right, x)));
    expect(Math.abs((left + right) / 2 - 80)).toBeLessThan(4);
    const black = [...Array(160 * 48).keys()].filter((i) => picture.data[i * 4 + 3]! > 200 && picture.data[i * 4]! < 40).length;
    expect(black).toBeGreaterThan(100); // the outline
    expect(() => make({ name: "t", size: [32, 32], shapes: [{ text: "a", font: "nope" }] })).toThrow(/no font 'nope'/);
  });
});

describe("the logos script draws through image_make", () => {
  it("has no PNG writer or rasteriser of its own", () => {
    const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../scripts/rally/logos.mjs"), "utf8");
    expect(src).toContain('nova.call("image_make"');
    expect(src).not.toMatch(/deflateSync|crc32/);
  });
});
