import { load, solid, columns, rows } from "./img.mjs";
import { CAL, RECTS } from "./cal.mjs";
const r1 = (v) => Math.round(v * 10) / 10;
export function side(car, rect, min = 6) {
  const img = load(`${process.env.BP ?? "build/blueprints"}/${car}.png`), cal = CAL[car].side, s = solid(img, rect), c = columns(s, min), rw = rows(s, min);
  const U = (px) => ((px - cal.ox) / cal.k) * cal.sx, V = (py) => (cal.oy - py) / (cal.ky ?? cal.k);
  const top = [], bot = [];
  for (let i = 0; i < c.length; i++) if (c[i]) { top.push([U(i + rect[0]), V(c[i][0])]); bot.push([U(i + rect[0]), V(c[i][1])]); }
  const nose = [], tail = [];
  for (let j = 0; j < rw.length; j++) if (rw[j]) { nose.push([V(j + rect[1]), U(rw[j][0])]); tail.push([V(j + rect[1]), U(rw[j][1])]); }
  return { top, bot, nose, tail };
}
export function plan(car, rect, min = 6) {
  const img = load(`${process.env.BP ?? "build/blueprints"}/${car}.png`), cal = CAL[car].top, s = solid(img, rect), c = columns(s, min);
  const U = (px) => ((px - cal.ox) / cal.k) * cal.sx, V = (py) => (cal.oy - py) / (cal.ky ?? cal.k);
  return c.map((v, i) => (v ? [U(i + rect[0]), V(v[0]), -V(v[1])] : null)).filter(Boolean);
}
export function front(car, vw, rect, min = 6) {
  const img = load(`${process.env.BP ?? "build/blueprints"}/${car}.png`), cal = CAL[car][vw], s = solid(img, rect), rw = rows(s, min), c = columns(s, min);
  const U = (px) => (px - cal.ox) / cal.k, V = (py) => (cal.oy - py) / (cal.ky ?? cal.k);
  return { byY: rw.map((v, j) => (v ? [V(j + rect[1]), -U(v[0]), U(v[1])] : null)).filter(Boolean), byX: c.map((v, i) => (v ? [U(i + rect[0]), V(v[0])] : null)).filter(Boolean) };
}
export const sample = (pts, at, tol = 0.06) => { let best = null; for (const p of pts) if (best === null || Math.abs(p[0] - at) < Math.abs(best[0] - at)) best = p; return best && Math.abs(best[0] - at) <= tol ? best.slice(1).map(r1) : null; };
if (process.argv[1].endsWith("sil.mjs")) {
  const car = process.argv[2];
  const R = RECTS[car], none = { top: [], bot: [], nose: [], tail: [] }, noF = { byY: [], byX: [] };
  const s = R.side ? side(car, R.side) : none, p = R.top ? plan(car, R.top) : [], f = R.front ? front(car, "front", R.front) : noF, b = R.rear ? front(car, "rear", R.rear) : noF;
  const zs = []; for (let z = 75; z >= -75; z -= 1) zs.push(z);
  console.log("SIDE z: top bottom | PLAN z: +x -x");
  for (const z of zs) { const t = sample(s.top, z), bt = sample(s.bot, z), pl = sample(p, z); if (t || pl) console.log(z, t?.[0], bt?.[0], "|", pl?.join(" ")); }
  console.log("NOSE/TAIL by y: noseZ tailZ | FRONT by y: -x +x | REAR by y: -x +x");
  for (let y = 0.5; y <= 52; y += 0.5) { const n = sample(s.nose, y), t = sample(s.tail, y), fr = sample(f.byY, y), re = sample(b.byY, y); if (n || fr || re) console.log(y, n?.[0], t?.[0], "|", fr?.join(" "), "|", re?.join(" ")); }
  console.log("FRONT top by x:", Array.from({ length: 24 }, (_, i) => i).map((x) => `${x}:${sample(f.byX, x)?.[0]}/${sample(f.byX, -x)?.[0]}`).join(" "));
  console.log("REAR top by x:", Array.from({ length: 24 }, (_, i) => i).map((x) => `${x}:${sample(b.byX, x)?.[0]}/${sample(b.byX, -x)?.[0]}`).join(" "));
}
