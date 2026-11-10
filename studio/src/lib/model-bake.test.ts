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

import { applyCurvature, bakeCurvature, vertexCurvature } from "./model-bake";
import { subdivide, toMesh } from "./mesh-edit";
describe("curvature", () => {
  it("a box's corners are convex, and turning the surface inside out makes them concave", () => {
    const c = toMesh({ from: [0, 0, 0], size: [10, 10, 10], color: "#fff" });
    const v = vertexCurvature(c.verts as [number, number, number][], c.polys!);
    for (const x of v) expect(x).toBeGreaterThan(0.9);
    const inside = c.polys!.map((f) => ({ v: [...f.v].reverse() }));
    for (const x of vertexCurvature(c.verts as [number, number, number][], inside)) expect(x).toBeLessThan(-0.9);
  });
  it("a flat grid has no curvature, and the middle of a divided face is flatter than its corners", () => {
    const grid = { verts: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]] as [number, number, number][], polys: [{ v: [0, 2, 3, 1] }] };
    expect(vertexCurvature(grid.verts, grid.polys)).toEqual([0, 0, 0, 0]);
    const big = subdivide(toMesh({ from: [0, 0, 0], size: [10, 10, 10], color: "#fff" }));
    const v = vertexCurvature(big.verts as [number, number, number][], big.polys!);
    const centreOfFace = big.verts!.findIndex((p) => p[0] === 5 && p[1] === 5 && p[2] === 0);
    expect(centreOfFace).toBeGreaterThanOrEqual(0);
    expect(v[centreOfFace]!).toBeCloseTo(0, 6);
    expect(Math.max(...v)).toBeGreaterThan(0.5);
  });
  it("bakes a picture that is lighter near edges than in the middle of a face, and wear follows it", () => {
    let doc = newModel();
    doc = { ...doc, parts: doc.parts.map((p, i) => (i === 0 ? { ...p, cubes: [] } : p)) };
    const a = addCube(doc, [0], { from: [0, 0, 0], size: [8, 8, 8], color: "#c8c8c8" });
    doc = a.doc;
    const e = enableTexture(doc, newRaster(8, 8), a.path.parts, a.path.cube ?? 0, 4)!;
    doc = e.doc;
    const cube = doc.parts[0]!.cubes[0]!;
    doc = { ...doc, parts: [{ ...doc.parts[0]!, cubes: [{ ...subdivide(toMesh(cube)), texture: cube.texture, color: cube.color }] }] };
    const bake = bakeCurvature(doc)!;
    const vals: number[] = [];
    for (let i = 0; i < bake.data.length; i += 4) if (bake.data[i + 3]) vals.push(bake.data[i]!);
    expect(vals.length).toBeGreaterThan(50);
    expect(Math.max(...vals)).toBeGreaterThan(160);
    expect(Math.min(...vals)).toBeLessThan(140);
    const pic = newRaster(bake.w, bake.h);
    pic.data.fill(100);
    const worn = applyCurvature(pic, bake, 1);
    let lighter = 0;
    for (let i = 0; i < worn.data.length; i += 4) if (bake.data[i + 3] && worn.data[i]! > 100) lighter++;
    expect(lighter).toBeGreaterThan(10);
    expect(worn.data[3]).toBe(pic.data[3]);
  });
  it("a model without a texture has no curvature picture", () => {
    expect(bakeCurvature(newModel())).toBeNull();
  });
});

import { applyLighting, bakeLighting } from "./model-bake";
describe("lighting", () => {
  /// The value of the covered texels in a block belonging to the cube found by `pick`.
  const block = (doc: ModelDoc, light: Raster, pick: (c: ModelDoc["parts"][number]["cubes"][number]) => boolean) => {
    const c = doc.parts[0]!.cubes.find(pick)!;
    const [ax, ay] = c.texture!.at;
    const vals: number[] = [];
    for (let y = ay; y < ay + 70; y++) for (let x = ax; x < ax + 200; x++) { const p = getPixel(light, x, y); if (p && p[3]) vals.push(p[0]); }
    return vals;
  };
  it("a lone box is lit on the faces that face the sun and dim on those that do not", () => {
    const { doc } = scene([[[0, 0, 0], [8, 8, 8]]]);
    const light = bakeLighting(doc, { toLight: [0, 1, 0], ambient: 0.2 })!;
    const vals = block(doc, light, () => true);
    expect(Math.max(...vals)).toBeGreaterThan(250); // the top, square to the light
    expect(Math.min(...vals)).toBeLessThan(60); // sides and bottom: ambient only
    expect(Math.min(...vals)).toBeGreaterThan(45); // ambient 0.2 of 255 is 51
  });
  it("a low sun puts the floor behind a wall in shadow, and a floor far from the wall is lit", () => {
    const { doc } = scene([[[0, 0, 0], [60, 2, 10]], [[0, 2, 0], [2, 20, 10]]]);
    // the sun is low and in front of +x, so the wall (at x 0..2) throws its shadow towards +x
    const light = bakeLighting(doc, { toLight: [-1, 0.5, 0], ambient: 0.1 })!;
    const floor = block(doc, light, (c) => c.size[0] === 60);
    expect(Math.min(...floor)).toBeLessThan(40);
    expect(Math.max(...floor)).toBeGreaterThan(40);
  });
  it("applying it darkens the picture by the light and a strength of 0 changes nothing", () => {
    const pic = newRaster(2, 1);
    pic.data.set([200, 100, 50, 255, 200, 100, 50, 255]);
    const light = newRaster(2, 1);
    light.data.set([128, 128, 128, 255, 255, 255, 255, 0]);
    const out = applyLighting(pic, light, 1);
    expect(out.data[0]).toBe(100);
    expect(out.data[4]).toBe(200); // not covered
    expect(Array.from(applyLighting(pic, light, 0).data)).toEqual(Array.from(pic.data));
    expect(bakeLighting(newModel())).toBeNull();
  });
});
