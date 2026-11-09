import { describe, expect, it } from "vitest";
import { inWorkspace, workspaceOf } from "./workspaces";

describe("which workspace a file belongs to", () => {
  it("sends each kind of file to its workspace", () => {
    expect(workspaceOf("models/car.model.json")).toBe("model");
    expect(workspaceOf("models/car.glb")).toBe("model");
    expect(workspaceOf("sprites/player.sprite.json")).toBe("sprites");
    expect(workspaceOf("sprites/Player.PNG")).toBe("sprites");
    expect(workspaceOf("sounds/coin.sfx.json")).toBe("sound");
    expect(workspaceOf("music/theme.song.json")).toBe("sound");
    expect(workspaceOf("music/theme.ogg")).toBe("sound");
    expect(workspaceOf("scenes/main.lua")).toBe("engine");
    expect(workspaceOf("scenes/main.scene.json")).toBe("engine");
    expect(workspaceOf("tracks/a.track.json")).toBe("engine");
    expect(workspaceOf("nova.json")).toBe("engine");
  });

  it("filters a list to one workspace", () => {
    const tabs = [{ path: "a.lua" }, { path: "b.sprite.json" }, { path: "c.model.json" }, { path: "d.lua" }];
    expect(inWorkspace(tabs, "engine").map((t) => t.path)).toEqual(["a.lua", "d.lua"]);
    expect(inWorkspace(tabs, "sound")).toEqual([]);
  });
});
