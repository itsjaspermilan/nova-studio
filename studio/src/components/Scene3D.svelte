<script lang="ts">
  // The 3D side of the scene editor: objects whose entity has a model stand where the scene puts them, and the game's
  // camera is drawn as a frustum you can aim. It edits the same scene file as the 2D view (x, y up, z towards the viewer).
  import { onMount, untrack } from "svelte";
  import * as THREE from "three";
  import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
  import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
  import type { ModelDoc } from "../lib/model-doc";
  import { buildModel, disposeModel } from "../lib/model-three";
  import { cameraOf, positionOf, sameRef, snap, type Camera3, type Ref, type Scene } from "../lib/scene-model";

  let {
    scene,
    selected,
    models,
    gridSize,
    onselect,
    onmove,
    onready,
  }: {
    scene: Scene;
    selected: Ref | null;
    /// The model of each entity kind that has one.
    models: ReadonlyMap<string, ModelDoc>;
    gridSize: number;
    onselect: (ref: Ref | null) => void;
    onmove: (ref: Ref, p: [number, number, number]) => void;
    /// Hands the parent a way to read the view, for "use this view as the game camera".
    onready: (view: { current: () => Camera3 }) => void;
  } = $props();

  let box: HTMLDivElement | undefined = $state();
  let canvas: HTMLCanvasElement | undefined = $state();
  let renderer: THREE.WebGLRenderer | undefined;
  let three: THREE.Scene | undefined;
  let camera: THREE.PerspectiveCamera | undefined;
  let controls: OrbitControls | undefined;
  let gizmo: TransformControls | undefined;
  let content: THREE.Group | undefined;
  let frameId = 0;
  let observer: ResizeObserver | undefined;
  const holders: { holder: THREE.Group; ref: Ref }[] = [];

  const radians = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

  onMount(() => {
    if (!canvas || !box) return;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    three = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
    // Start by looking at what the scene holds: its objects, and the game's camera when it has one.
    const points = (scene.objects ?? []).map((o) => new THREE.Vector3(...positionOf(o)));
    if (scene.camera) {
      const game = cameraOf(scene);
      points.push(new THREE.Vector3(...game.eye), new THREE.Vector3(...game.target));
    }
    const bounds = new THREE.Box3().setFromPoints(points.length ? points : [new THREE.Vector3()]);
    const target = bounds.getCenter(new THREE.Vector3());
    const reach = Math.max(6, bounds.getSize(new THREE.Vector3()).length());
    camera.position.copy(target).add(new THREE.Vector3(0.5, 0.6, 1).normalize().multiplyScalar(reach * 1.2));
    controls = new OrbitControls(camera, canvas);
    controls.target.copy(target);
    controls.update();
    gizmo = new TransformControls(camera, canvas);
    gizmo.setMode("translate");
    gizmo.setSize(0.8);
    gizmo.addEventListener("dragging-changed", (e) => {
      if (controls) controls.enabled = !e.value;
      if (!e.value) finishDrag();
    });
    three.add(gizmo.getHelper());
    three.add(new THREE.AmbientLight(0xffffff, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(20, 40, 30);
    three.add(sun);
    three.add(new THREE.GridHelper(200, 100, 0x4a5163, 0x2c313c));
    content = new THREE.Group();
    three.add(content);
    const size = () => {
      const w = Math.max(50, box!.clientWidth);
      const h = Math.max(50, box!.clientHeight);
      renderer!.setSize(w, h, false);
      camera!.aspect = w / h;
      camera!.updateProjectionMatrix();
    };
    observer = new ResizeObserver(size);
    observer.observe(box);
    size();
    onready({
      current: () => ({
        eye: round(camera!.position.toArray() as [number, number, number]),
        target: round(controls!.target.toArray() as [number, number, number]),
        fov: cameraOf(scene).fov,
      }),
    });
    rebuild();
    const loop = () => {
      frameId = requestAnimationFrame(loop);
      controls!.update();
      renderer!.render(three!, camera!);
    };
    loop();
    return () => {
      cancelAnimationFrame(frameId);
      observer?.disconnect();
      gizmo?.dispose();
      controls?.dispose();
      if (content) clear();
      renderer?.dispose();
    };
  });

  const round = (p: [number, number, number]): [number, number, number] => p.map((v) => Math.round(v * 100) / 100) as [number, number, number];

  function clear() {
    if (!content) return;
    gizmo?.detach();
    content.traverse((o) => {
      if (o instanceof THREE.LineSegments || o instanceof THREE.Line) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    for (const child of [...content.children]) disposeModel(child);
    content.clear();
    holders.length = 0;
  }

  function rebuild() {
    if (!content || !three) return;
    clear();
    const bg = scene.background;
    three.background = Array.isArray(bg) && bg.length >= 3 ? new THREE.Color().setRGB(bg[0]! / 255, bg[1]! / 255, bg[2]! / 255, THREE.SRGBColorSpace) : new THREE.Color(0x5c96d6);
    (scene.objects ?? []).forEach((o, index) => {
      const holder = new THREE.Group();
      const props = (o.props ?? {}) as Record<string, unknown>;
      holder.position.set(...positionOf(o));
      // the runtime turns about y, then x, then z, in radians
      holder.rotation.order = "YXZ";
      holder.rotation.set(radians(props.rx), radians(props.ry ?? props.angle), radians(props.rz));
      const s = typeof props.sx === "number" && props.sx > 0 ? props.sx : 1;
      holder.scale.setScalar(s);
      const doc = typeof o.kind === "string" ? models.get(o.kind) : undefined;
      if (doc) holder.add(buildModel(doc));
      else {
        // an object without a model is a marker: a small wire box
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0xe6b450 }));
        edges.position.y = 0.5;
        holder.add(edges);
        const hit = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ visible: false }));
        hit.position.y = 0.5;
        holder.add(hit);
      }
      holder.userData.index = index;
      content!.add(holder);
      holders.push({ holder, ref: { kind: "objects", index } });
    });
    drawCamera();
    attach();
  }

  /// The game's camera, drawn as the volume it sees.
  function drawCamera() {
    if (!content || !scene.camera) return;
    const c = cameraOf(scene);
    const cam = new THREE.PerspectiveCamera(c.fov, 16 / 9, 0.5, 14);
    cam.position.set(...c.eye);
    cam.lookAt(new THREE.Vector3(...c.target));
    cam.updateMatrixWorld(true);
    const helper = new THREE.CameraHelper(cam);
    content.add(helper);
  }

  function attach() {
    if (!gizmo) return;
    gizmo.detach();
    const found = holders.find((h) => sameRef(h.ref, selected));
    if (found) gizmo.attach(found.holder);
  }

  function finishDrag() {
    const found = holders.find((h) => sameRef(h.ref, selected));
    if (!found) return;
    const p = found.holder.position;
    const grid = gridSize > 0 ? gridSize / 8 : 0; // the 2D grid is in pixels; 8 of them make one world unit here
    const at = (v: number) => (grid ? snap(v, grid) : Math.round(v * 1000) / 1000);
    onmove(found.ref, [at(p.x), at(p.y), at(p.z)]);
  }

  // A click without a drag picks the object under the pointer.
  let down: { x: number; y: number } | null = null;
  function pointerdown(e: PointerEvent) {
    down = { x: e.clientX, y: e.clientY };
  }
  function pointerup(e: PointerEvent) {
    const start = down;
    down = null;
    if (!start || e.button !== 0 || !camera || !canvas || gizmo?.dragging) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) return;
    const rect = canvas.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -(((e.clientY - rect.top) / rect.height) * 2 - 1)), camera);
    const hits = ray.intersectObjects(
      holders.map((h) => h.holder),
      true,
    );
    let node: THREE.Object3D | null = hits[0]?.object ?? null;
    while (node && node.userData.index === undefined) node = node.parent;
    onselect(node ? { kind: "objects", index: node.userData.index as number } : null);
  }

  $effect(() => {
    scene; models; // redraw when the scene or a model changes
    if (renderer) untrack(rebuild);
  });
  $effect(() => {
    selected;
    untrack(attach);
  });
</script>

<div class="view" bind:this={box}>
  <canvas bind:this={canvas} aria-label="3D scene view" onpointerdown={pointerdown} onpointerup={pointerup}></canvas>
</div>

<style>
  .view {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    outline: none;
  }
</style>
