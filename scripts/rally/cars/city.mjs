// `car_city`: a tiny rounded five-door city car of the late 1990s (3495 x 1495 x 1485 mm, wheelbase 2340), traced from build/blueprints/city.png (numbers in
// city.trace.json). One smooth body from buildBody; everything cut into the skin is a Cut-out; mirrors, wheels, wipers and the exhaust are separate pieces.
// No badges or lettering (the drawing's badges are left out; the plates are blank).
import { CHROME, DARK, PAINT, PLASTIC, RUBBER, STEEL, TRIM, archLiner, archOutline, assemble, bar, box, buildBody, cyl, ellipse, glassOf, inset, lattice, mirrorX, path, pebble, hexa, r2, rect, rounded, rrect, shade, spokeWindows, stroke, wheel } from "../carkit.mjs";

function city(paint = "#e8b923") {
  const gap = shade(paint, 0.3), bump = "#80838a", R = 4.35, track = 10.4, wheelZ = [17.4, -20.2];
  const spec = {
    paint, midY: 10,
    w: [[-28.2, 6.0], [-27, 10.4], [-26, 11.0], [-24, 11.4], [-20, 11.65], [-14, 11.8], [0, 11.85], [10, 11.85], [16, 11.7], [20, 11.6], [23, 11.5], [24, 11.2], [25, 10.9], [26, 10.45], [27, 9.4], [28.1, 6.0]],
    yb: [[-28.2, 5.2], [-27, 4.5], [-24, 3.9], [-20, 3.4], [-17.5, 3.3], [13, 3.3], [16, 3.4], [20, 3.6], [24, 3.7], [27, 4.1], [28.1, 4.6]],
    top: [[-26.2, 15.6], [-25, 17.2], [-24, 18.6], [-23, 19.8], [-22, 20.9], [-21, 21.9], [-20, 22.6], [-19, 23.1], [-18, 23.4], [-16, 23.7], [-13, 23.85], [-9, 23.92], [-5, 23.9], [-2, 23.75], [0, 23.5], [2, 23.2], [4, 22.7], [6, 21.9], [8, 20.9], [10, 19.7], [12, 18.6], [14, 17.4], [16, 16.2], [17, 15.7], [18, 15.55], [19, 15.2], [20, 14.6], [21, 14.1], [22, 13.4], [23, 12.7], [24, 11.8], [25, 10.9], [26, 9.6], [27, 8.9], [28, 7.7]],
    ys: [[-26.2, 14.9], [-24, 15.5], [-20, 16.0], [-8, 15.8], [0, 15.6], [8, 15.4], [14, 15.3], [17, 15.0], [20, 13.9], [22, 12.7], [24, 11.1], [26, 9.0], [28, 7.0]],
    rw: [[-26, 9.4], [-24, 8.4], [-22, 7.2], [-20, 6.5], [-14, 6.4], [-6, 6.4], [0, 6.6], [3, 7.1], [5, 7.7], [8, 8.4], [12, 9.0], [15, 9.5]],
    drop: [[-24, 1.7], [-20, 1.6], [-10, 1.5], [0, 1.5], [5, 1.4], [10, 1.0], [14, 0.6]],
    crown: [[-24, 0.6], [-20, 0.6], [-10, 0.65], [0, 0.65], [4, 0.9], [10, 1.0], [14, 0.8]],
    ledge: 0.5, rail: 0.8, hoodP: 2.4,
    profile: [[0, 0.9], [0.12, 0.95], [0.3, 0.985], [0.5, 1.0], [0.7, 0.99], [0.85, 0.955], [1, 0.92]],
    rows: [0, 0.1, 0.25, 0.45, 0.65, 0.82, 0.93, 1],
    stations: [-24, -22, -20, -17, -14, -10, -6, -2, 2, 6, 10, 13, 16, 19, 22], maxGap: 3.2,
    front: { zc: 23, L: 7, plan: [[0, 28.1], [4, 28.0], [7, 27.6], [9, 27.0], [10.4, 26.1], [11.1, 25.0], [11.5, 23]], side: [[3.5, 25.8], [4.3, 26.9], [5.2, 27.6], [6.5, 28.05], [7.5, 28.1], [8.3, 27.8], [9.2, 26.9], [10, 25.6], [11, 24.9], [12.5, 23.4], [14, 21.1]], edgeBack: [[0, 0.4], [10, 0.5], [11.5, 0.2]], rim: 0.15, rimTop: 0.2 },
    rear: { zc: -26, L: 3.2, hood: false, plan: [[0, -28.2], [6.0, -28.1], [8.6, -27.7], [10.0, -27.1], [10.8, -26.5], [11.0, -26]], side: [[3.6, -25.2], [4.4, -27.2], [5.3, -27.7], [7, -27.9], [9, -28.1], [10, -27.9], [10.8, -27.2], [11.5, -26.7], [14, -26.55], [15.3, -26.3]], edgeBack: [[0, 0.6], [6, 0.5], [10, 0.4], [11, 0.2]], rim: 0.2, rimTop: 0.4 },
    crease: { rows: { 1: 0.3, 8: 0.25 } },
  };
  const { body, at } = buildBody(spec);
  const cuts = [], cut = (c) => cuts.push(c);
  const side = (o) => cut({ view: "side", facing: 0.5, ...o });
  const matt = { metallic: 0, roughness: 0.8 };
  // --- from the side: wheel openings, windows, doors, rubbing strip, lamps
  const arches = wheelZ.map((z) => archOutline(z, R - 0.1, 5.2));
  for (const points of arches) cut({ view: "side", points, remove: true, depth: 0.7, wall: shade(paint, 0.5), facing: -1, near: 9 });
  const rearWin = rounded([[-20.3, 16.1, 1], [-20.1, 18.6], [-19.0, 21.0], [-17.4, 22.2], [-14, 22.45], [-8.0, 22.5, 1], [-7.4, 15.75, 1], [-14, 15.95]], 1);
  const frontWin = rounded([[-6.1, 15.65, 1], [-5.8, 22.2, 1], [-2, 22.1], [2, 21.6], [5.2, 20.5], [8, 18.5], [10.2, 16.4], [10.9, 15.2, 1], [4, 15.45]], 1);
  for (const [nm, w] of [["rear", rearWin], ["front", frontWin]]) {
    side({ name: `${nm} window trim`, points: w, color: TRIM, metallic: 0.2, roughness: 0.4 });
    side({ name: `${nm} side glass`, points: inset(w, 0.42), ...glassOf() });
  }
  side({ name: "quarter pillar", points: stroke([[5.6, 20.4], [6.9, 15.4]], 0.5), color: TRIM, metallic: 0.1, roughness: 0.5 });
  side({ name: "b pillar", points: stroke([[-6.8, 22.2], [-6.5, 15.9]], 0.4), color: TRIM, metallic: 0.1, roughness: 0.5 });
  side({ name: "door gap front edge", points: stroke([...path([[11.2, 15.0], [11.7, 12], [11.8, 9.3], [11.5, 6.5], [11.0, 4.9]], 8), ...path([[10.0, 4.55], [3, 4.55], [-5.0, 4.6]], 3)], 0.16), color: gap, depth: 0.12, wall: gap, ...matt });
  side({ name: "door gap middle", points: stroke([[-7.0, 22.4], [-6.5, 15.7], [-5.6, 10], [-5.1, 4.7]], 0.16), color: gap, depth: 0.12, wall: gap, ...matt });
  side({ name: "rear door gap", points: stroke(path([[-20.6, 16.3], [-20.9, 13.5], [-20.6, 11.3], [-19.8, 9.9]], 6), 0.16), color: gap, depth: 0.12, wall: gap, ...matt });
  for (const [nm, z0, y] of [["front", -2.7, 13.8], ["rear", -18.0, 14.3]]) {
    side({ name: `${nm} handle`, points: ellipse(z0, y, 1.5, 0.52, 14), color: shade(paint, 0.82), depth: 0.14, wall: gap });
  }
  side({ name: "fuel flap", points: stroke([...rrect(-23.5, 11.7, -21.5, 13.6, 0.45), [-23.5, 12.4]], 0.12), color: gap, depth: 0.08, wall: gap, ...matt, only: "+x" });
  side({ name: "side repeater", points: ellipse(13.1, 13.4, 0.5, 0.32, 10), color: "#f0a020", emissive: 0.3, metallic: 0.2, roughness: 0.2 });
  side({ name: "rubbing strip", points: rounded([[-14.5, 7.55], [-13.8, 7.75], [-5, 7.5], [5, 7.2], [10.8, 7.05], [11.4, 6.7], [10.8, 6.4], [5, 6.5], [-5, 6.9], [-13.8, 7.0]], 1), color: bump, metallic: 0, roughness: 0.7, depth: 0.1, wall: shade(bump, 0.7) });
  side({ name: "rear bumper side", points: rounded([[-28.2, 10.4], [-23, 10.1], [-22.6, 9.8], [-24.5, 8.7], [-27.6, 8.45]], 1), color: bump, metallic: 0, roughness: 0.7, facing: 0.3 });
  side({ name: "front bumper side", points: rounded([[21.2, 9.05], [22.2, 9.7], [26, 9.95], [27.4, 8.9], [25.7, 8.5]], 1), color: bump, metallic: 0, roughness: 0.7, facing: 0.3 });
  cut({ view: "side", facing: 0.65, name: "tail lamp side", points: rounded([[-26.5, 15.2], [-25, 15.15], [-24.1, 14.3], [-24.3, 13.2], [-25.2, 12.3], [-26.5, 11.9]], 1), color: "#b01620", emissive: 0.45, metallic: 0.3, roughness: 0.15 });
  // --- from the front: windscreen frame is cut from above; here lamps, grille, bumper
  const front = (o) => cut({ view: "front", mirror: true, facing: 0.5, ...o });
  front({ name: "headlight ring", points: ellipse(7.9, 12.2, 1.45, 1.45, 28), color: "#aeb3bb", metallic: 1, roughness: 0.15, facing: 0.2 });
  front({ name: "headlight", points: ellipse(7.9, 12.2, 1.22, 1.22, 28), color: "#cfd8e2", emissive: 0.15, metallic: 0.6, roughness: 0.05, depth: 0.2, wall: "#5d636c", facing: 0.2 });
  front({ name: "headlight reflector", points: ellipse(7.9, 12.2, 0.62, 0.62, 20), color: "#f4f6fa", emissive: 0.45, metallic: 0.9, roughness: 0.1, depth: 0.05, facing: 0.2 });
  front({ name: "front indicator", points: ellipse(6.4, 10.6, 0.42, 0.42, 12), color: "#f0b84a", emissive: 0.3, metallic: 0.2, roughness: 0.2, facing: 0.3 });
  front({ name: "bonnet edge", points: stroke(path([[0, 10.95], [3, 11.0], [5.4, 11.2], [6.8, 11.5], [7.2, 11.2]], 8), 0.13), color: gap, depth: 0.1, wall: gap, ...matt, facing: 0.5 });
  cut({ view: "top", mirror: true, facing: 0.5, name: "bonnet side gap", points: stroke(path([[7.4, 23.2], [9.2, 21.2], [9.6, 19.5], [9.1, 17.6]], 8), 0.13), color: gap, depth: 0.1, wall: gap, ...matt });
  const bumperF = mirrorX([[0, 10.15], [11.5, 10.15], [11.7, 9.7], [11.1, 9.0], [10.0, 8.55], [8.5, 8.25], [6.9, 8.1], [6.2, 7.9], [6.0, 7.3], [5.9, 7.0], [0, 7.0]]);
  cut({ view: "front", facing: 0.3, name: "bumper", points: bumperF, color: bump, metallic: 0, roughness: 0.7 });
  const grille = rrect(-5.4, 4.8, 5.4, 6.95, 0.5);
  cut({ view: "front", facing: 0.4, name: "grille frame", points: inset(grille, -0.28), color: "#2b2d33", metallic: 0.3, roughness: 0.5 });
  cut({ view: "front", facing: 0.4, name: "grille", points: grille, color: "#07080a", depth: 0.5, wall: "#17191e", metallic: 0, roughness: 0.9 });
  front({ name: "fog trim", points: rounded([[10.0, 6.85], [6.9, 6.85], [6.0, 6.4], [6.2, 5.0], [7.0, 4.9], [9.9, 5.5]], 1), color: "#26282d", metallic: 0, roughness: 0.6, facing: 0.35 });
  front({ name: "fog lamp", points: ellipse(8.8, 6.05, 0.72, 0.72, 16), color: "#e8ecf0", emissive: 0.4, metallic: 0.3, roughness: 0.1, facing: 0.35 });
  cut({ view: "front", facing: 0.4, name: "front plate", points: rrect(-2.7, 7.75, 2.7, 8.85, 0.15), color: "#dcdcd5", metallic: 0, roughness: 0.5 });
  cut({ view: "front", facing: 0.4, name: "nose slot", points: rrect(-2.9, 10.4, 2.9, 10.8, 0.2), color: "#0c0d10", metallic: 0, roughness: 0.8, depth: 0.08 });
  // --- from behind: lamps, hatch handle and plate, bumper
  const back = (o) => cut({ view: "back", mirror: true, facing: 0.5, ...o });
  back({ name: "tail lamp", points: rounded([[10.9, 15.1], [9.9, 15.2], [9.0, 14.7], [7.9, 13.5], [7.3, 12.3], [7.8, 11.9], [9.0, 12.0], [10.4, 12.4], [11.0, 13.5]], 1), color: "#b01620", emissive: 0.45, metallic: 0.3, roughness: 0.15, facing: 0.5 });
  back({ name: "tail lamp lens a", points: ellipse(9.85, 14.0, 0.5, 0.5, 14), color: "#e8d9d4", emissive: 0.4, metallic: 0.2, roughness: 0.15, facing: 0.5 });
  back({ name: "tail lamp lens b", points: ellipse(8.75, 12.8, 0.65, 0.65, 14), color: "#e0a030", emissive: 0.4, metallic: 0.2, roughness: 0.15, facing: 0.5 });
  const glassR = rounded(mirrorX([[0, 22.75], [3.6, 22.7], [5.4, 22.3], [6.6, 20.6], [7.5, 18.5], [7.9, 17.5], [7.3, 17.0], [5, 16.9], [0, 16.88]]), 2);
  cut({ view: "back", facing: 0.15, name: "rear glass trim", points: inset(glassR, -0.8), color: TRIM, metallic: 0.2, roughness: 0.4 });
  cut({ view: "back", facing: 0.15, name: "rear glass", points: glassR, ...glassOf() });
  cut({ view: "back", facing: 0.15, name: "high brake light", points: rrect(-1.5, 17.2, 1.5, 17.7, 0.2), color: "#c8201e", emissive: 0.6, metallic: 0.2, roughness: 0.2 });
  cut({ view: "back", facing: 0.5, name: "hatch panel", points: rrect(-5.0, 11.9, 5.0, 15.2, 0.6), color: shade(paint, 0.85), depth: 0.12, wall: gap });
  cut({ view: "back", facing: 0.5, name: "plate", points: rrect(-4.3, 12.65, 4.3, 14.8, 0.2), color: "#dcdcd5", metallic: 0, roughness: 0.5 });
  cut({ view: "back", facing: 0.3, name: "rear bumper", points: mirrorX([[0, 10.1], [11.5, 10.1], [11.7, 9.5], [10.8, 8.9], [9.4, 8.55], [0, 8.4]]), color: bump, metallic: 0, roughness: 0.7 });
  cut({ view: "back", facing: 0.3, name: "rear trim", points: mirrorX([[0, 4.35], [6.8, 4.4], [7.2, 5.05], [0, 5.1]]), color: "#17181c", metallic: 0, roughness: 0.7 });
  // --- from above: the windscreen
  const screen = rounded(mirrorX([[0, 5.9], [4.5, 5.75], [7.1, 5.55, 1], [8.1, 10.2], [8.9, 14.3], [8.7, 15.4], [7.6, 16.4], [4, 16.7], [0, 16.75]]), 1);
  cut({ view: "top", facing: 0.35, name: "screen trim", points: inset(screen, -0.5), color: TRIM, metallic: 0.2, roughness: 0.4 });
  cut({ view: "top", facing: 0.35, name: "windscreen", points: screen, ...glassOf() });
  body.modifiers.push({ type: "cutout", cuts: cuts.slice(0, 120) });

  const cubes = [body];
  cubes.push(lattice("grille mesh", grille, at.front, 1, 0.35, 0.7, 0.12, "#363940", { straight: true, posts: [-4, -2, 2, 4], material: { metallic: 0.5, roughness: 0.4 } }));
  for (const [k] of wheelZ.entries()) for (const sx of [1, -1]) cubes.push(archLiner(`wheel house ${k} ${sx}`, arches[k].slice(1, -1), 10.7, track - 2.4, sx));
  cubes.push(box("floor", -9.2, 9.2, 3.0, 3.5, -24, 24, "#0b0c0e", { material: { metallic: 0, roughness: 1 } }));
  // door mirrors on a short foot
  for (const sx of [1, -1]) {
    const q = (pts) => pts.map(([x, y, z]) => [sx * x, y, z]);
    cubes.push(pebble(`mirror ${sx}`, q([[11.3, 14.9, 5.5], [13.3, 15.0, 5.6], [13.3, 17.3, 5.7], [11.3, 17.4, 5.6]]), q([[11.3, 15.0, 8.5], [12.8, 15.1, 8.3], [12.8, 17.0, 8.3], [11.3, 17.1, 8.4]]), paint, { material: PAINT, levels: 2 }));
    cubes.push(hexa(`mirror glass ${sx}`, q([[11.8, 15.5, 5.62], [12.8, 15.55, 5.66], [12.8, 16.8, 5.7], [11.8, 16.85, 5.66]]), q([[11.8, 15.5, 5.8], [12.8, 15.55, 5.84], [12.8, 16.8, 5.88], [11.8, 16.85, 5.84]]), "#aebfd0", { material: CHROME }));
    cubes.push(box(`mirror foot ${sx}`, Math.min(sx * 10.6, sx * 11.8), Math.max(sx * 10.6, sx * 11.8), 14.9, 15.5, 6.1, 7.8, DARK, { round: 0.1, segs: 1 }));
  }
  // wipers on the screen
  const onTop = (x, z, lift = 0.12) => [x, at.top(x, z) + lift, z];
  for (const [x0, z0, x1, z1] of [[0.8, 16.2, 8.2, 14.4], [-7.6, 14.4, -0.8, 16.2]]) cubes.push(bar("wiper", onTop(x0, z0), onTop(x1, z1), 0.4, 0.2, "#0b0c0e", { material: RUBBER }));
  // exhaust tip under the rear bumper
  cubes.push(cyl("exhaust", -6.9, 4.7, -27.0, 0.55, 2.0, "z", "#9aa0a8", { segments: 14, material: CHROME }));
  const wheelOf = (sx) => wheel({ R, width: 2.9, rimR: 2.75, rim: "#8f949c", rimMaterial: { metallic: 0.3, roughness: 0.5 }, windows: spokeWindows(4, 1.15, 2.5, 0.55, 0.78, 0.3), spokeDepth: 0.4, hubR: 0.26, nuts: 4, nutAt: 1.9, dish: 0.35, cap: "#b5bac2", discR: 0.6 }, sx);
  return { model: assemble({ cubes, pivot: R, wheelZ, track, wheelOf, R }), tail: { z: r2(-26.6 / 16), y: r2(13.4 / 16 - 0.06), x: r2(9.0 / 16 / 0.92) } };
}

export const CARS = {
  car_city: () => city(),
  car_city_blue: () => city("#2f6fc4"),
  car_city_red: () => city("#c4302b"),
  car_city_white: () => city("#e6e8e8"),
};
void [PLASTIC, STEEL, rect, ellipse];
