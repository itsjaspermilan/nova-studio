// items_make: the small pictures every adventure needs, in the same style and palette as the rest: hearts (full, half,
// empty), a key, a coin that spins, a gem, a chest (closed, open), potions and a sword. One sheet of 16x16 frames, every
// frame named, with the coin's spin and the chest's opening tagged as animations.

import { Img, mix, ramp, type Ramp, type Rgba } from "./paint";
import { lit, paletteOf, type Palette } from "./palettes";
import { writeSheet, type Put } from "./sheet";

type Args = Record<string, any>;

const WHITE: Rgba = [255, 255, 255, 255];
const N = 16;

interface Look {
  P: Palette;
  red: Ramp;
  gold: Ramp;
  metal: Ramp;
  wood: Ramp;
  gem: Ramp;
  blue: Ramp;
  empty: Ramp;
  glass: Ramp;
}

function lump(img: Img, test: (x: number, y: number) => boolean, light: (x: number, y: number) => number, r: Ramp) {
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!test(x, y)) continue;
    const l = light(x, y);
    img.set(x, y, l > 0.6 ? r[4] : l > 0.2 ? r[3] : l > -0.35 ? r[2] : l > -0.7 ? r[1] : r[0]);
  }
}

function heart(L: Look, fill: number): Img {
  const img = new Img(N, N);
  const inside = (x: number, y: number) => Math.hypot(x - 4.5, y - 5.5) <= 3.4 || Math.hypot(x - 10.5, y - 5.5) <= 3.4 || (y >= 6 && y <= 13 && Math.abs(x - 7.5) <= (13.6 - y) * 0.92);
  const light = (x: number, y: number) => -((x - 7.5) / 7) * 0.6 - ((y - 7.5) / 6) * 0.7;
  lump(img, inside, light, L.empty);
  // a full heart, or its left half
  lump(img, (x, y) => inside(x, y) && (fill === 2 || (fill === 1 && x <= 7)), light, L.red);
  if (fill) {
    img.set(3, 4, WHITE);
    img.set(4, 4, WHITE);
    img.set(3, 5, WHITE);
  }
  return img.outline(L.P.outline);
}

function key(L: Look): Img {
  const img = new Img(N, N), g = L.gold;
  img.ellipse(4.5, 5.5, 3, 3, g[2]);
  img.ellipse(4.5, 5.5, 1.1, 1.1, null);
  img.ellipse(3.6, 4.4, 1.4, 1, (x, y) => (img.has(x, y) ? g[4] : undefined));
  // the shaft runs down to the right, with two teeth
  for (let i = 0; i < 8; i++) {
    img.set(7 + i, 8 + i * 0.75, g[3]);
    img.set(7 + i, 9 + i * 0.75, g[1]);
  }
  img.rect(11, 13, 1, 2, g[2]);
  img.rect(13, 14, 1, 2, g[2]);
  img.set(13, 15, g[1]);
  return img.outline(L.P.outline);
}

function coin(L: Look, turn: number): Img {
  const img = new Img(N, N), g = L.gold;
  const rx = [5.5, 4, 1.2, 4][turn]!;
  img.ellipse(7.5, 8, rx, 5.5, (x, y) => {
    const u = (x - 7.5) / Math.max(1, rx), v = (y - 8) / 5.5;
    const l = -u * 0.6 - v * 0.6;
    return l > 0.5 ? g[4] : l > 0 ? g[3] : l > -0.5 ? g[2] : g[1];
  });
  if (rx > 3) {
    img.ellipse(7.5, 8, rx - 2, 3.5, (x, y) => (Math.hypot((x - 7.5) / (rx - 2), (y - 8) / 3.5) > 0.72 ? g[turn === 3 ? 3 : 1] : undefined));
    img.rect(7, 6, 1, 5, g[turn === 3 ? 1 : 4]);
  } else img.rect(7, 3, 1, 11, g[4]);
  return img.outline(L.P.outline);
}

function gem(L: Look): Img {
  const img = new Img(N, N), g = L.gem;
  const widths = [6, 10, 12, 12, 10, 8, 6, 4, 2];
  widths.forEach((w, i) => {
    const y = 4 + i;
    for (let x = 8 - w / 2; x < 8 + w / 2; x++) {
      const u = (x - 7.5) / (w / 2);
      // a cut stone: a bright table on top, a lit left facet, a dark right one
      img.set(x, y, i === 0 ? g[4] : i < 2 ? (u < 0.4 ? g[4] : g[3]) : u < -0.45 ? g[3] : u > 0.45 ? g[0] : u > 0 ? g[1] : g[2]);
    }
  });
  img.set(5, 5, WHITE);
  img.set(4, 6, WHITE);
  img.line(6, 6, 7, 12, g[3]);
  return img.outline(L.P.outline);
}

function chest(L: Look, open: boolean): Img {
  const img = new Img(N, N), w = L.wood, m = L.metal, g = L.gold;
  // the box
  img.rect(2, 8, 12, 6, w[2]);
  img.rect(2, 8, 12, 1, w[1]);
  img.rect(2, 13, 12, 1, w[0]);
  for (const x of [5, 8, 11]) img.rect(x, 9, 1, 4, w[1]);
  for (const x of [2, 13]) img.rect(x, 8, 1, 6, m[2]);
  img.rect(2, 8, 1, 6, m[3]);
  if (open) {
    // the lid stands up behind; the dark inside holds a glint of gold
    img.rect(2, 2, 12, 4, w[1]);
    img.rect(2, 2, 12, 1, w[3]);
    img.rect(2, 2, 1, 4, m[3]);
    img.rect(13, 2, 1, 4, m[1]);
    img.rect(3, 6, 10, 2, mix(L.P.outline, w[0], 0.4));
    for (const [x, y] of [[5, 7], [6, 6], [7, 7], [8, 7], [9, 6], [10, 7]]) img.set(x!, y!, g[y === 6 ? 4 : 2]);
  } else {
    // the lid: a rounded top, lighter where the light falls, with a lock
    img.rect(2, 4, 12, 4, w[3]);
    img.rect(3, 3, 10, 1, w[4]);
    img.rect(2, 7, 12, 1, w[1]);
    for (const x of [2, 13]) img.rect(x, 4, 1, 4, m[x === 2 ? 4 : 2]);
    img.rect(7, 7, 2, 3, g[2]);
    img.rect(7, 7, 2, 1, g[4]);
    img.set(7, 9, L.P.outline);
  }
  return img.outline(L.P.outline);
}

function potion(L: Look, liquid: Ramp): Img {
  const img = new Img(N, N), gl = L.glass;
  img.rect(6, 3, 4, 4, gl[3]);
  img.rect(9, 3, 1, 4, gl[1]);
  img.rect(6, 1, 4, 2, L.wood[2]);
  img.rect(6, 1, 4, 1, L.wood[4]);
  img.ellipse(7.5, 10, 4.5, 4, (x, y) => {
    const u = (x - 7.5) / 4.5;
    // glass above the liquid's surface, liquid below, darker to the right
    if (y < 8) return u > 0.5 ? gl[1] : gl[3];
    return y === 8 ? liquid[4] : u > 0.45 ? liquid[1] : u < -0.5 ? liquid[3] : liquid[2];
  });
  img.set(5, 9, WHITE);
  img.set(5, 10, WHITE);
  img.set(6, 5, WHITE);
  return img.outline(L.P.outline);
}

function sword(L: Look): Img {
  const img = new Img(N, N), m = L.metal, g = L.gold;
  // the blade runs from the bottom left up to the right, light along one edge and dark along the other
  for (let i = 0; i < 9; i++) {
    img.set(5 + i, 10 - i, m[4]);
    img.set(6 + i, 10 - i, m[2]);
    img.set(5 + i, 11 - i, m[3]);
  }
  img.set(14, 1, m[4]);
  for (let i = -2; i <= 2; i++) img.set(4 + i, 9 + i + (i > 0 ? 1 : 0) + 1, g[i < 0 ? 4 : 2]);
  img.set(3, 12, L.wood[2]);
  img.set(2, 13, L.wood[1]);
  img.set(3, 13, L.wood[1]);
  img.set(1, 14, g[3]);
  return img.outline(L.P.outline);
}

const ALL: { name: string; draw: (L: Look) => Img }[] = [
  { name: "heart_full", draw: (L) => heart(L, 2) },
  { name: "heart_half", draw: (L) => heart(L, 1) },
  { name: "heart_empty", draw: (L) => heart(L, 0) },
  { name: "key", draw: key },
  { name: "coin", draw: (L) => coin(L, 0) },
  { name: "coin_2", draw: (L) => coin(L, 1) },
  { name: "coin_3", draw: (L) => coin(L, 2) },
  { name: "coin_4", draw: (L) => coin(L, 3) },
  { name: "gem", draw: gem },
  { name: "chest_closed", draw: (L) => chest(L, false) },
  { name: "chest_open", draw: (L) => chest(L, true) },
  { name: "potion", draw: (L) => potion(L, L.red) },
  { name: "potion_blue", draw: (L) => potion(L, L.blue) },
  { name: "sword", draw: sword },
];

export const ITEM_NAMES = ALL.map((i) => i.name);

/// `items_make`: see the tool's description in makers/index.ts.
export function makeItems(name: string, a: Args, put: Put): { text: string; picture: import("./paint").Raster } {
  const P = paletteOf(a.palette);
  const t = (c: Rgba) => lit(P, c);
  const L: Look = {
    P,
    red: P.mat.flower.map(t) as Ramp,
    gold: P.mat.gold.map(t) as Ramp,
    metal: P.mat.metal.map(t) as Ramp,
    wood: P.mat.wood.map(t) as Ramp,
    gem: ramp(t([64, 196, 170, 255])),
    blue: P.mat.water.map(t) as Ramp,
    empty: ramp(mix(P.outline, P.mat.flower[0], 0.35)),
    glass: ramp(t([200, 222, 236, 255])),
  };
  const frames = ALL.map((i) => i.draw(L));
  const names: Record<number, string> = {};
  ALL.forEach((i, n) => (names[n] = i.name));
  const at = (n: string) => ITEM_NAMES.indexOf(n);
  const durations = ALL.map((i) => (i.name.startsWith("coin") ? 110 : 200));
  const made = writeSheet(name, {
    frames, names, durations,
    tags: [{ name: "coin", from: at("coin"), to: at("coin_4") }, { name: "chest", from: at("chest_closed"), to: at("chest_open"), loop: false }],
  }, put);
  return {
    text: [
      made.text,
      `palette "${P.name}". Draw one by its frame number: nova.sprite("${name}", x, y, { frame = ${at("heart_full")}, sx = 3, sy = 3 }) is a full heart (in draw_ui, screen coordinates; in an entity's own draw() use nova.cam.to_screen).`,
      `An entity that is one of them: sprite = "${name}", frame = ${at("key")} (the key); a coin that spins: sprite = "${name}", anim = "coin"; a chest: frame = ${at("chest_closed")}, then self:play("chest") when it is opened.`,
      `Change one afterwards with sprite_preview { "name": "${name}", "frame": "gem" } and sprite_write { "at": n }; add your own with "append": true.`,
    ].join("\n"),
    picture: made.picture,
  };
}
