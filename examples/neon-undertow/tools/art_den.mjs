// SUPERSEDED (the 16 px placeholder art): do not run, it would overwrite the detailed sheets. The art is made by art.mjs (the makers) and art_hd.mjs (hand-drawn pieces).
// Placeholder pictures for slice 3b (Mother Coil and the Den), by name: mother_coil, coil_drum, coil_magnet, coil_car, coil_junk, wreckage,
// den_bed, den_screen, den_bench, den_door, den_stall. The game stretches each to a size set in data/ (nothing depends on a picture's size):
// the detailed kit replaces the PNGs. Run: scripts/env.sh node examples/neon-undertow/tools/art_den.mjs <outdir> [--write]
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const palette = { k: "#0b0e1c", d: "#1d2440", m: "#ff2bd6", c: "#06f0ff", y: "#ffe45e", w: "#e8ecff", b: "#6b4a2f", B: "#8a5f3a", r: "#c23a2e", g: "#5a6280", o: "#ff8a2b", G: "#3b4163", s: "#9aa3c8" };
const f = (shapes, extra = {}) => ({ shapes, ...extra });
const R = (x, y, w, h, color) => ({ rect: [x, y, w, h], color });
const sheets = {};
const sheet = (name, size, frames) => { sheets[name] = { name, palette, size, frames }; };

// the crane cab: a rusty box on a gantry, a window with a face in it, a boom arm
sheet("mother_coil", [32, 32], [f([
  R(0, 26, 32, 6, "G"), R(2, 12, 28, 15, "o"), R(2, 12, 28, 3, "r"), R(4, 17, 24, 9, "d"), R(7, 18, 18, 7, "c"), R(10, 20, 3, 3, "k"), R(19, 20, 3, 3, "k"), R(11, 24, 10, 1, "m"),
  R(12, 4, 8, 8, "g"), R(14, 0, 4, 5, "y"), R(0, 14, 3, 12, "g"), R(29, 14, 3, 12, "g"), R(4, 28, 24, 2, "y"),
], { outline: "k" })]);
// the cable drum: shut (grey spool) and open (glowing cyan)
sheet("coil_drum", [16, 16], [
  f([{ circle: [8, 8, 7], color: "g" }, { circle: [8, 8, 4], color: "G" }, { circle: [8, 8, 1.5], color: "k" }, R(2, 7, 12, 2, "s")], { outline: "k" }),
  f([{ circle: [8, 8, 7], color: "c" }, { circle: [8, 8, 4], color: "w" }, { circle: [8, 8, 1.5], color: "y" }, R(2, 7, 12, 2, "w")], { outline: "k" }),
]);
sheet("coil_magnet", [16, 16], [f([R(2, 0, 12, 4, "r"), R(2, 4, 4, 9, "r"), R(10, 4, 4, 9, "r"), R(2, 12, 4, 3, "w"), R(10, 12, 4, 3, "w"), R(7, 1, 2, 2, "y")], { outline: "k" })]);
sheet("coil_car", [16, 16], [f([R(1, 4, 14, 9, "m"), R(3, 2, 10, 4, "c"), R(1, 12, 4, 3, "k"), R(11, 12, 4, 3, "k"), R(6, 6, 4, 4, "y")], { outline: "k" })]);
sheet("coil_junk", [32, 16], [f([R(0, 6, 32, 9, "G"), R(2, 3, 8, 8, "g"), R(11, 1, 9, 10, "r"), R(21, 4, 9, 7, "s"), R(5, 8, 3, 3, "y"), { line: [0, 2, 12, 9], color: "k" }, { line: [18, 0, 30, 8], color: "o" }], { outline: "k" })]);
sheet("wreckage", [16, 16], [
  f([R(0, 5, 16, 9, "r"), R(2, 2, 12, 5, "g"), R(1, 12, 4, 3, "k"), R(11, 12, 4, 3, "k"), R(6, 8, 4, 3, "y")], { outline: "k" }),
  f([R(0, 7, 16, 7, "r"), R(3, 4, 7, 4, "g"), R(2, 12, 4, 3, "k"), { line: [5, 8, 12, 13], color: "k" }, R(10, 3, 4, 3, "o")], { outline: "k" }),
]);
// the Den
sheet("den_bed", [32, 16], [f([R(0, 4, 32, 11, "G"), R(0, 2, 32, 3, "c"), R(2, 6, 28, 7, "d"), R(4, 7, 8, 5, "w"), R(14, 6, 14, 6, "g"), R(26, 0, 4, 4, "m")], { outline: "k" })]);
sheet("den_screen", [16, 16], [
  f([R(0, 1, 16, 12, "G"), R(1, 2, 14, 9, "k"), R(3, 4, 4, 3, "c"), R(9, 4, 4, 3, "c"), R(4, 8, 8, 1, "m"), R(6, 13, 4, 3, "g"), { line: [2, 2, 9, 9], color: "w" }], { outline: "k" }),
  f([R(0, 1, 16, 12, "G"), R(1, 2, 14, 9, "k"), R(3, 4, 4, 3, "m"), R(9, 4, 4, 3, "m"), R(4, 8, 8, 1, "c"), R(6, 13, 4, 3, "g"), { line: [2, 2, 9, 9], color: "w" }], { outline: "k" }),
]);
sheet("den_bench", [32, 16], [f([R(0, 5, 32, 10, "B"), R(0, 5, 32, 2, "b"), R(3, 1, 4, 5, "c"), R(10, 2, 6, 3, "y"), R(20, 0, 2, 6, "s"), R(25, 2, 5, 3, "r")], { outline: "k" })]);
sheet("den_door", [16, 32], [f([R(0, 0, 16, 32, "G"), R(2, 3, 12, 26, "d"), R(4, 5, 8, 22, "c"), R(5, 7, 6, 18, "k"), R(0, 0, 16, 2, "m")], { outline: "k" })]);
sheet("den_stall", [16, 16], [
  f([R(0, 1, 16, 5, "g"), R(0, 7, 16, 8, "G"), R(0, 7, 16, 2, "d"), R(2, 10, 12, 3, "k")], { outline: "k" }),
  f([R(0, 1, 16, 5, "m"), R(2, 1, 2, 5, "w"), R(6, 1, 2, 5, "w"), R(10, 1, 2, 5, "w"), R(0, 7, 16, 8, "B"), R(0, 7, 16, 2, "b"), R(3, 10, 3, 3, "c"), R(9, 10, 4, 3, "y")], { outline: "k" }),
]);

for (const [name, args] of Object.entries(sheets)) {
  fs.writeFileSync(`${out}/${name}.json`, JSON.stringify(args));
  if (process.argv.includes("--write")) {
    const res = execFileSync("scripts/nova-tool", ["--project", process.cwd() + "/examples/neon-undertow", "sprite_write", "@" + `${out}/${name}.json`], { encoding: "utf8" });
    console.log(res.split("\n").slice(0, 2).join("\n"));
  }
}
