// Plays a route file of tools/ (or tools/look/) with its pictures saved under build/look/<name>/ and prints the renderer's line and any error.
//   scripts/env.sh node examples/neon-undertow/tools/look/shoot.mjs <route file without .json> [<name>] [overlay]
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const project = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const repo = project + "/../..";
const [file, name = file, overlay] = process.argv.slice(2);
const path = fs.existsSync(`${project}/tools/look/${file}.json`) ? `${project}/tools/look/${file}.json` : `${project}/tools/${file}.json`;
const plan = JSON.parse(fs.readFileSync(path, "utf8"));
plan.out = `build/look/${name}`;
if (overlay) plan.overlay = overlay.split(",");
const tmp = `${repo}/build/neon-art/play_${name}.json`;
fs.mkdirSync(`${repo}/build/neon-art`, { recursive: true });
fs.writeFileSync(tmp, JSON.stringify(plan));
const out = execFileSync(repo + "/scripts/nova-tool", ["--project", project, "play", "@" + tmp], { encoding: "utf8", cwd: repo, maxBuffer: 1 << 26 });
console.log(out.split("\n").filter((l) => /^(render:|ran |WARNING|.*(error|Error))|^f\d+ /.test(l)).join("\n"));
