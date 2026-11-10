import { describe, expect, it } from "vitest";
import { curvePoints, dragKey, trackValue, pickKey, rangeOf, timeAt, valueAt, xOf, yOf, type GraphBox } from "./model-graph";
import type { Clip, Track } from "./model-doc";

const box: GraphBox = { w: 420, h: 220, duration: 2, lo: -10, hi: 10, pad: 10 };
const track = (): Track => ({ part: ["a"], prop: "position", keys: [{ t: 0, value: [0, 0, 0] }, { t: 1, value: [5, -4, 2] }, { t: 2, value: [-3, 8, 0] }] });

describe("the curve editor's picture", () => {
  it("maps times and values to pixels and back", () => {
    expect(xOf(box, 0)).toBe(10);
    expect(xOf(box, 2)).toBe(410);
    expect(yOf(box, 10)).toBe(10);
    expect(yOf(box, -10)).toBe(210);
    for (const t of [0, 0.5, 1.37, 2]) expect(timeAt(box, xOf(box, t))).toBeCloseTo(t, 2);
    for (const v of [-10, -3.3, 0, 7]) expect(valueAt(box, yOf(box, v))).toBeCloseTo(v, 6);
    expect(timeAt(box, -50)).toBe(0);
    expect(timeAt(box, 9999)).toBe(2);
  });
  it("finds a range that holds every key and is never empty", () => {
    const r = rangeOf(track());
    expect(r.lo).toBeLessThan(-4);
    expect(r.hi).toBeGreaterThan(8);
    const flat = rangeOf({ part: ["a"], prop: "scale", keys: [{ t: 0, value: [1, 1, 1] }] });
    expect(flat.hi).toBeGreaterThan(flat.lo);
    expect(rangeOf(undefined)).toEqual({ lo: -1, hi: 1 });
  });
  it("picks the key under the pointer for an axis, or none", () => {
    const t = track();
    expect(pickKey(t, 0, box, xOf(box, 1) + 3, yOf(box, 5) - 2)).toBe(1);
    expect(pickKey(t, 1, box, xOf(box, 1), yOf(box, -4))).toBe(1);
    expect(pickKey(t, 0, box, xOf(box, 1), yOf(box, -4))).toBe(-1); // that is the y curve's key
    expect(pickKey(t, 2, box, 300, 5)).toBe(-1);
  });
  it("a drag changes one axis of a key and its time, never onto another key's time, and keeps the keys in order", () => {
    const t = track();
    const moved = dragKey(t, 1, 0, 1.5, 7.25, 2);
    expect(moved.keys[1]).toMatchObject({ t: 1.5, value: [7.25, -4, 2] }); // only x changed
    const clash = dragKey(t, 1, 1, 2, 3, 2);
    expect(clash.keys[1]!.t).toBe(1);
    expect(clash.keys[1]!.value[1]).toBe(3);
    const over = dragKey(t, 0, 0, 1.5, 1, 2);
    expect(over.keys.map((k) => k.t)).toEqual([1, 1.5, 2]);
    expect(dragKey(t, 9, 0, 1, 1, 2)).toBe(t);
    expect(dragKey(t, 2, 0, 99, 0, 2).keys[2]!.t).toBe(2);
  });
  it("draws a curve from time 0 to the end through the keys", () => {
    const clip: Clip = { name: "c", duration: 2, loop: false, tracks: [track()] };
    const pts = curvePoints(clip, clip.tracks[0], (x) => x * 2);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[pts.length - 1]).toEqual([2, 4]);
    expect(pts.length).toBeGreaterThan(40);
    expect(curvePoints(clip, undefined, () => 0)).toEqual([]);
  });
});

describe("reading a track's value", () => {
  it("is straight between keys, held at the ends, stepped or eased as the key says", () => {
    const t = track();
    expect(trackValue(t, 0, 0.5)).toBeCloseTo(2.5, 9);
    expect(trackValue(t, 0, 1.5)).toBeCloseTo(1, 9);
    expect(trackValue(t, 0, -1)).toBe(0);
    expect(trackValue(t, 0, 5)).toBe(-3);
    const stepped: Track = { ...t, keys: t.keys.map((k, i) => (i === 0 ? { ...k, ease: "step" as const } : k)) };
    expect(trackValue(stepped, 0, 0.9)).toBe(0);
    const eased: Track = { ...t, keys: t.keys.map((k, i) => (i === 0 ? { ...k, ease: "in" as const } : k)) };
    expect(trackValue(eased, 0, 0.5)).toBeLessThan(2.5);
    expect(trackValue({ ...t, keys: [] }, 0, 1)).toBe(0);
  });
});
