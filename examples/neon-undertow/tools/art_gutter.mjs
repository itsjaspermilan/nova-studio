// SUPERSEDED (the 16 px placeholder art): do not run, it would overwrite the detailed sheets. The art is made by art.mjs (the makers) and art_hd.mjs (hand-drawn pieces).
// Writes the argument files for the slice-3a placeholder sprites (stall, barrel, sign, rail, tram, counter) and, run with `--write`,
// calls sprite_write for each. Run: scripts/env.sh node examples/neon-undertow/tools/art_gutter.mjs <outdir> [--write]
// Everything the game draws is reached by name (sprites/stall, ...), stretched to a size set in data/hazards.lua: replace the
// pictures (any size), not the code. The strangers (patch, old_sal) come from character_make.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const palette = { k: "#0b0e1c", d: "#1d2440", m: "#ff2bd6", c: "#06f0ff", y: "#ffe45e", w: "#e8ecff", b: "#6b4a2f", B: "#8a5f3a", r: "#c23a2e", g: "#5a6280", o: "#ff8a2b", G: "#3b4163" };
const f = (shapes, extra = {}) => ({ shapes, ...extra });
const R = (x, y, w, h, color) => ({ rect: [x, y, w, h], color });
const sheets = {};

const stall = (worn) => f([
  R(0, 1, 16, 5, "m"), R(2, 1, 2, 5, "w"), R(6, 1, 2, 5, "w"), R(10, 1, 2, 5, "w"), R(14, 1, 2, 5, "w"),
  R(0, 7, 16, 8, "B"), R(0, 7, 16, 2, "b"), R(3, 10, 3, 3, "c"), R(9, 10, 4, 3, "y"),
  ...(worn >= 1 ? [R(5, 2, 3, 3, "."), { line: [10, 8, 12, 14], color: "k" }, R(1, 11, 2, 2, ".")] : []),
  ...(worn >= 2 ? [R(8, 1, 6, 5, "."), R(3, 9, 5, 5, "."), { line: [13, 8, 15, 14], color: "k" }] : []),
], { outline: "k" });
sheets.stall = { name: "stall", palette, size: [16, 16], frames: [stall(0), stall(1), stall(2)] };

sheets.barrel = { name: "barrel", palette, size: [16, 16], frames: [f([
  R(3, 2, 10, 13, "r"), R(3, 5, 10, 1, "k"), R(3, 11, 10, 1, "k"), R(4, 3, 2, 11, "o"), R(7, 7, 2, 3, "y"),
  { ellipse: [8, 2.5, 5, 1.5], color: "g" },
], { outline: "k" })] };

sheets.sign = { name: "sign", palette, size: [16, 16], frames: [
  f([R(4, 0, 8, 15, "d"), R(6, 2, 4, 1, "c"), R(6, 5, 4, 1, "m"), R(6, 8, 4, 1, "c"), R(6, 11, 4, 1, "m"), R(7, 0, 2, 1, "g")], { outline: "k" }),
  f([R(1, 4, 14, 8, "d"), R(3, 6, 1, 4, "c"), R(5, 6, 1, 4, "m"), R(7, 6, 1, 4, "c"), R(11, 3, 2, 2, "y"), R(12, 11, 3, 2, "y"), { line: [9, 4, 10, 11], color: "k" }], { outline: "k" }),
] };

const rail = (v) => {
  const s = v ? (x, y, w, h) => [y, x, h, w] : (x, y, w, h) => [x, y, w, h];
  return f([{ rect: s(2, 2, 3, 12), color: "b" }, { rect: s(10, 2, 3, 12), color: "b" }, { rect: s(0, 4, 16, 2), color: "g" }, { rect: s(0, 10, 16, 2), color: "g" }], {});
};
sheets.rail = { name: "rail", palette, size: [16, 16], frames: [rail(false), rail(true)] };

sheets.tram = { name: "tram", palette, size: [16, 16], frames: [
  f([R(0, 1, 16, 14, "w"), R(1, 3, 3, 4, "c"), R(5, 3, 3, 4, "c"), R(9, 3, 3, 4, "c"), R(13, 3, 2, 4, "c"), R(0, 10, 16, 2, "m"), R(0, 13, 16, 1, "G")], { outline: "k" }),
  f([R(1, 0, 14, 16, "w"), R(3, 1, 4, 3, "c"), R(3, 5, 4, 3, "c"), R(3, 9, 4, 3, "c"), R(3, 13, 4, 2, "c"), R(10, 0, 2, 16, "m"), R(13, 0, 1, 16, "G")], { outline: "k" }),
] };

const body = [R(0, 6, 16, 9, "d"), R(0, 5, 16, 2, "c")];
sheets.counter = { name: "counter", palette, size: [16, 16], frames: [
  f([...body, R(7, 0, 2, 5, "r"), R(5, 1.5, 6, 2, "r")], { outline: "k" }),                                   // heal
  f([...body, { circle: [8, 2.5, 2.5], color: "y" }, R(7, 2, 1, 1, "k"), R(9, 3, 1, 1, "k")], { outline: "k" }), // reroll
  f([...body, R(0, 0, 16, 4, "m"), { line: [0, 0, 15, 3], color: "k" }, { line: [4, 0, 15, 2], color: "k" }, R(0, 9, 16, 2, "g")], { outline: "k" }), // jinx: shut
  f([...body, R(6, 0, 4, 4, "y"), R(7, 1, 2, 2, "."), R(5, 3, 1, 2, "y")], { outline: "k" }),                  // bank: a key
] };

for (const [name, args] of Object.entries(sheets)) {
  fs.writeFileSync(`${out}/${name}.json`, JSON.stringify(args));
  if (process.argv.includes("--write")) {
    const res = execFileSync("scripts/nova-tool", ["--project", process.cwd() + "/examples/neon-undertow", "sprite_write", "@" + `${out}/${name}.json`], { encoding: "utf8" });
    console.log(res.split("\n").slice(0, 2).join("\n"));
  }
}
