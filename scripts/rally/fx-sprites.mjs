// Soft particle pictures for Pine Ridge Rally, made by code (nothing copied from anywhere): white with a soft alpha, so the game tints them.
//   sprites/fx/puff.png    one lumpy cloud, 64 x 64
//   sprites/fx/dust.png    four different clouds in a row (a sheet: dust.sprite.json), 4 x 64 x 64
//   sprites/fx/flake.png   a small round soft dot, 16 x 16
// Run: node scripts/rally/fx-sprites.mjs
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const out = new URL("../../examples/pine-ridge-rally/sprites/fx/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(w, h, rgba) {
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// a fixed pseudo-random sequence, so that the files come out the same every time
function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

// a cloud: several soft discs around the middle, summed, then shaped so the edge fades to nothing well inside the picture
function cloud(size, seed, lumps) {
  const r = rng(seed);
  const blobs = [];
  for (let i = 0; i < lumps; i++) {
    const a = r() * Math.PI * 2, d = r() * 0.26;
    blobs.push({ x: 0.5 + Math.cos(a) * d, y: 0.5 + Math.sin(a) * d, r: 0.16 + r() * 0.12 });
  }
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + 0.5) / size, v = (y + 0.5) / size;
    let a = 0;
    for (const b of blobs) { const d = Math.hypot(u - b.x, v - b.y) / b.r; a += smooth(1 - d) ** 1.5; }
    a = smooth(a * 0.6) * 0.8;
    const i = (y * size + x) * 4;
    px[i] = px[i + 1] = px[i + 2] = 255; px[i + 3] = Math.round(a * 255);
  }
  return px;
}

writeFileSync(out + "puff.png", png(64, 64, cloud(64, 7, 7)));

const sheet = Buffer.alloc(256 * 64 * 4);
for (let f = 0; f < 4; f++) {
  const frame = cloud(64, 31 + f * 17, 6 + f);
  for (let y = 0; y < 64; y++) frame.copy(sheet, (y * 256 + f * 64) * 4, y * 64 * 4, (y + 1) * 64 * 4);
}
writeFileSync(out + "dust.png", png(256, 64, sheet));
writeFileSync(out + "dust.sprite.json", JSON.stringify({ version: 1, image: "dust.png", frame_width: 64, frame_height: 64, columns: 4, frames: 4, frame_duration_ms: 120 }, null, 2) + "\n");

const dot = Buffer.alloc(16 * 16 * 4);
for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
  const d = Math.hypot((x + 0.5) / 16 - 0.5, (y + 0.5) / 16 - 0.5) * 2;
  const i = (y * 16 + x) * 4;
  dot[i] = dot[i + 1] = dot[i + 2] = 255; dot[i + 3] = Math.round(smooth(1 - d) * 255);
}
writeFileSync(out + "flake.png", png(16, 16, dot));
console.log("wrote", out);
