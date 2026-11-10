import { describe, expect, it } from "vitest";
import { BUDGETS, budgetOf, modelStats, problemsOf, statsOf } from "./mesh-stats";
import { toMesh } from "./mesh-edit";
import type { Cube, ModelDoc } from "./model-doc";

const box: Cube = { shape: "box", from: [0, 0, 0], size: [2, 2, 2], color: "#888888" };

describe("statistics of one element", () => {
  it("counts a box as 8 points, 6 faces and 12 triangles, with nothing wrong", () => {
    expect(statsOf(box)).toEqual({ triangles: 12, points: 8, faces: 6, openEdges: 0, fins: 0, degenerate: 0, loose: 0 });
  });
  it("sees modifiers as they are exported: a mirrored half has twice the triangles", () => {
    const half = { ...toMesh(box), modifiers: [{ type: "array" as const, count: 3, offset: [3, 0, 0] as [number, number, number] }] };
    expect(statsOf(half).triangles).toBe(36);
  });
  it("finds an open sheet, a face with a repeated point, a loose point and a fin", () => {
    const sheet: Cube = { shape: "mesh", from: [0, 0, 0], size: [0, 0, 0], color: "#fff", verts: [[0, 0, 0], [1, 0, 0], [1, 0, -1], [0, 0, -1], [5, 5, 5]], polys: [{ v: [0, 1, 2, 3] }] };
    const s = statsOf(sheet);
    expect(s.openEdges).toBe(4);
    expect(s.loose).toBe(1);
    const bad: Cube = { ...sheet, polys: [{ v: [0, 1, 2, 3] }, { v: [0, 1, 1] }] };
    expect(statsOf(bad).degenerate).toBe(1);
    const fin: Cube = { shape: "mesh", from: [0, 0, 0], size: [0, 0, 0], color: "#fff", verts: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1], [-1, 0, 0]], polys: [{ v: [0, 1, 2] }, { v: [1, 0, 3] }, { v: [0, 1, 4] }] };
    expect(statsOf(fin).fins).toBe(1);
  });
});

describe("a model", () => {
  const doc = { version: 1, parts: [{ name: "body", origin: [0, 0, 0], rotation: [0, 0, 0], cubes: [box, box], children: [{ name: "wheel", origin: [0, 0, 0], rotation: [0, 0, 0], cubes: [box], children: [] }] }] } as unknown as ModelDoc;
  it("adds up over the parts and lists each", () => {
    const s = modelStats(doc);
    expect(s.triangles).toBe(36);
    expect(s.parts).toBe(2);
    expect(s.perPart.map((p) => [p.name, p.stats.triangles])).toEqual([["body", 24], ["  wheel", 12]]);
  });
});

describe("the budget", () => {
  it("says fine, heavy or over, with words", () => {
    expect(budgetOf(1000, "prop").state).toBe("fine");
    expect(budgetOf(3000, "prop").state).toBe("heavy");
    expect(budgetOf(6000, "prop").state).toBe("over");
    expect(budgetOf(20000, "hero").state).toBe("fine");
    expect(budgetOf(20000, "vehicle").state).toBe("heavy");
    expect(budgetOf(BUDGETS.hero.hard / 2, "hero").fraction).toBeCloseTo(0.5, 6);
    expect(budgetOf(6000, "prop").label).toContain("over");
  });
  it("lists problems in plain words, worst first, and none for a clean mesh", () => {
    expect(problemsOf(statsOf(box))).toEqual([]);
    const p = problemsOf({ triangles: 1, points: 1, faces: 1, openEdges: 3, fins: 1, degenerate: 2, loose: 1 });
    expect(p).toHaveLength(4);
    expect(p[0]).toContain("no area");
    expect(p[3]).toContain("open");
  });
});
