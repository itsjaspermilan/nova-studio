<script lang="ts">
  import Icon from "./Icon.svelte";
  import { rememberSize, savedSize } from "../lib/resize";
  import { onMount, untrack } from "svelte";
  import * as THREE from "three";
  import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
  import { applyNavigation, navHint } from "../lib/view-nav";
  import NavButtons from "./NavButtons.svelte";
  import { commands } from "../lib/commands";
  import { axisKey, modalLabel, moveDelta, parseTyped, round2 as round2m, scaleBox, scaleFactor, typeKey, type Axis as ModalAxis } from "../lib/modal-transform";
  import { commandsRev } from "../lib/commands-rev.svelte";
  import { input } from "../lib/input-settings.svelte";
  import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
  import {
    FACES, History, MAX_COLLIDERS, SHAPES, addBox, addCapsule, addCollider, removeBox, removeCapsule, updateBox, updateCapsule, addCube, addPart, afterRemoval, countCubes, cubeAt, duplicateNode, faceColor, newModel, parseModel, partAt, removeNode, samePath, serializeModel,
    removeCollider, setCube, setFaceColor, updateCollider, updateCube, updatePart, walk, namesOf, PROPS, MAX_SEGMENTS, MIN_SEGMENTS, DEFAULT_SEGMENTS, type Cube, type Ease, type Face, type ModelDoc, type Path, type Prop, type Shape, type Vec3,
  } from "../lib/model-doc";
  import { AXIS_COLOURS, AXIS_CSS, AXIS_NAMES, centreOf, constrain, describeLock, describeMove, freePlane, lockForKey, type Lock } from "../lib/point-move";
  import MeshTools from "./MeshTools.svelte";
  import { modelToObj } from "../lib/obj";
  import ReferencePanel from "./ReferencePanel.svelte";
  import { loadReferences, placementOf, saveReferences, type Reference } from "../lib/model-reference";
  import { ORTHO_FOV, PERSPECTIVE_FOV, VIEW_LABELS, VIEW_NAMES, distanceForFov, gizmoDots, type GizmoDot, orbitStep, viewPlacement, type ViewName } from "../lib/view-presets";
  import ModelStats from "./ModelStats.svelte";
  import { solveLimb } from "../lib/model-ik";
  import { bakeConstraints, constrainedPose, setConstraints } from "../lib/model-constraints";
  import { retargetClip, applyPose as applySavedPose, capturePose, removePose, copyKeys, mirrorClip, pasteKeys, removeKeysAt, reverseClip, shiftKeys, shiftKeysAt, stretchKeys, type KeyClipboard } from "../lib/model-anim-tools";
  import { SCULPT_HELP, SCULPT_MODES, sculptDab, type SculptMode } from "../lib/sculpt";
  import { blurMask, clearMask, invertMask, maskDab, maskOf, maskPoints, refineUnder } from "../lib/sculpt-mask";
  import { addFace, bevelEdge, cutFace, edgesOf, extrudeEdge, faceCentre, faceNormal, deleteFaces, deleteVerts, extrudeFace, flipFaces, freshMesh, freshProfile, mirrorElement, mirrorPart, loopCut, movePivot, moveVerts, moveVertsProportional, moveVertsSymmetric, setFaceColors, setSmooth, subdivide, toMesh, transformMesh, weld, weldable, type Axis } from "../lib/mesh-edit";
  import { hasVolume, meshOf, segmentsOf, shapeFaces, solidOf } from "../lib/model-mesh";
  import { WEIGHT_MODES, autoSkinAll, gradientWeights, mirrorWeights, paintWeights, type WeightMode, autoWeights, boneHeat, dominantBones, heatColor, invertAffine, reskin, setWeight, skinnedPoints, transformPoint, worldMatrices } from "../lib/model-skin";
  import { bakeNormals } from "../lib/model-bake";
  import { bakeAll, bakeSurface, channelToGrey, greyToChannel, blockOf, moveIsland, faceRects, flippedRect, normRect, rectAt, enableTexture, fitPicture, packModel, resizeTexture, unwrap, uvsOf } from "../lib/model-uv";
  import { CLEAR, cloneRaster, drawEllipse, drawLine, drawRect, floodFill, getPixel, newRaster, parseHex, stamp, toHex, type Raster, type Rgba } from "../lib/pixels";
  import { applyBrush, applyGradient } from "../lib/paint";
  import { loadRaster, rasterToDataUrl } from "../lib/png";
  import { exportGlb } from "../lib/glb";
  import { applyStack, evaluate, hasModifiers, type Modifier } from "../lib/modifiers";
  import ModifierStack from "./ModifierStack.svelte";
  import CurveEditor from "./CurveEditor.svelte";
  import { addShapeKey, beginKeyEdit, blendShapeKeys, endKeyEdit, MAX_SHAPE_KEYS, removeShapeKey, renameShapeKey, validKeyName } from "../lib/shape-keys";
  import { projectImage } from "../lib/model-bake";
  import { modelStats } from "../lib/mesh-stats";
  import { knifeCut } from "../lib/mesh-cut";
  import { addLayer, duplicateLayer, flatten, layerPath, mergeDown, moveLayer, removeLayer, singleLayer, updateLayer, MAX_TEX_LAYERS, type LayerSet } from "../lib/texture-layers";
  import { BLEND_MODES, composite } from "../lib/pixels";
  import { edgeLoop, edgeRing, edgeSlide, fillHole, gridFillHole, pointsOfEdges, selectSimilarFaces, smoothByAngle } from "../lib/mesh-select";
  import { textToMesh } from "../lib/text-mesh";
  import { parsePath, sweepTube } from "../lib/tube";
  import { checkerRaster, equalizeDensity, uvReport, type ShapeReport } from "../lib/uv-report";
  import ProjectSwatches from "./ProjectSwatches.svelte";
  import { applyCurvature, applyLighting, applyOcclusion, bakeCurvature, bakeLighting, bakeOcclusion } from "../lib/model-bake";
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
  let viewMode = $state<"textured" | "solid" | "wire" | "xray">("textured");
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
  // Shape keys: the weights of the preview (not saved: the game sets them by name), and the name for a new key.
  let keyWeights = $state<Record<string, number>>({});
  let newKeyName = $state("");
  function addKey() {
    if (!cube || !selected) return;
    const name = newKeyName.trim();
    if (!validKeyName(name)) return void (selectNote = "A key's name is letters, digits, spaces, _ or -, up to 24.");
    const next = addShapeKey(cube, name);
    if (next === cube) return void (selectNote = cube.shapes?.some((k) => k.name === name) ? "There is a key with that name." : `At most ${MAX_SHAPE_KEYS} keys.`);
    commit(setCube(doc, selected, next), false, "Add shape key");
    newKeyName = "";
  }
  function dropKey(name: string) {
    if (!cube || !selected) return;
    commit(setCube(doc, selected, removeShapeKey(cube.keyEdit === name ? endKeyEdit(cube) : cube, name)), false, "Remove shape key");
    delete keyWeights[name];
    keyWeights = { ...keyWeights };
  }
  function toggleKeyEdit(name: string) {
    if (!cube || !selected) return;
    const next = cube.keyEdit === name ? endKeyEdit(cube) : beginKeyEdit(cube.keyEdit !== undefined ? endKeyEdit(cube) : cube, name);
    commit(setCube(doc, selected, next), false, cube.keyEdit === name ? "Done editing key" : `Edit key "${name}"`);
  }
  let overlaysOpen = $state(false);
  let pivotMode = $state<"median" | "active">("median");
  let moreAdd = $state(false);
  // What a click picks in point mode (Vertex, Edge, Face): all three by default; a click on one alone picks only that kind, ⇧-click adds or removes one.
  let pickKinds = $state({ vertex: true, edge: true, face: true });
  function setPickKind(k: "vertex" | "edge" | "face", add: boolean) {
    const next = add ? { ...pickKinds, [k]: !pickKinds[k] } : { vertex: k === "vertex", edge: k === "edge", face: k === "face" };
    if (next.vertex || next.edge || next.face) pickKinds = next;
  }
  let proportional = $state(false);
  let propRadius = $state(6);
  let snapPoints = $state(true);
  const snapMode = $derived(snap && snapPoints ? "both" : snap ? "grid" : snapPoints ? "points" : "off");
  function setSnapMode(v: string) {
    snap = v === "grid" || v === "both";
    snapPoints = v === "points" || v === "both";
  } // a dragged point jumps onto another point of the mesh when it comes close
  let extrudeBy = $state(4);
  let shrinkBy = $state(0); // percent the new face is pulled towards its middle: a taper, or with no pull, an inset
  let cutAt = $state(50); // percent along each crossed edge
  let symmetry = $state<"off" | "0" | "1" | "2">("off"); // move points in mirrored pairs across the x, y or z plane
  let newKind = $state<Shape | "square" | "profile">("box");
  let pendingEdit = false;
  // animation
  let mode = $state<"model" | "texture" | "animate">("model");
  let clipIndex = $state(0);
  let animTime = $state(0);
  let keyBoard: KeyClipboard | null = $state(null);
  let animNote = $state("");
  let poseName = $state("");
  let bakeRemove = $state(false);
  const setMine = (list: import("../lib/model-doc").Constraint[]) => {
    if (selected) commit(setConstraints(doc, selected.parts, list), false, "Constraints");
  };
  const allPartPaths = $derived(walk(doc).map((w) => namesOf(doc, w.parts).join("/")));
  const otherModels = $derived(studio.files.filter((f) => !f.dir && f.path.endsWith(".model.json") && f.path !== filePath).map((f) => f.path));
  /// Copies every animation of another model of the project onto this one, parts matched by name (moves scaled by the models' heights).
  async function copyAnimationsFrom(path: string) {
    if (!path || !studio.api) return;
    try {
      const parsed = parseModel((await studio.api.readFile(path)).text ?? "");
      if (!parsed.ok) return void (animNote = `${path}: ${parsed.error}`);
      let next = doc;
      let copied = 0;
      const missing = new Set<string>();
      for (let i = 0; i < (parsed.doc.clips?.length ?? 0); i++) {
        const r = retargetClip(parsed.doc, i, next);
        r.missing.forEach((m) => missing.add(m));
        if (r.index >= 0) {
          next = r.doc;
          copied++;
        }
      }
      if (!copied) return void (animNote = "No part of that model has the same name as a part here, so nothing was copied.");
      commit(next, false, "Copy animations");
      animNote = `Copied ${copied} animation${copied === 1 ? "" : "s"}.${missing.size ? ` Parts with no match here: ${[...missing].slice(0, 6).join(", ")}.` : ""}`;
    } catch (e) {
      animNote = String(e);
    }
  }
  let curvesOpen = $state(false);
  let autoKey = $state(true);
  let uvRows: ShapeReport[] = $state([]);
  function checkUv() {
    uvRows = uvReport(doc);
    bakeNote = uvRows.length ? "" : "No shape is painted yet.";
  }
  function evenOut() {
    if (!uvReport(doc).length) return void (bakeNote = "No shape is painted yet.");
    commit(equalizeDensity(doc), false, "Even out texel density");
    packAll();
    uvRows = uvReport(doc);
  }
  /// Puts a checker pattern over the whole texture (one undo step) to see how the texture lies on the model: squares that are not square are stretched.
  function showChecker() {
    if (!picture || !doc.texture) return void (bakeNote = "Paint a shape first.");
    rememberPicture();
    picture = checkerRaster(picture.w, picture.h, Math.max(4, Math.round(picture.w / 16)));
    pictureChanged();
    bakeNote = "A checker is on the texture: look for squares that are stretched or turned. Undo takes your painting back.";
  }
  let bakeStrength = $state(0.7);
  let bakeSamples = $state(24);
  let bakeDistance = $state(8);
  let bakeNote = $state("");
  let baking = $state(false);
  /// Bakes ambient occlusion into the painted picture (one undo step): crevices darken. Runs on this thread, so a big model waits a moment.
  /// Edge wear: lightens the texture on convex edges and darkens it in creases (one undo step). Needs points along edges to read: a coarse box has curvature only at its corners.
  let sunX = $state(0.4);
  let sunY = $state(1);
  let sunZ = $state(0.3);
  /// Sunlight and shadow baked into the texture from one directional light (one undo step).
  let projectPath = $state("");
  const projectable = $derived(studio.files.filter((f) => !f.dir && /\.(png|jpe?g)$/i.test(f.path) && !f.path.includes(".texture")).map((f) => f.path));
  /// Throws a project picture onto the model from the camera, as a slide projector would: every texel facing the camera and not hidden takes the picture's colour (at the paint opacity), on the layer being painted.
  async function projectPicture() {
    if (!picture || !doc.texture || !camera || !modelGroup || !canvas) return void (bakeNote = "Paint a shape first.");
    if (!projectPath) return void (bakeNote = "Choose a picture to project first.");
    try {
      const img = await loadRaster(await studio.api!.readImage(projectPath));
      camera.updateMatrixWorld();
      modelGroup.updateMatrixWorld(true);
      const m = new THREE.Matrix4().copy(camera.projectionMatrix).multiply(camera.matrixWorldInverse).multiply(modelGroup.matrixWorld);
      const eye = modelGroup.worldToLocal(camera.position.clone());
      const out = projectImage(doc, img, m.elements, [eye.x, eye.y, eye.z], canvas.clientWidth / Math.max(1, canvas.clientHeight));
      if (!out) return;
      rememberPicture();
      picture = composite(picture, out, texOpacity / 100);
      pictureChanged();
      bakeNote = "Picture projected from this view.";
    } catch (e) {
      bakeNote = "Could not read that picture: " + (e instanceof Error ? e.message : String(e));
    }
  }
  function bakeSun() {
    if (!picture || !doc.texture) return void (bakeNote = "Paint a shape first: baking changes the texture.");
    const light = bakeLighting(doc, { toLight: [sunX, sunY, sunZ], ambient: 0.3 });
    if (!light) return void (bakeNote = "This model has no texture.");
    rememberPicture();
    picture = applyLighting(picture, light, bakeStrength);
    pictureChanged();
    bakeNote = "Sunlight and shadow baked into the texture. Undo takes it back.";
  }
  function bakeWear() {
    if (!picture || !doc.texture) return void (bakeNote = "Paint a shape first: baking changes the texture.");
    const curve = bakeCurvature(doc);
    if (!curve) return void (bakeNote = "This model has no texture.");
    rememberPicture();
    picture = applyCurvature(picture, curve, bakeStrength);
    pictureChanged();
    bakeNote = "Edge wear baked into the texture. Undo takes it back.";
  }
  async function bakeAO() {
    if (!picture || !doc.texture) return void (bakeNote = "Paint a shape first: baking darkens the texture.");
    baking = true;
    bakeNote = "Baking…";
    await new Promise((r) => setTimeout(r, 20));
    try {
      const ao = bakeOcclusion(doc, { samples: bakeSamples, distance: bakeDistance });
      if (!ao) return void (bakeNote = "This model has no texture.");
      rememberPicture();
      picture = applyOcclusion(picture, ao, bakeStrength);
      pictureChanged();
      bakeNote = "Occlusion baked into the texture. Undo takes it back.";
    } finally {
      baking = false;
    }
  }
  // reaching: the chosen part is the top of a limb of three parts (shoulder, elbow, hand); the end is put on a target in model space
  let reachTarget = $state<[number, number, number]>([0, 0, 0]);
  let reachPole = $state<[number, number, number]>([0, 0, 1]);
  const limbParts = $derived.by(() => {
    tick;
    if (!selected) return null;
    const top = partAt(doc, selected.parts);
    const mid = top?.children[0];
    const end = mid?.children[0];
    return top && mid && end ? { top, mid, end } : null;
  });
  function reachFromHand() {
    if (!selected || !limbParts) return;
    const names = namesOf(doc, selected.parts);
    const m = worldMatrices(doc).get([...names, limbParts.mid.name, limbParts.end.name].join("/"));
    if (m) reachTarget = transformPoint(m, [0, 0, 0]).map((v) => Math.round(v * 100) / 100) as [number, number, number];
  }
  function reach() {
    if (!selected || !limbParts) return;
    const r = solveLimb(doc, selected.parts, reachTarget, reachPole);
    if (!r) return void (animNote = "Choose a part that has a part below it with another part below that (a shoulder, an elbow, a hand).");
    const names = namesOf(doc, selected.parts);
    let next = setKey(doc, clipIndex, names, "rotation", animTime, r.upper);
    next = setKey(next, clipIndex, [...names, limbParts.mid.name], "rotation", animTime, r.middle);
    commit(next, false, "Reach with a limb");
    animNote = r.reached ? "The end reaches the target: keys set on the top and middle parts." : "Too far to reach: the limb is stretched towards it.";
  }
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
  let texSmoothShown = false; // the filtering the 3D view's texture has now (the model's "smooth texels")
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

  // Painting layers: `picture` is always the layer being painted; the others wait here (null at the active one). One layer: no list in the model file.
  let otherLayers = $state.raw<(Raster | null)[]>([]);
  let activeLayer = $state(0);
  const layerInfos = $derived(doc.texture?.layers ?? []);
  const layered = $derived(layerInfos.length > 1);
  // The roughness and metal picture (green and blue): painted one channel at a time as a grey picture, which stands in for `picture` while a channel is chosen
  // (the colour picture waits in `colourStash`).
  let surface = $state.raw<Raster | null>(null);
  let channel = $state<"colour" | "roughness" | "metal" | "bump">("colour");
  let colourStash: Raster | null = null;
  // A normal map baked from the model's high-poly parts, kept beside the texture (`texture.normals`).
  let normalMap = $state.raw<Raster | null>(null);
  let normalBusy = $state(false);
  let normalCage = $state(4);
  const normalPath = untrack(() => filePath).replace(/\.model\.json$/i, ".texture.normal.png");
  const hasHigh = $derived(walk(doc).some(({ part }) => part.bakeSource));
  async function bakeNormalsNow() {
    if (!doc.texture || !picture) return void (bakeNote = "Paint a shape first.");
    normalBusy = true;
    bakeNote = "Baking normals…";
    await new Promise((r) => setTimeout(r, 30)); // (let the note show before the work starts)
    try {
      const n = bakeNormals(doc, normalCage);
      if (!n) return void (bakeNote = "Nothing to bake from: mark a part as the high-poly source (Part panel) and paint the shapes that should receive it.");
      normalMap = n;
      commit({ ...doc, texture: { ...doc.texture, normals: true } });
      remember();
      studio.markPending(filePath);
      bakeNote = "Normals baked: they are written with the model and used by the game.";
    } finally {
      normalBusy = false;
    }
  }
  function dropNormals() {
    if (!doc.texture) return;
    normalMap = null;
    commit({ ...doc, texture: { ...doc.texture, normals: undefined } });
    remember();
  }
  const surfacePath = untrack(() => filePath).replace(/\.model\.json$/i, ".texture.surface.png");
  const remember = () => studio.sessions.set(filePath, { doc, picture, others: otherLayers, active: activeLayer, surface, channel, stash: colourStash, normalMap });
  type Kept = { doc: ModelDoc; picture?: Raster | null; others?: (Raster | null)[]; active?: number; surface?: Raster | null; channel?: string; stash?: Raster | null; normalMap?: Raster | null };
  /// The colour picture and the surface picture as they are now, whichever channel is being painted.
  function finalsOf(k: Kept | undefined): { colour: Raster | null; surface: Raster | null } {
    const ch = k?.channel ?? "colour";
    if (ch === "colour") return { colour: k?.picture ?? null, surface: k?.surface ?? null };
    return { colour: k?.stash ?? null, surface: k?.surface && k.picture ? greyToChannel(k.surface, k.picture, ch as "roughness" | "metal" | "bump") : (k?.surface ?? null) };
  }
  function enableSurface() {
    if (!doc.texture || !picture) return;
    const next = { ...doc, texture: { ...doc.texture, surface: true } };
    surface = bakeSurface(next);
    commit(next);
  }
  function disableSurface() {
    if (!doc.texture) return;
    if (channel !== "colour") setChannel("colour");
    surface = null;
    commit({ ...doc, texture: { ...doc.texture, surface: undefined } });
  }
  function setChannel(next: "colour" | "roughness" | "metal" | "bump") {
    if (next === "bump" && doc.texture && !doc.texture.bump) commit({ ...doc, texture: { ...doc.texture, bump: 1 } });
    if (next === channel || !picture || !surface) return;
    if (channel === "colour") colourStash = picture;
    else surface = greyToChannel(surface, picture, channel);
    picture = next === "colour" ? colourStash! : channelToGrey(surface, next);
    channel = next;
    texPast.length = 0;
    texFuture = [];
    texTick++;
    pictureChanged();
  }
  /// Every layer as a set (the live picture in its place).
  function layerSetNow(): LayerSet {
    if (!picture) return { info: [], rasters: [] };
    const info = doc.texture?.layers?.length ? doc.texture.layers.map((l) => ({ ...l })) : [{ name: "Layer" }];
    return { info, rasters: info.map((_, i) => (i === activeLayer || !otherLayers[i] ? picture! : otherLayers[i]!)) };
  }
  /// What the model and the saved texture show: the layers flattened (just the picture when there is one layer).
  function flatPicture(): Raster | null {
    return picture && layered ? flatten(layerSetNow()) : picture;
  }
  /// Puts a changed set of layers in place and shows it. Layer changes are not on the undo list; painting undo starts again after one.
  function applyLayers(set: LayerSet, active: number) {
    const a = Math.min(set.rasters.length - 1, Math.max(0, active));
    otherLayers = set.rasters.map((r, i) => (i === a ? null : r));
    activeLayer = a;
    picture = set.rasters[a]!;
    if (!doc.texture) return;
    commit({ ...doc, texture: { ...doc.texture, layers: set.info.length > 1 ? set.info : undefined } }, true);
    texPast.length = 0;
    texFuture = [];
    texTick++;
    pictureChanged();
  }
  function pickLayer(i: number) {
    if (!picture || i === activeLayer || !layered) return;
    const set = layerSetNow();
    applyLayers(set, i);
  }
  const layerOp = (fn: (set: LayerSet) => LayerSet, nextActive: (set: LayerSet) => number) => {
    if (!picture || channel !== "colour") return;
    const set = layerSetNow();
    const next = fn(set);
    if (next === set) return;
    applyLayers(next, nextActive(next));
  };

  /// Copies the picture to the canvas the 3D view reads: the picture with a row of white under it (what shapes without
  /// texels sample). `rect` limits the copy to what changed.
  function syncTexture(rect?: { x: number; y: number; w: number; h: number }) {
    if (!picture || !doc.texture) {
      threeTex?.dispose();
      threeTex = texCanvas = texData = texImage = undefined;
      return;
    }
    const src = flatPicture()!;
    const { w, h } = src;
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
      threeTex.magFilter = threeTex.minFilter = doc.texture?.smooth ? THREE.LinearFilter : THREE.NearestFilter;
      texSmoothShown = !!doc.texture?.smooth;
      threeTex.generateMipmaps = false;
      threeTex.flipY = false;
      texImage = undefined;
      rect = undefined;
    }
    if (threeTex && texSmoothShown !== !!doc.texture.smooth) {
      threeTex.magFilter = threeTex.minFilter = doc.texture.smooth ? THREE.LinearFilter : THREE.NearestFilter;
      threeTex.needsUpdate = true;
      texSmoothShown = !!doc.texture.smooth;
    }
    if (!texImage || texData !== src.data) {
      texData = src.data;
      texImage = new ImageData(src.data as Uint8ClampedArray<ArrayBuffer>, w, h);
      rect = undefined;
    }
    const ctx = texCanvas.getContext("2d")!;
    if (rect) ctx.putImageData(texImage, 0, 0, rect.x, rect.y, rect.w, rect.h);
    else ctx.putImageData(texImage, 0, 0);
    threeTex!.needsUpdate = true;
  }

  async function loadPicture() {
    try {
      const infos = doc.texture?.layers;
      if (infos && infos.length > 1) {
        const rasters: Raster[] = [];
        for (let i = 0; i < infos.length; i++) rasters.push(fitPicture(doc, await loadRaster(await studio.api!.readImage(layerPath(texturePath, i)))));
        otherLayers = rasters.map((r, i) => (i === rasters.length - 1 ? null : r));
        activeLayer = rasters.length - 1;
        picture = rasters[rasters.length - 1]!;
      } else picture = fitPicture(doc, await loadRaster(await studio.api!.readImage(texturePath)));
      if (doc.texture?.normals) {
        try {
          normalMap = fitPicture(doc, await loadRaster(await studio.api!.readImage(normalPath)));
        } catch {
          normalMap = null;
        }
      }
      if (doc.texture?.surface) {
        try {
          surface = fitPicture(doc, await loadRaster(await studio.api!.readImage(surfacePath)));
        } catch {
          surface = bakeSurface(doc);
        }
      }
    } catch {
      otherLayers = [];
      activeLayer = 0;
      picture = bakeAll(doc); // no picture on disk yet: start from the shapes' colours
      if (doc.texture?.layers) doc = { ...doc, texture: { ...doc.texture, layers: undefined } };
    }
    remember();
    syncTexture();
    rebuild();
  }

  // Editors with files of their own register a save hook; this one writes the .glb the game loads, and the texture picture.
  onMount(() => {
    if (error) return;
    studio.saveHooks.set(filePath, async () => {
      const kept = studio.sessions.get(filePath) as Kept | undefined;
      const d = kept?.doc ?? doc;
      let image: Raster | undefined;
      let surfaceImage: Raster | undefined;
      let normalImage: Raster | undefined;
      if (d.texture) {
        const finals = finalsOf(kept);
        const live = finals.colour ?? picture ?? bakeAll(d);
        if (d.texture.normals && kept?.normalMap) {
          normalImage = fitPicture(d, kept.normalMap);
          await studio.api!.writeImage(normalPath, rasterToDataUrl(normalImage));
          if (!studio.files.some((f) => f.path === normalPath)) void studio.refreshFiles();
        }
        if (d.texture.surface) {
          surfaceImage = fitPicture(d, finals.surface ?? bakeSurface(d));
          await studio.api!.writeImage(surfacePath, rasterToDataUrl(surfaceImage));
          if (!studio.files.some((f) => f.path === surfacePath)) void studio.refreshFiles();
        }
        const infos = d.texture.layers;
        if (infos && infos.length > 1) {
          const rasters = infos.map((_, i) => fitPicture(d, i === kept?.active || !kept?.others?.[i] ? live : kept.others[i]!));
          for (let i = 0; i < rasters.length; i++) await studio.api!.writeImage(layerPath(texturePath, i), rasterToDataUrl(rasters[i]!));
          image = fitPicture(d, flatten({ info: infos, rasters }));
        } else image = fitPicture(d, live);
        await studio.api!.writeImage(texturePath, rasterToDataUrl(image));
        if (!studio.files.some((f) => f.path === texturePath)) void studio.refreshFiles();
      }
      const bytes = exportGlb(d, image, surfaceImage, normalImage);
      await studio.api!.writeModel(glbPath, `data:model/gltf-binary;base64,${toBase64(bytes)}`);
    });
    const kept = studio.sessions.get(filePath) as Kept | undefined;
    if (kept?.picture) {
      picture = kept.picture;
      otherLayers = kept.others ?? [];
      activeLayer = kept.active ?? 0;
      surface = kept.surface ?? null;
      channel = (kept.channel as typeof channel | undefined) ?? "colour";
      colourStash = kept.stash ?? null;
      normalMap = kept.normalMap ?? null;
    }
    remember();
    if (!picture && doc.texture) void loadPicture();
  });

  function commit(next: ModelDoc, keep = false, label?: string) {
    if (!keep) history.record(doc, label);
    doc = next;
    tick++;
    remember();
    studio.edit(filePath, serializeModel(next));
  }
  let historyOpen = $state(false);
  /// Jumps to a step of the history list: `n` steps back (n > 0) or forward (n < 0).
  function jumpHistory(n: number) {
    const target = n > 0 ? history.undoMany(doc, n) : history.redoMany(doc, -n);
    if (target) commit(target, true);
    historyOpen = false;
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
  let stopNav: (() => void) | undefined;
  let modelGroup: THREE.Group | undefined;
  let grid: THREE.GridHelper | undefined;
  let outline: THREE.Box3Helper | undefined;
  let frameId = 0;
  /// `skin` is set for a mesh that bends with the parts: where its vertices are at rest, and the mesh point each one shows.
  // `cage`: with modifiers on, the drawn mesh is the finished result, so picking faces in edit mode uses this hidden copy of the original polygons.
  const meshes: { mesh: THREE.Mesh; path: Path; polyOfTriangle: number[]; skin?: { rest: Float32Array; pointOf: number[] }; cage?: { mesh: THREE.Mesh; polyOfTriangle: number[] } }[] = [];
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
    // how the person moves the view (a mouse, a trackpad or a pen: lib/view-nav.ts), kept up to date if they change it
    stopNav = $effect.root(() => {
      $effect(() => applyNavigation(controls!, () => camera!, canvas!, input.navigation, { invert: input.invert, marquee: true }));
    });
    gizmo = new TransformControls(camera, canvas!);
    gizmo.setSize(0.75);
    gizmo.addEventListener("dragging-changed", (e) => {
      if (controls) controls.enabled = !e.value;
      if (e.value) gizmoDown = true;
      else finishGizmo();
    });
    gizmo.addEventListener("objectChange", liveGizmo);
    scene.add(gizmo.getHelper());
    // the picked points' own move handle (arrows and squares only: see stripFreeHandle)
    pointGizmo = new TransformControls(camera, canvas!);
    pointGizmo.setSize(0.9);
    pointGizmo.setMode("translate");
    pointGizmo.setSpace("local");
    stripFreeHandle(pointGizmo);
    pointGizmo.addEventListener("dragging-changed", (e) => {
      if (controls) controls.enabled = !e.value;
      if (e.value) {
        gizmoDown = true;
        beginPointGizmo();
      } else if (gizmoMove) {
        gizmoMove = null;
        endPointMove();
      }
    });
    pointGizmo.addEventListener("objectChange", livePointGizmo);
    pointGizmo.getHelper().visible = false;
    scene.add(pointGizmo.getHelper());
    scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(20, 40, 30);
    scene.add(sun);
    grid = new THREE.GridHelper(64, 32, 0x4a5163, 0x2c313c);
    scene.add(grid);
    modelGroup = new THREE.Group();
    scene.add(modelGroup);
    scene.add(refGroup);
    rebuild();
    const loop = () => {
      frameId = requestAnimationFrame(loop);
      controls!.update();
      renderer!.render(scene!, camera!);
      updateGizmo();
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
          const shown = evaluate(!inEdit && cube.shapes?.length && cube.keyEdit === undefined ? blendShapeKeys(cube, keyWeights) : cube, "view"); // modifiers applied; the cage itself is untouched
          const m = meshOf(shown);
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute("position", new THREE.Float32BufferAttribute(m.positions, 3));
          geometry.setAttribute("normal", new THREE.Float32BufferAttribute(m.normals, 3));
          geometry.setAttribute("color", new THREE.Float32BufferAttribute(linear(m.colors), 4));
          geometry.setIndex(m.indices);
          if (useTexture) {
            // Painted shapes read their own texels; the others read the white row under the picture, so their colour shows as it is.
            const own = uvsOf(shown);
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
          const material = new THREE.MeshLambertMaterial({ vertexColors: true, map: useTexture ? threeTex : null, wireframe: viewMode === "wire", transparent: translucent || viewMode === "xray", opacity: viewMode === "xray" ? 0.35 : 1, depthWrite: viewMode !== "xray", side: cube.shape === "mesh" ? THREE.DoubleSide : THREE.FrontSide });
          const mesh = new THREE.Mesh(geometry, material);
          group.add(mesh);
          const skin = cube.shape === "mesh" && cube.skin ? { rest: new Float32Array(m.positions), pointOf: solidOf(cube).polys.flatMap((p) => p.v) } : undefined;
          let cage: { mesh: THREE.Mesh; polyOfTriangle: number[] } | undefined;
          if (shown !== cube && cube.shape === "mesh") {
            const c = meshOf(cube);
            const g = new THREE.BufferGeometry();
            g.setAttribute("position", new THREE.Float32BufferAttribute(c.positions, 3));
            g.setIndex(c.indices);
            const hidden = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
            group.add(hidden);
            cage = { mesh: hidden, polyOfTriangle: c.polyOfTriangle };
          }
          meshes.push({ mesh, path: { parts, cube: ci }, polyOfTriangle: m.polyOfTriangle, skin, cage });
        });
        parent.add(group);
        build(part.children, group, parts);
      });
    };
    build(doc.parts, modelGroup, []);
    applyPose();
    drawRings();
  }

  /// The model's collision circles, as green rings on the ground (in model units, like everything in the view).
  let rings: THREE.Group | undefined;
  function drawRings() {
    if (!scene) return;
    if (rings) {
      scene.remove(rings);
      rings.traverse((o) => {
        if (o instanceof THREE.Line) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      rings = undefined;
    }
    if (!doc.colliders?.length && !doc.capsules?.length && !doc.boxes?.length) return;
    rings = new THREE.Group();
    const outline = (points: THREE.Vector3[]) => {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0x4ade80, depthTest: false }));
      line.renderOrder = 6;
      rings!.add(line);
    };
    const arc = (cx: number, cz: number, r: number, from: number, to: number, steps = 24) => Array.from({ length: steps + 1 }, (_, i) => {
      const a = from + ((to - from) * i) / steps;
      return new THREE.Vector3(cx + Math.cos(a) * r, 0.05, cz + Math.sin(a) * r);
    });
    for (const c of doc.colliders ?? []) outline(arc(c.x, c.z, c.r, 0, Math.PI * 2, 48));
    for (const c of doc.capsules ?? []) {
      // the outline of a segment made thick: a half circle round each end and a straight side joining them
      const heading = Math.atan2(c.bz - c.az, c.bx - c.ax);
      const ring = [...arc(c.bx, c.bz, c.r, heading - Math.PI / 2, heading + Math.PI / 2), ...arc(c.ax, c.az, c.r, heading + Math.PI / 2, heading + (3 * Math.PI) / 2)];
      outline([...ring, ring[0]!]);
    }
    for (const b of doc.boxes ?? []) {
      // the box's own +z is (sin, cos) on the ground and its +x is (cos, -sin), as for a model turned by `ry`
      const t = (b.turn * Math.PI) / 180;
      const at = (u: number, v: number) => new THREE.Vector3(b.x + u * Math.cos(t) + v * Math.sin(t), 0.05, b.z - u * Math.sin(t) + v * Math.cos(t));
      outline([at(-b.hw, -b.hl), at(b.hw, -b.hl), at(b.hw, b.hl), at(-b.hw, b.hl), at(-b.hw, -b.hl)]);
    }
    scene.add(rings);
  }

  /// Puts every part where the clip says at the current time (or where it was authored, outside animate mode).
  function applyPose() {
    if (!modelGroup) return;
    const clip = mode === "animate" ? doc.clips?.[clipIndex] : undefined;
    // (constraints show only while animating: in the model view the parts stay as they are authored)
    const pose: Map<string, Pose> = clip ? constrainedPose(doc, samplePose(clip, animTime, false)) : new Map();
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
    drawBones();
  }

  // The skeleton overlay: a line from every part's pivot to its children's pivots, and a dot at each pivot (the chosen part's in yellow), drawn over the model.
  let showBones = $state(false);
  let showNormals = $state(false);
  let showStats = $state(false);
  const viewStats = $derived(showStats ? modelStats(doc) : null);
  let boneLines: THREE.Object3D | undefined;
  function drawBones() {
    if (boneLines && scene) {
      scene.remove(boneLines);
      boneLines.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        (m.material as THREE.Material | undefined)?.dispose();
      });
      boneLines = undefined;
    }
    const seamsHere = !!selected && !!cube?.seams?.length && (inEdit || mode === "texture");
    if (!(showBones || showNormals || seamsHere) || !scene || !groups.size) return;
    const overlay = new THREE.Group();
    if (seamsHere && selected && cube?.verts) {
      const g = groupOf(selected.parts);
      if (g) {
        const seg: THREE.Vector3[] = [];
        for (const [a, b] of cube.seams!) {
          const p = cube.verts[a];
          const q = cube.verts[b];
          if (p && q) seg.push(new THREE.Vector3(...p).applyMatrix4(g.matrixWorld), new THREE.Vector3(...q).applyMatrix4(g.matrixWorld));
        }
        const l = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(seg), new THREE.LineBasicMaterial({ color: 0xff5555, depthTest: false }));
        l.renderOrder = 18;
        overlay.add(l);
      }
    }
    if (showNormals && selected && cube) {
      const g = groupOf(selected.parts);
      const m = toMesh(cube);
      if (g && m.polys) {
        const seg: THREE.Vector3[] = [];
        m.polys.forEach((_, i) => {
          const c0 = faceCentre(m, i);
          const n = faceNormal(m, i);
          seg.push(new THREE.Vector3(...c0).applyMatrix4(g.matrixWorld), new THREE.Vector3(c0[0] + n[0] * 4, c0[1] + n[1] * 4, c0[2] + n[2] * 4).applyMatrix4(g.matrixWorld));
        });
        const l = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(seg), new THREE.LineBasicMaterial({ color: 0x6cb2ff, depthTest: false }));
        l.renderOrder = 19;
        overlay.add(l);
      }
    }
    if (!showBones) {
      scene.add(overlay);
      boneLines = overlay;
      return;
    }
    const world = new Map<string, THREE.Vector3>();
    for (const [key, g] of groups) world.set(key, g.group.getWorldPosition(new THREE.Vector3()));
    const chosen = selected ? pathKey(namesOf(doc, selected.parts)) : "";
    const lines: THREE.Vector3[] = [];
    for (const [key, at] of world) {
      const slash = key.lastIndexOf("/");
      const parent = slash > 0 ? world.get(key.slice(0, slash)) : undefined;
      if (parent) lines.push(parent, at);
    }
    if (lines.length) {
      const l = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(lines), new THREE.LineBasicMaterial({ color: 0x6fcf8e, depthTest: false }));
      l.renderOrder = 20;
      overlay.add(l);
    }
    const dots = new THREE.BufferGeometry().setFromPoints([...world.values()]);
    dots.setAttribute("color", new THREE.Float32BufferAttribute([...world.keys()].flatMap((k) => (k === chosen ? [1, 0.82, 0.4] : [0.8, 1, 0.85])), 3));
    const pts = new THREE.Points(dots, new THREE.PointsMaterial({ size: 8, sizeAttenuation: false, vertexColors: true, depthTest: false }));
    pts.renderOrder = 21;
    overlay.add(pts);
    scene.add(overlay);
    boneLines = overlay;
  }
  $effect(() => {
    showBones; showNormals; selected; doc; animTime; mode; inEdit;
    if (modelGroup) untrack(() => { modelGroup!.updateMatrixWorld(true); drawBones(); });
  });

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
    doc; viewMode; keyWeights; // redraw whenever the model changes or is shown another way
    if (modelGroup) untrack(rebuild);
  });
  // Local view: only the chosen part (and what is inside it) is drawn, to work on it without the rest in the way.
  let localView = $state(false);
  function applyLocalView() {
    const sel = selected;
    for (const e of meshes) {
      const inside = !!sel && sel.parts.length <= e.path.parts.length && sel.parts.every((v, i) => e.path.parts[i] === v);
      e.mesh.visible = !localView || !sel || inside;
      if (e.cage) e.cage.mesh.visible = e.mesh.visible;
    }
  }
  $effect(() => {
    doc; viewMode; localView; selected; // after a rebuild, or when the choice changes
    if (modelGroup) untrack(applyLocalView);
  });
  $effect(() => {
    selected; also;
    untrack(drawOutline);
  });
  $effect(() => {
    doc; selected; also; mode; inEdit; gizmoMode; snap; pivotMode;
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
      pointGizmo?.dispose();
      pointGizmo = undefined;
      stopNav?.();
      controls?.dispose();
      disposeMeshes();
      refRun++;
      for (const old of [...refGroup.children]) {
        refGroup.remove(old);
        (old as THREE.Mesh).geometry.dispose();
        ((old as THREE.Mesh).material as THREE.Material).dispose();
      }
      for (const t of refTextures.values()) t?.tex.dispose();
      refTextures.clear();
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
    if (also.length && pivotMode === "median") {
      // several shapes turn and resize about the middle of their middles, not about the first one's
      const sum = new THREE.Vector3();
      let n = 0;
      for (const p of pickedShapes) {
        const pc = cubeAt(doc, p);
        const pg = groupOf(p.parts);
        if (!pc || !pg || !hasVolume(pc)) continue;
        sum.add(new THREE.Vector3(pc.from[0] + pc.size[0] / 2, pc.from[1] + pc.size[1] / 2, pc.from[2] + pc.size[2] / 2).applyMatrix4(pg.matrixWorld));
        n++;
      }
      if (n) proxy.position.copy(g.worldToLocal(sum.divideScalar(n)));
    }
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
      if (mode === "animate" && clip && autoKey) {
        // recording: what the handle changed becomes a key at the time marker, and the model's own pose stays as it was
        const names = namesOf(doc, selected.parts);
        let next = doc;
        const was = (prop: Prop) => poseValue(prop);
        if (origin.some((v, i) => Math.abs(v - was("position")[i]!) > 0.005)) next = setKey(next, clipIndex, names, "position", animTime, origin);
        if (rotation.some((v, i) => Math.abs(v - was("rotation")[i]!) > 0.05)) next = setKey(next, clipIndex, names, "rotation", animTime, rotation);
        if (next !== doc) commit(next, false, "Key from handle");
        return;
      }
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
  // (`screen`: where the pointer was, for a stroke on the 3D view: see paintAlong)
  let stroke: { last: [number, number] | null; lastMirror: [number, number] | null; screen?: [number, number] } | null = null;
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
    remember();
    studio.markPending(filePath);
  }
  /// A stroke on the 3D view: the pointer's way across the screen since the last event, in steps of two pixels, each step
  /// cast onto the model and stamped where it lands. (Joining the hits with a line in the picture, as a stroke on the
  /// picture itself is joined, drew straight across the picture between pieces of the model that are not side by side in it.)
  function paintAlong(e: PointerEvent) {
    if (!stroke) return;
    const from = stroke.screen ?? [e.clientX, e.clientY];
    const [dx, dy] = [e.clientX - from[0], e.clientY - from[1]];
    const steps = stroke.screen ? Math.max(1, Math.ceil(Math.hypot(dx, dy) / 2)) : 1;
    let painted = false;
    for (let i = 1; i <= steps; i++) {
      const at = { clientX: from[0] + (dx * i) / steps, clientY: from[1] + (dy * i) / steps } as PointerEvent;
      const t = textureHit(at);
      if (t) {
        stroke.last = null;
        paintTexel(t[0], t[1], false, true);
        painted = true;
      }
      const m = mirrorPaint ? mirrorHit(at) : null;
      if (m) {
        stroke.lastMirror = null;
        paintTexel(m[0], m[1], true, true);
        painted = true;
      }
    }
    stroke.screen = [e.clientX, e.clientY];
    if (painted) pictureChanged();
  }
  function paintTexel(x: number, y: number, mirrored = false, quiet = false) {
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
    if (!quiet) pictureChanged();
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
  const texZoom = $derived(picture ? Math.max(1, Math.min(12, Math.floor(420 / picture.w))) : 1);
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
        if (texTool === "face" && c.shape === "mesh") {
          ctx.strokeStyle = "rgba(120,220,255,.8)";
          ctx.lineWidth = 1;
          for (const i of unwrap(c).islands ?? []) ctx.strokeRect((ax + i.x) * z + 0.5, (ay + i.y) * z + 0.5, i.w * z - 1, i.h * z - 1);
        }
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
      // a mesh: the island of its unwrap under the point
      for (const t of [...painted].reverse()) {
        if (t.c.shape !== "mesh") continue;
        const [ax, ay] = t.c.texture!.at;
        const isl = unwrap(t.c).islands?.find((i) => x >= ax + i.x && x < ax + i.x + i.w && y >= ay + i.y && y < ay + i.y + i.h);
        if (!isl) continue;
        selected = t.path;
        islandDrag = { path: t.path, base: doc, cube: t.c, poly: isl.poly, from: [x, y], at: [isl.x, isl.y], moved: false };
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
  let islandDrag: { path: Path; base: ModelDoc; cube: Cube; poly: number; from: [number, number]; at: [number, number]; moved: boolean } | null = null;
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
    if (islandDrag) {
      const at: [number, number] = [Math.max(0, islandDrag.at[0] + x - islandDrag.from[0]), Math.max(0, islandDrag.at[1] + y - islandDrag.from[1])];
      if (!islandDrag.moved && at[0] === islandDrag.at[0] && at[1] === islandDrag.at[1]) return;
      if (!islandDrag.moved) history.record(islandDrag.base);
      islandDrag.moved = true;
      commit(setCube(islandDrag.base, islandDrag.path, moveIsland(islandDrag.cube, islandDrag.poly, at)), true);
      return;
    }
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
    islandDrag = null;
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
    if (channel !== "colour") setChannel("colour");
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
    otherLayers = otherLayers.map((o) => (o ? resizeTexture(doc, o, w, h).picture : null));
    if (surface) surface = resizeTexture(doc, surface, w, h).picture;
    if (normalMap) {
      // a baked normal map follows the layout: after a new size it has to be baked again
      normalMap = null;
      if (r.doc.texture) r.doc.texture.normals = undefined;
    }
    if (colourStash) colourStash = resizeTexture(doc, colourStash, w, h).picture;
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
  function setSmoothTexels(on: boolean) {
    if (!doc.texture) return;
    commit({ ...doc, texture: { ...doc.texture, smooth: on || undefined } });
    syncTexture();
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
  function clearHandles() {
    for (const o of [handles, faceLine, edgeLines, edgeSel]) {
      if (!o) continue;
      scene?.remove(o);
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
    handles = faceLine = edgeLines = edgeSel = undefined;
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
    const mask = cube.mask && cube.mask.length === pts.length ? cube.mask : null;
    const shade = (c: number[], i: number) => (mask && mask[i]! > 0 && !chosen.has(i) ? c.map((v) => v * (1 - 0.85 * mask[i]!)) : c);
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(pts.flatMap((_, i) => shade(chosen.has(i) ? [1, 0.82, 0.4] : heat ? heatColor(heat[i]!) : holder ? BONE_COLORS[holder[i]! % BONE_COLORS.length]! : [0.9, 0.93, 1], i)), 3));
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
    }
  }

  // ---- moving points: a move handle on the picked points, and what a move shows while it happens ------------------------------
  // The picked points carry a move handle like a shape's: drag an arrow to move along that axis only, a square to move on that flat plane.
  // (Its free centre is taken off: a point dragged by itself moves on the grid plane the camera faces most; see freeDragTo.) While points
  // move, coloured lines show the axes they may move along, a grey dot stays where they started, and a label by them says what changes.
  let pointGizmo: TransformControls | undefined;
  let pointProxy: THREE.Object3D | undefined;
  let gizmoMove: (PointMove & { start: THREE.Vector3 }) | null = null;
  let guides: THREE.Object3D[] = [];
  let moveHint = $state<{ x: number; y: number; text: string; how: string } | null>(null);
  let snapRing = $state<{ x: number; y: number } | null>(null);

  /// Takes the handle's free centre off (its "XYZ" piece, which moves on a plane facing the camera).
  function stripFreeHandle(t: TransformControls) {
    const g = (t as unknown as { _gizmo?: { gizmo: Record<string, THREE.Object3D>; picker: Record<string, THREE.Object3D> } })._gizmo;
    for (const set of [g?.gizmo.translate, g?.picker.translate]) for (const c of [...(set?.children ?? [])]) if (c.name === "XYZ") c.removeFromParent();
  }
  function attachPointGizmo() {
    if (!pointGizmo || gizmoMove) return; // (while it is dragged it stays where it is)
    pointGizmo.detach();
    pointProxy?.removeFromParent();
    pointProxy = undefined;
    const live = inEdit && !!selected && !!cube?.verts && selVerts.length > 0;
    pointGizmo.getHelper().visible = live;
    if (!live) return;
    const g = groupOf(selected!.parts);
    if (!g) return;
    pointProxy = new THREE.Object3D();
    pointProxy.position.set(...centreOf(cube!.verts as Vec3[], selVerts));
    g.add(pointProxy);
    pointProxy.updateMatrixWorld();
    pointGizmo.attach(pointProxy);
  }
  function beginPointGizmo() {
    if (!pointProxy || !selected || !cube?.verts) return;
    gizmoMove = { base: doc, baseCube: cube, path: selected, from: centreOf(cube.verts as Vec3[], selVerts), start: pointProxy.position.clone(), moved: false };
  }
  /// The handle's axis or plane as a lock ("X" is "x", "XZ" is "xz").
  const handleLock = (axis: string | null): Lock => (axis && /^[XYZ]{1,2}$/.test(axis) ? (axis.toLowerCase() as Lock) : "xyz");
  function livePointGizmo() {
    if (!gizmoMove || !pointProxy) return;
    const raw = pointProxy.position.clone().sub(gizmoMove.start);
    const lock = handleLock(pointGizmo?.axis ?? null);
    movePointsBy(gizmoMove, constrain([raw.x, raw.y, raw.z], lock, snap ? 1 : null, gizmoMove.from), lock, false);
  }
  /// Moves the picked points of a move's shape by `delta` (from where they were when it began), and shows the move.
  function movePointsBy(m: PointMove, delta: Vec3, lock: Lock, free: boolean) {
    showMove(m, delta, lock, free);
    if (!m.moved && delta.every((d) => d === 0)) return;
    if (!m.moved) history.record(m.base);
    m.moved = true;
    commit(setCube(m.base, m.path, symmetry === "off" ? (proportional ? moveVertsProportional(m.baseCube, selVerts, delta, propRadius) : moveVerts(m.baseCube, selVerts, delta)) : moveVertsSymmetric(m.baseCube, selVerts, delta, Number(symmetry) as Axis)), true);
  }
  /// Where a point in the world is on the page.
  function screenOf(w: THREE.Vector3): { x: number; y: number } | null {
    if (!camera || !canvas) return null;
    const r = canvas.getBoundingClientRect();
    const p = w.clone().project(camera);
    if (p.z > 1) return null;
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  }
  function clearGuides() {
    for (const o of guides) {
      o.removeFromParent();
      const any = o as THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material };
      any.geometry?.dispose();
      any.material?.dispose();
    }
    guides = [];
  }
  /// The lines a move may follow (one per axis it may change, in that axis's colour, through where it started), a grey dot where it
  /// started, and the label by the moved points.
  function showMove(m: PointMove, delta: Vec3, lock: Lock, free: boolean) {
    const g = groupOf(m.path.parts);
    if (!g || !scene) return;
    if (!guides.length || (guides[0]!.userData.lock as string) !== lock) {
      clearGuides();
      const axes = lock === "xyz" ? [] : [0, 1, 2].filter((i) => lock.includes(AXIS_NAMES[i]!));
      for (const i of axes) {
        const a = [...m.from] as Vec3, b = [...m.from] as Vec3;
        a[i] = a[i]! - 400;
        b[i] = b[i]! + 400;
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a).applyMatrix4(g.matrixWorld), new THREE.Vector3(...b).applyMatrix4(g.matrixWorld)]), new THREE.LineBasicMaterial({ color: AXIS_COLOURS[i], transparent: true, opacity: 0.85, depthTest: false }));
        line.renderOrder = 13;
        scene.add(line); // (in the world: the part's group is made again with every change while the points move)
        guides.push(line);
      }
      const ghost = new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...m.from).applyMatrix4(g.matrixWorld)]), new THREE.PointsMaterial({ size: 11, sizeAttenuation: false, color: 0x8b93a3, transparent: true, opacity: 0.8, depthTest: false }));
      ghost.renderOrder = 9;
      scene.add(ghost);
      guides.push(ghost);
      guides[0]!.userData.lock = lock;
    }
    const at = screenOf(new THREE.Vector3(m.from[0] + delta[0], m.from[1] + delta[1], m.from[2] + delta[2]).applyMatrix4(g.matrixWorld));
    const how = lock === "xyz" ? "" : `Moving ${describeLock(lock)}${free ? " · X, Y or Z keeps to one axis, ⇧ with it to a plane · Esc puts it back" : ""}`;
    moveHint = at ? { x: at.x, y: at.y, text: describeMove(m.from, delta), how } : null;
  }
  function endPointMove() {
    clearGuides();
    moveHint = null;
    snapRing = null;
    if (controls) controls.enabled = true;
    attachPointGizmo();
  }
  /// Esc while points are dragged: they go back to where they were.
  function cancelPointMove() {
    const m = drag ?? gizmoMove;
    if (!m) return;
    if (m.moved) {
      commit(m.base, true);
      history.drop();
    }
    if (gizmoMove) {
      gizmoMove = null;
      pointGizmo?.detach(); // (lets go of the handle; attachPointGizmo puts a fresh one on)
    }
    drag = null;
    gizmoDown = false;
    endPointMove();
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
  // a point dragged by itself: where it started (in the world, and in the part's units), the plane it is free on and the lock it keeps to now
  type PointMove = { base: ModelDoc; baseCube: Cube; path: Path; from: Vec3; moved: boolean };
  let drag: (PointMove & { point: number; start: THREE.Vector3; free: Lock; lock: Lock; last: PointerEvent }) | null = null;
  function pointerDown(e: PointerEvent) {
    if (bevelModal) return void endBevel(true);
    if (pullModal) return void endPullModal(true);
    downAt = [e.clientX, e.clientY];
    if (mode === "texture" && BRUSH_TOOLS.includes(texTool) && picture && e.button === 0 && !e.altKey && canvas) {
      const t = textureHit(e);
      if (t) {
        beginStroke(false);
        if (texTool === "picker" || texTool === "fill") {
          paintTexel(t[0], t[1]);
          const m = mirrorPaint ? mirrorHit(e) : null;
          if (m) paintTexel(m[0], m[1], true);
        } else paintAlong(e);
        controls!.enabled = false;
        canvas.setPointerCapture(e.pointerId);
        return;
      }
    }
    if (!inEdit || !camera || !canvas || !selected || !cube || e.button !== 0) return void startMarquee(e);
    if (sculpting || weightPainting) {
      const at = sculptPoint(e);
      if (!at) return;
      history.record(doc, weightPainting ? `Paint weights (${weightMode})` : `Sculpt (${sculptMode})`);
      sculptStroke = { path: selected, last: at, fresh: true };
      controls!.enabled = false;
      canvas.setPointerCapture(e.pointerId);
      sculptAt(e);
      return;
    }
    if (boxArmed) {
      // a rubber band: everything inside it is picked when the button comes up
      const r = canvas.getBoundingClientRect();
      rubber = { x0: e.clientX - r.left, y0: e.clientY - r.top, x1: e.clientX - r.left, y1: e.clientY - r.top, add: e.shiftKey };
      controls!.enabled = false;
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    // (an arrow or square of the points' move handle is its own business)
    if (pointGizmo?.axis) return;
    const point = pickVert(e);
    if (point < 0) return void startMarquee(e);
    if (e.shiftKey) selVerts = selVerts.includes(point) ? selVerts.filter((v) => v !== point) : [...selVerts, point];
    else if (!selVerts.includes(point)) selVerts = [point];
    selFace = null;
    selEdge = null;
    if (!selVerts.includes(point)) return;
    const g = groupOf(selected.parts);
    if (!g) return;
    // a point dragged by itself moves on the grid plane the camera faces most (the floor from above, a wall from the front), in the
    // part's own axes; X, Y or Z while dragging keeps it to one axis
    const view = camera.getWorldDirection(new THREE.Vector3()).applyMatrix3(new THREE.Matrix3().setFromMatrix4(g.matrixWorld.clone().invert()));
    const free = freePlane([view.x, view.y, view.z]);
    drag = { point, base: doc, baseCube: cube, path: selected, start: worldVerts()[point]!, from: [...cube.verts![point]!] as Vec3, free, lock: free, moved: false, last: e };
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
  /// Box select (B): drag a rectangle over the view; the points inside it are picked (Shift adds to the ones already picked). Points behind others count too.
  let boxArmed = $state(false);
  // sculpting: brushes that push, smooth and drag the points of the chosen mesh (one undo step a stroke)
  let sculpting = $state(false);
  let sculptMode = $state<SculptMode>("draw");
  let sculptRadius = $state(3);
  let sculptStrength = $state(0.5);
  let sculptSymmetry = $state(false);
  // weight painting: the same brush, but it paints how strongly the chosen part holds the points (the colours show it)
  let weightPainting = $state(false);
  let weightMode = $state<WeightMode>("add");
  let sculptStroke: { path: Path; last: Vec3; fresh: boolean } | null = null;
  // a pen's pressure scales the strength; dynamic detail splits the polygons under the brush that are longer than the detail size (units) before each dab
  let sculptPressure = $state(true);
  let sculptDynamic = $state(false);
  let sculptDetail = $state(1.5);
  let sculptRing: THREE.Mesh | undefined;
  /// Where the pointer's ray meets the chosen shape: the point in the shape's own space and the way the surface faces there in the world.
  function sculptHit(e: PointerEvent): { local: Vec3; point: THREE.Vector3; normal: THREE.Vector3 } | null {
    if (!camera || !canvas || !selected) return null;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(pointer(e), camera);
    const mine = meshes.filter((m) => m.path.cube === selected!.cube && m.path.parts.join(",") === selected!.parts.join(","));
    const hit = ray.intersectObjects(mine.map((m) => m.mesh), false)[0];
    const g = groupOf(selected.parts);
    if (!hit || !g) return null;
    const local = g.worldToLocal(hit.point.clone());
    const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
    return { local: [local.x, local.y, local.z], point: hit.point.clone(), normal };
  }
  /// The ring that shows the brush's size on the surface under the pointer (hidden when the brush is not in use or nothing is under it).
  function updateRing(e: PointerEvent | null) {
    const hit = e && scene && inEdit && (sculpting || weightPainting) ? sculptHit(e) : null;
    if (!hit || !scene) {
      if (sculptRing) sculptRing.visible = false;
      return;
    }
    if (!sculptRing) {
      sculptRing = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 64), new THREE.MeshBasicMaterial({ color: 0xffd166, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthTest: false }));
      sculptRing.renderOrder = 13;
      scene.add(sculptRing);
    }
    const g = selected ? groupOf(selected.parts) : undefined;
    const k = g ? g.getWorldScale(new THREE.Vector3()).x : 1;
    sculptRing.visible = true;
    sculptRing.position.copy(hit.point).addScaledVector(hit.normal, 0.05 * k);
    sculptRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hit.normal);
    sculptRing.scale.setScalar(Math.max(1e-3, sculptRadius * k));
  }
  /// Where the pointer's ray meets the chosen shape, in that shape's own space.
  const sculptPoint = (e: PointerEvent): Vec3 | null => sculptHit(e)?.local ?? null;
  function sculptAt(e: PointerEvent) {
    if (!sculptStroke) return;
    const at = sculptPoint(e);
    if (!at) return;
    let c = cubeAt(doc, sculptStroke.path);
    if (!c) return;
    const pressure = sculptPressure && e.pointerType === "pen" ? Math.max(0.1, e.pressure) : 1;
    const delta: Vec3 = [at[0] - sculptStroke.last[0], at[1] - sculptStroke.last[1], at[2] - sculptStroke.last[2]];
    // a dab only when the pointer has moved a little (a third of the brush) or on the first touch
    const moved = Math.hypot(...delta);
    if (!sculptStroke.fresh && moved < sculptRadius / 3 && sculptMode !== "grab") return;
    sculptStroke.fresh = false;
    if (weightPainting) {
      const bone = skinBone || c.skin?.bones[0] || "";
      if (!bone) return;
      commit(setCube(doc, sculptStroke.path, paintWeights(c, at, { bone, mode: weightMode, radius: sculptRadius, strength: sculptStrength * pressure, ...(paintOnlyPicked && selVerts.length ? { only: new Set(selVerts) } : {}) })), true);
      const painted = cubeAt(doc, sculptStroke.path)?.skin?.bones.indexOf(bone) ?? -1;
      if (painted >= 0) heatBone = painted;
      sculptStroke.last = at;
      return;
    }
    if (sculptMode === "mask") {
      commit(setCube(doc, sculptStroke.path, maskDab(c, at, { radius: sculptRadius, strength: sculptStrength * pressure, erase: e.ctrlKey || e.metaKey, symmetryX: sculptSymmetry })), true);
      sculptStroke.last = at;
      return;
    }
    if (sculptDynamic && sculptMode !== "smooth") {
      if (c.shapes?.length) {
        selectNote = "Dynamic detail changes the points, so it cannot be used on a shape with layers or shape keys: add the detail first, then the layers.";
      } else {
        c = refineUnder(c, at, sculptRadius, Math.max(0.05, sculptDetail));
      }
    }
    const next = sculptDab(c, sculptMode === "grab" ? sculptStroke.last : at, { mode: sculptMode, radius: sculptRadius, strength: sculptStrength, pressure, invert: e.ctrlKey || e.metaKey, symmetryX: sculptSymmetry }, delta);
    commit(setCube(doc, sculptStroke.path, next), true);
    sculptStroke.last = at;
  }
  /// A click anywhere but the Detail · Mask · Layers pop-over closes it.
  function closeSculptMore(e: PointerEvent) {
    for (const d of document.querySelectorAll("details.sculptmore[open]")) if (!d.contains(e.target as Node)) d.removeAttribute("open");
  }
  function maskDo(change: (c: Cube) => Cube) {
    if (!cube || !selected) return;
    commit(setCube(doc, selected, change(cube)), false, "Sculpt mask");
  }
  function splitAll() {
    if (!cube || !selected) return;
    if (cube.shapes?.length) return void (selectNote = "Adding detail changes the points, so it cannot be done once the shape has layers or shape keys.");
    const next = refineUnder(cube, [0, 0, 0], 1e9, 0);
    if (next === cube) return void (selectNote = "The shape has too many points to split again.");
    commit(setCube(doc, selected, next), false, "Add detail");
  }
  function setSculptLayer(name: string) {
    if (!cube || !selected) return;
    const base = cube.keyEdit !== undefined ? endKeyEdit(cube) : cube;
    commit(setCube(doc, selected, name ? beginKeyEdit(base, name) : base), false, name ? `Sculpt layer "${name}"` : "Sculpt the base shape");
  }
  function newSculptLayer() {
    if (!cube || !selected) return;
    const base = cube.keyEdit !== undefined ? endKeyEdit(cube) : cube;
    let n = 1;
    while (base.shapes?.some((k) => k.name === `layer${n}`)) n++;
    const name = `layer${n}`;
    const added = addShapeKey(base, name);
    if (added === base) return void (selectNote = `At most ${MAX_SHAPE_KEYS} layers.`);
    commit(setCube(doc, selected, beginKeyEdit(added, name)), false, `New sculpt layer "${name}"`);
  }
  let rubber = $state<{ x0: number; y0: number; x1: number; y1: number; add: boolean } | null>(null);
  /// On a trackpad a drag on empty space is a selection rectangle (two fingers turn the view): points in point mode, shapes otherwise. A rectangle too small to
  /// be a drag is a click and goes on to the ordinary click.
  function startMarquee(e: PointerEvent) {
    if (input.navigation !== "trackpad" || e.button !== 0 || !canvas || !camera || mode !== "model" || modal || rubber || pull || drag || gizmoDown || e.altKey) return;
    if (pointGizmo?.axis || gizmo?.axis) return;
    const r = canvas.getBoundingClientRect();
    rubber = { x0: e.clientX - r.left, y0: e.clientY - r.top, x1: e.clientX - r.left, y1: e.clientY - r.top, add: e.shiftKey };
    controls!.enabled = false;
    canvas.setPointerCapture(e.pointerId);
  }
  function finishBox() {
    const b = rubber;
    rubber = null;
    boxArmed = false;
    if (controls) controls.enabled = true;
    if (!b || !camera || !canvas) return;
    if (Math.abs(b.x1 - b.x0) < 4 && Math.abs(b.y1 - b.y0) < 4) return;
    const r = canvas.getBoundingClientRect();
    if (!inEdit) {
      // shapes whose middle is inside the rectangle
      const [x0, x1] = [Math.min(b.x0, b.x1), Math.max(b.x0, b.x1)];
      const [y0, y1] = [Math.min(b.y0, b.y1), Math.max(b.y0, b.y1)];
      const found: Path[] = [];
      for (const m of meshes) {
        const q = new THREE.Box3().setFromObject(m.mesh).getCenter(new THREE.Vector3()).project(camera);
        const x = ((q.x + 1) / 2) * r.width;
        const y = ((1 - q.y) / 2) * r.height;
        if (q.z <= 1 && x >= x0 && x <= x1 && y >= y0 && y <= y1 && !found.some((p) => samePath(p, m.path))) found.push(m.path);
      }
      const all = b.add ? [...pickedShapes, ...found.filter((p) => !isPicked(p))] : found;
      selected = all[0] ?? null;
      also = all.slice(1);
      return;
    }
    if (!cube?.verts) return;
    const [x0, x1] = [Math.min(b.x0, b.x1), Math.max(b.x0, b.x1)];
    const [y0, y1] = [Math.min(b.y0, b.y1), Math.max(b.y0, b.y1)];
    const picked: number[] = [];
    worldVerts().forEach((w, i) => {
      const q = w.clone().project(camera!);
      if (q.z > 1) return;
      const x = ((q.x + 1) / 2) * r.width;
      const y = ((1 - q.y) / 2) * r.height;
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) picked.push(i);
    });
    // with only edges on, an edge counts when both its ends are inside; with only faces on, a face counts when its middle is; otherwise it is the points
    let found = picked;
    const inside = new Set(picked);
    const onlyEdges = pickKinds.edge && !pickKinds.vertex && !pickKinds.face;
    const onlyFaces = pickKinds.face && !pickKinds.vertex && !pickKinds.edge;
    if (onlyEdges) found = [...new Set(edgesOf(cube).filter((ed) => inside.has(ed.a) && inside.has(ed.b)).flatMap((ed) => [ed.a, ed.b]))];
    else if (onlyFaces) {
      const w = worldVerts().map((p) => p.clone().project(camera!));
      const mids = (cube.polys ?? []).flatMap((pl) => {
        const q = pl.v.reduce<[number, number]>((t, i) => [t[0] + w[i]!.x, t[1] + w[i]!.y], [0, 0]);
        const [mx, my] = [((q[0] / pl.v.length + 1) / 2) * r.width, ((1 - q[1] / pl.v.length) / 2) * r.height];
        return mx >= x0 && mx <= x1 && my >= y0 && my <= y1 ? [pl.v] : [];
      });
      found = [...new Set(mids.flat())];
    }
    selVerts = b.add ? [...new Set([...selVerts, ...found])] : found;
    selFace = null;
    selEdge = null;
  }

  // a highlight on what a click would pick: the point, the edge or the face under the pointer (the kinds that are on, a point before an edge before a face)
  let hoverObjs: THREE.Object3D[] = [];
  let hoverKey = "";
  function clearHover() {
    for (const o of hoverObjs) {
      scene?.remove(o);
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
    }
    hoverObjs = [];
    hoverKey = "";
  }
  function updateHover(e: PointerEvent | null) {
    const live = !!e && !!scene && !!camera && inEdit && !!cube?.verts && !sculpting && !weightPainting && !modal && !drag && !pull && !rubber && !boxArmed && !bevelModal && !pullModal && mode === "model";
    if (!live || !e) return void (hoverObjs.length && clearHover());
    let key = "";
    let kind: "v" | "e" | "f" | null = null;
    let vert = -1;
    let edge: [number, number] | null = null;
    let face = -1;
    if (pickKinds.vertex && (vert = pickVert(e)) >= 0) {
      kind = "v";
      key = `v${vert}`;
    } else if (pickKinds.edge && (edge = pickEdge(e))) {
      kind = "e";
      key = `e${edge[0]},${edge[1]}`;
    } else if (pickKinds.face && selected && camera) {
      const ray = new THREE.Raycaster();
      ray.setFromCamera(pointer(e), camera);
      const mine = meshes.find((m) => samePath(m.path, selected!));
      const pk = mine?.cage ?? mine;
      const hit = pk ? ray.intersectObject(pk.mesh, false)[0] : undefined;
      const f = hit?.faceIndex != null ? pk!.polyOfTriangle[hit.faceIndex] : undefined;
      if (f !== undefined) {
        kind = "f";
        face = f;
        key = `f${f}`;
      }
    }
    if (key === hoverKey) return;
    clearHover();
    hoverKey = key;
    if (!kind || !scene || !cube?.verts) return;
    const pts = worldVerts();
    const colour = 0x7fd1ff;
    if (kind === "v") {
      const g = new THREE.BufferGeometry().setFromPoints([pts[vert]!]);
      const o = new THREE.Points(g, new THREE.PointsMaterial({ color: colour, size: 16, sizeAttenuation: false, depthTest: false, transparent: true, opacity: 0.9 }));
      o.renderOrder = 14;
      hoverObjs.push(o);
    } else if (kind === "e" && edge) {
      const o = new THREE.Line(new THREE.BufferGeometry().setFromPoints([pts[edge[0]]!, pts[edge[1]]!]), new THREE.LineBasicMaterial({ color: colour, depthTest: false, transparent: true, opacity: 0.95 }));
      o.renderOrder = 14;
      hoverObjs.push(o);
    } else if (kind === "f") {
      const poly = cube.polys?.[face];
      if (poly) {
        const ring = poly.v.map((i) => pts[i]!);
        const fill = new THREE.BufferGeometry().setFromPoints(ring.flatMap((p, i) => (i >= 1 && i < ring.length - 1 ? [ring[0]!, ring[i]!, ring[i + 1]!] : [])));
        const area = new THREE.Mesh(fill, new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.28, depthTest: false, side: THREE.DoubleSide }));
        area.renderOrder = 13;
        const edgeLine = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ring), new THREE.LineBasicMaterial({ color: colour, depthTest: false }));
        edgeLine.renderOrder = 14;
        hoverObjs.push(area, edgeLine);
      }
    }
    for (const o of hoverObjs) scene.add(o);
  }
  function pointerMove(e: PointerEvent) {
    updateRing(e);
    updateHover(e);
    if (bevelModal) return void moveBevel(e);
    if (rubber && canvas) {
      const r = canvas.getBoundingClientRect();
      rubber = { ...rubber, x1: e.clientX - r.left, y1: e.clientY - r.top };
      return;
    }
    if (stroke && mode === "texture") {
      if (texTool !== "picker" && texTool !== "fill") paintAlong(e);
      return;
    }
    if (sculptStroke) {
      sculptAt(e);
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
    drag.last = e;
    freeDragTo(e);
  }
  /// The free drag of a point, to where the pointer is: along its locked axis, or on its plane, in the part's own axes.
  function freeDragTo(e: PointerEvent) {
    if (!drag || !camera) return;
    const g = groupOf(drag.path.parts);
    if (!g) return;
    const toWorld = new THREE.Matrix3().setFromMatrix4(g.matrixWorld);
    const axisWorld = (i: number) => new THREE.Vector3(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0).applyMatrix3(toWorld).normalize();
    let moved: THREE.Vector3 | null = null;
    if (drag.lock.length === 1) {
      const dir = axisWorld(AXIS_NAMES.indexOf(drag.lock as "x"));
      const t = lineParameter(e, drag.start, dir);
      if (t !== null) moved = dir.multiplyScalar(t);
    } else {
      const across = [0, 1, 2].find((i) => !drag!.lock.includes(AXIS_NAMES[i]!))!;
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axisWorld(across), drag.start);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(pointer(e), camera);
      const hit = ray.ray.intersectPlane(plane, new THREE.Vector3());
      if (hit) moved = hit.sub(drag.start);
    }
    if (!moved) return;
    const local = moved.applyMatrix3(new THREE.Matrix3().setFromMatrix4(g.matrixWorld.clone().invert()));
    let delta = constrain([local.x, local.y, local.z], drag.lock, snap ? 1 : null, drag.from);
    // onto another point that is close on screen (only while the drag is free: a locked drag keeps to its axis); a ring shows which
    const near = snapPoints && drag.lock === drag.free ? nearestPoint(e, drag.baseCube, new Set(selVerts), g) : null;
    snapRing = near ? screenOf(new THREE.Vector3(...near).applyMatrix4(g.matrixWorld)) : null;
    if (near) delta = [near[0] - drag.from[0], near[1] - drag.from[1], near[2] - drag.from[2]];
    movePointsBy(drag, delta, drag.lock, true);
  }
  function pointerUp(e: PointerEvent) {
    if (rubber) {
      const small = Math.abs(rubber.x1 - rubber.x0) < 4 && Math.abs(rubber.y1 - rubber.y0) < 4;
      finishBox();
      if (!small) {
        downAt = null;
        return;
      }
    }
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
    if (sculptStroke) {
      sculptStroke = null;
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
      endPointMove();
      return;
    }
    if (!downAt || !camera || !canvas) return;
    const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
    downAt = null;
    if (moved > 4) return;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(pointer(e), camera);
    if (inEdit && selected) {
      const edge = pickKinds.edge ? pickEdge(e) : null;
      if (edge) {
        selEdge = edge;
        selFace = null;
        selVerts = [...edge];
        canvas.focus();
        return;
      }
      selEdge = null;
      const mine = meshes.find((m) => samePath(m.path, selected));
      const pick = mine?.cage ?? mine;
      const hit = pick ? ray.intersectObject(pick.mesh, false)[0] : undefined;
      const face = pickKinds.face && hit?.faceIndex != null ? pick!.polyOfTriangle[hit.faceIndex] : undefined;
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
    ortho = false;
    if (camera) {
      camera.fov = PERSPECTIVE_FOV;
      camera.up.set(0, 1, 0);
      camera.updateProjectionMatrix();
    }
    camera?.position.set(34, 28, 46);
    controls?.target.set(0, 8, 0);
  }

  // ---- reference pictures (blueprints to trace; kept per model on this computer, not in the file) -----------------
  let references = $state.raw<Reference[]>(loadReferences(untrack(() => filePath)));
  const refGroup = new THREE.Group();
  const refTextures = new Map<string, { tex: THREE.Texture; aspect: number } | null>();
  async function refTexture(path: string) {
    if (refTextures.has(path)) return refTextures.get(path)!;
    try {
      const url = await studio.api!.readImage(path);
      const tex = await new THREE.TextureLoader().loadAsync(url);
      tex.colorSpace = THREE.SRGBColorSpace;
      const img = tex.image as { width: number; height: number };
      const entry = { tex, aspect: img.width / Math.max(1, img.height) };
      refTextures.set(path, entry);
      return entry;
    } catch {
      refTextures.set(path, null);
      return null;
    }
  }
  let refRun = 0;
  async function syncReferences(list: Reference[]) {
    const run = ++refRun;
    const built: THREE.Mesh[] = [];
    for (const r of list) {
      if (!r.visible) continue;
      const t = await refTexture(r.path);
      if (!t) continue;
      const pl = placementOf(r, t.aspect);
      const mat = new THREE.MeshBasicMaterial({ map: t.tex, transparent: true, opacity: r.opacity, side: THREE.DoubleSide, depthWrite: false, depthTest: !r.front });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      mesh.scale.set(pl.flip ? -pl.width : pl.width, pl.height, 1);
      mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...pl.axes.x), new THREE.Vector3(...pl.axes.y), new THREE.Vector3(...pl.axes.z)));
      mesh.position.set(...pl.position);
      mesh.renderOrder = r.front ? 10 : -10;
      built.push(mesh);
    }
    if (run !== refRun) {
      for (const m of built) (m.geometry.dispose(), (m.material as THREE.Material).dispose());
      return;
    }
    for (const old of [...refGroup.children]) {
      refGroup.remove(old);
      const m = old as THREE.Mesh;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    for (const m of built) refGroup.add(m);
  }
  $effect(() => {
    const list = references;
    void syncReferences(list);
    saveReferences(untrack(() => filePath), list);
  });

  async function exportObj() {
    const name = filePath.slice(filePath.lastIndexOf("/") + 1).replace(/\.model\.json$/i, "").replace(/[^A-Za-z0-9_-]+/g, "_");
    const path = `exports/${name}.obj`;
    try {
      await studio.api!.writeExport(path, `data:text/plain;base64,${toBase64(new TextEncoder().encode(modelToObj(doc)))}`);
      await studio.refreshFiles();
      studio.say("info", `Saved ${path}.`);
    } catch (e) {
      studio.say("error", String(e));
    }
  }

  // ---- standard views (Blender's numpad views, with commands for a laptop) ----------------------------------
  /// A very narrow field of view from far away stands in for an orthographic camera, so the gizmos and picking, which belong to this camera, keep working.
  let ortho = $state(false);
  let viewName = $state<ViewName | null>(null);
  function setOrtho(on: boolean) {
    if (!camera || !controls || on === ortho) return;
    const d = camera.position.distanceTo(controls.target);
    const dir = camera.position.clone().sub(controls.target).normalize();
    const next = distanceForFov(d, camera.fov, on ? ORTHO_FOV : PERSPECTIVE_FOV);
    camera.fov = on ? ORTHO_FOV : PERSPECTIVE_FOV;
    camera.far = Math.max(2000, next * 2);
    camera.updateProjectionMatrix();
    camera.position.copy(controls.target).add(dir.multiplyScalar(next));
    ortho = on;
  }
  // The axis gizmo in the corner of the view: the six ends of X, Y and Z as the camera sees them; click one for that view.
  let axisDots = $state<GizmoDot[]>(gizmoDots([1, 0, 0], [0, 1, 0], [0, 0, 1]));
  let dotsKey = "";
  function updateGizmo() {
    if (!camera) return;
    const m = camera.matrixWorld.elements;
    const next = gizmoDots([m[0]!, m[1]!, m[2]!], [m[4]!, m[5]!, m[6]!], [m[8]!, m[9]!, m[10]!]);
    const key = next.map((d) => d.x.toFixed(2) + d.y.toFixed(2)).join();
    if (key === dotsKey) return;
    dotsKey = key;
    axisDots = next;
  }
  function showView(name: ViewName) {
    if (!camera || !controls) return;
    const d = camera.position.distanceTo(controls.target);
    const v = viewPlacement(name, [controls.target.x, controls.target.y, controls.target.z], d);
    camera.position.set(...v.position);
    camera.up.set(...v.up);
    camera.lookAt(controls.target);
    viewName = name;
  }
  function orbit(dAz: number, dEl: number) {
    if (!camera || !controls) return;
    const p = orbitStep([camera.position.x, camera.position.y, camera.position.z], [controls.target.x, controls.target.y, controls.target.z], dAz, dEl);
    camera.up.set(0, 1, 0);
    camera.position.set(...p);
    camera.lookAt(controls.target);
    viewName = null;
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
    untrack(attachPointGizmo);
  });
  const part = $derived(selected && selected.cube === undefined ? partAt(doc, selected.parts) : selected ? partAt(doc, selected.parts) : undefined);
  const myConstraints = $derived(part?.constraints ?? []);

  function newPart(parent: number[]) {
    const r = addPart(doc, parent);
    commit(r.doc);
    selected = r.path;
    also = [];
  }
  // The right-hand column (outliner above properties) can be dragged wider or narrower; the width is remembered, one for painting and one for the rest.
  const widthKey = $derived(mode === "texture" ? "model.right.texture" : "model.right");
  let widthTick = $state(0);
  const rightWidth = $derived(widthTick >= 0 ? (savedSize(widthKey) ?? (mode === "texture" ? 380 : 300)) : 300);
  const setRightWidth = (w: number) => {
    rememberSize(widthKey, Math.max(200, Math.min(700, w)));
    widthTick++;
  };
  let split: { x: number; w: number } | null = null;
  const splitDown = (e: PointerEvent) => {
    split = { x: e.clientX, w: rightWidth };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const splitMove = (e: PointerEvent) => {
    if (split) setRightWidth(split.w - (e.clientX - split.x));
  };
  const splitUp = () => (split = null);
  // The mode switch (as in Blender's header): one choice that sets the editor's separate switches together.
  type UiMode = "object" | "edit" | "sculpt" | "weights" | "texture" | "pose";
  const UI_MODES: { id: UiMode; title: string }[] = [
    { id: "object", title: "Object" }, { id: "edit", title: "Edit" }, { id: "sculpt", title: "Sculpt" },
    { id: "weights", title: "Weight Paint" }, { id: "texture", title: "Texture Paint" }, { id: "pose", title: "Pose" },
  ];
  const uiMode = $derived<UiMode>(mode === "texture" ? "texture" : mode === "animate" ? "pose" : inEdit ? (sculpting ? "sculpt" : weightPainting ? "weights" : "edit") : "object");
  function setUiMode(next: UiMode) {
    playingAnim = false;
    if (next === "texture") {
      mode = "texture";
      editPoints = false;
      sculpting = weightPainting = false;
      return;
    }
    if (next === "pose") {
      mode = "animate";
      editPoints = false;
      sculpting = weightPainting = false;
      if (!clips.length) newClip();
      return;
    }
    mode = "model";
    if (next === "object") {
      editPoints = false;
      sculpting = weightPainting = false;
      return;
    }
    // the rest work on the points of a mesh: a shape is chosen, and made a mesh if it is a box
    if (!selected || selected.cube === undefined || !cube) {
      studio.say("info", "Choose a shape first: Edit, Sculpt and Weight Paint work on the points of one shape.");
      editPoints = false;
      return;
    }
    makeEditable();
    sculpting = next === "sculpt";
    weightPainting = next === "weights" && !!cube?.skin;
    if (next === "weights" && !cube?.skin) {
      studio.say("info", "This shape does not bend with the parts yet: use \"Bend with the parts\" in the edit panel (or Auto-skin) first.");
      sculpting = false;
    }
  }
  // The shape's properties in tabs, as Blender's properties editor has them.
  type PropTab = "object" | "material" | "modifiers" | "bones" | "mesh";
  const PROP_TABS: { id: PropTab; title: string; help: string; icon: string }[] = [
    { id: "object", title: "Object", help: "Name, place, size and the shape's tools", icon: "cube" },
    { id: "modifiers", title: "Modifiers", help: "Non-destructive changes: mirror, subdivision, boolean and more", icon: "wrench" },
    { id: "material", title: "Material", help: "Colour, glow, metal and roughness", icon: "palette" },
    { id: "bones", title: "Bones", help: "Make the mesh bend with the model's parts", icon: "bone" },
    { id: "mesh", title: "Mesh", help: "The picked points, edge and face, and tools for the whole mesh", icon: "editPoints" },
  ];
  let propTab = $state<PropTab>("object");
  let poseTab = $state<"pose" | "rules">("pose");
  $effect(() => {
    // entering Edit mode shows the mesh tab (unless another tab is being used, such as the bones); leaving it puts that tab away
    if (inEdit) untrack(() => { if (propTab === "object") propTab = "mesh"; });
    else untrack(() => { if (propTab === "mesh") propTab = "object"; });
  });
  let selectNote = $state("");
  let slideAmount = $state(0.5);
  let smoothAngle = $state(35);
  /// Shades faces smooth where the surface turns by less than the angle, flat at hard corners (the picked faces, or all when none is picked).
  function autoSmoothNow() {
    if (!cube || !selected) return;
    commit(setCube(doc, selected, smoothByAngle(cube, smoothAngle, selFace !== undefined && selFace !== null ? [selFace] : undefined)), false, "Smooth by angle");
    selectNote = "Shading set by angle.";
  }
  /// Closes the open border the first picked point is on, with quads meeting in a new middle point.
  function fillHoleAtPick() {
    if (!cube || !selected || !selVerts.length) return void (selectNote = "Pick a point on the edge of the hole first.");
    const next = fillHole(cube, selVerts[0]!);
    if (next.polys!.length === cube.polys?.length) return void (selectNote = "That point is not on an open border.");
    commit(setCube(doc, selected, next), false, "Fill hole");
    selectNote = "Hole filled.";
  }
  /// Closes the open border the first picked point is on with a grid of quads (an even border).
  function gridFillAtPick() {
    if (!cube || !selected || !selVerts.length) return void (selectNote = "Pick a point on the edge of the hole first.");
    const next = gridFillHole(cube, selVerts[0]!);
    if (next.polys!.length === cube.polys?.length) return void (selectNote = "That point is not on an open border with an even number of points.");
    commit(setCube(doc, selected, next), false, "Grid fill");
    selectNote = "Hole filled with a grid.";
  }
  /// Slides the picked edge along the quads beside it (positive towards the first face on it, negative towards the other).
  function slideEdge() {
    if (!cube || !selected || !selEdge) return void (selectNote = "Click an edge first.");
    commit(setCube(doc, selected, edgeSlide(cube, selEdge[0], selEdge[1], slideAmount)), false, "Slide edge");
  }
  /// Picks the points of the loop or the ring through the picked edge.
  function pickLoop(kind: "loop" | "ring") {
    if (!cube || !selEdge) return void (selectNote = "Click an edge first.");
    const edges = kind === "loop" ? edgeLoop(cube, selEdge[0], selEdge[1]) : edgeRing(cube, selEdge[0], selEdge[1]);
    selVerts = pointsOfEdges(edges);
    selectNote = `${edges.length} edge${edges.length === 1 ? "" : "s"}, ${selVerts.length} points picked.`;
  }
  /// Picks the points of every face like the picked one.
  function pickSimilar(by: "normal" | "area" | "sides") {
    if (!cube || selFace === null) return void (selectNote = "Click a face first.");
    const faces = selectSimilarFaces(cube, selFace, by);
    selVerts = [...new Set(faces.flatMap((f) => cube!.polys![f]!.v))];
    selectNote = `${faces.length} face${faces.length === 1 ? "" : "s"} like it, ${selVerts.length} points picked.`;
  }
  let tubePath = $state("0,0,0; 10,0,0; 10,10,0");
  let tubeRadius = $state(1);
  let tubeOpen = $state(false);
  /// A tube swept along the typed path (points as x,y,z separated by semicolons), in the selected part.
  function addTube() {
    const path = parsePath(tubePath);
    const mesh = path ? sweepTube(path, tubeRadius, 8) : null;
    if (!mesh) return void (selectNote = "A tube needs 2 to 16 points like \"0,0,0; 10,0,0\" that go somewhere.");
    const target = selected?.parts ?? (doc.parts.length ? [0] : null);
    if (!target) return;
    const r = addCube(doc, target, mesh);
    commit(r.doc, false, "Add tube");
    selected = r.path;
    also = [];
    tubeOpen = false;
  }
  let textShape = $state("");
  /// A mesh shape that reads the typed words, in blocks of the pixel font, in the selected part.
  function addTextShape() {
    const mesh = textToMesh(textShape, 1, 2);
    if (!mesh) return;
    const target = selected?.parts ?? (doc.parts.length ? [0] : null);
    if (!target) return;
    const r = addCube(doc, target, mesh);
    commit(r.doc, false, "Add text");
    selected = r.path;
    also = [];
    textShape = "";
  }
  function newCube() {
    const target = selected?.parts ?? (doc.parts.length ? [0] : null);
    if (!target) return newPart([]);
    const kind = newKind;
    const square = kind === "square";
    const r = addCube(doc, target, kind === "square" ? freshMesh() : kind === "profile" ? freshProfile() : { shape: kind });
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
  /// Adds copies of the element at lower detail beside it, named with _lod1, _lod2 ... (the game picks them by distance).
  function addLods(copies: Cube[]) {
    if (!selected) return;
    let next = doc;
    copies.forEach((c, i) => {
      next = addCube(next, selected!.parts, { ...c, name: `${cube?.name ?? "mesh"}_lod${i + 1}` }).doc;
    });
    commit(next);
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
  /// Copies the weights of the +x side to the -x side (or the other way), swapping left bones for right ones.
  /// Makes every mesh that has no skin yet bend with the model's parts.
  function skinEverything() {
    const r = autoSkinAll(doc);
    animNote = r.count ? `Skinned ${r.count} mesh${r.count === 1 ? "" : "es"}: they now bend with the parts.` : "No unskinned mesh sits on a part with a neighbour (boxes are not skinned: use Edit points to make a shape a mesh first).";
    if (r.count) commit(r.doc, false, "Auto-skin all");
  }
  let gradA = $state("");
  let gradB = $state("");
  let gradAxis = $state<0 | 1 | 2>(1);
  let gradFrom = $state(0);
  let gradTo = $state(10);
  let paintOnlyPicked = $state(false);
  function applyWeightGradient() {
    if (!selected || !cube?.skin) return;
    const a = gradA || cube.skin.bones[0];
    const b = gradB || cube.skin.bones[1] || cube.skin.bones[0];
    if (!a || !b) return;
    commit(setCube(doc, selected, gradientWeights(cube, a, b, gradAxis, gradFrom, gradTo, selVerts.length ? selVerts : undefined)), false, "Weight gradient");
  }
  function mirrorSkin(from: "positive" | "negative") {
    if (!selected || !cube?.skin) return;
    const r = mirrorWeights(cube, from);
    skinNote = r.set ? `Mirrored the weights of ${r.set} point${r.set === 1 ? "" : "s"}.` : "No point had a mirror partner to copy to (the mesh must be symmetrical about x = 0).";
    if (r.set) commit(setCube(doc, selected, r.cube), false, "Mirror weights");
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
  /// Replaces the selected element's modifier list (turning a box or round shape into a mesh first, since modifiers work on points).
  function setModifiers(list: Modifier[]) {
    if (!selected || !cube) return;
    const base = cube.shape === "mesh" ? cube : toMesh(cube);
    const next: Cube = { ...base };
    if (list.length) next.modifiers = list;
    else delete next.modifiers;
    change(next);
  }
  /// Bakes the modifiers up to and including number `index` into the points.
  function applyModifierAt(index: number) {
    if (!selected || !cube) return;
    change(applyStack(cube, index + 1), true);
  }
  const creaseOf = (c: Cube, a: number, b: number) => c.creases?.find((e) => (e[0] === a && e[1] === b) || (e[0] === b && e[1] === a))?.[2] ?? 0;
  /// Sets the crease weight (0 to 1) of the picked edge.
  function setCrease(w: number) {
    if (!selected || !cube || !selEdge) return;
    const [a, b] = selEdge;
    const rest = (cube.creases ?? []).filter((e) => !((e[0] === a && e[1] === b) || (e[0] === b && e[1] === a)));
    const weight = Math.max(0, Math.min(1, Number.isFinite(w) ? w : 0));
    const next: Cube = { ...cube };
    const list = weight > 0 ? [...rest, [a, b, weight] as [number, number, number]] : rest;
    if (list.length) next.creases = list;
    else delete next.creases;
    change(next);
  }
  function makeEditable() {
    if (!selected || !cube) return;
    if (cube.shape !== "mesh") change(toMesh(cube));
    editPoints = true;
  }
  // E with a face picked: the face follows the mouse along the way it points until a click keeps it (Esc puts it back)
  let pullModal = false;
  function endPullModal(keep: boolean) {
    const p = pull;
    pullModal = false;
    pull = null;
    selectNote = "";
    if (controls) controls.enabled = true;
    if (!keep && p?.moved) undo();
  }
  function extrudeKey() {
    if (!inEdit || !selected || !cube || !camera || !canvas) return;
    if (selFace !== null && cube.polys?.[selFace]) {
      const frame = faceFrame();
      const t0 = frame ? lineParameter({ clientX: pointerAt.x, clientY: pointerAt.y } as PointerEvent, frame.at, frame.dir) : null;
      if (!frame || t0 === null) return void extrude();
      pull = { base: doc, baseCube: cube, path: selected, face: selFace, origin: frame.at, dir: frame.dir, t0, moved: false };
      pullModal = true;
      if (controls) controls.enabled = false;
      selectNote = "Move the mouse to pull the face out, click to keep it, Esc to cancel.";
    } else if (selEdge) extendEdge();
    else selectNote = "Pick a face to extrude it (or an open edge to pull it out).";
  }
  // Ctrl+B or V with an edge picked: the mouse sets how wide the bevel is (how far it is from where you started), the scroll wheel how many segments (a rounder strip),
  // a click keeps it and Esc puts everything back. The same bevel as the button, shown live.
  let bevelModal: { base: ModelDoc; baseCube: Cube; path: Path; a: number; b: number; x0: number; y0: number; fraction: number; segments: number; points: number[]; recorded: boolean } | null = null;
  function showBevel() {
    const m = bevelModal;
    if (!m) return;
    const r = bevelEdge(m.baseCube, m.a, m.b, m.fraction, m.segments);
    if (!r) return;
    if (!m.recorded) {
      history.record(m.base);
      m.recorded = true;
    }
    m.points = r.points;
    commit(setCube(m.base, m.path, r.cube), true);
    selectNote = `Bevel: width ${Math.round(m.fraction * 100)}%, ${m.segments} segment${m.segments === 1 ? "" : "s"}. Move the mouse for the width, scroll for the segments, click to keep, Esc to cancel.`;
  }
  function bevelKey() {
    if (!inEdit || !selected || !cube) return void (selectNote = "Go into point mode (Tab) and pick an edge to bevel it.");
    // (an edge clicked, or two picked points that are the ends of an edge)
    const ends: [number, number] | null = selEdge ?? (selVerts.length === 2 && edgesOf(cube).some((e) => (e.a === selVerts[0] && e.b === selVerts[1]) || (e.a === selVerts[1] && e.b === selVerts[0])) ? [selVerts[0]!, selVerts[1]!] : null);
    if (!ends) return void (selectNote = "Pick an edge to bevel it: click along an edge, or pick its two end points.");
    if (!bevelEdge(cube, ends[0], ends[1], 0.25)) return void (selectNote = "That edge cannot be bevelled: it needs a face on each side, and faces all round both ends (an edge on the open border of a sheet cannot).");
    bevelModal = { base: doc, baseCube: cube, path: selected, a: ends[0], b: ends[1], x0: pointerAt.x, y0: pointerAt.y, fraction: Math.min(0.5, Math.max(0.02, bevelBy / 100)), segments: 1, points: [], recorded: false };
    if (controls) controls.enabled = false;
    showBevel();
  }
  function moveBevel(e: PointerEvent) {
    const m = bevelModal;
    if (!m) return;
    m.fraction = Math.min(0.5, Math.max(0.02, Math.round((Math.hypot(e.clientX - m.x0, e.clientY - m.y0) / 300) * 50) / 100));
    showBevel();
  }
  function endBevel(keep: boolean) {
    const m = bevelModal;
    bevelModal = null;
    selectNote = "";
    if (controls) controls.enabled = true;
    if (!m) return;
    if (keep) {
      bevelBy = Math.round(m.fraction * 100);
      selEdge = null;
      selFace = null;
      selVerts = m.points;
    } else if (m.recorded) undo();
  }
  let wheelAcc = 0;
  $effect(() => {
    const onWheel = (e: WheelEvent) => {
      const m = bevelModal;
      if (!m) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      // (a wheel notch is a step; a trackpad's small scrolls add up to one first)
      wheelAcc += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      const steps = Math.trunc(wheelAcc / 40);
      if (!steps) return;
      wheelAcc -= steps * 40;
      m.segments = Math.min(16, Math.max(1, m.segments - steps));
      showBevel();
    };
    window.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => window.removeEventListener("wheel", onWheel, { capture: true });
  });
  /// X in point mode takes away what is picked (the points, or the face), not the whole shape.
  function deleteInEdit() {
    if (!cube) return;
    if (selVerts.length) removePointsPicked();
    else if (selFace !== null && cube.polys?.[selFace]) {
      change(deleteFaces(cube, [selFace]));
      selFace = null;
    } else selectNote = "Pick points or a face to delete.";
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
    if (!r) return void (selectNote = "That edge cannot be bevelled: it needs a face on each side, and faces all round both ends.");
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
  /// A free knife cut: a plane through the two picked points and the way the camera looks cuts every face between them.
  function knifeAcross() {
    if (!cube || !selected || selVerts.length !== 2 || !camera) return;
    const g = groupOf(selected.parts);
    if (!g) return;
    const v = camera.getWorldDirection(new THREE.Vector3()).applyMatrix3(new THREE.Matrix3().setFromMatrix4(g.matrixWorld.clone().invert())).normalize();
    const r = knifeCut(cube, cube.verts![selVerts[0]!]!, cube.verts![selVerts[1]!]!, [v.x, v.y, v.z]);
    if (!r.cut) return void studio.say("info", "Nothing to cut: pick two points that are on or beside the faces to cut, and look at the mesh from the side you want to cut across.");
    change(r.cube);
    selVerts = r.points;
    selFace = null;
    selEdge = null;
  }
  const isSeam = (e: [number, number] | null) => !!e && !!cube?.seams?.some(([a, b]) => (a === e[0] && b === e[1]) || (a === e[1] && b === e[0]));
  /// Marks (or clears) the picked edge as a UV seam: the unwrap cuts along it, so the faces on its two sides become separate islands.
  function toggleSeam() {
    if (!cube || !selEdge) return void (selectNote = "Click an edge first.");
    const e: [number, number] = [selEdge[0], selEdge[1]];
    const was = isSeam(e);
    const rest = (cube.seams ?? []).filter(([a, b]) => !((a === e[0] && b === e[1]) || (a === e[1] && b === e[0])));
    const seams = was ? rest : [...rest, e];
    change({ ...cube, seams: seams.length ? seams : undefined });
    selectNote = was ? "Seam cleared." : cube.modifiers?.length ? "Seam marked (a shape with modifiers unwraps without seams)." : "Seam marked: the unwrap cuts along it.";
  }
  function removeFacePicked() {
    if (cube && selFace !== null) change(deleteFaces(cube, [selFace]), true);
  }
  function removePointsPicked() {
    if (cube && selVerts.length) change(deleteVerts(cube, selVerts), true);
  }
  // the picked point, or the middle of the picked points, which the number boxes show and set (moving every picked point by as much)
  const pickedCentre = $derived(cube?.verts && selVerts.length ? centreOf(cube.verts as Vec3[], selVerts) : ([0, 0, 0] as Vec3));
  function setCentreAxis(i: number, raw: string) {
    if (!cube?.verts || !selVerts.length || raw.trim() === "" || !Number.isFinite(Number(raw))) return;
    const delta: Vec3 = [0, 0, 0];
    delta[i] = Math.round((Number(raw) - pickedCentre[i]!) * 100) / 100;
    if (delta[i] === 0) return;
    change(symmetry === "off" ? moveVerts(cube, selVerts, delta) : moveVertsSymmetric(cube, selVerts, delta, Number(symmetry) as Axis));
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
  // Keys picked in the timeline (⌘ or ⇧-click a diamond): moved or removed together.
  let pickedKeys = $state<number[]>([]);
  const keyIsPicked = (t: number) => pickedKeys.some((x) => Math.abs(x - t) < KEY_STEP / 2);
  function clickKey(t: number, e: MouseEvent) {
    playingAnim = false;
    if (e.metaKey || e.ctrlKey || e.shiftKey) pickedKeys = keyIsPicked(t) ? pickedKeys.filter((x) => Math.abs(x - t) >= KEY_STEP / 2) : [...pickedKeys, t];
    else {
      pickedKeys = [];
      animTime = t;
    }
  }
  $effect(() => {
    clipIndex; selected;
    untrack(() => (pickedKeys = []));
  });
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
    if (modal) {
      modalKey(e);
      return;
    }
    // while a point is dragged: X, Y or Z keeps it to that axis (⇧ to the plane across it), the same key again frees it; Esc puts it back
    if (drag || gizmoMove) {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelPointMove();
        return;
      }
      const lock = drag ? lockForKey(e.key, e.shiftKey, drag.lock === drag.free ? null : drag.lock) : undefined;
      if (drag && lock !== undefined) {
        e.preventDefault();
        drag.lock = lock ?? drag.free;
        clearGuides();
        freeDragTo(drag.last);
      }
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    const step = e.shiftKey ? 4 : 1;
    // (move, turn, resize, pivot, shading, duplicate and delete are commands with their own keys: see the model commands below)
    if (e.key === "Escape" && bevelModal) {
      endBevel(false);
    } else if (e.key === "Escape" && pullModal) {
      endPullModal(false);
    } else if (e.key === "Escape" && (boxArmed || rubber)) {
      rubber = null;
      boxArmed = false;
      if (controls) controls.enabled = true;
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
    } else if (selected && !mod) {
      const moves: Record<string, [number, number, number]> = { ArrowLeft: [-step, 0, 0], ArrowRight: [step, 0, 0], ArrowUp: [0, 0, -step], ArrowDown: [0, 0, step], PageUp: [0, step, 0], PageDown: [0, -step, 0] };
      const m = moves[e.key];
      if (m) {
        e.preventDefault();
        nudge(...m);
      }
    }
  }
  // ---- Blender-style transforms: G moves, S resizes, with the mouse (lib/modal-transform.ts) ----------------------
  let modal = $state<{ kind: "move" | "scale"; base: ModelDoc; x0: number; y0: number; axis: ModalAxis; typed: string; amount: string } | null>(null);
  let pointerAt = { x: 0, y: 0 };

  /// Every shape of the model, as paths.
  const allShapes = $derived(rows.flatMap((r) => r.part.cubes.map((_, ci) => ({ parts: r.parts, cube: ci }) as Path)));
  function selectShapes(what: "all" | "none" | "invert") {
    const shapes = what === "invert" ? allShapes.filter((p) => !isPicked(p)) : what === "all" ? allShapes : [];
    selected = shapes[0] ?? null;
    also = shapes.slice(1);
  }

  function startModal(kind: "move" | "scale") {
    if (!selected) return;
    modal = { kind, base: doc, x0: pointerAt.x, y0: pointerAt.y, axis: null, typed: "", amount: "" };
  }

  /// Shows the transform for the mouse and keys now, without saving it (nothing goes into the undo history until it is kept).
  function modalApply() {
    const m = modal;
    if (!m || !camera || !controls) return;
    const typed = parseTyped(m.typed);
    let next = m.base;
    if (m.kind === "move") {
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      const perPixel = (2 * camera.position.distanceTo(controls.target) * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, canvas?.clientHeight ?? 400);
      const w = moveDelta([right.x, right.y, right.z], [up.x, up.y, up.z], pointerAt.x - m.x0, pointerAt.y - m.y0, perPixel, m.axis, typed);
      m.amount = String(round2m(Math.hypot(w[0], w[1], w[2])));
      const world = new THREE.Vector3(w[0], w[1], w[2]);
      // the same movement in the world is a different one inside a part that is turned
      const local = (parts: number[]) => {
        const g = parts.length > 1 ? groupOf(parts.slice(0, -1)) : modelGroup;
        const inv = new THREE.Matrix3().setFromMatrix4((g ?? new THREE.Object3D()).matrixWorld.clone().invert());
        return world.clone().applyMatrix3(inv);
      };
      if (pickedShapes.length) {
        for (const p of pickedShapes) {
          const c = cubeAt(next, p);
          if (!c) continue;
          // (a shape moves inside its own part)
          const g = groupOf(p.parts);
          const inPart = g ? world.clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(g.matrixWorld.clone().invert())) : world;
          next = updateCube(next, p, { from: [round2m(c.from[0] + inPart.x), round2m(c.from[1] + inPart.y), round2m(c.from[2] + inPart.z)] });
        }
      } else if (selected && part) {
        const d = local(selected.parts);
        next = updatePart(next, selected.parts, { origin: [round2m(part.origin[0] + d.x), round2m(part.origin[1] + d.y), round2m(part.origin[2] + d.z)] });
      }
    } else {
      const f = scaleFactor(pointerAt.x - m.x0, typed);
      m.amount = String(round2m(f));
      for (const p of pickedShapes) {
        const c = cubeAt(next, p);
        if (!c || c.shape === "mesh") continue;
        const b = scaleBox(c.from, [c.from[0] + c.size[0], c.from[1] + c.size[1], c.from[2] + c.size[2]], f, m.axis);
        next = updateCube(next, p, { from: b.from.map(round2m) as Vec3, size: [b.to[0] - b.from[0], b.to[1] - b.from[1], b.to[2] - b.from[2]].map(round2m) as Vec3 });
      }
    }
    doc = next;
    tick++;
  }

  /// Keeps the transform (the document goes back to how it was, then the change is saved as one step in the history) or puts everything back.
  function modalEnd(keep: boolean) {
    const m = modal;
    if (!m) return;
    const shown = doc;
    modal = null;
    doc = m.base;
    if (keep) commit(shown);
    else tick++;
  }
  function modalKey(e: KeyboardEvent) {
    const m = modal;
    if (!m) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") return modalEnd(false);
    if (e.key === "Enter") return modalEnd(true);
    const axis = axisKey(m.axis, e.key);
    if (axis !== undefined) m.axis = axis;
    else m.typed = typeKey(m.typed, e.key);
    modalApply();
  }

  // The model editor's commands. Each has a Blender key and a Nova key (Edit > Keyboard shortcuts changes them); a key typed into a text box is
  // text, not one of these. They are in the Model menu and the command palette while a model is open.
  $effect(() => {
    const onShape = () => !modal && mode === "model" && !inEdit && !!selected;
    const offs = [
      commands.register({ id: "model.grab", title: "Move with the mouse", menu: "Model", icon: "move", keymaps: { blender: ["G"], nova: [] }, help: "The shape follows the mouse: X, Y or Z keeps one axis, type a number for an exact amount, click or Enter keeps it, Esc cancels", enabled: () => !modal && mode === "model" && !inEdit && !!selected, run: () => startModal("move") }),
      commands.register({ id: "model.scaleMouse", title: "Resize with the mouse", menu: "Model", icon: "scale", keymaps: { blender: ["S"], nova: [] }, help: "Drag to make it bigger or smaller; X, Y or Z for one direction; type a factor", enabled: () => !modal && mode === "model" && !inEdit && pickedShapes.some((p) => cubeAt(doc, p)?.shape !== "mesh"), run: () => startModal("scale") }),
      commands.register({ id: "model.selectAll", title: "Select all shapes", menu: "Model", icon: "selectAll", keymaps: { blender: ["A"], nova: ["Mod+Shift+A"] }, enabled: () => !modal && mode === "model" && !inEdit, run: () => selectShapes("all") }),
      commands.register({ id: "model.selectNone", title: "Select nothing", menu: "Model", icon: "selectNone", keymaps: { blender: ["Alt+A"], nova: ["Mod+Shift+D"] }, enabled: () => !modal && mode === "model" && !inEdit, run: () => selectShapes("none") }),
      commands.register({ id: "model.selectInvert", title: "Invert the selection", menu: "Model", icon: "selectInvert", keymaps: { blender: ["Mod+I"], nova: [] }, enabled: () => !modal && mode === "model" && !inEdit, run: () => selectShapes("invert") }),
      commands.register({ id: "model.move", title: "Move handles", menu: "Model", icon: "move", keymaps: { blender: ["Shift+G"], nova: ["W"] }, help: "Shows the move handles", enabled: onShape, run: () => { gizmoMode = "translate"; } }),
      commands.register({ id: "model.turn", title: "Turn handles", menu: "Model", icon: "rotate", keymaps: { blender: ["R"], nova: ["E"] }, help: "Shows the turn handles", enabled: onShape, run: () => { gizmoMode = "rotate"; } }),
      commands.register({ id: "model.resize", title: "Resize handles", menu: "Model", icon: "scale", keymaps: { blender: ["Shift+S"], nova: ["R"] }, help: "Shows the resize handles", enabled: onShape, run: () => { gizmoMode = "scale"; } }),
      commands.register({ id: "model.pivot", title: "Move the pivot", menu: "Model", icon: "pivot", keys: ["P"], help: "The point a part turns about", enabled: onShape, run: () => { gizmoMode = "pivot"; } }),
      commands.register({ id: "model.editPoints", title: "Edit points", menu: "Model", icon: "editPoints", keymaps: { blender: ["Tab"], nova: [] }, help: "Move points and pull faces of a shape", enabled: () => !modal && mode === "model" && !!cube, run: () => { if (inEdit) editPoints = false; else makeEditable(); } }),
      commands.register({ id: "model.add", title: "Add a shape", menu: "Model", icon: "addShape", keymaps: { blender: ["Shift+A"], nova: [] }, enabled: () => !modal && mode === "model", run: () => newCube() }),
      commands.register({ id: "model.duplicate", title: "Duplicate", menu: "Model", icon: "copy", keymaps: { blender: ["Shift+D"], nova: ["Mod+D"] }, enabled: () => !modal && !!selected, run: () => duplicate() }),
      commands.register({ id: "model.delete", title: "Delete", menu: "Model", icon: "trash", keymaps: { blender: ["X", "Delete"], nova: ["Delete", "Backspace"] }, help: "Takes away the shape; in point mode, the picked points or face", enabled: () => !modal && !!selected, run: () => (inEdit && cube?.shape === "mesh" ? deleteInEdit() : remove()) }),
      commands.register({ id: "model.edit.extrude", title: "Extrude", menu: "Model", icon: "addShape", keymaps: { blender: ["E"], nova: ["Shift+E"] }, help: "Pulls the picked face out with the mouse (click to keep, Esc to cancel); an open edge is pulled out by the Edge number", enabled: () => !modal && mode === "model" && inEdit && !!cube, run: () => extrudeKey() }),
      commands.register({ id: "model.edit.inset", title: "Inset", menu: "Model", keymaps: { blender: ["I"], nova: ["Shift+I"] }, help: "A smaller face inside the picked one (Shrink % sets how much)", enabled: () => !modal && mode === "model" && inEdit && !!cube && selFace !== null, run: () => inset() }),
      commands.register({ id: "model.edit.bevel", title: "Bevel", menu: "Model", keymaps: { blender: ["B", "V"], nova: ["Shift+V"] }, help: "Bevels the picked edge: the mouse sets the width, the scroll wheel the number of segments, a click keeps it", enabled: () => !modal && mode === "model" && inEdit && !!cube, run: () => bevelKey() }),
      commands.register({ id: "model.edit.loopCut", title: "Loop cut", menu: "Model", keymaps: { blender: ["Mod+R"], nova: [] }, help: "Cuts the ring of four-sided faces round the shape in two, through the picked face", enabled: () => !modal && mode === "model" && inEdit && !!cube && selFace !== null, run: () => cutLoop(0) }),
      commands.register({ id: "model.edit.makeFace", title: "Make a face from the picked points", menu: "Model", keymaps: { blender: ["F"], nova: [] }, enabled: () => !modal && mode === "model" && inEdit && !!cube && selVerts.length >= 3, run: () => makeFace() }),
      commands.register({ id: "model.edit.knife", title: "Knife", menu: "Model", keymaps: { blender: ["K"], nova: [] }, help: "Cuts between the two picked points", enabled: () => !modal && mode === "model" && inEdit && !!cube && selVerts.length === 2, run: () => knife() }),
      commands.register({ id: "model.shading", title: "Cycle the shading", menu: "Model", icon: "shading", keys: ["Z"], help: "Textured, plain colours, wireframe, see-through", enabled: () => !modal, run: () => { viewMode = viewMode === "textured" ? "solid" : viewMode === "solid" ? "wire" : viewMode === "wire" ? "xray" : "textured"; } }),
      ...VIEW_NAMES.map((n) => commands.register({ id: `model.view.${n}`, title: `${VIEW_LABELS[n]} view`, menu: "Model", keymaps: { blender: n === "front" ? ["1"] : n === "right" ? ["3"] : n === "top" ? ["7"] : n === "back" ? ["2"] : n === "left" ? ["4"] : ["8"], nova: [] }, help: n === "front" || n === "right" || n === "top" ? "Blender's numpad 1, 3 and 7. Back, left and bottom are 2, 4 and 8 here (a laptop has no Ctrl-numpad)." : undefined, enabled: () => !modal, run: () => showView(n) })),
      commands.register({ id: "model.view.ortho", title: "Flat or deep view", menu: "Model", keymaps: { blender: ["5"], nova: [] }, help: "Switches between a view with perspective and a flat one where parallel lines stay parallel (Blender's numpad 5)", enabled: () => !modal, run: () => setOrtho(!ortho) }),
      commands.register({ id: "model.view.orbitLeft", title: "Turn the view left", menu: "Model", help: "15 degrees", run: () => orbit(-15, 0) }),
      commands.register({ id: "model.view.orbitRight", title: "Turn the view right", menu: "Model", help: "15 degrees", run: () => orbit(15, 0) }),
      commands.register({ id: "model.view.orbitUp", title: "Turn the view up", menu: "Model", help: "15 degrees", run: () => orbit(0, 15) }),
      commands.register({ id: "model.view.orbitDown", title: "Turn the view down", menu: "Model", help: "15 degrees", run: () => orbit(0, -15) }),
      commands.register({ id: "model.boxSelect", title: "Box select points", menu: "Model", keymaps: { blender: ["Shift+B"], nova: [] }, help: "Drag a rectangle over the view to pick the points inside it (Shift adds)", enabled: () => !modal && inEdit, run: () => { boxArmed = !boxArmed; } }),
      commands.register({ id: "model.exportObj", title: "Export as an OBJ file", menu: "Model", icon: "export", help: "Every shape as a mesh, in metres at the export scale, into the exports folder", run: () => void exportObj() }),
      commands.register({ id: "model.resetView", title: "Reset the view", menu: "Model", icon: "home", keymaps: { blender: ["Home"], nova: [] }, run: () => resetView() }),
    ];
    return () => offs.forEach((off) => off());
  });
  // the shortcut a command has now (the keymap and the person's changes decide), for the hint line
  const keyFor = (id: string) => {
    void commandsRev.n;
    const cmd = commands.get(id);
    return cmd ? commands.shortcut(cmd) || "—" : "";
  };
  const hexOf = (c: string) => c.slice(0, 7);
  const pickColour = (face: Face | "all", value: string) => {
    if (!selected) return;
    let next = doc;
    for (const p of face === "all" ? pickedShapes : [selected]) next = setFaceColor(next, p, face, value);
    commit(next);
  };
  const label = (f: Face) => ({ east: "East +x", west: "West −x", up: "Top +y", down: "Bottom −y", south: "South +z", north: "North −z" })[f];
  // the status bar (bottom of the window): what the keys do here, and the model's size
  const hintText = $derived(
    mode === "texture"
      ? "Drag on the model to paint it · ⇧-click draws a straight line · ⌘Z undoes painting · Z changes the view"
      : inEdit
        ? "Click a face or an edge to pick it (⇧ adds) · drag the arrows to move · arrows and PageUp/PageDown nudge · Tab or Esc leaves point mode"
        : `${navHint(input.navigation, true)} · click a shape to select (⇧ adds) · ${keyFor("model.move")} ${keyFor("model.turn")} ${keyFor("model.resize")} ${keyFor("model.pivot")} move, turn, resize, pivot · Tab point mode`,
  );
  const infoText = $derived(`${modelStats(doc).triangles.toLocaleString("en")} triangles · ${countCubes(doc)} shapes · saves ${glbPath}`);
  $effect(() => {
    studio.statusHint = hintText;
    studio.statusInfo = infoText;
    return () => {
      studio.statusHint = "";
      studio.statusInfo = "";
    };
  });
  $effect(() => {
    if (!overlaysOpen) return;
    const close = () => (overlaysOpen = false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  });
</script>

<svelte:window onpointerdown={closeSculptMore} onkeydown={key} onpointermove={(e) => { pointerAt = { x: e.clientX, y: e.clientY }; if (modal) modalApply(); }} onpointerdowncapture={(e) => { if (modal) { e.preventDefault(); e.stopPropagation(); modalEnd(e.button === 0); } }} />

{#if error}
  <div class="bad">
    <p><strong>This model file can't be shown visually.</strong></p>
    <p class="dim">{error}</p>
    <button onclick={onjson}>Edit as JSON</button>
  </div>
{:else}
  <div class="editor3d" style:grid-template-columns="minmax(0, 1fr) {rightWidth}px">
    <div class="splitter" role="separator" aria-orientation="vertical" aria-label="Drag to resize the right-hand panels" title="Drag to resize · double-click for the usual size" style:right="{rightWidth - 3}px" onpointerdown={splitDown} onpointermove={splitMove} onpointerup={splitUp} onpointercancel={splitUp} ondblclick={() => setRightWidth(mode === "texture" ? 380 : 300)}></div>
    <aside class="outliner">
      <div class="adder">
        <div class="row"><strong>Outliner</strong><span class="spacer"></span><button class="ghost" aria-expanded={moreAdd} onclick={() => (moreAdd = !moreAdd)} title="Add text or a tube">{moreAdd ? "Less ▴" : "More ▾"}</button></div>
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
            <option value="profile">Profile (spun into a wheel or tyre)</option>
          </select>
          <button onclick={newCube} title="New shape in the selected part">＋ Add</button>
          {#if moreAdd}
          <input class="cname" bind:value={textShape} placeholder="words" aria-label="Text for a lettered shape" maxlength="40" onkeydown={(e) => { if (e.key === "Enter") addTextShape(); }} />
          <button onclick={() => (tubeOpen = !tubeOpen)} aria-expanded={tubeOpen} title="A tube swept along a path of points">＋ Tube</button>
          {#if tubeOpen}
            <span class="row wrap small">
              <input class="cname" bind:value={tubePath} aria-label="Tube path" title="Points as x,y,z separated by semicolons (2 to 16)" />
              <label class="inline">radius <input type="number" min="0.1" step="0.25" bind:value={tubeRadius} class="narrow" aria-label="Tube radius" /></label>
              <button onclick={addTube}>Make it</button>
            </span>
          {/if}
          <button onclick={addTextShape} disabled={!textShape.trim()} title="A shape made of the letters in blocks (one unit a pixel, two deep): for signs and titles">＋ Text</button>
          {/if}
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
        <select class="modeselect" value={uiMode} onchange={(e) => setUiMode(e.currentTarget.value as UiMode)} aria-label="Mode" title="What you are doing with the model (Tab switches between Object and Edit)">
          {#each UI_MODES as m (m.id)}<option value={m.id}>{m.title}</option>{/each}
        </select>
        {#if inEdit}
          <span class="seg" role="group" aria-label="What a click picks">
            {#each [["vertex", "Vertex", "Pick points (click a dot)"], ["edge", "Edge", "Click near an edge to pick it"], ["face", "Face", "Click a face to pick it"]] as [id, title, tip] (id)}
              <button class:on={pickKinds[id as "vertex"]} title="{tip} (⇧-click a name to add it)" onclick={(e) => setPickKind(id as "vertex" | "edge" | "face", e.shiftKey)}>{title}</button>
            {/each}
          </span>
        {/if}
        <label class="inline" title="What a dragged point or handle snaps to">Snap
          <select value={snapMode} onchange={(e) => setSnapMode(e.currentTarget.value)} aria-label="Snap">
            <option value="off">Off</option><option value="grid">Grid</option><option value="points">Points</option><option value="both">Grid and points</option>
          </select>
        </label>
        <label class="inline" title="What several picked shapes turn and resize about: the middle of all of them, or the first one picked">Pivot
          <select bind:value={pivotMode} aria-label="Pivot">
            <option value="median">Median</option><option value="active">Active</option>
          </select>
        </label>
        {#if inEdit}
          <button class:on={proportional} onclick={() => (proportional = !proportional)} title="Proportional editing: points near the moved ones follow, falling off with distance">Proportional</button>
          {#if proportional}<label class="inline" title="How far the pull reaches, in model units">radius <input type="number" min="0.5" step="0.5" bind:value={propRadius} class="narrow" aria-label="Proportional radius" /></label>{/if}
        {/if}
        <span class="spacer"></span>
        <span class="seg" role="group" aria-label="Shading (Z)">
          {#each [["solid", "Solid", "Colours only"], ["textured", "Material", "With the painted texture"], ["wire", "Wire", "Wireframe"], ["xray", "See-through", "See-through"]] as [id, title, tip] (id)}
            <button class:on={viewMode === id} title="{tip} (Z)" onclick={() => (viewMode = id as typeof viewMode)}>{title}</button>
          {/each}
        </span>
        <span class="histwrap">
          <button class="ghost" aria-expanded={overlaysOpen} onclick={(e) => { e.stopPropagation(); overlaysOpen = !overlaysOpen; }} title="What is drawn in the view, and the standard views"><Icon name="overlays" size={15} /> Overlays ▾</button>
          {#if overlaysOpen}
            <div class="histlist overlays" role="menu" aria-label="Overlays and views" onclick={(e) => e.stopPropagation()} onkeydown={() => {}} tabindex="-1">
              <label class="check"><input type="checkbox" bind:checked={showGrid} /> Grid</label>
              <label class="check" title="A short line out of the middle of each face of the chosen shape, the way the face looks (blue): lines pointing into the shape mean the face is turned inside out"><input type="checkbox" bind:checked={showNormals} /> Face normals</label>
              <label class="check" title="The model's triangle and point count over the view"><input type="checkbox" bind:checked={showStats} /> Statistics</label>
              <label class="check" title="The skeleton: a line from each part's pivot to its children's, and a dot at each pivot"><input type="checkbox" bind:checked={showBones} /> Bones</label>
              <label class="check" title="Draw only the chosen part and what is inside it"><input type="checkbox" bind:checked={localView} /> Local view</label>
              <label class="check" title="Flat view: parallel lines stay parallel (5)"><input type="checkbox" checked={ortho} onchange={(e) => setOrtho(e.currentTarget.checked)} /> Flat (orthographic)</label>
              <span class="seg" role="group" aria-label="Standard views">
                {#each VIEW_NAMES as n (n)}<button class:on={viewName === n} onclick={() => showView(n)} title="{VIEW_LABELS[n]} view" aria-label="{VIEW_LABELS[n]} view">{VIEW_LABELS[n][0]}</button>{/each}
              </span>
              <button class="ghost" onclick={resetView}>Reset view</button>
            </div>
          {/if}
        </span>
        <span class="histwrap">
          <button class="ghost" aria-expanded={historyOpen} disabled={tick >= 0 && !history.canUndo && !history.canRedo} onclick={() => (historyOpen = !historyOpen)} title="The list of changes: pick one to go back (or forward) to it">History</button>
          {#if historyOpen}
            <div class="histlist" role="menu" aria-label="History">
              {#each [...history.redoLabels].reverse() as l, k (k)}<button role="menuitem" class="redo" onclick={() => jumpHistory(-(history.redoLabels.length - k))}>↷ {l}</button>{/each}
              <span class="now dim small">now</span>
              {#each history.undoLabels as l, k (k)}<button role="menuitem" onclick={() => jumpHistory(k + 1)}>{k + 1 === 1 ? "↶ " : ""}{l}</button>{/each}
            </div>
          {/if}
        </span>
        <button class="ghost" onclick={onjson} title="Edit the model's file as text">JSON</button>
      </div>
      {#if inEdit}
        <div class="toolopts" role="group" aria-label="Tool options">
          {#if weightPainting && cube?.skin}
            <select bind:value={skinBone} aria-label="Part to paint" title="The part whose hold you paint">{#each cube.skin.bones as b (b)}<option value={b}>{b.split("/").at(-1)}</option>{/each}</select>
            <label class="check" title="Only the picked points take paint"><input type="checkbox" bind:checked={paintOnlyPicked} /> Only picked</label>
            <select bind:value={weightMode} aria-label="Weight brush">{#each WEIGHT_MODES as m (m)}<option value={m}>{m}</option>{/each}</select>
          {/if}
          {#if sculpting}<select bind:value={sculptMode} aria-label="Sculpt brush" title={SCULPT_HELP[sculptMode]}>{#each SCULPT_MODES as m (m)}<option value={m}>{m}</option>{/each}</select>{/if}
          {#if sculpting || weightPainting}
            <label class="check" title="Brush radius, in units">Size <input type="range" min="0.5" max="20" step="0.5" bind:value={sculptRadius} aria-label="Brush size" /></label>
            <label class="check" title="How strongly each dab works">Strength <input type="range" min="0.05" max="1" step="0.05" bind:value={sculptStrength} aria-label="Brush strength" /></label>
          {/if}
          {#if sculpting}<label class="check" title="Sculpt the mirror image across the middle (x = 0) too"><input type="checkbox" bind:checked={sculptSymmetry} /> Mirror</label>{/if}
          {#if sculpting}
            <label class="check" title="With a pen, pressing harder makes each dab stronger (a mouse is unaffected)"><input type="checkbox" bind:checked={sculptPressure} /> Pen pressure</label>
            <details class="sculptmore"><summary title="Dynamic detail, masks and sculpt layers">Detail · Mask · Layers ▾</summary><div class="sculptpop">
            <label class="check" title="Split the polygons under the brush that are longer than the detail size before each dab, so a coarse shape gets fine where you sculpt (not with shape keys)"><input type="checkbox" bind:checked={sculptDynamic} /> Dynamic detail</label>
            {#if sculptDynamic}<label class="inline" title="The longest edge, in units, that the brush leaves under it">Detail <input type="number" min="0.1" max="10" step="0.1" bind:value={sculptDetail} class="narrow" aria-label="Detail size" /></label>{/if}
            <button onclick={splitAll} title="Split every polygon of the shape into four (not with shape keys)">Add detail</button>
            <span class="group" role="group" aria-label="Mask">
              <button onclick={() => maskDo((c) => invertMask(c))} title="Protect what is free and free what is protected">Invert mask</button>
              <button onclick={() => maskDo((c) => blurMask(c, 1))} title="Soften the edge of the mask">Blur mask</button>
              <button onclick={() => maskDo((c) => maskPoints(c, selVerts, true))} title="Protect the picked points">Mask picked</button>
              <button onclick={() => maskDo((c) => clearMask(c))} disabled={!cube?.mask} title="Take the whole mask off">Clear mask</button>
            </span>
            <span class="group" role="group" aria-label="Sculpt layer">
              <label class="inline" title="A sculpt layer is a shape key: the sculpt goes into the layer, not the base shape, and the game can blend it by name">Layer
                <select value={cube?.keyEdit ?? ""} onchange={(e) => setSculptLayer(e.currentTarget.value)} aria-label="Sculpt layer">
                  <option value="">base shape</option>
                  {#each cube?.shapes ?? [] as k (k.name)}<option value={k.name}>{k.name}</option>{/each}
                </select>
              </label>
              <button onclick={newSculptLayer} title="A new layer to sculpt into (a shape key)">＋ Layer</button>
              {#if cube?.keyEdit}<label class="inline" title="How much of this layer shows (a preview; the game sets it by name)">Amount <input type="range" min="0" max="1" step="0.05" value={keyWeights[cube.keyEdit] ?? 1} oninput={(e) => (keyWeights = { ...keyWeights, [cube!.keyEdit!]: Number(e.currentTarget.value) })} aria-label="Layer amount" /></label>{/if}
            </span>
            </div></details>
          {/if}
          <label class="inline" title="How far to slide the picked edge along the quads beside it: positive towards one side, negative the other, 1 is all the way to the next point">Slide <input type="number" min="-1" max="1" step="0.1" bind:value={slideAmount} class="narrow" aria-label="Slide amount" /></label>
          <label class="inline" title="The most a surface may turn and still shade smooth, in degrees">Smooth angle <input type="number" min="1" max="180" step="5" bind:value={smoothAngle} class="narrow" aria-label="Smooth angle" /></label>
          {#if selectNote}<span class="dim small" role="status">{selectNote}</span>{/if}
        </div>
      {/if}
      <div class="viewrow">
        <div class="shelf" role="toolbar" aria-label="Tools for this mode">
          {#if mode === "model" && !inEdit}
            <button class="tool" class:on={gizmoMode === "translate"} disabled={!selected} aria-label="Move (W)" title="Move (W): select a shape first" onclick={() => (gizmoMode = "translate")}><Icon name="move" size={18} /></button>
            <button class="tool" class:on={gizmoMode === "rotate"} disabled={!selected} aria-label="Turn (E)" title="Turn (E): select a shape first" onclick={() => (gizmoMode = "rotate")}><Icon name="rotate" size={18} /></button>
            <button class="tool" class:on={gizmoMode === "scale"} disabled={!selected || selected.cube === undefined} aria-label="Resize (R)" onclick={() => (gizmoMode = "scale")} title={!selected ? "Resize (R): select a shape first" : selected.cube === undefined ? "Parts are resized in animations" : "Resize (R)"}><Icon name="scale" size={18} /></button>
            <button class="tool" class:on={gizmoMode === "pivot"} disabled={!selected || selected.cube !== undefined} aria-label="Pivot (P)" onclick={() => (gizmoMode = "pivot")} title={!selected ? "Pivot (P): select a part first" : selected.cube !== undefined ? "Select a part to move its pivot" : "Move the point this part turns about, leaving its shapes where they are (P)"}><Icon name="pivot" size={18} /></button>
            <hr />
            <button class="tool" aria-label="Add a shape" title="Add a shape (the kind in the outliner) to the selected part" onclick={newCube}><Icon name="addShape" size={18} /></button>
            <button class="tool" disabled={!selected} aria-label="Duplicate" title="Duplicate the selected shape or part" onclick={duplicate}><Icon name="copy" size={18} /></button>
            <button class="tool" disabled={!selected} aria-label="Delete" title="Delete the selected shape or part" onclick={remove}><Icon name="trash" size={18} /></button>
            <hr />
            <button class="tool" disabled={!selected || selected.cube === undefined} aria-label="Edit points (Tab)" title={selected && selected.cube !== undefined ? "Edit the shape's points, edges and faces (Tab)" : "Edit points: select a shape first"} onclick={() => setUiMode("edit")}><Icon name="editPoints" size={18} /></button>
          {/if}
          {#if inEdit}
            <button class="tool" class:on={boxArmed} aria-label="Box select: drag a rectangle over the points (B)" title="Box select: drag a rectangle over the points (B)" onclick={() => (boxArmed = !boxArmed)} ><Icon name="boxSelect" size={18} /></button>
            <button class="tool" class:on={sculpting} aria-label="Sculpt: brush the surface (Ctrl reverses)" title="Sculpt: brush the surface (Ctrl reverses)" onclick={() => { sculpting = !sculpting; weightPainting = false; }} ><Icon name="sculpt" size={18} /></button>
            {#if cube?.skin}<button class="tool" class:on={weightPainting} aria-label="Paint weights: brush how strongly a part holds the points" title="Paint weights: brush how strongly a part holds the points" onclick={() => { weightPainting = !weightPainting; sculpting = false; }} ><Icon name="weights" size={18} /></button>{/if}
            <hr />
            <button class="tool" class:on={false} aria-label="Pick the edge loop through the picked edge (quad meshes)" title="Pick the edge loop through the picked edge (quad meshes)" onclick={() => pickLoop("loop")} ><Icon name="loop" size={18} /></button>
            <button class="tool" class:on={false} aria-label="Pick the edges parallel to the picked edge across the quads" title="Pick the edges parallel to the picked edge across the quads" onclick={() => pickLoop("ring")} ><Icon name="ring" size={18} /></button>
            <button class="tool" class:on={false} aria-label="Pick every face that faces the way the picked face does" title="Pick every face that faces the way the picked face does" onclick={() => pickSimilar("normal")} ><Icon name="sameWay" size={18} /></button>
            <button class="tool" class:on={false} aria-label="Pick every face of about the same size as the picked face" title="Pick every face of about the same size as the picked face" onclick={() => pickSimilar("area")} ><Icon name="sameSize" size={18} /></button>
            <hr />
            <button class="tool" class:on={false} aria-label="Fill hole: close the open border that the picked point is on" title="Fill hole: close the open border that the picked point is on" onclick={fillHoleAtPick} ><Icon name="fillHole" size={18} /></button>
            <button class="tool" class:on={false} aria-label="Grid fill: close the open border with a grid of quads (an even number of points)" title="Grid fill: close the open border with a grid of quads (an even number of points)" onclick={gridFillAtPick} ><Icon name="gridFill" size={18} /></button>
            <button class="tool" class:on={isSeam(selEdge)} aria-label="Seam: mark the picked edge as a UV seam, or clear it" title="Seam: mark the picked edge as a UV seam, or clear it" onclick={toggleSeam} ><Icon name="seam" size={18} /></button>
            <button class="tool" class:on={false} aria-label="Smooth by angle: smooth faces where the surface turns less than the Smooth angle, keep hard corners flat" title="Smooth by angle: smooth faces where the surface turns less than the Smooth angle, keep hard corners flat" onclick={autoSmoothNow} ><Icon name="smoothAngle" size={18} /></button>
            <button class="tool" class:on={false} aria-label="Slide edge: slide the picked edge along the surface (quad faces on the side asked for)" title="Slide edge: slide the picked edge along the surface (quad faces on the side asked for)" onclick={slideEdge} ><Icon name="slideEdge" size={18} /></button>
          {/if}
        </div>
        <div class="view" bind:this={box}>
        {#if webglFailed}
          <p class="dim pad">3D drawing is not available in this window (WebGL could not start).</p>
        {/if}
        <canvas bind:this={canvas} tabindex="0" aria-label="3D view" onpointerdown={pointerDown} onpointermove={pointerMove} onpointerup={pointerUp}></canvas>
        {#if viewStats}<div class="statsbadge" role="status">{viewStats.triangles.toLocaleString("en")} triangles · {viewStats.points.toLocaleString("en")} points · {viewStats.faces.toLocaleString("en")} faces · {viewStats.parts} part{viewStats.parts === 1 ? "" : "s"}</div>{/if}
        <svg class="gizmo" viewBox="-44 -44 88 88" width="72" height="72" role="group" aria-label="View axes: click an end to look along it">
          {#each axisDots as d (d.view)}
            {@const cx = d.x * 30}
            {@const cy = d.y * 30}
            <line x1="0" y1="0" x2={cx} y2={cy} stroke={d.label === "X" ? "#ff6b6b" : d.label === "Y" ? "#7ad67a" : "#6cb2ff"} stroke-width="2" opacity={d.positive ? 0.9 : 0.35} />
            <g class="end" role="button" tabindex="-1" aria-label={VIEW_LABELS[d.view] + " view"} onclick={() => showView(d.view)} onkeydown={() => {}} opacity={d.depth < -0.2 ? 0.55 : 1}>
              <circle {cx} {cy} r="9" fill={d.positive ? (d.label === "X" ? "#ff6b6b" : d.label === "Y" ? "#7ad67a" : "#6cb2ff") : "#2c313c"} stroke={d.label === "X" ? "#ff6b6b" : d.label === "Y" ? "#7ad67a" : "#6cb2ff"} stroke-width="1.5" />
              {#if d.positive}<text x={cx} y={cy + 3.5} text-anchor="middle" font-size="10" font-weight="700" fill="#14161c">{d.label}</text>{/if}
            </g>
          {/each}
        </svg>
        <NavButtons controls={() => controls} camera={() => camera} height={() => canvas?.clientHeight ?? 400} />
        {#if rubber}<div class="boxband" style:left="{Math.min(rubber.x0, rubber.x1)}px" style:top="{Math.min(rubber.y0, rubber.y1)}px" style:width="{Math.abs(rubber.x1 - rubber.x0)}px" style:height="{Math.abs(rubber.y1 - rubber.y0)}px"></div>{/if}
        {#if boxArmed && !rubber}<div class="modalbar" role="status">Box select: drag a rectangle over the points (Esc cancels)</div>{/if}
        {#if modal}<div class="modalbar" role="status">{modalLabel(modal.kind, modal.axis, modal.typed, modal.amount)}</div>{/if}
        {#if moveHint}
          <div class="movehint" style:left="{moveHint.x + 16}px" style:top="{moveHint.y - 14}px" role="status">
            <strong>{moveHint.text}</strong>{#if moveHint.how}<span>{moveHint.how}</span>{/if}
          </div>
        {/if}
        {#if snapRing}<div class="snapring" style:left="{snapRing.x}px" style:top="{snapRing.y}px" title="Snaps onto this point"></div>{/if}
        </div>
      </div>
      <div class="areabar" role="tablist" aria-label="Bottom area">
        <button role="tab" aria-selected={mode === "animate"} class:on={mode === "animate"} onclick={() => setUiMode("pose")} title="The timeline: animations, keys and curves (Pose mode)"><Icon name="play" size={13} /> Timeline</button>
        <button role="tab" aria-selected={mode === "texture"} class:on={mode === "texture"} onclick={() => setUiMode("texture")} title="The UV editor: the texture picture and where each shape's block sits (Texture Paint mode)"><Icon name="sprites" size={13} /> UV editor</button>
        {#if mode !== "animate" && mode !== "texture"}<span class="dim small">Pick an area to work in it: the timeline opens Pose mode, the UV editor opens Texture Paint.</span>{/if}
      </div>
      {#if mode === "texture" && picture}
        <div class="uvarea"><div class="texbox"><canvas bind:this={texView} aria-label="The texture picture" onpointerdown={texDown} onpointermove={texMove} onpointerup={texUp} onpointercancel={texUp}></canvas></div></div>
      {/if}
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
          <div class="clips" role="group" aria-label="Animation tools">
            <button title="Copy every key of the chosen part" disabled={!partNames.length} onclick={() => { keyBoard = copyKeys(clip, partNames); animNote = keyBoard ? "Keys copied." : "That part has no keys in this animation."; }}>Copy keys</button>
            <button title="Paste the copied keys with the first at the time marker (onto the chosen part)" disabled={!keyBoard} onclick={() => { if (keyBoard) { commit(pasteKeys(doc, clipIndex, keyBoard, animTime, partNames.length ? partNames : undefined), false, "Paste keys"); animNote = "Keys pasted."; } }}>Paste keys</button>
            <button title="Play the animation backwards" onclick={() => commit(reverseClip(doc, clipIndex), false, "Reverse animation")}>Reverse</button>
            <button title="Swap left and right: parts named left… and right… trade keys, and sideways moves and turns are mirrored" onclick={() => { const next = mirrorClip(doc, clipIndex); animNote = next === doc ? "Nothing to mirror." : "Mirrored."; if (next !== doc) commit(next, false, "Mirror animation"); }}>Mirror left–right</button>
            <button title="Twice as fast (all keys, or the chosen part's if one is chosen)" onclick={() => commit(stretchKeys(doc, clipIndex, 0.5, partNames.length ? partNames : null))}>×½ time</button>
            <button title="Twice as slow" onclick={() => commit(stretchKeys(doc, clipIndex, 2, partNames.length ? partNames : null))}>×2 time</button>
            <button title="Move the keys 0.1 s earlier" onclick={() => commit(shiftKeys(doc, clipIndex, -0.1, partNames.length ? partNames : null))}>−0.1 s</button>
            <button title="Move the keys 0.1 s later" onclick={() => commit(shiftKeys(doc, clipIndex, 0.1, partNames.length ? partNames : null))}>+0.1 s</button>
            <button class:on={autoKey} aria-pressed={autoKey} onclick={() => (autoKey = !autoKey)} title="Record: turning or moving a part with the handles sets keys at the time marker (off: the handles change the part's own pose)">● Record</button>
            <button class:on={curvesOpen} aria-pressed={curvesOpen} onclick={() => (curvesOpen = !curvesOpen)} title="Show the values of the chosen part as curves over time, with the keys as dots to drag">Curves</button>
            {#if otherModels.length}
              <select aria-label="Copy the animations of another model" value="" onchange={(e) => { void copyAnimationsFrom(e.currentTarget.value); e.currentTarget.value = ""; }} title="Copy every animation of another model onto this one: parts are matched by name">
                <option value="" disabled>Copy animations from…</option>{#each otherModels as m (m)}<option value={m}>{m.slice(m.lastIndexOf("/") + 1).replace(".model.json", "")}</option>{/each}
              </select>
            {/if}
            <input class="cname" bind:value={poseName} placeholder="pose name" aria-label="Pose name" />
            <button title="Save how the parts are posed at the time marker, to use again on any animation" disabled={!poseName.trim()} onclick={() => { const next = capturePose(doc, clipIndex, animTime, poseName); if (next) { commit(next, false, "Save pose"); animNote = `Saved the pose “${poseName.trim()}”.`; poseName = ""; } else animNote = "Nothing to save: this animation has no keys at this time, or the pose library is full."; }}>Save pose</button>
            {#each doc.poses ?? [] as ps (ps.name)}
              <span class="chip"><button class="ghost" title="Put this pose on the animation at the time marker (a key for each part it holds)" onclick={() => commit(applySavedPose(doc, clipIndex, animTime, ps.name), false, `Pose: ${ps.name}`)}>{ps.name}</button><button class="ghost" aria-label="Delete the pose {ps.name}" onclick={() => commit(removePose(doc, ps.name), false, "Delete pose")}>✕</button></span>
            {/each}
            {#if limbParts}
              <span class="dim small" title="The chosen part is the top of a limb: its end is put on a target (model units, from the model's origin)">Reach</span>
              {#each [0, 1, 2] as a (a)}<input type="number" class="narrow" step="0.5" aria-label={`reach target ${"xyz"[a]}`} value={reachTarget[a]} onchange={(e) => { const v = [...reachTarget] as [number, number, number]; v[a] = Number(e.currentTarget.value); reachTarget = v; }} />{/each}
              <button class="ghost" onclick={reachFromHand} title="Take the end's present place as the target">from the end</button>
              <select aria-label="The joint bends towards" onchange={(e) => { reachPole = ({ front: [0, 0, 1], back: [0, 0, -1], up: [0, 1, 0], down: [0, -1, 0], left: [1, 0, 0], right: [-1, 0, 0] } as Record<string, [number, number, number]>)[e.currentTarget.value]!; }}>{#each ["front", "back", "up", "down", "left", "right"] as d (d)}<option value={d}>bends {d}</option>{/each}</select>
              <button onclick={reach} title="Set keys at the time marker so that the end of the limb is on the target">Reach</button>
            {/if}
            {#if animNote}<span class="dim small" role="status">{animNote}</span>{/if}
          </div>
          <div class="scrub">
            <button class="primary" onclick={() => { if (animTime >= clip.duration) animTime = 0; playingAnim = !playingAnim; }}>{playingAnim ? "■" : "▶"}</button>
            <div class="track">
              <input type="range" min="0" max={clip.duration} step={KEY_STEP} value={animTime} aria-label="Time" oninput={(e) => { playingAnim = false; animTime = snapTime(Number(e.currentTarget.value)); }} />
              {#each keyTimes as t (t)}
                <button class="diamond" style:left="{(t / clip.duration) * 100}%" title="Key at {fmtTime(t)} s" aria-label="Jump to key at {fmtTime(t)} seconds" class:picked={keyIsPicked(t)} onclick={(e) => clickKey(t, e)}>◆</button>
              {/each}
            </div>
            <span class="dim time">{fmtTime(animTime)} / {fmtTime(clip.duration)} s</span>
          </div>
          {#if pickedKeys.length}
            <div class="row wrap small">
              <span class="dim">{pickedKeys.length} key{pickedKeys.length === 1 ? "" : "s"} picked</span>
              <button onclick={() => { commit(shiftKeysAt(doc, clipIndex, pickedKeys, -0.1, partNames.length ? partNames : null), false, "Move keys"); pickedKeys = pickedKeys.map((t) => Math.max(0, Math.round((t - 0.1) * 100) / 100)); }} title="Move the picked keys 0.1 s earlier">◀ 0.1 s</button>
              <button onclick={() => { commit(shiftKeysAt(doc, clipIndex, pickedKeys, 0.1, partNames.length ? partNames : null), false, "Move keys"); pickedKeys = pickedKeys.map((t) => Math.round((t + 0.1) * 100) / 100); }} title="Move the picked keys 0.1 s later">0.1 s ▶</button>
              <button class="danger" onclick={() => { commit(removeKeysAt(doc, clipIndex, pickedKeys, partNames.length ? partNames : null), false, "Delete keys"); pickedKeys = []; }} title="Delete the picked keys">Delete</button>
              <button class="ghost" onclick={() => (pickedKeys = [])}>Clear</button>
            </div>
          {/if}
          {#if curvesOpen}
            {#if partNames.length}
              <CurveEditor {doc} {clipIndex} part={partNames} time={animTime} oncommit={(next, keep, label) => commit(next, keep, label)} ontime={(t) => { playingAnim = false; animTime = t; }} />
            {:else}<p class="dim small pad">Choose a part to see its curves.</p>{/if}
          {/if}
        </div>
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
          <div class="layers" role="group" aria-label="Surface channels">
            {#if doc.texture?.surface}
              <div class="row wrap">
                <strong class="small">Paint</strong>
                <span class="seg" role="group" aria-label="Channel">
                  {#each [["colour", "Colour", "The colours"], ["roughness", "Roughness", "How rough: white is rough, black is shiny"], ["metal", "Metal", "How metal: white is metal, black is not"], ["bump", "Bumps", "Bumps: white is high, black is low; the game gets a normal map made from them"]] as [id, t, tip] (id)}
                    <button class:on={channel === id} disabled={layered && id !== "colour"} title={tip} onclick={() => setChannel(id as typeof channel)}>{t}</button>
                  {/each}
                </span>
                <button class="ghost danger" onclick={disableSurface} title="Go back to one metal and roughness number per shape">✕</button>
              </div>
              {#if channel !== "colour"}<p class="dim small">Painting {channel}: grey picture, white = more. Colours are kept as they were.</p>{/if}
              {#if doc.texture?.bump || channel === "bump"}
                <label class="inline" title="How deep the painted bumps are in the game's lighting (0 turns them off)">Bump depth <input type="number" min="0" max="4" step="0.25" value={doc.texture?.bump ?? 1} class="narrow" aria-label="Bump depth" onchange={(e) => { const v = Math.max(0, Math.min(4, Number(e.currentTarget.value) || 0)); commit({ ...doc, texture: { ...doc.texture!, bump: v > 0 ? v : undefined } }); }} /></label>
              {/if}
            {:else}
              <button class="ghost" onclick={enableSurface} disabled={layered} title="Paint where the surface is metal and how rough it is (a second picture, read by the game as glTF's metallic-roughness picture). Starts from each shape's own numbers.">Paint roughness and metal</button>
            {/if}
          </div>
          <div class="layers" role="group" aria-label="Painting layers">
            <div class="row wrap">
              <strong class="small">Layers</strong>
              <button class="ghost" disabled={(layerInfos.length || 1) >= MAX_TEX_LAYERS} onclick={() => layerOp((set) => addLayer(set, picture!.w, picture!.h, activeLayer), (set) => Math.min(set.rasters.length - 1, activeLayer + 1))} title="A new empty layer above this one">＋</button>
              <button class="ghost" disabled={!layered} onclick={() => layerOp((set) => duplicateLayer(set, activeLayer), () => activeLayer + 1)} title="A copy of this layer">Copy</button>
              <button class="ghost" disabled={!layered || activeLayer === 0} onclick={() => layerOp((set) => mergeDown(set, activeLayer), () => activeLayer - 1)} title="Join this layer into the one below">Merge ↓</button>
              <button class="ghost danger" disabled={!layered} onclick={() => layerOp((set) => removeLayer(set, activeLayer), () => Math.max(0, activeLayer - 1))} title="Remove this layer and what is painted on it">✕</button>
            </div>
            {#if layered}
              {#each [...layerInfos].map((l, i) => ({ l, i })).reverse() as { l, i } (i)}
                <div class="layerrow" class:on={i === activeLayer}>
                  <button class="ghost" aria-label={l.visible === false ? "Show layer" : "Hide layer"} title={l.visible === false ? "Show this layer" : "Hide this layer"} onclick={() => layerOp((set) => updateLayer(set, i, { visible: l.visible === false }), () => activeLayer)}>{l.visible === false ? "◌" : "●"}</button>
                  <button class="pick" role="option" aria-selected={i === activeLayer} onclick={() => pickLayer(i)}>{l.name}</button>
                  <input type="range" min="0" max="100" step="5" value={Math.round((l.opacity ?? 1) * 100)} aria-label="{l.name} opacity" title="Opacity" onchange={(e) => layerOp((set) => updateLayer(set, i, { opacity: Number(e.currentTarget.value) / 100 }), () => activeLayer)} />
                  <select value={l.blend ?? "normal"} aria-label="{l.name} blend" onchange={(e) => layerOp((set) => updateLayer(set, i, { blend: e.currentTarget.value }), () => activeLayer)}>{#each BLEND_MODES as m (m)}<option value={m}>{m}</option>{/each}</select>
                  <button class="ghost" aria-label="Move up" disabled={i === layerInfos.length - 1} onclick={() => layerOp((set) => moveLayer(set, i, 1), () => (i === activeLayer ? activeLayer + 1 : i + 1 === activeLayer ? activeLayer - 1 : activeLayer))}>▲</button>
                  <button class="ghost" aria-label="Move down" disabled={i === 0} onclick={() => layerOp((set) => moveLayer(set, i, -1), () => (i === activeLayer ? activeLayer - 1 : i - 1 === activeLayer ? activeLayer + 1 : activeLayer))}>▼</button>
                </div>
              {/each}
              <p class="dim small">You paint on the highlighted layer. The game gets them flattened; layer changes are not on the undo list.</p>
            {/if}
          </div>
          <p class="dim small">{picture.w}×{picture.h} texels · {painted.length} painted shape{painted.length === 1 ? "" : "s"}</p>
          <div class="pair">
            <label>Width <select value={picture.w} onchange={(e) => setTextureSize(Number(e.currentTarget.value), picture!.h)}>{#each [16, 32, 64, 128, 256, 512, 1024] as n (n)}<option value={n}>{n}</option>{/each}</select></label>
            <label>Height <select value={picture.h} onchange={(e) => setTextureSize(picture!.w, Number(e.currentTarget.value))}>{#each [16, 32, 64, 128, 256, 512, 1024] as n (n)}<option value={n}>{n}</option>{/each}</select></label>
          </div>
          {#if texTool === "face" && cube?.shape === "mesh"}
            <p class="dim small">Drag an island of this mesh's unwrap (blue rectangles) to put it elsewhere in the block. Seams (Edit mode) cut the mesh into islands.</p>
            <button class="ghost" disabled={!cube.texture?.islands?.length} onclick={() => commit(setCube(doc, selected!, { ...cube, texture: { ...cube.texture!, islands: undefined } }))}>Put the islands back</button>
          {/if}
          {#if texTool === "face"}
            {#if pickedRect && faceSel}
              <h4>{faceSel} face</h4>
              <div class="vec4">{#each ["x", "y", "width", "height"] as lab, k (lab)}<label>{lab}<input type="number" min="0" step="1" value={normRect(pickedRect)[k]} aria-label="{faceSel} {lab}" onchange={(e) => setRectPart(k, e.currentTarget.value)} /></label>{/each}</div>
              <div class="row"><button onclick={() => flipFace(true)} title="Turns the face's picture over, left to right">Flip ↔</button><button onclick={() => flipFace(false)} title="Turns it over, top to bottom">Flip ↕</button><button onclick={resetRect} disabled={!cube?.texture?.faces?.[faceSel]} title="Back to its place in the automatic layout">Reset</button></div>
            {:else}
              <p class="dim small">Click a face rectangle of a painted box in the picture, then drag it or type where it goes. Faces can share the same texels.</p>
            {/if}
          {/if}
          <label class="check" title="Blend the texels in the game, as detailed painting wants (off: sharp square texels, for pixel art)"><input type="checkbox" checked={!!doc.texture?.smooth} onchange={(e) => setSmoothTexels(e.currentTarget.checked)} /> Smooth texels</label>
          {#if cube?.texture}
            <label class="inline">Texels per unit <input type="number" min="0.25" max="8" step="0.25" value={cube.texture.scale ?? 1} onchange={(e) => setScale(e.currentTarget.value)} /></label>
          {/if}
          <div class="row">
            <button onclick={packAll} title="Lays every shape's block out again (painted pixels stay where they are)">Pack blocks</button>
            <button onclick={() => toggleTexture(true)} disabled={!selected || selected.cube === undefined || !!cube?.texture} title="Give the selected shape a block of the picture">Paint selected</button>
          </div>
          <div class="row wrap">
            <button onclick={bakeNormalsNow} disabled={normalBusy || !doc.texture || !hasHigh} title={hasHigh ? "Bake the high-poly part's surface detail into a normal map for the painted shapes (the game lights them with it)" : "Mark a part as the high-poly source first (Part panel)"}>Bake normals</button>
            <label class="inline" title="How far out from the surface a ray starts, in model units: more than the high part rises above it">Cage <input type="number" min="0.5" max="64" step="0.5" bind:value={normalCage} class="narrow" aria-label="Cage distance" /></label>
            {#if doc.texture?.normals}<button class="ghost danger" onclick={dropNormals} title="Remove the baked normal map">✕ Normals</button>{/if}
          </div>
          <div class="row wrap">
            <select bind:value={projectPath} aria-label="Picture to project" title="A picture from the project to throw onto the model"><option value="">Picture…</option>{#each projectable as p (p)}<option value={p}>{p.split("/").at(-1)}</option>{/each}</select>
            <button onclick={projectPicture} disabled={!projectPath} title="Throw the picture onto the model from where you are looking: faces that look at you and are not hidden take its colours (at the paint opacity), on the layer being painted">Project from view</button>
          </div>
          <div class="row wrap">
            <button onclick={bakeSun} disabled={baking || !doc.texture} title="Light the texture from one direction, with shadows (the three numbers say where the sun is)">Sunlight</button>
            <label class="inline" title="Where the sun is, as a direction from the model (x, y, z); y up">Sun <input type="number" step="0.1" bind:value={sunX} class="narrow" aria-label="Sun x" /> <input type="number" step="0.1" bind:value={sunY} class="narrow" aria-label="Sun y" /> <input type="number" step="0.1" bind:value={sunZ} class="narrow" aria-label="Sun z" /></label>
            <button onclick={bakeWear} disabled={baking || !doc.texture} title="Lighten the texture on convex edges and darken it in creases (curvature)">Edge wear</button>
            <button onclick={bakeAO} disabled={baking || !doc.texture} title="Darken the texture where shapes close in on each other (ambient occlusion): crevices and the feet of things">Bake occlusion</button>
            <label class="inline" title="How dark the most enclosed spots get">Strength <input type="number" min="0.1" max="1" step="0.1" bind:value={bakeStrength} class="narrow" /></label>
            <label class="inline" title="Rays per texel: more is smoother and slower">Rays <input type="number" min="8" max="128" step="8" bind:value={bakeSamples} class="narrow" /></label>
            <label class="inline" title="How far a ray looks for something in the way, in model units">Reach <input type="number" min="1" max="64" step="1" bind:value={bakeDistance} class="narrow" /></label>
          </div>
          <div class="row wrap">
            <button onclick={checkUv} title="How many texels each shape has per unit, and how stretched its faces are">Check UVs</button>
            <button onclick={evenOut} title="Give every painted shape the same texels per unit, then lay the blocks out again (painted pixels stay where they were)">Even out density</button>
            <button onclick={showChecker} disabled={!doc.texture} title="Cover the texture with a checker pattern to see stretching on the model (undo brings your painting back)">Checker</button>
          </div>
          {#each uvRows as r (r.name + r.cube + r.parts.join())}
            <p class="small" class:warn={r.stretch > 1.3 || r.densityMax > r.densityMin * 1.3}>{r.name}: {r.density.toFixed(1)} texels per unit{r.stretch > 1.3 ? `, stretched ${Number.isFinite(r.stretch) ? r.stretch.toFixed(1) : "badly"}×` : ""}{r.densityMax > r.densityMin * 1.3 ? `, uneven (${r.densityMin.toFixed(1)} to ${r.densityMax.toFixed(1)})` : ""}</p>
          {/each}
          {#if bakeNote}<p class="dim small" role="status">{bakeNote}</p>{/if}
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
          <div class="proptabs" role="tablist" aria-label="Pose properties">
            <button role="tab" aria-selected={poseTab === "pose"} class:on={poseTab === "pose"} onclick={() => (poseTab = "pose")} title="Position, turn and size of this part, and the keys">Pose</button>
            <button role="tab" aria-selected={poseTab === "rules"} class:on={poseTab === "rules"} onclick={() => (poseTab = "rules")} title="Limits, copies and reach, and skinning">Rules</button>
          </div>
          {#if poseTab === "pose"}
          {#each [["position", "Position"], ["rotation", "Rotation (°)"], ["scale", "Scale"]] as [prop, label] (prop)}
            <h4>{label} {#if keyedHere(prop as Prop)}<span class="keyed" title="There is a key here">◆</span>{/if}</h4>
            <div class="vec">{#each poseValue(prop as Prop) as v, i (i)}<input type="number" step={prop === "scale" ? 0.1 : 1} value={v} aria-label={`${"xyz"[i]} ${prop}`} onchange={(e) => setPoseValue(prop as Prop, i, e.currentTarget.value)} />{/each}</div>
            <button class="ghost keybtn" onclick={() => keyProp(prop as Prop)}>◆ Key {prop}</button>
          {/each}
          {/if}
          {#if poseTab === "rules"}
          <div class="row wrap"><button onclick={skinEverything} title="Make every mesh of the model bend with the parts it sits among (weights worked out from where the parts are)">Auto-skin all meshes</button></div>
          <h4>Constraints <span class="dim small">(studio only: bake them into keys for the game)</span></h4>
          {#each myConstraints as c, ci (ci)}
            <div class="row wrap small">
              {#if c.type === "limit"}
                <strong>Limit turn</strong>
                {#each [0, 1, 2] as a (a)}<input type="number" class="narrow" step="5" aria-label={`limit min ${"xyz"[a]}`} value={c.min[a]} onchange={(e) => { const min = [...c.min] as Vec3; min[a] = Number(e.currentTarget.value); setMine(myConstraints.map((x, k) => (k === ci ? { ...c, min } : x))); }} /> {/each}
                <span class="dim">to</span>
                {#each [0, 1, 2] as a (a)}<input type="number" class="narrow" step="5" aria-label={`limit max ${"xyz"[a]}`} value={c.max[a]} onchange={(e) => { const max = [...c.max] as Vec3; max[a] = Number(e.currentTarget.value); setMine(myConstraints.map((x, k) => (k === ci ? { ...c, max } : x))); }} /> {/each}
              {:else if c.type === "copy"}
                <strong>Copy turn of</strong>
                <select value={c.from} aria-label="Part to copy" onchange={(e) => setMine(myConstraints.map((x, k) => (k === ci ? { ...c, from: e.currentTarget.value } : x)))}>{#each allPartPaths as pp (pp)}<option value={pp}>{pp}</option>{/each}</select>
                {#each ["x", "y", "z"] as ax, a (ax)}<label class="check"><input type="checkbox" checked={c.axes[a]} onchange={(e) => { const axes = [...c.axes] as [boolean, boolean, boolean]; axes[a] = e.currentTarget.checked; setMine(myConstraints.map((x, k) => (k === ci ? { ...c, axes } : x))); }} />{ax}</label>{/each}
                <label class="inline">mix <input type="number" class="narrow" min="0" max="1" step="0.1" value={c.mix} onchange={(e) => setMine(myConstraints.map((x, k) => (k === ci ? { ...c, mix: Math.max(0, Math.min(1, Number(e.currentTarget.value))) } : x)))} /></label>
              {:else}
                <strong>Reach</strong>
                {#each [0, 1, 2] as a (a)}<input type="number" class="narrow" step="0.5" aria-label={`reach target ${"xyz"[a]}`} value={c.target[a]} onchange={(e) => { const target = [...c.target] as Vec3; target[a] = Number(e.currentTarget.value); setMine(myConstraints.map((x, k) => (k === ci ? { ...c, target } : x))); }} /> {/each}
              {/if}
              <button class="ghost" aria-label="Remove this constraint" onclick={() => setMine(myConstraints.filter((_, k) => k !== ci))}>✕</button>
            </div>
          {/each}
          <div class="row wrap">
            <button disabled={myConstraints.length >= 4} onclick={() => setMine([...myConstraints, { type: "limit", min: [-45, -45, -45], max: [45, 45, 45] }])}>＋ Limit</button>
            <button disabled={myConstraints.length >= 4} onclick={() => setMine([...myConstraints, { type: "copy", from: allPartPaths[0] ?? "", axes: [true, true, true], mix: 1 }])}>＋ Copy</button>
            <button disabled={myConstraints.length >= 4 || !part?.children[0]?.children[0]} title="Needs a part with a part below it and another below that (a shoulder, elbow, hand)" onclick={() => setMine([...myConstraints, { type: "reach", target: [...reachTarget] as [number, number, number] }])}>＋ Reach</button>
          </div>
          {#if clip}
            <div class="row wrap">
              <button onclick={() => { const r = bakeConstraints(doc, clipIndex, 30, bakeRemove); if (r.baked.length) { commit(r.doc, false, "Bake constraints"); animNote = `Baked ${r.baked.length} part${r.baked.length === 1 ? "" : "s"} into rotation keys.`; } else animNote = "No part has a constraint."; }} title="Write what the constraints do into rotation keys over this whole animation (the game plays keys)">Bake into keys</button>
              <label class="check"><input type="checkbox" bind:checked={bakeRemove} /> and remove the rules</label>
            </div>
          {/if}
          {/if}
          {#if poseTab === "pose"}
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
        {/if}
      {:else if selected && cube}
        <h3>{cube.shape === "mesh" ? "Mesh" : "Shape"}</h3>
        <div class="proptabs" role="tablist" aria-label="Properties">
          {#each PROP_TABS as t (t.id)}
            {#if t.id !== "mesh" || inEdit}<button role="tab" aria-selected={propTab === t.id} class:on={propTab === t.id} onclick={() => (propTab = t.id)} aria-label={t.title} title="{t.title}: {t.help}"><Icon name={t.icon} size={16} />{#if propTab === t.id} {t.title}{/if}</button>{/if}
          {/each}
        </div>
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
        {#if propTab === "material"}
        <label title="0 is lit by the scene like anything else; 1 shines at full brightness even in the dark (lamps, windows, tail lights)">Glow <input type="range" min="0" max="1" step="0.05" value={cube.emissive ?? 0} aria-label="Glow" oninput={(e) => commit(updateCube(doc, selected!, { emissive: Number(e.currentTarget.value) }))} /><span class="dim small">{Math.round((cube.emissive ?? 0) * 100)}%</span></label>
        <label title="0 is paint or plastic, 1 is bare metal (the game reads this when nova.json says materials: true)">Metal <input type="range" min="0" max="1" step="0.05" value={cube.metallic ?? 0} aria-label="Metallic" oninput={(e) => commit(updateCube(doc, selected!, { metallic: Number(e.currentTarget.value) }))} /><span class="dim small">{Math.round((cube.metallic ?? 0) * 100)}%</span></label>
        <label title="0 is a mirror finish, 1 is matt">Roughness <input type="range" min="0" max="1" step="0.05" value={cube.roughness ?? 1} aria-label="Roughness" oninput={(e) => commit(updateCube(doc, selected!, { roughness: Number(e.currentTarget.value) }))} /><span class="dim small">{Math.round((cube.roughness ?? 1) * 100)}%</span></label>
        {/if}
        {#if propTab === "object"}
        <h4>{cube.shape === "mesh" ? "Box around it: corner" : "Corner (from)"}</h4>
        <div class="vec">{#each cube.from as v, i (i)}<input type="number" value={v} aria-label={"xyz"[i] + " from"} onchange={(e) => setVec("from", i, e.currentTarget.value)} />{/each}</div>
        <h4>Size</h4>
        <div class="vec">{#each cube.size as v, i (i)}<input type="number" min="0" value={v} aria-label={"xyz"[i] + " size"} onchange={(e) => setVec("size", i, e.currentTarget.value)} />{/each}</div>
        {#if cube.shape !== "mesh"}
          <h4>Turn (degrees)</h4>
          <div class="vec">{#each cube.rotation ?? [0, 0, 0] as v, i (i)}<input type="number" value={v} aria-label={"xyz"[i] + " turn"} onchange={(e) => { const r = [...(cube.rotation ?? [0, 0, 0])] as Vec3; r[i] = num(e.currentTarget.value, v); commit(updateCube(doc, selected!, { rotation: r })); }} />{/each}</div>
        {/if}
        {/if}
        {#if propTab === "material"}
        <h4>Colour</h4>
        <ProjectSwatches onpick={(hex) => pickColour("all", hex)} />
        <label class="colour">{cube.texture ? "Tint" : cube.shape === "mesh" ? "Mesh" : "All faces"} <input type="color" value={hexOf(cube.color)} onchange={(e) => pickColour("all", e.currentTarget.value)} /></label>
        {#each paintFaces as f (f)}
          <label class="colour">{label(f)} <input type="color" value={hexOf(faceColor(cube, f))} onchange={(e) => pickColour(f, e.currentTarget.value)} /></label>
        {/each}
        <label class="check"><input type="checkbox" checked={!!cube.texture} disabled={!hasVolume(cube)} onchange={(e) => toggleTexture(e.currentTarget.checked)} /> Paint with the model's texture</label>
        {/if}
        {#if propTab === "object"}
        <h4>Shape tools</h4>
        <div class="row">
          <button class:on={inEdit} onclick={() => (inEdit ? (editPoints = false) : makeEditable())} title={cube.shape === "mesh" ? "Move points and pull faces" : "Turns this into a free mesh you can pull into shape (undo brings the shape back)"}>{inEdit ? "Done with points" : "Edit points"}</button>
        </div>
        {/if}
        {#if propTab === "bones"}
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
            <div class="row"><span class="row wrap small" title="Blend two parts along an axis: whole one at the start, whole other at the end (only the picked points when some are picked)">
              Gradient
              <select bind:value={gradA} aria-label="Part at the start">{#each cube.skin.bones as bn (bn)}<option value={bn}>{bn.split("/").at(-1)}</option>{/each}</select>→
              <select bind:value={gradB} aria-label="Part at the end">{#each cube.skin.bones as bn (bn)}<option value={bn}>{bn.split("/").at(-1)}</option>{/each}</select>
              <select bind:value={gradAxis} aria-label="Axis"><option value={0}>x</option><option value={1}>y</option><option value={2}>z</option></select>
              <input type="number" class="narrow" bind:value={gradFrom} aria-label="Start coordinate" /> to <input type="number" class="narrow" bind:value={gradTo} aria-label="End coordinate" />
              <button onclick={applyWeightGradient}>Apply</button>
            </span><button onclick={() => mirrorSkin("positive")} title="Copy the +x side's weights to the -x side, left bones becoming right ones">Mirror →</button><button onclick={() => mirrorSkin("negative")} title="Copy the -x side's weights to the +x side">← Mirror</button><button onclick={autoSkin} title="Works the weights out again from where the parts are (hand-set weights are lost)">Auto weights</button><button class="danger" onclick={unskin}>Stop bending</button></div>
          {:else}
            <div class="row"><button onclick={autoSkin} title="The shape bends where parts meet, like a sleeve at the elbow, instead of staying stiff">Bend with the parts around it</button></div>
          {/if}
          {#if skinNote}<p class="dim small">{skinNote}</p>{/if}
        {:else}
          <p class="dim small">Only a mesh can bend with the parts: use Edit points to make this shape a mesh first.</p>
        {/if}
        {/if}
        {#if propTab === "modifiers"}
        <h4>Modifiers</h4>
        {#if cube.skin}
          <p class="dim small">A mesh that bends with parts cannot have modifiers: its weights belong to its points.</p>
        {:else}
          <ModifierStack mods={cube.modifiers ?? []} onchange={setModifiers} onapply={applyModifierAt} />
          {#if hasModifiers(cube) && !inEdit}<p class="dim small">Showing the finished shape. Click "Edit points" to work on the cage underneath.</p>{/if}
        {/if}
        {/if}
        {#if propTab === "object"}
        <div class="row mirror">
          <span class="dim small">Mirror copy</span>
          {#each [0, 1, 2] as a (a)}<button onclick={() => mirrorCopy(a as Axis)} title={`A reflected copy across the part's ${"xyz"[a]} = 0 plane`}>{"XYZ"[a]}</button>{/each}
        </div>
        {/if}
        {#if inEdit && propTab === "mesh"}
          <h4>Shape keys</h4>
          {#if cube.keyEdit !== undefined}<p class="note small">Editing the key “{cube.keyEdit}”: what you move now is the key; the shape itself comes back when you press Done.</p>{/if}
          {#each cube.shapes ?? [] as k (k.name)}
            <div class="row wrap small">
              <strong>{k.name}</strong>
              <input type="range" min="0" max="1" step="0.05" value={keyWeights[k.name] ?? 0} aria-label="{k.name} weight" title="Preview this key" oninput={(e) => (keyWeights = { ...keyWeights, [k.name]: Number(e.currentTarget.value) })} />
              <button class:on={cube.keyEdit === k.name} onclick={() => toggleKeyEdit(k.name)} title={cube.keyEdit === k.name ? "Go back to the shape" : "Move the points to make this key (the preview is off while you edit)"}>{cube.keyEdit === k.name ? "Done" : "Edit"}</button>
              <button class="ghost danger" aria-label="Remove {k.name}" onclick={() => dropKey(k.name)}>✕</button>
            </div>
          {/each}
          <div class="row wrap small">
            <input class="cname" bind:value={newKeyName} placeholder="new key (smile)" aria-label="Name of a new shape key" maxlength="24" onkeydown={(e) => { if (e.key === "Enter") addKey(); }} />
            <button onclick={addKey} disabled={!newKeyName.trim()} title="A new key that starts as a copy of the shape: press Edit and move the points to make it. The game blends keys by name, with the morph option of nova.model">＋ Key</button>
          </div>
          {#if (cube.shapes?.length ?? 0) > 0 && cube.modifiers?.length}<p class="note small">This shape has modifiers: its keys are not written to the game.</p>{/if}
          <h4>Points</h4>
          {#if selVerts.length}
            <p class="dim small">{selVerts.length === 1 ? "The picked point" : `The middle of ${selVerts.length} picked points`}: type a number, or drag the arrows (one axis) or squares (a flat plane) of its handle.</p>
            <div class="vec axes">{#each [0, 1, 2] as i (i)}<label style:--axis={AXIS_CSS[i]}><span>{"XYZ"[i]}</span><input type="number" step="0.5" value={pickedCentre[i]} aria-label={"xyz"[i] + (selVerts.length === 1 ? " of the point" : " of the points' middle")} onchange={(e) => setCentreAxis(i, e.currentTarget.value)} /></label>{/each}</div>
          {:else}
            <p class="dim small">Click a dot or a face.</p>
          {/if}
          <label class="check"><input type="checkbox" bind:checked={snap} /> Snap to whole units</label>
          <label class="check" title="A dragged point jumps onto another point when it comes close"><input type="checkbox" bind:checked={snapPoints} /> Snap to other points</label>
          <label>Symmetry <select bind:value={symmetry} aria-label="Symmetry"><option value="off">Off</option><option value="0">Mirror left–right (x)</option><option value="1">Mirror up–down (y)</option><option value="2">Mirror front–back (z)</option></select></label>
          <div class="row">
            <button onclick={makeFace} disabled={selVerts.length < 3} title="Fills a face between the picked points">Make face</button>
            <button onclick={knifeAcross} disabled={selVerts.length !== 2} title="Cuts every face between the two picked points along a plane through them and the way you are looking (look at the mesh from where you want the cut to go across)">Cut across</button>
            <button onclick={knife} disabled={selVerts.length !== 2} title="Cuts a face in two along a line between the two picked points">Knife</button>
            <button class="danger" onclick={removePointsPicked} disabled={!selVerts.length}>Delete points</button>
          </div>
          {#if selEdge}
            <h4>Edge</h4>
            <label class="inline" title="For the Subdivision modifier: 1 keeps this edge sharp however many times the shape is rounded, 0 lets it round off"><span>Crease</span> <input type="number" min="0" max="1" step="0.25" value={creaseOf(cube, selEdge[0], selEdge[1])} aria-label="Crease" onchange={(e) => setCrease(Number(e.currentTarget.value))} /></label>
            <div class="pair"><label class="inline">Width % <input type="number" min="2" max="50" step="5" bind:value={bevelBy} /></label><label class="inline">Pull by <input type="number" step="1" bind:value={edgeBy} /></label></div>
            <div class="row"><button onclick={bevel} title="Cuts the edge off with a narrow slanting face">Bevel</button><button onclick={extendEdge} title="Pulls an open edge away, widening the sheet">Extend</button></div>
          {/if}
          <h4>Face</h4>
          {#if selFace !== null && cube.polys?.[selFace]}
            <p class="dim small">Press E to pull the face out with the mouse.</p>
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
          <MeshTools {cube} {selVerts} {selFace} {selEdge} onchange={change} onlods={addLods} />
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
        <label class="check" title="The part and everything in it is used only to bake normals onto the painted shapes: it is not exported and does not show in other bakes"><input type="checkbox" checked={!!part.bakeSource} onchange={(e) => commit(updatePart(doc, selected!.parts, { bakeSource: e.currentTarget.checked }))} /> High-poly source for baking (not exported)</label>
        <p class="dim small">A part moves and turns about its pivot, with its shapes and child parts. Use parts for things that will move on their own later, like wheels. A mirror copy is a new part without the animation keys.</p>
        <div class="row"><button onclick={duplicate}>Duplicate</button><button class="danger" onclick={remove} disabled={doc.parts.length === 1 && selected.parts.length === 1}>Delete</button></div>
      {:else}
        <h3>Model</h3>
        <ModelStats {doc} />
        <ReferencePanel refs={references} onchange={(next) => (references = next)} />
        <label>Export scale <input type="number" step="0.001" min="0.0001" value={doc.scale} onchange={(e) => commit({ ...doc, scale: Math.max(0.0001, num(e.currentTarget.value, doc.scale)) })} /></label>
        <p class="dim small">World units per model unit. 1/16 = 0.0625 makes a 16-unit cube one world unit.</p>
        <h4>Collision</h4>
        <p class="dim small">Shapes on the ground that a car or a character bumps into (green in the view): circles for trunks and posts, capsules for long round things, boxes for walls and buildings. A game reads them with <code>nova.model_shapes("{modelName}")</code>; scenery marked <code>static</code> uses them automatically (a box is covered with circles, so its corners are a little rounded).</p>
        {#each doc.colliders ?? [] as c, i (i)}
          <div class="collider">
            <label class="inline">x <input type="number" step="0.5" value={c.x} aria-label={`circle ${i + 1} x`} onchange={(e) => commit(updateCollider(doc, i, { x: num(e.currentTarget.value, c.x) }))} /></label>
            <label class="inline">z <input type="number" step="0.5" value={c.z} aria-label={`circle ${i + 1} z`} onchange={(e) => commit(updateCollider(doc, i, { z: num(e.currentTarget.value, c.z) }))} /></label>
            <label class="inline">radius <input type="number" step="0.5" min="0.1" value={c.r} aria-label={`circle ${i + 1} radius`} onchange={(e) => commit(updateCollider(doc, i, { r: num(e.currentTarget.value, c.r) }))} /></label>
            <button class="danger" title="Remove this circle" aria-label={`remove circle ${i + 1}`} onclick={() => commit(removeCollider(doc, i))}>✕</button>
          </div>
        {/each}
        {#each doc.capsules ?? [] as c, i (i)}
          <div class="collider">
            <span class="dim small">capsule</span>
            {#each [["ax", "from x"], ["az", "from z"], ["bx", "to x"], ["bz", "to z"]] as const as [key, label] (key)}
              <label class="inline">{label} <input type="number" step="0.5" value={c[key]} aria-label={`capsule ${i + 1} ${label}`} onchange={(e) => commit(updateCapsule(doc, i, { [key]: num(e.currentTarget.value, c[key]) }))} /></label>
            {/each}
            <label class="inline">radius <input type="number" step="0.5" min="0.1" value={c.r} aria-label={`capsule ${i + 1} radius`} onchange={(e) => commit(updateCapsule(doc, i, { r: num(e.currentTarget.value, c.r) }))} /></label>
            <button class="danger" title="Remove this capsule" aria-label={`remove capsule ${i + 1}`} onclick={() => commit(removeCapsule(doc, i))}>✕</button>
          </div>
        {/each}
        {#each doc.boxes ?? [] as c, i (i)}
          <div class="collider">
            <span class="dim small">box</span>
            {#each [["x", "x"], ["z", "z"], ["hw", "half width"], ["hl", "half length"], ["turn", "turn°"]] as const as [key, label] (key)}
              <label class="inline">{label} <input type="number" step="0.5" value={c[key]} aria-label={`box ${i + 1} ${label}`} onchange={(e) => commit(updateBox(doc, i, { [key]: num(e.currentTarget.value, c[key]) }))} /></label>
            {/each}
            <button class="danger" title="Remove this box" aria-label={`remove box ${i + 1}`} onclick={() => commit(removeBox(doc, i))}>✕</button>
          </div>
        {/each}
        <div class="row">
          <button onclick={() => commit(addCollider(doc, { x: 0, z: 0, r: 8 }))} disabled={(doc.colliders?.length ?? 0) >= MAX_COLLIDERS}>＋ Circle</button>
          <button onclick={() => commit(addCapsule(doc, { ax: 0, az: -8, bx: 0, bz: 8, r: 4 }))} disabled={(doc.capsules?.length ?? 0) >= MAX_COLLIDERS}>＋ Capsule</button>
          <button onclick={() => commit(addBox(doc, { x: 0, z: 0, hw: 4, hl: 8, turn: 0 }))} disabled={(doc.boxes?.length ?? 0) >= MAX_COLLIDERS}>＋ Box</button>
        </div>
        <p class="dim small">Saving writes <code>{glbPath}</code>. In Lua: <code>nova.model("{modelName}", x, y, z)</code>.</p>
        <p class="dim small">Click a shape in the view or the list to edit it. Shapes: box, wedge, pyramid, cylinder, cone, sphere, or a free mesh you pull into shape point by point. Colours are flat per face.</p>
      {/if}
    </aside>
  </div>
{/if}

<style>
  .gizmo { position: absolute; right: 40px; bottom: 10px; z-index: 3; }
  .gizmo .end { cursor: pointer; }
  .statsbadge { position: absolute; right: 52px; top: 8px; padding: 2px 8px; border-radius: 10px; font-size: 11px; background: color-mix(in srgb, var(--panel) 80%, transparent); border: 1px solid var(--line); pointer-events: none; }
  .layerrow { display: flex; align-items: center; gap: 4px; padding: 2px; border-radius: 4px; }
  .layerrow.on { background: color-mix(in srgb, var(--accent) 22%, transparent); }
  .layerrow .pick { flex: 1; min-width: 0; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .layerrow input[type="range"] { width: 56px; }
  .layerrow select { max-width: 78px; }
  .histwrap { position: relative; display: inline-block; }
  .histlist { position: absolute; top: 100%; left: 0; z-index: 20; min-width: 200px; max-height: 260px; overflow: auto; display: flex; flex-direction: column; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4); padding: 4px; }
  .histlist button { text-align: left; border: none; background: transparent; padding: 3px 8px; }
  .histlist button:hover { background: color-mix(in srgb, var(--accent) 22%, transparent); }
  .histlist .redo { opacity: 0.6; }
  .histlist .now { padding: 2px 8px; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); margin: 2px 0; }
  /* the viewport on the left; on the right the outliner (the part list) above the properties, as in Blender */
  .editor3d { height: 100%; display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-rows: minmax(120px, 38%) minmax(0, 1fr); min-height: 0; }
  .editor3d > .outliner { grid-column: 2; grid-row: 1; border-left: 1px solid var(--line); border-bottom: 1px solid var(--line); min-width: 0; }
  .editor3d > .stage { grid-column: 1; grid-row: 1 / 3; }
  .editor3d > .inspector { grid-column: 2; grid-row: 2; }
  .outliner, .inspector { background: var(--panel); overflow: auto; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
  .outliner { border-right: 1px solid var(--line); padding: 0; }
  .outliner ul { list-style: none; margin: 0; padding: 4px 0; overflow: auto; }
  .collider { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; margin: 2px 0; }
  .collider input { width: 56px; }
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
  .boxband { position: absolute; border: 1px solid #ffd166; background: rgba(255, 209, 102, 0.12); pointer-events: none; z-index: 3; }
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
  .modalbar { position: absolute; left: 50%; top: 10px; transform: translateX(-50%); background: color-mix(in srgb, var(--panel) 92%, transparent); border: 1px solid var(--accent); border-radius: 8px; padding: 5px 12px; font-size: 12px; z-index: 6; pointer-events: none; }
  .stage { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .modeselect { font-weight: 600; }
  .editor3d { position: relative; }
  .splitter { position: absolute; top: 0; bottom: 0; width: 6px; z-index: 6; cursor: ew-resize; touch-action: none; }
  .splitter:hover { background: color-mix(in srgb, var(--accent) 40%, transparent); }
  .proptabs { display: flex; flex-wrap: wrap; gap: 2px; margin: 2px 0 8px; border-bottom: 1px solid var(--line); }
  .proptabs button { border: none; border-bottom: 2px solid transparent; border-radius: 0; background: transparent; padding: 4px 9px; font-size: 12px; display: inline-flex; align-items: center; gap: 4px; }
  .proptabs button.on { border-bottom-color: var(--accent); color: var(--text); font-weight: 600; }
  .uvarea { background: var(--panel); border-top: 1px solid var(--line); padding: 6px; max-height: 42%; overflow: auto; display: flex; justify-content: center; }
  .uvarea .texbox { max-height: none; }
  .areabar { display: flex; align-items: center; gap: 4px; padding: 2px 8px; background: var(--panel); border-top: 1px solid var(--line); min-height: 26px; }
  .areabar button { border: none; border-bottom: 2px solid transparent; border-radius: 0; background: transparent; padding: 2px 8px; font-size: 12px; color: var(--dim); display: inline-flex; align-items: center; gap: 4px; }
  .areabar button.on { color: var(--text); border-bottom-color: var(--accent); }
  .viewrow { flex: 1; min-height: 0; display: flex; }
  .viewrow > .view { flex: 1; min-width: 0; }
  .toolopts { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 3px 8px; background: color-mix(in srgb, var(--panel) 85%, var(--bg)); border-bottom: 1px solid var(--line); font-size: 12px; }
  .toolopts input[type="range"] { width: 90px; }
  .overlays { display: flex; flex-direction: column; gap: 6px; padding: 8px; min-width: 190px; right: 0; left: auto; }
  .shelf { width: 42px; flex: none; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px 0; background: var(--panel); border-right: 1px solid var(--line); overflow-y: auto; }
  .shelf:not(:has(button)) { display: none; }
  .shelf hr { width: 24px; border: none; border-top: 1px solid var(--line); margin: 3px 0; }
  .tool { width: 32px; height: 32px; padding: 0; display: grid; place-items: center; border-radius: 6px; background: transparent; border: 1px solid transparent; color: var(--dim); }
  .tool:hover:not(:disabled) { color: var(--text); background: var(--panel-2); }
  .tool.on { color: #fff; background: var(--accent-2); border-color: var(--accent-2); }
  .bar { display: flex; align-items: center; gap: 8px; padding: 4px 8px; background: var(--panel); border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .check { display: flex; align-items: center; gap: 4px; } .check input { margin: 0; }
  .spacer { flex: 1; }
  .view { flex: 1; min-height: 0; position: relative; overflow: hidden; background: #15171c; }
  .view canvas { position: absolute; inset: 0; display: block; outline: none; touch-action: none; }
  .pad { padding: 24px; position: relative; z-index: 1; }
  h3 { margin: 2px 0 4px; font-size: 13px; }
  h4 { margin: 6px 0 0; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--dim); }
  label { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--dim); }
  label input { color: var(--text); }
  .vec { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; } .vec input { min-width: 0; padding: 3px 4px; }
  .vec.axes label { display: flex; flex-direction: row; align-items: center; gap: 3px; min-width: 0; } .vec.axes span { color: var(--axis); font-weight: 700; font-size: 11px; width: 9px; flex: none; } .vec.axes input { flex: 1; width: 100%; border-color: color-mix(in srgb, var(--axis) 45%, var(--line)); }
  .movehint { position: fixed; z-index: 30; pointer-events: none; display: flex; flex-direction: column; gap: 2px; background: color-mix(in srgb, var(--panel) 92%, transparent); border: 1px solid var(--line); border-radius: 6px; padding: 4px 8px; font-size: 12px; box-shadow: 0 4px 14px #0007; max-width: 420px; }
  .movehint strong { font-variant-numeric: tabular-nums; font-weight: 600; } .movehint span { color: var(--dim); font-size: 11px; }
  .snapring { position: fixed; z-index: 29; pointer-events: none; width: 22px; height: 22px; margin: -11px 0 0 -11px; border: 2px solid #ffd166; border-radius: 50%; box-shadow: 0 0 0 2px #0008; }
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
  .diamond.picked { color: var(--accent); font-size: 15px; }
  .diamond { position: absolute; top: 14px; transform: translateX(-50%); padding: 0; border: none; background: transparent; color: var(--warn); font-size: 12px; line-height: 12px; cursor: pointer; }
  .time { width: 110px; text-align: right; font-variant-numeric: tabular-nums; }
  .keyed { color: var(--warn); }
  .keybtn { align-self: flex-start; padding: 0 6px; font-size: 11px; }
  .small { font-size: 11px; margin: 4px 0; }
  .note { color: var(--accent); }
  .bad { padding: 32px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
  .sculptmore { position: relative; }
  .sculptmore summary { cursor: pointer; user-select: none; padding: 2px 8px; border: 1px solid var(--line); border-radius: 4px; }
  .sculptpop { position: absolute; z-index: 30; top: 100%; left: 0; margin-top: 4px; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 10px 12px; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; box-shadow: 0 4px 14px rgba(0,0,0,.35); white-space: nowrap; }
  .sculptpop .group { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
</style>
