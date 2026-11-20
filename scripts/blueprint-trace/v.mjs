// node v.mjs <car> <view> x0 y0 x1 y1 zoom [step] -> out/<car>_<view>_<n>.png
import { load, view } from "./img.mjs";
import { CAL } from "./cal.mjs";
const [car, vw, x0, y0, x1, y1, zoom, step, name] = process.argv.slice(2);
const img = load(`${process.env.BP ?? "build/blueprints"}/${car}.png`);
view(img, `${process.env.OUT ?? "build/blueprint-trace"}/${name ?? `${car}_${vw}`}.png`, [+x0, +y0, +x1, +y1], +zoom, CAL[car][vw], +(step ?? 1));
