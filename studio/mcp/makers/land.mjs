// land_make: the ground under a racing game's circuits (first Pine Ridge Rally's models/land_*.glb, made by scripts/rally/land.mjs), as a grid
// of small squares: the shader lifts every vertex by the height of the hills under it (`nova.terrain`), so a flat plane of four corners would
// not follow them. CELLS x CELLS squares of CELL metres, centred on the origin (a game draws it at the camera, snapped to a whole TILE: Pine
// Ridge's lib/horizon.lua), so that neither the squares nor the picture slide over the hills as the camera moves.
// Written as glTF directly. The ground has one colour (its tint), a normal straight up (the shader leans it with the slope), and two pictures it
// names by `uri`, made by surface_make: a base picture TILE metres across (patches of dry grass, drifts, ripples) and a detail picture REPEAT
// times in a tile (blades, grains, crystals; the material's `extras.nova.detail`). The tint is divided by the base picture's average
// (textures/means.json), so the ground keeps the colour it had before it was textured.
// @ts-ignore (plain JavaScript, shared with the studio's track editor)
import { packGlb } from "../../../scripts/lib/trackgen.mjs";

/// The kinds of ground: tint, base picture, detail picture.
export const GROUNDS = {
  grass: { colour: "#4f8a3c", base: "ground_grass", detail: "grass_detail" },
  autumn: { colour: "#8c7a34", base: "ground_autumn", detail: "leaves_detail" },
  sand: { colour: "#d9b277", base: "ground_sand", detail: "sand_detail" },
  snow: { colour: "#eaf0f6", base: "ground_snow", detail: "snow_detail" },
  // (night courses are grass in the dark: the grass pictures under a dark tint)
  night: { colour: "#1e2a38", base: "ground_grass", detail: "grass_detail" },
};

const linear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const colour = (hex) => [1, 3, 5].map((i) => linear(parseInt(hex.slice(i, i + 2), 16) / 255));

/// The ground as a .glb. `means` are the base pictures' mean colours (textures/means.json); `o`: { cells, cell, top, tile, repeat }.
export function landGlb({ colour: hex, base, detail }, means, o = {}) {
  const CELLS = o.cells ?? 50, CELL = o.cell ?? 16, TOP = o.top ?? -0.25, TILE = o.tile ?? 64, REPEAT = o.repeat ?? 8;
  if (!means[base]) throw new Error(`textures/means.json has no mean for ${base}: make the pictures with surface_make first`);
  const n = CELLS + 1;
  const positions = new Float32Array(n * n * 3), normals = new Float32Array(n * n * 3), colors = new Float32Array(n * n * 4), uvs = new Float32Array(n * n * 2);
  const rgb = colour(hex).map((c, i) => Math.min(1, c / means[base][i]));
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i;
    positions.set([(i - CELLS / 2) * CELL, TOP, (j - CELLS / 2) * CELL], k * 3);
    normals.set([0, 1, 0], k * 3);
    colors.set([...rgb, 1], k * 4);
    uvs.set([(i * CELL) / TILE, (j * CELL) / TILE], k * 2);
  }
  const indices = new Uint32Array(CELLS * CELLS * 6);
  let t = 0;
  for (let j = 0; j < CELLS; j++) for (let i = 0; i < CELLS; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    indices.set([a, c, b, b, c, d], t); // counter-clockwise seen from above (+y)
    t += 6;
  }
  return packGlb({
    asset: { version: "2.0", generator: "nova scripts/rally/land.mjs" },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: "land", mesh: 0 }],
    meshes: [{ name: "land", primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2, TEXCOORD_0: 3 }, indices: 4, material: 0, mode: 4 }] }],
    materials: [{ name: "land", pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 }, extras: { nova: { detail: { index: 1, scale: [REPEAT, REPEAT] } } } }],
    textures: [{ source: 0, sampler: 0 }, { source: 1, sampler: 0 }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    images: [{ uri: `../textures/${base}.png` }, { uri: `../textures/${detail}.png` }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: n * n, type: "VEC3", min: [-CELLS * CELL / 2, TOP, -CELLS * CELL / 2], max: [CELLS * CELL / 2, TOP, CELLS * CELL / 2] },
      { bufferView: 1, componentType: 5126, count: n * n, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: n * n, type: "VEC4" },
      { bufferView: 3, componentType: 5126, count: n * n, type: "VEC2" },
      { bufferView: 4, componentType: 5125, count: indices.length, type: "SCALAR" },
    ],
  }, [positions, normals, colors, uvs, indices]);
}
