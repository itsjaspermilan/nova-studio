import { describe, expect, it } from "vitest";
import { actionsOf, addSource, checkSettings, describeSource, isValidSource, parseManifest, removeAction, removeSource, renameAction, setAction, setGraphics, setKey, sourceFromKeyCode, usedBy } from "./project-settings";

const BASE = JSON.stringify({ format: 1, name: "Game", extra: { keep: true }, input: { jump: ["key:Space"], move_x: { negative: ["key:KeyA"], positive: ["key:KeyD"] } } }, null, 2);
const obj = (t: string) => {
  const p = parseManifest(t);
  if (!p.ok) throw new Error(p.error);
  return p.obj;
};

describe("editing the manifest as text", () => {
  it("changes one key and keeps the rest, in order", () => {
    const t = setKey(BASE, "world_height", 720);
    expect(Object.keys(obj(t))).toEqual(["format", "name", "extra", "input", "world_height"]);
    expect(obj(t).extra).toEqual({ keep: true });
    expect(obj(setKey(t, "world_height", undefined)).world_height).toBeUndefined();
  });
  it("leaves broken JSON as it was and says why", () => {
    expect(setKey("{ nope", "name", "x")).toBe("{ nope");
    expect(parseManifest("[1]").ok).toBe(false);
    expect(parseManifest("{ nope").ok).toBe(false);
  });
  it("sets graphics options and drops the section when it empties", () => {
    const a = setGraphics(BASE, "msaa", 4);
    expect((obj(a).graphics as Record<string, unknown>).msaa).toBe(4);
    expect(obj(setGraphics(a, "msaa", undefined)).graphics).toBeUndefined();
  });
});

describe("checking the settings", () => {
  it("accepts a good manifest", () => {
    expect(checkSettings(obj(BASE), ["main.lua"])).toEqual([]);
  });
  it("names what is wrong", () => {
    const bad = { format: 2, name: "", entry: "start.txt", world_height: 99999, sprite_filter: "blurry", graphics: { msaa: 3, anisotropy: 3, shadow_cascades: 9 }, input: { jump: ["key:Space", "gamepad:A"], fire: [] } };
    const fields = checkSettings(bad, ["main.lua"]).map((p) => p.field);
    expect(fields).toEqual(expect.arrayContaining(["format", "name", "entry", "world_height", "sprite_filter", "graphics.msaa", "graphics.anisotropy", "graphics.shadow_cascades", "input.jump", "input.fire"]));
    expect(checkSettings({ format: 1, name: "G", entry: "gone.lua" }, ["main.lua"])[0]!.message).toContain("not in the project");
  });
});

describe("input sources", () => {
  it("knows which sources the runtime accepts", () => {
    for (const ok of ["key:KeyA", "key:ArrowLeft", "pad:south", "pad2:l1", "axis:left_x", "axis:left_x-", "axis3:r2", "mouse:left", "touch:drag_x"]) expect(isValidSource(ok), ok).toBe(true);
    for (const no of ["key:", "key:Key A", "pad:A", "pad5:south", "axis:middle", "mouse:wheel", "touch:top", "south", "joy:1"]) expect(isValidSource(no), no).toBe(false);
  });
  it("makes a source from a key code, and says it in plain words", () => {
    expect(sourceFromKeyCode("KeyW")).toBe("key:KeyW");
    expect(sourceFromKeyCode("")).toBeNull();
    expect(describeSource("key:KeyW")).toBe("Key W");
    expect(describeSource("key:ArrowLeft")).toBe("Key Arrow Left");
    expect(describeSource("pad:south")).toBe("Gamepad bottom button (B)");
    expect(describeSource("axis:left_x-")).toBe("left stick left-right, negative side only");
    expect(describeSource("pad2:east")).toContain("player 2");
  });
});

describe("editing actions", () => {
  it("lists buttons and axes", () => {
    expect(actionsOf(obj(BASE)).map((a) => [a.name, a.axis])).toEqual([["jump", false], ["move_x", true]]);
  });
  it("adds and removes sources without repeats, on either side of an axis", () => {
    let t = addSource(BASE, "jump", "pad:south");
    t = addSource(t, "jump", "pad:south");
    expect(actionsOf(obj(t))[0]!.sources).toEqual(["key:Space", "pad:south"]);
    t = addSource(t, "move_x", "axis:left_x+", "positive");
    t = addSource(t, "move_x", "axis:left_x-", "negative");
    expect(actionsOf(obj(t))[1]).toMatchObject({ negative: ["key:KeyA", "axis:left_x-"], positive: ["key:KeyD", "axis:left_x+"] });
    t = removeSource(t, "move_x", "key:KeyA", "negative");
    expect(actionsOf(obj(t))[1]!.negative).toEqual(["axis:left_x-"]);
    expect(actionsOf(obj(removeSource(t, "jump", "key:Space")))[0]!.sources).toEqual(["pad:south"]);
  });
  it("makes, renames and removes an action, keeping its place, and drops the empty section", () => {
    let t = setAction(BASE, "fire", ["key:KeyZ"]);
    expect(actionsOf(obj(t)).map((a) => a.name)).toEqual(["jump", "move_x", "fire"]);
    t = renameAction(t, "jump", "leap");
    expect(actionsOf(obj(t)).map((a) => a.name)).toEqual(["leap", "move_x", "fire"]);
    expect(renameAction(t, "leap", "fire")).toBe(t);
    expect(renameAction(t, "leap", "no good")).toBe(t);
    for (const n of ["leap", "move_x", "fire"]) t = removeAction(t, n);
    expect(obj(t).input).toBeUndefined();
  });
  it("says which other actions use a source", () => {
    const t = setAction(BASE, "fire", ["key:Space"]);
    expect(usedBy(obj(t), "key:Space", "fire")).toEqual(["jump"]);
    expect(usedBy(obj(t), "key:KeyD")).toEqual(["move_x"]);
  });
});
