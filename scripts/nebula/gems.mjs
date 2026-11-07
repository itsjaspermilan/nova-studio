// Nebula Swap's blocks, drawn here (sprites/gem_1..6.png, gem_N_flash.png, garbage.png, cursor.png, ring.png): six coloured tiles, each with its own
// shape (hexagon, star, orb, diamond, up triangle, down triangle: the colour and the shape both say which block it is), bevelled and shaded,
// supersampled so that the edges are smooth. The Kenney art is the rest of the game (scripts/nebula/assets.sh).
//   node scripts/nebula/gems.mjs [project folder]
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const project = process.argv[2] ?? "examples/nebula-swap";
const out = path.join(project, "sprites");
fs.mkdirSync(out, { recursive: true });

function png(file, w, h, px) {
  const crc = (buf) => { let c, t = png.t ??= Array.from({ length: 256 }, (_, n) => { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; }); let v = 0xffffffff; for (const b of buf) v = t[(v ^ b) & 255] ^ (v >>> 8); return (v ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4); data.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + data.length)), 8 + data.length); return b; };
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(px.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]));
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const N = 64, SS = 4;

// shapes: inside(x, y) in a -1..1 box around the middle of the tile
const SHAPES = [
  (x, y) => { const a = Math.abs(x), b = Math.abs(y); return b <= 0.86 && a * 0.5 + b * 0.866 <= 0.866 * 0.98 && a <= 0.98; }, // hexagon (flat top)
  (x, y) => { // five-point star: inside the polygon of ten points (outer 1.0, inner 0.46)
    const pts = [];
    for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.46 : 1.0, an = -Math.PI / 2 + (i * Math.PI) / 5; pts.push([Math.cos(an) * r, Math.sin(an) * r + 0.06]); }
    let inside = false;
    for (let i = 0, j = 9; i < 10; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside; }
    return inside;
  },
  (x, y) => Math.hypot(x, y) <= 0.92, // orb
  (x, y) => Math.abs(x) + Math.abs(y) <= 1.0, // diamond
  (x, y) => y >= -0.9 && y <= 0.8 && Math.abs(x) <= (y + 0.9) * 0.62 + 0.0, // up triangle
  (x, y) => y >= -0.8 && y <= 0.9 && Math.abs(x) <= (0.9 - y) * 0.62, // down triangle
];
const COLOURS = [[232, 64, 76], [250, 204, 40], [66, 206, 104], [84, 214, 232], [168, 96, 236], [60, 92, 226]];

function tile(k, flash) {
  const base = COLOURS[k], light = mix(base, [255, 255, 255], 0.55), dark = mix(base, [0, 0, 20], 0.45);
  const px = new Uint8Array(N * N * 4);
  const R = 13, inset = 2;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let cov = 0, r = 0, g = 0, b = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const fx = x + (sx + 0.5) / SS, fy = y + (sy + 0.5) / SS;
      // rounded square mask
      const cx = Math.min(Math.max(fx, inset + R), N - inset - R), cy = Math.min(Math.max(fy, inset + R), N - inset - R);
      const d = Math.hypot(fx - cx, fy - cy);
      if (d > R || fx < inset || fx > N - inset || fy < inset || fy > N - inset) continue;
      const t = (fy - inset) / (N - 2 * inset);
      let c = mix(light.map((v, i) => v * 0.35 + base[i] * 0.65), dark.map((v, i) => v * 0.4 + base[i] * 0.6), t * 0.9);
      // bevel: a bright rim on the top left, a dark one on the bottom right
      const edge = R - d, rim = Math.min(fx - inset, fy - inset, N - inset - fx, N - inset - fy);
      const e = Math.min(edge < 6 ? edge : 99, rim < 6 ? rim : 99);
      if (e < 4) c = mix(c, (fx + fy < N) ? [255, 255, 255] : [0, 0, 30], (4 - e) / 4 * 0.45);
      // the shape: lighter, with a soft shadow below it
      const gx = (fx - N / 2) / 22, gy = (fy - N / 2) / 22;
      const sh = SHAPES[k](gx, gy), sh2 = SHAPES[k](gx - 0.07, gy - 0.1);
      if (sh2 && !sh) c = mix(c, [0, 0, 30], 0.32);
      if (sh) { const gt = (gy + 1) / 2; c = mix(mix([255, 255, 255], light, 0.35), mix(light, base, 0.35), gt); if (SHAPES[k](gx * 1.18, gy * 1.18) === false) c = mix(c, [255, 255, 255], 0.0); }
      if (flash) c = mix(c, [255, 255, 255], 0.8);
      r += c[0]; g += c[1]; b += c[2]; cov++;
    }
    const i = (y * N + x) * 4, n = SS * SS;
    if (cov) { px[i] = r / cov; px[i + 1] = g / cov; px[i + 2] = b / cov; px[i + 3] = (cov / n) * 255; }
  }
  return px;
}
for (let k = 0; k < 6; k++) { png(path.join(out, `gem_${k + 1}.png`), N, N, tile(k, false)); png(path.join(out, `gem_${k + 1}_flash.png`), N, N, tile(k, true)); }

// garbage: a steel plate with rivets
{
  const px = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const t = y / N, edge = Math.min(x, y, N - 1 - x, N - 1 - y);
    let c = mix([112, 126, 150], [70, 82, 104], t);
    if (edge < 3) c = mix(c, (x + y < N) ? [190, 204, 226] : [34, 42, 60], 0.7);
    for (const [rx, ry] of [[11, 11], [N - 12, 11], [11, N - 12], [N - 12, N - 12]]) {
      const d = Math.hypot(x - rx, y - ry);
      if (d < 4) c = mix(c, [210, 220, 236], 0.8 - d * 0.12);
    }
    // a faint diagonal hazard stripe
    if (((x + y) % 24) < 6 && edge > 6) c = mix(c, [40, 48, 70], 0.25);
    const i = (y * N + x) * 4; px.set([c[0], c[1], c[2], 255], i);
  }
  png(path.join(out, "garbage.png"), N, N, px);
}

// the cursor: two cells wide (136 x 72), four corner brackets with a soft glow
{
  const W = 136, H = 72, px = new Uint8Array(W * H * 4);
  const seg = (x, y, x1, y1, x2, y2) => { // the distance from a point to a segment
    const dx = x2 - x1, dy = y2 - y1, t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - (x1 + dx * t), y - (y1 + dy * t));
  };
  const bracket = (x, y) => { // the distance to the nearest bracket stroke (an L at each corner, 24 long)
    let best = 99;
    for (const [cx, cy, sx, sy] of [[5, 5, 1, 1], [W - 5, 5, -1, 1], [5, H - 5, 1, -1], [W - 5, H - 5, -1, -1]]) {
      best = Math.min(best, seg(x, y, cx, cy, cx + 24 * sx, cy), seg(x, y, cx, cy, cx, cy + 24 * sy));
    }
    return best;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = bracket(x + 0.5, y + 0.5);
    let a = d < 2.2 ? 1 : d < 3.2 ? 1 - (d - 2.2) : 0;
    const glow = Math.max(0, 1 - d / 9) * 0.45;
    const i = (y * W + x) * 4;
    const col = a > 0 ? [255, 255, 255] : [255, 220, 90];
    px.set([col[0], col[1], col[2], Math.min(255, (a + glow * (1 - a)) * 255)], i);
  }
  png(path.join(out, "cursor.png"), W, H, px);
}
// a ring (for the pop and the chain flash)
{
  const S = 128, px = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2), a = Math.max(0, 1 - Math.abs(d - 54) / 5);
    px.set([255, 255, 255, a * 255], (y * S + x) * 4);
  }
  png(path.join(out, "ring.png"), S, S, px);
}
console.log("wrote the gems into", out);
