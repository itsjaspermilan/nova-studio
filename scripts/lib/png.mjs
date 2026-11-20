// A tiny PNG reader and writer (8-bit RGB, not interlaced; what `sips -s format png` makes) for tracing blueprints: `load(file)` gives `dark(x, y)`,
// `writePNG` saves a picture. No dependencies (node's zlib only).
import fs from "node:fs";
import zlib from "node:zlib";

export function loadRGB(file) {
  const b = fs.readFileSync(file);
  let p = 8, W = 0, H = 0;
  const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p), type = b.toString("ascii", p + 4, p + 8), data = b.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { W = data.readUInt32BE(0); H = data.readUInt32BE(4); }
    if (type === "IDAT") idat.push(data);
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = W * 3, px = Buffer.alloc(H * stride);
  for (let y = 0; y < H; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= 3 ? px[y * stride + i - 3] : 0, up = y ? px[(y - 1) * stride + i] : 0, c = i >= 3 && y ? px[(y - 1) * stride + i - 3] : 0;
      let v = row[i];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const pa = Math.abs(up - c), pb = Math.abs(a - c), pc = Math.abs(a + up - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      px[y * stride + i] = v & 255;
    }
  }
  return { W, H, px, dark: (x, y) => x >= 0 && y >= 0 && x < W && y < H && (px[(y * W + x) * 3] + px[(y * W + x) * 3 + 1] + px[(y * W + x) * 3 + 2]) / 3 < 110 };
}

export function writePNG(file, W, H, px) {
  const stride = W * 3, raw = Buffer.alloc(H * (stride + 1));
  for (let y = 0; y < H; y++) px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}
