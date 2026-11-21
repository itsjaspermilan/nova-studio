// The effects' art, drawn pixel by pixel from shapes and a seeded random (so a run of this script always makes the same files):
//   fx_boom   (128 px, 12 frames) an explosion: a white flash, a fireball that grows and breaks up in hot white, yellow, orange, dark red, then smoke
//   fx_ring   (128 px, 6 frames)  the shock ring on the ground (an ellipse 0.8 as tall as wide), thinning as it spreads
//   fx_scorch (128 px, 2 frames)  the burn mark left behind: fresh (embers) and cold
//   fx_bits   (16 px, 12 frames)  sparks, chunks, embers, a puff, glass, a star: the particles
//   fx_dust   (32 px, 6 frames)   a puff of street dust
//   fx_swing, fx_eswing           the baton's crescent and the enemies' (magenta): a picture that fills the hit box exactly (see lib/vfx.lua)
//   fx_flame, fx_shot, fx_hit, fx_tell, fx_bolt, ...  further down
// Run from the repository folder: scripts/env.sh node examples/neon-undertow/tools/art_fx.mjs [sheet ...]
import { Img, fbm, hex, mixc, noise, rng, writeSheet } from "./fxkit.mjs";

const want = process.argv.slice(2);
const sheets = {};
const sheet = (name, f) => { sheets[name] = f; };

// ---- the explosion ---------------------------------------------------------------------------------------------------------------
sheet("fx_boom", () => {
  const S = 128, C = [64, 70];
  const WHITE = hex("#fffbe8"), PALE = hex("#ffec9a"), YEL = hex("#ffc23a"), ORG = hex("#ff7a1e"), RED = hex("#d3321c"), DARK = hex("#7a1618"), EDGE = hex("#2a0b12");
  const frames = [];
  const R = rng(1177);
  // the lobes: the cauliflower shape of a fireball, a hot core and bulges that push out and up
  const lobes = Array.from({ length: 11 }, (_, i) => { const a = (i / 11) * Math.PI * 2 + R() * 0.6, d = 0.35 + R() * 0.5; return { a, d: d * 0.85, r: 0.55 + R() * 0.3, up: 0.4 + R() * 0.6 }; });
  const flash = new Img(S, S);
  {
    // frame 0: a white flash: a star of eight rays round a hard white disc
    const spikes = Array.from({ length: 8 }, (_, i) => ({ a: (i / 8) * Math.PI * 2 + 0.2, l: i % 2 ? 40 : 56 }));
    flash.fill((x, y) => {
      const dx = x + 0.5 - C[0], dy = (y + 0.5 - C[1]) * 1.05, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
      let reach = 26 + 5 * noise(a * 3, 1, 7);
      for (const s of spikes) { const da = Math.abs(((a - s.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI); reach = Math.max(reach, s.l * Math.max(0, 1 - da / 0.17)); }
      if (r > reach) return null;
      return r < 18 ? WHITE : r < reach * 0.72 ? PALE : YEL;
    });
    flash.outline(EDGE);
    frames.push(flash);
  }
  for (let f = 1; f <= 8; f++) {
    const t = (f - 1) / 7, img = new Img(S, S);
    const rad = 17 + 19 * (1 - (1 - t) ** 2.2);          // the radius grows fast, then slows
    const rise = 14 * t;                                       // the ball lifts
    const cool = t * 0.62;                                     // the heat drains from it
    img.fill((x, y) => {
      const px = x + 0.5 - C[0], py = (y + 0.5 - C[1]) * 1.1 + rise;
      let v = Math.max(0, 1 - Math.hypot(px, py) / (rad * 0.8));            // the core
      for (const l of lobes) {
        const cx = Math.cos(l.a) * l.d * rad, cy = Math.sin(l.a) * l.d * rad * 0.8 - l.up * rise * 0.9, lr = l.r * rad * (0.85 + 0.25 * t);
        v = Math.max(v, 1 - Math.hypot(px - cx, py - cy) / lr);
      }
      if (v <= 0) return null;
      v += (fbm(x / 9, y / 9, f * 3 + 1) - 0.5) * (0.28 + t * 0.2);
      // it breaks up: holes open in it as it goes
      if (t > 0.35 && fbm(x / 6.5, y / 6.5, 40 + f) < (t - 0.3) * 0.62) return null;
      if (v <= 0.02) return null;
      const h = v * 1.12 - cool;
      return h > 0.8 ? WHITE : h > 0.62 ? PALE : h > 0.46 ? YEL : h > 0.32 ? ORG : h > 0.18 ? RED : DARK;
    });
    img.outline(EDGE);
    frames.push(img);
  }
  // the smoke: the fireball's last of it going grey and purple, rising and thinning (dither holes open with each frame)
  const SM = [hex("#8c80a0"), hex("#6a5e80"), hex("#4a4060"), hex("#2e2640")];
  for (let k = 0; k < 3; k++) {
    const img = new Img(S, S), rad = 29 + k * 3, rise = 14 + k * 14, thin = 0.3 + k * 0.28;
    img.fill((x, y) => {
      const px = x + 0.5 - C[0], py = (y + 0.5 - C[1]) * 1.1 + rise;
      let v = 0;
      for (const l of lobes) { const cx = Math.cos(l.a) * l.d * rad, cy = Math.sin(l.a) * l.d * rad * 0.8 - l.up * rise * 0.5 - 4 * k, lr = l.r * rad * (0.8 - k * 0.04); v = Math.max(v, 1 - Math.hypot(px - cx, py - cy) / lr); }
      if (v <= 0) return null;
      v += (fbm(x / 8, y / 8, 90 + k) - 0.5) * 0.4;
      if (v <= 0.08) return null;
      if (fbm(x / 5.5, y / 5.5, 120 + k) < thin * 0.7) return null;
      if (k > 0 && (x + y * 2) % 3 === 0 && fbm(x / 4, y / 4, 150 + k) < thin) return null;
      const tone = v > 0.62 ? 0 : v > 0.4 ? 1 : v > 0.22 ? 2 : 3;
      // a last red glow on the underside of the first smoke
      return SM[tone];
    });
    img.outline(hex("#1a1426"));
    frames.push(img);
  }
  writeSheet("fx_boom", frames, { cols: 6, tags: [{ name: "boom", from: 0, to: 11, loop: false }], ms: [40, 50, 50, 55, 55, 60, 60, 70, 110, 140, 170, 200] });
});

// ---- the shock ring ----------------------------------------------------------------------------------------------------------------
sheet("fx_ring", () => {
  const S = 128, frames = [], rr = [0.38, 0.56, 0.72, 0.85, 0.95, 1.0], th = [8, 7, 5.5, 4, 3, 2];
  const WHITE = hex("#ffffff"), PALE = hex("#ffe9b0"), ORG = hex("#ff9a3a");
  rr.forEach((r, i) => {
    const img = new Img(S, S), R0 = r * 62;
    img.fill((x, y) => {
      const dx = x + 0.5 - 64, dy = (y + 0.5 - 64) / 0.8, d = Math.hypot(dx, dy), off = Math.abs(d - R0);
      if (off > th[i] + 5) return null;
      const wob = fbm(Math.atan2(dy, dx) * 3 + 5, i, 11) * 2 - 1;
      const o = off + wob * (1 + i * 0.2);
      if (o < th[i] * 0.4) return [...WHITE, 255];
      if (o < th[i] * 0.8) return [...PALE, 235];
      if (o < th[i]) return [...ORG, 210];
      // a soft glow just outside and a dithered inner trail behind the front
      if (d > R0) return [...ORG, Math.max(0, 90 - (o - th[i]) * 20)];
      return (x + y) % 2 === 0 ? [...ORG, Math.max(0, 120 - (o - th[i]) * 18)] : null;
    });
    frames.push(img);
  });
  writeSheet("fx_ring", frames, { cols: 6, tags: [{ name: "ring", from: 0, to: 5, loop: false }], ms: 60 });
});

// ---- the scorch mark ---------------------------------------------------------------------------------------------------------------
sheet("fx_scorch", () => {
  const S = 128, frames = [];
  for (const fresh of [true, false]) {
    const img = new Img(S, S);
    img.fill((x, y) => {
      const dx = x + 0.5 - 64, dy = (y + 0.5 - 64) / 0.8, d = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
      // an uneven blot with streaks thrown outwards
      const reach = 40 + 18 * fbm(a * 2.2 + 3, 5, 21) + 8 * Math.max(0, Math.sin(a * 7 + noise(a, 4, 9) * 6)) ** 3 * 2;
      if (d > reach) return null;
      const k = d / reach;
      if (k > 0.78 && (x + y * 3) % 3 === 0) return null;
      if (k > 0.9 && noise(x / 3, y / 3, 33) < 0.5) return null;
      const alpha = 230 * (1 - k * 0.55);
      if (fresh && k > 0.55 && noise(x / 2.5, y / 2.5, 51) > 0.8) return [255, 138, 58, 255];       // embers
      if (fresh && k < 0.3) return [34, 14, 16, alpha];
      return k < 0.35 ? [8, 6, 12, alpha] : k < 0.7 ? [16, 12, 22, alpha] : [26, 20, 34, alpha];
    });
    frames.push(img);
  }
  writeSheet("fx_scorch", frames, { cols: 2, tags: [{ name: "fresh", from: 0, to: 0 }, { name: "cold", from: 1, to: 1 }] });
});

// ---- the particles -----------------------------------------------------------------------------------------------------------------
sheet("fx_bits", () => {
  const S = 16, frames = [];
  const spark = (len, hot, edge) => { const i = new Img(S, S); for (let x = 0; x < len; x++) { const t = x / len; i.set(S - 1 - x, 8, mixc(hot, edge, t), 255 * (1 - t * 0.6)); if (x < len * 0.5) i.set(S - 1 - x, 7, mixc(hot, edge, t + 0.2), 120); } return i; };
  frames.push(spark(14, hex("#ffffff"), hex("#ffb23a")), spark(10, hex("#fff1b0"), hex("#ff7a1e")), spark(7, hex("#ffe070"), hex("#d3321c")), spark(12, hex("#d8fdff"), hex("#35e6ff")));
  const chunk = (pts, c1, c2) => { const i = new Img(S, S); for (const [x, y] of pts) i.set(x, y, c1); for (const [x, y] of pts.slice(0, 3)) i.set(x, y - 1, c2); i.outline(hex("#14101c")); return i; };
  frames.push(chunk([[5, 6], [6, 6], [7, 6], [5, 7], [6, 7], [7, 7], [8, 7], [6, 8], [7, 8], [8, 8], [9, 8]], hex("#4a5270"), hex("#7e88a8")));
  frames.push(chunk([[6, 5], [7, 5], [6, 6], [7, 6], [8, 6], [6, 7], [7, 7], [8, 7], [9, 7], [7, 8], [8, 8]], hex("#7e3c2a"), hex("#c8643a")));
  const ember = new Img(S, S); ember.disc(8, 8, 2, hex("#ff7a1e")); ember.disc(8, 8, 1, hex("#fff1b0")); frames.push(ember);
  const puff = new Img(S, S); puff.fill((x, y) => { const d = Math.hypot(x - 7.5, y - 7.5); return d < 6.5 + noise(x / 2, y / 2, 5) * 1.5 ? (d < 3 ? hex("#9a90ae") : d < 5 ? hex("#74698a") : hex("#554c6c")) : null; }); frames.push(puff);
  const glass = new Img(S, S); glass.fill((x, y) => { const inside = y > 4 && x + y > 10 && x - y < 6 && y < 12; return inside ? (x + y < 14 ? [220, 250, 255, 255] : [90, 200, 230, 255]) : null; }); glass.outline(hex("#13304a")); frames.push(glass);
  const star = new Img(S, S); star.line(2, 8, 13, 8, hex("#ffffff"), 1); star.line(8, 2, 8, 13, hex("#ffffff"), 1); star.disc(8, 8, 2, hex("#ffffff")); star.set(5, 5, hex("#bdf6ff"), 200); star.set(10, 10, hex("#bdf6ff"), 200); star.set(10, 5, hex("#bdf6ff"), 200); star.set(5, 10, hex("#bdf6ff"), 200); frames.push(star);
  const mag = new Img(S, S); mag.line(2, 8, 13, 8, hex("#ffd0f4"), 1); mag.line(8, 2, 8, 13, hex("#ffd0f4"), 1); mag.disc(8, 8, 2, hex("#ffffff")); mag.set(5, 5, hex("#ff3fa4"), 220); mag.set(10, 10, hex("#ff3fa4"), 220); mag.set(10, 5, hex("#ff3fa4"), 220); mag.set(5, 10, hex("#ff3fa4"), 220); frames.push(mag);
  const drop = new Img(S, S); drop.disc(8, 9, 3, hex("#ffb23a")); drop.disc(8, 8, 2, hex("#fff1b0")); drop.set(8, 5, hex("#ffb23a")); drop.set(8, 4, hex("#ffb23a"), 160); frames.push(drop);
  writeSheet("fx_bits", frames, { cols: 12, tags: [
    { name: "spark_white", from: 0, to: 0 }, { name: "spark_yellow", from: 1, to: 1 }, { name: "spark_red", from: 2, to: 2 }, { name: "spark_cyan", from: 3, to: 3 },
    { name: "chunk_grey", from: 4, to: 4 }, { name: "chunk_rust", from: 5, to: 5 }, { name: "ember", from: 6, to: 6 }, { name: "puff", from: 7, to: 7 }, { name: "glass", from: 8, to: 8 }, { name: "star", from: 9, to: 9 }, { name: "star_m", from: 10, to: 10 }, { name: "drop", from: 11, to: 11 } ] });
});

// ---- dust --------------------------------------------------------------------------------------------------------------------------
sheet("fx_dust", () => {
  const S = 32, frames = [], R = rng(808);
  const lobes = Array.from({ length: 6 }, (_, i) => ({ a: (i / 6) * Math.PI * 2 + R(), d: 0.4 + R() * 0.5, r: 0.45 + R() * 0.3 }));
  const L = hex("#c4bccc"), M = hex("#9a92aa"), D = hex("#6e6684");
  for (let f = 0; f < 6; f++) {
    const img = new Img(S, S), t = f / 5, rad = 6 + t * 9, up = t * 4;
    img.fill((x, y) => {
      const px = x + 0.5 - 16, py = (y + 0.5 - 18) * 1.25 + up;
      let v = 0;
      for (const l of lobes) { const cx = Math.cos(l.a) * l.d * rad, cy = Math.sin(l.a) * l.d * rad * 0.7, lr = l.r * rad; v = Math.max(v, 1 - Math.hypot(px - cx, py - cy) / lr); }
      if (v <= 0) return null;
      v += (noise(x / 3, y / 3, 13 + f) - 0.5) * 0.3;
      if (v <= 0.05) return null;
      if (f >= 3 && (x + y) % 2 === 0 && noise(x / 2, y / 2, 61 + f) < (t - 0.4) * 1.3) return null;
      const a = Math.round(235 * (1 - t * 0.7));
      return [...(v > 0.55 ? L : v > 0.3 ? M : D), a];
    });
    frames.push(img);
  }
  writeSheet("fx_dust", frames, { cols: 6, tags: [{ name: "puff", from: 0, to: 5, loop: false }], ms: 70 });
});

// ---- the tells: a ring with ticks, a hatched disc (white: the game tints it by the warning's colour and draws it as light) ---------------
sheet("fx_tell", () => {
  const S = 128, W = hex("#ffffff");
  const ring = new Img(S, S);
  ring.fill((x, y) => {
    const dx = x + 0.5 - 64, dy = y + 0.5 - 64, d = Math.hypot(dx, dy), a = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
    if (d <= 61 && d > 57.5) return [...W, 255];                                                 // the edge, 3.5 px
    const tick = Math.floor(a / (Math.PI / 12) + 0.5) !== undefined && Math.abs(((a / (Math.PI / 12)) % 1) - 0.5) < 0.09;
    if (d <= 57.5 && d > 50 && tick) return [...W, 255];                                         // 24 ticks pointing in
    if (d <= 47 && d > 45.5 && Math.floor(a / (Math.PI / 18)) % 2 === 0) return [...W, 200];       // a broken inner line
    if (d > 61 && d <= 63.5) return [...W, 110];                                                 // a soft edge outside
    return null;
  });
  const hatch = new Img(S, S);
  hatch.fill((x, y) => { const d = Math.hypot(x + 0.5 - 64, y + 0.5 - 64); return d <= 57 && (x + y) % 11 < 4 ? [...W, 255] : null; });
  const inner = new Img(S, S);
  inner.fill((x, y) => { const d = Math.hypot(x + 0.5 - 64, y + 0.5 - 64); return d <= 61 && d > 55 ? [...W, 255 * (1 - (61 - d) / 6)] : null; });
  writeSheet("fx_tell", [ring, hatch, inner], { cols: 3, tags: [{ name: "ring", from: 0, to: 0 }, { name: "hatch", from: 1, to: 1 }, { name: "rim", from: 2, to: 2 }] });
});

sheet("fx_chev", () => {
  const S = 32, W = hex("#ffffff"), img = new Img(S, S);
  // two stacked chevrons pointing right
  for (const ox of [0, 11]) for (let i = 0; i < 6; i++) { img.line(3 + ox, 5 + i * 0.0, 11 + ox, 16, W, 4); img.line(3 + ox, 27, 11 + ox, 16, W, 4); }
  writeSheet("fx_chev", [img], { cols: 1 });
});

export { sheets, want, sheet };
export const run = () => { for (const [name, f] of Object.entries(sheets)) if (!want.length || want.includes(name)) f(); };
if (import.meta.url === new URL(process.argv[1], "file://").href) {
  for (const f of ["./art_fx2.mjs", "./art_fx3.mjs"]) { const more = await import(f); more.register(sheet); }
  run();
}
