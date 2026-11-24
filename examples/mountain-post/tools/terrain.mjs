// The valley's ground: terrain/valley.png from the roads, the creek, the gorge and the level plots of layout.mjs (terrain_write with
// `roads`), the roads as one network with proper junctions (road_make with `roads`: models/road_valley.glb), and the textured ground under
// them (land_make). Prints the nova.terrain line that
// scenes/valley.lua uses.
import { BOUNDS_EN, CREEK, DRIVES, GORGE, LAKE, PADS, PONDS, ROADS, pondRadius, xz } from "./layout.mjs";
import { put, tool } from "./lib.mjs";
import { NETWORK, roads } from "./roads.mjs";

const B = BOUNDS_EN;
const answer = tool("terrain_write", {
  name: "valley",
  // (x = -E: the east edge is the smaller x)
  bounds: [-B.e1, B.n0, -B.e0, B.n1],
  roads: ROADS.map((r) => ({ control: r.control.map(xz), profile: r.profile, flat: r.width / 2 + 2.5, blend: 36 })),
  // (the drives' yards, level with the road nearest them; the drives run over the house plots or between a yard and its road at one
  // level. And each pond's plot: level ground at its `plot` height, the recipe's own height of the ground there, round the bowl)
  pads: [...PADS.map((p) => ({ at: xz(p.at), radius: p.radius, blend: p.blend })),
    // (a yard on its house's plot needs no pad of its own: since the owner's ninth notes every yard is, right by its house)
    ...DRIVES.filter((d) => !PADS.some((p) => Math.hypot(d.yard.at[0] - p.at[0], d.yard.at[1] - p.at[1]) + d.yard.radius <= p.radius)).map((d) => ({ at: xz(d.yard.at), radius: d.yard.radius + 2, blend: 16 })),
    ...PONDS.map((p) => ({ at: xz(p.at), radius: pondRadius(p), blend: p.blend, height: p.plot }))],
  carve: [
    { points: CREEK.points.map(xz), profile: CREEK.profile, width: CREEK.width, bank: CREEK.bank },
    // (its bank stops at Post Road's level ground: the road ends at the BRIDGE OUT barrier on firm ground, not down the bank)
    { points: GORGE.points.map(xz), profile: GORGE.profile, width: GORGE.width, bank: GORGE.bank, spare_roads: true },
    // the lake beyond the far bank: a wide flat bed along the north edge (the ground past the map keeps its height, so the lake runs on)
    { points: LAKE.points.map(xz), profile: LAKE.profile, width: LAKE.width, bank: LAKE.bank },
    // the ponds' bowls: each lobe a short stroke `depth` under its level plot, the bank rising 1 in `bank` (layout.mjs PONDS)
    ...PONDS.flatMap((p) => p.lobes.map(([a, b, w]) => ({ points: [xz(a), xz(b)], profile: [[0, p.plot - p.depth], [100, p.plot - p.depth]], width: w, bank: p.bank }))),
  ],
  rim: { height: 22, width: 55, edges: ["x0", "x1", "z0"] },
  hills: 16, hill_wavelength: 170, cell: 2, seed: 7, max_grade: 0.11,
});
console.log(answer);
const line = /nova\.terrain\{[^\n]*\}/.exec(answer)[0];
put("lib/terrain_line.lua", `-- Made by tools/terrain.mjs (terrain_write): the valley's ground. Do not edit; run the recipe again.\nreturn function() ${line} end\n`);

// The road sheet: every road is gravel (the owner's ninth notes), its column drawn "soft" (surface_make: no wheel ruts, which read as
// two dark lines; a lighter crown, darker shoulders, stones and pebbles, patchy worn wheel paths, grass creeping in at the edges).
tool("surface_make", { surfaces: ["road"], road: { gravel: "soft" } }, { quiet: true });
// The roads: one network (road_make with `roads`), models/road_valley.glb: Fern Lane and Kettle Creek Road join Post Road at proper
// junctions (filleted corners, all gravel: no apron, no edge or centre lines), the free ends rounded, and Kettle Creek Road stops
// square with a threshold strip at each end of the bridge's deck (the creek is cut through the ground under it).
console.log(tool("road_make", { name: "valley", ...NETWORK, preview: false }, { quiet: true }));
// The junctions' ground for the game (lib/world.lua: the surface under a wheel, where ferns may grow): each junction's area and how far
// up the lane its surface runs, from the same builder road_make used (the same numbers give the same junctions).
{
  const r2 = (v) => Math.round(v * 100) / 100;
  const word = (k) => (k === "road_asphalt" ? "road" : "gravel");
  const rows = roads().net.junctions.filter((j) => j.area).map((j) =>
    `  { through = "${j.through}", road = "${j.road}", from = "${j.end}", surface = "${word(j.surface)}", paved = ${r2(j.paved)}, at = { ${j.at.map(r2).join(", ")} },\n    area = { ${j.area.flat().map(r2).join(", ")} },\n    apron = { ${(j.apron ?? []).flat().map(r2).join(", ")} } },`);
  put("lib/road_junctions.lua", `-- Made by tools/terrain.mjs (the road builder's junctions, scripts/lib/roadnet.mjs). Do not edit; run the recipe again.\n-- Each: the road through it and the road that joins it (at its start or end), the junction's surface, how many metres up the joining\n-- road that surface runs, the node, the area (x, z pairs) its patch and corners cover on the joining road's side, and the apron's outline.\nreturn {\n${rows.join("\n")}\n}\n`);
}
tool("land_make", { name: "land", ground: "grass", cells: 60, cell: 8, tile: 32, repeat: 8, color: "#8fae5a", preview: false });
