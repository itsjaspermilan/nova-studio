<script lang="ts">
  import { onMount } from "svelte";
  import Hub from "./components/Hub.svelte";
  import FileTree from "./components/FileTree.svelte";
  import Editor from "./components/Editor.svelte";
  import SceneEditor from "./components/SceneEditor.svelte";
  import SpriteEditor from "./components/SpriteEditor.svelte";
  import SoundEditor from "./components/SoundEditor.svelte";
  import ModelEditor from "./components/ModelEditor.svelte";
  import BottomPanel from "./components/BottomPanel.svelte";
  import { fileKind } from "./lib/tree";
  import { isDirty, studio } from "./lib/store.svelte";

  onMount(() => {
    void studio.init();
    const keys = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void studio.save();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && studio.project) {
        e.preventDefault();
        void (studio.running ? studio.stop() : studio.play());
      }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  });

  // Scene files open visually unless the person asked for the JSON; remembered per file.
  let jsonView = $state(new Set<string>());
  const isScene = (p: string) => p.endsWith(".scene.json");
  const toggleJson = (p: string, on: boolean) => {
    const next = new Set(jsonView);
    if (on) next.add(p);
    else next.delete(p);
    jsonView = next;
  };
  const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);
  const errors = $derived(studio.diagnostics.filter((d) => d.severity === "error").length);
</script>

{#if !studio.ready}
  <div class="boot dim">Starting…</div>
{:else if !studio.project}
  <Hub />
{:else}
  <div class="shell" class:no-panel={!studio.panelOpen}>
    <header class="top">
      <button class="ghost" onclick={() => studio.closeProject()} title="Back to projects">‹ Projects</button>
      <strong>{studio.project.name}</strong>
      {#if studio.api?.kind === "mock"}<span class="pill">browser preview</span>{/if}
      <span class="spacer"></span>
      <button onclick={() => studio.saveAll()} disabled={!studio.dirty}>Save all</button>
      {#if studio.running}
        <button class="danger" onclick={() => studio.stop()}>■ Stop</button>
      {:else}
        <button class="primary" onclick={() => studio.play()} title="Save and run (⌘↩)">▶ Play</button>
      {/if}
    </header>

    <FileTree />

    <main class="center">
      <div class="tabbar" role="tablist">
        {#each studio.tabs as tab (tab.path)}
          <div class="tab" class:on={studio.active === tab.path} role="presentation">
            <button role="tab" aria-selected={studio.active === tab.path} onclick={() => (studio.active = tab.path)} title={tab.path}>
              {base(tab.path)}{#if isDirty(tab)}<span class="dot" aria-label="unsaved">●</span>{/if}
            </button>
            <button class="ghost x" aria-label="Close {base(tab.path)}" onclick={() => studio.closeTab(tab.path)}>✕</button>
          </div>
        {/each}
      </div>
      <div class="editor-host">
        {#key studio.active}
          {#if studio.tab}
            {#if studio.tab.path.toLowerCase().endsWith(".png") || (studio.tab.path.endsWith(".sprite.json") && !jsonView.has(studio.tab.path))}
              <SpriteEditor path={studio.tab.path} text={studio.tab.text} />
            {:else if studio.tab.path.toLowerCase().endsWith(".wav") || (studio.tab.path.endsWith(".sfx.json") && !jsonView.has(studio.tab.path))}
              <SoundEditor path={studio.tab.path} text={studio.tab.text} />
            {:else if studio.tab.path.endsWith(".model.json") && !jsonView.has(studio.tab.path)}
              <ModelEditor path={studio.tab.path} text={studio.tab.text} onjson={() => toggleJson(studio.tab!.path, true)} />
            {:else if studio.tab.binary}
              <div class="placeholder dim">{base(studio.tab.path)} · {fileKind(studio.tab.path)} · {studio.tab.size.toLocaleString()} bytes<br />Binary files open in their own editors (coming later).</div>
            {:else if isScene(studio.tab.path) && !jsonView.has(studio.tab.path)}
              <SceneEditor path={studio.tab.path} text={studio.tab.text} onjson={() => toggleJson(studio.tab!.path, true)} />
            {:else}
              {#if isScene(studio.tab.path) || studio.tab.path.endsWith(".sprite.json") || studio.tab.path.endsWith(".sfx.json") || studio.tab.path.endsWith(".model.json")}
                <div class="viewbar"><button class="ghost" onclick={() => toggleJson(studio.tab!.path, false)}>◧ Visual editor</button></div>
              {/if}
              <Editor path={studio.tab.path} text={studio.tab.text} />
            {/if}
          {:else}
            <div class="placeholder dim">Open a file from the tree.</div>
          {/if}
        {/key}
      </div>
    </main>

    {#if studio.panelOpen}
      <div class="bottom"><BottomPanel /></div>
    {:else}
      <footer class="status">
        <button class="ghost" onclick={() => (studio.panelOpen = true)}>▴ {errors ? `${errors} problem${errors === 1 ? "" : "s"}` : "Problems · Play"}</button>
      </footer>
    {/if}
  </div>
{/if}

{#if studio.notice}
  <div class="toast" class:error={studio.notice.kind === "error"} role="status">
    <span>{studio.notice.text}</span>
    <button class="ghost" aria-label="Dismiss" onclick={() => (studio.notice = null)}>✕</button>
  </div>
{/if}

<style>
  .boot { height: 100%; display: grid; place-items: center; }
  .shell { height: 100%; display: grid; grid-template-columns: 240px minmax(0, 1fr); grid-template-rows: auto 1fr 220px; grid-template-areas: "top top" "tree center" "bottom bottom"; }
  .shell.no-panel { grid-template-rows: auto 1fr auto; }
  .top { grid-area: top; display: flex; align-items: center; gap: 10px; padding: 6px 10px; background: var(--panel); border-bottom: 1px solid var(--line); }
  .shell > :global(.tree) { grid-area: tree; }
  .center { grid-area: center; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .bottom { grid-area: bottom; min-height: 0; }
  .status { grid-area: bottom; background: var(--panel); border-top: 1px solid var(--line); padding: 2px 8px; }
  .spacer { flex: 1; }
  .pill { font-size: 11px; background: var(--panel-2); border: 1px solid var(--line); border-radius: 10px; padding: 1px 8px; color: var(--warn); }
  .tabbar { display: flex; overflow-x: auto; background: var(--panel); border-bottom: 1px solid var(--line); min-height: 33px; }
  .tab { display: flex; align-items: center; border-right: 1px solid var(--line); }
  .tab.on { background: var(--bg); box-shadow: inset 0 -2px var(--accent); }
  .tab > button:first-child { background: transparent; border: none; border-radius: 0; padding: 6px 4px 6px 12px; }
  .tab .x { padding: 0 6px; font-size: 10px; }
  .dot { color: var(--warn); margin-left: 6px; font-size: 9px; }
  .editor-host { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .editor-host > :global(*) { flex: 1; min-height: 0; }
  .editor-host > :global(.viewbar) { flex: none; padding: 2px 8px; background: var(--panel); border-bottom: 1px solid var(--line); }
  .placeholder { height: 100%; display: grid; place-items: center; text-align: center; padding: 24px; }
  .toast { position: fixed; bottom: 16px; right: 16px; max-width: 460px; display: flex; gap: 8px; align-items: flex-start; background: var(--panel-2); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; box-shadow: 0 8px 24px #0006; z-index: 50; }
  .toast.error { border-color: var(--error); }
</style>
