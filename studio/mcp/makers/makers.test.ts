import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BLOB_MASKS } from "../../src/lib/autotile";
import { parseScene, tilemaps } from "../../src/lib/scene-model";
import { parseSong } from "../../src/lib/song";
import { parseSheetJson } from "../../src/lib/sprite-doc";
import { parseTileset } from "../../src/lib/tileset";
import { decodePng } from "../draw";
import { call, EXAMPLES } from "../server";
import { CREATURES } from "./creature";
import { ITEM_NAMES } from "./items";
import { PALETTE_NAMES } from "./palettes";
import { MOOD_NAMES } from "./song";
import { PURPOSE_NAMES } from "./sound";
import { PROP_NAMES, TERRAIN_NAMES } from "./tileset";

let dir = "";
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "nova-makers-test-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const text = (r: ReturnType<typeof call>) => (r.content[0] as { text: string }).text;
const use = (name: string, args: Record<string, unknown> = {}, project = dir) => call(name, { project, ...args });
const bytes = (rel: string, project = dir) => readFileSync(join(project, rel));
const sheet = (name: string) => {
  const p = parseSheetJson(bytes(`sprites/${name}.sprite.json`).toString());
  if (!p.ok) throw new Error(p.error);
  return p.json;
};
const tileset = (name: string) => {
  const p = parseTileset(bytes(`sprites/${name}.tileset.json`).toString());
  if (!p.ok) throw new Error(p.error);
  return p.doc;
};
/// The same call in a second folder: what it writes must be the same, byte for byte.
function again(tool: string, args: Record<string, unknown>, files: string[]) {
  const other = mkdtempSync(join(tmpdir(), "nova-makers-again-"));
  try {
    use(tool, args, other);
    for (const f of files) expect(bytes(f, other).equals(bytes(f)), `${f} is the same when made again`).toBe(true);
  } finally {
    rmSync(other, { recursive: true, force: true });
  }
}

const MEADOW_MAP = {
  version: 1,
  tilemaps: [{
    name: "ground", tileset: "tiles", scale: 3, seed: 5,
    paint: { g: "grass", p: "path", w: "water", s: "sand", h: "hedge", T: "tree", f: "fence", b: "bush", D: "door", H: "house_wall", R: "roof" },
    tiles: ["hhhhhhhhhh", "hgggRRRggh", "hgTgHDHggh", "hggggpgggh", "hgwwgpgbgh", "hgwwsppggh", "hgggggfffh", "hhhhhhhhhh"],
  }],
};
const meadow = (): typeof MEADOW_MAP => JSON.parse(JSON.stringify(MEADOW_MAP));

describe("tileset_make and painting with terrains", () => {
  it("makes a named tileset whose terrains have every joining tile, the same for the same seed", () => {
    const said = text(use("tileset_make", { name: "tiles" }));
    expect(said).toMatch(/a tileset of \d+ tiles of 16x16, palette "bright meadow"/);
    const doc = tileset("tiles"), json = sheet("tiles");
    expect(doc.terrains.map((t) => t.name)).toEqual(TERRAIN_NAMES);
    for (const t of doc.terrains) {
      expect(t.tiles).toHaveLength(t.name === "fence" ? 16 : BLOB_MASKS.length);
      expect(new Set(t.tiles).size).toBe(t.tiles.length);
    }
    // every tile has a name, the whole tile of a terrain is the terrain's, props are there, solid ones are marked
    expect(Object.keys(doc.names)).toHaveLength(json.frames!);
    const tileOf = Object.fromEntries(Object.entries(doc.names).map(([k, v]) => [v, Number(k)]));
    for (const name of [...TERRAIN_NAMES, ...PROP_NAMES, "grass_2", "tree@0,-1", "path_edge_n", "water_in_ne"]) expect(tileOf[name], name).toBeGreaterThanOrEqual(0);
    expect(doc.solid).toContain(tileOf.water);
    expect(doc.solid).toContain(tileOf.tree);
    expect(doc.solid).not.toContain(tileOf.grass);
    expect(doc.solid).not.toContain(tileOf.door);
    expect(doc.solid).not.toContain(tileOf["tree@0,-1"]);
    const png = decodePng(bytes("sprites/tiles.png"));
    expect(png.w).toBe(16 * 16);
    again("tileset_make", { name: "tiles" }, ["sprites/tiles.png", "sprites/tiles.tileset.json", "sprites/tiles.sprite.json"]);
    const before = bytes("sprites/tiles.png");
    use("tileset_make", { name: "tiles", seed: 2 });
    expect(bytes("sprites/tiles.png").equals(before)).toBe(false);
  });

  it("takes a palette by name or made up, a tile size, and a choice of terrains and props", () => {
    for (const palette of PALETTE_NAMES) expect(text(use("tileset_make", { name: `t_${palette.replace(/ /g, "_")}`, palette, terrains: ["grass", "water"], props: ["tree"] }))).toContain(`palette "${palette}"`);
    expect(bytes("sprites/t_autumn.png").equals(bytes("sprites/t_snow.png"))).toBe(false);
    expect(text(use("tileset_make", { name: "mine", palette: { base: "autumn", grass: "#88aa33", outline: "#000000" }, terrains: ["grass"], props: [] }))).toContain("grass #88aa33");
    expect(tileset("mine").terrains.map((t) => t.name)).toEqual(["grass"]);
    use("tileset_make", { name: "big", tile: 32, terrains: ["grass", "path", "brick wall"], props: ["tree", "rock"] });
    expect(sheet("big").frame_width).toBe(32);
    expect(tileset("big").terrains.map((t) => t.name)).toEqual(["grass", "path", "brick_wall"]);
    expect(() => use("tileset_make", { name: "x", palette: "neon" })).toThrow(/there is no palette 'neon'.*bright meadow/);
    expect(() => use("tileset_make", { name: "x", terrains: ["lava"] })).toThrow(/'lava'.*It has: grass, sand/);
    expect(() => use("tileset_make", { name: "x", tile: 20 })).toThrow(/16, 24, 32/);
  });

  it("paints a map: joining tiles, variants by seed, solid terrains solid, crowns in front", () => {
    use("tileset_make", { name: "tiles" });
    const said = text(use("scene_write", { name: "meadow", scene: meadow(), picture: false }));
    expect(said).toMatch(/painted "ground": 10 x 8 cells into \d tile layer\(s\) \("ground", "ground_edges"/);
    const parsed = parseScene(bytes("scenes/meadow.scene.json").toString());
    if (!parsed.ok) throw new Error(parsed.error);
    const maps = tilemaps(parsed.scene);
    const layer = (n: string) => maps.find((m) => m.name === n)!;
    expect(maps.map((m) => m.name)).toEqual(expect.arrayContaining(["ground", "ground_edges", "ground_props", "ground_over"]));
    expect(layer("ground").tileset).toEqual({ image: "sprites/tiles.png", tile_width: 16, tile_height: 16, scale: 3 });
    expect(layer("ground_over").depth).toBeLessThan(0);
    const doc = tileset("tiles");
    const nameAt = (n: string, c: number, r: number) => doc.names[String(layer(n).tiles[r]![c])];
    // the pond's top left cell is water with its top and left open, over the grass around it
    expect(nameAt("ground_edges", 2, 4)).toBe("water_edge_nw");
    expect(nameAt("ground", 2, 4)).toMatch(/^grass(_\d)?$/);
    expect(layer("ground_edges").solid).toContain(layer("ground_edges").tiles[4]![2]);
    // the path's cell beside the sand lies over the grass; plain grass is a whole tile, one of its variants
    expect(nameAt("ground", 1, 1)).toMatch(/^grass(_\d)?$/);
    expect(nameAt("ground_edges", 5, 3)).toMatch(/^path_edge_/);
    // a tree: its foot stands on the grass and is solid, its crown is in the layer in front
    expect(nameAt("ground_props", 2, 2)).toMatch(/^tree(_2)?$/);
    expect(nameAt("ground_over", 2, 1)).toMatch(/^tree(_2)?@0,-1$/);
    expect(layer("ground_props").solid).toContain(layer("ground_props").tiles[2]![2]);
    expect(layer("ground_over").solid ?? []).toEqual([]);
    // the door takes the wall's place and is not solid; the wall beside it is
    expect(nameAt("ground", 5, 2)).toBe("door");
    expect(layer("ground").solid).not.toContain(layer("ground").tiles[2]![5]);
    expect(layer("ground").solid).toContain(layer("ground").tiles[2]![4]);
    // a fence joins along its length: the middle piece has fence on both sides
    expect(nameAt("ground_props", 7, 6)).toBe("fence_ew");
    // the same seed paints the same map; another scatters the variants differently
    const first = bytes("scenes/meadow.scene.json").toString();
    use("scene_write", { name: "meadow", scene: meadow(), picture: false });
    expect(bytes("scenes/meadow.scene.json").toString()).toBe(first);
    use("scene_write", { name: "meadow2", scene: { ...meadow(), tilemaps: [{ ...meadow().tilemaps[0], seed: 6 }] }, picture: false });
    expect(bytes("scenes/meadow2.scene.json").toString()).not.toBe(first);
  });

  it("reads a painted scene back as the painted map, so it can be changed and painted again", () => {
    use("tileset_make", { name: "tiles" });
    use("scene_write", { name: "meadow", scene: meadow(), picture: false });
    const preview = text(use("scene_preview", { name: "meadow" }));
    expect(preview).toContain('painted map of "ground"');
    const legend = Object.fromEntries([...preview.matchAll(/"(.)": "([^"]+)"/g)].map((m) => [m[1], m[2]]));
    const rows = preview.split("\n").filter((l) => /^\s+\d+ \S{10}$/.test(l)).slice(-8).map((l) => l.trim().split(" ")[1]!);
    const want = meadow().tilemaps[0]!;
    const words = rows.map((row) => [...row].map((ch) => String(legend[ch]).replace(/ on .*/, "")));
    expect(words).toEqual(want.tiles.map((row) => [...row].map((ch) => (want.paint as Record<string, string>)[ch])));
    // and the ordinary tools still work on what was made: a tile redrawn, one added, the terrains kept
    const n = Object.keys(tileset("tiles").names).length;
    use("sprite_write", { name: "tiles", append: true, palette: { r: "#ff0000" }, frames: [{ shapes: [{ rect: [0, 0, 16, 16], color: "r" }], name: "lava" }] });
    use("sprite_write", { name: "tiles", at: 0, palette: { r: "#ff0000" }, frames: [{ shapes: [{ rect: [4, 4, 8, 8], color: "r" }] }] });
    const doc = tileset("tiles");
    expect(doc.terrains).toHaveLength(TERRAIN_NAMES.length);
    expect(doc.names[String(n)]).toBe("lava");
    // a painted layer may name a hand-made tile too
    use("scene_write", { name: "pit", scene: { version: 1, tilemaps: [{ tileset: "tiles", paint: { g: "grass", L: "lava" }, tiles: ["ggg", "gLg", "ggg"] }] }, picture: false });
    const pit = parseScene(bytes("scenes/pit.scene.json").toString());
    expect(pit.ok && tilemaps(pit.scene)[0]!.tiles[1]![1]).toBe(n);
  });

  it("says what is wrong with a painted map, all at once", () => {
    use("tileset_make", { name: "tiles", terrains: ["grass", "water"], props: ["tree"] });
    const bad = () => use("scene_write", { name: "x", scene: { version: 1, tilemaps: [{ tileset: "tiles", paint: { g: "grass", l: "lava" }, tiles: ["gg", "g?"] }] } });
    expect(bad).toThrow(/paint "l": 'lava' is not in sprites\/tiles.png \(terrains: grass, water; props and tiles: tree\)/);
    expect(() => use("scene_write", { name: "x", scene: { version: 1, tilemaps: [{ tileset: "tiles", paint: { g: "grass" }, tiles: ["gg", "g?g"] }] } })).toThrow(/row 1 has 3 tiles, wanted 2[\s\S]*row 1 column 1: '\?' is not in "paint"/);
    expect(() => use("scene_write", { name: "x", scene: { version: 1, tilemaps: [{ tileset: "nothing", paint: { g: "grass" }, tiles: ["g"] }] } })).toThrow(/there is no sprites\/nothing.png/);
  });
});

describe("character_make, creature_make and items_make", () => {
  const DIRS = ["down", "left", "right", "up"];

  it("makes a character sheet with every animation tagged in four directions, and the feet's hitbox", () => {
    const said = text(use("character_make", { name: "hero", hair: "spiky", hair_color: "red", outfit: "armor", hat: "none", item: "axe" }));
    const json = sheet("hero");
    expect(json.frames).toBe(40);
    expect([json.frame_width, json.frame_height]).toEqual([32, 32]);
    expect(json.tags!.map((t) => t.name)).toEqual(DIRS.flatMap((d) => [`idle_${d}`, `walk_${d}`, `attack_${d}`, `hurt_${d}`]));
    for (const t of json.tags!) {
      expect(t.to - t.from + 1, t.name).toBe(t.name.startsWith("idle") ? 2 : t.name.startsWith("walk") ? 4 : t.name.startsWith("attack") ? 3 : 1);
      expect(t.loop === false, t.name).toBe(/^(attack|hurt)/.test(t.name));
    }
    expect(json.pivot).toEqual({ x: 16, y: 28 });
    expect(json.hitbox).toEqual({ x: 12, y: 23, w: 8, h: 5 });
    expect(json.durations_ms).toHaveLength(40);
    expect(said).toContain("pivot = { 0.5, 0.875 }, hitbox = { -4, -5, 8, 5 }");
    // the four frames of a walk are four different pictures, and left is right mirrored
    const png = decodePng(bytes("sprites/hero.png"));
    const frame = (f: number) => {
      const out: number[] = [];
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) out.push(png.data[((Math.floor(f / 16) * 32 + y) * png.w + (f % 16) * 32 + x) * 4 + 3]! > 0 ? png.data[((Math.floor(f / 16) * 32 + y) * png.w + (f % 16) * 32 + x) * 4]! : -1);
      return out;
    };
    for (const d of [0, 10, 20, 30]) expect(new Set([2, 3, 4, 5].map((f) => frame(d + f).join(","))).size, `walk at ${d}`).toBeGreaterThanOrEqual(3);
    const right = frame(22), left = frame(12);
    expect(left).toEqual(Array.from({ length: 32 * 32 }, (_, i) => right[Math.floor(i / 32) * 32 + (31 - (i % 32))]));
    again("character_make", { name: "hero", hair: "spiky", hair_color: "red", outfit: "armor", hat: "none", item: "axe" }, ["sprites/hero.png", "sprites/hero.sprite.json"]);
    // an ordinary sprite afterwards
    expect(text(use("sprite_write", { name: "hero", at: 0, palette: { r: "#ff0000" }, frames: [{ copy: 1 }] }))).toContain("40 frame(s) of 32x32");
    expect(sheet("hero").tags).toHaveLength(16);
  });

  it("takes every part, both sizes and a palette, and says which words it knows", () => {
    const first = bytes.bind(null);
    use("character_make", { name: "a", size: "24x32", build: "stout", skin: "dark", hair: "long", hair_color: "#222222", outfit: "robe", outfit_color: "purple", trim_color: "gold", hat: "wizard", item: "staff", palette: "night" });
    expect([sheet("a").frame_width, sheet("a").frames]).toEqual([48, 40]);
    expect(sheet("a").pivot).toEqual({ x: 24, y: 42 });
    use("character_make", { name: "b" });
    use("character_make", { name: "c", hat: "helmet" });
    expect(first("sprites/b.png").equals(first("sprites/c.png"))).toBe(false);
    for (const [key, word] of [["hair", "afro"], ["outfit", "suit"], ["hat", "fez"], ["item", "gun"], ["build", "huge"], ["size", "8x8"]]) {
      expect(() => use("character_make", { name: "x", [key!]: word }), key).toThrow(new RegExp(`"${key}" is`));
    }
    expect(() => use("character_make", { name: "x", outfit_color: "mauve" })).toThrow(/'mauve' is not a colour/);
  });

  it("makes every creature with idle, move and a white hit frame, in any colour", () => {
    for (const kind of CREATURES) {
      const said = text(use("creature_make", { name: kind, kind }));
      const json = sheet(kind);
      expect(json.frames, kind).toBe(7);
      expect(json.tags!.map((t) => [t.name, t.from, t.to])).toEqual([["idle", 0, 1], ["move", 2, 5], ["hit", 6, 6]]);
      expect(said).toContain(`sprite = "${kind}", anim = "idle"`);
      const png = decodePng(bytes(`sprites/${kind}.png`));
      let drawn = 0, white = 0, moving = 0;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const o = (y * png.w + 6 * 16 + x) * 4;
        if (png.data[o + 3]) {
          drawn++;
          if (png.data[o] === 255 && png.data[o + 1] === 255 && png.data[o + 2] === 255) white++;
        }
        for (const c of [0, 1, 2, 3]) if (png.data[(y * png.w + 2 * 16 + x) * 4 + c] !== png.data[(y * png.w + 3 * 16 + x) * 4 + c]) moving++;
      }
      expect(drawn, kind).toBeGreaterThan(30);
      expect(white, `${kind}'s hit frame is white`).toBe(drawn);
      expect(moving, `${kind} moves`).toBeGreaterThan(0);
    }
    again("creature_make", { name: "slime", kind: "slime" }, ["sprites/slime.png", "sprites/slime.sprite.json"]);
    use("creature_make", { name: "red", kind: "slime", color: "red", size: 24 });
    expect(sheet("red").frame_width).toBe(24);
    expect(() => use("creature_make", { name: "x", kind: "dragon" })).toThrow(/"kind" is one of slime, bat, skeleton, spider, ghost, beetle/);
  });

  it("makes the item icons, each named, with the coin and the chest as animations", () => {
    const said = text(use("items_make", { name: "items" }));
    const json = sheet("items");
    expect(json.frames).toBe(ITEM_NAMES.length);
    expect(Object.values(tileset("items").names)).toEqual(ITEM_NAMES);
    expect(ITEM_NAMES).toEqual(expect.arrayContaining(["heart_full", "heart_half", "heart_empty", "key", "coin", "gem", "chest_closed", "chest_open", "potion", "sword"]));
    expect(json.tags!.map((t) => t.name)).toEqual(["coin", "chest"]);
    expect(said).toContain('nova.sprite("items", x, y, { frame = 0');
    again("items_make", { name: "items" }, ["sprites/items.png"]);
    expect(text(use("sprite_preview", { name: "items", frame: "gem" }))).toContain('frame 8 ("gem")');
  });
});

describe("sounds and songs by what they are for", () => {
  it("gives a tuned effect for every purpose that passes sound_report, and variants by seed", () => {
    for (const purpose of PURPOSE_NAMES) {
      for (const seed of [1, 2, 3]) {
        const said = text(use("sfx_write", { name: `${purpose}_${seed}`, purpose, seed }));
        expect(said, `${purpose} seed ${seed}`).not.toContain("WARNING");
      }
      expect(bytes(`sounds/${purpose}_1.wav`).equals(bytes(`sounds/${purpose}_2.wav`)), `${purpose}: another seed is another sound`).toBe(false);
    }
    again("sfx_write", { name: "step_grass_2", purpose: "step_grass", seed: 2 }, ["sounds/step_grass_2.wav", "sounds/step_grass_2.sfx.json"]);
    // a purpose is a starting point: params still change it, and the file is an ordinary effect
    use("sfx_write", { name: "low", purpose: "coin", params: { freq: 500 } });
    expect(JSON.parse(bytes("sounds/low.sfx.json").toString()).freq).toBe(500);
    expect(() => use("sfx_write", { name: "x", purpose: "sneeze" })).toThrow(/unknown purpose 'sneeze'. Purposes: step_grass/);
  });

  it("makes a looping song for every mood that passes sound_report and stays an ordinary song", () => {
    for (const mood of MOOD_NAMES) {
      const name = mood.replace(/ /g, "_");
      const said = text(use("song_make", { name, mood }));
      expect(said, mood).not.toContain("WARNING");
      expect(said, mood).toMatch(/loop seam: matches|the end meets the start/);
      const parsed = parseSong(bytes(`music/${name}.song.json`).toString());
      if (!parsed.ok) throw new Error(parsed.error);
      expect(parsed.song.tracks.map((t) => t.name)).toEqual(["melody", "harmony", "bass", "drums"]);
      for (const t of parsed.song.tracks) {
        expect(t.notes.length, `${mood} ${t.name}`).toBeGreaterThan(2);
        expect(t.notes.some((n) => n.step === 0), `${mood} ${t.name} starts on the first step`).toBe(true);
        for (const n of t.notes) expect(n.step + n.len).toBeLessThanOrEqual(parsed.song.length);
      }
      // the bass stays where a small speaker can play it
      expect(Math.min(...parsed.song.tracks[2]!.notes.map((n) => n.pitch))).toBeGreaterThanOrEqual(43);
      // it can be given back to song_write as it is
      expect(() => use("song_write", { name: `${name}_again`, song: bytes(`music/${name}.song.json`).toString() })).not.toThrow();
    }
    again("song_make", { name: "boss", mood: "boss" }, ["music/boss.song.json"]);
    const first = bytes("music/boss.song.json").toString();
    use("song_make", { name: "boss", mood: "boss", seed: 2, key: "A minor", tempo: 170 });
    const second = JSON.parse(bytes("music/boss.song.json").toString());
    expect(second.bpm).toBe(170);
    expect(bytes("music/boss.song.json").toString()).not.toBe(first);
    expect(() => use("song_make", { name: "x", mood: "polka" })).toThrow(/"mood" is one of: "calm village"/);
    expect(() => use("song_make", { name: "x", mood: "boss", key: "H" })).toThrow(/"key" is a note name/);
  }, 120_000);
});

describe("the makers' examples", () => {
  it("each work as given", () => {
    for (const name of ["tileset_make", "character_make", "creature_make", "items_make", "song_make"]) expect(() => use(name, EXAMPLES[name]), name).not.toThrow();
    expect(readdirSync(join(dir, "sprites")).filter((f) => f.endsWith(".png")).sort()).toEqual(["hero.png", "items.png", "slime.png", "tiles.png"]);
    expect(existsSync(join(dir, "music/village.song.json"))).toBe(true);
  });
});

describe("project_create with a template", () => {
  it("copies a starter game under the new name, and still makes a blank project", () => {
    for (const template of ["topdown", "platformer"]) {
      const root = join(dir, template);
      const said = text(use("project_create", { name: `My ${template}`, template }, root));
      expect(said).toContain(`as a copy of examples/starter-${template}`);
      expect(JSON.parse(readFileSync(join(root, "nova.json"), "utf8")).name).toBe(`My ${template}`);
      for (const f of ["main.lua", "entities/hero.lua", "sprites/hero.png", "sprites/tiles.png"]) expect(existsSync(join(root, f)), `${template}/${f}`).toBe(true);
      expect(readdirSync(root)).not.toContain("build");
    }
    // the 3D starter: its models, its scene and the entity files the makers wrote
    const three = join(dir, "three");
    expect(text(use("project_create", { name: "My 3D", template: "3d" }, three))).toContain("as a copy of examples/starter-3d");
    for (const f of ["main.lua", "entities/hero.lua", "entities/ground.lua", "models/hero.glb", "models/ground.glb", "scenes/garden.scene.json", "music/garden.song.json"]) expect(existsSync(join(three, f)), `3d/${f}`).toBe(true);
    expect(readdirSync(three)).not.toContain("build");
    // the platformer keeps its input action for jumping
    expect(JSON.parse(readFileSync(join(dir, "platformer/nova.json"), "utf8")).input.jump).toContain("key:KeyZ");
    use("project_create", { name: "Plain" }, join(dir, "plain"));
    expect(readdirSync(join(dir, "plain")).filter((f) => !f.startsWith(".")).sort()).toEqual(["main.lua", "nova.json"]);
    expect(() => use("project_create", { name: "X", template: "shooter" }, join(dir, "x"))).toThrow(/there is no template 'shooter': "blank", "topdown"/);
    expect(() => use("project_create", { name: "Again", template: "topdown" }, join(dir, "topdown"))).toThrow(/already has a nova.json/);
  });
});
