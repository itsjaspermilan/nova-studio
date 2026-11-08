// @vitest-environment jsdom
// The Play button's device menu: lists what adb sees, explains devices that are not ready, plays on the one picked.
import { flushSync, mount, tick, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PlayButton from "./PlayButton.svelte";
import { studio } from "../lib/store.svelte";
import { createMockApi } from "../lib/mock";

let host: HTMLElement;
let app: ReturnType<typeof mount> | undefined;
const settle = async () => {
  for (let i = 0; i < 5; i++) await tick();
  flushSync();
};

beforeEach(async () => {
  vi.stubGlobal("confirm", () => true);
  studio.api = createMockApi({
    devices: [
      { serial: "bc8565a3", state: "device", name: "Retroid Pocket 6", emulator: false },
      { serial: "R58N", state: "unauthorized", name: "R58N", emulator: false },
    ],
  });
  await studio.newProject("/mock", "T", "starter");
  host = document.createElement("div");
  document.body.append(host);
  app = mount(PlayButton, { target: host });
  flushSync();
});
afterEach(async () => {
  await studio.stop();
  if (app) unmount(app);
  app = undefined;
  host.remove();
});

describe("Play on a device", () => {
  it("lists the devices, with what to do about one that is not ready", async () => {
    (host.querySelector('[aria-label="Play on a device"]') as HTMLButtonElement).click();
    await settle();
    const items = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    expect(items.map((b) => b.querySelector(".name")?.textContent)).toEqual(["▶ Retroid Pocket 6", "▶ R58N"]);
    expect(items[0]!.disabled).toBe(false);
    expect(items[1]!.disabled).toBe(true);
    expect(items[1]!.textContent).toMatch(/Allow USB debugging/);
  });

  it("plays on the one picked, then shows where it runs and a Stop button", async () => {
    (host.querySelector('[aria-label="Play on a device"]') as HTMLButtonElement).click();
    await settle();
    host.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click();
    await settle();
    expect(studio.playingOn?.serial).toBe("bc8565a3");
    expect(host.textContent).toContain("on Retroid Pocket 6");
    const stop = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Stop"))!;
    stop.click();
    await settle();
    expect(studio.running).toBe(false);
    expect(host.textContent).toContain("Play");
  });

  it("shows the step while the game is being put on the device", async () => {
    studio.running = true;
    studio.playingOn = { serial: "bc8565a3", state: "device", name: "Retroid Pocket 6", emulator: false };
    studio.deviceStep = "Installing on Retroid Pocket 6";
    flushSync();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Installing on Retroid Pocket 6…");
  });
});
