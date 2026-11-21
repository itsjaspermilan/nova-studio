// How a room's drawn map (the generators' own characters: '#' wall, ',' street, '=' paved, 'C' crate ...) is painted with the city terrains and props of
// the district tileset (sprites/gutter.png, tileset_make "gutter market" in the detailed style, drawn at 1.5: a tile is 48 units, as before).
// Everything here is looks: the cells that are SOLID are exactly the cells the generators drew as solid (a wall stays a wall, a crate becomes
// another solid thing in the same cell: a crate, a bin, a vending machine, a lamp, a shutter, a server rack). tools/solid_check.mjs
// proves it against tools/solid_maps.json, which was taken from the old rooms.
export const T = 48;
export const SOLID_OLD = new Set(["#", "C", "B", "W", "w"]);   // what the old maps drew as solid: walls, crates, barrels, wall-stalls, flood water

export const PAINT = {
  a: "asphalt", p: "pavement", m: "metal_plate", g: "grating", l: "lab_tile", z: "marble", u: "puddle",
  C: "concrete_wall", M: "metal_wall", H: "shutter", r: "tram_rail on asphalt", n: "neon_strip", N: "neon_strip2",
  c: "cargo_crate on asphalt", b: "bin on asphalt", V: "vending_machine on asphalt", L: "street_lamp on asphalt", D: "barricade on asphalt",
  e: "cargo_crate on pavement", f: "bin on pavement", E: "vending_machine on pavement", d: "bin on metal_plate", q: "cargo_crate on metal_plate",
  S: "server_stack on metal_plate", T: "terminal on metal_plate", o: "manhole on asphalt", v: "vent on metal_plate", k: "cables on metal_plate",
};

const hash = (x, y, s = 0) => { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

// g: rows of the generator's characters. Returns { tiles (rows of painted characters), lights (scene objects), counts }.
//  style: "street" | "yard" | "quiet" | "den"
export function paintGrid({ name, g, style = "street", puddles = [], rails = [], seed = 1 }) {
  const H = g.length, W = g[0].length;
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? "#" : g[y][x]);
  const wall = (x, y) => at(x, y) === "#";
  const out = g.map((r) => r.map(() => "a"));
  const lights = [];
  const cell = (x, y) => [(x + 0.5) * T, (y + 0.5) * T];
  const lamp = (x, y) => { const [cx, cy] = cell(x, y); lights.push({ kind: "light", x: cx, y: cy + 10, props: { color: [150, 215, 255], radius: 190, squash: 0.65, intensity: 1.6, glow: 22, glow_y: 84 } }); };
  const vend = (x, y) => { const [cx, cy] = cell(x, y); lights.push({ kind: "light", x: cx, y: cy + 26, props: { color: [53, 230, 255], radius: 120, squash: 0.7, intensity: 1.7, glow: 16, glow_y: 40 } }); };
  const counts = { lamp: 0, vending: 0, crate: 0, bin: 0, shutter: 0, rack: 0 };

  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = g[y][x];
    let t;
    if (c === "#") {
      // walls: concrete buildings and metal sheds in patches; a rolled-down shutter now and then where a wall faces open ground to the south
      const metal = style === "den" || style === "yard" ? true : hash(Math.floor(x / 5), Math.floor(y / 5), seed) < 0.4;
      t = metal ? "M" : "C";
      if (style !== "den" && at(x, y + 1) !== "#" && wall(x - 1, y) && wall(x + 1, y) && hash(x, y, seed + 9) < 0.15) { t = "H"; counts.shutter++; }
    } else if (c === "C" || c === "B" || c === "W") {
      // a solid thing stays solid: a crate, a bin, a vending machine, a street lamp (a different solid prop in the same cell)
      const h = hash(x, y, seed);
      const near = wall(x, y - 1) || wall(x - 1, y) || wall(x + 1, y);
      if (style === "den") t = h < 0.5 ? "q" : "d";
      else if (c === "W") t = "D";
      else if (h < 0.12 && at(x, y - 1) !== "#") { t = "L"; counts.lamp++; lamp(x, y); }
      else if (h < 0.3 && at(x, y - 1) !== "#") { t = near ? "E" : "V"; counts.vending++; vend(x, y); }
      else if (h < 0.55) { t = "b"; counts.bin++; if (near) t = "f"; }
      else { t = near ? "e" : "c"; counts.crate++; }
    } else if (c === "w") {
      t = "S"; counts.rack++;                                // flood water was solid: server racks stand there now
    } else if (style === "den") {
      t = c === "=" ? "g" : "m";
    } else if (style === "quiet") {
      t = c === "=" ? "z" : "p";      // (a polished marble square in a paved court: the noodle stand and the shop's hall)
    } else if (style === "yard") {
      t = c === "=" ? "m" : "a";
    } else {
      // street: asphalt, with a kerb of pavement where a building stands over it, and the paved squares
      const kerb = wall(x, y - 1) || wall(x - 1, y) || wall(x + 1, y) || wall(x, y + 1);
      t = c === "=" || kerb ? "p" : "a";
    }
    out[y][x] = t;
  }
  const open = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !SOLID_OLD.has(g[y][x]) && "apmglzu".includes(out[y][x]);
  // puddles: a pool of reflective tiles under each live-puddle object (it is 132 x 80 units: three cells across and one or two deep)
  for (const [px, py] of puddles) {
    const cx = Math.floor(px / T), cy = Math.floor(py / T);
    for (const [dx, dy] of [[-1, 0], [0, 0], [1, 0], [0, -1], [0, 1], [-1, 1], [1, 1]]) {
      const x = cx + dx, y = cy + dy;
      if (open(x, y) && hash(x, y, seed + 3) < 0.9) out[y][x] = "u";
    }
  }
  // tram rails: two rows (or columns) of rail tiles along each band
  for (const r of rails) {
    const h = r.dir === "h";
    const line = Math.round((h ? r.y : r.x) / T), from = Math.round((h ? r.x : r.y) / T), to = from + Math.round(r.span / T) - 1;
    for (let i = from; i <= to; i++) for (const k of [line - 1, line]) {
      const x = h ? i : k, y = h ? k : i;
      if (x >= 0 && y >= 0 && x < W && y < H && !SOLID_OLD.has(g[y][x])) out[y][x] = "r";
    }
  }
  // a manhole or a drain cover on a bare street cell here and there, cables and vents indoors
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (out[y][x] === "a" && g[y][x] === "," && hash(x, y, seed + 5) < 0.012 && style !== "quiet") out[y][x] = "o";
    if (style === "den" && out[y][x] === "m" && hash(x, y, seed + 6) < 0.05) out[y][x] = hash(x, y, seed + 7) < 0.5 ? "k" : "v";
  }
  return { tiles: out.map((r) => r.join("")), lights, counts };
}

// rows of '.' (clean) and '#' (wrecked) for the tilemap's `damage`: a rectangle at one corner (or each of several)
export function damageRows(W, H, rects) {
  const rows = Array.from({ length: H }, () => Array.from({ length: W }, () => "."));
  for (const [x0, y0, x1, y1] of rects) for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) rows[y][x] = "#";
  return rows.map((r) => r.join(""));
}
