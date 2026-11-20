// The cars modelled from the owner's blueprints with carkit.mjs (2026-11-19): `car_gt`, a modern coupe (4768 x 1852 x 1383 mm, wheelbase 2851), and
// `car_offroad`, a short 4x4 wagon (4060 x 1690 x 1885 mm, wheelbase 2310). Every number below was read off the drawings (side, plan, front and rear views,
// each calibrated to its own dimension lines). No badges or lettering. Run:  scripts/env.sh node scripts/rally/blueprint-cars.mjs [car_gt] [car_offroad]
import { readdirSync } from "node:fs";
import { withServer } from "./mcp.mjs";
import { DARK, GLASS_COL, TRIM, archOutline, flare, glassOf, mirrorX, CHROME, GLASS, PAINT, PLASTIC, RUBBER, STEEL, archLiner, assemble, bar, box, buildBody, cyl, ellipse, fillet, hexa, inset, lattice, lerp, mesh, mix, path, pebble, r2, rect, rounded, rrect, shade, spokeWindows, stroke, wheel } from "./carkit.mjs";


// ================================ the coupe ================================================================================================
function gt(paint = "#1f57b8") {
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
  return { model: assemble({ cubes, pivot: R, wheelZ, track, wheelOf, R }), tail: { z: r2(-36.9 / 16), y: r2(13.8 / 16 - 0.06), x: r2(9.5 / 16 / 0.92) } };
}

// ================================ the 4x4 ==================================================================================================

function offroad(paint = "#d2bb8c") {
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
  return { model, tail: { z: r2(-29.5 / 16), y: r2(13.9 / 16 - 0.06), x: r2(12.4 / 16 / 0.92) } };
}

// Each car in its paints: the first is the one the player drives, the rest are what the rivals wear (lib/state.lua, `paints`).
export const CARS = {
  car_gt: () => gt(), car_gt_red: () => gt("#a81f2a"), car_gt_white: () => gt("#dfe2e6"), car_gt_grey: () => gt("#41454d"),
  car_offroad: () => offroad(), car_offroad_green: () => offroad("#5d6b48"), car_offroad_white: () => offroad("#e2dfd3"), car_offroad_red: () => offroad("#9c3229"),
};
// Every other car has a file of its own in cars/ that exports its `CARS` (name -> maker), so cars can be worked on side by side.
for (const f of readdirSync(new URL("./cars/", import.meta.url)).filter((f) => f.endsWith(".mjs")).sort()) {
  try { Object.assign(CARS, (await import(`./cars/${f}`)).CARS); } catch (e) { console.error(`cars/${f} does not load: ${e.message}`); }
}
const want = process.argv.slice(2).filter((a) => !a.startsWith("-"));
if (process.argv[1] && process.argv[1].endsWith("blueprint-cars.mjs")) await withServer(async (nova) => {
  for (const [name, make] of Object.entries(CARS)) {
    if (want.length && !want.includes(name)) continue;
    const { model, tail } = make();
    console.log(await nova.call("model_write", { name, model }));
    console.log(`TAIL ${name} = { z = ${tail.z}, y = ${tail.y}, x = ${tail.x} }`);
  }
});
void [STEEL, PLASTIC, lerp, mesh, mix, cyl, GLASS_COL];
