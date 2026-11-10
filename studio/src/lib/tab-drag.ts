// Dragging a tab out of the tab strip tears its document off into a window of its own.

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/// Whether a drag that ended at (x, y) ended outside the strip by more than `margin` pixels (a drop a little way off the strip, or back on it, is not a tear-off).
/// A drag that ended outside the whole window (x or y below 0, or past its size) counts, since that is where a person drops a tab to make a window.
export function droppedOutside(strip: Box, x: number, y: number, margin = 24): boolean {
  if (![x, y].every(Number.isFinite)) return false;
  return x < strip.left - margin || x > strip.right + margin || y < strip.top - margin || y > strip.bottom + margin;
}
