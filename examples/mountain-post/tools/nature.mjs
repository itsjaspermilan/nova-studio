// The valley's trees, rocks and low plants from prop3d_make (the low style: few flat faces), in one palette of warm, slightly
// muted greens; and the far blue mountains. The larches and the ferns are made in models.mjs.
import { tool } from "./lib.mjs";

const palette = { base: "bright meadow", leaf: "#3f7448", trunk: "#6e4b34", rock: "#8e9283", grass: "#79a046", flower: "#e8d9a0", flower2: "#d9897a", flower3: "#c6b4e0" };
tool("prop3d_make", {
  palette,
  preview: false,
  kinds: [
    { kind: "pine", name: "pine", seed: 1 }, { kind: "pine", name: "pine2", seed: 3 }, { kind: "pine", name: "pine3", seed: 7 },
    { kind: "tree", name: "birch", seed: 2 },
    { kind: "rock", name: "rock", seed: 1 }, { kind: "rock", name: "rock_big", seed: 4, size: "large" }, { kind: "rock", name: "rock_small", seed: 6, size: "small" },
    { kind: "bush", name: "bush", seed: 1 }, { kind: "bush", name: "bush2", seed: 5 },
    { kind: "grass", name: "grass", seed: 1 }, { kind: "flowers", name: "flowers", seed: 1 },
    { kind: "log", name: "log", seed: 1 }, { kind: "stump", name: "stump", species: "cut" },
  ],
});
// the far mountains: the detailed range, tinted blue by the fog and by the game
tool("prop3d_make", { kind: "mountain", name: "mountain", species: "range", palette, preview: false });
tool("prop3d_make", { kind: "cloud", name: "cloud", species: "cumulus", palette, preview: false });
tool("model_preview", { names: ["pine", "pine2", "pine3", "birch", "larch", "rock", "rock_big", "bush", "grass", "flowers", "log", "stump", "fern", "fern_big", "mountain"], fit: "each", yaw: 25, pitch: 15, columns: 5, width: 240, height: 200, image_out: "build/look/nature.png" });
