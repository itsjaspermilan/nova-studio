// The post office room's numbers, shared by the models (tools/models.mjs), the scene (tools/scene.mjs) and, through the scene's tile
// objects, the game. Metres; the room is 7 x 5.2 (x -3.5..3.5, z -2.6..2.6), its back wall at z = -2.6.
export const ROOM = { X: 3.5, Z: 2.6 };
// The package counter along the back wall: its depth, top height, and its tiles (square, about 0.6 m, one parcel on each).
export const BACK = { depth: 0.62, top: 0.8, x0: -3.45, x1: 3.45 };
export const TILE = 0.6;
export const TILES = 10; // for parcels, from the left
export const tileX = (i) => -3.0 + (i - 1) * TILE; // i from 1
export const TILE_Z = -ROOM.Z + BACK.depth / 2;
// The picture frame, centred on the back wall.
export const FRAME = { x: 0, y: 1.8, w: 1.5, h: 1.05 };
// The front counter across the middle of the room (its top's middle and length): the walks round both ends are 1.85 m wide.
export const FRONT = { x: 0.05, w: 3.1 };
