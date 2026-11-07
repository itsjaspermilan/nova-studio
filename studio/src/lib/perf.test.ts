import { describe, expect, it } from "vitest";
import { PerfTracker, health, parseHitchLine, parsePerfLine } from "./perf";

const LINE = "[2026-11-06T10:00:00Z INFO  nova_runtime::spike] fps=59.9 p95=17.1ms max=21.0ms upd=0.40ms lua=0.31ms render=1.20ms gpu=3.40ms draws=120 sprites=4 tris=88000 culled=12";

describe("speed lines", () => {
  it("reads the line the runtime writes every second", () => {
    expect(parsePerfLine(LINE)).toEqual({ fps: 59.9, p95: 17.1, max: 21, update: 0.4, lua: 0.31, render: 1.2, gpu: 3.4, draws: 120, triangles: 88000, sprites: 4 });
    expect(parsePerfLine("lap 3: 71.2")).toBeNull();
    expect(parsePerfLine("fps=60 only")).toBeNull();
  });
  it("reads a hitch line", () => {
    const h = parseHitchLine("hitch: 31.2 ms (scene race; gpu 4.0 ms, 130 draws, lua 0.50 ms) car 3", 12);
    expect(h).toEqual({ ms: 31.2, detail: "scene race; gpu 4.0 ms, 130 draws, lua 0.50 ms · car 3", at: 12 });
    expect(parseHitchLine("hitch: 80.0 ms (scene a)")?.detail).toBe("scene a");
    expect(parseHitchLine("nothing here")).toBeNull();
  });
  it("keeps the latest, a history and the recent hitches, newest first", () => {
    let t = 1000;
    const tracker = new PerfTracker(() => t);
    expect(tracker.feed("tick 1")).toBe(false);
    t = 3000;
    expect(tracker.feed(LINE)).toBe(true);
    t = 4500;
    expect(tracker.feed("hitch: 44.0 ms (scene a)")).toBe(true);
    expect(tracker.feed("hitch: 30.0 ms (scene b)")).toBe(true);
    expect(tracker.latest?.fps).toBe(59.9);
    expect(tracker.hitches.map((h) => h.ms)).toEqual([30, 44]);
    expect(tracker.hitches[1]!.at).toBe(3.5);
    expect(tracker.worst).toBe(44);
    for (let i = 0; i < 100; i++) tracker.feed(LINE);
    expect(tracker.history).toHaveLength(60);
    for (let i = 0; i < 100; i++) tracker.feed(`hitch: ${i + 1} ms`);
    expect(tracker.hitches).toHaveLength(30);
    expect(tracker.hitches[0]!.ms).toBe(100);
  });
  it("says how healthy a rate is", () => {
    expect(health(null)).toBe("none");
    expect(health({ ...parsePerfLine(LINE)!, fps: 60 })).toBe("good");
    expect(health({ ...parsePerfLine(LINE)!, fps: 40 })).toBe("ok");
    expect(health({ ...parsePerfLine(LINE)!, fps: 12 })).toBe("slow");
  });
});
