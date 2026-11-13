// Builds the Kenney art of examples/run-and-gun from Kenney's "Game Assets All-in-1" bundle (CC0: free to use, credit is not needed but is kept in licenses/):
//   sprites/player.png + player.sprite.json   the hero: one animation (tag) for each thing the player does, cut from "Platformer Characters 1"
//   sprites/soldier.* and sprites/zombie.*    the enemy gunner and the enemy rusher, the same way
//   sprites/tiles/*.png                       ground, rock, ledge and ladder pieces from "Platformer Pack Industrial"
//   lib/kenney_frames.lua                     which frame of each sheet is which pose (for the enemies, which are drawn by pose and not by tag)
// Run:  scripts/env.sh node scripts/make-run-and-gun-kenney.mjs [--kenney "<folder>"] [--hero Player|Adventurer|Female]
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import os from "node:os";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const KENNEY = opt("--kenney", path.join(os.homedir(), "Developer", "Kenney Game Assets All-in-1 3.8.0"));
const HERO = opt("--hero", "Player");
const CHARS = path.join(KENNEY, "2D assets", "Platformer Characters 1", "PNG");
const INDUSTRIAL = path.join(KENNEY, "2D assets", "Platformer Pack Industrial", "Tilesheet", "platformerPack_industrial_tilesheet.png");
const OUT = "examples/run-and-gun/";

// ---- PNG in and out (8-bit, colour types 3 palette and 6 RGBA, and 2 RGB) ------------------------------------------------------------------------------
function decode(file) {
  const b = fs.readFileSync(file);
  let w = 0, h = 0, type = 6, palette = null, trns = null;
  const idat = [];
  for (let p = 8; p + 8 <= b.length; ) {
    const len = b.readUInt32BE(p), kind = b.toString("latin1", p + 4, p + 8), body = b.subarray(p + 8, p + 8 + len);
    if (kind === "IHDR") { w = body.readUInt32BE(0); h = body.readUInt32BE(4); type = body[9]; if (body[8] !== 8 || body[12]) throw new Error(file + ": only 8-bit, not interlaced"); }
    else if (kind === "PLTE") palette = body; else if (kind === "tRNS") trns = body; else if (kind === "IDAT") idat.push(body);
    p += 12 + len;
  }
  const ch = { 6: 4, 2: 3, 3: 1 }[type];
  if (!ch) throw new Error(file + ": colour type " + type);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch, out = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const c = raw[y * (stride + 1) + 1 + x];
      const a = x >= ch ? out[y * stride + x - ch] : 0, up = y ? out[(y - 1) * stride + x] : 0, ul = x >= ch && y ? out[(y - 1) * stride + x - ch] : 0;
      const pa = Math.abs(up - ul), pb = Math.abs(a - ul), pc = Math.abs(a + up - 2 * ul);
      out[y * stride + x] = (c + (f === 0 ? 0 : f === 1 ? a : f === 2 ? up : f === 3 ? (a + up) >> 1 : (pa <= pb && pa <= pc ? a : pb <= pc ? up : ul))) & 255;
    }
  }
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (type === 3) { const k = out[i]; rgba[i * 4] = palette[k * 3]; rgba[i * 4 + 1] = palette[k * 3 + 1]; rgba[i * 4 + 2] = palette[k * 3 + 2]; rgba[i * 4 + 3] = trns && k < trns.length ? trns[k] : 255; }
    else if (type === 2) { rgba.set(out.subarray(i * 3, i * 3 + 3), i * 4); rgba[i * 4 + 3] = 255; }
    else rgba.set(out.subarray(i * 4, i * 4 + 4), i * 4);
  }
  return { w, h, data: rgba };
}
const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const o = Buffer.alloc(12 + data.length); o.writeUInt32BE(data.length, 0); o.write(type, 4, "latin1"); Buffer.from(data).copy(o, 8); o.writeUInt32BE(crc(o.subarray(4, 8 + data.length)), 8 + data.length); return o; };
function encode(img) {
  const raw = Buffer.alloc((img.w * 4 + 1) * img.h);
  for (let y = 0; y < img.h; y++) Buffer.from(img.data.buffer, img.data.byteOffset + y * img.w * 4, img.w * 4).copy(raw, y * (img.w * 4 + 1) + 1);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(img.w, 0); ihdr.writeUInt32BE(img.h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const blit = (dst, src, dx, dy, sx = 0, sy = 0, sw = src.w, sh = src.h) => {
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const X = dx + x, Y = dy + y;
    if (X < 0 || Y < 0 || X >= dst.w || Y >= dst.h) continue;
    const s = ((sy + y) * src.w + sx + x) * 4, d = (Y * dst.w + X) * 4;
    for (let k = 0; k < 4; k++) dst.data[d + k] = src.data[s + k];
  }
};
const blank = (w, h) => ({ w, h, data: new Uint8Array(w * h * 4) });

// ---- the character sheets: each frame is one of the 24 poses (80 x 110) ---------------------------------------------------------------------------------
const FW = 80, FH = 110, COLS = 6;
const POSES = ["action1", "action2", "back", "cheer1", "cheer2", "climb1", "climb2", "duck", "fall", "hang", "hold1", "hold2", "hurt", "idle", "jump", "kick", "skid", "slide", "stand", "swim1", "swim2", "talk", "walk1", "walk2"];
// each animation: [pose, milliseconds] frames, and whether it loops
const LOOK = {
  player: { dir: HERO.toLowerCase(), tags: {
    idle: [["stand", 500], ["idle", 500]],
    run: [["walk1", 120], ["walk2", 120]],
    jump: [["jump", 100]],
    fall: [["fall", 100]],
    double_jump: [["action1", 70], ["jump", 70], ["jump", 70]],
    wall_slide: [["hang", 100]],
    wall_jump: [["kick", 100]],
    climb: [["climb1", 130], ["climb2", 130]],
    prone: [["duck", 100]],
    dash: [["slide", 100]],
    hurt: [["hurt", 100]],
    melee: [["hold1", 60], ["action1", 70], ["action2", 90]],
  } },
  soldier: { dir: "soldier", tags: { idle: [["stand", 500], ["idle", 500]], walk: [["walk1", 160], ["walk2", 160]], jump: [["jump", 100]], hurt: [["hurt", 100]], aim: [["hold1", 100]], shoot: [["hold2", 100]], duck: [["duck", 100]] } },
  zombie: { dir: "zombie", tags: { idle: [["stand", 500], ["idle", 500]], walk: [["walk1", 160], ["walk2", 160]], windup: [["action1", 100]], lunge: [["action2", 100]], hurt: [["hurt", 100]], jump: [["jump", 100]] } },
};
const frameIndex = {};
for (const [name, look] of Object.entries(LOOK)) {
  const frames = []; // [pose, ms, tag]
  for (const [tag, list] of Object.entries(look.tags)) for (const [pose, ms] of list) frames.push({ pose, ms, tag });
  const rows = Math.ceil(frames.length / COLS);
  const sheet = blank(COLS * FW, rows * FH);
  frames.forEach((f, i) => blit(sheet, decode(path.join(CHARS, look.dir[0].toUpperCase() + look.dir.slice(1), "Poses", `${look.dir}_${f.pose}.png`)), (i % COLS) * FW, Math.floor(i / COLS) * FH));
  fs.writeFileSync(`${OUT}sprites/${name}.png`, encode(sheet));
  const tags = [];
  frames.forEach((f, i) => { const last = tags[tags.length - 1]; if (last && last.name === f.tag) last.to = i; else tags.push({ name: f.tag, from: i, to: i }); });
  if (look.tags.double_jump) for (const t of tags) if (t.name === "double_jump") t.loop = false;
  fs.writeFileSync(`${OUT}sprites/${name}.sprite.json`, JSON.stringify({ version: 1, image: `${name}.png`, frame_width: FW, frame_height: FH, columns: COLS, frames: frames.length, durations_ms: frames.map((f) => f.ms), tags, pivot: { x: 40, y: 110 } }, null, 2) + "\n");
  frameIndex[name] = Object.fromEntries(frames.map((f, i) => [f.tag + (frames.filter((g) => g.tag === f.tag).indexOf(f) ? frames.filter((g) => g.tag === f.tag).indexOf(f) + 1 : ""), i]));
  console.log(`${name}: ${frames.length} frames (${Object.keys(look.tags).join(", ")})`);
}
fs.writeFileSync(`${OUT}lib/kenney_frames.lua`, `-- The frame of each sheet in sprites/ that is a pose, by name: where an animation is two frames, the second is the name and a 2 (walk, walk2).\n-- Made by scripts/make-run-and-gun-kenney.mjs. The player is drawn by animation tag (entities/player.lua); the enemies by these.\nreturn {\n${Object.entries(frameIndex).map(([n, m]) => `  ${n} = { ${Object.entries(m).map(([k, v]) => `${k} = ${v}`).join(", ")} },`).join("\n")}\n}\n`);

// ---- tiles cut from the industrial tilesheet (70 px a tile, 14 across): [name, column, row, columns wide, rows tall, or a pixel box] -----------------------------------------------
const sheet = decode(INDUSTRIAL);
const TILES = [
  ["ground_top", 2, 0], ["ground_fill", 4, 1], ["panel", 0, 2], ["panel_dark", 2, 2], ["ladder", 4, 2], ["hazard", 6, 4],
];
fs.mkdirSync(`${OUT}sprites/tiles`, { recursive: true });
for (const [name, c, r] of TILES) {
  const img = blank(70, 70);
  blit(img, sheet, 0, 0, c * 70, r * 70, 70, 70);
  fs.writeFileSync(`${OUT}sprites/tiles/${name}.png`, encode(img));
}
// the thin girder strip (a ledge): the dark strip at the top of row 2, columns 6 to 8 (210 x 30)
{
  const img = blank(210, 30);
  blit(img, sheet, 0, 0, 6 * 70, 2 * 70, 210, 30);
  fs.writeFileSync(`${OUT}sprites/tiles/ledge.png`, encode(img));
}
console.log(`tiles: ${TILES.map((t) => t[0]).join(", ")}, ledge`);
