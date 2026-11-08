// A small SVG rasteriser and PNG writer for Sunny Hop's art. Kenney's New Platformer Pack vectors use a tiny part of SVG: `<path>`s with
// absolute M, L and Q commands, filled (non-zero) with a colour or a two-stop linear gradient in user space, some with `fill-opacity`. That is
// all this reads; anything else is an error, so a changed pack is noticed instead of drawn wrong. Pictures are anti-aliased by exact coverage
// along each of 8 sub-rows of a pixel for the game's own shapes; an SVG is drawn at four times the size with each sample either in or out of a
// shape and then averaged (4 x 4 supersampling), so that two shapes that meet leave no see-through seam between them. Pictures are made at
// exactly the size they are shown at.
import fs from "node:fs";
import zlib from "node:zlib";

// ---- reading ----------------------------------------------------------------------------------------------------------------------------
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? m[1] : null;
};
const hex = (s) => {
  const m = /^#([0-9a-fA-F]{6})$/.exec(s);
  if (!m) throw new Error(`svg: colour '${s}' is not #rrggbb`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Parse an SVG file of the pack: { w, h, shapes: [{ subpaths: [[x, y, ...]], fill: { color } | { gradient }, opacity }] }. */
export function readSvg(file) {
  const text = fs.readFileSync(file, "utf8");
  const svg = text.match(/<svg[^>]*>/)[0];
  const w = +attr(svg, "width"), h = +attr(svg, "height");
  const gradients = {};
  for (const m of text.matchAll(/<linearGradient([^>]*)>([\s\S]*?)<\/linearGradient>/g)) {
    const tag = m[1];
    if (attr(tag, "gradientUnits") !== "userSpaceOnUse") throw new Error(`${file}: only userSpaceOnUse gradients`);
    const t = (attr(tag, "gradientTransform") || "matrix(1 0 0 1 0 0)").match(/matrix\(([^)]*)\)/)[1].trim().split(/[\s,]+/).map(Number);
    const stops = [...m[2].matchAll(/<stop([^>]*)\/>/g)].map((s) => ({ at: +attr(s[1], "offset"), color: hex(attr(s[1], "stop-color")), a: attr(s[1], "stop-opacity") == null ? 1 : +attr(s[1], "stop-opacity") }));
    gradients[attr(tag, "id")] = { x1: +(attr(tag, "x1") ?? 0), y1: +(attr(tag, "y1") ?? 0), x2: +(attr(tag, "x2") ?? 1), y2: +(attr(tag, "y2") ?? 0), m: t, stops };
  }
  const shapes = [];
  for (const m of text.matchAll(/<path([^>]*)\/>/g)) {
    const tag = m[1];
    const fill = attr(tag, "fill");
    let paint;
    if (fill.startsWith("url(#")) paint = { gradient: gradients[fill.slice(5, -1)] };
    else paint = { color: hex(fill) };
    if (paint.gradient === undefined && !paint.color) throw new Error(`${file}: unknown fill ${fill}`);
    const opacity = attr(tag, "fill-opacity") == null ? 1 : +attr(tag, "fill-opacity");
    shapes.push({ subpaths: parsePath(attr(tag, "d"), file), paint, opacity });
  }
  return { w, h, shapes };
}

// M, L and Q (absolute; a command's numbers may repeat), flattened into polygons
function parsePath(d, file) {
  const tokens = d.match(/[A-Za-z]|-?[0-9]*\.?[0-9]+(?:e-?[0-9]+)?/g);
  const subpaths = [];
  let cur = null, cmd = null, x = 0, y = 0, i = 0;
  const num = () => +tokens[i++];
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) {
      cmd = tokens[i++];
      if (!"MLQZz".includes(cmd)) throw new Error(`${file}: path command '${cmd}' is not supported`);
      if (cmd === "Z" || cmd === "z") { cmd = null; continue; }
    }
    if (cmd === "M") { x = num(); y = num(); cur = [x, y]; subpaths.push(cur); cmd = "L"; }
    else if (cmd === "L") { x = num(); y = num(); cur.push(x, y); }
    else if (cmd === "Q") {
      const cx = num(), cy = num(), ex = num(), ey = num();
      const n = Math.max(2, Math.ceil((Math.hypot(cx - x, cy - y) + Math.hypot(ex - cx, ey - cy)) / 0.6));
      for (let k = 1; k <= n; k++) {
        const t = k / n, u = 1 - t;
        cur.push(u * u * x + 2 * u * t * cx + t * t * ex, u * u * y + 2 * u * t * cy + t * t * ey);
      }
      x = ex; y = ey;
    } else throw new Error(`${file}: numbers with no command`);
  }
  return subpaths;
}

// ---- drawing ----------------------------------------------------------------------------------------------------------------------------
/** A transparent picture, premultiplied floats 0..1. */
export const image = (w, h) => ({ w, h, px: new Float32Array(w * h * 4) });

const SUB = 8; // sub-rows per pixel row

/**
 * Fill a shape (polygons in picture space after `scale` and offset `ox`, `oy`) into `img`. `paint(x, y)` gives [r, g, b, a] (0..255, a 0..1) for
 * a pixel's middle in SVG space; `subpaths` are flat [x, y, ...] lists.
 */
function fillShape(img, subpaths, scale, ox, oy, paint, hard = false) {
  const edges = [];
  let minY = Infinity, maxY = -Infinity;
  for (const sp of subpaths) {
    const n = sp.length / 2;
    for (let k = 0; k < n; k++) {
      const x0 = sp[k * 2] * scale + ox, y0 = sp[k * 2 + 1] * scale + oy;
      const j = (k + 1) % n;
      const x1 = sp[j * 2] * scale + ox, y1 = sp[j * 2 + 1] * scale + oy;
      if (y0 === y1) continue;
      edges.push(y0 < y1 ? [x0, y0, x1, y1, 1] : [x1, y1, x0, y0, -1]);
      minY = Math.min(minY, y0, y1); maxY = Math.max(maxY, y0, y1);
    }
  }
  if (!edges.length) return;
  const { w, h, px } = img;
  const r0 = Math.max(0, Math.floor(minY)), r1 = Math.min(h - 1, Math.ceil(maxY));
  const cover = new Float32Array(w + 2);
  const sub = hard ? 1 : SUB;
  for (let row = r0; row <= r1; row++) {
    cover.fill(0);
    let any = false, lo = w, hi = 0;
    for (let s = 0; s < sub; s++) {
      const sy = row + (s + 0.5) / sub;
      const xs = [];
      for (const e of edges) {
        if (sy < e[1] || sy >= e[3]) continue;
        xs.push([e[0] + ((sy - e[1]) / (e[3] - e[1])) * (e[2] - e[0]), e[4]]);
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a[0] - b[0]);
      let wind = 0;
      for (let k = 0; k < xs.length - 1; k++) {
        wind += xs[k][1];
        if (wind === 0) continue;
        let a = Math.max(0, xs[k][0]), b = Math.min(w, xs[k + 1][0]);
        if (b <= a) continue;
        if (hard) {
          // a pixel is in when its middle is
          const ia = Math.max(0, Math.ceil(a - 0.5)), ib = Math.min(w - 1, Math.ceil(b - 0.5) - 1);
          for (let c = ia; c <= ib; c++) cover[c] = 1;
          if (ib >= ia) { any = true; lo = Math.min(lo, ia); hi = Math.max(hi, ib); }
          continue;
        }
        any = true;
        const ia = Math.floor(a), ib = Math.floor(b);
        lo = Math.min(lo, ia); hi = Math.max(hi, ib);
        if (ia === ib) { cover[ia] += (b - a) / SUB; continue; }
        cover[ia] += (ia + 1 - a) / SUB;
        for (let c = ia + 1; c < ib; c++) cover[c] += 1 / SUB;
        if (ib < w) cover[ib] += (b - ib) / SUB;
      }
    }
    if (!any) continue;
    for (let c = lo; c <= Math.min(hi, w - 1); c++) {
      const cv = Math.min(1, cover[c]);
      if (cv <= 0) continue;
      const [r, g, b, a] = paint((c + 0.5 - ox) / scale, (row + 0.5 - oy) / scale);
      const sa = a * cv;
      const o = (row * w + c) * 4;
      px[o] = (r / 255) * sa + px[o] * (1 - sa);
      px[o + 1] = (g / 255) * sa + px[o + 1] * (1 - sa);
      px[o + 2] = (b / 255) * sa + px[o + 2] * (1 - sa);
      px[o + 3] = sa + px[o + 3] * (1 - sa);
    }
  }
}

function gradientPaint(g, opacity, recolor) {
  // the gradient's own space: x1..x2 along its x axis, mapped by the matrix [a b c d e f] into user space; invert it to find t at a point
  const [a, b, c, d, e, f] = g.m;
  const det = a * d - b * c;
  const stops = g.stops.map((s) => ({ ...s, color: recolor(s.color) }));
  return (x, y) => {
    const dx = x - e, dy = y - f;
    const gx = (d * dx - c * dy) / det, gy = (-b * dx + a * dy) / det;
    const vx = g.x2 - g.x1, vy = g.y2 - g.y1;
    let t = ((gx - g.x1) * vx + (gy - g.y1) * vy) / (vx * vx + vy * vy);
    t = Math.max(0, Math.min(1, t));
    let s0 = stops[0], s1 = stops[stops.length - 1];
    for (let k = 0; k < stops.length - 1; k++) if (t >= stops[k].at && t <= stops[k + 1].at) { s0 = stops[k]; s1 = stops[k + 1]; break; }
    const u = s1.at > s0.at ? (t - s0.at) / (s1.at - s0.at) : 0;
    return [0, 1, 2].map((i) => s0.color[i] + (s1.color[i] - s0.color[i]) * u).concat([(s0.a + (s1.a - s0.a) * u) * opacity]);
  };
}

/**
 * Draw an SVG into a picture: `opts.size` [w, h] of the result (default the SVG's own), or `opts.scale`; `opts.into` an existing picture and
 * `opts.at` [x, y] where the SVG's top left goes; `opts.skip(i, shape)` leaves shapes out; `opts.recolor([r, g, b]) -> [r, g, b]` changes colours.
 */
export function draw(svg, opts = {}) {
  const scale = opts.scale ?? (opts.size ? opts.size[0] / svg.w : 1);
  const w = Math.round(svg.w * scale), h = Math.round(svg.h * (opts.size ? opts.size[1] / svg.h : scale));
  const img = opts.into ?? image(w, h);
  const [ox, oy] = opts.at ?? [0, 0];
  const recolor = opts.recolor ?? ((c) => c);
  const SS = 4;
  const hi = image(w * SS, h * SS);
  svg.shapes.forEach((s, i) => {
    if (opts.skip && opts.skip(i, s)) return;
    const op = s.opacity * (opts.alpha ?? 1);
    const paint = s.paint.gradient ? gradientPaint(s.paint.gradient, op, recolor) : (() => { const c = recolor(s.paint.color); const v = [c[0], c[1], c[2], op]; return () => v; })();
    fillShape(hi, s.subpaths, scale * SS, 0, 0, paint, true);
  });
  // average each 4 x 4 block of samples, and lay it over the picture at (ox, oy)
  const n = SS * SS;
  for (let y = 0; y < h; y++) {
    const ty = y + oy;
    if (ty < 0 || ty >= img.h) continue;
    for (let x = 0; x < w; x++) {
      const tx = x + ox;
      if (tx < 0 || tx >= img.w) continue;
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        let o = ((y * SS + sy) * hi.w + x * SS) * 4;
        for (let sx = 0; sx < SS; sx++, o += 4) { r += hi.px[o]; g += hi.px[o + 1]; b += hi.px[o + 2]; a += hi.px[o + 3]; }
      }
      r /= n; g /= n; b /= n; a /= n;
      const d = (ty * img.w + tx) * 4;
      img.px[d] = r + img.px[d] * (1 - a); img.px[d + 1] = g + img.px[d + 1] * (1 - a); img.px[d + 2] = b + img.px[d + 2] * (1 - a); img.px[d + 3] = a + img.px[d + 3] * (1 - a);
    }
  }
  return img;
}

/** Fill polygons given in picture pixels with one colour ([r, g, b] 0..255, alpha 0..1): for the game's own shapes (panels, sparkles). */
export function polygon(img, subpaths, color, alpha = 1) {
  const v = [color[0], color[1], color[2], alpha];
  fillShape(img, subpaths, 1, 0, 0, () => v);
}

/** A rounded rectangle as a polygon. */
export function roundRect(x, y, w, h, r, steps = 10) {
  const p = [];
  const corner = (cx, cy, a0) => { for (let k = 0; k <= steps; k++) { const a = a0 + (k / steps) * (Math.PI / 2); p.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } };
  corner(x + w - r, y + r, -Math.PI / 2);
  corner(x + w - r, y + h - r, 0);
  corner(x + r, y + h - r, Math.PI / 2);
  corner(x + r, y + r, Math.PI);
  return p;
}

/** Copy `src` into `dst` at x, y (over what is there). */
export function blit(dst, src, x, y) {
  for (let r = 0; r < src.h; r++) {
    const ty = r + y;
    if (ty < 0 || ty >= dst.h) continue;
    for (let c = 0; c < src.w; c++) {
      const tx = c + x;
      if (tx < 0 || tx >= dst.w) continue;
      const s = (r * src.w + c) * 4, d = (ty * dst.w + tx) * 4;
      const a = src.px[s + 3];
      for (let k = 0; k < 4; k++) dst.px[d + k] = src.px[s + k] + dst.px[d + k] * (1 - a);
    }
  }
}

/** The smallest box holding every pixel with some alpha: { x, y, w, h }. */
export function bounds(img, threshold = 0.01) {
  let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    if (img.px[(y * img.w + x) * 4 + 3] > threshold) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  return x1 < 0 ? { x: 0, y: 0, w: 0, h: 0 } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Write a picture as an 8-bit RGBA PNG (un-premultiplied). */
export function writePng(file, img) {
  const { w, h, px } = img;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, a = px[o + 3];
      const t = y * (w * 4 + 1) + 1 + x * 4;
      const un = (v) => Math.max(0, Math.min(255, Math.round(a > 0 ? (v / a) * 255 : 0)));
      raw[t] = un(px[o]); raw[t + 1] = un(px[o + 1]); raw[t + 2] = un(px[o + 2]); raw[t + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]));
}
const CRC = [];
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; }
const crc = (b) => { let c = ~0; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (~c) >>> 0; };
function chunk(t, d) {
  const l = Buffer.alloc(4); l.writeUInt32BE(d.length);
  const td = Buffer.concat([Buffer.from(t), d]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([l, td, c]);
}

/** Read an 8-bit PNG (grey, RGB, RGBA or palette) into a picture. */
export function readPng(file) {
  const b = fs.readFileSync(file);
  let o = 8, w, h, type, depth, idat = [], palette = null, trns = null;
  while (o < b.length) {
    const len = b.readUInt32BE(o), t = b.toString("ascii", o + 4, o + 8), d = b.subarray(o + 8, o + 8 + len);
    if (t === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; type = d[9]; if (d[12]) throw new Error(`${file}: interlaced PNGs are not read`); }
    if (t === "PLTE") palette = d;
    if (t === "tRNS") trns = d;
    if (t === "IDAT") idat.push(d);
    o += 12 + len;
  }
  if (depth !== 8) throw new Error(`${file}: only 8-bit PNGs are read`);
  const bpp = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(w * h * bpp);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= bpp ? out[y * stride + x - bpp] : 0, up = y > 0 ? out[(y - 1) * stride + x] : 0, c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let p = v;
      if (f === 1) p = v + a; else if (f === 2) p = v + up; else if (f === 3) p = v + ((a + up) >> 1);
      else if (f === 4) { const pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c); p = v + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c); }
      out[y * stride + x] = p & 255;
    }
  }
  const img = image(w, h);
  for (let i = 0; i < w * h; i++) {
    let r, g, bl, a = 255;
    if (type === 6) { r = out[i * 4]; g = out[i * 4 + 1]; bl = out[i * 4 + 2]; a = out[i * 4 + 3]; }
    else if (type === 2) { r = out[i * 3]; g = out[i * 3 + 1]; bl = out[i * 3 + 2]; }
    else if (type === 3) { const k = out[i]; r = palette[k * 3]; g = palette[k * 3 + 1]; bl = palette[k * 3 + 2]; a = trns && k < trns.length ? trns[k] : 255; }
    else if (type === 0) { r = g = bl = out[i]; }
    else { r = g = bl = out[i * 2]; a = out[i * 2 + 1]; }
    const al = a / 255;
    img.px[i * 4] = (r / 255) * al; img.px[i * 4 + 1] = (g / 255) * al; img.px[i * 4 + 2] = (bl / 255) * al; img.px[i * 4 + 3] = al;
  }
  return img;
}

/** Shrink a picture by box filtering (premultiplied, so edges do not darken) to w x h. */
export function resize(img, w, h) {
  const out = image(w, h);
  const sx = img.w / w, sy = img.h / h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = x * sx, x1 = (x + 1) * sx, y0 = y * sy, y1 = (y + 1) * sy;
    const acc = [0, 0, 0, 0];
    let area = 0;
    for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
      const wy = Math.min(y1, yy + 1) - Math.max(y0, yy);
      for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
        const wx = Math.min(x1, xx + 1) - Math.max(x0, xx);
        const o = (Math.min(img.h - 1, yy) * img.w + Math.min(img.w - 1, xx)) * 4;
        for (let k = 0; k < 4; k++) acc[k] += img.px[o + k] * wx * wy;
        area += wx * wy;
      }
    }
    for (let k = 0; k < 4; k++) out.px[(y * w + x) * 4 + k] = acc[k] / area;
  }
  return out;
}
