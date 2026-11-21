// car_make: a car from a short recipe. Two ways in:
//  - a body type and a few options: each type is one of the thirteen cars modelled from blueprints with the car kit
//    (makers/car/kit.mjs, makers/car/cars/*.mjs, first made for Pine Ridge Rally), and the options reshape it as a whole:
//    length, width, height, wheelbase, wheel size and ride height move the body's points by smooth piecewise-linear maps
//    (the wheel openings keep their shape round wheels that grow or shrink with them), paint and trim recolour it, and a few
//    style switches add or take away real pieces (a spoiler, flares, roof rails, a cover over a pickup's bed);
//  - the full spec (makers/car/spec.ts): the body's curves, the cut-outs and the pieces, as a person tracing a blueprint writes them.
// The type with every option left out (and seed 1) is exactly the car it came from, byte for byte.

// @ts-ignore (plain JavaScript modules, moved here from scripts/rally)
import * as kit from "./car/kit.mjs";
// @ts-ignore
import { gt } from "./car/cars/gt.mjs";
// @ts-ignore
import { offroad } from "./car/cars/offroad.mjs";
// @ts-ignore
import { city } from "./car/cars/city.mjs";
// @ts-ignore
import { cuda } from "./car/cars/cuda.mjs";
// @ts-ignore
import { gt2 } from "./car/cars/gt2.mjs";
// @ts-ignore
import { hatch } from "./car/cars/hatch.mjs";
// @ts-ignore
import { hatchR } from "./car/cars/hatch_r.mjs";
// @ts-ignore
import { pickup } from "./car/cars/pickup.mjs";
// @ts-ignore
import { rally } from "./car/cars/rally.mjs";
// @ts-ignore
import { s14 } from "./car/cars/s14.mjs";
// @ts-ignore
import { s15 } from "./car/cars/s15.mjs";
// @ts-ignore
import { suv } from "./car/cars/suv.mjs";
// @ts-ignore
import { truck } from "./car/cars/truck.mjs";
import { carFromSpec } from "./car/spec";

type Args = Record<string, any>;
type V3 = [number, number, number];
type Fn = (v: number) => number;

/// What a car file gives: the model (body part first, then the wheels), where the rear lamps are, and the kit's skin finder.
interface Made {
  model: Args;
  tail: { x: number; y: number; z: number };
  at: { side: (z: number, y: number) => number; top: (x: number, z: number) => number; front: (x: number, y: number) => number; back: (x: number, y: number) => number };
  R: number;
  track: number;
  wheelZ: number[];
}

interface CarType {
  /// The car it was modelled from (the file in makers/car/cars/) and what it is.
  from: string;
  says: string;
  make: (o: { paint: string; rim?: string; accents?: string[] }) => Made;
  paint: string;
  /// Paints a seed picks from (the first is the car's own).
  paints: string[];
  /// The back of the car: a boot lid (a lip spoiler sits on it), a hatch or doors (a roof spoiler over the glass), a load bed, or a cab.
  rear: "boot" | "hatch" | "bed" | "cab";
  /// Shapes that are its spoiler, flares, roof rails, when it has them (by name).
  spoiler?: RegExp;
  flares?: RegExp;
  rails?: RegExp;
  /// Shapes kept out of the whole-body reshaping because they stand on the wheels (none so far).
  notes?: string;
}

const TYPES: Record<string, CarType> = {
  modern_coupe: { from: "gt.mjs", says: "a modern two-door coupe (4.77 x 1.85 x 1.38 m), a long bonnet, a fastback cabin, twin kidney grille", make: (o) => gt(o.paint), paint: "#1f57b8", paints: ["#1f57b8", "#a81f2a", "#dfe2e6", "#41454d", "#2d6a4f"], rear: "boot" },
  coupe_90s: { from: "s14.mjs", says: "a mid-1990s Japanese sports coupe (4.56 x 1.73 x 1.30 m), slim lamps, a boot lip spoiler", make: (o) => s14(o.paint), paint: "#b5202c", paints: ["#b5202c", "#e2e4e7", "#1f3f8f", "#1a1b1e", "#c9a227"], rear: "boot", spoiler: /^spoiler/ },
  aero_coupe: { from: "s15.mjs", says: "a late-1990s sports coupe with an aero kit (4.45 x 1.70 x 1.29 m) and a rear wing", make: (o) => (o.rim ? s15(o.paint, o.rim) : s15(o.paint)), paint: "#e3b21c", paints: ["#e3b21c", "#e4e6e8", "#17181c", "#b3202a", "#3a6fb5"], rear: "boot", spoiler: /^wing / },
  hot_hatch: { from: "hatch_r.mjs", says: "a modern hot hatch (4.56 x 1.88 x 1.44 m) with a roof spoiler and a big rear wing", make: (o) => hatchR(o.paint), paint: "#e6e7e9", paints: ["#e6e7e9", "#b3202a", "#1d4fa8", "#4a4e56", "#d9b31f"], rear: "hatch", spoiler: /^(wing|roof spoiler)/ },
  family_hatch: { from: "hatch.mjs", says: "a modern five-door hatchback (4.46 x 1.80 x 1.44 m)", make: (o) => hatch(o.paint), paint: "#8c1420", paints: ["#8c1420", "#e4e6e8", "#1f4f9c", "#4a4f58", "#2f5d50"], rear: "hatch" },
  city_car: { from: "city.mjs", says: "a tiny rounded five-door city car of the late 1990s (3.50 x 1.50 x 1.49 m)", make: (o) => city(o.paint), paint: "#e8b923", paints: ["#e8b923", "#2f6fc4", "#c4302b", "#e6e8e8", "#6b9c45"], rear: "hatch" },
  gt_race: { from: "gt2.mjs", says: "a low mid-engined GT race car (4.63 x 2.07 x 1.12 m) with a splitter and a wing on swan necks", make: (o) => gt2(o.paint), paint: "#e6e8ea", paints: ["#e6e8ea", "#e2641c", "#1c4fa8", "#1d1f24", "#c3202a"], rear: "boot", spoiler: /^(wing|end plate|swan)/ },
  rally_coupe: { from: "rally.mjs", says: "an early-1980s rear-drive rally coupe (4.42 x 1.77 x 1.27 m) in a two-stripe livery (`accents`)", make: (o) => (o.accents ? rally(o.paint, o.accents[0], o.accents[1] ?? o.accents[0]) : rally(o.paint)), paint: "#e9eaec", paints: ["#e9eaec", "#1f4fa8", "#f4c41c", "#1f5a3c", "#b3202a"], rear: "boot" },
  muscle_fastback: { from: "cuda.mjs", says: "a late-1960s American fastback muscle car (about 4.8 m long), chrome bumpers", make: (o) => cuda(o.paint), paint: "#e0701b", paints: ["#e0701b", "#2b4f9c", "#3f6b3a", "#e6e2d6", "#1b1c20"], rear: "boot" },
  short_4x4: { from: "offroad.mjs", says: "a short 4x4 wagon (4.06 x 1.69 x 1.89 m) with flares, steel bumpers and a spare wheel on the back door", make: (o) => offroad(o.paint), paint: "#d2bb8c", paints: ["#d2bb8c", "#5d6b48", "#e2dfd3", "#9c3229", "#2f4a63"], rear: "hatch", flares: /^flare / },
  suv: { from: "suv.mjs", says: "a modern seven-seat SUV (4.80 x 1.86 x 1.84 m) with flares, roof rails and a roof spoiler", make: (o) => suv(o.paint), paint: "#2f4a63", paints: ["#2f4a63", "#e6e7e9", "#1b1d21", "#8f2a2a", "#6b6f5a"], rear: "hatch", spoiler: /^roof spoiler/, flares: /^flare /, rails: /^(roof rail|rail foot)/ },
  crew_cab_pickup: { from: "pickup.mjs", says: "a full-size four-door crew-cab pickup (5.93 x 2.04 x 1.98 m) with an open load bed and squared flares", make: (o) => pickup(o.paint), paint: "#c4541f", paints: ["#c4541f", "#e4e5e2", "#1d1f23", "#2a4d86", "#5a6447"], rear: "bed", flares: /^flare / },
  truck_6x6: { from: "truck.mjs", says: "a heavy bonneted 6x6 off-road truck as a chassis cab (8.43 x 2.81 x 3.02 m), three axles", make: (o) => truck(o.paint), paint: "#b3261e", paints: ["#b3261e", "#cdb788", "#55633f", "#e2e3df", "#2b3a55"], rear: "cab" },
};
export const CAR_TYPES = Object.keys(TYPES);
/// The words a person might use for each type.
const ALIASES: Record<string, string> = {
  coupe: "modern_coupe", "90s_coupe": "coupe_90s", "nineties_coupe": "coupe_90s", hatchback: "family_hatch", hatch: "family_hatch", city: "city_car", gt: "gt_race", race_car: "gt_race",
  rally: "rally_coupe", muscle: "muscle_fastback", fastback: "muscle_fastback", "4x4": "short_4x4", offroad: "short_4x4", jeep: "short_4x4", pickup: "crew_cab_pickup", truck: "truck_6x6", "6x6": "truck_6x6", lorry: "truck_6x6",
};
export function carType(given: unknown): string {
  const k = String(given ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (TYPES[k]) return k;
  if (ALIASES[k]) return ALIASES[k]!;
  throw new Error(`there is no car type "${given}"; the types are ${CAR_TYPES.join(", ")}`);
}
export const carTypeSays = (k: string) => TYPES[k]!.says;

// ---- numbers ---------------------------------------------------------------------------------------------------------------------------
const r2 = (v: number) => Math.round(v * 100) / 100;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/// A piecewise-linear map through knots [from, to] (sorted by `from`), carried on straight past both ends.
function knots(k: [number, number][]): { f: Fn; d: Fn } {
  const p = [...k].sort((a, b) => a[0] - b[0]);
  const seg = (v: number) => { let i = 0; while (i < p.length - 2 && v > p[i + 1]![0]) i++; return i; };
  const slope = (i: number) => (p[i + 1]![1] - p[i]![1]) / (p[i + 1]![0] - p[i]![0] || 1);
  return { f: (v) => { const i = seg(v); return p[i]![1] + (v - p[i]![0]) * slope(i); }, d: (v) => slope(seg(v)) };
}
const isColour = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
const WORDS: Record<string, string> = { red: "#b3202a", blue: "#1f4fa8", white: "#e4e6e8", black: "#1a1b1e", grey: "#4a4f58", gray: "#4a4f58", silver: "#b9bec6", yellow: "#e3b21c", orange: "#e2641c", green: "#2f5d3a", sand: "#cdb788", brown: "#6b4a2c", purple: "#5a2f7a", teal: "#1f6f6a", gold: "#c9a227" };
function colourOf(v: unknown, what: string): string {
  if (isColour(v)) return v.toLowerCase();
  const w = WORDS[String(v ?? "").toLowerCase()];
  if (w) return w;
  throw new Error(`${what} is "#rrggbb" or a colour word (${Object.keys(WORDS).join(", ")}), not ${JSON.stringify(v)}`);
}

// ---- the whole-body reshaping ------------------------------------------------------------------------------------------------------------
/// What a car measures (model units, 16 to the metre; y up from the ground, the nose along +z).
export interface Measure {
  zMin: number; zMax: number; yTop: number; xMax: number; R: number; axles: number[]; archTop: number;
}
const isWheelPart = (p: Args) => p.name !== "body";
const each = (part: Args, fn: (c: Args) => void) => { for (const c of part.cubes) fn(c); for (const ch of part.children ?? []) each(ch, fn); };

/// The car's size from its body (ground frame) and wheels.
export function measure(m: Made): Measure {
  const body = m.model.parts[0], pivot = body.origin[1];
  let zMin = Infinity, zMax = -Infinity, yTop = -Infinity, xMax = 0, archTop = 0;
  for (const c of body.cubes) {
    if (c.verts && !c.modifiers?.some((q: Args) => q.type === "revolve")) for (const v of c.verts) { zMin = Math.min(zMin, v[2]); zMax = Math.max(zMax, v[2]); if (c === body.cubes[0]) { yTop = Math.max(yTop, v[1] + pivot); xMax = Math.max(xMax, Math.abs(v[0])); } }
    for (const q of c.modifiers ?? []) if (q.type === "cutout") for (const cut of q.cuts) if (cut.view === "side" && cut.remove) for (const p of cut.points) archTop = Math.max(archTop, p[1] + pivot);
  }
  const axles = [...new Set(m.model.parts.filter(isWheelPart).map((p: Args) => p.origin[2] as number))].sort((a, b) => b - a);
  return { zMin, zMax, yTop, xMax, R: m.R, axles, archTop: Math.min(archTop || 2.15 * m.R, 2.6 * m.R) };
}

export interface Shape {
  length: number; width: number; height: number; wheelbase: number; wheel: number; lift: number;
}

/// Moves every point of the car (and its cut-outs, wheels and the rear-lamp mark) to the new proportions. `k` are factors on the
/// car's own length, width, height, wheelbase (front axle to rear), wheel diameter; `lift` raises the body on its wheels (model units).
function reshape(m: Made, base: Measure, k: Shape): void {
  const { R } = base, kw = k.wheel, a = Math.min(R * 1.3, (base.axles[0]! - base.axles[base.axles.length - 1]!) / 2 * 0.45 + R * 0.6);
  // the wheel zones (axles closer than two zones share one: the truck's bogie), each scaled with the wheels about its middle
  const zones: { lo: number; hi: number }[] = [];
  for (const z of base.axles) {
    const last = zones[zones.length - 1];
    if (last && last.lo - (z + a) < 1) last.lo = z - a;
    else zones.push({ lo: z - a, hi: z + a });
  }
  const mid = (zones[0]!.lo + zones[0]!.hi + zones[zones.length - 1]!.lo + zones[zones.length - 1]!.hi) / 4;
  const centre = (zn: { lo: number; hi: number }) => (zn.lo + zn.hi) / 2;
  const kz: [number, number][] = [];
  for (const zn of zones) {
    const c = centre(zn), c2 = mid + (c - mid) * k.wheelbase, h = (zn.hi - zn.lo) / 2;
    kz.push([zn.lo, c2 - h * kw], [zn.hi, c2 + h * kw]);
  }
  // the overhangs share what the new length leaves, as they did before
  const front = zones[0]!, rear = zones[zones.length - 1]!;
  const oF = base.zMax - front.hi, oR = rear.lo - base.zMin;
  const inner = kz[1]![1] - kz[kz.length - 2]![1];
  const room = Math.max((base.zMax - base.zMin) * k.length - inner, (oF + oR) * 0.4);
  kz.push([base.zMax, kz[1]![1] + (room * oF) / (oF + oR || 1)], [base.zMin, kz[kz.length - 2]![1] - (room * oR) / (oF + oR || 1)]);
  const Z = knots(kz);
  // up: the wheels' height and the sills scale with the wheels; what is above the wheel openings to the roof makes up the height
  const yA = base.archTop, top2 = base.yTop * k.height, above = Math.max(top2 - yA * kw, (base.yTop - yA) * 0.5);
  const Y = knots([[0, 0], [yA, yA * kw], [base.yTop, yA * kw + above]]);
  // (below the ground and above the roof the maps carry on straight)
  const Yf = (y: number) => (y < 0 ? y * kw : Y.f(y));
  const sx = k.width;
  const R2 = R * kw, pivot2 = R2 + k.lift;
  const body = m.model.parts[0], pivot = body.origin[1];
  const P = (p: number[]): V3 => [p[0]! * sx, Yf(p[1]!), Z.f(p[2]!)];
  const cylinder = (c: Args, frame: (p: V3) => V3, local: (p: V3) => V3) => {
    const ctr: V3 = [c.from[0] + c.size[0] / 2, c.from[1] + c.size[1] / 2, c.from[2] + c.size[2] / 2];
    const q = frame(ctr), d = local(ctr), rot = c.rotation ?? [0, 0, 0];
    // (the box's own axes, as the shape's turn lays them in the world: a cylinder along z or x has its length on its own y)
    const s = rot[0] === 90 ? [d[0], d[2], d[1]] : rot[2] === 90 ? [d[1], d[0], d[2]] : d;
    const size = [c.size[0] * s[0]!, c.size[1] * s[1]!, c.size[2] * s[2]!];
    c.from = [r2(q[0] - size[0]! / 2), r2(q[1] - size[1]! / 2), r2(q[2] - size[2]! / 2)];
    c.size = size.map(r2);
  };
  // the body: points in the ground frame, moved, then back in the body's frame (its origin is the new pivot)
  const toBody = (p: number[]): V3 => { const q = P([p[0]!, p[1]! + pivot, p[2]!]); return [r2(q[0]), r2(q[1] - R2), r2(q[2])]; };
  for (const c of body.cubes) {
    if (c.verts) {
      if (c.modifiers?.some((q: Args) => q.type === "revolve")) c.verts = c.verts.map((v: number[]) => [r2(v[0]! * sx), r2(v[1]! * kw), v[2]]);
      else c.verts = c.verts.map(toBody);
    } else if (c.from) cylinder(c, (p) => toBody(p), (p) => [sx, Y.d(p[1] + pivot), Z.d(p[2])]);
    for (const q of c.modifiers ?? []) if (q.type === "cutout") for (const cut of q.cuts) {
      const v = cut.view;
      if (v === "side") {
        cut.points = cut.points.map(([z, y]: number[]) => [r2(Z.f(z!)), r2(Yf(y! + pivot) - R2)]);
        for (const lim of ["near", "far"]) if (typeof cut[lim] === "number") cut[lim] = r2(cut[lim] * sx);
      } else if (v === "front" || v === "back") {
        cut.points = cut.points.map(([x, y]: number[]) => [r2(x! * sx), r2(Yf(y! + pivot) - R2)]);
        for (const lim of ["near", "far"]) if (typeof cut[lim] === "number") cut[lim] = r2(Z.f(cut[lim]));
      } else {
        cut.points = cut.points.map(([x, z]: number[]) => [r2(x! * sx), r2(Z.f(z!))]);
        for (const lim of ["near", "far"]) if (typeof cut[lim] === "number") cut[lim] = r2(Yf(cut[lim] + pivot) - R2);
      }
    }
  }
  // a wheel: the same wheel made bigger or smaller, at its new place
  const scaleWheel = (part: Args) => each(part, (c) => {
    if (c.verts) c.verts = c.verts.map((v: number[]) => v.map((x) => r2(x * kw)));
    else if (c.from) { c.from = c.from.map((x: number) => r2(x * kw)); c.size = c.size.map((x: number) => r2(x * kw)); }
    for (const q of c.modifiers ?? []) if (q.type === "cutout") for (const cut of q.cuts) cut.points = cut.points.map((p: number[]) => p.map((x) => r2(x * kw)));
  });
  for (const ch of body.children ?? []) {
    const g = P([ch.origin[0], ch.origin[1] + pivot, ch.origin[2]]);
    ch.origin = [r2(g[0]), r2(g[1] - R2), r2(g[2])];
    scaleWheel(ch);
  }
  body.origin = [body.origin[0], r2(pivot2), body.origin[2]];
  for (const w of m.model.parts.filter(isWheelPart)) {
    w.origin = [r2(w.origin[0] * sx), r2(R2), r2(Z.f(w.origin[2]))];
    scaleWheel(w);
  }
  m.tail = { x: r2(m.tail.x * sx), y: r2((Yf(m.tail.y * 16) + k.lift) / 16), z: r2(Z.f(m.tail.z * 16) / 16) };
  m.R = R2;
  m.wheelZ = m.wheelZ.map((z) => Z.f(z));
  m.track = m.track * sx;
}

// ---- style switches ------------------------------------------------------------------------------------------------------------------------
const drop = (m: Made, re: RegExp) => { const body = m.model.parts[0]; const n = body.cubes.length; body.cubes = body.cubes.filter((c: Args) => !re.test(c.name)); return n - body.cubes.length; };
/// Adds shapes written with the ground at y = 0 to the body part.
const add = (m: Made, cubes: Args[]) => {
  const body = m.model.parts[0], pivot = body.origin[1];
  for (const c of cubes) {
    if (c.verts) for (const v of c.verts) v[1] = r2(v[1] - pivot);
    else if (c.from) c.from[1] = r2(c.from[1] - pivot);
    body.cubes.push(c);
  }
};
/// The body's half-width and top at a station, read off the skin.
const roofAt = (m: Made, z: number) => {
  const yc = m.at.top(0, z);
  let x = 0;
  while (x < 20 && m.at.top(x + 0.25, z) > yc - 0.9) x += 0.25;
  return { y: yc, x };
};

/// A lip spoiler on the boot lid: a curved blade on two dark feet (the coupe_90s's, fitted to any boot).
function lipSpoiler(m: Made, base: Measure, paint: string): Args[] {
  const { at } = m, zb = base.zMin + 1.4, zf = zb + 3.4, hw = Math.min(roofAt(m, zb).x * 0.95, base.xMax * 0.72);
  const y0 = (x: number, z: number) => at.top(x, z), n = 8, verts: number[][] = [], loops: number[][] = [], cr: number[][] = [];
  const row = (i: number) => { const x = -hw + (2 * hw * i) / n, cv = 0.35 * (1 - (x / hw) ** 2); return [[x, y0(x, zf) + 0.05 + cv * 0.6, zf], [x, y0(x, zb) + 0.55 + cv, zb], [x, y0(x, zb) + 0.1 + cv, zb], [x, y0(x, zf) + cv * 0.6, zf]]; };
  for (let i = 0; i <= n; i++) verts.push(...row(i));
  for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) { loops.push([i * 4 + k, i * 4 + ((k + 1) % 4), (i + 1) * 4 + ((k + 1) % 4), (i + 1) * 4 + k]); cr.push([i * 4 + k, (i + 1) * 4 + k, 0.5]); }
  loops.push([0, 1, 2, 3], [n * 4, n * 4 + 1, n * 4 + 2, n * 4 + 3]);
  for (let k = 0; k < 4; k++) cr.push([k, (k + 1) % 4, 0.8], [n * 4 + k, n * 4 + ((k + 1) % 4), 0.8]);
  const out = [kit.mesh("spoiler", verts, loops, paint, { material: kit.PAINT, smooth: true, creases: cr, modifiers: [{ type: "subsurf", levels: 1, renderLevels: 2, smooth: true }] })];
  const xf = hw * 0.7;
  for (const sx of [1, -1]) out.push(kit.box(`spoiler foot ${sx}`, Math.min(sx * (xf - 0.5), sx * (xf + 0.5)), Math.max(sx * (xf - 0.5), sx * (xf + 0.5)), y0(xf, (zf + zb) / 2) - 0.3, y0(xf, (zf + zb) / 2) + 0.4, zb + 1, zf - 0.4, kit.DARK, { round: 0.1, segs: 1 }));
  return out;
}
/// A roof spoiler over the top of a hatch or the back doors.
function roofSpoiler(m: Made, base: Measure, paint: string): Args[] {
  // (the roof's last station: where the top falls away behind the cabin)
  let z = 0;
  const yMax = m.at.top(0, 0);
  for (let s = 0; s > base.zMin; s -= 0.5) if (m.at.top(0, s) > yMax - 1.5) z = s;
  const w = roofAt(m, z), y = w.y, hw = w.x;
  return [kit.pebble("roof spoiler", [[-hw, y - 0.3, z + 1.2], [hw, y - 0.3, z + 1.2], [hw * 0.98, y + 0.5, z + 1.2], [-hw * 0.98, y + 0.5, z + 1.2]], [[-hw * 0.95, y - 0.1, z - 4.2], [hw * 0.95, y - 0.1, z - 4.2], [hw * 0.93, y + 0.6, z - 4.2], [-hw * 0.93, y + 0.6, z - 4.2]], paint, { material: kit.PAINT, levels: 2 })];
}
/// Roof rails on feet along both edges of the roof.
function roofRails(m: Made, base: Measure): Args[] {
  const yMax = m.at.top(0, 0);
  let z0 = 0, z1 = 0;
  for (let s = 0; s < base.zMax; s += 0.5) if (m.at.top(0, s) > yMax - 1.2) z1 = s;
  for (let s = 0; s > base.zMin; s -= 0.5) if (m.at.top(0, s) > yMax - 1.2) z0 = s;
  z0 += 1; z1 -= 1;
  const out: Args[] = [], xr = roofAt(m, (z0 + z1) / 2).x * 0.82, yr = (z: number) => m.at.top(xr, z) + 0.45;
  const n = Math.max(2, Math.round((z1 - z0) / 4)), rz = Array.from({ length: n + 1 }, (_, i) => z1 - ((z1 - z0) * i) / n);
  for (const sx of [1, -1]) {
    for (let i = 0; i < n; i++) out.push(kit.bar(`roof rail ${sx} ${i}`, [sx * xr, yr(rz[i]!), rz[i]], [sx * xr, yr(rz[i + 1]!), rz[i + 1]], 0.5, 0.35, "#c4c9d2", { material: kit.STEEL }));
    for (const z of [z1 - 0.4, z0 + 0.4]) out.push(kit.box(`rail foot ${sx} ${z}`, Math.min(sx * (xr - 0.3), sx * (xr + 0.3)), Math.max(sx * (xr - 0.3), sx * (xr + 0.3)), m.at.top(xr, z) - 0.3, yr(z) + 0.1, z - 0.4, z + 0.4, "#17181c", { round: 0.08, segs: 1 }));
  }
  return out;
}
/// Flares standing proud round the wheel openings (black, or in the paint for a wide body).
function flares(m: Made, colour: string): Args[] {
  const out: Args[] = [];
  const arches = m.model.parts[0].cubes[0].modifiers.find((q: Args) => q.type === "cutout")?.cuts.filter((c: Args) => c.view === "side" && c.remove) ?? [];
  const pivot = m.model.parts[0].origin[1];
  arches.forEach((cut: Args, k: number) => {
    const o = cut.points.slice(1, -1).map(([z, y]: number[]) => [z, y! + pivot]);
    const foot = Math.max(o[0][1], m.R * 0.9);
    for (const sx of [1, -1]) out.push(kit.flare(`flare ${k} ${sx}`, [[o[0][0], foot], ...o, [o[o.length - 1][0], foot]], m.at, sx, 1.0, 0.55, colour));
  });
  return out;
}
/// A flat cover over a pickup's load bed (a tonneau), on the rail caps.
function bedCover(m: Made): Args[] {
  const y = 23.55;
  return [kit.box("bed cover", -14.4, 14.4, y, y + 0.35, -45.9, -17.2, "#17181c", { round: 0.12, segs: 1, material: { metallic: 0, roughness: 0.75 } })];
}

/// Recolours everything in the trim colour (window frames, pillars) and the rims.
function recolour(m: Made, trim: string | null, rim: string | null) {
  const visit = (part: Args, isWheel: boolean) => each(part, (c) => {
    if (trim && c.color === kit.TRIM) Object.assign(c, { color: trim === "chrome" ? "#c9ced6" : trim, ...(trim === "chrome" ? kit.CHROME : {}) });
    for (const q of c.modifiers ?? []) if (q.type === "cutout") for (const cut of q.cuts) {
      if (trim && cut.color === kit.TRIM) Object.assign(cut, { color: trim === "chrome" ? "#c9ced6" : trim, ...(trim === "chrome" ? { metallic: 1, roughness: 0.12 } : {}) });
      if (rim && isWheel && c.name === "rim") cut.wall = kit.shade(rim, 0.62);
    }
    if (rim && isWheel && c.name === "rim") c.color = rim;
  });
  for (const p of m.model.parts) visit(p, isWheelPart(p));
  for (const ch of m.model.parts[0].children ?? []) visit(ch, true);
}

// ---- the maker -----------------------------------------------------------------------------------------------------------------------------
export interface CarOptions {
  type?: string; spec?: Args; seed?: number; paint?: string; trim?: string; rim?: string; accents?: string[];
  length?: number; width?: number; height?: number; wheelbase?: number; wheel?: number; ride_height?: number;
  spoiler?: boolean; flares?: boolean | string; roof_rails?: boolean; bed?: string;
}
export interface Car {
  model: Args;
  type: string | null;
  /// Metres.
  length: number; width: number; height: number; wheelbase: number; wheelRadius: number; track: number;
  wheels: { name: string; x: number; y: number; z: number }[];
  tail: { x: number; y: number; z: number };
  says: string[];
}
export const CAR_OPTION_KEYS = ["type", "spec", "seed", "paint", "trim", "rim", "accents", "length", "width", "height", "wheelbase", "wheel", "ride_height", "spoiler", "flares", "roof_rails", "bed"];

/// How far each option may move a type from the car it came from (factors), and why: past these the parts stop fitting (see docs/mcp.md).
export const LIMITS = { length: [0.85, 1.2], width: [0.9, 1.12], height: [0.88, 1.15], wheelbase: [0.88, 1.15], wheel: [0.85, 1.25], ride: [-0.06, 0.2] } as const;

const metres = (u: number) => r2(u / 16);

export function makeCar(o: CarOptions): Car {
  if (o.spec !== undefined) return finish(carFromSpec(o.spec), null, [], o);
  const key = carType(o.type);
  const T = TYPES[key]!;
  const seed = o.seed ?? 1, rand = rng(seed * 7919 + 13);
  const varied = seed !== 1;
  const says: string[] = [];
  const paint = o.paint !== undefined ? colourOf(o.paint, "paint") : varied ? T.paints[Math.floor(rand() * T.paints.length)]! : T.paint;
  const rim = o.rim !== undefined ? colourOf(o.rim, "rim") : varied ? ["#c3c8d0", "#2c2e34", "#8a6a3a", "#dcdcd4", "#5a5d65"][Math.floor(rand() * 5)]! : null;
  const accents = o.accents?.map((c, i) => colourOf(c, `accents[${i}]`));
  const m: Made = T.make({ paint, rim: key === "aero_coupe" ? (rim ?? undefined) : undefined, accents });
  const base = measure(m);
  // the shape: given sizes as factors on the car's own, clamped where the parts stop fitting; a seed other than 1 varies it a little
  const own = { length: (base.zMax - base.zMin) / 16, width: (base.xMax * 2) / 16, height: base.yTop / 16, wheelbase: (base.axles[0]! - base.axles[base.axles.length - 1]!) / 16, wheel: (2 * base.R) / 16 };
  const jitter = (s: number) => (varied ? 1 + (rand() - 0.5) * 2 * s : 1);
  const factor = (name: keyof typeof own, given: number | undefined, wobble: number) => {
    const lim = LIMITS[name as keyof typeof LIMITS] as readonly [number, number];
    if (given === undefined) return jitter(wobble);
    if (!(typeof given === "number" && given > 0)) throw new Error(`${name} is in metres, a number above 0`);
    const f = given / own[name], c = clamp(f, lim[0], lim[1]);
    if (Math.abs(c - f) > 1e-3) says.push(`${name} ${given} m is past what this body takes (${r2(own[name] * lim[0])} to ${r2(own[name] * lim[1])} m): made at ${r2(own[name] * c)} m`);
    return c;
  };
  const k: Shape = { length: factor("length", o.length, 0.03), width: factor("width", o.width, 0.015), height: factor("height", o.height, 0.025), wheelbase: 1, wheel: factor("wheel", o.wheel, 0.04), lift: 0 };
  k.wheelbase = o.wheelbase !== undefined ? factor("wheelbase", o.wheelbase, 0) : k.length;
  if (o.ride_height !== undefined) {
    const lift = clamp(Number(o.ride_height), LIMITS.ride[0], LIMITS.ride[1]);
    if (lift !== Number(o.ride_height)) says.push(`ride_height ${o.ride_height} m is past ${LIMITS.ride[0]} to ${LIMITS.ride[1]}: made at ${lift}`);
    k.lift = lift * 16;
  }
  // style switches: what is there is taken away, what is not is added (fitted to this body's skin), before the reshaping moves it all
  if (o.spoiler === false && T.spoiler) says.push(`spoiler taken off (${drop(m, T.spoiler)} shapes)`);
  else if (o.spoiler === true && !T.spoiler) {
    if (T.rear === "boot") add(m, lipSpoiler(m, base, paint));
    else if (T.rear === "hatch") add(m, roofSpoiler(m, base, paint));
    else says.push(`a ${key} takes no spoiler (its back is a ${T.rear})`);
  }
  if ((o.flares === false || o.flares === "none") && T.flares) says.push(`flares taken off (${drop(m, T.flares)} shapes)`);
  else if (o.flares !== undefined && o.flares !== false && o.flares !== "none") {
    if (T.flares) drop(m, T.flares);
    add(m, flares(m, o.flares === "paint" ? paint : o.flares === true || o.flares === "black" ? "#1a1b1f" : colourOf(o.flares, "flares")));
  }
  if (o.roof_rails === false && T.rails) says.push(`roof rails taken off (${drop(m, T.rails)} shapes)`);
  else if (o.roof_rails === true && !T.rails) {
    if (T.rear === "bed" || T.rear === "cab") says.push(`roof rails are for a car with a long roof; a ${key} takes none`);
    else add(m, roofRails(m, base));
  }
  if (o.bed !== undefined) {
    if (key !== "crew_cab_pickup") throw new Error(`bed is an option of crew_cab_pickup only`);
    if (o.bed === "cover") add(m, bedCover(m));
    else if (o.bed !== "open") throw new Error(`bed is "open" (as it is) or "cover" (a flat cover over it)`);
  }
  const trim = o.trim === undefined ? null : o.trim === "chrome" ? "chrome" : o.trim === "body" ? paint : o.trim === "black" ? "#0b0c0e" : colourOf(o.trim, "trim");
  recolour(m, trim, key === "aero_coupe" ? null : rim);
  if (k.length !== 1 || k.width !== 1 || k.height !== 1 || k.wheelbase !== 1 || k.wheel !== 1 || k.lift !== 0) reshape(m, base, k);
  const car = finish(m, key, says, o);
  if (o.length !== undefined && Math.abs(car.length - own.length * k.length) > 0.05) says.push(`length came out at ${car.length} m: the overhangs cannot be shorter with this wheelbase`);
  return car;
}

/// What the answer says about a made car: its sizes in metres, wheels, tail lamps.
function finish(m: Made, type: string | null, says: string[], _o: CarOptions): Car {
  const body = m.model.parts[0], pivot = body.origin[1];
  let zMin = Infinity, zMax = -Infinity, yTop = -Infinity, xMax = 0;
  for (const c of body.cubes) if (c.verts && !c.modifiers?.some((q: Args) => q.type === "revolve")) for (const v of c.verts) { zMin = Math.min(zMin, v[2]); zMax = Math.max(zMax, v[2]); if (c === body.cubes[0]) { yTop = Math.max(yTop, v[1] + pivot); xMax = Math.max(xMax, Math.abs(v[0])); } }
  const wheels = m.model.parts.filter(isWheelPart).map((p: Args) => ({ name: p.name as string, x: metres(p.origin[0]), y: metres(p.origin[1]), z: metres(p.origin[2]) }));
  const zs = wheels.map((w: { z: number }) => w.z);
  return { model: m.model, type, length: metres(zMax - zMin), width: metres(2 * xMax), height: metres(yTop), wheelbase: r2(Math.max(...zs) - Math.min(...zs)), wheelRadius: metres(m.R), track: metres(2 * m.track), wheels, tail: m.tail, says };
}

export { TYPES as CAR_TYPE_TABLE };
