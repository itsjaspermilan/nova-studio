// A mid-1990s Japanese sports coupe (4560 x 1730 x 1295 mm, wheelbase 2525, drawing build/blueprints/s14.png), made like car_gt: one smooth body from buildBody,
// everything cut into its skin with the Cut-out modifier, only mirrors, spoiler, wheels, wipers, exhausts as separate shapes. Units 1/16 m, z = 0 midway between the axles.
import { DARK, TRIM, CHROME, GLASS, PAINT, RUBBER, archLiner, archOutline, assemble, bar, box, buildBody, cyl, ellipse, glassOf, hexa, inset, mesh, lattice, mirrorX, path, pebble, r2, rect, rounded, rrect, shade, spokeWindows, stroke, wheel } from "../kit.mjs";

export function s14(paint = "#b5202c") {
  const gap = shade(paint, 0.22), R = 5.0, track = 11.8, wheelZ = [20.1, -20.1];
  const spec = {
    paint, h0: 0.8, h1: 3.2, midY: 9,
    w: [[-36.9, 9.5], [-36, 11.7], [-34, 12.6], [-32, 12.9], [-30, 13.1], [-28, 13.3], [-25, 13.6], [-20, 13.8], [-14, 13.8], [-8, 13.9], [0, 13.85], [10, 13.85], [14, 13.9], [20, 13.85], [25, 13.8], [28, 13.5], [30, 13.3], [31, 13.1], [32, 12.9], [33, 12.0], [34, 10.1], [35.5, 5]],
    yb: [[-36.9, 4.3], [-35, 4.2], [-32, 3.7], [-28, 3.3], [-24, 3.1], [-10, 3.1], [0, 3.0], [10, 3.1], [18, 3.2], [26, 3.3], [30, 3.3], [33, 3.3], [35.5, 4.0]],
    top: [[-34.0, 14.9], [-33, 14.95], [-31, 15.0], [-29, 15.05], [-27.5, 15.35], [-26, 15.95], [-24, 16.8], [-22, 17.55], [-20, 18.3], [-18, 19.0], [-16, 19.65], [-14.5, 20.1], [-12, 20.55], [-9, 20.85], [-5, 20.95], [-2, 20.85], [0, 20.6], [1, 20.3], [2, 19.95], [4, 19.15], [6, 18.35], [9, 16.9], [11, 16.0], [12, 15.5], [13, 15.0], [14, 14.7], [15, 14.5], [17, 14.35], [20, 14.1], [25, 13.1], [28, 12.65], [30, 12.4], [32, 11.85], [33, 11.4], [34, 10.9], [35.2, 10.2]],
    ys: [[-36, 13.6], [-34, 14.0], [-31, 14.2], [-28, 14.3], [-24, 14.4], [-14, 14.4], [0, 14.4], [8, 14.45], [13, 14.5], [15, 14.2], [18, 13.6], [22, 13.0], [26, 12.4], [30, 11.9], [33, 11.1], [35, 10.2]],
    rw: [[-26, 8.4], [-24, 9.4], [-22, 10.3], [-20, 10.4], [-17, 9.5], [-14, 8.7], [-8, 8.3], [-4, 8.3], [0, 8.6], [3, 9.1], [6, 9.7], [10, 10.4], [13, 10.8]],
    drop: [[-22, 1.6], [-16, 1.3], [-8, 1.0], [0, 0.9], [4, 1.0], [8, 1.2], [12, 1.2]],
    crown: [[-24, 0.5], [-14, 0.45], [0, 0.4], [6, 0.6], [12, 0.8]],
    ledge: 0.4, rail: 0.8, hoodP: 2.6,
    profile: [[0, 0.93], [0.1, 0.96], [0.3, 0.99], [0.5, 1.0], [0.75, 0.985], [0.9, 0.95], [1, 0.9]],
    rows: [0, 0.1, 0.25, 0.45, 0.65, 0.82, 0.93, 1],
    stations: [-30, -26, -20.1, -14, -10, -6, -2, 2, 6, 10, 13, 15, 18, 20.1, 24, 26.2, 30], maxGap: 3.0,
    front: { zc: 31, L: 10, plan: [[0, 36.0], [4.5, 35.9], [7.1, 35.0], [10.1, 34.0], [12, 33.0], [12.9, 32], [13.1, 31]], side: [[3.3, 33.8], [3.8, 34.8], [4.6, 35.5], [6, 35.9], [8, 36.0], [9.2, 35.9], [10.0, 35.5], [10.2, 35.2]], edgeBack: [[0, 0.75], [6, 0.8], [13.5, 0.3]], rimTop: 0.3 },
    rear: { zc: -32, L: 8, plan: [[0, -36.9], [5, -36.85], [8.5, -36.8], [10.5, -36.4], [11.7, -36], [12.3, -35], [12.6, -34]], side: [[4.3, -35.0], [5.5, -36.3], [6.5, -36.85], [9, -36.9], [10, -36.9], [11, -36.5], [12.2, -35.9], [13.4, -35.3], [14.2, -34.6], [14.9, -34.0]], edgeBack: [[0, 0.9], [12.6, 0.4]], rim: 0.15, rimTop: 0.5 },
    crease: { rows: { 1: 0.4, 8: 0.3 } },
  };
  const { body, at } = buildBody(spec);
  const cuts = [], cut = (c) => cuts.push(c);
  const side = (o) => cut({ view: "side", facing: 0.5, ...o });
  // --- from the side
  const arches = wheelZ.map((z) => archOutline(z, R - 0.05, 6.0));
  for (const points of arches) cut({ view: "side", points, remove: true, depth: 0.7, wall: shade(paint, 0.5), facing: -1, near: 9 });
  const dlo = rounded([[9.6, 14.5, 1], [8, 15.7], [6, 16.8], [4, 17.7], [2, 18.5], [0, 19.1], [-3, 19.6], [-6, 19.8], [-9, 19.7], [-12, 19.3], [-15, 18.3], [-17, 17.4], [-19, 16.0], [-20.2, 14.9], [-20.2, 14.5, 1]], 1);
  side({ name: "window trim", facing: 0.65, points: inset(dlo, -0.3), color: TRIM, metallic: 0.2, roughness: 0.4 });
  side({ name: "side glass", facing: 0.65, points: dlo, ...glassOf() });
  side({ name: "pillar", facing: 0.65, points: [[-8.9, 19.45], [-10.3, 19.4], [-9.7, 14.45], [-7.9, 14.45]], color: TRIM, metallic: 0.1, roughness: 0.5 });
  side({ name: "door gap", points: stroke([...path([[10.3, 14.4], [9.6, 12], [9.2, 9], [9.3, 6.5], [9.6, 5.0]], 8), ...path([[9.0, 4.85], [0, 4.9], [-5.8, 5.0]], 3), ...path([[-5.8, 5.2], [-7.6, 6.4], [-8.5, 9], [-8.5, 12], [-8.0, 14.0], [-7.7, 14.4]], 8)], 0.16), color: gap, depth: 0.12, wall: gap, metallic: 0, roughness: 0.8 });
  side({ name: "door handle", points: ellipse(-5.5, 12.2, 1.7, 0.45, 14), color: shade(paint, 0.78), depth: 0.14, wall: gap });
  side({ name: "repeater", points: ellipse(27.4, 8.0, 1.15, 0.36, 12), color: "#f59a1b", emissive: 0.3, metallic: 0.2, roughness: 0.2 });
  side({ name: "fuel flap", points: stroke([...rrect(-27.6, 11.6, -25.4, 13.6, 0.5), [-27.6, 12.3]], 0.12), color: gap, depth: 0.08, wall: gap, metallic: 0, roughness: 0.8, only: "+x" });
  side({ name: "sill line", points: stroke([[-5, 5.0], [8.5, 5.0]], 0.16), color: shade(paint, 0.6), depth: 0.06, wall: shade(paint, 0.5) });
  const lampSide = rounded([[35.7, 10.0, 1], [35.2, 10.8], [34, 11.2], [32, 11.3], [30.2, 11.0], [29.2, 10.3, 1], [30.5, 9.5], [33, 9.35], [35, 9.5]], 1);
  cut({ view: "side", facing: 0.45, name: "headlight side", points: lampSide, color: "#6b727c", metallic: 0.8, roughness: 0.25, depth: 0.25, wall: "#0d0f12" });
  const tailSide = rounded([[-32.0, 13.0, 1], [-34.0, 13.1], [-35.3, 12.7], [-35.5, 11.6], [-33.5, 11.3], [-32.2, 11.9]], 1);
  cut({ view: "side", facing: 0.7, name: "tail lamp side", points: tailSide, color: "#b01620", emissive: 0.45, metallic: 0.3, roughness: 0.15 });
  // --- from the front
  const front = (o) => cut({ view: "front", mirror: true, facing: 0.5, ...o });
  const lamp = rounded([[13.3, 10.0, 1], [13.0, 10.95], [12, 11.25], [9, 10.9], [5.4, 10.35], [4.6, 9.95, 1], [6, 9.5], [9, 9.4], [12, 9.4], [13.1, 9.6]], 1);
  front({ name: "headlight", points: lamp, color: "#6b727c", metallic: 0.8, roughness: 0.25, depth: 0.3, wall: "#0d0f12", facing: 0.4 });
  for (const [cx, cy, r] of [[7.5, 10.0, 0.55], [10.9, 10.2, 0.75]]) {
    front({ name: "projector ring", points: ellipse(cx, cy, r, r, 16), color: "#d5dae1", ...CHROME, facing: 0.4 });
    front({ name: "projector", points: ellipse(cx, cy, r * 0.72, r * 0.72, 14), color: "#080a0d", depth: 0.2, wall: "#1a1d23", facing: 0.4, metallic: 0.5, roughness: 0.2 });
    front({ name: "projector lens", points: ellipse(cx, cy, r * 0.3, r * 0.3, 10), color: "#eef3f8", emissive: 0.5, facing: 0.4 });
  }
  const pod1 = rrect(6.2, 6.6, 12.1, 8.2, 0.75), pod2 = rrect(6.0, 4.7, 12.0, 6.15, 0.7);
  front({ name: "fog pod", points: pod1, color: "#17181c", depth: 0.25, wall: "#0a0b0d", metallic: 0, roughness: 0.7 });
  front({ name: "fog lamp", points: rrect(7.5, 6.9, 11.3, 7.9, 0.45), color: "#f59a1b", emissive: 0.35, metallic: 0.2, roughness: 0.2, facing: 0.7 });
  front({ name: "lower pod", points: pod2, color: "#07080a", depth: 0.4, wall: "#15171b", metallic: 0, roughness: 0.9 });
  front({ name: "lower lip lamp", points: rrect(6.5, 3.8, 10.2, 4.4, 0.25), color: "#e6e9ee", emissive: 0.2, metallic: 0.3, roughness: 0.2, facing: 0.4 });
  const intake = rrect(-5.4, 3.9, 5.4, 6.0, 0.5);
  front({ name: "plate recess", mirror: false, points: rrect(-4.15, 6.6, 4.15, 8.4, 0.3), color: shade(paint, 0.8), depth: 0.15, wall: shade(paint, 0.5) });
  front({ name: "plate", mirror: false, points: rect(-3.7, 6.9, 3.7, 8.1), color: "#ecece6", metallic: 0, roughness: 0.5 });
  front({ name: "centre intake", mirror: false, points: intake, color: "#07080a", depth: 0.5, wall: "#15171b", metallic: 0, roughness: 0.9 });
  cut({ view: "front", facing: 0.25, name: "splitter", points: rect(-14, 2.0, 14, 3.7), color: "#15161a", metallic: 0, roughness: 0.7 });
  // --- from behind
  const back = (o) => cut({ view: "back", mirror: true, facing: 0.5, ...o });
  const lampsR = [[[2.95, 11.9], [2.95, 13.4], [4.5, 13.4], [4.5, 11.9]], [[4.85, 11.9], [4.85, 13.4], [9.8, 13.4], [9.8, 11.9]], [[10.15, 11.9], [10.15, 13.4], [12.2, 13.35], [12.2, 11.9]], [[12.5, 12.0], [12.4, 12.9], [12.9, 13.25], [13.3, 12.7], [13.3, 12.0]]];
  lampsR.forEach((pts, k) => back({ name: `tail lamp ${k}`, points: rounded(pts.map(([x, y]) => [x, y, 0]), 1), color: "#b01620", emissive: 0.45, metallic: 0.3, roughness: 0.15, facing: 0.6 }));
  back({ name: "reverse lamp", points: stroke([[5.7, 12.4], [8.6, 12.4]], 0.25), color: "#f2f4f8", emissive: 0.6, facing: 0.6 });
  back({ name: "reverse lamp 2", points: stroke([[5.7, 12.85], [8.6, 12.85]], 0.25), color: "#f2f4f8", emissive: 0.6, facing: 0.6 });
  cut({ view: "back", facing: 0.5, name: "garnish line", points: stroke([[-13, 11.65], [13, 11.65]], 0.15), color: gap, depth: 0.1, wall: gap, metallic: 0, roughness: 0.8 });
  cut({ view: "back", facing: 0.5, name: "bumper line", points: stroke([[-13.3, 9.65], [13.3, 9.65]], 0.15), color: gap, depth: 0.1, wall: gap, metallic: 0, roughness: 0.8 });
  cut({ view: "back", facing: 0.5, name: "plate recess", points: rrect(-4.3, 6.8, 4.3, 8.9, 0.3), color: shade(paint, 0.8), depth: 0.15, wall: shade(paint, 0.5) });
  cut({ view: "back", facing: 0.5, name: "plate", points: rect(-3.8, 7.1, 3.8, 8.6), color: "#ecece6", metallic: 0, roughness: 0.5 });
  back({ name: "reflector", points: rrect(5.5, 8.6, 8.7, 9.4, 0.3), color: "#b01620", emissive: 0.2, metallic: 0.2, roughness: 0.2, facing: 0.5 });
  cut({ view: "back", facing: 0.3, name: "diffuser", points: mirrorX([[0, 2.8], [9.5, 2.8], [10.2, 4.4], [11.6, 5.6], [0, 5.7]]), color: "#15161a", metallic: 0, roughness: 0.7 });
  // --- from above
  const top = (o) => cut({ view: "top", facing: 0.45, ...o });
  const screenR = rounded(mirrorX([[0, 12.9], [5, 12.8], [8.4, 12.2], [8.9, 8.5], [8.8, 4.5], [8.5, 1.5], [0, 1.1]]).map(([x, z]) => [x, z, 0]), 1);
  top({ name: "screen trim", points: inset(screenR, -0.4), color: TRIM, metallic: 0.1, roughness: 0.5 });
  top({ name: "windscreen", points: screenR, ...glassOf() });
  const rearG = rounded(mirrorX([[0, -15.8], [4, -15.9], [8.6, -16.1, 1], [9.9, -19], [10.7, -22, 1], [9.9, -25], [7, -26.8], [0, -27.4]]).map(([x, z]) => [x, z, 0]), 1);
  top({ name: "rear glass trim", points: inset(rearG, -0.35), color: TRIM, metallic: 0.1, roughness: 0.5 });
  top({ name: "rear glass", points: rearG, ...glassOf() });
  top({ name: "bonnet gap", mirror: true, points: stroke(path([[4.8, 35.2], [6.5, 31], [8.4, 25], [9.7, 20], [10.8, 15.2], [11.2, 13.8]], 12), 0.15), color: gap, depth: 0.1, wall: gap, metallic: 0, roughness: 0.8, facing: 0.62 });
  top({ name: "boot gap top", mirror: true, points: stroke(path([[0, -27.9], [7, -28.0], [10.0, -30.5], [10.4, -34], [10.0, -36.3]], 10), 0.15), color: gap, depth: 0.1, wall: gap, metallic: 0, roughness: 0.8, facing: 0.3 });
  body.modifiers.push({ type: "cutout", cuts });

  const cubes = [body];
  for (const sx of [1, -1]) {
    cubes.push(lattice(`intake slats ${sx}`, [[0.2, 3.9], [5.4, 3.9], [5.4, 6.0], [0.2, 6.0]].map(([x, y]) => [sx * x, y]), at.front, 1, 0.3, 0.5, 0.1, "#30333a", { straight: true }));
    cubes.push(lattice(`pod slats ${sx}`, rrect(6.0, 4.7, 12.0, 6.15, 0.7).map(([x, y]) => [sx * x, y]), at.front, 1, 0.3, 0.6, 0.1, "#30333a", { straight: true }));
  }
  for (const [k] of wheelZ.entries()) for (const sx of [1, -1]) cubes.push(archLiner(`wheel house ${k} ${sx}`, arches[k].slice(1, -1), 13.3, track - 3.2, sx));
  cubes.push(box("floor", -11, 11, 3.0, 3.5, -30, 31, "#0b0c0e", { material: { metallic: 0, roughness: 1 } }));
  // door mirrors
  for (const sx of [1, -1]) {
    const q = (pts) => pts.map(([x, y, z]) => [sx * x, y, z]);
    cubes.push(pebble(`mirror ${sx}`, q([[13.2, 14.5, 6.2], [16.3, 14.7, 6.6], [16.4, 17.0, 6.7], [13.4, 17.0, 6.3]]), q([[13.0, 14.6, 9.0], [16.0, 14.7, 9.5], [16.1, 16.9, 9.6], [13.2, 16.9, 9.1]]), paint, { material: PAINT, levels: 2 }));
    cubes.push(hexa(`mirror glass ${sx}`, q([[14.1, 15.2, 6.12], [15.6, 15.25, 6.3], [15.65, 16.5, 6.34], [14.15, 16.5, 6.16]]), q([[14.1, 15.2, 6.0], [15.6, 15.25, 6.18], [15.65, 16.5, 6.22], [14.15, 16.5, 6.04]]), "#aebfd0", { material: CHROME }));
    cubes.push(box(`mirror foot ${sx}`, Math.min(sx * 12.3, sx * 13.8), Math.max(sx * 12.3, sx * 13.8), 14.4, 14.95, 7.0, 8.6, DARK, { round: 0.12, segs: 1 }));
  }
  // wipers on the screen
  const onTop = (x, z, lift = 0.12) => [x, at.top(x, z) + lift, z];
  for (const [x0, z0, x1, z1] of [[1.2, 13.0, 9.0, 11.3], [-8.4, 11.6, -0.6, 13.0]]) cubes.push(bar("wiper", onTop(x0, z0), onTop(x1, z1), 0.42, 0.22, "#0b0c0e", { material: RUBBER }));
  // the boot's lip spoiler, a real separate piece on two feet
  { const y0 = (x, z) => at.top(x, z), zf = -32.8, zb = -36.2, hw = 9.4;
    { const n = 8, verts = [], loops = [], cr = [], row = (i) => { const x = -hw + (2 * hw * i) / n, cv = 0.35 * (1 - (x / hw) ** 2); return [[x, y0(x, zf) + 0.05 + cv * 0.6, zf], [x, y0(x, zb) + 0.55 + cv, zb], [x, y0(x, zb) + 0.1 + cv, zb], [x, y0(x, zf) + 0.0 + cv * 0.6, zf]]; };
      for (let i = 0; i <= n; i++) verts.push(...row(i));
      for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) { loops.push([i * 4 + k, i * 4 + (k + 1) % 4, (i + 1) * 4 + (k + 1) % 4, (i + 1) * 4 + k]); cr.push([i * 4 + k, (i + 1) * 4 + k, 0.5]); }
      loops.push([0, 1, 2, 3], [n * 4, n * 4 + 1, n * 4 + 2, n * 4 + 3]);
      for (let k = 0; k < 4; k++) { cr.push([k, (k + 1) % 4, 0.8], [n * 4 + k, n * 4 + (k + 1) % 4, 0.8]); }
      cubes.push(mesh("spoiler", verts, loops, paint, { material: PAINT, smooth: true, creases: cr, modifiers: [{ type: "subsurf", levels: 1, renderLevels: 2, smooth: true }] })); }
    for (const sx of [1, -1]) cubes.push(box(`spoiler foot ${sx}`, Math.min(sx * 6.4, sx * 7.4), Math.max(sx * 6.4, sx * 7.4), y0(6.9, -33) - 0.3, y0(6.9, -33) + 0.4, -35.2, -32.2, DARK, { round: 0.1, segs: 1 })); }
  // twin exhaust tips
  for (const x of [7.4, 5.7]) { cubes.push(cyl(`tail pipe ${x}`, x, 5.15, -36.1, 0.58, 2.0, "z", "#c4c9d2", { segments: 14, material: CHROME })); cubes.push(cyl(`tail pipe bore ${x}`, x, 5.15, -37.12, 0.4, 0.1, "z", "#050506", { segments: 12, material: { metallic: 0.4, roughness: 0.6 } })); }
  const wheelOf = (sx) => wheel({ R, width: 3.5, rimR: 3.65, rim: "#c3c8d0", windows: spokeWindows(5, 1.35, 3.3, 0.5, 0.78), spokeDepth: 0.5, caliper: "#c0262d", hubR: 0.2, nuts: 5, nutAt: 1.55, dish: 0.28, cap: "#8f959f" }, sx);
  return { at, R, track, wheelZ, model: assemble({ cubes, pivot: R, wheelZ, track, wheelOf, R }), tail: { z: r2(-36.9 / 16), y: r2(12.7 / 16 - 0.06), x: r2(8.0 / 16 / 0.92) } };
}

void [path];
