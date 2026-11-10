import { describe, expect, it } from "vitest";
import { needsMap, scrollToCentre, visibleBox } from "./minimap";

describe("mini-map", () => {
  it("finds the part of the picture on screen", () => {
    // a 200 px picture at 4x is 800 screen pixels; a 400 by 300 window scrolled to the right
    expect(visibleBox({ left: 0, top: 0, w: 400, h: 300 }, 4, 200, 200)).toEqual({ x: 0, y: 0, w: 96, h: 71 });
    const v = visibleBox({ left: 416, top: 16, w: 400, h: 300 }, 4, 200, 200);
    expect(v.x).toBe(100);
    expect(v.w).toBe(100); // (to the picture's right edge)
    expect(visibleBox({ left: 0, top: 0, w: 4000, h: 3000 }, 4, 200, 200)).toEqual({ x: 0, y: 0, w: 200, h: 200 });
  });
  it("is only needed when the picture does not fit", () => {
    expect(needsMap({ left: 0, top: 0, w: 400, h: 300 }, 1, 64, 64)).toBe(false);
    expect(needsMap({ left: 0, top: 0, w: 400, h: 300 }, 8, 64, 64)).toBe(true);
  });
  it("scrolls so that the clicked pixel is in the middle, and not past the start", () => {
    expect(scrollToCentre(100, 100, { w: 400, h: 300 }, 4)).toEqual({ left: 216, top: 266 });
    expect(scrollToCentre(2, 2, { w: 400, h: 300 }, 4).left).toBe(0);
    // round trip: the centre of the visible box is the pixel asked for
    const s = scrollToCentre(120, 80, { w: 400, h: 300 }, 4);
    const b = visibleBox({ ...s, w: 400, h: 300 }, 4, 200, 200);
    expect(b.x + b.w / 2).toBeCloseTo(120, 5);
    expect(b.y + b.h / 2).toBeCloseTo(80, 5);
  });
});
