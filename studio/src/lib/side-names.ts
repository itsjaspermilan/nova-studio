// Left and right in names: "left arm" pairs with "right arm", "arm_L" with "arm_R", "L hand" with "R hand". Used to mirror animations and skin weights.

export const sideOf = (name: string): "l" | "r" | null => (/left|(^|[_\- ])l($|[_\- ])/i.test(name) ? "l" : /right|(^|[_\- ])r($|[_\- ])/i.test(name) ? "r" : null);

/// The name with its side swapped (unchanged when it has none).
export function flipSide(name: string): string {
  if (!sideOf(name)) return name;
  if (/left/i.test(name)) return name.replace(/left/i, (m) => (m[0] === "L" ? "Right" : "right"));
  if (/right/i.test(name)) return name.replace(/right/i, (m) => (m[0] === "R" ? "Left" : "left"));
  return name.replace(/(^|[_\- ])([lLrR])($|[_\- ])/, (_m, a: string, c: string, b: string) => a + (c === "l" ? "r" : c === "L" ? "R" : c === "r" ? "l" : "L") + b);
}
