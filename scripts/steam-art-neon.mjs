// Neon Undertow's Steam artwork (called by steam-art.mjs): neon magenta and cyan on a dark rainy street, the "comic" face for the name,
// sharp pixels. Frames are captured at the handheld's 1920x1080 (twice the game's 960x540 screen) and a crop is scaled up by a whole number.
export async function make(c) {
  const { game, capture, raw, lettering, setTitle, save, outDir } = c;
  const HUD_OFF = "require('lib.hud').draw = function() end";

  // ---- captures -------------------------------------------------------------------------------------------------------------
  // A set piece in the courts (neon signs overhead): the runner swings at three scrappers beside an explosive barrel, which goes up.
  const swing = {}, swingRoute = [{ wait: 160 }, { press: "attack" }, { wait: 14 }, { press: "attack" }, { wait: 14 }, { press: "attack" }];
  for (let i = 0; i < 16; i++) { swingRoute.push({ wait: 2, capture: `s${i}` }); swing[`s${i}`] = `swing${i}.png`; }
  capture("swing", game, {
    start_scene: "gutter.s5_courts", seed: 3, invincible: true, size: "1920x1080", out: "build/steam-art/swing", state: "none",
    lua: `${HUD_OFF}; local r = nova.named('runner'); R = r; r.facing = 'right'
      EN1 = nova.spawn('scrapper', r.x+44, r.y-8); EN2 = nova.spawn('scrapper', r.x+62, r.y+22); EN3 = nova.spawn('scrapper', r.x+78, r.y-26)
      for _, e in ipairs({ EN1, EN2, EN3 }) do e.hp = 90; require('lib.status').stun(e, 99) end`,
    route: swingRoute,
  }, swing);
  // The barrel goes up well away from the runner (the blast reaches 96 units): he stands and watches, baton out.
  const boom = {}, boomRoute = [{ wait: 160 }, { lua: "B1:take_hit(1, 1, 0, 0)" }, { until: "not B1:is_alive()", max: 200 }];
  for (let i = 0; i < 8; i++) { boomRoute.push({ wait: i < 3 ? 3 : 5, capture: `b${i}` }); boom[`b${i}`] = `boom${i}.png`; }
  capture("boom", game, {
    start_scene: "gutter.s5_courts", seed: 3, invincible: true, size: "1920x1080", out: "build/steam-art/boom", state: "none",
    lua: `${HUD_OFF}; local r = nova.named('runner'); R = r; r.facing = 'right'
      EN1 = nova.spawn('scrapper', r.x+128, r.y-14); EN2 = nova.spawn('scrapper', r.x+150, r.y+16); EN3 = nova.spawn('scrapper', r.x+140, r.y-44)
      for _, e in ipairs({ EN1, EN2, EN3 }) do e.hp = 90; require('lib.status').stun(e, 99) end
      B1 = nova.spawn('barrel', r.x+150, r.y-14)`,
    route: boomRoute,
  }, boom);

  // The street with nobody in it (the runner is hidden), for the hero.
  capture("street", game, {
    start_scene: "gutter.s5_market", seed: 3, invincible: true, size: "1920x1080", out: "build/steam-art/street", state: "none",
    lua: HUD_OFF,
    route: [{ lua: "R = nova.named('runner'); R.draw = function() end; R.x, R.y = 1400, 600" }, { wait: 120, capture: "market" }],
  }, { market: "street.png" });

  if (process.env.STEAM_ART_STAGE === "capture") return;

  // ---- lettering ------------------------------------------------------------------------------------------------------------
  const { blank, crop, scaleNearest, over, ramp, glow, vignette, grade, paint, roundRect, blurMask, padMask } = c;
  const MAG = [255, 43, 214], CYAN = [6, 240, 255], DARK = [4, 5, 16];
  const comic = { font: "comic", bold: 0.6, spacing: 0.03, outlineRatio: 0.075 };
  const T = lettering([
    { id: "cover_neon", text: "NEON", fitWidth: 430, ...comic },
    { id: "cover_under", text: "UNDERTOW", fitWidth: 548, ...comic },
    { id: "banner_neon", text: "NEON", fitWidth: 250, ...comic },
    { id: "banner_under", text: "UNDERTOW", fitWidth: 396, ...comic },
    { id: "logo_neon", text: "NEON", fitWidth: 760, ...comic },
    { id: "logo_under", text: "UNDERTOW", fitWidth: 1120, ...comic },
    { id: "icon_n", text: "N", fitHeight: 176, font: "comic", bold: 0.6, outlineRatio: 0.06 },
  ], null);
  const magFill = [[0, [255, 190, 244]], [0.4, [255, 70, 222]], [1, [196, 22, 172]]];
  const cyanFill = [[0, [196, 255, 255]], [0.45, [24, 236, 255]], [1, [0, 150, 214]]];
  const style = (fill, glowColor, scale = 1) => ({ fill, outline: DARK, glowColor, glowRadius: 22 * scale, glowAlpha: 0.7, edge: { px: Math.max(2, Math.round(4 * scale)), alpha: 0.5, color: [255, 255, 255] }, shadow: { dx: 0, dy: 8 * scale, blur: 10 * scale, alpha: 0.7 } });
  // the street's own darkness is lifted a little, with its blues pushed
  const lift = (im) => grade(im, { gamma: 0.8, gain: 1.12, sat: 1.35, lift: [10, 4, 26] });

  // ---- cover 600x900 ---------------------------------------------------------------------------------------------------------
  {
    const bg = scaleNearest(crop(raw("swing8.png"), 330, 150, 300, 450), 600, 900);
    lift(bg);
    ramp(bg, { color: DARK, stops: [[0, 0.94], [0.36, 0.78], [0.55, 0.25], [0.66, 0]] });
    ramp(bg, { color: DARK, stops: [[0.82, 0], [1, 0.7]] });
    glow(bg, 90, 820, 360, 260, MAG, 0.28); glow(bg, 560, 400, 260, 300, CYAN, 0.16);
    vignette(bg, 0.5, DARK);
    const n = T.cover_neon, u = T.cover_under;
    c.setTitle(bg, n, Math.round((600 - n.w) / 2), 40, style(magFill, MAG));
    c.setTitle(bg, u, Math.round((600 - u.w) / 2), 40 + n.h + 6, style(cyanFill, CYAN));
    save(`${outDir}/cover.png`, bg);
  }

  // ---- banner 920x430 --------------------------------------------------------------------------------------------------------
  {
    const bg = crop(raw("swing8.png"), 0, 170, 920, 430);
    lift(bg);
    ramp(bg, { color: DARK, dir: "h", stops: [[0, 0.92], [0.4, 0.7], [0.62, 0.15], [0.8, 0]] });
    ramp(bg, { color: DARK, stops: [[0, 0.5], [0.4, 0]] });
    ramp(bg, { color: DARK, stops: [[0.8, 0], [1, 0.55]] });
    glow(bg, 700, 330, 240, 200, CYAN, 0.14); glow(bg, 30, 400, 280, 160, MAG, 0.25);
    vignette(bg, 0.45, DARK);
    const n = T.banner_neon, u = T.banner_under, x = 28;
    c.setTitle(bg, n, x, 26, style(magFill, MAG, 0.65));
    c.setTitle(bg, u, x, 26 + n.h + 4, style(cyanFill, CYAN, 0.65));
    save(`${outDir}/banner.png`, bg);
  }

  // ---- hero 3840x1240: the street, nobody in it, no text ---------------------------------------------------------------------
  {
    const bg = scaleNearest(crop(raw("street.png"), 0, 230, 1920, 620), 3840, 1240);
    grade(bg, { gamma: 0.74, gain: 1.18, sat: 1.5, lift: [12, 4, 30] });
    glow(bg, 300, 900, 1100, 700, MAG, 0.22); glow(bg, 3500, 300, 1200, 700, CYAN, 0.2);
    ramp(bg, { color: DARK, stops: [[0, 0.35], [0.25, 0], [0.75, 0], [1, 0.45]] });
    vignette(bg, 0.55, DARK);
    save(`${outDir}/hero.png`, bg);
  }

  // ---- logo 1280x720, transparent -------------------------------------------------------------------------------------------
  {
    const lg = blank(1280, 720);
    const n = T.logo_neon, u = T.logo_under, total = n.h + u.h - 10, y0 = Math.round((720 - total) / 2);
    c.setTitle(lg, n, Math.round((1280 - n.w) / 2), y0, style(magFill, MAG, 1.7));
    c.setTitle(lg, u, Math.round((1280 - u.w) / 2), y0 + n.h - 10, style(cyanFill, CYAN, 1.7));
    save(`${outDir}/logo.png`, lg);
  }

  // ---- icon 256x256 ---------------------------------------------------------------------------------------------------------
  {
    const ic = blank(256, 256);
    const tile = roundRect(256, 256, 44);
    paint(ic, tile, 0, 0, c.vgrad([[0, [24, 12, 56]], [1, [6, 8, 26]]], 256));
    glow(ic, 40, 230, 200, 150, MAG, 0.5); glow(ic, 230, 40, 190, 150, CYAN, 0.45);
    // a neon frame inside the tile
    const ring = { w: 256, h: 256, a: new Float32Array(256 * 256) };
    const inner = roundRect(256 - 28, 256 - 28, 32), inner2 = roundRect(256 - 44, 256 - 44, 24);
    for (let j = 0; j < 228; j++) for (let i = 0; i < 228; i++) ring.a[(j + 14) * 256 + i + 14] = Math.max(0, inner.a[j * 228 + i] - (i >= 8 && j >= 8 && i < 220 && j < 220 ? inner2.a[(j - 8) * 212 + (i - 8)] : 0));
    paint(ic, ring, 0, 0, (i, j) => (i + j < 256 ? MAG : CYAN), 0.95);
    const n = T.icon_n, x = Math.round((256 - n.w) / 2), y = Math.round((256 - n.h) / 2);
    c.setTitle(ic, n, x + 7, y + 7, { fill: [[0, CYAN], [1, CYAN]], outline: DARK, glowColor: CYAN, glowRadius: 0, glowAlpha: 0 });
    c.setTitle(ic, n, x - 4, y - 4, { fill: magFill, outline: DARK, glowColor: MAG, glowRadius: 10, glowAlpha: 0.6, edge: { px: 3, alpha: 0.5, color: [255, 255, 255] } });
    // keep the picture inside the rounded tile
    for (let k = 0; k < 256 * 256; k++) ic.d[k * 4 + 3] *= tile.a[k];
    save(`${outDir}/icon.png`, ic);
  }
}
