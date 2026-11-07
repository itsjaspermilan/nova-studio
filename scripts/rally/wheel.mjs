// The wheel on Pine Ridge Rally's transition screens (sprites/ui/wheel.png): a tyre with tread notches, a rim, five spokes and a hub, in one
// flat cream colour on transparent, so that the screen's colour shows through it (the two-colour look of the transition screens).
//   node scripts/rally/wheel.mjs [project folder]
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const project = process.argv[2] ?? "examples/pine-ridge-rally";
const N = 256, C = N / 2, SS = 4;
const px = new Uint8Array(N * N * 4);
const inside = (x, y) => {
  const dx = x - C, dy = y - C;
  const r = Math.hypot(dx, dy);
  const a = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
  // the tyre: a ring with notches cut in its outer edge, 24 of them
  if (r >= 94 && r <= 124) {
    const notch = Math.abs(((a / (Math.PI * 2)) * 24) % 1 - 0.5) < 0.2;
    return !(notch && r > 112);
  }
  // the rim, a thinner ring inside a gap
  if (r >= 70 && r <= 82) return true;
  // five spokes and the hub
  if (r < 70) {
    if (r < 12) return false; // the bolt hole
    if (r <= 28) return true;
    for (let k = 0; k < 5; k++) {
      const sa = (k / 5) * Math.PI * 2 + Math.PI / 2;
      const along = dx * Math.cos(sa) + dy * Math.sin(sa), across = Math.abs(-dx * Math.sin(sa) + dy * Math.cos(sa));
      if (along > 0 && across < 11 - along * 0.07) return true;
    }
  }
  return false;
};
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  let hit = 0;
  for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) if (inside(x + (i + 0.5) / SS, y + (j + 0.5) / SS)) hit++;
  const o = (y * N + x) * 4;
  px.set([250, 244, 226, Math.round((hit / (SS * SS)) * 255)], o);
}
// PNG: signature, IHDR, IDAT, IEND
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
const raw = Buffer.alloc((N * 4 + 1) * N);
for (let y = 0; y < N; y++) { raw[y * (N * 4 + 1)] = 0; Buffer.from(px.buffer, y * N * 4, N * 4).copy(raw, y * (N * 4 + 1) + 1); }
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
fs.writeFileSync(path.join(project, "sprites", "ui", "wheel.png"), png);
console.log("wrote sprites/ui/wheel.png");
