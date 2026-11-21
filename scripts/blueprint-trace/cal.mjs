import { existsSync, readdirSync, readFileSync } from "node:fs";
// pixels per model unit (1/16 m) and where (0, 0) is in each view. side/top: u = z (nose to the left: sx -1); front/rear: u = x.
export const CAL = {
  gt: {
    side: { ox: 748.1, oy: 1113, k: 18.43, sx: -1 },
    top: { ox: 749.1, oy: 1680, k: 18.43, sx: -1 },
    front: { ox: 318, oy: 432, k: 18.98, sx: 1 },
    rear: { ox: 1099, oy: 432, k: 18.44, sx: 1 },
  },
  lc: {
    side: { ox: 1466, oy: 495, k: 15.12, ky: 15.64, sx: -1 },
    top: { ox: 1445, oy: 984, k: 15.12, ky: 16.33, sx: -1 },
    front: { ox: 352, oy: 495, k: 16.37, ky: 15.6, sx: 1 },
    rear: { ox: 352, oy: 1256, k: 16.37, ky: 15.6, sx: 1 },
  },
};
/// The view rectangles (pixels: x0, y0, x1, y1) that `sil.mjs` flood-fills, by car.
export const RECTS = {
  gt: { side: [20, 660, 1462, 1108], top: [20, 1340, 1462, 1995], front: [5, 5, 700, 428], rear: [760, 5, 1460, 428] },
  lc: { side: [960, 10, 1995, 492], top: [940, 730, 1995, 1262], front: [70, 10, 640, 492], rear: [70, 700, 640, 1250] },
};
// Every later car keeps its own numbers beside its model script: scripts/rally/cars/<car>.trace.json = { "cal": { side, top, front, rear }, "rects": { ... } }
// (a view the drawing lacks is left out).
const dir = new URL("../../studio/mcp/makers/car/cars/", import.meta.url);
if (existsSync(dir)) for (const f of readdirSync(dir).filter((f) => f.endsWith(".trace.json"))) {
  const t = JSON.parse(readFileSync(new URL(f, dir), "utf8")), car = f.replace(".trace.json", "");
  CAL[car] = t.cal; RECTS[car] = t.rects ?? {};
}
