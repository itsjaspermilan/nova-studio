<script lang="ts">
  import { buildTree, fileKind, visibleRows } from "../lib/tree";
  import { studio } from "../lib/store.svelte";

  type Editing = { mode: "file" | "dir" | "rename"; base: string; value: string };

  let open = $state(new Set<string>(["scenes", "entities", "sprites"]));
  let selected = $state("");
  let editing: Editing | null = $state(null);
  let sprite: { name: string; side: number } | null = $state(null);

  const rows = $derived(visibleRows(buildTree(studio.files), open));
  const errorFiles = $derived(new Set(studio.diagnostics.filter((d) => d.severity === "error" && d.file).map((d) => d.file!)));
  const ICON: Record<string, string> = { lua: "☾", scene: "▦", sheet: "◫", manifest: "⚙", json: "{ }", image: "▣", model: "◆", sound: "♪", font: "A", other: "·" };

  function toggle(path: string) {
    const next = new Set(open);
    if (!next.delete(path)) next.add(path);
    open = next;
  }

  /// The folder a new item goes into: the selected folder, or the selected file's folder.
  function targetFolder(): string {
    if (!selected) return "";
    const node = studio.files.find((f) => f.path === selected);
    if (node?.dir) return selected;
    const slash = selected.lastIndexOf("/");
    return slash < 0 ? "" : selected.slice(0, slash);
  }

  function begin(mode: "file" | "dir") {
    const base = targetFolder();
    if (base) open = new Set(open).add(base);
    editing = { mode, base, value: "" };
  }

  function beginRename(path: string) {
    editing = { mode: "rename", base: path, value: path.slice(path.lastIndexOf("/") + 1) };
  }

  async function commit() {
    const e = editing;
    editing = null;
    if (!e || !e.value.trim()) return;
    const name = e.value.trim();
    if (e.mode === "rename") {
      const slash = e.base.lastIndexOf("/");
      const to = slash < 0 ? name : `${e.base.slice(0, slash)}/${name}`;
      if (to !== e.base) await studio.rename(e.base, to);
    } else {
      const path = e.base ? `${e.base}/${name}` : name;
      if (e.mode === "dir") await studio.createDir(path);
      else await studio.createFile(path);
    }
  }

  async function remove(path: string) {
    if (confirm(`Move ${path} to the project's trash?`)) await studio.remove(path);
  }

  function focusOnMount(node: HTMLInputElement) {
    node.focus();
    node.select();
  }

  function keydown(e: KeyboardEvent) {
    if (e.key === "Enter") void commit();
    else if (e.key === "Escape") editing = null;
  }
</script>

<aside class="tree">
  <header>
    <span class="title">{studio.project?.name}</span>
    <button class="ghost" title="New file" aria-label="New file" onclick={() => begin("file")}>＋</button>
    <button class="ghost" title="New sprite" aria-label="New sprite" onclick={() => (sprite = { name: "", side: 32 })}>◩</button>
    <button class="ghost" title="New folder" aria-label="New folder" onclick={() => begin("dir")}>▤</button>
  </header>
  {#if sprite}
    <form class="sprite" onsubmit={(e) => { e.preventDefault(); const s = sprite!; sprite = null; void studio.createSprite(s.name, s.side); }}>
      <input use:focusOnMount bind:value={sprite.name} placeholder="sprite name" aria-label="Sprite name" />
      <select bind:value={sprite.side} aria-label="Frame size">
        {#each [8, 16, 32, 48, 64, 128] as n (n)}<option value={n}>{n}×{n}</option>{/each}
      </select>
      <button class="primary" disabled={!sprite.name.trim()}>Create</button>
      <button type="button" class="ghost" aria-label="Cancel" onclick={() => (sprite = null)}>✕</button>
    </form>
  {/if}
  <ul role="tree">
    {#if editing && editing.mode !== "rename" && editing.base === ""}
      <li class="edit" style:padding-left="10px">
        <input use:focusOnMount bind:value={editing.value} onkeydown={keydown} onblur={commit} placeholder={editing.mode === "dir" ? "folder name" : "file name"} />
      </li>
    {/if}
    {#each rows as { node, depth } (node.path)}
      <li role="treeitem" aria-selected={selected === node.path} aria-expanded={node.dir ? open.has(node.path) : undefined}>
        {#if editing?.mode === "rename" && editing.base === node.path}
          <div class="edit" style:padding-left="{10 + depth * 14}px">
            <input use:focusOnMount bind:value={editing.value} onkeydown={keydown} onblur={commit} />
          </div>
        {:else}
          <div
            class="row"
            class:selected={selected === node.path}
            class:active={studio.active === node.path}
            style:padding-left="{10 + depth * 14}px"
            role="presentation"
            onclick={() => {
              selected = node.path;
              if (node.dir) toggle(node.path);
              else void studio.openFile(node.path);
            }}
            ondblclick={() => !node.dir && void studio.openFile(node.path)}
          >
            <span class="icon" class:dir={node.dir}>{node.dir ? (open.has(node.path) ? "▾" : "▸") : ICON[fileKind(node.path)]}</span>
            <span class="name" class:bad={errorFiles.has(node.path)}>{node.name}</span>
            <span class="actions">
              <button class="ghost" title="Rename" aria-label="Rename {node.name}" onclick={(e) => { e.stopPropagation(); beginRename(node.path); }}>✎</button>
              <button class="ghost danger" title="Delete" aria-label="Delete {node.name}" onclick={(e) => { e.stopPropagation(); void remove(node.path); }}>✕</button>
            </span>
          </div>
        {/if}
        {#if editing && editing.mode !== "rename" && node.dir && editing.base === node.path && open.has(node.path)}
          <div class="edit" style:padding-left="{10 + (depth + 1) * 14}px">
            <input use:focusOnMount bind:value={editing.value} onkeydown={keydown} onblur={commit} placeholder={editing.mode === "dir" ? "folder name" : "file name"} />
          </div>
        {/if}
      </li>
    {/each}
  </ul>
</aside>

<style>
  .tree { background: var(--panel); border-right: 1px solid var(--line); display: flex; flex-direction: column; min-height: 0; }
  header { display: flex; align-items: center; gap: 2px; padding: 8px 8px 8px 12px; border-bottom: 1px solid var(--line); }
  .title { flex: 1; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  ul { list-style: none; margin: 0; padding: 4px 0; overflow: auto; flex: 1; }
  .row { display: flex; align-items: center; gap: 6px; padding: 2px 6px 2px 10px; cursor: pointer; white-space: nowrap; }
  .row:hover { background: var(--panel-2); }
  .row.selected { background: color-mix(in srgb, var(--accent) 14%, transparent); }
  .row.active .name { color: var(--accent); }
  .icon { width: 14px; text-align: center; color: var(--dim); font-size: 11px; flex: none; }
  .name { flex: 1; overflow: hidden; text-overflow: ellipsis; }
  .name.bad { color: var(--error); }
  .actions { display: none; }
  .row:hover .actions { display: inline-flex; }
  .actions button { padding: 0 5px; font-size: 11px; }
  .sprite { display: flex; flex-wrap: wrap; gap: 4px; padding: 6px 8px; border-bottom: 1px solid var(--line); }
  .sprite input { flex: 1 1 100%; }
  .sprite select { flex: 1; min-width: 0; }
  .edit { padding: 2px 8px 2px 10px; }
  .edit input { width: 100%; padding: 2px 6px; }
</style>
