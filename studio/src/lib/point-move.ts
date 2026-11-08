// How a point (or several) moves in the model editor, made predictable: a point moves along one axis (an arrow of its handle, or X, Y
// or Z pressed while dragging), on one flat plane (a square of the handle, or Shift with the key), or, dragged by itself, on the flat grid
// plane the camera faces most (the floor seen from above, a wall seen from the front), never on a slanted plane that mixes all three.
// Everything here is in the part's own units, the numbers the inspector shows.

export type Vec3 = [number, number, number];
/// Which axes a move may change: one axis ("x"), a plane ("xz"), or all three ("xyz").
export type Lock = "x" | "y" | "z" | "xy" | "xz" | "yz" | "xyz";

export const AXIS_NAMES = ["x", "y", "z"] as const;
/// The axes' colours, as the handle draws them (red x, green y, blue z).
export const AXIS_COLOURS = [0xff5c5c, 0x6fcf6f, 0x5aa9ff] as const;
export const AXIS_CSS = ["#ff6b6b", "#7ad67a", "#6cb2ff"] as const;

/// The axis (0 x, 1 y, 2 z) that `view` (the way the camera looks, in the part's space) points along most: the flat plane across it is
/// the one a free drag moves on.
export function facingAxis(view: Vec3): 0 | 1 | 2 {
  const a = view.map(Math.abs);
  return a[1]! >= a[0]! && a[1]! >= a[2]! ? 1 : a[0]! >= a[2]! ? 0 : 2;
}

/// The plane a free drag uses: every axis but the one the camera faces.
export function freePlane(view: Vec3): Lock {
  return (["yz", "xz", "xy"] as const)[facingAxis(view)];
}

/// A key pressed during a drag: X, Y or Z locks the move to that axis, Shift with one of them to the plane across it, and the same key
/// again (or another) changes it; returns the new lock, or null if the key is not one of them.
export function lockForKey(key: string, shift: boolean, current: Lock | null): Lock | null | undefined {
  const k = key.toLowerCase();
  const i = AXIS_NAMES.indexOf(k as "x");
  if (i < 0) return undefined;
  const lock: Lock = shift ? (["yz", "xz", "xy"] as const)[i]! : AXIS_NAMES[i]!;
  return current === lock ? null : lock;
}

/// A raw movement kept to the locked axes and, with `step`, snapped (each axis on its own) so that a point starting at `from` lands on
/// the grid (from 0, a whole number of steps).
export function constrain(raw: Vec3, lock: Lock, step: number | null, from: Vec3 = [0, 0, 0]): Vec3 {
  return raw.map((v, i) => {
    if (!lock.includes(AXIS_NAMES[i]!)) return 0;
    if (!step) return Math.round(v * 100) / 100;
    const to = Math.round((from[i]! + v) / step) * step;
    return Math.round((to - from[i]!) * 100) / 100;
  }) as Vec3;
}

/// The middle of some points (where the move handle and the number boxes are for several points).
export function centreOf(verts: Vec3[], indices: number[]): Vec3 {
  const picked = indices.map((i) => verts[i]).filter((v): v is Vec3 => !!v);
  if (!picked.length) return [0, 0, 0];
  const s = picked.reduce((a, v) => [a[0] + v[0], a[1] + v[1], a[2] + v[2]] as Vec3, [0, 0, 0] as Vec3);
  return s.map((v) => Math.round((v / picked.length) * 100) / 100) as Vec3;
}

const num = (v: number) => String(Math.round(v * 100) / 100);
const signed = (v: number) => (v > 0 ? `+${num(v)}` : num(v));

/// What a move does, for the label by the pointer: each axis it changes, "y 4 → 6 (+2)"; "not moved" when it changes none.
export function describeMove(from: Vec3, delta: Vec3): string {
  const parts = [0, 1, 2].filter((i) => delta[i] !== 0).map((i) => `${AXIS_NAMES[i]} ${num(from[i]!)} → ${num(from[i]! + delta[i]!)} (${signed(delta[i]!)})`);
  return parts.length ? parts.join("   ") : "not moved";
}

/// A lock written out for the hint while dragging: "along y", "on the x–z floor", "on the x–y wall"...
export function describeLock(lock: Lock): string {
  if (lock.length === 1) return `along ${lock}`;
  if (lock === "xz") return "on the floor (x and z)";
  if (lock === "xy") return "on the front wall (x and y)";
  if (lock === "yz") return "on the side wall (y and z)";
  return "freely";
}
