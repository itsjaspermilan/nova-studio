import { describe, expect, it } from "vitest";
import { InputSettings } from "./input-settings.svelte";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe("input settings", () => {
  it("start unconfigured, keep a choice across a restart, and mark the person as having chosen", () => {
    const store = memory();
    const s = new InputSettings(store);
    expect(s.configured).toBe(false);
    s.set({ navigation: "pen", invert: true });
    const again = new InputSettings(store);
    expect([again.navigation, again.invert, again.configured]).toEqual(["pen", true, true]);
  });

  it("ignore unreadable or unknown saved data", () => {
    const store = memory();
    store.setItem("nova.input.v1", JSON.stringify({ navigation: "joystick", configured: true }));
    const s = new InputSettings(store);
    expect(["mouse", "trackpad"]).toContain(s.navigation);
    store.setItem("nova.input.v1", "{broken");
    expect(new InputSettings(store).configured).toBe(false);
  });
});
