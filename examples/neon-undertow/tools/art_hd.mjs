// The hand-drawn pieces the makers do not draw, in the same detailed style (bold two-pixel outline, a few flat tones, lit accents):
// the tram, the wrecks and junk, Mother Coil's cab, the Den's print bed, the dummy, the thrown bottle and can, fire, the marks, the
// baton's arc and the other effects, and the two card families the icon maker lacks (district, jinx).
// Run from the repository folder: scripts/env.sh node examples/neon-undertow/tools/art_hd.mjs [name ...]   (every piece, or the named ones)
// Each piece is a sprite_write call; the game stretches the stalls' neighbours to sizes set in data/ (nothing depends on a picture's size).
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const project = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const repo = project + "/../..";
const out = repo + "/build/neon-art";
fs.mkdirSync(out, { recursive: true });

// one palette for all of them: outline, five greys, rust, the two accents (magenta, cyan), warm light and glass
const PAL = {
  k: "#0a0912", a: "#171a28", b: "#262b3f", c: "#3c4560", d: "#5e6a8a", e: "#9aa6c8", w: "#eef2ff",
  R: "#4a2220", s: "#7e3c2a", t: "#b45c34", u: "#e8924e", v: "#ffc878",
  m: "#ff3fa4", M: "#9a1c66", n: "#35e6ff", N: "#1a7f9c", y: "#ffd860", Y: "#a07818", g: "#4e9a7a", G: "#25503e", p: "#6a3a8a", P: "#3a2058", o: "#ff7a2e",
};
const R = (x, y, w, h, color) => ({ rect: [x, y, w, h], color });
const E = (cx, cy, rx, ry, color) => ({ ellipse: [cx, cy, rx, ry], color });
const C = (cx, cy, r, color) => ({ circle: [cx, cy, r], color });
const L = (x0, y0, x1, y1, color) => ({ line: [x0, y0, x1, y1], color });
// the same shapes turned a quarter (x and y swapped), for the vertical tram
const T = (s) => s.map((o) => {
  const [k, v] = Object.entries(o).find(([k]) => k !== "color");
  const nv = k === "rect" ? [v[1], v[0], v[3], v[2]] : k === "ellipse" ? [v[1], v[0], v[3], v[2]] : k === "circle" ? [v[1], v[0], v[2]] : [v[1], v[0], v[3], v[2]];
  return { [k]: nv, color: o.color };
});
const sheets = {};
const sheet = (name, size, frames, extra = {}) => { sheets[name] = { name, palette: PAL, size, frames, ...extra }; };
const f = (shapes, outline = "k", name) => ({ shapes, ...(outline ? { outline } : {}), ...(name ? { name } : {}) });

// ---- the tram, seen from above and a little from the side, 192x64 (front at the right) and turned 64x192 (front at the bottom)
{
  const body = [
    R(3, 8, 186, 52, "c"), R(3, 8, 186, 6, "e"), R(3, 54, 186, 6, "b"),
    R(10, 17, 168, 20, "b"), R(10, 17, 168, 3, "c"),
    R(22, 21, 20, 12, "d"), R(24, 23, 16, 3, "e"), R(76, 21, 20, 12, "d"), R(78, 23, 16, 3, "e"), R(130, 21, 20, 12, "d"), R(132, 23, 16, 3, "e"),
    L(60, 14, 60, 36, "e"), L(112, 14, 112, 36, "e"),
    R(3, 38, 186, 3, "m"),
    ...Array.from({ length: 9 }, (_, i) => [R(10 + i * 18, 43, 13, 10, "N"), R(11 + i * 18, 44, 11, 8, "n"), R(11 + i * 18, 44, 11, 2, "w")]).flat(),
    R(170, 12, 20, 46, "e"), R(170, 12, 20, 5, "w"), R(176, 18, 11, 20, "N"), R(177, 19, 9, 18, "n"), R(177, 19, 9, 3, "w"),
    R(185, 16, 6, 9, "y"), R(185, 45, 6, 9, "y"), R(187, 18, 3, 5, "w"), R(187, 47, 3, 5, "w"),
    R(3, 16, 5, 9, "t"), R(3, 45, 5, 9, "t"),
  ];
  sheet("tram_h", [192, 64], [f(body)]);
  sheet("tram_v", [64, 192], [f(T(body))]);
}

// ---- a wrecked car (96x96): intact, then caved in and burnt. Seen from the front and above: roof, windscreen, bonnet, bumper, wheels.
{
  const car = (hurt) => [
    E(48, 84, 40, 7, "a"),
    R(8, 66, 16, 16, "k"), R(72, 66, 16, 16, "k"), R(10, 68, 12, 12, "b"), R(74, 68, 12, 12, "b"),
    R(8, 38, 80, 36, hurt ? "R" : "s"), R(8, 38, 80, 5, hurt ? "s" : "t"), R(8, 66, 80, 8, "R"),
    R(18, 14, 60, 30, hurt ? "s" : "t"), R(18, 14, 60, 5, "u"),
    R(23, 20, 50, 20, hurt ? "b" : "N"), R(23, 20, 50, 3, hurt ? "c" : "n"), L(30, 40, 46, 20, hurt ? "d" : "e"), L(52, 40, 68, 22, hurt ? "d" : "e"),
    R(14, 48, 14, 9, "y"), R(68, 48, 14, 9, "y"), R(16, 50, 10, 3, "w"), R(70, 50, 10, 3, "w"),
    R(30, 56, 36, 10, "b"), L(32, 58, 64, 58, "d"), L(32, 62, 64, 62, "d"),
    R(8, 72, 80, 5, "c"),
    ...(hurt ? [R(40, 8, 30, 12, "R"), L(24, 44, 40, 70, "k"), L(62, 40, 80, 68, "k"), R(52, 46, 22, 14, "k"), C(66, 20, 7, "o"), C(66, 18, 4, "y"), R(12, 38, 20, 8, "k")] : [L(20, 40, 36, 66, "R"), R(60, 44, 10, 6, "u")]),
  ];
  sheet("wreckage", [96, 96], [f(car(false)), f(car(true))]);
}

// ---- the junk Mother Coil drags across the floor (192x144): tyres, a crushed door, pipes, a fridge, sparks of rust
{
  const tyre = (x, y, r) => [C(x, y, r, "k"), C(x, y, r - 3, "b"), C(x, y, r - 8, "k"), C(x, y, Math.max(2, r - 12), "d")];
  sheet("coil_junk", [192, 144], [f([
    E(96, 126, 92, 14, "a"),
    R(6, 70, 180, 60, "c"), R(6, 70, 180, 6, "d"), R(6, 120, 180, 10, "b"),
    R(14, 40, 58, 52, "t"), R(14, 40, 58, 6, "u"), R(20, 52, 40, 26, "s"), L(16, 94, 70, 50, "R"),
    R(84, 24, 44, 70, "e"), R(84, 24, 44, 6, "w"), R(90, 34, 32, 22, "b"), R(90, 62, 32, 24, "d"), R(116, 40, 4, 12, "k"),
    R(138, 50, 42, 44, "s"), R(138, 50, 42, 5, "t"), L(140, 96, 178, 52, "k"),
    ...tyre(40, 100, 18), ...tyre(150, 104, 16), ...tyre(100, 108, 14),
    L(8, 36, 120, 124, "d"), L(24, 30, 150, 118, "e"), L(6, 118, 90, 20, "c"),
    R(70, 60, 8, 8, "y"), R(160, 70, 8, 8, "o"), R(30, 108, 8, 6, "y"),
  ])]);
}

// ---- Mother Coil's crane cab (192x128): a rusty box on a gantry; her in the left window (a purple bouffant in curlers, a round face, big lips), a
// lamp and her plate in the right one, and a round socket in the middle where the drum (crane_arm's base) sits.
{
  sheet("mother_coil", [192, 128], [f([
    R(0, 104, 192, 24, "b"), R(0, 104, 192, 5, "d"), R(6, 112, 180, 5, "a"), ...Array.from({ length: 12 }, (_, i) => R(8 + i * 15, 118, 9, 5, i % 2 ? "y" : "k")),
    R(8, 36, 176, 72, "t"), R(8, 36, 176, 8, "u"), R(8, 98, 176, 10, "s"),
    R(22, 48, 52, 46, "R"), R(26, 52, 44, 38, "N"), R(26, 52, 44, 5, "n"),
    E(48, 60, 24, 14, "P"), E(48, 59, 21, 12, "p"),
    ...[[30, 54], [40, 48], [52, 46], [64, 52]].map(([x, y]) => C(x, y, 4, "e")),
    E(48, 74, 14, 11, "u"), E(48, 72, 12, 9, "v"),
    R(40, 68, 5, 3, "k"), R(52, 68, 5, 3, "k"), R(41, 68, 2, 2, "w"), R(53, 68, 2, 2, "w"), E(48, 80, 6, 2.5, "m"),
    R(118, 48, 52, 46, "R"), R(122, 52, 44, 38, "N"), R(122, 52, 44, 5, "n"), R(128, 66, 32, 14, "k"), R(130, 68, 28, 10, "y"), R(132, 70, 24, 2, "k"), R(132, 74, 16, 2, "k"),
    C(96, 86, 38, "k"), C(96, 86, 35, "R"), C(96, 86, 31, "a"),
    R(88, 18, 16, 20, "d"), R(84, 6, 24, 14, "y"), R(88, 8, 16, 4, "w"),
    R(14, 24, 6, 16, "d"), R(172, 24, 6, 16, "d"), R(10, 20, 14, 6, "m"), R(168, 20, 14, 6, "n"),
    L(20, 106, 172, 106, "k"),
  ])]);
}

// ---- the Den's print bed (160x88): a steel tub of glowing cyan gel, a pillow, cables and a status strip
sheet("den_bed", [160, 88], [f([
  R(0, 20, 160, 64, "c"), R(0, 20, 160, 6, "e"), R(0, 74, 160, 10, "b"),
  R(8, 28, 144, 44, "b"), R(12, 32, 136, 36, "N"), R(12, 32, 136, 8, "n"), R(18, 44, 40, 3, "w"), R(84, 52, 50, 3, "w"),
  R(14, 36, 34, 24, "w"), R(14, 36, 34, 5, "e"), R(14, 56, 34, 4, "d"),
  R(112, 4, 38, 20, "d"), R(116, 8, 30, 8, "k"), R(118, 10, 8, 4, "m"), R(130, 10, 14, 4, "n"),
  L(150, 24, 158, 70, "k"), L(148, 26, 156, 72, "m"), L(6, 70, 2, 84, "k"),
  R(4, 78, 8, 4, "y"), R(148, 78, 8, 4, "y"),
])]);

// ---- the training dummy (48x64): a heavy base, a post, a padded body with a target, a round head; hit is a white copy
{
  const dummy = (flash) => {
    const body = flash ? "w" : "u", dark = flash ? "w" : "t", post = flash ? "w" : "s";
    return [
      E(24, 58, 18, 5, "a"), R(8, 52, 32, 8, flash ? "w" : "c"), R(8, 52, 32, 3, flash ? "w" : "d"),
      R(21, 34, 6, 20, post), R(21, 34, 2, 20, flash ? "w" : "t"),
      R(8, 14, 32, 26, body), R(8, 14, 32, 5, flash ? "w" : "v"), R(8, 34, 32, 6, dark),
      R(1, 18, 9, 7, body), R(38, 18, 9, 7, body),
      C(24, 8, 8, body), C(22, 6, 3, flash ? "w" : "v"),
      C(24, 28, 9, flash ? "w" : "w"), C(24, 28, 6, flash ? "w" : "m"), C(24, 28, 3, flash ? "w" : "w"), C(24, 28, 1, flash ? "w" : "m"),
    ];
  };
  sheet("dummy", [48, 64], [f(dummy(false), "k", "idle"), f(dummy(true), "k", "hit")], { names: ["idle", "hit"], animations: [{ name: "idle", from: 0, to: 0 }, { name: "hit", from: 1, to: 1 }] });
}

// ---- the thrown bottle (32x32, spins through 4 frames): a green glass bottle with a burning rag in the neck
{
  const bottle = (a) => {
    const d = [Math.cos(a), Math.sin(a)], at = (t, r, col) => C(16 + d[0] * t, 16 + d[1] * t, r, col);
    return [
      at(-6, 5.2, "G"), at(-3, 5.4, "g"), at(0, 5.4, "g"), at(3, 4.6, "g"), at(6, 3.2, "g"), at(9, 2.3, "g"),
      at(-5, 2, "w"), at(-2, 2, "e"),
      at(12, 3.2, "o"), at(13.5, 2.2, "y"), at(14.5, 1, "w"),
    ];
  };
  sheet("bottle", [32, 32], [0, 1, 2, 3].map((i) => f(bottle((i * Math.PI) / 4 + 0.3))), { animations: [{ name: "spin", from: 0, to: 3 }], frame_ms: 70 });
}

// ---- a thrown can (32x32, spins): silver with a magenta label
{
  const can = (w) => [E(16, 16, 11, w + 2, "d"), R(16 - 11, 16 - w, 22, w * 2, "e"), R(16 - 11, 16 - w, 22, 2, "w"), R(16 - 11, 16 - 2, 22, 4, "m"), E(16, 16 - w, 11, 3, "w"), E(16, 16 + w, 11, 3, "c")];
  const f2 = (w) => f([R(5, 16 - w, 22, w * 2, "e"), R(5, 16 - w, 22, 3, "w"), R(5, 14, 22, 4, "m"), R(5, 16 + w - 3, 22, 3, "c"), E(16, 16 - w, 11, 2, "w"), E(16, 16 + w, 11, 2, "c")]);
  sheet("can", [32, 32], [f2(9), f2(7), f2(4), f2(7)], { animations: [{ name: "spin", from: 0, to: 3 }], frame_ms: 80 });
}

// ---- the fire (64x64, burns through 4 frames): layered flames, the pivot 0.5, 0.75
{
  const fl = (i) => {
    const sway = [-3, 2, 4, -2][i], h = [30, 36, 33, 38][i];
    return [
      E(32, 50, 24, 8, "R"), E(32, 49, 21, 6, "s"),
      E(32 + sway * 0.3, 42, 16, 12, "t"), E(32 + sway, 30, 11, h / 2.2, "o"), E(32 + sway * 1.6, 18, 5, 9, "o"),
      E(32 + sway * 0.4, 42, 10, 8, "u"), E(32 + sway * 0.7, 34, 7, h / 3.2, "y"), E(32 + sway * 0.4, 42, 5, 5, "w"),
      R(14 - sway, 24 + i * 3, 3, 3, "y"), R(48 + sway, 16 + (i % 2) * 8, 3, 3, "o"),
    ];
  };
  sheet("fire", [64, 64], [0, 1, 2, 3].map((i) => f(fl(i), null)), { animations: [{ name: "burn", from: 0, to: 3 }], frame_ms: 90 });
}

// ---- marks over a head (32x32): buffed (cyan chevrons), burning (a flame), shot-marked (a crosshair), stunned (stars)
sheet("marks", [32, 32], [
  f([R(4, 18, 24, 6, "N"), L(5, 20, 16, 8, "n"), L(16, 8, 27, 20, "n"), L(5, 16, 16, 5, "w"), L(16, 5, 27, 16, "w"), L(5, 24, 16, 13, "n"), L(16, 13, 27, 24, "n")], "k", "buff"),
  f([E(16, 20, 8, 8, "o"), E(16, 14, 5, 9, "o"), E(16, 20, 5, 5, "y"), E(16, 22, 2, 3, "w")], "k", "burn"),
  f([C(16, 16, 10, "m"), C(16, 16, 6, "k"), R(15, 2, 2, 28, "m"), R(2, 15, 28, 2, "m"), C(16, 16, 2, "w")], "k", "marked"),
  f([R(14, 4, 4, 10, "y"), R(10, 8, 12, 4, "y"), R(4, 18, 4, 8, "y"), R(2, 20, 8, 4, "y"), R(22, 18, 4, 8, "y"), R(20, 20, 8, 4, "y"), R(15, 6, 2, 2, "w")], "k", "stun"),
], { names: ["buff", "burn", "marked", "stun"] });

// ---- the baton's arc (64x64, pivot 12, 32, facing right) and the effects. Doubled from the placeholders: drawn at 1.5.
{
  const arc = (span, r0, r1, core, edge, fade) => {
    const rows = [];
    for (let y = 0; y < 64; y++) {
      let row = "";
      for (let x = 0; x < 64; x++) {
        const dx = x - 12, dy = y - 32, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
        let c = ".";
        if (Math.abs(a) <= span) {
          const t = 1 - Math.abs(a) / span, mid = (r0 + r1) / 2, half = ((r1 - r0) / 2) * (0.3 + 0.7 * t), d = Math.abs(r - mid);
          if (d <= half) c = d <= half * 0.4 ? core : d <= half * 0.75 ? edge : "N";
          if (fade && c !== "." && (x * 7 + y * 3) % fade === 0) c = ".";
        }
        row += c;
      }
      rows.push(row);
    }
    return rows;
  };
  const D = Math.PI / 180;
  sheets.fx_arc = {
    name: "fx_arc", palette: { ...PAL, c: "#35e6ff", b: "#1a7f9c", z: "#ff3fa4", Z: "#9a1c66" }, size: [64, 64],
    frames: [arc(30 * D, 30, 44, "w", "n", 0), arc(52 * D, 30, 46, "w", "n", 0), arc(62 * D, 32, 46, "n", "N", 3),
      arc(40 * D, 30, 48, "w", "m", 0), arc(62 * D, 30, 52, "w", "m", 0), arc(72 * D, 32, 52, "m", "M", 3)].map((rows) => ({ rows })),
    animations: [{ name: "swing", from: 0, to: 2 }, { name: "heavy", from: 3, to: 5 }], frame_ms: 50,
  };
  const shot = (g) => [R(2, 13, 6, 6, "N"), R(6, 11, 10, 10, "N"), R(10, 9, 14, 14, "n"), R(14, 11, 16, 10, g ? "w" : "n"), R(22, 13, 9, 6, "w"), C(26, 16, 3, "w")];
  // (fx_shot, fx_arc's successors and the rest of the effects are drawn by art_fx.mjs now: the shot is its 48x24 bolt; this script no longer writes fx_shot)
  sheet("fx_dot", [16, 16], [f([C(8, 8, 6, "N"), C(8, 8, 4, "n"), C(8, 8, 2, "w")], null)]);
  const spark = (i) => [L(16 - 5 - i * 4, 16, 16 + 5 + i * 4, 16, "w"), L(16, 16 - 5 - i * 4, 16, 16 + 5 + i * 4, "w"), L(7 - i * 2, 7 - i * 2, 25 + i * 2, 25 + i * 2, "n"), L(7 - i * 2, 25 + i * 2, 25 + i * 2, 7 - i * 2, "n"), C(16, 16, Math.max(1, 5 - i * 2), "w")];
  sheet("fx_spark", [32, 32], [0, 1, 2].map((i) => f(spark(i), null)), { animations: [{ name: "spark", from: 0, to: 2, loop: false }], frame_ms: 50 });
  const burst = (i) => {
    const sh = [], n = 12, r = 6 + i * 6.4;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + i * 0.2, x = 31.5 + Math.cos(a) * r, y = 31.5 + Math.sin(a) * r, sz = Math.max(2, 7 - i * 1.2);
      sh.push(R(Math.round(x - sz / 2), Math.round(y - sz / 2), sz, sz, k % 2 ? "m" : "n"));
    }
    if (i < 3) sh.push(C(31.5, 31.5, 12 - i * 4, "w"), C(31.5, 31.5, 18 - i * 5, "N"));
    return sh;
  };
  sheet("fx_burst", [64, 64], [0, 1, 2, 3, 4].map((i) => f(burst(i), null)), { animations: [{ name: "burst", from: 0, to: 4, loop: false }], frame_ms: 70 });
}

// ---- the icon sheet's missing card family, appended to sprites/ui.png after items_make's 26 frames (26 to 28): jinx (a warning skull) in white, cyan, magenta (32x32). The district cards use items_make's own skyline (20 to 22).
{
  const frameOf = (edge, glow, kind) => {
    const sh = [R(5, 2, 22, 28, edge), R(7, 4, 18, 24, "a")];
    if (kind === "district") sh.push(R(9, 18, 4, 8, "e"), R(13, 12, 4, 14, "w"), R(17, 15, 3, 11, "e"), R(21, 9, 3, 17, "w"), R(10, 20, 1, 1, "k"), R(14, 15, 1, 1, "k"), R(14, 19, 1, 1, "k"), R(22, 12, 1, 1, "k"), R(22, 16, 1, 1, "k"), R(9, 26, 15, 1, glow));
    else sh.push(C(16, 13, 6, "w"), R(12, 17, 9, 6, "w"), R(12, 12, 3, 3, "k"), R(18, 12, 3, 3, "k"), R(15, 16, 3, 2, "k"), R(13, 21, 1, 3, "k"), R(16, 21, 1, 3, "k"), R(19, 21, 1, 3, "k"), L(9, 8, 23, 8, "y"), R(9, 25, 15, 2, "y"));
    return f(sh, "k");
  };
  // (the frame colour is the rarity's: white, cyan, magenta, as in the maker's card_<family>_<rarity>)
  const fr = [];
  for (const kind of ["jinx"]) for (const [edge, glow] of [["w", "e"], ["n", "n"], ["m", "m"]]) fr.push(frameOf(edge, glow, kind));
  sheet("ui", [32, 32], fr, { append: true, names: ["card_jinx_common", "card_jinx_uncommon", "card_jinx_rare"] });
}


// ---- the door (32x64 frames, drawn at 1.5: 48x96, one tile wide and two tall): a rolling shutter. locked: slats down, a magenta lamp; unlocked:
// slats down, a cyan lamp (the cards must be taken first); open: rolled up, a dark way through with the roller overhead.
{
  const frame = (lamp, up) => up
    ? [R(0, 0, 32, 10, "c"), R(0, 0, 32, 3, "e"), R(2, 10, 28, 3, "b"), R(4, 13, 24, 48, "a"), R(4, 13, 3, 48, "b"), R(25, 13, 3, 48, "b"), R(6, 56, 20, 2, lamp), R(8, 3, 16, 3, lamp)]
    : [R(0, 0, 32, 64, "c"), R(0, 0, 32, 4, "e"), R(2, 6, 28, 54, "b"),
      ...Array.from({ length: 9 }, (_, i) => [R(3, 7 + i * 6, 26, 4, "d"), R(3, 7 + i * 6, 26, 1, "e"), R(3, 10 + i * 6, 26, 1, "a")]).flat(),
      R(11, 24, 10, 14, "a"), R(13, 26, 6, 10, lamp), R(14, 27, 4, 3, "w"), R(0, 60, 32, 4, "y"), R(4, 60, 4, 4, "k"), R(12, 60, 4, 4, "k"), R(20, 60, 4, 4, "k"), R(28, 60, 4, 4, "k"),
      R(1, 1, 3, 3, lamp), R(28, 1, 3, 3, lamp)];
  sheet("door", [32, 64], [f(frame("m", false)), f(frame("n", false)), f(frame("n", true))], { names: ["locked", "unlocked", "open"],
    animations: [{ name: "locked", from: 0, to: 0 }, { name: "unlocked", from: 1, to: 1 }, { name: "open", from: 2, to: 2 }] });
  sheet("den_door", [48, 96], [f([R(0, 0, 48, 96, "c"), R(0, 0, 48, 6, "e"), R(5, 10, 38, 82, "b"), R(9, 14, 30, 74, "a"), R(12, 18, 24, 66, "N"), R(12, 18, 24, 8, "n"), R(14, 30, 20, 3, "w"), R(14, 50, 20, 3, "w"), R(14, 70, 20, 3, "w"), R(0, 90, 48, 6, "y"), R(2, 2, 5, 5, "n"), R(41, 2, 5, 5, "n")])]);
}

// ---- LULLABY's screen (72x72, two frames): a cracked wall screen with a sleepy face in cyan, the second frame blinking in magenta
{
  const face = (col, glow, blink) => [R(0, 2, 72, 56, "c"), R(0, 2, 72, 4, "e"), R(4, 8, 64, 46, "k"), R(6, 10, 60, 42, "a"),
    R(12, 22, 16, blink ? 3 : 10, col), R(44, 22, 16, blink ? 3 : 10, col), R(14, 24, 6, blink ? 1 : 3, "w"), R(46, 24, 6, blink ? 1 : 3, "w"),
    R(26, 42, 20, 3, col), R(30, 45, 12, 2, glow), L(8, 12, 30, 34, "d"), L(30, 34, 24, 50, "d"), L(30, 34, 52, 30, "b"),
    R(8, 56, 56, 6, "b"), R(14, 62, 6, 10, "k"), R(34, 62, 6, 10, "k"), R(52, 62, 6, 10, "k"), L(17, 62, 12, 72, "m"), L(37, 62, 44, 72, "n"), R(6, 50, 6, 3, "y")];
  sheet("den_screen", [72, 72], [f(face("n", "N", false)), f(face("m", "M", true))]);
}

// ---- the Workbench (128x64): a heavy bench with a lit cyan board, a vise, a clamp light, parts and a soldering iron
sheet("den_bench", [128, 64], [f([
  R(0, 22, 128, 38, "s"), R(0, 22, 128, 6, "u"), R(0, 54, 128, 8, "R"), R(6, 28, 4, 30, "R"), R(118, 28, 4, 30, "R"),
  R(10, 4, 36, 20, "N"), R(10, 4, 36, 4, "n"), R(14, 10, 10, 2, "w"), R(28, 10, 14, 2, "w"), R(14, 15, 22, 2, "w"),
  R(56, 14, 16, 10, "d"), R(56, 14, 16, 3, "e"), R(60, 8, 8, 8, "c"),
  R(84, 12, 4, 12, "e"), L(86, 12, 98, 2, "e"), C(100, 4, 5, "y"), R(97, 2, 6, 3, "w"),
  R(106, 14, 14, 10, "m"), R(108, 12, 4, 3, "w"), R(20, 34, 18, 10, "c"), R(44, 36, 10, 8, "y"), R(62, 34, 12, 10, "d"), R(84, 36, 16, 8, "n"),
])]);

const want = process.argv.slice(2);
for (const [name, args] of Object.entries(sheets)) {
  if (want.length && !want.includes(name)) continue;
  const file = `${out}/${name}.json`;
  fs.writeFileSync(file, JSON.stringify(args));
  const res = execFileSync(repo + "/scripts/nova-tool", ["--project", project, "sprite_write", "@" + file], { encoding: "utf8", cwd: repo });
  console.log(res.split("\n").filter((l) => !l.startsWith("picture") && !l.startsWith("[image")).slice(0, 2).map((l) => l.slice(0, 200)).join("\n"));
}
