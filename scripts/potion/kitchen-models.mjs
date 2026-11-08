// Potion Panic's kitchen pieces: a model for each (written through the MCP server's model_write, so each is a models/<name>.model.json the studio's
// model editor opens and the .glb the game loads) and an entity kind for each (entities/<kind>.lua, the model's name without "k_"), which is what
// the scene editor's palette offers: a level (scenes/levels/*.scene.json) is pieces placed on the grid. The game draws them and adds what moves
// (items, stickers, bottles, a brew's liquid and eyes, the bell). Each biome has its own floor, walls and
// counters in its colours (from lib/data.lua); crates, the bin, ice, mud, lava and belts are the same everywhere.
//   scripts/env.sh node scripts/potion/kitchen-models.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect } from "../rally/mcp.mjs";

const PROJECT = join(new URL("../..", import.meta.url).pathname, "examples/potion-panic");

// the biomes' colours, read from lib/data.lua so that there is one place to change them
const data = readFileSync(join(PROJECT, "lib/data.lua"), "utf8");
const BIOMES = {};
for (const m of data.matchAll(/\{ id = "(\w+)",[^\n]*/g)) {
  const line = m[0];
  const col = (key) => (line.match(new RegExp(`\\b${key} = \\{ (\\d+), (\\d+), (\\d+) \\}`)) ?? []).slice(1).map(Number);
  if (["meadow", "frost", "ember", "mire"].includes(m[1])) BIOMES[m[1]] = { floor: col("floor"), floor2: col("floor2"), wall: col("wall"), counter: col("counter"), top: col("top") };
}

// ---- building blocks (model units: 16 to a metre; a cell is 16 across, its middle at the origin, the floor at y = 0) ------------------------
const hex = (c) => "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const mul = (c, k) => c.map((v) => v * k);
const box = (from, size, color, more = {}) => ({ shape: "box", from, size, color: hex(color), ...more });
const cyl = (from, size, color, more = {}) => ({ shape: "cylinder", from, size, color: hex(color), segments: 24, ...more });
const model = (...cubes) => ({ version: 1, scale: 0.0625, parts: [{ name: "piece", origin: [0, 0, 0], rotation: [0, 0, 0], cubes: cubes.flat(), children: [] }] });

const COUNTER_H = 8.32, TOP_H = 9.6; // (0.52 and 0.6 m: what lib/view.lua and the stations' items stand on)
const WOOD = [176, 120, 74], LID = [214, 162, 104];

const floorTile = (c) => [box([-8, -0.96, -8], [16, 0.88, 16], mul(c, 0.68)), box([-7.44, -0.16, -7.44], [14.88, 0.35, 14.88], c)];
const counter = (b) => [
  box([-7.68, 0, -7.68], [15.36, 1.28, 15.36], mul(b.counter, 0.55)),
  box([-8, 1.28, -8], [16, COUNTER_H - 1.28, 16], b.counter),
  box([-8.48, COUNTER_H, -8.48], [16.96, TOP_H - COUNTER_H, 16.96], b.top),
  ...[-1, 1].flatMap((i) => [box([i * 4 - 2.88, 2.88, 8], [5.76, 4.16, 0.24], mul(b.counter, 0.8)), box([i * 4 - 1.12, 4.8, 8.24], [2.24, 0.64, 0.4], [220, 210, 190])]),
];
const block = (body, top) => [box([-7.68, 0, -7.68], [15.36, 0.96, 15.36], mul(body, 0.55)), box([-8, 0.96, -8], [16, COUNTER_H - 0.96, 16], body), box([-8.32, COUNTER_H, -8.32], [16.64, TOP_H - COUNTER_H, 16.64], top)];

const pieces = {};
for (const [id, b] of Object.entries(BIOMES)) {
  pieces[`k_${id}_floor`] = model(floorTile(b.floor));
  pieces[`k_${id}_floor_b`] = model(floorTile(b.floor2));
  pieces[`k_${id}_start`] = model(floorTile(b.floor), cyl([-4.5, 0.19, -4.5], [9, 0.16, 9], [80, 160, 255]), cyl([-3.2, 0.22, -3.2], [6.4, 0.16, 6.4], b.floor));
  const w = b.wall;
  pieces[`k_${id}_wall`] = model(
    box([-8, 0, -8], [16, 12.48, 16], mul(w, 0.9)),
    box([-8.32, 12.48, -8.32], [16.64, 1.92, 16.64], mul(w, 1.15)),
    // the joints of the bricks on the face that looks at the camera
    [4.16, 8.32].map((y) => box([-8, y, 8], [16, 0.4, 0.2], mul(w, 0.62))),
    box([-0.2, 0, 8], [0.4, 4.16, 0.2], mul(w, 0.62)), box([-4.2, 4.16, 8], [0.4, 4.16, 0.2], mul(w, 0.62)), box([3.8, 4.16, 8], [0.4, 4.16, 0.2], mul(w, 0.62)),
  );
  // the near wall is low, so that the camera sees over it into the kitchen
  pieces[`k_${id}_wall_low`] = model(box([-8, 0, -2.24], [16, 3.52, 4.48], mul(w, 0.9)));
  pieces[`k_${id}_counter`] = model(counter(b));
  pieces[`k_${id}_bottles`] = model(
    counter(b),
    box([-6.72, TOP_H, -6.72], [13.44, 0.48, 13.44], mul(WOOD, 0.7)),
    [[-6.72, -6.72, 13.44, 0.96], [-6.72, 5.76, 13.44, 0.96], [-6.72, -6.72, 0.96, 13.44], [5.76, -6.72, 0.96, 13.44]].map(([x, z, sx, sz]) => box([x, TOP_H, z], [sx, 3.2, sz], WOOD)),
  );
  pieces[`k_${id}_mortar`] = model(
    counter(b),
    cyl([-4.6, TOP_H, -4.6], [9.2, 1.5, 9.2], [124, 118, 134]),
    cyl([-5.9, TOP_H + 1.5, -5.9], [11.8, 5, 11.8], [179, 174, 189], { segments: 32 }),
    cyl([-6.4, TOP_H + 6.2, -6.4], [12.8, 1, 12.8], [201, 196, 210], { segments: 32 }),
    cyl([-4.8, TOP_H + 6.5, -4.8], [9.6, 0.8, 9.6], [74, 67, 82], { segments: 32 }),
  );
  pieces[`k_${id}_cauldron`] = model(
    counter(b),
    cyl([-6.4, TOP_H, -6.4], [12.8, 6.6, 12.8], [66, 64, 78], { segments: 28 }),
    cyl([-7, TOP_H + 6.4, -7], [14, 1, 14], [92, 90, 106], { segments: 28 }),
    cyl([-5.6, TOP_H + 6.6, -5.6], [11.2, 0.9, 11.2], [28, 24, 32], { segments: 28 }),
    box([-8.2, TOP_H + 4.4, -1.2], [1.6, 1.4, 2.4], [92, 90, 106]), box([6.6, TOP_H + 4.4, -1.2], [1.6, 1.4, 2.4], [92, 90, 106]),
  );
  pieces[`k_${id}_hatch`] = model(counter(b), box([-5.44, TOP_H, -3.52], [7.04, 0.24, 7.04], [214, 170, 80]));
  pieces[`k_${id}_wash`] = model(counter(b), box([-6.4, TOP_H, -6.4], [12.8, 0.32, 12.8], [120, 150, 190]));
}
// the crates: a wooden box with slats, the lid on top, and one to four dots that tell crates a to d apart in the editor (the game puts the
// ingredient's sticker over them)
for (let n = 1; n <= 4; n++) {
  pieces[`k_crate_${n}`] = model(
    block(WOOD, LID),
    [0, 1, 2].map((i) => box([-8, 2.24 + i * 2.08, 8], [16, 0.48, 0.2], mul(WOOD, 0.72))),
    box([-7.04, TOP_H, -7.04], [14.08, 0.32, 14.08], mul(LID, 1.08)),
    Array.from({ length: n }, (_, i) => cyl([(i - (n - 1) / 2) * 3 - 0.9, TOP_H + 0.32, -0.9], [1.8, 0.2, 1.8], [90, 50, 30], { segments: 12 })),
  );
}
pieces.k_bin = model(block([112, 116, 130], [150, 156, 170]), box([-6.08, TOP_H, -6.08], [12.16, 0.19, 12.16], [28, 26, 34]));
pieces.k_ice = model(floorTile([150, 206, 250]), box([-6.4, 0.2, -6.4], [12.8, 0.11, 12.8], [196, 230, 255], { emissive: 0.6 }));
pieces.k_ice_b = model(floorTile([182, 222, 252]), box([-6.4, 0.2, -6.4], [12.8, 0.11, 12.8], [210, 238, 255], { emissive: 0.6 }));
pieces.k_mud = model(floorTile([96, 74, 52]), [[-4, -3], [3, 2], [-1, 4]].map(([x, z]) => cyl([x - 1.6, 0.18, z - 1.2], [3.2, 0.14, 2.4], [80, 60, 42], { segments: 12 })));
pieces.k_lava = model(box([-8, -1.92, -8], [16, 1.92, 16], [255, 120, 30], { emissive: 1 }));
pieces.k_pulse = model(floorTile([110, 76, 64]), [-5, 0, 5].map((x) => box([x - 1.2, 0.2, -7], [2.4, 0.08, 14], [200, 90, 40])));
const arrow = (dx, dz) => {
  // three chevrons pointing along the belt, as flat boxes (the game moves bright ones over them)
  const out = [];
  for (const k of [-5, 0, 5]) out.push(box([dx ? k - 1.2 : -4, 0.2, dz ? k - 1.2 : -4], [dx ? 2.4 : 8, 0.1, dz ? 2.4 : 8], [150, 128, 60]));
  return out;
};
pieces.k_belt_e = model(floorTile([70, 64, 74]), arrow(1, 0));
pieces.k_belt_w = model(floorTile([70, 64, 74]), arrow(1, 0));
pieces.k_belt_n = model(floorTile([70, 64, 74]), arrow(0, 1));
pieces.k_belt_s = model(floorTile([70, 64, 74]), arrow(0, 1));

if (import.meta.url === `file://${process.argv[1]}`) {
  const nova = await connect(PROJECT);
  try {
    for (const [name, doc] of Object.entries(pieces)) {
      const r = await nova.call("model_write", { name, model: doc });
      if (!/glb/.test(r)) console.log(name, r);
    }
    console.log(`wrote ${Object.keys(pieces).length} kitchen models`);
    // and the entity kinds the scene editor places
    const { writeFileSync } = await import("node:fs");
    for (const name of Object.keys(pieces)) {
      const kind = name.slice(2);
      writeFileSync(join(PROJECT, "entities", `${kind}.lua`), `-- A kitchen piece (scripts/potion/kitchen-models.mjs): place it on the grid in a level's scene file.\nreturn nova.entity(require("entities.piece"), { model = "${name}" })\n`);
    }
    console.log(`wrote ${Object.keys(pieces).length} kitchen piece kinds`);
  } finally {
    nova.close();
  }
}
