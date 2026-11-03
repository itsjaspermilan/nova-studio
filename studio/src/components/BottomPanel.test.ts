// @vitest-environment jsdom
// The bottom panel's Activity tab: what an assistant has done through the MCP server, with the files it wrote.
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BottomPanel from "./BottomPanel.svelte";
import { studio } from "../lib/store.svelte";

let host: HTMLElement;
let app: ReturnType<typeof mount> | undefined;

const tab = (name: string) => [...host.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.includes(name)) as HTMLButtonElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  studio.panel = "problems";
  studio.panelOpen = true;
  studio.activity = [
    { t: Date.now() - 4000, tool: "model_write", files: ["models/car.model.json", "models/car.glb"], note: "models/car.model.json and models/car.glb: 3 parts" },
    { t: Date.now() - 90_000, tool: "scene_write", files: [], note: "the scene is not valid: oops", error: true },
  ];
  studio.activitySeen = 0;
  app = mount(BottomPanel, { target: host });
  flushSync();
});
afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  host.remove();
});

describe("Activity tab", () => {
  it("shows a badge for what has not been looked at, and clears it when opened", () => {
    expect(tab("Activity").querySelector(".badge")?.textContent).toBe("2");
    tab("Activity").click();
    flushSync();
    expect(tab("Activity").querySelector(".badge")).toBeNull();
    expect(studio.activitySeen).toBe(studio.activity[0]!.t);
  });

  it("lists each call in words, newest first, with errors marked, and the files as links", () => {
    tab("Activity").click();
    flushSync();
    const rows = [...host.querySelectorAll("li.act")];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("wrote a model");
    expect(rows[0]!.textContent).toContain("just now");
    expect(rows[1]!.textContent).toContain("laid out a scene");
    expect(rows[1]!.textContent).toContain("failed");
    expect(rows[1]!.classList.contains("bad")).toBe(true);
    const open = vi.spyOn(studio, "openFile").mockResolvedValue(undefined);
    (host.querySelector("button.file") as HTMLButtonElement).click();
    expect(open).toHaveBeenCalledWith("models/car.model.json");
    open.mockRestore();
  });

  it("says what it is for when there is nothing yet", () => {
    studio.activity = [];
    tab("Activity").click();
    flushSync();
    expect(host.textContent).toContain("Nova MCP server");
  });
});
