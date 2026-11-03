<script lang="ts">
  import { untrack } from "svelte";
  import {
    History, addItem, afterRemoval, boundsOf, drawOrder, duplicateItem, hitTest, itemAt, moveTo, parseScene, removeItem, sameRef,
    serializeScene, setField, setSceneField, snap, uniqueName, worldSize, type Item, type ItemKind, type Ref, type Scene, type Sizes,
    addTilemap, cellAt, fillTiles, mapSize, paintTile, parsePropValue, propsOf, removeTilemap, renameProp, resizeTilemap, setProp, showPropValue,
    tilemapBox, tilemaps, toggleSolid, EMPTY_TILE, type Kinds, cameraOf, moveTo3, setCamera, positionOf, type Camera3,
  } from "../lib/scene-model";
  import Scene3D from "./Scene3D.svelte";
  import { parseModel, type ModelDoc } from "../lib/model-doc";
  import { studio } from "../lib/store.svelte";
  import { resolveEntity } from "../lib/entity-info";
  import { parseSheetJson } from "../lib/sprite-doc";

  let { path, text, onjson }: { path: string; text: string; onjson: () => void } = $props();

  const parsed = untrack(() => parseScene(text));
  let scene: Scene = $state(parsed.ok ? parsed.scene : { version: 1 });
  const error = parsed.ok ? "" : parsed.error;
  const history = new History();
  let historyTick = $state(0); // bumps so the undo/redo buttons re-evaluate
  let selected: Ref | null = $state(null);
  let gridSize = $state(8);
  // tile painting
  let mode: "select" | "tiles" = $state("select");
  let mapIndex = $state(0);
  let tile = $state(0); // the tile to paint; -1 erases
  let tileTool: "paint" | "fill" = $state("paint");
  let newSet = $state("");
  let newTile = $state(16);
  let newCols = $state(30);
  let newRows = $state(17);
  let tileCell: { col: number; row: number } | null = $state(null);
  let showGrid = $state(true);
  // 2D is the flat level; 3D shows the objects whose entity has a model, and the game's camera
  let view: "2d" | "3d" = $state(untrack(() => ((scene.camera || (scene.objects ?? []).some((o) => o.z)) ? "3d" : "2d")));
  let modelDocs = $state(new Map<string, ModelDoc>()); // by entity kind
  let view3: { current: () => Camera3 } | null = null;

  // view: world -> screen is (world - origin) * zoom
  let zoom = $state(1);
  let originX = $state(-40);
  let originY = $state(-40);
  let canvas: HTMLCanvasElement | undefined = $state();
  let box: HTMLDivElement | undefined = $state();
  let width = $state(600);
  let height = $state(400);

  // Pictures the scene mentions, loaded on demand through the backend.
  let sizes = $state(new Map<string, { w: number; h: number }>());
  const pictures = new Map<string, HTMLImageElement>();
  let pictureTick = $state(0);

  const loading = new Map<string, Promise<HTMLImageElement | undefined>>();
  /// Loads a project picture once; resolves when it can be drawn (or undefined if it cannot be read).
  function loadPicture(file: string): Promise<HTMLImageElement | undefined> {
    const known = loading.get(file);
    if (known) return known;
    const img = new Image();
    pictures.set(file, img);
    const promise = new Promise<HTMLImageElement | undefined>((resolve) => {
      if (!studio.api) return resolve(undefined);
      studio.api
        .readImage(file)
        .then((url) => {
          img.onload = () => {
            sizes = new Map(sizes).set(file, { w: img.naturalWidth, h: img.naturalHeight });
            pictureTick++;
            resolve(img);
          };
          img.onerror = () => resolve(undefined);
          img.src = url;
        })
        .catch(() => resolve(undefined));
    });
    loading.set(file, promise);
    return promise;
  }

  // What each entity kind in the scene looks like, learned by reading its Lua file (sprite and pivot).
  let kindSizes = $state(new Map<string, { w: number; h: number; px: number; py: number }>());
  const kindPics = new Map<string, { image: string; sx: number; sy: number; sw: number; sh: number }>();
  const asked = new Set<string>();
  const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
  const joinPath = (folder: string, rel: string) => {
    const out = folder ? folder.split("/") : [];
    for (const part of rel.split("/")) part === ".." ? out.pop() : part !== "." && part !== "" && out.push(part);
    return out.join("/");
  };

  async function learnKind(kind: string) {
    if (asked.has(kind) || !studio.api) return;
    asked.add(kind);
    const api = studio.api;
    const look = await resolveEntity(kind, (p) => api.readFile(p).then((c) => c.text).catch(() => null));
    if (look.model) {
      const file = await api.readFile(`models/${look.model}.model.json`).catch(() => null);
      const doc = file?.text != null ? parseModel(file.text) : null;
      if (doc?.ok) modelDocs = new Map(modelDocs).set(kind, doc.doc);
    }
    if (!look.sprite) return;
    const files = studio.files.filter((f) => !f.dir).map((f) => f.path);
    const name = look.sprite;
    let image = "";
    let frame: { sx: number; sy: number; sw: number; sh: number } | null = null;
    const sheet = files.find((f) => f === name || f.endsWith(`/${name}.sprite.json`) || f === `${name}.sprite.json`);
    if (sheet?.endsWith(".sprite.json")) {
      const parsed = parseSheetJson((await api.readFile(sheet).catch(() => null))?.text ?? "");
      if (parsed.ok && parsed.json.image) {
        image = joinPath(dirOf(sheet), parsed.json.image);
        frame = { sx: 0, sy: 0, sw: parsed.json.frame_width, sh: parsed.json.frame_height };
      }
    }
    if (!image) image = files.find((f) => f === name || f === `sprites/${name}.png`) ?? "";
    if (!image) return;
    const picture = await loadPicture(image);
    if (!picture) return;
    const f = frame ?? { sx: 0, sy: 0, sw: picture.naturalWidth, sh: picture.naturalHeight };
    kindPics.set(kind, { image, ...f });
    kindSizes = new Map(kindSizes).set(kind, { w: f.sw, h: f.sh, px: look.pivot?.[0] ?? 0.5, py: look.pivot?.[1] ?? 0.5 });
  }
  $effect(() => {
    for (const o of scene.objects ?? []) if (typeof o.kind === "string") void learnKind(o.kind);
  });

  $effect(() => {
    for (const item of scene.images ?? []) if (typeof item.image === "string") loadPicture(item.image);
    for (const map of (scene.tilemaps as { tileset?: { image?: string } }[] | undefined) ?? []) if (map.tileset?.image) loadPicture(map.tileset.image);
  });

  function commit(next: Scene, keepHistory = false) {
    if (!keepHistory) history.record($state.snapshot(scene) as Scene);
    scene = next;
    historyTick++;
    studio.edit(path, serializeScene(next));
  }
  const edit = (next: Scene) => commit(next);
  const structuredCloneSafe = (v: Scene): Scene => JSON.parse(JSON.stringify(v));

  function undo() {
    const prev = history.undo($state.snapshot(scene) as Scene);
    if (prev) commit(prev, true);
  }
  function redo() {
    const next = history.redo($state.snapshot(scene) as Scene);
    if (next) commit(next, true);
  }

  const world = $derived(worldSize(scene));
  const item = $derived(selected ? itemAt(scene, selected) : undefined);
  const canUndo = $derived(historyTick >= 0 && history.canUndo);
  const canRedo = $derived(historyTick >= 0 && history.canRedo);
  const toScreen = (x: number, y: number): [number, number] => [(x - originX) * zoom, (y - originY) * zoom];
  const toWorld = (sx: number, sy: number): [number, number] => [sx / zoom + originX, sy / zoom + originY];

  // ---- drawing -------------------------------------------------------------------------------
  const rgb = (c: number[] | undefined, fallback: string) => (c && c.length >= 3 ? `rgb(${c[0]}, ${c[1]}, ${c[2]})` : fallback);

  let hoverCell: { col: number; row: number } | null = $state(null);

  function draw() {
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const style = getComputedStyle(canvas);
    ctx.fillStyle = style.getPropertyValue("--panel-2") || "#222";
    ctx.fillRect(0, 0, width, height);

    const [wx, wy] = toScreen(0, 0);
    ctx.fillStyle = rgb(scene.background, "#5c96d6");
    ctx.fillRect(wx, wy, world.width * zoom, world.height * zoom);

    ctx.save();
    ctx.beginPath();
    ctx.rect(wx, wy, world.width * zoom, world.height * zoom);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;

    // tilemaps sit behind everything (the runtime's default depth puts them with the world)
    for (const map of (scene.tilemaps as { x?: number; y?: number; tileset?: { image?: string; tile_width?: number; tile_height?: number }; tiles?: number[][] }[] | undefined) ?? []) {
      const set = map.tileset;
      const picture = set?.image ? pictures.get(set.image) : undefined;
      const tw = set?.tile_width ?? 16;
      const th = set?.tile_height ?? 16;
      const perRow = picture?.naturalWidth ? Math.floor(picture.naturalWidth / tw) : 0;
      (map.tiles ?? []).forEach((row, r) =>
        row.forEach((n, c) => {
          if (n < 0) return;
          const [sx, sy] = toScreen((map.x ?? 0) + c * tw, (map.y ?? 0) + r * th);
          if (picture?.complete && perRow > 0) ctx.drawImage(picture, (n % perRow) * tw, Math.floor(n / perRow) * th, tw, th, sx, sy, tw * zoom, th * zoom);
          else {
            ctx.fillStyle = "rgba(0,0,0,.25)";
            ctx.fillRect(sx, sy, tw * zoom, th * zoom);
          }
        }),
      );
    }

    for (const ref of drawOrder(scene)) {
      const it = itemAt(scene, ref)!;
      const b = boundsOf(scene, ref, sizes as Sizes, kindSizes as Kinds);
      const [sx, sy] = toScreen(b.x, b.y);
      if (ref.kind === "images") {
        const picture = pictures.get(String(it.image));
        if (picture?.complete && picture.naturalWidth) ctx.drawImage(picture, sx, sy, b.w * zoom, b.h * zoom);
        else {
          ctx.strokeStyle = "#e6b450";
          ctx.strokeRect(sx, sy, b.w * zoom, b.h * zoom);
        }
      } else if (ref.kind === "objects") {
        const pic = kindPics.get(String(it.kind));
        const picture = pic ? pictures.get(pic.image) : undefined;
        if (pic && picture?.complete && picture.naturalWidth) {
          ctx.drawImage(picture, pic.sx, pic.sy, pic.sw, pic.sh, sx, sy, b.w * zoom, b.h * zoom);
          ctx.strokeStyle = "rgba(90,169,255,.55)";
          ctx.setLineDash([3, 3]);
          ctx.strokeRect(sx + 0.5, sy + 0.5, b.w * zoom, b.h * zoom);
          ctx.setLineDash([]);
          ctx.fillStyle = "#fff";
          ctx.font = `${Math.max(9, 10 * zoom)}px system-ui`;
          ctx.textBaseline = "bottom";
          ctx.fillText(String(it.name ?? ""), sx + 2, sy - 2);
          continue;
        }
        ctx.fillStyle = "rgba(90,169,255,.35)";
        ctx.fillRect(sx, sy, b.w * zoom, b.h * zoom);
        ctx.strokeStyle = "#5aa9ff";
        ctx.strokeRect(sx + 0.5, sy + 0.5, b.w * zoom, b.h * zoom);
        ctx.fillStyle = "#fff";
        ctx.font = `${Math.max(9, 10 * zoom)}px system-ui`;
        ctx.textBaseline = "top";
        ctx.fillText(String(it.name ?? it.kind ?? ""), sx + 3, sy + 3, Math.max(8, b.w * zoom - 6));
      } else {
        const scale = typeof it.scale === "number" ? it.scale : 1;
        ctx.fillStyle = rgb(it.color as number[] | undefined, "#fff");
        ctx.font = `${8 * scale * zoom}px ui-monospace, monospace`;
        ctx.textBaseline = "top";
        String(it.text ?? "").split("\n").forEach((line, i) => ctx.fillText(line, sx, sy + i * 8 * scale * zoom));
      }
    }
    ctx.restore();

    if (showGrid && gridSize * zoom >= 6) {
      ctx.strokeStyle = "rgba(255,255,255,.07)";
      ctx.beginPath();
      for (let x = 0; x <= world.width; x += gridSize) {
        const [sx] = toScreen(x, 0);
        ctx.moveTo(Math.round(sx) + 0.5, wy);
        ctx.lineTo(Math.round(sx) + 0.5, wy + world.height * zoom);
      }
      for (let y = 0; y <= world.height; y += gridSize) {
        const [, sy] = toScreen(0, y);
        ctx.moveTo(wx, Math.round(sy) + 0.5);
        ctx.lineTo(wx + world.width * zoom, Math.round(sy) + 0.5);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,255,255,.5)";
    ctx.strokeRect(wx + 0.5, wy + 0.5, world.width * zoom, world.height * zoom);

    if (mode === "tiles") {
      const m = tilemaps(scene)[mapIndex];
      if (m) {
        const box = tilemapBox(m);
        const [bx, by] = toScreen(box.x, box.y);
        ctx.strokeStyle = "#6fcf8e";
        ctx.lineWidth = 2;
        ctx.strokeRect(bx, by, box.w * zoom, box.h * zoom);
        ctx.lineWidth = 1;
        const tw = m.tileset.tile_width;
        const th = m.tileset.tile_height;
        ctx.strokeStyle = "rgba(111,207,142,.25)";
        ctx.beginPath();
        for (let x = 1; x < mapSize(m).cols; x++) { ctx.moveTo(bx + x * tw * zoom + 0.5, by); ctx.lineTo(bx + x * tw * zoom + 0.5, by + box.h * zoom); }
        for (let y = 1; y < mapSize(m).rows; y++) { ctx.moveTo(bx, by + y * th * zoom + 0.5); ctx.lineTo(bx + box.w * zoom, by + y * th * zoom + 0.5); }
        ctx.stroke();
        // solid tiles get a red wash so walls are visible while painting
        const solid = new Set(m.solid ?? []);
        ctx.fillStyle = "rgba(255,80,80,.28)";
        m.tiles.forEach((row, r) => row.forEach((n, c) => solid.has(n) && ctx.fillRect(bx + c * tw * zoom, by + r * th * zoom, tw * zoom, th * zoom)));
        if (hoverCell) {
          ctx.strokeStyle = "#ffd166";
          ctx.strokeRect(bx + hoverCell.col * tw * zoom + 0.5, by + hoverCell.row * th * zoom + 0.5, tw * zoom - 1, th * zoom - 1);
        }
      }
    }
    if (selected && mode === "select") {
      const b = boundsOf(scene, selected, sizes as Sizes, kindSizes as Kinds);
      const [sx, sy] = toScreen(b.x, b.y);
      ctx.strokeStyle = "#ffd166";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(sx - 1, sy - 1, b.w * zoom + 2, b.h * zoom + 2);
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
    }
  }

  $effect(() => {
    // redraw whenever anything the picture depends on changes
    scene; selected; zoom; originX; originY; width; height; gridSize; showGrid; pictureTick; sizes; mode; mapIndex; hoverCell; kindSizes;
    draw();
  });

  $effect(() => {
    if (!box) return;
    const watch = new ResizeObserver(() => {
      width = Math.max(100, box!.clientWidth);
      height = Math.max(100, box!.clientHeight);
    });
    watch.observe(box);
    return () => watch.disconnect();
  });

  // ---- mouse ---------------------------------------------------------------------------------
  let drag: { kind: "item"; ref: Ref; dx: number; dy: number; before: Scene; moved: boolean } | { kind: "pan"; sx: number; sy: number; ox: number; oy: number } | null = null;

  function pointer(e: PointerEvent): [number, number] {
    const r = canvas!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  let painting: { before: Scene; last: string } | null = null;

  function cellUnder(e: PointerEvent) {
    const m = tilemaps(scene)[mapIndex];
    if (!m) return null;
    const [x, y] = toWorld(...pointer(e));
    const col = Math.floor((x - (m.x ?? 0)) / m.tileset.tile_width);
    const row = Math.floor((y - (m.y ?? 0)) / m.tileset.tile_height);
    return col >= 0 && row >= 0 ? { col, row } : null;
  }

  function paintAt(cell: { col: number; row: number }) {
    const next = tileTool === "fill" ? fillTiles(scene, mapIndex, cell.col, cell.row, tile) : paintTile(scene, mapIndex, cell.col, cell.row, tile);
    if (next !== scene) commit(next, true);
  }

  function down(e: PointerEvent) {
    canvas!.setPointerCapture(e.pointerId);
    if (mode === "tiles" && e.button === 0 && !e.altKey && tilemaps(scene)[mapIndex]) {
      const cell = cellUnder(e);
      if (cell) {
        painting = { before: $state.snapshot(scene) as Scene, last: `${cell.col},${cell.row}` };
        paintAt(cell);
        canvas!.focus();
        return;
      }
    }
    const [sx, sy] = pointer(e);
    const [x, y] = toWorld(sx, sy);
    const hit = e.button === 0 && !e.altKey ? hitTest(scene, x, y, sizes as Sizes, kindSizes as Kinds) : null;
    if (hit) {
      selected = hit;
      const it = itemAt(scene, hit)!;
      drag = { kind: "item", ref: hit, dx: x - it.x, dy: y - it.y, before: $state.snapshot(scene) as Scene, moved: false };
    } else {
      if (e.button === 0 && !e.altKey) selected = null;
      drag = { kind: "pan", sx, sy, ox: originX, oy: originY };
    }
    canvas!.focus();
  }

  function move(e: PointerEvent) {
    if (mode === "tiles") {
      const cell = cellUnder(e);
      if (cell?.col !== hoverCell?.col || cell?.row !== hoverCell?.row) hoverCell = cell;
      if (painting && cell && tileTool === "paint") {
        const key = `${cell.col},${cell.row}`;
        if (key !== painting.last) {
          painting.last = key;
          paintAt(cell);
        }
      }
    }
    if (!drag) return;
    const [sx, sy] = pointer(e);
    if (drag.kind === "pan") {
      originX = drag.ox - (sx - drag.sx) / zoom;
      originY = drag.oy - (sy - drag.sy) / zoom;
      return;
    }
    const [x, y] = toWorld(sx, sy);
    const nx = snap(x - drag.dx, e.shiftKey ? 0 : gridSize);
    const ny = snap(y - drag.dy, e.shiftKey ? 0 : gridSize);
    const it = itemAt(scene, drag.ref);
    if (it && (it.x !== nx || it.y !== ny)) {
      if (!drag.moved) {
        history.record(drag.before);
        drag.moved = true;
      }
      commit(moveTo(scene, drag.ref, nx, ny), true);
    }
  }

  const up = () => {
    if (painting) {
      // one undo step per stroke, only if something changed
      if (JSON.stringify(painting.before) !== JSON.stringify($state.snapshot(scene))) {
        history.record(painting.before);
        historyTick++;
      }
      painting = null;
    }
    drag = null;
  };

  function wheel(e: WheelEvent) {
    e.preventDefault();
    const [sx, sy] = pointer(e as unknown as PointerEvent);
    const [wx, wy] = toWorld(sx, sy);
    const next = Math.min(8, Math.max(0.1, zoom * Math.exp(-e.deltaY * 0.0015)));
    originX = wx - sx / next;
    originY = wy - sy / next;
    zoom = next;
  }

  function fit() {
    zoom = Math.max(0.1, Math.min((width - 40) / world.width, (height - 40) / world.height));
    originX = -(width / zoom - world.width) / 2;
    originY = -(height / zoom - world.height) / 2;
  }
  $effect(() => {
    if (box) untrack(fit);
  });

  function key(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    } else if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
    } else if (mod && e.key.toLowerCase() === "d" && selected) {
      e.preventDefault();
      const dup = duplicateItem(scene, selected);
      if (dup) {
        edit(dup.scene);
        selected = dup.ref;
      }
    } else if ((e.key === "Delete" || e.key === "Backspace") && selected) {
      e.preventDefault();
      remove();
    } else if (selected && e.key.startsWith("Arrow")) {
      e.preventDefault();
      const step = e.shiftKey ? 1 : Math.max(1, gridSize);
      const it = itemAt(scene, selected)!;
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      edit(moveTo(scene, selected, it.x + dx, it.y + dy));
    }
  }

  function remove() {
    if (!selected) return;
    const ref = selected;
    edit(removeItem(scene, ref));
    selected = afterRemoval(scene, ref);
  }

  // ---- palette ------------------------------------------------------------------------------
  const centre = (): [number, number] => {
    const [x, y] = toWorld(width / 2, height / 2);
    return [snap(Math.max(0, Math.min(world.width, x)), gridSize), snap(Math.max(0, Math.min(world.height, y)), gridSize)];
  };
  function add(kind: ItemKind, partial: Record<string, unknown>) {
    const [x, y] = centre();
    const result = addItem(scene, kind, { ...partial, x, y } as Item);
    edit(result.scene);
    selected = result.ref;
  }
  const addObject = (kind: string) => add("objects", { kind, name: uniqueName(scene, kind.split(".").pop()!) });
  const addImage = (image: string) => add("images", { image });
  const addText = () => add("texts", { text: "Text", scale: 2 });

  const images = $derived(studio.files.filter((f) => !f.dir && f.path.toLowerCase().endsWith(".png")).map((f) => f.path));
  const entities = $derived(studio.symbols.entities.map((s) => s.label));

  // ---- tile maps ----------------------------------------------------------------------------
  const maps = $derived(tilemaps(scene));
  const activeMap = $derived(maps[mapIndex]);
  let tilesetCanvas: HTMLCanvasElement | undefined = $state();
  const TS_SCALE = 2;
  $effect(() => {
    // draw the tileset with the chosen tile outlined and solid tiles tinted
    scene; tile; mapIndex; pictureTick; mode; tilesetCanvas;
    const m = activeMap;
    const ctx = tilesetCanvas?.getContext("2d");
    const picture = m ? pictures.get(m.tileset.image) : undefined;
    if (!ctx || !tilesetCanvas || !m || !picture?.naturalWidth) return;
    const { tile_width: tw, tile_height: th } = m.tileset;
    tilesetCanvas.width = picture.naturalWidth * TS_SCALE;
    tilesetCanvas.height = picture.naturalHeight * TS_SCALE;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#2e313b";
    ctx.fillRect(0, 0, tilesetCanvas.width, tilesetCanvas.height);
    ctx.drawImage(picture, 0, 0, tilesetCanvas.width, tilesetCanvas.height);
    const perRow = Math.max(1, Math.floor(picture.naturalWidth / tw));
    const rows = Math.floor(picture.naturalHeight / th);
    const solid = new Set(m.solid ?? []);
    for (const n of solid) {
      ctx.fillStyle = "rgba(255,80,80,.35)";
      ctx.fillRect((n % perRow) * tw * TS_SCALE, Math.floor(n / perRow) * th * TS_SCALE, tw * TS_SCALE, th * TS_SCALE);
    }
    if (tile >= 0 && tile < perRow * rows) {
      ctx.strokeStyle = "#ffd166";
      ctx.lineWidth = 2;
      ctx.strokeRect((tile % perRow) * tw * TS_SCALE + 1, Math.floor(tile / perRow) * th * TS_SCALE + 1, tw * TS_SCALE - 2, th * TS_SCALE - 2);
    }
  });
  function pickTile(e: MouseEvent) {
    const m = activeMap;
    const picture = m ? pictures.get(m.tileset.image) : undefined;
    if (!m || !picture?.naturalWidth || !tilesetCanvas) return;
    const r = tilesetCanvas.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * picture.naturalWidth;
    const py = ((e.clientY - r.top) / r.height) * picture.naturalHeight;
    const perRow = Math.max(1, Math.floor(picture.naturalWidth / m.tileset.tile_width));
    const n = Math.floor(py / m.tileset.tile_height) * perRow + Math.floor(px / m.tileset.tile_width);
    if (n >= 0 && px < perRow * m.tileset.tile_width) tile = n;
  }
  function createMap() {
    if (!newSet) return;
    const result = addTilemap(scene, newSet, Math.max(1, newTile), Math.max(1, newTile), newCols, newRows);
    edit(result.scene);
    mapIndex = result.index;
    mode = "tiles";
    tile = 0;
  }
  function deleteMap() {
    if (!activeMap || !confirm(`Delete the tile map "${activeMap.name ?? mapIndex + 1}"?`)) return;
    edit(removeTilemap(scene, mapIndex));
    mapIndex = 0;
    if (tilemaps(scene).length === 0) mode = "select";
  }

  // ---- inspector ----------------------------------------------------------------------------
  const field = (key: string) => (item ? (item[key] as unknown) : undefined);
  function set(key: string, value: unknown) {
    if (selected) edit(setField(scene, selected, key, value));
  }
  function setNumber(key: string, raw: string, fallback?: number) {
    const n = Number(raw);
    if (raw.trim() === "" && fallback === undefined) set(key, undefined);
    else if (Number.isFinite(n)) set(key, n);
  }
  const hex = (c: number[] | undefined) => "#" + (c ?? [255, 255, 255]).slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("");
  const unhex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const label = (ref: Ref) => {
    const it = itemAt(scene, ref)!;
    return ref.kind === "objects" ? String(it.name ?? it.kind) : ref.kind === "images" ? String(it.image).split("/").pop()! : String(it.text).split("\n")[0]!;
  };
  const all = $derived(
    (["objects", "images", "texts"] as ItemKind[]).flatMap((kind) => (scene[kind] ?? []).map((_, index) => ({ kind, index }))),
  );
</script>

{#if error}
  <div class="bad">
    <p><strong>This scene file can't be shown visually.</strong></p>
    <p class="dim">{error}</p>
    <button onclick={onjson}>Edit as JSON</button>
  </div>
{:else}
  <div class="scene">
    <aside class="palette">
      <h3>Add</h3>
      <button onclick={addText}>＋ Text</button>
      <h4>Objects</h4>
      {#each entities as e (e)}
        <button class="item" onclick={() => addObject(e)}>{e}</button>
      {:else}
        <p class="dim small">Make a file in <code>entities/</code> and it shows up here.</p>
      {/each}
      <h4>Images</h4>
      {#each images as p (p)}
        <button class="item" onclick={() => addImage(p)} title={p}>{p.replace(/^sprites\//, "")}</button>
      {:else}
        <p class="dim small">No PNG files yet.</p>
      {/each}
      <h4>Tile maps</h4>
      {#each maps as m, i (i)}
        <button class="item" class:on={mode === "tiles" && mapIndex === i} onclick={() => { mapIndex = i; mode = "tiles"; }}>▦ {m.name ?? `map ${i + 1}`}</button>
      {/each}
      {#if images.length}
        <details class="newmap">
          <summary>New tile map…</summary>
          <label>Tileset <select bind:value={newSet}><option value="">choose…</option>{#each images as p (p)}<option value={p}>{p.replace(/^sprites\//, "")}</option>{/each}</select></label>
          <div class="pair">
            <label>Tile size <input type="number" min="1" bind:value={newTile} /></label>
            <label>Cells <input type="number" min="1" bind:value={newCols} /></label>
          </div>
          <label>Rows <input type="number" min="1" bind:value={newRows} /></label>
          <button disabled={!newSet} onclick={createMap}>Create</button>
        </details>
      {/if}
      <h4>In this scene</h4>
      {#each all as ref (ref.kind + ref.index)}
        <button class="item" class:on={sameRef(selected, ref)} onclick={() => (selected = ref)}>
          <span class="dim">{ref.kind === "objects" ? "◇" : ref.kind === "images" ? "▣" : "T"}</span> {label(ref)}
        </button>
      {/each}
    </aside>

    <div class="stage">
      <div class="bar">
        <button class="ghost" onclick={undo} disabled={!canUndo} title="Undo (⌘Z)">↶</button>
        <button class="ghost" onclick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)">↷</button>
        <span class="sep"></span>
        <button class:on={mode === "select"} onclick={() => (mode = "select")}>Select</button>
        <button class:on={mode === "tiles"} disabled={maps.length === 0} title={maps.length ? "Paint tiles" : "Create a tile map first"} onclick={() => (mode = "tiles")}>Tiles</button>
        <span class="sep"></span>
        <label>Snap
          <select bind:value={gridSize}>
            <option value={1}>off</option><option value={4}>4</option><option value={8}>8</option><option value={16}>16</option><option value={32}>32</option>
          </select>
        </label>
        <label class="check"><input type="checkbox" bind:checked={showGrid} /> Grid</label>
        <span class="sep"></span>
        <button class="ghost" onclick={fit}>Fit</button>
        <span class="dim">{Math.round(zoom * 100)}%</span>
        <span class="spacer"></span>
        <button class:on={view === "2d"} onclick={() => (view = "2d")} title="The flat level">2D</button>
        <button class:on={view === "3d"} onclick={() => (view = "3d")} title="Objects with 3D models, and the game camera">3D</button>
        <button class="ghost" onclick={onjson}>JSON</button>
      </div>
      {#if view === "3d"}
        <Scene3D
          {scene}
          {selected}
          models={modelDocs}
          {gridSize}
          onselect={(r) => (selected = r)}
          onmove={(r, p) => edit(moveTo3(scene, r, p))}
          onready={(v) => (view3 = v)}
        />
        <p class="hint dim">Click an object to select it · drag the arrows to move it · drag to orbit, right-drag to pan, scroll to zoom · the box with lines is the game's camera</p>
      {:else}
      <div class="canvas-box" bind:this={box}>
        <canvas
          bind:this={canvas}
          tabindex="0"
          style:width="{width}px"
          style:height="{height}px"
          aria-label="Scene canvas"
          onpointerdown={down}
          onpointermove={move}
          onpointerup={up}
          onpointercancel={up}
          onwheel={wheel}
          onkeydown={key}
        ></canvas>
      </div>
      <p class="hint dim">Drag to move · drag empty space to pan · scroll to zoom · arrows nudge · ⌘D duplicate · Delete removes · hold ⇧ to ignore snap</p>
      {/if}
    </div>

    <aside class="inspector">
      {#if mode === "tiles" && activeMap}
        <h3>Tile map</h3>
        <label>Map
          <select bind:value={mapIndex}>{#each maps as m, i (i)}<option value={i}>{m.name ?? `map ${i + 1}`}</option>{/each}</select>
        </label>
        <div class="tools2">
          <button class:on={tileTool === "paint"} onclick={() => (tileTool = "paint")}>Paint</button>
          <button class:on={tileTool === "fill"} onclick={() => (tileTool = "fill")}>Fill</button>
          <button class:on={tile === EMPTY_TILE} onclick={() => (tile = EMPTY_TILE)} title="Paint with nothing">Erase</button>
        </div>
        <div class="tileset"><canvas bind:this={tilesetCanvas} aria-label="Tileset" onclick={pickTile}></canvas></div>
        <p class="dim small">Tile {tile < 0 ? "none (erase)" : tile}{tileCell ? "" : ""}. Click a tile above, then the map. Painting past the edge grows the map.</p>
        <button disabled={tile < 0} onclick={() => edit(toggleSolid(scene, mapIndex, tile))}>
          {(activeMap.solid ?? []).includes(tile) ? "✓ Solid (click to make walkable)" : "Make this tile solid"}
        </button>
        <p class="dim small">Solid tiles stop <code>self:slide()</code> and are found by <code>nova.solid_at</code> (shown red).</p>
        <div class="pair">
          <label>Columns <input type="number" min="1" value={mapSize(activeMap).cols} onchange={(e) => edit(resizeTilemap(scene, mapIndex, Number(e.currentTarget.value), mapSize(activeMap!).rows))} /></label>
          <label>Rows <input type="number" min="1" value={mapSize(activeMap).rows} onchange={(e) => edit(resizeTilemap(scene, mapIndex, mapSize(activeMap!).cols, Number(e.currentTarget.value)))} /></label>
        </div>
        <div class="pair">
          <label>X <input type="number" value={activeMap.x ?? 0} onchange={(e) => { const next = structuredCloneSafe(scene); tilemaps(next)[mapIndex]!.x = Number(e.currentTarget.value) || 0; edit(next); }} /></label>
          <label>Y <input type="number" value={activeMap.y ?? 0} onchange={(e) => { const next = structuredCloneSafe(scene); tilemaps(next)[mapIndex]!.y = Number(e.currentTarget.value) || 0; edit(next); }} /></label>
        </div>
        <button class="danger" onclick={deleteMap}>Delete map</button>
      {:else if selected && item}
        <h3>{selected.kind === "objects" ? "Object" : selected.kind === "images" ? "Image" : "Text"}</h3>
        {#if selected.kind === "objects"}
          <label>Kind <input value={String(field("kind") ?? "")} onchange={(e) => set("kind", e.currentTarget.value.trim())} list="kinds" /></label>
          <datalist id="kinds">{#each entities as k (k)}<option value={k}></option>{/each}</datalist>
        {/if}
        {#if selected.kind === "images"}
          <label>Image
            <select value={String(field("image"))} onchange={(e) => set("image", e.currentTarget.value)}>
              {#each images as p (p)}<option value={p}>{p}</option>{/each}
              {#if !images.includes(String(field("image")))}<option value={String(field("image"))}>{String(field("image"))} (missing)</option>{/if}
            </select>
          </label>
        {/if}
        {#if selected.kind === "texts"}
          <label>Text <textarea rows="3" value={String(field("text") ?? "")} oninput={(e) => set("text", e.currentTarget.value)}></textarea></label>
        {/if}
        <label>Name <input value={String(field("name") ?? "")} placeholder="optional, becomes self.name" onchange={(e) => set("name", e.currentTarget.value.trim())} /></label>
        <div class="pair">
          <label>X <input type="number" value={item.x} onchange={(e) => setNumber("x", e.currentTarget.value, item.x)} /></label>
          <label>Y <input type="number" value={item.y} onchange={(e) => setNumber("y", e.currentTarget.value, item.y)} /></label>
        </div>
        {#if selected.kind === "objects" && view === "3d"}
          <label>Z (towards you) <input type="number" value={positionOf(item)[2]} onchange={(e) => edit(moveTo3(scene, selected!, [item.x, item.y, Number(e.currentTarget.value) || 0]))} /></label>
          <p class="dim small">In 3D, x goes across, y up and z towards the viewer. Turn it with the properties <code>ry</code> (radians) and <code>sx</code> (size).</p>
        {/if}
        {#if selected.kind !== "objects"}
          <label>Scale <input type="number" step="0.25" min="0" value={field("scale") ?? 1} onchange={(e) => setNumber("scale", e.currentTarget.value)} /></label>
        {/if}
        {#if selected.kind === "images"}
          <div class="pair">
            <label>Layer
              <select value={String(field("layer") ?? "world")} onchange={(e) => set("layer", e.currentTarget.value === "world" ? undefined : e.currentTarget.value)}>
                <option value="world">world</option><option value="ui">ui</option>
              </select>
            </label>
            <label>Depth <input type="number" value={field("depth") ?? 0} onchange={(e) => setNumber("depth", e.currentTarget.value)} /></label>
          </div>
        {/if}
        {#if selected.kind === "texts"}
          <label>Colour <input type="color" value={hex(field("color") as number[] | undefined)} onchange={(e) => set("color", unhex(e.currentTarget.value))} /></label>
        {/if}
        <div class="row">
          <button onclick={() => { const d = duplicateItem(scene, selected!); if (d) { edit(d.scene); selected = d.ref; } }}>Duplicate</button>
          <button class="danger" onclick={remove}>Delete</button>
        </div>
        {#if selected.kind === "objects"}
          <h4>Properties</h4>
          <p class="dim small">Become fields on the object, like <code>self.hp</code>.</p>
          {#each propsOf(scene, selected) as p (p.key)}
            <div class="prop">
              <input class="k" value={p.key} aria-label="Property name" onchange={(e) => edit(renameProp(scene, selected!, p.key, e.currentTarget.value))} />
              {#if p.simple}
                <input class="v" value={showPropValue(p.value)} aria-label="Value of {p.key}" onchange={(e) => edit(setProp(scene, selected!, p.key, parsePropValue(e.currentTarget.value)))} />
              {:else}
                <span class="v dim" title="Edit tables in the JSON view">{"{ … }"}</span>
              {/if}
              <button class="ghost danger" aria-label="Remove {p.key}" onclick={() => edit(setProp(scene, selected!, p.key, undefined))}>✕</button>
            </div>
          {/each}
          <form class="prop" onsubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const k = (f.elements.namedItem("k") as HTMLInputElement).value.trim(); if (k) { edit(setProp(scene, selected!, k, parsePropValue((f.elements.namedItem("v") as HTMLInputElement).value))); f.reset(); } }}>
            <input class="k" name="k" placeholder="name" aria-label="New property name" />
            <input class="v" name="v" placeholder="value" aria-label="New property value" />
            <button class="ghost" aria-label="Add property">＋</button>
          </form>
        {/if}
      {:else}
        <h3>Scene</h3>
        <label>Background <input type="color" value={hex(scene.background)} onchange={(e) => edit(setSceneField(scene, "background", unhex(e.currentTarget.value)))} /></label>
        <div class="pair">
          <label>Width <input type="number" min="1" value={world.width} onchange={(e) => edit(setSceneField(scene, "width", Number(e.currentTarget.value) || undefined))} /></label>
          <label>Height <input type="number" min="1" value={world.height} onchange={(e) => edit(setSceneField(scene, "height", Number(e.currentTarget.value) || undefined))} /></label>
        </div>
        <p class="dim small">The world is {world.width}×{world.height}. The camera stops at its edges. Click something to edit it.</p>
        {#if (scene.tilemaps as unknown[] | undefined)?.length}
          <p class="dim small">Tile maps are shown but edited in the JSON view for now.</p>
        {/if}
        {#if view === "3d"}
          {@const cam = cameraOf(scene)}
          <h4>Game camera</h4>
          {#each ["eye", "target"] as const as which (which)}
            <span class="dim small">{which === "eye" ? "Camera at" : "Looks at"}</span>
            <div class="vec3">{#each [0, 1, 2] as i (i)}<input type="number" step="0.5" value={cam[which][i]} aria-label="{which} {'xyz'[i]}" onchange={(e) => { const p = [...cam[which]] as [number, number, number]; p[i] = Number(e.currentTarget.value) || 0; edit(setCamera(scene, { ...cam, [which]: p })); }} />{/each}</div>
          {/each}
          <label>Field of view <input type="number" min="10" max="150" value={cam.fov} onchange={(e) => edit(setCamera(scene, { ...cam, fov: Number(e.currentTarget.value) || cam.fov }))} /></label>
          <div class="row">
            <button onclick={() => view3 && edit(setCamera(scene, { ...view3.current(), fov: cam.fov }))} title="Puts the game camera where you are looking from now">Use this view</button>
            {#if scene.camera}<button class="danger" onclick={() => edit(setCamera(scene, undefined))} title="The scene's script sets the camera instead">Remove</button>{/if}
          </div>
          <p class="dim small">{scene.camera ? "The game starts with this camera." : "No camera is saved: your script sets it (nova.camera). Change a number or press Use this view to save one."}</p>
        {/if}
      {/if}
    </aside>
  </div>
{/if}

<style>
  .scene { height: 100%; display: grid; grid-template-columns: 190px minmax(0, 1fr) 220px; min-height: 0; }
  .palette, .inspector { background: var(--panel); overflow: auto; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
  .palette { border-right: 1px solid var(--line); }
  .inspector { border-left: 1px solid var(--line); }
  h3 { margin: 2px 0 4px; font-size: 13px; }
  h4 { margin: 10px 0 2px; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--dim); }
  .item { text-align: left; background: transparent; border-color: transparent; padding: 2px 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .item:hover { background: var(--panel-2); }
  .item.on { background: color-mix(in srgb, var(--accent) 20%, transparent); }
  .stage { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .bar { display: flex; align-items: center; gap: 8px; padding: 4px 8px; background: var(--panel); border-bottom: 1px solid var(--line); }
  .bar label { display: flex; align-items: center; gap: 4px; }
  .check input { margin: 0; }
  .sep { width: 1px; height: 18px; background: var(--line); }
  .spacer { flex: 1; }
  .canvas-box { flex: 1; min-height: 0; position: relative; overflow: hidden; }
  .canvas-box canvas { position: absolute; inset: 0; display: block; cursor: default; outline: none; --panel-2: #222630; }
  .hint { margin: 0; padding: 3px 10px; font-size: 11px; border-top: 1px solid var(--line); background: var(--panel); }
  label { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--dim); }
  label input, label select, label textarea { color: var(--text); }
  textarea { background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 5px 8px; font: inherit; resize: vertical; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .row { display: flex; gap: 6px; margin-top: 6px; }
  .small { font-size: 11px; margin: 4px 0; }
  .bar button.on, .tools2 button.on { background: var(--accent-2); border-color: var(--accent-2); color: #fff; }
  .tools2 { display: flex; gap: 4px; }
  .tileset { max-height: 240px; overflow: auto; border: 1px solid var(--line); border-radius: 6px; background: #2e313b; }
  .tileset canvas { display: block; image-rendering: pixelated; cursor: pointer; }
  .newmap { border: 1px solid var(--line); border-radius: 6px; padding: 4px 6px; display: flex; flex-direction: column; gap: 4px; }
  .newmap summary { cursor: pointer; }
  .newmap input, .newmap select { min-width: 0; width: 100%; }
  .prop { display: flex; gap: 4px; align-items: center; }
  .prop .k { width: 70px; min-width: 0; } .prop .v { flex: 1; min-width: 0; }
  .prop input { padding: 2px 6px; }
  .vec3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
  .vec3 input { min-width: 0; }
  .bad { padding: 32px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
</style>
