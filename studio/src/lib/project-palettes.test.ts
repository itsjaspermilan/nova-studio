import { describe, expect, it } from "vitest";
import { parseProjectPalettes, serializeProjectPalettes, withPalettes } from "./project-palettes";

describe("project palettes", () => {
  it("round trip through the file", () => {
    const list = [{ name: "Forest", colors: ["#1f3d2b", "#2f7d46"] }, { name: "Sky", colors: ["#4fa3ff"] }];
    const back = parseProjectPalettes(serializeProjectPalettes(list));
    expect(back.ok && back.palettes).toEqual(list);
  });
  it("clean colours (capitals are normalised, repeats dropped) and refuse the rest", () => {
    const ok = parseProjectPalettes(JSON.stringify({ palettes: [{ name: "A", colors: ["#AABBCC", "#aabbcc", "#112233"] }] }));
    expect(ok.ok && ok.palettes[0]!.colors).toEqual(["#aabbcc", "#112233"]);
    for (const bad of ["{nope", "{}", JSON.stringify({ palettes: [{ name: "", colors: [] }] }), JSON.stringify({ palettes: [{ name: "A", colors: ["red"] }] }), JSON.stringify({ palettes: [{ name: "A", colors: [] }, { name: "A", colors: [] }] })]) {
      expect(parseProjectPalettes(bad).ok, bad).toBe(false);
    }
  });
  it("puts palettes in by name, replacing, and keeps the others", () => {
    const out = withPalettes([{ name: "A", colors: ["#000000"] }, { name: "B", colors: [] }], [{ name: "B", colors: ["#ffffff"] }, { name: "C", colors: [] }]);
    expect(out.map((p) => p.name)).toEqual(["A", "B", "C"]);
    expect(out[1]!.colors).toEqual(["#ffffff"]);
  });
});
