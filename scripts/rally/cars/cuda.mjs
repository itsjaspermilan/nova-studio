// `car_muscle`: a late-1960s American fastback muscle car, modelled from build/blueprints/cuda.png (calibration in cuda.trace.json) the way car_gt was:
// one smooth body from buildBody, everything cut into the skin by the Cut-out modifier, bumpers / mirror / wheels / wipers / exhaust as real separate pieces.
// Numbers are 1/16 m, y up from the ground, nose along +z. Run:  scripts/env.sh node scripts/rally/blueprint-cars.mjs car_muscle
import { CHROME, DARK, GLASS, PAINT, RUBBER, STEEL, TRIM, archLiner, assemble, bar, box, buildBody, cyl, ellipse, glassOf, inset, lattice, mesh, mirrorX, path, r2, rect, rounded, rrect, shade, stroke, wheel, archE } from "../carkit.mjs";

const lo = (sx, a, b) => [Math.min(sx * a, sx * b), Math.max(sx * a, sx * b)];

function cuda(paint = "#e0701b") {
  const gap = shade(paint, 0.25), R = 5.35, track = 11.8, wheelZ = [24.7, -20.2];
  const spec = {
    paint, midY: 11,
    w: [[-34.5, 13.9], [-33, 14.15], [-28, 14.4], [-20, 14.5], [0, 14.5], [20, 14.45], [30, 14.25], [33, 14.0]],
    yb: [[-38.8, 7.0], [-37, 5.8], [-34, 5.5], [-31, 5.4], [-28.5, 4.6], [-26, 3.8], [-22, 3.4], [14, 3.4], [17, 3.5], [28, 4.2], [31, 4.7], [34, 5.0], [37, 5.6], [38.8, 6.5]],
    ys: [[-38.3, 15.0], [-35, 15.1], [-30, 15.4], [-20, 15.5], [-8, 15.3], [0, 15.3], [6, 15.4], [13, 15.5], [20, 15.2], [28, 15.0], [33, 14.6], [37, 14.0]],
    top: [[-38.2, 15.0], [-36, 15.25], [-34, 15.7], [-31, 16.4], [-28, 17.6], [-25, 19.0], [-20, 20.6], [-15, 22.1], [-10, 22.65], [-5, 22.95], [0, 23.05], [3, 23.05], [5, 22.85], [6.5, 22.1], [8, 20.4], [10, 18.4], [12, 16.5], [13.2, 15.7], [15, 15.55], [20, 15.65], [25, 15.6], [30, 15.35], [34, 14.8], [37, 14.2]],
    rw: [[-34, 13.4], [-29, 13.0], [-24, 12.0], [-19, 10.9], [-14, 10.3], [-5, 10.2], [3, 10.2], [6, 10.0], [8, 10.2], [11, 11.0], [13, 11.8]],
    drop: [[-30, 1.0], [-22, 1.6], [-14, 1.7], [0, 1.7], [5, 1.5], [9, 1.2], [13, 0.8]],
    crown: [[-30, 0.4], [-20, 0.6], [-10, 0.7], [3, 0.7], [7, 0.6], [12, 0.4]],
    ledge: 0.5, rail: 0.9, hoodP: 2.6, h0: 1.0, h1: 3.0,
    profile: [[0, 0.9], [0.1, 0.945], [0.25, 0.975], [0.5, 1.0], [0.7, 1.0], [0.88, 0.985], [1, 0.95]],
    rows: [0, 0.1, 0.25, 0.45, 0.65, 0.82, 0.93, 1],
    stations: [-31, -28, -25, -22, -19, -16.5, -14, -11, -7, -3, 0, 3, 5.5, 7.5, 9.5, 11.5, 13.5, 16, 20, 25, 29], maxGap: 3.2,
    front: { zc: 33, L: 10, plan: [[0, 38.5], [6, 38.45], [10, 38.2], [12, 37.6], [13.2, 36.6], [13.9, 35.0], [14.0, 33.0]], side: [[5.5, 36.8], [7, 37.3], [8.5, 37.6], [10, 38.0], [11.5, 38.4], [13, 38.5], [14, 38.35], [14.8, 37.8]], edgeBack: [[0, 0.9], [10, 0.8], [14, 0.4]], rimTop: 0.2, rim: 0.2 },
    rear: { zc: -34.5, L: 6, plan: [[0, -38.8], [5, -38.5], [10, -38.0], [12.5, -37.3], [13.6, -36.0], [13.9, -34.5]], side: [[5.5, -34.5], [6.5, -36.0], [8, -37.5], [10, -38.1], [11, -38.4], [12.5, -38.2], [14, -37.9], [15, -37.9]], edgeBack: [[0, 0.6], [13.9, 0.3]], rimTop: 0.4, rim: 0.2 },
    crease: { rows: { 1: 0.3, 8: 0.2 } },
  };
  const { body, at } = buildBody(spec);
  const cuts = [], cut = (c) => cuts.push(c);
  const side = (o) => cut({ view: "side", facing: 0.5, ...o });
  // --- from the side: wheel openings, side glass, door, fuel cap, marker lamps, lamps that wrap the corners
  const arches = [archE(wheelZ[0], R - 0.1, 6.2, 6.0), archE(wheelZ[1] - 0.2, R - 0.1, 6.6, 6.1)];
  for (const points of arches) cut({ view: "side", points, remove: true, depth: 0.7, wall: shade(paint, 0.16), facing: -1, near: 9 });
  const dlo = rounded([[11.6, 15.5, 1], [5.4, 21.0, 1], [0, 21.15], [-5, 21.0], [-10, 20.55], [-14.8, 19.9, 1], [-14.3, 18.2], [-13.2, 16.8], [-11, 15.8], [-8, 15.5, 1]], 1);
  side({ name: "window trim", points: dlo, color: TRIM, metallic: 0.2, roughness: 0.4 });
  side({ name: "side glass", points: inset(dlo, 0.3), ...glassOf() });
  side({ name: "door gap", points: stroke([...path([[14.3, 15.2], [14.0, 11], [13.6, 7], [13.4, 5.8]], 8), ...path([[13.4, 5.6], [5, 5.5], [-6.4, 5.65]], 3), ...path([[-6.5, 5.8], [-7.0, 10], [-7.2, 15.3]], 6)], 0.17), color: gap, depth: 0.12, wall: gap, metallic: 0, roughness: 0.8 });
  side({ name: "rocker moulding", points: stroke([[12.5, 4.5], [-4, 4.45]], 0.2), color: gap, depth: 0.08, wall: gap, metallic: 0, roughness: 0.8 });
  side({ name: "fuel flange", points: ellipse(-26.5, 13.4, 1.4, 1.4, 20), color: "#c4c9d2", ...CHROME, depth: 0.1 });
  side({ name: "fuel cap", points: ellipse(-26.5, 13.4, 0.95, 0.95, 16), color: shade(paint, 0.85), depth: 0.1, wall: "#c4c9d2", metallic: 0.5, roughness: 0.3 });
  side({ name: "marker rear", points: ellipse(-33.7, 9.4, 0.48, 0.48, 10), color: "#b01620", emissive: 0.3, metallic: 0.2, roughness: 0.2, facing: 0.3 });
  side({ name: "marker front", points: ellipse(33.7, 8.1, 0.42, 0.42, 10), color: "#f59a1b", emissive: 0.3, metallic: 0.2, roughness: 0.2, facing: 0.3 });
  cut({ view: "side", facing: 0.7, name: "tail lamp side", points: rounded([[-37.6, 14.6], [-38.5, 14.9], [-39.0, 12.4], [-38.6, 11.3], [-37.8, 11.6], [-37.5, 13.3]], 1), color: "#b01620", emissive: 0.45, metallic: 0.3, roughness: 0.15 });
  cut({ view: "side", facing: 0.7, name: "front marker side", points: rounded([[38.4, 13.1], [37.4, 12.8], [37.8, 10.9], [38.6, 11.4]], 1), color: "#f59a1b", emissive: 0.4, metallic: 0.3, roughness: 0.15 });
  // --- from the front: split grille, round lamps
  const front = (o) => cut({ view: "front", mirror: true, facing: 0.5, ...o });
  const grille = rounded([[1.5, 11.9, 1], [2.5, 13.0], [10.0, 13.0], [10.0, 9.2], [2.5, 9.2], [1.5, 10.3, 1]], 1);
  front({ name: "grille frame", points: inset(grille, -0.35), color: "#b9bec6", ...CHROME, depth: 0.15 });
  front({ name: "grille", points: grille, color: "#07080a", depth: 0.55, wall: "#17191e", metallic: 0, roughness: 0.9 });
  front({ name: "parking lamp", points: rrect(4.6, 10.4, 7.0, 11.8, 0.5), color: "#f2e3c0", emissive: 0.5, metallic: 0.3, roughness: 0.15, depth: 0.15, wall: "#8d9199" });
  front({ name: "headlamp bezel", points: ellipse(12.1, 11.1, 2.0, 2.0, 24), color: "#c9cdd3", ...CHROME, depth: 0.15 });
  front({ name: "headlamp", points: ellipse(12.1, 11.1, 1.6, 1.6, 22), color: "#eef2f5", emissive: 0.55, metallic: 0.3, roughness: 0.1, depth: 0.2, wall: "#8d9199" });
  // --- from behind: the full-width tail lamp panel
  const back = (o) => cut({ view: "back", mirror: true, facing: 0.5, ...o });
  const tailP = rounded(mirrorX([[0, 15.15], [6, 15.05], [12.2, 14.8], [13.0, 14.5], [13.1, 13], [12.8, 11.3], [12.0, 10.9], [0, 10.9]]), 1);
  cut({ view: "back", facing: 0.5, name: "tail panel", points: tailP, color: "#0f1013", metallic: 0.3, roughness: 0.4, depth: 0.12 });
  cut({ view: "back", name: "tail lens", points: rrect(-12.4, 11.7, 12.4, 14.3, 0.4), color: "#b01620", emissive: 0.45, metallic: 0.3, roughness: 0.15, depth: 0.15, wall: "#3a0b0f", facing: 0.7 });
  back({ name: "deck gap", points: stroke(path([[0, 10.5], [10, 10.5], [12, 10.9], [13, 12.5]], 8), 0.15), color: gap, depth: 0.1, wall: gap, metallic: 0, roughness: 0.8, facing: 0.3 });
  // --- from above: windscreen, rear glass, bonnet vents and shut lines
  const top = (o) => cut({ view: "top", facing: 0.45, ...o });
  const screen = rounded(mirrorX([[0, 6.9], [10.3, 7.0], [12.3, 12.3], [0, 12.9]]), 1);
  top({ name: "screen trim", points: inset(screen, -0.4), color: TRIM, metallic: 0.1, roughness: 0.5 });
  top({ name: "windscreen", points: screen, ...glassOf() });
  const rearG = rounded(mirrorX([[0, -15.3], [10.6, -15.3, 1], [10.5, -22.0], [9.6, -25.3], [7.8, -27.2], [4.5, -28.2], [0, -28.5]]), 1);
  top({ name: "rear glass trim", points: inset(rearG, -0.35), color: TRIM, metallic: 0.1, roughness: 0.5 });
  top({ name: "rear glass", points: rearG, ...glassOf() });
  const vent = rounded([[30.8, 2.65, 1], [30.4, 4.3], [29.2, 4.65], [18.1, 4.65, 1], [18.1, 2.65, 1]].map(([z, x, s]) => [x, z, s]), 1);
  top({ name: "vent frame", mirror: true, points: vent, color: "#c4c9d2", ...CHROME, facing: 0.7, depth: 0.1 });
  top({ name: "vent slot", mirror: true, points: inset(vent, 0.35), color: "#07080a", depth: 0.5, wall: "#15171b", metallic: 0, roughness: 0.9, facing: 0.7 });
  top({ name: "vent spear", mirror: true, points: stroke([[2.9, 36.5], [2.7, 25.0]], 0.14), color: shade(paint, 0.55), depth: 0.05, wall: shade(paint, 0.45), metallic: 0, roughness: 0.8, facing: 0.7 });
  top({ name: "bonnet gap", mirror: true, points: stroke(path([[0, 37.2], [6, 37.1], [11, 36.8], [13.0, 35.0], [13.6, 30], [13.7, 20], [13.2, 14.8]], 14), 0.16), color: gap, depth: 0.1, wall: gap, metallic: 0, roughness: 0.8, facing: 0.5 });
  top({ name: "deck gap top", mirror: true, points: stroke(path([[0, -30.4], [7, -30.1], [10.5, -29.4], [11.3, -30.3], [11.8, -34], [12.0, -37.6]], 12), 0.15), color: gap, depth: 0.1, wall: gap, metallic: 0, roughness: 0.8, facing: 0.3 });
  body.modifiers.push({ type: "cutout", cuts });

  const cubes = [body];
  // the grille's mesh behind its frame, the shut-line hardware behind the openings
  for (const sx of [1, -1]) cubes.push(lattice(`grille mesh ${sx}`, grille.map(([x, y]) => [sx * x, y]), at.front, 1, 0.35, 0.5, 0.11, "#b4b9c1", { material: CHROME, straight: true }));
  for (const [k] of wheelZ.entries()) for (const sx of [1, -1]) cubes.push(archLiner(`wheel house ${k} ${sx}`, arches[k].slice(1, -1), 14.0, track - 3.0, sx));
  cubes.push(box("floor", -11, 11, 3.0, 3.5, -30, 31, "#0b0c0e", { material: { metallic: 0, roughness: 1 } }));
  // chrome bumpers: a bar across with a wrap-round end each side
  cubes.push(box("front bumper", -13.4, 13.4, 6.75, 8.75, 37.1, 38.95, "#c4c9d2", { round: 0.7, segs: 3, material: CHROME }));
  cubes.push(box("rear bumper", -13.6, 13.6, 7.3, 10.2, -39.45, -37.1, "#c4c9d2", { round: 0.7, segs: 3, material: CHROME }));
  for (const sx of [1, -1]) {
    cubes.push(box(`front bumper end ${sx}`, ...lo(sx, 11.8, 14.3), 6.9, 8.9, 33.2, 38.6, "#c4c9d2", { round: 0.8, segs: 3, material: CHROME }));
    cubes.push(box(`rear bumper end ${sx}`, ...lo(sx, 12.0, 14.4), 7.1, 10.0, -39.2, -33.6, "#c4c9d2", { round: 0.8, segs: 3, material: CHROME }));
    // exhaust tips under the rear bumper
    cubes.push(cyl(`exhaust ${sx}`, sx * 7.2, 6.1, -38.2, 0.85, 3.2, "z", "#c4c9d2", { segments: 14, material: CHROME }));
    cubes.push(cyl(`exhaust bore ${sx}`, sx * 7.2, 6.1, -39.8, 0.55, 0.1, "z", "#050506", { segments: 12 }));
    const xh = at.side(-5.1, 14.2);
    cubes.push(box(`door handle ${sx}`, ...lo(sx, xh - 0.15, xh + 0.4), 13.9, 14.5, -6.6, -3.6, "#c4c9d2", { round: 0.12, segs: 2, material: CHROME }));
  }
  cubes.push(box("plate", -2.8, 2.8, 8.1, 9.8, -39.6, -39.45, "#ecece6", {}));
  // the round door mirror (driver's side) on a short arm
  cubes.push(bar("mirror arm", [12.6, 15.9, 7.4], [14.2, 16.9, 5.9], 0.35, 0.3, "#c4c9d2", { material: CHROME }));
  cubes.push(cyl("mirror", 14.6, 16.9, 5.3, 1.2, 1.0, "z", paint, { segments: 20, material: PAINT }));
  cubes.push(cyl("mirror glass", 14.6, 16.9, 4.78, 1.0, 0.1, "z", "#aebfd0", { segments: 20, material: CHROME }));
  // wipers parked at the foot of the screen
  const onTop = (x, z, lift = 0.12) => [x, at.top(x, z) + lift, z];
  for (const [x0, z0, x1, z1] of [[1.0, 12.4, 9.6, 11.0], [-1.0, 12.4, -9.6, 11.0]]) cubes.push(bar("wiper", onTop(x0, z0), onTop(x1, z1), 0.42, 0.22, "#0b0c0e", { material: RUBBER }, [0, 0.78, 0.63]));
  // steel wheels with a chrome hub cap
  const wheelOf = (sx) => wheel({ R, width: 3.2, rimR: 3.6, rim: "#8d9199", rimMaterial: STEEL, windows: [], hubR: 0.55, nuts: 5, nutAt: 1.2, dish: 0.35, cap: "#c9cdd3", nut: "#8d9199" }, sx);
  return { model: assemble({ cubes, pivot: R, wheelZ, track, wheelOf, R }), tail: { z: r2(-38.4 / 16), y: r2(13.0 / 16 - 0.06), x: r2(9.5 / 16 / 0.92) } };
}

export const CARS = {
  car_muscle: () => cuda(),
  car_muscle_blue: () => cuda("#2b4f9c"),
  car_muscle_green: () => cuda("#3f6b3a"),
  car_muscle_white: () => cuda("#e6e2d6"),
};
void [DARK, GLASS, mesh, rect];
