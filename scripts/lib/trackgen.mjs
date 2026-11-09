// Lays out a racing route as a scene: a closed circuit or an open rally stage, from a list of control points. Used by the studio's track editor
// (studio/src/lib/track-doc.ts, which reads and writes `tracks/<name>.track.json`) and by its MCP server (the `track_write` tool), which make
// Pine Ridge Rally's courses. `layout(spec)` returns the scene (road start, arches, section gates, waypoints, grid, scenery along the route) and
// its statistics; `roadGlb(control, kind, open)` is the road as one ribbon mesh. The same spec and seed always give the same scene.

// ---- the curve ---------------------------------------------------------------------------------------------------------
const catmull = (p0, p1, p2, p3, t) => {
  const t2 = t * t, t3 = t2 * t;
  return [0, 1].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
};

/// Points every `spacing` metres along the closed curve through `control`, from the first control point, with headings.
export function centreline(control, spacing, open = false) {
  const dense = [];
  const n = control.length;
  // (an open route, a rally stage, is not a loop: its ends repeat the first and last control points, and it stops at the last one)
  const at = (i) => control[open ? Math.max(0, Math.min(n - 1, i)) : (i + n) % n];
  for (let i = 0; i < (open ? n - 1 : n); i++) for (let s = 0; s < 80; s++) dense.push(catmull(at(i - 1), at(i), at(i + 1), at(i + 2), s / 80));
  if (open) dense.push([...control[n - 1]]);
  const out = [dense[0]];
  let carried = 0;
  for (let i = 1; i <= (open ? dense.length - 1 : dense.length); i++) {
    const a = dense[i - 1], b = dense[i % dense.length];
    let d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (carried + d >= spacing) {
      const f = (spacing - carried) / d;
      const p = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      out.push(p);
      a[0] = p[0]; a[1] = p[1];
      d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      carried = 0;
    }
    carried += d;
  }
  // the last point may sit very close to the first: drop it
  if (!open && Math.hypot(out.at(-1)[0] - out[0][0], out.at(-1)[1] - out[0][1]) < spacing * 0.5) out.pop();
  return out.map((p, i) => {
    const q = out[open ? Math.min(i + 1, out.length - 1) : (i + 1) % out.length], r = out[open ? Math.max(i - 1, 0) : (i + out.length - 1) % out.length];
    const dx = q[0] - r[0], dz = q[1] - r[1];
    const len = Math.hypot(dx, dz);
    return { x: p[0], z: p[1], tx: dx / len, tz: dz / len, ry: Math.atan2(dx, dz) };
  });
}

/// Signed turning (radians per metre) at each point; positive turns towards +x when heading +z.
export const curvature = (pts, spacing, open = false) => pts.map((p, i) => {
  const a = pts[open ? Math.max(0, i - 2) : (i + pts.length - 2) % pts.length], b = pts[open ? Math.min(pts.length - 1, i + 2) : (i + 2) % pts.length];
  let d = b.ry - a.ry;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d / (spacing * 4);
});

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r1 = (n) => Math.round(n * 10) / 10;

// ---- zones: stretches of the route with their own surface or width ---------------------------------------------------------------
// A zone is { from, to } in metres along the route from its first point, with `road` (another road kind: gravel into tarmac on a stage),
// `width` (metres across, instead of 12: a narrow section) and `wall` (an entity lining both edges, every 6 m). A width eases in and out
// over RAMP metres either side; a surface changes at the zone's edge.
export const ROAD_WIDTH = 12;
const RAMP = 15;
export function halfAt(zones, s) {
  let half = ROAD_WIDTH / 2;
  for (const z of zones ?? []) {
    if (!z.width) continue;
    const f = s < z.from ? 1 - (z.from - s) / RAMP : s > z.to ? 1 - (s - z.to) / RAMP : 1;
    if (f > 0) half += (z.width / 2 - ROAD_WIDTH / 2) * Math.min(1, f);
  }
  return half;
}
export function roadAt(zones, s, road) {
  let kind = road;
  for (const z of zones ?? []) if (z.road && s >= z.from && s < z.to) kind = z.road;
  return kind;
}
const obj = (kind, x, z, ry = 0, extra = {}, y = 0) => ({ kind, x: r1(x), y, z: r1(z), ...(ry || Object.keys(extra).length ? { props: { ...(ry ? { ry: Math.round(ry * 1000) / 1000 } : {}), ...extra } } : {}) });

/// Where an open stage's start line (index L) and finish line (index F) are among `n` road points (a circuit starts at 0 and has no finish).
export function stageMarks(n, spacing, open, leadIn = 40, runout = 90) {
  return open ? { L: Math.round(leadIn / spacing), F: n - 1 - Math.round(runout / spacing) } : { L: 0, F: n };
}

/// The road points the section gates stand on (the last is the finish): the same spacing `layout` uses.
export function gateIndices(L, F, sections) {
  return Array.from({ length: sections }, (_, k) => L + Math.round(((F - L) * (k + 1)) / sections));
}

/// The corners of a route as pace notes, as the rally game reads them from the waypoints (every 10 m): `s` is the metres from the start line,
/// `left` the way it turns, `grade` 1 (a hairpin) to 6 (a gentle bend). Thresholds are those of `pace_notes` in examples/pine-ridge-rally/lib/race.lua.
export function paceNotes(line, curv, open = false, leadIn = 40, spacing = 5) {
  const L = open ? stageMarks(line.length, spacing, true, leadIn).L : 0;
  const notes = [];
  let cur = null;
  const close = () => {
    if (!cur) return;
    const peak = cur.peak;
    const grade = peak > 0.06 ? 1 : peak > 0.042 ? 2 : peak > 0.03 ? 3 : peak > 0.021 ? 4 : peak > 0.014 ? 5 : 6;
    notes.push({ s: cur.s, left: cur.sign > 0, grade });
    cur = null;
  };
  for (let i = L, w = 0; i < line.length; i += 2, w++) {
    const k = Math.round(curv[i] * 10000) / 10000; // (the scene stores each waypoint's k to four places)
    const a = Math.abs(k), s = w * spacing * 2;
    if (cur && k * cur.sign < 0 && a > 0.0085) close();
    if (!cur) {
      if (a > 0.0085) cur = { s, sign: k > 0 ? 1 : -1, peak: a };
    } else {
      if (a > cur.peak) cur.peak = a;
      if (a < 0.0045) close();
    }
  }
  close();
  return notes;
}

// ---- the course as the game sees it ------------------------------------------------------------------------------------
// The roadside and the crowd are laid out from the scene's own waypoints (rounded as they are stored), with the sums of Pine Ridge Rally's
// lib/track.lua, so that they land where the game used to put them when it placed them itself at the start of a race.
export function courseOf(waypoints, open) {
  const pts = waypoints.map((w) => ({ x: w.x, z: w.z, w: w.props?.w ?? ROAD_WIDTH / 2 }));
  const n = pts.length;
  let total = 0;
  pts.forEach((p, k) => {
    const i = k + 1;
    const a = open ? pts[Math.max(i - 1, 1) - 1] : pts[(((i - 2) % n) + n) % n];
    const b = open ? pts[Math.min(i + 1, n) - 1] : pts[i % n];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.max(Math.sqrt(dx * dx + dz * dz), 1e-6);
    p.tx = dx / len; p.tz = dz / len;
    p.heading = Math.atan2(dx, dz);
    const nx = open ? pts[Math.min(i + 1, n) - 1] : pts[i % n];
    p.s = total;
    p.seg = open && i === n ? 0 : Math.sqrt((nx.x - p.x) ** 2 + (nx.z - p.z) ** 2);
    total += p.seg;
  });
  /// Waypoint `i` (from 1; a circuit wraps round, a stage stops at its ends).
  const point = (i) => (open ? pts[Math.max(1, Math.min(n, i)) - 1] : pts[(((i - 1) % n) + n) % n]);
  /// How far (x, z) is from the middle of the road.
  const away = (x, z) => {
    let best = 1e18;
    for (let i = 1; i <= (open ? n - 1 : n); i++) {
      const a = pts[i - 1], nx = open ? pts[Math.min(i + 1, n) - 1] : pts[i % n];
      const dx = x - a.x, dz = z - a.z;
      const sx = nx.x - a.x, sz = nx.z - a.z;
      const len2 = Math.max(sx * sx + sz * sz, 1e-6);
      let t = (dx * sx + dz * sz) / len2;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const qx = a.x + sx * t - x, qz = a.z + sz * t - z;
      best = Math.min(best, qx * qx + qz * qz);
    }
    return Math.sqrt(best);
  };
  const wrap = (a) => {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  };
  /// How the road turns over the ~40 m after each waypoint (radians, positive to the right), by waypoint from 1.
  const bends = [0];
  for (let i = 1; i <= n; i++) bends[i] = wrap(point(i + 4).heading - point(i).heading);
  return { n, length: total, point, away, bends };
}

/// The life beside the road: a stand on each side of the start straight, long tents and banners there, flags along it, a billboard on a
/// straight every 120 m or so (alternating sides and the two kinds of board) and pylons on the outside of the hard bends. Nothing is put
/// nearer the road than its `clear` distance (where the road bends, a spot beside one waypoint can be across another part of the road).
function roadside(course, kinds, out) {
  const { n, length, point, away, bends } = course;
  if (n < 20) return;
  const add = (kind, i, off, turn, along, clear) => {
    if (!kind) return;
    const p = point(i);
    const nx = p.tz, nz = -p.tx; // to the left
    const x = p.x + nx * off + p.tx * along, z = p.z + nz * off + p.tz * along;
    if (away(x, z) < clear) return;
    out.push(obj(kind, x, z, p.heading + turn));
  };
  const pi = Math.PI;
  add(kinds.stand, 2, 22, -pi / 2, 14, 14);
  add(kinds.stand, 2, -22, pi / 2, 14, 14);
  add(kinds.tent, 3, 17, pi / 2, 30, 11);
  add(kinds.tent, 3, -17, -pi / 2, 30, 11);
  add(kinds.banner, 1, 9.5, 0, 0, 8.5);
  add(kinds.banner, 1, -9.5, 0, 0, 8.5);
  for (let k = 0; k <= 3; k++) {
    add(kinds.flag, 1 + k * 3, 8, 0, -22, 7.5);
    add(kinds.flag, 1 + k * 3, -8, 0, -22, 7.5);
  }
  const boards = kinds.boards ?? [];
  let nextBoard = 130, side = 1, lastPylon = -1e9;
  for (let i = 1; i <= n; i++) {
    const p = point(i);
    if (p.s > 60 && p.s < length - 40) {
      const straight = Math.abs(bends[i]) < 0.08 && Math.abs(bends[((i + 3) % n) + 1]) < 0.08;
      if (straight && p.s > nextBoard && boards.length) {
        add(boards[i % 2 === 0 ? 0 : boards.length - 1], i, side * 13, (side * pi) / 2, 0, 10);
        side = -side;
        nextBoard = p.s + 120;
      }
      if (Math.abs(bends[i]) > 0.22 && p.s - lastPylon > 20) {
        const outside = bends[i] > 0 ? 1 : -1; // turning right: the outside is to the left
        add(kinds.pylon, i, outside * (p.w + 1.4), 0, 0, p.w + 0.2);
        lastPylon = p.s;
      }
    }
  }
  // (2026-11-07, for the courses that ask for them) a row of pit garages behind the start line on the right, their doors to the road, with
  // the office at its end; a gantry of start lights over the road 60 m after the line; light posts along the straights, every 60 m
  if (kinds.garage) {
    const count = kinds.garages ?? 5;
    for (let k = 0; k < count; k++) add(kinds.garage, 1, -(point(1).w + 13), pi / 2, -26 - 12.2 * k, point(1).w + 6);
    add(kinds.office, 1, -(point(1).w + 13), pi / 2, -26 - 12.2 * count, point(1).w + 6);
  }
  if (kinds.gantry) {
    const p = point(7);
    out.push(obj(kinds.gantry, p.x, p.z, p.heading));
  }
  if (kinds.post) {
    let next = 40, sidePost = 1;
    for (let i = 1; i <= n; i++) {
      const p = point(i);
      if (p.s > next && p.s < length - 30 && Math.abs(bends[i]) < 0.1) {
        // (the post's arm reaches along its +z: turned to the road)
        add(kinds.post, i, sidePost * (p.w + 2.6), sidePost > 0 ? -pi / 2 : pi / 2, 0, p.w + 1.5);
        sidePost = -sidePost;
        next = p.s + 60;
      }
    }
  }
}

/// The people watching: groups beside the road by the start, on the outside of the hard bends and here and there along the straights, each
/// turned to the road, with their own size, hop, clip speed and phase (the game animates them). A sequence of its own, seeded by the number
/// of waypoints, so the same road always gets the same crowd.
function crowd(course, spec, out) {
  const { n, length, point, away, bends } = course;
  if (n < 20 || !spec.kind.length) return;
  let seed = n * 31 + 7;
  const r = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return seed / 2147483648;
  };
  const size = spec.size ?? 1;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const add = (i, off, along) => {
    const p = point(i);
    const x = p.x + p.tz * off + p.tx * along, z = p.z - p.tx * off + p.tz * along;
    if (away(x, z) < 9.5) return;
    const face = p.heading + (off > 0 ? -Math.PI / 2 : Math.PI / 2) + (r() - 0.5) * 0.7;
    r(); // (a draw the game once made and did not use: kept, so that the crowd stays as it was)
    const kind = spec.kind[Math.floor(r() * spec.kind.length)];
    const sx = r3(size * (0.92 + r() * 0.16));
    const hop = r() < 0.7 ? r3(0.15 + r() * 0.2) : 0;
    const rate = r() < 0.5 ? 0.9 : 1.1;
    const phase = Math.floor(r() * 8) * 0.5;
    out.push(obj(kind, x, z, face, { sx, ...(hop ? { hop } : {}), rate, phase }));
  };
  const group = (i, side, off, count) => {
    let along = r() * 2;
    for (let k = 1; k <= count; k++) {
      add(i, side * (off + r() * 4), along);
      along = along + 2.5 + r() * 2.5;
    }
  };
  for (let i = 1; i <= 9; i += 3) {
    group(i, 1, 11, 5);
    group(i, -1, 11, 5);
  }
  let last = -1e9;
  for (let i = 1; i <= n; i++) {
    const p = point(i);
    if (p.s > 40 && Math.abs(bends[i]) > 0.16 && p.s - last > 40) {
      const outside = bends[i] > 0 ? 1 : -1;
      group(i, outside, 10.5, 4 + Math.floor(r() * 3));
      last = p.s;
    }
  }
  let nextSpot = 90, side = 1;
  for (let i = 1; i <= n; i++) {
    const p = point(i);
    if (p.s > nextSpot && p.s < length - 30) {
      const off = 11 + r() * 2;
      group(i, side, off, 2 + Math.floor(r() * 3));
      side = -side;
      nextSpot = p.s + 90 + r() * 60;
    }
  }
}

/// The barrier pieces on the outside of the bends (2026-11-08): for each stretch of bend (the curvature past 0.0075, turning the same way),
/// the line 8.2 m out from the middle (more where the road is wider) is walked and a piece laid every `length` metres, each from one
/// spot on the line to the next, so that the pieces meet end to end. (They were put at every other road point,
/// 10 m apart along the middle: 6 m pieces with gaps of 4 m and more on the outside of a bend.) Returns { x, z, ry } for each piece.
export function railPieces(line, curv, open, half, length = 5.6) { // (a 6 m piece every 5.6 m: they overlap a little, so a sharp bend shows no gap at its joins)
  const n = line.length;
  const bendAt = (i) => (Math.abs(curv[i]) > 0.0075 ? Math.sign(curv[i]) : 0);
  // a loop is walked from a spot that is not in a bend, so that no stretch is cut in two where the list wraps round
  let start = 0;
  if (!open) { while (start < n && bendAt(start) !== 0) start++; if (start === n) start = 0; }
  const out = [];
  let run = [];
  let runSide = 0;
  const finish = () => {
    if (run.length >= 2) {
      const d = [0];
      for (let k = 1; k < run.length; k++) d.push(d[k - 1] + Math.hypot(run[k].x - run[k - 1].x, run[k].z - run[k - 1].z));
      const total = d[d.length - 1];
      const at = (s) => {
        let k = 1;
        while (k < run.length - 1 && d[k] < s) k++;
        const t = Math.max(0, Math.min(1, (s - d[k - 1]) / Math.max(1e-6, d[k] - d[k - 1])));
        return { x: run[k - 1].x + (run[k].x - run[k - 1].x) * t, z: run[k - 1].z + (run[k].z - run[k - 1].z) * t };
      };
      // as many whole pieces as fit, centred on the stretch
      const count = Math.max(1, Math.round(total / length));
      const from = (total - count * length) / 2;
      for (let m = 0; m < count; m++) {
        const a = at(from + m * length), b = at(from + (m + 1) * length);
        out.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, ry: Math.atan2(b.x - a.x, b.z - a.z) });
      }
    }
    run = [];
    runSide = 0;
  };
  for (let j = 0; j < n; j++) {
    const i = open ? j : (start + j) % n;
    const side = bendAt(i);
    if (side === 0 || (runSide !== 0 && side !== runSide)) finish();
    if (side === 0) continue;
    runSide = side;
    const p = line[i];
    const nx = -p.tz * side, nz = p.tx * side;
    const off = 8.2 + (half(i) - ROAD_WIDTH / 2);
    run.push({ x: p.x + nx * off, z: p.z + nz * off });
  }
  finish();
  return out;
}

export function layout(spec) {
  const spacing = 5;
  const open = !!spec.open;
  const line = centreline(spec.control, spacing, open);
  const curv = curvature(line, spacing, open);
  const n = line.length;
  const length = n * spacing;
  // an open stage: the road starts `leadIn` metres before the start line (index L), and runs on `runout` metres past the finish line (index F)
  const { L, F } = stageMarks(n, spacing, open, spec.leadIn, spec.runout);
  const rand = rng(spec.seed);
  // (one kind, or a list of one, is taken without a draw: the same scene as when the kind was given on its own)
  const pick = (v) => (Array.isArray(v) ? (v.length > 1 ? v[Math.floor(rand() * v.length)] : v[0]) : v);
  const far = spec.far && (Array.isArray(spec.far.kind) ? spec.far.kind.length : spec.far.kind) && spec.far.density > 0 ? spec.far : null;
  const landmarks = spec.landmarks ?? { kind: [], count: 0, radius: 0 };
  const objects = [];

  // the road, with the start line on the first piece
  // (every other slab a hair higher: they overlap, and the kit's road has lines that would flicker where two slabs share a level)
  // (the road itself is one ribbon mesh, models/road_<circuit>.glb, drawn by lib/race.lua; only the start line is a piece, laid on it)
  objects.push(obj("road_start", line[L].x, line[L].z, line[L].ry, {}, 0.03));
  objects.push(obj("start_arch", line[L].x, line[L].z, line[L].ry));
  objects.push(obj("tower", line[L].x + line[L].tz * 15, line[L].z - line[L].tx * 15, line[L].ry + Math.PI / 2));
  if (open) {
    // the finish: an arch, with the flags of the finish on both sides; and the section gates between: two banners and a flag each side
    objects.push(obj("start_arch", line[F].x, line[F].z, line[F].ry));
    for (const side of [-1, 1]) objects.push(obj("flag_checkers", line[F].x + line[F].tz * side * 8, line[F].z - line[F].tx * side * 8, 0));
    const sections = spec.sections ?? 5;
    for (let k = 1; k <= sections; k++) {
      const g = line[L + Math.round(((F - L) * k) / sections)];
      objects.push({ kind: "section_gate", x: r1(g.x), y: 0, z: r1(g.z), props: { i: k, ry: Math.round(g.ry * 1000) / 1000 } });
      if (k === sections) continue; // (the last gate is the finish, which has its arch)
      for (const side of [-1, 1]) {
        objects.push(obj(spec.gateBanner ?? "banner_green", g.x + g.tz * side * 9.5, g.z - g.tx * side * 9.5, g.ry));
        objects.push(obj("flag_checkers", g.x + g.tz * side * 8, g.z - g.tx * side * 8, 0));
      }
    }
  }

  // waypoints every 10 m: the way the cars drive, and the order that counts laps
  const wp = [];
  for (let i = open ? L : 0; i < n; i += 2) wp.push(i);
  const zones = spec.zones ?? [];
  const half = (i) => halfAt(zones, i * spacing);
  wp.forEach((i, k) => {
    const props = { i: k + 1, k: Math.round(curv[i] * 10000) / 10000 };
    const h = half(i), kind = roadAt(zones, i * spacing, spec.road);
    if (Math.abs(h - ROAD_WIDTH / 2) > 0.01) props.w = Math.round(h * 100) / 100; // (half the road's width here, metres)
    if (kind !== spec.road) props.road = kind;
    objects.push({ kind: "waypoint", x: r1(line[i].x), y: 0, z: r1(line[i].z), props });
  });

  // the grid: a circuit's four boxes in two staggered columns just behind the line, a stage's one (scripts/rally/grid.mjs, which also
  // re-lays the grids of scenes already made)
  for (const s of gridSlots(line[L], open ? [] : line.map((p) => ({ x: p.x, z: p.z })), open)) {
    objects.push({ kind: "grid_slot", x: r1(s.x), y: 0, z: r1(s.z), props: { slot: s.slot, ry: Math.round(s.ry * 1000) / 1000 } });
  }

  // how close the nearest road is to a spot
  const near = (x, z) => {
    let best = 1e9;
    for (const p of line) best = Math.min(best, Math.hypot(p.x - x, p.z - z));
    return best;
  };
  const place = (kind, x, z, minRoad, extra = {}) => {
    if (!kind) return false;
    if (near(x, z) < minRoad) return false;
    // every piece gets its own size and a slight tint (the scene object's `tint`: sRGB multipliers), so that two of one model are never quite alike
    const v = 218 + Math.floor(rand() * 37), warm = Math.floor(rand() * 18);
    objects.push(obj(kind, x, z, rand() * Math.PI * 2, { sx: Math.round((0.8 + rand() * 0.6) * 100) / 100, tint: [v, v - warm / 2, v - warm], ...extra }));
    return true;
  };

  for (let i = 0; i < n; i++) {
    const p = line[i];
    for (const side of [-1, 1]) {
      const nx = -p.tz * side, nz = p.tx * side; // outwards from the road
      // trees and bushes, fewer close to the road
      if (rand() < spec.density) {
        const d = 11 + rand() * 38;
        const kind = spec.trees[Math.floor(rand() * spec.trees.length)];
        place(kind, p.x + nx * d + (rand() - 0.5) * 6, p.z + nz * d + (rand() - 0.5) * 6, 10.5);
      }
      if (rand() < spec.density * 0.7) place(spec.small[Math.floor(rand() * spec.small.length)], p.x + nx * (8 + rand() * 12), p.z + nz * (8 + rand() * 12), 11);
      if (rand() < spec.rocks) place(pick(spec.rock), p.x + nx * (9 + rand() * 20), p.z + nz * (9 + rand() * 20), 8.5);
      if (far && rand() < far.density) place(pick(far.kind), p.x + nx * (60 + rand() * 90), p.z + nz * (60 + rand() * 90), 40);
    }
    // on a bend the outside gets a barrier, tyres at the tightest part, and chevron signs before it
    const k = curv[i];
    if (Math.abs(k) > 0.0075 && i % 2 === 0) {
      const side = k > 0 ? 1 : -1; // a bend that turns towards +x (left, heading +z) has its outside on the right: (-tz, tx)
      const nx = -p.tz * side, nz = p.tx * side;
      const e = half(i) - ROAD_WIDTH / 2; // (how much wider than 12 m the road is here: negative where it is narrow)
      if (Math.abs(k) > 0.014 && i % 4 === 0) objects.push(obj("tires", p.x + nx * (9.6 + e), p.z + nz * (9.6 + e), 0));
    }
    if (Math.abs(k) > 0.011 && Math.abs(curv[(i + n - 4) % n]) < 0.008 && i % 3 === 0) {
      const side = k > 0 ? 1 : -1;
      const e = half(i) - ROAD_WIDTH / 2;
      objects.push(obj("sign_chevron", p.x + -p.tz * side * (8 + e), p.z + p.tx * side * (8 + e), p.ry + (k > 0 ? Math.PI : Math.PI)));
    }
    if (i === n - 1) for (const r of railPieces(line, curv, open, half)) objects.push(obj(spec.rail ?? "guardrail", r.x, r.z, r.ry));
    // street lamps along the outer edge every 40 m, turned to face the road (the lamp's arm points along its +z)
    if (spec.lamps && i % 8 === 3) {
      const side = i % 16 === 3 ? 1 : -1, nx = -p.tz * side, nz = p.tx * side, d = 9.4 + (half(i) - ROAD_WIDTH / 2);
      objects.push(obj("lamp", p.x + nx * d, p.z + nz * d, Math.atan2(-nx, -nz)));
    }
    if (i % 17 === 5 && Math.abs(k) < 0.006) objects.push(obj("hay_bale", p.x + -p.tz * (11.5 + (half(i) - ROAD_WIDTH / 2)), p.z + p.tx * (11.5 + (half(i) - ROAD_WIDTH / 2)), p.ry));
  }

  // a zone's walls: both edges lined every 6 m (a narrow, walled section)
  for (const z of zones) {
    if (!z.wall) continue;
    for (let sd = Math.max(0, z.from); sd <= Math.min(z.to, (n - 1) * spacing); sd += 6) {
      const i = Math.round(sd / spacing), p = line[i], d = half(i) + 0.9;
      for (const side of [-1, 1]) objects.push(obj(z.wall, p.x - p.tz * side * d, p.z + p.tx * side * d, p.ry));
    }
  }

  // some tall features well away from the road
  for (let i = 0; i < landmarks.count; i++) {
    const a = rand() * Math.PI * 2, d = landmarks.radius + rand() * 40;
    const cx = spec.control.reduce((s, c) => s + c[0], 0) / spec.control.length, cz = spec.control.reduce((s, c) => s + c[1], 0) / spec.control.length;
    place(pick(landmarks.kind), cx + Math.cos(a) * d * 1.3, cz + Math.sin(a) * d, 50);
  }

  // the roadside and the crowd, from the waypoints as the game reads them
  if (spec.roadside || spec.crowd?.kind?.length) {
    const course = courseOf(objects.filter((o) => o.kind === "waypoint"), open);
    if (spec.roadside) roadside(course, spec.roadside, objects);
    if (spec.crowd) crowd(course, spec.crowd, objects);
  }

  // objects carried over from the scene this one replaces (the named ones: settings a person keeps in the scene) go first
  if (spec.keep?.length) objects.unshift(...spec.keep);

  const s0 = line[0];
  const scene = {
    version: 1,
    background: spec.sky ?? [138, 182, 224],
    camera: { eye: [r1(s0.x - s0.tx * 22 + 6), 9, r1(s0.z - s0.tz * 22)], target: [r1(s0.x), 1.5, r1(s0.z + 14)], fov: 62 },
    objects,
  };
  return { scene, stats: { points: n, length, objects: objects.length, minRadius: Math.round(1 / Math.max(...curv.map(Math.abs))), tightest: (() => { const i = curv.map(Math.abs).indexOf(Math.max(...curv.map(Math.abs))); return [Math.round(line[i].x), Math.round(line[i].z)]; })(), bends: curv.filter((k, i) => Math.abs(k) > 0.04 && Math.abs(curv[(i + 1) % curv.length]) <= 0.04).length, line, curv } };
}

// ---- the road as one ribbon ------------------------------------------------------------------------------------------------------
// The road is not laid slab by slab (a straight slab on a bend leaves wedges on the outside and overlaps on the inside, and slabs that
// overlap flicker unless one is raised a hair): it is one mesh along the curve, a row of quads every 2 m, with the cross-section of the
// Kenney Racing Kit's `roadStraight` (12 m across: a 1 m verge, a 0.9 m line, then the asphalt) and its colours. The renderer lifts every
// vertex by the hills (nova.terrain), which is why a row every 2 m is made, and a skirt hangs from each edge so that no gap shows under it.
export const ROAD_COLOURS = {
  road_asphalt: { road: [0.2667, 0.2667, 0.2667], line: [0.9451, 0.949, 0.9647], verge: [0.302, 0.5608, 0.4314] },
  road_dirt: { road: [0.5, 0.37, 0.24], line: [0.78, 0.66, 0.48], verge: [0.66, 0.48, 0.28] },
  road_snow: { road: [0.6, 0.66, 0.74], line: [0.93, 0.96, 0.99], verge: [0.92, 0.95, 1.0] },
  // the rally stages: gravel (a grey-brown road with pale edges) and sand
  road_gravel: { road: [0.3, 0.26, 0.21], line: [0.5, 0.45, 0.38], verge: [0.2, 0.28, 0.12] },
  road_sand: { road: [0.82, 0.66, 0.42], line: [0.92, 0.8, 0.56], verge: [0.7, 0.54, 0.31] },
};
const CROSS = [[-6, -5.02, "verge"], [-5.02, -4.14, "line"], [-4.14, 4.14, "road"], [4.14, 5.02, "line"], [5.02, 6, "verge"]];

export function roadGlb(control, kind, open = false, zones = []) {
  const rows = centreline(control, 2, open);
  const n = rows.length;
  const positions = [], normals = [], colors = [], indices = [];
  const TOP = 0.02, SKIRT = -0.3;
  const quad = (a, b, c, d, rgb, wantUp) => {
    // a, b, c, d go round the quad; flip them if they face the wrong way
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let nrm = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(...nrm) || 1;
    nrm = nrm.map((x) => x / len);
    const flip = nrm[0] * wantUp[0] + nrm[1] * wantUp[1] + nrm[2] * wantUp[2] < 0;
    const pts = flip ? [a, d, c, b] : [a, b, c, d];
    if (flip) nrm = nrm.map((x) => -x);
    const base = positions.length / 3;
    for (const q of pts) { positions.push(...q); normals.push(...nrm); colors.push(...rgb, 1); }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  // (a row's offsets are scaled by the road's half-width there: a zone narrows or widens the whole cross-section)
  const scale = (i) => halfAt(zones, (i % n) * 2) / (ROAD_WIDTH / 2);
  const at = (i, off, y) => { const p = rows[i % n]; const o = off * scale(i); return [p.x + p.tz * o, y, p.z - p.tx * o]; };
  for (let i = 0; i < (open ? n - 1 : n); i++) {
    const j = i + 1;
    const colours = ROAD_COLOURS[roadAt(zones, i * 2, kind)];
    for (const [from, to, name] of CROSS) quad(at(i, from, TOP), at(i, to, TOP), at(j, to, TOP), at(j, from, TOP), colours[name], [0, 1, 0]);
    // the skirts: down from each outer edge, in the dark of the verge
    const dark = colours.verge.map((x) => x * 0.55);
    for (const side of [-6, 6]) quad(at(i, side, TOP), at(j, side, TOP), at(j, side, SKIRT), at(i, side, SKIRT), dark, [side < 0 ? -rows[i].tz : rows[i].tz, 0, side < 0 ? rows[i].tx : -rows[i].tx]);
  }
  const P = new Float32Array(positions), N = new Float32Array(normals), C = new Float32Array(colors), I = new Uint32Array(indices);
  const parts = [P, N, C, I].map((a) => new Uint8Array(a.buffer));
  const offsets = []; let atb = 0;
  for (const b of parts) { offsets.push(atb); atb += b.length; }
  const binLength = atb;
  const xs = [], ys = [], zs = [];
  for (let k = 0; k < positions.length; k += 3) { xs.push(positions[k]); ys.push(positions[k + 1]); zs.push(positions[k + 2]); }
  const json = {
    asset: { version: "2.0", generator: "nova scripts/lib/trackgen.mjs" },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: "road", mesh: 0 }],
    meshes: [{ name: "road", primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, indices: 3, mode: 4 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length / 3, type: "VEC3", min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)], max: [Math.max(...xs), Math.max(...ys), Math.max(...zs)] },
      { bufferView: 1, componentType: 5126, count: positions.length / 3, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: positions.length / 3, type: "VEC4" },
      { bufferView: 3, componentType: 5125, count: indices.length, type: "SCALAR" },
    ],
    bufferViews: parts.map((b, k) => ({ buffer: 0, byteOffset: offsets[k], byteLength: b.length, target: k === 3 ? 34963 : 34962 })),
    buffers: [{ byteLength: binLength }],
  };
  // (plain typed arrays, not Node's Buffer: the studio makes the road in the browser too)
  const text = new TextEncoder().encode(JSON.stringify(json));
  const js = new Uint8Array(text.length + ((4 - (text.length % 4)) % 4)).fill(0x20);
  js.set(text);
  const out = new Uint8Array(12 + 8 + js.length + 8 + binLength);
  const view = new DataView(out.buffer);
  out.set([0x67, 0x6c, 0x54, 0x46], 0); view.setUint32(4, 2, true); view.setUint32(8, out.length, true);
  view.setUint32(12, js.length, true); out.set([0x4a, 0x53, 0x4f, 0x4e], 16); out.set(js, 20);
  const bin = 20 + js.length;
  view.setUint32(bin, binLength, true); out.set([0x42, 0x49, 0x4e, 0], bin + 4);
  let o = bin + 8;
  for (const b of parts) { out.set(b, o); o += b.length; }
  return out;
}

// ---- a text map, to look at the shape ----------------------------------------------------------------------------------
export function ascii(line, w = 90, h = 40) {
  const xs = line.map((p) => p.x), zs = line.map((p) => p.z);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const grid = Array.from({ length: h }, () => Array(w).fill(" "));
  line.forEach((p, i) => {
    const c = Math.round(((p.x - x0) / (x1 - x0)) * (w - 1)), r = Math.round((1 - (p.z - z0) / (z1 - z0)) * (h - 1));
    grid[r][c] = i === 0 ? "S" : i % 20 === 0 ? "+" : "·";
  });
  return grid.map((r) => r.join("")).join("\n");
}

/// The closest two non-neighbouring road points, to be sure the circuit does not touch itself.
export function tightest(line, spacing) {
  let best = 1e9;
  for (let i = 0; i < line.length; i++) for (let j = i + 1; j < line.length; j++) {
    const around = Math.min(j - i, line.length - (j - i));
    if (around * spacing < 80) continue;
    best = Math.min(best, Math.hypot(line[i].x - line[j].x, line[i].z - line[j].z));
  }
  return Math.round(best);
}


// ---- the starting grid (scripts/rally/grid.mjs re-lays the grids of scenes already made with these) ----------------------------------------
// A circuit gets four boxes in two staggered columns, GAP m apart along the road (the front one FIRST m behind the line), SIDE m either side of
// the middle; a stage, which the player drives alone, one box in the middle of the road. The road is followed through bends.
export const GRID_GAP = 6, GRID_FIRST = 6, GRID_SIDE = 2.2;
/// The point `back` metres behind the start of `pts` (a closed loop that starts at the line, in driving order), with the road's heading there.
function behindLine(pts, back) {
  let left = back;
  for (let k = 0; k < pts.length; k++) {
    const a = pts[(pts.length - k) % pts.length], b = pts[pts.length - k - 1];
    const len = Math.hypot(a.x - b.x, a.z - b.z);
    if (left <= len) {
      const t = left / len;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, ry: Math.atan2(a.x - b.x, a.z - b.z) };
    }
    left -= len;
  }
  throw new Error("the loop is shorter than the grid");
}

/// The grid_slot objects for a course: `line` is the start line ({x, z, ry}), `pts` the waypoints in order (a circuit's loop), `open` a stage.
export function gridSlots(line, pts, open) {
  const out = [];
  if (open) {
    const x = line.x - Math.sin(line.ry) * GRID_FIRST, z = line.z - Math.cos(line.ry) * GRID_FIRST;
    out.push({ slot: 1, x, z, ry: line.ry });
    return out;
  }
  for (let s = 0; s < 4; s++) {
    const p = behindLine(pts, GRID_FIRST + s * GRID_GAP);
    const side = s % 2 ? GRID_SIDE : -GRID_SIDE;
    // (sideways: the same side trackgen has always used, -tz/+tx)
    out.push({ slot: s + 1, x: p.x - Math.cos(p.ry) * side, z: p.z + Math.sin(p.ry) * side, ry: p.ry });
  }
  return out;
}
