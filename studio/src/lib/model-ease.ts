// How a clip blends from one key to the next: the easing curves, and the blends themselves. Shared by the editor's own
// sampling (`model-anim.ts`) and the exporter (`glb.ts`), which bakes eased segments into extra keys because glTF's
// samplers are linear (or step) for a whole track.

import type { Ease, Vec3 } from "./model-doc";

/// Maps how far along a segment you are (0 to 1) to how far the value has got, for the easing of the key it starts at.
/// `step` holds the first key's value until the next key arrives.
export function applyEase(ease: Ease | undefined, f: number): number {
  switch (ease) {
    case "step": return f >= 1 ? 1 : 0;
    case "in": return f * f;
    case "out": return 1 - (1 - f) * (1 - f);
    case "inout": return f < 0.5 ? 2 * f * f : 1 - 2 * (1 - f) * (1 - f);
    default: return f;
  }
}

export type Quat = [number, number, number, number];

export const lerp3 = (a: Vec3, b: Vec3, f: number): Vec3 => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];

export function slerp(a: Quat, b: Quat, f: number): Quat {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const flip = dot < 0 ? -1 : 1; // take the short way round
  dot *= flip;
  const mix = (k: number) => a[k]! * (1 - f) + flip * b[k]! * f;
  let q: Quat;
  if (dot > 0.9995) q = [mix(0), mix(1), mix(2), mix(3)];
  else {
    const theta = Math.acos(Math.min(1, dot));
    const s = Math.sin(theta);
    const wa = Math.sin((1 - f) * theta) / s;
    const wb = Math.sin(f * theta) / s;
    q = [wa * a[0] + wb * flip * b[0], wa * a[1] + wb * flip * b[1], wa * a[2] + wb * flip * b[2], wa * a[3] + wb * flip * b[3]];
  }
  const n = Math.hypot(...q) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/// How many extra keys an eased segment is baked into on export (a step needs one).
export const BAKE_STEPS = 8;

/// Quaternion [x, y, z, w] for rotations in degrees applied X then Y then Z (three.js's "XYZ" Euler order).
export function eulerToQuaternion(deg: Vec3): [number, number, number, number] {
  const half = (d: number) => (d * Math.PI) / 360;
  const [x, y, z] = [half(deg[0]), half(deg[1]), half(deg[2])]; // half angles
  const [sx, cx, sy, cy, sz, cz] = [Math.sin(x), Math.cos(x), Math.sin(y), Math.cos(y), Math.sin(z), Math.cos(z)];
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ];
}
