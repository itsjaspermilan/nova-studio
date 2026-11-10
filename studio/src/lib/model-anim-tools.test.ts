import { describe, expect, it } from "vitest";
import { addClip, samplePose, setKey, findTrack } from "./model-anim";
import { blendClips, blendPoses, copyKeys, mirrorClip, pasteKeys, reverseClip, shiftKeys, stretchKeys } from "./model-anim-tools";
import { newModel, type ModelDoc } from "./model-doc";

/// A 2 second clip with a "body" position moving 0 -> 10 -> 4 and an arm turning.
function base(): ModelDoc {
  let d = addClip(newModel(), "walk").doc;
  d = { ...d, clips: [{ ...d.clips![0]!, duration: 2 }] };
  d = setKey(d, 0, ["body"], "position", 0, [0, 0, 0]);
  d = setKey(d, 0, ["body"], "position", 1, [10, 0, 0]);
  d = setKey(d, 0, ["body"], "position", 2, [4, 0, 0]);
  d = setKey(d, 0, ["body", "arm"], "rotation", 1, [30, 0, 0]);
  return d;
}
const times = (d: ModelDoc, part: string[], prop: "position" | "rotation" = "position") => findTrack(d.clips![0]!, part, prop)?.keys.map((k) => k.t);

describe("copy and paste of keys", () => {
  it("copies a part's keys from the first one and pastes them elsewhere in time", () => {
    const d = base();
    const board = copyKeys(d.clips![0]!, ["body"], 1, 2)!;
    expect(board.tracks[0]!.keys.map((k) => k.t)).toEqual([0, 1]);
    expect(board.length).toBe(1);
    const grown = { ...d, clips: [{ ...d.clips![0]!, duration: 4 }] };
    const p = pasteKeys(grown, 0, board, 2.5);
    expect(times(p, ["body"])).toEqual([0, 1, 2, 2.5, 3.5]);
    expect(findTrack(p.clips![0]!, ["body"], "position")!.keys.find((k) => k.t === 3.5)!.value).toEqual([4, 0, 0]);
  });
  it("pastes onto another part, replaces keys at the same time and drops keys past the end", () => {
    const d = base();
    const board = copyKeys(d.clips![0]!, ["body"])!;
    const onto = pasteKeys(d, 0, board, 1, ["body", "arm"]);
    expect(times(onto, ["body", "arm"], "position")).toEqual([1, 2]); // the key at 3 is past the end of a 2 s clip
    const over = pasteKeys(d, 0, copyKeys(d.clips![0]!, ["body"], 0, 0)!, 1);
    expect(findTrack(over.clips![0]!, ["body"], "position")!.keys.find((k) => k.t === 1)!.value).toEqual([0, 0, 0]);
    expect(copyKeys(d.clips![0]!, ["nothing"])).toBeNull();
  });
});

describe("time edits", () => {
  it("shifts and stretches, dropping what falls outside", () => {
    const d = base();
    expect(times(shiftKeys(d, 0, 0.5, ["body"]), ["body"])).toEqual([0.5, 1.5]); // the key at 2.5 is gone
    expect(times(shiftKeys(d, 0, 0.5, ["body"]), ["body", "arm"], "rotation")).toEqual([1]); // other parts untouched
    expect(times(stretchKeys(d, 0, 0.5), ["body"])).toEqual([0, 0.5, 1]);
    expect(times(stretchKeys(d, 0, 2, ["body"]), ["body"])).toEqual([0, 2]);
    expect(stretchKeys(d, 0, 0, null)).toBe(d);
  });
  it("two keys squeezed onto one time keep the first", () => {
    const d = setKey(base(), 0, ["body"], "position", 0.01, [1, 1, 1]);
    const s = stretchKeys(d, 0, 0.004);
    expect(times(s, ["body"])).toEqual([0, 0.01]);
  });
  it("reverses the clip, flipping how keys ease", () => {
    let d = base();
    d.clips![0]!.tracks[0]!.keys[0]!.ease = "in"; // 0 -> 1 eases in
    const r = reverseClip(d, 0);
    const keys = findTrack(r.clips![0]!, ["body"], "position")!.keys;
    expect(keys.map((k) => k.t)).toEqual([0, 1, 2]);
    expect(keys.map((k) => k.value[0])).toEqual([4, 10, 0]);
    // the span from t=1 to t=2 is the old 0 -> 1 span, now easing out
    expect(keys[1]!.ease).toBe("out");
    expect(keys[0]!.ease).toBeUndefined();
    expect(Array.from(samplePose(r.clips![0]!, 0.5, false).get("body")!.position!)).toEqual([7, 0, 0]);
    expect(reverseClip(reverseClip(d, 0), 0).clips![0]!.tracks[0]!.keys.map((k) => [k.t, k.ease])).toEqual(d.clips![0]!.tracks[0]!.keys.map((k) => [k.t, k.ease]));
  });
  it("mirrors left and right", () => {
    let d = addClip(newModel(), "wave").doc;
    d = setKey(d, 0, ["body", "left arm"], "rotation", 0, [10, 20, 30]);
    d = setKey(d, 0, ["body", "left arm"], "position", 0, [5, 1, 2]);
    const m = mirrorClip(d, 0);
    const t = m.clips![0]!.tracks;
    expect(t.every((x) => x.part[1] === "right arm")).toBe(true);
    expect(t.find((x) => x.prop === "rotation")!.keys[0]!.value).toEqual([10, -20, -30]);
    expect(t.find((x) => x.prop === "position")!.keys[0]!.value).toEqual([-5, 1, 2]);
    expect(mirrorClip(mirrorClip(d, 0), 0).clips![0]!.tracks.map((x) => x.part[1])).toEqual(["left arm", "left arm"]);
  });
});

describe("blending", () => {
  it("blends positions straight and rotations the short way round", () => {
    const a = new Map([["p", { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number] }]]);
    const s = Math.SQRT1_2;
    const b = new Map([["p", { position: [10, 0, 0] as [number, number, number], rotation: [0, 0, s, s] as [number, number, number, number] }]]);
    const half = blendPoses(a, b, 0.5).get("p")!;
    expect(half.position).toEqual([5, 0, 0]);
    // half of a 90 degree turn about z is 45 degrees: z = sin 22.5, w = cos 22.5
    expect(half.rotation![2]).toBeCloseTo(Math.sin(Math.PI / 8), 6);
    expect(half.rotation![3]).toBeCloseTo(Math.cos(Math.PI / 8), 6);
    expect(blendPoses(a, b, 0).get("p")!.position).toEqual([0, 0, 0]);
    expect(blendPoses(a, b, 1).get("p")!.position).toEqual([10, 0, 0]);
    // the negative of a quaternion is the same turn: the blend must not go the long way
    const neg = new Map([["p", { rotation: [0, 0, -s, -s] as [number, number, number, number] }]]);
    expect(blendPoses(a, neg, 0.5).get("p")!.rotation![2]).toBeCloseTo(Math.sin(Math.PI / 8), 6);
  });
  it("keeps a part only one pose has, and blends two clips at chosen times", () => {
    const d = base();
    const clip = d.clips![0]!;
    const only = blendPoses(new Map([["a", { position: [1, 2, 3] as [number, number, number] }]]), new Map(), 0.5);
    expect(only.get("a")!.position).toEqual([1, 2, 3]);
    const mixed = blendClips(clip, 0, clip, 1, 0.5).get("body")!;
    expect(mixed.position![0]).toBeCloseTo(5, 6);
  });
});

import { applyPose, capturePose, removePose } from "./model-anim-tools";
import { parseModel, serializeModel } from "./model-doc";
describe("the pose library", () => {
  it("saves a pose from a time in a clip and puts it on another time, and it survives saving", () => {
    let d = addClip(newModel(), "a").doc;
    d = { ...d, parts: [{ name: "body", origin: [0, 0, 0], rotation: [0, 0, 0], cubes: [], children: [{ name: "arm", origin: [3, 0, 0], rotation: [0, 0, 0], cubes: [], children: [] }] }] };
    d = setKey(d, 0, ["body"], "position", 0, [0, 0, 0]);
    d = setKey(d, 0, ["body"], "position", 1, [0, 4, 0]);
    d = setKey(d, 0, ["body", "arm"], "rotation", 1, [10, 20, 30]);
    const saved = capturePose(d, 0, 1, "Hands up")!;
    expect(saved.poses![0]!.name).toBe("Hands up");
    expect(saved.poses![0]!.parts["body"]!.position).toEqual([0, 4, 0]);
    const rot = saved.poses![0]!.parts["body/arm"]!.rotation!;
    expect(rot[0]).toBeCloseTo(10, 3);
    expect(rot[1]).toBeCloseTo(20, 3);
    expect(rot[2]).toBeCloseTo(30, 3);
    const placed = applyPose({ ...saved, clips: [{ ...saved.clips![0]!, tracks: [] }] }, 0, 0.5, "Hands up");
    expect(findTrack(placed.clips![0]!, ["body", "arm"], "rotation")!.keys[0]).toMatchObject({ t: 0.5 });
    expect(findTrack(placed.clips![0]!, ["body"], "position")!.keys[0]!.value).toEqual([0, 4, 0]);
    const back = parseModel(serializeModel(saved));
    expect(back.ok && back.doc.poses).toEqual(saved.poses);
    expect(capturePose(saved, 0, 1, "Hands up")!.poses!.length).toBe(1); // the name is replaced, not doubled
    expect(removePose(saved, "Hands up").poses).toBeUndefined();
    expect(capturePose(d, 0, 1, "  ")).toBeNull();
    expect(capturePose({ ...d, clips: [{ ...d.clips![0]!, tracks: [] }] }, 0, 0, "x")).toBeNull();
  });
  it("skips parts that are gone and refuses a bad file", () => {
    let d = addClip(newModel(), "a").doc;
    d = { ...d, poses: [{ name: "p", parts: { "ghost/limb": { rotation: [1, 2, 3] } } }] };
    expect(applyPose(d, 0, 0, "p").clips![0]!.tracks.length).toBe(0);
    const bad = JSON.parse(serializeModel(d));
    bad.poses[0].parts["ghost/limb"].rotation = [1, 2];
    expect(parseModel(JSON.stringify(bad)).ok).toBe(false);
    bad.poses = [{ name: "p", parts: {} }, { name: "p", parts: {} }];
    expect(parseModel(JSON.stringify(bad)).ok).toBe(false);
  });
});
