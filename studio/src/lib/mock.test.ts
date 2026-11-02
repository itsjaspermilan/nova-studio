import { describe, expect, it } from "vitest";
import { createMockApi } from "./mock";

describe("mock api", () => {
  it("creates a project, edits files, renames folders and keeps paths confined", async () => {
    const api = createMockApi();
    await expect(api.listFiles()).rejects.toBe("no project is open");
    const info = await api.newProject("/mock", "Demo", "starter");
    expect(info.name).toBe("Demo");
    expect(JSON.parse((await api.readFile("nova.json")).text!).name).toBe("Demo");
    await api.writeFile("main.lua", "-- x\n");
    await api.createFile("scenes/deep/a.lua", "return 1");
    await api.renameFile("scenes", "levels");
    const paths = (await api.listFiles()).map((f) => f.path);
    expect(paths).toContain("levels/deep/a.lua");
    expect(paths).not.toContain("scenes/title.lua");
    await expect(api.readFile("../etc/passwd")).rejects.toMatch(/not a path inside/);
    await expect(api.createFile("main.lua")).rejects.toMatch(/already exists/);
    await api.deleteFile("levels");
    expect((await api.listFiles()).some((f) => f.path.startsWith("levels"))).toBe(false);
  });

  it("reports problems and runs and stops", async () => {
    const api = createMockApi();
    await api.newProject("/mock", "Demo", "blank");
    await api.writeFile("main.lua", "x = 1\nTODO_BREAK\n");
    const report = await api.checkProject();
    expect(report.ok).toBe(false);
    expect(report.diagnostics[0]).toMatchObject({ file: "main.lua", line: 2 });
    const exits: (number | null)[] = [];
    await api.onPlayExit((c) => exits.push(c));
    await api.runProject();
    expect(await api.isRunning()).toBe(true);
    await expect(api.runProject()).rejects.toMatch(/already running/);
    expect(await api.stopProject()).toBe(true);
    expect(exits).toEqual([null]);
    expect(await api.stopProject()).toBe(false);
  });
});
