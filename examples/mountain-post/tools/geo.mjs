// Shapes for the model recipes, in METRES (model_write's documents are in model units, 16 to the metre at scale 0.0625: these
// helpers convert). Flat faces, one colour each: the look of the game is clean low-poly shapes in flat warm colours.
export const U = 16;
const u = (v) => Math.round(v * U * 1000) / 1000;
const P = (p) => p.map(u);

/// A box from its middle and size, turned by `rot` [x, y, z] degrees about its middle; `bevel` rounds its edges (metres).
export function box(c, size, color, o = {}) {
  const [w, h, d] = size;
  const cube = { shape: "box", from: P([c[0] - w / 2, c[1] - h / 2, c[2] - d / 2]), size: P(size), color };
  if (o.rot) cube.rotation = o.rot;
  if (o.emissive) cube.emissive = o.emissive;
  if (o.bevel) return bevelled(c, size, color, o);
  return cube;
}

/// The eight corners of a box (turned about y by `ry` degrees, or by `rot` [x, y, z] degrees about its middle, X then Y then Z as
/// model_write turns a box), as a mesh with a bevel modifier: soft edges.
export function bevelled(c, size, color, o = {}) {
  const [w, h, d] = size.map((v) => v / 2);
  const [rx, ry, rz] = (o.rot ?? [0, o.ry ?? 0, 0]).map((v) => (v * Math.PI) / 180);
  const turn = ([x, y, z]) => {
    let a = Math.cos(rx), b = Math.sin(rx);
    [y, z] = [y * a - z * b, y * b + z * a];
    a = Math.cos(ry); b = Math.sin(ry);
    [x, z] = [x * a + z * b, -x * b + z * a];
    a = Math.cos(rz); b = Math.sin(rz);
    [x, y] = [x * a - y * b, x * b + y * a];
    return [x, y, z];
  };
  const t = o.taper ?? 1; // the top narrower (x) than the bottom
  const tz = o.taperZ ?? 1;
  const vs = [];
  for (const sy of [-1, 1]) for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
    const [x, y, z] = turn([sx * w * (sy > 0 ? t : 1), sy * h, sz * d * (sy > 0 ? tz : 1)]);
    vs.push([c[0] + x, c[1] + y, c[2] + z]);
  }
  return mesh(vs, [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]], color, { ...o, modifiers: o.bevel ? [{ type: "bevel", width: u(o.bevel), segments: o.segments ?? 1, angle: 30 }] : undefined });
}

/// A free mesh from points (metres) and faces (lists of point numbers, counter-clockwise seen from outside).
/// Every face is turned to look away from the middle of all the points (`inside` to give another middle), so a convex solid needs no
/// care about the order of its points.
export function mesh(verts, faces, color, o = {}) {
  const mid = o.inside ?? verts.reduce((m, v) => m.map((x, i) => x + v[i] / verts.length), [0, 0, 0]);
  const orient = (f) => {
    const n = [0, 0, 0], c = [0, 0, 0];
    f.forEach((i, k) => {
      const a = verts[i], b = verts[f[(k + 1) % f.length]];
      n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]);
      for (let j = 0; j < 3; j++) c[j] += a[j] / f.length;
    });
    const out = n[0] * (c[0] - mid[0]) + n[1] * (c[1] - mid[1]) + n[2] * (c[2] - mid[2]);
    return out < 0 ? [...f].reverse() : f;
  };
  const cube = { shape: "mesh", color, verts: verts.map(P), polys: faces.map((f) => (Array.isArray(f) ? { v: o.keep ? f : orient(f) } : { ...f, v: o.keep ? f.v : orient(f.v) })) };
  if (o.modifiers) cube.modifiers = o.modifiers;
  if (o.emissive) cube.emissive = o.emissive;
  if (o.smooth) cube.polys.forEach((p) => (p.smooth = true));
  return cube;
}

/// A cylinder standing along y (or laid along "x" / "z"), from its middle.
export function cyl(c, r, len, color, o = {}) {
  const axis = o.axis ?? "y";
  const cube = { shape: "cylinder", from: P([c[0] - r, c[1] - len / 2, c[2] - r]), size: P([2 * r, len, 2 * r]), color, segments: o.segments ?? 12 };
  if (axis === "z") cube.rotation = [90, 0, 0];
  if (axis === "x") cube.rotation = [0, 0, 90];
  if (o.emissive) cube.emissive = o.emissive;
  if (o.smooth) cube.smooth = true;
  return cube;
}
export function cone(c, r, len, color, o = {}) {
  return { shape: "cone", from: P([c[0] - r, c[1] - len / 2, c[2] - r]), size: P([2 * r, len, 2 * r]), color, segments: o.segments ?? 8 };
}

/// A round limb, rail or branch along points (metres).
export function tube(points, radius, color, o = {}) {
  const t = { shape: "tube", points: points.map(P), segments: o.segments ?? 6, color };
  if (Array.isArray(radius)) t.radii = radius.map(u); else t.radius = u(radius);
  return t;
}

/// A shape turned on a lathe about y: [[radius, height], ...] in metres.
export function lathe(at, profile, color, o = {}) {
  return { shape: "lathe", profile: profile.map(([r, y]) => [u(r), u(y)]), segments: o.segments ?? 12, axis: "y", at: P(at), color };
}

/// A gable roof over a w x d plan whose eaves are at height y0 and ridge at y1, running along z, with an overhang.
export function gable(c, w, d, y0, y1, color, o = {}) {
  const hw = w / 2 + (o.over ?? 0.3), hd = d / 2 + (o.overZ ?? o.over ?? 0.3), th = o.thick ?? 0.12;
  const [x, , z] = c;
  const v = [
    [x - hw, y0, z - hd], [x, y1, z - hd], [x + hw, y0, z - hd],
    [x - hw, y0, z + hd], [x, y1, z + hd], [x + hw, y0, z + hd],
    [x - hw, y0 - th, z - hd], [x, y1 - th, z - hd], [x + hw, y0 - th, z - hd],
    [x - hw, y0 - th, z + hd], [x, y1 - th, z + hd], [x + hw, y0 - th, z + hd],
  ];
  return mesh(v, [[0, 3, 4, 1], [1, 4, 5, 2], [6, 7, 10, 9], [7, 8, 11, 10], [0, 1, 7, 6], [1, 2, 8, 7], [3, 9, 10, 4], [4, 10, 11, 5], [0, 6, 9, 3], [2, 5, 11, 8]].map((f) => f), color);
}

/// A triangle of wall (a gable end) in the plane z = zf, from x0 to x1 at height y0 up to y1 in the middle.
export function gableEnd(x0, x1, y0, y1, zf, color, thick = 0.12) {
  const xm = (x0 + x1) / 2;
  return mesh([[x0, y0, zf - thick / 2], [x1, y0, zf - thick / 2], [xm, y1, zf - thick / 2], [x0, y0, zf + thick / 2], [x1, y0, zf + thick / 2], [xm, y1, zf + thick / 2]],
    [[0, 2, 1], [3, 4, 5], [0, 3, 5, 2], [1, 2, 5, 4], [0, 1, 4, 3]], color);
}

export function part(name, origin, cubes, children = [], rotation = [0, 0, 0]) {
  return { name, origin: P(origin), rotation, cubes, children };
}
/// A model document. `extra` may carry what it blocks, given here in metres (colliders, capsules, boxes; a box's turn in degrees):
/// the document keeps them in model units, like its points.
export function model(parts, extra = {}) {
  const out = { ...extra };
  if (extra.colliders) out.colliders = extra.colliders.map((c) => ({ x: u(c.x), z: u(c.z), r: u(c.r) }));
  if (extra.capsules) out.capsules = extra.capsules.map((c) => ({ ax: u(c.ax), az: u(c.az), bx: u(c.bx), bz: u(c.bz), r: u(c.r) }));
  if (extra.boxes) out.boxes = extra.boxes.map((c) => ({ x: u(c.x), z: u(c.z), hw: u(c.hw), hl: u(c.hl), turn: c.turn ?? 0 }));
  return { version: 1, scale: 1 / U, parts, ...out };
}
/// A model of one part, its shapes given relative to the model's origin.
export const one = (cubes, extra = {}) => model([part("body", [0, 0, 0], cubes)], extra);

/// A colour a little lighter (k > 0) or darker (k < 0).
export function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k))));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map(f).map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/// A seeded random source (the same recipe makes the same files).
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
