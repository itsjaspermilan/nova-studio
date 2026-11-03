// @vitest-environment jsdom
// The scene editor's flat view and palette, mounted for real: what a person sees and clicks, not just the model behind it.
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SceneEditor from "./SceneEditor.svelte";
import { studio } from "../lib/store.svelte";

vi.mock("three", async (original) => ({ ...(await original<typeof import("three")>()), WebGLRenderer: (await import("../test/gl")).FakeRenderer }));

const PATH = "scenes/level.scene.json";
const scene = { version: 1, objects: [{ kind: "player", x: 8, y: 16 }] };

let host: HTMLElement;
let app: ReturnType<typeof mount> | undefined;

function open(doc: object = scene) {
  const text = JSON.stringify(doc, null, 2);
  studio.tabs = [{ path: PATH, text, saved: text, binary: false, size: text.length }];
  studio.active = PATH;
  app = mount(SceneEditor, { target: host, props: { path: PATH, text, onjson: () => {} } });
  flushSync();
}
const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
const saved = () => JSON.parse(studio.tabs[0]!.text) as { objects: { kind: string }[]; texts?: { text: string }[] };

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  host.remove();
});

describe("SceneEditor", () => {
  it("opens a flat level with its Add palette and the 2D/3D switch", () => {
    open();
    expect(host.textContent).toContain("Add");
    expect(button("＋ Text")).toBeTruthy();
    expect(button("2D")?.classList.contains("on") ?? true).toBe(true);
    expect(button("3D")).toBeTruthy();
  });

  it("adds a text with the button and writes it into the file, leaving the objects alone", () => {
    open();
    button("＋ Text")!.click();
    flushSync();
    expect(saved().texts?.map((t) => t.text)).toEqual(["Text"]);
    expect(saved().objects.map((o) => o.kind)).toEqual(["player"]);
  });

  it("shows the placing tools (and the snap-to-road checkbox) only in the 3D view", () => {
    open();
    expect(host.textContent).not.toContain("Snap to the road edge");
    button("3D")!.click();
    flushSync();
    expect(host.textContent).toContain("Snap to the road edge");
    expect(host.textContent).toContain("Keep off the road");
  });

  it("asks for the distance only once snapping is ticked", () => {
    open({ version: 1, objects: [{ kind: "road_asphalt", x: 0, y: 0, z: 0 }] });
    button("3D")!.click();
    flushSync();
    expect(host.textContent).not.toContain("Distance from the middle");
    const snap = [...host.querySelectorAll("label.check")].find((l) => l.textContent?.includes("Snap to the road edge"))?.querySelector("input") as HTMLInputElement | undefined;
    expect(snap).toBeTruthy();
    snap!.click();
    flushSync();
    expect(host.textContent).toContain("Distance from the middle");
    expect((host.querySelector(".brush input[type=checkbox][disabled]") as HTMLInputElement | null)?.parentElement?.textContent).toContain("Keep off the road");
  });
});
