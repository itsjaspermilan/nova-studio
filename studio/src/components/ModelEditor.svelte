<script lang="ts">
  import { onMount, untrack } from "svelte";
  import * as THREE from "three";
  import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
  import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
  import {
    FACES, History, SHAPES, addCube, addPart, afterRemoval, countCubes, cubeAt, duplicateNode, faceColor, newModel, parseModel, partAt, removeNode, samePath, serializeModel,
    setCube, setFaceColor, updateCube, updatePart, walk, namesOf, PROPS, MAX_SEGMENTS, MIN_SEGMENTS, DEFAULT_SEGMENTS, type Cube, type Ease, type Face, type ModelDoc, type Path, type Prop, type Shape, type Vec3,
  } from "../lib/model-doc";
  import { addFace, bevelEdge, cutFace, edgesOf, extrudeEdge, faceCentre, faceNormal, deleteFaces, deleteVerts, extrudeFace, flipFaces, freshMesh, mirrorElement, mirrorPart, loopCut, movePivot, moveVerts, moveVertsSymmetric, setFaceColors, setSmooth, setVert, subdivide, toMesh, transformMesh, weld, weldable, type Axis } from "../lib/mesh-edit";
  import { hasVolume, meshOf, segmentsOf, shapeFaces, solidOf } from "../lib/model-mesh";
  import { autoWeights, boneHeat, dominantBones, heatColor, invertAffine, reskin, setWeight, skinnedPoints, transformPoint, worldMatrices } from "../lib/model-skin";
  import { bakeAll, blockOf, faceRects, flippedRect, normRect, rectAt, enableTexture, fitPicture, packModel, resizeTexture, unwrap, uvsOf } from "../lib/model-uv";
  import { CLEAR, cloneRaster, drawEllipse, drawLine, drawRect, floodFill, getPixel, newRaster, parseHex, stamp, toHex, type Raster, type Rgba } from "../lib/pixels";
  import { applyBrush, applyGradient } from "../lib/paint";
  import { loadRaster, rasterToDataUrl } from "../lib/png";
  import { exportGlb } from "../lib/glb";
  import { addClip, easeAt, findTrack, pathKey, removeClip, removeKey, samplePose, setEase, setKey, snapTime, updateClip, KEY_STEP, type Pose } from "../lib/model-anim";
  import { toBase64 } from "../lib/wav";
  import { studio } from "../lib/store.svelte";

  let { path: filePath, text, onjson }: { path: string; text: string; onjson: () => void } = $props();

  const parsed = untrack(() => parseModel(text));
  const error = parsed.ok ? "" : parsed.error;
  let doc: ModelDoc = $state.raw(parsed.ok ? parsed.doc : newModel());
  let selected = $state<Path | null>(null);
  /// More shapes picked with Ctrl, ⌘ or Shift beside `selected`: move, copy, delete and colour act on all of them.
  let also = $state<Path[]>([]);
  const picked = $derived<Path[]>(selected && selected.cube !== undefined ? [selected, ...also] : selected ? [selected] : []);
  const pickedShapes = $derived(picked.filter((p) => p.cube !== undefined));
  /// A click that may add to or take from the picked shapes instead of replacing them.
  function choose(path: Path | null, additive: boolean) {
    if (!path || !additive || !selected || selected.cube === undefined || path.cube === undefined) {
      selected = path;
      also = [];
      return;
    }
    if (samePath(selected, path)) {
      if (also.length) {
        selected = also[0]!;
        also = also.slice(1);
      }
    } else if (also.some((p) => samePath(p, path))) also = also.filter((p) => !samePath(p, path));
    else also = [...also, path];
  }
  const isPicked = (p: Path) => picked.some((q) => samePath(q, p));
  const several = $derived(pickedShapes.length > 1);
  let showGrid = $state(true);
  // how the model is drawn: with its texture, flat colours only, or as a wireframe (Z cycles them)
  let viewMode = $state<"textured" | "solid" | "wire">("textured");
  // the move / turn / resize handles drawn on the selected part or shape
  let gizmoMode = $state<"translate" | "rotate" | "scale" | "pivot">("translate");
  // editing the points of a mesh
  let editPoints = $state(false);
  let selVerts = $state<number[]>([]);
  let selFace = $state<number | null>(null);
  let selEdge = $state<[number, number] | null>(null); // two points joined by an edge of the picked mesh
  let bevelBy = $state(25); // percent of the next edge each neighbour gives up
  let edgeBy = $state(4);
  let snap = $state(true);
  let snapPoints = $state(true); // a dragged point jumps onto another point of the mesh when it comes close
  let extrudeBy = $state(4);
  let shrinkBy = $state(0); // percent the new face is pulled towards its middle: a taper, or with no pull, an inset
  let cutAt = $state(50); // percent along each crossed edge
  let symmetry = $state<"off" | "0" | "1" | "2">("off"); // move points in mirrored pairs across the x, y or z plane
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
  type TexTool = "pencil" | "eraser" | "fill" | "picker" | "move" | "face" | "line" | "rect" | "ellipse" | "gradient";
  const BRUSH_TOOLS: TexTool[] = ["pencil", "eraser", "fill", "picker"]; // what works on the model itself; the shapes need the flat picture
  let texTool = $state<TexTool>("pencil");
  let texColor = $state<Rgba>([220, 70, 70, 255]);
  let texBrush = $state(1);
  let texColor2 = $state<Rgba>([40, 70, 200, 255]); // the far end of a gradient
  let texFilled = $state(false); // rectangles and ellipses
  let mirrorPaint = $state(false); // paint the same stroke on the other side of the model (left and right swapped)
  let texOpacity = $state(100); // percent
  let lockAlpha = $state(false); // paint only what is already painted, and keep its see-through-ness
  let strokeBase: Raster | null = null; // the picture as the stroke began
  let strokeDone = new Uint8Array(0); // pixels this stroke has already worked out
  let texTick = $state(0);
  let texFace = $state<{ path: Path; face: Face } | null>(null); // a face of a painted box whose rectangle is being placed
  const faceSel = $derived(texFace && selected && samePath(texFace.path, selected) ? texFace.face : null);
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
  /// `skin` is set for a mesh that bends with the parts: where its vertices are at rest, and the mesh point each one shows.
  const meshes: { mesh: THREE.Mesh; path: Path; polyOfTriangle: number[]; skin?: { rest: Float32Array; pointOf: number[] } }[] = [];
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
    gizmo = new TransformControls(camera, canvas!);
    gizmo.setSize(0.75);
    gizmo.addEventListener("dragging-changed", (e) => {
      if (controls) controls.enabled = !e.value;
      if (e.value) gizmoDown = true;
      else finishGizmo();
    });
    gizmo.addEventListener("objectChange", liveGizmo);
    scene.add(gizmo.getHelper());
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
    const useTexture = !!threeTex && hasTexture(doc) && viewMode === "textured";
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
          const material = new THREE.MeshLambertMaterial({ vertexColors: true, map: useTexture ? threeTex : null, wireframe: viewMode === "wire", transparent: translucent, side: cube.shape === "mesh" ? THREE.DoubleSide : THREE.FrontSide });
          const mesh = new THREE.Mesh(geometry, material);
          group.add(mesh);
          const skin = cube.shape === "mesh" && cube.skin ? { rest: new Float32Array(m.positions), pointOf: solidOf(cube).polys.flatMap((p) => p.v) } : undefined;
          meshes.push({ mesh, path: { parts, cube: ci }, polyOfTriangle: m.polyOfTriangle, skin });
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
    bendSkins(clip ? pose : undefined);
    drawOutline();
  }

  /// Shapes that bend with the parts follow the pose; without one they sit where they were built.
  function bendSkins(pose: Map<string, Pose> | undefined) {
    const skinned = meshes.filter((m) => m.skin);
    if (!skinned.length) return;
    const rest = worldMatrices(doc);
    const posed = pose ? worldMatrices(doc, pose) : rest;
    for (const m of skinned) {
      const attr = m.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      const points = pose ? skinnedPoints(doc, m.path, posed, rest) : null;
      const owner = posed.get(pathKey(namesOf(doc, m.path.parts)));
      if (!points || !owner) {
        attr.array.set(m.skin!.rest);
      } else {
        // the shape hangs from its own part, which is posed too: its points go back into that part's space
        const back = invertAffine(owner);
        m.skin!.pointOf.forEach((p, i) => {
          const q = transformPoint(back, points[p]!);
          attr.array[i * 3] = q[0];
          attr.array[i * 3 + 1] = q[1];
          attr.array[i * 3 + 2] = q[2];
        });
      }
      attr.needsUpdate = true;
      m.mesh.geometry.computeBoundingSphere();
    }
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
    const inside = (p: Path) => picked.some((q) => (q.cube === undefined ? p.parts.length >= q.parts.length && q.parts.every((n, i) => n === p.parts[i]) : samePath(p, q)));
    for (const m of meshes) if (inside(m.path)) box3.expandByObject(m.mesh);
    if (box3.isEmpty()) return;
    outline = new THREE.Box3Helper(box3, 0xffd166);
    scene.add(outline);
  }

  $effect(() => {
    doc; viewMode; // redraw whenever the model changes or is shown another way
    if (modelGroup) untrack(rebuild);
  });
  $effect(() => {
    selected; also;
    untrack(drawOutline);
  });
  $effect(() => {
    doc; selected; also; mode; inEdit; gizmoMode; snap;
    untrack(attachGizmo);
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
      gizmo?.dispose();
      gizmo = undefined;
      controls?.dispose();
      disposeMeshes();
      clearHandles();
      outline?.dispose();
      renderer?.dispose();
      renderer = undefined;
    };
  });

  // ---- move / turn / resize handles ---------------------------------------------------------------------------
  let gizmo: TransformControls | undefined;
  let gizmoDown = false; // a handle was grabbed: the click that follows must not change the selection
  let proxy: THREE.Object3D | undefined;
  let proxyBase: THREE.Matrix4 | null = null;
  let attachedPart: THREE.Object3D | undefined;
  let pivotPart: number[] | null = null; // the part whose pivot is being moved
  let pivotMark: THREE.AxesHelper | undefined; // shows where the selected part's pivot is
  let partBase: { origin: Vec3; rotation: Vec3 } | null = null;
  const round2 = (n: number) => Math.round(n * 100) / 100;

  function attachGizmo() {
    if (!gizmo) return;
    gizmo.detach();
    proxy?.removeFromParent();
    proxy = undefined;
    proxyBase = null;
    attachedPart = undefined;
    partBase = null;
    pivotPart = null;
    if (pivotMark) {
      pivotMark.removeFromParent();
      pivotMark.dispose();
      pivotMark = undefined;
    }
    const live = mode === "model" && !inEdit && !!selected;
    gizmo.getHelper().visible = live;
    if (!live || !selected) return;
    const g = groupOf(selected.parts);
    if (!g) return;
    gizmo.setTranslationSnap(snap ? 1 : null);
    gizmo.setRotationSnap(snap ? THREE.MathUtils.degToRad(15) : null);
    gizmo.setScaleSnap(snap ? 0.25 : null);
    if (selected.cube === undefined) {
      // a part: its own group is moved and turned (resizing a part is only for animation)
      pivotMark = new THREE.AxesHelper(3);
      g.add(pivotMark);
      if (gizmoMode === "pivot") {
        // the pivot is moved on its own, in the parent's space: nothing you can see moves
        const parent = selected.parts.length > 1 ? groupOf(selected.parts.slice(0, -1)) : modelGroup;
        const p = partAt(doc, selected.parts)!;
        if (!parent) return;
        proxy = new THREE.Object3D();
        proxy.position.set(...p.origin);
        parent.add(proxy);
        proxy.updateMatrix();
        pivotPart = selected.parts;
        gizmo.setMode("translate");
        gizmo.setSpace("world");
        gizmo.attach(proxy);
        return;
      }
      gizmo.setMode(gizmoMode === "scale" ? "translate" : gizmoMode);
      gizmo.setSpace("world");
      attachedPart = g;
      const p = partAt(doc, selected.parts)!;
      partBase = { origin: [...p.origin], rotation: [...p.rotation] };
      gizmo.attach(g);
      return;
    }
    const c = cube;
    if (!c || !hasVolume(c)) return;
    proxy = new THREE.Object3D();
    proxy.position.set(c.from[0] + c.size[0] / 2, c.from[1] + c.size[1] / 2, c.from[2] + c.size[2] / 2);
    if (!also.length && c.shape !== "mesh" && c.rotation) proxy.rotation.set(...(c.rotation.map((d) => (d * Math.PI) / 180) as Vec3), "XYZ");
    g.add(proxy);
    proxy.updateMatrix();
    proxyBase = proxy.matrix.clone();
    gizmo.setMode(gizmoMode === "pivot" ? "translate" : gizmoMode);
    gizmo.setSpace(also.length ? "world" : "local");
    gizmo.attach(proxy);
  }

  /// While a handle is dragged the shape's own pieces follow it; nothing is saved until it is let go.
  function liveGizmo() {
    if (!proxy || !proxyBase || !selected) return;
    proxy.updateMatrix();
    const delta = new THREE.Matrix4().multiplyMatrices(proxy.matrix, proxyBase.clone().invert());
    const g = groupOf(selected.parts);
    for (const m of meshes) {
      if (!isPicked(m.path)) continue;
      m.mesh.matrixAutoUpdate = false;
      if (samePath(m.path, selected)) m.mesh.matrix.copy(delta);
      else if (also.length && gizmoMode !== "translate") m.mesh.matrix.copy(convertMatrix(groupDelta(delta), g, groupOf(m.path.parts)));
      else {
        // the others move by the same amount in the world, which is another amount inside their own part
        const t = convertShift(new THREE.Vector3().setFromMatrixPosition(delta), g, groupOf(m.path.parts));
        m.mesh.matrix.makeTranslation(t.x, t.y, t.z);
      }
      m.mesh.matrixWorldNeedsUpdate = true;
    }
  }
  /// What the group does when the handle was turned or resized: the same movement about the first shape's middle, with a
  /// resize made even (one factor for every axis) so shapes turned differently do not shear.
  function groupDelta(delta: THREE.Matrix4): THREE.Matrix4 {
    if (gizmoMode !== "scale" || !proxy || !proxyBase) return delta;
    const f = (proxy.scale.x + proxy.scale.y + proxy.scale.z) / 3;
    const c = new THREE.Vector3().setFromMatrixPosition(proxyBase);
    return new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(new THREE.Matrix4().makeScale(f, f, f)).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
  }
  /// A movement made in one part's space, as it is in another part's space (the same movement in the world).
  function convertMatrix(d: THREE.Matrix4, from: THREE.Object3D | undefined, to: THREE.Object3D | undefined): THREE.Matrix4 {
    if (!from || !to || from === to) return d;
    const [f, t] = [from.matrixWorld, to.matrixWorld];
    return t.clone().invert().multiply(f).multiply(d).multiply(f.clone().invert()).multiply(t);
  }
  /// A shift measured in one part's space, as it is in another part's space.
  function convertShift(v: THREE.Vector3, from: THREE.Object3D | undefined, to: THREE.Object3D | undefined) {
    if (!from || !to || from === to) return v.clone();
    const out = v.clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(from.matrixWorld));
    return out.applyMatrix3(new THREE.Matrix3().setFromMatrix4(to.matrixWorld.clone().invert()));
  }

  function finishGizmo() {
    if (!gizmoDown || !selected) return;
    if (pivotPart && proxy) {
      const to = proxy.position.toArray().map(round2) as Vec3;
      const moved = movePivot(doc, pivotPart, to);
      if (moved) commit(moved);
      return;
    }
    if (attachedPart && partBase) {
      const e = new THREE.Euler().setFromQuaternion(attachedPart.quaternion, "XYZ");
      const origin = attachedPart.position.toArray().map(round2) as Vec3;
      const rotation = [e.x, e.y, e.z].map((r) => round2((r * 180) / Math.PI)) as Vec3;
      const same = origin.every((v, i) => v === partBase!.origin[i]) && rotation.every((v, i) => Math.abs(v - partBase!.rotation[i]!) < 0.01);
      if (!same) commit(updatePart(doc, selected.parts, { origin, rotation }));
      return;
    }
    if (!proxy || !proxyBase || !cube) return;
    proxy.updateMatrix();
    const delta = new THREE.Matrix4().multiplyMatrices(proxy.matrix, proxyBase.clone().invert());
    if (delta.equals(new THREE.Matrix4())) return;
    if (also.length && gizmoMode !== "translate") {
      const home = groupOf(selected.parts);
      const f = gizmoMode === "scale" ? (proxy.scale.x + proxy.scale.y + proxy.scale.z) / 3 : 1;
      let next = doc;
      for (const p of pickedShapes) {
        const c = cubeAt(next, p);
        if (!c) continue;
        // each shape moves as the handle did, worked out inside its own part
        const d = convertMatrix(groupDelta(delta), home, groupOf(p.parts));
        const q = new THREE.Quaternion().setFromRotationMatrix(d);
        if (c.shape === "mesh") {
          next = setCube(next, p, transformMesh(c, d.toArray()));
          continue;
        }
        const centre = new THREE.Vector3(c.from[0] + c.size[0] / 2, c.from[1] + c.size[1] / 2, c.from[2] + c.size[2] / 2).applyMatrix4(d);
        const size = c.size.map((n) => round2(n * f)) as Vec3;
        const turn = new THREE.Quaternion().setFromEuler(new THREE.Euler(...((c.rotation ?? [0, 0, 0]).map((a) => (a * Math.PI) / 180) as Vec3), "XYZ"));
        const e = new THREE.Euler().setFromQuaternion(gizmoMode === "rotate" ? q.multiply(turn) : turn, "XYZ");
        const rotation = [e.x, e.y, e.z].map((r) => round2((r * 180) / Math.PI)) as Vec3;
        next = updateCube(next, p, { from: [round2(centre.x - size[0] / 2), round2(centre.y - size[1] / 2), round2(centre.z - size[2] / 2)], size, ...(rotation.some((r) => r !== 0) || c.rotation ? { rotation } : {}) });
      }
      commit(next);
      return;
    }
    if (also.length) {
      const shift = new THREE.Vector3().setFromMatrixPosition(delta);
      const home = groupOf(selected.parts);
      let next = doc;
      for (const p of pickedShapes) {
        const c = cubeAt(next, p);
        if (!c) continue;
        const d = convertShift(shift, home, groupOf(p.parts));
        next = updateCube(next, p, { from: [round2(c.from[0] + d.x), round2(c.from[1] + d.y), round2(c.from[2] + d.z)] });
      }
      commit(next);
      return;
    }
    if (cube.shape === "mesh") {
      commit(setCube(doc, selected, transformMesh(cube, delta.toArray())));
      return;
    }
    const s = proxy.scale;
    const size = cube.size.map((n, i) => round2(Math.abs(n * [s.x, s.y, s.z][i]!))) as Vec3;
    const centre = proxy.position.toArray();
    const e = new THREE.Euler().setFromQuaternion(proxy.quaternion, "XYZ");
    const rotation = [e.x, e.y, e.z].map((r) => round2((r * 180) / Math.PI)) as Vec3;
    commit(updateCube(doc, selected, { from: centre.map((v, i) => round2(v - size[i]! / 2)) as Vec3, size, ...(rotation.some((r) => r !== 0) || cube.rotation ? { rotation } : {}) }));
  }

  // ---- painting ----------------------------------------------------------------------------------------------
  let stroke: { last: [number, number] | null; lastMirror: [number, number] | null } | null = null;
  function textureHit(e: PointerEvent): [number, number] | null {
    if (!camera || !canvas || !picture) return null;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(pointer(e), camera);
    const hit = ray.intersectObjects(meshes.map((m) => m.mesh), false)[0];
    const entry = hit && meshes.find((m) => m.mesh === hit.object);
    if (!hit?.uv || !entry || !cubeAt(doc, entry.path)?.texture) return null;
    return [Math.min(picture.w - 1, Math.max(0, Math.floor(hit.uv.x * picture.w))), Math.min(picture.h - 1, Math.max(0, Math.floor(hit.uv.y * (picture.h + 1))))];
  }
  /// Where the same stroke lands on the other side of the model: the pointer's hit point and the way the surface faces are
  /// reflected across the model's centre plane (left and right swapped), and a ray sent back at the surface from there.
  function mirrorHit(e: PointerEvent): [number, number] | null {
    if (!camera || !picture) return null;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(pointer(e), camera);
    const objects = meshes.map((m) => m.mesh);
    const hit = ray.intersectObjects(objects, false)[0];
    if (!hit?.face) return null;
    const flipX = (v: THREE.Vector3) => new THREE.Vector3(-v.x, v.y, v.z);
    const normal = hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();
    const [p, n] = [flipX(hit.point), flipX(normal)];
    const back = new THREE.Raycaster(p.clone().addScaledVector(n, 0.5), n.clone().negate(), 0, 2);
    const other = back.intersectObjects(objects, false)[0];
    const entry = other && meshes.find((m) => m.mesh === other.object);
    if (!other?.uv || !entry || !cubeAt(doc, entry.path)?.texture) return null;
    return [Math.min(picture.w - 1, Math.max(0, Math.floor(other.uv.x * picture.w))), Math.min(picture.h - 1, Math.max(0, Math.floor(other.uv.y * (picture.h + 1))))];
  }
  function rememberPicture() {
    if (!picture) return;
    texPast.push(cloneRaster(picture));
    if (texPast.length > 30) texPast.shift();
    texFuture = [];
    texTick++;
  }
  let lastPaint: [number, number] | null = null; // where the last stroke ended, for Shift-click lines
  function beginStroke(straight = false) {
    if (texTool !== "picker") rememberPicture();
    strokeBase = picture ? cloneRaster(picture) : null;
    strokeDone = new Uint8Array(picture ? picture.w * picture.h : 0);
    stroke = { last: straight && (texTool === "pencil" || texTool === "eraser") ? lastPaint : null, lastMirror: null };
  }
  function pictureChanged() {
    picRev++;
    syncTexture();
    studio.sessions.set(filePath, { doc, picture });
    studio.markPending(filePath);
  }
  function paintTexel(x: number, y: number, mirrored = false) {
    if (!picture || !stroke) return;
    if (texTool === "picker") {
      if (mirrored) return;
      const c = getPixel(picture, x, y);
      if (c && c[3] > 0) texColor = c;
      return;
    }
    const last = mirrored ? stroke.lastMirror : stroke.last;
    if (texTool === "fill") floodFill(picture, x, y, texColor);
    else if (texOpacity >= 100 && !lockAlpha) {
      const colour = texTool === "eraser" ? CLEAR : texColor;
      if (last) drawLine(picture, { x: last[0], y: last[1] }, { x, y }, texBrush, colour);
      else stamp(picture, x, y, texBrush, colour);
    } else if (strokeBase) {
      // the stroke goes into a mask, and each touched pixel is blended once from how the picture was before
      const mask = newRaster(picture.w, picture.h);
      if (last) drawLine(mask, { x: last[0], y: last[1] }, { x, y }, texBrush, [255, 255, 255, 255]);
      else stamp(mask, x, y, texBrush, [255, 255, 255, 255]);
      applyBrush(picture, strokeBase, mask, strokeDone, { colour: texColor, opacity: texOpacity / 100, erase: texTool === "eraser", lockAlpha });
    }
    if (mirrored) stroke.lastMirror = [x, y];
    else stroke.last = lastPaint = [x, y];
    pictureChanged();
  }
  /// A line, rectangle, ellipse or gradient from where the drag began to where it is now, redrawn from the picture as it was.
  let shapeStart: [number, number] | null = null;
  function drawShape(x: number, y: number) {
    if (!picture || !strokeBase || !shapeStart) return;
    picture.data.set(strokeBase.data);
    const [a, b] = [{ x: shapeStart[0], y: shapeStart[1] }, { x, y }];
    if (texTool === "gradient") applyGradient(picture, strokeBase, a, b, texColor, texColor2, texOpacity / 100, lockAlpha);
    else {
      const mask = newRaster(picture.w, picture.h);
      const white: Rgba = [255, 255, 255, 255];
      if (texTool === "line") drawLine(mask, a, b, texBrush, white);
      else if (texTool === "rect") drawRect(mask, a, b, texBrush, white, texFilled);
      else drawEllipse(mask, a, b, texBrush, white, texFilled);
      applyBrush(picture, strokeBase, mask, new Uint8Array(picture.w * picture.h), { colour: texColor, opacity: texOpacity / 100, erase: false, lockAlpha });
    }
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
        // with the face tool, every face of a box is a rectangle that can be picked
        const rects = texTool === "face" ? faceRects(c) : null;
        for (const [face, r] of Object.entries(rects ?? {})) {
          ctx.strokeStyle = face === faceSel ? "rgba(255,120,200,1)" : "rgba(120,220,255,.8)";
          ctx.lineWidth = face === faceSel ? 2 : 1;
          const n = normRect(r!);
          ctx.strokeRect(n[0] * z + 0.5, n[1] * z + 0.5, n[2] * z - 1, n[3] * z - 1);
        }
      }
    }
  }
  $effect(() => {
    picRev; doc; selected; mode; texView; picture; texTool; faceSel;
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
    if (texTool === "face") {
      // the topmost painted box whose face rectangle holds the point
      for (const t of [...painted].reverse()) {
        const rects = faceRects(t.c);
        const hit = Object.entries(rects ?? {}).find(([, r]) => {
          const n = normRect(r!);
          return x >= n[0] && x < n[0] + n[2] && y >= n[1] && y < n[1] + n[3];
        });
        if (!hit) continue;
        selected = t.path;
        texFace = { path: t.path, face: hit[0] as Face };
        faceDrag = { path: t.path, base: doc, cube: t.c, face: hit[0] as Face, rect: [...hit[1]!] as [number, number, number, number], from: [x, y], moved: false };
        return;
      }
      texFace = null;
      return;
    }
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
    if (["line", "rect", "ellipse", "gradient"].includes(texTool)) {
      beginStroke();
      shapeStart = [Math.max(0, Math.min(picture.w - 1, x)), Math.max(0, Math.min(picture.h - 1, y))];
      drawShape(shapeStart[0], shapeStart[1]);
      return;
    }
    if (x < 0 || y < 0 || x >= picture.w || y >= picture.h) return;
    beginStroke(e.shiftKey);
    paintTexel(x, y);
  }
  let faceDrag: { path: Path; base: ModelDoc; cube: Cube; face: Face; rect: [number, number, number, number]; from: [number, number]; moved: boolean } | null = null;
  /// Puts one face of a painted box at `rect` in the picture (or back to the automatic place with null).
  function placeFace(base: ModelDoc, path: Path, c: Cube, face: Face, rect: [number, number, number, number] | null): ModelDoc {
    const faces = { ...(c.texture?.faces ?? {}) };
    if (rect) faces[face] = rect;
    else delete faces[face];
    const texture = { ...c.texture!, faces: Object.keys(faces).length ? faces : undefined };
    return setCube(base, path, { ...c, texture });
  }
  function texMove(e: PointerEvent) {
    if (!picture || !texView) return;
    const [x, y] = texCell(e);
    if (faceDrag) {
      const n = normRect(faceDrag.rect);
      const left = Math.max(0, Math.min(picture.w - n[2], n[0] + x - faceDrag.from[0]));
      const top = Math.max(0, Math.min(picture.h - n[3], n[1] + y - faceDrag.from[1]));
      const at = rectAt(faceDrag.rect, left, top);
      if (!faceDrag.moved && left === n[0] && top === n[1]) return;
      if (!faceDrag.moved) history.record(faceDrag.base);
      faceDrag.moved = true;
      commit(placeFace(faceDrag.base, faceDrag.path, faceDrag.cube, faceDrag.face, at), true);
      return;
    }
    if (blockDrag) {
      const b = blockOf(blockDrag.cube);
      const at: [number, number] = [Math.max(0, Math.min(picture.w - b.w, blockDrag.at[0] + x - blockDrag.from[0])), Math.max(0, Math.min(picture.h - b.h, blockDrag.at[1] + y - blockDrag.from[1]))];
      if (!blockDrag.moved && at[0] === blockDrag.at[0] && at[1] === blockDrag.at[1]) return;
      if (!blockDrag.moved) history.record(blockDrag.base);
      blockDrag.moved = true;
      commit(setCube(blockDrag.base, blockDrag.path, { ...blockDrag.cube, texture: { ...blockDrag.cube.texture!, at } }), true);
      return;
    }
    if (shapeStart) return drawShape(Math.max(0, Math.min(picture.w - 1, x)), Math.max(0, Math.min(picture.h - 1, y)));
    if (stroke && x >= 0 && y >= 0 && x < picture.w && y < picture.h) paintTexel(x, y);
    else if (stroke) stroke.last = null;
  }
  function texUp() {
    stroke = null;
    shapeStart = null;
    blockDrag = null;
    faceDrag = null;
  }
  const pickedRect = $derived.by(() => {
    const c = selected ? cubeAt(doc, selected) : undefined;
    return c?.texture && faceSel ? (faceRects(c)?.[faceSel] ?? null) : null;
  });
  function setRectPart(index: number, raw: string) {
    const n = Number(raw);
    if (!selected || !cube?.texture || !faceSel || !pickedRect || !Number.isFinite(n) || !picture) return;
    const area = normRect(pickedRect);
    area[index] = Math.round(n);
    area[2] = Math.max(1, Math.min(picture.w, area[2]));
    area[3] = Math.max(1, Math.min(picture.h, area[3]));
    area[0] = Math.max(0, Math.min(picture.w - area[2], area[0]));
    area[1] = Math.max(0, Math.min(picture.h - area[3], area[1]));
    // the face keeps its flips: a negative side stays negative
    const r: [number, number, number, number] = [pickedRect[2] < 0 ? area[0] + area[2] : area[0], pickedRect[3] < 0 ? area[1] + area[3] : area[1], pickedRect[2] < 0 ? -area[2] : area[2], pickedRect[3] < 0 ? -area[3] : area[3]];
    commit(placeFace(doc, selected, cube, faceSel, r));
  }
  function flipFace(across: boolean) {
    if (selected && cube?.texture && faceSel && pickedRect) commit(placeFace(doc, selected, cube, faceSel, flippedRect(pickedRect, across)));
  }
  function resetRect() {
    if (selected && cube?.texture && faceSel) commit(placeFace(doc, selected, cube, faceSel, null));
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
  let edgeLines: THREE.LineSegments | undefined;
  let edgeSel: THREE.Line | undefined;
  let pullArrow: THREE.ArrowHelper | undefined;
  function clearHandles() {
    for (const o of [handles, faceLine, edgeLines, edgeSel]) {
      if (!o) continue;
      scene?.remove(o);
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
    handles = faceLine = edgeLines = edgeSel = undefined;
    if (pullArrow) {
      scene?.remove(pullArrow);
      pullArrow.dispose();
      pullArrow = undefined;
    }
  }
  /// Where the picked face is in the world, and which way it faces.
  function faceFrame(): { at: THREE.Vector3; dir: THREE.Vector3 } | null {
    const g = selected ? groupOf(selected.parts) : undefined;
    if (!g || !cube || selFace === null || !cube.polys?.[selFace]) return null;
    const c = faceCentre(cube, selFace);
    const n = faceNormal(cube, selFace);
    const at = new THREE.Vector3(...c).applyMatrix4(g.matrixWorld);
    const dir = new THREE.Vector3(...n).applyMatrix3(new THREE.Matrix3().setFromMatrix4(g.matrixWorld)).normalize();
    return { at, dir };
  }
  const groupOf = (parts: number[]) => groups.get(pathKey(namesOf(doc, parts)))?.group;
  /// The selected mesh's points in the world.
  function worldVerts(): THREE.Vector3[] {
    const g = selected ? groupOf(selected.parts) : undefined;
    if (!g || !cube?.verts) return [];
    return cube.verts.map((p) => new THREE.Vector3(...p).applyMatrix4(g.matrixWorld));
  }
  /// The colour of each part a shape bends with, for its points in point mode (and the key beside the weights).
  const BONE_COLORS: [number, number, number][] = [[0.36, 0.65, 1], [0.45, 0.9, 0.5], [1, 0.55, 0.55], [0.8, 0.6, 1], [1, 0.8, 0.35], [0.4, 0.9, 0.9], [1, 0.6, 0.85], [0.75, 0.75, 0.75]];
  const boneCss = (i: number) => `rgb(${BONE_COLORS[i % BONE_COLORS.length]!.map((v) => Math.round(v * 255)).join(",")})`;
  function drawHandles() {
    clearHandles();
    if (!scene || !inEdit || !cube) return;
    const pts = worldVerts();
    const chosen = new Set(selVerts);
    const geometry = new THREE.BufferGeometry().setFromPoints(pts);
    // a shape that bends with parts shows each point in the colour of the part that holds it most
    const fits = !!cube.skin && cube.skin.weights.length === pts.length;
    const holder = fits ? dominantBones(cube.skin!) : null;
    const heat = fits && heatBone !== null ? boneHeat(cube.skin!, heatBone) : null;
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(pts.flatMap((_, i) => (chosen.has(i) ? [1, 0.82, 0.4] : heat ? heatColor(heat[i]!) : holder ? BONE_COLORS[holder[i]! % BONE_COLORS.length]! : [0.9, 0.93, 1])), 3));
    handles = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 9, sizeAttenuation: false, vertexColors: true, depthTest: false }));
    handles.renderOrder = 10;
    scene.add(handles);
    // every edge faintly, so there is something to click; the picked one in yellow
    const edges = edgesOf(cube);
    edgeLines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(edges.flatMap((e) => [pts[e.a]!, pts[e.b]!])), new THREE.LineBasicMaterial({ color: 0x8fa4d6, transparent: true, opacity: 0.45, depthTest: false }));
    edgeLines.renderOrder = 8;
    scene.add(edgeLines);
    if (selEdge && pts[selEdge[0]] && pts[selEdge[1]]) {
      edgeSel = new THREE.Line(new THREE.BufferGeometry().setFromPoints([pts[selEdge[0]]!, pts[selEdge[1]]!]), new THREE.LineBasicMaterial({ color: 0xffd166, depthTest: false }));
      edgeSel.renderOrder = 12;
      scene.add(edgeSel);
    }
    const face = selFace === null ? undefined : cube.polys?.[selFace];
    if (face) {
      const line = new THREE.BufferGeometry().setFromPoints(face.v.map((i) => pts[i]!));
      faceLine = new THREE.LineLoop(line, new THREE.LineBasicMaterial({ color: 0xffd166, depthTest: false }));
      faceLine.renderOrder = 9;
      scene.add(faceLine);
      const frame = faceFrame();
      if (frame) {
        // the handle that pulls the face out: drag its tip along the way the face points
        pullArrow = new THREE.ArrowHelper(frame.dir, frame.at, PULL_LENGTH, 0xffd166, 3, 2);
        pullArrow.renderOrder = 11;
        for (const part of [pullArrow.line, pullArrow.cone]) (part.material as THREE.Material).depthTest = false;
        scene.add(pullArrow);
      }
    }
  }
  const PULL_LENGTH = 9;

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

  /// The edge of the picked mesh within a few pixels of the pointer, if any.
  function pickEdge(e: PointerEvent): [number, number] | null {
    if (!camera || !canvas || !cube) return null;
    const r = canvas.getBoundingClientRect();
    const pts = worldVerts().map((w) => {
      const p = w.clone().project(camera!);
      return [((p.x + 1) / 2) * r.width + r.left, ((1 - p.y) / 2) * r.height + r.top] as const;
    });
    let best: [number, number] | null = null;
    let bestDist = 7;
    for (const edge of edgesOf(cube)) {
      const [p, q] = [pts[edge.a], pts[edge.b]];
      if (!p || !q) continue;
      const len2 = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 || 1;
      const u = Math.max(0, Math.min(1, ((e.clientX - p[0]) * (q[0] - p[0]) + (e.clientY - p[1]) * (q[1] - p[1])) / len2));
      const d = Math.hypot(p[0] + u * (q[0] - p[0]) - e.clientX, p[1] + u * (q[1] - p[1]) - e.clientY);
      if (d < bestDist) {
        best = [edge.a, edge.b];
        bestDist = d;
      }
    }
    return best;
  }

  // Click (without dragging) selects the shape under the pointer; in point mode it picks the face instead.
  // Dragging a point's handle moves it, and every other selected point with it.
  let downAt: [number, number] | null = null;
  let pull: { base: ModelDoc; baseCube: Cube; path: Path; face: number; origin: THREE.Vector3; dir: THREE.Vector3; t0: number; moved: boolean } | null = null;
  /// How far along the line (origin + t * dir) the pointer's ray comes closest, in world units.
  function lineParameter(e: PointerEvent, origin: THREE.Vector3, dir: THREE.Vector3): number | null {
    if (!camera) return null;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(pointer(e), camera);
    const v = ray.ray.direction;
    const w = origin.clone().sub(ray.ray.origin);
    const [a, b, c, d, f] = [dir.dot(dir), dir.dot(v), v.dot(v), dir.dot(w), v.dot(w)];
    const denom = a * c - b * b;
    return Math.abs(denom) < 1e-6 ? null : (b * f - c * d) / denom;
  }
  let drag: { point: number; base: ModelDoc; baseCube: Cube; path: Path; start: THREE.Vector3; plane: THREE.Plane; moved: boolean } | null = null;
  function pointerDown(e: PointerEvent) {
    downAt = [e.clientX, e.clientY];
    if (mode === "texture" && BRUSH_TOOLS.includes(texTool) && picture && e.button === 0 && !e.altKey && canvas) {
      const t = textureHit(e);
      if (t) {
        beginStroke(e.shiftKey);
        paintTexel(t[0], t[1]);
        const m = mirrorPaint ? mirrorHit(e) : null;
        if (m) paintTexel(m[0], m[1], true);
        controls!.enabled = false;
        canvas.setPointerCapture(e.pointerId);
        return;
      }
    }
    if (!inEdit || !camera || !canvas || !selected || !cube || e.button !== 0) return;
    const frame = faceFrame();
    if (frame && selFace !== null && camera) {
      const r = canvas.getBoundingClientRect();
      // grab anywhere on the outer part of the arrow, not only its very tip
      const screen = (k: number) => {
        const p = frame.at.clone().addScaledVector(frame.dir, PULL_LENGTH * k).project(camera!);
        return [((p.x + 1) / 2) * r.width + r.left, ((1 - p.y) / 2) * r.height + r.top] as const;
      };
      const [a, b] = [screen(0.4), screen(1)];
      const len2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 || 1;
      const u = Math.max(0, Math.min(1, ((e.clientX - a[0]) * (b[0] - a[0]) + (e.clientY - a[1]) * (b[1] - a[1])) / len2));
      if (Math.hypot(a[0] + u * (b[0] - a[0]) - e.clientX, a[1] + u * (b[1] - a[1]) - e.clientY) < 16) {
        const t0 = lineParameter(e, frame.at, frame.dir);
        if (t0 !== null) {
          pull = { base: doc, baseCube: cube, path: selected, face: selFace, origin: frame.at, dir: frame.dir, t0, moved: false };
          controls!.enabled = false;
          canvas.setPointerCapture(e.pointerId);
          return;
        }
      }
    }
    const point = pickVert(e);
    if (point < 0) return;
    if (e.shiftKey) selVerts = selVerts.includes(point) ? selVerts.filter((v) => v !== point) : [...selVerts, point];
    else if (!selVerts.includes(point)) selVerts = [point];
    selFace = null;
    selEdge = null;
    if (!selVerts.includes(point)) return;
    const start = worldVerts()[point]!;
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), start);
    drag = { point, base: doc, baseCube: cube, path: selected, start, plane, moved: false };
    controls!.enabled = false;
    canvas.setPointerCapture(e.pointerId);
  }
  /// The mesh point (not one being dragged) within a few pixels of the pointer, in the mesh's own space.
  function nearestPoint(e: PointerEvent, c: Cube, skip: Set<number>, g: THREE.Object3D): Vec3 | null {
    if (!camera || !canvas || !c.verts) return null;
    const r = canvas.getBoundingClientRect();
    let best: Vec3 | null = null;
    let bestDist = 12;
    c.verts.forEach((p, i) => {
      if (skip.has(i)) return;
      const q = new THREE.Vector3(...p).applyMatrix4(g.matrixWorld).project(camera!);
      if (q.z > 1) return;
      const d = Math.hypot(((q.x + 1) / 2) * r.width + r.left - e.clientX, ((1 - q.y) / 2) * r.height + r.top - e.clientY);
      if (d < bestDist) {
        best = p;
        bestDist = d;
      }
    });
    return best;
  }
  function pointerMove(e: PointerEvent) {
    if (stroke && mode === "texture") {
      const t = textureHit(e);
      if (t) paintTexel(t[0], t[1]);
      else stroke.last = null;
      const m = mirrorPaint ? mirrorHit(e) : null;
      if (m) paintTexel(m[0], m[1], true);
      else stroke.lastMirror = null;
      return;
    }
    if (pull && camera) {
      const t = lineParameter(e, pull.origin, pull.dir);
      if (t === null) return;
      const step = snap ? 1 : 0.01;
      const dist = Math.round((t - pull.t0) / step) * step;
      if (!pull.moved && dist === 0) return;
      if (!pull.moved) history.record(pull.base);
      pull.moved = true;
      const r = extrudeFace(pull.baseCube, pull.face, dist, shrinkBy / 100);
      commit(setCube(pull.base, pull.path, r.cube), true);
      selVerts = r.points;
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
    let delta = [0, 1, 2].map((a) => Math.round((from[a]! + [local.x, local.y, local.z][a]!) / step) * step - from[a]!) as Vec3;
    const near = snapPoints ? nearestPoint(e, drag.baseCube, new Set(selVerts), g) : null;
    if (near) delta = [near[0] - from[0], near[1] - from[1], near[2] - from[2]];
    if (!drag.moved && delta.every((d) => d === 0)) return;
    if (!drag.moved) history.record(drag.base);
    drag.moved = true;
    commit(setCube(drag.base, drag.path, symmetry === "off" ? moveVerts(drag.baseCube, selVerts, delta) : moveVertsSymmetric(drag.baseCube, selVerts, delta, Number(symmetry) as Axis)), true);
  }
  function pointerUp(e: PointerEvent) {
    if (gizmoDown) {
      gizmoDown = false;
      downAt = null;
      return;
    }
    if (stroke) {
      stroke = null;
      downAt = null;
      if (controls) controls.enabled = true;
      return;
    }
    if (pull) {
      pull = null;
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
      const edge = pickEdge(e);
      if (edge) {
        selEdge = edge;
        selFace = null;
        selVerts = [...edge];
        canvas.focus();
        return;
      }
      selEdge = null;
      const mine = meshes.find((m) => samePath(m.path, selected));
      const hit = mine ? ray.intersectObject(mine.mesh, false)[0] : undefined;
      const face = hit?.faceIndex != null ? mine!.polyOfTriangle[hit.faceIndex] : undefined;
      selFace = face ?? null;
      selVerts = face !== undefined ? [...cube!.polys![face]!.v] : e.shiftKey ? selVerts : [];
      canvas.focus();
      return;
    }
    const hit = ray.intersectObjects(meshes.map((m) => m.mesh), false)[0];
    choose(hit ? (meshes.find((m) => m.mesh === hit.object)?.path ?? null) : null, e.shiftKey || e.ctrlKey || e.metaKey);
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
    selEdge = null;
    heatBone = null;
  });
  $effect(() => {
    doc; selected; selVerts; selFace; selEdge; inEdit; mode; heatBone;
    untrack(drawHandles);
  });
  const part = $derived(selected && selected.cube === undefined ? partAt(doc, selected.parts) : selected ? partAt(doc, selected.parts) : undefined);

  function newPart(parent: number[]) {
    const r = addPart(doc, parent);
    commit(r.doc);
    selected = r.path;
    also = [];
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
    also = [];
  }
  function remove() {
    if (!selected) return;
    if (pickedShapes.length > 1) {
      // later shapes first, so the numbers of the earlier ones in the same part stay right
      const order = [...pickedShapes].sort((a, b) => (a.parts.join(".") === b.parts.join(".") ? b.cube! - a.cube! : 0));
      let next = doc;
      for (const p of order) next = removeNode(next, p);
      const first = pickedShapes[0]!;
      commit(next);
      selected = { parts: first.parts };
      also = [];
      return;
    }
    const gone = selected;
    const next = removeNode(doc, gone);
    if (next === doc) return;
    commit(next);
    selected = afterRemoval(next, gone);
    also = [];
  }
  function duplicate() {
    if (!selected) return;
    let next = doc;
    const copies: Path[] = [];
    for (const p of picked) {
      const r = duplicateNode(next, p);
      if (!r) continue;
      next = r.doc;
      copies.push(r.path);
    }
    if (!copies.length) return;
    commit(next);
    selected = copies[0]!;
    also = copies.slice(1);
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
    // a skinned mesh whose points changed gets its weights worked out again
    commit(reskin(setCube(doc, selected, next), selected));
    if (reset) {
      selVerts = [];
      selFace = null;
      selEdge = null;
    }
  }
  let skinNote = $state("");
  let skinBone = $state("");
  let heatBone: number | null = $state(null); // a part picked in the key: points show how strongly it holds them (blue to red)
  let skinWeight = $state(100);
  function autoSkin() {
    if (!selected || !cube) return;
    const skin = autoWeights(doc, selected);
    if (!skin) {
      skinNote = "Put this shape on a part that has a parent or child parts, so there is something to bend with.";
      return;
    }
    skinNote = "";
    commit(setCube(doc, selected, { ...cube, skin }));
  }
  function unskin() {
    if (!selected || !cube?.skin) return;
    const { skin: _gone, ...rest } = cube;
    commit(setCube(doc, selected, rest));
  }
  function applyWeight() {
    if (!selected || !cube?.skin || !selVerts.length || !skinBone) return;
    commit(setCube(doc, selected, setWeight(cube, selVerts, skinBone, skinWeight / 100)));
  }
  function weightsOf(i: number): string {
    return (cube?.skin?.weights[i] ?? []).map(([b, w]) => `${cube!.skin!.bones[b]!.split("/").at(-1)} ${Math.round(w * 100)}%`).join(", ");
  }
  function makeEditable() {
    if (!selected || !cube) return;
    if (cube.shape !== "mesh") change(toMesh(cube));
    editPoints = true;
  }
  function extrude() {
    if (!selected || !cube || selFace === null) return;
    const r = extrudeFace(cube, selFace, extrudeBy, shrinkBy / 100);
    change(r.cube);
    selVerts = r.points;
  }
  function inset() {
    if (!selected || !cube || selFace === null) return;
    const r = extrudeFace(cube, selFace, 0, (shrinkBy || 25) / 100);
    change(r.cube);
    selVerts = r.points;
  }
  function bevel() {
    if (!selected || !cube || !selEdge) return;
    const r = bevelEdge(cube, selEdge[0], selEdge[1], bevelBy / 100);
    if (!r) return void studio.say("info", "A bevel needs an edge between two faces, at a corner where three faces meet (like a box's).");
    change(r.cube);
    selEdge = null;
    selFace = null;
    selVerts = r.points;
  }
  function extendEdge() {
    if (!selected || !cube || !selEdge) return;
    const r = extrudeEdge(cube, selEdge[0], selEdge[1], edgeBy);
    if (!r) return void studio.say("info", "Only an open edge, one that has a face on one side only, can be pulled out.");
    change(r.cube);
    selEdge = [r.points[0]!, r.points[1]!];
    selVerts = [...r.points];
  }
  function cutLoop(way: 0 | 1) {
    if (!selected || !cube || selFace === null) return;
    const r = loopCut(cube, selFace, way, cutAt / 100);
    if (!r.points.length) return void studio.say("info", "A loop cut needs four-sided faces all the way round.");
    change(r.cube);
    selFace = null;
    selVerts = r.points;
  }
  function makeFace() {
    if (!cube || selVerts.length < 3) return;
    const before = cube.polys?.length ?? 0;
    const next = addFace(cube, selVerts);
    change(next);
    if ((next.polys?.length ?? 0) > before) selFace = before;
  }
  function knife() {
    if (!cube || selVerts.length !== 2) return;
    const next = cutFace(cube, selVerts[0]!, selVerts[1]!);
    if (!next) return void studio.say("info", "The knife cuts a face between two of its points that are not next to each other. Pick two such points of one face.");
    change(next);
    selFace = null;
    selEdge = null;
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
    also = [];
  }
  function mirrorPartCopy(axis: Axis) {
    if (!selected) return;
    const r = mirrorPart(doc, selected.parts, axis);
    if (!r) return;
    commit(r.doc);
    selected = r.path;
    also = [];
  }
  const faceHex = $derived(cube && selFace !== null ? (cube.polys?.[selFace]?.color ?? cube.color).slice(0, 7) : "#c9d1d9");

  function nudge(dx: number, dy: number, dz: number) {
    if (!selected) return;
    if (inEdit && cube && selVerts.length) change(symmetry === "off" ? moveVerts(cube, selVerts, [dx, dy, dz]) : moveVertsSymmetric(cube, selVerts, [dx, dy, dz], Number(symmetry) as Axis));
    else if (selected.cube !== undefined && cube) {
      let next = doc;
      for (const p of pickedShapes) {
        const c = cubeAt(next, p);
        if (c) next = updateCube(next, p, { from: [c.from[0] + dx, c.from[1] + dy, c.from[2] + dz] });
      }
      commit(next);
    }
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
    if (!mod && mode === "model" && !inEdit && selected && ["w", "e", "r", "p"].includes(e.key.toLowerCase())) {
      gizmoMode = ({ w: "translate", e: "rotate", r: "scale", p: "pivot" } as const)[e.key.toLowerCase() as "w" | "e" | "r" | "p"];
    } else if (e.key.toLowerCase() === "z" && !mod) {
      viewMode = viewMode === "textured" ? "solid" : viewMode === "solid" ? "wire" : "textured";
    } else if (e.key === "Escape" && editPoints) {
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
  const pickColour = (face: Face | "all", value: string) => {
    if (!selected) return;
    let next = doc;
    for (const p of face === "all" ? pickedShapes : [selected]) next = setFaceColor(next, p, face, value);
    commit(next);
  };
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
        <button onclick={() => newPart(selected?.parts ?? [])} title={selected ? `A new part inside "${partAt(doc, selected.parts)?.name ?? "the selected part"}"` : "A new part at the top level (select a part first to put it inside that one)"}>＋ Part{selected ? "" : " (top)"}</button>
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
            <button class="node" class:on={selected?.cube === undefined && samePath(selected, { parts: r.parts })} style:padding-left="{8 + r.depth * 14}px" onclick={() => choose({ parts: r.parts }, false)}>{r.depth ? "└ " : ""}◈ {r.part.name}</button>
            {#each r.part.cubes as c, ci (ci)}
              <button class="node cube" class:on={isPicked({ parts: r.parts, cube: ci })} style:padding-left="{22 + r.depth * 14}px" onclick={(e) => choose({ parts: r.parts, cube: ci }, e.shiftKey || e.ctrlKey || e.metaKey)}>
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
        {#if mode === "model" && selected && !inEdit}
          <span class="seg" role="group" aria-label="Handles">
            <button class:on={gizmoMode === "translate"} onclick={() => (gizmoMode = "translate")} title="Move (W)">Move</button>
            <button class:on={gizmoMode === "rotate"} onclick={() => (gizmoMode = "rotate")} title="Turn (E)">Turn</button>
            <button class:on={gizmoMode === "pivot"} disabled={selected.cube !== undefined} onclick={() => (gizmoMode = "pivot")} title={selected.cube !== undefined ? "Select a part to move its pivot" : "Move the point this part turns about, leaving its shapes where they are (P)"}>Pivot</button>
            <button class:on={gizmoMode === "scale"} disabled={selected.cube === undefined} onclick={() => (gizmoMode = "scale")} title={selected.cube === undefined ? "Parts are resized in animations" : "Resize (R)"}>Resize</button>
          </span>
          <label class="check" title="Snap to whole units and 15 degrees"><input type="checkbox" bind:checked={snap} /> Snap</label>
        {/if}
        <label class="check"><input type="checkbox" bind:checked={showGrid} /> Grid</label>
        <select bind:value={viewMode} aria-label="View (Z)" title="How the model is drawn (Z)">
          <option value="textured">Textured</option>
          <option value="solid">Colours only</option>
          <option value="wire">Wireframe</option>
        </select>
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
        <p class="hint dim">Texture: drag on the model to paint it, or paint in the picture on the right · ⇧-click draws a straight line from the last point · ✥ moves a shape's block · ⌘Z undoes painting · Z changes the view · right-drag pans, scroll zooms (⌥-drag orbits)</p>
      {:else if inEdit}
        <p class="hint dim">Points: click a face or an edge to pick it · click or drag a dot to move it (⇧-click adds more) · arrows and PageUp/PageDown nudge the picked points · Esc leaves point mode</p>
      {:else}
        <p class="hint dim">Drag to orbit · right-drag to pan · scroll to zoom · click a shape to select (⌘ or ⇧ adds more) · drag the handles, or W E R P for move, turn, resize, pivot · arrows and PageUp/PageDown nudge (⇧ for 4) · ⌘D duplicates · Delete removes · Z changes the view</p>
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
            {#each [["pencil", "✎", "Pencil"], ["eraser", "⌫", "Eraser"], ["fill", "▨", "Fill"], ["picker", "✚", "Pick a colour"], ["move", "✥", "Move a shape's block"], ["face", "▭", "Place one face of a box"], ["line", "╱", "Line (in the picture)"], ["rect", "□", "Rectangle (in the picture)"], ["ellipse", "◯", "Ellipse (in the picture)"], ["gradient", "◨", "Gradient from the colour to the second colour (in the picture)"]] as [id, icon, tip] (id)}
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
          {#if texTool === "gradient"}
            <div class="paintrow"><span class="dim small">to</span><input type="color" value={toHex([texColor2[0], texColor2[1], texColor2[2], 255])} oninput={(e) => { const c = parseHex(e.currentTarget.value); if (c) texColor2 = c; }} aria-label="Second gradient colour" /><span class="dim small grow">Drag a box in the picture: the colour at the start fades into this one.</span></div>
          {:else if texTool === "rect" || texTool === "ellipse"}
            <label class="check"><input type="checkbox" bind:checked={texFilled} /> Filled</label>
          {/if}
          <label class="check" title="Paint the same stroke on the other side of the model, left and right swapped (the mirrored half needs its own texels)"><input type="checkbox" bind:checked={mirrorPaint} /> Mirror painting (left ↔ right)</label>
          <div class="paintrow">
            <label class="inline grow">Opacity <input type="range" min="5" max="100" step="5" bind:value={texOpacity} aria-label="Opacity" /> <output>{texOpacity}%</output></label>
            <label class="check" title="Paint only pixels that are already painted, and keep their see-through-ness"><input type="checkbox" bind:checked={lockAlpha} /> Lock alpha</label>
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
          {#if texTool === "face"}
            {#if pickedRect && faceSel}
              <h4>{faceSel} face</h4>
              <div class="vec4">{#each ["x", "y", "width", "height"] as lab, k (lab)}<label>{lab}<input type="number" min="0" step="1" value={normRect(pickedRect)[k]} aria-label="{faceSel} {lab}" onchange={(e) => setRectPart(k, e.currentTarget.value)} /></label>{/each}</div>
              <div class="row"><button onclick={() => flipFace(true)} title="Turns the face's picture over, left to right">Flip ↔</button><button onclick={() => flipFace(false)} title="Turns it over, top to bottom">Flip ↕</button><button onclick={resetRect} disabled={!cube?.texture?.faces?.[faceSel]} title="Back to its place in the automatic layout">Reset</button></div>
            {:else}
              <p class="dim small">Click a face rectangle of a painted box in the picture, then drag it or type where it goes. Faces can share the same texels.</p>
            {/if}
          {/if}
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
          {#if clip && partNames.length && easeAt(clip, partNames, animTime) !== undefined}
            <label>How this key blends into the next
              <select value={easeAt(clip, partNames, animTime)} aria-label="Easing" onchange={(e) => commit(setEase(doc, clipIndex, partNames, animTime, e.currentTarget.value as Ease))}>
                <option value="linear">Straight</option><option value="in">Slow start</option><option value="out">Slow end</option><option value="inout">Slow start and end</option><option value="step">Jump (hold, then change)</option>
              </select>
            </label>
          {/if}
          <div class="row"><button class="danger" onclick={deleteKeysHere} disabled={!keyTimes.some((t) => Math.abs(t - animTime) < KEY_STEP / 2)}>Delete keys here</button></div>
          <p class="dim small">Properties with no key stay as modelled. Keys blend smoothly; rotations take the short way round.</p>
        {/if}
      {:else if selected && cube}
        <h3>{cube.shape === "mesh" ? "Mesh" : "Shape"}</h3>
        {#if pickedShapes.length > 1}<p class="note small">{pickedShapes.length} shapes picked. Moving, copying, deleting and colouring act on all of them{", and so do the turn and resize handles (about the first one's middle)"}; the fields below are for the first.</p>{/if}
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
        <label title="0 is lit by the scene like anything else; 1 shines at full brightness even in the dark (lamps, windows, tail lights)">Glow <input type="range" min="0" max="1" step="0.05" value={cube.emissive ?? 0} aria-label="Glow" oninput={(e) => commit(updateCube(doc, selected!, { emissive: Number(e.currentTarget.value) }))} /><span class="dim small">{Math.round((cube.emissive ?? 0) * 100)}%</span></label>
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
        {#if cube.shape === "mesh"}
          <h4>Bend with parts</h4>
          {#if cube.skin}
            <p class="dim small">Follows {cube.skin.bones.length} part{cube.skin.bones.length === 1 ? "" : "s"}. Pose them in Animate to see it bend.</p>
            <ul class="bones">{#each cube.skin.bones as b, i (b)}<li><button class="bone" class:on={heatBone === i} title="Show how strongly this part holds each point: blue not at all, red completely" onclick={() => ((heatBone = heatBone === i ? null : i), (editPoints = true))}><i class="dot" style:background={boneCss(i)}></i>{b.split("/").at(-1)}</button></li>{/each}</ul>
            {#if inEdit}<p class="dim small">{heatBone === null ? "Each point has the colour of the part that holds it most. Click a part for a gradient." : "Blue: not held by this part. Red: held completely."}</p>{/if}
            {#if inEdit && selVerts.length}
              <p class="dim small">{selVerts.length === 1 ? weightsOf(selVerts[0]!) : `${selVerts.length} points picked`}</p>
              <div class="pair">
                <label class="inline">Part <select bind:value={skinBone} aria-label="Part to follow">{#each rows as r (r.parts.join("."))}{@const key = pathKey(namesOf(doc, r.parts))}<option value={key}>{key}</option>{/each}</select></label>
                <label class="inline">% <input type="number" min="0" max="100" step="10" bind:value={skinWeight} /></label>
              </div>
              <div class="row"><button onclick={applyWeight} disabled={!skinBone} title="The picked points follow that part this much, and the others share the rest">Set weight</button></div>
            {/if}
            <div class="row"><button onclick={autoSkin} title="Works the weights out again from where the parts are (hand-set weights are lost)">Auto weights</button><button class="danger" onclick={unskin}>Stop bending</button></div>
          {:else}
            <div class="row"><button onclick={autoSkin} title="The shape bends where parts meet, like a sleeve at the elbow, instead of staying stiff">Bend with the parts around it</button></div>
          {/if}
          {#if skinNote}<p class="dim small">{skinNote}</p>{/if}
        {/if}
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
          <label class="check" title="A dragged point jumps onto another point when it comes close"><input type="checkbox" bind:checked={snapPoints} /> Snap to other points</label>
          <label>Symmetry <select bind:value={symmetry} aria-label="Symmetry"><option value="off">Off</option><option value="0">Mirror left–right (x)</option><option value="1">Mirror up–down (y)</option><option value="2">Mirror front–back (z)</option></select></label>
          <div class="row">
            <button onclick={makeFace} disabled={selVerts.length < 3} title="Fills a face between the picked points">Make face</button>
            <button onclick={knife} disabled={selVerts.length !== 2} title="Cuts a face in two along a line between the two picked points">Knife</button>
            <button class="danger" onclick={removePointsPicked} disabled={!selVerts.length}>Delete points</button>
          </div>
          {#if selEdge}
            <h4>Edge</h4>
            <div class="pair"><label class="inline">Width % <input type="number" min="2" max="50" step="5" bind:value={bevelBy} /></label><label class="inline">Pull by <input type="number" step="1" bind:value={edgeBy} /></label></div>
            <div class="row"><button onclick={bevel} title="Cuts the edge off with a narrow slanting face">Bevel</button><button onclick={extendEdge} title="Pulls an open edge away, widening the sheet">Extend</button></div>
          {/if}
          <h4>Face</h4>
          {#if selFace !== null && cube.polys?.[selFace]}
            <p class="dim small">Drag the yellow arrow to pull the face out.</p>
            <div class="pair"><label class="inline">Pull by <input type="number" step="1" bind:value={extrudeBy} /></label><label class="inline">Shrink % <input type="number" min="0" max="95" step="5" bind:value={shrinkBy} title="Moves the new face's points towards its middle: a taper" /></label></div>
            <div class="row"><button onclick={extrude} title="Pushes the face out (a negative number digs in) and joins it to the rest">Extrude</button><button onclick={inset} title="A smaller face inside this one (uses Shrink %, 25 if empty)">Inset</button><button class="danger" onclick={removeFacePicked}>Delete</button></div>
            <div class="row"><button onclick={() => cutLoop(0)} title="Cuts the ring of four-sided faces round the shape in two">Loop cut 1</button><button onclick={() => cutLoop(1)} title="The same, the other way round">Loop cut 2</button><label class="inline">at % <input type="number" min="5" max="95" step="5" bind:value={cutAt} /></label></div>
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
  .bones { list-style: none; margin: 2px 0 4px; padding: 0; display: flex; flex-wrap: wrap; gap: 2px 10px; font-size: 11px; color: var(--dim); }
  .bones li { display: flex; align-items: center; gap: 4px; }
  .bone { all: unset; display: flex; align-items: center; gap: 4px; cursor: pointer; padding: 0 4px; border-radius: 4px; }
  .bone:hover, .bone.on { background: color-mix(in srgb, var(--accent, #5ea1ff) 25%, transparent); color: var(--text, inherit); }
  .node { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; background: transparent; border-color: transparent; border-radius: 0; padding: 2px 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .node:hover { background: var(--panel-2); }
  .node.on { background: color-mix(in srgb, var(--accent) 22%, transparent); }
  .dot { width: 10px; height: 10px; border-radius: 2px; border: 1px solid #0006; flex: none; } .dot.round { border-radius: 50%; }
  .adder { padding: 8px; border-bottom: 1px solid var(--line); display: flex; flex-direction: column; gap: 6px; }
  .adder .row { min-width: 0; } .adder select { min-width: 0; flex: 1; }
  .mirror { align-items: center; } .mirror button { padding: 0 8px; }
  .bar .seg { display: inline-flex; } .bar .seg button { border-radius: 0; padding: 2px 8px; } .bar .seg button:first-child { border-radius: 5px 0 0 5px; } .bar .seg button:last-child { border-radius: 0 5px 5px 0; margin-left: -1px; }
  .tools { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; } .tools button { width: 30px; height: 28px; padding: 0; } .tools button.on { background: var(--accent-2); border-color: var(--accent-2); color: #fff; }
  .tools .gap { flex: 1; }
  .paintrow { display: flex; gap: 6px; align-items: center; } .paintrow input[type="color"] { width: 38px; height: 28px; padding: 0; } .paintrow .mono { flex: 1; min-width: 0; } .paintrow label.inline { flex-direction: row; align-items: center; gap: 4px; } .paintrow label.inline input { width: 48px; }
  .paintrow .grow { flex: 1; } .paintrow input[type="range"] { flex: 1; min-width: 0; } .paintrow output { width: 34px; text-align: right; font-size: 11px; }
  .swatches { display: grid; grid-template-columns: repeat(8, 1fr); gap: 3px; } .swatch { aspect-ratio: 1; padding: 0; border-radius: 3px; }
  .texbox { overflow: auto; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 4px; max-height: 360px; display: grid; place-items: start center; } .texbox canvas { image-rendering: pixelated; cursor: crosshair; touch-action: none; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .vec4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; } .vec4 input { min-width: 0; padding: 3px 4px; }
  .row.mirror span { flex: 1; }
  select { background: var(--panel-2); color: var(--text); border: 1px solid var(--line); border-radius: 4px; padding: 2px 4px; }
  .inspector { border-left: 1px solid var(--line); }
  .inspector > :global(*) { flex-shrink: 0; } /* a short window scrolls the panel instead of squashing the picture */
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
  .note { color: var(--accent); }
  .bad { padding: 32px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
</style>
