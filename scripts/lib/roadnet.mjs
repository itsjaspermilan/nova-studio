// A network of roads as ONE surface mesh (binary glTF), with proper junctions: `road_make` with `roads` (studio/mcp/makers/index-ground.ts).
// Where roads meet (a T, a Y at any angle, a crossroads, a road that ends on another, two pieces of one road end to end, a road into a
// pad) the builder makes one junction surface instead of laying ribbons over each other:
//
// - the through road (the one that carries on: the road a lane ends on, or the higher class at a crossing: tarmac over gravel, then the
//   wider, then the first given) stays one ribbon with its centre line unbroken; on the side the other road joins, its edge line,
//   shoulder and verge are cut back to the carriageway between the two corners;
// - the joining road is trimmed back to its "mouth", where its edges are clear of the through road and of the corner curves;
// - each corner is a fillet (a curve tangent to both roads' outer edges, its radius by the junction's surface: `kerb`) carrying the
//   edge line, shoulder and verge round it as a strip of the same bands;
// - the junction patch fills what is left: its boundary is exactly the through road's cut-back edge, the strips' inner lines and the
//   joining road's mouth, every vertex shared with the piece beside it; it is triangulated (ear clipping, then long inside edges split
//   until none is over 2 m, because the renderer lifts every vertex by the hills) so nothing overlaps and nothing is left open.
//
// Where the surface changes (a gravel lane off a tarmac road, a zone of another kind, a road into a pad of another kind) the
// `transition` says how: "feather" (the default) carries the junction's surface a short `apron` into the joining road and then meets
// the other surface along a ragged line (the tarmac's broken edge, gravel dust spilling onto it over the last metres), "apron" the same
// with a clean straight edge, "hard" a straight cut at the mouth. Markings end with the tarmac. A width change tapers over 15 m.
// Free ends get a rounded cap (`ends`: "round", "square", or "flat", the old straight cut); a `gap` (a bridge) ends both sides square
// with a threshold strip, so a deck can meet the road. Pads (a yard, a parking bay, a turning circle) are surfaces of their own that
// a road can end in.
//
// Everything is in metres on the ground (x, z); heights are only the road's small lift (0.02) and its verge dropping into the ground
// (-0.3): the game's hills lift every vertex (nova.terrain), so terrain_write should make the ground under the network (its `roads`).
// `checkSurface` (below) is the proof the tests use: no hole, no overlap, every inner edge shared by exactly two triangles.
import { centreline, packGlb, ROAD_COLOURS, ROAD_SHEET, ROAD_WIDTH } from "./trackgen.mjs";

const TOP = 0.02, SKIRT = -0.3, RAMP = 15;
const SHOULDER = [0.33, 0.29, 0.23];
const THRESHOLD = [0.3, 0.22, 0.15]; // a bridge's threshold strip: dark weathered timber
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const RANK = { road_asphalt: 3, road_gravel: 2, road_dirt: 1, road_sand: 1, road_snow: 1 };
export const MIN_NOSE = 0.6; // (metres: the smallest corner radius, the nose of a shallow Y's gore)
export const KERB = { road_asphalt: 6, road_gravel: 4.5, road_dirt: 4, road_sand: 4, road_snow: 4 };
export const NETWORK_DEFAULTS = { transition: "feather", apron: 3, feather: 1.6, ends: "round", rows: 2, kerb: KERB };

// ---- the cross-section of each kind (the same bands as trackgen's textured ribbon) ------------------------------------------------
// offs: band boundaries from the middle to the edge, unscaled (6 is the edge of a 12 m road; a road `width` w scales them by w / 12);
// inner: the carriageway's edge (where a junction cuts the through road back to); drop: where the verge starts falling to SKIRT.
function section(kind) {
  const c = ROAD_COLOURS[kind];
  if (kind === "road_asphalt") {
    return {
      offs: [0.075, 4.25, 4.45, 5, 6], inner: 4.25, drop: 5,
      centre: { col: [c.line, c.line], paint: "broken" },
      bands: [{ col: [c.road, c.road] }, { col: [c.line, c.line], paint: "solid", edge: true }, { col: [c.road, c.road] }, { col: [mix(c.road, SHOULDER, 0.6), SHOULDER] }],
      road: c.road,
    };
  }
  return { offs: [0, 3.6, 4.6, 5.2, 6], inner: 3.6, drop: 5.2, centre: null, bands: [{ col: [c.road, c.road] }, { col: [c.road, c.line] }, { col: [c.line, c.verge] }, { col: [c.verge, c.verge] }], road: c.road };
}
const SECTIONS = Object.fromEntries(Object.keys(ROAD_COLOURS).map((k) => [k, section(k)]));
const sec = (kind) => SECTIONS[kind] ?? SECTIONS.road_asphalt;
const yAt = (kind, o) => { const s = sec(kind), a = Math.abs(o); return a <= s.drop ? TOP : TOP + ((SKIRT - TOP) * (a - s.drop)) / (6 - s.drop); };

// texture coordinates on the road sheet (trackgen's ROAD_SHEET): u across the kind's column (or a paint strip), v along (64 m a repeat)
const S = ROAD_SHEET;
const column = (kind) => Math.max(0, S.kinds.indexOf(kind));
const uRoad = (kind, o) => (column(kind) * S.column + (Math.max(-6, Math.min(6, o)) / ROAD_WIDTH + 0.5) * S.column) / S.size;
const uPaint = (paint, side) => (S.paint + (paint === "broken" ? S.strip : 0) + S.strip / 2 + (side > 0 ? 6 : -6)) / S.size;
const vAlong = (s) => s / S.metres;

/// The band a pair of neighbouring unscaled offsets (a < b) falls in, with what it looks like at each end ({ col, u }).
function bandLook(kind, a, b, style = {}) {
  const s = sec(kind);
  if (a < 0 && b > 0) {
    if (!s.centre || style.noCentre) return [{ col: s.road, u: uRoad(kind, a) }, { col: s.road, u: uRoad(kind, b) }];
    return [{ col: s.centre.col[0], u: uPaint(s.centre.paint, -1) }, { col: s.centre.col[1], u: uPaint(s.centre.paint, 1) }];
  }
  const lo = Math.min(Math.abs(a), Math.abs(b)), hi = Math.max(Math.abs(a), Math.abs(b));
  let i = s.offs.findIndex((x, k) => k + 1 < s.offs.length && Math.abs(x - lo) < 1e-6 && Math.abs(s.offs[k + 1] - hi) < 1e-6);
  if (i < 0) i = Math.max(0, s.offs.findIndex((x) => x >= hi - 1e-6) - 1);
  const band = s.bands[i];
  const look = (o) => {
    const t = (Math.abs(o) - s.offs[i]) / (s.offs[i + 1] - s.offs[i] || 1);
    if (band.paint && !(style.noEdge && band.edge)) return { col: mix(band.col[0], band.col[1], t), u: uPaint(band.paint, o === Math.max(a, b) ? 1 : -1) };
    if (band.paint) return { col: s.road, u: uRoad(kind, o) };
    return { col: mix(band.col[0], band.col[1], Math.max(0, Math.min(1, t))), u: uRoad(kind, o) };
  };
  return [look(a), look(b)];
}

// ---- lines ---------------------------------------------------------------------------------------------------------------------------
class Line {
  constructor(pts) {
    this.p = pts;
    this.s = [0];
    for (let i = 1; i < pts.length; i++) this.s.push(this.s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    this.length = this.s.at(-1);
    // (the tangent at each point: the mean of the segments either side, so a row's direction turns smoothly)
    this.t = pts.map((_, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    });
  }
  /// The point, the unit tangent and the normal (its +offset side, trackgen's: [tz, -tx]) at `s` metres along; beyond the ends the
  /// line runs on straight.
  at(s) {
    const n = this.p.length;
    if (s <= 0 || s >= this.length) {
      const i = s <= 0 ? 0 : n - 1, t = this.t[i], d = s <= 0 ? s : s - this.length;
      const x = this.p[i][0] + t[0] * d, z = this.p[i][1] + t[1] * d;
      return { x, z, tx: t[0], tz: t[1], nx: t[1], nz: -t[0] };
    }
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.s[m] <= s) lo = m; else hi = m; }
    const f = (s - this.s[lo]) / (this.s[hi] - this.s[lo] || 1);
    const x = this.p[lo][0] + (this.p[hi][0] - this.p[lo][0]) * f, z = this.p[lo][1] + (this.p[hi][1] - this.p[lo][1]) * f;
    let tx = this.t[lo][0] + (this.t[hi][0] - this.t[lo][0]) * f, tz = this.t[lo][1] + (this.t[hi][1] - this.t[lo][1]) * f;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l; tz /= l;
    return { x, z, tx, tz, nx: tz, nz: -tx };
  }
  /// The nearest point's distance along the line and how far from it.
  nearest(x, z) {
    let best = { d: Infinity, s: 0 };
    for (let i = 0; i + 1 < this.p.length; i++) {
      const [ax, az] = this.p[i], [bx, bz] = this.p[i + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
      if (d < best.d) best = { d, s: this.s[i] + t * (this.s[i + 1] - this.s[i]) };
    }
    return best;
  }
}
const lineOf = (control) => {
  // (the spline needs four points: a shorter line gets points in the middle of its longest pieces, so it stays straight between them)
  const c = control.map((p) => [...p]);
  while (c.length < 4) {
    let k = 0;
    for (let i = 1; i + 1 < c.length; i++) if (Math.hypot(c[i + 1][0] - c[i][0], c[i + 1][1] - c[i][1]) > Math.hypot(c[k + 1][0] - c[k][0], c[k + 1][1] - c[k][1])) k = i;
    c.splice(k + 1, 0, [(c[k][0] + c[k + 1][0]) / 2, (c[k][1] + c[k + 1][1]) / 2]);
  }
  return new Line(centreline(c, 0.5, true).map((p) => [p.x, p.z]));
};

// segment-segment intersection: [t along a, u along b] or null
function cross(a0, a1, b0, b1) {
  const rx = a1[0] - a0[0], rz = a1[1] - a0[1], sx = b1[0] - b0[0], sz = b1[1] - b0[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = b0[0] - a0[0], qz = b0[1] - a0[1];
  const t = (qx * sz - qz * sx) / den, u = (qx * rz - qz * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [t, u] : null;
}

// ---- the mesh being made ---------------------------------------------------------------------------------------------------------------
// A vertex is an object { x, y, z } shared by reference by every triangle that has it, so neighbouring pieces share it exactly; each
// triangle carries its own colour and texture coordinate at each corner (a seam in colour is not a gap).
class Mesh {
  constructor() { this.tris = []; }
  v(x, z, y = TOP) { return { x, y, z }; }
  tri(a, b, c, la, lb, lc, kind, piece) {
    if (a === b || b === c || a === c) return;
    const area = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    if (Math.abs(area) < 1e-10) return;
    this.tris.push({ v: [a, b, c], look: [la, lb, lc], kind, piece });
  }
}

// ---- a road (a route): its line, its kind and width along it -------------------------------------------------------------------------
function routeOf(r, k) {
  if (!Array.isArray(r.control) || r.control.length < 2 || r.control.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))) throw new Error(`roads[${k}].control needs at least two [x, z] points`);
  const kind = r.road ?? "road_asphalt";
  if (!ROAD_COLOURS[kind]) throw new Error(`roads[${k}].road is ${Object.keys(ROAD_COLOURS).join(", ")}`);
  const width = r.width ?? ROAD_WIDTH;
  if (!(width >= 2 && width <= 40)) throw new Error(`roads[${k}].width is the road's whole width with its verges, 2 to 40 m`);
  const line = lineOf(r.control);
  const zones = (r.zones ?? []).map((z) => ({ ...z }));
  const route = {
    id: r.id ?? r.name ?? `road${k + 1}`, index: k, line, kind, width, zones, vShift: 0,
    // (the half-width scale: a road `width` w scales the 12 m cross-section; a zone's width eases in and out over 15 m)
    sigma(s) {
      let w = width;
      for (const z of zones) {
        if (!z.width) continue;
        const f = s < z.from ? 1 - (z.from - s) / RAMP : s > z.to ? 1 - (s - z.to) / RAMP : 1;
        if (f > 0) w += (z.width - width) * Math.min(1, f);
      }
      return w / ROAD_WIDTH;
    },
    kindAt(s) { let q = kind; for (const z of zones) if (z.road && s >= z.from && s < z.to) q = z.road; return q; },
  };
  route.rank = RANK[kind] ?? 1;
  return route;
}

// a frame along an arm: d metres from the node outward; offsets in the arm's own frame (its +normal is the route's +normal times dir)
const armAt = (arm, d) => {
  const f = arm.route.line.at(arm.s + arm.dir * d);
  return { x: f.x, z: f.z, tx: f.tx * arm.dir, tz: f.tz * arm.dir, nx: f.nx * arm.dir, nz: f.nz * arm.dir, s: arm.s + arm.dir * d };
};
const armEdge = (arm, d, e) => { const f = armAt(arm, d), w = 6 * arm.route.sigma(f.s); return [f.x + f.nx * e * w, f.z + f.nz * e * w]; };

/// Builds the network. `spec`: { roads: [{ id, control, road, width, zones }], pads: [{ at, radius | size, ry, road, width }],
/// gaps: [{ road, from, to }], transition, apron, feather, ends, kerb }. Returns { mesh, report, junctions }.
export function buildNetwork(spec) {
  const given = Object.fromEntries(Object.entries(spec).filter(([, v]) => v !== undefined));
  const o = { ...NETWORK_DEFAULTS, ...given, kerb: { ...KERB, ...(spec.kerb ?? {}) } };
  if (!(o.apron >= 0 && o.apron <= 20) || !(o.feather >= 0 && o.feather <= 10)) throw new Error("apron is 0 to 20 m and feather 0 to 10 m");
  if (!["feather", "apron", "hard"].includes(o.transition)) throw new Error('transition is "feather", "apron" or "hard"');
  if (!["round", "square", "flat"].includes(o.ends)) throw new Error('ends is "round", "square" or "flat"');
  const roadsIn = spec.roads ?? [];
  if (!Array.isArray(roadsIn) || !roadsIn.length) throw new Error("roads needs at least one road: { control: [[x, z], ...] }");
  let routes = roadsIn.map(routeOf);
  const report = [];

  // -- two pieces of one road end to end (or any two roads whose ends meet in line) become one route; a sharp corner is refused
  const ends = (r) => [[r.line.p[0], 0], [r.line.p.at(-1), r.line.length]];
  for (let changed = true; changed;) {
    changed = false;
    outer: for (const a of routes) for (const b of routes) {
      if (a === b) continue;
      const ae = a.line.p.at(-1), bs = b.line.p[0], be = b.line.p.at(-1);
      for (const [bp, flip] of [[bs, false], [be, true]]) {
        if (Math.hypot(ae[0] - bp[0], ae[1] - bp[1]) > 0.75) continue;
        const ta = a.line.t.at(-1), tb = flip ? b.line.t.at(-1).map((x) => -x) : b.line.t[0];
        if (ta[0] * tb[0] + ta[1] * tb[1] < 0.5) throw new Error(`${a.id} and ${b.id} meet end to end at a sharp corner (more than 60 degrees): give one road a control point round the corner instead`);
        const bpts = flip ? [...b.line.p].reverse() : b.line.p;
        const L = a.line.length, joined = new Line([...a.line.p, ...bpts.slice(1)]);
        const bz = b.zones.map((z) => (flip ? { ...z, from: L + b.line.length - z.to, to: L + b.line.length - z.from } : { ...z, from: L + z.from, to: L + z.to }));
        // (b's own kind and width become a zone of the joined road: its width eases in over 15 m from the join, its surface changes there)
        const zone = { from: L, to: L + b.line.length + 1, ...(b.kind !== a.kind ? { road: b.kind } : {}), ...(b.width !== a.width ? { width: b.width } : {}) };
        const m = routeOf({ id: a.id, control: [[0, 0], [1, 0]], road: a.kind, width: a.width }, a.index);
        m.line = joined; m.zones.push(...a.zones, zone, ...bz); m.parts = [a.id, b.id];
        report.push(`${a.id} and ${b.id} joined end to end into one road${zone.road ? `, ${a.kind} to ${b.kind}` : ""}${zone.width ? `, ${a.width} to ${b.width} m wide` : ""}`);
        routes = routes.filter((r) => r !== a && r !== b);
        routes.splice(Math.min(a.index, routes.length), 0, m);
        changed = true;
        break outer;
      }
    }
  }
  void ends;

  // -- pads: an outline (the carriageway's edge) and the verge round it
  const pads = (spec.pads ?? []).map((p, k) => {
    if (!Array.isArray(p.at) || !p.at.every(Number.isFinite)) throw new Error(`pads[${k}].at is [x, z]`);
    const kind = p.road ?? "road_gravel";
    if (!ROAD_COLOURS[kind]) throw new Error(`pads[${k}].road is ${Object.keys(ROAD_COLOURS).join(", ")}`);
    const sigma = (p.width ?? 7.2) / ROAD_WIDTH, grow = (6 - sec(kind).inner) * sigma;
    const pts = [];
    if (p.size) {
      // a rectangle [w, l] turned by ry, its corners rounded
      const [w, l] = p.size, r = Math.min(p.corner ?? 2, w / 2 - 0.1, l / 2 - 0.1), c = Math.cos(p.ry ?? 0), s = Math.sin(p.ry ?? 0);
      const centres = [[w / 2 - r, l / 2 - r], [-(w / 2 - r), l / 2 - r], [-(w / 2 - r), -(l / 2 - r)], [w / 2 - r, -(l / 2 - r)]];
      centres.forEach(([cx, cz], q) => {
        for (let j = 0; j <= 6; j++) {
          const a = (q * Math.PI) / 2 + (j / 6) * (Math.PI / 2), R = r + grow;
          const lx = cx + Math.cos(a) * R, lz = cz + Math.sin(a) * R;
          pts.push([p.at[0] + lx * c + lz * s, p.at[1] - lx * s + lz * c]);
        }
      });
    } else {
      const R = (p.radius ?? 6) + grow, n = Math.max(24, Math.ceil((2 * Math.PI * R) / 1.2));
      for (let j = 0; j < n; j++) pts.push([p.at[0] + Math.cos((j / n) * 2 * Math.PI) * R, p.at[1] + Math.sin((j / n) * 2 * Math.PI) * R]);
    }
    // (counter-clockwise in x, z: the inside on the left of the way round)
    let area = 0;
    for (let j = 0; j < pts.length; j++) { const a = pts[j], b = pts[(j + 1) % pts.length]; area += a[0] * b[1] - b[0] * a[1]; }
    if (area < 0) pts.reverse();
    const cum = [0];
    for (let j = 1; j <= pts.length; j++) cum.push(cum[j - 1] + Math.hypot(pts[j % pts.length][0] - pts[j - 1][0], pts[j % pts.length][1] - pts[j - 1][1]));
    return { id: p.id ?? `pad${k + 1}`, at: p.at, kind, sigma, pts, cum, perimeter: cum.at(-1), arms: [] };
  });
  const padAt = (pad, u) => {
    const P = pad.perimeter;
    u = ((u % P) + P) % P;
    let j = 0;
    while (j + 1 < pad.cum.length && pad.cum[j + 1] < u) j++;
    const a = pad.pts[j % pad.pts.length], b = pad.pts[(j + 1) % pad.pts.length], seg = pad.cum[j + 1] - pad.cum[j] || 1, f = (u - pad.cum[j]) / seg;
    const tx = (b[0] - a[0]) / seg, tz = (b[1] - a[1]) / seg;
    // (counter-clockwise: the inside is to the left of the tangent, [-tz, tx] in this frame's sense)
    return { x: a[0] + (b[0] - a[0]) * f, z: a[1] + (b[1] - a[1]) * f, tx, tz, inx: -tz, inz: tx };
  };
  const insidePad = (pad, x, z) => {
    let inside = false;
    for (let i = 0, j = pad.pts.length - 1; i < pad.pts.length; j = i++) {
      const [xi, zi] = pad.pts[i], [xj, zj] = pad.pts[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  };
  // the inward normal of the pad outline must point inside: check once on a sample, flip the convention if not
  for (const pad of pads) {
    const f = padAt(pad, 0.3);
    pad.inSign = insidePad(pad, f.x + f.inx * 0.05, f.z + f.inz * 0.05) ? 1 : -1;
  }

  // -- the junctions
  const nodes = [];
  const cuts = new Map(routes.map((r) => [r, []])); // station intervals each route leaves to a junction, a pad or a gap, with what ends there
  const narrows = new Map(routes.map((r) => [r, []])); // through-road stretches cut back to the carriageway on one side
  for (const r of routes) {
    for (const [end, dir] of [[0, 1], [r.line.length, -1]]) {
      const p = r.line.at(end);
      const pad = pads.find((q) => insidePad(q, p.x, p.z) || Math.min(...q.pts.map(([x, z]) => Math.hypot(x - p.x, z - p.z))) < 6 * r.sigma(end));
      if (pad) { pad.arms.push({ route: r, s: end, dir }); continue; }
      let best = null;
      for (const q of routes) {
        if (q === r) continue;
        const n = q.line.nearest(p.x, p.z);
        if (n.d <= Math.max(1, sec(q.kindAt(n.s)).inner * q.sigma(n.s)) && (!best || n.d < best.d)) best = { q, ...n };
      }
      if (best) {
        if (best.s < 1 || best.s > best.q.line.length - 1) throw new Error(`${r.id} ends on the end of ${best.q.id}: join them end to end (their ends within 0.75 m) or let one run on`);
        nodes.push({ through: best.q, s: best.s, arms: [{ route: r, s: end, dir }], kind: "T" });
      }
    }
  }
  // crossings of two lines away from their ends
  for (let i = 0; i < routes.length; i++) for (let j = i + 1; j < routes.length; j++) {
    const a = routes[i], b = routes[j];
    for (let ia = 0; ia + 1 < a.line.p.length; ia++) for (let ib = 0; ib + 1 < b.line.p.length; ib++) {
      const hit = cross(a.line.p[ia], a.line.p[ia + 1], b.line.p[ib], b.line.p[ib + 1]);
      if (!hit) continue;
      const sa = a.line.s[ia] + hit[0] * (a.line.s[ia + 1] - a.line.s[ia]), sb = b.line.s[ib] + hit[1] * (b.line.s[ib + 1] - b.line.s[ib]);
      const near = (r, s) => s < 6 * r.sigma(s) + 1 || s > r.line.length - 6 * r.sigma(s) - 1;
      if (near(a, sa) || near(b, sb)) continue; // (a road ending on the other: that is a T, found above)
      const aWins = a.rank > b.rank || (a.rank === b.rank && (a.width > b.width || (a.width === b.width && a.index <= b.index)));
      const [t, ts, c, cs] = aWins ? [a, sa, b, sb] : [b, sb, a, sa];
      if (nodes.some((n) => n.through === t && Math.abs(n.s - ts) < 1)) continue; // (the same crossing, found at a shared point)
      nodes.push({ through: t, s: ts, arms: [{ route: c, s: cs, dir: 1 }, { route: c, s: cs, dir: -1 }], kind: "crossroads" });
    }
  }

  const mesh = new Mesh();
  const junctions = [];
  // ---- rows of a ribbon: the vertices across a route at a station, with their unscaled offsets ---------------------------------------
  // (made once per station and cached, so the pieces that meet a row share its vertices)
  const rowCache = new Map();
  const row = (route, s, kind, cutSide = 0, inner = null) => {
    const key = `${route.index}:${s.toFixed(6)}:${kind}`;
    let full = rowCache.get(key);
    route.rowsMade = true;
    if (!full) {
      const f = route.line.at(s), sg = route.sigma(s), offs = sec(kind).offs;
      const signed = [...offs.slice().reverse().map((x) => -x), ...offs].filter((x, i, a) => i === 0 || Math.abs(x - a[i - 1]) > 1e-9);
      full = { s, vs: vAlong(s + route.vShift), kind, sigma: sg, f, pts: signed.map((u) => ({ o: u, v: mesh.v(f.x + f.nx * u * sg, f.z + f.nz * u * sg, yAt(kind, u)) })) };
      rowCache.set(key, full);
    }
    if (!cutSide) return full;
    // (cut back to the carriageway on one side or both: the vertices beyond `inner` go)
    const c = inner ?? sec(kind).inner, sides = [cutSide].flat();
    return { ...full, pts: full.pts.filter((p) => sides.every((sd) => (sd > 0 ? p.o <= c + 1e-9 : p.o >= -c - 1e-9))) };
  };

  // ---- triangles between two rows (or any two polylines across a road) ------------------------------------------------------------------
  // A and B go across from one side to the other with keys (offsets) that grow; the strip between them is zipped by key, so rows with
  // different vertices meet without a T-junction. `look(p, side)` gives a corner's colour and texture coordinate.
  const zip = (A, B, lookA, lookB, kind, piece) => {
    let i = 0, j = 0;
    while (i + 1 < A.length || j + 1 < B.length) {
      const takeA = j + 1 >= B.length || (i + 1 < A.length && A[i + 1].o <= B[j + 1].o);
      if (takeA) { mesh.tri(A[i].v, A[i + 1].v, B[j].v, ...lookA(A[i], A[i + 1], B[j]), kind, piece); i++; }
      else { mesh.tri(A[i].v, B[j + 1].v, B[j].v, ...lookB(A[i], B[j + 1], B[j]), kind, piece); j++; }
    }
  };
  // a plain band quad strip between two rows of the same kind and offsets (each band its own look)
  const bandsBetween = (A, B, kind, style, piece) => {
    const n = Math.min(A.pts.length, B.pts.length);
    // (rows of one kind have the same offsets; a cut-back row is a prefix or a suffix of the full one: line them up by offset)
    const byO = new Map(B.pts.map((p) => [p.o.toFixed(6), p]));
    for (let k = 0; k + 1 < A.pts.length; k++) {
      const a0 = A.pts[k], a1 = A.pts[k + 1], b0 = byO.get(a0.o.toFixed(6)), b1 = byO.get(a1.o.toFixed(6));
      if (!b0 || !b1) continue;
      const [l0, l1] = bandLook(kind, a0.o, a1.o, style);
      const la0 = { col: l0.col, uv: [l0.u, A.vs] }, la1 = { col: l1.col, uv: [l1.u, A.vs] };
      const lb0 = { col: l0.col, uv: [l0.u, B.vs] }, lb1 = { col: l1.col, uv: [l1.u, B.vs] };
      mesh.tri(a0.v, a1.v, b1.v, la0, la1, lb1, kind, piece);
      mesh.tri(a0.v, b1.v, b0.v, la0, lb1, lb0, kind, piece);
    }
    void n;
  };

  // ---- the kerb strip round a corner: the bands beyond the carriageway carried along a curve ------------------------------------------
  // samples: [{ x, z (the outer edge), nx, nz (inward), sigma }], the first and last replaced by the exact vertices of the rows they
  // meet (`first`, `last`: lists of row points from the outer edge inward). Returns the strip's inner line (vertices).
  // (its texture's v runs from `v0` at its first row to `v1` at its last, by the distance round, so it meets both roads' strips)
  const kerbStrip = (samples, first, last, kind, v0, v1, piece) => {
    const s = sec(kind), offs = s.offs.filter((x) => x >= s.inner - 1e-9).slice().reverse(); // outer edge first
    const rows = samples.map((q, k) => {
      if (k === 0 && first) return first;
      if (k === samples.length - 1 && last) return last;
      return offs.map((b) => ({ o: b, v: mesh.v(q.x + q.nx * q.sigma * (6 - b), q.z + q.nz * q.sigma * (6 - b), yAt(kind, b)) }));
    });
    const cum = [0];
    for (let k = 1; k < samples.length; k++) cum.push(cum[k - 1] + Math.hypot(samples[k].x - samples[k - 1].x, samples[k].z - samples[k - 1].z));
    const vAt = (k) => (v1 === undefined ? v0 + cum[k] / S.metres : v0 + ((v1 - v0) * cum[k]) / (cum.at(-1) || 1));
    for (let k = 0; k + 1 < rows.length; k++) {
      const A = rows[k], B = rows[k + 1];
      for (let b = 0; b + 1 < offs.length; b++) {
        const [l0, l1] = bandLook(kind, offs[b + 1], offs[b]); // (inner, outer)
        const look = (l, v) => ({ col: l.col, uv: [l.u, v] });
        mesh.tri(A[b].v, A[b + 1].v, B[b + 1].v, look(l1, vAt(k)), look(l0, vAt(k)), look(l0, vAt(k + 1)), kind, piece);
        mesh.tri(A[b].v, B[b + 1].v, B[b].v, look(l1, vAt(k)), look(l0, vAt(k + 1)), look(l1, vAt(k + 1)), kind, piece);
      }
    }
    const inner = rows.map((r) => r[r.length - 1].v);
    inner.outer = rows.map((r) => r[0].v);
    return inner;
  };
  // a fillet between two directions: from P0 heading h0 to P3 leaving along h3, radius R; samples every ~0.6 m (both ends included)
  const fillet = (P0, h0, P3, h3, R) => {
    const turn = Math.acos(Math.max(-1, Math.min(1, h0[0] * h3[0] + h0[1] * h3[1])));
    const h = (4 / 3) * Math.tan(turn / 4) * R;
    const P1 = [P0[0] + h0[0] * h, P0[1] + h0[1] * h], P2 = [P3[0] - h3[0] * h, P3[1] - h3[1] * h];
    const n = Math.max(2, Math.ceil(Math.hypot(P3[0] - P0[0], P3[1] - P0[1]) / 0.6), Math.ceil(turn / 0.14));
    const out = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n, a = (1 - t) ** 3, b = 3 * (1 - t) ** 2 * t, c = 3 * (1 - t) * t * t, d = t ** 3;
      const x = a * P0[0] + b * P1[0] + c * P2[0] + d * P3[0], z = a * P0[1] + b * P1[1] + c * P2[1] + d * P3[1];
      const dx = 3 * (1 - t) ** 2 * (P1[0] - P0[0]) + 6 * (1 - t) * t * (P2[0] - P1[0]) + 3 * t * t * (P3[0] - P2[0]);
      const dz = 3 * (1 - t) ** 2 * (P1[1] - P0[1]) + 6 * (1 - t) * t * (P2[1] - P1[1]) + 3 * t * t * (P3[1] - P2[1]);
      const l = Math.hypot(dx, dz) || 1;
      out.push({ x, z, tx: dx / l, tz: dz / l });
    }
    return out;
  };
  // inward normals along a curve: perpendicular to it, on the side `nIn0` (the first sample's) is on, kept continuous
  const inwards = (pts, nIn0) => {
    let prev = nIn0;
    return pts.map((p) => {
      let n = [-p.tz, p.tx];
      if (n[0] * prev[0] + n[1] * prev[1] < 0) n = [p.tz, -p.tx];
      prev = n;
      return n;
    });
  };

  // ---- the patch: one polygon of shared vertices, triangulated and refined -------------------------------------------------------------
  const patch = (poly, kind, frame, piece, uvOf = null) => {
    const pts = poly.filter((v, i) => v !== poly[(i + 1) % poly.length]);
    const tris = triangulate(pts, 2.0, (x, z) => mesh.v(x, z, TOP));
    const sx = sec(kind).inner;
    for (const [a, b, c] of tris) {
      const look = (v) => {
        if (uvOf) return { col: sec(kind).road, uv: uvOf(v) };
        // (the through road's texture carried on: across by the offset from its middle, folded back inside its carriageway)
        const dx = v.x - frame.x, dz = v.z - frame.z;
        let off = Math.abs(dx * frame.nx + dz * frame.nz);
        while (off > sx) off = Math.abs(2 * sx - off) * 0.999;
        return { col: sec(kind).road, uv: [uRoad(kind, off), vAlong(frame.s + dx * frame.tx + dz * frame.tz)] };
      };
      mesh.tri(a, b, c, look(a), look(b), look(c), kind, piece);
    }
  };

  // ---- each junction on a through road -----------------------------------------------------------------------------------------------
  const later = []; // (the patches, made once every road's rows are known)
  const sideArms = [];
  for (const n of nodes) for (const arm of n.arms) sideArms.push({ ...arm, through: n.through, sN: n.s, node: n });
  for (const sa of sideArms) {
    const M = sa.through, Sr = sa.route, sN = sa.sN;
    const fM = M.line.at(sN), kind = M.kindAt(sN);
    const arm = { route: Sr, s: sa.s, dir: sa.dir };
    // (the joining road's picture starts where the through road's is at the node, so the junction's blend between them is short)
    if (!Sr.rowsMade && !Sr.shifted) { Sr.vShift = sN + M.vShift - sa.s; Sr.shifted = true; }
    // which side of M the arm leaves on, and which of its edges faces M's forward direction
    const f6 = armAt(arm, Math.min(8, Sr.line.length * 0.5));
    const side = Math.sign((f6.x - fM.x) * fM.nx + (f6.z - fM.z) * fM.nz) || 1;
    const fA = armAt(arm, 0.5);
    const eFwd = fA.nx * fM.tx + fA.nz * fM.tz > 0 ? 1 : -1;
    const wM = (s) => 6 * M.sigma(s);
    const edgeM = (s) => { const f = M.line.at(s); return [f.x + f.nx * side * wM(s), f.z + f.nz * side * wM(s)]; };
    const mEdge = Array.from({ length: 721 }, (_, k) => edgeM(sN - 90 + k * 0.25));
    const corner = (e) => {
      // where the arm's edge e crosses M's outer edge on that side (the first crossing going out along the arm)
      const away = e === eFwd ? 1 : -1;
      let hit = null;
      for (let d = 0; d < 80 && !hit; d += 0.25) {
        const a0 = armEdge(arm, d, e), a1 = armEdge(arm, d + 0.25, e);
        for (let k = 0; k + 1 < mEdge.length && !hit; k++) {
          const c = cross(a0, a1, mEdge[k], mEdge[k + 1]);
          if (c) hit = { d: d + c[0] * 0.25, s: sN - 90 + (k + c[1]) * 0.25 };
        }
      }
      if (!hit) throw new Error(`${Sr.id} meets ${M.id} too nearly along it: its edge never leaves ${M.id}'s within 80 m`);
      const fx = M.line.at(hit.s), awayM = [fx.tx * away, fx.tz * away], fa = armAt(arm, hit.d), awayS = [fa.tx, fa.tz];
      const phi = Math.acos(Math.max(-1, Math.min(1, awayM[0] * awayS[0] + awayM[1] * awayS[1])));
      const half = Math.max(0.05, Math.min(Math.PI / 2 - 0.01, phi / 2));
      // (the radius by the surface, smaller in a sharp corner so its tangents stay within 12 m, but never under MIN_NOSE: a shallow
      // Y's gore ends in a small rounded nose, not a point)
      const R = Math.max(MIN_NOSE, Math.min(o.kerb[kind] ?? 4, 12 * Math.tan(half)));
      const L = R / Math.tan(half);
      return { e, away, sT: hit.s + away * L, dT: hit.d + L, R, phi };
    };
    const cf = corner(eFwd), cb = corner(-eFwd);
    // the stations on M are snapped to whole centimetres (rows are cached by station)
    cf.sT = Math.round(cf.sT * 100) / 100; cb.sT = Math.round(cb.sT * 100) / 100;
    const m = Math.round((Math.max(cf.dT, cb.dT) + 0.05) * 100) / 100;
    const s0 = Math.min(cf.sT, cb.sT), s1 = Math.max(cf.sT, cb.sT);
    narrows.get(M).push({ from: s0, to: s1, side, kind, at: sN, by: Sr.id });
    const sMouth = Math.round((arm.s + arm.dir * m) * 1e6) / 1e6;
    const lead = Sr.kindAt(sMouth) === kind ? null : kind;
    cuts.get(Sr).push(arm.dir > 0 ? { from: arm.s, to: sMouth, endAt: "to", kind: "mouth", lead } : { from: sMouth, to: arm.s, endAt: "from", kind: "mouth", lead });
    // the mouth row of the arm (in the junction's surface: its apron, if the arm is of another kind)
    const mouthKind = lead ?? Sr.kindAt(sMouth);
    const mouth = row(Sr, sMouth, mouthKind);
    // (the mouth row's points in the arm's frame: route offset times dir)
    const mouthArm = mouth.pts.map((p) => ({ o: p.o * arm.dir, v: p.v }));
    const mOuter = (e) => mouthArm.filter((p) => p.o * e >= sec(mouthKind).inner - 1e-9).sort((a, b) => Math.abs(b.o) - Math.abs(a.o));
    // M's row at a corner's tangent station, its bands beyond the carriageway on that side, outer edge first
    const mOuterM = (s) => row(M, s, kind).pts.filter((p) => p.o * side >= sec(kind).inner - 1e-9).sort((a, b) => Math.abs(b.o) - Math.abs(a.o));
    const strip = (c) => {
      const P0 = edgeM(c.sT), fm = M.line.at(c.sT), h0 = [-fm.tx * c.away, -fm.tz * c.away];
      const P3 = armEdge(arm, c.dT, c.e), fa = armAt(arm, c.dT), h3 = [fa.tx, fa.tz];
      const arc = fillet(P0, h0, P3, h3, c.R);
      const n0 = [-fm.nx * side, -fm.nz * side];
      const ns = inwards(arc, n0);
      const samples = arc.map((p, k) => ({ x: p.x, z: p.z, nx: ns[k][0], nz: ns[k][1], sigma: M.sigma(c.sT) + (Sr.sigma(fa.s) - M.sigma(c.sT)) * (k / (arc.length - 1)) }));
      // then along the arm's edge to the mouth
      const steps = Math.max(1, Math.ceil((m - c.dT) / 1.5));
      for (let k = 1; k <= steps; k++) {
        const d = c.dT + ((m - c.dT) * k) / steps, f = armAt(arm, d), [x, z] = armEdge(arm, d, c.e);
        samples.push({ x, z, nx: -f.nx * c.e, nz: -f.nz * c.e, sigma: Sr.sigma(f.s) });
      }
      if (m - c.dT < 1e-6) samples.pop();
      return kerbStrip(samples, mOuterM(c.sT), mOuter(c.e), kind, vAlong(c.sT + M.vShift), mouth.vs, "kerb");
    };
    later.push(() => {
    const innerF = strip(cf), innerB = strip(cb);
    // the patch: M's cut-back edge from s0 to s1 (at M's own rows), round by the forward corner's strip, across the mouth, back by
    // the other strip
    const stations = plannedStations(M, s0, s1);
    const edgeLine = stations.map((s) => row(M, s, kind).pts.find((p) => Math.abs(p.o - side * sec(kind).inner) < 1e-9).v);
    const fwdFirst = cf.sT >= cb.sT; // (the forward corner is at s1)
    const [atS1, atS0] = fwdFirst ? [innerF, innerB] : [innerB, innerF];
    const eAt1 = fwdFirst ? cf.e : cb.e;
    const across = mouthArm.filter((p) => Math.abs(p.o) <= sec(mouthKind).inner + 1e-9).sort((a, b) => (b.o - a.o) * eAt1).map((p) => p.v);
    const poly = [...edgeLine, ...atS1.slice(1), ...across.slice(1), ...atS0.slice().reverse().slice(1, -1)];
    // (its picture: the through road's strip carried on across its cut-back edge, blending into the joining road's own toward its
    // mouth, so it meets both with no seam; each clamped to its carriageway, never folded, so no repair patch or crack repeats)
    const cM = sec(kind).inner, cS = sec(mouthKind).inner, clampU = (o, c) => Math.max(-c, Math.min(c, o));
    const uvOf = (v) => {
      const nm = M.line.nearest(v.x, v.z), fm = M.line.at(nm.s), om = ((v.x - fm.x) * fm.nx + (v.z - fm.z) * fm.nz) / M.sigma(nm.s);
      const ns = Sr.line.nearest(v.x, v.z), fs = Sr.line.at(ns.s), os = ((v.x - fs.x) * fs.nx + (v.z - fs.z) * fs.nz) / Sr.sigma(ns.s);
      const uM = uRoad(kind, clampU(om, cM)), vM = vAlong(nm.s + M.vShift), uS = uRoad(kind, clampU(os, cS)), vS = vAlong(ns.s + Sr.vShift);
      const dEdge = Math.max(0, (Math.abs(om) - cM) * M.sigma(nm.s)), dMouth = Math.max(0, m - Math.abs(ns.s - arm.s));
      // (v blends first, while u still reads the plain tarmac at the carriageway's edge, then u: so the blend never sweeps across a
      // repair patch or a crack of the picture and smears it)
      const t = dEdge / (dEdge + dMouth || 1), sm = (x) => x * x * (3 - 2 * x);
      const wv = sm(Math.min(1, 2 * t)), wu = sm(Math.max(0, 2 * t - 1));
      return [uM + (uS - uM) * wu, vM + (vS - vM) * wv];
    };
    patch(poly, kind, { x: fM.x, z: fM.z, nx: fM.nx, nz: fM.nz, tx: fM.tx, tz: fM.tz, s: sN }, "junction", uvOf);
    // (the junction's ground for a game: from the through road's middle at one corner, round both corners' outer edges, back along
    // its middle; and how far up the joining road the junction's surface runs)
    const c0 = M.line.at(s0), c1 = M.line.at(s1);
    record.area = [[c0.x, c0.z], ...atS0.outer.map((v) => [v.x, v.z]), ...atS1.outer.slice().reverse().map((v) => [v.x, v.z]), [c1.x, c1.z]];
    });
    const record = { kind: sa.node.kind, through: M.id, road: Sr.id, at: [fM.x, fM.z], angle: Math.round((Math.acos(Math.max(-1, Math.min(1, fA.tx * fM.tx + fA.tz * fM.tz))) * 180) / Math.PI), surface: kind, joining: Sr.kindAt(sMouth), transition: lead ? o.transition : null, mouth: m, corners: [cb, cf].map((c) => Math.round(c.R * 10) / 10),
      // (metres from the node up the joining road that are the junction's surface: its mouth, and its apron and half the band)
      paved: lead ? m + (o.transition === "hard" ? 0 : o.apron) + (o.transition === "feather" ? o.feather / 2 : 0) : m, end: arm.dir > 0 ? "start" : "end", s: sa.s };
    // (the apron, the junction's surface carried up the joining road: its outline, edge to edge, from the mouth to `paved`)
    if (record.paved > m) {
      const n = Math.max(1, Math.ceil((record.paved - m) / 1.5)), ds = Array.from({ length: n + 1 }, (_, k) => m + ((record.paved - m) * k) / n);
      record.apron = [...ds.map((d) => armEdge(arm, d, 1)), ...ds.slice().reverse().map((d) => armEdge(arm, d, -1))];
    }
    junctions.push(record);
  }

  // ---- pads: the outline's strip and the arms that end in it -------------------------------------------------------------------------------
  for (const pad of pads) {
    const kind = pad.kind, P = pad.perimeter;
    const openings = pad.arms.map((arm) => {
      const r = arm.route;
      const corner = (e) => {
        let hit = null;
        for (let d = -40; d < 80; d += 0.25) {
          const a0 = armEdge(arm, d, e), a1 = armEdge(arm, d + 0.25, e);
          for (let j = 0; j < pad.pts.length; j++) {
            const c = cross(a0, a1, pad.pts[j], pad.pts[(j + 1) % pad.pts.length]);
            if (c) hit = { d: d + c[0] * 0.25, u: pad.cum[j] + c[1] * (pad.cum[j + 1] - pad.cum[j]) };
          }
        }
        if (!hit) throw new Error(`${r.id}'s edge never crosses pad ${pad.id}'s edge: end the road in the pad`);
        return hit;
      };
      const a = corner(1), b = corner(-1);
      // (the opening is the short way round the outline between the two crossings)
      let fwd = (b.u - a.u + P) % P;
      const [lo, hi] = fwd < P / 2 ? [a, b] : [b, a];
      const loE = lo === a ? 1 : -1;
      const fin = (h, dirU, e) => {
        const f = padAt(pad, h.u), awayP = [f.tx * dirU, f.tz * dirU], fa = armAt(arm, h.d), awayS = [fa.tx, fa.tz];
        const phi = Math.acos(Math.max(-1, Math.min(1, awayP[0] * awayS[0] + awayP[1] * awayS[1])));
        const half = Math.max(0.05, Math.min(Math.PI / 2 - 0.01, phi / 2));
        const R = Math.max(MIN_NOSE, Math.min((o.kerb[kind] ?? 4) * 0.7, 8 * Math.tan(half))), L = R / Math.tan(half);
        return { e, uT: h.u + dirU * L, dT: h.d + L, R, dirU };
      };
      const cLo = fin(lo, -1, loE), cHi = fin(hi, 1, -loE);
      const m = Math.round((Math.max(cLo.dT, cHi.dT) + 0.05) * 100) / 100;
      const sMouth = Math.round((arm.s + arm.dir * m) * 1e6) / 1e6;
      const lead = r.kindAt(sMouth) === kind ? null : kind;
      cuts.get(r).push(arm.dir > 0 ? { from: -1e9, to: sMouth, endAt: "to", kind: "mouth", lead } : { from: sMouth, to: 1e9, endAt: "from", kind: "mouth", lead });
      const mouthKind = lead ?? r.kindAt(sMouth);
      const mouthRow = row(r, sMouth, mouthKind), mouthArm = mouthRow.pts.map((p) => ({ o: p.o * arm.dir, v: p.v }));
      junctions.push({ kind: "pad", through: pad.id, road: r.id, at: pad.at, surface: kind, joining: r.kindAt(sMouth), transition: lead ? o.transition : null, mouth: m });
      return { arm, cLo, cHi, m, mouthArm, mouthKind, mouthVs: mouthRow.vs, start: ((cLo.uT % P) + P) % P };
    }).sort((x, y) => x.start - y.start);
    const s = sec(kind);
    const outerOf = (op, e) => op.mouthArm.filter((p) => p.o * e >= sec(op.mouthKind).inner - 1e-9).sort((a, b) => Math.abs(b.o) - Math.abs(a.o));
    const outlineSamples = (u0, u1) => {
      // along the outline from u0 forward to u1 (u1 > u0), about every metre, both ends included
      const n = Math.max(1, Math.ceil((u1 - u0) / 1.0)), out = [];
      for (let k = 0; k <= n; k++) {
        const f = padAt(pad, u0 + ((u1 - u0) * k) / n);
        out.push({ x: f.x, z: f.z, nx: f.inx * pad.inSign, nz: f.inz * pad.inSign, sigma: pad.sigma });
      }
      return out;
    };
    const armSamples = (op, c, outward) => {
      // the arm's edge between its fillet and its mouth (outward: from the fillet out to the mouth)
      const out = [], steps = Math.max(1, Math.ceil((op.m - c.dT) / 1.5));
      for (let k = 0; k <= steps; k++) {
        const d = c.dT + ((op.m - c.dT) * k) / steps, f = armAt(op.arm, d), [x, z] = armEdge(op.arm, d, c.e);
        out.push({ x, z, nx: -f.nx * c.e, nz: -f.nz * c.e, sigma: op.arm.route.sigma(f.s) });
      }
      if (op.m - c.dT < 1e-6) out.pop();
      return outward ? out : out.reverse();
    };
    const filletSamples = (op, c, fromArm) => {
      // between the arm's edge at dT and the outline at uT
      const fa = armAt(op.arm, c.dT), Pa = armEdge(op.arm, c.dT, c.e), fp = padAt(pad, c.uT), Pp = [fp.x, fp.z];
      const tp = [fp.tx * c.dirU, fp.tz * c.dirU]; // along the outline, away from the opening
      const arc = fromArm ? fillet(Pa, [-fa.tx, -fa.tz], Pp, tp, c.R) : fillet(Pp, [-tp[0], -tp[1]], Pa, [fa.tx, fa.tz], c.R);
      const n0 = fromArm ? [-fa.nx * c.e, -fa.nz * c.e] : [fp.inx * pad.inSign, fp.inz * pad.inSign];
      const ns = inwards(arc, n0);
      return arc.map((p, k) => ({ x: p.x, z: p.z, nx: ns[k][0], nz: ns[k][1], sigma: pad.sigma }));
    };
    const poly = [];
    if (!openings.length) {
      // a pad on its own: a ring strip all round (its last row is its first)
      const smp = outlineSamples(0, P);
      const firstRow = s.offs.filter((x) => x >= s.inner - 1e-9).slice().reverse().map((b) => ({ o: b, v: mesh.v(smp[0].x + smp[0].nx * pad.sigma * (6 - b), smp[0].z + smp[0].nz * pad.sigma * (6 - b), yAt(kind, b)) }));
      const inner = kerbStrip(smp, firstRow, firstRow, kind, 0, undefined, "kerb");
      poly.push(...inner.slice(0, -1));
    }
    openings.forEach((op, k) => {
      const next = openings[(k + 1) % openings.length];
      // from this opening's high side (its mouth, back along the edge, round the fillet) along the outline to the next one's low side
      const a = armSamples(op, op.cHi, false), f1 = filletSamples(op, op.cHi, true);
      let u1 = next.cLo.uT; const u0 = op.cHi.uT;
      while (u1 <= u0) u1 += P;
      const line = outlineSamples(u0, u1), f2 = filletSamples(next, next.cLo, false), b = armSamples(next, next.cLo, true);
      const samples = [...a, ...f1.slice(1), ...line.slice(1), ...f2.slice(1), ...b.slice(1)];
      const inner = kerbStrip(samples, outerOf(op, op.cHi.e), outerOf(next, next.cLo.e), kind, op.mouthVs, next.mouthVs, "kerb");
      // then across the next opening's mouth
      const across = next.mouthArm.filter((p) => Math.abs(p.o) <= sec(next.mouthKind).inner + 1e-9).sort((x, y) => (y.o - x.o) * next.cLo.e).map((p) => p.v);
      poly.push(...inner.slice(0, -1), ...across.slice(0, -1));
    });
    patch(poly, kind, { x: pad.at[0], z: pad.at[1], nx: 1, nz: 0, tx: 0, tz: 1, s: 0 }, "pad");
  }

  // ---- gaps (a bridge): the road stops square at each end with a threshold strip ---------------------------------------------------------
  for (const [k, g] of (spec.gaps ?? []).entries()) {
    const r = routes.find((q) => q.id === g.road || q.parts?.includes(g.road));
    if (!r) throw new Error(`gaps[${k}].road names no road (${routes.map((q) => q.id).join(", ")})`);
    const a = r.line.nearest(...g.from).s, b = r.line.nearest(...g.to).s;
    cuts.get(r).push({ from: Math.min(a, b), to: Math.max(a, b), kind: "gap" });
    junctions.push({ kind: "gap", road: r.id, from: Math.round(Math.min(a, b) * 10) / 10, to: Math.round(Math.max(a, b) * 10) / 10 });
  }

  // ---- the ribbons, between the cuts --------------------------------------------------------------------------------------------------
  const transitions = [];
  for (const r of routes) {
    const cs = cuts.get(r).map((c) => ({ ...c, from: Math.max(0, c.from), to: Math.min(r.line.length, c.to) })).sort((a, b) => a.from - b.from);
    // the stretches that remain, each with what is at its two ends
    const spans = [];
    let at = 0, startEnd = { kind: "free" };
    for (const c of cs) {
      if (c.from > at + 0.01) spans.push({ from: at, to: c.from, a: startEnd, b: c.kind === "gap" ? { kind: "gap" } : { kind: "mouth", lead: c.lead } });
      else if (c.from < at - 0.01 && spans.length) throw new Error(`${r.id}: two junctions or gaps overlap at ${Math.round(c.from)} m along it (keep them further apart)`);
      startEnd = c.kind === "gap" ? { kind: "gap" } : { kind: "mouth", lead: c.lead };
      at = Math.max(at, c.to);
    }
    if (r.line.length > at + 0.01) spans.push({ from: at, to: r.line.length, a: startEnd, b: { kind: "free" } });
    for (const sp of spans) sp.plan = ribbon(r, sp, null);
    r.spans = spans;
  }
  // (the rows a route has between two stations: a junction's patch is bounded by them)
  function plannedStations(r, a, b) {
    const out = [];
    for (const sp of r.spans) for (const s of sp.plan.st) if (s >= a - 1e-7 && s <= b + 1e-7) out.push(s);
    return out;
  }
  for (const f of later) f();
  for (const r of routes) for (const sp of r.spans) ribbon(r, sp, sp.plan);

  function ribbon(r, sp, plan) {
    if (plan) return emit(r, sp, plan);
    // the stations of the rows: every `rows` metres, the narrowed stretches' ends, the zones' surface changes, the leads
    const marks = new Set([sp.from, sp.to]);
    const narrow = narrows.get(r).filter((q) => q.to > sp.from && q.from < sp.to);
    for (const q of narrow) { marks.add(Math.max(sp.from, q.from)); marks.add(Math.min(sp.to, q.to)); }
    const changes = [];
    for (let s = sp.from; s < sp.to; s += 0.5) if (r.kindAt(s) !== r.kindAt(Math.min(sp.to, s + 0.5))) changes.push(s + 0.25);
    // a lead at a mouth: the junction's surface carried `apron` metres in, then the transition to the road's own
    const leadAt = [];
    for (const [end, dirIn] of [["a", 1], ["b", -1]]) {
      const e = sp[end];
      if (e.kind !== "mouth" || !e.lead) continue;
      const s0 = end === "a" ? sp.from : sp.to;
      const apron = o.transition === "hard" ? 0 : o.apron;
      leadAt.push({ s0, dirIn, kind: e.lead, apron, edgeAt: s0 + dirIn * apron });
    }
    const feather = o.transition === "feather" ? o.feather : 0;
    const special = [];
    for (const L of leadAt) {
      if (L.apron > 0) marks.add(L.edgeAt);
      special.push({ at: L.edgeAt + (L.dirIn * feather) / 2, from: L.dirIn > 0 ? L.kind : null, to: L.dirIn > 0 ? null : L.kind, lead: L });
    }
    for (const c of changes) special.push({ at: c, zone: true });
    // (each change takes `feather` metres, from at - feather/2 to at + feather/2: rows on both sides of it)
    const halfF = feather / 2 + 1e-3;
    for (const c of special) { marks.add(c.at - halfF); marks.add(c.at + halfF); }
    // (the regular rows: not inside a transition band; inside a narrowed stretch, that stretch's own rows, which its patch shares)
    for (const q of narrow) for (const s of stationsBetween(q.from, q.to, o.rows)) marks.add(s);
    if (sp.a.kind === "gap") marks.add(sp.from + 0.5);
    if (sp.b.kind === "gap") marks.add(sp.to - 0.5);
    for (const s of stationsBetween(sp.from, sp.to, o.rows)) {
      if (narrow.some((q) => s > q.from - 0.3 && s < q.to + 0.3)) continue;
      if (special.some((c) => Math.abs(s - c.at) < halfF + 0.3)) continue;
      if ((sp.a.kind === "gap" && s < sp.from + 0.8) || (sp.b.kind === "gap" && s > sp.to - 0.8)) continue;
      marks.add(s);
    }
    const st = [...marks].filter((s) => s >= sp.from - 1e-9 && s <= sp.to + 1e-9).map((s) => Math.round(s * 1e6) / 1e6).sort((a, b) => a - b).filter((s, i, a) => i === 0 || s - a[i - 1] > 1e-4);
    // the look of each station: its kind and style (markings off on an apron)
    const kindAt = (s) => {
      for (const L of leadAt) if ((s - L.s0) * L.dirIn <= L.apron + (feather ? 0 : 1e-6) + 1e-9) return { kind: L.kind, style: { noCentre: true } };
      return { kind: r.kindAt(s), style: {} };
    };
    return { st, kindAt, narrow, special, feather };
  }
  function emit(r, sp, { st, kindAt, narrow, special, feather }) {
    // (the sides cut back between two rows: every narrowed stretch that holds both)
    const narrowAt = (s0, s1) => { const sides = narrow.filter((q) => s0 >= q.from - 1e-6 && s1 <= q.to + 1e-6).map((q) => q.side); return sides.length ? { side: sides } : null; };
    let prev = null;
    for (const s of st) {
      const k = kindAt(s);
      const cur = { s, ...k, row: row(r, s, k.kind) };
      if (prev) {
        const q = narrowAt(prev.s, s);
        const midChange = special.find((c) => c.at > prev.s && c.at < s);
        if (midChange && prev.kind !== cur.kind && feather > 0) featherBand(r, prev, cur, midChange);
        else if (prev.kind !== cur.kind) {
          // a straight edge (transition "apron" or "hard"): the two rows meet on one line, zipped
          const A = q ? row(r, prev.s, prev.kind, q.side) : prev.row, B = q ? row(r, s, cur.kind, q.side) : cur.row;
          zipRows(A, B, prev, cur, "transition");
          transitions.push({ road: r.id, at: Math.round(s * 10) / 10, from: prev.kind, to: cur.kind, style: "edge" });
        } else {
          const A = q ? row(r, prev.s, prev.kind, q.side) : prev.row, B = q ? row(r, s, cur.kind, q.side) : cur.row;
          bandsBetween(A, B, cur.kind, prev.style.noCentre || cur.style.noCentre ? { noCentre: true } : {}, "road");
        }
      }
      prev = cur;
    }
    // the ends
    for (const [end, s, dirOut] of [["a", st[0], -1], ["b", st.at(-1), 1]]) {
      const e = sp[end];
      const k = kindAt(s);
      if (e.kind === "free") cap(r, s, dirOut, k.kind);
    }
  }
  function zipRows(A, B, a, b, piece) {
    const look = (p, row, kind, style) => { const s = sec(kind); const [l] = bandLook(kind, p.o, p.o + (p.o >= 0 ? 0.001 : -0.001), style); return { col: Math.abs(p.o) <= s.inner ? s.road : l.col, uv: [uRoad(kind, p.o), row.vs] }; };
    zip(A.pts, B.pts, (p0, p1, q0) => [look(p0, A, a.kind, a.style), look(p1, A, a.kind, a.style), look(q0, B, b.kind, b.style)], (p0, q1, q0) => [look(p0, A, a.kind, a.style), look(q1, B, b.kind, b.style), look(q0, B, b.kind, b.style)], b.kind, piece);
  }
  // a ragged line across the road between two surfaces: the first surface's broken edge, dust of the second on its last metres
  function featherBand(r, a, b, change) {
    const sa = a.s, sb = b.s;
    const f0 = r.line.at(sa), sigma = r.sigma((sa + sb) / 2);
    const offs = new Set([...a.row.pts.map((p) => p.o), ...b.row.pts.map((p) => p.o)]);
    for (let u = -6; u <= 6; u += 0.35 / sigma) offs.add(Math.round(u * 1000) / 1000);
    const sorted = [...offs].sort((x, y) => x - y).filter((x, i, arr) => i === 0 || x - arr[i - 1] > 1e-6);
    // (the line wanders over the middle of the band: a few waves of different lengths, the same every time for the same place)
    const seed = Math.abs(Math.sin(f0.x * 12.9898 + f0.z * 78.233) * 43758.5453) % 1;
    const wave = (u) => 0.5 * Math.sin(u * 1.7 + seed * 6.28) + 0.3 * Math.sin(u * 4.3 + seed * 17) + 0.2 * Math.sin(u * 9.1 + seed * 31);
    const inset = 0.12;
    const line = (s, kind) => { const f = r.line.at(s), sg = r.sigma(s); return sorted.map((u) => ({ o: u, v: mesh.v(f.x + f.nx * u * sg, f.z + f.nz * u * sg, yAt(kind, u)), s })); };
    const A2 = line(sa + inset, a.kind), B2 = line(sb - inset, b.kind);
    const jag = sorted.map((u) => {
      const t = 0.5 + 0.42 * wave(u) * (Math.abs(u) > 5 ? 0.3 : 1);
      const s = sa + 2 * inset + (sb - sa - 4 * inset) * t, f = r.line.at(s), sg = r.sigma(s);
      return { o: u, v: mesh.v(f.x + f.nx * u * sg, f.z + f.nz * u * sg, Math.min(yAt(a.kind, u), yAt(b.kind, u))), s };
    });
    void sigma;
    const dust = mix(sec(a.kind).road, sec(b.kind).road, 0.45), dustB = mix(sec(b.kind).road, sec(a.kind).road, 0.15);
    const lookAt = (p, kind, style, rs, tint) => {
      const s = sec(kind), inner = Math.abs(p.o) <= s.drop;
      const [l] = bandLook(kind, p.o, p.o + (p.o >= 0 ? 0.001 : -0.001), style);
      return { col: tint && inner ? tint : Math.abs(p.o) <= s.inner ? s.road : l.col, uv: [uRoad(kind, p.o), vAlong((rs ?? p.s) + r.vShift)] };
    };
    // first surface up to the ragged line (dusted toward it), then the second from it
    // (row, then a row of the band's own offsets just inside it, zipped; then quad by quad to the ragged line, which keeps every
    // quad convex; the same on the other side)
    const la = (p, tint) => lookAt(p, a.kind, a.style, null, tint), lb = (p, tint) => lookAt(p, b.kind, b.style, null, tint);
    zip(a.row.pts, A2, (p0, p1, q0) => [lookAt(p0, a.kind, a.style, a.s), lookAt(p1, a.kind, a.style, a.s), la(q0)], (p0, q1, q0) => [lookAt(p0, a.kind, a.style, a.s), la(q1), la(q0)], a.kind, "feather");
    const quads = (P, Q, look, tintP, tintQ, kind) => {
      for (let i = 0; i + 1 < P.length; i++) {
        mesh.tri(P[i].v, P[i + 1].v, Q[i + 1].v, look(P[i], tintP), look(P[i + 1], tintP), look(Q[i + 1], tintQ), kind, "feather");
        mesh.tri(P[i].v, Q[i + 1].v, Q[i].v, look(P[i], tintP), look(Q[i + 1], tintQ), look(Q[i], tintQ), kind, "feather");
      }
    };
    quads(A2, jag, la, null, dust, a.kind);
    quads(jag, B2, lb, dustB, null, b.kind);
    zip(B2, b.row.pts, (p0, p1, q0) => [lb(p0), lb(p1), lookAt(q0, b.kind, b.style, b.s)], (p0, q1, q0) => [lb(p0), lookAt(q1, b.kind, b.style, b.s), lookAt(q0, b.kind, b.style, b.s)], b.kind, "feather");
    transitions.push({ road: r.id, at: Math.round(((sa + sb) / 2) * 10) / 10, from: a.kind, to: b.kind, style: "feather", lead: !!change.lead });
  }
  // a rounded (or square) end: the bands carried round a half circle
  function cap(r, s, dirOut, kind) {
    if (o.ends === "flat") return;
    const R = row(r, s, kind), f = R.f, sg = R.sigma, sc = sec(kind);
    const pos = R.pts.filter((p) => p.o >= 0).sort((a, b) => a.o - b.o), neg = R.pts.filter((p) => p.o <= 0).sort((a, b) => b.o - a.o);
    const tx = f.tx * dirOut, tz = f.tz * dirOut;
    if (o.ends === "square") {
      // the verge runs on across the end: one more row, every point dropped into the ground
      const d = (6 - sc.drop) * sg;
      const edge = R.pts.map((p) => ({ o: p.o, v: mesh.v(p.v.x + tx * d, p.v.z + tz * d, SKIRT) }));
      const look = (p, rs) => ({ col: sc.bands.at(-1).col[1], uv: [uRoad(kind, p.o), vAlong(rs + r.vShift)] });
      zip(R.pts, edge, (a, b, c) => [look(a, s), look(b, s), look(c, s + d * dirOut)], (a, b, c) => [look(a, s), look(b, s + d * dirOut), look(c, s + d * dirOut)], kind, "cap");
      return;
    }
    const N = 12;
    const ring = (b, pPos, pNeg) => {
      const pts = [pPos];
      for (let j = 1; j < N; j++) {
        const th = (j / N) * Math.PI, c = Math.cos(th), sn = Math.sin(th), rr = b * sg;
        pts.push(mesh.v(f.x + f.nx * c * rr + tx * sn * rr, f.z + f.nz * c * rr + tz * sn * rr, yAt(kind, b)));
      }
      pts.push(pNeg);
      return pts;
    };
    const offs = sc.offs;
    const rings = offs.map((b) => b === 0 ? Array(N + 1).fill(pos[0].v) : ring(b, pos.find((p) => Math.abs(p.o - b) < 1e-9).v, neg.find((p) => Math.abs(p.o + b) < 1e-9).v));
    // (the picture runs round the cap as if the road bent round on the spot: v by the distance round each ring, u by its radius)
    const lookAt = (k, b, j) => {
      const v = vAlong(s + r.vShift + ((j * Math.PI) / N) * b * sg);
      if (k === 0) return { col: sc.road, uv: [uRoad(kind, b), v] };
      const [l0, l1] = bandLook(kind, offs[k - 1], offs[k]);
      return b === offs[k] ? { col: l1.col, uv: [l1.u, v] } : { col: l0.col, uv: [l0.u, v] };
    };
    // the middle: a fan (from one side of the painted centre strip; a gravel road's centre is one point, its ring that point N + 1 times)
    const r0 = rings[0];
    for (let j = 1; j + 1 < r0.length; j++) mesh.tri(r0[0], r0[j], r0[j + 1], lookAt(0, 0, 0), lookAt(0, 0, j), lookAt(0, 0, j + 1), kind, "cap");
    for (let k = 1; k < rings.length; k++) {
      const A = rings[k - 1], B = rings[k], a = offs[k - 1], b = offs[k];
      for (let j = 0; j < N; j++) {
        if (A[j] !== A[j + 1]) mesh.tri(A[j], B[j], A[j + 1], lookAt(k, a, j), lookAt(k, b, j), lookAt(k, a, j + 1), kind, "cap");
        mesh.tri(A[j + 1], B[j], B[j + 1], lookAt(k, a, j + 1), lookAt(k, b, j), lookAt(k, b, j + 1), kind, "cap");
      }
    }
  }

  markThresholds(mesh, routes, cuts);

  return { mesh, junctions, transitions, report, routes, pads };
}

// the half metre of carriageway at a gap's ends becomes a threshold strip: its triangles are recoloured
function markThresholds(mesh, routes, cuts) {
  for (const r of routes) for (const c of cuts.get(r)) {
    if (c.kind !== "gap") continue;
    for (const s of [c.from, c.to]) {
      const f = r.line.at(s), sg = r.sigma(s), inner = sec(r.kindAt(s)).inner * sg;
      for (const t of mesh.tris) {
        const cx = (t.v[0].x + t.v[1].x + t.v[2].x) / 3, cz = (t.v[0].z + t.v[1].z + t.v[2].z) / 3;
        const along = (cx - f.x) * f.tx + (cz - f.z) * f.tz, acr = (cx - f.x) * f.nx + (cz - f.z) * f.nz;
        const inside = c.from === s ? along < 0 && along > -0.55 : along > 0 && along < 0.55;
        if (inside && Math.abs(acr) < inner) { t.look = t.look.map((l) => ({ ...l, col: THRESHOLD })); t.piece = "threshold"; }
      }
    }
  }
}

/// Stations from a to b about every `step` metres (both ends included).
function stationsBetween(a, b, step) {
  const n = Math.max(1, Math.ceil((b - a) / step - 1e-9));
  return Array.from({ length: n + 1 }, (_, i) => Math.round((a + ((b - a) * i) / n) * 1e6) / 1e6);
}

// ---- triangulating a patch -------------------------------------------------------------------------------------------------------------
/// Triangles over a simple polygon of vertices (objects with x, z), by ear clipping, then every inside edge longer than `maxLen` split
/// in two (both its triangles with it, so no vertex ever sits on another triangle's edge), then edges flipped toward the Delaunay
/// triangulation. The polygon's own edges are never split: they are shared with the pieces round the patch. New vertices come from
/// `make(x, z)`. Returns [[a, b, c], ...] counter-clockwise in x, z.
export function triangulate(poly, maxLen, make) {
  const pts = poly.slice();
  let area = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; area += a.x * b.z - b.x * a.z; }
  if (area < 0) pts.reverse();
  const ccw = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const inTri = (p, a, b, c) => ccw(a, b, p) > 1e-12 && ccw(b, c, p) > 1e-12 && ccw(c, a, p) > 1e-12;
  const tris = [];
  const idx = pts.map((_, i) => i);
  let guard = 0;
  while (idx.length > 3 && guard++ < 100000) {
    let best = -1, bestQ = -Infinity;
    for (let k = 0; k < idx.length; k++) {
      const a = pts[idx[(k + idx.length - 1) % idx.length]], b = pts[idx[k]], c = pts[idx[(k + 1) % idx.length]];
      if (ccw(a, b, c) <= 1e-12) continue;
      let ok = true;
      for (const j of idx) { const p = pts[j]; if (p !== a && p !== b && p !== c && inTri(p, a, b, c)) { ok = false; break; } }
      if (!ok) continue;
      // (the ear with the best shape first: fewer slivers)
      const e = [Math.hypot(a.x - b.x, a.z - b.z), Math.hypot(b.x - c.x, b.z - c.z), Math.hypot(c.x - a.x, c.z - a.z)];
      const q = ccw(a, b, c) / (e[0] * e[0] + e[1] * e[1] + e[2] * e[2]);
      if (q > bestQ) { bestQ = q; best = k; }
    }
    if (best < 0) throw new Error("a junction's patch could not be triangulated (its outline crosses itself: the roads may meet too close to another junction)");
    const k = best;
    tris.push([pts[idx[(k + idx.length - 1) % idx.length]], pts[idx[k]], pts[idx[(k + 1) % idx.length]]]);
    idx.splice(k, 1);
  }
  if (idx.length === 3) tris.push(idx.map((i) => pts[i]));
  // the outline's edges stay as they are
  const key = (a, b) => (a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`);
  let nid = 0;
  const ids = new Map();
  const id = (v) => { if (!ids.has(v)) ids.set(v, nid++); return ids.get(v); };
  for (const p of pts) v_id(p);
  function v_id(v) { v.id = id(v); }
  const fixed = new Set(pts.map((p, i) => key(p, pts[(i + 1) % pts.length])));
  const T = tris.map((t) => { t.forEach(v_id); return t; });
  const edges = () => {
    const m = new Map();
    T.forEach((t, ti) => { for (let e = 0; e < 3; e++) { const k = key(t[e], t[(e + 1) % 3]); if (!m.has(k)) m.set(k, []); m.get(k).push(ti); } });
    return m;
  };
  const len = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  // points on a grid inside (not near the outline), each put in the triangle it falls in, which is split in three
  {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    const g = maxLen * 0.8;
    const segDist = (px, pz, a, b) => { const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / l2)); return Math.hypot(px - a.x - dx * t, pz - a.z - dz * t); };
    for (let z = z0 + g / 2; z < z1; z += g) for (let x = x0 + g / 2 + (Math.round((z - z0) / g) % 2) * g * 0.5; x < x1; x += g) {
      let near = false;
      for (let i = 0; i < pts.length && !near; i++) if (segDist(x, z, pts[i], pts[(i + 1) % pts.length]) < g * 0.55) near = true;
      if (near) continue;
      const ti = T.findIndex(([a, b, c]) => ccw(a, b, { x, z }) > 1e-9 && ccw(b, c, { x, z }) > 1e-9 && ccw(c, a, { x, z }) > 1e-9);
      if (ti < 0) continue;
      const [a, b, c] = T[ti], p = make(x, z);
      v_id(p);
      T[ti] = [a, b, p]; T.push([b, c, p], [c, a, p]);
    }
  }
  flips();
  for (let round = 0; round < 4000; round++) {
    const m = edges();
    let worst = null, wl = maxLen;
    for (const [k, ts] of m) {
      if (fixed.has(k) || ts.length !== 2) continue;
      const t = T[ts[0]];
      let a, b;
      for (let e = 0; e < 3; e++) if (key(t[e], t[(e + 1) % 3]) === k) { a = t[e]; b = t[(e + 1) % 3]; }
      const l = len(a, b);
      if (l > wl) { wl = l; worst = { a, b, ts }; }
    }
    if (!worst) break;
    const mid = make((worst.a.x + worst.b.x) / 2, (worst.a.z + worst.b.z) / 2);
    v_id(mid);
    for (const ti of worst.ts) {
      const t = T[ti];
      const ia = t.indexOf(worst.a), ib = t.indexOf(worst.b), ic = 3 - ia - ib, c = t[ic];
      // (keep the winding: replace b by mid in one half, a by mid in the other)
      const t1 = t.slice(), t2 = t.slice();
      t1[ib] = mid; t2[ia] = mid;
      T[ti] = t1; T.push(t2);
      void c;
    }
  }
  flips();
  for (const v of ids.keys()) delete v.id;
  return T;
  // Delaunay flips on inside edges where the quad is convex
  function flips() {
  for (let pass = 0; pass < 400; pass++) {
    let flipped = 0;
    const m = edges();
    const done = new Set();
    for (const [k, ts] of m) {
      if (fixed.has(k) || ts.length !== 2 || done.has(ts[0]) || done.has(ts[1])) continue;
      const t1 = T[ts[0]], t2 = T[ts[1]];
      const shared = t1.filter((v) => t2.includes(v));
      if (shared.length !== 2) continue;
      const p = t1.find((v) => !shared.includes(v)), q = t2.find((v) => !shared.includes(v));
      // the shared edge a->b as it runs in t1 (counter-clockwise)
      const i1 = t1.indexOf(p), a = t1[(i1 + 1) % 3], b = t1[(i1 + 2) % 3];
      // in circle: is q inside the circle through p, a, b?
      const adx = p.x - q.x, adz = p.z - q.z, bdx = a.x - q.x, bdz = a.z - q.z, cdx = b.x - q.x, cdz = b.z - q.z;
      const det = (adx * adx + adz * adz) * (bdx * cdz - cdx * bdz) - (bdx * bdx + bdz * bdz) * (adx * cdz - cdx * adz) + (cdx * cdx + cdz * cdz) * (adx * bdz - bdx * adz);
      if (det <= 1e-9) continue;
      // flip to p-q only if both new triangles are counter-clockwise (the quad is convex)
      if (ccw(p, a, q) <= 1e-9 || ccw(p, q, b) <= 1e-9) continue;
      T[ts[0]] = [p, a, q]; T[ts[1]] = [p, q, b];
      done.add(ts[0]); done.add(ts[1]);
      flipped++;
    }
    if (!flipped) break;
  }
  }
}

// ---- the glTF ----------------------------------------------------------------------------------------------------------------------------
/// The network's mesh as a binary glTF: the same material, pictures and attributes as trackgen's textured ribbon (so one road sheet
/// draws every road), each triangle its own three vertices facing up.
export function networkGlb(mesh) {
  const positions = [], normals = [], colors = [], uvs = [];
  for (const t of mesh.tris) {
    let [a, b, c] = t.v, [la, lb, lc] = t.look;
    let nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y), ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z), nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (ny < 0) { [b, c] = [c, b]; [lb, lc] = [lc, lb]; nx = -nx; ny = -ny; nz = -nz; }
    const l = Math.hypot(nx, ny, nz) || 1;
    for (const [v, lk] of [[a, la], [b, lb], [c, lc]]) { positions.push(v.x, v.y, v.z); normals.push(nx / l, ny / l, nz / l); colors.push(...lk.col, 1); uvs.push(...lk.uv); }
  }
  const P = new Float32Array(positions), N = new Float32Array(normals), C = new Float32Array(colors), T = new Float32Array(uvs);
  const count = positions.length / 3;
  const I = new Uint32Array(count).map((_, i) => i);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < P.length; k++) { min[k % 3] = Math.min(min[k % 3], P[k]); max[k % 3] = Math.max(max[k % 3], P[k]); }
  const linear = { magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 };
  return packGlb({
    asset: { version: "2.0", generator: "nova scripts/lib/roadnet.mjs" },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: "roads", mesh: 0 }],
    meshes: [{ name: "roads", primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2, TEXCOORD_0: 3 }, indices: 4, material: 0, mode: 4 }] }],
    materials: [{ name: "road", pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 }, extras: { nova: { detail: { index: 1, scale: [S.repeat, S.repeat] } } } }],
    textures: [{ source: 0, sampler: 0 }, { source: 1, sampler: 0 }],
    samplers: [linear],
    images: [{ uri: S.sheet }, { uri: S.grain }],
    accessors: [
      { bufferView: 0, componentType: 5126, count, type: "VEC3", min, max },
      { bufferView: 1, componentType: 5126, count, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count, type: "VEC4" },
      { bufferView: 3, componentType: 5126, count, type: "VEC2" },
      { bufferView: 4, componentType: 5125, count, type: "SCALAR" },
    ],
  }, [P, N, C, T, I]);
}

// ---- the proof ---------------------------------------------------------------------------------------------------------------------------
/// Checks a surface (triangles as [[x, y, z] x 3], optionally with `kind` and `piece`): every edge is used by one triangle (the outline)
/// or by exactly two (inside), with the same end points, never more; no point is covered twice (overlap) and every point inside the
/// outline is covered (no hole), sampled every `step` metres; a place has one height; the outline's loops. Returns the numbers and the
/// problems found.
export function checkSurface(tris, { step = 0.2 } = {}) {
  const problems = [];
  const k3 = (p) => `${p[0].toFixed(5)},${p[2].toFixed(5)}`;
  const heights = new Map();
  for (const t of tris) for (const p of t.v) {
    const k = k3(p);
    if (heights.has(k) && Math.abs(heights.get(k) - p[1]) > 1e-5) problems.push(`two heights at ${k}: ${heights.get(k)} and ${p[1]}`);
    heights.set(k, p[1]);
  }
  const edges = new Map();
  let area = 0;
  for (const t of tris) {
    const [a, b, c] = t.v;
    area += Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0])) / 2;
    for (let e = 0; e < 3; e++) {
      const p = t.v[e], q = t.v[(e + 1) % 3], kp = k3(p), kq = k3(q), key = kp < kq ? `${kp}|${kq}` : `${kq}|${kp}`;
      if (!edges.has(key)) edges.set(key, { n: 0, p, q, kinds: [] });
      const ed = edges.get(key);
      ed.n++;
      ed.kinds.push(t);
    }
  }
  const outline = [];
  for (const [k, e] of edges) {
    if (e.n > 2) problems.push(`an edge used by ${e.n} triangles: ${k}`);
    if (e.n === 1) outline.push(e);
  }
  // coverage: count the triangles over each sample point (points on an edge are left out)
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const t of tris) for (const p of t.v) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); }
  const ox = x0 + step * 0.3731, oz = z0 + step * 0.6119;
  const nx = Math.ceil((x1 - ox) / step) + 1, nz = Math.ceil((z1 - oz) / step) + 1;
  const count = new Uint8Array(nx * nz), edge = new Uint8Array(nx * nz);
  for (const t of tris) {
    const [a, b, c] = t.v;
    const d = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
    if (Math.abs(d) < 1e-12) continue;
    const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0], c[0]) - ox) / step)), i1 = Math.min(nx - 1, Math.ceil((Math.max(a[0], b[0], c[0]) - ox) / step));
    const j0 = Math.max(0, Math.floor((Math.min(a[2], b[2], c[2]) - oz) / step)), j1 = Math.min(nz - 1, Math.ceil((Math.max(a[2], b[2], c[2]) - oz) / step));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = ox + i * step, pz = oz + j * step;
      const w0 = ((b[0] - px) * (c[2] - pz) - (b[2] - pz) * (c[0] - px)) / d, w1 = ((c[0] - px) * (a[2] - pz) - (c[2] - pz) * (a[0] - px)) / d, w2 = 1 - w0 - w1;
      const m = Math.min(w0, w1, w2);
      if (m > 1e-7) count[j * nx + i]++;
      else if (m > -1e-7) edge[j * nx + i] = 1;
    }
  }
  // inside the outline: even-odd against the outline's edges, a ray toward +x
  const byRow = new Map();
  for (const e of outline) {
    const za = e.p[2], zb = e.q[2];
    const j0 = Math.max(0, Math.ceil((Math.min(za, zb) - oz) / step)), j1 = Math.min(nz - 1, Math.floor((Math.max(za, zb) - oz) / step));
    for (let j = j0; j <= j1; j++) {
      const pz = oz + j * step;
      if ((za > pz) === (zb > pz)) continue;
      const x = e.p[0] + ((pz - za) / (zb - za)) * (e.q[0] - e.p[0]);
      if (!byRow.has(j)) byRow.set(j, []);
      byRow.get(j).push(x);
    }
  }
  let holes = 0, overlaps = 0, covered = 0, firstHole = null, firstOverlap = null;
  for (let j = 0; j < nz; j++) {
    const xs = (byRow.get(j) ?? []).sort((a, b) => a - b);
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (edge[k]) continue;
      const px = ox + i * step;
      let crossings = 0;
      for (const x of xs) if (x > px) crossings++;
      const inside = crossings % 2 === 1;
      if (count[k] >= 2) { overlaps++; firstOverlap ??= [px, oz + j * step]; }
      if (count[k] === 1) covered++;
      if (inside && count[k] === 0) { holes++; firstHole ??= [px, oz + j * step]; }
    }
  }
  if (overlaps) problems.push(`${overlaps} sample points covered twice (overlap), the first at ${firstOverlap.map((v) => v.toFixed(2))}`);
  if (holes) problems.push(`${holes} sample points inside the outline not covered (a hole), the first at ${firstHole.map((v) => v.toFixed(2))}`);
  // the outline's loops: every outline vertex has two outline edges (else an edge stops on a vertex it does not share: a T-junction)
  const degree = new Map();
  for (const e of outline) for (const p of [e.p, e.q]) degree.set(k3(p), (degree.get(k3(p)) ?? 0) + 1);
  const odd = [...degree].filter(([, n]) => n % 2);
  if (odd.length) problems.push(`${odd.length} outline vertices where the outline does not close (a crack or a T-junction), the first at ${odd[0][0]}`);
  // loops
  const adj = new Map();
  for (const e of outline) for (const [a, b] of [[e.p, e.q], [e.q, e.p]]) { const k = k3(a); if (!adj.has(k)) adj.set(k, []); adj.get(k).push(k3(b)); }
  const seen = new Set();
  let loops = 0;
  for (const k of adj.keys()) {
    if (seen.has(k)) continue;
    loops++;
    const stack = [k];
    while (stack.length) { const q = stack.pop(); if (seen.has(q)) continue; seen.add(q); for (const n of adj.get(q)) if (!seen.has(n)) stack.push(n); }
  }
  // (an edge between two triangles of different kinds must be in a transition)
  for (const e of edges.values()) {
    if (e.n !== 2) continue;
    const [t1, t2] = e.kinds;
    if (t1.kind && t2.kind && t1.kind !== t2.kind && !(t1.piece === "feather" || t2.piece === "feather" || t1.piece === "transition" || t2.piece === "transition")) problems.push(`${t1.kind} meets ${t2.kind} with no transition at ${k3(e.p)}`);
  }
  return { triangles: tris.length, area, coveredArea: covered * step * step, holes, overlaps, loops, outlineEdges: outline.length, problems };
}

/// Where the road surface is, for placing things beside it: `clearance(x, z)` is the distance from (x, z) to the surface's outline
/// (its outer edge, the verge included), negative on the surface; `away(x, z)` is the unit direction off it there (out of the
/// surface, or further from it). From the mesh itself, so junction patches, fillets, aprons, caps and pads count.
export function surfaceIndex(mesh) {
  const CELL = 4;
  const k3 = (p) => `${p.x},${p.z}`;
  const count = new Map();
  for (const t of mesh.tris) for (let e = 0; e < 3; e++) {
    const a = t.v[e], b = t.v[(e + 1) % 3], ka = k3(a), kb = k3(b), key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    const c = count.get(key);
    if (c) c.n++; else count.set(key, { n: 1, a, b });
  }
  const bins = new Map();
  const bin = (i, j) => { const k = `${i},${j}`; if (!bins.has(k)) bins.set(k, { edges: [], tris: [] }); return bins.get(k); };
  const span = (xs, zs, fn) => {
    for (let i = Math.floor(Math.min(...xs) / CELL); i <= Math.floor(Math.max(...xs) / CELL); i++) for (let j = Math.floor(Math.min(...zs) / CELL); j <= Math.floor(Math.max(...zs) / CELL); j++) fn(bin(i, j));
  };
  for (const e of count.values()) if (e.n === 1) span([e.a.x, e.b.x], [e.a.z, e.b.z], (b) => b.edges.push(e));
  for (const t of mesh.tris) span(t.v.map((p) => p.x), t.v.map((p) => p.z), (b) => b.tris.push(t));
  const onSurface = (x, z) => {
    const b = bins.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
    if (!b) return false;
    return b.tris.some(({ v: [a, p, c] }) => {
      const d = (p.x - a.x) * (c.z - a.z) - (p.z - a.z) * (c.x - a.x);
      if (Math.abs(d) < 1e-12) return false;
      const w0 = ((p.x - x) * (c.z - z) - (p.z - z) * (c.x - x)) / d, w1 = ((c.x - x) * (a.z - z) - (c.z - z) * (a.x - x)) / d;
      return w0 >= 0 && w1 >= 0 && w0 + w1 <= 1;
    });
  };
  const edgeDist = (x, z) => {
    let best = Infinity;
    for (let r = 0; r <= 6 && best > (r - 1) * CELL; r++) {
      const i0 = Math.floor(x / CELL), j0 = Math.floor(z / CELL);
      for (let i = i0 - r; i <= i0 + r; i++) for (let j = j0 - r; j <= j0 + r; j++) {
        if (Math.max(Math.abs(i - i0), Math.abs(j - j0)) !== r) continue;
        for (const e of bins.get(`${i},${j}`)?.edges ?? []) {
          const dx = e.b.x - e.a.x, dz = e.b.z - e.a.z, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - e.a.x) * dx + (z - e.a.z) * dz) / l2));
          best = Math.min(best, Math.hypot(x - e.a.x - dx * t, z - e.a.z - dz * t));
        }
      }
    }
    return best;
  };
  const clearance = (x, z) => (onSurface(x, z) ? -edgeDist(x, z) : edgeDist(x, z));
  const away = (x, z) => {
    const h = 0.05, gx = clearance(x + h, z) - clearance(x - h, z), gz = clearance(x, z + h) - clearance(x, z - h), l = Math.hypot(gx, gz) || 1;
    return [gx / l, gz / l];
  };
  return { clearance, away, onSurface };
}

/// The network's triangles as plain arrays, for checkSurface.
export const surfaceOf = (mesh) => mesh.tris.map((t) => ({ v: t.v.map((p) => [p.x, p.y, p.z]), kind: t.kind, piece: t.piece }));
