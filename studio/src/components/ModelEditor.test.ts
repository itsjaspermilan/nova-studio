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
});
