// Blockfield's mobs: blocky models made through the Nova MCP server. One unit is a sixteenth of a block, the front faces +z.
//   node scripts/blockfield/models.mjs
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "../rally/mcp.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const box = (from, size, color, name) => ({ from, size, color, name });
const part = (name, origin, cubes = [], children = []) => ({ name, origin, rotation: [0, 0, 0], cubes, children });
const model = (parts, colliders) => ({ version: 1, scale: 0.0625, parts, ...(colliders ? { colliders } : {}) });

// two arms and two legs hang from pivots at the shoulder and the hip, so that the game can swing them
function biped(skin, shirt, pants, extras = []) {
  return model([
    part("body", [0, 0, 0], [box([-4, 12, -2], [8, 12, 4], shirt, "torso")], [
      part("head", [0, 24, 0], [box([-4, 0, -4], [8, 8, 8], skin, "head"), ...extras]),
      part("arm_l", [-6, 22, 0], [box([-2, -10, -2], [4, 12, 4], skin, "left arm")]),
      part("arm_r", [6, 22, 0], [box([-2, -10, -2], [4, 12, 4], skin, "right arm")]),
      part("leg_l", [-2, 12, 0], [box([-2, -12, -2], [4, 12, 4], pants, "left leg")]),
      part("leg_r", [2, 12, 0], [box([-2, -12, -2], [4, 12, 4], pants, "right leg")]),
    ]),
  ]);
}

const models = {
  zombie: biped("#5f8f4f", "#3a6ea5", "#33337e", [box([-3, 4, 3.9], [2, 2, 0.3], "#101010", "eye"), box([1, 4, 3.9], [2, 2, 0.3], "#101010", "eye 2"), box([-2, 1, 3.9], [4, 1, 0.3], "#2c4a28", "mouth")]),
  creeper: model([
    part("body", [0, 0, 0], [box([-4, 6, -2], [8, 12, 4], "#4faa4a", "body")], [
      part("head", [0, 18, 0], [box([-4, 0, -4], [8, 8, 8], "#58b852", "head"), box([-3, 4, 3.9], [2, 2, 0.3], "#0c0c0c", "eye"), box([1, 4, 3.9], [2, 2, 0.3], "#0c0c0c", "eye 2"), box([-1, 1, 3.9], [2, 3, 0.3], "#0c0c0c", "mouth")]),
      part("leg_fl", [-2, 6, 2], [box([-2, -6, -2], [4, 6, 4], "#3f8a3a", "front left")]),
      part("leg_fr", [2, 6, 2], [box([-2, -6, -2], [4, 6, 4], "#3f8a3a", "front right")]),
      part("leg_bl", [-2, 6, -2], [box([-2, -6, -2], [4, 6, 4], "#3f8a3a", "back left")]),
      part("leg_br", [2, 6, -2], [box([-2, -6, -2], [4, 6, 4], "#3f8a3a", "back right")]),
    ]),
  ]),
  pig: model([
    part("body", [0, 0, 0], [box([-5, 6, -8], [10, 8, 16], "#f0a0a8", "body")], [
      part("head", [0, 12, 8], [box([-4, -4, 0], [8, 8, 8], "#f4aab0", "head"), box([-2, -3, 8], [4, 3, 1], "#e08890", "snout"), box([-3, 1, 7.9], [1.5, 1.5, 0.3], "#101010", "eye"), box([1.5, 1, 7.9], [1.5, 1.5, 0.3], "#101010", "eye 2")]),
      part("leg_fl", [-3, 6, 6], [box([-2, -6, -2], [4, 6, 4], "#e8909a", "front left")]),
      part("leg_fr", [3, 6, 6], [box([-2, -6, -2], [4, 6, 4], "#e8909a", "front right")]),
      part("leg_bl", [-3, 6, -6], [box([-2, -6, -2], [4, 6, 4], "#e8909a", "back left")]),
      part("leg_br", [3, 6, -6], [box([-2, -6, -2], [4, 6, 4], "#e8909a", "back right")]),
    ]),
  ]),
};

const nova = await connect(join(root, "examples/blockfield"));
try {
  for (const [name, m] of Object.entries(models)) console.log(await nova.call("model_write", { name, model: m }));
} finally {
  nova.close();
}
