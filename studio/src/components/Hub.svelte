<script lang="ts">
  import { studio } from "../lib/store.svelte";

  let name = $state("My Game");
  let template = $state("starter");
  let parent = $state("");
  let exampleName = $state<Record<string, string>>({});

  const folder = $derived(parent || studio.projectsDir);
  const when = (s: number) => new Date(s * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  async function chooseFolder() {
    const picked = await studio.pickFolder("Where should the project go?");
    if (picked) parent = picked;
  }
</script>

<main class="hub">
  <section class="hero">
    <h1>Nova Studio</h1>
    <p class="dim">Make native 2D and 3D games in Lua. Projects are plain folders you own.</p>
    <p><button class="primary" onclick={() => studio.openHelp("lessons", "first-game")}>New here? Make your first game (10 min)</button> <button class="ghost" onclick={() => studio.openHelp()}>? Help and lessons</button></p>
  </section>

  <div class="columns">
    <section class="card">
      <h2>New project</h2>
      <label>Name <input bind:value={name} placeholder="My Game" /></label>
      <fieldset>
        <legend>Template</legend>
        {#each studio.templates as t (t.id)}
          <label class="choice">
            <input type="radio" name="template" value={t.id} bind:group={template} />
            <span><strong>{t.name}</strong><br /><span class="dim">{t.description}</span></span>
          </label>
        {/each}
      </fieldset>
      <div class="where">
        <span class="dim mono" title={folder}>{folder || "…"}</span>
        <button class="ghost" onclick={chooseFolder}>Change…</button>
      </div>
      <button class="primary" disabled={studio.busy || !name.trim() || !folder} onclick={() => studio.newProject(folder, name.trim(), template)}>Create project</button>
    </section>

    <section class="card">
      <h2>Recent</h2>
      {#if studio.recents.length === 0}
        <p class="dim">Projects you open will show up here.</p>
      {/if}
      <ul class="recent">
        {#each studio.recents as r (r.path)}
          <li>
            <button class="open" disabled={studio.busy} onclick={() => studio.openProject(r.path)}>
              <strong>{r.name}</strong>
              <span class="dim mono">{r.path}</span>
              <span class="dim">{when(r.opened)}</span>
            </button>
            <button class="ghost" title="Remove from the list" aria-label="Forget {r.name}" onclick={() => studio.forget(r.path)}>✕</button>
          </li>
        {/each}
      </ul>
      <button onclick={() => studio.pickAndOpen()} disabled={studio.busy}>Open folder…</button>
    </section>

    {#if studio.examples.length}
      <section class="card">
        <h2>Examples</h2>
        <p class="dim">Copies a finished game into your projects folder so you can change it.</p>
        <ul class="recent">
          {#each studio.examples as ex (ex.id)}
            <li class="example">
              <strong>{ex.name}</strong>
              <input bind:value={exampleName[ex.id]} placeholder={ex.name} aria-label="Name for the copy of {ex.name}" />
              <button disabled={studio.busy || !folder} onclick={() => studio.copyExample(ex.id, folder, (exampleName[ex.id] || ex.name).trim())}>Copy &amp; open</button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  </div>
</main>

<style>
  .hub { height: 100%; overflow: auto; padding: 48px 32px; }
  .hero { max-width: 1000px; margin: 0 auto 28px; }
  h1 { font-size: 30px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 0 0 12px; }
  .columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; max-width: 1000px; margin: 0 auto; align-items: start; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 18px; display: flex; flex-direction: column; gap: 12px; }
  label { display: flex; flex-direction: column; gap: 4px; }
  fieldset { border: 1px solid var(--line); border-radius: 8px; margin: 0; display: flex; flex-direction: column; gap: 8px; }
  .choice { flex-direction: row; align-items: flex-start; gap: 8px; }
  .where { display: flex; align-items: center; gap: 8px; }
  .where span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; font-size: 12px; }
  .recent { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .recent li { display: flex; gap: 4px; align-items: center; }
  .open { flex: 1; display: flex; flex-direction: column; align-items: flex-start; text-align: left; gap: 1px; min-width: 0; }
  .open .mono { font-size: 11px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .example { flex-wrap: wrap; }
  .example strong { flex-basis: 100%; }
  .example input { flex: 1; min-width: 0; }
</style>
