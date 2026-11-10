import { describe, expect, it } from "vitest";
import { droppedOutside } from "./tab-drag";

const strip = { left: 200, top: 40, right: 900, bottom: 70 };

describe("tearing a tab off by dragging it out", () => {
  it("a drop on the strip, or just beside it, keeps the tab where it is", () => {
    expect(droppedOutside(strip, 400, 55)).toBe(false);
    expect(droppedOutside(strip, 195, 55)).toBe(false);
    expect(droppedOutside(strip, 400, 90)).toBe(false);
    expect(droppedOutside(strip, 400, 20)).toBe(false);
  });
  it("a drop well away from the strip tears it off, in any direction", () => {
    expect(droppedOutside(strip, 400, 300)).toBe(true);
    expect(droppedOutside(strip, 400, -50)).toBe(true);
    expect(droppedOutside(strip, 50, 55)).toBe(true);
    expect(droppedOutside(strip, 1500, 55)).toBe(true);
  });
  it("a drag with no position (a cancelled drag reports 0 or NaN) is left alone when it is NaN", () => {
    expect(droppedOutside(strip, NaN, 55)).toBe(false);
  });
});
