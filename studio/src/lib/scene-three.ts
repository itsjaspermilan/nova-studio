// The 3D scene view's objects as few draw calls as possible: every shape of every model is one InstancedMesh holding a copy
// for each object that uses the model, so a circuit with fifteen hundred trees, rocks and road pieces is a few dozen draws,
// not thousands. Pure three.js (no canvas), so it can be tested without a browser.

import * as THREE from "three";
import type { ModelDoc } from "./model-doc";
import { buildModel, disposeModel } from "./model-three";
import { positionOf, type Item, type Scene } from "./scene-model";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/// Where an object stands, the way the game draws it: turned about y, then x, then z (radians), sized by `sx`.
export function placement(o: Item): THREE.Matrix4 {
  const props = (o.props ?? {}) as Record<string, unknown>;
  const size = typeof props.sx === "number" && props.sx > 0 ? props.sx : 1;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(num(props.rx), num(props.ry ?? props.angle), num(props.rz), "YXZ"));
  return new THREE.Matrix4().compose(new THREE.Vector3(...positionOf(o)), q, new THREE.Vector3(size, size, size));
}

interface ShapePart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /// The shape's place inside its model (with the model's own scale).
  matrix: THREE.Matrix4;
}

/// The shapes of each model, made once and shared by every object that uses it.
export class ModelShapes {
  #made = new Map<ModelDoc, { root: THREE.Group; parts: ShapePart[] }>();

  of(doc: ModelDoc): ShapePart[] {
    let made = this.#made.get(doc);
    if (!made) {
      const root = buildModel(doc);
      root.updateMatrixWorld(true);
      const parts: ShapePart[] = [];
      root.traverse((n) => {
        if (n instanceof THREE.Mesh) parts.push({ geometry: n.geometry, material: n.material as THREE.Material, matrix: n.matrixWorld.clone() });
      });
      made = { root, parts };
      this.#made.set(doc, made);
    }
    return made.parts;
  }

  dispose() {
    for (const { root } of this.#made.values()) disposeModel(root);
    this.#made.clear();
  }
}

export interface Instanced {
  meshes: THREE.InstancedMesh[];
  /// For each object (by index in the scene's list): where its copies are, and each copy's place inside the object.
  slots: Map<number, { mesh: THREE.InstancedMesh; at: number; local: THREE.Matrix4 }[]>;
  /// For each instanced mesh, which object each copy belongs to.
  owners: Map<THREE.InstancedMesh, number[]>;
  /// Objects whose entity has no model (they are drawn as markers).
  markers: number[];
}

export function instanceScene(scene: Scene, models: ReadonlyMap<string, ModelDoc>, shapes: ModelShapes): Instanced {
  const out: Instanced = { meshes: [], slots: new Map(), owners: new Map(), markers: [] };
  const byKind = new Map<string, number[]>();
  (scene.objects ?? []).forEach((o, i) => {
    const kind = typeof o.kind === "string" ? o.kind : "";
    if (models.has(kind)) (byKind.get(kind) ?? byKind.set(kind, []).get(kind)!).push(i);
    else out.markers.push(i);
  });
  for (const [kind, indexes] of byKind) {
    for (const part of shapes.of(models.get(kind)!)) {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, indexes.length);
      mesh.frustumCulled = false; // the box of one copy is not the box of them all
      const owned: number[] = [];
      indexes.forEach((objectIndex, at) => {
        const m = placement(scene.objects![objectIndex]!).multiply(part.matrix);
        mesh.setMatrixAt(at, m);
        owned.push(objectIndex);
        (out.slots.get(objectIndex) ?? out.slots.set(objectIndex, []).get(objectIndex)!).push({ mesh, at, local: part.matrix });
      });
      mesh.instanceMatrix.needsUpdate = true;
      out.owners.set(mesh, owned);
      out.meshes.push(mesh);
    }
  }
  return out;
}

/// Moves one object's copies to a new place (while it is being dragged).
export function moveObject(instanced: Instanced, index: number, placed: THREE.Matrix4) {
  const m = new THREE.Matrix4();
  const touched = new Set<THREE.InstancedMesh>();
  for (const s of instanced.slots.get(index) ?? []) {
    s.mesh.setMatrixAt(s.at, m.multiplyMatrices(placed, s.local));
    touched.add(s.mesh);
  }
  for (const mesh of touched) mesh.instanceMatrix.needsUpdate = true;
}
