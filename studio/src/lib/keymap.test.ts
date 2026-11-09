import { describe, expect, it } from "vitest";
import { CommandRegistry } from "./commands";
import { chordOf, KeymapSettings } from "./keymap";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};
const registry = () => {
  const r = new CommandRegistry("win");
  r.register({ id: "model.move", title: "Move", keymaps: { blender: ["G"], nova: ["W"] }, run: () => {} });
  return r;
};

describe("keymap settings", () => {
  it("apply the preset and the person's changes to the registry, and keep them", () => {
    const store = memory();
    const r = registry();
    const k = new KeymapSettings(r, store);
    expect(r.keysOf(r.get("model.move")!)).toEqual(["G"]);
    k.setPreset("nova");
    expect(r.keysOf(r.get("model.move")!)).toEqual(["W"]);
    k.setKeys("model.move", ["Shift+G"]);
    const r2 = registry();
    new KeymapSettings(r2, store);
    expect(r2.preset).toBe("nova");
    expect(r2.keysOf(r2.get("model.move")!)).toEqual(["Shift+G"]);
  });

  it("reset one shortcut or all of them", () => {
    const r = registry();
    const k = new KeymapSettings(r, memory());
    k.setKeys("model.move", ["X"]);
    k.reset("model.move");
    expect(r.isCustom("model.move")).toBe(false);
    k.setKeys("model.move", ["Y"]);
    k.resetAll();
    expect(r.keysOf(r.get("model.move")!)).toEqual(["G"]);
  });

  it("survive broken or hostile saved data", () => {
    const store = memory();
    store.setItem("nova.keymap.v1", JSON.stringify({ preset: "emacs", overrides: { a: "no", b: ["Mod+"] } }));
    const r = registry();
    expect(() => new KeymapSettings(r, store)).not.toThrow();
    expect(r.preset).toBe("blender");
    store.setItem("nova.keymap.v1", "{nope");
    expect(() => new KeymapSettings(registry(), store)).not.toThrow();
  });
});

describe("recording a shortcut", () => {
  const e = (o: Partial<{ key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }>) => ({ key: "a", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...o });
  it("writes Cmd on a Mac and Ctrl elsewhere as Mod, and ignores a lone modifier", () => {
    expect(chordOf(e({ key: "g" }), "win")).toBe("G");
    expect(chordOf(e({ key: "s", metaKey: true }), "mac")).toBe("Mod+S");
    expect(chordOf(e({ key: "s", ctrlKey: true }), "win")).toBe("Mod+S");
    expect(chordOf(e({ key: "s", ctrlKey: true }), "mac")).toBe("Ctrl+S");
    expect(chordOf(e({ key: "A", shiftKey: true }), "win")).toBe("Shift+A");
    expect(chordOf(e({ key: "Tab" }), "win")).toBe("Tab");
    expect(chordOf(e({ key: " " }), "win")).toBe("Space");
    expect(chordOf(e({ key: "Shift", shiftKey: true }), "win")).toBeNull();
  });
});
