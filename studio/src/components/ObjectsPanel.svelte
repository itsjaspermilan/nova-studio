<script lang="ts">
  // The Objects tab: the running scene's entities, refreshed twice a second. Click one to see its fields, change numbers,
  // text and true/false while the game runs, and outline it in the game.
  import ValueRows from "./ValueRows.svelte";
  import { debug } from "../lib/debugger.svelte";

  let filter = $state("");
  const shown = $derived(
    debug.objects.list.filter((o) => {
      const f = filter.trim().toLowerCase();
      return !f || o.name.toLowerCase().includes(f) || !!o.label?.toLowerCase().includes(f) || o.tags.some((t) => t.toLowerCase().includes(f)) || String(o.id) === f;
    }),
  );
  const where = (n: number | null | undefined) => (typeof n === "number" ? (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1)) : "–");

  $effect(() => {
    if (!debug.connected) return;
    void debug.refreshObjects();
    const id = setInterval(() => {
      // (while paused the scene does not move; the list is still right)
      if (!debug.paused) void debug.refreshObjects(!document.activeElement?.closest(".fields input"));
    }, 500);
    return () => clearInterval(id);
  });
  // leaving the tab takes the outline away
  $effect(() => () => {
    if (debug.connected && debug.selected !== null) void debug.select(null);
  });
</script>

<div class="objects">
  {#if !debug.connected}
    <p class="dim hint">Press Play: the running scene's objects show here, and you can change their numbers while the game runs.</p>
  {:else}
    <div class="split">
      <section class="list" aria-label="Objects in the scene">
        <div class="head">
          <input class="filter" placeholder="Find by name or tag" bind:value={filter} aria-label="Find objects" />
          <span class="dim count">{debug.objects.scene ? `${debug.objects.scene} · ` : ""}{debug.objects.count} live</span>
        </div>
        <ul>
          {#each shown as o (o.id)}
            <li>
              <button class="ghost obj" class:on={debug.selected === o.id} onclick={() => debug.select(debug.selected === o.id ? null : o.id)}>
                <span class="nm">{o.kind === "scene" ? `scene ${o.name}` : o.label ? `${o.label} (${o.name})` : o.name} <span class="dim">#{o.id}</span></span>
                <span class="dim mono xy">{where(o.x)}, {where(o.y)}{typeof o.z === "number" && o.z !== 0 ? `, ${where(o.z)}` : ""}</span>
                {#if o.tags.length}<span class="tags dim">{o.tags.join(" ")}</span>{/if}
              </button>
            </li>
          {:else}
            <li class="dim empty">{debug.objects.list.length ? "Nothing matches." : "No scene is running (the game has not called nova.start)."}</li>
          {/each}
        </ul>
      </section>
      <section class="fields" aria-label="Fields">
        {#if debug.selected !== null}
          <p class="dim note">Outlined in the game. Press Enter to set a value.{#if debug.problem}<span class="problem"> {debug.problem}</span>{/if}</p>
          <ValueRows entries={debug.fields} editable />
        {:else}
          <p class="dim note">Pick an object to see its fields.</p>
        {/if}
      </section>
    </div>
  {/if}
</div>

<style>
  .objects { display: flex; flex-direction: column; min-height: 0; flex: 1; overflow: hidden; }
  .hint { padding: 12px; }
  .split { display: flex; min-height: 0; flex: 1; }
  .list { width: 42%; min-width: 200px; border-right: 1px solid var(--line); display: flex; flex-direction: column; min-height: 0; }
  .head { display: flex; align-items: center; gap: 8px; padding: 6px; }
  .filter { flex: 1; min-width: 0; }
  .count { font-size: 11px; white-space: nowrap; }
  ul { list-style: none; margin: 0; padding: 0 4px 4px; overflow: auto; }
  .obj { width: 100%; text-align: left; display: flex; gap: 8px; align-items: baseline; border: none; padding: 2px 6px; font-size: 12px; }
  .obj.on { background: color-mix(in srgb, var(--accent) 18%, transparent); }
  .nm { flex: 1; min-width: 0; }
  .xy { font-size: 11px; }
  .tags { font-size: 11px; }
  .fields { flex: 1; overflow: auto; min-width: 0; padding: 0 4px 6px; }
  .note { margin: 6px 4px; font-size: 12px; }
  .problem { color: var(--warn); }
  .empty { padding: 8px; font-size: 12px; }
</style>
