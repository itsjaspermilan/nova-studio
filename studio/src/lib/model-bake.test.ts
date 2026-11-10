import { describe, expect, it } from "vitest";
import { applyOcclusion, bakeOcclusion, hemisphere } from "./model-bake";
import { addCube, newModel, type ModelDoc } from "./model-doc";
import { enableTexture } from "./model-uv";
import { getPixel, newRaster, type Raster } from "./pixels";

/// A model with every box of the list textured: [from, size].
function scene(boxes: [[number, number, number], [number, number, number]][]): { doc: ModelDoc; picture: Raster } {
  let doc = newModel();
  doc = { ...doc, parts: doc.parts.map((p, i) => (i === 0 ? { ...p, cubes: [] } : p)) };
  let picture: Raster = newRaster(8, 8);
  boxes.forEach(([from, size]) => {
    const a = addCube(doc, [0], { from, size, color: "#c8c8c8" });
    doc = a.doc;
    const r = enableTexture(doc, picture, a.path.parts, a.path.cube ?? 0, 4)!;
    doc = r.doc;
    picture = r.picture;
  });
  return { doc, picture };
}
/// The mean openness of the covered texels in a texture rectangle.
const mean = (ao: Raster, x0: number, y0: number, w: number, h: number) => {
  let sum = 0, n = 0;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const p = getPixel(ao, x, y);
    if (p && p[3]) { sum += p[0]; n++; }
  }
  return n ? sum / n / 255 : NaN;
};

describe("ambient occlusion baking", () => {
  it("the rays cover the hemisphere evenly and point upwards", () => {
    const d = hemisphere(64);
    expect(d.length).toBe(64);
    for (const v of d) {
      expect(Math.hypot(...v)).toBeCloseTo(1, 6);
      expect(v[2]).toBeGreaterThanOrEqual(0);
    }
    expect(d.reduce((s, v) => s + v[2], 0) / 64).toBeGreaterThan(0.5); // cosine weighted: more near the pole
    expect(hemisphere(8)).toEqual(hemisphere(8));
  });
  it("a lone box is open everywhere", () => {
    const { doc } = scene([[[0, 0, 0], [8, 8, 8]]]);
    const ao = bakeOcclusion(doc, { samples: 16, distance: 20 })!;
    expect(ao.w).toBe(doc.texture!.size[0]);
    let covered = 0;
    for (let i = 3; i < ao.data.length; i += 4) if (ao.data[i]) { covered++; expect(ao.data[i - 3]).toBeGreaterThan(240); }
    expect(covered).toBeGreaterThan(100);
  });
  it("the floor beside a wall is darker than the floor far from it", () => {
    // a thin floor slab 40 long with a tall wall standing on one end
    const { doc } = scene([[[0, 0, 0], [40, 2, 8]], [[0, 2, 0], [2, 20, 8]]]);
    const floorTop = (ao: Raster) => {
      // find the top face texels of the floor: the first cube's block, which block holds both x extremes
      const vals: { x: number; v: number }[] = [];
      const c = doc.parts[0]!.cubes.find((x) => x.size[0] === 40)!;
      const [ax, ay] = c.texture!.at;
      for (let y = ay; y < ay + 20; y++) for (let x = ax; x < ax + 200; x++) {
        const p = getPixel(ao, x, y);
        if (p && p[3]) vals.push({ x, v: p[0] });
      }
      return vals;
    };
    const ao = bakeOcclusion(doc, { samples: 32, distance: 14 })!;
    const all = floorTop(ao);
    expect(all.length).toBeGreaterThan(50);
    // the floor's darkest texels are near the wall; its brightest are open
    const min = Math.min(...all.map((p) => p.v));
    const max = Math.max(...all.map((p) => p.v));
    expect(max - min).toBeGreaterThan(40);
  });
  it("a crevice between two close boxes is darker than the outside faces", () => {
    const { doc } = scene([[[0, 0, 0], [8, 8, 8]], [[9, 0, 0], [8, 8, 8]]]); // a one-unit gap
    const ao = bakeOcclusion(doc, { samples: 32, distance: 10 })!;
    const left = doc.parts[0]!.cubes.find((c) => c.from[0] === 0)!;
    const right = doc.parts[0]!.cubes.find((c) => c.from[0] === 9)!;
    const avg = (c: typeof left) => {
      const [ax, ay] = c.texture!.at;
      return mean(ao, ax, ay, 200, 70);
    };
    expect(avg(left)).toBeLessThan(0.99);
    expect(avg(left)).toBeGreaterThan(0.2);
    expect(avg(right)).toBeLessThan(0.99);
  });
  it("applying the bake darkens the picture where it is enclosed and leaves open texels and uncovered ones alone", () => {
    const pic = newRaster(2, 1);
    pic.data.set([200, 100, 50, 255, 200, 100, 50, 255]);
    const ao = newRaster(2, 1);
    ao.data.set([0, 0, 0, 255, 255, 255, 255, 0]); // texel 0: fully closed; texel 1: not covered
    const out = applyOcclusion(pic, ao, 1);
    expect(Array.from(out.data.slice(0, 3))).toEqual([0, 0, 0]);
    expect(Array.from(out.data.slice(4, 7))).toEqual([200, 100, 50]);
    expect(Array.from(applyOcclusion(pic, ao, 0.5).data.slice(0, 3))).toEqual([100, 50, 25]);
    expect(Array.from(pic.data.slice(0, 3))).toEqual([200, 100, 50]); // the source is not changed
  });
  it("a model without a texture has nothing to bake", () => {
    expect(bakeOcclusion(newModel())).toBeNull();
  });
});
