// Inverse kinematics for a limb of three parts (an arm: upper arm, forearm, hand): given where the end should be, work out how much to turn the upper part and the
// middle part so the chain reaches it, bending towards a pole direction (where the elbow or knee points). The turns are the parts' own rotations in degrees, ready to be
// set as keys (`setKey`) or written to the parts.

import type { Quat } from "./model-ease";
import { partAt, type ModelDoc, type Vec3 } from "./model-doc";
import { transformPoint, worldMatrices, type Mat } from "./model-skin";

type V = Vec3;
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V): V => (len(a) > 1e-12 ? mul(a, 1 / len(a)) : [0, 0, 0]);

const qmul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qinv = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
export function rotate(q: Quat, v: V): V {
  const r = qmul(qmul(q, [v[0], v[1], v[2], 0]), qinv(q));
  return [r[0], r[1], r[2]];
}
/// The shortest turn that takes unit vector `a` onto unit vector `b`.
export function fromTo(a: V, b: V): Quat {
  const d = dot(a, b);
  if (d > 0.999999) return [0, 0, 0, 1];
  if (d < -0.999999) {
    // opposite: a half turn about any axis across `a`
    const axis = unit(Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]));
    return [axis[0], axis[1], axis[2], 0];
  }
  const c = cross(a, b);
  const q: Quat = [c[0], c[1], c[2], 1 + d];
  const l = Math.hypot(...q);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

/// Degrees, applied X then Y then Z: the inverse of `eulerToQuaternion` (three.js's "XYZ" order).
export function quaternionToEuler(q: Quat): V {
  const [x, y, z, w] = q;
  const m11 = 1 - 2 * (y * y + z * z);
  const m12 = 2 * (x * y - z * w);
  const m13 = 2 * (x * z + y * w);
  const m22 = 1 - 2 * (x * x + z * z);
  const m23 = 2 * (y * z - x * w);
  const m32 = 2 * (y * z + x * w);
  const m33 = 1 - 2 * (x * x + y * y);
  const ey = Math.asin(Math.max(-1, Math.min(1, m13)));
  let ex: number, ez: number;
  if (Math.abs(m13) < 0.9999999) {
    ex = Math.atan2(-m23, m33);
    ez = Math.atan2(-m12, m11);
  } else {
    ex = Math.atan2(m32, m22);
    ez = 0;
  }
  const deg = (r: number) => Math.round(((r * 180) / Math.PI) * 1e4) / 1e4;
  return [deg(ex), deg(ey), deg(ez)];
}

const rotationOf = (m: Mat): Quat => {
  // the turn part of a matrix of a turn, a size and a move (column-major), by dividing out the size of each axis
  const s = [Math.hypot(m[0]!, m[1]!, m[2]!), Math.hypot(m[4]!, m[5]!, m[6]!), Math.hypot(m[8]!, m[9]!, m[10]!)];
  const r = [m[0]! / s[0]!, m[1]! / s[0]!, m[2]! / s[0]!, m[4]! / s[1]!, m[5]! / s[1]!, m[6]! / s[1]!, m[8]! / s[2]!, m[9]! / s[2]!, m[10]! / s[2]!];
  const [r00, r10, r20, r01, r11, r21, r02, r12, r22] = r as [number, number, number, number, number, number, number, number, number];
  const trace = r00 + r11 + r22;
  if (trace > 0) {
    const k = 0.5 / Math.sqrt(trace + 1);
    return [(r21 - r12) * k, (r02 - r20) * k, (r10 - r01) * k, 0.25 / k];
  }
  if (r00 > r11 && r00 > r22) {
    const k = 2 * Math.sqrt(1 + r00 - r11 - r22);
    return [0.25 * k, (r01 + r10) / k, (r02 + r20) / k, (r21 - r12) / k];
  }
  if (r11 > r22) {
    const k = 2 * Math.sqrt(1 + r11 - r00 - r22);
    return [(r01 + r10) / k, 0.25 * k, (r12 + r21) / k, (r02 - r20) / k];
  }
  const k = 2 * Math.sqrt(1 + r22 - r00 - r11);
  return [(r02 + r20) / k, (r12 + r21) / k, 0.25 * k, (r10 - r01) / k];
};

export interface IkResult {
  /// The new rotation (degrees) of the upper part and of the middle part, in their own space.
  upper: V;
  middle: V;
  /// Whether the target was within reach (otherwise the limb is stretched straight towards it).
  reached: boolean;
}

/// The parts of a limb: `upper` is the part at the top (a shoulder or thigh), whose first child is the middle part (elbow, knee) and its first child the end.
/// `target` is where the end part's pivot should be, in model space (the same space as the model's own units); `pole` is the direction the joint should bend
/// towards, in model space (default: straight ahead, +z). Returns null when the chain is not three parts deep.
export function solveLimb(doc: ModelDoc, upperPath: number[], target: V, pole: V = [0, 0, 1]): IkResult | null {
  const upper = partAt(doc, upperPath);
  const middle = upper?.children[0];
  const end = middle?.children[0];
  if (!upper || !middle || !end) return null;
  // work at the rest pose: every part of the limb unturned, so that the bones' directions are their offsets
  const rest: ModelDoc = JSON.parse(JSON.stringify(doc));
  const u = partAt(rest, upperPath)!;
  u.rotation = [0, 0, 0];
  u.children[0]!.rotation = [0, 0, 0];
  const worlds = worldMatrices(rest);
  const names = (n: number) => {
    const out: string[] = [];
    let list = rest.parts;
    for (const i of upperPath.slice(0, n)) {
      out.push(list[i]!.name);
      list = list[i]!.children;
    }
    return out;
  };
  const key = (chain: string[]) => chain.join("/");
  const upperNames = names(upperPath.length);
  const middleNames = [...upperNames, middle.name];
  const endNames = [...middleNames, end.name];
  const A = transformPoint(worlds.get(key(upperNames))!, [0, 0, 0]);
  const B = transformPoint(worlds.get(key(middleNames))!, [0, 0, 0]);
  const C = transformPoint(worlds.get(key(endNames))!, [0, 0, 0]);
  const l1 = len(sub(B, A));
  const l2 = len(sub(C, B));
  if (l1 < 1e-9 || l2 < 1e-9) return null;
  const toTarget = sub(target, A);
  const dist = len(toTarget);
  const direction = unit(toTarget);
  const reach = Math.max(Math.abs(l1 - l2) + 1e-6, Math.min(l1 + l2 - 1e-6, dist));
  const reached = dist <= l1 + l2 + 1e-9;
  // the joint sits off the line from the top to the target, towards the pole
  const along = (l1 * l1 - l2 * l2 + reach * reach) / (2 * reach);
  const height = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  let side = sub(pole, mul(direction, dot(pole, direction)));
  if (len(side) < 1e-9) side = len(cross(direction, [0, 1, 0])) > 1e-6 ? cross(cross(direction, [0, 1, 0]), direction) : cross(cross(direction, [1, 0, 0]), direction);
  side = unit(side);
  const elbow = add(add(A, mul(direction, along)), mul(side, height));
  const tip = add(A, mul(direction, reach));
  const upperDir = unit(sub(elbow, A));
  const lowerDir = unit(sub(tip, elbow));
  // how each part must turn (in its own space) so that its bone points the new way
  const parentWorld = upperPath.length > 1 ? worlds.get(key(upperNames.slice(0, -1)))! : null;
  const Rp: Quat = parentWorld ? rotationOf(parentWorld) : [0, 0, 0, 1];
  const restUpper = unit(middle.origin);
  const swing1 = fromTo(rotate(Rp, restUpper), upperDir);
  const Qu = qmul(swing1, Rp); // the upper part's new world turn
  const qUpper = qmul(qmul(qinv(Rp), swing1), Rp);
  const restLower = unit(end.origin);
  const swing2 = fromTo(rotate(Qu, restLower), lowerDir);
  const qMiddle = qmul(qmul(qinv(Qu), swing2), Qu);
  return { upper: quaternionToEuler(qUpper), middle: quaternionToEuler(qMiddle), reached };
}

/// Where the end part's pivot would be in model space if the limb's upper and middle parts had these turns (to check a result, and to show it).
export function limbEnd(doc: ModelDoc, upperPath: number[], upper: V, middle: V): V | null {
  const u = partAt(doc, upperPath);
  if (!u?.children[0]?.children[0]) return null;
  const next: ModelDoc = JSON.parse(JSON.stringify(doc));
  const nu = partAt(next, upperPath)!;
  nu.rotation = [...upper];
  nu.children[0]!.rotation = [...middle];
  const names: string[] = [];
  let list = next.parts;
  for (const i of upperPath) {
    names.push(list[i]!.name);
    list = list[i]!.children;
  }
  const endKey = [...names, nu.children[0]!.name, nu.children[0]!.children[0]!.name].join("/");
  const m = worldMatrices(next).get(endKey);
  return m ? transformPoint(m, [0, 0, 0]) : null;
}

