// character3d_make: a rigged low-poly person from parts, with the clips a third-person game needs. The figure is built in
// metres, standing on y = 0 and facing +z. Arms and legs are one smooth mesh each across the joint, skinned by
// model_write's `bend`; everything else is rigid in its part. The walk and the run are made by model_write's own `walk`
// (feet placed on the ground, hips rising over the standing leg), the other clips are keyed here.

import { colourOf, rngOf, toHex } from "./paint";
import { paletteOf } from "./palettes";
import { blend, choice, colours, Mesh3, modelDoc, part, tone, U, type Args, type V3 } from "./kit3d";

export const CHARACTER3D = {
  builds: ["average", "slim", "stocky", "child", "squat"] as const,
  skins: ["light", "tan", "brown", "dark", "pale", "green"] as const,
  hairs: ["short", "long", "bun", "ponytail", "spiky", "bald"] as const,
  outfits: ["tunic", "shirt", "robe", "armor", "vest"] as const,
  hats: ["none", "cap", "hood", "wizard", "straw", "helmet", "peaked"] as const,
  packs: ["none", "backpack", "quiver", "cape"] as const,
  items: ["none", "sword", "staff", "lantern", "axe", "torch"] as const,
  species: ["human", "fox", "badger", "rabbit", "bear", "cat"] as const,
  accessories: ["none", "satchel", "glasses", "headphones", "scarf"] as const,
};

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
  clips: { name: string; duration: number; loop: boolean; events: string[] }[];
  speeds: Record<string, number>;
  capsule: { radius: number; height: number };
  says: string;
  lua: (name: string, speeds: { walk: number; run: number }) => string;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
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
  const cloth = "#efe6d2";

  // ---- the measures (metres)
  // (squat: short and broad, a badger's or a bear's build)
  const tall = build === "child" ? 0.72 : build === "squat" ? 0.76 : build === "stocky" ? 0.95 : 1;
  const wide = build === "slim" ? 0.88 : build === "stocky" ? 1.2 : build === "squat" ? 1.18 : build === "child" ? 0.86 : 1;
  const headK = (build === "child" ? 1.02 : 1.1) * hs;
  const ankle = 0.07, shin = 0.34 * tall, thigh = 0.36 * tall;
  const hipY = ankle + shin + thigh;
  const hipsY = hipY + 0.03;
  const spineUp = 0.07 * tall, neckUp = 0.42 * tall;
  const upper = 0.24 * tall, fore = 0.22 * tall;
  const shoulder = 0.205 * wide * (build === "child" ? 0.95 : 1), legX = 0.092 * wide;
  const headR: V3 = [0.125 * headK, 0.148 * headK, 0.13 * headK];
  const headC = 0.165 * headK;

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
  const handMesh = (side: number) => {
    const m = new Mesh3(paw, { bend: false });
    m.blob([0, -0.045, 0], [0.036, 0.055, 0.045], paw, () => 0.5, { seg: 6, rows: 3, jitter: 0, tones: 0 });
    m.box([-side * 0.012, -0.045, 0.04], [0.022, 0.04, 0.03], tone(paw, -0.2), { flat: true });
    return m;
  };

  // ---- the body
  const pelvis = new Mesh3(legC, { bend: false });
  pelvis.rings([{ y: -0.11, rx: 0.1 * wide, rz: 0.085 }, { y: -0.05, rx: 0.158 * wide, rz: 0.115 }, { y: 0.04, rx: 0.16 * wide, rz: 0.112 }, { y: 0.1, rx: 0.145 * wide, rz: 0.1 }], 10, legC, { smooth: true });
  const skirt = new Mesh3(torsoC, { bend: false });
  if (outfit === "tunic" || outfit === "robe" || outfit === "armor") {
    const down = outfit === "robe" ? -(thigh + shin * 0.35) : -0.2 * tall, flare = outfit === "robe" ? 1.5 : 1.22;
    const c = outfit === "armor" ? tone(main, -0.3) : torsoC;
    skirt.rings([{ y: 0.09, rx: 0.165 * wide, rz: 0.118 }, { y: 0.0, rx: 0.178 * wide, rz: 0.13 }, { y: down, rx: 0.17 * wide * flare, rz: 0.13 * flare }], 10, (i) => (i === 1 ? tone(c, -0.25) : c), { smooth: true, caps: false });
    // (closed underneath, a shade darker, so nothing shows through from below)
    skirt.rings([{ y: down + 0.004, rx: 0.165 * wide * flare, rz: 0.125 * flare }, { y: down, rx: 0.17 * wide * flare, rz: 0.13 * flare }], 10, tone(c, -1.4));
    if (outfit === "robe") skirt.rings([{ y: down, rx: 0.172 * wide * flare, rz: 0.132 * flare }, { y: down + 0.04, rx: 0.172 * wide * flare, rz: 0.132 * flare }], 10, trim, { caps: false });
  }
  const belt = new Mesh3(trim, { bend: false });
  if (outfit !== "robe") {
    belt.rings([{ y: 0.065, rx: 0.172 * wide, rz: 0.124 }, { y: 0.105, rx: 0.172 * wide, rz: 0.124 }], 10, tone(trim, -0.5));
    belt.box([0, 0.085, 0.125], [0.05, 0.05, 0.02], pal.gold!, { flat: true });
  } else belt.rings([{ y: 0.07, rx: 0.172 * wide, rz: 0.124 }, { y: 0.1, rx: 0.172 * wide, rz: 0.124 }], 10, trim);

  const torso = new Mesh3(torsoC, { bend: false, ...(metal ? { metallic: 0.55, roughness: 0.5 } : {}) });
  const tc = metal ? "#b4bac6" : torsoC;
  torso.rings(
    [
      { y: -0.02, rx: 0.15 * wide, rz: 0.105 }, { y: neckUp * 0.3, rx: 0.165 * wide, rz: 0.115 }, { y: neckUp * 0.66, rx: 0.19 * wide, rz: 0.125 },
      { y: neckUp * 0.88, rx: 0.185 * wide, rz: 0.115 }, { y: neckUp, rx: 0.075, rz: 0.07 },
    ],
    10, tc, { smooth: true },
  );
  const extras = new Mesh3(trim, { bend: false });
  if (outfit === "tunic" || outfit === "shirt") extras.rings([{ y: neckUp * 0.9, rx: 0.115 * wide, rz: 0.092 }, { y: neckUp * 0.985, rx: 0.07, rz: 0.066 }], 10, tone(main, -0.55), { caps: false, smooth: true }); // a neckband
  if (outfit === "vest") {
    for (const k of [-1, 1]) extras.box([k * 0.03, neckUp * 0.45, 0.118], [0.012, neckUp * 0.8, 0.012], tone(main, -0.9), { flat: true });
    for (let i = 0; i < 3; i++) extras.box([0, neckUp * (0.2 + i * 0.22), 0.124], [0.022, 0.022, 0.012], pal.gold!, { flat: true });
  }
  if (metal) {
    for (const k of [-1, 1]) extras.blob([k * (shoulder + 0.01), neckUp * 0.9, 0], [0.085, 0.06, 0.085], "#9aa1ae", () => 0.5, { seg: 7, rows: 3, jitter: 0, tones: 0 });
    extras.box([0, neckUp * 0.55, 0.12], [0.12, 0.16, 0.02], main, { taper: [0.5, 1], rx: 180, flat: true });
  }

  // ---- the head
  const head = new Mesh3(skin, { bend: false });
  head.rings([{ y: -0.03, rx: 0.058, rz: 0.055 }, { y: 0.05, rx: 0.055, rz: 0.052 }], 8, tone(skin, -0.3), { smooth: true });
  const hr: { y: number; rx: number; rz: number }[] = [];
  for (let i = 0; i <= 6; i++) {
    const t = -Math.PI / 2 + (Math.PI * i) / 6;
    // (a jaw a little narrower than the brow)
    hr.push({ y: headC + Math.sin(t) * headR[1], rx: Math.max(0, Math.cos(t)) * headR[0] * (i < 3 ? 0.9 : 1), rz: Math.max(0, Math.cos(t)) * headR[2] * (i < 3 ? 0.94 : 1) });
  }
  const face = new Mesh3("#2a2430", { bend: false });
  if (!animal) {
    head.rings(hr, 10, skin, { smooth: true });
    const eyeY = headC - 0.008, eyeZ = headR[2] * 0.93;
    for (const k of [-1, 1]) {
      face.box([k * 0.047 * headK, eyeY, eyeZ - 0.012], [0.03, 0.046, 0.02], "#2a2430", { flat: true, ry: k * 20 });
      face.box([k * 0.047 * headK + 0.006, eyeY + 0.012, eyeZ - 0.003], [0.01, 0.013, 0.008], "#ffffff", { flat: true, ry: k * 20 });
      face.box([k * (headR[0] * 0.98), headC - 0.01, 0], [0.03, 0.05, 0.035], tone(skin, -0.25), { flat: true });
    }
    face.box([0, headC - 0.04, headR[2] * 0.97], [0.022, 0.026, 0.024], tone(skin, -0.3), { flat: true });
  } else animalHead();

  // An animal's head: a round head in its fur's pattern, a muzzle, ears, big eyes. (R is the head's radius across.)
  function animalHead(): void {
    const R = headR[0], RY = headR[1], RZ = headR[2], seg = 16;
    const front = (j: number) => Math.sin((j / seg) * Math.PI * 2); // 1 straight ahead (+z), -1 behind
    const across = (j: number) => Math.abs(Math.cos((j / seg) * Math.PI * 2)); // 0 in the middle line, 1 at the sides
    const coat = (i: number, j: number): string => {
      if (species === "badger") {
        if (i >= 2 && across(j) > 0.3 && across(j) < 0.66 && front(j) > -0.85) return furDark; // the two stripes over the eyes
        if (front(j) < -0.35 || (i < 3 && across(j) > 0.8)) return skin; // the grey back of the head and lower cheeks
        return fur2;
      }
      if (species === "bear") return skin;
      return i <= 2 && front(j) > 0.05 ? fur2 : skin; // a light jaw and cheeks
    };
    head.rings(hr, seg, coat, { smooth: true });
    // the muzzle
    const tip = (k: number): V3 => [0, headC - 0.36 * RY, RZ * k];
    if (species === "fox" || species === "badger") {
      // (a tube along +z: its side 2 of 8 is the top, so a fox's snout is orange above and white below)
      const long = species === "fox" ? 1.6 : 1.45;
      const muz = new Mesh3(fur2, { bend: false });
      muz.tube([[0, headC - 0.24 * RY, RZ * 0.55], [0, headC - 0.32 * RY, RZ * 1.05], tip(long)], [0.36 * R, 0.22 * R, 0.08 * R], 8, (_i, j) => (species === "fox" && j >= 1 && j <= 3 ? skin : fur2), { smooth: true });
      head.add(muz);
      face.blob([0, headC - 0.35 * RY, RZ * (long + 0.01)], [0.1 * R, 0.08 * R, 0.08 * R], furDark, () => 0.5, { seg: 6, rows: 3, jitter: 0, tones: 0 });
    } else if (species === "bear") {
      head.blob([0, headC - 0.34 * RY, RZ * 0.86], [0.4 * R, 0.3 * R, 0.32 * R], fur2, () => 0.5, { seg: 8, rows: 3, jitter: 0, tones: 0.2 });
      face.blob([0, headC - 0.22 * RY, RZ * 1.14], [0.12 * R, 0.08 * R, 0.08 * R], furDark, () => 0.5, { seg: 6, rows: 3, jitter: 0, tones: 0 });
    } else {
      // a rabbit's and a cat's: two round cheeks and a small pink nose
      for (const k of [-1, 1]) head.blob([k * 0.14 * R, headC - 0.36 * RY, RZ * 0.86], [0.2 * R, 0.16 * R, 0.16 * R], fur2, () => 0.5, { seg: 7, rows: 3, jitter: 0, tones: 0.1 });
      face.blob([0, headC - 0.22 * RY, RZ * 0.99], [0.08 * R, 0.06 * R, 0.06 * R], "#e58a8f", () => 0.5, { seg: 6, rows: 3, jitter: 0, tones: 0 });
      if (species === "rabbit") face.box([0, headC - 0.52 * RY, RZ * 0.93], [0.11 * R, 0.1 * R, 0.04 * R], "#fbf8f2", { flat: true });
    }
    // the ears: on the head's top at `phi` from upright, leaning out
    const ear = (k: number, phi: number, h: number, w: number, d: number, lean: number, tipC: string, inner?: string) => {
      const p = (phi * Math.PI) / 180;
      const at: V3 = [k * Math.sin(p) * R * 0.92, headC + Math.cos(p) * RY * 0.92, -0.08 * RZ];
      const shape = (s: number) => [{ y: 0, rx: w * s, rz: d * s }, { y: h * 0.4, rx: w * 1.02 * s, rz: d * s, cx: k * h * 0.4 * lean }, { y: h * 0.78, rx: w * 0.62 * s, rz: d * 0.8 * s, cx: k * h * 0.78 * lean }, { y: h, rx: 0, cx: k * h * lean }];
      head.rings(shape(1), 8, (i) => (i >= 2 ? tipC : skin), { at, smooth: false });
      if (inner) head.rings(shape(0.62).map((r) => ({ ...r, y: r.y * 0.9 })), 8, inner, { at: [at[0] + k * 0.01, at[1] + 0.01, at[2] + d * 0.55] });
    };
    for (const k of [-1, 1]) {
      // (under a hat the pointed ears stand out at the sides of it)
      const hatted = hat === "cap" || hat === "peaked" || hat === "straw" || hat === "wizard";
      if (species === "fox") ear(k, hatted ? 54 : 36, 0.66 * R, 0.3 * R, 0.12 * R, hatted ? 0.55 : 0.32, furDark, fur2);
      else if (species === "cat") ear(k, hatted ? 54 : 38, 0.5 * R, 0.3 * R, 0.11 * R, hatted ? 0.5 : 0.25, skin, "#e9b9b6");
      else if (species === "rabbit") ear(k, 17, 1.35 * R, 0.21 * R, 0.08 * R, 0.16, tone(skin, -0.2), "#efb3ae");
      else {
        const p = ((species === "badger" ? 64 : 46) * Math.PI) / 180, s = species === "badger" ? 0.17 : 0.22;
        const at: V3 = [k * Math.sin(p) * R * 0.95, headC + Math.cos(p) * RY * 0.95, -0.05 * RZ];
        head.blob(at, [s * R, s * R, 0.09 * R], species === "badger" ? furDark : skin, () => 0.5, { seg: 8, rows: 3, jitter: 0, tones: 0 });
        head.blob([at[0], at[1], at[2] + 0.05 * R], [s * 0.6 * R, s * 0.6 * R, 0.05 * R], fur2, () => 0.5, { seg: 8, rows: 3, jitter: 0, tones: 0 });
      }
    }
    // big eyes a little below the middle, each with a glint
    const ex = 0.37 * R, ey = headC - 0.04 * RY, ez = RZ * Math.sqrt(1 - 0.37 * 0.37) * 0.97;
    for (const k of [-1, 1]) {
      // (an eye in a dark stripe gets a light rim, so it can be seen)
      if (species === "badger") face.box([k * ex, ey, ez - 0.012 * R], [0.33 * R, 0.43 * R, 0.08 * R], "#e9e4da", { flat: true, ry: k * 22 });
      face.box([k * ex, ey, ez], [0.23 * R, 0.33 * R, 0.08 * R], "#221c22", { flat: true, ry: k * 22 });
      face.box([k * ex + 0.05 * R, ey + 0.08 * R, ez + 0.035 * R], [0.08 * R, 0.09 * R, 0.03 * R], "#ffffff", { flat: true, ry: k * 22 });
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
    const R0 = headR[0] * (animal ? 0.84 : 1), RZ0 = headR[2] * (animal ? 0.88 : 1), cy = crownY + (animal ? headR[1] * 0.12 : 0);
    hatM.rings([{ y: cy - 0.01, rx: R0 * 0.98 + 0.012, rz: RZ0 * 0.98 + 0.012 }, { y: cy + 0.05 * hs, rx: R0 + 0.02, rz: RZ0 + 0.02 }, { y: cy + 0.1 * hs, rx: R0 * 1.12 + 0.02, rz: RZ0 * 1.1 + 0.02, cz: 0.01 }, { y: cy + 0.115 * hs, rx: R0 * 1.05, rz: RZ0 * 1.03, cz: 0.01 }, { y: cy + 0.118 * hs, rx: 0, cz: 0.01 }], 12, (i) => (i === 0 ? tone(main, -0.9) : tone(main, i >= 3 ? 0.3 : 0)), { smooth: true });
    hatM.box([0, cy + 0.0, RZ0 + 0.04 * hs], [R0 * 1.25, 0.016, 0.09 * hs], "#1f2128", { taper: [0.75, 0.6], rx: 14 });
    hatM.box([0, cy + 0.055 * hs, RZ0 + 0.03], [0.05 * hs, 0.045 * hs, 0.012], pal.gold!, { flat: true });
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
  if (accessory === "satchel") {
    // a strap from the left shoulder across the chest to a bag on the right hip, and back across the back
    for (const zs of [1, -1]) {
      const z = (v: number) => zs * v;
      extras.tube([[0.13 * wide, neckUp * 0.97, z(0.04)], [0.06 * wide, neckUp * 0.74, z(0.128)], [-0.08 * wide, neckUp * 0.4, z(0.122)], [-0.17 * wide, neckUp * 0.08, z(0.118)], [-0.2 * wide, -0.02, z(0.06)]], 0.013, 5, tone(accent, -0.4));
    }
    extras.box([-0.215 * wide, -0.07, 0.0], [0.07, 0.19, 0.25], accent, { taper: [1, 0.92] });
    extras.box([-0.25 * wide, -0.02, 0.0], [0.02, 0.12, 0.26], tone(accent, -0.35), { flat: true });
    extras.box([-0.26 * wide, -0.05, 0.0], [0.012, 0.03, 0.04], pal.gold!, { flat: true });
  } else if (accessory === "scarf") {
    extras.rings([{ y: neckUp * 0.9, rx: 0.12 * wide, rz: 0.1 }, { y: neckUp * 1.04, rx: 0.095, rz: 0.088 }], 10, accent, { smooth: true });
    extras.box([0.05 * wide, neckUp * 0.72, 0.125], [0.05, 0.16, 0.02], tone(accent, -0.3), { rz: -8 });
  }
  const headExtra = new Mesh3(accent, { bend: false });
  if (accessory === "glasses") {
    const R = headR[0], RZ = headR[2], ey = headC - (animal ? 0.04 * headR[1] : 0.008), ex = animal ? 0.37 * R : 0.047 * headK;
    const ez = (animal ? RZ * Math.sqrt(1 - 0.37 * 0.37) * 0.97 : RZ * 0.93) + 0.025 * hs;
    const r = animal ? 0.21 * R : 0.03 * headK;
    for (const k of [-1, 1]) {
      const ring: V3[] = [];
      for (let i = 0; i <= 12; i++) ring.push([k * ex + Math.cos((i / 12) * Math.PI * 2) * r, ey + Math.sin((i / 12) * Math.PI * 2) * r, ez]);
      headExtra.tube(ring, 0.009 * hs, 4, accent);
      headExtra.box([k * (R * 0.93), ey + r * 0.4, ez * 0.45], [0.012, 0.012, ez * 0.9], accent, { flat: true });
    }
    headExtra.box([0, ey + r * 0.3, ez + 0.004], [ex * 2 - r * 2 + 0.01, 0.012, 0.012], accent, { flat: true });
  } else if (accessory === "headphones") {
    const R = headR[0] + 0.022, RY = headR[1] + 0.03;
    const band: V3[] = [];
    for (let i = 0; i <= 10; i++) { const t = Math.PI * (i / 10); band.push([Math.cos(t) * R, headC + Math.sin(t) * RY, -0.01]); }
    headExtra.tube(band, 0.011 * hs, 6, "#2e3440", { smooth: true });
    for (const k of [-1, 1]) headExtra.tube([[k * (R - 0.03), headC - 0.03 * hs, 0], [k * (R + 0.035 * hs), headC - 0.03 * hs, 0]], 0.11 * headR[0] * 1.4, 10, accent, { ends: tone(accent, -0.6) });
  }

  // ---- an animal's tail, a part of its own so the clips can swing it
  const tailM = new Mesh3(skin, { bend: false });
  if (species === "fox") tailM.tube([[0, 0.02, 0], [0, -0.06, -0.12], [0, -0.05, -0.3], [0, 0.04, -0.46], [0, 0.12, -0.52]], [0.04, 0.085, 0.1, 0.07, 0.01], 8, (i) => (i >= 3 ? fur2 : skin), { smooth: true });
  else if (species === "cat") tailM.tube([[0, 0, 0], [0, -0.06, -0.15], [0, 0.06, -0.3], [0, 0.26, -0.35], [0, 0.32, -0.3]], [0.03, 0.03, 0.028, 0.025, 0.015], 6, skin, { smooth: true });
  else if (species === "badger") tailM.tube([[0, 0, 0], [0, -0.03, -0.09], [0, -0.07, -0.15]], [0.05, 0.05, 0.015], 6, skin, { smooth: true });
  else if (species === "rabbit") tailM.blob([0, 0, -0.03], [0.07, 0.07, 0.065], fur2, () => 0.5, { seg: 8, rows: 4, jitter: 0, tones: 0.1 });
  else if (species === "bear") tailM.blob([0, 0, -0.02], [0.05, 0.05, 0.04], skin, () => 0.5, { seg: 6, rows: 3, jitter: 0, tones: 0 });

  // ---- the parts
  const side = (name: string, k: number) => {
    const s = k > 0 ? "l" : "r";
    const held = k < 0 ? [itemM, glow] : [];
    if (name === "arm") {
      return part(`arm_${s}`, [k * shoulder, neckUp * 0.86, 0], [armMesh()], [part(`fore_${s}`, [0, -upper, 0], [], [part(`hand_${s}`, [0, -fore, 0], [handMesh(k), ...held])])], [0, 0, k * 7]);
    }
    return part(`leg_${s}`, [k * legX, -0.03, 0], [legMesh()], [part(`shin_${s}`, [0, -thigh, 0], [], [part(`foot_${s}`, [0, -shin, 0], [footMesh()])])]);
  };
  const parts = [
    part("hips", [0, hipsY, 0], [pelvis, skirt, belt], [
      part("spine", [0, spineUp, 0], [torso, extras, packM], [part("head", [0, neckUp, 0], [head, face, hairM, hatM, headExtra]), side("arm", 1), side("arm", -1)]),
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
  const walkD = 0.86, runD = 0.56;
  const walkStride = 0.6 * tall, runStride = 0.8 * tall;
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
  ];
  const model = modelDoc(parts, { clips });
  const speeds = { walk: r3(walkStride / (0.6 * walkD)), run: r3(runStride / (0.36 * runD)) };
  const height = r3(hipsY + spineUp + neckUp + headC + headR[1] + (hat === "wizard" ? 0.3 : hair === "spiky" ? 0.1 : 0.02));
  const capsule = { radius: r3(Math.max(0.24, 0.3 * wide * (build === "child" ? 0.8 : 1))), height: r3(Math.max(1, hipsY + spineUp + neckUp + headC + headR[1])) };
  const wears = [outfit === "armor" ? "armour" : `a ${outfit}`, hat !== "none" ? `a ${hat === "wizard" ? "wizard's hat" : hat === "straw" ? "straw hat" : hat === "peaked" ? "peaked cap" : hat}` : "", pack !== "none" ? `a ${pack}` : "", item !== "none" ? `${item === "axe" ? "an" : "a"} ${item} in the right hand` : ""].filter(Boolean).join(", ");
  return {
    model,
    parts: ["hips", "spine", "head", "arm_l", "fore_l", "hand_l", "arm_r", "fore_r", "hand_r", "leg_l", "shin_l", "foot_l", "leg_r", "shin_r", "foot_r", ...(hasTail ? ["tail"] : [])],
    clips: clips.map((c) => ({ name: c.name, duration: c.duration, loop: !!c.loop, events: c.name === "walk" || c.name === "run" ? ["step when each foot lands"] : (c.events ?? []).map((e: Args) => `${e.name} at ${e.t}`) })),
    speeds,
    capsule,
    says: `${build === "average" ? "an" : "a"} ${build} ${animal ? `${species} ` : ""}figure ${height} m high${hs !== 1 ? ` (its head ${hs} times a person's)` : ""} with ${hair === "bald" ? (animal ? "fur" : "no hair") : `${hair} hair`}, wearing ${wears}${accessory !== "none" ? ` and ${accessory === "glasses" || accessory === "headphones" ? accessory : `a ${accessory}`}` : ""}; it faces +z and stands on y = 0`,
    lua: (name, sp) => `local Hero = nova.entity { model = "${name}", tags = { "hero" }, velocity = false }
function Hero:create()
  self.anim = nova.animator("${name}", { start = "move", fade = 0.15, states = {
    move = { blend = "speed", points = { { 0, "idle" }, { ${sp.walk}, "walk" }, { ${sp.run}, "run" } } },  -- anim:set("speed", metres a second)
    jump = { clip = "jump", loop = false, fade = 0.06 },
    wave = { clip = "wave", loop = false, next = "move" }, attack = { clip = "attack", loop = false, next = "move", fade = 0.05 }, hurt = { clip = "hurt", loop = false, next = "move", fade = 0.05 },
  }, on_event = function(event) if event == "step" then nova.sound.play("step") end end })
end
function Hero:update(dt) self.anim:set("speed", self.speed or 0); self.anim:update(dt) end  -- and move with nova.solid.move(x, y, z, ${capsule.radius}, ${capsule.height}, dx, dy, dz)
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
      move = { blend = "speed", points = { { 0, "idle" }, { WALK, "walk" }, { RUN, "run" } } },
      jump = { clip = "jump", loop = false, fade = 0.06 },
      wave = { clip = "wave", loop = false, next = "move" },
    },
    on_event = function(event)
      if event == "step" and self.on_ground then self:step() end
    end,
  })
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
  self.anim:update(dt)
end

function Hero:draw()
  if self.visible == false then return end
  self.anim:draw(self.x, self.y, self.z, { ry = self.face })
end

return Hero
`;
}
