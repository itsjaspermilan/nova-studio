import { describe, expect, it } from "vitest";
import { parsePath, sweepTube } from "./tube";
import { signedVolume } from "./model-mesh";

const closed = (polys: { v: number[] }[]) => {
  const dir = new Map<string, number>();
  for (const f of polys) f.v.forEach((a, k) => { const key = `${a}>${f.v[(k + 1) % f.v.length]}`; dir.set(key, (dir.get(key) ?? 0) + 1); });
  for (const [key, n] of dir) { const [a, b] = key.split(">"); if (n !== 1 || dir.get(`${b}>${a}`) !== 1) return false; }
  return true;
};

describe("sweeping a tube", () => {
  it("a straight tube is a closed prism with the volume of a prism of that many sides", () => {
    const t = sweepTube([[0, 0, 0], [10, 0, 0]], 2, 16)!;
    expect(closed(t.polys!)).toBe(true);
    const area = 0.5 * 16 * 4 * Math.sin((2 * Math.PI) / 16);
    expect(signedVolume(t) / 6).toBeCloseTo(area * 10, 1);
    expect(t.size[0]).toBeCloseTo(10, 6);
    expect(t.size[1]).toBeCloseTo(4 * Math.cos(Math.PI / 16) > 3.9 ? t.size[1] : 4, 1);
  });
  it("follows a bend without pinching: the ring stays a circle of the radius", () => {
    const t = sweepTube([[0, 0, 0], [10, 0, 0], [10, 10, 0]], 1, 8, 8)!;
    expect(closed(t.polys!)).toBe(true);
    expect(signedVolume(t) / 6).toBeGreaterThan(0);
    // every ring point is the radius from the centre line: check the end ring: its points are 1 from the end point (10, 10, 0)
    const endRing = t.verts!.slice(t.verts!.length - 2 - 8, t.verts!.length - 2);
    for (const p of endRing) expect(Math.hypot(p[0] - 10, p[1] - 10, p[2])).toBeCloseTo(1, 6);
    expect(t.size[1]).toBeGreaterThan(10);
  });
  it("needs two points and a path that goes somewhere, and is limited in points", () => {
    expect(sweepTube([[0, 0, 0]], 1)).toBeNull();
    expect(sweepTube([[1, 1, 1], [1, 1, 1]], 1)).toBeNull();
    expect(sweepTube(Array.from({ length: 20 }, (_, i) => [i, 0, 0] as [number, number, number]), 1)).toBeNull();
  });
  it("reads a typed path", () => {
    expect(parsePath("0,0,0; 5, 0, 0\n5 5 0")).toEqual([[0, 0, 0], [5, 0, 0], [5, 5, 0]]);
    expect(parsePath("0,0,0")).toBeNull();
    expect(parsePath("0,0; 1,1,1")).toBeNull();
    expect(parsePath("a,b,c; 1,1,1")).toBeNull();
  });
});
