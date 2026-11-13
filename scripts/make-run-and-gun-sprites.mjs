// Makes the placeholder player sheet for examples/run-and-gun: sprites/player.png and player.sprite.json (32 x 48 pixel frames, every pose facing right;
// the game turns them round). They are plain boxes of colour with an outline, to be repainted in the studio's sprite editor: each animation is a tag.
// Run:  scripts/env.sh node scripts/make-run-and-gun-sprites.mjs
import fs from "node:fs";
import zlib from "node:zlib";

const W = 32, H = 48;
const SKIN = [240, 200, 160], BAND = [190, 50, 50], SHIRT = [70, 110, 220], SHADE = [50, 85, 180], PANTS = [60, 60, 90], SHOE = [35, 35, 50], HAIR = [90, 60, 45], OUT = [28, 28, 44], WHITE = [225, 235, 255];

function frame(draw) {
  const px = new Uint8Array(W * H * 4);
  const set = (x, y, c) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
  };
  const rect = (x, y, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(x + i, y + j, c); };
  draw({ rect, set });
  // an outline: every empty pixel that touches a drawn one (not diagonally) becomes dark
  const solid = (x, y) => x >= 0 && y >= 0 && x < W && y < H && px[(y * W + x) * 4 + 3] > 0;
  const edge = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) edge.push([x, y]);
  for (const [x, y] of edge) set(x, y, OUT);
  return px;
}

// ---- the figure, front-facing right: legs, torso, head with a headband. dx moves a part sideways, up lifts a foot.
function person({ rect }, o = {}) {
  const bob = o.bob || 0, tdx = o.tdx || 0, hdx = o.hdx || 0, hy = o.hy || 0;
  const leg = (x, dx, up, h = 14) => {
    const top = 34 + bob + (up || 0);
    const len = h - bob - (up || 0);
    rect(x + dx, top, 5, len, PANTS);
    rect(x + dx, top + len - 3, 6, 3, SHOE);
  };
  leg(12, (o.l && o.l.dx) || 0, (o.l && o.l.up) || 0);
  leg(17, (o.r && o.r.dx) || 0, (o.r && o.r.up) || 0);
  rect(10 + tdx, 20 + bob, 12, 14, SHIRT);
  rect(10 + tdx, 30 + bob, 12, 4, SHADE);
  rect(12 + hdx, 10 + bob + hy, 9, 10, SKIN);
  rect(12 + hdx, 10 + bob + hy, 9, 3, BAND);
  rect(18 + hdx, 14 + bob + hy, 2, 2, OUT); // an eye
}
// seen from behind, for climbing
function backPerson({ rect }, o = {}) {
  const lu = o.lu || 0, ru = o.ru || 0; // how high each hand is held
  rect(12, 34 + (o.legL || 0), 5, 14 - (o.legL || 0), PANTS); rect(12, 45 + (o.legL || 0) * 0, 5, 3, SHOE);
  rect(17, 34 + (o.legR || 0), 5, 14 - (o.legR || 0), PANTS); rect(17, 45, 5, 3, SHOE);
  rect(10, 20, 12, 14, SHIRT); rect(10, 30, 12, 4, SHADE);
  rect(8, 14 - lu, 3, 9, SKIN); rect(21, 14 - ru, 3, 9, SKIN); // arms up, hands on the rungs
  rect(12, 10, 9, 10, HAIR); rect(12, 10, 9, 3, BAND);
}

const poses = [];
const add = (name, draw, ms = 100) => poses.push({ name, ms, px: frame(draw) });
add("idle", (g) => person(g, { bob: 0 }), 400);
add("idle", (g) => person(g, { bob: 1 }), 400);
add("run", (g) => person(g, { bob: 1, l: { dx: 3 }, r: { dx: -3, up: 3 } }), 90);
add("run", (g) => person(g, { bob: 0, l: { dx: 0, up: 3 }, r: { dx: 0 } }), 90);
add("run", (g) => person(g, { bob: 1, l: { dx: -3, up: 3 }, r: { dx: 3 } }), 90);
add("run", (g) => person(g, { bob: 0, l: { dx: 0 }, r: { dx: 0, up: 3 } }), 90);
add("jump", (g) => person(g, { l: { dx: 2, up: 5 }, r: { dx: -2 } }));
add("fall", (g) => person(g, { bob: 0, l: { dx: 3 }, r: { dx: -3 }, hy: -1 }));
// the double jump: the legs pump once in the air (three frames, played once): knees up, kicked out, then the ordinary jump pose
add("double_jump", (g) => person(g, { hy: 1, l: { dx: 2, up: 7 }, r: { dx: -2, up: 7 } }), 70);
add("double_jump", (g) => person(g, { hy: 0, l: { dx: 4, up: 3 }, r: { dx: -4, up: 3 } }), 70);
add("double_jump", (g) => person(g, { hy: -1, l: { dx: 3 }, r: { dx: -3, up: 4 } }), 70);
// on a wall (the wall is on the right): a hand up on it, one leg bent
add("wall_slide", (g) => { person(g, { tdx: 3, hdx: 3, l: { dx: 3 }, r: { dx: 1, up: 4 } }); g.rect(25, 14, 3, 10, SKIN); });
// leaving a wall (pushing off to the left)
add("wall_jump", (g) => person(g, { tdx: -2, hdx: -2, hy: -1, l: { dx: -3, up: 6 }, r: { dx: 3 } }));
add("climb", (g) => backPerson(g, { lu: 4, ru: 0, legL: 3 }), 130);
add("climb", (g) => backPerson(g, { lu: 0, ru: 4, legR: 3 }), 130);
// lying down
add("prone", ({ rect }) => {
  rect(2, 43, 9, 5, PANTS); rect(0, 45, 4, 3, SHOE);
  rect(11, 41, 12, 7, SHIRT); rect(11, 45, 12, 3, SHADE);
  rect(23, 41, 8, 7, SKIN); rect(23, 41, 8, 3, BAND); rect(28, 44, 2, 2, OUT);
});
add("dash", (g) => { person(g, { tdx: 3, hdx: 4, bob: 2, l: { dx: -5, up: 3 }, r: { dx: 4 } }); for (const y of [22, 28, 34]) g.rect(0, y, 7, 1, WHITE); });
add("hurt", (g) => { person(g, { tdx: -3, hdx: -4, hy: 1, l: { dx: -3 }, r: { dx: 4, up: 3 } }); g.rect(5, 18, 3, 7, SKIN); g.rect(25, 16, 3, 7, SKIN); });

// the melee: the arm is drawn here (the gun is put away): drawn back, thrown forward, then held out; the swish itself is drawn by the game
add("melee", (g) => { person(g, { tdx: -1, hdx: -1, l: { dx: -2 }, r: { dx: 2 } }); g.rect(4, 24, 7, 4, SKIN); g.rect(3, 23, 3, 6, SKIN); }, 60);
add("melee", (g) => { person(g, { tdx: 2, hdx: 2, bob: 1, l: { dx: -3 }, r: { dx: 4 } }); g.rect(19, 23, 12, 4, SKIN); g.rect(28, 21, 4, 7, SKIN); }, 70);
add("melee", (g) => { person(g, { tdx: 1, hdx: 1, l: { dx: -2 }, r: { dx: 3 } }); g.rect(19, 26, 9, 4, SKIN); g.rect(26, 25, 4, 6, SKIN); }, 90);

// ---- the sheet: 6 frames across
const COLS = 6, ROWS = Math.ceil(poses.length / COLS);
const sheet = new Uint8Array(COLS * W * ROWS * H * 4);
poses.forEach((p, n) => {
  const cx = (n % COLS) * W, cy = Math.floor(n / COLS) * H;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = (y * W + x) * 4, d = ((cy + y) * COLS * W + cx + x) * 4;
    for (let k = 0; k < 4; k++) sheet[d + k] = p.px[s + k];
  }
});

// ---- a PNG, written by hand
const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, "latin1"); Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const dir = "examples/run-and-gun/sprites/";
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(dir + "player.png", png(COLS * W, ROWS * H, sheet));
const tags = [];
poses.forEach((p, i) => {
  const last = tags[tags.length - 1];
  if (last && last.name === p.name) last.to = i; else tags.push({ name: p.name, from: i, to: i });
});
for (const t of tags) if (t.name === "double_jump") t.loop = false;
fs.writeFileSync(dir + "player.sprite.json", JSON.stringify({ version: 1, image: "player.png", frame_width: W, frame_height: H, columns: COLS, frames: poses.length, durations_ms: poses.map((p) => p.ms), tags, pivot: { x: 16, y: 48 } }, null, 2) + "\n");

// a bigger picture to look at (not part of the game)
if (process.argv[2]) {
  const S = 3, bw = COLS * W * S, bh = ROWS * H * S, big = new Uint8Array(bw * bh * 4);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const s = (Math.floor(y / S) * COLS * W + Math.floor(x / S)) * 4, d = (y * bw + x) * 4;
    const a = sheet[s + 3] / 255, bg = ((Math.floor(x / 24) + Math.floor(y / 24)) % 2) ? 170 : 150;
    for (let k = 0; k < 3; k++) big[d + k] = Math.round(sheet[s + k] * a + bg * (1 - a));
    big[d + 3] = 255;
  }
  fs.writeFileSync(process.argv[2], png(bw, bh, big));
}
console.log(`${poses.length} frames, tags: ${tags.map((t) => `${t.name} ${t.from}-${t.to}`).join(", ")}`);
