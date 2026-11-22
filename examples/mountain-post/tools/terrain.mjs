// The valley's ground: terrain/valley.png from the roads, the creek, the gorge and the level plots of layout.mjs (terrain_write with
// `roads`), the three road ribbons (road_make), and the textured ground under them (land_make). Prints the nova.terrain line that
// scenes/valley.lua uses.
import { BOUNDS_EN, CREEK, GORGE, LAKE, PADS, ROADS, BRIDGE, xz } from "./layout.mjs";
import { put, tool } from "./lib.mjs";

const B = BOUNDS_EN;
const answer = tool("terrain_write", {
  name: "valley",
  // (x = -E: the east edge is the smaller x)
  bounds: [-B.e1, B.n0, -B.e0, B.n1],
  roads: ROADS.map((r) => ({ control: r.control.map(xz), profile: r.profile, flat: r.width / 2 + 2.5, blend: 36 })),
  pads: PADS.map((p) => ({ at: xz(p.at), radius: p.radius, blend: p.blend })),
  carve: [
    { points: CREEK.points.map(xz), profile: CREEK.profile, width: CREEK.width, bank: CREEK.bank },
    { points: GORGE.points.map(xz), profile: GORGE.profile, width: GORGE.width, bank: GORGE.bank },
    // the lake beyond the far bank: a wide flat bed along the north edge (the ground past the map keeps its height, so the lake runs on)
    { points: LAKE.points.map(xz), profile: LAKE.profile, width: LAKE.width, bank: LAKE.bank },
  ],
  rim: { height: 22, width: 55, edges: ["x0", "x1", "z0"] },
  hills: 16, hill_wavelength: 170, cell: 2, seed: 7, max_grade: 0.11,
});
console.log(answer);
const line = /nova\.terrain\{[^\n]*\}/.exec(answer)[0];
put("lib/terrain_line.lua", `-- Made by tools/terrain.mjs (terrain_write): the valley's ground. Do not edit; run the recipe again.\nreturn function() ${line} end\n`);

// The roads: one ribbon each. Kettle Creek Road is two, either side of the bridge (the creek is cut through the ground under it).
// (road_make's cross-section is 12 m with its verges; the surface itself is about two thirds of it, so a zone's width is scaled up)
const zones = (r) => [{ from: 0, to: 5000, width: Math.round((r.width * 12) / (r.surface === "road_asphalt" ? 8.3 : 7.6) * 10) / 10 }];
for (const r of ROADS) {
  if (r.id === "kettle_creek_road") {
    const pts = r.control;
    const west = [...pts.slice(0, 4), BRIDGE.a].map(xz), east = [BRIDGE.b, ...pts.slice(5)].map(xz);
    tool("road_make", { name: "kettle_west", control: west, open: true, road: r.surface, zones: zones(r), textured: true, preview: false });
    tool("road_make", { name: "kettle_east", control: east, open: true, road: r.surface, zones: zones(r), textured: true, preview: false });
  } else {
    tool("road_make", { name: r.id, control: r.control.map(xz), open: true, road: r.surface, zones: zones(r), textured: true, preview: false });
  }
}
tool("land_make", { name: "land", ground: "grass", cells: 60, cell: 8, tile: 32, repeat: 8, color: "#8fae5a", preview: false });
