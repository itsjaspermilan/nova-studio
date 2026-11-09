import { describe, expect, it } from "vitest";
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
