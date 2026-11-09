<script lang="ts">
  // The first-launch screen, and Edit > Input settings: how do you move around a 3D view? Three choices, each tried right here on a cube.
  // The studio guesses from the first scroll it sees (a trackpad slides sideways too); the choice is the person's.
  import { onMount } from "svelte";
  import * as THREE from "three";
  import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
  import { input, looksLikeTrackpad, type WheelSample } from "../lib/input-settings.svelte";
  import { applyNavigation, type NavScheme } from "../lib/view-nav";

  let { first = false, onclose }: { first?: boolean; onclose: () => void } = $props();

  let choice: NavScheme = $state(input.navigation);
  let invert = $state(input.invert);
  let detected: NavScheme | null = $state(null);
  let canvas: HTMLCanvasElement | undefined = $state();
  let undo = () => {};
  let controls: OrbitControls | undefined = $state.raw();
  let camera: THREE.PerspectiveCamera | undefined = $state.raw();

  const OPTIONS: { id: NavScheme; title: string; text: string; icon: string }[] = [
    { id: "trackpad", title: "Trackpad", text: "Slide two fingers to turn the view. Shift and two fingers move it, a pinch zooms.", icon: "▭" },
    { id: "mouse", title: "Mouse", text: "Drag with the middle or left button to turn, the right button (or Shift) to move, the wheel to zoom.", icon: "◍" },
    { id: "pen", title: "Pen tablet", text: "Drag with the pen to turn; the pen's side button moves the view, and the wheel or a pinch zooms.", icon: "✎" },
  ];

  const samples: WheelSample[] = [];
  const listen = (e: WheelEvent) => {
    samples.push({ deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode });
    if (samples.length > 12) samples.shift();
    const t = looksLikeTrackpad(samples);
    if (t !== null) detected = t ? "trackpad" : "mouse";
  };

  // (re-applies the scheme to the practice cube whenever the choice changes)
  $effect(() => {
    const scheme = choice;
    const flip = invert;
    if (!controls || !camera || !canvas) return;
    undo();
    undo = applyNavigation(controls, () => camera!, canvas, scheme, { invert: flip });
  });

  onMount(() => {
    if (!canvas) return;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x15171c);
    camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100);
    camera.position.set(3.2, 2.4, 4.2);
    const cube = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), new THREE.MeshStandardMaterial({ color: 0x5aa9ff }));
    scene.add(cube, new THREE.GridHelper(10, 10, 0x3a4050, 0x2a2f3a), new THREE.AmbientLight(0xffffff, 0.8), new THREE.DirectionalLight(0xffffff, 1.4));
    controls = new OrbitControls(camera, canvas);
    let frame = 0;
    const draw = () => {
      const w = canvas!.clientWidth || 320;
      const h = canvas!.clientHeight || 180;
      if (canvas!.width !== w || canvas!.height !== h) {
        renderer.setSize(w, h, false);
        camera!.aspect = w / h;
        camera!.updateProjectionMatrix();
      }
      controls!.update();
      renderer.render(scene, camera!);
      frame = requestAnimationFrame(draw);
    };
    draw();
    canvas.addEventListener("wheel", listen, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      canvas?.removeEventListener("wheel", listen);
      undo();
      controls?.dispose();
      renderer.dispose();
    };
  });

  const done = () => {
    input.set({ navigation: choice, invert });
    onclose();
  };
</script>

<div class="backdrop" role="presentation">
  <div class="dialog" role="dialog" aria-label={first ? "Welcome to Nova Studio" : "Input settings"} aria-modal="true">
    <h2>{first ? "How do you move around in 3D?" : "Input settings"}</h2>
    <p class="dim">Pick what you use, then try it on the cube. You can change this later in Edit › Input settings.</p>
    <div class="options" role="radiogroup" aria-label="Navigation">
      {#each OPTIONS as o (o.id)}
        <button class="opt" class:on={choice === o.id} role="radio" aria-checked={choice === o.id} onclick={() => (choice = o.id)}>
          <span class="ic" aria-hidden="true">{o.icon}</span>
          <span><strong>{o.title}</strong>{#if detected === o.id}<em> · looks like what you are using</em>{/if}<br /><span class="dim">{o.text}</span></span>
        </button>
      {/each}
    </div>
    <canvas bind:this={canvas} class="practice" aria-label="A cube to practise turning, moving and zooming the view"></canvas>
    <label class="flip"><input type="checkbox" bind:checked={invert} /> Reverse the scroll gestures (the opposite of your system's setting)</label>
    <p class="dim small">The same moves work in the model editor and the scene editor. The 3D views also have on-screen buttons for turning, moving and zooming.</p>
    <div class="end">
      {#if !first}<button onclick={onclose}>Cancel</button>{/if}
      <button class="primary" onclick={done}>{first ? "Start" : "Save"}</button>
    </div>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: #000a; display: grid; place-items: center; z-index: 90; padding: 16px; }
  .dialog { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 20px; width: min(560px, 100%); max-height: 100%; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
  h2 { margin: 0; font-size: 17px; }
  p { margin: 0; }
  .options { display: flex; flex-direction: column; gap: 6px; }
  .opt { display: flex; gap: 12px; align-items: flex-start; text-align: left; padding: 9px 12px; background: var(--bg); border: 1px solid var(--line); border-radius: 9px; color: var(--text); }
  .opt.on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, var(--bg)); }
  .ic { font-size: 20px; width: 26px; text-align: center; }
  em { color: var(--ok); font-style: normal; font-size: 12px; }
  .practice { width: 100%; aspect-ratio: 16 / 7; border-radius: 8px; border: 1px solid var(--line); display: block; touch-action: none; }
  .flip { display: flex; gap: 8px; align-items: center; }
  .small { font-size: 12px; }
  .end { display: flex; justify-content: flex-end; gap: 8px; }
</style>
