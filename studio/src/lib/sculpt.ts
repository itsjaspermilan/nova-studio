// Sculpting a mesh with brushes: each dab moves the points near a spot by a falloff, in one of a few ways. Pure functions on a mesh element (the editor
// finds the spot with a ray and calls them as the pointer moves, one undo step a stroke).

import { falloffWeight, type Falloff } from "./mesh-ops";
import { toMesh } from "./mesh-edit";
import { fitBounds, type Cube, type Vec3 } from "./model-doc";
import { polyNormal } from "./model-mesh";

export type SculptMode = "draw" | "inflate" | "smooth" | "pinch" | "flatten" | "grab";
export const SCULPT_MODES: SculptMode[] = ["draw", "inflate", "smooth", "pinch", "flatten", "grab"];
export const SCULPT_HELP: Record<SculptMode, string> = {
  draw: "Push the surface out (hold Ctrl to pull it in), along the way the spot faces",
  inflate: "Push every point out along its own normal, like blowing it up",
  smooth: "Relax the points towards their neighbours to even out bumps",
  pinch: "Pull the points towards the middle of the brush, to sharpen a crease",
  flatten: "Press the points onto the average plane under the brush",
  grab: "Drag the points under the brush along with the pointer",
};

export interface SculptBrush {
  mode: SculptMode;
  /// Units across the brush (radius).
  radius: number;
  /// 0 to 1: how much of its full effect one dab has.
  strength: number;
  falloff?: Falloff;
  /// Reverse the effect (draw pulls in, inflate shrinks, pinch pushes apart).
  invert?: boolean;
  /// Also sculpt the mirror image across the plane x = 0 (the part's own centre line).
  symmetryX?: boolean;
}

type V = Vec3;
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V): V => (len(a) > 1e-12 ? mul(a, 1 / len(a)) : [0, 0, 0]);

/// The normal at each point: the sum of the normals of the polygons that use it, scaled to length 1 (a point no polygon uses gets zero).
export function vertexNormals(c: Cube): V[] {
  const verts = c.verts ?? [];
  const out: V[] = verts.map(() => [0, 0, 0] as V);
  for (const f of c.polys ?? []) {
    const n = polyNormal(verts, f.v);
    for (const i of f.v) out[i] = add(out[i]!, n);
  }
  return out.map(unit);
}

function neighbourLists(c: Cube): number[][] {
  const out: Set<number>[] = (c.verts ?? []).map(() => new Set<number>());
  for (const f of c.polys ?? []) f.v.forEach((a, k) => {
    const b = f.v[(k + 1) % f.v.length]!;
    out[a]!.add(b);
    out[b]!.add(a);
  });
  return out.map((s) => [...s]);
}

/// One dab of the brush at `center` (in the mesh's own space). `delta` is how far the pointer moved since the last dab, for the grab brush.
/// Returns a new mesh element (the shape is made a mesh first).
export function sculptDab(source: Cube, center: V, brush: SculptBrush, delta: V = [0, 0, 0]): Cube {
  const c = toMesh(source);
  const verts = (c.verts ?? []).map((p) => [...p] as V);
  const r = Math.max(1e-6, brush.radius);
  const falloff = brush.falloff ?? "smooth";
  const strength = Math.min(1, Math.max(0, brush.strength));
  const sign = brush.invert ? -1 : 1;
  const normals = vertexNormals(c);
  const nb = brush.mode === "smooth" ? neighbourLists(c) : null;
  const dabs: V[] = [center];
  if (brush.symmetryX) dabs.push([-center[0], center[1], center[2]]);
  const next = verts.map((p) => [...p] as V);
  for (const [di, at] of dabs.entries()) {
    const mirrored = di === 1;
    const near: { i: number; w: number }[] = [];
    for (let i = 0; i < verts.length; i++) {
      const d = len(sub(verts[i]!, at));
      if (d < r) near.push({ i, w: falloffWeight(falloff, d / r) * strength });
    }
    if (!near.length) continue;
    // the average way the surface faces under the brush (weighted), and the average plane
    let facing: V = [0, 0, 0];
    let middle: V = [0, 0, 0];
    let total = 0;
    for (const { i, w } of near) {
      facing = add(facing, mul(normals[i]!, w));
      middle = add(middle, mul(verts[i]!, w));
      total += w;
    }
    facing = unit(facing);
    middle = total > 0 ? mul(middle, 1 / total) : at;
    const step = r * 0.1; // a full-strength dab moves a point a tenth of the brush
    for (const { i, w } of near) {
      const p = next[i]!;
      switch (brush.mode) {
        case "draw": next[i] = add(p, mul(facing, step * w * sign)); break;
        case "inflate": next[i] = add(p, mul(normals[i]!, step * w * sign)); break;
        case "pinch": {
          const toward = sub(at, p);
          next[i] = add(p, mul(toward, 0.3 * w * sign));
          break;
        }
        case "flatten": {
          const off = dot(sub(p, middle), facing);
          next[i] = sub(p, mul(facing, off * Math.min(1, w)));
          break;
        }
        case "smooth": {
          const list = nb![i]!;
          if (!list.length) break;
          let avg: V = [0, 0, 0];
          for (const j of list) avg = add(avg, verts[j]!);
          avg = mul(avg, 1 / list.length);
          next[i] = add(p, mul(sub(avg, p), Math.min(1, w)));
          break;
        }
        case "grab": next[i] = add(p, mul(mirrored ? [-delta[0], delta[1], delta[2]] : delta, w)); break;
      }
    }
  }
  c.verts = next;
  fitBounds(c);
  return c;
}

/// Where the brush's footprint lies: the indices of the points inside it (for showing it).
export const pointsUnder = (c: Cube, center: V, radius: number): number[] => (c.verts ?? []).flatMap((p, i) => (len(sub(p, center)) < radius ? [i] : []));
