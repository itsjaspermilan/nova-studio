// A tool, run as a test so that it uses the studio's own importer: gives every `.glb` in the example projects that has none a `models/<name>.model.json`,
// the editable model the studio's model editor opens (parts, shapes, colours from the model's own palette picture, skins and clips). The `.glb` itself is
// left alone, so the games look exactly as before; when a model is edited and saved, the studio writes its `.glb` from the `.model.json`. Packed games
// leave `.model.json` out (they read the `.glb`).
//   cd studio && NOVA_MAKE_EDITABLE=1 npx vitest run src/tools/make-editable.test.ts   (NOVA_MAKE_EDITABLE_PROJECT=<example> for one)
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { importWithColours } from "../lib/model-load";
import { serializeModel } from "../lib/model-doc";
import type { Raster } from "../lib/pixels";

/// A PNG decoded to RGBA (8-bit, greyscale, RGB, palette with any bit depth up to 8, and their alpha forms), as a kit's palette needs.
export function decodePng(bytes: Uint8Array): Raster | undefined {
  // (a byte of an array, 0 past its end: the arrays here are read by index throughout)
  const at = (arr: Uint8Array | null, i: number) => (arr ? arr[i] ?? 0 : 0);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let w = 0, h = 0, depth = 8, type = 6;
  let palette: Uint8Array | null = null, trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  for (let p = 8; p + 8 <= bytes.length; ) {
    const len = v.getUint32(p), kind = String.fromCharCode(...bytes.subarray(p + 4, p + 8)), body = bytes.subarray(p + 8, p + 8 + len);
    if (kind === "IHDR") { w = v.getUint32(p + 8); h = v.getUint32(p + 12); depth = at(body, 8); type = at(body, 9); if (at(body, 12)) return undefined; }
    else if (kind === "PLTE") palette = body;
    else if (kind === "tRNS") trns = body;
    else if (kind === "IDAT") idat.push(body);
    p += 12 + len;
  }
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type];
  if (!channels || (depth !== 8 && type !== 3 && type !== 0)) return undefined;
  const raw = new Uint8Array(inflateSync(Buffer.concat(idat)));
  const bpp = Math.max(1, (channels * depth) / 8);
  const stride = Math.ceil((w * channels * depth) / 8);
  const out = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = at(raw, y * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const c = at(raw, y * (stride + 1) + 1 + x);
      const a = x >= bpp ? at(out, y * stride + x - bpp) : 0, b = y > 0 ? at(out, (y - 1) * stride + x) : 0, d = x >= bpp && y > 0 ? at(out, (y - 1) * stride + x - bpp) : 0;
      const pa = Math.abs(b - d), pb = Math.abs(a - d), pc = Math.abs(a + b - 2 * d);
      const p = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : d) : 0;
      out[y * stride + x] = (c + p) & 255;
    }
  }
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4, row = y * stride;
    const sample = (i: number) => (depth === 8 ? at(out, row + i) : (at(out, row + ((i * depth) >> 3)) >> (8 - depth - ((i * depth) & 7))) & ((1 << depth) - 1));
    if (type === 3) {
      const k = sample(x);
      data[o] = at(palette, k * 3); data[o + 1] = at(palette, k * 3 + 1); data[o + 2] = at(palette, k * 3 + 2); data[o + 3] = trns && k < trns.length ? at(trns, k) : 255;
    } else if (type === 0 || type === 4) {
      const g = type === 0 && depth < 8 ? Math.round((sample(x) * 255) / ((1 << depth) - 1)) : at(out, row + x * channels);
      data[o] = data[o + 1] = data[o + 2] = g; data[o + 3] = type === 4 ? at(out, row + x * 2 + 1) : 255;
    } else {
      data[o] = at(out, row + x * channels); data[o + 1] = at(out, row + x * channels + 1); data[o + 2] = at(out, row + x * channels + 2);
      data[o + 3] = type === 6 ? at(out, row + x * 4 + 3) : 255;
    }
  }
  return { w, h, data };
}

const run = process.env.NOVA_MAKE_EDITABLE === "1";
describe.skipIf(!run)("make every example model editable", () => {
  it("writes a .model.json beside each .glb that has none", async () => {
    const root = join(__dirname, "../../../examples");
    // models whose look is a painted picture (faces, clothes, a checkered flag, a roof's stripe) or whose skeleton the importer gets wrong: drawn
    // side by side with what their .model.json would save, more than 1% of their pixels differed, so they keep the kit's file (keep-original.txt)
    const keep = new Set(readFileSync(join(__dirname, "keep-original.txt"), "utf8").split("\n").filter(Boolean));
    const done: string[] = [], failed: string[] = [], notes: string[] = [];
    // (NOVA_MAKE_EDITABLE_PROJECT=moving-day limits it to one example)
    const only = process.env.NOVA_MAKE_EDITABLE_PROJECT;
    for (const project of readdirSync(root).filter((p) => !only || p === only)) {
      const dir = join(root, project, "models");
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir).filter((f) => f.endsWith(".glb") && !/-original\d*\.glb$/.test(f))) {
        const json = join(dir, file.replace(/\.glb$/, ".model.json"));
        if (existsSync(json) || keep.has(`${project}/${file.replace(/\.glb$/, "")}`)) continue;
        const bytes = new Uint8Array(readFileSync(join(dir, file)));
        const result = await importWithColours(bytes, async (mime, b) => (mime === "image/png" ? decodePng(b) : undefined));
        if (!result.ok) { failed.push(`${project}/${file}: ${result.error}`); continue; }
        // a model the studio could not save back (a flat ground, a road mesh made from a track: those are edited where they come from) stays as it is
        try {
          const { exportGlb } = await import("../lib/glb");
          exportGlb(result.doc);
        } catch (e) {
          notes.push(`${project}/${file}: left as it is (${String(e).slice(0, 60)})`);
          continue;
        }
        writeFileSync(json, serializeModel(result.doc));
        done.push(`${project}/${file}`);
        if (result.notes.length) notes.push(`${project}/${file}: ${result.notes.join("; ")}`);
      }
    }
    console.log(`made ${done.length} models editable`);
    for (const n of notes) console.log(`  note ${n}`);
    for (const f of failed) console.log(`  FAILED ${f}`);
    expect(failed).toEqual([]);
  }, 600_000);
});

// A check of the conversion: NOVA_EXPORT_CHECK="dir:project/name,project/name" writes the .glb each named .model.json would save as, into dir, so
// that it can be drawn by the game's renderer beside the original (scripts or nova_model_preview).
const check = process.env.NOVA_EXPORT_CHECK;
describe.skipIf(!check)("export converted models for a look", () => {
  it("writes their .glb", async () => {
    const { parseModel } = await import("../lib/model-doc");
    const { exportGlb } = await import("../lib/glb");
    const [dir = "", list = ""] = check!.split(":");
    for (const item of list.split(",")) {
      const [project = "", name = ""] = item.split("/");
      const parsed = parseModel(readFileSync(join(__dirname, "../../../examples", project, "models", `${name}.model.json`), "utf8"));
      expect(parsed.ok).toBe(true);
      if (parsed.ok) writeFileSync(join(dir, `${name}.glb`), exportGlb(parsed.doc));
    }
  });
});

// A one-off move to linear vertex colours (2026-11-07). The studio's exporter used to write the editor's sRGB colours into COLOR_0, which glTF
// and the game read as linear light, so every model looked lighter in the game than in the editor. Now the exporter writes linear values;
// NOVA_LIGHTEN_COLOURS="file,file" first turns each colour of those .model.json files into the one the game has been showing, so that the
// editor shows what the game always did and the games look exactly as before.
const lighten = process.env.NOVA_LIGHTEN_COLOURS;
describe.skipIf(!lighten)("keep the colours the game showed", () => {
  it("lightens each listed model's colours to what the game drew", () => {
    const shown = (v: number) => { const c = v / 255; return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)); };
    const fix = (hex: string) => "#" + [1, 3, 5].map((i) => shown(parseInt(hex.slice(i, i + 2), 16)).toString(16).padStart(2, "0")).join("") + hex.slice(7);
    for (const file of lighten!.split(",")) {
      const path = join(__dirname, "../../..", file);
      const text = readFileSync(path, "utf8");
      // every "#rrggbb" of a shape, a face or a polygon; a painted shape's picture (its texture) is sRGB already and is not a hex colour
      writeFileSync(path, text.replace(/"#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?"/g, (m) => `"${fix(m.slice(1, -1))}"`));
    }
  });
});

// NOVA_EXPORT_ALL=1: writes every example's models/<name>.glb from its .model.json, as the studio saves it.
describe.skipIf(process.env.NOVA_EXPORT_ALL !== "1")("save every model's glb", () => {
  it("exports them", async () => {
    const { parseModel } = await import("../lib/model-doc");
    const { exportGlb } = await import("../lib/glb");
    const root = join(__dirname, "../../../examples");
    let n = 0;
    for (const project of readdirSync(root)) {
      const dir = join(root, project, "models");
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir).filter((f) => f.endsWith(".model.json"))) {
        const parsed = parseModel(readFileSync(join(dir, file), "utf8"));
        if (!parsed.ok) throw new Error(`${project}/${file}: ${parsed.error}`);
        const { bakeAll, fitPicture } = await import("../lib/model-uv");
        const texture = parsed.doc.texture ? fitPicture(parsed.doc, bakeAll(parsed.doc)) : undefined;
        writeFileSync(join(dir, file.replace(/\.model\.json$/, ".glb")), exportGlb(parsed.doc, texture));
        n++;
      }
    }
    console.log(`exported ${n}`);
  }, 600_000);
});
