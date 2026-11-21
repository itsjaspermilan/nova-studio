// A contact sheet of animations of a sprite: scripts/env.sh node examples/neon-undertow/tools/sheet.mjs <sprite> <out.png> <scale> <tag> [tag ...]
// One row per tag, its frames side by side on a dark ground (a tag name with * at the end takes every tag that starts so). `add` as the
// last argument draws the frames as light (blend add), as the game does for glows.
import fs from "node:fs";
import { Canvas, readPng } from "./pnglib.mjs";
const project = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const [name, out, scaleArg, ...rest] = process.argv.slice(2);
const add = rest[rest.length - 1] === "add"; if (add) rest.pop();
const scale = Number(scaleArg) || 1;
const json = JSON.parse(fs.readFileSync(`${project}/sprites/${name}.sprite.json`, "utf8"));
const img = readPng(`${project}/sprites/${name}.png`);
const fw = json.frame_width, fh = json.frame_height, cols = json.columns;
const tags = (json.tags ?? []).filter((t) => rest.some((r) => (r.endsWith("*") ? t.name.startsWith(r.slice(0, -1)) : t.name === r)));
const frames = rest.length ? tags.map((t) => ({ name: t.name, from: t.from, to: t.to })) : [{ name: "all", from: 0, to: json.frames - 1 }];
const maxN = Math.max(...frames.map((t) => t.to - t.from + 1));
const per = rest.length ? maxN : Math.min(json.frames, 12);
const rows = rest.length ? frames.length : Math.ceil(json.frames / per);
const c = new Canvas(per * fw * scale, rows * fh * scale);
frames.forEach((t, r) => { for (let i = t.from; i <= t.to; i++) {
  const n = rest.length ? i - t.from : i % per, row = rest.length ? r : Math.floor(i / per);
  c.put(img, (i % cols) * fw, Math.floor(i / cols) * fh, fw, fh, n * fw * scale, row * fh * scale, scale, add);
} });
c.save(out);
console.log("sheet:", out, c.w + "x" + c.h);
