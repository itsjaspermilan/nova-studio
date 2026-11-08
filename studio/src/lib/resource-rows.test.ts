import { describe, expect, it } from "vitest";
import { resourceRows, type Resource } from "./resources";

const item = (name: string): Resource => ({ kind: "scene", name, path: `scenes/${name}.scene.json`, files: [`scenes/${name}.scene.json`] });
const show = (rows: ReturnType<typeof resourceRows>) => rows.map((r) => `${"  ".repeat(r.depth)}${r.kind === "folder" ? `${r.open ? "▾" : "▸"} ${r.name} (${r.count})` : r.label}`);

describe("the resource tree's folders", () => {
  const items = ["title", "levels/castle-2", "levels/castle-1", "map", "levels/grass/grass-10", "levels/grass/grass-2"].map(item);

  it("start collapsed: only the folders and the loose items show, folders first", () => {
    expect(show(resourceRows(items, "scenes", new Set()))).toEqual(["▸ levels (4)", "map", "title"]);
  });

  it("open one folder at a time, with its own folders first and numbers in order", () => {
    expect(show(resourceRows(items, "scenes", new Set(["scenes:levels"])))).toEqual(["▾ levels (4)", "  ▸ grass (2)", "  castle-1", "  castle-2", "map", "title"]);
    expect(show(resourceRows(items, "scenes", new Set(["scenes:levels", "scenes:levels/grass"])))).toEqual(
      ["▾ levels (4)", "  ▾ grass (2)", "    grass-2", "    grass-10", "  castle-1", "  castle-2", "map", "title"],
    );
  });

  it("keep each group's folders apart", () => {
    expect(show(resourceRows(items, "scenes", new Set(["sprites:levels"])))).toEqual(["▸ levels (4)", "map", "title"]);
  });
});
