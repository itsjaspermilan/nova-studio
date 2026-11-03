import { describe, expect, it } from "vitest";
import { extrudeFace, freshMesh, toMesh } from "./mesh-edit";
import { addCube, newModel, parseModel, serializeModel, type Cube, type ModelDoc, type Shape } from "./model-doc";
import { meshOf, solidOf } from "./model-mesh";
import { bakeColors, boxRects, packBlocks, packModel, unwrap, uvsOf, type UV } from "./model-uv";
import { getPixel, newRaster } from "./pixels";

const shape = (s: Shape, extra: Partial<Cube> = {}): Cube => ({ shape: s, from: [0, 0, 0], size: [8, 6, 4], color: "#c9d1d9", segments: 8, texture: { at: [0, 0] }, ...extra });
const area = (p: UV[]) => p.reduce((a, q, i) => a + (q[0] * p[(i + 1) % p.length]![1] - p[(i + 1) % p.length]![0] * q[1]), 0) / 2;
const area3 = (pts: number[][]) => {
  let [x, y, z] = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
    x += (a[1]! - b[1]!) * (a[2]! + b[2]!);
    y += (a[2]! - b[2]!) * (a[0]! + b[0]!);
    z += (a[0]! - b[0]!) * (a[1]! + b[1]!);
  }
  return Math.hypot(x, y, z) / 2;
};

describe("unwrapping", () => {
  it("lays a box out as a cross of faces that do not overlap", () => {
    const u = unwrap(shape("box"));
    expect(u.size).toEqual([2 * 4 + 2 * 8, 4 + 6]);
    const rects = Object.values(boxRects(8, 6, 4));
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const [a, b] = [rects[i]!, rects[j]!];
      const apart = a[0] + a[2] <= b[0] || b[0] + b[2] <= a[0] || a[1] + a[3] <= b[1] || b[1] + b[3] <= a[1];
      expect(apart, `${i} ${j}`).toBe(true);
    }
    for (const p of u.polys) for (const q of p) {
      expect(q[0]).toBeGreaterThanOrEqual(0);
      expect(q[0]).toBeLessThanOrEqual(u.size[0]);
      expect(q[1]).toBeLessThanOrEqual(u.size[1]);
    }
  });

  it("gives each face texels in proportion to its size, none mirrored", () => {
    for (const s of ["box", "wedge", "pyramid"] as Shape[]) {
      const c = shape(s, { size: [8, 6, 4], texture: { at: [0, 0], scale: 2 } });
      const solid = solidOf(c);
      const un = unwrap(c);
      const signs = new Set<number>();
      solid.polys.forEach((p, i) => {
        const flat = area3(p.v.map((k) => solid.verts[k]!));
        const tex = Math.abs(area(un.polys[i]!));
        if (s === "box") expect(tex, `${s} ${i}`).toBeCloseTo(flat * 4, 6);
        signs.add(Math.sign(area(un.polys[i]!)));
      });
      expect([...signs], `${s} handedness`).toEqual([-1]);
    }
  });

  it("unrolls round shapes into a strip and flat caps inside the block", () => {
    for (const s of ["cylinder", "cone", "sphere"] as Shape[]) {
      const c = shape(s);
      const u = unwrap(c);
      expect(u.polys).toHaveLength(solidOf(c).polys.length);
      for (const p of u.polys) for (const q of p) {
        expect(q[0], s).toBeGreaterThanOrEqual(-1e-9);
        expect(q[1], s).toBeGreaterThanOrEqual(-1e-9);
        expect(q[0], s).toBeLessThanOrEqual(u.size[0] + 1e-9);
        expect(q[1], s).toBeLessThanOrEqual(u.size[1] + 1e-9);
      }
      // the same handedness as a box (image y runs down, so outward-counter-clockwise polygons come out negative)
      const signs = new Set(u.polys.map((p) => Math.sign(Math.round(area(p) * 1e6))).filter((x) => x !== 0));
      expect([...signs], `${s} handedness`).toEqual([-1]);
    }
  });

  it("flattens each polygon of a mesh without stretching it, and packs the flats apart", () => {
    const tower = extrudeFace(toMesh(shape("box", { size: [8, 8, 8] })), 2, 6).cube;
    tower.texture = { at: [0, 0], scale: 1 };
    const solid = solidOf(tower);
    const un = unwrap(tower);
    solid.polys.forEach((p, i) => expect(Math.abs(area(un.polys[i]!))).toBeCloseTo(area3(p.v.map((k) => solid.verts[k]!)), 6));
    expect([...new Set(un.polys.map((p) => Math.sign(Math.round(area(p) * 1e6))))]).toEqual([-1]);
    // flats may touch no other flat: every polygon's texel centre lies in exactly one polygon
    const hits = (x: number, y: number) => un.polys.filter((p) => {
      let inside = false;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        if (p[i]![1] > y !== p[j]![1] > y && x < ((p[j]![0] - p[i]![0]) * (y - p[i]![1])) / (p[j]![1] - p[i]![1]) + p[i]![0]) inside = !inside;
      }
      return inside;
    }).length;
    for (let y = 0; y < un.size[1]; y++) for (let x = 0; x < un.size[0]; x++) expect(hits(x + 0.5, y + 0.5)).toBeLessThanOrEqual(1);
    expect(unwrap(freshMesh()).size[0]).toBeGreaterThan(0);
  });

  it("gives one texel pair per emitted vertex, offset by where the block sits", () => {
    const c = shape("cylinder", { texture: { at: [10, 20] } });
    const uvs = uvsOf(c);
    expect(uvs.length).toBe((meshOf(c).positions.length / 3) * 2);
    for (let i = 0; i < uvs.length; i += 2) {
      expect(uvs[i]).toBeGreaterThanOrEqual(10 - 1e-9);
      expect(uvs[i + 1]).toBeGreaterThanOrEqual(20 - 1e-9);
    }
    expect(uvsOf({ ...c, texture: undefined })).toEqual([]);
    expect(uvsOf(shape("box", { size: [4, 0, 4] }))).toEqual([]);
  });
});

describe("packing", () => {
  it("places blocks without overlap and grows the texture when they do not fit", () => {
    const blocks: [number, number][] = [[20, 10], [30, 30], [12, 40], [50, 8]];
    const r = packBlocks(blocks, [64, 64]);
    expect(r.fits).toBe(true);
    for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
      const [a, b] = [{ x: r.at[i]![0], y: r.at[i]![1], w: blocks[i]![0], h: blocks[i]![1] }, { x: r.at[j]![0], y: r.at[j]![1], w: blocks[j]![0], h: blocks[j]![1] }];
      expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
    }
    blocks.forEach((b, i) => {
      expect(r.at[i]![0] + b[0]).toBeLessThanOrEqual(r.size[0]);
      expect(r.at[i]![1] + b[1]).toBeLessThanOrEqual(r.size[1]);
    });
    expect(packBlocks([[100, 10]], [64, 64]).size[0]).toBe(128);
    expect(packBlocks([[2000, 10]], [64, 64]).fits).toBe(false);
    expect(packBlocks([], [32, 32])).toMatchObject({ at: [], fits: true });
  });

  it("packs every textured shape of a model and records the texture size", () => {
    let d: ModelDoc = { ...newModel(), texture: { size: [16, 16] } };
    d = addCube(d, [0], shape("box")).doc;
    d = addCube(d, [0], shape("sphere", { texture: { at: [3, 3] } })).doc;
    const r = packModel(d);
    expect(r.fits).toBe(true);
    const [a, b] = [r.doc.parts[0]!.cubes[1]!, r.doc.parts[0]!.cubes[2]!];
    expect(a.texture!.at).not.toEqual(b.texture!.at);
    expect(r.doc.texture!.size[0]).toBeGreaterThanOrEqual(2 * 4 + 2 * 8);
    expect(r.doc.parts[0]!.cubes[0]!.texture).toBeUndefined(); // untextured shapes are left alone
    expect(d.parts[0]!.cubes[1]!.texture!.at).toEqual([0, 0]); // the input is untouched
  });
});

describe("baking colours", () => {
  it("paints each face's colour into its texels", () => {
    const c = shape("box", { size: [4, 4, 4], faces: { up: "#ff0000" }, color: "#0000ff", texture: { at: [2, 3] } });
    const r = newRaster(40, 20);
    bakeColors(r, c);
    const up = boxRects(4, 4, 4).up!;
    expect(getPixel(r, 2 + up[0] + 1, 3 + up[1] + 1)).toEqual([255, 0, 0, 255]);
    const north = boxRects(4, 4, 4).north!;
    expect(getPixel(r, 2 + north[0] + 1, 3 + north[1] + 1)).toEqual([0, 0, 255, 255]);
    expect(getPixel(r, 0, 0)).toEqual([0, 0, 0, 0]);
    // every texel of the cross is covered, none outside it
    const covered = (x: number, y: number) => getPixel(r, x, y)![3] > 0;
    for (const f of Object.values(boxRects(4, 4, 4))) for (let y = 0; y < f[3]; y++) for (let x = 0; x < f[2]; x++) expect(covered(2 + f[0] + x, 3 + f[1] + y)).toBe(true);
  });

  it("round-trips the texture fields through the file", () => {
    let d: ModelDoc = { ...newModel(), texture: { size: [64, 32] } };
    d = addCube(d, [0], shape("box", { texture: { at: [4, 8], scale: 2 } })).doc;
    d = addCube(d, [0], shape("cone", { texture: { at: [0, 0] } })).doc;
    const text = serializeModel(d);
    expect(text).toContain('"texture": { "size": [64, 32] }');
    expect(text).toContain('"texture": { "at": [4, 8], "scale": 2 }');
    const back = parseModel(text);
    expect(back.ok).toBe(true);
    if (back.ok) expect(serializeModel(back.doc)).toBe(text);
    const base = JSON.parse(text);
    expect(parseModel(JSON.stringify({ ...base, texture: { size: [3, 64] } }))).toMatchObject({ ok: false });
    expect(parseModel(JSON.stringify({ ...base, texture: undefined }))).toMatchObject({ ok: false });
    base.parts[0].cubes[1].texture.at = [-1, 0];
    expect(parseModel(JSON.stringify(base))).toMatchObject({ ok: false });
  });
});

import { blockOf, enableTexture, freeSpot, resizeTexture } from "./model-uv";

describe("giving a shape texels", () => {
  it("finds the first free spot and respects the picture's edges", () => {
    expect(freeSpot([], 10, 10, [32, 32])).toEqual([0, 0]);
    expect(freeSpot([{ x: 0, y: 0, w: 10, h: 10 }], 10, 10, [32, 32])).toEqual([11, 0]);
    expect(freeSpot([{ x: 0, y: 0, w: 30, h: 10 }], 10, 10, [32, 32])).toEqual([0, 11]);
    expect(freeSpot([{ x: 0, y: 0, w: 32, h: 32 }], 4, 4, [32, 32])).toBeNull();
    expect(freeSpot([], 33, 4, [32, 32])).toBeNull();
  });

  it("turns texturing on for a shape: a block of its own, its colours baked in, a white tint left", () => {
    let d: ModelDoc = newModel();
    d.parts[0]!.cubes = [{ from: [0, 0, 0], size: [4, 4, 4], color: "#0000ff", faces: { up: "#ff0000" } }];
    const r = enableTexture(d, null, [0], 0)!;
    expect(r.fits).toBe(true);
    expect(r.doc.texture!.size).toEqual([64, 64]);
    const cube = r.doc.parts[0]!.cubes[0]!;
    expect(cube.texture!.at).toEqual([0, 0]);
    expect([cube.color, cube.faces]).toEqual(["#ffffff", undefined]);
    const up = boxRects(4, 4, 4).up!;
    expect(getPixel(r.picture, up[0] + 1, up[1] + 1)).toEqual([255, 0, 0, 255]);
    expect(getPixel(r.picture, 60, 60)).toEqual([0, 0, 0, 0]);
    expect(d.parts[0]!.cubes[0]!.texture).toBeUndefined(); // the input is untouched

    // a second shape gets a block beside the first, and the painting of the first survives
    d = r.doc;
    d.parts[0]!.cubes.push({ from: [0, 0, 0], size: [4, 4, 4], color: "#00ff00" });
    const second = enableTexture(d, r.picture, [0], 1)!;
    const [a, b] = second.doc.parts[0]!.cubes.map(blockOf);
    expect(b!.x).toBeGreaterThan(a!.x + a!.w - 1);
    expect(getPixel(second.picture, up[0] + 1, up[1] + 1)).toEqual([255, 0, 0, 255]);
    expect(enableTexture(d, null, [0], 9)).toBeNull();
    expect(enableTexture(d, null, [3], 0)).toBeNull();
  });

  it("grows the picture when a shape does not fit: wider if the block is wider, otherwise taller", () => {
    let d: ModelDoc = { ...newModel(), texture: { size: [16, 16] } };
    d.parts[0]!.cubes = [{ from: [0, 0, 0], size: [8, 8, 8], color: "#999999" }, { from: [0, 0, 0], size: [8, 8, 8], color: "#999999" }];
    const first = enableTexture(d, null, [0], 0)!; // needs 32 x 16
    expect(blockOf(first.doc.parts[0]!.cubes[0]!)).toMatchObject({ w: 32, h: 16 });
    expect(first.fits).toBe(true);
    expect(first.doc.texture!.size).toEqual([32, 16]);
    expect([first.picture.w, first.picture.h]).toEqual([32, 16]);
    const second = enableTexture(first.doc, first.picture, [0], 1)!; // no room beside or below: grows downward
    expect(second.doc.texture!.size).toEqual([32, 64]);
    expect(blockOf(second.doc.parts[0]!.cubes[1]!).y).toBeGreaterThanOrEqual(17);
  });

  it("resizes the picture keeping the top-left", () => {
    const d: ModelDoc = { ...newModel(), texture: { size: [16, 16] } };
    const p = newRaster(16, 16);
    p.data.set([9, 8, 7, 255], 0);
    const bigger = resizeTexture(d, p, 32, 64);
    expect(bigger.doc.texture!.size).toEqual([32, 64]);
    expect([bigger.picture.w, bigger.picture.h]).toEqual([32, 64]);
    expect(getPixel(bigger.picture, 0, 0)).toEqual([9, 8, 7, 255]);
    expect(resizeTexture(d, p, 2, 99999).doc.texture!.size).toEqual([8, 1024]);
    expect(resizeTexture(d, p, 8, 8).picture.w).toBe(8);
  });
});

import { mirrorElement, type Axis } from "./mesh-edit";

describe("mirrored copies of painted boxes", () => {
  const pairs = (c: Cube) => {
    const m = meshOf(c);
    const uv = uvsOf(c);
    return new Set(Array.from({ length: m.positions.length / 3 }, (_, i) => [m.positions[i * 3]!, m.positions[i * 3 + 1]!, m.positions[i * 3 + 2]!, uv[i * 2]!, uv[i * 2 + 1]!].map((x) => (Math.abs(x) < 1e-9 ? 0 : x).toFixed(4)).join(",")));
  };
  it("put every texel at the reflection of where the original has it", () => {
    for (const axis of [0, 1, 2] as Axis[]) {
      const c = shape("box", { from: [2, 3, 5], size: [8, 6, 4], texture: { at: [3, 4] } });
      const m = mirrorElement(c, axis);
      expect(m.texture!.mirror).toBe(1 << axis);
      const reflected = new Set([...pairs(c)].map((s) => {
        const p = s.split(",").map(Number);
        p[axis] = -p[axis]!;
        return p.map((x) => (Math.abs(x) < 1e-9 ? 0 : x).toFixed(4)).join(",");
      }));
      expect(pairs(m), `axis ${axis}`).toEqual(reflected);
      // mirroring the copy again gives the original's texels back
      expect(mirrorElement(m, axis).texture!.mirror).toBeUndefined();
    }
  });

  it("keep their block and survive the file", () => {
    const c = mirrorElement(shape("box", { texture: { at: [3, 4], scale: 2 } }), 0);
    expect(c.texture).toEqual({ at: [3, 4], scale: 2, mirror: 1 });
    let d: ModelDoc = { ...newModel(), texture: { size: [64, 64] } };
    d = addCube(d, [0], c).doc;
    const text = serializeModel(d);
    expect(text).toContain('"scale": 2, "mirror": 1');
    const back = parseModel(text);
    expect(back.ok && serializeModel(back.doc)).toBe(text);
    expect(parseModel(text.replace('"mirror": 1', '"mirror": 9'))).toMatchObject({ ok: false });
  });
});

import { faceRects } from "./model-uv";

describe("placing single faces by hand", () => {
  const painted = (extra: Partial<NonNullable<Cube["texture"]>> = {}): Cube => shape("box", { size: [4, 4, 4], texture: { at: [2, 3], ...extra } });
  const uvBox = (c: Cube, poly: number) => {
    const un = unwrap(c);
    const xs = un.polys[poly]!.map((q) => q[0] + c.texture!.at[0]);
    const ys = un.polys[poly]!.map((q) => q[1] + c.texture!.at[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  };
  const polyOf = (c: Cube, face: string) => solidOf(c).polys.findIndex((p) => p.face === face);

  it("reports each face's automatic rectangle, and a hand-placed one in its place", () => {
    const auto = faceRects(painted())!;
    const up = boxRects(4, 4, 4).up!;
    expect(auto.up).toEqual([2 + up[0], 3 + up[1], up[2], up[3]]);
    const moved = faceRects(painted({ faces: { up: [30, 20, 6, 5] } }))!;
    expect(moved.up).toEqual([30, 20, 6, 5]);
    expect(moved.down).toEqual(auto.down);
    expect(faceRects(shape("sphere"))).toBeNull();
    expect(faceRects({ ...painted(), texture: undefined })).toBeNull();
  });

  it("maps the face's corners onto the rectangle it was given", () => {
    const c = painted({ faces: { east: [30, 20, 8, 6] } });
    expect(uvBox(c, polyOf(c, "east"))).toEqual([30, 20, 8, 6]);
    // the other faces stay where the automatic layout puts them
    const plain = painted();
    expect(uvBox(c, polyOf(c, "north"))).toEqual(uvBox(plain, polyOf(plain, "north")));
  });

  it("is saved and checked", () => {
    let d: ModelDoc = { ...newModel(), texture: { size: [64, 64] } };
    d = addCube(d, [0], painted({ faces: { up: [30, 20, 6, 5] } })).doc;
    const text = serializeModel(d);
    expect(text).toContain('"faces": {"up":[30,20,6,5]}');
    const back = parseModel(text);
    expect(back.ok && serializeModel(back.doc)).toBe(text);
    expect(parseModel(text.replace("[30,20,6,5]", "[30,20,0,5]"))).toMatchObject({ ok: false });
    expect(parseModel(text.replace('"up"', '"top"'))).toMatchObject({ ok: false });
    expect(parseModel(text.replace("[30,20,6,5]", "[30,20,6]"))).toMatchObject({ ok: false });
  });
});

import { flippedRect, normRect, rectAt } from "./model-uv";

describe("flipping a placed face", () => {
  const box = (faces: Record<string, number[]>): Cube => ({ shape: "box", from: [0, 0, 0], size: [4, 4, 4], color: "#ffffff", texture: { at: [0, 0], faces: faces as never } });
  const cornerUV = (c: Cube, face: string) => {
    const poly = solidOf(c).polys.findIndex((p) => p.face === face);
    return unwrap(c).polys[poly]!.map((q) => q.map((n) => Math.round(n * 100) / 100).join(","));
  };

  it("runs a negative size the other way from its corner, so the same face comes out mirrored", () => {
    const plain = cornerUV(box({ up: [20, 10, 8, 6] }), "up");
    const across = cornerUV(box({ up: flippedRect([20, 10, 8, 6], true) }), "up");
    const down = cornerUV(box({ up: flippedRect([20, 10, 8, 6], false) }), "up");
    // the same four corners reached by mirroring x (20 <-> 28) or y (10 <-> 16)
    expect(across).toEqual(plain.map((s) => { const [x, y] = s.split(",").map(Number); return `${48 - x!},${y}`; }));
    expect(down).toEqual(plain.map((s) => { const [x, y] = s.split(",").map(Number); return `${x},${26 - y!}`; }));
  });

  it("normalises, moves and flips rectangles", () => {
    expect(normRect([28, 10, -8, 6])).toEqual([20, 10, 8, 6]);
    expect(normRect([20, 16, 8, -6])).toEqual([20, 10, 8, 6]);
    expect(rectAt([28, 10, -8, 6], 2, 3)).toEqual([10, 3, -8, 6]);
    expect(rectAt([20, 10, 8, 6], 2, 3)).toEqual([2, 3, 8, 6]);
    expect(flippedRect(flippedRect([20, 10, 8, 6], true), true)).toEqual([20, 10, 8, 6]);
  });

  it("is saved and checked", () => {
    let d: ModelDoc = { ...newModel(), texture: { size: [64, 64] } };
    d = addCube(d, [0], box({ up: flippedRect([20, 10, 8, 6], true) })).doc;
    const text = serializeModel(d);
    expect(text).toContain('"up":[28,10,-8,6]');
    const back = parseModel(text);
    expect(back.ok && serializeModel(back.doc)).toBe(text);
    expect(parseModel(text.replace("[28,10,-8,6]", "[3,10,-8,6]"))).toMatchObject({ ok: false }); // runs off the left edge
    expect(parseModel(text.replace("[28,10,-8,6]", "[28,10,0,6]"))).toMatchObject({ ok: false });
  });
});
