// Lantern Keep: a small top-down dungeon game, made the way a person would make it in the studio, through the Nova MCP server.
// This script draws the sprites and tiles, makes the sounds and music and lays out the three rooms; the game's code is
// plain Lua in examples/lantern-keep (entities/, scenes/, lib/), written by hand.
//   node scripts/lantern/build.mjs
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "../rally/mcp.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const GAME = join(root, "examples/lantern-keep");
mkdirSync(GAME, { recursive: true });

// ---- drawing helpers: a 16x16 picture as a grid of characters, doubled to 32x32 when it is written ------------------------
const grid = () => Array.from({ length: 16 }, () => Array(16).fill("."));
const set = (g, x, y, ch) => {
  if (x >= 0 && x < 16 && y >= 0 && y < 16) g[y][x] = ch;
};
const rect = (g, x0, y0, x1, y1, ch) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(g, x, y, ch);
};
/// A filled rectangle with a one-pixel outline in `o`.
const blob = (g, x0, y0, x1, y1, fill, o = "o") => {
  rect(g, x0 - 1, y0 - 1, x1 + 1, y1 + 1, o);
  rect(g, x0, y0, x1, y1, fill);
};
const rows = (g) => g.map((r) => r.join(""));
const double = (picture) => picture.flatMap((row) => {
  const wide = [...row].map((c) => c + c).join("");
  return [wide, wide];
});

// ---- the hero: a hooded wanderer facing right (the game flips him), with a sword ----------------------------------------------
const heroPalette = { o: "#1a1a24", b: "#2f5d9e", s: "#f2c9a0", e: "#1a1a24", t: "#4aa3a2", n: "#6b4423", k: "#2a2a35", w: "#e3eaf2", g: "#e2b33c", c: "#9fb4c9" };
function hero({ bob = 0, legs = "stand", sword = null }) {
  const g = grid();
  // legs
  const leg = (x0, x1, y0, y1) => blob(g, x0, y0, x1, y1, "k");
  if (legs === "stand") { leg(5, 7, 12 + bob, 14); leg(8, 10, 12 + bob, 14); }
  if (legs === "a") { leg(4, 6, 12 + bob, 14); leg(9, 11, 12 + bob, 13); }
  if (legs === "b") { leg(6, 8, 12 + bob, 13); leg(8, 10, 12 + bob, 14); }
  if (legs === "c") { leg(5, 7, 12 + bob, 13); leg(10, 12, 12 + bob, 14); }
  // body, belt, arm
  blob(g, 5, 7 + bob, 10, 11 + bob, "t");
  rect(g, 5, 10 + bob, 10, 10 + bob, "n");
  // head and hood
  blob(g, 5, 2 + bob, 10, 6 + bob, "s");
  rect(g, 5, 2 + bob, 10, 3 + bob, "b");
  rect(g, 4, 3 + bob, 5, 7 + bob, "b");
  set(g, 9, 5 + bob, "e");
  set(g, 10, 5 + bob, "e");
  if (!sword) {
    rect(g, 10, 8 + bob, 11, 9 + bob, "s");
  }
  // the sword swings from up, to forward, to down in front
  if (sword === 0) { rect(g, 11, 1, 11, 8, "w"); rect(g, 12, 2, 12, 5, "c"); rect(g, 10, 8, 12, 8, "g"); rect(g, 10, 9, 11, 9, "s"); }
  if (sword === 1) { rect(g, 11, 9, 15, 9, "w"); rect(g, 11, 10, 14, 10, "c"); rect(g, 10, 8, 10, 11, "g"); rect(g, 10, 9, 10, 9, "s"); }
  if (sword === 2) { rect(g, 12, 10, 12, 15, "w"); rect(g, 13, 11, 13, 14, "c"); rect(g, 10, 10, 13, 10, "g"); rect(g, 10, 9, 11, 9, "s"); }
  return rows(g);
}

function slime(squash) {
  const g = grid();
  const top = squash ? 9 : 7;
  for (let y = top; y <= 13; y++) {
    const inset = y === top ? 3 : y === top + 1 ? 1 : 0;
    const spread = squash ? -1 : 0;
    rect(g, 3 + inset + spread, y, 12 - inset - spread, y, "q");
  }
  // outline: any empty cell touching a body cell
  const copy = g.map((r) => [...r]);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (copy[y][x] === ".") {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (copy[y + dy]?.[x + dx] === "q") g[y][x] = "o";
  }
  rect(g, 5, top + 1, 6, top + 2, "h");
  rect(g, 6, top + 4, 6, top + 5, "e"); rect(g, 9, top + 4, 9, top + 5, "e");
  set(g, 6, top + 4, "w"); set(g, 9, top + 4, "w");
  return rows(g);
}
const slimePalette = { o: "#14301c", q: "#5ccf6c", h: "#a9f0b2", e: "#14301c", w: "#ffffff" };

function bat(up) {
  const g = grid();
  blob(g, 6, 6, 9, 9, "v");
  const wing = (x0, x1) => {
    if (up) { rect(g, x0, 3, x1, 5, "u"); rect(g, x0, 6, x1, 7, "u"); }
    else { rect(g, x0, 8, x1, 10, "u"); rect(g, x0, 6, x1, 7, "u"); }
  };
  wing(1, 5);
  wing(10, 14);
  set(g, 7, 7, "r"); set(g, 8, 7, "r");
  set(g, 6, 4, "o"); set(g, 9, 4, "o");
  rect(g, 6, 5, 6, 5, "v"); rect(g, 9, 5, 9, 5, "v");
  return rows(g);
}
const batPalette = { o: "#201028", v: "#5b3a78", u: "#7d56a0", r: "#ff6b6b" };

const keyArt = (() => {
  const g = grid();
  blob(g, 4, 2, 9, 6, "y");
  rect(g, 6, 4, 7, 4, ".");
  rect(g, 6, 7, 7, 13, "y"); rect(g, 5, 6, 8, 6, "y");
  rect(g, 8, 11, 10, 11, "y"); rect(g, 8, 13, 10, 13, "y");
  rect(g, 5, 2, 6, 3, "l");
  // an outline around the shaft
  const c = g.map((r) => [...r]);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (c[y][x] === ".") for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (c[y + dy]?.[x + dx] === "y" || c[y + dy]?.[x + dx] === "l") g[y][x] = "o";
  rect(g, 6, 4, 7, 4, ".");
  return rows(g);
})();
const keyPalette = { o: "#4a3410", y: "#f2c230", l: "#fff0a0" };

const heart = (full) => {
  const g = grid();
  const shape = ["..xx...xx..", ".xxxx.xxxx.", "xxxxxxxxxxx", "xxxxxxxxxxx", ".xxxxxxxxx.", "..xxxxxxx..", "...xxxxx...", "....xxx....", ".....x....."];
  shape.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === "x") set(g, x + 2, y + 3, full ? "r" : "d"); }));
  const c = g.map((r) => [...r]);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (c[y][x] === ".") for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1]]) if (c[y + dy]?.[x + dx] === "r" || c[y + dy]?.[x + dx] === "d") g[y][x] = "o";
  if (full) { set(g, 4, 5, "p"); set(g, 5, 5, "p"); set(g, 4, 6, "p"); }
  return rows(g);
};
const heartPalette = { o: "#3a0d18", r: "#ee3b55", d: "#4a2a36", p: "#ffb3c0" };

// ---- the tiles: floor, cracked floor, wall, wall with a torch, pillar, door, open doorway --------------------------------
function tile(draw) {
  const g = grid();
  draw(g);
  return rows(g);
}
const speckle = (g, seed, ch) => {
  let s = seed;
  for (let i = 0; i < 9; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    set(g, s % 16, (s >> 8) % 16, ch);
  }
};
const floor = (seed, crack) => tile((g) => {
  rect(g, 0, 0, 15, 15, "a");
  speckle(g, seed, "b");
  speckle(g, seed * 7 + 3, "c");
  rect(g, 0, 15, 15, 15, "b");
  rect(g, 15, 0, 15, 15, "b");
  if (crack) for (const [x, y] of [[3, 3], [4, 4], [5, 4], [6, 5], [7, 6], [7, 7], [8, 8]]) set(g, x, y, "k");
});
const wallBase = (g) => {
  rect(g, 0, 0, 15, 15, "m");
  for (let r = 0; r < 4; r++) {
    const off = r % 2 ? 4 : 0;
    for (let x = -8; x < 16; x += 8) rect(g, x + off, r * 4, x + off + 6, r * 4 + 2, "r");
  }
  rect(g, 0, 0, 15, 0, "h");
};
const wall = tile(wallBase);
const torchWall = tile((g) => {
  wallBase(g);
  rect(g, 7, 9, 8, 13, "k");
  blob(g, 6, 4, 9, 8, "f", "k");
  rect(g, 7, 5, 8, 7, "y");
});
const pillar = tile((g) => {
  rect(g, 0, 0, 15, 15, "a");
  speckle(g, 5, "b");
  blob(g, 3, 2, 12, 13, "s", "k");
  rect(g, 3, 2, 12, 3, "t");
  rect(g, 4, 5, 5, 12, "t");
  rect(g, 10, 5, 12, 12, "z");
  rect(g, 3, 12, 12, 13, "z");
});
const doorClosed = tile((g) => {
  wallBase(g);
  blob(g, 2, 1, 13, 15, "d", "k");
  for (const x of [5, 8, 11]) rect(g, x, 2, x, 14, "w");
  rect(g, 2, 4, 13, 5, "i"); rect(g, 2, 11, 13, 12, "i");
  blob(g, 7, 7, 8, 9, "g", "k");
});
const doorway = tile((g) => {
  wallBase(g);
  blob(g, 3, 2, 12, 15, "x", "k");
  rect(g, 3, 2, 12, 2, "k");
  rect(g, 6, 14, 9, 15, "a");
});
const tilePalette = {
  a: "#3a3550", b: "#332e48", c: "#4a4466", k: "#14121f",
  m: "#4a3f52", r: "#6b5b73", h: "#8a7a92",
  f: "#ff9b3b", y: "#ffe58a",
  s: "#8a8498", t: "#b0abc2", z: "#625c74",
  d: "#7a4a21", w: "#5a3516", i: "#9aa3ad", g: "#f2c230", x: "#0c0a16",
};
const TILES = { floor: 0, floor2: 1, wall: 2, torch: 3, pillar: 4, door: 5, doorway: 6 };

// ---- the three rooms: 30 x 17 tiles of 32 pixels (a screen) -------------------------------------------------------------------
const COLS = 30;
const ROWS = 17;
const DOOR = [29, 8];
function room({ pillars, slimes, bats, key, seed }) {
  const t = Array.from({ length: ROWS }, (_, y) => Array.from({ length: COLS }, (_, x) => ((x * 7 + y * 13 + seed) % 29 === 0 ? TILES.floor2 : TILES.floor)));
  for (let x = 0; x < COLS; x++) { t[0][x] = TILES.wall; t[ROWS - 1][x] = TILES.wall; }
  for (let y = 0; y < ROWS; y++) { t[y][0] = TILES.wall; t[y][COLS - 1] = TILES.wall; }
  for (let x = 3; x < COLS - 2; x += 6) t[0][x] = TILES.torch;
  for (const [x, y] of pillars) t[y][x] = TILES.pillar;
  t[DOOR[1]][DOOR[0]] = TILES.door;
  const at = ([x, y]) => ({ x: x * 32 + 16, y: y * 32 + 16 });
  const objects = [
    { kind: "hero", name: "hero", ...at([2, 8]) },
    { kind: "key", name: "key", ...at(key) },
    ...slimes.map((p) => ({ kind: "slime", ...at(p) })),
    ...bats.map((p) => ({ kind: "bat", ...at(p) })),
  ];
  return {
    version: 1,
    background: [20, 18, 31],
    width: COLS * 32,
    height: ROWS * 32,
    objects,
    tilemaps: [{ name: "map", tileset: { image: "sprites/tiles.png", tile_width: 32, tile_height: 32 }, x: 0, y: 0, depth: 90, solid: [TILES.wall, TILES.torch, TILES.pillar, TILES.door], tiles: t }],
  };
}
const ROOMS = {
  room1: room({ seed: 1, pillars: [[10, 4], [10, 12], [18, 8]], slimes: [[14, 3], [22, 13]], bats: [], key: [26, 3] }),
  room2: room({ seed: 4, pillars: [[8, 8], [14, 4], [14, 12], [21, 8]], slimes: [[12, 8], [20, 3], [24, 13]], bats: [[17, 8]], key: [25, 14] }),
  room3: room({ seed: 9, pillars: [[7, 5], [7, 11], [13, 8], [19, 4], [19, 12]], slimes: [[11, 3], [16, 13], [24, 8]], bats: [[10, 8], [22, 4], [22, 12]], key: [26, 8] }),
};
const titleScene = {
  version: 1,
  background: [20, 18, 31],
  objects: [{ kind: "title_hero", x: 480, y: 330 }],
};

// ---- sound -------------------------------------------------------------------------------------------------------------------
const sfx = {
  slash: { params: { wave: "noise", freq: 2400, slide: -1.5, attack: 0, sustain: 0.02, decay: 0.12, highpass: 1200, lowpass: 9000, volume: 0.4 } },
  hit_enemy: { preset: "hit", params: { volume: 0.55 } },
  enemy_die: { params: { wave: "noise", freq: 420, slide: -1.6, attack: 0, sustain: 0.05, decay: 0.3, punch: 0.4, lowpass: 3000, volume: 0.55 } },
  hurt: { params: { wave: "square", freq: 240, slide: -1.4, attack: 0, sustain: 0.08, decay: 0.3, duty: 0.3, volume: 0.55 } },
  key: { preset: "coin", params: { freq: 740, arpSemitones: 7, arpTime: 0.08, volume: 0.55 } },
  heart: { preset: "powerup", params: { volume: 0.5 } },
  door: { params: { wave: "square", freq: 160, slide: 1.2, attack: 0, sustain: 0.18, decay: 0.4, duty: 0.4, lowpass: 2000, volume: 0.5 } },
  win: { params: { wave: "square", freq: 392, arpSemitones: 9, arpTime: 0.14, attack: 0, sustain: 0.5, decay: 0.7, duty: 0.4, punch: 0.3, volume: 0.5 } },
  lose: { params: { wave: "triangle", freq: 330, slide: -0.9, attack: 0, sustain: 0.3, decay: 0.7, volume: 0.55 } },
  blip: { preset: "blip", params: { freq: 620, volume: 0.35 } },
  accept: { preset: "coin", params: { freq: 523, arpSemitones: 7, arpTime: 0.06, volume: 0.45 } },
};
const track = (name, kind, wave, notes, o = {}) => ({ name, kind, wave, duty: 0.5, attack: 0.01, decay: 0.1, sustain: 0.6, release: 0.12, volume: 0.5, pan: 0, mute: false, notes, ...o });
const keepSong = (() => {
  // D minor, eight bars: Dm  Bb  F  C  Dm  Bb  Gm  A
  const chords = [[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55], [50, 53, 57], [46, 50, 53], [43, 46, 50], [45, 49, 52]];
  const roots = [38, 34, 41, 36, 38, 34, 31, 33];
  const arp = chords.flatMap((c, bar) => Array.from({ length: 8 }, (_, i) => ({ step: bar * 16 + i * 2, len: 2, pitch: c[[0, 1, 2, 1][i % 4]] + 12 + (i === 7 ? 12 : 0), vel: i % 4 === 0 ? 0.7 : 0.5 })));
  const bass = roots.flatMap((r, bar) => [[0, 6], [8, 4], [12, 4]].map(([s, l]) => ({ step: bar * 16 + s, len: l, pitch: r, vel: 0.8 })));
  const pad = chords.flatMap((c, bar) => c.map((p) => ({ step: bar * 16, len: 16, pitch: p, vel: 0.35 })));
  const drums = Array.from({ length: 8 }, (_, bar) => [{ step: bar * 16, pitch: 36, vel: 0.7 }, { step: bar * 16 + 8, pitch: 36, vel: 0.55 }, { step: bar * 16 + 4, pitch: 42, vel: 0.25 }, { step: bar * 16 + 12, pitch: 42, vel: 0.25 }]).flat().map((n) => ({ ...n, len: 1 }));
  return {
    version: 1, bpm: 84, stepsPerBeat: 4, length: 128,
    tracks: [
      track("arp", "synth", "triangle", arp, { volume: 0.34, attack: 0.005, decay: 0.12, sustain: 0.3, release: 0.1, pan: 0.15 }),
      track("bass", "synth", "saw", bass, { volume: 0.3, sustain: 0.5 }),
      track("pad", "synth", "sine", pad, { volume: 0.3, attack: 0.2, release: 0.5, pan: -0.2 }),
      track("drums", "drums", "noise", drums, { volume: 0.4 }),
    ],
  };
})();

// ---- write everything ---------------------------------------------------------------------------------------------------------
if (!existsSync(join(GAME, "nova.json"))) {
  const first = await connect(GAME);
  console.log(await first.call("project_create", { name: "Lantern Keep" }));
  first.close();
}
const nova = await connect(GAME);
try {
  const sprite = (name, frames, palette, animations) => nova.call("sprite_write", { name, palette, frames: frames.map(double), animations, frame_ms: 110 });
  console.log(await sprite("hero", [
    hero({}), hero({ bob: 1 }),
    hero({ legs: "a" }), hero({ legs: "stand" }), hero({ legs: "c" }), hero({ legs: "stand", bob: 0 }),
    hero({ sword: 0 }), hero({ sword: 1 }), hero({ sword: 2 }),
  ], heroPalette, [
    { name: "idle", from: 0, to: 1 },
    { name: "walk", from: 2, to: 5 },
    { name: "slash", from: 6, to: 8, loop: false },
  ]));
  console.log(await sprite("slime", [slime(false), slime(true)], slimePalette, [{ name: "wobble", from: 0, to: 1 }]));
  console.log(await sprite("bat", [bat(true), bat(false)], batPalette, [{ name: "flap", from: 0, to: 1 }]));
  console.log(await sprite("key", [keyArt], keyPalette));
  console.log(await sprite("heart", [heart(true), heart(false)], heartPalette));
  console.log(await sprite("tiles", [floor(3, false), floor(8, true), wall, torchWall, pillar, doorClosed, doorway], tilePalette));
  for (const [name, a] of Object.entries(sfx)) console.log(await nova.call("sfx_write", { name, ...a }));
  console.log(await nova.call("song_write", { name: "keep", song: keepSong }));
  for (const [name, scene] of Object.entries(ROOMS)) console.log(await nova.call("scene_write", { name, scene }));
  console.log(await nova.call("scene_write", { name: "title", scene: titleScene }));
} finally {
  nova.close();
}
