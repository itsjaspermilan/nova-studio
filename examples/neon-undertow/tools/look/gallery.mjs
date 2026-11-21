// Copies the frames the art swap is judged on from build/look/<run>/ into build/gallery/ (full size, one per item, plus the film strips).
// Run each route first with tools/look/shoot.mjs (the routes are listed in tools/look/README-less make.mjs and tools/r_look_*.json), then:
//   scripts/env.sh node examples/neon-undertow/tools/look/gallery.mjs
import fs from "node:fs";
const project = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const from = `${project}/build/look`, to = `${project}/build/gallery`;
fs.rmSync(to, { recursive: true, force: true });
fs.mkdirSync(to, { recursive: true });
const picks = [
  // [gallery name, run, frame number]
  ["01-fight-market-square-tell", "fight_square", 242], ["02-fight-flooded-square", "fight_flood", 252], ["03-fight-bus-yard", "fight_yard", 252],
  ["04-tram-comes-in", "tram_room", 126], ["05-tram-crosses", "tram_room", 142],
  ["06-barrel-fuse", "barrel_blast", 50], ["07-barrel-blast", "barrel_blast", 72],
  ["08-sign-drops", "sign_puddle", 18], ["09-live-puddle", "sign_puddle", 32],
  ["10-elite-marks", "elites", 22],
  ["11-card-rise", "r_look_cards", 91], ["12-cards-risen", "r_look_cards", 115], ["13-card-text", "r_look_cards", 119],
  ["14-patch-room", "patch_room", 14], ["15-patch-talks", "patch_room", 272], ["16-old-sal-talks", "sal_room", 272],
  ["17-shop-stalls", "shop_room", 166], ["18-bank", "shop_room", 634],
  ["19-coil-lanes", "r_look_boss", 157], ["20-coil-slam-ring", "r_look_boss", 480], ["21-coil-cars", "r_look_boss", 825], ["22-coil-drum-open", "r_look_boss_drum", 36], ["23-coil-stripes-armed", "r_look_boss_stripes", 123], ["24-coil-stripes-bend", "r_look_boss_stripes", 141],
  ["25-den", "r_look_den", 131], ["26-den-lullaby", "r_look_den", 386], ["27-den-workbench", "r_look_den_bench", 419], ["28-den-codex", "r_look_s4_codex", 370],
  ["29-title", "r_look_den", 26], ["30-summary", "r_look_summary", 51],
  ["31-hitboxes-bus-yard", "fight_yard_boxes", 252], ["32-hitboxes-flooded-square", "fight_flood_boxes", 252],
  ["36-pause-page", "r_look_pause", 28], ["33-mimic-flicker", "r_look_mimic", 82], ["34-roll", "r_look_roll", 14], ["35-cast", "cast", 28],
];
for (const [name, run, n] of picks) {
  const dir = `${from}/${run}`;
  const f = fs.existsSync(dir) && fs.readdirSync(dir).find((x) => new RegExp(`^f0*${n}-.*\\.png$`).test(x));
  if (!f) { console.log(`MISSING ${name}: ${run} frame ${n}`); continue; }
  fs.copyFileSync(`${dir}/${f}`, `${to}/${name}.png`);
}
for (const run of ["fight_square", "fight_flood", "fight_yard", "tram_room", "elites", "barrel_blast", "sign_puddle", "r_look_cards", "patch_room", "shop_room", "r_look_boss", "r_look_boss_stripes", "r_look_den", "r_look_s4_codex", "cast"]) {
  if (fs.existsSync(`${from}/${run}/strip.png`)) fs.copyFileSync(`${from}/${run}/strip.png`, `${to}/strip-${run}.png`);
}
console.log(fs.readdirSync(to).length + " files in " + to);
