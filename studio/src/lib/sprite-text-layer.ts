// Text layers: a layer that keeps the words it shows, so they can be changed later (the text, its place, its size, its colour) instead of being pixels that were drawn once.
// The cels are redrawn from the words on every change; "rasterize" forgets the words and leaves the pixels as plain drawing.

import { addLayer, cloneDoc, recomposeAll, type SpriteDoc, type TextSource } from "./sprite-doc";
import { drawText } from "./pixel-text";
import { parseHex, type Rgba } from "./pixels";

export const DEFAULT_TEXT: TextSource = { value: "Text", x: 2, y: 2, scale: 1, color: "#ffffff" };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));
const clean = (t: TextSource): TextSource => ({
  value: t.value.slice(0, 400),
  x: clamp(t.x, -1024, 1024),
  y: clamp(t.y, -1024, 1024),
  scale: clamp(t.scale, 1, 16),
  color: /^#[0-9a-fA-F]{6}$/.test(t.color) ? t.color.toLowerCase() : "#ffffff",
});

function redraw(doc: SpriteDoc, index: number) {
  const layer = doc.layers[index]!;
  const text = layer.text;
  if (!text) return;
  const color: Rgba = parseHex(text.color) ?? [255, 255, 255, 255];
  for (const cel of layer.cels) {
    cel.data.fill(0);
    drawText(cel, text.x, text.y, text.value, color, text.scale);
  }
}

/// A new text layer above `above`, showing `source` (the defaults where it is left out), named after its words. The picture as it was when there is no room for another layer.
export function addTextLayer(doc: SpriteDoc, above: number, source: Partial<TextSource> = {}): { doc: SpriteDoc; index: number } {
  const made = addLayer(doc, above);
  if (made.doc === doc) return made;
  const next = cloneDoc(made.doc);
  const text = clean({ ...DEFAULT_TEXT, ...source });
  const layer = next.layers[made.index]!;
  layer.text = text;
  layer.locked = true;
  layer.name = (text.value.split("\n")[0] || "Text").slice(0, 24);
  redraw(next, made.index);
  return { doc: recomposeAll(next), index: made.index };
}

/// Changes a text layer's words, place, size or colour and redraws it in every frame. The picture as it was when the layer is not a text layer.
export function setLayerText(doc: SpriteDoc, index: number, change: Partial<TextSource>): SpriteDoc {
  if (!doc.layers[index]?.text) return doc;
  const next = cloneDoc(doc);
  const layer = next.layers[index]!;
  layer.text = clean({ ...layer.text!, ...change });
  redraw(next, index);
  return recomposeAll(next);
}

/// Forgets the words: the layer is plain pixels from now on, and unlocked.
export function rasterizeText(doc: SpriteDoc, index: number): SpriteDoc {
  if (!doc.layers[index]?.text) return doc;
  const next = cloneDoc(doc);
  const layer = next.layers[index]!;
  delete layer.text;
  delete layer.locked;
  return next;
}
