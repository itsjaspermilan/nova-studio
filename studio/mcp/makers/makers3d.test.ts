import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseModel } from "../../src/lib/model-doc";
import { expandModel } from "../modelkit";
import { call } from "../server";
import { CHARACTER3D, makeCharacter3d } from "./character3d";
import { CREATURES3D, makeCreature3d } from "./creature3d";
import { makeGround } from "./ground3d";
import { PALETTE_NAMES } from "./palettes";
import { makeProp, PROP_KINDS, propEntity } from "./prop3d";

const built = existsSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../target/release/nova"));

let dir = "";
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "nova-makers3d-test-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));
// (the first line of an answer with a picture is its path: the tests read what follows it; one test checks the line)
const text = (r: ReturnType<typeof call>) => (r.content[0] as { text: string }).text.replace(/^picture: [^\n]*\n/, "");
const use = (name: string, args: Record<string, unknown> = {}, project = dir) => call(name, { project, ...args });
const bytes = (rel: string, project = dir) => readFileSync(join(project, rel));

/// A made model as model_write would take it: tubes and walks expanded, then read by the editor's own parser.
function parsed(model: unknown) {
  const p = parseModel(JSON.stringify(expandModel(model as Record<string, unknown>).model));
  if (!p.ok) throw new Error(p.error);
  return p.doc;
}
const points = (model: any): number[][] => {
  const out: number[][] = [];
  const visit = (parts: any[], at: number[]) => {
    for (const p of parts) {
      const o = [at[0]! + p.origin[0], at[1]! + p.origin[1], at[2]! + p.origin[2]];
      for (const c of p.cubes) for (const v of c.verts ?? []) out.push([(o[0]! + v[0]) / 16, (o[1]! + v[1]) / 16, (o[2]! + v[2]) / 16]);
      visit(p.children ?? [], o);
    }
  };
  visit(model.parts, [0, 0, 0]);
  return out;
};
/// The row of a clip strip's answer that gives the lowest point of the whole model at each moment.
const lowest = (said: string): number[] => /whole model\s+lowest\s+([-\d. ]+)/.exec(said)![1]!.trim().split(/\s+/).map(Number);

describe("prop3d_make", () => {
  it("makes every kind the same again for a seed, another for another seed, standing on the ground with what it blocks", () => {
    for (const kind of PROP_KINDS) {
      const a = makeProp({ kind, seed: 3 }), b = makeProp({ kind, seed: 3 }), c = makeProp({ kind, seed: 4 });
      expect(JSON.stringify(a.model), kind).toBe(JSON.stringify(b.model));
      if (kind !== "coin") expect(JSON.stringify(a.model), `${kind} with another seed`).not.toBe(JSON.stringify(c.model));
      const doc = parsed(a.model);
      expect(doc.parts.length, kind).toBe(1);
      const pts = points(a.model);
      expect(pts.length, kind).toBeGreaterThan(8);
      const low = Math.min(...pts.map((p) => p[1]!));
      // (what is collected has its middle at the origin; everything else stands on y = 0)
      if (kind === "gem" || kind === "coin") expect(low, kind).toBeLessThan(-0.15);
      else expect(Math.abs(low), `${kind} stands on the ground`).toBeLessThan(0.03);
      const blocks = (a.model.colliders?.length ?? 0) + (a.model.boxes?.length ?? 0) + (a.model.capsules?.length ?? 0);
      const soft = ["grass", "flowers", "mushroom", "gem", "coin"].includes(kind);
      expect(blocks > 0, `${kind} ${soft ? "blocks nothing" : "has a collider"}`).toBe(!soft);
      // every face lists points that exist, at least three of them
      for (const cube of doc.parts[0]!.cubes) for (const poly of cube.polys ?? []) expect(poly.v.length >= 3 && poly.v.every((i) => i >= 0 && i < cube.verts!.length), kind).toBe(true);
      const lua = propEntity(kind, a);
      expect(lua, kind).toContain(`model = "${kind}"`);
      expect(lua.includes("static = true"), kind).toBe(!a.entity.spins);
    }
    expect(makeProp({ kind: "lantern" }).light).toMatchObject({ radius: 6 });
    expect(makeProp({ kind: "rock", size: "large" }).size.w).toBeGreaterThan(makeProp({ kind: "rock", size: "small" }).size.w);
    expect(() => makeProp({ kind: "castle" })).toThrow(/a prop's kind is one of tree, pine/);
  });

  it("takes every palette, and the palette changes the colours", () => {
    const seen = new Set<string>();
    for (const palette of PALETTE_NAMES) seen.add(JSON.stringify(makeProp({ kind: "tree", palette }).model));
    expect(seen.size).toBeGreaterThanOrEqual(PALETTE_NAMES.length - 1);
  });

  it("writes models and entity files through the server, several at once, and refuses what it does not know", () => {
    const said = text(use("prop3d_make", { kinds: ["tree", { kind: "tree", name: "oak", seed: 5 }, "arch", "gem"], palette: "autumn" }));
    expect(said).toMatch(/^made 4 props \(palette "autumn", seed 1\):/);
    for (const n of ["tree", "oak", "arch", "gem"]) {
      expect(existsSync(join(dir, `models/${n}.glb`)), n).toBe(true);
      expect(parseModel(bytes(`models/${n}.model.json`).toString()).ok, n).toBe(true);
    }
    expect(bytes("entities/tree.lua").toString()).toContain('return nova.entity { model = "tree", static = true, sway = 0.2, on_ground = true }');
    expect(bytes("entities/arch.lua").toString()).toContain('return nova.entity { model = "arch", static = true, solid = true, on_ground = true }');
    expect(bytes("entities/gem.lua").toString()).toContain('tags = { "gem", "pickup" }');
    expect(said).toContain("arch (arch): models/arch.glb and entities/arch.lua");
    expect(said).toMatch(/Colliders: box 1\.04 x 1\.04 at -1\.65, 0; box 1\.04 x 1\.04 at 1\.65, 0/);
    // the same call in another folder writes the same bytes; an entity that is there is left alone
    const other = mkdtempSync(join(tmpdir(), "nova-makers3d-again-"));
    try {
      use("prop3d_make", { kinds: ["tree", { kind: "tree", name: "oak", seed: 5 }, "arch", "gem"], palette: "autumn" }, other);
      for (const n of ["tree", "oak", "arch", "gem"]) expect(bytes(`models/${n}.glb`, other).equals(bytes(`models/${n}.glb`)), n).toBe(true);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
    writeFileSync(join(dir, "entities/tree.lua"), "-- mine\n");
    expect(text(use("prop3d_make", { kind: "tree" }))).toContain("(entities/tree.lua was already there and is left as it is)");
    expect(bytes("entities/tree.lua").toString()).toBe("-- mine\n");
    expect(() => use("prop3d_make", { kind: "tree", colour: "red" })).toThrow("`colour` is not an option of the prop3d_make tool; did you mean `color`?");
    expect(() => use("prop3d_make", {})).toThrow(/say what to make: "kind"/);
    expect(() => use("prop3d_make", { kinds: [{ kind: "rock", sized: "small" }] })).toThrow('kinds[0] has "sized"; an entry takes kind, name, seed, size, color');
  });
});

describe("character3d_make", () => {
  it("makes the same figure again from the same parts, with every clip, and each part changes it", () => {
    const base = { hair: "short", outfit: "tunic", pack: "backpack" };
    const a = makeCharacter3d(base);
    expect(JSON.stringify(a.model)).toBe(JSON.stringify(makeCharacter3d(base).model));
    const doc = parsed(a.model);
    expect(doc.clips!.map((c) => c.name)).toEqual(["idle", "walk", "run", "jump", "wave", "attack", "hurt"]);
    for (const name of ["walk", "run"]) expect(doc.clips!.find((c) => c.name === name)!.events!.map((e) => e.name)).toEqual(["step", "step"]);
    expect(doc.clips!.find((c) => c.name === "attack")!.events).toEqual([{ t: 0.22, name: "hit" }]);
    expect(a.speeds.walk).toBeGreaterThan(0.8);
    expect(a.speeds.run).toBeGreaterThan(a.speeds.walk * 2);
    expect(a.capsule.height).toBeGreaterThan(1.4);
    expect(a.parts).toContain("hand_r");
    const seen = new Set([JSON.stringify(a.model)]);
    for (const [key, list] of [["build", CHARACTER3D.builds], ["hair", CHARACTER3D.hairs], ["outfit", CHARACTER3D.outfits], ["hat", CHARACTER3D.hats], ["pack", CHARACTER3D.packs], ["item", CHARACTER3D.items]] as const) {
      for (const value of list) {
        const made = makeCharacter3d({ ...base, [key]: value });
        expect(parsed(made.model).parts[0]!.name, `${key} ${value}`).toBe("hips");
        seen.add(JSON.stringify(made.model));
      }
    }
    // (every choice but the one of each part that the base has already)
    expect(seen.size).toBe(1 + 3 + 5 + 4 + 5 + 3 + 5);
    expect(() => makeCharacter3d({ hat: "crown" })).toThrow(/hat is one of none, cap, hood, wizard, straw, helmet/);
    expect(() => makeCharacter3d({ outfit_color: "blurple" })).toThrow(/outfit_color: 'blurple' is not a colour/);
  });

  it.skipIf(!built)("stands on the ground in every clip, bends only its limbs, and writes a walker that walks", () => {
    const said = text(use("character3d_make", { name: "hero", hair: "long", outfit: "armor", item: "sword", entity: "hero" }));
    expect(said).toMatch(/^models\/hero\.model\.json and models\/hero\.glb and entities\/hero\.lua: an average figure 1\.6\d* m high/);
    expect(said).toMatch(/speeds at which the feet do not slide: walk 1\.163 m\/s, run 3\.968 m\/s/);
    expect(said).toContain("clips: idle 2.4 s (loops); walk 0.86 s (loops) [step when each foot lands]; run 0.56 s (loops) [step when each foot lands]; jump 0.8 s; wave 1.6 s [wave at 0.3]; attack 0.5 s [hit at 0.22]; hurt 0.45 s");
    expect(said).toMatch(/capsule for nova\.solid\.move: radius 0\.3, height 1\.6/);
    // four limbs are skinned (one mesh across the joint each); nothing else is
    const model = JSON.parse(bytes("models/hero.model.json").toString());
    const skinned: string[] = [];
    const visit = (parts: any[]) => parts.forEach((p) => {
      if (p.cubes.some((c: any) => c.skin)) skinned.push(p.name);
      visit(p.children ?? []);
    });
    visit(model.parts);
    expect(skinned.sort()).toEqual(["arm_l", "arm_r", "leg_l", "leg_r"]);
    // `_l` is the figure's own left, +x (facing +z; seen from the front, on the viewer's right): the guide's turn table says so
    const origin = (name: string): number[] => {
      let found: number[] = [];
      const find = (parts: any[]) => parts.forEach((p) => { if (p.name === name) found = p.origin; find(p.children ?? []); });
      find(model.parts);
      return found;
    };
    for (const s of ["arm", "leg"]) {
      expect(origin(`${s}_l`)[0], s).toBeGreaterThan(0);
      expect(origin(`${s}_r`)[0], s).toBeLessThan(0);
    }
    // feet on the ground: the lowest point of the figure at eight moments of each clip that stands
    for (const clip of ["idle", "walk", "run", "wave", "attack", "hurt"]) {
      const low = lowest(text(use("model_preview", { name: "hero", clip, strip: 8, width: 64, height: 64 })));
      // (in a run both feet are in the air for a moment)
      const standing = clip === "run" ? low.filter((v) => v < 0.04) : low;
      expect(standing.length, clip).toBeGreaterThanOrEqual(5);
      for (const v of standing) expect(Math.abs(v), `${clip}: ${low.join(" ")}`).toBeLessThanOrEqual(0.012);
    }
    const jump = lowest(text(use("model_preview", { name: "hero", clip: "jump", strip: 8, width: 64, height: 64 })));
    expect(Math.abs(jump[0]!)).toBeLessThan(0.01);
    expect(Math.abs(jump[7]!)).toBeLessThan(0.01);
    expect(Math.max(...jump)).toBeGreaterThan(0.08); // the legs tuck in the air
    expect(Math.min(...jump)).toBeGreaterThan(-0.015);
    // the walker it writes loads and plays
    use("write_file", { path: "nova.json", text: '{ "format": 1, "name": "T" }\n' });
    use("write_file", { path: "main.lua", text: 'nova.start("yard")\n' });
    use("write_file", { path: "scenes/yard.lua", text: "local S = nova.scene {}\nfunction S:update(dt) nova.cam3.follow(self.hero, { distance = 5, height = 2.5, dt = dt }) end\nreturn S\n" });
    use("ground3d_make", { name: "ground", map: ["....", "....", "...."], hills: 0 });
    use("scene_write", { name: "yard", scene: { version: 1, camera: { eye: [0, 3, 6], target: [0, 1, 0], fov: 55 }, objects: [{ kind: "ground", x: 0, y: 0, z: 0 }, { kind: "hero", name: "hero", x: 0, y: 0, z: 2 }] } });
    expect(text(use("check"))).toContain("no errors");
    const run = text(use("play", { size: "128x72", route: [{ walk_to: [0, -2], capture: "there" }], print: ["nova.named('hero').steps", "nova.named('hero').y"] }));
    expect(run).toMatch(/route: step 1: walk_to \[0, -2\]: there after \d+ frames/);
    const steps = Number(/nova\.named\('hero'\)\.steps = (\d+)/.exec(run)![1]);
    expect(steps).toBeGreaterThanOrEqual(3);
    expect(Math.abs(Number(/nova\.named\('hero'\)\.y = (-?[\d.e-]+)/.exec(run)![1]))).toBeLessThan(0.05); // (it stands on the turf, a few centimetres above the paths)
  }, 120000);
});

describe("creature3d_make", () => {
  it("makes each kind the same again, with idle, move and hurt", () => {
    for (const kind of CREATURES3D) {
      const a = makeCreature3d({ kind });
      expect(JSON.stringify(a.model), kind).toBe(JSON.stringify(makeCreature3d({ kind }).model));
      expect(JSON.stringify(a.model), kind).not.toBe(JSON.stringify(makeCreature3d({ kind, color: "purple" }).model));
      expect(parsed(a.model).clips!.map((c) => c.name), kind).toEqual(["idle", "move", "hurt"]);
      expect(a.speed, kind).toBeGreaterThan(0.3);
      expect(a.capsule.height, kind).toBeGreaterThanOrEqual(a.capsule.radius * 2);
    }
    expect(() => makeCreature3d({ kind: "dragon" })).toThrow(/a creature's kind is one of quadruped, bird, blob/);
  });

  it.skipIf(!built)("keeps its feet on the ground as it moves", () => {
    for (const kind of CREATURES3D) {
      const said = text(use("creature3d_make", { name: kind, kind }));
      expect(said, kind).toMatch(/moves at [\d.]+ m\/s without sliding/);
      const low = lowest(text(use("model_preview", { name: kind, clip: "move", strip: 8, width: 64, height: 64 })));
      // (a blob leaves the ground as it hops; it starts and lands on it)
      const standing = kind === "blob" ? [low[0]!, low[7]!] : low;
      for (const v of standing) expect(Math.abs(v), `${kind}: ${low.join(" ")}`).toBeLessThanOrEqual(0.012);
    }
  }, 120000);
});

describe("ground3d_make", () => {
  const map = ["........", "..pppp..", "..psspw.", "...pp.w."];
  it("makes the same ground again, level where it is laid, and says where things are", () => {
    const a = makeGround({ map, legend: { ".": "grass", p: "path", s: "paved", w: "water" } });
    expect(JSON.stringify(a.model)).toBe(JSON.stringify(makeGround({ map, legend: { ".": "grass", p: "path", s: "paved", w: "water" } }).model));
    expect(JSON.stringify(a.model)).not.toBe(JSON.stringify(makeGround({ map, seed: 2 }).model));
    expect([a.width, a.depth, a.cell]).toEqual([16, 8, 2]);
    expect(a.says).toMatch(/^ground 16 by 8 m \(8 by 4 squares of 2 m\), 20 grass, 8 path, 2 paved, 2 water; \d+ faces, and 40 m of flat grass beyond the edge$/);
    expect(a.where).toEqual(["  path: 8 squares, the first at [x, z] = [-3, -1]", "  paved: 2 squares, the first at [x, z] = [-1, 1]", "  water: 2 squares, the first at [x, z] = [5, 1]"]);
    const doc = parsed(a.model);
    expect(doc.parts[0]!.cubes.length).toBe(2); // the land and the water's surface
    // level (y = 0) in the middle of a path square, lower under the water, and never a cliff
    const land = points(a.model);
    const near = (x: number, z: number) => land.filter((p) => Math.hypot(p[0]! - x, p[2]! - z) < 0.45).map((p) => p[1]!);
    for (const y of near(-3, -1)) expect(Math.abs(y)).toBeLessThan(0.01);
    expect(Math.min(...near(5, 1))).toBeLessThan(-0.25);
    expect(Math.max(...land.map((p) => Math.abs(p[1]!)))).toBeLessThan(0.8);
    // flat when asked, and without the skirt the mesh ends at the map
    const flat = makeGround({ map: ["....", "...."], hills: 0, skirt: 0 });
    for (const p of points(flat.model)) {
      expect(Math.abs(p[1]!)).toBeLessThan(0.05);
      expect(Math.abs(p[0]!)).toBeLessThanOrEqual(4.001);
    }
  });

  it("says what is wrong with a map", () => {
    expect(() => makeGround({ map: ["...", ".."] })).toThrow(/map row 1 has 2 characters and row 0 has 3/);
    expect(() => makeGround({ map: ["..x"] })).toThrow(/map row 0, column 2: 'x' is not in the legend/);
    expect(() => makeGround({ map: ["..x"], legend: { x: "lava" } })).toThrow(/"x" is "lava", which is not a kind of ground \(grass, path, paved, sand, water\)/);
    expect(() => makeGround({ map: ["..."], cell: 20 })).toThrow(/cell is the side of one square in metres, from 1 to 8/);
  });

  it("writes the model and a solid entity through the server", () => {
    const said = text(use("ground3d_make", { name: "ground", map, legend: { ".": "grass", p: "path", s: "paved", w: "water" } }));
    expect(said).toMatch(/^models\/ground\.model\.json and models\/ground\.glb and entities\/ground\.lua: ground 16 by 8 m/);
    expect(said).toContain("the map covers x -8 to 8, z -4 to 4");
    expect(bytes("entities/ground.lua").toString()).toContain('nova.entity { model = "ground", solid = true }');
    expect(parseModel(bytes("models/ground.model.json").toString()).ok).toBe(true);
  });
});
