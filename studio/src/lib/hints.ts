// Hints in the status area: what the control under the pointer does, in words, taken from its tooltip (`title`) or its accessible name. Written once on the control, shown both
// as the browser's tooltip and here, where it can be read without waiting.

export interface HintNode {
  getAttribute(name: string): string | null;
  parentElement: HintNode | null;
}

const MAX = 220;

/// The words for the pointer's element: the nearest `title` going up from it (a few levels), else its `aria-label`. Nothing for a plain area. A hint is cut to a sensible length.
export function hintFor(node: HintNode | null | undefined, levels = 4): string {
  let n = node ?? null;
  for (let i = 0; n && i < levels; i++, n = n.parentElement) {
    const text = (n.getAttribute("title") ?? "").trim() || (n.getAttribute("aria-label") ?? "").trim();
    if (text) return text.length > MAX ? `${text.slice(0, MAX - 1)}…` : text;
  }
  return "";
}
