// SUPERSEDED (the 16 px placeholder art): do not run, it would overwrite the detailed sheets. The art is made by art.mjs (the makers) and art_hd.mjs (hand-drawn pieces).
// Slice 2's hand-drawn placeholder sprites (the makers lack vending machines, bottles, doors, cards...).
// Run: scripts/env.sh node examples/neon-undertow/tools/art_args2.mjs <outdir>; then sprite_write each file with @path.
// Everything the game draws is reached by name: replace the pictures, not the code.
import fs from "node:fs";
const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const write = (name, obj) => fs.writeFileSync(`${out}/${name}.json`, JSON.stringify(obj));

// ---- the Mimic Vendor (24x32): a vending machine. 0 idle, 1 and 2 flicker (screen glitching, eyes), 3 open (spitting), 4 hit
const vend = (mode) => {
  const shapes = [
    { rect: [3, 2, 18, 29], color: "b" },        // body
    { rect: [4, 3, 16, 27], color: "g" },
    { rect: [5, 5, 11, 15], color: "k" },        // window
    { rect: [6, 6, 9, 13], color: mode === 1 ? "m" : mode === 2 ? "c" : "d" },
    { rect: [17, 6, 2, 3], color: "m" },         // buttons
    { rect: [17, 11, 2, 3], color: "c" },
    { rect: [17, 16, 2, 3], color: "m" },
    { rect: [6, 22, 12, 6], color: "k" },        // the slot
    { rect: [3, 30, 18, 2], color: "k" },
  ];
  // goods on the shelves: little coloured cans
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) shapes.push({ rect: [7 + i * 3, 7 + j * 4, 2, 3], color: (i + j) % 2 ? "c" : "m" });
  if (mode === 1 || mode === 2) {                // flicker: two angry eyes in the window, a glitch bar
    shapes.push({ rect: [7, 9, 2, 2], color: "w" }, { rect: [12, 9, 2, 2], color: "w" }, { rect: [mode === 1 ? 6 : 8, 15, 8, 1], color: "w" });
  }
  if (mode === 3) {                              // open: a toothy mouth where the slot is
    shapes.push({ rect: [5, 20, 14, 9], color: "r" }, { rect: [6, 21, 12, 7], color: "k" });
    for (let i = 0; i < 6; i++) shapes.push({ rect: [6 + i * 2, 21, 1, 2], color: "w" }, { rect: [7 + i * 2, 26, 1, 2], color: "w" });
    shapes.push({ rect: [7, 9, 2, 2], color: "w" }, { rect: [12, 9, 2, 2], color: "w" });
  }
  return { shapes, outline: "k" };
};
write("mimic_vendor", {
  name: "mimic_vendor", size: [24, 32],
  palette: { b: "#2a2a44", g: "#3a3d66", k: "#05060f", d: "#0c1c3c", m: "#ff2bd6", c: "#06f0ff", w: "#ffffff", r: "#a01880" },
  frames: [vend(0), vend(1), vend(2), vend(3), { copy: 0, silhouette: true }],
  animations: [
    { name: "idle", from: 0, to: 0 }, { name: "flicker", from: 1, to: 2 }, { name: "open", from: 3, to: 3 }, { name: "hit", from: 4, to: 4 },
  ],
  frame_ms: 90,
});

// ---- the bottle (8x8, spinning) and the can (8x8)
const rot = (a) => {
  const shapes = [];
  const cx = 3.5, cy = 3.5;
  for (let t = -3; t <= 3; t++) {
    const x = Math.round(cx + Math.cos(a) * t), y = Math.round(cy + Math.sin(a) * t);
    shapes.push({ rect: [x, y, 1, 1], color: t >= 2 ? "n" : "g" });
    if (t < 2 && t > -3) shapes.push({ rect: [x + (Math.abs(Math.sin(a)) > 0.5 ? 1 : 0), y + (Math.abs(Math.sin(a)) > 0.5 ? 0 : 1), 1, 1], color: "g" });
  }
  return { shapes, outline: "k" };
};
write("bottle", {
  name: "bottle", size: [8, 8], palette: { g: "#7bd66b", n: "#d9ffd0", k: "#05060f" },
  frames: [rot(-Math.PI / 2), rot(-Math.PI / 4), rot(0), rot(Math.PI / 4)],
  animations: [{ name: "spin", from: 0, to: 3 }], frame_ms: 70,
});
write("can", {
  name: "can", size: [8, 8], palette: { m: "#ff2bd6", c: "#06f0ff", w: "#ffffff", k: "#05060f" },
  frames: [
    { shapes: [{ rect: [2, 2, 4, 5], color: "m" }, { rect: [2, 2, 4, 1], color: "w" }, { rect: [3, 4, 2, 1], color: "c" }], outline: "k" },
    { shapes: [{ rect: [2, 2, 4, 5], color: "c" }, { rect: [2, 2, 4, 1], color: "w" }, { rect: [3, 4, 2, 1], color: "m" }], outline: "k" },
  ],
  animations: [{ name: "spin", from: 0, to: 1 }], frame_ms: 80,
});

// ---- fire (16x16, 3 frames): a patch of flames on the ground
const flame = (s) => ({
  shapes: [
    { ellipse: [7.5, 11, 7, 3.5], color: "r" },
    { ellipse: [4 + s, 8, 2.5, 5], color: "o" }, { ellipse: [8, 6 - s, 3, 7], color: "o" }, { ellipse: [11 - s, 8, 2.5, 4.5], color: "o" },
    { ellipse: [8, 8 - s, 1.6, 4], color: "y" }, { ellipse: [5 + s, 10, 1.2, 2.5], color: "y" },
    { rect: [7, 10, 2, 2], color: "w" },
  ],
});
write("fire", {
  name: "fire", size: [16, 16], palette: { r: "#a01880", o: "#ff8a2b", y: "#ffe45e", w: "#ffffff" },
  frames: [flame(0), flame(1), flame(2)], animations: [{ name: "burn", from: 0, to: 2 }], frame_ms: 90,
});

// ---- the door (16x32), set in a vertical wall: 0 locked (magenta light), 1 unlocked (cyan light, bars still down), 2 open
const door = (mode) => {
  const light = mode === 0 ? "m" : "c";
  const shapes = [
    { rect: [0, 0, 16, 32], color: "f" },
    { rect: [0, 0, 3, 32], color: "p" }, { rect: [13, 0, 3, 32], color: "p" },
  ];
  if (mode < 2) {
    shapes.push({ rect: [3, 1, 10, 30], color: "d" });
    for (let i = 0; i < 4; i++) shapes.push({ rect: [4 + i * 3, 2, 2, 28], color: "s" });
    shapes.push({ rect: [3, 14, 10, 4], color: "p" }, { rect: [6, 15, 4, 2], color: light });
    shapes.push({ rect: [6, 1, 4, 2], color: light }, { rect: [6, 29, 4, 2], color: light });
  } else {
    shapes.push({ rect: [3, 1, 10, 30], color: "f" }, { rect: [1, 1, 1, 30], color: "c" });
  }
  return { shapes, outline: "k" };
};
write("door", {
  name: "door", size: [16, 32], palette: { f: "#1a1e36", p: "#3a3d66", d: "#0a0c1c", s: "#6a6d99", m: "#ff2bd6", c: "#06f0ff", k: "#05060f" },
  frames: [door(0), door(1), door(2)],
  animations: [{ name: "locked", from: 0, to: 0 }, { name: "unlocked", from: 1, to: 1 }, { name: "open", from: 2, to: 2 }],
  frame_ms: 100,
});

// ---- cards on the floor (16x24): common white, uncommon cyan, rare magenta
const cardFrame = (edge) => ({
  shapes: [
    { rect: [1, 1, 14, 22], color: edge }, { rect: [2, 2, 12, 20], color: "d" },
    { rect: [4, 4, 8, 8], color: "k" }, { rect: [4, 15, 8, 1], color: edge }, { rect: [4, 18, 6, 1], color: edge },
  ],
  outline: "k",
});
write("card", {
  name: "card", size: [16, 24], palette: { w: "#ffffff", c: "#06f0ff", m: "#ff2bd6", d: "#10142a", k: "#05060f" },
  frames: [cardFrame("w"), cardFrame("c"), cardFrame("m")],
  animations: [{ name: "common", from: 0, to: 0 }, { name: "uncommon", from: 1, to: 1 }, { name: "rare", from: 2, to: 2 }],
  frame_ms: 100,
});

// ---- family icons (16x16): 0 baton, 1 sidearm, 2 roll, 3 body
write("icons", {
  name: "icons", size: [16, 16], palette: { w: "#ffffff", c: "#06f0ff", m: "#ff2bd6", k: "#05060f" },
  frames: [
    { shapes: [{ line: [3, 13, 12, 4], color: "w" }, { line: [4, 13, 13, 4], color: "c" }, { rect: [2, 12, 3, 3], color: "m" }], outline: "k" },
    { shapes: [{ rect: [2, 7, 9, 3], color: "c" }, { rect: [10, 5, 4, 7], color: "w" }, { rect: [4, 10, 3, 4], color: "c" }], outline: "k" },
    { shapes: [{ ellipse: [8, 8, 5, 5], color: "c", fill: false }, { ellipse: [8, 8, 4, 4], color: "c", fill: false }, { rect: [11, 2, 4, 3], color: "m" }, { rect: [12, 4, 3, 3], color: "m" }], outline: "k" },
    { shapes: [{ rect: [6, 2, 4, 12], color: "m" }, { rect: [2, 6, 12, 4], color: "m" }, { rect: [7, 3, 2, 10], color: "w" }, { rect: [3, 7, 10, 2], color: "w" }], outline: "k" },
  ],
  names: ["baton", "sidearm", "roll", "body"],
});

// ---- status marks (16x16): 0 buffed (an up-chevron), 1 burning, 2 shot-marked (a crosshair), 3 stunned (stars)
write("marks", {
  name: "marks", size: [16, 16], palette: { w: "#ffffff", c: "#06f0ff", o: "#ff8a2b", y: "#ffe45e", r: "#ff3b5c", k: "#05060f" },
  frames: [
    { shapes: [{ line: [3, 9, 8, 4], color: "c" }, { line: [13, 9, 8, 4], color: "c" }, { line: [3, 13, 8, 8], color: "c" }, { line: [13, 13, 8, 8], color: "c" }], outline: "k", name: "buff" },
    { shapes: [{ ellipse: [8, 10, 3.5, 4.5], color: "o" }, { ellipse: [8, 6, 2, 4], color: "o" }, { ellipse: [8, 11, 1.5, 3], color: "y" }], outline: "k", name: "burn" },
    { shapes: [{ ellipse: [8, 8, 5, 5], color: "r", fill: false }, { rect: [7, 1, 2, 4], color: "r" }, { rect: [7, 11, 2, 4], color: "r" }, { rect: [1, 7, 4, 2], color: "r" }, { rect: [11, 7, 4, 2], color: "r" }], outline: "k", name: "marked" },
    { shapes: [{ rect: [3, 6, 2, 2], color: "y" }, { rect: [7, 3, 2, 2], color: "y" }, { rect: [11, 6, 2, 2], color: "y" }, { rect: [7, 9, 2, 2], color: "w" }], outline: "k", name: "stun" },
  ],
  names: ["buff", "burn", "marked", "stun"],
});

// ---- one solid white square (4x4): stretched, turned and tinted it draws the lanes of the tells (lib/draw.lua)
write("solid", { name: "solid", size: [4, 4], palette: { w: "#ffffff" }, frames: [{ shapes: [{ rect: [0, 0, 4, 4], color: "w" }] }] });
