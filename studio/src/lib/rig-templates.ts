// Starting models with a skeleton: the parts are named and nested the way an animation expects (hips, spine, head, left and right arms and legs), each a plain
// box so it can be reshaped. Left is the +x side. Units are the model's own (16 to a metre by default).

import { newModel, type Cube, type ModelDoc, type Part, type Vec3 } from "./model-doc";

export type RigKind = "humanoid" | "quadruped" | "car";
export const RIG_KINDS: { id: RigKind; name: string; blurb: string }[] = [
  { id: "humanoid", name: "Person", blurb: "Hips, spine, head, two arms (shoulder, forearm, hand) and two legs (thigh, shin, foot): 15 parts, ready to pose and animate" },
  { id: "quadruped", name: "Four-legged animal", blurb: "Body, neck, head, tail and four legs with an upper and a lower part" },
  { id: "car", name: "Car", blurb: "A body with a cabin and four wheels that turn" },
];

const box = (from: Vec3, size: Vec3, color: string, name?: string): Cube => ({ ...(name ? { name } : {}), from, size, color });
const part = (name: string, origin: Vec3, cubes: Cube[], children: Part[] = []): Part => ({ name, origin, rotation: [0, 0, 0], cubes, children });

/// An arm or a leg hanging down from its pivot: upper part, lower part and an end (hand or foot), each `len` long.
function limb(side: "left" | "right", kind: "arm" | "leg", origin: Vec3, color: string, skin: string): Part {
  const w = kind === "arm" ? 3 : 4;
  const len = kind === "arm" ? 6 : 7;
  const endName = kind === "arm" ? "hand" : "foot";
  const lower = kind === "arm" ? "forearm" : "shin";
  const end = kind === "arm"
    ? part(`${side} ${endName}`, [0, -len, 0], [box([-1.5, -2, -1.5], [3, 2, 3], skin)])
    : part(`${side} ${endName}`, [0, -len, 0], [box([-2, -2, -3], [4, 2, 6], "#3a3a44")]);
  return part(`${side} ${kind === "arm" ? "arm" : "thigh"}`, origin, [box([-w / 2, -len, -w / 2], [w, len, w], color)], [
    part(`${side} ${lower}`, [0, -len, 0], [box([-w / 2, -len, -w / 2], [w, len, w], color)], [end]),
  ]);
}

function humanoid(): Part[] {
  const shirt = "#4f7fd1";
  const trousers = "#3d4660";
  const skin = "#e0b08a";
  const spine = part("spine", [0, 2, 0], [box([-4, 0, -2], [8, 8, 4], shirt)], [
    part("head", [0, 8, 0], [box([-4, 0, -4], [8, 8, 8], skin)]),
    limb("left", "arm", [5.5, 7, 0], shirt, skin),
    limb("right", "arm", [-5.5, 7, 0], shirt, skin),
  ]);
  return [part("hips", [0, 14, 0], [box([-4, -2, -2], [8, 4, 4], trousers)], [spine, limb("left", "leg", [2, -2, 0], trousers, skin), limb("right", "leg", [-2, -2, 0], trousers, skin)])];
}

function quadruped(): Part[] {
  const coat = "#a8794f";
  const dark = "#6e4a2f";
  const leg = (name: string, origin: Vec3): Part =>
    part(`${name} thigh`, origin, [box([-1.5, -4, -1.5], [3, 4, 3], coat)], [part(`${name} shin`, [0, -4, 0], [box([-1.25, -5, -1.25], [2.5, 5, 2.5], coat)], [part(`${name} hoof`, [0, -5, 0], [box([-1.5, -1, -1.5], [3, 1, 3], dark)])])]);
  return [part("body", [0, 9, 0], [box([-4, -3, -8], [8, 6, 16], coat)], [
    part("neck", [0, 1, 8], [box([-2, 0, 0], [4, 5, 4], coat)], [part("head", [0, 5, 2], [box([-2.5, -2, -1], [5, 5, 7], coat)])]),
    part("tail", [0, 2, -8], [box([-1, -1, -5], [2, 2, 5], dark)]),
    leg("front left", [2.5, -3, 6]), leg("front right", [-2.5, -3, 6]), leg("back left", [2.5, -3, -6]), leg("back right", [-2.5, -3, -6]),
  ])];
}

function car(): Part[] {
  const wheel = (name: string, origin: Vec3): Part => part(name, origin, [{ shape: "cylinder", from: [-1.5, -3, -3], size: [3, 6, 6], rotation: [0, 0, 90], color: "#22252b" }]);
  return [part("body", [0, 4, 0], [box([-6, -1, -12], [12, 4, 24], "#c0392b")], [
    part("cabin", [0, 3, -1], [box([-5, 0, -6], [10, 4, 11], "#9fb4c7")]),
    wheel("front left wheel", [6.5, -1, 8]), wheel("front right wheel", [-6.5, -1, 8]), wheel("back left wheel", [6.5, -1, -8]), wheel("back right wheel", [-6.5, -1, -8]),
  ])];
}

/// A new model with the skeleton of the kind.
export function rigTemplate(kind: RigKind): ModelDoc {
  const parts = kind === "humanoid" ? humanoid() : kind === "quadruped" ? quadruped() : car();
  return { ...newModel(), parts };
}
