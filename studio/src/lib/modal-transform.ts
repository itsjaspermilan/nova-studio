// Blender's "press a key, then move the mouse" transforms (G grab, S scale): the shape follows the mouse until a click or Enter keeps it,
// Esc or the right button puts it back, X, Y or Z holds it to one axis, and a typed number sets the amount exactly.
// This is the arithmetic, apart from the editor: what the mouse movement and the typed keys come to.

export type Axis = "x" | "y" | "z" | null;
export type Vec3 = [number, number, number];

const UNIT: Record<"x" | "y" | "z", Vec3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const;

/// A number typed while transforming: "2", "-1.5", ".5"; null while it is not a number yet ("", "-", ".").
export function parseTyped(buffer: string): number | null {
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(buffer)) return null;
  const n = Number(buffer);
  return Number.isFinite(n) ? n : null;
}

/// What a key does to the typed text: digits, one point and a leading minus are added, Backspace removes one, "-" flips the sign.
export function typeKey(buffer: string, key: string): string {
  if (/^\d$/.test(key)) return buffer + key;
  if (key === "." && !buffer.includes(".")) return buffer + ".";
  if (key === "-") return buffer.startsWith("-") ? buffer.slice(1) : "-" + buffer;
  if (key === "Backspace") return buffer.slice(0, -1);
  return buffer;
}

/// The axis a key asks for: pressing the same axis again lets go of it.
export function axisKey(current: Axis, key: string): Axis | undefined {
  const k = key.toLowerCase();
  if (k !== "x" && k !== "y" && k !== "z") return undefined;
  return current === k ? null : k;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/// The move for a mouse movement of (dx, dy) pixels: along the view's right and up directions (the screen plane), or, with an axis,
/// only the part of it along that axis. A typed amount replaces the mouse: it goes along the axis (the x axis when none is held).
export function moveDelta(right: Vec3, up: Vec3, dx: number, dy: number, perPixel: number, axis: Axis, typed: number | null): Vec3 {
  if (typed !== null) {
    const v: Vec3 = [0, 0, 0];
    v[AXIS_INDEX[axis ?? "x"]] = typed;
    return v;
  }
  const free: Vec3 = [(right[0] * dx - up[0] * dy) * perPixel, (right[1] * dx - up[1] * dy) * perPixel, (right[2] * dx - up[2] * dy) * perPixel];
  if (!axis) return free;
  const u = UNIT[axis];
  const amount = dot(free, u);
  return [u[0] * amount, u[1] * amount, u[2] * amount];
}

/// The factor for a mouse movement to the right (to the left shrinks); a typed number is the factor itself.
export function scaleFactor(dx: number, typed: number | null): number {
  const f = typed ?? 1 + dx * 0.01;
  return Math.max(0.01, f);
}

/// A box (from, to) made bigger or smaller about its middle: in every direction, or only along one axis.
export function scaleBox(from: Vec3, to: Vec3, factor: number, axis: Axis): { from: Vec3; to: Vec3 } {
  const a = [...from] as Vec3;
  const b = [...to] as Vec3;
  for (const i of axis ? [AXIS_INDEX[axis]] : [0, 1, 2]) {
    const mid = (from[i]! + to[i]!) / 2;
    const half = ((to[i]! - from[i]!) / 2) * factor;
    a[i] = mid - half;
    b[i] = mid + half;
  }
  return { from: a, to: b };
}

export const round2 = (v: number) => Math.round(v * 100) / 100;

/// The line shown while a transform is going: "Move · X · 2.5".
export function modalLabel(kind: "move" | "scale", axis: Axis, typed: string, amount: string): string {
  const name = kind === "move" ? "Move" : "Resize";
  return [name, axis ? axis.toUpperCase() : "free", typed || amount, "click or Enter keeps · Esc cancels"].join(" · ");
}
