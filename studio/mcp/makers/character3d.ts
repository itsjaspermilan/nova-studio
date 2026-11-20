// character3d_make: a rigged low-poly person from parts, with the clips a third-person game needs. The figure is built in
// metres, standing on y = 0 and facing +z. Arms and legs are one smooth mesh each across the joint, skinned by
// model_write's `bend`; everything else is rigid in its part. The walk and the run are made by model_write's own `walk`
// (feet placed on the ground, hips rising over the standing leg), the other clips are keyed here.

import { colourOf, rngOf, toHex } from "./paint";
import { paletteOf } from "./palettes";
import { blend, choice, colours, Mesh3, modelDoc, part, tone, U, type Args, type V3 } from "./kit3d";

export const CHARACTER3D = {
  builds: ["average", "slim", "stocky", "child"] as const,
  skins: ["light", "tan", "brown", "dark", "pale", "green"] as const,
  hairs: ["short", "long", "bun", "ponytail", "spiky", "bald"] as const,
  outfits: ["tunic", "shirt", "robe", "armor", "vest"] as const,
  hats: ["none", "cap", "hood", "wizard", "straw", "helmet"] as const,
  packs: ["none", "backpack", "quiver", "cape"] as const,
  items: ["none", "sword", "staff", "lantern", "axe", "torch"] as const,
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
  const hair = choice(a.hair, CHARACTER3D.hairs, "hair");
  const outfit = choice(a.outfit, CHARACTER3D.outfits, "outfit");
  const hat = choice(a.hat, CHARACTER3D.hats, "hat");
  const pack = choice(a.pack, CHARACTER3D.packs, "pack");
  const item = choice(a.item, CHARACTER3D.items, "item");
  const pal = colours(paletteOf(a.palette));
  const rand = rngOf((Number.isFinite(a.seed) ? Number(a.seed) : 1) * 9973 + 5);
  const col = (v: unknown, what: string, fallback: string) => toHex(colourOf(v, what, fallback));
  const skin = typeof a.skin === "string" && SKINS[a.skin.toLowerCase()] ? SKINS[a.skin.toLowerCase()]! : col(a.skin, "skin", SKINS.light!);
  const hairC = col(a.hair_color, "hair_color", "brown");
  const main = col(a.outfit_color, "outfit_color", outfit === "armor" ? "silver" : outfit === "robe" ? "purple" : "teal");
  const trim = col(a.trim_color, "trim_color", outfit === "robe" ? "gold" : "brown");
  const shoe = col(a.shoe_color, "shoe_color", "#4a3628");
  const cloth = "#efe6d2";

  // ---- the measures (metres)
  const tall = build === "child" ? 0.72 : build === "stocky" ? 0.95 : 1;
  const wide = build === "slim" ? 0.88 : build === "stocky" ? 1.2 : build === "child" ? 0.86 : 1;
  const headK = build === "child" ? 1.02 : 1.1;
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
  const handMesh = (side: number) => {
    const m = new Mesh3(skin, { bend: false });
    m.blob([0, -0.045, 0], [0.036, 0.055, 0.045], skin, () => 0.5, { seg: 6, rows: 3, jitter: 0, tones: 0 });
    m.box([-side * 0.012, -0.045, 0.04], [0.022, 0.04, 0.03], tone(skin, -0.2), { flat: true });
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
  head.rings(hr, 10, skin, { smooth: true });
  const face = new Mesh3("#2a2430", { bend: false });
  const eyeY = headC - 0.008, eyeZ = headR[2] * 0.93;
  for (const k of [-1, 1]) {
    face.box([k * 0.047 * headK, eyeY, eyeZ - 0.012], [0.03, 0.046, 0.02], "#2a2430", { flat: true, ry: k * 20 });
    face.box([k * 0.047 * headK + 0.006, eyeY + 0.012, eyeZ - 0.003], [0.01, 0.013, 0.008], "#ffffff", { flat: true, ry: k * 20 });
    face.box([k * (headR[0] * 0.98), headC - 0.01, 0], [0.03, 0.05, 0.035], tone(skin, -0.25), { flat: true });
  }
  face.box([0, headC - 0.04, headR[2] * 0.97], [0.022, 0.026, 0.024], tone(skin, -0.3), { flat: true });

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
      part("spine", [0, spineUp, 0], [torso, extras, packM], [part("head", [0, neckUp, 0], [head, face, hairM, hatM]), side("arm", 1), side("arm", -1)]),
      side("leg", 1),
      side("leg", -1),
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
  const sway = (D: number, deg: number, lean: number) => [
    rot(spine, [key(0, [lean, -deg, 0], "inout"), key(D / 2, [lean, deg, 0], "inout"), key(D, [lean, -deg, 0])]),
    rot(headP, [key(0, [-lean * 0.6, deg * 0.7, 0], "inout"), key(D / 2, [-lean * 0.6, -deg * 0.7, 0], "inout"), key(D, [-lean * 0.6, deg * 0.7, 0])]),
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
  ];
  const model = modelDoc(parts, { clips });
  const speeds = { walk: r3(walkStride / (0.6 * walkD)), run: r3(runStride / (0.36 * runD)) };
  const height = r3(hipsY + spineUp + neckUp + headC + headR[1] + (hat === "wizard" ? 0.3 : hair === "spiky" ? 0.1 : 0.02));
  const capsule = { radius: r3(Math.max(0.24, 0.3 * wide * (build === "child" ? 0.8 : 1))), height: r3(Math.max(1, hipsY + spineUp + neckUp + headC + headR[1])) };
  const wears = [outfit === "armor" ? "armour" : `a ${outfit}`, hat !== "none" ? `a ${hat === "wizard" ? "wizard's hat" : hat === "straw" ? "straw hat" : hat}` : "", pack !== "none" ? `a ${pack}` : "", item !== "none" ? `${item === "axe" ? "an" : "a"} ${item} in the right hand` : ""].filter(Boolean).join(", ");
  return {
    model,
    parts: ["hips", "spine", "head", "arm_l", "fore_l", "hand_l", "arm_r", "fore_r", "hand_r", "leg_l", "shin_l", "foot_l", "leg_r", "shin_r", "foot_r"],
    clips: clips.map((c) => ({ name: c.name, duration: c.duration, loop: !!c.loop, events: c.name === "walk" || c.name === "run" ? ["step when each foot lands"] : (c.events ?? []).map((e: Args) => `${e.name} at ${e.t}`) })),
    speeds,
    capsule,
    says: `${build === "average" ? "an" : "a"} ${build} figure ${height} m high with ${hair === "bald" ? "no hair" : `${hair} hair`}, wearing ${wears}; it faces +z and stands on y = 0`,
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
