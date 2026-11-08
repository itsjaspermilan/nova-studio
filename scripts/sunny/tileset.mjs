// Sunny Hop's one tileset (examples/sunny-hop/sprites/tiles.png): 12 tiles across, 96 pixels each, drawn at 48 units (the tileset's "scale" 0.5).
// The order is the tile numbers a scene file's tilemaps use, so append only: never reorder or remove a name, or every level's tiles change.
// Six ground styles of the New Platformer Pack (25 pieces each), then the common pieces.
export const TERRAINS = ["grass", "dirt", "sand", "snow", "stone", "purple"];
export const PIECES = [
  "block_top_left", "block_top", "block_top_right", "block_left", "block_center", "block_right", "block_bottom_left", "block_bottom", "block_bottom_right",
  "block", "horizontal_left", "horizontal_middle", "horizontal_right", "horizontal_overhang_left", "horizontal_overhang_right",
  "vertical_top", "vertical_middle", "vertical_bottom", "cloud_left", "cloud_middle", "cloud_right", "cloud", "cloud_background", "ramp_short_a", "ramp_short_b",
];
export const COMMON = [
  "bricks_brown", "brick_brown", "bricks_grey", "brick_grey", "block_planks", "block_plank", "block_strong_empty", "block_empty", "bridge", "bridge_logs",
  "ladder_top", "ladder_middle", "ladder_bottom", "spikes", "block_spikes", "water_top", "water", "water_top_low", "lava_top", "lava", "lava_top_low",
  "bush", "grass", "grass_purple", "mushroom_red", "mushroom_brown", "cactus", "rock", "fence", "fence_broken", "sign", "sign_left", "sign_right", "sign_exit",
  "hill", "hill_top", "hill_top_smile", "torch_on_a", "torch_on_b", "torch_off", "window", "chain", "rope", "snow", "weight", "door_open", "door_open_top",
  "door_closed", "door_closed_top", "brick_brown_diagonal", "brick_grey_diagonal", "block_strong_danger", "conveyor", "rop_attached",
];
export const TILE_NAMES = [...TERRAINS.flatMap((t) => PIECES.map((p) => `terrain_${t}_${p}`)), ...COMMON];
export const COLUMNS = 12;
export const TILE_PX = 96;
export const tile = (name) => {
  const i = TILE_NAMES.indexOf(name);
  if (i < 0) throw new Error(`no tile '${name}'`);
  return i;
};
