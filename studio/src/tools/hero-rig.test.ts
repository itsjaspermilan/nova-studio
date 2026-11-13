// The rig of the character (`hero-rig.ts`): run with NOVA_RIG_HERO=<models folder> to rig `hero.model.json` there in place (and write its `.glb`):
//   cd studio && NOVA_RIG_HERO=../examples/rogue-shooter/models npx vitest run src/tools/hero-rig.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseModel, serializeModel, type Cube, type ModelDoc, type Part } from "../lib/model-doc";
import { exportGlb } from "../lib/glb";
import { arc, rigHero, toEuler, turnOf } from "./hero-rig";
import { heroBase } from "./hero-base";

const cubesOf = (parts: Part[]): Cube[] => parts.flatMap((p) => [...p.cubes, ...cubesOf(p.children)]);
const namesOf = (parts: Part[], at: string[] = []): string[][] => parts.flatMap((p) => [[...at, p.name], ...namesOf(p.children, [...at, p.name])]);

const dir = process.env.NOVA_RIG_HERO;
// what is rigged: the person's own model if a folder is given, else the base
const source = (): ModelDoc => {
  if (dir) {
    const p = parseModel(readFileSync(join(dir, "hero.model.json"), "utf8"));
    if (!p.ok) throw new Error(p.error);
    return p.doc;
  }
  return heroBase();
};

describe("the character rig", () => {
  const { doc, notes } = rigHero(source());
  const mesh = cubesOf(doc.parts).find((c) => c.shape === "mesh")!;

  it("is still a valid model, with its points untouched and weights that add up", () => {
    const parsed = parseModel(serializeModel(doc));
    expect(parsed.ok, parsed.ok ? "" : parsed.error).toBe(true);
    const was = cubesOf(source().parts).find((c) => c.shape === "mesh")!;
    expect(mesh.verts).toEqual(was.verts);
    expect(mesh.polys).toEqual(was.polys);
    for (const w of mesh.skin!.weights) {
      expect(w.length).toBeGreaterThan(0);
      expect(w.reduce((n, [, x]) => n + x, 0)).toBeCloseTo(1, 4);
    }
    expect(notes.length).toBeGreaterThan(2);
  });

  it("has the clips, and every track names a part that exists", () => {
    const names = doc.clips!.map((c) => c.name);
    for (const n of ["idle", "walk", "run", "crouch", "crouch_walk", "jump", "fall", "aim"]) expect(names).toContain(n);
    const paths = new Set(namesOf(doc.parts).map((p) => p.join("/")));
    for (const c of doc.clips!) {
      expect(c.tracks.length).toBeGreaterThan(0);
      for (const t of c.tracks) {
        expect(paths.has(t.part.join("/")), `${c.name}: ${t.part.join("/")}`).toBe(true);
        expect(t.keys.length).toBeGreaterThanOrEqual(2);
        expect(t.keys.every((k, i) => i === 0 || k.t > t.keys[i - 1]!.t)).toBe(true);
      }
      if (c.loop && c.duration > 0.2) {
        // a loop ends where it began
        for (const t of c.tracks) expect(t.keys.at(-1)!.value, `${c.name} ${t.part.at(-1)}`).toEqual(t.keys[0]!.value);
      }
    }
  });

  it("keeps the feet on the floor in the walk and the crouch (the lower foot at the standing ankle height) and never in it in the run", () => {
    const thigh = 4.95, shin = 5.4; // read from the model below
    const find = (n: string) => namesOf(doc.parts).find((p) => p.at(-1) === n)!;
    const all: { name: string; origin: number[] }[] = [];
    const w = (parts: Part[]) => parts.forEach((p) => (all.push({ name: p.name, origin: p.origin }), w(p.children)));
    w(doc.parts);
    const o = (n: string) => all.find((x) => x.name === n)!.origin;
    void thigh; void shin; void find;
    const drop = -o("left thigh")[1]!, tl = -o("left shin")[1]!, sl = -o("left foot")[1]!;
    const standing = o("hips")[1]! - drop - tl - sl;
    const ankle = (t: number, s: number) => -drop - tl * Math.cos((t * Math.PI) / 180) - sl * Math.cos(((t + s) * Math.PI) / 180);
    for (const name of ["walk", "run", "crouch", "crouch_walk"]) {
      const c = doc.clips!.find((x) => x.name === name)!;
      const key = (part: string, i: number) => c.tracks.find((t) => t.part.at(-1) === part && t.prop === "rotation")!.keys[i]!.value[0]!;
      const hipsY = (i: number) => c.tracks.find((t) => t.part.at(-1) === "hips" && t.prop === "position")!.keys[i]!.value[1]!;
      const n = c.tracks.find((t) => t.part.at(-1) === "left thigh")!.keys.length;
      for (let i = 0; i < n; i++) {
        const low = hipsY(i) + Math.min(ankle(key("left thigh", i), key("left shin", i)), ankle(key("right thigh", i), key("right shin", i)));
        // (the run has a moment in the air: the hips are then higher, never lower)
        if (name === "run") expect(low, `${name} key ${i}`).toBeGreaterThanOrEqual(standing - 0.05);
        else expect(low, `${name} key ${i}`).toBeCloseTo(standing, 1);
      }
    }
  });

  it("turns between directions and Euler degrees both ways (the aim pose's maths)", () => {
    const rot = (q: number[], v: number[]) => {
      // q * v * q^-1
      const [x, y, z, w] = q as [number, number, number, number];
      const t = [2 * (y * v[2]! - z * v[1]!), 2 * (z * v[0]! - x * v[2]!), 2 * (x * v[1]! - y * v[0]!)];
      return [v[0]! + w * t[0]! + (y * t[2]! - z * t[1]!), v[1]! + w * t[1]! + (z * t[0]! - x * t[2]!), v[2]! + w * t[2]! + (x * t[1]! - y * t[0]!)];
    };
    for (const to of [[0, 0, 1], [0.4, -0.5, 1], [-0.3, 0.2, 1], [1, 0, 0]]) {
      const from: [number, number, number] = [0.707, -0.707, 0];
      const q = arc(from, to as [number, number, number]);
      const e = toEuler(q);
      const back = rot(turnOf(e), from);
      const l = Math.hypot(...to);
      for (let k = 0; k < 3; k++) expect(back[k]!).toBeCloseTo(to[k]! / l, 3);
    }
  });

  it("exports as a .glb with the animations", () => {
    expect(exportGlb(doc).length).toBeGreaterThan(1000);
  });

  it.runIf(!!dir)("writes the rigged model (NOVA_RIG_HERO=<models folder>)", () => {
    // (the .glb is made from the saved text, as the studio does, so that the two always agree)
    const text = serializeModel(doc);
    const saved = parseModel(text);
    if (!saved.ok) throw new Error(saved.error);
    writeFileSync(join(dir!, "hero.model.json"), text);
    writeFileSync(join(dir!, "hero.glb"), exportGlb(saved.doc));
    console.log(notes.join("\n"));
  });
});
