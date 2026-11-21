// car_make's `spec`: a whole car written out the way the car files in cars/ build one, as data, for anyone tracing a blueprint
// (see docs/car-proportions.md and README.md here). Units are model units, 16 to the metre; y is up from the ground, the nose
// points along +z, x = 0 is the middle and z = 0 is best put midway between the axles.
//
//   { "paint": "#b5202c",
//     "body": { the kit's buildBody spec: w, yb, top, ys, rw, drop, crown, ledge, rail, hoodP, profile, rows, stations, front, rear, crease... },
//     "wheels": { "R": 5, "track": 11.8, "z": [20.1, -20.1], "width": 3.5, "rim_r": 3.65, "spokes": 5, "rim": "#c3c8d0", "caliper": "#c0262d" },
//     "arches": { "r": 6.0 },                    wheel openings cut round every wheel, with the dark wheel houses behind them
//     "cuts": [ { "view": "side", "name": "side glass", "points": <outline>, "glass": true }, ... ],   everything cut INTO the skin
//     "pieces": [ { "shape": "pebble", "name": "mirror", "a": [...], "b": [...], "color": "paint", "mirror": true }, ... ],   what is a separate piece
//     "tail": [x, y, z] }                        where the rear lamps are, in metres (worked out from the back when left out)
//
// An outline is a list of points or one of: { "rounded": outline, "times": 1 }, { "inset": outline, "d": 0.3 } (negative: outwards),
// { "stroke": line, "w": 0.16 } (a thin outline along a line: a panel gap), { "path": points, "n": 8 } (a smooth line through them),
// { "ellipse": [cx, cy, rx, ry], "n": 16 }, { "rect": [x0, y0, x1, y1] }, { "rrect": [x0, y0, x1, y1], "r": 0.3 }, { "fillet": outline, "r": 0.5 },
// { "arch": [zc, yc, r] } (a wheel opening), { "mirrorX": half outline }, { "join": [line, line, ...] }. A point [x, y, 1] stays a sharp corner.
// A colour is "#rrggbb" or "paint", "gap" (the panel gaps' dark paint), "trim", "dark", "glass", or { "shade": ["paint", 0.5] }.
// A point of a piece may sit on the skin: { "top": [x, z, lift] }, { "side": [z, y, lift] }, { "front": [x, y, lift] }, { "back": [x, y, lift] }.

// @ts-ignore (plain JavaScript)
import * as kit from "./kit.mjs";

type Args = Record<string, any>;
type Pt = number[];
/// The values of a curve: [[t, value], ...] or one number.
const vals = (c: unknown): number[] => (typeof c === "number" ? [c] : (c as Pt[]).map((p) => p[1]!));

const MATERIALS: Record<string, Args> = { paint: kit.PAINT, glass: kit.GLASS, rubber: kit.RUBBER, steel: kit.STEEL, chrome: kit.CHROME, plastic: kit.PLASTIC, matt: { metallic: 0, roughness: 0.9 } };
const SHAPES = ["box", "pebble", "hexa", "cyl", "bar", "lattice", "tube", "blade", "slab", "mesh"];

function fail(where: string, what: string): never {
  throw new Error(`spec ${where}: ${what}`);
}

/// An outline (or a line) from its description.
export function outline(v: unknown, where: string): Pt[] {
  if (Array.isArray(v)) {
    if (v.every((p) => Array.isArray(p) && p.length >= 2 && p.every((x: unknown) => typeof x === "number"))) return v as Pt[];
    fail(where, "a list of points is [[x, y], ...] (numbers)");
  }
  if (!v || typeof v !== "object") fail(where, "an outline is a list of points or one of rounded, inset, stroke, path, ellipse, rect, rrect, fillet, arch, mirrorX, join");
  const o = v as Args, n = (k: string, d?: number) => (o[k] === undefined ? d : Number(o[k]));
  if (o.rounded) return kit.rounded(outline(o.rounded, `${where}.rounded`), n("times", 2));
  if (o.inset) return kit.inset(outline(o.inset, `${where}.inset`), n("d", 0.3));
  if (o.stroke) return kit.stroke(outline(o.stroke, `${where}.stroke`), n("w", 0.16));
  if (o.path) return kit.path(outline(o.path, `${where}.path`), n("n", 12));
  if (o.ellipse) { const [cx, cy, rx, ry] = o.ellipse; return kit.ellipse(cx, cy, rx, ry ?? rx, n("n", 20)); }
  if (o.rect) { const [x0, y0, x1, y1] = o.rect; return kit.rect(x0, y0, x1, y1); }
  if (o.rrect) { const [x0, y0, x1, y1] = o.rrect; return kit.rrect(x0, y0, x1, y1, n("r", 0.3)); }
  if (o.fillet) return kit.fillet(outline(o.fillet, `${where}.fillet`), n("r", 0.5));
  if (o.arch) { const [zc, yc, r] = o.arch; return kit.archOutline(zc, yc, r); }
  if (o.mirrorX) return kit.mirrorX(outline(o.mirrorX, `${where}.mirrorX`));
  if (o.join) return (o.join as unknown[]).flatMap((l, i) => outline(l, `${where}.join[${i}]`));
  fail(where, `${JSON.stringify(Object.keys(o))} is not an outline: use rounded, inset, stroke, path, ellipse, rect, rrect, fillet, arch, mirrorX or join`);
}

export function carFromSpec(spec: unknown): Args {
  if (!spec || typeof spec !== "object") fail("", "is an object: { paint, body, wheels, arches, cuts, pieces, tail }");
  const s = spec as Args;
  const known = ["paint", "body", "wheels", "arches", "cuts", "pieces", "tail", "floor"];
  const bad = Object.keys(s).filter((k) => !known.includes(k));
  if (bad.length) fail("", `has ${bad.join(", ")}; it takes ${known.join(", ")}`);
  const paint = typeof s.paint === "string" ? s.paint : "#b5202c", gap = kit.shade(paint, 0.22);
  const colour = (c: unknown, where: string): string => {
    if (c === undefined || c === "paint") return paint;
    if (c === "gap") return gap;
    if (c === "trim") return kit.TRIM;
    if (c === "dark") return kit.DARK;
    if (c === "glass") return kit.GLASS_COL;
    if (Array.isArray((c as Args)?.shade)) return kit.shade(colour((c as Args).shade[0], where), Number((c as Args).shade[1]));
    if (typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c)) return c;
    fail(where, `colour ${JSON.stringify(c)} is "#rrggbb", "paint", "gap", "trim", "dark", "glass" or { "shade": [colour, factor] }`);
  };
  if (!s.body || typeof s.body !== "object") fail("body", "is the kit's buildBody spec: { w, yb, top, ys, rw, profile, front, rear, ... } (see makers/car/cars/s14.mjs)");
  for (const k of ["w", "yb", "top", "ys", "rw", "profile", "front", "rear"]) if (s.body[k] === undefined) fail(`body.${k}`, "is needed (see makers/car/cars/s14.mjs for what each curve is)");
  const W = s.wheels ?? {};
  const R = Number(W.R ?? 5), track = Number(W.track ?? 11.8), wheelZ: number[] = W.z ?? [20, -20];
  if (!Array.isArray(wheelZ) || wheelZ.length !== 2) fail("wheels.z", "is [front axle z, rear axle z]");
  let built: Args;
  try {
    built = kit.buildBody({ ...s.body, paint });
  } catch (e) {
    fail("body", `could not be built: ${(e as Error).message}`);
  }
  const { body, at } = built;
  const cuts: Args[] = [];
  const cubes: Args[] = [body];
  // wheel openings and the wheel houses behind them
  if (s.arches !== false) {
    const ar = s.arches ?? {}, r = Number(ar.r ?? R * 1.2), yc = Number(ar.y ?? R - 0.05);
    const arches = wheelZ.map((z) => kit.archOutline(z, yc, r));
    for (const points of arches) cuts.push({ view: "side", points, remove: true, depth: 0.7, wall: kit.shade(paint, 0.5), facing: -1, near: 9 });
    const xOut = Math.max(...vals(s.body.w)) * 0.97;
    for (const [k] of wheelZ.entries()) for (const sx of [1, -1]) cubes.push(kit.archLiner(`wheel house ${k} ${sx}`, arches[k].slice(1, -1), xOut, track - 3.2, sx));
  }
  (Array.isArray(s.cuts) ? s.cuts : []).forEach((c: Args, i: number) => {
    const where = `cuts[${i}]${c?.name ? ` ("${c.name}")` : ""}`;
    if (!c || typeof c !== "object") fail(where, "is { view, points, ... }");
    if (!["side", "front", "back", "top", "bottom"].includes(c.view)) fail(where, `view is side, front, back, top or bottom, not ${JSON.stringify(c.view)}`);
    const { glass, chrome, ...rest } = c;
    const cut: Args = { facing: 0.5, ...rest, points: outline(c.points, `${where}.points`) };
    if (glass) Object.assign(cut, kit.glassOf(), { name: c.name ?? "glass" });
    if (chrome) Object.assign(cut, { color: "#c9ced6", ...kit.CHROME });
    if (c.color !== undefined) cut.color = colour(c.color, where);
    if (c.wall !== undefined) cut.wall = colour(c.wall, `${where}.wall`);
    cuts.push(cut);
  });
  body.modifiers.push({ type: "cutout", cuts });
  if (s.floor !== false) {
    const yb = Math.min(...vals(s.body.yb)), xw = Math.max(...vals(s.body.w)) * 0.8;
    cubes.push(kit.box("floor", -xw, xw, yb + 0.2, yb + 0.7, s.body.rear.zc + 2, s.body.front.zc - 2, "#0b0c0e", { material: { metallic: 0, roughness: 1 } }));
  }
  // a point of a piece: a number triple, or on the skin
  const P = (p: unknown, where: string): Pt => {
    if (Array.isArray(p) && p.length === 3 && p.every((x) => typeof x === "number")) return p as Pt;
    const o = p as Args;
    if (o?.top) { const [x, z, l = 0] = o.top; return [x, at.top(x, z) + l, z]; }
    if (o?.side) { const [z, y, l = 0] = o.side; return [at.side(z, y) + l, y, z]; }
    if (o?.front) { const [x, y, l = 0] = o.front; return [x, y, at.front(x, y) + l]; }
    if (o?.back) { const [x, y, l = 0] = o.back; return [x, y, at.back(x, y) - l]; }
    fail(where, `a point is [x, y, z] or { "top": [x, z, lift] }, { "side": [z, y, lift] }, { "front": [x, y, lift] }, { "back": [x, y, lift] }`);
  };
  (Array.isArray(s.pieces) ? s.pieces : []).forEach((q: Args, i: number) => {
    const where = `pieces[${i}]${q?.name ? ` ("${q.name}")` : ""}`;
    if (!q || !SHAPES.includes(q.shape)) fail(where, `shape is one of ${SHAPES.join(", ")}`);
    const mat = typeof q.material === "string" ? MATERIALS[q.material] ?? fail(`${where}.material`, `is one of ${Object.keys(MATERIALS).join(", ")} or { metallic, roughness }`) : (q.material ?? (q.color === undefined || q.color === "paint" ? kit.PAINT : kit.PLASTIC));
    const col = colour(q.color, where), name = String(q.name ?? q.shape);
    const opt: Args = { material: mat, ...(q.emissive ? { emissive: q.emissive } : {}) };
    const one = (sx: number): Args => {
      const X = (p: Pt): Pt => [p[0]! * sx, p[1]!, p[2]!];
      const pts = (list: unknown, w: string) => (list as unknown[]).map((p, j) => X(P(p, `${where}.${w}[${j}]`)));
      const nm = q.mirror ? `${name} ${sx}` : name;
      switch (q.shape) {
        case "box": { const a = X(P(q.from, `${where}.from`)), b = X(P(q.to, `${where}.to`)); return kit.box(nm, Math.min(a[0]!, b[0]!), Math.max(a[0]!, b[0]!), Math.min(a[1]!, b[1]!), Math.max(a[1]!, b[1]!), Math.min(a[2]!, b[2]!), Math.max(a[2]!, b[2]!), col, { ...opt, round: q.round, segs: q.segs }); }
        case "pebble": return kit.pebble(nm, pts(q.a, "a"), pts(q.b, "b"), col, { ...opt, levels: q.levels ?? 2 });
        case "hexa": return kit.hexa(nm, pts(q.a, "a"), pts(q.b, "b"), col, opt);
        case "cyl": { const c = X(P(q.at, `${where}.at`)); return kit.cyl(nm, c[0], c[1], c[2], Number(q.r ?? 1), Number(q.len ?? 1), q.axis ?? "z", col, { ...opt, segments: q.segments }); }
        case "bar": return kit.bar(nm, X(P(q.p0, `${where}.p0`)), X(P(q.p1, `${where}.p1`)), Number(q.width ?? 0.4), Number(q.thick ?? 0.2), col, opt, q.up ?? [0, 1, 0]);
        case "lattice": { const o = outline(q.points, `${where}.points`).map(([x, y]) => [x! * sx, y!]); const back = q.view === "back"; return kit.lattice(nm, o, back ? at.back : at.front, back ? -1 : 1, Number(q.back ?? 0.3), Number(q.pitch ?? 0.6), Number(q.wid ?? 0.1), col, { ...opt, straight: q.straight, slope: q.slope }); }
        case "tube": return kit.tube(nm, pts(q.points, "points"), q.r ?? 0.3, col, opt, q.sides ?? 10);
        case "blade": return kit.blade(nm, (q.sections as Pt[]).map((r) => [r[0]! * sx, r[1], r[2], r[3], r[4]]), Number(q.thick ?? 0.4), col, opt);
        case "slab": return kit.slab(nm, outline(q.points, `${where}.points`).map(([x, z]) => [x! * sx, z!]), Number(q.y0 ?? 0), Number(q.y1 ?? 0.3), col, opt);
        default: return kit.mesh(nm, pts(q.verts, "verts"), q.polys ?? [], col, opt);
      }
    };
    cubes.push(one(1));
    if (q.mirror) cubes.push(one(-1));
  });
  const spokes = Number(W.spokes ?? 5), rimR = Number(W.rim_r ?? R * 0.73);
  const wheelOf = (sx: number) => kit.wheel({ R, width: Number(W.width ?? R * 0.7), rimR, rim: W.rim ?? "#c3c8d0", windows: spokes > 0 ? kit.spokeWindows(spokes, rimR * 0.37, rimR * 0.9, 0.5, 0.78) : [], spokeDepth: 0.5, caliper: W.caliper, hubR: 0.2, nuts: W.nuts ?? 5, nutAt: 1.55, dish: 0.28, cap: "#8f959f", tread: W.tread ?? 0 }, sx);
  const model = kit.assemble({ cubes, pivot: R, wheelZ, track, wheelOf, R });
  let tail: Args;
  if (Array.isArray(s.tail)) tail = { x: s.tail[0], y: s.tail[1], z: s.tail[2] };
  else {
    // (the back of the car at three quarters of the way up its flank, near its corner)
    const ysv = vals(s.body.ys), y = (ysv.reduce((m, v) => m + v, 0) / ysv.length) * 0.85;
    tail = { x: kit.r2((Math.max(...vals(s.body.w)) * 0.65) / 16), y: kit.r2(y / 16), z: kit.r2(at.back(0, y) / 16) };
  }
  return { model, tail, at, R, track, wheelZ };
}
