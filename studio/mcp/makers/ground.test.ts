import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../server";
// @ts-ignore (plain JavaScript)
import { makeSurfaces, SURFACES } from "./surface.mjs";

const pine = new URL("../../../examples/pine-ridge-rally/", import.meta.url).pathname;
let dir = "";
beforeAll(() => (dir = mkdtempSync(join(tmpdir(), "nova-ground-test-"))));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const said = (r: ReturnType<typeof call>) => (r.content[0] as { text: string }).text;

describe("surface_make, road_make, land_make", () => {
  it("make Pine Ridge Rally's pictures, land and roads exactly with seed 1 and no options", () => {
    const means = makeSurfaces(SURFACES, {}, (name: string, bytes: Uint8Array) => expect(Buffer.compare(Buffer.from(bytes), readFileSync(join(pine, "textures", `${name}.png`))), name).toBe(0));
    expect(`${JSON.stringify(means, null, 2)}\n`).toBe(readFileSync(join(pine, "textures/means.json"), "utf8"));
    // the land and the roads, through the tools, in a copy of the game's tracks and pictures
    const p = join(dir, "pine");
    cpSync(join(pine, "tracks"), join(p, "tracks"), { recursive: true });
    cpSync(join(pine, "textures"), join(p, "textures"), { recursive: true });
    cpSync(join(pine, "nova.json"), join(p, "nova.json"));
    call("land_make", { project: p, name: "land_snow", ground: "snow", preview: false });
    expect(Buffer.compare(readFileSync(join(p, "models/land_snow.glb")), readFileSync(join(pine, "models/land_snow.glb")))).toBe(0);
    call("road_make", { project: p, tracks: ["pine_ridge", "stage_canyon"], preview: false });
    for (const t of ["pine_ridge", "stage_canyon"]) expect(Buffer.compare(readFileSync(join(p, `models/road_${t}.glb`)), readFileSync(join(pine, `models/road_${t}.glb`))), t).toBe(0);
  }, 120_000);

  it("make another pattern for another seed and wear the road as asked, the same again each time", () => {
    const one = (o: Record<string, unknown>) => { let out: Buffer | null = null; makeSurfaces(["road"], o, (_: string, b: Uint8Array) => (out = Buffer.from(b))); return out!; };
    expect(Buffer.compare(one({ seed: 2 }), one({ seed: 2 }))).toBe(0);
    expect(Buffer.compare(one({ seed: 2 }), one({}))).not.toBe(0);
    expect(Buffer.compare(one({ road: { cracks: 0, patches: 0, skids: 0, line: 0 } }), one({}))).not.toBe(0);
  }, 120_000);

  it("make what they need, and refuse what they cannot make", () => {
    const p = join(dir, "fresh");
    const r = said(call("road_make", { project: p, name: "loop", control: [[0, 60], [55, 30], [50, -40], [0, -60], [-50, -40], [-55, 30]], textured: true, preview: false }));
    expect(r).toMatch(/made textures\/road\.png, textures\/road_grain\.png with surface_make/);
    const l = said(call("land_make", { project: p, name: "land", ground: "sand", preview: false }));
    expect(l).toMatch(/made textures\/ground_sand\.png, textures\/sand_detail\.png/);
    expect(JSON.parse(readFileSync(join(p, "textures/means.json"), "utf8")).ground_sand).toHaveLength(3);
    expect(() => call("surface_make", { project: p, surfaces: ["lava"] })).toThrow(/no surface "lava"/);
    expect(() => call("land_make", { project: p, name: "x", ground: "lava" })).toThrow(/ground is grass/);
    expect(() => call("road_make", { project: p, control: [[0, 0]], name: "x" })).toThrow(/at least four/);
  }, 120_000);
});
