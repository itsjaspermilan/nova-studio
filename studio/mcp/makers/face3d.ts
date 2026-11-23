// An animal person's face, painted flat on the head (as a cozy village game paints its villagers): big oval eyes with a glint, small
// brows, a nose and a mouth, in a few drawings each. The eyes, the brows and the mouth are each a set of decals of which the game
// shows one (parts = { eye_wide = { visible = true }, eye_open = { visible = false } }); an expression is one of each. The patches
// of the species (a fox's white cheeks, a rabbit's blush, a badger's stripes) and the nose do not change. All of it is drawn in
// metres in the head's front view (decal3d.ts) from the layout below.

import { rgbOf, sd, type Ink, type Rgb } from "./decal3d";

/// The sets, each drawing named for what it shows. The first of each set is the one the model shows at rest.
export const FACE_SETS = {
  eyes: ["eye_open", "eye_happy", "eye_wide", "eye_half", "eye_shut"],
  brows: ["brow_flat", "brow_frown", "brow_up", "brow_sad"],
  mouth: ["mouth_closed", "mouth_smile", "mouth_open", "mouth_grin", "mouth_frown", "mouth_o"],
} as const;

/// The expressions, as the drawing of each set they show (eyes, brows, mouth). The game also blinks (eye_shut) and talks (TALK).
export const EXPRESSIONS: Record<string, [string, string, string]> = {
  neutral: ["eye_open", "brow_flat", "mouth_closed"],
  smile: ["eye_open", "brow_flat", "mouth_smile"],
  happy: ["eye_happy", "brow_up", "mouth_smile"],
  delighted: ["eye_happy", "brow_up", "mouth_grin"],
  gruff: ["eye_half", "brow_frown", "mouth_frown"],
  dry: ["eye_half", "brow_flat", "mouth_closed"],
  sad: ["eye_open", "brow_sad", "mouth_frown"],
  surprised: ["eye_wide", "brow_up", "mouth_o"],
  indignant: ["eye_open", "brow_frown", "mouth_open"],
};

/// While a line is said the mouth goes back and forth between the expression's own and this one.
export const TALK: Record<string, string> = {
  mouth_closed: "mouth_open", mouth_smile: "mouth_grin", mouth_open: "mouth_closed", mouth_grin: "mouth_smile", mouth_frown: "mouth_open", mouth_o: "mouth_closed",
};

export interface FaceLayout {
  /// eyes: middle x (each side), y, half width and half height
  ex: number; ey: number; ew: number; eh: number;
  /// brows: y and half length; nose y; mouth y and half width
  by: number; bw: number; ny: number; my: number; mw: number;
  /// the boxes the sets are painted in (x0, x1, y0, y1), and the static paint's
  boxes: { eyes: [number, number, number, number]; brows: [number, number, number, number]; mouth: [number, number, number, number]; paint: [number, number, number, number] };
}

/// Where the face goes on a head of half sizes RX (across), RY (up) about the middle at y = c.
export function faceLayout(species: string, RX: number, RY: number, c: number): FaceLayout {
  // (big, a little like a cartoon's but not huge: taller ovals than they are wide, set a touch higher and further apart so they stay
  // clear of a snout or a muzzle; the brows ride above them)
  const ex = 0.42 * RX, ey = c - 0.04 * RY, ew = 0.108 * RX, eh = 0.2 * RY;
  // (a badger's eyes have a light rim round them in its stripes: its brows sit higher still)
  const rim = species === "badger";
  const by = ey + (rim ? 0.48 : 0.42) * RY, bw = 0.11 * RX;
  const ny = c + ({ fox: -0.27, badger: -0.27, bear: -0.21, rabbit: -0.27, cat: -0.27 } as Record<string, number>)[species]! * RY;
  const my = c + ({ fox: -0.47, badger: -0.47, bear: -0.43, rabbit: -0.43, cat: -0.43 } as Record<string, number>)[species]! * RY;
  const mw = 0.156 * RX;
  const side = ex + ew * 2.2;
  return {
    ex, ey, ew, eh, by, bw, ny, my, mw,
    boxes: {
      eyes: [-side, side, ey - eh * 1.6, ey + eh * (rim ? 1.55 : 1.3)],
      brows: [-side, side, ey + eh * (rim ? 1.55 : 1.3), by + 0.22 * RY],
      mouth: [-mw * 2.4, mw * 2.4, my - 0.24 * RY, ny - 0.04 * RY],
      paint: [-0.86 * RX, 0.86 * RX, c - 0.92 * RY, c + 0.75 * RY],
    },
  };
}

export interface FaceColours { ink: string; brow: string; fur: string; fur2: string; dark: string; mouth: string; tongue: string; blush: string; nose: string }

const P = (x: number, y: number): [number, number] => [x, y];

/// The inks of one drawing of a set.
export function faceInks(name: string, L: FaceLayout, k: FaceColours, species: string): Ink[] {
  const ink = rgbOf(k.ink), white: Rgb = [255, 255, 255];
  const { ex, ey, ew, eh, by, bw, my, mw } = L;
  const out: Ink[] = [];
  const both = (f: (s: number) => void) => { f(-1); f(1); };
  // (a badger's eyes sit in dark stripes: a light rim lets them be seen)
  const rim = species === "badger";
  if (name.startsWith("eye_")) {
    both((s) => {
      const cx = s * ex;
      if (name === "eye_open" || name === "eye_wide") {
        const k2 = name === "eye_wide" ? 1.22 : 1;
        if (rim) out.push({ color: rgbOf(k.fur2), d: sd.ellipse(cx, ey, ew * k2 * 1.35, eh * k2 * 1.25) });
        out.push({ color: ink, d: sd.ellipse(cx, ey, ew * k2, eh * k2) });
        // a glint up and to the viewer's right, and a little one low on the other side
        out.push({ color: white, d: sd.ellipse(cx - ew * 0.28 * k2, ey + eh * 0.36 * k2, ew * 0.42 * k2, eh * 0.3 * k2) });
        out.push({ color: white, d: sd.circle(cx + ew * 0.36 * k2, ey - eh * 0.44 * k2, ew * (name === "eye_wide" ? 0.25 : 0.2)) });
      } else if (name === "eye_happy") {
        // closed upward arcs (^ ^)
        out.push({ color: ink, d: sd.stroke(sd.curve(P(cx - ew * 1.1, ey - eh * 0.25), P(cx, ey + eh * 1.05), P(cx + ew * 1.1, ey - eh * 0.25)), ew * 0.28) });
      } else if (name === "eye_shut") {
        // a blink: a lid line, curving down
        out.push({ color: ink, d: sd.stroke(sd.curve(P(cx - ew * 1.1, ey + eh * 0.05), P(cx, ey - eh * 0.6), P(cx + ew * 1.1, ey + eh * 0.05)), ew * 0.24) });
      } else if (name === "eye_half") {
        // half shut, the lid sloping down to the inside: a dry, gruff look
        const lid = (x: number, y: number) => {
          // the lid's line: from the outer end high to the inner end lower (s * x grows outward)
          const t = (s * (x - cx)) / ew;
          return y - (ey + eh * (0.08 + 0.14 * t));
        };
        if (rim) out.push({ color: rgbOf(k.fur2), d: sd.ellipse(cx, ey, ew * 1.35, eh * 1.25) });
        out.push({ color: ink, d: sd.both(sd.ellipse(cx, ey, ew, eh), lid) });
        out.push({ color: ink, d: sd.stroke([P(cx - s * ew * 1.15, ey + eh * (0.08 - 0.14 * 1.15)), P(cx + s * ew * 1.15, ey + eh * (0.08 + 0.14 * 1.15))], ew * 0.2) });
        out.push({ color: white, d: sd.circle(cx - ew * 0.32, ey - eh * 0.25, ew * 0.22) });
      }
    });
  } else if (name.startsWith("brow_")) {
    const browC = rgbOf(k.brow);
    both((s) => {
      const cx = s * ex;
      // each brow is a short soft stroke; `inner` lifts its inner end, `lift` the whole brow, `arch` bows it
      const brow = (lift: number, inner: number, arch: number) => {
        const y = by + lift;
        const a = P(cx - s * bw, y + inner), b = P(cx + s * bw, y - inner * 0.2);
        const mid = P((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + arch);
        out.push({ color: browC, d: sd.stroke(sd.curve(a, mid, b), bw * 0.24, bw * 0.3) });
      };
      if (name === "brow_flat") brow(0, 0, bw * 0.2);
      // (its inner end comes down towards the eye, no further than the brows' own patch: it was cut off there before)
      else if (name === "brow_frown") brow(-eh * 0.25, -bw * 0.42, 0);
      else if (name === "brow_up") brow(eh * 0.35, bw * 0.12, bw * 0.35);
      else if (name === "brow_sad") brow(eh * 0.1, bw * 0.5, -bw * 0.05);
    });
  } else if (name.startsWith("mouth_")) {
    const line = rgbOf(k.ink), hole = rgbOf(k.mouth), tongue = rgbOf(k.tongue);
    const t = mw * 0.19;
    if (name === "mouth_closed") {
      if (species === "rabbit" || species === "cat") {
        // a small "w" under the nose
        out.push({ color: line, d: sd.stroke([...sd.curve(P(-mw * 0.95, my + mw * 0.15), P(-mw * 0.5, my - mw * 0.55), P(0, my + mw * 0.05), 8), ...sd.curve(P(0, my + mw * 0.05), P(mw * 0.5, my - mw * 0.55), P(mw * 0.95, my + mw * 0.15), 8)], t) });
      } else out.push({ color: line, d: sd.stroke(sd.curve(P(-mw * 0.75, my + mw * 0.1), P(0, my - mw * 0.22), P(mw * 0.75, my + mw * 0.1)), t) });
    } else if (name === "mouth_smile") {
      out.push({ color: line, d: sd.stroke(sd.curve(P(-mw * 1.05, my + mw * 0.35), P(0, my - mw * 0.75), P(mw * 1.05, my + mw * 0.35)), t) });
    } else if (name === "mouth_frown") {
      out.push({ color: line, d: sd.stroke(sd.curve(P(-mw * 0.8, my - mw * 0.3), P(0, my + mw * 0.35), P(mw * 0.8, my - mw * 0.3)), t) });
    } else if (name === "mouth_o") {
      out.push({ color: hole, d: sd.ellipse(0, my - mw * 0.1, mw * 0.42, mw * 0.55) });
      out.push({ color: tongue, d: sd.both(sd.ellipse(0, my - mw * 0.1, mw * 0.42, mw * 0.55), sd.ellipse(0, my - mw * 0.62, mw * 0.36, mw * 0.3)) });
    } else {
      // open: a flat top and a round bottom (a D on its side), a tongue in it; grin is the wide one
      const w = name === "mouth_grin" ? mw * 1.15 : mw * 0.72, h = name === "mouth_grin" ? mw * 0.95 : mw * 0.8;
      const top = my + mw * 0.2;
      const shape = sd.shape([P(-w, top), ...sd.curve(P(-w, top), P(0, top - h * 2.05), P(w, top), 16).slice(1, -1), P(w, top)]);
      const soft = (x: number, y: number) => shape(x, y) - t * 0.25;
      out.push({ color: hole, d: soft });
      out.push({ color: tongue, d: sd.both(soft, sd.ellipse(0, top - h * 0.95, w * 0.62, h * 0.38)) });
    }
  }
  return out;
}

/// The paint that does not change: the nose, the species' patches, blush.
export function staticInks(species: string, L: FaceLayout, k: FaceColours, RX: number, RY: number, c: number): Ink[] {
  const out: Ink[] = [];
  const { ex, ey, ew, eh, ny } = L;
  if (species === "fox") {
    // white cheeks from under the eyes down to the jaw, with a point up the side of the snout
    // (and all the way under the chin, where the head's own light fur takes over out of sight)
    const cheeks = sd.union(sd.ellipse(0, c - 0.58 * RY, 0.8 * RX, 0.44 * RY), sd.ellipse(0, c - 0.95 * RY, 0.62 * RX, 0.3 * RY));
    out.push({ color: rgbOf(k.fur2), d: sd.minus(cheeks, sd.union(sd.ellipse(-ex, ey, ew * 1.6, eh * 1.4), sd.ellipse(ex, ey, ew * 1.6, eh * 1.4))) });
  } else if (species === "badger") {
    // two dark stripes from the nose over the eyes
    for (const s of [-1, 1]) out.push({ color: rgbOf(k.dark), d: sd.stroke([P(s * 0.12 * RX, c - 0.2 * RY), P(s * ex, ey), P(s * 0.48 * RX, c + 0.7 * RY)], 0.12 * RX, 0.16 * RX) });
  }
  if (species === "rabbit" || species === "cat") {
    for (const s of [-1, 1]) out.push({ color: rgbOf(k.blush), d: sd.ellipse(s * (ex + ew * 0.6), ey - eh * 1.65, 0.095 * RX, 0.055 * RY) });
  }
  // the nose: a soft rounded triangle, dark (pink for a rabbit or a cat), with a glint
  const nw = (species === "bear" ? 0.1 : species === "rabbit" || species === "cat" ? 0.06 : 0.075) * RX, nh = nw * 0.68;
  const nose = sd.shape([P(-nw, ny + nh * 0.55), P(nw, ny + nh * 0.55), ...sd.curve(P(nw, ny + nh * 0.55), P(nw * 0.55, ny - nh * 1.2), P(0, ny - nh * 1.05), 8).slice(1), ...sd.curve(P(0, ny - nh * 1.05), P(-nw * 0.55, ny - nh * 1.2), P(-nw, ny + nh * 0.55), 8).slice(1, -1)]);
  out.push({ color: rgbOf(k.nose), d: (x, y) => nose(x, y) - nw * 0.12 });
  out.push({ color: [255, 255, 255], d: sd.ellipse(-nw * 0.3, ny + nh * 0.15, nw * 0.24, nh * 0.2) });
  return out;
}
