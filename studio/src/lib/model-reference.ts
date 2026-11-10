// Reference images for modelling: a picture (a car's side blueprint, a character sheet) placed in the 3D view on a plane facing one of the standard views,
// to trace over. It is part of the editing session only (the model file never holds it). This is the placement maths; the editor makes the plane.

import type { ViewName } from "./view-presets";

export type Vec3 = [number, number, number];

export interface Reference {
  /// The picture's project path.
  path: string;
  /// Which standard view the picture faces (the plane's normal points toward that camera).
  view: ViewName;
  /// How tall it is in model units (its width follows the picture).
  height: number;
  /// Slide it in its own plane (x right, y up, as seen from that view), and along the line of sight (depth, positive toward the camera).
  x: number;
  y: number;
  depth: number;
  opacity: number;
  /// Mirror it left to right.
  flip: boolean;
  /// Drawn over the model instead of behind it.
  front: boolean;
  visible: boolean;
}

export const newReference = (path: string, view: ViewName = "front"): Reference => ({ path, view, height: 32, x: 0, y: 0, depth: -0.5, opacity: 0.5, flip: false, front: false, visible: true });

/// For each view: the direction the plane faces, its "right" and its "up" in the model's space. (A plane through the origin; the picture is read as seen from that view.)
const FRAMES: Record<ViewName, { normal: Vec3; right: Vec3; up: Vec3 }> = {
  front: { normal: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0] },
  back: { normal: [0, 0, -1], right: [-1, 0, 0], up: [0, 1, 0] },
  right: { normal: [1, 0, 0], right: [0, 0, -1], up: [0, 1, 0] },
  left: { normal: [-1, 0, 0], right: [0, 0, 1], up: [0, 1, 0] },
  top: { normal: [0, 1, 0], right: [1, 0, 0], up: [0, 0, -1] },
  bottom: { normal: [0, -1, 0], right: [1, 0, 0], up: [0, 0, 1] },
};

export interface Placement {
  position: Vec3;
  /// The plane's three axes as unit vectors in the model's space (x along its right, y along its up, z its normal), for building a rotation.
  axes: { x: Vec3; y: Vec3; z: Vec3 };
  width: number;
  height: number;
  /// Mirror the picture left to right (the axes stay a plain turn, so the editor scales the plane by -1 across).
  flip: boolean;
}

/// Where the picture's plane sits, how big it is, and how it is turned. `aspect` is the picture's width over its height.
export function placementOf(r: Reference, aspect: number): Placement {
  const f = FRAMES[r.view];
  const position: Vec3 = [
    f.right[0] * r.x + f.up[0] * r.y + f.normal[0] * r.depth,
    f.right[1] * r.x + f.up[1] * r.y + f.normal[1] * r.depth,
    f.right[2] * r.x + f.up[2] * r.y + f.normal[2] * r.depth,
  ];
  const height = Math.max(0.01, r.height);
  return { position, axes: { x: f.right, y: f.up, z: f.normal }, width: height * Math.max(0.01, aspect), height, flip: r.flip };
}

const KEY = (model: string) => `nova.model.references.${model}`;

/// Reads what was saved for a model; anything unreadable is dropped.
export function loadReferences(model: string, storage: Pick<Storage, "getItem"> | null = typeof localStorage === "undefined" ? null : localStorage): Reference[] {
  try {
    const raw = JSON.parse(storage?.getItem(KEY(model)) ?? "[]") as Partial<Reference>[];
    return raw
      .filter((r) => r && typeof r.path === "string" && r.path)
      .slice(0, 6)
      .map((r) => ({ ...newReference(r.path!, (r.view && r.view in FRAMES ? r.view : "front") as ViewName), ...pick(r) }));
  } catch {
    return [];
  }
}

const pick = (r: Partial<Reference>): Partial<Reference> => {
  const n = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  return {
    height: n(r.height, 0.1, 4096, 32), x: n(r.x, -4096, 4096, 0), y: n(r.y, -4096, 4096, 0), depth: n(r.depth, -4096, 4096, -0.5), opacity: n(r.opacity, 0.05, 1, 0.5),
    flip: !!r.flip, front: !!r.front, visible: r.visible !== false,
  };
};

export function saveReferences(model: string, list: Reference[], storage: Pick<Storage, "setItem"> | null = typeof localStorage === "undefined" ? null : localStorage) {
  try {
    storage?.setItem(KEY(model), JSON.stringify(list.slice(0, 6)));
  } catch {
    // not remembered
  }
}
