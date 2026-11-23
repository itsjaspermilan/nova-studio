// The road builder's junctions (scripts/lib/roadnet.mjs, road_make with `roads`): for networks of every shape, the surface it makes
// has no hole inside its outline, no two triangles over one another, every inside edge shared by exactly two triangles with the same
// end points, one height at each place, and a transition wherever two surfaces meet.
import { describe, expect, it } from "vitest";
import { buildNetwork, checkSurface, networkGlb, surfaceOf } from "../../../scripts/lib/roadnet.mjs";

type Spec = Record<string, unknown>;
const T = "road_asphalt", G = "road_gravel";
const at = (deg: number, len: number, from: [number, number] = [0, 0]): [number, number] => [from[0] + Math.sin((deg * Math.PI) / 180) * len, from[1] + Math.cos((deg * Math.PI) / 180) * len];
const main = { id: "main", control: [[0, -70], [0, 70]], road: T, width: 9.2 };

/// Builds and checks a network: it must be watertight and single-layered, with `loops` outline loops (1 for a network with no ring).
function sound(spec: Spec, loops = 1) {
  const net = buildNetwork(spec);
  const c = checkSurface(surfaceOf(net.mesh));
  expect(c.problems, JSON.stringify(c.problems.slice(0, 4))).toEqual([]);
  expect(c.holes).toBe(0);
  expect(c.overlaps).toBe(0);
  expect(c.loops).toBe(loops);
  // (area of the union, sampled, equals the sum of the triangles' areas)
  expect(Math.abs(c.coveredArea - c.area) / c.area).toBeLessThan(0.01);
  return { net, c };
}

describe("road networks: one surface, joined", () => {
  it("a T: the lane is trimmed to its mouth, the corners are filleted, the main road carries on", () => {
    const { net } = sound({ roads: [main, { id: "lane", control: [[0, 0], [60, 0]], road: T, width: 7.2 }] });
    expect(net.junctions).toHaveLength(1);
    const j = net.junctions[0];
    expect(j).toMatchObject({ kind: "T", through: "main", road: "lane", angle: 90, surface: T, transition: null });
    expect(j.corners.every((r: number) => r > 3)).toBe(true);
    // the main road is never cut across: its centre line's triangles run unbroken through the junction
    const centre = net.mesh.tris.filter((t: { piece: string; v: { x: number; z: number }[] }) => t.piece === "road" && t.v.every((p) => Math.abs(p.x) < 0.1));
    const zs = centre.flatMap((t: { v: { z: number }[] }) => t.v.map((p) => p.z));
    expect(Math.min(...zs)).toBeLessThan(-60);
    expect(Math.max(...zs)).toBeGreaterThan(60);
  });

  for (const deg of [20, 45, 70]) {
    it(`a Y at ${deg} degrees`, () => {
      const { net } = sound({ roads: [{ ...main, control: [[0, -70], [0, 90]] }, { id: "lane", control: [[0, 0], at(deg, 45), at(deg, 90)], road: G, width: 7.2 }] });
      expect(net.junctions[0]).toMatchObject({ kind: "T", angle: deg });
      // the gore: the sharper the Y, the further out the lane's mouth
      expect(net.junctions[0].mouth).toBeGreaterThan(deg === 20 ? 25 : 5);
    });
  }

  it("a crossroads (at a slant), the crossing road split in two arms", () => {
    const { net } = sound({ roads: [main, { id: "cross", control: [[-60, 12], [60, -12]], road: T, width: 7.2 }] });
    expect(net.junctions.map((j: { kind: string }) => j.kind)).toEqual(["crossroads", "crossroads"]);
  });

  it("roads of different widths and a curved main road", () => {
    sound({ roads: [{ id: "main", control: [[0, -70], [10, -20], [30, 20], [70, 50]], road: T, width: 12 }, { id: "lane", control: [[10, -20], [-30, -10], [-60, -30]], road: T, width: 6 }] });
  });

  it("a gravel lane off a tarmac road: a tarmac apron, then a ragged edge into the gravel; markings end with the tarmac", () => {
    const { net } = sound({ roads: [main, { id: "lane", control: [[0, 0], [60, 0]], road: G, width: 7.2 }] });
    expect(net.junctions[0]).toMatchObject({ surface: T, joining: G, transition: "feather" });
    expect(net.transitions).toEqual([expect.objectContaining({ road: "lane", from: T, to: G, style: "feather" })]);
    expect(net.mesh.tris.some((t: { piece: string; kind: string }) => t.piece === "feather" && t.kind === G)).toBe(true);
    // (and the other styles are as joined)
    for (const transition of ["apron", "hard"]) {
      const { net: n } = sound({ roads: [main, { id: "lane", control: [[0, 0], [60, 0]], road: G, width: 7.2 }], transition });
      expect(n.transitions).toEqual([expect.objectContaining({ style: "edge" })]);
    }
  });

  it("a surface and width change along one road, and two pieces of a road end to end", () => {
    sound({ roads: [{ id: "r", control: [[0, -60], [0, 60]], road: T, width: 9.2, zones: [{ from: 60, to: 999, road: G, width: 7 }] }] });
    const { net } = sound({ roads: [{ id: "a", control: [[0, -60], [0, -20], [0, 0]], road: T, width: 9.2 }, { id: "b", control: [[0, 0], [5, 30], [10, 60]], road: G, width: 7 }] });
    expect(net.report.join(" ")).toMatch(/a and b joined end to end/);
    expect(net.transitions).toHaveLength(1);
  });

  it("a dead end: a rounded cap; square and flat on request", () => {
    for (const ends of ["round", "square", "flat"]) {
      const { net } = sound({ roads: [{ id: "r", control: [[0, 0], [0, 40]], road: T, width: 9.2 }], ends });
      expect(net.mesh.tris.some((t: { piece: string }) => t.piece === "cap")).toBe(ends !== "flat");
    }
  });

  it("a road into a pad, and a pad with two roads", () => {
    const { net } = sound({ roads: [{ id: "drive", control: [[0, -40], [0, 0]], road: T, width: 7.2 }], pads: [{ at: [0, 8], radius: 8, road: G }] });
    expect(net.junctions[0]).toMatchObject({ kind: "pad", transition: "feather" });
    sound({ roads: [{ id: "a", control: [[0, -40], [0, 0]], road: G, width: 7.2 }, { id: "b", control: [[40, 10], [8, 8]], road: G, width: 7.2 }], pads: [{ at: [0, 8], size: [14, 18], ry: 0.3, road: G }] });
  });

  it("a loop: a lane that leaves the main road and comes back to it", () => {
    sound({ roads: [main, { id: "loop", control: [[0, -30], [30, -25], [40, 0], [30, 25], [0, 30]], road: G, width: 7.2 }] }, 2);
  });

  it("a bridge gap: both ends square with a threshold strip", () => {
    const { net } = sound({ roads: [{ id: "r", control: [[0, -40], [0, 40]], road: G, width: 7.2 }], gaps: [{ road: "r", from: [0, -9], to: [0, 9] }] }, 2);
    expect(net.mesh.tris.filter((t: { piece: string }) => t.piece === "threshold").length).toBeGreaterThan(3);
  });

  it("refuses what it cannot join, and says why", () => {
    expect(() => buildNetwork({ roads: [{ id: "a", control: [[0, 0], [0, 40]] }, { id: "b", control: [[0, 40], [30, 40]] }] })).toThrow(/sharp corner/);
    expect(() => buildNetwork({ roads: [main], transition: "fade" })).toThrow(/transition is/);
    expect(() => buildNetwork({ roads: [] })).toThrow(/at least one road/);
  });

  it("is a glTF the engine reads, the same bytes every time", () => {
    const spec = { roads: [main, { id: "lane", control: [[0, 0], [60, 0]], road: G, width: 7.2 }] };
    const a = networkGlb(buildNetwork(spec).mesh), b = networkGlb(buildNetwork(spec).mesh);
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
    expect(new TextDecoder().decode(a.slice(0, 4))).toBe("glTF");
  });
});
