// Checks the blueprint cars (scripts/rally/blueprint-car.mjs) against their drawings: the model's top line, underside and plan width, and the edges of its side
// glass, against the lines traced from each blueprint's side and plan views, and writes pictures with the model drawn over the blueprint.
//
//   scripts/env.sh node scripts/rally/blueprint-check.mjs [--bp folder] [--out folder] [car_coupe ...]
//
// The blueprints are not in the repository: convert each GIF/WEBP to a PNG in one folder as coupe.png, lc.png and gt.png first (macOS:
// `sips -s format png drawing.gif --out coupe.png`). Exit code 1 if a car is off by more than TOL units anywhere it can be compared.
import path from "node:path";
import fs from "node:fs";
import { loadRGB, writePNG } from "../lib/png.mjs";
import { SPECS, ringAt } from "./blueprint-car.mjs";

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const BP = opt("--bp", "/tmp/bp"), OUT = opt("--out", "build/blueprint-check");
const TOL = 0.9; // units (1/16 m): the details the drawings leave out (a wing, a mirror) are skipped, everything else has to agree to about 5 cm
const along = (nodes, z) => { if (z <= nodes[0][0]) return nodes[0][1]; for (let i = 1; i < nodes.length; i++) if (z <= nodes[i][0]) return nodes[i - 1][1] + ((nodes[i][1] - nodes[i - 1][1]) * (z - nodes[i - 1][0])) / (nodes[i][0] - nodes[i - 1][0] || 1); return nodes[nodes.length - 1][1]; };

// where each drawing puts the car: pixels per unit, the nose's pixel column and the z it stands for, the ground row, the height offset of the ground line, the
// plan view's centre row and band; `skip` lists z ranges to leave out of a comparison (parts the drawing shows that the model carries as details)
const CARS = {
  car_coupe: { png: "coupe.png", S: 12.15, x0: 22, zNose: 36.5, ground: 720, off: 0, plan: { cy: 1096, y0: 915, y1: 1275, both: true }, skipTop: [[-36.5, -30]], skipPlan: [[5, 10]], crop: [10, 440, 930, 740], zoom: 1.4 },
};

let failed = false;
fs.mkdirSync(OUT, { recursive: true });
for (const [name, c] of Object.entries(CARS)) {
  if (args.length && !args.includes(name)) continue;
  const s = SPECS[name], file = path.join(BP, c.png);
  if (!fs.existsSync(file)) { console.log(`${name}: no blueprint at ${file} (skipped)`); continue; }
  const img = loadRGB(file), S = c.S;
  const px = (z) => c.x0 + (c.zNose - z) * S, hy = (h) => c.ground - (h + c.off) * S;
  const skipped = (z, list) => list.some(([a, b]) => z >= a && z <= b);
  const errs = { top: [], plan: [], glassLo: [], glassHi: [] };
  const mark = []; // for the picture: [kind, pixel x, pixel y]
  // the top line: the distance from the model's top(z) to the nearest line in the drawing (searching 3 units either way), where the body is the nearest thing
  for (let z = s.zf - 1; z >= s.zr + 1; z -= 1) {
    if (skipped(z, c.skipTop)) continue;
    const x = Math.round(px(z)), mine = along(s.top, z), y0 = hy(mine); let best = 99;
    for (let d = 0; d <= 3 * S; d++) if (img.dark(x, Math.round(y0 - d)) || img.dark(x, Math.round(y0 + d))) { best = d / S; break; }
    errs.top.push(best); mark.push(["top", x, Math.round(y0)]);
  }
  // the plan width: the outline's extent in the model's column, on both sides (or the lower side only where the upper carries mirrors and hinges)
  for (let z = s.zf - 1; z >= s.zr + 1; z -= 1) {
    if (skipped(z, c.skipPlan)) continue;
    const x = Math.round(c.x0 + (c.zNose - z) * S); // the plan view shares the side view's columns
    const run = (y, dy) => { let n = 0; for (let yy = y; yy > c.plan.y0 && yy < c.plan.y1; yy += dy) { if (img.dark(x, yy) && img.dark(x + 1, yy)) return Math.abs(yy - c.plan.cy) / S; if (++n > c.plan.y1) break; } return null; };
    const lo = run(c.plan.y1 - 2, -1), hi = c.plan.both ? run(c.plan.y0 + 2, 1) : lo;
    if (lo === null) continue;
    const real = hi === null ? lo : (lo + hi) / 2, mine = along(s.w, z);
    errs.plan.push(Math.abs(real - mine));
  }
  // the side glass: my glass edges (ring points 7 and 8), against the nearest line the draftsman drew
  for (const [a, b] of s.sideWin) for (let z = a + 0.5; z <= b - 0.5; z += 0.5) {
    const r = ringAt(s, z);
    for (const [key, h] of [["glassLo", r[7][1]], ["glassHi", r[8][1]]]) {
      const x = Math.round(px(z)), y0 = hy(h); let best = 99;
      for (let d = 0; d <= 3 * S; d++) if (img.dark(x, Math.round(y0 - d)) || img.dark(x, Math.round(y0 + d))) { best = d / S; break; }
      errs[key].push(best); mark.push([key, x, Math.round(y0)]);
    }
  }
  const stat = (a) => { const v = a.filter((q) => q < 99).sort((p, q) => p - q); return v.length ? { n: v.length, mean: v.reduce((m, q) => m + q, 0) / v.length, p95: v[Math.floor(v.length * 0.95)], max: v[v.length - 1] } : null; };
  console.log(name);
  for (const [k, label] of [["top", "top line vs nearest drawn line"], ["plan", "half-width vs plan view"], ["glassLo", "glass lower edge vs nearest drawn line"], ["glassHi", "glass upper edge vs nearest drawn line"]]) {
    const st = stat(errs[k]);
    if (!st) { console.log(`  ${label.padEnd(40)} (nothing to compare)`); continue; }
    const bad = st.p95 > TOL; failed ||= bad;
    console.log(`  ${label.padEnd(40)} mean ${st.mean.toFixed(2)}  95% ${st.p95.toFixed(2)}  worst ${st.max.toFixed(2)}  (${st.n} points)${bad ? "   <-- off by more than " + TOL : ""}`);
  }
  // the picture: the blueprint crop with the model's lines drawn on it
  const [cx0, cy0, cx1, cy1] = c.crop, z = c.zoom, W = Math.round((cx1 - cx0) * z), H = Math.round((cy1 - cy0) * z), out = Buffer.alloc(W * H * 3, 255);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const sx = Math.min(img.W - 1, Math.round(cx0 + x / z)), sy = Math.min(img.H - 1, Math.round(cy0 + y / z)); const g = img.dark(sx, sy) ? 50 : 238, o = (y * W + x) * 3; out[o] = out[o + 1] = out[o + 2] = g; }
  const dot = (X, Y, col) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = Math.round((X - cx0) * z) + dx, yy = Math.round((Y - cy0) * z) + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) { const o = (yy * W + xx) * 3; out[o] = col[0]; out[o + 1] = col[1]; out[o + 2] = col[2]; } } };
  for (const [kind, X, Y] of mark) dot(X, Y, kind === "top" ? [230, 30, 30] : [20, 120, 255]);
  const png = path.join(OUT, `${name}.png`); writePNG(png, W, H, out); console.log(`  picture: ${png}`);
}
process.exit(failed ? 1 : 0);
