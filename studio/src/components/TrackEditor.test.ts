// @vitest-environment jsdom
// The track editor mounted for real: the numbers, warnings and pace notes a person reads, and the buttons they press.
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import TrackEditor from "./TrackEditor.svelte";
import { studio } from "../lib/store.svelte";
import { createMockApi } from "../lib/mock";
import { newTrack, parseTrack, serializeTrack } from "../lib/track-doc";

const PATH = "tracks/oval.track.json";
let host: HTMLElement;
let app: ReturnType<typeof mount> | undefined;

async function open(text = serializeTrack(newTrack())) {
  const api = createMockApi();
  await api.newProject("/mock", "T", "starter");
  studio.api = api;
  studio.tabs = [{ path: PATH, text, saved: text, binary: false, size: text.length }];
  studio.active = PATH;
  studio.files = await api.listFiles();
  app = mount(TrackEditor, { target: host, props: { path: PATH, text, onjson: () => {} } });
  flushSync();
  return api;
}
const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  host.remove();
});

describe("TrackEditor", () => {
  it("shows the route's length and bend, with no warning for a good oval", async () => {
    await open();
    expect(host.textContent).toContain("Length");
    expect(host.textContent).toContain("Tightest bend");
    expect(host.textContent).toContain("No problems found");
    expect(host.querySelectorAll("circle.pt")).toHaveLength(8);
  });
  it("switches to a stage: sections and lead-in appear, and the change is saved into the tab", async () => {
    await open();
    expect(host.textContent).not.toContain("Sections");
    button("Stage (start to finish)")!.click();
    flushSync();
    expect(host.textContent).toContain("Sections");
    expect(parseTrack(studio.tabs[0]!.text)).toMatchObject({ ok: true, doc: { open: true } });
    expect(host.textContent).toContain("Pace notes");
  });
  it("warns about a bend that is too tight", async () => {
    await open(serializeTrack({ ...newTrack(), control: [[0, 0], [60, 0], [60, 8], [0, 8]] }));
    expect(host.textContent).toMatch(/very tight/);
  });
  it("Generate writes the scene and the road into the project", async () => {
    const api = await open();
    button("Generate scene and road")!.click();
    await new Promise((r) => setTimeout(r, 50));
    flushSync();
    const paths = (await api.listFiles()).map((f) => f.path);
    expect(paths).toEqual(expect.arrayContaining(["scenes/oval.scene.json", "models/road_oval.glb"]));
    expect(host.textContent).toContain("Open the scene");
  });
  it("picks distant scenery and sets how much of it, the barrier and the sky", async () => {
    const api = await open();
    await api.writeFile("entities/pine.lua", 'return nova.entity { model = "pine", static = true }');
    studio.files = await api.listFiles();
    flushSync();
    button("Far")!.click();
    flushSync();
    const pine = [...host.querySelectorAll<HTMLInputElement>("ul.kinds input")].find((i) => i.parentElement?.textContent?.trim() === "pine")!;
    pine.click();
    flushSync();
    const slider = [...host.querySelectorAll("label")].find((l) => l.textContent?.trim().startsWith("Far"))!.querySelector("input")!;
    slider.value = "0.3";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    const sky = host.querySelector<HTMLInputElement>('input[type="color"]')!;
    sky.value = "#102030";
    sky.dispatchEvent(new Event("change", { bubbles: true }));
    flushSync();
    expect(parseTrack(studio.tabs[0]!.text)).toMatchObject({ ok: true, doc: { far: { kind: ["pine"], density: 0.3 }, sky: [16, 32, 48], rail: "guardrail" } });
    expect(button("Far (1)")).toBeDefined();
  });
  it("switches the roadside on with the rally's kinds, and Generate keeps the old scene's named objects", async () => {
    const api = await open();
    const box = [...host.querySelectorAll("label")].find((l) => l.textContent?.trim() === "Stands, flags and billboards")!.querySelector("input")!;
    box.click();
    flushSync();
    expect(parseTrack(studio.tabs[0]!.text)).toMatchObject({ ok: true, doc: { roadside: { stand: "grandstand", boards: ["billboard", "billboard_low"] } } });
    expect(host.textContent).toContain("Billboard 2");
    await api.writeFile("scenes/oval.scene.json", JSON.stringify({ version: 1, objects: [{ kind: "race", name: "race", x: 0, y: 0, props: { grip: 0.7 } }, { kind: "pine", x: 9, y: 0 }] }));
    button("Generate scene and road")!.click();
    await new Promise((r) => setTimeout(r, 50));
    const scene = JSON.parse((await api.readFile("scenes/oval.scene.json")).text!);
    expect(scene.objects[0]).toEqual({ kind: "race", name: "race", x: 0, y: 0, props: { grip: 0.7 } });
    expect(scene.objects.some((o: { kind: string }) => o.kind === "grandstand")).toBe(true);
    expect(scene.objects.some((o: { kind: string; x: number }) => o.kind === "pine" && o.x === 9)).toBe(false);
  });
  it("says so when the file is not a track", async () => {
    await open("not json");
    expect(host.textContent).toContain("is not a track file");
  });
});
