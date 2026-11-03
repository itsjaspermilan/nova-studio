<script lang="ts">
  import { tick } from "svelte";
  import { summary } from "../lib/diagnostics";
  import { studio } from "../lib/store.svelte";

  let logBox: HTMLDivElement | undefined = $state();
  const label = (n: number | null) => (n ? `line ${n}` : "");

  $effect(() => {
    studio.log.length;
    if (studio.panel === "play") void tick().then(() => logBox?.scrollTo({ top: logBox.scrollHeight }));
  });
</script>

<section class="panel">
  <div class="tabs" role="tablist">
    <button role="tab" aria-selected={studio.panel === "problems"} class:on={studio.panel === "problems"} onclick={() => (studio.panel = "problems")}>
      Problems {#if studio.diagnostics.length}<span class="badge" class:err={studio.diagnostics.some((d) => d.severity === "error")}>{studio.diagnostics.length}</span>{/if}
    </button>
    <button role="tab" aria-selected={studio.panel === "play"} class:on={studio.panel === "play"} onclick={() => (studio.panel = "play")}>
      Play {#if studio.running}<span class="live">●</span>{/if}
    </button>
    <span class="spacer"></span>
    {#if studio.panel === "problems"}
      <span class="dim">{studio.checking ? "Checking…" : summary(studio.diagnostics)}</span>
      <button class="ghost" onclick={() => studio.check()} disabled={studio.checking}>Check now</button>
    {:else}
      <button class="ghost" onclick={() => (studio.log = [])}>Clear</button>
    {/if}
    <button class="ghost" aria-label="Hide panel" onclick={() => (studio.panelOpen = false)}>▾</button>
  </div>

  {#if studio.panel === "problems"}
    <ul class="list">
      {#each studio.diagnostics as d, i (i)}
        <li>
          <button class="problem" onclick={() => studio.showProblem(d)} disabled={!d.file} title={d.detail}>
            <span class="sev" class:err={d.severity === "error"}>{d.severity === "error" ? "●" : "▲"}</span>
            <span class="msg">{d.message}</span>
            <span class="where dim mono">{d.file ?? "project"}{d.line ? ` · ${label(d.line)}` : ""}{d.place ? ` · ${d.place}` : ""}</span>
          </button>
          {#if d.stack?.some((f) => !f.internal)}
            <ol class="stack" aria-label="Call stack">
              {#each d.stack.filter((f) => !f.internal) as f, k (k)}
                <li><button class="ghost frame" onclick={() => studio.showProblem({ ...d, file: f.file, line: f.line })} title="Open {f.file}">{f.function || "code"} <span class="dim mono">{f.file}:{f.line}</span></button></li>
              {/each}
            </ol>
          {/if}
        </li>
      {:else}
        <li class="empty dim">{studio.checkedAt ? "The project runs for a few frames without problems." : "Checking the project…"}</li>
      {/each}
    </ul>
  {:else}
    <div class="log mono" bind:this={logBox}>
      {#each studio.log as l, i (i)}
        <div class:err={l.stream === "stderr"}>{l.line}</div>
      {:else}
        <div class="dim">Press Play to run the game. Output appears here.</div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .panel { background: var(--panel); border-top: 1px solid var(--line); display: flex; flex-direction: column; min-height: 0; height: 100%; }
  .tabs { display: flex; align-items: center; gap: 4px; padding: 4px 8px; border-bottom: 1px solid var(--line); }
  .tabs [role="tab"] { background: transparent; border-color: transparent; }
  .tabs [role="tab"].on { background: var(--panel-2); border-color: var(--line); }
  .spacer { flex: 1; }
  .badge { background: var(--warn); color: #111; border-radius: 8px; padding: 0 6px; font-size: 11px; margin-left: 4px; }
  .badge.err { background: var(--error); }
  .live { color: var(--ok); margin-left: 4px; }
  .list { list-style: none; margin: 0; padding: 4px; overflow: auto; flex: 1; }
  .problem { width: 100%; display: flex; align-items: baseline; gap: 8px; text-align: left; background: transparent; border-color: transparent; }
  .problem:hover:not(:disabled) { background: var(--panel-2); }
  .sev { color: var(--warn); font-size: 10px; }
  .sev.err { color: var(--error); }
  .msg { flex: 1; min-width: 0; }
  .where { font-size: 11px; white-space: nowrap; }
  .empty { padding: 12px; }
  .log { overflow: auto; flex: 1; padding: 8px 12px; font-size: 12px; white-space: pre-wrap; }
  .log .err { color: var(--warn); }
  .stack { list-style: none; margin: 0 0 4px 26px; padding: 0; display: flex; flex-direction: column; font-size: 11px; }
  .frame { text-align: left; padding: 0 6px; border: none; }
</style>
