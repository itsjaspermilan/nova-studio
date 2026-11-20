// creature3d_make: three small rigs in the characters' style: a four-legged animal that trots, a bird that struts and a
// blob that hops. Each has idle, move and hurt. The legs' steps are made by model_write's `walk`, so they do not slide.

import { colourOf, toHex } from "./paint";
import { choice, Mesh3, modelDoc, part, tone, U, type Args, type V3 } from "./kit3d";

export const CREATURES3D = ["quadruped", "bird", "blob"] as const;

export interface Creature3d {
  model: Args;
  parts: string[];
  clips: { name: string; duration: number; loop: boolean }[];
  speed: number;
  capsule: { radius: number; height: number };
  says: string;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const key = (t: number, value: V3, ease = "inout") => ({ t: r3(t), value, ease });
const still = () => 0.5;

export function makeCreature3d(a: Args): Creature3d {
  const kind = choice(a.kind, CREATURES3D, "a creature's kind");
  const k = a.size === undefined ? 1 : Number(a.size);
  if (!(k >= 0.5 && k <= 3)) throw new Error("size is a factor on the creature's own size, from 0.5 to 3");
  const col = (v: unknown, what: string, fallback: string) => toHex(colourOf(v, what, fallback));
  const rot = (p: string[], keys: Args[]) => ({ part: p, prop: "rotation", keys });
  const scl = (p: string[], keys: Args[]) => ({ part: p, prop: "scale", keys });

  if (kind === "blob") {
    const c = col(a.color, "color", "green"), c2 = col(a.second_color, "second_color", "#2a2430");
    const body = new Mesh3(c, { bend: false });
    const R = 0.42 * k;
    const rings: { y: number; rx: number }[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = (Math.PI / 2) * (i / 6);
      rings.push({ y: Math.sin(t) * R * 0.95, rx: Math.cos(t) * R * (1 + 0.12 * Math.cos(t * 2)) });
    }
    body.rings([{ y: 0, rx: R * 0.86 }, ...rings.map((r, i) => (i === 0 ? { y: R * 0.12, rx: R * 1.04 } : r))], 12, (i) => tone(c, -0.6 + i * 0.28), { smooth: true });
    const face = new Mesh3(c2, { bend: false });
    for (const s of [-1, 1]) {
      face.box([s * R * 0.3, R * 0.52, R * 0.8], [R * 0.16, R * 0.22, R * 0.1], c2, { flat: true });
      face.box([s * R * 0.3 + R * 0.03, R * 0.58, R * 0.84], [R * 0.05, R * 0.06, R * 0.04], "#ffffff", { flat: true });
    }
    const shine = new Mesh3(tone(c, 1.8), { bend: false });
    shine.blob([-R * 0.3, R * 0.72, R * 0.35], [R * 0.14, R * 0.08, R * 0.1], tone(c, 1.8), still, { seg: 6, rows: 2, jitter: 0, tones: 0 });
    const hop = 0.7;
    const clips = [
      { name: "idle", duration: 1.6, loop: true, tracks: [scl(["body"], [key(0, [1, 1, 1]), key(0.8, [1.06, 0.92, 1.06]), key(1.6, [1, 1, 1])])] },
      {
        name: "move", duration: hop, loop: true,
        tracks: [
          scl(["body"], [key(0, [1.18, 0.74, 1.18], "out"), key(hop * 0.2, [0.86, 1.22, 0.86]), key(hop * 0.55, [0.95, 1.08, 0.95]), key(hop * 0.85, [1.05, 0.95, 1.05], "in"), key(hop, [1.18, 0.74, 1.18])]),
          { part: ["body"], prop: "position", keys: [key(0, [0, 0, 0], "out"), key(hop * 0.5, [0, r3(R * 0.7 * U), 0], "in"), key(hop * 0.9, [0, 0, 0]), key(hop, [0, 0, 0])] },
        ],
        events: [{ t: r3(hop * 0.9), name: "step" }],
      },
      { name: "hurt", duration: 0.4, loop: false, tracks: [scl(["body"], [key(0, [1, 1, 1], "out"), key(0.1, [1.35, 0.55, 1.35]), key(0.4, [1, 1, 1])])] },
    ];
    return {
      model: modelDoc([part("body", [0, 0, 0], [body, face, shine])], { clips }),
      parts: ["body"], clips: clips.map((cl) => ({ name: cl.name, duration: cl.duration, loop: cl.loop })), speed: r3(1.4 * k),
      capsule: { radius: r3(R * 0.9), height: r3(Math.max(R * 1.9, R * 1.8 + 0.01)) },
      says: `a blob ${r3(R * 2)} m across that squashes and hops (one hop every ${hop} s, with a "step" event as it lands)`,
    };
  }

  if (kind === "quadruped") {
    const c = col(a.color, "color", "orange"), c2 = col(a.second_color, "second_color", "cream");
    const up = 0.2 * k, lo = 0.2 * k, ank = 0.045 * k, hip = up + lo + ank, half = 0.3 * k, w = 0.11 * k;
    const body = new Mesh3(c, { bend: false });
    body.tube([[0, 0.02 * k, -half - 0.06 * k], [0, 0.05 * k, -half * 0.4], [0, 0.04 * k, half * 0.5], [0, 0.07 * k, half + 0.1 * k]], [0.1 * k, 0.15 * k, 0.16 * k, 0.11 * k], 9, (i, j) => (j >= 5 && j <= 8 ? c2 : tone(c, i * 0.1)), { smooth: true, squash: 1.1 });
    const head = new Mesh3(c, { bend: false });
    head.blob([0, 0.06 * k, 0.08 * k], [0.12 * k, 0.11 * k, 0.13 * k], c, still, { seg: 8, rows: 4, jitter: 0, tones: 0 });
    head.rings([{ y: 0, rx: 0.075 * k, rz: 0.06 * k }, { y: 0.14 * k, rx: 0.03 * k, rz: 0.03 * k }], 6, c2, { at: [0, 0.03 * k, 0.17 * k], smooth: true }).turn(0);
    // (the muzzle: a short cone laid forward)
    const muzzle = new Mesh3(c2, { bend: false });
    muzzle.tube([[0, 0.035 * k, 0.15 * k], [0, 0.02 * k, 0.29 * k]], [0.07 * k, 0.03 * k], 7, c2, { smooth: true });
    muzzle.box([0, 0.03 * k, 0.3 * k], [0.035 * k, 0.03 * k, 0.03 * k], "#2a2430", { flat: true });
    for (const s of [-1, 1]) {
      head.rings([{ y: 0, rx: 0.045 * k, rz: 0.025 * k }, { y: 0.13 * k, rx: 0, cx: s * 0.015 * k }], 4, (i) => tone(c, i ? -0.2 : -0.6), { at: [s * 0.075 * k, 0.13 * k, 0.03 * k] });
      muzzle.box([s * 0.055 * k, 0.085 * k, 0.17 * k], [0.026 * k, 0.034 * k, 0.02 * k], "#2a2430", { flat: true });
    }
    const tail = new Mesh3(c, { bend: false });
    tail.tube([[0, 0, 0], [0, 0.07 * k, -0.16 * k], [0, 0.16 * k, -0.3 * k], [0, 0.2 * k, -0.4 * k]], [0.045 * k, 0.075 * k, 0.065 * k, 0.015 * k], 7, (i) => (i >= 2 ? c2 : c), { smooth: true });
    const leg = (name: string, x: number, z: number) => {
      const m = new Mesh3(c, { bend: true });
      m.rings([{ y: 0.03 * k, rx: 0.055 * k }, { y: -up * 0.5, rx: 0.05 * k }, { y: -up + 0.02 * k, rx: 0.04 * k }, { y: -up, rx: 0.038 * k }, { y: -up - 0.02 * k, rx: 0.036 * k }, { y: -up - lo * 0.6, rx: 0.032 * k }, { y: -up - lo, rx: 0.03 * k }], 7, (i) => (i >= 4 ? tone(c, -1.4) : c), { smooth: true });
      const paw = new Mesh3(tone(c, -1.4), { bend: false });
      paw.box([0, -ank / 2, 0.02 * k], [0.07 * k, ank, 0.11 * k], tone(c, -1.4), { taper: [0.85, 0.8] });
      return part(`leg_${name}`, [x, hip - (0.42 * k), z], [m], [part(`shin_${name}`, [0, -up, 0], [], [part(`foot_${name}`, [0, -lo, 0], [paw])])]);
    };
    const bodyY = 0.42 * k;
    const parts = [
      part("body", [0, bodyY, 0], [body], [
        part("head", [0, 0.1 * k, half + 0.1 * k], [head, muzzle]),
        part("tail", [0, 0.04 * k, -half - 0.08 * k], [tail]),
        leg("fl", w, half * 0.82), leg("fr", -w, half * 0.82), leg("bl", w, -half * 0.86), leg("br", -w, -half * 0.86),
      ]),
    ];
    const D = 0.5, stride = 0.3 * k;
    const clips: Args[] = [
      {
        name: "idle", duration: 2.2, loop: true,
        tracks: [rot(["body", "head"], [key(0, [0, 0, 0]), key(0.7, [-6, 12, 0]), key(1.5, [4, -10, 0]), key(2.2, [0, 0, 0])]), rot(["body", "tail"], [key(0, [0, -14, 0]), key(0.55, [0, 14, 0]), key(1.1, [0, -14, 0]), key(1.65, [0, 14, 0]), key(2.2, [0, -14, 0])])],
      },
      {
        name: "move", duration: D, loop: true,
        tracks: [rot(["body", "head"], [key(0, [3, 0, 0]), key(D / 4, [-3, 0, 0]), key(D / 2, [3, 0, 0]), key((D * 3) / 4, [-3, 0, 0]), key(D, [3, 0, 0])]), rot(["body", "tail"], [key(0, [-10, -12, 0]), key(D / 2, [-10, 12, 0]), key(D, [-10, -12, 0])])],
        walk: { legs: [{ ankle: "foot_fl", phase: 0 }, { ankle: "foot_br", phase: 0.04 }, { ankle: "foot_fr", phase: 0.5 }, { ankle: "foot_bl", phase: 0.54 }], stride: r3(stride * U), lift: r3(0.07 * k * U), stance: 0.5, bob: 0.6, event: "step" },
      },
      { name: "hurt", duration: 0.4, loop: false, tracks: [rot(["body", "head"], [key(0, [0, 0, 0], "out"), key(0.1, [-24, 0, 10]), key(0.4, [0, 0, 0])]), rot(["body", "tail"], [key(0, [0, 0, 0], "out"), key(0.1, [30, 0, 0]), key(0.4, [0, 0, 0])])] },
    ];
    return {
      model: modelDoc(parts, { clips }),
      parts: ["body", "head", "tail", "leg_fl", "shin_fl", "foot_fl", "leg_fr", "shin_fr", "foot_fr", "leg_bl", "shin_bl", "foot_bl", "leg_br", "shin_br", "foot_br"],
      clips: clips.map((cl) => ({ name: cl.name, duration: cl.duration, loop: !!cl.loop })), speed: r3(stride / (0.5 * D)),
      capsule: { radius: r3(0.3 * k), height: r3(Math.max(0.62 * k, 0.61 * k + 0.01)) },
      says: `a four-legged animal ${r3((half * 2 + 0.5 * k))} m long and ${r3(0.66 * k)} high that trots (a fox by its colours; "step" events as the feet land)`,
    };
  }

  // a bird
  const c = col(a.color, "color", "blue"), c2 = col(a.second_color, "second_color", "yellow");
  const up = 0.09 * k, lo = 0.1 * k, ank = 0.02 * k, hip = up + lo + ank, bodyY = hip + 0.1 * k;
  const body = new Mesh3(c, { bend: false });
  body.blob([0, 0.03 * k, -0.02 * k], [0.14 * k, 0.15 * k, 0.19 * k], c, still, { seg: 8, rows: 4, jitter: 0, tones: 0.0 });
  body.blob([0, -0.01 * k, 0.07 * k], [0.1 * k, 0.1 * k, 0.11 * k], tone(c2, 0.8), still, { seg: 7, rows: 3, jitter: 0, tones: 0 });
  body.tube([[0, 0.04 * k, -0.16 * k], [0, 0.1 * k, -0.34 * k]], [0.07 * k, 0.02 * k], 5, tone(c, -0.7), { squash: 0.35 });
  const head = new Mesh3(c, { bend: false });
  head.blob([0, 0.07 * k, 0.02 * k], [0.095 * k, 0.095 * k, 0.1 * k], c, still, { seg: 8, rows: 4, jitter: 0, tones: 0 });
  head.tube([[0, 0.06 * k, 0.1 * k], [0, 0.045 * k, 0.2 * k]], [0.035 * k, 0.006 * k], 5, c2);
  for (const s of [-1, 1]) head.box([s * 0.07 * k, 0.09 * k, 0.065 * k], [0.02 * k, 0.03 * k, 0.03 * k], "#2a2430", { flat: true });
  const wing = (s: number) => {
    const m = new Mesh3(tone(c, -0.6), { bend: false });
    m.blob([s * 0.02 * k, -0.06 * k, -0.04 * k], [0.03 * k, 0.1 * k, 0.16 * k], tone(c, -0.6), still, { seg: 6, rows: 3, jitter: 0, tones: 0 });
    return part(`wing_${s > 0 ? "l" : "r"}`, [s * 0.13 * k, 0.1 * k, 0], [m]);
  };
  const leg = (name: string, x: number) => {
    const m = new Mesh3(c2, { bend: true });
    m.rings([{ y: 0.01 * k, rx: 0.02 * k }, { y: -up, rx: 0.014 * k }, { y: -up - lo, rx: 0.012 * k }], 5, c2, { smooth: true });
    const foot = new Mesh3(c2, { bend: false });
    foot.box([0, -ank / 2, 0.03 * k], [0.06 * k, ank, 0.1 * k], tone(c2, -0.4), { taper: [0.7, 0.8] });
    return part(`leg_${name}`, [x, hip - bodyY, 0], [m], [part(`shin_${name}`, [0, -up, 0], [], [part(`foot_${name}`, [0, -lo, 0], [foot])])]);
  };
  const parts = [part("body", [0, bodyY, 0], [body], [part("head", [0, 0.13 * k, 0.1 * k], [head]), wing(1), wing(-1), leg("l", 0.06 * k), leg("r", -0.06 * k)])];
  const D = 0.4, stride = 0.14 * k;
  const flap = (deg: number, t: number[]) => [rot(["body", "wing_l"], t.map((x, i) => key(x, [0, 0, i % 2 ? deg : 0]))), rot(["body", "wing_r"], t.map((x, i) => key(x, [0, 0, i % 2 ? -deg : 0])))];
  const clips: Args[] = [
    { name: "idle", duration: 2, loop: true, tracks: [rot(["body", "head"], [key(0, [0, 0, 0]), key(0.3, [0, 30, 0], "step"), key(0.9, [0, 30, 0]), key(1.1, [8, -25, 0], "step"), key(1.7, [8, -25, 0]), key(2, [0, 0, 0])]), ...flap(8, [0, 1, 2])] },
    { name: "move", duration: D, loop: true, tracks: [rot(["body", "head"], [key(0, [8, 0, 0]), key(D / 4, [-6, 0, 0]), key(D / 2, [8, 0, 0]), key((D * 3) / 4, [-6, 0, 0]), key(D, [8, 0, 0])]), ...flap(14, [0, D / 2, D])], walk: { legs: ["foot_l", "foot_r"], stride: r3(stride * U), lift: r3(0.04 * k * U), stance: 0.55, bob: 0.7, event: "step" } },
    { name: "hurt", duration: 0.4, loop: false, tracks: [...flap(70, [0, 0.1, 0.4]), rot(["body", "head"], [key(0, [0, 0, 0], "out"), key(0.1, [-25, 0, 0]), key(0.4, [0, 0, 0])])] },
  ];
  return {
    model: modelDoc(parts, { clips }),
    parts: ["body", "head", "wing_l", "wing_r", "leg_l", "shin_l", "foot_l", "leg_r", "shin_r", "foot_r"],
    clips: clips.map((cl) => ({ name: cl.name, duration: cl.duration, loop: !!cl.loop })), speed: r3(stride / (0.55 * D)),
    capsule: { radius: r3(0.16 * k), height: r3(Math.max(0.5 * k, 0.33 * k)) },
    says: `a bird ${r3(0.5 * k)} m high that struts and flaps ("step" events as its feet land)`,
  };
}
