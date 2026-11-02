import { describe, expect, it } from "vitest";
import { buildTree, fileKind, visibleRows } from "./tree";

const files = (paths: string[]) => paths.map((p) => ({ path: p, dir: p.endsWith("/"), size: 1 })).map((e) => ({ ...e, path: e.path.replace(/\/$/, "") }));

describe("buildTree", () => {
  it("nests files under folders, folders first, names in natural order", () => {
    const tree = buildTree(files(["scenes/", "scenes/b.lua", "scenes/a.lua", "main.lua", "nova.json", "sprites/", "sprites/p10.png", "sprites/p2.png"]));
    expect(tree.map((n) => n.name)).toEqual(["scenes", "sprites", "main.lua", "nova.json"]);
    expect(tree[0]!.children.map((n) => n.name)).toEqual(["a.lua", "b.lua"]);
    expect(tree[1]!.children.map((n) => n.name)).toEqual(["p2.png", "p10.png"]);
  });

  it("creates missing parent folders and keeps empty folders", () => {
    const tree = buildTree(files(["a/b/c.lua", "empty/"]));
    expect(tree.map((n) => n.name)).toEqual(["a", "empty"]);
    expect(tree[0]!.children[0]!.name).toBe("b");
    expect(tree[0]!.children[0]!.children[0]!.path).toBe("a/b/c.lua");
    expect(tree[1]!.children).toEqual([]);
  });

  it("handles an empty project", () => {
    expect(buildTree([])).toEqual([]);
  });
});

describe("visibleRows", () => {
  it("shows children only of open folders, with depth", () => {
    const tree = buildTree(files(["a/", "a/x.lua", "a/b/", "a/b/y.lua", "z.lua"]));
    expect(visibleRows(tree, new Set()).map((r) => r.node.path)).toEqual(["a", "z.lua"]);
    const rows = visibleRows(tree, new Set(["a", "a/b"]));
    expect(rows.map((r) => [r.node.path, r.depth])).toEqual([["a", 0], ["a/b", 1], ["a/b/y.lua", 2], ["a/x.lua", 1], ["z.lua", 0]]);
  });
});

describe("fileKind", () => {
  it("classifies files by name", () => {
    const cases: [string, string][] = [
      ["nova.json", "manifest"], ["scenes/play.scene.json", "scene"], ["sprites/hero.sprite.json", "sheet"], ["data.json", "json"],
      ["main.lua", "lua"], ["a/b.PNG", "image"], ["m.glb", "model"], ["s.wav", "sound"], ["t.ogg", "sound"], ["f.ttf", "font"], ["notes.txt", "other"], ["Makefile", "other"],
    ];
    for (const [path, kind] of cases) expect(fileKind(path), path).toBe(kind);
  });
});
