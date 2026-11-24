// The valley's ground as the game has it (terrain/valley.png and the nova.terrain line in lib/terrain_line.lua), read back for the
// recipes that place things by the lie of the land (tools/bounds.mjs: steep banks, the playable area's edge). `height(x, z)` in Nova's
// metres (x, z, not east and north), blended between the samples exactly as the engine does (bilinear, held at the edges).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { GAME } from "./lib.mjs";

let cached = null;
export function ground() {
  if (cached) return cached;
  const line = readFileSync(join(GAME, "lib/terrain_line.lua"), "utf8");
  const num = (k) => Number(new RegExp(`${k} = (-?[0-9.]+)`).exec(line)[1]);
  const x0 = num("x"), z0 = num("z"), size = num("size"), height = num("height");
  const b = readFileSync(join(GAME, "terrain/valley.png"));
  let w = 0, h = 0, depth = 8, type = 0;
  const idat = [];
  for (let i = 8; i + 8 <= b.length;) {
    const n = b.readUInt32BE(i), id = b.toString("latin1", i + 4, i + 8);
    if (id === "IHDR") { w = b.readUInt32BE(i + 8); h = b.readUInt32BE(i + 12); depth = b[i + 16]; type = b[i + 17]; }
    else if (id === "IDAT") idat.push(b.subarray(i + 8, i + 8 + n));
    i += 12 + n;
  }
  const ch = type === 0 ? 1 : type === 2 ? 3 : type === 4 ? 2 : 4, bpp = ch * (depth / 8), stride = w * bpp;
  const raw = inflateSync(Buffer.concat(idat)), out = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0, u = y ? out[(y - 1) * stride + x] : 0, c = x >= bpp && y ? out[(y - 1) * stride + x - bpp] : 0;
      let v = raw[y * (stride + 1) + 1 + x];
      if (f === 1) v += a; else if (f === 2) v += u; else if (f === 3) v += (a + u) >> 1;
      else if (f === 4) { const p = a + u - c, pa = Math.abs(p - a), pb = Math.abs(p - u), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? u : c; }
      out[y * stride + x] = v & 255;
    }
  }
  const v = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * bpp;
    v[i] = (depth === 16 || ch >= 3 ? (out[o] * 256 + out[o + 1]) / 65535 : out[o] / 255) * height;
  }
  const cell = size / (w - 1);
  const clamp = (a, lo, hi) => Math.max(lo, Math.min(hi, a));
  const heightAt = (x, z) => {
    const fx = clamp((x - x0) / cell, 0, w - 1.0001), fz = clamp((z - z0) / cell, 0, h - 1.0001);
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const a = v[j * w + i], bb = v[j * w + i + 1], c = v[(j + 1) * w + i], d = v[(j + 1) * w + i + 1];
    return a + (bb - a) * tx + (c - a) * tz + (a - bb - c + d) * tx * tz;
  };
  // (the steepest rise over `r` metres round a point: a bank too steep to drive)
  const slope = (x, z, r = 2) => {
    const gx = (heightAt(x + r, z) - heightAt(x - r, z)) / (2 * r), gz = (heightAt(x, z + r) - heightAt(x, z - r)) / (2 * r);
    return Math.hypot(gx, gz);
  };
  cached = { height: heightAt, slope, x0, z0, cell, w, h };
  return cached;
}
