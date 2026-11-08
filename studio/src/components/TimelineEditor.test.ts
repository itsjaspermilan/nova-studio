// @vitest-environment jsdom
// The timeline editor mounted for real: the tracks and keys a person sees, the buttons and keys they press, and the file it writes.
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import TimelineEditor from "./TimelineEditor.svelte";
import { studio } from "../lib/store.svelte";
import { createMockApi } from "../lib/mock";
import { parseAnim, serializeAnim, type AnimDoc } from "../lib/anim-doc";

const PATH = "animations/door.anim.json";
const DOC: AnimDoc = {
  version: 1,
  length: 1,
  tracks: [
    { target: "hero", field: "x", relative: true, keys: [{ time: 0, value: 0, ease: "out_quad" }, { time: 1, value: 50 }] },
    { type: "event", target: "scene", keys: [{ time: 0.5, call: "opened" }] },
  ],
};
let host: HTMLElement;
let app: ReturnType<typeof mount> | undefined;

async function open(text = serializeAnim(DOC)) {
  const api = createMockApi();
  await api.newProject("/mock", "T", "starter");
  studio.api = api;
  studio.tabs = [{ path: PATH, text, saved: text, binary: false, size: text.length }];
  studio.active = PATH;
  studio.files = await api.listFiles();
  app = mount(TimelineEditor, { target: host, props: { path: PATH, text, onjson: () => {} } });
  flushSync();
  await new Promise((r) => setTimeout(r, 0)); // (the preview scene is read)
  flushSync();
  return api;
}
const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
const saved = () => {
  const r = parseAnim(studio.tabs[0]!.text);
  if (!r.ok) throw new Error(r.error);
  return r.doc;
};
const press = (key: string, extra: KeyboardEventInit = {}) => {
  host.querySelector(".anim")!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...extra }));
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

describe("TimelineEditor", () => {
  it("lists the tracks and their keys, and previews in the scene that has the target", async () => {
    await open();
    expect([...host.querySelectorAll(".trow")].map((b) => b.textContent?.trim())).toEqual(["◆hero.x", "ƒscene · calls"]);
    expect(host.querySelectorAll(".key").length).toBe(3);
    expect(host.querySelectorAll(".key.event").length).toBe(1);
    // the mock project's title scene has an object named hero: it is drawn, and marked as animated
    expect(host.querySelector(".tag.animated")?.textContent).toBe("hero");
    expect(host.textContent).toContain('self:play_anim("door")');
  });

  it("adds tracks and keys, deletes a key, and undoes and redoes", async () => {
    await open();
    button("＋ Sound")!.click();
    flushSync();
    expect(saved().tracks.length).toBe(3);
    expect(saved().tracks[2]).toEqual({ type: "sound", keys: [] });
    button("◆ Key here")!.click(); // at the playhead (0 s) on the new track
    flushSync();
    expect(saved().tracks[2]!.keys).toEqual([{ time: 0, sound: "sound" }]);
    press("Delete");
    expect(saved().tracks[2]!.keys).toEqual([]);
    press("z", { metaKey: true });
    expect(saved().tracks[2]!.keys.length).toBe(1);
    press("z", { metaKey: true, shiftKey: true });
    expect(saved().tracks[2]!.keys.length).toBe(0);
  });

  it("edits the selected key's value and ease in the inspector", async () => {
    await open();
    (host.querySelectorAll(".key")[0] as HTMLElement).dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true }));
    flushSync();
    const value = host.querySelector('input[aria-label="Key value"]') as HTMLInputElement;
    value.value = "12.5";
    value.dispatchEvent(new Event("change", { bubbles: true }));
    flushSync();
    const ease = host.querySelector('select[aria-label="Ease to the next key"]') as HTMLSelectElement;
    ease.value = "step";
    ease.dispatchEvent(new Event("change", { bubbles: true }));
    flushSync();
    expect(saved().tracks[0]!.keys[0]).toEqual({ time: 0, value: 12.5, ease: "step" });
    value.value = "not a number";
    value.dispatchEvent(new Event("change", { bubbles: true }));
    flushSync();
    expect(host.textContent).toContain("Type a number");
    expect(saved().tracks[0]!.keys[0]).toEqual({ time: 0, value: 12.5, ease: "step" });
  });

  it("changes the length and the loop, keeping every key inside", async () => {
    await open();
    const length = host.querySelector('input[aria-label="Length in seconds"]') as HTMLInputElement;
    length.value = "0.2";
    length.dispatchEvent(new Event("change", { bubbles: true }));
    flushSync();
    expect(saved().length).toBe(1); // (a key is at 1 s)
    length.value = "2.5";
    length.dispatchEvent(new Event("change", { bubbles: true }));
    flushSync();
    expect(saved().length).toBe(2.5);
    const loop = [...host.querySelectorAll('input[type="checkbox"]')].find((c) => c.parentElement?.textContent?.includes("Loop")) as HTMLInputElement;
    loop.click();
    flushSync();
    expect(saved().loop).toBe(true);
  });

  it("explains a file it cannot read", async () => {
    await open('{"version": 3}');
    expect(host.textContent).toContain("is not an animation the timeline can edit");
    expect(button("Open as text")).toBeTruthy();
  });
});
