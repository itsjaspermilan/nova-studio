import { describe, expect, it } from "vitest";
import { bakeConstraints, constrainedPose } from "./model-constraints";
import { addClip, findTrack, samplePose, setKey } from "./model-anim";
import { eulerToQuaternion } from "./model-ease";
import { quaternionToEuler } from "./model-ik";
import { parseModel, serializeModel, walk, type Constraint, type ModelDoc } from "./model-doc";
import { rigTemplate } from "./rig-templates";
import { transformPoint, worldMatrices } from "./model-skin";

const withConstraints = (doc: ModelDoc, name: string, constraints: Constraint[]): ModelDoc => {
  const d: ModelDoc = JSON.parse(JSON.stringify(doc));
  walk(d).find((w) => w.part.name === name)!.part.constraints = constraints;
  return d;
};
const euler = (q?: [number, number, number, number]) => (q ? quaternionToEuler(q) : null);

describe("constraints", () => {
  it("limit holds a turn between bounds", () => {
    const d = withConstraints(addClip(rigTemplate("humanoid"), "a").doc, "head", [{ type: "limit", min: [-20, -40, 0], max: [20, 40, 0] }]);
    const pose = new Map([["hips/spine/head", { rotation: eulerToQuaternion([50, -80, 30]) }]]);
    const e = euler(constrainedPose(d, pose).get("hips/spine/head")!.rotation)!;
    expect(e[0]).toBeCloseTo(20, 3);
    expect(e[1]).toBeCloseTo(-40, 3);
    expect(e[2]).toBeCloseTo(0, 3);
    const inside = new Map([["hips/spine/head", { rotation: eulerToQuaternion([10, 10, 0]) }]]);
    expect(euler(constrainedPose(d, inside).get("hips/spine/head")!.rotation)![0]).toBeCloseTo(10, 3);
  });
  it("copy follows another part on the axes asked, blended", () => {
    const d = withConstraints(rigTemplate("humanoid"), "right arm", [{ type: "copy", from: "hips/spine/left arm", axes: [false, false, true], mix: 0.5 }]);
    const pose = new Map([["hips/spine/left arm", { rotation: eulerToQuaternion([10, 20, 60]) }]]);
    const e = euler(constrainedPose(d, pose).get("hips/spine/right arm")!.rotation)!;
    expect(e[2]).toBeCloseTo(30, 3); // half way from the arm's own 0 to 60
    expect(e[0]).toBeCloseTo(0, 3); // the other axes are its own
    expect(constrainedPose(withConstraints(rigTemplate("humanoid"), "right arm", [{ type: "copy", from: "nobody", axes: [true, true, true], mix: 1 }]), pose).get("hips/spine/right arm")).toBeUndefined();
  });
  it("reach bends the limb so its end meets the target", () => {
    const base = rigTemplate("humanoid");
    const shoulder = transformPoint(worldMatrices(base).get("hips/spine/left arm")!, [0, 0, 0]);
    const target: [number, number, number] = [shoulder[0] + 3, shoulder[1] - 6, shoulder[2] + 6];
    const d = withConstraints(base, "left arm", [{ type: "reach", target }]);
    const pose = constrainedPose(d, new Map());
    const probe: ModelDoc = JSON.parse(JSON.stringify(d));
    for (const w of walk(probe)) {
      const key = ((): string => { const n: string[] = []; let l = probe.parts; for (const i of w.parts) { n.push(l[i]!.name); l = l[i]!.children; } return n.join("/"); })();
      const q = pose.get(key)?.rotation;
      if (q) w.part.rotation = quaternionToEuler(q);
    }
    const hand = transformPoint(worldMatrices(probe).get("hips/spine/left arm/left forearm/left hand")!, [0, 0, 0]);
    expect(Math.hypot(hand[0] - target[0], hand[1] - target[1], hand[2] - target[2])).toBeLessThan(0.02);
  });
  it("a model without constraints is returned as it is", () => {
    const pose = new Map();
    expect(constrainedPose(rigTemplate("humanoid"), pose)).toBe(pose);
  });
  it("bakes the effect into plain keys over the clip, and removes the rules when asked", () => {
    let d = addClip(rigTemplate("humanoid"), "nod").doc;
    d = { ...d, clips: [{ ...d.clips![0]!, duration: 1 }] };
    d = setKey(d, 0, ["hips", "spine", "head"], "rotation", 0, [0, 0, 0]);
    d = setKey(d, 0, ["hips", "spine", "head"], "rotation", 1, [0, 90, 0]);
    d = withConstraints(d, "head", [{ type: "limit", min: [0, -30, 0], max: [0, 30, 0] }]);
    const r = bakeConstraints(d, 0, 10, true);
    expect(r.baked).toEqual(["hips/spine/head"]);
    const keys = findTrack(r.doc.clips![0]!, ["hips", "spine", "head"], "rotation")!.keys;
    expect(keys.length).toBeGreaterThanOrEqual(10);
    expect(Math.max(...keys.map((k) => k.value[1]))).toBeCloseTo(30, 2); // 90 was held to 30
    expect(keys[0]!.value[1]).toBeCloseTo(0, 2);
    expect(walk(r.doc).every((w) => !w.part.constraints)).toBe(true);
    expect(Array.from(samplePose(r.doc.clips![0]!, 1, false).get("hips/spine/head")!.rotation!)).toEqual(Array.from(eulerToQuaternion([0, 30, 0])).map((v, i) => samplePose(r.doc.clips![0]!, 1, false).get("hips/spine/head")!.rotation![i]!));
    // nothing to bake: the model comes back as it was
    expect(bakeConstraints(rigTemplate("humanoid"), 0).doc.clips).toBeUndefined();
    expect(bakeConstraints(d, 7).baked).toEqual([]);
  });
  it("is saved and checked", () => {
    const d = withConstraints(rigTemplate("humanoid"), "head", [{ type: "limit", min: [-20, -40, 0], max: [20, 40, 0] }, { type: "copy", from: "hips", axes: [true, false, false], mix: 1 }, { type: "reach", target: [1, 2, 3] }]);
    const back = parseModel(serializeModel(d));
    expect(back.ok && walk(back.doc).find((w) => w.part.name === "head")!.part.constraints).toEqual(walk(d).find((w) => w.part.name === "head")!.part.constraints);
    for (const bad of [[{ type: "spin" }], [{ type: "limit", min: [0, 0], max: [0, 0, 0] }], [{ type: "copy", from: "", axes: [true, true, true], mix: 1 }], [{ type: "copy", from: "a", axes: [true, true, true], mix: 2 }], Array(5).fill({ type: "reach", target: [0, 0, 0] })]) {
      const j = JSON.parse(serializeModel(d));
      j.parts[0].children[0].children[0].constraints = bad;
      expect(parseModel(JSON.stringify(j)).ok, JSON.stringify(bad).slice(0, 40)).toBe(false);
    }
  });
});

import { setConstraints } from "./model-constraints";
describe("setting constraints", () => {
  it("puts a list on a part, caps it, and an empty list takes them off", () => {
    const d = rigTemplate("humanoid");
    const head = walk(d).find((w) => w.part.name === "head")!.parts;
    const a = setConstraints(d, head, [{ type: "limit", min: [0, 0, 0], max: [1, 1, 1] }]);
    expect(walk(a).find((w) => w.part.name === "head")!.part.constraints!.length).toBe(1);
    expect(walk(setConstraints(a, head, [])).find((w) => w.part.name === "head")!.part.constraints).toBeUndefined();
    expect(walk(setConstraints(d, head, Array(9).fill({ type: "reach", target: [0, 0, 0] }))).find((w) => w.part.name === "head")!.part.constraints!.length).toBe(4);
    expect(setConstraints(d, [99], [])).toBe(d);
    expect(walk(d).every((w) => !w.part.constraints)).toBe(true); // the source is untouched
  });
});
