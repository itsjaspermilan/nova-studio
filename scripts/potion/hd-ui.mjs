// Potion Panic's interface pictures, drawn at twice the size they are shown (the Retroid's screen is 1080 pixels high, the game's units 540), with
// smooth edges: panels, buttons, discs, stars, arrows, the pointer, flasks and bars, and the ingredient icons cut out of a render of the game's own
// 3D models (scripts/potion/icons/, rendered over black and over white). Run by scripts/potion/hd-ui.sh. Everything here is original; no Kenney picture is used.
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

// ---- panels (nine-slice: 96 x 96, corners of 32, drawn at half size) --------------------------------------------------------------------
function panel(name, fillTop, fillBottom, border, opts = {}) {
  const im = img(96, 96);
  const outer = rrect(2, 2, 94, 94, 26);
  // a soft drop shade under it
  if (opts.shade !== false) paint(im, rrect(2, 6, 94, 95, 26), [0, 0, 0, 60]);
  paint(im, outer, border);
  const inner = inset(outer, opts.border ?? 6);
  paint(im, inner, vgrad(fillTop, fillBottom, 8, 88));
  // a light line inside the top edge
  if (opts.shine) paint(im, and(inset(outer, (opts.border ?? 6) + 2), (x, y) => y - 14), [255, 255, 255, opts.shine]);
  writePng(`${OUT}/${name}.png`, im);
}
panel('hd_page', [244, 232, 204], [232, 214, 178], [160, 112, 72], { border: 7 });
panel('hd_light', [255, 250, 238], [244, 232, 208], [200, 170, 128], { border: 5 });
panel('hd_ink', [70, 66, 150], [48, 44, 112], [30, 26, 70], { border: 5, shine: 40 });
panel('hd_inset', [214, 194, 158], [226, 208, 176], [168, 136, 98], { border: 5, shade: false });
panel('hd_leather', [128, 74, 56], [100, 56, 44], [64, 34, 28], { border: 7, shine: 30 });

// a button / ribbon, white so that a tint gives its colour: a lighter face, a darker lip along the bottom, a grey rim
{
  const im = img(96, 96);
  const outer = rrect(2, 2, 94, 94, 24);
  paint(im, rrect(2, 7, 94, 95, 24), [0, 0, 0, 70]);
  paint(im, outer, [120, 120, 120]);
  paint(im, inset(outer, 5), [200, 200, 200]);
  paint(im, and(inset(outer, 5), (x, y) => y - 78), [200, 200, 200]);
  paint(im, inset(rrect(2, 2, 94, 84, 24), 5), vgrad([255, 255, 255], [238, 238, 238], 8, 80));
  writePng(`${OUT}/hd_button.png`, im);
}

// ---- bars (64 x 32, ends of 16, drawn at half size) ----------------------------------------------------------------------------------
{
  const back = img(64, 32);
  paint(back, rrect(1, 1, 63, 31, 15), [36, 28, 48, 220]);
  writePng(`${OUT}/hd_bar_back.png`, back);
  const fill = img(64, 32);
  const s = rrect(3, 3, 61, 29, 13);
  paint(fill, s, vgrad([255, 255, 255], [205, 205, 205], 3, 29));
  paint(fill, and(inset(s, 3), (x, y) => y - 12), [255, 255, 255, 120]);
  writePng(`${OUT}/hd_bar_fill.png`, fill);
}

// ---- disc, star, arrow, pointer, cross -----------------------------------------------------------------------------------------------
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
  const star = inset(polygon(starPts(96, 102, 84, 40)), 8);
  paint(im, (x, y) => star(x, y - 4), [0, 0, 0, 60]);
  paint(im, star, [150, 86, 24]);
  paint(im, inset(star, 8), vgrad([255, 226, 96], [246, 168, 40], 20, 170));
  paint(im, and(inset(star, 14), (x, y) => y - 92), [255, 250, 210, 110]);
  writePng(`${OUT}/star.png`, im);
}
{
  const im = img(128, 128);
  const arrow = inset(polygon([[22, 26], [110, 64], [22, 102], [40, 64]]), 6);
  paint(im, (x, y) => arrow(x, y - 4), [0, 0, 0, 60]);
  paint(im, arrow, [110, 70, 44]);
  paint(im, inset(arrow, 7), vgrad([255, 240, 206], [230, 200, 150], 26, 102));
  writePng(`${OUT}/arrow.png`, im);
}
{
  // the pointer that marks the chosen thing: a fat gold arrowhead pointing right
  const im = img(128, 128);
  const p = inset(polygon([[18, 18], [112, 64], [18, 110], [36, 64]]), 8);
  paint(im, (x, y) => p(x + 2, y - 5), [0, 0, 0, 80]);
  paint(im, p, [96, 50, 26]);
  paint(im, inset(p, 8), vgrad([255, 224, 110], [240, 150, 40], 20, 108));
  paint(im, and(inset(p, 14), (x, y) => y - 56), [255, 250, 220, 120]);
  writePng(`${OUT}/pointer.png`, im);
}
{
  const im = img(128, 128);
  const bar = (a) => { const c = Math.cos(a), s = Math.sin(a); return (x, y) => { const dx = x - 64, dy = y - 64; return rrect(-50, -13, 50, 13, 13)(dx * c + dy * s, -dx * s + dy * c); }; };
  const cross = union(bar(Math.PI / 4), bar(-Math.PI / 4));
  paint(im, cross, [90, 30, 30]);
  paint(im, inset(cross, 6), [230, 80, 70]);
  writePng(`${OUT}/cross.png`, im);
}

// ---- a bubble for the 3D world (sprites/fx): a pale disc with a bright rim and a shine, white so that a tint gives its colour -----------------
{
  const im = img(64, 64);
  paint(im, circle(32, 32, 30), [255, 255, 255, 120]);
  paint(im, cut(circle(32, 32, 30), circle(32, 32, 25)), [255, 255, 255, 235]);
  paint(im, circle(23, 22, 7), [255, 255, 255, 230]);
  writePng(`${OUT}/../fx/bubble.png`, im);
}

// ---- the flask: glass (outline, cork, shine) over a white fill that is tinted the potion's colour; 128 x 160 -----------------------------
{
  const body = union(circle(64, 108, 48), rrect(46, 26, 82, 80, 8));
  const glass = img(128, 160), fill = img(128, 160);
  paint(glass, (x, y) => body(x, y - 4), [0, 0, 0, 60]);
  paint(glass, body, [52, 36, 56]);
  paint(glass, inset(body, 7), [220, 236, 255, 110]);
  // the liquid: the body below a line, with a lighter surface
  const liquid = and(inset(body, 7), (x, y) => 82 - y);
  paint(fill, liquid, vgrad([255, 255, 255], [196, 196, 196], 82, 152));
  paint(fill, and(liquid, (x, y) => y - 90), [255, 255, 255, 140]);
  // cut the glass's pale interior out where the liquid is, so the colour shows through
  for (let y = 0; y < glass.h; y++) for (let x = 0; x < glass.w; x++) glass.px[(y * glass.w + x) * 4 + 3] *= 1 - cov(liquid(x + 0.5, y + 0.5));
  // a shine and the cork
  paint(glass, rrect(30, 92, 42, 126, 6), [255, 255, 255, 170]);
  paint(glass, rrect(40, 4, 88, 32, 8), [80, 48, 30]);
  paint(glass, rrect(45, 9, 83, 27, 5), [190, 132, 80]);
  writePng(`${OUT}/flask_glass.png`, glass);
  writePng(`${OUT}/flask_fill.png`, fill);
}

// ---- the ingredient icons: the same six cells rendered over black and over white; the difference gives each pixel's alpha (difference matting),
// then each is trimmed and fitted into 256 x 256 -----------------------------------------------------------------------------------------------------
if (ICONS) {
  const black = readPng(ICONS + '-black.png'), white = readPng(ICONS + '-white.png');
  const names = ['glowcap', 'embergourd', 'frostroot', 'moonberry', 'sunpetal', 'bogbulb'];
  const cell = black.w / names.length;
  names.forEach((name, n) => {
    const a = new Float32Array(cell * black.h), rgb = new Float32Array(cell * black.h * 3);
    let x0 = cell, y0 = black.h, x1 = 0, y1 = 0;
    for (let y = 0; y < black.h; y++) for (let x = 0; x < cell; x++) {
      const i = (y * black.w + n * cell + x) * 4, k = y * cell + x;
      let diff = 0;
      for (let c = 0; c < 3; c++) diff += white.px[i + c] - black.px[i + c];
      const alpha = Math.max(0, Math.min(1, 1 - diff / (3 * 255)));
      a[k] = alpha;
      if (alpha > 0.01) {
        for (let c = 0; c < 3; c++) rgb[k * 3 + c] = Math.min(255, black.px[i + c] / alpha);
        if (alpha > 0.3) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      }
    }
    const size = 256, pad = 8;
    const scale = (size - 2 * pad) / Math.max(x1 - x0 + 1, y1 - y0 + 1);
    const ox = (size - (x1 - x0 + 1) * scale) / 2, oy = (size - (y1 - y0 + 1) * scale) / 2;
    const out = img(size, size);
    const ss = 4;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let sa = 0, sr = 0, sg = 0, sb = 0;
      for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) {
        const sx = Math.floor(x0 + (x + (i + 0.5) / ss - ox) / scale), sy = Math.floor(y0 + (y + (j + 0.5) / ss - oy) / scale);
        if (sx < 0 || sy < 0 || sx >= cell || sy >= black.h) continue;
        const k = sy * cell + sx, al = a[k];
        sa += al; sr += rgb[k * 3] * al; sg += rgb[k * 3 + 1] * al; sb += rgb[k * 3 + 2] * al;
      }
      const o = (y * size + x) * 4;
      if (sa > 0) { out.px[o] = sr / sa; out.px[o + 1] = sg / sa; out.px[o + 2] = sb / sa; }
      out.px[o + 3] = sa / (ss * ss) * 255;
    }
    writePng(`${OUT}/ing_${name}.png`, out);
  });
}

// ---- pictures for the 3D world (sprites/fx, drawn by nova.billboard): stickers for the crates and the bin, the arrow over the station at hand,
// the rune circle of the washing window, and eyes for the cauldrons ---------------------------------------------------------------------------
const FX = `${OUT}/../fx`;
{
  // a round label: white with a coloured rim, the picture in the middle
  const label = (name, rim, draw) => {
    const im = img(128, 128);
    paint(im, circle(64, 67, 60), [0, 0, 0, 70]);
    paint(im, circle(64, 64, 60), rim);
    paint(im, circle(64, 64, 55), [255, 250, 238]);
    draw(im);
    writePng(`${FX}/${name}.png`, im);
  };
  for (const name of ['glowcap', 'embergourd', 'frostroot', 'moonberry', 'sunpetal', 'bogbulb']) {
    const icon = readPng(`${OUT}/ing_${name}.png`);
    label(`sticker_${name}`, [120, 82, 56], (im) => {
      // the icon scaled into the middle 98 x 98 (box filter from 256)
      const k = icon.w / 98;
      for (let y = 0; y < 98; y++) for (let x = 0; x < 98; x++) {
        let a = 0, r = 0, g = 0, b = 0;
        for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
          const sx = Math.min(icon.w - 1, Math.floor((x + (i + 0.5) / 3) * k)), sy = Math.min(icon.h - 1, Math.floor((y + (j + 0.5) / 3) * k));
          const o = (sy * icon.w + sx) * 4, al = icon.px[o + 3] / 255;
          a += al; r += icon.px[o] * al; g += icon.px[o + 1] * al; b += icon.px[o + 2] * al;
        }
        if (a <= 0) continue;
        const o = ((y + 15) * im.w + x + 15) * 4, sa = a / 9, da = im.px[o + 3] / 255, oa = sa + da * (1 - sa);
        im.px[o] = (r / a * sa + im.px[o] * da * (1 - sa)) / oa; im.px[o + 1] = (g / a * sa + im.px[o + 1] * da * (1 - sa)) / oa; im.px[o + 2] = (b / a * sa + im.px[o + 2] * da * (1 - sa)) / oa; im.px[o + 3] = oa * 255;
      }
    });
  }
  // the bin: a cross on a grey-rimmed label
  label('sticker_bin', [80, 76, 90], (im) => {
    const bar = (a) => { const c = Math.cos(a), sn = Math.sin(a); return (x, y) => { const dx = x - 64, dy = y - 64; return rrect(-30, -8, 30, 8, 8)(dx * c + dy * sn, -dx * sn + dy * c); }; };
    paint(im, union(bar(Math.PI / 4), bar(-Math.PI / 4)), [200, 70, 70]);
  });
  // the arrow that floats over the station at hand: gold, pointing down
  {
    const im = img(128, 128);
    const arrow = inset(polygon([[64, 118], [114, 58], [84, 58], [84, 10], [44, 10], [44, 58], [14, 58]]), 6);
    paint(im, arrow, [70, 40, 30]);
    paint(im, inset(arrow, 7), vgrad([255, 232, 120], [246, 160, 40], 10, 118));
    paint(im, and(inset(arrow, 12), (x, y) => 40 - x + 20), [255, 255, 230, 90]);
    writePng(`${FX}/arrow_down.png`, im);
  }
  // a rune circle: two rings and six marks, white so that a tint colours it
  {
    const im = img(256, 256);
    const ring = (r0, r1) => cut(circle(128, 128, r1), circle(128, 128, r0));
    paint(im, ring(112, 120), [255, 255, 255, 230]);
    paint(im, ring(88, 93), [255, 255, 255, 200]);
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3, cx = 128 + Math.cos(a) * 102, cy = 128 + Math.sin(a) * 102;
      paint(im, circle(cx, cy, 7), [255, 255, 255, 240]);
    }
    const tri = (rot) => polygon([0, 1, 2].map((k) => { const a = rot + k * 2 * Math.PI / 3; return [128 + Math.cos(a) * 80, 128 + Math.sin(a) * 80]; }));
    paint(im, cut(tri(-Math.PI / 2), inset(tri(-Math.PI / 2), 5)), [255, 255, 255, 170]);
    paint(im, cut(tri(Math.PI / 2), inset(tri(Math.PI / 2), 5)), [255, 255, 255, 170]);
    writePng(`${FX}/rune.png`, im);
  }
  // eyes: the white with a dark rim, and the pupil with a glint
  {
    const eye = img(64, 64);
    paint(eye, circle(32, 32, 30), [40, 28, 40]);
    paint(eye, circle(32, 32, 25), [255, 255, 255]);
    writePng(`${FX}/eye.png`, eye);
    const pupil = img(64, 64);
    paint(pupil, circle(32, 32, 30), [30, 22, 34]);
    paint(pupil, circle(22, 22, 9), [255, 255, 255, 230]);
    writePng(`${FX}/pupil.png`, pupil);
  }
}

console.log('wrote the HD interface pictures to', OUT);
