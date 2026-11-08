// @vitest-environment jsdom
// The Debugger and Objects tabs, and the code editor's breakpoint gutter, fed by a hand-played game.
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import DebugPanel from "./DebugPanel.svelte";
import ObjectsPanel from "./ObjectsPanel.svelte";
import { debug } from "../lib/debugger.svelte";
import { breakpointGutter, breakpointLines, setBreakpoints } from "../lib/breakpoints";
import type { Api, DebugMessage, DebugRequest } from "../lib/types";

let host: HTMLElement;
let app: ReturnType<typeof mount> | undefined;
let sent: DebugRequest[] = [];
let feed: (m: DebugMessage) => void = () => {};
const settle = () => new Promise((r) => setTimeout(r, 0));

/// Answers every request the way a game would (a few fixed answers), so the panels can be driven.
const answers: Record<string, unknown> = {
  scope: [
    { name: "a", value: "5", type: "number" },
    { name: "hero", value: "hero entity #1", type: "table", ref: 7 },
  ],
  children: [{ name: "speed", value: "120", type: "number" }],
  entities: { scene: "play", count: 2, entities: [
    { id: 0, name: "play", kind: "scene", x: null, y: null, tags: [] },
    { id: 1, name: "hero", kind: "entity", x: 100, y: 50, tags: ["player"] },
    { id: 2, name: "coin", kind: "entity", x: 10, y: 10, tags: ["coin"] },
  ] },
  entity: [
    { name: "alive", value: "true", type: "boolean" },
    { name: "name", value: '"Ada"', type: "string" },
    { name: "speed", value: "120", type: "number" },
  ],
};

beforeEach(async () => {
  sent = [];
  const api = {
    debugSend: async (m: DebugRequest) => {
      sent.push(m);
      queueMicrotask(() => {
        const result = m.cmd === "set" ? { name: m.key, value: typeof m.value === "string" ? JSON.stringify(m.value) : String(m.value), type: typeof m.value } : (answers[m.cmd] ?? {});
        feed({ reply: m.id, ok: true, result });
      });
    },
    onDebugMessage: async (cb: (m: DebugMessage) => void) => {
      feed = cb;
      return () => {};
    },
  } as unknown as Api;
  await debug.attach(api, () => {});
  debug.useProject("/tmp/panels");
  feed({ event: "connected" });
  await settle();
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  host.remove();
  feed({ event: "disconnected" });
});

const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(text)) as HTMLButtonElement | undefined;

describe("Debugger tab", () => {
  it("offers Pause while running, then the stack, variables and steps while paused", async () => {
    app = mount(DebugPanel, { target: host });
    flushSync();
    expect(host.textContent).toContain("Running.");
    button("Pause")!.click();
    await settle();
    expect(sent.some((m) => m.cmd === "pause")).toBe(true);

    feed({ event: "paused", reason: "breakpoint", file: "main.lua", line: 5, message: null, stack: [
      { file: "main.lua", line: 5, func: "update", depth: 2, internal: false },
      { file: null, line: -1, func: "step", depth: 1, internal: true },
    ] });
    await settle();
    await settle();
    flushSync();
    expect(host.textContent).toContain("Paused at a breakpoint in main.lua line 5");
    expect([...host.querySelectorAll(".frame")].map((f) => f.textContent?.replace(/\s+/g, " ").trim())).toEqual(["update main.lua:5", "step Nova"]);
    expect(host.querySelector(".values")?.textContent?.replace(/\s+/g, " ")).toContain("a 5");
    // a table opens in place
    (host.querySelector('[aria-label="Open hero"]') as HTMLButtonElement).click();
    await settle();
    await settle();
    flushSync();
    expect(host.querySelector(".values")?.textContent?.replace(/\s+/g, " ")).toContain("speed 120");
    // the other scopes
    ([...host.querySelectorAll('[role="tab"]')].find((t) => t.textContent === "Upvalues") as HTMLButtonElement).click();
    await settle();
    expect(sent.filter((m) => m.cmd === "scope").at(-1)).toMatchObject({ which: "upvalues", depth: 2 });
    button("Step over")!.click();
    await settle();
    expect(sent.at(-1)?.cmd).toBe("step_over");
    // keys: F11 steps in
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "F11" }));
    await settle();
    expect(sent.at(-1)?.cmd).toBe("step_into");
  });

  it("at an error, says so and only offers to carry on", async () => {
    app = mount(DebugPanel, { target: host });
    feed({ event: "paused", reason: "error", file: "main.lua", line: 3, message: "main.lua:3: attempt to index a nil value", stack: [{ file: "main.lua", line: 3, func: "update", depth: 1, internal: false }] });
    await settle();
    flushSync();
    expect(host.querySelector(".status")?.classList.contains("err")).toBe(true);
    expect(host.textContent).toContain("attempt to index a nil value");
    expect(button("Step over")).toBeUndefined();
    expect(button("Carry on")).toBeDefined();
    feed({ event: "resumed" });
  });
});

describe("Objects tab", () => {
  it("lists the scene's objects, filters them, and edits a field of the one picked", async () => {
    app = mount(ObjectsPanel, { target: host });
    await settle();
    await settle();
    flushSync();
    const rows = () => [...host.querySelectorAll(".obj")].map((r) => r.textContent?.replace(/\s+/g, " ").trim());
    expect(rows()).toHaveLength(3);
    expect(rows()[1]).toContain("hero #1");
    const filter = host.querySelector(".filter") as HTMLInputElement;
    filter.value = "coin";
    filter.dispatchEvent(new Event("input"));
    flushSync();
    expect(rows()).toHaveLength(1);
    filter.value = "player"; // tags count too
    filter.dispatchEvent(new Event("input"));
    flushSync();
    (host.querySelector(".obj") as HTMLButtonElement).click();
    await settle();
    await settle();
    flushSync();
    expect(sent.find((m) => m.cmd === "highlight")).toMatchObject({ target: 1 });
    const speed = host.querySelector('input[aria-label="speed"]') as HTMLInputElement;
    expect(speed.value).toBe("120");
    speed.value = "250";
    speed.dispatchEvent(new Event("blur"));
    await settle();
    expect(sent.find((m) => m.cmd === "set")).toMatchObject({ target: 1, key: "speed", value: 250 });
    const name = host.querySelector('input[aria-label="name"]') as HTMLInputElement;
    expect(name.value).toBe("Ada");
    const alive = host.querySelector('input[type="checkbox"][aria-label="alive"]') as HTMLInputElement;
    alive.click();
    await settle();
    expect(sent.filter((m) => m.cmd === "set").at(-1)).toMatchObject({ key: "alive", value: false });
  });
});

describe("breakpoint gutter", () => {
  it("toggles on a click, moves with the lines when text is added above, and reports the lines", () => {
    const seen: number[][] = [];
    const state = EditorState.create({ doc: "a\nb\nc\nd\n", extensions: breakpointGutter([2], (l) => seen.push(l)) });
    const view = new EditorView({ state, parent: host });
    expect(breakpointLines(view.state)).toEqual([2]);
    expect(host.querySelectorAll(".cm-breakpoint").length).toBeGreaterThanOrEqual(1);
    view.dispatch({ changes: { from: 0, insert: "new line\n" } });
    expect(breakpointLines(view.state)).toEqual([3]);
    expect(seen.at(-1)).toEqual([3]);
    view.dispatch({ effects: setBreakpoints.of([1, 4]) });
    expect(breakpointLines(view.state)).toEqual([1, 4]);
    // (a click in the gutter is checked in the browser preview: jsdom does not lay out CodeMirror's gutter)
    view.destroy();
  });

  it("the debugger keeps a file's breakpoints sorted and once each", () => {
    debug.setBreakpoints("main.lua", [9, 3, 3, 0, -1]);
    expect(debug.linesOf("main.lua")).toEqual([3, 9]);
    debug.toggleBreakpoint("main.lua", 3);
    expect(debug.linesOf("main.lua")).toEqual([9]);
    debug.clearBreakpoints();
    expect(debug.breakpoints).toEqual({});
  });
});
