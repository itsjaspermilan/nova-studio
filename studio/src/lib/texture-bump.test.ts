import { describe, expect, it } from "vitest";
import { heightToNormal } from "./texture-bump";
import { newRaster } from "./pixels";

const fill = (w: number, h: number, f: (x: number, y: number) => number) => { const r = newRaster(w, h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; r.data[i] = f(x, y); r.data[i + 3] = 255; } return r; };

describe("height to normal map", () => {
  it("a flat picture gives straight-up normals", () => {
    const n = heightToNormal(fill(4, 4, () => 200), 2);
    for (let i = 0; i < n.data.length; i += 4) expect([n.data[i], n.data[i + 1], n.data[i + 2], n.data[i + 3]]).toEqual([128, 128, 255, 255]);
  });
  it("a surface rising to the right leans left (red below half), and one rising down the picture leans up it (green above half)", () => {
    const right = heightToNormal(fill(5, 5, (x) => x * 40), 1);
    const mid = (2 * 5 + 2) * 4;
    expect(right.data[mid]).toBeLessThan(120);
    expect(right.data[mid + 1]).toBe(128);
    const down = heightToNormal(fill(5, 5, (_x, y) => y * 40), 1);
    expect(down.data[mid + 1]).toBeGreaterThan(136);
    expect(down.data[mid]).toBe(128);
  });
  it("a stronger setting leans further, and zero is flat", () => {
    const f = fill(5, 5, (x) => x * 40);
    const mid = (2 * 5 + 2) * 4;
    expect(heightToNormal(f, 3).data[mid]).toBeLessThan(heightToNormal(f, 1).data[mid]!);
    expect(heightToNormal(f, 0).data[mid]).toBe(128);
  });
});
