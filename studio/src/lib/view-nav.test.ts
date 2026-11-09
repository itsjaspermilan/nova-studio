import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { looksLikeTrackpad } from "./input-settings.svelte";
import { navHint, orbitBy, panBy, pinchFactor, wheelAction, wheelMove, zoomBy } from "./view-nav";

const camera = () => {
  const c = new THREE.PerspectiveCamera(45, 1.5, 0.1, 1000);
  c.position.set(0, 0, 10);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  return c;
};

describe("what a wheel event does", () => {
  it("zooms on a pinch everywhere, and otherwise by scheme", () => {
    expect(wheelAction({ ctrlKey: true, shiftKey: false }, "trackpad")).toBe("zoom");
    expect(wheelAction({ ctrlKey: false, shiftKey: false }, "trackpad")).toBe("orbit");
    expect(wheelAction({ ctrlKey: false, shiftKey: true }, "trackpad")).toBe("pan");
    expect(wheelAction({ ctrlKey: false, shiftKey: false }, "mouse")).toBe("zoom");
    expect(wheelAction({ ctrlKey: false, shiftKey: true }, "pen")).toBe("pan");
  });
});

describe("the moves", () => {
  it("orbit keeps the distance to the target and clamps looking straight up or down", () => {
    const c = camera();
    const target = new THREE.Vector3();
    orbitBy(c, target, 120, 40);
    expect(c.position.distanceTo(target)).toBeCloseTo(10, 5);
    expect(c.position.x).not.toBeCloseTo(0);
    orbitBy(c, target, 0, 1e6);
    expect(Math.abs(c.position.y)).toBeLessThan(10);
    expect(c.position.distanceTo(target)).toBeCloseTo(10, 5);
  });

  it("pan slides the camera and the target together", () => {
    const c = camera();
    const target = new THREE.Vector3();
    panBy(c, target, 100, 0, 600);
    expect(c.position.x).toBeLessThan(0); // dragging right moves the scene right, so the camera goes left
    expect(c.position.x).toBeCloseTo(target.x, 5);
    expect(c.position.z).toBeCloseTo(10, 5);
  });

  it("zoom moves along the line to the target and stops short of it", () => {
    const c = camera();
    const target = new THREE.Vector3();
    zoomBy(c, target, 0.5);
    expect(c.position.z).toBeCloseTo(5, 5);
    zoomBy(c, target, 1e-9);
    expect(c.position.distanceTo(target)).toBeGreaterThan(0);
  });
});

describe("telling a trackpad from a mouse wheel", () => {
  it("reads sideways or fractional scrolling as a trackpad and big notches or lines as a mouse", () => {
    expect(looksLikeTrackpad([{ deltaX: 3, deltaY: 1, deltaMode: 0 }])).toBe(true);
    expect(looksLikeTrackpad([{ deltaX: 0, deltaY: 2.5, deltaMode: 0 }])).toBe(true);
    expect(looksLikeTrackpad([{ deltaX: 0, deltaY: 100, deltaMode: 0 }])).toBe(false);
    expect(looksLikeTrackpad([{ deltaX: 0, deltaY: 3, deltaMode: 1 }])).toBe(false);
    expect(looksLikeTrackpad([])).toBeNull();
    expect(looksLikeTrackpad([{ deltaX: 0, deltaY: 7, deltaMode: 0 }])).toBeNull();
  });
});

describe("the hint under a 3D view", () => {
  it("says how to move for the scheme in use", () => {
    expect(navHint("trackpad")).toContain("Two fingers");
    expect(navHint("mouse")).toContain("right-drag");
    expect(navHint("pen")).toContain("side button");
  });
});

describe("a trackpad scroll", () => {
  const e = (o: Partial<{ deltaX: number; deltaY: number; ctrlKey: boolean; shiftKey: boolean }>) => ({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, shiftKey: false, metaKey: false, ...o });

  it("moves the scene with the fingers: fingers left and up give a movement left and up", () => {
    // (with natural scrolling the system reports fingers left and up as positive deltas)
    const m = wheelMove(e({ deltaX: 12, deltaY: 8 }), "trackpad", false);
    expect(m.action).toBe("orbit");
    expect(m.dx).toBeLessThan(0);
    expect(m.dy).toBeLessThan(0);
  });

  it("goes the other way when the scroll is reversed", () => {
    const m = wheelMove(e({ deltaX: 12, deltaY: 8 }), "trackpad", true);
    expect(m.dx).toBeGreaterThan(0);
    expect(m.dy).toBeGreaterThan(0);
  });

  it("pans sideways with Shift, and a pinch comes closer when the fingers spread", () => {
    const pan = wheelMove(e({ deltaY: 10, shiftKey: true }), "trackpad", false);
    expect(pan.action).toBe("pan");
    expect(pan.dx).toBeLessThan(0);
    expect(pan.dy).toBe(0);
    expect(wheelMove(e({ deltaY: -5, ctrlKey: true }), "trackpad", false).zoom).toBeLessThan(1);
  });
});

describe("a pinch reported as a gesture", () => {
  it("comes closer when the fingers spread and goes away when they pinch", () => {
    expect(pinchFactor(1, 1.25)).toBeCloseTo(0.8);
    expect(pinchFactor(1.25, 1)).toBeCloseTo(1.25);
    expect(pinchFactor(1, 1)).toBe(1);
  });
  it("ignores a report with no scale", () => {
    expect(pinchFactor(0, 1)).toBe(1);
    expect(pinchFactor(1, NaN)).toBe(1);
  });
});
