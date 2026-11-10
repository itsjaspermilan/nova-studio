// Text as a shape: the letters of the built-in pixel font (lib/pixel-text.ts) stood up and given depth, as one mesh made of cubes with only the outside faces kept. Good for signs,
// titles and logos in a blocky game; the points are on a grid, so it can be reshaped, smoothed or given modifiers like any mesh.

import type { Cube, MeshFace, Vec3 } from "./model-doc";
import { drawText, textSize } from "./pixel-text";
import { newRaster } from "./pixels";

export const MAX_TEXT_MESH = 40;

/// A mesh element reading `text`: each lit pixel of the letters is a cube `pixel` units wide and `depth` units deep; the letters stand on the x-y plane, readable from +z, starting
/// at x = 0 and with their baseline at y = 0 (the top of a capital at 7 pixels). A new line goes under the first. Returns null for empty text; the text is cut at MAX_TEXT_MESH
/// characters.
export function textToMesh(text: string, pixel = 1, depth = 2, color = "#c9d1d9"): Cube | null {
  const clean = text.slice(0, MAX_TEXT_MESH);
  if (!clean.trim()) return null;
  const size = textSize(clean);
  const r = newRaster(size.w, size.h);
  drawText(r, 0, 0, clean, [255, 255, 255, 255]);
  const lit = (x: number, y: number) => x >= 0 && y >= 0 && x < r.w && y < r.h && r.data[(y * r.w + x) * 4 + 3]! > 0;
  const verts: Vec3[] = [];
  const index = new Map<string, number>();
  const corner = (x: number, y: number, z: number) => {
    const key = `${x},${y},${z}`;
    let i = index.get(key);
    if (i === undefined) {
      i = verts.push([x * pixel, (r.h - y) * pixel, z * depth]) - 1; // the picture's rows run down; the model's y runs up
      index.set(key, i);
    }
    return i;
  };
  const polys: MeshFace[] = [];
  const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3) => polys.push({ v: [corner(...a), corner(...b), corner(...c), corner(...d)] });
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      if (!lit(x, y)) continue;
      // the cube spans x..x+1 across, rows y..y+1 (which is up-side-down in model space), z 0..1 in depth units. Faces are wound anticlockwise seen from outside.
      // front (+z): seen from +z with y up: bottom-left, bottom-right, top-right, top-left
      quad([x, y + 1, 1], [x + 1, y + 1, 1], [x + 1, y, 1], [x, y, 1]);
      // back (-z)
      quad([x + 1, y + 1, 0], [x, y + 1, 0], [x, y, 0], [x + 1, y, 0]);
      if (!lit(x - 1, y)) quad([x, y + 1, 0], [x, y + 1, 1], [x, y, 1], [x, y, 0]); // left (-x)
      if (!lit(x + 1, y)) quad([x + 1, y + 1, 1], [x + 1, y + 1, 0], [x + 1, y, 0], [x + 1, y, 1]); // right (+x)
      if (!lit(x, y - 1)) quad([x, y, 1], [x + 1, y, 1], [x + 1, y, 0], [x, y, 0]); // top (+y)
      if (!lit(x, y + 1)) quad([x, y + 1, 0], [x + 1, y + 1, 0], [x + 1, y + 1, 1], [x, y + 1, 1]); // bottom (-y)
    }
  }
  const xs = verts.map((p) => p[0]), ys = verts.map((p) => p[1]), zs = verts.map((p) => p[2]);
  const from: Vec3 = [Math.min(...xs), Math.min(...ys), Math.min(...zs)];
  const sizeV: Vec3 = [Math.max(...xs) - from[0], Math.max(...ys) - from[1], Math.max(...zs) - from[2]];
  return { name: clean.length > 12 ? `${clean.slice(0, 12)}…` : clean, shape: "mesh", from, size: sizeV, color, verts, polys };
}
