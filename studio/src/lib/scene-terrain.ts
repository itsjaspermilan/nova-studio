// The hills in the scene view (2026-11-08). A game gives its ground to `nova.terrain { waves = ..., heightmap = ... }`, usually from a
// setting of an object in the scene (Pine Ridge Rally's `race` object has a `terrain` prop): this finds the first object with such a
// `terrain` setting, works out the same heights as the engine (crates/nova-runtime/src/gfx.rs `Terrain::height`, heightmap.rs), draws
// the ground, and lifts every model drawn in the view by the height under each of its points, as the game's renderer does, so that a
// road ribbon follows the hills and a tree stands on them.

import * as THREE from "three";
import type { Scene } from "./scene-model";

export interface HeightmapSpec { path: string; x: number; z: number; size?: number; cell?: number; height: number }
export interface TerrainSpec {
  /// Each wave as [kx, kz, height, phase]: height * sin(kx * x + kz * z + phase).
  waves: [number, number, number, number][];
  heightmap?: HeightmapSpec;
}
/// A heightmap's samples, row by row from (x0, z0), `cell` metres apart.
export interface HeightGrid { w: number; rows: number; cell: number; x0: number; z0: number; heights: Float32Array<ArrayBuffer> }

const MAX_WAVES = 8;
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/// The ground of the scene: the `terrain` setting of the first object that has one, or null for flat ground.
export function terrainOf(scene: Scene): TerrainSpec | null {
  for (const o of scene.objects ?? []) {
    const t = (o.props as Record<string, unknown> | undefined)?.terrain as Record<string, unknown> | undefined;
    if (!t || typeof t !== "object") continue;
    const waves: TerrainSpec["waves"] = [];
    if (Array.isArray(t.waves)) {
      for (const w of t.waves.slice(0, MAX_WAVES) as Record<string, unknown>[]) {
        const length = num(w?.wavelength, 400);
        if (length < 10) continue;
        const k = (Math.PI * 2) / length;
        const a = (num(w?.direction, 0) * Math.PI) / 180;
        waves.push([k * Math.cos(a), k * Math.sin(a), num(w?.height, 5), num(w?.phase, 0)]);
      }
    }
    const spec: TerrainSpec = { waves };
    if (typeof t.heightmap === "string" && typeof t.height === "number" && (typeof t.size === "number" || typeof t.cell === "number")) {
      spec.heightmap = { path: t.heightmap, x: num(t.x, 0), z: num(t.z, 0), size: t.size as number | undefined, cell: t.cell as number | undefined, height: t.height };
    }
    if (waves.length || spec.heightmap) return spec;
  }
  return null;
}

/// A heightmap's samples from a picture's 8-bit RGBA pixels, as the engine reads an 8-bit RGB(A) picture: (R * 256 + G) / 65535 of
/// `height` (a grey picture, R = G, is grey / 255). (A 16-bit picture arrives here through the browser as 8 bits: close, not exact.)
export function gridFromPixels(rgba: Uint8ClampedArray, w: number, rows: number, spec: HeightmapSpec): HeightGrid {
  const heights = new Float32Array(w * rows);
  for (let i = 0; i < w * rows; i++) heights[i] = ((rgba[i * 4]! * 256 + rgba[i * 4 + 1]!) / 65535) * spec.height;
  const size = spec.size ?? (spec.cell ?? 1) * (w - 1);
  return { w, rows, cell: size / Math.max(1, w - 1), x0: spec.x, z0: spec.z, heights };
}

function gridHeight(g: HeightGrid, x: number, z: number): number {
  const fx = Math.min(Math.max((x - g.x0) / g.cell, 0), g.w - 1);
  const fz = Math.min(Math.max((z - g.z0) / g.cell, 0), g.rows - 1);
  const ix = Math.min(Math.floor(fx), g.w - 2 < 0 ? 0 : g.w - 2), iz = Math.min(Math.floor(fz), g.rows - 2 < 0 ? 0 : g.rows - 2);
  const tx = fx - ix, tz = fz - iz;
  const at = (cx: number, cz: number) => g.heights[Math.min(g.rows - 1, cz) * g.w + Math.min(g.w - 1, cx)]!;
  const top = at(ix, iz) + (at(ix + 1, iz) - at(ix, iz)) * tx;
  const bottom = at(ix, iz + 1) + (at(ix + 1, iz + 1) - at(ix, iz + 1)) * tx;
  return top + (bottom - top) * tz;
}

/// The ground's height at (x, z), as the engine works it out.
export function heightAt(t: TerrainSpec | null, grid: HeightGrid | null, x: number, z: number): number {
  if (!t) return 0;
  let h = 0;
  for (const [kx, kz, a, p] of t.waves) h += a * Math.sin(kx * x + kz * z + p);
  return grid ? h + gridHeight(grid, x, z) : h;
}

// ---- drawing ------------------------------------------------------------------------------------------------------------------
/// What the lifting shader reads; one set for the whole view, changed when the scene's ground changes.
export const lift = {
  waves: { value: Array.from({ length: MAX_WAVES }, () => new THREE.Vector4()) },
  count: { value: 0 },
  map: { value: null as THREE.DataTexture | null },
  mapOn: { value: 0 },
  mapInfo: { value: new THREE.Vector4() }, // x0, z0, cell, rows
  mapWidth: { value: 1 },
};

/// Points the lifting at a scene's ground (null: flat).
export function setLift(t: TerrainSpec | null, grid: HeightGrid | null) {
  const waves = t?.waves ?? [];
  lift.waves.value.forEach((v, i) => v.set(...(waves[i] ?? [0, 0, 0, 0])));
  lift.count.value = waves.length;
  lift.map.value?.dispose();
  if (grid) {
    const tex = new THREE.DataTexture(grid.heights, grid.w, grid.rows, THREE.RedFormat, THREE.FloatType);
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    lift.map.value = tex;
    lift.mapOn.value = 1;
    lift.mapInfo.value.set(grid.x0, grid.z0, grid.cell, grid.rows);
    lift.mapWidth.value = grid.w;
  } else {
    lift.map.value = null;
    lift.mapOn.value = 0;
  }
}

const LIFT_GLSL = /* glsl */ `
uniform vec4 novaWaves[${MAX_WAVES}];
uniform int novaWaveCount;
uniform sampler2D novaMap;
uniform int novaMapOn;
uniform vec4 novaMapInfo;
uniform float novaMapWidth;
float novaSample(int x, int z) {
  x = clamp(x, 0, int(novaMapWidth) - 1); z = clamp(z, 0, int(novaMapInfo.w) - 1);
  return texelFetch(novaMap, ivec2(x, z), 0).r;
}
float novaHeight(vec2 p) {
  float h = 0.0;
  for (int i = 0; i < ${MAX_WAVES}; i++) {
    if (i >= novaWaveCount) break;
    vec4 w = novaWaves[i];
    h += w.z * sin(w.x * p.x + w.y * p.y + w.w);
  }
  if (novaMapOn == 1) {
    float fx = clamp((p.x - novaMapInfo.x) / novaMapInfo.z, 0.0, novaMapWidth - 1.0);
    float fz = clamp((p.y - novaMapInfo.y) / novaMapInfo.z, 0.0, novaMapInfo.w - 1.0);
    int ix = int(min(floor(fx), max(novaMapWidth - 2.0, 0.0)));
    int iz = int(min(floor(fz), max(novaMapInfo.w - 2.0, 0.0)));
    float tx = fx - float(ix), tz = fz - float(iz);
    float top = mix(novaSample(ix, iz), novaSample(ix + 1, iz), tx);
    float bottom = mix(novaSample(ix, iz + 1), novaSample(ix + 1, iz + 1), tx);
    h += mix(top, bottom, tz);
  }
  return h;
}
`;

/// Makes a material lift what it draws by the ground's height under each point (in world space, after the object's own placement).
export function liftMaterial(m: THREE.Material) {
  if (m.userData.novaLift) return;
  m.userData.novaLift = true;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.novaWaves = lift.waves;
    shader.uniforms.novaWaveCount = lift.count;
    shader.uniforms.novaMap = lift.map;
    shader.uniforms.novaMapOn = lift.mapOn;
    shader.uniforms.novaMapInfo = lift.mapInfo;
    shader.uniforms.novaMapWidth = lift.mapWidth;
    shader.vertexShader = LIFT_GLSL + shader.vertexShader.replace(
      "#include <project_vertex>",
      /* glsl */ `
      vec4 novaWorld = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        novaWorld = instanceMatrix * novaWorld;
      #endif
      novaWorld = modelMatrix * novaWorld;
      novaWorld.y += novaHeight(novaWorld.xz);
      vec4 mvPosition = viewMatrix * novaWorld;
      gl_Position = projectionMatrix * mvPosition;`,
    );
  };
  m.customProgramCacheKey = () => "nova-lift";
  m.needsUpdate = true;
}

/// The ground as a mesh: `half` metres each way from (cx, cz), a point every `step` metres, in a quiet grass green.
export function groundMesh(t: TerrainSpec, grid: HeightGrid | null, cx: number, cz: number, half: number, step: number): THREE.Mesh {
  const n = Math.max(2, Math.round((half * 2) / step));
  const geometry = new THREE.PlaneGeometry(half * 2, half * 2, n, n).rotateX(-Math.PI / 2).translate(cx, 0, cz);
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(t, grid, pos.getX(i), pos.getZ(i)) - 0.05);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: 0x5a8a45 }));
  mesh.userData.ground = true;
  return mesh;
}
