// @vitest-environment jsdom
// The debugger's studio side: requests and replies, breakpoints, a pause, objects and the reload notes, against the
// browser preview's pretend game (mock-debug.ts) and a hand-fed message stream.
import { describe, expect, it, vi } from "vitest";
import { DebugSession, parseField, reloadNote, unquote } from "./debugger.svelte";
import { createMockApi } from "./mock";
import type { Api, DebugMessage, DebugRequest } from "./types";

const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));

/// A session wired to an Api that only records what is sent; `feed` plays the game's side.
function fed() {
  const sent: DebugRequest[] = [];
  let listener: (m: DebugMessage) => void = () => {};
  const api = {
    debugSend: async (m: DebugRequest) => void sent.push(m),
    onDebugMessage: async (cb: (m: DebugMessage) => void) => {
      listener = cb;
      return () => {};
    },
  } as unknown as Api;
  const s = new DebugSession();
  const show = vi.fn();
  return { s, sent, show, api, feed: (m: DebugMessage) => listener(m), attach: () => s.attach(api, show) };
}

describe("reload notes and field values", () => {
  it("reads the runtime's reload lines", () => {
    expect(reloadNote("[2026 INFO nova_runtime::content] reload: kept the game running with the new code of entities/hero.lua")).toMatchObject({ kept: true, failed: false, text: "Kept the game running with the new code of entities/hero.lua" });
    expect(reloadNote("reload: restarted the game (main.lua changed, and it runs once when the game starts)")).toMatchObject({ kept: false, text: "Restarted the game: main.lua changed, and it runs once when the game starts" });
    expect(reloadNote("reload: not applied, the old code keeps running: lib/a.lua: lib/a.lua:3: syntax")).toMatchObject({ failed: true });
    expect(reloadNote("tick 3")).toBeNull();
  });

  it("turns typed text into the field's kind, or refuses", () => {
    expect(parseField("number", " 12.5 ")).toBe(12.5);
    expect(parseField("number", "-3e2")).toBe(-300);
    expect(parseField("number", "fast")).toBeNull();
    expect(parseField("number", "")).toBeNull();
    expect(parseField("boolean", "true")).toBe(true);
    expect(parseField("boolean", "yes")).toBeNull();
    expect(parseField("string", "")).toBe("");
    expect(parseField("table", "{}")).toBeNull();
    expect(unquote('"Ada \\"A\\""')).toBe('Ada "A"');
    expect(unquote("12")).toBe("12");
  });
});

describe("the session", () => {
  it("sends breakpoints and the error setting, then ready, when the game connects", async () => {
    const { s, sent, feed, attach } = fed();
    await attach();
    s.useProject("/tmp/game-a");
    s.toggleBreakpoint("main.lua", 5);
    s.toggleBreakpoint("main.lua", 2);
    s.toggleBreakpoint("lib/a.lua", 9);
    s.toggleBreakpoint("lib/a.lua", 9); // off again
    expect(s.breakpoints).toEqual({ "main.lua": [2, 5] });
    expect(sent).toHaveLength(0); // nothing is sent while no game runs
    feed({ event: "connected" });
    for (let i = 0; i < 3; i++) {
      await settle(0);
      const last = sent[sent.length - 1]!;
      feed({ reply: last.id, ok: true, result: {} });
    }
    await settle(0);
    expect(sent.map((m) => m.cmd)).toEqual(["pause_on_errors", "set_breakpoints", "ready"]);
    expect(sent[1]).toMatchObject({ file: "main.lua", lines: [2, 5] });
    // kept for the project, not for another one
    const again = new DebugSession();
    again.useProject("/tmp/game-a");
    expect(again.breakpoints).toEqual({ "main.lua": [2, 5] });
    again.useProject("/tmp/game-b");
    expect(again.breakpoints).toEqual({});
  });

  it("shows a pause: the first frame of the person's code, its locals, and the file at the line", async () => {
    const { s, sent, feed, show, attach } = fed();
    await attach();
    feed({ event: "connected" });
    s.connected = true;
    feed({
      event: "paused",
      reason: "breakpoint",
      file: "main.lua",
      line: 5,
      message: null,
      stack: [
        { file: null, line: -1, func: "xpcall", depth: 3, internal: true },
        { file: "main.lua", line: 5, func: "update", depth: 2, internal: false },
      ],
    });
    expect(s.paused?.reason).toBe("breakpoint");
    expect(s.frame).toBe(2);
    expect(show).toHaveBeenCalledWith("main.lua", 5);
    await settle(0);
    const scope = sent.find((m) => m.cmd === "scope")!;
    expect(scope).toMatchObject({ depth: 2, which: "locals" });
    feed({ reply: scope.id, ok: true, result: [{ name: "a", value: "5", type: "number" }] });
    await settle(0);
    expect(s.values).toEqual([{ name: "a", value: "5", type: "number" }]);
    feed({ event: "resumed" });
    expect(s.paused).toBeNull();
    expect(s.values).toBeNull();
    feed({ event: "reloaded", kept: false, reason: "a picture changed" });
    expect(s.reload?.text).toBe("Restarted the game: a picture changed");
    feed({ event: "disconnected" });
    expect(s.connected).toBe(false);
  });

  it("refused requests are shown, not thrown", async () => {
    const { s, sent, feed, attach } = fed();
    await attach();
    feed({ event: "connected" });
    s.connected = true;
    const done = s.resume("step_over");
    await settle(0);
    const m = sent.find((x) => x.cmd === "step_over")!;
    feed({ reply: m.id, ok: false, error: "the game is not paused" });
    await done;
    expect(s.problem).toBe("the game is not paused");
  });
});

describe("against the browser preview's pretend game", () => {
  it("stops at a breakpoint, steps, lists objects and changes a field", async () => {
    const api = createMockApi();
    await api.newProject("/mock", "Demo", "starter");
    const s = new DebugSession();
    await s.attach(api, () => {});
    s.useProject("/mock/Demo");
    const main = "-- the game\nlocal speed = 3\nfunction update(dt)\n  local x = speed * dt\n  nova.log(x)\nend\n";
    await api.writeFile("main.lua", main);
    const line = main.split("\n").findIndex((l) => l.trim() && !l.trim().startsWith("--")) + 1;
    s.setBreakpoints("main.lua", [line]);
    await api.runProject();
    await settle(100);
    expect(s.connected).toBe(true);
    // it "reaches" the breakpoint after a moment of running
    for (let i = 0; i < 40 && !s.paused; i++) await settle(50);
    expect(s.paused).toMatchObject({ reason: "breakpoint", file: "main.lua", line });
    await settle(30);
    expect(s.values?.some((v) => v.name === "self")).toBe(true);
    await s.resume("step_over");
    for (let i = 0; i < 20 && !(s.paused && s.paused.reason === "step"); i++) await settle(20);
    expect(s.paused?.reason).toBe("step");
    expect(s.paused!.line!).toBeGreaterThan(line);
    s.setBreakpoints("main.lua", []);
    await s.resume("continue");
    await settle(20);
    expect(s.paused).toBeNull();

    await s.refreshObjects();
    expect(s.objects.scene).toBe("play");
    const hero = s.objects.list.find((o) => o.name === "hero")!;
    await s.select(hero.id);
    const speed = s.fields.find((f) => f.name === "speed")!;
    expect(await s.setField(speed, "300")).toBe(true);
    expect(s.fields.find((f) => f.name === "speed")!.value).toBe("300");
    expect(await s.setField(speed, "fast")).toBe(false);
    expect(s.problem).toContain("not a number");
    const name = s.fields.find((f) => f.name === "name")!;
    expect(await s.setField(name, "Grace")).toBe(true);
    expect(s.fields.find((f) => f.name === "name")!.value).toBe('"Grace"');
    const bag = s.fields.find((f) => f.name === "bag")!;
    await s.toggle(bag.ref!);
    expect(s.open[bag.ref!]!.map((e) => e.name)).toEqual(["gold", "keys"]);

    // saving code while it runs says what the reload did
    const lines: string[] = [];
    await api.onPlayLog((l) => lines.push(l.line));
    await api.writeFile("scenes/title.lua", "-- changed\n");
    expect(s.noteLog(lines[lines.length - 1]!)?.kept).toBe(true);
    await api.writeFile("main.lua", main + "\n");
    expect(s.noteLog(lines[lines.length - 1]!)?.kept).toBe(false);
    await api.stopProject();
    await settle(10);
    expect(s.connected).toBe(false);
  });
});
