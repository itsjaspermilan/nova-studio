// Pine Ridge Rally's road cars, modelled from blueprints with scripts/rally/body.mjs (a mirrored, subdivided half cage with creases; see
// there). Each entry is the car's drawing: profiles along its length in 1/16 m ([z, value] nodes, the tail at -z, the nose at +z), where the
// glass starts and stops, where the door gaps are, and its paint.
//   scripts/env.sh node scripts/rally/bodies.mjs [name ...]
import { withServer } from "./mcp.mjs";
import { buildBody } from "./body.mjs";
import { mul } from "./parts.mjs";

/// The same drawing longer or shorter: every z (the profiles, glass, gaps, wheels, ends) scaled by k.
function stretch(s, k) {
  const zs = (list) => list.map(([z, v]) => [z * k, v]);
  const pair = (list) => list.map(([a, b]) => [a * k, b * k]);
  return { ...s, zr: s.zr * k, zf: s.zf * k, w: zs(s.w), yb: zs(s.yb), belt: zs(s.belt), top: zs(s.top), roofW: zs(s.roofW), wheelZ: s.wheelZ.map((z) => z * k), sideWin: pair(s.sideWin),
    seams: (s.seams ?? []).map((z) => z * k), screen: s.screen && s.screen.map((z) => z * k), rear: s.rear && s.rear.map((z) => z * k), bed: s.bed && [s.bed[0] * k, s.bed[1] * k, s.bed[2]] };
}

const sedan = (o) => ({
  zr: -37, zf: 37, R: 6.0, tw: 7.4, track: 11.6, wheelZ: [23, -22.5], pivot: 6, wheel: 0.375,
  w: [[-37, 11.4], [-35.6, 13.9], [-31, 14.9], [31, 14.9], [35.6, 13.6], [37, 11.0]],
  yb: [[-37, 7.0], [-35, 4.2], [-28, 3.8], [28, 3.8], [35, 4.4], [37, 7.2]],
  belt: [[-37, 15.2], [-31, 15.6], [30, 15.2], [37, 13.6]],
  top: [[-37, 15.6], [-33, 16.6], [-26, 16.8], [-22, 17.4], [-12, 24.4], [4, 24.6], [8, 24.2], [17, 16.4], [22, 16.0], [31, 15.0], [35.5, 14.0], [37, 12.4]],
  roofW: [[-37, 9.8], [-33, 12.4], [-24, 13.4], [-20, 12.2], [-12, 11.0], [8, 11.0], [14, 12.8], [20, 13.8], [31, 14.0], [37, 10.5]],
  sideWin: [[-17, -2.5], [0.2, 11]], seams: [12.5, -1.2, -19], screen: [8, 17.5], rear: [-23, -12],
  bumper: "#23252c", ...o,
});
const coupe = (o) => ({
  zr: -38, zf: 38, R: 6.2, tw: 8.0, track: 11.9, wheelZ: [25, -24], pivot: 6.2, wheel: 0.385, flare: 1.1, exhaust: true,
  w: [[-38, 11.6], [-36.6, 14.6], [-31, 15.5], [31, 15.5], [36.4, 14.2], [38, 11.4]],
  yb: [[-38, 6.6], [-36, 3.8], [-28, 3.4], [28, 3.4], [36, 4.0], [38, 6.4]],
  belt: [[-38, 14.8], [-30, 14.4], [0, 13.9], [30, 13.8], [38, 12.0]],
  top: [[-38, 15.4], [-34, 16.0], [-30, 16.2], [-24, 18.4], [-12, 22.2], [-2, 22.6], [2, 22.2], [12, 15.0], [20, 14.6], [32, 13.6], [36.5, 12.6], [38, 11.0]],
  roofW: [[-38, 10.5], [-33, 13.4], [-26, 13.6], [-16, 11.2], [-4, 10.2], [2, 10.6], [12, 13.6], [20, 14.4], [31, 14.6], [38, 10.8]],
  sideWin: [[-19, 0.5]], seams: [12.6, -22], screen: [2, 12.5], rear: [-27, -12.5], bumper: "#23252c", ...o,
});
const hatch = (o) => ({
  zr: -32, zf: 32, R: 5.8, tw: 7.2, track: 11.6, wheelZ: [20, -20], pivot: 5.8, wheel: 0.36,
  w: [[-32, 11.8], [-30.8, 13.9], [-27, 14.8], [27, 14.8], [30.6, 13.5], [32, 11.2]],
  yb: [[-32, 6.6], [-30, 4.4], [-24, 4.0], [24, 4.0], [30, 4.6], [32, 6.8]],
  belt: [[-32, 16.0], [-26, 16.0], [30, 15.0], [32, 13.8]],
  top: [[-32, 18.0], [-30.4, 23.0], [-27, 25.0], [-8, 25.4], [3, 25.2], [8, 24.6], [15, 16.4], [20, 16.0], [28, 14.8], [31, 13.6], [32, 12.2]],
  roofW: [[-32, 9.2], [-30.4, 10.8], [-26, 12.2], [3, 12.2], [8, 12.6], [15, 13.6], [28, 14.0], [32, 10.5]],
  sideWin: [[-25, -8.5], [-6, 6.5]], seams: [7.6, -7.2], screen: [6, 15.5], rear: [-31, -27.5], bumper: "#23252c", ...o,
});
const suv = (o) => ({
  zr: -37, zf: 37, R: 7.0, tw: 8.0, track: 12.9, wheelZ: [22.5, -22], pivot: 7, wheel: 0.44, dent: 3.4, archTrim: "#23252c",
  w: [[-37, 12], [-35.6, 14.6], [-31, 15.6], [31, 15.6], [35.6, 14.6], [37, 12]],
  yb: [[-37, 8.6], [-35, 6.0], [-28, 5.6], [28, 5.6], [35, 6.2], [37, 8.8]],
  belt: [[-37, 19.4], [-30, 19.6], [30, 19.4], [37, 17.6]],
  top: [[-37, 26.0], [-35.8, 29.6], [-33, 30.2], [-8, 30.4], [6, 30.2], [10, 29.6], [20, 19.6], [24, 19.8], [34, 18.6], [36, 17.6], [37, 15.8]],
  roofW: [[-37, 10], [-35.8, 12], [-32, 13], [8, 12.8], [14, 13.8], [22, 14.6], [32, 14.6], [37, 12]],
  sideWin: [[-31, -17.5], [-15.5, -1.8], [0.2, 12]], seams: [13, -0.8, -16.5], screen: [10, 20], rear: [-36.4, -34], bumper: "#23252c", ...o,
});
const van = (o) => ({
  zr: -40, zf: 40, R: 6.4, tw: 7.6, track: 11.8, wheelZ: [25, -25], pivot: 6.4, wheel: 0.4, dent: 3.2, archTrim: "#23252c",
  w: [[-40, 11.0], [-38.6, 14.0], [-35, 15.2], [35, 15.2], [38.6, 14.0], [40, 11.5]],
  yb: [[-40, 8.0], [-38, 5.4], [-30, 4.8], [30, 4.8], [38, 5.4], [40, 8.0]],
  belt: [[-40, 16.0], [-37, 17.4], [30, 17.4], [40, 15.4]],
  top: [[-40, 25.0], [-38.6, 29.0], [-36, 31.0], [12, 31.0], [16, 30.2], [23, 20.4], [26, 19.4], [37.5, 18.4], [39.2, 16.8], [40, 14.0]],
  roofW: [[-40, 8.0], [-38.6, 10.4], [-35, 12.6], [12, 12.6], [16, 12.8], [23, 14.2], [30, 14.8], [40, 12.0]],
  sideWin: [[-33, -21.5], [-19.5, -3.5], [-0.5, 11.5]], seams: [12.8, -1.4, -20.5], screen: [13, 23], rear: [-39.2, -36.4], ...o,
});
const pickup = (o) => ({
  zr: -41, zf: 41, R: 6.8, tw: 7.8, track: 12.3, wheelZ: [24.5, -24], pivot: 6.8, wheel: 0.425, dent: 3.2, archTrim: "#23252c",
  w: [[-41, 12.4], [-39.6, 14.6], [-35, 15.4], [35, 15.4], [38.6, 14.2], [41, 11.6]],
  yb: [[-41, 7.4], [-39, 5.0], [-30, 5.0], [30, 5.0], [38, 5.6], [41, 7.6]],
  belt: [[-41, 20.4], [-16, 20.4], [-12, 19.4], [34, 19.2], [41, 17.4]],
  top: [[-41, 20.4], [-16.5, 20.4], [-14.6, 26.0], [-12, 28.0], [4, 28.4], [7, 27.6], [16, 19.8], [22, 19.9], [34, 19.0], [39.4, 17.6], [41, 15.8]],
  roofW: [[-41, 12.6], [-16.5, 13.8], [-14, 12.6], [-9, 11.4], [5, 11.4], [10, 12.8], [16, 14], [30, 14.6], [41, 12]],
  sideWin: [[-8.5, 10.6]], seams: [11.4], screen: [7, 16.5], rear: [-14.6, -9.5], bed: [-40.6, -16.5, 16.2], bumper: "#23252c",
  extras: [({ cubes, box, s: sp }) => { cubes.push(box("tailgate", -12.2, 12.2, 16.2, 20.2, -41.3, -39.6, sp.paint, { bevel: 0.7, segs: 2, material: { metallic: 0.4, roughness: 0.28 } }), box("bed front lip", -12.2, 12.2, 16.2, 19.6, -17.8, -16.6, mul(sp.paint, 0.85), { bevel: 0.5, segs: 2 })); }], ...o,
});

const roofBox = (name, w, d, h, color, z, emissive) => ({ cubes, box, s, along }) => { const top = along(s.top, z); cubes.push(box(name, -w / 2, w / 2, top - 0.3, top + h, z - d / 2, z + d / 2, color, { bevel: 0.5, segs: 2, emissive })); };

const CARS = {
  car_sedan: () => sedan({ paint: "#e0442c", roof: "#1b1d24", stripe: { color: "#f3f5f8", half: 2.4 } }),
  car_taxi: () => stretch(sedan({ paint: "#f6b81c", roof: "#f6b81c", band: "#1b1d24", extras: [roofBox("taxi sign", 9, 3.6, 2.8, "#fff6d0", -5, 0.6)] }), 39 / 37),
  car_police: () => stretch(sedan({ paint: "#f2f4f7", roof: "#1b1d24", band: "#1f3a8a", bumper: "#1f3a8a",
    extras: [({ cubes, box, s, along }) => { const top = along(s.top, -5); cubes.push(box("siren red", -6.4, -0.4, top - 0.3, top + 2.2, -9, -4, "#ff3340", { bevel: 0.5, segs: 2, emissive: 0.95 }), box("siren blue", 0.4, 6.4, top - 0.3, top + 2.2, -9, -4, "#3d7bff", { bevel: 0.5, segs: 2, emissive: 0.95 })); }] }), 39 / 37),
  car: () => coupe({ paint: "#d91f35", roof: "#d91f35", stripe: { color: "#f4f6fa", half: 2.2 } }),
  car_blue: () => coupe({ paint: "#2563c9", roof: "#2563c9", stripe: { color: "#f4f6fa", half: 2.6 } }),
  car_yellow: () => coupe({ paint: "#ffc61a", roof: "#1c1d22", stripe: { color: "#1c1d22", half: 2.4 } }),
  car_green: () => hatch({ paint: "#33b46c", roof: "#f3f5f8", stripe: { color: "#f3f5f8", half: 1.6 } }),
  car_suv: () => suv({ paint: "#5b8f5a", roof: "#e9ecef" }),
  car_suvl: () => stretch(suv({ paint: "#27324d", roof: "#27324d", stripe: { color: "#c9ced6", half: 1.4 } }), 39 / 37),
  car_van: () => van({ paint: "#f1efe7", band: "#2b5aa8", bumper: "#2b5aa8", roof: "#f1efe7" }),
  car_pickup: () => pickup({ paint: "#e0842a", roof: "#e0842a" }),
};
void mul;

const want = process.argv.slice(2);
await withServer(async (nova) => {
  for (const [name, make] of Object.entries(CARS)) {
    if (want.length && !want.includes(name)) continue;
    const { model, tail } = buildBody(make());
    await nova.call("model_write", { name, model });
    console.log("wrote", name, `TAIL ${name} = { z = ${tail.z}, y = ${tail.y}, x = ${tail.x} }`, `wheel ${make().wheel}`);
  }
});
