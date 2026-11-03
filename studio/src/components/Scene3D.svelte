<script lang="ts">
  // The 3D side of the scene editor: objects whose entity has a model stand where the scene puts them, and the game's
  // camera is drawn as a frustum you can aim. It edits the same scene file as the 2D view (x, y up, z towards the viewer).
  import { onMount, untrack } from "svelte";
  import * as THREE from "three";
  import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
  import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
  import type { ModelDoc } from "../lib/model-doc";
  import { ModelShapes, instanceScene, moveObject, placement, type Instanced } from "../lib/scene-three";
  import { cameraOf, itemAt, positionOf, scatterPoints, snap, type Camera3, type Ref, type Scene } from "../lib/scene-model";

  let {
    scene,
    selected,
    models,
    gridSize,
    onselect,
    onmove,
    onready,
    placing = null,
    erasing = false,
    brushRadius = 0,
    brushCount = 1,
    onplace = () => {},
    onerase = () => {},
    onstop = () => {},
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
    /// The kind of object being placed (clicks and drags on the ground add it), or null.
    placing?: string | null;
    /// Metres of ground a stroke paints over, and how many objects each step of a stroke adds.
    brushRadius?: number;
    brushCount?: number;
    /// Called with the ground points [x, z] to add; `first` is true for the first of a stroke (one undo step per stroke).
    onplace?: (points: [number, number][], first: boolean) => void;
    /// The brush as an eraser: take away what stands within the brush at this ground point.
    erasing?: boolean;
    onerase?: (at: [number, number], first: boolean) => void;
    onstop?: () => void;
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
  // Every shape of every model is one instanced mesh; objects without a model are small wire boxes.
  let shapes = new ModelShapes();
  let shapesFor: ReadonlyMap<string, unknown> | undefined;
  let instanced: Instanced | undefined;
  const markers = new Map<number, THREE.Group>();
  /// What the move arrows hold on to: it stands where the picked object does, and the object follows it.
  const grip = new THREE.Group();
  // while placing: a ring on the ground where the next objects would land
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.9, depthTest: false }));
  ring.visible = false;
  ring.renderOrder = 10;

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
    // (plain listeners: the orbit and move controls hold on to the pointer, which a delegated handler can miss)
    canvas.addEventListener("pointerdown", pointerdown);
    canvas.addEventListener("pointerup", pointerup);
    canvas.addEventListener("pointermove", pointermove);
    window.addEventListener("keydown", keydown);
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
    gizmo.addEventListener("objectChange", follow);
    three.add(gizmo.getHelper());
    three.add(grip);
    three.add(ring);
    three.add(new THREE.AmbientLight(0xffffff, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(20, 40, 30);
    three.add(sun);
    // a ground grid that fits the scene: lines every ten units, as far as the objects reach
    const half = Math.min(2000, Math.ceil((Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z, 40) * 0.75) / 10) * 10);
    const spacing = half > 300 ? 50 : 10;
    const grid = new THREE.GridHelper(Math.ceil(half / spacing) * spacing * 2, Math.ceil(half / spacing) * 2, 0x4a5163, 0x363c4a);
    grid.position.set(Math.round(target.x / 10) * 10, 0, Math.round(target.z / 10) * 10);
    three.add(grid);
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
      canvas?.removeEventListener("pointerdown", pointerdown);
      canvas?.removeEventListener("pointerup", pointerup);
      canvas?.removeEventListener("pointermove", pointermove);
      window.removeEventListener("keydown", keydown);
      observer?.disconnect();
      gizmo?.dispose();
      controls?.dispose();
      if (content) clear();
      shapes.dispose();
      renderer?.dispose();
    };
  });

  const round = (p: [number, number, number]): [number, number, number] => p.map((v) => Math.round(v * 100) / 100) as [number, number, number];

  function clear() {
    if (!content) return;
    gizmo?.detach();
    for (const m of instanced?.meshes ?? []) m.dispose();
    instanced = undefined;
    content.traverse((o) => {
      if (o instanceof THREE.LineSegments || (o instanceof THREE.Mesh && o.userData.marker)) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    content.clear();
    markers.clear();
  }

  function rebuild() {
    if (!content || !three) return;
    clear();
    if (shapesFor !== models) {
      shapes.dispose(); // the models changed: their shapes are made again
      shapes = new ModelShapes();
      shapesFor = models;
    }
    const bg = scene.background;
    three.background = Array.isArray(bg) && bg.length >= 3 ? new THREE.Color().setRGB(bg[0]! / 255, bg[1]! / 255, bg[2]! / 255, THREE.SRGBColorSpace) : new THREE.Color(0x5c96d6);
    instanced = instanceScene(scene, models, shapes);
    for (const m of instanced.meshes) content.add(m);
    for (const index of instanced.markers) {
      const g = new THREE.Group();
      g.applyMatrix4(placement(scene.objects![index]!));
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0xe6b450 }));
      edges.position.y = 0.5;
      const hit = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.y = 0.5;
      hit.userData.marker = true;
      g.add(edges, hit);
      g.userData.index = index;
      content.add(g);
      markers.set(index, g);
    }
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
    const o = selected && selected.kind === "objects" ? itemAt(scene, selected) : undefined;
    if (!o) return;
    grip.position.set(...positionOf(o));
    grip.updateMatrixWorld(true);
    gizmo.attach(grip);
  }

  /// While an arrow is dragged the object follows it, without waiting for the file to change.
  function follow() {
    if (!selected || !instanced) return;
    const o = itemAt(scene, selected);
    if (!o) return;
    const placed = placement(o).setPosition(grip.position);
    moveObject(instanced, selected.index, placed);
    const marker = markers.get(selected.index);
    if (marker) marker.position.copy(grip.position);
  }

  function finishDrag() {
    if (!selected) return;
    const p = grip.position;
    const here = itemAt(scene, selected);
    if (!here) return;
    const [hx, hy, hz] = positionOf(here);
    if (Math.hypot(p.x - hx, p.y - hy, p.z - hz) < 1e-4) return; // nothing was dragged: leave the file alone
    const grid = gridSize > 0 ? gridSize / 8 : 0; // the 2D grid is in pixels; 8 of them make one world unit here
    const at = (v: number) => (grid ? snap(v, grid) : Math.round(v * 1000) / 1000);
    onmove(selected, [at(p.x), at(p.y), at(p.z)]);
  }

  // A click without a drag picks the object under the pointer.
  let down: { x: number; y: number } | null = null;
  function pointerdown(e: PointerEvent) {
    down = { x: e.clientX, y: e.clientY };
    if ((placing || erasing) && e.button === 0) {
      stroke = { last: null, first: true };
      paint(e);
    }
  }

  // ---- placing: click to stamp, drag to paint ----------------------------------------------------------------------------
  let stroke: { last: [number, number] | null; first: boolean } | null = null;
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  /// Where the pointer is on the ground (y = 0), or null when it looks at the sky.
  function groundAt(e: PointerEvent): [number, number] | null {
    if (!camera || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -(((e.clientY - rect.top) / rect.height) * 2 - 1)), camera);
    const at = ray.ray.intersectPlane(plane, new THREE.Vector3());
    return at && Math.hypot(at.x, at.z) < 20000 ? [at.x, at.z] : null;
  }

  function paint(e: PointerEvent) {
    if (!(placing || erasing) || !stroke) return;
    const at = groundAt(e);
    if (!at) return;
    // along a stroke a new batch goes down each time the pointer has moved about half a brush (or a metre, for a stamp)
    const spacing = Math.max(1, brushRadius * 0.6);
    if (stroke.last && Math.hypot(at[0] - stroke.last[0], at[1] - stroke.last[1]) < spacing) return;
    stroke.last = at;
    if (erasing) onerase(at, stroke.first);
    else onplace(scatterPoints(at, brushRadius, brushCount, Math.random), stroke.first);
    stroke.first = false;
  }

  function pointermove(e: PointerEvent) {
    if (!placing && !erasing) {
      ring.visible = false;
      return;
    }
    (ring.material as THREE.MeshBasicMaterial).color.set(erasing ? 0xef4444 : 0xffd166);
    const at = groundAt(e);
    ring.visible = !!at;
    if (at) {
      ring.position.set(at[0], 0.05, at[1]);
      const r = Math.max(0.6, brushRadius);
      ring.scale.set(r, 1, r);
    }
    if (stroke) paint(e);
  }

  function keydown(e: KeyboardEvent) {
    if (e.key === "Escape" && (placing || erasing)) onstop();
  }
  function pointerup(e: PointerEvent) {
    const start = down;
    down = null;
    if (stroke) {
      stroke = null; // the end of a stroke is not a click on an object
      return;
    }
    if (!start || e.button !== 0 || !camera || !canvas || gizmo?.dragging || !instanced) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) return;
    const rect = canvas.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -(((e.clientY - rect.top) / rect.height) * 2 - 1)), camera);
    const hit = ray.intersectObjects([...instanced.meshes, ...markers.values()], true)[0];
    let index: number | undefined;
    if (hit?.object instanceof THREE.InstancedMesh) index = instanced.owners.get(hit.object)?.[hit.instanceId ?? -1];
    else {
      let node: THREE.Object3D | null = hit?.object ?? null;
      while (node && node.userData.index === undefined) node = node.parent;
      index = node?.userData.index as number | undefined;
    }
    onselect(index === undefined ? null : { kind: "objects", index });
  }

  $effect(() => {
    scene; models; // redraw when the scene or a model changes
    if (renderer) untrack(rebuild);
  });
  $effect(() => {
    selected;
    untrack(attach);
  });
  // while an object is being placed the left button paints; the right button and the wheel still move the view
  $effect(() => {
    const on = !!placing || erasing;
    if (controls) controls.mouseButtons.LEFT = on ? (null as unknown as THREE.MOUSE) : THREE.MOUSE.ROTATE;
    if (!on) ring.visible = false;
    if (on) gizmo?.detach();
    else untrack(attach);
  });
</script>

<div class="view" bind:this={box}>
  <canvas bind:this={canvas} aria-label="3D scene view"></canvas>
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
