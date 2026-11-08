// Moving Day's interface pictures, drawn at twice the size they are shown (the Retroid's screen is 1080 pixels high, the game's units 540), with
// smooth edges: panels (cream card, kraft cardboard, deep teal), buttons, the wish card's rows, stars, ticks, the pointer, tape, a padlock, the wish
// signs (an eye, a heart, a pin, an arrow to a wall), soft particles for the 3D world, and the furniture icons and clients' faces cut out of renders of
// the game's own models (scripts/moving-day/icons/, rendered over black and over white). Run by scripts/moving-day/hd-ui.sh. No Kenney picture is used.
//   node hd-ui.mjs <sprites/ui> <build/moving-day-icons>
import fs from 'fs';
import zlib from 'zlib';

const OUT = process.argv[2];
const ICONS = process.argv[3];

// ---- PNG in and out ------------------------------------------------------------------------------------------------------------------
const CRC = [];
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; }
const crc = (b) => { let c = ~0; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (~c) >>> 0; };
function chunk(t, d) {
  const l = Buffer.alloc(4); l.writeUInt32BE(d.length);
  const td = Buffer.concat([Buffer.from(t), d]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([l, td, c]);
}
function writePng(file, img) {
  const { w, h, px } = img;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w * 4; x++) raw[y * (w * 4 + 1) + 1 + x] = Math.max(0, Math.min(255, Math.round(px[y * w * 4 + x])));
  }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}
function readPng(file) {
  const b = fs.readFileSync(file);
  let o = 8, w, h, type, idat = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o), t = b.toString('ascii', o + 4, o + 8), d = b.subarray(o + 8, o + 8 + len);
    if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); type = d[9]; if (d[8] !== 8) throw new Error('8-bit PNGs only'); }
    if (t === 'IDAT') idat.push(d);
    o += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp, out = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= bpp ? out[y * stride + x - bpp] : 0, up = y > 0 ? out[(y - 1) * stride + x] : 0, c = (x >= bpp && y > 0) ? out[(y - 1) * stride + x - bpp] : 0;
      let p = 0;
      if (f === 1) p = a; else if (f === 2) p = up; else if (f === 3) p = (a + up) >> 1;
      else if (f === 4) { const q = a + up - c, pa = Math.abs(q - a), pb = Math.abs(q - up), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : (pb <= pc ? up : c); }
      out[y * stride + x] = (v + p) & 255;
    }
  }
  const px = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { for (let c = 0; c < 3; c++) px[i * 4 + c] = out[i * bpp + c]; px[i * 4 + 3] = bpp === 4 ? out[i * bpp + 3] : 255; }
  return { w, h, px };
}

// ---- drawing with distances: each layer is a shape (signed distance in pixels, < 0 inside) and a colour -----------------------------
const img = (w, h) => ({ w, h, px: new Float32Array(w * h * 4) });
const cov = (d) => Math.max(0, Math.min(1, 0.5 - d));
// paints colour (r, g, b, a) or a function of (x, y) over the picture where the shape is, with smooth edges (over operator, straight alpha)
function paint(im, shape, color) {
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) {
    const k = cov(shape(x + 0.5, y + 0.5));
    if (k <= 0) continue;
    const c = typeof color === 'function' ? color(x + 0.5, y + 0.5) : color;
    const sa = (c[3] ?? 255) / 255 * k, i = (y * im.w + x) * 4, da = im.px[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    for (let j = 0; j < 3; j++) im.px[i + j] = oa > 0 ? (c[j] * sa + im.px[i + j] * da * (1 - sa)) / oa : 0;
    im.px[i + 3] = oa * 255;
  }
}
const circle = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r;
function rrect(x0, y0, x1, y1, r) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hw = (x1 - x0) / 2 - r, hh = (y1 - y0) / 2 - r;
  return (x, y) => { const qx = Math.abs(x - cx) - hw, qy = Math.abs(y - cy) - hh; return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r; };
}
const inset = (s, d) => (x, y) => s(x, y) + d;
const union = (a, b) => (x, y) => Math.min(a(x, y), b(x, y));
const cut = (a, b) => (x, y) => Math.max(a(x, y), -b(x, y));
const and = (a, b) => (x, y) => Math.max(a(x, y), b(x, y));
function polygon(pts) {
  return (x, y) => {
    let d = Infinity, s = 1;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [ax, ay] = pts[j], [bx, by] = pts[i];
      const ex = bx - ax, ey = by - ay, wx = x - ax, wy = y - ay;
      const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
      d = Math.min(d, Math.hypot(wx - ex * t, wy - ey * t));
      if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) s = -s;
    }
    return s * d;
  };
}
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * Math.max(0, Math.min(1, t)));
const vgrad = (top, bottom, y0, y1) => (x, y) => lerp(top, bottom, (y - y0) / (y1 - y0));

const FX = `${OUT}/../fx`;
fs.mkdirSync(FX, { recursive: true });

// ---- panels (nine-slice: 96 x 96, corners of 32, drawn at half size) --------------------------------------------------------------------
function panel(name, fillTop, fillBottom, border, opts = {}) {
  const im = img(96, 96);
  const outer = rrect(2, 2, 94, 94, 26);
  if (opts.shade !== false) paint(im, rrect(2, 6, 94, 95, 26), [0, 0, 0, 60]);
  paint(im, outer, border);
  const inner = inset(outer, opts.border ?? 6);
  paint(im, inner, vgrad(fillTop, fillBottom, 8, 88));
  if (opts.shine) paint(im, and(inset(outer, (opts.border ?? 6) + 2), (x, y) => y - 14), [255, 255, 255, opts.shine]);
  writePng(`${OUT}/${name}.png`, im);
}
panel('hd_card', [255, 250, 238], [246, 236, 214], [206, 176, 140], { border: 5 });
panel('hd_light', [255, 255, 252], [250, 246, 236], [236, 190, 120], { border: 6 });
panel('hd_kraft', [216, 172, 122], [198, 152, 104], [150, 108, 70], { border: 6, shine: 30 });
panel('hd_ink', [56, 132, 136], [40, 104, 110], [26, 70, 76], { border: 5, shine: 40 });
panel('hd_inset', [232, 220, 196], [240, 230, 210], [196, 172, 140], { border: 5, shade: false });

// a button, white so that a tint gives its colour: a lighter face, a darker lip along the bottom, a grey rim
{
  const im = img(96, 96);
  const outer = rrect(2, 2, 94, 94, 24);
  paint(im, rrect(2, 7, 94, 95, 24), [0, 0, 0, 70]);
  paint(im, outer, [120, 120, 120]);
  paint(im, inset(outer, 5), [200, 200, 200]);
  paint(im, inset(rrect(2, 2, 94, 84, 24), 5), vgrad([255, 255, 255], [238, 238, 238], 8, 80));
  writePng(`${OUT}/hd_button.png`, im);
}
// a wish card's row: a soft white strip with a faint rim (tinted: sand, or mint when the wish holds)
{
  const im = img(96, 96);
  const outer = rrect(2, 2, 94, 94, 22);
  paint(im, outer, [205, 205, 205]);
  paint(im, inset(outer, 3), vgrad([255, 255, 255], [244, 244, 244], 4, 92));
  writePng(`${OUT}/hd_row.png`, im);
}
// bars (64 x 32, ends of 16)
{
  const back = img(64, 32);
  paint(back, rrect(1, 1, 63, 31, 15), [36, 30, 48, 220]);
  writePng(`${OUT}/hd_bar_back.png`, back);
  const fill = img(64, 32);
  const s = rrect(3, 3, 61, 29, 13);
  paint(fill, s, vgrad([255, 255, 255], [205, 205, 205], 3, 29));
  paint(fill, and(inset(s, 3), (x, y) => y - 12), [255, 255, 255, 120]);
  writePng(`${OUT}/hd_bar_fill.png`, fill);
}

// ---- disc, star, pointer, tick, ring, padlock, tape ------------------------------------------------------------------------------------
{
  const im = img(192, 192);
  paint(im, circle(96, 100, 92), [0, 0, 0, 60]);
  paint(im, circle(96, 96, 92), [170, 170, 170]);
  paint(im, circle(96, 96, 84), vgrad([255, 255, 255], [226, 226, 226], 12, 180));
  paint(im, and(circle(96, 96, 76), (x, y) => y - 70), [255, 255, 255, 70]);
  writePng(`${OUT}/disc.png`, im);
}
function starPts(cx, cy, ro, ri) {
  const p = [];
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? ri : ro; p.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return p;
}
{
  const im = img(192, 192);
  const star = inset(polygon(starPts(96, 102, 84, 42)), 10);
  paint(im, (x, y) => star(x, y - 4), [0, 0, 0, 60]);
  paint(im, star, [176, 100, 30]);
  paint(im, inset(star, 8), vgrad([255, 230, 110], [250, 172, 46], 20, 170));
  paint(im, and(inset(star, 14), (x, y) => y - 92), [255, 250, 210, 110]);
  writePng(`${OUT}/star.png`, im);
}
{
  const im = img(128, 128);
  const p = inset(polygon([[18, 18], [112, 64], [18, 110], [36, 64]]), 8);
  paint(im, (x, y) => p(x + 2, y - 5), [0, 0, 0, 80]);
  paint(im, p, [150, 60, 46]);
  paint(im, inset(p, 8), vgrad([255, 170, 140], [236, 100, 84], 20, 108));
  paint(im, and(inset(p, 14), (x, y) => y - 56), [255, 240, 220, 120]);
  writePng(`${OUT}/pointer.png`, im);
}
// a thick stroke from a to b, r wide
const seg = (ax, ay, bx, by, r) => (x, y) => {
  const ex = bx - ax, ey = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey)));
  return Math.hypot(x - ax - ex * t, y - ay - ey * t) - r;
};
{
  const im = img(128, 128);
  paint(im, circle(64, 68, 58), [0, 0, 0, 60]);
  paint(im, circle(64, 64, 58), [40, 120, 70]);
  paint(im, circle(64, 64, 52), vgrad([120, 210, 130], [70, 170, 96], 12, 116));
  paint(im, union(seg(36, 66, 56, 86, 9), seg(56, 86, 94, 44, 9)), [255, 255, 255]);
  writePng(`${OUT}/check.png`, im);
}
{
  const im = img(128, 128);
  paint(im, cut(circle(64, 64, 56), circle(64, 64, 46)), [255, 255, 255, 255]);
  writePng(`${OUT}/ring.png`, im);
}
{
  const im = img(128, 128);
  paint(im, cut(rrect(34, 14, 94, 76, 30), rrect(46, 26, 82, 76, 18)), [110, 104, 120]);
  paint(im, rrect(22, 54, 106, 118, 14), [120, 110, 100]);
  paint(im, rrect(28, 60, 100, 112, 10), vgrad([250, 200, 90], [220, 160, 60], 60, 112));
  paint(im, union(circle(64, 80, 9), rrect(59, 80, 69, 98, 4)), [110, 70, 40]);
  writePng(`${OUT}/lock.png`, im);
}
{
  // packing tape: a translucent strip with torn (zigzag) ends
  const im = img(240, 64);
  const teeth = (x, y) => {
    const zl = 10 + Math.abs(((y / 8) % 2) - 1) * 10, zr = 230 - Math.abs(((y / 8) % 2) - 1) * 10;
    return Math.max(zl - x, x - zr, 6 - y, y - 58);
  };
  paint(im, teeth, [236, 214, 160, 215]);
  paint(im, and(teeth, (x, y) => Math.abs(y - 20) - 3), [255, 245, 220, 120]);
  writePng(`${OUT}/tape.png`, im);
}

// ---- the wish signs (128 x 128, dark ink so they read on the card) ------------------------------------------------------------------------
{
  // faces: an eye looking right
  const im = img(128, 128);
  const eye = (x, y) => Math.max(Math.hypot(x - 64, y - 26 - 60) - 66, Math.hypot(x - 64, y + 26 - 60 - 8) - 66);
  paint(im, eye, [60, 50, 70]);
  paint(im, inset(eye, 7), [255, 255, 255]);
  paint(im, circle(74, 64, 20), [70, 130, 190]);
  paint(im, circle(76, 64, 10), [30, 26, 40]);
  paint(im, circle(70, 58, 5), [255, 255, 255]);
  writePng(`${OUT}/glyph_faces.png`, im);
}
const heartShape = (cx, cy, s) => (x, y) => {
  const u = (x - cx) / s, v = (y - cy) / s;
  const a = Math.hypot(u + 0.5, v + 0.25) - 0.55, b = Math.hypot(u - 0.5, v + 0.25) - 0.55;
  const tri = polygon([[-1.02, 0.0], [1.02, 0.0], [0, 1.15]])(u, v);
  return Math.min(a, b, tri) * s;
};
{
  const im = img(128, 128);
  const h = heartShape(64, 60, 46);
  paint(im, (x, y) => h(x, y - 4), [0, 0, 0, 50]);
  paint(im, h, [170, 40, 70]);
  paint(im, inset(h, 6), vgrad([255, 120, 140], [226, 70, 100], 20, 110));
  paint(im, circle(46, 46, 8), [255, 230, 236, 200]);
  writePng(`${OUT}/glyph_next.png`, im);
}
{
  // a pin: "in" or "on" a place
  const im = img(128, 128);
  const pin = union(circle(64, 50, 34), polygon([[36, 66], [92, 66], [64, 118]]));
  paint(im, pin, [140, 40, 50]);
  paint(im, inset(pin, 6), vgrad([255, 120, 100], [220, 70, 70], 16, 110));
  paint(im, circle(64, 50, 13), [255, 250, 240]);
  writePng(`${OUT}/glyph_place.png`, im);
}
{
  // back to the wall: an arrow into a bar
  const im = img(128, 128);
  const arrow = union(rrect(14, 54, 78, 74, 6), polygon([[66, 36], [100, 64], [66, 92]]));
  paint(im, rrect(104, 16, 120, 112, 5), [90, 76, 84]);
  paint(im, arrow, [60, 50, 70]);
  paint(im, inset(arrow, 5), vgrad([140, 200, 220], [90, 160, 196], 30, 100));
  writePng(`${OUT}/glyph_back.png`, im);
}

// ---- soft pictures for the 3D world (sprites/fx) -------------------------------------------------------------------------------------------
{
  const puff = img(64, 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const d = Math.hypot(x + 0.5 - 32, y + 0.5 - 32) / 30, i = (y * 64 + x) * 4;
    puff.px[i] = puff.px[i + 1] = puff.px[i + 2] = 255; puff.px[i + 3] = Math.max(0, 1 - d) ** 1.6 * 255;
  }
  writePng(`${FX}/puff.png`, puff);
  const spark = img(64, 64);
  const four = (x, y) => { const u = Math.abs(x - 32), v = Math.abs(y - 32); return Math.min(u * 0.25 + v - 4, v * 0.25 + u - 4) * 1.2; };
  paint(spark, four, [255, 255, 255, 255]);
  paint(spark, circle(32, 32, 6), [255, 255, 255, 255]);
  writePng(`${FX}/spark.png`, spark);
  const heart = img(64, 64);
  paint(heart, heartShape(32, 30, 24), [255, 255, 255, 255]);
  writePng(`${FX}/heart.png`, heart);
  const conf = img(32, 32);
  paint(conf, rrect(4, 9, 28, 23, 3), [255, 255, 255, 255]);
  writePng(`${FX}/confetti.png`, conf);
  const ring = img(128, 128);
  paint(ring, cut(rrect(6, 6, 122, 122, 24), rrect(16, 16, 112, 112, 16)), [255, 255, 255, 255]);
  writePng(`${FX}/ring.png`, ring);
  // a chevron for the floor in front of the piece the mover faces: which way it looks (pointing up the picture)
  const chev = img(128, 128);
  paint(chev, inset(polygon([[64, 10], [118, 70], [92, 70], [64, 40], [36, 70], [10, 70]]), 2), [255, 255, 255, 255]);
  paint(chev, inset(polygon([[64, 56], [118, 116], [92, 116], [64, 86], [36, 116], [10, 116]]), 2), [255, 255, 255, 160]);
  writePng(`${FX}/chevron.png`, chev);
}

// ---- icons cut out of the renders: each picture over black and over white gives every pixel's alpha (difference matting); each cell is found
// by projecting its middle through the same camera the render used, then trimmed and fitted into 256 x 256 -----------------------------------
function project(cam, x, y, z, w, h) {
  const [ex, ey, ez] = cam.eye, [tx, ty, tz] = cam.target;
  let fx = tx - ex, fy = ty - ey, fz = tz - ez;
  const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
  let rx = -fz, rz = fx; const rl = Math.hypot(rx, rz); rx /= rl; rz /= rl;
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  const dx = x - ex, dy = y - ey, dz = z - ez;
  const xc = dx * rx + dz * rz, yc = dx * ux + dy * uy + dz * uz, zc = dx * fx + dy * fy + dz * fz;
  const half = Math.tan((cam.fov / 2) * Math.PI / 180);
  return [((xc / (zc * half * (w / h))) * 0.5 + 0.5) * w, (0.5 - (yc / (zc * half)) * 0.5) * h];
}
function cutOut(black, white, cx, cy, half, file, size = 256, pad = 10) {
  const x0c = Math.max(0, Math.round(cx - half)), y0c = Math.max(0, Math.round(cy - half));
  const x1c = Math.min(black.w - 1, Math.round(cx + half)), y1c = Math.min(black.h - 1, Math.round(cy + half));
  const W = x1c - x0c + 1, H = y1c - y0c + 1;
  const a = new Float32Array(W * H), rgb = new Float32Array(W * H * 3);
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = ((y + y0c) * black.w + x + x0c) * 4, k = y * W + x;
    let diff = 0;
    for (let c = 0; c < 3; c++) diff += white.px[i + c] - black.px[i + c];
    const alpha = Math.max(0, Math.min(1, 1 - diff / (3 * 255)));
    a[k] = alpha;
    if (alpha > 0.01) {
      for (let c = 0; c < 3; c++) rgb[k * 3 + c] = Math.min(255, black.px[i + c] / alpha);
      if (alpha > 0.3) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    }
  }
  // keep only the shape at the middle of the cell (a tall neighbour can reach into it): flood from the solid pixel nearest the middle
  {
    let seed = -1, best = Infinity;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = y * W + x; if (a[k] > 0.5) { const d = (x - W / 2) ** 2 + (y - H / 2) ** 2; if (d < best) { best = d; seed = k; } } }
    const keep = new Uint8Array(W * H), stack = [seed];
    keep[seed] = 1;
    while (stack.length) {
      const k = stack.pop(), x = k % W, y = (k - x) / W;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (!keep[n] && a[n] > 0.02) { keep[n] = 1; stack.push(n); }
      }
    }
    x0 = W; y0 = H; x1 = 0; y1 = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = y * W + x;
      if (!keep[k]) a[k] = 0;
      else if (a[k] > 0.3) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    }
  }
  const scale = (size - 2 * pad) / Math.max(x1 - x0 + 1, y1 - y0 + 1);
  const ox = (size - (x1 - x0 + 1) * scale) / 2, oy = (size - (y1 - y0 + 1) * scale) / 2;
  const out = img(size, size), ss = 4;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let sa = 0, sr = 0, sg = 0, sb = 0;
    for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) {
      const sx = Math.floor(x0 + (x + (i + 0.5) / ss - ox) / scale), sy = Math.floor(y0 + (y + (j + 0.5) / ss - oy) / scale);
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
      const k = sy * W + sx, al = a[k];
      sa += al; sr += rgb[k * 3] * al; sg += rgb[k * 3 + 1] * al; sb += rgb[k * 3 + 2] * al;
    }
    const o = (y * size + x) * 4;
    if (sa > 0) { out.px[o] = sr / sa; out.px[o + 1] = sg / sa; out.px[o + 2] = sb / sa; }
    out.px[o + 3] = sa / (ss * ss) * 255;
  }
  writePng(file, out);
}
if (ICONS) {
  const ICON_NAMES = ['sofa', 'armchair', 'tv', 'bed', 'plant', 'bookcase', 'lamp', 'fridge', 'stove', 'desk', 'desk_chair', 'table', 'chair', 'box',
    'bathtub', 'washer', 'side_table', 'coffee_table', 'wall', 'window', 'rug', 'room_living', 'room_bedroom', 'room_kitchen', 'room_bathroom'];
  const black = readPng(`${ICONS}/icons-black.png`), white = readPng(`${ICONS}/icons-white.png`);
  const cam = { eye: [9.6, 50, 54.3], target: [9.6, 0.5, 4.8], fov: 10 };
  const [ax] = project(cam, 0, 0.4, 0, black.w, black.h), [bx] = project(cam, 3.2, 0.4, 0, black.w, black.h);
  const half = Math.abs(bx - ax) / 2;
  ICON_NAMES.forEach((name, i) => {
    const [cx, cy] = project(cam, (i % 7) * 3.2, 0.4, Math.floor(i / 7) * 3.2, black.w, black.h);
    cutOut(black, white, cx, cy - half * 0.1, half * 0.92, `${OUT}/icon_${name}.png`);
  });
  const FACES = ['character-female-a', 'character-female-b', 'character-female-c', 'character-female-d', 'character-female-e', 'character-female-f',
    'character-male-a', 'character-male-b', 'character-male-c', 'character-male-d', 'character-male-e', 'character-male-f'];
  const fb = readPng(`${ICONS}/faces-black.png`), fw = readPng(`${ICONS}/faces-white.png`);
  const fcam = { eye: [2.85, 2.35, 37], target: [2.85, -0.65, 0], fov: 10 };
  const [fa] = project(fcam, 0, 1.35, 0, fb.w, fb.h), [fbx] = project(fcam, 1.9, 1.35, 0, fb.w, fb.h);
  const fh = Math.abs(fbx - fa) / 2;
  FACES.forEach((who, i) => {
    const [cx, cy] = project(fcam, (i % 4) * 1.9, 0.92 - Math.floor(i / 4) * 2, 0, fb.w, fb.h);
    cutOut(fb, fw, cx, cy, fh * 0.62, `${OUT}/face_${who}.png`, 192, 6);
  });
}
console.log('wrote the HD interface pictures to', OUT);
