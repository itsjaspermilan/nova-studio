// Photographs one car model in the game's own renderer (paint, clear coat, glass, shadows), from six sides:
//   scripts/env.sh node scripts/rally/car-show.mjs car_gt [--len 4.8] [--only front34,side] [--game] [--dirt 0.6 [--dirt-color 150,120,90] [--snow]] [--out name]
// --game lights the car as a race does (the sky's two colours and the floor's, no sky cube); --dirt puts that much dirt on it (--snow: it lies on top too);
// --out adds a suffix to the pictures' names; --to puts them in another folder (pictures left in build/car-show/<model>/ are loaded as that
// project's sprites by the next run, and too many do not fit its atlas).
// Pictures go to build/car-show/<model>/<view>.png. Needs target/release/nova (scripts/env.sh cargo build --release -p nova-runtime).
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2), model = args[0], opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const len = +opt("--len", 4.6), only = opt("--only", "").split(",").filter(Boolean), d = len / 4.6;
const dir = join(root, "build/car-show", model);
const extra = [args.includes("--game") || args.includes("--dirt") ? "ground = { 140, 168, 124 }" : "", args.includes("--dirt") ? `dirt = ${+opt("--dirt", 0)}, dirt_color = { ${opt("--dirt-color", "150,120,90")} }, dirt_on_top = ${args.includes("--snow")}` : ""].filter(Boolean).map((s) => `, ${s}`).join("");
const suffix = opt("--out", ""), to = resolve(root, opt("--to", dir));
mkdirSync(to, { recursive: true });
mkdirSync(join(dir, "models"), { recursive: true });
cpSync(join(root, "scripts/rally/car-show"), dir, { recursive: true });
cpSync(join(root, "examples/pine-ridge-rally/models", `${model}.glb`), join(dir, "models", `${model}.glb`));
const VIEWS = {
  front34: { eye: [4.6, 2.0, 6.2], at: [0, 0.65, 0], fov: 24 }, rear34: { eye: [-4.6, 2.0, -6.2], at: [0, 0.65, 0], fov: 24 },
  side: { eye: [9, 0.9, 0], at: [0, 0.7, 0], fov: 30 }, front: { eye: [0, 0.9, 8], at: [0, 0.7, 0], fov: 26 },
  rear: { eye: [0, 0.9, -8], at: [0, 0.7, 0], fov: 26 }, top: { eye: [0.01, 11, 0], at: [0, 0, 0], fov: 28 },
  low: { eye: [3.2, 0.55, 5.4], at: [0, 0.6, 0.4], fov: 26 },
};
for (const [name, v] of Object.entries(VIEWS)) {
  if (only.length && !only.includes(name)) continue;
  const e = v.eye.map((x) => x * d), a = v.at.map((x) => x * d);
  writeFileSync(join(dir, "shot.lua"), `return { model = "${model}", eye = { ${e.join(", ")} }, at = { ${a.join(", ")} }, fov = ${v.fov}${extra} }\n`);
  execFileSync(process.env.NOVA_BIN ?? join(root, "target/release/nova"), ["run", dir, "--headless", "--frames", "8", "--no-audio", "--size", "1600x900", "--capture", join(to, `${name}${suffix}.png`)], { stdio: ["ignore", "ignore", "inherit"] });
  console.log(join(to, `${name}${suffix}.png`));
}
