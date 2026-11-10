<script lang="ts">
  // Export a sprite: each frame as a PNG, each layer as a PNG, a packed sheet with an atlas, or an animated GIF or PNG, into the project's exports folder.
  // What was chosen is remembered for the sprite, so the same export can be run again with one click.
  import { untrack } from "svelte";
  import { DEFAULT_PROFILE, atlasJson, checkProfile, framePieces, layerPieces, packSheet, safeName, scaleUp, type ExportProfile, type Piece } from "../lib/sprite-export";
  import type { SpriteDoc } from "../lib/sprite-doc";
  import { rasterToDataUrl } from "../lib/png";
  import { toBase64 } from "../lib/wav";
  import { studio } from "../lib/store.svelte";

  let { doc, base, storeKey, ongif, onapng, onclose }: { doc: SpriteDoc; base: string; storeKey: string; ongif: () => void; onapng: () => void; onclose: () => void } = $props();

  const KEY = () => `nova.sprite.export.${storeKey}`;
  function loadProfiles(): ExportProfile[] {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY()) ?? "[]") as unknown[];
      return raw.map(checkProfile).filter((p): p is ExportProfile => !!p);
    } catch {
      return [];
    }
  }
  let profiles = $state<ExportProfile[]>(loadProfiles());
  let p = $state<ExportProfile>({ ...(untrack(() => profiles)[0] ?? DEFAULT_PROFILE) });
  let working = $state(false);
  let report = $state("");

  const saveProfiles = () => {
    try {
      localStorage.setItem(KEY(), JSON.stringify(profiles));
    } catch {
      // not remembered
    }
  };
  function remember() {
    const name = p.name.trim() || "My export";
    profiles = [{ ...p, name }, ...profiles.filter((x) => x.name !== name)].slice(0, 8);
    saveProfiles();
  }
  const dataUrl = (r: Parameters<typeof rasterToDataUrl>[0]) => rasterToDataUrl(r);

  async function writePieces(pieces: Piece[], folder: string) {
    for (const piece of pieces) await studio.api!.writeExport(`exports/${folder}/${piece.name}.png`, dataUrl(scaleUp(piece.raster, p.scale)));
    return pieces.length;
  }
  async function run() {
    working = true;
    report = "";
    try {
      const name = safeName(base);
      if (p.what === "gif") return void (ongif(), onclose());
      if (p.what === "apng") return void (onapng(), onclose());
      if (p.what === "frames") {
        const n = await writePieces(framePieces(doc, base), name);
        report = `Wrote ${n} picture${n === 1 ? "" : "s"} to exports/${name}/.`;
      } else if (p.what === "layers") {
        const n = await writePieces(layerPieces(doc, base), `${name}_layers`);
        report = `Wrote ${n} picture${n === 1 ? "" : "s"} to exports/${name}_layers/.`;
      } else {
        const pieces = framePieces(doc, base);
        const durations = new Map(pieces.map((x) => [x.name, doc.durations[x.frame ?? 0] ?? 100]));
        const packed = packSheet(pieces, { trim: p.trim, padding: p.padding, powerOfTwo: p.powerOfTwo, scale: p.scale, durations });
        if (!packed) return void (report = "A piece is wider than the sheet may be (2048). Use a smaller size.");
        await studio.api!.writeExport(`exports/${name}_sheet.png`, dataUrl(packed.sheet));
        await studio.api!.writeExport(`exports/${name}_sheet.json`, `data:application/json;base64,${toBase64(new TextEncoder().encode(atlasJson(packed, `${name}_sheet.png`)))}`);
        report = `Wrote exports/${name}_sheet.png (${packed.sheet.w}×${packed.sheet.h}) and exports/${name}_sheet.json with ${Object.keys(packed.atlas.frames).length} pieces.`;
      }
      await studio.refreshFiles();
    } catch (e) {
      report = e instanceof Error ? e.message : String(e);
    } finally {
      working = false;
    }
  }
</script>

<div class="backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) onclose(); }}>
  <div class="dialog" role="dialog" aria-label="Export this sprite">
    <h3>Export this sprite</h3>
    {#if profiles.length}
      <label>Again <select aria-label="Saved exports" value="" onchange={(e) => { const f = profiles.find((x) => x.name === e.currentTarget.value); if (f) p = { ...f }; e.currentTarget.value = ""; }}>
        <option value="" disabled>Saved exports…</option>{#each profiles as x (x.name)}<option value={x.name}>{x.name}</option>{/each}
      </select></label>
    {/if}
    <label>What
      <select bind:value={p.what}>
        <option value="sheet">A packed sheet and its atlas (PNG + JSON)</option>
        <option value="frames">Each frame as a PNG</option>
        <option value="layers">Each layer and frame as a PNG</option>
        <option value="gif">An animated GIF (the current animation)</option>
        <option value="apng">An animated PNG (the current animation)</option>
      </select>
    </label>
    {#if p.what !== "gif" && p.what !== "apng"}
      <label>Bigger by <input type="number" min="1" max="16" step="1" bind:value={p.scale} class="narrow" />×</label>
    {/if}
    {#if p.what === "sheet"}
      <label class="check" title="Cuts the empty edges off each frame; the atlas says how much, so a game can put it back"><input type="checkbox" bind:checked={p.trim} /> Trim empty edges</label>
      <label>Gap between pieces <input type="number" min="0" max="16" step="1" bind:value={p.padding} class="narrow" /> px</label>
      <label class="check" title="Some older graphics hardware likes sheets that are 64, 128, 256…"><input type="checkbox" bind:checked={p.powerOfTwo} /> Sides a power of two</label>
    {/if}
    <label>Save as <input bind:value={p.name} aria-label="Name for this export" /></label>
    {#if report}<p role="status" class="small">{report}</p>{/if}
    <div class="row">
      <button class="primary" disabled={working} onclick={() => { remember(); void run(); }}>Export</button>
      <button class="ghost" onclick={onclose}>Close</button>
    </div>
    <p class="dim small">Files go into the project's exports folder. Frames are named after their animation, e.g. {safeName(base)}_{safeName(doc.tags[0]?.name ?? "idle")}_1.</p>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: #0006; display: grid; place-items: center; z-index: 60; }
  .dialog { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 16px 18px; display: flex; flex-direction: column; gap: 8px; width: min(440px, calc(100% - 32px)); box-shadow: 0 16px 48px #0008; }
  h3 { margin: 0; }
  label { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .check { justify-content: flex-start; }
  .narrow { width: 64px; }
  .row { display: flex; gap: 8px; justify-content: flex-end; }
  .small { font-size: 11px; margin: 0; }
</style>
