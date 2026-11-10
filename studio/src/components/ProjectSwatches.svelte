<script lang="ts">
  // The colours of the project's palettes (`palettes.json`), as swatches to click: the same colours in Sprites and Model.
  import { studio } from "../lib/store.svelte";
  import { PROJECT_PALETTES_PATH, parseProjectPalettes } from "../lib/project-palettes";
  import type { Palette } from "../lib/palette";

  let { onpick, title = "Project palettes" }: { onpick: (hex: string) => void; title?: string } = $props();
  let palettes: Palette[] = $state([]);
  let current = $state(0);
  let note = $state("");

  async function load() {
    if (!studio.api) return;
    try {
      const file = await studio.api.readFile(PROJECT_PALETTES_PATH);
      const parsed = parseProjectPalettes(file.text ?? "");
      if (parsed.ok) {
        palettes = parsed.palettes;
        note = "";
      } else note = parsed.error;
    } catch {
      palettes = []; // no palettes.json yet
    }
  }
  // read again whenever the project's file list changes (a palette saved from Sprites appears here)
  $effect(() => {
    studio.files;
    void load();
  });
</script>

{#if palettes.length}
  <div class="proj" role="group" aria-label={title}>
    <select bind:value={current} aria-label="Project palette">{#each palettes as p, i (p.name)}<option value={i}>{p.name}</option>{/each}</select>
    <span class="sw">
      {#each palettes[current]?.colors ?? [] as c (c)}<button class="swatch" style:background={c} title={c} aria-label="Use {c}" onclick={() => onpick(c)}></button>{/each}
    </span>
  </div>
{/if}
{#if note}<p class="dim small" role="status">{note}</p>{/if}

<style>
  .proj { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 4px 0; }
  .sw { display: inline-flex; gap: 2px; flex-wrap: wrap; }
  .swatch { width: 16px; height: 16px; padding: 0; border: 1px solid var(--line); border-radius: 3px; }
</style>
