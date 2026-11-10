// The maths of the animation curve (graph) editor: where a key sits on the picture, and what a drag on the picture means.

import { KEY_STEP, snapTime } from "./model-anim";
import { applyEase } from "./model-ease";
import type { Clip, Track, Vec3 } from "./model-doc";

export interface GraphBox {
  /// Pixels.
  w: number;
  h: number;
  /// What the picture shows: seconds from 0 to `duration`, values from `lo` to `hi`.
  duration: number;
  lo: number;
  hi: number;
  pad: number;
}

export const xOf = (b: GraphBox, t: number) => b.pad + (t / Math.max(1e-9, b.duration)) * (b.w - 2 * b.pad);
export const yOf = (b: GraphBox, v: number) => b.h - b.pad - ((v - b.lo) / Math.max(1e-9, b.hi - b.lo)) * (b.h - 2 * b.pad);
export const timeAt = (b: GraphBox, x: number) => snapTime(Math.min(b.duration, Math.max(0, ((x - b.pad) / Math.max(1, b.w - 2 * b.pad)) * b.duration)));
export const valueAt = (b: GraphBox, y: number) => b.lo + ((b.h - b.pad - y) / Math.max(1, b.h - 2 * b.pad)) * (b.hi - b.lo);

/// A value range that holds every key of the track (all three axes) with some room, and always spans something (so a flat curve is still drawn).
export function rangeOf(track: Track | undefined, floor = 1): { lo: number; hi: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const k of track?.keys ?? []) for (const v of k.value) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  if (!Number.isFinite(lo)) return { lo: -floor, hi: floor };
  const span = Math.max(floor, hi - lo);
  const margin = span * 0.15;
  const mid = (lo + hi) / 2;
  return { lo: Math.min(lo - margin, mid - span / 2), hi: Math.max(hi + margin, mid + span / 2) };
}

/// The key of a track that a drag started at (x, y) in pixels picks up for the axis, within `radius` pixels: its index, or -1.
export function pickKey(track: Track | undefined, axis: 0 | 1 | 2, b: GraphBox, x: number, y: number, radius = 9): number {
  let best = -1;
  let bestDist = radius;
  for (const [i, k] of (track?.keys ?? []).entries()) {
    const d = Math.hypot(xOf(b, k.t) - x, yOf(b, k.value[axis]) - y);
    if (d <= bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/// The track with key `index` moved to a new time and with one axis set to a new value. A key cannot be moved onto another key's time (it stays where it was in time).
export function dragKey(track: Track, index: number, axis: 0 | 1 | 2, time: number, value: number, duration: number): Track {
  const keys = track.keys.map((k) => ({ ...k, value: [...k.value] as Vec3 }));
  const key = keys[index];
  if (!key) return track;
  const t = Math.min(duration, Math.max(0, snapTime(time)));
  const clash = keys.some((k, i) => i !== index && Math.abs(k.t - t) < KEY_STEP / 2);
  if (!clash) key.t = Math.round(t * 1e4) / 1e4;
  key.value[axis] = Math.round(value * 1e3) / 1e3;
  keys.sort((a, b) => a.t - b.t);
  return { ...track, keys };
}

/// The curve of one axis as points to draw: every key, and between keys enough steps to show the easing (sampled from `valueOf`, which gives the value at a time).
export function curvePoints(clip: Clip, track: Track | undefined, valueOf: (t: number) => number, perSecond = 30): [number, number][] {
  if (!track?.keys.length) return [];
  const out: [number, number][] = [];
  const end = clip.duration;
  const first = track.keys[0]!.t;
  out.push([0, valueOf(0)]);
  for (let t = first; t < end; t += 1 / perSecond) out.push([t, valueOf(t)]);
  out.push([end, valueOf(end)]);
  return out;
}

/// The value of one axis of a track at a time, straight between keys or eased as the earlier key says, held before the first key and after the last (rotations are blended
/// angle by angle here, which is what the picture shows; the model itself blends them as turns).
export function trackValue(track: Track, axis: 0 | 1 | 2, t: number): number {
  const keys = track.keys;
  if (!keys.length) return 0;
  if (t <= keys[0]!.t) return keys[0]!.value[axis];
  const last = keys[keys.length - 1]!;
  if (t >= last.t) return last.value[axis];
  let i = 1;
  while (keys[i]!.t < t) i++;
  const a = keys[i - 1]!;
  const b = keys[i]!;
  const f = (t - a.t) / (b.t - a.t);
  if (a.ease === "step") return a.value[axis];
  return a.value[axis] + (b.value[axis] - a.value[axis]) * applyEase(a.ease, f);
}
