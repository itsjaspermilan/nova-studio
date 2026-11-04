// Bunker Run's sound effects, made through the Nova MCP server.
//   node scripts/bunker/sounds.mjs
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "../rally/mcp.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const nova = await connect(join(root, "examples/bunker-run"));
const sfx = async (name, params, preset) => console.log(await nova.call("sfx_write", { name, ...(preset ? { preset } : {}), params }));
try {
  await sfx("pistol", { wave: "noise", freq: 1900, slide: -3.2, attack: 0, sustain: 0.01, decay: 0.14, lowpass: 7000, volume: 0.6 });
  await sfx("shotgun", { wave: "noise", freq: 800, slide: -2.2, attack: 0, sustain: 0.05, decay: 0.42, lowpass: 3800, volume: 0.85 });
  await sfx("reload", { wave: "square", freq: 260, slide: 0.6, attack: 0, sustain: 0.02, decay: 0.09, duty: 0.4, volume: 0.35 });
  await sfx("click", { wave: "square", freq: 700, slide: -1, attack: 0, sustain: 0.005, decay: 0.03, duty: 0.5, volume: 0.25 });
  await sfx("hurt", { wave: "square", freq: 170, slide: -1.3, attack: 0, sustain: 0.06, decay: 0.3, duty: 0.35, volume: 0.55 });
  await sfx("enemy_hit", { wave: "noise", freq: 600, slide: -1.2, attack: 0, sustain: 0.01, decay: 0.07, lowpass: 3000, volume: 0.35 });
  await sfx("enemy_die", { wave: "saw", freq: 160, slide: -1.1, attack: 0, sustain: 0.1, decay: 0.45, lowpass: 1500, volume: 0.5 });
  await sfx("drone_die", { wave: "noise", freq: 400, slide: -1.6, attack: 0, sustain: 0.06, decay: 0.3, lowpass: 4500, volume: 0.55 });
  await sfx("door", { wave: "noise", freq: 140, slide: 0.3, attack: 0.08, sustain: 0.25, decay: 0.45, lowpass: 700, volume: 0.6 });
  await sfx("pickup", { freq: 800, arpSemitones: 7, volume: 0.3 }, "coin");
  await sfx("key", { freq: 600, arpSemitones: 12, volume: 0.4 }, "coin");
  await sfx("step", { wave: "noise", freq: 220, slide: -0.5, attack: 0, sustain: 0.005, decay: 0.06, lowpass: 900, volume: 0.3 });
  await sfx("enemy_shot", { wave: "square", freq: 520, slide: -2.6, attack: 0, sustain: 0.02, decay: 0.16, duty: 0.3, volume: 0.4 });
  await sfx("boss_roar", { wave: "saw", freq: 75, slide: -0.2, attack: 0.05, sustain: 0.6, decay: 0.9, lowpass: 650, volume: 0.9 });
  await sfx("win", { volume: 0.5 }, "powerup");
} finally {
  nova.close();
}
