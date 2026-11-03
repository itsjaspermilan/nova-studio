import { describe, expect, it } from "vitest";
import { groupResources, renamePlan, resolveFrom } from "./resources";
import type { FileEntry } from "./types";

const f = (...paths: string[]): FileEntry[] => paths.map((path) => ({ path, dir: false, size: 1 }));
const find = (groups: ReturnType<typeof groupResources>, id: string) => groups.find((g) => g.id === id)!;

describe("groupResources", () => {
  const files = f(
    "nova.json", "main.lua",
    "sprites/player.sprite.json", "sprites/player_sheet.png", "sprites/player.layers.json", "sprites/crate.png", "sprites/enemies/grub.sprite.json", "sprites/enemies/grub.png",
    "models/car.model.json", "models/car.glb", "models/car.texture.png", "models/old.glb",
    "scenes/title.lua", "scenes/title.scene.json", "scenes/levels/one.lua",
    "entities/player.lua", "entities/enemies/grub.lua", "util.lua",
    "sounds/jump.sfx.json", "sounds/jump.wav", "sounds/hit.wav",
    "music/theme.song.json", "music/theme.ogg", "music/loop.ogg", "fonts/pixel.ttf", "art/logo.png", "notes.txt",
  );
  const groups = groupResources(files, new Map([["sprites/player.sprite.json", "sprites/player_sheet.png"]]));
  const names = (id: string) => find(groups, id).items.map((i) => i.name);

  it("shows one item for a sprite, hiding its picture and layers", () => {
    expect(names("sprites")).toEqual(["crate", "enemies/grub", "player"]);
    const player = find(groups, "sprites").items.find((i) => i.name === "player")!;
    expect(player).toMatchObject({ kind: "sprite", path: "sprites/player.sprite.json" });
    expect(player.files).toEqual(["sprites/player.sprite.json", "sprites/player_sheet.png", "sprites/player.layers.json"]);
    expect(find(groups, "images").items.map((i) => i.path)).toEqual(["art/logo.png"]); // not a sprite's picture
  });

  it("shows one item for a model and one for a scene, with code on the side", () => {
    expect(names("models")).toEqual(["car", "old"]);
    expect(find(groups, "models").items[0]!.files).toEqual(["models/car.model.json", "models/car.glb", "models/car.texture.png"]);
    const title = find(groups, "scenes").items.find((i) => i.name === "title")!;
    expect(title).toMatchObject({ path: "scenes/title.scene.json", code: "scenes/title.lua", files: ["scenes/title.scene.json", "scenes/title.lua"] });
    expect(names("scenes")).toEqual(["levels/one", "title"]);
    expect(find(groups, "scenes").items[0]).toMatchObject({ path: "scenes/levels/one.lua" });
    expect(find(groups, "scenes").items[0]!.code).toBeUndefined();
  });

  it("groups entities, sounds, music, scripts and the rest", () => {
    expect(names("entities")).toEqual(["enemies/grub", "player"]);
    expect(names("sounds")).toEqual(["hit", "jump"]);
    expect(find(groups, "sounds").items.find((i) => i.name === "jump")!.files).toEqual(["sounds/jump.sfx.json", "sounds/jump.wav"]);
    expect(names("music")).toEqual(["loop", "theme"]);
    expect(find(groups, "music").items.find((i) => i.name === "theme")!.files).toEqual(["music/theme.song.json", "music/theme.ogg"]);
    expect(names("scripts")).toEqual(["main", "util"]);
    expect(names("fonts")).toEqual(["pixel.ttf"]);
    expect(names("project")).toEqual(["Game settings"]);
    expect(names("other")).toEqual(["notes.txt"]);
  });

  it("claims every file once and keeps the main groups even when empty", () => {
    const all = groups.flatMap((g) => g.items.flatMap((i) => i.files));
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual(files.map((x) => x.path).sort());
    const empty = groupResources([]);
    expect(empty.map((g) => g.title)).toEqual(["Sprites", "3D Models", "Scenes", "Entities", "Sounds", "Music"]);
  });

  it("falls back to name.png for a sprite whose file has not been read yet", () => {
    const g = groupResources(f("sprites/a.sprite.json", "sprites/a.png", "sprites/b_sheet.png"));
    expect(find(g, "sprites").items.find((i) => i.name === "a")!.files).toEqual(["sprites/a.sprite.json", "sprites/a.png"]);
    expect(find(g, "sprites").items.map((i) => i.name)).toEqual(["a", "b_sheet"]); // shown as a plain picture until its JSON is read
  });
});

describe("renaming a resource", () => {
  it("moves every file named after it and leaves a differently named picture alone", () => {
    const g = groupResources(f("sprites/player.sprite.json", "sprites/player_sheet.png", "sprites/player.layers.json", "models/car.model.json", "models/car.glb", "models/car.texture.png"), new Map([["sprites/player.sprite.json", "sprites/player_sheet.png"]]));
    const player = find(g, "sprites").items[0]!;
    expect(renamePlan(player, "hero")).toEqual([
      ["sprites/player.sprite.json", "sprites/hero.sprite.json"],
      ["sprites/player_sheet.png", "sprites/hero_sheet.png"],
      ["sprites/player.layers.json", "sprites/hero.layers.json"],
    ]);
    expect(renamePlan(find(g, "models").items[0]!, "truck")).toEqual([
      ["models/car.model.json", "models/truck.model.json"],
      ["models/car.glb", "models/truck.glb"],
      ["models/car.texture.png", "models/truck.texture.png"],
    ]);
    expect(renamePlan(find(g, "models").items[0]!, "car")).toEqual([]);
  });

  it("resolves a picture named relative to its JSON", () => {
    expect(resolveFrom("sprites/a.sprite.json", "a.png")).toBe("sprites/a.png");
    expect(resolveFrom("sprites/x/a.sprite.json", "../shared/a.png")).toBe("sprites/shared/a.png");
  });
});
