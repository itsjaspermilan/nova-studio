import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockApi } from "./mock";
import { studio } from "./store.svelte";

async function openProject() {
  studio.api = createMockApi();
  await studio.newProject("/mock", "T", "starter");
}
const read = async (path: string) => (await studio.api!.readFile(path)).text!;

beforeEach(() => {
  vi.stubGlobal("confirm", () => true);
});

describe("renaming updates references", () => {
  it("rewrites scripts and scene data, and open tabs show the new text", async () => {
    await openProject();
    await studio.api!.writeFile("scenes/title.lua", `local T = nova.scene {}\nfunction T:enter() self:spawn("player", {}) end\nreturn T\n`);
    await studio.openFile("scenes/title.scene.json");
    await studio.rename("entities/player.lua", "entities/hero.lua");
    expect(await read("scenes/title.scene.json")).toContain('"kind": "hero"');
    expect(await read("scenes/title.lua")).toContain('self:spawn("player"'); // self:spawn is not a project-name call
    expect(studio.files.some((f) => f.path === "entities/hero.lua")).toBe(true);
    expect(studio.tabs.find((t) => t.path === "scenes/title.scene.json")!.text).toContain('"kind": "hero"');
  });

  it("follows a sprite's PNG into its sheet file and skips files with unsaved edits", async () => {
    await openProject();
    await studio.openFile("sprites/player.sprite.json");
    studio.edit("sprites/player.sprite.json", '{ "image": "player_sheet.png", "frame_width": 8, "frame_height": 8, "note": "unsaved" }');
    await studio.rename("sprites/player_sheet.png", "sprites/hero_sheet.png");
    expect(await read("sprites/player.sprite.json")).toContain('"image": "player_sheet.png"'); // left alone
    expect(studio.notice?.text).toContain("sprites/player.sprite.json");
  });

  it("does nothing extra when the person declines", async () => {
    await openProject();
    vi.stubGlobal("confirm", () => false);
    await studio.rename("sprites/player_sheet.png", "sprites/hero_sheet.png");
    expect(await read("sprites/player.sprite.json")).toContain('"image": "player_sheet.png"');
  });
});
