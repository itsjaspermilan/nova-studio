// Blockfield's pictures: every block face and item as a 16 x 16 tile, drawn by code (original, programmer art), packed
// into one 256 x 256 atlas. Writes examples/blockfield/textures/blocks.png and examples/blockfield/lib/tiles.lua (name -> tile number).
//   node scripts/blockfield/textures.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const GAME = join(root, "examples/blockfield");
const T = 16;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const shade = (c, d) => [clamp(c[0] + d), clamp(c[1] + d), clamp(c[2] + d)];
const mix = (a, b, t) => [0, 1, 2].map((i) => clamp(a[i] + (b[i] - a[i]) * t));

const tiles = [];
const names = {};
/** Draws a tile: f(x, y, r) returns [r, g, b] or [r, g, b, a]. */
function tile(name, f, seed = tiles.length + 1) {
  const r = rng(seed * 7919);
  const data = new Uint8Array(T * T * 4);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const c = f(x, y, r) ?? [0, 0, 0, 0];
      data.set([c[0], c[1], c[2], c[3] ?? 255], (y * T + x) * 4);
    }
  }
  names[name] = tiles.length;
  tiles.push(data);
}
const speckle = (base, amt) => (x, y, r) => shade(base, (r() - 0.5) * amt);

// ---- terrain ----
tile("stone", speckle(hex("#7d7d7d"), 28));
tile("dirt", speckle(hex("#865f43"), 30));
tile("grass_top", speckle(hex("#5f9f35"), 34));
tile("grass_side", (x, y, r) => {
  const fringe = 3 + (((x * 7) ^ (x * 3)) % 3 === 0 ? 1 : 0) - (x % 5 === 0 ? 1 : 0);
  return y < fringe ? shade(hex("#5f9f35"), (r() - 0.5) * 30) : shade(hex("#865f43"), (r() - 0.5) * 30);
});
tile("sand", speckle(hex("#dbcfa3"), 18));
tile("gravel", (x, y, r) => {
  const v = r();
  return v < 0.25 ? shade(hex("#6e6a69"), (r() - 0.5) * 20) : v > 0.85 ? shade(hex("#a09a98"), 10) : shade(hex("#837f7e"), (r() - 0.5) * 24);
});
tile("bedrock", (x, y, r) => (r() < 0.35 ? shade(hex("#2f2f2f"), r() * 20) : shade(hex("#5a5a5a"), (r() - 0.5) * 30)));
tile("cobblestone", (x, y, r) => {
  // stones are cells of a rough 5 x 5 grid, with a dark gap between them
  const cx = Math.floor((x + (Math.floor(y / 5) % 2) * 2) / 5), cy = Math.floor(y / 5);
  const edge = (x + (Math.floor(y / 5) % 2) * 2) % 5 === 0 || y % 5 === 0;
  const tone = ((cx * 37 + cy * 91) % 5) * 6;
  return edge ? shade(hex("#4f4f4f"), (r() - 0.5) * 10) : shade(hex("#8c8c8c"), tone - 12 + (r() - 0.5) * 14);
});
tile("sandstone_side", (x, y, r) => (y % 8 === 7 ? shade(hex("#b7a876"), 0) : shade(hex("#d8cb9a"), (r() - 0.5) * 12)));
tile("sandstone_top", speckle(hex("#d6c996"), 12));
tile("clay", speckle(hex("#9ea4b0"), 14));
tile("snow", speckle(hex("#f4f8fa"), 8));
tile("snow_side", (x, y, r) => (y < 4 - (x % 3 === 0 ? 1 : 0) ? shade(hex("#f4f8fa"), (r() - 0.5) * 8) : shade(hex("#865f43"), (r() - 0.5) * 30)));
tile("ice", (x, y, r) => [150, 200, 240, 255].map((v, i) => (i < 3 ? clamp(v + (r() - 0.5) * 14 + (((x + y) % 7 === 0) ? 18 : 0)) : v)));
tile("water", (x, y, r) => shade(hex("#2f64d8"), (r() - 0.5) * 16 + Math.sin((x + y * 0.5) * 0.9) * 6));
tile("lava", (x, y, r) => mix(hex("#e04a0a"), hex("#ffd23a"), Math.max(0, Math.min(1, 0.45 + Math.sin(x * 0.8 + y * 0.35) * 0.3 + (r() - 0.5) * 0.35))));

// ores are stone with blobs of a colour
function ore(name, color, blobs, seed) {
  const blobAt = new Set();
  const r0 = rng(seed);
  for (let i = 0; i < blobs; i++) {
    const bx = 1 + Math.floor(r0() * 13), by = 1 + Math.floor(r0() * 13);
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) if (r0() < 0.85) blobAt.add(`${bx + dx},${by + dy}`);
  }
  tile(name, (x, y, r) => (blobAt.has(`${x},${y}`) ? shade(hex(color), (r() - 0.5) * 30) : shade(hex("#7d7d7d"), (r() - 0.5) * 28)), seed);
}
ore("coal_ore", "#262626", 6, 101);
ore("iron_ore", "#d6a57c", 6, 102);
ore("gold_ore", "#f2d338", 5, 103);
ore("diamond_ore", "#4ee8e0", 5, 104);

// ---- wood ----
tile("planks", (x, y, r) => {
  const seam = y % 4 === 3 || (x + Math.floor(y / 4) * 5) % 11 === 0;
  return seam ? shade(hex("#8b6a3c"), (r() - 0.5) * 8) : shade(hex("#a07f4c"), (r() - 0.5) * 16 + (Math.floor(y / 4) % 2) * 6);
});
tile("log_side", (x, y, r) => shade(hex("#6b5233"), ((x * 5) % 7) * 4 - 10 + (r() - 0.5) * 14));
tile("log_top", (x, y, r) => {
  const d = Math.hypot(x - 7.5, y - 7.5);
  return d > 7 ? shade(hex("#6b5233"), (r() - 0.5) * 14) : shade(hex("#b99a62"), (Math.floor(d) % 2) * -22 + (r() - 0.5) * 10);
});
tile("birch_side", (x, y, r) => (r() < 0.08 || (y % 6 === 2 && x % 5 < 3) ? shade(hex("#2d2d2d"), r() * 20) : shade(hex("#d8d5c8"), (r() - 0.5) * 16)));
tile("birch_top", (x, y, r) => {
  const d = Math.hypot(x - 7.5, y - 7.5);
  return d > 7 ? shade(hex("#d8d5c8"), (r() - 0.5) * 10) : shade(hex("#c9b987"), (Math.floor(d) % 2) * -18 + (r() - 0.5) * 8);
});
tile("leaves", (x, y, r) => (r() < 0.2 ? null : shade(hex("#3f8a2a"), (r() - 0.5) * 50)));
tile("birch_leaves", (x, y, r) => (r() < 0.2 ? null : shade(hex("#6a9a3c"), (r() - 0.5) * 46)));
tile("glass", (x, y, r) => {
  if (x === 0 || y === 0 || x === 15 || y === 15) return [205, 232, 240, 255];
  if ((x === 2 && y > 1 && y < 6) || (y === 2 && x > 1 && x < 6)) return [255, 255, 255, 255];
  return null;
});
tile("crafting_top", (x, y, r) => (x % 5 === 0 || y % 5 === 0 ? shade(hex("#5b4224"), 0) : shade(hex("#a07f4c"), (r() - 0.5) * 12)));
tile("crafting_side", (x, y, r) => {
  if (y < 3) return shade(hex("#5b4224"), (r() - 0.5) * 6);
  if (y >= 5 && y <= 9 && x >= 3 && x <= 12 && (x + y) % 3 === 0) return shade(hex("#c9c9c9"), 0);
  return shade(hex("#8f6f3f"), (r() - 0.5) * 14);
});
tile("furnace_side", (x, y, r) => (x % 8 === 0 || y % 8 === 0 ? shade(hex("#555555"), 0) : shade(hex("#8a8a8a"), (r() - 0.5) * 22)));
tile("furnace_front", (x, y, r) => {
  if (x >= 4 && x <= 11 && y >= 8 && y <= 13) return shade(hex("#1e1e1e"), (r() - 0.5) * 8);
  return shade(hex("#8a8a8a"), (r() - 0.5) * 22 + (x % 8 === 0 || y % 8 === 0 ? -30 : 0));
});
tile("furnace_front_on", (x, y, r) => {
  if (x >= 4 && x <= 11 && y >= 8 && y <= 13) return mix(hex("#e04a0a"), hex("#ffd23a"), r());
  return shade(hex("#8a8a8a"), (r() - 0.5) * 22 + (x % 8 === 0 || y % 8 === 0 ? -30 : 0));
});
tile("furnace_top", (x, y, r) => shade(hex("#7a7a7a"), (r() - 0.5) * 14 + (x < 2 || y < 2 || x > 13 || y > 13 ? -26 : 0)));
tile("brick", (x, y, r) => {
  const row = Math.floor(y / 4);
  const gap = y % 4 === 3 || (x + (row % 2) * 4) % 8 === 7;
  return gap ? shade(hex("#b9b2a6"), (r() - 0.5) * 8) : shade(hex("#a14b3a"), (r() - 0.5) * 22);
});
tile("cactus_side", (x, y, r) => (x % 4 === 0 ? shade(hex("#2f6b25"), 0) : y % 4 === 1 && x % 4 === 2 ? shade(hex("#c8d8a0"), 0) : shade(hex("#3f8a30"), (r() - 0.5) * 14)));
tile("cactus_top", (x, y, r) => (x < 1 || y < 1 || x > 14 || y > 14 ? shade(hex("#2f6b25"), 0) : shade(hex("#4a9a38"), (r() - 0.5) * 12)));

// ---- plants (crossed pictures: see-through around the plant) ----
tile("tall_grass", (x, y, r) => {
  const blades = [3, 6, 9, 12];
  for (const b of blades) {
    const h = 6 + ((b * 5) % 6);
    if (Math.abs(x - b - Math.sin(y * 0.5 + b) * 0.8) < 0.8 && y > 15 - h) return shade(hex("#5f9f35"), (r() - 0.5) * 36);
  }
  return null;
});
tile("sapling", (x, y, r) => {
  if (x >= 7 && x <= 8 && y >= 9) return shade(hex("#6b5233"), 0);
  if (Math.hypot(x - 7.5, y - 6) < 4.5 && r() < 0.8) return shade(hex("#3f8a2a"), (r() - 0.5) * 40);
  return null;
});
function flower(name, petals) {
  tile(name, (x, y, r) => {
    if (x >= 7 && x <= 8 && y >= 8) return shade(hex("#3f8a2a"), 0);
    if (y >= 9 && y <= 11 && ((x === 5 && y === 10) || (x === 10 && y === 10))) return shade(hex("#3f8a2a"), 0);
    if (Math.hypot(x - 7.5, y - 6.5) < 3) return Math.hypot(x - 7.5, y - 6.5) < 1.2 ? hex("#f2d338") : hex(petals);
    return null;
  });
}
flower("dandelion", "#f2e12e");
flower("rose", "#c01818");
tile("torch", (x, y, r) => {
  if (y >= 6 && y <= 7 && x >= 7 && x <= 8) return y === 6 ? hex("#fff3a0") : hex("#ffb02e");
  if (y >= 8 && x >= 7 && x <= 8) return shade(hex("#8a6a3a"), (r() - 0.5) * 16);
  return null;
});

// ---- items ----
const stick = hex("#8a6a3a");
tile("stick", (x, y) => (Math.abs(x - (15 - y)) <= 0 && y > 2 && y < 14 ? stick : null));
tile("coal", (x, y, r) => (Math.hypot(x - 7.5, y - 7.5) < 5 + (r() - 0.5) * 3 ? shade(hex("#2a2a2a"), (r() - 0.5) * 24) : null));
function ingot(name, c) {
  tile(name, (x, y, r) => (x >= 3 && x <= 12 && y >= 5 && y <= 10 ? shade(hex(c), (y - 7) * 7 + (r() - 0.5) * 10) : null));
}
ingot("iron_ingot", "#dcdcdc");
ingot("gold_ingot", "#f2d338");
tile("diamond", (x, y, r) => {
  const d = Math.abs(x - 7.5) + Math.abs(y - 7.5);
  return d < 6 ? shade(hex("#4ee8e0"), (y < 7 ? 25 : -10) + (r() - 0.5) * 10) : null;
});
tile("gunpowder", (x, y, r) => (Math.hypot(x - 7.5, y - 8.5) < 5 && r() < 0.8 ? shade(hex("#6e6e6e"), (r() - 0.5) * 36) : null));
tile("apple", (x, y, r) => {
  const d = Math.hypot(x - 7.5, y - 9);
  if (x === 8 && y >= 2 && y <= 4) return hex("#6b5233");
  return d < 5 ? shade(hex("#c8201c"), (x < 7 && y < 8 ? 40 : 0) + (r() - 0.5) * 16) : null;
});
tile("pork", (x, y, r) => (Math.hypot((x - 7.5) * 0.8, y - 8) < 5 ? shade(hex("#e8908c"), (r() - 0.5) * 22) : null));
tile("pork_cooked", (x, y, r) => (Math.hypot((x - 7.5) * 0.8, y - 8) < 5 ? shade(hex("#9a5a36"), (r() - 0.5) * 22) : null));
// tools: a handle and a head in the material's colour
const materials = { wood: "#a07f4c", stone: "#8c8c8c", iron: "#dcdcdc", diamond: "#4ee8e0" };
function tool(name, material, head) {
  const m = hex(materials[material]);
  tile(`${material}_${name}`, (x, y, r) => {
    const onHandle = Math.abs(x - (15 - y)) <= 0 && y > 4;
    if (head(x, y)) return shade(m, (r() - 0.5) * 24 + (y < 6 ? 14 : 0));
    return onHandle ? stick : null;
  });
}
const heads = {
  pickaxe: (x, y) => (y >= 2 && y <= 4 && x >= 3 && x <= 13 && Math.abs(x - 8) + y * 0.6 < 9),
  axe: (x, y) => (y >= 2 && y <= 7 && x >= 8 && x <= 13 && x - 8 + (y - 2) * 0.2 <= 5 && !(y > 5 && x < 11)),
  shovel: (x, y) => Math.hypot(x - 11.5, y - 3.5) < 3,
  sword: (x, y) => Math.abs(x - (14 - y)) <= 1 && y >= 1 && y <= 9,
};
for (const m of Object.keys(materials)) for (const [name, h] of Object.entries(heads)) tool(name, m, h);

// ---- overlays ----
const ro = rng(4242);
const crackPath = [];
let cx = 8, cy = 8;
for (let i = 0; i < 90; i++) {
  crackPath.push([cx, cy]);
  cx = Math.max(0, Math.min(15, cx + Math.round((ro() - 0.5) * 3)));
  cy = Math.max(0, Math.min(15, cy + Math.round((ro() - 0.5) * 3)));
  if (i % 9 === 8) { cx = 8; cy = 8; }
}
for (let stage = 0; stage < 10; stage++) {
  const shown = new Set(crackPath.slice(0, 6 + stage * 8).map(([x, y]) => `${x},${y}`));
  tile(`crack_${stage}`, (x, y) => (shown.has(`${x},${y}`) ? [20, 20, 20, 255] : null));
}
tile("outline", (x, y) => (x === 0 || y === 0 || x === 15 || y === 15 ? [10, 10, 10, 255] : null));

// ---- pack ----
const SIZE = 256;
const atlas = new Uint8Array(SIZE * SIZE * 4);
tiles.forEach((data, i) => {
  const tx = (i % 16) * T, ty = Math.floor(i / 16) * T;
  for (let y = 0; y < T; y++) atlas.set(data.subarray(y * T * 4, (y + 1) * T * 4), ((ty + y) * SIZE + tx) * 4);
});

function crc32(buf) {
  let c, crc = ~0;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  Buffer.from(atlas.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr.set([8, 6, 0, 0, 0], 8);
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);

mkdirSync(join(GAME, "textures"), { recursive: true });
mkdirSync(join(GAME, "lib"), { recursive: true });
writeFileSync(join(GAME, "textures/blocks.png"), png);
const lua = ["-- Tile numbers in textures/blocks.png (made by scripts/blockfield/textures.mjs; do not edit).", "return {", ...Object.entries(names).map(([k, v]) => `  ${k} = ${v},`), "}", ""].join("\n");
writeFileSync(join(GAME, "lib/tiles.lua"), lua);
console.log(`${tiles.length} tiles, ${png.length} bytes`);
// the same picture as a sprite sheet of 16 x 16 frames, so that the UI can draw any tile by its number (`frame`)
writeFileSync(join(GAME, "textures/blocks.sprite.json"), JSON.stringify({ version: 1, image: "blocks.png", frame_width: T, frame_height: T }, null, 2) + "\n");
