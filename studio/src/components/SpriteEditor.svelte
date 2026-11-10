<script lang="ts">
  import { resizable } from "../lib/resize";
  import { onMount, tick, untrack } from "svelte";
  import { commands } from "../lib/commands";
  import { placesOf, strokeMaps } from "../lib/symmetry";
  import { encodeGif, scaleRaster } from "../lib/gif";
  import { addTextLayer, rasterizeText, setLayerText } from "../lib/sprite-text-layer";
  import { LAYER_FX, LAYER_FX_TYPES, MAX_LAYER_FX, addLayerEffect, moveLayerEffect, removeLayerEffect, setLayerEffectParam, toggleLayerEffect, type LayerFxType } from "../lib/layer-fx";
  import { encodeIndexedPng, paletteOfPicture, toIndexed } from "../lib/indexed";
  import { PROJECT_PALETTES_PATH, parseProjectPalettes, serializeProjectPalettes, withPalettes } from "../lib/project-palettes";
  import { rotSprite, rotateNearest, scaleTo } from "../lib/sprite-transform";
  import { drawText, textSize } from "../lib/pixel-text";
  import { needsMap, scrollToCentre, visibleBox } from "../lib/minimap";
  import { BRUSH_SHAPES, DITHERS, brushFromRaster, brushOffsets, gradientFill, pressureOpacityStroke, pressureSize, shadeColor, stampBrush, stampPicture, type BrushShape, type Dither, type PictureBrush } from "../lib/brush";
  import { encodeApng } from "../lib/apng";
  import SpriteExportDialog from "./SpriteExportDialog.svelte";
  import { importAnimation } from "../lib/sprite-import";
  import { toBase64 } from "../lib/wav";
  import { boundsOf, combine, emptyMask, growMask, has, invertMask, isEmpty, isRect, liftMasked, maskFromColor, maskFromEllipse, maskFromPolygon, maskFromRect, maskFromStroke, outlineSegments, placeMask, type Combine, type Mask } from "../lib/selection";
  import { commandsRev } from "../lib/commands-rev.svelte";
  import { PaletteStore, normalizeHex, nearestColor, paletteFromImage, parsePalette, ramp, shadeRamp, sortColors, swapColors as swapSwatches, toGpl, toJascPal, type Palette, type SortBy } from "../lib/palette";
  import { type Area, brighten, colorCurve, dropShadow, flipRaster, gradientMap, grayscale, hueShift, invertColors, offsetWrap, outline, palettize, pixelate, replaceColor, rotateQuarter, usedColors } from "../lib/sprite-fx";
  import {
    BLEND_MODES, CLEAR, cloneRaster, crop, drawEllipse, drawLine, drawPolygon, drawRect, fillWith, getPixel, inRect, inside, isClear, lift, linePoints, parseHex, pixelPerfect, place, rectBetween, stamp, toHex,
    type BlendMode, type Point, type Raster, type Rect, type Rgba,
  } from "../lib/pixels";
  import {
    addAnimation, animationOf, cloneDoc, cropDoc, linkCels, unlinkCels, syncLinked, moveFramesWithin, scaleDurations, duplicateFrames, moveFramesTo, removeFrames, detectGrid, duplicateAnimation, frameAt, gridFromCounts, smartGrid, framesIn, fromImage, fromSheet, gridTiles, importTiles, insertFrame, moveAnimation, isPristine, moveFrame, newDoc, parseSheetJson,
    removeAnimation, removeFrame, setAnimationDuration, tagProblems, tagSequence, resizeDoc, toSheet, toSheetJson, updateAnimation, type Direction, type SpriteDoc, type TextSource,
    copyFrameDataTo, effectiveData, frameDataOf, setDefaults, setFrameData, setNineSlice,
    addLayer, rippleCels, applyLayers, duplicateLayer, layerSheets, layersFileText, groupLayers, moveCel, setCelOpacity, mergeDown, moveLayer, ungroup, parseLayersFile, recompose, removeLayer, updateLayer, MAX_LAYERS,
  } from "../lib/sprite-doc";
  import { loadRaster, rasterToDataUrl } from "../lib/png";
  import { studio } from "../lib/store.svelte";

  let { path, text }: { path: string; text: string } = $props();

  type Tool = "select" | "ellipseSelect" | "lasso" | "wand" | "colorSelect" | "shade" | "gradient" | "pencil" | "eraser" | "fill" | "line" | "rect" | "ellipse" | "polygon" | "polySelect" | "paintSelect" | "text" | "picker" | "zoom" | "pan";
  interface Session {
    doc: SpriteDoc;
    past: SpriteDoc[];
    future: SpriteDoc[];
    frame: number;
    imagePath: string; // the PNG this sprite saves to
    imageName: string; // how the JSON refers to it (relative to the JSON file)
    layer: number; // the layer being drawn on
    sheet: boolean; // false: a plain PNG, no JSON
  }

  const TOOLS: { id: Tool; label: string; key: string; icon: string }[] = [
    { id: "select", label: "Select and move", key: "M", icon: "⬚" },
    { id: "ellipseSelect", label: "Select an ellipse", key: "Shift+M", icon: "◌" },
    { id: "lasso", label: "Select free-hand", key: "Q", icon: "ʘ" },
    { id: "polySelect", label: "Select a polygon (click the corners; click the first corner, double-click or Enter to finish; Shift adds, Alt takes away)", key: "Shift+Q", icon: "⬡" },
    { id: "paintSelect", label: "Paint a selection (drag with the brush size; Shift adds, Alt takes away)", key: "Alt+Q", icon: "🖌" },
    { id: "wand", label: "Magic wand (joined colour)", key: "W", icon: "✦" },
    { id: "colorSelect", label: "Select a colour everywhere", key: "Shift+W", icon: "❖" },
    { id: "pencil", label: "Pencil", key: "B", icon: "✎" },
    { id: "eraser", label: "Eraser", key: "E", icon: "⌫" },
    { id: "fill", label: "Fill", key: "G", icon: "▨" },
    { id: "gradient", label: "Gradient (drag; the left colour to the right one)", key: "D", icon: "◫" },
    { id: "shade", label: "Shading (lighter or darker)", key: "U", icon: "◐" },
    { id: "line", label: "Line", key: "L", icon: "╱" },
    { id: "rect", label: "Rectangle", key: "R", icon: "▭" },
    { id: "ellipse", label: "Ellipse", key: "O", icon: "◯" },
    { id: "polygon", label: "Polygon (click the corners; click the first corner, double-click or Enter to finish)", key: "P", icon: "⬠" },
    { id: "text", label: "Text (type it in the options, click where its top left corner goes)", key: "T", icon: "𝐀" },
    { id: "picker", label: "Colour picker", key: "I", icon: "✚" },
    { id: "zoom", label: "Zoom (click to zoom in, Alt-click to zoom out)", key: "Z", icon: "⌕" },
    { id: "pan", label: "Pan (drag the picture round)", key: "H", icon: "✋" },
  ];

  const fromPath = untrack(() => path);
  const asPng = fromPath.toLowerCase().endsWith(".png");
  const folder = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/") + 1) : "";

  let ready = $state(false);
  let failure = $state("");
  let doc: SpriteDoc = $state.raw(newDoc(1, 1));
  let frame = $state(0);
  let rev = $state(0); // bumps after pixels change in place
  let tool: Tool = $state("pencil");
  let color: Rgba = $state([40, 40, 60, 255]);
  let size = $state(1);
  let filled = $state(false);
  let onion = $state(true);
  let onionPast = $state(1); // frames before the current one shown faintly
  let onionFuture = $state(0); // frames after it
  let onionTint = $state(true); // blue for before, red for after
  let showGrid = $state(true);
  let zoom = $state(12);
  let canUndo = $state(false);
  let canRedo = $state(false);

  let session: Session | undefined;
  let isSheet = $state(false);
  let activeLayer = $state(0);
  let renaming = $state(-1);
  const focusNow = (n: HTMLInputElement) => { n.focus(); n.select(); };
  const cel = () => doc.layers[activeLayer]!.cels[frame]!;
  let canvas: HTMLCanvasElement | undefined = $state();
  let preview: HTMLCanvasElement | undefined = $state();
  const thumbs = new Map<HTMLCanvasElement, number>(); // each little picture and the frame it shows

  // ---- loading and saving ---------------------------------------------------------------------
  function resolve(image: string): string {
    const parts = (folder + image).split("/");
    const out: string[] = [];
    for (const p of parts) p === ".." ? out.pop() : p !== "." && p !== "" && out.push(p);
    return out.join("/");
  }

  async function load() {
    const existing = studio.sessions.get(fromPath) as Session | undefined;
    if (existing) {
      session = existing;
      adopt();
      return;
    }
    try {
      let s: Session;
      if (asPng) {
        const image = await loadRaster(await studio.api!.readImage(fromPath));
        s = { doc: fromImage(image), past: [], future: [], frame: 0, imagePath: fromPath, imageName: fromPath.slice(fromPath.lastIndexOf("/") + 1), layer: 0, sheet: false };
      } else {
        const parsed = parseSheetJson(text);
        if (!parsed.ok) throw new Error(parsed.error);
        const imageName = parsed.json.image || fromPath.slice(fromPath.lastIndexOf("/") + 1).replace(/\.sprite\.json$/i, ".png");
        const imagePath = resolve(imageName);
        let base: SpriteDoc;
        try {
          base = fromSheet(await loadRaster(await studio.api!.readImage(imagePath)), parsed.json);
        } catch {
          // The picture is missing or unreadable: start blank at the frame size so it can be redrawn.
          base = newDoc(parsed.json.frame_width, parsed.json.frame_height, Math.max(1, parsed.json.frames ?? 1));
        }
        base = await restoreLayers(base);
        s = { doc: base, past: [], future: [], frame: 0, imagePath, imageName, layer: 0, sheet: true };
      }
      studio.sessions.set(fromPath, s);
      session = s;
      adopt();
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    }
  }

  const layersPath = untrack(() => fromPath).replace(/\.sprite\.json$/i, ".layers.json");

  /// Layers live in a file next to the sheet; they are only trusted while they still add up to the sheet.
  async function restoreLayers(flat: SpriteDoc): Promise<SpriteDoc> {
    let content;
    try {
      content = await studio.api!.readFile(layersPath);
    } catch {
      return flat; // no layers file: the sprite is one layer
    }
    const file = content.text ? parseLayersFile(content.text) : null;
    if (!file) return flat;
    try {
      const sheets = await Promise.all(file.layers.map((l) => loadRaster(l.image)));
      const layered = applyLayers(flat, file, sheets);
      if (layered) return layered;
    } catch {
      // fall through
    }
    studio.say("info", "The picture was changed outside the studio, so its layers were flattened into one.");
    return flat;
  }

  function adopt() {
    doc = session!.doc;
    frame = Math.min(session!.frame, doc.frames.length - 1);
    activeLayer = Math.min(session!.layer, doc.layers.length - 1);
    zoom = Math.max(1, Math.min(32, Math.floor(420 / Math.max(doc.fw, doc.fh))));
    canUndo = session!.past.length > 0;
    canRedo = session!.future.length > 0;
    isSheet = session!.sheet;
    studio.saveHooks.set(fromPath, async () => {
      const d = session!.doc;
      await studio.api!.writeImage(session!.imagePath, rasterToDataUrl(toSheet(d)));
      // Layers go in a file beside the sheet (only when there is more than one, or there was a file before).
      if (session!.sheet && (d.layers.length > 1 || d.layers.some((l) => l.locked || l.clip || l.links?.some((n) => n > 0)) || studio.files.some((f) => f.path === layersPath))) {
        await studio.api!.writeFile(layersPath, layersFileText(d, layerSheets(d).map(rasterToDataUrl)));
        if (!studio.files.some((f) => f.path === layersPath)) void studio.refreshFiles();
      }
    });
    ready = true;
  }

  /// Tell the studio the sprite changed: new JSON text for sheets, and an unsaved mark either way.
  function changed() {
    if (!session) return;
    session.doc = doc;
    session.frame = frame;
    session.layer = activeLayer;
    // drawing on a linked cel draws on every cel linked to it
    syncLinked(doc, activeLayer, frame);
    canUndo = session.past.length > 0;
    canRedo = session.future.length > 0;
    if (session.sheet) studio.edit(fromPath, toSheetJson(doc, session.imageName));
    studio.markPending(fromPath);
    rev++;
  }

  const MAX_HISTORY = 60;
  function remember() {
    session!.past.push(cloneDoc(doc));
    if (session!.past.length > MAX_HISTORY) session!.past.shift();
    session!.future = [];
  }
  function structural(next: SpriteDoc, newFrame = frame) {
    if (next === doc) return;
    remember();
    doc = next;
    frame = Math.max(0, Math.min(newFrame, doc.frames.length - 1));
    activeLayer = Math.min(activeLayer, doc.layers.length - 1);
    recompose(doc, frame);
    changed();
  }
  function undo() {
    const prev = session?.past.pop();
    if (!prev) return;
    session!.future.push(cloneDoc(doc));
    doc = prev;
    frame = Math.min(frame, doc.frames.length - 1);
    activeLayer = Math.min(activeLayer, doc.layers.length - 1);
    changed();
  }
  function redo() {
    const next = session?.future.pop();
    if (!next) return;
    session!.past.push(cloneDoc(doc));
    doc = next;
    frame = Math.min(frame, doc.frames.length - 1);
    activeLayer = Math.min(activeLayer, doc.layers.length - 1);
    changed();
  }

  onMount(() => void load());

  // ---- drawing ------------------------------------------------------------------------------
  const current = $derived.by(() => {
    rev;
    return doc.frames[frame]!;
  });

  function drawReference(ctx: CanvasRenderingContext2D) {
    if (!refPicture) return;
    ctx.globalAlpha = refOpacity;
    ctx.drawImage(refPicture, refX * zoom, refY * zoom, refSize.w * refScale * zoom, refSize.h * refScale * zoom);
    ctx.globalAlpha = 1;
  }
  async function loadReference(path: string) {
    refPath = path;
    refPicture = null;
    if (!path) return void refTick++;
    try {
      const r = await loadRaster(await studio.api!.readImage(path));
      const c = document.createElement("canvas");
      c.width = r.w;
      c.height = r.h;
      c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.w, r.h), 0, 0);
      refPicture = c;
      refSize = { w: r.w, h: r.h };
      refScale = Math.max(1, Math.min(doc.fw / r.w, doc.fh / r.h, 8));
      refX = refY = 0;
    } catch (e) {
      studio.say("error", `Could not open the reference picture: ${e instanceof Error ? e.message : e}`);
    }
    refTick++;
  }
  const referenceCandidates = $derived(studio.files.filter((f) => !f.dir && /\.(png|jpe?g)$/i.test(f.path) && f.path !== session?.imagePath).map((f) => f.path));

  // with tiled drawing on, the picture repeated faintly round the canvas (one picture each way), so a seamless texture can be judged as it is drawn
  let tileUrl = $state("");
  function paintTiles() {
    if (!tileX && !tileY) { tileUrl = ""; return; }
    const tmp = document.createElement("canvas");
    tmp.width = current.w;
    tmp.height = current.h;
    tmp.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(current.data), current.w, current.h), 0, 0);
    tileUrl = tmp.toDataURL();
  }

  function paint() {
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas || !ready) return;
    paintTiles();
    const w = doc.fw * zoom;
    const h = doc.fh * zoom;
    canvas.width = w;
    canvas.height = h;
    // checkerboard behind transparent pixels
    const cell = Math.max(4, Math.min(zoom, 8));
    for (let y = 0; y * cell < h; y++) for (let x = 0; x * cell < w; x++) {
      ctx.fillStyle = (x + y) % 2 ? "#3a3d48" : "#2e313b";
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
    ctx.imageSmoothingEnabled = false;
    if (refPicture && !refOver) drawReference(ctx);
    const blit = (r: Raster, alpha: number) => {
      const tmp = document.createElement("canvas");
      tmp.width = r.w;
      tmp.height = r.h;
      tmp.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.w, r.h), 0, 0);
      ctx.globalAlpha = alpha;
      ctx.drawImage(tmp, 0, 0, w, h);
      ctx.globalAlpha = 1;
    };
    if (onion && anim && !playing) {
      const ghost = (r: Raster, alpha: number, colour: string | null) => {
        const tmp = document.createElement("canvas");
        tmp.width = r.w;
        tmp.height = r.h;
        const c2 = tmp.getContext("2d")!;
        c2.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.w, r.h), 0, 0);
        if (colour) {
          c2.globalCompositeOperation = "source-atop";
          c2.fillStyle = colour;
          c2.fillRect(0, 0, r.w, r.h);
        }
        ctx.globalAlpha = alpha;
        ctx.drawImage(tmp, 0, 0, w, h);
        ctx.globalAlpha = 1;
      };
      // the nearest ghost is the strongest
      for (let k = onionPast; k >= 1; k--) if (frame - k >= anim.from) ghost(doc.frames[frame - k]!, 0.4 / k, onionTint ? "rgba(70,110,255,.6)" : null);
      for (let k = onionFuture; k >= 1; k--) if (frame + k <= anim.to) ghost(doc.frames[frame + k]!, 0.4 / k, onionTint ? "rgba(255,80,80,.6)" : null);
    }
    blit(current, 1);
    if (refPicture && refOver) drawReference(ctx);
    // the frame's hitbox (green), pivot (red cross) and the nine-slice guides (blue, dashed)
    {
      const eff = effectiveData(doc, frame);
      if (eff.hitbox) {
        ctx.strokeStyle = "rgba(111,207,142,.95)";
        ctx.lineWidth = 2;
        ctx.strokeRect(eff.hitbox.x * zoom + 1, eff.hitbox.y * zoom + 1, eff.hitbox.w * zoom - 2, eff.hitbox.h * zoom - 2);
        ctx.lineWidth = 1;
      }
      if (eff.pivot) {
        ctx.strokeStyle = "rgba(255,90,90,.95)";
        ctx.beginPath();
        ctx.moveTo(eff.pivot.x * zoom - 7, eff.pivot.y * zoom);
        ctx.lineTo(eff.pivot.x * zoom + 7, eff.pivot.y * zoom);
        ctx.moveTo(eff.pivot.x * zoom, eff.pivot.y * zoom - 7);
        ctx.lineTo(eff.pivot.x * zoom, eff.pivot.y * zoom + 7);
        ctx.stroke();
      }
      const n = doc.nineSlice;
      if (n) {
        ctx.strokeStyle = "rgba(90,169,255,.9)";
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        for (const x of [n.left, doc.fw - n.right]) { ctx.moveTo(x * zoom, 0); ctx.lineTo(x * zoom, h); }
        for (const y of [n.top, doc.fh - n.bottom]) { ctx.moveTo(0, y * zoom); ctx.lineTo(w, y * zoom); }
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    if (showGrid && (zoom >= 8 || (gridStep > 1 && zoom >= 3))) {
      ctx.strokeStyle = "rgba(255,255,255,.12)";
      ctx.beginPath();
      for (let x = gridStep; x < doc.fw; x += gridStep) { ctx.moveTo(x * zoom + 0.5, 0); ctx.lineTo(x * zoom + 0.5, h); }
      for (let y = gridStep; y < doc.fh; y += gridStep) { ctx.moveTo(0, y * zoom + 0.5); ctx.lineTo(w, y * zoom + 0.5); }
      ctx.stroke();
    }
    if (selection && isSelectTool(tool)) {
      ctx.strokeStyle = "#ffd166";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      if (selMask) {
        ctx.beginPath();
        for (const [x1, y1, x2, y2] of outlineSegments(selMask)) {
          ctx.moveTo(x1 * zoom, y1 * zoom);
          ctx.lineTo(x2 * zoom, y2 * zoom);
        }
        ctx.stroke();
      } else ctx.strokeRect(selection.x * zoom + 1, selection.y * zoom + 1, selection.w * zoom - 2, selection.h * zoom - 2);
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
    }
    if (symX || symY || symD || symP || symQ) {
      ctx.strokeStyle = "rgba(255,120,200,.7)";
      ctx.beginPath();
      if (symX) { ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); }
      if (symY || symQ) { ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); }
      if (symQ) { ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); }
      if (symD && square) { ctx.moveTo(0, 0); ctx.lineTo(w, h); if (symX && symY) { ctx.moveTo(w, 0); ctx.lineTo(0, h); } }
      if (symP || symQ) { const c = 5; ctx.moveTo(w / 2 - c, h / 2); ctx.lineTo(w / 2 + c, h / 2); ctx.moveTo(w / 2, h / 2 - c); ctx.lineTo(w / 2, h / 2 + c); }
      ctx.stroke();
    }
    if (hover && inside(current, hover.x, hover.y) && !drawing) {
      ctx.strokeStyle = "rgba(255,255,255,.8)";
      const start = -Math.floor((size - 1) / 2);
      const [bx, by, bs] = tool === "pencil" || tool === "eraser" ? [hover.x + start, hover.y + start, size] : [hover.x, hover.y, 1];
      ctx.strokeRect(bx * zoom + 0.5, by * zoom + 0.5, bs * zoom - 1, bs * zoom - 1);
    }
  }

  $effect(() => {
    // everything the picture depends on
    doc; frame; rev; zoom; onion; onionPast; onionFuture; onionTint; showGrid; ready; hover; size; tool; playing; canvas; selection; selMask; symX; symY; symD; tileX; tileY; gridStep; refTick; refOpacity; refOver; refScale; refX; refY;
    paint();
  });

  // thumbnails
  function drawThumb(node: HTMLCanvasElement, index: number) {
    thumbs.set(node, index);
    const render = () => {
      const r = doc.frames[thumbs.get(node) ?? 0];
      const ctx = node.getContext("2d");
      if (!r || !ctx) return;
      node.width = r.w;
      node.height = r.h;
      ctx.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.w, r.h), 0, 0);
    };
    render();
    return {
      update: (next: number) => {
        thumbs.set(node, next);
        render();
      },
      destroy: () => thumbs.delete(node),
    };
  }
  $effect(() => {
    rev; doc;
    for (const [node, i] of thumbs) {
      const r = doc.frames[i];
      const ctx = node.getContext("2d");
      if (r && ctx) {
        node.width = r.w;
        node.height = r.h;
        ctx.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.w, r.h), 0, 0);
      }
    }
  });

  // ---- tools --------------------------------------------------------------------------------
  let drawing = false;
  let hover: Point | null = $state(null);
  let start: Point = { x: 0, y: 0 };
  let last: Point = { x: 0, y: 0 };
  let base: Raster | null = null;
  let before: SpriteDoc | null = null;
  let strokePoints: Point[] = [];
  /// The pen's pressure at each stroke point (1 for a mouse), and whether it sets the brush size.
  let strokePressures: number[] = [];
  let usePressure = $state(true);
  let pressureFor = $state<"size" | "opacity">("size"); // what a pen's pressure changes
  let textValue = $state("TEXT");
  let textScale = $state(1);
  const pressureOf = (e: PointerEvent) => (e.pointerType === "pen" ? e.pressure : 1);

  let symX = $state(false);
  let symY = $state(false);
  /// Mirror across the diagonal (a square sprite only), and draw tiled: strokes that run off one edge come back in at the other.
  let symD = $state(false);
  let symP = $state(false);
  let symQ = $state(false);
  let tileX = $state(false);
  let tileY = $state(false);
  const square = $derived(doc.fw === doc.fh);
  /// Every place a stroke is drawn (lib/symmetry.ts); the fill does not tile, a flood is the same however far it wraps.
  const maps = $derived(strokeMaps(doc.fw, doc.fh, { x: symX, y: symY, diagonal: symD && square, point: symP, quarter: symQ && square, tileX, tileY }));
  const fillMaps = $derived(strokeMaps(doc.fw, doc.fh, { x: symX, y: symY, diagonal: symD && square, point: symP, quarter: symQ && square }));
  /// The right mouse button has a tool and a colour of its own (the pencil and eraser are the usual pair).
  /// The shape of the pencil, eraser and shading brushes, whether shading lightens or darkens, and the pattern a gradient is dithered with.
  let brushShape: BrushShape = $state("square");
  let shadeDarker = $state(false);
  let dither: Dither = $state("none");
  let rightTool: Tool = $state("eraser");
  let rightColor: Rgba = $state([255, 255, 255, 255]);
  let swapped: { tool: Tool; color: Rgba } | null = null;
  let perfect = $state(true);
  let gridStep = $state(1);
  let rulers = $state(false);
  // a reference picture drawn under or over the canvas (never saved with the sprite)
  let refPath = $state("");
  let refPicture = $state.raw<HTMLCanvasElement | null>(null);
  let refSize = $state({ w: 0, h: 0 });
  let refOpacity = $state(0.5);
  let refOver = $state(false);
  let refScale = $state(1);
  let refX = $state(0);
  let refY = $state(0);
  let refTick = $state(0);
  // fill options, a brush cut from the picture, the polygon being clicked out, and the colour lock
  let fillTolerance = $state(0);
  let fillEverywhere = $state(false);
  let fillInSelection = $state(true);
  let pictureBrush = $state.raw<PictureBrush | null>(null);
  let brushKeepsColors = $state(true);
  let lockPalette = $state(false);
  let poly: Point[] = [];
  let polyBase: Raster | null = null;
  let polyBefore: SpriteDoc | null = null;
  let polyShown = $state(0); // how many corners are placed (for the hint)
  let panning: { x: number; y: number; left: number; top: number } | null = null;
  let scroller: HTMLDivElement | undefined = $state();
  /// The colour that is drawn: the chosen one, or the nearest palette colour when the palette is locked.
  const ink = (): Rgba => {
    if (!lockPalette || !palette.colors.length) return color;
    const near = parseHex(nearestColor(palette.colors, hex(color)));
    return near ? [near[0], near[1], near[2], color[3]] : color;
  };
  /// The selection: its bounds, and (when it is not a plain rectangle) the cells it holds (lib/selection.ts).
  let selection: Rect | null = $state(null);
  let selMask = $state.raw<Mask | null>(null);
  const SELECT_TOOLS: Tool[] = ["select", "ellipseSelect", "lasso", "polySelect", "paintSelect", "wand", "colorSelect"];
  // A polygon selection being clicked out: its corners, how it combines with what was selected, and what was selected.
  let selPoly = $state.raw<{ points: Point[]; how: Combine; base: Mask | null } | null>(null);
  function selPolyShow(towards: Point | null) {
    if (!selPoly) return;
    const pts = towards ? [...selPoly.points, towards] : selPoly.points;
    setSelection(combine(selPoly.base, maskFromPolygon(pts, doc.fw, doc.fh), selPoly.how));
  }
  function selPolyClick(p: Point, how: Combine, double: boolean) {
    if (!selPoly) selPoly = { points: [], how, base: how === "replace" ? null : currentMask() };
    const first = selPoly.points[0];
    if (selPoly.points.length >= 3 && (double || (first && first.x === p.x && first.y === p.y))) return void selPolyFinish();
    if (!double) selPoly = { ...selPoly, points: [...selPoly.points, p] };
    selPolyShow(p);
  }
  function selPolyFinish() {
    if (selPoly && selPoly.points.length >= 3) selPolyShow(null);
    else if (selPoly) setSelection(selPoly.base);
    selPoly = null;
  }
  const isSelectTool = (t: Tool) => SELECT_TOOLS.includes(t);
  /// How close a colour must be to the clicked one for the wand (0 is exactly the same).
  let tolerance = $state(0);
  const currentMask = (): Mask | null => (selection ? (selMask ?? maskFromRect(selection, doc.fw, doc.fh)) : null);
  /// Makes a mask the selection (a rectangle is kept as just its bounds; nothing selected clears it).
  function setSelection(m: Mask | null) {
    if (!m || isEmpty(m)) {
      selection = null;
      selMask = null;
      return;
    }
    selection = boundsOf(m);
    selMask = isRect(m) ? null : m;
  }
  const setRect = (r: Rect | null) => {
    selection = r;
    selMask = null;
  };
  let selecting: { tool: Tool; a: Point; how: Combine; base: Mask | null; points: Point[] } | null = null;
  let moving: { piece: Raster; pieceMask: Mask; rest: Raster; dx: number; dy: number } | null = null;
  let clipboard: Raster | null = null;
  let recent: string[] = $state([]);


  function cell(e: PointerEvent): Point {
    const r = canvas!.getBoundingClientRect();
    return { x: Math.floor(((e.clientX - r.left) / r.width) * doc.fw), y: Math.floor(((e.clientY - r.top) / r.height) * doc.fh) };
  }

  function down(e: PointerEvent) {
    if ((e.button !== 0 && e.button !== 1 && e.button !== 2) || !ready) return;
    const p = cell(e);
    // the right button works with the right-hand tool and colour for as long as it is held down (finish() puts the left-hand ones back)
    if (e.button === 2) {
      swapped = { tool, color };
      tool = rightTool;
      color = rightColor;
    }
    if (tool === "picker") {
      const c = getPixel(doc.frames[frame]!, p.x, p.y);
      if (c && c[3] > 0) {
        if (swapped) rightColor = c;
        else color = c;
      }
      if (swapped) {
        tool = swapped.tool;
        color = swapped.color;
        swapped = null;
      }
      return;
    }
    if (e.button === 1 || (tool === "pan" && e.button === 0)) {
      if (!scroller) return;
      panning = { x: e.clientX, y: e.clientY, left: scroller.scrollLeft, top: scroller.scrollTop };
      canvas!.setPointerCapture(e.pointerId);
      return;
    }
    if (tool === "zoom") {
      setZoom(e.altKey ? (zoom > 8 ? zoom - 4 : zoom - 1) : zoom >= 8 ? zoom + 4 : zoom + 1, e);
      return;
    }
    const layer = doc.layers[activeLayer]!;
    if (layer.locked) {
      studio.say("info", `"${layer.name}" is locked. Unlock it (the padlock) to draw on it.`);
      if (swapped) {
        tool = swapped.tool;
        color = swapped.color;
        swapped = null;
      }
      return;
    }
    if (!layer.visible) {
      studio.say("info", `"${layer.name}" is hidden. Show it (the eye) to draw on it.`);
      if (swapped) {
        tool = swapped.tool;
        color = swapped.color;
        swapped = null;
      }
      return;
    }
    const r = cel();
    canvas!.setPointerCapture(e.pointerId);
    if (tool === "polygon") {
      polygonClick(p, e.detail >= 2);
      return;
    }
    if (isSelectTool(tool)) {
      const mask = currentMask();
      // Shift adds to the selection, Alt takes from it, both keep only where they overlap
      const how: Combine = e.shiftKey && e.altKey ? "intersect" : e.shiftKey ? "add" : e.altKey ? "subtract" : "replace";
      if (tool === "polySelect") {
        selPolyClick(p, how, e.detail >= 2);
        return;
      }
      if (tool === "wand" || tool === "colorSelect") {
        setSelection(combine(mask, maskFromColor(r, p.x, p.y, tolerance, tool === "wand"), how));
      } else if (tool !== "paintSelect" && how === "replace" && mask && has(mask, p.x, p.y)) {
        // a drag that starts inside the selection carries those pixels along
        const lifted = liftMasked(r, mask);
        if (lifted) {
          before = cloneDoc(doc);
          drawing = true;
          moving = { piece: lifted.piece, pieceMask: lifted.pieceMask, rest: lifted.rest, dx: p.x - lifted.bounds.x, dy: p.y - lifted.bounds.y };
        }
      } else {
        if (how === "replace") setSelection(null);
        selecting = { tool, a: p, how, base: how === "replace" ? null : mask, points: [p] };
        if (tool === "paintSelect") setSelection(combine(selecting.base, maskFromStroke([p], size, doc.fw, doc.fh), how));
      }
      return;
    }
    before = cloneDoc(doc);
    drawing = true;
    start = last = p;
    base = cloneRaster(r);
    strokePoints = [p];
    strokePressures = [pressureOf(e)];
    if (tool === "pencil" || tool === "eraser" || tool === "shade") drawStroke(r);
    else if (tool === "text") {
      if (textValue) for (const q of placesOf(p, fillMaps, doc.fw, doc.fh)) drawText(r, q.x, q.y, textValue.replaceAll("\\n", "\n"), ink(), textScale);
      recompose(doc, frame);
      finish();
      return;
    } else if (tool === "fill") {
      const inside_ = fillInSelection ? currentMask() : null;
      for (const q of placesOf(p, fillMaps, doc.fw, doc.fh)) fillWith(r, q.x, q.y, ink(), { tolerance: fillTolerance, everywhere: fillEverywhere, within: inside_ ? (x, y) => has(inside_, x, y) : undefined });
      recompose(doc, frame);
      finish();
      return;
    } else shape(r, p);
    recompose(doc, frame);
    rev++;
  }

  /// Pencil and eraser redraw the whole stroke from the picture as it was, so the pixel-perfect filter can
  /// take a corner pixel back as the line continues.
  function drawStroke(r: Raster) {
    r.data.set(base!.data);
    const c = tool === "eraser" ? CLEAR : ink();
    const custom = pictureBrush && (tool === "pencil" || tool === "eraser");
    const points = tool === "pencil" && perfect && size === 1 && !custom ? pixelPerfect(strokePoints) : strokePoints;
    if (tool === "shade") {
      // each cell the stroke covers is shaded once, however many times the brush passes over it
      const covered = new Set<string>();
      for (const pt of strokePoints) for (const q of placesOf(pt, maps, doc.fw, doc.fh, size + 1)) for (const o of brushOffsets(size, brushShape)) covered.add(`${q.x + o.x},${q.y + o.y}`);
      for (const key of covered) {
        const [x, y] = key.split(",").map(Number) as [number, number];
        const px = getPixel(r, x, y);
        if (px && px[3] > 0) {
          const [sr, sg, sb] = shadeColor(px, shadeDarker ? -0.5 : 0.5);
          r.data.set([sr, sg, sb, px[3]], (y * r.w + x) * 4);
        }
      }
      return;
    }
    // (a brush that hangs over the edge of a tiled sprite comes back in at the other side: places up to a brush's width outside count)
    if (custom) {
      const reach = Math.max(pictureBrush!.w, pictureBrush!.h);
      for (const pt of points) for (const q of placesOf(pt, maps, doc.fw, doc.fh, reach)) stampPicture(r, q.x, q.y, pictureBrush!, tool === "eraser" ? CLEAR : brushKeepsColors ? undefined : c);
      return;
    }
    if (usePressure && pressureFor === "opacity" && (tool === "pencil" || tool === "eraser")) {
      const dabs: { x: number; y: number; pressure: number; size: number }[] = [];
      for (const [i, pt] of points.entries()) for (const q of placesOf(pt, maps, doc.fw, doc.fh, size + 1)) dabs.push({ x: q.x, y: q.y, pressure: strokePressures[i] ?? 1, size });
      pressureOpacityStroke(r, base!, dabs, brushShape, c, tool === "eraser");
      return;
    }
    for (const [i, pt] of points.entries()) {
      const sz = usePressure && size > 1 ? pressureSize(size, strokePressures[i] ?? 1) : size;
      for (const q of placesOf(pt, maps, doc.fw, doc.fh, sz + 1)) stampBrush(r, q.x, q.y, sz, brushShape, c);
    }
  }

  function shape(r: Raster, p: Point) {
    r.data.set(base!.data);
    if (tool === "gradient") {
      // the left colour at the start of the drag to the right-hand colour at its end, inside the selection when there is one
      const area = selection ? (selMask ? { ...selection, has: (x: number, y: number) => has(selMask!, x, y) } : selection) : null;
      r.data.set(gradientFill(base!, start, p, ink(), rightColor, dither, area).data);
      return;
    }
    for (const m of maps) {
      const a = m(start);
      const b = m(p);
      if (tool === "line") drawLine(r, a, b, size, ink());
      else if (tool === "rect") drawRect(r, a, b, size, ink(), filled);
      else if (tool === "ellipse") drawEllipse(r, a, b, size, ink(), filled);
    }
  }

  /// Polygon: each click places a corner; a click on the first corner, a double-click or Enter closes and draws it, Escape drops it.
  function polygonClick(p: Point, double: boolean) {
    const r = cel();
    if (!poly.length) {
      polyBefore = cloneDoc(doc);
      polyBase = cloneRaster(r);
    }
    const first = poly[0];
    if (poly.length >= 3 && (double || (first && first.x === p.x && first.y === p.y))) return void finishPolygon();
    if (!double) poly.push(p);
    polyShown = poly.length;
    previewPolygon(p);
  }
  function previewPolygon(towards: Point | null) {
    if (!polyBase) return;
    const r = cel();
    r.data.set(polyBase.data);
    const pts = towards ? [...poly, towards] : poly;
    for (const m of maps) for (let i = 1; i < pts.length; i++) drawLine(r, m(pts[i - 1]!), m(pts[i]!), size, ink());
    recompose(doc, frame);
    rev++;
  }
  function finishPolygon() {
    if (!polyBase || !polyBefore) return;
    const r = cel();
    if (poly.length >= 2) {
      r.data.set(polyBase.data);
      for (const m of maps) drawPolygon(r, poly.map(m), size, ink(), filled);
      recompose(doc, frame);
      if (r.data.some((v, i) => v !== polyBase!.data[i])) {
        session!.past.push(polyBefore);
        if (session!.past.length > MAX_HISTORY) session!.past.shift();
        session!.future = [];
        rememberColor(color);
        changed();
      }
    } else r.data.set(polyBase.data);
    poly = [];
    polyBase = polyBefore = null;
    polyShown = 0;
    recompose(doc, frame);
    rev++;
  }
  function cancelPolygon() {
    if (polyBase) {
      cel().data.set(polyBase.data);
      recompose(doc, frame);
    }
    poly = [];
    polyBase = polyBefore = null;
    polyShown = 0;
    rev++;
  }
  $effect(() => {
    if (tool !== "polySelect" && untrack(() => selPoly)) untrack(selPolyFinish);
  });
  $effect(() => {
    if (tool !== "polygon" && untrack(() => poly.length)) untrack(cancelPolygon);
  });

  const MAX_ZOOM = 64;
  /// Sets the zoom, keeping the cell under the pointer (or the middle of the view) where it was.
  function setZoom(next: number, at?: { clientX: number; clientY: number }) {
    const z = Math.max(1, Math.min(MAX_ZOOM, Math.round(next)));
    if (z === zoom || !canvas || !scroller) return;
    const rect = canvas.getBoundingClientRect();
    const sr = scroller.getBoundingClientRect();
    const px = at ? at.clientX : sr.left + sr.width / 2;
    const py = at ? at.clientY : sr.top + sr.height / 2;
    const cx = (px - rect.left) / zoom;
    const cy = (py - rect.top) / zoom;
    zoom = z;
    void tick().then(() => {
      if (!canvas || !scroller) return;
      const r2 = canvas.getBoundingClientRect();
      scroller.scrollLeft += r2.left + cx * zoom - px;
      scroller.scrollTop += r2.top + cy * zoom - py;
    });
  }
  /// A pinch on a trackpad (Ctrl with the wheel, or WebKit's gesture events) zooms the canvas; a plain two-finger scroll scrolls it.
  function wheel(e: WheelEvent) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    setZoom(zoom * Math.exp(-e.deltaY * 0.01), e);
  }
  let scrollTick = $state(0);
  let miniMap = $state(true);
  let viewport = $state({ w: 0, h: 0 });
  const MAP_SIDE = 140;
  const mapView = $derived.by(() => {
    scrollTick;
    if (!scroller || !miniMap) return null;
    const v = { left: scroller.scrollLeft, top: scroller.scrollTop, w: viewport.w || scroller.clientWidth, h: viewport.h || scroller.clientHeight };
    if (!needsMap(v, zoom, doc.fw, doc.fh)) return null;
    const k = MAP_SIDE / Math.max(doc.fw, doc.fh);
    return { k, w: doc.fw * k, h: doc.fh * k, box: visibleBox(v, zoom, doc.fw, doc.fh) };
  });
  function mapClick(e: PointerEvent) {
    if (!scroller || !mapView) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const to = scrollToCentre((e.clientX - r.left) / mapView.k, (e.clientY - r.top) / mapView.k, { w: scroller.clientWidth, h: scroller.clientHeight }, zoom);
    scroller.scrollLeft = to.left;
    scroller.scrollTop = to.top;
  }
  /// Which pixel numbers the rulers label: far enough apart to read at the current zoom.
  const tickStep = $derived(zoom >= 24 ? 1 : zoom >= 12 ? 2 : zoom >= 6 ? 5 : zoom >= 3 ? 10 : 20);
  const ticks = (n: number) => Array.from({ length: Math.ceil(n / tickStep) }, (_, i) => i * tickStep);
  let pinchStart = 1;
  const gestureStart = (e: Event) => { e.preventDefault(); pinchStart = zoom; };
  const gestureChange = (e: Event) => {
    e.preventDefault();
    const g = e as unknown as { scale: number; clientX?: number; clientY?: number };
    setZoom(pinchStart * g.scale, g.clientX === undefined ? undefined : { clientX: g.clientX, clientY: g.clientY! });
  };

  function move(e: PointerEvent) {
    const p = cell(e);
    if (!hover || hover.x !== p.x || hover.y !== p.y) hover = p;
    if (panning && scroller) {
      scroller.scrollLeft = panning.left - (e.clientX - panning.x);
      scroller.scrollTop = panning.top - (e.clientY - panning.y);
      return;
    }
    if (tool === "polygon" && poly.length) {
      previewPolygon(p);
      return;
    }
    if (tool === "polySelect" && selPoly) {
      selPolyShow(p);
      return;
    }
    if (selecting) {
      const s = selecting;
      let shape: Mask;
      if (s.tool === "lasso") {
        const last = s.points.at(-1)!;
        if (last.x !== p.x || last.y !== p.y) s.points.push(...linePoints(last, p).slice(1));
        shape = maskFromPolygon(s.points, doc.fw, doc.fh);
      } else if (s.tool === "paintSelect") {
        s.points.push(p);
        shape = maskFromStroke(s.points, size, doc.fw, doc.fh);
      } else if (s.tool === "ellipseSelect") shape = maskFromEllipse(s.a, p, doc.fw, doc.fh);
      else {
        const rect = rectBetween(s.a, p, doc.fw, doc.fh);
        shape = rect ? maskFromRect(rect, doc.fw, doc.fh) : emptyMask(doc.fw, doc.fh);
      }
      setSelection(combine(s.base, shape, s.how));
      return;
    }
    if (!drawing) return;
    const r = cel();
    if (moving && selection) {
      const nx = p.x - moving.dx;
      const ny = p.y - moving.dy;
      r.data.set(place(moving.rest, moving.piece, nx, ny).data);
      setSelection(placeMask(moving.pieceMask, doc.fw, doc.fh, nx, ny));
    } else if (tool === "pencil" || tool === "eraser" || tool === "shade") {
      const added = linePoints(last, p).slice(1);
      strokePoints.push(...added);
      for (let k = 0; k < added.length; k++) strokePressures.push(pressureOf(e));
      last = p;
      drawStroke(r);
    } else shape(r, p);
    recompose(doc, frame);
    rev++;
  }

  function finish() {
    selecting = null;
    panning = null;
    if (swapped) {
      // (a right-button stroke that picked a colour keeps it for the right hand)
      tool = swapped.tool;
      color = swapped.color;
      swapped = null;
    }
    if (!drawing) return;
    drawing = false;
    const r = cel();
    const was = before!.layers[activeLayer]!.cels[frame]!;
    if (r.data.some((v, i) => v !== was.data[i])) {
      session!.past.push(before!);
      if (session!.past.length > MAX_HISTORY) session!.past.shift();
      session!.future = [];
      if (!isSelectTool(tool) && tool !== "eraser") rememberColor(color);
      changed();
    }
    before = base = null;
    moving = null;
  }
  const up = () => finish();
  const leave = () => (hover = null);

  function rememberColor(c: Rgba) {
    const h = toHex([c[0], c[1], c[2], 255]);
    recent = [h, ...recent.filter((x) => x !== h)].slice(0, 16);
  }

  // ---- selection commands ---------------------------------------------------------------------
  function clearSelection() {
    if (lockedLayer()) return;
    const mask = currentMask();
    const lifted = mask ? liftMasked(cel(), mask) : null;
    if (!lifted) return;
    const next = cloneDoc(doc);
    next.layers[activeLayer]!.cels[frame] = lifted.rest;
    structural(next);
  }
  function copySelection(cut = false) {
    const mask = currentMask();
    const lifted = mask ? liftMasked(cel(), mask) : null;
    if (!lifted) return;
    clipboard = lifted.piece; // (only the selected pixels: the rest of its box is transparent)
    if (cut) clearSelection();
  }
  function paste() {
    if (!clipboard || lockedLayer()) return;
    const at = selection ? { x: selection.x, y: selection.y } : { x: 0, y: 0 };
    const next = cloneDoc(doc);
    next.layers[activeLayer]!.cels[frame] = place(next.layers[activeLayer]!.cels[frame]!, clipboard, at.x, at.y);
    structural(next);
    tool = "select";
    setRect({ x: at.x, y: at.y, w: clipboard.w, h: clipboard.h });
  }

  // ---- turning and resizing the selection ----
  let turnDegrees = $state(15);
  let cleanTurn = $state(true);
  let scalePercent = $state(200);
  /// Lifts the selected pixels, changes the piece, and puts it back with its middle where the old one's middle was; the result is the new selection.
  function transformSelection(change: (piece: Raster) => Raster) {
    if (lockedLayer()) return;
    const mask = currentMask();
    const lifted = mask ? liftMasked(cel(), mask) : null;
    if (!lifted) return;
    const piece = change(lifted.piece);
    const nx = Math.round(lifted.bounds.x + lifted.bounds.w / 2 - piece.w / 2);
    const ny = Math.round(lifted.bounds.y + lifted.bounds.h / 2 - piece.h / 2);
    const next = cloneDoc(doc);
    next.layers[activeLayer]!.cels[frame] = place(lifted.rest, piece, nx, ny);
    structural(next);
    setRect({ x: nx, y: ny, w: piece.w, h: piece.h });
  }
  const turnSelection = (sign: 1 | -1) => transformSelection((piece) => (cleanTurn ? rotSprite(piece, sign * turnDegrees) : rotateNearest(piece, sign * turnDegrees)));
  const scaleSelection = () => transformSelection((piece) => scaleTo(piece, (piece.w * scalePercent) / 100, (piece.h * scalePercent) / 100));

  // ---- canvas size ----------------------------------------------------------------------------------
  let sizing = $state(false);
  let newW = $state(32);
  let newH = $state(32);
  let anchor = $state("0,0");
  function openSizing() {
    newW = doc.fw;
    newH = doc.fh;
    sizing = !sizing;
  }
  function applySize() {
    const [ax, ay] = anchor.split(",").map(Number) as [number, number];
    structural(resizeDoc(doc, newW, newH, ax, ay));
    setSelection(null);
    sizing = false;
    zoom = Math.max(1, Math.min(32, Math.floor(420 / Math.max(doc.fw, doc.fh))));
  }

  function clearFrame() {
    if (lockedLayer()) return;
    const next = cloneDoc(doc);
    next.layers[activeLayer]!.cels[frame]!.data.fill(0);
    structural(next);
  }
  function flip(horizontal: boolean) {
    if (lockedLayer()) return;
    const next = cloneDoc(doc);
    const r = next.layers[activeLayer]!.cels[frame]!;
    const src = cloneRaster(r);
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const c = getPixel(src, horizontal ? r.w - 1 - x : x, horizontal ? y : r.h - 1 - y)!;
      r.data.set(c, (y * r.w + x) * 4);
    }
    structural(next);
  }

  // ---- frames and animations ------------------------------------------------------------------------
  /// The animation being worked on is the one the current frame is in; its frames are the timeline.
  const animIndex = $derived(Math.max(0, animationOf(doc, frame)));
  const anim = $derived(doc.tags[animIndex]);
  const animFrames = $derived(anim ? Array.from({ length: framesIn(anim) }, (_, i) => anim.from + i) : []);
  let dragFrame: number | null = null;
  /// Dropping a dragged frame on another: the whole picked set goes together if the dragged one is part of it.
  function dropFrame(onto: number, byCel = false, copy = false) {
    const from = dragFrame;
    dragFrame = null;
    // Alt held: only this layer's cel goes (Shift as well: a copy), not the whole frame
    if (byCel && from !== null && from !== onto) return structural(moveCel(doc, activeLayer, from, onto, copy), onto);
    if (from === null || from === onto) return;
    if (chosen.length > 1 && chosen.includes(from)) {
      const r = moveFramesWithin(doc, chosen, onto);
      if (r.doc === doc) return;
      structural(r.doc, r.picked[0] ?? frame);
      others = r.picked.slice(1);
    } else structural(moveFrame(doc, from, onto), onto);
  }
  const rescale = (factor: number) => structural(scaleDurations(doc, chosen, factor));
  const addBlank = () => structural(insertFrame(doc, frame + 1), frame + 1);
  /// Several blank frames after this one at once (up to the limit), and the animation's speed as frames a second.
  let addCount = $state(4);
  function addMany() {
    let next = doc;
    const want = Math.max(1, Math.min(64, Math.round(addCount)));
    let at = frame;
    for (let i = 0; i < want; i++) {
      const grown = insertFrame(next, at + 1);
      if (grown === next) break;
      next = grown;
      at++;
    }
    if (next !== doc) structural(next, frame + 1);
  }
  const fps = $derived(Math.round((1000 / Math.max(10, doc.durations[frame] ?? 100)) * 10) / 10);
  const setFps = (v: number) => {
    if (Number.isFinite(v) && v >= 0.5 && v <= 100) structural(setAnimationDuration(doc, animIndex, Math.round(1000 / v)));
  };
  /// Frames picked with Ctrl, ⌘ or Shift besides the current one: copy, delete and move act on all of them.
  let others = $state<number[]>([]);
  const chosen = $derived([...new Set([frame, ...others])].sort((a, b) => a - b));
  // picked frames belong to the animation being worked on; moving to another leaves them behind
  $effect(() => {
    const a = anim;
    const kept = untrack(() => others).filter((f) => !!a && f >= a.from && f <= a.to);
    if (kept.length !== untrack(() => others).length) others = kept;
  });
  /// Dragging along the strip above the frames shows the frame under the pointer (the frames themselves are dragged to reorder them).
  function scrubTo(e: PointerEvent) {
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    if (!animFrames.length || r.width <= 0) return;
    const at = Math.max(0, Math.min(animFrames.length - 1, Math.floor(((e.clientX - r.left) / r.width) * animFrames.length)));
    frame = animFrames[at]!;
    others = [];
  }
  function scrubDown(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    scrubTo(e);
  }
  function scrubMove(e: PointerEvent) {
    if ((e.currentTarget as HTMLElement).hasPointerCapture?.(e.pointerId)) scrubTo(e);
  }
  function pickFrame(i: number, e: MouseEvent) {
    if (e.shiftKey && anim) {
      const [lo, hi] = [Math.min(frame, i), Math.max(frame, i)];
      others = Array.from({ length: hi - lo + 1 }, (_, k) => lo + k).filter((f) => f !== frame && f >= anim!.from && f <= anim!.to);
    } else if (e.ctrlKey || e.metaKey) {
      if (i !== frame) others = others.includes(i) ? others.filter((f) => f !== i) : [...others, i];
    } else {
      frame = i;
      others = [];
    }
  }
  function duplicate() {
    if (chosen.length === 1) return structural(insertFrame(doc, frame + 1, frame), frame + 1);
    const r = duplicateFrames(doc, chosen);
    structural(r.doc, r.picked[0] ?? frame);
    others = r.picked.slice(1);
  }
  function remove() {
    if (chosen.length === 1) return structural(removeFrame(doc, frame), frame);
    structural(removeFrames(doc, chosen), Math.min(...chosen));
    others = [];
  }
  function moveChosen(target: number) {
    if (target === animIndex || !Number.isInteger(target) || target < 0) return;
    const r = moveFramesTo(doc, chosen, target);
    if (r.doc === doc) return;
    structural(r.doc, r.picked[0] ?? frame);
    others = r.picked.slice(1);
  }
  const shift = (by: number) => structural(moveFrame(doc, frame, frame + by), frame + by);
  function setDuration(ms: number) {
    if (!Number.isFinite(ms) || ms < 10) return;
    const next = cloneDoc(doc);
    next.durations[frame] = ms;
    structural(next);
  }
  const problems = $derived(tagProblems(doc));
  /// Edits that reorganise animations, which hand back the animation to show.
  function animEdit(result: { doc: SpriteDoc; index: number }) {
    if (result.doc === doc) return;
    structural(result.doc, result.doc.tags[result.index]!.from);
  }
  const newAnimation = () => animEdit(addAnimation(doc));
  const copyAnimation = () => animEdit(duplicateAnimation(doc, animIndex));
  const dropAnimation = () => {
    if (anim && doc.tags.length > 1 && confirm(`Delete the animation "${anim.name}" and its ${framesIn(anim)} frames?`)) animEdit(removeAnimation(doc, animIndex));
  };
  const shiftAnimation = (by: number) => animEdit(moveAnimation(doc, animIndex, by));

  // ---- importing a sheet ----------------------------------------------------------------------------------
  let importing = $state(false);
  let importPath = $state("");
  let importImage: Raster | null = $state(null);
  let importError = $state("");
  let gridW = $state(16);
  let gridH = $state(16);
  let gridGap = $state(0);
  let gridMargin = $state(0);
  let cutBy = $state<"size" | "count">("size");
  let gridCols = $state(4);
  let gridRows = $state(1);
  let importMode = $state<"one" | "rows">("one");
  let importName = $state("");
  let skipEmpty = $state(true);
  let appendHere = $state(false);
  let importMs = $state(100);
  let importCanvas: HTMLCanvasElement | undefined = $state();
  /// Pictures in the project that could be sheets (not this sprite's own).
  const sheetCandidates = $derived(studio.files.filter((f) => !f.dir && /\.png$/i.test(f.path) && f.path !== session?.imagePath && !f.path.endsWith(".layers.png")).map((f) => f.path));

  async function loadImport(p: string) {
    importPath = p;
    importImage = null;
    importError = "";
    if (!p) return;
    try {
      const image = await loadRaster(await studio.api!.readImage(p));
      const g = detectGrid(image);
      gridW = g.tw;
      gridH = g.th;
      gridGap = 0;
      gridMargin = 0;
      importName = p.slice(p.lastIndexOf("/") + 1).replace(/\.png$/i, "").replace(/[_-]?(sheet|strip|tiles?)$/i, "") || "animation";
      importImage = image;
    } catch (e) {
      importError = e instanceof Error ? e.message : String(e);
    }
  }
  function openImport() {
    importing = true;
    appendHere = false;
    if (!importPath || !sheetCandidates.includes(importPath)) void loadImport(sheetCandidates[0] ?? "");
  }
  /// How the sheet is cut: by the size of a tile, or by how many tiles there are across and down.
  const spec = $derived({ ...(importImage && cutBy === "count" ? gridFromCounts(importImage, gridCols, gridRows, gridGap, gridMargin) : { tw: gridW, th: gridH }), spacing: gridGap, margin: gridMargin });
  const grid = $derived(importImage ? gridTiles(importImage, spec) : null);
  function smartSlice() {
    if (!importImage) return;
    const g = smartGrid(importImage);
    if (!g) return void studio.say("info", "No gaps between the tiles to find. Set the size or count yourself.");
    cutBy = "size";
    gridW = g.tw;
    gridH = g.th;
    gridGap = g.spacing ?? 0;
    gridMargin = g.margin ?? 0;
  }
  /// The animations the import would make: one with every tile, or one per row of the sheet.
  const groups = $derived.by(() => {
    if (!grid) return [];
    const keep = (tiles: Raster[]) => (skipEmpty ? tiles.filter((t) => !isClear(t)) : tiles);
    const name = importName.trim() || "animation";
    if (importMode === "one") return [{ name, tiles: keep(grid.tiles) }];
    return Array.from({ length: grid.rows }, (_, r) => ({ name: `${name} ${r + 1}`, tiles: keep(grid!.tiles.slice(r * grid!.columns, (r + 1) * grid!.columns)) })).filter((g) => g.tiles.length);
  });
  const isPristineNow = $derived(isPristine(doc));
  const importCount = $derived(groups.reduce((n, g) => n + g.tiles.length, 0));
  $effect(() => {
    const ctx = importCanvas?.getContext("2d");
    const image = importImage;
    if (!ctx || !importCanvas || !image || !importing) return;
    const scale = Math.max(1, Math.min(8, Math.floor(420 / Math.max(image.w, 1)), Math.floor(260 / Math.max(image.h, 1))));
    importCanvas.width = image.w * scale;
    importCanvas.height = image.h * scale;
    const tmp = document.createElement("canvas");
    tmp.width = image.w;
    tmp.height = image.h;
    tmp.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.w, image.h), 0, 0);
    ctx.fillStyle = "#2e313b";
    ctx.fillRect(0, 0, importCanvas.width, importCanvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, importCanvas.width, importCanvas.height);
    if (!grid) return;
    ctx.strokeStyle = "rgba(255,209,102,.85)";
    ctx.lineWidth = 1;
    for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.columns; c++) {
      ctx.strokeRect((spec.margin + c * (spec.tw + spec.spacing)) * scale + 0.5, (spec.margin + r * (spec.th + spec.spacing)) * scale + 0.5, spec.tw * scale - 1, spec.th * scale - 1);
    }
  });
  function doImport() {
    if (!importCount) return;
    const sizeBefore = [doc.fw, doc.fh];
    const r = importTiles(doc, groups, { append: appendHere ? animIndex : undefined, layer: activeLayer, durationMs: importMs });
    if (r.doc === doc) return;
    structural(r.doc, r.doc.tags[r.index]!.from);
    if (sizeBefore[0] !== doc.fw || sizeBefore[1] !== doc.fh) zoom = Math.max(1, Math.min(32, Math.floor(420 / Math.max(doc.fw, doc.fh))));
    importing = false;
    studio.say("info", r.truncated ? `Imported ${r.added} frames; ${r.truncated} more did not fit (the limit is 256 frames).` : `Imported ${r.added} frame${r.added === 1 ? "" : "s"}.`);
  }

  // ---- layers -------------------------------------------------------------------------------------
  function layerEdit(result: { doc: SpriteDoc; index: number }) {
    if (result.doc === doc) return;
    structural(result.doc);
    activeLayer = result.index;
  }
  const newLayer = () => layerEdit(addLayer(doc, activeLayer));
  const copyLayer = () => layerEdit(duplicateLayer(doc, activeLayer));
  const dropLayer = () => {
    const next = removeLayer(doc, activeLayer);
    if (next !== doc) {
      structural(next);
      activeLayer = Math.max(0, Math.min(activeLayer, next.layers.length - 1));
    }
  };
  const shiftLayer = (by: number) => layerEdit(moveLayer(doc, activeLayer, by));
  const groupThis = () => layerEdit(groupLayers(doc, activeLayer, activeLayer));
  const ungroupThis = () => {
    const next = ungroup(doc, activeLayer);
    if (next !== doc) {
      structural(next);
      activeLayer = Math.max(0, Math.min(activeLayer, next.layers.length - 1));
    }
  };
  const activeFx = $derived(doc.layers[activeLayer]?.effects);
  const setFx = (list: ReturnType<typeof addLayerEffect>) => setLayer(activeLayer, { effects: list });
  const mergeLayer = () => layerEdit(mergeDown(doc, activeLayer));
  const newTextLayer = () => layerEdit(addTextLayer(doc, activeLayer, { color: hex(color).slice(0, 7), scale: 1 }));
  const activeText = $derived(doc.layers[activeLayer]?.text);
  const setText = (change: Partial<TextSource>) => structural(setLayerText(doc, activeLayer, change));
  const setLayer = (i: number, change: Parameters<typeof updateLayer>[2]) => structural(updateLayer(doc, i, change));
  /// Top layer first, as in most drawing programs.
  const layerRows = $derived(doc.layers.map((l, i) => ({ l, i })).reverse());

  // ---- preview ----------------------------------------------------------------------------------
  let playing = $state(false);
  let previewFrame = $state(0);
  $effect(() => {
    if (!playing) return;
    const tag = doc.tags[animIndex];
    const sequence = tag ? tagSequence(tag) : doc.frames.map((_, i) => i);
    const loop = tag ? tag.loop : true;
    const started = performance.now();
    let id = 0;
    const tick = () => {
      previewFrame = frameAt(doc, sequence, performance.now() - started, loop);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  });
  $effect(() => {
    const ctx = preview?.getContext("2d");
    if (!ctx || !preview || !ready) return;
    const shown = playing ? previewFrame : frame;
    const r = doc.frames[Math.min(shown, doc.frames.length - 1)] ?? doc.frames[0]!;
    // a tiled sprite is shown repeated three times across and down, as a pattern
    const [repX, repY] = [tileX ? 3 : 1, tileY ? 3 : 1];
    const scale = Math.max(1, Math.floor(112 / Math.max(r.w * repX, r.h * repY)));
    preview.width = r.w * repX * scale;
    preview.height = r.h * repY * scale;
    ctx.imageSmoothingEnabled = false;
    const tmp = document.createElement("canvas");
    tmp.width = r.w;
    tmp.height = r.h;
    tmp.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.w, r.h), 0, 0);
    for (let j = 0; j < repY; j++) for (let i = 0; i < repX; i++) ctx.drawImage(tmp, i * r.w * scale, j * r.h * scale, r.w * scale, r.h * scale);
    rev;
  });

  // ---- keyboard -----------------------------------------------------------------------------------
  function key(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA") return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    } else if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
    } else if (mod && e.key.toLowerCase() === "c" && selection) {
      e.preventDefault();
      copySelection();
    } else if (mod && e.key.toLowerCase() === "x" && selection) {
      e.preventDefault();
      copySelection(true);
    } else if (mod && e.key.toLowerCase() === "v" && clipboard) {
      e.preventDefault();
      paste();
    } else if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      tool = "select";
      setRect({ x: 0, y: 0, w: doc.fw, h: doc.fh });
    } else if ((e.key === "Delete" || e.key === "Backspace") && selection) {
      e.preventDefault();
      clearSelection();
    } else if (e.key === "Enter" && selPoly) {
      e.preventDefault();
      selPolyFinish();
    } else if (e.key === "Escape" && selPoly) {
      setSelection(selPoly.base);
      selPoly = null;
    } else if (e.key === "Enter" && poly.length) {
      e.preventDefault();
      finishPolygon();
    } else if (e.key === "Escape" && poly.length) {
      cancelPolygon();
    } else if (e.key === "Escape" && importing) {
      importing = false;
    } else if (e.key === "Escape" && selection) {
      setSelection(null);
    } else if (!mod) {
      // (the tool letters are commands now: see the Sprite menu and Edit > Keyboard shortcuts)
      if (e.key === "[") size = Math.max(1, size - 1);
      else if (e.key === "]") size = Math.min(16, size + 1);
      else if (e.key === "ArrowLeft") frame = Math.max(anim?.from ?? 0, frame - 1);
      else if (e.key === "ArrowRight") frame = Math.min(anim?.to ?? doc.frames.length - 1, frame + 1);
      else if (e.key === " ") {
        e.preventDefault();
        playing = !playing;
      } else return;
      e.preventDefault();
    }
  }

  // ---- palettes -----------------------------------------------------------------------------------------
  const palettes = new PaletteStore();
  let palRev = $state(0);
  let snapToPalette = $state(false);
  let paletteFile: HTMLInputElement | undefined = $state();
  const palette = $derived((void palRev, palettes.get()));
  const userPalette = $derived((void palRev, !palettes.isBuiltin(palettes.current)));
  /// Changes the colours of the palette in use (a built-in palette is copied first, so it stays as it was).
  function editPalette(colors: string[]) {
    if (palettes.isBuiltin(palettes.current)) palettes.add({ name: `${palettes.current} copy`, colors });
    else palettes.setColors(palettes.current, colors);
    palRev++;
  }
  function addToPalette() {
    const c = hex(color);
    if (palette.colors.includes(c)) return;
    editPalette([...palette.colors, c]);
  }
  const takeOut = (c: string) => editPalette(palette.colors.filter((x) => x !== c));
  /// The swatch picked for moving (Shift-click a swatch), and the ramp and shade options.
  let selSwatch = $state(-1);
  let rampSteps = $state(5);
  const addColors = (more: string[]) => editPalette([...new Set([...palette.colors, ...more])].slice(0, 256));
  const sortPalette = (by: SortBy) => editPalette(sortColors(palette.colors, by));
  function moveSwatch(by: number) {
    if (selSwatch < 0) return;
    const to = selSwatch + by;
    const next = swapSwatches(palette.colors, selSwatch, to);
    if (next !== palette.colors) {
      editPalette(next);
      selSwatch = to;
    }
  }
  function paletteFromPicture() {
    const colors = usedColors(doc.frames[frame]!);
    if (!colors.length) return studio.say("info", "This picture has no colours yet.");
    palettes.add({ name: "From picture", colors });
    palRev++;
  }
  async function importPalette(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    let p: Palette | null = null;
    if (/\.png$/i.test(file.name)) {
      const url = URL.createObjectURL(file);
      try {
        p = paletteFromImage((await loadRaster(url)).data, file.name.replace(/\.[^.]*$/, ""));
      } catch {
        p = null;
      } finally {
        URL.revokeObjectURL(url);
      }
    } else p = parsePalette(await file.text(), file.name);
    if (!p) return studio.say("error", `${file.name} is not a palette the studio can read (.gpl, .pal, a PNG, a list of hex colours, or JSON).`);
    palettes.add(p);
    palRev++;
  }
  /// Keeps the palettes of the person's own (and the one in use) in the project's palettes.json, where Model reads them too; palettes of the same name there are replaced.
  async function palettesToProject() {
    if (!studio.api) return;
    try {
      let existing: Palette[] = [];
      try {
        const parsed = parseProjectPalettes((await studio.api.readFile(PROJECT_PALETTES_PATH)).text ?? "");
        if (parsed.ok) existing = parsed.palettes;
      } catch {
        // no file yet
      }
      const mine = [...palettes.user, ...(palettes.isBuiltin(palettes.current) ? [palettes.get()] : [])];
      const text = serializeProjectPalettes(withPalettes(existing, mine));
      if (studio.files.some((f) => f.path === PROJECT_PALETTES_PATH)) await studio.api.writeFile(PROJECT_PALETTES_PATH, text);
      else await studio.api.createFile(PROJECT_PALETTES_PATH, text);
      await studio.refreshFiles();
      studio.say("info", `Saved ${mine.length} palette${mine.length === 1 ? "" : "s"} to ${PROJECT_PALETTES_PATH}: Sprites and Model can both use them.`);
    } catch (e) {
      studio.say("error", String(e));
    }
  }
  /// Brings the project's palettes into this computer's list (a palette of the same name here is kept as it is).
  async function palettesFromProject() {
    if (!studio.api) return;
    try {
      const parsed = parseProjectPalettes((await studio.api.readFile(PROJECT_PALETTES_PATH)).text ?? "");
      if (!parsed.ok) return studio.say("error", parsed.error);
      let added = 0;
      for (const p of parsed.palettes) if (!palettes.all().some((q) => q.name === p.name)) { palettes.add(p); added++; }
      palRev++;
      studio.say("info", added ? `Added ${added} palette${added === 1 ? "" : "s"} from the project.` : "Every palette in the project is already here.");
    } catch {
      studio.say("info", "This project has no palettes.json yet: use \"To project\" first.");
    }
  }
  /// The whole sheet as an indexed PNG in exports/: every pixel a number into the palette in use (or, if that palette is empty, the picture's own colours).
  async function exportIndexed() {
    const sheet = toSheet(doc);
    const colors = paletteRgba().length ? paletteRgba() : paletteOfPicture(sheet);
    const x = toIndexed(sheet, colors);
    const path = `exports/${(fromPath.slice(fromPath.lastIndexOf("/") + 1).replace(/\.(sprite\.json|png)$/i, "") || "sprite").replace(/[^A-Za-z0-9_-]+/g, "_")}_indexed.png`;
    try {
      await studio.api!.writeExport(path, `data:image/png;base64,${toBase64(encodeIndexedPng(x))}`);
      await studio.refreshFiles();
      studio.say("info", `Saved ${path}: ${x.palette.length - 1} palette colours + transparent. Pixels were matched to the nearest colour of the palette in use.`);
    } catch (e) {
      studio.say("error", String(e));
    }
  }
  /// Writes the palette as a .gpl into the project's exports folder (the studio's window cannot be relied on to save a download).
  async function exportPalette(format: "gpl" | "pal" = "gpl") {
    const p: Palette = palette;
    const path = `exports/${p.name.replace(/[^A-Za-z0-9_-]+/g, "_")}.${format}`;
    try {
      await studio.api!.writeExport(path, `data:text/plain;base64,${toBase64(new TextEncoder().encode(format === "gpl" ? toGpl(p) : toJascPal(p)))}`);
      await studio.refreshFiles();
      studio.say("info", `Saved ${path}. ${format === "gpl" ? "GIMP, Aseprite, Pixelorama and others read .gpl palettes." : "Paint Shop Pro, Aseprite and others read .pal palettes."}`);
    } catch (e) {
      studio.say("error", String(e));
    }
  }
  /// The current animation as an animated GIF in `exports/`, scaled up by a whole number so a small sprite is big enough to share.
  async function exportGif(opts: { colors?: number; dither?: boolean } = {}) {
    const tag = doc.tags[animIndex];
    if (!tag) return;
    const sequence = tagSequence(tag);
    const k = Math.max(1, Math.min(8, Math.floor(256 / Math.max(doc.fw, doc.fh))));
    const gif = encodeGif(sequence.map((i) => ({ raster: scaleRaster(doc.frames[i]!, k), ms: doc.durations[i] ?? 100 })), tag.loop, opts);
    const base = fromPath.slice(fromPath.lastIndexOf("/") + 1).replace(/\.(sprite\.json|png)$/i, "");
    const path = `exports/${base}_${tag.name.replace(/[^A-Za-z0-9_-]+/g, "_")}.gif`;
    try {
      await studio.api!.writeExport(path, `data:image/gif;base64,${toBase64(gif)}`);
      await studio.refreshFiles();
      studio.say("info", `Saved ${path} (${sequence.length} frame${sequence.length === 1 ? "" : "s"}, ${k}x).`);
    } catch (e) {
      studio.say("error", String(e));
    }
  }

  /// The current animation as an animated PNG in `exports/` (the same scale rule as the GIF; it keeps full colour and soft edges).
  async function exportApng() {
    const tag = doc.tags[animIndex];
    if (!tag) return;
    const sequence = tagSequence(tag);
    const k = Math.max(1, Math.min(8, Math.floor(256 / Math.max(doc.fw, doc.fh))));
    const png = encodeApng(sequence.map((i) => ({ picture: scaleRaster(doc.frames[i]!, k), ms: doc.durations[i] ?? 100 })), tag.loop ? 0 : 1);
    const base = fromPath.slice(fromPath.lastIndexOf("/") + 1).replace(/\.(sprite\.json|png)$/i, "");
    const path = `exports/${base}_${tag.name.replace(/[^A-Za-z0-9_-]+/g, "_")}_anim.png`;
    try {
      await studio.api!.writeExport(path, `data:image/png;base64,${toBase64(png)}`);
      await studio.refreshFiles();
      studio.say("info", `Saved ${path} (${sequence.length} frame${sequence.length === 1 ? "" : "s"}, ${k}x). Browsers and most image viewers play it.`);
    } catch (e) {
      studio.say("error", String(e));
    }
  }
  /// Cuts the selection out as a brush for the pencil and eraser.
  function brushFromSelection() {
    const mask = currentMask();
    const lifted = mask ? liftMasked(cel(), mask) : null;
    const b = lifted ? brushFromRaster(lifted.piece) : null;
    if (!b) return void studio.say("info", "Select some drawn pixels first, then use them as a brush.");
    pictureBrush = b;
    tool = "pencil";
  }
  /// An object with one field changed, by the field's name (for the numeric inputs of boxes, points and borders).
  const withKey = <T extends object>(base: T, key: string, value: number): T => ({ ...base, [key]: value }) as T;
  let exporting = $state(false);
  let importFile: HTMLInputElement | undefined = $state();
  /// Opens another program's animation (a GIF, an animated PNG or an Aseprite file) in place of this sprite; undo brings the old one back.
  async function importFromFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      const r = await importAnimation(new Uint8Array(await file.arrayBuffer()));
      structural(r.doc, 0);
      setSelection(null);
      zoom = Math.max(1, Math.min(32, Math.floor(420 / Math.max(doc.fw, doc.fh))));
      studio.say(r.warnings.length ? "error" : "info", `Opened ${file.name}: ${r.what}.${r.warnings.length ? " " + r.warnings.join(" ") : ""} Undo brings the old sprite back.`);
    } catch (err) {
      studio.say("error", `${file.name}: ${err instanceof Error ? err.message : err}`);
    }
  }
  let fxBlock = $state(2);
  let fxBright = $state(0);
  let fxContrast = $state(0);
  let fxGamma = $state(1);
  const paletteRgba = () => palette.colors.map((c) => parseHex(c)).filter((c): c is Rgba => !!c);

  // ---- effects and the Sprite menu ---------------------------------------------------------------------------
  /// Applies an effect to the current cel, inside the selection when there is one (one undo step).
  /// True (and says so) when the layer being worked on is locked, so the commands that change its pixels leave it alone.
  function lockedLayer(): boolean {
    const l = doc.layers[activeLayer];
    if (l?.locked) studio.say("info", `"${l.name}" is locked. Unlock it (the padlock) to change it.`);
    return !!l?.locked;
  }
  function applyFx(fx: (r: Raster, area: Area) => Raster | null) {
    if (lockedLayer()) return;
    const next = cloneDoc(doc);
    const cel = next.layers[activeLayer]!.cels[frame]!;
    const out = fx(cel, selection ? (selMask ? { ...selection, has: (x: number, y: number) => has(selMask!, x, y) } : selection) : null);
    if (!out) return studio.say("info", "A quarter turn needs a square: select a square area, or use a square sprite.");
    cel.data.set(out.data);
    structural(next);
  }
  const applyGradientMap = () => applyFx((r, a) => gradientMap(r, [{ at: 0, color }, { at: 1, color: rightColor }], a));
  const applyPalettize = () => applyFx((r, a) => palettize(r, paletteRgba(), a));
  let celTarget = $state(2);
  let offsetX = $state(1);
  let offsetY = $state(0);
  const applyReplace = () => applyFx((r, a) => replaceColor(r, color, rightColor, a));
  const applyOffset = () => applyFx((r) => offsetWrap(r, Math.round(offsetX), Math.round(offsetY)));
  const applyPixelate = () => applyFx((r, a) => pixelate(r, fxBlock, a));
  const applyCurves = () => {
    applyFx((r, a) => colorCurve(r, fxBright, fxContrast, fxGamma, a));
    fxBright = fxContrast = 0;
    fxGamma = 1;
  };
  $effect(() => {
    const has = () => ready && !!doc.layers[activeLayer];
    const has_ = has;
    const tool_ = (id: Tool, label: string, key: string, icon?: string) =>
      commands.register({ id: `sprite.tool.${id}`, title: label, menu: "Sprite", icon, keys: [key], enabled: () => ready, run: () => { tool = id; } });
    const offs = [
      ...TOOLS.map((t) => tool_(t.id, t.label, t.key, t.id === "select" ? "select" : t.id === "eraser" ? "trash" : t.id === "picker" ? "eye" : undefined)),
      commands.register({ id: "sprite.selectAll", title: "Select all", menu: "Sprite", icon: "selectAll", keys: ["Mod+Shift+A"], enabled: has_, run: () => { tool = "select"; setRect({ x: 0, y: 0, w: doc.fw, h: doc.fh }); } }),
      commands.register({ id: "sprite.selectNone", title: "Select nothing", menu: "Sprite", icon: "selectNone", keys: ["Mod+D"], enabled: () => has_() && !!selection, run: () => setSelection(null) }),
      commands.register({ id: "sprite.selectInvert", title: "Invert the selection", menu: "Sprite", icon: "selectInvert", keys: ["Mod+I"], enabled: () => has_() && !!selection, run: () => { const m = currentMask(); if (m) setSelection(invertMask(m)); } }),
      commands.register({ id: "sprite.selectGrow", title: "Grow the selection by one pixel", menu: "Sprite", enabled: () => has_() && !!selection, run: () => { const m = currentMask(); if (m) setSelection(growMask(m, 1)); } }),
      commands.register({ id: "sprite.selectShrink", title: "Shrink the selection by one pixel", menu: "Sprite", enabled: () => has_() && !!selection, run: () => { const m = currentMask(); if (m) setSelection(growMask(m, -1)); } }),
      commands.register({ id: "sprite.cropToSelection", title: "Crop the sprite to the selection", menu: "Sprite", help: "Every frame and layer is cut down to the selection's box", enabled: () => has_() && !!selection, run: () => { if (selection) { structural(cropDoc(doc, selection)); setSelection(null); zoom = Math.max(1, Math.min(32, Math.floor(420 / Math.max(doc.fw, doc.fh)))); } } }),
      commands.register({ id: "sprite.exportGif", title: "Export this animation as a GIF", menu: "Sprite", icon: "export", help: "An animated GIF of the animation being worked on, in the exports folder", enabled: has, run: () => void exportGif() }),
      commands.register({ id: "sprite.export", title: "Export…", menu: "Sprite", icon: "export", help: "Frames, layers, a packed sheet with an atlas, or an animation", enabled: has, run: () => { exporting = true; } }),
      commands.register({ id: "sprite.import", title: "Open a GIF, animated PNG or Aseprite file…", menu: "Sprite", icon: "file", help: "Replaces this sprite with the file's frames (undo brings it back)", enabled: () => ready, run: () => importFile?.click() }),
      commands.register({ id: "sprite.exportApng", title: "Export this animation as an animated PNG", menu: "Sprite", icon: "export", help: "Full colour, in the exports folder", enabled: has, run: () => void exportApng() }),
      commands.register({ id: "sprite.brushFromSelection", title: "Use the selection as a brush", menu: "Sprite", help: "The pencil and eraser stamp the selected pixels", enabled: () => has_() && !!selection, run: brushFromSelection }),
      commands.register({ id: "sprite.gradientMap", title: "Gradient map (current colour to the other colour)", menu: "Sprite", enabled: has, run: applyGradientMap }),
      commands.register({ id: "sprite.palettize", title: "Change every colour to the nearest palette colour", menu: "Sprite", enabled: has, run: applyPalettize }),
      commands.register({ id: "sprite.replaceColor", title: "Replace the left colour with the right one", menu: "Sprite", help: "Every pixel of the left button's colour (in the selection, or everywhere) becomes the right button's colour", enabled: has, run: applyReplace }),
      commands.register({ id: "sprite.pixelate", title: "Pixelate (blocks as set in the Effects panel)", menu: "Sprite", enabled: has, run: applyPixelate }),
      commands.register({ id: "sprite.zoomIn", title: "Zoom in", menu: "Sprite", keys: ["Mod+="], enabled: () => ready, run: () => setZoom(zoom + (zoom >= 8 ? 4 : 1)) }),
      commands.register({ id: "sprite.zoomOut", title: "Zoom out", menu: "Sprite", keys: ["Mod+-"], enabled: () => ready, run: () => setZoom(zoom - (zoom > 8 ? 4 : 1)) }),
      commands.register({ id: "sprite.swapColors", title: "Swap the two colours", menu: "Sprite", keys: ["X"], enabled: () => ready, run: swapColors }),
      commands.register({ id: "sprite.flipH", title: "Flip left to right", menu: "Sprite", enabled: has, run: () => applyFx((r, a) => flipRaster(r, false, a)) }),
      commands.register({ id: "sprite.flipV", title: "Flip top to bottom", menu: "Sprite", enabled: has, run: () => applyFx((r, a) => flipRaster(r, true, a)) }),
      commands.register({ id: "sprite.turnRight", title: "Turn a quarter clockwise", menu: "Sprite", icon: "rotate", enabled: has, run: () => applyFx((r, a) => rotateQuarter(r, false, a)) }),
      commands.register({ id: "sprite.layer.new", title: "New layer", menu: "Layer", help: "An empty layer above this one", enabled: () => has_() && doc.layers.length < MAX_LAYERS, run: newLayer }),
      commands.register({ id: "sprite.layer.copy", title: "Duplicate the layer", menu: "Layer", enabled: () => has_() && doc.layers.length < MAX_LAYERS, run: copyLayer }),
      commands.register({ id: "sprite.layer.delete", title: "Delete the layer", menu: "Layer", enabled: () => has_() && doc.layers.length > 1, run: dropLayer }),
      commands.register({ id: "sprite.layer.up", title: "Move the layer up", menu: "Layer", enabled: () => has_() && activeLayer < doc.layers.length - 1, run: () => shiftLayer(1) }),
      commands.register({ id: "sprite.layer.down", title: "Move the layer down", menu: "Layer", enabled: () => has_() && activeLayer > 0, run: () => shiftLayer(-1) }),
      commands.register({ id: "sprite.layer.merge", title: "Merge the layer down", menu: "Layer", help: "Join it into the layer below", enabled: () => has_() && activeLayer > 0, run: () => layerEdit(mergeDown(doc, activeLayer)) }),
      commands.register({ id: "sprite.frame.new", title: "New blank frame", menu: "Frame", help: "After this one", enabled: has_, run: addBlank }),
      commands.register({ id: "sprite.frame.copy", title: "Duplicate the frame", menu: "Frame", enabled: has_, run: duplicate }),
      commands.register({ id: "sprite.frame.delete", title: "Delete the frame", menu: "Frame", enabled: () => has_() && !!anim && framesIn(anim) > 1, run: remove }),
      commands.register({ id: "sprite.frame.next", title: "Next frame", menu: "Frame", enabled: () => has_() && !!anim && frame < anim.to, run: () => { frame = Math.min(anim!.to, frame + 1); } }),
      commands.register({ id: "sprite.frame.previous", title: "Previous frame", menu: "Frame", enabled: () => has_() && !!anim && frame > anim.from, run: () => { frame = Math.max(anim!.from, frame - 1); } }),
      commands.register({ id: "sprite.frame.left", title: "Move the frame earlier", menu: "Frame", enabled: () => has_() && !!anim && frame > anim.from, run: () => shift(-1) }),
      commands.register({ id: "sprite.frame.right", title: "Move the frame later", menu: "Frame", enabled: () => has_() && !!anim && frame < anim.to, run: () => shift(1) }),
      commands.register({ id: "sprite.turnLeft", title: "Turn a quarter counter-clockwise", menu: "Sprite", enabled: has, run: () => applyFx((r, a) => rotateQuarter(r, true, a)) }),
      commands.register({ id: "sprite.invert", title: "Invert the colours", menu: "Sprite", enabled: has, run: () => applyFx((r, a) => invertColors(r, a)) }),
      commands.register({ id: "sprite.grayscale", title: "Make it grey", menu: "Sprite", enabled: has, run: () => applyFx((r, a) => grayscale(r, a)) }),
      commands.register({ id: "sprite.hue", title: "Shift the hue by 30 degrees", menu: "Sprite", enabled: has, run: () => applyFx((r, a) => hueShift(r, 30, a)) }),
      commands.register({ id: "sprite.lighter", title: "Make it lighter", menu: "Sprite", enabled: has, run: () => applyFx((r, a) => brighten(r, 0.15, a)) }),
      commands.register({ id: "sprite.darker", title: "Make it darker", menu: "Sprite", enabled: has, run: () => applyFx((r, a) => brighten(r, -0.15, a)) }),
      commands.register({ id: "sprite.outline", title: "Outline in the current colour", menu: "Sprite", help: "A line of the current colour round the shapes", enabled: has, run: () => applyFx((r) => outline(r, color)) }),
      commands.register({ id: "sprite.shadow", title: "Drop shadow in the current colour", menu: "Sprite", help: "A copy of the shapes one pixel down and right, behind them", enabled: has, run: () => applyFx((r) => dropShadow(r, 1, 1, color)) }),
    ];
    return () => offs.forEach((off) => off());
  });

  /// WebKit sends a pinch as gesture events (not wheel events); other engines send Ctrl with the wheel.
  function pinch(node: HTMLElement, h: { start: (e: Event) => void; change: (e: Event) => void }) {
    node.addEventListener("gesturestart", h.start);
    node.addEventListener("gesturechange", h.change);
    return { destroy: () => { node.removeEventListener("gesturestart", h.start); node.removeEventListener("gesturechange", h.change); } };
  }
  const hex = (c: Rgba) => toHex([c[0], c[1], c[2], 255]);
  const swapColors = () => {
    [color, rightColor] = [rightColor, color];
  };
  const same = (a: Rgba, b: string) => hex(a) === b;
  function pickHex(h: string) {
    if (snapToPalette) h = nearestColor(palette.colors, h);
    const c = parseHex(h);
    if (c) color = c;
  }
  // the status bar: what the buttons do on the canvas, and the picture's size
  $effect(() => {
    studio.statusHint = "Left click: the tool · right click: the second tool · ⇧-click draws a line from the last point · Alt picks a colour";
    studio.statusInfo = `${doc.fw}×${doc.fh} · ${doc.frames.length} frame${doc.frames.length === 1 ? "" : "s"} · zoom ${zoom * 100}%`;
    return () => {
      studio.statusHint = "";
      studio.statusInfo = "";
    };
  });
</script>

<svelte:window onkeydown={key} />

{#if exporting}
  <SpriteExportDialog {doc} base={fromPath.slice(fromPath.lastIndexOf("/") + 1).replace(/\.(sprite\.json|png)$/i, "")} storeKey={fromPath} ongif={(o) => void exportGif(o)} onapng={() => void exportApng()} onclose={() => (exporting = false)} />
{/if}
<input bind:this={importFile} type="file" accept=".gif,.png,.aseprite,.ase,image/gif,image/png" hidden onchange={importFromFile} />

{#if failure}
  <div class="fail">
    <p><strong>This sprite can't be opened.</strong></p>
    <p class="dim">{failure}</p>
  </div>
{:else if !ready}
  <div class="fail dim">Loading…</div>
{:else}
  <div class="studio">
    <nav class="tools" aria-label="Tools">
      {#each TOOLS as t (t.id)}
        <button class:on={tool === t.id} title="{t.label} ({t.key})" aria-label={t.label} onclick={() => (tool = t.id)}>{t.icon}</button>
      {/each}
      <hr />
      <button title="Undo (⌘Z)" aria-label="Undo" disabled={!canUndo} onclick={undo}>↶</button>
      <button title="Redo (⇧⌘Z)" aria-label="Redo" disabled={!canRedo} onclick={redo}>↷</button>
      <hr />
      <button title="Flip frame horizontally" aria-label="Flip horizontally" onclick={() => flip(true)}>⇋</button>
      <button title="Flip frame vertically" aria-label="Flip vertically" onclick={() => flip(false)}>⇅</button>
      <button title="Clear frame" aria-label="Clear frame" onclick={clearFrame}>␡</button>
    </nav>

    <section class="work">
      <div class="options">
        <select class="toolselect" value={tool} onchange={(e) => (tool = e.currentTarget.value as Tool)} aria-label="Tool" title="The tool in use (the column on the left has them all)">
          {#each TOOLS as t (t.id)}<option value={t.id}>{t.label.replace(/ \(.*/, "")}</option>{/each}
        </select>
        <label>Size <input type="number" min="1" max="16" bind:value={size} class="narrow" /></label>
        {#if tool === "pencil" || tool === "eraser" || tool === "shade"}
          <label title="The shape of the brush">Brush <select bind:value={brushShape}>{#each BRUSH_SHAPES as b (b)}<option value={b}>{b}</option>{/each}</select></label>
        {/if}
        {#if tool === "pencil" || tool === "eraser"}<label class="check" title="With a pen, pressing harder makes the line thicker or stronger (a mouse is unaffected)"><input type="checkbox" bind:checked={usePressure} /> Pen pressure</label>
          {#if usePressure}<select bind:value={pressureFor} aria-label="What pressure changes" title="What the pressure of a pen changes"><option value="size">thickness</option><option value="opacity">opacity</option></select>{/if}{/if}
        {#if (tool === "pencil" || tool === "eraser") && pictureBrush}
          <span class="dim" title="The pencil and eraser stamp a picture cut from the canvas">Picture brush ({pictureBrush.cells.length} pixels)</span>
          {#if tool === "pencil"}<label class="check" title="Stamp with its own colours (off: stamp the shape in the current colour)"><input type="checkbox" bind:checked={brushKeepsColors} /> Its colours</label>{/if}
          <button class="ghost" onclick={() => (pictureBrush = null)}>Back to the round brush</button>
        {/if}
        {#if tool === "fill"}
          <label class="slider" title="How different a colour may be and still be filled (0 is exactly the same)"><span>Tolerance</span><input type="range" min="0" max="255" step="1" bind:value={fillTolerance} /><output>{fillTolerance}</output></label>
          <label title="Joined area, or every pixel of that colour in the picture">Fill <select bind:value={fillEverywhere}><option value={false}>joined area</option><option value={true}>same colour everywhere</option></select></label>
          {#if selection}<label class="check" title="Only change pixels inside the selection"><input type="checkbox" bind:checked={fillInSelection} /> Inside the selection</label>{/if}
        {/if}
        {#if selection && isSelectTool(tool)}
          <span class="seltools" role="group" aria-label="Turn or resize the selection">
            <label class="inline" title="Degrees">Turn <input type="number" min="1" max="359" step="1" bind:value={turnDegrees} class="narrow" aria-label="Degrees to turn" />°</label>
            <button onclick={() => turnSelection(-1)} title="Turn the selected pixels anticlockwise" aria-label="Turn anticlockwise">↺</button>
            <button onclick={() => turnSelection(1)} title="Turn the selected pixels clockwise" aria-label="Turn clockwise">↻</button>
            <label class="check" title="RotSprite: enlarge, turn and shrink so that lines stay clean (off: the plain nearest-pixel turn)"><input type="checkbox" bind:checked={cleanTurn} /> Clean edges</label>
            <label class="inline">Resize <input type="number" min="10" max="800" step="10" bind:value={scalePercent} class="narrow" aria-label="Resize percent" />%</label>
            <button onclick={scaleSelection} title="Make the selected pixels this much bigger or smaller (nearest pixel)">Resize</button>
          </span>
        {/if}
        {#if tool === "text"}
          <label>Text <input bind:value={textValue} class="wide" aria-label="Text to draw" placeholder="type here (Enter makes no new line: use \n)" /></label>
          <label>Scale <input type="number" min="1" max="8" bind:value={textScale} class="narrow" aria-label="Text scale" /></label>
          <span class="dim">{textSize(textValue.replaceAll("\\n", "\n"), textScale).w} × {textSize(textValue.replaceAll("\\n", "\n"), textScale).h} px</span>
        {/if}
        {#if tool === "polygon"}
          <span class="dim">{polyShown ? `${polyShown} corner${polyShown === 1 ? "" : "s"}: click the first one, double-click or Enter to finish, Esc to drop` : "Click the corners of the shape"}</span>
        {/if}
        {#if tool === "shade"}
          <label class="check" title="Paint darker instead of lighter"><input type="checkbox" bind:checked={shadeDarker} /> Darker</label>
        {/if}
        {#if tool === "gradient"}
          <label title="With a pattern the gradient uses only its two colours, like pixel art does">Dither <select bind:value={dither}>{#each DITHERS as d (d)}<option value={d}>{d}</option>{/each}</select></label>
        {/if}
        {#if tool === "wand" || tool === "colorSelect"}
          <label class="slider" title="How different a colour may be and still be picked (0 is exactly the same)"><span>Tolerance</span><input type="range" min="0" max="255" step="1" bind:value={tolerance} /><output>{tolerance}</output></label>
        {/if}
        {#if tool === "rect" || tool === "ellipse" || tool === "polygon"}
          <label class="check"><input type="checkbox" bind:checked={filled} /> Filled</label>
        {/if}
        {#if tool === "pencil"}<label class="check" title="One-pixel lines without double corners"><input type="checkbox" bind:checked={perfect} /> Pixel-perfect</label>{/if}
        <label title="Draw every stroke mirrored: across the middle, up and down, both, or along the diagonal">Symmetry
          <select value={symQ ? "quarter" : symP ? "point" : symD ? "diagonal" : symX && symY ? "both" : symX ? "horizontal" : symY ? "vertical" : "off"} onchange={(e) => { const v = e.currentTarget.value; symX = v === "horizontal" || v === "both"; symY = v === "vertical" || v === "both"; symD = v === "diagonal"; symP = v === "point"; symQ = v === "quarter"; }} aria-label="Symmetry">
            <option value="off">off</option><option value="horizontal">left–right</option><option value="vertical">up–down</option><option value="both">both</option><option value="diagonal">diagonal</option><option value="point">about the middle</option><option value="quarter">four-way turn</option>
          </select>
        </label>
        <label title="Draw as if the picture were tiled: strokes wrap round the edges">Tiled
          <select value={tileX && tileY ? "both" : tileX ? "x" : tileY ? "y" : "off"} onchange={(e) => { const v = e.currentTarget.value; tileX = v === "x" || v === "both"; tileY = v === "y" || v === "both"; }} aria-label="Tiled">
            <option value="off">off</option><option value="x">across</option><option value="y">down</option><option value="both">both</option>
          </select>
        </label>
        <details class="viewopts"><summary title="Onion skin, grid, rulers and canvas size">View ▾</summary>
        <div class="viewpop">
        <label class="check"><input type="checkbox" bind:checked={onion} /> Onion skin</label>
        {#if onion}
          <label title="Frames before this one shown faintly">before <select bind:value={onionPast}>{#each [0, 1, 2, 3] as n (n)}<option value={n}>{n}</option>{/each}</select></label>
          <label title="Frames after this one shown faintly">after <select bind:value={onionFuture}>{#each [0, 1, 2, 3] as n (n)}<option value={n}>{n}</option>{/each}</select></label>
          <label class="check" title="Blue for before, red for after"><input type="checkbox" bind:checked={onionTint} /> Tint</label>
        {/if}
        <label class="check"><input type="checkbox" bind:checked={showGrid} /> Grid</label>
        {#if showGrid}<label title="Draw a grid line every this many pixels">every <select bind:value={gridStep}>{#each [1, 2, 4, 8, 16, 32] as n (n)}<option value={n}>{n}</option>{/each}</select></label>{/if}
        <label class="check" title="Rulers along the top and left, in pixels"><input type="checkbox" bind:checked={rulers} /> Rulers</label>
        <button class="ghost" onclick={openSizing}>Canvas size…</button>
        </div>
        </details>
        <span class="spacer"></span>
        <button class="ghost" onclick={() => setZoom(zoom - (zoom > 8 ? 4 : 1))} aria-label="Zoom out">−</button>
        <span class="dim">{zoom * 100}%</span>
        <button class="ghost" onclick={() => setZoom(zoom + (zoom >= 8 ? 4 : 1))} aria-label="Zoom in">＋</button>
        <span class="dim">{doc.fw}×{doc.fh}{hover && inside(current, hover.x, hover.y) ? ` · ${hover.x},${hover.y}` : ""}</span>
      </div>
      {#if sizing}
        <form class="sizing" onsubmit={(e) => { e.preventDefault(); applySize(); }}>
          <label>Width <input type="number" min="1" max="1024" bind:value={newW} class="narrow" /></label>
          <label>Height <input type="number" min="1" max="1024" bind:value={newH} class="narrow" /></label>
          <label>Keep the picture at
            <select bind:value={anchor}>
              <option value="0,0">top left</option><option value="0.5,0">top</option><option value="1,0">top right</option>
              <option value="0,0.5">left</option><option value="0.5,0.5">centre</option><option value="1,0.5">right</option>
              <option value="0,1">bottom left</option><option value="0.5,1">bottom</option><option value="1,1">bottom right</option>
            </select>
          </label>
          <button class="primary">Resize all frames</button>
          <button type="button" class="ghost" onclick={() => (sizing = false)}>Cancel</button>
        </form>
      {/if}
      <div class="scrollwrap" bind:clientWidth={viewport.w} bind:clientHeight={viewport.h}>
      <div class="scroller" bind:this={scroller} onscroll={() => scrollTick++} onwheel={wheel} use:pinch={{ start: gestureStart, change: gestureChange }}>
        <div class="stage" class:ruled={rulers}>
          {#if rulers}
            <div class="ruler top" style:width="{doc.fw * zoom}px" aria-hidden="true">
              {#each ticks(doc.fw) as t (t)}<span style:left="{t * zoom}px">{t}</span>{/each}
              {#if hover}<i style:left="{hover.x * zoom + zoom / 2}px"></i>{/if}
            </div>
            <div class="ruler left" style:height="{doc.fh * zoom}px" aria-hidden="true">
              {#each ticks(doc.fh) as t (t)}<span style:top="{t * zoom}px">{t}</span>{/each}
              {#if hover}<i style:top="{hover.y * zoom + zoom / 2}px"></i>{/if}
            </div>
          {/if}
          {#if tileUrl}<div class="tilebg" aria-hidden="true" style:left="{tileX ? -doc.fw * zoom : 0}px" style:top="{tileY ? -doc.fh * zoom : 0}px" style:width="{doc.fw * zoom * (tileX ? 3 : 1)}px" style:height="{doc.fh * zoom * (tileY ? 3 : 1)}px" style:background-image="url({tileUrl})" style:background-size="{doc.fw * zoom}px {doc.fh * zoom}px"></div>{/if}
          <canvas bind:this={canvas} aria-label="Sprite canvas" class:hand={tool === "pan"} class:zooming={tool === "zoom"} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onpointerleave={leave} oncontextmenu={(e) => e.preventDefault()}></canvas>
        </div>
      </div>
      <div class="floatprev" role="group" aria-label="Preview">
        <div class="preview"><canvas bind:this={preview}></canvas></div>
        <div class="row">
          <button onclick={() => (playing = !playing)} title="Play the animation here, over the canvas">{playing ? "■ Stop" : "▶ Preview"}</button>
          <span class="dim small grow">{anim?.name ?? ""}</span>
        </div>
      </div>
      {#if mapView}
        <div class="minimap" role="img" aria-label="Mini-map: click to move the view" style:width="{mapView.w}px" style:height="{mapView.h}px" onpointerdown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); mapClick(e); }} onpointermove={(e) => { if (e.buttons) mapClick(e); }}>
          <canvas use:drawThumb={frame}></canvas>
          <i style:left="{mapView.box.x * mapView.k}px" style:top="{mapView.box.y * mapView.k}px" style:width="{mapView.box.w * mapView.k}px" style:height="{mapView.box.h * mapView.k}px"></i>
        </div>
      {/if}
      </div>

      <div class="timeline">
        <div class="scrub" role="slider" tabindex="-1" aria-label="Scrub through the frames" aria-valuemin={1} aria-valuemax={animFrames.length} aria-valuenow={Math.max(0, animFrames.indexOf(frame)) + 1} title="Drag along here to scrub through the frames" onpointerdown={scrubDown} onpointermove={scrubMove}><i style:left="{animFrames.length ? ((Math.max(0, animFrames.indexOf(frame)) + 0.5) / animFrames.length) * 100 : 0}%"></i></div>
        <div class="frames" role="listbox" aria-label="Frames">
          {#if anim}<span class="animlabel" title="The animation these frames belong to">{anim.name || "(unnamed)"}</span>{/if}
          {#each animFrames as i (i)}
            <button class="frame" class:on={i === frame} role="option" aria-selected={i === frame} draggable="true" ondragstart={(e) => { dragFrame = i; e.dataTransfer?.setData("text/plain", String(i)); }} ondragover={(e) => e.preventDefault()} ondrop={(e) => { e.preventDefault(); dropFrame(i, e.altKey, e.shiftKey); }} onclick={(e) => pickFrame(i, e)} class:picked={others.includes(i)} title="Frame {i - (anim?.from ?? 0) + 1} · {doc.durations[i]} ms · drag to move · hold Alt to move just this layer's cel (Alt and Shift: copy it) · ⌘ or ⇧ picks more">
              <canvas use:drawThumb={i}></canvas>
              <span>{i - (anim?.from ?? 0) + 1}</span>
              {#if (doc.layers[activeLayer]?.links?.[i] ?? 0) > 0}<i class="chain" title="Linked with other frames on this layer">⛓</i>{/if}
            </button>
          {/each}
        </div>
        <div class="frame-actions">
          <button onclick={addBlank} title="New blank frame after this one">＋ Frame</button>
          <label class="inline" title="Add this many blank frames after the current one"><input type="number" min="1" max="64" bind:value={addCount} class="narrow" /> <button onclick={addMany}>＋ frames</button></label>
          <label class="inline" title="How fast this animation plays, in frames a second (sets every frame of it to the same time)">Speed <input type="number" min="0.5" max="100" step="1" value={fps} class="narrow" onchange={(e) => setFps(Number(e.currentTarget.value))} /> fps</label>
          <button onclick={duplicate}>Duplicate{chosen.length > 1 ? ` ${chosen.length}` : ""}</button>
          <button onclick={() => shift(-1)} disabled={!anim || frame === anim.from} aria-label="Move frame left">◀</button>
          <button onclick={() => shift(1)} disabled={!anim || frame === anim.to} aria-label="Move frame right">▶</button>
          <button class="danger" onclick={remove} disabled={!anim || framesIn(anim) <= 1} title="Delete the picked frames (an animation keeps at least one)">Delete{chosen.length > 1 ? ` ${chosen.length}` : ""}</button>
          {#if doc.tags.length > 1}
            <select aria-label="Move the picked frames to another animation" value="" onchange={(e) => { moveChosen(Number(e.currentTarget.value)); e.currentTarget.value = ""; }}>
              <option value="" disabled>Move to…</option>
              {#each doc.tags as t, ti (ti)}{#if ti !== animIndex}<option value={ti}>{t.name || "(unnamed)"}</option>{/if}{/each}
            </select>
          {/if}
          <label class="inline">Duration <input type="number" min="10" step="10" value={doc.durations[frame]} onchange={(e) => setDuration(Number(e.currentTarget.value))} class="narrow" /> ms</label>
          <button class="ghost" onclick={() => structural(linkCels(doc, activeLayer, chosen))} disabled={chosen.length < 2} title="Link the picked frames on this layer: drawing on one draws on all">Link</button>
          <button class="ghost" onclick={() => structural(unlinkCels(doc, activeLayer, chosen))} disabled={!chosen.some((f) => (doc.layers[activeLayer]?.links?.[f] ?? 0) > 0)} title="Let the picked frames be drawn on separately again">Unlink</button>
          <button class="ghost" onclick={() => rescale(0.5)} title="Half as long: the picked frames play twice as fast">×½</button>
          <button class="ghost" onclick={() => rescale(2)} title="Twice as long: the picked frames play half as fast">×2</button>
          <button class="ghost" onclick={() => structural(setAnimationDuration(doc, animIndex, doc.durations[frame]!))} title="Give every frame of this animation this duration">Apply to animation</button>
        </div>
      </div>
    </section>

    <aside class="side" use:resizable={{ key: "sprite.side", edge: "left", size: 220, min: 170, max: 560 }}>
      <h3>Colour</h3>
      <div class="current">
        <input type="color" value={hex(color)} oninput={(e) => pickHex(e.currentTarget.value)} aria-label="Current colour" />
        <input value={hex(color)} onchange={(e) => pickHex(e.currentTarget.value)} class="mono hexbox" aria-label="Hex colour" />
      </div>
      <div class="palette">
        {#each palette.colors as p (p)}
          <button class="swatch" class:on={same(color, p)} class:marked={palette.colors.indexOf(p) === selSwatch} style:background={p} title="{p}{userPalette ? ' (right-click to take out)' : ''} · Shift-click to pick it for moving" aria-label={p} onclick={(e) => (e.shiftKey ? (selSwatch = palette.colors.indexOf(p)) : pickHex(p))} oncontextmenu={(e) => { e.preventDefault(); if (userPalette) takeOut(p); }}></button>
        {/each}
      </div>
      <div class="row wrap palbar">
        <select value={palettes.current} onchange={(e) => { palettes.select(e.currentTarget.value); palRev++; }} aria-label="Palette">
          {#each palettes.all() as p (p.name)}<option value={p.name}>{p.name}</option>{/each}
        </select>
        <button title="Add the current colour to this palette (a copy is made if it is a built-in one)" onclick={addToPalette}>＋</button>
        <button title="A new palette from the colours this picture uses" onclick={paletteFromPicture}>From picture</button>
        <button title="Keep your palettes in the project (palettes.json) so Model uses them too" onclick={palettesToProject}>To project</button>
        <button title="Bring the project's palettes into your list" onclick={palettesFromProject}>From project</button>
        <button title="Read a palette file (.gpl, .pal, .hex, .json) or the colours of a PNG" onclick={() => paletteFile?.click()}>Import</button>
        <button title="Save this palette as a .gpl file (GIMP, Aseprite, Pixelorama and others read it)" onclick={() => exportPalette("gpl")}>Export .gpl</button>
        <button title="Save the whole sheet as an indexed PNG: every pixel a number into this palette (palette swaps in other tools)" onclick={exportIndexed}>Indexed PNG</button>
        <button title="Save this palette as a .pal file (Paint Shop Pro, Aseprite and others read it)" onclick={() => exportPalette("pal")}>.pal</button>
        {#if userPalette}<button class="danger" title="Delete this palette" onclick={() => { palettes.remove(palettes.current); palRev++; }}>Delete</button>{/if}
        <label class="check" title="Colours you pick snap to the nearest colour of this palette"><input type="checkbox" bind:checked={snapToPalette} /> Stay in palette</label>
        <label class="check" title="Everything you draw takes the nearest colour of this palette"><input type="checkbox" bind:checked={lockPalette} /> Lock to palette</label>
        <input bind:this={paletteFile} type="file" accept=".gpl,.pal,.hex,.json,.txt,.png" hidden onchange={importPalette} />
      </div>
      <div class="row wrap palbar">
        <select aria-label="Sort the palette" value="" onchange={(e) => { if (e.currentTarget.value) sortPalette(e.currentTarget.value as SortBy); e.currentTarget.value = ""; }}>
          <option value="" disabled>Sort by…</option>
          {#each ["hue", "lightness", "saturation", "red", "green", "blue"] as by (by)}<option value={by}>{by}</option>{/each}
        </select>
        <button title="Move the picked swatch (Shift-click one) left" aria-label="Move swatch left" disabled={selSwatch <= 0} onclick={() => moveSwatch(-1)}>◀</button>
        <button title="Move the picked swatch right" aria-label="Move swatch right" disabled={selSwatch < 0 || selSwatch >= palette.colors.length - 1} onclick={() => moveSwatch(1)}>▶</button>
        <label class="inline" title="Colours in a ramp from the current colour to the right button's colour">ramp <input type="number" min="2" max="32" bind:value={rampSteps} class="narrow" /></label>
        <button title="Add a ramp from the current colour to the other colour" onclick={() => addColors(ramp(hex(color), hex(rightColor), rampSteps))}>Add ramp</button>
        <button title="Add two darker and two lighter shades of the current colour, shifted in hue the way pixel artists do" onclick={() => addColors(shadeRamp(hex(color), 2))}>Add shades</button>
      </div>

      <h3>Effects</h3>
      <div class="row wrap fx">
        <button title="Colour the picture by how light each part is: the current colour for dark, the right button's colour for light" onclick={applyGradientMap}>Gradient map</button>
        <button title="Change every colour to the nearest colour of the palette" onclick={applyPalettize}>Palettize</button>
        <label class="inline">block <input type="number" min="2" max="64" bind:value={fxBlock} class="narrow" /></label>
        <button title="Make it blocky: every block takes its average colour" onclick={applyPixelate}>Pixelate</button>
      </div>
      <div class="row wrap fx">
        <button title="Every pixel of the left colour becomes the right button's colour (inside the selection if there is one)" onclick={applyReplace}>Replace colour</button>
        <label class="inline" title="Pixels to slide across">X <input type="number" bind:value={offsetX} class="narrow" aria-label="Slide across" /></label>
        <label class="inline" title="Pixels to slide down">Y <input type="number" bind:value={offsetY} class="narrow" aria-label="Slide down" /></label>
        <button title="Slide the picture; what leaves one side comes in at the other" onclick={applyOffset}>Offset</button>
      </div>
      <label class="slider"><span>Brightness</span><input type="range" min="-0.5" max="0.5" step="0.01" bind:value={fxBright} /><output>{fxBright.toFixed(2)}</output></label>
      <label class="slider"><span>Contrast</span><input type="range" min="-0.9" max="0.9" step="0.01" bind:value={fxContrast} /><output>{fxContrast.toFixed(2)}</output></label>
      <label class="slider"><span>Gamma</span><input type="range" min="0.3" max="3" step="0.05" bind:value={fxGamma} /><output>{fxGamma.toFixed(2)}</output></label>
      <div class="row"><button onclick={applyCurves}>Apply brightness, contrast and gamma</button></div>

      <h3>Reference</h3>
      <div class="row wrap">
        <select aria-label="Reference picture" value={refPath} onchange={(e) => void loadReference(e.currentTarget.value)}>
          <option value="">None</option>
          {#each referenceCandidates as f (f)}<option value={f}>{f}</option>{/each}
        </select>
      </div>
      {#if refPicture}
        <label class="slider"><span>Opacity</span><input type="range" min="0.05" max="1" step="0.05" bind:value={refOpacity} /><output>{Math.round(refOpacity * 100)}%</output></label>
        <div class="row wrap">
          <label class="check" title="Draw it on top of the sprite instead of behind"><input type="checkbox" bind:checked={refOver} /> On top</label>
          <label class="inline">size <input type="number" min="0.1" max="32" step="0.25" bind:value={refScale} class="narrow" />×</label>
          <label class="inline">x <input type="number" bind:value={refX} class="narrow" /></label>
          <label class="inline">y <input type="number" bind:value={refY} class="narrow" /></label>
        </div>
        <p class="dim small">A reference is for looking at: it is not saved with the sprite.</p>
      {/if}

      <h3>Drawing</h3>
      <div class="row wrap drawing">
        <label class="check" title="Mirror strokes left-right"><input type="checkbox" bind:checked={symX} /> ↔</label>
        <label class="check" title="Mirror strokes up-down"><input type="checkbox" bind:checked={symY} /> ↕</label>
        <label class="check" title={square ? "Mirror strokes across the diagonal" : "Diagonal mirroring needs a square sprite"}><input type="checkbox" bind:checked={symD} disabled={!square} /> ⤡</label>
        <label class="check" title="Tiled: a stroke that runs off the left or right edge comes back in at the other side, and the preview repeats the sprite"><input type="checkbox" bind:checked={tileX} /> tile ↔</label>
        <label class="check" title="Tiled: up and down"><input type="checkbox" bind:checked={tileY} /> tile ↕</label>
        <label title="What the right mouse button does">Right button
          <select value={rightTool} onchange={(e) => (rightTool = e.currentTarget.value as Tool)}>{#each TOOLS.filter((t) => !isSelectTool(t.id)) as t (t.id)}<option value={t.id}>{t.label}</option>{/each}</select>
        </label>
        <input type="color" value={hex(rightColor)} oninput={(e) => { const c = parseHex(e.currentTarget.value); if (c) rightColor = c; }} aria-label="Right button colour" title="The right button's colour" />
        <button title="Swap the two colours (X)" aria-label="Swap the colours" onclick={swapColors}>⇄</button>
      </div>
      {#if recent.length}
        <div class="palette recent">
          {#each recent as p (p)}
            <button class="swatch" class:on={same(color, p)} style:background={p} title="Recently used {p}" aria-label="Recent {p}" onclick={() => pickHex(p)}></button>
          {/each}
        </div>
      {/if}

      <h3>Layers</h3>
      <div class="layers" role="listbox" aria-label="Layers">
        {#each layerRows as { l, i } (i)}
          <div class="layer" class:on={i === activeLayer} role="option" aria-selected={i === activeLayer} style:padding-left="{(l.depth ?? 0) * 14}px">
            <button class="ghost eye" class:dimmed={!l.locked} title={l.locked ? "Locked: click to unlock" : "Click to lock (the tools leave it alone)"} aria-label={l.locked ? `Unlock ${l.name}` : `Lock ${l.name}`} aria-pressed={!!l.locked} onclick={() => setLayer(i, { locked: !l.locked })}>{l.locked ? "🔒" : "🔓"}</button>
            <button class="ghost eye" class:dimmed={!l.clip} disabled={i === 0} title={l.clip ? "Clipped to the layer below: click to stop" : "Clip to the layer below: it shows only where that layer has something"} aria-label={l.clip ? `Stop clipping ${l.name}` : `Clip ${l.name} to the layer below`} aria-pressed={!!l.clip} onclick={() => setLayer(i, { clip: !l.clip })}>⤵</button>
            <button class="ghost eye" title={l.visible ? "Hide" : "Show"} aria-label={l.visible ? `Hide ${l.name}` : `Show ${l.name}`} onclick={() => setLayer(i, { visible: !l.visible })}>{l.visible ? "👁" : "·"}</button>
            <button class="lname" onclick={() => (activeLayer = i)} ondblclick={() => (renaming = i)}>
              {#if renaming === i}
                <input value={l.name} aria-label="Layer name" use:focusNow onblur={(e) => { renaming = -1; setLayer(i, { name: e.currentTarget.value }); }} onkeydown={(e) => { if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur(); }} onclick={(e) => e.stopPropagation()} />
              {:else}{#if l.kind === "group"}▾ {/if}{l.name}{#if l.effects?.length} <span class="dim" title="Has effects">fx</span>{/if}{/if}
            </button>
          </div>
        {/each}
      </div>
      <label class="slider"><span>Blend</span><select value={doc.layers[activeLayer]?.blend ?? "normal"} onchange={(e) => setLayer(activeLayer, { blend: e.currentTarget.value as BlendMode })} title="How this layer mixes with the ones under it">{#each BLEND_MODES as m (m)}<option value={m}>{m}</option>{/each}</select></label>
      <label class="slider"><span>Opacity</span><input type="range" min="0" max="1" step="0.05" value={doc.layers[activeLayer]?.opacity ?? 1} oninput={(e) => setLayer(activeLayer, { opacity: Number(e.currentTarget.value) })} /><output>{Math.round((doc.layers[activeLayer]?.opacity ?? 1) * 100)}%</output></label>
      {#if doc.layers[activeLayer] && doc.layers[activeLayer]!.kind !== "group"}
        <label class="slider" title="How much of this layer shows in this frame only, on top of the layer's opacity: fade something in or out over a few frames"><span>This frame</span><input type="range" min="0" max="1" step="0.05" value={doc.layers[activeLayer]!.cels[frame]?.celOpacity ?? 1} oninput={(e) => structural(setCelOpacity(doc, activeLayer, frame, Number(e.currentTarget.value)))} aria-label="Opacity of this frame's cel" /><output>{Math.round((doc.layers[activeLayer]!.cels[frame]?.celOpacity ?? 1) * 100)}%</output></label>
      {/if}
      {#if doc.layers[activeLayer] && doc.layers[activeLayer]!.kind !== "group"}
        <div class="row wrap" title="Move or copy this layer's picture in this frame to another frame (the other layers stay)">
          <span class="dim small">Cel to frame</span>
          <input type="number" class="narrow" min="1" max={doc.frames.length} bind:value={celTarget} aria-label="Frame number to move the cel to" />
          <button onclick={() => structural(moveCel(doc, activeLayer, frame, Math.max(0, Math.min(doc.frames.length - 1, celTarget - 1))))}>Move</button>
          <button onclick={() => structural(moveCel(doc, activeLayer, frame, Math.max(0, Math.min(doc.frames.length - 1, celTarget - 1)), true))}>Copy</button>
          <button onclick={() => structural(rippleCels(doc, activeLayer, frame, 1))} title="Ripple: open an empty cel here on this layer and push the later cels along">Gap +</button>
          <button onclick={() => structural(rippleCels(doc, activeLayer, frame, -1))} title="Ripple: delete this layer's cel here and pull the later cels back">Close −</button>
        </div>
      {/if}
      <div class="row wrap">
        <button onclick={newLayer} disabled={doc.layers.length >= MAX_LAYERS} title="New layer above">＋</button>
        <button onclick={newTextLayer} disabled={doc.layers.length >= MAX_LAYERS} title="A text layer above: words you can change later">＋ Text</button>
        <button onclick={copyLayer} disabled={doc.layers.length >= MAX_LAYERS} title="Duplicate layer">⧉</button>
        <button onclick={() => shiftLayer(1)} disabled={activeLayer >= doc.layers.length - 1} title="Move up" aria-label="Move layer up">↑</button>
        <button onclick={() => shiftLayer(-1)} disabled={activeLayer <= 0} title="Move down" aria-label="Move layer down">↓</button>
        <button onclick={mergeLayer} disabled={activeLayer <= 0} title="Merge into the layer below">⤓</button>
        {#if doc.layers[activeLayer]?.kind === "group"}
          <button onclick={ungroupThis} title="Take the group apart (its layers stay)">Ungroup</button>
        {:else}
          <button onclick={groupThis} disabled={doc.layers.length >= MAX_LAYERS} title="Put this layer in a new group (then more layers can be added to it with ＋ while one of its layers is chosen)">Group</button>
        {/if}
        <button class="danger" onclick={dropLayer} disabled={doc.layers.length <= 1} title="Delete layer" aria-label="Delete layer">✕</button>
      </div>
      {#if activeText}
        <div class="textlayer" role="group" aria-label="Text layer">
          <label class="wide">Words <textarea rows="2" value={activeText.value} aria-label="Words of the text layer" onchange={(e) => setText({ value: e.currentTarget.value })}></textarea></label>
          <div class="row wrap">
            <label class="inline">x <input type="number" class="narrow" value={activeText.x} onchange={(e) => setText({ x: Number(e.currentTarget.value) })} /></label>
            <label class="inline">y <input type="number" class="narrow" value={activeText.y} onchange={(e) => setText({ y: Number(e.currentTarget.value) })} /></label>
            <label class="inline">size <input type="number" class="narrow" min="1" max="16" value={activeText.scale} onchange={(e) => setText({ scale: Number(e.currentTarget.value) })} /></label>
            <input type="color" value={activeText.color} aria-label="Text colour" onchange={(e) => setText({ color: e.currentTarget.value })} />
            <button onclick={() => structural(rasterizeText(doc, activeLayer))} title="Turn the words into plain pixels you can draw on (they can no longer be edited as text)">Rasterize</button>
          </div>
        </div>
      {/if}
      <h4 class="fxhead">Effects on this layer <span class="dim small">(the drawing is not changed)</span></h4>
      {#each activeFx ?? [] as e, k (k)}
        <div class="fxrow">
          <button class="ghost" aria-pressed={e.on !== false} title={e.on === false ? "Off: click to turn on" : "On: click to turn off"} onclick={() => setFx(toggleLayerEffect(activeFx, k))}>{e.on === false ? "○" : "●"}</button>
          <strong>{LAYER_FX[e.type].title}</strong>
          {#each LAYER_FX[e.type].params as pr (pr.key)}
            {#if pr.kind === "color"}
              <input type="color" aria-label={pr.label} value={String(e.params[pr.key] ?? pr.default)} onchange={(ev) => setFx(setLayerEffectParam(activeFx, k, pr.key, ev.currentTarget.value))} />
            {:else}
              <label class="inline">{pr.label} <input type="number" class="narrow" min={pr.min} max={pr.max} step={pr.step} value={e.params[pr.key] ?? pr.default} onchange={(ev) => setFx(setLayerEffectParam(activeFx, k, pr.key, Number(ev.currentTarget.value)))} /></label>
            {/if}
          {/each}
          <button class="ghost" aria-label="Move effect up" onclick={() => setFx(moveLayerEffect(activeFx, k, -1))} disabled={k === 0}>↑</button>
          <button class="ghost" aria-label="Move effect down" onclick={() => setFx(moveLayerEffect(activeFx, k, 1))} disabled={k >= (activeFx?.length ?? 0) - 1}>↓</button>
          <button class="ghost" aria-label="Remove effect" onclick={() => setFx(removeLayerEffect(activeFx, k))}>✕</button>
        </div>
      {/each}
      <select aria-label="Add an effect to this layer" value="" disabled={(activeFx?.length ?? 0) >= MAX_LAYER_FX} onchange={(ev) => { setFx(addLayerEffect(activeFx, ev.currentTarget.value as LayerFxType)); ev.currentTarget.value = ""; }}>
        <option value="" disabled>＋ Add an effect…</option>{#each LAYER_FX_TYPES as t (t)}<option value={t}>{LAYER_FX[t].title}</option>{/each}
      </select>
      {#if !isSheet && doc.layers.length > 1}<p class="warn small">This plain image is saved flat. Open a .sprite.json to keep layers.</p>{/if}

      <h3>Hitbox, pivot, events</h3>
      <p class="dim small">For this frame, in pixels from its top left. The game reads them with <code>self:frame_hitbox()</code>, <code>self:frame_pivot()</code> and <code>on_animation_event</code>.</p>
      {#if true}
        {@const eff = effectiveData(doc, frame)}
        {@const own = frameDataOf(doc, frame)}
        <div class="row wrap fd">
          <span class="dim small" title={own.hitbox ? "This frame's own hitbox" : eff.hitbox ? "The sprite's default" : "None"}>Hitbox</span>
          {#each ["x", "y", "w", "h"] as k (k)}
            <input type="number" class="narrow" aria-label="hitbox {k}" value={eff.hitbox?.[k as "x"] ?? ""} placeholder={k} onchange={(e) => { const b = withKey({ x: 0, y: 0, w: doc.fw, h: doc.fh, ...(eff.hitbox ?? {}) }, k, Number(e.currentTarget.value)); structural(setFrameData(doc, frame, { hitbox: b })); }} />
          {/each}
          <button class="ghost" disabled={!own.hitbox} title="Back to the sprite's default" onclick={() => structural(setFrameData(doc, frame, { hitbox: null }))}>✕</button>
        </div>
        <div class="row wrap fd">
          <span class="dim small" title={own.pivot ? "This frame's own pivot" : eff.pivot ? "The sprite's default" : "None"}>Pivot</span>
          {#each ["x", "y"] as k (k)}
            <input type="number" class="narrow" aria-label="pivot {k}" value={eff.pivot?.[k as "x"] ?? ""} placeholder={k} onchange={(e) => { const p = withKey({ x: Math.floor(doc.fw / 2), y: doc.fh, ...(eff.pivot ?? {}) }, k, Number(e.currentTarget.value)); structural(setFrameData(doc, frame, { pivot: p })); }} />
          {/each}
          <button class="ghost" disabled={!own.pivot} title="Back to the sprite's default" onclick={() => structural(setFrameData(doc, frame, { pivot: null }))}>✕</button>
        </div>
        <label class="slider"><span>Events</span><input aria-label="Events of this frame" placeholder="step, dust" value={(own.events ?? []).join(", ")} onchange={(e) => structural(setFrameData(doc, frame, { events: e.currentTarget.value.split(",") }))} /></label>
        <div class="row wrap">
          <button title="Give every frame of this animation this frame's hitbox and pivot" onclick={() => structural(copyFrameDataTo(doc, frame, animIndex, ["hitbox", "pivot"]))}>Same for the animation</button>
          <button title="Make this frame's hitbox and pivot the defaults for every frame that has none of its own" disabled={!eff.hitbox && !eff.pivot} onclick={() => structural(setDefaults(doc, { hitbox: eff.hitbox ?? null, pivot: eff.pivot ?? null }))}>Make default</button>
        </div>
      {/if}
      <h3>Nine-slice</h3>
      <p class="dim small">Border sizes for stretching this picture as a panel: <code>nova.ui.panel("{fromPath.slice(fromPath.lastIndexOf("/") + 1).replace(/\.(sprite\.json|png)$/i, "")}", x, y, w, h)</code> then uses them.</p>
      <div class="row wrap fd">
        {#each [["left", "L"], ["right", "R"], ["top", "T"], ["bottom", "B"]] as [k, l] (k)}
          <label class="inline" title={k}>{l} <input type="number" min="0" class="narrow" value={doc.nineSlice?.[k as "left"] ?? 0} onchange={(e) => structural(setNineSlice(doc, withKey({ left: 0, right: 0, top: 0, bottom: 0, ...(doc.nineSlice ?? {}) }, k!, Number(e.currentTarget.value))))} /></label>
        {/each}
      </div>

      {#if isSheet}
        <h3>Animations</h3>
        <div class="anims" role="listbox" aria-label="Animations">
          {#each doc.tags as t, i (i)}
            <div class="anim" class:on={i === animIndex} role="option" aria-selected={i === animIndex}>
              <button class="pick" onclick={() => (frame = t.from)} title="Edit {t.name || 'this animation'}">
                <canvas use:drawThumb={t.from}></canvas>
                <span class="aname">{t.name || "(unnamed)"}</span>
                <span class="dim small">{framesIn(t)}</span>
              </button>
              {#if i === animIndex}
                <div class="detail">
                  <input value={t.name} placeholder="name" aria-label="Animation name" onchange={(e) => structural(updateAnimation(doc, i, { name: e.currentTarget.value.trim() }))} />
                  <div class="pair">
                    <select value={t.direction} aria-label="Direction" onchange={(e) => structural(updateAnimation(doc, i, { direction: e.currentTarget.value as Direction }))}>
                      <option value="forward">forward</option><option value="reverse">reverse</option><option value="pingpong">ping-pong</option>
                    </select>
                    <label class="check"><input type="checkbox" checked={t.loop} onchange={(e) => structural(updateAnimation(doc, i, { loop: e.currentTarget.checked }))} /> Loop</label>
                  </div>
                  <label class="speed">Every frame <input type="number" min="10" step="10" value={doc.durations[t.from]} aria-label="Milliseconds per frame" onchange={(e) => structural(setAnimationDuration(doc, i, Number(e.currentTarget.value)))} /> ms</label>
                  <div class="row wrap">
                    <button onclick={() => shiftAnimation(-1)} disabled={i === 0} title="Move up" aria-label="Move animation up">↑</button>
                    <button onclick={() => shiftAnimation(1)} disabled={i === doc.tags.length - 1} title="Move down" aria-label="Move animation down">↓</button>
                    <button onclick={copyAnimation} title="Duplicate this animation with its frames" aria-label="Duplicate animation">⧉</button>
                    <button class="danger" onclick={dropAnimation} disabled={doc.tags.length <= 1} title="Delete this animation and its frames" aria-label="Delete animation">✕</button>
                  </div>
                </div>
              {/if}
            </div>
          {/each}
        </div>
        {#each problems as p (p)}<p class="warn small">{p}</p>{/each}
        <div class="row wrap">
          <button onclick={newAnimation}>＋ New</button>
          <button onclick={openImport} title="Cut a picture of tiles into frames">Import sheet…</button>
        </div>
        <p class="dim small">Each animation has its own frames. In Lua: <code>self:play("name")</code></p>
      {:else}
        <p class="dim small">This is a plain image. Open or create a <code>.sprite.json</code> to get frames and animations.</p>
      {/if}
    </aside>

    {#if importing}
      <div class="backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) importing = false; }}>
        <form class="modal" aria-label="Import a sheet" onsubmit={(e) => { e.preventDefault(); doImport(); }}>
          <h2>Import a sheet</h2>
          {#if !sheetCandidates.length}
            <p class="dim">There are no other pictures in this project yet. Put a PNG of tiles in the project folder (for example <code>sprites/</code>) and come back.</p>
          {:else}
            <label>Picture
              <select value={importPath} onchange={(e) => void loadImport(e.currentTarget.value)}>
                {#each sheetCandidates as c (c)}<option value={c}>{c}</option>{/each}
              </select>
            </label>
            {#if importError}<p class="warn small">{importError}</p>{/if}
            {#if importImage}
              <div class="sheetview"><canvas bind:this={importCanvas} aria-label="The sheet cut into tiles"></canvas></div>
              <div class="modes row">
                <label class="check"><input type="radio" bind:group={cutBy} value="size" /> By tile size</label>
                <label class="check"><input type="radio" bind:group={cutBy} value="count" /> By tile count</label>
                <button type="button" class="ghost" onclick={smartSlice} title="Looks for empty gaps between the tiles">Smart slice</button>
              </div>
              <div class="grid4">
                {#if cutBy === "size"}
                  <label>Tile width <input type="number" min="1" max="1024" bind:value={gridW} /></label>
                  <label>Tile height <input type="number" min="1" max="1024" bind:value={gridH} /></label>
                {:else}
                  <label>Across <input type="number" min="1" max="256" bind:value={gridCols} /></label>
                  <label>Down <input type="number" min="1" max="256" bind:value={gridRows} /></label>
                {/if}
                <label>Gap <input type="number" min="0" max="64" bind:value={gridGap} title="Space between tiles" /></label>
                <label>Border <input type="number" min="0" max="64" bind:value={gridMargin} title="Space around the whole sheet" /></label>
              </div>
              <p class="dim small">{importImage.w}×{importImage.h} px · {grid?.columns ?? 0} × {grid?.rows ?? 0} tiles of {spec.tw}×{spec.th}</p>
              <div class="modes">
                <label class="check"><input type="radio" bind:group={importMode} value="one" /> One animation with every tile</label>
                <label class="check"><input type="radio" bind:group={importMode} value="rows" /> One animation per row</label>
              </div>
              <div class="grid2">
                <label>Name <input bind:value={importName} /></label>
                <label>Every frame <input type="number" min="10" step="10" bind:value={importMs} /> ms</label>
              </div>
              <label class="check"><input type="checkbox" bind:checked={skipEmpty} /> Leave out empty tiles</label>
              <label class="check"><input type="checkbox" bind:checked={appendHere} disabled={importMode === "rows"} /> Add the frames to “{anim?.name}” instead of making a new animation</label>
              {#if isPristineNow}<p class="dim small">This sprite is still empty, so it takes the tile size ({spec.tw}×{spec.th}).</p>{:else if importImage && (spec.tw !== doc.fw || spec.th !== doc.fh)}<p class="dim small">Tiles are {spec.tw}×{spec.th} and this sprite is {doc.fw}×{doc.fh}: each tile is placed at the bottom centre of the frame.</p>{/if}
            {/if}
          {/if}
          <div class="row end">
            <button type="button" class="ghost" onclick={() => (importing = false)}>Cancel</button>
            <button class="primary" disabled={!importCount}>Import {importCount ? `${importCount} frame${importCount === 1 ? "" : "s"}` : ""}</button>
          </div>
        </form>
      </div>
    {/if}
  </div>
{/if}

<style>
  .textlayer { display: flex; flex-direction: column; gap: 4px; padding: 6px; margin: 4px 0; border: 1px solid var(--line); border-radius: 6px; background: var(--panel-2); }
  .textlayer textarea { width: 100%; resize: vertical; }
  .toolselect { font-weight: 600; }
  .scrub { position: relative; height: 10px; margin-bottom: 2px; background: color-mix(in srgb, var(--line) 60%, transparent); border-radius: 4px; cursor: ew-resize; touch-action: none; }
  .scrub i { position: absolute; top: 0; bottom: 0; width: 3px; margin-left: -1px; background: var(--accent); border-radius: 2px; pointer-events: none; }
  .studio { height: 100%; display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; min-height: 0; }
  .tools { background: var(--panel); border-right: 1px solid var(--line); display: flex; flex-direction: column; gap: 4px; padding: 6px; align-items: center; }
  .tools button { width: 30px; height: 30px; padding: 0; font-size: 15px; }
  .tools button.on { background: var(--accent-2); border-color: var(--accent-2); color: #fff; }
  .tools hr { width: 100%; border: none; border-top: 1px solid var(--line); margin: 2px 0; }
  .work { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .options { display: flex; align-items: center; gap: 10px; padding: 4px 10px; background: var(--panel); border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .options label { display: flex; align-items: center; gap: 4px; }
  .viewopts { position: relative; }
  .viewopts summary { cursor: pointer; user-select: none; padding: 2px 6px; border: 1px solid var(--line); border-radius: 4px; }
  .viewpop { position: absolute; z-index: 20; top: 100%; left: 0; margin-top: 4px; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 8px 10px; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; box-shadow: 0 4px 14px rgba(0,0,0,.35); white-space: nowrap; }
  .check input { margin: 0; }
  .spacer { flex: 1; }
  .narrow { width: 64px; padding: 2px 6px; }
  .scrollwrap { flex: 1; min-height: 0; position: relative; display: flex; flex-direction: column; }
  .minimap { position: absolute; right: 18px; bottom: 18px; border: 1px solid var(--line); background: var(--panel); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4); cursor: crosshair; touch-action: none; }
  .minimap canvas { width: 100%; height: 100%; display: block; image-rendering: pixelated; }
  .minimap i { position: absolute; border: 1px solid #ffd166; background: rgba(255, 209, 102, 0.15); pointer-events: none; }
  .scroller { flex: 1; min-height: 0; overflow: auto; display: grid; padding: 16px; background: var(--bg); }
  .stage { margin: auto; position: relative; }
  .tilebg { position: absolute; background-repeat: repeat; opacity: .35; image-rendering: pixelated; pointer-events: none; }
  .stage canvas { position: relative; }
  .stage.ruled { padding: 18px 0 0 18px; }
  .ruler { position: absolute; font-size: 9px; color: var(--dim); pointer-events: none; }
  .ruler.top { top: 0; left: 18px; height: 16px; border-bottom: 1px solid var(--line); }
  .ruler.left { left: 0; top: 18px; width: 16px; border-right: 1px solid var(--line); }
  .ruler span { position: absolute; padding-left: 2px; border-left: 1px solid var(--line); line-height: 14px; }
  .ruler.left span { padding: 0; border-left: none; border-top: 1px solid var(--line); writing-mode: vertical-rl; }
  .ruler i { position: absolute; background: #ffd166; }
  .ruler.top i { top: 0; width: 1px; height: 100%; }
  .ruler.left i { left: 0; height: 1px; width: 100%; }
  .scroller canvas.hand { cursor: grab; }
  .scroller canvas.zooming { cursor: zoom-in; }
  .scroller canvas { display: block; image-rendering: pixelated; cursor: crosshair; box-shadow: 0 0 0 1px var(--line); touch-action: none; }
  .timeline { background: var(--panel); border-top: 1px solid var(--line); padding: 6px 8px; display: flex; flex-direction: column; gap: 6px; }
  .frames { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; }
  .frame { position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 3px; min-width: 52px; background: var(--bg); }
  .frame.on { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .frame .chain { position: absolute; top: 1px; right: 3px; font-size: 10px; color: var(--accent); font-style: normal; }
  .frame.picked { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 18%, var(--bg)); }
  .frame canvas { width: 40px; height: 40px; object-fit: contain; image-rendering: pixelated; background: repeating-conic-gradient(#3a3d48 0 25%, #2e313b 0 50%) 0 0 / 8px 8px; }
  .frame span { font-size: 10px; color: var(--dim); }
  .frame-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .inline { display: flex; align-items: center; gap: 4px; margin-left: auto; }
  .side { background: var(--panel); border-left: 1px solid var(--line); overflow: auto; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
  h3 { margin: 6px 0 2px; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--dim); }
  .current { display: flex; gap: 6px; }
  .current input[type="color"] { width: 40px; height: 30px; padding: 0; }
  .hexbox { flex: 1; min-width: 0; }
  .drawing { align-items: center; gap: 6px; } .drawing select { max-width: 120px; }
  .palbar { margin: 4px 0; align-items: center; } .palbar select { flex: 1; min-width: 0; }
  .palette { display: grid; grid-template-columns: repeat(8, 1fr); gap: 3px; }
  .swatch { aspect-ratio: 1; padding: 0; border-radius: 3px; }
  .swatch.on { outline: 2px solid var(--accent); outline-offset: 1px; }
  .dimmed { opacity: 0.4; }
  .swatch.marked { box-shadow: 0 0 0 2px #ffd166; }
  .preview { display: grid; place-items: center; min-height: 120px; background: repeating-conic-gradient(#3a3d48 0 25%, #2e313b 0 50%) 0 0 / 12px 12px; border: 1px solid var(--line); border-radius: 6px; }
  .floatprev { position: absolute; top: 8px; right: 14px; z-index: 6; display: flex; flex-direction: column; gap: 4px; padding: 6px; background: color-mix(in srgb, var(--panel) 92%, transparent); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35); max-width: 150px; }
  .floatprev .preview { min-height: 64px; }
  .preview canvas { image-rendering: pixelated; }
  .sizing { display: flex; gap: 10px; align-items: end; flex-wrap: wrap; padding: 6px 10px; background: var(--panel-2); border-bottom: 1px solid var(--line); }
  .sizing label { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: var(--dim); }
  .recent { margin-top: -2px; }
  .layers { flex: none; display: flex; flex-direction: column; gap: 2px; max-height: 150px; overflow: auto; border: 1px solid var(--line); border-radius: 6px; padding: 2px; }
  .fxhead { margin: 6px 0 2px; font-size: 12px; }
  .fxrow { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; font-size: 11px; border: 1px solid var(--line); border-radius: 6px; padding: 2px 4px; margin-bottom: 3px; }
  .layer { display: flex; align-items: center; border-radius: 4px; }
  .layer.on { background: color-mix(in srgb, var(--accent) 22%, transparent); }
  .eye { width: 26px; padding: 0; }
  .lname { flex: 1; text-align: left; background: transparent; border-color: transparent; padding: 2px 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lname input { width: 100%; padding: 0 4px; }
  .wrap { flex-wrap: wrap; } .wrap button { flex: 1 0 28px; padding: 3px; }
  .row { display: flex; gap: 6px; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; align-items: center; }
  .anims { display: flex; flex-direction: column; gap: 4px; }
  .anim { border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
  .anim.on { border-color: var(--accent); }
  .pick { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; background: transparent; border: none; border-radius: 0; padding: 4px 6px; }
  .pick canvas { width: 28px; height: 28px; object-fit: contain; image-rendering: pixelated; flex: none; background: repeating-conic-gradient(#3a3d48 0 25%, #2e313b 0 50%) 0 0 / 8px 8px; }
  .aname { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .detail { display: flex; flex-direction: column; gap: 6px; padding: 6px; border-top: 1px solid var(--line); background: var(--panel-2); }
  .detail label.check { display: flex; flex-direction: row; align-items: center; gap: 4px; }
  .speed { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--dim); } .speed input { width: 64px; padding: 2px 6px; }
  .animlabel { align-self: center; font-size: 11px; color: var(--accent); padding: 0 8px 0 2px; white-space: nowrap; }
  .grow { flex: 1; align-self: center; }
  .backdrop { position: fixed; inset: 0; background: #0009; display: grid; place-items: center; z-index: 50; padding: 16px; }
  .modal { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 16px; display: flex; flex-direction: column; gap: 8px; width: min(520px, 100%); max-height: 100%; overflow: auto; }
  .modal h2 { margin: 0 0 4px; font-size: 15px; }
  .modal label { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: var(--dim); }
  .modal label.check { flex-direction: row; align-items: center; gap: 6px; color: var(--text); font-size: 12px; }
  .modal input[type="number"], .modal input:not([type]) { padding: 3px 6px; min-width: 0; }
  .sheetview { display: grid; place-items: center; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 6px; overflow: auto; max-height: 280px; }
  .sheetview canvas { image-rendering: pixelated; }
  .grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .modes { display: flex; flex-direction: column; gap: 4px; } .modes.row { flex-direction: row; align-items: center; gap: 10px; flex-wrap: wrap; }
  .row.end { justify-content: flex-end; }
  .small { font-size: 11px; margin: 2px 0; }
  .warn { color: var(--warn); }
  .fail { padding: 32px; display: grid; place-items: start; gap: 8px; }
</style>
