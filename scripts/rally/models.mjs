// The rally game's 3D models, made through the Nova MCP server's `model_write` tool. Units are 1/16 of a metre;
// y is up and a car's nose points along +z. Each model is a tree of parts, the way the studio's model editor shows it.
import { withServer } from "./mcp.mjs";

const box = (from, size, color, more = {}) => ({ from, size, color, ...more });
const part = (name, origin, cubes = [], children = [], rotation = [0, 0, 0]) => ({ name, origin, rotation, cubes, children });
const model = (parts) => ({ version: 1, scale: 0.0625, parts });
const round = (shape, from, size, color, more = {}) => ({ shape, from, size, color, ...more });
/// A cylinder lying on its side with its axle along x.
const axle = (from, size, color, segments = 12) => round("cylinder", from, size, color, { rotation: [0, 0, 90], segments });

// ---- cars: a body and four wheels that move on their own (spin, steer, ride the bumps) ------------------------------------
// The wheels are not part of the body: the body leans and bounces on its suspension while each wheel follows the road.
function car({ paint, trim, stripe, glass = "#27384d", light = "#ffe9a8" }) {
  const wheel = (name, x, z) =>
    part(name, [x, 5.5, z], [axle([-5.5, -3, -5.5], [11, 6, 11], "#1b1b1b"), axle([-3.5, -3.6, -3.5], [7, 7.2, 7], "#b9c0c8", 8)]);
  return model([
    part("chassis", [0, 0, 0], [], [
    part(
      "body",
      [0, 0, 0],
      [
        box([-15, 5, -34], [30, 8, 68], paint), // the tub
        box([-13, 13, -20], [26, 3, 22], paint), // bonnet and boot shoulders
        box([-12, 13, -14], [24, 7, 28], glass), // windows
        box([-11, 20, -11], [22, 2, 22], paint), // roof
        box([-3, 13.1, 4], [6, 0.4, 16], stripe), // bonnet stripe
        box([-3, 22.1, -9], [6, 0.4, 18], stripe), // roof stripe
        box([-14, 4, 33], [28, 3, 3], trim), // front splitter
        box([-14, 5, -36], [28, 4, 2], trim), // rear bumper
        box([-14, 19, -35], [28, 2, 8], trim), // wing
        box([-10, 13, -32], [2, 6, 2], trim), // wing struts
        box([8, 13, -32], [2, 6, 2], trim),
        box([-12, 8, 34], [6, 3, 1], light), // headlights
        box([6, 8, 34], [6, 3, 1], light),
        box([-12, 8, -36.5], [6, 3, 1], "#e11d2e"), // tail lights
        box([6, 8, -36.5], [6, 3, 1], "#e11d2e"),
        box([-2, 21.5, 6], [4, 3, 6], trim), // roof vent
        round("cylinder", [-13, 10, 24], [4, 2, 4], light, { rotation: [90, 0, 0], segments: 8 }), // rally lamps
        round("cylinder", [9, 10, 24], [4, 2, 4], light, { rotation: [90, 0, 0], segments: 8 }),
        box([15, 8, -5], [0.6, 6, 6], "#f8fafc"), // door roundels
        box([-15.6, 8, -5], [0.6, 6, 6], "#f8fafc"),
      ],
      [],
    ),
    wheel("wheel_fl", -17, 22), wheel("wheel_fr", 17, 22), wheel("wheel_rl", -17, -22), wheel("wheel_rr", 17, -22),
    ]),
  ]);
}

// ---- scenery ----------------------------------------------------------------------------------------------------------
const pine = (greens) =>
  model([
    part("tree", [0, 0, 0], [
      box([-3, 0, -3], [6, 28, 6], "#6b4423"),
      round("cone", [-27, 18, -27], [54, 46, 54], greens[0], { segments: 8, smooth: false }),
      round("cone", [-21, 48, -21], [42, 42, 42], greens[1], { segments: 8, smooth: false }),
      round("cone", [-14, 78, -14], [28, 38, 28], greens[2], { segments: 8, smooth: false }),
    ]),
  ]);

const roundTree = (leaf) =>
  model([
    part("tree", [0, 0, 0], [
      box([-3.5, 0, -3.5], [7, 40, 7], "#7a5230"),
      round("sphere", [-30, 30, -30], [60, 54, 60], leaf, { segments: 8, smooth: false }),
      round("sphere", [-18, 54, -16], [38, 34, 38], leaf, { segments: 8, smooth: false }),
    ]),
  ]);

const rock = (a, b) =>
  model([
    part("rock", [0, 0, 0], [
      round("sphere", [-26, -6, -22], [52, 40, 44], a, { segments: 6, smooth: false }),
      round("sphere", [4, -4, 2], [30, 28, 28], b, { segments: 6, smooth: false }),
    ]),
  ]);

const barrier = (rail, post) =>
  model([
    part("rail", [0, 0, 0], [
      box([-1, 7, -48], [2, 7, 96], rail),
      box([-1.2, 9, -48], [2.4, 1, 96], "#e5e7eb"),
      box([-1.5, 0, -44], [3, 11, 3], post),
      box([-1.5, 0, 41], [3, 11, 3], post),
    ]),
  ]);

const tires = () =>
  model([
    part("stack", [0, 0, 0], [
      round("cylinder", [-13, 0, -13], [26, 9, 26], "#d62828", { segments: 10 }),
      round("cylinder", [-13, 9, -13], [26, 9, 26], "#f8fafc", { segments: 10 }),
      round("cylinder", [-13, 18, -13], [26, 9, 26], "#d62828", { segments: 10 }),
      round("cylinder", [-6, 0, -6], [12, 28, 12], "#202020", { segments: 8 }),
    ]),
  ]);

const bale = () =>
  model([
    part("bale", [0, 0, 0], [
      box([-18, 0, -12], [36, 20, 24], "#e0b84a"),
      box([-18.3, 0, -4], [36.6, 20.3, 1.2], "#a47a1e"),
      box([-18.3, 0, 3], [36.6, 20.3, 1.2], "#a47a1e"),
    ]),
  ]);

const sign = () =>
  model([
    part("sign", [0, 0, 0], [
      box([-1.2, 0, -1.2], [2.4, 26, 2.4], "#9ca3af"),
      box([-13, 22, -1.5], [26, 20, 2.5], "#fcd34d"),
      box([-10, 25, -2.2], [5, 14, 1], "#111827", { rotation: [0, 0, -35] }),
      box([5, 25, -2.2], [5, 14, 1], "#111827", { rotation: [0, 0, 35] }),
    ]),
  ]);

const checker = (n, w, d, y, h, x0 = 0, z0 = 0) => {
  const cubes = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < 2; j++) cubes.push(box([x0 + i * w, y, z0 + j * d], [w, h, d], (i + j) % 2 ? "#f8fafc" : "#111827"));
  return cubes;
};

const arch = () =>
  model([
    part("arch", [0, 0, 0], [
      box([-118, 0, -5], [8, 112, 10], "#e5e7eb"),
      box([110, 0, -5], [8, 112, 10], "#e5e7eb"),
      ...checker(22, 10.8, 5, 112, 14, -118, -5),
      box([-118, 126, -5], [236, 10, 10], "#d62828"),
      box([-60, 128, 5.1], [120, 6, 0.5], "#f8fafc"),
    ]),
  ]);

const road = (surface, edge, dashed) =>
  model([
    part("road", [0, 0, 0], [
      box([-96, 0, -50], [192, 2, 100], surface),
      box([-92, 2, -50], [4, 0.4, 100], edge),
      box([88, 2, -50], [4, 0.4, 100], edge),
      ...(dashed ? [box([-2, 2, -30], [4, 0.4, 36], dashed)] : []),
    ]),
  ]);

const startLine = () =>
  model([
    part("line", [0, 0, 0], [
      box([-96, 0, -50], [192, 2, 100], "#3a3d44"),
      box([-92, 2, -50], [4, 0.4, 100], "#e5e7eb"),
      box([88, 2, -50], [4, 0.4, 100], "#e5e7eb"),
      ...checker(16, 11.5, 6, 2.2, 0.3, -92, -6),
    ]),
  ]);

const ground = (color) => model([part("ground", [0, 0, 0], [box([-4800, -6, -4800], [9600, 4, 9600], color)])]);

const mountain = (rock, snow) =>
  model([
    part("mountain", [0, 0, 0], [
      round("pyramid", [-1500, 0, -1300], [3000, 1500, 2600], rock),
      round("pyramid", [-460, 1050, -400], [920, 450, 800], snow),
    ]),
  ]);

const cloud = () =>
  model([
    part("cloud", [0, 0, 0], [
      round("sphere", [-120, 0, -50], [140, 50, 100], "#ffffff", { segments: 8, smooth: false }),
      round("sphere", [-20, 14, -50], [130, 56, 100], "#ffffff", { segments: 8, smooth: false }),
      round("sphere", [60, 0, -40], [110, 44, 80], "#f1f5f9", { segments: 8, smooth: false }),
    ]),
  ]);

const cactus = () =>
  model([
    part("cactus", [0, 0, 0], [
      round("cylinder", [-6, 0, -6], [12, 80, 12], "#3f8a4e", { segments: 8 }),
      box([-22, 30, -4], [18, 6, 8], "#3f8a4e"),
      round("cylinder", [-22, 30, -4], [8, 30, 8], "#3f8a4e", { segments: 8 }),
      box([4, 40, -4], [18, 6, 8], "#3f8a4e"),
      round("cylinder", [14, 40, -4], [8, 28, 8], "#3f8a4e", { segments: 8 }),
    ]),
  ]);

const mesa = () =>
  model([
    part("mesa", [0, 0, 0], [
      box([-90, 0, -70], [180, 70, 140], "#b5532f"),
      box([-84, 70, -64], [168, 40, 128], "#c8693f"),
      box([-72, 110, -54], [144, 14, 108], "#d8b27c"),
    ]),
  ]);

const dryBush = () =>
  model([
    part("bush", [0, 0, 0], [round("sphere", [-14, 0, -14], [28, 18, 28], "#9a8a4a", { segments: 6, smooth: false }), round("sphere", [-6, 6, -6], [20, 14, 18], "#b6a35a", { segments: 6, smooth: false })]),
  ]);

const bush = () =>
  model([part("bush", [0, 0, 0], [round("sphere", [-18, 0, -18], [36, 24, 36], "#356b34", { segments: 6, smooth: false }), round("sphere", [-8, 8, -6], [24, 18, 22], "#3f8040", { segments: 6, smooth: false })])]);

const blob = () => model([part("shadow", [0, 0, 0], [round("cylinder", [-26, 2.6, -40], [52, 0.4, 80], "#00000055", { segments: 12 })])]);

const spark = () => model([part("puff", [0, 0, 0], [round("sphere", [-8, 0, -8], [16, 12, 16], "#d9c7a3cc", { segments: 6, smooth: false })])]);

const tower = () =>
  model([
    part("tower", [0, 0, 0], [
      box([-40, 0, -30], [80, 90, 60], "#e5e7eb"),
      box([-46, 90, -36], [92, 8, 72], "#d62828"),
      box([-34, 98, -24], [68, 26, 48], "#27384d"),
      box([-30, 124, -20], [60, 5, 40], "#e5e7eb"),
      box([-1, 129, -1], [2, 40, 2], "#9ca3af"),
      box([1, 150, -1], [30, 18, 1], "#fcd34d"),
    ]),
  ]);

await withServer(async (nova) => {
  const all = {
    car: car({ paint: "#d62828", trim: "#1f2937", stripe: "#f8fafc" }),
    car_blue: car({ paint: "#2563eb", trim: "#0f172a", stripe: "#fcd34d" }),
    car_green: car({ paint: "#16a34a", trim: "#1f2937", stripe: "#f8fafc" }),
    car_yellow: car({ paint: "#f5b700", trim: "#111827", stripe: "#111827" }),
    pine: pine(["#2d6a3a", "#357a42", "#418c4c"]),
    pine_dark: pine(["#24543a", "#2b6444", "#347653"]),
    autumn_tree: roundTree("#d9702f"),
    birch: roundTree("#9bbf4a"),
    rock: rock("#8a8f98", "#9aa0a8"),
    rock_red: rock("#a8553a", "#b9694a"),
    bush: bush(),
    dry_bush: dryBush(),
    cactus: cactus(),
    mesa: mesa(),
    guardrail: barrier("#9ca3af", "#6b7280"),
    tires: tires(),
    hay_bale: bale(),
    sign_chevron: sign(),
    start_arch: arch(),
    road_asphalt: road("#3a3d44", "#e5e7eb", "#e5e7eb"),
    road_dirt: road("#a67c4e", "#d9b88a", null),
    road_start: startLine(),
    ground_grass: ground("#4f8a3c"),
    ground_sand: ground("#d9b277"),
    mountain: mountain("#6b7a8f", "#f8fafc"),
    mountain_red: mountain("#a85d3a", "#e8c9a0"),
    cloud: cloud(),
    shadow: blob(),
    dust: spark(),
    tower: tower(),
  };
  for (const [name, doc] of Object.entries(all)) console.log(await nova.call("model_write", { name, model: doc }));
});
