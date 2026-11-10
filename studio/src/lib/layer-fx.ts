// Effects that stay on a layer instead of changing its pixels: the layer keeps its own drawing, and the effects are run on every frame's cel when the picture is
// stacked (shown, previewed, exported). Turn one off or take it away and the drawing is as it was.

import { brighten, colorCurve, dropShadow, grayscale, hueShift, invertColors, offsetWrap, outline, pixelate, replaceColor } from "./sprite-fx";
import { parseHex, type Raster, type Rgba } from "./pixels";

export type LayerFxType = "invert" | "grayscale" | "hue" | "brightness" | "curve" | "outline" | "shadow" | "pixelate" | "replace" | "offset";

/// An effect on a layer. Numbers and colours (`#rrggbb`) by name; a missing one takes its default.
export interface LayerEffect {
  type: LayerFxType;
  /// false: kept in the list but not applied.
  on?: boolean;
  params: Record<string, number | string>;
}

export interface ParamSpec {
  key: string;
  label: string;
  kind: "number" | "color";
  min?: number;
  max?: number;
  step?: number;
  default: number | string;
}

export const LAYER_FX: Record<LayerFxType, { title: string; params: ParamSpec[] }> = {
  invert: { title: "Invert colours", params: [] },
  grayscale: { title: "Grey", params: [] },
  hue: { title: "Turn the hue", params: [{ key: "degrees", label: "Degrees", kind: "number", min: -180, max: 180, step: 5, default: 30 }] },
  brightness: { title: "Lighter or darker", params: [{ key: "amount", label: "Amount", kind: "number", min: -1, max: 1, step: 0.05, default: 0.2 }] },
  curve: {
    title: "Brightness, contrast, gamma",
    params: [
      { key: "brightness", label: "Brightness", kind: "number", min: -1, max: 1, step: 0.05, default: 0 },
      { key: "contrast", label: "Contrast", kind: "number", min: -1, max: 1, step: 0.05, default: 0 },
      { key: "gamma", label: "Gamma", kind: "number", min: 0.2, max: 3, step: 0.05, default: 1 },
    ],
  },
  outline: { title: "Outline", params: [{ key: "color", label: "Colour", kind: "color", default: "#000000" }, { key: "diagonals", label: "Diagonals", kind: "number", min: 0, max: 1, step: 1, default: 0 }] },
  shadow: {
    title: "Drop shadow",
    params: [
      { key: "dx", label: "Across", kind: "number", min: -8, max: 8, step: 1, default: 1 },
      { key: "dy", label: "Down", kind: "number", min: -8, max: 8, step: 1, default: 1 },
      { key: "color", label: "Colour", kind: "color", default: "#000000" },
    ],
  },
  pixelate: { title: "Pixelate", params: [{ key: "size", label: "Block", kind: "number", min: 2, max: 16, step: 1, default: 2 }] },
  replace: { title: "Swap a colour", params: [{ key: "from", label: "From", kind: "color", default: "#ffffff" }, { key: "to", label: "To", kind: "color", default: "#ff0000" }] },
  offset: { title: "Slide (wraps round)", params: [{ key: "dx", label: "Across", kind: "number", min: -32, max: 32, step: 1, default: 1 }, { key: "dy", label: "Down", kind: "number", min: -32, max: 32, step: 1, default: 0 }] },
};

export const LAYER_FX_TYPES = Object.keys(LAYER_FX) as LayerFxType[];
export const MAX_LAYER_FX = 6;

const num = (e: LayerEffect, key: string): number => {
  const spec = LAYER_FX[e.type].params.find((p) => p.key === key)!;
  const v = e.params[key];
  const n = typeof v === "number" && Number.isFinite(v) ? v : (spec.default as number);
  return Math.min(spec.max ?? Infinity, Math.max(spec.min ?? -Infinity, n));
};
const colour = (e: LayerEffect, key: string): Rgba => {
  const spec = LAYER_FX[e.type].params.find((p) => p.key === key)!;
  const v = e.params[key];
  return (typeof v === "string" ? parseHex(v) : null) ?? parseHex(spec.default as string) ?? [0, 0, 0, 255];
};

/// One effect applied to a picture (a new picture).
export function applyLayerEffect(r: Raster, e: LayerEffect): Raster {
  switch (e.type) {
    case "invert": return invertColors(r);
    case "grayscale": return grayscale(r);
    case "hue": return hueShift(r, num(e, "degrees"));
    case "brightness": return brighten(r, num(e, "amount"));
    case "curve": return colorCurve(r, num(e, "brightness"), num(e, "contrast"), num(e, "gamma"));
    case "outline": return outline(r, colour(e, "color"), num(e, "diagonals") >= 1);
    case "shadow": return dropShadow(r, Math.round(num(e, "dx")), Math.round(num(e, "dy")), colour(e, "color"));
    case "pixelate": return pixelate(r, Math.round(num(e, "size")));
    case "replace": return replaceColor(r, colour(e, "from"), colour(e, "to"));
    case "offset": return offsetWrap(r, Math.round(num(e, "dx")), Math.round(num(e, "dy")));
  }
}

/// The picture with every effect that is on, in order.
export function applyLayerEffects(r: Raster, effects: LayerEffect[] | undefined): Raster {
  let out = r;
  for (const e of effects ?? []) if (e.on !== false) out = applyLayerEffect(out, e);
  return out;
}

export const newLayerEffect = (type: LayerFxType): LayerEffect => ({ type, params: Object.fromEntries(LAYER_FX[type].params.map((p) => [p.key, p.default])) });

/// Checks effects read from a file; null when they are not valid.
export function cleanLayerEffects(raw: unknown): LayerEffect[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_LAYER_FX) return null;
  const out: LayerEffect[] = [];
  for (const e of raw as Partial<LayerEffect>[]) {
    if (!e || !e.type || !(e.type in LAYER_FX) || typeof e.params !== "object" || e.params === null) return null;
    const params: Record<string, number | string> = {};
    for (const spec of LAYER_FX[e.type].params) {
      const v = (e.params as Record<string, unknown>)[spec.key];
      if (v === undefined) continue;
      if (spec.kind === "number" && (typeof v !== "number" || !Number.isFinite(v))) return null;
      if (spec.kind === "color" && (typeof v !== "string" || !parseHex(v))) return null;
      params[spec.key] = v as number | string;
    }
    out.push({ type: e.type, ...(e.on === false ? { on: false } : {}), params });
  }
  return out;
}

// ---- editing a layer's list of effects (each returns a new list) ----

export function addLayerEffect(list: LayerEffect[] | undefined, type: LayerFxType): LayerEffect[] {
  const l = list ?? [];
  return l.length >= MAX_LAYER_FX ? l : [...l, newLayerEffect(type)];
}
export const removeLayerEffect = (list: LayerEffect[] | undefined, i: number): LayerEffect[] => (list ?? []).filter((_, k) => k !== i);
export const toggleLayerEffect = (list: LayerEffect[] | undefined, i: number): LayerEffect[] => (list ?? []).map((e, k) => (k === i ? { ...e, on: e.on === false ? true : false } : e));
export const setLayerEffectParam = (list: LayerEffect[] | undefined, i: number, key: string, value: number | string): LayerEffect[] =>
  (list ?? []).map((e, k) => (k === i ? { ...e, params: { ...e.params, [key]: value } } : e));
export function moveLayerEffect(list: LayerEffect[] | undefined, i: number, by: number): LayerEffect[] {
  const l = [...(list ?? [])];
  const j = i + by;
  if (!l[i] || j < 0 || j >= l.length) return l;
  [l[i], l[j]] = [l[j]!, l[i]!];
  return l;
}
