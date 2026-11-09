<script lang="ts">
  // The assets of the project as cards: a picture for sprites, an icon for the rest. Search, filter by kind, click to open in the editor that
  // owns it, drag a card into the code editor to drop its short name (in quotes) where it is used.
  import Icon from "./Icon.svelte";
  import { assetCards, dropText, filterCards, iconFor, kindsOf, type AssetCard } from "../lib/assets";
  import { groupResources, type ResourceKind } from "../lib/resources";
  import { studio } from "../lib/store.svelte";
  import { workspaceOf, workspaceTitle } from "../lib/workspaces";

  let query = $state("");
  let kind: ResourceKind | "all" = $state("all");
  const all = $derived(assetCards(groupResources(studio.files, studio.spriteImages)));
  const shown = $derived(filterCards(all, query, kind));
  const kinds = $derived(kindsOf(all));

  // sprites show their picture, read once and kept
  let pictures = $state<Record<string, string>>({});
  const pictureOf = (c: AssetCard) => c.files.find((f) => f.toLowerCase().endsWith(".png"));
  $effect(() => {
    for (const c of shown) {
      const png = c.kind === "sprite" || c.kind === "image" ? pictureOf(c) : undefined;
      if (png && !(png in pictures)) {
        pictures[png] = "";
        void studio.api?.readImage(png).then((url) => (pictures[png] = url)).catch(() => undefined);
      }
    }
  });

  const dragStart = (e: DragEvent, c: AssetCard) => {
    e.dataTransfer?.setData("text/plain", dropText(c));
    e.dataTransfer?.setData("application/x-nova-asset", c.path);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
  };
</script>

<div class="assets">
  <div class="bar">
    <input bind:value={query} placeholder="Search assets" aria-label="Search assets" />
    <select bind:value={kind} aria-label="Kind of asset">
      <option value="all">All kinds</option>
      {#each kinds as k (k)}<option value={k}>{k}</option>{/each}
    </select>
    <span class="dim">{shown.length} of {all.length}</span>
  </div>
  <ul class="grid">
    {#each shown as c (c.path)}
      {@const png = pictureOf(c)}
      <li>
        <button class="card" draggable="true" ondragstart={(e) => dragStart(e, c)} onclick={() => studio.openFile(c.path)} title="{c.path}: opens in {workspaceTitle(workspaceOf(c.path))}. Drag it into code to drop its name.">
          <span class="thumb">
            {#if png && pictures[png]}<img src={pictures[png]} alt="" />{:else}<Icon name={iconFor(c.kind)} size={26} />{/if}
          </span>
          <span class="name">{c.name.slice(c.name.lastIndexOf("/") + 1)}</span>
          <span class="kind dim">{c.group}</span>
        </button>
      </li>
    {:else}
      <li class="none dim">Nothing matches.</li>
    {/each}
  </ul>
</div>

<style>
  .assets { height: 100%; display: flex; flex-direction: column; min-height: 0; }
  .bar { display: flex; gap: 8px; align-items: center; padding: 6px 10px; border-bottom: 1px solid var(--line); }
  .bar input { flex: 1; max-width: 320px; }
  .grid { list-style: none; margin: 0; padding: 8px 10px; display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; overflow: auto; }
  .card { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px 4px; background: var(--panel-2); border: 1px solid var(--line); border-radius: 8px; color: var(--text); cursor: grab; }
  .card:hover { border-color: var(--accent); }
  .thumb { width: 64px; height: 64px; display: grid; place-items: center; background: var(--bg); border-radius: 6px; color: var(--dim); overflow: hidden; }
  .thumb img { max-width: 100%; max-height: 100%; image-rendering: pixelated; }
  .name { font-size: 12px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kind { font-size: 10px; }
  .none { grid-column: 1 / -1; padding: 12px; }
</style>
