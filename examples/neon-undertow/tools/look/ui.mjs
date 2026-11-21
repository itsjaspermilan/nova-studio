// Plays a plan of tools/look/ui/<name>.json at 1920x1080 (the handheld's screen) and saves every picture under build/gallery/ui/<name>/.
//   scripts/env.sh node examples/neon-undertow/tools/look/ui.mjs <name> [<name> ...]
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const project = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const repo = project + "/../..";
for (const name of process.argv.slice(2)) {
  const plan = JSON.parse(fs.readFileSync(`${project}/tools/look/ui/${name}.json`, "utf8"));
  plan.out = `build/gallery/ui/${name}`;
  plan.size = "1920x1080";
  plan.columns = plan.columns || 2;
  const tmp = `${repo}/build/neon-art/ui_${name}.json`;
  fs.mkdirSync(`${repo}/build/neon-art`, { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(plan));
  const out = execFileSync(repo + "/scripts/nova-tool", ["--project", project, "play", "@" + tmp], { encoding: "utf8", cwd: repo, maxBuffer: 1 << 26 });
  console.log(`== ${name}`);
  console.log(out.split("\n").filter((l) => /^(ran |WARNING|ERROR|.*Error|.*error)|^f\d+ |^(PRINT|[A-Z_0-9]+ =)|^(log|sounds)|banner|wipe|prompt/i.test(l)).slice(0, 60).join("\n"));
}
