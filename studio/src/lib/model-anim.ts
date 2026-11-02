// Animation clips for the model editor: editing keys and sampling a clip at a time. The sampling matches what the
// runtime does with the exported glTF (linear blends, rotations blended as quaternions, held before the first key
// and after the last).

import { eulerToQuaternion } from "./glb";
import { MAX_CLIPS, MAX_KEYS, type Clip, type ModelDoc, type Prop, type Track, type Vec3 } from "./model-doc";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
export const KEY_STEP = 0.01;
export const snapTime = (t: number) => Math.round(t / KEY_STEP) * KEY_STEP;
const round = (t: number) => Math.round(t * 1000) / 1000;
export const pathKey = (part: string[]) => part.join("/");

export function addClip(doc: ModelDoc, name = "clip"): { doc: ModelDoc; index: number } {
  if ((doc.clips?.length ?? 0) >= MAX_CLIPS) return { doc, index: (doc.clips?.length ?? 1) - 1 };
  const next = clone(doc);
  const clips = (next.clips ??= []);
  const used = new Set(clips.map((c) => c.name));
  let unique = name;
  for (let n = 2; used.has(unique); n++) unique = `${name}${n}`;
  clips.push({ name: unique, duration: 1, loop: true, tracks: [] });
  return { doc: next, index: clips.length - 1 };
}

export function removeClip(doc: ModelDoc, index: number): ModelDoc {
  if (!doc.clips?.[index]) return doc;
  const next = clone(doc);
  next.clips!.splice(index, 1);
  if (next.clips!.length === 0) delete next.clips;
  return next;
}

/// Renames, resizes or sets looping. A shorter duration drops keys past the new end.
export function updateClip(doc: ModelDoc, index: number, change: Partial<Pick<Clip, "name" | "duration" | "loop">>): ModelDoc {
  const c0 = doc.clips?.[index];
  if (!c0) return doc;
  const next = clone(doc);
  const c = next.clips![index]!;
  if (change.name !== undefined && change.name.trim() && !next.clips!.some((o, i) => i !== index && o.name === change.name!.trim())) c.name = change.name.trim();
  if (change.loop !== undefined) c.loop = change.loop;
  if (change.duration !== undefined && Number.isFinite(change.duration)) {
    c.duration = Math.min(600, Math.max(0.1, round(change.duration)));
    for (const t of c.tracks) t.keys = t.keys.filter((k) => k.t <= c.duration + 1e-9);
    c.tracks = c.tracks.filter((t) => t.keys.length > 0);
  }
  return next;
}

export const findTrack = (clip: Clip, part: string[], prop: Prop): Track | undefined => clip.tracks.find((t) => t.prop === prop && pathKey(t.part) === pathKey(part));

/// Sets the value of a property at a time (replacing a key already there). Times snap to a hundredth of a second.
export function setKey(doc: ModelDoc, clipIndex: number, part: string[], prop: Prop, t: number, value: Vec3): ModelDoc {
  if (!doc.clips?.[clipIndex] || part.length === 0 || !value.every(Number.isFinite)) return doc;
  const next = clone(doc);
  const clip = next.clips![clipIndex]!;
  const time = round(Math.min(clip.duration, Math.max(0, snapTime(t))));
  let track = findTrack(clip, part, prop);
  if (!track) {
    track = { part: [...part], prop, keys: [] };
    clip.tracks.push(track);
  }
  const at = track.keys.findIndex((k) => Math.abs(k.t - time) < KEY_STEP / 2);
  if (at >= 0) track.keys[at] = { t: track.keys[at]!.t, value: [...value] };
  else if (track.keys.length >= MAX_KEYS) return doc;
  else {
    track.keys.push({ t: time, value: [...value] });
    track.keys.sort((a, b) => a.t - b.t);
  }
  return next;
}

export function removeKey(doc: ModelDoc, clipIndex: number, part: string[], prop: Prop, t: number): ModelDoc {
  const clip = doc.clips?.[clipIndex];
  const track = clip && findTrack(clip, part, prop);
  if (!clip || !track || !track.keys.some((k) => Math.abs(k.t - t) < KEY_STEP / 2)) return doc;
  const next = clone(doc);
  const c = next.clips![clipIndex]!;
  const tr = findTrack(c, part, prop)!;
  tr.keys = tr.keys.filter((k) => Math.abs(k.t - t) >= KEY_STEP / 2);
  c.tracks = c.tracks.filter((x) => x.keys.length > 0);
  return next;
}

export interface Pose {
  position?: Vec3;
  /// Quaternion x, y, z, w.
  rotation?: [number, number, number, number];
  scale?: Vec3;
}

const lerp3 = (a: Vec3, b: Vec3, f: number): Vec3 => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];

function slerp(a: [number, number, number, number], b: [number, number, number, number], f: number): [number, number, number, number] {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const flip = dot < 0 ? -1 : 1; // take the short way round
  dot *= flip;
  const mix = (k: number) => a[k]! * (1 - f) + flip * b[k]! * f;
  let q: [number, number, number, number];
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

/// The time a clip is read at: wrapped when looping, held at the ends otherwise.
export function clipTime(clip: Clip, t: number, loop = clip.loop): number {
  if (!Number.isFinite(t)) return 0;
  return loop ? ((t % clip.duration) + clip.duration) % clip.duration : Math.min(clip.duration, Math.max(0, t));
}

/// What a clip says about each keyed part at time `t`, by part path (`pathKey`). Unkeyed properties are absent.
export function samplePose(clip: Clip, t: number, loop = clip.loop): Map<string, Pose> {
  const time = clipTime(clip, t, loop);
  const out = new Map<string, Pose>();
  for (const track of clip.tracks) {
    if (track.keys.length === 0) continue;
    const keys = track.keys;
    let i = -1;
    for (let k = 0; k < keys.length; k++) if (keys[k]!.t <= time) i = k;
    let value: Vec3;
    let quat: [number, number, number, number] | undefined;
    const asQuat = (v: Vec3) => eulerToQuaternion(v);
    if (i < 0) {
      value = keys[0]!.value;
      quat = track.prop === "rotation" ? asQuat(value) : undefined;
    } else if (i >= keys.length - 1) {
      value = keys[keys.length - 1]!.value;
      quat = track.prop === "rotation" ? asQuat(value) : undefined;
    } else {
      const a = keys[i]!;
      const b = keys[i + 1]!;
      const f = (time - a.t) / (b.t - a.t);
      value = lerp3(a.value, b.value, f);
      quat = track.prop === "rotation" ? slerp(asQuat(a.value), asQuat(b.value), f) : undefined;
    }
    const pose = out.get(pathKey(track.part)) ?? {};
    if (track.prop === "position") pose.position = value;
    else if (track.prop === "scale") pose.scale = value;
    else pose.rotation = quat;
    out.set(pathKey(track.part), pose);
  }
  return out;
}
