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

/// Designed ground for a small map with several roads (a valley's main road and the lanes off it), level pads (a yard, a house plot),
/// channels cut into it (a creek) and a rim of higher ground at its edges (where the map ends without a wall):
///
///   heightmapFromNetwork({
///     bounds: [x0, z0, x1, z1],                               the map (metres)
///     roads: [{ control, profile, flat, blend }, ...],        each an open route; a road that starts (or ends) on an earlier one takes that
///                                                             road's elevation there, so a lane leaves the main road level with it
///     pads: [{ at: [x, z], radius, height, blend }],          level ground; `height` defaults to the ground there before the pad
///     carve: [{ points, profile, width, bank, depth }],       a channel along a smooth line: its bed follows `profile` ([[d, h], ...]) or lies
///                                                             `depth` under the ground (never rising downstream); `width` of flat bed and
///                                                             banks rising 1 in `bank`
///     rim: { height, width },                                 the land rises `height` metres over the last `width` metres to the edge
///     hills, hillWavelength, cell, seed, maxGrade })
///
/// A channel wins over a road (it is cut through it), so a road that crosses one needs a bridge drawn by the game.
export function heightmapFromNetwork(spec) {
  const spacing = 2.5;
  const maxGrade = spec.maxGrade ?? 0.12;
  if (!(maxGrade > 0 && maxGrade < 1)) throw new Error("maxGrade is a fraction between 0 and 1 (0.12 is 12 %)");
  const roadsIn = spec.roads ?? [];
  if (!Array.isArray(roadsIn) || !roadsIn.length) throw new Error("roads needs at least one road: { control: [[x, z], ...] }");
  const hills = spec.hills ?? 12, wavelength = spec.hillWavelength ?? 220;
  if (!(hills >= 0 && wavelength >= 20)) throw new Error("hills and hillWavelength must be positive (hillWavelength at least 20)");
  const noise = noiseField(spec.seed ?? 1, wavelength);
  const land = (x, z) => noise(x, z) * hills;
  // (a line through two or three points: the catmull spline needs four, so its ends are repeated)
  const lineOf = (pts) => centreline(pts.length < 4 ? [pts[0], ...pts, pts[pts.length - 1]] : pts, spacing, true);
  const roads = [];
  const notes = [];
  roadsIn.forEach((r, k) => {
    if (!Array.isArray(r.control) || r.control.length < 2 || r.control.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))) throw new Error(`roads[${k}].control needs at least two [x, z] points`);
    const line = lineOf(r.control);
    const length = (line.length - 1) * spacing;
    let profile = (r.profile ?? [[0, land(line[0].x, line[0].z)], [length, land(line.at(-1).x, line.at(-1).z)]]).map((p) => [...p]);
    // a lane that leaves an earlier road starts at that road's level (and ends at it, when it ends on one)
    const levelOn = (x, z) => {
      let best = Infinity, h = 0, which = -1;
      roads.forEach((o, n) => o.line.forEach((p, i) => { const d = Math.hypot(p.x - x, p.z - z); if (d < best) { best = d; h = o.elev[i]; which = n; } }));
      return best <= 20 ? { h, which } : null;
    };
    const first = levelOn(line[0].x, line[0].z), last = levelOn(line.at(-1).x, line.at(-1).z);
    if (first) {
      profile = [[0, first.h], ...profile.filter((p) => p[0] > 0)];
      notes.push(`road ${k + 1} leaves road ${first.which + 1} level with it (${Math.round(first.h * 10) / 10} m)`);
    }
    if (last) profile = [...profile.filter((p) => p[0] < length), [length, last.h]];
    const elev = elevations(profile, line.length, spacing, true, maxGrade);
    roads.push({ line, elev, flat: r.flat ?? 6, blend: r.blend ?? 40 });
  });
  let [x0, z0, x1, z1] = Array.isArray(spec.bounds) ? spec.bounds : [];
  if (![x0, z0, x1, z1].every(Number.isFinite)) {
    x0 = z0 = Infinity; x1 = z1 = -Infinity;
    for (const r of roads) for (const p of r.line) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    x0 -= 120; z0 -= 120; x1 += 120; z1 += 120;
  }
  const cell = Math.max(spec.cell ?? 2, Math.max(x1 - x0, z1 - z0) / 4095);
  const width = Math.floor((x1 - x0) / cell) + 1, rows = Math.floor((z1 - z0) / cell) + 1;
  const heights = new Float32Array(width * rows);
  const weight = new Float32Array(width * rows); // how firmly a road or a pad holds the ground at each sample (the firmest wins)
  const target = new Float32Array(width * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < width; i++) heights[j * width + i] = land(x0 + i * cell, z0 + j * cell);
  const near = (ax, az, bx, bz, reach, fn) => {
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - x0) / cell)), i1 = Math.min(width - 1, Math.ceil((Math.max(ax, bx) + reach - x0) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - reach - z0) / cell)), j1 = Math.min(rows - 1, Math.ceil((Math.max(az, bz) + reach - z0) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * width + i, x0 + i * cell, z0 + j * cell);
  };
  // (where two features meet, a lane and a yard, their levels are blended by their weights squared, so the ground runs smoothly from
  // one to the other instead of stepping where the firmer one takes over)
  const wsum = new Float32Array(width * rows);
  const hold = (k, w, level) => {
    if (w <= 0) return;
    const q = w * w;
    target[k] = (target[k] * wsum[k] + level * q) / (wsum[k] + q);
    wsum[k] += q;
    if (w > weight[k]) weight[k] = w;
  };
  // (the distance from a sample to a segment, and how far along it)
  const along = (px, pz, a, b) => {
    const dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz || 1;
    const t = Math.min(1, Math.max(0, ((px - a.x) * dx + (pz - a.z) * dz) / len2));
    return [Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t)), t];
  };
  for (const r of roads) {
    const reach = r.flat + r.blend;
    for (let s = 0; s + 1 < r.line.length; s++) {
      const a = r.line[s], b = r.line[s + 1], ha = r.elev[s], hb = r.elev[s + 1];
      near(a.x, a.z, b.x, b.z, reach, (k, px, pz) => {
        const [d, t] = along(px, pz, a, b);
        hold(k, 1 - smoothstep(r.flat, reach, d), ha + (hb - ha) * t);
      });
    }
  }
  const padLevels = [];
  for (const [n, p] of (spec.pads ?? []).entries()) {
    const [px0, pz0] = Array.isArray(p.at) ? p.at : [];
    if (!Number.isFinite(px0) || !Number.isFinite(pz0)) throw new Error(`pads[${n}].at is [x, z]`);
    const radius = p.radius ?? 8, blend = p.blend ?? 14;
    // (a yard beside a road is level with the road there; one out on its own keeps the ground's height)
    let level = p.height;
    if (level === undefined) {
      let best = Infinity;
      for (const r of roads) r.line.forEach((q, i) => { const d = Math.hypot(q.x - px0, q.z - pz0); if (d < best) { best = d; level = r.elev[i]; } });
      if (best > radius + 25) {
        const fi = Math.min(width - 1, Math.max(0, Math.round((px0 - x0) / cell))), fj = Math.min(rows - 1, Math.max(0, Math.round((pz0 - z0) / cell)));
        const k0 = fj * width + fi;
        level = heights[k0] + (target[k0] - heights[k0]) * weight[k0];
      }
    }
    padLevels.push(level);
    near(px0, pz0, px0, pz0, radius + blend, (k, x, z) => hold(k, 1 - smoothstep(radius, radius + blend, Math.hypot(x - px0, z - pz0)), level));
  }
  for (let k = 0; k < heights.length; k++) heights[k] = heights[k] + (target[k] - heights[k]) * weight[k];
  if (spec.rim) {
    const rh = spec.rim.height ?? 14, rw = spec.rim.width ?? 40;
    // (`edges`: which of the map's edges rise, "x0", "x1", "z0", "z1"; all four when left out: a view out over a valley keeps its side low)
    const edges = new Set(spec.rim.edges ?? ["x0", "x1", "z0", "z1"]);
    for (let j = 0; j < rows; j++) for (let i = 0; i < width; i++) {
      const edge = Math.min(edges.has("x0") ? i * cell : Infinity, edges.has("x1") ? x1 - x0 - i * cell : Infinity, edges.has("z0") ? j * cell : Infinity, edges.has("z1") ? z1 - z0 - j * cell : Infinity);
      heights[j * width + i] += rh * (1 - smoothstep(0, rw, edge));
    }
  }
  // channels last: they cut through everything
  const carved = [];
  for (const [n, c] of (spec.carve ?? []).entries()) {
    if (!Array.isArray(c.points) || c.points.length < 2) throw new Error(`carve[${n}].points needs at least two [x, z] points`);
    const line = lineOf(c.points);
    const depth = c.depth ?? 3;
    const at = (x, z) => {
      const i = Math.min(width - 1, Math.max(0, Math.round((x - x0) / cell))), j = Math.min(rows - 1, Math.max(0, Math.round((z - z0) / cell)));
      return heights[j * width + i];
    };
    let bed;
    if (c.profile) bed = elevations(c.profile, line.length, spacing, true, 0.3, 10);
    else {
      bed = line.map((p) => at(p.x, p.z) - depth);
      for (let i = 1; i < bed.length; i++) bed[i] = Math.min(bed[i], bed[i - 1]);
    }
    const half = (c.width ?? 4) / 2, bank = c.bank ?? 1.5;
    for (let s = 0; s + 1 < line.length; s++) {
      const a = line[s], b = line[s + 1], ha = bed[s], hb = bed[s + 1];
      near(a.x, a.z, b.x, b.z, half + 40, (k, px, pz) => {
        const [d, t] = along(px, pz, a, b);
        heights[k] = Math.min(heights[k], ha + (hb - ha) * t + Math.max(0, d - half) / bank);
      });
    }
    carved.push({ line, bed });
  }
  let lo = Infinity, hi = -Infinity;
  for (const v of heights) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const shift = lo < 0 ? -lo : 0;
  const height = Math.max(hi + shift, 1);
  const values = Uint16Array.from(heights, (v) => Math.round(((v + shift) / height) * 65535));
  let worst = 0;
  for (const r of roads) for (let i = 1; i < r.elev.length; i++) worst = Math.max(worst, Math.abs(r.elev[i] - r.elev[i - 1]) / spacing);
  const m = (v) => Math.round((v + shift) * 10) / 10;
  return {
    png: png16(width, rows, values),
    x: Math.round(x0 * 100) / 100,
    z: Math.round(z0 * 100) / 100,
    size: Math.round((width - 1) * cell * 100) / 100,
    cell, width, rows,
    height: Math.round(height * 1000) / 1000,
    shift,
    notes,
    report: {
      roads: roads.map((r) => ({ length: Math.round((r.line.length - 1) * spacing), start: m(r.elev[0]), end: m(r.elev.at(-1)), min: m(Math.min(...r.elev)), max: m(Math.max(...r.elev)) })),
      pads: padLevels.map(m),
      carve: carved.map((c) => ({ length: Math.round((c.line.length - 1) * spacing), from: m(c.bed[0]), to: m(c.bed.at(-1)) })),
      maxGrade: worst,
    },
    roads: roads.map((r) => ({ line: r.line, elev: r.elev.map((h) => h + shift) })),
  };
}
