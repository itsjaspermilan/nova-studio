// The character base (`hero-base.ts`): one skinned mesh in an A-pose on the Person template's skeleton. Run with NOVA_MAKE_HERO=<folder> (a project's `models` folder)
// to write `hero.model.json` and `hero.glb` there:   cd studio && NOVA_MAKE_HERO=../examples/rogue-shooter/models npx vitest run src/tools/hero-base.test.ts
import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseModel, serializeModel, type Cube, type Part } from "../lib/model-doc";
import { exportGlb } from "../lib/glb";
import { heroBase } from "./hero-base";
import { extrudeFaceSym, mirrorResult, twinPoints } from "../lib/mesh-symmetry";
import { edgesOf, faceCentre, faceNormal } from "../lib/mesh-edit";

const cubesOf = (parts: Part[]): Cube[] => parts.flatMap((p) => [...p.cubes, ...cubesOf(p.children)]);
const namesOf = (parts: Part[]): string[] => parts.flatMap((p) => [p.name, ...namesOf(p.children)]);

describe("the character base", () => {
  const doc = heroBase();
  const mesh = cubesOf(doc.parts).find((c) => c.shape === "mesh")!;

  it("is a valid model with the Person template's 15 parts and one skinned mesh", () => {
    const parsed = parseModel(serializeModel(doc));
    expect(parsed.ok, parsed.ok ? "" : parsed.error).toBe(true);
    const names = namesOf(doc.parts);
    for (const n of ["hips", "spine", "head", "left arm", "left forearm", "left hand", "right arm", "left thigh", "left shin", "left foot", "right foot"]) expect(names).toContain(n);
    expect(cubesOf(doc.parts).length).toBe(1);
    expect(mesh.skin?.bones.length).toBe(15);
  });

  it("is one closed surface, wound the same way everywhere", () => {
    const directed = new Map<string, number>();
    for (const p of mesh.polys!) for (let i = 0; i < p.v.length; i++) {
      const k = `${p.v[i]}>${p.v[(i + 1) % p.v.length]}`;
      directed.set(k, (directed.get(k) ?? 0) + 1);
    }
    for (const [k, n] of directed) {
      expect(n, `edge ${k} used twice the same way`).toBe(1);
      const [a, b] = k.split(">");
      expect(directed.has(`${b}>${a}`), `edge ${k} has no partner`).toBe(true);
    }
  });

  it("stands on the floor, 1.8 m tall, front to +z, and is the same on both sides", () => {
    const ys = mesh.verts!.map((p) => p[1]);
    const h = (Math.max(...ys) - Math.min(...ys)) * doc.scale;
    expect(Math.min(...ys)).toBeCloseTo(0, 3);
    expect(h).toBeGreaterThan(1.7);
    expect(h).toBeLessThan(1.9);
    const key = (p: number[]) => `${p[0]!.toFixed(2)},${p[1]!.toFixed(2)},${p[2]!.toFixed(2)}`;
    const seen = new Set(mesh.verts!.map(key));
    for (const p of mesh.verts!) expect(seen.has(key([-p[0]!, p[1]!, p[2]!])), `no twin for ${key(p)}`).toBe(true);
    // the toes point forward
    const toes = mesh.verts!.filter((p) => p[1] < 1);
    expect(Math.max(...toes.map((p) => p[2]))).toBeGreaterThan(3);
  });

  it("has arms hanging down and out (an A), not straight out", () => {
    const hand = mesh.verts!.reduce((m, p) => (p[0] > m[0] ? p : m), mesh.verts![0]!);
    expect(hand[1]).toBeLessThan(18); // the shoulder is at about 20; the hand has dropped well below it
    expect(hand[0]).toBeGreaterThan(10);
  });

  it("has weights that add up to one and name only real bones", () => {
    const skin = mesh.skin!;
    expect(skin.weights.length).toBe(mesh.verts!.length);
    for (const w of skin.weights) {
      expect(w.length).toBeGreaterThan(0);
      expect(w.length).toBeLessThanOrEqual(4);
      expect(w.reduce((n, [, x]) => n + x, 0)).toBeCloseTo(1, 4);
      for (const [b] of w) expect(b).toBeLessThan(skin.bones.length);
    }
    // the hand follows the hand bone, the foot the foot bone, the head the head bone
    const topBone = (i: number) => skin.bones[skin.weights[i]!.reduce((m, p) => (p[1] > m[1] ? p : m))[0]]!;
    const furthest = mesh.verts!.reduce((m, p, i) => (p[0] > mesh.verts![m]![0]! ? i : m), 0);
    expect(topBone(furthest)).toBe("hero/hips/spine/left arm/left forearm/left hand");
    const top = mesh.verts!.reduce((m, p, i) => (p[1] > mesh.verts![m]![1]! ? i : m), 0);
    expect(topBone(top)).toBe("hero/hips/spine/head");
  });

  it("opens with Symmetry on (left-right), and the setting survives saving", () => {
    expect(doc.symmetry).toBe("x");
    const back = parseModel(serializeModel(doc));
    expect(back.ok && back.doc.symmetry).toBe("x");
  });

  it("symmetrical editing works on it: every point has a twin, a pair of chest faces extrudes as one block, a hand point moves with its twin", () => {
    expect(twinPoints(mesh, 0).every((t) => t >= 0)).toBe(true);
    // the two front faces of the chest (one each side of the middle)
    const front = mesh.polys!.map((_, i) => i).filter((i) => faceNormal(mesh, i)[2] > 0.9 && faceCentre(mesh, i)[1] > 16 && faceCentre(mesh, i)[1] < 20);
    expect(front.length).toBeGreaterThanOrEqual(2);
    const r = extrudeFaceSym(mesh, front[0]!, 1, 0, 0);
    expect(r.cube.verts!.length).toBeGreaterThan(mesh.verts!.length);
    expect(twinPoints(r.cube, 0).every((t) => t >= 0)).toBe(true);
    // (a closed surface still: every edge has two faces)
    expect(edgesOf(r.cube).every((e) => e.faces === 2)).toBe(true);
    // a point of the left hand moved: its twin follows, mirrored
    const hand = mesh.verts!.reduce((m, p, i) => (p[0] > mesh.verts![m]![0]! ? i : m), 0);
    const moved = { ...mesh, verts: mesh.verts!.map((p, i) => (i === hand ? ([p[0] + 1, p[1] - 2, p[2] + 0.5] as [number, number, number]) : p)) };
    const out = mirrorResult(mesh, moved, [hand], 0);
    const twin = twinPoints(mesh, 0)[hand]!;
    expect(out.verts![twin]).toEqual([-out.verts![hand]![0], out.verts![hand]![1], out.verts![hand]![2]]);
  });

  it("exports as a .glb", () => {
    expect(exportGlb(doc).length).toBeGreaterThan(1000);
  });

  it.runIf(!!process.env.NOVA_MAKE_HERO)("writes the files (NOVA_MAKE_HERO=<models folder>)", () => {
    const dir = process.env.NOVA_MAKE_HERO!;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "hero.model.json"), serializeModel(doc));
    writeFileSync(join(dir, "hero.glb"), exportGlb(doc));
  });
});
