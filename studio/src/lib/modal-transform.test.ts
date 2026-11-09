import { describe, expect, it } from "vitest";
import { axisKey, modalLabel, moveDelta, parseTyped, round2, scaleBox, scaleFactor, typeKey } from "./modal-transform";

describe("typing a number while transforming", () => {
  it("builds a number from keys", () => {
    let b = "";
    for (const k of ["-", "1", ".", "5", "."]) b = typeKey(b, k); // (a second point is ignored)
    expect(b).toBe("-1.5");
    expect(parseTyped(b)).toBe(-1.5);
    expect(typeKey("12", "Backspace")).toBe("1");
    expect(typeKey("-3", "-")).toBe("3");
    expect(typeKey("4", "a")).toBe("4");
  });

  it("is not a number until it is one", () => {
    for (const b of ["", "-", ".", "-."]) expect(parseTyped(b)).toBeNull();
    expect(parseTyped(".5")).toBe(0.5);
    expect(parseTyped("3.")).toBe(3);
  });
});

describe("axes", () => {
  it("are chosen by X, Y, Z, and the same key lets go", () => {
    expect(axisKey(null, "x")).toBe("x");
    expect(axisKey("x", "X")).toBeNull();
    expect(axisKey("x", "z")).toBe("z");
    expect(axisKey("x", "q")).toBeUndefined();
  });
});

describe("a move", () => {
  const right: [number, number, number] = [1, 0, 0];
  const up: [number, number, number] = [0, 1, 0];

  it("follows the mouse across the screen: right moves along the view's right, down moves down", () => {
    expect(moveDelta(right, up, 10, 0, 0.1, null, null)).toEqual([1, 0, 0]);
    const down = moveDelta(right, up, 0, 10, 0.1, null, null);
    expect(down[1]).toBeCloseTo(-1);
  });

  it("keeps to the axis that was asked for, using the part of the movement along it", () => {
    const v = moveDelta(right, up, 10, 10, 0.1, "y", null);
    expect(v[0]).toBeCloseTo(0);
    expect(v[1]).toBeCloseTo(-1);
    expect(v[2]).toBeCloseTo(0);
  });

  it("goes by the typed amount along the axis, or along x when none is held", () => {
    expect(moveDelta(right, up, 99, 99, 1, "z", 2.5)).toEqual([0, 0, 2.5]);
    expect(moveDelta(right, up, 99, 99, 1, null, -4)).toEqual([-4, 0, 0]);
  });
});

describe("a resize", () => {
  it("scales about the middle, in every direction or along one axis", () => {
    expect(scaleBox([0, 0, 0], [4, 2, 2], 2, null)).toEqual({ from: [-2, -1, -1], to: [6, 3, 3] });
    expect(scaleBox([0, 0, 0], [4, 2, 2], 0.5, "x")).toEqual({ from: [1, 0, 0], to: [3, 2, 2] });
  });

  it("grows with the mouse to the right, shrinks to the left, and never reaches zero", () => {
    expect(scaleFactor(50, null)).toBeCloseTo(1.5);
    expect(scaleFactor(-200, null)).toBe(0.01);
    expect(scaleFactor(10, 3)).toBe(3);
  });

  it("rounds to hundredths", () => {
    expect(round2(1.23456)).toBe(1.23);
  });
});

describe("the line shown while transforming", () => {
  it("names the move, the axis and the amount", () => {
    expect(modalLabel("move", "x", "", "2.5")).toContain("Move · X · 2.5");
    expect(modalLabel("scale", null, "1.5", "1.2")).toContain("Resize · free · 1.5");
  });
});
