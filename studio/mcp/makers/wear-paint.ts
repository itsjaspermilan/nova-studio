// Wear for a painted map (scene_write's `paint` with a tileset that has wear tiles: the detailed city's). After the painter
// has chosen every joining tile, this lays what makes the place look used, at three scales:
//  - inside a tile: plain and worn variants of each floor tile, never the same one beside itself, the worn ones where the
//    place is worn;
//  - across tiles: features from the tileset's "wear_" tiles laid in a layer of their own (<name>_wear, just above the
//    ground): cracks that wander and fork, potholes, repaired patches, road markings fitted to the roads it finds,
//    drains with their stains, oil, tyre marks, scorch, litter, cables, weeds and moss, rubble against walls, grime where
//    the floor meets a wall and drips down wall faces;
//  - across the room: a wear map from the seed, so one end is nearly whole and another wrecked, with wear gathering along
//    walls, round drains and where floors meet, scaled by `wear`, raised where `damage` (or "broken asphalt") says so,
//    and shaped by the district.
// Everything is decoration (not solid) unless `solid_damage` is true, which makes rubble and deep holes solid. The layer
// holds only tile numbers; describeWear reads it back as a list of what lies where.

import { hash2 } from "./paint";
import { vnoise } from "./wear";

type Args = Record<string, any>;

export interface Part {
  dx: number;
  dy: number;
  tile: number;
}

/// The kinds a recipe can ask for or forbid with `features`.
export const FEATURE_KINDS = [
  "variants", "shapes", "cracks", "potholes", "patches", "sunken", "markings", "centre_line", "crossing", "stop_bar", "arrows", "parking", "hatch",
  "drains", "stains", "oil", "tyre_marks", "scorch", "litter", "cables", "growth", "rubble", "grime", "drips", "edges", "scratches", "spills", "glass",
] as const;
type Kind = (typeof FEATURE_KINDS)[number];
const MARKINGS: Kind[] = ["centre_line", "crossing", "stop_bar", "arrows", "parking", "hatch"];

/// How each district wears: a weight per kind (0: never) and how much wear its streets carry at the same `wear`.
type Profile = { mult: number; wet: number; quiet?: boolean } & Partial<Record<Kind, number>>;
const ALL1: Partial<Record<Kind, number>> = Object.fromEntries(FEATURE_KINDS.map((k) => [k, 1]));
export const DISTRICTS: Record<string, Profile> = {
  // street level: potholes, patches, litter and oil; the most markings
  "gutter market": { mult: 1, wet: 0.45, ...ALL1, sunken: 0.4, tyre_marks: 0.7, scorch: 0.25, cables: 0.3, growth: 0.4, rubble: 0.4, edges: 0.3, scratches: 0, spills: 0, glass: 0.2 },
  // a sunken lab campus: cracked and missing tile, growth pushing through, spills; few roads
  "bloom labs": { mult: 0.9, wet: 0.3, ...ALL1, potholes: 0.25, patches: 0.2, sunken: 0.3, markings: 0.2, centre_line: 0.2, crossing: 0.2, stop_bar: 0.2, arrows: 0.2, parking: 0.2, hatch: 0.2, drains: 0.4, stains: 0.6, oil: 0.2, tyre_marks: 0.1, scorch: 0.2, litter: 0.3, cables: 0.7, growth: 1.8, rubble: 0.5, grime: 0.7, drips: 0.8, edges: 0.3, glass: 0.7 },
  // an abandoned metro: rust, soot, broken platform edges, ballast, rubble
  "hollow line": { mult: 1.1, wet: 0.2, ...ALL1, potholes: 0.5, patches: 0.4, sunken: 0.5, markings: 0.4, centre_line: 0.4, crossing: 0.3, stop_bar: 0.4, arrows: 0.3, parking: 0.2, hatch: 0.6, drains: 0.5, stains: 0.8, oil: 0.6, tyre_marks: 0.2, scorch: 1.2, litter: 0.7, cables: 1.2, growth: 0.4, rubble: 1.3, grime: 1.2, drips: 1.3, edges: 1.2, scratches: 0.4, spills: 0.3, glass: 0.4 },
  // the corporate floors: nearly perfect; one hairline crack, a scuff by a door
  spire: { mult: 0.25, wet: 0, quiet: true, variants: 1, shapes: 1, markings: 1, centre_line: 1, crossing: 1, stop_bar: 1, arrows: 1, parking: 1, hatch: 1, drains: 1 },
};
/// What a cell marked as damaged gets in any district.
const FORCED: Partial<Record<Kind, number>> = { ...ALL1, scratches: 0.6, spills: 0.4 };

/// Which floors each kind may lie on.
const FLOORS = ["asphalt", "pavement", "metal_plate", "grating", "lab_tile", "marble", "platform"];
const ON: Record<string, string[]> = {
  cracks: ["asphalt", "pavement", "platform", "lab_tile"],
  potholes: ["asphalt", "pavement", "lab_tile", "platform"],
  patches: ["asphalt"],
  sunken: ["asphalt", "pavement"],
  markings: ["asphalt"],
  drains: ["asphalt"],
  stains: ["asphalt", "pavement", "platform", "lab_tile", "metal_plate"],
  oil: ["asphalt", "metal_plate", "platform"],
  tyre_marks: ["asphalt"],
  scorch: ["asphalt", "pavement", "platform", "metal_plate", "lab_tile"],
  litter: ["asphalt", "pavement", "platform", "lab_tile", "metal_plate", "grating"],
  cables: ["pavement", "platform", "lab_tile", "metal_plate", "marble"],
  growth: ["asphalt", "pavement", "platform", "lab_tile"],
  rubble: ["asphalt", "pavement", "platform", "lab_tile", "metal_plate", "marble"],
  grime: FLOORS,
  scratches: ["lab_tile", "marble", "metal_plate", "platform"],
  spills: ["lab_tile", "metal_plate"],
  glass: ["lab_tile", "pavement", "asphalt", "marble"],
};

export interface WearOptions {
  amount: (terrain: string) => number;
  damage: (number | undefined)[][] | null;
  only: Set<Kind> | null;
  no: Set<Kind>;
  district: string | null;
  solid: boolean;
}

const WEAR_HELP =
  '"wear" is 0 (plain) to 1 (wrecked), or one per terrain: { "asphalt": 0.7, "pavement": 0.3 }; "damage" is rows like "tiles" where "#" marks a wrecked cell, a digit 0-9 a wear of its own and "-" a cell kept clean ("." leaves it to the wear map); "features" lists kinds to lay ("cracks", "markings") or forbid ("no litter"): ' +
  `${FEATURE_KINDS.join(", ")}; "district": ${Object.keys(DISTRICTS).map((d) => `"${d}"`).join(", ")}; "solid_damage": true makes rubble and deep holes solid`;

/// Reads the wear options of a painted layer; mistakes go to `errors`. Null when the layer asks for none of them.
export function wearOptions(tm: Args, where: string, terrains: string[], rows: number, cols: number, errors: string[]): WearOptions | null {
  const keys = ["wear", "damage", "features", "district", "solid_damage"];
  if (!keys.some((k) => tm[k] !== undefined)) return null;
  const mine: string[] = [];
  const bad = (what: string) => mine.push(`${where}: ${what}`);
  let amount: WearOptions["amount"] = () => DEFAULT_WEAR;
  const w = tm.wear;
  if (typeof w === "number") {
    if (!(w >= 0 && w <= 1)) bad(`"wear" is ${w}`);
    amount = () => w;
  } else if (w && typeof w === "object" && !Array.isArray(w)) {
    const per = new Map<string, number>();
    for (const [k, v] of Object.entries(w)) {
      const name = k.trim().toLowerCase().replace(/\s+/g, "_");
      if (name !== "*" && name !== "other" && !terrains.includes(name)) bad(`"wear" names '${k}', which is not a terrain of the tileset (${terrains.join(", ")}; "*" for the rest)`);
      if (typeof v !== "number" || !(v >= 0 && v <= 1)) bad(`"wear"."${k}" is ${JSON.stringify(v)}`);
      per.set(name === "other" ? "*" : name, Number(v));
    }
    amount = (t) => per.get(t) ?? per.get("*") ?? DEFAULT_WEAR;
  } else if (w !== undefined) bad(`"wear" is ${JSON.stringify(w)}`);
  let damage: WearOptions["damage"] = null;
  if (tm.damage !== undefined) {
    if (!Array.isArray(tm.damage) || tm.damage.some((r: unknown) => typeof r !== "string")) bad(`"damage" is a list of rows`);
    else {
      if (tm.damage.length !== rows || tm.damage.some((r: string) => [...r].length !== cols)) bad(`"damage" must be ${rows} rows of ${cols} characters, the size of "tiles"`);
      damage = tm.damage.map((r: string) =>
        [...r].map((ch) => {
          if (ch === "." || ch === " ") return undefined;
          if (ch === "#" || ch === "X" || ch === "x") return 1;
          if (ch === "-") return 0;
          if (/\d/.test(ch)) return Number(ch) / 9;
          bad(`"damage" has '${ch}'`);
          return undefined;
        }),
      );
    }
  }
  let only: Set<Kind> | null = null;
  const no = new Set<Kind>();
  if (tm.features !== undefined) {
    if (!Array.isArray(tm.features)) bad(`"features" is a list`);
    else for (const f of tm.features) {
      const s = String(f).trim().toLowerCase();
      const neg = /^(no\s+|-|!|not\s+)/.test(s);
      const name = s.replace(/^(no\s+|-|!|not\s+)/, "").replace(/[\s-]+/g, "_").replace(/^center_line$/, "centre_line").replace(/^tyres?$|^tires?$|^tire_marks$/, "tyre_marks");
      const kind = (FEATURE_KINDS as readonly string[]).includes(name) ? (name as Kind) : (FEATURE_KINDS as readonly string[]).includes(`${name}s`) ? (`${name}s` as Kind) : null;
      if (!kind) {
        bad(`"features" names '${f}'`);
        continue;
      }
      const all = kind === "markings" ? [kind, ...MARKINGS] : [kind];
      if (neg) all.forEach((k) => no.add(k));
      else all.forEach((k) => (only ??= new Set()).add(k));
    }
  }
  let district: string | null = null;
  if (tm.district !== undefined) {
    const s = String(tm.district).trim().toLowerCase().replace(/[_-]/g, " ");
    district = Object.keys(DISTRICTS).find((d) => d === s || d.split(" ").includes(s)) ?? null;
    if (!district) bad(`there is no district '${tm.district}'`);
  }
  if (tm.solid_damage !== undefined && typeof tm.solid_damage !== "boolean") bad(`"solid_damage" is true or false`);
  // (the help once, after the last mistake)
  if (mine.length) errors.push(...mine.slice(0, -1), `${mine[mine.length - 1]}. ${WEAR_HELP}`);
  return { amount, damage, only, no, district, solid: tm.solid_damage === true };
}

/// The wear a detailed street gets when the recipe says nothing: moderate.
export const DEFAULT_WEAR = 0.35;

export interface WearInput {
  cols: number;
  nrows: number;
  seed: number;
  /// The ground terrain's name under every cell ("" for none), and what the cell was painted as.
  terrain: string[][];
  kind: ("empty" | "ground" | "standing" | "prop")[][];
  /// The name of what stands or is placed on a cell (a prop, a rail), and a wear forced by the legend ("broken asphalt").
  thing: (string | undefined)[][];
  forced: (number | undefined)[][];
  ground: number[][];
  edges: number[][];
  edges2: number[][];
  props: number[][];
  solidAt: (c: number, r: number) => boolean;
  /// Per terrain name: its plain whole tiles and its worn ones.
  plain: Map<string, number[]>;
  worn: Map<string, { tile: number; what: string }[]>;
  /// Other outlines of a joining tile (a pool's).
  alt: Map<number, number[]>;
  stamps: Map<string, Part[][]>;
  options: WearOptions | null;
}

export interface WearResult {
  tiles: number[][];
  /// Broad soft tone under the features (damp, dust, polished lanes): a layer of its own.
  tone: number[][];
  solid: number[];
  worn: number;
  district: string;
  said: string;
}


/// The district a map looks like when none is named: marble is the Spire, a platform or a track bed the Hollow Line, lab
/// tile Bloom Labs, anything else the street.
function guessDistrict(x: WearInput): string {
  const count = new Map<string, number>();
  for (const row of x.terrain) for (const t of row) count.set(t, (count.get(t) ?? 0) + 1);
  const n = (t: string) => count.get(t) ?? 0;
  if (n("marble") > n("asphalt") + n("lab_tile")) return "spire";
  if (n("platform") + n("gap") > n("asphalt")) return "hollow line";
  if (n("lab_tile") > n("asphalt") + n("pavement")) return "bloom labs";
  return "gutter market";
}

export function layWear(x: WearInput): WearResult {
  const { cols, nrows, seed } = x;
  const o = x.options;
  const districtName = o?.district ?? guessDistrict(x);
  const prof = DISTRICTS[districtName]!;
  const h = (c: number, r: number, salt: number) => hash2(c, r, seed * 7919 + salt);
  const inside = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < nrows;
  const tn = (c: number, r: number) => (inside(c, r) ? x.terrain[r]![c]! : "");
  const isWall = (t: string) => t.endsWith("_wall");
  const wallFace = (c: number, r: number) => isWall(tn(c, r)) && x.kind[r]![c] === "ground" && inside(c, r + 1) && tn(c, r + 1) !== tn(c, r) && !isWall(tn(c, r + 1));
  const plainOf = (t: string) => x.plain.get(t) ?? [];
  // a whole cell of floor: nothing on it, no edge, not solid
  // (read before the variants are chosen: a worn tile is still a whole cell)
  const wholeAt = x.ground.map((row, r) =>
    row.map((tile, c) => x.kind[r]![c] === "ground" && x.edges[r]![c]! < 0 && x.edges2[r]![c]! < 0 && x.props[r]![c]! < 0 && !x.solidAt(c, r) && FLOORS.includes(tn(c, r)) && plainOf(tn(c, r)).includes(tile)),
  );
  const whole = (c: number, r: number) => inside(c, r) && wholeAt[r]![c]!;
  const isDoor = (c: number, r: number) => inside(c, r) && x.kind[r]![c] === "prop" && /door|shutter|turnstile/.test(x.thing[r]![c] ?? "");

  // ---- the wear map ----
  const S1 = Math.max(6, Math.max(cols, nrows) / 2.2), S2 = 4.5;
  const wallNear = (c: number, r: number, d: number) => {
    for (let dr = -d; dr <= d; dr++) for (let dc = -d; dc <= d; dc++) if (isWall(tn(c + dc, r + dr))) return true;
    return false;
  };
  // the noise ranked over the room, so every room has its nearly whole end and its wrecked one whatever the seed
  const raw = Array.from({ length: nrows }, (_, r) => Array.from({ length: cols }, (_, c) => 0.72 * vnoise(c / S1, r / S1, seed + 901) + 0.28 * vnoise(c / S2, r / S2, seed + 902)));
  const sorted = raw.flat().sort((a, b) => a - b);
  const rank = (v: number) => {
    let lo = 0, hi = sorted.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid]! < v) lo = mid + 1;
      else hi = mid;
    }
    return sorted.length > 1 ? lo / (sorted.length - 1) : 0.5;
  };
  const cw: number[][] = [];
  for (let r = 0; r < nrows; r++) {
    cw.push([]);
    for (let c = 0; c < cols; c++) {
      const t = tn(c, r);
      const n = rank(raw[r]![c]!);
      let boost = wallNear(c, r, 1) ? 0.22 : wallNear(c, r, 2) ? 0.1 : 0;
      const kinds = new Set<string>();
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!inside(c + dc, r + dr)) continue;
        kinds.add(tn(c + dc, r + dr));
        if (x.thing[r + dr]![c + dc] === "manhole") boost += 0.08;
      }
      if (kinds.size > 1 || x.kind[r]![c] === "standing") boost += 0.08;
      const amount = (o ? o.amount(t) : DEFAULT_WEAR) * prof.mult;
      let v = amount <= 0 ? 0 : Math.min(1, n ** 2.2 * (0.4 + 1.7 * amount) + boost * (0.3 + amount) + 0.4 * amount ** 3);
      const forced = x.forced[r]![c] ?? o?.damage?.[r]?.[c];
      if (forced !== undefined) v = forced;
      cw[r]!.push(v);
    }
  }
  const forcedAt = (c: number, r: number) => (x.forced[r]![c] ?? o?.damage?.[r]?.[c] ?? 0) > 0.6;
  const allowed = (k: Kind) => (!o?.only || o.only.has(k)) && !o?.no.has(k);
  const weight = (k: Kind, c: number, r: number) => {
    if (!allowed(k)) return 0;
    const p = prof[k] ?? 0;
    return forcedAt(c, r) ? Math.max(p, FORCED[k] ?? 0) : p;
  };

  // ---- inside a tile: plain and worn variants, never the same beside itself ----
  let wornCount = 0;
  const pick = (list: number[], c: number, r: number, salt: number): number | undefined => {
    const near = [[-1, 0], [0, -1], [-1, -1], [1, -1]].map(([dc, dr]) => x.ground[r + dr!]?.[c + dc!]);
    let pool = list.filter((t) => !near.includes(t));
    if (!pool.length) pool = list.filter((t) => t !== near[0] && t !== near[1]);
    if (!pool.length) return undefined;
    return pool[Math.floor(h(c, r, salt) * pool.length)];
  };
  const quietDoors = new Set<string>();
  if (prof.quiet) for (let r = 0; r < nrows; r++) for (let c = 0; c < cols; c++) if (isDoor(c, r)) for (const [dc, dr] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) quietDoors.add(`${c + dc!},${r + dr!}`);
  // in a quiet district, the one worn tile that is not by a door goes where the wear map is highest
  let quietOne = "";
  if (prof.quiet) {
    let best = -1;
    for (let r = 0; r < nrows; r++) for (let c = 0; c < cols; c++) if (whole(c, r) && cw[r]![c]! > 0 && (x.worn.get(tn(c, r))?.length ?? 0) && cw[r]![c]! * (0.5 + h(c, r, 5)) > best) [best, quietOne] = [cw[r]![c]! * (0.5 + h(c, r, 5)), `${c},${r}`];
  }
  for (let r = 0; r < nrows; r++) for (let c = 0; c < cols; c++) {
    // (the ground under a prop or a rail takes part too, plain only, so it is never the same as the cell beside it)
    const under = !whole(c, r) && x.edges[r]![c]! < 0 && x.edges2[r]![c]! < 0 && plainOf(tn(c, r)).includes(x.ground[r]![c]!);
    if (!whole(c, r) && !under) continue;
    const t = tn(c, r), plain = plainOf(t), worn = (x.worn.get(t) ?? []).map((w) => w.tile);
    const v = cw[r]![c]!;
    let chance = allowed("variants") && !under ? Math.min(0.85, 0.95 * v ** 1.4) * weight("variants", c, r) : 0;
    if (prof.quiet && !forcedAt(c, r) && !under) chance = v > 0 && (quietDoors.has(`${c},${r}`) ? h(c, r, 6) < 0.7 : `${c},${r}` === quietOne) ? 1 : 0;
    let list = worn.length && h(c, r, 3) < chance ? worn : plain;
    if (prof.quiet && list === worn) {
      const named = (x.worn.get(t) ?? []).filter((w) => (quietDoors.has(`${c},${r}`) ? w.what === "scuff" : w.what === "hairline" || w.what === "crack"));
      if (named.length) list = named.map((w) => w.tile);
    }
    const chosen = pick(list, c, r, 4) ?? pick(list === worn ? plain : worn, c, r, 4);
    if (chosen === undefined) continue;
    x.ground[r]![c] = chosen;
    if (list === worn || !plain.includes(chosen)) wornCount++;
  }
  // a pool's other outlines, mixed cell by cell
  if (allowed("shapes")) for (const layer of [x.ground, x.edges, x.edges2]) for (let r = 0; r < nrows; r++) for (let c = 0; c < cols; c++) {
    const alts = x.alt.get(layer[r]![c]!);
    if (alts) layer[r]![c] = [layer[r]![c]!, ...alts][Math.floor(h(c, r, 8) * (alts.length + 1))]!;
  }

  // ---- across tiles: the features ----
  const tiles = Array.from({ length: nrows }, () => new Array<number>(cols).fill(-1));
  const solid = new Set<number>();
  const has = (base: string) => x.stamps.has(base);
  const free = (c: number, r: number, k: string) => whole(c, r) && tiles[r]![c]! < 0 && (ON[k] ?? FLOORS).includes(tn(c, r)) && !(o?.damage?.[r]?.[c] === 0);
  /// Lays a stamp with its top-left on (c, r) when every one of its cells is free for `k`.
  const lay = (k: string, base: string, c: number, r: number, variant = 0, test: (c: number, r: number) => boolean = (cc, rr) => free(cc, rr, k), makeSolid = false): boolean => {
    const vs = x.stamps.get(base);
    if (!vs?.length) return false;
    const parts = vs[variant % vs.length]!;
    // (a cell the wear map leaves at nothing gets nothing: wear 0 is a plain floor)
    if (parts.some((p) => !((cw[r + p.dy]?.[c + p.dx] ?? 0) > 0))) return false;
    if (!parts.every((p) => test(c + p.dx, r + p.dy))) return false;
    for (const p of parts) {
      tiles[r + p.dy]![c + p.dx] = p.tile;
      if (makeSolid) solid.add(p.tile);
    }
    return true;
  };
  const variants = (base: string) => x.stamps.get(base)?.length ?? 0;
  const cells = (fn: (c: number, r: number) => void) => {
    for (let r = 0; r < nrows; r++) for (let c = 0; c < cols; c++) fn(c, r);
  };

  // repaired patches and sunken stretches first: markings are broken where they were laid
  if (allowed("patches") && has("patch_c")) cells((c, r) => {
    const v = cw[r]![c]!;
    if (!free(c, r, "patches") || h(c, r, 11) >= 0.09 * weight("patches", c, r) * v * (1 - v) * (1 - v)) return;
    const w = 2 + Math.floor(h(c, r, 12) * 3), ht = 2;
    for (let dr = 0; dr < ht; dr++) for (let dc = 0; dc < w; dc++) if (!free(c + dc, r + dr, "patches")) return;
    for (let dr = 0; dr < ht; dr++) for (let dc = 0; dc < w; dc++) {
      const part = `${dr === 0 ? "n" : dr === ht - 1 ? "s" : ""}${dc === 0 ? "w" : dc === w - 1 ? "e" : ""}` || "c";
      lay("patches", `patch_${part}`, c + dc, r + dr);
    }
  });
  if (allowed("sunken")) cells((c, r) => {
    if (h(c, r, 15) < 0.006 * weight("sunken", c, r) * cw[r]![c]!) lay("sunken", "sunken", c, r);
  });

  // road markings, fitted to the roads: rows (and columns) that are mostly street
  const road = (c: number, r: number) => (tn(c, r) === "asphalt" || tn(c, r) === "puddle") && x.kind[r]![c] !== "standing";
  const rail = (c: number, r: number) => x.kind[r]![c] === "standing";
  const bandsOf = (n: number, m: number, isRoad: (i: number, j: number) => boolean, isRail: (i: number, j: number) => boolean) => {
    const roadLine: boolean[] = [], railLine: boolean[] = [];
    for (let i = 0; i < n; i++) {
      let k = 0, q = 0;
      for (let j = 0; j < m; j++) {
        if (isRoad(i, j)) k++;
        if (isRail(i, j)) q++;
      }
      roadLine.push(k >= 0.6 * m);
      railLine.push(q >= 0.6 * m);
    }
    const bands: [number, number][] = [];
    for (let i = 0; i < n; i++) if (roadLine[i] && !roadLine[i - 1]) {
      let j = i;
      while (roadLine[j + 1]) j++;
      bands.push([i, j]);
    }
    return { bands, railLine };
  };
  const H = bandsOf(nrows, cols, (r, c) => road(c, r), (r, c) => rail(c, r));
  const V = bandsOf(cols, nrows, (c, r) => road(c, r), (c, r) => rail(c, r));
  const inBand = (bands: [number, number][], i: number) => bands.some(([a, b]) => i >= a && i <= b);
  const junction = (c: number, r: number) => inBand(H.bands, r) && inBand(V.bands, c);
  const mark = (k: Kind, base: string, c: number, r: number) => {
    if (!allowed(k) || weight(k, c, r) <= 0 || junction(c, r) && k !== "hatch") return false;
    const v = cw[r]![c]!;
    if (v > 0.75 && h(c, r, 21) < (v - 0.75) * 2.2) return false; // worn away
    if (weight(k, c, r) < 1 && h(c, r, 22) > weight(k, c, r)) return false;
    const worn = v > 0.45 && h(c, r, 23) < v && variants(base) > 1;
    return lay("markings", base, c, r, worn ? 1 : 0);
  };
  // hatched boxes where two roads cross
  // (only where two roads really cross: the box is road-wide, not a plaza, and a road goes on out of it on a side and
  // above or below; a paved square or a yard is all "road" both ways and gets none)
  const crossing = (r0: number, r1: number, c0: number, c1: number) => {
    if (r1 - r0 > 7 || c1 - c0 > 7 || (r1 - r0 + 1) * (c1 - c0 + 1) > 0.25 * nrows * cols) return false;
    const mr = (r0 + r1) >> 1, mc = (c0 + c1) >> 1;
    const across = (c0 > 0 && road(c0 - 1, mr)) || (c1 < cols - 1 && road(c1 + 1, mr));
    const along = (r0 > 0 && road(mc, r0 - 1)) || (r1 < nrows - 1 && road(mc, r1 + 1));
    return across && along;
  };
  for (const [r0, r1] of H.bands) for (const [c0, c1] of V.bands) {
    if (r1 - r0 < 2 || c1 - c0 < 2 || !crossing(r0, r1, c0, c1)) continue;
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) mark("hatch", `hatch_${`${r === r0 ? "n" : r === r1 ? "s" : ""}${c === c0 ? "w" : c === c1 ? "e" : ""}` || "c"}`, c, r);
  }
  // groups of bands split only by a rail are one road: one crossing over all of them
  const groups: [number, number][][] = [];
  for (const b of H.bands) {
    const last = groups[groups.length - 1];
    const prev = last?.[last.length - 1];
    if (prev && b[0] - prev[1] === 2 && H.railLine[prev[1] + 1]) last!.push(b);
    else groups.push([b]);
  }
  groups.forEach((g, gi) => {
    const rows = g.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i));
    const jc = V.bands.find(([c0, c1]) => c1 - c0 >= 2);
    let cx = -1;
    if (jc) cx = jc[0] - 2;
    else if (cols >= 14) {
      let best = -1;
      for (let c = 3; c < cols - 4; c++) {
        const ok = rows.filter((r) => free(c, r, "markings") && free(c + 1, r, "markings")).length / rows.length;
        const score = ok + h(c, gi, 31) * 0.3;
        if (ok >= 0.7 && score > best) [best, cx] = [score, c];
      }
    }
    for (const [r0, r1] of g) {
      const ht = r1 - r0 + 1, mid = r0 + Math.floor((ht - 1) / 2);
      if (ht >= 3) for (let c = 0; c < cols; c++) if ((c + gi) % 2 === 0 && (cx < 0 || c < cx - 1 || c > cx + 2)) mark("centre_line", "line_h", c, mid);
      if (cx >= 0) for (let r = r0; r <= r1; r++) {
        for (const c of [cx, cx + 1]) mark("crossing", "zebra", c, r);
        // stop bars before the crossing: the lanes below the middle come from the left, the others from the right
        mark("stop_bar", "stop", r > mid || ht < 3 ? cx - 1 : cx + 2, r);
      }
      if (ht >= 3) {
        const lo = r1, hi = r0, at = cx >= 0 ? cx : Math.floor(cols / 2);
        const right = Math.max(1, at - 6 - Math.floor(h(gi, r0, 33) * 4)), left = Math.min(cols - 3, at + 4 + Math.floor(h(gi, r0, 34) * 4));
        if (allowed("arrows") && weight("arrows", right, lo) > 0) lay("markings", "arrow_r", right, lo);
        if (allowed("arrows") && weight("arrows", left, hi) > 0) lay("markings", "arrow_l", left, hi);
      }
      // parking bays along a kerb
      for (const [row, up] of [[r0, false], [r1, true]] as const) {
        const kerb = tn(0, up ? row + 1 : row - 1) === "pavement" || [...Array(cols).keys()].filter((c) => tn(c, up ? row + 1 : row - 1) === "pavement").length > cols / 2;
        if (!kerb || !allowed("parking") || h(row, gi, 35) > 0.75 * (prof.parking ?? 0)) continue;
        const len = 6 + 2 * Math.floor(h(row, gi, 36) * 2), s0 = 1 + Math.floor(h(row, gi, 37) * Math.max(1, cols - len - 2));
        if ([...Array(len + 1).keys()].some((i) => !free(s0 + i, row, "markings") || (cx >= 0 && s0 + i >= cx - 1 && s0 + i <= cx + 2))) continue;
        for (let i = 0; i <= len; i += 2) mark("parking", up ? "bay_up" : "bay", s0 + i, row);
      }
    }
  });
  V.bands.forEach(([c0, c1], gi) => {
    const wd = c1 - c0 + 1, mid = c0 + Math.floor((wd - 1) / 2);
    const jr = H.bands.find(([r0, r1]) => r1 - r0 >= 2);
    const ry = jr ? jr[0] - 2 : -1;
    if (wd >= 3) for (let r = 0; r < nrows; r++) if ((r + gi) % 2 === 0 && (ry < 0 || r < ry - 1 || r > ry + 2)) mark("centre_line", "line_v", mid, r);
    if (ry >= 1) for (let c = c0; c <= c1; c++) {
      for (const r of [ry, ry + 1]) mark("crossing", "zebra_v", c, r);
      mark("stop_bar", "stop_v", c, c > mid || wd < 3 ? ry + 2 : ry - 1);
    }
    if (wd >= 3 && allowed("arrows")) {
      const at = ry >= 0 ? ry : Math.floor(nrows / 2);
      lay("markings", "arrow_d", c0, Math.max(0, at - 5));
      lay("markings", "arrow_u", c1, Math.min(nrows - 2, at + 4));
    }
  });

  // markings were painted on sound tarmac: no worn tile under them (its marks would show through the faded paint)
  const markBases = /^(line_[hv]|zebra|zebra_v|stop|stop_v|arrow_[rlud]|bay|bay_up|hatch_.*)$/;
  const markTiles = new Set([...x.stamps].filter(([b]) => markBases.test(b)).flatMap(([, vs]) => vs.flat().map((p) => p.tile)));
  cells((c, r) => {
    if (!markTiles.has(tiles[r]![c]!) || plainOf(tn(c, r)).includes(x.ground[r]![c]!)) return;
    const near = [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dc, dr]) => x.ground[r + dr!]?.[c + dc!]);
    const pool = plainOf(tn(c, r)).filter((t) => !near.includes(t));
    if (!pool.length) return;
    x.ground[r]![c] = pool[Math.floor(h(c, r, 9) * pool.length)]!;
    wornCount--;
  });
  // drains in the gutter below a kerb, every few cells, their stain running out into the street
  if (allowed("drains")) {
    const step = 7 + Math.floor(h(1, 2, 41) * 4);
    cells((c, r) => {
      if (tn(c, r - 1) !== "pavement" || !free(c, r, "drains") || (c + Math.floor(h(r, 0, 42) * step)) % step !== 0) return;
      if (h(c, r, 43) < weight("drains", c, r)) lay("drains", "drain", c, r);
    });
  }
  // stains round what drains or leaks: a manhole cover
  if (allowed("stains")) cells((c, r) => {
    if (x.thing[r]![c] !== "manhole") return;
    if (h(c, r, 44) < (0.5 + cw[r]![c]! * 0.5) * weight("stains", c, r)) lay("stains", "stain_trail", c, r + 1);
    if (h(c, r, 45) < cw[r]![c]! * weight("stains", c, r)) lay("stains", "stain_ring", c + 1, r);
  });
  // potholes, kept apart from each other
  const holes = new Set<number>();
  for (const b of ["pothole", "pothole_wet", "pothole_big", "pothole_big_wet", "tiles_gone", "slabs_gone"]) for (const parts of x.stamps.get(b) ?? []) for (const p of parts) holes.add(p.tile);
  const nearHole = (c: number, r: number) => {
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) if (holes.has(tiles[r + dr]?.[c + dc] ?? -1)) return true;
    return false;
  };
  if (allowed("potholes")) cells((c, r) => {
    const v = cw[r]![c]!;
    if (!free(c, r, "potholes") || nearHole(c, r) || h(c, r, 51) >= 0.2 * weight("potholes", c, r) * Math.max(0, (v - 0.3) / 0.7) ** 2) return;
    // indoors and on a pavement the hole is where tiles or slabs have gone
    const t = tn(c, r);
    if (t === "lab_tile" || t === "pavement") {
      if (v > 0.45) lay("potholes", t === "lab_tile" ? "tiles_gone" : "slabs_gone", c, r);
      return;
    }
    const wet = h(c, r, 52) < prof.wet && t === "asphalt";
    const big = v > 0.62 && h(c, r, 53) < 0.4 && lay("potholes", wet ? "pothole_big_wet" : "pothole_big", c, r, 0, undefined, o?.solid === true && !wet);
    if (!big) lay("potholes", wet ? "pothole_wet" : "pothole", c, r, Math.floor(h(c, r, 54) * 2));
  });
  // where it is most worn the surface crazes into plates
  if (allowed("cracks")) cells((c, r) => {
    const v = cw[r]![c]!;
    if (v > 0.55 && ["asphalt", "platform"].includes(tn(c, r)) && !nearHole(c, r) && h(c, r, 58) < 0.16 * weight("cracks", c, r) * ((v - 0.55) / 0.45) ** 1.5) lay("cracks", "crazed", c, r, Math.floor(h(c, r, 59) * 2), (cc, rr) => free(cc, rr, "cracks") && tn(cc, rr) === tn(c, r));
  });
  // cracks: walks across free cells that turn and fork; each cell gets the tile for the sides its crack leaves by
  const crackBits = Array.from({ length: nrows }, () => new Array<number>(cols).fill(0));
  const DIRS: [number, number, number, number][] = [[0, -1, 1, 4], [1, 0, 2, 8], [0, 1, 4, 1], [-1, 0, 8, 2]]; // dc, dr, bit here, bit there
  const crackable = (c: number, r: number) => free(c, r, "cracks");
  const walk = (c: number, r: number, d: number, len: number, salt: number, fork: boolean) => {
    for (let i = 0; i < len; i++) {
      if (h(c, r, salt + i * 3) < 0.3) d = (d + (h(c, r, salt + i * 3 + 1) < 0.5 ? 1 : 3)) % 4;
      const [dc, dr, here, there] = DIRS[d]!;
      const nc = c + dc, nr = r + dr;
      if (!inside(nc, nr) || !crackable(nc, nr)) return;
      crackBits[r]![c] = crackBits[r]![c]! | here;
      crackBits[nr]![nc] = crackBits[nr]![nc]! | there;
      if (crackBits[nr]![nc]! !== there) return; // joined another crack
      c = nc;
      r = nr;
      if (fork && h(c, r, salt + 77) < 0.25) walk(c, r, (d + (h(c, r, salt + 78) < 0.5 ? 1 : 3)) % 4, 1 + Math.floor(h(c, r, salt + 79) * 3), salt + 500, false);
    }
  };
  if (allowed("cracks") && has("crack_ns")) cells((c, r) => {
    const v = cw[r]![c]!;
    if (!crackable(c, r) || crackBits[r]![c]! || h(c, r, 61) >= 0.08 * weight("cracks", c, r) * v ** 1.6) return;
    walk(c, r, Math.floor(h(c, r, 62) * 4), 2 + Math.floor(v * 6 + h(c, r, 63) * 3), 1000 + ((c * 31 + r * 17) % 997), true);
  });
  const crackEnds: [number, number][] = [];
  cells((c, r) => {
    const m = crackBits[r]![c]!;
    if (!m || tiles[r]![c]! >= 0) return;
    const letters = ["n", "e", "s", "w"].filter((_, i) => m & (1 << i)).join("");
    lay("cracks", `crack_${letters}`, c, r, letters.length === 2 ? Math.floor(h(c, r, 64) * 2) : 0, () => true);
    if (letters.length === 1) crackEnds.push([c, r]);
  });
  // where the floor meets a wall above it: cables run along it, rubble lies against it, grime darkens it
  const foot = (c: number, r: number) => whole(c, r) && wallFace(c, r - 1);
  if (allowed("cables")) cells((c, r) => {
    if (!foot(c, r) || !free(c, r, "cables") || h(c, r, 72) >= 0.06 * weight("cables", c, r)) return;
    let n = 0;
    while (n < 7 && foot(c + n, r) && free(c + n, r, "cables")) n++;
    if (n < 3) return;
    n = 3 + Math.floor(h(c, r, 73) * (n - 2));
    for (let i = 0; i < n; i++) lay("cables", i === 0 ? "cable_l" : i === n - 1 ? "cable_r" : "cable_h", c + i, r, Math.floor(h(c + i, r, 74) * 2));
  });
  cells((c, r) => {
    if (!foot(c, r)) return;
    const v = cw[r]![c]!;
    if (allowed("rubble") && h(c, r, 75) < 0.14 * weight("rubble", c, r) * v ** 1.5) {
      if (v > 0.6 && h(c, r, 76) < 0.4 && foot(c + 1, r) && lay("rubble", "masonry", c, r, 0, undefined, o?.solid === true)) return;
      if (lay("rubble", "rubble", c, r, Math.floor(h(c, r, 77) * 2), undefined, o?.solid === true)) return;
    }
    if (allowed("growth") && h(c, r, 78) < 0.08 * weight("growth", c, r) * v && lay("growth", "weeds", c, r, Math.floor(h(c, r, 79) * 2))) return;
    if (allowed("grime") && v > 0 && h(c, r, 80) < weight("grime", c, r) * (0.35 + 0.6 * v)) lay("grime", "grime", c, r, v < 0.35 ? 0 : v < 0.65 ? 1 : 2);
  });
  // wall faces: drips, soot, cracks and rust (never on a door or a shutter)
  if (allowed("drips")) cells((c, r) => {
    if (!wallFace(c, r) || isDoor(c, r) || tn(c, r) === "glass_wall") return;
    const v = cw[r]![c]!;
    if (h(c, r, 81) >= weight("drips", c, r) * (0.18 + 0.6 * v)) return;
    const metal = tn(c, r) === "metal_wall";
    const k = h(c, r, 82);
    const base = metal ? (k < 0.6 ? "wall_rust" : "wall_drip") : v > 0.55 && k < 0.3 ? "wall_crack" : (districtName === "hollow line" || v > 0.7) && k > 0.8 ? "wall_soot" : "wall_drip";
    lay("drips", base, c, r, Math.floor(h(c, r, 83) * variants(base)), () => tiles[r]![c]! < 0);
  });
  // a platform's edge broken where it drops to the track; ballast thrown up beside it
  if (allowed("edges")) cells((c, r) => {
    const v = cw[r]![c]!;
    if (tn(c, r) === "platform" && x.kind[r]![c] === "ground" && tn(c, r + 1) === "gap" && tiles[r]![c]! < 0 && h(c, r, 85) < 0.35 * weight("edges", c, r) * v) lay("edges", "edge_chip", c, r, Math.floor(h(c, r, 86) * 2), () => true);
    else if (free(c, r, "rubble") && tn(c, r) === "platform" && tn(c, r + 2) === "gap" && h(c, r, 87) < 0.2 * weight("edges", c, r) * v) lay("edges", "ballast", c, r, 0, () => true);
  });
  // weeds where cracks end and moss beside standing water
  if (allowed("growth")) {
    for (const [c, r] of crackEnds) for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (h(c + dc, r + dr, 91) < 0.22 * weight("growth", c, r) * cw[r]![c]! && lay("growth", "weeds", c + dc, r + dr, Math.floor(h(c, r, 92) * 2))) break;
    cells((c, r) => {
      if (!free(c, r, "growth")) return;
      const wet = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => tn(c + dc!, r + dr!) === "puddle");
      if (wet && h(c, r, 93) < 0.15 * weight("growth", c, r) * cw[r]![c]!) lay("growth", "moss", c, r, Math.floor(h(c, r, 94) * 2));
    });
  }
  // the rest, by chance where the place is worn: oil, tyre marks, scorch, scratches, spills, glass, litter
  const kerbRow = (c: number, r: number) => tn(c, r - 1) === "pavement" || tn(c, r + 1) === "pavement";
  const nearThing = (c: number, r: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => inside(c + dc!, r + dr!) && (x.kind[r + dr!]![c + dc!] === "prop" || wallFace(c + dc!, r + dr!)));
  cells((c, r) => {
    const v = cw[r]![c]!;
    if (v <= 0 || !whole(c, r) || tiles[r]![c]! >= 0) return;
    const t = tn(c, r);
    if (allowed("oil") && ON.oil!.includes(t) && h(c, r, 101) < 0.022 * weight("oil", c, r) * v * (kerbRow(c, r) ? 2 : 1)) {
      if (h(c, r, 102) < 0.3 && lay("oil", "oil_long", c, r)) return;
      if (lay("oil", "oil", c, r, Math.floor(h(c, r, 103) * 2))) return;
    }
    if (allowed("tyre_marks") && inBand(H.bands, r) && h(c, r, 104) < 0.012 * weight("tyre_marks", c, r) * Math.sqrt(v) && lay("tyre_marks", v > 0.5 && h(c, r, 105) < 0.35 ? "skid" : "tyre", c, r)) return;
    if (allowed("scorch") && h(c, r, 106) < 0.005 * weight("scorch", c, r) * v * (forcedAt(c, r) ? 4 : 1) && (lay("scorch", "scorch", c, r) || lay("scorch", "scorch_small", c, r))) return;
    if (allowed("scratches") && h(c, r, 107) < 0.008 * weight("scratches", c, r) * v && lay("scratches", "scratch", c, r)) return;
    if (allowed("spills") && h(c, r, 108) < 0.015 * weight("spills", c, r) * v && (h(c, r, 109) < 0.4 ? lay("spills", "spill_long", c, r) : lay("spills", "spill", c, r))) return;
    const glassNear = [[0, -1], [0, 1], [1, 0], [-1, 0]].some(([dc, dr]) => tn(c + dc!, r + dr!) === "glass_wall");
    if (allowed("glass") && h(c, r, 110) < 0.006 * weight("glass", c, r) * v * (glassNear ? 6 : 1) * (forcedAt(c, r) ? 4 : 1) && lay("glass", "glass", c, r)) return;
    if (allowed("litter") && h(c, r, 111) < 0.03 * weight("litter", c, r) * v * (nearThing(c, r) || kerbRow(c, r) ? 2.5 : 0.35)) lay("litter", "litter", c, r, Math.floor(h(c, r, 112) * variants("litter")));
  });

  // ---- broad tone, in a layer under the features: damp ground, dry dust, lanes polished by wheels ----
  const tone = Array.from({ length: nrows }, () => new Array<number>(cols).fill(-1));
  const toneOk = (c: number, r: number) =>
    inside(c, r) && tone[r]![c]! < 0 && x.kind[r]![c] === "ground" && !x.solidAt(c, r) && x.props[r]![c]! < 0 && !(o?.damage?.[r]?.[c] === 0) &&
    (wholeAt[r]![c]! || ((tn(c, r) === "puddle" || x.edges[r]![c]! >= 0) && FLOORS.includes(tn(c, r) === "puddle" ? "asphalt" : tn(c, r)))) && tn(c, r) !== "grating";
  const layTone = (base: string, c: number, r: number, variant = 0) => {
    const parts = x.stamps.get(base)?.[variant % Math.max(1, variants(base))];
    if (!parts?.every((p) => toneOk(c + p.dx, r + p.dy) && cw[r + p.dy]![c + p.dx]! > 0)) return false;
    for (const p of parts) tone[r + p.dy]![c + p.dx] = p.tile;
    return true;
  };
  const wetNear = (c: number, r: number) => [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]].some(([dc, dr]) => tn(c + dc!, r + dr!) === "puddle" || isWall(tn(c + dc!, r + dr!)) || x.thing[r + dr!]?.[c + dc!] === "manhole");
  if (allowed("stains")) cells((c, r) => {
    const v = cw[r]![c]!;
    if (!toneOk(c, r)) return;
    if (h(c, r, 121) < 0.07 * weight("stains", c, r) * (0.3 + v) * (wetNear(c, r) ? 2 : 1)) {
      if ((h(c, r, 122) < 0.35 && layTone("damp_wide", c, r)) || layTone("damp", c, r, Math.floor(h(c, r, 123) * 2))) return;
    }
    if (["pavement", "platform", "lab_tile", "metal_plate"].includes(tn(c, r)) && h(c, r, 124) < 0.035 * weight("stains", c, r) * (1 - v * 0.5)) layTone("dust", c, r, Math.floor(h(c, r, 125) * 2));
  });
  if (allowed("tyre_marks")) cells((c, r) => {
    if (inBand(H.bands, r) && h(c, r, 126) < 0.03 * weight("tyre_marks", c, r) * Math.sqrt(cw[r]![c]!)) layTone("lane", c, r);
  });

  return { tiles, tone, solid: [...solid].sort((a, b) => a - b), worn: wornCount, district: districtName, said: "" };
}

// ---- reading a wear layer back: what lies where ------------------------------------------------------------------------

const LABEL: [RegExp, string][] = [
  [/^crack_/, "crack"], [/^crazed$/, "crazed stretch"], [/^pothole_big_wet$/, "pothole holding water"], [/^pothole_big$/, "deep pothole"], [/^pothole_wet$/, "pothole holding water"], [/^pothole/, "pothole"],
  [/^tiles_gone$/, "missing floor tiles"], [/^slabs_gone$/, "missing slabs"], [/^patch_/, "repaired patch"], [/^sunken$/, "sunken stretch"], [/^line_[hv]$/, "centre line"], [/^zebra/, "crossing"], [/^stop/, "stop bar"], [/^arrow_/, "arrow"],
  [/^bay/, "parking bays"], [/^hatch_/, "hatched box"], [/^drain$/, "drain"], [/^stain_/, "stain"], [/^oil/, "oil slick"], [/^tyre$/, "tyre marks"], [/^skid$/, "skid marks"],
  [/^scorch/, "scorch mark"], [/^litter/, "litter"], [/^cable_/, "cable run"], [/^weeds/, "weeds"], [/^moss/, "moss"], [/^rubble/, "rubble"], [/^masonry$/, "fallen masonry"],
  [/^grime/, "grime at the wall"], [/^wall_drip/, "drips on the wall"], [/^wall_soot/, "soot on the wall"], [/^wall_crack/, "crack in the wall"], [/^wall_rust/, "rust on the wall"],
  [/^edge_chip/, "broken platform edge"], [/^ballast$/, "ballast"], [/^damp/, "damp patch"], [/^dust/, "dust"], [/^lane$/, "polished lane"], [/^scratch$/, "drag scratches"], [/^spill/, "spill"], [/^glass$/, "broken glass"],
];
/// Kinds read as one thing when their tiles lie together (a crack over many cells, a crossing, a cable run).
const JOINED = new Set(["crack", "repaired patch", "centre line", "crossing", "stop bar", "parking bays", "hatched box", "cable run", "grime at the wall"]);

/// The wear features of a layer, in words: "deep pothole 2x2 at 7,11 (solid)", "crack over 3,5-8,7 (6 tiles)".
export function describeWear(tiles: number[][], nameOf: (tile: number) => string | undefined, solid: Set<number>): { count: number; lines: string[] } {
  const nrows = tiles.length, cols = tiles[0]?.length ?? 0;
  const label = (c: number, r: number): string | undefined => {
    const n = nameOf(tiles[r]?.[c] ?? -1);
    if (!n?.startsWith("wear_")) return undefined;
    const base = n.slice(5).replace(/@.*$/, "").replace(/_\d+$/, "");
    return LABEL.find(([re]) => re.test(base))?.[1] ?? base;
  };
  const seen = new Set<string>();
  const found: { what: string; c0: number; r0: number; c1: number; r1: number; n: number; solid: boolean }[] = [];
  for (let r = 0; r < nrows; r++) for (let c = 0; c < cols; c++) {
    const what = label(c, r);
    if (!what || seen.has(`${c},${r}`)) continue;
    // one thing: its cells joined (with a gap of one for dashed lines), or a stamp's parts (named with @)
    const queue: [number, number][] = [[c, r]];
    seen.add(`${c},${r}`);
    const f = { what, c0: c, r0: r, c1: c, r1: r, n: 0, solid: false };
    while (queue.length) {
      const [qc, qr] = queue.pop()!;
      f.n++;
      f.c0 = Math.min(f.c0, qc);
      f.r0 = Math.min(f.r0, qr);
      f.c1 = Math.max(f.c1, qc);
      f.r1 = Math.max(f.r1, qr);
      if (solid.has(tiles[qr]![qc]!)) f.solid = true;
      const reach = JOINED.has(what) ? (what === "centre line" || what === "parking bays" ? 2 : 1) : 0;
      const isPart = (cc: number, rr: number) => /@/.test(nameOf(tiles[rr]?.[cc] ?? -1) ?? "");
      for (let dr = -Math.max(reach, 1); dr <= Math.max(reach, 1); dr++) for (let dc = -Math.max(reach, 1); dc <= Math.max(reach, 1); dc++) {
        const nc = qc + dc, nr = qr + dr;
        if (seen.has(`${nc},${nr}`) || label(nc, nr) !== what) continue;
        // a single tile's neighbour is its own thing unless it is a part of the same stamp
        if (!reach && !(isPart(nc, nr) && Math.abs(dc) <= 1 && Math.abs(dr) <= 1 && dc + dr >= 0 && dc >= 0 && dr >= 0)) continue;
        if (reach && Math.abs(dc) + Math.abs(dr) > reach) continue;
        seen.add(`${nc},${nr}`);
        queue.push([nc, nr]);
      }
    }
    found.push(f);
  }
  const groups = new Map<string, typeof found>();
  for (const f of found) groups.set(f.what, [...(groups.get(f.what) ?? []), f]);
  const lines = [...groups].map(([what, fs]) => {
    const at = fs.map((f) => (f.c0 === f.c1 && f.r0 === f.r1 ? `${f.c0},${f.r0}` : `${f.c0},${f.r0}-${f.c1},${f.r1}`) + (f.solid ? " (solid)" : ""));
    return `${what} x${fs.length}: ${at.slice(0, 14).join("; ")}${at.length > 14 ? `; and ${at.length - 14} more` : ""}`;
  });
  return { count: found.length, lines };
}
