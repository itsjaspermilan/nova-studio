// Sky Garden's sound effects, made through the Nova MCP server.
//   node scripts/sky/sounds.mjs
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "../rally/mcp.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const nova = await connect(join(root, "examples/sky-garden"));
const sfx = async (name, params, preset) => console.log(await nova.call("sfx_write", { name, ...(preset ? { preset } : {}), params }));
try {
  await sfx("gem", { freq: 900, arpSemitones: 7, volume: 0.3 }, "coin");
  await sfx("jump", { wave: "square", freq: 300, slide: 1.4, attack: 0, sustain: 0.03, decay: 0.16, duty: 0.4, volume: 0.3 });
  await sfx("land", { wave: "noise", freq: 200, slide: -0.5, attack: 0, sustain: 0.01, decay: 0.08, lowpass: 800, volume: 0.35 });
  await sfx("stomp", { wave: "square", freq: 220, slide: -1.2, attack: 0, sustain: 0.02, decay: 0.14, duty: 0.5, volume: 0.45 });
  await sfx("hurt", { wave: "saw", freq: 200, slide: -1.5, attack: 0, sustain: 0.05, decay: 0.25, lowpass: 2000, volume: 0.45 });
  await sfx("win", { volume: 0.5 }, "powerup");
} finally {
  nova.close();
}
