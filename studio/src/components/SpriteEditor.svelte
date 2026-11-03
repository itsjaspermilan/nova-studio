<script lang="ts">
  import { onMount, untrack } from "svelte";
  import {
    CLEAR, cloneRaster, crop, drawEllipse, drawLine, drawRect, floodFill, getPixel, inRect, inside, isClear, lift, linePoints, parseHex, pixelPerfect, place, rectBetween, stamp, toHex,
    type Point, type Raster, type Rect, type Rgba,
  } from "../lib/pixels";
  import {
    addAnimation, animationOf, cloneDoc, linkCels, unlinkCels, syncLinked, moveFramesWithin, scaleDurations, duplicateFrames, moveFramesTo, removeFrames, detectGrid, duplicateAnimation, frameAt, gridFromCounts, smartGrid, framesIn, fromImage, fromSheet, gridTiles, importTiles, insertFrame, moveAnimation, isPristine, moveFrame, newDoc, parseSheetJson,
    removeAnimation, removeFrame, setAnimationDuration, tagProblems, tagSequence, resizeDoc, toSheet, toSheetJson, updateAnimation, type Direction, type SpriteDoc,
    addLayer, applyLayers, duplicateLayer, layerSheets, layersFileText, mergeDown, moveLayer, parseLayersFile, recompose, removeLayer, updateLayer, MAX_LAYERS,
  } from "../lib/sprite-doc";
  import { loadRaster, rasterToDataUrl } from "../lib/png";
  import { studio } from "../lib/store.svelte";

  let { path, text }: { path: string; text: string } = $props();

  type Tool = "select" | "pencil" | "eraser" | "fill" | "line" | "rect" | "ellipse" | "picker";
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
    { id: "pencil", label: "Pencil", key: "B", icon: "✎" },
    { id: "eraser", label: "Eraser", key: "E", icon: "⌫" },
    { id: "fill", label: "Fill", key: "G", icon: "▨" },
    { id: "line", label: "Line", key: "L", icon: "╱" },
    { id: "rect", label: "Rectangle", key: "R", icon: "▭" },
    { id: "ellipse", label: "Ellipse", key: "O", icon: "◯" },
    { id: "picker", label: "Colour picker", key: "I", icon: "✚" },
  ];
  // A hand-picked starter palette: greys, then warm to cool, light and dark rows.
  const PALETTE = [
    "#000000", "#2b2b3a", "#555566", "#8a8a99", "#c4c4d0", "#ffffff", "#5b2a1a", "#8b4a2b",
    "#c27a3e", "#f2b66d", "#f7e3a1", "#7a1f2b", "#c1272d", "#ef5b4c", "#f79a8b", "#ffd0c4",
    "#1f3d2b", "#2f7d46", "#6cc24a", "#b8e986", "#16335c", "#2a62c9", "#4fa3ff", "#a5d4ff",
    "#3b1d63", "#7b3fc4", "#b78cf2", "#e0c8ff", "#0f5c5c", "#1fb5ad", "#ff7ab6", "#ffe14d",
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
      if (session!.sheet && (d.layers.length > 1 || d.layers.some((l) => l.links?.some((n) => n > 0)) || studio.files.some((f) => f.path === layersPath))) {
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

  function paint() {
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas || !ready) return;
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
    if (showGrid && zoom >= 8) {
      ctx.strokeStyle = "rgba(255,255,255,.12)";
      ctx.beginPath();
      for (let x = 1; x < doc.fw; x++) { ctx.moveTo(x * zoom + 0.5, 0); ctx.lineTo(x * zoom + 0.5, h); }
      for (let y = 1; y < doc.fh; y++) { ctx.moveTo(0, y * zoom + 0.5); ctx.lineTo(w, y * zoom + 0.5); }
      ctx.stroke();
    }
    if (selection && tool === "select") {
      ctx.strokeStyle = "#ffd166";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(selection.x * zoom + 1, selection.y * zoom + 1, selection.w * zoom - 2, selection.h * zoom - 2);
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
    }
    if (symX || symY) {
      ctx.strokeStyle = "rgba(255,120,200,.7)";
      ctx.beginPath();
      if (symX) { ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); }
      if (symY) { ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); }
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
    doc; frame; rev; zoom; onion; onionPast; onionFuture; onionTint; showGrid; ready; hover; size; tool; playing; canvas; selection; symX; symY;
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

  let symX = $state(false);
  let symY = $state(false);
  let perfect = $state(true);
  let selection: Rect | null = $state(null);
  let selecting: Point | null = null;
  let moving: { piece: Raster; rest: Raster; dx: number; dy: number } | null = null;
  let clipboard: Raster | null = null;
  let recent: string[] = $state([]);

  function variants(): [boolean, boolean][] {
    const out: [boolean, boolean][] = [[false, false]];
    if (symX) out.push([true, false]);
    if (symY) out.push([false, true]);
    if (symX && symY) out.push([true, true]);
    return out;
  }
  const flipped = (p: Point, fx: boolean, fy: boolean): Point => ({ x: fx ? doc.fw - 1 - p.x : p.x, y: fy ? doc.fh - 1 - p.y : p.y });

  function cell(e: PointerEvent): Point {
    const r = canvas!.getBoundingClientRect();
    return { x: Math.floor(((e.clientX - r.left) / r.width) * doc.fw), y: Math.floor(((e.clientY - r.top) / r.height) * doc.fh) };
  }

  function down(e: PointerEvent) {
    if (e.button !== 0 || !ready) return;
    const p = cell(e);
    if (tool === "picker") {
      const c = getPixel(doc.frames[frame]!, p.x, p.y);
      if (c && c[3] > 0) color = c;
      return;
    }
    const layer = doc.layers[activeLayer]!;
    if (!layer.visible) {
      studio.say("info", `"${layer.name}" is hidden. Show it (the eye) to draw on it.`);
      return;
    }
    const r = cel();
    canvas!.setPointerCapture(e.pointerId);
    if (tool === "select") {
      if (selection && inRect(selection, p.x, p.y)) {
        before = cloneDoc(doc);
        drawing = true;
        const { piece, rest } = lift(r, selection);
        moving = { piece, rest, dx: p.x - selection.x, dy: p.y - selection.y };
      } else {
        selection = null;
        selecting = p;
      }
      return;
    }
    before = cloneDoc(doc);
    drawing = true;
    start = last = p;
    base = cloneRaster(r);
    strokePoints = [p];
    if (tool === "pencil" || tool === "eraser") drawStroke(r);
    else if (tool === "fill") {
      for (const [fx, fy] of variants()) {
        const q = flipped(p, fx, fy);
        floodFill(r, q.x, q.y, color);
      }
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
    const c = tool === "eraser" ? CLEAR : color;
    const points = tool === "pencil" && perfect && size === 1 ? pixelPerfect(strokePoints) : strokePoints;
    for (const [fx, fy] of variants()) for (const pt of points) {
      const q = flipped(pt, fx, fy);
      stamp(r, q.x, q.y, size, c);
    }
  }

  function shape(r: Raster, p: Point) {
    r.data.set(base!.data);
    for (const [fx, fy] of variants()) {
      const a = flipped(start, fx, fy);
      const b = flipped(p, fx, fy);
      if (tool === "line") drawLine(r, a, b, size, color);
      else if (tool === "rect") drawRect(r, a, b, size, color, filled);
      else if (tool === "ellipse") drawEllipse(r, a, b, size, color, filled);
    }
  }

  function move(e: PointerEvent) {
    const p = cell(e);
    if (!hover || hover.x !== p.x || hover.y !== p.y) hover = p;
    if (selecting) {
      selection = rectBetween(selecting, p, doc.fw, doc.fh);
      return;
    }
    if (!drawing) return;
    const r = cel();
    if (moving && selection) {
      const nx = p.x - moving.dx;
      const ny = p.y - moving.dy;
      r.data.set(place(moving.rest, moving.piece, nx, ny).data);
      selection = { x: nx, y: ny, w: moving.piece.w, h: moving.piece.h };
    } else if (tool === "pencil" || tool === "eraser") {
      strokePoints.push(...linePoints(last, p).slice(1));
      last = p;
      drawStroke(r);
    } else shape(r, p);
    recompose(doc, frame);
    rev++;
  }

  function finish() {
    selecting = null;
    if (!drawing) return;
    drawing = false;
    const r = cel();
    const was = before!.layers[activeLayer]!.cels[frame]!;
    if (r.data.some((v, i) => v !== was.data[i])) {
      session!.past.push(before!);
      if (session!.past.length > MAX_HISTORY) session!.past.shift();
      session!.future = [];
      if (tool !== "select" && tool !== "eraser") rememberColor(color);
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
    if (!selection) return;
    const next = cloneDoc(doc);
    next.layers[activeLayer]!.cels[frame] = lift(next.layers[activeLayer]!.cels[frame]!, selection).rest;
    structural(next);
  }
  function copySelection(cut = false) {
    if (!selection) return;
    clipboard = crop(cel(), selection.x, selection.y, selection.w, selection.h);
    if (cut) clearSelection();
  }
  function paste() {
    if (!clipboard) return;
    const at = selection ? { x: selection.x, y: selection.y } : { x: 0, y: 0 };
    const next = cloneDoc(doc);
    next.layers[activeLayer]!.cels[frame] = place(next.layers[activeLayer]!.cels[frame]!, clipboard, at.x, at.y);
    structural(next);
    tool = "select";
    selection = { x: at.x, y: at.y, w: clipboard.w, h: clipboard.h };
  }

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
    selection = null;
    sizing = false;
    zoom = Math.max(1, Math.min(32, Math.floor(420 / Math.max(doc.fw, doc.fh))));
  }

  function clearFrame() {
    const next = cloneDoc(doc);
    next.layers[activeLayer]!.cels[frame]!.data.fill(0);
    structural(next);
  }
  function flip(horizontal: boolean) {
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
  function dropFrame(onto: number) {
    const from = dragFrame;
    dragFrame = null;
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
  /// Frames picked with Ctrl, ⌘ or Shift besides the current one: copy, delete and move act on all of them.
  let others = $state<number[]>([]);
  const chosen = $derived([...new Set([frame, ...others])].sort((a, b) => a - b));
  // picked frames belong to the animation being worked on; moving to another leaves them behind
  $effect(() => {
    const a = anim;
    const kept = untrack(() => others).filter((f) => !!a && f >= a.from && f <= a.to);
    if (kept.length !== untrack(() => others).length) others = kept;
  });
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
  const mergeLayer = () => layerEdit(mergeDown(doc, activeLayer));
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
    const scale = Math.max(1, Math.floor(112 / Math.max(r.w, r.h)));
    preview.width = r.w * scale;
    preview.height = r.h * scale;
    ctx.imageSmoothingEnabled = false;
    const tmp = document.createElement("canvas");
    tmp.width = r.w;
    tmp.height = r.h;
    tmp.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.w, r.h), 0, 0);
    ctx.drawImage(tmp, 0, 0, preview.width, preview.height);
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
      selection = { x: 0, y: 0, w: doc.fw, h: doc.fh };
    } else if ((e.key === "Delete" || e.key === "Backspace") && selection) {
      e.preventDefault();
      clearSelection();
    } else if (e.key === "Escape" && importing) {
      importing = false;
    } else if (e.key === "Escape" && selection) {
      selection = null;
    } else if (!mod) {
      const hit = TOOLS.find((t) => t.key.toLowerCase() === e.key.toLowerCase());
      if (hit) tool = hit.id;
      else if (e.key === "[") size = Math.max(1, size - 1);
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

  const hex = (c: Rgba) => toHex([c[0], c[1], c[2], 255]);
  const same = (a: Rgba, b: string) => hex(a) === b;
  function pickHex(h: string) {
    const c = parseHex(h);
    if (c) color = c;
  }
</script>

<svelte:window onkeydown={key} />

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
        <label>Size <input type="number" min="1" max="16" bind:value={size} class="narrow" /></label>
        {#if tool === "rect" || tool === "ellipse"}
          <label class="check"><input type="checkbox" bind:checked={filled} /> Filled</label>
        {/if}
        <label class="check" title="Mirror strokes left-right"><input type="checkbox" bind:checked={symX} /> ↔</label>
        <label class="check" title="Mirror strokes up-down"><input type="checkbox" bind:checked={symY} /> ↕</label>
        {#if tool === "pencil"}<label class="check" title="One-pixel lines without double corners"><input type="checkbox" bind:checked={perfect} /> Pixel-perfect</label>{/if}
        <label class="check"><input type="checkbox" bind:checked={onion} /> Onion skin</label>
        {#if onion}
          <label title="Frames before this one shown faintly">before <select bind:value={onionPast}>{#each [0, 1, 2, 3] as n (n)}<option value={n}>{n}</option>{/each}</select></label>
          <label title="Frames after this one shown faintly">after <select bind:value={onionFuture}>{#each [0, 1, 2, 3] as n (n)}<option value={n}>{n}</option>{/each}</select></label>
          <label class="check" title="Blue for before, red for after"><input type="checkbox" bind:checked={onionTint} /> Tint</label>
        {/if}
        <label class="check"><input type="checkbox" bind:checked={showGrid} /> Grid</label>
        <button class="ghost" onclick={openSizing}>Canvas size…</button>
        <span class="spacer"></span>
        <button class="ghost" onclick={() => (zoom = Math.max(1, zoom - 1))} aria-label="Zoom out">−</button>
        <span class="dim">{zoom * 100}%</span>
        <button class="ghost" onclick={() => (zoom = Math.min(48, zoom + 1))} aria-label="Zoom in">＋</button>
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
      <div class="scroller">
        <canvas bind:this={canvas} aria-label="Sprite canvas" onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onpointerleave={leave}></canvas>
      </div>

      <div class="timeline">
        <div class="frames" role="listbox" aria-label="Frames">
          {#if anim}<span class="animlabel" title="The animation these frames belong to">{anim.name || "(unnamed)"}</span>{/if}
          {#each animFrames as i (i)}
            <button class="frame" class:on={i === frame} role="option" aria-selected={i === frame} draggable="true" ondragstart={(e) => { dragFrame = i; e.dataTransfer?.setData("text/plain", String(i)); }} ondragover={(e) => e.preventDefault()} ondrop={(e) => { e.preventDefault(); dropFrame(i); }} onclick={(e) => pickFrame(i, e)} class:picked={others.includes(i)} title="Frame {i - (anim?.from ?? 0) + 1} · {doc.durations[i]} ms · drag to move · ⌘ or ⇧ picks more">
              <canvas use:drawThumb={i}></canvas>
              <span>{i - (anim?.from ?? 0) + 1}</span>
              {#if (doc.layers[activeLayer]?.links?.[i] ?? 0) > 0}<i class="chain" title="Linked with other frames on this layer">⛓</i>{/if}
            </button>
          {/each}
        </div>
        <div class="frame-actions">
          <button onclick={addBlank} title="New blank frame after this one">＋ Frame</button>
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

    <aside class="side">
      <h3>Colour</h3>
      <div class="current">
        <input type="color" value={hex(color)} oninput={(e) => pickHex(e.currentTarget.value)} aria-label="Current colour" />
        <input value={hex(color)} onchange={(e) => pickHex(e.currentTarget.value)} class="mono hexbox" aria-label="Hex colour" />
      </div>
      <div class="palette">
        {#each PALETTE as p (p)}
          <button class="swatch" class:on={same(color, p)} style:background={p} title={p} aria-label={p} onclick={() => pickHex(p)}></button>
        {/each}
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
          <div class="layer" class:on={i === activeLayer} role="option" aria-selected={i === activeLayer}>
            <button class="ghost eye" title={l.visible ? "Hide" : "Show"} aria-label={l.visible ? `Hide ${l.name}` : `Show ${l.name}`} onclick={() => setLayer(i, { visible: !l.visible })}>{l.visible ? "👁" : "·"}</button>
            <button class="lname" onclick={() => (activeLayer = i)} ondblclick={() => (renaming = i)}>
              {#if renaming === i}
                <input value={l.name} aria-label="Layer name" use:focusNow onblur={(e) => { renaming = -1; setLayer(i, { name: e.currentTarget.value }); }} onkeydown={(e) => { if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur(); }} onclick={(e) => e.stopPropagation()} />
              {:else}{l.name}{/if}
            </button>
          </div>
        {/each}
      </div>
      <label class="slider"><span>Opacity</span><input type="range" min="0" max="1" step="0.05" value={doc.layers[activeLayer]?.opacity ?? 1} oninput={(e) => setLayer(activeLayer, { opacity: Number(e.currentTarget.value) })} /><output>{Math.round((doc.layers[activeLayer]?.opacity ?? 1) * 100)}%</output></label>
      <div class="row wrap">
        <button onclick={newLayer} disabled={doc.layers.length >= MAX_LAYERS} title="New layer above">＋</button>
        <button onclick={copyLayer} disabled={doc.layers.length >= MAX_LAYERS} title="Duplicate layer">⧉</button>
        <button onclick={() => shiftLayer(1)} disabled={activeLayer >= doc.layers.length - 1} title="Move up" aria-label="Move layer up">↑</button>
        <button onclick={() => shiftLayer(-1)} disabled={activeLayer <= 0} title="Move down" aria-label="Move layer down">↓</button>
        <button onclick={mergeLayer} disabled={activeLayer <= 0} title="Merge into the layer below">⤓</button>
        <button class="danger" onclick={dropLayer} disabled={doc.layers.length <= 1} title="Delete layer" aria-label="Delete layer">✕</button>
      </div>
      {#if !isSheet && doc.layers.length > 1}<p class="warn small">This plain image is saved flat. Open a .sprite.json to keep layers.</p>{/if}

      <h3>Preview</h3>
      <div class="preview"><canvas bind:this={preview}></canvas></div>
      <div class="row">
        <button onclick={() => (playing = !playing)}>{playing ? "■ Stop" : "▶ Play"}</button>
        <span class="dim small grow">{anim?.name ?? ""}</span>
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
  .studio { height: 100%; display: grid; grid-template-columns: 44px minmax(0, 1fr) 220px; min-height: 0; }
  .tools { background: var(--panel); border-right: 1px solid var(--line); display: flex; flex-direction: column; gap: 4px; padding: 6px; align-items: center; }
  .tools button { width: 30px; height: 30px; padding: 0; font-size: 15px; }
  .tools button.on { background: var(--accent-2); border-color: var(--accent-2); color: #fff; }
  .tools hr { width: 100%; border: none; border-top: 1px solid var(--line); margin: 2px 0; }
  .work { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .options { display: flex; align-items: center; gap: 10px; padding: 4px 10px; background: var(--panel); border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .options label { display: flex; align-items: center; gap: 4px; }
  .check input { margin: 0; }
  .spacer { flex: 1; }
  .narrow { width: 64px; padding: 2px 6px; }
  .scroller { flex: 1; min-height: 0; overflow: auto; display: grid; padding: 16px; background: var(--bg); }
  .scroller canvas { margin: auto; image-rendering: pixelated; cursor: crosshair; box-shadow: 0 0 0 1px var(--line); touch-action: none; }
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
  .palette { display: grid; grid-template-columns: repeat(8, 1fr); gap: 3px; }
  .swatch { aspect-ratio: 1; padding: 0; border-radius: 3px; }
  .swatch.on { outline: 2px solid var(--accent); outline-offset: 1px; }
  .preview { display: grid; place-items: center; min-height: 120px; background: repeating-conic-gradient(#3a3d48 0 25%, #2e313b 0 50%) 0 0 / 12px 12px; border: 1px solid var(--line); border-radius: 6px; }
  .preview canvas { image-rendering: pixelated; }
  .sizing { display: flex; gap: 10px; align-items: end; flex-wrap: wrap; padding: 6px 10px; background: var(--panel-2); border-bottom: 1px solid var(--line); }
  .sizing label { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: var(--dim); }
  .recent { margin-top: -2px; }
  .layers { flex: none; display: flex; flex-direction: column; gap: 2px; max-height: 150px; overflow: auto; border: 1px solid var(--line); border-radius: 6px; padding: 2px; }
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
