<script lang="ts">
  // The four workspaces as tabs across the top bar (Model, Sprites, Sound, Engine). Ctrl/Cmd+1 to 4 switches; every switch is also in the Window menu.
  import { commands } from "../lib/commands";
  import { WORKSPACES } from "../lib/workspaces";
  import { studio } from "../lib/store.svelte";
</script>

<div class="wtabs" role="tablist" aria-label="Workspaces">
  {#each WORKSPACES as w, i (w.id)}
    {@const cmd = commands.get(`workspace.${w.id}`)}
    <button
      role="tab"
      class="wtab"
      class:on={studio.workspace === w.id}
      aria-selected={studio.workspace === w.id}
      title={cmd ? commands.tooltip(cmd) : w.title}
      onclick={() => studio.setWorkspace(w.id)}
    >{w.title}<span class="n" aria-hidden="true">{i + 1}</span></button>
  {/each}
</div>

<style>
  .wtabs { display: flex; gap: 2px; align-self: stretch; align-items: center; }
  .wtab { background: transparent; border: none; border-radius: 6px; padding: 4px 12px; color: var(--dim); font-weight: 500; }
  .wtab:hover { color: var(--text); background: var(--panel-2); }
  .wtab.on { color: var(--accent); background: color-mix(in srgb, var(--accent) 16%, transparent); }
  .n { display: none; }
</style>
