import { describe, expect, it } from "vitest";
import { modelToObj, parseObj } from "./obj";
import { newModel, parseModel, serializeModel, type ModelDoc } from "./model-doc";

const CUBE = `# a cube
o Crate
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
v 0 0 1
v 1 0 1
v 1 1 1
v 0 1 1
f 1 4 3 2
f 5 6 7 8
f 1 2 6 5
f 2 3 7 6
f 3 4 8 7
f 4 1 5 8
`;

describe("reading OBJ", () => {
  it("makes a mesh shape of an object, scaled to model units, with its polygons kept", () => {
    const { doc, warnings } = parseObj(CUBE, "box");
    expect(warnings).toEqual([]);
    const c = doc.parts[0]!.cubes[0]!;
    expect(c.name).toBe("Crate");
    expect(c.shape).toBe("mesh");
    expect(c.verts).toHaveLength(8);
    expect(c.polys).toHaveLength(6);
    // points are renumbered in the order the object first uses them: the first face is 0 1 2 3 round the bottom
    expect(c.polys![0]!.v).toEqual([0, 1, 2, 3]);
    expect(c.verts![1]).toEqual([0, 16, 0]);
    expect(c.size).toEqual([16, 16, 16]);
    expect(parseModel(serializeModel(doc)).ok).toBe(true);
  });
  it("reads vertex/texture/normal references, negative numbers and several objects, each with only its own points", () => {
    const text = `v 0 0 0\nv 1 0 0\nv 0 1 0\no A\nf 1/1/1 2/2/1 3/3/1\nv 5 5 5\nv 6 5 5\nv 5 6 5\no B\nf -3 -2 -1\n`;
    const { doc } = parseObj(text, "two", 1);
    expect(doc.parts[0]!.cubes.map((c) => [c.name, c.verts!.length])).toEqual([["A", 3], ["B", 3]]);
    expect(doc.parts[0]!.cubes[1]!.verts![0]).toEqual([5, 5, 5]);
  });
  it("leaves out bad faces and says how many, and refuses a file with none", () => {
    const { warnings, doc } = parseObj(`v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\nf 1 2\nf 1 2 9\nf 1 1 1\n`, "x");
    expect(doc.parts[0]!.cubes[0]!.polys).toHaveLength(1);
    expect(warnings[0]).toContain("3 faces were left out");
    expect(() => parseObj("# nothing", "x")).toThrow(/no faces/);
    expect(() => parseObj("v a b c\nf 1 2 3", "x")).toThrow(/not a number/);
  });
});

describe("writing OBJ", () => {
  it("writes the points of every shape in world space and faces numbered across objects", () => {
    const doc: ModelDoc = newModel();
    doc.parts[0]!.origin = [16, 0, 0];
    const text = modelToObj(doc);
    const lines = text.split("\n");
    expect(lines.filter((l) => l.startsWith("v ")).length).toBe(8);
    // a 16 unit box at scale 1/16 is 1 unit; moved 16 units (1 unit) along x: its x runs 1 to 2 (from -8..8 in x: 0.5 to 1.5)
    const xs = lines.filter((l) => l.startsWith("v ")).map((l) => Number(l.split(" ")[1]));
    expect(Math.min(...xs)).toBeCloseTo(0.5, 6);
    expect(Math.max(...xs)).toBeCloseTo(1.5, 6);
    expect(lines.filter((l) => l.startsWith("f ")).length).toBe(6);
  });
  it("turns a part by its rotation and numbers faces after earlier objects", () => {
    const doc: ModelDoc = newModel();
    doc.parts[0]!.cubes.push({ ...doc.parts[0]!.cubes[0]! });
    doc.parts[0]!.rotation = [0, 90, 0];
    const lines = modelToObj(doc).split("\n").filter((l) => l.startsWith("f "));
    expect(lines).toHaveLength(12);
    const maxIndex = Math.max(...lines.flatMap((l) => l.slice(2).split(" ").map(Number)));
    expect(maxIndex).toBe(16);
    expect(Math.min(...lines.slice(6).flatMap((l) => l.slice(2).split(" ").map(Number)))).toBe(9);
  });
  it("says so when there is nothing to write, and reads back what it wrote", () => {
    const empty = newModel();
    empty.parts[0]!.cubes = [];
    expect(modelToObj(empty)).toContain("nothing to write");
    const round = parseObj(modelToObj(newModel()), "r", 16);
    expect(round.doc.parts[0]!.cubes[0]!.polys).toHaveLength(6);
    expect(round.doc.parts[0]!.cubes[0]!.size[0]).toBeCloseTo(16, 4);
  });
});
