// `car_rally`: an early-1980s Group B rear-drive rally coupe, traced from build/blueprints/rally.png (side, plan, front and rear views; numbers in
// rally.trace.json). 4.42 m long, 1.77 m over the arches, 1.27 m high, wheelbase 2.53 m as drawn. One smooth body from buildBody; glass, lamps, grille,
// vents, gaps and the livery's two flashes are cut-outs; the boxy bolted-on arches, bumpers, ducktail, mirror, aerial, flaps and exhaust are separate pieces.
// No lettering, numbers or badges. Units 1/16 m, y up from the ground, nose along +z.
import { CHROME, DARK, GLASS, PAINT, PLASTIC, RUBBER, STEEL, TRIM, archLiner, archOutline, assemble, bar, box, buildBody, curve, cyl, ellipse, fillet, glassOf, hexa, inset, lattice, mesh, mirrorX, path, pebble, r2, rect, rounded, rrect, shade, stroke, wheel, rayHit, boxArch, sweptBar } from "../kit.mjs";


export function rally(paint = "#e9eaec", flashA = "#d2342c", flashB = "#1d2f5a") {
  const gap = shade(paint, 0.22), R = 4.6, track = 12.0, wheelZ = [21.4, -19.0];
  const spec = {
    paint, midY: 9,
    w: [[-34.6, 5], [-34.55, 8], [-34.3, 10.8], [-33.7, 11.6], [-33, 11.9], [-30, 12.25], [-26, 12.55], [-22, 12.7], [-12, 12.8], [10, 12.8], [14, 12.75], [20, 12.6], [26, 12.2], [30, 11.8], [32.5, 11.5], [33.0, 11.4], [33.9, 10.8], [34.3, 9.5], [34.5, 6], [34.6, 4]],
    yb: [[-34.6, 5.3], [-27, 5.0], [-24, 4.8], [-13, 3.6], [-10, 3.3], [13, 3.3], [16, 3.6], [27, 4.5], [30, 4.7], [34.6, 4.8]],
    top: [[-34.6, 12.9], [-30, 13.3], [-25, 13.6], [-23.5, 13.85], [-22, 14.5], [-20, 15.55], [-18, 16.6], [-16, 17.65], [-14, 18.65], [-12, 19.5], [-10, 19.95], [-7, 20.2], [0, 20.3], [2.5, 20.25], [4, 20.05], [5, 19.6], [6, 19.0], [8, 17.8], [10, 16.5], [12, 15.25], [13.4, 14.6], [16, 14.3], [20, 13.95], [24, 13.55], [27, 13.2], [30, 12.8], [32.5, 12.3], [33.5, 12.05], [34.6, 11.7]],
    ys: [[-34.6, 12.6], [-30, 13.0], [-25, 13.45], [-22, 13.75], [-15, 13.8], [-7, 13.85], [0, 13.95], [5, 14.1], [11, 14.3], [14, 14.15], [20, 13.65], [27, 12.9], [32.5, 12.05], [34.6, 11.5]],
    rw: [[-26, 10.6], [-23, 10.2], [-19, 9.4], [-15, 8.6], [-8, 8.4], [0, 8.4], [4, 8.5], [6, 9.0], [9, 9.9], [12, 10.6], [14, 11.2]],
    drop: [[-22, 1.4], [-15, 1.2], [-8, 1.0], [0, 1.0], [4, 1.0], [8, 0.8], [12, 0.5]],
    crown: [[-22, 0.7], [-15, 0.5], [0, 0.4], [4, 0.5], [9, 0.8], [13, 0.6]],
    ledge: 0.35, rail: 0.6, hoodP: 3.2,
    profile: [[0, 0.965], [0.15, 0.99], [0.3, 1.0], [0.75, 1.0], [0.88, 0.975], [1, 0.925]],
    rows: [0, 0.1, 0.25, 0.45, 0.65, 0.82, 0.93, 1],
    stations: [-30, -26.5, -23.5, -21, -19, -15, -12, -8, -4, 0, 3.5, 5, 8, 11, 13.5, 17, 21.4, 26, 30], maxGap: 3.0,
    front: { zc: 32.5, L: 6, plan: [[0, 34.6], [6, 34.5], [9.5, 34.3], [10.8, 33.9], [11.4, 33.0], [11.5, 32.5]], side: [[4.8, 34.35], [5.3, 34.6], [7, 34.6], [9, 34.4], [9.6, 34.3], [11.4, 33.7], [12.0, 33.0]], edgeBack: [[0, 1.6], [8, 1.6], [11.5, 0.6]], rim: 0.35, rimTop: 0.45 },
    rear: { zc: -33, L: 5, plan: [[0, -34.6], [8, -34.55], [10.8, -34.3], [11.6, -33.7], [11.9, -33]], side: [[5.3, -33.6], [6, -34.0], [8, -34.35], [10, -34.55], [11.5, -34.6], [12.8, -34.5]], edgeBack: [[0, 0.1], [11.9, 0.1]], rim: 0.4, rimTop: 0.6 },
    crease: { rows: { 1: 0.4, 8: 0.45 } },
  };
  const { body, at } = buildBody(spec);
  const cuts = [], cut = (c) => cuts.push(c);
  const side = (o) => cut({ view: "side", facing: 0.5, ...o });
  const top = (o) => cut({ view: "top", facing: 0.45, ...o });
  // --- the livery first (everything else is cut through it): two flashes, a chevron over the bonnet that runs on down the flanks
  const slope = 1.16, band = (z0, z1, yTop = 15.5, yBot = 2) => [[z0, yTop], [z1, yTop], [z1 - (yTop - yBot) * slope, yBot], [z0 - (yTop - yBot) * slope, yBot]];
  const zAt = (z, y) => z - (15.5 - y) * slope, yS = 13.3; // (where a band's edge meets the shoulder)
  const flashes = [{ name: "flash a", points: band(20.5, 26), color: flashA }, { name: "flash b", points: band(17.6, 19.6), color: flashB }];
  for (const f of flashes) side({ ...f, facing: 0.62 });
  for (const [nm, z0, z1, color] of [["a", 20.5, 26, flashA], ["b", 17.6, 19.6, flashB]]) top({ name: `chevron ${nm}`, mirror: true, points: [[13.5, zAt(z0, yS) - 0.8], [13.5, zAt(z1, yS) - 0.8], [0, zAt(z1, yS) + 6.4], [0, zAt(z0, yS) + 6.4]], color, facing: 0.62 });
  // --- from the side: wheel openings (behind the bolted-on arches), glass, the door
  const arches = wheelZ.map((z) => archOutline(z, R, 5.55));
  for (const points of arches) cut({ view: "side", points, remove: true, depth: 0.7, wall: shade(paint, 0.5), facing: -1, near: 9 });
  const dlo = rounded([[10.3, 14.2, 1], [5, 14.1], [0, 14.0], [-7, 13.95], [-15, 13.9], [-21.8, 13.9, 1], [-19.5, 15.25], [-16.5, 16.8], [-13.5, 18.15], [-10.5, 19.1], [-7.5, 19.5], [0, 19.6], [3.5, 19.5, 1]], 1);
  side({ name: "window trim", points: dlo, color: TRIM, metallic: 0.2, roughness: 0.4 });
  side({ name: "side glass", points: inset(dlo, 0.3), ...glassOf() });
  for (const [k, dz] of [[0, 0], [1, -1.0], [2, -1.9]]) side({ name: `pillar ${k}`, points: stroke([[-6.7 + dz, 14.0], [-8.2 + dz, 19.55]], k ? 0.42 : 0.6), color: TRIM, metallic: 0.1, roughness: 0.5 });
  side({ name: "door gap", points: stroke([...path([[10.5, 14.0], [11.5, 12.6], [11.8, 10], [11.75, 6], [11.5, 4.5]], 8), ...path([[10.4, 4.1], [2, 4.1], [-5.6, 4.1]], 3), ...path([[-6.6, 4.6], [-7.3, 6.2], [-7.4, 9], [-7.0, 12], [-6.6, 13.8]], 8)], 0.17), color: gap, depth: 0.12, wall: gap, metallic: 0, roughness: 0.8 });
  side({ name: "door handle", points: rrect(-5.9, 11.95, -3.4, 12.6, 0.28), color: "#101114", depth: 0.16, wall: gap, metallic: 0, roughness: 0.6 });
  side({ name: "door lock", points: ellipse(-6.6, 12.3, 0.2, 0.2, 8), color: "#c8ccd2", ...CHROME });
  // --- from the front: four round lamps in a dark panel, the slatted grille, the valance intakes
  const front = (o) => cut({ view: "front", mirror: true, facing: 0.45, ...o });
  front({ name: "lamp panel", points: rrect(6.2, 9.45, 11.15, 11.75, 0.3), color: "#14161a", depth: 0.14, wall: "#0c0d10", metallic: 0, roughness: 0.6 });
  for (const x of [7.5, 9.9]) {
    front({ name: "headlamp ring", points: ellipse(x, 10.6, 1.08, 1.08, 20), color: "#c9cdd3", ...CHROME });
    front({ name: "headlamp", points: ellipse(x, 10.6, 0.88, 0.88, 16), color: "#eef2f5", emissive: 0.55, metallic: 0.3, roughness: 0.1, depth: 0.1, wall: "#8d9199" });
  }
  const grilleU = rrect(0.4, 9.55, 5.85, 10.45, 0.15), grilleL = rrect(0.4, 8.85, 5.75, 9.35, 0.12);
  front({ name: "grille frame", points: mirrorX([[0, 8.65], [6.0, 8.65], [6.1, 10.6], [0, 10.6]]), mirror: false, color: "#aeb3bb", metallic: 0.8, roughness: 0.3 });
  for (const g of [grilleU, grilleL]) front({ name: "grille", points: g, color: "#07080a", depth: 0.4, wall: "#111216", metallic: 0, roughness: 0.9 });
  const intake = rrect(-6.3, 5.25, 6.3, 6.65, 0.2), intakeS = rrect(7.0, 5.3, 9.5, 6.35, 0.2);
  front({ name: "lower intake", mirror: false, points: intake, color: "#07080a", depth: 0.4, wall: "#15171b", metallic: 0, roughness: 0.9, facing: 0.3 });
  front({ name: "side intake", points: intakeS, color: "#07080a", depth: 0.3, wall: "#15171b", metallic: 0, roughness: 0.9, facing: 0.3 });
  // --- from behind: lamp clusters, the plate, the boot lid
  const back = (o) => cut({ view: "back", mirror: true, facing: 0.3, ...o });
  back({ name: "tail panel", points: rrect(5.4, 8.6, 11.95, 10.45, 0.25), color: "#14161a", metallic: 0, roughness: 0.6 });
  back({ name: "reversing lamp", points: rect(5.6, 8.8, 6.95, 10.25), color: "#e6e9ec", emissive: 0.2, metallic: 0.3, roughness: 0.15 });
  back({ name: "brake lamp", points: rect(7.1, 8.8, 10.15, 10.25), color: "#b01620", emissive: 0.45, metallic: 0.3, roughness: 0.15 });
  back({ name: "tail indicator", points: rect(10.3, 8.8, 11.75, 10.25), color: "#f08a1c", emissive: 0.3, metallic: 0.3, roughness: 0.15 });
  cut({ view: "back", facing: 0.5, name: "plate recess", points: rrect(-3.6, 8.6, 3.6, 10.45, 0.2), color: shade(paint, 0.8), depth: 0.12, wall: shade(paint, 0.5) });
  cut({ view: "back", facing: 0.5, name: "plate", points: rect(-3.25, 8.8, 3.25, 10.25), color: "#ecece6", metallic: 0, roughness: 0.5 });
  cut({ view: "back", facing: 0.5, name: "boot gap", points: stroke([[-10.4, 12.4], [-10.4, 10.75], [10.4, 10.75], [10.4, 12.4]], 0.16), color: gap, depth: 0.1, wall: gap, metallic: 0, roughness: 0.8 });
  cut({ view: "back", facing: 0.5, name: "boot lock", points: ellipse(0, 11.5, 0.28, 0.28, 10), color: "#c8ccd2", ...CHROME });
  // --- from above: the screens, the bonnet's shut lines, ducts and louvres
  const screen = rounded(mirrorX([[0, 13.5], [5, 13.3], [9, 12.4], [10.3, 11.5, 1], [9.2, 7.6], [7.9, 4.4, 1], [4, 4.75], [0, 4.9]]), 1);
  top({ name: "screen trim", points: inset(screen, -0.35), color: TRIM, metallic: 0.1, roughness: 0.5 });
  top({ name: "windscreen", points: screen, ...glassOf() });
  const rearG = rounded(mirrorX([[0, -15.0], [4, -14.85], [7.7, -14.4, 1], [8.8, -18.5], [9.8, -22.2, 1], [6, -23.1], [0, -23.4]]), 1);
  top({ name: "rear glass trim", points: inset(rearG, -0.35), color: TRIM, metallic: 0.1, roughness: 0.5 });
  top({ name: "rear glass", points: rearG, ...glassOf() });
  const shut = { color: gap, depth: 0.1, wall: gap, metallic: 0, roughness: 0.8 };
  top({ name: "bonnet gap", mirror: true, points: stroke(path([[0, 32.6], [8, 32.5], [10.2, 31.6], [10.7, 26], [11.0, 19], [11.0, 13.9]], 14), 0.16), ...shut, facing: 0.6 });
  top({ name: "bonnet bulge line", mirror: true, points: stroke([[4.6, 32.0], [5.1, 24], [5.3, 14.6]], 0.13), color: shade(paint, 0.6), depth: 0.05, wall: shade(paint, 0.5), metallic: 0, roughness: 0.8 });
  top({ name: "bonnet duct", mirror: true, points: fillet([[7.35, 28.6], [6.9, 26.8], [6.3, 25.2], [6.3, 20.6], [8.4, 20.6], [8.4, 25.2], [7.8, 26.8]], 0.3), color: "#0a0b0d", depth: 0.3, wall: "#17181c", metallic: 0, roughness: 0.9 });
  for (let k = 0; k < 8; k++) top({ name: "bonnet louvre", points: stroke([[-3.6 + k * 0.9, k % 2 ? 28.7 : 30.4], [-3.6 + (k + 1) * 0.9, k % 2 ? 30.4 : 28.7]], 0.36), color: "#08090b", depth: 0.2, wall: "#17181c", metallic: 0, roughness: 0.9 });
  top({ name: "scuttle vent", mirror: true, points: rrect(5.3, 14.1, 8.7, 15.2, 0.15), color: "#0c0d10", depth: 0.12, wall: "#17181c", metallic: 0, roughness: 0.9 });
  top({ name: "boot gap top", mirror: true, points: stroke([[0, -24.6], [9.6, -24.2], [10.5, -25.2], [10.6, -30]], 0.16), ...shut, facing: 0.6 });
  top({ name: "filler cap", points: ellipse(11.15, -20.6, 0.5, 0.5, 12), color: "#c8ccd2", ...CHROME, facing: 0.3 });
  if (cuts.length > 96) throw new Error(`rally: ${cuts.length} cut-outs`);
  body.modifiers.push({ type: "cutout", cuts });

  const cubes = [body];
  // slats in the grille and the intakes
  for (const sx of [1, -1]) for (const [k, g] of [[0, grilleU], [1, grilleL]]) cubes.push(lattice(`grille slats ${k} ${sx}`, g.map(([x, y]) => [sx * x, y]), at.front, 1, 0.22, 0.24, 0.09, "#b9bec6", { straight: true, material: STEEL }));
  cubes.push(lattice("intake mesh", intake, at.front, 1, 0.3, 0.5, 0.08, "#2b2e35", { material: { metallic: 0.5, roughness: 0.5 }, slope: 1 }));
  for (const sx of [1, -1]) cubes.push(lattice(`side intake mesh ${sx}`, intakeS.map(([x, y]) => [sx * x, y]), at.front, 1, 0.22, 0.5, 0.08, "#2b2e35", { material: { metallic: 0.5, roughness: 0.5 } }));
  // behind the openings
  for (const [k] of wheelZ.entries()) for (const sx of [1, -1]) cubes.push(archLiner(`wheel house ${k} ${sx}`, arches[k].slice(1, -1).filter(([z, y]) => y >= curve(spec.yb)(z) + 0.15), 12.0, track - 3.4, sx));
  for (const [z0, z1, y] of [[-32, -12, 5.3], [-12, 15, 3.7], [15, 33, 5.0]]) cubes.push(box("floor", -11, 11, y, y + 0.5, z0, z1, "#0b0c0e", { material: { metallic: 0, roughness: 1 } }));
  // the bolted-on box arches
  const archF = { c: [wheelZ[0], R], r: 5.3, a0: 0.05, a1: Math.PI + 0.2, ch: 0.85, outline: fillet([[33.9, 4.3, 1], [33.9, 10.2], [30, 10.8], [25, 11.2], [17, 11.55], [14.3, 11.5], [14.3, 5.5], [13.3, 3.4, 1]], 0.8, 3), xf: [[34, 10.9], [32.5, 11.9], [30, 12.9], [26.5, 13.75], [23, 14.1], [18, 14.1], [15.5, 13.9], [14.3, 13.6]] };
  const archR = { c: [wheelZ[1], R], r: 5.3, a0: -0.02, a1: Math.PI + 0.2, ch: 0.85, outline: fillet([[-27.3, 4.6, 1], [-27.3, 11.5], [-26, 11.9], [-12, 11.95], [-10.7, 11.2], [-10.7, 5.5], [-9.7, 3.4, 1]].reverse(), 0.9, 3), xf: [[-9.7, 13.5], [-11.5, 13.85], [-15, 14.1], [-22, 14.1], [-25.5, 13.85], [-27.3, 13.4]] };
  const flashCuts = flashes.map((f) => ({ view: "side", facing: 0.08, ...f }));
  for (const sx of [1, -1]) cubes.push(...boxArch(`arch front ${sx}`, archF, at, sx, paint, flashCuts), ...boxArch(`arch rear ${sx}`, archR, at, sx, paint));
  // bumpers: bars that follow the nose and the tail and wrap the corners
  const half = (pts) => [...pts.map(([x, z]) => [-x, z]).reverse(), ...pts.slice(1)];
  const lamp = (name, x0, x1, y0, y1, color, emissive) => ({ view: "front", mirror: true, name, points: rrect(x0, y0, x1, y1, 0.15), color, emissive, metallic: 0.2, roughness: 0.2, facing: 0.3 });
  cubes.push(sweptBar("front bumper", half([[0, 35.3], [4, 35.28], [8, 35.1], [10.3, 34.7], [11.4, 34.0], [11.9, 33.0]]), 7.05, 8.7, 1.5, shade(paint, 0.97), { cuts: [lamp("indicator", 7.5, 10.4, 7.5, 8.3, "#f08a1c", 0.3)] }));
  cubes.push(box("front plate", -3.3, 3.3, 6.75, 8.2, 35.28, 35.42, "#ecece6", {}));
  cubes.push(sweptBar("rear bumper", half([[0, -35.3], [5, -35.28], [9.5, -35.15], [11.4, -34.7], [12.3, -33.6], [12.5, -32.2], [12.5, -30.5]]), 6.3, 8.45, 1.4, shade(paint, 0.97)));
  // the ducktail on the boot lid
  {
    const prof = [[-26.6, at.top(0, -26.6) - 0.05], [-30.5, 13.8], [-34.5, 14.05], [-35.35, 14.45], [-35.2, 13.5], [-34.5, 12.4]], hw = (z) => curve(spec.w)(Math.max(z, -33)) * 0.925 + 0.05, v = [], l = [];
    for (const [z, y] of prof) v.push([-hw(z), y, z], [-hw(z) * 0.5, y + (z > -34.5 && z < -27 ? 0.12 : 0), z], [hw(z) * 0.5, y + (z > -34.5 && z < -27 ? 0.12 : 0), z], [hw(z), y, z]);
    for (let i = 0; i < prof.length - 1; i++) for (let c = 0; c < 3; c++) l.push({ v: [i * 4 + c, i * 4 + c + 1, i * 4 + 5 + c, i * 4 + 4 + c], want: i < 3 ? [0, 1, -0.1] : [0, -0.2, -1] });
    l.push({ v: prof.map((_, i) => i * 4), want: [-1, 0, 0] }, { v: prof.map((_, i) => i * 4 + 3), want: [1, 0, 0] });
    cubes.push(mesh("ducktail", v, l, paint, { material: PAINT }));
  }
  // one bullet mirror on the driver's door, on a short stalk
  {
    const q = (pts) => pts.map(([x, y, z]) => [x, y, z]);
    cubes.push(pebble("mirror", q([[12.5, 14.0, 6.3], [14.5, 14.0, 6.4], [14.5, 15.6, 6.4], [12.5, 15.6, 6.3]]), q([[13.1, 14.4, 8.5], [13.9, 14.4, 8.5], [13.9, 15.2, 8.5], [13.1, 15.2, 8.5]]), "#16171b", { levels: 2 }));
    cubes.push(box("mirror glass", 12.85, 14.15, 14.3, 15.3, 6.2, 6.32, "#aebfd0", { material: CHROME }));
    cubes.push(bar("mirror stalk", [12.2, 13.6, 7.6], [13.4, 14.3, 7.3], 0.5, 0.4, "#16171b"));
  }
  // wipers, the aerial, mud flaps, the exhaust
  const onTop = (x, z, lift = 0.12) => [x, at.top(x, z) + lift, z];
  for (const [x0, z0, x1, z1] of [[1.0, 13.2, 8.6, 11.6], [-8.6, 12.0, -1.0, 13.2]]) cubes.push(bar("wiper", onTop(x0, z0), onTop(x1, z1), 0.4, 0.2, "#0b0c0e", { material: RUBBER }));
  { const y = at.top(0, -9); cubes.push(cyl("aerial base", 0, y + 0.25, -9, 0.3, 0.6, "y", "#16171b", { segments: 8 }), cyl("aerial", 0, y + 3.3, -9, 0.07, 6, "y", "#b9bec6", { segments: 5, material: STEEL })); }
  for (const sx of [1, -1]) {
    const zf = -24.9, lean = 0.5, x0 = sx * 8.7, x1 = sx * 13.8;
    cubes.push(hexa(`mud flap ${sx}`, [[x0, 5.6, zf], [x1, 5.6, zf], [x1, 1.5, zf - lean], [x0, 1.5, zf - lean]], [[x0, 5.6, zf - 0.25], [x1, 5.6, zf - 0.25], [x1, 1.5, zf - lean - 0.25], [x0, 1.5, zf - lean - 0.25]], "#101114", { material: RUBBER }));
  }
  cubes.push(cyl("silencer", 2.6, 3.95, -29.6, 1.0, 5, "z", "#3a3d44", { segments: 12, material: { metallic: 0.6, roughness: 0.5 } }));
  cubes.push(cyl("exhaust", 2.6, 3.9, -33.4, 0.5, 3.4, "z", "#b9bec6", { segments: 12, material: STEEL }));
  cubes.push(cyl("exhaust bore", 2.6, 3.9, -35.08, 0.38, 0.06, "z", "#050506", { segments: 10, material: { metallic: 0, roughness: 1 } }));
  // small deep-dish rally wheels: a wide lip, a ring of holes
  const holes = Array.from({ length: 10 }, (_, k) => ellipse(Math.sin((k / 10) * 2 * Math.PI) * 1.72, Math.cos((k / 10) * 2 * Math.PI) * 1.72, 0.27, 0.27, 8));
  const wheelOf = (sx) => wheel({ R, width: 3.9, rimR: 2.8, rim: "#dfe2e6", rimMaterial: { metallic: 0.35, roughness: 0.4 }, windows: holes, spokeDepth: 0.3, hubR: 0.27, nuts: 5, nutAt: 1.35, dish: 0.85, faceAt: 0.74, cap: "#9aa0aa", discR: 0.62 }, sx);
  return { at, R, track, wheelZ, model: assemble({ cubes, pivot: R, wheelZ, track, wheelOf, R }), tail: { z: r2(-34.5 / 16), y: r2(9.5 / 16 - 0.06), x: r2(8.7 / 16 / 0.92) } };
}

void [DARK, GLASS, PLASTIC];
