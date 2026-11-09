<script lang="ts">
  // On-screen buttons for moving a 3D view, so nothing depends on a gesture or a middle button (docs/studio-ux.md, section 4): drag the
  // first to turn the view, the second to move it, the third up and down to zoom. With the keyboard, the arrow keys do the same (Shift: bigger steps).
  import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
  import Icon from "./Icon.svelte";
  import { orbitBy, panBy, zoomBy, type ViewCamera } from "../lib/view-nav";

  let { controls, camera, height }: { controls: () => OrbitControls | undefined; camera: () => ViewCamera | undefined; height: () => number } = $props();

  type Tool = "orbit" | "pan" | "zoom";
  const TOOLS: { id: Tool; label: string; glyph: string; hint: string }[] = [
    { id: "orbit", label: "Turn the view", glyph: "rotate", hint: "Drag to turn the view" },
    { id: "pan", label: "Move the view", glyph: "move", hint: "Drag to move the view" },
    { id: "zoom", label: "Zoom the view", glyph: "zoom", hint: "Drag up and down to zoom" },
  ];

  const move = (tool: Tool, dx: number, dy: number) => {
    const c = controls();
    const cam = camera();
    if (!c || !cam) return;
    if (tool === "orbit") orbitBy(cam, c.target, dx, dy);
    else if (tool === "pan") panBy(cam, c.target, dx, dy, height());
    else zoomBy(cam, c.target, Math.exp(dy * 0.01));
    c.update();
  };

  let drag: { tool: Tool; x: number; y: number } | null = null;
  const down = (tool: Tool, e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { tool, x: e.clientX, y: e.clientY };
  };
  const over = (e: PointerEvent) => {
    if (!drag) return;
    move(drag.tool, e.clientX - drag.x, e.clientY - drag.y);
    drag = { ...drag, x: e.clientX, y: e.clientY };
  };
  const up = () => (drag = null);
  const key = (tool: Tool, e: KeyboardEvent) => {
    const step = e.shiftKey ? 40 : 12;
    const dir: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const d = dir[e.key];
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    move(tool, d[0], d[1]);
  };
</script>

<div class="nav" role="toolbar" aria-label="Move the view">
  {#each TOOLS as t (t.id)}
    <button
      class="ghost"
      aria-label={t.label}
      title="{t.hint} (or use the arrow keys when focused)"
      onpointerdown={(e) => down(t.id, e)}
      onpointermove={over}
      onpointerup={up}
      onpointercancel={up}
      onkeydown={(e) => key(t.id, e)}
    ><Icon name={t.glyph} size={16} /></button>
  {/each}
</div>

<style>
  .nav { position: absolute; top: 8px; right: 8px; display: flex; flex-direction: column; gap: 4px; z-index: 5; }
  button { width: 32px; height: 32px; padding: 0; border-radius: 50%; background: color-mix(in srgb, var(--panel) 85%, transparent); border: 1px solid var(--line); color: var(--text); display: grid; place-items: center; touch-action: none; cursor: grab; font-size: 16px; line-height: 1; }
  button:active { cursor: grabbing; background: var(--panel-2); }
</style>
