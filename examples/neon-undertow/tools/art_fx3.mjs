// The third part of the effects' art (see art_fx.mjs): flames, the shot and its muzzle flash, impacts, the bottle's splash.
import { Img, hex, noise, rng, writeSheet } from "./fxkit.mjs";
import { PALS } from "./art_fx2.mjs";

export function register(sheet) {
  sheet("fx_flame", () => {
    const W = 64, H = 80, frames = [];
    const WHITE = hex("#fff8dc"), PALE = hex("#ffe88a"), YEL = hex("#ffc02e"), ORG = hex("#ff7a1e"), RED = hex("#d3321c"), DARK = hex("#7a1618"), EDGE = hex("#2a0b12");
    const tongues = [{ c: 32, w: 12, h: 62, ph: 0 }, { c: 20, w: 9, h: 44, ph: 2.1 }, { c: 44, w: 9, h: 48, ph: 4.0 }, { c: 12, w: 6, h: 28, ph: 1.0 }, { c: 52, w: 6, h: 30, ph: 3.2 }];
    for (let f = 0; f < 8; f++) {
      const img = new Img(W, H), t = (f / 8) * Math.PI * 2;
      img.fill((x, y) => {
        const dy = 76 - y; if (dy < 0) return null;
        let heat = -1;
        for (const tg of tongues) {
          const hh = tg.h * (0.82 + 0.18 * Math.sin(t + tg.ph) + 0.08 * Math.sin(2 * t + tg.ph * 2));
          if (dy > hh) continue;
          const k = dy / hh, sway = Math.sin(t + tg.ph) * 6 * k * k, w = tg.w * (1 - k ** 1.5) * (1 + 0.15 * Math.sin(t * 2 + tg.ph));
          const off = Math.abs(x + 0.5 - (tg.c + sway));
          if (off > w) continue;
          heat = Math.max(heat, (1 - k) * 0.8 + (1 - off / w) * 0.45);
        }
        if (heat < 0) return null;
        return heat > 0.9 ? WHITE : heat > 0.72 ? PALE : heat > 0.54 ? YEL : heat > 0.38 ? ORG : heat > 0.2 ? RED : DARK;
      });
      img.outline(EDGE);
      const R = rng(200 + f);
      for (let i = 0; i < 3; i++) { const x = 18 + R() * 28, y = 8 + R() * 22; img.set(x, y, PALE); if (R() < 0.5) img.set(x, y + 1, ORG); }
      frames.push(img);
    }
    writeSheet("fx_flame", frames, { cols: 8, tags: [{ name: "burn", from: 0, to: 7 }], ms: 70 });
  });

  sheet("fx_shot", () => {
    const W = 48, Hh = 24, frames = [];
    const WHITE = hex("#ffffff"), PALE = hex("#c4fbff"), MAIN = hex("#35e6ff"), DEEP = hex("#1a8fb4");
    for (let f = 0; f < 4; f++) {
      const img = new Img(W, Hh), R = rng(400 + f);
      img.fill((x, y) => {
        const dy = Math.abs(y + 0.5 - 12), xx = x + 0.5;
        if (xx < 3 || xx > 42) return null;
        const k = (xx - 3) / 39;
        const r = 1 + 6 * Math.min(1, k * 1.5) ** 0.9 * (k > 0.93 ? 0.7 : 1) * (1 + 0.12 * Math.sin(f * 1.6 + xx * 0.5));
        if (dy > r) return null;
        const q = dy / r;
        return q < 0.28 && k > 0.2 ? WHITE : q < 0.55 ? PALE : q < 0.82 ? MAIN : DEEP;
      });
      for (let i = 0; i < 3; i++) { const x = 2 + R() * 18, y = 6 + R() * 12; img.set(x, y, PALE); }
      frames.push(img);
    }
    writeSheet("fx_shot", frames, { cols: 4, tags: [{ name: "fly", from: 0, to: 3 }], ms: 50 });
  });

  const burst = (name, pal) => sheet(name, () => {
    const S = 64, frames = [], R = rng(55);
    const rays = Array.from({ length: 10 }, (_, i) => ({ a: (i / 10) * Math.PI * 2 + R() * 0.3, l: 10 + R() * 14 }));
    for (let f = 0; f < 6; f++) {
      const img = new Img(S, S), t = f / 5, rr = 8 + t * 21, th = Math.max(1, 6 * (1 - t));
      if (f < 3) img.disc(32, 32, 9 - f * 2.5, f === 0 ? pal.white : pal.pale);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const d = Math.hypot(x + 0.5 - 32, y + 0.5 - 32);
        if (Math.abs(d - rr) < th / 2 && f > 0) img.set(x, y, th > 3 ? pal.pale : pal.main, 255 * (1 - t * 0.6));
        else if (Math.abs(d - rr) < th / 2 + 1.5 && f > 0) img.set(x, y, pal.deep, 200 * (1 - t));
      }
      for (const ry of rays) { const a0 = rr * 0.5 + t * 6, a1 = rr * 0.9 + ry.l * (0.8 + t) * 1.3; if (f < 5) img.line(32 + Math.cos(ry.a) * a0, 32 + Math.sin(ry.a) * a0, 32 + Math.cos(ry.a) * a1, 32 + Math.sin(ry.a) * a1, f < 2 ? pal.white : pal.main, f < 3 ? 2 : 1, 255 * (1 - t * 0.5)); }
      frames.push(img);
    }
    writeSheet(name, frames, { cols: 6, tags: [{ name: "burst", from: 0, to: 5, loop: false }], ms: 45 });
  });
  burst("fx_impact", PALS.cyan);
  burst("fx_eimpact", PALS.magenta);

  sheet("fx_splash", () => {
    const S = 64, frames = [], R = rng(77);
    const drops = Array.from({ length: 14 }, () => ({ a: R() * Math.PI * 2, v: 10 + R() * 22, up: 18 + R() * 30, s: R() < 0.4 ? 2 : 1 }));
    const WHITE = hex("#fff8dc"), YEL = hex("#ffc02e"), ORG = hex("#ff7a1e");
    for (let f = 0; f < 7; f++) {
      const img = new Img(S, S), t = f / 6;
      const rx = 8 + t * 24, ry = rx * 0.5;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const dx = x + 0.5 - 32, dy = y + 0.5 - 44, d = Math.hypot(dx / rx, dy / ry);
        if (d <= 1 && d > 0.55 - t * 0.3 && noise(x / 3, y / 3, 9 + f) > 0.2 + t * 0.3) img.set(x, y, d > 0.8 ? ORG : YEL, 255 * (1 - t * 0.7));
      }
      if (f < 3) img.disc(32, 40, 10 - f * 3, f === 0 ? WHITE : YEL);
      for (const dr of drops) {
        const x = 32 + Math.cos(dr.a) * dr.v * t * 1.3, z = dr.up * t - 60 * t * t, y = 44 + Math.sin(dr.a) * dr.v * t * 0.6 - z;
        if (y < 50) img.disc(x, y, dr.s, f < 3 ? YEL : ORG);
      }
      frames.push(img);
    }
    writeSheet("fx_splash", frames, { cols: 7, tags: [{ name: "splash", from: 0, to: 6, loop: false }], ms: 55 });
  });

  sheet("fx_muzzle", () => {
    const S = 48, frames = [];
    const WHITE = hex("#ffffff"), PALE = hex("#c4fbff"), MAIN = hex("#35e6ff");
    for (let f = 0; f < 4; f++) {
      const img = new Img(S, S), L = [30, 38, 28, 16][f], Wd = [9, 12, 8, 4][f];
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const xx = x + 0.5 - 4, dy = Math.abs(y + 0.5 - 24);
        if (xx < 0 || xx > L) continue;
        const r = Wd * (1 - xx / L) ** 0.8 + 1;
        if (dy <= r) img.set(x, y, dy < r * 0.35 ? WHITE : dy < r * 0.7 ? PALE : MAIN);
      }
      if (f < 3) for (const [ang, len] of [[-0.55, 14], [0.55, 14], [-0.9, 9], [0.9, 9]]) img.line(6, 24, 6 + Math.cos(ang) * len, 24 + Math.sin(ang) * len, PALE, 1);
      frames.push(img);
    }
    writeSheet("fx_muzzle", frames, { cols: 4, tags: [{ name: "flash", from: 0, to: 3, loop: false }], ms: 35 });
  });
}
