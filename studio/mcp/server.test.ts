import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeWav } from "../src/lib/wav";
import { decodePng } from "./draw";
import { call, tools } from "./server";

let dir = "";
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "nova-mcp-test-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const text = (r: ReturnType<typeof call>) => (r.content[0] as { text: string }).text;
const use = (name: string, args: Record<string, unknown> = {}) => call(name, { project: dir, ...args });

const crate = { version: 1, scale: 0.0625, parts: [{ name: "body", origin: [0, 0, 0], rotation: [0, 0, 0], cubes: [{ from: [-8, 0, -8], size: [16, 16, 16], color: "#aa7744" }], children: [] }] };

describe("the Nova MCP server", () => {
  it("offers its tools with names, descriptions and schemas", () => {
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["project_create", "model_write", "sfx_write", "song_write", "sprite_write", "scene_write", "check", "screenshot"]));
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.properties.project).toBeDefined();
    }
  });

  it("creates a project and lists what is in it", () => {
    use("project_create", { name: "Test Game" });
    expect(JSON.parse(readFileSync(join(dir, "nova.json"), "utf8"))).toEqual({ format: 1, name: "Test Game" });
    expect(() => use("project_create", { name: "again" })).toThrow(/already/);
    expect(text(use("project_info"))).toContain("main.lua");
  });

  it("writes a model as the studio does: the editable file and the glb", () => {
    const r = text(use("model_write", { name: "crate", model: crate }));
    expect(r).toMatch(/1 shapes/);
    expect(existsSync(join(dir, "models/crate.model.json"))).toBe(true);
    expect(readFileSync(join(dir, "models/crate.glb")).subarray(0, 4).toString()).toBe("glTF");
    // text form works, and a model that is not valid is explained
    expect(() => use("model_write", { name: "crate2", model: JSON.stringify(crate) })).not.toThrow();
    expect(() => use("model_write", { name: "bad", model: { version: 1, scale: 0.0625, parts: [{ name: "empty", origin: [0, 0, 0], rotation: [0, 0, 0], cubes: [], children: [] }] } })).toThrow(/no shapes/);
    expect(() => use("model_write", { name: "bad2", model: { version: 1, parts: "nope" } })).toThrow(/not valid/);
    expect(existsSync(join(dir, "models/bad.model.json"))).toBe(false);
    expect(existsSync(join(dir, "models/bad.glb"))).toBe(false);
  });

  it("gives a free-mesh limb automatic weights with bend, so it bends with its parts", () => {
    // an arm part holding a tube of points across the elbow, and a forearm part hanging from it
    const verts: number[][] = [];
    for (const y of [0, -3, -6, -9, -12]) for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) verts.push([x, y, z]);
    const polys = [];
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) polys.push({ v: [r * 4 + k, r * 4 + ((k + 1) % 4), (r + 1) * 4 + ((k + 1) % 4), (r + 1) * 4 + k] });
    const arm = {
      version: 1, scale: 0.0625,
      parts: [{ name: "arm", origin: [0, 12, 0], rotation: [0, 0, 0], cubes: [{ shape: "mesh", from: [-1, -12, -1], size: [2, 12, 2], color: "#336699", verts, polys }], children: [{ name: "forearm", origin: [0, -6, 0], rotation: [0, 0, 0], cubes: [], children: [] }] }],
    };
    expect(text(use("model_write", { name: "stiff", model: arm }))).not.toMatch(/bending/);
    expect(JSON.parse(readFileSync(join(dir, "models/stiff.model.json"), "utf8")).parts[0].cubes[0].skin).toBeUndefined();
    expect(text(use("model_write", { name: "bendy", model: arm, bend: true }))).toMatch(/1 bending/);
    const written = JSON.parse(readFileSync(join(dir, "models/bendy.model.json"), "utf8")).parts[0].cubes[0];
    expect(written.skin.bones).toEqual(expect.arrayContaining(["arm", "arm/forearm"]));
    expect(written.skin.weights).toHaveLength(20);
    // the glb carries a skin
    const glb = readFileSync(join(dir, "models/bendy.glb"));
    expect(glb.toString("latin1")).toContain("JOINTS_0");
  });

  it("keeps an activity log the studio can show: one line per call, the files written, errors too", () => {
    const logFile = join(dir, ".nova/activity.jsonl");
    use("model_write", { name: "log_crate", model: crate });
    expect(() => use("model_write", { name: "log_bad", model: { version: 1, parts: "nope" } })).toThrow();
    const lines = readFileSync(logFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const ok = lines.find((l) => l.tool === "model_write" && l.files.includes("models/log_crate.glb"));
    expect(ok).toMatchObject({ tool: "model_write", files: ["models/log_crate.model.json", "models/log_crate.glb"] });
    expect(typeof ok.t).toBe("number");
    expect(ok.note).toContain("models/log_crate.model.json");
    expect(ok.error).toBeUndefined();
    const bad = lines.at(-1);
    expect(bad).toMatchObject({ tool: "model_write", files: [], error: true });
    expect(bad.note).toMatch(/not valid/);
    // the log never lists itself, and it is kept short
    expect(lines.every((l) => !l.files.includes(".nova/activity.jsonl"))).toBe(true);
    for (let i = 0; i < 450; i++) use("project_info");
    expect(readFileSync(logFile, "utf8").trim().split("\n").length).toBeLessThanOrEqual(400);
  });

  it("writes a sound effect and a song", () => {
    use("sfx_write", { name: "beep", preset: "coin", params: { freq: 600 } });
    expect(readFileSync(join(dir, "sounds/beep.wav")).subarray(0, 4).toString()).toBe("RIFF");
    expect(JSON.parse(readFileSync(join(dir, "sounds/beep.sfx.json"), "utf8")).freq).toBe(600);
    expect(() => use("sfx_write", { name: "x", preset: "nope" })).toThrow(/unknown preset/);
    const song = { version: 1, bpm: 120, stepsPerBeat: 4, length: 16, tracks: [{ name: "lead", kind: "synth", wave: "square", notes: [{ step: 0, len: 4, pitch: 60, vel: 0.8 }] }] };
    const r = text(use("song_write", { name: "tune", song }));
    expect(r).toMatch(/music\/tune\.(ogg|wav)/);
    expect(existsSync(join(dir, "music/tune.song.json"))).toBe(true);
    expect(() => use("song_write", { name: "t2", song: { ...song, bpm: 1 } })).toThrow(/bpm/);
  });

  it("draws a sprite from text and rejects a ragged frame", () => {
    const frame = ["aa", "ab"];
    use("sprite_write", { name: "dot", palette: { a: "#ff0000", b: "#0000ff80" }, frames: [frame, frame], animations: [{ name: "idle", from: 0, to: 1 }] });
    const json = JSON.parse(readFileSync(join(dir, "sprites/dot.sprite.json"), "utf8"));
    expect(json).toMatchObject({ frame_width: 2, frame_height: 2, frames: 2, image: "dot.png" });
    expect(readFileSync(join(dir, "sprites/dot.png")).subarray(1, 4).toString()).toBe("PNG");
    expect(() => use("sprite_write", { name: "r", palette: { a: "#fff000" }, frames: [["aa", "a"]] })).toThrow(/frame 0 row 1 has 1 characters, wanted 2: "a"/);
    expect(() => use("sprite_write", { name: "r", palette: {}, frames: [["z"]] })).toThrow(/palette/);
  });

  it("says every mistake in a sprite at once, with its frame, row and column, and what shape it wanted", () => {
    let said = "";
    try {
      use("sprite_write", { name: "bad", palette: { k: "#101010" }, frames: [["kkkk", "kk k", "kkkk"], ["kkkk", "kkk", "kkkkk"], ["kkzk", "kkkk"]] });
    } catch (e) {
      said = (e as Error).message;
    }
    expect(said).toContain('frame 1 row 1 has 3 characters, wanted 4: "kkk"');
    expect(said).toContain('frame 1 row 2 has 5 characters, wanted 4: "kkkkk"');
    expect(said).toContain("frame 2 has 2 rows, wanted 3");
    expect(said).toContain("frame 2 row 0 column 2: 'z' is not in the palette");
    expect(existsSync(join(dir, "sprites/bad.png"))).toBe(false);
    expect(() => use("sprite_write", { name: "bad", frames: "x" })).toThrow(/A tiny example: \{ "name": "dot"/);
    expect(() => use("sprite_write", { name: "bad", palette: { k: "#101010" }, frames: [{ nope: 1 }] })).toThrow(/needs "rows".*or "copy"/);
  });

  it("returns a picture of the sprite it wrote, and sprite_preview shows any sprite", () => {
    const r = use("sprite_write", { name: "dot", palette: { a: "#ff0000" }, frames: [["aa", "a."], ["a.", "aa"]], animations: [{ name: "spin", from: 0, to: 1 }] });
    expect(text(r)).toMatch(/2 frame\(s\) of 2x2/);
    const image = r.content[1] as { type: string; data: string; mimeType: string };
    expect(image).toMatchObject({ type: "image", mimeType: "image/png" });
    const png = Buffer.from(image.data, "base64");
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBeGreaterThan(100); // magnified
    const p = use("sprite_preview", { name: "dot" });
    expect(text(p)).toMatch(/2 frame\(s\) of 2x2, 2 across; animations: spin 0-1/);
    expect((p.content[1] as { type: string }).type).toBe("image");
    expect(() => use("sprite_preview", { name: "nothing" })).toThrow(/no sprites\/nothing\.png/);
  });

  it("builds a sheet in several calls: appended frames, replaced frames, copies turned and recoloured, and names", () => {
    const pal = { a: "#ff0000", b: "#0000ff" };
    use("sprite_write", { name: "tiles", palette: pal, frames: [["ab", ".."]], names: ["grass"], animations: [{ name: "one", from: 0, to: 0 }] });
    const r = text(use("sprite_write", { name: "tiles", palette: pal, append: true, frames: [{ rows: ["bb", "bb"], name: "wall" }, { copy: "grass", flip: "x", name: "grass_left" }, { copy: 0, rotate: 90 }, { copy: 0, recolor: { "#ff0000": "#00ff00" } }] }));
    expect(r).toMatch(/5 frame\(s\) of 2x2 \(frames 1 to 4 written\)/);
    const json = JSON.parse(readFileSync(join(dir, "sprites/tiles.sprite.json"), "utf8"));
    expect(json).toMatchObject({ frames: 5, columns: 5, tags: [{ name: "one", from: 0, to: 0 }] }); // the animations are kept
    expect(JSON.parse(readFileSync(join(dir, "sprites/tiles.tileset.json"), "utf8")).names).toEqual({ "0": "grass", "1": "wall", "2": "grass_left" });
    const sheet = decodePng(readFileSync(join(dir, "sprites/tiles.png")));
    const px = (frame: number, x: number, y: number) => [...sheet.data.subarray((y * sheet.w + frame * 2 + x) * 4, (y * sheet.w + frame * 2 + x) * 4 + 4)];
    expect(px(0, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(2, 0, 0)).toEqual([0, 0, 255, 255]); // mirrored
    expect(px(2, 1, 0)).toEqual([255, 0, 0, 255]);
    expect(px(3, 1, 0)).toEqual([255, 0, 0, 255]); // turned a quarter clockwise: the top row is now the right column
    expect(px(3, 1, 1)).toEqual([0, 0, 255, 255]);
    expect(px(4, 0, 0)).toEqual([0, 255, 0, 255]); // recoloured
    use("sprite_write", { name: "tiles", palette: pal, at: 1, frames: [["aa", "aa"]] });
    expect(px(1, 0, 0)).toEqual([0, 0, 255, 255]); // (the old read)
    const again = decodePng(readFileSync(join(dir, "sprites/tiles.png")));
    expect([...again.data.subarray(2 * 4, 2 * 4 + 4)]).toEqual([255, 0, 0, 255]);
    expect(JSON.parse(readFileSync(join(dir, "sprites/tiles.sprite.json"), "utf8")).frames).toBe(5);
    expect(() => use("sprite_write", { name: "fresh", palette: pal, append: true, frames: [["a"]] })).toThrow(/no sprites\/fresh\.sprite\.json to add frames to/);
    expect(() => use("sprite_write", { name: "tiles", palette: pal, append: true, frames: [{ copy: "nope" }] })).toThrow(/not a frame that exists yet.*grass/);
  });

  it("takes tile layers as rows of characters with a legend, by number or tile name, and names the row and column of a mistake", () => {
    use("sprite_write", { name: "tiles", palette: { a: "#ff0000" }, frames: [["a"], ["."], ["a"]], names: ["grass", "wall"] });
    const layer = { name: "ground", tileset: { image: "sprites/tiles.png", tile_width: 1, tile_height: 1 }, legend: { g: 0, W: "wall", x: 2 }, solid: ["W"], tiles: ["WWW", "Wg.", "WxW"] };
    const r = use("scene_write", { name: "room", scene: { version: 1, objects: [{ kind: "hero", name: "hero", x: 1, y: 1 }], tilemaps: [layer] } });
    const saved = JSON.parse(readFileSync(join(dir, "scenes/room.scene.json"), "utf8"));
    expect(saved.tilemaps[0].tiles).toEqual([[1, 1, 1], [1, 0, -1], [1, 2, 1]]);
    expect(saved.tilemaps[0].solid).toEqual([1]);
    expect(saved.tilemaps[0].legend).toBeUndefined();
    expect(text(r)).toContain("1 tile layer(s)");
    expect((r.content[1] as { type: string }).type).toBe("image");
    // numbers stay accepted
    use("scene_write", { name: "plain", scene: { version: 1, objects: [], tilemaps: [{ ...layer, legend: undefined, solid: [1], tiles: [[1, 0], [-1, 2]] }] }, picture: false });
    let said = "";
    try {
      use("scene_write", { name: "bad", scene: { version: 1, tilemaps: [{ ...layer, legend: { g: 0, W: "wal", q: 9 }, tiles: ["gg", "g?g", "qg"] }] } });
    } catch (e) {
      said = (e as Error).message;
    }
    expect(said).toContain('tilemaps[0] ("ground") legend "W": "wal" is not a tile number (-1 is empty) or a tile name (the tileset\'s names: grass, wall)');
    expect(said).toContain("row 1 column 1: '?' is not in the legend");
    expect(said).toContain('row 1 has 3 tiles, wanted 2 (the length of row 0): "g?g"');
    expect(said).toContain("row 2 column 0: tile 9 is outside the tileset (sprites/tiles.png has 3 tiles, 0 to 2)");
    expect(existsSync(join(dir, "scenes/bad.scene.json"))).toBe(false);
  });

  it("draws a scene file as a map and says what is in it", () => {
    use("sprite_write", { name: "tiles", palette: { a: "#ff0000", b: "#00ff00" }, frames: [["aa", "aa"], ["bb", "bb"]], names: ["grass", "wall"] });
    use("sprite_write", { name: "hero", palette: { a: "#ffffff" }, frames: [["aa", "aa"]] });
    use("write_file", { path: "entities/hero.lua", text: 'return nova.entity { sprite = "hero", hitbox = { -1, 0, 2, 1 } }\n' });
    use("scene_write", { name: "room", picture: false, scene: { version: 1, objects: [{ kind: "hero", name: "hero", x: 3, y: 3 }, { kind: "chest", x: 5, y: 1, props: { holds: "key" } }], tilemaps: [{ name: "ground", tileset: { image: "sprites/tiles.png", tile_width: 2, tile_height: 2 }, legend: { g: "grass", W: "wall" }, solid: ["W"], tiles: ["WWWW", "WggW", "WWWW"] }] } });
    const r = use("scene_preview", { name: "room" });
    const said = text(r);
    expect(said).toContain('tile layer "ground": 4 x 3 tiles of 2 x 2');
    expect(said).toContain("legend: . empty, G 0 grass, W 1 wall (solid)");
    expect(said).toContain("  1 WGGW");
    expect(said).toContain("hero:hero at 3, 3 (tile 1, 1)");
    expect(said).toContain('chest at 5, 1 (tile 2, 0) [NO entities/chest.lua] {"holds":"key"}');
    const picture = decodePng(Buffer.from((r.content[1] as { data: string }).data, "base64"));
    expect(picture.w).toBeGreaterThan(40);
    // the wall tile's green and the hero's white are both in the picture
    const has = (c: number[]) => { for (let i = 0; i < picture.data.length; i += 4) if (picture.data[i] === c[0] && picture.data[i + 1] === c[1] && picture.data[i + 2] === c[2]) return true; return false; };
    expect(has([255, 255, 255])).toBe(true);
    expect(has([255, 0, 0])).toBe(true);
    expect(() => use("scene_preview", { name: "nothing" })).toThrow(/no scenes\/nothing\.scene\.json/);
  });

  it("writes a scene layout, tidied, and refuses one that is not a scene", () => {
    use("scene_write", { name: "level", scene: { version: 1, camera: { eye: [0, 5, 9], target: [0, 0, 0], fov: 55 }, objects: [{ kind: "crate", x: 1, y: 0, z: -3 }] } });
    const written = readFileSync(join(dir, "scenes/level.scene.json"), "utf8");
    expect(written.indexOf('"camera"')).toBeLessThan(written.indexOf('"objects"'));
    expect(() => use("scene_write", { name: "bad", scene: "[1]" })).toThrow(/not valid/);
  });

  it("keeps every file inside the project and keeps binaries to the right tools", () => {
    expect(() => use("write_file", { path: "../escape.txt", text: "x" })).toThrow(/outside/);
    expect(() => use("write_file", { path: "/etc/passwd", text: "x" })).toThrow(/outside/);
    expect(() => use("read_file", { path: "../../etc/hosts" })).toThrow(/outside/);
    expect(() => use("write_file", { path: "models/x.glb", text: "x" })).toThrow(/binary/);
    expect(() => use("write_file", { path: "models/x.model.json", text: "{}" })).toThrow(/model_write/);
    use("write_file", { path: "scenes/play.lua", text: "return nova.scene {}\n" });
    expect(text(use("read_file", { path: "scenes/play.lua" }))).toContain("nova.scene");
    expect(() => use("model_write", { name: "../x", model: crate })).toThrow(/names use letters/);
    expect(() => call("nope", {})).toThrow(/unknown tool/);
    expect(() => call("project_create", { project: dir })).toThrow(/'name' is required/);
  });
});

describe("hearing without ears", () => {
  it("reads a tone, a tune, noise and a rumble, and warns about what will not be heard", () => {
    // a sine at 880 Hz
    const tone = text(use("sfx_write", { name: "tone", params: { wave: "sine", freq: 880, sustain: 0.5, decay: 0.1, volume: 0.5 } }));
    expect(tone).toMatch(/reading: nearly a pure tone at 8[78]\d Hz \(A5\)/);
    expect(tone).toMatch(/peak -6\.\d dBFS/);
    expect(tone).toMatch(/strongest lines: 8[78]\d Hz A5 \d+ %/);
    expect(tone).toContain("no clipping");
    // a four-note fanfare in one effect: the pitch over time climbs through the notes
    const fanfare = text(use("sfx_write", { name: "fanfare", params: { freq: 523, arpTime: 0.11, arpNotes: [4, 7, 12], sustain: 0.4 } }));
    expect(fanfare).toContain("rising in pitch");
    const pitches = /strongest pitch over time \(8 equal parts\): ([\d\s-]+) Hz/.exec(fanfare)![1]!.split(" ").filter((p) => p !== "-").map(Number);
    expect(pitches[0]).toBeGreaterThan(480);
    expect(pitches[0]).toBeLessThan(560);
    expect(pitches.at(-1)).toBeGreaterThan(1000);
    expect(JSON.parse(readFileSync(join(dir, "sounds/fanfare.sfx.json"), "utf8")).arpNotes).toEqual([4, 7, 12]);
    // white noise, and noise so slow it is a rumble small speakers cannot play
    expect(text(use("sfx_write", { name: "hiss", params: { wave: "noise", freq: 3000, sustain: 0.3 } }))).toContain("mostly noise");
    const step = text(use("sfx_write", { name: "step", params: { wave: "noise", freq: 50, sustain: 0.05, decay: 0.1 } }));
    expect(step).toMatch(/WARNING: almost all of its energy \(\d\d %\) is below 80 Hz/);
    expect(() => use("sfx_write", { name: "x", params: { pitch: 400 } })).toThrow(/params has "pitch", which the synth does not have/);
    expect(() => use("sfx_write", { name: "x", params: { arpNotes: "up" } })).toThrow(/arpNotes is a list of semitones/);
  });

  it("reports existing sounds with a spectrogram, compares a mix, and checks a loop's seam", () => {
    use("sfx_write", { name: "loud", params: { wave: "square", freq: 440, sustain: 0.5, volume: 0.9 } });
    use("sfx_write", { name: "soft", params: { wave: "sine", freq: 440, sustain: 0.5, volume: 0.05 } });
    const r = use("sound_report", { sounds: ["loud", "sounds/soft.wav"] });
    const said = text(r);
    expect(said).toContain("sounds/loud.wav: 0.7");
    expect(said).toMatch(/the mix, loudest first[\s\S]*sounds\/loud\.wav[\s\S]*sounds\/soft\.wav\s+-\d+\.\d\s+(\d+\.\d)/);
    const below = Number(/sounds\/soft\.wav\s+-\d+\.\d\s+(\d+\.\d)/.exec(said)![1]);
    expect(below).toBeGreaterThan(20); // 0.05 against 0.9 of a brighter wave
    expect(said).toMatch(/the quietest is \d+\.\d dB under the loudest/);
    const picture = decodePng(Buffer.from((r.content[1] as { data: string }).data, "base64"));
    expect(picture.w).toBe(720);
    expect(picture.h).toBeGreaterThan(600); // two sounds, one under the other
    // a sound that stops dead is a loop with a click, and a one-shot with a click at the end
    const cut = text(use("sound_report", { sound: "loud.sfx.json", loop: true, picture: false }));
    expect(cut).toContain("loop seam: matches");
    const wav = encodeWav({ rate: 8000, channels: [Float32Array.from({ length: 4000 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 100.3 * i) / 8000) + 0.3)] });
    mkdirSync(join(dir, "sounds"), { recursive: true });
    writeFileSync(join(dir, "sounds/drone.wav"), wav);
    const drone = text(use("sound_report", { sound: "drone", loop: true, picture: false }));
    expect(drone).toContain("WARNING: a DC offset of 30");
    expect(drone).toMatch(/loop seam: DOES NOT MATCH|loop seam: matches/);
    const oneShot = text(use("sound_report", { sound: "drone", picture: false }));
    expect(oneShot).toMatch(/it starts at 30 % of full scale instead of from silence: a click at the start/);
    expect(() => use("sound_report", { sound: "nothing" })).toThrow(/there is no sound 'nothing'.*sounds\/loud\.wav/);
    expect(() => use("sound_report", { file: "/etc/hosts" })).toThrow(/outside the project/);
    expect(() => use("sound_report", {})).toThrow(/say which sound/);
  });

  it("lets a drums track go without a wave and a note without a length, and reports a song as a loop", () => {
    const song = { version: 1, bpm: 120, stepsPerBeat: 4, length: 16, tracks: [{ name: "lead", kind: "synth", notes: [{ step: 0, len: 4, pitch: 69 }] }, { name: "drums", kind: "drums", notes: [{ step: 0, pitch: 36 }, { step: 8, pitch: 38 }] }] };
    use("song_write", { name: "tune", song });
    const saved = JSON.parse(readFileSync(join(dir, "music/tune.song.json"), "utf8"));
    expect(saved.tracks[0].wave).toBe("square");
    expect(saved.tracks[1]).toMatchObject({ kind: "drums", wave: "noise" });
    expect(saved.tracks[1].notes[0]).toMatchObject({ step: 0, len: 1, pitch: 36, vel: 0.8 });
    const said = text(use("sound_report", { sound: "tune.song.json", picture: false }));
    expect(said).toMatch(/music\/tune\.song\.json: 2\.\d\d s, stereo/);
    expect(said).toContain("loop seam:");
    expect(() => use("song_write", { name: "bad", song: { version: 1, bpm: 120, stepsPerBeat: 4, length: 16, tracks: [{ name: "x", kind: "piano", notes: [] }] } })).toThrow(/kind must be "synth" or "drums".*A small song:/);
  });
});

// The tools that run the game need the runtime built (`cargo build --release -p nova-runtime`); without it these are skipped.
const built = existsSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../target/release/nova"));

describe.skipIf(!built)("playing the game", () => {
  const game = () => {
    use("project_create", { name: "Walk" });
    use("sprite_write", { name: "hero", palette: { a: "#ffffff" }, frames: [["aaaa", "aaaa", "aaaa", "aaaa"]] });
    use("write_file", { path: "main.lua", text: 'nova.start("title")\n' });
    use("write_file", { path: "scenes/title.lua", text: "return nova.scene {}\n" });
    use("write_file", { path: "scenes/room.lua", text: "local R = nova.scene {}\nfunction R:enter() nova.log('in the room ' .. math.random(100000)) end\nreturn R\n" });
    use("write_file", { path: "entities/hero.lua", text: "local H = nova.entity { sprite = 'hero', hp = 3 }\nfunction H:update(dt)\n  if nova.input.down('right') then self.x = self.x + 60 * dt end\n  if nova.input.pressed('a') then nova.log('swing') end\nend\nreturn H\n" });
    use("scene_write", { name: "room", picture: false, scene: { version: 1, background: [10, 20, 40], objects: [{ kind: "hero", name: "hero", x: 100, y: 100 }] } });
  };

  it("follows a route from a named scene and returns a film strip, the state, the log and the size", () => {
    game();
    const r = use("play", {
      start_scene: "room",
      lua: "nova.named('hero').hp = 1",
      route: [{ hold: ["right"], frames: 30, capture: "walked" }, { press: "a" }, { hold: ["right"], until: "nova.named('hero').x >= 200", max: 200, capture: "at 200" }],
      print: ["nova.named('hero').hp"],
      size: "320x180",
    });
    const said = text(r);
    expect(said).toMatch(/^ran \d+ frames \(\d+\.\d s of game time\) at 320x180/);
    expect(said).toContain('f31 "walked": nova.named(\'hero\').hp = 1');
    expect(said).toMatch(/f\d+ "at 200": /);
    expect(said).toMatch(/scene room, camera at [\d.]+, [\d.]+, 1 entities alive\n\s+hero:hero at 20\d(\.\d)?, 100/);
    expect(said).toMatch(/f1 in the room \d+/);
    expect(said).toContain("f32 swing");
    expect(said).toContain("film strip of 2 moments");
    const strip = decodePng(Buffer.from((r.content[1] as { data: string }).data, "base64"));
    expect(strip.w).toBeGreaterThan(600); // two tiles of 320 side by side
    // the same route again does the same (math.random is seeded); another seed does not
    const again = text(use("play", { start_scene: "room", size: "320x180", frames: 2 }));
    const same = text(use("play", { start_scene: "room", size: "320x180", frames: 2 }));
    const other = text(use("play", { start_scene: "room", size: "320x180", frames: 2, seed: 99 }));
    const line = (s: string) => /in the room \d+/.exec(s)![0];
    expect(line(again)).toBe(line(same));
    expect(line(other)).not.toBe(line(again));
  });

  it("keeps the plain screenshot working, says its size, and crops and enlarges", () => {
    game();
    const r = use("screenshot", { frames: 5 });
    expect(text(r)).toMatch(/^ran 5 frames .* at 960x540/);
    expect(text(r)).toMatch(/saved at .*\.png$/);
    const shot = decodePng(Buffer.from((r.content[1] as { data: string }).data, "base64"));
    expect([shot.w, shot.h]).toEqual([960, 540]);
    const close = use("screenshot", { frames: 5, start_scene: "room", size: "640x360", crop: [0, 0, 100, 50], zoom: 4, press: ["key:Enter@2"], hold: ["right"] });
    const part = decodePng(Buffer.from((close.content[1] as { data: string }).data, "base64"));
    expect([part.w, part.h]).toEqual([400, 200]);
    expect(text(close)).toContain("the part [0, 0, 100, 50] enlarged x4");
  });

  it("reports a Lua error, an unknown action and a step that is not one", () => {
    game();
    const r = text(use("play", { start_scene: "room", route: [{ hold: ["jump"], frames: 2 }, { lua: "nothing.x = 1" }], size: "320x180" }));
    expect(r).toContain("warning: 'jump' is not an input action of this game");
    expect(r).toMatch(/ERROR: step 2 lua: .*nothing/);
    expect(() => use("play", { route: [{ walk: "right" }] })).toThrow(/route step 1 has "walk".*A route is a list of steps/);
    expect(() => use("play", { size: "big" })).toThrow(/WIDTHxHEIGHT/);
  });
});

describe("the track and store art tools", () => {
  it("lays out a rally stage from control points: scene, gates, waypoints and a road ribbon", () => {
    use("project_create", { name: "Race" });
    const control = [[0, -100], [0, 0], [0, 120], [60, 200], [160, 230], [260, 200], [300, 120], [260, 40]];
    const r = text(use("track_write", { name: "stage1", control, open: true, sections: 4, trees: ["pine"], road: "road_gravel" }));
    expect(r).toMatch(/tightest bend ~\d+ m/);
    const scene = JSON.parse(readFileSync(join(dir, "scenes/stage1.scene.json"), "utf8"));
    const kinds = scene.objects.map((o: { kind: string }) => o.kind);
    expect(kinds.filter((k: string) => k === "section_gate")).toHaveLength(4);
    expect(kinds).toContain("waypoint");
    expect(kinds.filter((k: string) => k === "start_arch")).toHaveLength(2); // the start and the finish
    expect(existsSync(join(dir, "models/road_stage1.glb"))).toBe(true);
    // the track file is what the track editor opens; the name alone makes the scene again from it, and a setting given changes just that
    const track = JSON.parse(readFileSync(join(dir, "tracks/stage1.track.json"), "utf8"));
    expect(track).toMatchObject({ open: true, sections: 4, road: "road_gravel", trees: ["pine"], control });
    const before = readFileSync(join(dir, "scenes/stage1.scene.json"), "utf8");
    use("track_write", { name: "stage1" });
    expect(readFileSync(join(dir, "scenes/stage1.scene.json"), "utf8")).toBe(before);
    use("track_write", { name: "stage1", sections: 3, far: { kind: ["pine"], density: 0.5 } });
    const again = JSON.parse(readFileSync(join(dir, "scenes/stage1.scene.json"), "utf8"));
    expect(again.objects.filter((o: { kind: string }) => o.kind === "section_gate")).toHaveLength(3);
    expect(JSON.parse(readFileSync(join(dir, "tracks/stage1.track.json"), "utf8"))).toMatchObject({ sections: 3, road: "road_gravel", far: { kind: ["pine"], density: 0.5 } });
    expect(() => use("track_write", { name: "nothing" })).toThrow(/control/);
    expect(() => use("track_write", { name: "bad", control: [[0, 0]] })).toThrow(/four/);
  });

  it("makes a heightmap for a route: a 16-bit png, the nova.terrain line, and a bounded grade", () => {
    use("project_create", { name: "Race" });
    const control = [[0, -100], [0, 0], [0, 120], [60, 200], [160, 230], [260, 200], [300, 120], [260, 40]];
    const r = text(use("terrain_write", { name: "stage1", control, open: true, profile: [[0, 0], [400, 20], [500, 22], [800, 2]], max_grade: 0.1, margin: 100, cell: 5 }));
    expect(r).toMatch(/nova\.terrain\{ heightmap = "terrain\/stage1\.png", x = -?[\d.]+, z = -?[\d.]+, size = [\d.]+, height = [\d.]+ \}/);
    const png = readFileSync(join(dir, "terrain/stage1.png"));
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png[24]).toBe(16); // bit depth
    expect(png[25]).toBe(0); // greyscale
    const grade = Number(/steepest grade ([\d.]+) %/.exec(r)?.[1]);
    expect(grade).toBeLessThanOrEqual(10);
    expect(grade).toBeGreaterThan(3); // it does climb
    expect(() => use("terrain_write", { name: "bad", control: [[0, 0]] })).toThrow(/four/);
    expect(() => use("terrain_write", { name: "bad", control, profile: [["x", 1]] })).toThrow(/profile/);
  });
});
