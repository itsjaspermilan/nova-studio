// A modern seven-seat body-on-frame SUV (4795 x 1855 x 1835 mm, wheelbase 2745) modelled from build/blueprints/suv.png with carkit.mjs:
// one smooth body, everything cut into it with the Cut-out modifier, and only real separate pieces as shapes. Calibration: suv.trace.json.
import { DARK, TRIM, archOutline, flare, glassOf, mirrorX, CHROME, PAINT, RUBBER, STEEL, archLiner, assemble, bar, box, buildBody, cyl, ellipse, hexa, inset, lattice, pebble, r2, rect, rounded, rrect, shade, spokeWindows, stroke, wheel, path } from "../kit.mjs";

export function suv(paint = "#2f4a63") {
  const gap = shade(paint, 0.25), R = 6.2, track = 12.6, wheelZ = [22.4, -21.5], arcR = 8.0, arcY = 6.3;
  const spec = {
    paint, material: { metallic: 0.4, roughness: 0.34, coat: 1 }, midY: 14,
    w: [[-30, 14.2], [-27, 14.3], [-20, 14.3], [0, 14.3], [16, 14.3], [24, 14.3], [29, 14.25], [32, 14.1]],
    yb: [[-30, 7.8], [-24, 7.6], [-14, 7.0], [14, 7.0], [26, 7.0], [32, 7.1]],
    ys: [[-30, 20.3], [-5, 20.2], [12, 20.2], [14, 19.9], [20, 19.6], [26, 19.4], [32, 18.9]],
    top: [[-30, 26.3], [-29, 27.5], [-27.5, 28.2], [-24, 28.65], [-14, 28.75], [-5, 28.75], [0, 28.6], [2, 28.2], [4, 27.9], [6.7, 27.3], [9, 26.1], [11, 24.9], [13, 23.7], [15, 22.5], [16.5, 21.6], [17.5, 21.2], [20, 20.95], [25, 20.5], [30, 19.8], [33, 19.2], [36, 18.6], [37, 18.2]],
    rw: [[-30, 8.3], [-27, 9.6], [-24, 10.3], [-14, 10.4], [0, 10.3], [3, 10.5], [7, 10.9], [11, 11.6], [14, 12.4], [16.5, 13.0]],
    drop: [[-30, 1.2], [-20, 1.4], [0, 1.4], [8, 1.2], [14, 0.8]],
    crown: [[-30, 0.3], [-24, 0.5], [0, 0.5], [9, 0.4], [14, 0.2]],
    ledge: 0.45, rail: 0.6, hoodP: 2.3,
    profile: [[0, 0.95], [0.15, 0.975], [0.4, 0.995], [0.8, 1.0], [0.93, 0.985], [1, 0.95]],
    rows: [0, 0.1, 0.25, 0.45, 0.65, 0.82, 0.93, 1],
    stations: [-27, -24, -20, -16, -12, -8, -4, 0, 3, 6, 9, 12, 14, 16, 18, 22, 26, 29], maxGap: 3.2,
    front: { zc: 32, L: 9, plan: [[0, 38.2], [4, 38.1], [7, 37.6], [9.5, 36.5], [11.5, 34.8], [13, 33.2], [14.1, 32]], side: [[7.1, 34.8], [8.6, 37.4], [10, 38.1], [12, 38.2], [13.4, 38.2], [14.5, 37.8], [15.8, 37.4], [17.4, 37.2], [18.6, 36.4]], edgeBack: [[0, 1.4], [8, 1.2], [14, 0.4]], rim: 0.35, rimTop: 0.3 },
    rear: { zc: -30, L: 6, hood: false, plan: [[0, -38.0], [6, -37.9], [9, -37.6], [11.5, -36.8], [13.2, -35.2], [14.3, -30]], side: [[7.8, -34.4], [8.5, -36.8], [9.5, -37.9], [10.5, -38.05], [11.7, -38.0], [12.6, -37.0], [13.5, -36.6], [15, -35.9], [17, -35.2], [17.8, -35.2], [18.5, -36.6], [19.5, -37.6], [20.3, -36.6], [21, -35.4], [22, -33.9], [24, -32.2], [26, -30.4], [27.3, -29.3], [28.5, -27.8]], edgeBack: [[0, 8.5], [8, 8.3], [10.5, 7.5], [12.5, 6.2], [13.6, 3.0], [14.3, 0.5]], rim: 0.3, rimTop: 0.3 },
    crease: { rows: { 1: 0.4, 8: 0.35 }, cols: { 3: 0.25, 5: 0.2 } },
  };
  const { body, at } = buildBody(spec);
  const cuts = [], cut = (c) => cuts.push(c);
  const side = (o) => cut({ view: "side", facing: 0.55, ...o });
  // --- wheel openings
  const arches = wheelZ.map((z) => archOutline(z, arcY, arcR));
  for (const points of arches) cut({ view: "side", points, remove: true, depth: 0.8, wall: shade(paint, 0.5), facing: -1, near: 9 });
  // --- side glass: three openings in a dark frame
  const dgl = rounded([[10.9, 20.4, 1], [10.9, 23.0], [7.5, 26.0], [3, 27.3], [-1.8, 27.4, 1], [-0.9, 20.5, 1]], 1);
  const rgl = rounded([[-4.4, 20.6, 1], [-4.4, 27.4], [-12.8, 27.5], [-17.9, 22.7, 1], [-14.2, 21.3], [-9, 20.9]], 1);
  const qgl = rounded([[-20.7, 26.5], [-27.2, 26.4], [-29.5, 25.5], [-30.4, 23.4], [-30.0, 22.7], [-24.0, 23.1]], 2);
  for (const [nm, g] of [["front door", dgl], ["rear door", rgl]]) {
    side({ name: `${nm} trim`, points: inset(g, -0.35), color: TRIM, metallic: 0.2, roughness: 0.5 });
    side({ name: `${nm} glass`, points: g, ...glassOf() });
  }
  side({ name: "quarter trim", points: inset(qgl, -0.3), color: TRIM, metallic: 0.2, roughness: 0.5 });
  side({ name: "quarter glass", points: qgl, ...glassOf() });
  side({ name: "belt moulding", points: stroke([[10.8, 20.2], [-4.3, 20.35], [-14, 20.9], [-17.5, 22.3]], 0.25), color: CHROME.metallic ? "#b8bcc4" : "#b8bcc4", metallic: 1, roughness: 0.2, depth: 0.04 });
  // door lines
  side({ name: "door gap front", points: stroke([...path([[14.4, 22.5], [14.0, 18], [13.2, 12], [12.8, 8.2]], 6)], 0.17), color: gap, depth: 0.12, wall: gap, metallic: 0, roughness: 0.8 });
  side({ name: "door gap mid", points: stroke([...path([[-2.4, 20.4], [-2.6, 15], [-2.4, 8.2]], 5)], 0.17), color: gap, depth: 0.12, wall: gap, metallic: 0, roughness: 0.8 });
  side({ name: "door gap rear", points: stroke([...path([[-19.9, 22.3], [-19.9, 18], [-20.1, 15.2]], 4)], 0.17), color: gap, depth: 0.12, wall: gap, metallic: 0, roughness: 0.8 });
  for (const zc of [0.9, -15.75]) side({ name: "door handle", points: ellipse(zc, zc > 0 ? 17.1 : 17.9, 1.3, 0.45, 14), color: "#c4c9d2", metallic: 1, roughness: 0.2, depth: 0.1, wall: gap, facing: 0.6 });
  side({ name: "character line", points: stroke([[-9.8, 19.5], [-19.5, 19.8]], 0.14), color: shade(paint, 0.6), depth: 0.05, wall: shade(paint, 0.5) });
  side({ name: "fuel flap", points: stroke([...rrect(-27.9, 17.0, -24.6, 19.7, 0.6), [-27.9, 17.8]], 0.13), color: gap, depth: 0.08, wall: gap, metallic: 0, roughness: 0.8, only: "+x" });
  side({ name: "quarter crease", points: stroke(path([[-33.2, 17.8], [-29.5, 16.2], [-26.5, 14.6]], 5), 0.14), color: shade(paint, 0.6), depth: 0.05, wall: shade(paint, 0.5), facing: 0.3 });
  side({ name: "tail lamp side", points: rounded([[-28.2, 20.5], [-33, 20.5], [-36.2, 20.4], [-37.4, 19.8], [-37.2, 17.6], [-34.8, 17.6], [-32.5, 18.6], [-29.5, 19.7]], 1), color: "#b01620", emissive: 0.45, metallic: 0.3, roughness: 0.15, facing: 0.7 });
  side({ name: "headlamp side", points: rounded([[37.6, 18.0], [36, 18.2], [34.5, 17.4], [35.2, 16.7], [36.8, 16.7], [37.6, 17.1]], 1), color: "#232831", metallic: 0.7, roughness: 0.06, facing: 0.7 });
  // --- front: lamps, grille, fog lamps, intakes
  const front = (o) => cut({ view: "front", mirror: true, facing: 0.5, ...o });
  const lamp = rounded([[7.0, 17.7, 1], [9.5, 17.9], [12.4, 18.4], [13.4, 18.0], [13.3, 17.0], [11.5, 16.7], [9.2, 16.8], [7.4, 17.1, 1]], 1);
  front({ name: "headlamp", points: lamp, color: "#232831", metallic: 0.7, roughness: 0.06, facing: 0.7 });
  front({ name: "headlamp light", points: stroke(path([[8.6, 17.3], [10.6, 17.2], [12.5, 17.5]], 6), 0.3), color: "#f4f7ff", emissive: 0.9, facing: 0.7 });
  const grilleU = rounded([[-7.0, 17.7, 1], [7.0, 17.7, 1], [5.3, 14.3, 1], [-5.3, 14.3, 1]], 0);
  cut({ view: "front", facing: 0.5, name: "upper grille", points: grilleU, color: "#0a0b0d", depth: 0.5, wall: "#15171b", metallic: 0, roughness: 0.9 });
  const grilleL = [[-7.1, 12.7], [7.1, 12.7], [5.4, 10.4], [-5.4, 10.4]];
  cut({ view: "front", facing: 0.5, name: "lower grille", points: grilleL, color: "#0a0b0d", depth: 0.5, wall: "#15171b", metallic: 0, roughness: 0.9 });
  front({ name: "grille strut", points: stroke([[8.4, 17.7], [7.2, 15.5], [5.4, 12.8]], 0.9), color: "#c4c9d2", ...CHROME, depth: 0.05 });
  front({ name: "fog housing", points: rounded([[7.9, 13.2], [13.2, 13.2], [13.4, 11.2], [12.2, 9.6], [10.8, 9.2], [9.4, 10.2], [8.3, 11.8]], 1), color: "#15161a", metallic: 0, roughness: 0.7, depth: 0.1 });
  front({ name: "fog lamp", points: ellipse(11.1, 11.9, 0.85, 0.85, 14), color: "#e9eef3", emissive: 0.5, metallic: 0.3, roughness: 0.1, depth: 0.1, wall: "#8d9199" });
  front({ name: "bumper pocket", points: rounded([[2.6, 7.0], [6.8, 7.0], [6.2, 8.2], [3.2, 8.2]], 1), color: "#0a0b0d", metallic: 0, roughness: 0.8, depth: 0.2 });
  front({ name: "skid plate", points: rrect(0.01, 5.6, 8.2, 7.0, 0.3), color: "#2a2c31", metallic: 0.5, roughness: 0.4, facing: 0.3 });
  // --- rear: lamps, tailgate, plate, bumper
  const back = (o) => cut({ view: "back", mirror: true, facing: 0.5, ...o });
  const tail = rounded([[13.7, 20.5], [10, 20.2], [7.8, 20.0], [6.2, 19.6, 1], [5.6, 19.2], [7.3, 18.9], [9.6, 18.6], [10.4, 18.0], [11.0, 17.5], [13.7, 17.6]], 1);
  back({ name: "tail lamp", points: tail, color: "#b01620", emissive: 0.45, metallic: 0.3, roughness: 0.15, facing: 0.7 });
  back({ name: "reversing light", points: stroke([[11.5, 18.2], [13.1, 18.2]], 0.55), color: "#f4f7ff", emissive: 0.8, facing: 0.7 });
  back({ name: "tail lamp bar", points: stroke(path([[12.9, 19.8], [9.5, 19.5], [6.9, 19.3]], 5), 0.3), color: "#ff3b30", emissive: 0.9, facing: 0.7 });
  cut({ view: "back", facing: 0.5, name: "tailgate gap", points: stroke(path([[-11.5, 21.4], [-11.5, 17], [-11.1, 14.5], [-9.9, 12.4], [-8.5, 11.7], [0, 11.65], [8.5, 11.7], [9.9, 12.4], [11.1, 14.5], [11.5, 17], [11.5, 21.4]], 20), 0.16), color: gap, depth: 0.12, wall: gap, metallic: 0, roughness: 0.8 });
  cut({ view: "back", facing: 0.5, name: "plate recess", points: rounded([[-6.8, 17.7], [6.8, 17.7], [6.7, 16.5], [4.8, 14.6], [-4.8, 14.6], [-6.7, 16.5]], 1), color: shade(paint, 0.8), depth: 0.15, wall: shade(paint, 0.5) });
  cut({ view: "back", facing: 0.5, name: "plate", points: rect(-4.0, 15.0, 4.0, 17.1), color: "#ecece6", metallic: 0, roughness: 0.5 });
  cut({ view: "back", facing: 0.5, name: "tailgate handle", points: rrect(-3, 18.3, 3, 18.9, 0.25), color: DARK, depth: 0.1 });
  back({ name: "bumper reflector", points: rounded([[13.4, 10.3], [6.6, 10.3], [5.8, 9.4], [13.3, 9.4]], 1), color: "#b01620", emissive: 0.35, metallic: 0.3, roughness: 0.2, facing: 0.3 });
  cut({ view: "back", facing: 0.3, name: "rear valance", points: mirrorX([[0, 7.7], [13.6, 7.7], [13.6, 8.6], [10.6, 8.8], [0, 8.8]]), color: "#15161a", metallic: 0, roughness: 0.7 });
  // --- from above: windscreen, bonnet line
  const top = (o) => cut({ view: "top", facing: 0.35, ...o });
  const screen = rounded(mirrorX([[0, 15.95], [6, 15.85], [10.9, 15.2, 1], [10.0, 9.5], [9.6, 6.6, 1], [5, 6.3], [0, 6.2]]), 1);
  top({ name: "screen trim", points: inset(screen, -0.4), color: TRIM, metallic: 0.1, roughness: 0.5 });
  top({ name: "windscreen", points: screen, ...glassOf() });
  top({ name: "bonnet gap", mirror: true, points: stroke(path([[0, 37.4], [4, 37.1], [8, 36.0], [11, 33.2], [12.6, 27], [13.0, 20], [12.6, 16.7]], 14), 0.12), color: gap, depth: 0.05, wall: gap, metallic: 0, roughness: 0.8, facing: 0.62 });
  top({ name: "bonnet crease", mirror: true, points: stroke(path([[9.0, 18], [8.2, 24], [7.2, 30], [6.6, 35]], 8), 0.14), color: shade(paint, 0.6), depth: 0.04, wall: shade(paint, 0.5), facing: 0.62 });
  // --- back glass from behind
  const rg = rounded([[-10.8, 21.5, 1], [10.8, 21.5, 1], [10.1, 26.2], [8, 26.8], [-8, 26.8], [-10.1, 26.2]], 1);
  cut({ view: "back", facing: 0.35, name: "rear glass trim", points: inset(rg, -0.35), color: TRIM, metallic: 0.2, roughness: 0.5 });
  cut({ view: "back", facing: 0.35, name: "rear glass", points: rg, ...glassOf() });
  body.modifiers.push({ type: "cutout", cuts });

  const cubes = [body];
  cubes.push(lattice("grille bars upper", grilleU, at.front, 1, 0.3, 0.9, 0.2, "#c4c9d2", { straight: true, material: CHROME }));
  cubes.push(lattice("grille bars lower", grilleL, at.front, 1, 0.3, 0.8, 0.2, "#c4c9d2", { straight: true, material: CHROME }));
  for (const [k] of wheelZ.entries()) for (const sx of [1, -1]) {
    const o = arches[k].slice(1, -1).filter((p) => p[1] >= 7.0);
    cubes.push(archLiner(`wheel house ${k} ${sx}`, o, 14.0, track - 3.2, sx));
    cubes.push(flare(`flare ${k} ${sx}`, [[o[0][0], 7.3], ...o, [o[o.length - 1][0], 7.3]], at, sx, 0.9, 0.6, "#1a1b1f"));
  }
  cubes.push(box("floor", -11.5, 11.5, 6.8, 7.6, -22, 24, "#0b0c0e", { material: { metallic: 0, roughness: 1 } }));
  for (const sx of [1, -1]) cubes.push(box(`chassis rail ${sx}`, Math.min(sx * 5.2, sx * 6.6), Math.max(sx * 5.2, sx * 6.6), 5.8, 7.0, -22, 22, "#15161a", { material: { metallic: 0.2, roughness: 0.8 } }));
  // side steps
  for (const sx of [1, -1]) {
    const lo = Math.min(sx * 13.0, sx * 14.5), hi = Math.max(sx * 13.0, sx * 14.5);
    cubes.push(box(`side step ${sx}`, lo, hi, 6.1, 7.4, -15.5, 12.2, "#17181c", { round: 0.35, segs: 2 }));
    cubes.push(box(`side step trim ${sx}`, Math.min(sx * 14.3, sx * 14.65), Math.max(sx * 14.3, sx * 14.65), 6.6, 7.0, -14.5, 11.2, "#b8bcc4", { material: STEEL }));
  }
  // mirrors, handles
  for (const sx of [1, -1]) {
    const q = (pts) => pts.map(([x, y, z]) => [sx * x, y, z]);
    cubes.push(pebble(`mirror ${sx}`, q([[13.6, 20.7, 9.7], [17.2, 20.9, 10.0], [17.2, 23.0, 10.1], [13.8, 23.1, 9.9]]), q([[13.2, 20.8, 13.0], [16.9, 20.9, 12.9], [16.9, 22.9, 12.9], [13.3, 23.0, 12.9]]), paint, { material: PAINT, levels: 2 }));
    cubes.push(hexa(`mirror glass ${sx}`, q([[14.4, 21.3, 9.55], [16.7, 21.4, 9.8], [16.7, 22.6, 9.85], [14.5, 22.7, 9.7]]), q([[14.4, 21.3, 9.85], [16.7, 21.4, 10.1], [16.7, 22.6, 10.15], [14.5, 22.7, 10.0]]), "#aebfd0", { material: CHROME }));
    cubes.push(box(`mirror foot ${sx}`, Math.min(sx * 12.8, sx * 14.0), Math.max(sx * 12.8, sx * 14.0), 20.2, 20.9, 11.2, 12.6, DARK, { round: 0.1, segs: 1 }));
  }
  // roof rails on feet, the roof spoiler
  for (const sx of [1, -1]) {
    const zs = [6.2, -27.8], xr = 9.5, yr = (z) => at.top(xr, z) + 0.45;
    const rz = [6, 2, -2, -6, -10, -14, -18, -22, -26, -27.8];
    for (let i = 0; i < rz.length - 1; i++) cubes.push(bar(`roof rail ${sx} ${i}`, [sx * xr, yr(rz[i]), rz[i]], [sx * xr, yr(rz[i + 1]), rz[i + 1]], 0.5, 0.35, "#c4c9d2", { material: STEEL }));
    for (const z of [5.6, -27.2]) cubes.push(box(`rail foot ${sx} ${z}`, Math.min(sx * (xr - 0.3), sx * (xr + 0.3)), Math.max(sx * (xr - 0.3), sx * (xr + 0.3)), at.top(xr, z) - 0.3, yr(z) + 0.1, z - 0.4, z + 0.4, "#17181c", { round: 0.08, segs: 1 }));
  }
  {
    cubes.push(pebble("roof spoiler", [[-9.6, 26.6, -28.4], [9.6, 26.6, -28.4], [9.4, 27.7, -28.4], [-9.4, 27.7, -28.4]], [[-9.2, 27.1, -34.7], [9.2, 27.1, -34.7], [9.0, 28.0, -34.7], [-9.0, 28.0, -34.7]], paint, { material: PAINT, levels: 2 })); }
  // wipers on the screen
  const onTop = (x, z, lift = 0.12) => [x, at.top(x, z) + lift, z];
  for (const [x0, z0, x1, z1] of [[1.2, 15.2, 9.4, 13.6], [-8.4, 14.4, -0.8, 15.4]]) cubes.push(bar("wiper", onTop(x0, z0), onTop(x1, z1), 0.4, 0.22, "#0b0c0e", { material: RUBBER }));
  // exhaust
  cubes.push(cyl("tail pipe", 8.8, 6.6, -33.6, 0.8, 2.4, "z", "#c4c9d2", { segments: 14, material: CHROME }));
  const wheelOf = (sx) => wheel({ R, width: 4.2, rimR: 3.95, rim: "#c3c8d0", windows: spokeWindows(6, 1.7, 3.6, 0.5, 0.7), spokeDepth: 0.5, caliper: "#8d939c", hubR: 0.2, nuts: 6, nutAt: 1.55, dish: 0.35, cap: "#8f959f" }, sx);
  return { at, R, track, wheelZ, model: assemble({ cubes, pivot: R, wheelZ, track, wheelOf, R }), tail: { z: r2(-37.4 / 16), y: r2(19.0 / 16 - 0.06), x: r2(10 / 16 / 0.92) } };
}

