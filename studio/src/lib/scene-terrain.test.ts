import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { gridFromPixels, heightAt, terrainOf } from "./scene-terrain";
import { instanceScene, ModelShapes } from "./scene-three";
import { newModel } from "./model-doc";
import type { Scene } from "./scene-model";

const scene = (objects: unknown[]) => ({ version: 1, objects }) as unknown as Scene;

describe("the hills in the scene view", () => {
  it("finds the ground in an object's terrain setting and works out the engine's heights", () => {
    const s = scene([
      { kind: "tree", x: 0, y: 0, z: 0 },
      { kind: "race", x: 0, y: 0, z: 0, props: { terrain: { waves: [{ height: 5, wavelength: 400, direction: 90, phase: 0.5 }, { height: 2, wavelength: 100, direction: 0 }] } } },
    ]);
    const t = terrainOf(s)!;
    expect(t.waves.length).toBe(2);
    // direction 90 runs along +z: 5 sin(2 pi z / 400 + 0.5); direction 0 along +x: 2 sin(2 pi x / 100)
    const want = (x: number, z: number) => 5 * Math.sin((2 * Math.PI * z) / 400 + 0.5) + 2 * Math.sin((2 * Math.PI * x) / 100);
    for (const [x, z] of [[0, 0], [25, 0], [10, 100], [-300, 77]]) expect(heightAt(t, null, x!, z!)).toBeCloseTo(want(x!, z!), 4);
    expect(terrainOf(scene([{ kind: "tree", x: 0, y: 0, z: 0 }]))).toBeNull();
    expect(heightAt(null, null, 3, 4)).toBe(0);
  });

  it("reads a heightmap picture as the engine does and blends between its samples", () => {
    const t = terrainOf(scene([{ kind: "race", x: 0, y: 0, z: 0, props: { terrain: { heightmap: "terrain/h.png", x: -10, z: -10, size: 20, height: 40 } } }]))!;
    expect(t.heightmap).toEqual({ path: "terrain/h.png", x: -10, z: -10, size: 20, cell: undefined, height: 40 });
    // 2 by 2 grey pixels: black, white / white, black (grey: R = G, so grey / 255 of the height)
    const px = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255]);
    const g = gridFromPixels(px, 2, 2, t.heightmap!);
    expect(g.cell).toBe(20);
    expect(heightAt(t, g, -10, -10)).toBeCloseTo(0, 3);
    expect(heightAt(t, g, 10, -10)).toBeCloseTo(40 * (255 * 257) / 65535, 3);
    expect(heightAt(t, g, 0, 0)).toBeCloseTo(20 * (255 * 257) / 65535, 3); // the middle: half of each
    expect(heightAt(t, g, -50, -50)).toBeCloseTo(0, 3); // beyond the edge: the edge's height
  });

  it("draws an object with the model its settings name", () => {
    const road = { ...newModel() };
    const models = new Map([["model:road_x", road]]);
    const s = scene([{ kind: "road", x: 0, y: 0, z: 0, props: { model: "road_x" } }, { kind: "road", x: 0, y: 0, z: 0, props: { model: "nowhere" } }]);
    const out = instanceScene(s, models, new ModelShapes());
    expect(out.slots.has(0)).toBe(true);
    expect(out.markers).toEqual([1]); // (a model that is not there: a marker box, as for a kind without a model)
    for (const m of out.meshes) expect(m).toBeInstanceOf(THREE.InstancedMesh);
  });
});
