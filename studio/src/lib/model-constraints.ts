// Constraints on parts: rules that adjust a pose after the animation has said what it is. "limit" keeps a turn between bounds, "copy" follows another part's turn, "reach" bends a
// three-part limb so its end meets a target. `constrainedPose` applies them to a sampled pose (for showing a model); `bakeConstraints` writes what they do into plain keys, which is
// what the game plays and what is exported (the game does not know about constraints).

import { eulerToQuaternion } from "./model-ease";
import { MAX_CONSTRAINTS, MAX_KEYS, walk, type Clip, type Constraint, type ModelDoc, type Part, type Vec3 } from "./model-doc";
import { samplePose, setKey, snapTime, type Pose } from "./model-anim";
import { quaternionToEuler, solveLimb } from "./model-ik";

const key = (names: string[]) => names.join("/");

interface Entry {
  part: Part;
  path: string;
  names: string[];
  parts: number[];
}

function entries(doc: ModelDoc): Entry[] {
  return walk(doc).map(({ part, parts }) => {
    const names: string[] = [];
    let list = doc.parts;
    for (const i of parts) {
      names.push(list[i]!.name);
      list = list[i]!.children;
    }
    return { part, path: key(names), names, parts };
  });
}

const clampDeg = (v: number, lo: number, hi: number) => (lo <= hi ? Math.min(hi, Math.max(lo, v)) : Math.min(lo, Math.max(hi, v)));

/// The pose with every part's constraints applied, parents first. Parts the pose does not mention are at their authored turn. Returns a new map (the input is not changed) that
/// holds a rotation for every part a constraint changed.
export function constrainedPose(doc: ModelDoc, pose: Map<string, Pose>): Map<string, Pose> {
  const list = entries(doc);
  if (!list.some((e) => e.part.constraints?.length)) return pose;
  // each part's turn as degrees: from the pose when it keys one, else as authored
  const euler = new Map<string, Vec3>();
  for (const e of list) {
    const q = pose.get(e.path)?.rotation;
    euler.set(e.path, q ? quaternionToEuler(q) : ([...e.part.rotation] as Vec3));
  }
  const changed = new Set<string>();
  for (const e of list) {
    for (const c of e.part.constraints ?? []) {
      const mine = euler.get(e.path)!;
      if (c.type === "limit") {
        const next: Vec3 = [clampDeg(mine[0], c.min[0], c.max[0]), clampDeg(mine[1], c.min[1], c.max[1]), clampDeg(mine[2], c.min[2], c.max[2])];
        euler.set(e.path, next);
        changed.add(e.path);
      } else if (c.type === "copy") {
        const src = euler.get(c.from);
        if (!src) continue;
        const next = mine.map((v, a) => (c.axes[a] ? v + (src[a]! - v) * c.mix : v)) as Vec3;
        euler.set(e.path, next);
        changed.add(e.path);
      } else {
        // the limb: this part, its first child and that child's first child, at the turns so far
        const middle = e.part.children[0];
        if (!middle?.children[0]) continue;
        const probe: ModelDoc = JSON.parse(JSON.stringify(doc));
        for (const other of entries(probe)) other.part.rotation = [...(euler.get(other.path) ?? other.part.rotation)] as Vec3;
        const r = solveLimb(probe, e.parts, c.target, c.pole ?? [0, 0, 1]);
        if (!r) continue;
        euler.set(e.path, r.upper);
        const middlePath = key([...e.names, middle.name]);
        euler.set(middlePath, r.middle);
        changed.add(e.path);
        changed.add(middlePath);
      }
    }
  }
  const out = new Map(pose);
  for (const p of changed) out.set(p, { ...(pose.get(p) ?? {}), rotation: eulerToQuaternion(euler.get(p)!) });
  return out;
}

export interface BakeResult {
  doc: ModelDoc;
  /// The parts whose rotation keys were written.
  baked: string[];
}

/// Writes what the constraints do over a clip as plain rotation keys: for each time step the clip is sampled, constrained, and the turns of the constrained parts (and the middle
/// part of a reach) become keys, replacing any rotation keys those parts had. The step is 1/`fps` seconds, longer when the clip would need more keys than a track may hold.
/// With `remove` the constraints are taken off afterwards. A model with no constraints comes back as it was.
export function bakeConstraints(doc: ModelDoc, clipIndex: number, fps = 30, remove = false): BakeResult {
  const clip = doc.clips?.[clipIndex];
  const list = entries(doc);
  const constrained = new Set<string>();
  for (const e of list) {
    if (!e.part.constraints?.length) continue;
    constrained.add(e.path);
    if (e.part.constraints.some((c) => c.type === "reach") && e.part.children[0]) constrained.add(key([...e.names, e.part.children[0].name]));
  }
  if (!clip || !constrained.size) return { doc, baked: [] };
  const step = Math.max(1 / Math.max(1, fps), clip.duration / (MAX_KEYS - 2), 0.01);
  let next: ModelDoc = JSON.parse(JSON.stringify(doc));
  // the old rotation keys of the constrained parts go: the baked ones are the whole truth
  next.clips![clipIndex]!.tracks = next.clips![clipIndex]!.tracks.filter((t) => !(t.prop === "rotation" && constrained.has(key(t.part))));
  const times: number[] = [];
  for (let t = 0; t < clip.duration - 1e-9; t += step) times.push(snapTime(t));
  times.push(clip.duration);
  for (const t of times) {
    const pose = constrainedPose(doc, samplePose(clip as Clip, t, false));
    for (const e of list) {
      if (!constrained.has(e.path)) continue;
      const q = pose.get(e.path)?.rotation;
      next = setKey(next, clipIndex, e.names, "rotation", t, q ? quaternionToEuler(q) : e.part.rotation);
    }
  }
  if (remove) for (const e of entries(next)) delete e.part.constraints;
  return { doc: next, baked: [...constrained] };
}

/// The part's constraints replaced by a list (an empty list takes them all off). At most MAX_CONSTRAINTS are kept.
export function setConstraints(doc: ModelDoc, parts: number[], list: Constraint[]): ModelDoc {
  const next: ModelDoc = JSON.parse(JSON.stringify(doc));
  const target = walk(next).find((w) => w.parts.length === parts.length && w.parts.every((v, i) => v === parts[i]));
  if (!target) return doc;
  if (list.length) target.part.constraints = list.slice(0, MAX_CONSTRAINTS).map((c) => JSON.parse(JSON.stringify(c)));
  else delete target.part.constraints;
  return next;
}
