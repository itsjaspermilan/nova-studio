// Layers for a model's painted texture. The game still reads one picture (`<model>.texture.png`): the layers flattened. The layers themselves are kept in
// `<model>.texture.layerN.png` beside it, listed (name, shown, opacity, blend) in the model file's `texture.layers`, so painting can be reopened and changed.

import type { TexLayerInfo } from "./model-doc";
import { cloneRaster, composite, newRaster, type BlendMode, type Raster, BLEND_MODES } from "./pixels";

export const MAX_TEX_LAYERS = 8;
export type LayerSet = { info: TexLayerInfo[]; rasters: Raster[] };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/// A layer's own name, made unique in the set ("Layer", "Layer 2", ...).
function freshName(info: TexLayerInfo[], base: string): string {
  const used = new Set(info.map((l) => l.name));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base} ${n}`)) return `${base} ${n}`;
}

/// The layers flattened, bottom first, into a picture of the size of the first (hidden layers skipped; each layer's opacity and blend mode applied).
export function flatten(set: LayerSet): Raster {
  const base = set.rasters[0];
  if (!base) return newRaster(1, 1);
  let out = newRaster(base.w, base.h);
  set.rasters.forEach((r, i) => {
    const l = set.info[i];
    if (!l || l.visible === false || r.w !== out.w || r.h !== out.h) return;
    out = composite(out, r, clamp01(l.opacity ?? 1), (l.blend ?? "normal") as BlendMode);
  });
  return out;
}

/// A set with one layer holding the picture as it is.
export const singleLayer = (picture: Raster): LayerSet => ({ info: [{ name: "Layer" }], rasters: [picture] });

/// A new empty layer above `at` (or on top). The set as it was when there are already the most.
export function addLayer(set: LayerSet, w: number, h: number, at = set.rasters.length - 1): LayerSet {
  if (set.rasters.length >= MAX_TEX_LAYERS) return set;
  const i = Math.min(set.rasters.length, Math.max(0, at + 1));
  const info = [...set.info];
  const rasters = [...set.rasters];
  info.splice(i, 0, { name: freshName(set.info, "Layer") });
  rasters.splice(i, 0, newRaster(w, h));
  return { info, rasters };
}

/// A copy of a layer, just above it.
export function duplicateLayer(set: LayerSet, at: number): LayerSet {
  if (set.rasters.length >= MAX_TEX_LAYERS || !set.rasters[at]) return set;
  const info = [...set.info];
  const rasters = [...set.rasters];
  info.splice(at + 1, 0, { ...set.info[at]!, name: freshName(set.info, `${set.info[at]!.name} copy`) });
  rasters.splice(at + 1, 0, cloneRaster(set.rasters[at]!));
  return { info, rasters };
}

/// Removes a layer (the last one cannot be removed).
export function removeLayer(set: LayerSet, at: number): LayerSet {
  if (set.rasters.length <= 1 || !set.rasters[at]) return set;
  return { info: set.info.filter((_, i) => i !== at), rasters: set.rasters.filter((_, i) => i !== at) };
}

/// Moves a layer up (+1) or down (-1) in the stack.
export function moveLayer(set: LayerSet, at: number, by: 1 | -1): LayerSet {
  const to = at + by;
  if (!set.rasters[at] || to < 0 || to >= set.rasters.length) return set;
  const info = [...set.info];
  const rasters = [...set.rasters];
  [info[at], info[to]] = [info[to]!, info[at]!];
  [rasters[at], rasters[to]] = [rasters[to]!, rasters[at]!];
  return { info, rasters };
}

/// Joins a layer into the one below it (with its opacity and blend), as one layer under the lower one's name and settings.
export function mergeDown(set: LayerSet, at: number): LayerSet {
  if (at < 1 || !set.rasters[at]) return set;
  const top = set.info[at]!;
  const merged = top.visible === false ? set.rasters[at - 1]! : composite(set.rasters[at - 1]!, set.rasters[at]!, clamp01(top.opacity ?? 1), (top.blend ?? "normal") as BlendMode);
  return { info: set.info.filter((_, i) => i !== at), rasters: set.rasters.map((r, i) => (i === at - 1 ? merged : r)).filter((_, i) => i !== at) };
}

/// Changes a layer's name, visibility, opacity or blend mode.
export function updateLayer(set: LayerSet, at: number, change: Partial<TexLayerInfo>): LayerSet {
  const cur = set.info[at];
  if (!cur) return set;
  const next: TexLayerInfo = { ...cur, ...change };
  next.name = (next.name ?? "").trim() || cur.name;
  if (next.name !== cur.name && set.info.some((l, i) => i !== at && l.name === next.name)) next.name = cur.name;
  if (next.opacity !== undefined) next.opacity = clamp01(next.opacity);
  if (next.opacity === 1) delete next.opacity;
  if (next.visible !== false) delete next.visible;
  if (next.blend === "normal" || (next.blend && !BLEND_MODES.includes(next.blend as BlendMode))) delete next.blend;
  const info = [...set.info];
  info[at] = next;
  return { info, rasters: set.rasters };
}

/// The file a layer is kept in, from the texture picture's path.
export const layerPath = (texturePath: string, i: number) => texturePath.replace(/\.texture\.png$/i, `.texture.layer${i}.png`);
