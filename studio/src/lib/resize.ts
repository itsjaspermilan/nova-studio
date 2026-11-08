// Every panel of the studio can be resized by dragging its edge: `use:resizable={{ key, edge, size }}` on the panel gives it a handle
// on that edge (the side that faces the area it shares space with) and a width (or, for edge "top", a height) that is remembered per key.
// A double-click on the handle puts the default back. The panel's grid or flex track should be `auto` so that the panel's own size counts.

export interface ResizeOptions {
  /// Remembered under "nova.size.<key>".
  key: string;
  /// The edge the handle is on: "right" for a panel on the left, "left" for one on the right, "top" for one along the bottom.
  edge: "left" | "right" | "top";
  /// The default size, in pixels.
  size: number;
  min?: number;
  max?: number;
}

const store = (key: string) => `nova.size.${key}`;
export function savedSize(key: string): number | null {
  try {
    const v = Number(localStorage.getItem(store(key)));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
function remember(key: string, v: number | null) {
  try {
    if (v === null) localStorage.removeItem(store(key));
    else localStorage.setItem(store(key), String(Math.round(v)));
  } catch {
    // not remembered
  }
}

/// The size a drag gives: from the size at the start, moved by the pointer (dx, dy) on the handle's edge, kept within min and max.
export function draggedSize(o: ResizeOptions, start: number, dx: number, dy: number): number {
  const d = o.edge === "right" ? dx : o.edge === "left" ? -dx : -dy;
  return Math.max(o.min ?? 120, Math.min(o.max ?? 900, start + d));
}

export function resizable(node: HTMLElement, options: ResizeOptions) {
  let o = options;
  const handle = document.createElement("div");
  handle.className = `nova-resize nova-resize-${o.edge}`;
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", o.edge === "top" ? "horizontal" : "vertical");
  handle.title = "Drag to resize · double-click for the usual size";
  if (getComputedStyle(node).position === "static") node.style.position = "relative";
  node.appendChild(handle);
  const apply = (v: number) => {
    if (o.edge === "top") node.style.height = `${v}px`;
    else node.style.width = `${v}px`;
    node.style.flex = "none";
  };
  apply(savedSize(o.key) ?? o.size);
  // a panel that scrolls carries its handle along, so that the handle always covers the visible edge
  const follow = () => {
    if (o.edge === "top") handle.style.left = `${node.scrollLeft}px`;
    else handle.style.top = `${node.scrollTop}px`;
  };
  node.addEventListener("scroll", follow);
  let drag: { x: number; y: number; start: number } | null = null;
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const r = node.getBoundingClientRect();
    drag = { x: e.clientX, y: e.clientY, start: o.edge === "top" ? r.height : r.width };
    handle.setPointerCapture(e.pointerId);
    handle.classList.add("on");
    document.body.classList.add(o.edge === "top" ? "nova-resizing-rows" : "nova-resizing-cols");
  });
  handle.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const v = draggedSize(o, drag.start, e.clientX - drag.x, e.clientY - drag.y);
    apply(v);
    remember(o.key, v);
    window.dispatchEvent(new Event("resize")); // (the 3D views and canvases fit themselves to their new size)
  });
  const end = () => {
    drag = null;
    handle.classList.remove("on");
    document.body.classList.remove("nova-resizing-rows", "nova-resizing-cols");
  };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
  handle.addEventListener("dblclick", () => {
    remember(o.key, null);
    apply(o.size);
    window.dispatchEvent(new Event("resize"));
  });
  return {
    update(next: ResizeOptions) {
      const changed = next.key !== o.key;
      o = next;
      if (changed) apply(savedSize(o.key) ?? o.size);
    },
    destroy() {
      node.removeEventListener("scroll", follow);
      handle.remove();
    },
  };
}
