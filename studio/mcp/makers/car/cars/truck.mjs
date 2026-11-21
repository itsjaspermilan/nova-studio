// `car_truck`: a heavy bonneted 6x6 off-road truck as a chassis cab (8428 long, 2806 over the tyres, 3021 high; axles 4750 + 1450 apart), from
// build/blueprints/truck.png. The bonnet and cab are one smooth body (it ends at the back of the cab); the ladder frame, tanks, boxes and axles are
// separate pieces, as on the real truck. z = 0 is midway between the front axle and the middle of the two rear axles. No badge or lettering.
import { DARK, TRIM, glassOf, mirrorX, CHROME, PLASTIC, RUBBER, STEEL, archLiner, assemble, bar, box, buildBody, cyl, ellipse, fillet, flare, inset, lattice, mesh, path, r2, rect, rounded, rrect, shade, stroke, wheel, tube } from "../kit.mjs";

const lo = (a, b) => [Math.min(a, b), Math.max(a, b)];

export function truck(paint = "#b3261e") {
  const gap = shade(paint, 0.3), R = 9.75, track = 19.1, zF = 43.8, zM = -32.2, zR = -55.4, wheelZ = [zF, zR];
  const frame = "#23252a", steel = "#3a3d44", alu = "#aeb3ba", black = "#15161a";
  const spec = {
    paint, material: { metallic: 0.2, roughness: 0.42, coat: 0.8 }, midY: 30,
    w: [[10, 17.9], [11.5, 18.1], [30, 18.1], [37, 18.2], [41, 18.6], [46, 18.9], [58, 18.9], [62, 18.5], [64, 17.8], [65.6, 16], [66.7, 13], [67.3, 8]],
    yb: [[10, 22.8], [29, 22.8], [32, 20.3], [67.3, 20.3]],
    ys: [[10, 35], [37, 35], [38.6, 33.6], [40.4, 29.5], [42, 27.6], [46, 27], [56, 26.4], [62, 26], [67.3, 25.6]],
    top: [[10, 47.1], [12, 47.2], [33.5, 47.2], [35, 46.9], [35.8, 46.1], [36.3, 44.4], [38, 39.6], [39.6, 35.2], [40.2, 34.2], [41, 33.7], [44, 33.3], [50, 32.7], [56, 31.9], [60, 31.2], [63, 30.5], [65, 29.9], [66.6, 29.2], [67.3, 28.8]],
    rw: [[10, 11.2], [34, 11.3], [36.3, 13.2], [39.6, 15.4]],
    drop: [[10, 3.2], [34, 3.2], [36.3, 1.4], [39.6, 0.5]],
    rail: [[10, 5], [34, 5], [36.3, 2.6], [39.6, 0.9]],
    crown: [[10, 0.35], [34, 0.35], [36.3, 0.25], [39.6, 0.15]],
    ledge: 0.5, hoodP: 9, h0: 8.2, h1: 10.5,
    profile: [[0, 0.97], [0.15, 0.99], [0.4, 1.0], [0.8, 1.0], [0.93, 0.985], [1, 0.955]],
    rows: [0, 0.1, 0.25, 0.45, 0.65, 0.82, 0.93, 1],
    stations: [14, 20.7, 26, 30, 33.5, 35, 35.8, 36.3, 37.2, 38, 38.8, 39.6, 40.4, 41.2, 42.5, 44.5, 48, 52, 56, 59], maxGap: 4,
    front: { zc: 62, L: 7, plan: [[0, 67.3], [8, 67.2], [13, 66.7], [16, 65.6], [17.8, 64], [18.5, 62]], side: [[20.3, 66.5], [21.5, 66.9], [24, 67.2], [28, 67.3], [29.4, 66.9]], edgeBack: [[0, 0.5], [18.5, 0.3]], rim: 0.5, rimTop: 0.35 },
    rear: { zc: 11.5, L: 2.5, hood: false, plan: [[0, 10], [14, 10], [16.5, 10.2], [17.6, 10.7], [18.1, 11.5]], side: [[22.8, 10], [47.2, 10]], edgeBack: [[0, 0.25], [18.1, 0.05]], rim: 0.5, rimTop: 0.45 },
    crease: { rows: { 1: 0.5, 8: 0.5 }, cols: { 3: 0.35, 5: 0.3 } },
  };
  const { body, at } = buildBody(spec);
  const cuts = [], cut = (c) => cuts.push(c);
  // --- from the side: the wheel opening, the door and its glass, the bonnet's shut line and grips, the marker lamp
  const side = (o) => cut({ view: "side", facing: 0.6, ...o });
  const arch = [[57.6, 18], [57.4, 20.4], [55.4, 22.3], [51.5, 24.1], [47.5, 25], [43.8, 25.2], [40, 24.9], [36, 23.7], [32.6, 21.7], [30.4, 19.6], [29.9, 18]];
  const archR = rounded(arch.map(([z, y], i) => [z, y, i === 0 || i === arch.length - 1 ? 1 : 0]), 1);
  cut({ view: "side", points: archR, remove: true, depth: 0.8, wall: shade(paint, 0.5), facing: -1, near: 12 });
  const doorGlass = fillet([[35.7, 35.7], [32.7, 43.7], [22, 43.7], [22, 35.7]], 0.7);
  side({ name: "door window trim", points: inset(doorGlass, -0.4), color: TRIM, metallic: 0, roughness: 0.6, facing: 0.45 });
  side({ name: "door glass", points: doorGlass, ...glassOf(), facing: 0.45 });
  side({ name: "quarter light bar", points: stroke([[30.9, 35.7], [30.9, 43.7]], 0.4), color: TRIM, facing: 0.45 });
  side({ name: "door gap", points: stroke([[20.7, 23.5], [20.7, 44.8], [33.1, 44.8], [36.8, 34.8], [36.8, 27.3], [35, 26.2], [31.5, 24.4], [29.5, 23.5], [20.7, 23.5]], 0.2), color: gap, depth: 0.14, wall: gap, metallic: 0, roughness: 0.8, facing: 0.45 });
  side({ name: "door panel", points: stroke([...rrect(21.6, 29.7, 36, 32.6, 0.5), [21.6, 30.2]], 0.16), color: shade(paint, 0.62), depth: 0.06, wall: shade(paint, 0.5) });
  side({ name: "handle pocket", points: rrect(21.9, 30.5, 25, 31.8, 0.3), color: "#0c0d10", depth: 0.3, wall: shade(paint, 0.45) });
  side({ name: "bonnet gap", points: stroke(path([[45.8, 32.6], [45.3, 29.5], [44.7, 27.2]], 5), 0.18), color: gap, depth: 0.12, wall: gap, metallic: 0, roughness: 0.8, facing: 0.35 });
  for (const [z0, y0] of [[56.6, 29.2], [47.8, 30.4]]) side({ name: "bonnet grip", points: rrect(z0, y0, z0 + 3.2, y0 + 1.0, 0.3), color: "#0c0d10", depth: 0.25, wall: shade(paint, 0.45), facing: 0.35 });
  side({ name: "fender grip", points: rrect(45.2, 23.6, 48.6, 24.6, 0.3), color: "#0c0d10", depth: 0.25, wall: shade(paint, 0.45) });
  side({ name: "marker frame", points: rrect(59.4, 21.2, 62.4, 23.3, 0.3), color: "#17181c", metallic: 0, roughness: 0.6 });
  side({ name: "marker lens", points: rect(59.75, 21.55, 62.05, 22.95), color: "#f59a1b", emissive: 0.3, metallic: 0.2, roughness: 0.2 });
  side({ name: "side repeater", points: rrect(55.2, 21.6, 57.4, 22.8, 0.3), color: "#17181c", depth: 0.12 });
  // --- from the front: the screen, the grille in its dark surround, the lamps
  const front = (o) => cut({ view: "front", facing: 0.5, ...o });
  const screen = rounded(mirrorX([[0, 34.9], [12, 35.0], [15.9, 35.3], [16.5, 36.6], [15.7, 44.4], [14.4, 45.5], [0, 45.6]]), 1);
  front({ name: "screen rubber", points: inset(screen, -0.45), color: TRIM, metallic: 0, roughness: 0.6, facing: 0.3 });
  front({ name: "windscreen", points: screen, ...glassOf(), facing: 0.3 });
  const surround = rounded(mirrorX([[0, 30], [10.6, 30], [13, 29.3], [13.7, 27], [13.5, 24.2], [12.2, 22.2], [9.6, 21.2], [0, 21.2]]), 1), grille = inset(surround, 1.0);
  front({ name: "grille surround", points: surround, color: "#1b1c20", metallic: 0, roughness: 0.55 });
  front({ name: "grille", points: grille, color: "#07080a", depth: 0.55, wall: "#111216", metallic: 0, roughness: 0.9 });
  const lamp = fillet([[14.9, 21.3], [19.0, 21.3], [18.6, 23.4], [16.2, 23.4]], 0.35);
  front({ name: "headlamp housing", mirror: true, points: lamp, color: "#17181c", metallic: 0, roughness: 0.5, facing: 0.2 });
  front({ name: "headlamp", mirror: true, points: inset(lamp, 0.3), color: "#eef2f5", emissive: 0.55, metallic: 0.3, roughness: 0.1, depth: 0.1, wall: "#8d9199", facing: 0.2 });
  front({ name: "day light", mirror: true, points: stroke([[14.9, 25.3], [18.4, 26.3]], 0.4), color: "#f4f7ff", emissive: 0.8, facing: 0.2 });
  // --- from above: the cowl grille, the bonnet's shut lines and its three raised panels
  const top = (o) => cut({ view: "top", facing: 0.6, ...o });
  top({ name: "cowl grille", points: mirrorX([[0, 40.5], [9, 40.8], [15.6, 41.7], [15.6, 42.9], [9, 42.1], [0, 41.8]]), color: "#111216", metallic: 0, roughness: 0.7, facing: 0.3 });
  top({ name: "bonnet top gap", mirror: true, points: stroke(path([[0, 66.3], [9.5, 66.0], [12.8, 64.6], [14.2, 60], [16.2, 47], [16.6, 43.4]], 14), 0.18), color: gap, depth: 0.1, wall: gap, metallic: 0, roughness: 0.8, facing: 0.35 });
  const rib = (pts) => stroke([...pts, pts[0]], 0.16);
  top({ name: "bonnet panel", points: rib(rrect(-2.8, 50.4, 2.8, 61.4, 0.5)), color: shade(paint, 0.62), depth: 0.05, wall: shade(paint, 0.5) });
  top({ name: "bonnet panel side", mirror: true, points: rib(fillet([[5.9, 50.3], [11.3, 50.7], [10.7, 61.0], [6.2, 61.5]], 0.5)), color: shade(paint, 0.62), depth: 0.05, wall: shade(paint, 0.5) });
  // --- from behind: the cab's back wall with its two windows and pressed ribs
  const back = (o) => cut({ view: "back", facing: 0.5, ...o });
  const rearGlass = rrect(2.8, 37.7, 14.2, 43.5, 0.7);
  back({ name: "rear window rubber", mirror: true, points: inset(rearGlass, -0.35), color: TRIM, metallic: 0, roughness: 0.6 });
  back({ name: "rear window", mirror: true, points: rearGlass, ...glassOf() });
  for (const [x, y0, y1] of [[4.4, 31, 36], [7.6, 25.5, 36], [10.9, 25.5, 36], [14.2, 25.5, 36]]) back({ name: "back rib", mirror: true, points: rrect(x - 0.45, y0, x + 0.45, y1, 0.4), color: shade(paint, 0.7), depth: 0.12, wall: shade(paint, 0.5) });
  back({ name: "back rib mid", points: rrect(-0.9, 31, 0.9, 43.4, 0.6), color: shade(paint, 0.7), depth: 0.12, wall: shade(paint, 0.5) });
  body.modifiers.push({ type: "cutout", cuts });

  const cubes = [body], dull = { metallic: 0.2, roughness: 0.8 };
  // the grille's bars
  cubes.push(lattice("grille bars", grille, at.front, 1, 0.25, 1.85, 0.5, "#2e3138", { straight: true, posts: [-9, -4.5, 4.5, 9], material: { metallic: 0.4, roughness: 0.5 } }));
  // the wheel houses, the black wings over the front wheels, the floors under the cab and the engine
  for (const sx of [1, -1]) {
    const o = archR.slice(1, -1);
    cubes.push(archLiner(`wheel house ${sx}`, o, 18.6, 9, sx));
    cubes.push(flare(`wing ${sx}`, [[o[0][0], 20.2], ...o, [o[o.length - 1][0], 20.2]], at, sx, 1.3, 1.5, "#1a1b1f"));
    // the mud flap behind the front wheel
    cubes.push(box(`mud flap ${sx}`, ...lo(sx * 15.6, sx * 20.4), 12.5, 20.2, 29.3, 29.7, "#101114", { material: RUBBER }));
  }
  cubes.push(box("cab floor", -17.2, 17.2, 22.6, 23.4, 10.4, 30, "#0b0c0e", { material: { metallic: 0, roughness: 1 } }));
  cubes.push(box("engine", -8.6, 8.6, 14, 24, 33, 60, "#0e0f12", { material: { metallic: 0, roughness: 1 } }));
  cubes.push(box("radiator", -11, 11, 20, 28, 62.5, 64.5, "#0b0c0e", { material: { metallic: 0, roughness: 1 } }));

  // ---- the ladder frame: two rails, cross-members, the rear cross-member with its lamps
  for (const sx of [1, -1]) cubes.push(box(`frame rail ${sx}`, ...lo(sx * 5.0, sx * 6.2), 15.9, 20.4, -67.2, 65.5, frame, { round: 0.12, segs: 1, material: dull }));
  for (const [k, z] of [61, 50, 31, 12, -2, -17, -26, -43.8, -62].entries()) cubes.push(box(`cross-member ${k}`, -5.1, 5.1, 16.6, 19.6, z - 0.6, z + 0.6, frame, { material: dull }));
  cubes.push(box("rear cross-member", -6.6, 6.6, 15.6, 20.4, -67.5, -66.6, frame, { round: 0.12, segs: 1, material: dull }));
  cubes.push(cyl("tow coupling", 0, 16.4, -67.8, 0.9, 1.0, "z", "#2c2e33", { segments: 10, material: STEEL }));
  for (const sx of [1, -1]) {
    cubes.push(box(`lamp bar ${sx}`, ...lo(sx * 6.2, sx * 18.4), 17.4, 18.3, -67.3, -66.7, frame, { material: dull }));
    cubes.push(box(`tail lamp box ${sx}`, ...lo(sx * 11.2, sx * 17.8), 13.9, 16.7, -67.5, -66.3, "#17181c", { round: 0.25, segs: 1 }));
    cubes.push(box(`brake light ${sx}`, ...lo(sx * 13.6, sx * 15.6), 14.3, 16.3, -67.62, -67.4, "#c2161f", { material: { metallic: 0.2, roughness: 0.2 }, emissive: 0.5 }));
    cubes.push(box(`tail indicator ${sx}`, ...lo(sx * 15.8, sx * 17.4), 14.3, 16.3, -67.62, -67.4, "#f59a1b", { material: { metallic: 0.2, roughness: 0.2 }, emissive: 0.3 }));
    cubes.push(box(`reverse light ${sx}`, ...lo(sx * 11.6, sx * 13.4), 14.3, 16.3, -67.62, -67.4, "#e6e9ec", { material: { metallic: 0.2, roughness: 0.2 }, emissive: 0.25 }));
    cubes.push(box(`lamp stay ${sx}`, ...lo(sx * 14.0, sx * 14.6), 16.7, 17.5, -67.2, -66.8, frame, { material: dull }));
  }
  // the perforated walkway across the frame behind the cab, the cab's rear mount
  cubes.push(box("walkway", -6.4, 6.4, 20.4, 20.9, -14.6, -3, "#2b2d32", { material: { metallic: 0.5, roughness: 0.6 } }));
  cubes.push(box("walkway side", 6.4, 16, 20.3, 20.8, -10.6, -3, "#2b2d32", { material: { metallic: 0.5, roughness: 0.6 } }));
  cubes.push(box("cab mount", -8, 8, 20.4, 22.8, 10.6, 12.2, frame, { round: 0.2, segs: 1, material: dull }));
  // ---- tanks (rounded, strapped to brackets): the long one on the right, the short one on the left; the box and air tanks ahead of it; the steps
  const tank = (name, sx, z0, z1) => {
    cubes.push(box(name, ...lo(sx * 8.5, sx * 18.7), 10.8, 19.9, z0, z1, alu, { round: 2.3, segs: 2, material: { metallic: 0.85, roughness: 0.38 } }));
    for (const f of [0.2, 0.8]) { const z = z0 + (z1 - z0) * f; cubes.push(box(`${name} strap`, ...lo(sx * 8.3, sx * 18.9), 10.6, 20.1, z - 0.45, z + 0.45, "#2a2c31", { round: 2.3, segs: 2, material: dull })); }
    for (const f of [0.2, 0.8]) { const z = z0 + (z1 - z0) * f; cubes.push(box(`${name} bracket`, ...lo(sx * 6.2, sx * 9.5), 11.2, 12.4, z - 0.7, z + 0.7, frame, { material: dull })); }
    cubes.push(cyl(`${name} cap`, sx * 13.6, 20.1, (z0 + z1) / 2 + 1, 0.95, 0.7, "y", "#17181c", { segments: 12 }));
  };
  tank("fuel tank right", -1, -15.9, 9.6);
  tank("fuel tank left", 1, -15.9, 4);
  cubes.push(box("battery box", 8.6, 17.6, 14.2, 19.8, 11, 18.6, "#2a2c31", { round: 0.4, segs: 2, material: { metallic: 0.3, roughness: 0.6 } }));
  cubes.push(box("battery box lid", 8.4, 17.8, 19.5, 20.1, 10.8, 18.8, "#1c1d21", { round: 0.2, segs: 1 }));
  for (const z of [13, 17.8]) cubes.push(cyl("air tank", 12.6, 12.2, z, 1.95, 8.6, "x", "#2a2c31", { segments: 14, material: { metallic: 0.3, roughness: 0.55 } }));
  cubes.push(box("tool box", -17.6, -9, 12.5, 19.8, 12, 21, "#2a2c31", { round: 0.4, segs: 2, material: { metallic: 0.3, roughness: 0.6 } }));
  for (const sx of [1, -1]) {
    for (const [y, x1] of [[8.6, 19.9], [13.2, 19.3]]) cubes.push(box(`step ${sx}`, ...lo(sx * 14.4, sx * x1), y, y + 0.6, 24, 29.6, "#2b2d32", { material: { metallic: 0.5, roughness: 0.6 } }));
    for (const z of [24.1, 29.3]) cubes.push(box(`step hanger ${sx}`, ...lo(sx * 18.6, sx * 19.2), 8.6, 22.8, z, z + 0.4, frame, { material: dull }));
    cubes.push(box(`step back ${sx}`, ...lo(sx * 14.0, sx * 14.5), 9, 22.6, 24, 29.6, "#17181c", { material: dull }));
  }
  // the exhaust: a silencer under the right rail and a pipe out to the side
  cubes.push(cyl("silencer", 9.6, 13.4, -21.5, 2.3, 8, "z", "#3a3c42", { segments: 14, material: { metallic: 0.6, roughness: 0.5 } }));
  cubes.push(tube("tail pipe", [[9.6, 13.4, -25.4], [9.8, 13.2, -26.6], [11.2, 12.8, -27.6], [14.2, 12.4, -28.2]], 0.75, "#4a4d54", { material: STEEL }, 8));

  // ---- axles: beams with their differentials, the propeller shafts, the bogie's springs, the front springs
  const ax = "#1d1e23", axm = { metallic: 0.3, roughness: 0.7 };
  for (const [k, z] of [zF, zM, zR].entries()) {
    cubes.push(cyl(`axle ${k}`, 0, R - 0.3, z, k ? 1.7 : 1.4, 2 * track - 6, "x", ax, { segments: 12, material: axm }));
    const dx = k ? 0 : -3;
    cubes.push({ name: `differential ${k}`, shape: "sphere", from: [dx - 3.3, R - 3.6, z - 3.3], size: [6.6, 6.6, 6.6], color: ax, segments: 14, smooth: true, ...axm });
    for (const sx of [1, -1]) cubes.push(cyl(`hub ${k} ${sx}`, sx * (track - 4.4), R - 0.3, z, 2.6, 1.6, "x", ax, { segments: 14, material: axm }));
  }
  cubes.push(tube("propeller shaft", [[-3, 12.6, 30], [-1, 11.6, 4], [0, 10.6, -29.2]], 0.7, "#2c2e33", { material: STEEL }, 8));
  cubes.push(tube("propeller shaft rear", [[0, 10.4, -35.4], [0, 10.4, -52.2]], 0.7, "#2c2e33", { material: STEEL }, 8));
  for (const sx of [1, -1]) {
    cubes.push(box(`bogie spring ${sx}`, ...lo(sx * 7.0, sx * 8.6), 11.6, 13.2, zR + 1.5, zM - 1.5, ax, { round: 0.3, segs: 1, material: axm }));
    cubes.push(box(`bogie trunnion ${sx}`, ...lo(sx * 5.6, sx * 9), 12.2, 16.4, -45.4, -42.2, frame, { round: 0.4, segs: 1, material: dull }));
    cubes.push(box(`front spring ${sx}`, ...lo(sx * 7.2, sx * 8.6), 11.4, 12.6, zF - 8.5, zF + 8.5, ax, { round: 0.3, segs: 1, material: axm }));
    for (const z of [zF - 8.5, zF + 8.5]) cubes.push(box(`spring hanger ${sx}`, ...lo(sx * 6.2, sx * 8.6), 12.4, 16.2, z - 0.6, z + 0.6, frame, { material: dull }));
    cubes.push(tube(`front damper ${sx}`, [[sx * 9.4, 10.2, zF + 2.6], [sx * 7.2, 19.4, zF + 3.6]], 0.6, "#34363c", { material: STEEL }, 8));
  }

  // ---- the steel front bumper with its lamps, the centre plate, the underrun bar and tow eyes
  cubes.push(box("front bumper", -19.9, 19.9, 14.9, 19.7, 64.6, 67.45, steel, { round: 0.45, segs: 2, material: { metallic: 0.5, roughness: 0.55 } }));
  for (const sx of [1, -1]) {
    cubes.push(box(`bumper end ${sx}`, ...lo(sx * 17.6, sx * 20.3), 15.4, 19.7, 58.6, 65.2, steel, { round: 0.45, segs: 2, material: { metallic: 0.5, roughness: 0.55 } }));
    for (const [x, r, col, em] of [[13.7, 1.15, "#eef2f5", 0.5], [16.2, 1.15, "#eef2f5", 0.5], [18.5, 0.75, "#f59a1b", 0.3]]) {
      cubes.push(cyl(`bumper lamp ring ${sx}`, sx * x, 17.4, 67.47, r + 0.22, 0.2, "z", "#101114", { segments: 16 }));
      cubes.push(cyl(`bumper lamp ${sx}`, sx * x, 17.4, 67.55, r, 0.2, "z", col, { segments: 16, material: { metallic: 0.3, roughness: 0.1 }, emissive: em }));
    }
    cubes.push(box(`tow eye ${sx}`, ...lo(sx * 5.6, sx * 6.6), 9.6, 12.4, 63.6, 66.4, "#2c2e33", { round: 0.3, segs: 1, material: STEEL }));
    cubes.push(box(`bumper stay ${sx}`, ...lo(sx * 5.0, sx * 6.2), 11.5, 16, 63.4, 65.2, frame, { material: dull }));
  }
  cubes.push(box("bumper plate", -10, 10, 14.5, 19.3, 67.35, 67.65, "#2c2f35", { round: 0.12, segs: 1, material: { metallic: 0.5, roughness: 0.5 } }));
  cubes.push(box("bumper slot", -2.5, 2.5, 15.9, 16.9, 67.6, 67.72, "#0b0c0e", {}));
  cubes.push(box("underrun bar", -8.6, 8.6, 11.0, 13.7, 64.2, 65.4, steel, { round: 0.3, segs: 1, material: { metallic: 0.5, roughness: 0.55 } }));
  for (let k = -8; k <= 8; k++) cubes.push(box("underrun slot", k * 0.8 - 0.22, k * 0.8 + 0.22, 11.7, 13.0, 65.38, 65.46, "#0b0c0e", {}));

  // ---- on the cab: the raised air intake up the right A-pillar, mirrors on their arms, wipers, door handles, roof lamps
  {
    const x0 = -(at.side(41.5, 28) + 0.2);
    cubes.push(box("intake foot", x0 - 1.1, x0 + 1.6, 27.4, 31.2, 39.6, 43.6, "#17181c", { round: 0.5, segs: 2 }));
    cubes.push(tube("intake pipe", [[x0 + 0.1, 30.6, 41.6], [x0 + 0.2, 34, 40.9], [x0 + 0.8, 39, 39.1], [x0 + 1.5, 44, 37.3], [x0 + 1.8, 46.6, 36.6], [x0 + 1.8, 47.3, 36.5]], [1.25, 1.2, 1.15, 1.15, 1.15, 1.15], "#17181c", {}, 12));
    cubes.push(cyl("intake cap", x0 + 1.8, 47.9, 36.5, 2.9, 1.3, "y", "#1c1d21", { segments: 20 }));
    cubes.push(cyl("intake cap lip", x0 + 1.8, 47.25, 36.5, 2.5, 0.4, "y", "#0c0d10", { segments: 20 }));
    cubes.push(box("intake clamp", x0 + 0.4, x0 + 2.4, 41.4, 42.2, 37.4, 38.8, "#0c0d10", {}));
  }
  for (const sx of [1, -1]) {
    const xa = at.side(35.5, 36) - 0.3;
    cubes.push(tube(`mirror arm ${sx}`, [[sx * (xa - 1.2), 44.4, 35.2], [sx * 21.6, 44.4, 33.6], [sx * 21.9, 43.6, 33.4], [sx * 21.9, 36.2, 33.4], [sx * 21.4, 35.3, 33.6], [sx * xa, 35.2, 36.4]], 0.28, "#17181c", {}, 6));
    cubes.push(box(`mirror ${sx}`, ...lo(sx * 20.4, sx * 23.5), 39.1, 44.0, 32.4, 33.5, "#17181c", { round: 0.35, segs: 2 }));
    cubes.push(box(`mirror glass ${sx}`, ...lo(sx * 20.7, sx * 23.2), 39.4, 43.7, 32.32, 32.44, "#aebfd0", { material: CHROME }));
    cubes.push(box(`wide mirror ${sx}`, ...lo(sx * 20.4, sx * 24.0), 35.4, 38.5, 32.4, 33.5, "#17181c", { round: 0.35, segs: 2 }));
    cubes.push(box(`wide mirror glass ${sx}`, ...lo(sx * 20.7, sx * 23.7), 35.7, 38.2, 32.32, 32.44, "#aebfd0", { material: CHROME }));
    const xh = at.side(23.4, 31.1);
    cubes.push(box(`door handle ${sx}`, ...lo(sx * (xh - 0.2), sx * (xh + 0.08)), 31.0, 31.5, 22.1, 24.8, "#1a1b1f", { round: 0.08, segs: 1 }));
    cubes.push(box(`roof lamp ${sx}`, ...lo(sx * 7.4, sx * 9.6), at.top(8.5, 34) - 0.1, at.top(8.5, 34) + 0.45, 33.4, 34.6, "#f59a1b", { round: 0.15, segs: 1, material: { metallic: 0.2, roughness: 0.2 }, emissive: 0.25 }));
    // the grab rail beside the door
    cubes.push(tube(`grab rail ${sx}`, [[sx * (at.side(20, 30) - 0.1), 29, 19.6], [sx * (at.side(20, 30) + 0.7), 29.6, 19.6], [sx * (at.side(20, 33) + 0.7), 40, 19.6], [sx * (at.side(20, 40) - 0.1), 40.6, 19.6]], 0.22, "#101114", {}, 6));
  }
  const onScreen = (x, y, lift = 0.18) => [x, y, at.front(x, y) + lift];
  for (const [x0, x1] of [[-1.0, -14.0], [10.4, 0.6]]) cubes.push(bar("wiper", onScreen(x0, 35.6), onScreen(x1, 37.4), 0.42, 0.22, "#0b0c0e", { material: RUBBER }, [0, 0.36, 0.93]));

  // wheels: steel discs with ten hand holes and ten nuts, deep-tread tyres
  const wheelSpec = { R, width: 6.4, rimR: 4.7, rim: "#8b8f96", rimMaterial: { metallic: 0.4, roughness: 0.5 }, windows: Array.from({ length: 10 }, (_, k) => ellipse(Math.sin((k / 10) * 2 * Math.PI + 0.31) * 3.45, Math.cos((k / 10) * 2 * Math.PI + 0.31) * 3.45, 0.42, 0.42, 8)), spokeDepth: 0.4, hubR: 0.4, nuts: 10, nutAt: 1.42, dish: 0.7, cap: "#6f737a", tread: 22, faceAt: 0.6, discR: 0.6 };
  const wheelOf = (sx) => wheel(wheelSpec, sx);
  const model = assemble({ cubes, pivot: R, wheelZ, track, wheelOf, R });
  for (const [name, sx] of [["wheel_ml", -1], ["wheel_mr", 1]]) model.parts.push({ name, origin: [sx * track, R, zM], rotation: [0, 0, 0], cubes: wheelOf(sx), children: [] });
  return { at, R, track, wheelZ, model, tail: { z: r2(-28.2 / 16), y: r2(12.4 / 16 - 0.06), x: r2(14.6 / 16 / 0.92) } };
}

void [DARK, PLASTIC];
