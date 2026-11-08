import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EASES, addKey, addTrack, bezier, crossed, eased, keyFor, moveKey, newAnim, parseAnim, parseValue, problems, removeKey, sample, serializeAnim, setKey, setLength,
  snapTime, trackLabel, type AnimDoc, type Track,
} from "./anim-doc";

const doc = (tracks: Track[], length = 1): AnimDoc => ({ version: 1, length, tracks });

describe("anim-doc", () => {
  it("knows the same easings as the runtime", () => {
    const rust = readFileSync(new URL("../../../crates/nova-runtime/src/anim.rs", import.meta.url), "utf8");
    const list = rust.slice(rust.indexOf("pub const EASES"), rust.indexOf("];", rust.indexOf("pub const EASES")));
    const names = [...list.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(EASES.map((e) => e.id)).toEqual(names);
  });

  it("samples like the game: holds before and after, eases, steps and lists", () => {
    const t: Track = { field: "x", keys: [{ time: 0.5, value: 10, ease: "in_quad" }, { time: 1.5, value: 30 }] };
    expect(sample(t, 0)).toBe(10);
    expect(sample(t, 1)).toBeCloseTo(15);
    expect(sample(t, 2)).toBe(30);
    expect(sample({ field: "y", keys: [{ time: 0, value: 5, ease: "step" }, { time: 0.5, value: 9 }] }, 0.4999999999)).toBe(9);
    expect(sample({ field: "y", keys: [{ time: 0, value: 5, ease: "step" }, { time: 0.5, value: 9 }] }, 0.3)).toBe(5);
    expect(sample({ field: "tint", keys: [{ time: 0, value: [0, 100, 200] }, { time: 1, value: [100, 100, 0] }] }, 0.25)).toEqual([25, 100, 150]);
    expect(sample({ field: "x", keys: [] }, 0)).toBeNull();
  });

  it("matches the runtime's numbers for curves (tests/anim.rs)", () => {
    // CSS "ease" at half time: the runtime test reads -300 + 300 * this as -59.28
    expect(-300 + 300 * bezier([0.25, 0.1, 0.25, 1], 0.5)).toBeCloseTo(-59.28, 2);
    expect(eased("out_back", 1)).toBeCloseTo(1);
    expect(eased("out_elastic", 0)).toBe(0);
    expect(eased("in_out_back", 0.5)).toBeCloseTo(0.5);
    for (const e of EASES) if (e.id !== "step") expect(eased(e.id, 1)).toBeCloseTo(1, 5);
  });

  it("finds the event and sound keys a stretch of playback passes", () => {
    const d = doc([
      { field: "x", keys: [{ time: 0.2, value: 1 }] },
      { type: "event", keys: [{ time: 0, call: "a" }, { time: 0.5, call: "b" }] },
      { type: "sound", keys: [{ time: 0.25, sound: "s" }] },
    ]);
    expect(crossed(d, 0, 0, true)).toEqual([{ track: 1, key: 0 }]);
    expect(crossed(d, 0, 0.5)).toEqual([{ track: 2, key: 0 }, { track: 1, key: 1 }]);
    expect(crossed(d, 0.5, 1)).toEqual([]);
  });

  it("writes one key per line and reads its own output back", () => {
    const d = doc([
      { target: "door", field: "y", relative: true, keys: [{ time: 0, value: 0, ease: [0.4, 0, 0.2, 1] }, { time: 1, value: -40 }] },
      { type: "event", keys: [{ time: 1, call: "opened", args: ["a,b", 2] }] },
    ]);
    const text = serializeAnim(d);
    expect(text).toContain('        { "time": 0, "value": 0, "ease": [0.4, 0, 0.2, 1] },\n');
    expect(text).toContain('{ "time": 1, "call": "opened", "args": ["a,b",2] }');
    const back = parseAnim(text);
    expect(back.ok && back.doc).toEqual({ ...d, loop: false });
    expect(serializeAnim(newAnim())).toBe(serializeAnim((parseAnim(serializeAnim(newAnim())) as { doc: AnimDoc }).doc));
  });

  it("explains files it cannot edit", () => {
    expect(parseAnim("{")).toMatchObject({ ok: false });
    expect(parseAnim('{"version":2}')).toMatchObject({ ok: false, error: '"version" must be 1' });
    expect(parseAnim('{"version":1,"tracks":[{"keys":[{"value":1}]}]}')).toMatchObject({ ok: false });
    const filled = parseAnim('{"version":1,"tracks":[{"field":"x","keys":[{"time":2,"value":1}]}]}');
    expect(filled.ok && filled.doc.length).toBe(2);
  });

  it("adds, moves, edits and removes keys in time order", () => {
    let d = doc([{ field: "x", keys: [{ time: 0, value: 0 }, { time: 1, value: 10 }] }]);
    const k = keyFor(d.tracks[0]!, 0.5);
    expect(k).toEqual({ time: 0.5, value: 5 });
    let r = addKey(d, 0, k);
    expect(r.index).toBe(1);
    d = r.doc;
    r = moveKey(d, 0, 1, 1.2);
    expect(r.index).toBe(2);
    expect(r.doc.tracks[0]!.keys.map((x) => x.time)).toEqual([0, 1, 1.2]);
    d = setKey(r.doc, 0, 2, { value: 99, ease: "out_quad" });
    expect(d.tracks[0]!.keys[2]).toEqual({ time: 1.2, value: 99, ease: "out_quad" });
    d = setKey(d, 0, 2, { ease: undefined });
    expect(d.tracks[0]!.keys[2]).toEqual({ time: 1.2, value: 99 });
    d = removeKey(d, 0, 0);
    expect(d.tracks[0]!.keys.length).toBe(2);
    expect(keyFor({ field: "tint", keys: [] }, 0)).toEqual({ time: 0, value: [255, 255, 255] });
    expect(keyFor({ type: "sound", keys: [] }, 0, ["door"])).toEqual({ time: 0, sound: "door" });
  });

  it("keeps the length past the last key and snaps times", () => {
    const d = doc([{ field: "x", keys: [{ time: 2, value: 0 }] }], 3);
    expect(setLength(d, 1).length).toBe(2);
    expect(setLength(d, 4).length).toBe(4);
    expect(snapTime(0.537, 1, 0.1)).toBe(0.5);
    expect(snapTime(1.7, 1)).toBe(1);
    expect(snapTime(0.12345, 1)).toBe(0.123);
  });

  it("reads typed values and labels tracks", () => {
    expect(parseValue("12.5")).toBe(12.5);
    expect(parseValue("255, 180, 60")).toEqual([255, 180, 60]);
    expect(parseValue("4,")).toEqual([4]);
    expect(parseValue("red")).toBeNull();
    expect(trackLabel({ field: "y", keys: [] })).toBe("self.y");
    expect(trackLabel({ type: "sound", keys: [] })).toBe("Sounds");
    expect(trackLabel({ type: "event", target: "scene", keys: [] })).toBe("scene · calls");
  });

  it("names what the runtime would refuse", () => {
    const d = doc([
      { field: "2x", keys: [{ time: 0, value: 1 }, { time: 0.5, value: [1, 2] }] },
      { type: "event", keys: [{ time: 3, call: "a.b" }] },
    ]);
    const p = problems(d);
    expect(p.length).toBe(4);
    expect(problems(newAnim())).toEqual([]);
    expect(addTrack(d, { field: "y", keys: [] }).index).toBe(2);
  });
});
