// Compares two renders of the same grid of models (scripts/moving-day/check-models.sh): for each model, the share of the pixels around it that differ
// by more than a little, and a side-by-side picture (build/moving-day-check/side.png) to look at.
//   node compare.mjs kit.png saved.png <columns> <count> <names...>
import fs from "node:fs";
import zlib from "node:zlib";
function readPng(file) {
  const b = fs.readFileSync(file);
  let o = 8, w, h, type, idat = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o), t = b.toString("ascii", o + 4, o + 8), d = b.subarray(o + 8, o + 8 + len);
    if (t === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); type = d[9]; }
    if (t === "IDAT") idat.push(d);
    o += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, out = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= bpp ? out[y * stride + x - bpp] : 0, up = y > 0 ? out[(y - 1) * stride + x] : 0, c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let p = 0;
      if (f === 1) p = a; else if (f === 2) p = up; else if (f === 3) p = (a + up) >> 1;
      else if (f === 4) { const q = a + up - c, pa = Math.abs(q - a), pb = Math.abs(q - up), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      out[y * stride + x] = (v + p) & 255;
    }
  }
  return { w, h, bpp, px: out };
}
const [ka, sa, cols, count, ...names] = process.argv.slice(2);
const A = readPng(ka), S = readPng(sa);
// the whole picture is split into a grid of regions by where the models stand; simpler: count differing pixels over the whole picture, and per
// vertical band of the picture (the grid is drawn in perspective, so per model is approximate: each model's differences are reported by nearest cell)
let total = 0, differ = 0;
for (let i = 0; i < A.w * A.h; i++) {
  let d = 0;
  for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(A.px[i * A.bpp + c] - S.px[i * S.bpp + c]));
  const bg = A.px[i * A.bpp] < 60 && A.px[i * A.bpp + 2] < 60 && S.px[i * S.bpp] < 60 && S.px[i * S.bpp + 2] < 60;
  if (!bg) total++;
  if (d > 24) differ++;
}
console.log(`${names.length} models: ${differ} of ${total} model pixels differ (${(100 * differ / Math.max(1, total)).toFixed(2)}%)`);
// per model: the cells of a near-orthographic grid (the camera is far away with a narrow lens), split evenly between the first and last model
const C = Number(cols), R = Math.ceil(Number(count) / C);
let x0 = A.w, y0 = A.h, x1 = 0, y1 = 0;
for (let y = 0; y < A.h; y++) for (let x = 0; x < A.w; x++) {
  const i = y * A.w + x;
  if (!(A.px[i * A.bpp] < 60 && A.px[i * A.bpp + 2] < 60)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
}
const cw = (x1 - x0 + 1) / C, ch = (y1 - y0 + 1) / R;
const bad = [];
names.forEach((name, n) => {
  const cx = n % C, cy = Math.floor(n / C);
  let t = 0, d = 0;
  for (let y = Math.floor(y0 + cy * ch); y < Math.floor(y0 + (cy + 1) * ch); y++) for (let x = Math.floor(x0 + cx * cw); x < Math.floor(x0 + (cx + 1) * cw); x++) {
    const i = y * A.w + x;
    let m = 0;
    for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(A.px[i * A.bpp + c] - S.px[i * S.bpp + c]));
    const bg = A.px[i * A.bpp] < 60 && A.px[i * A.bpp + 2] < 60 && S.px[i * S.bpp] < 60 && S.px[i * S.bpp + 2] < 60;
    if (!bg) t++;
    if (m > 24) d++;
  }
  const pct = 100 * d / Math.max(1, t);
  console.log(`${name.padEnd(22)} ${pct.toFixed(2)}%`);
  if (pct > 1) bad.push(name);
});
console.log(bad.length ? `differ by more than 1%: ${bad.join(" ")}` : "every model matches the kit's within 1%");
