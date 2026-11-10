import { describe, expect, it } from "vitest";
import { ORTHO_FOV, PERSPECTIVE_FOV, distanceForFov, nameOfView, orbitStep, viewPlacement, type Vec3 } from "./view-presets";

describe("standard views", () => {
  it("places the camera on the right side of the target, at the distance asked", () => {
    expect(viewPlacement("front", [0, 8, 0], 50).position).toEqual([0, 8, 50]);
    expect(viewPlacement("right", [1, 2, 3], 10).position).toEqual([11, 2, 3]);
    expect(viewPlacement("top", [0, 0, 0], 20).position).toEqual([0, 20, 0]);
    expect(viewPlacement("bottom", [0, 0, 0], 20).position).toEqual([0, -20, 0]);
  });
  it("keeps up the right way, and not along the line of sight for the top and bottom", () => {
    expect(viewPlacement("front", [0, 0, 0], 5).up).toEqual([0, 1, 0]);
    expect(viewPlacement("top", [0, 0, 0], 5).up).toEqual([0, 0, -1]);
    expect(viewPlacement("bottom", [0, 0, 0], 5).up).toEqual([0, 0, 1]);
  });
  it("keeps the same amount in view when the field of view narrows", () => {
    const d = distanceForFov(50, PERSPECTIVE_FOV, ORTHO_FOV);
    expect(d).toBeGreaterThan(50 * 10);
    // the visible height at the target is the same
    const height = (dist: number, fov: number) => 2 * dist * Math.tan((fov * Math.PI) / 360);
    expect(height(d, ORTHO_FOV)).toBeCloseTo(height(50, PERSPECTIVE_FOV), 6);
    expect(distanceForFov(d, ORTHO_FOV, PERSPECTIVE_FOV)).toBeCloseTo(50, 6);
  });
});

describe("orbit steps", () => {
  const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  it("keeps the distance and turns by the angle", () => {
    const t: Vec3 = [0, 0, 0];
    const p = orbitStep([0, 0, 10], t, 90, 0);
    expect(dist(p, t)).toBeCloseTo(10, 6);
    expect(p[0]).toBeCloseTo(10, 6);
    expect(p[2]).toBeCloseTo(0, 6);
    const up = orbitStep([0, 0, 10], t, 0, 30);
    expect(up[1]).toBeCloseTo(5, 6);
    expect(dist(up, t)).toBeCloseTo(10, 6);
  });
  it("stops short of the poles and is a no-op at the target", () => {
    const high = orbitStep([0, 9, 1], [0, 0, 0], 0, 80);
    expect(high[1]).toBeLessThan(Math.hypot(...high));
    expect(orbitStep([3, 3, 3], [3, 3, 3], 15, 15)).toEqual([3, 3, 3]);
  });
  it("four quarter turns come back to the start", () => {
    let p: Vec3 = [3, 4, 5];
    for (let i = 0; i < 4; i++) p = orbitStep(p, [0, 0, 0], 90, 0);
    expect(p[0]).toBeCloseTo(3, 6);
    expect(p[2]).toBeCloseTo(5, 6);
  });
});

describe("naming a view", () => {
  it("knows the six standard views, a little off, and says nothing for a free view", () => {
    expect(nameOfView([0, 0, 40], [0, 0, 0])).toBe("front");
    expect(nameOfView([1, 0, 40], [0, 0, 0])).toBe("front");
    expect(nameOfView([0, 30, 0.5], [0, 0, 0])).toBe("top");
    expect(nameOfView([-9, 0, 0], [0, 0, 0])).toBe("left");
    expect(nameOfView([34, 28, 46], [0, 8, 0])).toBeNull();
  });
});

import { gizmoDots } from "./view-presets";
describe("view gizmo", () => {
  it("from the front: +Z points at the camera, +X is to the right, +Y is up", () => {
    const d = gizmoDots([1, 0, 0], [0, 1, 0], [0, 0, 1]);
    const get = (v: string) => d.find((e) => e.view === v)!;
    expect(get("front")).toMatchObject({ x: 0, y: 0, depth: 1 });
    expect(get("right").x).toBe(1);
    expect(get("top").y).toBe(-1); // up on screen is a negative y
    expect(d[d.length - 1]!.view).toBe("front"); // nearest drawn last
    expect(d.length).toBe(6);
  });
});
