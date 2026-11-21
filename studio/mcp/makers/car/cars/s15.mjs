// `car_s15`: a late-1990s Japanese sports coupe with an aero kit (4445 x 1695 x 1285 mm, wheelbase 2525), read off build/blueprints/s15.png
// (calibration in s15.trace.json: the side view by its length and height, the plan by length and width, front and rear by width and height).
// One smooth body from buildBody; glass, lamps, intakes, gaps and wheel openings are cut-outs; mirrors, wing, wipers, exhaust and wheels are pieces.
// No badges or lettering (the plates are blank).  Made by car_make { "type": "aero_coupe" }
import { DARK, TRIM, archOutline, glassOf, mirrorX, CHROME, GLASS, PAINT, PLASTIC, RUBBER, STEEL, archLiner, assemble, bar, box, buildBody, cyl, ellipse, hexa, inset, lattice, path, pebble, r2, rect, rounded, rrect, shade, spokeWindows, stroke, wheel } from "../kit.mjs";

export function s15(paint = "#e3b21c", rimCol = "#5a5d65") {
  const gap = shade(paint, 0.22), R = 5.3, track = 11.35, wheelZ = [20.72, -19.68];
  const spec = {
    paint,
    w: [[-35.55, 3], [-35.3, 6], [-35, 8.3], [-34.5, 10.0], [-34, 11.1], [-33, 11.95], [-32, 12.3], [-30, 12.7], [-28, 12.95], [-26, 13.15], [-24, 13.35], [-22, 13.5], [-12, 13.56], [0, 13.56], [14, 13.56], [25, 13.5], [27, 13.3], [28, 13.1], [29, 12.9], [30, 12.7], [31, 12.45], [32, 12.1], [33, 11.2], [34, 9.45], [35, 6.15], [35.5, 3]],
    yb: [[-35.55, 5.3], [-35, 5.0], [-33, 4.8], [-30, 4.3], [-27, 3.8], [-25.5, 3.5], [-23, 3.1], [-14, 2.8], [0, 2.8], [14, 2.8], [18, 2.7], [26, 2.6], [34, 2.6], [35.5, 2.8]],
    top: [[-34.6, 13.85], [-34, 13.95], [-31, 14.3], [-28, 14.65], [-26, 14.9], [-25, 15.05], [-24, 15.5], [-23, 16.2], [-22, 16.8], [-20, 17.75], [-18, 18.5], [-16, 19.1], [-14, 19.65], [-12, 20.1], [-10, 20.35], [-8, 20.5], [-3, 20.5], [0, 20.35], [1, 20.2], [2, 19.9], [3, 19.45], [4, 18.95], [5, 18.4], [6, 17.9], [7, 17.35], [8, 16.8], [9, 16.25], [10, 15.7], [11, 15.15], [12, 14.6], [13, 14.2], [14, 14.2], [16, 14.1], [18, 13.95], [20, 13.75], [22, 13.5], [24, 13.2], [26, 12.9], [28, 12.45], [30, 11.9], [31, 11.6], [32, 11.2], [33, 10.65], [34, 9.9], [34.7, 9.25]],
    ys: [[-34.6, 13.55], [-32, 13.8], [-30, 14.0], [-27, 14.35], [-25, 14.6], [-22, 14.75], [-18, 14.75], [-14, 14.65], [-10, 14.5], [-5, 14.3], [0, 14.1], [5, 13.95], [9, 13.85], [12.7, 13.75], [16, 13.55], [20, 13.2], [24, 12.7], [28, 12.0], [30, 11.45], [32, 10.75], [33, 10.2], [34, 9.5], [34.7, 9.0]],
    rw: [[-30, 11.3], [-27, 11.1], [-24.5, 10.6], [-22, 10.2], [-18, 9.6], [-14, 9.1], [-8, 8.9], [0, 8.9], [2, 9.0], [5, 9.6], [8, 10.3], [10.5, 10.9], [13, 11.4], [16, 11.8]],
    drop: [[-24, 2.2], [-20, 2.0], [-14, 1.6], [-8, 1.4], [0, 1.35], [3, 1.3], [8, 1.1], [12, 0.8]],
    crown: [[-27, 1.0], [-22, 0.9], [-14, 0.6], [2, 0.6], [5, 1.0], [9, 1.3], [13, 1.0]],
    ledge: 0.5, rail: 0.9, hoodP: 2.6,
    profile: [[0, 0.975], [0.1, 0.99], [0.25, 1.0], [0.7, 1.0], [0.82, 0.98], [0.92, 0.945], [1, 0.9]],
    rows: [0, 0.1, 0.25, 0.45, 0.65, 0.82, 0.93, 1],
    stations: [-30.5, -27, -24.5, -22, -19.7, -16.5, -13.5, -10.5, -8, -5, -2, 1, 3.5, 6, 8.5, 10.7, 12.7, 15, 18, 20.7, 23.5, 26.3, 29], maxGap: 3.0,
    front: { zc: 31, L: 10, plan: [[0, 35.5], [3, 35.45], [5, 35.25], [6.15, 35.0], [8, 34.55], [9.45, 34.0], [11.2, 33.0], [12.1, 32.0], [12.45, 31.0]], side: [[2.6, 35.2], [3.1, 35.5], [3.9, 34.95], [5, 34.9], [5.6, 35.35], [7, 35.5], [8, 35.5], [8.5, 35.25], [8.9, 34.95], [9.25, 34.7]], edgeBack: [[0, 0.8], [6, 0.8], [12.4, 0.35]], rimTop: 0.3 },
    rear: { zc: -33, L: 7, plan: [[0, -35.55], [5, -35.5], [8.3, -35.0], [10, -34.5], [11.1, -34.0], [11.95, -33.0]], side: [[5.0, -34.9], [5.5, -35.3], [6.5, -35.5], [9.8, -35.55], [10.3, -35.3], [10.8, -34.75], [11.5, -34.6], [13, -34.55], [13.55, -34.5], [13.85, -34.4]], edgeBack: [[0, 0.95], [11.95, 0.5]], rim: 0.15, rimTop: 0.5 },
    crease: { rows: { 1: 0.4, 8: 0.3 } },
  };
  const { body, at } = buildBody(spec);
  const cuts = [], cut = (c) => cuts.push(c);
  const matt = { metallic: 0, roughness: 0.8 };
  const side = (o) => cut({ view: "side", facing: 0.5, ...o });
  // --- from the side: wheel openings, glass, the door, lamps where they wrap round the corners
  const arches = wheelZ.map((z) => archOutline(z, R - 0.1, 6.0));
  for (const points of arches) cut({ view: "side", points, remove: true, depth: 0.7, wall: shade(paint, 0.5), facing: -1, near: 9 });
  const dlo = rounded([[9.6, 13.8, 1], [5, 13.95], [0, 14.1], [-9, 14.5], [-14, 14.85], [-16.3, 15.1], [-17.1, 16.2], [-15.6, 17.3], [-12.5, 18.5], [-9, 19.25], [-5, 19.6], [-1, 19.55], [2, 19.0], [5, 17.45], [7.5, 15.65]], 1);
  side({ name: "window trim", points: dlo, color: TRIM, metallic: 0.2, roughness: 0.4 });
  side({ name: "door glass", points: rounded([[8.7, 14.15, 1], [0, 14.4], [-8.9, 14.8, 1], [-9.3, 18.9, 1], [-5, 19.3], [-1, 19.25], [1.8, 18.7], [4.8, 17.2], [7.2, 15.45]], 1), ...glassOf() });
  side({ name: "quarter glass", points: rounded([[-10.5, 15.15], [-10.9, 18.3], [-13, 17.7], [-16.0, 16.3], [-15.6, 15.45], [-14.5, 15.2]], 1), ...glassOf() });
  side({ name: "door gap", points: stroke([...path([[9.9, 13.6], [11.2, 12.9], [11.5, 11], [11.5, 6.2], [10.9, 5.1], [10.0, 4.85]], 9), ...path([[6, 4.85], [0, 4.85], [-6.2, 4.9]], 3), ...path([[-7.2, 5.3], [-8.3, 6.8], [-9.0, 9], [-9.4, 11.5], [-9.4, 13.2], [-9.1, 14.5]], 8)], 0.16), color: gap, depth: 0.12, wall: gap, ...matt });
  side({ name: "door handle", points: rrect(-8.2, 12.3, -5.3, 13.3, 0.4), color: shade(paint, 0.7), depth: 0.16, wall: gap });
  side({ name: "fuel flap", points: stroke([...rrect(-26.2, 10.5, -23.3, 12.95, 0.4), [-26.2, 11.2]], 0.13), color: gap, depth: 0.08, wall: gap, ...matt, only: "+x" });
  side({ name: "sill line", points: stroke([[14.5, 7.0], [0, 7.0], [-13.7, 7.0]], 0.14), color: shade(paint, 0.55), depth: 0.06, wall: shade(paint, 0.45), ...matt });
  for (const [k, z0, z1] of [[0, 14.6, 10.2], [1, -6.6, -13.7]]) side({ name: `skirt seam ${k}`, points: stroke([[z0, 4.85], [z1, 4.85]], 0.13), color: gap, depth: 0.08, wall: gap, ...matt });
  side({ name: "front bumper seam", points: stroke(path([[30.6, 8.75], [28.5, 9.0], [26.4, 9.25]], 4), 0.13), color: gap, depth: 0.08, wall: gap, ...matt });
  side({ name: "rear bumper seam", points: stroke([[-31.5, 11.0], [-31.45, 7.0], [-31.0, 6.6], [-28.5, 7.1], [-25.7, 7.9]], 0.13), color: gap, depth: 0.08, wall: gap, ...matt });
  side({ name: "fender vent", points: rounded([[29.6, 7.35], [27.0, 8.1], [27.35, 4.9], [29.6, 5.3]], 1), color: "#08090b", depth: 0.35, wall: "#15171b", metallic: 0, roughness: 0.9 });
  side({ name: "side marker", points: rrect(12.7, 8.1, 14.2, 8.9, 0.3), color: "#f59a1b", emissive: 0.3, metallic: 0.2, roughness: 0.2 });
  const lampSide = rounded([[34.3, 8.9], [34.0, 9.75], [32.6, 10.35], [30.2, 10.6], [28.3, 9.9, 1], [29.4, 9.1], [31, 8.75], [33.2, 8.55]], 1);
  cut({ view: "side", facing: 0.5, name: "headlight side", points: lampSide, color: "#232831", ...GLASS });
  const tailSide = rounded([[-30.6, 13.5, 1], [-34.4, 13.55], [-34.5, 11.05], [-33.2, 11.05], [-31.5, 12.2], [-30.7, 13.0]], 1);
  cut({ view: "side", facing: 0.7, name: "tail lamp side", points: tailSide, color: "#b01620", emissive: 0.45, metallic: 0.3, roughness: 0.15 });
  // --- from the front: lamps, the slot under the bonnet, the bumper's three intakes
  const front = (o) => cut({ view: "front", mirror: true, facing: 0.5, ...o });
  const lamp = rounded([[5.0, 9.2, 1], [5.7, 9.6], [7.5, 9.85], [9.5, 10.1], [11.2, 10.4], [12.2, 10.25], [12.75, 9.7], [12.6, 8.9], [12.0, 8.45], [11, 8.25], [9, 8.15], [7, 8.3], [5.3, 8.75]], 1);
  front({ name: "headlight", points: lamp, color: "#232831", ...GLASS, facing: 0.25 });
  front({ name: "headlight reflector", points: ellipse(9.5, 9.1, 2.25, 0.68, 18), color: "#9aa3ae", metallic: 0.9, roughness: 0.18, depth: 0.12, wall: "#3a3e46", facing: 0.25 });
  front({ name: "headlight projector", points: ellipse(10.5, 9.1, 0.5, 0.5, 12), color: "#f4f7ff", emissive: 0.9, facing: 0.25 });
  front({ name: "headlight inner lamp", points: ellipse(8.5, 9.1, 0.38, 0.38, 10), color: "#e6ebf2", emissive: 0.5, facing: 0.25 });
  cut({ view: "front", facing: 0.3, name: "lip seam", points: stroke([[-13.2, 3.0], [0, 3.0], [13.2, 3.0]], 0.13), color: gap, depth: 0.08, wall: gap, ...matt });
  cut({ view: "front", facing: 0.4, name: "bonnet slot", points: rrect(-4.7, 8.4, 4.7, 8.95, 0.25), color: "#07080a", depth: 0.35, wall: "#15171b", metallic: 0, roughness: 0.9 });
  const mouth = rounded(mirrorX([[0, 6.5], [4.7, 6.5], [5.3, 6.0], [5.8, 3.6], [5.4, 3.3], [0, 3.3]]), 1);
  cut({ view: "front", facing: 0.4, name: "mouth", points: mouth, color: "#07080a", depth: 0.7, wall: "#15171b", metallic: 0, roughness: 0.9 });
  const intake = rounded([[6.5, 6.25], [11.9, 6.25], [11.8, 4.0], [8.3, 3.3], [6.95, 3.15]], 1);
  front({ name: "side intake", points: intake, color: "#07080a", depth: 0.45, wall: "#15171b", metallic: 0, roughness: 0.9 });
  // --- from behind: lamps, the seam under them, the plate, bumper mouldings
  const back = (o) => cut({ view: "back", mirror: true, facing: 0.5, ...o });
  const tail = rounded([[4.9, 11.0, 1], [7.5, 12.95], [8.4, 13.45], [11, 13.5], [12.2, 13.25], [12.45, 12.2], [12.4, 11.05, 1]], 1);
  back({ name: "tail lamp", points: tail, color: "#b01620", emissive: 0.45, metallic: 0.3, roughness: 0.15, facing: 0.6 });
  back({ name: "tail light bar", points: stroke(path([[8.0, 12.95], [10, 13.05], [11.9, 12.9]], 6), 0.36), color: "#ff3b30", emissive: 0.9, facing: 0.6 });
  back({ name: "indicator", points: rect(9.9, 11.85, 12.0, 12.35), color: "#f59a1b", emissive: 0.35, metallic: 0.2, roughness: 0.2, facing: 0.6 });
  back({ name: "reverse lamp", points: rounded([[6.0, 11.25], [7.25, 12.1], [7.6, 11.25]], 1), color: "#e9edf2", emissive: 0.12, metallic: 0.3, roughness: 0.15, facing: 0.6 });
  cut({ view: "back", facing: 0.5, name: "lid seam", points: stroke([[-12.3, 10.85], [0, 10.85], [12.3, 10.85]], 0.15), color: gap, depth: 0.1, wall: gap, ...matt });
  cut({ view: "back", facing: 0.5, name: "keyhole", points: ellipse(3.9, 12.0, 0.26, 0.26, 10), color: "#c8ccd2", ...CHROME });
  cut({ view: "back", facing: 0.5, name: "plate recess", points: rrect(-3.3, 5.65, 3.3, 8.45, 0.3), color: shade(paint, 0.8), depth: 0.15, wall: shade(paint, 0.5) });
  cut({ view: "back", facing: 0.5, name: "plate", points: rect(-2.85, 5.95, 2.85, 8.15), color: "#ecece6", metallic: 0, roughness: 0.5 });
  back({ name: "bumper moulding", points: stroke([[3.6, 7.3], [11.6, 7.3]], 0.16), color: shade(paint, 0.55), depth: 0.06, wall: shade(paint, 0.45), ...matt });
  // --- from above: the scuttle, the windscreen, the rear glass, bonnet and boot shut lines
  const top = (o) => cut({ view: "top", facing: 0.45, ...o });
  top({ name: "scuttle", points: rounded(mirrorX([[0, 14.5], [5, 14.25], [9, 13.2], [11.4, 11.7], [11.0, 10.3], [8, 11.8], [4, 12.7], [0, 12.9]]), 1), color: TRIM, metallic: 0, roughness: 0.6 });
  const screenPts = [[0, 12.9], [4, 12.7], [8, 11.8], [10.6, 10.3, 1], [9.8, 6], [8.9, 2.4, 1], [5, 2.05], [0, 1.95]];
  const screenR = rounded(mirrorX(screenPts), 1);
  top({ name: "screen trim", points: inset(screenR, -0.35), color: TRIM, metallic: 0.1, roughness: 0.5 });
  top({ name: "windscreen", points: screenR, ...glassOf() });
  const rearG = rounded(mirrorX([[0, -14.0], [5, -14.1], [8.3, -14.5, 1], [9.0, -19], [9.7, -23.7, 1], [6, -24.3], [0, -24.5]]), 1);
  top({ name: "rear glass trim", points: inset(rearG, -0.35), color: TRIM, metallic: 0.1, roughness: 0.5, facing: 0.3 });
  top({ name: "rear glass", points: rearG, ...glassOf(), facing: 0.3 });
  top({ name: "bonnet gap", mirror: true, points: stroke(path([[0, 34.5], [4.6, 34.3], [6.5, 33.5], [9, 32.3], [10.7, 31.0], [11.25, 29], [11.4, 22], [11.6, 14.6], [11.7, 12.4]], 18), 0.16), color: gap, depth: 0.1, wall: gap, ...matt, facing: 0.3 });
  top({ name: "bonnet crease", mirror: true, points: stroke(path([[5.2, 33.6], [7.4, 24], [9.3, 14.9]], 8), 0.11), color: shade(paint, 0.72), depth: 0.04, wall: shade(paint, 0.6), ...matt, facing: 0.5 });
  top({ name: "boot gap", mirror: true, points: stroke(path([[0, -25.5], [8, -25.45], [10.1, -25.9], [10.55, -28], [10.7, -34.2]], 12), 0.16), color: gap, depth: 0.1, wall: gap, ...matt, facing: 0.3 });
  body.modifiers.push({ type: "cutout", cuts });

  const cubes = [body];
  // behind the openings: the intercooler's slats, mesh in the side intakes, wheel houses and a floor
  cubes.push(lattice("intercooler", mouth, at.front, 1, 0.5, 0.36, 0.14, "#8a9099", { straight: true, material: STEEL }));
  for (const sx of [1, -1]) cubes.push(lattice(`intake mesh ${sx}`, intake.map(([x, y]) => [sx * x, y]), at.front, 1, 0.3, 0.5, 0.09, "#2b2e35", { material: { metallic: 0.6, roughness: 0.4 } }));
  for (const [k] of wheelZ.entries()) for (const sx of [1, -1]) cubes.push(archLiner(`wheel house ${k} ${sx}`, arches[k].slice(1, -1), 13.1, track - 3.2, sx));
  cubes.push(box("floor", -11, 11, 3.0, 3.5, -31, 32, "#0b0c0e", { material: { metallic: 0, roughness: 1 } }));
  // the blank front plate, standing in front of the mouth
  cubes.push(box("front plate", -2.6, 2.6, 4.7, 7.3, 35.45, 35.6, "#ecece6", { material: { metallic: 0, roughness: 0.5 } }));
  cubes.push(box("plate bracket", -1.2, 1.2, 5.2, 6.8, 34.6, 35.47, "#101114", {}));
  // door mirrors on a short foot
  for (const sx of [1, -1]) {
    const q = (pts) => pts.map(([x, y, z]) => [sx * x, y, z]);
    cubes.push(pebble(`mirror ${sx}`, q([[12.9, 13.3, 6.8], [15.9, 13.4, 6.4], [16.0, 15.9, 6.5], [13.1, 15.9, 6.9]]), q([[12.8, 13.5, 9.9], [15.4, 13.6, 10.3], [15.5, 15.5, 10.3], [13.0, 15.6, 10.0]]), paint, { material: PAINT, levels: 2 }));
    cubes.push(hexa(`mirror glass ${sx}`, q([[13.7, 14.15, 7.25], [14.9, 14.2, 7.1], [14.95, 15.1, 7.12], [13.75, 15.1, 7.27]]), q([[13.7, 14.15, 7.6], [14.9, 14.2, 7.45], [14.95, 15.1, 7.47], [13.75, 15.1, 7.62]]), "#aebfd0", { material: CHROME }));
    const xb = at.side(8.6, 13.9);
    cubes.push(box(`mirror foot ${sx}`, Math.min(sx * (xb - 0.5), sx * 13.4), Math.max(sx * (xb - 0.5), sx * 13.4), 13.6, 14.3, 7.6, 9.6, DARK, { round: 0.12, segs: 1 }));
  }
  // wipers lying at the foot of the screen
  const onTop = (x, z, lift = 0.12) => [x, at.top(x, z) + lift, z];
  for (const [x0, z0, x1, z1] of [[1.5, 12.95, 9.0, 11.5], [-8.2, 12.2, -0.6, 13.1]]) cubes.push(bar("wiper", onTop(x0, z0), onTop(x1, z1), 0.4, 0.22, "#0b0c0e", { material: RUBBER }));
  // the rear wing: a blade whose ends sweep forward and down to the boot's edges, and two uprights under it
  const bevel = { modifiers: [{ type: "bevel", width: 0.07, segments: 1, angle: 30 }], material: PAINT };
  const bs = (x) => [[x, 16.72, -30.6], [x, 16.9, -34.45], [x, 17.14, -34.45], [x, 16.98, -30.6]];
  cubes.push(hexa("wing blade", bs(-9.45), bs(9.45), paint, bevel));
  for (const sx of [1, -1]) {
    const yf = (x, z) => at.top(x, z) - 0.2;
    cubes.push(hexa(`wing end ${sx}`, [[sx * 9.3, yf(9.3, -27.2), -27.2], [sx * 10.3, yf(10.3, -27.2), -27.2], [sx * 10.3, yf(10.3, -32.0), -32.0], [sx * 9.3, yf(9.3, -32.0), -32.0]], [[sx * 8.85, 17.0, -30.65], [sx * 9.45, 17.0, -30.65], [sx * 9.45, 17.12, -34.4], [sx * 8.85, 17.12, -34.4]], paint, bevel));
  }
  // one big exhaust on the left, under the bumper
  const ex = { x: 7.2, y: 3.8, z: -33.7 };
  cubes.push(cyl("exhaust", ex.x, ex.y, ex.z, 1.1, 4.0, "z", "#c4c9d2", { segments: 20, material: CHROME }));
  cubes.push(cyl("exhaust bore", ex.x, ex.y, ex.z - 1.96, 0.88, 0.12, "z", "#050506", { segments: 18, material: { metallic: 0.3, roughness: 0.8 } }));
  cubes.push(box("silencer", 4.6, 9.4, 3.2, 5.0, -32.0, -26, "#2a2c31", { round: 0.5, segs: 2, material: { metallic: 0.6, roughness: 0.5 } }));
  const wheelOf = (sx) => wheel({ R, width: 3.8, rimR: 4.2, rim: rimCol, windows: spokeWindows(6, 1.35, 3.72, 0.5, 0.8), spokeDepth: 0.55, caliper: "#b3202a", hubR: 0.2, nuts: 5, nutAt: 1.5, dish: 0.35, cap: shade(rimCol, 0.8) }, sx);
  // TAIL is where the rear lamps are (lib/state.lua): metres, the same way car_gt gives it
  return { at, R, track, wheelZ, model: assemble({ cubes, pivot: R, wheelZ, track, wheelOf, R }), tail: { z: r2(-34.3 / 16), y: r2(12.5 / 16 - 0.06), x: r2(9.3 / 16 / 0.92) } };
}

// The first is the one the player drives; the rest are what rivals wear.
void [PLASTIC];
