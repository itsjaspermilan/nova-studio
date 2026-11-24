// Where the player may go (the owner's eighth play, note 6: "What can you think of to keep the player on the road and not get stuck in the
// 'empty' areas? I do want to add some secret areas after some time but for the most part we should smartly prevent the user from accessing
// the empty areas"). The playable area is the land near the roads, the yards and the places worth walking to: a band either side of every
// road, a round meadow at each house, the picnic spot, the overlook, the ponds' near shores, cut off before the gorge's bank. It is made
// on a 1 m grid from those shapes, its holes filled, and its outline traced, simplified and rounded (Chaikin) into one smooth polygon,
// written into the valley's scene (a `playable` object) by tools/scene.mjs, which also dresses its edge with things you can see: forest,
// hedges, fences, low walls and rocks (`edgeKinds`). All in metres east and north (E, N), like layout.mjs.

/// The playable area's outline: [[e, n], ...] counter-clockwise (seen from above with north up), about `step` metres apart.
/// shapes: { lines: [{ pts, r }], discs: [{ at, r }], cuts: [(e, n) => true where it may not be] }; bounds: { e0, e1, n0, n1 }.
export function playableOutline(shapes, bounds, step = 3) {
  const C = 1, E0 = bounds.e0, N0 = bounds.n0, W = Math.round((bounds.e1 - E0) / C) + 1, H = Math.round((bounds.n1 - N0) / C) + 1;
  const m = new Uint8Array(W * H);
  const stamp = (e, n, r) => {
    const i0 = Math.max(0, Math.floor((e - r - E0) / C)), i1 = Math.min(W - 1, Math.ceil((e + r - E0) / C));
    const j0 = Math.max(0, Math.floor((n - r - N0) / C)), j1 = Math.min(H - 1, Math.ceil((n + r - N0) / C));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (Math.hypot(E0 + i * C - e, N0 + j * C - n) <= r) m[j * W + i] = 1;
  };
  for (const { pts, r } of shapes.lines) for (let k = 0; k + 1 < pts.length; k++) {
    const [a, b] = [pts[k], pts[k + 1]], l = Math.hypot(b[0] - a[0], b[1] - a[1]), s = Math.max(1, Math.ceil(l / 1));
    for (let q = 0; q <= s; q++) stamp(a[0] + ((b[0] - a[0]) * q) / s, a[1] + ((b[1] - a[1]) * q) / s, typeof r === "function" ? r(a, b) : r);
  }
  for (const { at, r } of shapes.discs) stamp(at[0], at[1], r);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (m[j * W + i] && shapes.cuts.some((f) => f(E0 + i * C, N0 + j * C))) m[j * W + i] = 0;
  // the holes filled: whatever the outside cannot reach is inside
  const seen = new Uint8Array(W * H), stack = [];
  for (let i = 0; i < W; i++) stack.push(i, (H - 1) * W + i);
  for (let j = 0; j < H; j++) stack.push(j * W, j * W + W - 1);
  while (stack.length) {
    const k = stack.pop();
    if (seen[k] || m[k]) continue;
    seen[k] = 1;
    const i = k % W, j = (k - i) / W;
    if (i > 0) stack.push(k - 1);
    if (i < W - 1) stack.push(k + 1);
    if (j > 0) stack.push(k - W);
    if (j < H - 1) stack.push(k + W);
  }
  for (let k = 0; k < W * H; k++) if (!seen[k]) m[k] = 1;
  // keep only the largest piece (a stray island would be a place you could see and never reach)
  const lab = new Int32Array(W * H).fill(-1), sizes = [];
  for (let k0 = 0; k0 < W * H; k0++) {
    if (!m[k0] || lab[k0] >= 0) continue;
    const id = sizes.length;
    let n = 0;
    stack.push(k0);
    while (stack.length) {
      const k = stack.pop();
      if (lab[k] >= 0 || !m[k]) continue;
      lab[k] = id; n++;
      const i = k % W;
      if (i > 0) stack.push(k - 1);
      if (i < W - 1) stack.push(k + 1);
      if (k >= W) stack.push(k - W);
      if (k < W * (H - 1)) stack.push(k + W);
    }
    sizes.push(n);
  }
  const big = sizes.indexOf(Math.max(...sizes));
  const inside = (i, j) => i >= 0 && j >= 0 && i < W && j < H && lab[j * W + i] === big;
  // the outline: the edges between an inside cell and an outside one, chained (cells are squares round their sample point)
  const edges = new Map();
  const key = (x, y) => `${x},${y}`;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (!inside(i, j)) continue;
    // corners of the cell (i - 0.5 .. i + 0.5): counter-clockwise round the inside, with E right and N up
    if (!inside(i, j - 1)) edges.set(key(i - 0.5, j - 0.5), [i + 0.5, j - 0.5]);
    if (!inside(i + 1, j)) edges.set(key(i + 0.5, j - 0.5), [i + 0.5, j + 0.5]);
    if (!inside(i, j + 1)) edges.set(key(i + 0.5, j + 0.5), [i - 0.5, j + 0.5]);
    if (!inside(i - 1, j)) edges.set(key(i - 0.5, j + 0.5), [i - 0.5, j - 0.5]);
  }
  // the longest loop is the outline
  let best = [];
  const used = new Set();
  for (const start of edges.keys()) {
    if (used.has(start)) continue;
    const loop = [];
    let k = start;
    while (!used.has(k) && edges.has(k)) {
      used.add(k);
      const [x, y] = k.split(",").map(Number);
      loop.push([E0 + x * C, N0 + y * C]);
      const nx = edges.get(k);
      k = key(nx[0], nx[1]);
    }
    if (loop.length > best.length) best = loop;
  }
  // simplified (within 0.7 m), rounded twice, then spaced about `step` apart
  let pts = simplify(best, 0.7);
  for (let r = 0; r < 3; r++) pts = chaikin(pts);
  return resample(pts, step);
}

function simplify(loop, tol) {
  const keep = new Uint8Array(loop.length);
  const rec = (a, b) => {
    let far = -1, fd = tol;
    const [ax, ay] = loop[a], [bx, by] = loop[b % loop.length], dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1;
    for (let k = a + 1; k < b; k++) {
      const d = Math.abs((loop[k][0] - ax) * dy - (loop[k][1] - ay) * dx) / l;
      if (d > fd) { fd = d; far = k; }
    }
    if (far >= 0) { keep[far] = 1; rec(a, far); rec(far, b); }
  };
  const half = Math.floor(loop.length / 2);
  keep[0] = keep[half] = 1;
  rec(0, half); rec(half, loop.length);
  return loop.filter((_, k) => keep[k]);
}
function chaikin(p) {
  const out = [];
  for (let k = 0; k < p.length; k++) {
    const a = p[k], b = p[(k + 1) % p.length];
    out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
  }
  return out;
}
function resample(p, step) {
  const n = p.length, cum = [0];
  for (let k = 1; k <= n; k++) cum.push(cum[k - 1] + Math.hypot(p[k % n][0] - p[k - 1][0], p[k % n][1] - p[k - 1][1]));
  const L = cum[n], count = Math.max(8, Math.round(L / step)), out = [];
  let j = 0;
  for (let q = 0; q < count; q++) {
    const s = (q / count) * L;
    while (cum[j + 1] < s) j++;
    const t = (s - cum[j]) / (cum[j + 1] - cum[j] || 1), a = p[j], b = p[(j + 1) % n];
    out.push([Math.round((a[0] + (b[0] - a[0]) * t) * 100) / 100, Math.round((a[1] + (b[1] - a[1]) * t) * 100) / 100]);
  }
  return out;
}

/// Inside a polygon (even-odd)?
export function insidePoly(poly, [e, n]) {
  let c = false;
  for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
    const [xa, za] = poly[a], [xb, zb] = poly[b];
    if ((za > n) !== (zb > n) && e < ((xb - xa) * (n - za)) / (zb - za) + xa) c = !c;
  }
  return c;
}
/// The distance from a point to a polygon's outline.
export function edgeDistance(poly, [e, n]) {
  let best = Infinity;
  for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
    const [ax, az] = poly[b], [bx, bz] = poly[a], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((e - ax) * dx + (n - az) * dz) / l2));
    best = Math.min(best, Math.hypot(e - ax - dx * t, n - az - dz * t));
  }
  return best;
}
