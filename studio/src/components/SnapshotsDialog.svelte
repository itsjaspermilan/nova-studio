<script lang="ts">
  // Named snapshots of the whole project: make one before a bold change, put the project back to one later. Restoring takes a snapshot of what is there
  // first, so it can be undone. They live in the project's hidden .nova folder; exports and hidden files are left out.
  import { onMount } from "svelte";
  import type { Snapshot } from "../lib/types";
  import { studio } from "../lib/store.svelte";

  let { onclose }: { onclose: () => void } = $props();
  let list = $state<Snapshot[]>([]);
  let name = $state("");
  let busy = $state(false);
  let note = $state("");

  const when = (s: number) => new Date(s * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const size = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
  async function load() {
    try {
      list = await studio.api!.snapshotList();
    } catch (e) {
      note = String(e);
    }
  }
  onMount(() => void load());

  async function make() {
    busy = true;
    note = "";
    try {
      const s = await studio.api!.snapshotCreate(name.trim() || `Snapshot ${list.length + 1}`);
      note = `Saved “${s.name}”: ${s.files} files, ${size(s.bytes)}.`;
      name = "";
      await load();
    } catch (e) {
      note = String(e);
    } finally {
      busy = false;
    }
  }
  async function restore(s: Snapshot) {
    if (studio.dirty && !confirm("Some documents have unsaved changes. They will be lost when the project goes back. Go on?")) return;
    if (!confirm(`Put the project back as it was at “${s.name}” (${when(s.created)})? What is there now is snapshotted first, so you can come back.`)) return;
    busy = true;
    try {
      const safety = await studio.api!.snapshotRestore(s.id);
      note = `Done. What was there before is saved as “${safety.name}”.`;
      await load();
      const root = studio.project?.root;
      if (root) await studio.openProject(root); // reopen so every document shows the restored files
    } catch (e) {
      note = String(e);
    } finally {
      busy = false;
    }
  }
  async function drop(s: Snapshot) {
    if (!confirm(`Delete the snapshot “${s.name}”? This cannot be undone.`)) return;
    try {
      await studio.api!.snapshotDelete(s.id);
      await load();
    } catch (e) {
      note = String(e);
    }
  }
</script>

<div class="backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) onclose(); }}>
  <div class="dialog" role="dialog" aria-label="Snapshots">
    <h2>Snapshots</h2>
    <p class="dim small">A snapshot is a named copy of every file in the project (not the exports folder). Make one before something bold; come back to it if it goes wrong. They are kept in the project's hidden .nova folder.</p>
    <form class="new" onsubmit={(e) => { e.preventDefault(); void make(); }}>
      <input bind:value={name} placeholder="Name, e.g. before the new car" aria-label="Snapshot name" />
      <button class="primary" disabled={busy}>Take a snapshot</button>
    </form>
    {#if note}<p role="status" class="small">{note}</p>{/if}
    <ul>
      {#each list as s (s.id)}
        <li>
          <div class="what"><strong>{s.name}</strong><span class="dim small">{when(s.created)} · {s.files} files · {size(s.bytes)}</span></div>
          <button disabled={busy} onclick={() => restore(s)}>Go back to this</button>
          <button class="ghost danger" disabled={busy} aria-label="Delete {s.name}" onclick={() => drop(s)}>✕</button>
        </li>
      {:else}
        <li class="dim">No snapshots yet.</li>
      {/each}
    </ul>
    <div class="end"><button onclick={onclose}>Close</button></div>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: #0009; display: grid; place-items: center; z-index: 60; padding: 16px; }
  .dialog { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 16px 18px; width: min(560px, 100%); max-height: 80vh; overflow: auto; display: flex; flex-direction: column; gap: 8px; box-shadow: 0 16px 48px #0008; }
  h2 { margin: 0; }
  .new { display: flex; gap: 8px; }
  .new input { flex: 1; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  li { display: flex; gap: 8px; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--line); }
  .what { flex: 1; display: flex; flex-direction: column; }
  .end { display: flex; justify-content: flex-end; }
  .small { font-size: 11px; margin: 0; }
</style>
