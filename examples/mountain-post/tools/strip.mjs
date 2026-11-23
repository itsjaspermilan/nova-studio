// Tiles pictures into one contact sheet (a frame strip): scripts/env.sh node examples/mountain-post/tools/strip.mjs out.png cols scale in1.png in2.png ...
import { readPng, writePng } from "../../../scripts/pnglib.mjs";

const [out, colsArg, scaleArg, ...files] = process.argv.slice(2);
const cols = Number(colsArg), k = Number(scaleArg);
const imgs = files.map((f) => readPng(f));
const tw = Math.floor(imgs[0].w / k), th = Math.floor(imgs[0].h / k);
const rows = Math.ceil(imgs.length / cols);
const W = cols * tw, H = rows * th;
const px = new Uint8Array(W * H * 4).fill(20);
imgs.forEach((im, n) => {
  const ox = (n % cols) * tw, oy = Math.floor(n / cols) * th;
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const acc = [0, 0, 0, 0];
      for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) {
        const i = ((y * k + dy) * im.w + x * k + dx) * 4;
        for (let c = 0; c < 4; c++) acc[c] += im.data[i + c];
      }
      const o = ((oy + y) * W + ox + x) * 4;
      for (let c = 0; c < 4; c++) px[o + c] = Math.round(acc[c] / (k * k));
    }
  }
});
writePng(out, W, H, px);
console.log(`${out}: ${imgs.length} pictures, ${W}x${H}`);
