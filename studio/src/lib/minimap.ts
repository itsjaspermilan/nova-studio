// The mini-map of a big picture: where the visible part sits in the whole, and where a click on the map should scroll to.

export interface View {
  /// The scrolling area's scroll position and size in screen pixels.
  left: number;
  top: number;
  w: number;
  h: number;
}

/// The part of the picture on screen, in picture pixels (clamped to the picture). `pad` is the space round the picture inside the scroller.
export function visibleBox(v: View, zoom: number, fw: number, fh: number, pad = 16): { x: number; y: number; w: number; h: number } {
  const x0 = Math.max(0, (v.left - pad) / zoom);
  const y0 = Math.max(0, (v.top - pad) / zoom);
  const x1 = Math.min(fw, (v.left + v.w - pad) / zoom);
  const y1 = Math.min(fh, (v.top + v.h - pad) / zoom);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/// Whether the picture is bigger than the window on either side, so a map helps.
export const needsMap = (v: View, zoom: number, fw: number, fh: number, pad = 16) => fw * zoom + 2 * pad > v.w + 1 || fh * zoom + 2 * pad > v.h + 1;

/// The scroll position that puts picture pixel (px, py) in the middle of the window.
export function scrollToCentre(px: number, py: number, v: Pick<View, "w" | "h">, zoom: number, pad = 16): { left: number; top: number } {
  return { left: Math.max(0, px * zoom + pad - v.w / 2), top: Math.max(0, py * zoom + pad - v.h / 2) };
}
