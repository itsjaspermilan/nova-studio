// The second half of the effects' art (see art_fx.mjs): the swings' crescents, the flames, the shots and what they leave.
import { Img, fbm, hex, mixc, noise, rng, writeSheet } from "./fxkit.mjs";

export const PALS = {
  cyan: { white: hex("#ffffff"), pale: hex("#c4fbff"), main: hex("#35e6ff"), deep: hex("#1a8fb4"), edge: hex("#0b3550"), glow: hex("#35e6ff") },
  magenta: { white: hex("#fff0fb"), pale: hex("#ffc2ee"), main: hex("#ff3fa4"), deep: hex("#a21c70"), edge: hex("#4a0f38"), glow: hex("#ff3fa4") },
};

// One crescent picture. The picture's 128 x 128 pixels are the swing's hit box exactly: its left edge is where the hit begins in front of
// the runner, its right edge the far end of the box, its top and bottom the two sides; the game stretches it to the box's size and turns
// it to face. `head`: how far the sweep has got (degrees, -80 to 80: 80 and over is all of it), `trail`: how long a tail it drags, `g`:
// how much of the light is left (an afterimage is dimmer and thinner), `heavy`: thicker with a second arc.
function crescent(pal, { head, trail = 130, g = 1, heavy = false, rev = false, glow = false }) {
  const S = 128, p = 2.3, c = heavy ? 0.34 : 0.44, thick = heavy ? 0.34 : 0.24, thickV = heavy ? 0.16 : 0.12;
  const img = new Img(S, S);
  const D = Math.PI / 180;
  img.fill((x, y) => {
    const u = (x + 0.5) / S, v0 = (y + 0.5 - 64) / 64, v = rev ? -v0 : v0;
    const so = (Math.abs(u) ** p + Math.abs(v) ** p) ** (1 / p);
    if (so > 1) return null;
    const s2 = ((Math.abs(u + c) / (1 + c - thick)) ** p + (Math.abs(v) / (1 - thickV)) ** p) ** (1 / p);
    // the thin second arc inside the first
    const s3 = ((Math.abs(u + c * 1.5) / (0.78 + c * 1.5)) ** p + (Math.abs(v) / 0.7) ** p) ** (1 / p);
    const s4 = ((Math.abs(u + c * 1.5) / (0.74 + c * 1.5)) ** p + (Math.abs(v) / 0.67) ** p) ** (1 / p);
    const phi = Math.atan2(v, u + 0.18) / D;                  // -80 .. 80: where along the sweep this point is
    const behind = head - phi;                                 // how far behind the head
    if (behind < 0) return null;
    const br = Math.max(0, 1 - behind / trail) * g;
    let m = -1;
    if (s2 >= 1) { const a = 1 - so, b = s2 - 1; const q = a / (a + b + 1e-9); m = 1 - Math.abs(2 * q - 1); }
    let echo = 0;
    if (s3 <= 1 && s4 > 1 && (heavy || behind < trail * 0.8)) echo = 0.55;
    if (m < 0 && !echo) return null;
    const lvl = Math.max(m * br, echo * br * 0.9);
    // an afterimage dissolves: pixels drop out in a pattern as the light drains
    if (g < 0.9 && lvl < 0.5 && ((x + y * 2) % 3 === 0 || ((x >> 1) + (y >> 1)) % 2 === 0) && noise(x / 3, y / 3, 3) > g + 0.2) return null;
    if (lvl <= 0.04) return null;
    const col = lvl > 0.78 ? pal.white : lvl > 0.5 ? pal.pale : lvl > 0.26 ? pal.main : lvl > 0.1 ? pal.deep : pal.edge;
    return [...col, 255];
  });
  if (glow) {
    // the soft light round it: the same shape, blurred, kept as light only
    const mask = new Img(S, S);
    for (let i = 0; i < S * S; i++) { const a = img.d[i * 4 + 3]; if (a) { mask.d[i * 4] = pal.glow[0]; mask.d[i * 4 + 1] = pal.glow[1]; mask.d[i * 4 + 2] = pal.glow[2]; mask.d[i * 4 + 3] = 255; } }
    const b = mask.blur(5).blur(4);
    for (let i = 0; i < S * S; i++) b.d[i * 4 + 3] = Math.min(255, b.d[i * 4 + 3] * 1.9);
    return b;
  }
  return img;
}

// the frames of one swing: 3 of the sweep, 4 of the afterimage (the same 7 again as light)
function swingFrames(pal, heavy, rev) {
  const steps = [{ head: -38, g: 1, trail: 70 }, { head: 22, g: 1, trail: 110 }, { head: 95, g: 1, trail: 150 }, { head: 95, g: 0.78, trail: 400 }, { head: 95, g: 0.55, trail: 400 }, { head: 95, g: 0.34, trail: 400 }, { head: 95, g: 0.18, trail: 400 }];
  const main = steps.map((s) => crescent(pal, { ...s, heavy, rev }));
  const glow = steps.map((s) => crescent(pal, { ...s, heavy, rev, glow: true }));
  return [...main, ...glow];
}

export function register(sheet) {
  for (const [name, pal] of [["fx_swing", PALS.cyan], ["fx_eswing", PALS.magenta]]) {
    sheet(name, () => {
      const frames = [];
      const tags = [];
      for (const [label, heavy] of [["swing", false], ["heavy", true]]) for (const [dir, rev] of [["f", false], ["r", true]]) {
        tags.push({ name: `${label}_${dir}`, from: frames.length, to: frames.length + 6 }, { name: `${label}_${dir}_glow`, from: frames.length + 7, to: frames.length + 13 });
        frames.push(...swingFrames(pal, heavy, rev));
      }
      writeSheet(name, frames, { cols: 14, tags, ms: 40 });
    });
  }
}
