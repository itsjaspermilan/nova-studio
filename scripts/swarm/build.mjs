// Probe 1, Ember Swarm: programmer-art models and the arena, made through the Nova MCP server (see docs/probes.md).
//   node scripts/swarm/build.mjs
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "../rally/mcp.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const GAME = join(root, "examples/ember-swarm");
mkdirSync(GAME, { recursive: true });

const box = (from, size, color, more = {}) => ({ from, size, color, ...more });
const part = (name, origin, cubes = [], children = []) => ({ name, origin, rotation: [0, 0, 0], cubes, children });
const model = (parts, colliders) => ({ version: 1, scale: 0.0625, parts, ...(colliders ? { colliders } : {}) });
const glow = (n) => ({ emissive: n });

const models = {
  // the player: a body and a turret that turns to face what it shoots at (a part, so the game can turn it)
  hero: model([part("body", [0, 0, 0], [box([-5, 0, -4], [10, 11, 8], "#3aa6a0", { name: "body" }), box([-6, 2, -3], [1.5, 6, 6], "#2b7f7a", { name: "left pack" }), box([4.5, 2, -3], [1.5, 6, 6], "#2b7f7a", { name: "right pack" })], [
    part("turret", [0, 11, 0], [box([-4, 0, -4], [8, 6, 8], "#cfe9e7", { name: "head" }), box([-3, 2, 3.9], [6, 2, 0.4], "#ff9b3b", { ...glow(1), name: "visor" }), box([-1.2, 1.5, 4], [2.4, 2.4, 9], "#22343a", { name: "barrel" })]),
  ])]),
  grunt: model([part("body", [0, 0, 0], [box([-5, 0, -5], [10, 8, 10], "#d9534f", { name: "blob" }), box([-3.5, 4, 4.9], [2, 2, 0.4], "#1a1a24", { name: "eye" }), box([1.5, 4, 4.9], [2, 2, 0.4], "#1a1a24", { name: "eye 2" })])], [{ x: 0, z: 0, r: 5 }]),
  runner: model([part("body", [0, 0, 0], [box([-3, 0, -3], [6, 12, 6], "#e6b422", { name: "tall" }), box([-2, 8, 2.9], [4, 1.5, 0.4], "#1a1a24", { name: "eyes" })])], [{ x: 0, z: 0, r: 3.5 }]),
  brute: model([part("body", [0, 0, 0], [box([-9, 0, -9], [18, 14, 18], "#7a4fb5", { name: "mass" }), box([-8, 14, -6], [3, 5, 3], "#e8e0f0", { name: "horn" }), box([5, 14, -6], [3, 5, 3], "#e8e0f0", { name: "horn 2" }), box([-5, 8, 8.9], [4, 3, 0.4], "#ff4b4b", { ...glow(1), name: "eye" }), box([1, 8, 8.9], [4, 3, 0.4], "#ff4b4b", { ...glow(1), name: "eye 2" })])], [{ x: 0, z: 0, r: 9 }]),
  bullet: model([part("shot", [0, 0, 0], [box([-1, -1, -4], [2, 2, 8], "#ffb347", { ...glow(1), name: "bolt" })])]),
  gem: model([part("gem", [0, 0, 0], [{ shape: "pyramid", from: [-3, 0, -3], size: [6, 6, 6], color: "#52d6ff", name: "top", ...glow(1) }])]),
  pillar: model([part("pillar", [0, 0, 0], [{ shape: "cylinder", from: [-12, 0, -12], size: [24, 56, 24], color: "#8a8498", segments: 10, name: "stone" }, box([-14, 56, -14], [28, 4, 28], "#b0abc2", { name: "cap" })])], [{ x: 0, z: 0, r: 13 }]),
  ground: model([part("ground", [0, 0, 0], [box([-1600, -4, -1600], [3200, 4, 3200], "#2d3a2f", { name: "dirt" }), { shape: "cylinder", from: [-680, 0, -680], size: [1360, 0.6, 1360], color: "#41503f", segments: 48, name: "arena floor" }])]),
};

// a ring of pillars (the arena's edge) and some inside, placed the same way every time
const objects = [];
const RING = 40;
for (let i = 0; i < 52; i++) {
  const a = (i / 52) * Math.PI * 2;
  objects.push({ kind: "pillar", x: Math.round(Math.cos(a) * RING * 10) / 10, y: 0, z: Math.round(Math.sin(a) * RING * 10) / 10 });
}
let s = 7;
const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
for (let i = 0; i < 14; i++) {
  const a = rand() * Math.PI * 2, d = 8 + rand() * 24;
  objects.push({ kind: "pillar", x: Math.round(Math.cos(a) * d * 10) / 10, y: 0, z: Math.round(Math.sin(a) * d * 10) / 10, props: { sx: 0.5 + rand() * 0.6 } });
}
objects.push({ kind: "player", name: "player", x: 0, y: 0, z: 0 });

if (!existsSync(join(GAME, "nova.json"))) {
  const first = await connect(GAME);
  console.log(await first.call("project_create", { name: "Ember Swarm" }));
  first.close();
}
const nova = await connect(GAME);
try {
  for (const [name, m] of Object.entries(models)) console.log(await nova.call("model_write", { name, model: m }));
  console.log(await nova.call("scene_write", { name: "arena", scene: { version: 1, background: [20, 24, 34], sky: { top: [18, 22, 40], horizon: [70, 60, 80] }, fog: { color: [60, 52, 72], near: 30, far: 90 }, camera: { eye: [0, 9, 10], target: [0, 1, 0], fov: 60 }, objects } }));
  console.log(await nova.call("sfx_write", { name: "shoot", params: { wave: "square", freq: 880, slide: -2.2, attack: 0, sustain: 0.02, decay: 0.08, duty: 0.25, volume: 0.25 } }));
  console.log(await nova.call("sfx_write", { name: "hit", preset: "hit", params: { volume: 0.3, freq: 360 } }));
  console.log(await nova.call("sfx_write", { name: "pop", params: { wave: "noise", freq: 500, slide: -1.4, attack: 0, sustain: 0.03, decay: 0.2, lowpass: 3500, volume: 0.35 } }));
  console.log(await nova.call("sfx_write", { name: "gem", preset: "coin", params: { freq: 1100, arpSemitones: 4, volume: 0.25 } }));
  console.log(await nova.call("sfx_write", { name: "levelup", preset: "powerup", params: { volume: 0.5 } }));
  console.log(await nova.call("sfx_write", { name: "hurt", params: { wave: "square", freq: 200, slide: -1.2, attack: 0, sustain: 0.08, decay: 0.3, duty: 0.3, volume: 0.5 } }));
  console.log(await nova.call("sfx_write", { name: "blip", preset: "blip", params: { volume: 0.3 } }));
} finally {
  nova.close();
}
