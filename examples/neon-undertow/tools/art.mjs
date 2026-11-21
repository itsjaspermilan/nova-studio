// Every maker call that made the detailed-style art (people, creatures, icons, the tileset), in order. Run from the repository folder:
//   scripts/env.sh node examples/neon-undertow/tools/art.mjs            (all)       |  ... art.mjs runner patch   (some, by name)
// The hand-drawn pieces (the crane cab, the dummy, the effects...) are in art_hd.mjs. Cast recipes are HD_ARCHETYPES of
// studio/mcp/makers/character-hd.ts; Patch and Old Sal are ours.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const project = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const repo = project + "/../..";
const GM = { palette: "gutter market", style: "detailed" };
const calls = {
  tileset: ["tileset_make", { name: "gutter", ...GM }],
  runner: ["character_make", { name: "runner", ...GM, outfit: "long_coat", outfit_color: "#6c6488", trim_color: "#2c2a3a", hat: "visor", hair: "short", hair_color: "#4a3a5c", skin: "tan", item: "baton", glow_color: "2", shoe_color: "#2a2630", expression: "smirk" }],
  scrapper: ["character_make", { name: "scrapper", ...GM, outfit: "hoodie", outfit_color: "#8a3040", trim_color: "#34323a", hair: "mohawk", hair_color: "#ff7a2e", skin: "light", item: "pipe", glow_color: "1", stance: "hunched", pose: "shoulder", expression: "grin" }],
  bottle_thrower: ["character_make", { name: "bottle_thrower", ...GM, outfit: "tank_top", outfit_color: "#e0d8c0", trim_color: "#4a4458", hat: "bandana", hat_color: "#d03040", hair: "long", hair_color: "#2a2028", skin: "brown", item: "bottle", stance: "lanky", pose: "cocked", expression: "grin", glow_color: "1" }],
  tout: ["character_make", { name: "tout", ...GM, outfit: "loud_suit", outfit_color: "#e0487a", trim_color: "#f0c040", hat: "fedora", hat_color: "#3a2a4a", skin: "pale", item: "none", pose: "wide", expression: "grin", hologram: true, glow_color: "2" }],
  // Patch: a street medic: scrubs, a surgical cap, a scalpel, and four arms (two of them the mechanical pair)
  patch: ["character_make", { name: "patch", ...GM, outfit: "scrubs", outfit_color: "#3f8a86", trim_color: "#e8eef0", hat: "surgical", hair: "bob", hair_color: "#d8d0c8", skin: "brown", item: "scalpel", arms: 4, stance: "upright", pose: "guard", expression: "smile", glow_color: "2" }],
  // Old Sal: a noodle seller: a cream vest over a tank top, an eyeshade, a tray of bowls
  old_sal: ["character_make", { name: "old_sal", ...GM, outfit: "vest", outfit_color: "#d8c8a0", trim_color: "#8a4a2a", hat: "eyeshade", hair: "bald", skin: "tan", item: "tray", stance: "heavy", pose: "low", expression: "grin", glow_color: "1", build: "stout" }],
  rat_drone: ["creature_make", { name: "rat_drone", kind: "rat_drone", ...GM }],
  mimic_vendor: ["creature_make", { name: "mimic_vendor", kind: "vending_mimic", ...GM }],
  crane: ["creature_make", { name: "crane_arm", kind: "crane_arm", ...GM }],
  icons: ["items_make", { name: "ui", ...GM }],
};
const want = process.argv.slice(2);
for (const [key, [tool, args]] of Object.entries(calls)) {
  if (want.length && !want.includes(key)) continue;
  const out = execFileSync(repo + "/scripts/nova-tool", ["--project", project, tool, JSON.stringify(args)], { encoding: "utf8", cwd: repo });
  console.log(key + ": " + out.split("\n").filter((l) => !l.startsWith("picture:") && !l.startsWith("[image")).slice(0, 2).map((l) => l.slice(0, 260)).join("\n  "));
}

// The runner's roll lasts 0.34 s (data/player.lua roll.time): its five frames show 68 ms each, not the maker's 56 (a roll is 0.28 s there),
// and its run is the maker's own `run_<dir>` clip (8 frames of 45 ms: a cycle keeps step with 235 units a second).
if (!want.length || want.includes("runner")) {
  const file = project + "/sprites/runner.sprite.json";
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const t of json.tags) if (t.name.startsWith("roll_")) for (let i = t.from; i <= t.to; i++) json.durations_ms[i] = 68;
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
  console.log("runner: roll frames set to 68 ms");
}
