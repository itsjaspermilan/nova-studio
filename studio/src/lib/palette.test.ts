import { describe, expect, it } from "vitest";
import { BUILTIN, nearestColor, normalizeHex, PaletteStore, parseGpl, parseHexList, parsePalette, parsePaletteJson, toGpl, toHexList, toPaletteJson } from "./palette";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe("palette files", () => {
  it("read and write GIMP's format", () => {
    const text = "GIMP Palette\nName: Sweet\nColumns: 4\n#\n255 0 0\tred\n  0 128 255 sky\n";
    const p = parseGpl(text)!;
    expect(p).toEqual({ name: "Sweet", colors: ["#ff0000", "#0080ff"] });
    expect(parseGpl(toGpl(p))).toEqual(p);
    expect(parseGpl("not a palette")).toBeNull();
  });

  it("read lists of hex colours, with or without #, one per line or separated by commas", () => {
    expect(parseHexList("FF0000\n#00ff00\n0000FF", "x")!.colors).toEqual(["#ff0000", "#00ff00", "#0000ff"]);
    expect(parseHexList("ff0000, 00ff00; nonsense 0000ff", "x")!.colors).toHaveLength(3);
    expect(parseHexList("zzz", "x")).toBeNull();
    expect(parseHexList(toHexList({ name: "a", colors: ["#123456"] }), "a")!.colors).toEqual(["#123456"]);
  });

  it("read and write the JSON form, and ignore bad colours", () => {
    const p = { name: "Mine", colors: ["#abcdef", "#000000"] };
    expect(parsePaletteJson(toPaletteJson(p))).toEqual(p);
    expect(parsePaletteJson('{"colors":["red","#112233"]}', "fb")).toEqual({ name: "fb", colors: ["#112233"] });
    expect(parsePaletteJson("{no")).toBeNull();
  });

  it("are recognised by what is in them, with the file name as the fallback name", () => {
    expect(parsePalette("GIMP Palette\n1 2 3 a\n", "retro.gpl")!.name).toBe("retro");
    expect(parsePalette("ff0000\n00ff00\n", "pico-8.hex")!.name).toBe("pico-8");
    expect(parsePalette('{"colors":["#ffffff"]}', "w.json")!.name).toBe("w");
    expect(parsePalette("", "empty.hex")).toBeNull();
  });

  it("drop repeats and keep the number of colours in bounds", () => {
    expect(parseHexList("ff0000 ff0000 00ff00", "x")!.colors).toEqual(["#ff0000", "#00ff00"]);
    expect(normalizeHex(" #ABCDEF ")).toBe("#abcdef");
    expect(normalizeHex("abc")).toBeNull();
  });
});

describe("the nearest colour", () => {
  it("picks the palette colour closest to the eye, and the colour itself from an empty palette", () => {
    expect(nearestColor(["#000000", "#ff0000", "#ffffff"], "#fa1010")).toBe("#ff0000");
    expect(nearestColor(["#000000", "#ffffff"], "#101010")).toBe("#000000");
    expect(nearestColor([], "#123456")).toBe("#123456");
  });
});

describe("the palette store", () => {
  it("has the built-in palettes, keeps new ones across a restart, and numbers a name that is taken", () => {
    const mem = memory();
    const s = new PaletteStore(mem);
    expect(s.all().map((p) => p.name)).toEqual(expect.arrayContaining(BUILTIN.map((p) => p.name)));
    expect(s.add({ name: "Mine", colors: ["#111111"] })).toBe("Mine");
    expect(s.add({ name: "Mine", colors: ["#222222"] })).toBe("Mine 2");
    const again = new PaletteStore(mem);
    expect(again.current).toBe("Mine 2");
    expect(again.get("Mine").colors).toEqual(["#111111"]);
  });

  it("changes and removes the person's own palettes only, and falls back when the current one goes", () => {
    const s = new PaletteStore(memory());
    s.add({ name: "Mine", colors: ["#111111"] });
    s.setColors("Mine", ["#222222", "#333333"]);
    s.setColors("Starter", ["#000000"]);
    expect(s.get("Mine").colors).toHaveLength(2);
    expect(s.get("Starter").colors.length).toBeGreaterThan(10);
    s.remove("Mine");
    expect(s.current).toBe("Starter");
    expect(s.isBuiltin("Greys")).toBe(true);
  });

  it("survive broken saved data", () => {
    const mem = memory();
    mem.setItem("nova.palettes.v1", "{no");
    expect(new PaletteStore(mem).current).toBe("Starter");
    mem.setItem("nova.palettes.v1", JSON.stringify({ user: [{ name: "bad" }, 5], current: "Gone" }));
    const s = new PaletteStore(mem);
    expect(s.user).toEqual([]);
    expect(s.current).toBe("Starter");
  });
});
