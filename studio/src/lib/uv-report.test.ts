import { describe, expect, it } from "vitest";
import { checkerRaster, equalizeDensity, uvReport } from "./uv-report";
import { addCube, newModel, type ModelDoc } from "./model-doc";
import { enableTexture } from "./model-uv";
import { getPixel, newRaster } from "./pixels";

function textured(boxes: { size: [number, number, number]; scale: number }[]): ModelDoc {
  let doc = newModel();
  doc = { ...doc, parts: doc.parts.map((p, i) => (i === 0 ? { ...p, cubes: [] } : p)) };
  let pic = newRaster(8, 8);
  for (const b of boxes) {
    const a = addCube(doc, [0], { from: [0, 0, 0], size: b.size, color: "#ccc" });
    const e = enableTexture(a.doc, pic, a.path.parts, a.path.cube ?? 0, b.scale)!;
    doc = e.doc;
    pic = e.picture;
  }
  return doc;
}

describe("the UV report", () => {
  it("a box at 4 texels per unit reads 4 on every face, with no stretch", () => {
    const [r] = uvReport(textured([{ size: [8, 8, 8], scale: 4 }]));
    expect(r!.density).toBeCloseTo(4, 1);
    expect(r!.densityMin).toBeCloseTo(4, 1);
    expect(r!.densityMax).toBeCloseTo(4, 1);
    expect(r!.stretch).toBeCloseTo(1, 2);
  });
  it("tells shapes with different texel scales apart", () => {
    const rs = uvReport(textured([{ size: [8, 8, 8], scale: 2 }, { size: [8, 8, 8], scale: 6 }])).map((r) => r.density).sort((a, b) => a - b);
    expect(rs[0]!).toBeCloseTo(2, 0);
    expect(rs[1]!).toBeCloseTo(6, 0);
  });
  it("equalizing sets every shape to one scale (the middle one by default, or the one asked for)", () => {
    const doc = textured([{ size: [8, 8, 8], scale: 2 }, { size: [8, 8, 8], scale: 6 }, { size: [8, 8, 8], scale: 4 }]);
    const eq = equalizeDensity(doc);
    const scales = new Set(eq.parts[0]!.cubes.map((c) => c.texture!.scale));
    expect(scales.size).toBe(1);
    expect([...scales][0]).toBeCloseTo(4, 0);
    expect([...new Set(equalizeDensity(doc, 3).parts[0]!.cubes.map((c) => c.texture!.scale))]).toEqual([3]);
    expect(equalizeDensity(newModel())).toEqual(newModel());
    expect(doc.parts[0]!.cubes.map((c) => c.texture!.scale).sort()).toEqual([2, 4, 6]); // the source is untouched
  });
  it("a shape with no texture is not in the report", () => {
    expect(uvReport(newModel())).toEqual([]);
  });
});

describe("the checker picture", () => {
  it("alternates squares and marks each square's corner", () => {
    const r = checkerRaster(32, 16, 8);
    expect(getPixel(r, 4, 4)).not.toEqual(getPixel(r, 12, 4));
    expect(getPixel(r, 4, 4)).toEqual(getPixel(r, 12, 12));
    expect(getPixel(r, 1, 0)![0]).toBeGreaterThan(200); // red across the top
    expect(getPixel(r, 0, 1)![1]).toBeGreaterThan(150); // green down the side
    expect(r.w).toBe(32);
  });
});
