// The small course drawings on Pine Ridge Rally's pick-a-circuit page: each circuit's waypoints (from its scene file), turned to fit
// a unit square the way the in-race minimap draws them (north, +z, at the top; +x on the left), written to lib/previews.lua.
//
//   node scripts/rally/previews.mjs [project folder]
import fs from "node:fs";
import path from "node:path";

const project = process.argv[2] ?? "examples/pine-ridge-rally";
const circuits = ["pine_ridge", "dust_valley", "frost_pass", "harbour_lights", "stage_pine_ridge", "stage_dust_valley", "stage_frost_pass", "stage_harbour_lights"];
let out = "-- Made by scripts/rally/previews.mjs from the circuits' waypoints: each course as points in a box 1 across at most, {x, y} from the top left.\nreturn {\n";
for (const id of circuits) {
  const scene = JSON.parse(fs.readFileSync(path.join(project, "scenes", id + ".scene.json"), "utf8"));
  const pts = scene.objects.filter((o) => o.kind === "waypoint").sort((a, b) => a.props.i - b.props.i);
  const xs = pts.map((p) => -p.x), zs = pts.map((p) => -p.z);
  const lo = [Math.min(...xs), Math.min(...zs)], hi = [Math.max(...xs), Math.max(...zs)];
  const size = Math.max(hi[0] - lo[0], hi[1] - lo[1]);
  const flat = pts.map((_, i) => `{${((xs[i] - lo[0]) / size).toFixed(3)},${((zs[i] - lo[1]) / size).toFixed(3)}}`);
  out += `  ${id} = { open = ${id.startsWith("stage_")}, w = ${((hi[0] - lo[0]) / size).toFixed(3)}, h = ${((hi[1] - lo[1]) / size).toFixed(3)}, pts = {${flat.join(",")}} },\n`;
}
out += "}\n";
fs.writeFileSync(path.join(project, "lib", "previews.lua"), out);
console.log("wrote lib/previews.lua");
