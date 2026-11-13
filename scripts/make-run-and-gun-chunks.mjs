// Makes the chunks the level generator of examples/run-and-gun joins together: scenes/chunks/*.scene.json. They are ordinary scene files (open them in the studio's scene
// editor and change them); this script is how the first set was made. Each has a gate "in" on the ground at its left edge and a gate "out" on the ground at its right edge;
// the generator lines the chunks up by those. A chance (0 to 1) on a soldier, turret or health pack is how likely it is to be there (more likely later in the level).
// Checks: every ledge, step and platform can be reached from one below it; the ground meets both gates.
// Run:  scripts/env.sh node scripts/make-run-and-gun-chunks.mjs
import fs from "node:fs";

const MAX_UP = 85, MAX_GAP = 110; // a full jump is about 112 high and 130 long; keep a margin
const chunks = {};

function chunk(name, W, inY, outY, build) {
  const o = [], surfaces = [];
  const surf = (x0, x1, top, what, reach) => surfaces.push({ x0, x1, top, what, reach });
  const api = {
    ground: (x0, x1, y, kind = "ground", reach, h = 700) => { o.push({ kind: "platform", x: x0, y, props: { w: x1 - x0, h, kind } }); surf(x0, x1, y, "ground", reach); },
    ledge: (x, y, w, reach) => { o.push({ kind: "platform", x, y, props: { w, h: 12, oneway: true, kind: "metal" } }); surf(x, x + w, y, "ledge", reach); },
    block: (x, y, w, h, kind = "rock", reach) => { o.push({ kind: "platform", x, y, props: { w, h, kind } }); surf(x, x + w, y, "block", reach); },
    ladder: (x, y, h) => o.push({ kind: "ladder", x, y, props: { h } }),
    soldier: (x, y, style, chance = 1, hp) => o.push({ kind: "soldier", x, y, props: { style, chance, ...(hp ? { hp } : {}) } }),
    turret: (x, y, chance = 1) => o.push({ kind: "turret", x, y, props: { chance } }),
    medkit: (x, y, chance = 0.5) => o.push({ kind: "medkit", x, y, props: { chance } }),
    boss: (x, y) => o.push({ kind: "boss", x, y }),
    reach: (name) => name, // (a note in the code: this one is reached some other way than by a jump from below)
  };
  build(api);
  o.push({ kind: "gate", x: 0, y: inY, props: { side: "in" } }, { kind: "gate", x: W, y: outY, props: { side: "out" } });
  // checks: the ground meets both gates, and every surface can be reached from the way in by jumps (a full jump rises about 112 and carries about 130; two jumps about 200;
  // a ladder or a wall jump is trusted where the chunk says so), and the way out can be reached.
  const covers = (x, top) => surfaces.filter((s) => s.x0 <= x && s.x1 >= x && s.top === top);
  const gap = (s, t) => Math.max(0, Math.max(s.x0 - t.x1, t.x0 - s.x1));
  if (!covers(8, inY).length || !covers(W - 8, outY).length) throw new Error(`${name}: the ground does not meet its gates`);
  const reached = new Set(covers(8, inY));
  for (const t of surfaces) if (t.reach === "ladder" || t.reach === "wall jump") reached.add(t);
  for (let grew = true; grew; ) {
    grew = false;
    for (const s of [...reached]) for (const t of surfaces) {
      if (reached.has(t) || gap(s, t) > MAX_GAP) continue;
      const up = s.top - t.top; // how far above s the next surface is
      if (up <= MAX_UP || (t.reach === "double jump" && up <= 190)) { reached.add(t); grew = true; }
    }
  }
  for (const t of surfaces) if (!reached.has(t)) throw new Error(`${name}: cannot be reached: ${t.what} at x ${t.x0}, top ${t.top}`);
  if (!covers(W - 8, outY).some((t) => reached.has(t))) throw new Error(`${name}: the way out cannot be reached`);
  chunks[name] = { W, inY, outY, objects: o };
}

chunk("start", 640, 440, 440, ({ ground }) => { ground(0, 640, 440); });

chunk("flat_a", 960, 440, 440, ({ ground, ledge, ladder, soldier, turret, medkit }) => {
  ground(0, 960, 440);
  ledge(250, 360, 140); ledge(480, 290, 130, "ladder"); ladder(500, 290, 150);
  soldier(520, 440, "rusher", 0.9); soldier(700, 440, "gunner", 0.9); soldier(840, 440, "rusher", 0.5);
  turret(560, 290, 0.6); medkit(320, 330, 0.4);
});

chunk("flat_pits", 1000, 440, 440, ({ ground, block, soldier, turret, medkit }) => {
  ground(0, 300, 440); ground(410, 650, 440); ground(760, 1000, 440); // two pits, 110 wide
  block(520, 400, 60, 40);
  soldier(470, 440, "gunner", 0.8); soldier(850, 440, "rusher", 0.8); soldier(920, 440, "gunner", 0.6);
  turret(960, 440, 0.5); medkit(540, 360, 0.4);
});

chunk("bridge", 1100, 440, 440, ({ ground, block, soldier, turret }) => {
  ground(0, 200, 440); ground(900, 1100, 440);
  block(200, 440, 700, 16, "metal"); // a bridge over a pit you would not climb out of
  block(400, 340, 60, 100, "rock", "double jump"); block(700, 340, 60, 100, "rock", "double jump");
  turret(430, 340, 0.8); turret(730, 340, 0.8);
  soldier(300, 440, "gunner", 0.8); soldier(600, 440, "rusher", 0.7); soldier(1000, 440, "gunner", 0.7);
});

chunk("stairs_up", 900, 440, 280, ({ ground, soldier, turret, medkit }) => {
  ground(0, 240, 440); ground(240, 480, 390); ground(480, 700, 330); ground(700, 900, 280); // up in steps of 50 or 60
  soldier(300, 390, "rusher", 0.8); soldier(540, 330, "gunner", 0.8); soldier(760, 280, "rusher", 0.6);
  turret(840, 280, 0.5); medkit(620, 280, 0.4);
});

chunk("climb_ladders", 760, 440, 200, ({ ground, ledge, ladder, soldier, turret, medkit }) => {
  ground(0, 360, 440); ground(360, 760, 200);
  ledge(300, 200, 60, "ladder"); ladder(330, 200, 240); // up the ladder onto the top
  soldier(200, 440, "gunner", 0.7); soldier(480, 200, "rusher", 0.8); soldier(620, 200, "gunner", 0.7);
  turret(700, 200, 0.7); medkit(420, 170, 0.5);
});

chunk("climb_shaft", 640, 440, 160, ({ ground, block, soldier, turret, medkit }) => {
  ground(0, 400, 440);
  block(300, 160, 40, 230, "rock", "wall jump"); // a pillar with a gap under it; the shaft is between it and the block
  ground(400, 640, 160);
  soldier(120, 440, "rusher", 0.6); soldier(560, 160, "gunner", 0.7); turret(600, 160, 0.5); medkit(500, 130, 0.6);
});

chunk("drop_down", 900, 280, 520, ({ ground, ledge, ladder, soldier, turret, medkit }) => {
  ground(0, 260, 280);
  ledge(300, 340, 120); ledge(470, 400, 120); ledge(640, 460, 120); ladder(745, 460, 60);
  ground(300, 900, 520);
  soldier(420, 520, "gunner", 0.8); soldier(580, 520, "rusher", 0.8); soldier(760, 520, "gunner", 0.6);
  turret(540, 400, 0.6); medkit(350, 490, 0.4);
});

chunk("gauntlet", 1100, 440, 440, ({ ground, block, soldier, turret, medkit }) => {
  ground(0, 1100, 440);
  block(300, 320, 60, 120, "rock", "double jump"); block(600, 320, 60, 120, "rock", "double jump"); block(900, 320, 60, 120, "rock", "double jump");
  turret(330, 320, 0.8); turret(630, 320, 0.8); turret(930, 320, 0.7);
  block(150, 410, 50, 30); block(450, 400, 50, 40); block(780, 410, 50, 30);
  soldier(250, 440, "rusher", 0.7); soldier(500, 440, "gunner", 0.8); soldier(700, 440, "gunner", 0.8); soldier(850, 440, "rusher", 0.7); soldier(1000, 440, "gunner", 0.6);
  medkit(780, 380, 0.7);
});

chunk("platforms", 1000, 440, 440, ({ ground, block, soldier, turret, medkit }) => {
  ground(0, 140, 440); ground(910, 1000, 440);
  block(240, 400, 100, 20, "metal"); block(440, 360, 100, 20, "metal"); block(640, 410, 100, 20, "metal"); block(830, 370, 90, 20, "metal"); // over a pit
  soldier(470, 360, "gunner", 0.8); soldier(860, 370, "gunner", 0.7); turret(690, 410, 0.5); medkit(590, 330, 0.5);
});

// ---- tall chunks: several floors, joined by ladders, drops and jumps (levels in layers)

// five floors climbing a tower, the ladders alternating left and right (580 up)
chunk("tower_up", 800, 440, -160, ({ ground, ledge, ladder, soldier, turret, medkit }) => {
  ground(0, 420, 440);
  ledge(300, 320, 440, "ladder"); ledge(300, 200, 440, "ladder"); ledge(300, 80, 440, "ladder"); ledge(300, -40, 440, "ladder");
  ground(300, 800, -160, "ground", "ladder", 60); // (thin: the tower is hollow below it)
  ladder(330, 320, 120); ladder(690, 200, 120); ladder(330, 80, 120); ladder(690, -40, 120); ladder(330, -160, 120);
  soldier(150, 440, "gunner", 0.7); soldier(560, 320, "rusher", 0.7); soldier(450, 200, "gunner", 0.7); soldier(600, 80, "rusher", 0.7); soldier(480, -40, "gunner", 0.7);
  turret(720, 320, 0.6); turret(380, 200, 0.6); turret(700, 80, 0.6); medkit(520, 40, 0.6); medkit(600, -200, 0.5);
});

// a long drop through ledges to the floor far below (580 down)
chunk("shaft_down", 800, 300, 880, ({ ground, ledge, ladder, soldier, turret, medkit }) => {
  ground(0, 300, 300, "ground", undefined, 60); // (thin, so that the ledges under it are free)
  ledge(330, 420, 200); ledge(80, 540, 260); ledge(420, 660, 260); ledge(100, 780, 260);
  ground(0, 800, 880);
  soldier(500, 880, "gunner", 0.8); soldier(650, 880, "rusher", 0.8); soldier(200, 880, "rusher", 0.6);
  turret(480, 420, 0.7); turret(180, 540, 0.7); turret(560, 660, 0.7); medkit(250, 740, 0.6); medkit(400, 840, 0.5);
});

// the main way is along the bottom; above it a walkway with ladders at both ends: a harder way with health packs and turrets
chunk("two_floors", 1200, 440, 440, ({ ground, ledge, ladder, soldier, turret, medkit, block }) => {
  ground(0, 1200, 440);
  ledge(250, 240, 700, "ladder"); ladder(270, 240, 200); ladder(930, 240, 200);
  ledge(520, 340, 120);
  turret(450, 240, 0.8); turret(750, 240, 0.8); medkit(600, 200, 0.8); soldier(380, 240, "gunner", 0.8); soldier(820, 240, "rusher", 0.7);
  soldier(180, 440, "rusher", 0.8); soldier(560, 440, "gunner", 0.8); soldier(1000, 440, "rusher", 0.7); soldier(1100, 440, "gunner", 0.6);
  block(700, 400, 50, 40);
});

// three layers of floor in one room, ladders between them (an arena)
chunk("three_layers", 1100, 440, 440, ({ ground, ledge, ladder, soldier, turret, medkit }) => {
  ground(0, 1100, 440);
  ledge(150, 300, 400, "ladder"); ledge(620, 300, 330, "ladder"); ledge(330, 160, 440, "ladder");
  ladder(170, 300, 140); ladder(900, 300, 140); ladder(360, 160, 140); ladder(740, 160, 140);
  soldier(300, 440, "rusher", 0.8); soldier(700, 440, "gunner", 0.8); soldier(1000, 440, "rusher", 0.7);
  soldier(280, 300, "gunner", 0.8); soldier(800, 300, "gunner", 0.7); soldier(450, 160, "rusher", 0.7); soldier(650, 160, "gunner", 0.8);
  turret(520, 300, 0.7); turret(880, 300, 0.7); turret(560, 160, 0.8); medkit(540, 120, 0.8); medkit(350, 270, 0.5);
});

// a climb by jumping from block to block (450 up), with the floor below to fall back onto
chunk("jump_tower", 900, 440, -10, ({ ground, block, soldier, turret, medkit }) => {
  ground(0, 900, 440);
  ground(780, 900, -10);
  block(240, 365, 110, 20, "metal"); block(390, 290, 110, 20, "metal"); block(250, 215, 110, 20, "metal"); block(420, 140, 110, 20, "metal"); block(570, 65, 110, 20, "metal"); block(690, -10, 90, 20, "metal");
  soldier(450, 440, "gunner", 0.7); soldier(700, 440, "rusher", 0.7); turret(470, 290, 0.5); turret(300, 215, 0.6); soldier(620, 65, "gunner", 0.6); medkit(480, 100, 0.6);
});

chunk("boss", 900, 440, 440, ({ ground, ledge, soldier, boss, medkit }) => {
  ground(0, 900, 440); ledge(250, 360, 140); ledge(480, 330, 130);
  soldier(450, 440, "gunner", 0.6); medkit(120, 400, 0.8);
  boss(760, 440);
});

fs.mkdirSync("examples/run-and-gun/scenes/chunks", { recursive: true });
for (const [name, c] of Object.entries(chunks)) {
  fs.writeFileSync(`examples/run-and-gun/scenes/chunks/${name}.scene.json`, JSON.stringify({ version: 1, background: [92, 148, 214], objects: c.objects }, null, 2) + "\n");
}
fs.writeFileSync("examples/run-and-gun/scenes/chunks/README.txt", "Chunks for the level generator (lib/gen.lua). Each is a scene file: open it in the scene editor. A gate \"in\" on the ground at the left edge and a gate \"out\" at the right edge say where it joins its neighbours. A \"chance\" on a soldier, turret or health pack says how likely it is to be there. To add a chunk: make a new scene here and add its name to the list in lib/gen.lua.\n");
console.log(Object.entries(chunks).map(([n, c]) => `${n} (${c.W} wide, ${c.outY - c.inY >= 0 ? "down" : "up"} ${Math.abs(c.outY - c.inY)})`).join("\n"));
