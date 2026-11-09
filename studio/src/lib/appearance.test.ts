import { describe, expect, it } from "vitest";
import { Appearance, clampScale, resolveTheme } from "./appearance.svelte";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe("appearance", () => {
  it("follows the system for 'system' and uses the chosen theme otherwise", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("contrast", false)).toBe("contrast");
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("keeps the size in range, in steps of five", () => {
    expect(clampScale(10)).toBe(75);
    expect(clampScale(400)).toBe(200);
    expect(clampScale(112)).toBe(110);
    expect(clampScale(NaN)).toBe(100);
  });

  it("remembers the choices, and ignores bad saved data", () => {
    const store = memory();
    const a = new Appearance(store);
    a.set({ theme: "contrast", scale: 130, reducedMotion: true });
    const b = new Appearance(store);
    expect([b.theme, b.scale, b.reducedMotion]).toEqual(["contrast", 130, true]);
    store.setItem("nova.appearance.v1", JSON.stringify({ theme: "neon", scale: 9999 }));
    const c = new Appearance(store);
    expect([c.theme, c.scale]).toEqual(["system", 200]);
    store.setItem("nova.appearance.v1", "{no");
    expect(new Appearance(store).theme).toBe("system");
  });
});
