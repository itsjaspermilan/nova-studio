<script lang="ts">
  import { buildTree, fileKind, visibleRows } from "../lib/tree";
  import { groupResources, type Resource } from "../lib/resources";
  import { studio } from "../lib/store.svelte";

  type Editing = { mode: "file" | "dir" | "rename"; base: string; value: string };

  let open = $state(new Set<string>(["scenes", "entities", "sprites"]));
  let selected = $state("");
  let editing: Editing | null = $state(null);
  let sprite: { name: string; side: number } | null = $state(null);
  let sfx: string | null = $state(null);
  let model: string | null = $state(null);
  let song: string | null = $state(null);
  let scene: string | null = $state(null);
  let entity: string | null = $state(null);
  // "resources": Sprites, Models, Scenes... as single items; "files": every file as it is on disk
  const saved = (() => {
    try {
      return localStorage.getItem("nova.treeView");
    } catch {
      return null;
    }
  })();
  let view = $state<"resources" | "files">(saved === "files" ? "files" : "resources");
  const setView = (v: "resources" | "files") => {
    view = v;
    try {
      localStorage.setItem("nova.treeView", v);
    } catch {
      // not remembered
    }
  };
  let shut = $state(new Set<string>()); // resource groups folded away
  let renamingResource: { path: string; value: string } | null = $state(null);
  const groups = $derived(groupResources(studio.files, studio.spriteImages));
  const foldGroup = (id: string) => {
    const next = new Set(shut);
    if (!next.delete(id)) next.add(id);
    shut = next;
  };
  const SINGLE: Record<string, string> = { sprites: "sprite", models: "3D model", sounds: "sound effect", music: "song", scenes: "scene", entities: "entity" };
  const RES_ICON: Record<string, string> = { sprite: "◫", model: "◆", scene: "▦", entity: "☺", sound: "♪", song: "♫", script: "☾", image: "▣", font: "A", project: "⚙", file: "·" };
  const add = (id: string) => {
    shut.has(id) && foldGroup(id);
    if (id === "sprites") sprite = { name: "", side: 32 };
    else if (id === "models") model = "";
    else if (id === "sounds") sfx = "";
    else if (id === "music") song = "";
    else if (id === "scenes") scene = "";
    else if (id === "entities") entity = "";
  };
  const isActive = (r: Resource) => r.files.includes(studio.active ?? "");
  async function commitResourceRename() {
    const r = renamingResource;
    renamingResource = null;
    if (!r || !r.value.trim()) return;
    const item = groups.flatMap((g) => g.items).find((i) => i.path === r.path);
    if (item) await studio.renameResource(item, r.value.trim());
  }
  async function removeResource(item: Resource) {
    const what = item.files.length > 1 ? `${item.name} and its ${item.files.length - 1} other file${item.files.length > 2 ? "s" : ""}` : item.name;
    if (confirm(`Move ${what} to the project's trash?`)) await studio.removeResource(item);
  }

  // A sprite's layers file is the sprite editor's business; it stays out of the tree.
  const rows = $derived(visibleRows(buildTree(studio.files.filter((f) => !f.path.endsWith(".layers.json"))), open));
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
    {#if view === "files"}
      <button class="ghost" title="New file" aria-label="New file" onclick={() => begin("file")}>＋</button>
      <button class="ghost" title="New sprite" aria-label="New sprite" onclick={() => (sprite = { name: "", side: 32 })}>◩</button>
      <button class="ghost" title="New sound effect" aria-label="New sound effect" onclick={() => (sfx = "")}>♪</button>
      <button class="ghost" title="New song" aria-label="New song" onclick={() => (song = "")}>♫</button>
      <button class="ghost" title="New 3D model" aria-label="New 3D model" onclick={() => (model = "")}>◆</button>
      <button class="ghost" title="New folder" aria-label="New folder" onclick={() => begin("dir")}>▤</button>
    {:else}
      <button class="ghost" title="New file" aria-label="New file" onclick={() => { setView("files"); begin("file"); }}>＋</button>
    {/if}
    <span class="seg" role="group" aria-label="Project view">
      <button class:on={view === "resources"} title="Sprites, models, scenes... one item each" onclick={() => setView("resources")}>Resources</button>
      <button class:on={view === "files"} title="Every file as it is on disk" onclick={() => setView("files")}>Files</button>
    </span>
  </header>
  {#if scene !== null}
    <form class="sprite" onsubmit={(e) => { e.preventDefault(); const n = scene!; scene = null; void studio.createScene(n); }}>
      <input use:focusOnMount bind:value={() => scene ?? "", (x) => (scene = x)} placeholder="scene name" aria-label="Scene name" />
      <button class="primary" disabled={!scene.trim()}>Create</button>
      <button type="button" class="ghost" aria-label="Cancel" onclick={() => (scene = null)}>✕</button>
    </form>
  {/if}
  {#if entity !== null}
    <form class="sprite" onsubmit={(e) => { e.preventDefault(); const n = entity!; entity = null; void studio.createEntity(n); }}>
      <input use:focusOnMount bind:value={() => entity ?? "", (x) => (entity = x)} placeholder="entity name" aria-label="Entity name" />
      <button class="primary" disabled={!entity.trim()}>Create</button>
      <button type="button" class="ghost" aria-label="Cancel" onclick={() => (entity = null)}>✕</button>
    </form>
  {/if}
  {#if song !== null}
    <form class="sprite" onsubmit={(e) => { e.preventDefault(); const n = song!; song = null; void studio.createSong(n); }}>
      <input use:focusOnMount bind:value={() => song ?? "", (x) => (song = x)} placeholder="song name" aria-label="Song name" />
      <button class="primary" disabled={!song.trim()}>Create</button>
      <button type="button" class="ghost" aria-label="Cancel" onclick={() => (song = null)}>✕</button>
    </form>
  {/if}
  {#if model !== null}
    <form class="sprite" onsubmit={(e) => { e.preventDefault(); const n = model!; model = null; void studio.createModel(n); }}>
      <input use:focusOnMount bind:value={() => model ?? "", (x) => (model = x)} placeholder="model name" aria-label="Model name" />
      <button class="primary" disabled={!model.trim()}>Create</button>
      <button type="button" class="ghost" aria-label="Cancel" onclick={() => (model = null)}>✕</button>
    </form>
  {/if}
  {#if sfx !== null}
    <form class="sprite" onsubmit={(e) => { e.preventDefault(); const n = sfx!; sfx = null; void studio.createSound(n); }}>
      <input use:focusOnMount bind:value={() => sfx ?? "", (x) => (sfx = x)} placeholder="sound name" aria-label="Sound name" />
      <button class="primary" disabled={!sfx.trim()}>Create</button>
      <button type="button" class="ghost" aria-label="Cancel" onclick={() => (sfx = null)}>✕</button>
    </form>
  {/if}
  {#if sprite}
    <form class="sprite" onsubmit={(e) => { e.preventDefault(); const s = sprite!; sprite = null; void studio.createSprite(s.name, s.side); }}>
      <input use:focusOnMount bind:value={() => sprite?.name ?? "", (x) => { if (sprite) sprite.name = x; }} placeholder="sprite name" aria-label="Sprite name" />
      <select bind:value={() => sprite?.side ?? 32, (x) => { if (sprite) sprite.side = x; }} aria-label="Frame size">
        {#each [8, 16, 32, 48, 64, 128] as n (n)}<option value={n}>{n}×{n}</option>{/each}
      </select>
      <button class="primary" disabled={!sprite.name.trim()}>Create</button>
      <button type="button" class="ghost" aria-label="Cancel" onclick={() => (sprite = null)}>✕</button>
    </form>
  {/if}
  {#if view === "resources"}
    <ul class="resources" role="tree" aria-label="Resources">
      {#each groups as g (g.id)}
        <li role="treeitem" aria-selected="false" aria-expanded={!shut.has(g.id)}>
          <div class="group" role="presentation" onclick={() => foldGroup(g.id)}>
            <span class="icon dir">{shut.has(g.id) ? "▸" : "▾"}</span>
            <span class="gtitle">{g.title}</span>
            <span class="count dim">{g.items.length || ""}</span>
            {#if ["sprites", "models", "sounds", "music", "scenes", "entities"].includes(g.id)}
              <button class="ghost add" title="New {SINGLE[g.id]}" aria-label="New {SINGLE[g.id]}" onclick={(e) => { e.stopPropagation(); add(g.id); }}>＋</button>
            {/if}
          </div>
          {#if !shut.has(g.id)}
            {#each g.items as item (item.path)}
              {#if renamingResource?.path === item.path}
                <div class="edit" style:padding-left="26px">
                  <input use:focusOnMount bind:value={() => renamingResource?.value ?? "", (x) => { if (renamingResource) renamingResource.value = x; }} onkeydown={(e) => { if (e.key === "Enter") void commitResourceRename(); else if (e.key === "Escape") renamingResource = null; }} onblur={commitResourceRename} />
                </div>
              {:else}
                <div class="row item" class:active={isActive(item)} class:selected={selected === item.path} style:padding-left="26px" role="presentation" onclick={() => { selected = item.path; void studio.openFile(item.path); }}>
                  <span class="icon">{RES_ICON[item.kind]}</span>
                  <span class="name" class:bad={item.files.some((f) => errorFiles.has(f))} title={item.files.join("\n")}>{item.name}</span>
                  <span class="actions">
                    {#if item.kind === "model" && item.files.length === 1 && item.path.endsWith(".glb")}<button class="ghost" title="Make this model editable in the studio (its parts, colours and animations are read in; the original is kept)" aria-label="Make {item.name} editable" onclick={(e) => { e.stopPropagation(); void studio.makeModelEditable(item.path); }}>✎ Edit</button>{/if}
                    {#if item.code}<button class="ghost" title="Open the code" aria-label="Code of {item.name}" onclick={(e) => { e.stopPropagation(); void studio.openFile(item.code!); }}>&lt;/&gt;</button>{/if}
                    <button class="ghost" title="Rename" aria-label="Rename {item.name}" onclick={(e) => { e.stopPropagation(); renamingResource = { path: item.path, value: item.name.slice(item.name.lastIndexOf("/") + 1) }; }}>✎</button>
                    <button class="ghost danger" title="Delete" aria-label="Delete {item.name}" onclick={(e) => { e.stopPropagation(); void removeResource(item); }}>✕</button>
                  </span>
                </div>
              {/if}
            {:else}
              <div class="empty dim">Nothing yet</div>
            {/each}
          {/if}
        </li>
      {/each}
    </ul>
  {:else}
  <ul role="tree">
    {#if editing && editing.mode !== "rename" && editing.base === ""}
      <li class="edit" style:padding-left="10px">
        <input use:focusOnMount bind:value={() => editing?.value ?? "", (x) => { if (editing) editing.value = x; }} onkeydown={keydown} onblur={commit} placeholder={editing.mode === "dir" ? "folder name" : "file name"} />
      </li>
    {/if}
    {#each rows as { node, depth } (node.path)}
      <li role="treeitem" aria-selected={selected === node.path} aria-expanded={node.dir ? open.has(node.path) : undefined}>
        {#if editing?.mode === "rename" && editing.base === node.path}
          <div class="edit" style:padding-left="{10 + depth * 14}px">
            <input use:focusOnMount bind:value={() => editing?.value ?? "", (x) => { if (editing) editing.value = x; }} onkeydown={keydown} onblur={commit} />
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
            <input use:focusOnMount bind:value={() => editing?.value ?? "", (x) => { if (editing) editing.value = x; }} onkeydown={keydown} onblur={commit} placeholder={editing.mode === "dir" ? "folder name" : "file name"} />
          </div>
        {/if}
      </li>
    {/each}
  </ul>
  {/if}
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
  .seg { display: inline-flex; margin-left: 4px; } .seg button { padding: 1px 7px; font-size: 11px; border-radius: 0; } .seg button:first-child { border-radius: 5px 0 0 5px; } .seg button:last-child { border-radius: 0 5px 5px 0; margin-left: -1px; }
  .seg button.on { background: var(--accent-2); border-color: var(--accent-2); color: #fff; }
  .group { display: flex; align-items: center; gap: 6px; padding: 4px 6px 2px 10px; cursor: pointer; font-weight: 600; font-size: 12px; }
  .group:hover { background: var(--panel-2); } .gtitle { flex: 1; } .count { font-size: 11px; font-weight: 400; } .group .add { padding: 0 6px; }
  .empty { padding: 1px 6px 3px 26px; font-size: 11px; }
  .edit { padding: 2px 8px 2px 10px; }
  .edit input { width: 100%; padding: 2px 6px; }
</style>
