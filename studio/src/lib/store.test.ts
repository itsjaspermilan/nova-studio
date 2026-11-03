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

describe("sprite layers files", () => {
  it("move and disappear with their sprite", async () => {
    await openProject();
    await studio.api!.createFile("sprites/player.layers.json", "{}");
    await studio.refreshFiles();
    await studio.rename("sprites/player.sprite.json", "sprites/hero.sprite.json");
    const paths = studio.files.map((f) => f.path);
    expect(paths).toContain("sprites/hero.layers.json");
    expect(paths).not.toContain("sprites/player.layers.json");
    await studio.remove("sprites/hero.sprite.json");
    expect(studio.files.map((f) => f.path).some((p) => p.endsWith(".layers.json"))).toBe(false);
  });
});

describe("files changed outside the studio", () => {
  it("reloads tabs with nothing unsaved and flags the ones with unsaved work", async () => {
    await openProject();
    await studio.openFile("main.lua");
    await studio.openFile("scenes/title.lua");
    studio.edit("scenes/title.lua", "-- my unsaved edit\n");
    await studio.api!.writeFile("main.lua", "-- changed by git\n");
    await studio.api!.writeFile("scenes/title.lua", "-- changed by git too\n");
    await studio.checkExternal();
    const main = studio.tabs.find((t) => t.path === "main.lua")!;
    const title = studio.tabs.find((t) => t.path === "scenes/title.lua")!;
    expect(main.text).toBe("-- changed by git\n");
    expect(main.conflict).toBeFalsy();
    expect(title.text).toBe("-- my unsaved edit\n"); // untouched
    expect(title.conflict).toBe(true);
  });

  it("lets the person keep their version (and save over the disk one) or take the disk version", async () => {
    await openProject();
    await studio.openFile("main.lua");
    studio.edit("main.lua", "-- mine\n");
    await studio.api!.writeFile("main.lua", "-- theirs\n");
    await studio.checkExternal();
    const tab = () => studio.tabs.find((t) => t.path === "main.lua")!;
    expect(tab().conflict).toBe(true);
    await studio.keepMine("main.lua");
    expect(tab().conflict).toBe(false);
    expect(tab().text).toBe("-- mine\n");
    await studio.checkExternal();
    expect(tab().conflict).toBeFalsy(); // not flagged again
    await studio.save("main.lua");
    expect((await studio.api!.readFile("main.lua")).text).toBe("-- mine\n");

    studio.edit("main.lua", "-- mine again\n");
    await studio.api!.writeFile("main.lua", "-- theirs again\n");
    await studio.checkExternal();
    expect(tab().conflict).toBe(true);
    await studio.useDiskVersion("main.lua");
    expect(tab().text).toBe("-- theirs again\n");
    expect(tab().conflict).toBe(false);
  });

  it("asks before saving over a conflicting file, and does nothing when nothing changed", async () => {
    await openProject();
    await studio.openFile("main.lua");
    await studio.checkExternal();
    expect(studio.tabs[0]!.conflict).toBeFalsy();
    studio.edit("main.lua", "-- mine\n");
    await studio.api!.writeFile("main.lua", "-- theirs\n");
    await studio.checkExternal();
    vi.stubGlobal("confirm", () => false);
    expect(await studio.save("main.lua")).toBe(false);
    expect((await studio.api!.readFile("main.lua")).text).toBe("-- theirs\n");
    vi.stubGlobal("confirm", () => true);
    expect(await studio.save("main.lua")).toBe(true);
    expect((await studio.api!.readFile("main.lua")).text).toBe("-- mine\n");
  });

  it("drops editor state for reloaded sprite-like tabs so they read the new file", async () => {
    await openProject();
    await studio.openFile("sprites/player.sprite.json");
    studio.sessions.set("sprites/player.sprite.json", { stale: true });
    const text = (await studio.api!.readFile("sprites/player.sprite.json")).text!;
    await studio.api!.writeFile("sprites/player.sprite.json", text.replace("200", "250"));
    await studio.checkExternal();
    expect(studio.sessions.has("sprites/player.sprite.json")).toBe(false);
  });
});

describe("adding lesson code to a project", () => {
  it("creates a new file, opens it, and asks before replacing one", async () => {
    await openProject();
    await studio.applySnippet("entities/coin.lua", "return nova.entity {}\n");
    expect((await studio.api!.readFile("entities/coin.lua")).text).toBe("return nova.entity {}\n");
    expect(studio.active).toBe("entities/coin.lua");

    vi.stubGlobal("confirm", () => false);
    await studio.applySnippet("entities/coin.lua", "-- replaced\n");
    expect((await studio.api!.readFile("entities/coin.lua")).text).toBe("return nova.entity {}\n"); // declined

    vi.stubGlobal("confirm", () => true);
    await studio.applySnippet("entities/coin.lua", "-- replaced\n");
    expect((await studio.api!.readFile("entities/coin.lua")).text).toBe("-- replaced\n");
    expect(studio.tabs.find((t) => t.path === "entities/coin.lua")!.text).toBe("-- replaced\n"); // the open tab shows it
  });

  it("does not overwrite unsaved work in an open tab, and needs a project", async () => {
    await openProject();
    await studio.openFile("main.lua");
    studio.edit("main.lua", "-- my work\n");
    await studio.applySnippet("main.lua", "-- lesson\n");
    const tab = studio.tabs.find((t) => t.path === "main.lua")!;
    expect(tab.text).toBe("-- my work\n");
    expect(tab.conflict).toBe(true); // flagged, with the choice left to the person
    await studio.closeProject();
    await studio.applySnippet("x.lua", "-- x\n");
    expect(studio.notice?.text).toContain("Open a project first");
  });

  it("opens the help window on the tab and lesson asked for", () => {
    studio.openHelp("lessons", "sound");
    expect([studio.helpOpen, studio.helpTab, studio.helpLesson]).toEqual([true, "lessons", "sound"]);
    studio.openHelp();
    expect([studio.helpTab, studio.helpLesson]).toEqual(["start", null]);
    studio.helpOpen = false;
  });
});

describe("making an imported model editable", () => {
  it("reads its parts into a model file, keeps the original and writes the model's own glb", async () => {
    await openProject();
    const { exportGlb } = await import("./glb");
    const { addCube, addPart, newModel, serializeModel } = await import("./model-doc");
    const { toBase64 } = await import("./wav");
    const source = addCube(addPart(newModel(), [0], "arm").doc, [0, 0], { from: [0, 0, 0], size: [2, 6, 2], color: "#336699" }).doc;
    await studio.api!.writeModel("models/robot.glb", `data:model/gltf-binary;base64,${toBase64(exportGlb(source))}`);
    await studio.refreshFiles();
    await studio.makeModelEditable("models/robot.glb");
    const paths = studio.files.map((f) => f.path);
    expect(paths).toEqual(expect.arrayContaining(["models/robot.model.json", "models/robot.glb", "models/robot-original.glb"]));
    expect(studio.active).toBe("models/robot.model.json");
    const text = await read("models/robot.model.json");
    expect(text).toContain('"name": "arm"');
    expect(text).toContain('"shape": "mesh"');
    expect(serializeModel(JSON.parse(text))).toBeTruthy();
    // doing it again refuses rather than overwriting
    await studio.makeModelEditable("models/robot.glb");
    expect(studio.notice?.kind).toBe("error");
    // a file that is not a model is reported and leaves things as they were
    await studio.api!.writeModel("models/bad.glb", "data:model/gltf-binary;base64,Z2xURgIAAAAMAAAA");
    await studio.refreshFiles();
    await studio.makeModelEditable("models/bad.glb");
    expect(studio.notice?.kind).toBe("error");
    expect(studio.files.map((f) => f.path)).not.toContain("models/bad.model.json");
  });
});

describe("music as Ogg", () => {
  const wavUrl = "data:audio/wav;base64,UklGRg==";
  it("a new song is saved as an Ogg beside its song file", async () => {
    await openProject();
    await studio.createSong("theme");
    const paths = studio.files.map((f) => f.path);
    expect(paths).toContain("music/theme.song.json");
    expect(paths).toContain("music/theme.ogg");
    expect(paths).not.toContain("music/theme.wav");
    expect(studio.active).toBe("music/theme.song.json");
  });

  it("saving a song over an older WAV of the same name moves the WAV to the trash so it cannot shadow the Ogg", async () => {
    await openProject();
    await studio.api!.writeAudio("music/theme.wav", wavUrl);
    await studio.refreshFiles();
    await studio.writeMusicOgg("music/theme.ogg", wavUrl);
    const paths = studio.files.map((f) => f.path);
    expect(paths).toContain("music/theme.ogg");
    expect(paths).not.toContain("music/theme.wav");
  });

  it("converting a WAV replaces it with an Ogg and opens that in its place", async () => {
    await openProject();
    await studio.api!.writeAudio("music/loop.wav", wavUrl);
    await studio.refreshFiles();
    await studio.openFile("music/loop.wav");
    await studio.convertToOgg("music/loop.wav");
    const paths = studio.files.map((f) => f.path);
    expect(paths).toContain("music/loop.ogg");
    expect(paths).not.toContain("music/loop.wav");
    expect(studio.tabs.map((t) => t.path)).toContain("music/loop.ogg");
    expect(studio.tabs.map((t) => t.path)).not.toContain("music/loop.wav");
    expect(studio.active).toBe("music/loop.ogg");
    expect(studio.notice?.text).toContain("Converted to music/loop.ogg");
  });

  it("refuses to convert when the Ogg is already there, leaving the WAV alone", async () => {
    await openProject();
    await studio.api!.writeAudio("music/a.wav", wavUrl);
    await studio.api!.writeOgg("music/a.ogg", wavUrl);
    await studio.refreshFiles();
    await studio.convertToOgg("music/a.wav");
    expect(studio.notice?.text).toContain("already exists");
    expect(studio.files.map((f) => f.path)).toContain("music/a.wav");
  });
});
