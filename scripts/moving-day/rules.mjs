// Moving Day's rules in JavaScript, for the solver (scripts/moving-day/solve.mjs). The game's own rules are examples/moving-day/lib/rules.lua; the two
// agree because the game's self-test (F10) replays every solution the solver wrote into a level through the Lua rules and checks that it ends solved in
// exactly that many moves. Keep them in step.
//
// A level is a scene file (scenes/levels/<n>.scene.json): floor tiles, walls, windows and doorways (on a cell's north side, turned by `ry` for the
// others), rugs, furniture, the mover's start, the client and a "level" object whose props hold the wish card. Cells are 1 m apart; a piece's
// position is the middle of its first cell, and the rest of it lies to +x (its width) and to -z (its depth) before it is turned.
import fs from "node:fs";

// the furniture: cells across and deep (a piece's front is +z before it is turned)
export const FURNITURE = {
  sofa: [2, 1], armchair: [1, 1], tv: [2, 1], bed: [2, 2], plant: [1, 1], bookcase: [2, 1], lamp: [1, 1], fridge: [1, 1], stove: [1, 1],
  desk: [2, 1], desk_chair: [1, 1], table: [2, 1], chair: [1, 1], box: [1, 1], bathtub: [2, 1], washer: [1, 1], side_table: [1, 1], coffee_table: [1, 1],
};
// low pieces (a coffee table) do not block the view: a sofa faces the TV over one
export const LOW = new Set(["coffee_table"]);
export const RUGS = { rug: [3, 2], rug_round: [2, 2] };
export const FLOORS = { floor_wood: "living", floor_carpet: "bedroom", floor_tile: "kitchen", floor_bath: "bathroom" };
export const EDGES = { wall: "wall", window: "window", doorway: "door" };

// a quarter turn (ry + 90 degrees) takes (x, z) to (z, -x)
const turn = ([x, z], q) => { q = ((q % 4) + 4) % 4; for (let i = 0; i < q; i++) [x, z] = [z, -x]; return [x, z]; };
const quarter = (ry) => ((Math.round((ry || 0) / (Math.PI / 2)) % 4) + 4) % 4;
export const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]]; // east, west, south, north (the d-pad's right, left, down, up)

// the cells of a piece of `kind` with its first cell at (ax, az), turned q quarters
export function cells(kind, ax, az, q) {
  const [w, d] = FURNITURE[kind];
  const out = [];
  for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) { const [ox, oz] = turn([i, -j], q); out.push([ax + ox, az + oz, j === 0, j === d - 1]); }
  return out;
}
export const front = (q) => turn([0, 1], q);

export function readLevel(file) {
  const scene = JSON.parse(fs.readFileSync(file, "utf8"));
  const L = { file, floor: new Map(), edges: new Map(), rug: new Set(), pieces: [], props: null, start: null, client: null };
  for (const o of scene.objects) {
    const x = Math.round(o.x), z = Math.round(o.z ?? 0), ry = o.props?.ry ?? 0;
    if (o.kind === "level") L.props = o.props;
    else if (FLOORS[o.kind]) L.floor.set(`${x},${z}`, FLOORS[o.kind]);
    else if (EDGES[o.kind]) {
      // a wall stands on the north side of its cell, turned with it: north, west, south, east for 0, 1, 2, 3 quarters
      const [dx, dz] = turn([0, -1], quarter(ry));
      L.edges.set(edgeKey(x, z, x + dx, z + dz), EDGES[o.kind]);
    } else if (RUGS[o.kind]) {
      const [w, d] = RUGS[o.kind];
      for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) { const [ox, oz] = turn([i, -j], quarter(ry)); L.rug.add(`${x + ox},${z + oz}`); }
    } else if (FURNITURE[o.kind]) L.pieces.push({ kind: o.kind, x, z, q: quarter(ry) });
    else if (o.kind === "mover") L.start = { x, z, f: dirOf(front(quarter(ry))) };
    else if (o.kind === "client") L.client = { x, z };
    else throw new Error(`${file}: "${o.kind}" is not a piece of a flat`);
  }
  if (!L.props) throw new Error(`${file}: no "level" object`);
  if (!L.start) throw new Error(`${file}: no "mover" object`);
  return L;
}
const dirOf = ([dx, dz]) => DIRS.findIndex(([a, b]) => a === dx && b === dz);
export function edgeKey(ax, az, bx, bz) { return ax < bx || (ax === bx && az < bz) ? `${ax},${az}|${bx},${bz}` : `${bx},${bz}|${ax},${az}`; }

// ---- the game on a level: state = { px, pz, f, pieces: [{ kind, x, z, q }] } ----------------------------------------------------------------
export class Game {
  constructor(L) { this.L = L; }
  floor(x, z) { return this.L.floor.has(`${x},${z}`); }
  wall(ax, az, bx, bz) { const e = this.L.edges.get(edgeKey(ax, az, bx, bz)); return e === "wall" || e === "window"; }
  occupant(s, x, z, skip) {
    for (let i = 0; i < s.pieces.length; i++) {
      if (i === skip) continue;
      const p = s.pieces[i];
      for (const [cx, cz] of cells(p.kind, p.x, p.z, p.q)) if (cx === x && cz === z) return i;
    }
    return -1;
  }
  // a piece can stand on these cells: all floor, none taken by another piece or the mover, and no wall between its own cells
  fits(s, i, cs, px, pz) {
    for (const [x, z] of cs) {
      if (!this.floor(x, z) || (x === px && z === pz) || this.occupant(s, x, z, i) >= 0) return false;
    }
    for (const [ax, az] of cs) for (const [bx, bz] of cs) if (Math.abs(ax - bx) + Math.abs(az - bz) === 1 && this.wall(ax, az, bx, bz)) return false;
    return true;
  }
  // the d-pad: returns { s, moved, pushed, bump } (s is a new state; a bump turns the mover only)
  step(s, d) {
    const [dx, dz] = DIRS[d];
    const nx = s.px + dx, nz = s.pz + dz;
    const turned = { ...s, f: d };
    if (!this.floor(nx, nz) || this.wall(s.px, s.pz, nx, nz)) return { s: turned, bump: "wall" };
    const i = this.occupant(s, nx, nz, -1);
    if (i < 0) return { s: { ...turned, px: nx, pz: nz }, moved: true };
    const p = s.pieces[i];
    const cs = cells(p.kind, p.x, p.z, p.q);
    for (const [x, z] of cs) if (this.wall(x, z, x + dx, z + dz)) return { s: turned, bump: "piece", piece: i };
    const moved = cs.map(([x, z]) => [x + dx, z + dz]);
    if (!this.fits(s, i, moved, -999, -999)) return { s: turned, bump: "piece", piece: i };
    const pieces = s.pieces.slice();
    pieces[i] = { ...p, x: p.x + dx, z: p.z + dz };
    return { s: { ...turned, px: nx, pz: nz, pieces }, moved: true, pushed: i };
  }
  // A or Y: turn the piece the mover faces about the cell in front of them, a quarter clockwise (seen from above: dir = -1) or anticlockwise (+1)
  rotate(s, dir) {
    const [dx, dz] = DIRS[s.f];
    const tx = s.px + dx, tz = s.pz + dz;
    if (this.wall(s.px, s.pz, tx, tz)) return null;
    const i = this.occupant(s, tx, tz, -1);
    if (i < 0) return null;
    const p = s.pieces[i];
    const [ox, oz] = turn([p.x - tx, p.z - tz], dir);
    const np = { ...p, x: tx + ox, z: tz + oz, q: (p.q + dir + 4) % 4 };
    if (!this.fits(s, i, cells(np.kind, np.x, np.z, np.q), s.px, s.pz)) return { blocked: i };
    const pieces = s.pieces.slice();
    pieces[i] = np;
    return { s: { ...s, pieces }, piece: i };
  }
  // ---- the wishes ----
  find(s, kind) { return s.pieces.findIndex((p) => p.kind === kind); }
  wish(s, w) {
    const i = this.find(s, w.piece);
    if (i < 0) return false;
    const p = s.pieces[i], cs = cells(p.kind, p.x, p.z, p.q);
    const [fx, fz] = front(p.q);
    switch (w.wish) {
      case "faces": {
        const j = this.find(s, w.target);
        if (j < 0) return false;
        for (const [x0, z0, isFront] of cs) {
          if (!isFront) continue;
          let x = x0, z = z0;
          for (let k = 1; k <= 6; k++) {
            const nx = x + fx, nz = z + fz;
            if (!this.floor(nx, nz) || this.wall(x, z, nx, nz)) break;
            const o = this.occupant(s, nx, nz, -1);
            if (o === j) return true;
            if (o >= 0 && o !== i && !LOW.has(s.pieces[o].kind)) break;
            x = nx; z = nz;
          }
        }
        return false;
      }
      case "next": {
        const j = this.find(s, w.target);
        if (j < 0) return false;
        for (const [x, z] of cs) for (const [dx, dz] of DIRS) if (this.occupant(s, x + dx, z + dz, i) === j && !this.wall(x, z, x + dx, z + dz)) return true;
        return false;
      }
      case "wall": // its back against a wall (a window counts)
        return cs.filter((c) => c[3]).every(([x, z]) => this.wall(x, z, x - fx, z - fz));
      case "window":
        return cs.some(([x, z]) => DIRS.some(([dx, dz]) => this.L.edges.get(edgeKey(x, z, x + dx, z + dz)) === "window"));
      case "rug":
        return cs.every(([x, z]) => this.L.rug.has(`${x},${z}`));
      case "room":
        return cs.every(([x, z]) => this.L.floor.get(`${x},${z}`) === w.target);
      default:
        throw new Error(`${this.L.file}: no wish "${w.wish}"`);
    }
  }
  solved(s) { return this.L.props.wishes.every((w) => this.wish(s, w)); }
  start() { return { px: this.L.start.x, pz: this.L.start.z, f: this.L.start.f, pieces: this.L.pieces.map((p) => ({ ...p })) }; }
}
