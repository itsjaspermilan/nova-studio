import { describe, expect, it } from "vitest";
import { MAX_TEXT_MESH, textToMesh } from "./text-mesh";
import { signedVolume } from "./model-mesh";
import { parseModel, serializeModel, addCube, newModel } from "./model-doc";
import { exportGlb } from "./glb";

const closed = (polys: { v: number[] }[]) => {
  const dir = new Map<string, number>();
  for (const f of polys) f.v.forEach((a, k) => { const key = `${a}>${f.v[(k + 1) % f.v.length]}`; dir.set(key, (dir.get(key) ?? 0) + 1); });
  for (const [key, n] of dir) {
    const [a, b] = key.split(">");
    if (n !== 1 || dir.get(`${b}>${a}`) !== 1) return false;
  }
  return true;
};
const volume = (c: NonNullable<ReturnType<typeof textToMesh>>) => signedVolume(c) / 6;

describe("text as a mesh", () => {
  it("makes a closed, outward-wound solid whose volume is the lit pixels times the cube", () => {
    const c = textToMesh("I", 1, 2)!;
    // "I" is 0E 04 04 04 04 04 0E: 3 + 5 + 3 = 11 lit pixels, each 1 x 1 x 2
    expect(volume(c)).toBeCloseTo(22, 6);
    expect(closed(c.polys!)).toBe(true);
    expect(c.shape).toBe("mesh");
  });
  it("scales with the pixel size and the depth, and stands on y = 0 reading from +z", () => {
    const small = textToMesh("L", 1, 1)!;
    const big = textToMesh("L", 2, 3)!;
    expect(volume(big)).toBeCloseTo(volume(small) * 4 * 3, 6);
    expect(small.from[1]).toBe(0); // the baseline at the floor
    expect(small.size[1]).toBe(7); // a capital is seven pixels tall
    expect(small.size[2]).toBe(1);
    // the long bar of an L is at the bottom: the lowest row has five lit pixels, the others one
    const bottom = small.verts!.filter((p) => p[1] === 0);
    expect(Math.max(...bottom.map((p) => p[0])) - Math.min(...bottom.map((p) => p[0]))).toBe(5);
  });
  it("makes a line of letters wider, a second line taller, and nothing for empty text", () => {
    expect(textToMesh("AB")!.size[0]).toBeGreaterThan(textToMesh("A")!.size[0]);
    expect(textToMesh("A\nB")!.size[1]).toBeGreaterThan(textToMesh("A")!.size[1]);
    expect(textToMesh("   ")).toBeNull();
    expect(textToMesh("")).toBeNull();
    expect(textToMesh("x".repeat(100))!.size[0]).toBeLessThan((MAX_TEXT_MESH + 1) * 6);
  });
  it("is a shape a model can hold, save and export", () => {
    const c = textToMesh("Hi", 1, 2)!;
    const doc = addCube(newModel(), [0], c).doc;
    const back = parseModel(serializeModel(doc));
    expect(back.ok).toBe(true);
    expect(exportGlb(doc).length).toBeGreaterThan(200);
  });
});
