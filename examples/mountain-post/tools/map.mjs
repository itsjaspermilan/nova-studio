// The paper map (Select): sprites/ui/map.png, drawn by Nova's map generator (map_make) from the valley's scene file and terrain, in
// the game's palette and its rounded face. North up, the roads with their names along them, the creek and the bridge, the post
// office with its name, the cabins as little houses (no numbers, no names: the slice's rule "no house numbers, no marker for you,
// no destination"), the BRIDGE OUT barrier, the picnic spot, the overlook, the old stone wall, Pip's mast. Run from the repository's
// root: scripts/env.sh node examples/mountain-post/tools/map.mjs
import { PADS } from "./layout.mjs";
import { tool } from "./lib.mjs";
import { PAL } from "./palette.mjs";

const pad = (id) => PADS.find((p) => p.id === id).at;
const xz = ([e, n]) => [-e, n];

// The sheet: from a little west of Hazel's cabin to a little east of Pip's, from below the post office to the lake beyond the gorge.
// Drawn twice, each at the size it is shown (lib/cards.lua draws it one texel to a pixel, nearly the screen's height): 650 px high
// for the Retroid's 720p screen (ui/map_720) and 976 for 1080p (ui/map). The lettering and the roads are sized for each.
const E0 = -200, E1 = 228, N0 = -246, N1 = 352;
for (const [name, H] of [["ui/map", 976], ["ui/map_720", 650]]) {
const k = H / 990;
console.log(tool("map_make", {
  name,
  scene: "valley",
  bounds: [-E1, N0, -E0, N1],
  size: H,
  title: "Fernhollow",
  subtitle: "the valley, its roads and its creek",
  seed: 3,
  font: "rounded",
  label_size: Math.round(28 * k), // (18 px on the Retroid's screen)
  palette: {
    paper: "#f3e5c3", ink: "#45382c", label: "#3e3631", halo: PAL.cream, red: PAL.red, roof: PAL.roofRed, slate: PAL.slate,
    wood: PAL.wood, wood_dark: PAL.woodDark, stone: PAL.stone, mustard: PAL.mustard, blue: "#4f78ad",
    forest: PAL.pine, forest_dark: PAL.pineDeep, forest_light: PAL.larch, trunk: PAL.trunk,
    road: "#fbf4e2", road_edge: "#5a4634", lane: "#efdfba", lane_edge: "#6d5640",
  },
  roads: { kind: "roadline", classes: { road: { width: 13 * k }, gravel: { width: 9 * k, lane: true } } },
  water: { kind: "water", names: { creek: "Kettle Creek" } },
  water_below: 0.9,
  water_areas: [[-400, 292, 400, 700]], // (the lake beyond the gorge: entities/lake.lua's, past the terrain's edge)
  trees: { pine: ["pine", "pine2", "pine3", "larch", "larch_small"], round: ["birch"] },
  forest: { kinds: ["forest_round", "forest_tall", "forest_long"], radius: 11 },
  places: {
    post_office: { icon: "post_office", label: "Post Office" },
    cabin_hazel: { icon: "house" }, cabin_pip: { icon: "house" }, workshop: { icon: "shed" },
    bridge: { icon: "bridge" }, old_bridge: { icon: "broken_bridge" },
    barrier: { icon: "barrier", label: "Bridge out" },
    picnic_table: { icon: "picnic", label: "Picnic spot" },
    mast: { icon: "mast" },
    stone_wall: { icon: "wall" },
  },
  marks: [{ at: xz(pad("overlook")), icon: "viewpoint", label: "Overlook" }],
  areas: [{ at: xz([60, 322]), text: "the lake side" }],
}, { quiet: true }));
}
