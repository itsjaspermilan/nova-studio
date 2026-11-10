import { describe, expect, it } from "vitest";
import { unwrap } from "./model-uv";
import { parseModel, serializeModel } from "./model-doc";
import type { Cube } from "./model-doc";

// two quads side by side facing up: points 0-1-2 along the back, 3-4-5 along the front
const plane = (): Cube => ({
  shape: "mesh", color: "#ffffff", from: [0, 0, 0], size: [0, 0, 0], texture: { at: [0, 0] },
  verts: [[0, 0, 0], [8, 0, 0], [16, 0, 0], [0, 0, 8], [8, 0, 8], [16, 0, 8]],
  polys: [{ v: [0, 3, 4, 1] }, { v: [1, 4, 5, 2] }],
} as Cube);
const gap = (c: Cube) => {
  const u = unwrap(c);
  const xs = u.polys.map((p) => p.map((q) => q[0]));
  return Math.min(...xs[1]!) - Math.max(...xs[0]!);
};

describe("UV seams", () => {
  it("without a seam two joined quads stay side by side with no gap; a seam between them splits them into two islands", () => {
    const joined = gap(plane());
    const cut = gap({ ...plane(), seams: [[1, 4]] });
    expect(Math.abs(joined)).toBeLessThan(1e-6);
    expect(Math.abs(cut)).toBeGreaterThan(0.5);
  });
  it("round-trips through the model file and rejects a seam at a point that is not there", () => {
    const doc = { version: 1 as const, scale: 1, texture: { size: [32, 32] as [number, number] }, parts: [{ name: "a", origin: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], children: [], cubes: [{ ...plane(), seams: [[1, 4]] as [number, number][] }] }] };
    const again = parseModel(serializeModel(doc as never));
    if (!again.ok) throw new Error(again.error);
    expect(again.doc.parts[0]!.cubes[0]!.seams).toEqual([[1, 4]]);
    const bad = serializeModel({ ...doc, parts: [{ ...doc.parts[0]!, cubes: [{ ...plane(), seams: [[1, 9]] as [number, number][] }] }] } as never);
    expect(parseModel(bad).ok).toBe(false);
  });
});

import { moveIsland } from "./model-uv";
describe("moving a UV island by hand", () => {
  it("puts the island where it is told, grows the block to hold it, and puts it back with null", () => {
    const base = { ...plane(), seams: [[1, 4]] as [number, number][] };
    const u0 = unwrap(base);
    expect(u0.islands!.length).toBe(2);
    const second = u0.islands![1]!;
    const moved = moveIsland(base, second.poly, [40, 20]);
    const u1 = unwrap(moved);
    const it = u1.islands!.find((i) => i.poly === second.poly)!;
    expect([it.x, it.y]).toEqual([40, 20]);
    expect(u1.size[0]).toBeGreaterThanOrEqual(40 + it.w);
    expect(u1.size[1]).toBeGreaterThanOrEqual(20 + it.h);
    // the other island did not move
    const other = u1.islands!.find((i) => i.poly !== second.poly)!;
    const was = u0.islands!.find((i) => i.poly !== second.poly)!;
    expect([other.x, other.y]).toEqual([was.x, was.y]);
    expect(unwrap(moveIsland(moved, second.poly, null)).islands).toEqual(u0.islands);
  });
  it("round-trips through the model file", () => {
    const c = moveIsland({ ...plane(), seams: [[1, 4]] as [number, number][] }, 1, [8, 3]);
    const doc = { version: 1 as const, scale: 1, texture: { size: [32, 32] as [number, number] }, parts: [{ name: "a", origin: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], children: [], cubes: [c] }] };
    const again = parseModel(serializeModel(doc as never));
    if (!again.ok) throw new Error(again.error);
    expect(again.doc.parts[0]!.cubes[0]!.texture!.islands).toEqual([{ poly: 1, at: [8, 3] }]);
  });
});
