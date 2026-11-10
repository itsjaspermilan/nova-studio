import { describe, expect, it } from "vitest";
import { fromTo, limbEnd, quaternionToEuler, rotate, solveLimb } from "./model-ik";
import { eulerToQuaternion } from "./model-ease";
import { rigTemplate } from "./rig-templates";
import { transformPoint, worldMatrices } from "./model-skin";
import { walk } from "./model-doc";

const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

describe("quaternions", () => {
  it("euler angles survive a trip through a quaternion", () => {
    for (const e of [[0, 0, 0], [30, 0, 0], [0, 45, 0], [0, 0, 80], [20, -35, 60], [-120, 10, 170]] as [number, number, number][]) {
      const back = quaternionToEuler(eulerToQuaternion(e));
      const q1 = eulerToQuaternion(e);
      const q2 = eulerToQuaternion(back);
      const same = q1.every((v, i) => Math.abs(v - q2[i]!) < 1e-6) || q1.every((v, i) => Math.abs(v + q2[i]!) < 1e-6);
      expect(same, `${e}`).toBe(true);
    }
  });
  it("fromTo takes one direction onto another, even opposite ones", () => {
    for (const [a, b] of [[[1, 0, 0], [0, 1, 0]], [[0, -1, 0], [0, 0, 1]], [[0, 1, 0], [0, -1, 0]], [[0, 1, 0], [0, 1, 0]]] as [number[], number[]][]) {
      const r = rotate(fromTo(a as [number, number, number], b as [number, number, number]), a as [number, number, number]);
      expect(dist(r, b)).toBeLessThan(1e-6);
    }
  });
});

describe("a limb reaching for a point", () => {
  // the person's left arm: shoulder at the spine's top, 6 long upper arm and 6 long forearm hanging down
  const doc = rigTemplate("humanoid");
  const arm = walk(doc).find((w) => w.part.name === "left arm")!;
  const shoulder = () => transformPoint(worldMatrices(doc).get("hips/spine/left arm")!, [0, 0, 0]);
  it("puts the end on a target within reach", () => {
    const s = shoulder();
    for (const t of [[s[0] + 4, s[1] - 7, s[2] + 5], [s[0] + 8, s[1], s[2]], [s[0], s[1] - 9, s[2] + 6], [s[0] - 3, s[1] + 4, s[2] + 7]] as [number, number, number][]) {
      const r = solveLimb(doc, arm.parts, t)!;
      expect(r.reached).toBe(true);
      const end = limbEnd(doc, arm.parts, r.upper, r.middle)!;
      expect(dist(end, t), `${t}`).toBeLessThan(0.01);
    }
  });
  it("stretches straight towards a target that is too far, without reaching it", () => {
    const s = shoulder();
    const t: [number, number, number] = [s[0] + 40, s[1], s[2]];
    const r = solveLimb(doc, arm.parts, t)!;
    expect(r.reached).toBe(false);
    const end = limbEnd(doc, arm.parts, r.upper, r.middle)!;
    expect(dist(end, s)).toBeCloseTo(12, 2); // the whole arm
    expect(end[0]).toBeGreaterThan(s[0] + 11);
  });
  it("bends the elbow towards the pole", () => {
    const s = shoulder();
    const t: [number, number, number] = [s[0] + 2, s[1] - 6, s[2] + 4];
    const elbowAt = (pole: [number, number, number]) => {
      const r = solveLimb(doc, arm.parts, t, pole)!;
      const probe = JSON.parse(JSON.stringify(doc));
      const a = walk(probe).find((w) => w.part.name === "left arm")!.part;
      a.rotation = r.upper;
      return transformPoint(worldMatrices(probe).get("hips/spine/left arm/left forearm")!, [0, 0, 0]);
    };
    expect(elbowAt([0, 0, 1])[2]).toBeGreaterThan(elbowAt([0, 0, -1])[2]);
    expect(elbowAt([1, 0, 0])[0]).toBeGreaterThan(elbowAt([-1, 0, 0])[0]);
  });
  it("works for a leg too, and refuses a part without two parts below it", () => {
    const leg = walk(doc).find((w) => w.part.name === "right thigh")!;
    const hip = transformPoint(worldMatrices(doc).get("hips/right thigh")!, [0, 0, 0]);
    const t: [number, number, number] = [hip[0], hip[1] - 8, hip[2] + 6];
    const r = solveLimb(doc, leg.parts, t)!;
    expect(dist(limbEnd(doc, leg.parts, r.upper, r.middle)!, t)).toBeLessThan(0.01);
    const foot = walk(doc).find((w) => w.part.name === "right foot")!;
    expect(solveLimb(doc, foot.parts, [0, 0, 0])).toBeNull();
  });
});
