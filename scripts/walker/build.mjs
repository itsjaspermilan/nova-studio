// Skin demo: a walking figure whose arms and legs are meshes that bend at the elbows and knees (skinned: each point follows
// the parts around it), made through the Nova MCP server like the rally game. `bend: true` on model_write gives the limbs
// their automatic weights, exactly as the model editor's "Bend with the parts around it" button does.
//   node scripts/walker/build.mjs
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync } from "node:fs";
import { connect } from "../rally/mcp.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const GAME = join(root, "examples/skin-demo");
mkdirSync(GAME, { recursive: true });

const box = (from, size, color, more = {}) => ({ from, size, color, ...more });
const part = (name, origin, cubes = [], children = [], rotation = [0, 0, 0]) => ({ name, origin, rotation, cubes, children });

/// A square tube hanging down from y = 0 to y = -length, with rings of four points along it so that it can bend anywhere.
function tube(w, d, length, color, rings = 7) {
  const verts = [];
  for (let r = 0; r < rings; r++) {
    const y = -(length * r) / (rings - 1);
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) verts.push([(x * w) / 2, y, (z * d) / 2]);
  }
  const polys = [];
  for (let r = 0; r < rings - 1; r++) for (let k = 0; k < 4; k++) polys.push({ v: [r * 4 + k, r * 4 + ((k + 1) % 4), (r + 1) * 4 + ((k + 1) % 4), (r + 1) * 4 + k], smooth: true });
  return { shape: "mesh", from: [-w / 2, -length, -d / 2], size: [w, length, d], color, verts, polys, name: "limb" };
}

const SKIN = "#f0c8a0", SHIRT = "#d9534f", PANTS = "#3b4a8c", SHOE = "#2b2b33", HAIR = "#3a2a20";
const arm = (side) => {
  const x = side * 5.5;
  return part(`arm_${side < 0 ? "r" : "l"}`, [x, 8, 0], [tube(3.2, 3.2, 12, SHIRT)], [
    part(`forearm_${side < 0 ? "r" : "l"}`, [0, -6, 0], [box([-1.7, -6.8, -1.7], [3.4, 3.4, 3.4], SKIN, { name: "hand" })]),
  ]);
};
const leg = (side) => {
  const x = side * 2.2;
  const n = side < 0 ? "r" : "l";
  return part(`leg_${n}`, [x, -2, 0], [tube(3.8, 3.8, 13, PANTS)], [
    part(`shin_${n}`, [0, -6.5, 0], [box([-2, -7.5, -3], [4, 2.4, 6], SHOE, { name: "shoe" })]),
  ]);
};

const key = (t, value, ease = "inout") => ({ t, value, ease });
const sw = (a, b, phase) => [key(0, [phase ? b : a, 0, 0]), key(0.5, [phase ? a : b, 0, 0]), key(1, [phase ? b : a, 0, 0])];
const walker = {
  version: 1,
  scale: 0.0625,
  parts: [
    part("hips", [0, 15, 0], [box([-4, -2, -2.2], [8, 4, 4.4], PANTS, { name: "pelvis" })], [
      part("torso", [0, 2, 0], [box([-4, 0, -2.2], [8, 9, 4.4], SHIRT, { name: "chest" })], [
        part("head", [0, 9, 0], [
          box([-3, 0, -3], [6, 6.4, 6], SKIN, { name: "head" }),
          box([-3.2, 4.2, -3.2], [6.4, 2.6, 6.4], HAIR, { name: "hair" }),
          box([-2, 2.4, 2.9], [1.2, 1.2, 0.4], "#1a1a24", { name: "eye right" }),
          box([0.8, 2.4, 2.9], [1.2, 1.2, 0.4], "#1a1a24", { name: "eye left" }),
        ]),
        arm(-1),
        arm(1),
      ]),
      leg(-1),
      leg(1),
    ]),
  ],
  clips: [
    {
      name: "walk",
      duration: 1,
      loop: true,
      tracks: [
        { part: ["hips", "leg_l"], prop: "rotation", keys: sw(-32, 32, true) },
        { part: ["hips", "leg_r"], prop: "rotation", keys: sw(-32, 32, false) },
        { part: ["hips", "leg_l", "shin_l"], prop: "rotation", keys: [key(0, [4, 0, 0]), key(0.25, [34, 0, 0]), key(0.5, [4, 0, 0]), key(0.75, [6, 0, 0]), key(1, [4, 0, 0])] },
        { part: ["hips", "leg_r", "shin_r"], prop: "rotation", keys: [key(0, [4, 0, 0]), key(0.25, [6, 0, 0]), key(0.5, [4, 0, 0]), key(0.75, [34, 0, 0]), key(1, [4, 0, 0])] },
        { part: ["hips", "torso", "arm_l"], prop: "rotation", keys: sw(-28, 28, false) },
        { part: ["hips", "torso", "arm_r"], prop: "rotation", keys: sw(-28, 28, true) },
        { part: ["hips", "torso", "arm_l", "forearm_l"], prop: "rotation", keys: [key(0, [-6, 0, 0]), key(0.25, [-30, 0, 0]), key(0.5, [-6, 0, 0]), key(0.75, [-6, 0, 0]), key(1, [-6, 0, 0])] },
        { part: ["hips", "torso", "arm_r", "forearm_r"], prop: "rotation", keys: [key(0, [-6, 0, 0]), key(0.25, [-6, 0, 0]), key(0.5, [-6, 0, 0]), key(0.75, [-30, 0, 0]), key(1, [-6, 0, 0])] },
        { part: ["hips"], prop: "position", keys: [key(0, [0, 15, 0]), key(0.25, [0, 15.9, 0]), key(0.5, [0, 15, 0]), key(0.75, [0, 15.9, 0]), key(1, [0, 15, 0])] },
      ],
    },
  ],
};
const ground = { version: 1, scale: 0.0625, parts: [part("ground", [0, 0, 0], [box([-800, -4, -800], [1600, 4, 1600], "#6f9a58", { name: "grass" }), box([-48, 0, -48], [96, 0.6, 96], "#a8a08c", { name: "paving" })])] };

if (!existsSync(join(GAME, "nova.json"))) {
  const first = await connect(GAME);
  console.log(await first.call("project_create", { name: "Skin Demo" }));
  first.close();
}
const nova = await connect(GAME);
try {
  console.log(await nova.call("model_write", { name: "walker", model: walker, bend: true }));
  // the same figure without bending: each limb stays one stiff piece of its part
  console.log(await nova.call("model_write", { name: "walker_stiff", model: walker }));
  console.log(await nova.call("model_write", { name: "ground", model: ground }));
  console.log(await nova.call("scene_write", { name: "stage", scene: { version: 1, background: [140, 190, 235], camera: { eye: [0, 1.6, 5.5], target: [0, 0.9, 0], fov: 45 }, sky: { top: [90, 150, 225], horizon: [200, 225, 240] }, objects: [{ kind: "walker", name: "bendy", x: -1.2, y: 0, z: 0 }, { kind: "walker_stiff", name: "stiff", x: 1.2, y: 0, z: 0 }] } }));
} finally {
  nova.close();
}
