// A model document as three.js objects for showing it somewhere other than the model editor (the 3D scene view):
// the part tree, shapes in their vertex colours, at rest. Textures and bending are not drawn here.

import * as THREE from "three";
import { glowOf, type ModelDoc, type Part, type Vec3 } from "./model-doc";
import { meshOf } from "./model-mesh";

const linearCache = new Map<number, number>();
const linear = (b: number) => {
  let v = linearCache.get(b);
  if (v === undefined) {
    v = new THREE.Color().setRGB(b / 255, b / 255, b / 255, THREE.SRGBColorSpace).r;
    linearCache.set(b, v);
  }
  return v;
};

const radians = (v: Vec3) => v.map((d) => (d * Math.PI) / 180) as Vec3;

/// The model in world units (its export scale applied), standing on y = 0 as the runtime draws it.
export function buildModel(doc: ModelDoc): THREE.Group {
  const root = new THREE.Group();
  const add = (parts: Part[], parent: THREE.Object3D) => {
    for (const part of parts) {
      const group = new THREE.Group();
      group.position.set(...part.origin);
      group.rotation.set(...radians(part.rotation), "XYZ");
      group.name = part.name;
      for (const cube of part.cubes) {
        const m = meshOf(cube);
        if (!m.indices.length) continue;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(m.positions, 3));
        geometry.setAttribute("normal", new THREE.Float32BufferAttribute(m.normals, 3));
        const colors: number[] = [];
        for (let i = 0; i < m.colors.length; i += 4) colors.push(linear(m.colors[i]!), linear(m.colors[i + 1]!), linear(m.colors[i + 2]!), m.colors[i + 3]! / 255);
        geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 4));
        geometry.setIndex(m.indices);
        const translucent = m.colors.some((c, k) => k % 4 === 3 && c < 255);
        const glow = glowOf(cube);
        // a glowing shape also shines in its own colour (how the game draws it: the colour, lit by the scene plus the glow)
        const material = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: translucent, side: cube.shape === "mesh" ? THREE.DoubleSide : THREE.FrontSide });
        if (glow > 0) {
          material.emissive = new THREE.Color(cube.color.slice(0, 7));
          material.emissiveIntensity = glow;
        }
        group.add(new THREE.Mesh(geometry, material));
      }
      parent.add(group);
      add(part.children, group);
    }
  };
  add(doc.parts, root);
  root.scale.setScalar(doc.scale);
  return root;
}

/// Frees what `buildModel` made.
export function disposeModel(group: THREE.Object3D) {
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
}
