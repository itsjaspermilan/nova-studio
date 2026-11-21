// blueprint_trace: reading a car's drawing (a blueprint with side, plan, front and rear views) into numbers for car_make's `spec`.
// The tools Pine Ridge Rally's cars were traced with (scripts/blueprint-trace, now here): look at the whole sheet with a pixel
// grid, calibrate each view on its own dimension line, cut out gridded enlargements in model units, and read the outlines by
// flood fill. The drawing stays where it is (outside the repository and the project): the tool only reads it, by its path.
// Model units are 16 to the metre, as in the car kit; in the side and plan views u is z (the nose's way), in the front and rear views u is x.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Raster } from "../../src/lib/pixels";
import type { Host } from "./index";
// @ts-ignore (plain JavaScript, moved from scripts/blueprint-trace)
import { Canvas, columns, load, rows, solid, view } from "./car/trace-img.mjs";

type Args = Record<string, any>;
interface Cal { ox: number; oy: number; k: number; ky?: number; sx: number }
type Views = Partial<Record<"side" | "top" | "front" | "rear", Cal>>;
type Rect = [number, number, number, number];

const VIEWS = ["side", "top", "front", "rear"] as const;
const r1 = (v: number) => Math.round(v * 10) / 10;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/// The calibrations and view rectangles of the cars already traced (makers/car/cars/<key>.trace.json, and the first two).
export function knownTraces(): Record<string, { cal: Views; rects: Partial<Record<string, Rect>> }> {
  const out: Record<string, { cal: Views; rects: Partial<Record<string, Rect>> }> = {
    gt: { cal: { side: { ox: 748.1, oy: 1113, k: 18.43, sx: -1 }, top: { ox: 749.1, oy: 1680, k: 18.43, sx: -1 }, front: { ox: 318, oy: 432, k: 18.98, sx: 1 }, rear: { ox: 1099, oy: 432, k: 18.44, sx: 1 } }, rects: { side: [20, 660, 1462, 1108], top: [20, 1340, 1462, 1995], front: [5, 5, 700, 428], rear: [760, 5, 1460, 428] } },
    offroad: { cal: { side: { ox: 1466, oy: 495, k: 15.12, ky: 15.64, sx: -1 }, top: { ox: 1445, oy: 984, k: 15.12, ky: 16.33, sx: -1 }, front: { ox: 352, oy: 495, k: 16.37, ky: 15.6, sx: 1 }, rear: { ox: 352, oy: 1256, k: 16.37, ky: 15.6, sx: 1 } }, rects: { side: [960, 10, 1995, 492], top: [940, 730, 1995, 1262], front: [70, 10, 640, 492], rear: [70, 700, 640, 1250] } },
  };
  const dir = join(dirname(fileURLToPath(import.meta.url)), "car", "cars");
  // (the server runs bundled from build/: the car files are then found from the repository)
  const dirs = [dir, join(process.env.NOVA_REPO ?? join(dirname(fileURLToPath(import.meta.url)), ".."), "studio/mcp/makers/car/cars")];
  for (const d of dirs) if (existsSync(d)) for (const f of readdirSync(d).filter((f) => f.endsWith(".trace.json"))) {
    const t = JSON.parse(readFileSync(join(d, f), "utf8"));
    out[f.replace(".trace.json", "")] ??= { cal: t.cal, rects: t.rects ?? {} };
  }
  return out;
}

const toRaster = (c: { w: number; h: number; rgb: Uint8Array }): Raster => {
  const data = new Uint8ClampedArray(c.w * c.h * 4);
  for (let i = 0; i < c.w * c.h; i++) { data[i * 4] = c.rgb[i * 3]!; data[i * 4 + 1] = c.rgb[i * 3 + 1]!; data[i * 4 + 2] = c.rgb[i * 3 + 2]!; data[i * 4 + 3] = 255; }
  return { w: c.w, h: c.h, data };
};

/// The outlines of the views by flood fill (everything reachable from a rectangle's border through light pixels is outside).
export function silhouettes(img: Args, cal: Views, rects: Partial<Record<string, Rect>>, min = 6): string {
  const out: string[] = [];
  const near = (pts: number[][], at: number, tol = 0.06) => { let best: number[] | null = null; for (const p of pts) if (!best || Math.abs(p[0]! - at) < Math.abs(best[0]! - at)) best = p; return best && Math.abs(best[0]! - at) <= tol ? best.slice(1).map(r1) : null; };
  const side = { top: [] as number[][], bot: [] as number[][], nose: [] as number[][], tail: [] as number[][] };
  if (rects.side && cal.side) {
    const c = cal.side, s = solid(img, rects.side), cs = columns(s, min), rs = rows(s, min), r = rects.side;
    const U = (px: number) => ((px - c.ox) / c.k) * c.sx, V = (py: number) => (c.oy - py) / (c.ky ?? c.k);
    cs.forEach((v: number[] | null, i: number) => { if (v) { side.top.push([U(i + r[0]), V(v[0]!)]); side.bot.push([U(i + r[0]), V(v[1]!)]); } });
    rs.forEach((v: number[] | null, j: number) => { if (v) { side.nose.push([V(j + r[1]), U(v[0]!)]); side.tail.push([V(j + r[1]), U(v[1]!)]); } });
  }
  const plan: number[][] = [];
  if (rects.top && cal.top) {
    const c = cal.top, s = solid(img, rects.top), cs = columns(s, min), r = rects.top;
    const U = (px: number) => ((px - c.ox) / c.k) * c.sx, V = (py: number) => (c.oy - py) / (c.ky ?? c.k);
    cs.forEach((v: number[] | null, i: number) => { if (v) plan.push([U(i + r[0]), V(v[0]!), -V(v[1]!)]); });
  }
  const end = (vw: "front" | "rear") => {
    const res = { byY: [] as number[][], byX: [] as number[][] }, c = cal[vw], r = rects[vw];
    if (!c || !r) return res;
    const s = solid(img, r), rs = rows(s, min), cs = columns(s, min);
    const U = (px: number) => (px - c.ox) / c.k, V = (py: number) => (c.oy - py) / (c.ky ?? c.k);
    rs.forEach((v: number[] | null, j: number) => { if (v) res.byY.push([V(j + r[1]), -U(v[0]!), U(v[1]!)]); });
    cs.forEach((v: number[] | null, i: number) => { if (v) res.byX.push([U(i + r[0]), V(v[0]!)]); });
    return res;
  };
  const f = end("front"), b = end("rear");
  out.push("SIDE by z: top, underside | PLAN by z: half-width +x, -x   (model units, 16 to the metre)");
  for (let z = 75; z >= -75; z--) { const t = near(side.top, z), bt = near(side.bot, z), pl = near(plan, z); if (t || pl) out.push(`z ${z}: ${t?.[0] ?? "-"} ${bt?.[0] ?? "-"} | ${pl?.join(" ") ?? "-"}`); }
  out.push("BY HEIGHT y: nose z, tail z | FRONT -x, +x | REAR -x, +x");
  for (let y = 0.5; y <= 52; y += 0.5) { const n = near(side.nose, y), t = near(side.tail, y), fr = near(f.byY, y), re = near(b.byY, y); if (n || fr || re) out.push(`y ${y}: ${n?.[0] ?? "-"} ${t?.[0] ?? "-"} | ${fr?.join(" ") ?? "-"} | ${re?.join(" ") ?? "-"}`); }
  if (f.byX.length) out.push(`FRONT top by x: ${Array.from({ length: 24 }, (_, x) => `${x}:${near(f.byX, x)?.[0] ?? "-"}/${near(f.byX, -x)?.[0] ?? "-"}`).join(" ")}`);
  if (b.byX.length) out.push(`REAR top by x: ${Array.from({ length: 24 }, (_, x) => `${x}:${near(b.byX, x)?.[0] ?? "-"}/${near(b.byX, -x)?.[0] ?? "-"}`).join(" ")}`);
  return out.join("\n");
}

export function registerTrace(h: Host): Record<string, Args> {
  h.tool(
    "blueprint_trace",
    "Read a car's drawing (a blueprint: side, plan, front and rear views on one sheet) into numbers for car_make's `spec`, the way Pine Ridge Rally's cars were traced. `file` is the drawing's whole path (an 8-bit PNG; it is only read, never copied into the project). Model units are 16 to the metre: in the side and plan views u is z (along the car, + towards the nose), in the front and rear views u is x; v is always up (the ground is 0 in the side, front and rear views, the middle line in the plan). " +
      "`do`: \"overview\" (the whole sheet with a pixel grid every 100 px: find each view's rectangle and its dimension lines); \"calibrate\" (one view from two pixels a known distance apart: `view`, `from` and `to` [px, py], `length` in metres, `ground` the pixel row of the ground (side, front, rear) or of the middle line (plan), `zero` the pixel column of u = 0 (the middle between the axles, or the car's middle line in front and rear), `nose`: \"left\" or \"right\" for side and plan; `ky` from a second pair `from_v`, `to_v`, `length_v` when the drawing is not to one scale up and across): it answers the calibration and a gridded picture of the view to check it on (the wheels on 0, the roof at its stated height); \"crop\" (a gridded enlargement of part of a view: `view`, `rect` [x0, y0, x1, y1] in pixels or `region` [u0, v0, u1, v1] in model units, `zoom`, `step`: red numbers along, blue up); \"silhouette\" (the outlines by flood fill as numbers: the side's top line and underside by z, the plan's half-width by z, nose and tail by height, the front's and rear's width by height; `rects` gives each view's rectangle). " +
      "Give the calibrations of earlier calls back as `cal` ({ side, top, front, rear }: each { ox, oy, k, ky?, sx }), or `car` for one of the cars already traced (their numbers ship with Nova: " + "gt, offroad, s14, s15, city, cuda, gt2, hatch, hatch_r, pickup, rally, suv, truck), whose drawings are not in the repository.",
    {
      file: { type: "string", description: "The drawing's whole path (8-bit PNG)." },
      do: { type: "string", description: "overview, calibrate, crop or silhouette." },
      view: { type: "string", description: "side, top (the plan), front or rear." },
      cal: { type: "object", description: "The calibrations so far: { side: { ox, oy, k, sx }, top, front, rear }." },
      car: { type: "string", description: "A car already traced, for its calibrations and view rectangles." },
      from: { type: "array", items: { type: "number" }, description: "calibrate: the pixel [x, y] at one end of a dimension line." },
      to: { type: "array", items: { type: "number" }, description: "calibrate: the pixel at its other end." },
      length: { type: "number", description: "calibrate: what the dimension line measures, in metres." },
      ground: { type: "number", description: "calibrate: the pixel row of v = 0." },
      zero: { type: "number", description: "calibrate: the pixel column of u = 0." },
      nose: { type: "string", description: 'calibrate, side and top: "left" or "right" (where the front of the car is drawn).' },
      from_v: { type: "array", items: { type: "number" } },
      to_v: { type: "array", items: { type: "number" } },
      length_v: { type: "number", description: "calibrate: a vertical dimension, when the drawing is stretched up or across." },
      rect: { type: "array", items: { type: "number" }, description: "Pixels [x0, y0, x1, y1]." },
      region: { type: "array", items: { type: "number" }, description: "crop: model units [u0, v0, u1, v1] instead of pixels." },
      rects: { type: "object", description: "silhouette: each view's rectangle in pixels, { side: [x0, y0, x1, y1], top, front, rear }." },
      zoom: { type: "number", description: "crop: magnification (2 when left out)." },
      step: { type: "number", description: "crop: grid spacing in model units (1)." },
    },
    ["file", "do"],
    (a) => {
      const file = String(a.file);
      if (!existsSync(file)) throw new Error(`there is no drawing at ${file} (give its whole path)`);
      let img: Args;
      try {
        img = load(file);
      } catch (e) {
        throw new Error(`${file} is not a PNG this tool reads (8-bit, not interlaced): ${(e as Error).message}; convert it first (sips -s format png drawing.webp --out drawing.png)`);
      }
      const known = a.car !== undefined ? knownTraces()[String(a.car)] : undefined;
      if (a.car !== undefined && !known) throw new Error(`no car "${a.car}" has been traced; the traced cars are ${Object.keys(knownTraces()).join(", ")}`);
      const cal: Views = { ...(known?.cal ?? {}), ...(a.cal ?? {}) };
      const vw = a.view as (typeof VIEWS)[number] | undefined;
      if (vw !== undefined && !VIEWS.includes(vw)) throw new Error(`view is ${VIEWS.join(", ")}, not ${JSON.stringify(vw)}`);
      const picture = (label: string, c: { w: number; h: number; rgb: Uint8Array }) => h.keepPicture(label, toRaster(c));
      switch (a.do) {
        case "overview": {
          // the whole sheet, scaled to at most 1400 px across, with a pixel grid
          const z = Math.min(1, 1400 / img.w), w = Math.round(img.w * z), hh = Math.round(img.h * z), c = new Canvas(w, hh);
          for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) { const g = img.g[Math.min(img.h - 1, Math.floor(y / z)) * img.w + Math.min(img.w - 1, Math.floor(x / z))]; const i = (y * w + x) * 3; c.rgb[i] = c.rgb[i + 1] = c.rgb[i + 2] = g; }
          for (let p = 0; p < Math.max(img.w, img.h); p += 50) {
            const major = p % 100 === 0;
            if (p < img.w) { c.line(p * z, 0, p * z, hh, major ? [255, 0, 0] : [255, 170, 170], major ? 0.5 : 0.25); if (major) c.text(p * z + 2, 2, p, [200, 0, 0]); }
            if (p < img.h) { c.line(0, p * z, w, p * z, major ? [0, 0, 255] : [170, 170, 255], major ? 0.5 : 0.25); if (major) c.text(2, p * z + 2, p, [0, 0, 200]); }
          }
          return { text: `${file}: ${img.w} x ${img.h} pixels, shown at ${r3(z)} of its size; red numbers are pixel columns, blue are rows. Next: find each view's rectangle and a dimension line in it, then "calibrate".`, images: [picture("blueprint-overview", c)] };
        }
        case "calibrate": {
          if (!vw) throw new Error("say which `view` to calibrate");
          const need = ["from", "to", "length", "ground", "zero"].filter((k) => a[k] === undefined);
          if (need.length) throw new Error(`calibrate needs ${need.join(", ")}`);
          const [x0, y0] = a.from, [x1, y1] = a.to, px = Math.hypot(x1 - x0, y1 - y0), k = px / (Number(a.length) * 16);
          const c: Cal = { ox: Number(a.zero), oy: Number(a.ground), k: r3(k), sx: vw === "front" || vw === "rear" ? 1 : a.nose === "left" ? -1 : a.nose === "right" ? 1 : NaN };
          if (Number.isNaN(c.sx)) throw new Error('say where the nose is drawn in the side and plan views: `nose`: "left" or "right"');
          if (a.from_v && a.to_v && a.length_v) c.ky = r3(Math.hypot(a.to_v[0] - a.from_v[0], a.to_v[1] - a.from_v[1]) / (Number(a.length_v) * 16));
          cal[vw] = c;
          const rect: Rect = a.rect ?? known?.rects[vw] ?? [Math.max(0, c.ox - 40 * k * 16 * 0.15), Math.max(0, c.oy - 30 * k), Math.min(img.w, c.ox + 40 * k), Math.min(img.h, c.oy + 4 * k)];
          const out = `${file}`.replace(/[^\w]/g, "_").slice(-30);
          const zoom = Math.min(2, 1400 / Math.max(1, rect[2] - rect[0]));
          let pic = "";
          view(img, null, rect.map(Math.round), zoom, c, 5, null, (canvas: Args) => (pic = picture(`blueprint-${vw}-${out}`, canvas)));
          return {
            text: `${vw}: ${JSON.stringify(c)} (${r3(c.k)} pixels a model unit, ${r3(c.k * 16)} a metre). With the others so far, give this back as \`cal\`: ${JSON.stringify(cal)}. In the picture the grid is every 5 units (red along, blue up): check the wheels stand on 0 and the stated sizes land on their lines.`,
            images: pic ? [pic] : [],
          };
        }
        case "crop": {
          if (!vw) throw new Error("say which `view` to crop");
          const c = cal[vw];
          if (!c) throw new Error(`calibrate the ${vw} view first (or give \`cal\` or \`car\`)`);
          let rect: Rect;
          if (a.rect) rect = a.rect;
          else if (a.region) {
            const [u0, v0, u1, v1] = a.region, X = (u: number) => c.ox + c.sx * u * c.k, Y = (v: number) => c.oy - v * (c.ky ?? c.k);
            rect = [Math.min(X(u0), X(u1)), Math.min(Y(v0), Y(v1)), Math.max(X(u0), X(u1)), Math.max(Y(v0), Y(v1))];
          } else throw new Error("crop needs `rect` (pixels) or `region` (model units)");
          rect = [Math.max(0, Math.round(rect[0])), Math.max(0, Math.round(rect[1])), Math.min(img.w, Math.round(rect[2])), Math.min(img.h, Math.round(rect[3]))];
          const zoom = Number(a.zoom ?? 2);
          if ((rect[2] - rect[0]) * zoom > 4000 || (rect[3] - rect[1]) * zoom > 4000) throw new Error("that crop would be over 4000 pixels across: take a smaller part or a lower zoom");
          let pic = "";
          view(img, null, rect, zoom, c, Number(a.step ?? 1), null, (canvas: Args) => (pic = picture(`blueprint-crop-${vw}`, canvas)));
          return { text: `${vw}, pixels ${rect.join(", ")} at ${zoom}x; grid every ${a.step ?? 1} model unit${(a.step ?? 1) === 1 ? "" : "s"} (16 to the metre): red numbers along (u), blue up (v).`, images: [pic] };
        }
        case "silhouette": {
          const rects: Partial<Record<string, Rect>> = { ...(known?.rects ?? {}), ...(a.rects ?? {}) };
          if (!Object.keys(rects).length) throw new Error("silhouette needs `rects`: each view's rectangle in pixels, { side: [x0, y0, x1, y1], top, front, rear }");
          return silhouettes(img, cal, rects);
        }
        default:
          throw new Error(`do is overview, calibrate, crop or silhouette, not ${JSON.stringify(a.do)}`);
      }
    },
    );
  return { blueprint_trace: { file: "/path/to/drawing.png", do: "overview" } };
}
