// `car_hatch`: a modern five-door hatchback (4460 x 1795 x 1440 mm, wheelbase 2725, track 1570/1580) modelled from build/blueprints/hatch.png with the
// kit's one smooth body and cut-outs, the way `gt()` is. Numbers read off the drawing with scripts/blueprint-trace (cal in hatch.trace.json). No badges or lettering.
import { CHROME, DARK, GLASS, PAINT, RUBBER, STEEL, TRIM, archLiner, archOutline, assemble, bar, box, buildBody, cyl, ellipse, glassOf, hexa, inset, lattice, mirrorX, path, pebble, r2, rect, rounded, rrect, shade, spokeWindows, stroke, wheel } from "../carkit.mjs";

function hatch(paint = "#8c1420") {
  const gap = shade(paint, 0.22), R = 5.65, track = 12.6, wheelZ = [20.9, -22.6];
  const spec = {
    paint, midY: 9.5,
    w: [[-30.5, 13.5], [-28.5, 14.1], [-26, 14.3], [-22, 14.4], [0, 14.4], [20, 14.4], [26, 14.3], [28.5, 13.8], [30.5, 13.2]],
    yb: [[-35.9, 5.9], [-34, 4.8], [-31, 4.0], [-28, 3.3], [-24, 2.8], [-10, 2.7], [10, 2.7], [18, 2.7], [24, 2.8], [29, 3.0], [32, 3.3], [34, 3.6], [35.9, 4.0]],
    top: [[-35.9, 15.4], [-34.5, 16.2], [-33.5, 17.5], [-32, 18.2], [-30, 18.9], [-28, 19.9], [-27, 20.6], [-26, 21.5], [-24, 21.9], [-20, 22.3], [-16, 22.7], [-12, 23.1], [-8, 23.1], [-4, 22.9], [0, 22.3], [2, 21.8], [4, 21.2], [6, 20.5], [8, 19.5], [10, 18.6], [12, 17.5], [14, 16.5], [16, 15.9], [18, 15.9], [20, 15.7], [22, 15.4], [24, 15.1], [26, 14.7], [28, 14.3], [30, 13.7], [32, 13.0], [34, 12.2], [35.2, 11.7], [35.9, 11.4]],
    ys: [[-35.9, 14.6], [-34, 15.0], [-30, 15.9], [-26, 16.6], [-22, 17.3], [-18, 17.4], [-14, 16.8], [-8, 16.1], [0, 15.9], [6, 15.8], [13, 15.5], [16, 15.0], [20, 14.5], [24, 13.9], [28, 13.1], [32, 12.1], [35.9, 11.2]],
    rw: [[-34, 7.3], [-30, 8.0], [-26, 8.7], [-21, 8.2], [-16, 8.8], [-8, 9.5], [0, 10.3], [4, 11.0], [8, 11.7], [10, 12.2], [13, 12.8], [16, 13.2]],
    drop: [[-30, 2.2], [-24, 2.8], [-16, 2.9], [-8, 3.0], [0, 3.1], [6, 2.8], [12, 2.0]],
    crown: [[-30, 0.6], [-20, 0.9], [-8, 1.0], [0, 0.9], [6, 0.8], [12, 0.5]],
    ledge: 0.5, rail: 0.9, hoodP: 2.4, h0: 0.8, h1: 3.0,
    profile: [[0, 0.88], [0.1, 0.93], [0.2, 0.965], [0.45, 1.0], [0.62, 1.0], [0.8, 0.985], [0.9, 0.97], [1, 0.95]],
    rows: [0, 0.1, 0.25, 0.45, 0.65, 0.82, 0.93, 1],
    stations: [-26, -22.6, -18, -13, -8, -4, 0, 4, 8, 12, 15, 18, 20.9, 24], maxGap: 3.2,
    front: { zc: 28.5, L: 10, plan: [[0, 35.9], [2.9, 35.7], [5.5, 35.2], [8.1, 34.5], [10, 33.5], [11.5, 32.5], [12.5, 31.5], [13.2, 30.5], [13.8, 28.5]], side: [[3.4, 33.6], [4.0, 34.9], [4.8, 34.6], [6, 35.4], [7.5, 35.8], [10, 35.9], [11.2, 35.6]], edgeBack: [[0, 0.8], [6, 0.9], [13.5, 0.4]], rimTop: 0.3 },
    rear: { zc: -28.5, L: 8, plan: [[0, -36.0], [5.1, -35.8], [9.1, -34.6], [11, -33.6], [12.2, -32.5], [12.9, -31.5], [13.5, -30.5], [14.1, -28.5]], side: [[4.5, -33.2], [5.5, -35.0], [6.5, -35.7], [8, -35.9], [10, -35.9], [11, -35.5], [12, -34.5], [14, -34.1], [16.2, -33.9]], edgeBack: [[0, 1.7], [6, 1.4], [9, 0.7], [14, 0.3]], rim: 0.15, rimTop: 0.4 },
    crease: { rows: { 1: 0.3, 8: 0.25 } },
  };
  const { body, at } = buildBody(spec);
  const cuts = [], cut = (c) => cuts.push(c);
  const side = (o) => cut({ view: "side", facing: 0.5, ...o });
  // --- from the side
  const arches = [[21.2, 6.65], [-23.2, 6.65]].map(([z, r]) => archOutline(z, R - 0.1, r, 24, -1));
  for (const points of arches) cut({ view: "side", points, remove: true, depth: 0.7, wall: shade(paint, 0.5), facing: -1, near: 9 });
  const dloF = rounded([[11.4, 16.3, 1], [8.1, 18.4], [4.9, 19.7], [1, 20.6], [-2, 21.0], [-4.7, 21.05, 1], [-3.6, 16.15, 1], [0, 16.05], [6, 16.05]], 1);
  const dloR = rounded([[-7.6, 21.0, 1], [-12, 20.75], [-16, 20.2], [-17.6, 19.7], [-18.7, 19.1, 1], [-17.6, 18.2], [-16, 17.0], [-12, 16.2], [-7.4, 15.95, 1]], 1);
  for (const [nm, g] of [["front", dloF], ["rear", dloR]]) {
    side({ name: `${nm} window trim`, points: inset(g, -0.3), color: TRIM, metallic: 0.2, roughness: 0.4, ...(nm === "rear" ? { facing: 0.4 } : {}) });
    side({ name: `${nm} side glass`, points: g, ...glassOf(), ...(nm === "rear" ? { facing: 0.4 } : {}) });
  }
  side({ name: "door gap", points: stroke([...path([[12.2, 16.0], [13.0, 14.8], [13.2, 11], [13.0, 6.5], [12.6, 4.9]], 8), ...path([[12.6, 4.9], [5, 4.75], [-3.9, 5.0]], 3), ...path([[-3.9, 5.0], [-5.3, 13], [-6.7, 21.2]], 4)], 0.17), color: gap, depth: 0.12, wall: gap, metallic: 0, roughness: 0.8 });
  side({ name: "rear door gap", points: stroke([...path([[-19.4, 19.0], [-20.5, 16.5], [-19.5, 12], [-17.5, 9], [-16.0, 7], [-15.3, 4.9]], 8), ...path([[-15.3, 4.9], [-10, 4.85], [-3.9, 5.0]], 3)], 0.17), color: gap, depth: 0.12, wall: gap, metallic: 0, roughness: 0.8 });
  side({ name: "door handle", points: ellipse(-2.0, 13.25, 2.0, 0.5, 14), color: shade(paint, 0.78), depth: 0.14, wall: gap });
  side({ name: "rear door handle", points: ellipse(-16.7, 13.25, 2.0, 0.5, 14), color: shade(paint, 0.78), depth: 0.14, wall: gap });
  side({ name: "fuel flap", points: stroke(ellipse(-23.3, 14.7, 1.4, 1.4, 20).concat([[-21.9, 14.7]]), 0.13), color: gap, depth: 0.08, wall: gap, metallic: 0, roughness: 0.8, only: "+x" });
  side({ name: "side swage", points: stroke(path([[12, 12.2], [4, 11.6], [-8, 11.4], [-14, 11.2]], 6), 0.14), color: shade(paint, 0.7), depth: 0.05, wall: shade(paint, 0.5), facing: 0.7 });
  const lampSide = rounded([[35.3, 11.2], [34, 10.6], [31.5, 10.8], [28.5, 11.5], [26.3, 12.2, 1], [28, 12.35], [31, 12.15], [34, 11.85]], 1);
  cut({ view: "side", facing: 0.7, name: "headlight side", points: lampSide, color: "#232831", ...GLASS });
  const tailSide = rounded([[-27.7, 15.5, 1], [-29, 15.85], [-31, 16.1], [-33, 16.2], [-34.3, 15.8], [-34.4, 14.9], [-33.2, 14.6], [-31.5, 14.9], [-29.5, 15.2]], 1);
  cut({ view: "side", facing: 0.7, name: "tail lamp side", points: tailSide, color: "#b01620", emissive: 0.45, metallic: 0.3, roughness: 0.15 });
  // --- from the front: the wide mesh grille, slim lamps, the lower slot
  const front = (o) => cut({ view: "front", mirror: true, facing: 0.5, ...o });
  const grille = mirrorX([[0, 11.25], [5.2, 11.1], [7.3, 10.4], [8.5, 9.8], [8.3, 9.0], [6.8, 7.6], [4.6, 6.3], [2, 5.75], [0, 5.7]]);
  const grilleR = rounded(grille.map(([x, y], i) => [x, y, i === 0 || x === 0 ? 1 : 0]), 1);
  cut({ view: "front", facing: 0.5, name: "grille frame", points: inset(grilleR, -0.3), color: "#23262d", metallic: 0.8, roughness: 0.3 });
  cut({ view: "front", facing: 0.5, name: "grille", points: grilleR, color: "#07080a", depth: 0.55, wall: "#17191e", metallic: 0, roughness: 0.9 });
  const lamp = rounded([[7.8, 10.85], [9.2, 11.25], [11.0, 11.85], [13.0, 12.25], [13.7, 12.15], [13.8, 11.6], [12.9, 10.8], [11.5, 10.25], [9.8, 10.0], [8.6, 10.2]], 1);
  front({ name: "headlight", points: lamp, color: "#232831", ...GLASS, facing: 0.7 });
  front({ name: "headlight lens", points: ellipse(10.5, 10.95, 0.62, 0.62, 14), color: "#dfe6f2", emissive: 0.35, facing: 0.7 });
  front({ name: "headlight light", points: stroke(path([[8.4, 10.55], [10.5, 10.4], [12.5, 10.95]], 6), 0.22), color: "#f4f7ff", emissive: 0.9, facing: 0.7 });
  front({ name: "lower slot", points: rrect(1.0, 4.3, 9.4, 4.95, 0.2), color: "#07080a", depth: 0.35, wall: "#15171b", metallic: 0, roughness: 0.9 });
  cut({ view: "front", facing: 0.5, name: "lower slot middle", points: rrect(-1.0, 4.3, 1.0, 4.95, 0.2), color: "#07080a", depth: 0.35, wall: "#15171b", metallic: 0, roughness: 0.9 });
  front({ name: "cheek vent", points: rounded([[11.3, 7.2], [13.6, 6.8], [13.2, 6.3], [11.2, 6.6]], 1), color: "#0a0b0d", metallic: 0, roughness: 0.8, facing: 0.6 });
  // --- from behind: tail lamps, the hatch, the plate, the diffuser and pipe pockets
  const back = (o) => cut({ view: "back", mirror: true, facing: 0.5, ...o });
  const tail = rounded([[5.1, 15.6], [6.4, 16.0], [9.0, 16.2], [11.6, 16.2], [12.3, 15.7], [12.2, 14.9], [11.3, 14.1], [9.6, 13.95], [7.8, 14.4], [6.2, 14.6]], 1);
  back({ name: "tail lamp", points: tail, color: "#b01620", emissive: 0.45, metallic: 0.3, roughness: 0.15, facing: 0.7 });
  for (const x of [8.0, 10.4]) { back({ name: "tail ring", points: ellipse(x, 15.2, 0.95, 0.95, 16), color: "#3a0a0e", metallic: 0.5, roughness: 0.2, facing: 0.7 }); back({ name: "tail lens", points: ellipse(x, 15.2, 0.68, 0.68, 14), color: "#ff3b30", emissive: 0.9, facing: 0.7 }); }
  back({ name: "reverse", points: rrect(5.9, 14.95, 6.9, 15.45, 0.1), color: "#eceff2", emissive: 0.5, facing: 0.7 });
  cut({ view: "back", facing: 0.4, name: "hatch gap", points: stroke(path([[-9.9, 17.0], [-9.8, 15], [-9.5, 13], [-8.7, 11.9], [-7.5, 11.5], [0, 11.5], [7.5, 11.5], [8.7, 11.9], [9.5, 13], [9.8, 15], [9.9, 17.0]], 20), 0.16), color: gap, depth: 0.12, wall: gap, metallic: 0, roughness: 0.8 });
  cut({ view: "back", facing: 0.5, name: "plate recess", points: rrect(-3.0, 6.7, 3.0, 9.75, 0.3), color: shade(paint, 0.8), depth: 0.15, wall: shade(paint, 0.5) });
  cut({ view: "back", facing: 0.5, name: "plate", points: rect(-2.65, 6.95, 2.65, 9.5), color: "#ecece6", metallic: 0, roughness: 0.5 });
  back({ name: "reflector", points: ellipse(7.6, 7.45, 0.5, 0.5, 12), color: "#b01620", emissive: 0.3, facing: 0.5 });
  back({ name: "rear marker", points: rrect(9.0, 6.9, 12.0, 7.9, 0.25), color: "#b01620", emissive: 0.3, facing: 0.5 });
  back({ name: "pipe pocket", points: ellipse(9.15, 4.9, 1.45, 1.45, 18), color: "#0a0b0d", depth: 0.6, wall: "#15161a", metallic: 0, roughness: 0.8, facing: 0.3 });
  cut({ view: "back", facing: 0.3, name: "diffuser", points: mirrorX([[0, 3.6], [12.6, 3.6], [12.8, 5.2], [0, 5.3]]), color: "#15161a", metallic: 0, roughness: 0.7 });
  // --- from above: the windscreen, the tailgate glass, bonnet and roof lines
  const top = (o) => cut({ view: "top", facing: 0.45, ...o });
  const screen = rounded(mirrorX([[0, 15.7], [5, 15.2], [9, 14.2], [11.4, 12.6], [10.9, 8.0], [10.1, 3.8], [9.0, 1.5], [0, 1.0]]).map(([x, z], i, a) => [x, z, x === 0 ? 1 : 0]), 1);
  top({ name: "screen trim", points: inset(screen, -0.35), color: TRIM, metallic: 0.1, roughness: 0.5 });
  top({ name: "windscreen", points: screen, ...glassOf() });
  const rearG = rounded(mirrorX([[0, -27.5], [5, -27.5], [8.2, -28.2], [9.2, -30.5], [9.1, -32.2], [8.0, -33.5], [0, -33.8]]).map(([x, z]) => [x, z, x === 0 ? 1 : 0]), 1);
  top({ name: "rear glass trim", points: inset(rearG, -0.35), color: TRIM, metallic: 0.1, roughness: 0.5, facing: 0.5 });
  top({ name: "rear glass", points: rearG, ...glassOf(), facing: 0.5 });
  top({ name: "bonnet gap", mirror: true, points: stroke(path([[0, 35.2], [4, 35.0], [7, 34.0], [10.5, 31.5], [12.4, 27], [12.8, 22], [12.6, 16.4]], 16), 0.16), color: gap, depth: 0.1, wall: gap, metallic: 0, roughness: 0.8, facing: 0.62 });
  top({ name: "roof rail", mirror: true, points: stroke(path([[9.9, 4.5], [9.5, -8], [8.8, -17], [8.3, -21]], 8), 0.15), color: gap, depth: 0.08, wall: gap, metallic: 0, roughness: 0.8, facing: 0.8 });
  body.modifiers.push({ type: "cutout", cuts: cuts.slice(0, 100) });

  const cubes = [body];
  cubes.push(lattice("grille mesh", grilleR, at.front, 1, 0.45, 0.6, 0.11, "#2b2e35", { material: { metallic: 0.6, roughness: 0.4 } }));
  for (const [k] of wheelZ.entries()) for (const sx of [1, -1]) cubes.push(archLiner(`wheel house ${k} ${sx}`, arches[k].slice(1, -1), 14.2, track - 3.2, sx));
  cubes.push(box("floor", -11.5, 11.5, 3.0, 3.5, -29, 30, "#0b0c0e", { material: { metallic: 0, roughness: 1 } }));
  { const zp = at.front(0, 7.1) - 0.1; cubes.push(box("front plate", -2.6, 2.6, 5.9, 8.35, zp - 0.3, zp, "#ecece6", { round: 0.08, segs: 1, material: { metallic: 0, roughness: 0.5 } })); }
  // twin exhaust tips
  for (const sx of [1, -1]) {
    cubes.push(cyl(`tail pipe ${sx}`, sx * 9.15, 4.9, -33.3, 0.85, 1.4, "z", "#c4c9d2", { segments: 16, material: CHROME }));
    cubes.push(cyl(`tail pipe bore ${sx}`, sx * 9.15, 4.9, -34.0, 0.6, 0.08, "z", "#050506", { segments: 14 }));
  }
  // door mirrors on a short foot
  for (const sx of [1, -1]) {
    const q = (pts) => pts.map(([x, y, z]) => [sx * x, y, z]);
    cubes.push(pebble(`mirror ${sx}`, q([[13.6, 15.3, 5.8], [16.8, 15.6, 6.2], [16.9, 18.2, 6.3], [13.8, 18.2, 5.9]]), q([[13.4, 15.4, 9.8], [16.4, 15.6, 10.0], [16.5, 18.0, 10.0], [13.6, 18.0, 9.9]]), paint, { material: PAINT, levels: 2 }));
    cubes.push(box(`mirror foot ${sx}`, Math.min(sx * 12.6, sx * 14.0), Math.max(sx * 12.6, sx * 14.0), 15.3, 15.9, 7.0, 9.2, DARK, { round: 0.12, segs: 1 }));
  }
  // wipers lying on the screen, the tailgate wiper
  const onTop = (x, z, lift = 0.12) => [x, at.top(x, z) + lift, z];
  for (const [x0, z0, x1, z1] of [[1.0, 15.0, 9.0, 13.2], [-7.6, 13.4, -0.6, 15.0]]) cubes.push(bar("wiper", onTop(x0, z0), onTop(x1, z1), 0.4, 0.2, "#0b0c0e", { material: RUBBER }));
  cubes.push(bar("rear wiper", onTop(-1.6, -32.3), onTop(-8.2, -31.8), 0.4, 0.2, "#0b0c0e", { material: RUBBER }, [0, 0.8, -0.6]));
  const wheelOf = (sx) => wheel({ R, width: 3.6, rimR: 4.15, rim: "#c3c8d0", windows: spokeWindows(10, 1.55, 3.7, 0.5, 0.78), spokeDepth: 0.5, caliper: "#b8232c", hubR: 0.2, nuts: 5, nutAt: 1.55, dish: 0.3, cap: "#8f959f" }, sx);
  return { model: assemble({ cubes, pivot: R, wheelZ, track, wheelOf, R }), tail: { z: r2(-34.2 / 16), y: r2(15.2 / 16), x: r2(9.2 / 16) } };
}

export const CARS = {
  car_hatch: () => hatch(), car_hatch_white: () => hatch("#e4e6e8"), car_hatch_blue: () => hatch("#1f4f9c"), car_hatch_grey: () => hatch("#4a4f58"),
};
void [GLASS, STEEL, rrect];
