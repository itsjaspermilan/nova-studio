// 3D making with less typing: tubes and lathes that become meshes, feet placed instead of joints turned, a sheet of
// several models at one scale, a preview that never crops, and a 3D scene seen from above as a plan.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodePng } from "./draw";
import { expandModel } from "./modelkit";
import { glbBounds } from "./models";
import { call, peakRemarks } from "./server";

let dir = "";
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "nova-mcp-making-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const text = (r: ReturnType<typeof call>) => (r.content[0] as { text: string }).text;
const use = (name: string, args: Record<string, unknown> = {}) => call(name, { project: dir, ...args });
const picture = (r: ReturnType<typeof call>, n = 1) => decodePng(Buffer.from((r.content[n] as { data: string }).data, "base64"));
const built = existsSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../target/release/nova"));

type V = [number, number, number];
/// Six times the volume a closed mesh encloses: above 0 when every face is counter-clockwise seen from outside.
function volume(verts: V[], polys: { v: number[] }[]): number {
  let sum = 0;
  for (const { v } of polys) {
    for (let i = 1; i < v.length - 1; i++) {
      const [a, b, c] = [verts[v[0]!]!, verts[v[i]!]!, verts[v[i + 1]!]!];
      sum += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
    }
  }
  return sum;
}

const leg = (side: string, x: number) => ({
  name: `leg_${side}`, origin: [x, 0, 0], rotation: [0, 0, 0], cubes: [{ shape: "tube", points: [[0, 0, 0], [0, -3.5, 0], [0, -7, 0]], radius: 1.3, color: "#223344" }],
  children: [{
    name: `shin_${side}`, origin: [0, -7, 0], rotation: [0, 0, 0], cubes: [{ shape: "tube", points: [[0, 0, 0], [0, -6, 0]], radii: [1.2, 0.9], color: "#223344" }],
    children: [{ name: `foot_${side}`, origin: [0, -6, 0], rotation: [0, 0, 0], cubes: [{ from: [-1, -1, -1], size: [2, 1, 4], color: "#553311" }], children: [] }],
  }],
});
const biped = (clips: unknown[]) => ({
  version: 1, scale: 0.0625,
  parts: [{ name: "hips", origin: [0, 14, 0], rotation: [0, 0, 0], cubes: [{ from: [-3, 0, -2], size: [6, 8, 4], color: "#3b6ea5" }], children: [leg("l", 1.6), leg("r", -1.6)] }],
  clips,
});

/// Where the ankle is (y, z in the model) for the turns of thigh and shin, with the hips at `hipY`.
function ankle(hipY: number, thigh: number, shin: number): [number, number] {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dir = (t: number): [number, number] => [-Math.cos(t), -Math.sin(t)];
  const a = dir(rad(thigh)), b = dir(rad(thigh + shin));
  return [hipY + a[0] * 7 + b[0] * 6, a[1] * 7 + b[1] * 6];
}

describe("shapes that are written as meshes", () => {
  it("makes a tube and a lathe closed, facing out, and leaves the rest of the shape alone", () => {
    const { model, notes } = expandModel({
      version: 1,
      parts: [{ name: "a", origin: [0, 0, 0], rotation: [0, 0, 0], cubes: [
        { shape: "tube", points: [[0, 0, 0], [0, -5, 1], [2, -10, 0]], radii: [1.5, 1.2, 1], segments: 6, color: "#aabbcc" },
        { shape: "lathe", profile: [[0, 0], [3, 0], [2, 6], [0, 8]], segments: 8, color: "#ccbbaa", smooth: false },
        { shape: "lathe", profile: [[2, -1], [2, 1]], axis: "x", at: [5, 5, 5], segments: 12 },
        { from: [0, 0, 0], size: [1, 1, 1], color: "#ffffff" },
      ], children: [] }],
    });
    const [tube, vase, wheel, box] = model.parts[0].cubes;
    expect(notes).toEqual(["1 tube and 2 lathes written as free meshes (the file holds their points and faces)"]);
    expect(tube.shape).toBe("mesh");
    expect(tube.color).toBe("#aabbcc");
    expect(tube.points).toBeUndefined();
    expect(tube.verts.length).toBe(18);
    expect(tube.polys.length).toBe(12 + 2); // two rings of six sides, two ends
    expect(tube.polys[0].smooth).toBe(true);
    expect(volume(tube.verts, tube.polys)).toBeGreaterThan(0);
    expect(vase.verts.length).toBe(1 + 8 + 8 + 1);
    expect(vase.polys.length).toBe(24);
    expect(vase.polys[0].smooth).toBeUndefined();
    expect(volume(vase.verts, vase.polys)).toBeGreaterThan(0);
    // a wheel lying along x: every point 2 from the axis through [5, 5, 5], and closed at both ends
    for (const p of wheel.verts) expect(Math.hypot(p[1] - 5, p[2] - 5)).toBeCloseTo(2, 2);
    expect(wheel.from[0]).toBe(4);
    expect(wheel.size[0]).toBe(2);
    expect(volume(wheel.verts, wheel.polys)).toBeGreaterThan(0);
    expect(box).toEqual({ from: [0, 0, 0], size: [1, 1, 1], color: "#ffffff" });
  });

  it("says what a tube or a lathe is missing", () => {
    const one = (cube: unknown) => () => expandModel({ parts: [{ name: "arm", cubes: [cube] }] });
    expect(one({ shape: "tube", points: [[0, 0, 0]], radius: 1 })).toThrow(/arm, shape 0: a tube needs "points": at least two/);
    expect(one({ shape: "tube", points: [[0, 0, 0], [0, 1, 0]] })).toThrow(/a tube needs "radius" \(a number above 0\) or "radii" \(one for each of its 2 points\)/);
    expect(one({ shape: "lathe", profile: [[1, 0]] })).toThrow(/a lathe needs "profile"/);
    expect(one({ shape: "lathe", profile: [[1, 0], [1, 2]], axis: "w" })).toThrow(/"axis" is "x", "y" or "z"/);
  });
});

describe("feet instead of angles", () => {
  it("makes a walk whose standing foot stays on the ground and moves back evenly, and says the speed it fits", () => {
    const { model, notes } = expandModel(biped([{ name: "walk", duration: 0.6, loop: true, tracks: [], walk: { legs: ["foot_l", "foot_r"], stride: 10, lift: 2.5, event: "step" } }]));
    const clip = model.clips[0];
    expect(clip.walk).toBeUndefined();
    const track = (part: string, prop = "rotation") => clip.tracks.find((t: any) => t.prop === prop && t.part[t.part.length - 1] === part);
    expect(track("leg_l").part).toEqual(["hips", "leg_l"]);
    expect(track("shin_l").part).toEqual(["hips", "leg_l", "shin_l"]);
    expect(track("foot_l").keys.length).toBe(17);
    const hips = track("hips", "position");
    expect(hips.keys[0].value[1]).toBeLessThan(14); // lowered so the legs reach
    // the left foot stands for the first 0.6 of the cycle: its ankle stays at height 1 and goes back 10 in all
    const thigh = track("leg_l").keys, shin = track("shin_l").keys, foot = track("foot_l").keys;
    const at = (i: number) => ankle(hips.keys[i].value[1], thigh[i].value[0], shin[i].value[0]);
    const standing = thigh.map((_: unknown, i: number) => i).filter((i: number) => thigh[i].t <= 0.36);
    for (const i of standing) {
      expect(at(i)[0]).toBeCloseTo(1, 2);
      expect(at(i)[1]).toBeCloseTo(5 - (10 * thigh[i].t) / 0.36, 1); // (key times are kept to a thousandth of a second)
      expect(thigh[i].value[0] + shin[i].value[0] + foot[i].value[0]).toBeCloseTo(0, 2); // the sole stays level
      expect(shin[i].value[0]).toBeGreaterThanOrEqual(-0.01); // the knee bends the way a knee does
    }
    // in the swing it is off the ground, and the cycle closes
    expect(Math.max(...thigh.map((_: unknown, i: number) => at(i)[0]))).toBeCloseTo(1 + 2.5, 1);
    expect(thigh[16].value[0]).toBeCloseTo(thigh[0].value[0], 3);
    // the other foot is half a cycle behind: it lands at 0.3
    expect(clip.events).toEqual([{ t: 0, name: "step" }, { t: 0.3, name: "step" }]);
    expect(notes.join("\n")).toContain('clip "walk": a walk of 2 legs (leg_l > shin_l > foot_l; leg_r > shin_r > foot_r), 17 keys each. A standing foot moves back 10 units in 0.36 s, so the feet do not slide when the entity moves 1.736 world units a second');
    expect(notes.join("\n")).toMatch(/The hips \("hips"\) are keyed [\d.]+ units lower/);
  });

  it("puts an ankle where ik says, straight between the places", () => {
    const { model, notes } = expandModel(biped([{ name: "kick", duration: 0.5, loop: false, tracks: [], ik: { foot_r: [[0, -1.6, 1, 0], [0.25, -1.6, 5, 8], [0.5, -1.6, 1, 0]] } }]));
    const clip = model.clips[0];
    const keys = (part: string) => clip.tracks.find((t: any) => t.part[t.part.length - 1] === part).keys;
    const thigh = keys("leg_r"), shin = keys("shin_r");
    expect(thigh.length).toBeGreaterThan(10);
    thigh.forEach((k: any, i: number) => {
      const f = k.t <= 0.25 ? k.t / 0.25 : (0.5 - k.t) / 0.25;
      const [y, z] = ankle(14, k.value[0], shin[i].value[0]);
      expect(y).toBeCloseTo(1 + 4 * f, 2);
      expect(z).toBeCloseTo(8 * f, 2);
    });
    expect(notes.join("\n")).toContain("leg_r > shin_r > foot_r solved from 3 places into");
    // too far to reach: said, with how far short
    const far = expandModel(biped([{ name: "reach", duration: 0.2, loop: false, tracks: [], ik: { foot_l: [[0, 1.6, 1, 0], [0.2, 1.6, 1, 30]] } }]));
    expect(far.notes.join("\n")).toMatch(/the leg leg_l > shin_l > foot_l is [\d.]+ units too short to reach its foot's place at 0\.2 s/);
  });

  it("says what is wrong with a foot's name, a leg or a stride", () => {
    const clip = (extra: object) => () => expandModel(biped([{ name: "c", duration: 1, loop: true, tracks: [], ...extra }]));
    expect(clip({ ik: { toe: [[0, 0, 0, 0]] } })).toThrow(/clip "c": there is no part called "toe"/);
    expect(clip({ ik: { leg_l: [[0, 0, 0, 0]] } })).toThrow(/"leg_l" needs two parts above it, a thigh and a shin/);
    expect(clip({ ik: { foot_l: [[0, 0, 0]] } })).toThrow(/ik "foot_l" is a list of \[t, x, y, z\]/);
    expect(clip({ walk: { legs: ["foot_l"], stride: 40 } })).toThrow(/a stride of 40 is longer than the leg leg_l > shin_l > foot_l can make/);
    expect(clip({ walk: { legs: ["foot_l"], stride: 8, speed: 2 } })).toThrow(/it has no "speed"; it takes legs, stride, lift, stance/);
    expect(clip({ walk: { legs: ["foot_l"] } })).toThrow(/walk needs "stride"/);
  });
});

describe("models through the tools", () => {
  const post = { version: 1, scale: 0.0625, parts: [{ name: "post", origin: [0, 0, 0], rotation: [0, 0, 0], cubes: [{ shape: "lathe", profile: [[0, 0], [6, 0], [4, 80], [0, 84]], segments: 8, color: "#888888" }], children: [] }] };

  it("writes tubes, lathes and a walk as a file the editor reads, and says what it did", () => {
    const said = text(use("model_write", { name: "biped", bend: true, model: biped([{ name: "walk", duration: 0.5, loop: true, tracks: [], walk: { legs: ["foot_l", "foot_r"], stride: 9 } }]) }));
    expect(said).toMatch(/^models\/biped\.model\.json and models\/biped\.glb: 7 parts, 7 shapes, \d+ triangles, 4 bending/);
    expect(said).toContain("4 tubes written as free meshes");
    expect(said).toMatch(/the feet do not slide when the entity moves [\d.]+ world units a second/);
    const saved = JSON.parse(readFileSync(join(dir, "models/biped.model.json"), "utf8"));
    expect(JSON.stringify(saved)).not.toMatch(/"tube"|"walk":/);
    expect(saved.parts[0].children[0].cubes[0].shape).toBe("mesh");
    expect(saved.clips[0].tracks.length).toBe(7); // the hips' height and three turns a leg
    // the model's size is read from the file it wrote
    const b = glbBounds(readFileSync(join(dir, "models/biped.glb")))!;
    expect(b.max[1]).toBeCloseTo(22 * 0.0625, 2);
    expect(b.min[1]).toBeCloseTo(0, 2);
    expect(() => use("model_write", { name: "bad", model: "{ not json" })).toThrow(/the model is not valid: not valid JSON/);
  });

  it.skipIf(!built)("never crops a model, whatever size is asked, and shows several at one scale", () => {
    use("model_write", { name: "post", model: post });
    use("model_write", { name: "crate", model: { version: 1, scale: 0.0625, parts: [{ name: "c", origin: [0, 0, 0], rotation: [0, 0, 0], cubes: [{ from: [-8, 0, -8], size: [16, 16, 16], color: "#aa7744" }], children: [] }] } });
    // a 5.25 m post asked for as if it were 1 m tall: the sky is still all round it
    const r = use("model_preview", { name: "post", size: 1, width: 200, height: 200, yaw: 0, pitch: 0 });
    expect(text(r)).toContain("size at rest: 0.75 wide (x), 5.25 high (y), 0.75 deep (z), from y 0.00 to 5.25 (world units)");
    const p = picture(r);
    const sky = [p.data[0]!, p.data[1]!, p.data[2]!];
    const same = (x: number, y: number) => [0, 1, 2].every((k) => Math.abs(p.data[(y * p.w + x) * 4 + k]! - sky[k]!) < 12);
    for (let x = 0; x < p.w; x += 7) expect(same(x, 2) && same(x, p.h - 3), `top and bottom rows at ${x}`).toBe(true);
    expect(same(100, 100)).toBe(false); // the post is in the middle
    // several: one picture, two tiles, sizes in the text; the crate is small beside the post
    const sheet = use("model_preview", { names: ["post", "crate"], width: 160, height: 120 });
    expect(text(sheet)).toMatch(/^2 models at one scale \(the largest, 5\.\d+ world units corner to corner, fills its picture\)/);
    expect(text(sheet)).toContain("  crate: 1.00 wide (x), 1.00 high (y), 1.00 deep (z), from y 0.00 to 1.00; clips: none");
    expect(picture(sheet).w).toBeGreaterThan(320);
    expect(() => use("model_preview", {})).toThrow(/say which model: `name`, or `names`/);
    expect(() => use("model_preview", { names: ["post", "nope"] })).toThrow(/there is no models\/nope\.glb/);
    expect(() => use("model_preview", { names: ["post"], clip: "walk" })).toThrow(/`clip` is for one model/);
  });

  it("shows a 3D scene from above as a plan, with what blocks marked", () => {
    use("model_write", { name: "post", model: post });
    use("write_file", { path: "entities/post.lua", text: 'return nova.entity { model = "post", tags = { "solid" } }\n' });
    use("write_file", { path: "entities/lamp.lua", text: 'return nova.entity { model = "post" }\n' });
    use("write_file", { path: "entities/spot.lua", text: "return nova.entity {}\n" });
    const scene = { version: 1, camera: { eye: [0, 4, 10], target: [0, 1, 0], fov: 55 }, objects: [{ kind: "post", name: "gate", x: 4, y: 0, z: -2 }, { kind: "post", x: -4, y: 0, z: -2, props: { sx: 2 } }, { kind: "lamp", x: 0, y: 0, z: 6 }, { kind: "spot", name: "start", x: 0, y: 0, z: 9 }] };
    use("scene_write", { name: "yard", picture: false, scene });
    const r = use("scene_preview", { name: "yard" });
    const said = text(r);
    expect(said).toMatch(/^scenes\/yard\.scene\.json from above \(a 3D scene\): 4 objects, x -[\d.]+ to [\d.]+, z -[\d.]+ to [\d.]+ metres, \d+ pixels a metre, grid \d+ m/);
    expect(said).toContain("  post x2 (0.75 x 0.75 m on the ground, 5.25 high; SOLID: tagged or set solid): gate [4, -2], [-4, -2]");
    expect(said).toContain("  lamp x1 (0.75 x 0.75 m on the ground, 5.25 high): [0, 6]");
    expect(said).toContain("  spot x1 (no model): start [0, 9]");
    const p = picture(r);
    const count = (c: number[]) => {
      let n = 0;
      for (let i = 0; i < p.data.length; i += 4) if (p.data[i] === c[0] && p.data[i + 1] === c[1] && p.data[i + 2] === c[2]) n++;
      return n;
    };
    expect(count([235, 90, 80])).toBeGreaterThan(40); // red outlines of the two posts
    expect(count([110, 170, 235])).toBeGreaterThan(10); // the lamp's footprint, which does not block
    expect(count([240, 170, 60])).toBeGreaterThan(8); // the cross of the thing with no model
    // a flat scene still gets its map
    use("scene_write", { name: "flat", picture: false, scene: { version: 1, objects: [] } });
    expect(text(use("scene_preview", { name: "flat" }))).not.toContain("from above (a 3D scene)");
  });
});

describe("a recording that fills the scale", () => {
  it("is remarked on when its peak is within 1 dB of the top, and not otherwise", () => {
    const loud = peakRemarks("run.wav: 32.0 s\n  level: peak -0.2 dBFS, loud parts -12.0 dB RMS\n  reading: music");
    expect(loud.split("\n")[2]).toMatch(/^  remark: the peak, -0\.2 dBFS, is within 1 dB of full scale: there is no room left/);
    expect(loud.split("\n").length).toBe(4);
    const fine = "  level: peak -3.5 dBFS, loud parts -14.0 dB RMS";
    expect(peakRemarks(fine)).toBe(fine);
  });
});
