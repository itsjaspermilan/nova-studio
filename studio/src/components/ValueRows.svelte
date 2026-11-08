<script lang="ts">
  // Values from the game (variables or an object's fields) as rows; tables open in place. With `editable`, numbers,
  // text and true/false can be changed: the new value goes to the running game.
  import ValueRows from "./ValueRows.svelte";
  import { debug, unquote, type DebugValue } from "../lib/debugger.svelte";

  let { entries, depth = 0, editable = false, parentRef }: { entries: DebugValue[]; depth?: number; editable?: boolean; parentRef?: number } = $props();

  const canEdit = (e: DebugValue) => editable && (e.type === "number" || e.type === "string" || e.type === "boolean");

  async function commit(e: DebugValue, input: HTMLInputElement) {
    if (input.value === unquote(e.value)) return;
    const ok = await debug.setField(e, input.value, parentRef);
    if (!ok) input.value = unquote(e.value);
  }
</script>

<ul class="rows" class:nested={depth > 0}>
  {#each entries as e (e.name)}
    <li>
      <div class="row" style="padding-left: {depth * 14 + 4}px">
        {#if e.ref}
          <button class="ghost twist" aria-label="{debug.open[e.ref] ? 'Close' : 'Open'} {e.name}" aria-expanded={!!debug.open[e.ref]} onclick={() => debug.toggle(e.ref!)}>{debug.open[e.ref] ? "▾" : "▸"}</button>
        {:else}
          <span class="twist"></span>
        {/if}
        <span class="name mono">{e.name}</span>
        {#if canEdit(e) && e.type === "boolean"}
          <input type="checkbox" aria-label={e.name} checked={e.value === "true"} onchange={(ev) => debug.setField(e, (ev.currentTarget as HTMLInputElement).checked ? "true" : "false", parentRef)} />
          <span class="value mono t-{e.type}">{e.value}</span>
        {:else if canEdit(e)}
          <input
            class="edit mono t-{e.type}"
            aria-label={e.name}
            value={unquote(e.value)}
            onkeydown={(ev) => {
              if (ev.key === "Enter") (ev.currentTarget as HTMLInputElement).blur();
              if (ev.key === "Escape") {
                (ev.currentTarget as HTMLInputElement).value = unquote(e.value);
                (ev.currentTarget as HTMLInputElement).blur();
              }
            }}
            onblur={(ev) => commit(e, ev.currentTarget as HTMLInputElement)}
          />
        {:else}
          <span class="value mono t-{e.type}" title={e.value}>{e.value}</span>
        {/if}
      </div>
      {#if e.ref && debug.open[e.ref]}
        <ValueRows entries={debug.open[e.ref] ?? []} depth={depth + 1} {editable} parentRef={e.ref} />
      {/if}
    </li>
  {:else}
    {#if depth === 0}<li class="dim empty">Nothing here.</li>{/if}
  {/each}
</ul>

<style>
  .rows { list-style: none; margin: 0; padding: 0; }
  .row { display: flex; align-items: center; gap: 6px; min-height: 22px; border-radius: 3px; }
  .row:hover { background: var(--panel-2); }
  .twist { width: 16px; flex: none; padding: 0; border: none; font-size: 10px; text-align: center; }
  .name { flex: 0 0 auto; min-width: 90px; color: var(--accent); font-size: 12px; }
  .value { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
  .edit { flex: 1; min-width: 0; font-size: 12px; padding: 1px 6px; background: var(--bg); border: 1px solid var(--line); border-radius: 4px; color: var(--text); }
  .t-number { color: #f78c6c; }
  .t-string { color: #a5d6a7; }
  .t-boolean, .t-nil { color: #c792ea; }
  .t-function { color: var(--dim); }
  .empty { padding: 6px 8px; font-size: 12px; }
</style>
