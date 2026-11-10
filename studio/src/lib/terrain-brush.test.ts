import { describe, expect, it } from "vitest";
import { dab, flatGrid, gridStats, gridToPixels, stroke, TERRAIN_BRUSHES } from "./terrain-brush";
import { gridFromPixels } from "./scene-terrain";

const H = 100;
const at = (g: ReturnType<typeof flatGrid>, ix: number, iz: number) => g.heights[iz * g.w + ix]!;

describe("terrain brushes", () => {
  it("raise lifts the ground most at the centre and not at all outside the radius", () => {
    const g = flatGrid(21, 1, 0, 0, 10);
    const out = dab(g, 10, 10, { mode: "raise", radius: 4, strength: 1 }, H);
    expect(at(out, 10, 10)).toBeCloseTo(20, 6); // a tenth of the range
    expect(at(out, 12, 10)).toBeGreaterThan(10);
    expect(at(out, 12, 10)).toBeLessThan(at(out, 10, 10));
    expect(at(out, 16, 10)).toBe(10);
    expect(at(g, 10, 10)).toBe(10); // the source is untouched
  });
  it("lower mirrors raise, and heights stay inside 0 to the range", () => {
    const g = flatGrid(21, 1, 0, 0, 3);
    expect(at(dab(g, 10, 10, { mode: "lower", radius: 4, strength: 1 }, H), 10, 10)).toBe(0);
    const high = flatGrid(21, 1, 0, 0, 95);
    expect(at(dab(high, 10, 10, { mode: "raise", radius: 4, strength: 1 }, H), 10, 10)).toBe(100);
    expect(dab(g, 10, 10, { mode: "raise", radius: 4, strength: 0 }, H).heights).toEqual(g.heights);
  });
  it("flatten levels to the height at the centre, or the one asked for", () => {
    const g = flatGrid(21, 1, 0, 0, 0);
    g.heights[10 * 21 + 10] = 30;
    g.heights[10 * 21 + 11] = 50;
    const out = dab(g, 10, 10, { mode: "flatten", radius: 3, strength: 1, falloff: "constant" }, H);
    expect(at(out, 11, 10)).toBeCloseTo(30, 6);
    const to = dab(g, 10, 10, { mode: "flatten", radius: 3, strength: 1, falloff: "constant", level: 7 }, H);
    expect(at(to, 10, 10)).toBeCloseTo(7, 6);
  });
  it("smooth pulls a spike down towards its neighbours", () => {
    const g = flatGrid(21, 1, 0, 0, 0);
    g.heights[10 * 21 + 10] = 50;
    const out = dab(g, 10, 10, { mode: "smooth", radius: 2, strength: 1, falloff: "constant" }, H);
    expect(at(out, 10, 10)).toBeCloseTo(10, 6);
    expect(at(out, 11, 10)).toBeGreaterThan(0);
  });
  it("roughen adds the same bumps for the same seed and different ones for another", () => {
    const g = flatGrid(21, 1, 0, 0, 50);
    const a = dab(g, 10, 10, { mode: "roughen", radius: 4, strength: 1, seed: 3 }, H);
    const b = dab(g, 10, 10, { mode: "roughen", radius: 4, strength: 1, seed: 3 }, H);
    const c = dab(g, 10, 10, { mode: "roughen", radius: 4, strength: 1, seed: 4 }, H);
    expect(Array.from(a.heights)).toEqual(Array.from(b.heights));
    expect(Array.from(a.heights)).not.toEqual(Array.from(c.heights));
    expect(gridStats(a).max).toBeGreaterThan(50);
  });
  it("erode wears a cliff down and leaves gentle slopes alone", () => {
    const cliff = flatGrid(21, 1, 0, 0, 0);
    cliff.heights[10 * 21 + 10] = 40;
    const out = dab(cliff, 10, 10, { mode: "erode", radius: 3, strength: 1, falloff: "constant" }, H);
    expect(at(out, 10, 10)).toBeLessThan(40);
    const slope = flatGrid(21, 1, 0, 0, 0);
    for (let i = 0; i < slope.heights.length; i++) slope.heights[i] = (i % 21) * 0.2;
    expect(Array.from(dab(slope, 10, 10, { mode: "erode", radius: 3, strength: 1 }, H).heights)).toEqual(Array.from(slope.heights));
  });
  it("a stroke is several dabs along the way", () => {
    const g = flatGrid(41, 1, 0, 0, 0);
    const out = stroke(g, [5, 20], [35, 20], { mode: "raise", radius: 3, strength: 1 }, H);
    for (const x of [5, 15, 25, 35]) expect(at(out, x, 20)).toBeGreaterThan(5);
    expect(at(out, 20, 30)).toBe(0);
  });
  it("every brush runs on a grid corner without going out of range", () => {
    for (const mode of TERRAIN_BRUSHES) {
      const out = dab(flatGrid(9, 1, 0, 0, 50), 0, 0, { mode, radius: 5, strength: 1 }, H);
      expect(out.heights.every((h) => Number.isFinite(h) && h >= 0 && h <= H)).toBe(true);
    }
  });
});

describe("saving a heightmap", () => {
  it("writes pixels that read back as the same heights", () => {
    const g = flatGrid(9, 2, 5, 5, 0);
    g.heights.forEach((_, i) => (g.heights[i] = (i * 37) % 100));
    const pixels = gridToPixels(g, { height: H });
    expect(pixels.length).toBe(9 * 9 * 4);
    expect(pixels[3]).toBe(255);
    const back = gridFromPixels(pixels, 9, 9, { path: "t.png", x: 5, z: 5, cell: 2, height: H });
    expect(back.cell).toBe(2);
    for (let i = 0; i < g.heights.length; i++) expect(back.heights[i]).toBeCloseTo(g.heights[i]!, 2);
  });
  it("clamps heights to the range", () => {
    const g = flatGrid(2, 1, 0, 0, 0);
    g.heights.set([-5, 0, 100, 250]);
    const p = gridToPixels(g, { height: 100 });
    expect([p[0], p[1]]).toEqual([0, 0]);
    expect([p[8], p[9]]).toEqual([255, 255]);
    expect([p[12], p[13]]).toEqual([255, 255]);
  });
});
