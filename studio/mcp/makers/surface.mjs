// The surface pictures of ground and roads (surface_make, makers/index-ground.ts), all made from noise: nothing is taken from anywhere else.
// First made for Pine Ridge Rally (scripts/rally/surfaces.mjs, 2026-11); with seed 1 and no options every picture is exactly the one that game
// ships. Models name them by `uri` (land_make's ground, the road ribbons of track_write and road_make), so every road and every ground of a
// game shares the same few files.
//
// Two kinds of picture (docs/project-format.md, "Tiling pictures and detail"):
// - a BASE picture multiplies the model's vertex colours (which stay the tint: the grass green, the asphalt grey...). It holds the big
//   shapes: patches of dry grass, a road's ruts, its racing line and its ragged edge (alpha). White changes nothing.
//   The ground's are 64 m across (ground_*.png); the roads' is one sheet for every kind of road (road.png, see ROAD below).
// - a DETAIL picture is fine grain that repeats every 4 m and multiplies by twice its value (mid-grey 128 changes nothing): blades of
//   grass, grit, snow crystals. Far away it averages out to grey by itself (its mipmaps).
import zlib from "node:zlib";

/// Where finished pictures go while makeSurfaces runs.
let EMIT = () => {};

// ---- numbers -------------------------------------------------------------------------------------------------------------------------
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const mod = (a, n) => ((a % n) + n) % n;
/// Added to every seed while pictures are made for a seed other than 1 (0: the pictures first made for Pine Ridge Rally).
let SALT = 0;
const hash = (x, y, s) => {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul((s + SALT) | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
/// Smooth noise over a lattice that wraps every `px` by `py` cells: 0 to 1.
function vnoise(x, y, px, py, s) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(mod(xi, px), mod(yi, py), s), b = hash(mod(xi + 1, px), mod(yi, py), s);
  const c = hash(mod(xi, px), mod(yi + 1, py), s), d = hash(mod(xi + 1, px), mod(yi + 1, py), s);
  return mix(mix(a, b, u), mix(c, d, u), v);
}
/// Layered noise that tiles over u, v in 0 to 1: `fx` by `fy` cells in the first layer, each next layer twice as fine and `gain` as strong.
function fbm(u, v, fx, fy, octaves, s, gain = 0.5) {
  let sum = 0, amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const kx = fx << o, ky = fy << o;
    sum += amp * vnoise(u * kx, v * ky, kx, ky, s + o * 17);
    total += amp;
    amp *= gain;
  }
  return sum / total;
}
/// Scattered points, one in each cell of an `fx` by `fy` grid that tiles: the distance (in cells) to the nearest and that point's own number.
function cells(u, v, fx, fy, s) {
  const x = u * fx, y = v * fy, xi = Math.floor(x), yi = Math.floor(y);
  let best = 9, id = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = xi + dx, cy = yi + dy, wx = mod(cx, fx), wy = mod(cy, fy);
    const px = cx + hash(wx, wy, s), py = cy + hash(wx, wy, s + 1);
    const d = Math.hypot(px - x, py - y);
    if (d < best) { best = d; id = hash(wx, wy, s + 2); }
  }
  return [best, id];
}
/// Layered noise spread out to fill 0 to 1 (as it comes, it crowds round one half).
const spread = (n, k = 2.4) => clamp((n - 0.5) * k + 0.5);
const toSrgb = (v) => { v = clamp(v); return Math.round((v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055) * 255); };

function png(W, H, rgba) {
  const stride = W * 4, raw = Buffer.alloc(H * (stride + 1));
  for (let y = 0; y < H; y++) Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  const chunk = (t, d) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(d.length);
    const td = Buffer.concat([Buffer.from(t), d]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/// A base picture: `at(u, v)` gives [r, g, b, a] as multipliers in linear light (1: no change). Returns the mean of r, g, b.
function base(name, W, H, at) {
  const px = new Uint8Array(W * H * 4), mean = [0, 0, 0];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = at((x + 0.5) / W, (y + 0.5) / H, x, y), k = (y * W + x) * 4;
    for (let i = 0; i < 3; i++) { px[k + i] = toSrgb(c[i]); mean[i] += clamp(c[i]); }
    px[k + 3] = Math.round(clamp(c[3] ?? 1) * 255);
  }
  EMIT(name, png(W, H, px), W, H, px);
  return mean.map((m) => m / (W * H));
}

/// A detail picture from a field of multipliers (Float32Array of r, g, b per texel, 1: no change): stored as half (128 is 1).
function detail(name, N, field) {
  const px = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    for (let c = 0; c < 3; c++) px[i * 4 + c] = Math.round(clamp(field[i * 3 + c] * 0.5) * 255);
    px[i * 4 + 3] = 255;
  }
  EMIT(name, png(N, N, px), N, N, px);
}
/// A field of ones to stamp on; `stamp` multiplies a soft-edged shape into it, wrapping at the edges.
function field(N) { return new Float32Array(N * N * 3).fill(1); }
function stroke(f, N, x0, y0, x1, y1, width, rgb, strength) {
  const len = Math.hypot(x1 - x0, y1 - y0), r = width / 2 + 1;
  const [ax, bx] = [Math.floor(Math.min(x0, x1) - r), Math.ceil(Math.max(x0, x1) + r)], [ay, by] = [Math.floor(Math.min(y0, y1) - r), Math.ceil(Math.max(y0, y1) + r)];
  for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
    const t = clamp(((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / (len * len || 1));
    const d = Math.hypot(x - (x0 + (x1 - x0) * t), y - (y0 + (y1 - y0) * t));
    // (thinner towards the far end, like a blade or a crack)
    const cover = clamp(width / 2 * (1 - 0.6 * t) + 0.5 - d) * strength;
    if (cover <= 0) continue;
    const k = (mod(y, N) * N + mod(x, N)) * 3;
    for (let c = 0; c < 3; c++) f[k + c] = mix(f[k + c], f[k + c] * rgb[c], cover);
  }
}
function blob(f, N, cx, cy, rx, ry, angle, rgb, strength) {
  const r = Math.max(rx, ry) + 1, ca = Math.cos(angle), sa = Math.sin(angle);
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
    const dx = x - cx, dy = y - cy, a = (dx * ca + dy * sa) / rx, b = (-dx * sa + dy * ca) / ry;
    const cover = clamp((1 - Math.hypot(a, b)) * Math.min(rx, ry)) * strength;
    if (cover <= 0) continue;
    const k = (mod(y, N) * N + mod(x, N)) * 3;
    for (let c = 0; c < 3; c++) f[k + c] = mix(f[k + c], f[k + c] * rgb[c], cover);
  }
}
/// A fixed pseudo-random sequence.
function rng(seed) { let s = (seed + SALT) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
/// Rescales a field so that each channel averages 1 (a detail picture must not change the colour far away).
function level(f) {
  const n = f.length / 3;
  for (let c = 0; c < 3; c++) {
    let m = 0;
    for (let i = 0; i < n; i++) m += f[i * 3 + c];
    m /= n;
    for (let i = 0; i < n; i++) f[i * 3 + c] /= m;
  }
  return f;
}

// ---- the ground: base pictures, 64 m across ---------------------------------------------------------------------------------------
const G = 512;
const BASES = {
  ground_grass: () => {
  // grass: lush, dry and dark patches, mottled, with a few bare spots of earth
  return base("ground_grass", G, G, (u, v) => {
    const big = spread(fbm(u, v, 4, 4, 4, 11)), mid = spread(fbm(u, v, 14, 14, 3, 23)), fine = spread(fbm(u, v, 48, 48, 2, 31), 2);
    const dry = smooth(0.52, 0.8, big + (mid - 0.5) * 0.45), dark = smooth(0.48, 0.2, big + (mid - 0.5) * 0.4);
    let c = [0.8, 0.92, 0.74];
    c = c.map((x, i) => mix(x, [1.0, 0.94, 0.56][i], dry * 0.8));
    c = c.map((x, i) => mix(x, [0.5, 0.7, 0.5][i], dark * 0.8));
    const [d] = cells(u, v, 22, 22, 41);
    const bare = smooth(0.24, 0.08, d) * smooth(0.5, 0.75, spread(fbm(u, v, 6, 6, 2, 51)));
    c = c.map((x, i) => mix(x, [0.98, 0.76, 0.5][i], bare * 0.85));
    const shade = 0.78 + 0.22 * mid + (fine - 0.5) * 0.16;
    return [c[0] * shade, c[1] * shade, c[2] * shade, 1];
  });
  },
  ground_autumn: () => {
  // autumn: drifts of fallen leaves (orange, rust, yellow) over tired grass
  return base("ground_autumn", G, G, (u, v) => {
    const big = spread(fbm(u, v, 4, 4, 4, 61)), mid = spread(fbm(u, v, 14, 14, 3, 67)), fine = spread(fbm(u, v, 56, 56, 2, 71), 2);
    const leaves = smooth(0.35, 0.7, big + (mid - 0.5) * 0.6), rust = smooth(0.35, 0.75, spread(fbm(u, v, 6, 6, 3, 73)));
    let c = [0.78, 0.95, 0.7];
    const leaf = [mix(1.0, 0.85, rust), mix(0.72, 0.5, rust), mix(0.42, 0.34, rust)];
    c = c.map((x, i) => mix(x, leaf[i], leaves * 0.9));
    const shade = 0.76 + 0.24 * mid + (fine - 0.5) * 0.18;
    return [c[0] * shade, c[1] * shade, c[2] * shade, 1];
  });
  },
  ground_sand: () => {
  // sand: long wind ripples, pale drifts and darker stony ground
  return base("ground_sand", G, G, (u, v) => {
    const big = spread(fbm(u, v, 4, 4, 4, 81)), mid = spread(fbm(u, v, 10, 10, 3, 83)), fine = spread(fbm(u, v, 64, 64, 2, 89), 2);
    const warp = fbm(u, v, 4, 4, 3, 91) * 2.2;
    const ripple = 0.5 + 0.5 * Math.sin((u * 3 + v * 44 + warp) * Math.PI * 2);
    const stony = smooth(0.55, 0.85, big + (mid - 0.5) * 0.5);
    let c = [1.0, 0.97, 0.9];
    c = c.map((x, i) => mix(x, [0.72, 0.62, 0.56][i], stony * 0.85));
    const shade = 0.8 + 0.1 * mid + 0.1 * ripple * (1 - stony) + (fine - 0.5) * 0.1;
    return [c[0] * shade, c[1] * shade, c[2] * shade, 1];
  });
  },
  ground_snow: () => {
  // snow: soft drifts with blue hollows, streaked by the wind
  return base("ground_snow", G, G, (u, v) => {
    const big = spread(fbm(u, v, 4, 4, 4, 101)), mid = spread(fbm(u, v, 10, 10, 3, 103)), streak = spread(fbm(u, v, 6, 48, 3, 107)), fine = spread(fbm(u, v, 64, 64, 2, 109), 2);
    const hollow = smooth(0.6, 0.2, big * 0.6 + mid * 0.4);
    const shade = 0.9 + 0.1 * mid - 0.07 * (1 - streak) + (fine - 0.5) * 0.06;
    return [mix(1, 0.72, hollow) * shade, mix(1, 0.83, hollow) * shade, mix(1, 0.98, hollow) * Math.min(1, shade + 0.03), 1];
  });
  },
};

// ---- the ground: detail pictures, 4 m across ---------------------------------------------------------------------------------------
const D = 512;
const DETAILS = {
  grass_detail: () => {
    // grass: thousands of short blades lying every way, lighter and darker, some yellowed
    const f = field(D), r = rng(7);
    for (let i = 0; i < D * D; i++) { const n = spread(fbm((i % D + 0.5) / D, (Math.floor(i / D) + 0.5) / D, 10, 10, 4, 201)); for (let c = 0; c < 3; c++) f[i * 3 + c] = 0.7 + 0.6 * n; }
    // (tufts: the blades come in clumps round a few hundred points, each clump its own shade)
    for (let t = 0; t < 520; t++) {
      const cx = r() * D, cy = r() * D, spreadOut = 5 + r() * 16, shade = 0.75 + r() * 0.6, yellow = r() < 0.2;
      for (let i = 0; i < 16; i++) {
        const x = cx + (r() - 0.5) * spreadOut * 2, y = cy + (r() - 0.5) * spreadOut * 2, a = r() * Math.PI * 2, len = 7 + r() * 15;
        const tone = shade * (r() < 0.45 ? 0.6 + r() * 0.2 : 1.2 + r() * 0.35);
        stroke(f, D, x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, 1.8 + r() * 1.6, yellow ? [tone * 1.15, tone, tone * 0.66] : [tone * 0.92, tone, tone * 0.86], 0.8);
      }
    }
    detail("grass_detail", D, level(f));
  },
  leaves_detail: () => {
    // fallen leaves on grass: small ovals in orange, rust, yellow and brown, lying every way
    const f = field(D), r = rng(19);
    for (let i = 0; i < D * D; i++) { const n = fbm((i % D + 0.5) / D, (Math.floor(i / D) + 0.5) / D, 24, 24, 3, 211); for (let c = 0; c < 3; c++) f[i * 3 + c] = 0.84 + 0.32 * n; }
    for (let i = 0; i < 5000; i++) {
      const x = r() * D, y = r() * D, a = r() * Math.PI * 2, len = 7 + r() * 14, tone = r() < 0.5 ? 0.66 + r() * 0.2 : 1.15 + r() * 0.25;
      stroke(f, D, x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, 1.6 + r() * 1.2, [tone, tone, tone * 0.9], 0.7);
    }
    const LEAVES = [[1.55, 0.9, 0.5], [1.35, 0.62, 0.42], [1.5, 1.2, 0.5], [0.9, 0.62, 0.45], [1.25, 0.78, 0.4]];
    for (let i = 0; i < 2600; i++) {
      const x = r() * D, y = r() * D, a = r() * Math.PI, size = 4 + r() * 5, k = LEAVES[Math.floor(r() * LEAVES.length)], t = 0.85 + r() * 0.3;
      blob(f, D, x, y, size, size * (0.45 + r() * 0.2), a, k.map((c) => c * t), 0.9);
      // (the midrib: a darker line along the leaf)
      stroke(f, D, x - Math.cos(a) * size * 0.8, y - Math.sin(a) * size * 0.8, x + Math.cos(a) * size * 0.8, y + Math.sin(a) * size * 0.8, 1, [0.8, 0.8, 0.8], 0.5);
    }
    detail("leaves_detail", D, level(f));
  },
  sand_detail: () => {
    // sand: grains, small ripples and a scatter of pebbles with a shadow under each
    const f = field(D), r = rng(31);
    for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
      const u = (x + 0.5) / D, v = (y + 0.5) / D;
      const grain = hash(x, y, 301) * 0.5 + hash(x >> 1, y >> 1, 302) * 0.5;
      const warp = fbm(u, v, 6, 6, 2, 303) * 1.2;
      const ripple = Math.sin((u * 2 + v * 34 + warp) * Math.PI * 2);
      const n = 0.9 + 0.2 * grain + 0.05 * ripple + (fbm(u, v, 16, 16, 3, 304) - 0.5) * 0.2;
      f[(y * D + x) * 3] = n; f[(y * D + x) * 3 + 1] = n; f[(y * D + x) * 3 + 2] = n;
    }
    for (let i = 0; i < 520; i++) {
      const x = r() * D, y = r() * D, size = 1.5 + r() * r() * 6, a = r() * Math.PI, tone = r() < 0.6 ? 0.6 + r() * 0.2 : 1.2 + r() * 0.2;
      blob(f, D, x + size * 0.5, y + size * 0.6, size, size * 0.8, a, [0.62, 0.62, 0.66], 0.6);
      blob(f, D, x, y, size, size * (0.6 + r() * 0.3), a, [tone, tone * 0.97, tone * 0.92], 0.95);
    }
    detail("sand_detail", D, level(f));
  },
  snow_detail: () => {
    // snow: soft small bumps with blue in the dimples, and crystals that catch the light
    const f = field(D), r = rng(43);
    for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
      const u = (x + 0.5) / D, v = (y + 0.5) / D;
      const bump = fbm(u, v, 20, 20, 4, 401), dimple = smooth(0.5, 0.3, bump), grain = hash(x, y, 402);
      const n = 0.93 + 0.14 * bump + (grain - 0.5) * 0.05;
      f[(y * D + x) * 3] = n * (1 - 0.07 * dimple); f[(y * D + x) * 3 + 1] = n * (1 - 0.035 * dimple); f[(y * D + x) * 3 + 2] = n;
    }
    for (let i = 0; i < 1500; i++) blob(f, D, r() * D, r() * D, 0.9 + r() * 0.8, 0.9 + r() * 0.8, 0, [1.5, 1.5, 1.55], 0.9);
    detail("snow_detail", D, level(f));
  },
  road_grain: () => {
    // a road's grain, shared by every kind of road: grit, a few paler stones and dark pits
    const f = field(D), r = rng(57);
    for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
      const u = (x + 0.5) / D, v = (y + 0.5) / D;
      const grit = hash(x, y, 501) * 0.55 + hash(x >> 1, y >> 1, 502) * 0.45;
      const n = 0.86 + 0.28 * grit + (fbm(u, v, 12, 12, 3, 503) - 0.5) * 0.16;
      f[(y * D + x) * 3] = n; f[(y * D + x) * 3 + 1] = n; f[(y * D + x) * 3 + 2] = n;
    }
    for (let i = 0; i < 2600; i++) {
      const tone = r() < 0.55 ? 1.25 + r() * 0.3 : 0.55 + r() * 0.2, size = 1 + r() * r() * 2.6;
      blob(f, D, r() * D, r() * D, size, size * (0.6 + r() * 0.4), r() * Math.PI, [tone, tone, tone], 0.9);
    }
    detail("road_grain", D, level(f));
  },
};

// ---- the roads: one sheet, 1024 x 1024 -----------------------------------------------------------------------------------------------
// Along the sheet (v) is along the road, 64 m, and it repeats. Across (u) there is a column 192 texels wide for each kind of road, which
// is the whole road from edge to edge (12 m: 6.25 cm a texel, as along), then two narrow strips of paint. scripts/lib/trackgen.mjs
// (ROAD_SHEET) lays the ribbon's UVs to match. The road's colours are the ribbon's vertex colours: the sheet only darkens them.
const ROAD = { size: 1024, column: 192, kinds: ["road_asphalt", "road_dirt", "road_gravel", "road_snow", "road_sand"], paint: 960, strip: 32, metres: 64, across: 12 };
// asphalt's colours (trackgen's ROAD_COLOURS): a gap in a painted line shows the road, so the sheet there is road / paint
const ASPHALT_OVER_PAINT = 0.2667 / 0.9451;

/// A wandering line along the road that closes after 64 m: the offset (metres) at `s` metres.
const wander = (s, a, b, phase) => a * Math.sin((s / ROAD.metres) * Math.PI * 2 + phase) + b * Math.sin((s / ROAD.metres) * Math.PI * 6 + phase * 2.3);

// (cracks, sealed joints and skid marks are drawn first into a mask of the asphalt column: 1 where the tar is)
let tar, skid;
/// The road's cracks, sealed joints and skid marks, drawn into masks of the asphalt column (1 where the tar is). `o` are surface_make's road options.
function marks(o) {
  tar = new Float32Array(ROAD.column * ROAD.size); skid = new Float32Array(ROAD.column * ROAD.size);
  const put = (m, x, y, v) => { if (x >= 0 && x < ROAD.column) { const k = mod(Math.round(y), ROAD.size) * ROAD.column + Math.round(x); m[k] = Math.max(m[k], v); } };
  const line = (m, x0, y0, x1, y1, v) => { const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) * 2; for (let i = 0; i <= n; i++) put(m, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, typeof v === "function" ? v(i / n) : v); };
  const r = rng(73), M = (m) => (m / ROAD.across) * ROAD.column + ROAD.column / 2, S = (s) => (s / ROAD.metres) * ROAD.size;
  // cracks: a wandering walk, mostly along the road, with a branch or two
  for (let c = 0; c < o.cracks; c++) {
    let x = M(-3.6 + r() * 7.2), y = r() * ROAD.size, heading = (r() - 0.5) * 0.8;
    const steps = 30 + Math.floor(r() * 60);
    for (let i = 0; i < steps; i++) {
      heading = clamp(heading + (r() - 0.5) * 0.9, -1.2, 1.2);
      const nx = x + Math.sin(heading) * 3, ny = y + Math.cos(heading) * 3;
      if (Math.abs(nx - ROAD.column / 2) > M(4.1) - ROAD.column / 2) break;
      line(tar, x, y, nx, ny, 0.75);
      if (r() < 0.06) line(tar, x, y, x + (r() - 0.5) * 30, y + r() * 14, 0.6);
      x = nx; y = ny;
    }
  }
  // two patches of newer tarmac, sealed round their edges (the patches themselves are in asphalt() below)
  for (const [x0, x1, s0, s1] of PATCHES().slice(0, o.patches)) {
    line(tar, M(x0), S(s0), M(x1), S(s0), 0.85); line(tar, M(x0), S(s1), M(x1), S(s1), 0.85);
    line(tar, M(x0), S(s0), M(x0), S(s1), 0.85); line(tar, M(x1), S(s0), M(x1), S(s1), 0.85);
  }
  // skid marks: pairs of dark stripes that fade in and out, drifting across the lane
  for (const [x, s, len, drift] of [[-1.9, 6, 13, 0.7], [1.2, 30, 10, -0.9], [-0.4, 47, 15, 1.4]].slice(0, o.skids)) {
    for (const side of [-0.8, 0.8]) for (const w of [-1, 0, 1]) line(skid, M(x + side) + w, S(s), M(x + side + drift) + w, S(s + len), (t) => Math.sin(t * Math.PI) ** 0.7 * (w === 0 ? 1 : 0.6));
  }
}
function PATCHES() { return [[-3.7, -1.1, 14, 19.5], [0.6, 3.9, 43, 46.2]]; }

/// The ragged outer edge every road has: how much of the surface is there (alpha), `x` metres from the middle. Solid to `from`, gone by 6 m,
/// broken up by noise so that grit and tufts straggle out over the ground instead of ending on a ruled line.
function edge(x, u, v, from, seed) {
  const t = clamp((Math.abs(x) - from) / (6 - from));
  if (t <= 0) return 1;
  const n = fbm(u, v, 40, 256, 3, seed) * 0.65 + fbm(u, v, 10, 64, 2, seed + 5) * 0.35;
  return clamp(1.15 - t * 1.5 + (n - 0.5) * 1.5);
}

function asphalt(x, s, u, v, cx, cy) {
  const ax = Math.abs(x);
  let m = 0.84 + 0.12 * fbm(u, v, 3, 14, 4, 601) + (fbm(u, v, 24, 128, 2, 603) - 0.5) * 0.08;
  // the racing line: rubber laid down where the cars run, and a fainter second line
  m *= 1 - 0.17 * WEAR.line * Math.exp(-(((x - wander(s, 1.3, 0.45, 0.4)) / 1.25) ** 2)) * (0.75 + 0.25 * fbm(u, v, 2, 20, 2, 605));
  m *= 1 - 0.07 * WEAR.line * Math.exp(-(((x - wander(s, -1.7, 0.5, 2.0)) / 0.9) ** 2));
  for (const [x0, x1, s0, s1] of PATCHES().slice(0, WEAR.patches)) if (x > x0 && x < x1 && s > s0 && s < s1) m *= 0.84;
  m *= 1 - 0.42 * tar[cy * ROAD.column + cx] - 0.22 * skid[cy * ROAD.column + cx];
  // the shoulder outside the painted line: paler, dusty, less worn
  const shoulder = smooth(4.25, 4.6, ax);
  let c = [m, m, m].map((k, i) => mix(k, [0.98, 0.95, 0.88][i] * (0.86 + 0.14 * fbm(u, v, 30, 160, 2, 607)), shoulder * 0.8));
  // the verge: gravel and grit, breaking up towards the grass
  if (ax > 5) {
    const grit = 0.72 + 0.28 * fbm(u, v, 48, 256, 2, 609), [d, id] = cells(u, v, 64, 340, 611);
    const stone = d < 0.32 ? 0.8 + id * 0.25 : 1;
    c = [grit * stone, grit * stone, grit * stone];
  }
  return [...c, edge(x, u, v, 5.05, 613)];
}

/// A loose road (dirt, gravel, snow, sand): two wheel ruts that wander a little, a crown between them, loose stuff thrown to the sides.
function loose(x, s, u, v, k) {
  const ax = Math.abs(x), c = wander(s, 0.22, 0.1, k.seed);
  const mid = fbm(u, v, 4, 20, 3, k.seed + 1), fine = fbm(u, v, 28, 150, 2, k.seed + 2);
  const rut = Math.max(Math.exp(-(((x - c - 1.45) / k.rutWidth) ** 2)), Math.exp(-(((x - c + 1.45) / k.rutWidth) ** 2))) * (0.7 + 0.3 * fbm(u, v, 2, 24, 2, k.seed + 3));
  let m = k.level + k.mottle * (mid - 0.5) + (fine - 0.5) * k.grainy;
  // (washboard: small waves across the ruts where wheels have hammered the surface)
  m *= 1 - k.rut * rut * (1 + k.washboard * Math.sin((s / 0.55) * Math.PI * 2 + x * 2));
  // stones: thick on the crown and at the sides, pressed away in the ruts
  const [d, id] = cells(u, v, 56, 300, k.seed + 4);
  const where = clamp(1 - rut * 1.3) * (0.45 + 0.55 * smooth(2.6, 4.4, ax) + 0.3 * Math.exp(-((x - c) ** 2) / 0.3));
  if (d < 0.2 + 0.16 * id && id < k.stones * where * 1.6) m *= id * 7 % 1 < 0.6 ? k.stoneDark : k.stoneLight;
  if (k.ripple) m *= 1 + k.ripple * Math.sin((u * 1.5 + v * 46 + fbm(u, v, 3, 12, 2, k.seed + 6) * 1.5) * Math.PI * 2) * (1 - rut);
  let rgb = [m, m, m].map((q, i) => q * mix(1, k.rutTint[i], rut));
  // the loose stuff along the edges is rougher
  const side = smooth(3.8, 5.2, ax);
  rgb = rgb.map((q) => q * (1 - side * 0.14 * (1 - fbm(u, v, 36, 200, 2, k.seed + 7))));
  return [...rgb.map((q) => clamp(q)), edge(x, u, v, 4.9, k.seed + 8)];
}
const LOOSE = {
  road_dirt: { seed: 700, level: 0.9, mottle: 0.16, grainy: 0.1, rut: 0.2, rutWidth: 0.42, rutTint: [0.97, 0.95, 0.9], washboard: 0.25, stones: 0.22, stoneDark: 0.74, stoneLight: 1.12 },
  road_gravel: { seed: 800, level: 0.86, mottle: 0.14, grainy: 0.14, rut: 0.24, rutWidth: 0.4, rutTint: [0.98, 0.96, 0.93], washboard: 0.3, stones: 0.5, stoneDark: 0.68, stoneLight: 1.2 },
  road_snow: { seed: 900, level: 0.95, mottle: 0.07, grainy: 0.04, rut: 0.15, rutWidth: 0.36, rutTint: [0.92, 0.95, 1.0], washboard: 0.4, stones: 0.1, stoneDark: 0.9, stoneLight: 1.05 },
  road_sand: { seed: 1000, level: 0.93, mottle: 0.09, grainy: 0.07, rut: 0.13, rutWidth: 0.48, rutTint: [0.98, 0.96, 0.92], washboard: 0.1, stones: 0.1, stoneDark: 0.8, stoneLight: 1.08, ripple: 0.035 },
};

/// The road sheet. `o`: { line (how dark the racing line is, 1 as first made), cracks, patches, skids }.
function roadSheet(o) {
  WEAR = o;
  marks(o);
  return base("road", ROAD.size, ROAD.size, (u, v, px, py) => {
  const s = v * ROAD.metres;
  if (px >= ROAD.paint) {
    // paint: worn through in chips, where the road shows. The first strip is a solid line, the second a broken one (3 m on, 5 m off).
    const worn = fbm(u * 8, v, 16, 420, 3, 1101) * 0.6 + fbm(u * 8, v, 4, 60, 2, 1103) * 0.4;
    const chipped = smooth(0.56, 0.62, worn), dashes = px >= ROAD.paint + ROAD.strip;
    const on = dashes ? smooth(0, 0.12, s % 8) * smooth(3, 2.88, s % 8) : 1;
    const paint = mix(0.94, ASPHALT_OVER_PAINT * 1.15, chipped * 0.85) * (0.92 + 0.08 * fbm(u * 8, v, 8, 200, 2, 1105));
    const m = mix(ASPHALT_OVER_PAINT * 0.9, paint, on);
    return [m, m, m, 1];
  }
  const column = Math.floor(px / ROAD.column), cx = px - column * ROAD.column, kind = ROAD.kinds[column];
  const x = ((cx + 0.5) / ROAD.column - 0.5) * ROAD.across;
  // (the noise is asked for in the column's own coordinates, so that every column is its own pattern and tiles along the road)
  const cu = (cx + 0.5) / ROAD.column;
  return kind === "road_asphalt" ? asphalt(x, s, cu, v, cx, py) : loose(x, s, cu, v, LOOSE[kind]);
});
}
let WEAR = { line: 1, patches: 2 };

export const SURFACES = [...Object.keys(BASES), ...Object.keys(DETAILS), "road"];
export const ROAD_SHEET = ROAD;

/// Makes the pictures named (all of SURFACES when none), handing each to `put(name, pngBytes, width, height, rgba)`. `seed` 1 is the pictures first made;
/// `road`: { line, cracks, patches, skids }. Returns the base pictures' mean colours (for the ground's tint: means.json).
export function makeSurfaces(names = SURFACES, { seed = 1, road = {} } = {}, put) {
  const means = {};
  EMIT = put;
  SALT = seed === 1 ? 0 : Math.imul(seed, 2654435761) >>> 0;
  try {
    for (const name of names) {
      if (BASES[name]) means[name] = BASES[name]();
      else if (DETAILS[name]) DETAILS[name]();
      else if (name === "road") roadSheet({ line: road.line ?? 1, cracks: road.cracks ?? 5, patches: road.patches ?? 2, skids: road.skids ?? 3 });
      else throw new Error(`there is no surface "${name}"; the surfaces are ${SURFACES.join(", ")}`);
    }
  } finally {
    SALT = 0;
    EMIT = () => {};
  }
  return Object.fromEntries(Object.entries(means).map(([k, m]) => [k, m.map((x) => Math.round(x * 1000) / 1000)]));
}
