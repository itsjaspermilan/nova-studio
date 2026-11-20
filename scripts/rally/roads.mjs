// Makes every course's road again from its track file (tracks/<name>.track.json -> models/road_<name>.glb): what the studio's track
// editor and the MCP tool `track_write` write for the road, without touching the scenes. Run it after changing the ribbon in
// scripts/lib/trackgen.mjs; `--textured` first turns the road pictures on in every track file ("textured": true).
//
//   node scripts/rally/roads.mjs [--textured] [project folder]
import fs from "node:fs";
import path from "node:path";
import { roadGlb } from "../lib/trackgen.mjs";

const args = process.argv.slice(2), turnOn = args.includes("--textured");
const project = args.find((a) => !a.startsWith("--")) ?? "examples/pine-ridge-rally";
const dir = path.join(project, "tracks");
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".track.json")).sort()) {
  const full = path.join(dir, file);
  let text = fs.readFileSync(full, "utf8");
  if (turnOn && !/"textured":\s*true/.test(text)) {
    // (where the editor writes it: the last setting before the control points)
    text = text.replace(/\n(\s*)"control":/, '\n$1"textured": true,\n$1"control":');
    fs.writeFileSync(full, text);
  }
  const track = JSON.parse(text), name = file.replace(/\.track\.json$/, "");
  const glb = roadGlb(track.control, track.road ?? "road_asphalt", track.open === true, track.zones ?? [], track.textured === true);
  fs.writeFileSync(path.join(project, "models", `road_${name}.glb`), glb);
  console.log(`road_${name}.glb ${Math.round(glb.length / 1024)} KB${track.textured ? " (textured)" : ""}`);
}
