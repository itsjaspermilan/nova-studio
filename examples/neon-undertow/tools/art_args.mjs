// SUPERSEDED (the 16 px placeholder art): do not run, it would overwrite the detailed sheets. The art is made by art.mjs (the makers) and art_hd.mjs (hand-drawn pieces).
// Writes the argument files for the hand-drawn placeholder sprites (the makers lack a baton arc, shots, scrap, hearts...).
// Run: scripts/env.sh node examples/neon-undertow/tools/art_args.mjs <outdir>; then sprite_write each file with @path.
// Everything the game draws is reached by name (sprites/fx_arc, fx_shot, ...): replace the pictures, not the code.
import fs from "node:fs";
const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const write = (name, obj) => fs.writeFileSync(`${out}/${name}.json`, JSON.stringify(obj));

// ---- the baton's arc: a crescent in front of the pivot (6, 16) of a 32x32 frame, facing right.
function arc(span, r0, r1, core, edge, fade) {
  const rows = [];
  for (let y = 0; y < 32; y++) {
    let row = "";
    for (let x = 0; x < 32; x++) {
      const dx = x - 6, dy = y - 16;
      const r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
      let c = ".";
      if (Math.abs(a) <= span) {
        // thickest in the middle of the sweep, thin at the tips
        const t = 1 - Math.abs(a) / span;
        const mid = (r0 + r1) / 2, half = ((r1 - r0) / 2) * (0.35 + 0.65 * t);
        const d = Math.abs(r - mid);
        if (d <= half) c = d <= half * 0.45 ? core : edge;
        if (fade && c !== "." && (x * 7 + y * 3) % fade === 0) c = ".";
      }
      row += c;
    }
    rows.push(row);
  }
  return rows;
}
const D = Math.PI / 180;
write("fx_arc", {
  name: "fx_arc",
  palette: { w: "#ffffff", c: "#06f0ff", b: "#0a7fb8", m: "#ff2bd6", p: "#a01880" },
  frames: [
    arc(30 * D, 15, 21, "w", "c", 0), arc(52 * D, 15, 22, "w", "c", 0), arc(62 * D, 16, 22, "c", "b", 3),
    arc(40 * D, 15, 23, "w", "m", 0), arc(62 * D, 15, 25, "w", "m", 0), arc(72 * D, 16, 25, "m", "p", 3),
  ],
  animations: [{ name: "swing", from: 0, to: 2 }, { name: "heavy", from: 3, to: 5 }],
  frame_ms: 50,
});

// ---- shot (16x16, 2 frames), a small neon bolt; the head is on the right
const shot = (f) => [
  "................", "................", "................", "......c.........", "....cccbb.......",
  f ? "..cccwwwwcc....." : "...ccwwwwwcc....", f ? "..cccwwwwcc....." : "...ccwwwwwcc....", "....cccbb.......", "......c.........", "................",
  "................", "................", "................", "................", "................", "................",
];
write("fx_shot", {
  name: "fx_shot", palette: { w: "#ffffff", c: "#06f0ff", b: "#0a7fb8" },
  frames: [shot(0), shot(1)], animations: [{ name: "fly", from: 0, to: 1 }], frame_ms: 70,
});

// ---- the sight-line dot and a muzzle flash (8x8)
write("fx_dot", {
  name: "fx_dot", palette: { w: "#ffffff", c: "#06f0ff" },
  frames: [[".cccc...", "cwwwwc..", "cwwwwc..", ".cccc...", "........", "........", "........", "........"].map((r) => r)],
  size: [8, 8],
});

// ---- scrap (16x16): a spinning bit of salvaged circuit board, 4 frames
const scrap = (w) => {
  const h = 6, cx = 7.5, cy = 8;
  return {
    shapes: [
      { rect: [cx - w, cy - h / 2, w * 2, h], color: "g" },
      { rect: [cx - w + 1, cy - h / 2 + 1, Math.max(1, w * 2 - 2), 1], color: "m" },
      { rect: [cx - 1, cy, 2, 1], color: "w" },
    ],
    outline: "k",
  };
};
write("scrap", {
  name: "scrap", size: [16, 16], palette: { g: "#2fd6c8", m: "#ff2bd6", w: "#ffffff", k: "#05060f" },
  frames: [scrap(5), scrap(3), scrap(1), scrap(3)], animations: [{ name: "spin", from: 0, to: 3 }], frame_ms: 110,
});

// ---- the hud icons (16x16): heart full, half, empty; pip full, empty
const heartRows = (mode) => {
  const rows = [];
  for (let y = 0; y < 16; y++) {
    let row = "";
    for (let x = 0; x < 16; x++) {
      const nx = (x - 7.5) / 6.2, ny = -(y - 7.2) / 5.6;
      const inside = Math.pow(nx * nx + ny * ny - 1, 3) - nx * nx * Math.pow(ny, 3) <= 0;
      let c = ".";
      if (inside) c = mode === "full" || (mode === "half" && x < 8) ? "m" : "d";
      if (inside && c === "m" && y < 5 && x > 2 && x < 6 && y > 2) c = "h";
      row += c;
    }
    rows.push(row);
  }
  return rows;
};
write("hud_hearts", {
  name: "hud_hearts", size: [16, 16], palette: { m: "#ff2bd6", d: "#3a1840", k: "#05060f", h: "#ff9aec" },
  frames: [
    { rows: heartRows("full"), outline: "k", name: "heart_full" },
    { rows: heartRows("half"), outline: "k", name: "heart_half" },
    { rows: heartRows("empty"), outline: "k", name: "heart_empty" },
  ],
  names: ["heart_full", "heart_half", "heart_empty"],
});
write("hud_pips", {
  name: "hud_pips", size: [16, 16], palette: { c: "#06f0ff", w: "#ffffff", d: "#10303c", k: "#05060f" },
  frames: [
    { shapes: [{ rect: [4, 2, 8, 12], color: "c" }, { rect: [5, 3, 2, 10], color: "w" }], outline: "k", name: "pip_full" },
    { shapes: [{ rect: [4, 2, 8, 12], color: "d" }], outline: "k", name: "pip_empty" },
  ],
  names: ["pip_full", "pip_empty"],
});

// ---- a puddle (32x16), 2 frames of shimmer: magenta and cyan reflections of the signs
const puddle = (s) => ({
  shapes: [
    { ellipse: [15.5, 8, 15, 6.5], color: "e" }, { ellipse: [15.5, 8, 12, 4.5], color: "f" },
    { rect: [6 + s, 6, 8, 1], color: "m" }, { rect: [17 - s, 9, 8, 1], color: "c" }, { rect: [10 + s, 11, 5, 1], color: "c" },
  ],
});
write("puddle", {
  name: "puddle", size: [32, 16], palette: { e: "#1e3a66", f: "#0c1c3c", m: "#ff2bd6", c: "#06f0ff" },
  frames: [puddle(0), puddle(2)], animations: [{ name: "shimmer", from: 0, to: 1 }], frame_ms: 600,
});

// ---- the training dummy (24x32): a padded post with a target on its chest, hurt frame is a white copy
write("dummy", {
  name: "dummy", size: [24, 32], palette: { b: "#6a4a2a", t: "#e6d6b0", r: "#ff2bd6", k: "#05060f", s: "#2a2a44", w: "#ffffff" },
  frames: [
    {
      shapes: [
        { rect: [10, 20, 4, 9], color: "b" }, { rect: [6, 28, 12, 2], color: "s" },
        { rect: [6, 8, 12, 13], color: "t" }, { circle: [11.5, 5.5, 4.5], color: "t" },
        { circle: [11.5, 14.5, 4.6], color: "r", fill: false }, { circle: [11.5, 14.5, 2], color: "r" },
        { rect: [2, 10, 4, 3], color: "t" }, { rect: [18, 10, 4, 3], color: "t" },
      ],
      outline: "k", name: "idle",
    },
    { copy: 0, recolor: { "#e6d6b0": "#ffffff", "#6a4a2a": "#ffd0f4" }, name: "hit" },
  ],
  names: ["idle", "hit"],
  animations: [{ name: "idle", from: 0, to: 0 }, { name: "hit", from: 1, to: 1 }],
});

// ---- the death burst (32x32, 5 frames): a ring of neon sparks that grows and thins
const burst = (i) => {
  const shapes = [];
  const n = 10, r = 3 + i * 3.2;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + i * 0.2;
    const x = 15.5 + Math.cos(a) * r, y = 15.5 + Math.sin(a) * r;
    const sz = Math.max(1, 3 - Math.floor(i / 2));
    shapes.push({ rect: [Math.round(x), Math.round(y), sz, sz], color: k % 2 ? "m" : "c" });
  }
  if (i < 2) shapes.push({ circle: [15.5, 15.5, 5 - i * 2], color: "w" });
  return { shapes };
};
write("fx_burst", {
  name: "fx_burst", size: [32, 32], palette: { m: "#ff2bd6", c: "#06f0ff", w: "#ffffff" },
  frames: [0, 1, 2, 3, 4].map(burst), animations: [{ name: "burst", from: 0, to: 4, loop: false }], frame_ms: 70,
});

// ---- a hit spark (16x16, 3 frames) where the baton lands
const spark = (i) => ({
  shapes: [{ line: [7.5 - 2 - i * 2, 7.5, 7.5 + 2 + i * 2, 7.5], color: "w" }, { line: [7.5, 7.5 - 2 - i * 2, 7.5, 7.5 + 2 + i * 2], color: "w" },
  { line: [4 - i, 4 - i, 11 + i, 11 + i], color: "c" }, { line: [4 - i, 11 + i, 11 + i, 4 - i], color: "c" }],
});
write("fx_spark", {
  name: "fx_spark", size: [16, 16], palette: { w: "#ffffff", c: "#06f0ff" },
  frames: [0, 1, 2].map(spark), animations: [{ name: "spark", from: 0, to: 2, loop: false }], frame_ms: 50,
});
