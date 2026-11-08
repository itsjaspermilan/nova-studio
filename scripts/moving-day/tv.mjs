// The television piece: the Furniture Kit's TV cabinet with its flat screen standing on it, made one editable model (models/tv.model.json) from the
// two converted by scripts/moving-day/assets.sh, which are then removed. The studio's exporter saves the .glb (scripts/moving-day/editable.sh).
import fs from "node:fs";
const M = new URL("../../examples/moving-day/models/", import.meta.url).pathname;
const stand = JSON.parse(fs.readFileSync(M + "tv_stand.model.json", "utf8"));
const screen = JSON.parse(fs.readFileSync(M + "tv_screen.model.json", "utf8"));
const unit = 1 / stand.scale; // model units in a metre (16)
// the screen sits in the middle of the cabinet's two cells, on its top (0.72 m), a little back from the front
const top = 0.72, part = screen.parts[0];
part.name = "screen";
part.origin = [0.5 * unit, top * unit, -0.1 * unit];
stand.parts[0].name = "cabinet";
const tv = { ...stand, parts: [{ name: "tv", origin: [0, 0, 0], rotation: [0, 0, 0], cubes: [], children: [stand.parts[0], part] }] };
fs.writeFileSync(M + "tv.model.json", JSON.stringify(tv, null, 2) + "\n");
for (const f of ["tv_stand.model.json", "tv_stand.glb", "tv_screen.model.json", "tv_screen.glb"]) fs.rmSync(M + f);
console.log("wrote models/tv.model.json");
