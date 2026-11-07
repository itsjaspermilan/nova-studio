// Makes a heightmap for `nova.terrain{ heightmap = ... }` from a route: the road's centreline (scripts/lib/trackgen.mjs `centreline`) plus an elevation
// profile along it, with the land around it blended smoothly into rolling hills. Used by the studio's MCP server (the `terrain_write` tool) and
// usable from a script. The picture is a 16-bit grey PNG: black is height 0, white is `height` metres (see crates/nova-runtime/src/heightmap.rs).
//
//   const r = heightmapFromTrack({ control, open: true, profile: [[0, 0], [400, 20], [600, 24], [1000, 4]], maxGrade: 0.12 });
//   r.png (bytes), r.x, r.z, r.size, r.height (metres white stands for), r.cell, r.report
//
// `profile` is a list of [distance along the route in metres, road elevation in metres]: the road climbs 20 m over its first 400 m, crests at 24 m, drops
// to 4. Between the points the elevation is a smooth monotone curve (no overshoot, so a point that is a crest stays the crest); a closed circuit
// wraps round. The grade (rise over run) is then held to `maxGrade` and the profile smoothed. Across the road the ground is level (no camber), out to
// `flat` metres from the centreline, then it blends over `blend` metres into the surrounding hills (value noise, up to `hills` metres tall).

import { deflateSync } from "node:zlib";
import { centreline, rng } from "./trackgen.mjs";

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/// A 16-bit greyscale PNG from `values` (0 to 65535), row by row.
export function png16(width, rows, values) {
  const raw = Buffer.alloc(rows * (1 + width * 2));
  for (let j = 0; j < rows; j++) {
    const o = j * (1 + width * 2);
    for (let i = 0; i < width; i++) raw.writeUInt16BE(values[j * width + i], o + 1 + i * 2);
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(rows, 4);
  head[8] = 16; // bit depth
  head[9] = 0; // greyscale
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/// Monotone cubic (Fritsch-Carlson) through points sorted by x: smooth, and it never rises above a crest point or dips below a trough.
function pchip(points) {
  const n = points.length;
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i]);
  // the ends: one-sided slopes that keep the sign
  const end = (m0, d0, d1) => {
    let v = (3 * d0 - d1) / 2;
    if (Math.sign(v) !== Math.sign(d0)) v = 0;
    else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(v) > 3 * Math.abs(d0)) v = 3 * d0;
    return v;
  };
  if (n > 2) {
    m[0] = end(m[0], d[0], d[1]);
    m[n - 1] = end(m[n - 1], d[n - 2], d[n - 3]);
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

/// The road's elevation at each centreline point, from the profile, with the grade bounded and the bumps smoothed.
export function elevations(profile, count, spacing, open, maxGrade, smoothMetres = 30) {
  let pts = profile.map((p) => (Array.isArray(p) ? [p[0], p[1]] : [p.at ?? p.distance, p.height ?? p.elevation])).sort((a, b) => a[0] - b[0]);
  if (!pts.length || pts.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) throw new Error("profile needs [distance, height] pairs of numbers");
  const length = count * spacing;
  if (pts.length === 1) pts = [[0, pts[0][1]], [length, pts[0][1]]];
  if (!open) {
    // a loop: the profile repeats every `length`, so copy it a lap either side (and join the ends at the start if the profile does not)
    const base = pts.filter((p) => p[0] >= 0 && p[0] < length);
    pts = [...base.map((p) => [p[0] - length, p[1]]), ...base, ...base.map((p) => [p[0] + length, p[1]])];
    if (base.length === 1) pts = [[-length, base[0][1]], [0, base[0][1]], [length, base[0][1]]];
  }
  const f = pchip(pts);
  let h = Array.from({ length: count }, (_, i) => f(i * spacing));
  const step = maxGrade * spacing;
  const at = (i) => (open ? Math.min(count - 1, Math.max(0, i)) : (i + count) % count);
  const limit = () => {
    // a Lipschitz projection: pull each point to within `step` of its neighbours, both ways, until nothing moves (a loop needs a few laps)
    for (let pass = 0; pass < (open ? 4 : 40); pass++) {
      let moved = false;
      for (let i = 1; i < count; i++) {
        const lo = h[i - 1] - step, hi = h[i - 1] + step, v = Math.min(hi, Math.max(lo, h[i]));
        if (v !== h[i]) { h[i] = v; moved = true; }
      }
      for (let i = count - 2; i >= 0; i--) {
        const lo = h[i + 1] - step, hi = h[i + 1] + step, v = Math.min(hi, Math.max(lo, h[i]));
        if (v !== h[i]) { h[i] = v; moved = true; }
      }
      if (!open) {
        const v = Math.min(h[0] + step, Math.max(h[0] - step, h[count - 1]));
        if (v !== h[count - 1]) { h[count - 1] = v; moved = true; }
      }
      if (!moved) break;
    }
  };
  limit();
  // smooth with a moving average (a few passes of a box ~ a Gaussian), then bound again: averaging only ever lowers the grade
  const radius = Math.max(1, Math.round(smoothMetres / spacing / 2));
  for (let pass = 0; pass < 3; pass++) {
    const next = h.map((_, i) => {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += h[at(i + k)];
      return sum / (2 * radius + 1);
    });
    h = next;
  }
  limit();
  return h;
}

/// Value noise in 0..1 (smooth, seeded), octaves summed.
function noiseField(seed, wavelength) {
  const rand = rng(seed);
  const size = 256, table = Float32Array.from({ length: size * size }, () => rand());
  const value = (x, z) => {
    const fx = x / wavelength, fz = z / wavelength;
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
    const g = (a, b) => table[(((b % size) + size) % size) * size + (((a % size) + size) % size)];
    const top = g(ix, iz) + (g(ix + 1, iz) - g(ix, iz)) * sx;
    const bottom = g(ix, iz + 1) + (g(ix + 1, iz + 1) - g(ix, iz + 1)) * sx;
    return top + (bottom - top) * sz;
  };
  return (x, z) => (value(x, z) * 0.6 + value(x * 2.1 + 17, z * 2.1 - 9) * 0.28 + value(x * 4.3 - 5, z * 4.3 + 31) * 0.12);
}

export function heightmapFromTrack(spec) {
  const open = !!spec.open;
  const spacing = 5;
  const line = centreline(spec.control, spacing, open);
  const maxGrade = spec.maxGrade ?? 0.12;
  if (!(maxGrade > 0 && maxGrade < 1)) throw new Error("maxGrade is a fraction between 0 and 1 (0.12 is 12 %)");
  const profile = spec.profile ?? [[0, 0]];
  const road = elevations(profile, line.length, spacing, open, maxGrade);
  const flat = spec.flat ?? 9, blend = spec.blend ?? 80;
  const hills = spec.hills ?? 12, wavelength = spec.hillWavelength ?? 220;
  const margin = spec.margin ?? 150;
  if (!(flat >= 0 && blend > 0 && hills >= 0 && wavelength >= 20 && margin >= 0)) throw new Error("flat, blend, hills, hillWavelength and margin must be positive");

  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of line) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  x0 -= margin; z0 -= margin; x1 += margin; z1 += margin;
  let cell = spec.cell ?? 4;
  const maxSide = 4096;
  cell = Math.max(cell, (Math.max(x1 - x0, z1 - z0)) / (maxSide - 1));
  const width = Math.floor((x1 - x0) / cell) + 1, rows = Math.floor((z1 - z0) / cell) + 1;
  const reach = flat + blend;

  // for every cell near the road: the distance to the nearest centreline segment, and the road's elevation there
  const dist = new Float32Array(width * rows).fill(Infinity);
  const level = new Float32Array(width * rows);
  const segments = open ? line.length - 1 : line.length;
  for (let s = 0; s < segments; s++) {
    const a = line[s], b = line[(s + 1) % line.length];
    const ha = road[s], hb = road[(s + 1) % line.length];
    const dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz;
    const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - reach - x0) / cell)), i1 = Math.min(width - 1, Math.ceil((Math.max(a.x, b.x) + reach - x0) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - reach - z0) / cell)), j1 = Math.min(rows - 1, Math.ceil((Math.max(a.z, b.z) + reach - z0) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = x0 + i * cell, pz = z0 + j * cell;
      const t = Math.min(1, Math.max(0, ((px - a.x) * dx + (pz - a.z) * dz) / len2));
      const d = Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t));
      if (d < dist[j * width + i]) { dist[j * width + i] = d; level[j * width + i] = ha + (hb - ha) * t; }
    }
  }
  const noise = noiseField(spec.seed ?? 1, wavelength);
  const heights = new Float32Array(width * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < width; i++) {
    const k = j * width + i;
    const base = noise(x0 + i * cell, z0 + j * cell) * hills; // the land with no road in it
    const w = 1 - smoothstep(flat, reach, dist[k]); // 1 on the road, 0 far off
    // the land far from the road follows the road's overall height a little (so a high road does not sit in a hole): no, it stays as it is
    heights[k] = base + (level[k] - base) * w;
  }
  let lo = Infinity, hi = -Infinity;
  for (const v of heights) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const shift = lo < 0 ? -lo : 0; // heights below 0 cannot be written: lift the whole land (the road's elevations all move by `shift`)
  const height = Math.max(hi + shift, 1);
  const values = Uint16Array.from(heights, (v) => Math.round(((v + shift) / height) * 65535));
  // the road's real grade after everything, for the report
  let worst = 0;
  for (let i = 1; i < road.length; i++) worst = Math.max(worst, Math.abs(road[i] - road[i - 1]) / spacing);
  return {
    png: png16(width, rows, values),
    x: Math.round(x0 * 100) / 100,
    z: Math.round(z0 * 100) / 100,
    size: Math.round((width - 1) * cell * 100) / 100,
    cell,
    width,
    rows,
    height: Math.round(height * 1000) / 1000,
    shift,
    report: {
      length: line.length * spacing,
      roadMin: Math.min(...road) + shift,
      roadMax: Math.max(...road) + shift,
      roadStart: road[0] + shift,
      roadEnd: road[road.length - 1] + shift,
      maxGrade: worst,
      // the elevation of the road every 100 m, for checking
      profile: road.filter((_, i) => i % 20 === 0).map((h, i) => [i * 100, Math.round((h + shift) * 10) / 10]),
    },
    road: road.map((h) => h + shift),
    line,
  };
}
