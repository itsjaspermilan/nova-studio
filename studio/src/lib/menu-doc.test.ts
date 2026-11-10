import { describe, expect, it } from "vitest";
import { addChild, addNear, allIds, checkMenu, duplicateNode, flatten, labelOf, moveNode, newMenu, newNode, nodeAt, parseMenu, removeNode, serializeMenu, setProp, unwrap, wrapIn } from "./menu-doc";

describe("reading and writing", () => {
  it("reads a menu and says what is wrong with one that is not", () => {
    expect(parseMenu(serializeMenu(newMenu())).ok).toBe(true);
    expect(parseMenu("{ nope")).toMatchObject({ ok: false });
    expect(parseMenu("[]")).toEqual({ ok: false, error: "the menu must be an object" });
    expect(parseMenu('{"kind":"column","children":[{"text":"x"}]}')).toEqual({ ok: false, error: 'the menu.children[0] needs a "kind"' });
    expect(parseMenu('{"kind":"column","children":3}')).toMatchObject({ ok: false });
  });
  it("writes kind, id and text first, the rest in a steady order and the children last", () => {
    const text = serializeMenu({ kind: "button", w: 10, children: [{ kind: "text", text: "x" }], gap: 2, text: "Go", id: "go" });
    expect(Object.keys(JSON.parse(text))).toEqual(["kind", "id", "text", "gap", "w", "children"]);
    expect(text.endsWith("\n")).toBe(true);
    expect(JSON.parse(serializeMenu(newMenu()))).toEqual(newMenu());
  });
});

describe("editing the tree", () => {
  const menu = () => newMenu(); // panel > [text, button play, button quit]
  it("sets and removes a setting, and never lets children be set by hand", () => {
    let m = setProp(menu(), [1], "text", "Start");
    expect(nodeAt(m, [1])!.text).toBe("Start");
    m = setProp(m, [1], "text", "");
    expect(nodeAt(m, [1])!.text).toBeUndefined();
    expect(setProp(menu(), [], "children", [])).toEqual(menu());
    expect(setProp(menu(), [], "w", "fill").w).toBe("fill");
  });
  it("adds inside a container, near a leaf, and not inside something that holds nothing", () => {
    const inside = addChild(menu(), [], newNode("space"));
    expect(inside.path).toEqual([3]);
    expect(nodeAt(inside.root, [3])!.kind).toBe("space");
    expect(addChild(menu(), [0], newNode("text")).root).toEqual(menu());
    const near = addNear(menu(), [1], newNode("button"), false);
    expect(near.path).toEqual([2]);
    expect(nodeAt(near.root, [3])!.id).toBe("quit");
    expect(addNear(menu(), [], newNode("button"), false).path).toEqual([3]);
  });
  it("removes, moves and duplicates, keeping a sensible selection", () => {
    const r = removeNode(menu(), [1]);
    expect(allIds(r.root)).toEqual(["menu", "quit"]);
    expect(r.path).toEqual([1]);
    expect(removeNode(menu(), []).root).toEqual(menu());
    const only = removeNode({ kind: "column", children: [{ kind: "text" }] }, [0]);
    expect(only.root.children).toBeUndefined();
    expect(only.path).toEqual([]);
    const m = moveNode(menu(), [1], 1);
    expect(m.path).toEqual([2]);
    expect(allIds(m.root)).toEqual(["menu", "quit", "play"]);
    expect(moveNode(menu(), [0], -1).root).toEqual(menu());
    const d = duplicateNode(menu(), [1]);
    expect(allIds(d.root)).toEqual(["menu", "play", "play2", "quit"]);
    expect(d.path).toEqual([2]);
  });
  it("wraps a node in a container and takes the container away again", () => {
    const w = wrapIn(menu(), [1], "row");
    expect(nodeAt(w.root, [1])!.kind).toBe("row");
    expect(nodeAt(w.root, w.path)!.id).toBe("play");
    expect(unwrap(w.root, [1]).root).toEqual(menu());
    expect(wrapIn(menu(), [1], "text").root).toEqual(menu());
    expect(wrapIn(menu(), [], "stack").root.kind).toBe("stack");
  });
  it("lists the nodes in reading order with their depth, and names them", () => {
    expect(flatten(menu()).map((f) => `${f.depth}:${f.path.join(".")}`)).toEqual(["0:", "1:0", "1:1", "1:2"]);
    expect(labelOf({ kind: "button", text: "Play" })).toBe("Button · Play");
    expect(labelOf({ kind: "column" })).toBe("Column");
    expect(labelOf({ kind: "text", text: "x".repeat(40) }).endsWith("…")).toBe(true);
  });
});

describe("checks", () => {
  it("accepts a good menu", () => {
    expect(checkMenu(newMenu())).toEqual([]);
  });
  it("names what is wrong and where", () => {
    const m = { kind: "panel", children: [
      { kind: "button", text: "A" },
      { kind: "button", text: "B", id: "same" },
      { kind: "button", text: "C", id: "same" },
      { kind: "wobble" },
      { kind: "text", text: "x", children: [{ kind: "text" }], w: "wide", anchor: "middle" },
      { kind: "hints", items: [["a"]] },
    ] };
    const problems = checkMenu(m);
    const at = (p: number[]) => problems.filter((x) => x.path.join(".") === p.join(".")).map((x) => x.message).join(" | ");
    expect(at([0])).toContain("without an id");
    expect(at([2])).toContain("used twice");
    expect(at([3])).toContain("not a kind");
    expect(at([4])).toContain("cannot hold");
    expect(at([4])).toContain("Width");
    expect(at([4])).toContain("not an anchor");
    expect(at([5])).toContain("pairs");
  });
});
