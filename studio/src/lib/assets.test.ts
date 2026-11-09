import { describe, expect, it } from "vitest";
import { assetCards, dropText, filterCards, iconFor, kindsOf } from "./assets";
import { groupResources } from "./resources";

const files = ["sprites/player.sprite.json", "sprites/player.png", "models/car.model.json", "models/car.glb", "sounds/coin.sfx.json", "scenes/title.lua", "scenes/title.scene.json", "main.lua"].map((path) => ({ path, dir: false, size: 1 }));
const cards = assetCards(groupResources(files));

describe("the asset browser's cards", () => {
  it("make one card per resource, not per file", () => {
    expect(cards.map((c) => [c.kind, c.name])).toEqual(expect.arrayContaining([["sprite", "player"], ["model", "car"], ["sound", "coin"], ["scene", "title"]]));
    expect(cards.filter((c) => c.name === "player")).toHaveLength(1);
  });

  it("search by words in the name or the group, and filter by kind", () => {
    expect(filterCards(cards, "pla").map((c) => c.name)).toEqual(["player"]);
    expect(filterCards(cards, "3d").map((c) => c.name)).toEqual(["car"]);
    expect(filterCards(cards, "", "sound").map((c) => c.name)).toEqual(["coin"]);
    expect(filterCards(cards, "zzz")).toEqual([]);
    expect(kindsOf(cards)).toEqual(expect.arrayContaining(["sprite", "model", "sound"]));
  });

  it("drop as the short name in quotes, the way Lua names an asset", () => {
    expect(dropText({ kind: "sprite", name: "enemies/slime", path: "x", files: [], group: "Sprites" })).toBe('"slime"');
  });

  it("have an icon for every kind", () => {
    expect(iconFor("model")).toBe("cube");
    expect(iconFor("song")).toBe("sound");
    expect(iconFor("font")).toBe("file");
  });
});
