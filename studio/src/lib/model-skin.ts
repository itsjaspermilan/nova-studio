// Skinning: a mesh that bends with the model's parts (the part tree is the skeleton). Each point follows up to four parts with
// weights; at any pose its place is the weighted sum of where each part would carry it. This module makes the weights (near a
// joint a point leans on both parts, far from it on one) and does the sum, for the editor's view and for tests; the exporter
// writes the same weights as a glTF skin.

import { eulerToQuaternion, type Quat } from "./model-ease";
import { cubeAt, partAt, setCube, type Cube, type ModelDoc, type Part, type Path, type Skin, type Vec3 } from "./model-doc";

/// A 4x4 matrix, column-major (the way three.js and glTF keep them).
export type Mat = number[];

export const IDENTITY: Mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function multiply(a: Mat, b: Mat): Mat {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r]! += a[k * 4 + r]! * b[c * 4 + k]!;
  return out;
}

export function compose(t: Vec3, q: Quat, s: Vec3): Mat {
  const [x, y, z, w] = q;
  const [xx, yy, zz, xy, xz, yz, wx, wy, wz] = [x * x, y * y, z * z, x * y, x * z, y * z, w * x, w * y, w * z];
  return [
    (1 - 2 * (yy + zz)) * s[0], 2 * (xy + wz) * s[0], 2 * (xz - wy) * s[0], 0,
    2 * (xy - wz) * s[1], (1 - 2 * (xx + zz)) * s[1], 2 * (yz + wx) * s[1], 0,
    2 * (xz + wy) * s[2], 2 * (yz - wx) * s[2], (1 - 2 * (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

/// The inverse of a matrix made of a turn, a size and a move.
export function invertAffine(m: Mat): Mat {
  const [a, b, c, d, e, f, g, h, i] = [m[0]!, m[1]!, m[2]!, m[4]!, m[5]!, m[6]!, m[8]!, m[9]!, m[10]!];
  const det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
  const k = det === 0 ? 0 : 1 / det;
  // inverse of the 3x3 (rows of the result), entries as (row, column) of the input stored by column
  const inv = [
    (e * i - f * h) * k, (c * h - b * i) * k, (b * f - c * e) * k,
    (f * g - d * i) * k, (a * i - c * g) * k, (c * d - a * f) * k,
    (d * h - e * g) * k, (b * g - a * h) * k, (a * e - b * d) * k,
  ];
  const [tx, ty, tz] = [m[12]!, m[13]!, m[14]!];
  return [
    inv[0]!, inv[1]!, inv[2]!, 0,
    inv[3]!, inv[4]!, inv[5]!, 0,
    inv[6]!, inv[7]!, inv[8]!, 0,
    -(inv[0]! * tx + inv[3]! * ty + inv[6]! * tz), -(inv[1]! * tx + inv[4]! * ty + inv[7]! * tz), -(inv[2]! * tx + inv[5]! * ty + inv[8]! * tz), 1,
  ];
}

export const transformPoint = (m: Mat, p: Vec3): Vec3 => [m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!, m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!, m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!];
/// A direction (no move), for normals.
export const transformDirection = (m: Mat, d: Vec3): Vec3 => [m[0]! * d[0] + m[4]! * d[1] + m[8]! * d[2], m[1]! * d[0] + m[5]! * d[1] + m[9]! * d[2], m[2]! * d[0] + m[6]! * d[1] + m[10]! * d[2]];

export const boneKey = (names: string[]) => names.join("/");

export interface PartPose {
  position?: Vec3;
  rotation?: Quat;
  scale?: Vec3;
}

/// Where every part is in the model, by part path ("body/arm"). `pose` replaces what a part's own place says (as a clip does).
export function worldMatrices(doc: ModelDoc, pose: Map<string, PartPose> = new Map()): Map<string, Mat> {
  const out = new Map<string, Mat>();
  const visit = (parts: Part[], names: string[], parent: Mat) => {
    for (const part of parts) {
      const chain = [...names, part.name];
      const key = boneKey(chain);
      const p = pose.get(key);
      const local = compose(p?.position ?? part.origin, p?.rotation ?? eulerToQuaternion(part.rotation), p?.scale ?? [1, 1, 1]);
      const world = multiply(parent, local);
      out.set(key, world);
      visit(part.children, chain, world);
    }
  };
  visit(doc.parts, [], IDENTITY);
  return out;
}

/// The names of the parts above and including the part a path points at.
const chainOf = (doc: ModelDoc, parts: number[]): string[] => {
  const names: string[] = [];
  let list = doc.parts;
  for (const i of parts) {
    const p = list[i];
    if (!p) break;
    names.push(p.name);
    list = p.children;
  }
  return names;
};

const distanceToSegment = (p: Vec3, a: Vec3, b: Vec3): number => {
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / len2));
  return Math.hypot(p[0] - (a[0] + ab[0] * t), p[1] - (a[1] + ab[1] * t), p[2] - (a[2] + ab[2] * t));
};

/// Weights for a mesh from how close each point is to the parts around it. Only the part the mesh is in, the part above it and the
/// parts directly below it are candidates (so a sleeve bends at the elbow and shoulder but is not pulled by the other arm). A part
/// reaches along its limb (see below). Null when the shape is not a mesh.
export function autoWeights(doc: ModelDoc, path: Path): Skin | null {
  const cube = cubeAt(doc, path);
  if (!cube || cube.shape !== "mesh" || !cube.verts?.length) return null;
  const world = worldMatrices(doc);
  const ownerNames = chainOf(doc, path.parts);
  const owner = partAt(doc, path.parts);
  if (!owner || !ownerNames.length) return null;
  const candidates: string[][] = [ownerNames];
  if (ownerNames.length > 1) candidates.push(ownerNames.slice(0, -1));
  for (const child of owner.children) candidates.push([...ownerNames, child.name]);
  const origin = (names: string[]): Vec3 => {
    const m = world.get(boneKey(names))!;
    return [m[12]!, m[13]!, m[14]!];
  };
  // The part the mesh is in reaches from its pivot to the pivot of its first child (or, for a last part, on the way it points from its
  // parent). The part above reaches on from the pivot the other way, and each part below on past its own pivot, by half as far:
  // so at a joint the neighbours share the weight, and along a limb the mesh's own part leads.
  const ownerStart = origin(ownerNames);
  const ownerEnd: Vec3 = owner.children.length
    ? origin([...ownerNames, owner.children[0]!.name])
    : ownerNames.length > 1
      ? ((up) => [ownerStart[0] + (ownerStart[0] - up[0]) * 0.5, ownerStart[1] + (ownerStart[1] - up[1]) * 0.5, ownerStart[2] + (ownerStart[2] - up[2]) * 0.5] as Vec3)(origin(ownerNames.slice(0, -1)))
      : [ownerStart[0], ownerStart[1] + 4, ownerStart[2]];
  const axis: Vec3 = [ownerEnd[0] - ownerStart[0], ownerEnd[1] - ownerStart[1], ownerEnd[2] - ownerStart[2]];
  const half: Vec3 = [axis[0] * 0.5, axis[1] * 0.5, axis[2] * 0.5];
  const segments: [Vec3, Vec3][] = candidates.map((names, i) => {
    if (i === 0) return [ownerStart, ownerEnd];
    if (names.length < ownerNames.length) return [ownerStart, [ownerStart[0] - half[0], ownerStart[1] - half[1], ownerStart[2] - half[2]]];
    const start = origin(names);
    return [start, [start[0] + half[0], start[1] + half[1], start[2] + half[2]]];
  });
  const toWorld = world.get(boneKey(ownerNames))!;
  const used = new Map<string, number>();
  const bones: string[] = [];
  const weights: [number, number][][] = cube.verts.map((v) => {
    const p = transformPoint(toWorld, v);
    const raw = segments.map(([a, b], i) => ({ i, w: 1 / (distanceToSegment(p, a, b) + 0.5) ** 4 }));
    raw.sort((x, y) => y.w - x.w);
    const top = raw.slice(0, 4).filter((r) => r.w >= raw[0]!.w * 0.02);
    const sum = top.reduce((n, r) => n + r.w, 0);
    return top.map((r) => {
      const key = boneKey(candidates[r.i]!);
      if (!used.has(key)) {
        used.set(key, bones.length);
        bones.push(key);
      }
      return [used.get(key)!, Math.round((r.w / sum) * 10000) / 10000] as [number, number];
    });
  });
  // rounding may leave a sum of 0.9999 or 1.0001: put the difference on the biggest weight
  for (const w of weights) {
    const total = w.reduce((n, [, x]) => n + x, 0);
    const big = w.reduce((m, pair) => (pair[1] > m[1] ? pair : m), w[0]!);
    big[1] = Math.round((big[1] + (1 - total)) * 10000) / 10000;
  }
  return { bones, weights };
}

/// Where every point of a skinned mesh is, in the model's space, when the parts are at `posed` (from `worldMatrices` with a pose).
/// `rest` is `worldMatrices(doc)`. A part that no longer exists counts as staying where it was.
export function skinnedPoints(doc: ModelDoc, path: Path, posed: Map<string, Mat>, rest: Map<string, Mat> = worldMatrices(doc)): Vec3[] | null {
  const cube = cubeAt(doc, path);
  const skin = cube?.skin;
  if (!cube || !skin || !cube.verts) return null;
  const ownerWorld = rest.get(boneKey(chainOf(doc, path.parts)));
  if (!ownerWorld) return null;
  const joint = skin.bones.map((b) => {
    const [r, p] = [rest.get(b), posed.get(b)];
    return r && p ? multiply(p, invertAffine(r)) : IDENTITY;
  });
  return cube.verts.map((v, i) => {
    const bind = transformPoint(ownerWorld, v);
    const out: Vec3 = [0, 0, 0];
    for (const [b, w] of skin.weights[i]!) {
      const moved = transformPoint(joint[b]!, bind);
      out[0] += moved[0] * w;
      out[1] += moved[1] * w;
      out[2] += moved[2] * w;
    }
    return out;
  });
}

/// A copy of the mesh with a weight changed for some points: `bone` gets `weight` and the other bones share the rest in the
/// proportions they had. A new bone is added to the list when needed. At most four bones are kept per point (the smallest go).
export function setWeight(cube: Cube, points: number[], bone: string, weight: number): Cube {
  if (!cube.skin || !Number.isFinite(weight)) return cube;
  const out: Cube = JSON.parse(JSON.stringify(cube));
  const skin = out.skin!;
  let index = skin.bones.indexOf(bone);
  if (index < 0) {
    if (skin.bones.length >= 64) return cube;
    index = skin.bones.push(bone) - 1;
  }
  const w = Math.min(1, Math.max(0, weight));
  for (const p of new Set(points)) {
    if (!skin.weights[p]) continue;
    const others = skin.weights[p]!.filter(([b]) => b !== index);
    const sum = others.reduce((n, [, x]) => n + x, 0);
    let next: [number, number][] = [];
    if (w > 0) next.push([index, w]);
    for (const [b, x] of others) if (sum > 0 && w < 1) next.push([b, (x / sum) * (1 - w)]);
    if (!next.length) next = [[index, 1]];
    next.sort((a, b) => b[1] - a[1]);
    next = next.slice(0, 4);
    const total = next.reduce((n, [, x]) => n + x, 0);
    next = next.map(([b, x]) => [b, Math.round((x / total) * 10000) / 10000]);
    const big = next.reduce((m, pair) => (pair[1] > m[1] ? pair : m), next[0]!);
    big[1] = Math.round((big[1] + (1 - next.reduce((n, [, x]) => n + x, 0))) * 10000) / 10000;
    skin.weights[p] = next;
  }
  return out;
}

/// The strongest bone of each point, as the number in `skin.bones` (for colouring points in the editor).
export const dominantBones = (skin: Skin): number[] => skin.weights.map((w) => w.reduce((m, pair) => (pair[1] > m[1] ? pair : m), w[0]!)[0]);

/// After an edit that changed how many points a skinned mesh has, the weights no longer line up: they are worked out again
/// (weights set by hand are lost). Meshes whose weights still fit are left alone.
export function reskin(doc: ModelDoc, path: Path): ModelDoc {
  const cube = cubeAt(doc, path);
  if (!cube?.skin || !cube.verts || cube.skin.weights.length === cube.verts.length) return doc;
  const skin = autoWeights(doc, path);
  const { skin: _old, ...rest } = cube;
  return setCube(doc, path, skin ? { ...rest, skin } : rest);
}
