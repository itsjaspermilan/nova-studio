<script lang="ts">
  import { apiEntries } from "../lib/completions";
  import { byGroup, searchApi } from "../lib/help-search";
  import { parseBody, type Block } from "../lib/markup";
  import { Progress } from "../lib/progress";
  import { studio } from "../lib/store.svelte";
  import { lessons, shortcuts, snippets } from "../lib/tutorials";

  const progress = new Progress();
  let ticks = $state(0); // bumps so the checkmarks redraw
  let query = $state("");
  let copied = $state("");

  const lesson = $derived(lessons.find((l) => l.id === studio.helpLesson) ?? null);
  const results = $derived(searchApi(query, apiEntries));
  const groups = byGroup(apiEntries);
  const done = (id: string, steps: number) => (ticks >= 0 ? progress.count(id, steps) : 0);

  function close() {
    studio.helpOpen = false;
  }
  function go(tab: typeof studio.helpTab, id: string | null = null) {
    studio.helpTab = tab;
    studio.helpLesson = id;
  }
  function tick(id: string, i: number) {
    progress.toggle(id, i);
    ticks++;
  }
  async function copy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied = id;
      setTimeout(() => copied === id && (copied = ""), 1500);
    } catch {
      studio.say("error", "Could not copy. Select the code and copy it by hand.");
    }
  }
  function onkey(e: KeyboardEvent) {
    if (e.key === "Escape" && studio.helpOpen) close();
  }
  const blocks = (text: string): Block[] => parseBody(text);
</script>

<svelte:window onkeydown={onkey} />

{#if studio.helpOpen}
  <div class="backdrop" role="presentation" onclick={close}></div>
  <div class="help" role="dialog" aria-modal="true" aria-label="Help">
    <nav class="nav">
      <h2>Help</h2>
      <button class:on={studio.helpTab === "start"} onclick={() => go("start")}>Start here</button>
      <button class:on={studio.helpTab === "lessons" && !lesson} onclick={() => go("lessons")}>Lessons</button>
      {#each lessons as l, n (l.id)}
        <button class="sub" class:on={lesson?.id === l.id} onclick={() => go("lessons", l.id)}>
          <span class="num">{n + 1}</span> {l.title}
          {#if done(l.id, l.steps.length) === l.steps.length}<span class="ok" aria-label="finished">✓</span>{/if}
        </button>
      {/each}
      <button class:on={studio.helpTab === "reference"} onclick={() => go("reference")}>Look something up</button>
      <button class:on={studio.helpTab === "keys"} onclick={() => go("keys")}>Keys and tips</button>
      <span class="grow"></span>
      <button class="ghost" onclick={close}>Close (Esc)</button>
    </nav>

    <div class="page">
      {#if studio.helpTab === "start"}
        <h1>Welcome to Nova Studio</h1>
        <p>You make a game from a folder of ordinary files: code in Lua, pictures, sounds, music and 3D models. The studio gives you a place to make each one, and a <strong>▶ Play</strong> button that runs your game.</p>
        <h3>What the buttons do</h3>
        <ul class="plain">
          <li><strong>▶ Play</strong> (⌘↩) saves everything and opens your game in its own window. Edit and save while it runs and it reloads.</li>
          <li><strong>◩ New sprite</strong> makes a picture to draw on, with frames for animation.</li>
          <li><strong>♪ New sound effect</strong> makes a sound like a coin, a jump or an explosion.</li>
          <li><strong>♫ New song</strong> makes music you place note by note.</li>
          <li><strong>◆ New 3D model</strong> builds a model from blocks, and can animate it.</li>
          <li><strong>Scene files</strong> (<code>*.scene.json</code>) open as a picture of a level you can arrange.</li>
          <li><strong>Problems</strong> at the bottom lists mistakes in your project. Click one to jump to it.</li>
        </ul>
        <h3>New here?</h3>
        <p>Do <button class="link" onclick={() => go("lessons", "first-game")}>lesson 1: collect the coins</button>. It takes about ten minutes and you end up with a small game.</p>
        <h3>Good to know</h3>
        <ul class="plain">
          <li>Everything is saved as plain files in your project folder, so you can use git, or open the files in any other program. The studio notices changes made elsewhere.</li>
          <li>Deleted files go to a <code>.nova/trash</code> folder inside the project, not away for good.</li>
          <li>The game never runs inside the studio: Play starts the real thing.</li>
        </ul>
      {:else if studio.helpTab === "lessons" && !lesson}
        <h1>Lessons</h1>
        <p>Short, hands-on and in order. Each step has a checkbox so you can see how far you got.</p>
        <div class="cards">
          {#each lessons as l, n (l.id)}
            <button class="card" onclick={() => go("lessons", l.id)}>
              <span class="num">{n + 1}</span>
              <strong>{l.title}</strong>
              <span class="dim">{l.summary}</span>
              <span class="dim small">About {l.minutes} minutes · {done(l.id, l.steps.length)} of {l.steps.length} steps done</span>
            </button>
          {/each}
        </div>
      {:else if lesson}
        <p class="crumb"><button class="link" onclick={() => go("lessons")}>‹ All lessons</button></p>
        <h1>{lesson.title}</h1>
        <p class="dim">About {lesson.minutes} minutes. {lesson.needs}</p>
        {#each lesson.steps as step, i (i)}
          <section class="step" class:finished={ticks >= 0 && progress.has(lesson.id, i)}>
            <h3>
              <label class="tickbox"><input type="checkbox" checked={ticks >= 0 && progress.has(lesson.id, i)} onchange={() => tick(lesson.id, i)} aria-label="Done with step {i + 1}" /></label>
              <span class="num">{i + 1}</span> {step.title}
            </h3>
            {#each blocks(step.body) as b, bi (bi)}
              {#if b.kind === "p"}
                <p>{#each b.spans as s, si (si)}{#if s.code}<code>{s.text}</code>{:else if s.bold}<strong>{s.text}</strong>{:else}{s.text}{/if}{/each}</p>
              {:else if b.kind === "tip"}
                <p class="tip">💡 {#each b.spans as s, si (si)}{#if s.code}<code>{s.text}</code>{:else if s.bold}<strong>{s.text}</strong>{:else}{s.text}{/if}{/each}</p>
              {:else}
                <ul>{#each b.items as item, ii (ii)}<li>{#each item as s, si (si)}{#if s.code}<code>{s.text}</code>{:else if s.bold}<strong>{s.text}</strong>{:else}{s.text}{/if}{/each}</li>{/each}</ul>
              {/if}
            {/each}
            {#if step.snippet && snippets[step.snippet]}
              {@const sn = snippets[step.snippet]!}
              <div class="code">
                <div class="codebar">
                  <span class="mono">{sn.path}</span>
                  <span class="grow"></span>
                  <button onclick={() => copy(sn.id, sn.code)}>{copied === sn.id ? "Copied ✓" : "Copy"}</button>
                  <button class="primary" disabled={!studio.project} title={studio.project ? "" : "Open a project first"} onclick={() => studio.applySnippet(sn.path, sn.code)}>Add to my project</button>
                </div>
                <pre class="mono">{sn.code}</pre>
              </div>
            {/if}
          </section>
        {/each}
      {:else if studio.helpTab === "reference"}
        <h1>Look something up</h1>
        <p class="dim">Every Nova function the code editor knows about. The same help appears when you hover a name in your code.</p>
        <!-- svelte-ignore a11y_autofocus -->
        <input class="search" type="search" placeholder="Search, e.g. sprite, sound, camera" bind:value={query} aria-label="Search the reference" autofocus />
        {#if query.trim()}
          {#each results as e (e.name + e.kind)}
            <div class="entry"><code class="sig">{e.signature}</code><p>{e.doc}</p><span class="dim small">{e.group}</span></div>
          {:else}
            <p class="dim">Nothing matches "{query}". Try a shorter word.</p>
          {/each}
        {:else}
          {#each groups as [group, list] (group)}
            <h3>{group}</h3>
            {#each list as e (e.name + e.kind)}
              <div class="entry"><code class="sig">{e.signature}</code><p>{e.doc}</p></div>
            {/each}
          {/each}
        {/if}
      {:else}
        <h1>Keys and tips</h1>
        {#each shortcuts as g (g.area)}
          <h3>{g.area}</h3>
          <table>
            <tbody>
              {#each g.tips as t (t.keys)}<tr><td class="keys"><kbd>{t.keys}</kbd></td><td>{t.what}</td></tr>{/each}
            </tbody>
          </table>
        {/each}
      {/if}
    </div>
  </div>
{/if}

<style>
  .backdrop { position: fixed; inset: 0; background: #0009; z-index: 60; }
  .help { position: fixed; inset: 5% 6%; z-index: 61; display: grid; grid-template-columns: 250px minmax(0, 1fr); background: var(--bg); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; box-shadow: 0 20px 60px #000a; }
  .nav { background: var(--panel); border-right: 1px solid var(--line); padding: 12px 8px; display: flex; flex-direction: column; gap: 2px; overflow: auto; }
  .nav h2 { margin: 0 8px 8px; font-size: 15px; }
  .nav button { text-align: left; background: transparent; border-color: transparent; padding: 5px 8px; }
  .nav button.on { background: color-mix(in srgb, var(--accent) 22%, transparent); }
  .nav .sub { padding-left: 22px; font-size: 12px; color: var(--dim); }
  .nav .sub.on { color: var(--text); }
  .nav .ok { color: var(--ok); margin-left: 4px; }
  .grow { flex: 1; }
  .page { overflow: auto; padding: 24px 32px 48px; max-width: 860px; line-height: 1.55; }
  h1 { font-size: 24px; margin: 0 0 8px; } h3 { margin: 22px 0 6px; }
  p { margin: 8px 0; }
  .plain { padding-left: 20px; } .plain li { margin: 4px 0; }
  code { background: var(--panel-2); border-radius: 4px; padding: 0 4px; font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
  .link { background: none; border: none; padding: 0; color: var(--accent); text-decoration: underline; cursor: pointer; }
  .cards { display: grid; gap: 10px; margin-top: 12px; }
  .card { text-align: left; display: flex; flex-direction: column; gap: 3px; padding: 12px 14px; background: var(--panel); }
  .num { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 10px; background: var(--accent-2); color: #fff; font-size: 11px; margin-right: 4px; }
  .small { font-size: 11px; }
  .step { border-top: 1px solid var(--line); margin-top: 16px; padding-top: 4px; }
  .step.finished h3 { color: var(--dim); }
  .step h3 { display: flex; align-items: center; gap: 4px; }
  .tickbox { margin-right: 6px; } .tickbox input { width: 16px; height: 16px; }
  .tip { background: color-mix(in srgb, var(--warn) 14%, transparent); border-left: 3px solid var(--warn); padding: 6px 10px; border-radius: 0 6px 6px 0; }
  .code { border: 1px solid var(--line); border-radius: 8px; overflow: hidden; margin: 10px 0; }
  .codebar { display: flex; gap: 6px; align-items: center; padding: 4px 8px; background: var(--panel); border-bottom: 1px solid var(--line); font-size: 12px; }
  pre { margin: 0; padding: 10px 12px; overflow: auto; background: var(--panel-2); font-size: 12px; line-height: 1.5; max-height: 340px; }
  .search { width: 100%; padding: 8px 10px; margin: 10px 0; }
  .entry { padding: 8px 0; border-bottom: 1px solid var(--line); }
  .entry p { margin: 2px 0; color: var(--dim); }
  .sig { display: block; white-space: pre-wrap; color: var(--accent); }
  table { border-collapse: collapse; } td { padding: 4px 12px 4px 0; vertical-align: top; }
  kbd { background: var(--panel-2); border: 1px solid var(--line); border-radius: 5px; padding: 1px 6px; font-family: ui-monospace, Menlo, monospace; font-size: 12px; white-space: nowrap; }
  .keys { white-space: nowrap; }
</style>
