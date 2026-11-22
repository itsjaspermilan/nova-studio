// Makes the Steam library artwork for a game (for a handheld that has it added as a "non-Steam game"):
//
//   scripts/env.sh node scripts/steam-art.mjs examples/pine-ridge-rally [--recapture]
//   scripts/env.sh node scripts/steam-art.mjs examples/pine-ridge-rally [--recapture]
//
// writes <game>/steam/cover.png (600x900), banner.png (920x430), hero.png (3840x1240, no text), logo.png (1280x720, transparent)
// and icon.png (256x256). Where Steam looks for them: docs/play-on-linux-handheld.md.
//
// How: (1) the game is played headless with `nova play` (the Nova tools' own `play`, through scripts/nova-tool) to capture key art
// at high resolution: a fight and an explosion, a stage at sunset, a car in the showroom. Frames are kept in
// build/steam-art/<game>/raw/ (a second run reuses them; --recapture takes them again). (2) The lettering is drawn by Nova itself, in the
// game's own fonts: a throw-away project (build/steam-art/<game>/letters, not a game) draws one line of text in white on black, once
// with its outline and once without, and the two pictures become masks. (3) This script crops, scales (sharp pixels for the pixel-art
// game, smooth for the 3D one), grades, darkens for contrast and lays the masks down with a glow, a shadow and a colour gradient.
// logo.png needs an alpha channel and a capture has none, which is why the text goes through masks.
// Needs the release build of nova (scripts/env.sh cargo build --release -p nova-runtime) and the MCP bundle's tools (scripts/nova-tool).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { readPng, writePng } from "./pnglib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const recapture = args.includes("--recapture");
const gameArg = args.find((a) => !a.startsWith("--"));
if (!gameArg) { console.error("usage: scripts/env.sh node scripts/steam-art.mjs <game folder> [--recapture]"); process.exit(2); }
const game = path.resolve(gameArg);
const gname = path.basename(game);
const work = path.join(root, "build", "steam-art", gname);
const rawDir = path.join(work, "raw");
const outDir = path.join(game, "steam");
fs.mkdirSync(rawDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

// ---------------------------------------------------------------------------------------------------------------- images
// An image is { w, h, d } with d a Uint8ClampedArray of RGBA (straight alpha).
const blank = (w, h, c = [0, 0, 0, 0]) => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) d.set(c, i * 4); return { w, h, d }; };
const load = (f) => { const p = readPng(f); return { w: p.w, h: p.h, d: p.data }; };
const save = (f, im) => { writePng(f, im.w, im.h, im.d); console.log(`wrote ${path.relative(root, f)} ${im.w}x${im.h}`); };
const crop = (im, x, y, w, h) => {
  const o = blank(w, h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const sx = Math.min(im.w - 1, Math.max(0, x + i)), sy = Math.min(im.h - 1, Math.max(0, y + j));
    o.d.set(im.d.subarray((sy * im.w + sx) * 4, (sy * im.w + sx) * 4 + 4), (j * w + i) * 4);
  }
  return o;
};
// sharp pixels: each output pixel takes the input pixel at its centre
const scaleNearest = (im, w, h) => {
  const o = blank(w, h);
  for (let j = 0; j < h; j++) { const sy = Math.min(im.h - 1, Math.floor((j + 0.5) * im.h / h));
    for (let i = 0; i < w; i++) { const sx = Math.min(im.w - 1, Math.floor((i + 0.5) * im.w / w)); o.d.set(im.d.subarray((sy * im.w + sx) * 4, (sy * im.w + sx) * 4 + 4), (j * w + i) * 4); } }
  return o;
};
// smooth: area average when shrinking (what a good downscale does), bilinear when growing
const scaleSmooth = (im, w, h) => {
  const axis = (n, m) => { // for each of m output samples: [first input index, weights]
    const out = [];
    for (let i = 0; i < m; i++) {
      if (m >= n) { const c = (i + 0.5) * n / m - 0.5, a = Math.max(0, Math.min(n - 1, Math.floor(c))), b = Math.min(n - 1, a + 1), t = Math.min(1, Math.max(0, c - a)); out.push([a, b === a ? [1] : [1 - t, t]]); }
      else { const s = i * n / m, e = (i + 1) * n / m, a = Math.floor(s), ws = []; for (let k = a; k < Math.ceil(e); k++) ws.push(Math.min(e, k + 1) - Math.max(s, k)); const sum = ws.reduce((p, q) => p + q, 0); out.push([a, ws.map((q) => q / sum)]); }
    }
    return out;
  };
  const xs = axis(im.w, w), ys = axis(im.h, h);
  const o = blank(w, h);
  for (let j = 0; j < h; j++) { const [y0, wy] = ys[j];
    for (let i = 0; i < w; i++) { const [x0, wx] = xs[i]; let r = 0, g = 0, b = 0, a = 0;
      for (let q = 0; q < wy.length; q++) for (let p = 0; p < wx.length; p++) { const k = ((y0 + q) * im.w + x0 + p) * 4, wt = wy[q] * wx[p], al = im.d[k + 3] * wt; r += im.d[k] * al; g += im.d[k + 1] * al; b += im.d[k + 2] * al; a += al; }
      const k = (j * w + i) * 4; if (a > 0) { o.d[k] = r / a; o.d[k + 1] = g / a; o.d[k + 2] = b / a; o.d[k + 3] = a; } } }
  return o;
};
// straight-alpha "over" of one colour with opacity a (0..1) on pixel k of an image
const blendPx = (d, k, r, g, b, a) => {
  if (a <= 0) return;
  const da = d[k + 3] / 255, oa = a + da * (1 - a);
  d[k] = (r * a + d[k] * da * (1 - a)) / oa; d[k + 1] = (g * a + d[k + 1] * da * (1 - a)) / oa; d[k + 2] = (b * a + d[k + 2] * da * (1 - a)) / oa; d[k + 3] = oa * 255;
};
const over = (dst, src, x0, y0, opacity = 1) => {
  for (let j = 0; j < src.h; j++) { const y = y0 + j; if (y < 0 || y >= dst.h) continue;
    for (let i = 0; i < src.w; i++) { const x = x0 + i; if (x < 0 || x >= dst.w) continue; const s = (j * src.w + i) * 4; blendPx(dst.d, (y * dst.w + x) * 4, src.d[s], src.d[s + 1], src.d[s + 2], src.d[s + 3] / 255 * opacity); } }
};
// a rectangle of colour with a vertical or horizontal ramp of opacity: stops are [position 0..1, alpha 0..1]
const ramp = (dst, { x = 0, y = 0, w = dst.w, h = dst.h, color, stops, dir = "v" }) => {
  const at = (t) => { for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) { const [t0, a0] = stops[i - 1], [t1, a1] = stops[i]; return a0 + (a1 - a0) * (t - t0) / Math.max(1e-9, t1 - t0); } return stops[stops.length - 1][1]; };
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const px = x + i, py = y + j; if (px < 0 || py < 0 || px >= dst.w || py >= dst.h) continue;
    blendPx(dst.d, (py * dst.w + px) * 4, color[0], color[1], color[2], at(dir === "v" ? (j + 0.5) / h : (i + 0.5) / w)); }
};
const glow = (dst, cx, cy, rx, ry, color, alpha) => {
  for (let j = Math.max(0, Math.floor(cy - ry)); j < Math.min(dst.h, Math.ceil(cy + ry)); j++) for (let i = Math.max(0, Math.floor(cx - rx)); i < Math.min(dst.w, Math.ceil(cx + rx)); i++) {
    const t = Math.hypot((i - cx) / rx, (j - cy) / ry); if (t < 1) { const f = (1 - t) * (1 - t); blendPx(dst.d, (j * dst.w + i) * 4, color[0], color[1], color[2], alpha * f); } }
};
const vignette = (dst, strength, color = [0, 0, 0]) => {
  for (let j = 0; j < dst.h; j++) for (let i = 0; i < dst.w; i++) { const dx = (i / dst.w - 0.5) * 2, dy = (j / dst.h - 0.5) * 2, t = Math.max(0, (dx * dx * 0.7 + dy * dy) - 0.35); blendPx(dst.d, (j * dst.w + i) * 4, color[0], color[1], color[2], Math.min(1, t * strength)); }
};
// colour grade: gamma (<1 lifts the shadows), gain, saturation, and a tint added to the shadows
const grade = (im, { gamma = 1, gain = 1, sat = 1, lift = [0, 0, 0] }) => {
  const d = im.d;
  for (let k = 0; k < d.length; k += 4) {
    let r = d[k] / 255, g = d[k + 1] / 255, b = d[k + 2] / 255;
    r = Math.pow(r, gamma) * gain; g = Math.pow(g, gamma) * gain; b = Math.pow(b, gamma) * gain;
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
    d[k] = (r + lift[0] / 255 * (1 - r)) * 255; d[k + 1] = (g + lift[1] / 255 * (1 - g)) * 255; d[k + 2] = (b + lift[2] / 255 * (1 - b)) * 255;
  }
};
// masks are { w, h, a: Float32Array 0..1 }
const blurMask = (m, radius) => {
  let a = m.a; const { w, h } = m;
  const pass = (src, horiz, r) => {
    const out = new Float32Array(src.length), n = horiz ? w : h, lines = horiz ? h : w, win = 2 * r + 1;
    for (let l = 0; l < lines; l++) { let sum = 0; const at = (i) => src[horiz ? l * w + Math.min(n - 1, Math.max(0, i)) : Math.min(n - 1, Math.max(0, i)) * w + l];
      for (let i = -r; i <= r; i++) sum += at(i);
      for (let i = 0; i < n; i++) { out[horiz ? l * w + i : i * w + l] = sum / win; sum += at(i + r + 1) - at(i - r); } }
    return out;
  };
  const r = Math.max(1, Math.round(radius / 1.7));
  for (let k = 0; k < 3; k++) { a = pass(a, true, r); a = pass(a, false, r); }
  return { w, h, a };
};
const growMask = (m, px) => { // dilate (a disc), used for thick outlines the font cannot draw
  const out = new Float32Array(m.a.length), r = Math.ceil(px);
  for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) { let v = 0;
    for (let dy = -r; dy <= r && v < 1; dy++) for (let dx = -r; dx <= r; dx++) { if (dx * dx + dy * dy > px * px) continue; const x = i + dx, y = j + dy; if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue; const q = m.a[y * m.w + x]; if (q > v) v = q; }
    out[j * m.w + i] = v; }
  return { w: m.w, h: m.h, a: out };
};
// lay a colour (a function of the mask's own pixel position) down through a mask at x, y
const paint = (dst, m, x0, y0, color, opacity = 1) => {
  for (let j = 0; j < m.h; j++) { const y = y0 + j; if (y < 0 || y >= dst.h) continue;
    for (let i = 0; i < m.w; i++) { const x = x0 + i; if (x < 0 || x >= dst.w) continue; const a = m.a[j * m.w + i] * opacity; if (a <= 0.002) continue;
      const c = typeof color === "function" ? color(i, j) : color; blendPx(dst.d, (y * dst.w + x) * 4, c[0], c[1], c[2], a * (c[3] ?? 1)); } }
};
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const vgrad = (stops, h) => (i, j) => { const t = Math.min(1, Math.max(0, j / Math.max(1, h - 1))); for (let s = 1; s < stops.length; s++) if (t <= stops[s][0]) return lerp(stops[s - 1][1], stops[s][1], (t - stops[s - 1][0]) / Math.max(1e-9, stops[s][0] - stops[s - 1][0])); return stops[stops.length - 1][1]; };
const roundRect = (w, h, r) => { const a = new Float32Array(w * h); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const cx = Math.min(Math.max(i + 0.5, r), w - r), cy = Math.min(Math.max(j + 0.5, r), h - r); a[j * w + i] = Math.min(1, Math.max(0, r - Math.hypot(i + 0.5 - cx, j + 0.5 - cy) + 0.5)); } return { w, h, a }; };

// ---------------------------------------------------------------------------------------------------------------- playing the game
const toolEnv = { ...process.env };
function play(project, spec, tag) {
  const file = path.join(work, `play-${tag}.json`);
  fs.writeFileSync(file, JSON.stringify(spec));
  const r = spawnSync(path.join(root, "scripts/nova-tool"), ["--project", project, "play", `@${file}`], { cwd: root, env: toolEnv, encoding: "utf8", maxBuffer: 1 << 28 });
  const text = (r.stdout || "") + (r.stderr || "");
  if (r.status !== 0 || /^ERROR/m.test(text)) { console.error(`exit ${r.status} ${r.error ?? ""}\n` + text.split("\n").filter((l) => /ERROR|error|warning|not built|failed/i.test(l)).slice(0, 12).join("\n") + "\n" + text.slice(-600)); throw new Error(`play ${tag} failed`); }
  return text;
}
// frames a play run wrote (spec.out is relative to the project): by caption
const frameOf = (project, out, caption) => {
  const dir = path.join(project, out);
  const f = fs.readdirSync(dir).find((n) => n.endsWith(`-${caption}.png`));
  if (!f) throw new Error(`no frame ${caption} in ${dir}`);
  return path.join(dir, f);
};
// Takes the frames a run makes into raw/ unless they are all there already. `want` is { caption: ".png name in raw/" }.
function capture(tag, project, spec, want) {
  const have = Object.values(want).every((n) => fs.existsSync(path.join(rawDir, n)));
  if (have && !recapture) { console.log(`capture ${tag}: reusing raw/`); return; }
  console.log(`capture ${tag} ...`);
  play(project, spec, tag);
  for (const [cap, n] of Object.entries(want)) fs.copyFileSync(frameOf(project, spec.out, cap), path.join(rawDir, n));
}
const raw = (n) => load(path.join(rawDir, n));

// ---------------------------------------------------------------------------------------------------------------- lettering
// One line of text drawn by Nova in the game's own font: white on black, a mask with its outline and a mask without. `items` are
// { id, text, font, size (pixels), spacing, bold, outline (pixels), fonts: [files to copy] }. Returns { id: { w, h, ink, fill } } where
// both masks are cropped to the same box (the ink's) so they stay in register.
const LETTERS_LUA = `
local S = nova.scene {}
function S:draw_ui()
  local w, h = nova.view()
  nova.ui.rect(0, 0, w, h, { 0, 0, 0, 255 })
  local it = STEAM
  if not it then return end
  local k = 1080 / 540
  local o = { font = it.font, size = it.size / k, color = { 255, 255, 255, 255 }, width = w, align = "center", valign = "middle", spacing = it.spacing, bold = it.bold, shadow = false }
  if it.outline and it.outline > 0 then o.outline = { color = { 255, 255, 255, 255 }, width = it.outline / k } end
  nova.ui.text(0, h / 2, it.text, o)
end
return S
`;
function renderLetters(items, fontsDir) {
  const key = crypto.createHash("sha1").update(JSON.stringify(items)).digest("hex").slice(0, 12);
  const cache = path.join(work, "text", key);
  const result = {};
  const cached = items.every((it) => fs.existsSync(path.join(cache, `${it.id}-ink.png`)) && fs.existsSync(path.join(cache, `${it.id}-fill.png`)));
  if (!cached || recapture) {
    const proj = path.join(work, "letters");
    fs.rmSync(proj, { recursive: true, force: true });
    fs.mkdirSync(path.join(proj, "scenes"), { recursive: true });
    fs.writeFileSync(path.join(proj, "nova.json"), JSON.stringify({ format: 1, name: "Steam letters", world_height: 540, ignore: ["build"] }));
    fs.writeFileSync(path.join(proj, "main.lua"), 'nova.start("s")\n');
    fs.writeFileSync(path.join(proj, "scenes", "s.lua"), LETTERS_LUA);
    if (fontsDir && fs.existsSync(fontsDir)) { fs.mkdirSync(path.join(proj, "fonts")); for (const f of fs.readdirSync(fontsDir)) if (/\.(ttf|otf)$/i.test(f)) fs.copyFileSync(path.join(fontsDir, f), path.join(proj, "fonts", f)); }
    const route = [];
    for (const it of items) for (const v of ["ink", "fill"]) {
      const o = { font: it.font, size: it.size, spacing: it.spacing ?? 0, bold: it.bold ?? 0, outline: v === "ink" ? (it.outline ?? 0) : 0, text: it.text };
      route.push({ lua: `STEAM = ${JSON.stringify(o).replace(/"(\w+)":/g, "$1=").replace(/\[/g, "{").replace(/\]/g, "}")}` }, { wait: 2 }, { wait: 1, capture: `${it.id.replace(/[^a-z]/gi, "")}${v}` });
    }
    play(proj, { start_scene: "s", size: "2400x1080", out: "build/letters", state: "none", route }, "letters");
    fs.mkdirSync(cache, { recursive: true });
    for (const it of items) for (const v of ["ink", "fill"]) fs.copyFileSync(frameOf(proj, "build/letters", `${it.id.replace(/[^a-z]/gi, "")}${v}`), path.join(cache, `${it.id}-${v}.png`));
  }
  for (const it of items) {
    const ink = load(path.join(cache, `${it.id}-ink.png`)), fill = load(path.join(cache, `${it.id}-fill.png`));
    let x0 = ink.w, y0 = ink.h, x1 = -1, y1 = -1;
    for (let j = 0; j < ink.h; j++) for (let i = 0; i < ink.w; i++) if (ink.d[(j * ink.w + i) * 4] > 8) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
    if (x1 < 0) throw new Error(`lettering ${it.id}: nothing drawn`);
    const w = x1 - x0 + 1, h = y1 - y0 + 1, pick = (im) => { const a = new Float32Array(w * h); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) a[j * w + i] = im.d[((y0 + j) * im.w + x0 + i) * 4] / 255; return { w, h, a }; };
    result[it.id] = { w, h, ink: pick(ink), fill: pick(fill) };
  }
  return result;
}
// Items may give `fitWidth` or `fitHeight` (pixels of ink, outline included) instead of `size`, and `outlineRatio` (share of the size)
// instead of `outline`: a first pass draws them at size 100, measures them and the real size is worked out from that.
function lettering(items, fontsDir) {
  const probe = items.filter((it) => it.size == null).map((it) => ({ ...it, id: `probe_${it.id}`, size: 100, outline: Math.round((it.outlineRatio ?? 0) * 100) }));
  const probed = probe.length ? renderLetters(probe, fontsDir) : {};
  const sized = items.map((it) => {
    if (it.size != null) return { ...it, outline: it.outline ?? Math.round((it.outlineRatio ?? 0) * it.size) };
    const m = probed[`probe_${it.id}`], size = Math.round(100 * (it.fitWidth ? it.fitWidth / m.w : it.fitHeight / m.h));
    return { ...it, size, outline: Math.round((it.outlineRatio ?? 0) * size) };
  });
  return renderLetters(sized, fontsDir);
}
// A title line: glow, outline, optional drop shadow and a vertical colour gradient in the letters.
function setTitle(dst, t, x, y, { fill, outline, glowColor, glowRadius = 0, glowAlpha = 0, shadow, edge, pad = 0 }) {
  if (glowRadius > 0) { const big = padMask(t.ink, glowRadius * 2.2); paint(dst, blurMask(big, glowRadius), x - glowRadius * 2.2, y - glowRadius * 2.2, glowColor, glowAlpha); }
  if (shadow) { const big = padMask(t.ink, shadow.blur * 2.2); paint(dst, blurMask(big, shadow.blur), x + shadow.dx - shadow.blur * 2.2, y + shadow.dy - shadow.blur * 2.2, [0, 0, 0], shadow.alpha); }
  paint(dst, t.ink, x, y, outline);
  paint(dst, t.fill, x, y, vgrad(fill, t.h));
  if (edge) { // a light line along the top edge of each letter: the fill, minus itself moved down
    const hi = { w: t.fill.w, h: t.fill.h, a: new Float32Array(t.fill.a.length) };
    for (let j = 0; j < t.h; j++) for (let i = 0; i < t.w; i++) { const here = t.fill.a[j * t.w + i], below = j + edge.px < t.h ? t.fill.a[(j + edge.px) * t.w + i] : 0; hi.a[j * t.w + i] = Math.max(0, here - below) * edge.alpha; }
    paint(dst, hi, x, y, edge.color);
  }
}
const padMask = (m, p) => { p = Math.ceil(p); const w = m.w + 2 * p, h = m.h + 2 * p, a = new Float32Array(w * h); for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) a[(j + p) * w + i + p] = m.a[j * m.w + i]; return { w, h, a }; };

const ctx = { root, game, gname, work, rawDir, outDir, capture, raw, lettering, setTitle, play, frameOf, blank, crop, scaleNearest, scaleSmooth, over, ramp, glow, vignette, grade, blurMask, growMask, paint, vgrad, roundRect, lerp, save, load, padMask, blendPx };

const recipes = { "pine-ridge-rally": "./steam-art-pine.mjs" };
if (!recipes[gname]) { console.error(`no recipe for ${gname} (known: ${Object.keys(recipes).join(", ")})`); process.exit(2); }
const mod = await import(recipes[gname]);
await mod.make(ctx);
