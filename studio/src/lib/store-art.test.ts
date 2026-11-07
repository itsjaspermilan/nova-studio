import { describe, expect, it } from "vitest";
import { ART, LAUNCHER_SIZES, planPicture, sourceOf } from "./store-art";

describe("store art", () => {
  it("knows the two pictures and where they go", () => {
    expect(ART.icon).toMatchObject({ file: "icon.png", width: 512, height: 512 });
    expect(ART.boxart).toMatchObject({ file: "boxart.png", width: 768, height: 1024 });
    expect(LAUNCHER_SIZES).toEqual([192, 96, 72, 48]);
  });
  it("turns a key name into a source", () => {
    expect(sourceOf("Enter")).toBe("key:Enter");
    expect(sourceOf("a")).toBe("key:KeyA");
    expect(sourceOf("5")).toBe("key:Digit5");
    expect(sourceOf("pad:south")).toBe("pad:south");
    expect(sourceOf("  ArrowRight ")).toBe("key:ArrowRight");
    expect(sourceOf("")).toBeNull();
    expect(sourceOf("two words")).toBeNull();
    expect(sourceOf("a,b")).toBeNull();
  });
  it("plans the presses and how long to run", () => {
    const plan = planPicture([{ key: "Enter", seconds: 0.5 }, { key: "ArrowRight", seconds: 1 }, { key: "", seconds: 2 }, { key: "x y", seconds: 1 }], 2);
    expect(plan.press).toEqual(["key:Enter@30", "key:ArrowRight@60"]);
    expect(plan.frames).toBe(60 + 120);
    expect(planPicture([], 0).frames).toBe(90);
    expect(planPicture([], 3).frames).toBe(180);
  });
});
