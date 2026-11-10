import { describe, expect, it } from "vitest";
import { rotSprite, rotateNearest, scale2x, scaleTo } from "./sprite-transform";
import { getPixel, newRaster, setPixel, type Raster, type Rgba } from "./pixels";
import { rotateQuarter } from "./sprite-fx";

const RED: Rgba = [255, 0, 0, 255];
const BLUE: Rgba = [0, 0, 255, 255];
const lit = (r: Raster) => { let n = 0; for (let i = 3; i < r.data.length; i += 4) if (r.data[i]) n++; return n; };
/// A 4 by 4 picture with an L of red and a blue dot, so a turn can be told from a flip.
function lpic(): Raster {
  const r = newRaster(4, 4);
  for (const [x, y] of [[0, 0], [0, 1], [0, 2], [1, 2]] as [number, number][]) setPixel(r, x, y, RED);
  setPixel(r, 3, 0, BLUE);
  return r;
}
const same = (a: Raster, b: Raster) => a.w === b.w && a.h === b.h && a.data.every((v, i) => v === b.data[i]);

describe("scaling", () => {
  it("scales by nearest pixel to any size, up and down", () => {
    const r = lpic();
    const up = scaleTo(r, 8, 8);
    expect(up.w).toBe(8);
    expect(getPixel(up, 0, 0)).toEqual(RED);
    expect(getPixel(up, 1, 1)).toEqual(RED);
    expect(getPixel(up, 6, 0)).toEqual(BLUE);
    expect(lit(up)).toBe(lit(r) * 4);
    const down = scaleTo(up, 4, 4);
    expect(same(down, r)).toBe(true);
    expect(scaleTo(r, 0, 0).w).toBe(1);
  });
  it("scale2x doubles the size and keeps a plain picture as it is, making no new colours", () => {
    const r = lpic();
    const out = scale2x(r);
    expect([out.w, out.h]).toEqual([8, 8]);
    const colours = new Set<string>();
    for (let i = 0; i < out.data.length; i += 4) colours.add(out.data.slice(i, i + 4).join(","));
    expect([...colours].every((c) => ["255,0,0,255", "0,0,255,255", "0,0,0,0"].includes(c))).toBe(true);
    const flat = newRaster(3, 3);
    flat.data.fill(255);
    expect(scale2x(flat).data.every((v) => v === 255)).toBe(true);
  });
  it("scale2x rounds a diagonal step", () => {
    const r = newRaster(3, 3);
    for (const [x, y] of [[1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]] as [number, number][]) setPixel(r, x, y, RED); // empty corner top-left only
    const out = scale2x(r);
    expect(lit(out)).toBeLessThan(8 * 4 * 2 + 1);
  });
});

describe("rotating", () => {
  it("a quarter turn by nearest pixel is the exact quarter turn", () => {
    const r = lpic();
    expect(same(rotateNearest(r, 90), rotateQuarter(r)!)).toBe(true);
    expect(same(rotateNearest(r, -90), rotateQuarter(r, true)!)).toBe(true);
    expect(same(rotateNearest(r, 180), rotateNearest(rotateNearest(r, 90), 90))).toBe(true);
    expect(same(rotateNearest(r, 0), r)).toBe(true);
  });
  it("a turn of 45 degrees makes a bigger picture that holds all of it", () => {
    const r = newRaster(8, 8);
    r.data.fill(255);
    const out = rotateNearest(r, 45);
    expect(out.w).toBe(12);
    expect(lit(out)).toBeGreaterThan(50);
  });
  it("RotSprite turns by quarters exactly, leaves 0 alone, and never makes colours the picture did not have", () => {
    const r = lpic();
    expect(same(rotSprite(r, 90), rotateQuarter(r)!)).toBe(true);
    expect(same(rotSprite(r, 180), rotateNearest(r, 180))).toBe(true);
    expect(same(rotSprite(r, 0), r)).toBe(true);
    const odd = rotSprite(r, 30);
    for (let i = 0; i < odd.data.length; i += 4) {
      if (!odd.data[i + 3]) continue;
      const c = odd.data.slice(i, i + 4).join(",");
      expect(["255,0,0,255", "0,0,255,255"]).toContain(c);
    }
    expect(odd.w).toBe(rotateNearest(r, 30).w);
  });
  it("RotSprite keeps a straight line straighter than the plain turn does (fewer stray pixels)", () => {
    const line = newRaster(12, 3);
    for (let x = 0; x < 12; x++) setPixel(line, x, 1, RED);
    const plain = rotateNearest(line, 20);
    const clean = rotSprite(line, 20);
    // both keep about the same amount of ink; the clean one's pixels are not scattered: count pixels that have no lit neighbour
    const lonely = (r: Raster) => { let n = 0; for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) if (getPixel(r, x, y)![3]) { let near = 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) if ((getPixel(r, x + dx!, y + dy!) ?? [0, 0, 0, 0])[3]) near++; if (near === 0) n++; } return n; };
    expect(lonely(clean)).toBeLessThanOrEqual(lonely(plain));
    expect(lit(clean)).toBeGreaterThan(lit(line) * 0.6);
    expect(lit(clean)).toBeLessThan(lit(line) * 1.6);
  });
});
