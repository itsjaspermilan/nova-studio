import { describe, expect, it } from "vitest";
import { loadReferences, newReference, placementOf, saveReferences } from "./model-reference";

const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const cross = (a: number[], b: number[]) => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];

describe("where a reference picture goes", () => {
  it("sits just behind the origin plane of its view, facing the camera of that view", () => {
    const p = placementOf(newReference("car.png", "front"), 2);
    expect(p.position).toEqual([0, 0, -0.5]);
    expect(p.axes.z).toEqual([0, 0, 1]);
    expect(p.width).toBe(64);
    expect(p.height).toBe(32);
    expect(placementOf(newReference("x.png", "right"), 1).position).toEqual([-0.5, 0, 0]);
    expect(placementOf(newReference("x.png", "top"), 1).axes.z).toEqual([0, 1, 0]);
  });
  it("has a right-handed set of axes for every view, so the picture is not mirrored", () => {
    for (const view of ["front", "back", "left", "right", "top", "bottom"] as const) {
      const a = placementOf(newReference("x.png", view), 1).axes;
      expect(dot(a.x, a.y), view).toBe(0);
      const c = cross(a.x, a.y);
      expect(c.map((v) => v + 0), view).toEqual(a.z.map((v) => v + 0));
    }
  });
  it("slides in its own plane, along the line of sight, and flips left to right", () => {
    const r = { ...newReference("x.png", "right"), x: 4, y: 3, depth: 2, flip: true };
    const p = placementOf(r, 1);
    // seen from the right, the picture's right is toward -z, up is +y, and the camera is on +x
    expect(p.position).toEqual([2, 3, -4]);
    expect(p.axes.x).toEqual([0, 0, -1]);
    expect(p.flip).toBe(true);
  });
  it("never has a zero size", () => {
    const p = placementOf({ ...newReference("x.png"), height: 0 }, 0);
    expect(p.height).toBeGreaterThan(0);
    expect(p.width).toBeGreaterThan(0);
  });
});

describe("remembering them for a model", () => {
  const store = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  it("saves and reads back, clamping what was changed by hand and dropping nonsense", () => {
    const s = store();
    saveReferences("car", [{ ...newReference("a.png", "top"), opacity: 0.9, flip: true }], s);
    expect(loadReferences("car", s)).toEqual([{ ...newReference("a.png", "top"), opacity: 0.9, flip: true }]);
    s.setItem("nova.model.references.bad", JSON.stringify([{ path: "p.png", opacity: 50, height: -3, view: "sideways" }, { nope: 1 }, null]));
    const bad = loadReferences("bad", s);
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatchObject({ view: "front", opacity: 1, height: 0.1 });
    expect(loadReferences("none", s)).toEqual([]);
    expect(loadReferences("car", null)).toEqual([]);
  });
});
