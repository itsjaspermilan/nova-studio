// Blockfield's sound effects, made through the Nova MCP server (programmer sound: noise thuds and a few tones).
//   node scripts/blockfield/sounds.mjs
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "../rally/mcp.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const nova = await connect(join(root, "examples/blockfield"));
// material -> [wave, freq, slide, decay, lowpass]
const materials = {
  stone: ["noise", 380, -1.2, 0.13, 2600],
  grass: ["noise", 260, -0.8, 0.14, 1300],
  wood: ["square", 170, -2.4, 0.11, 2200],
  sand: ["noise", 600, -0.6, 0.15, 4200],
  gravel: ["noise", 420, -0.7, 0.18, 3300],
  glass: ["sine", 2400, -1.4, 0.22, 9000],
  water: ["noise", 220, 1.2, 0.2, 900],
};
try {
  for (const [name, [wave, freq, slide, decay, lowpass]] of Object.entries(materials)) {
    console.log(await nova.call("sfx_write", { name: `dig_${name}`, params: { wave, freq, slide, attack: 0, sustain: 0.02, decay, lowpass, volume: 0.5 } }));
    console.log(await nova.call("sfx_write", { name: `step_${name}`, params: { wave, freq: freq * 0.8, slide: slide * 0.6, attack: 0, sustain: 0.01, decay: decay * 0.55, lowpass, volume: 0.28 } }));
  }
  console.log(await nova.call("sfx_write", { name: "hurt", params: { wave: "square", freq: 190, slide: -1.3, attack: 0, sustain: 0.06, decay: 0.28, duty: 0.35, volume: 0.5 } }));
  console.log(await nova.call("sfx_write", { name: "pickup", preset: "coin", params: { freq: 700, arpSemitones: 7, volume: 0.22 } }));
  console.log(await nova.call("sfx_write", { name: "pop", params: { wave: "noise", freq: 500, slide: -1.4, attack: 0, sustain: 0.03, decay: 0.2, lowpass: 3500, volume: 0.35 } }));
  console.log(await nova.call("sfx_write", { name: "explode", params: { wave: "noise", freq: 120, slide: -1.0, attack: 0, sustain: 0.18, decay: 0.7, lowpass: 1400, volume: 0.8 } }));
  console.log(await nova.call("sfx_write", { name: "groan", params: { wave: "saw", freq: 95, slide: -0.3, attack: 0.05, sustain: 0.25, decay: 0.4, lowpass: 900, volume: 0.45 } }));
  console.log(await nova.call("sfx_write", { name: "hiss", params: { wave: "noise", freq: 3000, slide: 0.2, attack: 0.05, sustain: 0.5, decay: 0.3, lowpass: 9000, volume: 0.3 } }));
  console.log(await nova.call("sfx_write", { name: "oink", params: { wave: "square", freq: 240, slide: -0.9, attack: 0, sustain: 0.05, decay: 0.16, duty: 0.4, volume: 0.35 } }));
} finally {
  nova.close();
}
