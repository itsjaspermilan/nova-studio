import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../server";
// @ts-ignore (plain JavaScript)
import { Canvas } from "./car/trace-img.mjs";
import { knownTraces } from "./trace";

let dir = "";
let drawing = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nova-trace-test-"));
  // a drawing of a box car from the side: 10 pixels a model unit, the ground at row 300, z = 0 at column 400, the nose on the left;
  // the body 60 units long (z -30 to 30) and 12 high, from 3 up; a dimension line under it
  const c = new Canvas(800, 400);
  const X = (z: number) => 400 - z * 10, Y = (v: number) => 300 - v * 10;
  for (const [z0, v0, z1, v1] of [[-30, 3, 30, 3], [-30, 15, 30, 15], [-30, 3, -30, 15], [30, 3, 30, 15]]) c.line(X(z0), Y(v0), X(z1), Y(v1), [0, 0, 0]);
  c.line(X(30), 340, X(-30), 340, [0, 0, 0]);
  drawing = join(dir, "box.png");
  c.save(drawing);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const said = (r: ReturnType<typeof call>) => r.content.filter((x) => x.type === "text").map((x) => (x as { text: string }).text).join("\n");

describe("blueprint_trace", () => {
  it("calibrates a view from a dimension line, crops it in model units and reads its outline", () => {
    const cal = said(call("blueprint_trace", { project: dir, file: drawing, do: "calibrate", view: "side", from: [100, 340], to: [700, 340], length: 3.75, ground: 300, zero: 400, nose: "left" }));
    expect(cal).toMatch(/"k":10,"sx":-1/);
    const crop = call("blueprint_trace", { project: dir, file: drawing, do: "crop", view: "side", cal: { side: { ox: 400, oy: 300, k: 10, sx: -1 } }, region: [-32, 0, 32, 17], zoom: 1 });
    expect(crop.content.some((x) => x.type === "image")).toBe(true);
    const sil = said(call("blueprint_trace", { project: dir, file: drawing, do: "silhouette", cal: { side: { ox: 400, oy: 300, k: 10, sx: -1 } }, rects: { side: [50, 100, 750, 320] } }));
    // (the box's top line is at 15 and its underside at 3, all along)
    expect(sil).toMatch(/^z 0: 15 3 /m);
    expect(sil).toMatch(/^z -25: 15 3 /m);
  });

  it("knows the calibrations of the cars already traced and refuses what it cannot read", () => {
    expect(Object.keys(knownTraces())).toEqual(expect.arrayContaining(["gt", "offroad", "s14", "truck"]));
    expect(() => call("blueprint_trace", { project: dir, file: join(dir, "none.png"), do: "overview" })).toThrow(/there is no drawing/);
    expect(() => call("blueprint_trace", { project: dir, file: drawing, do: "crop", view: "side", rect: [0, 0, 10, 10] })).toThrow(/calibrate the side view first/);
  });
});
