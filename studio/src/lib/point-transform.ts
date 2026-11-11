// Turning and resizing picked points about a pivot, the arithmetic behind Blender's R and S keys in point mode. Pure functions on points and on a mesh element;
// the editor converts between the part's space and the world and decides the pivot, the axis and the amount from the mouse.

import { fitBounds, type Cube, type Vec3 } from "./model-doc";

/// A point made bigger or smaller about `pivot`, by a factor for each axis (1 leaves that axis alone).
export const scaleAbout = (p: Vec3, pivot: Vec3, f: Vec3): Vec3 => [pivot[0] + (p[0] - pivot[0]) * f[0], pivot[1] + (p[1] - pivot[1]) * f[1], pivot[2] + (p[2] - pivot[2]) * f[2]];

/// A point turned about the line through `pivot` along `axis` (any length; it is made 1) by `angle` radians, right-handed (Rodrigues' formula).
export function rotateAbout(p: Vec3, pivot: Vec3, axis: Vec3, angle: number): Vec3 {
  const len = Math.hypot(axis[0], axis[1], axis[2]);
  if (len < 1e-12) return [...p] as Vec3;
  const k: Vec3 = [axis[0] / len, axis[1] / len, axis[2] / len];
  const v: Vec3 = [p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]];
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  const kv = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  const cross: Vec3 = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
  return [0, 1, 2].map((i) => pivot[i]! + v[i]! * c + cross[i]! * s + k[i]! * kv * (1 - c)) as Vec3;
}

/// The middle of some points (their average).
export function medianOf(points: Vec3[]): Vec3 {
  if (!points.length) return [0, 0, 0];
  const s = points.reduce<Vec3>((t, p) => [t[0] + p[0], t[1] + p[1], t[2] + p[2]], [0, 0, 0]);
  return [s[0] / points.length, s[1] / points.length, s[2] / points.length];
}

/// The mesh with `fn` applied to the chosen points (the rest stay). The shape must already be a mesh.
export function mapVerts(c: Cube, indices: number[], fn: (p: Vec3, i: number) => Vec3): Cube {
  const out = JSON.parse(JSON.stringify(c)) as Cube;
  for (const i of new Set(indices)) if (out.verts?.[i]) out.verts[i] = fn(out.verts[i]!, i);
  if (out.shapes && out.shapes.some((s) => s.verts.length !== (out.verts?.length ?? 0))) delete out.shapes;
  fitBounds(out);
  delete out.rotation;
  return out;
}

/// The angle (radians, -π to π) from the first pointer place to the second, seen from `centre`: how far the mouse has gone round it.
export function sweepAngle(centre: { x: number; y: number }, from: { x: number; y: number }, to: { x: number; y: number }): number {
  const a = Math.atan2(to.y - centre.y, to.x - centre.x) - Math.atan2(from.y - centre.y, from.x - centre.x);
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/// The factor for a pointer that was `d0` from the pivot on the screen and is now `d1`: how Blender sizes with the mouse (keeping a little off zero).
export const distanceFactor = (d0: number, d1: number): number => Math.max(0.01, d0 < 1 ? 1 : d1 / d0);
