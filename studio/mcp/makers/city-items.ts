// items_make's city icons, 16x16 like the others: a segmented heart (full, half, empty), a charge pip, scrap, a key-card,
// a card back and the card families' icons in three rarities, a door lock and the ring that says "press to use". What
// matters glows (paint.ts `glow`): the heart in accent 1, charge in accent 2; a card's rarity is its frame's colour
// (common white, uncommon cyan, rare magenta, whatever the palette).

import { glow, hex, Img, mix, ramp, type Ramp, type Rgba } from "./paint";
import type { Palette } from "./palettes";

const N = 16;
const WHITE: Rgba = [255, 255, 255, 255];

export interface CityLook {
  P: Palette;
  metal: Ramp;
  gold: Ramp;
  dark: Rgba;
}

const RARITY: Record<string, Ramp> = { common: ramp(hex("#e8ecf6")), uncommon: ramp(hex("#35e6ff")), rare: ramp(hex("#ff3fa4")) };
export const CARD_FAMILIES = ["baton", "sidearm", "roll", "body", "district"];
export const RARITIES = Object.keys(RARITY);

const heartIn = (x: number, y: number) => Math.hypot(x - 4.5, y - 5.5) <= 3.6 || Math.hypot(x - 10.5, y - 5.5) <= 3.6 || (y >= 6 && y <= 14 && Math.abs(x - 7.5) <= (14.4 - y) * 0.95);

function cyberHeart(L: CityLook, fill: number): Img {
  const img = new Img(N, N), a = L.P.accent[0], M = L.metal;
  const lit = (x: number) => fill === 2 || (fill === 1 && x <= 7);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!heartIn(x, y)) continue;
    const edge = !heartIn(x - 1, y) || !heartIn(x + 1, y) || !heartIn(x, y - 1) || !heartIn(x, y + 1);
    // a metal shell, two chambers either side of a seam, cells divided by thin lines
    if (edge) img.set(x, y, y < 7 && x < 8 ? M[3] : M[1]);
    else if (x === 7 || x === 8) img.set(x, y, M[0]);
    else if (y === 7 || y === 10) img.set(x, y, lit(x) ? a[1] : mix(L.dark, M[0], 0.4));
    else img.set(x, y, lit(x) ? (y < 6 && x < 6 ? mix(a[2], WHITE, 0.45) : a[2]) : mix(L.dark, M[0], 0.6));
  }
  img.outline(L.P.outline);
  if (fill) glow(img, (x, y) => heartIn(x, y) && !(!heartIn(x - 1, y) || !heartIn(x + 1, y) || !heartIn(x, y - 1) || !heartIn(x, y + 1)) && x !== 7 && x !== 8 && lit(x) && y !== 7 && y !== 10, a, { ring: false, keep: true });
  return img;
}

function charge(L: CityLook, full: boolean): Img {
  const img = new Img(N, N), a = L.P.accent[1], M = L.metal;
  img.rect(5, 2, 6, 12, M[1]);
  img.rect(5, 2, 1, 12, M[3]);
  img.rect(6, 1, 4, 1, M[2]);
  img.rect(6, 3, 4, 10, full ? a[2] : mix(L.dark, M[0], 0.5));
  if (full) img.rect(6, 3, 1, 10, mix(a[2], WHITE, 0.5));
  img.rect(6, 7, 4, 1, M[0]);
  img.outline(L.P.outline);
  if (full) glow(img, (x, y) => x >= 6 && x <= 9 && y >= 3 && y <= 12 && y !== 7, a, { ring: false, keep: true });
  return img;
}

function scrap(L: CityLook): Img {
  const img = new Img(N, N), M = L.metal, R = L.P.mat.rust;
  // a bent plate, a hex nut on it and a spring
  for (let y = 8; y < 14; y++) for (let x = 1; x < 10; x++) if (x + (y - 8) * 0.5 < 10) img.set(x, y, y === 8 ? R[3] : x === 1 ? R[3] : R[2]);
  img.rect(2, 12, 7, 1, R[1]);
  img.ellipse(9.5, 7, 4, 3.6, (x, y) => (Math.hypot(x - 9.5, y - 7) < 1.5 ? null : y < 6 ? M[4] : x > 11 ? M[1] : M[2]));
  for (let i = 0; i < 4; i++) img.line(11 + i, 13 - i * 0.3, 12 + i, 11 - i * 0.3, i % 2 ? M[1] : M[3]);
  img.set(8, 5, WHITE);
  return img.outline(L.P.outline);
}

function keycard(L: CityLook): Img {
  const img = new Img(N, N), M = L.metal, a = L.P.accent[0];
  img.rect(2, 4, 12, 8, M[4]);
  img.rect(2, 4, 12, 1, WHITE);
  img.rect(13, 5, 1, 7, M[2]);
  img.rect(2, 11, 12, 1, M[2]);
  img.rect(2, 6, 12, 2, a[2]);
  img.rect(4, 9, 3, 2, L.gold[3]);
  img.set(4, 9, L.gold[4]);
  img.ellipse(11.5, 9.5, 0.8, 0.8, L.dark);
  img.outline(L.P.outline);
  glow(img, (x, y) => y === 6 && x >= 3 && x <= 12, a, { ring: false, keep: true, halo: false });
  return img;
}

/// A card: a dark face in a frame of its rarity's colour (which glows), and on it what it does.
function card(L: CityLook, rarity: Ramp | null, icon: (img: Img, c: Rgba, d: Rgba) => void): Img {
  const img = new Img(N, N), M = L.metal;
  img.rect(2, 0, 12, 16, mix(L.dark, M[0], 0.5));
  const frame = (x: number, y: number) => x === 2 || x === 13 || y === 0 || y === 15;
  for (let y = 0; y < 16; y++) for (let x = 2; x < 14; x++) if (frame(x, y)) img.set(x, y, rarity ? rarity[2] : M[2]);
  icon(img, M[4], M[1]);
  if (rarity) {
    for (const [x, y] of [[3, 1], [12, 1], [3, 14], [12, 14]] as const) img.set(x, y, rarity[1]);
    glow(img, (x, y) => frame(x, y) && x >= 2 && x <= 13 && y >= 0 && y <= 15 && (x + y) % 3 === 0, rarity, { ring: false, halo: false, hot: 0.55 });
  }
  return img;
}

const ICONS: Record<string, (img: Img, c: Rgba, d: Rgba) => void> = {
  baton: (img, c, d) => {
    img.line(5, 12, 10, 4, c);
    img.line(6, 12, 11, 4, d);
    img.rect(4, 12, 2, 2, d);
  },
  sidearm: (img, c, d) => {
    img.rect(4, 6, 8, 2, c);
    img.rect(4, 8, 8, 1, d);
    img.rect(5, 9, 2, 4, c);
    img.set(8, 9, d);
  },
  roll: (img, c, d) => {
    for (let a = 0; a < 9; a++) img.set(8 + Math.cos(a / 2.2 + 1) * 4, 8 + Math.sin(a / 2.2 + 1) * 4, a > 6 ? WHITE : c);
    img.line(5, 4, 3, 7, d);
    img.line(6, 4, 3, 4, c);
  },
  body: (img, c, d) => {
    img.rect(7, 4, 2, 8, c);
    img.rect(4, 7, 8, 2, c);
    img.rect(9, 5, 1, 7, d);
  },
  district: (img, c, d) => {
    for (const [x, h] of [[4, 5], [6, 8], [8, 4], [10, 7]] as const) {
      img.rect(x, 13 - h, 2, h, x % 4 ? c : d);
      img.set(x, 13 - h + 1, WHITE);
    }
  },
};

function cardBack(L: CityLook): Img {
  return card(L, null, (img, c, d) => {
    // a diamond of circuit lines, the same on every card
    for (let i = 0; i < 4; i++) {
      img.set(8 + i, 4 + i, c);
      img.set(7 - i, 4 + i, c);
      img.set(8 + i, 11 - i, d);
      img.set(7 - i, 11 - i, d);
    }
    img.rect(7, 7, 2, 2, L.P.accent[0][2]);
  });
}

function lock(L: CityLook): Img {
  const img = new Img(N, N), M = L.metal, a = L.P.accent[0];
  img.ellipse(7.5, 5.5, 3.5, 3.5, (x, y) => (y > 6 ? undefined : Math.hypot(x - 7.5, y - 5.5) > 2.2 ? (x < 8 ? M[3] : M[1]) : null));
  img.rect(3, 7, 10, 8, M[2]);
  img.rect(3, 7, 10, 1, M[4]);
  img.rect(12, 8, 1, 7, M[0]);
  img.rect(7, 9, 2, 3, a[2]);
  img.set(7, 12, a[1]);
  img.outline(L.P.outline);
  glow(img, (x, y) => x >= 7 && x <= 8 && y >= 9 && y <= 11, a, { ring: false, keep: true });
  return img;
}

function ring(L: CityLook, big: boolean): Img {
  const img = new Img(N, N), a = L.P.accent[1], r = big ? 6 : 5;
  glow(img, (x, y) => Math.abs(Math.hypot(x - 7.5, y - 7.5) - r) < 0.55, a, { hot: big ? 0.55 : 0.3 });
  return img;
}

export const CITY_ITEMS: { name: string; draw: (L: CityLook) => Img }[] = [
  { name: "cyber_heart_full", draw: (L) => cyberHeart(L, 2) },
  { name: "cyber_heart_half", draw: (L) => cyberHeart(L, 1) },
  { name: "cyber_heart_empty", draw: (L) => cyberHeart(L, 0) },
  { name: "charge_full", draw: (L) => charge(L, true) },
  { name: "charge_empty", draw: (L) => charge(L, false) },
  { name: "scrap", draw: scrap },
  { name: "keycard", draw: keycard },
  { name: "card_back", draw: cardBack },
  ...CARD_FAMILIES.flatMap((f) => RARITIES.map((r) => ({ name: `card_${f}_${r}`, draw: (L: CityLook) => card(L, RARITY[r]!, ICONS[f]!) }))),
  { name: "door_lock", draw: lock },
  { name: "prompt_ring", draw: (L) => ring(L, true) },
  { name: "prompt_ring_2", draw: (L) => ring(L, false) },
];

export const CITY_ITEM_NAMES = CITY_ITEMS.map((i) => i.name);
