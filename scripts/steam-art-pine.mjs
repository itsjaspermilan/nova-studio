// Pine Ridge Rally's Steam artwork (called by steam-art.mjs): 3D captures of the game itself (a car in the showroom, a stage at sunset),
// smooth scaling, the game's own lettering (Barlow Condensed italic, white, with the orange accent).
import path from "node:path";

export async function make(c) {
  const { game, capture, raw, lettering, setTitle, save, outDir, blank, scaleSmooth, over, ramp, glow, vignette, grade, paint, roundRect, crop } = c;
  const showroom = (stage, car, size, extraLua, out, cap, file) => capture(out, game, {
    start_scene: "title", size, out: `build/steam-art/${out}`, state: "none",
    route: [
      { lua: `local st=require('lib.state'); st.mode='rally'; st.car=st.index_of('${car}'); for i,x in ipairs(st.stages) do if x.id=='${stage}' then st.stage=i end end; nova.goto_scene('title'); ${extraLua}` },
      { wait: 60 }, { press: "art_box" }, { wait: 20 }, { lua: "nova.scene_now().draw_ui=function() end" }, { wait: 20, capture: cap },
    ],
  }, { [cap]: file });
  // portrait: the camera is pulled back and looks a little higher so the whole car fits a tall picture, with sky above it for the name
  showroom("stage_pine_ridge", "car_rally", "1200x1800", "local oc=nova.camera; nova.camera=function(x,y,z,tx,ty,tz,fov) return oc(x,y+0.3,z,tx,ty+1.1,tz,fov*1.35) end", "cover", "cover", "cover.png");
  // wide: the game's own landscape box art camera (the car to the right, room on the left)
  showroom("stage_dust_valley", "car_muscle", "1840x860", "", "banner", "banner", "banner.png");
  // a stage at sunset from the chase camera, the computer driving (F9), no HUD
  capture("hero", game, {
    start_scene: "stage_pine_ridge", size: "3840x1240", out: "build/steam-art/hero", state: "none",
    route: [
      { lua: "local st=require('lib.state'); st.car=st.index_of('car_muscle'); nova.goto_scene('stage_canyon')" }, { wait: 5 },
      { lua: "nova.scene_now().draw_ui=function() end" }, { wait: 280 }, { press: "autodrive" }, { wait: 420 }, { wait: 1, capture: "hero" },
    ],
  }, { hero: "hero.png" });
  if (process.env.STEAM_ART_STAGE === "capture") return;

  const WHITE = [244, 241, 234], ORANGE = [255, 106, 43], INK = [14, 19, 24];
  const base = { font: "barlow_cond_italic", spacing: 0.0, outlineRatio: 0.045 };
  const spaced = { font: "barlow_cond", bold: 0.4, spacing: 0.32, outlineRatio: 0.06 };
  const T = lettering([
    { id: "cover_pine", text: "PINE", fitWidth: 330, ...base },
    { id: "cover_ridge", text: "RIDGE", fitWidth: 520, ...base },
    { id: "cover_rally", text: "RALLY", fitWidth: 300, ...spaced },
    { id: "banner_name", text: "PINE RIDGE", fitWidth: 470, ...base },
    { id: "banner_rally", text: "RALLY", fitWidth: 250, ...spaced },
    { id: "logo_name", text: "PINE RIDGE", fitWidth: 1150, ...base },
    { id: "logo_rally", text: "RALLY", fitWidth: 620, ...spaced },
    { id: "icon_p", text: "PR", fitWidth: 190, font: "barlow_cond_italic", outlineRatio: 0.0 },
  ], path.join(game, "fonts"));
  const white = (sc = 1) => ({ fill: [[0, [255, 255, 252]], [1, [226, 222, 214]]], outline: INK, glowColor: INK, glowRadius: 14 * sc, glowAlpha: 0.45, shadow: { dx: 0, dy: 6 * sc, blur: 8 * sc, alpha: 0.55 } });
  const orange = (sc = 1) => ({ fill: [[0, [255, 150, 90]], [1, [255, 96, 32]]], outline: INK, glowColor: INK, glowRadius: 10 * sc, glowAlpha: 0.4, shadow: { dx: 0, dy: 5 * sc, blur: 6 * sc, alpha: 0.5 } });
  const bar = (dst, x, y, w, h) => { const m = { w, h, a: new Float32Array(w * h).fill(1) }; paint(dst, m, x, y, ORANGE); };

  { // cover
    const bg = scaleSmooth(raw("cover.png"), 600, 900);
    grade(bg, { gamma: 0.95, gain: 1.04, sat: 1.12, lift: [0, 0, 0] });
    ramp(bg, { color: INK, stops: [[0, 0.72], [0.3, 0.5], [0.5, 0.0]] });
    ramp(bg, { color: INK, stops: [[0.86, 0], [1, 0.5]] });
    vignette(bg, 0.35, INK);
    const p = T.cover_pine, r = T.cover_ridge, y = T.cover_rally;
    setTitle(bg, p, Math.round((600 - p.w) / 2) - 70, 34, white());
    setTitle(bg, r, Math.round((600 - r.w) / 2), 34 + p.h + 4, white());
    const y3 = 34 + p.h + r.h + 18;
    bar(bg, 36, y3 + Math.round(y.h / 2) - 4, 60, 8); bar(bg, 504, y3 + Math.round(y.h / 2) - 4, 60, 8);
    setTitle(bg, y, Math.round((600 - y.w) / 2), y3, orange());
    save(`${outDir}/cover.png`, bg);
  }
  { // banner
    const bg = scaleSmooth(raw("banner.png"), 920, 430);
    grade(bg, { gamma: 0.95, gain: 1.04, sat: 1.15, lift: [0, 0, 0] });
    ramp(bg, { color: INK, dir: "h", stops: [[0, 0.8], [0.42, 0.55], [0.62, 0]] });
    ramp(bg, { color: INK, stops: [[0.75, 0], [1, 0.4]] });
    vignette(bg, 0.3, INK);
    const n = T.banner_name, r = T.banner_rally, h = n.h + 14 + r.h, y0 = Math.round((430 - h) / 2);
    setTitle(bg, n, 34, y0, white(0.7));
    bar(bg, 34, y0 + n.h + 14 + Math.round(r.h / 2) - 3, 44, 6);
    setTitle(bg, r, 92, y0 + n.h + 14, orange(0.7));
    save(`${outDir}/banner.png`, bg);
  }
  { // hero: scenery only
    const bg = raw("hero.png");
    for (let k = 3; k < bg.d.length; k += 4) bg.d[k] = 255;   // (the capture has a few see-through pixels at the edges; a background is opaque)
    grade(bg, { gamma: 0.97, gain: 1.03, sat: 1.1, lift: [0, 0, 0] });
    ramp(bg, { color: INK, stops: [[0, 0.3], [0.2, 0], [0.8, 0], [1, 0.35]] });
    vignette(bg, 0.3, INK);
    save(`${outDir}/hero.png`, bg);
  }
  { // logo
    const lg = blank(1280, 720);
    const n = T.logo_name, r = T.logo_rally, gap = 30, h = n.h + gap + r.h, y0 = Math.round((720 - h) / 2);
    setTitle(lg, n, Math.round((1280 - n.w) / 2), y0, white(1.9));
    const rx = Math.round((1280 - r.w) / 2), ry = y0 + n.h + gap;
    bar(lg, rx - 130, ry + Math.round(r.h / 2) - 8, 100, 16); bar(lg, rx + r.w + 30, ry + Math.round(r.h / 2) - 8, 100, 16);
    setTitle(lg, r, rx, ry, orange(1.9));
    save(`${outDir}/logo.png`, lg);
  }
  { // icon: orange tile, a speed stripe, white italic PR
    const ic = blank(256, 256), tile = roundRect(256, 256, 48);
    paint(ic, tile, 0, 0, c.vgrad([[0, [255, 132, 70]], [1, [226, 78, 20]]], 256));
    const stripe = { w: 256, h: 256, a: new Float32Array(256 * 256) };
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) { const d = i + j * 0.9 - 330; if (d > 0 && d < 34) stripe.a[j * 256 + i] = 0.18; }
    paint(ic, stripe, 0, 0, [255, 255, 255]);
    const t = T.icon_p;
    setTitle(ic, t, Math.round((256 - t.w) / 2), Math.round((256 - t.h) / 2), { fill: [[0, [255, 255, 252]], [1, [244, 238, 228]]], outline: INK, glowColor: INK, glowRadius: 0, glowAlpha: 0, shadow: { dx: 4, dy: 6, blur: 5, alpha: 0.45 } });
    for (let k = 0; k < 256 * 256; k++) ic.d[k * 4 + 3] *= tile.a[k];
    save(`${outDir}/icon.png`, ic);
  }
}
