// @vitest-environment jsdom
// The typed settings in the scene editor's inspector, mounted for real: each type gets its own control, and what is
// picked comes back as the prop to write.
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import EntitySettings from "./EntitySettings.svelte";
import type { Setting } from "../lib/entity-settings";

const SETTINGS: Setting[] = [
  { name: "speed", type: "number", default: 4, min: 0, max: 10, step: 0.5, help: "How fast" },
  { name: "lives", type: "number", default: 3 },
  { name: "lights", type: "boolean", default: true },
  { name: "mood", type: "choice", default: "calm", choices: ["calm", "angry"] },
  { name: "paint", type: "colour", default: "#ff8800" },
  { name: "offset", type: "vector", default: [0, 1], size: 2 },
  { name: "follow", type: "object" },
  { name: "honk", type: "sound", default: "beep" },
];

let app: ReturnType<typeof mount> | undefined;
let host: HTMLElement;
afterEach(() => {
  if (app) unmount(app);
  host?.remove();
});

function show(props: Record<string, unknown>) {
  const set: [string, unknown][] = [];
  host = document.createElement("div");
  document.body.append(host);
  app = mount(EntitySettings, { target: host, props: { settings: SETTINGS, props, files: ["sounds/beep.wav", "sounds/boom.ogg"], objectNames: ["hero", "door"], onset: (k: string, v: unknown) => set.push([k, v]) } });
  flushSync();
  return set;
}
const input = (label: string) => host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
const change = (el: HTMLInputElement | HTMLSelectElement, value: string) => {
  el.value = value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
  flushSync();
};

describe("EntitySettings", () => {
  it("gives each type its control, showing the default until a scene sets one", () => {
    show({ mood: "angry" });
    expect(input("speed slider").type).toBe("range");
    expect(input("speed").step).toBe("0.5");
    expect(input("speed").value).toBe("4");
    expect(input("lives slider")).toBeNull(); // no limits, no slider
    expect(input("lights").checked).toBe(true);
    expect((input("mood") as unknown as HTMLSelectElement).value).toBe("angry");
    expect(input("paint").type).toBe("color");
    expect(input("paint").value).toBe("#ff8800");
    expect(input("offset y").value).toBe("1");
    const follow = [...host.querySelectorAll<HTMLOptionElement>('[aria-label="follow"] option')].map((o) => o.textContent);
    expect(follow).toEqual(["(none)", "door", "hero"]);
    const honk = [...host.querySelectorAll<HTMLOptionElement>('[aria-label="honk"] option')].map((o) => o.textContent);
    expect(honk).toEqual(["(none)", "beep", "boom"]);
    expect(host.querySelector('[title="How fast"]')).not.toBeNull();
    // only the one set in the scene is marked, and has a reset
    expect(host.querySelectorAll(".setting.set").length).toBe(1);
    expect(host.querySelector('[aria-label="Reset mood to its default"]')).not.toBeNull();
  });

  it("hands back what is picked, kept within the limits, and undefined to reset", () => {
    const set = show({ mood: "angry", speed: 6 });
    change(input("speed"), "99");
    change(input("offset x"), "2.5");
    change(input("paint"), "#00aa00");
    change(input("mood") as unknown as HTMLSelectElement, "calm");
    input("lights").click();
    flushSync();
    host.querySelector<HTMLButtonElement>('[aria-label="Reset speed to its default"]')!.click();
    expect(set).toEqual([["speed", 10], ["offset", [2.5, 1]], ["mood", "calm"], ["lights", false], ["speed", undefined]]);
  });

  it("says when a scene's value is of the wrong kind", () => {
    show({ speed: "fast" });
    expect(host.textContent).toContain("This value must be a number: the game will stop with an error.");
  });
});
