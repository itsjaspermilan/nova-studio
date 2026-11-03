// What jsdom lacks and the editors use: a ResizeObserver, a canvas that can draw (the editors skip drawing when there is
// none) and WebGL (the 3D views are not drawn in tests). Loaded before every test file; it does nothing in the plain node tests.
if (typeof window !== "undefined") {
  class Observer {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= Observer;
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  window.requestAnimationFrame ??= ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number) as typeof window.requestAnimationFrame;
}
