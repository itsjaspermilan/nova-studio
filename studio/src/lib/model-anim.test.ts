import { describe, expect, it } from "vitest";
import { exportGlb } from "./glb";
import { addClip, clipTime, findTrack, removeClip, removeKey, samplePose, setKey, snapTime, updateClip } from "./model-anim";
import { addPart, addCube, newModel, parseModel, removeNode, serializeModel, updatePart, type ModelDoc } from "./model-doc";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/// A car body with a wheel part and a clip "spin" that turns the wheel and bobs the body.
export function animated(): ModelDoc {
  let d = newModel();
  d = addPart(d, [0], "wheel").doc;
  d = addCube(d, [0, 0], { from: [-2, -2, -1], size: [4, 4, 2], color: "#202020" }).doc;
  d = updatePart(d, [0, 0], { origin: [6, 2, 8] });
  d = addClip(d, "spin").doc;
  d = updateClip(d, 0, { duration: 2 });
  d = setKey(d, 0, ["body", "wheel"], "rotation", 0, [0, 0, 0]);
  d = setKey(d, 0, ["body", "wheel"], "rotation", 2, [0, 0, 180]);
  d = setKey(d, 0, ["body"], "position", 0, [0, 0, 0]);
  d = setKey(d, 0, ["body"], "position", 1, [0, 4, 0]);
  return d;
}

describe("clips", () => {
  it("adds clips with unique names, edits and removes them, without changing the original", () => {
    const base = newModel();
    const a = addClip(base, "run");
    expect(a.doc.clips).toEqual([{ name: "run", duration: 1, loop: true, tracks: [] }]);
    expect(base.clips).toBeUndefined();
    const b = addClip(a.doc, "run");
    expect(b.doc.clips!.map((c) => c.name)).toEqual(["run", "run2"]);
    expect(b.index).toBe(1);
    const renamed = updateClip(b.doc, 1, { name: "walk", loop: false });
    expect(renamed.clips![1]).toMatchObject({ name: "walk", loop: false });
    expect(updateClip(renamed, 1, { name: "run" }).clips![1]!.name).toBe("walk"); // names stay unique
    expect(updateClip(renamed, 9, { loop: true })).toBe(renamed);
    expect(removeClip(removeClip(renamed, 1), 0).clips).toBeUndefined();
  });

  it("sets keys in time order, replaces keys at the same time, snaps and clamps times", () => {
    let d = addClip(newModel()).doc;
    const part = ["body"];
    d = setKey(d, 0, part, "rotation", 0.5, [0, 10, 0]);
    d = setKey(d, 0, part, "rotation", 0.2, [0, 5, 0]);
    d = setKey(d, 0, part, "rotation", 0.504, [0, 99, 0]); // same time as 0.5
    d = setKey(d, 0, part, "rotation", 7, [0, 1, 0]); // clamped to the clip's end
    d = setKey(d, 0, part, "rotation", -3, [0, 2, 0]); // clamped to the start
    expect(findTrack(d.clips![0]!, part, "rotation")!.keys.map((k) => [k.t, k.value[1]])).toEqual([[0, 2], [0.2, 5], [0.5, 99], [1, 1]]);
    expect(snapTime(0.126)).toBeCloseTo(0.13);
    expect(setKey(d, 0, part, "rotation", 0, [NaN, 0, 0])).toBe(d);
    expect(setKey(d, 5, part, "rotation", 0, [0, 0, 0])).toBe(d);
    expect(setKey(d, 0, [], "rotation", 0, [0, 0, 0])).toBe(d);
  });

  it("removes keys (and empty tracks) and shortening a clip drops keys past the end", () => {
    let d = setKey(setKey(addClip(newModel()).doc, 0, ["body"], "scale", 0, [1, 1, 1]), 0, ["body"], "scale", 1, [2, 2, 2]);
    expect(removeKey(d, 0, ["body"], "scale", 0.3)).toBe(d);
    d = updateClip(d, 0, { duration: 0.5 });
    expect(findTrack(d.clips![0]!, ["body"], "scale")!.keys).toHaveLength(1);
    d = removeKey(d, 0, ["body"], "scale", 0);
    expect(d.clips![0]!.tracks).toEqual([]);
  });

  it("tracks follow renamed parts and disappear with removed ones", () => {
    let d = animated();
    d = updatePart(d, [0, 0], { name: "tyre" });
    expect(d.clips![0]!.tracks.map((t) => t.part.join("/"))).toEqual(["body/tyre", "body"]);
    d = updatePart(d, [0], { name: "chassis" });
    expect(d.clips![0]!.tracks.map((t) => t.part.join("/"))).toEqual(["chassis/tyre", "chassis"]);
    expect(removeNode(d, { parts: [0, 0] }).clips![0]!.tracks.map((t) => t.part.join("/"))).toEqual(["chassis"]);
    expect(removeNode(d, { parts: [0], cube: 0 }).clips![0]!.tracks).toHaveLength(2); // cubes have no tracks
  });
});

describe("sampling", () => {
  it("blends linearly between keys and holds before the first and after the last", () => {
    const clip = animated().clips![0]!;
    const at = (t: number, loop = false) => samplePose(clip, t, loop).get("body")!.position!;
    expect(at(0)).toEqual([0, 0, 0]);
    expect(at(0.5)).toEqual([0, 2, 0]);
    expect(at(1)).toEqual([0, 4, 0]);
    expect(at(1.7)).toEqual([0, 4, 0]); // held after the last key
    expect(samplePose(clip, 0, false).get("body")!.rotation).toBeUndefined();
    expect(samplePose(clip, 0, false).has("body/wheel")).toBe(true);
  });

  it("blends rotations as quaternions the short way round and wraps looping clips", () => {
    const clip = animated().clips![0]!;
    const q = samplePose(clip, 1, false).get("body/wheel")!.rotation!; // halfway from 0 to 180 degrees about z
    expect(q[0]).toBeCloseTo(0);
    expect(q[2]).toBeCloseTo(Math.sin(Math.PI / 4));
    expect(q[3]).toBeCloseTo(Math.cos(Math.PI / 4));
    expect(clipTime(clip, 2.5, true)).toBeCloseTo(0.5);
    expect(clipTime(clip, -0.5, true)).toBeCloseTo(1.5);
    expect(clipTime(clip, 9, false)).toBe(2);
    expect(clipTime(clip, NaN)).toBe(0);
    const wrapped = samplePose(clip, 2.5, true).get("body")!.position!;
    expect(wrapped).toEqual([0, 2, 0]);
  });
});

describe("saving and exporting clips", () => {
  it("round-trips clips through the model file and rejects damaged ones", () => {
    const d = animated();
    const text = serializeModel(d);
    expect(parseModel(text)).toEqual({ ok: true, doc: d });
    expect(serializeModel(newModel())).not.toContain("clips");
    const bad = (m: (x: any) => void) => {
      const x = JSON.parse(text);
      m(x);
      return parseModel(JSON.stringify(x));
    };
    expect(bad((x) => (x.clips[0].duration = 0))).toMatchObject({ ok: false, error: expect.stringContaining("duration") });
    expect(bad((x) => (x.clips[0].tracks[0].prop = "colour"))).toMatchObject({ ok: false, error: expect.stringContaining("prop") });
    expect(bad((x) => (x.clips[0].tracks[0].keys.reverse())) ).toMatchObject({ ok: false, error: expect.stringContaining("time order") });
    expect(bad((x) => (x.clips[0].tracks[0].part = []))).toMatchObject({ ok: false });
    expect(bad((x) => (x.clips[0].loop = "yes"))).toMatchObject({ ok: false });
  });

  function glbJson(d: ModelDoc) {
    const bytes = exportGlb(d);
    const v = new DataView(bytes.buffer);
    return JSON.parse(new TextDecoder().decode(bytes.slice(20, 20 + v.getUint32(12, true))));
  }

  it("writes glTF animations whose channels target the right nodes, with held end keys", () => {
    const json = glbJson(animated());
    expect(json.animations).toHaveLength(1);
    const anim = json.animations[0];
    expect(anim.name).toBe("spin");
    expect(anim.channels).toHaveLength(2);
    const nodeNames = json.nodes.map((n: any) => n.name);
    const paths = anim.channels.map((c: any) => [nodeNames[c.target.node], c.target.path]);
    expect(paths).toEqual([["wheel", "rotation"], ["body", "translation"]]);
    const position = anim.samplers[1];
    const times = json.accessors[position.input];
    expect(times).toMatchObject({ count: 3, min: [0], max: [2] }); // keys at 0 and 1, held to the clip's end at 2
    expect(json.accessors[position.output]).toMatchObject({ count: 3, type: "VEC3" });
    expect(json.accessors[anim.samplers[0].output]).toMatchObject({ count: 2, type: "VEC4" });
  });

  it("leaves out animations for parts that no longer exist, and models without clips have none", () => {
    expect(glbJson(newModel()).animations).toBeUndefined();
    const d = animated();
    d.clips![0]!.tracks[0]!.part = ["body", "ghost"];
    expect(glbJson(d).animations[0].channels).toHaveLength(1);
    d.clips![0]!.tracks = [];
    expect(glbJson(d).animations).toBeUndefined();
  });

  // The runtime's tests import this exact file with the real loader and sample the clip (tests/clips.rs).
  const fixture = new URL("../../../crates/nova-runtime/tests/fixtures/studio_model_anim.glb", import.meta.url);
  it("matches the committed animated fixture byte for byte (UPDATE_FIXTURES=1 rewrites it)", () => {
    const bytes = exportGlb(animated());
    if (process.env.UPDATE_FIXTURES || !existsSync(fixture)) writeFileSync(fixture, bytes);
    expect(Array.from(readFileSync(fixture))).toEqual(Array.from(bytes));
  });
});

