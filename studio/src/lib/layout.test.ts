import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LAYOUT, Layout, sizeKey } from "./layout.svelte";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe("workspace layouts", () => {
  it("start at the defaults, which differ per workspace", () => {
    const l = new Layout(memory());
    expect(l.get("engine")).toEqual(DEFAULT_LAYOUT.engine);
    expect(l.get("engine").panelOpen).toBe(true);
    expect(l.get("sprites").panelOpen).toBe(false);
  });

  it("keep a change to one workspace out of the others, and remember it", () => {
    const store = memory();
    const l = new Layout(store);
    l.set("sprites", { treeOpen: false });
    expect(l.get("sprites").treeOpen).toBe(false);
    expect(l.get("model").treeOpen).toBe(true);
    expect(new Layout(store).get("sprites").treeOpen).toBe(false);
  });

  it("reset puts one workspace back and forgets its sizes", () => {
    const store = memory();
    const l = new Layout(store);
    l.set("sound", { treeOpen: false, panelOpen: true });
    l.set("model", { treeOpen: false });
    l.reset("sound");
    expect(l.get("sound")).toEqual(DEFAULT_LAYOUT.sound);
    expect(l.get("model").treeOpen).toBe(false);
  });

  it("survives unreadable saved data", () => {
    const store = memory();
    store.setItem("nova.layout.v1", "{not json");
    expect(new Layout(store).get("engine")).toEqual(DEFAULT_LAYOUT.engine);
  });

  it("names a panel's size per workspace", () => {
    expect(sizeKey("tree", "model")).toBe("tree.model");
    expect(sizeKey("bottom", "engine")).not.toBe(sizeKey("bottom", "sound"));
  });
});

describe("named layouts", () => {
  it("save how every workspace is arranged and bring it back later", () => {
    const l = new Layout(memory());
    l.set("model", { treeOpen: false });
    l.set("engine", { panelOpen: false });
    expect(l.saveAs("Drawing")).toBe(true);
    l.reset("model");
    l.reset("engine");
    l.set("sound", { panelOpen: true });
    expect(l.get("model").treeOpen).toBe(true);
    expect(l.apply("Drawing")).toBe(true);
    expect(l.get("model").treeOpen).toBe(false);
    expect(l.get("engine").panelOpen).toBe(false);
    expect(l.get("sound").panelOpen).toBe(false); // as it was when saved
    expect(l.apply("nope")).toBe(false);
  });
  it("keep sizes, are remembered between runs, replaced by name, deleted, and limited in number", () => {
    const sizes = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => sizes.get(k) ?? null, setItem: (k: string, v: string) => void sizes.set(k, v), removeItem: (k: string) => void sizes.delete(k) });
    const store = memory();
    const l = new Layout(store);
    localStorage.setItem("nova.size.tree.model", "333");
    l.saveAs("Wide");
    localStorage.removeItem("nova.size.tree.model");
    l.apply("Wide");
    expect(localStorage.getItem("nova.size.tree.model")).toBe("333");
    expect(new Layout(store).names).toEqual(["Wide"]);
    l.set("model", { treeOpen: false });
    l.saveAs("Wide");
    expect(l.names).toEqual(["Wide"]);
    expect(l.saveAs("   ")).toBe(false);
    for (let i = 0; i < 20; i++) l.saveAs(`L${i}`);
    expect(l.names.length).toBe(12);
    expect(l.saveAs("one more")).toBe(false);
    l.removeNamed("Wide");
    expect(l.names).not.toContain("Wide");
    expect(l.saveAs("one more")).toBe(true);
    vi.unstubAllGlobals();
  });
  it("ignores saved layouts that are damaged", () => {
    const store = memory();
    store.setItem("nova.layouts.v1", JSON.stringify({ bad: { workspaces: { model: {} } }, junk: 5 }));
    expect(new Layout(store).names).toEqual([]);
    store.setItem("nova.layouts.v1", "{nope");
    expect(new Layout(store).names).toEqual([]);
  });
});
