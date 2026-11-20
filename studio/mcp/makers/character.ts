// character_make: a top-down character sheet from parts (build, skin, hair, outfit, hat, held item), ready to walk:
// idle, a four-frame walk, a three-frame swing and a hurt frame, each facing down, left, right and up, tagged by name
// ("walk_left") so an entity plays them, with the feet's hitbox and the pivot in the sheet.
//
// The body is 16x24 or 24x32 pixels, drawn in the middle of a larger frame (32x32 or 48x48) so that a swing has room
// all round; the feet are not at the frame's bottom edge, which is why the answer gives the pivot to use.
// The drawing rules are the tileset's: light from the top left, the palette's outline all round, a soft shadow at the feet.

import { colourOf, Img, mix, ramp, shade, SHADOW, type Ramp, type Rgba } from "./paint";
import { lit, paletteOf, type Palette } from "./palettes";
import { writeSheet, type Put } from "./sheet";

type Args = Record<string, any>;

export const SKINS: Record<string, string> = { pale: "#f6d7bd", light: "#f0c29e", tan: "#d9a273", brown: "#a8714a", dark: "#74482f", green: "#8fbf6a", grey: "#b4b8c4", blue: "#8fb0d9" };
export const HAIR_STYLES = ["short", "long", "spiky", "bob", "ponytail", "mohawk", "bald"];
export const OUTFITS = ["tunic", "shirt", "robe", "dress", "armor"];
export const HATS = ["none", "cap", "hood", "helmet", "wizard", "crown", "bandana"];
export const ITEMS = ["sword", "axe", "staff", "spear", "none"];
export const BUILDS = ["normal", "slim", "stout", "small"];
export const CHARACTER_SIZES = ["16x24", "24x32"];
export const DIRECTIONS = ["down", "left", "right", "up"] as const;
type Dir = (typeof DIRECTIONS)[number];

interface Size {
  frame: number;
  cx: number; // the body's middle is between pixel cx - 1 and cx
  feet: number; // the row of the soles
  shoe: number;
  leg: number;
  torso: number;
  head: number;
  headW: number;
  torsoW: number;
  arm: number;
  legW: number;
  big: boolean;
}

function sizeOf(size: string, build: string): Size {
  const big = size === "24x32";
  const s: Size = big
    ? { frame: 48, cx: 24, feet: 41, shoe: 2, leg: 3, torso: 9, head: 12, headW: 14, torsoW: 10, arm: 3, legW: 4, big }
    : { frame: 32, cx: 16, feet: 27, shoe: 1, leg: 2, torso: 6, head: 9, headW: 10, torsoW: 8, arm: 2, legW: 3, big };
  if (build === "slim") s.torsoW -= 2;
  if (build === "stout") s.torsoW += 2;
  if (build === "small") {
    s.torso -= big ? 2 : 1;
    s.leg -= 1;
  }
  return s;
}

interface Look {
  skin: Ramp;
  hair: Ramp;
  main: Ramp;
  trim: Ramp;
  shoes: Ramp;
  metal: Ramp;
  gold: Ramp;
  wood: Ramp;
  gem: Ramp;
  outline: Rgba;
  style: string;
  outfit: string;
  hat: string;
  item: string;
}

interface Pose {
  by: number; // the body's offset, negative is up
  dx: number; // lean
  legs: [number, number]; // front and back views: how far each foot is lifted; side view: [stride, 0]
  arms: [number, number]; // each arm lowered (+) or raised (-)
  eyes: "open" | "shut";
  /// A swing: where the hand is from the body's middle and the top of the torso, the weapon's angle in degrees (0 points
  /// right, 90 down), and the streak it leaves (from angle, to angle).
  swing?: { hx: number; hy: number; angle: number; streak?: [number, number] };
}

const REST: Pose = { by: 0, dx: 0, legs: [0, 0], arms: [0, 0], eyes: "open" };

/// A block of one material lit from the top left.
function block(img: Img, x: number, y: number, w: number, h: number, r: Ramp) {
  if (w <= 0 || h <= 0) return;
  img.rect(x, y, w, h, r[2]);
  if (w >= 4) img.rect(x, y, 1, h, r[3]);
  if (w >= 2) img.rect(x + w - 1, y, 1, h, r[1]);
  if (h >= 3) img.rect(x, y + h - 1, w, 1, r[1]);
}

function drawWeapon(img: Img, L: Look, s: Size, x: number, y: number, angle: number) {
  if (L.item === "none") return;
  const a = (angle * Math.PI) / 180, ux = Math.cos(a), uy = Math.sin(a);
  const len = Math.round((L.item === "staff" || L.item === "spear" ? 11 : 8) * (s.big ? 1.5 : 1));
  const at = (i: number, side = 0): [number, number] => [Math.round(x + ux * i - uy * side), Math.round(y + uy * i + ux * side)];
  for (let i = L.item === "sword" ? 0 : -2; i <= len; i++) {
    let c: Rgba;
    if (L.item === "sword") c = i === 0 ? L.wood[1] : i === 1 ? L.gold[2] : i >= len - 1 ? L.metal[4] : L.metal[3];
    else if (L.item === "spear") c = i >= len - 2 ? L.metal[4] : L.wood[2];
    else c = L.wood[i % 4 === 0 ? 1 : 2];
    img.set(...at(i), c);
    if (s.big && L.item === "sword" && i > 1 && i < len) img.set(...at(i, 1), L.metal[2]);
  }
  if (L.item === "sword") {
    img.set(...at(1, 1), L.gold[1]);
    img.set(...at(1, -1), L.gold[3]);
    if (s.big) {
      img.set(...at(1, 2), L.gold[1]);
      img.set(...at(1, -2), L.gold[3]);
    }
  } else if (L.item === "axe") {
    for (let i = len - 3; i <= len; i++) for (let side = 1; side <= (s.big ? 4 : 3); side++) {
      if ((i === len - 3 || i === len) && side === 1) continue;
      img.set(...at(i, side), side >= (s.big ? 4 : 3) ? L.metal[4] : L.metal[2]);
    }
  } else if (L.item === "staff") {
    for (const [i, side] of [[len, 0], [len + 1, 0], [len, 1], [len + 1, 1], [len, -1], [len + 1, -1]] as const) img.set(...at(i, side), side === -1 ? L.gem[4] : L.gem[2]);
  }
}

/// The streak a swing leaves: an arc about the body that is bright at its leading end.
function drawStreak(img: Img, s: Size, cx: number, cy: number, from: number, to: number) {
  const R = s.big ? 17 : 12, steps = 28;
  for (let i = 0; i <= steps; i++) {
    const f = i / steps, a = ((from + (to - from) * f) * Math.PI) / 180;
    const alpha = Math.round(40 + 190 * f * f);
    for (let w = 0; w < (s.big ? 2 : 1); w++) {
      const x = Math.round(cx + Math.cos(a) * (R - w)), y = Math.round(cy + Math.sin(a) * (R - w) * 0.92);
      if (!img.firm(x, y)) img.set(x, y, [255, 255, 255, alpha]);
    }
  }
}

function frontOrBack(L: Look, s: Size, p: Pose, back: boolean): Img {
  const img = new Img(s.frame, s.frame), body = new Img(s.frame, s.frame);
  const cx = s.cx + p.dx, by = p.by;
  const torsoTop = s.feet - s.shoe - s.leg - s.torso + 1 + by, headTop = torsoTop - s.head;
  const legTop = torsoTop + s.torso;
  const long = L.outfit === "robe" || L.outfit === "dress";
  const swingBehind = p.swing && back;
  const weapon = () => p.swing && drawWeapon(body, L, s, cx + p.swing.hx, torsoTop + p.swing.hy, p.swing.angle);
  if (swingBehind) weapon();

  // legs and shoes: a lifted foot is a shorter leg
  const legRamp = L.outfit === "armor" ? L.metal : long ? L.main : L.trim;
  [0, 1].forEach((i) => {
    const x = i === 0 ? cx - s.legW : cx, lift = p.legs[i]!;
    const bottom = s.feet - s.shoe - lift;
    block(body, x, legTop, s.legW, bottom - legTop + 1, lift ? (legRamp.map((c) => shade(c, -0.6)) as Ramp) : legRamp);
    body.rect(x, bottom + 1, s.legW, s.shoe, L.shoes[lift ? 1 : 2]);
    if (s.big) body.rect(x, bottom + 1, s.legW, 1, L.shoes[3]);
    if (i === 0) body.rect(x + s.legW - 1, legTop, 1, bottom - legTop + 1 + s.shoe, shade(legRamp[1], -0.8)); // the line between the legs
  });
  // the torso
  const tx = cx - s.torsoW / 2;
  const torsoRamp = L.outfit === "armor" ? L.metal : L.main;
  block(body, tx, torsoTop, s.torsoW, s.torso, torsoRamp);
  if (long) {
    // a skirt down to the ankles, a little wider at the hem
    const hem = s.feet - s.shoe - Math.max(...p.legs);
    block(body, tx, legTop, s.torsoW, hem - legTop + 1, L.main);
    body.rect(tx - (L.outfit === "dress" ? 1 : 0), hem, s.torsoW + (L.outfit === "dress" ? 2 : 0), 1, L.trim[2]);
    if (!back) body.rect(cx - 1, torsoTop + 1, s.big ? 2 : 1, hem - torsoTop - 1, L.outfit === "robe" ? L.trim[2] : L.main[3]);
  }
  if (L.outfit === "tunic" || L.outfit === "robe" || L.outfit === "armor") {
    body.rect(tx, legTop - (s.big ? 2 : 1), s.torsoW, s.big ? 2 : 1, L.outfit === "armor" ? L.trim[2] : L.trim[1]);
    if (!back) body.rect(cx - 1, legTop - (s.big ? 2 : 1), 2, s.big ? 2 : 1, L.gold[3]);
  }
  if (L.outfit === "armor") {
    body.rect(tx + 1, torsoTop + 1, s.torsoW - 2, 1, L.metal[4]);
    if (!back) body.rect(cx - 1, torsoTop + 2, 2, s.torso - (s.big ? 5 : 4), L.metal[3]);
  }
  if (L.outfit === "shirt" && !back) body.rect(cx - 1, torsoTop, 2, s.big ? 2 : 1, L.skin[2]);
  // the arms: sleeve, then hand; an arm that swings forward hangs lower
  const sleeve = L.outfit === "dress" ? Math.ceil(s.torso / 3) : s.torso - (s.big ? 3 : 2);
  const armRamp = L.outfit === "armor" ? L.metal : L.main;
  [0, 1].forEach((i) => {
    const swinging = p.swing && i === (back ? 0 : 1);
    const x = i === 0 ? tx - s.arm + 1 : tx + s.torsoW - 1;
    const top = torsoTop + (s.big ? 1 : 0) + p.arms[i]!;
    if (swinging) {
      // the swinging arm reaches from the shoulder to the hand
      const hx = cx + p.swing!.hx, hy = torsoTop + p.swing!.hy;
      for (let w = 0; w < s.arm - 1; w++) body.line(x + (i ? 0 : s.arm - 1), top + 1 + w, hx, hy + w, armRamp[2]);
      body.rect(hx - (s.big ? 1 : 0), hy - (s.big ? 1 : 0), s.big ? 2 : 1, s.big ? 2 : 1, L.skin[2]);
      return;
    }
    block(body, x, top, s.arm, sleeve, armRamp);
    if (L.outfit === "armor") body.rect(x, top, s.arm, s.big ? 2 : 1, L.metal[4]);
    body.rect(x, top + sleeve, s.arm, s.torso - (s.big ? 2 : 1) - sleeve, L.skin[2]);
    body.rect(x + s.arm - 1, top + sleeve, 1, s.torso - (s.big ? 2 : 1) - sleeve, L.skin[1]);
  });
  drawHead(body, L, s, cx, headTop, back ? "back" : "front", p.eyes);
  if (p.swing && !back) weapon();
  finish(img, body, L, s, cx - p.dx);
  if (p.swing?.streak) drawStreak(img, s, cx, torsoTop + s.torso / 2, ...p.swing.streak);
  return img;
}

function side(L: Look, s: Size, p: Pose): Img {
  // facing right; the left view is this mirrored
  const img = new Img(s.frame, s.frame), body = new Img(s.frame, s.frame);
  const cx = s.cx + p.dx, by = p.by;
  const torsoTop = s.feet - s.shoe - s.leg - s.torso + 1 + by, headTop = torsoTop - s.head;
  const legTop = torsoTop + s.torso;
  const long = L.outfit === "robe" || L.outfit === "dress";
  const depth = Math.max(4, s.torsoW - (s.big ? 4 : 3)); // seen from the side the body is thinner
  const tx = cx - Math.floor(depth / 2);
  const stride = p.legs[0];
  const legRamp = L.outfit === "armor" ? L.metal : long ? L.main : L.trim;
  // the far leg first, darker; in a stride the legs part, and the foot behind is lifted
  const reach = s.big ? 3 : 2;
  for (const [far, off] of [[true, -stride * reach], [false, stride * reach]] as const) {
    const x = cx - Math.floor(s.legW / 2) + off;
    const lift = stride !== 0 && off < 0 ? 1 : 0;
    const bottom = s.feet - s.shoe - lift;
    const r = far ? (legRamp.map((c) => shade(c, -0.8)) as Ramp) : legRamp;
    block(body, x, legTop, s.legW, bottom - legTop + 1, r);
    body.rect(x, bottom + 1, s.legW + 1, s.shoe, L.shoes[far ? 1 : 2]);
  }
  const torsoRamp = L.outfit === "armor" ? L.metal : L.main;
  block(body, tx, torsoTop, depth, s.torso, torsoRamp);
  if (long) {
    const hem = s.feet - s.shoe;
    block(body, tx - (stride ? 1 : 0), legTop, depth + (stride ? 2 : 0), hem - legTop + 1, L.main);
    body.rect(tx - (stride ? 1 : 0) - (L.outfit === "dress" ? 1 : 0), hem, depth + (stride ? 2 : 0) + (L.outfit === "dress" ? 1 : 0), 1, L.trim[2]);
  }
  if (L.outfit === "tunic" || L.outfit === "robe" || L.outfit === "armor") body.rect(tx, legTop - (s.big ? 2 : 1), depth, s.big ? 2 : 1, L.outfit === "armor" ? L.trim[2] : L.trim[1]);
  if (L.outfit === "armor") body.rect(tx + 1, torsoTop + 1, depth - 2, 1, L.metal[4]);
  drawHead(body, L, s, cx, headTop, "side", p.eyes);
  // the near arm swings against the legs; in a swing it reaches for the hand
  const armRamp = L.outfit === "armor" ? L.metal : L.main;
  const sleeve = L.outfit === "dress" ? Math.ceil(s.torso / 3) : s.torso - (s.big ? 3 : 2);
  const top = torsoTop + (s.big ? 1 : 0), ax = cx - Math.floor(s.arm / 2);
  if (p.swing) {
    const hx = cx + p.swing.hx, hy = torsoTop + p.swing.hy;
    for (let w = 0; w < s.arm; w++) body.line(ax + w, top + 1, hx, hy + (w ? 1 : 0), armRamp[w ? 1 : 2]);
    body.rect(hx - (s.big ? 1 : 0), hy - (s.big ? 1 : 0), s.big ? 2 : 1, s.big ? 2 : 1, L.skin[2]);
    drawWeapon(body, L, s, hx, hy, p.swing.angle);
  } else {
    const len = s.torso - (s.big ? 2 : 1);
    for (let i = 0; i < len; i++) {
      const x = ax + Math.round((-stride * (s.big ? 3 : 2) * i) / len);
      const r = i < sleeve ? armRamp : L.skin;
      body.rect(x, top + i, s.arm, 1, r[2]);
      body.set(x + s.arm - 1, top + i, r[1]);
      if (i < sleeve) body.set(x - 1, top + i, shade(torsoRamp[1], -0.6)); // a line where the arm lies on the body
    }
  }
  finish(img, body, L, s, cx - p.dx);
  if (p.swing?.streak) drawStreak(img, s, cx, torsoTop + s.torso / 2, ...p.swing.streak);
  return img;
}

function drawHead(body: Img, L: Look, s: Size, cx: number, top: number, view: "front" | "back" | "side", eyes: "open" | "shut") {
  const w = view === "side" ? s.headW - (s.big ? 2 : 1) : s.headW, h = s.head;
  const x = cx - Math.floor(w / 2) - (view === "side" ? 1 : 0);
  const cut = s.big ? 2 : 1;
  const inHead = (px: number, py: number) => {
    const ix = px - x, iy = py - top;
    if (ix < 0 || iy < 0 || ix >= w || iy >= h) return false;
    const ex = Math.min(ix, w - 1 - ix), ey = Math.min(iy, h - 1 - iy);
    return ex + ey >= cut;
  };
  const skin = L.skin;
  for (let py = top; py < top + h; py++) for (let px = x; px < x + w; px++) {
    if (!inHead(px, py)) continue;
    body.set(px, py, px >= x + w - (s.big ? 2 : 1) || py === top + h - 1 ? skin[1] : px === x && view !== "back" ? skin[3] : skin[2]);
  }
  const hair = L.hair, bald = L.style === "bald";
  const fringe = Math.round(h * 0.34); // how far down the forehead the hair comes
  const paintHair = (px: number, py: number, lightAt = 0) => {
    const ix = px - x, iy = py - top;
    body.set(px, py, ix >= w - (s.big ? 3 : 2) ? hair[1] : iy === 1 + lightAt && ix > 1 && ix < w * 0.55 ? hair[4] : iy <= 1 + lightAt && ix < w * 0.6 ? hair[3] : hair[2]);
  };
  if (!bald) {
    for (let py = top; py < top + h; py++) for (let px = x; px < x + w; px++) {
      if (!inHead(px, py)) continue;
      const ix = px - x, iy = py - top;
      let on: boolean;
      if (view === "back") on = L.style === "mohawk" ? Math.abs(ix - (w - 1) / 2) < (s.big ? 2 : 1.5) : iy < h - (L.style === "short" || L.style === "spiky" ? cut + 1 : 0);
      else if (view === "side") {
        // the face looks right: hair on top and down the back of the head
        const backHair = L.style === "mohawk" ? false : ix < w * (L.style === "short" || L.style === "spiky" ? 0.34 : 0.45);
        on = L.style === "mohawk" ? iy < fringe - 1 && ix > 0 && ix < w - 1 : iy < fringe || (backHair && iy < h - (L.style === "long" || L.style === "bob" || L.style === "ponytail" ? 0 : cut + 1));
      } else {
        const sideLock = L.style === "long" || L.style === "bob" ? ix < (s.big ? 2 : 1) || ix >= w - (s.big ? 2 : 1) : (ix === 0 || ix === w - 1) && iy < fringe + (s.big ? 3 : 2);
        on = L.style === "mohawk" ? Math.abs(ix - (w - 1) / 2) < (s.big ? 2 : 1.5) && iy < fringe : iy < fringe || sideLock;
      }
      if (on) paintHair(px, py);
    }
    // what stands out beyond the head
    if (L.style === "spiky" || L.style === "mohawk") {
      for (let px = x + 1; px < x + w - 1; px++) {
        const centre = Math.abs(px - x - (w - 1) / 2) < (s.big ? 2 : 1.5);
        if (L.style === "mohawk" ? centre || view === "side" : (px - x) % (s.big ? 3 : 2) === 0) {
          body.set(px, top - 1, hair[3]);
          if (s.big || L.style === "mohawk") body.set(px, top - 2, hair[2]);
        }
      }
    }
    if (L.style === "long") {
      const drop = s.big ? 5 : 3;
      if (view === "side") block(body, x, top + h - 1, s.big ? 4 : 3, drop, hair);
      else {
        for (const sx of view === "back" ? [x + 1] : [x, x + w - (s.big ? 2 : 1)]) block(body, sx, top + h - 1, view === "back" ? w - 2 : s.big ? 2 : 1, view === "back" ? drop : drop - 1, hair);
      }
    }
    if (L.style === "ponytail") {
      const len = s.big ? 6 : 4;
      if (view === "side") for (let i = 0; i < len; i++) body.rect(x - 1 - Math.min(i, 1), top + Math.floor(h / 2) - 1 + i, s.big ? 3 : 2, 1, hair[i > len - 2 ? 1 : 2]);
      else if (view === "back") block(body, cx - 1, top + h - 2, s.big ? 3 : 2, len, hair);
      else body.rect(x + w - 1, top + fringe, s.big ? 2 : 1, len, hair[1]);
    }
  }
  // the face
  if (view !== "back") {
    const ey = top + Math.round(h * 0.52), eh = s.big ? 3 : 2, ew = s.big ? 2 : 1;
    const xs = view === "side" ? [x + w - (s.big ? 4 : 3)] : [x + (s.big ? 3 : 2), x + w - (s.big ? 3 : 2) - ew];
    for (const ex of xs) {
      if (eyes === "shut") body.rect(ex - (s.big ? 0 : 0), ey + 1, ew + (s.big ? 1 : 0), 1, L.outline);
      else {
        body.rect(ex, ey, ew, eh, L.outline);
        if (s.big) body.set(ex, ey, [255, 255, 255, 255]);
      }
    }
    if (s.big && view === "front") {
      body.set(x + 2, ey + 3, mix(skin[2], [235, 120, 120, 255], 0.45));
      body.set(x + w - 3, ey + 3, mix(skin[2], [235, 120, 120, 255], 0.45));
      body.rect(cx - 1, top + h - 3, 2, 1, eyes === "shut" ? L.outline : skin[0]);
    }
    if (eyes === "shut" && !s.big && view === "front") body.set(cx - 1, top + h - 2, skin[0]);
  }
  drawHat(body, L, s, x, top, w, h, view);
}

function drawHat(body: Img, L: Look, s: Size, x: number, top: number, w: number, h: number, view: "front" | "back" | "side") {
  const u = s.big ? 2 : 1;
  const cx = x + Math.floor(w / 2);
  if (L.hat === "cap") {
    block(body, x, top - 1, w, 2 * u + 1, L.trim);
    body.rect(x + 1, top - 1 - u, w - 2, u, L.trim[3]);
    // the peak: towards us, away from us, or forward
    if (view === "front") body.rect(x - 1, top + 2 * u, w + 2, u, L.trim[1]);
    else if (view === "side") body.rect(x + w - 2, top + 2 * u, 2 + 2 * u, u, L.trim[1]);
  } else if (L.hat === "hood") {
    const r = L.main;
    for (let py = top - 1; py < top + h; py++) for (let px = x - 1; px <= x + w; px++) {
      const ix = px - x, iy = py - top;
      const face = view === "front" ? ix >= 2 * u - 1 && ix <= w - 2 * u && iy >= Math.round(h * 0.3) && iy < h - 1 : view === "side" ? ix >= w * 0.45 && iy >= Math.round(h * 0.3) && iy < h - 1 : false;
      if (face) continue;
      if ((ix < 0 || ix >= w) && (iy < 1 || iy >= h - 1)) continue;
      body.set(px, py, ix >= w - u ? r[1] : iy <= 0 || ix < u ? r[3] : r[2]);
    }
    if (view === "front") body.rect(x + 2 * u - 1, top + Math.round(h * 0.3), w - 4 * u + 2, 1, r[0]);
  } else if (L.hat === "helmet") {
    const r = L.metal;
    const depth = Math.round(h * 0.45);
    for (let py = top - 1; py < top + depth; py++) for (let px = x; px < x + w; px++) {
      const ix = px - x, iy = py - top;
      if (iy < 0 && (ix < 1 || ix >= w - 1)) continue;
      body.set(px, py, ix >= w - u - 1 ? r[1] : iy <= 0 ? r[4] : ix < 2 * u ? r[3] : r[2]);
    }
    body.rect(x, top + depth - 1, w, 1, r[0]);
    if (view === "front") body.rect(cx - (s.big ? 1 : 0), top + depth, u, 2 * u, r[2]); // a nose guard
    if (view !== "back") body.set(view === "side" ? x + w - 2 : cx, top - 2, L.main[2]);
    body.rect(cx - 1, top - 2, 2, 1, L.main[3]); // a plume
  } else if (L.hat === "wizard") {
    const r = L.main;
    const tall = s.big ? 9 : 6;
    for (let i = 0; i < tall; i++) {
      const half = Math.max(1, Math.round(((i + 1) / tall) * (w / 2 - 1)));
      const lean = view === "back" ? 0 : Math.round((1 - i / tall) * u);
      for (let px = cx - half + lean; px < cx + half + lean; px++) body.set(px, top + 2 * u - tall + i, px >= cx + half + lean - u ? r[1] : px === cx - half + lean ? r[3] : r[2]);
    }
    body.rect(x - 1 - u, top + 2 * u, w + 2 + 2 * u, u, r[1]);
    body.rect(x - u, top + 2 * u - 1, w + 2 * u, 1, L.gold[3]);
  } else if (L.hat === "crown") {
    const r = L.gold;
    body.rect(x + 1, top - 1, w - 2, 2 * u, r[2]);
    body.rect(x + 1, top - 1 + 2 * u - 1, w - 2, 1, r[1]);
    for (let px = x + 1; px < x + w - 1; px += 2 * u) body.rect(px, top - 1 - u, u, u, r[3]);
    if (view !== "back") body.set(cx, top, L.gem[3]);
  } else if (L.hat === "bandana") {
    const r = L.main;
    body.rect(x, top + u, w, u + 1, r[2]);
    body.rect(x, top + u, w, 1, r[3]);
    if (view === "back") body.rect(cx - 1, top + 2 * u + 1, 2, 2 * u, r[1]);
    if (view === "side") body.rect(x - 2, top + 2 * u, 2, 2 * u, r[1]);
  }
}

function finish(img: Img, body: Img, L: Look, s: Size, cx: number) {
  img.ellipse(cx - 0.5, s.feet + 0.5, s.big ? 8 : 5.5, s.big ? 2.2 : 1.6, SHADOW);
  img.draw(body.outline(L.outline));
}

/// The frames of one direction, in the order of the sheet: idle 2, walk 4, attack 3, hurt 1.
function framesOf(L: Look, s: Size, dir: Dir): Img[] {
  const u = s.big ? 1.5 : 1;
  const r = (n: number) => Math.round(n * u);
  if (dir === "left" || dir === "right") {
    const poses: Pose[] = [
      REST,
      { ...REST, by: 1 },
      { ...REST, legs: [1, 0] },
      { ...REST, by: -1 },
      { ...REST, legs: [-1, 0] },
      { ...REST, by: -1 },
      { ...REST, dx: -1, swing: { hx: r(-3), hy: r(-2), angle: -120 } },
      { ...REST, dx: 1, legs: [1, 0], swing: { hx: r(4), hy: r(1), angle: -15, streak: [-110, -5] } },
      { ...REST, dx: 1, legs: [1, 0], swing: { hx: r(4), hy: r(3), angle: 55, streak: [-20, 60] } },
      { ...REST, dx: -1, by: -1, eyes: "shut", legs: [-1, 0] },
    ];
    // (the body bobs by lengthening the legs, so the feet stay on the ground)
    return poses.map((p) => {
      const f = side(L, bobbed(s, p), { ...p, by: 0 });
      return dir === "left" ? f.flipX() : f;
    });
  }
  const back = dir === "up";
  const m = back ? -1 : 1; // seen from behind the swing runs the other way round
  const poses: Pose[] = [
    REST,
    { ...REST, by: 1 },
    { ...REST, legs: [0, 1], arms: [1, -1] },
    { ...REST, by: -1 },
    { ...REST, legs: [1, 0], arms: [-1, 1] },
    { ...REST, by: -1 },
    back ? { ...REST, swing: { hx: r(-6), hy: r(1), angle: 200 } } : { ...REST, swing: { hx: r(6), hy: r(1), angle: -40 } },
    back ? { ...REST, by: -1, swing: { hx: r(-2), hy: r(-2), angle: 265, streak: [205, 290] } } : { ...REST, by: 1, swing: { hx: r(3), hy: r(5), angle: 75, streak: [-20, 95] } },
    back ? { ...REST, by: -1, swing: { hx: r(5), hy: r(0), angle: 330, streak: [270, 345] } } : { ...REST, by: 1, swing: { hx: r(-3), hy: r(5), angle: 140, streak: [70, 160] } },
    { ...REST, by: -1, eyes: "shut", arms: [-1, -1], legs: [1, 0], dx: m },
  ];
  return poses.map((p) => frontOrBack(L, bobbed(s, p), { ...p, by: 0 }, back));
}

/// A pose's bob as a longer or shorter leg (the feet stay where they are; the body moves).
const bobbed = (s: Size, p: Pose): Size => ({ ...s, leg: Math.max(1, s.leg - p.by) });

const PER_DIRECTION = 10;

/// `character_make`: see the tool's description in makers/index.ts.
export function makeCharacter(name: string, a: Args, put: Put): { text: string; picture: import("./paint").Raster } {
  const size = a.size === undefined ? "16x24" : String(a.size).toLowerCase().replace(/\s/g, "");
  if (!CHARACTER_SIZES.includes(size)) throw new Error(`"size" is the body's size: ${CHARACTER_SIZES.map((s) => `"${s}"`).join(" or ")} (the first is drawn in 32x32 frames, the second in 48x48, so a swing has room)`);
  const one = (v: unknown, all: string[], what: string, fallback: string): string => {
    const s = v === undefined || v === null ? fallback : String(v).trim().toLowerCase();
    if (!all.includes(s)) throw new Error(`"${what}" is one of ${all.join(", ")} (got '${v}')`);
    return s;
  };
  const P: Palette = paletteOf(a.palette);
  const build = one(a.build, BUILDS, "build", "normal");
  const s = sizeOf(size, build);
  const tone = (c: Rgba) => lit(P, c);
  const skinText = String(a.skin ?? "light").trim().toLowerCase();
  const outfit = one(a.outfit, OUTFITS, "outfit", "tunic");
  const L: Look = {
    skin: ramp(tone(colourOf(SKINS[skinText] ?? a.skin, `"skin" (${Object.keys(SKINS).join(", ")}, or a colour)`))),
    hair: ramp(tone(colourOf(a.hair_color ?? a.hair_colour, '"hair_color"', "brown"))),
    main: ramp(tone(colourOf(a.outfit_color ?? a.outfit_colour, '"outfit_color"', outfit === "armor" ? "red" : "green"))),
    trim: ramp(tone(colourOf(a.trim_color ?? a.trim_colour, '"trim_color"', "brown"))),
    shoes: ramp(tone(colourOf(a.shoe_color ?? a.shoe_colour, '"shoe_color"', "#5a3d2b"))),
    metal: P.mat.metal.map(tone) as Ramp,
    gold: P.mat.gold.map(tone) as Ramp,
    wood: P.mat.trunk.map(tone) as Ramp,
    gem: P.mat.flower.map(tone) as Ramp,
    outline: P.outline,
    style: one(a.hair, HAIR_STYLES, "hair", "short"),
    outfit,
    hat: one(a.hat, HATS, "hat", "none"),
    item: one(a.item, ITEMS, "item", "sword"),
  };
  const frames: Img[] = [];
  const tags: NonNullable<Parameters<typeof writeSheet>[1]["tags"]> = [];
  const durations: number[] = [];
  DIRECTIONS.forEach((dir, d) => {
    frames.push(...framesOf(L, s, dir));
    const base = d * PER_DIRECTION;
    tags.push({ name: `idle_${dir}`, from: base, to: base + 1 }, { name: `walk_${dir}`, from: base + 2, to: base + 5 }, { name: `attack_${dir}`, from: base + 6, to: base + 8, loop: false }, { name: `hurt_${dir}`, from: base + 9, to: base + 9, loop: false });
    durations.push(480, 480, 120, 120, 120, 120, 70, 60, 130, 260);
  });
  const boxW = s.torsoW, boxH = s.big ? 7 : 5;
  const hitbox = { x: s.cx - boxW / 2, y: s.feet - boxH + 1, w: boxW, h: boxH };
  const pivot = { x: s.cx, y: s.feet + 1 };
  const made = writeSheet(name, { frames, tags, durations, hitbox, pivot }, put);
  const py = Math.round((pivot.y / s.frame) * 1000) / 1000;
  return {
    text: [
      made.text,
      `a ${size} body in ${s.frame}x${s.frame} frames (the room around it is for the swing): ${build} build, ${skinText} skin, ${L.style} ${a.hair_color ?? "brown"} hair, ${L.outfit}, hat ${L.hat}, item ${L.item}; palette "${P.name}"`,
      `animations, each facing down, left, right and up: idle_<dir> (2 frames), walk_<dir> (4), attack_<dir> (3, plays once: on_animation_end("attack_down") runs after it), hurt_<dir> (1)`,
      `In its entity: sprite = "${name}", anim = "idle_down", pivot = { 0.5, ${py} }, hitbox = { ${-boxW / 2}, ${-boxH}, ${boxW}, ${boxH} }, sx = 3, sy = 3; then self:play("walk_" .. dir). The pivot is the feet (the frame has room below them); the hitbox is the feet's, so the head can overlap a wall behind. The same pivot and hitbox are in the .sprite.json.`,
      `Change a frame afterwards with sprite_preview { "name": "${name}", "frame": n } and sprite_write { "at": n }.`,
    ].join("\n"),
    picture: made.picture,
  };
}
