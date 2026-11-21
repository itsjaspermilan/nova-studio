import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseScene, tilemaps } from "../../src/lib/scene-model";
import { parseTileset } from "../../src/lib/tileset";
import { decodePng } from "../draw";
import { call } from "../server";
import { FEATURE_KINDS } from "./wear-paint";

// Wear on a painted detailed street: the same seed gives the same scene; wear 0 is plain and wear 1 wrecked; no variant
// sits beside itself; nothing lies on what is solid or on a door; pools have no straight sides; the answer says what lies where.

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nova-wear-test-"));
  call("tileset_make", { project: dir, name: "city", palette: "gutter market", style: "detailed" });
}, 60_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const text = (r: ReturnType<typeof call>) => (r.content[0] as { text: string }).text.replace(/^picture: [^\n]*\n/, "");
const STREET = [
  "CCCCHCCCCCMMMMMMMhMM",
  "CCCCCCCCCCMMMMMMMMMM",
  "pppppppppppppppppppp",
  "pppppppppppppppppppp",
  "aaaaaaaaaaaaaaaaaaaa",
  "aaauuaaaaaaaaaamaaaa",
  "aauuuaaaaaaaaaaaaaaa",
  "aaaaaaaaaaaaaauuaaaa",
  "aaaaaaaaaaaaaauuaaaa",
  "aaaaaaaaaaaaaaaaaaaa",
  "pppppppppppppppppppp",
  "CCCCCCCCCCCCCCCCCCCC",
];
const PAINT = { a: "asphalt", p: "pavement", u: "puddle", C: "concrete_wall", M: "metal_wall", H: "shutter", h: "shutter_open", m: "manhole", X: "broken asphalt" };
const doc = () => {
  const p = parseTileset(readFileSync(join(dir, "sprites/city.tileset.json"), "utf8"));
  if (!p.ok) throw new Error(p.error);
  return p.doc;
};
/// Paints the street with these options; returns the answer and the layers by name (as tile names).
function paint(name: string, opts: Record<string, unknown> = {}, rows = STREET) {
  const said = text(call("scene_write", { project: dir, name, picture: false, scene: { version: 1, tilemaps: [{ name: "ground", tileset: "city", scale: 1.5, seed: 4, paint: PAINT, tiles: rows, ...opts }] } }));
  const raw = readFileSync(join(dir, `scenes/${name}.scene.json`), "utf8");
  const parsed = parseScene(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  const names = doc().names;
  const layers = new Map(tilemaps(parsed.scene).map((m) => [m.name!, { solid: new Set(m.solid ?? []), tiles: m.tiles, names: m.tiles.map((row) => row.map((t) => (t < 0 ? "" : names[String(t)] ?? "?"))) }]));
  return { said, raw, layers };
}
const featureCells = (p: ReturnType<typeof paint>) => (p.layers.get("ground_wear")?.names.flat().filter(Boolean).length ?? 0);
const wornCells = (p: ReturnType<typeof paint>) => p.layers.get("ground")!.names.flat().filter((n) => /_worn_/.test(n)).length;

describe("wear on a painted detailed street", { timeout: 60_000 }, () => {
  it("is the same for the same seed and different for another", () => {
    const a = paint("a"), b = paint("b"), c = paint("c", { seed: 9 });
    expect(a.raw).toBe(b.raw);
    expect(c.raw).not.toBe(a.raw);
    expect([...a.layers.keys()].slice(0, 4)).toEqual(["ground", "ground_stains", "ground_wear", "ground_edges"]);
    // the wear lies just above the ground, under the joining tiles
    const parsed = parseScene(a.raw);
    if (!parsed.ok) throw new Error(parsed.error);
    const depth = Object.fromEntries(tilemaps(parsed.scene).map((m) => [m.name, m.depth]));
    expect(depth.ground!).toBeGreaterThan(depth.ground_stains!);
    expect(depth.ground_stains!).toBeGreaterThan(depth.ground_wear!);
    expect(depth.ground_wear!).toBeGreaterThan(depth.ground_edges!);
  });

  it("is plain at wear 0 and wrecked at wear 1", () => {
    const plain = paint("plain", { wear: 0 }), some = paint("some"), wrecked = paint("wrecked", { wear: 1 });
    expect(featureCells(plain)).toBe(0);
    expect(wornCells(plain)).toBe(0);
    expect(plain.layers.has("ground_wear")).toBe(false);
    const floor = STREET.join("").replace(/[^apu]/g, "").length;
    expect(featureCells(some)).toBeGreaterThan(5);
    expect(featureCells(wrecked)).toBeGreaterThan(featureCells(some));
    expect(featureCells(wrecked) + wornCells(wrecked)).toBeGreaterThan(floor * 0.5);
    expect(wrecked.said).toMatch(/pothole/);
  });

  it("never puts a variant beside itself", () => {
    for (const p of [paint("v1"), paint("v2", { seed: 2, wear: 0.7 }), paint("v3", { wear: 0 })]) {
      const g = p.layers.get("ground")!.names, e = p.layers.get("ground_edges")?.names;
      const whole = (c: number, r: number) => /^(asphalt|pavement)(_\d+|_worn_\w+)?$/.test(g[r]?.[c] ?? "") && !e?.[r]?.[c];
      for (let r = 0; r < g.length; r++) for (let c = 0; c < g[0]!.length; c++) {
        if (!whole(c, r)) continue;
        if (whole(c + 1, r)) expect(g[r]![c + 1], `${c},${r} and the cell right of it`).not.toBe(g[r]![c]);
        if (whole(c, r + 1)) expect(g[r + 1]![c], `${c},${r} and the cell below it`).not.toBe(g[r]![c]);
      }
    }
  });

  it("never lays a feature on what is solid or on a door; wall marks only on a wall's face", () => {
    for (const p of [paint("s1", { wear: 1 }), paint("s2", { wear: 1, seed: 11 })]) {
      const w = p.layers.get("ground_wear")!.names, g = p.layers.get("ground")!, props = p.layers.get("ground_props");
      for (let r = 0; r < w.length; r++) for (let c = 0; c < w[0]!.length; c++) {
        const f = w[r]![c]!;
        if (!f) continue;
        const under = g.names[r]![c]!;
        expect(under, `${f} at ${c},${r}`).not.toMatch(/shutter|door/);
        if (/^wear_wall_/.test(f)) expect(under, `${f} at ${c},${r}`).toMatch(/^(concrete|metal)_wall_edge_\w*s/);
        else {
          expect(g.solid.has(g.tiles[r]![c]!), `${f} at ${c},${r} lies on ${under}`).toBe(false);
          expect(props?.tiles[r]?.[c] ?? -1, `${f} at ${c},${r} lies under a prop`).toBe(-1);
        }
      }
    }
  });

  it("gives pools outlines that are not the cells' squares", () => {
    // the tiles: a puddle's edge wanders along its side, and each of its outlines wanders differently
    const d = doc(), png = decodePng(readFileSync(join(dir, "sprites/city.png"))), cols = png.w / 32;
    const tileOf = (n: string) => Number(Object.entries(d.names).find(([, v]) => v === n)![0]);
    const rim = (n: string) => {
      const t = tileOf(n), ox = (t % cols) * 32, oy = Math.floor(t / cols) * 32;
      // for each column, the first row that is wholly opaque water from the open top side
      return Array.from({ length: 24 }, (_, i) => {
        const x = ox + 4 + i;
        for (let y = 0; y < 32; y++) if (png.data[((oy + y) * png.w + x) * 4 + 3] === 255) return y;
        return 32;
      });
    };
    for (const n of ["puddle_edge_n", "puddle_shape2_edge_n", "puddle_shape3_edge_n"]) expect(new Set(rim(n)).size, n).toBeGreaterThan(2);
    expect(rim("puddle_shape2_edge_n")).not.toEqual(rim("puddle_edge_n"));
    // the map: a pool's edge cells mix the outlines
    const p = paint("pools");
    const used = new Set(p.layers.get("ground_edges")!.names.flat().filter((n) => n.startsWith("puddle")).map((n) => (/_shape(\d)/.exec(n)?.[1] ?? "1")));
    expect(used.size).toBeGreaterThan(1);
    // the outlines stay part of the puddle terrain when read back
    const preview = text(call("scene_preview", { project: dir, name: "pools" }));
    expect(preview).toMatch(/"u": "puddle"|: "puddle"/);
  });

  it("says what it laid and where, and scene_preview reads it back", () => {
    const p = paint("told", { wear: 0.6 });
    expect(p.said).toMatch(/wear 0\.6, district gutter market .*worn tiles, \d+ features in "ground_wear"/);
    expect(p.said).toMatch(/^ {4}\w[\w ]* x\d+: \d+,\d+/m);
    const preview = text(call("scene_preview", { project: dir, name: "told" }));
    expect(preview).toMatch(/wear in "ground_wear" \(\d+ features/);
    // the painted map read back is the same map: the wear does not show up as terrains or props
    expect(preview).not.toMatch(/cells hold tiles that are not a terrain/);
  });

  it("takes features to lay or forbid, a district, a damage map and broken ground", () => {
    const only = paint("only", { wear: 1, features: ["markings", "cracks"] });
    const kinds = new Set(only.layers.get("ground_wear")!.names.flat().filter(Boolean).map((n) => n.replace(/^wear_/, "").replace(/[@_].*$/, "")));
    expect([...kinds].every((k) => ["line", "zebra", "stop", "arrow", "bay", "hatch", "crack", "crazed"].includes(k)), [...kinds].join(", ")).toBe(true);
    expect(wornCells(only)).toBe(0); // "variants" were not asked for
    const noLitter = paint("nolitter", { wear: 1, features: ["no litter"] });
    expect(noLitter.layers.get("ground_wear")!.names.flat().some((n) => n.startsWith("wear_litter"))).toBe(false);
    // the Spire: nearly perfect
    const spire = paint("spire", { district: "spire" });
    expect(featureCells(spire)).toBeLessThan(featureCells(paint("market", { district: "gutter market" })));
    // a damage map: the marked corner is wrecked, the cells marked "-" are left alone
    const damage = STREET.map((row, r) => [...row].map((_, c) => (r >= 6 && c >= 14 ? "#" : r === 4 ? "-" : ".")).join(""));
    const dmg = paint("damage", { wear: 0.1, damage });
    const w = dmg.layers.get("ground_wear")!.names, g = dmg.layers.get("ground")!.names;
    const inMarked = w.flatMap((row, r) => row.filter((n, c) => n && r >= 6 && c >= 14)).length + g.flatMap((row, r) => row.filter((n, c) => /_worn_/.test(n) && r >= 6 && c >= 14)).length;
    expect(inMarked).toBeGreaterThan(6);
    expect(w[4]!.filter(Boolean)).toEqual([]);
    // "broken asphalt" in the legend wrecks those cells too
    const broken = paint("broken", { wear: 0 }, STREET.map((row, r) => (r === 8 ? row.replace(/a/g, "X") : row)));
    expect(broken.layers.get("ground")!.names[8]!.filter((n) => /_worn_/.test(n)).length + (broken.layers.get("ground_wear")?.names[8]!.filter(Boolean).length ?? 0)).toBeGreaterThan(5);
    expect(broken.layers.get("ground")!.names[7]!.filter((n) => /_worn_/.test(n))).toEqual([]);
    // rubble and deep holes are solid only when asked
    const solid = paint("solid", { wear: 1, solid_damage: true, seed: 3 }), loose = paint("loose", { wear: 1, seed: 3 });
    expect(loose.layers.get("ground_wear")!.solid.size).toBe(0);
    expect(solid.layers.get("ground_wear")!.solid.size).toBeGreaterThan(0);
    expect(solid.said).toMatch(/\(solid\)/);
  });

  it("lays a rail painted with no ground on the street round it, not on the walls at its ends, and says so", () => {
    const rows = ["CCCCCCCC", "CaaaaaaC", "CrrrrrrC", "CaaaaaaC", "CCCCCCCC"];
    const p = paint("rail", { paint: { a: "asphalt", C: "concrete_wall", r: "tram_rail" }, wear: 0 }, rows);
    expect(p.layers.get("ground")!.names[2]!.slice(1, 7).every((n) => /^asphalt/.test(n)), p.layers.get("ground")!.names[2]!.join(" ")).toBe(true);
    const solid = p.layers.get("ground")!.solid;
    expect(p.layers.get("ground")!.tiles[2]!.slice(1, 7).some((t) => solid.has(t))).toBe(false);
    expect(p.said).toContain(`"r" (tram_rail) has no ground of its own: laid on asphalt, the ground around it`);
    expect(p.said).not.toContain("SOLID");
    // a window set in a wall, with no floor above or below it, still stands in the wall; a solid ground is said loudly
    const wall = paint("window", { paint: { C: "concrete_wall", r: "tram_rail" }, wear: 0 }, ["CCCC", "CrrC", "CCCC"]);
    expect(wall.said).toMatch(/"r" \(tram_rail\) has no ground of its own: laid on concrete_wall \(SOLID\)[^\n]*paint "tram_rail on <ground>"/);
  });

  it("hatches a box only where two roads cross, never a whole paved square", () => {
    const plaza = Array.from({ length: 12 }, () => "a".repeat(20));
    const square = paint("plaza", { wear: 1, features: ["markings"] }, plaza);
    expect(square.layers.get("ground_wear")?.names.flat().some((n) => /^wear_hatch/.test(n)) ?? false).toBe(false);
    const ringed = paint("ringed", { wear: 1, features: ["markings"] }, ["pppppppppppppppppppp", ...plaza.slice(1, 11).map((r) => `p${r.slice(2)}p`), "pppppppppppppppppppp"]);
    expect(ringed.layers.get("ground_wear")?.names.flat().some((n) => /^wear_hatch/.test(n)) ?? false).toBe(false);
    // a crossroads: a road four rows high across, one four columns wide down, pavement in the corners
    const cross = Array.from({ length: 14 }, (_, r) => (r >= 5 && r <= 8 ? "a".repeat(20) : `${"p".repeat(8)}aaaa${"p".repeat(8)}`));
    const hatched = [0.3, 0.5, 0.7].some((wear) => paint(`cross${wear * 10}`, { wear, features: ["markings"] }, cross).layers.get("ground_wear")?.names.flat().some((n) => /^wear_hatch/.test(n)));
    expect(hatched).toBe(true);
  });

  it("refuses what it does not know, all at once", () => {
    const bad = () => paint("bad", { wear: 2, features: ["sparkles"], district: "moon", damage: ["#"] });
    for (const said of [/"wear" is 2/, /'sparkles'/, /no district 'moon'/, /"damage" must be 12 rows of 20/]) expect(bad).toThrow(said);
    expect(FEATURE_KINDS).toContain("potholes");
    // a classic tileset has no wear tiles
    call("tileset_make", { project: dir, name: "old" });
    expect(() => call("scene_write", { project: dir, name: "old", picture: false, scene: { version: 1, tilemaps: [{ tileset: "old", paint: { g: "grass" }, tiles: ["gg"], wear: 0.5 }] } })).toThrow(/need a tileset with wear tiles/);
  });
});
