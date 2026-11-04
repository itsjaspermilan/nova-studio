import { describe, expect, it } from "vitest";
import { apiEntries, complete, identifierAt, lookup, projectSymbols } from "./completions";

const files = [
  "nova.json", "main.lua", "scenes/title.lua", "scenes/levels/one.lua", "scenes/title.scene.json",
  "entities/player.lua", "entities/enemies/grub.lua", "sprites/crate.png", "sprites/player.sprite.json", "sprites/player_sheet.png",
  "models/car.glb", "sounds/jump.wav", "music/theme.wav", "fonts/title.ttf", "art/logo.png",
];
const manifest = JSON.stringify({ format: 1, name: "T", input: { jump: ["key:Space"], a: ["key:Enter"] } });
const symbols = projectSymbols(files, manifest);
const labels = (c: ReturnType<typeof complete>) => (c ? c.options.map((o) => o.label) : []);

describe("projectSymbols", () => {
  it("finds images, sheets, models, sounds, fonts, scenes and entities with short and full names", () => {
    expect(symbols.images.map((s) => s.label)).toEqual(expect.arrayContaining(["crate", "sprites/crate.png", "player", "sprites/player.sprite.json", "art/logo.png"]));
    expect(symbols.images.map((s) => s.label)).not.toContain("logo");
    expect(symbols.models.map((s) => s.label)).toEqual(["models/car.glb", "car"]);
    expect(symbols.sounds.map((s) => s.label)).toEqual(expect.arrayContaining(["jump", "theme", "sounds/jump.wav", "music/theme.wav"]));
    expect(symbols.fonts.map((s) => s.label)).toEqual(expect.arrayContaining(["sans", "pixel", "title", "fonts/title.ttf"]));
    expect(symbols.scenes.map((s) => s.label)).toEqual(["levels.one", "title"]);
    expect(symbols.entities.map((s) => s.label)).toEqual(["enemies.grub", "player"]);
  });

  it("adds the project's own actions first and lets them replace built-ins", () => {
    expect(symbols.actions[0]!.label).toBe("jump");
    expect(symbols.actions.find((a) => a.label === "a")!.detail).toBe("action from nova.json");
    expect(symbols.actions.map((a) => a.label)).toContain("move_x");
  });

  it("survives a broken manifest and an empty project", () => {
    expect(projectSymbols(files, "{ nope").actions.length).toBeGreaterThan(10);
    expect(projectSymbols([]).images).toEqual([]);
  });
});

describe("complete: nova members", () => {
  it("lists the namespace's members after nova.", () => {
    const c = complete("nova.", symbols)!;
    expect(c.from).toBe(5);
    expect(labels(c)).toEqual(expect.arrayContaining(["sprite", "ui", "input", "sound", "spawn", "start"]));
    expect(labels(c)).not.toContain("ui.text");
  });

  it("filters by what was typed and replaces just that part", () => {
    const text = "local x = 1\nnova.ui.te";
    const c = complete(text, symbols)!;
    expect(labels(c)).toEqual(["text", "text_size", "text_width", "text_field"]);
    expect(c.from).toBe(text.length - 2);
    expect(c.options[0]!.detail).toContain("nova.ui.text(x, y, text");
    expect(c.options[0]!.info).toContain("font");
  });

  it("completes nested namespaces and ignores unknown ones", () => {
    expect(labels(complete("nova.input.", symbols))).toEqual(expect.arrayContaining(["down", "pressed", "bind", "last_source"]));
    expect(complete("nova.nothing.", symbols)).toBeNull();
    expect(complete("other.", symbols)).toBeNull();
  });

  it("completes entity methods after self:", () => {
    const c = complete("function Player:update(dt)\n  self:pl", symbols)!;
    expect(labels(c)).toEqual(["play", "play_clip"]);
    expect(labels(complete("self:", symbols))).toEqual(expect.arrayContaining(["destroy", "tween", "slide", "after"]));
    expect(complete("self.", symbols)).toBeNull();
  });
});

describe("complete: names inside strings", () => {
  const cases: [string, string, string[]][] = [
    ['nova.sprite("', "images", ["crate", "player"]],
    ["nova.ui.sprite('cr", "images", ["crate"]],
    ['nova.model("', "models", ["car"]],
    ['nova.sound.play("ju', "sounds", ["jump", "jump"].slice(0, 1)],
    ['nova.music.play("th', "sounds", ["theme"]],
    ['nova.spawn("', "entities", ["enemies.grub", "player"]],
    ['nova.goto_scene("', "scenes", ["levels.one", "title"]],
    ['nova.start("ti', "scenes", ["title"]],
    ['if nova.input.down("', "actions", ["jump"]],
    ['nova.ui.text(0, 0, "hi", { font = "', "fonts", ["sans", "pixel", "title"]],
    ["local P = nova.entity { sprite = '", "images", ["crate", "player"]],
    ['nova.tilemap { image = "', "images", ["crate"]],
  ];
  for (const [text, , expected] of cases) {
    it(text, () => {
      const c = complete(text, symbols);
      expect(c, text).not.toBeNull();
      expect(labels(c)).toEqual(expect.arrayContaining(expected));
      const typedStart = text.lastIndexOf(text.includes("'") && text.lastIndexOf("'") > text.lastIndexOf('"') ? "'" : '"') + 1;
      expect(c!.from).toBe(typedStart);
    });
  }

  it("stays out of the way inside other strings and finds nothing when nothing matches", () => {
    expect(complete('local s = "hello wor', symbols)).toBeNull();
    expect(complete('nova.sprite("zzz', symbols)).toBeNull();
    expect(complete('nova.log("nova.', symbols)).toBeNull();
  });

  it("matches without regard to case and only looks at the current line", () => {
    expect(labels(complete('nova.sprite("CRA', symbols))).toContain("crate");
    expect(complete('nova.sprite("\nlocal x = ', symbols)).toBeNull();
  });
});

describe("complete: bare words", () => {
  it("offers nova and keywords after two letters", () => {
    expect(labels(complete("no", symbols))).toEqual(["nova", "not"]);
    expect(labels(complete("  fun", symbols))).toEqual(["function"]);
    expect(complete("n", symbols)).toBeNull();
    expect(complete("x = 3", symbols)).toBeNull();
  });
});

describe("hover lookup", () => {
  it("finds the dotted name or method under the pointer", () => {
    const text = "  nova.ui.text(1, 2, 'x')\n  self:destroy()";
    expect(identifierAt(text, text.indexOf("text") + 1)).toBe("nova.ui.text");
    expect(identifierAt(text, text.indexOf("destroy") + 2)).toBe(":destroy");
    expect(identifierAt(text, 0)).toBeNull();
    expect(lookup("nova.ui.text")!.doc).toContain("Draw text");
    expect(lookup(":destroy")!.signature).toBe("self:destroy()");
    expect(lookup("nova.nope")).toBeNull();
  });
});

describe("the reference data", () => {
  it("every entry is complete (the Rust test keeps it in step with the Lua API)", () => {
    expect(apiEntries.length).toBeGreaterThan(80);
    for (const e of apiEntries) {
      expect(e.signature && e.doc && e.group, e.name).toBeTruthy();
    }
  });
});
