// `car_pickup`: a modern full-size four-door crew-cab pickup (5933 x 2037 x 1981 mm, wheelbase 3700), read off build/blueprints/pickup.png
// (calibration in pickup.trace.json: every view 14.93 px per 1/16 m). The nose, the cab and the bed's outer skin are one surface from buildBody; the top line
// steps down from the roof to the bed rail. The load bed is a real hollow: a top-view cut-out takes the bed's top sheet away and stands walls down to the floor
// (it is the LAST cut, so no other view's cut lands on those walls), with a floor piece and wheel tubs inside. No badges or lettering.
import { DARK, TRIM, CHROME, GLASS, PAINT, PLASTIC, RUBBER, STEEL, archLiner, assemble, bar, box, buildBody, cyl, fillet, flare, glassOf, hexa, inset, mesh, mirrorX, path, pebble, r2, rect, rounded, rrect, shade, spokeWindows, stroke, wheel, hexBars, inPoly } from "../carkit.mjs";


function pickup(paint = "#c4541f") {
  const gap = shade(paint, 0.25), R = 6.8, track = 13.55, wheelZ = [31.3, -27.9], liner = "#1b1c20";
  const spec = {
    paint, midY: 15,
    w: [[-46.5, 14.4], [-46, 15.3], [-45, 15.7], [-42, 15.95], [-36, 16.1], [-20, 16.1], [-16.5, 16.0], [0, 16.0], [20, 16.0], [24, 16.15], [30, 16.3], [38, 16.0], [40, 15.8], [41, 15.5]],
    yb: [[-46.5, 13.7], [-35.7, 13.6], [-34.9, 8.6], [-16, 8.5], [22, 8.5], [24, 8.0], [39, 7.6], [41, 7.2], [45.3, 7.0], [47.4, 8.3]],
    top: [[-46.5, 23.5], [-16.1, 23.5], [-15.9, 23.55], [-15.4, 31.7], [-15.2, 31.75], [-13, 31.9], [5, 31.85], [8, 31.6], [10, 31.3], [13, 30.8], [14.5, 30.4], [15.5, 29.8], [17, 28.7], [19, 27.1], [21, 25.5], [22.3, 24.4], [23.2, 23.7], [24.2, 23.4], [25, 23.3], [30, 22.9], [35, 22.5], [40, 22.0], [43, 21.5], [45, 20.9], [46.3, 20.3]],
    ys: [[-46.5, 23.2], [-16.1, 23.2], [-15.2, 22.9], [-10, 22.6], [17, 22.2], [22, 22.4], [25, 22.35], [30, 21.9], [38, 21.3], [43, 20.7], [46.3, 20.0]],
    rw: [[-15.5, 10.9], [10, 10.9], [14, 11.2], [18, 12.1], [22, 13.3]],
    drop: [[-15.5, 1.6], [8, 1.6], [12, 1.3], [16, 0.8], [21, 0.4]],
    crown: [[-15, 0.45], [8, 0.4], [14, 0.25], [21, 0.15]],
    ledge: 0.35, rail: 0.7, hoodP: 4.5,
    profile: [[0, 0.975], [0.15, 0.99], [0.4, 1.0], [0.8, 1.0], [0.93, 0.992], [1, 0.97]],
    rows: [0, 0.1, 0.25, 0.45, 0.65, 0.82, 0.93, 1],
    stations: [-41, -35.7, -34.9, -27.9, -20, -17.3, -16.5, -16.1, -15.9, -15.4, -15.2, -14.3, -11.8, -5, 2.6, 10, 14.5, 18, 21.5, 23.2, 24.6, 31.3, 39.5], maxGap: 5,
    front: { zc: 41, L: 8, plan: [[0, 47.4], [8, 47.4], [10.2, 46.4], [12, 45], [13.3, 44], [14.6, 43], [15.2, 42], [15.5, 41]], side: [[7.0, 45.3], [8.4, 47.3], [12, 47.4], [12.6, 46.9], [13.4, 46.55], [19.3, 46.5], [19.8, 46.3], [20.3, 45.9]], edgeBack: [[0, 1.15], [15.5, 0.4]], rim: 0.5, rimTop: 0.45 },
    rear: { zc: -45, L: 3, plan: [[0, -46.5], [13.5, -46.5], [14.6, -46.3], [15.3, -45.8], [15.7, -45]], side: [[13.5, -46.3], [14.1, -46.5], [23, -46.5], [23.5, -46.35]], edgeBack: [[0, 0.12], [15.7, 0.05]], rim: 0.5, rimTop: 0.5 },
    crease: { rows: { 1: 0.5, 8: 0.45 }, cols: { 3: 0.3, 5: 0.25 } },
  };
  const { body, at } = buildBody(spec);
  const cuts = [], cut = (c) => cuts.push(c);
  const matt = { metallic: 0, roughness: 0.8 }, gapOf = (o) => ({ color: gap, depth: 0.12, wall: gap, ...matt, ...o });
  const side = (o) => cut({ view: "side", facing: 0.6, ...o });
  // --- from the side: the squared wheel openings, glass, doors, the gap between cab and bed, lamps where they wrap
  const archF = [[39.6, 6.3], [39.5, 10.5], [38.7, 13.2], [37.2, 15.2], [35.2, 16.1], [27.6, 16.1], [25.7, 15.2], [24.2, 13.2], [23.5, 10.5], [23.4, 6.3]];
  const archR = archF.map(([z, y]) => [z - 59.2, y > 12 ? y + 0.6 : y]);
  const arches = [archF, archR].map((a) => rounded(a.map(([z, y], i) => [z, y, i === 0 || i === a.length - 1 ? 1 : 0]), 1));
  for (const points of arches) cut({ view: "side", points, remove: true, depth: 0.8, wall: shade(paint, 0.45), facing: -1, near: 9 });
  const dlo = fillet([[18.0, 22.55], [-5, 22.6], [-8.2, 23.5], [-10.6, 25.0], [-11.9, 25.8], [-11.9, 30.1], [9.6, 30.1], [12, 29.5], [15, 27.6], [20.6, 23.5], [20.4, 22.6]], 0.45);
  side({ name: "window trim", points: inset(dlo, -0.38), color: TRIM, metallic: 0.1, roughness: 0.5 });
  side({ name: "side glass", points: dlo, ...glassOf() });
  side({ name: "pillar", points: [[1.5, 22.3], [3.6, 22.3], [3.1, 30.4], [1.6, 30.4]], color: TRIM, metallic: 0.1, roughness: 0.5 });
  side({ name: "door gaps", points: stroke([[2.5, 22.2], [3.1, 16], [3.0, 11], [2.8, 8.95], [20.6, 8.95], [21.2, 12], [21.6, 17], [21.5, 21.5], [21.2, 22.9], [12.4, 30.2], [9.8, 30.85], [-13.2, 30.85], [-14.3, 30.2], [-14.3, 8.95], [2.8, 8.95]], 0.17), ...gapOf() });
  for (const z of [6.2, -11.4]) side({ name: "handle pocket", points: rrect(z - 2.1, 19.6, z + 2.1, 20.6, 0.35), color: shade(paint, 0.5), depth: 0.22, wall: shade(paint, 0.4), ...matt });
  side({ name: "cab gap", points: stroke([[-16.55, 8.4], [-16.55, 23.4]], 0.3), color: "#08090b", depth: 0.5, wall: "#08090b", ...matt });
  side({ name: "fuel flap", points: stroke([...rrect(-22.4, 19.6, -19.8, 22.0, 0.4), [-22.4, 20.3]], 0.13), ...gapOf({ depth: 0.08 }), only: "-x" });
  side({ name: "swage", points: stroke(path([[21.0, 21.3], [0, 21.15], [-16, 21.2], [-43, 21.3]], 6), 0.14), color: shade(paint, 0.62), depth: 0.05, wall: shade(paint, 0.5) });
  side({ name: "rocker", points: rect(-15.9, 8.2, 22.9, 9.5), color: "#17181c", ...matt, facing: 0.3 });
  side({ name: "valance side", points: [[40.3, 6.3], [40.3, 10.3], [48, 10.3], [48, 6.3]], color: "#17181c", ...matt, facing: 0.72 });
  const lens = { color: "#232831", ...GLASS }, glow = { color: "#f4f7ff", emissive: 0.95 }, red = { color: "#b01620", emissive: 0.45, metallic: 0.3, roughness: 0.15 };
  side({ name: "headlight side", points: [[48, 19.75], [42.4, 19.95], [41.6, 19.5], [43.6, 18.95], [48, 18.75]], ...lens, facing: 0.72 });
  side({ name: "marker", points: rrect(41.9, 19.2, 43.3, 19.65, 0.15), color: "#f59a1b", emissive: 0.35, metallic: 0.2, roughness: 0.2, facing: 0.72 });
  const tailSide = [[-48, 14.2], [-43.9, 14.2], [-43.5, 14.7], [-43.9, 15.6], [-43.9, 19.8], [-43.3, 20.6], [-43.5, 21.2], [-48, 21.2]];
  side({ name: "tail lamp side", points: tailSide, ...red, facing: 0.72 });
  side({ name: "tail light bar side", points: stroke([[-47.5, 20.5], [-44.5, 20.5], [-44.5, 14.9], [-47.5, 14.9]], 0.3), color: "#ff3b30", emissive: 0.9, facing: 0.72 });
  // --- from the front: the hexagon grille, slim lamps over stacked ones, the lower bumper
  const front = (o) => cut({ view: "front", facing: 0.3, near: 38, ...o });
  const grille = fillet(mirrorX([[0, 12.3], [8.9, 12.3], [9.9, 13.7], [9.9, 16.9], [7.9, 19.4], [0, 19.4]]), 0.3);
  front({ name: "bumper lower", points: mirrorX([[0, 6], [17.5, 6], [17.5, 10.3], [10.6, 10.3], [9.6, 12.0], [0, 12.0]]), color: "#17181c", ...matt });
  front({ name: "skid plate", points: rrect(-9.0, 7.0, 9.0, 9.9, 0.3), color: "#8e949d", metallic: 0.7, roughness: 0.4 });
  front({ name: "bumper slot", points: rrect(-4.6, 10.35, 4.6, 10.95, 0.2), color: "#050506", depth: 0.3, wall: "#0c0d10", ...matt });
  front({ name: "grille frame", points: inset(grille, -0.32), color: "#23262d", metallic: 0.8, roughness: 0.3 });
  front({ name: "grille", points: grille, color: "#07080a", depth: 0.6, wall: "#15171b", metallic: 0, roughness: 0.9 });
  const lamp = [[9.7, 19.5], [10.6, 19.85], [17.5, 19.85], [17.5, 18.8], [15.3, 18.8], [15.3, 15.3], [13.8, 15.3], [13.8, 17.3], [11.4, 17.3]];
  front({ name: "headlight", mirror: true, points: lamp, ...lens });
  front({ name: "daylight", mirror: true, points: stroke([[10.6, 19.4], [14.95, 19.5], [14.95, 15.7]], 0.2), ...glow });
  front({ name: "main beam", mirror: true, points: rrect(12.2, 17.85, 13.6, 18.65, 0.3), color: "#cfd6de", emissive: 0.3, metallic: 0.4, roughness: 0.1 });
  front({ name: "fog frame", mirror: true, points: rrect(12.2, 12.9, 13.6, 17.0, 0.2), color: "#0c0d10", depth: 0.15, wall: "#0c0d10", ...matt });
  for (let k = 0; k < 5; k++) front({ name: "fog lamp", mirror: true, points: rect(12.45, 13.15 + k * 0.76, 13.35, 13.65 + k * 0.76), color: "#cfd6de", emissive: 0.25, metallic: 0.3, roughness: 0.1, facing: 0.2 });
  front({ name: "parking sensor", mirror: true, points: rrect(11.4, 10.8, 12.4, 11.3, 0.2), color: "#0c0d10", ...matt });
  // --- from behind: the cab's rear glass, the tailgate and the tall lamps
  const back = (o) => cut({ view: "back", facing: 0.4, far: -41, ...o }), cabBack = { near: -17.2, far: -14 };
  const rearG = fillet([[-13.2, 24.5], [13.2, 24.5], [10.2, 29.8], [-10.2, 29.8]], 0.6);
  back({ name: "rear glass trim", points: inset(rearG, -0.35), color: TRIM, metallic: 0.1, roughness: 0.5, ...cabBack });
  back({ name: "rear glass", points: rearG, ...glassOf(), ...cabBack });
  back({ name: "stop lamp", points: rrect(-5.4, 30.35, 5.4, 30.95, 0.2), color: "#8e1219", emissive: 0.3, metallic: 0.3, roughness: 0.15, ...cabBack });
  back({ name: "tailgate gap", points: stroke([[-13.05, 23.6], [-13.05, 13.95], [13.05, 13.95], [13.05, 23.6]], 0.18), ...gapOf() });
  back({ name: "tailgate crease", points: stroke([[-12.6, 21.2], [-6.5, 21.9], [-3.2, 21.9], [-2.4, 21.0], [2.4, 21.0], [3.2, 21.9], [6.5, 21.9], [12.6, 21.2]], 0.14), color: shade(paint, 0.62), depth: 0.05, wall: shade(paint, 0.5) });
  back({ name: "tailgate handle", points: rrect(-1.9, 21.25, 1.9, 21.75, 0.2), color: "#0c0d10", depth: 0.2, wall: "#0c0d10", ...matt });
  back({ name: "tailgate recess", points: rrect(-9.5, 15.6, 9.5, 19.6, 0.7), depth: 0.14, wall: shade(paint, 0.55) });
  back({ name: "tail lamp", mirror: true, points: rrect(13.35, 14.2, 17.5, 21.2, 0.2), ...red, facing: 0.3 });
  back({ name: "tail light bar", mirror: true, points: stroke([[17.4, 14.9], [14.0, 14.9], [14.0, 20.5], [17.4, 20.5]], 0.3), color: "#ff3b30", emissive: 0.9, facing: 0.3 });
  back({ name: "reverse lamp", mirror: true, points: rect(14.6, 15.0, 15.2, 15.8), color: "#d9dee4", emissive: 0.15, metallic: 0.3, roughness: 0.1, facing: 0.3 });
  // --- from above: the windscreen, the roof panel, the bonnet, the bed's rail caps and (last) the bed itself
  const top = (o) => cut({ view: "top", facing: 0.45, near: 19, ...o });
  const screen = rounded(mirrorX([[0, 23.0], [8, 22.9], [12.6, 22.5, 1], [11.6, 18], [10.4, 14.4, 1], [6, 14.9], [0, 15.1]]), 1);
  top({ name: "screen trim", points: inset(screen, -0.4), color: TRIM, metallic: 0.1, roughness: 0.5 });
  top({ name: "windscreen", points: screen, ...glassOf() });
  top({ name: "scuttle", points: mirrorX([[0, 23.5], [13.6, 23.4], [13.6, 24.9], [0, 25.3]]), color: "#15161a", ...matt });
  const roofG = rrect(-8.2, -8.2, 8.2, 10.8, 1.0);
  top({ name: "roof panel trim", points: inset(roofG, -0.3), color: TRIM, metallic: 0.1, roughness: 0.5 });
  top({ name: "roof panel", points: roofG, ...glassOf({ depth: 0.04 }) });
  top({ name: "bonnet gap", mirror: true, points: stroke(path([[0, 45.5], [8.5, 45.3], [11.6, 43.6], [13.6, 41.2], [14.5, 36], [14.7, 30], [14.5, 25.2]], 16), 0.17), ...gapOf({ depth: 0.1 }), facing: 0.6 });
  top({ name: "bonnet rib", mirror: true, points: stroke([[5.2, 44.2], [6.0, 26.5]], 0.15), color: shade(paint, 0.62), depth: 0.05, wall: shade(paint, 0.5), facing: 0.6 });
  top({ name: "cab gap top", points: rect(-16.4, -16.72, 16.4, -16.38), color: "#08090b", depth: 0.5, wall: "#08090b", ...matt, facing: 0.6 });
  top({ name: "rail caps", points: rrect(-14.6, -46.1, 14.6, -17.0, 0.5), color: "#17181c", ...matt, facing: 0.6 });
  const bed = { x: 13.0, z0: -45.25, z1: -17.45, floor: 14.6 };
  top({ name: "load bed", points: rrect(-bed.x, bed.z0, bed.x, bed.z1, 0.35), remove: true, depth: 23.5 - bed.floor + 0.4, wall: shade(paint, 0.62), facing: 0.6 });
  body.modifiers.push({ type: "cutout", cuts });

  const cubes = [body], black = "#17181c";
  const lo = (sx, a, b) => [Math.min(sx * a, sx * b), Math.max(sx * a, sx * b)];
  // the grille: hexagon bars and the wide bar across its top
  cubes.push(hexBars("grille bars", grille, at.front, 0.28, { y0: 13.2, y1: 17.0, pitch: 1.22, amp: 0.36, period: 6.6, wid: 0.22, color: "#3d414a", material: { metallic: 0.6, roughness: 0.4 } }));
  { const z = at.front(0, 18) - 0.35; cubes.push(box("grille top bar", -6.0, 6.0, 17.6, 18.7, z, z + 0.3, "#30333a", { round: 0.14, segs: 1, material: { metallic: 0.6, roughness: 0.4 } })); }
  // the load bed: its floor with pressed ribs, and the wheel tubs
  cubes.push(box("bed floor", -bed.x - 0.2, bed.x + 0.2, bed.floor - 0.7, bed.floor, bed.z0 - 0.2, bed.z1 + 0.2, liner, { material: { metallic: 0, roughness: 0.9 } }));
  for (const [z0, z1] of [[bed.z1 - 0.16, bed.z1 + 0.1], [bed.z0 - 0.1, bed.z0 + 0.16]]) cubes.push(box("bed end panel", -bed.x + 0.25, bed.x - 0.25, bed.floor - 0.1, 22.7, z0, z1, liner, { material: { metallic: 0, roughness: 0.9 } }));
  for (let k = -3; k <= 3; k++) cubes.push(box("bulkhead rib", k * 3.2 - 0.9, k * 3.2 + 0.9, 15.6, 21.8, bed.z1 - 0.3, bed.z1 - 0.1, "#24262b", { material: { metallic: 0, roughness: 0.9 } }));
  for (let k = -5; k <= 5; k++) cubes.push(box("bed rib", k * 1.9 - 0.5, k * 1.9 + 0.5, bed.floor, bed.floor + 0.14, bed.z0 + 0.5, bed.z1 - 0.5, "#24262b", { material: { metallic: 0, roughness: 0.9 } }));
  for (const sx of [1, -1]) cubes.push(box(`bed tub ${sx}`, ...lo(sx, 10.0, bed.x + 0.15), bed.floor - 0.3, 17.7, -36.6, -19.2, liner, { round: 0.45, segs: 2, material: { metallic: 0, roughness: 0.9 } }));
  // wheel houses, the squared flares, mud flaps
  const feet = [[7.3, 8.3], [8.4, 10.2]];
  for (const [k, z] of wheelZ.entries()) for (const sx of [1, -1]) {
    const o = arches[k].slice(1, -1);
    cubes.push(archLiner(`wheel house ${k} ${sx}`, o, 15.7, track - 3.4, sx));
    cubes.push(flare(`flare ${k} ${sx}`, [[o[0][0], feet[k][0]], ...o, [o[o.length - 1][0], feet[k][1]]], at, sx, 1.45, 0.55, "#1a1b1f"));
    const zf = z - 8.2;
    cubes.push(hexa(`mud flap ${k} ${sx}`, [[sx * 11.6, 10.2, zf], [sx * 16.3, 10.2, zf], [sx * 16.3, 5.2, zf - 0.6], [sx * 11.6, 5.2, zf - 0.6]], [[sx * 11.6, 10.2, zf - 0.3], [sx * 16.3, 10.2, zf - 0.3], [sx * 16.3, 5.2, zf - 0.9], [sx * 11.6, 5.2, zf - 0.9]], "#101114", { material: RUBBER }));
  }
  // underneath: the cab floor, the frame rails, axles and differentials
  cubes.push(box("floor", -14.5, 14.5, 8.6, 9.3, -16, 41, "#0b0c0e", { material: { metallic: 0, roughness: 1 } }));
  for (const sx of [1, -1]) cubes.push(box(`frame rail ${sx}`, ...lo(sx, 5.6, 7.2), 7.4, 9.4, -45.5, 44, "#15161a", { material: { metallic: 0.2, roughness: 0.8 } }));
  for (const z of wheelZ) cubes.push(cyl("axle", 0, R - 0.2, z, 0.8, 2 * track - 3, "x", "#1d1e23", { segments: 10, material: { metallic: 0.3, roughness: 0.7 } }), { name: "differential", shape: "sphere", from: [-2.0, R - 2.2, z - 2.0], size: [4, 4, 4], color: "#1d1e23", segments: 12, smooth: true, metallic: 0.3, roughness: 0.7 });
  // the rear bumper: a painted bar with a black step pad, reflectors and the tow hitch
  cubes.push(box("rear bumper", -16.0, 16.0, 8.3, 13.3, -47.55, -43.4, paint, { round: 0.55, segs: 2, material: { metallic: 0.4, roughness: 0.42, coat: 0.4 } }));
  cubes.push(box("bumper step", -13.2, 13.2, 13.2, 13.45, -47.4, -46.4, black, { round: 0.08, segs: 1 }));
  cubes.push(box("rear valance", -15.0, 15.0, 7.4, 8.6, -47.2, -43.6, black, { round: 0.3, segs: 1 }));
  cubes.push(box("hitch", -0.9, 0.9, 7.7, 9.3, -47.95, -46.6, "#101114", { round: 0.2, segs: 1, material: { metallic: 0.5, roughness: 0.5 } }));
  cubes.push(box("rear plate", -3.3, 3.3, 10.2, 12.0, -47.62, -47.5, "#ecece6", {}));
  for (const sx of [1, -1]) cubes.push(box(`reflector ${sx}`, ...lo(sx, 12.6, 14.8), 10.6, 11.3, -47.62, -47.5, "#a3121b", { material: { metallic: 0.2, roughness: 0.2 }, emissive: 0.2 }));
  // side steps on brackets, door handles, mirrors on their arms
  for (const sx of [1, -1]) {
    cubes.push(box(`side step ${sx}`, ...lo(sx, 15.3, 17.5), 6.85, 7.7, -15.6, 21.2, black, { round: 0.3, segs: 2 }));
    for (const z of [-11.5, 2.5, 16.5]) cubes.push(box(`step bracket ${sx}`, ...lo(sx, 13.5, 15.6), 7.2, 8.7, z - 0.4, z + 0.4, "#101114", {}));
    for (const z of [6.2, -11.4]) { const xh = at.side(z, 20.1); cubes.push(box(`door handle ${sx}`, ...lo(sx, xh - 0.15, xh + 0.12), 19.95, 20.4, z - 1.9, z + 1.9, shade(paint, 0.9), { round: 0.1, segs: 1, material: PAINT })); }
    const q = (pts) => pts.map(([x, y, z]) => [sx * x, y, z]);
    cubes.push(pebble(`mirror ${sx}`, q([[16.8, 22.1, 15.1], [20.2, 22.3, 14.8], [20.1, 25.9, 14.9], [17.0, 25.9, 15.2]]), q([[16.9, 22.5, 18.6], [19.7, 22.6, 17.9], [19.6, 25.4, 17.9], [17.1, 25.5, 18.6]]), black, { levels: 2, creases: [[0, 1, 0.7], [1, 2, 0.7], [2, 3, 0.7], [3, 0, 0.7], [0, 4, 0.5], [1, 5, 0.5], [2, 6, 0.5], [3, 7, 0.5], [4, 5, 0.4], [5, 6, 0.4], [6, 7, 0.4], [7, 4, 0.4]] }));
    cubes.push(hexa(`mirror glass ${sx}`, q([[17.35, 22.65, 15.0], [19.75, 22.8, 14.78], [19.7, 25.4, 14.86], [17.5, 25.4, 15.08]]), q([[17.35, 22.65, 15.4], [19.75, 22.8, 15.18], [19.7, 25.4, 15.26], [17.5, 25.4, 15.48]]), "#aebfd0", { material: CHROME }));
    cubes.push(hexa(`mirror arm ${sx}`, q([[14.9, 22.5, 16.3], [17.6, 22.6, 16.1], [17.6, 23.5, 16.1], [14.9, 23.4, 16.3]]), q([[14.9, 22.5, 18.2], [17.6, 22.6, 17.7], [17.6, 23.5, 17.7], [14.9, 23.4, 18.2]]), black, {}));
  }
  // wipers on the screen, the roof fin, the tail pipe
  const onTop = (x, z, lift = 0.14) => [x, at.top(x, z) + lift, z];
  for (const [x0, z0, x1, z1] of [[1.5, 22.6, 10.4, 21.9], [-9.5, 22.3, -0.6, 22.7]]) cubes.push(bar("wiper", onTop(x0, z0), onTop(x1, z1), 0.42, 0.22, "#0b0c0e", { material: RUBBER }, [0, 0.77, 0.64]));
  { const y = at.top(0, -12); cubes.push(pebble("roof fin", [[-0.7, y - 0.1, -13.6], [0.7, y - 0.1, -13.6], [0.25, y + 0.95, -13.8], [-0.25, y + 0.95, -13.8]], [[-0.55, y - 0.05, -10.4], [0.55, y - 0.05, -10.4], [0.15, y + 0.2, -10.8], [-0.15, y + 0.2, -10.8]], DARK, { levels: 2 })); }
  cubes.push(cyl("tail pipe", 11.6, 7.0, -41.9, 0.7, 3.8, "z", "#6f747c", { segments: 14, material: STEEL }), cyl("tail pipe bore", 11.6, 7.0, -43.75, 0.54, 0.14, "z", "#050506", { segments: 12, material: { metallic: 0, roughness: 1 } }));
  const wheelSpec = { R, width: 4.9, rimR: 3.95, rim: "#757a83", rimMaterial: { metallic: 0.6, roughness: 0.38 }, windows: spokeWindows(6, 1.55, 3.45, 0.5, 0.8), spokeDepth: 0.6, hubR: 0.26, nuts: 6, nutAt: 1.5, dish: 0.4, cap: "#8f959f", tread: 22, faceAt: 0.62, discR: 0.66 };
  const model = assemble({ cubes, pivot: R, wheelZ, track, wheelOf: (sx) => wheel(wheelSpec, sx), R });
  return { model, tail: { z: r2(-46.0 / 16), y: r2(17.7 / 16 - 0.06), x: r2(14.2 / 16 / 0.92) } };
}

export const CARS = {
  car_pickup: () => pickup(), car_pickup_white: () => pickup("#e4e5e2"), car_pickup_black: () => pickup("#1d1f23"), car_pickup_blue: () => pickup("#2a4d86"),
};
void [STEEL, rounded];
