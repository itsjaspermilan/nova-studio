<script lang="ts">
  import { onMount, untrack } from "svelte";
  import {
    CLEAR, cloneRaster, composite, drawEllipse, drawLine, drawRect, floodFill, getPixel, inside, parseHex, stamp, toHex, type Point, type Raster, type Rgba,
  } from "../lib/pixels";
  import {
    addTag, cloneDoc, frameAt, fromImage, fromSheet, insertFrame, moveFrame, newDoc, parseSheetJson, removeFrame, removeTag, tagProblems, tagSequence,
    toSheet, toSheetJson, updateTag, type Direction, type SpriteDoc,
  } from "../lib/sprite-doc";
  import { loadRaster, rasterToDataUrl } from "../lib/png";
  import { studio } from "../lib/store.svelte";

  let { path, text }: { path: string; text: string } = $props();

  type Tool = "pencil" | "eraser" | "fill" | "line" | "rect" | "ellipse" | "picker";
  interface Session {
    doc: SpriteDoc;
    past: SpriteDoc[];
    future: SpriteDoc[];
    frame: number;
    imagePath: string; // the PNG this sprite saves to
    imageName: string; // how the JSON refers to it (relative to the JSON file)
    sheet: boolean; // false: a plain PNG, no JSON
  }

  const TOOLS: { id: Tool; label: string; key: string; icon: string }[] = [
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
  let showGrid = $state(true);
  let zoom = $state(12);
  let canUndo = $state(false);
  let canRedo = $state(false);

  let session: Session | undefined;
  let isSheet = $state(false);
  let canvas: HTMLCanvasElement | undefined = $state();
  let preview: HTMLCanvasElement | undefined = $state();
  const thumbs = new Map<number, HTMLCanvasElement>();

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
        s = { doc: fromImage(image), past: [], future: [], frame: 0, imagePath: fromPath, imageName: fromPath.slice(fromPath.lastIndexOf("/") + 1), sheet: false };
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
        s = { doc: base, past: [], future: [], frame: 0, imagePath, imageName, sheet: true };
      }
      studio.sessions.set(fromPath, s);
      session = s;
      adopt();
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    }
  }

  function adopt() {
    doc = session!.doc;
    frame = Math.min(session!.frame, doc.frames.length - 1);
    zoom = Math.max(1, Math.min(32, Math.floor(420 / Math.max(doc.fw, doc.fh))));
    canUndo = session!.past.length > 0;
    canRedo = session!.future.length > 0;
    isSheet = session!.sheet;
    studio.saveHooks.set(fromPath, async () => {
      await studio.api!.writeImage(session!.imagePath, rasterToDataUrl(toSheet(session!.doc)));
    });
    ready = true;
  }

  /// Tell the studio the sprite changed: new JSON text for sheets, and an unsaved mark either way.
  function changed() {
    if (!session) return;
    session.doc = doc;
    session.frame = frame;
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
    changed();
  }
  function undo() {
    const prev = session?.past.pop();
    if (!prev) return;
    session!.future.push(cloneDoc(doc));
    doc = prev;
    frame = Math.min(frame, doc.frames.length - 1);
    changed();
  }
  function redo() {
    const next = session?.future.pop();
    if (!next) return;
    session!.past.push(cloneDoc(doc));
    doc = next;
    frame = Math.min(frame, doc.frames.length - 1);
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
    if (onion && frame > 0 && !playing) blit(doc.frames[frame - 1]!, 0.3);
    blit(current, 1);
    if (showGrid && zoom >= 8) {
      ctx.strokeStyle = "rgba(255,255,255,.12)";
      ctx.beginPath();
      for (let x = 1; x < doc.fw; x++) { ctx.moveTo(x * zoom + 0.5, 0); ctx.lineTo(x * zoom + 0.5, h); }
      for (let y = 1; y < doc.fh; y++) { ctx.moveTo(0, y * zoom + 0.5); ctx.lineTo(w, y * zoom + 0.5); }
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
    doc; frame; rev; zoom; onion; showGrid; ready; hover; size; tool; playing; canvas;
    paint();
  });

  // thumbnails
  function drawThumb(node: HTMLCanvasElement, index: number) {
    thumbs.set(index, node);
    const render = () => {
      const r = doc.frames[index];
      const ctx = node.getContext("2d");
      if (!r || !ctx) return;
      node.width = r.w;
      node.height = r.h;
      ctx.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.w, r.h), 0, 0);
    };
    render();
    return { update: () => render(), destroy: () => thumbs.delete(index) };
  }
  $effect(() => {
    rev; doc;
    for (const [i, node] of thumbs) {
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

  function cell(e: PointerEvent): Point {
    const r = canvas!.getBoundingClientRect();
    return { x: Math.floor(((e.clientX - r.left) / r.width) * doc.fw), y: Math.floor(((e.clientY - r.top) / r.height) * doc.fh) };
  }

  function down(e: PointerEvent) {
    if (e.button !== 0 || !ready) return;
    const p = cell(e);
    const r = doc.frames[frame]!;
    if (tool === "picker") {
      const c = getPixel(r, p.x, p.y);
      if (c && c[3] > 0) color = c;
      return;
    }
    canvas!.setPointerCapture(e.pointerId);
    before = cloneDoc(doc);
    drawing = true;
    start = last = p;
    base = cloneRaster(r);
    if (tool === "pencil" || tool === "eraser") stamp(r, p.x, p.y, size, tool === "eraser" ? CLEAR : color);
    else if (tool === "fill") {
      floodFill(r, p.x, p.y, color);
      finish();
      return;
    } else shape(r, p);
    rev++;
  }

  function shape(r: Raster, p: Point) {
    r.data.set(base!.data);
    if (tool === "line") drawLine(r, start, p, size, color);
    else if (tool === "rect") drawRect(r, start, p, size, color, filled);
    else if (tool === "ellipse") drawEllipse(r, start, p, size, color, filled);
  }

  function move(e: PointerEvent) {
    const p = cell(e);
    if (!hover || hover.x !== p.x || hover.y !== p.y) hover = p;
    if (!drawing) return;
    const r = doc.frames[frame]!;
    if (tool === "pencil" || tool === "eraser") {
      drawLine(r, last, p, size, tool === "eraser" ? CLEAR : color);
      last = p;
    } else shape(r, p);
    rev++;
  }

  function finish() {
    if (!drawing) return;
    drawing = false;
    const r = doc.frames[frame]!;
    const was = before!.frames[frame]!;
    if (r.data.some((v, i) => v !== was.data[i])) {
      session!.past.push(before!);
      if (session!.past.length > MAX_HISTORY) session!.past.shift();
      session!.future = [];
      changed();
    }
    before = base = null;
  }
  const up = () => finish();
  const leave = () => (hover = null);

  function clearFrame() {
    const next = cloneDoc(doc);
    next.frames[frame]!.data.fill(0);
    structural(next);
  }
  function flip(horizontal: boolean) {
    const next = cloneDoc(doc);
    const r = next.frames[frame]!;
    const src = cloneRaster(r);
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const c = getPixel(src, horizontal ? r.w - 1 - x : x, horizontal ? y : r.h - 1 - y)!;
      r.data.set(c, (y * r.w + x) * 4);
    }
    structural(next);
  }

  // ---- frames and tags --------------------------------------------------------------------------
  const addBlank = () => structural(insertFrame(doc, frame + 1), frame + 1);
  const duplicate = () => structural(insertFrame(doc, frame + 1, frame), frame + 1);
  const remove = () => structural(removeFrame(doc, frame), frame);
  const shift = (by: number) => structural(moveFrame(doc, frame, frame + by), frame + by);
  function setDuration(ms: number, all = false) {
    if (!Number.isFinite(ms) || ms < 10) return;
    const next = cloneDoc(doc);
    if (all) next.durations.fill(ms);
    else next.durations[frame] = ms;
    structural(next);
  }
  const problems = $derived(tagProblems(doc));

  // ---- preview ----------------------------------------------------------------------------------
  let playing = $state(false);
  let previewTag = $state(-1); // -1: all frames
  let previewFrame = $state(0);
  $effect(() => {
    if (!playing) return;
    const tag = doc.tags[previewTag];
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
    } else if (!mod) {
      const hit = TOOLS.find((t) => t.key.toLowerCase() === e.key.toLowerCase());
      if (hit) tool = hit.id;
      else if (e.key === "[") size = Math.max(1, size - 1);
      else if (e.key === "]") size = Math.min(16, size + 1);
      else if (e.key === "ArrowLeft") frame = Math.max(0, frame - 1);
      else if (e.key === "ArrowRight") frame = Math.min(doc.frames.length - 1, frame + 1);
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
        <label class="check"><input type="checkbox" bind:checked={onion} /> Onion skin</label>
        <label class="check"><input type="checkbox" bind:checked={showGrid} /> Grid</label>
        <span class="spacer"></span>
        <button class="ghost" onclick={() => (zoom = Math.max(1, zoom - 1))} aria-label="Zoom out">−</button>
        <span class="dim">{zoom * 100}%</span>
        <button class="ghost" onclick={() => (zoom = Math.min(48, zoom + 1))} aria-label="Zoom in">＋</button>
        <span class="dim">{doc.fw}×{doc.fh}{hover && inside(current, hover.x, hover.y) ? ` · ${hover.x},${hover.y}` : ""}</span>
      </div>
      <div class="scroller">
        <canvas bind:this={canvas} aria-label="Sprite canvas" onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onpointerleave={leave}></canvas>
      </div>

      <div class="timeline">
        <div class="frames" role="listbox" aria-label="Frames">
          {#each doc.frames as _, i (i)}
            <button class="frame" class:on={i === frame} role="option" aria-selected={i === frame} onclick={() => (frame = i)} title="Frame {i + 1} · {doc.durations[i]} ms">
              <canvas use:drawThumb={i}></canvas>
              <span>{i + 1}</span>
              {#each doc.tags.filter((t) => i >= t.from && i <= t.to) as t (t.name + i)}<i class="bar" title={t.name}></i>{/each}
            </button>
          {/each}
        </div>
        <div class="frame-actions">
          <button onclick={addBlank} title="New blank frame after this one">＋ Frame</button>
          <button onclick={duplicate}>Duplicate</button>
          <button onclick={() => shift(-1)} disabled={frame === 0} aria-label="Move frame left">◀</button>
          <button onclick={() => shift(1)} disabled={frame === doc.frames.length - 1} aria-label="Move frame right">▶</button>
          <button class="danger" onclick={remove} disabled={doc.frames.length <= 1}>Delete</button>
          <label class="inline">Duration <input type="number" min="10" step="10" value={doc.durations[frame]} onchange={(e) => setDuration(Number(e.currentTarget.value))} class="narrow" /> ms</label>
          <button class="ghost" onclick={() => setDuration(doc.durations[frame]!, true)}>Apply to all</button>
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

      <h3>Preview</h3>
      <div class="preview"><canvas bind:this={preview}></canvas></div>
      <div class="row">
        <button onclick={() => (playing = !playing)}>{playing ? "■ Stop" : "▶ Play"}</button>
        <select bind:value={previewTag} aria-label="What to play">
          <option value={-1}>All frames</option>
          {#each doc.tags as t, i (i)}<option value={i}>{t.name || "(unnamed)"}</option>{/each}
        </select>
      </div>

      {#if isSheet}
        <h3>Animations</h3>
        {#each doc.tags as t, i (i)}
          <div class="tag">
            <input value={t.name} placeholder="name" aria-label="Tag name" onchange={(e) => structural(updateTag(doc, i, { name: e.currentTarget.value.trim() }))} />
            <div class="pair">
              <label>From <input type="number" min="1" max={doc.frames.length} value={t.from + 1} onchange={(e) => structural(updateTag(doc, i, { from: Number(e.currentTarget.value) - 1 }))} /></label>
              <label>To <input type="number" min="1" max={doc.frames.length} value={t.to + 1} onchange={(e) => structural(updateTag(doc, i, { to: Number(e.currentTarget.value) - 1 }))} /></label>
            </div>
            <div class="pair">
              <select value={t.direction} aria-label="Direction" onchange={(e) => structural(updateTag(doc, i, { direction: e.currentTarget.value as Direction }))}>
                <option value="forward">forward</option><option value="reverse">reverse</option><option value="pingpong">ping-pong</option>
              </select>
              <label class="check"><input type="checkbox" checked={t.loop} onchange={(e) => structural(updateTag(doc, i, { loop: e.currentTarget.checked }))} /> Loop</label>
            </div>
            <button class="ghost danger" onclick={() => structural(removeTag(doc, i))}>Remove</button>
          </div>
        {/each}
        {#each problems as p (p)}<p class="warn small">{p}</p>{/each}
        <button onclick={() => structural(addTag(doc, frame, frame))}>＋ Animation from this frame</button>
        <p class="dim small">In Lua: <code>self:play("name")</code></p>
      {:else}
        <p class="dim small">This is a plain image. Open or create a <code>.sprite.json</code> to get frames and animations.</p>
      {/if}
    </aside>
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
  .frame canvas { width: 40px; height: 40px; object-fit: contain; image-rendering: pixelated; background: repeating-conic-gradient(#3a3d48 0 25%, #2e313b 0 50%) 0 0 / 8px 8px; }
  .frame span { font-size: 10px; color: var(--dim); }
  .frame .bar { position: absolute; left: 3px; right: 3px; bottom: 1px; height: 3px; background: var(--ok); border-radius: 2px; opacity: .8; }
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
  .row { display: flex; gap: 6px; } .row select { flex: 1; min-width: 0; }
  .tag { display: flex; flex-direction: column; gap: 4px; padding: 6px; border: 1px solid var(--line); border-radius: 6px; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; align-items: center; }
  .tag label { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: var(--dim); }
  .tag label.check { flex-direction: row; align-items: center; color: var(--text); }
  .small { font-size: 11px; margin: 2px 0; }
  .warn { color: var(--warn); }
  .fail { padding: 32px; display: grid; place-items: start; gap: 8px; }
</style>
