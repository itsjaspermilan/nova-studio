// character3d_make: a rigged low-poly person from parts, with the clips a third-person game needs. The figure is built in
// metres, standing on y = 0 and facing +z. Arms and legs are one smooth mesh each across the joint, skinned by
// model_write's `bend`; everything else is rigid in its part. The walk and the run are made by model_write's own `walk`
// (feet placed on the ground, hips rising over the standing leg), the other clips are keyed here.

import { colourOf, rngOf, toHex } from "./paint";
import { paletteOf } from "./palettes";
import { blend, choice, colours, Mesh3, modelDoc, part, tone, U, type Args, type V3 } from "./kit3d";
import { decalOver, frontHit, paintTexture, reaches, rgbOf, sd, trianglesOf, type Ink, type Painted, type Rgb } from "./decal3d";
import { EXPRESSIONS, FACE_SETS, TALK, faceInks, faceLayout, staticInks, type FaceColours, type FaceLayout } from "./face3d";
import type { Cube } from "../../src/lib/model-doc";
import type { Raster } from "../../src/lib/pixels";

export const CHARACTER3D = {
  builds: ["average", "slim", "stocky", "child", "squat", "chibi"] as const,
  skins: ["light", "tan", "brown", "dark", "pale", "green"] as const,
  hairs: ["short", "long", "bun", "ponytail", "spiky", "bald"] as const,
  outfits: ["tunic", "shirt", "robe", "armor", "vest", "cardigan"] as const,
  hats: ["none", "cap", "hood", "wizard", "straw", "helmet", "peaked", "bucket", "round"] as const,
  packs: ["none", "backpack", "quiver", "cape"] as const,
  items: ["none", "sword", "staff", "lantern", "axe", "torch"] as const,
  species: ["human", "fox", "badger", "rabbit", "bear", "cat"] as const,
  accessories: ["none", "satchel", "glasses", "headphones", "scarf", "apron"] as const,
  /// (a chibi's: painted on the chest)
  emblems: ["none", "envelope", "star", "leaf", "heart", "bolt"] as const,
};

/// An animal person's face is painted on its head (face3d.ts): the eyes, the brows and the mouth are each a set of decals, every one a
/// part of the head of which the game shows one (parts = { eye_wide = { visible = true }, eye_open = { visible = false } }). The model
/// as written shows the first of each set; the others are hidden by the game until wanted.
export { EXPRESSIONS, FACE_SETS, TALK } from "./face3d";
const FIRSTS = new Set<string>([FACE_SETS.eyes[0], FACE_SETS.brows[0], FACE_SETS.mouth[0]]);

/// The animals' fur: the main coat, the lighter one (muzzle, chest, tail tip), the dark one (nose, ear tips, paws), and the
/// head's size against a person's (big-headed, as animal people in a cozy game are).
const FURS: Record<string, { fur: string; fur2: string; dark: string; head: number }> = {
  fox: { fur: "#d9692b", fur2: "#f7efe2", dark: "#3b2620", head: 1.55 },
  badger: { fur: "#85878d", fur2: "#f3f0ea", dark: "#24242a", head: 1.55 },
  rabbit: { fur: "#c9a07a", fur2: "#f6eee2", dark: "#5a3e30", head: 1.6 },
  bear: { fur: "#8a5a34", fur2: "#dcb68a", dark: "#2e2018", head: 1.5 },
  cat: { fur: "#9b9aa3", fur2: "#f1ede6", dark: "#2c2a30", head: 1.55 },
};

const SKINS: Record<string, string> = { light: "#f0c8a0", tan: "#dba77c", brown: "#a8734c", dark: "#6e4a34", pale: "#f6dcc8", green: "#8fbf6a" };

export interface Character3d {
  model: Args;
  parts: string[];
  clips: { name: string; duration: number; loop: boolean; events: string[]; stride?: number }[];
  /// Its legs are one piece from hip to ankle (a chibi): nova.gait can plant its feet (the entity it writes uses it).
  gait: boolean;
  speeds: Record<string, number>;
  capsule: { radius: number; height: number };
  says: string;
  /// For an animal person: how its face changes (the parts of each set, and the expressions as the part of each set they show).
  faces?: string;
  /// The model's texture (its painted face and clothes), to be written as models/<name>.texture.png and given to model_write.
  picture?: Raster;
  /// The head's size in metres (without ears or hat).
  head?: { width: number; height: number; depth: number };
  lua: (name: string, speeds: { walk: number; run: number }) => string;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/// A smooth ellipsoid about `c` with half sizes `r` added to `m` (`flat`: its bottom cut off flat at that share of its height).
function ellipsoid(m: Mesh3, c: V3, r: V3, color: string, seg = 24, rows = 12, flat?: number): Mesh3 {
  const rs: { y: number; rx: number; rz: number }[] = [];
  for (let i = 0; i <= rows; i++) {
    const t = -Math.PI / 2 + (Math.PI * i) / rows;
    const y = Math.sin(t) * r[1];
    rs.push({ y: flat !== undefined ? Math.max(y, -r[1] * flat) : y, rx: Math.cos(t) * r[0], rz: Math.cos(t) * r[2] });
  }
  return m.rings(rs, seg, color, { at: c, smooth: true });
}
const key = (t: number, value: V3, ease?: string) => (ease ? { t: r3(t), value, ease } : { t: r3(t), value });

export function makeCharacter3d(a: Args): Character3d {
  const build = choice(a.build, CHARACTER3D.builds, "build");
  const species = choice(a.species, CHARACTER3D.species, "species");
  const accessory = choice(a.accessory, CHARACTER3D.accessories, "accessory");
  const animal = species !== "human";
  const furs = animal ? FURS[species]! : undefined;
  const hs = a.head_scale === undefined ? (furs ? furs.head : 1) : Number(a.head_scale);
  if (!Number.isFinite(hs) || hs < 0.8 || hs > 2.2) throw new Error(`head_scale is a number from 0.8 to 2.2 (got ${JSON.stringify(a.head_scale)})`);
  // (an animal has no hair unless it is asked for)
  const hair = choice(a.hair, CHARACTER3D.hairs, "hair", animal ? "bald" : "short");
  const outfit = choice(a.outfit, CHARACTER3D.outfits, "outfit");
  const hat = choice(a.hat, CHARACTER3D.hats, "hat");
  const pack = choice(a.pack, CHARACTER3D.packs, "pack");
  const item = choice(a.item, CHARACTER3D.items, "item");
  const pal = colours(paletteOf(a.palette));
  const rand = rngOf((Number.isFinite(a.seed) ? Number(a.seed) : 1) * 9973 + 5);
  const col = (v: unknown, what: string, fallback: string) => toHex(colourOf(v, what, fallback));
  const skin = furs
    ? col(a.fur ?? a.skin, "fur", furs.fur)
    : typeof a.skin === "string" && SKINS[a.skin.toLowerCase()] ? SKINS[a.skin.toLowerCase()]! : col(a.skin, "skin", SKINS.light!);
  const fur2 = furs ? col(a.fur2, "fur2", furs.fur2) : skin;
  const furDark = furs ? furs.dark : skin;
  const hairC = col(a.hair_color, "hair_color", "brown");
  const main = col(a.outfit_color, "outfit_color", outfit === "armor" ? "silver" : outfit === "robe" ? "purple" : "teal");
  const trim = col(a.trim_color, "trim_color", outfit === "robe" ? "gold" : "brown");
  const shoe = col(a.shoe_color, "shoe_color", "#4a3628");
  const cloth = col(a.shirt_color, "shirt_color", "#efe6d2");
  // trousers unless a skirt is asked for (a robe is a long dress whatever is asked)
  if (a.skirt !== undefined && typeof a.skirt !== "boolean") throw new Error(`skirt is true or false (got ${JSON.stringify(a.skirt)}): true gives a tunic or armour a skirt over the legs instead of trousers`);
  const skirted = outfit === "robe" || (a.skirt === true && (outfit === "tunic" || outfit === "armor"));
  // (the soft hats' colour: a bucket hat's or a round cap's)
  const hatC = col(a.hat_color, "hat_color", trim);
  const hatPin = choice(a.hat_pin, CHARACTER3D.emblems, "hat_pin");

  // ---- the measures (metres)
  // (squat: short and broad, a badger's or a bear's build)
  // (chibi: a cozy villager about two heads tall, 1.0 to 1.15 m: a big round head on a small pear-shaped body, stubby arms and legs
  // that are one simple piece each, swinging from the shoulder and the hip, mitten hands, round feet; no elbows or knees)
  const chibi = build === "chibi";
  const tall = build === "child" ? 0.72 : build === "squat" ? 0.76 : build === "stocky" ? 0.95 : 1;
  const wide = build === "slim" ? 0.88 : build === "stocky" ? 1.2 : build === "squat" ? 1.18 : build === "child" ? 0.86 : chibi ? 0.95 : 1;
  const headK = (build === "child" ? 1.02 : chibi ? 1.0 : 1.1) * hs;
  const ankle = chibi ? 0.045 : 0.07, shin = chibi ? 0.095 : 0.34 * tall, thigh = chibi ? 0.105 : 0.36 * tall;
  const hipY = ankle + shin + thigh;
  const hipsY = hipY + (chibi ? 0.02 : 0.03);
  const spineUp = chibi ? 0.02 : 0.07 * tall, neckUp = chibi ? 0.25 : 0.42 * tall;
  const upper = chibi ? 0.12 : 0.24 * tall, fore = chibi ? 0.09 : 0.22 * tall;
  const shoulder = chibi ? 0.16 * wide : 0.205 * wide * (build === "child" ? 0.95 : 1), legX = chibi ? 0.075 * wide : 0.092 * wide;
  // (a chibi's shoulder and hip balls: the round tops of its arms and legs, sunk into the body)
  const shoulderR = 0.058 * wide, hipR = 0.062 * wide;
  const cy = chibi ? 0.55 : 1; //(the hips' own shapes, pelvis, jacket hem and belt, squeezed to the short body)
  // (a chibi animal's head is squashed: clearly wider than tall, a little less deep than wide)
  const squash = chibi && animal;
  const headR: V3 = squash ? [0.16 * headK, 0.118 * headK, 0.135 * headK] : [0.125 * headK, 0.148 * headK, 0.13 * headK];
  const headC = squash ? 0.118 * headK * 0.92 : 0.165 * headK;

  // ---- colours by region
  const sleeves = outfit === "shirt" ? "short" : "long";
  const sleeveC = outfit === "vest" ? cloth : outfit === "armor" ? blend(main, "#5a5f6c", 0.55) : main;
  const torsoC = main;
  const legC = outfit === "robe" ? tone(main, -0.6) : trim;
  const metal = outfit === "armor";

  // ---- limbs: one smooth mesh across the joint each
  const limb = (rings: [number, number, string][], seg: number, squash = 1) => {
    const m = new Mesh3(rings[0]![2], { bend: true });
    m.rings(rings.map(([y, r]) => ({ y, rx: r, rz: r * squash })), seg, (i) => rings[Math.min(i + 1, rings.length - 1)]![2], { smooth: true });
    return m;
  };
  const armR = 0.052 * wide;
  const armMesh = () => {
    const low = sleeves === "short" ? skin : sleeveC;
    const cuff = sleeves === "short" ? skin : tone(sleeveC, -0.5);
    return limb(
      [
        [0.05, armR * 0.5, sleeveC], [0.03, armR * 0.95, sleeveC], [-0.03, armR * 1.12, sleeveC], [-upper * 0.5, armR * 1.02, sleeveC], [-upper + 0.035, armR * 0.94, sleeveC],
        [-upper, armR * 0.92, sleeves === "short" ? tone(sleeveC, -0.4) : sleeveC], [-upper - 0.035, armR * 0.9, low], [-upper - fore * 0.5, armR * 0.86, low], [-upper - fore + 0.03, armR * 0.78, low], [-upper - fore, armR * 0.74, cuff],
      ],
      8,
    );
  };
  const legR = 0.078 * wide;
  const bootTop = -thigh - shin * 0.45;
  const legMesh = () => {
    const boot = (y: number) => (y <= bootTop ? shoe : legC);
    const ys: [number, number][] = [
      [0.04, legR * 0.98], [-0.05, legR * 1.06], [-thigh * 0.5, legR * 0.96], [-thigh + 0.04, legR * 0.84], [-thigh, legR * 0.8], [-thigh - 0.04, legR * 0.8],
      [-thigh - shin * 0.3, legR * 0.84], [bootTop, legR * 0.8], [-thigh - shin * 0.75, legR * 0.7], [-thigh - shin + 0.01, legR * 0.66],
    ];
    return limb(ys.map(([y, r]) => [y, r, boot(y)]), 8);
  };
  const footMesh = () => {
    const m = new Mesh3(shoe, { bend: false });
    // a shoe: heel, a longer toe, rounded by a taper; the sole a shade darker
    m.box([0, -ankle + 0.012, 0.045], [0.105 * wide, 0.024, 0.25], tone(shoe, -1.2), { flat: true });
    m.box([0, -ankle + 0.055, 0.02], [0.1 * wide, 0.07, 0.19], shoe, { taper: [0.9, 0.86] });
    m.box([0, -ankle + 0.045, 0.125], [0.096 * wide, 0.05, 0.09], tone(shoe, 0.2), { taper: [0.8, 0.6] });
    return m;
  };
  // (an animal's hands are paws: a fox's dark, the others a shade under the fur)
  const paw = !animal ? skin : species === "fox" ? furDark : species === "badger" ? furDark : tone(skin, -0.25);
  // chibi limbs: a stubby rounded piece each, rigid in its part (it swings from the shoulder or the hip as a whole); the mitten and the
  // round foot sit at its end in their own parts, which the chibi clips never bend away
  // (smooth and round, like a soft toy's: a short tapered sleeve, a round mitten, a short leg, a round foot)
  // (the top of each limb is a ball round its own pivot, sunk into the body: whichever way the limb turns, the ball stays where it
  // is, so the shoulder and the hip never open a gap, and the sleeve or the trouser leg runs out of the body in one smooth piece)
  const ballTop = (r: number, rows = 6) => Array.from({ length: rows }, (_, i) => {
    const t = (Math.PI / 2) * (1 - i / rows);
    return { y: Math.sin(t) * r, rx: Math.cos(t) * r };
  });
  const chibiArm = () => {
    const m = new Mesh3(sleeveC, { bend: false });
    const len = upper + fore, rs = shoulderR;
    const top = ballTop(rs);
    m.rings([...top, { y: 0.0, rx: rs }, { y: -rs * 0.7, rx: 0.056 * wide }, { y: -len * 0.5, rx: 0.051 * wide }, { y: -len + 0.022, rx: 0.046 * wide }, { y: -len + 0.012, rx: 0.047 * wide }, { y: -len + 0.002, rx: 0.044 * wide }, { y: -len - 0.006, rx: 0.036 * wide }], 16,
      (i) => (i - top.length >= 3 ? (sleeves === "short" ? skin : tone(sleeveC, -0.35)) : sleeveC), { smooth: true });
    return m;
  };
  const chibiMitten = () => ellipsoid(new Mesh3(paw, { bend: false }), [0, -0.026, 0.004], [0.044 * wide, 0.046, 0.044], paw, 16, 10);
  // (a trouser leg: its ball top inside the seat of the trousers, a short leg, a turn-up at the hem over the shoe)
  const chibiLeg = () => {
    const m = new Mesh3(legC, { bend: false });
    const len = thigh + shin, rh = hipR;
    const top = ballTop(rh);
    m.rings([...top, { y: 0, rx: rh }, { y: -len * 0.5, rx: 0.058 * wide }, { y: -len + 0.03, rx: 0.055 * wide }, { y: -len + 0.026, rx: 0.059 * wide }, { y: -len + 0.004, rx: 0.059 * wide }, { y: -len - 0.002, rx: 0.05 * wide }], 16,
      (i) => (i - top.length >= 3 ? tone(legC, -0.3) : legC), { smooth: true });
    return m;
  };
  const chibiFoot = () => ellipsoid(new Mesh3(shoe, { bend: false }), [0, -ankle + 0.035, 0.025], [0.06 * wide, 0.042, 0.082], shoe, 16, 10, 0.8);
  const handMesh = (side: number) => {
    if (chibi) return chibiMitten();
    const m = new Mesh3(paw, { bend: false });
    m.blob([0, -0.045, 0], [0.036, 0.055, 0.045], paw, () => 0.5, { seg: 6, rows: 3, jitter: 0, tones: 0 });
    m.box([-side * 0.012, -0.045, 0.04], [0.022, 0.04, 0.03], tone(paw, -0.2), { flat: true });
    return m;
  };

  // ---- the body
  const bseg = chibi ? 24 : 10; // (a chibi is smooth and round all over)
  const pelvis = new Mesh3(legC, { bend: false });
  pelvis.rings([{ y: -0.11 * cy, rx: 0.1 * wide, rz: 0.085 }, { y: -0.05 * cy, rx: 0.158 * wide, rz: 0.115 }, { y: 0.04 * cy, rx: 0.16 * wide, rz: 0.112 }, { y: 0.1 * cy, rx: 0.145 * wide, rz: 0.1 }], bseg, legC, { smooth: true });
  const skirt = new Mesh3(torsoC, { bend: false });
  if (skirted) {
    const down = outfit === "robe" ? -(thigh + shin * 0.35) : chibi ? -0.07 : -0.2 * tall, flare = outfit === "robe" ? 1.5 : 1.22;
    const c = outfit === "armor" ? tone(main, -0.3) : torsoC;
    skirt.rings([{ y: 0.09 * cy, rx: 0.165 * wide, rz: 0.118 }, { y: 0.0, rx: 0.178 * wide, rz: 0.13 }, { y: down, rx: 0.17 * wide * flare, rz: 0.13 * flare }], bseg, (i) => (i === 1 ? tone(c, -0.25) : c), { smooth: true, caps: false });
    // (closed underneath, a shade darker, so nothing shows through from below)
    skirt.rings([{ y: down + 0.004, rx: 0.165 * wide * flare, rz: 0.125 * flare }, { y: down, rx: 0.17 * wide * flare, rz: 0.13 * flare }], bseg, tone(c, -1.4));
    if (outfit === "robe") skirt.rings([{ y: down, rx: 0.172 * wide * flare, rz: 0.132 * flare }, { y: down + 0.04, rx: 0.172 * wide * flare, rz: 0.132 * flare }], bseg, trim, { caps: false });
  }
  const belt = new Mesh3(trim, { bend: false });
  // (an apron is tied over the waist instead of a belt)
  // (a cardigan is buttoned over a shirt with no belt; a chibi's shirt hangs loose)
  if (outfit !== "robe" && outfit !== "cardigan" && !(chibi && (accessory === "apron" || outfit === "shirt"))) {
    belt.rings([{ y: 0.065 * cy, rx: (chibi ? 0.195 : 0.172) * wide, rz: chibi ? 0.155 : 0.124 }, { y: 0.105 * cy, rx: (chibi ? 0.195 : 0.172) * wide, rz: chibi ? 0.155 : 0.124 }], bseg, tone(trim, -0.5));
    belt.box([0, 0.085 * cy, chibi ? 0.157 : 0.125], [0.05, 0.05 * cy, 0.02], pal.gold!, { flat: true });
  } else if (outfit === "robe") belt.rings([{ y: 0.07, rx: 0.172 * wide, rz: 0.124 }, { y: 0.1, rx: 0.172 * wide, rz: 0.124 }], bseg, trim);

  const torso = new Mesh3(torsoC, { bend: false, ...(metal ? { metallic: 0.55, roughness: 0.5 } : {}) });
  const tc = metal ? "#b4bac6" : torsoC;
  // (chibi: a pear, widest at the bottom, round in the middle, soft round shoulders that the arms' balls sink into, a small neck)
  if (chibi) torso.rings([{ y: -0.05, rx: 0.165 * wide, rz: 0.13 }, { y: neckUp * 0.12, rx: 0.178 * wide, rz: 0.14 }, { y: neckUp * 0.4, rx: 0.17 * wide, rz: 0.134 }, { y: neckUp * 0.68, rx: 0.15 * wide, rz: 0.114 }, { y: neckUp * 0.84, rx: 0.122 * wide, rz: 0.094 }, { y: neckUp * 0.94, rx: 0.08 * wide, rz: 0.07 }, { y: neckUp, rx: 0.055, rz: 0.05 }], 24, tc, { smooth: true });
  else torso.rings(
    [
      { y: -0.02, rx: 0.15 * wide, rz: 0.105 }, { y: neckUp * 0.3, rx: 0.165 * wide, rz: 0.115 }, { y: neckUp * 0.66, rx: 0.19 * wide, rz: 0.125 },
      { y: neckUp * 0.88, rx: 0.185 * wide, rz: 0.115 }, { y: neckUp, rx: 0.075, rz: 0.07 },
    ],
    10, tc, { smooth: true },
  );
  const extras = new Mesh3(trim, { bend: false });
  if (outfit === "tunic" || outfit === "shirt") extras.rings([{ y: neckUp * 0.9, rx: 0.115 * wide, rz: 0.092 }, { y: neckUp * 0.985, rx: 0.07, rz: 0.066 }], 10, tone(main, -0.55), { caps: false, smooth: true }); // a neckband
  // (a cardigan's ribbed hem, a soft band a shade darker round the bottom of the body)
  if (outfit === "cardigan" && chibi) extras.rings([{ y: -0.056, rx: 0.162 * wide, rz: 0.128 }, { y: -0.05, rx: 0.171 * wide, rz: 0.136 }, { y: -0.02, rx: 0.176 * wide, rz: 0.14 }, { y: -0.012, rx: 0.172 * wide, rz: 0.137 }], bseg, tone(main, -0.3), { caps: false, smooth: true });
  if (outfit === "vest" && !chibi) {
    for (const k of [-1, 1]) extras.box([k * 0.03, neckUp * 0.45, 0.118], [0.012, neckUp * 0.8, 0.012], tone(main, -0.9), { flat: true });
    for (let i = 0; i < 3; i++) extras.box([0, neckUp * (0.2 + i * 0.22), 0.124], [0.022, 0.022, 0.012], pal.gold!, { flat: true });
  }
  if (metal) {
    for (const k of [-1, 1]) extras.blob([k * (shoulder + 0.01), neckUp * 0.9, 0], [0.085, 0.06, 0.085], "#9aa1ae", () => 0.5, { seg: 7, rows: 3, jitter: 0, tones: 0 });
    extras.box([0, neckUp * 0.55, 0.12], [0.12, 0.16, 0.02], main, { taper: [0.5, 1], rx: 180, flat: true });
  }
  // ---- a chibi's clothes, painted flat on the front: the outfit's buttons, opening or placket, an `emblem` on the chest, an apron
  const painted: Painted[] = [];
  let torsoPaint: Mesh3 | undefined, hipsPaint: Mesh3 | undefined;
  if (chibi) {
    const torsoInks: Ink[] = [], hipsInks: Ink[] = [];
    const n = neckUp, W = wide;
    const button = (x: number, y: number, c = pal.gold!) => {
      torsoInks.push({ color: rgbOf(tone(c, -0.8)), d: sd.circle(x, y, 0.0115) });
      torsoInks.push({ color: rgbOf(c), d: sd.circle(x, y, 0.0085) });
    };
    if (outfit === "tunic") {
      torsoInks.push({ color: rgbOf(tone(main, -0.7)), d: sd.stroke([[0, n * 0.84], [0, -0.06]], 0.004) });
      for (const y of [0.62, 0.38, 0.14]) button(0.022, n * y);
    } else if (outfit === "shirt") {
      torsoInks.push({ color: rgbOf(tone(main, -0.8)), d: sd.stroke([[-0.045, n * 0.9], [0, n * 0.7], [0.045, n * 0.9]], 0.005) });
      for (const y of [0.55, 0.32]) button(0, n * y, cloth);
    } else if (outfit === "vest") {
      // open down the front over a shirt
      torsoInks.push({ color: rgbOf(cloth), d: sd.shape([[-0.05, n * 0.95], [0.05, n * 0.95], [0, n * 0.3]]) });
      for (const y of [0.24, 0.06]) button(0, n * y);
    } else if (outfit === "cardigan") {
      // a soft knitted cardigan buttoned over a shirt: a deep V at the neck, the shirt's collar folded out over it, wooden buttons
      // down the front edge (the ribbed hem is a band of its own)
      const edge = rgbOf(tone(main, -0.75)), shirtEdge = rgbOf(tone(cloth, -1.0));
      const vee = sd.shape([[-0.056, n * 1.0], [0.056, n * 1.0], [0, n * 0.44]]);
      torsoInks.push({ color: edge, d: (x, y) => vee(x, y) - 0.0045 });
      torsoInks.push({ color: rgbOf(cloth), d: vee });
      torsoInks.push({ color: edge, d: sd.stroke([[0, n * 0.44], [0, -0.06]], 0.0045) });
      for (const k of [-1, 1]) {
        const wing = sd.shape([[k * 0.006, n * 0.9], [k * 0.062, n * 1.0], [k * 0.05, n * 0.72]]);
        torsoInks.push({ color: shirtEdge, d: (x, y) => wing(x, y) - 0.0035 });
        torsoInks.push({ color: rgbOf(cloth), d: wing });
      }
      // (no pockets: every painted edge shows as a pale line at the game's distance, and the front is busy enough)
      for (const y of [0.36, 0.2, 0.04]) button(0, n * y, "#b98a58");
    }
    const emblem = choice(a.emblem, CHARACTER3D.emblems, "emblem");
    if (emblem !== "none") {
      const ex = -0.068 * W, ey = n * 0.6, e = 0.03;
      const ink = rgbOf(tone(main, -1.1)), light = rgbOf(emblem === "leaf" ? "#7fb35a" : emblem === "heart" ? "#e8606a" : emblem === "envelope" ? "#f6efe0" : "#ffd45c");
      if (emblem === "envelope") {
        const card = sd.shape([[ex - e, ey - e * 0.68], [ex + e, ey - e * 0.68], [ex + e, ey + e * 0.68], [ex - e, ey + e * 0.68]]);
        torsoInks.push({ color: ink, d: (x, y) => card(x, y) - 0.003 });
        torsoInks.push({ color: light, d: card });
        torsoInks.push({ color: ink, d: sd.stroke([[ex - e * 0.92, ey + e * 0.6], [ex, ey - e * 0.05], [ex + e * 0.92, ey + e * 0.6]], 0.0028) });
      } else {
        const shapeOf = emblem === "star"
          ? sd.shape(Array.from({ length: 10 }, (_, i) => { const r = i % 2 ? e * 0.45 : e, t = Math.PI / 2 + (i * Math.PI) / 5; return [ex + Math.cos(t) * r, ey + Math.sin(t) * r] as [number, number]; }))
          : emblem === "bolt" ? sd.shape([[ex + e * 0.25, ey + e], [ex - e * 0.55, ey - e * 0.1], [ex - e * 0.02, ey - e * 0.1], [ex - e * 0.3, ey - e], [ex + e * 0.55, ey + e * 0.12], [ex + e * 0.02, ey + e * 0.12]])
          : emblem === "heart" ? sd.union(sd.circle(ex - e * 0.45, ey + e * 0.25, e * 0.5), sd.circle(ex + e * 0.45, ey + e * 0.25, e * 0.5), sd.shape([[ex - e * 0.92, ey + e * 0.1], [ex + e * 0.92, ey + e * 0.1], [ex, ey - e * 0.95]]))
          : sd.union(sd.ellipse(ex, ey, e * 0.5, e * 0.95, -0.6), sd.stroke([[ex + e * 0.55, ey - e * 0.75], [ex, ey]], 0.003));
        torsoInks.push({ color: ink, d: (x, y) => shapeOf(x, y) - 0.0035 });
        torsoInks.push({ color: light, d: shapeOf });
      }
    }
    if (accessory === "apron") {
      // a carpenter's canvas apron: a bib on straps round the neck, a pocket with a pencil in it, the skirt of it over the belt
      const ap = col(a.accent_color, "accent_color", "#e2cd9a"), edge = rgbOf(tone(ap, -0.9));
      const bib = sd.shape([[-0.075 * W, n * 0.7], [0.075 * W, n * 0.7], [0.13 * W, -0.08], [-0.13 * W, -0.08]]);
      torsoInks.push({ color: edge, d: (x, y) => bib(x, y) - 0.004 });
      torsoInks.push({ color: rgbOf(ap), d: bib });
      for (const k of [-1, 1]) torsoInks.push({ color: edge, d: sd.stroke([[k * 0.066 * W, n * 0.69], [k * 0.05, n * 0.97]], 0.006) });
      const pocket = sd.shape([[-0.075 * W, n * 0.32], [0.075 * W, n * 0.32], [0.08 * W, n * 0.06], [-0.08 * W, n * 0.06]]);
      torsoInks.push({ color: rgbOf("#f2c641"), d: sd.stroke([[0.04 * W, n * 0.2], [0.055 * W, n * 0.42]], 0.0055) }); // the pencil
      torsoInks.push({ color: rgbOf("#3a3030"), d: sd.stroke([[0.054 * W, n * 0.4], [0.057 * W, n * 0.44]], 0.003) });
      torsoInks.push({ color: edge, d: (x, y) => pocket(x, y) - 0.003 });
      torsoInks.push({ color: rgbOf(tone(ap, -0.25)), d: pocket });
      torsoInks.push({ color: edge, d: sd.stroke([[-0.07 * W, n * 0.28], [0.07 * W, n * 0.28]], 0.0022) });
      const skirtOf = sd.shape([[-0.135 * W, 0.1], [0.135 * W, 0.1], [0.15 * W, -0.2], [-0.15 * W, -0.2]]);
      hipsInks.push({ color: edge, d: (x, y) => skirtOf(x, y) - 0.004 });
      hipsInks.push({ color: rgbOf(ap), d: skirtOf });
    }
    const lay = (name: string, on: Mesh3[], box: [number, number, number, number], inks: Ink[], bleed: Rgb): Mesh3 | undefined => {
      if (!inks.length) return undefined;
      const d = decalOver(trianglesOf(on), box, 0.01, 0.0025, (x, y, r) => reaches(inks, x, y, r * 1.5));
      if (!d) return undefined;
      painted.push({ name, design: d.design, inks, bleed });
      return new Mesh3("#ffffff", { bend: false, name, texture: 16 }).add(d.mesh);
    };
    torsoPaint = lay("body_paint", [torso], [-0.22, 0.22, -0.08, neckUp], torsoInks, rgbOf(main));
    hipsPaint = lay("hips_paint", [pelvis, skirt, belt], [-0.22, 0.22, -0.2, 0.12], hipsInks, rgbOf(main));
  }

  // ---- the head
  const head = new Mesh3(skin, { bend: false });
  head.rings([{ y: -0.03, rx: 0.058, rz: 0.055 }, { y: 0.05, rx: 0.055, rz: 0.052 }], 8, tone(skin, -0.3), { smooth: true });
  const face = new Mesh3("#2a2430", { bend: false });
  const faceParts: Args[] = [];
  // (an animal's ears, each a part of the head with its pivot at the ear's root, so a game can let them follow the body's motion)
  const earParts: Args[] = [];
  // (an animal's: the height of the top of its head over x, z; where its face is; the head's painted decal)
  let headTop = (_x: number, _z: number) => headC + headR[1];
  let headFront = (_x: number, _y: number) => headR[2];
  let faceL: FaceLayout | undefined;
  let headPaint: Mesh3 | undefined;
  if (!animal) {
    const hr: { y: number; rx: number; rz: number }[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = -Math.PI / 2 + (Math.PI * i) / 6;
      // (a jaw a little narrower than the brow)
      hr.push({ y: headC + Math.sin(t) * headR[1], rx: Math.max(0, Math.cos(t)) * headR[0] * (i < 3 ? 0.9 : 1), rz: Math.max(0, Math.cos(t)) * headR[2] * (i < 3 ? 0.94 : 1) });
    }
    head.rings(hr, 10, skin, { smooth: true });
    const eyeY = headC - 0.008, eyeZ = headR[2] * 0.93;
    for (const k of [-1, 1]) {
      face.box([k * 0.047 * headK, eyeY, eyeZ - 0.012], [0.03, 0.046, 0.02], "#2a2430", { flat: true, ry: k * 20 });
      face.box([k * 0.047 * headK + 0.006, eyeY + 0.012, eyeZ - 0.003], [0.01, 0.013, 0.008], "#ffffff", { flat: true, ry: k * 20 });
      face.box([k * (headR[0] * 0.98), headC - 0.01, 0], [0.03, 0.05, 0.035], tone(skin, -0.25), { flat: true });
    }
    face.box([0, headC - 0.04, headR[2] * 0.97], [0.022, 0.026, 0.024], tone(skin, -0.3), { flat: true });
  } else animalHead();

  // An animal's head: round and smooth (a chibi's squashed wider than tall, its top and bottom flattened a little like a soft toy's),
  // ears and a snout or muzzle where the species has one, and the face painted on it (face3d.ts, decal3d.ts): the eyes, brows and
  // mouth are decals, one part each of every drawing of their set, the nose and the species' patches one decal in the head itself.
  function animalHead(): void {
    const RX = headR[0], RY = headR[1], RZ = headR[2];
    const ne = chibi ? 2.6 : 2.1; // (2 is a plain ellipsoid; more is squarer at the top and bottom)
    const rows = 26, seg = 44;
    const shell = new Mesh3(skin, { bend: false });
    const ring: { y: number; rx: number; rz: number }[] = [];
    for (let i = 0; i <= rows; i++) {
      const t = -Math.PI / 2 + (Math.PI * i) / rows, s = Math.sin(t), c = Math.abs(Math.cos(t));
      const r = c < 1e-9 ? 0 : c ** (2 / ne);
      ring.push({ y: headC + Math.sign(s) * Math.abs(s) ** (2 / ne) * RY, rx: r * RX, rz: r * RZ });
    }
    // the face's layout and its paint that does not change (the nose, the species' patches), first: the head's own fur is the lighter
    // one under a light patch (a fox's cheeks), so that where the decal cannot reach (a crease beside the snout, under the chin) the
    // head shows the same colour as the paint
    const L = faceLayout(species, RX, RY, headC);
    faceL = L;
    const colours: FaceColours = {
      ink: "#2a2027", brow: species === "badger" ? fur2 : species === "rabbit" || species === "cat" ? tone(skin, -1.3) : tone(furDark, 0.2), fur: skin, fur2, dark: furDark,
      mouth: "#5a2228", tongue: "#e8838a", blush: "#f4a3a8", nose: species === "rabbit" || species === "cat" ? "#e8858f" : "#2e2226",
    };
    const statics = staticInks(species, L, colours, RX, RY, headC);
    const light = rgbOf(fur2);
    const under = statics.filter((k) => k.color.every((v, i) => v === light[i]));
    shell.rings(ring, seg, (i, j) => {
      const a = ((j + 0.5) / seg) * Math.PI * 2, fwd = Math.sin(a);
      // (a badger is white in front, grey behind)
      if (species === "badger" && fwd > -0.15) return fur2;
      const n = ring[Math.min(i + 1, rows)]!, r = (ring[i]!.rx + n.rx) / 2 / RX, y = (ring[i]!.y + n.y) / 2;
      return fwd > 0.2 && under.some((k) => k.d(Math.cos(a) * r * RX, y) < -0.01) ? fur2 : skin;
    }, { smooth: true });
    head.add(shell);
    headTop = (x, z) => headC + RY * Math.max(0, 1 - Math.min(1, Math.hypot(x / RX, z / RZ)) ** ne) ** (1 / ne);
    // the snout (fox, badger) or the muzzle (bear): a smooth rounded bump in the lighter fur
    const muzzle = new Mesh3(fur2, { bend: false });
    const ellipsoid = (m: Mesh3, c: V3, r: V3, color: string) => {
      const rs: { y: number; rx: number; rz: number }[] = [];
      for (let i = 0; i <= 16; i++) { const t = -Math.PI / 2 + (Math.PI * i) / 16; rs.push({ y: Math.sin(t) * r[1], rx: Math.cos(t) * r[0], rz: Math.cos(t) * r[2] }); }
      m.rings(rs, 32, color, { at: c, smooth: true });
    };
    if (species === "fox" || species === "badger") ellipsoid(muzzle, [0, headC - 0.3 * RY, RZ * 0.7], [0.28 * RX, 0.24 * RY, 0.4 * RZ], fur2);
    else if (species === "bear") ellipsoid(muzzle, [0, headC - 0.34 * RY, RZ * 0.7], [0.34 * RX, 0.27 * RY, 0.4 * RZ], fur2);
    head.add(muzzle);
    const surface = trianglesOf([shell, muzzle]);
    headFront = (x, y) => frontHit(surface, x, y)?.p[2] ?? RZ;
    // the ears, on the head's top, leaning out
    const ear = (k: number, xf: number, h: number, w: number, d: number, lean: number, tipC: string, inner?: string) => {
      const at: V3 = [k * xf * RX, headTop(k * xf * RX, -0.06 * RZ) - 0.03 * RY, -0.06 * RZ];
      const shape = (sc: number) => [{ y: 0, rx: w * sc, rz: d * sc }, { y: h * 0.42, rx: w * 1.04 * sc, rz: d * sc, cx: k * h * 0.42 * lean }, { y: h * 0.8, rx: w * 0.6 * sc, rz: d * 0.8 * sc, cx: k * h * 0.8 * lean }, { y: h, rx: 0, cx: k * h * lean }];
      const m = new Mesh3(skin, { bend: false });
      m.rings(shape(1), 12, (i) => (i >= 2 ? tipC : skin), { smooth: true });
      if (inner) m.rings(shape(0.6).map((r) => ({ ...r, y: r.y * 0.88 })), 12, inner, { at: [k * 0.004, 0.012, d * 0.5], smooth: true });
      earParts.push(part(k > 0 ? "ear_l" : "ear_r", at, [m]));
    };
    const roundEar = (k: number, xf: number, r: number, inner: string) => {
      const x = k * xf * RX, at: V3 = [x, headTop(x, -0.1 * RZ) - 0.02 * RY, -0.1 * RZ];
      const m = new Mesh3(skin, { bend: false });
      ellipsoid(m, [0, 0, 0], [r, r, r * 0.5], skin);
      ellipsoid(m, [0, r * 0.02, r * 0.32], [r * 0.6, r * 0.6, r * 0.22], inner);
      earParts.push(part(k > 0 ? "ear_l" : "ear_r", at, [m]));
    };
    const hatted = hat === "cap" || hat === "peaked" || hat === "straw" || hat === "wizard" || hat === "bucket" || hat === "round";
    for (const k of [-1, 1]) {
      if (species === "fox") ear(k, hatted ? 0.66 : 0.5, 0.52 * RX, 0.22 * RX, 0.09 * RX, hatted ? 0.42 : 0.24, furDark, fur2);
      else if (species === "cat") ear(k, hatted ? 0.62 : 0.52, 0.4 * RX, 0.22 * RX, 0.08 * RX, hatted ? 0.4 : 0.2, skin, "#e9b9b6");
      else if (species === "rabbit") ear(k, 0.3, 1.05 * RX, 0.17 * RX, 0.07 * RX, 0.12, tone(skin, -0.15), "#efb3ae");
      else roundEar(k, species === "badger" ? 0.72 : 0.62, (species === "badger" ? 0.15 : 0.2) * RX, species === "badger" ? furDark : tone(fur2, -0.2));
    }
    // the face, painted
    const FEATURE = 32, PAINT = 16; // texels a model unit (16 to the metre): 512 and 256 a metre
    const pd = decalOver(surface, L.boxes.paint, 0.008, 0.0025, (x, y, r) => reaches(statics, x, y, r * 1.5));
    if (pd) {
      headPaint = new Mesh3("#ffffff", { bend: false, name: "face_paint", texture: PAINT }).add(pd.mesh);
      painted.push({ name: "face_paint", design: pd.design, inks: statics, bleed: rgbOf(fur2) });
    }
    for (const [set, names] of Object.entries(FACE_SETS) as [keyof typeof FACE_SETS, readonly string[]][]) {
      const all = names.map((n) => faceInks(n, L, colours, species));
      const box = set === "eyes" ? L.boxes.eyes : set === "brows" ? L.boxes.brows : L.boxes.mouth;
      const made = decalOver(surface, box, 0.008, 0.005, (x, y, r) => all.some((list) => reaches(list, x, y, r * 1.5)));
      if (!made) continue;
      names.forEach((n, i) => {
        const m = new Mesh3("#ffffff", { bend: false, name: n, texture: FEATURE }).add(made.mesh);
        const p = part(n, [0, 0, 0], [m]);
        if (!FIRSTS.has(n)) p.hidden = true;
        faceParts.push(p);
        painted.push({ name: n, design: made.design, inks: all[i]!, bleed: set === "brows" ? rgbOf(colours.brow) : rgbOf(colours.ink) });
      });
    }
  }


  const hairM = new Mesh3(hairC, { bend: false });
  const hooded = hat === "hood", helmeted = hat === "helmet";
  if (hair !== "bald" && !hooded && !helmeted) {
    const g = 0.014;
    // a cap of hair: over the top, down the back and sides, its front edge above the brow
    hairM.rings(
      [
        { y: headC + headR[1] + g, rx: 0 }, { y: headC + headR[1] * 0.86, rx: headR[0] * 0.62, rz: headR[2] * 0.62 }, { y: headC + headR[1] * 0.5, rx: headR[0] * 0.98 + g, rz: headR[2] * 0.96 + g },
        { y: headC + headR[1] * 0.2, rx: headR[0] * 1.02 + g, rz: headR[2] * 0.82, cz: -0.036 }, { y: headC - headR[1] * 0.3, rx: headR[0] * 0.98 + g, rz: headR[2] * 0.6, cz: -0.066 },
        { y: headC - headR[1] * (hair === "long" ? 0.95 : 0.62), rx: headR[0] * 0.8, rz: headR[2] * 0.42, cz: -0.078 },
      ],
      10, (i) => tone(hairC, i < 2 ? 0.45 : i > 3 ? -0.5 : 0), { smooth: true },
    );
    // a fringe across the brow
    hairM.box([0.012, headC + headR[1] * 0.47, headR[2] * 0.83], [headR[0] * 1.45, 0.05, 0.028], tone(hairC, 0.2), { rx: -14, rz: -9, taper: [0.9, 1] });
    if (hair === "long") hairM.rings([{ y: headC - headR[1] * 0.3, rx: headR[0] * 0.95, rz: 0.06, cz: -0.085 }, { y: -0.02, rx: headR[0] * 0.86, rz: 0.05, cz: -0.1 }, { y: -0.13, rx: headR[0] * 0.6, rz: 0.035, cz: -0.1 }], 8, (i) => tone(hairC, -0.3 - i * 0.2), { smooth: true });
    if (hair === "bun") hairM.blob([0, headC + headR[1] * 0.78, -headR[2] * 0.62], [0.06, 0.055, 0.06], tone(hairC, 0.15), () => 0.5, { seg: 7, rows: 3, jitter: 0, tones: 0 });
    if (hair === "ponytail") hairM.tube([[0, headC + headR[1] * 0.35, -headR[2] * 0.98], [0, headC, -headR[2] * 1.3], [0, headC - 0.16, -headR[2] * 1.25]], [0.04, 0.045, 0.012], 6, tone(hairC, -0.2), { smooth: true });
    if (hair === "spiky") {
      for (let i = 0; i < 7; i++) {
        const an = (i / 7) * Math.PI * 2 + rand() * 0.5, d = i === 0 ? 0 : headR[0] * 0.55;
        hairM.rings([{ y: 0, rx: 0.042 }, { y: 0.1 + rand() * 0.04, rx: 0, cx: Math.cos(an) * 0.03, cz: Math.sin(an) * 0.03 - 0.01 }], 4, tone(hairC, 0.3 + rand() * 0.4), { at: [Math.cos(an) * d, headC + headR[1] * 0.8, Math.sin(an) * d * 0.9 - 0.01], turn: rand() });
      }
    }
  }
  const hatM = new Mesh3(trim, { bend: false, ...(helmeted ? { metallic: 0.6, roughness: 0.45 } : {}) });
  const crownY = headC + headR[1] * 0.42;
  if (hat === "cap") {
    hatM.rings([{ y: crownY, rx: headR[0] + 0.03, rz: headR[2] + 0.03 }, { y: crownY + 0.07, rx: headR[0] + 0.02, rz: headR[2] + 0.02 }, { y: crownY + 0.115, rx: headR[0] * 0.7, rz: headR[2] * 0.7 }], 10, (i) => tone(main, i ? 0.2 : -0.3), { smooth: true });
    hatM.box([0, crownY + 0.012, headR[2] + 0.07], [0.19, 0.022, 0.13], tone(main, -0.5), { taper: [0.8, 0.7] });
  } else if (hat === "peaked") {
    // a uniform's peaked cap (a postman's, a conductor's): a flat round crown over a band, a short dark peak, a badge
    // (it sits on the top of the head, smaller than the head, so that an animal's ears stand out beside it)
    // (on a squashed head it is a small cap perched on the top, the ears standing up beside it)
    const R0 = headR[0] * (squash ? 0.6 : animal ? 0.84 : 1), RZ0 = headR[2] * (squash ? 0.66 : animal ? 0.88 : 1);
    const cy = squash ? headTop(0, 0) - headR[1] * 0.2 : crownY + (animal ? headR[1] * 0.12 : 0), ch = squash ? headR[1] * 0.42 / 0.118 : hs;
    hatM.rings([{ y: cy - 0.01, rx: R0 * 0.98 + 0.012, rz: RZ0 * 0.98 + 0.012 }, { y: cy + 0.05 * ch, rx: R0 + 0.02, rz: RZ0 + 0.02 }, { y: cy + 0.1 * ch, rx: R0 * 1.12 + 0.02, rz: RZ0 * 1.1 + 0.02, cz: 0.01 }, { y: cy + 0.115 * ch, rx: R0 * 1.05, rz: RZ0 * 1.03, cz: 0.01 }, { y: cy + 0.118 * ch, rx: 0, cz: 0.01 }], squash ? 28 : 12, (i) => (i === 0 ? tone(main, -0.9) : tone(main, i >= 3 ? 0.3 : 0)), { smooth: true });
    hatM.box([0, cy + 0.0, RZ0 + 0.04 * ch], [R0 * 1.25, 0.016, 0.09 * ch], "#1f2128", { taper: [0.75, 0.6], rx: 14 });
    hatM.box([0, cy + 0.055 * ch, RZ0 + 0.025], [0.05 * ch, 0.045 * ch, 0.012], pal.gold!, { flat: true });
  } else if (hat === "bucket" || hat === "round") {
    // soft hats for a village: a bucket hat (a round soft crown, a brim turned down all round) or a round cap (a soft dome with a
    // short rounded peak); `hat_pin` is pinned on the front. On a squashed animal head it sits on the top between the ears.
    const R0 = headR[0] * (squash ? 0.62 : animal ? 0.86 : 1.02), RZ0 = headR[2] * (squash ? 0.68 : animal ? 0.9 : 1.02);
    const cy = squash ? headTop(0, 0) - headR[1] * 0.24 : crownY - 0.01, ch = squash ? headR[1] * 0.42 / 0.118 : hs;
    const lo = tone(hatC, -0.25), hi = tone(hatC, 0.2);
    if (hat === "bucket") {
      hatM.rings([{ y: cy, rx: R0 + 0.01, rz: RZ0 + 0.01 }, { y: cy + 0.06 * ch, rx: R0 * 0.97, rz: RZ0 * 0.97 }, { y: cy + 0.095 * ch, rx: R0 * 0.82, rz: RZ0 * 0.82 }, { y: cy + 0.11 * ch, rx: R0 * 0.5, rz: RZ0 * 0.5 }, { y: cy + 0.114 * ch, rx: 0 }], squash ? 28 : 14, (i) => (i >= 2 ? hi : hatC), { smooth: true });
      // the brim: a thick soft ring sloping down and out, its edge rounded
      const b = 1.42, t = 0.012 * ch;
      hatM.rings([{ y: cy + 0.012 * ch, rx: R0 + 0.006, rz: RZ0 + 0.006 }, { y: cy - 0.016 * ch, rx: R0 * b, rz: RZ0 * b }, { y: cy - 0.024 * ch, rx: R0 * b + 0.006, rz: RZ0 * b + 0.006 }, { y: cy - 0.032 * ch, rx: R0 * b, rz: RZ0 * b }, { y: cy - 0.004 * ch - t, rx: R0 - 0.004, rz: RZ0 - 0.004 }], squash ? 28 : 14, (i) => (i >= 2 ? lo : hatC), { smooth: true, caps: false });
      // a band round the crown
      hatM.rings([{ y: cy + 0.004 * ch, rx: R0 + 0.014, rz: RZ0 + 0.014 }, { y: cy + 0.026 * ch, rx: R0 * 0.995 + 0.012, rz: RZ0 * 0.995 + 0.012 }], squash ? 28 : 14, tone(hatC, -0.6), { smooth: true, caps: false });
    } else {
      hatM.rings([{ y: cy - 0.006, rx: R0 + 0.014, rz: RZ0 + 0.014 }, { y: cy + 0.04 * ch, rx: R0 * 1.04 + 0.012, rz: RZ0 * 1.04 + 0.012 }, { y: cy + 0.085 * ch, rx: R0 * 0.86, rz: RZ0 * 0.86 }, { y: cy + 0.108 * ch, rx: R0 * 0.45, rz: RZ0 * 0.45 }, { y: cy + 0.112 * ch, rx: 0 }], squash ? 28 : 14, (i) => (i >= 2 ? hi : hatC), { smooth: true });
      // a little button on top, and a short soft peak
      ellipsoid(hatM, [0, cy + 0.112 * ch, 0], [0.012 * ch, 0.008 * ch, 0.012 * ch], lo, 10, 6);
      hatM.rings([{ y: -0.007 * ch, rx: R0 * 0.62, rz: 0.05 * ch }, { y: 0.0, rx: R0 * 0.64, rz: 0.052 * ch }, { y: 0.007 * ch, rx: R0 * 0.6, rz: 0.048 * ch }], 20, lo, { at: [0, cy + 0.004 * ch, RZ0 - 0.008 * ch], smooth: true });
    }
    if (hatPin !== "none") {
      // a small enamel pin on the front of the crown
      const pz = (hat === "bucket" ? RZ0 * 0.99 : RZ0 * 1.04) + 0.012, py = cy + 0.045 * ch, e = 0.016 * ch;
      if (hatPin === "envelope") {
        hatM.box([0, py, pz], [e * 2.2, e * 1.5, 0.008], "#f6efe0", { flat: true });
        for (const k of [-1, 1]) hatM.box([k * e * 0.5, py + e * 0.25, pz + 0.0045], [e * 1.25, 0.0035, 0.002], "#a23c31", { rz: k * 30, flat: true });
      } else {
        const pinC = hatPin === "leaf" ? "#7fb35a" : hatPin === "heart" ? "#e8606a" : "#ffd45c";
        ellipsoid(hatM, [0, py, pz], [e, e, 0.005], pinC, 12, 6);
      }
    }
  } else if (hat === "wizard") {
    hatM.rings([{ y: crownY - 0.01, rx: 0.27 }, { y: crownY + 0.02, rx: 0.26 }], 12, (_, j) => tone(main, -0.4 + Math.cos((j / 12) * 6.283) * 0.3));
    hatM.rings([{ y: crownY + 0.01, rx: headR[0] + 0.03 }, { y: crownY + 0.2, rx: 0.08, cz: -0.02 }, { y: crownY + 0.4, rx: 0, cx: 0.02, cz: -0.09 }], 10, (i) => tone(main, i ? 0.25 : -0.1), { smooth: true });
    hatM.rings([{ y: crownY + 0.02, rx: headR[0] + 0.036 }, { y: crownY + 0.055, rx: headR[0] + 0.022 }], 10, trim, { caps: false });
  } else if (hat === "straw") {
    const straw = "#e3c878";
    hatM.rings([{ y: crownY - 0.012, rx: 0.3 }, { y: crownY + 0.012, rx: 0.29 }], 12, (_, j) => tone(straw, -0.3 + Math.cos((j / 12) * 6.283) * 0.35));
    hatM.rings([{ y: crownY + 0.01, rx: headR[0] + 0.03 }, { y: crownY + 0.1, rx: headR[0] * 0.92 }, { y: crownY + 0.13, rx: headR[0] * 0.6 }], 10, (i) => tone(straw, i ? 0.3 : 0), { smooth: true });
    hatM.rings([{ y: crownY + 0.016, rx: headR[0] + 0.036 }, { y: crownY + 0.05, rx: headR[0] + 0.03 }], 10, main, { caps: false });
  } else if (hooded) {
    const g = 0.022;
    hatM.rings(
      [
        { y: headC + headR[1] + g + 0.02, rx: 0, cz: -0.03 }, { y: headC + headR[1] * 0.8, rx: headR[0] * 0.72, rz: headR[2] * 0.7, cz: -0.012 }, { y: headC + headR[1] * 0.35, rx: headR[0] + g, rz: headR[2] * 0.98, cz: -0.022 },
        { y: headC - headR[1] * 0.25, rx: headR[0] + g, rz: headR[2] * 0.8, cz: -0.05 }, { y: headC - headR[1] * 0.85, rx: headR[0] * 1.05, rz: headR[2] * 0.75, cz: -0.04 }, { y: -0.03, rx: 0.15, rz: 0.11, cz: -0.012 },
      ],
      10, (i) => tone(main, i < 2 ? 0.3 : i > 3 ? -0.4 : 0), { smooth: true },
    );
  } else if (helmeted) {
    const steel = "#aab1bd";
    hatM.rings([{ y: headC + headR[1] + 0.02, rx: 0 }, { y: headC + headR[1] * 0.75, rx: headR[0] * 0.75 }, { y: headC + headR[1] * 0.2, rx: headR[0] + 0.02, rz: headR[2] + 0.02 }, { y: headC - headR[1] * 0.05, rx: headR[0] + 0.024, rz: headR[2] * 0.92, cz: -0.02 }, { y: headC - headR[1] * 0.5, rx: headR[0] + 0.02, rz: headR[2] * 0.6, cz: -0.06 }], 10, (i) => tone(steel, i < 2 ? 0.5 : -0.1), { smooth: true });
    hatM.box([0, headC + 0.01, headR[2] + 0.012], [0.026, 0.1, 0.02], tone(steel, -0.5), { flat: true });
    hatM.rings([{ y: headC + headR[1] * 0.16, rx: headR[0] + 0.03, rz: headR[2] + 0.03 }, { y: headC + headR[1] * 0.28, rx: headR[0] + 0.026, rz: headR[2] + 0.026 }], 10, tone(steel, -0.7), { caps: false });
  }

  // ---- what is carried
  const packM = new Mesh3(trim, { bend: false });
  if (pack === "backpack") {
    const leather = blend(trim, "#9a6a3c", 0.5);
    packM.box([0, neckUp * 0.5, -0.17], [0.24 * wide, 0.27, 0.13], leather, { taper: [0.9, 0.85] });
    packM.box([0, neckUp * 0.72, -0.172], [0.25 * wide, 0.1, 0.14], tone(leather, 0.45), { taper: [0.92, 0.9] });
    packM.box([0, neckUp * 0.58, -0.24], [0.04, 0.05, 0.015], pal.gold!, { flat: true });
    packM.tube([[-0.1 * wide, neckUp * 0.95, -0.2], [0.1 * wide, neckUp * 0.95, -0.2]], 0.048, 7, cloth, { ends: tone(cloth, -0.6) }); // a bedroll
    for (const k of [-1, 1]) {
      packM.box([k * 0.1 * wide, neckUp * 0.66, 0.0], [0.03, neckUp * 0.5, 0.25], tone(leather, -0.5), { flat: true });
    }
  } else if (pack === "quiver") {
    const leather = blend(trim, "#7a4a2c", 0.5);
    packM.tube([[0.1, neckUp * 0.2, -0.14], [-0.1, neckUp * 1.02, -0.15]], [0.045, 0.055], 7, leather, { ends: tone(leather, -1) });
    for (let i = 0; i < 3; i++) {
      const o = (i - 1) * 0.022;
      packM.box([-0.115 + o, neckUp * 1.09, -0.15 + o * 0.5], [0.012, 0.12, 0.012], "#d9c39a", { rz: 14, flat: true });
      packM.box([-0.125 + o, neckUp * 1.14, -0.15 + o * 0.5], [0.04, 0.05, 0.008], pick3(i), { rz: 14, flat: true });
    }
    packM.box([0, neckUp * 0.62, 0.0], [0.03, neckUp * 0.9, 0.25], tone(leather, -0.4), { rz: -52, flat: true });
  } else if (pack === "cape") {
    const m = packM;
    const top = neckUp * 0.92, down = -(thigh * 0.7) - spineUp;
    const a0 = m.v(-0.17 * wide, top, -0.1), a1 = m.v(0.17 * wide, top, -0.1), b0 = m.v(-0.21 * wide, (top + down) / 2, -0.17), b1 = m.v(0.21 * wide, (top + down) / 2, -0.17), c0 = m.v(-0.2 * wide, down, -0.2), c1 = m.v(0.2 * wide, down, -0.2);
    const f0 = m.v(-0.17 * wide, top, -0.125), f1 = m.v(0.17 * wide, top, -0.125), g0 = m.v(-0.21 * wide, (top + down) / 2, -0.195), g1 = m.v(0.21 * wide, (top + down) / 2, -0.195), h0 = m.v(-0.2 * wide, down, -0.225), h1 = m.v(0.2 * wide, down, -0.225);
    const mid: V3 = [0, (top + down) / 2, -0.17];
    const inside = (z: number): V3 => [0, mid[1], z];
    m.face([a0, a1, b1, b0], tone(trim, -0.6), inside(-0.3)).face([b0, b1, c1, c0], tone(trim, -0.8), inside(-0.3));
    m.face([f0, f1, g1, g0], trim, inside(0)).face([g0, g1, h1, h0], tone(trim, -0.3), inside(0));
    m.face([a0, b0, g0, f0], trim, mid).face([b0, c0, h0, g0], trim, mid).face([a1, b1, g1, f1], trim, mid).face([b1, c1, h1, g1], trim, mid).face([c0, c1, h1, h0], trim, mid).face([a0, a1, f1, f0], trim, mid);
    m.rings([{ y: top - 0.02, rx: 0.19 * wide, rz: 0.125 }, { y: top + 0.03, rx: 0.12, rz: 0.1 }], 10, tone(trim, 0.2), { caps: false, smooth: true });
  }
  function pick3(i: number): string {
    return [pal.flower!, pal.flower3!, pal.flower2!][i % 3]!;
  }

  const itemM = new Mesh3("#c8ccd4", { bend: false });
  const glow = new Mesh3("#ffd98a", { bend: false, emissive: 1 });
  const grip: V3 = [0, -0.05, 0];
  if (item === "sword") {
    itemM.box([0, grip[1], 0.0], [0.03, 0.03, 0.15], blend(trim, "#5a3a24", 0.6), { flat: true });
    itemM.box([0, grip[1], 0.085], [0.16, 0.035, 0.03], pal.gold!);
    itemM.box([0, grip[1], 0.36], [0.055, 0.016, 0.52], "#cfd5df", { taper: [1, 1] });
    itemM.box([0, grip[1], 0.645], [0.04, 0.014, 0.06], "#e6ebf2", { ry: 0, taper: [1, 1] });
    itemM.box([0, grip[1], -0.085], [0.045, 0.045, 0.04], pal.gold!, { flat: true });
  } else if (item === "axe") {
    itemM.box([0, grip[1], 0.2], [0.032, 0.032, 0.62], blend(trim, "#7a5230", 0.6), { flat: true });
    itemM.box([0, grip[1] + 0.09, 0.44], [0.022, 0.2, 0.15], "#b9c0cc", { taper: [1, 0.55] });
    itemM.box([0, grip[1] + 0.2, 0.44], [0.012, 0.03, 0.2], "#e1e6ee", { flat: true });
  } else if (item === "staff") {
    const wood = blend(trim, "#7a5230", 0.6);
    itemM.tube([[0, -0.95 * tall + 0.3, 0.02], [0, grip[1], 0.02], [0, 0.62 * tall, 0.02]], [0.02, 0.022, 0.026], 6, wood);
    itemM.tube([[0, 0.62 * tall, 0.02], [0.05, 0.7 * tall, 0.02], [0.02, 0.77 * tall, 0.02]], [0.026, 0.022, 0.012], 6, wood);
    glow.blob([0, 0.7 * tall, 0.02], [0.045, 0.05, 0.045], "#7fe0ff", () => 0.5, { seg: 6, rows: 3, jitter: 0, tones: 0 });
    glow.color = "#7fe0ff";
  } else if (item === "lantern" || item === "torch") {
    if (item === "torch") {
      itemM.tube([[0, grip[1], -0.06], [0, grip[1] + 0.03, 0.3]], [0.018, 0.026], 6, blend(trim, "#7a5230", 0.6));
      glow.rings([{ y: 0, rx: 0.04 }, { y: 0.06, rx: 0.05 }, { y: 0.17, rx: 0 }], 6, (i) => (i ? "#ffb347" : "#ff7a2a"), { at: [0, grip[1] + 0.01, 0.31] });
      glow.color = "#ffb347";
    } else {
      const iron = "#3a3d47";
      itemM.box([0, grip[1] - 0.03, 0], [0.012, 0.07, 0.012], iron, { flat: true });
      itemM.box([0, grip[1] - 0.075, 0], [0.11, 0.02, 0.11], iron, { taper: 0.5 });
      itemM.box([0, grip[1] - 0.225, 0], [0.09, 0.016, 0.09], iron);
      for (const kx of [-1, 1]) for (const kz of [-1, 1]) itemM.box([kx * 0.04, grip[1] - 0.15, kz * 0.04], [0.012, 0.14, 0.012], iron, { flat: true });
      glow.box([0, grip[1] - 0.15, 0], [0.07, 0.13, 0.07], "#ffd98a", { flat: true });
    }
  }

  // ---- an accessory (`accent_color` colours it)
  const accent = col(a.accent_color, "accent_color", accessory === "satchel" ? "#7a4e2c" : accessory === "headphones" ? "#c8463a" : accessory === "glasses" ? "#3e302a" : "#c23b33");
  const bagM = new Mesh3(accent, { bend: false });
  let bagAt: V3 | undefined;
  if (accessory === "satchel") {
    // a strap from the left shoulder across the chest to a bag on the right hip, and back across the back
    for (const zs of [1, -1]) {
      const z = (v: number) => zs * v * (chibi ? 1.2 : 1);
      extras.tube([[0.13 * wide, neckUp * 0.97, z(0.04)], [0.06 * wide, neckUp * 0.74, z(0.128)], [-0.08 * wide, neckUp * 0.4, z(0.122)], [-0.17 * wide, neckUp * 0.08, z(0.118)], [-0.2 * wide, -0.02, z(0.06)]], 0.013, 5, tone(accent, -0.4));
    }
    // (the bag itself is a part of its own hanging from the strap's end, so a game can let it swing)
    bagAt = [-0.215 * wide, 0.02, 0];
    bagM.box([0, -0.09, 0.0], [0.07, 0.19, 0.25], accent, { taper: [1, 0.92] });
    bagM.box([-0.035 * wide, -0.04, 0.0], [0.02, 0.12, 0.26], tone(accent, -0.35), { flat: true });
    bagM.box([-0.045 * wide, -0.07, 0.0], [0.012, 0.03, 0.04], pal.gold!, { flat: true });
  } else if (accessory === "scarf") {
    extras.rings([{ y: neckUp * 0.9, rx: 0.12 * wide, rz: 0.1 }, { y: neckUp * 1.04, rx: 0.095, rz: 0.088 }], 10, accent, { smooth: true });
    extras.box([0.05 * wide, neckUp * 0.72, 0.125], [0.05, 0.16, 0.02], tone(accent, -0.3), { rz: -8 });
  }
  const headExtra = new Mesh3(accent, { bend: false });
  if (accessory === "glasses") {
    const R = headR[0], RZ = headR[2], ey = faceL ? faceL.ey : headC - 0.008, ex = faceL ? faceL.ex : 0.047 * headK;
    const ez = (faceL ? headFront(ex, ey) : RZ * 0.93) + (animal ? 0.02 : 0.03 * hs);
    const r = faceL ? faceL.eh * 1.5 : 0.03 * headK;
    for (const k of [-1, 1]) {
      const ring: V3[] = [];
      for (let i = 0; i <= 12; i++) ring.push([k * ex + Math.cos((i / 12) * Math.PI * 2) * r, ey + Math.sin((i / 12) * Math.PI * 2) * r, ez]);
      headExtra.tube(ring, 0.009 * hs, 4, accent);
      headExtra.box([k * (R * 0.93), ey + r * 0.4, ez * 0.45], [0.012, 0.012, ez * 0.9], accent, { flat: true });
    }
    headExtra.box([0, ey + r * 0.3, ez + 0.004], [ex * 2 - r * 2 + 0.01, 0.012, 0.012], accent, { flat: true });
  } else if (accessory === "headphones" && animal) {
    // a band over the head behind the ears, and a round cup flat against each side
    const zb = -0.32 * headR[2], side = headR[0] * Math.sqrt(1 - (zb / headR[2]) ** 2);
    const band: V3[] = [];
    for (let i = 0; i <= 16; i++) {
      const t = Math.PI * (i / 16), x = Math.cos(t) * (side + 0.012);
      band.push([x, Math.max(headC, headTop(x * 0.97, zb)) + 0.022 * Math.sin(t) + 0.012, zb]);
    }
    headExtra.tube(band, 0.016, 10, "#2e3440", { smooth: true });
    for (const k of [-1, 1]) {
      headExtra.tube([[k * (side - 0.02), headC, zb], [k * (side + 0.03), headC, zb]], 0.068, 20, accent, { smooth: true, ends: tone(accent, -0.5) });
      headExtra.tube([[k * (side + 0.029), headC, zb], [k * (side + 0.04), headC, zb]], 0.045, 20, tone(accent, 0.4), { smooth: true });
    }
  } else if (accessory === "headphones") {
    const R = headR[0] + 0.022, RY = headR[1] + 0.03;
    const band: V3[] = [];
    for (let i = 0; i <= 10; i++) { const t = Math.PI * (i / 10); band.push([Math.cos(t) * R, headC + Math.sin(t) * RY, -0.01]); }
    headExtra.tube(band, 0.011 * hs, 6, "#2e3440", { smooth: true });
    for (const k of [-1, 1]) headExtra.tube([[k * (R - 0.03), headC - 0.03 * hs, 0], [k * (R + 0.035 * hs), headC - 0.03 * hs, 0]], 0.11 * headR[0] * 1.4, 10, accent, { ends: tone(accent, -0.6) });
  }

  // ---- an animal's tail, a part of its own so the clips can swing it
  const tailM = new Mesh3(skin, { bend: false });
  if (species === "fox") tailM.tube([[0, 0.02, 0], [0, -0.06, -0.12], [0, -0.05, -0.3], [0, 0.04, -0.46], [0, 0.12, -0.52]], [0.04, 0.085, 0.1, 0.07, 0.01], chibi ? 16 : 8, (i) => (i >= 3 ? fur2 : skin), { smooth: true });
  else if (species === "cat") tailM.tube([[0, 0, 0], [0, -0.06, -0.15], [0, 0.06, -0.3], [0, 0.26, -0.35], [0, 0.32, -0.3]], [0.03, 0.03, 0.028, 0.025, 0.015], 6, skin, { smooth: true });
  else if (species === "badger") tailM.tube([[0, 0, 0], [0, -0.03, -0.09], [0, -0.07, -0.15]], [0.05, 0.05, 0.015], 6, skin, { smooth: true });
  else if (species === "rabbit") ellipsoid(tailM, [0, 0, -0.03], [0.07, 0.07, 0.065], fur2, 18, 10);
  else if (species === "bear") ellipsoid(tailM, [0, 0, -0.02], [0.05, 0.05, 0.04], skin, 16, 8);

  // ---- the parts
  const side = (name: string, k: number) => {
    const s = k > 0 ? "l" : "r";
    const held = k < 0 ? [itemM, glow] : [];
    if (name === "arm") {
      return part(`arm_${s}`, [k * shoulder, neckUp * (chibi ? 0.8 : 0.86), 0], [chibi ? chibiArm() : armMesh()], [part(`fore_${s}`, [0, -upper, 0], [], [part(`hand_${s}`, [0, -fore, 0], [handMesh(k), ...held])])], [0, 0, k * 7]);
    }
    return part(`leg_${s}`, [k * legX, chibi ? -0.02 : -0.03, 0], [chibi ? chibiLeg() : legMesh()], [part(`shin_${s}`, [0, -thigh, 0], [], [part(`foot_${s}`, [0, -shin, 0], [chibi ? chibiFoot() : footMesh()])])]);
  };
  const parts = [
    part("hips", [0, hipsY, 0], [pelvis, skirt, belt, ...(hipsPaint ? [hipsPaint] : [])], [
      part("spine", [0, spineUp, 0], [torso, extras, packM, ...(torsoPaint ? [torsoPaint] : [])], [part("head", [0, neckUp, 0], [head, face, hairM, hatM, headExtra, ...(headPaint ? [headPaint] : [])], [...faceParts, ...earParts]), side("arm", 1), side("arm", -1), ...(bagAt ? [part("bag", bagAt, [bagM])] : [])]),
      side("leg", 1),
      side("leg", -1),
      ...(tailM.polys.length ? [part("tail", [0, -0.04, -0.11 * wide], [tailM])] : []),
    ]),
  ];

  // ---- the clips (rotation keys are whole turns in degrees; +x swings a hanging limb back, +z swings it out towards +x)
  const P = (...names: string[]) => ["hips", ...names];
  const spine = P("spine"), headP = P("spine", "head");
  const arm = (s: string) => P("spine", `arm_${s}`), foreP = (s: string) => P("spine", `arm_${s}`, `fore_${s}`);
  const restZ = (s: string) => (s === "l" ? 7 : -7);
  const rot = (p: string[], keys: Args[]) => ({ part: p, prop: "rotation", keys });
  const hipsAt = (keys: [number, number, number?][]) => ({ part: ["hips"], prop: "position", keys: keys.map(([t, dy, dz]) => key(t, [0, r3((hipsY + dy) * U), r3((dz ?? 0) * U)])) }); // (straight between keys: the feet are placed for hips that move so)
  const restAnkle = (k: number): V3 => [k * legX * U, ankle * U, 0];
  const feet = (list: [number, number, number, number?][]) => ({
    foot_l: list.map(([t, dy, dz, pitch]) => [t, restAnkle(1)[0], r3((ankle + dy) * U), r3(dz * U), pitch ?? 0]),
    foot_r: list.map(([t, dy, dz, pitch]) => [t, restAnkle(-1)[0], r3((ankle + dy) * U), r3(dz * U), pitch ?? 0]),
  });
  const walkD = 0.86, runD = 0.56, trotD = 0.5;
  const walkStride = 0.6 * tall, runStride = 0.8 * tall, trotStride = 0.62 * tall;
  const hasTail = tailM.polys.length > 0;
  // a tail swings from side to side (about y) over `D` seconds, lagging the body a little
  const tailSwing = (D: number, deg: number, lift = 0) => (hasTail ? [rot(P("tail"), [key(0, [lift, deg, 0], "inout"), key(D / 2, [lift, -deg, 0], "inout"), key(D, [lift, deg, 0])])] : []);
  const sway = (D: number, deg: number, lean: number) => [
    rot(spine, [key(0, [lean, -deg, 0], "inout"), key(D / 2, [lean, deg, 0], "inout"), key(D, [lean, -deg, 0])]),
    rot(headP, [key(0, [-lean * 0.6, deg * 0.7, 0], "inout"), key(D / 2, [-lean * 0.6, -deg * 0.7, 0], "inout"), key(D, [-lean * 0.6, deg * 0.7, 0])]),
    ...tailSwing(D, deg * 2.4, -lean),
  ];
  const clips: Args[] = [
    {
      name: "idle", duration: 2.4, loop: true,
      tracks: [
        rot(spine, [key(0, [0, 0, 0], "inout"), key(1.2, [2.2, 0, 0], "inout"), key(2.4, [0, 0, 0])]),
        rot(headP, [key(0, [0, 0, 0], "inout"), key(0.8, [-2, 5, 0], "inout"), key(1.7, [-1, -4, 0], "inout"), key(2.4, [0, 0, 0])]),
        ...(["l", "r"] as const).flatMap((s) => [
          rot(arm(s), [key(0, [0, 0, restZ(s)], "inout"), key(1.2, [-2, 0, restZ(s) * 1.4], "inout"), key(2.4, [0, 0, restZ(s)])]),
          rot(foreP(s), [key(0, [-6, 0, 0], "inout"), key(1.2, [-10, 0, 0], "inout"), key(2.4, [-6, 0, 0])]),
        ]),
        ...tailSwing(2.4, 9),
      ],
    },
    { name: "walk", duration: walkD, loop: true, tracks: sway(walkD, 5, 3), walk: { legs: ["foot_l", "foot_r"], stride: r3(walkStride * U), lift: r3(0.085 * tall * U), stance: 0.6, arms: ["arm_l", "arm_r"], arm_swing: 24, elbow: 14, event: "step" } },
    { name: "run", duration: runD, loop: true, tracks: sway(runD, 9, 13), walk: { legs: ["foot_l", "foot_r"], stride: r3(runStride * U), lift: r3(0.2 * tall * U), stance: 0.36, bob: 0.9, heel: 4, toe: 32, arms: ["arm_l", "arm_r"], arm_swing: 44, elbow: 48, event: "step" } },
    // a brisk trot, for hurrying with something in the hands: the run's legs, shorter and lower, the body upright, no arm swing (lay
    // carry over the arms)
    { name: "trot", duration: trotD, loop: true, tracks: sway(trotD, 5, 6), walk: { legs: ["foot_l", "foot_r"], stride: r3(trotStride * U), lift: r3(0.12 * tall * U), stance: 0.45, bob: 0.6, event: "step" } },
    {
      name: "jump", duration: 0.8, loop: false,
      tracks: [
        hipsAt([[0, 0], [0.04, -0.03 * tall], [0.09, -0.11 * tall], [0.12, -0.13 * tall], [0.15, -0.1 * tall], [0.19, -0.02], [0.22, 0.03], [0.42, 0.02], [0.64, 0.0], [0.68, -0.05 * tall], [0.72, -0.09 * tall], [0.76, -0.05 * tall], [0.8, 0]]),
        rot(spine, [key(0, [0, 0, 0], "inout"), key(0.12, [16, 0, 0], "inout"), key(0.24, [-6, 0, 0], "inout"), key(0.5, [4, 0, 0], "inout"), key(0.72, [12, 0, 0], "inout"), key(0.8, [0, 0, 0])]),
        ...(["l", "r"] as const).flatMap((s) => [
          rot(arm(s), [key(0, [0, 0, restZ(s)], "inout"), key(0.12, [38, 0, restZ(s) * 2], "inout"), key(0.26, [-120, 0, restZ(s) * 3], "inout"), key(0.5, [-70, 0, restZ(s) * 5], "inout"), key(0.72, [10, 0, restZ(s) * 3], "inout"), key(0.8, [0, 0, restZ(s)])]),
          rot(foreP(s), [key(0, [-6, 0, 0], "inout"), key(0.12, [-40, 0, 0], "inout"), key(0.26, [-20, 0, 0], "inout"), key(0.5, [-45, 0, 0], "inout"), key(0.8, [-6, 0, 0])]),
        ]),
      ],
      ik: feet([[0, 0, 0], [0.14, 0, 0], [0.18, 0.05, -0.005, 17], [0.22, 0.09, -0.01, 34], [0.4, 0.2 * tall, -0.06, 24], [0.56, 0.1 * tall, 0.05, -4], [0.66, 0.012, 0.02, 0], [0.7, 0, 0.01, 0], [0.8, 0, 0]]),
    },
    {
      name: "wave", duration: 1.6, loop: false,
      tracks: [
        rot(arm("r"), [key(0, [0, 0, -7], "inout"), key(0.3, [-12, 0, -150], "inout"), key(1.3, [-12, 0, -150], "inout"), key(1.6, [0, 0, -7])]),
        rot(foreP("r"), [key(0, [-6, 0, 0], "inout"), key(0.3, [0, 0, -45], "inout"), key(0.5, [0, 0, 5], "inout"), key(0.7, [0, 0, -45], "inout"), key(0.9, [0, 0, 5], "inout"), key(1.1, [0, 0, -45], "inout"), key(1.3, [0, 0, -15], "inout"), key(1.6, [-6, 0, 0])]),
        rot(headP, [key(0, [0, 0, 0], "inout"), key(0.3, [-4, -8, 5], "inout"), key(1.3, [-4, -8, 5], "inout"), key(1.6, [0, 0, 0])]),
        rot(spine, [key(0, [0, 0, 0], "inout"), key(0.3, [0, 0, 3], "inout"), key(1.3, [0, 0, 3], "inout"), key(1.6, [0, 0, 0])]),
      ],
      events: [{ t: 0.3, name: "wave" }],
    },
    {
      name: "attack", duration: 0.5, loop: false,
      tracks: [
        rot(arm("r"), [key(0, [0, 0, -7], "out"), key(0.14, [-165, 0, -18], "in"), key(0.24, [-48, 0, 6], "out"), key(0.34, [-20, 0, 10], "inout"), key(0.5, [0, 0, -7])]),
        rot(foreP("r"), [key(0, [-6, 0, 0], "out"), key(0.14, [-70, 0, 0], "in"), key(0.24, [-8, 0, 0], "inout"), key(0.5, [-6, 0, 0])]),
        rot(arm("l"), [key(0, [0, 0, 7], "inout"), key(0.14, [-20, 0, 14], "inout"), key(0.26, [26, 0, 16], "inout"), key(0.5, [0, 0, 7])]),
        rot(spine, [key(0, [0, 0, 0], "out"), key(0.14, [-8, 16, 0], "in"), key(0.24, [12, -22, 0], "out"), key(0.36, [8, -14, 0], "inout"), key(0.5, [0, 0, 0])]),
        rot(headP, [key(0, [0, 0, 0], "out"), key(0.14, [4, -10, 0], "in"), key(0.24, [-6, 14, 0], "inout"), key(0.5, [0, 0, 0])]),
      ],
      events: [{ t: 0.22, name: "hit" }],
    },
    {
      name: "hurt", duration: 0.45, loop: false,
      tracks: [
        rot(spine, [key(0, [0, 0, 0], "out"), key(0.1, [-17, 0, 4], "inout"), key(0.45, [0, 0, 0])]),
        rot(headP, [key(0, [0, 0, 0], "out"), key(0.1, [-14, 0, -6], "inout"), key(0.45, [0, 0, 0])]),
        rot(arm("l"), [key(0, [0, 0, 7], "out"), key(0.1, [-22, 0, 40], "inout"), key(0.45, [0, 0, 7])]),
        rot(arm("r"), [key(0, [0, 0, -7], "out"), key(0.1, [-22, 0, -40], "inout"), key(0.45, [0, 0, -7])]),
        hipsAt([[0, 0, 0], [0.1, -0.03, -0.05], [0.45, 0, 0]]),
      ],
      ik: feet([[0, 0, 0], [0.45, 0, 0]]),
    },
    {
      // both arms held forward with the elbows bent, as round a box held at the chest: lay it over the arms of any clip
      // (a masked layer: { clip = "carry", mask = { "arm_l", "arm_r" } }), so the legs walk on underneath
      name: "carry", duration: 1.2, loop: true,
      tracks: (["l", "r"] as const).flatMap((s) => [
        rot(arm(s), [key(0, [-38, 0, -restZ(s) * 0.4], "inout"), key(0.6, [-40, 0, -restZ(s) * 0.4], "inout"), key(1.2, [-38, 0, -restZ(s) * 0.4])]),
        rot(foreP(s), [key(0, [-62, s === "l" ? -18 : 18, 0], "inout"), key(0.6, [-64, s === "l" ? -18 : 18, 0], "inout"), key(1.2, [-62, s === "l" ? -18 : 18, 0])]),
      ]),
    },
    {
      // talking with the hands: the right hand rises and turns out with each phrase, the head nods, the left hand rests
      name: "talk", duration: 2.0, loop: true,
      tracks: [
        rot(arm("r"), [key(0, [-14, 0, -12], "inout"), key(0.5, [-34, 0, -22], "inout"), key(1.0, [-20, 0, -14], "inout"), key(1.5, [-38, 0, -26], "inout"), key(2.0, [-14, 0, -12])]),
        rot(foreP("r"), [key(0, [-40, 0, 0], "inout"), key(0.5, [-78, 0, -20], "inout"), key(1.0, [-50, 0, 0], "inout"), key(1.5, [-84, 0, -28], "inout"), key(2.0, [-40, 0, 0])]),
        rot(arm("l"), [key(0, [0, 0, 7], "inout"), key(1.0, [-6, 0, 10], "inout"), key(2.0, [0, 0, 7])]),
        rot(foreP("l"), [key(0, [-12, 0, 0], "inout"), key(1.0, [-20, 0, 0], "inout"), key(2.0, [-12, 0, 0])]),
        rot(headP, [key(0, [0, 0, 0], "inout"), key(0.3, [6, 4, 3], "inout"), key(0.7, [-4, -2, -2], "inout"), key(1.2, [5, -5, -3], "inout"), key(1.6, [-3, 2, 2], "inout"), key(2.0, [0, 0, 0])]),
        rot(spine, [key(0, [0, 0, 0], "inout"), key(0.5, [2, 4, 0], "inout"), key(1.5, [3, -4, 0], "inout"), key(2.0, [0, 0, 0])]),
        ...tailSwing(1.0, 12),
      ],
    },
    {
      // busy with the hands in front: sawing a plank, turning a knob, sorting letters (both forearms go back and forth)
      name: "work", duration: 0.8, loop: true,
      tracks: [
        rot(arm("r"), [key(0, [-30, 0, -4], "inout"), key(0.4, [-8, 0, -6], "inout"), key(0.8, [-30, 0, -4])]),
        rot(foreP("r"), [key(0, [-70, 10, 0], "inout"), key(0.4, [-42, 10, 0], "inout"), key(0.8, [-70, 10, 0])]),
        rot(arm("l"), [key(0, [-26, 0, 10], "inout"), key(0.4, [-30, 0, 12], "inout"), key(0.8, [-26, 0, 10])]),
        rot(foreP("l"), [key(0, [-50, -20, 0], "inout"), key(0.4, [-56, -20, 0], "inout"), key(0.8, [-50, -20, 0])]),
        rot(spine, [key(0, [12, -6, 0], "inout"), key(0.4, [15, 4, 0], "inout"), key(0.8, [12, -6, 0])]),
        rot(headP, [key(0, [8, 4, 0], "inout"), key(0.4, [10, -3, 0], "inout"), key(0.8, [8, 4, 0])]),
        ...tailSwing(0.8, 8),
      ],
    },
    {
      // sitting at a wheel (a driver's seat, a bench): the thighs straight out in front, the shins hanging, both hands reaching
      // forward to hold something at chest height, a slow breath. The figure's origin stays where its feet would stand: set it a
      // seat's height up (minus the hips' height) and the bottom rests on the seat; turn the arms on top with `parts` to steer
      name: "sit", duration: 2.0, loop: true,
      tracks: [
        ...(["l", "r"] as const).flatMap((s) => [
          rot(P(`leg_${s}`), [key(0, [-84, 0, 0]), key(2.0, [-84, 0, 0])]),
          rot(P(`leg_${s}`, `shin_${s}`), [key(0, [84, 0, 0]), key(2.0, [84, 0, 0])]),
          rot(arm(s), [key(0, [-50, 0, -restZ(s) * 0.6], "inout"), key(1.0, [-52, 0, -restZ(s) * 0.6], "inout"), key(2.0, [-50, 0, -restZ(s) * 0.6])]),
          rot(foreP(s), [key(0, [-34, s === "l" ? -10 : 10, 0]), key(2.0, [-34, s === "l" ? -10 : 10, 0])]),
        ]),
        rot(spine, [key(0, [-3, 0, 0], "inout"), key(1.0, [-1.5, 0, 0], "inout"), key(2.0, [-3, 0, 0])]),
        rot(headP, [key(0, [2, 0, 0], "inout"), key(1.0, [1, 0, 0], "inout"), key(2.0, [2, 0, 0])]),
        ...tailSwing(2.0, 4),
      ],
    },
  ];
  // chibi: no elbows or knees to bend, so the clips swing whole limbs from the shoulder and the hip; the walk is a waddle with a little
  // bob (the hips rise as the legs pass upright and roll towards the leg that stands), the carry holds the parcel out with both arms,
  // the talk tilts the head and waves an arm. The feet stay on the ground: a straight leg swung by `a` lifts the foot by L(1 - cos a),
  // and the hips drop by as much at the ends of each stride.
  let chibiSpeeds: { walk: number; run: number; trot: number } | undefined;
  if (chibi) {
    const L = thigh + shin + ankle;
    // (o.arms: "swing" (back and forth), "out" (the aeroplane: held straight out to the sides and a little back, flapping a touch
    // with each step) or "none" (left to a layer: the carry); o.lean: the body's forward lean; o.bob: the head's nod each step;
    // o.tail: how far the tail lifts to stream out behind)
    const stride = (D: number, swing: number, armSwing: number, roll: number, o: { arms?: "swing" | "out" | "none"; lean?: number; bob?: number; tail?: number } = {}) => {
      const drop = L * (1 - Math.cos((swing * Math.PI) / 180));
      const lean = o.lean === undefined ? 3 : o.lean * 0.5, bob = o.bob ?? 3;
      // (half the lean is the hips tipping forward, the legs turned back by as much so the feet stay under)
      const hl = (o.lean ?? 0) * 0.5;
      const legKeys = (s: number) => [key(0, [s * swing - hl, 0, 0], "inout"), key(D / 2, [-s * swing - hl, 0, 0], "inout"), key(D, [s * swing - hl, 0, 0])];
      const armKeys = (s: number, side: string) => [key(0, [-s * armSwing, 0, restZ(side) * 2], "inout"), key(D / 2, [s * armSwing, 0, restZ(side) * 2], "inout"), key(D, [-s * armSwing, 0, restZ(side) * 2])];
      // (out: about 80 degrees from the sides, 18 back; the arms dip a little as each foot lands and rise as the body does)
      const outKeys = (side: string) => { const k = side === "l" ? 1 : -1; return [key(0, [18, 0, k * 74], "inout"), key(D / 4, [18, 0, k * 84], "inout"), key(D / 2, [18, 0, k * 74], "inout"), key((3 * D) / 4, [18, 0, k * 84], "inout"), key(D, [18, 0, k * 74])]; };
      const arms = o.arms ?? "swing";
      return [
        rot(P("leg_l"), legKeys(1)), rot(P("leg_r"), legKeys(-1)),
        ...(arms === "swing" ? [rot(arm("l"), armKeys(1, "l")), rot(arm("r"), armKeys(-1, "r"))] : arms === "out" ? [rot(arm("l"), outKeys("l")), rot(arm("r"), outKeys("r"))] : []),
        hipsAt([[0, -drop], [D / 4, 0], [D / 2, -drop], [(3 * D) / 4, 0], [D, -drop]]),
        rot(["hips"], [key(0, [hl, 0, roll], "inout"), key(D / 2, [hl, 0, -roll], "inout"), key(D, [hl, 0, roll])]),
        rot(spine, [key(0, [lean, 0, -roll * 0.5], "inout"), key(D / 2, [lean, 0, roll * 0.5], "inout"), key(D, [lean, 0, -roll * 0.5])]),
        // (the head keeps looking ahead over the lean, and nods with each step)
        rot(headP, [key(0, [-(lean + hl) * 0.6, 0, -roll * 0.4], "inout"), key(D / 4, [-(lean + hl) * 0.6 - bob, 0, 0], "inout"), key(D / 2, [-(lean + hl) * 0.6, 0, roll * 0.4], "inout"), key((3 * D) / 4, [-(lean + hl) * 0.6 - bob, 0, 0], "inout"), key(D, [-(lean + hl) * 0.6, 0, -roll * 0.4])]),
        ...tailSwing(D, roll * 3, -(o.tail ?? 0)),
      ];
    };
    // (the run: quick short steps, about twice the walk's speed, the arms out like an aeroplane's wings, leaning into it, the tail
    // streaming; the trot: a brisk hurry with the arms left free for the carry, a little quicker than the walk)
    const walkC = 0.56, runC = 0.3, trotC = 0.4, walkSwing = 26, runSwing = 30, trotSwing = 24;
    const replace = (name: string, c: Args) => { const i = clips.findIndex((x) => x.name === name); clips[i] = c; };
    replace("walk", { name: "walk", duration: walkC, loop: true, tracks: stride(walkC, walkSwing, 26, 5), events: [{ t: 0, name: "step" }, { t: walkC / 2, name: "step" }] });
    replace("run", { name: "run", duration: runC, loop: true, tracks: stride(runC, runSwing, 0, 5, { arms: "out", lean: 24, bob: 6, tail: -18 }), events: [{ t: 0, name: "step" }, { t: runC / 2, name: "step" }] });
    replace("trot", { name: "trot", duration: trotC, loop: true, tracks: stride(trotC, trotSwing, 0, 6, { arms: "none", lean: 8, bob: 4, tail: -8 }), events: [{ t: 0, name: "step" }, { t: trotC / 2, name: "step" }] });
    replace("carry", { name: "carry", duration: 1.2, loop: true, tracks: (["l", "r"] as const).flatMap((s) => [rot(arm(s), [key(0, [-62, 0, -restZ(s) * 1.6], "inout"), key(0.6, [-65, 0, -restZ(s) * 1.6], "inout"), key(1.2, [-62, 0, -restZ(s) * 1.6])])]) });
    replace("talk", { name: "talk", duration: 2.0, loop: true, tracks: [
      rot(arm("r"), [key(0, [-20, 0, -14], "inout"), key(0.5, [-70, 0, -50], "inout"), key(1.0, [-30, 0, -20], "inout"), key(1.5, [-85, 0, -40], "inout"), key(2.0, [-20, 0, -14])]),
      rot(arm("l"), [key(0, [0, 0, 9], "inout"), key(1.0, [-12, 0, 18], "inout"), key(2.0, [0, 0, 9])]),
      rot(headP, [key(0, [0, 0, 0], "inout"), key(0.35, [6, 6, 10], "inout"), key(0.8, [-4, -3, -4], "inout"), key(1.25, [5, -6, -10], "inout"), key(1.65, [-3, 3, 4], "inout"), key(2.0, [0, 0, 0])]),
      rot(spine, [key(0, [0, 0, 0], "inout"), key(0.5, [3, 6, 2], "inout"), key(1.5, [3, -6, -2], "inout"), key(2.0, [0, 0, 0])]),
      ...tailSwing(1.0, 14),
    ] });
    replace("work", { name: "work", duration: 0.8, loop: true, tracks: [
      rot(arm("r"), [key(0, [-70, 0, -10], "inout"), key(0.4, [-40, 0, -14], "inout"), key(0.8, [-70, 0, -10])]),
      rot(arm("l"), [key(0, [-50, 0, 16], "inout"), key(0.4, [-62, 0, 12], "inout"), key(0.8, [-50, 0, 16])]),
      rot(spine, [key(0, [10, -6, 0], "inout"), key(0.4, [13, 5, 0], "inout"), key(0.8, [10, -6, 0])]),
      rot(headP, [key(0, [8, 6, 4], "inout"), key(0.4, [10, -4, -4], "inout"), key(0.8, [8, 6, 4])]),
      ...tailSwing(0.8, 10),
    ] });
    // (sitting: the stubby legs straight out in front, both mittens forward at the chest as on a steering wheel)
    replace("sit", { name: "sit", duration: 2.0, loop: true, tracks: [
      ...(["l", "r"] as const).flatMap((s) => [
        rot(P(`leg_${s}`), [key(0, [-82, 0, 0]), key(2.0, [-82, 0, 0])]),
        rot(arm(s), [key(0, [-64, 0, -restZ(s) * 0.8], "inout"), key(1.0, [-66, 0, -restZ(s) * 0.8], "inout"), key(2.0, [-64, 0, -restZ(s) * 0.8])]),
      ]),
      rot(spine, [key(0, [-3, 0, 0], "inout"), key(1.0, [-1.5, 0, 0], "inout"), key(2.0, [-3, 0, 0])]),
      rot(headP, [key(0, [2, 0, 0], "inout"), key(1.0, [1, 0, 0], "inout"), key(2.0, [2, 0, 0])]),
      ...tailSwing(2.0, 4),
    ] });
    // (the other clips bend forearms and shins, which a chibi does not have: those turns are left out)
    for (const c of clips) if (c.tracks) c.tracks = c.tracks.filter((t: Args) => !/^(fore|shin|hand|foot)_/.test(t.part[t.part.length - 1]));
    for (const c of clips) delete c.ik;
    const step = (sw: number) => 2 * L * Math.sin((sw * Math.PI) / 180);
    chibiSpeeds = { walk: r3((2 * step(walkSwing)) / walkC), run: r3((2 * step(runSwing)) / runC), trot: r3((2 * step(trotSwing)) / trotC) };
  }
  // each gait clip says the ground its feet cover in one cycle (metres), so a game can play it by the distance walked (the animator's
  // `by = "distance"`): played so, the feet keep to the ground at any speed
  const gaitSpeeds = chibiSpeeds ?? { walk: walkStride / (0.6 * walkD), run: runStride / (0.36 * runD), trot: trotStride / (0.45 * trotD) };
  for (const c of clips) if (c.name === "walk" || c.name === "run" || c.name === "trot") c.stride = r3(gaitSpeeds[c.name as "walk"] * c.duration);
  const model = modelDoc(parts, { clips });
  // the painted decals: each shape its block in one texture, painted through its unwrap
  let picture: Raster | undefined;
  if (painted.length) {
    const byName = new Map<string, Cube>();
    const visit = (ps: Args[]) => ps.forEach((q) => { for (const c of q.cubes) if (c.texture && c.name) byName.set(c.name, c as Cube); visit(q.children ?? []); });
    visit(model.parts);
    const t = paintTexture(byName, painted);
    model.texture = { size: t.size, smooth: true };
    picture = t.picture;
  }
  const speeds = chibiSpeeds ?? { walk: r3(walkStride / (0.6 * walkD)), run: r3(runStride / (0.36 * runD)), trot: r3(trotStride / (0.45 * trotD)) };
  const height = r3(hipsY + spineUp + neckUp + headC + headR[1] + (hat === "wizard" ? 0.3 : hair === "spiky" ? 0.1 : 0.02));
  const capsule = { radius: r3(Math.max(0.24, 0.3 * wide * (build === "child" ? 0.8 : 1))), height: r3(Math.max(1, hipsY + spineUp + neckUp + headC + headR[1])) };
  const wears = [outfit === "armor" ? "armour" : `a ${outfit}`, hat !== "none" ? `a ${hat === "wizard" ? "wizard's hat" : hat === "straw" ? "straw hat" : hat === "peaked" ? "peaked cap" : hat === "bucket" ? "bucket hat" : hat === "round" ? "round cap" : hat}` : "", skirted && outfit !== "robe" ? "a skirt" : outfit !== "robe" ? "trousers" : "", pack !== "none" ? `a ${pack}` : "", item !== "none" ? `${item === "axe" ? "an" : "a"} ${item} in the right hand` : ""].filter(Boolean).join(", ");
  return {
    model,
    parts: ["hips", "spine", "head", "arm_l", "fore_l", "hand_l", "arm_r", "fore_r", "hand_r", "leg_l", "shin_l", "foot_l", "leg_r", "shin_r", "foot_r", ...(hasTail ? ["tail"] : []), ...earParts.map((p) => p.name as string), ...(bagAt ? ["bag"] : [])],
    clips: clips.map((c) => ({ name: c.name, duration: c.duration, loop: !!c.loop, ...(c.stride ? { stride: c.stride } : {}), events: c.name === "walk" || c.name === "run" || c.name === "trot" ? ["step when each foot lands"] : (c.events ?? []).map((e: Args) => `${e.name} at ${e.t}`) })),
    speeds,
    capsule,
    gait: chibi,
    ...(animal ? { faces: `the face is painted on the head: each drawing of the eyes, the brows and the mouth is a part under head, and one of each set shows (the first; the others are hidden until the game shows one: parts = { eye_wide = { visible = true }, eye_open = { visible = false } }): ${Object.entries(FACE_SETS).map(([k, v]) => `${k} ${v.join(", ")}`).join("; ")}. Expressions: ${Object.entries(EXPRESSIONS).map(([k, v]) => `${k} = ${v.join(" + ")}`).join("; ")}; blink with eye_shut; while talking swap the mouth back and forth with its partner (${Object.entries(TALK).map(([a, b]) => `${a} with ${b}`).join(", ")})` } : {}),
    ...(picture ? { picture } : {}),
    head: { width: r3(headR[0] * 2), height: r3(headR[1] * 2), depth: r3(headR[2] * 2) },
    says: `${build === "average" ? "an" : "a"} ${build} ${animal ? `${species} ` : ""}figure ${height} m high${hs !== 1 ? ` (its head ${hs} times a person's)` : ""} with ${hair === "bald" ? (animal ? "fur" : "no hair") : `${hair} hair`}, wearing ${wears}${accessory !== "none" ? ` and ${accessory === "glasses" || accessory === "headphones" ? accessory : `a ${accessory}`}` : ""}; it faces +z and stands on y = 0`,
    lua: (name, sp) => `local Hero = nova.entity { model = "${name}", tags = { "hero" }, velocity = false }
function Hero:create()
  self.anim = nova.animator("${name}", { start = "move", fade = 0.15, states = {
    move = { blend = "speed", by = "distance", points = { { 0, "idle" }, { ${sp.walk}, "walk" }, { ${sp.run}, "run" } } },  -- anim:set("speed", metres a second), anim:move(metres walked)
    jump = { clip = "jump", loop = false, fade = 0.06 },
    wave = { clip = "wave", loop = false, next = "move" }, attack = { clip = "attack", loop = false, next = "move", fade = 0.05 }, hurt = { clip = "hurt", loop = false, next = "move", fade = 0.05 },
  }, on_event = function(event) if event == "step" then nova.sound.play("step") end end })
end
function Hero:update(dt) self.anim:set("speed", self.speed or 0); self.anim:move((self.speed or 0) * dt); self.anim:update(dt) end  -- and move with nova.solid.move(x, y, z, ${capsule.radius}, ${capsule.height}, dx, dy, dz)${chibi ? "; for feet that keep to the ground use nova.gait (docs/project-format.md): self.gait:update(dt, self, self.anim) in place of move and update, and draw with parts = self.gait:parts()" : ""}
function Hero:draw() self.anim:draw(self.x, self.y, self.z, { ry = self.face or 0 }) end  -- face = math.atan(dx, dz) looks along the way it moves`,
  };
}

/// entities/<name>.lua for a made character: a third-person walker to start from.
export function characterEntity(model: string, speeds: { walk: number; run: number }, c: Character3d): string {
  return `-- A third-person walker for the model "${model}" (character3d_make). The stick moves it as the camera sees it; it runs
-- at full tilt and walks when the stick is half way; A (pad south, Space) jumps. Its clips are blended by its speed, so
-- the feet keep step, and each footfall is an event of the clip.
local WALK, RUN = ${speeds.walk}, ${speeds.run}   -- metres a second at which the walk and the run clips do not slide
local JUMP, GRAVITY = 6.2, 18
local RADIUS, HEIGHT = ${c.capsule.radius}, ${c.capsule.height}

local Hero = nova.entity { model = "${model}", tags = { "hero" }, velocity = false }

function Hero:create()
  self.face = math.pi          -- which way the model looks (ry); pi is towards -z
  self.speed, self.vy, self.air = 0, 0, 0
  self.on_ground = true
  self.anim = nova.animator("${model}", {
    start = "move", fade = 0.15,
    states = {
      -- (played by the ground covered: each clip's stride, so the feet keep pace with the ground at any speed)
      move = { blend = "speed", by = "distance", points = { { 0, "idle" }, { WALK, "walk" }, { RUN, "run" } } },
      jump = { clip = "jump", loop = false, fade = 0.06 },
      wave = { clip = "wave", loop = false, next = "move" },
    },
    on_event = function(event)
      if event == "step" and self.on_ground then self:step() end
    end,
  })${c.gait ? `
  -- the feet: each one fixed to the ground while it stands, the legs turned from the hips to reach it, the hips bobbing and leaning
  self.gait = nova.gait("${model}")` : ""}
end

-- A foot has landed. (Play your footstep here: nova.sound.play("step", { volume = 0.5 }).)
function Hero:step()
  self.steps = (self.steps or 0) + 1
end

function Hero:update(dt)
  -- the stick, as the camera sees it
  local mx, my = nova.input.axis("move_x"), nova.input.axis("move_y")
  local fx, fz = nova.cam3.forward()
  local rx, rz = nova.cam3.right()
  local dx, dz = rx * mx - fx * my, rz * mx - fz * my
  local len = math.sqrt(dx * dx + dz * dz)
  if len > 1 then dx, dz, len = dx / len, dz / len, 1 end
  local want = len > 0.15 and RUN * len or 0
  self.speed = self.speed + (want - self.speed) * math.min(1, dt * 10)
  if len > 0.15 then
    local turn = (math.atan(dx, dz) - self.face + math.pi) % (2 * math.pi) - math.pi
    self.face = self.face + turn * math.min(1, dt * 12)
    self.dir_x, self.dir_z = dx / len, dz / len
  end
  if self.on_ground and nova.input.pressed("a") then
    self.vy, self.on_ground = JUMP, false
    self.anim:play("jump", { restart = true })
  end
  self.vy = self.vy - GRAVITY * dt
  -- one move against everything solid: nova.solid (the ground, entities with solid = true) and the scenery's trunks
  local px, pz = self.x, self.z
  local m = nova.solid.move(self.x, self.y, self.z, RADIUS, HEIGHT, (self.dir_x or 0) * self.speed * dt, self.vy * dt, (self.dir_z or 0) * self.speed * dt)
  self.x, self.y, self.z = m.x, m.y, m.z
  if m.ground then
    self.on_ground, self.air, self.vy = true, 0, 0
  else
    self.air = self.air + dt
    if self.air > 0.12 then self.on_ground = false end   -- (a short grace: going down a step is not a fall)
  end
  if self.on_ground and self.anim:state() == "jump" then self.anim:play("move") end
  self.anim:set("speed", self.speed)
${c.gait ? `  if self.on_ground then
    self.gait:update(dt, self, self.anim)   -- (moves the animator on by the ground covered, updates it, plants the feet)
  else
    self.anim:update(dt)
    self.gait:reset(self)                   -- (in the air: both feet put down again where it lands)
  end` : `  self.anim:move(math.sqrt((self.x - px) ^ 2 + (self.z - pz) ^ 2))   -- (the cycle moves on by the ground covered)
  self.anim:update(dt)`}
end

function Hero:draw()
  if self.visible == false then return end
  self.anim:draw(self.x, self.y, self.z, { ry = self.face${c.gait ? ", parts = self.on_ground and self.gait:parts() or nil" : ""} })
end

return Hero
`;
}
