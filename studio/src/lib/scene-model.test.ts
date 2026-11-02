import { describe, expect, it } from "vitest";
import { History, addItem, afterRemoval, boundsOf, drawOrder, duplicateItem, hitTest, moveTo, parseScene, removeItem, serializeScene, setField, snap, uniqueName, worldSize, type Scene } from "./scene-model";

const text = `{
  "version": 1,
  "background": [92, 150, 214],
  "objects": [
    { "kind": "player", "name": "hero", "x": 480, "y": 440 },
    { "kind": "crate", "x": 100, "y": 440, "props": { "hp": 3 } }
  ],
  "images": [
    { "image": "sprites/star.png", "x": 24, "y": 24, "scale": 2, "layer": "ui" },
    { "image": "sprites/bg.png", "x": 0, "y": 0, "depth": 50 }
  ],
  "texts": [ { "text": "HI\\nTHERE", "x": 8, "y": 8, "scale": 2 } ],
  "tilemaps": [ { "name": "g", "tileset": { "image": "t.png", "tile_width": 16, "tile_height": 16 }, "x": 0, "y": 0, "tiles": [[0, 1], [1, 0]] } ]
}`;
const scene = (): Scene => {
  const p = parseScene(text);
  if (!p.ok) throw new Error(p.error);
  return p.scene;
};
const sizes = new Map([["sprites/star.png", { w: 20, h: 10 }], ["sprites/bg.png", { w: 960, h: 540 }]]);

describe("parse and serialize", () => {
  it("rejects bad input with a reason", () => {
    expect(parseScene("{ nope")).toMatchObject({ ok: false });
    expect(parseScene("[]")).toMatchObject({ ok: false, error: "a scene file is a JSON object" });
    expect(parseScene('{"objects": {}}')).toMatchObject({ ok: false, error: '"objects" must be a list' });
    expect(parseScene('{"objects": [{"kind": "a"}]}')).toMatchObject({ ok: false, error: 'objects[0] needs numeric "x" and "y"' });
  });

  it("round-trips without losing anything, including tilemaps", () => {
    const out = serializeScene(scene());
    expect(JSON.parse(out)).toEqual(JSON.parse(text));
    expect(parseScene(out)).toMatchObject({ ok: true });
  });

  it("is tidy: numbers inline, one item per line, stable order and trailing newline", () => {
    const out = serializeScene(scene());
    expect(out).toContain('"background": [92, 150, 214]');
    expect(out).toContain('{ "kind": "player", "name": "hero", "x": 480, "y": 440 }');
    expect(out.indexOf('"objects"')).toBeLessThan(out.indexOf('"images"'));
    expect(out.endsWith("}\n")).toBe(true);
    expect(serializeScene(parseScene(out).ok ? (parseScene(out) as { scene: Scene }).scene : ({} as Scene))).toBe(out);
  });
});

describe("geometry", () => {
  it("sizes objects, scaled images and multi-line text", () => {
    const s = scene();
    expect(boundsOf(s, { kind: "objects", index: 0 }, sizes)).toEqual({ x: 480, y: 440, w: 32, h: 32 });
    expect(boundsOf(s, { kind: "images", index: 0 }, sizes)).toEqual({ x: 24, y: 24, w: 40, h: 20 });
    expect(boundsOf(s, { kind: "texts", index: 0 }, sizes)).toEqual({ x: 8, y: 8, w: 5 * 16, h: 32 });
    expect(boundsOf(s, { kind: "objects", index: 9 }, sizes).w).toBe(0);
  });

  it("draws world images (deepest first), objects, then ui images and text; hit tests the top one", () => {
    const s = scene();
    expect(drawOrder(s)).toEqual([
      { kind: "images", index: 1 },
      { kind: "objects", index: 0 },
      { kind: "objects", index: 1 },
      { kind: "images", index: 0 },
      { kind: "texts", index: 0 },
    ]);
    expect(hitTest(s, 490, 450, sizes)).toEqual({ kind: "objects", index: 0 });
    expect(hitTest(s, 60, 42, sizes)).toEqual({ kind: "images", index: 0 }); // ui star over the background
    expect(hitTest(s, 700, 100, sizes)).toEqual({ kind: "images", index: 1 });
    expect(hitTest(s, 5000, 5000, sizes)).toBeNull();
    expect(worldSize(s)).toEqual({ width: 960, height: 540 });
  });
});

describe("editing is immutable and tidy", () => {
  it("moves, edits and clears fields without touching the original", () => {
    const s = scene();
    const moved = moveTo(s, { kind: "objects", index: 0 }, 10, 20);
    expect(moved.objects![0]).toMatchObject({ x: 10, y: 20 });
    expect(s.objects![0]!.x).toBe(480);
    const named = setField(moved, { kind: "objects", index: 0 }, "name", "boss");
    expect(named.objects![0]!.name).toBe("boss");
    expect("name" in setField(named, { kind: "objects", index: 0 }, "name", "")!.objects![0]!).toBe(false);
    expect(setField(s, { kind: "objects", index: 9 }, "x", 1)).toBe(s);
  });

  it("accepts reactive proxies (the editor holds its scene in Svelte state)", () => {
    const proxied = new Proxy(scene(), {});
    expect(moveTo(proxied, { kind: "objects", index: 0 }, 5, 6).objects![0]).toMatchObject({ x: 5, y: 6 });
    expect(duplicateItem(proxied, { kind: "objects", index: 0 })).not.toBeNull();
  });

  it("adds, removes and duplicates, dropping empty lists", () => {
    let s = scene();
    const added = addItem(s, "texts", { text: "A", x: 1, y: 2 });
    expect(added.ref).toEqual({ kind: "texts", index: 1 });
    s = removeItem(removeItem(added.scene, { kind: "texts", index: 1 }), { kind: "texts", index: 0 });
    expect("texts" in s).toBe(false);
    const dup = duplicateItem(scene(), { kind: "objects", index: 0 })!;
    expect(dup.scene.objects![2]).toMatchObject({ kind: "player", name: "hero2", x: 496, y: 456 });
    expect(duplicateItem(scene(), { kind: "objects", index: 9 })).toBeNull();
    expect(afterRemoval(scene(), { kind: "objects", index: 1 })).toEqual({ kind: "objects", index: 1 });
    expect(afterRemoval(removeItem(removeItem(scene(), { kind: "objects", index: 0 }), { kind: "objects", index: 0 }), { kind: "objects", index: 0 })).toBeNull();
  });

  it("makes unique, valid names and snaps to a grid", () => {
    const s = scene();
    expect(uniqueName(s, "hero")).toBe("hero2");
    expect(uniqueName(s, "g")).toBe("g2"); // tilemap names count
    expect(uniqueName(s, "3 bad-name")).toBe("bad_name");
    expect(uniqueName(s, "!!!")).toBe("item");
    expect(snap(37, 16)).toBe(32);
    expect(snap(37.6, 0)).toBe(38);
  });
});

describe("history", () => {
  it("undoes and redoes, and a new edit drops the redo branch", () => {
    const h = new History();
    const a = scene();
    const b = moveTo(a, { kind: "objects", index: 0 }, 1, 1);
    h.record(a);
    expect(h.canUndo).toBe(true);
    expect(h.undo(b)).toBe(a);
    expect(h.canRedo).toBe(true);
    expect(h.redo(a)).toBe(b);
    h.undo(b);
    h.record(a);
    expect(h.canRedo).toBe(false);
    expect(new History().undo(a)).toBeNull();
  });
});
