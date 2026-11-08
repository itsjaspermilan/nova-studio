import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ModelShapes, instanceScene, moveObject, placement } from "./scene-three";
import { addPart, newModel, updatePart } from "./model-doc";
import type { Scene } from "./scene-model";

const car = (() => {
  let d = newModel();
  d = addPart(d, [0], "wheel").doc;
  return updatePart(d, [0, 0], { origin: [4, 0, 0] });
})();
const scene = (n: number): Scene => ({
  version: 1,
  objects: [
    ...Array.from({ length: n }, (_, i) => ({ kind: "car", x: i * 10, y: 0, z: -i, props: i % 2 ? { ry: Math.PI / 2, sx: 2 } : {} })),
    { kind: "flag", x: 5, y: 0, z: 5 },
  ],
});

describe("the 3D scene view's instancing", () => {
  it("places an object the way the game draws it: y turn, then size", () => {
    const m = placement({ kind: "car", x: 1, y: 2, z: 3, props: { ry: Math.PI / 2, sx: 2 } });
    const p = new THREE.Vector3(0, 0, 1).applyMatrix4(m); // the model's nose
    expect(p.x).toBeCloseTo(1 + 2); // turned a quarter towards +x and twice as long
    expect(p.y).toBeCloseTo(2);
    expect(p.z).toBeCloseTo(3);
  });

  it("makes one instanced mesh per shape of a model, however many objects use it", () => {
    const shapes = new ModelShapes();
    const r = instanceScene(scene(400), new Map([["car", car]]), shapes);
    expect(r.meshes.length).toBe(shapes.of(car).length);
    expect(r.meshes.every((m) => m.count === 400)).toBe(true);
    expect(r.markers).toEqual([400]); // the object without a model is a marker
    expect(r.owners.get(r.meshes[0]!)!.length).toBe(400);
    shapes.dispose();
  });

  it("shares the shapes between scenes and copies of a model", () => {
    const shapes = new ModelShapes();
    const a = instanceScene(scene(3), new Map([["car", car]]), shapes);
    const b = instanceScene(scene(5), new Map([["car", car]]), shapes);
    expect(a.meshes[0]!.geometry).toBe(b.meshes[0]!.geometry);
    shapes.dispose();
  });

  it("moves one object's copies without touching the others", () => {
    const shapes = new ModelShapes();
    const r = instanceScene(scene(4), new Map([["car", car]]), shapes);
    const at = (i: number) => {
      const s = r.slots.get(i)![0]!;
      const m = new THREE.Matrix4();
      s.mesh.getMatrixAt(s.at, m);
      return new THREE.Vector3().setFromMatrixPosition(m);
    };
    const before = at(2).clone();
    const other = at(1).clone();
    moveObject(r, 2, new THREE.Matrix4().makeTranslation(100, 0, 0));
    expect(at(2).x - before.x).toBeGreaterThan(50);
    expect(at(1).equals(other)).toBe(true);
    shapes.dispose();
  });

  it("builds a fifteen-hundred-object circuit quickly", () => {
    const shapes = new ModelShapes();
    const started = performance.now();
    const r = instanceScene(scene(1500), new Map([["car", car]]), shapes);
    expect(performance.now() - started).toBeLessThan(300);
    expect(r.meshes.length).toBeLessThan(10);
    shapes.dispose();
  });
});

describe("picking in the 3D scene view", () => {
  it("a ray through a copy hits that copy's instance, and nothing else", () => {
    const shapes = new ModelShapes();
    const r = instanceScene(scene(6), new Map([["car", car]]), shapes);
    const ray = new THREE.Raycaster(new THREE.Vector3(30, 20, -3), new THREE.Vector3(0, -1, 0)); // above the fourth car (x = 30, z = -3)
    const hit = ray.intersectObjects(r.meshes, false)[0];
    expect(hit, "the ray hits something").toBeDefined();
    expect(r.owners.get(hit!.object as THREE.InstancedMesh)![hit!.instanceId!]).toBe(3);
    const miss = new THREE.Raycaster(new THREE.Vector3(500, 20, 500), new THREE.Vector3(0, -1, 0));
    expect(miss.intersectObjects(r.meshes, false)).toHaveLength(0);
    shapes.dispose();
  });
});
