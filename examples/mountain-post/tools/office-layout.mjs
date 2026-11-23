// The post office room on its placement grid: the numbers shared by the models (tools/models.mjs), the scene (tools/scene.mjs) and, through
// the scene file's props, the game (lib/room_grid.lua). Docs: docs/games/mountain-post.md, "Rooms and the placement grid".
//
// The room is 7 x 5 m inside (x -3.5..3.5, z -2.5..2.5), its back wall at z = -2.5 and the door in the front wall at z = +2.5. The floor is
// divided into square CELLS of 0.5 m: 14 columns (col 0 at the left, x = -3.5) by 10 rows (row 0 at the back wall, z = -2.5). Everything
// that stands in the room has a FOOTPRINT in cells (width x depth, before it is turned), a FACING (0, 90, 180 or 270 degrees: 0 faces +z,
// into the room from the back wall; 90 faces +x, 180 faces -z, 270 faces -x) and a position that is its footprint's top-left cell, so its
// middle always lies on the grid. Small things on a counter use that counter's own finer grid (SURFACES: 0.25 m cells for the front
// counter, the package counter's own 0.5 m cells for its tiles). Things hung on a wall use a column or row along that wall and a height in
// 0.5 m steps (WALL_STEP). The scene file keeps all of it as data (props.cell, props.size, props.face, props.surface), and the room
// object's props.grid the grid itself.
export const ROOM = { X: 3.5, Z: 2.5 };
export const GRID = { cell: 0.5, x0: -ROOM.X, z0: -ROOM.Z, cols: 14, rows: 10 };
export const WALL_STEP = 0.5; // the height of a wall cell
export const WALL_H = 3.0;
export const TOP = 0.8; // the counters' top height
export const SURFACES = {
  package_counter: { origin: [-3.5, -2.5], cell: 0.5, cols: 14, rows: 1, y: TOP },
  front_counter: { origin: [-1.5, -1.0], cell: 0.25, cols: 12, rows: 4, y: TOP },
};
// The door in the front wall: its cells, and its gap in metres.
export const DOOR = { cols: [8, 9], x0: 0.5, x1: 1.5 };
// The window in the left wall (x = -3.5): rows along the wall and its height in wall cells (1.0 to 2.0 m).
export const WINDOW = { rows: [4, 6], y0: 1.0, y1: 2.0 };

// The package counter's tiles (one parcel on each): ten, in the middle of the counter, cols 2..11.
export const TILE = 0.5;
export const TILES = 10;
export const TILE_COL0 = 2;
export const tileX = (i) => GRID.x0 + (TILE_COL0 + i - 0.5) * GRID.cell; // i from 1
export const TILE_Z = GRID.z0 + GRID.cell / 2;
export const BACK = { depth: 0.5, top: TOP, x0: -ROOM.X, x1: ROOM.X };
// The front counter's footprint: 6 x 2 cells (3.0 x 1.0 m) at col 4, row 3.
export const FRONT = { x: 0, w: 3.0, d: 1.0 };
// The picture frame on the back wall: cols 5..7 (x -1.0..0.5), wall cells 3..4 (1.5 to 2.5 m).
export const FRAME = { x: -0.25, y: 2.0, w: 1.5, h: 1.0 };

// ---- the placed things -----------------------------------------------------------------------------------------------------------------
// surface: "floor", a counter in SURFACES, or "wall:back" / "wall:right" / "wall:left". cell: [col, row] (on a wall: [along, height], both
// in that wall's cells; along runs left to right as seen from inside, i.e. along x on the back wall and along z (back to front) on the side
// walls). size: [w, d] in the surface's cells (on a wall [w, h]). face: 0/90/180/270. layer: "flat" (a rug or mat: things stand on it) or
// "item" (the default: nothing else on the same surface may overlap it). A name is the scene's name for it.
export const PLACED = [
  // the counters
  { kind: "package_counter", name: "package_counter", surface: "floor", cell: [0, 0], size: [14, 1], face: 0 },
  { kind: "front_counter", name: "front_counter", surface: "floor", cell: [4, 3], size: [6, 2], face: 0 },
  // on the floor
  { kind: "stool", name: "stool", surface: "floor", cell: [4, 5], size: [1, 1], face: 0 },
  { kind: "rug", name: "rug", surface: "floor", cell: [7, 7], size: [4, 2], face: 0, layer: "flat" },
  { kind: "door_mat", name: "door_mat", surface: "floor", cell: [8, 9], size: [2, 1], face: 0, layer: "flat" },
  { kind: "mail_sack", name: "mail_sack", surface: "floor", cell: [12, 8], size: [1, 1], face: 0 },
  // on the front counter (0.25 m cells, origin at its back left corner)
  { kind: "crt_computer", name: "old_computer", surface: "front_counter", cell: [0, 0], size: [3, 3], face: 0 },
  { kind: "letter_tray", name: "letter_tray", surface: "front_counter", cell: [3, 0], size: [2, 2], face: 0 },
  { kind: "envelopes", name: "envelopes", surface: "front_counter", cell: [5, 0], size: [2, 1], face: 0 },
  { kind: "desk_mat", name: "desk_mat", surface: "front_counter", cell: [5, 1], size: [4, 2], face: 0, layer: "flat" },
  { kind: "stamp", name: "stamp", surface: "front_counter", cell: [9, 1], size: [2, 2], face: 0 },
  { kind: "bell", name: "bell", surface: "front_counter", cell: [11, 0], size: [1, 1], face: 0 },
  // on the walls
  { kind: "pigeonholes", name: "pigeonholes", surface: "wall:back", cell: [0, 3], size: [4, 2], face: 0 },
  { kind: "tally_frame", name: "tally_frame", surface: "wall:back", cell: [5, 3], size: [3, 2], face: 0 },
  { kind: "wall_clock", name: "wall_clock", surface: "wall:back", cell: [10, 4], size: [1, 1], face: 0 },
  { kind: "calendar", name: "calendar", surface: "wall:back", cell: [12, 3], size: [1, 2], face: 0 },
  { kind: "notice_board", name: "notice_board", surface: "wall:right", cell: [1, 3], size: [2, 2], face: 270 },
];

// where a placement is in the world: the middle of its footprint (x, z) and, on a counter, its top (y); on a wall, the bottom of its cells
const turned = (size, face) => (face === 90 || face === 270 ? [size[1], size[0]] : size);
export function worldOf(p) {
  const s = p.surface;
  const [c, r] = p.cell;
  if (s === "floor" || SURFACES[s]) {
    const g = s === "floor" ? { origin: [GRID.x0, GRID.z0], cell: GRID.cell, y: 0 } : SURFACES[s];
    const [w, d] = turned(p.size, p.face);
    return { x: g.origin[0] + (c + w / 2) * g.cell, y: g.y, z: g.origin[1] + (r + d / 2) * g.cell };
  }
  const y = r * WALL_STEP;
  if (s === "wall:back") return { x: GRID.x0 + (c + p.size[0] / 2) * GRID.cell, y, z: GRID.z0 };
  if (s === "wall:right") return { x: ROOM.X, y, z: GRID.z0 + (c + p.size[0] / 2) * GRID.cell };
  if (s === "wall:left") return { x: -ROOM.X, y, z: GRID.z0 + (c + p.size[0] / 2) * GRID.cell };
  throw new Error("surface " + s);
}
