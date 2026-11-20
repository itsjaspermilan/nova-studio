// The makers' two styles: "classic" (16 px tiles at 3x, 16x24 bodies: the look the makers had first) and "detailed"
// (32 px tiles at 1.5x, 32x48 bodies in 64x64 frames, drawn with more tones, selective outlines, form shading and light).
// Both are the same size on the screen; the detailed one has twice the pixels.

export const STYLES = ["classic", "detailed"];

export function styleOf(a: Record<string, unknown>): "classic" | "detailed" {
  if (a.style === undefined || a.style === null || a.style === "") return "classic";
  const s = String(a.style).trim().toLowerCase();
  if (s === "detailed" || s === "hd" || s === "2") return "detailed";
  if (s === "classic" || s === "1") return "classic";
  throw new Error(`"style" is "classic" (16 px tiles, drawn at 3) or "detailed" (32 px tiles drawn at 1.5: twice the pixels, the same size on the screen); got '${a.style}'`);
}

export const STYLE_OPTION = {
  type: "string",
  description:
    '"detailed" draws twice the pixels at the same size on the screen: 32 px tiles (a scene layer\'s "scale": 1.5), a 32x48 body in 64x64 frames, creatures and 32x32 icons to match, with more tones, form shading, selective outlines, rim light and layered glow. "classic" (when left out) is the 16 px look.',
};
