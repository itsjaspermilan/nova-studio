import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadModelDoc } from "./model-load";
import { embeddedImage } from "./glb-import";
import { walk } from "./model-doc";
import { toBase64 } from "./wav";

const rally = new URL("../../../examples/pine-ridge-rally/", import.meta.url).pathname;
const glb = (name: string) => new Uint8Array(readFileSync(`${rally}models/${name}.glb`));
const api = (files: Record<string, string | Uint8Array>) => ({
  readFile: async (p: string) => {
    const f = files[p];
    if (typeof f !== "string") throw new Error("no such file");
    return { text: f } as never;
  },
  readModel: async (p: string) => {
    const f = files[p];
    if (!(f instanceof Uint8Array)) throw new Error("no such file");
    return `data:model/gltf-binary;base64,${toBase64(f)}`;
  },
});
const colours = (doc: NonNullable<Awaited<ReturnType<typeof loadModelDoc>>>) => {
  const set = new Set<string>();
  for (const { part } of walk(doc)) for (const c of part.cubes) {
    set.add(c.color);
    for (const f of (c as { polys?: { color?: string }[] }).polys ?? []) if (f.color) set.add(f.color);
  }
  return set;
};

describe("a model the scene view can draw", () => {
  it("is read from a plain .glb when there is no .model.json, with the picture's colours when it is decoded", async () => {
    const car = glb("car");
    const image = embeddedImage(car);
    expect(image?.mime).toBe("image/png");
    expect([...image!.bytes.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]); // "PNG"
    const flat = await loadModelDoc(api({ "models/car.glb": car }), "car", async () => undefined);
    expect(flat, "imported without its picture").not.toBeNull();
    // a picture of one colour: every face takes it
    const red = { w: 2, h: 2, data: new Uint8ClampedArray([200, 20, 10, 255, 200, 20, 10, 255, 200, 20, 10, 255, 200, 20, 10, 255]) };
    const painted = await loadModelDoc(api({ "models/car.glb": car }), "car", async () => red);
    expect(painted).not.toBeNull();
    const seen = colours(painted!);
    expect(seen.size).toBeGreaterThan(0);
    for (const c of seen) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
      expect([r, g, b], `colour ${c} should be the picture's red`).toEqual([200, 20, 10]);
    }
    expect(colours(flat!).has("#c8140a")).toBe(false);
  });

  it("is the studio's own model when there is a .model.json, and null when there is nothing", async () => {
    const own = readFileSync(`${rally}../skin-demo/models/walker.model.json`, "utf8");
    expect(await loadModelDoc(api({ "models/walker.model.json": own, "models/walker.glb": glb("car") }), "walker")).not.toBeNull();
    expect(await loadModelDoc(api({}), "nothing")).toBeNull();
  });
});
