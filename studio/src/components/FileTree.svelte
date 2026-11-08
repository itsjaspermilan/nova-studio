<script lang="ts">
  import { buildTree, fileKind, visibleRows } from "../lib/tree";
  import { groupResources, resourceRows, type Resource } from "../lib/resources";
  import { resizable } from "../lib/resize";
  import { studio } from "../lib/store.svelte";

  type Editing = { mode: "file" | "dir" | "rename"; base: string; value: string };

  // (every folder starts collapsed, in both views)
  let open = $state(new Set<string>());
  let selected = $state("");
  let editing: Editing | null = $state(null);
  let track: string | null = $state(null);
  let animation: string | null = $state(null);
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
  // the resource groups that are open (all start folded), and the folders inside them that are open (keys from resourceRows)
  let opened = $state(new Set<string>());
  let folders = $state(new Set<string>());
  const shut = { has: (id: string) => !opened.has(id) };
  // the folder clicked last in each group: a new item there starts with its path (levels/...)
  let lastFolder: { group: string; path: string } | null = $state(null);
  const foldFolder = (key: string) => {
    const at = key.indexOf(":");
    lastFolder = { group: key.slice(0, at), path: key.slice(at + 1) };
    const next = new Set(folders);
    if (!next.delete(key)) next.add(key);
    folders = next;
  };
  let renamingResource: { path: string; value: string } | null = $state(null);
  const groups = $derived(groupResources(studio.files, studio.spriteImages));
  const foldGroup = (id: string) => {
    const next = new Set(opened);
    if (!next.delete(id)) next.add(id);
    opened = next;
  };
  const SINGLE: Record<string, string> = { sprites: "sprite", models: "3D model", sounds: "sound effect", music: "song", scenes: "scene", tracks: "track", animations: "animation", entities: "entity" };
  const RES_ICON: Record<string, string> = { sprite: "◫", model: "◆", scene: "▦", track: "⌇", anim: "◷", entity: "☺", sound: "♪", song: "♫", script: "☾", image: "▣", font: "A", project: "⚙", file: "·" };
  const add = (id: string) => {
    shut.has(id) && foldGroup(id);
    const into = lastFolder?.group === id ? `${lastFolder.path}/` : "";
    if (id === "sprites") sprite = { name: into, side: 32 };
    else if (id === "models") model = into;
    else if (id === "sounds") sfx = into;
    else if (id === "music") song = into;
    else if (id === "scenes") scene = into;
    else if (id === "tracks") track = "";
    else if (id === "animations") animation = into;
    else if (id === "entities") entity = into;
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
    // (a name that starts in a folder keeps the folder: the caret goes after it; any other name is selected, to be typed over)
    if (node.value.endsWith("/")) node.setSelectionRange(node.value.length, node.value.length);
    else node.select();
  }

  function keydown(e: KeyboardEvent) {
    if (e.key === "Enter") void commit();
    else if (e.key === "Escape") editing = null;
  }
</script>

<aside class="tree" use:resizable={{ key: "tree", edge: "right", size: 240, min: 160, max: 560 }}>
  <header>
    <span class="title">{studio.project?.name}</span>
    {#if view === "files"}
      <button class="ghost" title="New file" aria-label="New file" onclick={() => begin("file")}>＋</button>
      <button class="ghost" title="New sprite" aria-label="New sprite" onclick={() => (sprite = { name: "", side: 32 })}>◩</button>
      <button class="ghost" title="New sound effect" aria-label="New sound effect" onclick={() => (sfx = "")}>♪</button>
      <button class="ghost" title="New song" aria-label="New song" onclick={() => (song = "")}>♫</button>
      <button class="ghost" title="New 3D model" aria-label="New 3D model" onclick={() => (model = "")}>◆</button>
      <button class="ghost" title="New race track" aria-label="New race track" onclick={() => (track = "")}>⌇</button>
      <button class="ghost" title="New animation (a timeline of keys)" aria-label="New animation" onclick={() => (animation = "")}>◷</button>
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
      <input use:focusOnMount bind:value={() => scene ?? "", (x) => (scene = x)} placeholder="scene name (folder/name for a folder)" aria-label="Scene name" />
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
  {#if animation !== null}
    <form class="sprite" onsubmit={(e) => { e.preventDefault(); const n = animation!; animation = null; void studio.createAnimation(n); }}>
      <input use:focusOnMount bind:value={() => animation ?? "", (x) => (animation = x)} placeholder="animation name (door_open, menus/slide)" aria-label="Animation name" />
      <button class="primary" disabled={!animation.trim()}>Create</button>
      <button type="button" class="ghost" aria-label="Cancel" onclick={() => (animation = null)}>✕</button>
    </form>
  {/if}
  {#if track !== null}
    <form class="sprite" onsubmit={(e) => { e.preventDefault(); const n = track!; track = null; void studio.createTrack(n); }}>
      <input use:focusOnMount bind:value={() => track ?? "", (x) => (track = x)} placeholder="track name" aria-label="Track name" />
      <button class="primary" disabled={!track.trim()}>Create</button>
      <button type="button" class="ghost" aria-label="Cancel" onclick={() => (track = null)}>✕</button>
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
            {#if ["sprites", "models", "sounds", "music", "scenes", "tracks", "animations", "entities"].includes(g.id)}
              <button class="ghost add" title="New {SINGLE[g.id]}" aria-label="New {SINGLE[g.id]}" onclick={(e) => { e.stopPropagation(); add(g.id); }}>＋</button>
            {/if}
          </div>
          {#if !shut.has(g.id)}
            {#each resourceRows(g.items, g.id, folders) as r (r.kind === "folder" ? r.key : r.item.path)}
              {#if r.kind === "folder"}
                <div class="row folder" style:padding-left="{26 + r.depth * 14}px" role="presentation" onclick={() => foldFolder(r.key)}>
                  <span class="icon dir">{r.open ? "▾" : "▸"}</span>
                  <span class="name">{r.name}</span>
                  <span class="count dim">{r.count}</span>
                </div>
              {:else}
              {@const item = r.item}
              {#if renamingResource?.path === item.path}
                <div class="edit" style:padding-left="{26 + r.depth * 14}px">
                  <input use:focusOnMount bind:value={() => renamingResource?.value ?? "", (x) => { if (renamingResource) renamingResource.value = x; }} onkeydown={(e) => { if (e.key === "Enter") void commitResourceRename(); else if (e.key === "Escape") renamingResource = null; }} onblur={commitResourceRename} />
                </div>
              {:else}
                <div class="row item" class:active={isActive(item)} class:selected={selected === item.path} style:padding-left="{26 + r.depth * 14}px" role="presentation" onclick={() => { selected = item.path; void studio.openFile(item.path); }}>
                  <span class="icon">{RES_ICON[item.kind]}</span>
                  <span class="name" class:bad={item.files.some((f) => errorFiles.has(f))} title={item.files.join("\n")}>{r.label}</span>
                  <span class="actions">
                    {#if item.kind === "model" && item.files.length === 1 && item.path.endsWith(".glb")}<button class="ghost" title="Make this model editable in the studio (its parts, colours and animations are read in; the original is kept)" aria-label="Make {item.name} editable" onclick={(e) => { e.stopPropagation(); void studio.makeModelEditable(item.path); }}>✎ Edit</button>{/if}
                    {#if item.code}<button class="ghost" title="Open the code" aria-label="Code of {item.name}" onclick={(e) => { e.stopPropagation(); void studio.openFile(item.code!); }}>&lt;/&gt;</button>{/if}
                    <button class="ghost" title="Rename" aria-label="Rename {item.name}" onclick={(e) => { e.stopPropagation(); renamingResource = { path: item.path, value: item.name.slice(item.name.lastIndexOf("/") + 1) }; }}>✎</button>
                    <button class="ghost danger" title="Delete" aria-label="Delete {item.name}" onclick={(e) => { e.stopPropagation(); void removeResource(item); }}>✕</button>
                  </span>
                </div>
              {/if}
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
  header { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; padding: 8px 8px 8px 12px; border-bottom: 1px solid var(--line); }
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
  .row.folder .name { color: var(--text); } .row.folder .count { font-size: 11px; }
  .empty { padding: 1px 6px 3px 26px; font-size: 11px; }
  .edit { padding: 2px 8px 2px 10px; }
  .edit input { width: 100%; padding: 2px 6px; }
</style>
