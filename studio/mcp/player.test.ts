// The third batch: a test player that plays like a person (paths, walking up to things, fights, a hero that cannot die,
// a route that stops where it failed), pictures with hitboxes on them, a second run to compare with, and tools that
// ignore nothing in silence.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodePng } from "./draw";
import { nearest, nestedWarnings, unknownKeys } from "./keys";
import { pictureDifference, renderLine } from "./play";
import { call } from "./server";

let dir = "";
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "nova-mcp-player-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));
// (the first line of an answer with a picture is its path: the tests read what follows it; one test checks the line)
const text = (r: ReturnType<typeof call>) => (r.content[0] as { text: string }).text.replace(/^picture: [^\n]*\n/, "");
const use = (name: string, args: Record<string, unknown> = {}) => call(name, { project: dir, ...args });
const picture = (r: ReturnType<typeof call>, n = 1) => decodePng(Buffer.from((r.content[n] as { data: string }).data, "base64"));
const built = existsSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../target/release/nova"));

describe("nothing is ignored in silence", () => {
  it("names a key a tool does not have, with the nearest one it has", () => {
    expect(nearest("captrue_at", ["capture_at", "every"])).toBe("capture_at");
    expect(nearest("zzz", ["capture_at", "every"])).toBeUndefined();
    expect(unknownKeys({ a: 1, sacle: 2 }, ["a", "scale"], "a thing")).toEqual(["`sacle` is not an option of a thing; did you mean `scale`?"]);
    expect(() => use("play", { captrue_at: [3] })).toThrow(/`captrue_at` is not an option of the play tool; did you mean `capture_at`\?\. Nothing was done\. play takes: /);
    expect(() => use("play", { hold_note: "" })).toThrow(/`hold_note` is not an option of the play tool/);
    expect(() => use("check", { frame: 3 })).toThrow(/did you mean `frames`\?/);
    expect(() => use("sprite_write", { name: "a", frames: [["a"]], palette: { a: "#fff" }, outline: "k" })).toThrow(/`outline` is not an option of the sprite_write tool; use `outline` inside a frame object/);
    expect(() => use("nope")).toThrow(/unknown tool 'nope'/);
    expect(() => use("scene_preveiw")).toThrow(/did you mean 'scene_preview'\?/);
    // the older spellings some callers use still work
    expect(() => use("api", { query: "camera", limit: 1 })).not.toThrow();
  });

  it("warns about a key in the wrong place inside a scene, a sprite frame and a song, and still writes the file", () => {
    use("sprite_write", { name: "tiles", palette: { a: "#ff0000" }, frames: [["a"], ["."]] });
    const layer = { tileset: { image: "sprites/tiles.png", tile_width: 1, tile_height: 1 }, scale: 3, tiles: [[0, 1]] };
    const said = text(use("scene_write", { name: "room", picture: false, scene: { version: 1, objects: [{ type: "hero", kind: "hero", x: 1, y: 1 }], tilemaps: [layer] } }));
    expect(said).toContain("warning: `scale` is not an option of tile layer 0; did you mean `tileset.scale`? (it was not used)");
    expect(said).toContain("warning: `type` is not an option of scene object 0; did you mean `kind`?");
    expect(said).toContain("scenes/room.scene.json: 1 objects");
    // a scene may carry keys of the game's own: those are not remarked on
    expect(nestedWarnings("scene_write", { scene: { version: 1, weather: "rain", objects: [{ kind: "a", x: 0, y: 0, team: 2 }] } })).toEqual([]);
    expect(nestedWarnings("scene_write", { scene: { version: 1, tilemaps: [{ tileset: { image: "a", tile_widht: 16, solid: [1] }, tiles: [] }] } })).toEqual([
      "`tile_widht` is not an option of the tileset of tile layer 0; did you mean `tile_width`?",
      "`solid` is not an option of the tileset of tile layer 0; use `solid` beside `tileset`, on the layer",
    ]);
    expect(nestedWarnings("sprite_write", { frames: [{ rows: ["a"], colour: "k", shapes: [{ rect: [0, 0, 1, 1], colour: "a" }] }] })).toEqual([
      "`colour` is not an option of sprite frame 0; use `color` inside each of the frame's shapes",
      "`colour` is not an option of shape 0 of sprite frame 0; did you mean `color`?",
    ]);
    expect(nestedWarnings("song_write", { song: { version: 1, tempo: 120, tracks: [{ name: "a", kind: "synth", notes: [{ step: 0, pitch: 60, length: 2 }] }] } })).toEqual([
      "`tempo` is not an option of a song; did you mean `bpm`?",
      "`length` is not an option of note 0 of track 0; did you mean `len`?",
    ]);
  });

  it("saves the picture where image_out says and says so first", () => {
    const r = use("sprite_write", { name: "dot", palette: { a: "#ff0000" }, frames: [["aa", "aa"]], image_out: "build/look/dot.png" });
    expect(text(r).split("\n")[0]).toBe(`picture saved: ${join(dir, "build/look/dot.png")}`);
    expect(decodePng(readFileSync(join(dir, "build/look/dot.png"))).w).toBe(picture(r).w);
    const whole = join(dir, ".elsewhere", "dot.png");
    expect(text(use("sprite_preview", { name: "dot", image_out: whole })).split("\n")[0]).toBe(`picture saved: ${whole}`);
    expect(() => use("sprite_preview", { name: "dot", image_out: "shots/dot.png" })).toThrow(/is in a folder the game loads/);
    expect(() => use("sprite_preview", { name: "dot", image_out: "build/dot.jpg" })).toThrow(/must end in \.png/);
  });
});

describe("the picture's path comes first", () => {
  it("puts the path of the picture on the first line of every answer that has one", () => {
    const first = (r: ReturnType<typeof call>) => (r.content[0] as { text: string }).text.split("\n")[0]!;
    const answers: [string, ReturnType<typeof call>][] = [
      ["sprite_write", use("sprite_write", { name: "dot", palette: { a: "#ff0000" }, frames: [["aa", "aa"]] })],
      ["sprite_preview", use("sprite_preview", { name: "dot" })],
      ["scene_write", use("scene_write", { name: "room", scene: { version: 1, objects: [{ kind: "hero", x: 8, y: 8 }] } })],
      ["scene_preview", use("scene_preview", { name: "room" })],
      ["sfx_write", use("sfx_write", { name: "hit", purpose: "hit" })],
      ["items_make", use("items_make", { name: "items" })],
    ];
    if (built) {
      use("write_file", { path: "nova.json", text: '{"format":1,"name":"T"}' });
      use("write_file", { path: "main.lua", text: "function draw() nova.rect(0, 0, 10, 10) end\n" });
      answers.push(["screenshot", use("screenshot", { frames: 2, size: "128x72" })]);
      answers.push(["play", use("play", { frames: 3, every: 1, size: "128x72" })]);
      answers.push(["model_preview", (use("model_write", { name: "box", model: { version: 1, scale: 0.0625, parts: [{ name: "b", origin: [0, 0, 0], rotation: [0, 0, 0], cubes: [{ from: [-4, 0, -4], size: [8, 8, 8], color: "#888888" }], children: [] }] } }), use("model_preview", { name: "box", width: 64, height: 64 }))]);
    }
    for (const [tool, r] of answers) {
      const images = r.content.filter((c) => (c as { type: string }).type === "image").length;
      if (!images) continue;
      const line = first(r);
      expect(line, tool).toMatch(/^picture: \/\S+\.png/);
      for (const file of line.slice("picture: ".length).split(", ")) expect(existsSync(file), `${tool}: ${file}`).toBe(true);
    }
    const pictured = answers.filter(([, r]) => r.content.length > 1).map(([t]) => t);
    for (const t of ["sprite_write", "sprite_preview", "items_make", ...(built ? ["screenshot", "play", "model_preview"] : [])]) expect(pictured).toContain(t);
  });
});

describe.skipIf(!built)("pictures that follow a thing", () => {
  it("crops every picture of a top-down run to the hero, moved with him", () => {
    const root = join(dir, "td");
    call("project_create", { project: root, name: "Td", template: "topdown" });
    const at = (args: Record<string, unknown>) => call("play", { project: root, ...args });
    const r = at({ route: [{ hold: ["right"], frames: 40, capture: "a" }, { hold: ["down"], frames: 30, capture: "b" }], crop_to: "hero", crop_margin: 20 });
    const said = text(r);
    const m = /each picture is the part round 'hero' \((\d+)x(\d+) pixels, 20 round the largest box it had\), moved with it: f(\d+) \[(\d+), (\d+), \d+, \d+\], f(\d+) \[(\d+), (\d+), \d+, \d+\]/.exec(said);
    expect(m, said).not.toBeNull();
    const [cw, ch] = [Number(m![1]), Number(m![2])];
    expect(cw).toBeLessThan(200);
    expect(ch).toBeLessThan(200);
    // the hero walked right, then down: the second part is to the right of or below the first
    expect(Number(m![7]) + Number(m![8])).toBeGreaterThan(Number(m![4]) + Number(m![5]));
    // the strip's tiles are that size (each tile a crop, not the whole 960x540 frame)
    const strip = picture(r);
    expect(strip.w).toBeLessThan(960);
    expect(said).not.toContain("warning:");
    expect(() => at({ crop_to: "hero", crop: [0, 0, 10, 10] })).toThrow(/crop and crop_to/);
  });

  it("takes a 3D run's pictures from beside the hero: a side view of the walk, the hero in every one", () => {
    const root = join(dir, "three");
    call("project_create", { project: root, name: "Three", template: "3d" });
    const at = (args: Record<string, unknown>) => call("play", { project: root, ...args });
    const r = at({ route: [{ hold: ["move_y=-1"], frames: 48 }], every: 8, view: { follow: "hero", from: "side", distance: 4 }, crop_to: "hero", size: "640x360" });
    const said = text(r);
    expect(said).toMatch(/the pictures are from beside 'hero' \(from side, 4 m away\), not from the game's camera; the first from [-\d.]+, [-\d.]+, [-\d.]+ looking at/);
    expect(said).not.toMatch(/warning: '?hero'? is not on the picture/);
    expect(said).not.toContain("crop_to 'hero' was on none");
    // every picture has the hero on it, and a walk seen from the side changes from tile to tile
    const report = /each picture is the part round 'hero' \((\d+)x(\d+) pixels/.exec(said);
    expect(report, said).not.toBeNull();
    const strip = picture(r);
    const [tw, th] = [Number(report![1]), Number(report![2])];
    expect(tw).toBeLessThan(640);
    // the tiles of the strip: cut them out and compare neighbours
    const cols = Math.round(strip.w / tw) || 1;
    const tile = (i: number) => {
      const out = { w: tw, h: th, data: new Uint8ClampedArray(tw * th * 4) };
      const ox = (i % cols) * Math.floor(strip.w / cols), oy = Math.floor(i / cols) * Math.floor(strip.h / Math.ceil(7 / cols));
      for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) for (let k = 0; k < 4; k++) out.data[(y * tw + x) * 4 + k] = strip.data[((oy + y) * strip.w + ox + x) * 4 + k] ?? 0;
      return out;
    };
    expect(pictureDifference(tile(1), tile(2)).share).toBeGreaterThan(0.01);
    expect(() => at({ view: { follow: "hero", from: "under" } })).toThrow(/"from": "under"; it takes side, right, left, front, back, top, quarter|from/);
    expect(() => at({ view: { folow: "hero" } })).toThrow(/view is \{ "follow": "hero"/);
  });
});

describe("a picture and its twin", () => {
  it("measures how much of a picture changed and where", () => {
    const a = { w: 4, h: 4, data: new Uint8ClampedArray(64).fill(100) };
    const b = { w: 4, h: 4, data: new Uint8ClampedArray(64).fill(100) };
    expect(pictureDifference(a, b)).toEqual({ share: 0, mean: 0, box: null });
    for (const [x, y] of [[1, 2], [2, 3]]) b.data[(y! * 4 + x!) * 4] = 150;
    expect(pictureDifference(a, b)).toEqual({ share: 2 / 16, mean: 50, box: [1, 2, 2, 3] });
  });

  it("says in words what a 3D frame was drawn with", () => {
    expect(renderLine({ three_d: false })).toBeNull();
    const facts = { three_d: true, models: 12, camera: { eye: [0, 5, 10], target: [0, 1, 0], fov: 60 }, light: { direction: [0, -0.7, -0.7], color: [1, 1, 1], ambient: [0.5, 0.5, 0.5] }, shadows: { radius: 22, strength: 0.55, casters: 9 }, fog: null };
    const on = renderLine(facts)!;
    expect(on).toContain("shadows ON (strength 0.55, radius 22 m round the camera's target, 9 of 12 models drawn cast one)");
    expect(on).toContain("the sun is behind the camera, so shadows fall away from it");
    expect(on).toContain("a bright ambient with a low strength makes faint shadows");
    expect(on).toContain("camera eye 0, 5, 10 looking at 0, 1, 0, fov 60");
    expect(renderLine({ ...facts, shadows: null })).toContain("shadows OFF");
    expect(renderLine({ ...facts, light: { ...facts.light, direction: [0, -0.7, 0.7] } })).toContain("the sun is in front of the camera");
  });
});

describe.skipIf(!built)("the test player", () => {
  const game = () => {
    use("project_create", { name: "Yard" });
    use("sprite_write", { name: "box", palette: { a: "#ffffff" }, frames: [["aaaaaaaa", "aaaaaaaa", "aaaaaaaa", "aaaaaaaa", "aaaaaaaa", "aaaaaaaa", "aaaaaaaa", "aaaaaaaa"]] });
    use("write_file", { path: "main.lua", text: 'nova.start("yard")\n' });
    use("write_file", { path: "scenes/yard.lua", text: "return nova.scene {}\n" });
    use("write_file", {
      path: "entities/hero.lua",
      text: "local H = nova.entity { sprite = 'box', tags = { 'hero' }, hp = 3, hurt = 0 }\nfunction H:update(dt)\n  local x, y = self.x, self.y\n  self.x = x + nova.input.axis('move_x') * 120 * dt\n  if self:touching('solid') then self.x = x end\n  self.y = y + nova.input.axis('move_y') * 120 * dt\n  if self:touching('solid') then self.y = y end\n  self.hurt = self.hurt - dt\n  if nova.input.pressed('a') then\n    for _, e in ipairs(nova.all('enemy')) do if self:distance_to(e) < 40 then e:destroy() end end\n  end\nend\nfunction H:on_collide_enemy()\n  if self.hurt > 0 then return end\n  self.hurt = 0.3\n  self.hp = self.hp - 1\n  if self.hp <= 0 then self:destroy() end\nend\nreturn H\n",
    });
    use("write_file", { path: "entities/block.lua", text: "return nova.entity { sprite = 'box', tags = { 'solid' }, sx = 5, sy = 5 }\n" });
    use("write_file", { path: "entities/chest.lua", text: "return nova.entity { sprite = 'box', tags = { 'solid' }, sx = 2, sy = 2 }\n" });
    use("write_file", { path: "entities/bat.lua", text: "local B = nova.entity { sprite = 'box', tags = { 'enemy' }, velocity = false }\nfunction B:update(dt) local h = nova.named('hero') if h then self:move_toward(h, 30 * dt) end end\nreturn B\n" });
    const blocks = [20, 60, 100, 140, 180, 220, 260].map((y) => ({ kind: "block", x: 200, y }));
    use("scene_write", { name: "yard", picture: false, scene: { version: 1, background: [10, 20, 40], objects: [{ kind: "hero", name: "hero", x: 100, y: 100 }, ...blocks, { kind: "chest", name: "chest", x: 320, y: 100 }, { kind: "bat", x: 500, y: 400 }, { kind: "bat", x: 100, y: 450 }] } });
  };

  it("walks round a wall up to a thing, fights, and cannot die when told so", () => {
    game();
    const said = text(use("play", { invincible: true, stop_on_fail: true, route: [{ walk_to: "chest", capture: "at the chest" }, { fight: "enemy", max: 1500, capture: "all beaten" }], print: ["nova.count('enemy')"], size: "320x180" }));
    expect(said).toMatch(/route: step 1: walk_to 'chest': stopped against it after \d+ frames \('hero' is at x [\d.]+, y [\d.]+; its hitbox and that of 'chest' are [\d.]+ units apart\)/);
    expect(said).toMatch(/route: step 2: fight 'enemy': all 2 beaten in \d+ frames with \d+ attacks; 'hero' still has hp 3/);
    expect(said).toMatch(/note: step 1: walk_to found a way round what is solid through \d+ corners/);
    expect(said).toMatch(/note: invincible: 'hero' had hp 3 put back/);
    expect(said).toContain("\"all beaten\": nova.count('enemy') = 0");
    expect(said).not.toContain("warning:");
    expect(said).not.toContain("STOPPED");
  });

  it("stops the route at the step that failed, and says when the strip shows fewer pictures than were taken", () => {
    game();
    const said = text(use("play", { stop_on_fail: true, every: 2, route: [{ walk_to: [300, 100], straight: true, max: 70 }, { lua: "nova.log('later')" }, { wait: 30 }], size: "128x72" }));
    expect(said).toMatch(/STOPPED: the route stopped at step 1, which failed \(stop_on_fail\): 2 later steps were not played/);
    expect(said).toMatch(/warning: step 1: walk_to did not arrive in 70 frames: 'hero' is at x 1[\d.]+, y 100, [\d.]+ units from \[300, 100\]/);
    expect(said).not.toMatch(/f\d+ later/);
    // more pictures than one strip holds: a second strip, nothing left out, and the first lines say so
    expect(said.split("\n").slice(0, 3).join("\n")).toMatch(/36 pictures in 2 film strips of up to 24 \(f2 to f48; f50 to f\d+\): 2 pictures come back, in order\. None is left out/);
    expect(said).not.toContain("PICTURES LEFT OUT");
    // past four strips pictures are left out, and that is the first thing said
    const many = text(use("play", { every: 1, frames: 110, size: "64x64" }));
    expect(many.split("\n")[0]).toMatch(/^WARNING: PICTURES LEFT OUT: the film strips show \d+ of the 110 pictures taken \(every 2nd, and the last\), because 96 is the most that are shown; all 110 are in .*nova-run-[\d-]+\/ as full-size files/);
    const kept = /all 110 are in (\S+) as/.exec(many)![1]!;
    expect(existsSync(join(kept, "f00002.png"))).toBe(true);
    rmSync(kept, { recursive: true, force: true });
  });

  it("draws hitboxes and names over the pictures, and compares a run with its twin", () => {
    game();
    const plain = use("play", { frames: 5, size: "480x270" });
    const boxed = use("play", { frames: 5, size: "480x270", overlay: ["hitboxes", "names"] });
    expect(text(boxed)).toContain("note: overlay: drawn over every picture of this run: hitboxes, names");
    const d = pictureDifference(picture(plain), picture(boxed));
    expect(d.share).toBeGreaterThan(0.001);
    expect(d.share).toBeLessThan(0.2);
    expect(() => use("play", { overlay: ["boxes"] })).toThrow(/overlay has "boxes"; it is a list of "hitboxes", "solids" and "names"/);

    // the same run with the hero hidden: a small part of each picture changes, where the hero is
    const r = use("play", { frames: 5, capture_at: [3], size: "480x270", compare: { lua: "nova.named('hero').visible = false", label: "no hero" } });
    const said = text(r);
    expect(said).toContain("compare: the run again with `no hero` (run once, when the scene is up)");
    const m = /f3: ([\d.]+) % of pixels differ, by \d+ of 255 on average, within x (\d+)\.\.(\d+), y (\d+)\.\.(\d+)/.exec(said)!;
    expect(Number(m[1])).toBeGreaterThan(0);
    expect(Number(m[1])).toBeLessThan(1);
    expect(Number(m[2])).toBeGreaterThanOrEqual(46); // the hero is 8 units wide about x 100 of 960: 48..52 of 480
    expect(Number(m[3])).toBeLessThanOrEqual(53);
    expect(r.content.length).toBe(3); // the words, the run's strip, the twin's strip
    // a difference that changes nothing is said to
    expect(text(use("play", { frames: 3, size: "128x72", compare: "local nothing = 1" }))).toContain("nothing changed in any picture: `local nothing = 1` has no visible effect here");
    expect(() => use("play", { compare: { each_frame: true } })).toThrow(/compare is the Lua that makes the second run different/);
    expect(() => use("play", { compare: { lua: "x = 1", each_frames: true } })).toThrow(/`each_frames` is not an option of compare; did you mean `each_frame`\?/);
  });
});
