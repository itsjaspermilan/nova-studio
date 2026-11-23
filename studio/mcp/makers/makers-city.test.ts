// The city kit: its palettes, terrains, figures, creatures and icons in both styles (in a file of its own: makers-kit.ts says why).
import { describe, expect, it } from "vitest";
import { BLOB_MASKS } from "../../src/lib/autotile";
import { parseScene, tilemaps } from "../../src/lib/scene-model";
import { decodePng } from "../draw";
import { CITY_HATS, CITY_ITEMS, CITY_OUTFITS } from "./character";
import { HD_ANIMS } from "./character-hd";
import { MIMIC_X, MIMIC_Y } from "./creatures-hd";
import { CITY_CREATURE_NAMES } from "./creature";
import { CITY_ITEM_NAMES } from "./items";
import { accentIn, CITY_DIRS, makersFolder } from "./makers-kit";
import { unlessPassedBefore } from "../test-cache";
import { CITY_PALETTES, paletteOf } from "./palettes";
import { CITY_PROP_NAMES, CITY_TERRAIN_NAMES } from "./tileset";

const { text, use, bytes, sheet, tileset } = makersFolder();

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
    it(`gives every city outfit, headgear and item all its animations in the ${style} style`, (ctx) => {
      const passed = unlessPassedBefore(ctx);
      const hd = style === "detailed";
      const per = hd ? HD_ANIMS.map((x) => x[0]) : ["idle", "walk", "attack", "hurt"];
      const counts: Record<string, number> = hd ? { idle: 4, walk: 6, attack: 4, hurt: 2, roll: 5, tell: 2, run: 8, dash: 4 } : { idle: 2, walk: 4, attack: 3, hurt: 1 };
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
      passed();
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
