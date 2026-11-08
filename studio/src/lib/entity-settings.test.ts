import { describe, expect, it } from "vitest";
import { colourHex, colourOf, declareSetting, propFor, referenceNames, settingProblem, type Setting } from "./entity-settings";
import { parseEntitySource, resolveEntity } from "./entity-info";
import { parseLuaTable, toJson, UNKNOWN } from "./lua-table";

describe("parseLuaTable", () => {
  it("reads plain values, nested tables, keys and comments", () => {
    const t = parseLuaTable(`{ 4, min = -1.5, ["two words"] = 'x\\n', ok = true, none = nil, list = { "a", [[long]] }, -- a comment\n hex = 0x10, [2] = 9 }`)!;
    expect(t.list).toEqual([4, 9]);
    expect(t.fields.get("min")).toBe(-1.5);
    expect(t.fields.get("two words")).toBe("x\n");
    expect(t.fields.get("ok")).toBe(true);
    expect(t.fields.get("none")).toBeNull();
    expect(toJson(t.fields.get("list"))).toEqual(["a", "long"]);
    expect(t.fields.get("hex")).toBe(16);
  });

  it("skips what is not a plain value without losing its neighbours", () => {
    const t = parseLuaTable(`{ a = SPEED * 2, b = f(1, { 2 }), c = "kept", d = { x = y }, e = 1 + 2, f = 3 }`)!;
    expect(t.fields.get("a")).toBe(UNKNOWN);
    expect(t.fields.get("b")).toBe(UNKNOWN);
    expect(t.fields.get("c")).toBe("kept");
    expect(toJson(t.fields.get("d"))).toBeUndefined();
    expect(t.fields.get("e")).toBe(UNKNOWN);
    expect(t.fields.get("f")).toBe(3);
  });
});

describe("declareSetting", () => {
  const decl = (src: string) => declareSetting("s", parseLuaTable(`{ s = ${src} }`)!.fields.get("s")!);

  it("works out the type from the default, as the framework does", () => {
    expect(decl(`{ 4, min = 0, max = 10, step = 0.5, help = "How fast" }`)).toEqual({ name: "s", type: "number", default: 4, min: 0, max: 10, step: 0.5, help: "How fast" });
    expect(decl(`3`)).toEqual({ name: "s", type: "number", default: 3 });
    expect(decl(`{ true }`)).toEqual({ name: "s", type: "boolean", default: true });
    expect(decl(`{ "hi" }`)).toEqual({ name: "s", type: "text", default: "hi" });
    expect(decl(`{ { 0, 1, 2 } }`)).toEqual({ name: "s", type: "vector", default: [0, 1, 2], size: 3 });
    expect(decl(`{ choices = { "calm", "angry" } }`)).toEqual({ name: "s", type: "choice", default: "calm", choices: ["calm", "angry"] });
    expect(decl(`{ "#F80", type = "color" }`)).toEqual({ name: "s", type: "colour", default: "#ff8800" });
    expect(decl(`{ { 255, 0, 0 }, type = "colour" }`)).toEqual({ name: "s", type: "colour", default: "#ff0000" });
    expect(decl(`{ type = "object" }`)).toEqual({ name: "s", type: "object" });
  });

  it("says what is wrong with a declaration", () => {
    expect(decl(`{ 4, minn = 0 }`).problem).toContain("unknown 'minn'");
    expect(decl(`{ 4, min = 5, max = 1 }`).problem).toContain("min is bigger than max");
    expect(decl(`{ 0, 0 }`).problem).toContain("its own braces");
    expect(decl(`{ "x", choices = { "a", "b" } }`).problem).toContain('must be one of "a", "b"');
    expect(decl(`{ 1, type = "shape" }`).problem).toContain("unknown type 'shape'");
  });
});

describe("values", () => {
  const speed: Setting = { name: "speed", type: "number", default: 4, min: 0, max: 10 };
  const tint: Setting = { name: "tint", type: "colour", default: "#ff8800" };
  it("writes what is picked, even the default, and colours as #rrggbb", () => {
    expect(propFor(speed, 4)).toBe(4);
    expect(propFor(speed, 6)).toBe(6);
    expect(propFor(speed, undefined)).toBeUndefined();
    expect(propFor(tint, "#FF8800")).toBe("#ff8800");
    expect(propFor(tint, [0, 170, 0])).toBe("#00aa00");
    expect(propFor({ name: "f", type: "object" }, "")).toBeUndefined();
    expect(colourOf("#00000080")).toEqual([0, 0, 0, 128]);
    expect(colourHex([0, 0, 0, 128])).toBe("#00000080");
    expect(colourOf("orange")).toBeNull();
  });
  it("checks a value the way the game will", () => {
    expect(settingProblem(speed, "fast")).toBe("must be a number");
    expect(settingProblem(speed, 99)).toBeNull(); // the game keeps it within the limits
    expect(settingProblem({ name: "v", type: "vector", size: 2 }, [1])).toBe("must be a list of 2 numbers");
    expect(settingProblem({ name: "o", type: "object" }, 3)).toBe("must be the name of an object");
  });
  it("lists the names a reference can pick", () => {
    const files = ["sprites/hero.png", "sprites/items/key.png", "sprites/sheet.sprite.json", "sounds/jump.wav", "sounds/jump.ogg", "music/theme.song.json", "music/theme.ogg", "models/car.glb", "models/car.model.json"];
    expect(referenceNames("sprite", files)).toEqual(["hero", "items/key", "sheet"]);
    expect(referenceNames("sound", files)).toEqual(["jump"]);
    expect(referenceNames("music", files)).toEqual(["theme"]);
    expect(referenceNames("model", files)).toEqual(["car"]);
    expect(referenceNames("object", files, ["hero", "door"])).toEqual(["door", "hero"]);
  });
});

describe("settings in entity files", () => {
  it("are read in the order written, and a child's plain field is a new default", async () => {
    const files: Record<string, string> = {
      "entities/enemy.lua": `-- every enemy\nlocal Enemy = nova.entity {\n  sprite = "slime",\n  settings = {\n    speed = { 55, min = 0, max = 400, help = "Units a second" },\n    dir = { "left", choices = { "left", "right" } },\n  },\n}\nreturn Enemy`,
      "entities/bee.lua": `return nova.entity(require("entities.enemy"), { speed = 90, settings = { buzz = { true } } })`,
    };
    const read = async (p: string) => files[p] ?? null;
    expect(parseEntitySource(files["entities/enemy.lua"]!)!.look.settings!.map((s) => s.name)).toEqual(["speed", "dir"]);
    const bee = await resolveEntity("bee", read);
    expect(bee.sprite).toBe("slime");
    expect(bee.settings).toEqual([
      { name: "speed", type: "number", default: 90, min: 0, max: 400, help: "Units a second" },
      { name: "dir", type: "choice", default: "left", choices: ["left", "right"] },
      { name: "buzz", type: "boolean", default: true },
    ]);
  });
});
