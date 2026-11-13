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
    ground: (x0, x1, y, kind = "ground") => { o.push({ kind: "platform", x: x0, y, props: { w: x1 - x0, h: 700, kind } }); surf(x0, x1, y, "ground"); },
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
