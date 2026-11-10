// Standard views of a 3D scene: front, back, left, right, top and bottom looking at a target, an orthographic-like projection (a very narrow field of
// view from far away, so parallel lines stay parallel), and fixed-size orbit steps, as Blender's numpad does. Pure maths on plain numbers; the editor
// applies the result to its camera.

export type Vec3 = [number, number, number];
export type ViewName = "front" | "back" | "left" | "right" | "top" | "bottom";

export const VIEW_NAMES: ViewName[] = ["front", "back", "left", "right", "top", "bottom"];
export const VIEW_LABELS: Record<ViewName, string> = { front: "Front", back: "Back", left: "Left", right: "Right", top: "Top", bottom: "Bottom" };

/// The direction from the target to the camera (the model's front faces +z, so the front view looks down -z from +z).
export const VIEW_DIRS: Record<ViewName, Vec3> = {
  front: [0, 0, 1],
  back: [0, 0, -1],
  right: [1, 0, 0],
  left: [-1, 0, 0],
  top: [0, 1, 0],
  bottom: [0, -1, 0],
};

export const PERSPECTIVE_FOV = 45;
export const ORTHO_FOV = 4;

/// The camera position and up direction for a view of `target` from `distance`. Top and bottom views look along the y axis, so "up" is -z / +z there.
export function viewPlacement(name: ViewName, target: Vec3, distance: number): { position: Vec3; up: Vec3 } {
  const d = VIEW_DIRS[name];
  return {
    position: [target[0] + d[0] * distance, target[1] + d[1] * distance, target[2] + d[2] * distance],
    up: name === "top" ? [0, 0, -1] : name === "bottom" ? [0, 0, 1] : [0, 1, 0],
  };
}

/// The distance that keeps the same amount of the scene in view when the field of view changes (a narrower view must stand further back).
export function distanceForFov(distance: number, fromFov: number, toFov: number): number {
  const t = (f: number) => Math.tan((f * Math.PI) / 360);
  return (distance * t(fromFov)) / t(toFov);
}

/// Turns a camera position round its target by `dAzimuth` degrees (about the vertical axis) and `dElevation` degrees (up or down, held short of the poles).
export function orbitStep(position: Vec3, target: Vec3, dAzimuth: number, dElevation: number): Vec3 {
  const off: Vec3 = [position[0] - target[0], position[1] - target[1], position[2] - target[2]];
  const r = Math.hypot(...off);
  if (r < 1e-9) return position;
  let az = Math.atan2(off[0], off[2]) + (dAzimuth * Math.PI) / 180;
  let el = Math.asin(Math.max(-1, Math.min(1, off[1] / r))) + (dElevation * Math.PI) / 180;
  el = Math.max(-Math.PI / 2 + 0.02, Math.min(Math.PI / 2 - 0.02, el));
  az = ((az + Math.PI) % (2 * Math.PI)) - Math.PI;
  return [target[0] + r * Math.cos(el) * Math.sin(az), target[1] + r * Math.sin(el), target[2] + r * Math.cos(el) * Math.cos(az)];
}

/// The view name a direction from the target is closest to, when it is within a few degrees of one of the six; null for a free view.
export function nameOfView(position: Vec3, target: Vec3, toleranceDeg = 3): ViewName | null {
  const off: Vec3 = [position[0] - target[0], position[1] - target[1], position[2] - target[2]];
  const r = Math.hypot(...off);
  if (r < 1e-9) return null;
  for (const n of VIEW_NAMES) {
    const d = VIEW_DIRS[n];
    const cos = (off[0] * d[0] + off[1] * d[1] + off[2] * d[2]) / r;
    if (Math.acos(Math.max(-1, Math.min(1, cos))) * (180 / Math.PI) <= toleranceDeg) return n;
  }
  return null;
}

export interface GizmoDot {
  /// The view this axis end takes you to when clicked.
  view: ViewName;
  /// Letter on the positive ends.
  label: string;
  positive: boolean;
  /// Place in a square of side 2 centred on the gizmo (x right, y down), and how far towards the camera it points (1 near, -1 away).
  x: number;
  y: number;
  depth: number;
}

/// The six axis ends of the view gizmo (a small X Y Z widget that shows how the view is turned) from the camera's own axes: `right`, `up` and `toward` (from the
/// target to the camera), as unit vectors in the model's space. Ends furthest from the camera come first, so drawing in order puts the near ones on top.
export function gizmoDots(right: Vec3, up: Vec3, toward: Vec3): GizmoDot[] {
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const ends: { dir: Vec3; view: ViewName; label: string; positive: boolean }[] = [
    { dir: [1, 0, 0], view: "right", label: "X", positive: true },
    { dir: [-1, 0, 0], view: "left", label: "X", positive: false },
    { dir: [0, 1, 0], view: "top", label: "Y", positive: true },
    { dir: [0, -1, 0], view: "bottom", label: "Y", positive: false },
    { dir: [0, 0, 1], view: "front", label: "Z", positive: true },
    { dir: [0, 0, -1], view: "back", label: "Z", positive: false },
  ];
  return ends.map((e) => ({ view: e.view, label: e.label, positive: e.positive, x: dot(e.dir, right), y: 0 - dot(e.dir, up), depth: dot(e.dir, toward) })).sort((a, b) => a.depth - b.depth);
}
