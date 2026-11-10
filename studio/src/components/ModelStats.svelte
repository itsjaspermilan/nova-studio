<script lang="ts">
  // The model's cost and health: its triangles against a budget for the kind of model, and what is wrong with its meshes.
  import type { ModelDoc } from "../lib/model-doc";
  import { BUDGETS, budgetOf, modelStats, problemsOf, type ModelKind } from "../lib/mesh-stats";

  let { doc }: { doc: ModelDoc } = $props();
  let kind = $state<ModelKind>("prop");
  const stats = $derived(modelStats(doc));
  const budget = $derived(budgetOf(stats.triangles, kind));
  const problems = $derived(problemsOf(stats));
  const heaviest = $derived([...stats.perPart].sort((a, b) => b.stats.triangles - a.stats.triangles).slice(0, 4).filter((p) => p.stats.triangles > 0));
</script>

<div class="stats">
  <h4>Triangles</h4>
  <label class="inline">This is <select bind:value={kind} aria-label="Kind of model">{#each Object.entries(BUDGETS) as [id, b] (id)}<option value={id}>{b.label.toLowerCase()}</option>{/each}</select></label>
  <div class="bar" role="meter" aria-label="Triangle budget" aria-valuemin="0" aria-valuemax={BUDGETS[kind].hard} aria-valuenow={stats.triangles} class:heavy={budget.state === "heavy"} class:over={budget.state === "over"}>
    <i style:width="{Math.min(100, budget.fraction * 100)}%"></i>
    <b style:left="{(BUDGETS[kind].soft / BUDGETS[kind].hard) * 100}%"></b>
  </div>
  <p class="small" class:warn={budget.state !== "fine"}>{budget.label}</p>
  <p class="dim small">{stats.points.toLocaleString("en")} points · {stats.faces.toLocaleString("en")} faces · {stats.parts} part{stats.parts === 1 ? "" : "s"}</p>
  {#if heaviest.length > 1}<p class="dim small">Heaviest: {heaviest.map((p) => `${p.name.trim()} ${p.stats.triangles.toLocaleString("en")}`).join(", ")}</p>{/if}
  {#each problems as p (p)}<p class="small warn">{p}</p>{/each}
</div>

<style>
  .stats { display: flex; flex-direction: column; gap: 4px; }
  h4 { margin: 8px 0 0; }
  .bar { position: relative; height: 8px; background: var(--panel-2); border-radius: 4px; overflow: hidden; }
  .bar i { display: block; height: 100%; background: #6fcf8e; }
  .bar.heavy i { background: #e0b030; }
  .bar.over i { background: #e05a5a; }
  .bar b { position: absolute; top: 0; width: 2px; height: 100%; background: var(--text); opacity: 0.5; }
  .small { font-size: 11px; margin: 0; }
</style>
