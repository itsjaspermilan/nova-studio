import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
    expect(() => use("sprite_write", { name: "r", palette: { a: "#fff000" }, frames: [["aa", "a"]] })).toThrow(/not 2x2/);
    expect(() => use("sprite_write", { name: "r", palette: {}, frames: [["z"]] })).toThrow(/palette/);
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

describe("the track and store art tools", () => {
  it("lays out a rally stage from control points: scene, gates, waypoints and a road ribbon", () => {
    use("project_create", { name: "Race" });
    const control = [[0, -100], [0, 0], [0, 120], [60, 200], [160, 230], [260, 200], [300, 120], [260, 40]];
    const r = text(use("track_write", { name: "stage1", control, open: true, sections: 4, trees: ["pine"], road: "road_gravel" }));
    expect(r).toMatch(/tightest bend radius/);
    const scene = JSON.parse(readFileSync(join(dir, "scenes/stage1.scene.json"), "utf8"));
    const kinds = scene.objects.map((o: { kind: string }) => o.kind);
    expect(kinds.filter((k: string) => k === "section_gate")).toHaveLength(4);
    expect(kinds).toContain("waypoint");
    expect(kinds.filter((k: string) => k === "start_arch")).toHaveLength(2); // the start and the finish
    expect(existsSync(join(dir, "models/road_stage1.glb"))).toBe(true);
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
