// items_make's city icons in the detailed style: 32x32 frames (draw them at sx = 1.5, or 3 in a HUD), each shape
// bevelled (a lit upper-left rim, a dark lower-right one, a flat middle), outlined in a dark of its own colour, and what
// glows lit by glowHd: the heart's chambers in accent 1, charge in accent 2, a card's frame in its rarity's colour.

import { hex, Img, mix, shade, type Ramp, type Rgba } from "./paint";
import type { Palette } from "./palettes";
import { glowHd, hdRamp } from "./pix3d";
import { CARD_FAMILIES, RARITIES } from "./city-items";

const N = 32;
const WHITE: Rgba = [255, 255, 255, 255];
type In = (x: number, y: number) => boolean;

/// Fills a shape with a bevel: the two outer pixels lit on the side that faces up and left, dark on the other, then the
/// face; `spec` puts a highlight near the upper left.
function bevel(img: Img, inside: In, r: Ramp, spec = false) {
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!inside(x, y)) continue;
    let d = 9, lit = 0;
    for (let k = 1; k <= 3 && d === 9; k++) {
      const up = !inside(x, y - k) || !inside(x - k, y), down = !inside(x, y + k) || !inside(x + k, y);
      if (up || down) [d, lit] = [k, up && !down ? 1 : !up && down ? -1 : 0];
    }
    img.set(x, y, d === 1 ? (lit > 0 ? r[4] : lit < 0 ? r[0] : r[1]) : d === 2 ? (lit > 0 ? r[3] : lit < 0 ? r[1] : r[2]) : r[2]);
  }
  if (spec) {
    let best: [number, number] | null = null;
    for (let y = 0; y < N && !best; y++) for (let x = 0; x < N; x++) if (inside(x, y) && inside(x + 3, y + 3) && inside(x - 1, y + 3)) {
      best = [x + 2, y + 2];
      break;
    }
    if (best) {
      img.set(best[0], best[1], WHITE);
      img.set(best[0] + 1, best[1], mix(r[4], WHITE, 0.5));
      img.set(best[0], best[1] + 1, mix(r[4], WHITE, 0.5));
    }
  }
}

/// The selective outline: a dark of the colour inside, lighter on the lit side.
function outline(img: Img, P: Palette) {
  const edge: [number, number, Rgba][] = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (img.firm(x, y)) continue;
    let near: Rgba | null = null, lit = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (img.firm(x + dx, y + dy)) {
      const c = img.get(x + dx, y + dy)!;
      if (!near || c[0] + c[1] + c[2] < near[0] + near[1] + near[2]) near = c;
      if (dx === 1 || dy === 1) lit = true;
    }
    if (near) edge.push([x, y, mix(shade(near, -2.4), P.outline, lit ? 0.35 : 0.65)]);
  }
  for (const [x, y, c] of edge) img.set(x, y, c);
}

interface Look {
  P: Palette;
  metal: Ramp;
  dark: Ramp;
  gold: Ramp;
}

const heartIn: In = (x, y) => Math.hypot(x - 9.5, y - 11) <= 7.4 || Math.hypot(x - 22.5, y - 11) <= 7.4 || (y >= 11 && y <= 29 && Math.abs(x - 16) <= (29.5 - y) * 0.95);

function heart(L: Look, fill: number): Img {
  const img = new Img(N, N), a = L.P.accent[0];
  // the shell
  bevel(img, heartIn, L.metal, true);
  // two chambers inside, each in three cells
  const inner: In = (x, y) => heartIn(x, y) && heartIn(x - 3, y) && heartIn(x + 3, y) && heartIn(x, y - 3) && heartIn(x, y + 3) && Math.abs(x - 15.5) > 1.2;
  const lit = (x: number) => fill === 2 || (fill === 1 && x < 16);
  const ch = hdRamp(a[2]), off = hdRamp(mix(L.P.outline, L.metal[0], 0.5));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!inner(x, y)) continue;
    const seam = y === 13 || y === 20;
    const r = lit(x) ? ch : off;
    img.set(x, y, seam ? r[0] : y < 10 && x < 13 ? r[4] : y > 22 ? r[1] : r[2]);
  }
  outline(img, L.P);
  if (fill) glowHd(img, (x, y) => inner(x, y) && lit(x) && !(y === 13 || y === 20) && ((x + y) % 5 === 0 || y < 9), a, { reach: 2.5, hot: 0.4, strength: 0.5 });
  return img;
}

function charge(L: Look, full: boolean): Img {
  const img = new Img(N, N), a = L.P.accent[1];
  const cell: In = (x, y) => x >= 10 && x <= 21 && y >= 4 && y <= 28 && !((x === 10 || x === 21) && (y === 4 || y === 28));
  bevel(img, cell, L.metal, true);
  img.rect(13, 2, 6, 2, L.metal[3]);
  const inner: In = (x, y) => x >= 12 && x <= 19 && y >= 7 && y <= 26;
  const r = full ? hdRamp(a[2]) : hdRamp(mix(L.P.outline, L.metal[0], 0.5));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (inner(x, y)) img.set(x, y, y === 16 || y === 17 ? r[0] : x === 12 ? r[4] : x === 19 ? r[1] : r[2]);
  outline(img, L.P);
  if (full) glowHd(img, (x, y) => x === 13 && inner(x, y) && y !== 16 && y !== 17, a, { reach: 3, hot: 0.6, strength: 0.6 });
  return img;
}

function scrap(L: Look): Img {
  const img = new Img(N, N), R = hdRamp(L.P.mat.rust[2]);
  bevel(img, (x, y) => y >= 16 && y <= 27 && x >= 3 && x <= 20 - (y - 16) * 0.3 && !(x > 14 && y > 24), R);
  const nut: In = (x, y) => {
    const dx = x - 19.5, dy = y - 13.5, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    const hex6 = 7.5 / Math.cos(((((a + Math.PI / 6) % (Math.PI / 3)) + Math.PI / 3) % (Math.PI / 3)) - Math.PI / 6);
    return r <= hex6 && r > 3;
  };
  bevel(img, nut, L.metal, true);
  for (let i = 0; i < 8; i++) {
    img.set(22 + i, 27 - Math.round(Math.sin(i * 1.6) * 2), L.metal[i % 2 ? 1 : 3]);
    img.set(22 + i, 28 - Math.round(Math.sin(i * 1.6) * 2), L.metal[0]);
  }
  outline(img, L.P);
  return img;
}

function keycard(L: Look): Img {
  const img = new Img(N, N), a = L.P.accent[0];
  const card: In = (x, y) => x >= 3 && x <= 28 && y >= 8 && y <= 24 && !((x === 3 || x === 28) && (y === 8 || y === 24));
  bevel(img, card, hdRamp([226, 230, 238, 255]), true);
  img.rect(4, 12, 24, 4, a[2]);
  img.rect(4, 12, 24, 1, mix(a[2], WHITE, 0.5));
  img.rect(7, 18, 6, 4, L.gold[2]);
  img.rect(7, 18, 6, 1, L.gold[4]);
  img.rect(9, 19, 1, 3, L.gold[1]);
  img.ellipse(24, 20, 1.6, 1.6, L.P.outline);
  outline(img, L.P);
  glowHd(img, (x, y) => y === 13 && x >= 6 && x <= 26, a, { reach: 2, strength: 0.5 });
  return img;
}

const RARITY: Record<string, Ramp> = { common: hdRamp(hex("#e8ecf6")), uncommon: hdRamp(hex("#35e6ff")), rare: hdRamp(hex("#ff3fa4")) };

function card(L: Look, rarity: Ramp | null, icon: (img: Img, r: Ramp) => void): Img {
  const img = new Img(N, N);
  const face: In = (x, y) => x >= 5 && x <= 26 && y >= 1 && y <= 30;
  bevel(img, face, rarity ?? L.metal);
  const inner: In = (x, y) => x >= 8 && x <= 23 && y >= 4 && y <= 27;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (inner(x, y)) img.set(x, y, y < 7 ? L.dark[2] : y > 24 ? L.dark[0] : L.dark[1]);
  icon(img, hdRamp([220, 224, 236, 255]));
  outline(img, L.P);
  if (rarity) glowHd(img, (x, y) => face(x, y) && !inner(x, y) && (x === 5 || x === 26 || y === 1 || y === 30) && (x + y) % 4 === 0, rarity, { reach: 2.5, hot: 0.5, strength: 0.6 });
  return img;
}

const ICONS: Record<string, (img: Img, r: Ramp) => void> = {
  baton: (img, r) => {
    for (let i = 0; i < 14; i++) {
      img.set(10 + i * 0.7, 23 - i, r[3]);
      img.set(11 + i * 0.7, 23 - i, r[1]);
    }
    img.rect(9, 21, 3, 4, r[0]);
  },
  sidearm: (img, r) => {
    img.rect(9, 11, 14, 4, r[2]);
    img.rect(9, 11, 14, 1, r[4]);
    img.rect(10, 15, 4, 7, r[2]);
    img.rect(10, 15, 1, 7, r[3]);
    img.rect(15, 15, 3, 2, r[1]);
  },
  roll: (img, r) => {
    for (let k = 0; k < 40; k++) {
      const a = (k / 40) * Math.PI * 1.6 + 0.6, x = 16 + Math.cos(a) * 6, y = 16 + Math.sin(a) * 6;
      img.set(x, y, k > 30 ? WHITE : r[3]);
      img.set(x + 1, y, r[1]);
    }
    img.rect(9, 9, 4, 1, r[3]);
    img.rect(9, 9, 1, 4, r[3]);
  },
  body: (img, r) => {
    img.rect(14, 8, 4, 16, r[3]);
    img.rect(8, 14, 16, 4, r[3]);
    img.rect(17, 8, 1, 16, r[1]);
    img.rect(8, 17, 16, 1, r[1]);
  },
  district: (img, r) => {
    for (const [x, h, w] of [[9, 9, 3], [13, 15, 4], [18, 7, 3], [22, 12, 2]] as const) {
      img.rect(x, 24 - h, w, h, r[2]);
      img.rect(x, 24 - h, 1, h, r[3]);
      for (let y = 26 - h; y < 23; y += 3) img.set(x + 1, y, mix(r[4], WHITE, 0.4));
    }
  },
};

function lock(L: Look): Img {
  const img = new Img(N, N), a = L.P.accent[0];
  bevel(img, (x, y) => y <= 15 && Math.abs(Math.hypot(x - 15.5, y - 12) - 6) < 1.6 && y >= 4, L.metal, true);
  bevel(img, (x, y) => x >= 6 && x <= 25 && y >= 14 && y <= 29, L.metal, true);
  img.ellipse(15.5, 20, 2, 2, a[2]);
  img.rect(15, 21, 2, 4, a[2]);
  outline(img, L.P);
  glowHd(img, (x, y) => Math.hypot(x - 15.5, y - 20) < 1.5 || (x >= 15 && x <= 16 && y >= 21 && y <= 24), a, { reach: 3 });
  return img;
}

function ring(L: Look, big: boolean): Img {
  const img = new Img(N, N), a = L.P.accent[1], r = big ? 12 : 10.5;
  glowHd(img, (x, y) => Math.abs(Math.hypot(x - 15.5, y - 15.5) - r) < 0.6, a, { reach: 3.5, hot: big ? 0.6 : 0.35, strength: big ? 1 : 0.7 });
  return img;
}

export const HD_ITEMS: Record<string, (L: Look) => Img> = {
  cyber_heart_full: (L) => heart(L, 2),
  cyber_heart_half: (L) => heart(L, 1),
  cyber_heart_empty: (L) => heart(L, 0),
  charge_full: (L) => charge(L, true),
  charge_empty: (L) => charge(L, false),
  scrap,
  keycard,
  card_back: (L) => card(L, null, (img, r) => {
    for (let i = 0; i < 7; i++) {
      img.set(16 + i, 9 + i, r[3]);
      img.set(15 - i, 9 + i, r[3]);
      img.set(16 + i, 22 - i, r[1]);
      img.set(15 - i, 22 - i, r[1]);
    }
    glowHd(img, (x, y) => x >= 15 && x <= 16 && y >= 15 && y <= 16, L.P.accent[0], { reach: 2 });
  }),
  ...Object.fromEntries(CARD_FAMILIES.flatMap((f) => RARITIES.map((r) => [`card_${f}_${r}`, (L: Look) => card(L, RARITY[r]!, ICONS[f]!)]))),
  door_lock: lock,
  prompt_ring: (L) => ring(L, true),
  prompt_ring_2: (L) => ring(L, false),
};

export function hdItemLook(P: Palette, metal: Rgba, gold: Rgba): Look {
  return { P, metal: hdRamp(metal), dark: hdRamp(mix(P.outline, P.mat.plate[1], 0.4)), gold: hdRamp(gold) };
}
