// A car body modelled from blueprints, not assembled from boxes. A spec gives the car's profiles along its length (the width, the underside,
// the belt line, the top line with the bonnet, the glasshouse and the boot, the roof's width) as a modeller reads them off side and top
// drawings; `buildBody` turns them into a half cage of cross-section rings (edge loops where the surface turns: the sills, the belt line, the
// window edges, the pillars, the door gaps, round each wheel), mirrors it and subdivides it, creasing the hard lines. Glass, pillars, lower
// band, sills, bumpers and panel gaps are colours of that one surface. The wheel arches are dents and flares of the surface itself, with a
// dark well in each dent. What is added on top is small: lamps, a grille, mirrors, a plate. See scripts/rally/parts.mjs for `loft`.
import { PAINT, RUBBER, CHROME, GLASS_COLOR, along, lerp, loft, box, mul, r2, setPivot, pivot, wheel } from "./parts.mjs";

/// The half section at one station, the points from the middle of the underside round to the middle of the roof (10 points, 9 quads):
/// 0 underside, 1 sill, 2 lower band, 3 lower side, 4 belt, 5 window, 6 gutter, 7 roof, 8 stripe. `bed` (the floor height) makes the open
/// load bed of a pickup: the wall's top, down its inside, and the floor.
function ring(p) {
  const { w, yb, belt, top, roofW } = p;
  const sx = p.stripe ?? 1.4;
  if (p.bed !== undefined) {
    const fl = p.bed;
    return [[0, yb], [Math.max(w - 3.8, 1), yb], [w - 1.5 + (p.sillX ?? 0), yb + 2.3], [w + (p.dentLo ?? 0), yb + (belt - yb) * (p.lowFrac ?? 0.4)], [w + (p.flare ?? 0), belt],
      [w - 1.9 + (p.flare ?? 0) * 0.5, belt + 0.1], [w - 2.5, fl + (belt - fl) * 0.5], [w - 3.1, fl], [sx, fl], [0, fl]];
  }
  const y5 = Math.min(belt + 0.9, top - 0.5), y6 = lerp(y5, top - 0.3, 0.78);
  return [
    [0, yb],
    [Math.max(w - 3.8, 1), yb],
    [w - 1.5 + (p.sillX ?? 0), yb + 2.3],
    [w + (p.dentLo ?? 0), yb + (belt - yb) * (p.lowFrac ?? 0.4)],
    [w + (p.flare ?? 0), belt],
    [Math.min(w - 0.6, lerp(w, roofW, 0.15)) + (p.flare ?? 0) * 0.5, y5],
    [lerp(w - 0.6, roofW, 0.62), y6],
    [roofW, top - 0.3],
    [Math.min(sx, roofW * 0.8), top],
    [0, top],
  ];
}

export function buildBody(s) {
  setPivot(s.pivot ?? s.R);
  const { zr, zf } = s;
  const keys = new Set([zr, zf]);
  const near = (a, b) => Math.abs(a - b) < 0.45;
  const add = (z) => { if (z > zr && z < zf && ![...keys].some((k) => near(k, z))) keys.add(r2(z)); };
  for (const [z] of [...s.w, ...s.top, ...s.belt, ...s.yb, ...s.roofW]) add(z);
  for (const zc of s.wheelZ) for (const k of [-1.3, -0.9, -0.45, 0, 0.45, 0.9, 1.3]) add(zc + k * s.R);
  for (const [a, b] of s.sideWin) { add(a); add(b); }
  if (s.screen) { add(s.screen[0]); add(s.screen[1]); add(lerp(s.screen[0], s.screen[1], 0.5)); }
  if (s.rear) { add(s.rear[0]); add(s.rear[1]); }
  for (let z = zr + 4; z < zf; z += 5) add(z);
  let zs = [...keys].sort((a, b) => a - b);
  // door gaps: two rings a hair apart
  const gap = new Set(), wall = new Set();
  for (const z of s.seams ?? []) { zs = zs.filter((k) => !near(k, z) || k === zr || k === zf); zs.push(r2(z - 0.12), r2(z + 0.12)); gap.add(r2(z - 0.12)); }
  if (s.bed) for (const z of [s.bed[1]]) { zs = zs.filter((k) => !near(k, z)); zs.push(r2(z - 0.1), r2(z + 0.1)); gap.add(r2(z - 0.1)); wall.add(r2(z - 0.1)); }
  zs.sort((a, b) => a - b);
  const wheelDip = (z) => {
    if (s.noDent) return 0;
    let f = 0;
    for (const zc of s.wheelZ) { const d = Math.abs(z - zc) / (s.R * 1.32); if (d < 1) f = Math.max(f, Math.cos((d * Math.PI) / 2) ** 1.4); }
    return f;
  };
  const stations = zs.map((z) => {
    const f = wheelDip(z);
    const p = { w: along(s.w, z), yb: along(s.yb, z), belt: along(s.belt, z), top: along(s.top, z), roofW: along(s.roofW, z), sillX: -2.4 * f, dentLo: -(s.dent ?? 3.0) * f, flare: (s.flare ?? 0.8) * f, stripe: s.stripe?.half, lowFrac: s.lowFrac };
    if (s.bed && z >= s.bed[0] && z <= s.bed[1]) p.bed = s.bed[2];
    // the underside lifts over the wheels so the arch has room
    p.yb += 0;
    return { z, pts: ring(p), f };
  });
  const inRange = (z, list) => list.some(([a, b]) => z >= a && z <= b);
  const dark = s.sill ?? "#1d1e24", band = s.band ?? s.paint, bumper = s.bumper ?? dark, glass = GLASS_COLOR;
  const colorOf = (i0, i1, j, z) => {
    const st = stations[i0];
    if (wall.has(r2(st.z))) return s.paint; // the cab's back panel at the front of a load bed
    const inBed = s.bed && z >= s.bed[0] && z <= s.bed[1];
    if (inBed) return j === 7 || j === 8 ? s.bedFloor ?? "#2a2c33" : j === 6 ? mul(s.paint, 0.8) : j <= 1 ? dark : j === 2 ? band : s.paint;
    const g = gap.has(r2(st.z)) && j >= 2 && j <= 6;
    if (g) return mul(s.paint, 0.5);
    for (const pn of s.panels ?? []) if (z >= pn.z[0] && z <= pn.z[1] && pn.js.includes(j)) return pn.color;
    if (s.cockpit && z >= s.cockpit[0] && z <= s.cockpit[1] && (j === 7 || j === 8 || j === 6)) return s.cockpitColor ?? "#14151a";
    const endBumper = z < zr + (s.bumperLen ?? 3.2) || z > zf - (s.bumperLen ?? 3.2);
    if (j === 0) return dark;
    if (endBumper && j <= 2) return bumper;
    if (j === 1) return dark;
    if (s.archTrim && st.f > 0.3 && (j === 2 || j === 3)) return s.archTrim;
    if (j === 2) return band;
    if (j === 3) return s.lower ?? s.paint;
    if (j === 4) return s.paint;
    if (j === 5) return inRange(z, s.sideWin) ? glass : s.paint;
    const screen = s.screen && z >= s.screen[0] && z <= s.screen[1];
    const rear = s.rear && z >= s.rear[0] && z <= s.rear[1];
    if (j === 6) return s.paint;
    const onRoof = s.screen && z <= s.screen[0] && (!s.rear || z >= s.rear[1]) || (!s.screen && !s.rear);
    if (j === 7) return screen || rear ? glass : onRoof ? s.roof ?? s.paint : s.paint;
    return screen || rear ? glass : s.stripe?.color ?? (onRoof ? s.roof ?? s.paint : s.paint); // j === 8, the stripe column
  };
  // quad j runs between ring points j and j+1: 0 underside, 1 sill, 2 lower band, 3 lower side, 4 belt, 5 window, 6 gutter, 7 roof
  const creaseOf = (i, j, kind) => {
    if (kind === "across") return j === 2 ? 0.6 : j === 4 ? 0.45 : j === 5 ? 0.5 : j === 6 ? 0.4 : j === 1 ? 0.5 : 0;
    return 0;
  };
  const body = loft("body", stations, { colorOf, creaseOf, subsurf: [1, s.renderLevels ?? 1] });
  const cubes = [body];
  const { zr: ZR, zf: ZF } = s;
  const endW = (z) => along(s.w, z);
  if (s.bare) { for (const fn of s.extras ?? []) fn({ cubes, box, s, along });
    const parts0 = [{ name: "body", origin: [0, pivot(), 0], rotation: [0, 0, 0], cubes, children: [] }, wheel("wheel_fl", -1, s.wheelZ[0], s), wheel("wheel_fr", 1, s.wheelZ[0], s), wheel("wheel_rl", -1, s.wheelZ[1], { ...s, R: s.Rr ?? s.R, tw: s.twr ?? s.tw }), wheel("wheel_rr", 1, s.wheelZ[1], { ...s, R: s.Rr ?? s.R, tw: s.twr ?? s.tw })];
    return { model: { version: 1, scale: 0.0625, parts: parts0 }, tail: { z: r2(ZR / 16), y: r2(7.5 / 16 - 0.06), x: 0 } }; }
  const lampY = s.lampY ?? ((along(s.belt, ZF) + along(s.yb, ZF)) / 2 + 1.5);
  // the lights, grille and plate, sunk into the end faces
  const hw = along(s.w, ZF - 3); // the width a little behind the tapering tip: the lamps sit out at the corners
  // ---- the front: headlights in one of several styles, a grille in another, so the families do not share a face ----
  const style = s.lamps ?? "rect", grille = s.grille ?? "bars";
  const LENS = "#fff3cf", RIM = "#20222a";
  const lampBox = (side, cx, cy, w, h, tag) => {
    const x0 = side * cx - w / 2, x1 = side * cx + w / 2;
    cubes.push(box(`headlight ${tag}${side}`, Math.min(x0, x1), Math.max(x0, x1), cy - h / 2, cy + h / 2, ZF - 2.4, ZF + 0.25, LENS, { bevel: 0.5, segs: 2, emissive: 0.95 }));
    cubes.push(box(`headlight rim ${tag}${side}`, Math.min(x0, x1) - 0.45, Math.max(x0, x1) + 0.45, cy - h / 2 - 0.45, cy + h / 2 + 0.45, ZF - 2.5, ZF + 0.05, RIM, { bevel: 0.35, segs: 1, material: RUBBER }));
  };
  const lampRound = (side, cx, cy, r, tag) => {
    const disc = (name, rr, d, color, z, extra) => Object.assign({ name: `${name} ${tag}${side}`, shape: "cylinder", from: [side * cx - rr, cy - d / 2 - pivot(), z - rr], size: [2 * rr, d, 2 * rr], rotation: [90, 0, 0], color, segments: 18, smooth: true }, extra);
    cubes.push(disc("headlight rim", r + 0.55, 2.2, RIM, ZF - 1.0, RUBBER), disc("headlight", r, 2.6, LENS, ZF - 0.9, { emissive: 0.95, metallic: 0, roughness: 0.2 }));
  };
  let inner; // the nearest a lamp's edge comes to the middle: the grille stops short of it
  if (style === "round") { const x = hw - 3.4; for (const side of [-1, 1]) lampRound(side, x, lampY, 2.6, ""); inner = x - 3.2; }
  else if (style === "round2") { for (const side of [-1, 1]) { lampRound(side, hw - 2.4, lampY, 1.7, "a"); lampRound(side, hw - 6.4, lampY, 1.7, "b"); } inner = hw - 6.4 - 2.3; }
  else if (style === "slit") { const x = hw - 5.4; for (const side of [-1, 1]) lampBox(side, x, lampY + 0.4, 9.2, 1.7, ""); inner = x - 4.6 - 0.45; }
  else if (style === "tall") { const x = hw - 2.8; for (const side of [-1, 1]) lampBox(side, x, lampY + 0.4, 3.6, 5.0, ""); inner = x - 1.8 - 0.45; }
  else if (style === "quad") { const x = hw - 4.2; for (const side of [-1, 1]) { lampBox(side, x, lampY + 1.2, 4.6, 1.5, "a"); lampBox(side, x, lampY - 1.0, 4.6, 1.5, "b"); } inner = x - 2.3 - 0.45; }
  else { const x = hw - 3.9; for (const side of [-1, 1]) lampBox(side, x, lampY, 6.2, 2.8, ""); inner = x - 3.1 - 0.45; }
  if (!s.noFog) for (const side of [-1, 1]) cubes.push(box(`fog ${side}`, side * (hw - 4.8) - 1.3, side * (hw - 4.8) + 1.3, along(s.yb, ZF) + 2.2, along(s.yb, ZF) + 3.4, ZF - 2.2, ZF + 0.3, "#ffe07a", { bevel: 0.25, segs: 1, emissive: 0.6 }));
  const gw = Math.max(inner - 0.9, 2), dk = "#101116", slat = "#9aa0aa";
  const gz = [ZF - 0.6, ZF + 0.2];
  if (grille === "kidney") for (const side of [-1, 1]) { const x0 = side * 0.7, x1 = side * (gw - 0.2); cubes.push(box(`grille ${side}`, Math.min(x0, x1), Math.max(x0, x1), lampY - 1.7, lampY + 1.5, gz[0], gz[1], dk, { bevel: 0.45, segs: 2, material: RUBBER }), box(`grille slat ${side}`, Math.min(x0, x1) + 0.4, Math.max(x0, x1) - 0.4, lampY - 0.1, lampY + 0.3, gz[0], gz[1] + 0.1, slat, { material: CHROME })); }
  else if (grille === "mouth") { const yb0 = along(s.yb, ZF); cubes.push(box("grille mouth", -(hw - 5.2), hw - 5.2, yb0 + 1.4, yb0 + 4.4, ZF - 1.6, ZF + 0.1, dk, { bevel: 0.5, segs: 2, material: RUBBER }), box("grille mouth bar", -(hw - 5.6), hw - 5.6, yb0 + 2.7, yb0 + 3.1, ZF - 1.5, ZF + 0.2, slat, { material: CHROME })); }
  else if (grille === "blackout") cubes.push(box("grille", -gw, gw, lampY - 1.4, lampY + 1.3, gz[0], gz[1], dk, { bevel: 0.35, segs: 1, material: RUBBER }));
  else if (grille === "mesh") { cubes.push(box("grille", -gw, gw, lampY - 1.7, lampY + 1.5, gz[0], gz[1], dk, { bevel: 0.35, segs: 1, material: RUBBER })); for (let k = -2; k <= 2; k++) cubes.push(box("grille mesh", k * gw * 0.4 - 0.18, k * gw * 0.4 + 0.18, lampY - 1.6, lampY + 1.4, gz[0], gz[1] + 0.1, slat, { material: CHROME })); for (const y of [-0.6, 0.6]) cubes.push(box("grille mesh bar", -gw + 0.4, gw - 0.4, lampY + y - 0.15, lampY + y + 0.15, gz[0], gz[1] + 0.1, slat, { material: CHROME })); }
  else { cubes.push(box("grille", -gw, gw, lampY - 1.7, lampY + 1.5, gz[0], gz[1], dk, { bevel: 0.35, segs: 1, material: RUBBER })); for (const y of [-0.9, 0, 0.9]) cubes.push(box("grille bar", -gw + 0.5, gw - 0.5, lampY + y - 0.14, lampY + y + 0.14, gz[0], gz[1] + 0.15, slat, { material: CHROME })); }
  // ---- the rear: brake lamps in one of several styles at one place: the game draws the brake glow there (TAIL in entities/car.lua) ----
  const tw0 = along(s.w, ZR + 3), ty = s.tailY ?? (along(s.belt, ZR) - 1.2);
  const lx = tw0 - 3.8, ly = ty - 2.4, tails = s.tails ?? "bar", RED = "#e8202c", BRAKE = "#ff5a3a";
  if (tails === "bar") {
    cubes.push(box("tail light bar", -tw0 + 2.4, tw0 - 2.4, ty - 1.0, ty + 1.0, ZR - 0.25, ZR + 2.4, RED, { bevel: 0.4, segs: 2, emissive: 0.9 }));
    for (const side of [-1, 1]) cubes.push(box(`brake light ${side}`, side * lx - 2.2, side * lx + 2.2, ly - 1.0, ly + 1.0, ZR - 0.25, ZR + 2.2, BRAKE, { bevel: 0.3, segs: 1, emissive: 0.75 }));
  } else if (tails === "pair") {
    for (const side of [-1, 1]) cubes.push(box(`brake light ${side}`, side * lx - 3.0, side * lx + 3.0, ly - 1.7, ly + 1.7, ZR - 0.25, ZR + 2.2, RED, { bevel: 0.5, segs: 2, emissive: 0.85 }));
  } else if (tails === "round") {
    for (const side of [-1, 1]) cubes.push(Object.assign({ name: `brake light ${side}`, shape: "cylinder", from: [side * lx - 2.4, ly - 1.0 - pivot(), ZR - 1.2 - 2.4], size: [4.8, 2.0, 4.8], rotation: [90, 0, 0], color: RED, segments: 16, smooth: true, emissive: 0.85, metallic: 0, roughness: 0.2 }), Object.assign({ name: `brake ring ${side}`, shape: "cylinder", from: [side * lx - 3.0, ly - 0.7 - pivot(), ZR - 0.8 - 3.0], size: [6.0, 1.4, 6.0], rotation: [90, 0, 0], color: RIM, segments: 16, smooth: true }, RUBBER));
  } else if (tails === "tall") {
    for (const side of [-1, 1]) cubes.push(box(`brake light ${side}`, side * lx - 1.6, side * lx + 1.6, ly - 3.0, ly + 3.0, ZR - 0.25, ZR + 2.2, RED, { bevel: 0.5, segs: 2, emissive: 0.85 }));
  }
  cubes.push(box("plate", -3.2, 3.2, along(s.yb, ZR) + 2.4, along(s.yb, ZR) + 4.8, ZR - 0.5, ZR + 0.2, "#f0f0ea", { material: RUBBER }));
  // the dark wheel wells, sitting in the dents
  for (const side of [-1, 1]) for (const zc of s.wheelZ) {
    cubes.push(Object.assign({ name: "wheel well", shape: "cylinder", from: [side * (along(s.w, zc) - (s.dent ?? 3.0) - 0.6) - s.R * 1.18, s.R - pivot() - 0.4, zc - s.R * 1.18], size: [s.R * 2.36, 0.8, s.R * 2.36], rotation: [0, 0, 90], color: "#0c0d11", segments: 24, smooth: true }, RUBBER));
  }
  for (const side of [-1, 1]) {
    const mz = (s.screen ? s.screen[1] : zf - 20) - 1.2, mx = along(s.w, mz) + 0.5, my = along(s.belt, mz) + 1.8;
    cubes.push(box(`mirror ${side}`, side * mx - 1.1, side * mx + 1.1, my - 1.3, my + 1.3, mz - 1.3, mz + 1.3, s.paint, { bevel: 0.5, segs: 2, material: PAINT }));
  }
  if (s.exhaust) for (const side of [-1, 1]) cubes.push(Object.assign({ name: `exhaust ${side}`, shape: "cylinder", from: [side * 5.2 - 1.1, along(s.yb, ZR) + 0.9 - pivot(), ZR - 3.0], size: [2.2, 2.2, 2.2], rotation: [90, 0, 0], color: "#aeb4be", segments: 12, smooth: true }, CHROME));
  for (const fn of s.extras ?? []) fn({ cubes, box, s, along });
  const parts = [{ name: "body", origin: [0, pivot(), 0], rotation: [0, 0, 0], cubes, children: [] },
    wheel("wheel_fl", -1, s.wheelZ[0], s), wheel("wheel_fr", 1, s.wheelZ[0], s), wheel("wheel_rl", -1, s.wheelZ[1], s), wheel("wheel_rr", 1, s.wheelZ[1], s)];
  return { model: { version: 1, scale: 0.0625, parts }, tail: { z: r2((ZR - 0.25) / 16), y: r2(ly / 16 - 0.06), x: r2(lx / 16 / 0.92) } };
}
