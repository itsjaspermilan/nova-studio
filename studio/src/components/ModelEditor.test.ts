// @vitest-environment jsdom
// The model editor mounted for real: the part tree, and the "Bend with parts" key with its weight gradient.
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ModelEditor from "./ModelEditor.svelte";
import { studio } from "../lib/store.svelte";
import { serializeModel, type Cube, type ModelDoc, type Vec3 } from "../lib/model-doc";
import { autoWeights } from "../lib/model-skin";

vi.mock("three", async (original) => ({ ...(await original<typeof import("three")>()), WebGLRenderer: (await import("../test/gl")).FakeRenderer }));

const PATH = "models/sleeve.model.json";

// a sleeve spanning a shoulder, as in the skin tests: the body, an arm hanging from it, a hand hanging from the arm
const sleeve = (): Cube => {
  const verts: Vec3[] = [];
  for (const y of [-8, -4, 0, 4]) for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) verts.push([x, y, z]);
  const polys = [];
  for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) polys.push({ v: [r * 4 + k, r * 4 + ((k + 1) % 4), (r + 1) * 4 + ((k + 1) % 4), (r + 1) * 4 + k] });
  return { shape: "mesh", from: [-1, -8, -1], size: [2, 12, 2], color: "#336699", verts, polys };
};
function skinned(): ModelDoc {
  const doc: ModelDoc = {
    version: 1, scale: 1 / 16,
    parts: [{ name: "body", origin: [0, 0, 0], rotation: [0, 0, 0], cubes: [], children: [{ name: "arm", origin: [6, 10, 0], rotation: [0, 0, 0], cubes: [sleeve()], children: [{ name: "hand", origin: [0, -8, 0], rotation: [0, 0, 0], cubes: [], children: [] }] }] }],
  };
  doc.parts[0]!.children[0]!.cubes[0]!.skin = autoWeights(doc, { parts: [0, 0], cube: 0 })!;
  return doc;
}

let host: HTMLElement;
let app: ReturnType<typeof mount> | undefined;

function open(doc: ModelDoc) {
  const text = serializeModel(doc);
  studio.tabs = [{ path: PATH, text, saved: text, binary: false, size: text.length }];
  studio.active = PATH;
  app = mount(ModelEditor, { target: host, props: { path: PATH, text, onjson: () => {} } });
  flushSync();
}
const click = (el: Element | null | undefined) => {
  (el as HTMLElement).click();
  flushSync();
};

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  host.remove();
});

describe("ModelEditor", () => {
  it("lists the part tree of a model", () => {
    open(skinned());
    const text = host.textContent ?? "";
    for (const name of ["body", "arm", "hand"]) expect(text).toContain(name);
  });

  it("shows the bones a skinned shape follows, and a click picks one for the gradient", () => {
    open(skinned());
    // the sleeve is the arm's only shape, listed in the tree as "mesh 1"
    click(host.querySelector("button.node.cube"));
    const key = host.querySelectorAll("ul.bones button.bone");
    expect(key.length).toBe(3);
    click(key[1]);
    expect(host.querySelectorAll("ul.bones button.bone.on")).toHaveLength(1);
    expect(host.textContent).toContain("Blue: not held by this part. Red: held completely.");
    click(host.querySelector("ul.bones button.bone.on"));
    expect(host.querySelectorAll("ul.bones button.bone.on")).toHaveLength(0);
  });

  it("adds, edits and removes collision circles in the model's panel, and saves them in the file", () => {
    open(skinned());
    // nothing is selected, so the model's own panel (scale, collision) is showing
    expect(host.textContent).toContain("Collision");
    const add = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("＋ Circle"));
    expect(add).toBeTruthy();
    click(add);
    click(add);
    const saved = () => JSON.parse(studio.tabs[0]!.text).colliders as { x: number; z: number; r: number }[];
    expect(saved()).toHaveLength(2);
    const radius = host.querySelector('input[aria-label="circle 2 radius"]') as HTMLInputElement;
    radius.value = "3";
    radius.dispatchEvent(new Event("change", { bubbles: true }));
    flushSync();
    expect(saved()[1]!.r).toBe(3);
    click(host.querySelector('button[aria-label="remove circle 1"]'));
    expect(saved()).toEqual([{ x: 0, z: 0, r: 3 }]);
    click(host.querySelector('button[aria-label="remove circle 1"]'));
    expect(JSON.parse(studio.tabs[0]!.text).colliders).toBeUndefined();
  });

  it("adds, edits and removes capsules and boxes, saved under their own keys", () => {
    open(skinned());
    const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text));
    click(button("＋ Capsule"));
    click(button("＋ Box"));
    const saved = () => JSON.parse(studio.tabs[0]!.text);
    expect(saved().capsules).toEqual([{ ax: 0, az: -8, bx: 0, bz: 8, r: 4 }]);
    expect(saved().boxes).toEqual([{ x: 0, z: 0, hw: 4, hl: 8, turn: 0 }]);
    expect(saved().colliders).toBeUndefined();
    const turn = host.querySelector('input[aria-label="box 1 turn°"]') as HTMLInputElement;
    turn.value = "90";
    turn.dispatchEvent(new Event("change", { bubbles: true }));
    flushSync();
    expect(saved().boxes[0].turn).toBe(90);
    click(host.querySelector('button[aria-label="remove capsule 1"]'));
    click(host.querySelector('button[aria-label="remove box 1"]'));
    expect(saved().capsules).toBeUndefined();
    expect(saved().boxes).toBeUndefined();
  });
});
