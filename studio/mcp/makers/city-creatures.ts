// creature_make's city archetypes: the machines and mutants of a drowned neon city. Each is drawn at its own size (a
// rat-drone is small, a crane's magnet large) and has the states its job needs, besides `idle`: `move` for what moves,
// and the named states of what does not (a turret turns and fires, a pod and a mimic open, a mine arms). Every one has a
// `tell` frame, the moment before it hurts: its outline and its lights flash in the glow colour, so a player learns to
// read it; and a white `hit` frame.
// Same rules as the other makers: light from the top left, the palette's outline, a soft shadow; what glows is light
// (paint.ts `glow`), in the palette's accent 1 unless `glow_color` says otherwise.

import { glow, hex, Img, mix, ramp, shade, SHADOW, type Ramp, type Rgba } from "./paint";
import type { Palette } from "./palettes";
import { vendingMachine } from "./city-tiles";
import { up } from "./tilekit";

const WHITE: Rgba = [255, 255, 255, 255];

export interface CityCtx {
  D: number;
  r: Ramp;
  r2: Ramp;
  P: Palette;
  outline: Rgba;
  acc: Ramp;
  /// What glows (any colour marks a pixel): a thin light, and a lit spot with a ring.
  lit: Img;
  litRing: Img;
}

export interface CityKind {
  what: string;
  size: number;
  colour: string;
  second: string;
  /// The states in sheet order with their frame counts and how long each frame shows; `tell` and `hit` come after them.
  states: [string, number, number][];
  /// Tags that are other names for a state ("closed" is the mimic's idle).
  alias?: Record<string, string>;
  /// One frame. `after` is drawn over the outlined body (see-through things: rotor blur, a hologram).
  draw: (c: CityCtx, body: Img, after: Img, state: string, i: number) => void;
  /// The soft shadow's middle, row and half width, or none.
  shadow?: (c: CityCtx, state: string, i: number) => [number, number, number] | null;
  /// Frames that are whole pictures of their own, not drawn and outlined here (the mimic shut is the vending machine tile).
  whole?: (c: CityCtx, state: string, i: number) => Img | null;
  pivot?: (D: number) => [number, number];
  /// Names for the sheet's frames (a boss part's pieces).
  names?: Record<string, number>;
}

const mark = (m: Img, x: number, y: number) => m.set(Math.round(x), Math.round(y), WHITE);

function blob(img: Img, cx: number, cy: number, rx: number, ry: number, r: Ramp) {
  img.ellipse(cx, cy, rx, ry, (x, y) => {
    const u = (x - cx) / rx, v = (y - cy) / ry;
    const light = -(u * 0.5 + v * 0.75);
    return light > 0.55 ? r[4] : light > 0.15 ? r[3] : light > -0.4 ? r[2] : light > -0.75 ? r[1] : r[0];
  });
}

function thick(img: Img, x0: number, y0: number, x1: number, y1: number, a: Rgba, b: Rgba) {
  img.line(x0, y0, x1, y1, a);
  img.line(x0, y0 + 1, x1, y1 + 1, b);
}

function drone(c: CityCtx, body: Img, after: Img, state: string, i: number, mirror: boolean) {
  const bob = state === "move" ? [0, 1, 0, -1][i]! : state === "idle" ? i : 0;
  const cy = 7 + bob, r = c.r;
  // arms out to four rotors, the rotors a blur that turns from frame to frame
  for (const [rx, ry] of [[2, cy - 3], [13, cy - 3], [2, cy + 2], [13, cy + 2]] as const) {
    body.line(8, cy, rx + (rx < 8 ? 1 : -1), ry, r[1]);
    body.rect(rx, ry, 2, 1, r[0]);
    const t = (i + (rx < 8 ? 0 : 1) + (ry < cy ? 0 : 2)) % 3;
    after.ellipse(rx + 0.5, ry - 1, 2.6, 0.9, [c.r2[4][0], c.r2[4][1], c.r2[4][2], 90]);
    after.line(rx - 2 + t, ry - 1 - (t === 1 ? 0 : 1) + 1, rx + 3 - t, ry - 1, [255, 255, 255, 150]);
  }
  if (mirror) {
    // a mirror-plated shell: facets that show the street's lights back
    body.ellipse(7.5, cy, 4.5, 3.2, (x, y) => {
      const d = x - y - (7.5 - cy);
      return d > 2 ? r[1] : d > 0 ? r[2] : d > -2 ? r[4] : r[3];
    });
    body.line(5, cy - 2, 7, cy - 2, WHITE);
    body.set(10, cy + 1, c.P.accent[1][3]);
    body.set(4, cy + 1, c.P.accent[0][3]);
  } else {
    blob(body, 7.5, cy, 3.6, 2.6, r);
    body.rect(5, cy - 1, 6, 1, r[3]);
  }
  // the camera's eye under the shell
  body.rect(6, cy + 2, 4, 2, mix(c.outline, r[0], 0.4));
  if (state === "tell") for (const dx of [0, 1]) mark(c.litRing, 7 + dx, cy + 3);
  else mark(c.lit, 7 + (state === "move" ? i % 2 : 0), cy + 3);
}

export const CITY_CREATURES: Record<string, CityKind> = {
  rat_drone: {
    what: "a toy car with a saw blade for a nose, seen from the side (flip_x for the other way): fast straight charges", size: 16, colour: "#8e94a4", second: "silver",
    states: [["idle", 2, 400], ["move", 4, 70]],
    draw: (c, body, _a, state, i) => {
      const r = c.r, bob = state === "idle" ? i : state === "move" ? i % 2 : 0, y0 = 8 + bob - (state === "tell" ? 0 : 0);
      // a cable tail, the body, the wheels, the blade and its sensor
      body.line(3, y0 + 2, 1, y0 + (state === "move" ? (i % 2 ? 0 : 3) : 1), r[0]);
      body.ellipse(7, y0, 4.5, 2.5, (x, y) => (y <= y0 ? (x < 6 ? r[4] : r[3]) : undefined));
      body.rect(3, y0, 9, 3, r[2]);
      body.rect(3, y0 + 2, 9, 1, r[1]);
      body.rect(4, y0 + 1, 6, 1, c.r2[1]);
      body.line(5, y0 - 2, 4, y0 - 5 + bob, r[1]);
      body.set(4, y0 - 5 + bob, c.r2[4]);
      for (const wx of [5, 10]) {
        body.ellipse(wx, 12.5, 1.6, 1.6, mix(c.outline, r[0], 0.5));
        const spin = state === "move" ? i : 0;
        body.set(wx + [0, 1, 0, -1][spin]!, 12 + [-1, 0, 1, 0][spin]!, r[3]);
      }
      const bx = 13, by = y0 + 1;
      body.ellipse(bx, by, 2.4, 2.4, (x, y) => {
        const a = Math.atan2(y - by, x - bx) + (state === "move" ? i * 0.8 : 0);
        return Math.hypot(x - bx, y - by) > 1.6 ? (Math.floor(((a + Math.PI) / (Math.PI * 2)) * 8) % 2 ? c.r2[4] : c.r2[2]) : c.r2[1];
      });
      if (state === "tell") for (let a = 0; a < 12; a++) mark(c.lit, bx + Math.cos(a / 1.9) * 2.4, by + Math.sin(a / 1.9) * 2.4);
      mark(c.lit, 11, y0);
    },
    shadow: () => [7.5, 14.5, 6],
  },
  hover_drone: {
    what: "a hovering drone on four rotors, seen from above, its camera eye lit", size: 16, colour: "#596072", second: "#d8e4f0",
    states: [["idle", 2, 300], ["move", 4, 90]],
    draw: (c, body, after, state, i) => drone(c, body, after, state, i, false),
    shadow: () => [8, 15, 4],
  },
  mirror_drone: {
    what: "the hover drone in mirror plate: its shell shows the street's lights back (it reflects shots)", size: 16, colour: "#c8d0dc", second: "#e8f0ff",
    states: [["idle", 2, 300], ["move", 4, 90]],
    draw: (c, body, after, state, i) => drone(c, body, after, state, i, true),
    shadow: () => [8, 15, 4],
  },
  turret: {
    what: "a floor turret seen from above: it turns its barrel and fires (a flash at the muzzle)", size: 24, colour: "#5c6272", second: "#8a92a4",
    states: [["idle", 2, 400], ["turn", 4, 120], ["fire", 2, 80]],
    alias: { move: "turn" },
    draw: (c, body, _a, state, i) => {
      const r = c.r, angle = state === "turn" ? [150, 120, 60, 30][i]! : 90;
      const a = (angle * Math.PI) / 180, kick = state === "fire" && i === 0 ? -2 : 0, len = 9 + kick;
      body.ellipse(12, 18.5, 8.5, 3.5, (x, y) => (y < 18 ? r[2] : y < 21 ? r[1] : r[0]));
      body.ellipse(12, 17.5, 7, 2.5, r[3]);
      const barrel = () => {
        for (let t = 2; t <= len; t++) {
          const x = 12 + Math.cos(a) * t, y = 13 + Math.sin(a) * t * 0.8;
          body.set(x, y, c.r2[3]);
          body.set(x + Math.sin(a), y + 1, c.r2[1]);
        }
      };
      if (angle > 180) barrel();
      blob(body, 11.5, 13, 5.5, 4.5, r);
      body.rect(9, 10, 6, 1, r[4]);
      if (angle <= 180) barrel();
      const mx = 12 + Math.cos(a) * (len + 2), my = 13 + Math.sin(a) * (len + 2) * 0.8;
      if (state === "fire" && i === 0) for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) mark(c.litRing, mx + dx, my + dy);
      if (state === "fire" && i === 1) body.set(mx, my, mix(c.r2[4], WHITE, 0.4));
      if (state === "tell") {
        mark(c.litRing, mx, my);
        mark(c.litRing, 12, 11);
      } else if (!(state === "idle" && i === 1)) mark(c.lit, 12, 11);
    },
    shadow: () => [12, 21.5, 9],
  },
  vending_mimic: {
    what: "a vending machine that is not: shut it is exactly the tileset's vending_machine (same palette); open, it is all teeth", size: 32, colour: "#5c6272", second: "#e8e2d4",
    states: [["idle", 1, 600], ["open", 2, 110]],
    alias: { closed: "idle" },
    whole: (c, state) => (state === "idle" ? new Img(32, 32).draw(vendingMachine({ t: 16, k: 1, P: c.P, seed: 1 }), 8, 0) : null),
    draw: (c, body, after, state, i) => {
      // the machine itself, then a mouth where its window and slot were
      body.draw(vendingMachine({ t: 16, k: 1, P: c.P, seed: 1 }), 8, 0);
      const maw = mix(c.outline, hex("#5a1424"), 0.45), tooth = c.r2;
      if (state === "open") {
        const top = i ? 10 : 12, bottom = i ? 27 : 24;
        body.rect(10, top, 12, bottom - top, maw);
        body.rect(11, bottom - 3, 10, 2, mix(maw, hex("#c04050"), 0.6));
        for (let x = 10; x < 22; x += 2) {
          body.set(x, top, tooth[4]);
          body.set(x + 1, top, tooth[3]);
          body.set(x, top + 1, tooth[2]);
          body.set(x + 1, bottom - 1, tooth[3]);
          body.set(x, bottom - 1, tooth[2]);
          body.set(x + 1, bottom - 2, tooth[2]);
        }
      }
      // its eyes in the lit header: the logo goes dark and two eyes look out
      body.rect(11, 7, 10, 3, mix(c.outline, c.P.mat.plate[0], 0.5));
      for (const x of [13, 18]) {
        mark(state === "tell" ? c.litRing : c.lit, x, 8);
        mark(c.lit, x + 1, 8);
      }
      void after;
    },
    shadow: () => null,
    pivot: () => [16, 31],
  },
  spore_hound: {
    what: "a mutant hound seen from the side, glowing spores on its back: it circles, crouches (the tell) and leaps", size: 24, colour: "#86686a", second: "#c8b0a0",
    states: [["idle", 2, 380], ["move", 4, 90], ["leap", 1, 200]],
    draw: (c, body, _a, state, i) => {
      const r = c.r, crouch = state === "tell" ? 2 : 0, air = state === "leap" ? -3 : 0;
      const by = 14 + crouch + air + (state === "idle" ? i * 0.5 : 0), stretch = state === "leap" ? 1.5 : 0;
      // legs: the far pair darker, stepping in turn
      const step = state === "move" ? i : 0;
      for (const [x, far, ph] of [[7, true, 0], [15, true, 2], [8, false, 2], [16, false, 0]] as const) {
        const swing = state === "move" ? [2, 0, -2, 0][(step + ph) % 4]! : state === "leap" ? (x < 12 ? -3 : 3) : 0;
        const col = far ? r[0] : r[1];
        body.line(x, by + 2, x + swing, 21 + air + (state === "leap" ? -1 : 0), col);
        body.set(x + swing + 1, 21 + air + (state === "leap" ? -1 : 0), col);
      }
      blob(body, 11, by, 6.5 + stretch, 3.6, r);
      body.line(4, by - 1, 1, by - 4 + (state === "move" ? i % 2 : 0), r[1]);
      blob(body, 18 + stretch, by - 3, 3.2, 2.6, r);
      body.rect(20 + stretch, by - 2, 3, 2, r[1]);
      body.set(22 + stretch, by - 2, c.outline);
      body.rect(20 + stretch, by, 3, 1, mix(c.outline, hex("#7a1c2a"), 0.5));
      body.set(17 + stretch, by - 6, r[2]);
      body.set(19 + stretch, by - 3, c.outline);
      // the spores: bulbs on its back, lit
      for (const [x, y] of [[7, -3], [10, -4], [13, -3]] as const) {
        body.ellipse(x, by + y, 1.4, 1.2, c.r2[2]);
        mark(state === "tell" ? c.litRing : c.lit, x, by + y);
      }
    },
    shadow: (_c, state) => [11, 21.5, state === "leap" ? 5 : 8],
  },
  bloom_pod: {
    what: "a rooted pod: shut (it cannot be hurt), then open to fire seeds from a lit core", size: 24, colour: "#4e7a4c", second: "#d8c070",
    states: [["idle", 2, 420], ["open", 2, 140]],
    alias: { closed: "idle" },
    draw: (c, body, _a, state, i) => {
      const r = c.r, L = c.P.mat.leaf;
      for (const [x0, x1] of [[9, 4], [12, 12], [15, 20]] as const) body.line(x0, 18, x1, 21, L[1]);
      body.rect(11, 15, 3, 4, L[2]);
      if (state === "idle") {
        const ry = 6 + i * 0.5;
        blob(body, 12, 11, 5, ry, r);
        for (const x of [10, 14]) body.line(x, 7, x + (x < 12 ? -1 : 1), 15, r[1]);
        body.set(12, 5 - i, r[4]);
      } else {
        const wide = state === "open" && i === 0 ? 0.7 : 1;
        for (let k = 0; k < 5; k++) {
          const a = -Math.PI / 2 + ((k - 2) * Math.PI) / 3.4;
          blob(body, 12 + Math.cos(a) * 6 * wide, 11 + Math.sin(a) * 5 * wide, 3, 2.4, r);
        }
        body.ellipse(12, 11, 3.2, 3, c.r2[1]);
        for (const [x, y] of [[11, 10], [13, 10], [12, 12]] as const) mark(state === "tell" ? c.litRing : c.lit, x, y);
      }
    },
    shadow: () => [12, 21.5, 7],
  },
  graft: {
    what: "two bodies sewn into one: two heads, a seam of stitches down the middle; kill it and the halves come apart", size: 32, colour: "#b08c7c", second: "#5c6a7a",
    states: [["idle", 2, 420], ["move", 4, 130]],
    draw: (c, body, _a, state, i) => {
      const r = c.r, cl = c.r2, bob = state === "move" ? i % 2 : state === "idle" ? i : 0, crouch = state === "tell" ? 1 : 0;
      // legs, the two torsos in rags, the long outer arms, the heads
      for (const [x, ph] of [[9, 0], [13, 2], [18, 1], [22, 3]] as const) {
        const lift = state === "move" && (i + ph) % 4 === 0 ? 2 : 0;
        body.rect(x, 21 + crouch, 3, 7 - lift, cl[x < 16 ? 1 : 2]);
        body.rect(x, 28 - lift, 3, 1, c.outline);
      }
      blob(body, 11, 16 + bob + crouch, 5.5, 6, r);
      blob(body, 21, 15 + crouch, 6, 7, r.map((x) => shade(x, -0.4)) as Ramp);
      body.rect(7, 18 + bob + crouch, 9, 4, cl[2]);
      body.rect(16, 18 + crouch, 10, 4, cl[1]);
      body.line(5, 13 + bob, 3, 24 - (state === "move" ? i % 2 : 0), r[1]);
      body.line(6, 13 + bob, 4, 24, r[2]);
      body.line(27, 12, 29, 23 + (state === "tell" ? -4 : 0), r[1]);
      body.line(26, 12, 28, 23 + (state === "tell" ? -4 : 0), r[2]);
      blob(body, 11, 8 + bob + crouch, 3.4, 3.2, r);
      blob(body, 21, 6 + crouch, 4, 3.6, r.map((x) => shade(x, -0.4)) as Ramp);
      // the seam
      for (let y = 9; y < 24; y += 2) {
        body.set(16, y + crouch, c.outline);
        body.set(15, y + crouch + 1, mix(c.outline, r[0], 0.5));
        body.set(17, y + crouch + 1, mix(c.outline, r[0], 0.5));
      }
      body.set(10, 8 + bob + crouch, c.outline);
      body.set(12, 8 + bob + crouch, c.outline);
      mark(state === "tell" ? c.litRing : c.lit, 20, 6 + crouch);
      body.set(23, 6 + crouch, c.outline);
    },
    shadow: () => [16, 29, 11],
  },
  hologram: {
    what: "a hologram of a person over its projector: scan lines, see-through, tinted in the glow colour (no outline)", size: 32, colour: "#8090a0", second: "#b0b8c8",
    states: [["idle", 2, 260], ["move", 4, 110]],
    draw: (c, body, after, state, i) => {
      const a = c.acc, bob = state === "move" ? [0, -1, -1, 0][i]! : 0, glitch = state === "idle" && i === 1 ? 9 : -1;
      // the projector, lit along its rim
      body.ellipse(16, 28.5, 5, 1.6, c.r[1]);
      body.rect(12, 28, 9, 1, c.r[3]);
      for (let x = 13; x <= 19; x++) mark(c.lit, x, 29);
      // the figure: a person made of light
      const fig = new Img(32, 32), col = state === "tell" ? a[4] : a[3];
      fig.ellipse(16, 7 + bob, 3, 3.2, col);
      fig.rect(12, 11 + bob, 9, 9, col);
      fig.rect(10, 12 + bob, 2, 7, col);
      fig.rect(21, 12 + bob, 2, 7, col);
      fig.rect(13, 20 + bob, 3, 6 - (state === "move" && i % 2 ? 1 : 0), col);
      fig.rect(17, 20 + bob, 3, 6 - (state === "move" && i % 2 ? 0 : 1), col);
      fig.rect(14, 12 + bob, 5, 1, a[4]);
      fig.set(15, 7 + bob, a[1]);
      fig.set(17, 7 + bob, a[1]);
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
        const p = fig.get(x, y);
        if (!p) continue;
        const sx = y === glitch || y === glitch + 1 ? x + 2 : x;
        if (x % 2 === 0 && (y + i) % 2 === 0 && ((x >> 1) + ((y + i) >> 1)) % 2 === 0) continue; // see-through: one pixel in eight left out, evenly
        after.set(sx, y, (y + i) % 3 === 0 ? a[1] : p);
      }
      // a faint cone of light up from the projector
      for (let y = 22; y < 28; y++) for (let x = 11; x < 22; x++) if ((x + y) % 2 === 0 && !after.has(x, y)) after.set(x, y, [a[2][0], a[2][1], a[2][2], 60]);
    },
    shadow: () => null,
  },
  mine: {
    what: "a mine on the floor: it arms and blinks", size: 16, colour: "#4a4e5c", second: "#8a92a4",
    states: [["idle", 2, 500], ["armed", 2, 160]],
    draw: (c, body, _a, state, i) => {
      const r = c.r;
      for (const [x, y] of [[2, 11], [13, 11], [4, 14], [11, 14]] as const) body.line(8, 11, x, y, r[0]);
      body.ellipse(7.5, 10, 5, 3, (x, y) => (y < 9 ? r[3] : y < 11 ? r[2] : r[1]));
      body.ellipse(7.5, 9.5, 2, 1.2, c.r2[1]);
      if (state === "tell") for (const [dx, dy] of [[0, 0], [1, 0]] as const) mark(c.litRing, 7 + dx, 9 + dy);
      else if (state === "armed" && i === 0) mark(c.litRing, 7.5, 9);
      else if (state === "armed") mark(c.lit, 7.5, 9);
    },
    shadow: () => [7.5, 13.5, 6],
  },
  crane_arm: {
    what: "a boss part set: the crane's cab joint (frame \"base\"), an arm girder (\"arm\"), and the magnet on its chain that sways, swings and charges", size: 32, colour: "#c8962c", second: "#4a4e5c",
    states: [["base", 1, 400], ["arm", 1, 400], ["idle", 2, 400], ["move", 4, 120]],
    names: { base: 0, arm: 1, magnet: 2 },
    draw: (c, body, _a, state, i) => {
      const r = c.r, m = c.r2;
      if (state === "base") {
        // a cab joint: a drum of cable in a yellow casing, bolted
        blob(body, 16, 16, 12, 12, r);
        body.ellipse(16, 16, 8, 8, m[1]);
        for (let y = 10; y < 23; y += 2) body.rect(9, y, 14, 1, m[2]);
        body.ellipse(16, 16, 2.5, 2.5, r[4]);
        for (let k = 0; k < 6; k++) body.set(16 + Math.cos(k) * 10.5, 16 + Math.sin(k) * 10.5, m[0]);
        return;
      }
      if (state === "arm") {
        // a lattice girder, lying across the frame so arms join end to end
        body.rect(0, 10, 32, 2, r[3]);
        body.rect(0, 20, 32, 2, r[1]);
        for (let x = 0; x < 32; x += 8) {
          body.line(x, 12, x + 4, 19, r[2]);
          body.line(x + 4, 19, x + 8, 12, r[2]);
        }
        body.rect(0, 10, 32, 1, r[4]);
        return;
      }
      const sway = state === "move" ? [-4, -1, 4, 1][i]! : state === "idle" ? [-1, 1][i]! : 0;
      for (let y = 0; y < 11; y++) body.set(16 + Math.round((sway * y) / 11), y, y % 2 ? m[1] : m[3]);
      const cx = 16 + sway;
      body.ellipse(cx, 18, 11, 6, (x, y) => (y < 15 ? r[3] : y < 17 ? r[2] : y < 20 ? m[2] : m[1]));
      body.rect(cx - 11, 17, 23, 1, r[1]);
      for (let x = cx - 8; x <= cx + 8; x += 3) body.rect(x, 19, 1, 3, m[0]);
      if (state === "tell") for (let k = 0; k < 18; k++) mark(c.lit, cx + Math.cos(k / 2.85) * 12, 18 + Math.sin(k / 2.85) * 7);
    },
    shadow: (_c, state) => (state === "base" || state === "arm" ? null : [16, 29.5, 9]),
  },
};

export const CITY_CREATURE_NAMES = Object.keys(CITY_CREATURES);

/// Every frame of a city archetype, in sheet order: its states, then `tell` (the first state's first pose, lit), then
/// `hit` (that pose all white). Returns the frames at size D (scaled afterwards) and the tags.
export function cityFrames(kind: CityKind, c: CityCtx) {
  const frame = (state: string, i: number, withShadow: boolean): Img => {
    const whole = kind.whole?.(c, state, i);
    if (whole) return whole;
    const img = new Img(c.D, c.D), body = new Img(c.D, c.D), after = new Img(c.D, c.D);
    c.lit = new Img(c.D, c.D);
    c.litRing = new Img(c.D, c.D);
    kind.draw(c, body, after, state, i);
    const sh = withShadow ? kind.shadow?.(c, state, i) : null;
    if (sh) img.ellipse(sh[0], sh[1], sh[2], 1.3, SHADOW);
    img.draw(body.outline(c.outline));
    img.draw(after);
    if (state === "tell") {
      // the tell: the outline itself lights up in the glow colour
      for (let p = 0; p < img.r.data.length; p += 4) {
        const d = img.r.data;
        if (d[p + 3] === 255 && d[p] === c.outline[0] && d[p + 1] === c.outline[1] && d[p + 2] === c.outline[2]) d.set(c.acc[2], p);
      }
    }
    if (!c.litRing.empty()) glow(img, (x, y) => c.litRing.has(x, y), c.acc, { hot: 0.5 });
    if (!c.lit.empty()) glow(img, (x, y) => c.lit.has(x, y) && !c.litRing.has(x, y), c.acc, { ring: false, hot: 0.4 });
    return img;
  };
  const frames: Img[] = [];
  const tags: { name: string; from: number; to: number; loop?: boolean }[] = [];
  const durations: number[] = [];
  for (const [state, count, ms] of kind.states) {
    tags.push({ name: state, from: frames.length, to: frames.length + count - 1, ...(state === "fire" || state === "leap" || state === "open" ? { loop: false } : {}) });
    for (let i = 0; i < count; i++) {
      frames.push(frame(state, i, true));
      durations.push(ms);
    }
  }
  const first = kind.states.find(([s]) => s === "idle")?.[0] ?? kind.states[0]![0];
  for (const [alias, of] of Object.entries(kind.alias ?? {})) {
    const t = tags.find((x) => x.name === of);
    if (t) tags.push({ ...t, name: alias });
  }
  tags.push({ name: "tell", from: frames.length, to: frames.length, loop: false });
  frames.push(frame("tell", 0, true));
  durations.push(240);
  tags.push({ name: "hit", from: frames.length, to: frames.length, loop: false });
  frames.push(frame(first, 0, false).silhouette(WHITE));
  durations.push(120);
  return { frames, tags, durations };
}

export function cityCtx(D: number, P: Palette, r: Ramp, r2: Ramp, acc: Ramp): CityCtx {
  return { D, r, r2, P, outline: P.outline, acc, lit: new Img(D, D), litRing: new Img(D, D) };
}

export { up, ramp };
