import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildModel, disposeModel } from "./model-three";
import { addPart, newModel, updatePart } from "./model-doc";

describe("buildModel", () => {
  it("makes one group per part, in the part tree, scaled to world units", () => {
    let d = newModel();
    d = addPart(d, [0], "wheel").doc;
    d = updatePart(d, [0, 0], { origin: [6, 2, 8], rotation: [0, 90, 0] });
    const root = buildModel(d);
    expect(root.scale.x).toBeCloseTo(d.scale);
    const body = root.children[0]!;
    expect(body.name).toBe("body");
    const wheel = body.children.find((c) => c.name === "wheel")!;
    expect(wheel.position.toArray()).toEqual([6, 2, 8]);
    expect(wheel.rotation.y).toBeCloseTo(Math.PI / 2);
  });

  it("gives each shape a mesh with colours and normals, and frees them", () => {
    const root = buildModel(newModel());
    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => o instanceof THREE.Mesh && meshes.push(o));
    expect(meshes.length).toBeGreaterThan(0);
    const g = meshes[0]!.geometry;
    expect(g.getAttribute("color").itemSize).toBe(4);
    expect(g.getAttribute("normal").count).toBe(g.getAttribute("position").count);
    let disposed = 0;
    g.addEventListener("dispose", () => disposed++);
    disposeModel(root);
    expect(disposed).toBe(1);
  });
});
