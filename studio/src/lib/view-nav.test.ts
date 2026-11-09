import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { looksLikeTrackpad } from "./input-settings.svelte";
import { orbitBy, panBy, wheelAction, zoomBy } from "./view-nav";

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
