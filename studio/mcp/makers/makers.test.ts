import { createHash } from "node:crypto";
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
import { CITY_HATS, CITY_ITEMS, CITY_OUTFITS, HATS, ITEMS, OUTFITS } from "./character";
import { HD_ANIMS, HD_ARCHETYPES, HD_FRAME, HD_HATS_MORE, HD_HITBOX, HD_ITEMS_MORE, HD_OUTFITS_MORE, HD_PIVOT } from "./character-hd";
import { MIMIC_X, MIMIC_Y } from "./creatures-hd";
import { CITY_CREATURE_NAMES, CLASSIC_CREATURES } from "./creature";
import { CITY_ITEM_NAMES, CLASSIC_ITEM_NAMES } from "./items";
import { CITY_PALETTES, PALETTE_NAMES, paletteOf } from "./palettes";
import { MOOD_NAMES } from "./song";
import { PURPOSE_NAMES } from "./sound";
import { CITY_PROP_NAMES, CITY_TERRAIN_NAMES, CLASSIC_PROP_NAMES, CLASSIC_TERRAIN_NAMES } from "./tileset";

let dir = "";
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "nova-makers-test-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));
// (the first line of an answer with a picture is its path: the tests read what follows it; one test checks the line)
const text = (r: ReturnType<typeof call>) => (r.content[0] as { text: string }).text.replace(/^picture: [^\n]*\n/, "");
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
    expect(doc.terrains.map((t) => t.name)).toEqual(CLASSIC_TERRAIN_NAMES);
    for (const t of doc.terrains) {
      expect(t.tiles).toHaveLength(t.name === "fence" ? 16 : BLOB_MASKS.length);
      expect(new Set(t.tiles).size).toBe(t.tiles.length);
    }
    // every tile has a name, the whole tile of a terrain is the terrain's, props are there, solid ones are marked
    expect(Object.keys(doc.names)).toHaveLength(json.frames!);
    const tileOf = Object.fromEntries(Object.entries(doc.names).map(([k, v]) => [v, Number(k)]));
    for (const name of [...CLASSIC_TERRAIN_NAMES, ...CLASSIC_PROP_NAMES, "grass_2", "tree@0,-1", "path_edge_n", "water_in_ne"]) expect(tileOf[name], name).toBeGreaterThanOrEqual(0);
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
    expect(doc.terrains).toHaveLength(CLASSIC_TERRAIN_NAMES.length);
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
    for (const [key, word] of [["hair", "afro"], ["outfit", "kilt"], ["hat", "fez"], ["item", "gun"], ["build", "huge"], ["size", "8x8"]]) {
      expect(() => use("character_make", { name: "x", [key!]: word }), key).toThrow(new RegExp(`"${key}" is`));
    }
    expect(() => use("character_make", { name: "x", outfit_color: "mauve" })).toThrow(/'mauve' is not a colour/);
  });

  it("makes every creature with idle, move and a white hit frame, in any colour", () => {
    for (const kind of CLASSIC_CREATURES) {
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
    expect(json.frames).toBe(CLASSIC_ITEM_NAMES.length);
    expect(Object.values(tileset("items").names)).toEqual(CLASSIC_ITEM_NAMES);
    expect(CLASSIC_ITEM_NAMES).toEqual(expect.arrayContaining(["heart_full", "heart_half", "heart_empty", "key", "coin", "gem", "chest_closed", "chest_open", "potion", "sword"]));
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
        // built like a produced sound: layered, and not one the report calls toy-like
        expect(said, `${purpose} seed ${seed}`).not.toContain("toy-like");
        expect(JSON.parse(bytes(`sounds/${purpose}_${seed}.sfx.json`).toString()).layers.length, purpose).toBeGreaterThan(1);
      }
      expect(bytes(`sounds/${purpose}_1.wav`).equals(bytes(`sounds/${purpose}_2.wav`)), `${purpose}: another seed is another sound`).toBe(false);
    }
    again("sfx_write", { name: "step_grass_2", purpose: "step_grass", seed: 2 }, ["sounds/step_grass_2.wav", "sounds/step_grass_2.sfx.json"]);
    // a purpose is a starting point: the finish and the layers still change it, and the file is an ordinary effect
    use("sfx_write", { name: "low", purpose: "coin", params: { volume: 0.3, reverb: 0.4 } });
    expect(JSON.parse(bytes("sounds/low.sfx.json").toString())).toMatchObject({ volume: 0.3, reverb: 0.4 });
    // the plain voice's keys would change nothing in a layered effect: refused, not ignored
    expect(() => use("sfx_write", { name: "low", purpose: "coin", params: { freq: 500 } })).toThrow(/made of layers.*"freq" would change nothing/);
    // the old purposes are all still there, with the new ones
    for (const p of ["step_grass", "step_stone", "sword_swing", "hit", "hurt", "pickup", "coin", "door", "chest_open", "jump", "land", "ui_move", "ui_select", "enemy_die", "locked", "powerup", "explosion", "laser", "heavy_hit", "whoosh", "shot", "zap", "tell", "alarm", "death", "metal_hit", "glass"]) expect(PURPOSE_NAMES).toContain(p);
    // a misspelt key, of the effect or of a layer, is refused with the nearest one
    expect(() => use("sfx_write", { name: "x", params: { revrb: 0.2 } })).toThrow(/"revrb", which the synth does not have \(did you mean "reverb"\?\)/);
    expect(() => use("sfx_write", { name: "x", params: { layers: [{ wave: "noise", cutof: 300 }] } })).toThrow(/layers\[0\] has "cutof", which a layer does not have \(did you mean "cutoff"\?\)/);
    // a level to match: the volume is found for it
    const matched = text(use("sfx_write", { name: "quiet_hit", purpose: "hit", loudness: -24 }));
    expect(matched).toMatch(/volume [\d.]+ for loudness -2[34]\.\d \(asked -24\)/);
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
      expect(parsed.song.tracks.map((t) => t.name).filter((n) => n !== "arp")).toEqual(["melody", "harmony", "bass", "drums"]);
      expect(parsed.song.tracks.some((t) => t.name === "arp"), mood).toBe(mood.startsWith("synthwave"));
      // the fuller voices, not the chip voice and the chip kit: and the report finds nothing to advise
      expect(parsed.song.tracks.find((t) => t.name === "bass")!.wave, mood).toBe("saw");
      expect(["studio", "punch"]).toContain(parsed.song.tracks.find((t) => t.kind === "drums")!.kit);
      expect(said, mood).not.toContain("advice:");
      for (const t of parsed.song.tracks) {
        expect(t.notes.length, `${mood} ${t.name}`).toBeGreaterThan(2);
        expect(t.notes.some((n) => n.step === 0), `${mood} ${t.name} starts on the first step`).toBe(true);
        for (const n of t.notes) expect(n.step + n.len).toBeLessThanOrEqual(parsed.song.length);
      }
      // the bass stays where a small speaker can play it
      expect(Math.min(...parsed.song.tracks.find((t) => t.name === "bass")!.notes.map((n) => n.pitch))).toBeGreaterThanOrEqual(43);
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
    // the racing starter: the car, its engine (loops and profile), the road and land, the scene
    const racing = join(dir, "racing");
    expect(text(use("project_create", { name: "My Racer", template: "racing" }, racing))).toContain("as a copy of examples/starter-racing");
    for (const f of ["main.lua", "entities/car.lua", "scenes/race.lua", "scenes/race.scene.json", "models/car.glb", "models/road_ring.glb", "models/land.glb", "engines/car.lua", "sounds/eng_car_1.wav", "sounds/tyre_road.wav", "textures/road.png"]) expect(existsSync(join(racing, f)), `racing/${f}`).toBe(true);
    expect(JSON.parse(readFileSync(join(racing, "nova.json"), "utf8")).input.throttle).toContain("axis:r2");
    // the platformer keeps its input action for jumping
    expect(JSON.parse(readFileSync(join(dir, "platformer/nova.json"), "utf8")).input.jump).toContain("key:KeyZ");
    use("project_create", { name: "Plain" }, join(dir, "plain"));
    expect(readdirSync(join(dir, "plain")).filter((f) => !f.startsWith(".")).sort()).toEqual(["main.lua", "nova.json"]);
    expect(() => use("project_create", { name: "X", template: "shooter" }, join(dir, "x"))).toThrow(/there is no template 'shooter': "blank", "topdown"/);
    expect(() => use("project_create", { name: "Again", template: "topdown" }, join(dir, "topdown"))).toThrow(/already has a nova.json/);
  });
});

describe("the makers' first look stays the same, byte for byte", () => {
  it("makes what it made before the city kit, for every old palette, part and creature", () => {
    // classic-hashes.json: what each of these calls wrote before the city palettes and the detailed style were added
    const want = JSON.parse(readFileSync(join(__dirname, "classic-hashes.json"), "utf8")) as Record<string, string>;
    const calls = new Map<string, string[]>();
    for (const k of Object.keys(want)) {
      const tool = k.slice(0, k.indexOf(" ")), file = k.slice(k.lastIndexOf(" ") + 1), args = k.slice(tool.length + 1, k.length - file.length - 1);
      calls.set(`${tool} ${args}`, [...(calls.get(`${tool} ${args}`) ?? []), file]);
    }
    for (const [call, files] of calls) {
      const tool = call.slice(0, call.indexOf(" ")), args = JSON.parse(call.slice(tool.length + 1));
      if (tool === "scene_write") use("tileset_make", { name: "tiles" });
      use(tool, args);
      for (const f of files) expect(createHash("sha256").update(bytes(f)).digest("hex").slice(0, 16), `${call} ${f}`).toBe(want[`${call} ${f}`]);
    }
  }, 60_000);
});

/// Whether a picture (or a part of it) has the colour in it: exactly, or within `near` (light blended over what is under it).
const accentIn = (png: { w: number; h: number; data: Uint8Array }, hexColour: string, x0 = 0, y0 = 0, w = png.w, h = png.h, near = 0) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hexColour.slice(i, i + 2), 16));
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const o = (y * png.w + x) * 4;
    if (png.data[o + 3]! > 0 && Math.abs(png.data[o]! - r!) + Math.abs(png.data[o + 1]! - g!) + Math.abs(png.data[o + 2]! - b!) <= near) return true;
  }
  return false;
};
const CITY_DIRS = ["down", "left", "right", "up"];

describe("the city kit", () => {
  it("has four district palettes, each with two accents, and takes accents in a palette of your own", () => {
    expect(CITY_PALETTES).toEqual(["gutter market", "bloom labs", "hollow line", "spire"]);
    for (const name of CITY_PALETTES) {
      const p = paletteOf(name);
      expect(p.city, name).toBe(true);
      expect(p.accent).toHaveLength(2);
      expect(p.accent[0][2], name).not.toEqual(p.accent[1][2]);
    }
    expect(paletteOf("market").name).toBe("gutter market");
    const mine = paletteOf({ base: "gutter market", accent: "#00ff00", accent2: "#0000ff" });
    expect([mine.accent[0][2], mine.accent[1][2]]).toEqual([[0, 255, 0, 255], [0, 0, 255, 255]]);
    expect(() => paletteOf({ base: "spire", neon: "#ffffff" })).toThrow(/"neon", which is not a material/);
  });

  for (const style of ["classic", "detailed"]) {
    it(`makes the city's terrains with every joining tile and name, and its props, in the ${style} style`, () => {
      const said = text(use("tileset_make", { name: "city", palette: "gutter market", style }));
      const t = style === "detailed" ? 32 : 16;
      expect(said).toContain(`tiles of ${t}x${t}`);
      const doc = tileset("city");
      expect(doc.terrains.map((x) => x.name)).toEqual(CITY_TERRAIN_NAMES);
      const tileOf = Object.fromEntries(Object.entries(doc.names).map(([k, v]) => [v, Number(k)]));
      for (const terrain of doc.terrains) {
        const edges = ["tram_rail", "neon_strip", "neon_strip2"].includes(terrain.name);
        expect(terrain.tiles, terrain.name).toHaveLength(edges ? 16 : BLOB_MASKS.length);
        expect(new Set(terrain.tiles).size, terrain.name).toBe(terrain.tiles.length);
        for (const n of terrain.tiles) expect(doc.names[String(n)], `${terrain.name} tile ${n} has a name`).toMatch(new RegExp(`^${terrain.name}`));
      }
      for (const name of [...CITY_TERRAIN_NAMES, ...CITY_PROP_NAMES, "asphalt_2", "puddle_edge_n", "pavement_edge_s", "stall@1,0", "stall@0,-1", "vending_machine@0,-1", "sign_bowl@0,-1"]) expect(tileOf[name], name).toBeGreaterThanOrEqual(0);
      for (const solid of ["concrete_wall", "glass_wall", "metal_wall", "gap", "stall", "stall@1,0", "vending_machine", "explosive_barrel", "shutter"]) expect(doc.solid, solid).toContain(tileOf[solid]);
      for (const open of ["asphalt", "puddle", "tram_rail", "neon_strip", "shutter_open", "vent", "sign_bowl", "stall@0,-1"]) expect(doc.solid, open).not.toContain(tileOf[open]);
      // what glows has its accent in it: the strips and the signs (accent 1 or 2 as their description says)
      const png = decodePng(bytes("sprites/city.png")), cols = png.w / t;
      const tileHas = (name: string, colour: string) => accentIn(png, colour, (tileOf[name]! % cols) * t, Math.floor(tileOf[name]! / cols) * t, t, t, t === 32 ? 80 : 0);
      expect(tileHas("neon_strip", "#ff3fa4")).toBe(true);
      expect(tileHas("neon_strip2", "#35e6ff")).toBe(true);
      for (const [sign, colour] of [["sign_bowl@0,-1", "#ff3fa4"], ["sign_arrow@0,-1", "#35e6ff"], ["sign_cross@0,-1", "#35e6ff"]]) expect(tileHas(sign!, colour!), sign).toBe(true);
      // and it paints: a street with a kerb, a puddle, a rail, a stall and a sign
      use("scene_write", { name: "street", scene: { version: 1, tilemaps: [{ tileset: "city", scale: t === 32 ? 1.5 : 3, paint: { a: "asphalt", p: "pavement", u: "puddle", r: "tram_rail", S: "stall", n: "sign_bowl", C: "concrete_wall" }, tiles: ["CCCC", "pSpp", "anaa", "auua", "rrrr"] }] }, picture: false });
      const scene = parseScene(bytes("scenes/street.scene.json").toString());
      if (!scene.ok) throw new Error(scene.error);
      expect(tilemaps(scene.scene).map((m) => m.name)).toEqual(expect.arrayContaining(["ground", "ground_edges", "ground_props", "ground_over"]));
    }, 60_000);
  }

  it("refuses a detailed tileset of what has no detailed drawing, and another tile size", () => {
    expect(() => use("tileset_make", { name: "x", style: "detailed", terrains: ["grass"] })).toThrow(/detailed style is drawn for the city: 'grass'/);
    expect(() => use("tileset_make", { name: "x", style: "detailed", tile: 16 })).toThrow(/drawn at 32 pixels/);
    expect(() => use("tileset_make", { name: "x", style: "fancy" })).toThrow(/"style" is "classic"/);
  });

  for (const style of ["classic", "detailed"]) {
    it(`gives every city outfit, headgear and item all its animations in the ${style} style`, () => {
      const hd = style === "detailed";
      const per = hd ? HD_ANIMS.map((x) => x[0]) : ["idle", "walk", "attack", "hurt"];
      const counts: Record<string, number> = hd ? { idle: 4, walk: 6, attack: 4, hurt: 2, roll: 5, tell: 2, run: 8 } : { idle: 2, walk: 4, attack: 3, hurt: 1 };
      const parts = [...CITY_OUTFITS.map((o) => ({ outfit: o })), ...CITY_HATS.map((h) => ({ hat: h })), ...CITY_ITEMS.map((i) => ({ item: i }))];
      for (const part of parts) {
        use("character_make", { name: "c", palette: "gutter market", style, glow_color: "2", ...part });
        const json = sheet("c");
        expect(json.tags!.map((x) => x.name), JSON.stringify(part)).toEqual(CITY_DIRS.flatMap((d) => per.map((p) => `${p}_${d}`)));
        for (const tag of json.tags!) expect(tag.to - tag.from + 1, tag.name).toBe(counts[tag.name.split("_")[0]!]);
        expect(json.frame_width).toBe(hd ? 96 : 32);
      }
      // a baton's swing leaves an arc in the glow colour (accent 2 here)
      use("character_make", { name: "b", palette: "gutter market", style, item: "baton", glow_color: "2" });
      const png = decodePng(bytes("sprites/b.png")), f = hd ? 96 : 32, attack = sheet("b").tags!.find((x) => x.name === "attack_right")!;
      const cyanish = (n: number) => {
        let found = false;
        for (let y = 0; y < f && !found; y++) for (let x = 0; x < f; x++) {
          const o = ((Math.floor(n / 16) * f + y) * png.w + (n % 16) * f + x) * 4;
          if (png.data[o + 3]! > 60 && png.data[o]! < 140 && png.data[o + 1]! > 180 && png.data[o + 2]! > 200) found = true;
        }
        return found;
      };
      expect(cyanish(attack.from + 1) || cyanish(attack.from + 2)).toBe(true);
    }, 180_000);
  }

  for (const style of ["classic", "detailed"]) {
    it(`makes every city creature with its states, a tell and a white hit frame in the ${style} style`, () => {
      for (const kind of CITY_CREATURE_NAMES) {
        use("creature_make", { name: kind, kind, palette: "gutter market", style });
        const json = sheet(kind), names = json.tags!.map((t) => t.name);
        expect(names, kind).toEqual(expect.arrayContaining(["tell", "hit"]));
        expect(names.includes("idle"), kind).toBe(true);
        expect(names.some((n) => ["move", "turn", "open", "armed"].includes(n)), `${kind} has a state that moves`).toBe(true);
        const hit = json.tags!.find((t) => t.name === "hit")!, n = json.frame_width!;
        const png = decodePng(bytes(`sprites/${kind}.png`)), cols = json.columns!;
        let firm = 0, white = 0;
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
          const o = ((Math.floor(hit.from / cols) * n + y) * png.w + (hit.from % cols) * n + x) * 4;
          if (png.data[o + 3]! > 200) {
            firm++;
            if (png.data[o] === 255 && png.data[o + 1] === 255 && png.data[o + 2] === 255) white++;
          }
        }
        expect(firm, kind).toBeGreaterThan(20);
        expect(white, `${kind}'s hit frame is white`).toBe(firm);
      }
      // shut, the mimic is the vending machine tile, pixel for pixel
      const t = style === "detailed" ? 32 : 16, [mx, my] = style === "detailed" ? [MIMIC_X, MIMIC_Y] : [8, 0];
      use("tileset_make", { name: "vm", palette: "gutter market", style, terrains: [], props: ["vending_machine"] });
      const tiles = decodePng(bytes("sprites/vm.png")), mimic = decodePng(bytes("sprites/vending_mimic.png"));
      for (let y = 0; y < 2 * t; y++) for (let x = 0; x < t; x++) {
        const tile = y < t ? 1 : 0, o = ((y % t) * tiles.w + tile * t + x) * 4, m = ((y + my) * mimic.w + mx + x) * 4;
        expect([...mimic.data.subarray(m, m + 4)], `pixel ${x}, ${y}`).toEqual([...tiles.data.subarray(o, o + 4)]);
      }
    }, 180_000);
  }

  it("draws a detailed creature facing four ways when asked, and keeps the plain names for the side view", () => {
    use("creature_make", { name: "side", kind: "rat_drone", palette: "gutter market", style: "detailed" });
    use("creature_make", { name: "four", kind: "rat_drone", palette: "gutter market", style: "detailed", facings: true });
    const side = sheet("side"), four = sheet("four");
    expect(side.frames).toBe(12); // (idle 4, move 6, tell, hit: as before)
    expect(four.frames).toBe(4 * 11 + 1);
    const tag = (j: typeof four, name: string) => j.tags!.find((t) => t.name === name)!;
    for (const name of ["idle_down", "idle_left", "idle_right", "idle_up", "move_down", "move_up", "tell_down", "tell_up", "idle", "move", "tell", "hit"]) expect(tag(four, name), name).toBeDefined();
    expect(tag(four, "move")).toEqual({ ...tag(four, "move_right"), name: "move" });
    // the right-facing frames are the side view's; facing down is another picture
    const a = decodePng(bytes("sprites/side.png")), b = decodePng(bytes("sprites/four.png")), n = four.frame_width!;
    const px = (png: typeof a, cols: number, f: number) => Array.from({ length: n * n }, (_, k) => png.data[((Math.floor(f / cols) * n + Math.floor(k / n)) * png.w + (f % cols) * n + (k % n)) * 4 + 3]).join(",");
    expect(px(b, four.columns!, tag(four, "move_right").from)).toBe(px(a, side.columns!, tag(side, "move").from));
    expect(px(b, four.columns!, tag(four, "move_down").from)).not.toBe(px(b, four.columns!, tag(four, "move_right").from));
    expect(text(use("creature_make", { name: "four", kind: "rat_drone", palette: "gutter market", style: "detailed", facings: true }))).toMatch(/It faces four ways/);
    expect(() => use("creature_make", { name: "x", kind: "rat_drone", facings: true })).toThrow(/"facings": a creature that faces four ways is drawn in the detailed style/);
    expect(() => use("creature_make", { name: "x", kind: "vending_mimic", style: "detailed", facings: true })).toThrow(/is drawn whole, from one side only/);
  }, 120_000);

  for (const style of ["classic", "detailed"]) {
    it(`makes the city's icons, every one named, in the ${style} style`, () => {
      use("items_make", { name: "icons", palette: "gutter market", style });
      expect(Object.values(tileset("icons").names)).toEqual(CITY_ITEM_NAMES);
      const n = style === "detailed" ? 32 : 16;
      expect(sheet("icons").frame_width).toBe(n);
      expect(sheet("icons").tags!.map((t) => t.name)).toEqual(["prompt"]);
      expect(accentIn(decodePng(bytes("sprites/icons.png")), "#35e6ff", 3 * n, 0, n, n), "a full charge pip glows in accent 2").toBe(true);
      use("items_make", { name: "mixed", items: ["coin", "keycard", "prompt_ring", "prompt_ring_2"] });
      expect(Object.values(tileset("mixed").names)).toEqual(["coin", "keycard", "prompt_ring", "prompt_ring_2"]);
      expect(() => use("items_make", { name: "x", items: ["laser"] })).toThrow(/'laser', which the maker does not have/);
    }, 60_000);
  }
});

describe("the detailed people", () => {
  /// One frame of a sheet as its own pixels.
  const frameOf = (png: { w: number; data: Uint8Array }, json: { columns?: number; frame_width: number; frame_height: number }, n: number) => {
    const c = json.columns!, fw = json.frame_width, fh = json.frame_height, out = new Uint8Array(fw * fh * 4);
    for (let y = 0; y < fh; y++) out.set(png.data.subarray(((Math.floor(n / c) * fh + y) * png.w + (n % c) * fw) * 4, ((Math.floor(n / c) * fh + y) * png.w + (n % c) * fw + fw) * 4), y * fw * 4);
    return out;
  };
  /// The share of a frame's edge pixels (solid, beside see-through) that are not dark: an outline is closed when it is
  /// small. A little light is allowed: the glow round a lit baton or visor spills over the outline on purpose.
  const lightEdge = (f: Uint8Array, w: number, h: number) => {
    let edge = 0, light = 0;
    const a = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : f[(y * w + x) * 4 + 3]!);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (a(x, y) < 250 || ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => a(x + dx!, y + dy!) < 60)) continue;
      edge++;
      const o = (y * w + x) * 4;
      if (Math.max(f[o]!, f[o + 1]!, f[o + 2]!) > 100) light++;
    }
    return edge ? light / edge : 0;
  };

  it("makes the runner and every enemy archetype: every animation, the frame, the feet's box, closed outlines", () => {
    const counts = Object.fromEntries(HD_ANIMS.map(([n, c]) => [n, c]));
    expect(counts).toEqual({ idle: 4, walk: 6, attack: 4, hurt: 2, roll: 5, tell: 2, run: 8 });
    for (const [name, recipe] of Object.entries(HD_ARCHETYPES)) {
      const said = text(use("character_make", { name, style: "detailed", ...recipe }));
      expect(said, name).toContain("hitbox = { -7, -8, 14, 8 }");
      const json = sheet(name);
      expect(json.frame_width, name).toBe(HD_FRAME);
      expect(json.frame_height, name).toBe(HD_FRAME);
      expect(json.hitbox, name).toEqual(HD_HITBOX);
      expect(json.pivot, name).toEqual(HD_PIVOT);
      expect(json.tags!.map((t) => t.name), name).toEqual(CITY_DIRS.flatMap((d) => HD_ANIMS.map(([a]) => `${a}_${d}`)));
      for (const t of json.tags!) expect(t.to - t.from + 1, `${name} ${t.name}`).toBe(counts[t.name.split("_")[0]!]);
      expect(json.frames, name).toBe(4 * 31);
      if (recipe.hologram) continue; // light, not a body: no outline by design
      const png = decodePng(bytes(`sprites/${name}.png`));
      // the frames without light laid over the edge (an arc, a streak, the tell's flash): idle, walk, hurt
      for (const t of json.tags!.filter((x) => /^(idle|walk|hurt|run)_/.test(x.name))) for (let n = t.from; n <= t.to; n++) {
        expect(lightEdge(frameOf(png, json, n), HD_FRAME, HD_FRAME), `${name} frame ${n} (${t.name})`).toBeLessThan(0.06);
      }
      // the figure stands in its frame: something solid in the middle, nothing touching the frame's edge
      const idle = frameOf(png, json, 0);
      let edgeHit = 0;
      for (let k = 0; k < HD_FRAME; k++) for (const [x, y] of [[k, 0], [k, HD_FRAME - 1], [0, k], [HD_FRAME - 1, k]]) if (idle[(y! * HD_FRAME + x!) * 4 + 3]! > 0) edgeHit++;
      expect(edgeHit, `${name} touches its frame's edge`).toBe(0);
    }
  }, 240_000);

  it("draws every part name of both styles, and says what is wrong", () => {
    for (const part of [...OUTFITS.map((o) => ({ outfit: o })), ...HD_OUTFITS_MORE.map((o) => ({ outfit: o })), ...HATS.map((h) => ({ hat: h })), ...HD_HATS_MORE.map((h) => ({ hat: h })), ...ITEMS.map((i) => ({ item: i })), ...HD_ITEMS_MORE.map((i) => ({ item: i }))]) {
      use("character_make", { name: "p", style: "detailed", palette: "gutter market", ...part });
      expect(sheet("p").frames, JSON.stringify(part)).toBe(124);
    }
    use("character_make", { name: "v", style: "detailed", hat: "visor", visor: "down", arms: 4, stance: "proud", pose: "wide", expression: "smile", skin: "chrome" });
    expect(() => use("character_make", { name: "x", style: "detailed", arms: 3 })).toThrow(/"arms" is 2, 4, 6/);
    expect(() => use("character_make", { name: "x", style: "detailed", stance: "slouch" })).toThrow(/"stance" is one of upright/);
    expect(() => use("character_make", { name: "x", style: "detailed", expression: "sad" })).toThrow(/"expression" is one of/);
    // the classic style keeps its own lists
    expect(() => use("character_make", { name: "x", outfit: "bellhop" })).toThrow(/"outfit" is one of/);
  }, 240_000);
});
