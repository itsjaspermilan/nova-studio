import { describe, expect, it } from "vitest";
import { planRename, relativeTo, shortName } from "./refs";

const paths = ["nova.json", "main.lua", "scenes/title.lua", "scenes/title.scene.json", "entities/player.lua", "entities/foes/grub.lua", "sprites/hero.png", "sprites/hero.sprite.json", "sounds/jump.wav", "art/logo.png"];
const plan = (from: string, to: string, files: Record<string, string>) => planRename(from, to, new Map(Object.entries(files)), paths);

describe("shortName", () => {
  it("names files the way scripts do", () => {
    expect(shortName("sprites/hero.png")).toEqual({ kind: "images", name: "hero" });
    expect(shortName("sprites/a/b.png")).toEqual({ kind: "images", name: "a/b" });
    expect(shortName("sprites/hero.sprite.json")).toEqual({ kind: "images", name: "hero" });
    expect(shortName("entities/foes/grub.lua")).toEqual({ kind: "entities", name: "foes.grub" });
    expect(shortName("scenes/title.lua")).toEqual({ kind: "scenes", name: "title" });
    expect(shortName("music/theme.ogg")).toEqual({ kind: "sounds", name: "theme" });
    expect(shortName("art/logo.png")).toBeNull();
    expect(shortName("main.lua")).toBeNull();
  });
});

describe("relativeTo", () => {
  it("writes a path relative to a folder", () => {
    expect(relativeTo("sprites", "sprites/a.png")).toBe("a.png");
    expect(relativeTo("scenes", "sprites/a.png")).toBe("../sprites/a.png");
    expect(relativeTo("", "sprites/a.png")).toBe("sprites/a.png");
    expect(relativeTo("a/b", "a/c/d.png")).toBe("../c/d.png");
  });
});

describe("planRename", () => {
  it("updates full paths in Lua and JSON", () => {
    const edits = plan("art/logo.png", "art/title.png", {
      "scenes/title.lua": `nova.ui.sprite("art/logo.png", 1, 2)\nlocal other = "art/logo.png.bak"`,
      "scenes/title.scene.json": `{ "images": [ { "image": "art/logo.png", "x": 0, "y": 0 } ] }`,
      "main.lua": `-- nothing here`,
    });
    expect(edits.map((e) => [e.file, e.count])).toEqual([["scenes/title.lua", 1], ["scenes/title.scene.json", 1]]);
    expect(edits[0]!.text).toContain('nova.ui.sprite("art/title.png", 1, 2)');
    expect(edits[0]!.text).toContain('"art/logo.png.bak"');
  });

  it("renames short names only in calls that expect that kind of name", () => {
    const edits = plan("sprites/hero.png", "sprites/knight.png", {
      "entities/player.lua": [`local P = nova.entity { sprite = "hero" }`, `nova.sound.play("hero")`, `nova.log("hero")`, `local s = nova.sprite("hero")`].join("\n"),
    });
    expect(edits).toHaveLength(1);
    const lines = edits[0]!.text.split("\n");
    expect(lines[0]).toContain('sprite = "knight"');
    expect(lines[1]).toContain('"hero"'); // a sound call: untouched
    expect(lines[2]).toContain('"hero"'); // a log: untouched
    expect(lines[3]).toContain('"knight"');
  });

  it("follows entities and scenes, dotted names included", () => {
    const e = plan("entities/foes/grub.lua", "entities/foes/slug.lua", { "scenes/title.lua": `self:spawn("x")\nnova.spawn("foes.grub", 1, 2)` });
    expect(e[0]!.text).toContain('nova.spawn("foes.slug"');
    const s = plan("entities/player.lua", "entities/hero.lua", { "scenes/title.scene.json": `{ "objects": [ { "kind": "player", "x": 1, "y": 2 }, { "kind": "other", "x": 1, "y": 2 } ] }` });
    expect(s[0]!.text).toContain('"kind": "hero"');
    expect(s[0]!.text).toContain('"kind": "other"');
    const t = plan("scenes/title.lua", "scenes/menu.lua", { "main.lua": `nova.start("title")\nnova.goto_scene('title')` });
    expect(t[0]!.count).toBe(2);
  });

  it("updates a sprite sheet's relative image when the PNG moves, or when the sheet moves", () => {
    const sheet = `{ "version": 1, "image": "hero.png", "frame_width": 8, "frame_height": 8 }`;
    const png = plan("sprites/hero.png", "sprites/knight.png", { "sprites/hero.sprite.json": sheet });
    expect(png[0]!.text).toContain('"image": "knight.png"');
    const folder = plan("sprites", "art/sprites", { "sprites/hero.sprite.json": sheet });
    expect(folder).toEqual([]); // both move together: the relative name stays valid
    const sheetOnly = plan("sprites/hero.sprite.json", "other/hero.sprite.json", { "sprites/hero.sprite.json": sheet });
    expect(sheetOnly[0]!.text).toContain('"image": "../sprites/hero.png"');
  });

  it("rewrites everything under a renamed folder", () => {
    const edits = plan("sprites", "art", { "main.lua": `nova.ui.sprite("sprites/hero.png")\nnova.sprite("hero")` });
    expect(edits[0]!.text).toContain('"art/hero.png"');
    expect(edits[0]!.text).toContain('nova.sprite("hero")'); // art/hero.png has no short name, so short names are left alone
  });

  it("leaves binary-looking and unrelated files alone", () => {
    expect(plan("art/logo.png", "art/x.png", { "notes.txt": `"art/logo.png"` })).toEqual([]);
  });
});
