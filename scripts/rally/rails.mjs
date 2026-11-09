// Pine Ridge Rally's barriers on the outside of the bends, laid end to end (scripts/lib/trackgen.mjs `railPieces`): each course scene's
// barrier lines (its track file's `rail` kind) are replaced by the new pieces, where the first of them was; the rest of each scene file is
// left as it is (the scenes have been edited since they were generated, so they are not made again).
//   scripts/env.sh node scripts/rally/rails.mjs
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { centreline, curvature, halfAt, railPieces } from "../lib/trackgen.mjs";

const GAME = join(new URL("../..", import.meta.url).pathname, "examples/pine-ridge-rally");
const r1 = (v) => Math.round(v * 10) / 10;

for (const file of readdirSync(join(GAME, "tracks")).filter((f) => f.endsWith(".track.json"))) {
  const name = file.replace(".track.json", "");
  const track = JSON.parse(readFileSync(join(GAME, "tracks", file), "utf8"));
  const kind = track.rail ?? "guardrail";
  const open = !!track.open;
  const line = centreline(track.control, 5, open);
  const curv = curvature(line, 5, open);
  const pieces = railPieces(line, curv, open, (i) => halfAt(track.zones ?? [], i * 5));
  const path = join(GAME, "scenes", `${name}.scene.json`);
  const lines = readFileSync(path, "utf8").split("\n");
  const isRail = (l) => l.includes(`"kind": "${kind}"`);
  const at = lines.findIndex(isRail);
  if (at < 0) continue;
  const before = lines.filter(isRail).length;
  const made = pieces.map((p) => `    { "kind": "${kind}", "x": ${r1(p.x)}, "y": 0, "z": ${r1(p.z)}, "props": { "ry": ${Math.round(p.ry * 1000) / 1000} } },`);
  const kept = lines.filter((l, i) => i < at || !isRail(l));
  kept.splice(at, 0, ...made);
  JSON.parse(kept.join("\n")); // (still a scene file)
  writeFileSync(path, kept.join("\n"));
  console.log(`${name}: ${before} barriers -> ${made.length}`);
}
