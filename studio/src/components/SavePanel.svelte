<script lang="ts">
  // Save data: what the game keeps between runs (nova.save), as a list of keys. Edit a value, delete a key, add one, or set the whole save aside to start
  // fresh (nothing is deleted: the old file stays beside it). It is the save on this computer; a game's save on another device is not here.
  import { onMount } from "svelte";
  import type { SaveInfo } from "../lib/types";
  import { EMPTY_SAVE, parseSave, rowsOf, withValue, withoutKey } from "../lib/save-data";
  import { studio } from "../lib/store.svelte";

  let info = $state<SaveInfo | null>(null);
  let draft = $state(""); // the save as it will be written
  let loadError = $state("");
  let newKey = $state("");
  let newValue = $state("");
  let editing = $state<{ key: string; text: string } | null>(null);
  let error = $state("");

  const saved = $derived(info?.text ?? "");
  const parsed = $derived(parseSave(draft || EMPTY_SAVE));
  const rows = $derived(parsed.ok ? rowsOf(parsed.data) : []);
  const dirty = $derived(info !== null && draft !== info.text);

  async function load() {
    loadError = "";
    try {
      info = await studio.api!.readSave();
      draft = info.text;
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e);
    }
  }
  onMount(() => void load());

  const apply = (r: { ok: true; text: string } | { ok: false; error: string }) => {
    if (r.ok) {
      draft = r.text;
      error = "";
    } else error = r.error;
  };
  function commitEdit() {
    if (!editing) return;
    apply(withValue(draft || EMPTY_SAVE, editing.key, editing.text));
    if (!error) editing = null;
  }
  function addKey() {
    const k = newKey.trim();
    if (!k) return;
    apply(withValue(draft || EMPTY_SAVE, k, newValue));
    if (!error) (newKey = ""), (newValue = "");
  }
  async function write() {
    try {
      await studio.api!.writeSave(draft || EMPTY_SAVE);
      await load();
      studio.say("info", "Saved. The old file was kept beside it.");
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  async function reset() {
    if (!confirm("Set the save aside so the game starts fresh? The old file is kept (save.json.reset-…) and nothing is deleted.")) return;
    try {
      await studio.api!.resetSave();
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
</script>

<div class="saves">
  {#if loadError}
    <p class="warn">{loadError}</p>
  {:else if !info}
    <p class="dim">Looking for the save…</p>
  {:else}
    <div class="bar">
      <span class="dim mono" title={info.folder}>{info.folder}</span>
      <span class="spacer"></span>
      <button class="ghost" onclick={load} title="Read the file again">Reload</button>
      <button class="primary" disabled={!dirty || !parsed.ok} onclick={write}>Write the save</button>
      <button class="ghost danger" disabled={!info.exists} onclick={reset} title="Move the save aside so the game starts fresh">Start fresh…</button>
    </div>
    {#if !info.exists && !dirty}<p class="dim small">No save yet: the game has not saved anything on this computer. You can write one here.</p>{/if}
    {#if !parsed.ok}<p class="warn">The save cannot be read as a save: {parsed.error} The file is not changed.</p>{/if}
    {#if error}<p class="warn">{error}</p>{/if}
    <table>
      <tbody>
        {#each rows as r (r.key)}
          <tr>
            <td class="k"><code>{r.key}</code></td>
            <td class="kind dim small">{r.kind}</td>
            <td class="v">
              {#if editing?.key === r.key}
                <textarea rows={r.kind === "table" || r.kind === "list" ? 6 : 1} bind:value={editing.text} aria-label="Value of {r.key}" onkeydown={(e) => { if (e.key === "Escape") editing = null; else if (e.key === "Enter" && !e.shiftKey && r.kind !== "table" && r.kind !== "list") { e.preventDefault(); commitEdit(); } }}></textarea>
              {:else}
                <button class="ghost val" onclick={() => (editing = { key: r.key, text: r.json })} title="Edit this value">{r.preview}</button>
              {/if}
            </td>
            <td class="act">
              {#if editing?.key === r.key}
                <button class="primary" onclick={commitEdit}>OK</button>
                <button class="ghost" onclick={() => (editing = null)}>Cancel</button>
              {:else}
                <button class="ghost danger" aria-label="Delete {r.key}" title="Take this key out" onclick={() => (draft = withoutKey(draft || EMPTY_SAVE, r.key))}>✕</button>
              {/if}
            </td>
          </tr>
        {:else}
          <tr><td class="dim pad">Nothing saved.</td></tr>
        {/each}
      </tbody>
    </table>
    <form class="new" onsubmit={(e) => { e.preventDefault(); addKey(); }}>
      <input bind:value={newKey} placeholder="key, e.g. best" aria-label="New key" />
      <input bind:value={newValue} placeholder={'value: 12, true, "text", [1,2] or {"a":1}'} aria-label="New value" />
      <button disabled={!newKey.trim() || !parsed.ok}>Add</button>
    </form>
    {#if info.aside.length}<p class="dim small">Set aside before: {info.aside.join(", ")}</p>{/if}
    {#if dirty}<p class="dim small">Changes are not written until you press “Write the save”. Close the game first: a running game writes its own copy.</p>{/if}
  {/if}
</div>

<style>
  .saves { padding: 8px 12px; overflow: auto; height: 100%; display: flex; flex-direction: column; gap: 6px; }
  .bar { display: flex; gap: 8px; align-items: center; }
  .spacer { flex: 1; }
  table { border-collapse: collapse; width: 100%; }
  td { padding: 3px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
  td.k { width: 25%; } td.kind { width: 70px; } td.act { width: 1%; white-space: nowrap; }
  .val { font-family: ui-monospace, Menlo, monospace; text-align: left; }
  textarea { width: 100%; font-family: ui-monospace, Menlo, monospace; box-sizing: border-box; }
  .new { display: flex; gap: 8px; }
  .new input { flex: 1; }
  .small { font-size: 11px; }
  .pad { padding: 8px; }
</style>
