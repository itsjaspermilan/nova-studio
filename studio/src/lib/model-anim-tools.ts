// Tools for editing a clip's keys as a whole: copy and paste a part's keys, shift or stretch time, reverse, and blend two poses. Every edit returns a new
// document (the clip index must exist). Times snap to a hundredth of a second like the rest of the animation code.

import { KEY_STEP, findTrack, pathKey, samplePose, setKey, snapTime, type Pose } from "./model-anim";
import { MAX_KEYS, type Clip, type Key, type ModelDoc, type Prop, type Track } from "./model-doc";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const round = (n: number) => Math.round(n * 1e4) / 1e4;
const sortKeys = (keys: Key[]) => keys.sort((a, b) => a.t - b.t);

/// Keys taken from a clip, times counted from the first copied key.
export interface KeyClipboard {
  tracks: { part: string[]; prop: Prop; keys: Key[] }[];
  /// How long the copied run is (the last key's time).
  length: number;
}

/// The keys of one part (all its properties, or one) between `from` and `to` seconds, for pasting elsewhere. null when there are none.
export function copyKeys(clip: Clip, part: string[], from = 0, to = clip.duration, prop?: Prop): KeyClipboard | null {
  const tracks: KeyClipboard["tracks"] = [];
  let start = Infinity;
  const picked = clip.tracks.filter((t) => pathKey(t.part) === pathKey(part) && (!prop || t.prop === prop));
  for (const t of picked) for (const k of t.keys) if (k.t >= from - KEY_STEP / 2 && k.t <= to + KEY_STEP / 2) start = Math.min(start, k.t);
  if (!Number.isFinite(start)) return null;
  let length = 0;
  for (const t of picked) {
    const keys = t.keys.filter((k) => k.t >= from - KEY_STEP / 2 && k.t <= to + KEY_STEP / 2).map((k) => ({ ...clone(k), t: round(k.t - start) }));
    if (!keys.length) continue;
    length = Math.max(length, keys[keys.length - 1]!.t);
    tracks.push({ part: [...t.part], prop: t.prop, keys });
  }
  return { tracks, length };
}

/// Puts copied keys into a clip with the first one at `at` seconds, on `onto` (a part path) when given or on the part they came from. Keys that land on
/// an existing key's time replace it; keys past the clip's end are left out.
export function pasteKeys(doc: ModelDoc, clipIndex: number, board: KeyClipboard, at: number, onto?: string[]): ModelDoc {
  const src = doc.clips?.[clipIndex];
  if (!src) return doc;
  const next = clone(doc);
  const clip = next.clips![clipIndex]!;
  const t0 = Math.max(0, snapTime(at));
  for (const t of board.tracks) {
    const part = onto ?? t.part;
    let track = findTrack(clip, part, t.prop);
    for (const k of t.keys) {
      const time = round(snapTime(t0 + k.t));
      if (time > clip.duration + KEY_STEP / 2) continue;
      if (!track) {
        track = { part: [...part], prop: t.prop, keys: [] };
        clip.tracks.push(track);
      }
      const at2 = track.keys.findIndex((x) => Math.abs(x.t - time) < KEY_STEP / 2);
      const key: Key = { ...clone(k), t: time };
      if (at2 >= 0) track.keys[at2] = key;
      else if (track.keys.length < MAX_KEYS) track.keys.push(key);
    }
    if (track) sortKeys(track.keys);
  }
  return next;
}

/// Moves every key of the chosen part (or of the whole clip when `part` is null) by `delta` seconds; keys pushed outside the clip are dropped.
export function shiftKeys(doc: ModelDoc, clipIndex: number, delta: number, part: string[] | null = null): ModelDoc {
  return retime(doc, clipIndex, part, (t) => t + delta);
}

/// Stretches the keys' times by a factor (2 makes it twice as slow) about time 0, for the chosen part or the whole clip; keys past the end are dropped.
export function stretchKeys(doc: ModelDoc, clipIndex: number, factor: number, part: string[] | null = null): ModelDoc {
  if (!(factor > 0) || !Number.isFinite(factor)) return doc;
  return retime(doc, clipIndex, part, (t) => t * factor);
}

function retime(doc: ModelDoc, clipIndex: number, part: string[] | null, fn: (t: number) => number): ModelDoc {
  if (!doc.clips?.[clipIndex]) return doc;
  const next = clone(doc);
  const clip = next.clips![clipIndex]!;
  for (const t of clip.tracks) {
    if (part && pathKey(t.part) !== pathKey(part)) continue;
    const moved: Key[] = [];
    for (const k of t.keys) {
      const time = round(snapTime(fn(k.t)));
      if (time < 0 || time > clip.duration + KEY_STEP / 2) continue;
      if (moved.some((m) => Math.abs(m.t - time) < KEY_STEP / 2)) continue; // two keys squeezed onto one time: the first stays
      moved.push({ ...k, t: time });
    }
    t.keys = sortKeys(moved);
  }
  clip.tracks = clip.tracks.filter((t) => t.keys.length > 0);
  return next;
}

const flipEase = (e: Key["ease"]): Key["ease"] => (e === "in" ? "out" : e === "out" ? "in" : e);

/// The clip played backwards: every key at `duration - t` (the way a key eases into the next is reversed with it).
export function reverseClip(doc: ModelDoc, clipIndex: number): ModelDoc {
  const src = doc.clips?.[clipIndex];
  if (!src) return doc;
  const next = clone(doc);
  const clip = next.clips![clipIndex]!;
  for (const t of clip.tracks) {
    const keys = t.keys.map((k) => ({ ...k, t: round(clip.duration - k.t) })).sort((a, b) => a.t - b.t);
    // a key's ease belongs to the span after it; the span after new key i is the old span before old key (n - 1 - i), which old key (n - 2 - i) owns
    const n = t.keys.length;
    keys.forEach((k, i) => {
      const e = i < n - 1 ? flipEase(t.keys[n - 2 - i]!.ease) : undefined;
      if (e && e !== "linear") k.ease = e;
      else delete k.ease;
    });
    t.keys = keys;
  }
  return next;
}

/// Swaps the clip's left and right: parts named `left...` and `right...` (also `l_`/`r_`, `_l`/`_r`, `-left`...) trade keys, and the keys of the sideways
/// position and the turn about the other two axes are mirrored. Returns the clip as it was when no part has a partner.
export function mirrorClip(doc: ModelDoc, clipIndex: number): ModelDoc {
  const src = doc.clips?.[clipIndex];
  if (!src) return doc;
  const sideOf = (name: string): "l" | "r" | null => (/left|(^|[_\- ])l($|[_\- ])/i.test(name) ? "l" : /right|(^|[_\- ])r($|[_\- ])/i.test(name) ? "r" : null);
  const flip = (name: string): string => {
    const s = sideOf(name);
    if (!s) return name;
    if (/left/i.test(name)) return name.replace(/left/i, (m) => (m[0] === "L" ? "Right" : "right"));
    if (/right/i.test(name)) return name.replace(/right/i, (m) => (m[0] === "R" ? "Left" : "left"));
    return name.replace(/(^|[_\- ])([lLrR])($|[_\- ])/, (_m, a: string, c: string, b: string) => a + (c === "l" ? "r" : c === "L" ? "R" : c === "r" ? "l" : "L") + b);
  };
  const names = new Set(doc.clips![clipIndex]!.tracks.flatMap((t) => t.part));
  const hasPartner = [...names].some((n) => sideOf(n));
  const next = clone(doc);
  const clip = next.clips![clipIndex]!;
  for (const t of clip.tracks) {
    t.part = t.part.map(flip);
    // a mirror across x: sideways moves reverse, and turns about y and z reverse (turning about x is unchanged)
    for (const k of t.keys) {
      if (t.prop === "position") k.value = [-k.value[0], k.value[1], k.value[2]];
      else if (t.prop === "rotation") k.value = [k.value[0], -k.value[1], -k.value[2]];
    }
  }
  // two tracks of the same part and property (the flipped one met the one already there): the flipped keys win
  const merged: Track[] = [];
  for (const t of clip.tracks) {
    const same = merged.find((m) => m.prop === t.prop && pathKey(m.part) === pathKey(t.part));
    if (same) same.keys = sortKeys([...same.keys, ...t.keys]);
    else merged.push(t);
  }
  clip.tracks = merged;
  return hasPartner || clip.tracks.some((t) => t.prop !== "scale") ? next : doc;
}

/// A pose between two poses: positions and scales blend straight, rotations by the shortest way round (`t` 0 gives `a`, 1 gives `b`). A part only one pose
/// keys keeps that pose's value.
export function blendPoses(a: Map<string, Pose>, b: Map<string, Pose>, t: number): Map<string, Pose> {
  const k = Math.min(1, Math.max(0, t));
  const out = new Map<string, Pose>();
  const lerp3 = (x: [number, number, number], y: [number, number, number]): [number, number, number] => [x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k];
  const slerp = (x: [number, number, number, number], y: [number, number, number, number]): [number, number, number, number] => {
    let d = x[0] * y[0] + x[1] * y[1] + x[2] * y[2] + x[3] * y[3];
    const s = d < 0 ? -1 : 1;
    d *= s;
    const yy = y.map((v) => v * s) as [number, number, number, number];
    let q: [number, number, number, number];
    if (d > 0.9995) q = x.map((v, i) => v + (yy[i]! - v) * k) as [number, number, number, number];
    else {
      const th = Math.acos(d);
      const w0 = Math.sin((1 - k) * th) / Math.sin(th);
      const w1 = Math.sin(k * th) / Math.sin(th);
      q = x.map((v, i) => v * w0 + yy[i]! * w1) as [number, number, number, number];
    }
    const l = Math.hypot(...q) || 1;
    return q.map((v) => v / l) as [number, number, number, number];
  };
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const p = a.get(key);
    const q = b.get(key);
    if (!p || !q) {
      out.set(key, { ...(p ?? q!) });
      continue;
    }
    const pose: Pose = {};
    if (p.position && q.position) pose.position = lerp3(p.position, q.position);
    else if (p.position ?? q.position) pose.position = (p.position ?? q.position)!;
    if (p.scale && q.scale) pose.scale = lerp3(p.scale, q.scale);
    else if (p.scale ?? q.scale) pose.scale = (p.scale ?? q.scale)!;
    if (p.rotation && q.rotation) pose.rotation = slerp(p.rotation, q.rotation);
    else if (p.rotation ?? q.rotation) pose.rotation = (p.rotation ?? q.rotation)!;
    out.set(key, pose);
  }
  return out;
}

/// What two clips look like blended: `a` at time `ta`, `b` at time `tb`, `t` the share of `b`. For cross-fading one animation into another.
export function blendClips(a: Clip, ta: number, b: Clip, tb: number, t: number): Map<string, Pose> {
  return blendPoses(samplePose(a, ta), samplePose(b, tb), t);
}

// ---- the pose library ----

import { MAX_POSES, type SavedPose } from "./model-doc";
import { quaternionToEuler } from "./model-ik";

/// Saves how the clip poses the parts at time `t` under a name (a name already used is replaced): every keyed property of every keyed part. Null when the clip
/// has no keys or the library is full.
export function capturePose(doc: ModelDoc, clipIndex: number, t: number, name: string): ModelDoc | null {
  const clip = doc.clips?.[clipIndex];
  const wanted = name.trim();
  if (!clip || !wanted) return null;
  const pose = samplePose(clip, t, false);
  if (!pose.size) return null;
  const parts: SavedPose["parts"] = {};
  for (const [key, p] of pose) {
    const entry: SavedPose["parts"][string] = {};
    if (p.position) entry.position = p.position.map(round) as [number, number, number];
    if (p.rotation) entry.rotation = quaternionToEuler(p.rotation).map(round) as [number, number, number];
    if (p.scale) entry.scale = p.scale.map(round) as [number, number, number];
    if (Object.keys(entry).length) parts[key] = entry;
  }
  const list = (doc.poses ?? []).filter((q) => q.name !== wanted);
  if (list.length >= MAX_POSES) return null;
  return { ...doc, poses: [...list, { name: wanted, parts }] };
}

/// Puts a saved pose on the clip at time `t`: a key for every property the pose holds (parts the model no longer has are skipped).
export function applyPose(doc: ModelDoc, clipIndex: number, t: number, name: string): ModelDoc {
  const pose = doc.poses?.find((q) => q.name === name);
  if (!pose || !doc.clips?.[clipIndex]) return doc;
  const exists = (path: string[]) => {
    let list = doc.parts;
    for (const n of path) {
      const p = list.find((x) => x.name === n);
      if (!p) return false;
      list = p.children;
    }
    return true;
  };
  let next = doc;
  for (const [key, v] of Object.entries(pose.parts)) {
    const path = key.split("/");
    if (!exists(path)) continue;
    for (const prop of ["position", "rotation", "scale"] as const) if (v[prop]) next = setKey(next, clipIndex, path, prop, t, v[prop]!);
  }
  return next;
}

export const removePose = (doc: ModelDoc, name: string): ModelDoc => {
  const list = (doc.poses ?? []).filter((q) => q.name !== name);
  const next = { ...doc };
  if (list.length) next.poses = list;
  else delete next.poses;
  return next;
};
