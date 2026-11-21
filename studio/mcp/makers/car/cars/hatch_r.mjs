// `car_hatch_r`: a modern hot hatch with a big rear wing (4560 x 1875 x 1435 mm, wheelbase 2700, track 1600), from build/blueprints/hatch_r.png (front, side
// and plan views; no rear view, so the tail is designed from the side and plan). Each view calibrated on its own dimension line (hatch_r.trace.json).
// One body surface from buildBody, everything cut into the skin by the Cut-out modifier, separate shapes only for real separate pieces. No badges.
import { DARK, TRIM, archOutline, glassOf, mirrorX, CHROME, GLASS, PAINT, PLASTIC, RUBBER, archLiner, assemble, bar, box, buildBody, ellipse, hexa, inset, lattice, mesh, path, pebble, r2, rect, rounded, rrect, shade, spokeWindows, stroke, wheel, slab, blade } from "../kit.mjs";


export function hatchR(paint = "#e6e7e9") {
  const gap = shade(paint, 0.22), R = 5.15, track = 12.8, wheelZ = [21.5, -21.7], BLACK = "#121317";
  const spec = {
    paint,
    w: [[-36.5, 5.5], [-36, 8.6], [-35, 10.3], [-34, 11.7], [-33, 13], [-32, 13.9], [-31, 14.25], [-30, 14.4], [-28, 14.65], [-26, 14.9], [-24, 15], [-21.7, 15.05], [-19, 14.95], [-16, 14.8], [-13, 14.7], [-6, 14.65], [0, 14.65], [6, 14.68], [11, 14.72], [14, 14.85], [17, 15.0], [21.5, 15.05], [25, 15.0], [28, 14.85], [29, 14.75], [30, 14.6], [31, 14.3], [32, 13.7], [33, 12.5], [34, 10.9], [35, 9.4], [36, 7.7], [36.4, 6.5]],
    yb: [[-36.5, 3.9], [-35.4, 3.5], [-32, 3.4], [-28, 3.4], [-26, 3.3], [-17, 2.7], [0, 2.6], [14, 2.6], [17, 2.6], [27, 2.7], [30, 2.8], [34, 3.0], [36.4, 3.2]],
    top: [[-34.5, 16.95], [-33.5, 17.25], [-32, 17.8], [-30, 18.55], [-28, 19.3], [-26, 20.05], [-24.5, 20.6], [-23.3, 21.0], [-22.3, 21.3], [-21, 21.55], [-19, 21.8], [-16, 22.1], [-13, 22.35], [-10, 22.5], [-7, 22.55], [-4, 22.5], [-2, 22.4], [0, 22.2], [2, 22.0], [3, 21.85], [4, 21.7], [5, 21.4], [6, 21.1], [7, 20.7], [8, 20.3], [9, 19.9], [10, 19.4], [11, 18.9], [12, 18.4], [13, 17.9], [14, 17.4], [15, 16.8], [16, 16.2], [17.5, 15.5], [18.5, 15.25], [20, 15.1], [22, 14.9], [24, 14.65], [26, 14.4], [28, 14.0], [30, 13.5], [31, 13.2], [32, 12.8], [33, 12.3], [34, 11.8], [35, 11.1], [35.6, 10.6]],
    ys: [[-34.5, 16.55], [-33, 16.75], [-30, 17.0], [-26, 17.2], [-22, 17.2], [-18, 16.8], [-12, 16.2], [-6, 15.7], [0, 15.4], [6, 15.2], [12, 15.0], [17, 14.9], [20, 14.6], [24, 14.0], [27, 13.4], [30, 12.6], [32, 11.9], [34, 11.0], [35.6, 10.2]],
    rw: [[-34.5, 10.2], [-30, 9.7], [-25, 9.3], [-19, 9.0], [-10, 9.1], [0, 9.2], [3, 9.4], [5, 9.7], [8, 10.3], [12, 11.0], [16, 11.6], [20, 12]],
    drop: [[-32, 0.9], [-26, 1.3], [-20, 1.6], [0, 1.5], [4, 1.4], [9, 1.1], [14, 0.7]],
    crown: [[-30, 0.9], [-20, 0.7], [-10, 0.5], [2, 0.5], [5, 0.9], [10, 1.3], [16, 1.1]],
    ledge: 0.7, rail: 0.9, hoodP: 2.6, h0: 0.95, h1: 1.8,
    profile: [[0, 0.95], [0.1, 0.975], [0.25, 0.99], [0.5, 1.0], [0.7, 0.995], [0.85, 0.975], [0.93, 0.95], [1, 0.91]],
    rows: [0, 0.1, 0.25, 0.45, 0.65, 0.82, 0.93, 1],
    stations: [-27, -24.5, -21.7, -18, -13.5, -9, -4.5, 0, 4.5, 8.5, 12, 15, 17.5, 21.5, 25], maxGap: 4.6,
    front: { zc: 28, L: 9, plan: [[0, 36.4], [7, 36.3], [9.4, 35], [10.9, 34], [12.5, 33], [13.7, 32], [14.3, 31], [14.6, 30], [14.75, 29], [14.85, 28]], side: [[3.0, 36.2], [4, 36.3], [6, 36.4], [8, 36.4], [9, 36.1], [10, 35.85], [10.6, 35.6]], edgeBack: [[0, 0.8], [7, 1.3], [12, 1.1], [14.85, 0.3]], rimTop: 0.15 },
    rear: { zc: -30, L: 8, plan: [[0, -36.5], [5.5, -36.5], [8.6, -36], [10.3, -35], [11.7, -34], [13, -33], [13.9, -32], [14.25, -31], [14.4, -30]], side: [[3.6, -35.9], [4.2, -36.35], [5, -36.5], [7, -36.5], [8, -36.1], [10, -35.5], [11, -35.1], [12.5, -34.9], [14, -34.75], [15.5, -34.65], [16.95, -34.5]], edgeBack: [[0, 2.0], [10, 1.6], [14.4, 0.4]], rim: 0.15, rimTop: 0.5 },
    crease: { rows: { 1: 0.4, 8: 0.3 } },
  };
  const { body, at } = buildBody(spec);
  const cuts = [], cut = (c) => cuts.push(c);
  const matt = { metallic: 0, roughness: 0.8 };
  const side = (o) => cut({ view: "side", facing: 0.5, ...o });
  // --- from the side: wheel openings, the side glass, doors, lamps where they wrap round the corners
  const arches = wheelZ.map((z) => archOutline(z, R - 0.05, 6.05));
  for (const points of arches) cut({ view: "side", points, remove: true, depth: 0.7, wall: shade(paint, 0.5), facing: -1, near: 9 });
  side({ name: "skirt", points: [[15.2, 1.5], [15.2, 3.5], [8, 3.6], [-8, 3.75], [-13, 4.0], [-15.4, 4.9], [-15.4, 1.5]], color: BLACK, ...matt, facing: 0.2 });
  const dlo = rounded([[11.6, 15.05, 1], [6, 15.2], [0, 15.42], [-6, 15.72], [-12, 16.17], [-17, 16.7], [-20.5, 17.05], [-22.8, 17.4, 1], [-20.2, 18.6], [-17.6, 19.9], [-14, 20.65], [-10, 21.05], [-5, 21.3], [-1, 21.15], [2, 20.75], [5, 19.95], [8, 18.4], [10, 17.25]], 1);
  side({ name: "window trim", points: inset(dlo, -0.3), color: TRIM, metallic: 0.2, roughness: 0.4 });
  side({ name: "side glass", points: dlo, ...glassOf() });
  side({ name: "pillar", points: stroke([[-4.3, 15.5], [-5.7, 21.5]], 1.3), color: TRIM, metallic: 0.1, roughness: 0.5 });
  side({ name: "quarter pillar", points: stroke([[-16.9, 16.6], [-17.2, 20.2]], 0.4), color: TRIM, metallic: 0.1, roughness: 0.5 });
  const gapCut = (name, line, o = {}) => side({ name, points: stroke(line, 0.17), color: gap, depth: 0.12, wall: gap, ...matt, ...o });
  gapCut("front door gap", [...path([[11.9, 14.9], [14.4, 13.7], [14.3, 9], [14.1, 6.3], [13.0, 4.6]], 10), ...path([[9, 4.45], [0, 4.6], [-9, 4.9], [-13.5, 5.4]], 6)]);
  gapCut("mid door gap", path([[-4.5, 15.4], [-4.0, 13.5], [-4.1, 9], [-4.3, 4.75]], 8));
  gapCut("rear door gap", path([[-17.6, 16.6], [-19.4, 15.6], [-20.2, 14.9], [-19.2, 12.8], [-17.6, 10.4], [-15.6, 7.6], [-14.6, 5.6]], 12));
  for (const z of [-1.3, -16.2]) side({ name: "door handle", points: ellipse(z, 13.4 - z * 0.05, 1.5, 0.45, 14), color: shade(paint, 0.78), depth: 0.14, wall: gap });
  side({ name: "fuel flap", points: stroke([...rrect(-25.2, 13.6, -21.7, 16.0, 0.5), [-25.2, 14.2]], 0.13), color: gap, depth: 0.08, wall: gap, ...matt, only: "+x" });
  side({ name: "wing vent", points: rounded([[15.9, 12.8], [15.1, 12.9], [14.5, 12.3], [14.5, 9.2], [15.0, 9.0], [15.6, 11]], 1), color: "#07080a", depth: 0.3, wall: BLACK, ...matt });
  side({ name: "headlight side", facing: 0.7, points: rounded([[35.2, 10.5, 1], [34.3, 11.4], [31, 12.0], [27.5, 12.35], [26.3, 12.3, 1], [29, 11.4], [32, 10.4], [34.4, 9.7]], 1), color: "#232831", ...GLASS });
  side({ name: "bumper side vent", facing: 0.45, points: rounded([[32.6, 8.7], [31.6, 8.9], [30.3, 5.7], [31, 5.1], [32.2, 5.0], [33.0, 6.8]], 1), color: "#07080a", depth: 0.25, wall: BLACK, ...matt });
  side({ name: "tail lamp side", facing: 0.8, points: [[-32.4, 16.4], [-32.4, 15.6], [-30.9, 15.75], [-29.2, 16.25], [-30.9, 16.4]], color: "#b01620", emissive: 0.45, metallic: 0.3, roughness: 0.15 });
  side({ name: "rear side vent", facing: 0.45, points: rounded([[-32.3, 7.0], [-32.9, 10.0], [-34.5, 10.1], [-35.2, 7.8], [-34.6, 6.8]], 1), color: "#07080a", depth: 0.3, wall: BLACK, ...matt });
  side({ name: "rear valance", facing: 0.2, points: [[-27.4, 1.5], [-27.4, 4.5], [-31, 4.9], [-36.8, 5.6], [-36.8, 1.5]], color: "#15161a", metallic: 0, roughness: 0.7 });
  // bumper shut lines, the arch lips and the door's lower swage
  gapCut("front bumper gap", path([[26.4, 12.3], [27.6, 11.2], [27.3, 9.9]], 6));
  gapCut("rear bumper gap", path([[-28.3, 14.9], [-28.6, 12.6], [-27.2, 10.6], [-26.9, 9.6]], 8));
  for (const z of wheelZ) side({ name: "arch lip", points: stroke(Array.from({ length: 21 }, (_, i) => { const a = 0.32 + (i / 20) * (Math.PI - 0.64); return [r2(z + 7.15 * Math.cos(a)), r2(5.1 + 7.15 * Math.sin(a))]; }), 0.15), color: shade(paint, 0.62), depth: 0.05, wall: shade(paint, 0.5) });
  side({ name: "door swage", points: stroke(path([[12.5, 5.9], [5, 6.4], [-5, 7.3], [-14.6, 8.5]], 8), 0.14), color: shade(paint, 0.62), depth: 0.05, wall: shade(paint, 0.5) });
  // --- from the front: the black nose panel with the grille, lamps, the bumper's intakes
  const front = (o) => cut({ view: "front", mirror: true, facing: 0.5, ...o });
  cut({ view: "front", facing: 0.5, name: "nose panel", points: mirrorX([[0, 8.7], [5.3, 8.75], [6.0, 10.0], [7.0, 10.6], [6.9, 11.9], [0, 12.0]]), color: "#15161a", metallic: 0.3, roughness: 0.25 });
  const grille = mirrorX([[0, 8.95], [5.1, 9.0], [5.6, 10.0], [0, 10.05]]);
  cut({ view: "front", facing: 0.5, name: "grille", points: grille, color: "#07080a", depth: 0.5, wall: "#17191e", metallic: 0, roughness: 0.9 });
  cut({ view: "front", facing: 0.5, name: "upper slot", points: mirrorX([[0, 11.05], [5.9, 11.05], [6.3, 11.55], [0, 11.6]]), color: "#07080a", depth: 0.2, wall: "#17191e", metallic: 0, roughness: 0.9 });
  const lamp = rounded([[7.1, 10.7, 1], [7.4, 11.85], [10, 12.15], [13.2, 12.3], [14.3, 12.1], [14.2, 11.0], [13, 10.35], [10, 9.75], [7.7, 9.6]], 1);
  front({ name: "headlight", points: lamp, color: "#232831", ...GLASS, facing: 0.7 });
  front({ name: "daylight", points: stroke(path([[7.9, 11.55], [10, 11.8], [12.4, 11.9]], 8), 0.26), color: "#f4f7ff", emissive: 0.95, facing: 0.6 });
  for (const x of [8.6, 10.6]) front({ name: "projector", points: ellipse(x, 10.75 + (x - 8.6) * 0.12, 0.62, 0.55, 12), color: "#dfe6ee", emissive: 0.5, metallic: 0.4, roughness: 0.1, facing: 0.7 });
  const intake = rounded([[5.4, 5.7], [6.4, 6.5], [5.7, 7.6], [6.6, 8.35], [11.6, 8.85], [12.5, 8.5], [12.7, 5.5], [12.2, 4.5], [7.5, 4.4]], 1);
  front({ name: "side intake", points: intake, color: "#07080a", depth: 0.6, wall: "#15171b", metallic: 0, roughness: 0.9, facing: 0.4 });
  front({ name: "fog lamp", points: ellipse(10.9, 5.9, 0.55, 0.55, 12), color: "#dfe6ee", emissive: 0.4, metallic: 0.4, roughness: 0.1, facing: 0.4 });
  cut({ view: "front", facing: 0.4, name: "lower intake", points: mirrorX([[0, 3.75], [6.5, 3.75], [6.2, 4.7], [5.3, 5.2], [0, 5.2]]), color: "#07080a", depth: 0.4, wall: "#15171b", metallic: 0, roughness: 0.9 });
  cut({ view: "front", facing: 0.5, name: "plate", points: rect(-2.7, 5.7, 2.7, 8.2), color: "#ecece6", metallic: 0, roughness: 0.5 });
  // --- from behind (no rear drawing: designed from the side and plan): lamps, the hatch, the plate, the diffuser with three pipes
  const back = (o) => cut({ view: "back", mirror: true, facing: 0.5, ...o });
  back({ name: "tail lamp", points: [[5.2, 15.2], [9, 15.75], [12, 16.4], [15.3, 16.4], [15.3, 15.6], [13.5, 15.6], [12.9, 15.2], [12.9, 13.6], [12.3, 13.0], [11.3, 13.5], [11.3, 15.25], [9, 15.05], [5.2, 14.75]], color: "#b01620", emissive: 0.45, metallic: 0.3, roughness: 0.15, facing: 0.2 });
  cut({ view: "back", facing: 0.5, name: "tail bar", points: rect(-5.2, 14.82, 5.2, 15.14), color: "#ff3b30", emissive: 0.8 });
  back({ name: "tail light bar", points: stroke(path([[5.6, 15.0], [9, 15.4], [11.9, 16.0]], 8), 0.2), color: "#ff3b30", emissive: 0.9, facing: 0.5 });
  cut({ view: "back", facing: 0.5, name: "hatch gap", points: stroke(path([[-10.6, 14.6], [-10.6, 13], [-10.2, 11.6], [-9.2, 10.8], [-7, 10.4], [0, 10.3], [7, 10.4], [9.2, 10.8], [10.2, 11.6], [10.6, 13], [10.6, 14.6]], 24), 0.16), color: gap, depth: 0.12, wall: gap, ...matt });
  cut({ view: "back", facing: 0.5, name: "plate recess", points: rrect(-4.2, 11.0, 4.2, 13.7, 0.3), color: shade(paint, 0.8), depth: 0.15, wall: shade(paint, 0.5) });
  cut({ view: "back", facing: 0.5, name: "plate", points: rect(-3.3, 11.4, 3.3, 13.3), color: "#ecece6", metallic: 0, roughness: 0.5 });
  cut({ view: "back", facing: 0.2, name: "diffuser", points: mirrorX([[0, 3.0], [15.3, 3.0], [15.3, 5.5], [12.2, 5.8], [10.6, 7.0], [0, 7.1]]), color: "#15161a", metallic: 0, roughness: 0.7 });
  for (const [x, r] of [[0, 0.8], [2.2, 1.0], [-2.2, 1.0]]) {
    cut({ view: "back", facing: 0.3, name: "tail pipe", points: ellipse(x, 5.3, r, r, 16), color: "#c4c9d2", ...CHROME });
    cut({ view: "back", facing: 0.3, name: "tail pipe bore", points: ellipse(x, 5.3, r - 0.25, r - 0.25, 14), color: "#050506", depth: 0.9, wall: "#3b3e45", metallic: 0.4, roughness: 0.6 });
  }
  // --- from above: the windscreen, the rear glass, the bonnet's shut line and its scoop
  const top = (o) => cut({ view: "top", facing: 0.45, ...o });
  const screenR = rounded(mirrorX([[0, 20.2], [5, 19.9], [8.5, 18.9], [10.8, 17.0], [11.7, 15.2, 1], [10.4, 9.5], [9.1, 4.5, 1], [5, 5.2], [0, 5.4]]), 1);
  top({ name: "screen trim", points: inset(screenR, -0.4), color: TRIM, metallic: 0.1, roughness: 0.5 });
  top({ name: "windscreen", points: screenR, ...glassOf() });
  const rearG = rounded(mirrorX([[0, -22.7], [5, -22.8], [8.4, -23.1, 1], [8.9, -27.5], [9.3, -32.3, 1], [6, -32.8], [0, -33.0]]), 1);
  top({ name: "rear glass trim", points: inset(rearG, -0.35), color: TRIM, metallic: 0.1, roughness: 0.5 });
  top({ name: "rear glass", points: rearG, ...glassOf() });
  top({ name: "bonnet gap", mirror: true, points: stroke(path([[0, 35.2], [4, 35.05], [6.6, 34.3], [8.8, 32.6], [10.6, 30.3], [12.2, 27.5], [13.2, 24], [13.4, 19.5], [12.6, 16.0]], 20), 0.16), color: gap, depth: 0.1, wall: gap, ...matt, facing: 0.62 });
  const scoop = rounded(mirrorX([[0, 26.7], [1.9, 26.6], [2.9, 24.8], [3.6, 23.4], [3.6, 21.3], [3.0, 20.9], [0, 20.9]]), 1);
  top({ name: "scoop rim", points: inset(scoop, -0.25), color: shade(paint, 0.7), depth: 0.06, wall: shade(paint, 0.5) });
  top({ name: "scoop", points: scoop, color: "#07080a", depth: 0.5, wall: BLACK, ...matt });
  top({ name: "hatch gap top", mirror: true, points: stroke(path([[0, -21.7], [8.8, -22.0], [10.1, -23.0], [10.6, -27], [10.9, -33.6]], 10), 0.16), color: gap, depth: 0.1, wall: gap, ...matt, facing: 0.3 });
  body.modifiers.push({ type: "cutout", cuts: cuts.slice(0, 90) });

  const cubes = [body];
  cubes.push(lattice("grille mesh", grille, at.front, 1, 0.38, 1.1, 0.12, "#2b2e35", { material: { metallic: 0.6, roughness: 0.4 } }));
  for (const sx of [1, -1]) cubes.push(lattice(`intake mesh ${sx}`, inset(intake, 0.3).map(([x, y]) => [sx * x, y]), at.front, 1, 0.5, 1.7, 0.13, "#26282e", {}));
  for (const [k, z] of wheelZ.entries()) for (const sx of [1, -1]) cubes.push(archLiner(`wheel house ${k} ${sx}`, arches[k].slice(1, -1), 14.4, track - 3.2, sx));
  cubes.push(box("floor", -11.5, 11.5, 3.0, 3.5, -30, 31, "#0b0c0e", { material: { metallic: 0, roughness: 1 } }));
  // the splitter: a plate under the nose, following its plan
  const lip = [[0, 36.75], [7.2, 36.6], [9.7, 35.3], [11.3, 34.2], [12.9, 33.2], [14.2, 32.2], [14.75, 31.0], [14.8, 29.0]];
  cubes.push(slab("splitter", [...lip, ...lip.slice(0, -1).reverse().map(([x, z]) => [-x, z]).slice(0, -1), [-14.8, 29.0]].filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]), 2.55, 2.95, BLACK, { material: { metallic: 0.1, roughness: 0.5 } }));
  // door mirrors on a short foot
  for (const sx of [1, -1]) {
    const q = (pts) => pts.map(([x, y, z]) => [sx * x, y, z]);
    cubes.push(pebble(`mirror ${sx}`, q([[13.5, 15.1, 7.7], [16.5, 15.25, 8.1], [16.6, 17.15, 8.2], [13.7, 17.2, 7.8]]), q([[13.3, 15.1, 10.9], [16.1, 15.2, 11.5], [16.3, 16.9, 11.6], [13.5, 17.0, 11.0]]), BLACK, { material: { metallic: 0.3, roughness: 0.3 }, levels: 2 }));
    cubes.push(hexa(`mirror glass ${sx}`, q([[14.3, 15.6, 8.12], [15.8, 15.65, 8.3], [15.85, 16.6, 8.34], [14.35, 16.6, 8.16]]), q([[14.3, 15.6, 8.4], [15.8, 15.65, 8.58], [15.85, 16.6, 8.62], [14.35, 16.6, 8.44]]), "#aebfd0", { material: CHROME }));
    cubes.push(box(`mirror foot ${sx}`, Math.min(sx * 12.6, sx * 14.0), Math.max(sx * 12.6, sx * 14.0), 15.25, 15.75, 9.0, 10.6, DARK, { round: 0.12, segs: 1 }));
  }
  const onTop = (x, z, lift = 0.12) => [x, at.top(x, z) + lift, z];
  for (const [x0, z0, x1, z1] of [[1.0, 19.6, 9.0, 17.6], [-8.6, 18.3, -0.6, 19.7]]) cubes.push(bar("wiper", onTop(x0, z0), onTop(x1, z1), 0.42, 0.22, "#0b0c0e", { material: RUBBER }));
  { const y = at.top(0, -16.5); cubes.push(pebble("roof fin", [[-0.7, y - 0.1, -18.2], [0.7, y - 0.1, -18.2], [0.28, y + 1.0, -18.4], [-0.28, y + 1.0, -18.4]], [[-0.55, y - 0.05, -15.2], [0.55, y - 0.05, -15.2], [0.15, y + 0.2, -15.6], [-0.15, y + 0.2, -15.6]], DARK, { levels: 2 })); }
  // the roof spoiler over the top of the hatch glass
  cubes.push(blade("roof spoiler", [-8.6, -6, 0, 6, 8.6].map((x) => { const y = at.top(x, -21.6); return [x, -21.4, y - 0.05, -24.9 + Math.abs(x) * 0.06, y - 0.55 - Math.abs(x) * 0.01]; }), 0.42, paint, { material: PAINT }));
  // the big wing: a blade across the tail, standing on two end plates that come down to the hatch's shoulders
  const wingX = 12.4;
  cubes.push(blade("wing", [-wingX, -8, 0, 8, wingX].map((x) => [x, -29.7, 20.45, -34.7, 21.2]), 0.55, BLACK, { material: { metallic: 0.3, roughness: 0.3 } }));
  for (const sx of [1, -1]) {
    const xt = sx * wingX, xb = sx * 11.5, yA = at.top(11.5, -27.6) - 0.3, yB = at.top(11.5, -30.2) - 0.3, t = 0.3 * sx;
    cubes.push(hexa(`wing stand ${sx}`, [[xt, 20.75, -31.4], [xt, 21.35, -34.8], [xb, yB, -30.4], [xb, yA, -27.4]], [[xt + t, 20.75, -31.4], [xt + t, 21.35, -34.8], [xb + t, yB, -30.4], [xb + t, yA, -27.4]], BLACK, { material: { metallic: 0.3, roughness: 0.3 } }));
  }
  const wheelOf = (sx) => wheel({ R, width: 3.9, rimR: 4.1, rim: "#7b808a", rimMaterial: { metallic: 0.7, roughness: 0.35 }, windows: spokeWindows(10, 1.5, 3.6, 0.5, 0.78), spokeDepth: 0.5, caliper: "#c8102e", hubR: 0.2, nuts: 5, nutAt: 1.55, dish: 0.3, cap: "#55585f" }, sx);
  return { at, R, track, wheelZ, model: assemble({ cubes, pivot: R, wheelZ, track, wheelOf, R }), tail: { z: r2(-35.3 / 16), y: r2(15.4 / 16 - 0.06), x: r2(10.5 / 16 / 0.92) } };
}

void [PAINT, PLASTIC];
