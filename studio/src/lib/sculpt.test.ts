import { describe, expect, it } from "vitest";
import { toMesh } from "./mesh-edit";
import { SCULPT_MODES, pointsUnder, sculptDab, vertexNormals } from "./sculpt";
import { type Cube } from "./model-doc";

/// A box finely divided (smooth subdivision makes a round blob, so use a flat grid instead): a 11 by 11 flat sheet in the x-z plane facing +y.
function sheet(): Cube {
  const verts: [number, number, number][] = [];
  const polys: { v: number[] }[] = [];
  for (let z = 0; z <= 10; z++) for (let x = 0; x <= 10; x++) verts.push([x - 5, 0, z - 5]);
  for (let z = 0; z < 10; z++) for (let x = 0; x < 10; x++) {
    const a = z * 11 + x;
    polys.push({ v: [a, a + 11, a + 12, a + 1] });
  }
  return { shape: "mesh", from: [-5, 0, -5], size: [10, 0, 10], color: "#c9d1d9", verts, polys } as Cube;
}
const heightAt = (c: Cube, x: number, z: number) => c.verts![(z + 5) * 11 + (x + 5)]![1];

describe("sculpting", () => {
  it("knows which way the sheet faces", () => {
    const n = vertexNormals(sheet());
    expect(Math.abs(n[60]![1])).toBeCloseTo(1, 9);
  });
  it("draw pushes the surface along its normal, most at the centre and not at all outside the radius", () => {
    const s = sheet();
    const sign = vertexNormals(s)[60]![1] > 0 ? 1 : -1;
    const out = sculptDab(s, [0, 0, 0], { mode: "draw", radius: 3, strength: 1 });
    expect(heightAt(out, 0, 0) * sign).toBeGreaterThan(0);
    expect(Math.abs(heightAt(out, 0, 0))).toBeGreaterThan(Math.abs(heightAt(out, 2, 0)));
    expect(heightAt(out, 4, 4)).toBe(0);
    expect(heightAt(s, 0, 0)).toBe(0); // the source is untouched
    const inv = sculptDab(s, [0, 0, 0], { mode: "draw", radius: 3, strength: 1, invert: true });
    expect(heightAt(inv, 0, 0)).toBeCloseTo(-heightAt(out, 0, 0), 9);
  });
  it("strength scales the dab and zero does nothing", () => {
    const s = sheet();
    const a = Math.abs(heightAt(sculptDab(s, [0, 0, 0], { mode: "inflate", radius: 3, strength: 1 }), 0, 0));
    const b = Math.abs(heightAt(sculptDab(s, [0, 0, 0], { mode: "inflate", radius: 3, strength: 0.5 }), 0, 0));
    expect(b).toBeCloseTo(a / 2, 9);
    expect(sculptDab(s, [0, 0, 0], { mode: "inflate", radius: 3, strength: 0 }).verts).toEqual(s.verts);
  });
  it("smooth flattens a bump towards its neighbours", () => {
    const s = sheet();
    s.verts![60] = [0, 2, 0];
    const out = sculptDab(s, [0, 0, 0], { mode: "smooth", radius: 3, strength: 1 });
    expect(heightAt(out, 0, 0)).toBeLessThan(2);
    expect(heightAt(out, 0, 0)).toBeGreaterThanOrEqual(0);
    expect(heightAt(out, 1, 0)).toBeGreaterThan(0); // a neighbour took some of it
  });
  it("flatten presses points onto the plane under the brush", () => {
    const s = sheet();
    s.verts![60] = [0, 1, 0];
    s.verts![61] = [1, -1, 0];
    const spread = (c: Cube) => Math.max(...[60, 61, 59].map((i) => Math.abs(c.verts![i]![1] - 0)));
    const out = sculptDab(s, [0, 0, 0], { mode: "flatten", radius: 2.5, strength: 1, falloff: "constant" });
    expect(spread(out)).toBeLessThan(spread(s));
  });
  it("pinch draws points towards the centre and grab drags them with the pointer", () => {
    const s = sheet();
    const p = sculptDab(s, [0, 0, 0], { mode: "pinch", radius: 3, strength: 1 });
    expect(Math.abs(p.verts![62]![0])).toBeLessThan(Math.abs(s.verts![62]![0]));
    const g = sculptDab(s, [0, 0, 0], { mode: "grab", radius: 3, strength: 1 }, [0, 0, 1]);
    expect(g.verts![60]![2]).toBeGreaterThan(0);
    expect(g.verts![0]![2]).toBe(-5);
  });
  it("symmetry makes the same dab on the other side of x = 0", () => {
    const out = sculptDab(sheet(), [-2, 0, 0], { mode: "inflate", radius: 1.5, strength: 1, symmetryX: true });
    expect(heightAt(out, -2, 0)).not.toBe(0);
    expect(heightAt(out, 2, 0)).toBeCloseTo(heightAt(out, -2, 0), 9);
    const grab = sculptDab(sheet(), [-2, 0, 0], { mode: "grab", radius: 1.5, strength: 1, symmetryX: true }, [1, 0, 0]);
    expect(grab.verts![60 - 2]![0]).toBeGreaterThan(-2);
    expect(grab.verts![60 + 2]![0]).toBeLessThan(2); // mirrored: moved the other way
  });
  it("turns a box into a mesh first, and every brush runs", () => {
    const box: Cube = { from: [0, 0, 0], size: [4, 4, 4], color: "#c9d1d9" };
    for (const mode of SCULPT_MODES) {
      const out = sculptDab(box, [2, 4, 2], { mode, radius: 3, strength: 1 }, [0, 1, 0]);
      expect(out.shape).toBe("mesh");
      expect(out.verts!.every((p) => p.every(Number.isFinite))).toBe(true);
    }
    expect(toMesh(box).verts!.length).toBe(8);
    expect(pointsUnder(toMesh(box), [0, 0, 0], 1)).toEqual([0]);
  });
});
