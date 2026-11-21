// `car_offroad` in Pine Ridge Rally: a short 4x4 wagon (4060 x 1690 x 1885 mm, wheelbase 2310), modelled from the owner's blueprint with the car kit
// (2026-11-19). Every number below was read off the drawing (side, plan, front and rear views, each calibrated to its own dimension lines). No badges or lettering.
import { DARK, GLASS_COL, TRIM, archOutline, flare, glassOf, mirrorX, CHROME, GLASS, PAINT, PLASTIC, RUBBER, STEEL, archLiner, assemble, bar, box, buildBody, cyl, ellipse, fillet, hexa, inset, lattice, lerp, mesh, mix, path, pebble, r2, rect, rounded, rrect, shade, spokeWindows, stroke, wheel } from "../kit.mjs";

export function offroad(paint = "#d2bb8c") {
  const gap = shade(paint, 0.3), R = 6.5, track = 11.3, wheelZ = [20.0, -17.0];
  const spec = {
    paint, material: { metallic: 0.15, roughness: 0.45, coat: 0.7 }, midY: 14,
    w: [[-29.3, 13.2], [-28.5, 13.45], [-20, 13.5], [0, 13.5], [20, 13.5], [28, 13.4], [29.6, 13.2], [30.5, 12.6]],
    yb: [[-29.3, 9.8], [-28.6, 9.8], [-24.5, 7.4], [-10, 7.0], [12, 7.0], [14, 7.3], [26, 7.3], [27.6, 10.3], [30.5, 10.3]],
    top: [[-29.3, 29.4], [-28.3, 29.6], [-26, 30.0], [-20, 30.17], [-10, 30.15], [-5, 30.0], [0, 29.8], [1.2, 29.65], [2.0, 29.2], [3, 28.0], [4, 26.8], [5, 25.5], [6, 24.3], [7, 23.1], [8, 21.9], [9.3, 20.3], [10, 20.0], [20, 19.5], [28, 18.9], [30.5, 18.3]],
    ys: [[-29.3, 19.9], [9, 19.85], [10, 19.7], [20, 19.2], [30.5, 18.0]],
    rw: [[-29.3, 10.2], [-27, 10.3], [0, 10.3], [2, 10.4], [6, 11.2], [9.5, 11.8]],
    drop: [[-29, 1.5], [0, 1.5], [1.5, 1.4], [4, 0.8], [9, 0.4]],
    crown: [[-27, 0.45], [1, 0.4], [3, 0.2], [9, 0.15]],
    ledge: 0.3, rail: 0.7, hoodP: 4.5,
    profile: [[0, 0.975], [0.15, 0.99], [0.4, 1.0], [0.8, 1.0], [0.93, 0.99], [1, 0.965]],
    rows: [0, 0.1, 0.25, 0.45, 0.65, 0.82, 0.93, 1],
    stations: [-24, -17, -10, -8.3, -4, 0, 2.2, 4, 6, 8, 9.5, 13, 20, 27], maxGap: 3.4,
    front: { zc: 29.4, L: 4, plan: [[0, 30.5], [10, 30.5], [12, 30.35], [12.9, 29.95], [13.25, 29.4]], side: [[10, 30.3], [11, 30.5], [17.5, 30.5], [18.3, 30.25]], edgeBack: [[0, 0.25], [13.3, 0.2]], rim: 0.55, rimTop: 0.5 },
    rear: { zc: -28.3, L: 3, hood: false, plan: [[0, -29.2], [10, -29.2], [12.3, -29.05], [13.1, -28.75], [13.45, -28.3]], side: [[9.8, -29.2], [20, -29.15], [27, -28.75], [28.6, -28.4], [29.5, -27.8], [30, -27.2]], edgeBack: [[0, 1.4], [10.3, 1.35], [11, 0.75], [12, 0.3], [13.03, 0.05]], rim: 0.5, rimTop: 0.4 },
    crease: { rows: { 1: 0.5, 8: 0.45 }, cols: { 3: 0.3, 5: 0.25 } },
  };
  const { body, at } = buildBody(spec);
  const cuts = [], cut = (c) => cuts.push(c);
  const side = (o) => cut({ view: "side", facing: 0.6, ...o });
  // --- from the side
  const archF = [[27.2, 6], [27.0, 9.5], [26.3, 11.2], [24.8, 12.7], [23.2, 13.2], [16.4, 13.2], [14.9, 12.6], [13.6, 11.0], [13.1, 8.5], [13.0, 6]];
  const arches = [archF, archF.map(([z, y]) => [z - 37, y])].map((a) => rounded(a.map(([z, y], i) => [z, y, i === 0 || i === a.length - 1 ? 1 : 0]), 1));
  for (const points of arches) cut({ view: "side", points, remove: true, depth: 0.8, wall: shade(paint, 0.5), facing: -1, near: 9 });
  for (const [k, pts] of [[0, [[29.5, 17.5], [27, 17.75], [0, 17.9], [-28.9, 17.95]]], [1, [[26.5, 15.3], [13, 15.6], [-10, 15.6], [-28.9, 15.6]]], [2, [[12.6, 11.2], [-9.8, 11.2]]]]) side({ name: `swage ${k}`, points: stroke(path(pts, 6), 0.15), color: shade(paint, 0.62), depth: 0.05, wall: shade(paint, 0.5) });
  const doorGlass = fillet([[6.7, 20.2], [1.5, 27.6], [-7.5, 27.6], [-7.5, 20.2]], 0.5), quarter = rrect(-26.9, 20.2, -11.5, 27.7, 0.7);
  for (const [nm, g] of [["door", doorGlass], ["quarter", quarter]]) {
    side({ name: `${nm} window trim`, points: inset(g, -0.4), color: TRIM, metallic: 0, roughness: 0.6 });
    side({ name: `${nm} glass`, points: g, ...glassOf() });
  }
  side({ name: "slider", points: stroke([[-18.8, 20.2], [-18.8, 27.7]], 0.5), color: TRIM });
  side({ name: "slider latch", points: stroke([[-22.3, 20.2], [-22.3, 27.7]], 0.2), color: TRIM });
  side({ name: "door gap", points: stroke([[7.9, 20.3], [8.4, 19.6], [8.5, 11], [8.2, 9.2], [7.3, 8.0], [-8.3, 7.95], [-8.3, 28.4], [1.4, 28.45], [7.9, 20.3]], 0.17), color: gap, depth: 0.12, wall: gap, metallic: 0, roughness: 0.8 });
  side({ name: "handle pocket", points: rrect(-7.3, 16.15, -4.0, 17.35, 0.3), color: "#0c0d10", depth: 0.3, wall: shade(paint, 0.45) });
  side({ name: "keyhole", points: ellipse(-6.4, 18.3, 0.22, 0.22, 8), color: "#c8ccd2", ...CHROME });
  for (let k = 0; k < 3; k++) side({ name: "fender vent", points: rect(12.1 + k * 0.75, 16.35, 12.65 + k * 0.75, 16.95), color: "#0c0d10", depth: 0.15 });
  side({ name: "marker frame", points: rrect(-24.9, 16.15, -21.3, 17.55, 0.25), color: "#17181c", metallic: 0, roughness: 0.6 });
  for (let k = 0; k < 3; k++) side({ name: "marker lens", points: rect(-24.65 + k * 1.1, 16.4, -23.75 + k * 1.1, 17.3), color: k === 1 ? "#f59a1b" : "#c2161f", emissive: 0.3, metallic: 0.2, roughness: 0.2 });
  side({ name: "corner lamp side", points: rect(28.9, 14.4, 30.3, 16.5), color: "#cfd6dc", emissive: 0.25, metallic: 0.3, roughness: 0.15 });
  side({ name: "indicator side", points: rect(28.9, 12.9, 30.3, 14.3), color: "#f59a1b", emissive: 0.3, metallic: 0.2, roughness: 0.2 });
  side({ name: "fuel flap", points: stroke([...rrect(-25.6, 12.3, -23.2, 14.4, 0.4), [-25.6, 12.9]], 0.13), color: gap, depth: 0.08, wall: gap, metallic: 0, roughness: 0.8, only: "+x" });
  // --- from the front: the screen, the black panel with the grille and lamps
  const front = (o) => cut({ view: "front", facing: 0.5, ...o });
  const screen = fillet([[-11.4, 21.0], [11.4, 21.0], [9.9, 28.4], [-9.9, 28.4]], 0.6);
  front({ name: "screen rubber", points: inset(screen, -0.4), color: TRIM, metallic: 0, roughness: 0.6 });
  front({ name: "windscreen", points: screen, ...glassOf() });
  front({ name: "front panel", points: rrect(-11.95, 12.3, 11.95, 17.6, 0.4), color: "#17181c", metallic: 0, roughness: 0.6 });
  const grille = rrect(-5.9, 12.75, 5.9, 16.55, 0.35);
  front({ name: "grille", points: grille, color: "#07080a", depth: 0.5, wall: "#111216", metallic: 0, roughness: 0.9 });
  front({ name: "headlamp ring", mirror: true, points: ellipse(8.2, 14.65, 2.0, 2.0, 24), color: "#c9cdd3", ...CHROME });
  front({ name: "headlamp", mirror: true, points: ellipse(8.2, 14.65, 1.68, 1.68, 20), color: "#eef2f5", emissive: 0.55, metallic: 0.3, roughness: 0.1, depth: 0.12, wall: "#8d9199" });
  front({ name: "corner lamp", mirror: true, points: rect(10.4, 14.4, 11.9, 16.5), color: "#cfd6dc", emissive: 0.25, metallic: 0.3, roughness: 0.15 });
  front({ name: "indicator", mirror: true, points: rect(10.4, 12.9, 11.9, 14.3), color: "#f59a1b", emissive: 0.3, metallic: 0.2, roughness: 0.2 });
  front({ name: "valance slot", mirror: true, points: rrect(0.6, 10.8, 4.6, 11.7, 0.3), color: "#07080a", depth: 0.3 });
  // --- from behind: the two doors (the wide one carries the spare), their glass, lamps
  const back = (o) => cut({ view: "back", facing: 0.5, ...o });
  for (const [nm, g] of [["narrow", rrect(3.4, 20.4, 10.3, 27.4, 0.6)], ["wide", rrect(-10.3, 20.4, 1.9, 27.4, 0.6)]]) {
    back({ name: `${nm} door rubber`, points: inset(g, -0.35), color: TRIM, metallic: 0, roughness: 0.6 });
    back({ name: `${nm} door glass`, points: g, ...glassOf() });
  }
  back({ name: "rear door gaps", points: stroke([[2.3, 10.1], [2.3, 28.3], [11.7, 28.3], [11.75, 10.1], [-11.75, 10.1], [-11.7, 28.3], [2.3, 28.3]], 0.17), color: gap, depth: 0.12, wall: gap, metallic: 0, roughness: 0.8 });
  back({ name: "rear handle pocket", points: rrect(3.4, 18.4, 5.9, 19.6, 0.3), color: "#0c0d10", depth: 0.3, wall: shade(paint, 0.45) });
  back({ name: "plate lamp", points: rrect(5.0, 12.95, 8.9, 13.9, 0.25), color: "#17181c", metallic: 0, roughness: 0.6 });
  back({ name: "plate holder", points: rect(3.1, 10.7, 10.8, 12.9), color: "#17181c", depth: 0.1 });
  back({ name: "plate", points: rect(3.5, 10.95, 10.4, 12.65), color: "#ecece6", metallic: 0, roughness: 0.5 });
  back({ name: "tail housing", mirror: true, points: rrect(11.9, 10.9, 13.0, 15.1, 0.25), color: "#17181c", metallic: 0, roughness: 0.6, facing: 0.3 });
  back({ name: "brake light", mirror: true, points: rect(12.05, 13.1, 12.9, 14.9), color: "#c2161f", emissive: 0.5, metallic: 0.2, roughness: 0.2, facing: 0.3 });
  back({ name: "tail indicator", mirror: true, points: rect(12.05, 11.1, 12.9, 12.95), color: "#f59a1b", emissive: 0.3, metallic: 0.2, roughness: 0.2, facing: 0.3 });
  // --- from above: bonnet shut lines, the scuttle, the gutters
  const top = (o) => cut({ view: "top", facing: 0.6, ...o });
  top({ name: "scuttle", points: rect(-11.6, 8.75, 11.6, 9.9), color: "#17181c", metallic: 0, roughness: 0.6 });
  top({ name: "bonnet gap", mirror: true, points: stroke([[0, 29.9], [10.6, 29.9], [11.2, 29.3], [11.6, 10.0]], 0.17), color: gap, depth: 0.1, wall: gap, metallic: 0, roughness: 0.8 });
  top({ name: "bonnet rib", mirror: true, points: stroke([[1.3, 28.6], [1.3, 11.8], [7.6, 11.4], [7.9, 28.4]], 0.15), color: shade(paint, 0.62), depth: 0.05, wall: shade(paint, 0.5) });
  top({ name: "gutter", mirror: true, points: stroke([[10.75, 1.2], [10.8, -27.2]], 0.22), color: shade(paint, 0.55), depth: 0.08, wall: shade(paint, 0.45) });
  body.modifiers.push({ type: "cutout", cuts });

  const cubes = [body], steel = "#b4b8bf";
  cubes.push(lattice("grille mesh", grille, at.front, 1, 0.3, 0.8, 0.13, "#a9adb5", { material: STEEL, slope: 0.55 }));
  for (const [k, z] of wheelZ.entries()) for (const sx of [1, -1]) {
    const o = arches[k].slice(1, -1);
    cubes.push(archLiner(`wheel house ${k} ${sx}`, o, 13.0, track - 3.4, sx));
    cubes.push(flare(`flare ${k} ${sx}`, [[o[0][0], 7.2], ...o, [o[o.length - 1][0], 7.2]], at, sx, 1.0, 0.55, "#1a1b1f"));
    // a mud flap behind the wheel
    const zf = z - 7.2, lean = 1.9;
    cubes.push(hexa(`mud flap ${k} ${sx}`, [[sx * 10.2, 11.6, zf], [sx * 13.6, 11.6, zf], [sx * 13.6, 4.4, zf - lean], [sx * 10.2, 4.4, zf - lean]], [[sx * 10.2, 11.6, zf - 0.3], [sx * 13.6, 11.6, zf - 0.3], [sx * 13.6, 4.4, zf - lean - 0.3], [sx * 10.2, 4.4, zf - lean - 0.3]], "#101114", { material: RUBBER }));
  }
  // underneath: a floor, two chassis rails, the axles with their differentials
  cubes.push(box("floor", -11, 11, 7.2, 8.0, -28, 29, "#0b0c0e", { material: { metallic: 0, roughness: 1 } }));
  for (const sx of [1, -1]) cubes.push(box(`chassis rail ${sx}`, Math.min(sx * 5.2, sx * 6.6), Math.max(sx * 5.2, sx * 6.6), 5.6, 7.3, -29, 30, "#15161a", { material: { metallic: 0.2, roughness: 0.8 } }));
  for (const z of wheelZ) cubes.push(cyl("axle", 0, R - 0.2, z, 0.75, 2 * track - 3, "x", "#1d1e23", { segments: 10, material: { metallic: 0.3, roughness: 0.7 } }), { name: "differential", shape: "sphere", from: [-3.6, R - 2.0, z - 1.8], size: [3.6, 3.6, 3.6], color: "#1d1e23", segments: 12, smooth: true, metallic: 0.3, roughness: 0.7 });
  // bumpers: steel bars with rounded ends, the front one on brackets with the plate, the rear one with its lamps
  cubes.push(box("front bumper", -13.9, 13.9, 6.7, 9.8, 30.5, 32.9, steel, { round: 0.55, segs: 2, material: STEEL }));
  cubes.push(box("bumper step", -9.2, 9.2, 9.75, 10.35, 29.6, 31.4, "#17181c", { round: 0.12, segs: 1 }));
  cubes.push(box("front plate", -4.0, 4.0, 6.95, 8.9, 32.85, 33.05, "#ecece6", {}));
  for (const sx of [1, -1]) cubes.push(box(`overrider ${sx}`, Math.min(sx * 7.6, sx * 8.8), Math.max(sx * 7.6, sx * 8.8), 10.3, 12.0, 30.4, 31.3, "#17181c", { round: 0.2, segs: 1 }));
  cubes.push(box("rear bumper", -13.3, 13.3, 7.2, 10.0, -32.3, -29.0, steel, { round: 0.55, segs: 2, material: STEEL }));
  for (const sx of [1, -1]) {
    cubes.push(box(`bumper lamp ${sx}`, Math.min(sx * 7.3, sx * 9.7), Math.max(sx * 7.3, sx * 9.7), 7.9, 9.4, -32.42, -32.2, "#c2161f", { material: { metallic: 0.2, roughness: 0.2 }, emissive: 0.5 }));
    cubes.push(box(`bumper indicator ${sx}`, Math.min(sx * 9.9, sx * 12.2), Math.max(sx * 9.9, sx * 12.2), 7.9, 9.4, -32.42, -32.2, "#f59a1b", { material: { metallic: 0.2, roughness: 0.2 }, emissive: 0.3 }));
  }
  // door handles, the big mirrors on their arms, wipers
  for (const sx of [1, -1]) {
    const xh = at.side(-5.6, 16.8);
    cubes.push(box(`door handle ${sx}`, Math.min(sx * (xh - 0.2), sx * (xh + 0.05)), Math.max(sx * (xh - 0.2), sx * (xh + 0.05)), 16.75, 17.2, -7.1, -4.2, "#1a1b1f", { round: 0.08, segs: 1 }));
    const lo = (a, b) => [Math.min(sx * a, sx * b), Math.max(sx * a, sx * b)];
    cubes.push(box(`mirror ${sx}`, ...lo(14.0, 16.3), 20.4, 23.5, 2.5, 3.5, "#17181c", { round: 0.3, segs: 2 }));
    cubes.push(box(`mirror glass ${sx}`, ...lo(14.25, 16.05), 20.7, 23.2, 2.42, 2.52, "#aebfd0", { material: CHROME }));
    cubes.push(bar(`mirror arm a ${sx}`, [sx * 13.0, 20.9, 4.4], [sx * 15.0, 21.2, 3.2], 0.3, 0.3, "#17181c"), bar(`mirror arm b ${sx}`, [sx * 13.0, 22.6, 5.4], [sx * 15.0, 22.6, 3.2], 0.3, 0.3, "#17181c"));
  }
  cubes.push(box("rear door handle", 3.6, 5.7, 18.9, 19.3, at.back(4.6, 19) - 0.1, at.back(4.6, 19) + 0.15, "#1a1b1f", { round: 0.08, segs: 1 }));
  const onScreen = (x, y, lift = 0.15) => [x, y, at.front(x, y) + lift];
  for (const [x0, x1] of [[-0.6, -8.4], [9.6, 1.8]]) cubes.push(bar("wiper", onScreen(x0, 21.3), onScreen(x1, 22.6), 0.4, 0.22, "#0b0c0e", { material: RUBBER }, [0, 0.62, 0.78]));
  const wheelSpec = { R, width: 3.5, rimR: 3.9, rim: "#dcdcd4", rimMaterial: { metallic: 0.3, roughness: 0.45 }, windows: Array.from({ length: 6 }, (_, k) => ellipse(Math.sin((k / 6) * 2 * Math.PI + 0.52) * 2.75, Math.cos((k / 6) * 2 * Math.PI + 0.52) * 2.75, 0.5, 0.5, 8)), spokeDepth: 0.35, hubR: 0.34, nuts: 6, nutAt: 1.45, dish: 0.45, cap: "#b9bdc4", tread: 22, faceAt: 0.6 };
  const model = assemble({ cubes, pivot: R, wheelZ, track, wheelOf: (sx) => wheel(wheelSpec, sx), R });
  // the spare on the wide rear door, on a carrier
  model.parts[0].children.push({ name: "spare", origin: [-3.9, r2(16.1 - R), -31.3], rotation: [0, 90, 0], cubes: wheel({ ...wheelSpec, tread: 0 }, 1), children: [] });
  model.parts[0].cubes.push(cyl("spare carrier", -3.9, r2(16.1 - R), -29.7, 1.6, 1.2, "z", "#17181c", { segments: 12 }));
  return { at, R, track, wheelZ, model, tail: { z: r2(-29.5 / 16), y: r2(13.9 / 16 - 0.06), x: r2(12.4 / 16 / 0.92) } };
}
void [STEEL, PLASTIC, lerp, mesh, mix, cyl, GLASS_COL, DARK, archOutline, mirrorX, GLASS, PAINT, path, pebble, rect, rounded, spokeWindows];
