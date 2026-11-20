// Proposes the route of a racing track from a seed: the control points the track editor (and `track_write`) turn into a road, scenery,
// crowd and gates (scripts/lib/trackgen.mjs). The same options and seed always give the same route.
//
//   randomRoute({ open, length, curviness, seed })  ->  { control, length, minRadius, closest, tries, ok }
//
// - `open`: false for a circuit (a loop), true for a stage (start to finish). `length`: metres along the road (about; circuits 800 to 5000,
//   stages 1000 to 10000). `curviness`: 0 (sweeping, few bends) to 1 (twisty, with hairpins). `seed`: any whole number.
// - A circuit is a wobbly ring (radius changed by a few smooth waves round the circle), so it can never cross itself; a stage is a walk
//   whose heading drifts and now and then swings into a hairpin. Many candidates are made from the seed and each is checked with the
//   same measures the editor warns about (a bend tighter than MIN_RADIUS m, parts of the road closer than MIN_GAP m); the first that
//   passes is returned. If none does, the best one is, with `ok: false` (try another seed).
// - The start is moved to the straightest place and the route turned to head along +z from the origin, so the start line is on a straight.
import { centreline, curvature, rng, tightest } from "./trackgen.mjs";

export const MIN_RADIUS = 28; // metres across a bend (the editor warns under 15; cars drive 28 comfortably at speed)
export const MIN_GAP = 60; // metres between far-apart parts of the road (the editor warns under 40; walls and crowd need room)
const SPACING = 5;
const TRIES = 300;
const r1 = (n) => Math.round(n * 10) / 10;

/// Measures a route the way the editor does.
export function measure(control, open) {
  const line = centreline(control, SPACING, open);
  const curv = curvature(line, SPACING, open);
  const peak = Math.max(...curv.map(Math.abs));
  const near = tightest(line, SPACING);
  return {
    length: open ? (line.length - 1) * SPACING : line.length * SPACING,
    minRadius: peak > 0 ? Math.round(1 / peak) : Infinity,
    closest: near > 1e6 ? null : near,
  };
}

/// Starts the loop at its straightest control point (the least turning between its neighbours).
function straightestFirst(control) {
  const n = control.length;
  const turn = (i) => {
    const a = control[(i + n - 1) % n], b = control[i], c = control[(i + 1) % n];
    const h1 = Math.atan2(b[0] - a[0], b[1] - a[1]), h2 = Math.atan2(c[0] - b[0], c[1] - b[1]);
    let d = h2 - h1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return Math.abs(d);
  };
  let best = 0, bestTurn = Infinity;
  for (let i = 0; i < n; i++) {
    const t = turn(i) + 0.5 * (turn((i + 1) % n) + turn((i + n - 1) % n));
    if (t < bestTurn) { bestTurn = t; best = i; }
  }
  return [...control.slice(best), ...control.slice(0, best)];
}

/// Moves the first point to the origin and turns the route so that it heads along +z.
function normalise(control) {
  const [x0, z0] = control[0], [x1, z1] = control[1];
  const h = Math.atan2(x1 - x0, z1 - z0), c = Math.cos(h), s = Math.sin(h);
  return control.map(([x, z]) => {
    const dx = x - x0, dz = z - z0;
    return [r1(dx * c - dz * s) + 0, r1(dx * s + dz * c) + 0]; // (+ 0: no negative zero)
  });
}

function ring(rand, length, curviness) {
  const n = Math.max(10, Math.min(44, Math.round(length / 100)));
  const waves = [];
  for (let k = 2; k <= 6; k++) waves.push({ k, a: (0.1 + 0.55 * curviness) * (0.4 + 0.6 * rand()) / k ** 0.85, phase: rand() * 2 * Math.PI });
  const squash = 0.5 + 0.5 * rand(); // narrower than long, so that there are straights and bends, not just a circle
  const spin = rand() < 0.5 ? 1 : -1;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const th = ((i + 0.3 * (rand() * 2 - 1)) / n) * 2 * Math.PI;
    let r = 1;
    for (const w of waves) r += w.a * Math.cos(w.k * th + w.phase);
    r = Math.max(0.45, r);
    pts.push([r * Math.cos(th) * spin, r * Math.sin(th) * squash]);
  }
  // scale to the length asked for (the length is proportional to the size)
  const base = measure(pts.map(([x, z]) => [x * 100, z * 100]), false).length;
  const scale = (length / base) * 100;
  return pts.map(([x, z]) => [x * scale, z * scale]);
}

function walk(rand, length, curviness) {
  const step = 55 + 35 * (1 - curviness); // control points are further apart on a sweeping stage
  const n = Math.max(6, Math.round(length / (step * 0.95)));
  const pts = [[0, 0]];
  let heading = 0, drift = 0, hairpin = 0, hairpinDir = 1;
  for (let i = 1; i < n; i++) {
    drift = 0.55 * drift + (rand() * 2 - 1) * (0.1 + 0.5 * curviness);
    let turn = drift;
    if (hairpin > 0) { turn = hairpinDir * 0.75; hairpin--; } // a hairpin: about 170 degrees over three points
    else if (i > 2 && rand() < 0.04 + 0.1 * curviness * curviness) { hairpin = 2; hairpinDir = rand() < 0.5 ? 1 : -1; turn = hairpinDir * 0.75; }
    heading += turn;
    const d = step * (0.8 + 0.4 * rand());
    const [px, pz] = pts[i - 1];
    pts.push([px + Math.sin(heading) * d, pz + Math.cos(heading) * d]);
  }
  return pts;
}

export function randomRoute({ open = false, length = open ? 3000 : 2000, curviness = 0.5, seed = 1 } = {}) {
  curviness = Math.max(0, Math.min(1, curviness));
  length = Math.max(open ? 800 : 600, length);
  let best = null;
  for (let t = 0; t < TRIES; t++) {
    const rand = rng((seed >>> 0) * 7919 + t * 104729 + 17);
    let control = open ? walk(rand, length, curviness) : ring(rand, length, curviness);
    if (!open) control = straightestFirst(control);
    control = normalise(control);
    const m = measure(control, open);
    // a candidate's score: how far it is from passing (0 passes); a loop also has to come near the length asked for
    const lenErr = Math.abs(m.length - length) / length;
    const miss = Math.max(0, MIN_RADIUS - m.minRadius) / MIN_RADIUS + (m.closest === null ? 0 : Math.max(0, MIN_GAP - m.closest) / MIN_GAP) + Math.max(0, lenErr - 0.12);
    const pick = { control, length: m.length, minRadius: m.minRadius, closest: m.closest, tries: t + 1, ok: miss === 0, miss };
    if (miss === 0) return pick;
    if (!best || miss < best.miss) best = pick;
  }
  return best;
}
