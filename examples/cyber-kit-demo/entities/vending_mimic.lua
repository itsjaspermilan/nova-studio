-- A vending machine that is not (creature_make { kind = "vending_mimic" }): shut, it is the tileset's machine; when the
-- runner comes near it flashes its tell and opens.
return require("lib.enemy") {
  sprite = "vending_mimic", still = true, after_tell = "open", hp = 4, reach = 130, sees = 130,
  pivot = { 0.5, 0.863 }, hitbox = { -14, -20, 28, 20 },
}
