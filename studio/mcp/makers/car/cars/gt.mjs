// `car_gt` in Pine Ridge Rally: a modern coupe (4768 x 1852 x 1383 mm, wheelbase 2851), modelled from the owner's blueprint with the car kit (2026-11-19).
// Every number below was read off the drawing (side, plan, front and rear views, each calibrated to its own dimension lines). No badges or lettering.
import { DARK, GLASS_COL, TRIM, archOutline, flare, glassOf, mirrorX, CHROME, GLASS, PAINT, PLASTIC, RUBBER, STEEL, archLiner, assemble, bar, box, buildBody, cyl, ellipse, fillet, hexa, inset, lattice, lerp, mesh, mix, path, pebble, r2, rect, rounded, rrect, shade, spokeWindows, stroke, wheel } from "../kit.mjs";

export function gt(paint = "#1f57b8") {
  const gap = shade(paint, 0.22), R = 5.4, track = 12.7, wheelZ = [24.42, -21.21];
  const spec = {
    paint,
    w: [[-38.15, 3], [-38, 4.75], [-37, 9.9], [-36, 11.5], [-35, 12.25], [-34, 12.85], [-33, 13.25], [-32, 13.55], [-30, 13.95], [-28, 14.25], [-26, 14.45], [-24, 14.6], [-22, 14.7], [-20, 14.75], [-16, 14.55], [-12, 14.38], [-8, 14.52], [-4, 14.68], [0, 14.75], [5, 14.75], [10, 14.65], [16, 14.5], [26, 14.5], [29, 14.45], [31, 14.25], [32, 14.0], [33, 13.55], [34, 12.5], [35, 11.1], [36, 9.2], [37, 7.35], [38, 3.55]],
    yb: [[-38.15, 5.9], [-37, 4.8], [-35, 4.2], [-32, 4.2], [-30, 3.9], [-27, 3.4], [-24, 3.0], [-16, 2.8], [-10, 2.7], [0, 2.6], [10, 2.4], [17, 2.3], [20, 2.5], [28, 2.9], [31, 2.9], [34, 3.0], [36, 3.1], [38.15, 3.5]],
    top: [[-37.25, 16.3], [-36, 16.3], [-34, 16.5], [-32, 16.8], [-30, 17.1], [-28, 17.8], [-26, 18.5], [-24, 19.2], [-22, 19.8], [-20, 20.3], [-18, 20.9], [-16, 21.3], [-14, 21.6], [-12, 21.9], [-10, 22.2], [-8, 22.4], [-2, 22.4], [0, 22.3], [1, 22.2], [2, 22.0], [3, 21.8], [4, 21.5], [5, 21.1], [6, 20.6], [8, 19.6], [10, 18.5], [11, 18.0], [12, 17.4], [13, 16.8], [14, 16.2], [15, 15.7], [16, 15.7], [18, 15.6], [20, 15.5], [22, 15.4], [24, 15.2], [26, 14.9], [28, 14.6], [30, 14.2], [32, 13.7], [33, 13.3], [34, 12.9], [35, 12.5], [36, 12.0], [37, 11.4], [37.4, 11.2]],
    ys: [[-37.3, 15.5], [-34, 15.9], [-30, 16.4], [-26, 16.9], [-22, 17.2], [-20.5, 17.2], [-18, 16.9], [-12, 16.3], [-7, 16.0], [0, 15.55], [6, 15.45], [13, 15.3], [16, 15.2], [20, 14.9], [24, 14.5], [27, 14.1], [30, 13.5], [32, 13.0], [34, 12.3], [36, 11.6], [37.4, 11.0]],
    rw: [[-33, 11.6], [-29.5, 11.2], [-26, 10.2], [-22, 9.2], [-17, 8.4], [-8, 8.6], [0, 8.5], [3, 8.7], [5, 9.2], [7, 10.0], [10, 10.8], [13, 11.4], [16, 12.0]],
    drop: [[-22, 2.2], [-18, 2.0], [-10, 1.6], [0, 1.5], [3, 1.4], [8, 1.2], [12, 0.8]],
    crown: [[-27, 1.2], [-20, 0.9], [-14, 0.5], [2, 0.6], [5, 1.1], [9, 1.5], [14, 1.2]],
    ledge: 0.45, rail: 0.9, hoodP: 2.6,
    profile: [[0, 0.9], [0.1, 0.935], [0.2, 0.955], [0.45, 0.99], [0.62, 1.0], [0.8, 0.975], [0.9, 0.94], [1, 0.86]],
    rows: [0, 0.1, 0.25, 0.45, 0.65, 0.82, 0.93, 1],
    stations: [-30, -26.5, -21.2, -16, -12, -8, -4, 0, 4, 8, 12, 15, 18, 24.4, 30], maxGap: 3.0,
    front: { zc: 33, L: 12, plan: [[0, 38.15], [3.55, 38.0], [7.35, 37.0], [9.2, 36.0], [11.1, 35.0], [12.5, 34.0], [13.55, 33.0]], side: [[3.3, 37.9], [3.6, 38.1], [4.0, 37.5], [4.6, 37.3], [5.5, 37.55], [7, 37.8], [8.5, 38.0], [9.5, 38.15], [10.3, 38.0], [10.8, 37.75], [11.2, 37.4]], edgeBack: [[0, 0.75], [6, 0.8], [13.5, 0.3]], rimTop: 0.3 },
    rear: { zc: -35, L: 8, plan: [[0, -38.15], [4.75, -38.0], [8, -37.6], [9.9, -37.0], [11.5, -36.0], [12.25, -35.0]], side: [[4.2, -36.0], [4.6, -36.8], [5.2, -37.6], [6, -38.05], [9.5, -38.15], [10.1, -37.6], [10.6, -36.9], [11.2, -36.5], [13, -36.3], [13.8, -36.6], [14.6, -37.15], [15.5, -37.3], [16.3, -37.25]], edgeBack: [[0, 0.9], [12.25, 0.4]], rim: 0.15, rimTop: 0.5 },
    crease: { rows: { 1: 0.4, 8: 0.3 } },
  };
  const { body, at } = buildBody(spec);
  const cuts = [], cut = (c) => cuts.push(c);
  const side = (o) => cut({ view: "side", facing: 0.5, ...o });
  // --- from the side: wheel openings, the side glass, the door, the lamps where they wrap round the corners
  const arches = wheelZ.map((z) => archOutline(z, R - 0.1, 6.0));
  for (const points of arches) cut({ view: "side", points, remove: true, depth: 0.7, wall: shade(paint, 0.5), facing: -1, near: 9 });
  const dlo = rounded([[12.7, 15.35, 1], [6, 15.45], [0, 15.55], [-7.3, 16.0], [-14, 16.45], [-20.9, 17.15, 1], [-20.3, 17.9], [-19.0, 18.75], [-17, 19.4], [-13, 20.1], [-8, 20.65], [-3, 20.95], [1, 20.95], [4, 20.5], [7, 19.5], [9.5, 18.0], [11.5, 16.5]], 1);
  side({ name: "window trim", points: dlo, color: TRIM, metallic: 0.2, roughness: 0.4 });
  side({ name: "side glass", points: inset(dlo, 0.32), ...glassOf() });
  side({ name: "pillar", points: stroke([[-7.2, 16.0], [-9.1, 20.7]], 0.55), color: TRIM, metallic: 0.1, roughness: 0.5 });
  side({ name: "door gap", points: stroke([...path([[12.6, 15.0], [13.75, 13.2], [13.9, 9], [13.65, 5.4], [13.3, 4.5]], 8), ...path([[10, 4.55], [3, 4.7], [-4.4, 5.0]], 3), ...path([[-5.6, 5.4], [-7.4, 7.0], [-8.4, 9.5], [-8.6, 12], [-8.3, 14.2], [-7.5, 15.9]], 8)], 0.17), color: gap, depth: 0.12, wall: gap, metallic: 0, roughness: 0.8 });
  side({ name: "door handle", points: ellipse(-4.9, 13.1, 1.75, 0.55, 14), color: shade(paint, 0.78), depth: 0.14, wall: gap });
  side({ name: "fuel flap", points: stroke([...rrect(-27.6, 13.4, -25.2, 15.6, 0.5), [-27.6, 14.1]], 0.13), color: gap, depth: 0.08, wall: gap, metallic: 0, roughness: 0.8, only: "+x" });
  side({ name: "gill", points: stroke([[15.0, 9.9], [16.2, 5.3]], 0.28), color: DARK, depth: 0.25, wall: DARK });
  const lampSide = rounded([[36.3, 10.7], [35.6, 9.65], [34.4, 9.5], [32, 9.9], [29.5, 10.5], [27.2, 11.4, 1], [28.5, 12.0], [31, 12.25], [33.5, 12.15], [35.6, 11.6]], 1);
  cut({ view: "side", facing: 0.7, name: "headlight side", points: lampSide, color: "#232831", ...GLASS });
  cut({ view: "side", facing: 0.7, name: "headlight side light", points: stroke(path([[35.4, 10.5], [33, 10.6], [30, 11.1], [28.2, 11.6]], 6), 0.3), color: "#f4f7ff", emissive: 0.9 });
  const tailSide = rounded([[-29.3, 14.3, 1], [-32, 14.8], [-35.2, 14.75], [-36.5, 14.2], [-36.3, 12.9], [-34.5, 12.75], [-33, 13.45], [-31, 13.9]], 1);
  cut({ view: "side", facing: 0.7, name: "tail lamp side", points: tailSide, color: "#b01620", emissive: 0.45, metallic: 0.3, roughness: 0.15 });
  // --- from the front: the twin grille, lamps, intakes
  const front = (o) => cut({ view: "front", mirror: true, facing: 0.5, ...o });
  const kidney = rounded([[0.35, 5.2], [0.35, 10.1], [0.9, 10.65], [4.2, 10.7], [4.95, 10.2], [5.2, 9.0], [5.2, 6.3], [4.7, 5.1], [3.6, 4.45], [1.0, 4.4]], 1);
  front({ name: "grille frame", points: inset(kidney, -0.28), color: "#23262d", metallic: 0.8, roughness: 0.3 });
  front({ name: "grille", points: kidney, color: "#07080a", depth: 0.55, wall: "#17191e", metallic: 0, roughness: 0.9 });
  const lamp = rounded([[6.2, 10.1, 1], [8.0, 11.0], [10.5, 11.75], [13.2, 12.2], [14.6, 11.6], [14.4, 10.2], [13.4, 9.7], [11.5, 9.45], [8.5, 9.3], [6.8, 9.5]], 1);
  front({ name: "headlight", points: lamp, color: "#232831", ...GLASS, facing: 0.7 });
  for (const [x0, x1] of [[7.3, 9.6], [10.3, 12.9]]) front({ name: "daylight", points: stroke(path([[x0, 10.85 + (x0 - 7) * 0.12], [x0 + 0.2, 9.95], [x1 - 0.4, 9.95 + (x1 - x0) * 0.1], [x1, 11.2 + (x1 - 10) * 0.06]], 8), 0.3), color: "#f4f7ff", emissive: 0.95, facing: 0.7 });
  const intake = rounded([[5.6, 5.9], [9.0, 6.1], [9.9, 5.4], [8.6, 4.7], [6.8, 4.3], [4.5, 4.3]], 1);
  front({ name: "lower intake", points: intake, color: "#07080a", depth: 0.4, wall: "#15171b", metallic: 0, roughness: 0.9 });
  front({ name: "air curtain", points: rounded([[12.5, 8.0], [13.2, 7.7], [13.5, 6.0], [13.0, 4.7], [12.5, 5.1], [12.2, 6.5]], 1), color: "#0a0b0d", metallic: 0, roughness: 0.8, facing: 0.6 });
  front({ name: "bumper blade", points: stroke([[10.2, 6.1], [12.3, 6.3]], 0.22), color: DARK, depth: 0.1, facing: 0.3 });
  cut({ view: "front", facing: 0.25, name: "splitter", points: rect(-15, 1.5, 15, 3.75), color: "#15161a", metallic: 0, roughness: 0.7 });
  // --- from behind: lamps, the boot lid, the plate, the diffuser and tail pipes
  const back = (o) => cut({ view: "back", mirror: true, facing: 0.5, ...o });
  const tail = rounded([[4.4, 14.1, 1], [8, 14.5], [12.4, 14.9], [13.4, 14.6], [13.5, 13.2], [12.9, 12.6], [11.9, 12.9], [10.0, 13.5], [6.0, 13.4]], 1);
  back({ name: "tail lamp", points: tail, color: "#b01620", emissive: 0.45, metallic: 0.3, roughness: 0.15, facing: 0.7 });
  back({ name: "tail light bar", points: stroke(path([[5.2, 13.95], [8.5, 14.05], [11.6, 14.35], [12.8, 14.3], [12.9, 13.3]], 8), 0.26), color: "#ff3b30", emissive: 0.9, facing: 0.7 });
  cut({ view: "back", facing: 0.5, name: "boot gap", points: stroke(path([[-9.7, 16.3], [-9.6, 14], [-9.0, 12], [-8.0, 10.9], [-6.5, 10.4], [0, 10.3], [6.5, 10.4], [8.0, 10.9], [9.0, 12], [9.6, 14], [9.7, 16.3]], 20), 0.16), color: gap, depth: 0.12, wall: gap, metallic: 0, roughness: 0.8 });
  cut({ view: "back", facing: 0.5, name: "boot handle", points: rrect(-1.7, 12.5, 1.7, 13.1, 0.28), color: DARK, depth: 0.12 });
  cut({ view: "back", facing: 0.5, name: "plate recess", points: rrect(-4.3, 7.35, 4.3, 9.75, 0.3), color: shade(paint, 0.8), depth: 0.15, wall: shade(paint, 0.5) });
  cut({ view: "back", facing: 0.5, name: "plate", points: rect(-3.4, 7.7, 3.4, 9.4), color: "#ecece6", metallic: 0, roughness: 0.5 });
  cut({ view: "back", facing: 0.3, name: "diffuser", points: mirrorX([[0, 3.6], [12.7, 3.6], [13.0, 5.5], [12.0, 6.6], [0, 6.75]]), color: "#15161a", metallic: 0, roughness: 0.7 });
  back({ name: "tail pipe", points: ellipse(8.9, 5.15, 1.25, 1.25, 16), color: "#c4c9d2", ...CHROME, facing: 0.3 });
  back({ name: "tail pipe bore", points: ellipse(8.9, 5.15, 0.95, 0.95, 14), color: "#050506", depth: 0.9, wall: "#3b3e45", facing: 0.3, metallic: 0.4, roughness: 0.6 });
  back({ name: "rear vent", points: rounded([[11.9, 7.4], [12.6, 7.2], [12.7, 9.9], [12.0, 9.8]], 1), color: "#0a0b0d", metallic: 0, roughness: 0.8, facing: 0.62 });
  // --- from above: the windscreen, the rear glass, the bonnet and boot shut lines
  const top = (o) => cut({ view: "top", facing: 0.45, ...o });
  const screen = mirrorX([[0, 14.6], [4, 14.4], [8, 13.5], [10.9, 12.0, 1], [9.8, 8.6], [8.5, 5.7, 1], [5, 4.9], [0, 4.6]].map(([x, z, s]) => [x, z, s])), screenR = rounded(screen.map((p, i) => [p[0], p[1], [3, 5].includes(i < 8 ? i : 14 - i) ? 1 : 0]), 1);
  top({ name: "screen trim", points: inset(screenR, -0.4), color: TRIM, metallic: 0.1, roughness: 0.5 });
  top({ name: "windscreen", points: screenR, ...glassOf() });
  const rearG = rounded(mirrorX([[0, -17.0], [5, -17.1], [8.2, -17.6, 1], [8.9, -22], [9.3, -27.4, 1], [6, -29.0], [0, -29.4]]), 1);
  top({ name: "rear glass trim", points: inset(rearG, -0.35), color: TRIM, metallic: 0.1, roughness: 0.5 });
  top({ name: "rear glass", points: rearG, ...glassOf() });
  top({ name: "bonnet gap", mirror: true, points: stroke(path([[0, 37.3], [3.5, 37.2], [6.5, 36.2], [8.8, 34.7], [11.2, 30.5], [12.2, 25], [12.5, 20], [12.5, 15.6]], 16), 0.16), color: gap, depth: 0.1, wall: gap, metallic: 0, roughness: 0.8, facing: 0.62 });
  top({ name: "boot gap top", mirror: true, points: stroke(path([[0, -30.2], [7.5, -29.9], [9.7, -29.2], [10.1, -31.5], [10.0, -36.6]], 10), 0.16), color: gap, depth: 0.1, wall: gap, metallic: 0, roughness: 0.8, facing: 0.3 });
  body.modifiers.push({ type: "cutout", cuts: cuts.slice(0, 90) });

  const cubes = [body];
  // the grille's mesh, behind its frame
  for (const sx of [1, -1]) cubes.push(lattice(`grille mesh ${sx}`, kidney.map(([x, y]) => [sx * x, y]), at.front, 1, 0.4, 0.62, 0.11, "#2b2e35", { material: { metallic: 0.6, roughness: 0.4 } }));
  for (const sx of [1, -1]) cubes.push(lattice(`intake slats ${sx}`, intake.map(([x, y]) => [sx * x, y]), at.front, 1, 0.28, 0.42, 0.1, "#30333a", { straight: true }));
  // what is behind the openings: the wheel houses and a floor
  for (const [k, z] of wheelZ.entries()) for (const sx of [1, -1]) cubes.push(archLiner(`wheel house ${k} ${sx}`, arches[k].slice(1, -1), 14.2, track - 3.2, sx));
  cubes.push(box("floor", -11.5, 11.5, 3.0, 3.5, -30, 31, "#0b0c0e", { material: { metallic: 0, roughness: 1 } }));
  // door mirrors on a short foot
  for (const sx of [1, -1]) {
    const q = (pts) => pts.map(([x, y, z]) => [sx * x, y, z]);
    cubes.push(pebble(`mirror ${sx}`, q([[13.4, 14.95, 9.2], [16.7, 15.1, 9.7], [16.8, 17.5, 9.8], [13.6, 17.5, 9.3]]), q([[13.2, 15.0, 12.4], [16.3, 15.1, 13.1], [16.5, 17.2, 13.2], [13.4, 17.3, 12.5]]), paint, { material: PAINT, levels: 2 }));
    cubes.push(hexa(`mirror glass ${sx}`, q([[14.35, 15.7, 9.72], [15.85, 15.75, 9.96], [15.9, 16.8, 10.0], [14.4, 16.8, 9.78]]), q([[14.35, 15.7, 10.0], [15.85, 15.75, 10.24], [15.9, 16.8, 10.28], [14.4, 16.8, 10.06]]), "#aebfd0", { material: CHROME }));
    cubes.push(box(`mirror foot ${sx}`, Math.min(sx * 12.5, sx * 14.0), Math.max(sx * 12.5, sx * 14.0), 15.3, 15.85, 10.5, 12.0, DARK, { round: 0.12, segs: 1 }));
  }
  // wipers lying on the screen, the roof fin
  const onTop = (x, z, lift = 0.12) => [x, at.top(x, z) + lift, z];
  for (const [x0, z0, x1, z1] of [[1.2, 14.3, 9.2, 12.4], [-8.6, 13.1, -0.6, 14.4]]) cubes.push(bar("wiper", onTop(x0, z0), onTop(x1, z1), 0.42, 0.22, "#0b0c0e", { material: RUBBER }));
  { const y = at.top(0, -16.2); cubes.push(pebble("roof fin", [[-0.75, y - 0.1, -17.4], [0.75, y - 0.1, -17.4], [0.3, y + 1.05, -17.6], [-0.3, y + 1.05, -17.6]], [[-0.6, y - 0.05, -14.2], [0.6, y - 0.05, -14.2], [0.15, y + 0.2, -14.6], [-0.15, y + 0.2, -14.6]], DARK, { levels: 2 })); }
  const wheelOf = (sx) => wheel({ R, width: 3.9, rimR: 3.95, rim: "#c3c8d0", windows: spokeWindows(7, 1.45, 3.45, 0.42, 0.74), spokeDepth: 0.55, caliper: "#2b5fd0", hubR: 0.2, nuts: 5, nutAt: 1.55, dish: 0.3, cap: "#8f959f" }, sx);
  return { at, R, track, wheelZ, model: assemble({ cubes, pivot: R, wheelZ, track, wheelOf, R }), tail: { z: r2(-36.9 / 16), y: r2(13.8 / 16 - 0.06), x: r2(9.5 / 16 / 0.92) } };
}
void [STEEL, PLASTIC, lerp, mesh, mix, cyl, GLASS_COL, DARK, flare, fillet, RUBBER];
