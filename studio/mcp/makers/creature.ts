// creature_make: a small enemy or animal from an archetype (slime, bat, skeleton, spider, ghost, beetle), in any colour:
// idle (2 frames), move (4) and a white copy to flash when it is hit. They face the viewer (or are seen from above), so
// one sheet serves every direction; flip it with `flip_x` to face the way it goes.
// Same rules as the other makers: light from the top left, the palette's outline, a soft shadow on the ground.

import { colourOf, Img, mix, ramp, shade, SHADOW, type Ramp, type Rgba } from "./paint";
import { accentOf, lit, paletteOf } from "./palettes";
import { CITY_CREATURE_NAMES, CITY_CREATURES, cityCtx, cityFrames, up } from "./city-creatures";
import { HD_CREATURE_NAMES, hdFrames } from "./creatures-hd";
import { toonRamp as hdRamp } from "./toon";
import { styleOf } from "./style";
import { writeSheet, type Put } from "./sheet";

type Args = Record<string, any>;

interface Ctx {
  n: number; // the frame's size in pixels
  k: number; // how many times 16 that is
  r: Ramp; // the creature's colour
  r2: Ramp; // its second colour (eyes, markings)
  outline: Rgba;
  /// Thin things (legs) drawn under the body in the outline's own colour: an outline round each would make one dark lump.
  under: Img;
}

interface Kind {
  what: string;
  colour: string;
  second: string;
  /// One frame: `move` is which of the four moving frames (or -1 at rest), `rest` which of the two resting ones.
  draw: (c: Ctx, body: Img, shadow: (cx: number, rx: number) => void, move: number, rest: number) => void;
}

const WHITE: Rgba = [255, 255, 255, 255];

/// A rounded body lit from the top left: lighter up and left, darker down and right.
function blob(img: Img, cx: number, cy: number, rx: number, ry: number, r: Ramp) {
  img.ellipse(cx, cy, rx, ry, (x, y) => {
    const u = (x - cx) / rx, v = (y - cy) / ry;
    const light = -(u * 0.5 + v * 0.75);
    return light > 0.55 ? r[4] : light > 0.15 ? r[3] : light > -0.4 ? r[2] : light > -0.75 ? r[1] : r[0];
  });
}

function eyes(img: Img, c: Ctx, cx: number, y: number, gap: number, colour: Rgba, glint = true) {
  const s = Math.max(1, Math.round(c.k)), h = Math.round(2 * c.k);
  for (const x of [Math.round(cx - gap - s + 0.5), Math.round(cx + gap + 0.5)]) {
    img.rect(x, y, s, h, colour);
    if (glint) img.set(x, y, WHITE);
  }
}

const KINDS: Record<string, Kind> = {
  slime: {
    what: "a blob that hops: it squashes, stretches, leaves the ground and lands", colour: "green", second: "white",
    draw: (c, body, shadow, move, rest) => {
      const k = c.k, n = c.n;
      // width, height and how far off the ground, in 16ths
      const [w, h, up] = move < 0 ? (rest ? [13, 8, 0] : [12, 9, 0]) : ([[14, 7, 0], [10, 11, 1], [11, 10, 3], [14, 7, 0]] as const)[move]!;
      const bottom = n - 2 * k - up * k, cx = n / 2 - 0.5;
      for (let y = Math.round(bottom - h * k); y <= bottom; y++) {
        const t = (bottom - y) / (h * k);
        const half = (w * k) / 2 * Math.sqrt(Math.max(0, 1 - t * t * 0.96));
        for (let x = Math.ceil(cx - half); x <= Math.floor(cx + half); x++) {
          const u = (x - cx) / ((w * k) / 2);
          const light = -u * 0.5 + (t - 0.45) * 1.1;
          body.set(x, y, y >= bottom - 0.5 ? c.r[1] : light > 0.62 ? c.r[4] : light > 0.2 ? c.r[3] : light > -0.45 ? c.r[2] : c.r[1]);
        }
      }
      // a wet shine, and eyes that sit lower when it is squashed
      body.rect(Math.round(cx - w * k * 0.28), Math.round(bottom - h * k * 0.72), Math.round(2 * k), Math.round(k), WHITE);
      body.set(Math.round(cx - w * k * 0.28) - 1, Math.round(bottom - h * k * 0.72) + Math.round(k), WHITE);
      eyes(body, c, cx, Math.round(bottom - h * k * 0.5), 1.5 * k, c.outline, false);
      shadow(cx, (w - up) * k * 0.5);
    },
  },
  bat: {
    what: "a bat that flaps: wings up, level, down, level", colour: "purple", second: "yellow",
    draw: (c, body, shadow, move, rest) => {
      const k = c.k, n = c.n, cx = n / 2 - 0.5;
      const phase = move < 0 ? [0, 1][rest]! : [-1, 0, 1, 0][move]!; // -1 wings up, 1 wings down
      const cy = 8 * k + phase * k;
      // wings: three ribs from the shoulder with a scalloped edge between them
      for (const side of [-1, 1]) {
        for (let i = 0; i <= 6 * k; i++) {
          const x = Math.round(cx + side * (2 * k + i));
          const lift = -phase * (i / (6 * k)) * 4 * k;
          const top = cy - 2 * k + lift - (i > 4 * k ? (i - 4 * k) * 0.3 : 0);
          const depth = (5 - (i / (6 * k)) * 2.5) * k - ((i / k) % 2 < 1 ? k : 0);
          for (let y = Math.round(top); y < top + depth; y++) body.set(x, y, y === Math.round(top) ? c.r[3] : (i / k) % 2 < 1 ? c.r[1] : c.r[2]);
        }
      }
      blob(body, cx, cy, 3 * k, 3.4 * k, c.r);
      for (const side of [-1, 1]) {
        body.set(Math.round(cx + side * 2 * k), Math.round(cy - 4 * k), c.r[2]);
        body.set(Math.round(cx + side * 2.4 * k), Math.round(cy - 5 * k), c.r[3]);
      }
      eyes(body, c, cx, Math.round(cy - 1.5 * k), 0.6 * k, c.r2[3], false);
      body.set(Math.round(cx - 1), Math.round(cy + 1.5 * k), WHITE);
      body.set(Math.round(cx + 1), Math.round(cy + 1.5 * k), WHITE);
      shadow(cx, 4 * k);
    },
  },
  skeleton: {
    what: "a walking skeleton, seen from the front", colour: "bone", second: "red",
    draw: (c, body, shadow, move, rest) => {
      const k = c.k, n = c.n, cx = n / 2;
      const bob = move < 0 ? rest : move % 2 ? 0 : 0;
      const step = move < 0 ? 0 : [1, 0, -1, 0][move]!;
      const top = 1 * k + bob;
      const bone = c.r, dark = mix(c.outline, c.r[0], 0.3);
      // legs: two bones, one foot lifted on a step
      for (const side of [-1, 1]) {
        const lifted = step === side ? k : 0;
        const x = Math.round(cx + side * 1.5 * k - (side < 0 ? k : 0));
        body.rect(x, 11 * k, k, 3 * k - lifted, bone[side < 0 ? 3 : 1]);
        body.rect(x - (side < 0 ? k : 0), 14 * k - lifted, 2 * k, k, bone[2]);
      }
      // ribs on a spine, hips
      body.rect(cx - 0.5 * k, 7 * k + bob, k, 4 * k - bob, bone[1]);
      for (let i = 0; i < 2; i++) {
        body.rect(cx - 2.5 * k, (7.4 + i * 1.6) * k + bob, 5 * k, Math.max(1, Math.round(0.8 * k)), bone[i ? 2 : 3]);
      }
      body.rect(cx - 2 * k, 10.5 * k, 4 * k, k, bone[2]);
      // arms swing against the legs
      for (const side of [-1, 1]) {
        const swing = step * side * k;
        const x = Math.round(cx + side * 3.5 * k - (side < 0 ? k : 0));
        body.rect(x, 7 * k + bob, k, 2 * k, bone[side < 0 ? 3 : 1]);
        body.rect(x + (side * k) / 2, 9 * k + bob - swing, k, 2 * k, bone[2]);
      }
      // the skull: round, two sockets with a glow, a row of teeth
      blob(body, cx - 0.5, top + 3 * k, 3.6 * k, 3.2 * k, bone);
      body.rect(cx - 2 * k, top + 5 * k, 4 * k, 1.5 * k, bone[2]);
      for (let x = cx - 2 * k; x < cx + 2 * k; x += 2 * Math.max(1, Math.round(k * 0.8))) body.rect(x + Math.round(k * 0.5), top + 5.6 * k, Math.max(1, Math.round(k * 0.5)), k, dark);
      for (const side of [-1, 1]) {
        const x = Math.round(cx + side * 1.6 * k - k);
        body.rect(x, top + 2.4 * k, 2 * k, 2 * k, dark);
        body.set(x + (side < 0 ? Math.round(k) : 0), top + Math.round(3 * k), c.r2[3]);
      }
      shadow(cx - 0.5, 4.5 * k);
    },
  },
  spider: {
    what: "a spider seen from above, its eight legs stepping in two sets", colour: "#5b4a6e", second: "red",
    draw: (c, body, shadow, move, rest) => {
      const k = c.k, n = c.n, cx = n / 2 - 0.5;
      const cy = 8.5 * k + (move < 0 && rest ? k * 0.5 : 0);
      const set = move < 0 ? -1 : move % 2;
      // four legs a side: out, a knee, down; alternate legs lift
      for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {
        const lifted = set >= 0 && (i + (side < 0 ? 0 : 1)) % 2 === set ? 1 : 0;
        const sy = cy - 2 * k + i * 1.4 * k;
        const kx = cx + side * (4.5 + (i === 1 || i === 2 ? 1 : 0)) * k, ky = sy - (2.2 - i * 0.9) * k - lifted * k;
        const fx = cx + side * (6.5 + (i === 1 || i === 2 ? 0.5 : -0.5)) * k, fy = sy + (i - 1) * 1.6 * k + (i < 2 ? -0.5 : 2.5) * k - lifted * 1.5 * k;
        c.under.line(cx + side * 2 * k, sy, kx, ky, lifted ? c.r[1] : c.outline);
        c.under.line(kx, ky, fx, fy, c.outline);
      }
      blob(body, cx, cy + 1.5 * k, 3.6 * k, 3.4 * k, c.r);
      blob(body, cx, cy - 2.6 * k, 2.3 * k, 2 * k, c.r);
      // a mark on its back, and a row of eyes
      body.rect(cx - 0.5 * k + 0.5, cy + 0.5 * k, k, 2 * k, c.r2[2]);
      body.rect(cx - 1.5 * k + 0.5, cy + 1.2 * k, 3 * k, Math.max(1, Math.round(0.7 * k)), c.r2[2]);
      for (const side of [-1, 1]) body.set(Math.round(cx + side * 1.1 * k), Math.round(cy - 3.2 * k), c.r2[4]);
      shadow(cx, 6 * k);
    },
  },
  ghost: {
    what: "a ghost that floats: it bobs, and its hem ripples", colour: "#dfe6f5", second: "sky",
    draw: (c, body, shadow, move, rest) => {
      const k = c.k, n = c.n, cx = n / 2 - 0.5;
      const t = move < 0 ? rest * 2 : move;
      const lift = [0, 1, 2, 1][t % 4]! * k * 0.5;
      const top = 2 * k - lift, bottom = 13 * k - lift;
      for (let y = Math.round(top); y <= bottom + k; y++) {
        const f = (y - top) / (bottom - top);
        const half = (f < 0.4 ? Math.sqrt(1 - (1 - f / 0.4) ** 2) : 1) * 5 * k;
        for (let x = Math.ceil(cx - half); x <= Math.floor(cx + half); x++) {
          // the hem: three scallops that move along with each frame
          const wave = Math.sin(((x - cx) / (5 * k)) * Math.PI * 1.5 + t * 1.6) * k;
          if (y > bottom - k + wave) continue;
          const u = (x - cx) / (5 * k);
          body.set(x, y, u > 0.6 ? c.r[1] : u < -0.55 && f < 0.6 ? c.r[4] : f > 0.78 ? c.r[1] : c.r[2]);
        }
      }
      const dark = mix(c.outline, c.r2[0], 0.35);
      for (const side of [-1, 1]) body.ellipse(cx + side * 2 * k, top + 4.6 * k, 0.9 * k, 1.4 * k, dark);
      body.ellipse(cx, top + 7.6 * k, 0.9 * k, 0.9 * k, dark);
      for (const side of [-1, 1]) body.set(Math.round(cx + side * 3.6 * k), Math.round(top + 6.5 * k), c.r2[3]);
      shadow(cx, 3.5 * k - lift * 0.5);
    },
  },
  beetle: {
    what: "a beetle seen from above, with a shining shell and a horn", colour: "teal", second: "gold",
    draw: (c, body, shadow, move, rest) => {
      const k = c.k, n = c.n, cx = n / 2 - 0.5;
      const cy = 8.5 * k;
      const set = move < 0 ? -1 : move % 2;
      const dark = mix(c.outline, c.r[0], 0.4);
      for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
        const fwd = set >= 0 && (i + (side < 0 ? 0 : 1)) % 2 === set ? -k : set >= 0 ? k * 0.5 : 0;
        const sy = cy - 2 * k + i * 2.4 * k;
        c.under.line(cx + side * 3 * k, sy, cx + side * 5.5 * k, sy + fwd + (i - 1) * k, dark);
        c.under.set(Math.round(cx + side * 6.2 * k), Math.round(sy + fwd + (i - 1) * 1.6 * k), dark);
      }
      // head and horn
      blob(body, cx, cy - 4.4 * k, 2.2 * k, 1.8 * k, c.r.map((x) => shade(x, -1)) as Ramp);
      body.line(cx, cy - 6 * k, cx, cy - 7.5 * k - (rest && move < 0 ? 0 : 0), c.r2[2]);
      body.set(Math.round(cx - k), Math.round(cy - 7.5 * k), c.r2[3]);
      body.set(Math.round(cx + k), Math.round(cy - 7.5 * k), c.r2[1]);
      // the shell: two wing cases with a line between and a long highlight
      blob(body, cx, cy + 0.8 * k + (move < 0 && rest ? 0 : 0), 4.2 * k, 4.6 * k, c.r);
      body.line(cx + 0.5, cy - 3 * k, cx + 0.5, cy + 5 * k, c.r[0]);
      body.line(cx - 2.4 * k, cy - 1.5 * k, cx - 2.8 * k, cy + 1.2 * k + (move < 0 && rest ? k : 0), WHITE);
      for (const side of [-1, 1]) body.set(Math.round(cx + side * 1.8 * k), Math.round(cy + 2.4 * k), c.r2[3]);
      shadow(cx, 5 * k);
    },
  },
};

export const CLASSIC_CREATURES = Object.keys(KINDS);
export const CREATURES = [...CLASSIC_CREATURES, ...CITY_CREATURE_NAMES];
export const CREATURE_SIZES = [16, 24, 32];
export { CITY_CREATURE_NAMES };

/// `creature_make`: see the tool's description in makers/index.ts.
export function makeCreature(name: string, a: Args, put: Put): { text: string; picture: import("./paint").Raster } {
  const kindName = String(a.kind ?? "").trim().toLowerCase().replace(/[ -]/g, "_");
  if (styleOf(a) === "detailed") return makeHdCreature(name, kindName, a, put);
  if (CITY_CREATURES[kindName]) return makeCityCreature(name, kindName, a, put);
  const kind = KINDS[kindName];
  if (!kind) throw new Error(`"kind" is one of ${CREATURES.join(", ")} (got '${a.kind ?? ""}')`);
  const n = a.size === undefined ? 16 : Number(a.size);
  if (!CREATURE_SIZES.includes(n)) throw new Error(`"size" is the frame's size in pixels: ${CREATURE_SIZES.join(", ")} (16 when left out)`);
  const P = paletteOf(a.palette);
  const c: Ctx = {
    n, k: n / 16,
    r: ramp(lit(P, colourOf(a.color ?? a.colour, '"color"', kind.colour))),
    r2: ramp(lit(P, colourOf(a.second_color ?? a.second_colour, '"second_color"', kind.second))),
    outline: P.outline,
    under: new Img(n, n),
  };
  const frame = (move: number, rest: number): Img => {
    const img = new Img(n, n), body = new Img(n, n);
    c.under = new Img(n, n);
    let shade_: [number, number] = [n / 2, 4 * c.k];
    kind.draw(c, body, (cx, rx) => (shade_ = [cx, rx]), move, rest);
    img.ellipse(shade_[0], n - 1.5 * c.k, shade_[1], 1.2 * c.k, SHADOW);
    img.draw(c.under);
    img.draw(body.outline(c.outline));
    return img;
  };
  const frames = [frame(-1, 0), frame(-1, 1), frame(0, 0), frame(1, 0), frame(2, 0), frame(3, 0)];
  // the frame to show for a moment when it is hit: the first frame, all white (a tint can only darken)
  const body = new Img(n, n);
  c.under = new Img(n, n);
  kind.draw(c, body, () => {}, -1, 0);
  frames.push(new Img(n, n).draw(c.under).draw(body.outline(c.outline)).silhouette(WHITE));
  const box = { x: Math.round(3 * c.k), y: Math.round(5 * c.k), w: n - Math.round(6 * c.k), h: n - Math.round(7 * c.k) };
  const made = writeSheet(name, {
    frames,
    tags: [{ name: "idle", from: 0, to: 1 }, { name: "move", from: 2, to: 5 }, { name: "hit", from: 6, to: 6, loop: false }],
    durations: [420, 420, 110, 110, 110, 110, 120],
    hitbox: box,
    pivot: { x: n / 2, y: n - 2 * c.k },
  }, put);
  return {
    text: [
      made.text,
      `${kindName}: ${kind.what}; palette "${P.name}"`,
      `animations: idle (2 frames), move (4), hit (1: the white copy to show for a moment when it is hurt, then go back to "idle")`,
      `In its entity: sprite = "${name}", anim = "idle", pivot = { 0.5, ${Math.round(((n - 2 * c.k) / n) * 1000) / 1000} }, hitbox = { ${box.x - n / 2}, ${box.y - (n - 2 * c.k)}, ${box.w}, ${box.h} }, sx = 3, sy = 3, tags = { "enemy" }; self.flip_x = true faces it the other way.`,
      `Another colour: "color" and "second_color"; change a frame afterwards with sprite_write { "at": n }.`,
    ].join("\n"),
    picture: made.picture,
  };
}

/// A city archetype (city-creatures.ts): drawn at its own size, its states tagged by name, a tell and a hit frame.
function makeCityCreature(name: string, kindName: string, a: Args, put: Put): { text: string; picture: import("./paint").Raster } {
  const kind = CITY_CREATURES[kindName]!;
  const D = kind.size;
  const n = a.size === undefined ? D : Number(a.size);
  if (![16, 24, 32, 48].includes(n)) throw new Error(`"size" is the frame's size in pixels: 16, 24, 32 or 48 (a ${kindName} is drawn at ${D}, which is what it is when left out)`);
  const P = paletteOf(a.palette);
  const c = cityCtx(
    D, P,
    ramp(lit(P, colourOf(a.color ?? a.colour, '"color"', kind.colour))),
    ramp(lit(P, colourOf(a.second_color ?? a.second_colour, '"second_color"', kind.second))),
    accentOf(P, a.glow_color ?? a.glow_colour, '"glow_color"') ?? P.accent[0],
  );
  const made0 = cityFrames(kind, c);
  const frames = made0.frames.map((f) => up(f, n / D));
  const k = n / D;
  const [px, py] = kind.pivot?.(D) ?? [D / 2, D - Math.round(D / 8)];
  const pivot = { x: Math.round(px * k), y: Math.round(py * k) };
  const box = { x: Math.round(D * 0.2 * k), y: Math.round(D * 0.35 * k), w: Math.round(D * 0.6 * k), h: pivot.y - Math.round(D * 0.35 * k) };
  const names: Record<number, string> = {};
  for (const [nm, f] of Object.entries(kind.names ?? {})) names[f] = nm;
  const made = writeSheet(name, { frames, tags: made0.tags, durations: made0.durations, hitbox: box, pivot, names }, put);
  const states = made0.tags.map((t) => `${t.name} (${t.to - t.from + 1})`).join(", ");
  return {
    text: [
      made.text,
      `${kindName}: ${kind.what}; drawn at ${D}x${D}${n !== D ? `, made ${n}x${n}` : ""}; palette "${P.name}"`,
      `animations: ${states}. "tell" is the moment before it hurts (its outline and lights flash in the glow colour): show it 0.4 s before the attack. "hit" is the white copy to show for a moment when it is hurt.`,
      `In its entity: sprite = "${name}", anim = "${made0.tags[0]!.name}", pivot = { ${Math.round((pivot.x / n) * 1000) / 1000}, ${Math.round((pivot.y / n) * 1000) / 1000} }, hitbox = { ${box.x - pivot.x}, ${box.y - pivot.y}, ${box.w}, ${box.h} }, sx = 3, sy = 3, tags = { "enemy" }; self.flip_x = true faces it the other way.`,
    ].join("\n"),
    picture: made.picture,
  };
}

/// A city archetype in the detailed style (creatures-hd.ts): twice the pixels, drawn with sx = 1.5.
function makeHdCreature(name: string, kindName: string, a: Args, put: Put): { text: string; picture: import("./paint").Raster } {
  if (!HD_CREATURE_NAMES.includes(kindName)) throw new Error(`"kind": the detailed style is drawn for the city's archetypes: ${HD_CREATURE_NAMES.join(", ")} (got '${a.kind ?? ""}')`);
  if (a.size !== undefined) throw new Error(`"size": a detailed archetype has its own size (leave "size" out)`);
  const kind = CITY_CREATURES[kindName]!;
  const P = paletteOf(a.palette);
  const warm = mix(P.accent[0][2], [255, 255, 255, 255], 0.65);
  const made0 = hdFrames(kindName, {
    P,
    r: hdRamp(lit(P, colourOf(a.color ?? a.colour, '"color"', kind.colour)), warm),
    r2: hdRamp(lit(P, colourOf(a.second_color ?? a.second_colour, '"second_color"', kind.second)), warm),
    acc: accentOf(P, a.glow_color ?? a.glow_colour, '"glow_color"') ?? P.accent[0],
    metal: hdRamp(lit(P, P.mat.metal[3]), warm),
    dark: hdRamp(lit(P, mix(P.mat.metal[1], P.outline, 0.45)), warm),
  });
  const n = made0.size;
  const pivot = { x: n / 2, y: made0.oy + 1 };
  const box = { x: Math.round(n * 0.22), y: Math.round(n * 0.45), w: Math.round(n * 0.56), h: pivot.y - Math.round(n * 0.45) };
  const names: Record<number, string> = {};
  if (kindName === "crane_arm") Object.assign(names, { 0: "base", 1: "arm", 2: "magnet" });
  const made = writeSheet(name, { frames: made0.frames, tags: made0.tags, durations: made0.durations, hitbox: box, pivot, names }, put);
  return {
    text: [
      made.text,
      `${kindName} in the detailed style: ${kind.what}; ${n}x${n} frames, palette "${P.name}"`,
      `animations: ${made0.tags.map((t) => `${t.name} (${t.to - t.from + 1})`).join(", ")}. "tell" is the moment before it hurts (its edge lights up in the glow colour): show it 0.4 s before the attack. "hit" is the white copy for when it is hurt.`,
      `In its entity: sprite = "${name}", anim = "${made0.tags[0]!.name}", pivot = { 0.5, ${Math.round((pivot.y / n) * 1000) / 1000} }, hitbox = { ${box.x - pivot.x}, ${box.y - pivot.y}, ${box.w}, ${box.h} }, sx = 1.5, sy = 1.5, tags = { "enemy" }.`,
    ].join("\n"),
    picture: made.picture,
  };
}
