import { describe, expect, it } from "vitest";
import { exportGlb } from "./glb";
import { BAKE_STEPS, applyEase, slerp } from "./model-ease";
import { easeAt, samplePose, setEase, setKey } from "./model-anim";
import { newModel, parseModel, serializeModel, type ModelDoc } from "./model-doc";

const clip = (): ModelDoc => {
  let d = newModel();
  d = { ...d, clips: [{ name: "move", duration: 1, loop: false, tracks: [] }] };
  d = setKey(d, 0, ["body"], "position", 0, [0, 0, 0]);
  d = setKey(d, 0, ["body"], "position", 1, [10, 0, 0]);
  return d;
};
const at = (d: ModelDoc, t: number) => samplePose(d.clips![0]!, t, false).get("body")!.position![0]!;

describe("easing curves", () => {
  it("map progress to progress", () => {
    expect(applyEase(undefined, 0.3)).toBe(0.3);
    expect(applyEase("linear", 0.3)).toBe(0.3);
    expect(applyEase("in", 0.5)).toBe(0.25);
    expect(applyEase("out", 0.5)).toBe(0.75);
    expect(applyEase("inout", 0.25)).toBe(0.125);
    expect(applyEase("inout", 0.75)).toBe(0.875);
    expect(applyEase("step", 0.99)).toBe(0);
    expect(applyEase("step", 1)).toBe(1);
    for (const e of ["in", "out", "inout", "linear"] as const) expect([applyEase(e, 0), applyEase(e, 1)]).toEqual([0, 1]);
  });

  it("shape what the editor samples", () => {
    let d = clip();
    expect(at(d, 0.5)).toBeCloseTo(5, 9);
    d = setEase(d, 0, ["body"], 0, "in");
    expect(at(d, 0.5)).toBeCloseTo(2.5, 9);
    d = setEase(d, 0, ["body"], 0, "step");
    expect([at(d, 0.5), at(d, 0.999), at(d, 1)]).toEqual([0, 0, 10]);
    d = setEase(d, 0, ["body"], 0, "linear");
    expect(at(d, 0.5)).toBeCloseTo(5, 9);
    expect(d.clips![0]!.tracks[0]!.keys[0]).toEqual({ t: 0, value: [0, 0, 0] }); // linear is the absence of an ease
  });

  it("are read and set per part and time, and survive re-keying", () => {
    let d = setEase(clip(), 0, ["body"], 0, "out");
    expect(easeAt(d.clips![0]!, ["body"], 0)).toBe("out");
    expect(easeAt(d.clips![0]!, ["body"], 1)).toBe("linear");
    expect(easeAt(d.clips![0]!, ["body"], 0.5)).toBeUndefined();
    expect(easeAt(d.clips![0]!, ["nope"], 0)).toBeUndefined();
    expect(setEase(d, 0, ["body"], 0.5, "in")).toBe(d); // no key there
    d = setKey(d, 0, ["body"], "position", 0, [1, 0, 0]); // changing the value keeps the ease
    expect(easeAt(d.clips![0]!, ["body"], 0)).toBe("out");
  });

  it("are saved and checked", () => {
    const d = setEase(clip(), 0, ["body"], 0, "inout");
    const text = serializeModel(d);
    expect(text).toContain('"ease": "inout"');
    const back = parseModel(text);
    expect(back.ok && serializeModel(back.doc)).toBe(text);
    expect(parseModel(text.replace('"inout"', '"wobble"'))).toMatchObject({ ok: false });
    expect(serializeModel(clip())).not.toContain("ease");
  });
});

function glbJson(bytes: Uint8Array) {
  const v = new DataView(bytes.buffer, bytes.byteOffset);
  const json = JSON.parse(new TextDecoder().decode(bytes.slice(20, 20 + v.getUint32(12, true))));
  const bin = bytes.slice(20 + v.getUint32(12, true) + 8);
  return { json, bin };
}
const floats = (json: any, bin: Uint8Array, accessor: number) => {
  const a = json.accessors[accessor];
  const view = json.bufferViews[a.bufferView];
  const n = a.count * ({ SCALAR: 1, VEC3: 3, VEC4: 4 } as Record<string, number>)[a.type]!;
  return Array.from(new Float32Array(bin.slice(view.byteOffset, view.byteOffset + n * 4).buffer));
};

describe("exporting eased clips", () => {
  const sampler = (d: ModelDoc) => {
    const { json, bin } = glbJson(exportGlb(d));
    const s = json.animations[0].samplers[0];
    return { times: floats(json, bin, s.input), values: floats(json, bin, s.output) };
  };

  it("leaves a straight clip with its two keys", () => {
    const { times, values } = sampler(clip());
    expect(times).toEqual([0, 1]);
    expect(values.length).toBe(6);
  });

  it("bakes an eased segment into extra keys that follow the curve", () => {
    const { times, values } = sampler(setEase(clip(), 0, ["body"], 0, "in"));
    expect(times.length).toBe(2 + BAKE_STEPS);
    for (let i = 0; i < times.length; i++) {
      const f = times[i]!;
      expect(values[i * 3]! / 0.0625, `key ${i}`).toBeCloseTo(10 * f * f, 3); // the default scale is 1/16
    }
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("bakes a step as a held value that jumps just before the next key", () => {
    const { times, values } = sampler(setEase(clip(), 0, ["body"], 0, "step"));
    expect(times.length).toBe(3);
    expect(times[1]).toBeCloseTo(0.9999, 4);
    expect(values[3]).toBe(0);
    expect(values[6]! / 0.0625).toBeCloseTo(10, 4);
  });

  it("blends eased turns as quaternions", () => {
    let d: ModelDoc = { ...newModel(), clips: [{ name: "spin", duration: 1, loop: false, tracks: [] }] };
    d = setKey(d, 0, ["body"], "rotation", 0, [0, 0, 0]);
    d = setKey(d, 0, ["body"], "rotation", 1, [0, 180, 0]);
    d = setEase(d, 0, ["body"], 0, "out");
    const { json, bin } = glbJson(exportGlb(d));
    const s = json.animations[0].samplers[0];
    const q = floats(json, bin, s.output);
    expect(q.length).toBe((2 + BAKE_STEPS) * 4);
    for (let i = 0; i < 2 + BAKE_STEPS; i++) expect(Math.hypot(q[i * 4]!, q[i * 4 + 1]!, q[i * 4 + 2]!, q[i * 4 + 3]!)).toBeCloseTo(1, 4);
    // the baked keys sit at thirds-of-a-ninth: the third of the way along is a third of the way eased out
    const mid = slerp([0, 0, 0, 1], [0, 1, 0, 0], applyEase("out", 3 / (BAKE_STEPS + 1)));
    const times = floats(json, bin, s.input);
    const k = times.findIndex((t) => Math.abs(t - 3 / (BAKE_STEPS + 1)) < 1e-6);
    expect(k).toBeGreaterThan(0);
    expect([q[k * 4 + 1], q[k * 4 + 3]].map((n) => Math.round(n! * 1000))).toEqual([mid[1], mid[3]].map((n) => Math.round(n * 1000)));
  });
});
