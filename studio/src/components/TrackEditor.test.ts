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
  it("says so when the file is not a track", async () => {
    await open("not json");
    expect(host.textContent).toContain("is not a track file");
  });
});
