<script lang="ts">
  // The Engine workspace's right-hand panels, as in the wireframe: an Inspector (what the open file is: an entity's sprite, model and settings, a scene's objects, a script's
  // problems) over an Outline (the functions of a Lua file; a click goes to one).
  import { parseEntitySource } from "../lib/entity-info";
  import { outlineOf } from "../lib/lua-outline";
  import { studio } from "../lib/store.svelte";

  const tab = $derived(studio.tab);
  const path = $derived(tab?.path ?? "");
  const isLua = $derived(path.endsWith(".lua"));
  const isScene = $derived(path.endsWith(".scene.json"));
  const outline = $derived(isLua && tab ? outlineOf(tab.text) : []);
  const entity = $derived(isLua && path.startsWith("entities/") && tab ? parseEntitySource(tab.text) : null);
  const problems = $derived(studio.diagnostics.filter((d) => d.file === path));
  const lines = $derived(tab && !tab.binary ? tab.text.split("\n").length : 0);
  const scene = $derived.by(() => {
    if (!isScene || !tab) return null;
    try {
      const j = JSON.parse(tab.text) as { objects?: { kind?: string; name?: string }[]; images?: unknown[]; texts?: unknown[] };
      const kinds = new Map<string, number>();
      for (const o of j.objects ?? []) kinds.set(o.kind ?? "?", (kinds.get(o.kind ?? "?") ?? 0) + 1);
      return { objects: j.objects?.length ?? 0, kinds: [...kinds], images: j.images?.length ?? 0, texts: j.texts?.length ?? 0 };
    } catch {
      return null;
    }
  });
</script>

<aside class="engine-panels" aria-label="Inspector and outline">
  <section>
    <h4>Inspector</h4>
    {#if !tab}
      <p class="dim small">Open a file to see what it is.</p>
    {:else}
      <p class="small"><strong>{path.slice(path.lastIndexOf("/") + 1)}</strong></p>
      <p class="dim small">{path}{lines ? ` · ${lines} lines` : ""} · {tab.size.toLocaleString("en")} bytes</p>
      {#if entity}
        <p class="small">An <strong>entity</strong>{entity.parent ? ` of ${entity.parent}` : ""}.</p>
        <dl class="small">
          {#if entity.look.sprite}<dt>Sprite</dt><dd>{entity.look.sprite}</dd>{/if}
          {#if entity.look.model}<dt>Model</dt><dd>{entity.look.model}</dd>{/if}
          {#if entity.look.pivot}<dt>Pivot</dt><dd>{entity.look.pivot.join(", ")}</dd>{/if}
        </dl>
        {#if entity.look.settings?.length}
          <p class="dim small">Settings a scene may give it:</p>
          <ul class="small">
            {#each entity.look.settings as s (s.name)}<li title={s.help ?? ""} class:warn={!!s.problem}><strong>{s.name}</strong> <span class="dim">{s.type}{s.default !== undefined ? ` · ${JSON.stringify(s.default)}` : ""}</span>{#if s.problem} <span class="warn">{s.problem}</span>{/if}</li>{/each}
          </ul>
        {:else}<p class="dim small">No settings declared.</p>{/if}
      {:else if scene}
        <p class="small">A <strong>scene</strong>: {scene.objects} object{scene.objects === 1 ? "" : "s"}, {scene.images} picture{scene.images === 1 ? "" : "s"}, {scene.texts} text{scene.texts === 1 ? "" : "s"}.</p>
        {#if scene.kinds.length}<ul class="small">{#each scene.kinds as [kind, n] (kind)}<li>{kind} <span class="dim">× {n}</span></li>{/each}</ul>{/if}
      {:else if isLua}
        <p class="small">A <strong>script</strong>: {outline.length} function{outline.length === 1 ? "" : "s"}.</p>
      {/if}
      {#if problems.length}
        <p class="small warn">{problems.length} problem{problems.length === 1 ? "" : "s"} in this file</p>
        <ul class="small">
          {#each problems.slice(0, 6) as d, i (i)}<li><button class="link" onclick={() => studio.showProblem(d)}>{d.line ? `line ${d.line}: ` : ""}{d.message}</button></li>{/each}
        </ul>
      {/if}
    {/if}
  </section>
  <section>
    <h4>Outline</h4>
    {#if !isLua}
      <p class="dim small">The functions of a Lua file are listed here.</p>
    {:else if !outline.length}
      <p class="dim small">No functions in this file.</p>
    {:else}
      <ul class="outline">
        {#each outline as o (o.line)}
          <li><button class="link" onclick={() => void studio.openFile(path, o.line)} title="Line {o.line}"><span class="dim">{o.local ? "local " : ""}</span>{o.name}<span class="dim">({o.args})</span></button></li>
        {/each}
      </ul>
    {/if}
  </section>
</aside>

<style>
  .engine-panels { width: 240px; display: flex; flex-direction: column; background: var(--panel); border-left: 1px solid var(--line); overflow: auto; }
  section { padding: 8px 10px; border-bottom: 1px solid var(--line); }
  h4 { margin: 0 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--dim); }
  p { margin: 2px 0; }
  ul { list-style: none; margin: 4px 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; margin: 4px 0; }
  dt { color: var(--dim); }
  dd { margin: 0; }
  .small { font-size: 12px; }
  .warn { color: var(--warn); }
  .link { background: transparent; border: none; padding: 1px 2px; text-align: left; font-family: var(--mono, monospace); font-size: 12px; color: var(--text); cursor: pointer; }
  .link:hover { background: var(--panel-2); }
</style>
