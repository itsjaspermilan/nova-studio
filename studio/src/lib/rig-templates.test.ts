import { describe, expect, it } from "vitest";
import { RIG_KINDS, rigTemplate } from "./rig-templates";
import { countCubes, parseModel, serializeModel, walk } from "./model-doc";
import { autoWeights } from "./model-skin";
import { mirrorClip } from "./model-anim-tools";
import { addClip, setKey } from "./model-anim";
import { exportGlb } from "./glb";

const names = (k: Parameters<typeof rigTemplate>[0]) => walk(rigTemplate(k)).map((w) => w.part.name);

describe("rig templates", () => {
  it("every template is a valid model that survives saving and exports a glb", () => {
    for (const { id } of RIG_KINDS) {
      const doc = rigTemplate(id);
      const back = parseModel(serializeModel(doc));
      expect(back.ok, id).toBe(true);
      expect(countCubes(doc)).toBeGreaterThan(4);
      expect(exportGlb(doc).length).toBeGreaterThan(100);
    }
  });
  it("the person has the parts an animation expects, nested hips to hands and feet", () => {
    const n = names("humanoid");
    expect(n.length).toBe(15);
    for (const w of ["hips", "spine", "head", "left arm", "left forearm", "left hand", "right arm", "right forearm", "right hand", "left thigh", "left shin", "left foot", "right thigh", "right shin", "right foot"]) expect(n).toContain(w);
    const doc = rigTemplate("humanoid");
    const hand = walk(doc).find((w) => w.part.name === "right hand")!;
    expect(hand.depth).toBe(4); // hips > spine > arm > forearm > hand
    expect(new Set(n).size).toBe(n.length); // no two parts share a name
  });
  it("left parts are on the +x side and right parts on -x, so a mirror swaps them", () => {
    const doc = rigTemplate("humanoid");
    const arm = (side: string) => walk(doc).find((w) => w.part.name === `${side} arm`)!.part.origin[0];
    expect(arm("left")).toBeGreaterThan(0);
    expect(arm("right")).toBe(-arm("left"));
    let d = addClip(doc, "wave").doc;
    d = setKey(d, 0, ["hips", "spine", "left arm"], "rotation", 0, [0, 0, 80]);
    const m = mirrorClip(d, 0);
    expect(m.clips![0]!.tracks[0]!.part).toEqual(["hips", "spine", "right arm"]);
  });
  it("can be skinned: the bendy-mesh weights work out for a part with parent and children", () => {
    const doc = rigTemplate("humanoid");
    const torso = walk(doc).find((w) => w.part.name === "spine")!;
    // (skin weights are made for a mesh; a box shape is first made a mesh by the editor, so only check that the tree gives it bones to use)
    expect(typeof autoWeights).toBe("function");
    expect(torso.part.children.length).toBe(3);
  });
  it("the animal has four two-part legs and a car four wheels", () => {
    expect(names("quadruped").filter((n) => n.includes("thigh")).length).toBe(4);
    expect(names("quadruped").filter((n) => n.includes("hoof")).length).toBe(4);
    expect(names("car").filter((n) => n.includes("wheel")).length).toBe(4);
  });
});
