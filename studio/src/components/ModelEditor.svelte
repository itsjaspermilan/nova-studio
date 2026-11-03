<script lang="ts">
  import { onMount, untrack } from "svelte";
  import * as THREE from "three";
  import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
  import {
    FACES, History, SHAPES, addCube, addPart, afterRemoval, countCubes, cubeAt, duplicateNode, faceColor, newModel, parseModel, partAt, removeNode, samePath, serializeModel,
    setCube, setFaceColor, updateCube, updatePart, walk, namesOf, PROPS, MAX_SEGMENTS, MIN_SEGMENTS, DEFAULT_SEGMENTS, type Cube, type Face, type ModelDoc, type Path, type Prop, type Shape, type Vec3,
  } from "../lib/model-doc";
  import { addFace, deleteFaces, deleteVerts, extrudeFace, flipFaces, freshMesh, mirrorElement, mirrorPart, moveVerts, setFaceColors, setSmooth, setVert, subdivide, toMesh, weld, weldable, type Axis } from "../lib/mesh-edit";
  import { hasVolume, meshOf, segmentsOf, shapeFaces } from "../lib/model-mesh";
  import { bakeAll, blockOf, enableTexture, fitPicture, packModel, resizeTexture, unwrap, uvsOf } from "../lib/model-uv";
  import { CLEAR, cloneRaster, drawLine, floodFill, getPixel, parseHex, stamp, toHex, type Raster, type Rgba } from "../lib/pixels";
  import { loadRaster, rasterToDataUrl } from "../lib/png";
  import { exportGlb } from "../lib/glb";
  import { addClip, findTrack, pathKey, removeClip, removeKey, samplePose, setKey, snapTime, updateClip, KEY_STEP, type Pose } from "../lib/model-anim";
  import { toBase64 } from "../lib/wav";
  import { studio } from "../lib/store.svelte";

  let { path: filePath, text, onjson }: { path: string; text: string; onjson: () => void } = $props();

  const parsed = untrack(() => parseModel(text));
  const error = parsed.ok ? "" : parsed.error;
  let doc: ModelDoc = $state.raw(parsed.ok ? parsed.doc : newModel());
  let selected = $state<Path | null>(null);
  let showGrid = $state(true);
  // editing the points of a mesh
  let editPoints = $state(false);
  let selVerts = $state<number[]>([]);
  let selFace = $state<number | null>(null);
  let snap = $state(true);
  let extrudeBy = $state(4);
  let newKind = $state<Shape | "square">("box");
  let pendingEdit = false;
  // animation
  let mode = $state<"model" | "texture" | "animate">("model");
  let clipIndex = $state(0);
  let animTime = $state(0);
  let playingAnim = $state(false);
  const history = new History();
  let tick = $state(0);
  const canUndo = $derived(tick >= 0 && history.canUndo);
  const canRedo = $derived(tick >= 0 && history.canRedo);
  const glbPath = untrack(() => filePath).replace(/\.model\.json$/i, ".glb");
  const modelName = glbPath.slice(glbPath.lastIndexOf("/") + 1).replace(/\.glb$/, "");

  let canvas: HTMLCanvasElement | undefined = $state();
  let box: HTMLDivElement | undefined = $state();
  let webglFailed = $state(false);

  // ---- the model's texture: a picture painted on the shapes' unwrapped faces -----------------------------------------
  const texturePath = untrack(() => filePath).replace(/\.model\.json$/i, ".texture.png");
  let picture = $state.raw<Raster | null>(null);
  let picRev = $state(0); // bumps whenever the picture's pixels change
  let texCanvas: HTMLCanvasElement | undefined;
  let texData: Uint8ClampedArray | undefined;
  let texImage: ImageData | undefined;
  let threeTex: THREE.CanvasTexture | undefined;
  type TexTool = "pencil" | "eraser" | "fill" | "picker" | "move";
  let texTool = $state<TexTool>("pencil");
  let texColor = $state<Rgba>([220, 70, 70, 255]);
  let texBrush = $state(1);
  let texTick = $state(0);
  const texPast: Raster[] = [];
  let texFuture: Raster[] = [];
  const canUndoTex = $derived(texTick >= 0 && texPast.length > 0);
  const canRedoTex = $derived(texTick >= 0 && texFuture.length > 0);
  const hasTexture = (d: ModelDoc) => !!d.texture && walk(d).some(({ part }) => part.cubes.some((c) => c.texture && hasVolume(c)));

  /// Copies the picture to the canvas the 3D view reads: the picture with a row of white under it (what shapes without
  /// texels sample). `rect` limits the copy to what changed.
  function syncTexture(rect?: { x: number; y: number; w: number; h: number }) {
    if (!picture || !doc.texture) {
      threeTex?.dispose();
      threeTex = texCanvas = texData = texImage = undefined;
      return;
    }
    const { w, h } = picture;
    if (!texCanvas || texCanvas.width !== w || texCanvas.height !== h + 1) {
      texCanvas = document.createElement("canvas");
      texCanvas.width = w;
      texCanvas.height = h + 1;
      const white = texCanvas.getContext("2d")!;
      white.fillStyle = "#fff";
      white.fillRect(0, h, w, 1);
      threeTex?.dispose();
      threeTex = new THREE.CanvasTexture(texCanvas);
      threeTex.colorSpace = THREE.SRGBColorSpace;
      threeTex.magFilter = threeTex.minFilter = THREE.NearestFilter;
      threeTex.generateMipmaps = false;
      threeTex.flipY = false;
      texImage = undefined;
      rect = undefined;
    }
    if (!texImage || texData !== picture.data) {
      texData = picture.data;
      texImage = new ImageData(picture.data as Uint8ClampedArray<ArrayBuffer>, w, h);
      rect = undefined;
    }
    const ctx = texCanvas.getContext("2d")!;
    if (rect) ctx.putImageData(texImage, 0, 0, rect.x, rect.y, rect.w, rect.h);
    else ctx.putImageData(texImage, 0, 0);
    threeTex!.needsUpdate = true;
  }

  async function loadPicture() {
    try {
      picture = fitPicture(doc, await loadRaster(await studio.api!.readImage(texturePath)));
    } catch {
      picture = bakeAll(doc); // no picture on disk yet: start from the shapes' colours
    }
    studio.sessions.set(filePath, { doc, picture });
    syncTexture();
    rebuild();
  }

  // Editors with files of their own register a save hook; this one writes the .glb the game loads, and the texture picture.
  onMount(() => {
    if (error) return;
    studio.saveHooks.set(filePath, async () => {
      const kept = studio.sessions.get(filePath) as { doc: ModelDoc; picture?: Raster | null } | undefined;
      const d = kept?.doc ?? doc;
      let image: Raster | undefined;
      if (d.texture) {
        image = fitPicture(d, kept?.picture ?? picture ?? bakeAll(d));
        await studio.api!.writeImage(texturePath, rasterToDataUrl(image));
        if (!studio.files.some((f) => f.path === texturePath)) void studio.refreshFiles();
      }
      const bytes = exportGlb(d, image);
      await studio.api!.writeModel(glbPath, `data:model/gltf-binary;base64,${toBase64(bytes)}`);
    });
    const kept = studio.sessions.get(filePath) as { doc: ModelDoc; picture?: Raster | null } | undefined;
    if (kept?.picture) picture = kept.picture;
    studio.sessions.set(filePath, { doc, picture });
    if (!picture && doc.texture) void loadPicture();
  });

  function commit(next: ModelDoc, keep = false) {
    if (!keep) history.record(doc);
    doc = next;
    tick++;
    studio.sessions.set(filePath, { doc, picture });
    studio.edit(filePath, serializeModel(next));
  }
  const undo = () => {
    const p = history.undo(doc);
    if (p) commit(p, true);
  };
  const redo = () => {
    const n = history.redo(doc);
    if (n) commit(n, true);
  };

  // ---- three.js viewport ----------------------------------------------------------------------------
  let renderer: THREE.WebGLRenderer | undefined;
  let scene: THREE.Scene | undefined;
  let camera: THREE.PerspectiveCamera | undefined;
  let controls: OrbitControls | undefined;
  let modelGroup: THREE.Group | undefined;
  let grid: THREE.GridHelper | undefined;
  let outline: THREE.Box3Helper | undefined;
  let frameId = 0;
  const meshes: { mesh: THREE.Mesh; path: Path; polyOfTriangle: number[] }[] = [];
  /// Part groups by name path, with how they are authored, so a clip can pose them and put them back.
  const groups = new Map<string, { group: THREE.Group; origin: Vec3; rotation: Vec3 }>();

  function setup() {
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas!, antialias: true });
    } catch {
      webglFailed = true;
      return;
    }
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x15171c);
    camera = new THREE.PerspectiveCamera(45, 1, 0.5, 2000);
    camera.position.set(34, 28, 46);
    controls = new OrbitControls(camera, canvas!);
    controls.target.set(0, 8, 0);
    controls.enableDamping = true;
    scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(20, 40, 30);
    scene.add(sun);
    grid = new THREE.GridHelper(64, 32, 0x4a5163, 0x2c313c);
    scene.add(grid);
    modelGroup = new THREE.Group();
    scene.add(modelGroup);
    rebuild();
    const loop = () => {
      frameId = requestAnimationFrame(loop);
      controls!.update();
      renderer!.render(scene!, camera!);
    };
    loop();
  }

  /// Vertex colours as the view wants them: sRGB bytes in, linear floats out, alpha kept.
  function linear(bytes: number[]): number[] {
    const out: number[] = [];
    const cache = new Map<number, number>();
    const lin = (b: number) => {
      let v = cache.get(b);
      if (v === undefined) {
        v = new THREE.Color().setRGB(b / 255, b / 255, b / 255, THREE.SRGBColorSpace).r;
        cache.set(b, v);
      }
      return v;
    };
    for (let i = 0; i < bytes.length; i += 4) out.push(lin(bytes[i]!), lin(bytes[i + 1]!), lin(bytes[i + 2]!), bytes[i + 3]! / 255);
    return out;
  }
  const disposeMeshes = () => {
    for (const m of meshes) {
      m.mesh.geometry.dispose();
      (m.mesh.material as THREE.Material).dispose();
    }
  };

  function rebuild() {
    if (!modelGroup) return;
    disposeMeshes();
    meshes.length = 0;
    groups.clear();
    modelGroup.clear();
    syncTexture();
    const useTexture = !!threeTex && hasTexture(doc);
    const [texW, texH] = picture ? [picture.w, picture.h + 1] : [1, 1];
    const build = (list: ModelDoc["parts"], parent: THREE.Object3D, prefix: number[]) => {
      list.forEach((part, i) => {
        const parts = [...prefix, i];
        const group = new THREE.Group();
        groups.set(pathKey(namesOf(doc, parts)), { group, origin: [...part.origin], rotation: [...part.rotation] });
        group.position.set(...part.origin);
        group.rotation.set(...(part.rotation.map((d) => (d * Math.PI) / 180) as Vec3), "XYZ");
        group.name = part.name;
        part.cubes.forEach((cube, ci) => {
          const m = meshOf(cube);
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute("position", new THREE.Float32BufferAttribute(m.positions, 3));
          geometry.setAttribute("normal", new THREE.Float32BufferAttribute(m.normals, 3));
          geometry.setAttribute("color", new THREE.Float32BufferAttribute(linear(m.colors), 4));
          geometry.setIndex(m.indices);
          if (useTexture) {
            // Painted shapes read their own texels; the others read the white row under the picture, so their colour shows as it is.
            const own = uvsOf(cube);
            const count = m.positions.length / 3;
            const uv = new Float32Array(count * 2);
            for (let i = 0; i < count; i++) {
              uv[i * 2] = own.length ? own[i * 2]! / texW : 0.5 / texW;
              uv[i * 2 + 1] = own.length ? own[i * 2 + 1]! / texH : (texH - 0.5) / texH;
            }
            geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
          }
          const translucent = m.colors.some((c, k) => k % 4 === 3 && c < 255);
          // A mesh can be a single sheet, so it shows from both sides while you build it.
          const material = new THREE.MeshLambertMaterial({ vertexColors: true, map: useTexture ? threeTex : null, transparent: translucent, side: cube.shape === "mesh" ? THREE.DoubleSide : THREE.FrontSide });
          const mesh = new THREE.Mesh(geometry, material);
          group.add(mesh);
          meshes.push({ mesh, path: { parts, cube: ci }, polyOfTriangle: m.polyOfTriangle });
        });
        parent.add(group);
        build(part.children, group, parts);
      });
    };
    build(doc.parts, modelGroup, []);
    applyPose();
  }

  /// Puts every part where the clip says at the current time (or where it was authored, outside animate mode).
  function applyPose() {
    if (!modelGroup) return;
    const clip = mode === "animate" ? doc.clips?.[clipIndex] : undefined;
    const pose: Map<string, Pose> = clip ? samplePose(clip, animTime, false) : new Map();
    for (const [key, g] of groups) {
      g.group.position.set(...g.origin);
      g.group.rotation.set(...(g.rotation.map((d) => (d * Math.PI) / 180) as Vec3), "XYZ");
      g.group.scale.set(1, 1, 1);
      const p = pose.get(key);
      if (p?.position) g.group.position.set(...p.position);
      if (p?.rotation) g.group.quaternion.set(...p.rotation);
      if (p?.scale) g.group.scale.set(...p.scale);
    }
    modelGroup.updateMatrixWorld(true);
    drawOutline();
  }

  function drawOutline() {
    if (!scene) return;
    if (outline) {
      scene.remove(outline);
      outline.dispose();
      outline = undefined;
    }
    if (!selected) return;
    const box3 = new THREE.Box3();
    const inside = (p: Path) => (selected!.cube === undefined ? p.parts.length >= selected!.parts.length && selected!.parts.every((n, i) => n === p.parts[i]) : samePath(p, selected));
    for (const m of meshes) if (inside(m.path)) box3.expandByObject(m.mesh);
    if (box3.isEmpty()) return;
    outline = new THREE.Box3Helper(box3, 0xffd166);
    scene.add(outline);
  }

  $effect(() => {
    doc; // redraw whenever the model changes
    if (modelGroup) untrack(rebuild);
  });
  $effect(() => {
    selected;
    untrack(drawOutline);
  });
  $effect(() => {
    animTime; clipIndex; mode;
    untrack(applyPose);
  });
  // Playback: advance the time every frame, wrapping if the clip loops and stopping at its end if not.
  $effect(() => {
    if (!playingAnim) return;
    let last = performance.now();
    let id = 0;
    const tick = (now: number) => {
      const clip = untrack(() => doc.clips?.[clipIndex]);
      if (!clip) return void (playingAnim = false);
      let t = untrack(() => animTime) + (now - last) / 1000;
      last = now;
      if (t >= clip.duration) {
        if (clip.loop) t %= clip.duration;
        else {
          t = clip.duration;
          playingAnim = false;
        }
      }
      animTime = t;
      if (playingAnim) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  });
  $effect(() => {
    if (grid) grid.visible = showGrid;
  });

  $effect(() => {
    if (!box || !canvas || error) return;
    untrack(setup);
    const watch = new ResizeObserver(() => {
      if (!renderer || !camera) return;
      const w = Math.max(100, box!.clientWidth);
      const h = Math.max(100, box!.clientHeight);
      renderer.setSize(w, h, false);
      canvas!.style.width = `${w}px`;
      canvas!.style.height = `${h}px`;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    watch.observe(box);
    return () => {
      watch.disconnect();
      cancelAnimationFrame(frameId);
      controls?.dispose();
      disposeMeshes();
      clearHandles();
      outline?.dispose();
      renderer?.dispose();
      renderer = undefined;
    };
  });

  // ---- painting ----------------------------------------------------------------------------------------------
  let stroke: { last: [number, number] | null } | null = null;
  function textureHit(e: PointerEvent): [number, number] | null {
    if (!camera || !canvas || !picture) return null;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(pointer(e), camera);
    const hit = ray.intersectObjects(meshes.map((m) => m.mesh), false)[0];
    const entry = hit && meshes.find((m) => m.mesh === hit.object);
    if (!hit?.uv || !entry || !cubeAt(doc, entry.path)?.texture) return null;
    return [Math.min(picture.w - 1, Math.max(0, Math.floor(hit.uv.x * picture.w))), Math.min(picture.h - 1, Math.max(0, Math.floor(hit.uv.y * (picture.h + 1))))];
  }
  function rememberPicture() {
    if (!picture) return;
    texPast.push(cloneRaster(picture));
    if (texPast.length > 30) texPast.shift();
    texFuture = [];
    texTick++;
  }
  function beginStroke() {
    if (texTool !== "picker") rememberPicture();
    stroke = { last: null };
  }
  function pictureChanged() {
    picRev++;
    syncTexture();
    studio.sessions.set(filePath, { doc, picture });
    studio.markPending(filePath);
  }
  function paintTexel(x: number, y: number) {
    if (!picture || !stroke) return;
    if (texTool === "picker") {
      const c = getPixel(picture, x, y);
      if (c && c[3] > 0) texColor = c;
      return;
    }
    if (texTool === "fill") floodFill(picture, x, y, texColor);
    else {
      const colour = texTool === "eraser" ? CLEAR : texColor;
      if (stroke.last) drawLine(picture, { x: stroke.last[0], y: stroke.last[1] }, { x, y }, texBrush, colour);
      else stamp(picture, x, y, texBrush, colour);
    }
    stroke.last = [x, y];
    pictureChanged();
  }
  function undoTexture() {
    const before = texPast.pop();
    if (!before || !picture) return;
    texFuture.push(cloneRaster(picture));
    picture = before;
    texTick++;
    pictureChanged();
  }
  function redoTexture() {
    const after = texFuture.pop();
    if (!after || !picture) return;
    texPast.push(cloneRaster(picture));
    picture = after;
    texTick++;
    pictureChanged();
  }
  const texHex = $derived(toHex([texColor[0], texColor[1], texColor[2], 255]));
  function pickTexHex(h: string) {
    const c = parseHex(h);
    if (c) texColor = c;
  }
  const TEX_PALETTE = ["#000000", "#555566", "#c4c4d0", "#ffffff", "#5b2a1a", "#8b4a2b", "#c27a3e", "#f2b66d", "#c1272d", "#ef5b4c", "#2f7d46", "#6cc24a", "#2a62c9", "#4fa3ff", "#7b3fc4", "#ffe14d"];

  // the 2D view of the picture, with every shape's unwrapped faces drawn over it
  let texView: HTMLCanvasElement | undefined = $state();
  const texZoom = $derived(picture ? Math.max(1, Math.min(8, Math.floor(340 / picture.w))) : 1);
  const painted = $derived(walk(doc).flatMap(({ part, parts }) => part.cubes.map((c, ci) => ({ c, path: { parts, cube: ci } as Path })).filter((x) => x.c.texture && hasVolume(x.c))));
  function paintView() {
    const ctx = texView?.getContext("2d");
    if (!ctx || !texView || !picture) return;
    const z = texZoom;
    texView.width = picture.w * z;
    texView.height = picture.h * z;
    const cell = Math.max(4, Math.min(z * 2, 8));
    for (let y = 0; y * cell < texView.height; y++) for (let x = 0; x * cell < texView.width; x++) {
      ctx.fillStyle = (x + y) % 2 ? "#3a3d48" : "#2e313b";
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
    const tmp = document.createElement("canvas");
    tmp.width = picture.w;
    tmp.height = picture.h;
    tmp.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(picture.data), picture.w, picture.h), 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, texView.width, texView.height);
    for (const { c, path } of painted) {
      const on = !!selected && samePath(path, selected);
      const [ax, ay] = c.texture!.at;
      ctx.strokeStyle = on ? "rgba(255,209,102,.95)" : "rgba(255,255,255,.35)";
      ctx.lineWidth = on ? 1.5 : 1;
      for (const poly of unwrap(c).polys) {
        ctx.beginPath();
        poly.forEach((q, i) => (i ? ctx.lineTo((ax + q[0]) * z, (ay + q[1]) * z) : ctx.moveTo((ax + q[0]) * z, (ay + q[1]) * z)));
        ctx.closePath();
        ctx.stroke();
      }
      if (on) {
        const b = blockOf(c);
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(b.x * z + 0.5, b.y * z + 0.5, b.w * z, b.h * z);
        ctx.setLineDash([]);
      }
    }
  }
  $effect(() => {
    picRev; doc; selected; mode; texView; picture;
    untrack(paintView);
  });
  let blockDrag: { path: Path; base: ModelDoc; cube: Cube; from: [number, number]; at: [number, number]; moved: boolean } | null = null;
  function texCell(e: PointerEvent): [number, number] {
    const r = texView!.getBoundingClientRect();
    return [Math.floor(((e.clientX - r.left) / r.width) * picture!.w), Math.floor(((e.clientY - r.top) / r.height) * picture!.h)];
  }
  function texDown(e: PointerEvent) {
    if (!picture || !texView || e.button !== 0) return;
    const [x, y] = texCell(e);
    texView.setPointerCapture(e.pointerId);
    if (texTool === "move") {
      for (const t of [...painted].reverse()) {
        const b = blockOf(t.c);
        if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) {
          selected = t.path;
          blockDrag = { path: t.path, base: doc, cube: t.c, from: [x, y], at: [...t.c.texture!.at], moved: false };
          return;
        }
      }
      return;
    }
    if (x < 0 || y < 0 || x >= picture.w || y >= picture.h) return;
    beginStroke();
    paintTexel(x, y);
  }
  function texMove(e: PointerEvent) {
    if (!picture || !texView) return;
    const [x, y] = texCell(e);
    if (blockDrag) {
      const b = blockOf(blockDrag.cube);
      const at: [number, number] = [Math.max(0, Math.min(picture.w - b.w, blockDrag.at[0] + x - blockDrag.from[0])), Math.max(0, Math.min(picture.h - b.h, blockDrag.at[1] + y - blockDrag.from[1]))];
      if (!blockDrag.moved && at[0] === blockDrag.at[0] && at[1] === blockDrag.at[1]) return;
      if (!blockDrag.moved) history.record(blockDrag.base);
      blockDrag.moved = true;
      commit(setCube(blockDrag.base, blockDrag.path, { ...blockDrag.cube, texture: { ...blockDrag.cube.texture!, at } }), true);
      return;
    }
    if (stroke && x >= 0 && y >= 0 && x < picture.w && y < picture.h) paintTexel(x, y);
    else if (stroke) stroke.last = null;
  }
  function texUp() {
    stroke = null;
    blockDrag = null;
  }

  // turning texturing on for the selected shape, resizing and packing
  function toggleTexture(on: boolean) {
    if (!selected || selected.cube === undefined || !cube) return;
    if (!on) {
      commit(setCube(doc, selected, { ...cube, texture: undefined }));
      return;
    }
    const r = enableTexture(doc, picture, selected.parts, selected.cube);
    if (!r) return;
    rememberPicture();
    picture = r.picture;
    commit(r.doc);
    syncTexture();
    pictureChanged();
    if (!r.fits) studio.say("info", "The texture is full: make it bigger (Texture tab) or give this shape fewer texels.");
  }
  function setTextureSize(w: number, h: number) {
    if (!picture || !doc.texture) return;
    const r = resizeTexture(doc, picture, w, h);
    rememberPicture();
    picture = r.picture;
    commit(r.doc);
    pictureChanged();
  }
  function packAll() {
    const r = packModel(doc);
    commit(r.doc);
    const size = r.doc.texture?.size;
    if (picture && size && (picture.w !== size[0] || picture.h !== size[1])) setTextureSize(size[0], size[1]);
    studio.say("info", r.fits ? "Every shape has a new block. Pixels you painted stay where they were: repaint or move them." : "The shapes do not all fit in the biggest texture (1024). Give some fewer texels.");
  }
  function setScale(raw: string) {
    const n = Number(raw);
    if (!selected || !cube?.texture || !Number.isFinite(n) || n <= 0 || n > 64) return;
    commit(setCube(doc, selected, { ...cube, texture: { ...cube.texture, ...(n === 1 ? { scale: undefined } : { scale: n }) } }));
  }

  // ---- points and faces of a mesh in the view -------------------------------------------------------
  let handles: THREE.Points | undefined;
  let faceLine: THREE.LineLoop | undefined;
  function clearHandles() {
    for (const o of [handles, faceLine]) {
      if (!o) continue;
      scene?.remove(o);
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
    handles = faceLine = undefined;
  }
  const groupOf = (parts: number[]) => groups.get(pathKey(namesOf(doc, parts)))?.group;
  /// The selected mesh's points in the world.
  function worldVerts(): THREE.Vector3[] {
    const g = selected ? groupOf(selected.parts) : undefined;
    if (!g || !cube?.verts) return [];
    return cube.verts.map((p) => new THREE.Vector3(...p).applyMatrix4(g.matrixWorld));
  }
  function drawHandles() {
    clearHandles();
    if (!scene || !inEdit || !cube) return;
    const pts = worldVerts();
    const chosen = new Set(selVerts);
    const geometry = new THREE.BufferGeometry().setFromPoints(pts);
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(pts.flatMap((_, i) => (chosen.has(i) ? [1, 0.82, 0.4] : [0.9, 0.93, 1])), 3));
    handles = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 9, sizeAttenuation: false, vertexColors: true, depthTest: false }));
    handles.renderOrder = 10;
    scene.add(handles);
    const face = selFace === null ? undefined : cube.polys?.[selFace];
    if (face) {
      const line = new THREE.BufferGeometry().setFromPoints(face.v.map((i) => pts[i]!));
      faceLine = new THREE.LineLoop(line, new THREE.LineBasicMaterial({ color: 0xffd166, depthTest: false }));
      faceLine.renderOrder = 9;
      scene.add(faceLine);
    }
  }

  const pointer = (e: PointerEvent) => {
    const r = canvas!.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  };
  /// The point whose handle is within a few pixels of the pointer, or -1.
  function pickVert(e: PointerEvent): number {
    if (!camera || !canvas) return -1;
    const r = canvas.getBoundingClientRect();
    let best = -1;
    let bestDist = 11;
    worldVerts().forEach((w, i) => {
      const p = w.clone().project(camera!);
      if (p.z > 1) return;
      const d = Math.hypot(((p.x + 1) / 2) * r.width + r.left - e.clientX, ((1 - p.y) / 2) * r.height + r.top - e.clientY);
      if (d < bestDist) {
        best = i;
        bestDist = d;
      }
    });
    return best;
  }

  // Click (without dragging) selects the shape under the pointer; in point mode it picks the face instead.
  // Dragging a point's handle moves it, and every other selected point with it.
  let downAt: [number, number] | null = null;
  let drag: { point: number; base: ModelDoc; baseCube: Cube; path: Path; start: THREE.Vector3; plane: THREE.Plane; moved: boolean } | null = null;
  function pointerDown(e: PointerEvent) {
    downAt = [e.clientX, e.clientY];
    if (mode === "texture" && texTool !== "move" && picture && e.button === 0 && !e.altKey && canvas) {
      const t = textureHit(e);
      if (t) {
        beginStroke();
        paintTexel(t[0], t[1]);
        controls!.enabled = false;
        canvas.setPointerCapture(e.pointerId);
        return;
      }
    }
    if (!inEdit || !camera || !canvas || !selected || !cube || e.button !== 0) return;
    const point = pickVert(e);
    if (point < 0) return;
    if (e.shiftKey) selVerts = selVerts.includes(point) ? selVerts.filter((v) => v !== point) : [...selVerts, point];
    else if (!selVerts.includes(point)) selVerts = [point];
    selFace = null;
    if (!selVerts.includes(point)) return;
    const start = worldVerts()[point]!;
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), start);
    drag = { point, base: doc, baseCube: cube, path: selected, start, plane, moved: false };
    controls!.enabled = false;
    canvas.setPointerCapture(e.pointerId);
  }
  function pointerMove(e: PointerEvent) {
    if (stroke && mode === "texture") {
      const t = textureHit(e);
      if (t) paintTexel(t[0], t[1]);
      else stroke.last = null;
      return;
    }
    if (!drag || !camera) return;
    const g = groupOf(drag.path.parts);
    if (!g) return;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(pointer(e), camera);
    const hit = ray.ray.intersectPlane(drag.plane, new THREE.Vector3());
    if (!hit) return;
    const local = hit.sub(drag.start).applyMatrix3(new THREE.Matrix3().setFromMatrix4(g.matrixWorld.clone().invert()));
    const from = drag.baseCube.verts![drag.point]!;
    const step = snap ? 1 : 0.01;
    const delta = [0, 1, 2].map((a) => Math.round((from[a]! + [local.x, local.y, local.z][a]!) / step) * step - from[a]!) as Vec3;
    if (!drag.moved && delta.every((d) => d === 0)) return;
    if (!drag.moved) history.record(drag.base);
    drag.moved = true;
    commit(setCube(drag.base, drag.path, moveVerts(drag.baseCube, selVerts, delta)), true);
  }
  function pointerUp(e: PointerEvent) {
    if (stroke) {
      stroke = null;
      downAt = null;
      if (controls) controls.enabled = true;
      return;
    }
    if (drag) {
      drag = null;
      downAt = null;
      if (controls) controls.enabled = true;
      return;
    }
    if (!downAt || !camera || !canvas) return;
    const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
    downAt = null;
    if (moved > 4) return;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(pointer(e), camera);
    if (inEdit && selected) {
      const mine = meshes.find((m) => samePath(m.path, selected));
      const hit = mine ? ray.intersectObject(mine.mesh, false)[0] : undefined;
      const face = hit?.faceIndex != null ? mine!.polyOfTriangle[hit.faceIndex] : undefined;
      selFace = face ?? null;
      selVerts = face !== undefined ? [...cube!.polys![face]!.v] : e.shiftKey ? selVerts : [];
      canvas.focus();
      return;
    }
    const hit = ray.intersectObjects(meshes.map((m) => m.mesh), false)[0];
    selected = hit ? (meshes.find((m) => m.mesh === hit.object)?.path ?? null) : null;
    canvas.focus();
  }

  function resetView() {
    camera?.position.set(34, 28, 46);
    controls?.target.set(0, 8, 0);
  }

  // ---- editing ------------------------------------------------------------------------------------------
  const rows = $derived(walk(doc));
  const cube = $derived(selected ? cubeAt(doc, selected) : undefined);
  const inEdit = $derived(editPoints && mode === "model" && cube?.shape === "mesh");
  const isRound = $derived(cube?.shape === "cylinder" || cube?.shape === "cone" || cube?.shape === "sphere");
  const paintFaces = $derived(shapeFaces(cube?.shape));
  const shapeName = (c: Cube) => c.name || (c.shape && c.shape !== "box" ? c.shape : "cube");
  // The edit state belongs to one element: choosing another leaves point mode.
  let lastKey = "";
  $effect(() => {
    const k = selected ? `${selected.parts.join(".")}/${selected.cube ?? ""}` : "";
    if (k === lastKey) return;
    lastKey = k;
    editPoints = pendingEdit;
    pendingEdit = false;
    selVerts = [];
    selFace = null;
  });
  $effect(() => {
    doc; selected; selVerts; selFace; inEdit; mode;
    untrack(drawHandles);
  });
  const part = $derived(selected && selected.cube === undefined ? partAt(doc, selected.parts) : selected ? partAt(doc, selected.parts) : undefined);

  function newPart(parent: number[]) {
    const r = addPart(doc, parent);
    commit(r.doc);
    selected = r.path;
  }
  function newCube() {
    const target = selected?.parts ?? (doc.parts.length ? [0] : null);
    if (!target) return newPart([]);
    const kind = newKind;
    const square = kind === "square";
    const r = addCube(doc, target, kind === "square" ? freshMesh() : { shape: kind });
    commit(r.doc);
    pendingEdit = square; // a new sheet is for pulling into shape
    selected = r.path;
  }
  function remove() {
    if (!selected) return;
    const gone = selected;
    const next = removeNode(doc, gone);
    if (next === doc) return;
    commit(next);
    selected = afterRemoval(next, gone);
  }
  function duplicate() {
    if (!selected) return;
    const r = duplicateNode(doc, selected);
    if (!r) return;
    commit(r.doc);
    selected = r.path;
  }
  const num = (raw: string, fallback: number) => (Number.isFinite(Number(raw)) && raw.trim() !== "" ? Number(raw) : fallback);
  function setVec(kind: "from" | "size" | "origin" | "rotation", index: number, raw: string) {
    if (!selected) return;
    if (kind === "origin" || kind === "rotation") {
      const p = partAt(doc, selected.parts)!;
      const v = [...p[kind]] as Vec3;
      v[index] = num(raw, v[index]!);
      commit(updatePart(doc, selected.parts, { [kind]: v }));
    } else if (cube) {
      const v = [...cube[kind]] as Vec3;
      v[index] = num(raw, v[index]!);
      commit(updateCube(doc, selected, { [kind]: v }));
    }
  }
  // ---- mesh tools ---------------------------------------------------------------------------------------
  function change(next: Cube, reset = false) {
    if (!selected) return;
    commit(setCube(doc, selected, next));
    if (reset) {
      selVerts = [];
      selFace = null;
    }
  }
  function makeEditable() {
    if (!selected || !cube) return;
    if (cube.shape !== "mesh") change(toMesh(cube));
    editPoints = true;
  }
  function extrude() {
    if (!selected || !cube || selFace === null) return;
    const r = extrudeFace(cube, selFace, extrudeBy);
    change(r.cube);
    selVerts = r.points;
  }
  function makeFace() {
    if (!cube || selVerts.length < 3) return;
    const before = cube.polys?.length ?? 0;
    const next = addFace(cube, selVerts);
    change(next);
    if ((next.polys?.length ?? 0) > before) selFace = before;
  }
  function removeFacePicked() {
    if (cube && selFace !== null) change(deleteFaces(cube, [selFace]), true);
  }
  function removePointsPicked() {
    if (cube && selVerts.length) change(deleteVerts(cube, selVerts), true);
  }
  const vert = (i: number) => cube?.verts?.[selVerts[0]!]?.[i] ?? 0;
  function setVertAxis(i: number, raw: string) {
    if (!cube?.verts || selVerts.length !== 1 || raw.trim() === "" || !Number.isFinite(Number(raw))) return;
    const p = [...cube.verts[selVerts[0]!]!] as Vec3;
    p[i] = Number(raw);
    change(setVert(cube, selVerts[0]!, p));
  }
  const weldCount = $derived(cube?.shape === "mesh" ? weldable(cube) : 0);
  function mirrorCopy(axis: Axis) {
    if (!selected || !cube) return;
    const r = addCube(doc, selected.parts, mirrorElement(cube, axis));
    commit(r.doc);
    selected = r.path;
  }
  function mirrorPartCopy(axis: Axis) {
    if (!selected) return;
    const r = mirrorPart(doc, selected.parts, axis);
    if (!r) return;
    commit(r.doc);
    selected = r.path;
  }
  const faceHex = $derived(cube && selFace !== null ? (cube.polys?.[selFace]?.color ?? cube.color).slice(0, 7) : "#c9d1d9");

  function nudge(dx: number, dy: number, dz: number) {
    if (!selected) return;
    if (inEdit && cube && selVerts.length) change(moveVerts(cube, selVerts, [dx, dy, dz]));
    else if (selected.cube !== undefined && cube) commit(updateCube(doc, selected, { from: [cube.from[0] + dx, cube.from[1] + dy, cube.from[2] + dz] }));
    else if (part) commit(updatePart(doc, selected.parts, { origin: [part.origin[0] + dx, part.origin[1] + dy, part.origin[2] + dz] }));
  }
  // ---- animation ----------------------------------------------------------------------------------------
  const clips = $derived(doc.clips ?? []);
  const clip = $derived(clips[clipIndex]);
  const partNames = $derived(selected ? namesOf(doc, selected.parts) : []);
  const authored = (p: NonNullable<typeof part>, prop: Prop): Vec3 => (prop === "position" ? p.origin : prop === "rotation" ? p.rotation : [1, 1, 1]);
  const toEuler = (q: [number, number, number, number]): Vec3 => {
    const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...q), "XYZ");
    return [e.x, e.y, e.z].map((r) => Math.round(((r * 180) / Math.PI) * 100) / 100) as Vec3;
  };
  /// The value of one property of the selected part right now: from the clip if it keys it, else as authored.
  function poseValue(prop: Prop): Vec3 {
    const p = part;
    if (!p) return [0, 0, 0];
    const pose = clip ? samplePose(clip, animTime, false).get(pathKey(partNames)) : undefined;
    if (prop === "position" && pose?.position) return pose.position;
    if (prop === "scale" && pose?.scale) return pose.scale;
    if (prop === "rotation" && pose?.rotation) return toEuler(pose.rotation);
    return authored(p, prop);
  }
  const keyedHere = (prop: Prop) => !!clip && !!findTrack(clip, partNames, prop)?.keys.some((k) => Math.abs(k.t - animTime) < KEY_STEP / 2);
  function keyProp(prop: Prop, value = poseValue(prop)) {
    if (clip && partNames.length) commit(setKey(doc, clipIndex, partNames, prop, animTime, value));
  }
  function setPoseValue(prop: Prop, index: number, raw: string) {
    const n = Number(raw);
    if (!Number.isFinite(n) || raw.trim() === "") return;
    const v = [...poseValue(prop)] as Vec3;
    v[index] = n;
    keyProp(prop, v); // editing a value in animate mode keys it at the current time
  }
  const keyTimes = $derived(
    clip && partNames.length
      ? [...new Set(PROPS.flatMap((prop) => findTrack(clip, partNames, prop)?.keys.map((k) => k.t) ?? []))].sort((a, b) => a - b)
      : [],
  );
  function newClip() {
    const r = addClip(doc);
    commit(r.doc);
    clipIndex = r.index;
    animTime = 0;
    mode = "animate";
  }
  function dropClip() {
    if (!clip || !confirm(`Delete the animation "${clip.name}"?`)) return;
    commit(removeClip(doc, clipIndex));
    clipIndex = Math.max(0, clipIndex - 1);
    animTime = 0;
    playingAnim = false;
  }
  function deleteKeysHere() {
    let next = doc;
    for (const prop of PROPS) next = removeKey(next, clipIndex, partNames, prop, animTime);
    if (next !== doc) commit(next);
  }
  const fmtTime = (t: number) => t.toFixed(2);

  function key(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA") return;
    const mod = e.metaKey || e.ctrlKey;
    const step = e.shiftKey ? 4 : 1;
    if (e.key === "Escape" && editPoints) {
      editPoints = false;
    } else if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (mode === "texture") e.shiftKey ? redoTexture() : undoTexture();
      else e.shiftKey ? redo() : undo();
    } else if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      if (mode === "texture") redoTexture();
      else redo();
    } else if (mod && e.key.toLowerCase() === "d" && selected) {
      e.preventDefault();
      duplicate();
    } else if ((e.key === "Delete" || e.key === "Backspace") && selected) {
      e.preventDefault();
      remove();
    } else if (selected && !mod) {
      const moves: Record<string, [number, number, number]> = { ArrowLeft: [-step, 0, 0], ArrowRight: [step, 0, 0], ArrowUp: [0, 0, -step], ArrowDown: [0, 0, step], PageUp: [0, step, 0], PageDown: [0, -step, 0] };
      const m = moves[e.key];
      if (m) {
        e.preventDefault();
        nudge(...m);
      }
    }
  }
  const hexOf = (c: string) => c.slice(0, 7);
  const pickColour = (face: Face | "all", value: string) => selected && commit(setFaceColor(doc, selected, face, value));
  const label = (f: Face) => ({ east: "East +x", west: "West −x", up: "Top +y", down: "Bottom −y", south: "South +z", north: "North −z" })[f];
</script>

<svelte:window onkeydown={key} />

{#if error}
  <div class="bad">
    <p><strong>This model file can't be shown visually.</strong></p>
    <p class="dim">{error}</p>
    <button onclick={onjson}>Edit as JSON</button>
  </div>
{:else}
  <div class="editor3d" style:grid-template-columns={mode === "texture" ? "190px minmax(0, 1fr) 380px" : "190px minmax(0, 1fr) 230px"}>
    <aside class="outliner">
      <div class="adder">
        <button onclick={() => newPart(selected?.parts ?? [])} title="New part inside the selected one">＋ Part</button>
        <div class="row">
          <select bind:value={newKind} aria-label="Kind of shape to add">
            <option value="box">Box</option>
            <option value="wedge">Wedge</option>
            <option value="pyramid">Pyramid</option>
            <option value="cylinder">Cylinder</option>
            <option value="cone">Cone</option>
            <option value="sphere">Sphere</option>
            <option value="square">Flat square (to pull out)</option>
          </select>
          <button onclick={newCube} title="New shape in the selected part">＋ Add</button>
        </div>
      </div>
      <ul>
        {#each rows as r (r.parts.join("."))}
          <li>
            <button class="node" class:on={selected?.cube === undefined && samePath(selected, { parts: r.parts })} style:padding-left="{8 + r.depth * 14}px" onclick={() => (selected = { parts: r.parts })}>◈ {r.part.name}</button>
            {#each r.part.cubes as c, ci (ci)}
              <button class="node cube" class:on={samePath(selected, { parts: r.parts, cube: ci })} style:padding-left="{22 + r.depth * 14}px" onclick={() => (selected = { parts: r.parts, cube: ci })}>
                <i class="dot" class:round={c.shape === "sphere" || c.shape === "cylinder" || c.shape === "cone"} style:background={hexOf(c.color)}></i>{c.name || `${c.shape && c.shape !== "box" ? c.shape : "cube"} ${ci + 1}`}
              </button>
            {/each}
          </li>
        {/each}
      </ul>
    </aside>

    <div class="stage">
      <div class="bar">
        <button class="ghost" onclick={undo} disabled={!canUndo} aria-label="Undo">↶</button>
        <button class="ghost" onclick={redo} disabled={!canRedo} aria-label="Redo">↷</button>
        <button class:on={mode === "model"} onclick={() => { mode = "model"; playingAnim = false; }}>Model</button>
        <button class:on={mode === "texture"} onclick={() => { mode = "texture"; playingAnim = false; editPoints = false; }} title="Paint the shapes with a texture">Texture</button>
        <button class:on={mode === "animate"} onclick={() => { mode = "animate"; if (!clips.length) newClip(); }}>Animate</button>
        <label class="check"><input type="checkbox" bind:checked={showGrid} /> Grid</label>
        <button class="ghost" onclick={resetView}>Reset view</button>
        <span class="dim">{countCubes(doc)} shapes · saves {glbPath}</span>
        <span class="spacer"></span>
        <button class="ghost" onclick={onjson}>JSON</button>
      </div>
      <div class="view" bind:this={box}>
        {#if webglFailed}
          <p class="dim pad">3D drawing is not available in this window (WebGL could not start).</p>
        {/if}
        <canvas bind:this={canvas} tabindex="0" aria-label="3D view" onpointerdown={pointerDown} onpointermove={pointerMove} onpointerup={pointerUp}></canvas>
      </div>
      {#if mode === "animate" && clip}
        <div class="timeline">
          <div class="clips">
            <select bind:value={clipIndex} aria-label="Animation" onchange={() => { animTime = 0; playingAnim = false; }}>
              {#each clips as c, i (i)}<option value={i}>{c.name}</option>{/each}
            </select>
            <button onclick={newClip} title="New animation">＋</button>
            <input class="cname" value={clip.name} aria-label="Animation name" onchange={(e) => commit(updateClip(doc, clipIndex, { name: e.currentTarget.value }))} />
            <label class="inline">Length <input type="number" min="0.1" max="600" step="0.1" value={clip.duration} onchange={(e) => commit(updateClip(doc, clipIndex, { duration: Number(e.currentTarget.value) }))} /> s</label>
            <label class="check"><input type="checkbox" checked={clip.loop} onchange={(e) => commit(updateClip(doc, clipIndex, { loop: e.currentTarget.checked }))} /> Loop</label>
            <button class="danger" onclick={dropClip}>Delete</button>
          </div>
          <div class="scrub">
            <button class="primary" onclick={() => { if (animTime >= clip.duration) animTime = 0; playingAnim = !playingAnim; }}>{playingAnim ? "■" : "▶"}</button>
            <div class="track">
              <input type="range" min="0" max={clip.duration} step={KEY_STEP} value={animTime} aria-label="Time" oninput={(e) => { playingAnim = false; animTime = snapTime(Number(e.currentTarget.value)); }} />
              {#each keyTimes as t (t)}
                <button class="diamond" style:left="{(t / clip.duration) * 100}%" title="Key at {fmtTime(t)} s" aria-label="Jump to key at {fmtTime(t)} seconds" onclick={() => { playingAnim = false; animTime = t; }}>◆</button>
              {/each}
            </div>
            <span class="dim time">{fmtTime(animTime)} / {fmtTime(clip.duration)} s</span>
          </div>
        </div>
      {/if}
      {#if mode === "texture"}
        <p class="hint dim">Texture: drag on the model to paint it, or paint in the picture on the right · ✥ moves a shape's block of the picture · ⌘Z undoes painting · right-drag pans, scroll zooms (⌥-drag orbits)</p>
      {:else if inEdit}
        <p class="hint dim">Points: click a face to pick it and its points · click or drag a dot to move it (⇧-click adds more) · arrows and PageUp/PageDown nudge the picked points · Esc leaves point mode</p>
      {:else}
        <p class="hint dim">Drag to orbit · right-drag to pan · scroll to zoom · click a shape to select · arrows and PageUp/PageDown move it (⇧ for 4) · ⌘D duplicates · Delete removes</p>
      {/if}
    </div>

    <aside class="inspector">
      {#if mode === "texture"}
        <h3>Texture</h3>
        {#if !doc.texture || !picture}
          <p class="dim small">This model has no texture yet. A texture is a picture painted onto the shapes: faces, clothes, wood, bricks.</p>
          <button onclick={() => toggleTexture(true)} disabled={!selected || selected.cube === undefined}>Paint the selected shape</button>
          <p class="dim small">{selected && selected.cube !== undefined ? "Its colours become the first pixels of the picture, so nothing changes until you paint." : "Click a shape in the view first."}</p>
        {:else}
          <div class="tools" role="toolbar" aria-label="Painting tools">
            {#each [["pencil", "✎", "Pencil"], ["eraser", "⌫", "Eraser"], ["fill", "▨", "Fill"], ["picker", "✚", "Pick a colour"], ["move", "✥", "Move a shape's block"]] as [id, icon, tip] (id)}
              <button class:on={texTool === id} title={tip} aria-label={tip} onclick={() => (texTool = id as TexTool)}>{icon}</button>
            {/each}
            <span class="gap"></span>
            <button title="Undo painting (⌘Z)" aria-label="Undo painting" disabled={!canUndoTex} onclick={undoTexture}>↶</button>
            <button title="Redo painting" aria-label="Redo painting" disabled={!canRedoTex} onclick={redoTexture}>↷</button>
          </div>
          <div class="paintrow">
            <input type="color" value={texHex} oninput={(e) => pickTexHex(e.currentTarget.value)} aria-label="Paint colour" />
            <input class="mono" value={texHex} onchange={(e) => pickTexHex(e.currentTarget.value)} aria-label="Hex colour" />
            <label class="inline">Brush <input type="number" min="1" max="16" bind:value={texBrush} /></label>
          </div>
          <div class="swatches">
            {#each TEX_PALETTE as c (c)}<button class="swatch" style:background={c} title={c} aria-label={c} onclick={() => pickTexHex(c)}></button>{/each}
          </div>
          <div class="texbox"><canvas bind:this={texView} aria-label="The texture picture" onpointerdown={texDown} onpointermove={texMove} onpointerup={texUp} onpointercancel={texUp}></canvas></div>
          <p class="dim small">{picture.w}×{picture.h} texels · {painted.length} painted shape{painted.length === 1 ? "" : "s"}</p>
          <div class="pair">
            <label>Width <select value={picture.w} onchange={(e) => setTextureSize(Number(e.currentTarget.value), picture!.h)}>{#each [16, 32, 64, 128, 256, 512, 1024] as n (n)}<option value={n}>{n}</option>{/each}</select></label>
            <label>Height <select value={picture.h} onchange={(e) => setTextureSize(picture!.w, Number(e.currentTarget.value))}>{#each [16, 32, 64, 128, 256, 512, 1024] as n (n)}<option value={n}>{n}</option>{/each}</select></label>
          </div>
          {#if cube?.texture}
            <label class="inline">Texels per unit <input type="number" min="0.25" max="8" step="0.25" value={cube.texture.scale ?? 1} onchange={(e) => setScale(e.currentTarget.value)} /></label>
          {/if}
          <div class="row">
            <button onclick={packAll} title="Lays every shape's block out again (painted pixels stay where they are)">Pack blocks</button>
            <button onclick={() => toggleTexture(true)} disabled={!selected || selected.cube === undefined || !!cube?.texture} title="Give the selected shape a block of the picture">Paint selected</button>
          </div>
          <p class="dim small">Saving writes <code>{texturePath}</code> too. Shapes with no block keep their flat colours. A mesh's unwrap follows its faces, so paint meshes after you have shaped them.</p>
        {/if}
      {:else if mode === "animate"}
        <h3>Pose</h3>
        {#if !clip}
          <p class="dim small">Make an animation first (＋).</p>
        {:else if !selected || !part}
          <p class="dim small">Select a part (or one of its cubes) to pose it. Changing a value sets a key at {fmtTime(animTime)} s.</p>
        {:else}
          <p class="small"><strong>{partNames.join(" › ")}</strong></p>
          {#each [["position", "Position"], ["rotation", "Rotation (°)"], ["scale", "Scale"]] as [prop, label] (prop)}
            <h4>{label} {#if keyedHere(prop as Prop)}<span class="keyed" title="There is a key here">◆</span>{/if}</h4>
            <div class="vec">{#each poseValue(prop as Prop) as v, i (i)}<input type="number" step={prop === "scale" ? 0.1 : 1} value={v} aria-label={`${"xyz"[i]} ${prop}`} onchange={(e) => setPoseValue(prop as Prop, i, e.currentTarget.value)} />{/each}</div>
            <button class="ghost keybtn" onclick={() => keyProp(prop as Prop)}>◆ Key {prop}</button>
          {/each}
          <div class="row"><button class="danger" onclick={deleteKeysHere} disabled={!keyTimes.some((t) => Math.abs(t - animTime) < KEY_STEP / 2)}>Delete keys here</button></div>
          <p class="dim small">Properties with no key stay as modelled. Keys blend smoothly; rotations take the short way round.</p>
        {/if}
      {:else if selected && cube}
        <h3>{cube.shape === "mesh" ? "Mesh" : "Shape"}</h3>
        <label>Name <input value={cube.name ?? ""} placeholder="optional" onchange={(e) => commit(updateCube(doc, selected!, { name: e.currentTarget.value.trim() || undefined }))} /></label>
        {#if cube.shape !== "mesh"}
          <label>Shape
            <select value={cube.shape ?? "box"} onchange={(e) => commit(updateCube(doc, selected!, { shape: e.currentTarget.value as Shape }))}>
              {#each SHAPES.filter((k) => k !== "mesh") as k (k)}<option value={k}>{k[0]!.toUpperCase() + k.slice(1)}</option>{/each}
            </select>
          </label>
        {/if}
        {#if isRound}
          <label>Sides <input type="number" min={MIN_SEGMENTS} max={MAX_SEGMENTS} step="1" value={segmentsOf(cube)} onchange={(e) => commit(updateCube(doc, selected!, { segments: Math.min(MAX_SEGMENTS, Math.max(MIN_SEGMENTS, Math.round(num(e.currentTarget.value, DEFAULT_SEGMENTS)))) }))} /></label>
          <label class="check"><input type="checkbox" checked={cube.smooth !== false} onchange={(e) => commit(updateCube(doc, selected!, { smooth: e.currentTarget.checked }))} /> Smooth shading</label>
        {/if}
        <h4>{cube.shape === "mesh" ? "Box around it: corner" : "Corner (from)"}</h4>
        <div class="vec">{#each cube.from as v, i (i)}<input type="number" value={v} aria-label={"xyz"[i] + " from"} onchange={(e) => setVec("from", i, e.currentTarget.value)} />{/each}</div>
        <h4>Size</h4>
        <div class="vec">{#each cube.size as v, i (i)}<input type="number" min="0" value={v} aria-label={"xyz"[i] + " size"} onchange={(e) => setVec("size", i, e.currentTarget.value)} />{/each}</div>
        {#if cube.shape !== "mesh"}
          <h4>Turn (degrees)</h4>
          <div class="vec">{#each cube.rotation ?? [0, 0, 0] as v, i (i)}<input type="number" value={v} aria-label={"xyz"[i] + " turn"} onchange={(e) => { const r = [...(cube.rotation ?? [0, 0, 0])] as Vec3; r[i] = num(e.currentTarget.value, v); commit(updateCube(doc, selected!, { rotation: r })); }} />{/each}</div>
        {/if}
        <h4>Colour</h4>
        <label class="colour">{cube.texture ? "Tint" : cube.shape === "mesh" ? "Mesh" : "All faces"} <input type="color" value={hexOf(cube.color)} onchange={(e) => pickColour("all", e.currentTarget.value)} /></label>
        {#each paintFaces as f (f)}
          <label class="colour">{label(f)} <input type="color" value={hexOf(faceColor(cube, f))} onchange={(e) => pickColour(f, e.currentTarget.value)} /></label>
        {/each}
        <label class="check"><input type="checkbox" checked={!!cube.texture} disabled={!hasVolume(cube)} onchange={(e) => toggleTexture(e.currentTarget.checked)} /> Paint with the model's texture</label>
        <h4>Shape tools</h4>
        <div class="row">
          <button class:on={inEdit} onclick={() => (inEdit ? (editPoints = false) : makeEditable())} title={cube.shape === "mesh" ? "Move points and pull faces" : "Turns this into a free mesh you can pull into shape (undo brings the shape back)"}>{inEdit ? "Done with points" : "Edit points"}</button>
        </div>
        <div class="row mirror">
          <span class="dim small">Mirror copy</span>
          {#each [0, 1, 2] as a (a)}<button onclick={() => mirrorCopy(a as Axis)} title={`A reflected copy across the part's ${"xyz"[a]} = 0 plane`}>{"XYZ"[a]}</button>{/each}
        </div>
        {#if inEdit}
          <h4>Points</h4>
          {#if selVerts.length === 1}
            <div class="vec">{#each [0, 1, 2] as i (i)}<input type="number" step="0.5" value={vert(i)} aria-label={"xyz"[i] + " point"} onchange={(e) => setVertAxis(i, e.currentTarget.value)} />{/each}</div>
          {:else}
            <p class="dim small">{selVerts.length ? `${selVerts.length} points picked` : "Click a dot or a face."}</p>
          {/if}
          <label class="check"><input type="checkbox" bind:checked={snap} /> Snap to whole units</label>
          <div class="row">
            <button onclick={makeFace} disabled={selVerts.length < 3} title="Fills a face between the picked points">Make face</button>
            <button class="danger" onclick={removePointsPicked} disabled={!selVerts.length}>Delete points</button>
          </div>
          <h4>Face</h4>
          {#if selFace !== null && cube.polys?.[selFace]}
            <label class="inline">Pull by <input type="number" step="1" bind:value={extrudeBy} /></label>
            <div class="row"><button onclick={extrude} title="Pushes the face out (a negative number digs in) and joins it to the rest">Extrude</button><button class="danger" onclick={removeFacePicked}>Delete face</button></div>
            <label class="colour">Colour <input type="color" value={faceHex} onchange={(e) => change(setFaceColors(cube, [selFace!], e.currentTarget.value))} /></label>
            <label class="check"><input type="checkbox" checked={!!cube.polys[selFace]!.smooth} onchange={(e) => change(setSmooth(cube, [selFace!], e.currentTarget.checked))} /> Smooth shading</label>
            <div class="row"><button onclick={() => change(flipFaces(cube, [selFace!]))} title="Turns the face inside out">Flip</button><button onclick={() => change(subdivide(cube, [selFace!]), true)}>Split</button></div>
          {:else}
            <p class="dim small">Click a face to pull it out, colour it or delete it.</p>
          {/if}
          <h4>Whole mesh</h4>
          <div class="row"><button onclick={() => change(subdivide(cube), true)} title="Splits every face into four-sided pieces">Split all</button><button onclick={() => change(weld(cube), true)} disabled={!weldCount} title="Joins points that sit on top of each other">Weld{weldCount ? ` (${weldCount})` : ""}</button></div>
          <div class="row"><button onclick={() => change(setSmooth(cube, cube.polys!.map((_, i) => i), true))}>Smooth all</button><button onclick={() => change(setSmooth(cube, cube.polys!.map((_, i) => i), false))}>Flat all</button></div>
          <p class="dim small">{cube.verts?.length ?? 0} points · {cube.polys?.length ?? 0} faces</p>
        {/if}
        <div class="row"><button onclick={duplicate}>Duplicate</button><button class="danger" onclick={remove}>Delete</button></div>
      {:else if selected && part}
        <h3>Part</h3>
        <label>Name <input value={part.name} onchange={(e) => commit(updatePart(doc, selected!.parts, { name: e.currentTarget.value }))} /></label>
        <h4>Pivot position</h4>
        <div class="vec">{#each part.origin as v, i (i)}<input type="number" value={v} aria-label={"xyz"[i] + " origin"} onchange={(e) => setVec("origin", i, e.currentTarget.value)} />{/each}</div>
        <h4>Rotation (degrees)</h4>
        <div class="vec">{#each part.rotation as v, i (i)}<input type="number" value={v} aria-label={"xyz"[i] + " rotation"} onchange={(e) => setVec("rotation", i, e.currentTarget.value)} />{/each}</div>
        <div class="row mirror">
          <span class="dim small">Mirror copy</span>
          {#each [0, 1, 2] as a (a)}<button onclick={() => mirrorPartCopy(a as Axis)} title={`A reflected copy of this part across its parent's ${"xyz"[a]} = 0 plane`}>{"XYZ"[a]}</button>{/each}
        </div>
        <p class="dim small">A part moves and turns about its pivot, with its shapes and child parts. Use parts for things that will move on their own later, like wheels. A mirror copy is a new part without the animation keys.</p>
        <div class="row"><button onclick={duplicate}>Duplicate</button><button class="danger" onclick={remove} disabled={doc.parts.length === 1 && selected.parts.length === 1}>Delete</button></div>
      {:else}
        <h3>Model</h3>
        <label>Export scale <input type="number" step="0.001" min="0.0001" value={doc.scale} onchange={(e) => commit({ ...doc, scale: Math.max(0.0001, num(e.currentTarget.value, doc.scale)) })} /></label>
        <p class="dim small">World units per model unit. 1/16 = 0.0625 makes a 16-unit cube one world unit.</p>
        <p class="dim small">Saving writes <code>{glbPath}</code>. In Lua: <code>nova.model("{modelName}", x, y, z)</code>.</p>
        <p class="dim small">Click a shape in the view or the list to edit it. Shapes: box, wedge, pyramid, cylinder, cone, sphere, or a free mesh you pull into shape point by point. Colours are flat per face.</p>
      {/if}
    </aside>
  </div>
{/if}

<style>
  .editor3d { height: 100%; display: grid; grid-template-columns: 190px minmax(0, 1fr) 230px; min-height: 0; }
  .outliner, .inspector { background: var(--panel); overflow: auto; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
  .outliner { border-right: 1px solid var(--line); padding: 0; }
  .outliner ul { list-style: none; margin: 0; padding: 4px 0; overflow: auto; }
  .node { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; background: transparent; border-color: transparent; border-radius: 0; padding: 2px 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .node:hover { background: var(--panel-2); }
  .node.on { background: color-mix(in srgb, var(--accent) 22%, transparent); }
  .dot { width: 10px; height: 10px; border-radius: 2px; border: 1px solid #0006; flex: none; } .dot.round { border-radius: 50%; }
  .adder { padding: 8px; border-bottom: 1px solid var(--line); display: flex; flex-direction: column; gap: 6px; }
  .adder .row { min-width: 0; } .adder select { min-width: 0; flex: 1; }
  .mirror { align-items: center; } .mirror button { padding: 0 8px; }
  .tools { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; } .tools button { width: 30px; height: 28px; padding: 0; } .tools button.on { background: var(--accent-2); border-color: var(--accent-2); color: #fff; }
  .tools .gap { flex: 1; }
  .paintrow { display: flex; gap: 6px; align-items: center; } .paintrow input[type="color"] { width: 38px; height: 28px; padding: 0; } .paintrow .mono { flex: 1; min-width: 0; } .paintrow label.inline { flex-direction: row; align-items: center; gap: 4px; } .paintrow label.inline input { width: 48px; }
  .swatches { display: grid; grid-template-columns: repeat(8, 1fr); gap: 3px; } .swatch { aspect-ratio: 1; padding: 0; border-radius: 3px; }
  .texbox { overflow: auto; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 4px; max-height: 360px; display: grid; place-items: start center; } .texbox canvas { image-rendering: pixelated; cursor: crosshair; touch-action: none; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .row.mirror span { flex: 1; }
  select { background: var(--panel-2); color: var(--text); border: 1px solid var(--line); border-radius: 4px; padding: 2px 4px; }
  .inspector { border-left: 1px solid var(--line); }
  .stage { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .bar { display: flex; align-items: center; gap: 8px; padding: 4px 8px; background: var(--panel); border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .check { display: flex; align-items: center; gap: 4px; } .check input { margin: 0; }
  .spacer { flex: 1; }
  .view { flex: 1; min-height: 0; position: relative; overflow: hidden; background: #15171c; }
  .view canvas { position: absolute; inset: 0; display: block; outline: none; touch-action: none; }
  .pad { padding: 24px; position: relative; z-index: 1; }
  .hint { margin: 0; padding: 3px 10px; font-size: 11px; border-top: 1px solid var(--line); background: var(--panel); }
  h3 { margin: 2px 0 4px; font-size: 13px; }
  h4 { margin: 6px 0 0; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--dim); }
  label { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--dim); }
  label input { color: var(--text); }
  .vec { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; } .vec input { min-width: 0; padding: 3px 4px; }
  .colour { flex-direction: row; align-items: center; justify-content: space-between; } .colour input { width: 44px; height: 24px; padding: 0; }
  .row { display: flex; gap: 6px; }
  .bar button.on { background: var(--accent-2); border-color: var(--accent-2); color: #fff; }
  .timeline { background: var(--panel); border-top: 1px solid var(--line); padding: 6px 10px; display: flex; flex-direction: column; gap: 6px; }
  .clips { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .cname { width: 110px; padding: 2px 6px; }
  .inline { flex-direction: row; align-items: center; gap: 4px; } .inline input { width: 64px; padding: 2px 6px; }
  .scrub { display: flex; gap: 10px; align-items: center; }
  .track { position: relative; flex: 1; height: 28px; }
  .track input[type="range"] { width: 100%; margin: 0; position: absolute; top: 0; accent-color: var(--accent); }
  .diamond { position: absolute; top: 14px; transform: translateX(-50%); padding: 0; border: none; background: transparent; color: var(--warn); font-size: 12px; line-height: 12px; cursor: pointer; }
  .time { width: 110px; text-align: right; font-variant-numeric: tabular-nums; }
  .keyed { color: var(--warn); }
  .keybtn { align-self: flex-start; padding: 0 6px; font-size: 11px; }
  .small { font-size: 11px; margin: 4px 0; }
  .bad { padding: 32px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
</style>
