<script lang="ts">
  // The tileset editor (a `*.tileset.json` beside its picture `*.png`): the picture cut into tiles with their numbers, which tiles are solid,
  // names for tiles, and terrains for auto-tiling: a terrain lists the tiles to use for each shape of its edge, and the scene editor paints with
  // it so edges and corners join up by themselves. The little map at the bottom shows a terrain painted.
  import { onMount, untrack } from "svelte";
  import Icon from "./Icon.svelte";
  import { paintTerrain, tileCountOf, type Terrain, type TerrainMode } from "../lib/autotile";
  import {
    addTerrain, duplicateTiles, gridOf, imagePathFor, parseTileset, removeTerrain, serializeTileset, setTerrainSlot, setTileName, toggleSolidTile, type TilesetDoc,
  } from "../lib/tileset";
  import { loadRaster } from "../lib/png";
  import { studio } from "../lib/store.svelte";
  import type { Raster } from "../lib/pixels";

  let { path, text, onjson }: { path: string; text: string; onjson: () => void } = $props();

  const parsed = untrack(() => parseTileset(text));
  const error = parsed.ok ? "" : parsed.error;
  let doc: TilesetDoc = $state.raw(parsed.ok ? parsed.doc : { version: 1, tile_width: 16, tile_height: 16, solid: [], names: {}, terrains: [] });
  const imagePath = untrack(() => imagePathFor(path));

  // ---- history ------------------------------------------------------------------------------------------
  const past: TilesetDoc[] = [];
  let future: TilesetDoc[] = [];
  let tick = $state(0);
  const canUndo = $derived(tick >= 0 && past.length > 0);
  const canRedo = $derived(tick >= 0 && future.length > 0);
  function commit(next: TilesetDoc, keep = false) {
    if (next === doc) return;
    if (!keep) {
      past.push(doc);
      future = [];
    }
    doc = next;
    tick++;
    studio.edit(path, serializeTileset(next));
  }
  const undo = () => {
    const p = past.pop();
    if (p) {
      future.push(doc);
      commit(p, true);
    }
  };
  const redo = () => {
    const n = future.pop();
    if (n) {
      past.push(doc);
      commit(n, true);
    }
  };

  // ---- the picture ---------------------------------------------------------------------------------------
  let picture = $state.raw<Raster | null>(null);
  let img = $state.raw<HTMLImageElement | null>(null);
  let missing = $state(false);
  const grid = $derived(picture ? gridOf(picture.w, picture.h, doc.tile_width, doc.tile_height) : { columns: 0, rows: 0, count: 0 });
  let selected = $state(0);
  let slot: { terrain: number; index: number } | null = $state(null); // the terrain slot waiting for a tile
  let dupes: number[][] | null = $state(null);

  onMount(() => {
    if (error) return;
    void (async () => {
      try {
        const url = await studio.api!.readImage(imagePath);
        const image = new Image();
        await new Promise<void>((ok, bad) => {
          image.onload = () => ok();
          image.onerror = () => bad(new Error("no picture"));
          image.src = url;
        });
        img = image;
        picture = await loadRaster(url);
      } catch {
        missing = true;
      }
    })();
  });

  const ZOOM = $derived(picture ? Math.max(1, Math.min(8, Math.floor(512 / Math.max(1, picture.w)))) : 1);
  let canvas: HTMLCanvasElement | undefined = $state();
  function draw() {
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas || !img || !picture) return;
    const [w, h] = [picture.w * ZOOM, picture.h * ZOOM];
    canvas.width = w;
    canvas.height = h;
    ctx.imageSmoothingEnabled = false;
    // a checkerboard behind the tiles so empty parts are visible
    for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 8) {
      ctx.fillStyle = (x / 8 + y / 8) % 2 ? "#2a2d36" : "#23262e";
      ctx.fillRect(x, y, 8, 8);
    }
    ctx.drawImage(img, 0, 0, w, h);
    const [tw, th] = [doc.tile_width * ZOOM, doc.tile_height * ZOOM];
    const solid = new Set(doc.solid);
    for (let n = 0; n < grid.count; n++) {
      const [x, y] = [(n % grid.columns) * tw, Math.floor(n / grid.columns) * th];
      if (solid.has(n)) {
        ctx.fillStyle = "rgba(255,80,80,.3)";
        ctx.fillRect(x, y, tw, th);
      }
      ctx.strokeStyle = "rgba(255,255,255,.18)";
      ctx.strokeRect(x + 0.5, y + 0.5, tw - 1, th - 1);
      if (tw >= 26) {
        ctx.fillStyle = "rgba(255,255,255,.7)";
        ctx.font = "10px system-ui";
        ctx.fillText(String(n), x + 3, y + 11);
      }
    }
    // the tiles the terrain being edited uses, in its colour
    const t = terrainOpen !== null ? doc.terrains[terrainOpen] : undefined;
    t?.tiles.forEach((n) => {
      if (n < 0 || n >= grid.count) return;
      ctx.strokeStyle = "#6fcf8e";
      ctx.strokeRect((n % grid.columns) * tw + 2, Math.floor(n / grid.columns) * th + 2, tw - 4, th - 4);
    });
    if (selected >= 0 && selected < grid.count) {
      ctx.strokeStyle = "#ffd166";
      ctx.lineWidth = 2;
      ctx.strokeRect((selected % grid.columns) * tw + 1, Math.floor(selected / grid.columns) * th + 1, tw - 2, th - 2);
      ctx.lineWidth = 1;
    }
  }
  let terrainOpen: number | null = $state(null);
  $effect(() => {
    doc; selected; picture; img; canvas; terrainOpen; ZOOM; tick;
    draw();
  });

  function tileAt(e: MouseEvent): number {
    const r = canvas!.getBoundingClientRect();
    const col = Math.floor(((e.clientX - r.left) / r.width) * grid.columns);
    const row = Math.floor(((e.clientY - r.top) / r.height) * grid.rows);
    return col >= 0 && row >= 0 && col < grid.columns && row < grid.rows ? row * grid.columns + col : -1;
  }
  function click(e: MouseEvent) {
    const n = tileAt(e);
    if (n < 0) return;
    selected = n;
    if (slot) {
      commit(setTerrainSlot(doc, slot.terrain, slot.index, n));
      // on to the next slot, so a terrain can be filled in by clicking its tiles in order
      const t = doc.terrains[slot.terrain]!;
      slot = slot.index + 1 < t.tiles.length ? { terrain: slot.terrain, index: slot.index + 1 } : null;
    }
  }

  const sizeChange = (key: "tile_width" | "tile_height", v: number) => {
    const n = Math.max(1, Math.min(1024, Math.round(v)));
    if (n !== doc[key]) commit({ ...doc, [key]: n });
  };

  // ---- terrains -------------------------------------------------------------------------------------------
  let newName = $state("grass");
  let newMode: TerrainMode = $state("edges");
  function makeTerrain() {
    commit(addTerrain(doc, newName, newMode, Math.max(0, selected), Math.max(1, grid.columns)));
    terrainOpen = doc.terrains.length - 1;
  }
  /// The tile numbers of a terrain as little pictures, for its slot grid.
  function drawTile(node: HTMLCanvasElement, n: number) {
    const paint = (tile: number) => {
      const ctx = node.getContext("2d");
      if (!ctx || !img) return;
      ctx.clearRect(0, 0, node.width, node.height);
      ctx.imageSmoothingEnabled = false;
      if (tile >= 0 && tile < grid.count) ctx.drawImage(img, (tile % grid.columns) * doc.tile_width, Math.floor(tile / grid.columns) * doc.tile_height, doc.tile_width, doc.tile_height, 0, 0, node.width, node.height);
    };
    paint(n);
    return { update: paint };
  }

  // the mini map: a lump of the terrain painted with auto-tiling
  const PREVIEW = [[2, 1], [3, 1], [4, 1], [5, 1], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [2, 3], [3, 3], [4, 3], [5, 3], [3, 4], [4, 4]];
  const previewGrid = (t: Terrain) => {
    let g = Array.from({ length: 6 }, () => Array<number>(9).fill(-1));
    for (const [c, r] of PREVIEW) g = paintTerrain(g, t, c!, r!);
    return g;
  };
  let previewCanvas: HTMLCanvasElement | undefined = $state();
  $effect(() => {
    doc; terrainOpen; img; previewCanvas; tick;
    const t = terrainOpen !== null ? doc.terrains[terrainOpen] : undefined;
    const ctx = previewCanvas?.getContext("2d");
    if (!ctx || !previewCanvas || !img || !t) return;
    const s = 2;
    const [tw, th] = [doc.tile_width * s, doc.tile_height * s];
    previewCanvas.width = 9 * tw;
    previewCanvas.height = 6 * th;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#1c1f27";
    ctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
    previewGrid(t).forEach((row, r) => row.forEach((n, c) => {
      if (n >= 0 && n < grid.count) ctx.drawImage(img!, (n % grid.columns) * doc.tile_width, Math.floor(n / grid.columns) * doc.tile_height, doc.tile_width, doc.tile_height, c * tw, r * th, tw, th);
    }));
  });

  function key(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA") return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
    } else if (e.key === "Escape") slot = null;
  }
  const solid = $derived(doc.solid.includes(selected));
  const SLOT_NAME = (mode: TerrainMode, i: number) => {
    if (mode === "edges") return ["N", "E", "S", "W"].filter((_, b) => i & (1 << b)).join("") || "alone";
    return `#${i + 1}`;
  };
</script>

<svelte:window onkeydown={key} />

{#if error}
  <div class="bad"><p><strong>This tileset can't be shown in the editor.</strong></p><p class="dim">{error}</p><button onclick={onjson}>Edit as JSON</button></div>
{:else}
  <div class="ts">
    <div class="top">
      <button class="ghost" onclick={undo} disabled={!canUndo} aria-label="Undo"><Icon name="undo" /></button>
      <button class="ghost" onclick={redo} disabled={!canRedo} aria-label="Redo"><Icon name="redo" /></button>
      <label>Tile width <input type="number" class="narrow" min="1" max="1024" value={doc.tile_width} onchange={(e) => sizeChange("tile_width", Number(e.currentTarget.value))} /></label>
      <label>Tile height <input type="number" class="narrow" min="1" max="1024" value={doc.tile_height} onchange={(e) => sizeChange("tile_height", Number(e.currentTarget.value))} /></label>
      <span class="dim">{grid.count} tiles ({grid.columns} across) · picture {imagePath}</span>
      <span class="spacer"></span>
      <button class="ghost" onclick={() => (dupes = picture ? duplicateTiles(picture, doc.tile_width, doc.tile_height) : [])} title="Find tiles that look exactly alike">Find duplicates</button>
      <button class="ghost" onclick={onjson}>JSON</button>
    </div>
    {#if missing}
      <div class="bad"><p><strong>The picture is missing.</strong></p><p class="dim">This tileset goes with <code>{imagePath}</code>, which is not in the project. Draw or import it in Sprites.</p></div>
    {:else}
      <div class="body">
        <div class="sheet"><canvas bind:this={canvas} style:width="{(picture?.w ?? 0) * ZOOM}px" aria-label="The tileset picture: click a tile" onclick={click}></canvas></div>
        <aside class="side">
          <h3>Tile {selected}</h3>
          <label>Name <input value={doc.names[String(selected)] ?? ""} placeholder="no name" onchange={(e) => commit(setTileName(doc, selected, e.currentTarget.value))} /></label>
          <label class="check"><input type="checkbox" checked={solid} onchange={() => commit(toggleSolidTile(doc, selected))} /> Solid (blocks movement)</label>
          <p class="dim small">{doc.solid.length} solid tile{doc.solid.length === 1 ? "" : "s"}: a new tile map made from this tileset starts with them as its solid list.</p>

          <h3>Terrains</h3>
          <p class="dim small">A terrain is the set of tiles for painting one kind of ground, so edges and corners join up. Pick the tile the terrain starts at, then add it.</p>
          <div class="row">
            <input bind:value={newName} aria-label="Terrain name" />
            <select bind:value={newMode} aria-label="Kind of terrain"><option value="edges">Edges (16 tiles)</option><option value="blob">Edges and corners (47 tiles)</option></select>
            <button onclick={makeTerrain} title="Lays its {tileCountOf(newMode)} tiles out from tile {selected}, row after row">Add from tile {selected}</button>
          </div>
          {#each doc.terrains as t, ti (ti)}
            <div class="terrain" class:on={terrainOpen === ti}>
              <div class="thead">
                <button class="ghost name" onclick={() => (terrainOpen = terrainOpen === ti ? null : ti)}>{terrainOpen === ti ? "▾" : "▸"} {t.name} <span class="dim">({t.mode === "edges" ? "edges" : "edges and corners"})</span></button>
                <button class="ghost" aria-label="Delete terrain {t.name}" onclick={() => { commit(removeTerrain(doc, ti)); if (terrainOpen === ti) terrainOpen = null; }}><Icon name="trash" /></button>
              </div>
              {#if terrainOpen === ti}
                <p class="dim small">Click a slot, then a tile in the picture (it moves on to the next slot). Esc stops.</p>
                <div class="slots" class:blob={t.mode === "blob"}>
                  {#each t.tiles as n, i (i)}
                    <button class="slot" class:wait={slot?.terrain === ti && slot.index === i} title={t.mode === "edges" ? `Tile for: ${SLOT_NAME(t.mode, i)}` : `Slot ${i + 1}`} onclick={() => (slot = { terrain: ti, index: i })}>
                      <canvas width="24" height="24" use:drawTile={n}></canvas><span>{n >= 0 ? n : "–"}</span><em>{t.mode === "edges" ? SLOT_NAME(t.mode, i) : ""}</em>
                    </button>
                  {/each}
                </div>
                <canvas bind:this={previewCanvas} class="preview" aria-label="A shape painted with this terrain"></canvas>
              {/if}
            </div>
          {/each}
          {#if dupes}
            <h3>Duplicates</h3>
            {#if dupes.length}
              <ul class="dupes">{#each dupes as g (g[0])}<li>tiles {g.join(", ")} look alike</li>{/each}</ul>
            {:else}
              <p class="dim small">No two tiles look exactly alike.</p>
            {/if}
          {/if}
        </aside>
      </div>
    {/if}
  </div>
{/if}

<style>
  .ts { height: 100%; display: flex; flex-direction: column; min-height: 0; }
  .top { display: flex; align-items: center; gap: 12px; padding: 6px 10px; background: var(--panel); border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .top label { display: flex; align-items: center; gap: 4px; }
  .narrow { width: 62px; padding: 2px 6px; }
  .spacer { flex: 1; }
  .body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 320px; }
  .sheet { overflow: auto; background: #15171c; padding: 8px; }
  .sheet canvas { image-rendering: pixelated; cursor: pointer; display: block; }
  .side { background: var(--panel); border-left: 1px solid var(--line); padding: 8px 10px; overflow: auto; display: flex; flex-direction: column; gap: 6px; }
  h3 { margin: 8px 0 2px; font-size: 13px; }
  label { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--dim); }
  label.check { flex-direction: row; align-items: center; gap: 6px; color: var(--text); }
  .row { display: flex; gap: 4px; flex-wrap: wrap; } .row input { flex: 1; min-width: 80px; }
  .small { font-size: 11px; margin: 2px 0; }
  .terrain { border: 1px solid var(--line); border-radius: 8px; padding: 4px 6px; }
  .terrain.on { border-color: var(--accent); }
  .thead { display: flex; align-items: center; }
  .thead .name { flex: 1; text-align: left; }
  .slots { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3px; margin: 4px 0; }
  .slots.blob { grid-template-columns: repeat(8, 1fr); }
  .slot { position: relative; padding: 2px; display: flex; flex-direction: column; align-items: center; gap: 0; background: var(--bg); }
  .slot canvas { width: 100%; image-rendering: pixelated; aspect-ratio: 1; }
  .slot span { font-size: 9px; color: var(--dim); }
  .slot em { position: absolute; top: 1px; left: 2px; font-size: 8px; font-style: normal; color: var(--accent); }
  .slot.wait { outline: 2px solid #ffd166; }
  .preview { width: 100%; image-rendering: pixelated; border-radius: 6px; margin-top: 4px; }
  .dupes { margin: 0; padding-left: 16px; font-size: 12px; }
  .bad { padding: 32px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
</style>
