import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { exportGlb } from "./glb";
import { addClip, samplePose, setKey } from "./model-anim";
import { eulerToQuaternion } from "./model-ease";
import { parseModel, removeNode, serializeModel, updatePart, type Cube, type ModelDoc, type Vec3 } from "./model-doc";
import { IDENTITY, autoWeights, boneKey, compose, dominantBones, invertAffine, multiply, reskin, setWeight, skinnedPoints, transformDirection, transformPoint, worldMatrices } from "./model-skin";

const close = (a: number[], b: number[], digits = 6) => a.forEach((x, i) => expect(x, `item ${i}`).toBeCloseTo(b[i]!, digits));

/// A sleeve: a box of points spanning the shoulder (in the part "arm", which hangs from "body" at (6, 10, 0)).
const sleeve = (): Cube => {
  const verts: Vec3[] = [];
  for (const y of [-8, -4, 0, 4]) for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) verts.push([x, y, z]);
  const polys = [];
  for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) polys.push({ v: [r * 4 + k, r * 4 + ((k + 1) % 4), (r + 1) * 4 + ((k + 1) % 4), (r + 1) * 4 + k] });
  return { shape: "mesh", from: [-1, -8, -1], size: [2, 12, 2], color: "#336699", verts, polys };
};
const model = (): ModelDoc => ({
  version: 1, scale: 1 / 16,
  parts: [{ name: "body", origin: [0, 0, 0], rotation: [0, 0, 0], cubes: [], children: [{ name: "arm", origin: [6, 10, 0], rotation: [0, 0, 0], cubes: [sleeve()], children: [{ name: "hand", origin: [0, -8, 0], rotation: [0, 0, 0], cubes: [], children: [] }] }] }],
});
const path = { parts: [0, 0], cube: 0 };

describe("matrices", () => {
  it("compose, multiply and invert agree", () => {
    const m = compose([1, 2, 3], eulerToQuaternion([20, -35, 60]), [1, 1, 1]);
    close(multiply(m, invertAffine(m)), IDENTITY);
    close(multiply(invertAffine(m), m), IDENTITY);
    const scaled = compose([4, -5, 6], eulerToQuaternion([10, 20, 30]), [2, 3, 0.5]);
    close(multiply(scaled, invertAffine(scaled)), IDENTITY);
    close(transformPoint(compose([1, 2, 3], [0, 0, 0, 1], [1, 1, 1]), [1, 1, 1]), [2, 3, 4]);
    // a quarter turn about z sends x to y
    close(transformPoint(compose([0, 0, 0], eulerToQuaternion([0, 0, 90]), [1, 1, 1]), [1, 0, 0]), [0, 1, 0]);
    close(transformDirection(compose([5, 5, 5], eulerToQuaternion([0, 0, 90]), [1, 1, 1]), [1, 0, 0]), [0, 1, 0]);
  });

  it("places parts in the model, and a pose replaces a part's own place", () => {
    const rest = worldMatrices(model());
    close(transformPoint(rest.get("body/arm")!, [0, 0, 0]), [6, 10, 0]);
    close(transformPoint(rest.get("body/arm/hand")!, [0, 0, 0]), [6, 2, 0]);
    const posed = worldMatrices(model(), new Map([["body/arm", { rotation: eulerToQuaternion([0, 0, 90]) }]]));
    close(transformPoint(posed.get("body/arm")!, [0, 0, 0]), [6, 10, 0]);
    close(transformPoint(posed.get("body/arm/hand")!, [0, 0, 0]), [14, 10, 0]); // the hand swings out to the side
    expect(boneKey(["body", "arm"])).toBe("body/arm");
  });
});

describe("automatic weights", () => {
  const skin = autoWeights(model(), path)!;
  const weightOn = (point: number, bone: string) => skin.weights[point]!.find(([b]) => skin.bones[b] === bone)?.[1] ?? 0;

  it("add up to one for every point, with at most four bones", () => {
    expect(skin.weights).toHaveLength(16);
    for (const w of skin.weights) {
      expect(w.length).toBeLessThanOrEqual(4);
      expect(w.reduce((n, [, x]) => n + x, 0)).toBeCloseTo(1, 3);
    }
  });

  it("lean on one part away from the joints, and share between two parts at a joint", () => {
    // rings of four points at y = -8 (the wrist), -4 (mid arm), 0 and 4 (the shoulder; the point rings above it are inside the body)
    expect(weightOn(4, "body/arm")).toBeGreaterThan(0.9); // mid arm
    expect(weightOn(0, "body/arm")).toBeGreaterThan(0.3); // at the wrist the arm and the hand share
    expect(weightOn(0, "body/arm/hand")).toBeGreaterThan(0.3);
    expect(weightOn(12, "body")).toBeGreaterThan(weightOn(12, "body/arm")); // above the shoulder the body leads
    expect(weightOn(8, "body")).toBeGreaterThan(0.05); // at the shoulder: both
    expect(weightOn(8, "body/arm")).toBeGreaterThan(0.05);
    expect(dominantBones(skin).length).toBe(16);
  });

  it("does not exist for what is not a mesh", () => {
    const d = model();
    d.parts[0]!.children[0]!.cubes = [{ from: [0, 0, 0], size: [1, 1, 1], color: "#ffffff" }];
    expect(autoWeights(d, path)).toBeNull();
    expect(autoWeights(model(), { parts: [0, 0], cube: 5 })).toBeNull();
  });
});

describe("skinned points", () => {
  const withSkin = (): ModelDoc => {
    const d = model();
    d.parts[0]!.children[0]!.cubes[0]!.skin = autoWeights(d, path)!;
    return d;
  };

  it("stay where they are at rest", () => {
    const d = withSkin();
    const rest = worldMatrices(d);
    const at = skinnedPoints(d, path, rest)!;
    const bind = d.parts[0]!.children[0]!.cubes[0]!.verts!.map((v) => transformPoint(rest.get("body/arm")!, v));
    at.forEach((p, i) => close(p, bind[i]!, 6));
  });

  it("follow a part exactly when its weight is one", () => {
    let d = withSkin();
    const cube = setWeight(d.parts[0]!.children[0]!.cubes[0]!, [0], "body/arm", 1);
    d = { ...d, parts: [{ ...d.parts[0]!, children: [{ ...d.parts[0]!.children[0]!, cubes: [cube] }] }] };
    const posed = worldMatrices(d, new Map([["body/arm", { rotation: eulerToQuaternion([0, 0, 90]) }]]));
    // point 0 is (-1, -8, -1) in the arm, which hangs from (6, 10, 0); a quarter turn about z (x, y) -> (-y, x) puts it at (8, -1) from there
    const p = skinnedPoints(d, path, posed)![0]!;
    close(p, [14, 9, -1]);
  });

  it("blend between two parts where the weight is shared", () => {
    let d = withSkin();
    const cube = setWeight(d.parts[0]!.children[0]!.cubes[0]!, [0], "body/arm", 0.5);
    const share = setWeight(cube, [0], "body", 0.5);
    d = { ...d, parts: [{ ...d.parts[0]!, children: [{ ...d.parts[0]!.children[0]!, cubes: [share] }] }] };
    const body: [string, { position: Vec3 }] = ["body", { position: [0, 4, 0] }]; // the body lifts by 4
    const posed = worldMatrices(d, new Map([body]));
    const rest = worldMatrices(d);
    const [lifted, still] = [skinnedPoints(d, path, posed)![0]!, skinnedPoints(d, path, rest)![0]!];
    // the arm hangs from the body, so it lifts too: both bones moved by 4
    close([lifted[1] - still[1]], [4]);
  });
});

describe("setting weights", () => {
  const base = (): Cube => ({ ...sleeve(), skin: { bones: ["body/arm"], weights: sleeve().verts!.map(() => [[0, 1]] as [number, number][]) } });

  it("gives a bone a weight and shares the rest among the others in proportion", () => {
    const c = setWeight(base(), [0, 1], "body", 0.25);
    expect(c.skin!.bones).toEqual(["body/arm", "body"]);
    expect(c.skin!.weights[0]).toEqual([[0, 0.75], [1, 0.25]]);
    const again = setWeight(c, [0], "body/arm", 0.5);
    expect(again.skin!.weights[0]).toEqual([[0, 0.5], [1, 0.5]]);
    expect(base().skin!.weights[0]).toEqual([[0, 1]]); // the input is untouched
  });

  it("keeps four bones at most, always adding up to one, and ignores what makes no sense", () => {
    let c = base();
    for (const [name, w] of [["a", 0.1], ["b", 0.1], ["c", 0.1], ["d", 0.1], ["e", 0.1]] as const) c = setWeight(c, [0], name, w);
    expect(c.skin!.weights[0]!.length).toBe(4);
    expect(c.skin!.weights[0]!.reduce((n, [, x]) => n + x, 0)).toBeCloseTo(1, 4);
    expect(setWeight(c, [0], "x", NaN)).toBe(c);
    expect(setWeight(sleeve(), [0], "x", 1)).toEqual(sleeve()); // no skin: nothing to set
    expect(setWeight(base(), [0], "body/arm", 1).skin!.weights[0]).toEqual([[0, 1]]);
  });
});

describe("skins in the file", () => {
  it("are saved, read back and checked", () => {
    const d = model();
    d.parts[0]!.children[0]!.cubes[0]!.skin = autoWeights(d, path)!;
    const text = serializeModel(d);
    expect(text).toContain('"skin": { "bones"');
    const back = parseModel(text);
    expect(back.ok && serializeModel(back.doc)).toBe(text);
    const bad = (mutate: (j: any) => void) => {
      const j = JSON.parse(text);
      mutate(j.parts[0].children[0].cubes[0].skin);
      return parseModel(JSON.stringify(j));
    };
    expect(bad((s) => s.weights.pop())).toMatchObject({ ok: false });
    expect(bad((s) => (s.weights[0] = [[9, 1]]))).toMatchObject({ ok: false });
    expect(bad((s) => (s.weights[0] = [[0, 0.5]]))).toMatchObject({ ok: false });
    expect(bad((s) => (s.bones = []))).toMatchObject({ ok: false });
    const box = JSON.parse(text);
    box.parts[0].children[0].cubes[0] = { from: [0, 0, 0], size: [1, 1, 1], color: "#ffffff", skin: { bones: ["body"], weights: [] } };
    expect(parseModel(JSON.stringify(box))).toMatchObject({ ok: false });
  });
});

/// The sleeve, skinned, with a clip "wave" that swings the arm a quarter turn at t = 1.
export function waving(): ModelDoc {
  let d = model();
  d.parts[0]!.children[0]!.cubes[0]!.skin = autoWeights(d, path)!;
  d = addClip(d, "wave").doc;
  d = setKey(d, 0, ["body", "arm"], "rotation", 0, [0, 0, 0]);
  d = setKey(d, 0, ["body", "arm"], "rotation", 1, [0, 0, 90]);
  return d;
}

const glbJson = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + view.getUint32(12, true))));
};

describe("skins in the glb", () => {
  it("become one node with a skin whose joints are the part nodes", () => {
    const j = glbJson(exportGlb(waving()));
    expect(j.skins).toHaveLength(1);
    expect(j.skins[0].joints).toHaveLength(waving().parts[0]!.children[0]!.cubes[0]!.skin!.bones.length);
    const node = j.nodes.find((n: any) => n.skin === 0);
    expect(node.mesh).toBeDefined();
    expect(j.scenes[0].nodes).toContain(j.nodes.indexOf(node));
    const attrs = j.meshes[node.mesh].primitives[0].attributes;
    expect(attrs.JOINTS_0).toBeDefined();
    expect(attrs.WEIGHTS_0).toBeDefined();
    const arm = j.nodes.find((n: any) => n.name === "arm");
    expect(arm.mesh).toBeUndefined(); // its shape is the skinned node
  });

  it("move with the arm in the studio's own maths", () => {
    const d = waving();
    const posed = worldMatrices(d, samplePose(d.clips![0]!, 1, false) as any);
    const pts = skinnedPoints(d, path, posed)!;
    expect(pts).toHaveLength(16);
    expect(pts[4]![0]).toBeGreaterThan(6); // mid arm swings out to the side
  });

  const fixture = new URL("../../../crates/nova-runtime/tests/fixtures/studio_model_skin.glb", import.meta.url);
  it("match the committed fixture byte for byte (UPDATE_FIXTURES=1 rewrites it)", () => {
    const bytes = exportGlb(waving());
    if (process.env.UPDATE_FIXTURES || !existsSync(fixture)) writeFileSync(fixture, bytes);
    expect(Array.from(readFileSync(fixture))).toEqual(Array.from(bytes));
  });
});

describe("skins when the model changes", () => {
  const skinned = () => {
    const d = model();
    d.parts[0]!.children[0]!.cubes[0]!.skin = autoWeights(d, path)!;
    return d;
  };
  const bones = (d: ModelDoc) => d.parts[0]!.children[0]!.cubes[0]!.skin?.bones;

  it("follow a renamed part, and the parts below it", () => {
    expect(bones(updatePart(skinned(), [0, 0], { name: "limb" }))).toEqual(["body/limb", "body/limb/hand", "body"]);
    expect(bones(updatePart(skinned(), [0], { name: "torso" }))).toEqual(["torso/arm", "torso/arm/hand", "torso"]);
  });

  it("let go of a removed part and share its weight out again", () => {
    const d = removeNode(skinned(), { parts: [0, 0, 0] }); // the hand
    const skin = d.parts[0]!.children[0]!.cubes[0]!.skin!;
    expect(skin.bones).toEqual(["body/arm", "body"]);
    for (const w of skin.weights) {
      expect(w.reduce((n, [, x]) => n + x, 0)).toBeCloseTo(1, 3);
      for (const [b] of w) expect(b).toBeLessThan(2);
    }
    expect(parseModel(serializeModel(d)).ok).toBe(true);
  });

  it("works out weights again only when the points changed", () => {
    const d = skinned();
    expect(reskin(d, path)).toBe(d);
    const cube = d.parts[0]!.children[0]!.cubes[0]!;
    cube.verts!.push([0, 8, 0]);
    expect(cube.skin!.weights).toHaveLength(16);
    const again = reskin(d, path);
    expect(again.parts[0]!.children[0]!.cubes[0]!.skin!.weights).toHaveLength(17);
  });
});
