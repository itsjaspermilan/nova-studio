// `car_gt2`: a low mid-engined GT race car (about 4.63 x 2.07 x 1.12 m, wheelbase 2.85 m), traced from build/blueprints/gt2.png (calibration in gt2.trace.json).
// One smooth body from carkit's buildBody; the one-piece canopy, lamps, intakes, louvres, vents and wheel openings are cut-outs; the splitter, wing on its
// swan necks, diffuser fins, mirrors, wiper and wheels are separate pieces. No lettering, numbers or badges.
import { DARK, TRIM, archOutline, glassOf, mirrorX, CHROME, GLASS, PAINT, PLASTIC, RUBBER, archLiner, assemble, bar, box, buildBody, ellipse, hexa, inset, lattice, path, pebble, r2, rounded, rrect, shade, curve, mesh, smoothstep, spokeWindows, stroke, wheel, loft } from "../kit.mjs";

const CARBON = "#14151a", MATT = { metallic: 0, roughness: 0.85 };

/// Makes the smooth cage faceted where the drawing has knife lines (the cage's points are moved after buildBody; station i holds 9 flank points, then 8 top columns):
/// a ridge along each front wing, a valley between each rear haunch and the engine cover, a scooped channel along the flank into the side intake.
function facet(body, zs) {
  const V = body.verts, STRIDE = 17, S = (i, r) => i * STRIDE + r, T = (i, c) => (c === 0 ? S(i, 8) : i * STRIDE + 8 + c), N = zs.length;
  const ss = (t) => { const u = Math.max(0, Math.min(1, t)); return u * u * (3 - 2 * u); };
  const scoop = curve([[-19.5, 0], [-18, 0.5], [-15, 2.3], [-12, 2.3], [-9, 2.0], [-6, 1.7], [-3, 1.4], [0, 1.1], [3, 0.8], [6, 0.5], [9, 0.25], [12, 0]]), rowW = [0, 0, 0, 0.4, 0.95, 1, 0.55, 0.08, 0];
  for (let i = 0; i < N; i++) {
    const z = zs[i];
    // the wing ridge: the outer columns stay up at the shoulder's height, the bonnet drops away inside them
    const kr = ss((z - 17) / 4) * (i === N - 1 ? 0.35 : 1);
    if (kr > 0) { const lift = [0, 0.3, 0.6, -0.15, -0.05, -0.5, -0.5, -0.35, -0.3]; for (let c = 1; c <= 8; c++) V[T(i, c)][1] = r2(V[T(i, c)][1] + lift[c] * kr); }
    // the valley between the haunch and the spine
    const kv = ss((-13 - z) / 6) * (i === 0 ? 0.25 : z < -26 ? 0.8 : 1) * 1.7;
    if (kv > 0) for (let c = 1; c <= 8; c++) { const x = V[T(i, c)][0], b = Math.max(0, 1 - ((x - 9.6) / 3.6) ** 2); V[T(i, c)][1] = r2(V[T(i, c)][1] - kv * b); }
    // the channel along the flank
    const kc = scoop(z);
    if (kc > 0) for (let r = 1; r <= 8; r++) V[S(i, r)][0] = r2(V[S(i, r)][0] - kc * rowW[r]);
  }
  for (let i = 0; i < N - 1; i++) {
    const z = (zs[i] + zs[i + 1]) / 2;
    if (z > 18) body.creases.push([T(i, 2), T(i + 1, 2), 1], [T(i, 3), T(i + 1, 3), 0.55], [T(i, 6), T(i + 1, 6), 0.45]);
    if (z < -14) body.creases.push([T(i, 2), T(i + 1, 2), 0.6], [T(i, 6), T(i + 1, 6), 0.5]);
    if (z > -19 && z < 10) body.creases.push([S(i, 7), S(i + 1, 7), 0.6], [S(i, 3), S(i + 1, 3), 0.4]);
  }
}

export function gt2(paint = "#e6e8ea") {
  const gap = shade(paint, 0.25), R = 5.5, track = 13.5, wheelZ = [21.6, -24.0];
  const spec = {
    paint, midY: 7,
    w: [[-36.6, 6], [-36.2, 10.5], [-35.3, 12.5], [-34, 14], [-32, 15.5], [-30, 16.0], [-28, 16.3], [-25, 16.6], [-20, 16.6], [-15, 16.3], [-10, 16.2], [-5, 16.0], [0, 15.9], [5, 15.7], [10, 15.8], [14, 16.0], [17, 16.2], [20, 16.4], [23, 16.5], [25, 16.4], [27, 16.1], [29, 15.7], [31, 15], [33, 14], [34.4, 12], [35.3, 10], [36.3, 7.3], [37.0, 5], [37.7, 0.5]],
    yb: [[-36.6, 3.2], [-33, 2.6], [-30, 2.2], [-27, 1.6], [-18, 1.3], [0, 1.2], [15, 1.2], [27, 1.4], [31, 1.6], [34, 1.8], [37.7, 2.0]],
    ys: [[-36.6, 11.4], [-35.5, 11.6], [-32, 12.3], [-28, 13.2], [-24, 13.8], [-20, 13.8], [-15, 13.0], [-10, 12.1], [-5, 11.4], [0, 10.9], [5, 10.5], [10, 10.4], [14, 10.6], [17, 11.3], [19.5, 12.0], [22, 12.25], [24, 11.9], [26, 10.8], [28, 9.75], [30, 8.9], [32, 8.0], [34, 7.2], [36, 6.5], [37.7, 5.95]],
    top: [[37.7, 5.9], [36, 6.2], [34, 6.7], [32, 7.3], [30, 8.0], [28, 8.7], [25, 9.6], [22, 10.6], [20.5, 11.3], [19.5, 11.9], [18, 13.0], [16, 14.1], [14, 15.1], [12, 15.9], [10, 16.6], [8, 17.1], [6, 17.45], [4, 17.7], [2, 17.85], [0, 17.9], [-2, 17.75], [-4, 17.5], [-5, 17.3], [-8, 16.6], [-10, 16.2], [-12, 15.7], [-15, 15.1], [-18, 14.4], [-20, 14.0], [-22, 13.8], [-26, 13.4], [-30, 12.5], [-33, 11.6], [-36.6, 10.6]],
    rw: [[-25, 4.5], [-20, 5], [-15, 5.5], [-10, 6.0], [-5, 6.2], [0, 6.0], [5, 5.8], [8, 5.4], [10, 4.9], [12, 4.2], [14, 3.4], [16, 2.6], [18, 1.6], [20, 0.8]],
    ledge: [[-22, 9], [-20, 8.4], [-15, 7.1], [-10, 4.6], [-5, 2.6], [0, 2.8], [4, 2.7], [7, 3.5], [10, 4.7], [12, 6.1], [14, 7.3], [16, 8.8], [18, 11], [20, 13.5]],
    drop: [[-20, 1.2], [-10, 1.4], [0, 1.5], [8, 1.6], [14, 1.5], [18, 1.0]],
    crown: [[-20, 0.4], [-5, 0.45], [2, 0.5], [8, 0.7], [14, 0.8], [18, 0.5]],
    rail: 1.0, hoodP: 2.2,
    profile: [[0, 0.94], [0.15, 0.975], [0.4, 1.0], [0.75, 1.0], [0.9, 0.985], [1, 0.93]],
    rows: [0, 0.1, 0.25, 0.45, 0.65, 0.82, 0.93, 1],
    stations: [-27, -24, -21, -18, -15, -12, -9, -6, -3, 0, 3, 6, 9, 12, 15, 18, 20.5, 22.5, 24.5], maxGap: 3.0,
    front: { zc: 27, L: 8, plan: [[0, 37.7], [2.5, 37.35], [5, 37.0], [7.3, 36.2], [10, 35.3], [12, 34.4], [14, 33], [15, 31], [15.7, 29], [16.1, 27]], side: [[2, 33.6], [4.2, 34.4], [5.1, 35.4], [5.55, 37.2], [5.9, 37.7]], edgeBack: [[0, 0.3], [16, 0.2]], rim: 0.9, rimTop: 0.95 },
    rear: { zc: -30, L: 8, plan: [[0, -36.6], [6, -36.6], [10.5, -36.2], [12.5, -35.3], [14, -34], [15.5, -32], [16, -30]], side: [[3, -33.4], [5, -34.2], [7, -35], [9, -35.8], [10.5, -36.4], [11.6, -36.6]], edgeBack: [[0, 0.3], [16, 0.2]], rim: 0.6, rimTop: 0.8 },
    crease: { rows: { 1: 0.6, 8: 0.85 } },
  };
  const { body, at, zs } = buildBody(spec);
  facet(body, zs);
  const cuts = [], cut = (c) => cuts.push(c);
  const dark = (o) => ({ color: "#07080a", depth: 0.5, wall: "#15171b", ...MATT, ...o });
  const side = (o) => cut({ view: "side", facing: 0.5, ...o });
  // --- from the side: wheel openings, the dark sill, the intake ahead of the rear wheel, the vent behind the front wheel
  const arches = [archOutline(wheelZ[0], R - 0.1, 5.75), archOutline(wheelZ[1], R - 0.1, 6.3)];
  for (const points of arches) cut({ view: "side", points, remove: true, depth: 0.7, wall: shade(paint, 0.4), facing: -1, near: 12.6 });
  side({ name: "sill", points: [[15.6, 0], [13.2, 3.2], [5, 3.6], [-5, 3.9], [-12, 3.2], [-17.6, 2.2], [-17.6, 0]], color: CARBON, ...MATT, facing: 0.3 });
  side({ name: "side intake", points: rounded([[-9.5, 10.0], [-17.2, 10.9, 1], [-18.2, 9.0], [-16.4, 5.6], [-13.6, 6.2]], 1), ...dark({ depth: 0.8 }), facing: 0.12 });
  side({ name: "arch vent", points: rounded([[15.3, 9.0, 1], [10.4, 10.6, 1], [11.3, 9.2], [13.5, 8.6]], 1), ...dark({ depth: 0.3 }) });
  side({ name: "pod gap", points: stroke(path([[12.3, 9.0], [9, 6.2], [5.6, 3.5]], 6), 0.16), color: gap, depth: 0.1, wall: gap, ...MATT });
  // --- from above: the one-piece canopy, the lamps on the sloping nose, the engine cover's louvres
  const top = (o) => cut({ view: "top", facing: 0.45, ...o });
  const canopy = rounded(mirrorX([[0, 19.6], [3.5, 18.2], [5.5, 16.3], [7, 14.2], [8.2, 12], [9.4, 10], [10.6, 7], [11.2, 4], [11.3, 1], [10.8, -0.6], [9.2, -2.6], [7.6, -4.5, 1], [0, -4.7]]), 1);
  top({ name: "canopy trim", points: inset(canopy, -0.3), color: TRIM, metallic: 0.1, roughness: 0.5, facing: 0.25 });
  top({ name: "canopy", points: canopy, ...glassOf(), facing: 0.25 });
  const lamp = rounded([[13.7, 26.6, 1], [14.3, 28.4], [14.0, 30.4], [11, 32.0], [8, 33.7], [4.6, 35.3, 1], [6.9, 31.8], [9.0, 29.2], [11.0, 27.3]], 1);
  top({ name: "headlight", mirror: true, points: lamp, color: "#0d0f13", depth: 0.55, wall: "#111317", metallic: 0.3, roughness: 0.35, facing: 0.3 });
  for (const z0 of [-9.6, -14.0, -18.4]) top({ name: "louvre", points: mirrorX([[0, z0], [3.6, z0], [5.2, z0 - 2.3], [4.3, z0 - 2.3], [3.1, z0 - 0.9], [0, z0 - 0.9]]), ...dark({ depth: 0.35 }), facing: 0.6 });
  top({ name: "shoulder vent", mirror: true, points: [[12.4, -0.3], [13.9, -1.0], [14.1, -2.6], [12.9, -2.2]], ...dark({ depth: 0.25 }), facing: 0.6 });
  // --- from the front: the wide intake under the nose and its outer ducts
  const front = (o) => cut({ view: "front", mirror: true, facing: 0.3, ...o });
  const intake = [[0, 5.0], [9.8, 5.0], [7.8, 2.3], [0, 2.3]];
  cut({ view: "front", facing: 0.3, name: "intake", points: mirrorX(intake), ...dark({ depth: 0.7 }) });
  front({ name: "outer duct", points: [[10.7, 5.0], [14.9, 5.0], [14.6, 2.4], [12.6, 2.4]], ...dark({ depth: 0.4, color: "#101115" }) });
  front({ name: "running light", points: stroke([[10.2, 5.45], [14.0, 5.75]], 0.3), color: "#f4f7ff", emissive: 0.9 });
  // --- from behind: stacked lamps, the vent stacks under them, the dark middle with the exhaust, the diffuser
  const back = (o) => cut({ view: "back", mirror: true, facing: 0.3, ...o });
  back({ name: "tail lamp", points: [[9.4, 10.0], [10.0, 11.0], [13.8, 11.3], [15.0, 10.0], [14.5, 9.2], [10.4, 9.0]], color: "#16171b", metallic: 0.3, roughness: 0.2 });
  for (const [x0, y0] of [[10.6, 10.25], [12.3, 10.3], [10.6, 9.45], [12.3, 9.45]]) back({ name: "tail light", points: rrect(x0, y0, x0 + 1.3, y0 + 0.45, 0.12), color: "#ff3b30", emissive: 0.9 });
  for (let k = 0; k < 5; k++) back({ name: "rear vent", points: [[9.5 + k * 0.05, 7.6 - k * 1.18], [14.6 - k * 0.12, 7.6 - k * 1.18], [14.6 - k * 0.12, 8.4 - k * 1.18], [9.5 + k * 0.05, 8.4 - k * 1.18]], ...dark({ depth: 0.45 }) });
  cut({ view: "back", facing: 0.3, name: "rear panel", points: mirrorX([[0, 9.5], [8.8, 9.5], [8.4, 6.6], [6.5, 6.2], [0, 6.2]]), color: "#2a2c31", ...MATT });
  back({ name: "rear opening", points: [[2.4, 8.6], [7.8, 8.2], [8.0, 6.9], [4.2, 6.7]], ...dark({ depth: 0.5 }) });
  cut({ view: "back", facing: 0.3, name: "tail pipe", points: ellipse(0, 7.8, 1.05, 0.95, 6), color: "#c4c9d2", ...CHROME });
  cut({ view: "back", facing: 0.3, name: "tail pipe bore", points: ellipse(0, 7.8, 0.78, 0.7, 6), color: "#050506", depth: 0.9, wall: "#3b3e45", metallic: 0.4, roughness: 0.6 });
  cut({ view: "back", facing: 0.3, name: "reflector", points: rrect(-6.5, 5.2, 6.5, 5.75, 0.15), color: "#7a1218", metallic: 0.3, roughness: 0.2 });
  cut({ view: "back", facing: 0.2, name: "diffuser", points: mirrorX([[0, 0.5], [11, 0.5], [10.6, 4.7], [0, 4.7]]), ...dark({ depth: 0.3, color: "#0b0c0e" }) });
  body.modifiers.push({ type: "cutout", cuts });

  const cubes = [body];
  cubes.push(lattice("intake slats", mirrorX(intake), at.front, 1, 0.45, 0.55, 0.1, "#2b2e35", { straight: true }));
  arches.forEach((a, k) => { for (const sx of [1, -1]) cubes.push(archLiner(`wheel house ${k} ${sx}`, a.slice(1, -1), 15.6, track - (k ? 3.4 : 2.6), sx)); });
  cubes.push(box("floor", -13, 13, 1.7, 2.1, -30, 32, "#0b0c0e", { material: { metallic: 0, roughness: 1 } }));
  // the splitter: a flat blade under the nose, with a fence at each end
  cubes.push(hexa("splitter rear", [[-15.7, 1.0, 27.5], [15.7, 1.0, 27.5], [15.7, 1.4, 27.5], [-15.7, 1.4, 27.5]], [[-14.6, 1.0, 34.2], [14.6, 1.0, 34.2], [14.6, 1.4, 34.2], [-14.6, 1.4, 34.2]], CARBON, { material: MATT }));
  cubes.push(hexa("splitter front", [[-14.6, 1.0, 34.2], [14.6, 1.0, 34.2], [14.6, 1.4, 34.2], [-14.6, 1.4, 34.2]], [[-9.5, 1.0, 37.5], [9.5, 1.0, 37.5], [9.5, 1.4, 37.5], [-9.5, 1.4, 37.5]], CARBON, { material: MATT }));
  for (const sx of [1, -1]) cubes.push(hexa(`splitter fence ${sx}`, [[sx * 15.45, 1.4, 27.5], [sx * 15.7, 1.4, 27.5], [sx * 15.7, 3.0, 27.5], [sx * 15.45, 3.0, 27.5]], [[sx * 14.4, 1.4, 34.0], [sx * 14.65, 1.4, 34.0], [sx * 14.65, 1.9, 34.0], [sx * 14.4, 1.9, 34.0]], CARBON, { material: MATT }));
  // the rear wing: a wide plane, end plates, two swan-neck mounts that hold it from above
  cubes.push(loft("wing", [[-30.55, 15.86], [-30.75, 16.04], [-31.3, 16.18], [-32.2, 16.28], [-33.4, 16.38], [-34.4, 16.5], [-35.05, 16.6], [-34.4, 16.4], [-33.4, 16.14], [-32.2, 15.9], [-31.3, 15.78], [-30.75, 15.76]], -16, 16, CARBON, { material: MATT, smooth: true }));
  // the light strip in each lamp pocket, and the blades of the vent stacks under the tail lamps
  for (const sx of [1, -1]) {
    const pts = path([[13.5, 29.0], [11.2, 30.4], [8.6, 32.3], [6.4, 33.9]], 6).map(([x, z]) => [sx * x, at.top(x, z) - 0.36 + 0.34 * smoothstep((x - 9.5) / 3.5), z]);
    for (let k = 0; k < pts.length - 1; k++) cubes.push(bar(`daylight ${sx} ${k}`, pts[k], pts[k + 1], 0.42, 0.12, "#f4f7ff", { emissive: 0.95 }));
    for (let k = 0; k < 4; k++) { const y = 7.42 - k * 1.18, xs = [9.7, 12.2, 14.3], zb = xs.map((x) => at.back(x, y)); for (let j = 0; j < 2; j++) cubes.push(hexa(`vent blade ${sx} ${k} ${j}`, [[sx * xs[j], y, zb[j] + 0.3], [sx * xs[j + 1], y, zb[j + 1] + 0.3], [sx * xs[j + 1], y + 0.14, zb[j + 1] + 0.3], [sx * xs[j], y + 0.14, zb[j] + 0.3]], [[sx * xs[j], y - 0.25, zb[j] - 0.75], [sx * xs[j + 1], y - 0.25, zb[j + 1] - 0.75], [sx * xs[j + 1], y - 0.11, zb[j + 1] - 0.75], [sx * xs[j], y - 0.11, zb[j] - 0.75]], CARBON, { material: MATT })); }
  }
  for (const sx of [1, -1]) {
    const lo = (a, b) => [Math.min(sx * a, sx * b), Math.max(sx * a, sx * b)], [xa, xb] = lo(16, 16.28);
    cubes.push(hexa(`end plate ${sx}`, [[xa, 14.3, -27.8], [xb, 14.3, -27.8], [xb, 16.9, -27.8], [xa, 16.9, -27.8]], [[xa, 15.0, -36.3], [xb, 15.0, -36.3], [xb, 16.9, -36.3], [xa, 16.9, -36.3]], CARBON, { material: MATT }));
    const [ma, mb] = lo(6.6, 6.82), yd = at.top(6.7, -28) - 0.4;
    cubes.push(hexa(`swan neck ${sx}`, [[ma, yd, -27.0], [mb, yd, -27.0], [mb, yd, -29.6], [ma, yd, -29.6]], [[ma, 17.05, -29.0], [mb, 17.05, -29.0], [mb, 17.05, -30.4], [ma, 17.05, -30.4]], "#1c1d22", { material: MATT }));
    cubes.push(hexa(`swan arm ${sx}`, [[ma, 16.6, -29.6], [mb, 16.6, -29.6], [mb, 17.05, -29.6], [ma, 17.05, -29.6]], [[ma, 16.35, -33.6], [mb, 16.35, -33.6], [mb, 16.95, -33.6], [ma, 16.95, -33.6]], "#1c1d22", { material: MATT }));
    // diffuser fins
    for (const x of [3.3, 6.6, 9.9]) { const [fa, fb] = lo(x - 0.12, x + 0.12); cubes.push(hexa(`fin ${x} ${sx}`, [[fa, 1.2, -30.5], [fb, 1.2, -30.5], [fb, 2.6, -30.5], [fa, 2.6, -30.5]], [[fa, 2.0, -37.3], [fb, 2.0, -37.3], [fb, 4.6, -37.3], [fa, 4.6, -37.3]], CARBON, { material: MATT })); }
    // a slim mirror on a stalk at the shoulder
    const q = (pts) => pts.map(([x, y, z]) => [sx * x, y, z]), ym = at.top(14.6, 12.2);
    cubes.push(pebble(`mirror ${sx}`, q([[15.2, ym + 0.75, 11.2], [17.5, ym + 0.8, 11.5], [17.5, ym + 1.9, 11.5], [15.3, ym + 1.9, 11.2]]), q([[15.2, ym + 0.85, 12.9], [17.3, ym + 0.9, 13.4], [17.3, ym + 1.75, 13.4], [15.3, ym + 1.75, 12.9]]), CARBON, { material: PLASTIC, levels: 2 }));
    cubes.push(hexa(`mirror glass ${sx}`, q([[15.5, ym + 1.0, 11.2], [17.2, ym + 1.0, 11.42], [17.2, ym + 1.7, 11.42], [15.5, ym + 1.7, 11.2]]), q([[15.5, ym + 1.0, 11.3], [17.2, ym + 1.0, 11.52], [17.2, ym + 1.7, 11.52], [15.5, ym + 1.7, 11.3]]), "#aebfd0", { material: CHROME }));
    cubes.push(box(`mirror stalk ${sx}`, ...lo(14.6, 15.0), ym - 0.2, ym + 1.1, 11.9, 12.5, CARBON, { round: 0.1, segs: 1 }));
  }
  cubes.push(box("diffuser floor", -10.8, 10.8, 1.0, 1.2, -37.0, -30, CARBON, { material: MATT }));
  // one wiper lying on the canopy
  const onTop = (x, z, lift = 0.12) => [x, at.top(x, z) + lift, z];
  cubes.push(bar("wiper", onTop(0.3, 19.2), onTop(4.6, 15.4), 0.4, 0.2, "#0b0c0e", { material: RUBBER }, [0, 0.8, 0.6]));
  const wheelOf = (sx) => wheel({ R, width: 4.9, rimR: 3.9, rim: "#2c2e34", rimMaterial: { metallic: 0.7, roughness: 0.35 }, windows: spokeWindows(10, 1.5, 3.4, 0.4, 0.7), spokeDepth: 0.55, caliper: "#c8322b", hubR: 0.2, nuts: 1, nutAt: 0, dish: 0.35, cap: "#8f959f" }, sx);
  return { at, R, track, wheelZ, model: assemble({ cubes, pivot: R, wheelZ, track, wheelOf, R }), tail: { z: r2(-36.4 / 16), y: r2(7.8 / 16 - 0.06), x: 0 } };
}

void [DARK, PAINT];
