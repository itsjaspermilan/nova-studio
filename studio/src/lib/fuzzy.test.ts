import { describe, expect, it } from "vitest";
import { fuzzyFind, fuzzyScore } from "./fuzzy";

const files = ["main.lua", "sprites/player.sprite.json", "sprites/player_sheet.png", "scenes/level1.scene.json", "models/car.model.json", "audio/music/main_theme.song.json", "docs/Readme.md"];

describe("quick open matching", () => {
  it("needs the letters in order, not next to each other", () => {
    expect(fuzzyScore("sprites/player.sprite.json", "plsp")).not.toBeNull();
    expect(fuzzyScore("sprites/player.sprite.json", "jsp")).toBeNull();
    expect(fuzzyScore("a.lua", "xyz")).toBeNull();
  });
  it("is not fussy about case or spaces", () => {
    expect(fuzzyScore("docs/Readme.md", "README")).not.toBeNull();
    expect(fuzzyScore("docs/Readme.md", "re adme")).not.toBeNull();
  });
  it("puts the file name before its folders", () => {
    const r = fuzzyFind(files, "main");
    expect(r[0]!.path).toBe("main.lua");
    expect(r.map((h) => h.path)).toContain("audio/music/main_theme.song.json");
  });
  it("likes word starts and runs: ps finds player_sheet, not just any p and s", () => {
    const r = fuzzyFind(files, "plsh");
    expect(r[0]!.path).toBe("sprites/player_sheet.png");
  });
  it("says which letters matched, and lists everything for an empty query up to the limit", () => {
    const h = fuzzyScore("main.lua", "ml")!;
    expect(h.at).toEqual([0, 5]);
    expect(fuzzyFind(files, "", 3)).toHaveLength(3);
    expect(fuzzyFind(files, "zzzz")).toEqual([]);
  });
});
