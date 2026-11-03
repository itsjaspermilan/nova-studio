// A stand-in for three's WebGLRenderer, which needs a real GPU. Use it in a component test with:
//   vi.mock("three", async (original) => ({ ...(await original<typeof import("three")>()), WebGLRenderer: (await import("../test/gl")).FakeRenderer }));
// Anything asked of it is accepted and nothing is drawn.
export class FakeRenderer {
  domElement: HTMLCanvasElement;
  shadowMap = {};
  info = { render: { calls: 0, triangles: 0 } };
  constructor(opts?: { canvas?: HTMLCanvasElement }) {
    this.domElement = opts?.canvas ?? document.createElement("canvas");
    return new Proxy(this, { get: (t, k) => (k in t ? (t as never)[k] : () => undefined) });
  }
}
