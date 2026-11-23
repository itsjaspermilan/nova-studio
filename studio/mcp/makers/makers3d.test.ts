import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { releaseBinary } from "../binaries";
import { parseModel } from "../../src/lib/model-doc";
import { expandModel } from "../modelkit";
import { call } from "../server";
import { CHARACTER3D, EXPRESSIONS, FACE_SETS, makeCharacter3d, TALK } from "./character3d";
import { faceInks, faceLayout, type FaceColours } from "./face3d";
import { unwrap } from "../../src/lib/model-uv";
import type { Cube } from "../../src/lib/model-doc";
import { CREATURES3D, makeCreature3d } from "./creature3d";
import { makeGround } from "./ground3d";
import { PALETTE_NAMES } from "./palettes";
import { makeProp, PROP_KINDS, propEntity } from "./prop3d";

const built = existsSync(releaseBinary(resolve(dirname(fileURLToPath(import.meta.url)), "../../.."), "nova"));

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
/// Every shape of a model document.
const walkCubes = (doc: { parts: { cubes: Cube[]; children: any[] }[] }): Cube[] => {
  const out: Cube[] = [];
  const visit = (ps: { cubes: Cube[]; children: any[] }[]) => ps.forEach((q) => { out.push(...q.cubes); visit(q.children ?? []); });
  visit(doc.parts);
  return out;
};
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
    // what a prop blocks is kept in model units, like its points (the export scales both to metres): a pine's trunk is 0.3 m
    const pine = makeProp({ kind: "pine" }).model;
    expect(pine.colliders[0].r * pine.scale).toBeCloseTo(0.3, 5);
    const fence = makeProp({ kind: "fence" }).model;
    expect(fence.boxes[0].hw * fence.scale).toBeCloseTo(1.05, 5);
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
    expect(bytes("entities/tree.lua").toString()).toContain('return nova.entity { model = "tree", static = true, sway = 0.2, lift = "upright", on_ground = true }');
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
    expect(doc.clips!.map((c) => c.name)).toEqual(["idle", "walk", "run", "trot", "jump", "wave", "attack", "hurt", "carry", "talk", "work", "sit"]);
    for (const name of ["walk", "run", "trot"]) expect(doc.clips!.find((c) => c.name === name)!.events!.map((e) => e.name)).toEqual(["step", "step"]);
    expect(doc.clips!.find((c) => c.name === "attack")!.events).toEqual([{ t: 0.22, name: "hit" }]);
    expect(a.speeds.walk).toBeGreaterThan(0.8);
    expect(a.speeds.run).toBeGreaterThan(a.speeds.walk * 2);
    expect(a.capsule.height).toBeGreaterThan(1.4);
    expect(a.parts).toContain("hand_r");
    const seen = new Set([JSON.stringify(a.model)]);
    for (const [key, list] of [["build", CHARACTER3D.builds], ["hair", CHARACTER3D.hairs], ["outfit", CHARACTER3D.outfits], ["hat", CHARACTER3D.hats], ["pack", CHARACTER3D.packs], ["item", CHARACTER3D.items], ["species", CHARACTER3D.species], ["accessory", CHARACTER3D.accessories]] as const) {
      for (const value of list) {
        const made = makeCharacter3d({ ...base, [key]: value });
        expect(parsed(made.model).parts[0]!.name, `${key} ${value}`).toBe("hips");
        seen.add(JSON.stringify(made.model));
      }
    }
    // (every choice but the one of each part that the base has already)
    // (the apron is a chibi's, painted on its clothes: on this figure it changes nothing)
    expect(seen.size).toBe(1 + 5 + 5 + 5 + 8 + 3 + 5 + 5 + 4);
    expect(() => makeCharacter3d({ hat: "crown" })).toThrow(/hat is one of none, cap, hood, wizard, straw, helmet, peaked, bucket, round/);
    expect(() => makeCharacter3d({ species: "dragon" })).toThrow(/species is one of human, fox, badger, rabbit, bear, cat/);
    expect(() => makeCharacter3d({ species: "fox", head_scale: 3 })).toThrow(/head_scale is a number from 0.8 to 2.2/);
    expect(() => makeCharacter3d({ outfit_color: "blurple" })).toThrow(/outfit_color: 'blurple' is not a colour/);
  });

  it("makes animal people: a bigger head, no hair unless asked, a tail part that the clips swing, the carry pose for the arms", () => {
    const fox = makeCharacter3d({ species: "fox", hat: "peaked", accessory: "satchel" });
    const human = makeCharacter3d({});
    expect(fox.parts).toContain("tail");
    expect(human.parts).not.toContain("tail");
    expect(fox.says).toMatch(/fox figure .* \(its head 1\.55 times a person's\) with fur, wearing a tunic, a peaked cap, trousers and a satchel/);
    const doc = parsed(fox.model);
    const tailTracks = doc.clips!.filter((c) => (c.tracks ?? []).some((t: any) => t.part.join("/") === "hips/tail")).map((c) => c.name);
    expect(tailTracks).toEqual(expect.arrayContaining(["idle", "walk", "run", "talk", "work"]));
    const carry = doc.clips!.find((c) => c.name === "carry")!;
    expect(new Set(carry.tracks!.map((t: any) => t.part[t.part.length - 1]))).toEqual(new Set(["arm_l", "fore_l", "arm_r", "fore_r"]));
    // the head is the given share of a person's: the highest point rises with it
    const big = makeCharacter3d({ species: "rabbit", head_scale: 2 }), small = makeCharacter3d({ species: "rabbit", head_scale: 1 });
    expect(big.capsule.height).toBeGreaterThan(small.capsule.height + 0.1);
    for (const s of CHARACTER3D.species) expect(JSON.stringify(makeCharacter3d({ species: s }).model), s).toBe(JSON.stringify(makeCharacter3d({ species: s }).model));
  });

  it("makes a chibi villager: about two heads tall, stubby limbs that swing whole, a face of expressions, a waddle, an aeroplane run, a trot", () => {
    const fox = makeCharacter3d({ species: "fox", build: "chibi", head_scale: 1.75 });
    // about 1.0 to 1.2 m with the ears; the head is a big share of it
    expect(fox.capsule.height).toBeGreaterThan(0.95);
    expect(fox.capsule.height).toBeLessThan(1.25);
    expect(fox.capsule.height).toBeLessThan(makeCharacter3d({ species: "fox", head_scale: 1.75 }).capsule.height - 0.3);
    const doc = parsed(fox.model);
    const names: string[] = [];
    const visit = (parts: any[]) => parts.forEach((p) => { names.push(p.name); visit(p.children ?? []); });
    visit(doc.parts);
    // every part an expression names is there (under the head), the firsts of each set in place, the others hidden inside the head
    for (const [expr, list] of Object.entries(EXPRESSIONS)) for (const n of list) expect(names, expr).toContain(n);
    for (const list of Object.values(FACE_SETS)) for (const n of list) expect(names).toContain(n);
    expect(fox.faces).toMatch(/Expressions: neutral = eye_open \+ brow_flat \+ mouth_closed/);
    const clip = (n: string) => doc.clips!.find((c) => c.name === n)!;
    const track = (c: string, part: string) => (clip(c).tracks ?? []).find((t: any) => t.part[t.part.length - 1] === part && t.prop === "rotation") as any;
    // no elbows or knees: no clip turns a forearm or a shin
    for (const c of doc.clips!) for (const t of c.tracks ?? []) expect((t as any).part.at(-1), c.name).not.toMatch(/^(fore|shin)_/);
    // the walk swings the arms back and forth by the sides; the run holds them straight out to the sides (left +z turn, right -z),
    // a little back, all the way through; the trot leaves them to the carry
    for (const k of track("walk", "arm_l").keys) expect(Math.abs(k.value[2])).toBeLessThan(30);
    for (const k of track("run", "arm_l").keys) { expect(k.value[2]).toBeGreaterThan(65); expect(k.value[0]).toBeGreaterThan(0); }
    for (const k of track("run", "arm_r").keys) expect(k.value[2]).toBeLessThan(-65);
    expect(track("trot", "arm_l")).toBeUndefined();
    expect(track("trot", "leg_l")).toBeDefined();
    // the run leans into it and streams the tail; quick short steps at about twice the walk's speed; the trot between them
    expect(track("run", "spine").keys[0].value[0]).toBeGreaterThan(track("walk", "spine").keys[0].value[0] + 5);
    expect(clip("run").duration).toBeLessThan(clip("walk").duration);
    expect(fox.speeds.run / fox.speeds.walk).toBeGreaterThan(1.8);
    expect(fox.speeds.run / fox.speeds.walk).toBeLessThan(2.4);
    expect(fox.speeds.trot).toBeGreaterThan(fox.speeds.walk);
    expect(fox.speeds.trot).toBeLessThan(fox.speeds.run);
    expect(clip("run").events!.map((e) => e.name)).toEqual(["step", "step"]);
    // sitting at a wheel: both legs straight out in front (a stubby leg turned forward, -x, near a right angle) and held there,
    // both arms forward at the chest (not out to the sides), the spine leaning back a touch; it loops
    expect(clip("sit").loop).toBe(true);
    for (const leg of ["leg_l", "leg_r"]) for (const k of track("sit", leg).keys) expect(k.value[0]).toBeLessThan(-70);
    for (const a of ["arm_l", "arm_r"]) for (const k of track("sit", a).keys) { expect(k.value[0]).toBeLessThan(-50); expect(Math.abs(k.value[2])).toBeLessThan(15); }
    expect(track("sit", "spine").keys[0].value[0]).toBeLessThan(0);
    // a person with knees bends them: the thigh forward, the shin back down
    const seated = parsed(makeCharacter3d({}).model).clips!.find((c) => c.name === "sit")!;
    const thigh = seated.tracks!.find((t: any) => t.part.at(-1) === "leg_l") as any, shin = seated.tracks!.find((t: any) => t.part.at(-1) === "shin_l") as any;
    expect(thigh.keys[0].value[0]).toBeLessThan(-70);
    expect(shin.keys[0].value[0]).toBeGreaterThan(70);
    // a human has no face parts to swap
    expect(makeCharacter3d({}).faces).toBeUndefined();
  });

  it("gives each gait clip its stride, and hangs an animal's ears and a satchel's bag on parts of their own, so a game can let them follow", () => {
    for (const build of ["chibi", "average"]) {
      const made = makeCharacter3d({ species: "rabbit", build, accessory: "satchel" });
      const doc = parsed(made.model);
      // the ground a cycle covers is the no-slide speed times the clip's length, on the gait clips only
      for (const name of ["walk", "run", "trot"]) {
        const c = doc.clips!.find((x) => x.name === name)!;
        expect(c.stride, `${build} ${name}`).toBeCloseTo((made.speeds as Record<string, number>)[name]! * c.duration, 2);
        expect(made.clips.find((x) => x.name === name)!.stride).toBe(c.stride);
      }
      for (const name of ["idle", "wave", "sit", "carry"]) expect(doc.clips!.find((x) => x.name === name)!.stride).toBeUndefined();
      // the ears under the head, each with its root as its pivot (high on the head, one either side), not in the head's own mesh
      const find = (ps: any[], n: string): any => { for (const p of ps) { if (p.name === n) return p; const f = find(p.children ?? [], n); if (f) return f; } };
      const head = find(doc.parts, "head");
      const ears = ["ear_l", "ear_r"].map((n) => head.children.find((p: any) => p.name === n));
      expect(ears[0].origin[0]).toBeGreaterThan(0);
      expect(ears[1].origin[0]).toBeLessThan(0);
      for (const e of ears) expect(e.cubes.length).toBeGreaterThan(0);
      expect(made.parts).toEqual(expect.arrayContaining(["ear_l", "ear_r", "bag"]));
      // the bag hangs from the spine on the right hip
      const bag = find(doc.parts, "bag");
      expect(find(doc.parts, "spine").children).toContain(bag);
      expect(bag.origin[0]).toBeLessThan(0);
    }
    // a bear's round ears are parts too; a figure with no satchel has no bag; a person has no ears to hang
    const bear = makeCharacter3d({ species: "bear", build: "chibi" });
    expect(bear.parts).toEqual(expect.arrayContaining(["ear_l", "ear_r"]));
    expect(bear.parts).not.toContain("bag");
    expect(makeCharacter3d({}).parts).not.toContain("ear_l");
  });

  it("paints a chibi's face on a squashed round head: every drawing a decal part, all but the first of each set hidden at rest, one texture", () => {
    for (const species of ["fox", "bear", "rabbit"]) {
      const made = makeCharacter3d({ species, build: "chibi", head_scale: 1.75, accessory: species === "bear" ? "apron" : "none", emblem: species === "fox" ? "envelope" : "none" });
      const doc = parsed(made.model);
      // the head: wider than tall, smooth (many faces, smooth shading)
      const head = doc.parts[0]!.children.find((p) => p.name === "spine")!.children.find((p) => p.name === "head")!;
      const shell = head.cubes[0]!;
      expect(made.head!.width / made.head!.height, species).toBeGreaterThan(1.25);
      expect(made.head!.height / made.capsule.height, species).toBeGreaterThan(0.38);
      expect(shell.polys!.length, species).toBeGreaterThan(800);
      expect(shell.polys!.filter((q) => q.smooth).length / shell.polys!.length, species).toBeGreaterThan(0.95);
      // each drawing is a part of the head with one textured shape; the first of each set shows, the rest are hidden
      const parts = new Map(head.children.map((p) => [p.name, p]));
      for (const [set, names] of Object.entries(FACE_SETS)) {
        names.forEach((n, i) => {
          const p = parts.get(n);
          expect(p, `${species} ${set} ${n}`).toBeDefined();
          expect(!!p!.hidden, `${species} ${n} hidden`).toBe(i > 0);
          expect(p!.cubes.length).toBe(1);
          expect(p!.cubes[0]!.texture, n).toBeDefined();
        });
      }
      // the nose and patches are painted on the head itself; the picture is the model's texture, its see-through texels left undrawn
      expect(head.cubes.some((c) => c.name === "face_paint" && c.texture)).toBe(true);
      expect(made.picture).toBeDefined();
      expect([made.picture!.w, made.picture!.h]).toEqual(doc.texture!.size);
      let clear = 0, solid = 0;
      for (let i = 3; i < made.picture!.data.length; i += 4) made.picture!.data[i] === 0 ? clear++ : solid++;
      expect(clear).toBeGreaterThan(0);
      expect(solid).toBeGreaterThan(0);
      // no texture of one drawing runs into another's block
      const blocks = walkCubes(doc).filter((c) => c.texture).map((c) => ({ at: c.texture!.at, size: unwrap(c).size }));
      for (let a = 0; a < blocks.length; a++) for (let b = a + 1; b < blocks.length; b++) {
        const A = blocks[a]!, B = blocks[b]!;
        const apart = A.at[0] + A.size[0] <= B.at[0] || B.at[0] + B.size[0] <= A.at[0] || A.at[1] + A.size[1] <= B.at[1] || B.at[1] + B.size[1] <= A.at[1];
        expect(apart, `${species} blocks ${a} and ${b}`).toBe(true);
      }
      expect(made.faces).toMatch(/visible = true/);
    }
    // the apron and the emblem are painted on the clothes
    const bear = parsed(makeCharacter3d({ species: "bear", build: "chibi", accessory: "apron" }).model);
    expect(walkCubes(bear).some((c) => c.name === "body_paint")).toBe(true);
    expect(walkCubes(bear).some((c) => c.name === "hips_paint")).toBe(true);
    expect(() => makeCharacter3d({ species: "fox", build: "chibi", emblem: "anchor" })).toThrow(/emblem is one of none, envelope, star, leaf, heart, bolt/);
  });

  it("dresses everyone in trousers unless a skirt is asked for", () => {
    // the hips' own shapes: how wide they reach below the tops of the legs (a skirt flares out over the legs; trousers narrow to a crotch)
    const below = (made: ReturnType<typeof makeCharacter3d>) => {
      const doc = parsed(made.model);
      const hips = doc.parts[0]!, leg = hips.children.find((p) => p.name === "leg_l")!;
      let widest = 0;
      for (const c of hips.cubes) for (const v of c.verts ?? []) if (v[1] < leg.origin[1] - 0.5) widest = Math.max(widest, Math.abs(v[0]));
      return widest / 16;
    };
    for (const build of ["chibi", "average"]) for (const outfit of ["tunic", "shirt", "vest", "armor", "cardigan"]) {
      const a = { species: build === "chibi" ? "fox" : "human", build, outfit };
      const trousers = makeCharacter3d(a);
      expect(trousers.says, `${build} ${outfit}`).toMatch(/trousers/);
      expect(below(trousers), `${build} ${outfit}`).toBeLessThan(0.15);
      if (outfit === "tunic" || outfit === "armor") {
        const skirted = makeCharacter3d({ ...a, skirt: true });
        expect(skirted.says).toMatch(/a skirt/);
        expect(below(skirted), `${build} ${outfit} skirt`).toBeGreaterThan(below(trousers) + 0.03);
      }
    }
    // a robe is a long dress whatever is asked
    expect(makeCharacter3d({ outfit: "robe" }).says).not.toMatch(/trousers/);
    expect(() => makeCharacter3d({ skirt: "yes" })).toThrow(/skirt is true or false/);
  });

  it("joins a chibi's arms and legs to its body: each limb's top a ball round its pivot, sunk into the body", () => {
    for (const species of ["fox", "bear", "rabbit"]) {
      const doc = parsed(makeCharacter3d({ species, build: "chibi", head_scale: 1.75, outfit: "cardigan" }).model);
      const find = (ps: any[], n: string): any => { for (const p of ps) { if (p.name === n) return p; const f = find(p.children ?? [], n); if (f) return f; } };
      for (const [limb, body] of [["arm_l", "spine"], ["arm_r", "spine"], ["leg_l", "hips"], ["leg_r", "hips"]] as const) {
        const p = find(doc.parts, limb), b = find(doc.parts, body);
        const top = (p.cubes[0].verts as number[][]).filter((v) => v[1] > 0.03).map((v) => Math.hypot(v[0]!, v[1]!, v[2]!) / 16);
        const r = Math.max(...top);
        // (every point of the top lies on the ball: a turn of the limb about its pivot leaves it where it was)
        for (const d of top) expect(Math.abs(d - r), `${species} ${limb}`).toBeLessThan(0.004);
        // (the body's outline at the pivot's height, on the limb's side, reaches past the ball's inner edge)
        const side = Math.sign(p.origin[0]);
        const outline = (b.cubes[0].verts as number[][]).filter((v) => Math.abs(v[2]!) < 0.1 && v[0]! * side > 0.01).map((v) => [v[1]! / 16, Math.abs(v[0]!) / 16] as const).sort((x, y) => x[0] - y[0]);
        const y = p.origin[1] / 16;
        const lo = outline.filter((q) => q[0] <= y).at(-1)!, hi = outline.find((q) => q[0] > y)!;
        const surface = lo[1] + ((hi[1] - lo[1]) * (y - lo[0])) / (hi[0] - lo[0]);
        expect(Math.abs(p.origin[0] / 16) - r, `${species} ${limb}`).toBeLessThan(surface - 0.015);
      }
    }
  });

  it("paints big eyes and mouths, a little like a cartoon's, that stay on the face", () => {
    for (const species of ["fox", "bear", "rabbit", "cat", "badger"]) {
      const RX = 0.28, RY = 0.2, c = 0.2;
      const L = faceLayout(species, RX, RY, c);
      // (about a quarter bigger than before 2026-11-23: the eyes were 0.088 x 0.155 of the head's half sizes, the mouth 0.13)
      expect(L.ew / RX).toBeGreaterThan(0.088 * 1.2);
      expect(L.eh / RY).toBeGreaterThan(0.155 * 1.25);
      expect(L.eh / RY / (L.ew / RX)).toBeGreaterThan(1.6); // (taller ovals)
      expect(L.mw / RX).toBeGreaterThan(0.13 * 1.18);
      const colours: FaceColours = { ink: "#2a2027", brow: "#3a2a20", fur: "#d9692b", fur2: "#f7efe2", dark: "#3b2620", mouth: "#5a2228", tongue: "#e8838a", blush: "#f4a3a8", nose: "#2e2226" };
      // every drawing's paint, sampled: on the face (inside the head's outline, within its box), the eyes clear of a snout or a
      // muzzle and above the nose, the mouths under it
      const snout = species === "fox" || species === "badger" ? { y: c - 0.3 * RY, a: 0.28 * RX, b: 0.24 * RY } : species === "bear" ? { y: c - 0.34 * RY, a: 0.34 * RX, b: 0.27 * RY } : undefined;
      for (const set of ["eyes", "brows", "mouth"] as const) for (const name of FACE_SETS[set]) {
        const inks = faceInks(name, L, colours, species);
        const box = L.boxes[set];
        let painted = 0;
        for (let x = -RX; x <= RX; x += 0.002) for (let y = c - RY; y <= c + RY; y += 0.002) {
          if (!inks.some((k) => k.d(x, y) < 0)) continue;
          painted++;
          expect((x / RX) ** 2 + ((y - c) / RY) ** 2, `${species} ${name} on the head`).toBeLessThan(0.85);
          expect(x >= box[0] && x <= box[1] && y >= box[2] && y <= box[3], `${species} ${name} inside its own box: ${x.toFixed(3)}, ${y.toFixed(3)} in ${box.map((v) => v.toFixed(3))}`).toBe(true);
          if (set === "eyes") {
            // (the wide-open eyes of a surprise reach down about level with the nose, out at the sides)
            if (!snout) expect(y, `${species} ${name} above the nose`).toBeGreaterThan(L.ny - 0.04 * RY);
            if (snout) expect((x / snout.a) ** 2 + ((y - snout.y) / snout.b) ** 2, `${species} ${name} clear of the snout`).toBeGreaterThan(0.97);
          }
          if (set === "mouth") expect(y, `${species} ${name} under the nose`).toBeLessThan(L.ny);
        }
        expect(painted, `${species} ${name}`).toBeGreaterThan(10);
      }
      // (the eye boxes and the brow boxes do not overlap: a brow is never cut off by the eyes' decal)
      expect(L.boxes.brows[2]).toBeGreaterThanOrEqual(L.boxes.eyes[3]);
    }
  });

  it("makes soft hats and a cardigan for a village postie: a bucket hat or a round cap with a pin, a collar, buttons, no belt", () => {
    const base = { species: "fox", build: "chibi", head_scale: 1.75, outfit: "cardigan", outfit_color: "#e2b04a", emblem: "envelope" };
    const plain = makeCharacter3d({ ...base, hat: "bucket" });
    expect(plain.says).toMatch(/wearing a cardigan, a bucket hat, trousers/);
    const pinned = makeCharacter3d({ ...base, hat: "bucket", hat_pin: "envelope", hat_color: "#b5503f" });
    const round = makeCharacter3d({ ...base, hat: "round", hat_pin: "star" });
    expect(round.says).toMatch(/a round cap/);
    const head = (m: ReturnType<typeof makeCharacter3d>) => JSON.stringify(parsed(m.model).parts[0]!.children.find((p) => p.name === "spine")!.children.find((p) => p.name === "head")!.cubes);
    expect(head(pinned)).not.toBe(head(plain));
    expect(head(round)).not.toBe(head(plain));
    expect(head(pinned)).toContain("#b5503f");
    // no belt over a cardigan (its buckle was a uniform's), the shirt's collar painted at the neck
    const hipsShapes = (o: string) => parsed(makeCharacter3d({ ...base, outfit: o }).model).parts[0]!.cubes.length;
    expect(hipsShapes("cardigan")).toBeLessThan(hipsShapes("tunic"));
    expect(walkCubes(parsed(plain.model)).some((c) => c.name === "body_paint")).toBe(true);
    expect(() => makeCharacter3d({ ...base, hat_pin: "anchor" })).toThrow(/hat_pin is one of none, envelope, star, leaf, heart, bolt/);
  });

  it("swaps a face with expressions by name, and talks with each mouth's partner", () => {
    for (const [name, [eyes, brows, mouth]] of Object.entries(EXPRESSIONS)) {
      expect(FACE_SETS.eyes as readonly string[], name).toContain(eyes);
      expect(FACE_SETS.brows as readonly string[], name).toContain(brows);
      expect(FACE_SETS.mouth as readonly string[], name).toContain(mouth);
    }
    for (const m of FACE_SETS.mouth) expect(FACE_SETS.mouth as readonly string[]).toContain(TALK[m]);
    expect(EXPRESSIONS.dry![0]).toBe("eye_half");
  });

  it.skipIf(!built)("stands on the ground in every clip, bends only its limbs, and writes a walker that walks", () => {
    const said = text(use("character3d_make", { name: "hero", hair: "long", outfit: "armor", item: "sword", entity: "hero" }));
    expect(said).toMatch(/^models\/hero\.model\.json and models\/hero\.glb and entities\/hero\.lua: an average figure 1\.6\d* m high/);
    expect(said).toMatch(/speeds at which the feet do not slide: walk 1\.163 m\/s, run 3\.968 m\/s/);
    expect(said).toContain("clips: idle 2.4 s (loops); walk 0.86 s (loops) [step when each foot lands]; run 0.56 s (loops) [step when each foot lands]; trot 0.5 s (loops) [step when each foot lands]; jump 0.8 s; wave 1.6 s [wave at 0.3]; attack 0.5 s [hit at 0.22]; hurt 0.45 s");
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
