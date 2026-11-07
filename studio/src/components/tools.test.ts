// @vitest-environment jsdom
// The three tools that came out of Pine Ridge Rally, mounted against the in-memory backend: the speed strip while the game
// runs, store art, and the simulation table.
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PerfStrip from "./PerfStrip.svelte";
import Simulate from "./Simulate.svelte";
import StoreArt from "./StoreArt.svelte";
import { studio } from "../lib/store.svelte";

let host: HTMLElement;
let app: ReturnType<typeof mount> | undefined;

const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;
const type = (el: Element | null, value: string) => {
  const input = el as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  flushSync();
};

beforeEach(async () => {
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  await studio.init();
  await studio.newProject("/mock", "Tools Test", "starter");
});
afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  host.remove();
  vi.useRealTimers();
});

describe("speed strip", () => {
  it("fills from the game's log lines, keeps the hitches and leaves the per-second line out of the log", async () => {
    vi.useFakeTimers();
    await studio.play();
    app = mount(PerfStrip, { target: host });
    expect(host.textContent).toContain("Waiting for the first numbers");
    await vi.advanceTimersByTimeAsync(7000);
    flushSync();
    expect(studio.perf.latest?.fps).toBeGreaterThan(50);
    expect(studio.perf.hitches).toHaveLength(1);
    expect(host.textContent).toContain("fps");
    expect(host.textContent).toContain("GPU");
    expect(host.textContent).toContain("1 hitch");
    expect(host.textContent).toContain("scene title");
    expect(studio.log.some((l) => l.line.includes("fps="))).toBe(false);
    expect(studio.log.some((l) => l.line.startsWith("hitch:"))).toBe(true);
    await studio.stop();
  });
});

describe("store art", () => {
  it("renders the icon from the keys it is given and writes icon.png", async () => {
    app = mount(StoreArt, { target: host });
    flushSync();
    expect(host.textContent).toContain("No icon.png yet");
    click(button("Press a key"));
    type(host.querySelector('input[aria-label="key 1"]'), "Space");
    const run = vi.spyOn(studio.api!, "runHeadless");
    click(host.querySelectorAll("button.primary")[0]!);
    await vi.waitFor(() => expect(host.querySelector('img[alt="App icon of Tools Test"]')).toBeTruthy());
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ size: [512, 512], press: ["key:Space@60"], capture: true }));
    // saving
    click(button("Save as icon.png"));
    await vi.waitFor(() => expect(studio.files.some((f) => f.path === "icon.png")).toBe(true));
    expect(host.textContent).toContain("Saved");
    // the launcher sizes are shown
    expect(host.querySelectorAll("img.round")).toHaveLength(4);
    // and the box art is its own size, with a cover tile
    click(host.querySelectorAll("button.primary")[1]!);
    await vi.waitFor(() => expect(host.querySelector(".cover")).toBeTruthy());
    expect(run).toHaveBeenLastCalledWith(expect.objectContaining({ size: [768, 1024] }));
  });
});

function click(el: Element | undefined | null) {
  (el as HTMLElement).click();
  flushSync();
}

describe("simulation", () => {
  it("runs a script for each option value and shows the matching lines as a table", async () => {
    await studio.api!.writeFile("sims/play.json", '[{ "at": 0, "for": 300, "hold": { "key:{{key}}": 1 } }]');
    await studio.refreshFiles();
    app = mount(Simulate, { target: host });
    flushSync();
    await vi.waitFor(() => expect(host.textContent).toContain("found"));
    // the script's placeholder is offered as an option
    await vi.waitFor(() => expect(button("＋ key")).toBeTruthy());
    click(button("＋ key"));
    type(host.querySelector('input[aria-label="option 1 values"]'), "KeyW, KeyS, ArrowUp");
    type(host.querySelector('input[aria-label="pattern"]'), "lap (\\d+): ([0-9.]+)");
    type(host.querySelector('input[aria-label="column names"]'), "lap, time");
    expect(button("Run 3 times")).toBeTruthy();
    click(button("Run 3 times"));
    await vi.waitFor(() => expect(host.querySelector('table[aria-label="Results"]')).toBeTruthy());
    const heads = [...host.querySelectorAll("th")].map((th) => th.textContent);
    expect(heads).toEqual(["key", "lap", "time"]);
    const rows = [...host.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent));
    expect(rows).toHaveLength(9); // 3 values x 3 laps
    expect(rows.map((r) => r[0])).toEqual(["KeyW", "KeyW", "KeyW", "KeyS", "KeyS", "KeyS", "ArrowUp", "ArrowUp", "ArrowUp"]);
    expect(host.textContent).toContain("Done: 3 runs, 9 matching lines");
    // the table can be kept
    click(button("Save as sims/results.csv"));
    await vi.waitFor(() => expect(studio.files.some((f) => f.path === "sims/results.csv")).toBe(true));
    const csv = await studio.api!.readFile("sims/results.csv");
    expect(csv.text).toMatch(/^key,lap,time\nKeyW,1,/);
  });

  it("says so when the pattern is empty or the script is missing", async () => {
    app = mount(Simulate, { target: host });
    flushSync();
    click(button("▶ Run"));
    expect(host.textContent).toContain("Say which lines to keep");
    type(host.querySelector('input[aria-label="pattern"]'), "x");
    click(button("▶ Run"));
    expect(host.textContent).toContain("There is no script called sims/play.json yet");
  });
});
